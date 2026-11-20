import { and, eq, gt, sql } from 'drizzle-orm'
import { isIyzicoConfigured } from './iyzico'

export type PlanId = 'demo' | 'pro' | 'kurumsal'
export type PlanStatus = 'trial' | 'active' | 'past_due' | 'canceled' | 'expired'

export interface PlanFeatures {
  webAssistant: boolean
  inboundCalls: boolean
  outboundCalls: boolean
  whatsapp: boolean
  staffModule: boolean
  financeModule: boolean
  inventoryModule: boolean
  vipAssistant: boolean
  customGeminiKey: boolean
}

export interface PlanDefinition {
  id: PlanId
  name: string
  monthlyNetTry: number | null
  vatPercent: number
  monthlyGrossTry: number | null
  trialDays: number
  maxUsers: number
  adminOnlyUsers: boolean
  allowedTabs: string[]
  features: PlanFeatures
  dailyAiCallLimit: number
}

export interface ClinicEntitlements {
  planId: PlanId
  planName: string
  planStatus: PlanStatus
  trialEndsAt: string | null
  trialDaysRemaining: number | null
  currentPeriodEnd: string | null
  maxUsers: number
  activeUsersCount: number
  pendingInvitesCount: number
  adminOnlyUsers: boolean
  isTrialExpired: boolean
  isReadOnly: boolean
  allowedTabs: string[]
  features: PlanFeatures
  dailyAiCallLimit: number
  iyzicoConfigured: boolean
}

export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  demo: {
    id: 'demo',
    name: 'Demo (7 Gün Ücretsiz)',
    monthlyNetTry: 0,
    vatPercent: 20,
    monthlyGrossTry: 0,
    trialDays: 7,
    maxUsers: 2,
    adminOnlyUsers: true,
    allowedTabs: ['calendar', 'patients', 'knowledge', 'integrations'],
    features: {
      webAssistant: true,
      inboundCalls: false,
      outboundCalls: false,
      whatsapp: false,
      staffModule: false,
      financeModule: false,
      inventoryModule: false,
      vipAssistant: false,
      customGeminiKey: false,
    },
    dailyAiCallLimit: 30,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyNetTry: 7000,
    vatPercent: 20,
    monthlyGrossTry: 8400,
    trialDays: 7,
    maxUsers: 10,
    adminOnlyUsers: false,
    allowedTabs: ['calendar', 'patients', 'payments', 'stok', 'knowledge', 'klinik', 'integrations'],
    features: {
      webAssistant: true,
      inboundCalls: true,
      outboundCalls: true,
      whatsapp: true,
      staffModule: true,
      financeModule: true,
      inventoryModule: true,
      vipAssistant: true,
      customGeminiKey: false,
    },
    dailyAiCallLimit: 500,
  },
  kurumsal: {
    id: 'kurumsal',
    name: 'Kurumsal',
    monthlyNetTry: null,
    vatPercent: 20,
    monthlyGrossTry: null,
    trialDays: 0,
    maxUsers: 999,
    adminOnlyUsers: false,
    allowedTabs: ['calendar', 'patients', 'payments', 'stok', 'knowledge', 'klinik', 'integrations', 'vip'],
    features: {
      webAssistant: true,
      inboundCalls: true,
      outboundCalls: true,
      whatsapp: true,
      staffModule: true,
      financeModule: true,
      inventoryModule: true,
      vipAssistant: true,
      customGeminiKey: true,
    },
    dailyAiCallLimit: 10000,
  },
}

export function normalizePlanId(raw: string | null | undefined, fallback: PlanId = 'kurumsal'): PlanId {
  const cleaned = String(raw || '').trim().toLocaleLowerCase('tr-TR')
  if (cleaned === 'baslangic' || cleaned === 'başlangıç' || cleaned === 'başlangiç' || cleaned === 'demo') {
    return 'demo'
  }
  if (cleaned === 'pro') return 'pro'
  if (cleaned === 'kurumsal' || cleaned === 'enterprise') return 'kurumsal'
  return fallback
}

export function normalizePlanStatus(raw: string | null | undefined, fallback: PlanStatus = 'active'): PlanStatus {
  const cleaned = String(raw || '').trim().toLowerCase()
  if (
    cleaned === 'trial' ||
    cleaned === 'active' ||
    cleaned === 'past_due' ||
    cleaned === 'canceled' ||
    cleaned === 'expired'
  ) {
    return cleaned
  }
  return fallback
}

export function normalizeTurkishMobilePhone(raw: string | null | undefined): string | null {
  let digits = String(raw || '').replace(/\D/g, '')
  if (digits.startsWith('0090')) digits = digits.slice(4)
  else if (digits.length === 12 && digits.startsWith('90')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (!/^5\d{9}$/.test(digits)) return null
  return `+90${digits}`
}

// Idempotent DDL statements shared by migrate.ts and ensureSubscriptionSchema().
export const subscriptionDDL: readonly string[] = [
  `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS plan_id TEXT NOT NULL DEFAULT 'kurumsal'`,
  `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS plan_status TEXT NOT NULL DEFAULT 'active'`,
  `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ`,
  `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ`,
  `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT 999`,
  `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS iyzico_subscription_ref TEXT`,
  `ALTER TABLE clinics ADD COLUMN IF NOT EXISTS iyzico_customer_ref TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_uniq ON users (google_sub) WHERE google_sub IS NOT NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`,
  `CREATE TABLE IF NOT EXISTS auth_otp_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target TEXT NOT NULL,
    channel TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    payload JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS auth_otp_challenges_target_purpose_idx
    ON auth_otp_challenges (target, purpose, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    plan_id TEXT,
    redirect_after TEXT,
    code_verifier TEXT,
    ip_address TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS oauth_states_expires_idx ON oauth_states (expires_at)`,
  `CREATE TABLE IF NOT EXISTS upgrade_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    request_type TEXT NOT NULL,
    requested_plan TEXT NOT NULL DEFAULT 'pro',
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    company_name TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    handled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    handled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS upgrade_requests_status_created_idx
    ON upgrade_requests (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS upgrade_requests_clinic_created_idx
    ON upgrade_requests (clinic_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS subscription_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    plan_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'iyzico',
    conversation_id TEXT NOT NULL UNIQUE,
    token TEXT,
    payment_id TEXT,
    amount_net INTEGER NOT NULL,
    vat_rate INTEGER NOT NULL DEFAULT 20,
    amount_gross INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'TRY',
    status TEXT NOT NULL DEFAULT 'initiated',
    consents_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    raw_event JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS subscription_payments_clinic_created_idx
    ON subscription_payments (clinic_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS subscription_payments_token_idx
    ON subscription_payments (token) WHERE token IS NOT NULL`,
]

let subscriptionSchemaPromise: Promise<void> | null = null

export function ensureSubscriptionSchema(): Promise<void> {
  if (!subscriptionSchemaPromise) {
    subscriptionSchemaPromise = (async () => {
      const { db } = await import('../db/client')
      for (const statement of subscriptionDDL) {
        await db.execute(sql.raw(statement))
      }
    })().catch((err) => {
      subscriptionSchemaPromise = null
      throw err
    })
  }
  return subscriptionSchemaPromise
}

export function computeClinicEntitlements(input: {
  planId: string | null | undefined
  planStatus: string | null | undefined
  trialEndsAt: Date | string | null | undefined
  currentPeriodEnd: Date | string | null | undefined
  maxUsers?: number | null | undefined
  activeUsersCount: number
  pendingInvitesCount: number
  iyzicoConfigured?: boolean
  now?: Date
}): ClinicEntitlements {
  const now = input.now ?? new Date()
  const nowMs = now.getTime()
  const planId = normalizePlanId(input.planId, 'kurumsal')
  const planDef = PLAN_CATALOG[planId]
  let planStatus = normalizePlanStatus(input.planStatus, planId === 'demo' ? 'trial' : 'active')

  const trialEndsDate = input.trialEndsAt
    ? (input.trialEndsAt instanceof Date ? input.trialEndsAt : new Date(input.trialEndsAt))
    : null
  const validTrialEnds = trialEndsDate && !Number.isNaN(trialEndsDate.getTime()) ? trialEndsDate : null

  const periodEndDate = input.currentPeriodEnd
    ? (input.currentPeriodEnd instanceof Date ? input.currentPeriodEnd : new Date(input.currentPeriodEnd))
    : null
  const validPeriodEnd = periodEndDate && !Number.isNaN(periodEndDate.getTime()) ? periodEndDate : null

  let isTrialExpired = false
  if (planId === 'demo' && validTrialEnds && validTrialEnds.getTime() <= nowMs && planStatus === 'trial') {
    isTrialExpired = true
    planStatus = 'expired'
  } else if (planId === 'demo' && planStatus === 'expired') {
    isTrialExpired = true
  }

  if (planStatus === 'canceled' && validPeriodEnd && validPeriodEnd.getTime() <= nowMs) {
    planStatus = 'expired'
  }

  const isReadOnly = isTrialExpired || planStatus === 'expired'

  const trialDaysRemaining = validTrialEnds
    ? Math.max(0, Math.ceil((validTrialEnds.getTime() - nowMs) / (24 * 60 * 60 * 1000)))
    : null

  const maxUsers =
    typeof input.maxUsers === 'number' && Number.isFinite(input.maxUsers) && input.maxUsers > 0
      ? input.maxUsers
      : planDef.maxUsers

  return {
    planId,
    planName: planDef.name,
    planStatus,
    trialEndsAt: validTrialEnds ? validTrialEnds.toISOString() : null,
    trialDaysRemaining,
    currentPeriodEnd: validPeriodEnd ? validPeriodEnd.toISOString() : null,
    maxUsers,
    activeUsersCount: Math.max(0, input.activeUsersCount),
    pendingInvitesCount: Math.max(0, input.pendingInvitesCount),
    adminOnlyUsers: planDef.adminOnlyUsers,
    isTrialExpired,
    isReadOnly,
    allowedTabs: [...planDef.allowedTabs],
    features: { ...planDef.features },
    dailyAiCallLimit: planDef.dailyAiCallLimit,
    iyzicoConfigured: input.iyzicoConfigured ?? isIyzicoConfigured(),
  }
}

export async function getClinicEntitlements(clinicId: string): Promise<ClinicEntitlements> {
  await ensureSubscriptionSchema()
  const { db } = await import('../db/client')
  const { clinicMemberships, clinics, staffInvitations, users } = await import('../db/schema')

  const now = new Date()
  const [[clinicRow], activeMembers, pendingInvites] = await Promise.all([
    db
      .select({
        planId: clinics.planId,
        planStatus: clinics.planStatus,
        trialEndsAt: clinics.trialEndsAt,
        currentPeriodEnd: clinics.currentPeriodEnd,
        maxUsers: clinics.maxUsers,
      })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1),
    db
      .select({ userId: clinicMemberships.userId })
      .from(clinicMemberships)
      .innerJoin(users, eq(clinicMemberships.userId, users.id))
      .where(
        and(
          eq(clinicMemberships.clinicId, clinicId),
          eq(clinicMemberships.active, true),
          eq(users.active, true),
          eq(users.isPlatformAdmin, false),
        ),
      ),
    db
      .select({ id: staffInvitations.id })
      .from(staffInvitations)
      .where(
        and(
          eq(staffInvitations.clinicId, clinicId),
          eq(staffInvitations.status, 'pending'),
          gt(staffInvitations.expiresAt, now),
        ),
      )
      .catch(() => [] as { id: string }[]),
  ])

  return computeClinicEntitlements({
    planId: clinicRow?.planId ?? 'kurumsal',
    planStatus: clinicRow?.planStatus ?? 'active',
    trialEndsAt: clinicRow?.trialEndsAt ?? null,
    currentPeriodEnd: clinicRow?.currentPeriodEnd ?? null,
    maxUsers: clinicRow?.maxUsers ?? PLAN_CATALOG[normalizePlanId(clinicRow?.planId, 'kurumsal')].maxUsers,
    activeUsersCount: activeMembers.length,
    pendingInvitesCount: pendingInvites.length,
    iyzicoConfigured: isIyzicoConfigured(),
    now,
  })
}
