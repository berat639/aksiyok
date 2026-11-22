'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Download,
  DownloadCloud,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  TrendingUp,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import clay from '@/app/(panel)/panel/tabs/isletme/isletme-clay.module.css'
import depth from '@/styles/clinic-depth.module.css'
import InfoTooltip from '../ui/InfoTooltip'
import s from './DynamicFinanceWorkspace.module.css'
import ClinicalDatePicker from './ui/ClinicalDatePicker'
import {
  formatCurrencyTR,
  type DynamicModuleMapping,
  type DynamicModuleRole,
  type StudioSchemaResponse,
} from './types'

type FinancePeriod = 'daily' | 'weekly' | 'monthly'
type EntryPaymentStatus = 'completed' | 'partial' | 'pending'
type CurrencyCode = 'TRY' | 'USD' | 'EUR' | 'GBP'

interface FinanceOverviewResponse {
  hasFinanceTables: boolean
  isLockedSingleSchema?: boolean
  tablesAutoProvisioned?: boolean
  incomeTableIds: string[]
  expenseTableIds: string[]
  moduleTables: Array<{
    tableId: string
    tableName: string
    moduleRole: DynamicModuleRole
    mapping?: DynamicModuleMapping
    isAutoDetected: boolean
  }>
  kpis: {
    totalIncome: number
    completedIncome: number
    completedCount: number
    pendingIncome: number
    pendingCount: number
    partialIncome?: number
    partialCount?: number
    cancelledIncome: number
    totalExpense: number
    expenseCount: number
    pendingExpense?: number
    pendingExpenseCount?: number
    netCashflow: number
    monthIncome: number
    monthExpense: number
    monthNetCashflow: number
    totalNetIncome?: number
    totalVatCollected?: number
    totalNetExpense?: number
    totalVatPaid?: number
    netVatPayable?: number
    activeMonth: string
  }
  accountingSummary?: {
    totalCount: number
    readyCount: number
    pendingCount: number
    syncedCount: number
    failedCount: number
    ignoredCount: number
    connectedProvider: string | null
  }
  period: FinancePeriod
  chartData: Array<{ date: string; label: string; gelir: number; gider: number; net: number }>
  personGroups: Array<{
    key: string
    personRowId: string | null
    personName: string
    paidTotal: number
    pendingTotal: number
    paidCount: number
    pendingCount: number
    totalCount: number
    lastDate: string
  }>
  expenseCategories: Array<{ label: string; total: number; count: number }>
  quickEntryRelations: {
    personTable: {
      id: string
      name: string
      rows: Array<{ id: string; displayTitle: string }>
    } | null
    serviceTable: {
      id: string
      name: string
      rows: Array<{ id: string; displayTitle: string; suggestedAmount: number }>
    } | null
  }
  legacyMigration: {
    hasUnmigratedLegacyFinance: boolean
    unmigratedPayments: number
    unmigratedExpenses: number
  }
}

const INCOME_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'hizmet_geliri', label: 'Hizmet / İşlem Geliri' },
  { id: 'urun_satis', label: 'Ürün / Mal Satışı' },
  { id: 'abonelik_paket', label: 'Abonelik / Paket / Sözleşme' },
  { id: 'komisyon_prim', label: 'Komisyon / Aracılık / Prim' },
  { id: 'on_odeme_kapora', label: 'Ön Ödeme / Kapora / Avans' },
  { id: 'diger_gelir', label: 'Diğer Gelirler' },
]

const EXPENSE_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'stok_malzeme', label: 'Mal, Hammadde & Stok Alımı' },
  { id: 'kira_fatura', label: 'Kira, Aidat & Faturalar' },
  { id: 'personel', label: 'Personel, Maaş & SGK' },
  { id: 'pazarlama', label: 'Pazarlama & Reklam' },
  { id: 'yazilim_abonelik', label: 'Yazılım, Abonelik & Lisans' },
  { id: 'bakim_onarim', label: 'Bakım, Onarım & Teknik Servis' },
  { id: 'lojistik_ulasim', label: 'Lojistik, Kargo & Ulaşım' },
  { id: 'dis_hizmet', label: 'Danışmanlık & Dış Hizmet' },
  { id: 'vergi_resmi', label: 'Vergi, Harç & Resmi Gider' },
  { id: 'iade_mahsup', label: 'Tedarikçi İade / Mahsup' },
  { id: 'diger_gider', label: 'Diğer İşletme Giderleri' },
]

const PAYMENT_METHODS: Array<{ id: string; label: string }> = [
  { id: 'nakit', label: 'Nakit (Kasa)' },
  { id: 'kredi_karti', label: 'Kredi Kartı / POS' },
  { id: 'havale_eft', label: 'Havale / EFT / FAST' },
  { id: 'online_odeme', label: 'Online Ödeme / Sanal POS' },
  { id: 'cek_senet', label: 'Çek / Senet' },
  { id: 'taksit_senet', label: 'Vadeli / Açık Hesap' },
  { id: 'diger', label: 'Diğer / Kurum' },
]

const DOCUMENT_TYPES: Array<{ id: string; label: string }> = [
  { id: 'belgesiz', label: 'Belgesiz / İç Kayıt' },
  { id: 'efatura', label: 'e-Fatura' },
  { id: 'earsiv', label: 'e-Arşiv Fatura' },
  { id: 'esmm', label: 'e-SMM (Serbest Meslek Makbuzu)' },
  { id: 'fis_makbuz', label: 'Fiş / Tahsilat Makbuzu' },
  { id: 'gider_pusulasi', label: 'Gider Pusulası' },
  { id: 'banka_dekont', label: 'Banka Dekontu' },
]

const CURRENCY_OPTIONS: Array<{ id: CurrencyCode; label: string; symbol: string }> = [
  { id: 'TRY', label: 'TRY (₺)', symbol: '₺' },
  { id: 'USD', label: 'USD ($)', symbol: '$' },
  { id: 'EUR', label: 'EUR (€)', symbol: '€' },
  { id: 'GBP', label: 'GBP (£)', symbol: '£' },
]

const VAT_RATE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: '%0' },
  { value: 1, label: '%1' },
  { value: 10, label: '%10' },
  { value: 20, label: '%20' },
]

const AXIS_TICK = { fill: 'var(--foreground-2)', fontSize: 11.5, fontWeight: 650 }

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function formatMoneyByCurrency(amount: number, currency: CurrencyCode): string {
  if (currency === 'TRY') return formatCurrencyTR(amount)
  const sym = CURRENCY_OPTIONS.find((c) => c.id === currency)?.symbol ?? currency
  const formatted = amount.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${formatted} ${sym}`
}

function formatAxisValue(val: number): string {
  const safe = Number.isFinite(val) ? val : 0
  if (Math.abs(safe) >= 10000) {
    return new Intl.NumberFormat('tr-TR', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(safe)
  }
  return safe.toLocaleString('tr-TR')
}

function FinanceChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string; name?: string; value?: number | string }>
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  const gelirEntry = payload.find((p) => p.dataKey === 'gelir')
  const giderEntry = payload.find((p) => p.dataKey === 'gider')
  const gelirVal = Number(gelirEntry?.value ?? 0)
  const giderVal = Number(giderEntry?.value ?? 0)

  return (
    <div className={clay.chartTip}>
      <p className={clay.chartTipLabel}>{String(label ?? '')}</p>
      <div className={s.chartTipRows}>
        <div className={s.chartTipRow}>
          <span className={s.chartTipDotIncome} aria-hidden="true" />
          <span>Gelir:</span>
          <span className={s.chartTipAmount}>{formatCurrencyTR(gelirVal)}</span>
        </div>
        <div className={s.chartTipRow}>
          <span className={s.chartTipDotExpense} aria-hidden="true" />
          <span>Gider:</span>
          <span className={s.chartTipAmount}>{formatCurrencyTR(giderVal)}</span>
        </div>
      </div>
    </div>
  )
}

function todayIsoDate(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export default function DynamicFinanceWorkspace() {
  const [schema, setSchema] = useState<StudioSchemaResponse | null>(null)
  const [overview, setOverview] = useState<FinanceOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<FinancePeriod>('monthly')

  const [ensuringTables, setEnsuringTables] = useState(false)
  const [migratingLegacy, setMigratingLegacy] = useState(false)
  const [exportingCsv, setExportingCsv] = useState(false)

  // Quick Finance Entry Modal (460px Clay/Neo)
  const [quickModalOpen, setQuickModalOpen] = useState(false)
  const [entryType, setEntryType] = useState<'income' | 'expense'>('income')
  const [formTitle, setFormTitle] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formCurrency, setFormCurrency] = useState<CurrencyCode>('TRY')
  const [formExchangeRate, setFormExchangeRate] = useState('1')
  const [formVatRate, setFormVatRate] = useState<number>(0)
  const [formVatIncluded, setFormVatIncluded] = useState(true)
  const [formQuantity, setFormQuantity] = useState('1')
  const [formDate, setFormDate] = useState<string>(todayIsoDate)
  const [formDueDate, setFormDueDate] = useState<string | null>(null)
  const [formStatus, setFormStatus] = useState<EntryPaymentStatus>('completed')
  const [formMethod, setFormMethod] = useState('nakit')
  const [formCategory, setFormCategory] = useState('hizmet_geliri')
  const [formCounterpartyName, setFormCounterpartyName] = useState('')
  const [formCounterpartyTaxId, setFormCounterpartyTaxId] = useState('')
  const [formDocumentType, setFormDocumentType] = useState('belgesiz')
  const [formDocumentNumber, setFormDocumentNumber] = useState('')
  const [showAccountingDetails, setShowAccountingDetails] = useState(false)
  const [formPersonRowId, setFormPersonRowId] = useState('')
  const [formServiceRowIds, setFormServiceRowIds] = useState<string[]>([])
  const [formNotes, setFormNotes] = useState('')
  const [savingEntry, setSavingEntry] = useState(false)

  const loadAll = useCallback(
    async (activePeriod: FinancePeriod = period) => {
      try {
        const [schemaRes, overviewRes] = await Promise.all([
          fetch('/api/dynamic-tables/schema', { credentials: 'include' }),
          fetch(`/api/dynamic-tables/finance/overview?period=${activePeriod}&ensure=1`, {
            credentials: 'include',
          }),
        ])
        let schemaData = (await schemaRes.json().catch(() => null)) as StudioSchemaResponse | null
        const overviewData = (await overviewRes
          .json()
          .catch(() => null)) as FinanceOverviewResponse | null

        if (overviewRes.ok && overviewData) {
          const modIds: string[] = (overviewData.moduleTables || []).map((m) => m.tableId)
          const schemaTableIds = new Set((schemaData?.tables || []).map((t) => t.id))
          const needsFreshSchema =
            Boolean(overviewData.tablesAutoProvisioned) ||
            modIds.some((id) => !schemaTableIds.has(id))

          if (needsFreshSchema) {
            const freshRes = await fetch('/api/dynamic-tables/schema', { credentials: 'include' })
            const freshSchema = (await freshRes
              .json()
              .catch(() => null)) as StudioSchemaResponse | null
            if (freshRes.ok && freshSchema) {
              schemaData = freshSchema
            }
          }

          setOverview(overviewData)
        }

        if (schemaRes.ok && schemaData) {
          setSchema(schemaData)
        }
      } catch {
        toast.error('Finans verileri yüklenirken hata oluştu')
      } finally {
        setLoading(false)
      }
    },
    [period]
  )

  useEffect(() => {
    void loadAll(period)
  }, [loadAll, period])

  const triggerRefresh = useCallback(() => {
    void loadAll(period)
  }, [loadAll, period])

  const previewAmounts = useMemo(() => {
    const raw = Number(String(formAmount).replace(',', '.'))
    if (!Number.isFinite(raw) || raw === 0) return null
    const rate = formCurrency === 'TRY' ? 1 : Math.max(0.0001, Number(String(formExchangeRate).replace(',', '.')) || 1)
    let net: number
    let vat: number
    let gross: number
    if (formVatIncluded) {
      gross = round2(raw)
      net = formVatRate > 0 ? round2(gross / (1 + formVatRate / 100)) : gross
      vat = round2(gross - net)
    } else {
      net = round2(raw)
      vat = round2(net * (formVatRate / 100))
      gross = round2(net + vat)
    }
    return {
      net,
      vat,
      gross,
      baseTry: round2(gross * rate),
    }
  }, [formAmount, formCurrency, formExchangeRate, formVatRate, formVatIncluded])

  const handleSwitchEntryType = (nextType: 'income' | 'expense') => {
    setEntryType(nextType)
    setFormCategory(nextType === 'expense' ? 'kira_fatura' : 'hizmet_geliri')
  }

  const openQuickModal = (
    mode: 'income' | 'expense',
    prefill?: { personRowId?: string; personName?: string; pendingAmount?: number }
  ) => {
    setEntryType(mode)
    setFormDate(todayIsoDate())
    setFormDueDate(null)
    setFormStatus('completed')
    setFormMethod('nakit')
    setFormCategory(mode === 'expense' ? 'kira_fatura' : 'hizmet_geliri')
    setFormCurrency('TRY')
    setFormExchangeRate('1')
    setFormVatRate(0)
    setFormVatIncluded(true)
    setFormDocumentType('belgesiz')
    setFormDocumentNumber('')
    setFormCounterpartyTaxId('')
    setShowAccountingDetails(false)
    setFormQuantity('1')
    setFormServiceRowIds([])
    setFormNotes('')

    const cleanPersonName =
      prefill?.personName && prefill.personName !== 'Genel / Cari Belirtilmemiş'
        ? prefill.personName
        : ''

    if (prefill?.personRowId || cleanPersonName) {
      setFormPersonRowId(prefill?.personRowId || '')
      setFormCounterpartyName(cleanPersonName)
      setFormTitle(cleanPersonName ? `${cleanPersonName} — Tahsilat` : '')
      setFormAmount(
        prefill?.pendingAmount && prefill.pendingAmount > 0 ? String(prefill.pendingAmount) : ''
      )
    } else {
      setFormPersonRowId('')
      setFormCounterpartyName('')
      setFormTitle('')
      setFormAmount('')
    }
    setQuickModalOpen(true)
  }

  const handleToggleServiceRow = (rowId: string) => {
    const svcRows = overview?.quickEntryRelations.serviceTable?.rows || []
    setFormServiceRowIds((prev) => {
      const next = prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]
      const selectedObjects = svcRows.filter((r) => next.includes(r.id))
      const suggestedSum = selectedObjects.reduce((acc, item) => acc + (item.suggestedAmount || 0), 0)
      if (suggestedSum > 0) {
        setFormAmount(String(suggestedSum))
      }
      if (!formTitle.trim() && selectedObjects.length > 0) {
        setFormTitle(selectedObjects.map((item) => item.displayTitle).join(', '))
      }
      return next
    })
  }

  const handleSubmitQuickEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsedAmount = Number(String(formAmount).replace(',', '.'))
    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
      toast.error('Lütfen geçerli bir tutar giriniz')
      return
    }

    const cleanTaxDigits = formCounterpartyTaxId.replace(/\D/g, '')
    if (cleanTaxDigits.length > 0 && cleanTaxDigits.length !== 10 && cleanTaxDigits.length !== 11) {
      toast.error('VKN 10 haneli, TCKN 11 haneli olmalıdır')
      return
    }

    const parsedRate =
      formCurrency === 'TRY'
        ? 1
        : Number(String(formExchangeRate).replace(',', '.'))
    if (formCurrency !== 'TRY' && (!Number.isFinite(parsedRate) || parsedRate <= 0)) {
      toast.error('Lütfen geçerli bir döviz kuru giriniz')
      return
    }

    const personName =
      overview?.quickEntryRelations.personTable?.rows.find((r) => r.id === formPersonRowId)
        ?.displayTitle || ''
    const resolvedCounterparty = formCounterpartyName.trim() || personName || null

    const categoryList = entryType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
    const resolvedTitle =
      formTitle.trim() ||
      (entryType === 'income'
        ? resolvedCounterparty
          ? `${resolvedCounterparty} — Tahsilat`
          : categoryList.find((c) => c.id === formCategory)?.label || 'Tahsilat Kaydı'
        : categoryList.find((c) => c.id === formCategory)?.label || 'Gider Kaydı')

    setSavingEntry(true)
    try {
      const res = await fetch('/api/dynamic-tables/finance/quick-entry', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryType,
          title: resolvedTitle,
          amount: parsedAmount,
          netAmount: !formVatIncluded ? parsedAmount : undefined,
          vatRate: formVatRate,
          vatIncluded: formVatIncluded,
          currency: formCurrency,
          exchangeRate: formCurrency === 'TRY' ? 1 : parsedRate,
          quantity: entryType === 'expense' ? Math.max(1, Number(formQuantity) || 1) : 1,
          date: formDate || todayIsoDate(),
          dueDate: formStatus === 'pending' || formStatus === 'partial' ? formDueDate : null,
          status: formStatus,
          method: formMethod,
          category: formCategory,
          documentType: formDocumentType,
          documentNumber: formDocumentNumber.trim() || null,
          counterpartyName: resolvedCounterparty,
          counterpartyTaxId: cleanTaxDigits || null,
          personRowId: entryType === 'income' && formPersonRowId ? formPersonRowId : null,
          serviceRowIds: entryType === 'income' ? formServiceRowIds : undefined,
          notes: formNotes.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Finans kaydı oluşturulamadı')
        return
      }
      toast.success(
        entryType === 'income'
          ? 'Gelir / tahsilat kaydı eklendi'
          : 'Gider / masraf kaydı eklendi'
      )
      setQuickModalOpen(false)
      triggerRefresh()
    } catch {
      toast.error('Kayıt sırasında ağ hatası oluştu')
    } finally {
      setSavingEntry(false)
    }
  }

  const handleEnsureCanonicalTables = async () => {
    setEnsuringTables(true)
    try {
      const res = await fetch('/api/dynamic-tables/finance/ensure', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Standart finans tabloları hazırlanamadı')
        return
      }
      toast.success('Standart finans tabloları hazırlandı')
      triggerRefresh()
    } catch {
      toast.error('Standart tablolar hazırlanırken ağ hatası oluştu')
    } finally {
      setEnsuringTables(false)
    }
  }

  const handleExportAccountingCsv = async () => {
    setExportingCsv(true)
    try {
      const res = await fetch('/api/dynamic-tables/finance/accounting/export?format=csv', {
        credentials: 'include',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Ön muhasebe dosyası oluşturulamadı')
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = /filename="?([^"]+)"?/i.exec(disposition)
      const filename = match?.[1] || `on-muhasebe-kayitlari-${todayIsoDate()}.csv`
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      toast.success('Ön muhasebe aktarım dosyası (CSV) indirildi')
    } catch {
      toast.error('Dışa aktarım sırasında hata oluştu')
    } finally {
      setExportingCsv(false)
    }
  }

  const handleMigrateLegacy = async () => {
    setMigratingLegacy(true)
    try {
      const res = await fetch('/api/dynamic-tables/migrate-legacy-module-data', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'finance' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Kayıtlar aktarılamadı')
        return
      }
      toast.success(
        `${data.importedIncomeCount || 0} tahsilat ve ${data.importedExpenseCount || 0} gider kaydı standart finans tablolarına aktarıldı`
      )
      triggerRefresh()
    } catch {
      toast.error('Aktarım sırasında hata oluştu')
    } finally {
      setMigratingLegacy(false)
    }
  }

  if (loading && !overview) {
    return (
      <div className={clay.scope}>
        <div className={clay.emptyHero}>Ödemeler ve finans verileri yükleniyor…</div>
      </div>
    )
  }

  const canManageSchema = Boolean(schema?.canManageSchema)
  const kpis = overview?.kpis || {
    totalIncome: 0,
    completedIncome: 0,
    completedCount: 0,
    pendingIncome: 0,
    pendingCount: 0,
    partialIncome: 0,
    partialCount: 0,
    cancelledIncome: 0,
    totalExpense: 0,
    expenseCount: 0,
    pendingExpense: 0,
    pendingExpenseCount: 0,
    netCashflow: 0,
    monthIncome: 0,
    monthExpense: 0,
    monthNetCashflow: 0,
    totalNetIncome: 0,
    totalVatCollected: 0,
    totalNetExpense: 0,
    totalVatPaid: 0,
    netVatPayable: 0,
    activeMonth: '',
  }

  const taxDigitsOnly = formCounterpartyTaxId.replace(/\D/g, '')
  const hasInvalidTaxLength =
    taxDigitsOnly.length > 0 && taxDigitsOnly.length !== 10 && taxDigitsOnly.length !== 11
  const activeCategories = entryType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES

  return (
    <div className={clay.scope}>
      {/* Üst Güçlü Mavi Clay Hero Şeridi */}
      <div className={clay.hero}>
        <div className={clay.heroMain}>
          <div className={clay.heroLeft}>
            <span className={clay.heroBadgeIcon} aria-hidden="true">
              <Wallet size={20} strokeWidth={2.3} color="#ffffff" />
            </span>
            <div className={s.heroTextCol}>
              <div className={clay.heroTitleRow}>
                <h2 className={clay.heroName}>Ödemeler &amp; Finans</h2>
                <InfoTooltip title="Finans ve Raporlama" glyph="?">
                  Gelir, tahsilat, vadeli alacak ve işletme giderlerinizi tek ekrandan izleyin; yeni tahsilat veya gider ekleyip raporlarınızı CSV olarak dışa aktarabilirsiniz.
                </InfoTooltip>
              </div>
              {overview?.hasFinanceTables && (
                <div className={clay.heroMeta}>
                  <span className={clay.heroMetaItem}>
                    <ArrowUpRight size={12} color="#ffffff" />
                    <span>
                      Bu ay tahsilat:{' '}
                      <strong className={s.heroMetaStrong}>
                        {formatCurrencyTR(kpis.monthIncome)}
                      </strong>
                    </span>
                  </span>
                  <span className={clay.heroMetaItem}>
                    <TrendingUp size={12} color="#ffffff" />
                    <span>
                      Bu ay net:{' '}
                      <strong className={s.heroMetaStrong}>
                        {formatCurrencyTR(kpis.monthNetCashflow)}
                      </strong>
                    </span>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className={clay.heroActions}>
            {overview?.hasFinanceTables && (
              <button
                type="button"
                disabled={exportingCsv}
                onClick={() => void handleExportAccountingCsv()}
                className={clay.heroGhostBtn}
                title="Tüm gelir ve gider kayıtlarını ön muhasebe uyumlu CSV olarak indir"
              >
                <Download size={14} color="#ffffff" />
                <span>{exportingCsv ? 'Hazırlanıyor…' : 'Muhasebe Dışa Aktar'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => openQuickModal('expense')}
              className={clay.heroGhostBtn}
            >
              <ArrowDownRight size={15} color="#ffffff" />
              <span>+ Gider / Masraf Ekle</span>
            </button>
            <button
              type="button"
              onClick={() => openQuickModal('income')}
              className={clay.heroPrimaryBtn}
            >
              <Plus size={15} strokeWidth={2.5} color="#0e2152" />
              <span>Tahsilat / Gelir Ekle</span>
            </button>
          </div>
        </div>
      </div>

      {/* Eski Sabit Tablolardan Tek Tıkla Aktarım Banner'ı */}
      {overview?.legacyMigration.hasUnmigratedLegacyFinance && canManageSchema && (
        <div className={clay.noticeInfo}>
          <div className={s.bannerLead}>
            <span className={`${clay.iconChipSm} ${clay.chipMint}`} aria-hidden="true">
              <DownloadCloud size={16} strokeWidth={2.3} color="#ffffff" />
            </span>
            <span className={s.bannerText}>
              Önceki sabit kayıtlarda{' '}
              <strong>{overview.legacyMigration.unmigratedPayments} ödeme</strong> ve{' '}
              <strong>{overview.legacyMigration.unmigratedExpenses} gider</strong> bulundu. Tek
              tıkla standart finans tablolarına aktarabilirsiniz.
            </span>
          </div>
          <button
            type="button"
            disabled={migratingLegacy}
            onClick={() => void handleMigrateLegacy()}
            className={clay.mintBtn}
          >
            <DownloadCloud size={13} />
            <span>{migratingLegacy ? 'Aktarılıyor…' : 'Mevcut Kayıtları Aktar'}</span>
          </button>
        </div>
      )}

      {/* Standart Tablolar Henüz Hazır Değilse Tek Evrensel Hazırlama Kartı */}
      {!overview?.hasFinanceTables && (
        <div className={clay.card}>
          <div className={clay.cardHead}>
            <div className={clay.cardTitleGroup}>
              <span className={`${clay.iconChip} ${clay.chipBrand}`} aria-hidden="true">
                <FileSpreadsheet size={18} strokeWidth={2.3} color="#ffffff" />
              </span>
              <div>
                <h3 className={clay.cardTitle}>Standart Finans Tabloları Hazırlanıyor</h3>
                <p className={s.ensureSub}>
                  Tüm sektörlere ve ön muhasebe yazılımlarına uyumlu Gelirler &amp; Tahsilatlar ile
                  Giderler &amp; Masraflar tabloları tek standart yapıda otomatik oluşturulur.
                </p>
              </div>
            </div>
          </div>
          <div className={s.ensureActions}>
            <button
              type="button"
              disabled={ensuringTables}
              onClick={() => void handleEnsureCanonicalTables()}
              className={clay.primaryBtn}
            >
              <RefreshCw size={14} color="#ffffff" />
              <span>
                {ensuringTables ? 'Hazırlanıyor…' : 'Standart Finans Tablolarını Hazırla'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 4 Canlı KPI Özeti */}
      {overview?.hasFinanceTables && (
        <>
          <div className={clay.statGrid}>
            <article className={clay.statCard}>
              <div className={clay.cardHead}>
                <div className={clay.cardTitleGroup}>
                  <span className={`${clay.iconChipSm} ${clay.chipMint}`} aria-hidden="true">
                    <ArrowUpRight size={17} strokeWidth={2.3} color="#ffffff" />
                  </span>
                  <h3 className={clay.statTitle}>Toplam Tahsilat</h3>
                </div>
                <span className={clay.pillGood}>{kpis.completedCount} Kayıt</span>
              </div>
              <div className={`${clay.statVal} ${clay.valGood}`}>
                {formatCurrencyTR(kpis.completedIncome)}
              </div>
              <div className={clay.statFoot}>
                <span className={clay.wellPill}>
                  Bu ay: {formatCurrencyTR(kpis.monthIncome)}
                </span>
                {(kpis.totalVatCollected ?? 0) > 0 && (
                  <span className={clay.wellPill}>
                    KDV: {formatCurrencyTR(kpis.totalVatCollected ?? 0)}
                  </span>
                )}
              </div>
            </article>

            <article className={clay.statCard}>
              <div className={clay.cardHead}>
                <div className={clay.cardTitleGroup}>
                  <span className={`${clay.iconChipSm} ${clay.chipAmber}`} aria-hidden="true">
                    <Clock size={17} strokeWidth={2.3} color="#ffffff" />
                  </span>
                  <h3 className={clay.statTitle}>Bekleyen / Vadeli Alacak</h3>
                </div>
                <span className={clay.pillWatch}>{kpis.pendingCount} Bekleyen</span>
              </div>
              <div className={clay.statVal}>{formatCurrencyTR(kpis.pendingIncome)}</div>
              <div className={clay.statFoot}>
                <span className={clay.wellPill}>
                  {(kpis.partialCount ?? 0) > 0
                    ? `${kpis.partialCount} kısmi tahsilat dahil`
                    : 'Açık tahsilatlar'}
                </span>
              </div>
            </article>

            <article className={clay.statCard}>
              <div className={clay.cardHead}>
                <div className={clay.cardTitleGroup}>
                  <span className={`${clay.iconChipSm} ${clay.chipCoral}`} aria-hidden="true">
                    <ArrowDownRight size={17} strokeWidth={2.3} color="#ffffff" />
                  </span>
                  <h3 className={clay.statTitle}>Toplam Gider &amp; Maliyet</h3>
                </div>
                <span className={clay.pillDanger}>{kpis.expenseCount} Kalem</span>
              </div>
              <div className={`${clay.statVal} ${clay.valDanger}`}>
                {formatCurrencyTR(kpis.totalExpense)}
              </div>
              <div className={clay.statFoot}>
                <span className={clay.wellPill}>
                  Bu ay gider: {formatCurrencyTR(kpis.monthExpense)}
                </span>
                {(kpis.pendingExpense ?? 0) > 0 && (
                  <span className={clay.wellPill}>
                    Vadeli borç: {formatCurrencyTR(kpis.pendingExpense ?? 0)}
                  </span>
                )}
              </div>
            </article>

            <article className={clay.statCard}>
              <div className={clay.cardHead}>
                <div className={clay.cardTitleGroup}>
                  <span className={`${clay.iconChipSm} ${clay.chipBrand}`} aria-hidden="true">
                    <TrendingUp size={17} strokeWidth={2.3} color="#ffffff" />
                  </span>
                  <h3 className={clay.statTitle}>Net Nakit Akışı</h3>
                </div>
                <span className={kpis.netCashflow >= 0 ? clay.pillGood : clay.pillDanger}>
                  {kpis.netCashflow >= 0 ? 'Pozitif' : 'Negatif'}
                </span>
              </div>
              <div
                className={`${clay.statVal} ${
                  kpis.netCashflow >= 0 ? clay.valGood : clay.valDanger
                }`}
              >
                {formatCurrencyTR(kpis.netCashflow)}
              </div>
              <div className={clay.statFoot}>
                <span className={clay.wellPill}>
                  Bu ay net: {formatCurrencyTR(kpis.monthNetCashflow)}
                </span>
                {((kpis.totalVatCollected ?? 0) > 0 || (kpis.totalVatPaid ?? 0) > 0) && (
                  <span className={clay.wellPill}>
                    Net KDV: {formatCurrencyTR(kpis.netVatPayable ?? 0)}
                  </span>
                )}
              </div>
            </article>
          </div>

          {/* Grafik + Cari / Karşı Taraf Bazlı Tahsilat Özeti */}
          <div className={s.analyticsGrid}>
            {/* Gelir & Gider Grafiği */}
            <div className={clay.card}>
              <div className={clay.cardHead}>
                <div className={clay.cardTitleGroup}>
                  <span className={`${clay.iconChipSm} ${clay.chipBrand}`} aria-hidden="true">
                    <TrendingUp size={17} strokeWidth={2.3} color="#ffffff" />
                  </span>
                  <h3 className={clay.cardTitle}>Gelir &amp; Gider Grafiği</h3>
                </div>

                <div className={clay.segmentTrack} role="tablist" aria-label="Grafik dönemi">
                  {(
                    [
                      { id: 'daily', label: 'Günlük' },
                      { id: 'weekly', label: 'Haftalık' },
                      { id: 'monthly', label: 'Aylık' },
                    ] as const
                  ).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="tab"
                      aria-selected={period === p.id}
                      onClick={() => setPeriod(p.id)}
                      className={period === p.id ? clay.segmentOn : clay.segment}
                    >
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className={s.chartLegend}>
                <span className={s.legendItem}>
                  <span className={s.legendDotIncome} aria-hidden="true" />
                  <span>Gelir / Tahsilat</span>
                </span>
                <span className={s.legendItem}>
                  <span className={s.legendDotExpense} aria-hidden="true" />
                  <span>Gider / Maliyet</span>
                </span>
              </div>

              {overview.chartData.length === 0 ? (
                <div className={clay.emptyHero}>
                  Bu dönem için grafik verisi henüz bulunmuyor.
                </div>
              ) : (
                <div className={s.chartWrap}>
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    initialDimension={{ width: 320, height: 228 }}
                  >
                    <BarChart
                      data={overview.chartData}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        stroke="var(--clay-grid)"
                        strokeDasharray="3 6"
                      />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tick={AXIS_TICK}
                        interval="preserveStartEnd"
                        minTickGap={18}
                        tickMargin={6}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tick={AXIS_TICK}
                        tickFormatter={formatAxisValue}
                        width={52}
                      />
                      <Tooltip
                        content={<FinanceChartTooltip />}
                        cursor={{ fill: 'var(--clay-well)' }}
                      />
                      <Bar
                        dataKey="gelir"
                        name="Gelir / Tahsilat"
                        fill="var(--clay-c1)"
                        radius={[10, 10, 10, 10]}
                        maxBarSize={32}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="gider"
                        name="Gider / Maliyet"
                        fill="var(--clay-c5)"
                        radius={[10, 10, 10, 10]}
                        maxBarSize={32}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Cari / Karşı Taraf Bazlı Tahsilat Özeti */}
            <div className={clay.card}>
              <div className={clay.cardHead}>
                <div className={clay.cardTitleGroup}>
                  <span className={`${clay.iconChipSm} ${clay.chipViolet}`} aria-hidden="true">
                    <UserCheck size={17} strokeWidth={2.3} color="#ffffff" />
                  </span>
                  <h3 className={clay.cardTitle}>Cari / Karşı Taraf Özeti</h3>
                </div>
              </div>

              {overview.personGroups.length === 0 ? (
                <div className={clay.emptyHero}>Henüz tahsilat kaydı bulunmuyor.</div>
              ) : (
                <div className={clay.wellList}>
                  {overview.personGroups.slice(0, 12).map((pg) => (
                    <div key={pg.key} className={clay.wellRow}>
                      <div className={s.personRowMain}>
                        <div className={s.personName}>{pg.personName}</div>
                        <div className={s.personMeta}>
                          Ödenen: <strong>{formatCurrencyTR(pg.paidTotal)}</strong>
                          {pg.pendingTotal > 0 && (
                            <span className={s.personPending}>
                              {' '}
                              • Bekleyen: {formatCurrencyTR(pg.pendingTotal)}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          openQuickModal('income', {
                            personRowId: pg.personRowId || undefined,
                            personName: pg.personName,
                            pendingAmount: pg.pendingTotal > 0 ? pg.pendingTotal : undefined,
                          })
                        }}
                        className={`${clay.ctlBtnSm} ${s.personActionBtn}`}
                      >
                        <CreditCard size={12} />
                        <span>Tahsilat Al</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* 460px Clay/Neo Hızlı Gelir & Gider Modalı */}
      {quickModalOpen && (
        <div className={depth.backdrop} onClick={() => setQuickModalOpen(false)}>
          <div
            className={`${depth.modal} ${s.modalShell}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`${clay.scope} ${s.modalSurface}`}
              style={{ gap: 12, padding: '16px 18px' }}
            >
              <div className={s.modalHead}>
                <div className={s.modalTitleGroup}>
                  <span
                    className={`${clay.iconChipSm} ${
                      entryType === 'income' ? clay.chipMint : clay.chipCoral
                    }`}
                    aria-hidden="true"
                  >
                    {entryType === 'income' ? (
                      <ArrowUpRight size={16} strokeWidth={2.3} color="#ffffff" />
                    ) : (
                      <ArrowDownRight size={16} strokeWidth={2.3} color="#ffffff" />
                    )}
                  </span>
                  <h3 className={clay.cardTitle}>
                    {entryType === 'income'
                      ? 'Yeni Tahsilat / Gelir Ekle'
                      : 'Yeni Gider / Masraf Ekle'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setQuickModalOpen(false)}
                  className={clay.iconToolBtn}
                  aria-label="Kapat"
                >
                  <X size={15} />
                </button>
              </div>

              <div className={clay.segmentTrack} style={{ width: '100%' }}>
                <button
                  type="button"
                  onClick={() => handleSwitchEntryType('income')}
                  className={`${
                    entryType === 'income' ? clay.segmentOn : clay.segment
                  } ${s.segmentFill}`}
                >
                  <span>Tahsilat / Gelir</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchEntryType('expense')}
                  className={`${
                    entryType === 'expense' ? clay.segmentOn : clay.segment
                  } ${s.segmentFill}`}
                >
                  <span>Gider / Masraf</span>
                </button>
              </div>

              <form onSubmit={handleSubmitQuickEntry} className={s.modalForm}>
                {entryType === 'income' && overview?.quickEntryRelations.personTable && (
                  <div className={clay.field}>
                    <label className={clay.fieldLabel}>
                      Bağlı {overview.quickEntryRelations.personTable.name} (İsteğe Bağlı)
                    </label>
                    <select
                      value={formPersonRowId}
                      onChange={(e) => {
                        const nextId = e.target.value
                        setFormPersonRowId(nextId)
                        const found = overview.quickEntryRelations.personTable?.rows.find(
                          (r) => r.id === nextId
                        )
                        if (found) {
                          setFormCounterpartyName(found.displayTitle)
                          if (!formTitle.trim()) {
                            setFormTitle(`${found.displayTitle} — Tahsilat`)
                          }
                        }
                      }}
                      className={clay.wellSelect}
                    >
                      <option value="">Kayıt seçiniz…</option>
                      {overview.quickEntryRelations.personTable.rows.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.displayTitle}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {entryType === 'income' &&
                  overview?.quickEntryRelations.serviceTable &&
                  overview.quickEntryRelations.serviceTable.rows.length > 0 && (
                    <div className={clay.field}>
                      <label className={clay.fieldLabel}>
                        İlgili {overview.quickEntryRelations.serviceTable.name} (Seçildiğinde Tutar
                        Önerilir)
                      </label>
                      <div className={s.serviceChipsWell}>
                        {overview.quickEntryRelations.serviceTable.rows.slice(0, 24).map((svc) => {
                          const active = formServiceRowIds.includes(svc.id)
                          return (
                            <button
                              key={svc.id}
                              type="button"
                              onClick={() => handleToggleServiceRow(svc.id)}
                              className={
                                active ? `${clay.ctlBtnOn} ${s.serviceChipBtn}` : clay.ctlBtnSm
                              }
                            >
                              <span>
                                {svc.displayTitle}
                                {svc.suggestedAmount > 0
                                  ? ` (${svc.suggestedAmount.toLocaleString('tr-TR')} ₺)`
                                  : ''}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                <div className={clay.field}>
                  <label className={clay.fieldLabel}>
                    {entryType === 'income' ? 'Gelir / İşlem Açıklaması' : 'Gider Kalemi / Başlık'}
                  </label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder={
                      entryType === 'income'
                        ? 'Örn: Ürün satışı, hizmet bedeli, abonelik tahsilatı…'
                        : 'Örn: Kira ödemesi, malzeme alımı, yazılım aboneliği…'
                    }
                    className={clay.wellInput}
                  />
                </div>

                <div className={entryType === 'expense' ? s.formGridExpense : clay.field}>
                  <div className={clay.field}>
                    <label className={clay.fieldLabel}>
                      {entryType === 'income' ? 'Gelir Kategorisi' : 'Gider Kategorisi'}
                    </label>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className={clay.wellSelect}
                    >
                      {activeCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {entryType === 'expense' && (
                    <div className={clay.field}>
                      <label className={clay.fieldLabel}>Adet / Miktar</label>
                      <input
                        type="number"
                        min="1"
                        value={formQuantity}
                        onChange={(e) => setFormQuantity(e.target.value)}
                        className={clay.wellInput}
                      />
                    </div>
                  )}
                </div>

                <div className={clay.field}>
                  <label className={clay.fieldLabel}>
                    {entryType === 'income'
                      ? 'Cari / Müşteri Ünvanı (İsteğe Bağlı)'
                      : 'Tedarikçi / Cari Ünvanı (İsteğe Bağlı)'}
                  </label>
                  <input
                    type="text"
                    value={formCounterpartyName}
                    onChange={(e) => setFormCounterpartyName(e.target.value)}
                    placeholder={
                      entryType === 'income'
                        ? 'Örn: ABC Teknoloji A.Ş. veya müşteri adı'
                        : 'Örn: XYZ Tedarik Ltd. Şti. veya kurum adı'
                    }
                    className={clay.wellInput}
                  />
                </div>

                <div className={s.formGridAmount}>
                  <div className={clay.field}>
                    <label className={clay.fieldLabel}>
                      {formVatIncluded ? 'Toplam Tutar (KDV Dahil) *' : 'Tutar (KDV Hariç) *'}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      placeholder="0,00"
                      className={`${clay.wellInput} ${s.amountInput}`}
                    />
                  </div>

                  <div className={clay.field}>
                    <label className={clay.fieldLabel}>Para Birimi</label>
                    <select
                      value={formCurrency}
                      onChange={(e) => {
                        const nextCur = e.target.value as CurrencyCode
                        setFormCurrency(nextCur)
                        if (nextCur === 'TRY') setFormExchangeRate('1')
                        else if (formExchangeRate === '1') setFormExchangeRate('')
                      }}
                      className={clay.wellSelect}
                    >
                      {CURRENCY_OPTIONS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={clay.field}>
                    <label className={clay.fieldLabel}>KDV Oranı</label>
                    <select
                      value={String(formVatRate)}
                      onChange={(e) => setFormVatRate(Number(e.target.value))}
                      className={clay.wellSelect}
                    >
                      {VAT_RATE_OPTIONS.map((v) => (
                        <option key={v.value} value={String(v.value)}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {formCurrency !== 'TRY' && (
                  <div className={clay.field}>
                    <label className={clay.fieldLabel}>
                      Döviz Kuru (1 {formCurrency} = ₺) *
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      min="0.0001"
                      required
                      value={formExchangeRate}
                      onChange={(e) => setFormExchangeRate(e.target.value)}
                      placeholder="Örn: 38.50"
                      className={clay.wellInput}
                    />
                  </div>
                )}

                {previewAmounts && (formVatRate > 0 || formCurrency !== 'TRY') && (
                  <div className={s.taxPreviewStrip} aria-live="polite">
                    <span className={s.taxPreviewItem}>
                      <span>Matrah:</span>
                      <strong className={s.taxPreviewVal}>
                        {formatMoneyByCurrency(previewAmounts.net, formCurrency)}
                      </strong>
                    </span>
                    <span className={s.taxPreviewItem}>
                      <span>KDV (%{formVatRate}):</span>
                      <strong className={s.taxPreviewVal}>
                        {formatMoneyByCurrency(previewAmounts.vat, formCurrency)}
                      </strong>
                    </span>
                    <span className={s.taxPreviewItem}>
                      <span>Genel Toplam:</span>
                      <strong className={s.taxPreviewVal}>
                        {formatMoneyByCurrency(previewAmounts.gross, formCurrency)}
                      </strong>
                    </span>
                    {formCurrency !== 'TRY' && (
                      <span className={s.taxPreviewItem}>
                        <span>TL Karşılığı:</span>
                        <strong className={s.taxPreviewVal}>
                          {formatCurrencyTR(previewAmounts.baseTry)}
                        </strong>
                      </span>
                    )}
                  </div>
                )}

                <div className={s.formGrid2}>
                  <div className={clay.field}>
                    <label className={clay.fieldLabel}>İşlem Tarihi</label>
                    <div className={s.datePickerWrap}>
                      <ClinicalDatePicker
                        value={formDate}
                        onChange={(nextIso) => setFormDate(nextIso || todayIsoDate())}
                      />
                    </div>
                  </div>

                  <div className={clay.field}>
                    <label className={clay.fieldLabel}>Ödeme Yöntemi</label>
                    <select
                      value={formMethod}
                      onChange={(e) => setFormMethod(e.target.value)}
                      className={clay.wellSelect}
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={s.formGrid2}>
                  <div className={clay.field}>
                    <label className={clay.fieldLabel}>
                      {entryType === 'income' ? 'Tahsilat Durumu' : 'Ödeme Durumu'}
                    </label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as EntryPaymentStatus)}
                      className={clay.wellSelect}
                    >
                      <option value="completed">Tamamlandı / Ödendi</option>
                      <option value="partial">Kısmi Ödendi</option>
                      <option value="pending">
                        {entryType === 'income'
                          ? 'Bekliyor / Vadeli Alacak'
                          : 'Bekliyor / Vadeli Borç'}
                      </option>
                    </select>
                  </div>

                  {formStatus === 'pending' || formStatus === 'partial' ? (
                    <div className={clay.field}>
                      <label className={clay.fieldLabel}>Planlanan Vade Tarihi</label>
                      <div className={s.datePickerWrap}>
                        <ClinicalDatePicker
                          value={formDueDate}
                          onChange={(nextIso) => setFormDueDate(nextIso)}
                          placeholder="Vade tarihi seçiniz"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className={clay.field}>
                      <label className={clay.fieldLabel}>Belge Türü</label>
                      <select
                        value={formDocumentType}
                        onChange={(e) => setFormDocumentType(e.target.value)}
                        className={clay.wellSelect}
                      >
                        {DOCUMENT_TYPES.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Belge & Ön Muhasebe Bilgileri (İsteğe Bağlı Açılır Bölüm) */}
                <button
                  type="button"
                  onClick={() => setShowAccountingDetails((prev) => !prev)}
                  className={s.accountingToggleBtn}
                  aria-expanded={showAccountingDetails}
                >
                  <span className={s.accountingToggleLeft}>
                    <FileSpreadsheet size={14} />
                    <span>Belge &amp; Ön Muhasebe Bilgileri (İsteğe Bağlı)</span>
                  </span>
                  {showAccountingDetails ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>

                {showAccountingDetails && (
                  <div className={s.accountingPanel}>
                    {(formStatus === 'pending' || formStatus === 'partial') && (
                      <div className={clay.field}>
                        <label className={clay.fieldLabel}>Belge Türü</label>
                        <select
                          value={formDocumentType}
                          onChange={(e) => setFormDocumentType(e.target.value)}
                          className={clay.wellSelect}
                        >
                          {DOCUMENT_TYPES.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className={s.formGrid2}>
                      <div className={clay.field}>
                        <label className={clay.fieldLabel}>Belge / Fatura No</label>
                        <input
                          type="text"
                          value={formDocumentNumber}
                          onChange={(e) => setFormDocumentNumber(e.target.value)}
                          placeholder="Örn: GIB2026000000001"
                          className={clay.wellInput}
                        />
                      </div>

                      <div className={clay.field}>
                        <label className={clay.fieldLabel}>VKN / TCKN</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={11}
                          value={formCounterpartyTaxId}
                          onChange={(e) =>
                            setFormCounterpartyTaxId(e.target.value.replace(/\D/g, '').slice(0, 11))
                          }
                          placeholder="10 haneli VKN veya 11 haneli TCKN"
                          className={clay.wellInput}
                        />
                        {hasInvalidTaxLength && (
                          <span className={s.taxHintWarn}>
                            VKN 10, TCKN 11 haneli olmalıdır
                          </span>
                        )}
                      </div>
                    </div>

                    <div className={clay.field}>
                      <label className={clay.fieldLabel}>KDV Hesaplama</label>
                      <select
                        value={formVatIncluded ? 'included' : 'excluded'}
                        onChange={(e) => setFormVatIncluded(e.target.value === 'included')}
                        className={clay.wellSelect}
                      >
                        <option value="included">Girilen Tutar KDV Dahil</option>
                        <option value="excluded">Girilen Tutar KDV Hariç</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className={clay.field}>
                  <label className={clay.fieldLabel}>Not (İsteğe Bağlı)</label>
                  <input
                    type="text"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Ek açıklama veya referans bilgisi…"
                    className={clay.wellInput}
                  />
                </div>

                <div className={s.modalFooter}>
                  <button
                    type="button"
                    onClick={() => setQuickModalOpen(false)}
                    className={clay.ctlBtn}
                  >
                    <span>Vazgeç</span>
                  </button>
                  <button type="submit" disabled={savingEntry} className={clay.primaryBtn}>
                    <Check size={15} color="#ffffff" />
                    <span>{savingEntry ? 'Kaydediliyor…' : 'Kaydet'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
