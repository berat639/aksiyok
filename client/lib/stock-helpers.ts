// Sektörden bağımsız Stok ve Bakım bölümü için saf yardımcı fonksiyonlar ve tipler.
// /api/dynamic-tables/stock/* yanıtlarını işler, sıralar, filtreler ve satır payload'ları oluşturur.

import type { DynamicModuleMapping, DynamicModuleRole, DynamicTableDef } from '@/app/admin/components/dynamic-tables/types'

export type StockAlertFilter = 'all' | 'low_stock' | 'skt_expired' | 'skt_soon' | 'maintenance_due'
export type MovementType = 'giris' | 'cikis' | 'fire' | 'imha' | 'iade'

export interface StockOverviewItem {
  rowId: string
  tableId: string
  tableName: string
  name: string
  categoryLabel: string
  unitLabel: string
  quantity: number
  minThreshold: number
  unitCost: number
  expiryDate: string | null
  daysUntilExpiry: number | null
  isExpired: boolean
  isExpiringSoon: boolean
  isLowStock: boolean
  notes: string | null
}

export interface MaintenanceOverviewItem {
  rowId: string
  tableId: string
  tableName: string
  name: string
  typeLabel: string
  isPeriodic: boolean
  periodicDays: number
  scheduledDate: string | null
  nextDate: string | null
  effectiveDueDate: string | null
  daysUntilDue: number | null
  isMaintenanceDue: boolean
  estimatedCost: number
  status: 'scheduled' | 'completed' | 'overdue'
  statusLabel: string
  notes: string | null
}

export interface MovementOverviewItem {
  rowId: string
  tableId: string
  title: string
  movementTypeLabel: string
  quantity: number
  totalAmount: number
  date: string
  actor: string | null
  itemTitle: string | null
}

export interface StockModuleTableInfo {
  tableId: string
  tableName: string
  moduleRole: DynamicModuleRole
  mapping: DynamicModuleMapping
  isAutoDetected: boolean
}

export interface StockOverviewData {
  hasStockTables: boolean
  inventoryTableIds: string[]
  maintenanceTableIds: string[]
  movementTableIds: string[]
  allStockModuleTableIds: string[]
  moduleTables: StockModuleTableInfo[]
  alerts: {
    sktExpiredCount: number
    sktSoonCount: number
    lowStockCount: number
    maintenanceDueCount: number
    totalStockItems: number
    totalStockValue: number
  }
  inventoryItems: StockOverviewItem[]
  maintenanceItems: MaintenanceOverviewItem[]
  recentMovements: MovementOverviewItem[]
  legacyMigration: {
    hasUnmigratedLegacyStock: boolean
    unmigratedItems: number
    unmigratedMaintenances: number
  }
}

export const UNIVERSAL_UNITS = ['Adet', 'Paket', 'Kutu', 'Kg', 'Litre', 'Metre', 'Set', 'Saat'] as const
export const PERIOD_PRESETS = [
  { days: 30, label: 'Aylık (30g)' },
  { days: 90, label: '3 Aylık (90g)' },
  { days: 180, label: '6 Aylık (180g)' },
  { days: 365, label: 'Yıllık (365g)' },
] as const

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  giris: 'Alım / Giriş',
  cikis: 'Kullanım',
  iade: 'İade',
  fire: 'Fire / Zayi',
  imha: 'İmha',
}

export function todayIsoDate(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDaysIsoDate(baseIso: string, days: number): string {
  const match = baseIso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  const d = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0)
    : new Date()
  d.setDate(d.getDate() + days)
  return todayIsoDate(d)
}

export function inverseMovementType(type: MovementType): MovementType {
  return type === 'giris' ? 'cikis' : 'giris'
}

export type StockSeverity = 'expired' | 'low' | 'soon' | 'ok'

export function stockSeverity(item: Pick<StockOverviewItem, 'isExpired' | 'isLowStock' | 'isExpiringSoon'>): StockSeverity {
  if (item.isExpired) return 'expired'
  if (item.isLowStock) return 'low'
  if (item.isExpiringSoon) return 'soon'
  return 'ok'
}

const SEVERITY_ORDER: Record<StockSeverity, number> = { expired: 0, low: 1, soon: 2, ok: 3 }

/** Süresi geçmiş ve kritik stok kalemlerini üstte, normal kalemleri alfabetik sıralar. */
export function sortStockItems(items: StockOverviewItem[]): StockOverviewItem[] {
  return [...items].sort((a, b) => {
    const diff = SEVERITY_ORDER[stockSeverity(a)] - SEVERITY_ORDER[stockSeverity(b)]
    if (diff !== 0) return diff
    return a.name.localeCompare(b.name, 'tr-TR')
  })
}

/** Geciken ve yaklaşan bakımları en üste, tamamlananları sona alır. */
export function sortMaintenanceItems(items: MaintenanceOverviewItem[]): MaintenanceOverviewItem[] {
  const rank = (m: MaintenanceOverviewItem) => {
    if (m.daysUntilDue !== null && m.daysUntilDue < 0) return 0
    if (m.isMaintenanceDue) return 1
    if (m.status !== 'completed') return 2
    return 3
  }
  return [...items].sort((a, b) => {
    const diff = rank(a) - rank(b)
    if (diff !== 0) return diff
    const da = a.daysUntilDue ?? 99999
    const db = b.daysUntilDue ?? 99999
    if (da !== db) return da - db
    return a.name.localeCompare(b.name, 'tr-TR')
  })
}

export function extractStockCategories(items: StockOverviewItem[]): string[] {
  const set = new Set<string>()
  for (const it of items) {
    const label = it.categoryLabel?.trim()
    if (label) set.add(label)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr-TR'))
}

export function filterStockItems(
  items: StockOverviewItem[],
  opts: { alert: StockAlertFilter; category: string; query: string },
): StockOverviewItem[] {
  const q = opts.query.trim().toLocaleLowerCase('tr-TR')
  return sortStockItems(
    items.filter((it) => {
      if (opts.alert === 'low_stock' && !it.isLowStock) return false
      if (opts.alert === 'skt_expired' && !it.isExpired) return false
      if (opts.alert === 'skt_soon' && !it.isExpiringSoon) return false
      if (opts.category !== 'all' && it.categoryLabel !== opts.category) return false
      if (!q) return true
      const hay = `${it.name} ${it.categoryLabel} ${it.unitLabel} ${it.notes ?? ''}`.toLocaleLowerCase('tr-TR')
      return hay.includes(q)
    }),
  )
}

export function filterMaintenanceItems(
  items: MaintenanceOverviewItem[],
  opts: { onlyDue: boolean; query: string },
): MaintenanceOverviewItem[] {
  const q = opts.query.trim().toLocaleLowerCase('tr-TR')
  return sortMaintenanceItems(
    items.filter((m) => {
      if (opts.onlyDue && !m.isMaintenanceDue) return false
      if (!q) return true
      const hay = `${m.name} ${m.typeLabel} ${m.statusLabel} ${m.notes ?? ''}`.toLocaleLowerCase('tr-TR')
      return hay.includes(q)
    }),
  )
}

function matchSelectOption(table: DynamicTableDef, columnId: string | null | undefined, raw: string): string {
  if (!columnId) return raw
  const col = table.columns.find((c) => c.id === columnId)
  const options = col?.config?.options
  if (!options || options.length === 0) return raw
  const target = raw.trim().toLocaleLowerCase('tr-TR')
  const exact = options.find(
    (o) => o.id.toLocaleLowerCase('tr-TR') === target || o.label.toLocaleLowerCase('tr-TR') === target,
  )
  return exact ? exact.id : raw
}

export function findPrimaryColumn(table: DynamicTableDef) {
  return (
    table.columns.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation') ||
    table.columns.find((c) => c.fieldType === 'text') ||
    null
  )
}

export interface StockRowInput {
  name: string
  category?: string
  unit?: string
  quantity: number
  minThreshold: number
  unitCost: number
  expiryDate: string | null
  notes?: string
}

export function buildStockRowValues(
  table: DynamicTableDef,
  mapping: DynamicModuleMapping,
  input: StockRowInput,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const primary = findPrimaryColumn(table)
  if (primary) values[primary.id] = input.name.trim()
  if (mapping.categoryColumnId && input.category?.trim()) {
    values[mapping.categoryColumnId] = matchSelectOption(table, mapping.categoryColumnId, input.category)
  }
  if (mapping.unitColumnId && input.unit?.trim()) {
    values[mapping.unitColumnId] = matchSelectOption(table, mapping.unitColumnId, input.unit)
  }
  if (mapping.quantityColumnId) values[mapping.quantityColumnId] = Math.max(0, Math.floor(input.quantity))
  if (mapping.minThresholdColumnId) values[mapping.minThresholdColumnId] = Math.max(0, Math.floor(input.minThreshold))
  if (mapping.unitCostColumnId) values[mapping.unitCostColumnId] = Math.max(0, Number(input.unitCost) || 0)
  if (mapping.expiryDateColumnId) values[mapping.expiryDateColumnId] = input.expiryDate || null
  if (mapping.notesColumnId) values[mapping.notesColumnId] = input.notes?.trim() || ''
  return values
}

export interface MaintenanceRowInput {
  name: string
  scheduledDate: string
  isPeriodic: boolean
  periodicDays: number
  estimatedCost: number
  notes?: string
  setPlannedStatus?: boolean
}

export function buildMaintenanceRowValues(
  table: DynamicTableDef,
  mapping: DynamicModuleMapping,
  input: MaintenanceRowInput,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const primary = findPrimaryColumn(table)
  if (primary) values[primary.id] = input.name.trim()
  if (mapping.scheduledDateColumnId) values[mapping.scheduledDateColumnId] = input.scheduledDate
  if (mapping.nextDateColumnId && input.isPeriodic) values[mapping.nextDateColumnId] = input.scheduledDate
  if (mapping.isPeriodicColumnId) values[mapping.isPeriodicColumnId] = input.isPeriodic
  if (mapping.periodicDaysColumnId) {
    values[mapping.periodicDaysColumnId] = input.isPeriodic ? Math.max(1, Math.floor(input.periodicDays) || 30) : 0
  }
  if (mapping.amountColumnId) values[mapping.amountColumnId] = Math.max(0, Number(input.estimatedCost) || 0)
  if (mapping.notesColumnId) values[mapping.notesColumnId] = input.notes?.trim() || ''
  if (input.setPlannedStatus && mapping.statusColumnId) {
    const stCol = table.columns.find((c) => c.id === mapping.statusColumnId)
    const planned = stCol?.config?.options?.find((o) => /(planlan|bekliyor|scheduled)/i.test(`${o.id} ${o.label}`))
    values[mapping.statusColumnId] = planned ? planned.id : 'Planlandı'
  }
  return values
}

/** Bir bakım kaydını mevcut hedef tarihinden (veya bugünden) verilen gün kadar ileri erteler. */
export function buildPostponeMaintenanceValues(
  table: DynamicTableDef,
  mapping: DynamicModuleMapping,
  item: MaintenanceOverviewItem,
  extraDays: number,
  today = todayIsoDate(),
): { nextIso: string; values: Record<string, unknown> } {
  const anchor = item.effectiveDueDate && item.effectiveDueDate >= today ? item.effectiveDueDate : today
  const nextIso = addDaysIsoDate(anchor, extraDays)
  const values: Record<string, unknown> = {}
  if (item.status === 'completed' && mapping.nextDateColumnId) {
    values[mapping.nextDateColumnId] = nextIso
  } else {
    if (mapping.scheduledDateColumnId) values[mapping.scheduledDateColumnId] = nextIso
    if (mapping.nextDateColumnId && item.nextDate) values[mapping.nextDateColumnId] = nextIso
  }
  if (mapping.statusColumnId && item.status === 'overdue') {
    const stCol = table.columns.find((c) => c.id === mapping.statusColumnId)
    const planned = stCol?.config?.options?.find((o) => /(planlan|bekliyor|scheduled)/i.test(`${o.id} ${o.label}`))
    if (planned) values[mapping.statusColumnId] = planned.id
  }
  return { nextIso, values }
}
