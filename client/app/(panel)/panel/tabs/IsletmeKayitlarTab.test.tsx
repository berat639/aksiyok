// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../admin/components/PaymentsTab', () => ({ default: () => <div>finans-calisma-alani</div> }))
vi.mock('../../../../lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'yonetici', clinicId: 'c1' } }) }))
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
                      : {}
    return { ok: true, json: async () => body } as Response
  })
}

function Harness({ access, onLocked = () => {} }: { access: Record<IsletmeSection, SectionAccess>; onLocked?: (t: string) => void }) {
  const [section, setSection] = useState<IsletmeSection>('genel')
  return <IsletmeKayitlarTab section={section} onSectionChange={setSection} access={access} onLocked={onLocked} scope="c1" />
}

const allOpen: Record<IsletmeSection, SectionAccess> = {
  genel: { visible: true }, urunler: { visible: true }, personel: { visible: true }, finans: { visible: true }, stok: { visible: true },
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
  it('soldaki 5 bölüm sekmesi ve varsayılan Genel İşletme Bilgileri açılır', async () => {
    await act(async () => root.render(<Harness access={allOpen} />))
    await flush()
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent)
    expect(tabs.slice(0, 5).map((t) => t?.replace(/%\d+/, ''))).toEqual([
      '1.Genel İşletme Bilgileri', '2.Ürün ve Hizmet Bilgileri', '3.Personel ve Mesai', '4.Finans ve Raporlama', '5.Stok ve Bakım',
    ])
    expect(container.querySelector('#isletme-adi')).toBeTruthy()
    expect(container.querySelector('#isletme-adres-tarifi')).toBeTruthy()
    expect(container.textContent).toContain('İşletme konumu')
    expect(container.textContent).toContain('Cmt')
  })

  it('kategori alanı Google gibi popüler grup → alt kategori ve arama ile çalışır', async () => {
    await act(async () => root.render(<Harness access={allOpen} />))
    await flush()
    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!
    await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
    expect(container.textContent).toContain('Popüler kategorileri keşfedin')
    await click(byText('Hizmetler'))
    await click(byText('Çilingir'))
    expect(container.textContent).toContain('Çilingir · Birincil')

    await type(container.querySelector<HTMLInputElement>('input[role="combobox"]')!, 'kuaf')
    await click(Array.from(container.querySelectorAll('[role="option"]')).find((o) => o.textContent?.startsWith('Kuaför')))
    expect(container.textContent).toContain('Kuaför')
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

  it('ürün ve hizmet başlık + içerik olarak eklenir', async () => {
    await act(async () => root.render(<Harness access={allOpen} />))
    await flush()
    await click(container.querySelectorAll('[role="tab"]')[1])
    await type(container.querySelector<HTMLInputElement>('#teklif-baslik')!, 'Saç kesimi')
    await type(container.querySelector<HTMLTextAreaElement>('#teklif-icerik')!, '30 dakika, 400 ₺')
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '+ Süre & fiyat'))
    expect(container.querySelector<HTMLTextAreaElement>('#teklif-icerik')!.value).toContain('Ücret:')
    await click(container.querySelector('button[type="submit"]'))
    expect(container.querySelector('h4')?.textContent).toBe('Saç kesimi')
    expect(window.localStorage.getItem('axamaz.business-offerings.v1:c1')).toContain('Saç kesimi')

    await click(container.querySelector('[aria-label="Saç kesimi kopyala"]'))
    expect(container.textContent).toContain('Saç kesimi (Kopya)')

    await type(container.querySelector<HTMLInputElement>('[aria-label="Ürün ve hizmetlerde ara"]')!, 'olmayan')
    expect(container.textContent).toContain('Eşleşen kayıt bulunamadı')
  })

  it('personel ve mesai: işletme mesaisi yok, çalışan mesaisi ve yetkiler sade görünür', async () => {
    await act(async () => root.render(<Harness access={allOpen} />))
    await flush()
    await click(container.querySelectorAll('[role="tab"]')[2])
    await flush()
    expect(container.textContent).toContain('Çalışanlara göre mesai')
    expect(container.textContent).not.toContain('İşletme genel mesai')
    expect(container.textContent).toContain('Can Öz')
    expect(container.textContent).toContain('1 çalışan takvimde görünüyor')
    await click(container.querySelectorAll('[aria-expanded="false"]')[0])
    expect(container.querySelector('[aria-label="Çalışma günleri"]')).toBeTruthy()

    await click(Array.from(container.querySelectorAll('[role="tab"]')).find((t) => t.textContent?.startsWith('Personeller')))
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
})
