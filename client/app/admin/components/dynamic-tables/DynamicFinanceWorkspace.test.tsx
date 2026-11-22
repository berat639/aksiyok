// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import BulkClearTablesModal from './BulkClearTablesModal'
import DynamicFinanceWorkspace from './DynamicFinanceWorkspace'
import DynamicTablesWorkspace from './DynamicTablesWorkspace'
import TablePropertiesPanel from './TablePropertiesPanel'
import type {
  DynamicModuleConfigDef,
  DynamicTableDef,
  StudioSchemaResponse,
} from './types'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('react-hot-toast', () => {
  const fn = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  })
  return { toast: fn }
})

// Recharts ResponsiveContainer needs a ResizeObserver stub in happy-dom
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as any).ResizeObserver = ResizeObserverStub

const INCOME_TABLE: DynamicTableDef = {
  id: 'tbl_fin_inc',
  clinicId: 'c1',
  name: 'Gelirler & Tahsilatlar',
  slug: 'gelirler_tahsilatlar',
  icon: 'credit-card',
  color: '#15803d',
  description: 'Standart gelir ve tahsilat tablosu',
  origin: 'system',
  canvasX: 100,
  canvasY: 60,
  sortOrder: 0,
  rowCount: 1,
  archivedRowCount: 0,
  columns: [
    {
      id: 'col_inc_title',
      clinicId: 'c1',
      tableId: 'tbl_fin_inc',
      name: 'Açıklama / Başlık',
      slug: 'aciklama_baslik',
      fieldType: 'text',
      isPrimaryTitle: true,
      isRequired: true,
      isUnique: false,
      showInTable: true,
      width: 240,
      sortOrder: 0,
      config: {},
    },
    {
      id: 'col_inc_gross',
      clinicId: 'c1',
      tableId: 'tbl_fin_inc',
      name: 'Genel Toplam',
      slug: 'genel_toplam',
      fieldType: 'currency',
      isPrimaryTitle: false,
      isRequired: true,
      isUnique: false,
      showInTable: true,
      width: 150,
      sortOrder: 1,
      config: { currencySymbol: '₺' },
    },
    {
      id: 'col_inc_vat',
      clinicId: 'c1',
      tableId: 'tbl_fin_inc',
      name: 'KDV Oranı',
      slug: 'kdv_orani',
      fieldType: 'select',
      isPrimaryTitle: false,
      isRequired: false,
      isUnique: false,
      showInTable: true,
      width: 120,
      sortOrder: 2,
      config: {
        options: [
          { id: '0', label: '%0' },
          { id: '20', label: '%20' },
        ],
      },
    },
    {
      id: 'col_inc_custom',
      clinicId: 'c1',
      tableId: 'tbl_fin_inc',
      name: 'Proje Kodu',
      slug: 'proje_kodu',
      fieldType: 'text',
      isPrimaryTitle: false,
      isRequired: false,
      isUnique: false,
      showInTable: true,
      width: 140,
      sortOrder: 3,
      config: {},
    },
  ],
}

const EXPENSE_TABLE: DynamicTableDef = {
  id: 'tbl_fin_exp',
  clinicId: 'c1',
  name: 'Giderler & Masraflar',
  slug: 'giderler_masraflar',
  icon: 'trending-down',
  color: '#2563eb',
  description: 'Standart gider ve masraf tablosu',
  origin: 'system',
  canvasX: 520,
  canvasY: 60,
  sortOrder: 1,
  rowCount: 0,
  archivedRowCount: 0,
  columns: [
    {
      id: 'col_exp_title',
      clinicId: 'c1',
      tableId: 'tbl_fin_exp',
      name: 'Gider Kalemi / Açıklama',
      slug: 'gider_kalemi',
      fieldType: 'text',
      isPrimaryTitle: true,
      isRequired: true,
      isUnique: false,
      showInTable: true,
      width: 240,
      sortOrder: 0,
      config: {},
    },
    {
      id: 'col_exp_gross',
      clinicId: 'c1',
      tableId: 'tbl_fin_exp',
      name: 'Genel Toplam',
      slug: 'genel_toplam',
      fieldType: 'currency',
      isPrimaryTitle: false,
      isRequired: true,
      isUnique: false,
      showInTable: true,
      width: 150,
      sortOrder: 1,
      config: { currencySymbol: '₺' },
    },
  ],
}

const CUSTOMERS_TABLE: DynamicTableDef = {
  id: 'tbl_cust',
  clinicId: 'c1',
  name: 'Müşteriler',
  slug: 'musteriler',
  icon: 'users',
  color: '#0284c7',
  description: null,
  origin: 'manual',
  canvasX: 900,
  canvasY: 60,
  sortOrder: 2,
  rowCount: 2,
  archivedRowCount: 0,
  columns: [
    {
      id: 'col_cust_name',
      clinicId: 'c1',
      tableId: 'tbl_cust',
      name: 'Ad Soyad',
      slug: 'ad_soyad',
      fieldType: 'text',
      isPrimaryTitle: true,
      isRequired: true,
      isUnique: false,
      showInTable: true,
      width: 200,
      sortOrder: 0,
      config: {},
    },
  ],
}

const FINANCE_MODULE_CONFIGS: DynamicModuleConfigDef[] = [
  {
    id: 'mc_inc',
    clinicId: 'c1',
    tableId: 'tbl_fin_inc',
    moduleRole: 'finance_income',
    enabled: true,
    mapping: {
      amountColumnId: 'col_inc_gross',
      vatRateColumnId: 'col_inc_vat',
    },
  },
  {
    id: 'mc_exp',
    clinicId: 'c1',
    tableId: 'tbl_fin_exp',
    moduleRole: 'finance_expense',
    enabled: true,
    mapping: {
      amountColumnId: 'col_exp_gross',
    },
  },
]

const SAMPLE_SCHEMA: StudioSchemaResponse = {
  tabLabel: 'Veri Tabloları',
  tables: [INCOME_TABLE, EXPENSE_TABLE, CUSTOMERS_TABLE],
  relations: [],
  appointmentConfigs: [],
  moduleConfigs: FINANCE_MODULE_CONFIGS,
  appointmentNodePosition: { x: 40, y: 40 },
  canManageSchema: true,
}

function makeOverviewResponse(overrides?: Record<string, unknown>) {
  return {
    hasFinanceTables: true,
    isLockedSingleSchema: true,
    tablesAutoProvisioned: false,
    incomeTableIds: ['tbl_fin_inc'],
    expenseTableIds: ['tbl_fin_exp'],
    moduleTables: [
      {
        tableId: 'tbl_fin_inc',
        tableName: 'Gelirler & Tahsilatlar',
        moduleRole: 'finance_income',
        mapping: FINANCE_MODULE_CONFIGS[0]!.mapping,
        isAutoDetected: false,
      },
      {
        tableId: 'tbl_fin_exp',
        tableName: 'Giderler & Masraflar',
        moduleRole: 'finance_expense',
        mapping: FINANCE_MODULE_CONFIGS[1]!.mapping,
        isAutoDetected: false,
      },
    ],
    kpis: {
      totalIncome: 1200,
      completedIncome: 1200,
      completedCount: 1,
      pendingIncome: 0,
      pendingCount: 0,
      partialIncome: 0,
      partialCount: 0,
      cancelledIncome: 0,
      totalExpense: 400,
      expenseCount: 1,
      pendingExpense: 0,
      pendingExpenseCount: 0,
      netCashflow: 800,
      monthIncome: 1200,
      monthExpense: 400,
      monthNetCashflow: 800,
      totalNetIncome: 1000,
      totalVatCollected: 200,
      totalNetExpense: 400,
      totalVatPaid: 0,
      netVatPayable: 200,
      activeMonth: '2026-11',
    },
    accountingSummary: {
      totalCount: 2,
      readyCount: 2,
      pendingCount: 0,
      syncedCount: 0,
      failedCount: 0,
      ignoredCount: 0,
      connectedProvider: null,
    },
    period: 'monthly',
    chartData: [{ date: '2026-11', label: "Kas '26", gelir: 1200, gider: 400, net: 800 }],
    personGroups: [
      {
        key: 'cp:ornek',
        personRowId: null,
        personName: 'Örnek Ticaret A.Ş.',
        paidTotal: 1200,
        pendingTotal: 0,
        paidCount: 1,
        pendingCount: 0,
        totalCount: 1,
        lastDate: '2026-11-22',
      },
    ],
    expenseCategories: [],
    quickEntryRelations: { personTable: null, serviceTable: null },
    legacyMigration: {
      hasUnmigratedLegacyFinance: false,
      unmigratedPayments: 0,
      unmigratedExpenses: 0,
    },
    ...(overrides ?? {}),
  }
}

const flushAsync = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function setInputValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('DynamicFinanceWorkspace & Canonical Finance UI Locks', () => {
  let container: HTMLDivElement
  let root: Root
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('removes Dinamik Finans Tabloları and Ön Muhasebe Uyumlu while preserving KPIs, chart, counterparty summary and CSV export', async () => {
    const requestedUrls: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url.includes('/api/dynamic-tables/schema')) {
        return new Response(JSON.stringify(SAMPLE_SCHEMA), { status: 200 })
      }
      if (url.includes('/api/dynamic-tables/finance/overview')) {
        return new Response(JSON.stringify(makeOverviewResponse()), { status: 200 })
      }
      if (url.includes('/rows')) {
        return new Response(JSON.stringify({ rows: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    await act(async () => {
      root.render(<DynamicFinanceWorkspace />)
    })
    await flushAsync()

    // Must request ensure=1 so canonical tables auto-provision
    expect(requestedUrls.some((u) => u.includes('/finance/overview?period=monthly&ensure=1'))).toBe(
      true
    )

    const text = container.textContent || ''
    expect(text).toContain('Ödemeler & Finans')
    expect(text).toContain('Toplam Tahsilat')
    expect(text).toContain('Net Nakit Akışı')
    expect(text).toContain('Muhasebe Dışa Aktar')
    expect(text).toContain('Cari / Karşı Taraf Özeti')
    expect(text).toContain('Örnek Ticaret A.Ş.')

    // Dinamik Finans Tabloları, 2 Standart Tablo and Ön Muhasebe Uyumlu badge must be completely removed
    expect(text).not.toContain('Dinamik Finans Tabloları')
    expect(text).not.toContain('Ön Muhasebe Uyumlu')
    expect(text).not.toContain('2 Standart Tablo')
    expect(text).not.toContain('Klinik & Sağlık')
    expect(text).not.toContain('Emlak & Gayrimenkul')
    expect(text).not.toContain('Sigorta Acentesi')

    // Clicking "Muhasebe Dışa Aktar" triggers CSV export endpoint
    const exportBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent || '').includes('Muhasebe Dışa Aktar')
    )
    expect(exportBtn).toBeTruthy()
    const origCreateObjectUrl = URL.createObjectURL
    const origRevokeObjectUrl = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:mock-csv')
    URL.revokeObjectURL = vi.fn()
    try {
      await act(async () => {
        exportBtn!.click()
      })
      await flushAsync()
      expect(
        requestedUrls.some((u) => u.includes('/api/dynamic-tables/finance/accounting/export?format=csv'))
      ).toBe(true)
    } finally {
      URL.createObjectURL = origCreateObjectUrl
      URL.revokeObjectURL = origRevokeObjectUrl
    }
  })

  it('re-fetches schema immediately when overview auto-provisions canonical finance tables on cold start', async () => {
    let schemaCalls = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/dynamic-tables/schema')) {
        schemaCalls += 1
        if (schemaCalls === 1) {
          return new Response(
            JSON.stringify({ ...SAMPLE_SCHEMA, tables: [], moduleConfigs: [] }),
            { status: 200 }
          )
        }
        return new Response(JSON.stringify(SAMPLE_SCHEMA), { status: 200 })
      }
      if (url.includes('/api/dynamic-tables/finance/overview')) {
        return new Response(
          JSON.stringify(makeOverviewResponse({ tablesAutoProvisioned: true })),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ rows: [] }), { status: 200 })
    }) as any

    await act(async () => {
      root.render(<DynamicFinanceWorkspace />)
    })
    await flushAsync()

    expect(schemaCalls).toBe(2)
    expect(container.textContent || '').toContain('Toplam Tahsilat')
    expect(container.textContent || '').not.toContain('Dinamik Finans Tabloları')
  })

  it('DynamicTablesWorkspace hides finance_income & finance_expense tables from Veri Tabloları', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/dynamic-tables/schema')) {
        return new Response(JSON.stringify(SAMPLE_SCHEMA), { status: 200 })
      }
      if (url.includes('/rows')) {
        return new Response(JSON.stringify({ rows: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    await act(async () => {
      root.render(<DynamicTablesWorkspace />)
    })
    await flushAsync()

    const text = container.textContent || ''
    expect(text).toContain('Müşteriler')
    expect(text).toContain('1 Tablo')
    expect(text).not.toContain('Gelirler & Tahsilatlar')
    expect(text).not.toContain('Giderler & Masraflar')
  })

  it('Quick Entry modal supports universal categories/methods, live KDV & FX preview, and submits pre-accounting fields', async () => {
    let postedBody: Record<string, unknown> | null = null
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/dynamic-tables/schema')) {
        return new Response(JSON.stringify(SAMPLE_SCHEMA), { status: 200 })
      }
      if (url.includes('/api/dynamic-tables/finance/overview')) {
        return new Response(JSON.stringify(makeOverviewResponse()), { status: 200 })
      }
      if (url.includes('/api/dynamic-tables/finance/quick-entry')) {
        postedBody = JSON.parse(String(init?.body || '{}'))
        return new Response(
          JSON.stringify({ id: 'row_new', tableId: 'tbl_fin_inc' }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ rows: [] }), { status: 200 })
    }) as any

    await act(async () => {
      root.render(<DynamicFinanceWorkspace />)
    })
    await flushAsync()

    // Open Quick Entry Modal for Income
    const addIncomeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent || '').includes('Tahsilat / Gelir Ekle')
    )
    expect(addIncomeBtn).toBeTruthy()
    await act(async () => {
      addIncomeBtn!.click()
    })
    await flushAsync()

    // Universal categories & payment methods (no sector-specific 'Sigorta / Kurum')
    const modalText = container.textContent || ''
    expect(modalText).toContain('Ürün / Mal Satışı')
    expect(modalText).toContain('Hizmet / İşlem Geliri')
    expect(modalText).toContain('Online Ödeme / Sanal POS')
    expect(modalText).not.toContain('Sigorta / Kurum')

    // Fill title, counterparty, amount = 1200, VAT = 20%
    const titleInput = container.querySelector(
      'input[placeholder*="Ürün satışı"]'
    ) as HTMLInputElement
    const cpInput = container.querySelector(
      'input[placeholder*="ABC Teknoloji"]'
    ) as HTMLInputElement
    const amountInput = container.querySelector('input[placeholder="0,00"]') as HTMLInputElement
    const allSelects = Array.from(container.querySelectorAll('select'))
    const vatSelect = allSelects.find((sel) =>
      Array.from(sel.options).some((o) => o.value === '20')
    )!
    const currencySelect = allSelects.find((sel) =>
      Array.from(sel.options).some((o) => o.value === 'USD')
    )!

    await act(async () => {
      setInputValue(titleInput, 'B2B Danışmanlık Faturası')
      setInputValue(cpInput, 'Örnek Lojistik A.Ş.')
      setInputValue(amountInput, '1200')
      setInputValue(vatSelect, '20')
    })

    // Live Matrah + KDV preview must show 1.000,00 and 200,00
    expect(container.textContent || '').toContain('1.000')
    expect(container.textContent || '').toContain('200')

    // Switching currency to USD reveals Döviz Kuru input immediately without opening accordion
    await act(async () => {
      setInputValue(currencySelect, 'USD')
    })
    expect(container.querySelector('input[placeholder="Örn: 38.50"]')).toBeTruthy()

    // Switch back to TRY, expand optional accounting section, enter doc no + VKN, and submit
    await act(async () => {
      setInputValue(currencySelect, 'TRY')
    })
    const toggleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent || '').includes('Belge & Ön Muhasebe Bilgileri')
    )
    expect(toggleBtn).toBeTruthy()
    await act(async () => {
      toggleBtn!.click()
    })
    await flushAsync()

    const docInput = container.querySelector(
      'input[placeholder*="GIB2026"]'
    ) as HTMLInputElement
    const taxInput = container.querySelector(
      'input[placeholder*="10 haneli VKN"]'
    ) as HTMLInputElement
    const docTypeSelect = Array.from(container.querySelectorAll('select')).find((sel) =>
      Array.from(sel.options).some((o) => o.value === 'efatura')
    )!

    await act(async () => {
      setInputValue(docTypeSelect, 'efatura')
      setInputValue(docInput, 'GIB2026000000123')
      setInputValue(taxInput, '1234567890')
    })

    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushAsync()

    expect(postedBody).toMatchObject({
      entryType: 'income',
      title: 'B2B Danışmanlık Faturası',
      amount: 1200,
      vatRate: 20,
      vatIncluded: true,
      currency: 'TRY',
      documentType: 'efatura',
      documentNumber: 'GIB2026000000123',
      counterpartyName: 'Örnek Lojistik A.Ş.',
      counterpartyTaxId: '1234567890',
      method: 'nakit',
      category: 'hizmet_geliri',
    })
  })

  it('TablePropertiesPanel hides finance_income & finance_expense roles on non-finance tables', async () => {
    await act(async () => {
      root.render(
        <TablePropertiesPanel
          activeTable={CUSTOMERS_TABLE}
          allTables={[INCOME_TABLE, EXPENSE_TABLE, CUSTOMERS_TABLE]}
          relations={[]}
          allAppointmentConfigs={[]}
          appointmentConfig={null}
          moduleConfig={null}
          onClose={() => {}}
          onMutated={() => {}}
          onTableDeleted={() => {}}
        />
      )
    })
    await flushAsync()

    const allOptions = Array.from(container.querySelectorAll('option')).map((o) => o.value)
    expect(allOptions).not.toContain('finance_income')
    expect(allOptions).not.toContain('finance_expense')
    // Stock roles remain selectable for non-finance tables
    expect(allOptions).toContain('stock_inventory')
    expect(container.textContent || '').toContain(
      'Finans tabloları sistem tarafından standart ve sabit olarak yönetilir'
    )
    expect(container.textContent || '').not.toContain('Ödemeler, komisyonlar, primler, giderler')
  })

  it('BulkClearTablesModal marks canonical finance tables as Korumalı and disables selecting them', async () => {
    await act(async () => {
      root.render(
        <BulkClearTablesModal
          isOpen={true}
          tables={[INCOME_TABLE, EXPENSE_TABLE, CUSTOMERS_TABLE]}
          relations={[]}
          appointmentConfigs={[]}
          moduleConfigs={FINANCE_MODULE_CONFIGS}
          onClose={() => {}}
          onCleared={() => {}}
        />
      )
    })
    await flushAsync()

    expect(container.textContent || '').toContain('Korumalı')
    const checkboxes = Array.from(
      container.querySelectorAll('input[type="checkbox"]')
    ) as HTMLInputElement[]
    // 2 canonical finance checkboxes are disabled, 1 manual table checkbox is enabled
    const disabledCount = checkboxes.filter((cb) => cb.disabled).length
    const enabledCount = checkboxes.filter((cb) => !cb.disabled).length
    expect(disabledCount).toBe(2)
    expect(enabledCount).toBe(1)
    expect(checkboxes.filter((cb) => cb.disabled && cb.checked).length).toBe(0)
  })
})
