// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../admin/components/PaymentsTab', () => ({ default: () => <div>finans-calisma-alani</div> }))
vi.mock('../../../admin/components/IntegrationsTab', () => ({ default: () => <div>ayarlar-entegrasyon-alani</div> }))
vi.mock('../../../../lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'yonetici', clinicId: 'c1' }, refreshUser: vi.fn() }) }))
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import IsletmeKayitlarTab, { type IsletmeSection, type SectionAccess } from './IsletmeKayitlarTab'
import { resetGoogleMapsLoaderForTests } from '@/lib/google-maps-loader'

const users = [
  { id: 'u1', name: 'Elif Yılmaz', email: 'elif@isletme.com', role: 'yonetici', active: true, color: '#0284c7' },
  { id: 'u2', name: 'Can Öz', email: 'can@isletme.com', role: 'calisan', active: true, allowedTabs: ['calendar', 'klinik'], staffPermissions: { showOnCalendar: true } },
]

const stockSchema = {
  canManageSchema: true,
  tables: [
    {
      id: 't-inv',
      name: 'Ürün & Demirbaş Stoku',
      slug: 'stok',
      icon: 'box',
      color: '#2563eb',
      positionX: 0,
      positionY: 0,
      sortOrder: 0,
      columns: [
        { id: 'c_name', tableId: 't-inv', name: 'Ad', slug: 'ad', fieldType: 'text', isRequired: true, isPrimaryTitle: true, sortOrder: 0, width: 160, config: {} },
        { id: 'c_qty', tableId: 't-inv', name: 'Miktar', slug: 'miktar', fieldType: 'number', isRequired: false, isPrimaryTitle: false, sortOrder: 1, width: 100, config: {} },
      ],
    },
    {
      id: 't-maint',
      name: 'Demirbaş & Periyodik Bakımlar',
      slug: 'bakim',
      icon: 'wrench',
      color: '#0284c7',
      positionX: 0,
      positionY: 0,
      sortOrder: 1,
      columns: [
        { id: 'm_name', tableId: 't-maint', name: 'Ad', slug: 'ad', fieldType: 'text', isRequired: true, isPrimaryTitle: true, sortOrder: 0, width: 160, config: {} },
        { id: 'm_sched', tableId: 't-maint', name: 'Planlanan', slug: 'planlanan', fieldType: 'date', isRequired: false, isPrimaryTitle: false, sortOrder: 1, width: 120, config: {} },
      ],
    },
  ],
  relations: [],
  appointmentConfigs: [],
  moduleConfigs: [],
}

const stockOverview = {
  hasStockTables: true,
  inventoryTableIds: ['t-inv'],
  maintenanceTableIds: ['t-maint'],
  movementTableIds: [],
  allStockModuleTableIds: ['t-inv', 't-maint'],
  moduleTables: [
    { tableId: 't-inv', tableName: 'Ürün & Demirbaş Stoku', moduleRole: 'stock_inventory', mapping: { quantityColumnId: 'c_qty' }, isAutoDetected: false },
    { tableId: 't-maint', tableName: 'Demirbaş & Periyodik Bakımlar', moduleRole: 'asset_maintenance', mapping: { scheduledDateColumnId: 'm_sched' }, isAutoDetected: false },
  ],
  alerts: { sktExpiredCount: 0, sktSoonCount: 0, lowStockCount: 1, maintenanceDueCount: 1, totalStockItems: 1, totalStockValue: 900 },
  inventoryItems: [
    {
      rowId: 'inv-1', tableId: 't-inv', tableName: 'Ürün & Demirbaş Stoku', name: 'Kâğıt Havlu', categoryLabel: 'Sarf',
      unitLabel: 'Paket', quantity: 3, minThreshold: 5, unitCost: 300, expiryDate: null, daysUntilExpiry: null,
      isExpired: false, isExpiringSoon: false, isLowStock: true, notes: null,
    },
  ],
  maintenanceItems: [
    {
      rowId: 'maint-1', tableId: 't-maint', tableName: 'Demirbaş & Periyodik Bakımlar', name: 'Klima Ünitesi',
      typeLabel: 'Periyodik Bakım', isPeriodic: true, periodicDays: 90, scheduledDate: '2026-11-28', nextDate: null,
      effectiveDueDate: '2026-11-28', daysUntilDue: 6, isMaintenanceDue: true, estimatedCost: 1200,
      status: 'scheduled', statusLabel: 'Planlandı', notes: null,
    },
  ],
  recentMovements: [
    { rowId: 'mv-1', tableId: 't-mov', title: 'Alım — Kâğıt Havlu', movementTypeLabel: 'Stok Girişi / Alım', quantity: 5, totalAmount: 1500, date: '2026-11-20', actor: 'Elif Yılmaz', itemTitle: 'Kâğıt Havlu' },
  ],
  legacyMigration: { hasUnmigratedLegacyStock: false, unmigratedItems: 0, unmigratedMaintenances: 0 },
}

function mockFetch() {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const body = url.startsWith('/api/admin/users')
      ? users
      : url.startsWith('/api/shifts')
        ? []
        : url.startsWith('/api/dental/staff-permissions')
          ? { effective: { editShifts: true, manageStaff: true }, smtpStatus: { ready: true, message: '' } }
          : url.startsWith('/api/yonetici/users/invitations')
            ? { invitations: [] }
            : url.startsWith('/api/calendar/working-hours')
              ? { startTime: '09:00', endTime: '19:00', workingDays: [0, 1, 2, 3, 4, 5] }
              : url.startsWith('/api/dynamic-tables/schema')
                ? stockSchema
                : url.startsWith('/api/dynamic-tables/stock/overview')
                  ? stockOverview
                  : url.startsWith('/api/dynamic-tables/stock/movement')
                    ? { nextQuantity: 4 }
                    : url.startsWith('/api/dynamic-tables/stock/complete-maintenance')
                      ? { computedNextDate: '2027-02-20' }
                      : url.startsWith('/api/dynamic-tables/offerings/validate')
                        ? { approved: true, reason: 'Uygun.' }
                        : {}
    return { ok: true, json: async () => body } as Response
  })
}

function Harness({ access, onLocked = () => {} }: { access: Partial<Record<IsletmeSection, SectionAccess>>; onLocked?: (t: string) => void }) {
  const [section, setSection] = useState<IsletmeSection>('genel')
  return <IsletmeKayitlarTab section={section} onSectionChange={setSection} access={access} onLocked={onLocked} scope="c1" />
}

const allOpen: Partial<Record<IsletmeSection, SectionAccess>> = {
  genel: { visible: true },
  urunler: { visible: true },
  personel: { visible: true },
  finans: { visible: true },
  stok: { visible: true },
  ayarlar: { visible: true },
}

let container: HTMLDivElement
let root: Root
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const byText = (text: string) => Array.from(container.querySelectorAll<HTMLElement>('button, h2, h3, span, p, label, div')).find((el) => el.textContent?.trim() === text)
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }) }
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('fetch', mockFetch())
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('İşletme ve Kayıtlar', () => {
  it('soldaki bölüm sekmeleri (Ayarlar ve Entegrasyonlar dahil) ve varsayılan Genel İşletme Bilgileri açılır', async () => {
    await act(async () => root.render(<Harness access={allOpen} />))
    await flush()
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent)
    expect(tabs.slice(0, 6).map((t) => t?.replace(/%\d+/, ''))).toEqual([
      '1.Genel İşletme Bilgileri',
      '2.Ürün ve Hizmet Bilgileri',
      '3.Personel ve Mesai',
      '4.Finans ve Raporlama',
      '5.Stok ve Bakım',
      '6.Ayarlar ve Entegrasyonlar',
    ])
    expect(container.querySelector('#isletme-adi')).toBeTruthy()
    expect(container.querySelector('#isletme-adres-tarifi')).toBeTruthy()
    expect(container.textContent).toContain('İşletme konumu')
    expect(container.textContent).toContain('Cmt')
    expect(container.querySelector('[aria-label="İşletme logosu yükle"]')).toBeTruthy()

    await click(container.querySelectorAll('[role="tab"]')[5])
    await flush()
    expect(container.textContent).toContain('ayarlar-entegrasyon-alani')
  })

  it('kategori alanı Google gibi tek kategori seçer ve arama ile değiştirilebilir', async () => {
    await act(async () => root.render(<Harness access={allOpen} />))
    await flush()
    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!
    await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
    expect(container.textContent).toContain('Popüler kategorileri keşfedin')
    await click(byText('Hizmetler'))
    await click(byText('Çilingir'))
    expect(container.textContent).toContain('Çilingir')
    expect(container.textContent).not.toContain('· Birincil')

    await type(container.querySelector<HTMLInputElement>('input[role="combobox"]')!, 'kuaf')
    await click(Array.from(container.querySelectorAll('[role="option"]')).find((o) => o.textContent?.startsWith('Kuaför')))
    expect(container.textContent).toContain('Kuaför')
    expect(container.textContent).not.toContain('Çilingir')
  })

  it('eksik alanlarla kaydetmeye izin vermez; ad ve kategori hataları gösterilir', async () => {
    await act(async () => root.render(<Harness access={allOpen} />))
    await flush()
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Kaydet'))
    expect(container.textContent).toContain('İşletme adı gerekli.')
    expect(container.textContent).toContain('Bir işletme kategorisi seçin.')
    expect(container.textContent).toContain('İşletme konumunu belirleyin.')
  })

  it('çalışma saatleri takvimin mevcut ayarından başlar ve gün gün açılıp kapanır', async () => {
    await act(async () => root.render(<Harness access={allOpen} />))
    await flush()
    const sat = container.querySelector<HTMLButtonElement>('[aria-label="Cumartesi açık"]')
    expect(sat).toBeTruthy()
    expect(container.textContent).toContain('09:00')
    await click(container.querySelector('[aria-label="Pazar kapalı"]'))
    expect(container.querySelector('[aria-label="Pazar açık"]')).toBeTruthy()
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Günlere özel saat belirle')))
    expect(container.textContent).toContain('Pazartesi')
  })

  it('ürün ve hizmet başlık + içerik olarak eklenir; tekrarlanan AI kutuları yoktur ve boşken sektör şablonu butonu görünür', async () => {
    await act(async () => root.render(<Harness access={allOpen} />))
    await flush()
    await click(container.querySelectorAll('[role="tab"]')[1])
    expect(container.textContent).not.toContain('AI ile Örnek Ekle')
    expect(container.textContent).not.toContain('AI ile Şablon Ekle')
    expect(container.textContent).toContain('Sektöre Uygun Şablon Ekle')

    await type(container.querySelector<HTMLInputElement>('#teklif-baslik')!, 'Saç kesimi')
    await type(container.querySelector<HTMLTextAreaElement>('#teklif-icerik')!, '30 dakika, 400 ₺')
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '+ Süre & fiyat'))
    expect(container.querySelector<HTMLTextAreaElement>('#teklif-icerik')!.value).toContain('Ücret:')
    await click(container.querySelector('button[type="submit"]'))
    await flush()
    expect(container.querySelector('h4')?.textContent).toBe('Saç kesimi')
    expect(window.localStorage.getItem('axamaz.business-offerings.v1:c1')).toContain('Saç kesimi')
    expect(container.textContent).not.toContain('Sektöre Uygun Şablon Ekle')

    await click(container.querySelector('[aria-label="Saç kesimi kopyala"]'))
    expect(container.textContent).toContain('Saç kesimi (Kopya)')

    await type(container.querySelector<HTMLInputElement>('[aria-label="Ürün ve hizmetlerde ara"]')!, 'olmayan')
    expect(container.textContent).toContain('Eşleşen kayıt bulunamadı')
  })

  it('personel ve mesai: tek tabloda mesai ve yetkiler birlikte düzenlenir', async () => {
    await act(async () => root.render(<Harness access={allOpen} />))
    await flush()
    await click(container.querySelectorAll('[role="tab"]')[2])
    await flush()
    expect(container.textContent).toContain('Personeller ve Mesai')
    expect(container.textContent).not.toContain('İşletme genel mesai')
    expect(container.textContent).toContain('Can Öz')
    expect(container.textContent).toContain('1 çalışan takvimde görünüyor')
    await click(container.querySelector('[aria-label="Can Öz mesaisini düzenle"]'))
    expect(container.querySelector('[aria-label="Çalışma günleri"]')).toBeTruthy()

    await click(container.querySelector('[aria-label="Can Öz yetkilerini düzenle"]'))
    expect(container.querySelector('[aria-label="Can Öz — Takvimde görünsün"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Can Öz — Finans ve Raporlama"]')).toBeTruthy()
  })

  it('finans mevcut çalışma alanını gösterir; paket kilidinde yükseltme açılır', async () => {
    const onLocked = vi.fn()
    await act(async () => root.render(<Harness access={{ ...allOpen, finans: { visible: true, locked: true } }} onLocked={onLocked} />))
    await flush()
    await click(container.querySelectorAll('[role="tab"]')[3])
    expect(onLocked).toHaveBeenCalledWith('Finans ve Raporlama')

    await act(async () => root.render(<Harness access={allOpen} />))
    await click(container.querySelectorAll('[role="tab"]')[3])
    expect(container.textContent).toContain('finans-calisma-alani')
  })

  it('Google Maps yoksa Google gömülü haritaya düşer, arama ve anahtar varsa etkileşimli harita çalışır', async () => {
    resetGoogleMapsLoaderForTests()
    await act(async () => root.render(<Harness access={allOpen} />))
    await flush()
    const iframe = container.querySelector<HTMLIFrameElement>('iframe[title="İşletme konumu Google Harita"]')
    expect(iframe?.src).toContain('maps.google.com/maps')
    expect(iframe?.src).not.toContain('openstreetmap')

    await type(container.querySelector<HTMLInputElement>('#isletme-konum-ara')!, 'Çankaya')
    await act(async () => { await new Promise((r) => setTimeout(r, 360)) })
    await click(Array.from(container.querySelectorAll('[role="option"]')).find((o) => o.textContent?.includes('Çankaya')))
    expect(container.textContent).toContain('Çankaya, Ankara')
    expect(container.querySelector<HTMLIFrameElement>('iframe')?.src).toContain('39.9179,32.8627')
  })

  it('5. Stok ve Bakım: /api/dynamic-tables/stock/* ile hareket, geri alma, bakım erteleme ve geçmiş çalışır', async () => {
    const fetchSpy = mockFetch()
    vi.stubGlobal('fetch', fetchSpy)
    await act(async () => root.render(<Harness access={allOpen} />))
    await flush()
    await click(container.querySelectorAll('[role="tab"]')[4])
    await flush()

    expect(container.textContent).toContain('Kâğıt Havlu')
    expect(container.textContent).not.toContain('Klinik & Sağlık')
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Giriş / Çıkış'))
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Alım / Giriş')))
    await flush()
    expect(fetchSpy.mock.calls.some(([u]) => String(u) === '/api/dynamic-tables/stock/movement')).toBe(true)
    expect(container.textContent).toContain('Geri al')

    await click(Array.from(container.querySelectorAll('[role="tab"]')).find((t) => t.textContent?.startsWith('Bakım')))
    expect(container.textContent).toContain('Klima Ünitesi')
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '+7g'))
    await flush()
    expect(fetchSpy.mock.calls.some(([u, init]) => String(u) === '/api/dynamic-tables/rows/maint-1' && (init as any)?.method === 'PUT')).toBe(true)

    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Tamamla'))
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Bakımı Tamamla'))
    await flush()
    expect(fetchSpy.mock.calls.some(([u]) => String(u) === '/api/dynamic-tables/stock/complete-maintenance')).toBe(true)

    await click(Array.from(container.querySelectorAll('[role="tab"]')).find((t) => t.textContent?.startsWith('Geçmiş')))
    expect(container.textContent).toContain('Elif Yılmaz')
  })

  it('İşletme Özet: Analiz Kartı Ekle, sabit Paket ve Abonelik kartı gösterir; Yeni hareket/trend rozetleri göstermez', async () => {
    window.localStorage.setItem(
      'axamaz.business-profile.v1:c1',
      JSON.stringify({
        name: 'Örnek Emlak Ofisi',
        primaryCategory: 'Emlak Ofisi',
        extraCategories: [],
        location: { lat: 39.91, lng: 32.86, address: 'Çankaya, Ankara' },
        addressDirections: 'Kat 2',
        hours: Array.from({ length: 7 }, () => ({ open: true, ranges: [{ start: '09:00', end: '18:00' }] })),
        extraBusinesses: [],
      }),
    )

    const kpiBootstrap = {
      sources: [
        { id: 'builtin:finance', kind: 'builtin', name: 'Finans', group: 'İşletme Modülleri', rowCount: 12, columns: [] },
      ],
      presets: [],
      cards: [
        {
          id: 'c-1',
          title: 'Aylık Ciro',
          sourceId: 'builtin:finance',
          kind: 'time',
          aggregation: 'sum',
          dateRange: '30d',
          chart: 'number',
          icon: 'wallet',
          chip: 'brand',
        },
      ],
      metrics: {
        'c-1': {
          id: 'c-1',
          title: 'Aylık Ciro',
          tooltip: 'Toplam gelir',
          sourceName: 'Finans',
          icon: 'wallet',
          chip: 'brand',
          unit: { suffix: ' ₺', decimals: 0 },
          goodDirection: 'up',
          previous: 0,
          compareLabel: 'önceki dönem',
          upWord: 'artış',
          downWord: 'düşüş',
          defaultChart: 'number',
          supports: ['number'],
          kind: 'time',
          headline: 'sum',
          points: [{ label: 'Bu Ay', value: 45000 }],
        },
      },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.startsWith('/api/dynamic-tables/kpi/bootstrap')
          ? kpiBootstrap
          : url.startsWith('/api/billing/subscription')
            ? {
                entitlements: {
                  planId: 'demo',
                  planName: 'Demo Paket',
                  planStatus: 'trial',
                  maxUsers: 2,
                  activeUsersCount: 1,
                  trialDaysRemaining: 5,
                },
              }
            : url.startsWith('/api/admin/users')
              ? users
              : url.startsWith('/api/admin/settings/branding')
                ? { logoUrl: '' }
                : {}
        return { ok: true, json: async () => body } as Response
      }),
    )

    function OzetHarness() {
      const [section, setSection] = useState<IsletmeSection>('ozet')
      return <IsletmeKayitlarTab section={section} onSectionChange={setSection} access={{ ozet: { visible: true }, ...allOpen }} onLocked={() => {}} scope="c1" />
    }

    await act(async () => root.render(<OzetHarness />))
    await flush()

    const text = container.textContent || ''
    expect(text).toContain('Analiz Kartı Ekle')
    expect(text).not.toContain('KPI Kartı Ekle')
    expect(text).toContain('Paket ve Abonelik')
    expect(text).toContain('Demo Paket')
    expect(text).toContain("Pro'ya Yükselt")
    expect(container.querySelector('[aria-label="Paket ve Abonelik Bilgileri"]')).toBeTruthy()
    expect(text).toContain('Aylık Ciro')
    expect(text).toContain('45.000 ₺')
    expect(text).not.toContain('Yeni hareket')
    expect(text).not.toContain('önceki dönem')
    expect(text).not.toContain('artış')
  })

  it('Ürün ve Hizmet: sektör dışı kayıt tek sade uyarı ile reddedilir; boş katalogda şablon ekleme çalışır', async () => {
    window.localStorage.setItem(
      'axamaz.business-profile.v1:c1',
      JSON.stringify({
        name: 'Örnek Emlak Ofisi',
        primaryCategory: 'Emlak Ofisi',
        extraCategories: [],
        location: { lat: 39.91, lng: 32.86, address: 'Çankaya, Ankara' },
        addressDirections: '',
        hours: Array.from({ length: 7 }, () => ({ open: true, ranges: [{ start: '09:00', end: '18:00' }] })),
        extraBusinesses: [],
      }),
    )

    const fetchSpy = vi.fn(async (url: string) => {
      if (url.startsWith('/api/dynamic-tables/offerings/validate')) {
        return {
          ok: true,
          json: async () => ({
            approved: false,
            reason: 'Bu kayıt seçili Emlak Ofisi kategorinizle uyumlu görünmüyor.',
          }),
        } as Response
      }
      if (url.startsWith('/api/dynamic-tables/offerings/ai-generate')) {
        return {
          ok: true,
          json: async () => ({
            reply: '3 şablon eklendi.',
            items: [
              { kind: 'hizmet', title: 'Konut Kiralama Danışmanlığı', content: 'Süreç yönetimi ve kira sözleşmesi.' },
              { kind: 'hizmet', title: 'Gayrimenkul Ekspertiz', content: 'Bölgesel piyasa değerleme raporu.' },
            ],
          }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    vi.stubGlobal('fetch', fetchSpy)

    function UrunHarness() {
      const [section, setSection] = useState<IsletmeSection>('urunler')
      return <IsletmeKayitlarTab section={section} onSectionChange={setSection} access={{ ozet: { visible: true }, ...allOpen }} onLocked={() => {}} scope="c1" />
    }

    await act(async () => root.render(<UrunHarness />))
    await flush()

    await type(container.querySelector<HTMLInputElement>('#teklif-baslik')!, 'Alakasız ürün')
    await type(container.querySelector<HTMLTextAreaElement>('#teklif-icerik')!, 'Sektör dışı test')
    await click(container.querySelector('button[type="submit"]'))
    await flush()

    const alerts = container.querySelectorAll('[role="alert"]')
    expect(alerts.length).toBe(1)
    expect(alerts[0].textContent).toContain('Emlak Ofisi kategorinizle uyumlu görünmüyor')
    expect(container.textContent).not.toContain('AI önerisini uygula')
    expect(container.querySelectorAll('h4').length).toBe(0)

    const tplBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Emlak Ofisi İçin Şablon Ekle'),
    )
    expect(tplBtn).toBeTruthy()
    await click(tplBtn)
    await flush()

    expect(container.textContent).toContain('Konut Kiralama Danışmanlığı')
    expect(container.textContent).toContain('Gayrimenkul Ekspertiz')
    expect(container.textContent).not.toContain('Emlak Ofisi İçin Şablon Ekle')
  })

  it('İşletme Özet: Aktif Görüşme, Aktif Hesap ve Yapay Zeka Harcaması kartları Analiz Kartı Ekle üzerinden eklenebilir', async () => {
    window.localStorage.setItem(
      'axamaz.business-profile.v1:c1',
      JSON.stringify({
        name: 'Örnek İşletme',
        primaryCategory: 'Emlak Ofisi',
        extraCategories: [],
        location: { lat: 39.91, lng: 32.86, address: 'Çankaya, Ankara' },
        addressDirections: '',
        hours: Array.from({ length: 7 }, () => ({ open: true, ranges: [{ start: '09:00', end: '18:00' }] })),
        extraBusinesses: [],
      }),
    )

    const kpiBootstrap = {
      sources: [
        {
          id: 'builtin:assistant_live',
          kind: 'builtin',
          name: 'Canlı Asistan ve Hesap',
          group: 'İşletme Modülleri',
          rowCount: 1,
          columns: [
            { id: 'activeCalls', name: 'Aktif Görüşme', fieldType: 'number' },
            { id: 'activeAccounts', name: 'Aktif Hesap', fieldType: 'number' },
          ],
        },
        {
          id: 'builtin:ai_usage',
          kind: 'builtin',
          name: 'Yapay Zeka Harcaması',
          group: 'İşletme Modülleri',
          rowCount: 1,
          columns: [
            { id: 'costTry', name: 'Harcama', fieldType: 'currency', currencySymbol: '₺' },
            { id: 'source', name: 'Kanal', fieldType: 'select', values: ['Telefon', 'WhatsApp'] },
          ],
        },
      ],
      presets: [
        {
          id: 'preset-live-calls',
          title: 'Aktif Görüşme',
          sourceId: 'builtin:assistant_live',
          kind: 'time',
          aggregation: 'sum',
          valueColumnId: 'activeCalls',
          dateRange: 'all',
          chart: 'number',
          icon: 'phone',
          chip: 'mint',
        },
        {
          id: 'preset-live-accounts',
          title: 'Aktif Hesap',
          sourceId: 'builtin:assistant_live',
          kind: 'time',
          aggregation: 'sum',
          valueColumnId: 'activeAccounts',
          dateRange: 'all',
          chart: 'number',
          icon: 'cloud',
          chip: 'brand',
        },
        {
          id: 'preset-ai-spend',
          title: 'Yapay Zeka Harcaması',
          sourceId: 'builtin:ai_usage',
          kind: 'time',
          aggregation: 'sum',
          valueColumnId: 'costTry',
          dateColumnId: 'date',
          dateRange: 'today',
          chart: 'number',
          icon: 'credit',
          chip: 'violet',
        },
        {
          id: 'preset-assistant-daily-replies',
          title: 'Günlük Asistan Cevaplama',
          sourceId: 'builtin:ai_usage',
          kind: 'time',
          aggregation: 'sum',
          valueColumnId: 'replyCount',
          dateColumnId: 'date',
          dateRange: 'today',
          chart: 'number',
          icon: 'bot',
          chip: 'mint',
        },
      ],
      cards: [],
      metrics: {},
    }

    const evalMap: Record<string, any> = {
      'preset-live-calls': {
        id: 'preset-live-calls',
        title: 'Aktif Görüşme',
        tooltip: 'Şu an devam eden canlı görüşmeler',
        sourceName: 'Canlı Asistan ve Hesap',
        icon: 'phone',
        chip: 'mint',
        unit: { decimals: 0 },
        goodDirection: 'up',
        previous: null,
        compareLabel: '',
        upWord: 'artış',
        downWord: 'düşüş',
        defaultChart: 'number',
        supports: ['number'],
        kind: 'time',
        headline: 'sum',
        headlineValue: 0,
        points: [{ label: 'Şimdi', value: 0 }],
      },
      'preset-live-accounts': {
        id: 'preset-live-accounts',
        title: 'Aktif Hesap',
        subtitle: 'Ortak Anahtar',
        tooltip: 'Aktif hesap: Ortak Anahtar',
        sourceName: 'Canlı Asistan ve Hesap',
        icon: 'cloud',
        chip: 'brand',
        unit: { decimals: 0 },
        goodDirection: 'up',
        previous: null,
        compareLabel: '',
        upWord: 'artış',
        downWord: 'düşüş',
        defaultChart: 'number',
        supports: ['number'],
        kind: 'time',
        headline: 'sum',
        headlineValue: 1,
        points: [{ label: 'Aktif', value: 1 }],
      },
      'preset-ai-spend': {
        id: 'preset-ai-spend',
        title: 'Yapay Zeka Harcaması',
        subtitle: 'Bu ay ₺1,03',
        tooltip: 'Bugünkü harcama: ₺0,00 · Bu ay: ₺1,03',
        sourceName: 'Yapay Zeka Harcaması',
        icon: 'credit',
        chip: 'violet',
        unit: { prefix: '₺', decimals: 2 },
        goodDirection: 'down',
        previous: null,
        compareLabel: '',
        upWord: 'artış',
        downWord: 'düşüş',
        defaultChart: 'number',
        supports: ['number', 'area', 'bar'],
        kind: 'time',
        headline: 'sum',
        headlineValue: 0,
        points: [{ label: 'Bugün', value: 0 }],
      },
      'preset-assistant-daily-replies': {
        id: 'preset-assistant-daily-replies',
        title: 'Günlük Asistan Cevaplama',
        subtitle: 'Bu ay 42 cevaplama',
        tooltip: 'Bugün: 14 cevaplama · Bu ay: 42 cevaplama',
        sourceName: 'Yapay Zeka ve Asistan Kullanımı',
        icon: 'bot',
        chip: 'mint',
        unit: { decimals: 0 },
        goodDirection: 'up',
        previous: null,
        compareLabel: '',
        upWord: 'artış',
        downWord: 'düşüş',
        defaultChart: 'number',
        supports: ['number', 'area', 'bar'],
        kind: 'time',
        headline: 'sum',
        headlineValue: 14,
        points: [{ label: 'Bugün', value: 14 }],
      },
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith('/api/dynamic-tables/kpi/bootstrap')) {
          return { ok: true, json: async () => kpiBootstrap } as Response
        }
        if (url.startsWith('/api/dynamic-tables/kpi/evaluate')) {
          const body = JSON.parse(String(init?.body || '{}'))
          const metrics: Record<string, any> = {}
          for (const c of body.cards || []) {
            if (evalMap[c.id]) metrics[c.id] = evalMap[c.id]
          }
          return { ok: true, json: async () => ({ metrics }) } as Response
        }
        if (url.startsWith('/api/admin/users')) return { ok: true, json: async () => users } as Response
        return { ok: true, json: async () => ({}) } as Response
      }),
    )

    function OzetLiveHarness() {
      const [section, setSection] = useState<IsletmeSection>('ozet')
      return <IsletmeKayitlarTab section={section} onSectionChange={setSection} access={{ ozet: { visible: true }, ...allOpen }} onLocked={() => {}} scope="c1" />
    }

    await act(async () => root.render(<OzetLiveHarness />))
    await flush()

    const addBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Analiz Kartı Ekle'),
    )
    await click(addBtn)
    await flush()

    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain('Aktif Görüşme')
    expect(dialog.textContent).toContain('Aktif Hesap')
    expect(dialog.textContent).toContain('Yapay Zeka Harcaması')
    expect(dialog.textContent).toContain('Günlük Asistan Cevaplama')

    for (const label of ['Aktif Görüşme', 'Aktif Hesap', 'Yapay Zeka Harcaması', 'Günlük Asistan Cevaplama']) {
      const chip = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
      await click(chip)
      await flush()
    }

    const text = container.textContent || ''
    expect(text).toContain('Aktif Görüşme')
    expect(text).toContain('Aktif Hesap')
    expect(text).toContain('Ortak Anahtar')
    expect(text).toContain('Yapay Zeka Harcaması')
    expect(text).toContain('₺0,00')
    expect(text).toContain('Bu ay ₺1,03')
    expect(text).toContain('Günlük Asistan Cevaplama')
    expect(text).toContain('14')
    expect(text).toContain('Bu ay 42 cevaplama')
  })
})
