import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  auditLog,
  clinicDomains,
  clinicMemberships,
  clinicSettings,
  clinics,
  knowledgeCategories,
  staffInvitations,
  upgradeRequests,
  users,
} from '../schema'
import { DEFAULT_CATEGORIES } from './categories'
import {
  invalidateTenantCache,
  isLocalHostname,
  normalizeHostname,
  registerAllowedTenantHostname,
} from '../../tenancy/context'
import {
  getDefaultCategoriesForTemplate,
  normalizeBusinessTemplate,
  type BusinessTemplate,
} from '../../platform/roles'
import { deleteAllUserSessions } from './users'
import { ensureStaffInvitationsSchema, getClinicSmtpStatus } from '../../services/staff-invitations'
import {
  PLAN_CATALOG,
  computeClinicEntitlements,
  ensureSubscriptionSchema,
  normalizePlanId,
  normalizePlanStatus,
  type PlanId,
  type PlanStatus,
} from '../../services/subscriptions'

const DEFAULT_ROLE_PERMISSIONS = {
  calisan: ['calendar', 'patients', 'knowledge', 'klinik'],
  hekim: ['calendar', 'patients', 'knowledge', 'klinik'],
  sekreter: ['calendar', 'patients', 'payments', 'klinik'],
  host: ['calendar', 'patients', 'payments', 'klinik'],
  asistan: ['calendar', 'patients', 'klinik'],
}

export interface CreatePlatformClinicInput {
  name: string
  hostname: string
  timezone?: string
  businessTemplate?: BusinessTemplate
  sourceClinicId?: string
}

export interface PlatformClinicRow {
  id: string
  name: string
  hostname: string
  domains: string[]
  businessTemplate: BusinessTemplate
  isActive: boolean
  planId: PlanId
  planStatus: PlanStatus
  trialEndsAt: string | null
  maxUsers: number
  createdAt: string
}

export class ClinicProvisioningError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
    this.name = 'ClinicProvisioningError'
  }
}

function validateClinicName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 120) {
    throw new ClinicProvisioningError('İşletme adı 2 ile 120 karakter arasında olmalıdır.')
  }
  return name
}

function validateHostname(value: string): string {
  const hostname = normalizeHostname(value)
  if (!hostname || hostname.length > 253) {
    throw new ClinicProvisioningError('Geçerli bir alan adı (hostname) değeri girin.')
  }
  if (isLocalHostname(hostname)) {
    throw new ClinicProvisioningError('Yeni işletme için localhost yerine ornek.axamaz.com veya firma-a.localhost gibi ayrı bir hostname kullanın.')
  }

  const labels = hostname.split('.')
  const valid = labels.every(label => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))
  if (!valid || (!hostname.includes('.') && hostname !== 'localhost')) {
    throw new ClinicProvisioningError('Hostname alanına alan adı veya subdomain girilmelidir.')
  }
  return hostname
}

function validateTimezone(value: string | undefined): string {
  const timezone = value?.trim() || 'Europe/Istanbul'
  try {
    new Intl.DateTimeFormat('tr-TR', { timeZone: timezone }).format()
    return timezone
  } catch {
    throw new ClinicProvisioningError('Geçerli bir IANA saat dilimi girin.')
  }
}

function isSafeCloneableSettingKey(key: string): boolean {
  const lower = key.toLowerCase()
  const blockedPrefixes = [
    'smtp',
    'netgsm',
    'whatsapp',
    'evolution',
    'gemini',
    'api_key',
    'google_calendar',
    'telegram',
    'branding.title',
  ]
  if (blockedPrefixes.some(p => lower.startsWith(p))) return false
  if (lower.includes('secret') || lower.includes('password') || lower.includes('token')) return false
  return true
}

async function getPlatformClinicRow(clinicId: string): Promise<PlatformClinicRow | null> {
  const rows = await listPlatformClinics()
  return rows.find(r => r.id === clinicId) ?? null
}

export async function listPlatformClinics(): Promise<PlatformClinicRow[]> {
  await ensureSubscriptionSchema()
  const rows = await db
    .select({
      id: clinics.id,
      name: clinics.name,
      businessTemplate: clinics.businessTemplate,
      planId: clinics.planId,
      planStatus: clinics.planStatus,
      trialEndsAt: clinics.trialEndsAt,
      currentPeriodEnd: clinics.currentPeriodEnd,
      maxUsers: clinics.maxUsers,
      hostname: sql<string | null>`(
        SELECT domain.hostname
        FROM clinic_domains AS domain
        WHERE domain.clinic_id = ${clinics.id}
          AND domain.is_primary = true
        ORDER BY domain.created_at
        LIMIT 1
      )`,
      domains: sql<string[]>`COALESCE((
        SELECT array_agg(domain.hostname ORDER BY domain.is_primary DESC, domain.created_at ASC)
        FROM clinic_domains AS domain
        WHERE domain.clinic_id = ${clinics.id} AND domain.is_active = true
      ), ARRAY[]::text[])`,
      isActive: clinics.isActive,
      createdAt: clinics.createdAt,
    })
    .from(clinics)
    .orderBy(desc(clinics.createdAt))

  const now = new Date()
  return rows.map(row => {
    const computed = computeClinicEntitlements({
      planId: row.planId,
      planStatus: row.planStatus,
      trialEndsAt: row.trialEndsAt,
      currentPeriodEnd: row.currentPeriodEnd,
      maxUsers: row.maxUsers,
      activeUsersCount: 0,
      pendingInvitesCount: 0,
      now,
    })
    return {
      id: row.id,
      name: row.name,
      hostname: row.hostname || row.domains?.[0] || '',
      domains: Array.isArray(row.domains) ? row.domains.filter(Boolean) : [],
      businessTemplate: normalizeBusinessTemplate(row.businessTemplate),
      isActive: row.isActive,
      planId: computed.planId,
      planStatus: computed.planStatus,
      trialEndsAt: computed.trialEndsAt,
      maxUsers: computed.maxUsers,
      createdAt: row.createdAt?.toISOString() || '',
    }
  })
}

export async function createPlatformClinic(
  input: CreatePlatformClinicInput,
  platformAdminUserId: string,
): Promise<PlatformClinicRow> {
  const name = validateClinicName(input.name)
  const hostname = validateHostname(input.hostname)
  const timezone = validateTimezone(input.timezone)

  const created = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`clinic-host:${hostname}`}, 0))`)

    const [existingDomain] = await tx
      .select({ clinicId: clinicDomains.clinicId })
      .from(clinicDomains)
      .where(eq(clinicDomains.hostname, hostname))
      .limit(1)
    if (existingDomain) {
      throw new ClinicProvisioningError('Bu hostname başka bir işletmeye bağlı.', 409)
    }

    let sourceClinic: { id: string; businessTemplate: string } | null = null
    if (input.sourceClinicId) {
      const [src] = await tx
        .select({ id: clinics.id, businessTemplate: clinics.businessTemplate })
        .from(clinics)
        .where(eq(clinics.id, input.sourceClinicId))
        .limit(1)
      if (!src) {
        throw new ClinicProvisioningError('Kopyalanacak kaynak işletme/klinik bulunamadı.', 404)
      }
      sourceClinic = src
    }

    const businessTemplate = input.businessTemplate
      ? normalizeBusinessTemplate(input.businessTemplate)
      : sourceClinic
        ? normalizeBusinessTemplate(sourceClinic.businessTemplate)
        : 'general'

    const [clinic] = await tx.insert(clinics).values({ name, businessTemplate, isActive: true }).returning()
    if (!clinic) throw new ClinicProvisioningError('İşletme oluşturulamadı.', 500)

    await tx.insert(clinicDomains).values({
      clinicId: clinic.id,
      hostname,
      isPrimary: true,
      isActive: true,
    })

    await tx.insert(clinicMemberships).values({
      clinicId: clinic.id,
      userId: platformAdminUserId,
      role: 'yonetici',
      active: true,
    }).onConflictDoNothing()

    let seededCategories = false
    if (sourceClinic) {
      const srcCategories = await tx
        .select()
        .from(knowledgeCategories)
        .where(eq(knowledgeCategories.clinicId, sourceClinic.id))
      if (srcCategories.length > 0) {
        await tx.insert(knowledgeCategories).values(
          srcCategories.map(cat => ({
            clinicId: clinic.id,
            slug: cat.slug,
            label: cat.label,
            icon: cat.icon,
            color: cat.color,
            sortOrder: cat.sortOrder,
          })),
        ).onConflictDoNothing()
        seededCategories = true
      }
    }
    if (!seededCategories) {
      const templateCats = getDefaultCategoriesForTemplate(businessTemplate)
      await tx.insert(knowledgeCategories).values(
        (templateCats.length > 0 ? templateCats : DEFAULT_CATEGORIES).map(category => ({ ...category, clinicId: clinic.id })),
      ).onConflictDoNothing()
    }

    const defaultSettings: Array<{ clinicId: string; key: string; value: string }> = [
      { clinicId: clinic.id, key: 'branding.title', value: name },
      { clinicId: clinic.id, key: 'branding.subtitle', value: 'Randevu · Bilgi' },
      { clinicId: clinic.id, key: 'clinic.timezone', value: timezone },
      { clinicId: clinic.id, key: 'ai.greeting', value: `Merhaba, ${name} asistanına hoş geldiniz. Size nasıl yardımcı olabilirim?` },
      { clinicId: clinic.id, key: 'greeting_message', value: `Merhaba, ${name} asistanına hoş geldiniz. Size nasıl yardımcı olabilirim?` },
      { clinicId: clinic.id, key: 'ai.greeting_outbound', value: `Merhaba, ben ${name} asistanıyım.` },
      { clinicId: clinic.id, key: 'greeting_message_outbound', value: `Merhaba, ben ${name} asistanıyım.` },
      { clinicId: clinic.id, key: 'role_tab_permissions', value: JSON.stringify(DEFAULT_ROLE_PERMISSIONS) },
    ]
    if (sourceClinic) {
      const srcSettings = await tx
        .select({ key: clinicSettings.key, value: clinicSettings.value })
        .from(clinicSettings)
        .where(eq(clinicSettings.clinicId, sourceClinic.id))
      for (const s of srcSettings) {
        if (!isSafeCloneableSettingKey(s.key)) continue
        defaultSettings.push({ clinicId: clinic.id, key: s.key, value: s.value })
      }
    }
    await tx.insert(clinicSettings).values(defaultSettings).onConflictDoNothing()

    await tx.insert(auditLog).values({
      clinicId: clinic.id,
      userId: platformAdminUserId,
      action: 'platform.clinic.create',
      targetType: 'clinic',
      targetId: clinic.id,
      metadata: {
        hostname,
        timezone,
        businessTemplate,
        ...(sourceClinic ? { sourceClinicId: sourceClinic.id } : {}),
      },
    })

    return clinic
  })

  invalidateTenantCache(hostname)
  registerAllowedTenantHostname(hostname)
  try {
    const { ensureClinicInheritedIntegrations } = await import('../../integrations/managed/store')
    await ensureClinicInheritedIntegrations(created.id)
  } catch {}
  try {
    const { ensureAutomaticEvolutionConfig } = await import('./whatsapp')
    await ensureAutomaticEvolutionConfig(created.id)
  } catch {}
  return {
    id: created.id,
    name: created.name,
    hostname,
    domains: [hostname],
    businessTemplate: normalizeBusinessTemplate(created.businessTemplate),
    isActive: created.isActive,
    planId: normalizePlanId(created.planId, 'kurumsal'),
    planStatus: normalizePlanStatus(created.planStatus, 'active'),
    trialEndsAt: created.trialEndsAt?.toISOString() ?? null,
    maxUsers: created.maxUsers ?? 999,
    createdAt: created.createdAt?.toISOString() || '',
  }
}

export async function updatePlatformClinic(
  clinicId: string,
  input: { name?: string; businessTemplate?: string },
  actorUserId: string,
): Promise<PlatformClinicRow> {
  const [existing] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1)
  if (!existing) {
    throw new ClinicProvisioningError('İşletme bulunamadı.', 404)
  }

  const patch: Partial<{ name: string; businessTemplate: string }> = {}
  if (input.name !== undefined) {
    patch.name = validateClinicName(input.name)
  }
  if (input.businessTemplate !== undefined) {
    patch.businessTemplate = normalizeBusinessTemplate(input.businessTemplate)
  }
  if (Object.keys(patch).length > 0) {
    await db.update(clinics).set(patch).where(eq(clinics.id, clinicId))
    await db.insert(auditLog).values({
      clinicId,
      userId: actorUserId,
      action: 'platform.clinic.update',
      targetType: 'clinic',
      targetId: clinicId,
      metadata: patch,
    })
  }
  invalidateTenantCache()
  const row = await getPlatformClinicRow(clinicId)
  if (!row) throw new ClinicProvisioningError('İşletme bulunamadı.', 404)
  return row
}

export async function addPlatformClinicDomain(
  clinicId: string,
  input: { hostname: string; isPrimary?: boolean },
  actorUserId: string,
): Promise<PlatformClinicRow> {
  const hostname = validateHostname(input.hostname)
  const [existing] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1)
  if (!existing) {
    throw new ClinicProvisioningError('İşletme bulunamadı.', 404)
  }

  await db.transaction(async tx => {
    const [collision] = await tx
      .select({ clinicId: clinicDomains.clinicId })
      .from(clinicDomains)
      .where(eq(clinicDomains.hostname, hostname))
      .limit(1)
    if (collision && collision.clinicId !== clinicId) {
      throw new ClinicProvisioningError('Bu alan adı başka bir işletmeye bağlı.', 409)
    }

    if (input.isPrimary) {
      await tx
        .update(clinicDomains)
        .set({ isPrimary: false })
        .where(eq(clinicDomains.clinicId, clinicId))
    }

    if (collision && collision.clinicId === clinicId) {
      await tx
        .update(clinicDomains)
        .set({
          isActive: true,
          ...(input.isPrimary !== undefined ? { isPrimary: Boolean(input.isPrimary) } : {}),
        })
        .where(eq(clinicDomains.hostname, hostname))
    } else {
      await tx.insert(clinicDomains).values({
        clinicId,
        hostname,
        isPrimary: Boolean(input.isPrimary),
        isActive: true,
      })
    }

    await tx.insert(auditLog).values({
      clinicId,
      userId: actorUserId,
      action: 'platform.clinic.domain.add',
      targetType: 'clinic_domain',
      targetId: clinicId,
      metadata: { hostname, isPrimary: Boolean(input.isPrimary) },
    })
  })

  invalidateTenantCache(hostname)
  registerAllowedTenantHostname(hostname)
  const row = await getPlatformClinicRow(clinicId)
  if (!row) throw new ClinicProvisioningError('İşletme bulunamadı.', 404)
  return row
}

export async function removePlatformClinicDomain(
  clinicId: string,
  hostnameInput: string,
  actorUserId: string,
): Promise<PlatformClinicRow> {
  const hostname = normalizeHostname(hostnameInput)
  const domains = await db
    .select()
    .from(clinicDomains)
    .where(and(eq(clinicDomains.clinicId, clinicId), eq(clinicDomains.isActive, true)))
  const target = domains.find(d => d.hostname === hostname)
  if (!target) {
    throw new ClinicProvisioningError('Alan adı bulunamadı.', 404)
  }
  if (domains.length <= 1) {
    throw new ClinicProvisioningError('İşletmenin tek alan adı silinemez. Önce yeni alan adı ekleyin.', 400)
  }

  await db.transaction(async tx => {
    await tx.delete(clinicDomains).where(and(eq(clinicDomains.clinicId, clinicId), eq(clinicDomains.hostname, hostname)))
    if (target.isPrimary) {
      const replacement = domains.find(d => d.hostname !== hostname)
      if (replacement) {
        await tx
          .update(clinicDomains)
          .set({ isPrimary: true })
          .where(and(eq(clinicDomains.clinicId, clinicId), eq(clinicDomains.hostname, replacement.hostname)))
      }
    }
    await tx.insert(auditLog).values({
      clinicId,
      userId: actorUserId,
      action: 'platform.clinic.domain.remove',
      targetType: 'clinic_domain',
      targetId: clinicId,
      metadata: { hostname },
    })
  })

  invalidateTenantCache(hostname)
  const row = await getPlatformClinicRow(clinicId)
  if (!row) throw new ClinicProvisioningError('İşletme bulunamadı.', 404)
  return row
}

export interface PlatformClinicAdminRow {
  id: string
  email: string
  name: string
  phone: string | null
  role: string
  active: boolean
  isPlatformAdmin: boolean
  createdAt: string
}

export async function setPlatformClinicActive(
  clinicId: string,
  isActive: boolean,
  actorUserId: string,
): Promise<PlatformClinicRow> {
  const [existing] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1)
  if (!existing) {
    throw new ClinicProvisioningError('İşletme bulunamadı.', 404)
  }

  const [updated] = await db
    .update(clinics)
    .set({ isActive })
    .where(eq(clinics.id, clinicId))
    .returning()

  if (!isActive) {
    const memberRows = await db
      .select({ userId: clinicMemberships.userId, isPlatformAdmin: users.isPlatformAdmin })
      .from(clinicMemberships)
      .innerJoin(users, eq(clinicMemberships.userId, users.id))
      .where(eq(clinicMemberships.clinicId, clinicId))

    for (const member of memberRows) {
      if (!member.isPlatformAdmin && member.userId !== actorUserId) {
        await deleteAllUserSessions(member.userId)
      }
    }
  }

  await db.insert(auditLog).values({
    clinicId,
    userId: actorUserId,
    action: isActive ? 'platform.clinic.unfreeze' : 'platform.clinic.freeze',
    targetType: 'clinic',
    targetId: clinicId,
    metadata: { isActive },
  })

  invalidateTenantCache()

  const row = await getPlatformClinicRow(clinicId)
  if (!row) {
    return {
      id: updated!.id,
      name: updated!.name,
      hostname: '',
      domains: [],
      businessTemplate: normalizeBusinessTemplate(updated!.businessTemplate),
      isActive: updated!.isActive,
      planId: normalizePlanId(updated!.planId, 'kurumsal'),
      planStatus: normalizePlanStatus(updated!.planStatus, 'active'),
      trialEndsAt: updated!.trialEndsAt?.toISOString() ?? null,
      maxUsers: updated!.maxUsers ?? 999,
      createdAt: updated!.createdAt?.toISOString() || '',
    }
  }
  return row
}

export async function listPlatformClinicAdmins(clinicId: string) {
  await ensureStaffInvitationsSchema()

  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1)
  if (!clinic) {
    throw new ClinicProvisioningError('İşletme bulunamadı.', 404)
  }

  const [domainRow] = await db
    .select({ hostname: clinicDomains.hostname })
    .from(clinicDomains)
    .where(and(eq(clinicDomains.clinicId, clinicId), eq(clinicDomains.isPrimary, true)))
    .limit(1)

  const adminRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      phone: users.phone,
      role: clinicMemberships.role,
      userActive: users.active,
      membershipActive: clinicMemberships.active,
      isPlatformAdmin: users.isPlatformAdmin,
      createdAt: users.createdAt,
    })
    .from(clinicMemberships)
    .innerJoin(users, eq(clinicMemberships.userId, users.id))
    .where(and(eq(clinicMemberships.clinicId, clinicId), eq(clinicMemberships.role, 'yonetici')))
    .orderBy(asc(users.isPlatformAdmin), desc(users.createdAt))

  const admins: PlatformClinicAdminRow[] = adminRows.map(row => ({
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone ?? null,
    role: row.role,
    active: Boolean(row.userActive && row.membershipActive),
    isPlatformAdmin: Boolean(row.isPlatformAdmin),
    createdAt: row.createdAt?.toISOString() || '',
  }))

  const invitations = await db
    .select({
      id: staffInvitations.id,
      email: staffInvitations.email,
      name: staffInvitations.name,
      role: staffInvitations.role,
      status: staffInvitations.status,
      expiresAt: staffInvitations.expiresAt,
      createdAt: staffInvitations.createdAt,
    })
    .from(staffInvitations)
    .where(and(eq(staffInvitations.clinicId, clinicId), eq(staffInvitations.role, 'yonetici')))
    .orderBy(desc(staffInvitations.createdAt))
    .limit(30)

  const smtpStatus = await getClinicSmtpStatus(clinicId)

  return {
    clinicId,
    clinicName: clinic.name,
    clinicIsActive: clinic.isActive,
    primaryHostname: domainRow?.hostname || '',
    admins,
    invitations: invitations.map(inv => ({
      ...inv,
      expiresAt: inv.expiresAt?.toISOString() || '',
      createdAt: inv.createdAt?.toISOString() || '',
    })),
    smtpStatus,
  }
}

export async function assignPlatformClinicSeedAdmin(
  clinicId: string,
  input: { name: string; email: string; password: string; phone?: string },
  actorUserId: string,
): Promise<PlatformClinicAdminRow> {
  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1)
  if (!clinic) {
    throw new ClinicProvisioningError('İşletme bulunamadı.', 404)
  }

  const name = (input.name || '').trim()
  const email = (input.email || '').toLowerCase().trim()
  const password = input.password || ''
  const phone = input.phone?.trim() || null

  if (name.length < 2) {
    throw new ClinicProvisioningError('Yönetici adı en az 2 karakter olmalıdır.', 400)
  }
  if (!email || !email.includes('@')) {
    throw new ClinicProvisioningError('Geçerli bir e-posta adresi girin.', 400)
  }
  if (password.length < 6) {
    throw new ClinicProvisioningError('Şifre en az 6 karakter olmalıdır.', 400)
  }

  const passwordHash = await Bun.password.hash(password)

  const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  let targetUser = existingUser

  if (existingUser) {
    if (existingUser.isPlatformAdmin) {
      throw new ClinicProvisioningError(
        'Bu e-posta adresi satışçı / platform yöneticisi hesabına aittir. İşletme Seed Yöneticisi için ayrı bir e-posta kullanın.',
        400,
      )
    }
    const [updated] = await db
      .update(users)
      .set({
        name,
        passwordHash,
        phone,
        role: 'yonetici',
        active: true,
      })
      .where(eq(users.id, existingUser.id))
      .returning()
    targetUser = updated
  } else {
    const [created] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        name,
        phone,
        role: 'yonetici',
        active: true,
        isPlatformAdmin: false,
      })
      .returning()
    targetUser = created
  }

  if (!targetUser) {
    throw new ClinicProvisioningError('Seed yönetici oluşturulamadı.', 500)
  }

  await db
    .insert(clinicMemberships)
    .values({
      clinicId,
      userId: targetUser.id,
      role: 'yonetici',
      active: true,
    })
    .onConflictDoUpdate({
      target: [clinicMemberships.clinicId, clinicMemberships.userId],
      set: { role: 'yonetici', active: true },
    })

  await db.insert(auditLog).values({
    clinicId,
    userId: actorUserId,
    action: 'platform.clinic.seed_admin.assign',
    targetType: 'user',
    targetId: targetUser.id,
    metadata: { email: targetUser.email, name: targetUser.name },
  })

  return {
    id: targetUser.id,
    email: targetUser.email,
    name: targetUser.name,
    phone: targetUser.phone ?? null,
    role: 'yonetici',
    active: true,
    isPlatformAdmin: Boolean(targetUser.isPlatformAdmin),
    createdAt: targetUser.createdAt?.toISOString() || '',
  }
}

export async function setPlatformClinicAdminActive(
  clinicId: string,
  targetUserId: string,
  active: boolean,
  actorUserId: string,
): Promise<{ id: string; active: boolean }> {
  const [membership] = await db
    .select()
    .from(clinicMemberships)
    .where(
      and(
        eq(clinicMemberships.clinicId, clinicId),
        eq(clinicMemberships.userId, targetUserId),
        eq(clinicMemberships.role, 'yonetici'),
      ),
    )
    .limit(1)

  if (!membership) {
    throw new ClinicProvisioningError('Bu işletmede belirtilen yönetici kaydı bulunamadı.', 404)
  }

  const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1)
  if (!targetUser) {
    throw new ClinicProvisioningError('Kullanıcı bulunamadı.', 404)
  }

  if (!active && (targetUser.id === actorUserId || targetUser.isPlatformAdmin)) {
    throw new ClinicProvisioningError(
      'Satışçı / Platform yöneticisi hesabı dondurulamaz. Yalnızca işletmeye atanan Seed User (Yönetici) hesapları dondurulabilir.',
      400,
    )
  }

  await db
    .update(clinicMemberships)
    .set({ active })
    .where(and(eq(clinicMemberships.clinicId, clinicId), eq(clinicMemberships.userId, targetUserId)))

  await db
    .update(users)
    .set({ active })
    .where(eq(users.id, targetUserId))

  if (!active) {
    await deleteAllUserSessions(targetUserId)
  }

  await db.insert(auditLog).values({
    clinicId,
    userId: actorUserId,
    action: active ? 'platform.clinic.admin.unfreeze' : 'platform.clinic.admin.freeze',
    targetType: 'user',
    targetId: targetUserId,
    metadata: { active },
  })

  return { id: targetUserId, active }
}

export async function updatePlatformClinicPlan(
  clinicId: string,
  input: {
    planId: PlanId
    planStatus?: PlanStatus
    maxUsers?: number
    extendTrialDays?: number
  },
  actorUserId: string,
): Promise<PlatformClinicRow> {
  await ensureSubscriptionSchema()
  const [existing] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1)
  if (!existing) {
    throw new ClinicProvisioningError('İşletme bulunamadı.', 404)
  }

  const planId = normalizePlanId(input.planId, 'kurumsal')
  const planDef = PLAN_CATALOG[planId]
  let planStatus = input.planStatus
    ? normalizePlanStatus(input.planStatus, planId === 'demo' ? 'trial' : 'active')
    : planId === 'demo'
      ? 'trial'
      : 'active'

  const maxUsers =
    typeof input.maxUsers === 'number' && Number.isFinite(input.maxUsers) && input.maxUsers > 0
      ? Math.round(input.maxUsers)
      : planDef.maxUsers

  const now = new Date()
  let trialEndsAt = existing.trialEndsAt
  if (typeof input.extendTrialDays === 'number' && input.extendTrialDays > 0) {
    const baseMs = Math.max(now.getTime(), existing.trialEndsAt?.getTime() || 0)
    trialEndsAt = new Date(baseMs + Math.round(input.extendTrialDays) * 24 * 60 * 60 * 1000)
    if (planId === 'demo' && !input.planStatus) {
      planStatus = 'trial'
    }
  } else if (planId === 'demo' && !trialEndsAt) {
    trialEndsAt = new Date(now.getTime() + planDef.trialDays * 24 * 60 * 60 * 1000)
  }

  let currentPeriodEnd = existing.currentPeriodEnd
  if (planId === 'pro' && planStatus === 'active' && (!currentPeriodEnd || currentPeriodEnd <= now)) {
    currentPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  }

  await db
    .update(clinics)
    .set({
      planId,
      planStatus,
      maxUsers,
      trialEndsAt,
      currentPeriodEnd,
    })
    .where(eq(clinics.id, clinicId))

  await db.insert(auditLog).values({
    clinicId,
    userId: actorUserId,
    action: 'platform.clinic.plan.update',
    targetType: 'clinic',
    targetId: clinicId,
    metadata: {
      planId,
      planStatus,
      maxUsers,
      extendTrialDays: input.extendTrialDays ?? null,
    },
  })

  invalidateTenantCache()
  const row = await getPlatformClinicRow(clinicId)
  if (!row) throw new ClinicProvisioningError('İşletme bulunamadı.', 404)
  return row
}

export async function listPlatformUpgradeRequests() {
  await ensureSubscriptionSchema()
  const rows = await db
    .select({
      id: upgradeRequests.id,
      clinicId: upgradeRequests.clinicId,
      clinicName: clinics.name,
      clinicPlanId: clinics.planId,
      clinicPlanStatus: clinics.planStatus,
      requestedBy: upgradeRequests.requestedBy,
      requesterName: users.name,
      requesterEmail: users.email,
      requesterPhone: users.phone,
      requestType: upgradeRequests.requestType,
      requestedPlan: upgradeRequests.requestedPlan,
      contactName: upgradeRequests.contactName,
      contactEmail: upgradeRequests.contactEmail,
      contactPhone: upgradeRequests.contactPhone,
      companyName: upgradeRequests.companyName,
      notes: upgradeRequests.notes,
      status: upgradeRequests.status,
      handledBy: upgradeRequests.handledBy,
      handledAt: upgradeRequests.handledAt,
      createdAt: upgradeRequests.createdAt,
      updatedAt: upgradeRequests.updatedAt,
    })
    .from(upgradeRequests)
    .leftJoin(clinics, eq(upgradeRequests.clinicId, clinics.id))
    .leftJoin(users, eq(upgradeRequests.requestedBy, users.id))
    .orderBy(desc(upgradeRequests.createdAt))
    .limit(200)

  return rows.map((r) => ({
    id: r.id,
    clinicId: r.clinicId,
    clinicName: r.clinicName || r.companyName || null,
    clinicPlanId: r.clinicPlanId ? normalizePlanId(r.clinicPlanId, 'kurumsal') : null,
    clinicPlanStatus: r.clinicPlanStatus || null,
    requestedBy: r.requestedBy,
    requesterName: r.requesterName || r.contactName || null,
    requesterEmail: r.requesterEmail || r.contactEmail || null,
    requesterPhone: r.requesterPhone || r.contactPhone || null,
    requestType: r.requestType,
    requestedPlan: r.requestedPlan,
    contactName: r.contactName || r.requesterName || null,
    contactEmail: r.contactEmail || r.requesterEmail || null,
    contactPhone: r.contactPhone || r.requesterPhone || null,
    companyName: r.companyName || r.clinicName || null,
    notes: r.notes,
    status: r.status,
    handledBy: r.handledBy,
    handledAt: r.handledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))
}

export async function updatePlatformUpgradeRequest(
  requestId: string,
  input: {
    status: 'pending' | 'contacted' | 'approved' | 'rejected'
    applyPlan?: PlanId
  },
  actorUserId: string,
) {
  await ensureSubscriptionSchema()
  const now = new Date()

  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(upgradeRequests)
      .where(eq(upgradeRequests.id, requestId))
      .limit(1)

    if (!existing) {
      throw new ClinicProvisioningError('Yükseltme başvurusu bulunamadı.', 404)
    }

    const [saved] = await tx
      .update(upgradeRequests)
      .set({
        status: input.status,
        handledBy: actorUserId,
        handledAt: now,
        updatedAt: now,
      })
      .where(eq(upgradeRequests.id, requestId))
      .returning()

    if (input.applyPlan && existing.clinicId) {
      const targetPlan = normalizePlanId(input.applyPlan, 'pro')
      const planDef = PLAN_CATALOG[targetPlan]
      await tx
        .update(clinics)
        .set({
          planId: targetPlan,
          planStatus: targetPlan === 'demo' ? 'trial' : 'active',
          maxUsers: planDef.maxUsers,
          ...(targetPlan === 'pro'
            ? { currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) }
            : {}),
        })
        .where(eq(clinics.id, existing.clinicId))
    }

    await tx.insert(auditLog).values({
      clinicId: existing.clinicId,
      userId: actorUserId,
      action: 'platform.upgrade_request.update',
      targetType: 'upgrade_request',
      targetId: requestId,
      metadata: {
        status: input.status,
        applyPlan: input.applyPlan ?? null,
      },
    })

    return saved!
  })

  if (input.applyPlan) {
    invalidateTenantCache()
  }

  return updated
}
