import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import {
  auditLog,
  dynamicRows,
  financeAccountingConnections,
  financeAccountingSyncRecords,
} from '../db/schema'
import { ensureDynamicTablesSchema } from '../db/dynamic-tables-schema'
import {
  listDynamicRows,
  type DynamicColumnConfig,
  type SelectOptionItem,
} from '../db/repositories/dynamic-tables'
import { sealSecret } from './integration-secrets'
import { requireClinicId } from '../tenancy/context'
import {
  ALLOWED_PRE_ACCOUNTING_PROVIDERS,
  buildCanonicalAccountingEntry,
  DEFAULT_TDHP_EXPENSE_ACCOUNTS,
  DEFAULT_TDHP_INCOME_ACCOUNTS,
  formatAccountingCsv,
  getPreAccountingProviderAdapter,
  normalizeAccountingPaymentStatus,
  normalizeAccountingSyncStatus,
  normalizeDocumentType,
  SUPPORTED_PRE_ACCOUNTING_PROVIDERS,
  syncStatusToOptionId,
  type AccountingDirection,
  type AccountingSyncStatus,
  type CanonicalAccountingEntry,
  type PreAccountingProviderKey,
} from './pre-accounting-core'
import { resolveEffectiveModuleTables } from './dynamic-finance-stock'

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

function toFiniteNumber(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val.trim().replace(/\s/g, '').replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export async function listPreAccountingProviders() {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const savedConnections = await db
    .select({
      provider: financeAccountingConnections.provider,
      status: financeAccountingConnections.status,
      syncMode: financeAccountingConnections.syncMode,
      externalCompanyId: financeAccountingConnections.externalCompanyId,
      hasCredentials: sql<boolean>`(${financeAccountingConnections.credentialsEncrypted} IS NOT NULL)`,
      accountMapping: financeAccountingConnections.accountMapping,
      lastSyncedAt: financeAccountingConnections.lastSyncedAt,
      lastError: financeAccountingConnections.lastError,
      updatedAt: financeAccountingConnections.updatedAt,
    })
    .from(financeAccountingConnections)
    .where(eq(financeAccountingConnections.clinicId, clinicId))

  const byProvider = new Map(savedConnections.map((c) => [c.provider, c]))

  return {
    providers: SUPPORTED_PRE_ACCOUNTING_PROVIDERS.map((adapter) => {
      const conn = byProvider.get(adapter.provider)
      return {
        provider: adapter.provider,
        displayName: adapter.displayName,
        description: adapter.description,
        capabilities: adapter.capabilities,
        connection: conn
          ? {
              status: conn.status,
              syncMode: conn.syncMode,
              externalCompanyId: conn.externalCompanyId,
              hasCredentials: Boolean(conn.hasCredentials),
              accountMapping: (conn.accountMapping ?? {}) as Record<string, string>,
              lastSyncedAt: conn.lastSyncedAt ? conn.lastSyncedAt.toISOString() : null,
              lastError: conn.lastError,
              updatedAt: conn.updatedAt.toISOString(),
            }
          : {
              status: 'disconnected',
              syncMode: 'manual',
              externalCompanyId: null,
              hasCredentials: false,
              accountMapping: {},
              lastSyncedAt: null,
              lastError: null,
              updatedAt: null,
            },
      }
    }),
    defaultTdhpMapping: {
      income: DEFAULT_TDHP_INCOME_ACCOUNTS,
      expense: DEFAULT_TDHP_EXPENSE_ACCOUNTS,
    },
  }
}

export async function upsertPreAccountingConnection(
  providerRaw: string,
  input: {
    status?: 'disconnected' | 'configured' | 'connected' | 'error'
    syncMode?: 'manual' | 'auto_push' | 'two_way'
    externalCompanyId?: string | null
    credentials?: Record<string, unknown> | null
    accountMapping?: Record<string, string>
  },
  userId?: string | null
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const provider = String(providerRaw || '').trim().toLowerCase() as PreAccountingProviderKey
  if (!ALLOWED_PRE_ACCOUNTING_PROVIDERS.includes(provider)) {
    throw new Error(
      `Desteklenmeyen ön muhasebe sağlayıcısı. Desteklenenler: ${ALLOWED_PRE_ACCOUNTING_PROVIDERS.join(', ')}`
    )
  }

  const [current] = await db
    .select()
    .from(financeAccountingConnections)
    .where(
      and(
        eq(financeAccountingConnections.clinicId, clinicId),
        eq(financeAccountingConnections.provider, provider)
      )
    )
    .limit(1)

  const syncMode =
    input.syncMode === 'auto_push' || input.syncMode === 'two_way'
      ? input.syncMode
      : input.syncMode === 'manual'
        ? 'manual'
        : current?.syncMode || 'manual'

  const status =
    input.status === 'disconnected' ||
    input.status === 'configured' ||
    input.status === 'connected' ||
    input.status === 'error'
      ? input.status
      : input.credentials
        ? 'configured'
        : current?.status || 'disconnected'

  const credentialsEncrypted =
    input.credentials && Object.keys(input.credentials).length > 0
      ? sealSecret(JSON.stringify(input.credentials))
      : input.credentials === null
        ? null
        : current?.credentialsEncrypted ?? null

  const cleanMapping: Record<string, string> = {}
  const incomingMapping =
    input.accountMapping && typeof input.accountMapping === 'object'
      ? input.accountMapping
      : ((current?.accountMapping ?? {}) as Record<string, string>)
  for (const [k, v] of Object.entries(incomingMapping)) {
    const key = String(k || '').trim()
    const val = String(v || '').trim()
    if (key && val) cleanMapping[key] = val
  }

  const externalCompanyId =
    input.externalCompanyId !== undefined
      ? String(input.externalCompanyId || '').trim() || null
      : current?.externalCompanyId ?? null

  const [saved] = await db
    .insert(financeAccountingConnections)
    .values({
      clinicId,
      provider,
      status,
      syncMode,
      externalCompanyId,
      credentialsEncrypted,
      accountMapping: cleanMapping,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [financeAccountingConnections.clinicId, financeAccountingConnections.provider],
      set: {
        status,
        syncMode,
        externalCompanyId,
        credentialsEncrypted,
        accountMapping: cleanMapping,
        updatedAt: new Date(),
      },
    })
    .returning()

  try {
    await db.insert(auditLog).values({
      clinicId,
      userId: userId ?? null,
      action: 'finance.pre_accounting.connection_updated',
      targetType: 'finance_accounting_connection',
      targetId: saved!.id,
      metadata: { provider, status, syncMode },
    })
  } catch {
    // Audit log is best-effort
  }

  return {
    provider: saved!.provider,
    status: saved!.status,
    syncMode: saved!.syncMode,
    externalCompanyId: saved!.externalCompanyId,
    hasCredentials: Boolean(saved!.credentialsEncrypted),
    accountMapping: (saved!.accountMapping ?? {}) as Record<string, string>,
    lastSyncedAt: saved!.lastSyncedAt ? saved!.lastSyncedAt.toISOString() : null,
    lastError: saved!.lastError,
    updatedAt: saved!.updatedAt.toISOString(),
  }
}

export async function listCanonicalAccountingEntries(opts?: {
  direction?: 'all' | AccountingDirection
  syncStatus?: 'all' | AccountingSyncStatus
  dateFrom?: string
  dateTo?: string
  updatedAfter?: string
  provider?: string
  includeProviderPayload?: boolean
}) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const { resolved } = await resolveEffectiveModuleTables()
  const financeMods = resolved.filter(
    (r) => r.moduleRole === 'finance_income' || r.moduleRole === 'finance_expense'
  )

  const [rowLists, syncRecords, connections] = await Promise.all([
    Promise.all(financeMods.map((mod) => listDynamicRows(mod.table.id))),
    db
      .select()
      .from(financeAccountingSyncRecords)
      .where(eq(financeAccountingSyncRecords.clinicId, clinicId))
      .orderBy(desc(financeAccountingSyncRecords.updatedAt)),
    db
      .select({
        provider: financeAccountingConnections.provider,
        status: financeAccountingConnections.status,
        accountMapping: financeAccountingConnections.accountMapping,
      })
      .from(financeAccountingConnections)
      .where(eq(financeAccountingConnections.clinicId, clinicId)),
  ])

  const activeConnection =
    connections.find((c) => c.status === 'connected') ??
    connections.find((c) => c.status === 'configured') ??
    null
  const explicitProvider = opts?.provider?.trim().toLowerCase() || null
  const preferredProvider = explicitProvider || activeConnection?.provider || null

  // Priority: requested/active provider (3) > most recently updated external provider when no specific provider was requested (2) > local (1)
  const syncByRowId = new Map<string, typeof syncRecords[number]>()
  const syncPriorityByRowId = new Map<string, number>()
  for (const sr of syncRecords) {
    let priority = 0
    if (preferredProvider && sr.provider === preferredProvider) {
      priority = 3
    } else if (!explicitProvider && sr.provider !== 'local') {
      priority = 2
    } else if (sr.provider === 'local') {
      priority = 1
    }
    const prevPriority = syncPriorityByRowId.get(sr.rowId) ?? 0
    if (priority > prevPriority) {
      syncByRowId.set(sr.rowId, sr)
      syncPriorityByRowId.set(sr.rowId, priority)
    }
  }

  const entries: CanonicalAccountingEntry[] = []

  financeMods.forEach((mod, idx) => {
    const direction: AccountingDirection =
      mod.moduleRole === 'finance_expense' ? 'expense' : 'income'
    if (opts?.direction && opts.direction !== 'all' && opts.direction !== direction) return

    const rows = rowLists[idx] ?? []
    const colById = new Map(mod.table.columns.map((c) => [c.id, c]))
    const m = mod.mapping

    for (const r of rows) {
      const vals = (r.values ?? {}) as Record<string, unknown>
      const qty = m.quantityColumnId ? Math.max(1, toFiniteNumber(vals[m.quantityColumnId], 1)) : 1
      const unitCost = m.unitCostColumnId ? toFiniteNumber(vals[m.unitCostColumnId], 0) : 0
      const explicitAmount = m.amountColumnId ? toFiniteNumber(vals[m.amountColumnId], NaN) : NaN
      const grossAmount = Number.isFinite(explicitAmount) ? explicitAmount : qty * unitCost
      const netAmount =
        m.netAmountColumnId && vals[m.netAmountColumnId] != null
          ? toFiniteNumber(vals[m.netAmountColumnId], NaN)
          : NaN
      const vatAmount =
        m.vatAmountColumnId && vals[m.vatAmountColumnId] != null
          ? toFiniteNumber(vals[m.vatAmountColumnId], NaN)
          : NaN

      const rawDate = m.dateColumnId ? vals[m.dateColumnId] : null
      const issueDate =
        typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate)
          ? rawDate.slice(0, 10)
          : new Date(r.createdAt).toISOString().slice(0, 10)

      if (opts?.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(opts.dateFrom) && issueDate < opts.dateFrom) {
        continue
      }
      if (opts?.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(opts.dateTo) && issueDate > opts.dateTo) {
        continue
      }
      const updatedIso = new Date(r.updatedAt).toISOString()
      if (opts?.updatedAfter && updatedIso <= opts.updatedAfter) {
        continue
      }

      const rawDue = m.dueDateColumnId ? vals[m.dueDateColumnId] : null
      const dueDate =
        typeof rawDue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDue) ? rawDue.slice(0, 10) : null

      const statusCol = m.statusColumnId ? colById.get(m.statusColumnId) : undefined
      const statusLabel = m.statusColumnId ? resolveOptionLabel(statusCol, vals[m.statusColumnId]) : null
      const paymentStatus = m.statusColumnId
        ? normalizeAccountingPaymentStatus(vals[m.statusColumnId], statusLabel)
        : 'completed'

      const methodCol = m.methodColumnId ? colById.get(m.methodColumnId) : undefined
      const methodCode = m.methodColumnId && vals[m.methodColumnId] ? String(vals[m.methodColumnId]) : 'nakit'
      const methodLabel =
        (m.methodColumnId ? resolveOptionLabel(methodCol, vals[m.methodColumnId]) : null) ??
        'Nakit (Kasa)'

      const catCol = m.categoryColumnId ? colById.get(m.categoryColumnId) : undefined
      const catCode =
        m.categoryColumnId && vals[m.categoryColumnId]
          ? String(vals[m.categoryColumnId])
          : direction === 'income'
            ? 'hizmet_geliri'
            : 'diger_gider'
      const catLabel =
        (m.categoryColumnId ? resolveOptionLabel(catCol, vals[m.categoryColumnId]) : null) ??
        (direction === 'income' ? 'Hizmet / İşlem Geliri' : 'Diğer İşletme Giderleri')

      const linkedPersons =
        (m.personRelationColumnId ? r.relations[m.personRelationColumnId] : undefined) ?? []
      const linkedServices =
        (m.serviceRelationColumnId ? r.relations[m.serviceRelationColumnId] : undefined) ?? []
      const linkedItems =
        (m.itemRelationColumnId ? r.relations[m.itemRelationColumnId] : undefined) ?? []

      const explicitCounterparty =
        m.counterpartyNameColumnId && vals[m.counterpartyNameColumnId]
          ? String(vals[m.counterpartyNameColumnId]).trim()
          : null
      const counterpartyName = explicitCounterparty || linkedPersons[0]?.displayTitle || null
      const counterpartyTaxId =
        m.counterpartyTaxIdColumnId && vals[m.counterpartyTaxIdColumnId]
          ? String(vals[m.counterpartyTaxIdColumnId]).trim()
          : null

      const syncRec = syncByRowId.get(r.id)
      const colSyncStatusRaw = m.accountingSyncStatusColumnId
        ? vals[m.accountingSyncStatusColumnId]
        : null
      const effectiveSyncStatus: AccountingSyncStatus | undefined = syncRec
        ? normalizeAccountingSyncStatus(syncRec.syncStatus)
        : colSyncStatusRaw
          ? normalizeAccountingSyncStatus(colSyncStatusRaw)
          : undefined

      const entry = buildCanonicalAccountingEntry({
        clinicId,
        tableId: mod.table.id,
        rowId: r.id,
        direction,
        title: r.displayTitle,
        description:
          m.notesColumnId && vals[m.notesColumnId] ? String(vals[m.notesColumnId]).trim() : null,
        issueDate,
        dueDate,
        quantity: qty,
        grossAmount,
        netAmount: Number.isFinite(netAmount) ? netAmount : null,
        vatRate: m.vatRateColumnId ? vals[m.vatRateColumnId] : 0,
        vatAmount: Number.isFinite(vatAmount) ? vatAmount : null,
        currency: m.currencyColumnId ? vals[m.currencyColumnId] : 'TRY',
        exchangeRate: m.exchangeRateColumnId ? vals[m.exchangeRateColumnId] : 1,
        paymentStatus,
        paymentMethodCode: methodCode,
        paymentMethodLabel: methodLabel,
        categoryCode: catCode,
        categoryLabel: catLabel,
        accountingAccountCode:
          m.accountingCodeColumnId && vals[m.accountingCodeColumnId]
            ? String(vals[m.accountingCodeColumnId]).trim()
            : null,
        documentType: m.documentTypeColumnId
          ? normalizeDocumentType(vals[m.documentTypeColumnId])
          : 'belgesiz',
        documentNumber:
          m.documentNumberColumnId && vals[m.documentNumberColumnId]
            ? String(vals[m.documentNumberColumnId]).trim()
            : null,
        counterpartyLinkedRowId: linkedPersons[0]?.id ?? null,
        counterpartyName,
        counterpartyTaxId,
        linkedItems: [...linkedServices, ...linkedItems].map((li) => ({
          rowId: li.id,
          tableId: li.tableId,
          title: li.displayTitle,
        })),
        sync: {
          status: effectiveSyncStatus,
          provider: syncRec && syncRec.provider !== 'local' ? syncRec.provider : activeConnection?.provider ?? null,
          externalDocumentId: syncRec?.externalDocumentId ?? null,
          externalContactId: syncRec?.externalContactId ?? null,
          externalPaymentId: syncRec?.externalPaymentId ?? null,
          externalDocumentNumber: syncRec?.externalDocumentNumber ?? null,
          lastSyncedAt: syncRec?.lastSyncedAt ? syncRec.lastSyncedAt.toISOString() : null,
          lastError: syncRec?.lastError ?? null,
        },
        updatedAt: updatedIso,
      })

      if (opts?.syncStatus && opts.syncStatus !== 'all' && entry.sync.status !== opts.syncStatus) {
        continue
      }

      entries.push(entry)
    }
  })

  entries.sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.updatedAt.localeCompare(a.updatedAt))

  const summary = {
    totalCount: entries.length,
    readyCount: entries.filter((e) => e.sync.status === 'ready').length,
    pendingCount: entries.filter((e) => e.sync.status === 'pending').length,
    syncedCount: entries.filter((e) => e.sync.status === 'synced').length,
    failedCount: entries.filter((e) => e.sync.status === 'failed').length,
    ignoredCount: entries.filter((e) => e.sync.status === 'ignored').length,
    connectedProvider: activeConnection?.provider ?? null,
  }

  let providerPayloads: Record<string, Record<string, unknown>> | undefined
  if (opts?.includeProviderPayload && opts.provider) {
    const adapter = getPreAccountingProviderAdapter(opts.provider)
    if (adapter) {
      const conn = connections.find((c) => c.provider === opts.provider)
      const acctMap = (conn?.accountMapping ?? {}) as Record<string, string>
      providerPayloads = {}
      for (const e of entries) {
        providerPayloads[e.rowId] = adapter.mapEntryToProviderPayload(e, acctMap)
      }
    }
  }

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    summary,
    entries,
    ...(providerPayloads ? { providerPayloads } : {}),
  }
}

export async function exportCanonicalAccountingLedger(opts?: {
  format?: 'json' | 'csv'
  direction?: 'all' | AccountingDirection
  syncStatus?: 'all' | AccountingSyncStatus
  dateFrom?: string
  dateTo?: string
  provider?: string
}) {
  const result = await listCanonicalAccountingEntries({
    direction: opts?.direction,
    syncStatus: opts?.syncStatus,
    dateFrom: opts?.dateFrom,
    dateTo: opts?.dateTo,
    provider: opts?.provider,
    includeProviderPayload: Boolean(opts?.provider),
  })

  if (opts?.format === 'csv') {
    return {
      format: 'csv' as const,
      filename: `on_muhasebe_aktarim_${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: formatAccountingCsv(result.entries),
      count: result.entries.length,
    }
  }

  return {
    format: 'json' as const,
    filename: `on_muhasebe_aktarim_${new Date().toISOString().slice(0, 10)}.json`,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(result, null, 2),
    data: result,
    count: result.entries.length,
  }
}

export async function acknowledgePreAccountingSync(input: {
  provider: string
  rowId?: string
  idempotencyKey?: string
  syncStatus: 'synced' | 'failed' | 'pending' | 'ignored'
  externalDocumentId?: string | null
  externalContactId?: string | null
  externalPaymentId?: string | null
  externalDocumentNumber?: string | null
  lastError?: string | null
}) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const provider = String(input.provider || '').trim().toLowerCase() as PreAccountingProviderKey
  if (!ALLOWED_PRE_ACCOUNTING_PROVIDERS.includes(provider)) {
    throw new Error('Geçersiz ön muhasebe sağlayıcısı')
  }

  let resolvedRowId = String(input.rowId || '').trim()
  if (!resolvedRowId && input.idempotencyKey) {
    const parts = String(input.idempotencyKey).split(':')
    if (parts.length === 2 && parts[0] === clinicId) {
      resolvedRowId = parts[1]!
    }
  }
  if (!resolvedRowId) {
    throw new Error('Senkronizasyon onayı için rowId veya geçerli idempotencyKey zorunludur')
  }

  const [row] = await db
    .select()
    .from(dynamicRows)
    .where(and(eq(dynamicRows.id, resolvedRowId), eq(dynamicRows.clinicId, clinicId)))
    .limit(1)
  if (!row) throw new Error('Finans kaydı bulunamadı')

  const { resolved } = await resolveEffectiveModuleTables()
  const mod = resolved.find(
    (r) =>
      r.table.id === row.tableId &&
      (r.moduleRole === 'finance_income' || r.moduleRole === 'finance_expense')
  )
  if (!mod) throw new Error('Bu kayıt bir finans tablosuna ait değil')

  const direction: AccountingDirection =
    mod.moduleRole === 'finance_expense' ? 'expense' : 'income'
  const idempotencyKey = input.idempotencyKey?.trim() || `${clinicId}:${row.id}`

  const [localRec] = await db
    .select({ payloadHash: financeAccountingSyncRecords.payloadHash, canonicalSnapshot: financeAccountingSyncRecords.canonicalSnapshot })
    .from(financeAccountingSyncRecords)
    .where(
      and(
        eq(financeAccountingSyncRecords.clinicId, clinicId),
        eq(financeAccountingSyncRecords.rowId, row.id),
        eq(financeAccountingSyncRecords.provider, 'local')
      )
    )
    .limit(1)

  const [existingProvRec] = await db
    .select()
    .from(financeAccountingSyncRecords)
    .where(
      and(
        eq(financeAccountingSyncRecords.clinicId, clinicId),
        eq(financeAccountingSyncRecords.rowId, row.id),
        eq(financeAccountingSyncRecords.provider, provider)
      )
    )
    .limit(1)

  const nextRetry =
    input.syncStatus === 'failed'
      ? (existingProvRec?.retryCount ?? 0) + 1
      : existingProvRec?.retryCount ?? 0

  const now = new Date()

  // Update dynamic row's accountingSyncStatus and backfill official documentNumber if blank
  const nextValues = { ...((row.values ?? {}) as Record<string, unknown>) }
  let touchedRow = false
  let backfilledDocNumber = false
  if (mod.mapping.accountingSyncStatusColumnId) {
    nextValues[mod.mapping.accountingSyncStatusColumnId] = syncStatusToOptionId(input.syncStatus)
    touchedRow = true
  }
  if (
    input.externalDocumentNumber &&
    mod.mapping.documentNumberColumnId &&
    !nextValues[mod.mapping.documentNumberColumnId]
  ) {
    nextValues[mod.mapping.documentNumberColumnId] = input.externalDocumentNumber
    touchedRow = true
    backfilledDocNumber = true
  }
  if (touchedRow) {
    await db
      .update(dynamicRows)
      .set({ values: nextValues, updatedAt: now })
      .where(and(eq(dynamicRows.id, row.id), eq(dynamicRows.clinicId, clinicId)))
  }

  // Recompute canonical snapshot & payloadHash when documentNumber was backfilled or local hash was absent,
  // so subsequent harmless edits don't falsely dirty the synced provider record.
  let effectivePayloadHash = localRec?.payloadHash ?? existingProvRec?.payloadHash ?? null
  let effectiveSnapshot = (localRec?.canonicalSnapshot ??
    existingProvRec?.canonicalSnapshot ??
    {}) as Record<string, unknown>

  if (backfilledDocNumber || !effectivePayloadHash) {
    const hydratedList = await listDynamicRows(row.tableId, { archived: row.isArchived })
    const hydratedRow = hydratedList.find((r) => r.id === row.id)
    if (hydratedRow) {
      const colById = new Map(mod.table.columns.map((c) => [c.id, c]))
      const m = mod.mapping
      const vals = (hydratedRow.values ?? {}) as Record<string, unknown>
      const qty = m.quantityColumnId ? Math.max(1, toFiniteNumber(vals[m.quantityColumnId], 1)) : 1
      const unitCost = m.unitCostColumnId ? toFiniteNumber(vals[m.unitCostColumnId], 0) : 0
      const explicitAmount = m.amountColumnId ? toFiniteNumber(vals[m.amountColumnId], NaN) : NaN
      const grossAmount = Number.isFinite(explicitAmount) ? explicitAmount : qty * unitCost
      const netAmount =
        m.netAmountColumnId && vals[m.netAmountColumnId] != null
          ? toFiniteNumber(vals[m.netAmountColumnId], NaN)
          : NaN
      const vatAmount =
        m.vatAmountColumnId && vals[m.vatAmountColumnId] != null
          ? toFiniteNumber(vals[m.vatAmountColumnId], NaN)
          : NaN
      const rawDate = m.dateColumnId ? vals[m.dateColumnId] : null
      const issueDate =
        typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate)
          ? rawDate.slice(0, 10)
          : new Date(row.createdAt).toISOString().slice(0, 10)
      const rawDue = m.dueDateColumnId ? vals[m.dueDateColumnId] : null
      const dueDate =
        typeof rawDue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDue) ? rawDue.slice(0, 10) : null
      const statusCol = m.statusColumnId ? colById.get(m.statusColumnId) : undefined
      const statusLabel = m.statusColumnId ? resolveOptionLabel(statusCol, vals[m.statusColumnId]) : null
      const paymentStatus = m.statusColumnId
        ? normalizeAccountingPaymentStatus(vals[m.statusColumnId], statusLabel)
        : 'completed'
      const methodCol = m.methodColumnId ? colById.get(m.methodColumnId) : undefined
      const methodCode = m.methodColumnId && vals[m.methodColumnId] ? String(vals[m.methodColumnId]) : 'nakit'
      const methodLabel =
        (m.methodColumnId ? resolveOptionLabel(methodCol, vals[m.methodColumnId]) : null) ??
        'Nakit (Kasa)'
      const catCol = m.categoryColumnId ? colById.get(m.categoryColumnId) : undefined
      const catCode =
        m.categoryColumnId && vals[m.categoryColumnId]
          ? String(vals[m.categoryColumnId])
          : direction === 'income'
            ? 'hizmet_geliri'
            : 'diger_gider'
      const catLabel =
        (m.categoryColumnId ? resolveOptionLabel(catCol, vals[m.categoryColumnId]) : null) ??
        (direction === 'income' ? 'Hizmet / İşlem Geliri' : 'Diğer İşletme Giderleri')
      const linkedPersons =
        (m.personRelationColumnId ? hydratedRow.relations[m.personRelationColumnId] : undefined) ?? []
      const linkedServices =
        (m.serviceRelationColumnId ? hydratedRow.relations[m.serviceRelationColumnId] : undefined) ?? []
      const linkedItems =
        (m.itemRelationColumnId ? hydratedRow.relations[m.itemRelationColumnId] : undefined) ?? []
      const explicitCounterparty =
        m.counterpartyNameColumnId && vals[m.counterpartyNameColumnId]
          ? String(vals[m.counterpartyNameColumnId]).trim()
          : null
      const counterpartyName = explicitCounterparty || linkedPersons[0]?.displayTitle || null
      const counterpartyTaxId =
        m.counterpartyTaxIdColumnId && vals[m.counterpartyTaxIdColumnId]
          ? String(vals[m.counterpartyTaxIdColumnId]).trim()
          : null

      const recomputed = buildCanonicalAccountingEntry({
        clinicId,
        tableId: row.tableId,
        rowId: row.id,
        direction,
        title: hydratedRow.displayTitle,
        description: m.notesColumnId && vals[m.notesColumnId] ? String(vals[m.notesColumnId]).trim() : null,
        issueDate,
        dueDate,
        quantity: qty,
        grossAmount,
        netAmount: Number.isFinite(netAmount) ? netAmount : null,
        vatRate: m.vatRateColumnId ? vals[m.vatRateColumnId] : 0,
        vatAmount: Number.isFinite(vatAmount) ? vatAmount : null,
        currency: m.currencyColumnId ? vals[m.currencyColumnId] : 'TRY',
        exchangeRate: m.exchangeRateColumnId ? vals[m.exchangeRateColumnId] : 1,
        paymentStatus,
        paymentMethodCode: methodCode,
        paymentMethodLabel: methodLabel,
        categoryCode: catCode,
        categoryLabel: catLabel,
        accountingAccountCode:
          m.accountingCodeColumnId && vals[m.accountingCodeColumnId]
            ? String(vals[m.accountingCodeColumnId]).trim()
            : null,
        documentType: m.documentTypeColumnId
          ? normalizeDocumentType(vals[m.documentTypeColumnId])
          : 'belgesiz',
        documentNumber:
          m.documentNumberColumnId && vals[m.documentNumberColumnId]
            ? String(vals[m.documentNumberColumnId]).trim()
            : null,
        counterpartyLinkedRowId: linkedPersons[0]?.id ?? null,
        counterpartyName,
        counterpartyTaxId,
        linkedItems: [...linkedServices, ...linkedItems].map((li) => ({
          rowId: li.id,
          tableId: li.tableId,
          title: li.displayTitle,
        })),
      })

      effectivePayloadHash = recomputed.payloadHash
      effectiveSnapshot = recomputed as unknown as Record<string, unknown>

      // Keep local sync record hash synchronized with the backfilled documentNumber
      await db
        .insert(financeAccountingSyncRecords)
        .values({
          clinicId,
          rowId: row.id,
          tableId: row.tableId,
          direction,
          provider: 'local',
          idempotencyKey,
          syncStatus: recomputed.sync.status,
          payloadHash: effectivePayloadHash,
          canonicalSnapshot: effectiveSnapshot,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            financeAccountingSyncRecords.clinicId,
            financeAccountingSyncRecords.rowId,
            financeAccountingSyncRecords.provider,
          ],
          set: {
            payloadHash: effectivePayloadHash,
            canonicalSnapshot: effectiveSnapshot,
            updatedAt: now,
          },
        })
    }
  }

  const [saved] = await db
    .insert(financeAccountingSyncRecords)
    .values({
      clinicId,
      rowId: row.id,
      tableId: row.tableId,
      direction,
      provider,
      idempotencyKey,
      externalDocumentId: input.externalDocumentId ?? existingProvRec?.externalDocumentId ?? null,
      externalContactId: input.externalContactId ?? existingProvRec?.externalContactId ?? null,
      externalPaymentId: input.externalPaymentId ?? existingProvRec?.externalPaymentId ?? null,
      externalDocumentNumber:
        input.externalDocumentNumber ?? existingProvRec?.externalDocumentNumber ?? null,
      syncStatus: input.syncStatus,
      payloadHash: effectivePayloadHash,
      canonicalSnapshot: effectiveSnapshot,
      retryCount: nextRetry,
      lastError: input.syncStatus === 'failed' ? input.lastError ?? 'Aktarım hatası' : null,
      lastSyncedAt: input.syncStatus === 'synced' ? now : existingProvRec?.lastSyncedAt ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        financeAccountingSyncRecords.clinicId,
        financeAccountingSyncRecords.rowId,
        financeAccountingSyncRecords.provider,
      ],
      set: {
        externalDocumentId: input.externalDocumentId ?? existingProvRec?.externalDocumentId ?? null,
        externalContactId: input.externalContactId ?? existingProvRec?.externalContactId ?? null,
        externalPaymentId: input.externalPaymentId ?? existingProvRec?.externalPaymentId ?? null,
        externalDocumentNumber:
          input.externalDocumentNumber ?? existingProvRec?.externalDocumentNumber ?? null,
        syncStatus: input.syncStatus,
        payloadHash: effectivePayloadHash,
        canonicalSnapshot: effectiveSnapshot,
        retryCount: nextRetry,
        lastError: input.syncStatus === 'failed' ? input.lastError ?? 'Aktarım hatası' : null,
        lastSyncedAt: input.syncStatus === 'synced' ? now : existingProvRec?.lastSyncedAt ?? null,
        updatedAt: now,
      },
    })
    .returning()

  // Update provider connection's lastSyncedAt / lastError
  await db
    .update(financeAccountingConnections)
    .set({
      lastSyncedAt: input.syncStatus === 'synced' ? now : undefined,
      lastError: input.syncStatus === 'failed' ? input.lastError ?? 'Aktarım hatası' : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(financeAccountingConnections.clinicId, clinicId),
        eq(financeAccountingConnections.provider, provider)
      )
    )

  return saved
}
