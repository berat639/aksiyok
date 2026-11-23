import { and, eq, gte, lte } from 'drizzle-orm'
import { db } from '../db/client'
import { dentalAppointments, dynamicRowLinks, dynamicRows, shifts } from '../db/schema'
import {
  getStudioSchema,
  inferModuleMappingForTable,
  type DynamicColumnConfig,
  type DynamicModuleMapping,
  type DynamicModuleRole,
  type SelectOptionItem,
} from '../db/repositories/dynamic-tables'
import { listUsers } from '../db/repositories/users'
import { getSetting, setSetting } from '../db/repositories/settings'
import { getClinicTokenStats, listClinicDailyAiUsage } from '../db/repositories/ai-usage'
import { resolveClinicGeminiKeyInfo } from './gemini-client'
import { normalizeCurrencyCode, roundMoney } from './pre-accounting-core'
import { requireClinicId } from '../tenancy/context'

let liveSessionCounter: ((clinicId: string) => number) | null = null

export function registerLiveSessionCounter(fn: (clinicId: string) => number) {
  liveSessionCounter = fn
}

const AI_SOURCE_LABELS: Record<string, string> = {
  live_phone: 'Telefon',
  live_web: 'Web sesli görüşme',
  web_live: 'Web sesli görüşme',
  web_text: 'Web yazılı',
  whatsapp: 'WhatsApp',
  embedding: 'Bilgi bankası',
  simulator: 'Simülatör',
}

const TRY_FORMAT = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })
const formatTry = (n: number) => TRY_FORMAT.format(Number.isFinite(n) ? n : 0)

export type KpiMetricKind = 'time' | 'breakdown' | 'goal'

export type KpiChartType =
  | 'line'
  | 'area'
  | 'bar'
  | 'step'
  | 'spark'
  | 'heat'
  | 'donut'
  | 'pie'
  | 'hbar'
  | 'radar'
  | 'blocks'
  | 'stack'
  | 'gauge'
  | 'ring'
  | 'progress'
  | 'segments'
  | 'number'
  | 'table'

export type KpiIconKey =
  | 'sales'
  | 'visitors'
  | 'customers'
  | 'smile'
  | 'channels'
  | 'target'
  | 'wallet'
  | 'clock'
  | 'truck'
  | 'returns'
  | 'package'
  | 'phone'
  | 'cloud'
  | 'credit'
  | 'bot'

export type KpiChipTone = 'brand' | 'mint' | 'amber' | 'coral' | 'violet'
export type KpiAggregation = 'count' | 'sum' | 'avg'
export type KpiDateRange = 'today' | '7d' | '30d' | 'this_month' | '6m' | 'all'

export interface KpiUnitFormat {
  prefix?: string
  suffix?: string
  decimals?: number
}

export interface KpiCardConfig {
  id: string
  title: string
  sourceId: string
  kind: KpiMetricKind
  aggregation: KpiAggregation
  valueColumnId?: string | null
  groupByColumnId?: string | null
  dateColumnId?: string | null
  dateRange?: KpiDateRange
  filterColumnId?: string | null
  filterValue?: string | null
  targetValue?: number | null
  targetLabel?: string | null
  goodDirection?: 'up' | 'down'
  chart: KpiChartType
  icon?: KpiIconKey
  chip?: KpiChipTone
}

export interface KpiColumnOption {
  id: string
  name: string
  fieldType: 'number' | 'currency' | 'select' | 'multiselect' | 'boolean' | 'date' | 'relation' | 'text'
  currencySymbol?: string
  values?: string[]
}

export interface KpiSourceDescriptor {
  id: string
  kind: 'dynamic_table' | 'builtin' | 'local'
  name: string
  group: 'Veri Tablolarım' | 'İşletme Modülleri'
  rowCount: number
  columns: KpiColumnOption[]
}

export interface KpiMetricBase {
  id: string
  title: string
  subtitle?: string
  tooltip: string
  sourceName: string
  icon: KpiIconKey
  chip: KpiChipTone
  unit: KpiUnitFormat
  goodDirection: 'up' | 'down'
  previous: number | null
  compareLabel: string
  upWord: string
  downWord: string
  defaultChart: KpiChartType
  supports: KpiChartType[]
}

export interface KpiTimeMetric extends KpiMetricBase {
  kind: 'time'
  headline: 'last' | 'sum' | 'avg'
  headlineValue: number
  points: { label: string; value: number }[]
}

export interface KpiBreakdownMetric extends KpiMetricBase {
  kind: 'breakdown'
  items: { name: string; value: number }[]
}

export interface KpiGoalMetric extends KpiMetricBase {
  kind: 'goal'
  value: number
  target: number
  targetLabel: string
}

export type KpiEvaluatedMetric = KpiTimeMetric | KpiBreakdownMetric | KpiGoalMetric

const TIME_CHARTS: KpiChartType[] = ['number', 'area', 'line', 'bar', 'step', 'spark', 'heat', 'table']
const BREAKDOWN_CHARTS: KpiChartType[] = ['donut', 'pie', 'hbar', 'bar', 'radar', 'blocks', 'stack', 'number', 'table']
const GOAL_CHARTS: KpiChartType[] = ['gauge', 'ring', 'progress', 'segments', 'number', 'table']

const KPI_SETTINGS_KEY = 'isletme_kpi_cards_v1'
const TR_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const TR_DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']

interface NormalizedRow {
  createdAt: Date | null
  values: Record<string, unknown>
}

interface ResolvedDataset {
  descriptor: KpiSourceDescriptor
  rows: NormalizedRow[]
  meta?: {
    clinicId?: string
    keySourceLabel?: string
    activeAccounts?: number
    aiCostToday?: number
    aiCostMonth?: number
    aiCostBySourceToday?: Record<string, number>
    assistantRepliesToday?: number
    assistantRepliesMonth?: number
    assistantRepliesBySourceToday?: Record<string, number>
  }
}

/* Kısa süreli klinik bazlı bellek önbelleği + eşzamanlı istek birleştirme */
const CACHE_TTL_MS = 8_000
const datasetCache = new Map<string, { expiresAt: number; data: Map<string, ResolvedDataset> }>()
const inflightCache = new Map<string, Promise<Map<string, ResolvedDataset>>>()

export function invalidateKpiCache(clinicId?: string) {
  if (clinicId) datasetCache.delete(clinicId)
  else datasetCache.clear()
}

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val
  if (typeof val === 'string' && val.trim() !== '') {
    const clean = val.trim().replace(/[₺$€\s]/g, '')
    const normalized =
      clean.includes(',') && clean.includes('.')
        ? clean.replace(/\./g, '').replace(',', '.')
        : clean.replace(',', '.')
    const n = Number(normalized)
    if (Number.isFinite(n)) return n
  }
  return null
}

function parseDate(val: unknown): Date | null {
  if (!val) return null
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val
  const s = String(val).trim()
  if (!s) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function isoDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function diffDaysFromToday(d: Date | null): number | null {
  if (!d) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((target - today) / 86_400_000)
}

function labelForOption(col: { fieldType: string; config?: unknown } | undefined, raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return 'Belirtilmemiş'
  if (typeof raw === 'boolean') return raw ? 'Evet' : 'Hayır'
  if (col?.fieldType === 'boolean') {
    const s = String(raw).toLowerCase()
    if (s === 'true' || s === '1' || s === 'evet') return 'Evet'
    if (s === 'false' || s === '0' || s === 'hayır' || s === 'hayir') return 'Hayır'
  }
  const str = String(raw).trim()
  if (!str) return 'Belirtilmemiş'
  if (col && (col.fieldType === 'select' || col.fieldType === 'multiselect')) {
    const opts = ((col.config as DynamicColumnConfig | undefined)?.options ?? []) as SelectOptionItem[]
    const found = opts.find(
      (o) => o.id === str || o.label.toLocaleLowerCase('tr-TR') === str.toLocaleLowerCase('tr-TR')
    )
    if (found) return found.label
  }
  return str
}

function apptStatusLabel(status: string | null | undefined): string {
  const s = (status || '').toLowerCase()
  if (s === 'completed' || s === 'done') return 'Tamamlandı'
  if (s === 'cancelled' || s === 'canceled') return 'İptal'
  if (s === 'no_show') return 'Gelmedi'
  if (s === 'pending' || s === 'ai_pending') return 'Onay Bekliyor'
  if (s === 'confirmed') return 'Onaylı'
  return 'Planlı'
}

function roleLabel(role: string | null | undefined): string {
  const r = (role || '').toLowerCase()
  if (r === 'yonetici') return 'Yönetici'
  if (r === 'hekim') return 'Uzman / Hekim'
  if (r === 'sekreter' || r === 'host') return 'Karşılama'
  if (r === 'asistan') return 'Asistan'
  if (r === 'moderator') return 'Moderatör'
  return 'Çalışan'
}

function normalizePayStatus(raw: string): string {
  const s = raw.toLocaleLowerCase('tr-TR')
  if (/(iptal|cancel|red)/i.test(s)) return 'İptal'
  if (/(kısmi|kismi|partial)/i.test(s)) return 'Kısmi Ödendi'
  if (/(bekliyor|pending|vadeli|planlan|ödenmedi|odenmedi|açık|acik)/i.test(s)) return 'Bekliyor'
  return 'Tamamlandı'
}

function collectDistinct(rows: NormalizedRow[], colId: string, limit = 16): string[] {
  const set = new Set<string>()
  for (const r of rows) {
    const v = r.values[colId]
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== null && item !== undefined && String(item).trim()) set.add(String(item).trim())
      }
    } else if (v !== null && v !== undefined && String(v).trim()) {
      set.add(String(v).trim())
    }
    if (set.size >= limit) break
  }
  return [...set]
}

async function fetchAllDatasets(clinicId: string): Promise<Map<string, ResolvedDataset>> {
  const map = new Map<string, ResolvedDataset>()

  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  const weekStartKey = isoDateKey(weekStart)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  const weekEndKey = isoDateKey(weekEnd)

  // Tek paralel DB geçişi (N+1 sorgu ve gereksiz legacy taraması yok)
  const [schema, allDynRows, apptDbRows, usersList, weekShifts, tokenStats, dailyAiRows, keyInfo] = await Promise.all([
    getStudioSchema().catch(() => ({ tables: [], relations: [], appointmentConfigs: [], moduleConfigs: [] })),
    db
      .select({
        id: dynamicRows.id,
        tableId: dynamicRows.tableId,
        displayTitle: dynamicRows.displayTitle,
        values: dynamicRows.values,
        createdAt: dynamicRows.createdAt,
      })
      .from(dynamicRows)
      .where(and(eq(dynamicRows.clinicId, clinicId), eq(dynamicRows.isArchived, false)))
      .catch(() => []),
    db
      .select({
        status: dentalAppointments.status,
        type: dentalAppointments.type,
        doctorId: dentalAppointments.doctorId,
        startTime: dentalAppointments.startTime,
        intakeSource: dentalAppointments.intakeSource,
        createdAt: dentalAppointments.createdAt,
      })
      .from(dentalAppointments)
      .where(and(eq(dentalAppointments.clinicId, clinicId), eq(dentalAppointments.isActive, true)))
      .catch(() => []),
    listUsers().catch(() => []),
    db
      .select({ userId: shifts.userId, date: shifts.date })
      .from(shifts)
      .where(and(eq(shifts.clinicId, clinicId), gte(shifts.date, weekStartKey), lte(shifts.date, weekEndKey)))
      .catch(() => []),
    getClinicTokenStats(clinicId).catch(() => ({
      today: 0,
      month: 0,
      total: 0,
      promptToday: 0,
      responseToday: 0,
      bySource: {} as Record<string, number>,
      costTry: { today: 0, month: 0, bySource: {} as Record<string, number> },
    })),
    listClinicDailyAiUsage(clinicId, 180).catch(() => []),
    resolveClinicGeminiKeyInfo(clinicId).catch(() => ({ source: 'missing' as const, apiKey: '' })),
  ])

  const tables = schema.tables ?? []
  const hasRelationCols = tables.some((t) => t.columns.some((c) => c.fieldType === 'relation'))

  // Yalnızca ilişki sütunu varsa bağlantıları tek sorguda çek
  const titleByRowId = new Map<string, string>()
  const rowsByTableId = new Map<string, typeof allDynRows>()
  for (const r of allDynRows) {
    titleByRowId.set(r.id, r.displayTitle || 'Kayıt')
    const arr = rowsByTableId.get(r.tableId) ?? []
    arr.push(r)
    rowsByTableId.set(r.tableId, arr)
  }

  const relLinksByRowCol = new Map<string, string[]>()
  if (hasRelationCols && allDynRows.length > 0) {
    const links = await db
      .select({
        relationId: dynamicRowLinks.relationId,
        sourceRowId: dynamicRowLinks.sourceRowId,
        targetRowId: dynamicRowLinks.targetRowId,
      })
      .from(dynamicRowLinks)
      .where(eq(dynamicRowLinks.clinicId, clinicId))
      .catch(() => [])

    for (const l of links) {
      const fwdKey = `${l.sourceRowId}:${l.relationId}:fwd`
      const fList = relLinksByRowCol.get(fwdKey) ?? []
      fList.push(titleByRowId.get(l.targetRowId) || 'Kayıt')
      relLinksByRowCol.set(fwdKey, fList)

      const invKey = `${l.targetRowId}:${l.relationId}:inv`
      const iList = relLinksByRowCol.get(invKey) ?? []
      iList.push(titleByRowId.get(l.sourceRowId) || 'Kayıt')
      relLinksByRowCol.set(invKey, iList)
    }
  }

  // 1. Kullanıcının tüm Dinamik Veri Tabloları
  for (const table of tables) {
    const rawRows = rowsByTableId.get(table.id) ?? []
    const cols: KpiColumnOption[] = []

    const normalized: NormalizedRow[] = rawRows.map((row) => {
      const vals: Record<string, unknown> = {}
      const rowValues = (row.values || {}) as Record<string, unknown>
      for (const col of table.columns) {
        if (col.fieldType === 'relation') {
          const cfg = (col.config || {}) as DynamicColumnConfig
          const dir = cfg.relationDirection === 'inverse' ? 'inv' : 'fwd'
          const linked = cfg.relationId ? relLinksByRowCol.get(`${row.id}:${cfg.relationId}:${dir}`) ?? [] : []
          vals[col.id] = linked.length > 0 ? linked : ['Bağlantısız']
        } else if (col.fieldType === 'multiselect') {
          const raw = rowValues[col.id]
          const arr = Array.isArray(raw) ? raw : raw ? [raw] : []
          vals[col.id] = arr.length > 0 ? arr.map((x) => labelForOption(col, x)) : ['Belirtilmemiş']
        } else if (col.fieldType === 'select' || col.fieldType === 'boolean') {
          vals[col.id] = labelForOption(col, rowValues[col.id])
        } else {
          vals[col.id] = rowValues[col.id] ?? null
        }
      }
      return { createdAt: parseDate(row.createdAt), values: vals }
    })

    for (const col of table.columns) {
      if (col.fieldType === 'phone' || col.fieldType === 'email') continue
      const fieldType = col.fieldType as KpiColumnOption['fieldType']
      const cfg = (col.config || {}) as DynamicColumnConfig
      let values: string[] | undefined
      if (fieldType === 'boolean') {
        values = ['Evet', 'Hayır']
      } else if (fieldType === 'select' || fieldType === 'multiselect') {
        const fromConfig = (cfg.options ?? []).map((o) => o.label)
        const fromRows = collectDistinct(normalized, col.id)
        values = Array.from(new Set([...fromConfig, ...fromRows])).filter(Boolean)
      } else if (fieldType === 'relation') {
        values = collectDistinct(normalized, col.id)
      }
      cols.push({
        id: col.id,
        name: col.name,
        fieldType,
        currencySymbol: cfg.currencySymbol || (fieldType === 'currency' ? '₺' : undefined),
        values,
      })
    }

    const id = `dynamic:${table.id}`
    map.set(id, {
      descriptor: {
        id,
        kind: 'dynamic_table',
        name: table.name,
        group: 'Veri Tablolarım',
        rowCount: normalized.length,
        columns: cols,
      },
      rows: normalized,
    })
  }

  // Modül rollerini bellek içi tek geçişte çöz (ekstra DB sorgusu yok)
  const explicitByTable = new Map(
    (schema.moduleConfigs ?? []).filter((mc) => mc.enabled).map((mc) => [mc.tableId, mc])
  )
  const modTables: Array<{ table: (typeof tables)[number]; role: DynamicModuleRole; mapping: DynamicModuleMapping }> = []
  const coveredRoles = new Set<DynamicModuleRole>()
  for (const t of tables) {
    const exp = explicitByTable.get(t.id)
    if (exp) {
      modTables.push({ table: t, role: exp.moduleRole, mapping: exp.mapping })
      coveredRoles.add(exp.moduleRole)
    }
  }
  for (const t of tables) {
    if (explicitByTable.has(t.id)) continue
    const lower = t.name.toLocaleLowerCase('tr-TR')
    let role: DynamicModuleRole | null = null
    if (!coveredRoles.has('stock_movement') && /(stok hareket|envanter hareket|bakım hareket|malzeme hareket)/i.test(lower)) {
      role = 'stock_movement'
    } else if (!coveredRoles.has('asset_maintenance') && /(periyodik bakım|cihaz bakım|demirbaş|ekipman bakım|bakımlar|bakimlar|kalibrasyon)/i.test(lower)) {
      role = 'asset_maintenance'
    } else if (!coveredRoles.has('stock_inventory') && /(stok|envanter|malzemeler|yedek parça)/i.test(lower) && !/(hareket)/i.test(lower)) {
      role = 'stock_inventory'
    }
    // Finance tables are canonical & explicitly bound via dynamic_module_configs; never hijack custom tables by name.
    if (role) {
      modTables.push({ table: t, role, mapping: inferModuleMappingForTable(role, t.columns, tables) })
      coveredRoles.add(role)
    }
  }

  // 2. Yerleşik: Randevular (Takvim)
  const userNameById = new Map<string, string>()
  for (const u of usersList as Array<{ id: string; name?: string | null }>) {
    userNameById.set(u.id, u.name || 'Personel')
  }
  const apptRows: NormalizedRow[] = apptDbRows.map((a) => ({
    createdAt: parseDate(a.startTime || a.createdAt),
    values: {
      status: apptStatusLabel(a.status),
      type: a.type && a.type !== 'general' ? String(a.type) : 'Genel',
      staff: a.doctorId ? userNameById.get(a.doctorId) || 'Atanmış' : 'Atanmamış',
      source: a.intakeSource === 'voice' ? 'Telefon' : a.intakeSource === 'whatsapp' ? 'WhatsApp' : 'Panel',
      date: a.startTime,
    },
  }))
  map.set('builtin:appointments', {
    descriptor: {
      id: 'builtin:appointments',
      kind: 'builtin',
      name: 'Randevular (Takvim)',
      group: 'İşletme Modülleri',
      rowCount: apptRows.length,
      columns: [
        { id: 'status', name: 'Durum', fieldType: 'select', values: Array.from(new Set(['Planlı', 'Tamamlandı', 'Onaylı', 'İptal', ...collectDistinct(apptRows, 'status')])) },
        { id: 'staff', name: 'Personel', fieldType: 'select', values: collectDistinct(apptRows, 'staff') },
        { id: 'source', name: 'Kaynak', fieldType: 'select', values: Array.from(new Set(['Panel', 'Telefon', 'WhatsApp', ...collectDistinct(apptRows, 'source')])) },
        { id: 'type', name: 'Tür', fieldType: 'select', values: collectDistinct(apptRows, 'type') },
        { id: 'date', name: 'Randevu Tarihi', fieldType: 'date' },
      ],
    },
    rows: apptRows,
  })

  // 3. Yerleşik: Finans ve Raporlama (bellek içi dynamic_rows üzerinden tam geçmiş)
  const finRows: NormalizedRow[] = []
  for (const mod of modTables) {
    if (mod.role !== 'finance_income' && mod.role !== 'finance_expense') continue
    const colById = new Map(mod.table.columns.map((c) => [c.id, c]))
    const m = mod.mapping
    const rawRows = rowsByTableId.get(mod.table.id) ?? []
    for (const r of rawRows) {
      const v = (r.values || {}) as Record<string, unknown>
      const explicitAmount = m.amountColumnId ? toFiniteNumber(v[m.amountColumnId]) : null
      const qty = m.quantityColumnId ? Math.max(1, toFiniteNumber(v[m.quantityColumnId]) ?? 1) : 1
      const unitCost = m.unitCostColumnId ? toFiniteNumber(v[m.unitCostColumnId]) ?? 0 : 0
      const rawAmount = explicitAmount !== null ? explicitAmount : qty * unitCost
      const currency = m.currencyColumnId ? normalizeCurrencyCode(v[m.currencyColumnId]) : 'TRY'
      const rateRaw = m.exchangeRateColumnId ? toFiniteNumber(v[m.exchangeRateColumnId]) : null
      const exchangeRate = currency === 'TRY' || !rateRaw || rateRaw <= 0 ? 1 : rateRaw
      const amount = roundMoney(rawAmount * exchangeRate)
      const dateRaw = m.dateColumnId ? v[m.dateColumnId] : r.createdAt
      const statusLbl = m.statusColumnId
        ? normalizePayStatus(labelForOption(colById.get(m.statusColumnId), v[m.statusColumnId]))
        : 'Tamamlandı'
      const methodLbl = m.methodColumnId ? labelForOption(colById.get(m.methodColumnId), v[m.methodColumnId]) : 'Belirtilmemiş'
      const catLbl = m.categoryColumnId ? labelForOption(colById.get(m.categoryColumnId), v[m.categoryColumnId]) : 'Genel'
      finRows.push({
        createdAt: parseDate(dateRaw) || parseDate(r.createdAt),
        values: {
          amount,
          entryType: mod.role === 'finance_expense' ? 'Gider' : 'Gelir',
          status: statusLbl,
          method: methodLbl,
          category: catLbl,
          date: dateRaw || r.createdAt,
        },
      })
    }
  }
  map.set('builtin:finance', {
    descriptor: {
      id: 'builtin:finance',
      kind: 'builtin',
      name: 'Finans ve Raporlama',
      group: 'İşletme Modülleri',
      rowCount: finRows.length,
      columns: [
        { id: 'amount', name: 'Tutar', fieldType: 'currency', currencySymbol: '₺' },
        { id: 'entryType', name: 'İşlem Türü', fieldType: 'select', values: ['Gelir', 'Gider'] },
        { id: 'status', name: 'Ödeme Durumu', fieldType: 'select', values: ['Tamamlandı', 'Kısmi Ödendi', 'Bekliyor', 'İptal'] },
        { id: 'method', name: 'Ödeme Yöntemi', fieldType: 'select', values: collectDistinct(finRows, 'method') },
        { id: 'category', name: 'Kategori', fieldType: 'select', values: collectDistinct(finRows, 'category') },
        { id: 'date', name: 'İşlem Tarihi', fieldType: 'date' },
      ],
    },
    rows: finRows,
  })

  // 4. Yerleşik: Stok ve Envanter (bellek içi dynamic_rows üzerinden)
  const stockRows: NormalizedRow[] = []
  for (const mod of modTables) {
    if (mod.role !== 'stock_inventory') continue
    const colById = new Map(mod.table.columns.map((c) => [c.id, c]))
    const m = mod.mapping
    for (const r of rowsByTableId.get(mod.table.id) ?? []) {
      const v = (r.values || {}) as Record<string, unknown>
      const qty = m.quantityColumnId ? toFiniteNumber(v[m.quantityColumnId]) ?? 0 : 0
      const minTh = m.minThresholdColumnId ? toFiniteNumber(v[m.minThresholdColumnId]) ?? 0 : 0
      const unitCost = m.unitCostColumnId ? toFiniteNumber(v[m.unitCostColumnId]) ?? 0 : 0
      const expDays = m.expiryDateColumnId ? diffDaysFromToday(parseDate(v[m.expiryDateColumnId])) : null
      const alertStatus =
        expDays !== null && expDays < 0
          ? 'SKT Geçmiş'
          : qty <= minTh
            ? 'Kritik Stok'
            : expDays !== null && expDays <= 30
              ? 'SKT Yaklaşan'
              : 'Normal'
      const catLbl = m.categoryColumnId ? labelForOption(colById.get(m.categoryColumnId), v[m.categoryColumnId]) : 'Genel'
      stockRows.push({
        createdAt: parseDate(r.createdAt),
        values: { quantity: qty, unitCost, totalValue: qty * unitCost, category: catLbl, alertStatus },
      })
    }
  }
  map.set('builtin:stock', {
    descriptor: {
      id: 'builtin:stock',
      kind: 'builtin',
      name: 'Stok ve Envanter',
      group: 'İşletme Modülleri',
      rowCount: stockRows.length,
      columns: [
        { id: 'totalValue', name: 'Toplam Değer', fieldType: 'currency', currencySymbol: '₺' },
        { id: 'quantity', name: 'Mevcut Miktar', fieldType: 'number' },
        { id: 'unitCost', name: 'Birim Maliyet', fieldType: 'currency', currencySymbol: '₺' },
        { id: 'alertStatus', name: 'Stok Durumu', fieldType: 'select', values: ['Normal', 'Kritik Stok', 'SKT Yaklaşan', 'SKT Geçmiş'] },
        { id: 'category', name: 'Kategori', fieldType: 'select', values: collectDistinct(stockRows, 'category') },
      ],
    },
    rows: stockRows,
  })

  // 5. Yerleşik: Periyodik Bakımlar (bellek içi dynamic_rows üzerinden)
  const maintRows: NormalizedRow[] = []
  for (const mod of modTables) {
    if (mod.role !== 'asset_maintenance') continue
    const colById = new Map(mod.table.columns.map((c) => [c.id, c]))
    const m = mod.mapping
    for (const r of rowsByTableId.get(mod.table.id) ?? []) {
      const v = (r.values || {}) as Record<string, unknown>
      const dueRaw = (m.nextDateColumnId && v[m.nextDateColumnId]) || (m.scheduledDateColumnId && v[m.scheduledDateColumnId]) || null
      const dueDate = parseDate(dueRaw)
      const daysUntil = diffDaysFromToday(dueDate)
      const rawStatus = m.statusColumnId ? labelForOption(colById.get(m.statusColumnId), v[m.statusColumnId]).toLocaleLowerCase('tr-TR') : ''
      const isCompleted = /(tamamlan|yapıldı|yapildi|bitti|completed|done)/i.test(rawStatus)
      const status = isCompleted
        ? 'Tamamlandı'
        : daysUntil !== null && daysUntil < 0
          ? 'Geciken'
          : daysUntil !== null && daysUntil <= 14
            ? 'Yaklaşan'
            : 'Planlı'
      const isPeriodic = m.isPeriodicColumnId ? Boolean(v[m.isPeriodicColumnId]) : false
      const estimatedCost = m.amountColumnId ? toFiniteNumber(v[m.amountColumnId]) ?? 0 : 0
      maintRows.push({
        createdAt: dueDate || parseDate(r.createdAt),
        values: {
          estimatedCost,
          status,
          isPeriodic: isPeriodic ? 'Evet' : 'Hayır',
          dueDate: dueRaw,
        },
      })
    }
  }
  map.set('builtin:maintenance', {
    descriptor: {
      id: 'builtin:maintenance',
      kind: 'builtin',
      name: 'Periyodik Bakımlar',
      group: 'İşletme Modülleri',
      rowCount: maintRows.length,
      columns: [
        { id: 'estimatedCost', name: 'Tahmini Ücret', fieldType: 'currency', currencySymbol: '₺' },
        { id: 'status', name: 'Bakım Durumu', fieldType: 'select', values: ['Planlı', 'Yaklaşan', 'Geciken', 'Tamamlandı'] },
        { id: 'isPeriodic', name: 'Periyodik mi?', fieldType: 'boolean', values: ['Evet', 'Hayır'] },
        { id: 'dueDate', name: 'Bakım Tarihi', fieldType: 'date' },
      ],
    },
    rows: maintRows,
  })

  // 6. Yerleşik: Personel ve Mesai
  const shiftCountByUser = new Map<string, number>()
  for (const sh of weekShifts) {
    shiftCountByUser.set(sh.userId, (shiftCountByUser.get(sh.userId) ?? 0) + 1)
  }
  const staffRows: NormalizedRow[] = (usersList as Array<any>).map((u) => ({
    createdAt: parseDate(u.createdAt),
    values: {
      role: roleLabel(u.role),
      isActive: u.active === false ? 'Hayır' : 'Evet',
      weeklyShifts: shiftCountByUser.get(u.id) ?? 0,
    },
  }))
  map.set('builtin:staff', {
    descriptor: {
      id: 'builtin:staff',
      kind: 'builtin',
      name: 'Personel ve Mesai',
      group: 'İşletme Modülleri',
      rowCount: staffRows.length,
      columns: [
        { id: 'weeklyShifts', name: 'Haftalık Mesai', fieldType: 'number' },
        { id: 'role', name: 'Rol', fieldType: 'select', values: collectDistinct(staffRows, 'role') },
        { id: 'isActive', name: 'Aktif mi?', fieldType: 'boolean', values: ['Evet', 'Hayır'] },
      ],
    },
    rows: staffRows,
  })

  // 7. Yerleşik: Canlı Asistan ve Hesap (Aktif Görüşme + Aktif Hesap)
  const activeCallsNow = liveSessionCounter ? liveSessionCounter(clinicId) : 0
  const activeAccountsNow = keyInfo.source === 'missing' ? 0 : 1
  const keySourceLabel =
    keyInfo.source === 'clinic'
      ? 'İşletmeye Özel Anahtar'
      : keyInfo.source === 'shared'
        ? 'Ortak Anahtar'
        : 'Anahtar Tanımlı Değil'
  map.set('builtin:assistant_live', {
    descriptor: {
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
    rows: [
      {
        createdAt: now,
        values: {
          activeCalls: activeCallsNow,
          activeAccounts: activeAccountsNow,
        },
      },
    ],
    meta: {
      clinicId,
      keySourceLabel,
      activeAccounts: activeAccountsNow,
    },
  })

  // 8. Yerleşik: Yapay Zeka ve Asistan Kullanımı (günlük harcama + asistan cevaplama sayısı)
  const istanbulToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const istanbulMonthPrefix = istanbulToday.slice(0, 7)
  const assistantReplySources = new Set(['live_phone', 'live_web', 'web_live', 'web_text', 'whatsapp'])
  let assistantRepliesToday = 0
  let assistantRepliesMonth = 0
  const assistantRepliesBySourceToday: Record<string, number> = {}

  const aiRows: NormalizedRow[] = dailyAiRows.map((r) => {
    const isAssistantReply = assistantReplySources.has(r.source)
    const replyCount = isAssistantReply ? r.callCount : 0
    if (replyCount > 0) {
      if (r.day === istanbulToday) {
        assistantRepliesToday += replyCount
        const lbl = AI_SOURCE_LABELS[r.source] || r.source
        assistantRepliesBySourceToday[lbl] = (assistantRepliesBySourceToday[lbl] ?? 0) + replyCount
      }
      if (r.day.startsWith(istanbulMonthPrefix)) {
        assistantRepliesMonth += replyCount
      }
    }
    return {
      createdAt: parseDate(r.day),
      values: {
        costTry: r.costTry,
        replyCount,
        callCount: r.callCount,
        source: AI_SOURCE_LABELS[r.source] || r.source,
        date: r.day,
      },
    }
  })
  map.set('builtin:ai_usage', {
    descriptor: {
      id: 'builtin:ai_usage',
      kind: 'builtin',
      name: 'Yapay Zeka ve Asistan Kullanımı',
      group: 'İşletme Modülleri',
      rowCount: aiRows.length,
      columns: [
        { id: 'costTry', name: 'Harcama', fieldType: 'currency', currencySymbol: '₺' },
        { id: 'replyCount', name: 'Asistan Cevaplama', fieldType: 'number' },
        { id: 'callCount', name: 'Toplam İşlem', fieldType: 'number' },
        {
          id: 'source',
          name: 'Kanal',
          fieldType: 'select',
          values: Array.from(
            new Set([
              'Telefon',
              'Web sesli görüşme',
              'Web yazılı',
              'WhatsApp',
              'Bilgi bankası',
              'Simülatör',
              ...collectDistinct(aiRows, 'source'),
            ])
          ),
        },
        { id: 'date', name: 'Tarih', fieldType: 'date' },
      ],
    },
    rows: aiRows,
    meta: {
      clinicId,
      aiCostToday: tokenStats.costTry?.today ?? 0,
      aiCostMonth: tokenStats.costTry?.month ?? 0,
      aiCostBySourceToday: tokenStats.costTry?.bySource ?? {},
      assistantRepliesToday,
      assistantRepliesMonth,
      assistantRepliesBySourceToday,
    },
  })

  return map
}

async function loadAllDatasets(forceRefresh = false): Promise<Map<string, ResolvedDataset>> {
  const clinicId = requireClinicId()
  const now = Date.now()
  if (!forceRefresh) {
    const cached = datasetCache.get(clinicId)
    if (cached && cached.expiresAt > now) return cached.data
    const pending = inflightCache.get(clinicId)
    if (pending) return pending
  }

  const job = fetchAllDatasets(clinicId)
    .then((data) => {
      datasetCache.set(clinicId, { expiresAt: Date.now() + CACHE_TTL_MS, data })
      return data
    })
    .finally(() => {
      inflightCache.delete(clinicId)
    })

  inflightCache.set(clinicId, job)
  return job
}

function matchesFilter(row: NormalizedRow, colId?: string | null, filterVal?: string | null): boolean {
  if (!colId || !filterVal) return true
  const raw = row.values[colId]
  const want = filterVal.trim().toLocaleLowerCase('tr-TR')
  if (Array.isArray(raw)) {
    return raw.some((v) => String(v ?? '').trim().toLocaleLowerCase('tr-TR') === want)
  }
  return String(raw ?? '').trim().toLocaleLowerCase('tr-TR') === want
}

function getRowDate(row: NormalizedRow, dateColumnId?: string | null): Date | null {
  if (dateColumnId && dateColumnId !== '__createdAt__') {
    const parsed = parseDate(row.values[dateColumnId])
    if (parsed) return parsed
  }
  return row.createdAt
}

function aggregateRows(rows: NormalizedRow[], aggregation: KpiAggregation, valueColId?: string | null): number {
  if (aggregation === 'count' || !valueColId) return rows.length
  const nums: number[] = []
  for (const r of rows) {
    const n = toFiniteNumber(r.values[valueColId])
    if (n !== null) nums.push(n)
  }
  if (nums.length === 0) return 0
  const sum = nums.reduce((a, b) => a + b, 0)
  if (aggregation === 'avg') return Math.round((sum / nums.length) * 100) / 100
  return Math.round(sum * 100) / 100
}

function unitForColumn(col: KpiColumnOption | undefined, aggregation: KpiAggregation): KpiUnitFormat {
  if (aggregation === 'count' || !col) return { decimals: 0 }
  if (col.fieldType === 'currency') {
    return { prefix: col.currencySymbol || '₺', decimals: col.id === 'costTry' ? 2 : 0 }
  }
  return { decimals: aggregation === 'avg' ? 1 : 0 }
}

function rangeBounds(range: KpiDateRange): { start: Date | null; prevStart: Date | null; prevEnd: Date | null; label: string } {
  const now = new Date()
  if (range === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
    const prevEnd = new Date(start.getTime() - 1)
    const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1, 0, 0, 0)
    return { start, prevStart, prevEnd, label: 'Düne göre' }
  }
  if (range === '7d') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0)
    const prevEnd = new Date(start.getTime() - 1)
    const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7, 0, 0, 0)
    return { start, prevStart, prevEnd, label: 'Önceki 7 güne göre' }
  }
  if (range === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0)
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0)
    const prevEnd = new Date(start.getTime() - 1)
    return { start, prevStart, prevEnd, label: 'Geçen aya göre' }
  }
  if (range === '6m') {
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0)
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 11, 1, 0, 0, 0)
    const prevEnd = new Date(start.getTime() - 1)
    return { start, prevStart, prevEnd, label: 'Önceki 6 aya göre' }
  }
  if (range === 'all') {
    return { start: null, prevStart: null, prevEnd: null, label: 'Tüm dönem' }
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0)
  const prevEnd = new Date(start.getTime() - 1)
  const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 30, 0, 0, 0)
  return { start, prevStart, prevEnd, label: 'Önceki 30 güne göre' }
}

function buildTooltip(
  desc: KpiSourceDescriptor,
  cfg: KpiCardConfig,
  valCol?: KpiColumnOption,
  grpCol?: KpiColumnOption,
  filterCol?: KpiColumnOption
): string {
  const aggText =
    cfg.aggregation === 'sum' && valCol
      ? `${valCol.name} toplamı`
      : cfg.aggregation === 'avg' && valCol
        ? `${valCol.name} ortalaması`
        : 'Kayıt sayısı'
  const rangeMap: Record<KpiDateRange, string> = {
    today: 'Bugün',
    '7d': 'Son 7 gün',
    '30d': 'Son 30 gün',
    this_month: 'Bu ay',
    '6m': 'Son 6 ay',
    all: 'Tüm kayıtlar',
  }
  const parts = [`Kaynak: ${desc.name}`, `Hesap: ${aggText}`]
  if (cfg.kind === 'breakdown' && grpCol) parts.push(`Grup: ${grpCol.name}`)
  if (cfg.filterColumnId && cfg.filterValue && filterCol) parts.push(`Filtre: ${filterCol.name} = ${cfg.filterValue}`)
  if (cfg.dateRange && cfg.dateRange !== 'all') parts.push(`Dönem: ${rangeMap[cfg.dateRange]}`)
  if (cfg.kind === 'goal' && cfg.targetValue) parts.push(`Hedef: ${cfg.targetValue}`)
  return parts.join(' · ')
}

function evaluateOne(cfg: KpiCardConfig, datasets: Map<string, ResolvedDataset>): KpiEvaluatedMetric | null {
  const ds = datasets.get(cfg.sourceId)
  if (!ds) return null

  const { descriptor, rows: allRows, meta } = ds
  const valCol = cfg.valueColumnId ? descriptor.columns.find((c) => c.id === cfg.valueColumnId) : undefined
  const grpCol = cfg.groupByColumnId ? descriptor.columns.find((c) => c.id === cfg.groupByColumnId) : undefined
  const filterCol = cfg.filterColumnId ? descriptor.columns.find((c) => c.id === cfg.filterColumnId) : undefined
  const unit = unitForColumn(valCol, cfg.aggregation)
  const range = cfg.dateRange || '30d'
  const bounds = rangeBounds(range)

  // Canlı Asistan ve Hesap (her değerlendirmede taze anlık görüşme sayısı okunur)
  if (cfg.sourceId === 'builtin:assistant_live') {
    const isAccounts = cfg.valueColumnId === 'activeAccounts'
    const liveVal = isAccounts
      ? (meta?.activeAccounts ?? 0)
      : (liveSessionCounter && meta?.clinicId ? liveSessionCounter(meta.clinicId) : toFiniteNumber(allRows[0]?.values.activeCalls) ?? 0)
    const subtitle = isAccounts ? meta?.keySourceLabel : undefined
    const tooltip = isAccounts
      ? `Aktif yapay zeka hesap bağlantısı · ${meta?.keySourceLabel || 'Durum kontrol edildi'}`
      : 'Şu an devam eden canlı sesli ve telefon görüşmeleri'
    const liveBase: KpiMetricBase = {
      id: cfg.id,
      title: cfg.title,
      subtitle,
      tooltip,
      sourceName: descriptor.name,
      icon: cfg.icon || (isAccounts ? 'cloud' : 'phone'),
      chip: cfg.chip || (isAccounts ? 'brand' : 'mint'),
      unit: { decimals: 0 },
      goodDirection: cfg.goodDirection || 'up',
      previous: null,
      compareLabel: '',
      upWord: 'artış',
      downWord: 'düşüş',
      defaultChart: cfg.chart,
      supports: cfg.kind === 'goal' ? GOAL_CHARTS : TIME_CHARTS,
    }
    if (cfg.kind === 'goal') {
      const target = cfg.targetValue && cfg.targetValue > 0 ? cfg.targetValue : Math.max(1, liveVal)
      return { ...liveBase, kind: 'goal', value: liveVal, target, targetLabel: cfg.targetLabel?.trim() || 'Hedef' }
    }
    return {
      ...liveBase,
      kind: 'time',
      headline: 'last',
      headlineValue: liveVal,
      points: [{ label: 'Şimdi', value: liveVal }],
    }
  }

  const filtered = allRows.filter((r) => matchesFilter(r, cfg.filterColumnId, cfg.filterValue))
  const inRange = bounds.start
    ? filtered.filter((r) => {
      const d = getRowDate(r, cfg.dateColumnId)
      return d ? d >= bounds.start! : range === 'all'
    })
    : filtered

  const prevRows =
    bounds.prevStart && bounds.prevEnd
      ? filtered.filter((r) => {
        const d = getRowDate(r, cfg.dateColumnId)
        return Boolean(d && d >= bounds.prevStart! && d <= bounds.prevEnd!)
      })
      : []

  const previous = bounds.prevStart ? aggregateRows(prevRows, cfg.aggregation, cfg.valueColumnId) : null
  const isAiSpend = cfg.sourceId === 'builtin:ai_usage' && cfg.valueColumnId === 'costTry'
  const isAssistantReplies = cfg.sourceId === 'builtin:ai_usage' && cfg.valueColumnId === 'replyCount'
  let customSubtitle: string | undefined
  let customTooltip = buildTooltip(descriptor, cfg, valCol, grpCol, filterCol)
  if (isAiSpend && meta) {
    const todayVal = meta.aiCostToday ?? 0
    const monthVal = meta.aiCostMonth ?? 0
    customSubtitle =
      range === 'today'
        ? `Bu ay ${formatTry(monthVal)}`
        : range === 'this_month'
          ? `Bugün ${formatTry(todayVal)}`
          : `Bugün ${formatTry(todayVal)} · Bu ay ${formatTry(monthVal)}`
    const bySourceEntries = Object.entries(meta.aiCostBySourceToday ?? {}).filter(([, v]) => v > 0)
    const breakdownText =
      bySourceEntries.length > 0
        ? bySourceEntries.map(([k, v]) => `${AI_SOURCE_LABELS[k] || k}: ${formatTry(v)}`).join(' · ')
        : 'Bugün henüz harcama yok'
    customTooltip = `Bugün: ${formatTry(todayVal)} · Bu ay: ${formatTry(monthVal)} · Kanal dağılımı: ${breakdownText}`
  } else if (isAssistantReplies && meta) {
    const todayReplies = meta.assistantRepliesToday ?? 0
    const monthReplies = meta.assistantRepliesMonth ?? 0
    customSubtitle =
      range === 'today'
        ? `Bu ay ${monthReplies} cevaplama`
        : range === 'this_month'
          ? `Bugün ${todayReplies} cevaplama`
          : `Bugün ${todayReplies} · Bu ay ${monthReplies} cevaplama`
    const bySourceEntries = Object.entries(meta.assistantRepliesBySourceToday ?? {}).filter(([, v]) => v > 0)
    const breakdownText =
      bySourceEntries.length > 0
        ? bySourceEntries.map(([k, v]) => `${k}: ${v}`).join(' · ')
        : 'Bugün henüz cevaplama yok'
    customTooltip = `Bugün: ${todayReplies} · Bu ay: ${monthReplies} · Kanal dağılımı: ${breakdownText}`
  }

  const base: KpiMetricBase = {
    id: cfg.id,
    title: cfg.title,
    subtitle: customSubtitle,
    tooltip: customTooltip,
    sourceName: descriptor.name,
    icon: cfg.icon || (unit.prefix ? 'wallet' : 'sales'),
    chip: cfg.chip || 'brand',
    unit,
    goodDirection: cfg.goodDirection || 'up',
    previous,
    compareLabel: bounds.label,
    upWord: 'artış',
    downWord: 'düşüş',
    defaultChart: cfg.chart,
    supports:
      cfg.kind === 'time' ? TIME_CHARTS : cfg.kind === 'breakdown' ? BREAKDOWN_CHARTS : GOAL_CHARTS,
  }

  if (cfg.kind === 'breakdown') {
    const targetCol =
      grpCol ||
      descriptor.columns.find((c) => ['select', 'multiselect', 'boolean', 'relation'].includes(c.fieldType))
    const buckets = new Map<string, NormalizedRow[]>()
    for (const r of inRange) {
      const raw = targetCol ? r.values[targetCol.id] : 'Tümü'
      const keys = Array.isArray(raw) ? raw.map(String) : [String(raw ?? 'Belirtilmemiş')]
      for (const k of keys) {
        const label = k.trim() || 'Belirtilmemiş'
        const list = buckets.get(label) ?? []
        list.push(r)
        buckets.set(label, list)
      }
    }
    const items = [...buckets.entries()]
      .map(([name, list]) => ({ name, value: aggregateRows(list, cfg.aggregation, cfg.valueColumnId) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 7)

    return { ...base, kind: 'breakdown', items }
  }

  if (cfg.kind === 'goal') {
    const value = aggregateRows(inRange, cfg.aggregation, cfg.valueColumnId)
    let target = cfg.targetValue && cfg.targetValue > 0 ? cfg.targetValue : 0
    let targetLabel = cfg.targetLabel?.trim() || 'Hedef'
    if (target <= 0) {
      if (cfg.filterColumnId && cfg.filterValue) {
        const totalAll = aggregateRows(
          bounds.start
            ? allRows.filter((r) => {
              const d = getRowDate(r, cfg.dateColumnId)
              return d ? d >= bounds.start! : true
            })
            : allRows,
          cfg.aggregation,
          cfg.valueColumnId
        )
        target = Math.max(1, totalAll)
        targetLabel = 'Toplam içinde'
      } else {
        target = value > 0 ? Math.ceil((value * 1.25) / 10) * 10 : 100
      }
    }
    return { ...base, kind: 'goal', value, target, targetLabel }
  }

  const points: { label: string; value: number }[] = []
  const now = new Date()

  if (range === 'today') {
    const val =
      isAiSpend && !cfg.filterColumnId && meta
        ? (meta.aiCostToday ?? 0)
        : isAssistantReplies && !cfg.filterColumnId && meta
          ? (meta.assistantRepliesToday ?? 0)
          : aggregateRows(inRange, cfg.aggregation, cfg.valueColumnId)
    points.push({ label: 'Bugün', value: val })
  } else if (range === '7d') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const k = isoDateKey(d)
      const dayRows = inRange.filter((r) => {
        const rd = getRowDate(r, cfg.dateColumnId)
        return rd ? isoDateKey(rd) === k : false
      })
      points.push({ label: TR_DAYS[d.getDay()] || k.slice(5), value: aggregateRows(dayRows, cfg.aggregation, cfg.valueColumnId) })
    }
  } else if (range === '6m') {
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const mk = monthKey(d)
      const mRows = inRange.filter((r) => {
        const rd = getRowDate(r, cfg.dateColumnId)
        return rd ? monthKey(rd) === mk : false
      })
      points.push({ label: TR_MONTHS[d.getMonth()] || mk, value: aggregateRows(mRows, cfg.aggregation, cfg.valueColumnId) })
    }
  } else if (range === 'all') {
    const byMonth = new Map<string, NormalizedRow[]>()
    for (const r of inRange) {
      const rd = getRowDate(r, cfg.dateColumnId) || now
      const mk = monthKey(rd)
      const list = byMonth.get(mk) ?? []
      list.push(r)
      byMonth.set(mk, list)
    }
    const keys = [...byMonth.keys()].sort().slice(-8)
    for (const mk of keys) {
      const m = Number(mk.slice(5, 7)) - 1
      points.push({
        label: `${TR_MONTHS[m] || mk.slice(5)} ${mk.slice(2, 4)}`,
        value: aggregateRows(byMonth.get(mk) ?? [], cfg.aggregation, cfg.valueColumnId),
      })
    }
  } else {
    const start = bounds.start || new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
    const totalDays = Math.max(1, Math.round((now.getTime() - start.getTime()) / 86_400_000) + 1)
    const bucketCount = Math.min(7, Math.max(4, Math.ceil(totalDays / 5)))
    const span = Math.ceil(totalDays / bucketCount)
    for (let b = 0; b < bucketCount; b++) {
      const bStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + b * span, 0, 0, 0)
      if (bStart > now) break
      const bEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (b + 1) * span - 1, 23, 59, 59, 999)
      const bRows = inRange.filter((r) => {
        const rd = getRowDate(r, cfg.dateColumnId)
        return Boolean(rd && rd >= bStart && rd <= bEnd)
      })
      const label = `${bStart.getDate()} ${TR_MONTHS[bStart.getMonth()]}`
      points.push({ label, value: aggregateRows(bRows, cfg.aggregation, cfg.valueColumnId) })
    }
  }

  let headlineValue = aggregateRows(inRange, cfg.aggregation, cfg.valueColumnId)
  if (isAiSpend && !cfg.filterColumnId && meta) {
    if (range === 'today') headlineValue = meta.aiCostToday ?? 0
    else if (range === 'this_month') headlineValue = meta.aiCostMonth ?? 0
  } else if (isAssistantReplies && !cfg.filterColumnId && meta) {
    if (range === 'today') headlineValue = meta.assistantRepliesToday ?? 0
    else if (range === 'this_month') headlineValue = meta.assistantRepliesMonth ?? 0
  }

  return {
    ...base,
    kind: 'time',
    headline: cfg.aggregation === 'avg' ? 'avg' : 'sum',
    headlineValue,
    points,
  }
}

const OPTIONAL_LIVE_PRESET_IDS = new Set([
  'preset-live-calls',
  'preset-live-accounts',
  'preset-ai-spend',
])

export function buildSmartPresets(sources: KpiSourceDescriptor[]): KpiCardConfig[] {
  const presets: KpiCardConfig[] = [
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
      goodDirection: 'down',
      chart: 'number',
      icon: 'credit',
      chip: 'violet',
    },
  ]
  const dynamicSources = sources.filter((s) => s.kind === 'dynamic_table')

  for (const src of dynamicSources.slice(0, 4)) {
    const moneyCol = src.columns.find((c) => c.fieldType === 'currency')
    const numCol = src.columns.find((c) => c.fieldType === 'number')
    const catCol = src.columns.find((c) => c.fieldType === 'select' || c.fieldType === 'boolean')
    const dateCol = src.columns.find((c) => c.fieldType === 'date')

    if (moneyCol) {
      presets.push({
        id: `preset-${src.id}-sum`,
        title: `${src.name} — ${moneyCol.name}`,
        sourceId: src.id,
        kind: 'time',
        aggregation: 'sum',
        valueColumnId: moneyCol.id,
        dateColumnId: dateCol?.id || '__createdAt__',
        dateRange: '6m',
        chart: 'area',
        icon: 'wallet',
        chip: 'brand',
      })
    } else if (catCol) {
      presets.push({
        id: `preset-${src.id}-cat`,
        title: `${src.name} (${catCol.name})`,
        sourceId: src.id,
        kind: 'breakdown',
        aggregation: 'count',
        groupByColumnId: catCol.id,
        dateRange: 'all',
        chart: 'donut',
        icon: 'channels',
        chip: 'violet',
      })
    } else {
      presets.push({
        id: `preset-${src.id}-count`,
        title: `Toplam ${src.name}`,
        sourceId: src.id,
        kind: 'time',
        aggregation: numCol ? 'sum' : 'count',
        valueColumnId: numCol?.id ?? null,
        dateColumnId: dateCol?.id || '__createdAt__',
        dateRange: '30d',
        chart: 'number',
        icon: 'customers',
        chip: 'mint',
      })
    }
  }

  presets.push(
    {
      id: 'preset-finance-income',
      title: 'Aylık Tahsilat',
      sourceId: 'builtin:finance',
      kind: 'time',
      aggregation: 'sum',
      valueColumnId: 'amount',
      filterColumnId: 'entryType',
      filterValue: 'Gelir',
      dateColumnId: 'date',
      dateRange: '6m',
      chart: 'area',
      icon: 'wallet',
      chip: 'brand',
    },
    {
      id: 'preset-appointments-status',
      title: 'Randevu Durumları',
      sourceId: 'builtin:appointments',
      kind: 'breakdown',
      aggregation: 'count',
      groupByColumnId: 'status',
      dateRange: '30d',
      chart: 'donut',
      icon: 'clock',
      chip: 'mint',
    },
    {
      id: 'preset-appointments-trend',
      title: 'Son 7 Gün Randevu',
      sourceId: 'builtin:appointments',
      kind: 'time',
      aggregation: 'count',
      dateColumnId: 'date',
      dateRange: '7d',
      chart: 'bar',
      icon: 'visitors',
      chip: 'violet',
    },
    {
      id: 'preset-stock-value',
      title: 'Stok Dağılımı',
      sourceId: 'builtin:stock',
      kind: 'breakdown',
      aggregation: 'sum',
      valueColumnId: 'totalValue',
      groupByColumnId: 'category',
      dateRange: 'all',
      chart: 'hbar',
      icon: 'package',
      chip: 'amber',
    },
    {
      id: 'preset-staff-active',
      title: 'Aktif Personel',
      sourceId: 'builtin:staff',
      kind: 'time',
      aggregation: 'count',
      filterColumnId: 'isActive',
      filterValue: 'Evet',
      dateRange: 'all',
      chart: 'number',
      icon: 'customers',
      chip: 'mint',
    }
  )

  return presets
}

export async function getKpiSourcesAndPresets(forceRefresh = false) {
  const datasets = await loadAllDatasets(forceRefresh)
  const sources = [...datasets.values()].map((d) => d.descriptor)
  const presets = buildSmartPresets(sources)
  return { sources, presets }
}

export async function getSavedKpiCards(): Promise<KpiCardConfig[] | null> {
  const raw = await getSetting(KPI_SETTINGS_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((c) => c && typeof c.id === 'string' && typeof c.sourceId === 'string')
  } catch {
    return null
  }
}

export async function saveKpiCards(cards: KpiCardConfig[]): Promise<KpiCardConfig[]> {
  const sanitized = cards
    .filter((c) => c && typeof c.id === 'string' && typeof c.sourceId === 'string')
    .slice(0, 24)
  await setSetting(KPI_SETTINGS_KEY, JSON.stringify(sanitized))
  return sanitized
}

export async function evaluateKpiCards(cards: KpiCardConfig[], forceRefresh = false): Promise<Record<string, KpiEvaluatedMetric>> {
  const datasets = await loadAllDatasets(forceRefresh)
  const out: Record<string, KpiEvaluatedMetric> = {}
  for (const cfg of cards) {
    if (cfg.sourceId.startsWith('local:')) continue
    const metric = evaluateOne(cfg, datasets)
    if (metric) out[cfg.id] = metric
  }
  return out
}

/** Tek istekte kaynaklar + hazır öneriler + kayıtlı kartlar + hesaplanmış metrikler. */
export async function getKpiBootstrap(forceRefresh = false) {
  const [datasets, savedCards] = await Promise.all([
    loadAllDatasets(forceRefresh),
    getSavedKpiCards(),
  ])
  const sources = [...datasets.values()].map((d) => d.descriptor)
  const presets = buildSmartPresets(sources)
  const defaultCards = presets.filter((p) => !OPTIONAL_LIVE_PRESET_IDS.has(p.id)).slice(0, 4)
  const activeCards = savedCards !== null ? savedCards : defaultCards
  const metrics: Record<string, KpiEvaluatedMetric> = {}
  for (const cfg of activeCards) {
    if (cfg.sourceId.startsWith('local:')) continue
    const metric = evaluateOne(cfg, datasets)
    if (metric) metrics[cfg.id] = metric
  }
  return {
    sources,
    presets,
    cards: savedCards,
    activeCards,
    metrics,
  }
}
