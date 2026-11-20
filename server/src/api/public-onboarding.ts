import { Elysia } from 'elysia'
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import {
  auditLog,
  authOtpChallenges,
  clinicDomains,
  clinicMemberships,
  clinicSettings,
  clinics,
  conversationFlows,
  knowledgeCategories,
  upgradeRequests,
  users,
} from '../db/schema'
import { createSession } from '../db/repositories/users'
import { buildDefaultWebFlow } from '../db/repositories/flows'
import { DEFAULT_CATEGORIES } from '../db/repositories/categories'
import { DEFAULT_NEUTRAL_CATEGORIES } from '../platform/roles'
import { signToken } from '../middleware/auth'
import { sendSMS } from '../services/netgsm'
import { sendEmail } from '../services/email'
import { isIyzicoConfigured } from '../services/iyzico'
import {
  PLAN_CATALOG,
  ensureSubscriptionSchema,
  normalizePlanId,
  normalizeTurkishMobilePhone,
} from '../services/subscriptions'
import { invalidateTenantCache, registerAllowedTenantHostname } from '../tenancy/context'
import { isGoogleOAuthConfigured, verifyGoogleOnboardingToken } from './google-auth'

export { normalizeTurkishMobilePhone } from '../services/subscriptions'

const DEFAULT_ROLE_PERMISSIONS = {
  calisan: ['calendar', 'patients', 'knowledge', 'klinik'],
  hekim: ['calendar', 'patients', 'knowledge', 'klinik'],
  sekreter: ['calendar', 'patients', 'payments', 'klinik'],
  host: ['calendar', 'patients', 'payments', 'klinik'],
  asistan: ['calendar', 'patients', 'klinik'],
}

export interface LegalConsentsInput {
  onBilgilendirme: boolean
  mesafeliSatis: boolean
  iptalIade: boolean
  kvkk: boolean
}

interface SignupOtpPayload {
  name: string
  businessName: string
  email: string
  phone: string
  planId: 'demo' | 'pro'
  consents: LegalConsentsInput
  googleSub: string | null
  consentTimestamp: string
}

const leadRateBuckets = new Map<string, number[]>()

function checkLeadRateLimit(ip: string, maxRequests = 5, windowMs = 15 * 60_000): boolean {
  const now = Date.now()
  const existing = (leadRateBuckets.get(ip) || []).filter((t) => now - t < windowMs)
  if (existing.length >= maxRequests) {
    leadRateBuckets.set(ip, existing)
    return false
  }
  existing.push(now)
  leadRateBuckets.set(ip, existing)
  return true
}

function requestIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1'
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

function slugifyBusinessName(name: string): string {
  const trMap: Record<string, string> = {
    ç: 'c',
    ğ: 'g',
    ı: 'i',
    İ: 'i',
    ö: 'o',
    ş: 's',
    ü: 'u',
    Ç: 'c',
    Ğ: 'g',
    Ö: 'o',
    Ş: 's',
    Ü: 'u',
  }
  const ascii = Array.from(name)
    .map((ch) => trMap[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '')
  return ascii || 'isletme'
}

function hashOtpCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function verifyOtpHashConstantTime(candidateCode: string, expectedHexHash: string): boolean {
  const actual = Buffer.from(hashOtpCode(candidateCode), 'hex')
  const expected = Buffer.from(expectedHexHash, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

async function trySendSignupEmailOtp(email: string, code: string, businessName: string): Promise<boolean> {
  try {
    const [defaultClinic] = await db
      .select({ id: clinics.id })
      .from(clinics)
      .where(eq(clinics.isActive, true))
      .limit(1)
    if (!defaultClinic && !(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)) {
      return false
    }
    await sendEmail({
      clinicId: defaultClinic?.id,
      to: email,
      subject: 'axamaz Doğrulama Kodunuz',
      text: `Merhaba,\n\n${businessName} hesabınız için axamaz doğrulama kodunuz: ${code}\n\nBu kod 5 dakika süreyle geçerlidir.`,
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f4f8fe;border:1px solid #d8e5f6;border-radius:14px;color:#0f172a">
        <div style="background:#ffffff;padding:20px;border-radius:12px;border:1px solid #d8e5f6">
          <h2 style="margin:0 0 10px;color:#2563eb;font-size:18px">axamaz Hesap Doğrulama</h2>
          <p style="margin:0 0 14px;font-size:14px;color:#334155"><strong>${businessName}</strong> kaydınızı tamamlamak için doğrulama kodunuz:</p>
          <div style="padding:14px;text-align:center;font-size:26px;font-weight:800;letter-spacing:6px;background:#eff6ff;color:#1d4ed8;border:1px solid #93c5fd;border-radius:10px">${code}</div>
          <p style="margin:14px 0 0;font-size:12px;color:#64748b">Bu kod 5 dakika süreyle geçerlidir.</p>
        </div>
      </div>`,
    })
    return true
  } catch {
    return false
  }
}

async function findConflictingSignupAccount(params: {
  cleanEmail: string
  phoneLast10: string
  allowedUnattachedEmail?: string | null
  allowedGoogleSub?: string | null
}): Promise<{ conflict: boolean; unattachedUserId: string | null }> {
  const matchedUsers = await db
    .select({
      id: users.id,
      email: users.email,
      phone: users.phone,
      googleSub: users.googleSub,
    })
    .from(users)
    .where(
      or(
        sql`lower(${users.email}) = ${params.cleanEmail}`,
        sql`right(regexp_replace(coalesce(${users.phone}, ''), '\\D', '', 'g'), 10) = ${params.phoneLast10}`,
        params.allowedGoogleSub ? eq(users.googleSub, params.allowedGoogleSub) : undefined,
      ),
    )

  if (matchedUsers.length === 0) {
    return { conflict: false, unattachedUserId: null }
  }

  if (matchedUsers.length > 1) {
    return { conflict: true, unattachedUserId: null }
  }

  const candidate = matchedUsers[0]!
  const memberships = await db
    .select({ clinicId: clinicMemberships.clinicId })
    .from(clinicMemberships)
    .where(eq(clinicMemberships.userId, candidate.id))
    .limit(1)

  if (memberships.length > 0) {
    return { conflict: true, unattachedUserId: null }
  }

  const isExactUnattachedGoogleUser =
    Boolean(params.allowedUnattachedEmail) &&
    candidate.email.toLowerCase() === params.allowedUnattachedEmail!.toLowerCase() &&
    (!params.allowedGoogleSub || !candidate.googleSub || candidate.googleSub === params.allowedGoogleSub)

  if (isExactUnattachedGoogleUser) {
    return { conflict: false, unattachedUserId: candidate.id }
  }

  return { conflict: true, unattachedUserId: null }
}

export const publicOnboardingPlugin = new Elysia({ prefix: '/api/public' })
  .get('/plans', () => ({
    plans: [PLAN_CATALOG.demo, PLAN_CATALOG.pro, PLAN_CATALOG.kurumsal],
    vatRate: 20,
    googleAuthEnabled: isGoogleOAuthConfigured(),
    iyzicoEnabled: isIyzicoConfigured(),
  }))

  .post('/signup/send-otp', async ({ body, cookie, request, set }) => {
    await ensureSubscriptionSchema()
    const b = (body || {}) as Record<string, any>
    const onboarding = await verifyGoogleOnboardingToken(
      cookie.google_onboarding?.value as string | undefined,
    )

    const rawName = String(b.name ?? onboarding?.name ?? '').trim().replace(/\s+/g, ' ')
    const rawBusinessName = String(b.businessName ?? '').trim().replace(/\s+/g, ' ')
    const cleanEmail = String(b.email ?? onboarding?.email ?? '').trim().toLowerCase()
    const normalizedPhone = normalizeTurkishMobilePhone(b.phone)
    const rawPlan = normalizePlanId(b.planId ?? onboarding?.plan, 'demo')
    const planId: 'demo' | 'pro' = rawPlan === 'pro' ? 'pro' : 'demo'
    const channelPref: 'sms' | 'email' = b.channel === 'email' ? 'email' : 'sms'

    if (rawName.length < 2 || rawName.length > 120) {
      set.status = 400
      return { error: 'Ad ve soyad 2 ile 120 karakter arasında olmalıdır.' }
    }
    if (rawBusinessName.length < 2 || rawBusinessName.length > 120) {
      set.status = 400
      return { error: 'İşletme adı 2 ile 120 karakter arasında olmalıdır.' }
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      set.status = 400
      return { error: 'Geçerli bir e-posta adresi girin.' }
    }
    if (!normalizedPhone) {
      set.status = 400
      return { error: 'Geçerli bir Türkiye cep telefonu numarası girin (05XX XXX XX XX).' }
    }

    const consents = (b.consents || {}) as Partial<LegalConsentsInput>
    if (
      consents.onBilgilendirme !== true ||
      consents.mesafeliSatis !== true ||
      consents.iptalIade !== true ||
      consents.kvkk !== true
    ) {
      set.status = 400
      return {
        error:
          'Devam edebilmek için Ön Bilgilendirme Formu, Mesafeli Satış Sözleşmesi, İptal/İade Koşulları ve KVKK Aydınlatma Metni onaylarını işaretlemelisiniz.',
      }
    }

    const phoneLast10 = normalizedPhone.slice(-10)
    const accountCheck = await findConflictingSignupAccount({
      cleanEmail,
      phoneLast10,
      allowedUnattachedEmail: onboarding?.email ?? null,
      allowedGoogleSub: onboarding?.googleSub ?? null,
    })
    if (accountCheck.conflict) {
      set.status = 409
      return {
        error:
          'Bu telefon numarası veya e-posta adresi ile kayıtlı bir işletme hesabı zaten mevcut. Lütfen giriş yapın.',
      }
    }

    const ip = requestIp(request)
    const tenMinAgo = new Date(Date.now() - 10 * 60_000)
    const recentRows = await db
      .select({ id: authOtpChallenges.id })
      .from(authOtpChallenges)
      .where(
        and(
          gt(authOtpChallenges.createdAt, tenMinAgo),
          or(eq(authOtpChallenges.target, normalizedPhone), eq(authOtpChallenges.ipAddress, ip)),
        ),
      )

    if (recentRows.length >= 5) {
      set.status = 429
      return { error: 'Çok fazla doğrulama kodu istendi. Lütfen 10 dakika sonra tekrar deneyin.' }
    }

    const code = String(randomInt(100_000, 1_000_000))
    const codeHash = hashOtpCode(code)

    const netgsmUser = (process.env.NETGSM_API_USERCODE || '').trim()
    const netgsmPass = (process.env.NETGSM_API_PASSWORD || '').trim()
    const netgsmHeader = (process.env.NETGSM_API_MSGHEADER || '').trim()
    const hasNetgsm = Boolean(netgsmUser && netgsmPass && netgsmHeader)

    let deliveryChannel: 'sms' | 'email' | 'dev_preview' | null = null
    let lastSmsReason: string | undefined

    if (hasNetgsm && channelPref !== 'email') {
      const smsResult = await sendSMS({
        usercode: netgsmUser,
        password: netgsmPass,
        senderId: netgsmHeader,
        phone: normalizedPhone,
        message: `axamaz doğrulama kodunuz: ${code}`,
      })
      if (smsResult.success) {
        deliveryChannel = 'sms'
      } else {
        lastSmsReason = smsResult.reason
      }
    }

    if (!deliveryChannel) {
      const emailSent = await trySendSignupEmailOtp(cleanEmail, code, rawBusinessName)
      if (emailSent) {
        deliveryChannel = 'email'
      }
    }

    if (!deliveryChannel) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[PublicOnboarding][DEV OTP] ${normalizedPhone} / ${cleanEmail} -> Kod: ${code}`)
        deliveryChannel = 'dev_preview'
      } else {
        set.status = 503
        return {
          error:
            lastSmsReason ||
            'Doğrulama kodu gönderim servisi şu anda kullanılamıyor. Lütfen kısa süre sonra tekrar deneyin veya destek ekibimizle iletişime geçin.',
        }
      }
    }

    const payload: SignupOtpPayload = {
      name: rawName,
      businessName: rawBusinessName,
      email: cleanEmail,
      phone: normalizedPhone,
      planId,
      consents: {
        onBilgilendirme: true,
        mesafeliSatis: true,
        iptalIade: true,
        kvkk: true,
      },
      googleSub: onboarding && onboarding.email === cleanEmail ? onboarding.googleSub : null,
      consentTimestamp: new Date().toISOString(),
    }

    await db.insert(authOtpChallenges).values({
      target: normalizedPhone,
      channel: deliveryChannel,
      purpose: 'public_signup',
      codeHash,
      payload,
      attempts: 0,
      expiresAt: new Date(Date.now() + 5 * 60_000),
      ipAddress: ip,
    })

    return {
      ok: true,
      deliveryChannel,
      expiresInSeconds: 300,
      ...(deliveryChannel === 'dev_preview' ? { devOtpCode: code } : {}),
    }
  })

  .post('/signup/verify-otp', async ({ body, cookie, request, set }) => {
    await ensureSubscriptionSchema()
    const b = (body || {}) as Record<string, any>
    const code = String(b.code || '').trim()
    if (!/^\d{6}$/.test(code)) {
      set.status = 400
      return { error: '6 haneli doğrulama kodunu girin.' }
    }

    const normalizedPhone = b.phone ? normalizeTurkishMobilePhone(b.phone) : null
    const cleanEmail = b.email ? String(b.email).trim().toLowerCase() : ''

    if (!normalizedPhone && !cleanEmail) {
      set.status = 400
      return { error: 'Telefon numarası veya e-posta adresi gerekli.' }
    }

    const targetCondition = normalizedPhone
      ? eq(authOtpChallenges.target, normalizedPhone)
      : sql`${authOtpChallenges.payload}->>'email' = ${cleanEmail}`

    const [challenge] = await db
      .select()
      .from(authOtpChallenges)
      .where(
        and(
          eq(authOtpChallenges.purpose, 'public_signup'),
          isNull(authOtpChallenges.consumedAt),
          targetCondition,
        ),
      )
      .orderBy(desc(authOtpChallenges.createdAt))
      .limit(1)

    const now = new Date()
    if (!challenge || challenge.expiresAt <= now) {
      set.status = 400
      return { error: 'Doğrulama kodunun süresi dolmuş veya geçersiz. Lütfen yeni kod isteyin.' }
    }

    if (challenge.attempts >= 5) {
      set.status = 429
      return { error: 'Maksimum deneme hakkı aşıldı. Lütfen yeni doğrulama kodu isteyin.' }
    }

    const nextAttempts = challenge.attempts + 1
    await db
      .update(authOtpChallenges)
      .set({ attempts: nextAttempts })
      .where(eq(authOtpChallenges.id, challenge.id))

    if (!verifyOtpHashConstantTime(code, challenge.codeHash)) {
      set.status = 400
      return { error: 'Doğrulama kodu hatalı.' }
    }

    const payload = challenge.payload as SignupOtpPayload | null
    if (!payload?.email || !payload?.phone || !payload?.businessName) {
      set.status = 400
      return { error: 'Kayıt oturumu geçersiz. Lütfen formu yeniden doldurun.' }
    }

    if (cleanEmail && cleanEmail !== payload.email.toLowerCase()) {
      set.status = 400
      return { error: 'E-posta adresi doğrulama talebiyle eşleşmiyor.' }
    }

    const onboarding = await verifyGoogleOnboardingToken(
      cookie.google_onboarding?.value as string | undefined,
    )
    const matchedGoogle =
      onboarding && onboarding.email.toLowerCase() === payload.email.toLowerCase()
        ? onboarding
        : null
    const effectiveGoogleSub = matchedGoogle?.googleSub || payload.googleSub || null

    const rawPassword = typeof b.password === 'string' ? b.password : ''
    if (!effectiveGoogleSub && rawPassword.length < 6) {
      set.status = 400
      return { error: 'Şifreniz en az 6 karakter olmalıdır.' }
    }
    if (effectiveGoogleSub && rawPassword.length > 0 && rawPassword.length < 6) {
      set.status = 400
      return { error: 'Şifreniz en az 6 karakter olmalıdır.' }
    }

    const passwordHash = await Bun.password.hash(
      rawPassword.length >= 6 ? rawPassword : randomBytes(24).toString('base64url'),
    )

    const phoneLast10 = payload.phone.slice(-10)
    const accountCheck = await findConflictingSignupAccount({
      cleanEmail: payload.email.toLowerCase(),
      phoneLast10,
      allowedUnattachedEmail: effectiveGoogleSub ? payload.email : null,
      allowedGoogleSub: effectiveGoogleSub,
    })
    if (accountCheck.conflict) {
      set.status = 409
      return {
        error:
          'Bu telefon numarası veya e-posta adresi ile kayıtlı bir işletme hesabı zaten mevcut. Lütfen giriş yapın.',
      }
    }

    const ip = requestIp(request)
    const trialEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const slugBase = slugifyBusinessName(payload.businessName)

    let provisioned: { userId: string; clinicId: string; hostname: string }
    try {
      provisioned = await db.transaction(async (tx) => {
        const [consumed] = await tx
          .update(authOtpChallenges)
          .set({ consumedAt: now })
          .where(and(eq(authOtpChallenges.id, challenge.id), isNull(authOtpChallenges.consumedAt)))
          .returning({ id: authOtpChallenges.id })

        if (!consumed) {
          throw new Error('OTP_ALREADY_CONSUMED')
        }

        let userId: string
        if (accountCheck.unattachedUserId) {
          const [updatedUser] = await tx
            .update(users)
            .set({
              name: payload.name,
              phone: payload.phone,
              passwordHash,
              role: 'yonetici',
              active: true,
              googleSub: effectiveGoogleSub,
              phoneVerifiedAt: now,
              emailVerifiedAt: effectiveGoogleSub || challenge.channel === 'email' ? now : null,
              lastLoginAt: now,
              updatedAt: now,
            })
            .where(eq(users.id, accountCheck.unattachedUserId))
            .returning({ id: users.id })
          userId = updatedUser!.id
        } else {
          const [createdUser] = await tx
            .insert(users)
            .values({
              email: payload.email.toLowerCase(),
              phone: payload.phone,
              passwordHash,
              name: payload.name,
              role: 'yonetici',
              active: true,
              isPlatformAdmin: false,
              googleSub: effectiveGoogleSub,
              phoneVerifiedAt: now,
              emailVerifiedAt: effectiveGoogleSub || challenge.channel === 'email' ? now : null,
              lastLoginAt: now,
            })
            .returning({ id: users.id })
          userId = createdUser!.id
        }

        const [clinic] = await tx
          .insert(clinics)
          .values({
            name: payload.businessName,
            businessTemplate: 'general',
            isActive: true,
            planId: 'demo',
            planStatus: 'trial',
            trialEndsAt,
            maxUsers: 2,
          })
          .returning({ id: clinics.id })

        const clinicId = clinic!.id

        let generatedHostname = `${slugBase}-${randomBytes(3).toString('hex')}.axamaz.com`
        for (let attempt = 0; attempt < 5; attempt++) {
          const [dup] = await tx
            .select({ id: clinicDomains.id })
            .from(clinicDomains)
            .where(eq(clinicDomains.hostname, generatedHostname))
            .limit(1)
          if (!dup) break
          generatedHostname = `${slugBase}-${randomBytes(4).toString('hex')}.axamaz.com`
        }

        await tx.insert(clinicDomains).values({
          clinicId,
          hostname: generatedHostname,
          isPrimary: true,
          isActive: true,
        })

        await tx.insert(clinicMemberships).values({
          clinicId,
          userId,
          role: 'yonetici',
          active: true,
        })

        const categories = DEFAULT_NEUTRAL_CATEGORIES.length > 0 ? DEFAULT_NEUTRAL_CATEGORIES : DEFAULT_CATEGORIES
        await tx
          .insert(knowledgeCategories)
          .values(categories.map((cat) => ({ ...cat, clinicId })))
          .onConflictDoNothing()

        await tx
          .insert(clinicSettings)
          .values([
            { clinicId, key: 'branding.title', value: payload.businessName },
            { clinicId, key: 'branding.subtitle', value: 'Randevu · Bilgi' },
            { clinicId, key: 'clinic.timezone', value: 'Europe/Istanbul' },
            {
              clinicId,
              key: 'ai.greeting',
              value: `Merhaba, ${payload.businessName} asistanına hoş geldiniz. Size nasıl yardımcı olabilirim?`,
            },
            {
              clinicId,
              key: 'greeting_message',
              value: `Merhaba, ${payload.businessName} asistanına hoş geldiniz. Size nasıl yardımcı olabilirim?`,
            },
            { clinicId, key: 'ai.greeting_outbound', value: `Merhaba, ben ${payload.businessName} asistanıyım.` },
            {
              clinicId,
              key: 'greeting_message_outbound',
              value: `Merhaba, ben ${payload.businessName} asistanıyım.`,
            },
            { clinicId, key: 'role_tab_permissions', value: JSON.stringify(DEFAULT_ROLE_PERMISSIONS) },
          ])
          .onConflictDoNothing()

        const defaultWebFlow = buildDefaultWebFlow()
        await tx.insert(conversationFlows).values({
          clinicId,
          name: defaultWebFlow.name,
          direction: 'web',
          isActive: true,
          nodes: defaultWebFlow.nodes,
          edges: defaultWebFlow.edges,
        })

        await tx.insert(auditLog).values({
          clinicId,
          userId,
          action: 'public.signup.complete',
          targetType: 'clinic',
          targetId: clinicId,
          ipAddress: ip,
          metadata: {
            consents: payload.consents,
            consentTimestamp: payload.consentTimestamp,
            ip,
            planId: payload.planId,
            verifiedViaOtp: true,
            deliveryChannel: challenge.channel,
            googleLinked: Boolean(effectiveGoogleSub),
          },
        })

        return { userId, clinicId, hostname: generatedHostname }
      })
    } catch (err: any) {
      if (err?.message === 'OTP_ALREADY_CONSUMED') {
        set.status = 400
        return { error: 'Bu doğrulama kodu zaten kullanıldı.' }
      }
      if (/unique|duplicate/i.test(String(err?.message || ''))) {
        set.status = 409
        return {
          error:
            'Bu telefon numarası veya e-posta adresi ile kayıtlı bir işletme hesabı zaten mevcut. Lütfen giriş yapın.',
        }
      }
      console.error('[PublicOnboarding] Kayıt hatası:', err)
      set.status = 500
      return { error: 'Hesap oluşturulurken beklenmeyen bir hata oluştu.' }
    }

    invalidateTenantCache(provisioned.hostname)
    registerAllowedTenantHostname(provisioned.hostname)

    const jti = randomUUID()
    const sessionExpiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000)
    await createSession({
      userId: provisioned.userId,
      tokenJti: jti,
      ipAddress: ip,
      userAgent: request.headers.get('user-agent') || undefined,
      expiresAt: sessionExpiresAt,
    })

    const token = await signToken(
      { id: provisioned.userId, role: 'yonetici', clinicId: provisioned.clinicId },
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

    return {
      ok: true,
      clinicId: provisioned.clinicId,
      planId: 'demo',
      redirectTo: payload.planId === 'pro' ? '/panel?tab=integrations&upgrade=pro' : '/panel',
    }
  })

  .post('/leads', async ({ body, request, set }) => {
    await ensureSubscriptionSchema()
    const ip = requestIp(request)
    if (!checkLeadRateLimit(ip)) {
      set.status = 429
      return { error: 'Çok fazla talep gönderildi. Lütfen birkaç dakika sonra tekrar deneyin.' }
    }

    const b = (body || {}) as Record<string, unknown>
    const companyName = String(b.companyName || '').trim().slice(0, 160)
    const contactName = String(b.contactName || '').trim().slice(0, 120)
    const contactEmail = String(b.contactEmail || '').trim().toLowerCase().slice(0, 160)
    const contactPhone = b.contactPhone ? String(b.contactPhone).trim().slice(0, 40) : null
    const notes = b.notes ? String(b.notes).trim().slice(0, 2000) : null
    const requestType = b.requestType === 'pro_upgrade' ? 'pro_upgrade' : 'kurumsal_lead'
    const requestedPlan = requestType === 'pro_upgrade' ? 'pro' : 'kurumsal'

    if (companyName.length < 2) {
      set.status = 400
      return { error: 'Firma / kurum adı en az 2 karakter olmalıdır.' }
    }
    if (contactName.length < 2) {
      set.status = 400
      return { error: 'Yetkili ad soyad en az 2 karakter olmalıdır.' }
    }
    if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      set.status = 400
      return { error: 'Geçerli bir kurumsal e-posta adresi girin.' }
    }

    const [created] = await db
      .insert(upgradeRequests)
      .values({
        clinicId: null,
        requestedBy: null,
        requestType,
        requestedPlan,
        companyName,
        contactName,
        contactEmail,
        contactPhone,
        notes,
        status: 'pending',
      })
      .returning({ id: upgradeRequests.id })

    return { ok: true, id: created!.id }
  })
