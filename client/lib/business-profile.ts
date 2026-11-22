// İşletme ve Kayıtlar sekmesinin saf (tarayıcı güvenli) veri katmanı.
// Genel işletme bilgileri ile ürün/hizmet kayıtları şimdilik yalnızca tarayıcıda
// (localStorage) saklanır; sunucu tarafı bağlantısı sonraki aşamada eklenecek.

export const WEEK_DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'] as const
export const WEEK_DAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'] as const

export type TimeRange = { start: string; end: string }
export type DayHours = { open: boolean; ranges: TimeRange[] }
/** 7 elemanlı dizi; 0 = Pazartesi … 6 = Pazar */
export type WeeklyHours = DayHours[]

export type BusinessLocation = { lat: number; lng: number; address: string }

export type BusinessProfile = {
  name: string
  primaryCategory: string
  extraCategories: string[]
  location: BusinessLocation | null
  addressDirections: string
  hours: WeeklyHours
  updatedAt?: string
}

export type OfferingKind = 'urun' | 'hizmet'
export type OfferingItem = { id: string; kind: OfferingKind; title: string; content: string; updatedAt: string }

/* ─────────────────────────── Kategoriler ─────────────────────────── */

export type CategoryGroup = { id: string; label: string; items: string[] }

/** Google İşletme Profili'ndeki "Popüler kategorileri keşfedin" yapısına benzer gruplar. */
export const CATEGORY_GROUPS: CategoryGroup[] = [
  { id: 'yiyecek', label: 'Yiyecek ve İçecek', items: ['Restoran', 'Kafe', 'Kahve Dükkanı', 'Fırın', 'Pastane', 'Tatlıcı', 'Bar', 'Fast Food Restoranı', 'Pizza Restoranı', 'Kebapçı', 'Balık Restoranı', 'Catering Hizmeti'] },
  { id: 'alisveris', label: 'Alışveriş', items: ['Giyim Mağazası', 'Ayakkabı Mağazası', 'Elektronik Mağazası', 'Market', 'Süpermarket', 'Kuyumcu', 'Çiçekçi', 'Kitapçı', 'Mobilya Mağazası', 'Optik Mağazası', 'Oyuncak Mağazası', 'Hırdavatçı'] },
  { id: 'hizmetler', label: 'Hizmetler', items: ['Temizlik Hizmeti', 'Nakliye Şirketi', 'Tesisatçı', 'Elektrikçi', 'Çilingir', 'Kuru Temizleme', 'Fotoğrafçı', 'Matbaa', 'Bilgisayar Tamircisi', 'Telefon Tamircisi', 'Haşere Kontrol Hizmeti', 'Organizasyon Şirketi'] },
  { id: 'konaklama', label: 'Otel ve Konaklama', items: ['Otel', 'Butik Otel', 'Pansiyon', 'Apart Otel', 'Hostel', 'Tatil Köyü', 'Bungalov'] },
  { id: 'saglik', label: 'Sağlık ve Tıp', items: ['Diş Kliniği', 'Diş Hekimi', 'Özel Muayenehane', 'Poliklinik', 'Fizik Tedavi Merkezi', 'Psikolog', 'Diyetisyen', 'Göz Kliniği', 'Tıbbi Laboratuvar', 'Eczane', 'Veteriner'] },
  { id: 'guzellik', label: 'Güzellik ve Bakım', items: ['Kuaför', 'Berber', 'Güzellik Salonu', 'Tırnak Salonu', 'Cilt Bakım Merkezi', 'Epilasyon Merkezi', 'Spa', 'Masaj Salonu', 'Dövme Stüdyosu'] },
  { id: 'otomotiv', label: 'Otomotiv', items: ['Oto Servis', 'Oto Yıkama', 'Lastikçi', 'Kaporta Boya Servisi', 'Oto Ekspertiz', 'Oto Galeri', 'Oto Kiralama', 'Oto Yedek Parça Mağazası'] },
  { id: 'egitim', label: 'Eğitim', items: ['Dershane', 'Etüt Merkezi', 'Dil Okulu', 'Sürücü Kursu', 'Müzik Kursu', 'Dans Okulu', 'Anaokulu', 'Özel Ders'] },
  { id: 'emlak', label: 'Emlak ve İnşaat', items: ['Emlak Ofisi', 'Gayrimenkul Danışmanı', 'İnşaat Şirketi', 'Mimarlık Ofisi', 'İç Mimar', 'Tadilat Firması'] },
  { id: 'finans', label: 'Finans ve Sigorta', items: ['Sigorta Acentesi', 'Muhasebe Bürosu', 'Mali Müşavir', 'Finansal Danışman', 'Döviz Bürosu'] },
  { id: 'profesyonel', label: 'Profesyonel Hizmetler', items: ['Avukat', 'Hukuk Bürosu', 'Noter', 'Danışmanlık Şirketi', 'Reklam Ajansı', 'Yazılım Şirketi', 'Tercüme Bürosu', 'İnsan Kaynakları Danışmanı'] },
  { id: 'spor', label: 'Spor ve Eğlence', items: ['Spor Salonu', 'Pilates Stüdyosu', 'Yoga Stüdyosu', 'Yüzme Havuzu', 'Halı Saha', 'Kaçış Oyunu', 'Oyun Salonu', 'Düğün Salonu'] },
]

export const foldTr = (value: string) =>
  value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

export type CategoryMatch = { label: string; group: string }

/** Tüm gruplarda Türkçe karakter duyarsız arama; önce başı eşleşenler gelir. */
export function searchCategories(query: string, limit = 8, exclude: string[] = []): CategoryMatch[] {
  const q = foldTr(query)
  if (!q) return []
  const skip = new Set(exclude.map(foldTr))
  const starts: CategoryMatch[] = []
  const contains: CategoryMatch[] = []
  for (const group of CATEGORY_GROUPS) {
    for (const label of group.items) {
      const folded = foldTr(label)
      if (skip.has(folded)) continue
      if (folded.startsWith(q) || folded.split(/\s+/).some((w) => w.startsWith(q))) starts.push({ label, group: group.label })
      else if (folded.includes(q)) contains.push({ label, group: group.label })
    }
  }
  return [...starts, ...contains].slice(0, limit)
}

export const isKnownCategory = (label: string) =>
  CATEGORY_GROUPS.some((g) => g.items.some((item) => foldTr(item) === foldTr(label)))

/* ─────────────────────────── Çalışma saatleri ─────────────────────────── */

export const TIME_STEP_MINUTES = 30

export const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export const fromMinutes = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`

/** 00:00 … 24:00 arası 30 dakikalık saat seçenekleri. */
export const TIME_OPTIONS: string[] = Array.from({ length: (24 * 60) / TIME_STEP_MINUTES + 1 }, (_, i) => fromMinutes(i * TIME_STEP_MINUTES))

export const defaultWeeklyHours = (): WeeklyHours =>
  WEEK_DAYS.map((_, i) => (i < 5 ? { open: true, ranges: [{ start: '09:00', end: '18:00' }] } : { open: false, ranges: [{ start: '10:00', end: '16:00' }] }))

/** Takvimin mevcut tek aralıklı ayarından (startTime/endTime/workingDays) haftalık plan üretir. */
export function weeklyHoursFromCalendar(cfg: { startTime?: string; endTime?: string; workingDays?: number[] } | null | undefined): WeeklyHours {
  if (!cfg?.startTime || !cfg?.endTime || !Array.isArray(cfg.workingDays) || cfg.workingDays.length === 0) return defaultWeeklyHours()
  const end = cfg.endTime === '00:00' ? '24:00' : cfg.endTime
  if (toMinutes(end) <= toMinutes(cfg.startTime)) return defaultWeeklyHours()
  return WEEK_DAYS.map((_, i) => ({ open: cfg.workingDays!.includes(i), ranges: [{ start: cfg.startTime!, end }] }))
}

export function validateDay(day: DayHours): string | null {
  if (!day.open) return null
  if (day.ranges.length === 0) return 'En az bir saat aralığı ekleyin.'
  const sorted = [...day.ranges].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!
    if (toMinutes(r.end) <= toMinutes(r.start)) return 'Kapanış saati açılış saatinden sonra olmalı.'
    const next = sorted[i + 1]
    if (next && toMinutes(next.start) < toMinutes(r.end)) return 'Saat aralıkları çakışmamalı.'
  }
  return null
}

export const validateWeek = (hours: WeeklyHours) => hours.map(validateDay)

export function formatDayHours(day: DayHours): string {
  if (!day.open) return 'Kapalı'
  return [...day.ranges]
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    .map((r) => (r.start === '00:00' && r.end === '24:00' ? '24 saat açık' : `${r.start}–${r.end}`))
    .join(', ')
}

/**
 * Takvimin kullandığı tek aralıklı mesai ayarı için zarf: açık günlerin en erken açılışı
 * ile en geç kapanışı. Açık gün yoksa veya geçersizse null döner.
 */
export function calendarEnvelope(hours: WeeklyHours): { startTime: string; endTime: string; workingDays: number[] } | null {
  if (validateWeek(hours).some(Boolean)) return null
  const openDays = hours.map((d, i) => ({ d, i })).filter(({ d }) => d.open && d.ranges.length > 0)
  if (openDays.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const { d } of openDays) {
    for (const r of d.ranges) {
      min = Math.min(min, toMinutes(r.start))
      max = Math.max(max, toMinutes(r.end))
    }
  }
  return { startTime: fromMinutes(min), endTime: fromMinutes(max), workingDays: openDays.map(({ i }) => i) }
}

/* ─────────────────────────── Profil ─────────────────────────── */

export const emptyBusinessProfile = (hours: WeeklyHours = defaultWeeklyHours()): BusinessProfile => ({
  name: '',
  primaryCategory: '',
  extraCategories: [],
  location: null,
  addressDirections: '',
  hours,
})

export type ProfileIssues = Partial<Record<'name' | 'primaryCategory' | 'location' | 'hours', string>>

export function validateProfile(p: BusinessProfile): ProfileIssues {
  const issues: ProfileIssues = {}
  if (!p.name.trim()) issues.name = 'İşletme adı gerekli.'
  if (!p.primaryCategory.trim()) issues.primaryCategory = 'Bir işletme kategorisi seçin.'
  if (!p.location) issues.location = 'İşletme konumunu belirleyin.'
  const dayIssue = validateWeek(p.hours).find(Boolean)
  if (dayIssue) issues.hours = dayIssue
  else if (!p.hours.some((d) => d.open)) issues.hours = 'En az bir gün açık olmalı.'
  return issues
}

/** Profil doluluk yüzdesi (ad, kategori, konum, adres tarifi, çalışma saatleri). */
export function profileCompletion(p: BusinessProfile): number {
  const checks = [
    Boolean(p.name.trim()),
    Boolean(p.primaryCategory),
    Boolean(p.location),
    Boolean(p.addressDirections.trim()),
    p.hours.some((d) => d.open) && !validateWeek(p.hours).some(Boolean),
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function sanitizeHours(raw: unknown): WeeklyHours | null {
  if (!Array.isArray(raw) || raw.length !== 7) return null
  const timeRe = /^([01]\d|2[0-4]):[0-5]\d$/
  return raw.map((d) => {
    const day = d as Partial<DayHours>
    const ranges = Array.isArray(day?.ranges)
      ? day.ranges.filter((r): r is TimeRange => Boolean(r) && timeRe.test(String(r.start)) && timeRe.test(String(r.end)))
      : []
    return { open: Boolean(day?.open), ranges: ranges.length ? ranges : [{ start: '09:00', end: '18:00' }] }
  })
}

export function parseStoredProfile(raw: string | null): BusinessProfile | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<BusinessProfile>
    const hours = sanitizeHours(data.hours)
    if (!hours) return null
    const loc = data.location
    return {
      name: typeof data.name === 'string' ? data.name : '',
      primaryCategory: typeof data.primaryCategory === 'string' ? data.primaryCategory : '',
      extraCategories: Array.isArray(data.extraCategories) ? data.extraCategories.filter((c): c is string => typeof c === 'string') : [],
      location:
        loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng))
          ? { lat: Number(loc.lat), lng: Number(loc.lng), address: String(loc.address || '') }
          : null,
      addressDirections: typeof data.addressDirections === 'string' ? data.addressDirections : '',
      hours,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    }
  } catch {
    return null
  }
}

export function parseStoredOfferings(raw: string | null): OfferingItem[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data
      .filter((x) => x && typeof x.id === 'string' && typeof x.title === 'string')
      .map((x) => ({
        id: x.id,
        kind: x.kind === 'urun' ? 'urun' : 'hizmet',
        title: String(x.title),
        content: String(x.content || ''),
        updatedAt: String(x.updatedAt || ''),
      }))
  } catch {
    return []
  }
}

const PROFILE_KEY = 'axamaz.business-profile.v1'
const OFFERINGS_KEY = 'axamaz.business-offerings.v1'
const scoped = (key: string, scope?: string | null) => (scope ? `${key}:${scope}` : key)

const safeStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export const loadBusinessProfile = (scope?: string | null) => parseStoredProfile(safeStorage()?.getItem(scoped(PROFILE_KEY, scope)) ?? null)
export const saveBusinessProfile = (profile: BusinessProfile, scope?: string | null) => {
  const next = { ...profile, updatedAt: new Date().toISOString() }
  try { safeStorage()?.setItem(scoped(PROFILE_KEY, scope), JSON.stringify(next)) } catch { /* depolama dolu/kapalı */ }
  return next
}
export const loadOfferings = (scope?: string | null) => parseStoredOfferings(safeStorage()?.getItem(scoped(OFFERINGS_KEY, scope)) ?? null)
export const saveOfferings = (items: OfferingItem[], scope?: string | null) => {
  try { safeStorage()?.setItem(scoped(OFFERINGS_KEY, scope), JSON.stringify(items)) } catch { /* depolama dolu/kapalı */ }
}

/* ─────────────────────────── Personel mesai yardımcıları ─────────────────────────── */

export const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const atNoon = (key: string) => new Date(`${key}T12:00:00`)
export const addDaysKey = (key: string, days: number) => {
  const d = atNoon(key)
  d.setDate(d.getDate() + days)
  return dateKey(d)
}
export const mondayOf = (key: string) => {
  const d = atNoon(key)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return dateKey(d)
}
export const monthBounds = (key: string) => {
  const d = atNoon(key)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return { start: `${key.slice(0, 7)}-01`, end: `${key.slice(0, 7)}-${String(last).padStart(2, '0')}` }
}
export const weekdayIndex = (key: string) => (atNoon(key).getDay() + 6) % 7

export type ShiftLike = { id: string; userId: string; date: string; startTime: string; endTime: string }
export type StaffWeekSummary = { days: number[]; startTime: string; endTime: string; shiftIds: Record<number, string> }

/** Bir çalışanın verilen haftadaki mesailerini gün listesi ve en sık kullanılan saat aralığıyla özetler. */
export function summarizeStaffWeek(shifts: ShiftLike[], userId: string, weekStart: string): StaffWeekSummary | null {
  const weekEnd = addDaysKey(weekStart, 6)
  const mine = shifts.filter((s) => s.userId === userId && s.date >= weekStart && s.date <= weekEnd)
  if (mine.length === 0) return null
  const counts = new Map<string, number>()
  const shiftIds: Record<number, string> = {}
  for (const s of mine) {
    const k = `${s.startTime.slice(0, 5)}-${s.endTime.slice(0, 5)}`
    counts.set(k, (counts.get(k) || 0) + 1)
    shiftIds[weekdayIndex(s.date)] = s.id
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const [startTime, endTime] = (top?.[0] || '09:00-18:00').split('-') as [string, string]
  const days = Object.keys(shiftIds).map(Number).sort((a, b) => a - b)
  return { days, startTime, endTime, shiftIds }
}

/** Sunucudaki takvim sütunu kuralıyla aynı: açık tercih varsa o, yoksa çalışan rolü (calisan/hekim). */
export const isOnCalendar = (u: { role: string; active?: boolean; staffPermissions?: { showOnCalendar?: boolean } }) => {
  if (u.active === false) return false
  const pref = u.staffPermissions?.showOnCalendar
  if (typeof pref === 'boolean') return pref
  return u.role === 'calisan' || u.role === 'hekim'
}

export const formatDayList = (days: number[]) => (days.length ? days.map((d) => WEEK_DAYS_SHORT[d]).join(', ') : 'Gün yok')
