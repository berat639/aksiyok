import { Elysia } from 'elysia'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { auditLog, clinicFinanceSettings, onlinePaymentProviders } from '../db/schema'
import { authenticateRequest } from '../middleware/auth'
import { sealSecret } from '../services/integration-secrets'
import { getClinicEntitlements } from '../services/subscriptions'
import { requireClinicId } from '../tenancy/context'

const SUPPORTED_PAYMENT_PROVIDERS = new Set(['iyzico', 'paytr', 'stripe'])
let financeSchemaPromise: Promise<void> | null = null

/** Keeps finance integration routes available if a container starts before the migration step finishes. */
export function ensureFinanceSchema(): Promise<void> {
  if (!financeSchemaPromise) financeSchemaPromise = (async () => {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS clinic_finance_settings (clinic_id UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE, legal_name TEXT, tax_number TEXT, tax_office TEXT, mersis_number TEXT, address TEXT, email TEXT, invoice_prefix TEXT NOT NULL DEFAULT 'FTR', e_document_provider TEXT NOT NULL DEFAULT 'none', updated_at TIMESTAMPTZ DEFAULT now())`)
    await db.execute(sql`CREATE TABLE IF NOT EXISTS online_payment_providers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE, provider TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT false, merchant_id TEXT, api_key_encrypted TEXT, secret_encrypted TEXT, webhook_secret_encrypted TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`)
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS online_payment_providers_clinic_provider_idx ON online_payment_providers (clinic_id, provider)`)
  })().catch(error => { financeSchemaPromise = null; throw error })
  return financeSchemaPromise
}

async function financeUser(cookie: any, set: any, request?: Request) {
  const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
  if (!user) { set.status = 401; return null }
  if (user.role !== 'yonetici') { set.status = 403; return null }
  return user
}

async function checkFinanceModuleAccess(user: { isPlatformAdmin: boolean }, set: any) {
  if (user.isPlatformAdmin) return null
  const plan = await getClinicEntitlements(requireClinicId())
  if (!plan.features.financeModule) {
    set.status = 403
    return {
      error: 'Ödemeler ve finans modülü Pro ve Kurumsal paketlerde aktiftir.',
      upgradeRequired: true,
      requiredPlan: 'pro',
    }
  }
  return null
}

function safePrefix(value: unknown) {
  const prefix = String(value || 'FTR').toLocaleUpperCase('tr-TR').replace(/[^A-Z0-9]/g, '').slice(0, 12)
  return prefix || 'FTR'
}

/**
 * Finance data model and accountant export surface. It deliberately stops at
 * "draft / ready_for_provider": issuing an e-Invoice/e-Archive requires a
 * contracted integrator and legal verification, neither of which is guessed.
 */
export const financePlugin = new Elysia({ prefix: '/api/finance' })
  .onStart(async () => { await ensureFinanceSchema() })
  .get('/settings', async ({ cookie, set, request }) => {
    const user = await financeUser(cookie, set, request)
    if (!user) return { error: 'Yetki yok' }
    const denied = await checkFinanceModuleAccess(user, set)
    if (denied) return denied
    const [settings] = await db.select().from(clinicFinanceSettings)
      .where(eq(clinicFinanceSettings.clinicId, requireClinicId()))
    return settings ?? {
      legalName: null, taxNumber: null, taxOffice: null, mersisNumber: null,
      address: null, email: null, invoicePrefix: 'FTR', eDocumentProvider: 'none',
    }
  })
  .put('/settings', async ({ body, cookie, set, request }) => {
    const user = await financeUser(cookie, set, request)
    if (!user) return { error: 'Yetki yok' }
    const denied = await checkFinanceModuleAccess(user, set)
    if (denied) return denied
    const b = body as Record<string, unknown>
    const clinicId = requireClinicId()
    const values = {
      legalName: typeof b.legalName === 'string' ? b.legalName.trim() || null : null,
      taxNumber: typeof b.taxNumber === 'string' ? b.taxNumber.replace(/\s/g, '') || null : null,
      taxOffice: typeof b.taxOffice === 'string' ? b.taxOffice.trim() || null : null,
      mersisNumber: typeof b.mersisNumber === 'string' ? b.mersisNumber.replace(/\s/g, '') || null : null,
      address: typeof b.address === 'string' ? b.address.trim() || null : null,
      email: typeof b.email === 'string' ? b.email.trim() || null : null,
      invoicePrefix: safePrefix(b.invoicePrefix),
      eDocumentProvider: typeof b.eDocumentProvider === 'string' ? b.eDocumentProvider.slice(0, 40) || 'none' : 'none',
      updatedAt: sql`now()`,
    }
    const [row] = await db.insert(clinicFinanceSettings).values({ clinicId, ...values })
      .onConflictDoUpdate({ target: clinicFinanceSettings.clinicId, set: values }).returning()
    await db.insert(auditLog).values({ clinicId, userId: user.id, action: 'finance.settings.updated', targetType: 'clinic', targetId: clinicId })
    return row
  })
  .get('/online-providers', async ({ cookie, set, request }) => {
    const user = await financeUser(cookie, set, request)
    if (!user) return { error: 'Yetki yok' }
    const denied = await checkFinanceModuleAccess(user, set)
    if (denied) return denied
    const rows = await db.select({
      provider: onlinePaymentProviders.provider,
      enabled: onlinePaymentProviders.enabled,
      merchantId: onlinePaymentProviders.merchantId,
      hasApiKey: sql<boolean>`(${onlinePaymentProviders.apiKeyEncrypted} IS NOT NULL)`,
      hasSecret: sql<boolean>`(${onlinePaymentProviders.secretEncrypted} IS NOT NULL)`,
      hasWebhookSecret: sql<boolean>`(${onlinePaymentProviders.webhookSecretEncrypted} IS NOT NULL)`,
      updatedAt: onlinePaymentProviders.updatedAt,
    }).from(onlinePaymentProviders).where(eq(onlinePaymentProviders.clinicId, requireClinicId()))
    return rows
  })
  .put('/online-providers/:provider', async ({ params, body, cookie, set, request }) => {
    const user = await financeUser(cookie, set, request)
    if (!user) return { error: 'Yetki yok' }
    const denied = await checkFinanceModuleAccess(user, set)
    if (denied) return denied
    const provider = params.provider.toLowerCase()
    if (!SUPPORTED_PAYMENT_PROVIDERS.has(provider)) { set.status = 400; return { error: 'Desteklenen sağlayıcılar: iyzico, paytr, stripe' } }
    const b = body as Record<string, unknown>
    const clinicId = requireClinicId()
    const [current] = await db.select().from(onlinePaymentProviders)
      .where(and(eq(onlinePaymentProviders.clinicId, clinicId), eq(onlinePaymentProviders.provider, provider)))
    try {
      const values = {
        enabled: b.enabled === true,
        merchantId: typeof b.merchantId === 'string' ? b.merchantId.trim() || null : current?.merchantId || null,
        apiKeyEncrypted: typeof b.apiKey === 'string' && b.apiKey ? sealSecret(b.apiKey) : current?.apiKeyEncrypted || null,
        secretEncrypted: typeof b.secret === 'string' && b.secret ? sealSecret(b.secret) : current?.secretEncrypted || null,
        webhookSecretEncrypted: typeof b.webhookSecret === 'string' && b.webhookSecret ? sealSecret(b.webhookSecret) : current?.webhookSecretEncrypted || null,
        updatedAt: sql`now()`,
      }
      const [row] = await db.insert(onlinePaymentProviders).values({ clinicId, provider, ...values })
        .onConflictDoUpdate({ target: [onlinePaymentProviders.clinicId, onlinePaymentProviders.provider], set: values }).returning()
      await db.insert(auditLog).values({ clinicId, userId: user.id, action: 'finance.online_provider.updated', targetType: 'online_payment_provider', targetId: row!.id, metadata: { provider, enabled: values.enabled } })
      return { provider: row!.provider, enabled: row!.enabled, merchantId: row!.merchantId, hasApiKey: !!row!.apiKeyEncrypted, hasSecret: !!row!.secretEncrypted, hasWebhookSecret: !!row!.webhookSecretEncrypted }
    } catch (error: any) {
      set.status = 400
      return { error: error?.message || 'Sağlayıcı ayarı kaydedilemedi' }
    }
  })
