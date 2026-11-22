import { and, desc, eq } from 'drizzle-orm'
import { db, withPgAdvisoryLock } from '../db/client'
import {
  deviceMaintenances,
  dynamicAppointmentLinks,
  dynamicRows,
  expenses,
  financeAccountingConnections,
  financeAccountingSyncRecords,
  inventoryItems,
  inventoryMovements,
  patientPayments,
  patients,
} from '../db/schema'
import { ensureDynamicTablesSchema } from '../db/dynamic-tables-schema'
import {
  CANONICAL_FINANCE_TABLE_DESCRIPTIONS,
  CANONICAL_FINANCE_TABLE_NAMES,
  createDynamicColumn,
  createDynamicRelation,
  createDynamicRow,
  createDynamicTable,
  getCanonicalFinanceColumnSpecs,
  getStudioSchema,
  inferModuleMappingForTable,
  listDynamicRows,
  seedSectorFinanceAndStockTables,
  STANDARD_MAINTENANCE_STATUS_OPTIONS,
  STANDARD_MOVEMENT_TYPE_OPTIONS,
  STANDARD_PAYMENT_METHOD_OPTIONS,
  STANDARD_PAYMENT_STATUS_OPTIONS,
  updateDynamicRow,
  upsertModuleConfig,
  type DynamicColumnConfig,
  type DynamicModuleMapping,
  type DynamicModuleRole,
  type SelectOptionItem,
} from '../db/repositories/dynamic-tables'
import {
  calculateAccountingAmounts,
  normalizeAccountingPaymentStatus,
  normalizeAccountingSyncStatus,
  normalizeCurrencyCode,
  normalizeDocumentType,
  normalizeExchangeRate,
  normalizeVatRate,
  resolveTdhpAccountCode,
  roundMoney,
  type AccountingPaymentStatus,
} from './pre-accounting-core'
import { requireClinicId } from '../tenancy/context'

export type FinanceChartPeriod = 'daily' | 'weekly' | 'monthly'

export type ModuleStarterPackKey =
  | 'general_finance'
  | 'real_estate_finance'
  | 'insurance_finance'
  | 'clinic_finance'
  | 'general_stock'
  | 'clinic_stock'
  | 'service_parts_stock'

const TR_MONTH_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(baseIso: string, days: number): string {
  const d = new Date(`${baseIso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date()
    fallback.setUTCDate(fallback.getUTCDate() + days)
    return fallback.toISOString().slice(0, 10)
  }
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function diffDaysFromToday(targetIso: string | null | undefined): number | null {
  if (!targetIso || !/^\d{4}-\d{2}-\d{2}/.test(targetIso)) return null
  const today = new Date(`${todayIso()}T00:00:00Z`).getTime()
  const target = new Date(`${targetIso.slice(0, 10)}T00:00:00Z`).getTime()
  if (Number.isNaN(target)) return null
  return Math.round((target - today) / 86_400_000)
}

function toFiniteNumber(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val.trim().replace(/\s/g, '').replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function resolveOptionLabel(
  col: { fieldType: string; config: unknown } | undefined,
  raw: unknown
): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  const str = String(raw).trim()
  if (!str) return null
  if (col && (col.fieldType === 'select' || col.fieldType === 'multiselect')) {
    const opts = ((col.config as DynamicColumnConfig | undefined)?.options ?? []) as SelectOptionItem[]
    const found = opts.find(
      (o) => o.id === str || o.label.toLocaleLowerCase('tr-TR') === str.toLocaleLowerCase('tr-TR')
    )
    if (found) return found.label
  }
  return str
}

function normalizePaymentStatus(raw: unknown, label: string | null): AccountingPaymentStatus {
  return normalizeAccountingPaymentStatus(raw, label)
}

function normalizeMaintenanceStatus(raw: unknown, label: string | null): 'scheduled' | 'completed' | 'overdue' {
  const hay = `${String(raw ?? '')} ${label ?? ''}`.toLocaleLowerCase('tr-TR').trim()
  if (/(tamamlan|yapıldı|yapildi|bitti|completed|done)/i.test(hay)) return 'completed'
  if (/(gecik|overdue)/i.test(hay)) return 'overdue'
  return 'scheduled'
}

function pickStatusSelectValue(
  col: { fieldType: string; config: unknown } | undefined,
  desired: AccountingPaymentStatus
): string {
  const opts = ((col?.config as DynamicColumnConfig | undefined)?.options ?? []) as SelectOptionItem[]
  if (opts.length > 0) {
    if (desired === 'completed') {
      const m = opts.find((o) => /(tamamlan|ödendi|odendi|tahsil|completed)/i.test(`${o.id} ${o.label}`))
      if (m) return m.id
    } else if (desired === 'partial') {
      const m = opts.find((o) => /(kısmi|kismi|partial)/i.test(`${o.id} ${o.label}`))
      if (m) return m.id
      const fallbackPending = opts.find((o) => /(bekliyor|pending|vadeli)/i.test(`${o.id} ${o.label}`))
      if (fallbackPending) return fallbackPending.id
    } else if (desired === 'pending') {
      const m = opts.find((o) => /(bekliyor|pending|vadeli|planlan)/i.test(`${o.id} ${o.label}`))
      if (m) return m.id
    } else {
      const m = opts.find((o) => /(iptal|cancel)/i.test(`${o.id} ${o.label}`))
      if (m) return m.id
    }
    return opts[0]!.id
  }
  if (desired === 'partial') return 'Kısmi Ödendi'
  if (desired === 'pending') return 'Bekliyor / Vadeli'
  if (desired === 'cancelled') return 'İptal'
  return 'Tamamlandı / Ödendi'
}

function pickOptionValueByKeyword(
  col: { fieldType: string; config: unknown } | undefined,
  rawKeyword: string,
  fallbackText: string
): string {
  const clean = rawKeyword.trim()
  const opts = ((col?.config as DynamicColumnConfig | undefined)?.options ?? []) as SelectOptionItem[]
  if (opts.length > 0) {
    if (clean) {
      const low = clean.toLocaleLowerCase('tr-TR')
      const exact = opts.find(
        (o) => o.id.toLocaleLowerCase('tr-TR') === low || o.label.toLocaleLowerCase('tr-TR') === low
      )
      if (exact) return exact.id
      const partial = opts.find(
        (o) => o.label.toLocaleLowerCase('tr-TR').includes(low) || low.includes(o.id.toLocaleLowerCase('tr-TR'))
      )
      if (partial) return partial.id
    }
    return opts[0]!.id
  }
  return clean || fallbackText
}

export interface EffectiveModuleTable {
  table: Awaited<ReturnType<typeof getStudioSchema>>['tables'][number]
  moduleRole: DynamicModuleRole
  mapping: DynamicModuleMapping
  isAutoDetected: boolean
}

export async function resolveEffectiveModuleTables() {
  const schema = await getStudioSchema()
  const explicitByTable = new Map(
    (schema.moduleConfigs ?? []).filter((mc) => mc.enabled).map((mc) => [mc.tableId, mc])
  )

  const resolved: EffectiveModuleTable[] = []
  const coveredRoles = new Set<DynamicModuleRole>()

  for (const table of schema.tables) {
    const exp = explicitByTable.get(table.id)
    if (exp) {
      resolved.push({
        table,
        moduleRole: exp.moduleRole,
        mapping: exp.mapping,
        isAutoDetected: false,
      })
      coveredRoles.add(exp.moduleRole)
    }
  }

  // Fallback smart detection for manually created tables when role has no explicit config
  for (const table of schema.tables) {
    if (explicitByTable.has(table.id)) continue
    const lower = table.name.toLocaleLowerCase('tr-TR')
    let detectedRole: DynamicModuleRole | null = null

    if (!coveredRoles.has('stock_movement') && /(stok hareket|envanter hareket|bakım hareket|malzeme hareket)/i.test(lower)) {
      detectedRole = 'stock_movement'
    } else if (
      !coveredRoles.has('asset_maintenance') &&
      /(periyodik bakım|cihaz bakım|demirbaş|ekipman bakım|bakımlar|bakimlar|kalibrasyon|sertifika takip|lisans yenileme)/i.test(lower)
    ) {
      detectedRole = 'asset_maintenance'
    } else if (
      !coveredRoles.has('stock_inventory') &&
      /(stok|envanter|malzemeler|yedek parça|yedek parca)/i.test(lower) &&
      !/(hareket)/i.test(lower)
    ) {
      detectedRole = 'stock_inventory'
    }
    // Note: Finance tables (finance_income / finance_expense) are canonical & system-managed only;
    // never auto-detect or hijack arbitrary user-created tables by name.

    if (detectedRole) {
      resolved.push({
        table,
        moduleRole: detectedRole,
        mapping: inferModuleMappingForTable(detectedRole, table.columns, schema.tables),
        isAutoDetected: true,
      })
      coveredRoles.add(detectedRole)
    }
  }

  return { schema, resolved }
}

function findCandidatePersonAndServiceTables(
  schema: Awaited<ReturnType<typeof getStudioSchema>>,
  resolvedModuleTables: EffectiveModuleTable[]
) {
  const moduleIds = new Set(resolvedModuleTables.map((m) => m.table.id))
  const nonModuleTables = schema.tables.filter((t) => !moduleIds.has(t.id))

  const personTable =
    nonModuleTables.find((t) =>
      /(müşteri|musteri|cari|firma|hasta|danışan|danisan|alıcı|alici|kiracı|kiraci|sigortalı|sigortali|üye|uye|öğrenci|ogrenci|misafir|kişi|kisi|aday|tedarikçi|tedarikci)/i.test(
        t.name.toLocaleLowerCase('tr-TR')
      )
    ) ??
    nonModuleTables.find((t) => t.columns.some((c) => c.fieldType === 'phone')) ??
    null

  const serviceTable =
    nonModuleTables.find(
      (t) =>
        t.id !== personTable?.id &&
        /(ürün|urun|hizmet|satış|satis|sipariş|siparis|tedavi plan|portföy|portfoy|ilan|teklif|poliçe|police|servis işlem|paket|talep|proje|rezervasyon|kurs|etkinlik|tedaviler)/i.test(
          t.name.toLocaleLowerCase('tr-TR')
        )
    ) ??
    nonModuleTables.find(
      (t) => t.id !== personTable?.id && t.columns.some((c) => c.fieldType === 'currency')
    ) ??
    null

  return { personTable, serviceTable }
}

const ensureFinanceInFlight = new Map<
  string,
  Promise<{
    incomeTable: EffectiveModuleTable
    expenseTable: EffectiveModuleTable
    provisioned: boolean
    upgradedColumnsCount: number
  }>
>()

/**
 * Her kiracı için tüm sektörlere uyumlu ve ön muhasebe entegrasyonuna hazır
 * 2 standart finans tablosunu (Gelirler & Tahsilatlar, Giderler & Masraflar)
 * idempotent ve eşzamanlılık-güvenli biçimde garanti eder.
 * Mevcut finans tabloları varsa ekstra tablo oluşturmaz; eksik ön muhasebe sütunlarını
 * mevcut verilere zarar vermeden tamamlar.
 */
export async function ensureCanonicalFinanceTables(): Promise<{
  incomeTable: EffectiveModuleTable
  expenseTable: EffectiveModuleTable
  provisioned: boolean
  upgradedColumnsCount: number
}> {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  const inflight = ensureFinanceInFlight.get(clinicId)
  if (inflight) return inflight

  const job = withPgAdvisoryLock('canonical_finance', clinicId, async () => {
    let provisioned = false
    let upgradedColumnsCount = 0

    const ensureSingleRole = async (
      role: 'finance_income' | 'finance_expense'
    ): Promise<EffectiveModuleTable> => {
      const { schema, resolved } = await resolveEffectiveModuleTables()
      const existing = resolved.find((r) => r.moduleRole === role)
      const specs = getCanonicalFinanceColumnSpecs(role)

      if (existing) {
        // Non-destructively backfill any missing pre-accounting columns onto existing finance table
        const nextMapping: DynamicModuleMapping = { ...existing.mapping }
        let addedAny = false
        for (const sp of specs) {
          if (sp.mappingKey === 'primaryTitle') continue
          const mappedId = nextMapping[sp.mappingKey]
          if (mappedId) continue
          // Check if a matching column already exists by name/slug before adding
          const existingBySlug = existing.table.columns.find(
            (c) =>
              c.name.toLocaleLowerCase('tr-TR') === sp.column.name.toLocaleLowerCase('tr-TR')
          )
          if (existingBySlug) {
            ;(nextMapping as Record<string, string | null>)[sp.mappingKey] = existingBySlug.id
            addedAny = true
            continue
          }
          const createdCol = await createDynamicColumn(existing.table.id, {
            name: sp.column.name,
            fieldType: sp.column.fieldType,
            isPrimaryTitle: false,
            isRequired: false,
            showInTable: sp.column.showInTable ?? false,
            width: sp.column.width,
            config: sp.column.config,
          })
          if (createdCol?.id) {
            ;(nextMapping as Record<string, string | null>)[sp.mappingKey] = createdCol.id
            upgradedColumnsCount += 1
            addedAny = true
          }
        }
        if (addedAny || existing.isAutoDetected) {
          await upsertModuleConfig({
            tableId: existing.table.id,
            moduleRole: role,
            enabled: true,
            mapping: nextMapping,
            allowSystemFinanceBinding: true,
          })
          const refreshed = await resolveEffectiveModuleTables()
          return refreshed.resolved.find((r) => r.table.id === existing.table.id) ?? existing
        }
        return existing
      }

      provisioned = true
      const { personTable, serviceTable } = findCandidatePersonAndServiceTables(schema, resolved)
      const existingStock = resolved.find((r) => r.moduleRole === 'stock_inventory')
      const maxCanvasX = schema.tables.reduce((max, t) => Math.max(max, t.canvasX || 0), 760)
      const canvasX = role === 'finance_income' ? maxCanvasX + 380 : maxCanvasX + 810

      const created = await createDynamicTable({
        name: CANONICAL_FINANCE_TABLE_NAMES[role],
        description: CANONICAL_FINANCE_TABLE_DESCRIPTIONS[role],
        icon: role === 'finance_income' ? 'credit-card' : 'trending-down',
        color: role === 'finance_income' ? '#15803d' : '#2563eb',
        origin: 'system',
        canvasX,
        canvasY: 60,
        initialColumns: specs.map((sp) => sp.column),
      })

      const mapping: DynamicModuleMapping = {}
      specs.forEach((sp, i) => {
        if (sp.mappingKey !== 'primaryTitle') {
          ;(mapping as Record<string, string | null>)[sp.mappingKey] = created.columns[i]?.id ?? null
        }
      })

      if (role === 'finance_income') {
        if (personTable) {
          const relP = await createDynamicRelation({
            sourceTableId: created.id,
            targetTableId: personTable.id,
            sourceColumnName: personTable.name,
            inverseColumnName: 'Gelirler & Tahsilatlar',
            createInverseColumn: true,
            cardinality: 'many_to_many',
          })
          mapping.personRelationColumnId = relP?.sourceColumnId ?? null
        }
        if (serviceTable) {
          const relS = await createDynamicRelation({
            sourceTableId: created.id,
            targetTableId: serviceTable.id,
            sourceColumnName: serviceTable.name,
            inverseColumnName: 'Tahsilat Kayıtları',
            createInverseColumn: true,
            cardinality: 'many_to_many',
          })
          mapping.serviceRelationColumnId = relS?.sourceColumnId ?? null
        }
      } else if (existingStock) {
        const relItem = await createDynamicRelation({
          sourceTableId: created.id,
          targetTableId: existingStock.table.id,
          sourceColumnName: 'İlgili Stok / Envanter',
          inverseColumnName: 'Gider Kayıtları',
          createInverseColumn: true,
          cardinality: 'many_to_many',
        })
        mapping.itemRelationColumnId = relItem?.sourceColumnId ?? null
      }

      await upsertModuleConfig({
        tableId: created.id,
        moduleRole: role,
        enabled: true,
        mapping,
        allowSystemFinanceBinding: true,
      })

      const refreshed = await resolveEffectiveModuleTables()
      return refreshed.resolved.find((r) => r.table.id === created.id)!
    }

    const incomeTable = await ensureSingleRole('finance_income')
    const expenseTable = await ensureSingleRole('finance_expense')
    return { incomeTable, expenseTable, provisioned, upgradedColumnsCount }
  }).finally(() => {
    ensureFinanceInFlight.delete(clinicId)
  })

  ensureFinanceInFlight.set(clinicId, job)
  return job
}

async function ensureFinanceTableForEntry(
  role: 'finance_income' | 'finance_expense'
): Promise<EffectiveModuleTable> {
  const { incomeTable, expenseTable } = await ensureCanonicalFinanceTables()
  return role === 'finance_expense' ? expenseTable : incomeTable
}

async function ensureStockMovementTable(inventoryTableId?: string): Promise<EffectiveModuleTable> {
  const { resolved } = await resolveEffectiveModuleTables()
  const existing = resolved.find((r) => r.moduleRole === 'stock_movement')
  if (existing) return existing

  const mov = await createDynamicTable({
    name: 'Stok & Bakım Hareketleri',
    icon: 'activity',
    color: '#1d4ed8',
    origin: 'system',
    canvasX: 1380,
    canvasY: 940,
    initialColumns: [
      { name: 'Hareket Özeti', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 240 },
      { name: 'İşlem Türü', fieldType: 'select', width: 165, config: { options: STANDARD_MOVEMENT_TYPE_OPTIONS } },
      { name: 'Adet', fieldType: 'number', width: 110 },
      { name: 'Birim Tutar (₺)', fieldType: 'currency', width: 145, config: { currencySymbol: '₺' } },
      { name: 'Toplam Tutar (₺)', fieldType: 'currency', width: 155, config: { currencySymbol: '₺' } },
      { name: 'Tarih', fieldType: 'date', width: 145 },
      { name: 'İşlemi Yapan', fieldType: 'text', width: 165 },
      { name: 'Açıklama', fieldType: 'text', width: 220 },
    ],
  })

  let relColId: string | null = null
  const targetInvId =
    inventoryTableId ?? resolved.find((r) => r.moduleRole === 'stock_inventory')?.table.id
  if (targetInvId) {
    const rel = await createDynamicRelation({
      sourceTableId: mov.id,
      targetTableId: targetInvId,
      sourceColumnName: 'İlgili Stok Kalemi',
      inverseColumnName: 'Stok Hareketleri',
      createInverseColumn: true,
      cardinality: 'many_to_many',
    })
    relColId = rel?.sourceColumnId ?? null
  }

  await upsertModuleConfig({
    tableId: mov.id,
    moduleRole: 'stock_movement',
    enabled: true,
    mapping: {
      movementTypeColumnId: mov.columns[1]?.id ?? null,
      quantityColumnId: mov.columns[2]?.id ?? null,
      unitCostColumnId: mov.columns[3]?.id ?? null,
      amountColumnId: mov.columns[4]?.id ?? null,
      dateColumnId: mov.columns[5]?.id ?? null,
      actorColumnId: mov.columns[6]?.id ?? null,
      notesColumnId: mov.columns[7]?.id ?? null,
      itemRelationColumnId: relColId,
    },
  })

  const refreshed = await resolveEffectiveModuleTables()
  return refreshed.resolved.find((r) => r.table.id === mov.id)!
}

// ── Finance Overview & Quick Entry ───────────────────────────────────────────

export async function getDynamicFinanceOverview(opts?: {
  period?: FinanceChartPeriod
  month?: string
  search?: string
  status?: string
  appointmentId?: string
  autoEnsure?: boolean
}) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  let tablesAutoProvisioned = false
  if (opts?.autoEnsure) {
    const ensured = await ensureCanonicalFinanceTables()
    tablesAutoProvisioned = ensured.provisioned || ensured.upgradedColumnsCount > 0
  }

  const period: FinanceChartPeriod =
    opts?.period === 'daily' || opts?.period === 'weekly' ? opts.period : 'monthly'
  const activeMonth =
    opts?.month && /^\d{4}-\d{2}$/.test(opts.month) ? opts.month : todayIso().slice(0, 7)
  const searchLower = (opts?.search || '').trim().toLocaleLowerCase('tr-TR')

  const { schema, resolved } = await resolveEffectiveModuleTables()
  const incomeTables = resolved.filter((r) => r.moduleRole === 'finance_income')
  const expenseTables = resolved.filter((r) => r.moduleRole === 'finance_expense')

  const [
    incomeRowLists,
    expenseRowLists,
    apptLinks,
    legacyPayments,
    legacyExpenses,
    syncRecords,
    accountingConnections,
  ] = await Promise.all([
    Promise.all(incomeTables.map((t) => listDynamicRows(t.table.id))),
    Promise.all(expenseTables.map((t) => listDynamicRows(t.table.id))),
    opts?.appointmentId
      ? db
          .select()
          .from(dynamicAppointmentLinks)
          .where(
            and(
              eq(dynamicAppointmentLinks.clinicId, clinicId),
              eq(dynamicAppointmentLinks.appointmentId, opts.appointmentId)
            )
          )
      : Promise.resolve([]),
    db
      .select({ id: patientPayments.id })
      .from(patientPayments)
      .where(and(eq(patientPayments.clinicId, clinicId), eq(patientPayments.isActive, true))),
    db
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.clinicId, clinicId)),
    db
      .select({
        rowId: financeAccountingSyncRecords.rowId,
        provider: financeAccountingSyncRecords.provider,
        syncStatus: financeAccountingSyncRecords.syncStatus,
      })
      .from(financeAccountingSyncRecords)
      .where(eq(financeAccountingSyncRecords.clinicId, clinicId))
      .orderBy(desc(financeAccountingSyncRecords.updatedAt)),
    db
      .select({
        provider: financeAccountingConnections.provider,
        status: financeAccountingConnections.status,
      })
      .from(financeAccountingConnections)
      .where(eq(financeAccountingConnections.clinicId, clinicId)),
  ])

  const activeConnection =
    accountingConnections.find((c) => c.status === 'connected') ??
    accountingConnections.find((c) => c.status === 'configured') ??
    null
  // Priority: active connected/configured provider > most recent external provider > local
  const syncStatusByRowId = new Map<string, string>()
  const syncPriorityByRowId = new Map<string, number>()
  for (const sr of syncRecords) {
    const priority =
      activeConnection && sr.provider === activeConnection.provider
        ? 3
        : sr.provider !== 'local'
          ? 2
          : 1
    const prevPriority = syncPriorityByRowId.get(sr.rowId) ?? 0
    if (priority > prevPriority) {
      syncStatusByRowId.set(sr.rowId, sr.syncStatus)
      syncPriorityByRowId.set(sr.rowId, priority)
    }
  }

  const importedLegacyIds = new Set<string>()
  for (const list of [...incomeRowLists, ...expenseRowLists]) {
    for (const r of list) {
      const lid = (r.values as Record<string, unknown> | undefined)?.__legacy_id
      if (typeof lid === 'string') importedLegacyIds.add(lid)
    }
  }
  const unmigratedPayments = legacyPayments.filter((p) => !importedLegacyIds.has(`payment:${p.id}`)).length
  const unmigratedExpenses = legacyExpenses.filter((e) => !importedLegacyIds.has(`expense:${e.id}`)).length

  interface NormalizedIncomeEntry {
    rowId: string
    tableId: string
    tableName: string
    title: string
    amount: number
    netAmount: number
    vatRate: number
    vatAmount: number
    currency: string
    exchangeRate: number
    baseAmountTry: number
    date: string
    dueDate: string | null
    status: AccountingPaymentStatus
    statusLabel: string
    methodLabel: string
    categoryLabel: string
    documentType: string
    documentNumber: string | null
    counterpartyName: string | null
    counterpartyTaxId: string | null
    accountingSyncStatus: string
    notes: string | null
    persons: Array<{ id: string; tableId: string; displayTitle: string }>
    services: Array<{ id: string; tableId: string; displayTitle: string }>
  }

  interface NormalizedExpenseEntry {
    rowId: string
    tableId: string
    tableName: string
    title: string
    amount: number
    netAmount: number
    vatRate: number
    vatAmount: number
    currency: string
    exchangeRate: number
    baseAmountTry: number
    quantity: number
    unitCost: number
    date: string
    dueDate: string | null
    status: AccountingPaymentStatus
    statusLabel: string
    categoryLabel: string
    methodLabel: string
    documentType: string
    documentNumber: string | null
    counterpartyName: string | null
    counterpartyTaxId: string | null
    accountingSyncStatus: string
    notes: string | null
  }

  const incomeEntries: NormalizedIncomeEntry[] = []
  incomeTables.forEach((mod, idx) => {
    const rows = incomeRowLists[idx] ?? []
    const colById = new Map(mod.table.columns.map((c) => [c.id, c]))
    const m = mod.mapping

    for (const r of rows) {
      const vals = (r.values ?? {}) as Record<string, unknown>
      const rawGross = m.amountColumnId ? toFiniteNumber(vals[m.amountColumnId], 0) : 0
      const currency = m.currencyColumnId ? normalizeCurrencyCode(vals[m.currencyColumnId]) : 'TRY'
      const exchangeRate = m.exchangeRateColumnId
        ? normalizeExchangeRate(vals[m.exchangeRateColumnId], currency)
        : 1
      const vatRate = m.vatRateColumnId ? normalizeVatRate(vals[m.vatRateColumnId]) : 0
      const amounts = calculateAccountingAmounts({
        grossAmount: rawGross,
        vatRate,
        vatIncluded: true,
        currency,
        exchangeRate,
      })
      const explicitNet =
        m.netAmountColumnId && vals[m.netAmountColumnId] != null && vals[m.netAmountColumnId] !== ''
          ? toFiniteNumber(vals[m.netAmountColumnId], NaN)
          : NaN
      const explicitVat =
        m.vatAmountColumnId && vals[m.vatAmountColumnId] != null && vals[m.vatAmountColumnId] !== ''
          ? toFiniteNumber(vals[m.vatAmountColumnId], NaN)
          : NaN
      const explicitReconciles =
        Number.isFinite(explicitNet) &&
        Number.isFinite(explicitVat) &&
        Math.abs(roundMoney(explicitNet + explicitVat) - amounts.grossAmount) <= 0.02
      const netAmount = explicitReconciles ? roundMoney(explicitNet) : amounts.netAmount
      const vatAmount = explicitReconciles ? roundMoney(explicitVat) : amounts.vatAmount

      const rawDate = m.dateColumnId ? vals[m.dateColumnId] : null
      const dateStr =
        typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate)
          ? rawDate.slice(0, 10)
          : new Date(r.createdAt).toISOString().slice(0, 10)
      const rawDue = m.dueDateColumnId ? vals[m.dueDateColumnId] : null
      const dueDate =
        typeof rawDue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDue) ? rawDue.slice(0, 10) : null

      const statusCol = m.statusColumnId ? colById.get(m.statusColumnId) : undefined
      const rawStatus = m.statusColumnId ? vals[m.statusColumnId] : null
      const statusLabel = resolveOptionLabel(statusCol, rawStatus) ?? 'Tamamlandı / Ödendi'
      const status = m.statusColumnId ? normalizePaymentStatus(rawStatus, statusLabel) : 'completed'

      const methodCol = m.methodColumnId ? colById.get(m.methodColumnId) : undefined
      const methodLabel =
        (m.methodColumnId ? resolveOptionLabel(methodCol, vals[m.methodColumnId]) : null) ?? 'Belirtilmedi'

      const catCol = m.categoryColumnId ? colById.get(m.categoryColumnId) : undefined
      const categoryLabel =
        (m.categoryColumnId ? resolveOptionLabel(catCol, vals[m.categoryColumnId]) : null) ?? mod.table.name

      const documentType = m.documentTypeColumnId
        ? normalizeDocumentType(vals[m.documentTypeColumnId])
        : 'belgesiz'
      const documentNumber =
        m.documentNumberColumnId && vals[m.documentNumberColumnId]
          ? String(vals[m.documentNumberColumnId]).trim()
          : null

      const persons =
        (m.personRelationColumnId ? r.relations[m.personRelationColumnId] : undefined) ?? []
      const services =
        (m.serviceRelationColumnId ? r.relations[m.serviceRelationColumnId] : undefined) ?? []

      const explicitCounterparty =
        m.counterpartyNameColumnId && vals[m.counterpartyNameColumnId]
          ? String(vals[m.counterpartyNameColumnId]).trim()
          : null
      const counterpartyName = explicitCounterparty || persons[0]?.displayTitle || null
      const counterpartyTaxId =
        m.counterpartyTaxIdColumnId && vals[m.counterpartyTaxIdColumnId]
          ? String(vals[m.counterpartyTaxIdColumnId]).trim()
          : null

      const syncFromTable = m.accountingSyncStatusColumnId
        ? vals[m.accountingSyncStatusColumnId]
        : null
      const accountingSyncStatus = normalizeAccountingSyncStatus(
        syncStatusByRowId.get(r.id) ??
          syncFromTable ??
          (status === 'cancelled' ? 'ignored' : amounts.grossAmount !== 0 ? 'ready' : 'pending')
      )

      const notes =
        m.notesColumnId && vals[m.notesColumnId] ? String(vals[m.notesColumnId]).trim() : null

      const entry: NormalizedIncomeEntry = {
        rowId: r.id,
        tableId: mod.table.id,
        tableName: mod.table.name,
        title: r.displayTitle,
        amount: amounts.grossAmount,
        netAmount,
        vatRate: amounts.vatRate,
        vatAmount,
        currency,
        exchangeRate,
        baseAmountTry: amounts.baseAmountTry,
        date: dateStr,
        dueDate,
        status,
        statusLabel,
        methodLabel,
        categoryLabel,
        documentType,
        documentNumber,
        counterpartyName,
        counterpartyTaxId,
        accountingSyncStatus,
        notes,
        persons,
        services,
      }

      if (opts?.status && opts.status !== 'all' && entry.status !== opts.status) continue
      if (searchLower) {
        const hay = [
          entry.title,
          entry.categoryLabel,
          entry.methodLabel,
          entry.counterpartyName ?? '',
          entry.documentNumber ?? '',
          entry.notes ?? '',
          ...entry.persons.map((p) => p.displayTitle),
          ...entry.services.map((s) => s.displayTitle),
        ]
          .join(' ')
          .toLocaleLowerCase('tr-TR')
        if (!hay.includes(searchLower)) continue
      }

      incomeEntries.push(entry)
    }
  })

  const expenseEntries: NormalizedExpenseEntry[] = []
  expenseTables.forEach((mod, idx) => {
    const rows = expenseRowLists[idx] ?? []
    const colById = new Map(mod.table.columns.map((c) => [c.id, c]))
    const m = mod.mapping

    for (const r of rows) {
      const vals = (r.values ?? {}) as Record<string, unknown>
      const qty = m.quantityColumnId ? Math.max(1, toFiniteNumber(vals[m.quantityColumnId], 1)) : 1
      const unitCost = m.unitCostColumnId ? toFiniteNumber(vals[m.unitCostColumnId], 0) : 0
      const explicitTotal = m.amountColumnId ? toFiniteNumber(vals[m.amountColumnId], NaN) : NaN
      const rawGross = Number.isFinite(explicitTotal) ? explicitTotal : qty * unitCost
      const currency = m.currencyColumnId ? normalizeCurrencyCode(vals[m.currencyColumnId]) : 'TRY'
      const exchangeRate = m.exchangeRateColumnId
        ? normalizeExchangeRate(vals[m.exchangeRateColumnId], currency)
        : 1
      const vatRate = m.vatRateColumnId ? normalizeVatRate(vals[m.vatRateColumnId]) : 0
      const amounts = calculateAccountingAmounts({
        grossAmount: rawGross,
        vatRate,
        vatIncluded: true,
        currency,
        exchangeRate,
      })
      const explicitNet =
        m.netAmountColumnId && vals[m.netAmountColumnId] != null && vals[m.netAmountColumnId] !== ''
          ? toFiniteNumber(vals[m.netAmountColumnId], NaN)
          : NaN
      const explicitVat =
        m.vatAmountColumnId && vals[m.vatAmountColumnId] != null && vals[m.vatAmountColumnId] !== ''
          ? toFiniteNumber(vals[m.vatAmountColumnId], NaN)
          : NaN
      const explicitReconciles =
        Number.isFinite(explicitNet) &&
        Number.isFinite(explicitVat) &&
        Math.abs(roundMoney(explicitNet + explicitVat) - amounts.grossAmount) <= 0.02
      const netAmount = explicitReconciles ? roundMoney(explicitNet) : amounts.netAmount
      const vatAmount = explicitReconciles ? roundMoney(explicitVat) : amounts.vatAmount

      const rawDate = m.dateColumnId ? vals[m.dateColumnId] : null
      const dateStr =
        typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate)
          ? rawDate.slice(0, 10)
          : new Date(r.createdAt).toISOString().slice(0, 10)
      const rawDue = m.dueDateColumnId ? vals[m.dueDateColumnId] : null
      const dueDate =
        typeof rawDue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDue) ? rawDue.slice(0, 10) : null

      const statusCol = m.statusColumnId ? colById.get(m.statusColumnId) : undefined
      const rawStatus = m.statusColumnId ? vals[m.statusColumnId] : null
      const statusLabel = resolveOptionLabel(statusCol, rawStatus) ?? 'Tamamlandı / Ödendi'
      const status = m.statusColumnId ? normalizePaymentStatus(rawStatus, statusLabel) : 'completed'

      const catCol = m.categoryColumnId ? colById.get(m.categoryColumnId) : undefined
      const categoryLabel =
        (m.categoryColumnId ? resolveOptionLabel(catCol, vals[m.categoryColumnId]) : null) ?? 'Genel Gider'

      const methodCol = m.methodColumnId ? colById.get(m.methodColumnId) : undefined
      const methodLabel =
        (m.methodColumnId ? resolveOptionLabel(methodCol, vals[m.methodColumnId]) : null) ?? 'Belirtilmedi'

      const documentType = m.documentTypeColumnId
        ? normalizeDocumentType(vals[m.documentTypeColumnId])
        : 'belgesiz'
      const documentNumber =
        m.documentNumberColumnId && vals[m.documentNumberColumnId]
          ? String(vals[m.documentNumberColumnId]).trim()
          : null
      const counterpartyName =
        m.counterpartyNameColumnId && vals[m.counterpartyNameColumnId]
          ? String(vals[m.counterpartyNameColumnId]).trim()
          : null
      const counterpartyTaxId =
        m.counterpartyTaxIdColumnId && vals[m.counterpartyTaxIdColumnId]
          ? String(vals[m.counterpartyTaxIdColumnId]).trim()
          : null

      const syncFromTable = m.accountingSyncStatusColumnId
        ? vals[m.accountingSyncStatusColumnId]
        : null
      const accountingSyncStatus = normalizeAccountingSyncStatus(
        syncStatusByRowId.get(r.id) ??
          syncFromTable ??
          (status === 'cancelled' ? 'ignored' : amounts.grossAmount !== 0 ? 'ready' : 'pending')
      )

      const notes =
        m.notesColumnId && vals[m.notesColumnId] ? String(vals[m.notesColumnId]).trim() : null

      if (opts?.status && opts.status !== 'all' && status !== opts.status) continue
      if (searchLower) {
        const hay = `${r.displayTitle} ${categoryLabel} ${counterpartyName ?? ''} ${documentNumber ?? ''} ${notes ?? ''}`.toLocaleLowerCase('tr-TR')
        if (!hay.includes(searchLower)) continue
      }

      expenseEntries.push({
        rowId: r.id,
        tableId: mod.table.id,
        tableName: mod.table.name,
        title: r.displayTitle,
        amount: amounts.grossAmount,
        netAmount,
        vatRate: amounts.vatRate,
        vatAmount,
        currency,
        exchangeRate,
        baseAmountTry: amounts.baseAmountTry,
        quantity: qty,
        unitCost,
        date: dateStr,
        dueDate,
        status,
        statusLabel,
        categoryLabel,
        methodLabel,
        documentType,
        documentNumber,
        counterpartyName,
        counterpartyTaxId,
        accountingSyncStatus,
        notes,
      })
    }
  })

  // KPIs (TRY equivalent for multi-currency consistency)
  let completedIncome = 0
  let completedCount = 0
  let pendingIncome = 0
  let pendingCount = 0
  let partialIncome = 0
  let partialCount = 0
  let cancelledIncome = 0
  let monthIncome = 0
  let totalNetIncome = 0
  let totalVatCollected = 0

  for (const inc of incomeEntries) {
    const valTry = inc.baseAmountTry
    const vatTry = Math.round(inc.vatAmount * inc.exchangeRate * 100) / 100
    const netTry = Math.round(inc.netAmount * inc.exchangeRate * 100) / 100
    if (inc.status === 'completed') {
      completedIncome += valTry
      completedCount += 1
      totalNetIncome += netTry
      totalVatCollected += vatTry
      if (inc.date.slice(0, 7) === activeMonth) monthIncome += valTry
    } else if (inc.status === 'partial') {
      partialIncome += valTry
      partialCount += 1
      pendingIncome += valTry
      pendingCount += 1
    } else if (inc.status === 'pending') {
      pendingIncome += valTry
      pendingCount += 1
    } else {
      cancelledIncome += valTry
    }
  }

  let totalExpense = 0
  let expenseCount = 0
  let pendingExpense = 0
  let pendingExpenseCount = 0
  let monthExpense = 0
  let totalNetExpense = 0
  let totalVatPaid = 0

  for (const exp of expenseEntries) {
    if (exp.status === 'cancelled') continue
    const valTry = exp.baseAmountTry
    const vatTry = Math.round(exp.vatAmount * exp.exchangeRate * 100) / 100
    const netTry = Math.round(exp.netAmount * exp.exchangeRate * 100) / 100
    totalExpense += valTry
    expenseCount += 1
    totalNetExpense += netTry
    totalVatPaid += vatTry
    if (exp.status === 'pending' || exp.status === 'partial') {
      pendingExpense += valTry
      pendingExpenseCount += 1
    }
    if (exp.date.slice(0, 7) === activeMonth) monthExpense += valTry
  }

  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

  const kpis = {
    totalIncome: r2(completedIncome + pendingIncome),
    completedIncome: r2(completedIncome),
    completedCount,
    pendingIncome: r2(pendingIncome),
    pendingCount,
    partialIncome: r2(partialIncome),
    partialCount,
    cancelledIncome: r2(cancelledIncome),
    totalExpense: r2(totalExpense),
    expenseCount,
    pendingExpense: r2(pendingExpense),
    pendingExpenseCount,
    netCashflow: r2(completedIncome - totalExpense),
    monthIncome: r2(monthIncome),
    monthExpense: r2(monthExpense),
    monthNetCashflow: r2(monthIncome - monthExpense),
    totalNetIncome: r2(totalNetIncome),
    totalVatCollected: r2(totalVatCollected),
    totalNetExpense: r2(totalNetExpense),
    totalVatPaid: r2(totalVatPaid),
    netVatPayable: r2(totalVatCollected - totalVatPaid),
    activeMonth,
  }

  const allSyncStatuses = [
    ...incomeEntries.map((i) => i.accountingSyncStatus),
    ...expenseEntries.map((e) => e.accountingSyncStatus),
  ]
  const accountingSummary = {
    totalCount: allSyncStatuses.length,
    readyCount: allSyncStatuses.filter((st) => st === 'ready').length,
    pendingCount: allSyncStatuses.filter((st) => st === 'pending').length,
    syncedCount: allSyncStatuses.filter((st) => st === 'synced').length,
    failedCount: allSyncStatuses.filter((st) => st === 'failed').length,
    ignoredCount: allSyncStatuses.filter((st) => st === 'ignored').length,
    connectedProvider: activeConnection?.provider ?? null,
  }

  // Chart buckets
  const chartData: Array<{ date: string; label: string; gelir: number; gider: number; net: number }> = []
  if (period === 'daily') {
    const map = new Map<string, { gelir: number; gider: number }>()
    for (let i = 29; i >= 0; i--) {
      const d = addDaysIso(todayIso(), -i)
      map.set(d, { gelir: 0, gider: 0 })
    }
    for (const inc of incomeEntries) {
      if (inc.status !== 'completed') continue
      const b = map.get(inc.date)
      if (b) b.gelir += inc.baseAmountTry
    }
    for (const exp of expenseEntries) {
      if (exp.status === 'cancelled') continue
      const b = map.get(exp.date)
      if (b) b.gider += exp.baseAmountTry
    }
    for (const [iso, vals] of map.entries()) {
      chartData.push({
        date: iso,
        label: `${iso.slice(8, 10)}.${iso.slice(5, 7)}`,
        gelir: Math.round(vals.gelir),
        gider: Math.round(vals.gider),
        net: Math.round(vals.gelir - vals.gider),
      })
    }
  } else if (period === 'weekly') {
    const buckets: Array<{ start: string; end: string; label: string; gelir: number; gider: number }> = []
    for (let w = 7; w >= 0; w--) {
      const end = addDaysIso(todayIso(), -w * 7)
      const start = addDaysIso(end, -6)
      buckets.push({
        start,
        end,
        label: `${start.slice(8, 10)}.${start.slice(5, 7)}`,
        gelir: 0,
        gider: 0,
      })
    }
    for (const inc of incomeEntries) {
      if (inc.status !== 'completed') continue
      const b = buckets.find((bk) => inc.date >= bk.start && inc.date <= bk.end)
      if (b) b.gelir += inc.baseAmountTry
    }
    for (const exp of expenseEntries) {
      if (exp.status === 'cancelled') continue
      const b = buckets.find((bk) => exp.date >= bk.start && exp.date <= bk.end)
      if (b) b.gider += exp.baseAmountTry
    }
    for (const b of buckets) {
      chartData.push({
        date: b.start,
        label: `${b.label} Hf.`,
        gelir: Math.round(b.gelir),
        gider: Math.round(b.gider),
        net: Math.round(b.gelir - b.gider),
      })
    }
  } else {
    // monthly (last 12 months)
    const now = new Date()
    const map = new Map<string, { label: string; gelir: number; gider: number }>()
    for (let m = 11; m >= 0; m--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1))
      const ym = d.toISOString().slice(0, 7)
      const monthName = TR_MONTH_SHORT[d.getUTCMonth()] ?? ym
      map.set(ym, { label: `${monthName} '${String(d.getUTCFullYear()).slice(2)}`, gelir: 0, gider: 0 })
    }
    for (const inc of incomeEntries) {
      if (inc.status !== 'completed') continue
      const b = map.get(inc.date.slice(0, 7))
      if (b) b.gelir += inc.baseAmountTry
    }
    for (const exp of expenseEntries) {
      if (exp.status === 'cancelled') continue
      const b = map.get(exp.date.slice(0, 7))
      if (b) b.gider += exp.baseAmountTry
    }
    for (const [ym, vals] of map.entries()) {
      chartData.push({
        date: ym,
        label: vals.label,
        gelir: Math.round(vals.gelir),
        gider: Math.round(vals.gider),
        net: Math.round(vals.gelir - vals.gider),
      })
    }
  }

  // Group by Linked Person OR Counterparty Name (works across all B2B/B2C sectors)
  const personGroupMap = new Map<
    string,
    {
      key: string
      personRowId: string | null
      personTableId: string | null
      personName: string
      paidTotal: number
      pendingTotal: number
      paidCount: number
      pendingCount: number
      totalCount: number
      lastDate: string
      rows: NormalizedIncomeEntry[]
    }
  >()

  for (const inc of incomeEntries) {
    if (inc.status === 'cancelled') continue
    const primaryPerson = inc.persons[0] ?? null
    const fallbackName = inc.counterpartyName?.trim() || null
    const key = primaryPerson
      ? primaryPerson.id
      : fallbackName
        ? `cp:${fallbackName.toLocaleLowerCase('tr-TR')}`
        : '__unlinked__'
    const existing = personGroupMap.get(key) ?? {
      key,
      personRowId: primaryPerson?.id ?? null,
      personTableId: primaryPerson?.tableId ?? null,
      personName: primaryPerson?.displayTitle ?? fallbackName ?? 'Genel / Cari Belirtilmemiş',
      paidTotal: 0,
      pendingTotal: 0,
      paidCount: 0,
      pendingCount: 0,
      totalCount: 0,
      lastDate: inc.date,
      rows: [],
    }
    if (inc.status === 'completed') {
      existing.paidTotal = r2(existing.paidTotal + inc.baseAmountTry)
      existing.paidCount += 1
    }
    if (inc.status === 'pending' || inc.status === 'partial') {
      existing.pendingTotal = r2(existing.pendingTotal + inc.baseAmountTry)
      existing.pendingCount += 1
    }
    existing.totalCount += 1
    if (inc.date > existing.lastDate) existing.lastDate = inc.date
    existing.rows.push(inc)
    personGroupMap.set(key, existing)
  }

  const personGroups = Array.from(personGroupMap.values()).sort((a, b) => {
    if ((b.pendingCount > 0) !== (a.pendingCount > 0)) return b.pendingCount > 0 ? 1 : -1
    if (b.pendingTotal !== a.pendingTotal) return b.pendingTotal - a.pendingTotal
    return b.paidTotal - a.paidTotal
  })

  // Category summaries
  const expenseCatMap = new Map<string, { label: string; total: number; count: number }>()
  for (const exp of expenseEntries) {
    if (exp.status === 'cancelled') continue
    const prev = expenseCatMap.get(exp.categoryLabel) ?? { label: exp.categoryLabel, total: 0, count: 0 }
    prev.total = r2(prev.total + exp.baseAmountTry)
    prev.count += 1
    expenseCatMap.set(exp.categoryLabel, prev)
  }
  const expenseCategories = Array.from(expenseCatMap.values()).sort((a, b) => b.total - a.total)

  // Candidate person & service lookup options for Quick Entry modals
  const { personTable, serviceTable } = findCandidatePersonAndServiceTables(schema, resolved)
  const [personRows, serviceRows] = await Promise.all([
    personTable ? listDynamicRows(personTable.id) : Promise.resolve([]),
    serviceTable ? listDynamicRows(serviceTable.id) : Promise.resolve([]),
  ])

  const serviceCurrencyColId =
    serviceTable?.columns.find(
      (c) =>
        c.fieldType === 'currency' &&
        /(net|fiyat|tutar|ücret|ucret|prim|paket)/i.test(c.name.toLocaleLowerCase('tr-TR'))
    )?.id ??
    serviceTable?.columns.find((c) => c.fieldType === 'currency')?.id ??
    null

  const quickEntryRelations = {
    personTable: personTable
      ? {
          id: personTable.id,
          name: personTable.name,
          rows: personRows.map((r) => ({ id: r.id, displayTitle: r.displayTitle })),
        }
      : null,
    serviceTable: serviceTable
      ? {
          id: serviceTable.id,
          name: serviceTable.name,
          rows: serviceRows.map((r) => ({
            id: r.id,
            displayTitle: r.displayTitle,
            suggestedAmount: serviceCurrencyColId
              ? toFiniteNumber((r.values as Record<string, unknown>)?.[serviceCurrencyColId], 0)
              : 0,
          })),
        }
      : null,
  }

  // Optional Appointment Payment Context (for Calendar right-hand detail panel)
  let appointmentContext: {
    appointmentId: string
    linkedPayments: NormalizedIncomeEntry[]
    linkedPersonRow: { id: string; tableId: string; displayTitle: string } | null
    linkedServiceRows: Array<{ id: string; tableId: string; displayTitle: string; suggestedAmount: number }>
    suggestedAmount: number
  } | null = null

  if (opts?.appointmentId) {
    const apptRowIdSet = new Set(apptLinks.map((l) => l.rowId))
    const linkedPersonRow =
      personRows
        .filter((r) => apptRowIdSet.has(r.id))
        .map((r) => ({ id: r.id, tableId: personTable!.id, displayTitle: r.displayTitle }))[0] ?? null

    const linkedServiceRows = serviceRows
      .filter((r) => apptRowIdSet.has(r.id))
      .map((r) => ({
        id: r.id,
        tableId: serviceTable!.id,
        displayTitle: r.displayTitle,
        suggestedAmount: serviceCurrencyColId
          ? toFiniteNumber((r.values as Record<string, unknown>)?.[serviceCurrencyColId], 0)
          : 0,
      }))

    const linkedPayments = incomeEntries.filter((inc) => {
      if (apptRowIdSet.has(inc.rowId)) return true
      if (linkedServiceRows.length > 0 && inc.services.some((s) => apptRowIdSet.has(s.id))) return true
      return false
    })

    const suggestedAmount = linkedServiceRows.reduce((acc, s) => acc + (s.suggestedAmount || 0), 0)
    appointmentContext = {
      appointmentId: opts.appointmentId,
      linkedPayments,
      linkedPersonRow,
      linkedServiceRows,
      suggestedAmount,
    }
  }

  return {
    hasFinanceTables: incomeTables.length > 0 || expenseTables.length > 0,
    isLockedSingleSchema: true,
    tablesAutoProvisioned,
    incomeTableIds: incomeTables.map((t) => t.table.id),
    expenseTableIds: expenseTables.map((t) => t.table.id),
    moduleTables: [...incomeTables, ...expenseTables].map((m) => ({
      tableId: m.table.id,
      tableName: m.table.name,
      moduleRole: m.moduleRole,
      mapping: m.mapping,
      isAutoDetected: m.isAutoDetected,
    })),
    kpis,
    accountingSummary,
    period,
    chartData,
    personGroups,
    expenseCategories,
    recentIncomes: incomeEntries.slice(0, 30),
    recentExpenses: expenseEntries.slice(0, 30),
    quickEntryRelations,
    appointmentContext,
    legacyMigration: {
      hasUnmigratedLegacyFinance: unmigratedPayments + unmigratedExpenses > 0,
      unmigratedPayments,
      unmigratedExpenses,
    },
  }
}

export async function createQuickDynamicFinanceEntry(
  input: {
    entryType: 'income' | 'expense'
    tableId?: string
    title: string
    amount: number
    netAmount?: number
    vatRate?: number
    vatIncluded?: boolean
    currency?: string
    exchangeRate?: number
    quantity?: number
    unitCost?: number
    date?: string
    dueDate?: string | null
    status?: AccountingPaymentStatus
    method?: string
    category?: string
    documentType?: string
    documentNumber?: string | null
    counterpartyName?: string | null
    counterpartyTaxId?: string | null
    accountingCode?: string | null
    notes?: string
    personRowId?: string | null
    serviceRowIds?: string[]
    itemRowId?: string | null
    appointmentId?: string | null
  },
  userId?: string | null
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const role: 'finance_income' | 'finance_expense' =
    input.entryType === 'expense' ? 'finance_expense' : 'finance_income'
  const ensured = await ensureCanonicalFinanceTables()
  const targetMod = role === 'finance_expense' ? ensured.expenseTable : ensured.incomeTable

  const colById = new Map(targetMod.table.columns.map((c) => [c.id, c]))
  const primaryCol =
    targetMod.table.columns.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation') ??
    targetMod.table.columns.find((c) => c.fieldType === 'text')
  const m = targetMod.mapping

  const cleanTitle =
    (input.title || '').trim() || (role === 'finance_expense' ? 'Gider Kaydı' : 'Tahsilat Kaydı')
  const qty = Math.max(1, toFiniteNumber(input.quantity, 1))
  const currency = normalizeCurrencyCode(input.currency)
  if (
    currency !== 'TRY' &&
    !(typeof input.exchangeRate === 'number' && Number.isFinite(input.exchangeRate) && input.exchangeRate > 0)
  ) {
    throw new Error('Dövizli işlemler için geçerli bir döviz kuru giriniz')
  }
  const exchangeRate = normalizeExchangeRate(input.exchangeRate, currency)
  const vatRate = normalizeVatRate(input.vatRate)
  const rawInputAmount = toFiniteNumber(input.amount, 0)
  const fallbackFromUnit =
    rawInputAmount === 0 && input.unitCost !== undefined
      ? roundMoney(qty * toFiniteNumber(input.unitCost, 0))
      : rawInputAmount
  const amounts = calculateAccountingAmounts({
    grossAmount: input.vatIncluded === false ? undefined : fallbackFromUnit,
    netAmount:
      input.vatIncluded === false
        ? toFiniteNumber(input.netAmount ?? fallbackFromUnit, 0)
        : input.netAmount !== undefined
          ? toFiniteNumber(input.netAmount, NaN)
          : undefined,
    vatRate,
    vatIncluded: input.vatIncluded !== false,
    currency,
    exchangeRate,
  })
  if (!Number.isFinite(amounts.grossAmount) || amounts.grossAmount === 0) {
    throw new Error('Lütfen sıfırdan farklı geçerli bir tutar giriniz')
  }
  const unitCost =
    input.unitCost !== undefined
      ? toFiniteNumber(input.unitCost, amounts.grossAmount)
      : roundMoney(amounts.grossAmount / qty)
  const dateVal =
    input.date && /^\d{4}-\d{2}-\d{2}/.test(input.date) ? input.date.slice(0, 10) : todayIso()

  const values: Record<string, unknown> = {}
  if (primaryCol) values[primaryCol.id] = cleanTitle
  if (m.amountColumnId) values[m.amountColumnId] = amounts.grossAmount
  if (m.netAmountColumnId) values[m.netAmountColumnId] = amounts.netAmount
  if (m.vatAmountColumnId) values[m.vatAmountColumnId] = amounts.vatAmount
  if (m.vatRateColumnId) {
    const vatCol = colById.get(m.vatRateColumnId)
    values[m.vatRateColumnId] =
      vatCol?.fieldType === 'number'
        ? amounts.vatRate
        : pickOptionValueByKeyword(vatCol, String(amounts.vatRate), String(amounts.vatRate))
  }
  if (m.currencyColumnId) {
    values[m.currencyColumnId] = pickOptionValueByKeyword(
      colById.get(m.currencyColumnId),
      currency,
      currency
    )
  }
  if (m.exchangeRateColumnId) values[m.exchangeRateColumnId] = exchangeRate
  if (m.quantityColumnId) values[m.quantityColumnId] = qty
  if (m.unitCostColumnId) values[m.unitCostColumnId] = unitCost
  if (m.dateColumnId) values[m.dateColumnId] = dateVal
  if (m.dueDateColumnId && input.dueDate && /^\d{4}-\d{2}-\d{2}/.test(input.dueDate)) {
    values[m.dueDateColumnId] = input.dueDate.slice(0, 10)
  }
  if (m.statusColumnId) {
    values[m.statusColumnId] = pickStatusSelectValue(
      colById.get(m.statusColumnId),
      input.status ?? 'completed'
    )
  }
  if (m.methodColumnId && input.method) {
    values[m.methodColumnId] = pickOptionValueByKeyword(
      colById.get(m.methodColumnId),
      input.method,
      input.method
    )
  }
  const categoryKey =
    input.category || (role === 'finance_expense' ? 'diger_gider' : 'hizmet_geliri')
  if (m.categoryColumnId) {
    values[m.categoryColumnId] = pickOptionValueByKeyword(
      colById.get(m.categoryColumnId),
      categoryKey,
      categoryKey
    )
  }
  if (m.documentTypeColumnId) {
    const docType = normalizeDocumentType(input.documentType)
    values[m.documentTypeColumnId] = pickOptionValueByKeyword(
      colById.get(m.documentTypeColumnId),
      docType,
      docType
    )
  }
  if (m.documentNumberColumnId && input.documentNumber?.trim()) {
    values[m.documentNumberColumnId] = input.documentNumber.trim()
  }
  if (m.counterpartyNameColumnId && input.counterpartyName?.trim()) {
    values[m.counterpartyNameColumnId] = input.counterpartyName.trim()
  }
  if (m.counterpartyTaxIdColumnId && input.counterpartyTaxId?.trim()) {
    values[m.counterpartyTaxIdColumnId] = input.counterpartyTaxId.replace(/\s+/g, '')
  }
  if (m.accountingCodeColumnId) {
    values[m.accountingCodeColumnId] = resolveTdhpAccountCode(
      role === 'finance_expense' ? 'expense' : 'income',
      String(m.categoryColumnId ? values[m.categoryColumnId] ?? categoryKey : categoryKey),
      input.accountingCode
    )
  }
  if (m.notesColumnId && input.notes) {
    values[m.notesColumnId] = input.notes.trim()
  }

  const relations: Record<string, string[]> = {}
  if (m.personRelationColumnId && input.personRowId) {
    relations[m.personRelationColumnId] = [input.personRowId]
  }
  if (m.serviceRelationColumnId && Array.isArray(input.serviceRowIds) && input.serviceRowIds.length > 0) {
    relations[m.serviceRelationColumnId] = input.serviceRowIds.filter(Boolean)
  }
  if (m.itemRelationColumnId && input.itemRowId) {
    relations[m.itemRelationColumnId] = [input.itemRowId]
  }

  const created = await createDynamicRow(
    targetMod.table.id,
    {
      values,
      relations,
    },
    userId ?? undefined
  )

  if (input.appointmentId) {
    await db
      .insert(dynamicAppointmentLinks)
      .values({
        clinicId,
        appointmentId: input.appointmentId,
        tableId: targetMod.table.id,
        rowId: created.id,
      })
      .onConflictDoNothing()
  }

  return created
}

// ── Stock & Periodic Maintenance Engine ──────────────────────────────────────

export async function getDynamicStockOverview(opts?: {
  search?: string
  alertFilter?: 'all' | 'skt_expired' | 'skt_soon' | 'low_stock' | 'maintenance_due'
}) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  const searchLower = (opts?.search || '').trim().toLocaleLowerCase('tr-TR')
  const alertFilter = opts?.alertFilter ?? 'all'

  const { resolved } = await resolveEffectiveModuleTables()
  const invTables = resolved.filter((r) => r.moduleRole === 'stock_inventory')
  const maintTables = resolved.filter((r) => r.moduleRole === 'asset_maintenance')
  const movTables = resolved.filter((r) => r.moduleRole === 'stock_movement')

  const [invRowLists, maintRowLists, movRowLists, legacyItems, legacyMaints] = await Promise.all([
    Promise.all(invTables.map((t) => listDynamicRows(t.table.id))),
    Promise.all(maintTables.map((t) => listDynamicRows(t.table.id))),
    Promise.all(movTables.map((t) => listDynamicRows(t.table.id))),
    db.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.clinicId, clinicId)),
    db
      .select({ id: deviceMaintenances.id })
      .from(deviceMaintenances)
      .where(eq(deviceMaintenances.clinicId, clinicId)),
  ])

  const importedLegacyIds = new Set<string>()
  for (const list of [...invRowLists, ...maintRowLists, ...movRowLists]) {
    for (const r of list) {
      const lid = (r.values as Record<string, unknown> | undefined)?.__legacy_id
      if (typeof lid === 'string') importedLegacyIds.add(lid)
    }
  }
  const unmigratedItems = legacyItems.filter((i) => !importedLegacyIds.has(`inv:${i.id}`)).length
  const unmigratedMaintenances = legacyMaints.filter((m) => !importedLegacyIds.has(`maint:${m.id}`)).length

  const allInventoryItems: Array<{
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
  }> = []

  invTables.forEach((mod, idx) => {
    const rows = invRowLists[idx] ?? []
    const colById = new Map(mod.table.columns.map((c) => [c.id, c]))
    const m = mod.mapping

    for (const r of rows) {
      const vals = (r.values ?? {}) as Record<string, unknown>
      const quantity = m.quantityColumnId ? toFiniteNumber(vals[m.quantityColumnId], 0) : 0
      const minThreshold = m.minThresholdColumnId ? toFiniteNumber(vals[m.minThresholdColumnId], 5) : 5
      const unitCost = m.unitCostColumnId ? toFiniteNumber(vals[m.unitCostColumnId], 0) : 0

      const catCol = m.categoryColumnId ? colById.get(m.categoryColumnId) : undefined
      const categoryLabel =
        (m.categoryColumnId ? resolveOptionLabel(catCol, vals[m.categoryColumnId]) : null) ?? 'Genel'

      const unitCol = m.unitColumnId ? colById.get(m.unitColumnId) : undefined
      const unitLabel =
        (m.unitColumnId ? resolveOptionLabel(unitCol, vals[m.unitColumnId]) : null) ?? 'Adet'

      const rawExp = m.expiryDateColumnId ? vals[m.expiryDateColumnId] : null
      const expiryDate =
        typeof rawExp === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawExp) ? rawExp.slice(0, 10) : null
      const daysUntilExpiry = diffDaysFromToday(expiryDate)
      const isExpired = daysUntilExpiry !== null && daysUntilExpiry < 0
      const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 30
      const isLowStock = quantity <= minThreshold
      const notes =
        m.notesColumnId && vals[m.notesColumnId] ? String(vals[m.notesColumnId]).trim() : null

      if (searchLower) {
        const hay = `${r.displayTitle} ${categoryLabel} ${notes ?? ''}`.toLocaleLowerCase('tr-TR')
        if (!hay.includes(searchLower)) continue
      }

      allInventoryItems.push({
        rowId: r.id,
        tableId: mod.table.id,
        tableName: mod.table.name,
        name: r.displayTitle,
        categoryLabel,
        unitLabel,
        quantity,
        minThreshold,
        unitCost,
        expiryDate,
        daysUntilExpiry,
        isExpired,
        isExpiringSoon,
        isLowStock,
        notes,
      })
    }
  })

  const allMaintenanceItems: Array<{
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
  }> = []

  maintTables.forEach((mod, idx) => {
    const rows = maintRowLists[idx] ?? []
    const colById = new Map(mod.table.columns.map((c) => [c.id, c]))
    const m = mod.mapping

    for (const r of rows) {
      const vals = (r.values ?? {}) as Record<string, unknown>
      const typeCol = m.categoryColumnId ? colById.get(m.categoryColumnId) : undefined
      const typeLabel =
        (m.categoryColumnId ? resolveOptionLabel(typeCol, vals[m.categoryColumnId]) : null) ?? 'Periyodik Bakım'

      const isPeriodic = m.isPeriodicColumnId ? Boolean(vals[m.isPeriodicColumnId]) : false
      const periodicDays = m.periodicDaysColumnId ? toFiniteNumber(vals[m.periodicDaysColumnId], 0) : 0
      const rawSched = m.scheduledDateColumnId ? vals[m.scheduledDateColumnId] : null
      const scheduledDate =
        typeof rawSched === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawSched) ? rawSched.slice(0, 10) : null
      const rawNext = m.nextDateColumnId ? vals[m.nextDateColumnId] : null
      const nextDate =
        typeof rawNext === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawNext) ? rawNext.slice(0, 10) : null

      const statusCol = m.statusColumnId ? colById.get(m.statusColumnId) : undefined
      const rawStatus = m.statusColumnId ? vals[m.statusColumnId] : null
      const statusLabel = resolveOptionLabel(statusCol, rawStatus) ?? 'Planlandı'
      const status = normalizeMaintenanceStatus(rawStatus, statusLabel)

      const effectiveDueDate =
        status === 'completed' ? (isPeriodic ? nextDate : null) : scheduledDate ?? nextDate
      const daysUntilDue = diffDaysFromToday(effectiveDueDate)
      const isMaintenanceDue = daysUntilDue !== null && daysUntilDue <= 14
      const estimatedCost = m.amountColumnId ? toFiniteNumber(vals[m.amountColumnId], 0) : 0
      const notes =
        m.notesColumnId && vals[m.notesColumnId] ? String(vals[m.notesColumnId]).trim() : null

      if (searchLower) {
        const hay = `${r.displayTitle} ${typeLabel} ${notes ?? ''}`.toLocaleLowerCase('tr-TR')
        if (!hay.includes(searchLower)) continue
      }

      allMaintenanceItems.push({
        rowId: r.id,
        tableId: mod.table.id,
        tableName: mod.table.name,
        name: r.displayTitle,
        typeLabel,
        isPeriodic,
        periodicDays,
        scheduledDate,
        nextDate,
        effectiveDueDate,
        daysUntilDue,
        isMaintenanceDue,
        estimatedCost,
        status,
        statusLabel,
        notes,
      })
    }
  })

  const recentMovements: Array<{
    rowId: string
    tableId: string
    title: string
    movementTypeLabel: string
    quantity: number
    totalAmount: number
    date: string
    actor: string | null
    itemTitle: string | null
  }> = []

  movTables.forEach((mod, idx) => {
    const rows = movRowLists[idx] ?? []
    const colById = new Map(mod.table.columns.map((c) => [c.id, c]))
    const m = mod.mapping
    for (const r of rows.slice(0, 25)) {
      const vals = (r.values ?? {}) as Record<string, unknown>
      const typeCol = m.movementTypeColumnId ? colById.get(m.movementTypeColumnId) : undefined
      const movementTypeLabel =
        (m.movementTypeColumnId ? resolveOptionLabel(typeCol, vals[m.movementTypeColumnId]) : null) ?? 'Hareket'
      const quantity = m.quantityColumnId ? toFiniteNumber(vals[m.quantityColumnId], 1) : 1
      const totalAmount = m.amountColumnId ? toFiniteNumber(vals[m.amountColumnId], 0) : 0
      const rawDate = m.dateColumnId ? vals[m.dateColumnId] : null
      const date =
        typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate)
          ? rawDate.slice(0, 10)
          : new Date(r.createdAt).toISOString().slice(0, 10)
      const actor = m.actorColumnId && vals[m.actorColumnId] ? String(vals[m.actorColumnId]) : null
      const linkedItem = m.itemRelationColumnId ? r.relations[m.itemRelationColumnId]?.[0] : undefined

      recentMovements.push({
        rowId: r.id,
        tableId: mod.table.id,
        title: r.displayTitle,
        movementTypeLabel,
        quantity,
        totalAmount,
        date,
        actor,
        itemTitle: linkedItem?.displayTitle ?? null,
      })
    }
  })

  const alerts = {
    sktExpiredCount: allInventoryItems.filter((i) => i.isExpired).length,
    sktSoonCount: allInventoryItems.filter((i) => i.isExpiringSoon).length,
    lowStockCount: allInventoryItems.filter((i) => i.isLowStock).length,
    maintenanceDueCount: allMaintenanceItems.filter((m) => m.isMaintenanceDue).length,
    totalStockItems: allInventoryItems.length,
    totalStockValue: Math.round(allInventoryItems.reduce((acc, i) => acc + i.quantity * i.unitCost, 0)),
  }

  let filteredInventory = allInventoryItems
  let filteredMaintenance = allMaintenanceItems
  if (alertFilter === 'skt_expired') {
    filteredInventory = allInventoryItems.filter((i) => i.isExpired)
    filteredMaintenance = []
  } else if (alertFilter === 'skt_soon') {
    filteredInventory = allInventoryItems.filter((i) => i.isExpiringSoon)
    filteredMaintenance = []
  } else if (alertFilter === 'low_stock') {
    filteredInventory = allInventoryItems.filter((i) => i.isLowStock)
    filteredMaintenance = []
  } else if (alertFilter === 'maintenance_due') {
    filteredInventory = []
    filteredMaintenance = allMaintenanceItems.filter((m) => m.isMaintenanceDue)
  }

  return {
    hasStockTables: invTables.length > 0 || maintTables.length > 0 || movTables.length > 0,
    inventoryTableIds: invTables.map((t) => t.table.id),
    maintenanceTableIds: maintTables.map((t) => t.table.id),
    movementTableIds: movTables.map((t) => t.table.id),
    allStockModuleTableIds: [...invTables, ...maintTables, ...movTables].map((t) => t.table.id),
    moduleTables: [...invTables, ...maintTables, ...movTables].map((m) => ({
      tableId: m.table.id,
      tableName: m.table.name,
      moduleRole: m.moduleRole,
      mapping: m.mapping,
      isAutoDetected: m.isAutoDetected,
    })),
    alerts,
    inventoryItems: filteredInventory,
    maintenanceItems: filteredMaintenance,
    recentMovements,
    legacyMigration: {
      hasUnmigratedLegacyStock: unmigratedItems + unmigratedMaintenances > 0,
      unmigratedItems,
      unmigratedMaintenances,
    },
  }
}

export async function applyDynamicStockMovement(
  input: {
    rowId: string
    movementType: 'giris' | 'cikis' | 'fire' | 'imha' | 'iade'
    quantity: number
    unitCost?: number
    notes?: string
    recordInFinance?: boolean
  },
  actor?: { id?: string | null; name?: string | null }
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const allowedTypes = ['giris', 'cikis', 'fire', 'imha', 'iade'] as const
  if (!allowedTypes.includes(input.movementType)) {
    throw new Error('Geçersiz stok hareket türü')
  }

  const qty = Math.floor(toFiniteNumber(input.quantity, 0))
  if (qty <= 0) {
    throw new Error('Hareket adedi en az 1 olmalıdır')
  }

  const [itemRow] = await db
    .select()
    .from(dynamicRows)
    .where(and(eq(dynamicRows.id, input.rowId), eq(dynamicRows.clinicId, clinicId)))
    .limit(1)
  if (!itemRow) throw new Error('Stok kalemi bulunamadı')

  const { resolved } = await resolveEffectiveModuleTables()
  let invMod = resolved.find((r) => r.table.id === itemRow.tableId)
  if (!invMod) {
    await upsertModuleConfig({ tableId: itemRow.tableId, moduleRole: 'stock_inventory', enabled: true })
    const refreshed = await resolveEffectiveModuleTables()
    invMod = refreshed.resolved.find((r) => r.table.id === itemRow.tableId)!
  }

  let qtyColId = invMod.mapping.quantityColumnId ?? null
  if (!qtyColId) {
    const createdQtyCol = await createDynamicColumn(itemRow.tableId, {
      name: 'Mevcut Stok',
      fieldType: 'number',
      width: 130,
    })
    qtyColId = createdQtyCol.id
    await upsertModuleConfig({
      tableId: itemRow.tableId,
      moduleRole: 'stock_inventory',
      mapping: { ...invMod.mapping, quantityColumnId: qtyColId },
    })
  }

  const vals = (itemRow.values ?? {}) as Record<string, unknown>
  const currentQty = toFiniteNumber(vals[qtyColId], 0)
  const delta = input.movementType === 'giris' ? qty : -qty
  const nextQty = currentQty + delta

  if (nextQty < 0) {
    throw new Error(
      `Yetersiz stok! "${itemRow.displayTitle}" için mevcut miktar ${currentQty}, düşülmek istenen ${qty}.`
    )
  }

  const existingUnitCost = invMod.mapping.unitCostColumnId
    ? toFiniteNumber(vals[invMod.mapping.unitCostColumnId], 0)
    : 0
  const effectiveUnitCost =
    input.unitCost !== undefined && input.unitCost !== null
      ? Math.max(0, toFiniteNumber(input.unitCost, existingUnitCost))
      : existingUnitCost

  const updatedValues: Record<string, unknown> = {
    [qtyColId]: nextQty,
  }
  if (
    input.movementType === 'giris' &&
    invMod.mapping.unitCostColumnId &&
    effectiveUnitCost > 0
  ) {
    updatedValues[invMod.mapping.unitCostColumnId] = effectiveUnitCost
  }

  const updatedItem = await updateDynamicRow(itemRow.id, { values: updatedValues })

  // Log movement in dynamic stock_movement table
  const movMod = await ensureStockMovementTable(itemRow.tableId)
  const movPrimary =
    movMod.table.columns.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation') ??
    movMod.table.columns.find((c) => c.fieldType === 'text')
  const movColById = new Map(movMod.table.columns.map((c) => [c.id, c]))
  const mm = movMod.mapping

  const typeLabelMap: Record<typeof input.movementType, string> = {
    giris: 'Stok Girişi / Alım',
    cikis: 'Kullanım / Çıkış',
    fire: 'Zayi / Fire',
    imha: 'Süresi Doldu (İmha)',
    iade: 'Tedarikçi İadesi',
  }

  const totalAmount = Math.round(qty * effectiveUnitCost * 100) / 100
  const movValues: Record<string, unknown> = {}
  if (movPrimary) movValues[movPrimary.id] = `${typeLabelMap[input.movementType]} — ${itemRow.displayTitle}`
  if (mm.movementTypeColumnId) {
    movValues[mm.movementTypeColumnId] = pickOptionValueByKeyword(
      movColById.get(mm.movementTypeColumnId),
      input.movementType,
      typeLabelMap[input.movementType]
    )
  }
  if (mm.quantityColumnId) movValues[mm.quantityColumnId] = qty
  if (mm.unitCostColumnId) movValues[mm.unitCostColumnId] = effectiveUnitCost
  if (mm.amountColumnId) movValues[mm.amountColumnId] = totalAmount
  if (mm.dateColumnId) movValues[mm.dateColumnId] = todayIso()
  if (mm.actorColumnId && actor?.name) movValues[mm.actorColumnId] = actor.name
  if (mm.notesColumnId && input.notes) movValues[mm.notesColumnId] = input.notes.trim()

  const movRelations: Record<string, string[]> = {}
  if (mm.itemRelationColumnId) {
    const targetId = (
      movColById.get(mm.itemRelationColumnId)?.config as DynamicColumnConfig | undefined
    )?.targetTableId
    if (!targetId || targetId === itemRow.tableId) {
      movRelations[mm.itemRelationColumnId] = [itemRow.id]
    }
  }

  const movementRow = await createDynamicRow(
    movMod.table.id,
    {
      values: movValues,
      relations: movRelations,
    },
    actor?.id ?? undefined
  )

  // Cross-module Finance Expense / Refund automation
  let financeExpenseRow: Awaited<ReturnType<typeof createQuickDynamicFinanceEntry>> | null = null
  const shouldRecordFinance =
    input.recordInFinance !== false &&
    totalAmount > 0 &&
    (input.movementType === 'giris' || input.movementType === 'iade')

  if (shouldRecordFinance) {
    const signedAmount = input.movementType === 'iade' ? -totalAmount : totalAmount
    const signedUnitCost = input.movementType === 'iade' ? -effectiveUnitCost : effectiveUnitCost
    financeExpenseRow = await createQuickDynamicFinanceEntry(
      {
        entryType: 'expense',
        title:
          input.movementType === 'iade'
            ? `Tedarikçi İadesi (Mahsup): ${itemRow.displayTitle}`
            : `Stok Alımı: ${itemRow.displayTitle}`,
        amount: signedAmount,
        quantity: qty,
        unitCost: signedUnitCost,
        date: todayIso(),
        category: input.movementType === 'iade' ? 'iade_mahsup' : 'stok_malzeme',
        notes: input.notes?.trim() || `${qty} birim ${typeLabelMap[input.movementType].toLowerCase()}`,
        itemRowId: itemRow.id,
      },
      actor?.id ?? null
    )
  }

  return {
    updatedItem,
    nextQuantity: nextQty,
    movementRow,
    financeExpenseRow,
  }
}

export async function completeDynamicMaintenance(
  input: {
    rowId: string
    cost?: number
    notes?: string
    recordInFinance?: boolean
  },
  actor?: { id?: string | null; name?: string | null }
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const [maintRow] = await db
    .select()
    .from(dynamicRows)
    .where(and(eq(dynamicRows.id, input.rowId), eq(dynamicRows.clinicId, clinicId)))
    .limit(1)
  if (!maintRow) throw new Error('Bakım kaydı bulunamadı')

  const { resolved } = await resolveEffectiveModuleTables()
  let maintMod = resolved.find((r) => r.table.id === maintRow.tableId)
  if (!maintMod) {
    await upsertModuleConfig({ tableId: maintRow.tableId, moduleRole: 'asset_maintenance', enabled: true })
    const refreshed = await resolveEffectiveModuleTables()
    maintMod = refreshed.resolved.find((r) => r.table.id === maintRow.tableId)!
  }

  const colById = new Map(maintMod.table.columns.map((c) => [c.id, c]))
  const m = maintMod.mapping
  const vals = (maintRow.values ?? {}) as Record<string, unknown>

  const isPeriodic = m.isPeriodicColumnId ? Boolean(vals[m.isPeriodicColumnId]) : false
  const periodicDays = m.periodicDaysColumnId ? toFiniteNumber(vals[m.periodicDaysColumnId], 0) : 0
  const existingCost = m.amountColumnId ? toFiniteNumber(vals[m.amountColumnId], 0) : 0
  const effectiveCost =
    input.cost !== undefined && input.cost !== null
      ? Math.max(0, toFiniteNumber(input.cost, existingCost))
      : existingCost

  let nextDateColId = m.nextDateColumnId ?? null
  if (isPeriodic && periodicDays > 0 && !nextDateColId) {
    const createdNextCol = await createDynamicColumn(maintRow.tableId, {
      name: 'Sonraki Bakım Tarihi',
      fieldType: 'date',
      width: 165,
    })
    nextDateColId = createdNextCol.id
    await upsertModuleConfig({
      tableId: maintRow.tableId,
      moduleRole: 'asset_maintenance',
      mapping: { ...m, nextDateColumnId: nextDateColId },
    })
  }

  const today = todayIso()
  const computedNextDate = isPeriodic && periodicDays > 0 ? addDaysIso(today, periodicDays) : null

  const patchValues: Record<string, unknown> = {}
  if (m.statusColumnId) {
    patchValues[m.statusColumnId] = pickOptionValueByKeyword(
      colById.get(m.statusColumnId),
      'tamamlandi',
      'Tamamlandı'
    )
  }
  if (m.completedDateColumnId) {
    patchValues[m.completedDateColumnId] = today
  }
  if (nextDateColId && computedNextDate) {
    patchValues[nextDateColId] = computedNextDate
  }
  if (m.amountColumnId && effectiveCost > 0) {
    patchValues[m.amountColumnId] = effectiveCost
  }
  if (m.notesColumnId && input.notes?.trim()) {
    patchValues[m.notesColumnId] = input.notes.trim()
  }

  const updatedMaintenance = await updateDynamicRow(maintRow.id, { values: patchValues })

  // Log maintenance in stock_movement table
  const movMod = await ensureStockMovementTable()
  const movPrimary =
    movMod.table.columns.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation') ??
    movMod.table.columns.find((c) => c.fieldType === 'text')
  const movColById = new Map(movMod.table.columns.map((c) => [c.id, c]))
  const mm = movMod.mapping

  const movVals: Record<string, unknown> = {}
  if (movPrimary) movVals[movPrimary.id] = `Periyodik Bakım Tamamlandı — ${maintRow.displayTitle}`
  if (mm.movementTypeColumnId) {
    movVals[mm.movementTypeColumnId] = pickOptionValueByKeyword(
      movColById.get(mm.movementTypeColumnId),
      'bakim',
      'Periyodik Bakım'
    )
  }
  if (mm.quantityColumnId) movVals[mm.quantityColumnId] = 1
  if (mm.unitCostColumnId) movVals[mm.unitCostColumnId] = effectiveCost
  if (mm.amountColumnId) movVals[mm.amountColumnId] = effectiveCost
  if (mm.dateColumnId) movVals[mm.dateColumnId] = today
  if (mm.actorColumnId && actor?.name) movVals[mm.actorColumnId] = actor.name
  if (mm.notesColumnId) {
    movVals[mm.notesColumnId] =
      input.notes?.trim() ||
      (computedNextDate ? `Sonraki periyodik bakım tarihi: ${computedNextDate}` : 'Bakım tamamlandı')
  }

  await createDynamicRow(
    movMod.table.id,
    {
      values: movVals,
    },
    actor?.id ?? undefined
  )

  let financeExpenseRow: Awaited<ReturnType<typeof createQuickDynamicFinanceEntry>> | null = null
  if (input.recordInFinance !== false && effectiveCost > 0) {
    financeExpenseRow = await createQuickDynamicFinanceEntry(
      {
        entryType: 'expense',
        title: `Periyodik Bakım Gideri: ${maintRow.displayTitle}`,
        amount: effectiveCost,
        quantity: 1,
        unitCost: effectiveCost,
        date: today,
        category: 'bakim_onarim',
        notes: input.notes?.trim() || 'Tamamlanan bakım işlemi gideri',
      },
      actor?.id ?? null
    )
  }

  return {
    updatedMaintenance,
    computedNextDate,
    financeExpenseRow,
  }
}

// ── 1-Click Module Starter Packs & Legacy Importer ───────────────────────────

export async function applyModuleStarterPack(pack: ModuleStarterPackKey) {
  await ensureDynamicTablesSchema()

  if (
    pack === 'general_finance' ||
    pack === 'clinic_finance' ||
    pack === 'real_estate_finance' ||
    pack === 'insurance_finance'
  ) {
    await ensureCanonicalFinanceTables()
    return getStudioSchema()
  }

  const { schema } = await resolveEffectiveModuleTables()
  const maxCanvasX = schema.tables.reduce((max, t) => Math.max(max, t.canvasX || 0), 450)
  const canvasStartX = maxCanvasX + 380

  // Stock & Maintenance Starter Packs
  const isClinicStock = pack === 'clinic_stock'
  const isServiceStock = pack === 'service_parts_stock'

  await seedSectorFinanceAndStockTables({
    includeFinance: false,
    includeStock: true,
    canvasStartX,
    inventory: {
      tableName: isClinicStock
        ? 'Klinik Malzeme & Sarf Stoku'
        : isServiceStock
          ? 'Yedek Parça & Ekipman Stoku'
          : 'Ürün & Demirbaş Stoku',
      categories: isClinicStock
        ? [
            { id: 'restoratif', label: 'Restoratif & Endodonti', color: '#0284c7' },
            { id: 'cerrahi', label: 'Cerrahi & Sterilizasyon', color: '#0d9488' },
            { id: 'sarf', label: 'Tek Kullanımlık Sarf', color: '#15803d' },
          ]
        : [
            { id: 'ana_urun', label: 'Ana Kalem / Yedek Parça', color: '#2563eb' },
            { id: 'sarf', label: 'Sarf Malzeme', color: '#0284c7' },
            { id: 'ofis_ekipman', label: 'Ofis & Saha Malzemesi', color: '#15803d' },
          ],
      samples: [
        {
          name: isClinicStock
            ? 'Sterilizasyon Rulosu (20cm)'
            : isServiceStock
              ? 'Standart Bakım Filtre Seti'
              : 'Sarf Malzeme Paketi',
          category: 'sarf',
          unit: 'paket',
          qty: 4,
          minThreshold: 6,
          unitCost: 380,
          expiryDaysOffset: 24,
          notes: 'Kritik stok altı örnek kayıt',
        },
        {
          name: isClinicStock
            ? 'Kompozit Dolgu Seti'
            : isServiceStock
              ? 'Sensör & Bağlantı Modülü'
              : 'Kurumsal Sunum & Teslim Kiti',
          category: isClinicStock ? 'restoratif' : 'ana_urun',
          unit: 'set',
          qty: 16,
          minThreshold: 5,
          unitCost: 950,
          expiryDaysOffset: 240,
        },
      ],
    },
    maintenance: {
      tableName: isClinicStock ? 'Cihaz & Periyodik Bakımlar' : 'Demirbaş & Periyodik Bakımlar',
      types: [
        { id: 'periyodik_bakim', label: 'Periyodik Bakım & Kontrol', color: '#0284c7' },
        { id: 'kalibrasyon', label: 'Kalibrasyon & Sertifika', color: '#2563eb' },
        { id: 'ariza_servis', label: 'Arıza & Onarım', color: '#d97706' },
      ],
      samples: [
        {
          name: isClinicStock ? 'Otoklav Sterilizatör 3 Aylık Test' : 'Ana Ekipman Periyodik Kontrolü',
          type: 'periyodik_bakim',
          isPeriodic: true,
          periodicDays: 90,
          scheduledDaysOffset: 6,
          nextDaysOffset: 6,
          cost: 2200,
          status: 'planlandi',
        },
      ],
    },
  })
  return getStudioSchema()
}

export async function migrateLegacyModuleData(
  domain: 'finance' | 'stock',
  userId?: string | null
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  if (domain === 'finance') {
    const incMod = await ensureFinanceTableForEntry('finance_income')
    const expMod = await ensureFinanceTableForEntry('finance_expense')

    const [existingIncRows, existingExpRows, legPays, legExps] = await Promise.all([
      listDynamicRows(incMod.table.id),
      listDynamicRows(expMod.table.id),
      db
        .select({
          id: patientPayments.id,
          date: patientPayments.date,
          dueDate: patientPayments.dueDate,
          amount: patientPayments.amount,
          method: patientPayments.method,
          status: patientPayments.status,
          notes: patientPayments.notes,
          patientName: patients.name,
        })
        .from(patientPayments)
        .leftJoin(patients, eq(patients.id, patientPayments.patientId))
        .where(and(eq(patientPayments.clinicId, clinicId), eq(patientPayments.isActive, true)))
        .orderBy(desc(patientPayments.date)),
      db
        .select()
        .from(expenses)
        .where(eq(expenses.clinicId, clinicId))
        .orderBy(desc(expenses.date)),
    ])

    const seen = new Set<string>()
    for (const r of [...existingIncRows, ...existingExpRows]) {
      const lid = (r.values as Record<string, unknown> | undefined)?.__legacy_id
      if (typeof lid === 'string') seen.add(lid)
    }

    let importedIncomeCount = 0
    const incPrimary =
      incMod.table.columns.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation') ??
      incMod.table.columns.find((c) => c.fieldType === 'text')
    const incColById = new Map(incMod.table.columns.map((c) => [c.id, c]))
    const im = incMod.mapping

    for (const p of legPays) {
      const key = `payment:${p.id}`
      if (seen.has(key)) continue
      const vals: Record<string, unknown> = { __legacy_id: key }
      if (incPrimary) vals[incPrimary.id] = `${p.patientName || 'Kayıt'} — Tahsilat`
      if (im.counterpartyNameColumnId && p.patientName) {
        vals[im.counterpartyNameColumnId] = p.patientName
      }
      if (im.amountColumnId) vals[im.amountColumnId] = p.amount
      if (im.dateColumnId) vals[im.dateColumnId] = p.date
      if (im.dueDateColumnId && p.dueDate) vals[im.dueDateColumnId] = p.dueDate
      if (im.statusColumnId) {
        const desired =
          p.status === 'pending' ? 'pending' : p.status === 'cancelled' ? 'cancelled' : 'completed'
        vals[im.statusColumnId] = pickStatusSelectValue(incColById.get(im.statusColumnId), desired)
      }
      if (im.methodColumnId && p.method) {
        vals[im.methodColumnId] = pickOptionValueByKeyword(
          incColById.get(im.methodColumnId),
          p.method,
          p.method
        )
      }
      if (im.notesColumnId && p.notes) vals[im.notesColumnId] = p.notes

      const created = await createDynamicRow(incMod.table.id, { values: vals }, userId ?? undefined)
      // Preserve __legacy_id metadata inside dynamicRows.values
      await db
        .update(dynamicRows)
        .set({ values: { ...(created.values as Record<string, unknown>), __legacy_id: key } })
        .where(eq(dynamicRows.id, created.id))
      importedIncomeCount += 1
    }

    let importedExpenseCount = 0
    const expPrimary =
      expMod.table.columns.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation') ??
      expMod.table.columns.find((c) => c.fieldType === 'text')
    const expColById = new Map(expMod.table.columns.map((c) => [c.id, c]))
    const em = expMod.mapping

    for (const e of legExps) {
      const key = `expense:${e.id}`
      if (seen.has(key)) continue
      const vals: Record<string, unknown> = { __legacy_id: key }
      if (expPrimary) vals[expPrimary.id] = e.itemName
      if (em.categoryColumnId) {
        vals[em.categoryColumnId] = pickOptionValueByKeyword(
          expColById.get(em.categoryColumnId),
          e.category,
          e.category
        )
      }
      if (em.quantityColumnId) vals[em.quantityColumnId] = e.quantity
      if (em.unitCostColumnId) vals[em.unitCostColumnId] = e.unitCost
      if (em.amountColumnId) vals[em.amountColumnId] = e.totalCost
      if (em.dateColumnId) vals[em.dateColumnId] = e.date
      if (em.notesColumnId && e.notes) vals[em.notesColumnId] = e.notes

      const created = await createDynamicRow(expMod.table.id, { values: vals }, userId ?? undefined)
      await db
        .update(dynamicRows)
        .set({ values: { ...(created.values as Record<string, unknown>), __legacy_id: key } })
        .where(eq(dynamicRows.id, created.id))
      importedExpenseCount += 1
    }

    return { importedIncomeCount, importedExpenseCount }
  }

  // domain === 'stock'
  let { resolved } = await resolveEffectiveModuleTables()
  if (!resolved.some((r) => r.moduleRole === 'stock_inventory')) {
    await applyModuleStarterPack('general_stock')
    resolved = (await resolveEffectiveModuleTables()).resolved
  }

  const invMod = resolved.find((r) => r.moduleRole === 'stock_inventory')!
  const maintMod = resolved.find((r) => r.moduleRole === 'asset_maintenance')
  const movMod = await ensureStockMovementTable(invMod.table.id)

  const [existingInv, existingMaint, legItems, legMaints, legMovs] = await Promise.all([
    listDynamicRows(invMod.table.id),
    maintMod ? listDynamicRows(maintMod.table.id) : Promise.resolve([]),
    db.select().from(inventoryItems).where(eq(inventoryItems.clinicId, clinicId)),
    db.select().from(deviceMaintenances).where(eq(deviceMaintenances.clinicId, clinicId)),
    db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.clinicId, clinicId))
      .orderBy(desc(inventoryMovements.createdAt)),
  ])

  const seen = new Set<string>()
  const legacyItemRowMap = new Map<string, string>()
  for (const r of [...existingInv, ...existingMaint]) {
    const lid = (r.values as Record<string, unknown> | undefined)?.__legacy_id
    if (typeof lid === 'string') {
      seen.add(lid)
      if (lid.startsWith('inv:')) legacyItemRowMap.set(lid.slice(4), r.id)
    }
  }

  let importedItemCount = 0
  const invPrimary =
    invMod.table.columns.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation') ??
    invMod.table.columns.find((c) => c.fieldType === 'text')
  const invColById = new Map(invMod.table.columns.map((c) => [c.id, c]))
  const sm = invMod.mapping

  for (const item of legItems) {
    const key = `inv:${item.id}`
    if (seen.has(key)) continue
    const vals: Record<string, unknown> = {}
    if (invPrimary) vals[invPrimary.id] = item.name
    if (sm.categoryColumnId) {
      vals[sm.categoryColumnId] = pickOptionValueByKeyword(
        invColById.get(sm.categoryColumnId),
        item.category,
        item.category
      )
    }
    if (sm.unitColumnId) {
      vals[sm.unitColumnId] = pickOptionValueByKeyword(
        invColById.get(sm.unitColumnId),
        item.unit,
        item.unit
      )
    }
    if (sm.quantityColumnId) vals[sm.quantityColumnId] = item.quantity
    if (sm.minThresholdColumnId) vals[sm.minThresholdColumnId] = item.minThreshold
    if (sm.unitCostColumnId) vals[sm.unitCostColumnId] = item.costPerUnit
    if (sm.expiryDateColumnId && item.expiryDate) vals[sm.expiryDateColumnId] = item.expiryDate
    if (sm.notesColumnId) {
      vals[sm.notesColumnId] = [item.brand, item.supplierName].filter(Boolean).join(' • ')
    }

    const created = await createDynamicRow(invMod.table.id, { values: vals }, userId ?? undefined)
    await db
      .update(dynamicRows)
      .set({ values: { ...(created.values as Record<string, unknown>), __legacy_id: key } })
      .where(eq(dynamicRows.id, created.id))
    legacyItemRowMap.set(item.id, created.id)
    importedItemCount += 1
  }

  let importedMaintenanceCount = 0
  if (maintMod) {
    const mPrimary =
      maintMod.table.columns.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation') ??
      maintMod.table.columns.find((c) => c.fieldType === 'text')
    const mColById = new Map(maintMod.table.columns.map((c) => [c.id, c]))
    const mm = maintMod.mapping

    for (const dm of legMaints) {
      const key = `maint:${dm.id}`
      if (seen.has(key)) continue
      const vals: Record<string, unknown> = {}
      if (mPrimary) vals[mPrimary.id] = dm.deviceName
      if (mm.categoryColumnId) {
        vals[mm.categoryColumnId] = pickOptionValueByKeyword(
          mColById.get(mm.categoryColumnId),
          dm.maintenanceType,
          dm.maintenanceType
        )
      }
      if (mm.isPeriodicColumnId) vals[mm.isPeriodicColumnId] = dm.isPeriodic
      if (mm.periodicDaysColumnId && dm.periodicDays) vals[mm.periodicDaysColumnId] = dm.periodicDays
      if (mm.scheduledDateColumnId) vals[mm.scheduledDateColumnId] = dm.scheduledDate
      if (mm.nextDateColumnId && dm.nextMaintenanceDate) vals[mm.nextDateColumnId] = dm.nextMaintenanceDate
      if (mm.statusColumnId) {
        vals[mm.statusColumnId] = pickOptionValueByKeyword(
          mColById.get(mm.statusColumnId),
          dm.status === 'completed' ? 'tamamlandi' : 'planlandi',
          dm.status === 'completed' ? 'Tamamlandı' : 'Planlandı'
        )
      }
      if (mm.notesColumnId) {
        vals[mm.notesColumnId] = [dm.serialNumber, dm.maintenanceFirm, dm.notes]
          .filter(Boolean)
          .join(' • ')
      }

      const created = await createDynamicRow(maintMod.table.id, { values: vals }, userId ?? undefined)
      await db
        .update(dynamicRows)
        .set({ values: { ...(created.values as Record<string, unknown>), __legacy_id: key } })
        .where(eq(dynamicRows.id, created.id))
      importedMaintenanceCount += 1
    }
  }

  let importedMovementCount = 0
  const existingMovs = await listDynamicRows(movMod.table.id)
  for (const r of existingMovs) {
    const lid = (r.values as Record<string, unknown> | undefined)?.__legacy_id
    if (typeof lid === 'string') seen.add(lid)
  }
  const movPrimary =
    movMod.table.columns.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation') ??
    movMod.table.columns.find((c) => c.fieldType === 'text')
  const movColById = new Map(movMod.table.columns.map((c) => [c.id, c]))
  const mvm = movMod.mapping

  for (const mv of legMovs.slice(0, 100)) {
    const key = `mov:${mv.id}`
    if (seen.has(key)) continue
    const vals: Record<string, unknown> = {}
    if (movPrimary) vals[movPrimary.id] = mv.notes || `Stok Hareketi (${mv.type})`
    if (mvm.movementTypeColumnId) {
      vals[mvm.movementTypeColumnId] = pickOptionValueByKeyword(
        movColById.get(mvm.movementTypeColumnId),
        mv.type,
        mv.type
      )
    }
    if (mvm.quantityColumnId) vals[mvm.quantityColumnId] = mv.quantity
    if (mvm.dateColumnId && mv.createdAt) {
      vals[mvm.dateColumnId] = new Date(mv.createdAt).toISOString().slice(0, 10)
    }
    if (mvm.notesColumnId && mv.notes) vals[mvm.notesColumnId] = mv.notes

    const linkedDynItemId = legacyItemRowMap.get(mv.itemId)
    const rels: Record<string, string[]> = {}
    if (mvm.itemRelationColumnId && linkedDynItemId) {
      rels[mvm.itemRelationColumnId] = [linkedDynItemId]
    }

    const created = await createDynamicRow(
      movMod.table.id,
      {
        values: vals,
        relations: rels,
      },
      userId ?? undefined
    )
    await db
      .update(dynamicRows)
      .set({ values: { ...(created.values as Record<string, unknown>), __legacy_id: key } })
      .where(eq(dynamicRows.id, created.id))
    importedMovementCount += 1
  }

  return { importedItemCount, importedMaintenanceCount, importedMovementCount }
}
