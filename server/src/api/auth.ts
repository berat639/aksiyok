import { Elysia } from 'elysia'
import { randomUUID } from 'crypto'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { clinicMemberships, clinics } from '../db/schema'
import { getUserByEmail, createSession, deleteSessionByJti, updateUser } from '../db/repositories/users'
import { signToken, authenticateRequest } from '../middleware/auth'
import { ensurePlatformAdminMembership, getActiveMembership } from '../db/repositories/tenancy'
import {
  currentTenant,
  getTenantByClinicId,
  hostnameFromRequest,
  isSharedAppHostname,
  resolveTenantFromRequest,
  setRequestTenant,
} from '../tenancy/context'
import { canManagePlatform } from '../platform/access'
import { getClinicEntitlements } from '../services/subscriptions'

export const authPlugin = new Elysia({ prefix: '/api/auth' })

  .post('/login', async ({ body, set, cookie, request }) => {
    const { email, password, clinicId: requestedClinicId } = body as {
      email: string
      password: string
      clinicId?: string
    }
    if (!email || !password) { set.status = 400; return { error: 'Email ve şifre gerekli' } }

    const user = await getUserByEmail(email.toLowerCase().trim())
    if (!user || !user.active) { set.status = 401; return { error: 'Geçersiz kimlik bilgileri' } }

    const valid = await Bun.password.verify(password, user.passwordHash)
    if (!valid) { set.status = 401; return { error: 'Geçersiz kimlik bilgileri' } }

    const reqHost = hostnameFromRequest(request)
    let tenant = await resolveTenantFromRequest(request)
    let membership: { clinicId: string; userId: string; role: string; active: boolean } | null = null

    if (isSharedAppHostname(reqHost) || !tenant) {
      const userClinics = await db
        .select({
          clinicId: clinics.id,
          isActive: clinics.isActive,
          role: clinicMemberships.role,
          active: clinicMemberships.active,
          createdAt: clinicMemberships.createdAt,
        })
        .from(clinicMemberships)
        .innerJoin(clinics, eq(clinicMemberships.clinicId, clinics.id))
        .where(and(eq(clinicMemberships.userId, user.id), eq(clinicMemberships.active, true)))
        .orderBy(desc(clinics.isActive), desc(clinicMemberships.createdAt))

      if (requestedClinicId) {
        const matched = userClinics.find((m) => m.clinicId === requestedClinicId)
        if (matched) {
          membership = {
            clinicId: matched.clinicId,
            userId: user.id,
            role: matched.role,
            active: matched.active,
          }
          tenant = await getTenantByClinicId(matched.clinicId, reqHost)
        } else if (user.isPlatformAdmin) {
          const targetTenant = await getTenantByClinicId(requestedClinicId, reqHost)
          if (targetTenant) {
            membership = await ensurePlatformAdminMembership(user.id, requestedClinicId)
            tenant = targetTenant
          }
        }
      } else if (user.isPlatformAdmin && tenant) {
        const defaultMatch = userClinics.find((m) => m.clinicId === tenant!.clinicId)
        membership = defaultMatch
          ? {
              clinicId: defaultMatch.clinicId,
              userId: user.id,
              role: defaultMatch.role,
              active: defaultMatch.active,
            }
          : await ensurePlatformAdminMembership(user.id, tenant.clinicId)
      } else {
        const chosen = userClinics.find((m) => m.isActive) ?? userClinics[0]
        if (chosen) {
          membership = {
            clinicId: chosen.clinicId,
            userId: user.id,
            role: chosen.role,
            active: chosen.active,
          }
          tenant = await getTenantByClinicId(chosen.clinicId, reqHost)
        }
      }

      if (tenant) {
        setRequestTenant(request, tenant)
      }
    } else {
      const existingMembership = await getActiveMembership(user.id, tenant.clinicId)
      membership =
        existingMembership ??
        (user.isPlatformAdmin ? await ensurePlatformAdminMembership(user.id, tenant.clinicId) : null)
    }

    if (!tenant) {
      set.status = 404
      return { error: 'Bu alan adı için aktif işletme bulunamadı. İşletmeler platform panelinden oluşturulmalıdır.' }
    }
    if (tenant.isActive === false && !user.isPlatformAdmin) {
      set.status = 403
      return { error: 'Bu işletme şu anda dondurulmuştur (askıya alınmıştır). Giriş yapılamaz.' }
    }
    if (!membership) {
      set.status = 403
      return { error: 'Bu işletme için erişim yetkiniz yok' }
    }

    const jti = randomUUID()
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000)

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
    const ua = request.headers.get('user-agent') || undefined

    await createSession({ userId: user.id, tokenJti: jti, ipAddress: ip, userAgent: ua, expiresAt })
    const token = await signToken({ id: user.id, role: membership.role, clinicId: tenant.clinicId }, jti)

    await updateUser(user.id, { lastLoginAt: new Date() })

    cookie.token.set({
      value: token,
      httpOnly: true,
      secure: request.headers.get('x-forwarded-proto') === 'https',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60,
      path: '/',
    })

    const plan = await getClinicEntitlements(tenant.clinicId)

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: membership.role,
      clinicId: tenant.clinicId,
      hostname: tenant.hostname,
      businessTemplate: tenant.businessTemplate ?? 'general',
      isPlatformAdmin: user.isPlatformAdmin,
      canManagePlatform: canManagePlatform(user, request),
      plan,
    }
  })

  .post('/logout', async ({ cookie, set }) => {
    const token = ((cookie.token?.value as string | undefined) as string | undefined)
    if (!token) { set.status = 200; return { ok: true } }

    const { verifyToken } = await import('../middleware/auth')
    const payload = await verifyToken(token)
    if (payload) await deleteSessionByJti(payload.jti)

    cookie.token.set({ value: '', maxAge: 0, path: '/' })
    return { ok: true }
  })

  .get('/me', async ({ cookie, set, request }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!user) { set.status = 401; return { error: 'Oturum geçersiz' } }
    const tenant = currentTenant() ?? (await getTenantByClinicId(user.clinicId, hostnameFromRequest(request)))
    if (tenant?.isActive === false && !user.isPlatformAdmin) {
      set.status = 403
      return { error: 'Bu işletme şu anda dondurulmuştur (askıya alınmıştır).' }
    }
    const plan = await getClinicEntitlements(user.clinicId)
    return {
      ...user,
      businessTemplate: tenant?.businessTemplate ?? 'general',
      plan,
    }
  })

  .put('/password', async ({ body, cookie, set, request }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!user) { set.status = 401; return { error: 'Oturum geçersiz' } }

    const { currentPassword, newPassword } = body as { currentPassword: string; newPassword: string }
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      set.status = 400; return { error: 'Yeni şifre en az 6 karakter olmalı' }
    }

    const dbUser = await getUserByEmail(user.email)
    if (!dbUser) { set.status = 401; return { error: 'Kullanıcı bulunamadı' } }

    const valid = await Bun.password.verify(currentPassword, dbUser.passwordHash)
    if (!valid) { set.status = 401; return { error: 'Mevcut şifre yanlış' } }

    const newHash = await Bun.password.hash(newPassword)
    await updateUser(user.id, { passwordHash: newHash })
    return { ok: true }
  })
