import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import {
  auditLog,
  clinics,
  conversationFlows,
  dynamicModuleConfigs,
  dynamicTables,
  financeAccountingConnections,
  financeAccountingSyncRecords,
  users,
} from '../db/schema'
import { createSession, createUser } from '../db/repositories/users'
import { signToken } from '../middleware/auth'
import { dynamicTablesPlugin } from '../routes/dynamic-tables'
import { runWithTenantContext } from '../tenancy/context'
import {
  bulkImportDynamicRows,
  clearDynamicTables,
  createDynamicColumn,
  createDynamicRow,
  createDynamicTable,
  deleteDynamicColumn,
  deleteDynamicRows,
  deleteDynamicTable,
  deleteModuleConfig,
  getStudioSchema,
  listDynamicRows,
  updateDynamicColumn,
  updateDynamicRow,
  updateDynamicTable,
  upsertModuleConfig,
} from '../db/repositories/dynamic-tables'
import { applyAiScenarioPlan } from './dynamic-schema-ai'
import {
  applyModuleStarterPack,
  createQuickDynamicFinanceEntry,
  ensureCanonicalFinanceTables,
  getDynamicFinanceOverview,
} from './dynamic-finance-stock'
import {
  acknowledgePreAccountingSync,
  exportCanonicalAccountingLedger,
  listCanonicalAccountingEntries,
  listPreAccountingProviders,
  upsertPreAccountingConnection,
} from './pre-accounting'
import {
  buildCanonicalAccountingEntry,
  calculateAccountingAmounts,
  formatAccountingCsv,
  roundMoney,
  SUPPORTED_PRE_ACCOUNTING_PROVIDERS,
  validateTurkishTaxId,
} from './pre-accounting-core'

function makeValidVkn(firstNineDigits: string): string {
  const digits = firstNineDigits.split('').map(Number)
  let sum = 0
  for (let i = 0; i < 9; i++) {
    const tmp = (digits[i]! + (9 - i)) % 10
    const weighted = tmp === 9 ? 9 : (tmp * Math.pow(2, 9 - i)) % 9
    sum += weighted
  }
  const check = (10 - (sum % 10)) % 10
  return `${firstNineDigits}${check}`
}

function makeValidTckn(firstNineDigits: string): string {
  const d = firstNineDigits.split('').map(Number)
  const oddSum = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!
  const evenSum = d[1]! + d[3]! + d[5]! + d[7]!
  const d10 = ((oddSum * 7 - evenSum) % 10 + 10) % 10
  const d11 = (d.reduce((a, b) => a + b, 0) + d10) % 10
  return `${firstNineDigits}${d10}${d11}`
}

describe('Pre-Accounting Core (Pure Financial, Tax & Adapter Rules)', () => {
  test('calculateAccountingAmounts preserves penny-exact net + vat === gross across VAT rates, inclusive/exclusive, refunds & FX', () => {
    const inc20 = calculateAccountingAmounts({
      grossAmount: 1200,
      vatRate: 20,
      vatIncluded: true,
      currency: 'TRY',
    })
    expect(inc20.netAmount).toBe(1000)
    expect(inc20.vatAmount).toBe(200)
    expect(inc20.grossAmount).toBe(1200)
    expect(inc20.baseAmountTry).toBe(1200)

    // Repeating decimal case: 100 / 1.20 = 83.3333...
    const repeating = calculateAccountingAmounts({
      grossAmount: 100,
      vatRate: 20,
      vatIncluded: true,
      currency: 'TRY',
    })
    expect(repeating.netAmount).toBe(83.33)
    expect(repeating.vatAmount).toBe(16.67)
    expect(Number((repeating.netAmount + repeating.vatAmount).toFixed(2))).toBe(100)

    // VAT-exclusive + foreign currency
    const excFx = calculateAccountingAmounts({
      netAmount: 100,
      vatRate: 10,
      vatIncluded: false,
      currency: 'USD',
      exchangeRate: 38.5,
    })
    expect(excFx.netAmount).toBe(100)
    expect(excFx.vatAmount).toBe(10)
    expect(excFx.grossAmount).toBe(110)
    expect(excFx.baseAmountTry).toBe(4235)

    // Negative supplier refund / mahsup
    const refund = calculateAccountingAmounts({
      grossAmount: -360,
      vatRate: 20,
      vatIncluded: true,
      currency: 'TRY',
    })
    expect(refund.netAmount).toBe(-300)
    expect(refund.vatAmount).toBe(-60)
    expect(refund.grossAmount).toBe(-360)
    expect(Number((refund.netAmount + refund.vatAmount).toFixed(2))).toBe(-360)

    // Zero VAT
    const zeroVat = calculateAccountingAmounts({
      grossAmount: 99.99,
      vatRate: 0,
      vatIncluded: true,
      currency: 'EUR',
      exchangeRate: 41.2,
    })
    expect(zeroVat.netAmount).toBe(99.99)
    expect(zeroVat.vatAmount).toBe(0)
    expect(zeroVat.grossAmount).toBe(99.99)
    expect(zeroVat.baseAmountTry).toBe(4119.59)
  })

  test('validateTurkishTaxId enforces real GİB 10-digit VKN and 11-digit TCKN checksums', () => {
    const validVkn = makeValidVkn('123456789')
    const badVkn = `${validVkn.slice(0, 9)}${(Number(validVkn[9]) + 1) % 10}`
    const validTckn = makeValidTckn('123456789')
    const badTckn = `${validTckn.slice(0, 10)}${(Number(validTckn[10]) + 1) % 10}`

    expect(validateTurkishTaxId(validVkn)).toMatchObject({ isValid: true, type: 'vkn', normalized: validVkn })
    expect(validateTurkishTaxId(badVkn)).toMatchObject({ isValid: false, type: 'vkn' })
    expect(validateTurkishTaxId(validTckn)).toMatchObject({ isValid: true, type: 'tckn', normalized: validTckn })
    expect(validateTurkishTaxId(badTckn)).toMatchObject({ isValid: false, type: 'tckn' })
    expect(validateTurkishTaxId('01234567890')).toMatchObject({ isValid: false, type: 'tckn' })
    expect(validateTurkishTaxId('12345')).toMatchObject({ isValid: false, type: null })
    expect(validateTurkishTaxId('')).toMatchObject({ isValid: true, type: null, normalized: null })
  })

  test('formatAccountingCsv writes UTF-8 BOM, semicolon delimiter, and neutralizes CSV formula injection', () => {
    const entry = buildCanonicalAccountingEntry({
      clinicId: 'c1',
      tableId: 't1',
      rowId: 'r1',
      direction: 'income',
      title: '=HYPERLINK("http://evil.example","Tıkla")',
      grossAmount: 1200,
      vatRate: 20,
      currency: 'TRY',
      issueDate: '2026-11-22',
      paymentStatus: 'completed',
      counterpartyName: '+ABC Teknoloji A.Ş.',
      description: '@cmd|calc',
    })

    const csv = formatAccountingCsv([entry])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain(';')
    // Leading =, +, @ must be prefixed with a single quote inside CSV cells to prevent Excel formula execution
    expect(csv).toContain(`"'=HYPERLINK(`)
    expect(csv).toContain(`'+ABC Teknoloji A.Ş.`)
    expect(csv).toContain(`'@cmd|calc`)
  })

  test('roundMoney handles negative half-away-from-zero without -0, net-only entries calculate gross, and leading-space formulas are neutralized', () => {
    expect(roundMoney(-1.005)).toBe(-1.01)
    expect(Object.is(roundMoney(-0.001), 0)).toBe(true)

    const netOnly = buildCanonicalAccountingEntry({
      clinicId: 'c1',
      tableId: 't1',
      rowId: 'r_net',
      direction: 'income',
      title: ' =2+2',
      grossAmount: 0,
      netAmount: 1000,
      vatRate: 20,
      currency: 'TRY',
      issueDate: '2026-11-22',
      paymentStatus: 'completed',
    })
    expect(netOnly.netAmount).toBe(1000)
    expect(netOnly.vatAmount).toBe(200)
    expect(netOnly.grossAmount).toBe(1200)

    const csv = formatAccountingCsv([netOnly])
    expect(csv).toContain(`'=2+2`)
  })

  test('all 8 pre-accounting provider adapters map both income and expense canonical entries', () => {
    const incomeEntry = buildCanonicalAccountingEntry({
      clinicId: 'c1',
      tableId: 't_inc',
      rowId: 'r_inc',
      direction: 'income',
      title: 'Yazılım Danışmanlık Hizmeti',
      grossAmount: 2400,
      vatRate: 20,
      currency: 'TRY',
      issueDate: '2026-11-22',
      paymentStatus: 'completed',
      categoryCode: 'hizmet_geliri',
      categoryLabel: 'Hizmet / İşlem Geliri',
      documentType: 'efatura',
      documentNumber: 'GIB2026000000101',
      counterpartyName: 'Örnek B2B A.Ş.',
      counterpartyTaxId: makeValidVkn('456789123'),
    })
    const expenseEntry = buildCanonicalAccountingEntry({
      clinicId: 'c1',
      tableId: 't_exp',
      rowId: 'r_exp',
      direction: 'expense',
      title: 'Ofis Kirası',
      grossAmount: 15000,
      vatRate: 20,
      currency: 'TRY',
      issueDate: '2026-11-22',
      paymentStatus: 'pending',
      dueDate: '2026-11-30',
      categoryCode: 'kira_fatura',
      categoryLabel: 'Kira, Aidat & Faturalar',
      documentType: 'earsiv',
      counterpartyName: 'Gayrimenkul Yönetim Ltd.',
    })

    expect(SUPPORTED_PRE_ACCOUNTING_PROVIDERS.length).toBe(8)
    for (const adapter of SUPPORTED_PRE_ACCOUNTING_PROVIDERS) {
      const incPayload = adapter.mapEntryToProviderPayload(incomeEntry, { externalCompanyId: 'comp_1' })
      const expPayload = adapter.mapEntryToProviderPayload(expenseEntry, { externalCompanyId: 'comp_1' })
      expect(incPayload && typeof incPayload === 'object').toBe(true)
      expect(expPayload && typeof expPayload === 'object').toBe(true)
      expect(Object.keys(incPayload).length).toBeGreaterThan(0)
      expect(Object.keys(expPayload).length).toBeGreaterThan(0)
    }
  })
})

const hasDatabase = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDatabase)('Canonical Finance Lock & Pre-Accounting Backend Integration (PostgreSQL)', () => {
  let clinicId = ''
  let legacyClinicId = ''

  beforeAll(async () => {
    const [c1] = await db
      .insert(clinics)
      .values({ name: `Finance Lock Test ${crypto.randomUUID().slice(0, 8)}`, isActive: true })
      .returning({ id: clinics.id })
    const [c2] = await db
      .insert(clinics)
      .values({ name: `Legacy Finance Upgrade ${crypto.randomUUID().slice(0, 8)}`, isActive: true })
      .returning({ id: clinics.id })

    if (!c1?.id || !c2?.id) throw new Error('Test işletmeleri oluşturulamadı')
    clinicId = c1.id
    legacyClinicId = c2.id
  })

  afterAll(async () => {
    for (const cid of [clinicId, legacyClinicId]) {
      if (!cid) continue
      await db.delete(auditLog).where(eq(auditLog.clinicId, cid))
      await db.delete(clinics).where(eq(clinics.id, cid))
    }
  })

  test('ensureCanonicalFinanceTables is idempotent under concurrency and creates exactly 2 universal tables', async () => {
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      const [r1, r2, r3] = await Promise.all([
        ensureCanonicalFinanceTables(),
        ensureCanonicalFinanceTables(),
        ensureCanonicalFinanceTables(),
      ])

      expect(r1.incomeTable.table.id).toBe(r2.incomeTable.table.id)
      expect(r2.incomeTable.table.id).toBe(r3.incomeTable.table.id)
      expect(r1.expenseTable.table.id).toBe(r2.expenseTable.table.id)
      expect(r2.expenseTable.table.id).toBe(r3.expenseTable.table.id)

      expect(r1.incomeTable.table.name).toBe('Gelirler & Tahsilatlar')
      expect(r1.expenseTable.table.name).toBe('Giderler & Masraflar')

      const schema = await getStudioSchema()
      const financeConfigs = schema.moduleConfigs.filter(
        (m) => m.moduleRole === 'finance_income' || m.moduleRole === 'finance_expense'
      )
      expect(financeConfigs.length).toBe(2)
    })
  })

  test('blocks creating extra finance tables via starter packs, arbitrary module binding, deletion, detachment, or bulk clear', async () => {
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      const ensured = await ensureCanonicalFinanceTables()
      const incomeId = ensured.incomeTable.table.id
      const expenseId = ensured.expenseTable.table.id

      // All sector finance starter packs must reuse canonical tables, never create extra finance tables
      for (const pack of [
        'general_finance',
        'clinic_finance',
        'real_estate_finance',
        'insurance_finance',
      ] as const) {
        await applyModuleStarterPack(pack)
      }

      const afterPacks = await getStudioSchema()
      const financeMods = afterPacks.moduleConfigs.filter(
        (m) => m.moduleRole === 'finance_income' || m.moduleRole === 'finance_expense'
      )
      expect(financeMods.length).toBe(2)

      // Custom table cannot be bound to finance_income or finance_expense
      const customTable = await createDynamicTable({
        name: 'Özel Kasa Notları',
        initialColumns: [{ name: 'Başlık', fieldType: 'text', isPrimaryTitle: true, isRequired: true }],
      })

      await expect(
        upsertModuleConfig({ tableId: customTable.id, moduleRole: 'finance_income', enabled: true })
      ).rejects.toThrow()
      await expect(
        upsertModuleConfig({ tableId: customTable.id, moduleRole: 'finance_expense', enabled: true })
      ).rejects.toThrow()

      // Canonical finance table cannot be detached, disabled, re-roled, or deleted
      await expect(
        upsertModuleConfig({ tableId: incomeId, moduleRole: 'stock_inventory', enabled: true })
      ).rejects.toThrow()
      await expect(
        upsertModuleConfig({ tableId: incomeId, moduleRole: 'finance_income', enabled: false })
      ).rejects.toThrow()
      await expect(deleteModuleConfig(incomeId)).rejects.toThrow()
      await expect(deleteDynamicTable(incomeId)).rejects.toThrow()
      await expect(deleteDynamicTable(expenseId)).rejects.toThrow()
      await expect(updateDynamicTable(incomeId, { name: 'Sahte Gelir Tablosu' })).rejects.toThrow()
      const descUpdated = await updateDynamicTable(incomeId, {
        name: 'Gelirler & Tahsilatlar',
        description: 'Güncellenmiş açıklama',
      })
      expect(descUpdated.description).toBe('Güncellenmiş açıklama')

      // Bulk clear (selected / manual / all) deletes customTable but preserves canonical finance tables
      const clearRes = await clearDynamicTables({
        mode: 'selected',
        tableIds: [incomeId, expenseId, customTable.id],
      })
      expect(clearRes.deletedTableIds).toContain(customTable.id)
      expect(clearRes.deletedTableIds).not.toContain(incomeId)
      expect(clearRes.deletedTableIds).not.toContain(expenseId)

      const clearAllRes = await clearDynamicTables({ mode: 'all' })
      expect(clearAllRes.deletedTableIds).not.toContain(incomeId)
      expect(clearAllRes.deletedTableIds).not.toContain(expenseId)

      const remainingTables = await db
        .select({ id: dynamicTables.id })
        .from(dynamicTables)
        .where(eq(dynamicTables.clinicId, clinicId))
      const remainingIds = remainingTables.map((t) => t.id)
      expect(remainingIds).toContain(incomeId)
      expect(remainingIds).toContain(expenseId)
    })
  })

  test('protects core accounting columns from deletion/type mutation while allowing custom columns', async () => {
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      const ensured = await ensureCanonicalFinanceTables()
      const incomeId = ensured.incomeTable.table.id
      const amountColId = ensured.incomeTable.mapping.amountColumnId!
      const vatRateColId = ensured.incomeTable.mapping.vatRateColumnId!

      expect(amountColId).toBeTruthy()
      expect(vatRateColId).toBeTruthy()

      await expect(deleteDynamicColumn(amountColId)).rejects.toThrow()
      await expect(deleteDynamicColumn(vatRateColId)).rejects.toThrow()
      await expect(updateDynamicColumn(amountColId, { fieldType: 'text' })).rejects.toThrow()

      // Adding, updating, and deleting a business-specific custom column MUST work
      const customCol = await createDynamicColumn(incomeId, {
        name: 'Proje / Departman Kodu',
        fieldType: 'text',
      })
      expect(customCol.id).toBeTruthy()

      const updatedCustom = await updateDynamicColumn(customCol.id, {
        name: 'Masraf Merkezi Kodu',
        fieldType: 'text',
      })
      expect(updatedCustom?.name).toBe('Masraf Merkezi Kodu')

      const deletedCustom = await deleteDynamicColumn(customCol.id)
      expect(deletedCustom.success).toBe(true)
    })
  })

  test('end-to-end quick entry, VAT/FX KPIs, encrypted provider connection, export, sync-ack & dirtying on edit', async () => {
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      const validVkn = makeValidVkn('789123456')

      // 1. Completed TRY income with 20% KDV dahil
      const inc1 = await createQuickDynamicFinanceEntry({
        entryType: 'income',
        title: 'Yıllık B2B Destek Paketi',
        amount: 1200,
        vatRate: 20,
        vatIncluded: true,
        currency: 'TRY',
        date: '2026-11-22',
        status: 'completed',
        method: 'havale_eft',
        category: 'abonelik_paket',
        documentType: 'efatura',
        documentNumber: 'GIB2026000000042',
        counterpartyName: 'Anadolu Yazılım A.Ş.',
        counterpartyTaxId: validVkn,
      })

      // 2. Partial TRY income (should count in partialIncome & pendingIncome, NOT completedIncome)
      const inc2 = await createQuickDynamicFinanceEntry({
        entryType: 'income',
        title: 'Proje Kapora Ödemesi',
        amount: 500,
        vatRate: 0,
        currency: 'TRY',
        date: '2026-11-22',
        dueDate: '2026-12-01',
        status: 'partial',
        method: 'kredi_karti',
        category: 'on_odeme_kapora',
        counterpartyName: 'Marmara Ticaret Ltd.',
      })

      // 3. Pending USD expense with 10% KDV hariç (100 USD + 10 USD VAT = 110 USD * 38.5 = 4235 TRY)
      await createQuickDynamicFinanceEntry({
        entryType: 'expense',
        title: 'Bulut Sunucu Altyapısı',
        amount: 100,
        netAmount: 100,
        vatRate: 10,
        vatIncluded: false,
        currency: 'USD',
        exchangeRate: 38.5,
        date: '2026-11-22',
        dueDate: '2026-12-15',
        status: 'pending',
        method: 'kredi_karti',
        category: 'yazilim_abonelik',
        documentType: 'earsiv',
        counterpartyName: 'Cloud Inc.',
      })

      // 4. Cancelled expense (must be excluded from totalExpense)
      await createQuickDynamicFinanceEntry({
        entryType: 'expense',
        title: 'İptal Edilen Sipariş',
        amount: 9999,
        vatRate: 20,
        currency: 'TRY',
        date: '2026-11-22',
        status: 'cancelled',
        category: 'diger_gider',
      })

      // Verify KPIs and universal counterparty grouping
      const overview = await getDynamicFinanceOverview({ period: 'monthly' })
      expect(overview.isLockedSingleSchema).toBe(true)
      expect(overview.kpis.completedIncome).toBe(1200)
      expect(overview.kpis.partialIncome).toBe(500)
      expect(overview.kpis.pendingIncome).toBe(500)
      expect(overview.kpis.totalExpense).toBe(4235)
      expect(overview.kpis.pendingExpense).toBe(4235)
      expect(overview.kpis.totalVatCollected).toBe(200)
      expect(overview.kpis.totalVatPaid).toBe(385)
      expect(overview.kpis.netVatPayable).toBe(-185)
      expect(overview.kpis.netCashflow).toBe(1200 - 4235)
      expect(overview.personGroups.some((p) => p.personName === 'Anadolu Yazılım A.Ş.')).toBe(true)

      // Configure Paraşüt connection with secret credentials (must be encrypted & never leaked)
      const savedConn = await upsertPreAccountingConnection('parasut', {
        status: 'connected',
        syncMode: 'auto_push',
        externalCompanyId: '998877',
        credentials: {
          clientId: 'client-id-123',
          clientSecret: 'TOP_SECRET_PARASUT_KEY_999',
        },
        accountMapping: { hizmet_geliri: '600.02.01' },
      })
      expect(savedConn.hasCredentials).toBe(true)
      expect(JSON.stringify(savedConn)).not.toContain('TOP_SECRET_PARASUT_KEY_999')

      const providers = await listPreAccountingProviders()
      expect(providers.providers.length).toBe(8)
      const parasutInfo = providers.providers.find((p) => p.provider === 'parasut')
      expect(parasutInfo?.connection?.status).toBe('connected')
      expect(parasutInfo?.connection?.hasCredentials).toBe(true)
      expect(JSON.stringify(providers)).not.toContain('TOP_SECRET_PARASUT_KEY_999')

      const [dbConn] = await db
        .select()
        .from(financeAccountingConnections)
        .where(
          and(
            eq(financeAccountingConnections.clinicId, clinicId),
            eq(financeAccountingConnections.provider, 'parasut')
          )
        )
      expect(dbConn?.credentialsEncrypted).toBeTruthy()
      expect(dbConn?.credentialsEncrypted).not.toContain('TOP_SECRET_PARASUT_KEY_999')

      // Canonical entries + Paraşüt payload + CSV/JSON export
      const ledger = await listCanonicalAccountingEntries({
        provider: 'parasut',
        includeProviderPayload: true,
      })
      const incEntry = ledger.entries.find((e) => e.rowId === inc1.id)
      expect(incEntry).toBeTruthy()
      expect(incEntry?.netAmount).toBe(1000)
      expect(incEntry?.vatAmount).toBe(200)
      expect(incEntry?.grossAmount).toBe(1200)
      expect(incEntry?.counterparty.taxIdValid).toBe(true)
      expect(ledger.providerPayloads?.[inc1.id]).toBeTruthy()

      const csvExport = await exportCanonicalAccountingLedger({ format: 'csv' })
      expect(csvExport.format).toBe('csv')
      if (csvExport.format === 'csv') {
        expect(csvExport.body.startsWith('\uFEFF')).toBe(true)
        expect(csvExport.body).toContain('GIB2026000000042')
        expect(csvExport.body).toContain('Anadolu Yazılım A.Ş.')
      }

      const jsonExport = await exportCanonicalAccountingLedger({ format: 'json', provider: 'parasut' })
      expect(jsonExport.format).toBe('json')

      // Acknowledge sync -> marks sync record 'synced' and mirrors onto dynamic row
      const ack = await acknowledgePreAccountingSync({
        provider: 'parasut',
        rowId: inc1.id,
        syncStatus: 'synced',
        externalDocumentId: 'prs_doc_555',
        externalDocumentNumber: 'PRS2026000000555',
      })
      expect(ack.syncStatus).toBe('synced')
      expect(ack.externalDocumentId).toBe('prs_doc_555')

      const ensured = await ensureCanonicalFinanceTables()
      const syncColId = ensured.incomeTable.mapping.accountingSyncStatusColumnId!
      const docNoColId = ensured.incomeTable.mapping.documentNumberColumnId!
      const amountColId = ensured.incomeTable.mapping.amountColumnId!
      const netColId = ensured.incomeTable.mapping.netAmountColumnId!
      const vatColId = ensured.incomeTable.mapping.vatAmountColumnId!

      const rowsAfterAck = await listDynamicRows(inc1.tableId)
      const ackedRow = rowsAfterAck.find((r) => r.id === inc1.id)
      expect((ackedRow?.values as Record<string, unknown>)?.[syncColId]).toBe('aktarildi')
      // Preserves existing user-entered GİB invoice number while storing externalDocumentNumber on sync record
      expect((ackedRow?.values as Record<string, unknown>)?.[docNoColId]).toBe('GIB2026000000042')
      expect(ack.externalDocumentNumber).toBe('PRS2026000000555')

      // Backfills official document number onto row when it was initially blank (inc2)
      await acknowledgePreAccountingSync({
        provider: 'parasut',
        rowId: inc2.id,
        syncStatus: 'synced',
        externalDocumentId: 'prs_doc_777',
        externalDocumentNumber: 'PRS2026000000777',
      })
      const rowsAfterInc2Ack = await listDynamicRows(inc2.tableId)
      const ackedRow2 = rowsAfterInc2Ack.find((r) => r.id === inc2.id)
      expect((ackedRow2?.values as Record<string, unknown>)?.[docNoColId]).toBe('PRS2026000000777')

      // Editing the synced row's amount must recompute Net/KDV AND reset Paraşüt sync record back to 'pending'
      const updated = await updateDynamicRow(inc1.id, {
        values: {
          ...((ackedRow?.values ?? {}) as Record<string, unknown>),
          [amountColId]: 2400,
        },
      })
      const updatedVals = (updated?.values ?? {}) as Record<string, unknown>
      expect(updatedVals[netColId]).toBe(2000)
      expect(updatedVals[vatColId]).toBe(400)

      const [syncRecAfterEdit] = await db
        .select()
        .from(financeAccountingSyncRecords)
        .where(
          and(
            eq(financeAccountingSyncRecords.clinicId, clinicId),
            eq(financeAccountingSyncRecords.rowId, inc1.id),
            eq(financeAccountingSyncRecords.provider, 'parasut')
          )
        )
      expect(syncRecAfterEdit?.syncStatus).toBe('pending')

      // Re-acknowledge using idempotencyKey instead of rowId
      const reAck = await acknowledgePreAccountingSync({
        provider: 'parasut',
        idempotencyKey: `${clinicId}:${inc1.id}`,
        syncStatus: 'synced',
        externalDocumentId: 'prs_doc_555_v2',
      })
      expect(reAck.syncStatus).toBe('synced')
      expect(reAck.externalDocumentId).toBe('prs_doc_555_v2')
    })
  })

  test('non-destructively upgrades a legacy finance table with missing pre-accounting columns without losing existing rows', async () => {
    await runWithTenantContext(
      { clinicId: legacyClinicId, hostname: 'localhost', isActive: true },
      async () => {
        // Simulate an older tenant that already has a minimal income table with 1 row
        const legacyIncome = await createDynamicTable({
          name: 'Hasta Tahsilatları',
          icon: 'credit-card',
          color: '#15803d',
          origin: 'template',
          initialColumns: [
            { name: 'Açıklama', fieldType: 'text', isPrimaryTitle: true, isRequired: true },
            { name: 'Tutar (₺)', fieldType: 'currency', isRequired: true },
            { name: 'Tarih', fieldType: 'date' },
            {
              name: 'Durum',
              fieldType: 'select',
              config: {
                options: [
                  { id: 'tamamlandi', label: 'Ödendi', color: '#15803d' },
                  { id: 'bekliyor', label: 'Bekliyor', color: '#d97706' },
                ],
              },
            },
          ],
        })
        await upsertModuleConfig({
          tableId: legacyIncome.id,
          moduleRole: 'finance_income',
          enabled: true,
          mapping: {
            amountColumnId: legacyIncome.columns[1]!.id,
            dateColumnId: legacyIncome.columns[2]!.id,
            statusColumnId: legacyIncome.columns[3]!.id,
          },
          allowSystemFinanceBinding: true,
        })
        await createDynamicRow(legacyIncome.id, {
          values: {
            [legacyIncome.columns[0]!.id]: 'Eski Kayıt #1',
            [legacyIncome.columns[1]!.id]: 2500,
            [legacyIncome.columns[2]!.id]: '2026-10-15',
            [legacyIncome.columns[3]!.id]: 'tamamlandi',
          },
        })

        // Upgrade via ensureCanonicalFinanceTables
        const ensured = await ensureCanonicalFinanceTables()
        expect(ensured.incomeTable.table.id).toBe(legacyIncome.id)
        expect(ensured.upgradedColumnsCount).toBeGreaterThan(0)
        expect(ensured.incomeTable.mapping.vatRateColumnId).toBeTruthy()
        expect(ensured.incomeTable.mapping.documentTypeColumnId).toBeTruthy()
        expect(ensured.incomeTable.mapping.counterpartyTaxIdColumnId).toBeTruthy()
        expect(ensured.incomeTable.mapping.accountingCodeColumnId).toBeTruthy()
        expect(ensured.expenseTable.table.name).toBe('Giderler & Masraflar')

        // Existing row is completely intact and reflected in overview
        const rows = await listDynamicRows(legacyIncome.id)
        expect(rows.length).toBe(1)
        expect(rows[0]?.displayTitle).toBe('Eski Kayıt #1')

        const overview = await getDynamicFinanceOverview({ period: 'monthly' })
        expect(overview.moduleTables.length).toBe(2)
        expect(overview.kpis.completedIncome).toBe(2500)
      }
    )
  })

  test('never hijacks custom user tables named Kasa/Masraf before finance provisioning, and safely upgrades legacy duplicate finance tables', async () => {
    const [freshClinic] = await db
      .insert(clinics)
      .values({ name: `No Hijack Test ${crypto.randomUUID().slice(0, 8)}`, isActive: true })
      .returning({ id: clinics.id })
    const [dupLegacyClinic] = await db
      .insert(clinics)
      .values({ name: `Legacy Dup Test ${crypto.randomUUID().slice(0, 8)}`, isActive: true })
      .returning({ id: clinics.id })

    try {
      await runWithTenantContext({ clinicId: freshClinic!.id, hostname: 'localhost', isActive: true }, async () => {
        const customKasa = await createDynamicTable({
          name: 'Kasa Notları',
          initialColumns: [{ name: 'Not', fieldType: 'text', isPrimaryTitle: true, isRequired: true }],
        })
        const customMasraf = await createDynamicTable({
          name: 'Araç Masraf Takibi',
          initialColumns: [{ name: 'Plaka', fieldType: 'text', isPrimaryTitle: true, isRequired: true }],
        })

        const ensured = await ensureCanonicalFinanceTables()
        expect(ensured.incomeTable.table.id).not.toBe(customKasa.id)
        expect(ensured.expenseTable.table.id).not.toBe(customMasraf.id)
        expect(ensured.incomeTable.table.name).toBe('Gelirler & Tahsilatlar')
        expect(ensured.expenseTable.table.name).toBe('Giderler & Masraflar')

        // User's custom tables remain freely deletable
        await expect(deleteDynamicTable(customKasa.id)).resolves.toMatchObject({ success: true })
        await expect(deleteDynamicTable(customMasraf.id)).resolves.toMatchObject({ success: true })
      })

      // Legacy DB containing 2 pre-existing finance_income tables must upgrade without crashing
      await runWithTenantContext({ clinicId: dupLegacyClinic!.id, hostname: 'localhost', isActive: true }, async () => {
        const legA = await createDynamicTable({
          name: 'Eski Gelir A',
          initialColumns: [
            { name: 'Başlık', fieldType: 'text', isPrimaryTitle: true, isRequired: true },
            { name: 'Tutar', fieldType: 'currency' },
          ],
        })
        const legB = await createDynamicTable({
          name: 'Eski Gelir B',
          initialColumns: [
            { name: 'Başlık', fieldType: 'text', isPrimaryTitle: true, isRequired: true },
            { name: 'Tutar', fieldType: 'currency' },
          ],
        })
        await db.insert(dynamicModuleConfigs).values([
          { clinicId: dupLegacyClinic!.id, tableId: legA.id, moduleRole: 'finance_income', enabled: true, mapping: {} },
          { clinicId: dupLegacyClinic!.id, tableId: legB.id, moduleRole: 'finance_income', enabled: true, mapping: {} },
        ])
        const ensured = await ensureCanonicalFinanceTables()
        expect(ensured.incomeTable.table.id).toBe(legA.id)
        expect(ensured.incomeTable.mapping.vatRateColumnId).toBeTruthy()
        expect(ensured.expenseTable.table.name).toBe('Giderler & Masraflar')
      })
    } finally {
      if (freshClinic?.id) {
        await db.delete(auditLog).where(eq(auditLog.clinicId, freshClinic.id))
        await db.delete(clinics).where(eq(clinics.id, freshClinic.id))
      }
      if (dupLegacyClinic?.id) {
        await db.delete(auditLog).where(eq(auditLog.clinicId, dupLegacyClinic.id))
        await db.delete(clinics).where(eq(clinics.id, dupLegacyClinic.id))
      }
    }
  })

  test('blocks core column unmap bypass, primary-title steal bypass, empty select options, synced-row hard delete, and AI extra finance tables', async () => {
    const [guardClinic] = await db
      .insert(clinics)
      .values({ name: `Guard Bypass Test ${crypto.randomUUID().slice(0, 8)}`, isActive: true })
      .returning({ id: clinics.id })

    try {
      await runWithTenantContext({ clinicId: guardClinic!.id, hostname: 'localhost', isActive: true }, async () => {
        const ensured = await ensureCanonicalFinanceTables()
        const incId = ensured.incomeTable.table.id
        const expId = ensured.expenseTable.table.id
        const amountColId = ensured.incomeTable.mapping.amountColumnId!
        const netColId = ensured.incomeTable.mapping.netAmountColumnId!
        const vatColId = ensured.incomeTable.mapping.vatAmountColumnId!
        const statusColId = ensured.incomeTable.mapping.statusColumnId!
        const syncColId = ensured.incomeTable.mapping.accountingSyncStatusColumnId!
        const docNoColId = ensured.incomeTable.mapping.documentNumberColumnId!

        // 1. Unmapping core finance column via upsertModuleConfig MUST fail
        await expect(
          upsertModuleConfig({
            tableId: incId,
            moduleRole: 'finance_income',
            enabled: true,
            mapping: { amountColumnId: null },
          })
        ).rejects.toThrow()
        await expect(deleteDynamicColumn(amountColId)).rejects.toThrow()

        // 2. Stealing isPrimaryTitle via a custom column MUST fail
        const customCol = await createDynamicColumn(incId, { name: 'Özel Referans', fieldType: 'text' })
        await expect(updateDynamicColumn(customCol.id, { isPrimaryTitle: true })).rejects.toThrow()

        // 3. Wiping select options on a core finance column MUST fail
        await expect(updateDynamicColumn(statusColId, { config: { options: [] } })).rejects.toThrow()

        // 4. Quick entry validation: 0 amount and foreign currency without exchangeRate MUST fail
        await expect(
          createQuickDynamicFinanceEntry({ entryType: 'income', title: 'Sıfır', amount: 0 })
        ).rejects.toThrow()
        await expect(
          createQuickDynamicFinanceEntry({ entryType: 'income', title: 'Kursuz USD', amount: 100, currency: 'USD' })
        ).rejects.toThrow()

        // 5. Full-row RowDetailDrawer payload editing ONLY netAmount (with unchanged gross) must compute new gross/VAT, NOT revert netAmount
        const row = await createQuickDynamicFinanceEntry({
          entryType: 'income',
          title: 'Matrah Düzenleme Testi',
          amount: 1200,
          vatRate: 20,
          vatIncluded: true,
          status: 'completed',
        })
        const updatedNet = await updateDynamicRow(row.id, {
          values: {
            ...((row.values ?? {}) as Record<string, unknown>),
            [netColId]: 2000,
          },
        })
        expect((updatedNet?.values as Record<string, unknown>)?.[netColId]).toBe(2000)
        expect((updatedNet?.values as Record<string, unknown>)?.[vatColId]).toBe(400)
        expect((updatedNet?.values as Record<string, unknown>)?.[amountColId]).toBe(2400)

        // 6. Full-row payload editing ONLY expense quantity (1 -> 5, unitCost=100) must recalculate amount=500
        const expRow = await createQuickDynamicFinanceEntry({
          entryType: 'expense',
          title: 'Adet Güncelleme Testi',
          amount: 100,
          quantity: 1,
          unitCost: 100,
          vatRate: 0,
          status: 'pending',
        })
        const qtyColId = ensured.expenseTable.mapping.quantityColumnId!
        const expAmountColId = ensured.expenseTable.mapping.amountColumnId!
        const updatedExp = await updateDynamicRow(expRow.id, {
          values: {
            ...((expRow.values ?? {}) as Record<string, unknown>),
            [qtyColId]: 5,
          },
        })
        expect((updatedExp?.values as Record<string, unknown>)?.[expAmountColId]).toBe(500)

        // 7. Overview status filter applies to expenses too
        const completedOnly = await getDynamicFinanceOverview({ status: 'completed' })
        expect(completedOnly.recentIncomes.some((i) => i.rowId === row.id)).toBe(true)
        expect(completedOnly.recentExpenses.some((e) => e.rowId === expRow.id)).toBe(false)

        // 8. Sync-ack without active connection + doc number backfill + no false dirtying + real edit mirrors 'bekliyor' + blocks hard delete
        await acknowledgePreAccountingSync({
          provider: 'parasut',
          rowId: row.id,
          syncStatus: 'synced',
          externalDocumentId: 'prs_ext_901',
          externalDocumentNumber: 'PRS2026000000901',
        })
        // Even with NO finance_accounting_connections row, ledger & overview must see 'synced'
        const ledgerDisconnected = await listCanonicalAccountingEntries()
        const entryDisconnected = ledgerDisconnected.entries.find((e) => e.rowId === row.id)
        expect(entryDisconnected?.sync.status).toBe('synced')
        expect(entryDisconnected?.sync.externalDocumentId).toBe('prs_ext_901')
        expect(entryDisconnected?.documentNumber).toBe('PRS2026000000901')

        const ovAfterAck = await getDynamicFinanceOverview()
        expect(ovAfterAck.accountingSummary.syncedCount).toBe(1)

        // Saving unchanged row after documentNumber backfill MUST NOT falsely dirty 'synced'
        const latestRows = await listDynamicRows(incId)
        const latestRow = latestRows.find((r) => r.id === row.id)!
        expect((latestRow.values as Record<string, unknown>)[docNoColId]).toBe('PRS2026000000901')
        await updateDynamicRow(row.id, {
          values: { ...((latestRow.values ?? {}) as Record<string, unknown>) },
        })
        const ledgerAfterNoop = await listCanonicalAccountingEntries({ provider: 'parasut' })
        expect(ledgerAfterNoop.entries.find((e) => e.rowId === row.id)?.sync.status).toBe('synced')

        // Hard deleting an externally synced finance row MUST be blocked
        await expect(deleteDynamicRows([row.id])).rejects.toThrow()
        // Unsynced expense row CAN be deleted
        const delDraft = await deleteDynamicRows([expRow.id])
        expect(delDraft.deletedCount).toBe(1)

        // Real monetary edit on synced row MUST mirror 'bekliyor' back into dynamic_rows column too!
        const editedSynced = await updateDynamicRow(row.id, {
          values: { [amountColId]: 3600 },
        })
        expect((editedSynced?.values as Record<string, unknown>)?.[syncColId]).toBe('bekliyor')

        // 9. Bulk import handles Turkish currency ("1.250,50 ₺"), Excel serial date (46348), and relation counterparty
        const customersTbl = await createDynamicTable({
          name: 'Müşteriler',
          initialColumns: [{ name: 'Ad Soyad', fieldType: 'text', isPrimaryTitle: true, isRequired: true }],
        })
        const custRow = await createDynamicRow(customersTbl.id, {
          values: { [customersTbl.columns[0]!.id]: 'Excel Cari Ltd.' },
        })
        const bulkRes = await bulkImportDynamicRows(expId, [
          {
            values: {
              [ensured.expenseTable.table.columns[0]!.id]: 'Excel Toplu Fatura',
              [ensured.expenseTable.mapping.amountColumnId!]: '1.250,50 ₺',
              [ensured.expenseTable.mapping.vatRateColumnId!]: '20',
              [ensured.expenseTable.mapping.dateColumnId!]: 46348,
              [ensured.expenseTable.mapping.counterpartyNameColumnId!]: custRow.displayTitle,
            },
          },
        ])
        expect(bulkRes.importedCount).toBe(1)
        expect(bulkRes.skippedCount).toBe(0)
        const expRowsAfterBulk = await listDynamicRows(expId)
        const importedExp = expRowsAfterBulk.find((r) => r.displayTitle === 'Excel Toplu Fatura')
        expect(importedExp).toBeTruthy()
        expect((importedExp?.values as Record<string, unknown>)?.[ensured.expenseTable.mapping.amountColumnId!]).toBe(1250.5)
        expect((importedExp?.values as Record<string, unknown>)?.[ensured.expenseTable.mapping.dateColumnId!]).toMatch(/^\d{4}-\d{2}-\d{2}$/)

        // 10. AI Scenario Builder plan attempting to create finance tables with moduleRole='none' MUST reuse canonical tables
        const aiRes = await applyAiScenarioPlan({
          summary: 'AI test',
          tables: [
            {
              name: 'Tahsilatlar',
              appointmentRole: 'none',
              moduleRole: 'none',
              columns: [{ name: 'Başlık', fieldType: 'text', isPrimaryTitle: true }],
            },
            {
              name: 'İşletme Giderleri',
              appointmentRole: 'none',
              moduleRole: 'none',
              columns: [{ name: 'Başlık', fieldType: 'text', isPrimaryTitle: true }],
            },
            {
              name: 'Projeler',
              appointmentRole: 'none',
              moduleRole: 'none',
              columns: [{ name: 'Proje Adı', fieldType: 'text', isPrimaryTitle: true }],
            },
          ],
          relations: [],
        })
        expect(aiRes.createdTableCount).toBe(1)
        const afterAiNames = aiRes.schema.tables.map((t) => t.name)
        expect(afterAiNames).toContain('Projeler')
        expect(afterAiNames).not.toContain('Tahsilatlar')
        expect(afterAiNames).not.toContain('İşletme Giderleri')
        expect(
          aiRes.schema.moduleConfigs.filter(
            (m) => m.moduleRole === 'finance_income' || m.moduleRole === 'finance_expense'
          ).length
        ).toBe(2)
      })
    } finally {
      if (guardClinic?.id) {
        await db.delete(conversationFlows).where(eq(conversationFlows.clinicId, guardClinic.id))
        await db.delete(auditLog).where(eq(auditLog.clinicId, guardClinic.id))
        await db.delete(clinics).where(eq(clinics.id, guardClinic.id))
      }
    }
  })

  test('Elysia HTTP routes enforce 401/403 auth, finance locks, CSV download headers, and cross-tenant isolation', async () => {
    const [clinicA] = await db
      .insert(clinics)
      .values({ name: `HTTP Route Clinic A ${crypto.randomUUID().slice(0, 8)}`, isActive: true })
      .returning({ id: clinics.id })
    const [clinicB] = await db
      .insert(clinics)
      .values({ name: `HTTP Route Clinic B ${crypto.randomUUID().slice(0, 8)}`, isActive: true })
      .returning({ id: clinics.id })

    const createdUserIds: string[] = []
    try {
      const adminA = await createUser({
        email: `admin-a-${crypto.randomUUID().slice(0, 8)}@test.local`,
        passwordHash: 'test-hash',
        name: 'Admin A',
        role: 'yonetici',
        clinicId: clinicA!.id,
      })
      const staffA = await createUser({
        email: `staff-a-${crypto.randomUUID().slice(0, 8)}@test.local`,
        passwordHash: 'test-hash',
        name: 'Sekreter A',
        role: 'sekreter',
        clinicId: clinicA!.id,
      })
      const adminB = await createUser({
        email: `admin-b-${crypto.randomUUID().slice(0, 8)}@test.local`,
        passwordHash: 'test-hash',
        name: 'Admin B',
        role: 'yonetici',
        clinicId: clinicB!.id,
      })
      createdUserIds.push(adminA.id, staffA.id, adminB.id)

      const makeCookie = async (u: { id: string; role: string }, cid: string) => {
        const jti = crypto.randomUUID()
        await createSession({
          userId: u.id,
          tokenJti: jti,
          expiresAt: new Date(Date.now() + 3600_000),
        })
        const token = await signToken({ id: u.id, role: u.role, clinicId: cid }, jti)
        return `token=${token}`
      }

      const adminACookie = await makeCookie(adminA, clinicA!.id)
      const staffACookie = await makeCookie(staffA, clinicA!.id)
      const adminBCookie = await makeCookie(adminB, clinicB!.id)

      const app = new Elysia().use(dynamicTablesPlugin)
      const req = (cid: string, path: string, init?: RequestInit) =>
        runWithTenantContext({ clinicId: cid, hostname: 'localhost', isActive: true }, () =>
          app.handle(new Request(`http://localhost${path}`, init))
        )

      // 1. Unauthenticated -> 401 across read and write endpoints (including column resize)
      expect((await req(clinicA!.id, '/api/dynamic-tables/finance/overview?ensure=1')).status).toBe(401)
      expect(
        (
          await req(clinicA!.id, '/api/dynamic-tables/finance/accounting/connections/parasut', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'configured' }),
          })
        ).status
      ).toBe(401)
      expect(
        (
          await req(clinicA!.id, '/api/dynamic-tables/columns/00000000-0000-0000-0000-000000000000', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ width: 180 }),
          })
        ).status
      ).toBe(401)

      // 2. Non-admin staff: allowed to view overview, add quick entry, export CSV; forbidden (403) on schema/accounting-connection/sync-ack
      const staffOvRes = await req(clinicA!.id, '/api/dynamic-tables/finance/overview?period=monthly&ensure=1', {
        headers: { Cookie: staffACookie },
      })
      expect(staffOvRes.status).toBe(200)
      const staffOv = (await staffOvRes.json()) as any
      expect(staffOv.hasFinanceTables).toBe(true)
      const incomeTableId = staffOv.incomeTableIds[0] as string
      expect(incomeTableId).toBeTruthy()

      const quickRes = await req(clinicA!.id, '/api/dynamic-tables/finance/quick-entry', {
        method: 'POST',
        headers: { Cookie: staffACookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryType: 'income',
          title: 'HTTP Route Faturası',
          amount: 1200,
          vatRate: 20,
          vatIncluded: true,
          documentType: 'efatura',
          documentNumber: 'GIB2026000000888',
          counterpartyName: 'HTTP Cari A.Ş.',
        }),
      })
      expect(quickRes.status).toBe(200)
      const createdRow = (await quickRes.json()) as any

      // Non-admin staff forbidden on admin-only routes -> 403
      expect(
        (
          await req(clinicA!.id, '/api/dynamic-tables/finance/accounting/connections/parasut', {
            method: 'PUT',
            headers: { Cookie: staffACookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'configured' }),
          })
        ).status
      ).toBe(403)
      expect(
        (
          await req(clinicA!.id, '/api/dynamic-tables/finance/accounting/sync-ack', {
            method: 'POST',
            headers: { Cookie: staffACookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'parasut', rowId: createdRow.id, syncStatus: 'synced' }),
          })
        ).status
      ).toBe(403)
      expect(
        (
          await req(clinicA!.id, `/api/dynamic-tables/tables/${incomeTableId}`, {
            method: 'DELETE',
            headers: { Cookie: staffACookie },
          })
        ).status
      ).toBe(403)

      // 3. CSV export route returns UTF-8 BOM bytes (EF BB BF) + Content-Disposition attachment header + row content
      const csvRes = await req(clinicA!.id, '/api/dynamic-tables/finance/accounting/export?format=csv', {
        headers: { Cookie: staffACookie },
      })
      expect(csvRes.status).toBe(200)
      expect(csvRes.headers.get('content-type')).toContain('text/csv')
      expect(csvRes.headers.get('content-disposition')).toMatch(/attachment; filename="on_muhasebe_aktarim_.*\.csv"/)
      const csvBytes = new Uint8Array(await csvRes.arrayBuffer())
      expect(csvBytes[0]).toBe(0xef)
      expect(csvBytes[1]).toBe(0xbb)
      expect(csvBytes[2]).toBe(0xbf)
      const csvBody = new TextDecoder('utf-8').decode(csvBytes)
      expect(csvBody).toContain('GIB2026000000888')
      expect(csvBody).toContain('HTTP Cari A.Ş.')

      // 4. Admin A blocked (400) from deleting, renaming, or unmapping canonical finance table, even if passing allowSystemFinanceBinding in HTTP body!
      expect(
        (
          await req(clinicA!.id, `/api/dynamic-tables/tables/${incomeTableId}`, {
            method: 'DELETE',
            headers: { Cookie: adminACookie },
          })
        ).status
      ).toBe(400)
      expect(
        (
          await req(clinicA!.id, `/api/dynamic-tables/tables/${incomeTableId}`, {
            method: 'PUT',
            headers: { Cookie: adminACookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Yeniden Adlandırma Denemesi' }),
          })
        ).status
      ).toBe(400)
      const customTblRes = await req(clinicA!.id, '/api/dynamic-tables/tables', {
        method: 'POST',
        headers: { Cookie: adminACookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ekstra Liste' }),
      })
      const customTbl = (await customTblRes.json()) as any
      expect(
        (
          await req(clinicA!.id, `/api/dynamic-tables/module-configs/${customTbl.id}`, {
            method: 'PUT',
            headers: { Cookie: adminACookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              moduleRole: 'finance_income',
              enabled: true,
              allowSystemFinanceBinding: true,
            }),
          })
        ).status
      ).toBe(400)
      expect(
        (
          await req(clinicA!.id, `/api/dynamic-tables/module-configs/${incomeTableId}`, {
            method: 'PUT',
            headers: { Cookie: adminACookie, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              moduleRole: 'finance_income',
              enabled: true,
              mapping: { amountColumnId: null },
            }),
          })
        ).status
      ).toBe(400)

      // 5. Admin A can configure Paraşüt + acknowledge sync via HTTP
      const connRes = await req(clinicA!.id, '/api/dynamic-tables/finance/accounting/connections/parasut', {
        method: 'PUT',
        headers: { Cookie: adminACookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'connected',
          syncMode: 'auto_push',
          credentials: { clientSecret: 'HTTP_SECRET_XYZ' },
        }),
      })
      expect(connRes.status).toBe(200)
      const connJson = await connRes.json()
      expect(JSON.stringify(connJson)).not.toContain('HTTP_SECRET_XYZ')

      const ackRes = await req(clinicA!.id, '/api/dynamic-tables/finance/accounting/sync-ack', {
        method: 'POST',
        headers: { Cookie: adminACookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'parasut',
          rowId: createdRow.id,
          syncStatus: 'synced',
          externalDocumentId: 'prs_http_1',
        }),
      })
      expect(ackRes.status).toBe(200)

      // 6. Cross-tenant isolation: Admin B cannot see Clinic A's rows or ack Clinic A's rowId
      const bEntriesRes = await req(clinicB!.id, '/api/dynamic-tables/finance/accounting/entries', {
        headers: { Cookie: adminBCookie },
      })
      expect(bEntriesRes.status).toBe(200)
      const bEntries = (await bEntriesRes.json()) as any
      expect(bEntries.entries.some((e: any) => e.rowId === createdRow.id)).toBe(false)

      const bCrossAck = await req(clinicB!.id, '/api/dynamic-tables/finance/accounting/sync-ack', {
        method: 'POST',
        headers: { Cookie: adminBCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'parasut',
          rowId: createdRow.id,
          syncStatus: 'synced',
        }),
      })
      expect(bCrossAck.status).toBe(400)
    } finally {
      for (const uid of createdUserIds) {
        await db.delete(users).where(eq(users.id, uid))
      }
      for (const cid of [clinicA?.id, clinicB?.id]) {
        if (!cid) continue
        await db.delete(auditLog).where(eq(auditLog.clinicId, cid))
        await db.delete(clinics).where(eq(clinics.id, cid))
      }
    }
  })
})
