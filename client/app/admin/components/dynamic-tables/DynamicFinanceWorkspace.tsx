'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CreditCard,
  DownloadCloud,
  Layers,
  Plus,
  Sparkles,
  TrendingUp,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import InfoTooltip from '../ui/InfoTooltip'
import DynamicDataGridPanel from './DynamicDataGridPanel'
import styles from './DynamicTablesStudio.module.css'
import ClinicalDatePicker from './ui/ClinicalDatePicker'
import {
  formatCurrencyTR,
  type DynamicModuleRole,
  type DynamicTableDef,
  type StudioSchemaResponse,
} from './types'

type FinancePeriod = 'daily' | 'weekly' | 'monthly'

type FinanceStarterPackKey =
  | 'general_finance'
  | 'real_estate_finance'
  | 'insurance_finance'
  | 'clinic_finance'

interface FinanceOverviewResponse {
  hasFinanceTables: boolean
  incomeTableIds: string[]
  expenseTableIds: string[]
  moduleTables: Array<{
    tableId: string
    tableName: string
    moduleRole: DynamicModuleRole
    isAutoDetected: boolean
  }>
  kpis: {
    totalIncome: number
    completedIncome: number
    completedCount: number
    pendingIncome: number
    pendingCount: number
    cancelledIncome: number
    totalExpense: number
    expenseCount: number
    netCashflow: number
    monthIncome: number
    monthExpense: number
    monthNetCashflow: number
    activeMonth: string
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

const FINANCE_STARTER_PACKS: Array<{
  key: FinanceStarterPackKey
  badge: string
  title: string
  subtitle: string
}> = [
  {
    key: 'general_finance',
    badge: 'Genel İşletme',
    title: 'Tahsilatlar & İşletme Giderleri',
    subtitle: 'Her sektöre uyumlu tahsilat, vadeli alacak ve gider tablolarını kurar.',
  },
  {
    key: 'clinic_finance',
    badge: 'Klinik & Sağlık',
    title: 'Hasta Tahsilatları & Klinik Giderleri',
    subtitle: 'Hasta ve tedavi bağlantılı tahsilat ile malzeme/bakım giderlerini kurar.',
  },
  {
    key: 'real_estate_finance',
    badge: 'Emlak & Gayrimenkul',
    title: 'Komisyon Tahsilatları & Ofis Giderleri',
    subtitle: 'Portföy ilanı ve müşteri bağlantılı hizmet bedeli ile ilan giderlerini kurar.',
  },
  {
    key: 'insurance_finance',
    badge: 'Sigorta Acentesi',
    title: 'Prim Tahsilatları & Acente Giderleri',
    subtitle: 'Sigortalı ve poliçe teklifi bağlantılı prim tahsilatı ve gider tablolarını kurar.',
  },
]

const PAYMENT_METHODS = ['Nakit', 'Kredi Kartı', 'Havale / EFT', 'Sigorta / Kurum']

const EXPENSE_CATEGORIES = [
  { id: 'stok_malzeme', label: 'Stok & Malzeme Alımı' },
  { id: 'bakim_onarim', label: 'Cihaz & Periyodik Bakım' },
  { id: 'kira_aidat', label: 'Kira, Aidat & Fatura' },
  { id: 'pazarlama', label: 'İlan & Pazarlama' },
  { id: 'personel', label: 'Personel & Prim' },
  { id: 'vergi_resmi', label: 'Vergi & Resmi Gider' },
  { id: 'diger', label: 'Diğer Giderler' },
]

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
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [focusedDetailRowId, setFocusedDetailRowId] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [gridExternalSearch, setGridExternalSearch] = useState<string | undefined>(undefined)

  const [applyingPack, setApplyingPack] = useState<string | null>(null)
  const [migratingLegacy, setMigratingLegacy] = useState(false)
  const [bindTableId, setBindTableId] = useState('')
  const [bindRole, setBindRole] = useState<'finance_income' | 'finance_expense'>('finance_income')
  const [bindingExisting, setBindingExisting] = useState(false)

  // Quick Finance Entry Modal (460px Clay/Neo)
  const [quickModalOpen, setQuickModalOpen] = useState(false)
  const [entryType, setEntryType] = useState<'income' | 'expense'>('income')
  const [formTitle, setFormTitle] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formQuantity, setFormQuantity] = useState('1')
  const [formDate, setFormDate] = useState<string>(todayIsoDate)
  const [formDueDate, setFormDueDate] = useState<string | null>(null)
  const [formStatus, setFormStatus] = useState<'completed' | 'pending'>('completed')
  const [formMethod, setFormMethod] = useState('Nakit')
  const [formCategory, setFormCategory] = useState('diger')
  const [formPersonRowId, setFormPersonRowId] = useState('')
  const [formServiceRowIds, setFormServiceRowIds] = useState<string[]>([])
  const [formNotes, setFormNotes] = useState('')
  const [savingEntry, setSavingEntry] = useState(false)

  const loadAll = useCallback(
    async (activePeriod: FinancePeriod = period) => {
      try {
        const [schemaRes, overviewRes] = await Promise.all([
          fetch('/api/dynamic-tables/schema', { credentials: 'include' }),
          fetch(`/api/dynamic-tables/finance/overview?period=${activePeriod}`, {
            credentials: 'include',
          }),
        ])
        const [schemaData, overviewData] = await Promise.all([
          schemaRes.json().catch(() => null),
          overviewRes.json().catch(() => null),
        ])

        if (schemaRes.ok && schemaData) {
          setSchema(schemaData)
        }
        if (overviewRes.ok && overviewData) {
          setOverview(overviewData)
          const modIds: string[] = (overviewData.moduleTables || []).map((m: any) => m.tableId)
          setSelectedTableId((curr) => {
            if (curr && modIds.includes(curr)) return curr
            return modIds[0] || null
          })
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
    setRefreshToken((n) => n + 1)
  }, [loadAll, period])

  const financeTables = useMemo<DynamicTableDef[]>(() => {
    if (!schema || !overview) return []
    const allowedIds = new Set(overview.moduleTables.map((m) => m.tableId))
    return schema.tables.filter((t) => allowedIds.has(t.id))
  }, [schema, overview])

  const unboundCandidateTables = useMemo<DynamicTableDef[]>(() => {
    if (!schema || !overview) return []
    const bound = new Set(overview.moduleTables.map((m) => m.tableId))
    return schema.tables.filter((t) => !bound.has(t.id))
  }, [schema, overview])

  const openQuickModal = (
    mode: 'income' | 'expense',
    prefill?: { personRowId?: string; personName?: string; pendingAmount?: number }
  ) => {
    setEntryType(mode)
    setFormDate(todayIsoDate())
    setFormDueDate(null)
    setFormStatus('completed')
    setFormMethod('Nakit')
    setFormCategory(mode === 'expense' ? 'kira_aidat' : 'diger')
    setFormQuantity('1')
    setFormServiceRowIds([])
    setFormNotes('')
    if (prefill?.personRowId) {
      setFormPersonRowId(prefill.personRowId)
      setFormTitle(prefill.personName ? `${prefill.personName} — Tahsilat` : '')
      setFormAmount(prefill.pendingAmount && prefill.pendingAmount > 0 ? String(prefill.pendingAmount) : '')
    } else {
      setFormPersonRowId('')
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
      const suggestedSum = selectedObjects.reduce((acc, s) => acc + (s.suggestedAmount || 0), 0)
      if (suggestedSum > 0) {
        setFormAmount(String(suggestedSum))
      }
      if (!formTitle.trim() && selectedObjects.length > 0) {
        setFormTitle(selectedObjects.map((s) => s.displayTitle).join(', '))
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

    const personName =
      overview?.quickEntryRelations.personTable?.rows.find((r) => r.id === formPersonRowId)
        ?.displayTitle || ''
    const resolvedTitle =
      formTitle.trim() ||
      (entryType === 'income'
        ? personName
          ? `${personName} — Tahsilat`
          : 'Tahsilat Kaydı'
        : EXPENSE_CATEGORIES.find((c) => c.id === formCategory)?.label || 'Gider Kaydı')

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
          quantity: entryType === 'expense' ? Math.max(1, Number(formQuantity) || 1) : 1,
          date: formDate || todayIsoDate(),
          dueDate: entryType === 'income' && formStatus === 'pending' ? formDueDate : null,
          status: entryType === 'income' ? formStatus : 'completed',
          method: entryType === 'income' ? formMethod : undefined,
          category: entryType === 'expense' ? formCategory : undefined,
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
          ? 'Tahsilat kaydı dinamik tabloya eklendi'
          : 'Gider kaydı dinamik tabloya eklendi'
      )
      setQuickModalOpen(false)
      if (data.tableId) {
        setSelectedTableId(data.tableId)
      }
      triggerRefresh()
    } catch {
      toast.error('Kayıt sırasında ağ hatası oluştu')
    } finally {
      setSavingEntry(false)
    }
  }

  const handleApplyStarterPack = async (pack: FinanceStarterPackKey) => {
    setApplyingPack(pack)
    try {
      const res = await fetch('/api/dynamic-tables/module-starter-pack', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Finans tabloları kurulamadı')
        return
      }
      toast.success('Gelir ve gider dinamik tabloları örnek verilerle kuruldu!')
      triggerRefresh()
    } catch {
      toast.error('Paket kurulurken hata oluştu')
    } finally {
      setApplyingPack(null)
    }
  }

  const handleBindExistingTable = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!bindTableId) {
      toast.error('Lütfen bağlanacak tabloyu seçiniz')
      return
    }
    setBindingExisting(true)
    try {
      const res = await fetch(`/api/dynamic-tables/module-configs/${bindTableId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleRole: bindRole, enabled: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Tablo bağlanamadı')
        return
      }
      toast.success('Tablo finans modülüne bağlandı')
      setBindTableId('')
      setSelectedTableId(bindTableId)
      triggerRefresh()
    } catch {
      toast.error('Tablo bağlanırken hata oluştu')
    } finally {
      setBindingExisting(false)
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
        `${data.importedIncomeCount || 0} tahsilat ve ${data.importedExpenseCount || 0} gider kaydı dinamik tablolara aktarıldı`
      )
      triggerRefresh()
    } catch {
      toast.error('Aktarım sırasında hata oluştu')
    } finally {
      setMigratingLegacy(false)
    }
  }

  const handleNavigateToRow = useCallback(
    (targetTableId: string, targetRowId: string) => {
      if (financeTables.some((t) => t.id === targetTableId)) {
        setSelectedTableId(targetTableId)
        setFocusedDetailRowId(targetRowId)
      } else {
        toast('İlgili kayıt Veri Tabloları sekmesindeki bağlı listede yer alıyor.')
      }
    },
    [financeTables]
  )

  if (loading && !overview) {
    return (
      <div className={depth.card} style={{ padding: 36, textAlign: 'center', color: 'var(--pc-muted)' }}>
        Ödemeler ve finans verileri yükleniyor…
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
    cancelledIncome: 0,
    totalExpense: 0,
    expenseCount: 0,
    netCashflow: 0,
    monthIncome: 0,
    monthExpense: 0,
    monthNetCashflow: 0,
    activeMonth: '',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
      {/* Üst Başlık ve Hızlı İşlem Çubuğu */}
      <div
        className={depth.card}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '13px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              background: 'var(--pc-tint)',
              border: '1px solid var(--pc-border)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Wallet size={18} style={{ color: 'var(--pc-tint-fg)' }} />
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--foreground)' }}>
              Ödemeler &amp; Finans
            </h2>
            <InfoTooltip title="Dinamik Finans & Otomatik Maliyet Akışı">
              Tahsilat, vadeli alacak ve giderleriniz tamamen özelleştirilebilir dinamik tablolarda tutulur. Stok alımı, tedarikçi iadesi ve ücretli periyodik bakım işlemleri gider tablosuna otomatik yansır; dilerseniz alttaki tablolara dilediğiniz özel sütunu ekleyebilirsiniz.
            </InfoTooltip>
            {financeTables.length > 0 && (
              <span className={depth.badge}>
                <Layers size={11} />
                <span>{financeTables.length} Dinamik Tablo</span>
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => openQuickModal('expense')}
            className={depth.btnPale}
            style={{ minHeight: 34, padding: '6px 13px', fontSize: 12.5 }}
          >
            <ArrowDownRight size={15} />
            <span>+ Gider / Masraf Ekle</span>
          </button>
          <button
            type="button"
            onClick={() => openQuickModal('income')}
            className={depth.btnPrimary}
            style={{ minHeight: 34, padding: '6px 14px', fontSize: 12.5 }}
          >
            <Plus size={15} color="#ffffff" />
            <span style={{ color: '#ffffff' }}>Tahsilat / Gelir Ekle</span>
          </button>
        </div>
      </div>

      {/* Eski Sabit Tablolardan Tek Tıkla Aktarım Banner'ı */}
      {overview?.legacyMigration.hasUnmigratedLegacyFinance && canManageSchema && (
        <div
          className={depth.subcard}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            padding: '10px 14px',
            background: 'var(--pc-tint)',
            border: '1.5px solid var(--pc-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <DownloadCloud size={16} style={{ color: 'var(--pc-tint-fg)', flexShrink: 0 }} />
            <span style={{ color: 'var(--foreground)', fontWeight: 600 }}>
              Önceki sabit kayıtlarda{' '}
              <strong>{overview.legacyMigration.unmigratedPayments} ödeme</strong> ve{' '}
              <strong>{overview.legacyMigration.unmigratedExpenses} gider</strong> bulundu. Tek tıkla dinamik tablolara aktarabilirsiniz.
            </span>
          </div>
          <button
            type="button"
            disabled={migratingLegacy}
            onClick={() => void handleMigrateLegacy()}
            className={depth.btnMint}
            style={{ minHeight: 31, padding: '4px 12px', fontSize: 12 }}
          >
            <DownloadCloud size={13} />
            <span>{migratingLegacy ? 'Aktarılıyor…' : 'Mevcut Kayıtları Aktar'}</span>
          </button>
        </div>
      )}

      {/* Sıfır Finans Tablosu Başlangıç Durumu */}
      {!overview?.hasFinanceTables && (
        <div className={depth.card} style={{ padding: '18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Sparkles size={18} style={{ color: 'var(--pc-blue)', flexShrink: 0 }} />
            <div>
              <strong style={{ fontSize: 14, color: 'var(--foreground)' }}>
                Sektörünüze Uygun Dinamik Finans Tablolarını Tek Tıkla Kurun
              </strong>
              <div style={{ fontSize: 12.5, color: 'var(--pc-muted)' }}>
                Kurulan tablolar mevcut müşteri ve hizmet/ilan/teklif/tedavi listelerinizle otomatik ilişkilendirilir.
              </div>
            </div>
          </div>

          {canManageSchema ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
                  gap: 10,
                }}
              >
                {FINANCE_STARTER_PACKS.map((pk, idx) => (
                  <div
                    key={pk.key}
                    className={depth.subcard}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '12px 13px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span className={depth.badge} style={{ fontSize: 10, padding: '1px 7px' }}>
                          {pk.badge}
                        </span>
                        <strong style={{ fontSize: 12.5 }}>{pk.title}</strong>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--pc-muted)', marginTop: 4 }}>
                        {pk.subtitle}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={applyingPack !== null}
                      onClick={() => void handleApplyStarterPack(pk.key)}
                      className={idx === 0 ? depth.btnPrimary : depth.btnPale}
                      style={{ minHeight: 30, fontSize: 12, width: '100%' }}
                    >
                      <span style={idx === 0 ? { color: '#ffffff' } : undefined}>
                        {applyingPack === pk.key ? 'Kuruluyor…' : 'Tek Tıkla Kur'}
                      </span>
                    </button>
                  </div>
                ))}
              </div>

              {unboundCandidateTables.length > 0 && (
                <form
                  onSubmit={handleBindExistingTable}
                  className={depth.subcard}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground-2)' }}>
                    Veya mevcut bir tablonuzu doğrudan bağlayın:
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <select
                      value={bindTableId}
                      onChange={(e) => setBindTableId(e.target.value)}
                      className={depth.input}
                      style={{ width: 210, minHeight: 31, fontSize: 12 }}
                    >
                      <option value="">Tablo seçiniz…</option>
                      {unboundCandidateTables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={bindRole}
                      onChange={(e) => setBindRole(e.target.value as 'finance_income' | 'finance_expense')}
                      className={depth.input}
                      style={{ width: 185, minHeight: 31, fontSize: 12 }}
                    >
                      <option value="finance_income">Gelir &amp; Tahsilat Tablosu</option>
                      <option value="finance_expense">Gider &amp; Masraf Tablosu</option>
                    </select>
                    <button
                      type="submit"
                      disabled={bindingExisting}
                      className={depth.btn}
                      style={{ minHeight: 31, fontSize: 12 }}
                    >
                      <span>{bindingExisting ? 'Bağlanıyor…' : 'Tabloyu Bağla'}</span>
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--pc-muted)' }}>
              Henüz finans tablosu tanımlanmamış. Üstteki <strong>Tahsilat / Gelir Ekle</strong> butonunu kullandığınızda tablo otomatik oluşturulur.
            </div>
          )}
        </div>
      )}

      {/* 4 Canlı KPI Özeti */}
      {overview?.hasFinanceTables && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 215px), 1fr))',
              gap: 12,
            }}
          >
            <div className={depth.card} style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--pc-muted)' }}>
                  Toplam Tahsilat
                </span>
                <span className={depth.badge} style={{ fontSize: 10.5 }}>
                  {kpis.completedCount} Kayıt
                </span>
              </div>
              <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--success, #15803d)' }}>
                {formatCurrencyTR(kpis.completedIncome)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--pc-muted)' }}>
                Bu ay tahsil edilen: <strong>{formatCurrencyTR(kpis.monthIncome)}</strong>
              </div>
            </div>

            <div className={depth.card} style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--pc-muted)' }}>
                  Bekleyen / Vadeli Alacak
                </span>
                <span className={depth.badge} style={{ fontSize: 10.5 }}>
                  {kpis.pendingCount} Bekleyen
                </span>
              </div>
              <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--pc-tint-fg)' }}>
                {formatCurrencyTR(kpis.pendingIncome)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--pc-muted)' }}>
                Durumu &ldquo;Bekliyor&rdquo; olan açık tahsilatlar
              </div>
            </div>

            <div className={depth.card} style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--pc-muted)' }}>
                  Toplam Gider (Stok &amp; Bakım Dahil)
                </span>
                <span className={depth.badge} style={{ fontSize: 10.5 }}>
                  {kpis.expenseCount} Kalem
                </span>
              </div>
              <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--danger)' }}>
                {formatCurrencyTR(kpis.totalExpense)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--pc-muted)' }}>
                Bu ay gider: <strong>{formatCurrencyTR(kpis.monthExpense)}</strong>
              </div>
            </div>

            <div
              className={depth.card}
              style={{
                padding: '13px 15px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                background: 'var(--pc-total-bg, var(--pc-tint))',
                boxShadow: 'var(--pc-clay-total, var(--pc-neo-card))',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--pc-tint-fg)' }}>
                  Net Nakit Akışı
                </span>
                <TrendingUp size={15} style={{ color: 'var(--pc-tint-fg)' }} />
              </div>
              <div
                style={{
                  fontSize: 21,
                  fontWeight: 800,
                  color: kpis.netCashflow >= 0 ? 'var(--pc-tint-fg)' : 'var(--danger)',
                }}
              >
                {formatCurrencyTR(kpis.netCashflow)}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--foreground-2)' }}>
                Bu ay net: <strong>{formatCurrencyTR(kpis.monthNetCashflow)}</strong>
              </div>
            </div>
          </div>

          {/* Grafik + Kişi / Cari Bazlı Tahsilat Özeti */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
              gap: 12,
              alignItems: 'stretch',
            }}
          >
            {/* Gelir & Gider Grafiği */}
            <div className={depth.card} style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <ArrowUpRight size={16} style={{ color: 'var(--pc-blue)' }} />
                  <strong style={{ fontSize: 13.5, color: 'var(--foreground)' }}>
                    Gelir &amp; Gider Grafiği
                  </strong>
                </div>

                <div className={depth.segmentTrack}>
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
                      onClick={() => setPeriod(p.id)}
                      className={`${depth.segment} ${period === p.id ? depth.segmentActive : ''}`}
                      style={{ fontSize: 11.5, padding: '3px 10px', minHeight: 26 }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ width: '100%', height: 225 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={overview.chartData}
                    margin={{ top: 8, right: 12, left: 4, bottom: 2 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--pc-border)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: 'var(--foreground-2)' }}
                      stroke="var(--pc-border)"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'var(--foreground-2)' }}
                      stroke="var(--pc-border)"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--card-bg)',
                        border: '1.5px solid var(--input-border)',
                        borderRadius: 10,
                        boxShadow: 'var(--pc-modal-shadow)',
                        color: 'var(--foreground)',
                        fontSize: 12,
                      }}
                      formatter={(val: any) => `${Number(val || 0).toLocaleString('tr-TR')} ₺`}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="gelir" name="Gelir / Tahsilat" fill="#0284c7" radius={[5, 5, 0, 0]} />
                    <Bar dataKey="gider" name="Gider / Maliyet" fill="#dc2626" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Kişi / Müşteri / Cari Bazlı Tahsilat ve Alacak Özeti */}
            <div className={depth.card} style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <UserCheck size={16} style={{ color: 'var(--pc-blue)' }} />
                  <strong style={{ fontSize: 13.5, color: 'var(--foreground)' }}>
                    Kişi / Cari Bazlı Tahsilat Özeti
                  </strong>
                </div>
                {gridExternalSearch && (
                  <button
                    type="button"
                    onClick={() => setGridExternalSearch('')}
                    className={depth.btn}
                    style={{ minHeight: 25, padding: '2px 8px', fontSize: 11 }}
                  >
                    <X size={11} />
                    <span>Filtreyi Temizle</span>
                  </button>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                  maxHeight: 225,
                  overflowY: 'auto',
                  paddingRight: 2,
                }}
              >
                {overview.personGroups.length === 0 ? (
                  <div
                    style={{
                      padding: '24px 12px',
                      textAlign: 'center',
                      color: 'var(--pc-muted)',
                      fontSize: 12.5,
                    }}
                  >
                    Henüz tahsilat kaydı bulunmuyor.
                  </div>
                ) : (
                  overview.personGroups.slice(0, 12).map((pg) => {
                    const isFiltered = gridExternalSearch === pg.personName
                    return (
                      <div
                        key={pg.key}
                        onClick={() => {
                          const incId = overview.incomeTableIds[0]
                          if (incId) setSelectedTableId(incId)
                          setGridExternalSearch((prev) =>
                            prev === pg.personName ? '' : pg.personName
                          )
                        }}
                        className={depth.subcard}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '8px 11px',
                          cursor: 'pointer',
                          border: isFiltered
                            ? '1.5px solid var(--pc-blue)'
                            : '1px solid var(--pc-border)',
                          background: isFiltered ? 'var(--pc-tint)' : undefined,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 12.5,
                              fontWeight: 700,
                              color: 'var(--foreground)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {pg.personName}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--pc-muted)', marginTop: 1 }}>
                            Ödenen: <strong>{formatCurrencyTR(pg.paidTotal)}</strong>
                            {pg.pendingTotal > 0 && (
                              <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                                {' '}
                                • Bekleyen: {formatCurrencyTR(pg.pendingTotal)}
                              </span>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openQuickModal('income', {
                              personRowId: pg.personRowId || undefined,
                              personName: pg.personName,
                              pendingAmount: pg.pendingTotal > 0 ? pg.pendingTotal : undefined,
                            })
                          }}
                          className={depth.btnPale}
                          style={{ minHeight: 27, padding: '2px 9px', fontSize: 11, flexShrink: 0 }}
                        >
                          <CreditCard size={12} />
                          <span>Tahsilat Al</span>
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>

          {/* Alt Bölüm: Tam Özelleştirilebilir Dinamik Finans Tabloları */}
          {schema && financeTables.length > 0 && (
            <div className={styles.mainTableCard}>
              <DynamicDataGridPanel
                tables={financeTables}
                allTables={schema.tables}
                relations={schema.relations}
                appointmentConfigs={schema.appointmentConfigs}
                moduleConfigs={schema.moduleConfigs}
                defaultNewTableModuleRole="finance_income"
                externalSearch={gridExternalSearch}
                selectedTableId={selectedTableId}
                canManageSchema={canManageSchema}
                refreshToken={refreshToken}
                focusedDetailRowId={focusedDetailRowId}
                onChangeFocusedDetailRowId={setFocusedDetailRowId}
                onSelectTable={(tid) => {
                  setSelectedTableId(tid)
                  setGridExternalSearch(undefined)
                }}
                onTableCreated={(newId) => {
                  setSelectedTableId(newId)
                  triggerRefresh()
                }}
                onDataMutated={triggerRefresh}
                onNavigateToRow={handleNavigateToRow}
              />
            </div>
          )}
        </>
      )}

      {/* 460px Clay/Neo Hızlı Tahsilat & Gider Modalı */}
      {quickModalOpen && (
        <div
          className={depth.backdrop}
          onClick={() => setQuickModalOpen(false)}
        >
          <div
            className={depth.modal}
            onClick={(e) => e.stopPropagation()}
            style={{ padding: '16px 18px' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 12,
              }}
            >
              <strong style={{ fontSize: 14.5, color: 'var(--foreground)' }}>
                {entryType === 'income' ? 'Yeni Tahsilat / Gelir Ekle' : 'Yeni Gider / Masraf Ekle'}
              </strong>
              <button
                type="button"
                onClick={() => setQuickModalOpen(false)}
                className={depth.btn}
                style={{ minHeight: 28, padding: '3px 8px' }}
              >
                <X size={14} />
              </button>
            </div>

            <div className={depth.segmentTrack} style={{ width: '100%', marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setEntryType('income')}
                className={`${depth.segment} ${entryType === 'income' ? depth.segmentActive : ''}`}
                style={{ flex: 1, fontSize: 12 }}
              >
                Tahsilat / Gelir
              </button>
              <button
                type="button"
                onClick={() => setEntryType('expense')}
                className={`${depth.segment} ${entryType === 'expense' ? depth.segmentActive : ''}`}
                style={{ flex: 1, fontSize: 12 }}
              >
                Gider / Masraf
              </button>
            </div>

            <form onSubmit={handleSubmitQuickEntry} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {entryType === 'income' && overview?.quickEntryRelations.personTable && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                    {overview.quickEntryRelations.personTable.name} (İsteğe Bağlı)
                  </label>
                  <select
                    value={formPersonRowId}
                    onChange={(e) => {
                      const nextId = e.target.value
                      setFormPersonRowId(nextId)
                      const found = overview.quickEntryRelations.personTable?.rows.find(
                        (r) => r.id === nextId
                      )
                      if (found && !formTitle.trim()) {
                        setFormTitle(`${found.displayTitle} — Tahsilat`)
                      }
                    }}
                    className={depth.input}
                    style={{ minHeight: 34, fontSize: 12.5 }}
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                      İlgili {overview.quickEntryRelations.serviceTable.name} (Seçildiğinde Tutar Önerilir)
                    </label>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 5,
                        maxHeight: 92,
                        overflowY: 'auto',
                        padding: '6px 8px',
                        borderRadius: 9,
                        background: 'var(--input-bg)',
                        border: '1px solid var(--pc-border)',
                      }}
                    >
                      {overview.quickEntryRelations.serviceTable.rows.slice(0, 24).map((s) => {
                        const active = formServiceRowIds.includes(s.id)
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => handleToggleServiceRow(s.id)}
                            className={active ? depth.btnPrimary : depth.btn}
                            style={{ minHeight: 25, padding: '2px 8px', fontSize: 11 }}
                          >
                            <span style={active ? { color: '#ffffff' } : undefined}>
                              {s.displayTitle}
                              {s.suggestedAmount > 0
                                ? ` (${s.suggestedAmount.toLocaleString('tr-TR')} ₺)`
                                : ''}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                  {entryType === 'income' ? 'Tahsilat Açıklaması / Başlık' : 'Gider Kalemi / Başlık'}
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder={
                    entryType === 'income'
                      ? 'Örn: Peşinat Tahsilatı, Hizmet Bedeli, Komisyon…'
                      : 'Örn: Kira Ödemesi, Sarf Malzeme Alımı…'
                  }
                  className={depth.input}
                  style={{ minHeight: 34, fontSize: 12.5 }}
                />
              </div>

              {entryType === 'expense' && (
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                      Gider Kategorisi
                    </label>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className={depth.input}
                      style={{ minHeight: 34, fontSize: 12.5 }}
                    >
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                      Adet / Miktar
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={formQuantity}
                      onChange={(e) => setFormQuantity(e.target.value)}
                      className={depth.input}
                      style={{ minHeight: 34, fontSize: 12.5 }}
                    />
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                    Toplam Tutar (₺) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="0,00"
                    className={depth.input}
                    style={{ minHeight: 34, fontSize: 13, fontWeight: 700 }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                    İşlem Tarihi
                  </label>
                  <ClinicalDatePicker
                    value={formDate}
                    onChange={(nextIso) => setFormDate(nextIso || todayIsoDate())}
                  />
                </div>
              </div>

              {entryType === 'income' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                      Ödeme Yöntemi
                    </label>
                    <select
                      value={formMethod}
                      onChange={(e) => setFormMethod(e.target.value)}
                      className={depth.input}
                      style={{ minHeight: 34, fontSize: 12.5 }}
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                      Tahsilat Durumu
                    </label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as 'completed' | 'pending')}
                      className={depth.input}
                      style={{ minHeight: 34, fontSize: 12.5 }}
                    >
                      <option value="completed">Tamamlandı (Tahsil Edildi)</option>
                      <option value="pending">Bekliyor (Vadeli Alacak)</option>
                    </select>
                  </div>
                </div>
              )}

              {entryType === 'income' && formStatus === 'pending' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                    Planlanan Vade Tarihi
                  </label>
                  <ClinicalDatePicker
                    value={formDueDate}
                    onChange={(nextIso) => setFormDueDate(nextIso)}
                    placeholder="Vade tarihi seçiniz"
                  />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                  Not (İsteğe Bağlı)
                </label>
                <input
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Ek açıklama veya belge numarası…"
                  className={depth.input}
                  style={{ minHeight: 34, fontSize: 12.5 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setQuickModalOpen(false)}
                  className={depth.btn}
                  style={{ minHeight: 34, padding: '6px 14px', fontSize: 12.5 }}
                >
                  <span>Vazgeç</span>
                </button>
                <button
                  type="submit"
                  disabled={savingEntry}
                  className={depth.btnPrimary}
                  style={{ minHeight: 34, padding: '6px 16px', fontSize: 12.5 }}
                >
                  <Check size={15} color="#ffffff" />
                  <span style={{ color: '#ffffff' }}>
                    {savingEntry ? 'Kaydediliyor…' : 'Kaydet'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
