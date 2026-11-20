import { Elysia } from 'elysia'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { and, desc, eq, gt, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { clinicMemberships, clinics, oauthStates, users } from '../db/schema'
import { createSession } from '../db/repositories/users'
import { ensurePlatformAdminMembership, getActiveMembership } from '../db/repositories/tenancy'
import { signToken } from '../middleware/auth'
import { ensureSubscriptionSchema, normalizePlanId } from '../services/subscriptions'
import {
  findTenantByHostname,
  hostnameFromRequest,
  isLocalHostname,
  isSharedAppHostname,
} from '../tenancy/context'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'voiceai-dev-secret-change-me')

export interface GoogleOnboardingPayload {
  googleSub: string
  email: string
  name: string
  picture?: string
  plan: 'demo' | 'pro'
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim() &&
      (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim(),
  )
}

function isHttpsRequest(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  if (proto === 'https') return true
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

function requestIp(request: Request): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
}

export function resolveGoogleRedirectUri(request: Request): string {
  const explicit = (process.env.GOOGLE_AUTH_REDIRECT_URI || '').trim()
  if (explicit) return explicit

  const hostname = hostnameFromRequest(request)
  if (hostname) {
    if (isLocalHostname(hostname)) {
      const rawHost =
        request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
        request.headers.get('host')?.split(',')[0]?.trim() ||
        ''
      if (rawHost && (rawHost.startsWith('localhost') || rawHost.startsWith('127.0.0.1'))) {
        return `http://${rawHost}/api/auth/google/callback`
      }
      const clientFallback = (process.env.CLIENT_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
      return `${clientFallback}/api/auth/google/callback`
    }

    const proto =
      request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase() || 'https'
    return `${proto}://${hostname}/api/auth/google/callback`
  }

  const clientBase = (process.env.CLIENT_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return `${clientBase}/api/auth/google/callback`
}

export async function signGoogleOnboardingToken(payload: GoogleOnboardingPayload): Promise<string> {
  return new SignJWT({
    purpose: 'google_onboarding',
    googleSub: payload.googleSub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture || '',
    plan: payload.plan,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30m')
    .sign(JWT_SECRET)
}

export async function verifyGoogleOnboardingToken(
  token: string | undefined,
): Promise<GoogleOnboardingPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    if (payload.purpose !== 'google_onboarding') return null
    const googleSub = typeof payload.googleSub === 'string' ? payload.googleSub.trim() : ''
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
    if (!googleSub || !email) return null
    const rawPlan = typeof payload.plan === 'string' ? payload.plan : 'demo'
    const plan: 'demo' | 'pro' = rawPlan === 'pro' ? 'pro' : 'demo'
    return {
      googleSub,
      email,
      name: typeof payload.name === 'string' ? payload.name : '',
      picture: typeof payload.picture === 'string' ? payload.picture : '',
      plan,
    }
  } catch {
    return null
  }
}

function redirect302(set: any, location: string) {
  set.status = 302
  set.headers['location'] = location
  return ''
}

export const googleAuthPlugin = new Elysia({ prefix: '/api/auth/google' })
  .get('/status', () => ({
    enabled: isGoogleOAuthConfigured(),
  }))

  .get('/onboarding', async ({ cookie }) => {
    const raw = cookie.google_onboarding?.value as string | undefined
    const pending = await verifyGoogleOnboardingToken(raw)
    if (!pending) return { pending: false }
    return {
      pending: true,
      email: pending.email,
      name: pending.name,
      plan: pending.plan,
      picture: pending.picture || null,
    }
  })

  .get('/start', async ({ query, request, set }) => {
    const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim()
    const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim()
    if (!clientId || !clientSecret) {
      return redirect302(set, '/login?error=google_yapilandirilmamis')
    }

    await ensureSubscriptionSchema()
    // Opportunistic cleanup of expired OAuth states
    void db.execute(sql`DELETE FROM oauth_states WHERE expires_at < now()`).catch(() => {})

    const q = (query || {}) as Record<string, string | undefined>
    const mode = q.mode === 'signup' ? 'signup' : 'login'
    const normalizedPlan = normalizePlanId(q.plan, 'demo')
    const plan: 'demo' | 'pro' = normalizedPlan === 'pro' ? 'pro' : 'demo'
    const redirectAfter =
      typeof q.redirect === 'string' && q.redirect.startsWith('/') && !q.redirect.startsWith('//')
        ? q.redirect
        : null

    const state = randomBytes(24).toString('base64url')
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const expiresAt = new Date(Date.now() + 10 * 60_000)

    await db.insert(oauthStates).values({
      state,
      mode,
      planId: plan,
      redirectAfter,
      codeVerifier,
      ipAddress: requestIp(request),
      expiresAt,
    })

    const redirectUri = resolveGoogleRedirectUri(request)
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', 'openid email profile')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('access_type', 'online')
    authUrl.searchParams.set('prompt', 'select_account')

    return redirect302(set, authUrl.toString())
  })

  .get('/callback', async ({ query, cookie, request, set }) => {
    const q = (query || {}) as Record<string, string | undefined>
    if (q.error || !q.code || !q.state) {
      return redirect302(set, '/login?error=google_iptal')
    }

    const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim()
    const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim()
    if (!clientId || !clientSecret) {
      return redirect302(set, '/login?error=google_yapilandirilmamis')
    }

    await ensureSubscriptionSchema()
    const now = new Date()
    const [storedState] = await db
      .delete(oauthStates)
      .where(and(eq(oauthStates.state, q.state), gt(oauthStates.expiresAt, now)))
      .returning()

    if (!storedState) {
      return redirect302(set, '/login?error=google_oturum_gecersiz')
    }

    const redirectUri = resolveGoogleRedirectUri(request)
    let accessToken = ''
    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: q.code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        ...(storedState.codeVerifier ? { code_verifier: storedState.codeVerifier } : {}),
      })
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(12_000),
      })
      const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string }
      if (!tokenRes.ok || !tokenJson.access_token) {
        return redirect302(set, '/login?error=google_token_hatasi')
      }
      accessToken = tokenJson.access_token
    } catch {
      return redirect302(set, '/login?error=google_baglanti_hatasi')
    }

    let googleSub = ''
    let cleanEmail = ''
    let emailVerified = false
    let profileName = ''
    let picture = ''
    try {
      const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      })
      const profile = (await profileRes.json().catch(() => ({}))) as {
        sub?: string
        email?: string
        email_verified?: boolean
        name?: string
        picture?: string
      }
      if (!profileRes.ok) {
        return redirect302(set, '/login?error=google_profil_hatasi')
      }
      googleSub = String(profile.sub || '').trim()
      cleanEmail = String(profile.email || '').trim().toLowerCase()
      emailVerified = profile.email_verified === true
      profileName = String(profile.name || '').trim()
      picture = String(profile.picture || '').trim()
    } catch {
      return redirect302(set, '/login?error=google_profil_hatasi')
    }

    if (!googleSub || !cleanEmail || !emailVerified) {
      return redirect302(set, '/login?error=google_eposta_dogrulanmamis')
    }

    const plan: 'demo' | 'pro' = storedState.planId === 'pro' ? 'pro' : 'demo'

    const [existingUser] = await db
      .select()
      .from(users)
      .where(or(eq(users.googleSub, googleSub), sql`lower(${users.email}) = ${cleanEmail}`))
      .limit(1)

    if (existingUser) {
      if (!existingUser.active) {
        return redirect302(set, '/login?error=hesap_askida')
      }

      const reqHost = hostnameFromRequest(request)
      const hostTenant = await findTenantByHostname(reqHost)
      let targetClinicId: string | null = null
      let targetRole = 'yonetici'

      if (hostTenant && !isSharedAppHostname(reqHost)) {
        const directMembership =
          (await getActiveMembership(existingUser.id, hostTenant.clinicId)) ??
          (existingUser.isPlatformAdmin
            ? await ensurePlatformAdminMembership(existingUser.id, hostTenant.clinicId)
            : null)
        if (!directMembership) {
          return redirect302(set, '/login?error=isletme_yetkisi_yok')
        }
        if (hostTenant.isActive === false && !existingUser.isPlatformAdmin) {
          return redirect302(set, '/login?error=isletme_dondurulmus')
        }
        targetClinicId = hostTenant.clinicId
        targetRole = directMembership.role
      } else {
        const memberships = await db
          .select({
            clinicId: clinics.id,
            clinicActive: clinics.isActive,
            role: clinicMemberships.role,
            createdAt: clinicMemberships.createdAt,
          })
          .from(clinicMemberships)
          .innerJoin(clinics, eq(clinicMemberships.clinicId, clinics.id))
          .where(and(eq(clinicMemberships.userId, existingUser.id), eq(clinicMemberships.active, true)))
          .orderBy(desc(clinics.isActive), desc(clinicMemberships.createdAt))

        const chosen = memberships.find((m) => m.clinicActive) ?? memberships[0]
        if (chosen) {
          if (!chosen.clinicActive && !existingUser.isPlatformAdmin) {
            return redirect302(set, '/login?error=isletme_dondurulmus')
          }
          targetClinicId = chosen.clinicId
          targetRole = chosen.role
        } else if (existingUser.isPlatformAdmin && hostTenant) {
          const ensured = await ensurePlatformAdminMembership(existingUser.id, hostTenant.clinicId)
          if (ensured) {
            targetClinicId = hostTenant.clinicId
            targetRole = ensured.role
          }
        }
      }

      if (targetClinicId) {
        await db
          .update(users)
          .set({
            googleSub: existingUser.googleSub || googleSub,
            emailVerifiedAt: existingUser.emailVerifiedAt || now,
            avatar: existingUser.avatar || picture || null,
            lastLoginAt: now,
            updatedAt: now,
          })
          .where(eq(users.id, existingUser.id))

        const jti = randomUUID()
        const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000)
        await createSession({
          userId: existingUser.id,
          tokenJti: jti,
          ipAddress: requestIp(request) || undefined,
          userAgent: request.headers.get('user-agent') || undefined,
          expiresAt,
        })

        const token = await signToken(
          { id: existingUser.id, role: targetRole, clinicId: targetClinicId },
          jti,
        )
        const secure = isHttpsRequest(request)
        cookie.token.set({
          value: token,
          httpOnly: true,
          secure,
          sameSite: 'lax',
          maxAge: 8 * 3600,
          path: '/',
        })
        cookie.google_onboarding.set({
          value: '',
          httpOnly: true,
          secure,
          sameSite: 'lax',
          maxAge: 0,
          path: '/',
        })

        const dest =
          storedState.redirectAfter ||
          (plan === 'pro' ? '/panel?tab=integrations&upgrade=pro' : '/panel')
        return redirect302(set, dest)
      }
    }

    // User does not exist yet or has no clinic membership -> require business name + phone OTP + legal consents
    const onboardingJwt = await signGoogleOnboardingToken({
      googleSub,
      email: cleanEmail,
      name: profileName,
      picture,
      plan,
    })

    cookie.google_onboarding.set({
      value: onboardingJwt,
      httpOnly: true,
      secure: isHttpsRequest(request),
      sameSite: 'lax',
      maxAge: 30 * 60,
      path: '/',
    })

    const targetUrl = `/kayit?step=complete-google&plan=${encodeURIComponent(plan)}&email=${encodeURIComponent(cleanEmail)}&name=${encodeURIComponent(profileName)}`
    return redirect302(set, targetUrl)
  })
