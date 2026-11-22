import { describe, expect, it } from 'vitest'
import {
  addDaysIsoDate,
  buildMaintenanceRowValues,
  buildPostponeMaintenanceValues,
  buildStockRowValues,
  extractStockCategories,
  filterMaintenanceItems,
  filterStockItems,
  inverseMovementType,
  sortMaintenanceItems,
  sortStockItems,
  stockSeverity,
  type MaintenanceOverviewItem,
  type StockOverviewItem,
} from './stock-helpers'
import type { DynamicColumnDef, DynamicModuleMapping, DynamicTableDef } from '@/app/admin/components/dynamic-tables/types'

const col = (patch: Partial<DynamicColumnDef> & Pick<DynamicColumnDef, 'id' | 'tableId' | 'name' | 'slug' | 'fieldType'>): DynamicColumnDef => ({
  clinicId: 'c1',
  isPrimaryTitle: false,
  isRequired: false,
  isUnique: false,
  showInTable: true,
  width: 120,
  sortOrder: 0,
  config: {},
  ...patch,
})

const tbl = (id: string, name: string, slug: string, columns: DynamicColumnDef[]): DynamicTableDef => ({
  id,
  clinicId: 'c1',
  name,
  slug,
  icon: 'box',
  color: '#2563eb',
  description: null,
  canvasX: 0,
  canvasY: 0,
  sortOrder: 0,
  rowCount: 0,
  archivedRowCount: 0,
  columns,
})

const stockItem = (patch: Partial<StockOverviewItem>): StockOverviewItem => ({
  rowId: 'r1',
  tableId: 't1',
  tableName: 'Stok',
  name: 'Kalem',
  categoryLabel: 'Sarf',
  unitLabel: 'Adet',
  quantity: 10,
  minThreshold: 3,
  unitCost: 100,
  expiryDate: null,
  daysUntilExpiry: null,
  isExpired: false,
  isExpiringSoon: false,
  isLowStock: false,
  notes: null,
  ...patch,
})

const maintItem = (patch: Partial<MaintenanceOverviewItem>): MaintenanceOverviewItem => ({
  rowId: 'm1',
  tableId: 't2',
  tableName: 'Bakım',
  name: 'Klima',
  typeLabel: 'Periyodik Bakım',
  isPeriodic: true,
  periodicDays: 90,
  scheduledDate: '2026-11-25',
  nextDate: null,
  effectiveDueDate: '2026-11-25',
  daysUntilDue: 3,
  isMaintenanceDue: true,
  estimatedCost: 1500,
  status: 'scheduled',
  statusLabel: 'Planlandı',
  notes: null,
  ...patch,
})

describe('stok yardımcıları', () => {
  it('önce SKT geçmiş, sonra kritik, sonra SKT yaklaşan, sonra normal alfabetik sıralar', () => {
    const items = [
      stockItem({ rowId: '1', name: 'Zımba' }),
      stockItem({ rowId: '2', name: 'Ambalaj', isExpiringSoon: true, daysUntilExpiry: 10 }),
      stockItem({ rowId: '3', name: 'Filtre', isLowStock: true, quantity: 1 }),
      stockItem({ rowId: '4', name: 'Boya', isExpired: true, daysUntilExpiry: -2 }),
    ]
    expect(stockSeverity(items[3]!)).toBe('expired')
    expect(sortStockItems(items).map((x) => x.name)).toEqual(['Boya', 'Filtre', 'Ambalaj', 'Zımba'])
  })

  it('uyarı, kategori ve arama filtrelerini birlikte uygular', () => {
    const items = [
      stockItem({ rowId: '1', name: 'Kâğıt Havlu', categoryLabel: 'Temizlik', isLowStock: true }),
      stockItem({ rowId: '2', name: 'Kahve Çekirdeği', categoryLabel: 'Gıda', isExpiringSoon: true }),
      stockItem({ rowId: '3', name: 'Yazıcı Toneri', categoryLabel: 'Ofis', notes: 'Siyah kartuş' }),
    ]
    expect(extractStockCategories(items)).toEqual(['Gıda', 'Ofis', 'Temizlik'])
    expect(filterStockItems(items, { alert: 'low_stock', category: 'all', query: '' })).toHaveLength(1)
    expect(filterStockItems(items, { alert: 'all', category: 'Ofis', query: 'kartuş' }).map((i) => i.rowId)).toEqual(['3'])
  })

  it('hareket tersini doğru üretir (Geri Al)', () => {
    expect(inverseMovementType('giris')).toBe('cikis')
    expect(inverseMovementType('cikis')).toBe('giris')
    expect(inverseMovementType('fire')).toBe('giris')
    expect(inverseMovementType('iade')).toBe('giris')
  })

  it('stok satır değerlerini dinamik sütun eşlemesiyle (isteğe bağlı SKT dahil) üretir', () => {
    const table = tbl('t1', 'Ürün & Demirbaş Stoku', 'stok', [
      col({ id: 'c_name', tableId: 't1', name: 'Ad', slug: 'ad', fieldType: 'text', isRequired: true, isPrimaryTitle: true }),
      col({ id: 'c_cat', tableId: 't1', name: 'Kategori', slug: 'kat', fieldType: 'select', config: { options: [{ id: 'sarf', label: 'Sarf Malzeme', color: '#0284c7' }] } }),
      col({ id: 'c_qty', tableId: 't1', name: 'Stok', slug: 'stok', fieldType: 'number' }),
      col({ id: 'c_exp', tableId: 't1', name: 'SKT', slug: 'skt', fieldType: 'date' }),
    ])
    const mapping: DynamicModuleMapping = {
      categoryColumnId: 'c_cat',
      quantityColumnId: 'c_qty',
      expiryDateColumnId: 'c_exp',
    }
    const vals = buildStockRowValues(table, mapping, {
      name: 'Temizlik Bezi',
      category: 'Sarf Malzeme',
      quantity: 12,
      minThreshold: 4,
      unitCost: 45,
      expiryDate: null,
    })
    expect(vals).toEqual({ c_name: 'Temizlik Bezi', c_cat: 'sarf', c_qty: 12, c_exp: null })
  })
})

describe('bakım yardımcıları', () => {
  it('geciken ve yaklaşan bakımları öne alır, erteleme tarihini hesaplar', () => {
    expect(addDaysIsoDate('2026-11-22', 7)).toBe('2026-11-29')
    const list = [
      maintItem({ rowId: '1', name: 'Kompresör', status: 'completed', isMaintenanceDue: false, daysUntilDue: 40 }),
      maintItem({ rowId: '2', name: 'Klima', daysUntilDue: 5, isMaintenanceDue: true }),
      maintItem({ rowId: '3', name: 'Jeneratör', effectiveDueDate: '2026-11-19', daysUntilDue: -3, isMaintenanceDue: true, status: 'overdue' }),
    ]
    expect(sortMaintenanceItems(list).map((m) => m.name)).toEqual(['Jeneratör', 'Klima', 'Kompresör'])
    expect(filterMaintenanceItems(list, { onlyDue: true, query: '' })).toHaveLength(2)

    const table = tbl('t2', 'Bakımlar', 'bakim', [
      col({ id: 'c_name', tableId: 't2', name: 'Ad', slug: 'ad', fieldType: 'text', isRequired: true, isPrimaryTitle: true }),
      col({ id: 'c_sched', tableId: 't2', name: 'Tarih', slug: 'tarih', fieldType: 'date' }),
      col({ id: 'c_status', tableId: 't2', name: 'Durum', slug: 'durum', fieldType: 'select', config: { options: [{ id: 'planlandi', label: 'Planlandı', color: '#2563eb' }] } }),
      col({ id: 'c_per', tableId: 't2', name: 'Periyodik', slug: 'per', fieldType: 'boolean' }),
      col({ id: 'c_days', tableId: 't2', name: 'Gün', slug: 'gun', fieldType: 'number' }),
    ])
    const mapping: DynamicModuleMapping = {
      scheduledDateColumnId: 'c_sched',
      statusColumnId: 'c_status',
      isPeriodicColumnId: 'c_per',
      periodicDaysColumnId: 'c_days',
    }
    const created = buildMaintenanceRowValues(table, mapping, {
      name: 'Hizmet Aracı',
      scheduledDate: '2026-12-01',
      isPeriodic: true,
      periodicDays: 180,
      estimatedCost: 3000,
      setPlannedStatus: true,
    })
    expect(created).toEqual({ c_name: 'Hizmet Aracı', c_sched: '2026-12-01', c_per: true, c_days: 180, c_status: 'planlandi' })

    const postponed = buildPostponeMaintenanceValues(table, mapping, list[2]!, 7, '2026-11-22')
    expect(postponed.nextIso).toBe('2026-11-29')
    expect(postponed.values).toEqual({ c_sched: '2026-11-29', c_status: 'planlandi' })
  })
})
