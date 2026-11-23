import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { auditLog, clinicMemberships, clinics, staffInvitations, users } from '../db/schema'
import { getSetting, setSetting } from '../db/repositories/settings'
import type { Config } from '../integrations/managed/model'
import { activeConfig, decrypt, getRow, resolveEffectiveConfig } from '../integrations/managed/store'
import { sendEmail } from './email'
import { coreRoleLabelTr, normalizePanelTabId } from '../platform/roles'

const hashToken = (value: string) => createHash('sha256').update(value).digest('hex')

export const DEFAULT_STAFF_KVKK_TEXT =
  '6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında; işletmemiz bünyesinde yürütülen hizmet, operasyon, randevu ve vardiya planlaması, müşteri/danışan süreçleri ve kurumsal iletişim faaliyetlerinin gerçekleştirilmesi amacıyla kimlik, iletişim, mesleki uzmanlık ve işlem güvenliği verilerimin işlenmesine, güvenli işletme sisteminde saklanmasına ve görevim kapsamında eriştiğim kurumsal ve kişisel verilerin gizliliğini koruyacağıma ilişkin aydınlatma metnini okudum, anladım ve açık rızamla onaylıyorum.'

export type ConfigurableStaffRoleKey = string

export interface RoleStaffPermissions {
  viewShiftPlanner: boolean
  editShifts: boolean
  manageLeaves: boolean
  editClinicWorkingHours: boolean
  manageStaff: boolean
  manageDynamicTables: boolean
  showOnCalendar?: boolean
}

export type ClinicStaffPermissionsConfig = Record<string, RoleStaffPermissions>

export interface UserAccessOverride {
  allowedTabs: string[]
  staffPermissions: RoleStaffPermissions
}

export interface ClinicUserPermissionsMap {
  byUserId: Record<string, UserAccessOverride>
  byInviteEmail: Record<string, UserAccessOverride>
}

export const ASSIGNABLE_PANEL_TABS = ['calendar', 'patients', 'incoming', 'payments', 'stok', 'knowledge', 'klinik'] as const

export const DEFAULT_CUSTOM_ROLE_TABS: string[] = ['calendar', 'patients', 'klinik']

export const DEFAULT_CUSTOM_ROLE_STAFF_PERMISSIONS: RoleStaffPermissions = {
  viewShiftPlanner: true,
  editShifts: false,
  manageLeaves: true,
  editClinicWorkingHours: false,
  manageStaff: false,
  manageDynamicTables: false,
  showOnCalendar: true,
}

export const DEFAULT_ROLE_TAB_PERMISSIONS: Record<string, string[]> = {
  calisan: ['calendar', 'patients', 'knowledge', 'klinik'],
  hekim: ['calendar', 'patients', 'knowledge', 'klinik'],
  sekreter: ['calendar', 'patients', 'payments', 'klinik'],
  asistan: ['calendar', 'patients', 'klinik'],
}

export const DEFAULT_CLINIC_STAFF_PERMISSIONS: ClinicStaffPermissionsConfig = {
  calisan: {
    viewShiftPlanner: true,
    editShifts: false,
    manageLeaves: true,
    editClinicWorkingHours: false,
    manageStaff: false,
    manageDynamicTables: false,
    showOnCalendar: true,
  },
  hekim: {
    viewShiftPlanner: true,
    editShifts: false,
    manageLeaves: true,
    editClinicWorkingHours: false,
    manageStaff: false,
    manageDynamicTables: false,
    showOnCalendar: true,
  },
  host: {
    viewShiftPlanner: true,
    editShifts: true,
    manageLeaves: true,
    editClinicWorkingHours: false,
    manageStaff: false,
    manageDynamicTables: false,
    showOnCalendar: false,
  },
  sekreter: {
    viewShiftPlanner: true,
    editShifts: true,
    manageLeaves: true,
    editClinicWorkingHours: false,
    manageStaff: false,
    manageDynamicTables: false,
    showOnCalendar: false,
  },
  asistan: {
    viewShiftPlanner: true,
    editShifts: false,
    manageLeaves: false,
    editClinicWorkingHours: false,
    manageStaff: false,
    manageDynamicTables: false,
    showOnCalendar: false,
  },
}

export const FULL_ADMIN_STAFF_PERMISSIONS: RoleStaffPermissions = {
  viewShiftPlanner: true,
  editShifts: true,
  manageLeaves: true,
  editClinicWorkingHours: true,
  manageStaff: true,
  manageDynamicTables: true,
  showOnCalendar: false,
}

const PERMISSIONS_SETTING_KEY = 'rbac.klinik_personel_permissions'
const ROLE_TABS_SETTING_KEY = 'role_tab_permissions'
const USER_ACCESS_SETTING_KEY = 'rbac.user_permissions'

const RESERVED_ADMIN_ROLE_KEYS = new Set([
  'yonetici',
  'yönetici',
  'super_admin',
  'superadmin',
  'moderator',
  'moderatör',
  'isletme yoneticisi',
  'işletme yöneticisi',
  'klinik yoneticisi',
  'klinik yöneticisi',
])

export function isReservedAdminRole(role: string | undefined | null): boolean {
  const cleaned = String(role || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('tr-TR')
  if (!cleaned) return false
  return RESERVED_ADMIN_ROLE_KEYS.has(cleaned) || RESERVED_ADMIN_ROLE_KEYS.has(String(role || '').trim().toLowerCase())
}

export function normalizeConfigurableRole(role: string | undefined | null): string {
  const cleaned = String(role || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('tr-TR')
  if (!cleaned) return 'calisan'
  if (cleaned === 'host') return 'sekreter'
  if (cleaned === 'uzman') return 'calisan'
  return cleaned
}

let schemaReady: Promise<void> | undefined

export function ensureStaffInvitationsSchema(): Promise<void> {
  return (schemaReady ??= (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS staff_invitations (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id          UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        email              TEXT NOT NULL,
        name               TEXT NOT NULL,
        role               TEXT NOT NULL DEFAULT 'hekim',
        specialty          TEXT,
        color              TEXT,
        token_hash         TEXT NOT NULL UNIQUE,
        status             TEXT NOT NULL DEFAULT 'pending',
        kvkk_text_version  TEXT NOT NULL,
        kvkk_text_snapshot TEXT NOT NULL,
        kvkk_accepted_at   TIMESTAMPTZ,
        invited_by         UUID REFERENCES users(id),
        accepted_user_id   UUID REFERENCES users(id),
        expires_at         TIMESTAMPTZ NOT NULL,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        accepted_at        TIMESTAMPTZ
      )
    `)
    await db.execute(sql`CREATE INDEX IF NOT EXISTS staff_invitations_clinic_status_idx ON staff_invitations (clinic_id, status)`)
    await db.execute(sql`CREATE INDEX IF NOT EXISTS staff_invitations_email_idx ON staff_invitations (clinic_id, email)`)
  })().catch(err => {
    schemaReady = undefined
    throw err
  }))
}

function sanitizeRolePerms(raw: any, fallback: RoleStaffPermissions): RoleStaffPermissions {
  if (!raw || typeof raw !== 'object') return { ...fallback }
  return {
    viewShiftPlanner: typeof raw.viewShiftPlanner === 'boolean' ? raw.viewShiftPlanner : fallback.viewShiftPlanner,
    editShifts: typeof raw.editShifts === 'boolean' ? raw.editShifts : fallback.editShifts,
    manageLeaves: typeof raw.manageLeaves === 'boolean' ? raw.manageLeaves : fallback.manageLeaves,
    editClinicWorkingHours: typeof raw.editClinicWorkingHours === 'boolean' ? raw.editClinicWorkingHours : fallback.editClinicWorkingHours,
    manageStaff: typeof raw.manageStaff === 'boolean' ? raw.manageStaff : fallback.manageStaff,
    manageDynamicTables: typeof raw.manageDynamicTables === 'boolean' ? raw.manageDynamicTables : fallback.manageDynamicTables,
    ...(typeof raw.showOnCalendar === 'boolean'
      ? { showOnCalendar: raw.showOnCalendar }
      : typeof fallback.showOnCalendar === 'boolean'
        ? { showOnCalendar: fallback.showOnCalendar }
        : {}),
  }
}

export function sanitizeAllowedTabs(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback]
  const validSet = new Set<string>(ASSIGNABLE_PANEL_TABS)
  const canonicalToPanel: Record<string, string> = {
    records: 'patients',
    incoming: 'incoming',
    finance: 'payments',
    inventory: 'stok',
    team: 'klinik',
  }
  const cleaned = Array.from(
    new Set(
      raw
        .map((item) => {
          if (typeof item !== 'string') return ''
          const normalized = normalizePanelTabId(item)
          const rawTrimmed = item.trim().toLowerCase()
          return validSet.has(rawTrimmed) ? rawTrimmed : (canonicalToPanel[normalized] || '')
        })
        .filter((item) => validSet.has(item)),
    ),
  )
  return cleaned.length > 0 ? cleaned : ['calendar']
}

export async function getClinicRoleTabPermissions(clinicId: string): Promise<Record<string, string[]>> {
  try {
    const raw = await getSetting(ROLE_TABS_SETTING_KEY, clinicId)
    if (!raw) {
      return {
        calisan: [...DEFAULT_ROLE_TAB_PERMISSIONS.calisan],
        hekim: [...DEFAULT_ROLE_TAB_PERMISSIONS.hekim],
        sekreter: [...DEFAULT_ROLE_TAB_PERMISSIONS.sekreter],
        host: [...DEFAULT_ROLE_TAB_PERMISSIONS.sekreter],
        asistan: [...DEFAULT_ROLE_TAB_PERMISSIONS.asistan],
      }
    }
    const parsed = JSON.parse(raw)
    const sekreterTabs = sanitizeAllowedTabs(
      parsed?.sekreter ?? parsed?.host,
      DEFAULT_ROLE_TAB_PERMISSIONS.sekreter,
    )
    const hekimTabs = sanitizeAllowedTabs(parsed?.hekim ?? parsed?.calisan, DEFAULT_ROLE_TAB_PERMISSIONS.hekim)
    return {
      calisan: sanitizeAllowedTabs(parsed?.calisan ?? parsed?.hekim, DEFAULT_ROLE_TAB_PERMISSIONS.calisan),
      hekim: hekimTabs,
      sekreter: sekreterTabs,
      host: sanitizeAllowedTabs(parsed?.host ?? parsed?.sekreter, sekreterTabs),
      asistan: sanitizeAllowedTabs(parsed?.asistan, DEFAULT_ROLE_TAB_PERMISSIONS.asistan),
    }
  } catch {
    return {
      calisan: [...DEFAULT_ROLE_TAB_PERMISSIONS.calisan],
      hekim: [...DEFAULT_ROLE_TAB_PERMISSIONS.hekim],
      sekreter: [...DEFAULT_ROLE_TAB_PERMISSIONS.sekreter],
      host: [...DEFAULT_ROLE_TAB_PERMISSIONS.sekreter],
      asistan: [...DEFAULT_ROLE_TAB_PERMISSIONS.asistan],
    }
  }
}

export async function saveClinicRoleTabPermissions(
  clinicId: string,
  input: any,
): Promise<Record<string, string[]>> {
  const current = await getClinicRoleTabPermissions(clinicId)
  const sekreterTabs =
    input?.sekreter !== undefined
      ? sanitizeAllowedTabs(input.sekreter, current.sekreter)
      : input?.host !== undefined
        ? sanitizeAllowedTabs(input.host, current.host)
        : current.sekreter
  const calisanTabs = input?.calisan !== undefined
    ? sanitizeAllowedTabs(input.calisan, current.calisan ?? current.hekim)
    : (current.calisan ?? current.hekim)
  const hekimTabs = input?.hekim !== undefined
    ? sanitizeAllowedTabs(input.hekim, current.hekim)
    : current.hekim
  const next = {
    calisan: calisanTabs,
    hekim: hekimTabs,
    sekreter: sekreterTabs,
    host: sekreterTabs,
    asistan: input?.asistan !== undefined ? sanitizeAllowedTabs(input.asistan, current.asistan) : current.asistan,
  }
  await setSetting(ROLE_TABS_SETTING_KEY, JSON.stringify(next), clinicId)
  return next
}

export async function getClinicStaffPermissions(clinicId: string): Promise<ClinicStaffPermissionsConfig> {
  try {
    const raw = await getSetting(PERMISSIONS_SETTING_KEY, clinicId)
    if (!raw) return DEFAULT_CLINIC_STAFF_PERMISSIONS
    const parsed = JSON.parse(raw)
    const sekreterPerms = sanitizeRolePerms(
      parsed?.sekreter ?? parsed?.host,
      DEFAULT_CLINIC_STAFF_PERMISSIONS.sekreter,
    )
    return {
      calisan: sanitizeRolePerms(parsed?.calisan ?? parsed?.hekim, DEFAULT_CLINIC_STAFF_PERMISSIONS.calisan),
      hekim: sanitizeRolePerms(parsed?.hekim ?? parsed?.calisan, DEFAULT_CLINIC_STAFF_PERMISSIONS.hekim),
      host: sanitizeRolePerms(parsed?.host ?? parsed?.sekreter, sekreterPerms),
      sekreter: sekreterPerms,
      asistan: sanitizeRolePerms(parsed?.asistan, DEFAULT_CLINIC_STAFF_PERMISSIONS.asistan),
    }
  } catch {
    return DEFAULT_CLINIC_STAFF_PERMISSIONS
  }
}

export async function saveClinicStaffPermissions(clinicId: string, input: any): Promise<ClinicStaffPermissionsConfig> {
  const current = await getClinicStaffPermissions(clinicId)
  const sekreterPerms = sanitizeRolePerms(
    input?.sekreter ?? input?.host,
    current.sekreter,
  )
  const next: ClinicStaffPermissionsConfig = {
    calisan: input?.calisan ? sanitizeRolePerms(input.calisan, current.calisan ?? current.hekim) : (current.calisan ?? current.hekim),
    hekim: input?.hekim ? sanitizeRolePerms(input.hekim, current.hekim) : current.hekim,
    host: sekreterPerms,
    sekreter: sekreterPerms,
    asistan: input?.asistan ? sanitizeRolePerms(input.asistan, current.asistan) : current.asistan,
  }
  await setSetting(PERMISSIONS_SETTING_KEY, JSON.stringify(next), clinicId)
  return next
}

export async function getClinicUserPermissionsMap(clinicId: string): Promise<ClinicUserPermissionsMap> {
  try {
    const raw = await getSetting(USER_ACCESS_SETTING_KEY, clinicId)
    if (!raw) return { byUserId: {}, byInviteEmail: {} }
    const parsed = JSON.parse(raw)
    return {
      byUserId: parsed?.byUserId && typeof parsed.byUserId === 'object' ? parsed.byUserId : {},
      byInviteEmail: parsed?.byInviteEmail && typeof parsed.byInviteEmail === 'object' ? parsed.byInviteEmail : {},
    }
  } catch {
    return { byUserId: {}, byInviteEmail: {} }
  }
}

async function persistClinicUserPermissionsMap(clinicId: string, map: ClinicUserPermissionsMap): Promise<void> {
  await setSetting(USER_ACCESS_SETTING_KEY, JSON.stringify(map), clinicId)
}

export async function getEffectiveUserAccess(
  clinicId: string,
  target: { id?: string | null; role?: string | null },
): Promise<UserAccessOverride> {
  const role = target.role || 'sekreter'
  if (role === 'yonetici' || role === 'moderator') {
    return {
      allowedTabs: [...ASSIGNABLE_PANEL_TABS, 'integrations'],
      staffPermissions: { ...FULL_ADMIN_STAFF_PERMISSIONS },
    }
  }

  const normalizedRole = normalizeConfigurableRole(role)
  const [roleTabs, roleStaffPerms, userMap] = await Promise.all([
    getClinicRoleTabPermissions(clinicId),
    getClinicStaffPermissions(clinicId),
    getClinicUserPermissionsMap(clinicId),
  ])

  const defaultTabs = roleTabs[normalizedRole] || DEFAULT_ROLE_TAB_PERMISSIONS[normalizedRole]
  const defaultStaff = roleStaffPerms[normalizedRole] || DEFAULT_CLINIC_STAFF_PERMISSIONS[normalizedRole]

  const override = target.id ? userMap.byUserId[target.id] : undefined
  if (!override) {
    return {
      allowedTabs: [...defaultTabs],
      staffPermissions: { ...defaultStaff },
    }
  }

  return {
    allowedTabs: sanitizeAllowedTabs(override.allowedTabs, defaultTabs),
    staffPermissions: sanitizeRolePerms(override.staffPermissions, defaultStaff),
  }
}

export async function saveUserAccessOverride(
  clinicId: string,
  userId: string,
  input: { allowedTabs?: unknown; staffPermissions?: unknown },
  fallbackRole: string,
): Promise<UserAccessOverride> {
  const normalizedRole = normalizeConfigurableRole(fallbackRole)
  const [roleTabs, roleStaffPerms, userMap] = await Promise.all([
    getClinicRoleTabPermissions(clinicId),
    getClinicStaffPermissions(clinicId),
    getClinicUserPermissionsMap(clinicId),
  ])
  const existing = userMap.byUserId[userId]
  const fallbackTabs = existing?.allowedTabs || roleTabs[normalizedRole] || DEFAULT_ROLE_TAB_PERMISSIONS[normalizedRole]
  const fallbackStaff = existing?.staffPermissions || roleStaffPerms[normalizedRole] || DEFAULT_CLINIC_STAFF_PERMISSIONS[normalizedRole]

  const nextEntry: UserAccessOverride = {
    allowedTabs: input.allowedTabs !== undefined ? sanitizeAllowedTabs(input.allowedTabs, fallbackTabs) : sanitizeAllowedTabs(fallbackTabs, DEFAULT_ROLE_TAB_PERMISSIONS[normalizedRole]),
    staffPermissions: input.staffPermissions !== undefined ? sanitizeRolePerms(input.staffPermissions, fallbackStaff) : sanitizeRolePerms(fallbackStaff, DEFAULT_CLINIC_STAFF_PERMISSIONS[normalizedRole]),
  }

  userMap.byUserId[userId] = nextEntry
  await persistClinicUserPermissionsMap(clinicId, userMap)
  return nextEntry
}

export async function saveInviteAccessOverride(
  clinicId: string,
  email: string,
  input: { allowedTabs?: unknown; staffPermissions?: unknown },
  fallbackRole: string,
): Promise<UserAccessOverride> {
  const cleanEmail = String(email || '').toLowerCase().trim()
  const normalizedRole = normalizeConfigurableRole(fallbackRole)
  const [roleTabs, roleStaffPerms, userMap] = await Promise.all([
    getClinicRoleTabPermissions(clinicId),
    getClinicStaffPermissions(clinicId),
    getClinicUserPermissionsMap(clinicId),
  ])
  const fallbackTabs = roleTabs[normalizedRole] || DEFAULT_ROLE_TAB_PERMISSIONS[normalizedRole]
  const fallbackStaff = roleStaffPerms[normalizedRole] || DEFAULT_CLINIC_STAFF_PERMISSIONS[normalizedRole]

  const nextEntry: UserAccessOverride = {
    allowedTabs: input.allowedTabs !== undefined ? sanitizeAllowedTabs(input.allowedTabs, fallbackTabs) : [...fallbackTabs],
    staffPermissions: input.staffPermissions !== undefined ? sanitizeRolePerms(input.staffPermissions, fallbackStaff) : { ...fallbackStaff },
  }

  if (cleanEmail) {
    userMap.byInviteEmail[cleanEmail] = nextEntry
    await persistClinicUserPermissionsMap(clinicId, userMap)
  }
  return nextEntry
}

export async function hasClinicStaffPermission(
  clinicId: string,
  userRole: string | undefined | null,
  permission: keyof RoleStaffPermissions,
  userId?: string | null,
): Promise<boolean> {
  if (!userRole) return false
  if (userRole === 'yonetici' || userRole === 'moderator') return true
  if (!['calisan', 'hekim', 'host', 'sekreter', 'asistan'].includes(userRole)) return false
  const effective = await getEffectiveUserAccess(clinicId, { id: userId, role: userRole })
  return Boolean(effective.staffPermissions?.[permission])
}

export async function getClinicSmtpStatus(clinicId: string) {
  try {
    let settings = await resolveEffectiveConfig(clinicId, 'smtp')
    const row = await getRow(clinicId, 'smtp')
    if (!settings && row?.draft) {
      try {
        settings = decrypt(row.draft as Config)
      } catch {}
    }
    const hasCredentials = Boolean(settings?.host && settings?.port && settings?.username && settings?.password)
    const health = row?.health ? String(row.health) : 'unknown'
    const hasError = health === 'error' || health === 'failed'

    if (!hasCredentials) {
      return {
        ready: false,
        configured: false,
        enabled: false,
        health,
        fromAddress: null,
        error: 'İşletmenin E-posta (SMTP) entegrasyonu henüz tamamlanmamış. Yeni çalışan davet edebilmek için önce E-posta entegrasyonunu tamamlamanız gerekmektedir.',
      }
    }

    if (hasError) {
      return {
        ready: false,
        configured: true,
        enabled: Boolean(row?.enabled),
        health,
        fromAddress: settings?.fromAddress || settings?.username || null,
        error: 'E-posta (SMTP) bağlantısında hata tespit edildi. Davet e-postalarının iletilebilmesi için lütfen E-posta entegrasyon ayarlarını kontrol edin.',
      }
    }

    return {
      ready: true,
      configured: true,
      enabled: Boolean(row?.enabled ?? true),
      health,
      fromAddress: settings?.fromAddress || settings?.username || null,
      error: null,
    }
  } catch {
    return {
      ready: false,
      configured: false,
      enabled: false,
      health: 'unknown',
      fromAddress: null,
      error: 'E-posta (SMTP) entegrasyon durumu doğrulanamadı. Lütfen E-posta ayarlarını kontrol edin.',
    }
  }
}

export function roleLabelTr(role: string, specialty?: string | null): string {
  return coreRoleLabelTr(role, specialty)
}

export async function createStaffInvitation(input: {
  clinicId: string
  invitedBy: string | null
  name: string
  email: string
  role: string
  specialty?: string
  color?: string
  hostname: string
}) {
  await ensureStaffInvitationsSchema()

  const cleanName = String(input.name || '').trim()
  const cleanEmail = String(input.email || '').toLowerCase().trim()
  const cleanRole = String(input.role || 'calisan').trim()

  if (!cleanName || cleanName.length < 2) {
    throw new Error('Personelin adı ve soyadı zorunludur.')
  }
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Geçerli bir e-posta adresi girin.')
  }
  if (!['calisan', 'hekim', 'sekreter', 'host', 'asistan', 'yonetici'].includes(cleanRole)) {
    throw new Error('Geçersiz personel rolü seçildi.')
  }

  // 1. Check mandatory SMTP integration first
  const smtpStatus = await getClinicSmtpStatus(input.clinicId)
  if (!smtpStatus.ready) {
    throw new Error(smtpStatus.error || 'E-posta (SMTP) entegrasyonu tamamlanmadan kullanıcı daveti gönderilemez.')
  }

  // 2. Check if user is already an active member of this clinic
  const [existingUser] = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1)
  if (existingUser) {
    const [existingMembership] = await db
      .select()
      .from(clinicMemberships)
      .where(and(eq(clinicMemberships.clinicId, input.clinicId), eq(clinicMemberships.userId, existingUser.id)))
      .limit(1)
    if (existingMembership) {
      throw new Error('Bu e-posta adresine sahip kullanıcı zaten işletmenizde kayıtlıdır.')
    }
  }

  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, input.clinicId)).limit(1)
  const clinicName = clinic?.name || 'İşletme Yönetim Sistemi'

  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const kvkkText = DEFAULT_STAFF_KVKK_TEXT
  const kvkkVersion = hashToken(kvkkText).slice(0, 16)
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000) // 72 saat

  const rawHost = String(input.hostname || 'localhost:3000').trim()
  const hostOnly = rawHost.split(':')[0]?.toLowerCase() || 'localhost'
  const protocol = hostOnly === 'localhost' || hostOnly === '127.0.0.1' ? 'http' : 'https'
  const inviteLink = `${protocol}://${rawHost}/invite/${token}`

  // Expire any previous pending invitations for the same email in this clinic
  await db
    .update(staffInvitations)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(staffInvitations.clinicId, input.clinicId),
        eq(staffInvitations.email, cleanEmail),
        eq(staffInvitations.status, 'pending'),
      ),
    )

  const [created] = await db
    .insert(staffInvitations)
    .values({
      clinicId: input.clinicId,
      email: cleanEmail,
      name: cleanName,
      role: cleanRole,
      specialty: cleanRole !== 'yonetici' ? (input.specialty?.trim() || null) : null,
      color: cleanRole !== 'yonetici' ? (input.color?.trim() || '#2563eb') : null,
      tokenHash,
      status: 'pending',
      kvkkTextVersion: kvkkVersion,
      kvkkTextSnapshot: kvkkText,
      invitedBy: input.invitedBy,
      expiresAt,
    })
    .returning()

  // Send invitation email via tenant SMTP
  const roleLabel = roleLabelTr(cleanRole, input.specialty)
  const subject = `${clinicName} — Kullanıcı Hesabı ve KVKK Onay Daveti`
  const text = `Merhaba ${cleanName},\n\n${clinicName} tarafından "${roleLabel}" rolüyle işletme yönetim sistemine davet edildiniz.\n\nKVKK aydınlatma metnini onaylamak ve kendi şifrenizi belirleyerek hesabınızı aktifleştirmek için aşağıdaki bağlantıyı açın (72 saat geçerlidir):\n\n${inviteLink}\n\nİyi çalışmalar dileriz.`
  const html = `
    <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #f4f8fe; border: 1px solid #d8e5f6; border-radius: 14px; color: #0f172a;">
      <div style="background: #ffffff; padding: 22px; border-radius: 12px; border: 1px solid #d8e5f6;">
        <h2 style="margin: 0 0 8px; font-size: 18px; color: #075cff;">${clinicName}</h2>
        <p style="margin: 0 0 14px; font-size: 14px; color: #334155;">Merhaba <strong>${cleanName}</strong>,</p>
        <p style="margin: 0 0 16px; font-size: 13.5px; line-height: 1.55; color: #334155;">
          <strong>${clinicName}</strong> yönetim paneline <strong>${roleLabel}</strong>${input.specialty ? ` (${input.specialty})` : ''} olarak davet edildiniz.
          6698 sayılı KVKK gereğince kişisel verilerinizin işlenmesine ilişkin aydınlatma metnini bizzat onaylamanız ve kendi şifrenizi belirlemeniz gerekmektedir.
        </p>
        <div style="margin: 20px 0; text-align: center;">
          <a href="${inviteLink}" style="display: inline-block; padding: 11px 22px; background: #075cff; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; border-radius: 9px;">
            Hesabımı Oluştur ve KVKK Onayını Ver
          </a>
        </div>
        <p style="margin: 14px 0 0; font-size: 12px; color: #64748b; word-break: break-all;">
          Butona tıklayamıyorsanız bu bağlantıyı tarayıcınıza yapıştırın:<br/>
          <a href="${inviteLink}" style="color: #075cff;">${inviteLink}</a>
        </p>
      </div>
    </div>
  `

  try {
    await sendEmail({
      clinicId: input.clinicId,
      to: cleanEmail,
      subject,
      text,
      html,
    })
  } catch (err: any) {
    // Rollback invitation status if email delivery fails so admin sees the exact SMTP error
    await db.delete(staffInvitations).where(eq(staffInvitations.id, created.id))
    throw new Error(err?.message || 'Davet e-postası gönderilemedi. Lütfen E-posta (SMTP) entegrasyon ayarlarını kontrol edin.')
  }

  return {
    id: created.id,
    email: created.email,
    name: created.name,
    role: created.role,
    specialty: created.specialty,
    color: created.color,
    status: created.status,
    expiresAt: created.expiresAt,
    createdAt: created.createdAt,
  }
}

export async function listStaffInvitations(clinicId: string) {
  await ensureStaffInvitationsSchema()
  const rows = await db
    .select({
      id: staffInvitations.id,
      email: staffInvitations.email,
      name: staffInvitations.name,
      role: staffInvitations.role,
      specialty: staffInvitations.specialty,
      color: staffInvitations.color,
      status: staffInvitations.status,
      expiresAt: staffInvitations.expiresAt,
      createdAt: staffInvitations.createdAt,
      acceptedAt: staffInvitations.acceptedAt,
    })
    .from(staffInvitations)
    .where(and(eq(staffInvitations.clinicId, clinicId), eq(staffInvitations.status, 'pending')))
    .orderBy(desc(staffInvitations.createdAt))

  const now = new Date()
  return rows.map(r => ({
    ...r,
    status: r.expiresAt <= now ? 'expired' : r.status,
  }))
}

export async function revokeStaffInvitation(clinicId: string, invitationId: string) {
  await ensureStaffInvitationsSchema()
  const [updated] = await db
    .update(staffInvitations)
    .set({ status: 'revoked' })
    .where(and(eq(staffInvitations.id, invitationId), eq(staffInvitations.clinicId, clinicId)))
    .returning({ id: staffInvitations.id })
  return Boolean(updated)
}

export async function getPublicStaffInvite(token: string) {
  await ensureStaffInvitationsSchema()
  if (!token || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) {
    throw new Error('Davet bağlantısı geçersiz veya süresi dolmuş.')
  }
  const [invite] = await db
    .select()
    .from(staffInvitations)
    .where(eq(staffInvitations.tokenHash, hashToken(token)))
    .limit(1)

  if (!invite || invite.status !== 'pending' || invite.expiresAt <= new Date()) {
    throw new Error('Davet bağlantısı geçersiz, iptal edilmiş veya süresi dolmuş.')
  }

  const [clinic] = await db.select().from(clinics).where(eq(clinics.id, invite.clinicId)).limit(1)

  return {
    name: invite.name,
    email: invite.email,
    role: invite.role,
    roleLabel: roleLabelTr(invite.role, invite.specialty),
    specialty: invite.specialty,
    color: invite.color,
    clinicName: clinic?.name || 'İşletme',
    kvkkText: invite.kvkkTextSnapshot,
    kvkkVersion: invite.kvkkTextVersion,
    expiresAt: invite.expiresAt,
  }
}

export async function acceptPublicStaffInvite(
  token: string,
  input: {
    name?: string
    phone?: string
    password?: string
    kvkkAccepted?: boolean
    ipAddress?: string
  },
) {
  await ensureStaffInvitationsSchema()
  if (!token || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) {
    throw new Error('Davet bağlantısı geçersiz veya süresi dolmuş.')
  }
  if (input.kvkkAccepted !== true) {
    throw new Error('Hesabınızı oluşturmak için KVKK Aydınlatma Metni ve Açık Rıza onayını işaretlemeniz gerekmektedir.')
  }
  const password = String(input.password || '')
  if (password.length < 6) {
    throw new Error('Şifreniz en az 6 karakter olmalıdır.')
  }

  const tokenHash = hashToken(token)
  const passwordHash = await Bun.password.hash(password)

  const acceptedResult = await db.transaction(async tx => {
    const [invite] = await tx
      .select()
      .from(staffInvitations)
      .where(eq(staffInvitations.tokenHash, tokenHash))
      .for('update')

    if (!invite || invite.status !== 'pending' || invite.expiresAt <= new Date()) {
      throw new Error('Davet bağlantısı geçersiz, daha önce kullanılmış veya süresi dolmuş.')
    }

    const finalName = String(input.name || invite.name).trim() || invite.name
    const finalPhone = input.phone ? String(input.phone).trim() : null
    const now = new Date()

    const [existingUser] = await tx.select().from(users).where(eq(users.email, invite.email)).limit(1)
    let userId: string

    if (existingUser) {
      const [updatedUser] = await tx
        .update(users)
        .set({
          name: finalName,
          phone: finalPhone ?? existingUser.phone,
          passwordHash,
          role: invite.role,
          specialty: invite.specialty ?? existingUser.specialty,
          color: invite.color ?? existingUser.color,
          active: true,
          updatedAt: now,
        })
        .where(eq(users.id, existingUser.id))
        .returning()
      userId = updatedUser.id
    } else {
      const [createdUser] = await tx
        .insert(users)
        .values({
          email: invite.email,
          name: finalName,
          phone: finalPhone,
          passwordHash,
          role: invite.role,
          specialty: invite.specialty,
          color: invite.color || (['calisan', 'hekim'].includes(invite.role) ? '#2563eb' : null),
          active: true,
        })
        .returning()
      userId = createdUser.id
    }

    await tx
      .insert(clinicMemberships)
      .values({
        clinicId: invite.clinicId,
        userId,
        role: invite.role,
        active: true,
      })
      .onConflictDoUpdate({
        target: [clinicMemberships.clinicId, clinicMemberships.userId],
        set: { role: invite.role, active: true, updatedAt: now },
      })

    await tx
      .update(staffInvitations)
      .set({
        status: 'accepted',
        acceptedUserId: userId,
        kvkkAcceptedAt: now,
        acceptedAt: now,
      })
      .where(eq(staffInvitations.id, invite.id))

    await tx.insert(auditLog).values({
      clinicId: invite.clinicId,
      userId,
      action: 'staff_invite.accepted_with_kvkk',
      targetType: 'user',
      targetId: userId,
      metadata: {
        invitationId: invite.id,
        email: invite.email,
        role: invite.role,
        kvkkTextVersion: invite.kvkkTextVersion,
        kvkkAcceptedAt: now.toISOString(),
      },
      ipAddress: input.ipAddress || null,
    })

    return {
      ok: true,
      clinicId: invite.clinicId,
      userId,
      email: invite.email,
      name: finalName,
      role: invite.role,
    }
  })

  try {
    const cleanEmail = acceptedResult.email.toLowerCase().trim()
    const userMap = await getClinicUserPermissionsMap(acceptedResult.clinicId)
    const pendingAccess = userMap.byInviteEmail[cleanEmail]
    if (pendingAccess) {
      userMap.byUserId[acceptedResult.userId] = pendingAccess
      delete userMap.byInviteEmail[cleanEmail]
      await persistClinicUserPermissionsMap(acceptedResult.clinicId, userMap)
    }
  } catch {
    // Non-blocking: falls back cleanly to role defaults
  }

  return {
    ok: true,
    userId: acceptedResult.userId,
    email: acceptedResult.email,
    name: acceptedResult.name,
    role: acceptedResult.role,
  }
}

