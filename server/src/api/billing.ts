import { Elysia } from 'elysia'
import { randomBytes } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { auditLog, clinics, subscriptionPayments, upgradeRequests, users } from '../db/schema'
import { authenticateRequest } from '../middleware/auth'
import {
  initializeCheckoutForm,
  isIyzicoConfigured,
  resolveIyzicoBuyerIdentityNumber,
  retrieveCheckoutForm,
} from '../services/iyzico'
import { ensureSubscriptionSchema, getClinicEntitlements } from '../services/subscriptions'
import { hostnameFromRequest, invalidateTenantCache, isLocalHostname } from '../tenancy/context'

const ALLOWED_REQUEST_TYPES = new Set([
  'pro_upgrade',
  'whatsapp',
  'inbound_call',
  'outbound_call',
  'kurumsal_lead',
])

function requestIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1'
}

function resolveIyzicoCallbackUrl(request: Request): string {
  const configured = (process.env.IYZICO_CALLBACK_URL || '').trim()
  if (configured) return configured

  const hostname = hostnameFromRequest(request)
  if (hostname) {
    if (isLocalHostname(hostname)) {
      const rawHost =
        request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
        request.headers.get('host')?.split(',')[0]?.trim() ||
        ''
      if (rawHost && (rawHost.startsWith('localhost') || rawHost.startsWith('127.0.0.1'))) {
        return `http://${rawHost}/api/billing/iyzico/callback`
      }
      const clientFallback = (process.env.CLIENT_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
      return `${clientFallback}/api/billing/iyzico/callback`
    }
    const proto =
      request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase() || 'https'
    return `${proto}://${hostname}/api/billing/iyzico/callback`
  }

  const base = (process.env.CLIENT_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return `${base}/api/billing/iyzico/callback`
}

function redirect303(set: any, location: string) {
  set.status = 303
  set.headers['location'] = location
  return ''
}

function extractCallbackToken(body: unknown, query: Record<string, unknown> | undefined): string {
  if (body && typeof body === 'object' && 'token' in body && typeof (body as any).token === 'string') {
    return (body as any).token.trim()
  }
  if (typeof body === 'string' && body.length > 0) {
    try {
      const parsed = JSON.parse(body)
      if (typeof parsed?.token === 'string') return parsed.token.trim()
    } catch {
      const params = new URLSearchParams(body)
      const t = params.get('token')
      if (t) return t.trim()
    }
  }
  if (query && typeof query.token === 'string') {
    return query.token.trim()
  }
  return ''
}

async function processIyzicoCallback(token: string, set: any) {
  if (!token) {
    return redirect303(set, '/panel?tab=integrations&payment=failed')
  }

  await ensureSubscriptionSchema()
  const [paymentRow] = await db
    .select()
    .from(subscriptionPayments)
    .where(eq(subscriptionPayments.token, token))
    .limit(1)

  if (!paymentRow) {
    return redirect303(set, '/panel?tab=integrations&payment=failed')
  }

  if (paymentRow.status === 'succeeded') {
    return redirect303(set, '/panel?tab=integrations&payment=success')
  }

  if (!isIyzicoConfigured()) {
    return redirect303(set, '/panel?tab=integrations&payment=failed')
  }

  try {
    const detail = await retrieveCheckoutForm(token, paymentRow.conversationId)
    const isSuccess =
      String(detail.status || '').toLowerCase() === 'success' &&
      String(detail.paymentStatus || '').toUpperCase() === 'SUCCESS'

    const now = new Date()
    if (isSuccess) {
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      const paymentId = detail.paymentId !== undefined ? String(detail.paymentId) : null

      await db.transaction(async (tx) => {
        await tx
          .update(subscriptionPayments)
          .set({
            status: 'succeeded',
            paymentId,
            rawEvent: detail as Record<string, unknown>,
            updatedAt: now,
          })
          .where(eq(subscriptionPayments.id, paymentRow.id))

        await tx
          .update(clinics)
          .set({
            planId: 'pro',
            planStatus: 'active',
            maxUsers: 10,
            currentPeriodEnd: periodEnd,
          })
          .where(eq(clinics.id, paymentRow.clinicId))

        await tx.insert(auditLog).values({
          clinicId: paymentRow.clinicId,
          userId: paymentRow.userId,
          action: 'billing.iyzico.payment_succeeded',
          targetType: 'subscription_payment',
          targetId: paymentRow.id,
          metadata: {
            planId: 'pro',
            paymentId,
            amountGross: paymentRow.amountGross,
            conversationId: paymentRow.conversationId,
          },
        })
      })

      invalidateTenantCache()
      return redirect303(set, '/panel?tab=integrations&payment=success')
    }

    await db
      .update(subscriptionPayments)
      .set({
        status: 'failed',
        rawEvent: detail as Record<string, unknown>,
        updatedAt: now,
      })
      .where(eq(subscriptionPayments.id, paymentRow.id))

    await db.insert(auditLog).values({
      clinicId: paymentRow.clinicId,
      userId: paymentRow.userId,
      action: 'billing.iyzico.payment_failed',
      targetType: 'subscription_payment',
      targetId: paymentRow.id,
      metadata: {
        errorCode: detail.errorCode ?? null,
        errorMessage: detail.errorMessage ?? null,
        paymentStatus: detail.paymentStatus ?? null,
      },
    })

    return redirect303(set, '/panel?tab=integrations&payment=failed')
  } catch (err) {
    console.error('[Billing] iyzico callback doğrulama hatası:', err)
    return redirect303(set, '/panel?tab=integrations&payment=failed')
  }
}

export const billingPlugin = new Elysia({ prefix: '/api/billing' })
  .get('/subscription', async ({ cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }

    await ensureSubscriptionSchema()
    const [entitlements, clinicRequests, clinicPayments] = await Promise.all([
      getClinicEntitlements(user.clinicId),
      db
        .select()
        .from(upgradeRequests)
        .where(eq(upgradeRequests.clinicId, user.clinicId))
        .orderBy(desc(upgradeRequests.createdAt))
        .limit(30),
      db
        .select({
          id: subscriptionPayments.id,
          planId: subscriptionPayments.planId,
          provider: subscriptionPayments.provider,
          conversationId: subscriptionPayments.conversationId,
          paymentId: subscriptionPayments.paymentId,
          amountNet: subscriptionPayments.amountNet,
          vatRate: subscriptionPayments.vatRate,
          amountGross: subscriptionPayments.amountGross,
          currency: subscriptionPayments.currency,
          status: subscriptionPayments.status,
          createdAt: subscriptionPayments.createdAt,
        })
        .from(subscriptionPayments)
        .where(eq(subscriptionPayments.clinicId, user.clinicId))
        .orderBy(desc(subscriptionPayments.createdAt))
        .limit(30),
    ])

    return {
      entitlements,
      requests: clinicRequests,
      payments: clinicPayments,
      iyzicoConfigured: isIyzicoConfigured(),
    }
  })

  .post('/upgrade-request', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }

    await ensureSubscriptionSchema()
    const b = (body || {}) as Record<string, unknown>
    const requestType = String(b.requestType || 'pro_upgrade').trim()
    if (!ALLOWED_REQUEST_TYPES.has(requestType)) {
      set.status = 400
      return { error: 'Geçersiz başvuru türü.' }
    }

    const requestedPlan =
      b.requestedPlan === 'kurumsal' || requestType === 'kurumsal_lead' ? 'kurumsal' : 'pro'
    const notes = b.notes ? String(b.notes).trim().slice(0, 2000) : null

    const [[dbUser], [clinicRow]] = await Promise.all([
      db.select().from(users).where(eq(users.id, user.id)).limit(1),
      db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, user.clinicId)).limit(1),
    ])

    const contactPhone = b.contactPhone
      ? String(b.contactPhone).trim().slice(0, 40)
      : dbUser?.phone || null

    const [created] = await db
      .insert(upgradeRequests)
      .values({
        clinicId: user.clinicId,
        requestedBy: user.id,
        requestType,
        requestedPlan,
        contactName: dbUser?.name || user.name,
        contactEmail: dbUser?.email || user.email,
        contactPhone,
        companyName: clinicRow?.name || null,
        notes,
        status: 'pending',
      })
      .returning()

    await db.insert(auditLog).values({
      clinicId: user.clinicId,
      userId: user.id,
      action: 'billing.upgrade_request.create',
      targetType: 'upgrade_request',
      targetId: created!.id,
      ipAddress: requestIp(request),
      metadata: { requestType, requestedPlan },
    })

    return { ok: true, request: created }
  })

  .post('/iyzico/checkout-initialize', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    if (user.role !== 'yonetici') {
      set.status = 403
      return { error: 'Online abonelik ödemesi yalnızca işletme yöneticisi tarafından başlatılabilir.' }
    }

    await ensureSubscriptionSchema()
    const b = (body || {}) as Record<string, any>
    const consents = (b.consents || {}) as Record<string, unknown>

    if (
      consents.onBilgilendirme !== true ||
      consents.mesafeliSatis !== true ||
      consents.iptalIade !== true ||
      consents.kvkk !== true
    ) {
      set.status = 400
      return {
        error:
          'Ödeme adımına geçebilmek için Ön Bilgilendirme Formu, Mesafeli Satış Sözleşmesi, İptal ve İade Koşulları ve KVKK Aydınlatma Metni onaylarını işaretlemelisiniz.',
      }
    }

    const buyerInput = (b.buyer && typeof b.buyer === 'object' ? b.buyer : b) as Record<string, unknown>
    const fullName = String(buyerInput.name ?? user.name ?? '').trim()
    const email = String(buyerInput.email ?? user.email ?? '').trim().toLowerCase()
    const phone = String(buyerInput.phone ?? '').trim()
    const identityOrTaxNumber = String(
      buyerInput.identityOrTaxNumber ?? buyerInput.identityNumber ?? buyerInput.taxNumber ?? '',
    ).trim()
    const address = String(buyerInput.address ?? '').trim()
    const city = String(buyerInput.city ?? '').trim()

    if (fullName.length < 2) {
      set.status = 400
      return { error: 'Fatura / alıcı ad soyad bilgisi zorunludur.' }
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      set.status = 400
      return { error: 'Geçerli bir fatura e-posta adresi girin.' }
    }
    if (phone.replace(/\D/g, '').length < 10) {
      set.status = 400
      return { error: 'Geçerli bir cep telefonu numarası girin.' }
    }
    const identityCheck = resolveIyzicoBuyerIdentityNumber(identityOrTaxNumber)
    if (!identityCheck.valid) {
      set.status = 400
      return {
        error: 'Geçerli bir 11 haneli T.C. Kimlik Numarası veya 10 haneli Vergi Kimlik Numarası (VKN) girin.',
      }
    }
    if (address.length < 5) {
      set.status = 400
      return { error: 'Fatura adresi en az 5 karakter olmalıdır.' }
    }
    if (city.length < 2) {
      set.status = 400
      return { error: 'Şehir bilgisi zorunludur.' }
    }

    const ip = requestIp(request)
    const userAgent = request.headers.get('user-agent') || null
    const conversationId = `axamaz_${user.clinicId.replace(/-/g, '').slice(0, 8)}_${Date.now()}_${randomBytes(3).toString('hex')}`
    const configured = isIyzicoConfigured()

    const consentsSnapshot = {
      acceptedAt: new Date().toISOString(),
      ipAddress: ip,
      userAgent,
      consents: {
        onBilgilendirme: true,
        mesafeliSatis: true,
        iptalIade: true,
        kvkk: true,
      },
      buyer: {
        name: fullName,
        email,
        phone,
        identityKind: identityCheck.kind,
        identityLast4: identityCheck.normalizedInput.slice(-4),
        address,
        city,
        taxOffice: typeof buyerInput.taxOffice === 'string' ? buyerInput.taxOffice.trim() : null,
        companyName: typeof buyerInput.companyName === 'string' ? buyerInput.companyName.trim() : null,
      },
    }

    const [paymentRow] = await db
      .insert(subscriptionPayments)
      .values({
        clinicId: user.clinicId,
        userId: user.id,
        planId: 'pro',
        provider: 'iyzico',
        conversationId,
        amountNet: 7000,
        vatRate: 20,
        amountGross: 8400,
        currency: 'TRY',
        status: configured ? 'initiated' : 'failed',
        consentsSnapshot,
      })
      .returning()

    if (!configured) {
      set.status = 503
      return {
        error:
          'Online ödeme sanal POS aktivasyonu bekleniyor. Dilerseniz tek tıkla satış ekibine Pro geçiş başvurusu iletebilirsiniz.',
        code: 'IYZICO_NOT_CONFIGURED',
      }
    }

    const callbackUrl = resolveIyzicoCallbackUrl(request)
    try {
      const iyzicoRes = await initializeCheckoutForm({
        conversationId,
        basketId: `BASKET_${paymentRow!.id.slice(0, 12)}`,
        callbackUrl,
        buyer: {
          clinicId: user.clinicId,
          fullName,
          email,
          phone,
          identityOrTaxNumber,
          address,
          city,
          ipAddress: ip,
        },
      })

      if (String(iyzicoRes.status || '').toLowerCase() !== 'success' || !iyzicoRes.token) {
        await db
          .update(subscriptionPayments)
          .set({
            status: 'failed',
            rawEvent: iyzicoRes as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          })
          .where(eq(subscriptionPayments.id, paymentRow!.id))

        set.status = 502
        return {
          error: iyzicoRes.errorMessage || 'iyzico ödeme formu başlatılamadı.',
          code: iyzicoRes.errorCode || 'IYZICO_INIT_FAILED',
        }
      }

      await db
        .update(subscriptionPayments)
        .set({
          token: iyzicoRes.token,
          rawEvent: {
            status: iyzicoRes.status,
            tokenExpireTime: iyzicoRes.tokenExpireTime ?? null,
            paymentPageUrl: iyzicoRes.paymentPageUrl ?? null,
          },
          updatedAt: new Date(),
        })
        .where(eq(subscriptionPayments.id, paymentRow!.id))

      return {
        ok: true,
        paymentPageUrl: iyzicoRes.paymentPageUrl || null,
        checkoutFormContent: iyzicoRes.checkoutFormContent || null,
        token: iyzicoRes.token,
        conversationId,
      }
    } catch (err: any) {
      await db
        .update(subscriptionPayments)
        .set({
          status: 'failed',
          rawEvent: { error: err?.message || 'network_error' },
          updatedAt: new Date(),
        })
        .where(eq(subscriptionPayments.id, paymentRow!.id))

      set.status = 502
      return { error: err?.message || 'Ödeme sağlayıcısına ulaşılamadı.' }
    }
  })

  .post('/iyzico/callback', async ({ body, query, set }) => {
    const token = extractCallbackToken(body, query as Record<string, unknown>)
    return processIyzicoCallback(token, set)
  })

  .get('/iyzico/callback', async ({ query, set }) => {
    const token = extractCallbackToken(null, query as Record<string, unknown>)
    return processIyzicoCallback(token, set)
  })

  .post('/cancel', async ({ cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    if (user.role !== 'yonetici') {
      set.status = 403
      return { error: 'Abonelik iptali yalnızca işletme yöneticisi tarafından yapılabilir.' }
    }

    await ensureSubscriptionSchema()
    await db
      .update(clinics)
      .set({ planStatus: 'canceled' })
      .where(eq(clinics.id, user.clinicId))

    await db.insert(auditLog).values({
      clinicId: user.clinicId,
      userId: user.id,
      action: 'billing.subscription.cancel',
      targetType: 'clinic',
      targetId: user.clinicId,
      ipAddress: requestIp(request),
    })

    invalidateTenantCache()
    return { ok: true }
  })
