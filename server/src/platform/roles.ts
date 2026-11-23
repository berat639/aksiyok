export type BusinessTemplate = 'general' | 'dental_clinic'

export const CORE_ROLES = ['yonetici', 'calisan'] as const
export type CoreRole = (typeof CORE_ROLES)[number]

export const ADMIN_ROLES = ['yonetici', 'moderator'] as const
export const LEGACY_EMPLOYEE_ROLES = ['calisan', 'hekim', 'sekreter', 'asistan', 'host'] as const

export const CANONICAL_ASSIGNABLE_PANEL_TABS = [
  'calendar',
  'records',
  'incoming',
  'finance',
  'inventory',
  'knowledge',
  'team',
] as const

export type CanonicalPanelTabId = (typeof CANONICAL_ASSIGNABLE_PANEL_TABS)[number]

const TAB_TO_CANONICAL: Record<string, string> = {
  patients: 'records',
  payments: 'finance',
  stok: 'inventory',
  klinik: 'team',
  'gelen-kayitlar': 'incoming',
  gelen_kayitlar: 'incoming',
  whatsapp: 'incoming',
}

const CANONICAL_TO_LEGACY_TAB: Record<string, string> = {
  records: 'patients',
  finance: 'payments',
  inventory: 'stok',
  team: 'klinik',
}

export function normalizeBusinessTemplate(value: string | null | undefined): BusinessTemplate {
  return value === 'dental_clinic' ? 'dental_clinic' : 'general'
}

export function isDentalTemplate(value: string | null | undefined): boolean {
  return normalizeBusinessTemplate(value) === 'dental_clinic'
}

export function isAdminRole(role: string | null | undefined): boolean {
  const cleaned = (role ?? '').trim().toLowerCase()
  return cleaned === 'yonetici' || cleaned === 'moderator'
}

export function isEmployeeRole(role: string | null | undefined): boolean {
  const cleaned = (role ?? '').trim().toLowerCase()
  return (LEGACY_EMPLOYEE_ROLES as readonly string[]).includes(cleaned)
}

export function isCalendarColumnRole(role: string | null | undefined, showOnCalendar?: boolean): boolean {
  const cleaned = (role ?? '').trim().toLowerCase()
  if (typeof showOnCalendar === 'boolean') {
    if (!showOnCalendar) return false
    return isEmployeeRole(cleaned) || isAdminRole(cleaned)
  }
  return cleaned === 'calisan' || cleaned === 'hekim'
}

export function normalizeCoreRole(role: string | null | undefined): string {
  const cleaned = (role ?? '').trim().toLowerCase()
  if (!cleaned) return 'calisan'
  if (cleaned === 'yonetici' || cleaned === 'moderator') return cleaned
  if (
    cleaned === 'calisan' ||
    cleaned === 'hekim' ||
    cleaned === 'sekreter' ||
    cleaned === 'asistan' ||
    cleaned === 'host' ||
    cleaned === 'uzman'
  ) {
    return 'calisan'
  }
  return cleaned
}

export function coreRoleLabelTr(role: string | null | undefined, specialty?: string | null): string {
  if (specialty && specialty.trim()) {
    return specialty.trim()
  }
  const cleaned = (role ?? '').trim().toLowerCase()
  if (cleaned === 'yonetici') return 'Yönetici'
  if (cleaned === 'moderator') return 'Moderatör'
  if (cleaned === 'calisan') return 'Çalışan'
  if (cleaned === 'hekim') return 'Çalışan (Uzman)'
  if (cleaned === 'sekreter' || cleaned === 'host') return 'Karşılama / Sekreterya'
  if (cleaned === 'asistan') return 'Asistan'
  return role?.trim() || 'Çalışan'
}

export function normalizePanelTabId(tabId: string): string {
  const cleaned = tabId.trim().toLowerCase()
  return TAB_TO_CANONICAL[cleaned] ?? cleaned
}

export function expandPanelTabAliases(tabs: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const raw of tabs) {
    const cleaned = raw.trim().toLowerCase()
    if (!cleaned) continue
    out.add(cleaned)
    const canonical = TAB_TO_CANONICAL[cleaned]
    if (canonical) out.add(canonical)
    const legacy = CANONICAL_TO_LEGACY_TAB[cleaned]
    if (legacy) out.add(legacy)
  }
  return [...out]
}

export function hasPanelTabAccess(allowedTabs: Iterable<string>, requestedTab: string): boolean {
  const target = normalizePanelTabId(requestedTab)
  for (const raw of allowedTabs) {
    if (normalizePanelTabId(raw) === target) return true
  }
  return false
}

export interface DefaultKnowledgeCategorySeed {
  slug: string
  label: string
  icon: string
  color: string
  sortOrder: number
}

export const DEFAULT_NEUTRAL_CATEGORIES: DefaultKnowledgeCategorySeed[] = [
  { slug: 'genel', label: 'Genel', icon: '🌐', color: '#60a5fa', sortOrder: 0 },
  { slug: 'hizmetler', label: 'Hizmetler', icon: '💼', color: '#38bdf8', sortOrder: 1 },
  { slug: 'fiyatlandirma', label: 'Fiyatlandırma', icon: '💳', color: '#8b5cf6', sortOrder: 2 },
  { slug: 'kampanya', label: 'Kampanya', icon: '🎯', color: '#fb923c', sortOrder: 3 },
  { slug: 'sss', label: 'SSS', icon: '❓', color: '#f59e0b', sortOrder: 4 },
  { slug: 'musteri', label: 'Müşteri', icon: '👤', color: '#10b981', sortOrder: 5 },
  { slug: 'randevu', label: 'Randevu', icon: '📅', color: '#3b82f6', sortOrder: 6 },
]

export const DENTAL_CLINIC_EXTRA_CATEGORIES: DefaultKnowledgeCategorySeed[] = [
  { slug: 'tedavi', label: 'Tedavi', icon: '🦷', color: '#34d399', sortOrder: 7 },
  { slug: 'estetik', label: 'Estetik', icon: '✨', color: '#a78bfa', sortOrder: 8 },
  { slug: 'hasta', label: 'Hasta', icon: '🩺', color: '#f472b6', sortOrder: 9 },
]

export function getDefaultCategoriesForTemplate(
  businessTemplate: string | null | undefined,
): DefaultKnowledgeCategorySeed[] {
  if (isDentalTemplate(businessTemplate)) {
    return [...DEFAULT_NEUTRAL_CATEGORIES, ...DENTAL_CLINIC_EXTRA_CATEGORIES]
  }
  return DEFAULT_NEUTRAL_CATEGORIES
}
