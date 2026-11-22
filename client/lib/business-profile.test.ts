import { describe, expect, it } from 'vitest'
import {
  CATEGORY_GROUPS,
  calendarEnvelope,
  defaultWeeklyHours,
  formatDayHours,
  isOnCalendar,
  monthBounds,
  mondayOf,
  parseStoredOfferings,
  parseStoredProfile,
  profileCompletion,
  searchCategories,
  summarizeStaffWeek,
  validateDay,
  validateProfile,
  weekdayIndex,
  weeklyHoursFromCalendar,
  emptyBusinessProfile,
  type WeeklyHours,
} from './business-profile'

describe('işletme kategorisi', () => {
  it('Google tarzı popüler gruplar ilk dört sırada', () => {
    expect(CATEGORY_GROUPS.slice(0, 4).map((g) => g.label)).toEqual(['Yiyecek ve İçecek', 'Alışveriş', 'Hizmetler', 'Otel ve Konaklama'])
  })

  it('Türkçe karakter duyarsız arar, başı eşleşenleri öne alır ve seçilenleri dışlar', () => {
    expect(searchCategories('dis').map((r) => r.label)).toEqual(expect.arrayContaining(['Diş Kliniği', 'Diş Hekimi']))
    expect(searchCategories('KUAFÖR')[0]).toEqual({ label: 'Kuaför', group: 'Güzellik ve Bakım' })
    expect(searchCategories('klinik', 10, ['Diş Kliniği']).map((r) => r.label)).not.toContain('Diş Kliniği')
    expect(searchCategories('   ')).toEqual([])
  })
})

describe('çalışma saatleri', () => {
  it('varsayılan: hafta içi 09:00–18:00 açık, hafta sonu kapalı', () => {
    const h = defaultWeeklyHours()
    expect(h).toHaveLength(7)
    expect(h.filter((d) => d.open)).toHaveLength(5)
    expect(formatDayHours(h[0]!)).toBe('09:00–18:00')
    expect(formatDayHours(h[6]!)).toBe('Kapalı')
  })

  it('ters ve çakışan aralıkları yakalar, öğle arasını kabul eder', () => {
    expect(validateDay({ open: true, ranges: [{ start: '18:00', end: '09:00' }] })).toMatch(/sonra/)
    expect(validateDay({ open: true, ranges: [{ start: '09:00', end: '13:00' }, { start: '12:00', end: '18:00' }] })).toMatch(/çakış/)
    expect(validateDay({ open: true, ranges: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }] })).toBeNull()
    expect(validateDay({ open: false, ranges: [] })).toBeNull()
  })

  it('takvim zarfını açık günlerin en erken açılış / en geç kapanışından üretir', () => {
    const h: WeeklyHours = defaultWeeklyHours()
    h[0] = { open: true, ranges: [{ start: '08:30', end: '12:00' }, { start: '13:00', end: '20:00' }] }
    h[5] = { open: true, ranges: [{ start: '10:00', end: '24:00' }] }
    expect(calendarEnvelope(h)).toEqual({ startTime: '08:30', endTime: '24:00', workingDays: [0, 1, 2, 3, 4, 5] })
    expect(calendarEnvelope(h.map((d) => ({ ...d, open: false })))).toBeNull()
  })

  it('takvimin mevcut tek aralıklı ayarından haftalık plan kurar', () => {
    const h = weeklyHoursFromCalendar({ startTime: '10:00', endTime: '19:00', workingDays: [0, 2, 4] })
    expect(h.map((d) => d.open)).toEqual([true, false, true, false, true, false, false])
    expect(h[0]!.ranges[0]).toEqual({ start: '10:00', end: '19:00' })
    expect(weeklyHoursFromCalendar(null)).toEqual(defaultWeeklyHours())
  })
})

describe('profil doğrulama ve saklama', () => {
  it('zorunlu alanları ve doluluğu hesaplar', () => {
    const p = emptyBusinessProfile()
    expect(Object.keys(validateProfile(p)).sort()).toEqual(['location', 'name', 'primaryCategory'])
    const filled = { ...p, name: 'Moda Kuaför', primaryCategory: 'Kuaför', location: { lat: 40.98, lng: 29.02, address: 'Moda' }, addressDirections: 'Kat 2' }
    expect(validateProfile(filled)).toEqual({})
    expect(profileCompletion(p)).toBe(20)
    expect(profileCompletion(filled)).toBe(100)
  })

  it('bozuk kayıtları güvenle yok sayar', () => {
    expect(parseStoredProfile('{bozuk')).toBeNull()
    expect(parseStoredProfile(JSON.stringify({ name: 'X', hours: [] }))).toBeNull()
    const ok = parseStoredProfile(JSON.stringify({ ...emptyBusinessProfile(), name: 'X', location: { lat: '41', lng: '29', address: 'A' } }))
    expect(ok?.location).toEqual({ lat: 41, lng: 29, address: 'A' })
    expect(parseStoredOfferings('[{"id":"a","title":"T","kind":"urun"},{"x":1}]')).toEqual([{ id: 'a', kind: 'urun', title: 'T', content: '', updatedAt: '' }])
  })
})

describe('personel mesai yardımcıları', () => {
  it('hafta ve ay sınırlarını Pazartesi başlangıçlı hesaplar', () => {
    expect(mondayOf('2026-11-22')).toBe('2026-11-16')
    expect(weekdayIndex('2026-11-16')).toBe(0)
    expect(monthBounds('2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })

  it('haftalık mesaiyi gün listesi ve en sık saat aralığıyla özetler', () => {
    const shifts = [
      { id: '1', userId: 'u', date: '2026-11-16', startTime: '09:00:00', endTime: '18:00:00' },
      { id: '2', userId: 'u', date: '2026-11-18', startTime: '09:00', endTime: '18:00' },
      { id: '3', userId: 'u', date: '2026-11-20', startTime: '10:00', endTime: '14:00' },
      { id: '4', userId: 'u', date: '2026-11-24', startTime: '09:00', endTime: '18:00' },
      { id: '5', userId: 'x', date: '2026-11-17', startTime: '09:00', endTime: '18:00' },
    ]
    expect(summarizeStaffWeek(shifts, 'u', '2026-11-16')).toEqual({ days: [0, 2, 4], startTime: '09:00', endTime: '18:00', shiftIds: { 0: '1', 2: '2', 4: '3' } })
    expect(summarizeStaffWeek(shifts, 'u', '2026-11-30')).toBeNull()
  })

  it('takvim sütunu kuralı sunucuyla aynı', () => {
    expect(isOnCalendar({ role: 'calisan', active: true })).toBe(true)
    expect(isOnCalendar({ role: 'sekreter', active: true })).toBe(false)
    expect(isOnCalendar({ role: 'yonetici', active: true, staffPermissions: { showOnCalendar: true } })).toBe(true)
    expect(isOnCalendar({ role: 'calisan', active: false })).toBe(false)
  })
})
