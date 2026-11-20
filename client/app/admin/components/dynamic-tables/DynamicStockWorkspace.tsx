'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Clock,
  DownloadCloud,
  Layers,
  Minus,
  Package,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Wrench,
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
  formatDynamicDateTR,
  type DynamicModuleMapping,
  type DynamicModuleRole,
  type DynamicTableDef,
  type StudioSchemaResponse,
} from './types'

type StockAlertFilter = 'all' | 'skt_expired' | 'skt_soon' | 'low_stock' | 'maintenance_due'
type StockStarterPackKey = 'general_stock' | 'clinic_stock' | 'service_parts_stock'

interface StockOverviewItem {
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

interface MaintenanceOverviewItem {
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

interface StockOverviewResponse {
  hasStockTables: boolean
  inventoryTableIds: string[]
  maintenanceTableIds: string[]
  movementTableIds: string[]
  allStockModuleTableIds: string[]
  moduleTables: Array<{
    tableId: string
    tableName: string
    moduleRole: DynamicModuleRole
    mapping: DynamicModuleMapping
    isAutoDetected: boolean
  }>
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
  recentMovements: Array<{
    rowId: string
    tableId: string
    title: string
    movementTypeLabel: string
    quantity: number
    totalAmount: number
    date: string
    actor: string | null
    itemTitle: string | null
  }>
  legacyMigration: {
    hasUnmigratedLegacyStock: boolean
    unmigratedItems: number
    unmigratedMaintenances: number
  }
}

const STOCK_STARTER_PACKS: Array<{
  key: StockStarterPackKey
  badge: string
  title: string
  subtitle: string
}> = [
  {
    key: 'general_stock',
    badge: 'Genel İşletme',
    title: 'Envanter, Demirbaş & Periyodik Bakımlar',
    subtitle: 'Her sektöre uyumlu ürün/malzeme stoku, periyodik bakım ve hareket geçmişini kurar.',
  },
  {
    key: 'clinic_stock',
    badge: 'Klinik & Sağlık',
    title: 'Sarf Malzeme Stoku & Cihaz Kalibrasyonları',
    subtitle: 'Son kullanma tarihli medikal malzemeler, kritik eşik ve cihaz bakımlarını kurar.',
  },
  {
    key: 'service_parts_stock',
    badge: 'Teknik Servis & Otomotiv',
    title: 'Yedek Parça Stoku & Ekipman Muayeneleri',
    subtitle: 'Parça envanteri, birim maliyet ve atölye ekipman periyodik bakımlarını kurar.',
  },
]

function todayIsoDate(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export default function DynamicStockWorkspace() {
  const [schema, setSchema] = useState<StudioSchemaResponse | null>(null)
  const [overview, setOverview] = useState<StockOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [alertFilter, setAlertFilter] = useState<StockAlertFilter>('all')
  const [quickSearch, setQuickSearch] = useState('')
  const [recordInFinance, setRecordInFinance] = useState(true)

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [focusedDetailRowId, setFocusedDetailRowId] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  // Per-row quick movement inputs
  const [qtyDraftByRow, setQtyDraftByRow] = useState<Record<string, string>>({})
  const [costDraftByRow, setCostDraftByRow] = useState<Record<string, string>>({})
  const [maintCostDraftByRow, setMaintCostDraftByRow] = useState<Record<string, string>>({})
  const [busyRowId, setBusyRowId] = useState<string | null>(null)

  const [applyingPack, setApplyingPack] = useState<string | null>(null)
  const [migratingLegacy, setMigratingLegacy] = useState(false)
  const [bindTableId, setBindTableId] = useState('')
  const [bindRole, setBindRole] = useState<
    'stock_inventory' | 'asset_maintenance' | 'stock_movement'
  >('stock_inventory')
  const [bindingExisting, setBindingExisting] = useState(false)

  // Quick Create Stock Item Modal (460px Clay/Neo)
  const [newItemModalOpen, setNewItemModalOpen] = useState(false)
  const [itemTitle, setItemTitle] = useState('')
  const [itemQty, setItemQty] = useState('10')
  const [itemMinThreshold, setItemMinThreshold] = useState('5')
  const [itemUnitCost, setItemUnitCost] = useState('')
  const [itemExpiryDate, setItemExpiryDate] = useState<string | null>(null)
  const [itemNotes, setItemNotes] = useState('')
  const [savingItem, setSavingItem] = useState(false)

  // Quick Create Maintenance Modal (460px Clay/Neo)
  const [newMaintModalOpen, setNewMaintModalOpen] = useState(false)
  const [maintTitle, setMaintTitle] = useState('')
  const [maintScheduledDate, setMaintScheduledDate] = useState<string>(todayIsoDate)
  const [maintIsPeriodic, setMaintIsPeriodic] = useState(true)
  const [maintPeriodicDays, setMaintPeriodicDays] = useState('180')
  const [maintCost, setMaintCost] = useState('')
  const [maintNotes, setMaintNotes] = useState('')
  const [savingMaint, setSavingMaint] = useState(false)

  const loadAll = useCallback(
    async (activeFilter: StockAlertFilter = alertFilter, searchVal: string = quickSearch) => {
      try {
        const qs = new URLSearchParams({ alertFilter: activeFilter })
        if (searchVal.trim()) qs.set('search', searchVal.trim())

        const [schemaRes, overviewRes] = await Promise.all([
          fetch('/api/dynamic-tables/schema', { credentials: 'include' }),
          fetch(`/api/dynamic-tables/stock/overview?${qs.toString()}`, {
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
          const modIds: string[] = overviewData.allStockModuleTableIds || []
          setSelectedTableId((curr) => {
            if (curr && modIds.includes(curr)) return curr
            return modIds[0] || null
          })
        }
      } catch {
        toast.error('Stok ve bakım verileri yüklenemedi')
      } finally {
        setLoading(false)
      }
    },
    [alertFilter, quickSearch]
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll(alertFilter, quickSearch)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [loadAll, alertFilter, quickSearch])

  const triggerRefresh = useCallback(() => {
    void loadAll(alertFilter, quickSearch)
    setRefreshToken((n) => n + 1)
  }, [loadAll, alertFilter, quickSearch])

  const stockTables = useMemo<DynamicTableDef[]>(() => {
    if (!schema || !overview) return []
    const allowed = new Set(overview.allStockModuleTableIds)
    return schema.tables.filter((t) => allowed.has(t.id))
  }, [schema, overview])

  const unboundCandidateTables = useMemo<DynamicTableDef[]>(() => {
    if (!schema || !overview) return []
    const bound = new Set(overview.allStockModuleTableIds)
    return schema.tables.filter((t) => !bound.has(t.id))
  }, [schema, overview])

  const handleMovement = async (
    item: StockOverviewItem,
    movementType: 'giris' | 'cikis' | 'fire' | 'imha' | 'iade'
  ) => {
    const qty = Math.max(1, Math.floor(Number(qtyDraftByRow[item.rowId] || '1') || 1))
    const rawCost = costDraftByRow[item.rowId]
    const unitCost =
      rawCost !== undefined && rawCost.trim() !== ''
        ? Number(rawCost.replace(',', '.'))
        : item.unitCost

    setBusyRowId(item.rowId)
    try {
      const res = await fetch('/api/dynamic-tables/stock/movement', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId: item.rowId,
          movementType,
          quantity: qty,
          unitCost: Number.isFinite(unitCost) ? unitCost : item.unitCost,
          recordInFinance,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Stok hareketi uygulanamadı')
        return
      }
      const financeNote = data.financeExpenseRow
        ? movementType === 'iade'
          ? ' (İade mahsubu Giderler tablosuna işlendi)'
          : ' (Alım tutarı Giderler tablosuna işlendi)'
        : ''
      toast.success(
        `${item.name} güncel stok: ${data.nextQuantity} ${item.unitLabel}${financeNote}`
      )
      setQtyDraftByRow((prev) => ({ ...prev, [item.rowId]: '1' }))
      triggerRefresh()
    } catch {
      toast.error('Stok hareketi kaydedilemedi')
    } finally {
      setBusyRowId(null)
    }
  }

  const handleCompleteMaintenance = async (maint: MaintenanceOverviewItem) => {
    const rawCost = maintCostDraftByRow[maint.rowId]
    const cost =
      rawCost !== undefined && rawCost.trim() !== ''
        ? Number(rawCost.replace(',', '.'))
        : maint.estimatedCost

    setBusyRowId(maint.rowId)
    try {
      const res = await fetch('/api/dynamic-tables/stock/complete-maintenance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId: maint.rowId,
          cost: Number.isFinite(cost) ? cost : maint.estimatedCost,
          recordInFinance,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Bakım tamamlanamadı')
        return
      }
      toast.success(
        data.computedNextDate
          ? `${maint.name} bakımı tamamlandı! Sonraki bakım: ${formatDynamicDateTR(data.computedNextDate)}`
          : `${maint.name} bakımı tamamlandı`
      )
      triggerRefresh()
    } catch {
      toast.error('Bakım kaydı güncellenemedi')
    } finally {
      setBusyRowId(null)
    }
  }

  const handleCreateQuickStockItem = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = itemTitle.trim()
    if (!clean) {
      toast.error('Lütfen malzeme veya ürün adını yazınız')
      return
    }
    const targetMod = overview?.moduleTables.find((m) => m.moduleRole === 'stock_inventory')
    const targetTable = schema?.tables.find((t) => t.id === targetMod?.tableId)
    if (!targetMod || !targetTable) {
      toast.error('Önce bir stok başlangıç paketi kurunuz')
      return
    }

    const primaryCol =
      targetTable.columns.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation') ||
      targetTable.columns.find((c) => c.fieldType === 'text')
    const m = targetMod.mapping
    const qty = Math.max(0, Math.floor(Number(itemQty) || 0))
    const minTh = Math.max(0, Math.floor(Number(itemMinThreshold) || 0))
    const uCost = Math.max(0, Number(String(itemUnitCost).replace(',', '.')) || 0)

    const values: Record<string, unknown> = {}
    if (primaryCol) values[primaryCol.id] = clean
    if (m.quantityColumnId) values[m.quantityColumnId] = qty
    if (m.minThresholdColumnId) values[m.minThresholdColumnId] = minTh
    if (m.unitCostColumnId) values[m.unitCostColumnId] = uCost
    if (m.expiryDateColumnId && itemExpiryDate) values[m.expiryDateColumnId] = itemExpiryDate
    if (m.notesColumnId && itemNotes.trim()) values[m.notesColumnId] = itemNotes.trim()

    setSavingItem(true)
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${targetTable.id}/rows`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      const created = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(created.error || 'Stok kalemi eklenemedi')
        return
      }

      if (recordInFinance && qty > 0 && uCost > 0) {
        await fetch('/api/dynamic-tables/finance/quick-entry', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entryType: 'expense',
            title: `İlk Stok Girişi: ${clean}`,
            amount: Math.round(qty * uCost * 100) / 100,
            quantity: qty,
            unitCost: uCost,
            date: todayIsoDate(),
            category: 'stok_malzeme',
            itemRowId: created.id,
          }),
        }).catch(() => {})
      }

      toast.success(`"${clean}" dinamik stok tablosuna eklendi`)
      setNewItemModalOpen(false)
      setItemTitle('')
      setItemUnitCost('')
      setItemExpiryDate(null)
      setItemNotes('')
      setSelectedTableId(targetTable.id)
      triggerRefresh()
    } catch {
      toast.error('Stok kalemi kaydedilemedi')
    } finally {
      setSavingItem(false)
    }
  }

  const handleCreateQuickMaintenance = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = maintTitle.trim()
    if (!clean) {
      toast.error('Lütfen cihaz veya ekipman adını yazınız')
      return
    }
    const targetMod = overview?.moduleTables.find((m) => m.moduleRole === 'asset_maintenance')
    const targetTable = schema?.tables.find((t) => t.id === targetMod?.tableId)
    if (!targetMod || !targetTable) {
      toast.error('Periyodik bakım tablosu bulunamadı. Tablo Özelliklerinden bakım tablosu bağlayabilirsiniz.')
      return
    }

    const primaryCol =
      targetTable.columns.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation') ||
      targetTable.columns.find((c) => c.fieldType === 'text')
    const m = targetMod.mapping
    const pDays = Math.max(1, Math.floor(Number(maintPeriodicDays) || 180))
    const estCost = Math.max(0, Number(String(maintCost).replace(',', '.')) || 0)

    const values: Record<string, unknown> = {}
    if (primaryCol) values[primaryCol.id] = clean
    if (m.scheduledDateColumnId) values[m.scheduledDateColumnId] = maintScheduledDate
    if (m.isPeriodicColumnId) values[m.isPeriodicColumnId] = maintIsPeriodic
    if (m.periodicDaysColumnId && maintIsPeriodic) values[m.periodicDaysColumnId] = pDays
    if (m.amountColumnId && estCost > 0) values[m.amountColumnId] = estCost
    if (m.notesColumnId && maintNotes.trim()) values[m.notesColumnId] = maintNotes.trim()
    if (m.statusColumnId) {
      const stCol = targetTable.columns.find((c) => c.id === m.statusColumnId)
      const plannedOpt = stCol?.config?.options?.find((o) =>
        /(planlan|bekliyor|scheduled)/i.test(`${o.id} ${o.label}`)
      )
      values[m.statusColumnId] = plannedOpt ? plannedOpt.id : 'Planlandı'
    }

    setSavingMaint(true)
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${targetTable.id}/rows`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      const created = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(created.error || 'Bakım planı eklenemedi')
        return
      }
      toast.success(`"${clean}" periyodik bakım takvimine eklendi`)
      setNewMaintModalOpen(false)
      setMaintTitle('')
      setMaintCost('')
      setMaintNotes('')
      setSelectedTableId(targetTable.id)
      triggerRefresh()
    } catch {
      toast.error('Bakım kaydı oluşturulamadı')
    } finally {
      setSavingMaint(false)
    }
  }

  const handleApplyStarterPack = async (pack: StockStarterPackKey) => {
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
        toast.error(data.error || 'Stok ve bakım tabloları kurulamadı')
        return
      }
      toast.success('Stok, periyodik bakım ve hareket geçmişi tabloları kuruldu!')
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
      toast.success('Tablo stok ve bakım modülüne bağlandı')
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
        body: JSON.stringify({ domain: 'stock' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Kayıtlar aktarılamadı')
        return
      }
      toast.success(
        `${data.importedItemCount || 0} stok kalemi ve ${data.importedMaintenanceCount || 0} bakım kaydı dinamik tablolara aktarıldı`
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
      if (stockTables.some((t) => t.id === targetTableId)) {
        setSelectedTableId(targetTableId)
        setFocusedDetailRowId(targetRowId)
      } else {
        toast('İlgili kayıt Veri Tabloları sekmesindeki bağlı listede yer alıyor.')
      }
    },
    [stockTables]
  )

  if (loading && !overview) {
    return (
      <div className={depth.card} style={{ padding: 36, textAlign: 'center', color: 'var(--pc-muted)' }}>
        Stok ve periyodik bakım verileri yükleniyor…
      </div>
    )
  }

  const canManageSchema = Boolean(schema?.canManageSchema)
  const alerts = overview?.alerts || {
    sktExpiredCount: 0,
    sktSoonCount: 0,
    lowStockCount: 0,
    maintenanceDueCount: 0,
    totalStockItems: 0,
    totalStockValue: 0,
  }
  const hasInventoryModule = Boolean(overview && overview.inventoryTableIds.length > 0)
  const hasMaintenanceModule = Boolean(overview && overview.maintenanceTableIds.length > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
      {/* Üst Başlık, Toplam Envanter Değeri ve Hızlı Ekleme Butonları */}
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
            <Package size={18} style={{ color: 'var(--pc-tint-fg)' }} />
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--foreground)' }}>
              Stok &amp; Periyodik Bakım
            </h2>
            <InfoTooltip title="Dinamik Envanter, SKT, Periyodik Bakım ve Gider Senkronizasyonu">
              Tüm malzeme/ürün stoklarınız ve ekipman periyodik bakımlarınız dinamik tablolarda yönetilir. Stok alımı, tedarikçi iadesi ve tamamlanan ücretli periyodik bakımlar Ödemeler &amp; Finans sekmesindeki Giderler tablosuna otomatik işlenir.
            </InfoTooltip>
            {overview?.hasStockTables && (
              <span className={depth.badge}>
                <span>Envanter Değeri: {formatCurrencyTR(alerts.totalStockValue)}</span>
              </span>
            )}
          </div>
        </div>

        {overview?.hasStockTables && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {hasMaintenanceModule && (
              <button
                type="button"
                onClick={() => setNewMaintModalOpen(true)}
                className={depth.btnPale}
                style={{ minHeight: 34, padding: '6px 13px', fontSize: 12.5 }}
              >
                <Wrench size={14} />
                <span>+ Periyodik Bakım Planla</span>
              </button>
            )}
            {hasInventoryModule && (
              <button
                type="button"
                onClick={() => setNewItemModalOpen(true)}
                className={depth.btnPrimary}
                style={{ minHeight: 34, padding: '6px 14px', fontSize: 12.5 }}
              >
                <Plus size={15} color="#ffffff" />
                <span style={{ color: '#ffffff' }}>Yeni Stok Kalemi</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Eski Sabit Tablolardan Tek Tıkla Aktarım Banner'ı */}
      {overview?.legacyMigration.hasUnmigratedLegacyStock && canManageSchema && (
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
              Önceki sabit stokta{' '}
              <strong>{overview.legacyMigration.unmigratedItems} malzeme</strong> ve{' '}
              <strong>{overview.legacyMigration.unmigratedMaintenances} bakım kaydı</strong> bulundu. Tek tıkla dinamik tablolara aktarabilirsiniz.
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
            <span>{migratingLegacy ? 'Aktarılıyor…' : 'Mevcut Stok & Bakımları Aktar'}</span>
          </button>
        </div>
      )}

      {/* Sıfır Stok Tablosu Başlangıç Durumu */}
      {!overview?.hasStockTables && (
        <div className={depth.card} style={{ padding: '18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Sparkles size={18} style={{ color: 'var(--pc-blue)', flexShrink: 0 }} />
            <div>
              <strong style={{ fontSize: 14, color: 'var(--foreground)' }}>
                Sektörünüze Uygun Dinamik Stok &amp; Periyodik Bakım Tablolarını Tek Tıkla Kurun
              </strong>
              <div style={{ fontSize: 12.5, color: 'var(--pc-muted)' }}>
                Kritik stok uyarıları, son kullanma tarihi (SKT) takibi, periyodik bakım döngüsü ve otomatik gider kaydı hazır gelir.
              </div>
            </div>
          </div>

          {canManageSchema ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 245px), 1fr))',
                  gap: 10,
                }}
              >
                {STOCK_STARTER_PACKS.map((pk, idx) => (
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
                      onChange={(e) => setBindRole(e.target.value as any)}
                      className={depth.input}
                      style={{ width: 205, minHeight: 31, fontSize: 12 }}
                    >
                      <option value="stock_inventory">Stok &amp; Envanter Tablosu</option>
                      <option value="asset_maintenance">Cihaz &amp; Periyodik Bakım Tablosu</option>
                      <option value="stock_movement">Stok Hareket Geçmişi</option>
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
              Yetkili kullanıcı stok ve bakım tablolarını oluşturduğunda bu ekrandan stok hareketlerini yönetebilirsiniz.
            </div>
          )}
        </div>
      )}

      {overview?.hasStockTables && (
        <>
          {/* Tıklanabilir Akıllı Uyarı Filtre Rozetleri + Otomatik Gider Anahtarı */}
          <div
            className={depth.card}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              padding: '10px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {(
                [
                  { id: 'all' as const, label: `Tümü (${alerts.totalStockItems})` },
                  { id: 'low_stock' as const, label: `Kritik Stok (${alerts.lowStockCount})` },
                  { id: 'skt_expired' as const, label: `SKT Geçmiş (${alerts.sktExpiredCount})` },
                  { id: 'skt_soon' as const, label: `SKT Yaklaşan ≤30g (${alerts.sktSoonCount})` },
                  {
                    id: 'maintenance_due' as const,
                    label: `Yaklaşan Bakım ≤14g (${alerts.maintenanceDueCount})`,
                  },
                ]
              ).map((f) => {
                const active = alertFilter === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setAlertFilter(f.id)}
                    className={active ? depth.btnPrimary : depth.btn}
                    style={{ minHeight: 30, padding: '4px 11px', fontSize: 12 }}
                  >
                    <span style={active ? { color: '#ffffff' } : undefined}>{f.label}</span>
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                role="switch"
                aria-checked={recordInFinance}
                onClick={() => setRecordInFinance((v) => !v)}
                className={depth.switch}
              />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground-2)' }}>
                Alım, İade &amp; Bakım Tutarlarını Giderlere Otomatik İşle
              </span>
            </div>
          </div>

          {/* Hızlı Operasyon Panelleri: Sol = Hızlı Stok Hareketi, Sağ = Periyodik Bakımlar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 370px), 1fr))',
              gap: 12,
              alignItems: 'stretch',
            }}
          >
            {/* Sol Panel: Hızlı Stok Giriş / Kullanım / Zayi / İmha / İade */}
            <div className={depth.card} style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                  <Layers size={15} style={{ color: 'var(--pc-blue)' }} />
                  <strong style={{ fontSize: 13.5, color: 'var(--foreground)' }}>
                    Hızlı Stok Giriş &amp; Düşüm İşlemleri
                  </strong>
                </div>

                <div style={{ position: 'relative', width: 'min(210px, 100%)' }}>
                  <Search
                    size={13}
                    style={{
                      position: 'absolute',
                      left: 9,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--pc-muted)',
                    }}
                  />
                  <input
                    type="text"
                    value={quickSearch}
                    onChange={(e) => setQuickSearch(e.target.value)}
                    placeholder="Malzeme veya cihaz ara…"
                    className={depth.input}
                    style={{ paddingLeft: 28, minHeight: 29, fontSize: 12 }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxHeight: 280,
                  overflowY: 'auto',
                  paddingRight: 2,
                }}
              >
                {overview.inventoryItems.length === 0 ? (
                  <div style={{ padding: '24px 10px', textAlign: 'center', color: 'var(--pc-muted)', fontSize: 12.5 }}>
                    Seçili filtreye uygun stok kalemi bulunmuyor.
                  </div>
                ) : (
                  overview.inventoryItems.slice(0, 20).map((item) => {
                    const isBusy = busyRowId === item.rowId
                    const qtyVal = qtyDraftByRow[item.rowId] ?? '1'
                    const costVal =
                      costDraftByRow[item.rowId] !== undefined
                        ? costDraftByRow[item.rowId]!
                        : item.unitCost > 0
                          ? String(item.unitCost)
                          : ''

                    return (
                      <div
                        key={item.rowId}
                        className={depth.subcard}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 7,
                          padding: '9px 11px',
                          border:
                            item.isExpired || item.isLowStock
                              ? '1.5px solid var(--danger)'
                              : '1px solid var(--pc-border)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: 12.5, color: 'var(--foreground)' }}>
                                {item.name}
                              </strong>
                              <span className={depth.badge} style={{ fontSize: 10 }}>
                                {item.categoryLabel}
                              </span>
                              {item.isExpired && (
                                <span
                                  className={depth.badge}
                                  style={{ fontSize: 10, color: 'var(--danger)' }}
                                >
                                  SKT Geçmiş
                                </span>
                              )}
                              {!item.isExpired && item.isExpiringSoon && (
                                <span className={depth.badge} style={{ fontSize: 10 }}>
                                  SKT: {item.daysUntilExpiry} gün
                                </span>
                              )}
                              {item.isLowStock && (
                                <span
                                  className={depth.badge}
                                  style={{ fontSize: 10, color: 'var(--danger)' }}
                                >
                                  Kritik Stok (Eşik: {item.minThreshold})
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--pc-muted)', marginTop: 2 }}>
                              Mevcut: <strong>{item.quantity} {item.unitLabel}</strong>
                              {item.unitCost > 0 ? ` • Birim: ${formatCurrencyTR(item.unitCost)}` : ''}
                              {item.expiryDate ? ` • SKT: ${formatDynamicDateTR(item.expiryDate)}` : ''}
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <input
                              type="number"
                              min="1"
                              value={qtyVal}
                              onChange={(e) =>
                                setQtyDraftByRow((prev) => ({ ...prev, [item.rowId]: e.target.value }))
                              }
                              title="İşlem adedi"
                              className={depth.input}
                              style={{ width: 62, minHeight: 27, padding: '2px 6px', fontSize: 12 }}
                            />
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={costVal}
                              onChange={(e) =>
                                setCostDraftByRow((prev) => ({ ...prev, [item.rowId]: e.target.value }))
                              }
                              placeholder="Birim ₺"
                              title="Birim maliyet (₺)"
                              className={depth.input}
                              style={{ width: 86, minHeight: 27, padding: '2px 6px', fontSize: 12 }}
                            />
                          </div>

                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleMovement(item, 'giris')}
                              className={depth.btnMint}
                              style={{ minHeight: 27, padding: '2px 8px', fontSize: 11 }}
                              title="Stok girişi / satın alım"
                            >
                              <Plus size={12} />
                              <span>Alım</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleMovement(item, 'cikis')}
                              className={depth.btnPale}
                              style={{ minHeight: 27, padding: '2px 8px', fontSize: 11 }}
                              title="Kullanım / çıkış"
                            >
                              <Minus size={12} />
                              <span>Kullandım</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleMovement(item, 'fire')}
                              className={depth.btn}
                              style={{ minHeight: 27, padding: '2px 7px', fontSize: 11 }}
                              title="Zayi / bozulma"
                            >
                              <span>Zayi</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleMovement(item, 'imha')}
                              className={depth.btn}
                              style={{ minHeight: 27, padding: '2px 7px', fontSize: 11, color: 'var(--danger)' }}
                              title="Süresi doldu / imha"
                            >
                              <span>İmha</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleMovement(item, 'iade')}
                              className={depth.btn}
                              style={{ minHeight: 27, padding: '2px 7px', fontSize: 11 }}
                              title="Tedarikçiye iade (giderlerden düşer)"
                            >
                              <RotateCcw size={11} />
                              <span>İade</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Sağ Panel: Periyodik Bakım Takibi & Tek Tıkla Bakım Tamamlama */}
            <div className={depth.card} style={{ padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <CalendarClock size={16} style={{ color: 'var(--pc-blue)' }} />
                  <strong style={{ fontSize: 13.5, color: 'var(--foreground)' }}>
                    Cihaz, Ekipman &amp; Periyodik Bakımlar
                  </strong>
                </div>
                <span className={depth.badge} style={{ fontSize: 10.5 }}>
                  {overview.maintenanceItems.length} Kayıt
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxHeight: 280,
                  overflowY: 'auto',
                  paddingRight: 2,
                }}
              >
                {overview.maintenanceItems.length === 0 ? (
                  <div style={{ padding: '24px 10px', textAlign: 'center', color: 'var(--pc-muted)', fontSize: 12.5 }}>
                    Görüntülenecek bakım kaydı bulunmuyor.
                  </div>
                ) : (
                  overview.maintenanceItems.slice(0, 16).map((m) => {
                    const isBusy = busyRowId === m.rowId
                    const draftCost =
                      maintCostDraftByRow[m.rowId] !== undefined
                        ? maintCostDraftByRow[m.rowId]!
                        : m.estimatedCost > 0
                          ? String(m.estimatedCost)
                          : ''

                    return (
                      <div
                        key={m.rowId}
                        className={depth.subcard}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 7,
                          padding: '9px 11px',
                          border: m.isMaintenanceDue
                            ? '1.5px solid var(--pc-blue)'
                            : '1px solid var(--pc-border)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: 12.5, color: 'var(--foreground)' }}>
                                {m.name}
                              </strong>
                              <span className={depth.badge} style={{ fontSize: 10 }}>
                                {m.typeLabel}
                              </span>
                              {m.isPeriodic && m.periodicDays > 0 && (
                                <span className={depth.badge} style={{ fontSize: 10 }}>
                                  Her {m.periodicDays} günde bir
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--pc-muted)', marginTop: 2 }}>
                              Durum: <strong>{m.statusLabel}</strong>
                              {m.effectiveDueDate && (
                                <span>
                                  {' '}
                                  • Plan / Sonraki:{' '}
                                  <strong>{formatDynamicDateTR(m.effectiveDueDate)}</strong>
                                </span>
                              )}
                              {m.daysUntilDue !== null && m.daysUntilDue <= 14 && (
                                <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                                  {' '}
                                  ({m.daysUntilDue < 0 ? `${Math.abs(m.daysUntilDue)} gün gecikti` : `${m.daysUntilDue} gün kaldı`})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Clock size={12} style={{ color: 'var(--pc-muted)' }} />
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={draftCost}
                              onChange={(e) =>
                                setMaintCostDraftByRow((prev) => ({
                                  ...prev,
                                  [m.rowId]: e.target.value,
                                }))
                              }
                              placeholder="Bakım ücreti (₺)"
                              className={depth.input}
                              style={{ width: 130, minHeight: 27, padding: '2px 8px', fontSize: 12 }}
                            />
                          </div>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleCompleteMaintenance(m)}
                            className={depth.btnPrimary}
                            style={{ minHeight: 28, padding: '3px 11px', fontSize: 11.5 }}
                          >
                            <Check size={13} color="#ffffff" />
                            <span style={{ color: '#ffffff' }}>
                              {isBusy ? 'İşleniyor…' : 'Bakımı Tamamla'}
                            </span>
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>

          {/* Alt Bölüm: Tam Özelleştirilebilir Dinamik Stok, Bakım ve Hareket Tabloları */}
          {schema && stockTables.length > 0 && (
            <div className={styles.mainTableCard}>
              <DynamicDataGridPanel
                tables={stockTables}
                allTables={schema.tables}
                relations={schema.relations}
                appointmentConfigs={schema.appointmentConfigs}
                moduleConfigs={schema.moduleConfigs}
                defaultNewTableModuleRole="stock_inventory"
                selectedTableId={selectedTableId}
                canManageSchema={canManageSchema}
                refreshToken={refreshToken}
                focusedDetailRowId={focusedDetailRowId}
                onChangeFocusedDetailRowId={setFocusedDetailRowId}
                onSelectTable={setSelectedTableId}
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

      {/* 460px Clay/Neo Yeni Stok Kalemi Modalı */}
      {newItemModalOpen && (
        <div className={depth.backdrop} onClick={() => setNewItemModalOpen(false)}>
          <div
            className={depth.modal}
            onClick={(e) => e.stopPropagation()}
            style={{ padding: '16px 18px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <strong style={{ fontSize: 14.5, color: 'var(--foreground)' }}>
                Yeni Stok / Envanter Kalemi Ekle
              </strong>
              <button
                type="button"
                onClick={() => setNewItemModalOpen(false)}
                className={depth.btn}
                style={{ minHeight: 28, padding: '3px 8px' }}
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleCreateQuickStockItem} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                  Malzeme / Ürün Adı *
                </label>
                <input
                  type="text"
                  required
                  value={itemTitle}
                  onChange={(e) => setItemTitle(e.target.value)}
                  placeholder="Örn: Kompozit Dolgu Seti, Fren Balatası, Toner…"
                  className={depth.input}
                  style={{ minHeight: 34, fontSize: 12.5 }}
                  autoFocus
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                    Başlangıç Stoku
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={itemQty}
                    onChange={(e) => setItemQty(e.target.value)}
                    className={depth.input}
                    style={{ minHeight: 34, fontSize: 12.5 }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                    Kritik Eşik
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={itemMinThreshold}
                    onChange={(e) => setItemMinThreshold(e.target.value)}
                    className={depth.input}
                    style={{ minHeight: 34, fontSize: 12.5 }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                    Birim Maliyet (₺)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={itemUnitCost}
                    onChange={(e) => setItemUnitCost(e.target.value)}
                    placeholder="0,00"
                    className={depth.input}
                    style={{ minHeight: 34, fontSize: 12.5 }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                  Son Kullanma Tarihi (SKT — İsteğe Bağlı)
                </label>
                <ClinicalDatePicker
                  value={itemExpiryDate}
                  onChange={(nextIso) => setItemExpiryDate(nextIso)}
                  placeholder="SKT varsa seçiniz"
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                  Marka / Tedarikçi / Not
                </label>
                <input
                  type="text"
                  value={itemNotes}
                  onChange={(e) => setItemNotes(e.target.value)}
                  placeholder="Tedarikçi firma veya lot bilgisi…"
                  className={depth.input}
                  style={{ minHeight: 34, fontSize: 12.5 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setNewItemModalOpen(false)}
                  className={depth.btn}
                  style={{ minHeight: 34, padding: '6px 14px', fontSize: 12.5 }}
                >
                  <span>Vazgeç</span>
                </button>
                <button
                  type="submit"
                  disabled={savingItem}
                  className={depth.btnPrimary}
                  style={{ minHeight: 34, padding: '6px 16px', fontSize: 12.5 }}
                >
                  <Check size={15} color="#ffffff" />
                  <span style={{ color: '#ffffff' }}>
                    {savingItem ? 'Kaydediliyor…' : 'Stok Kalemini Ekle'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 460px Clay/Neo Periyodik Bakım Planlama Modalı */}
      {newMaintModalOpen && (
        <div className={depth.backdrop} onClick={() => setNewMaintModalOpen(false)}>
          <div
            className={depth.modal}
            onClick={(e) => e.stopPropagation()}
            style={{ padding: '16px 18px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <strong style={{ fontSize: 14.5, color: 'var(--foreground)' }}>
                Yeni Cihaz / Ekipman Bakımı Planla
              </strong>
              <button
                type="button"
                onClick={() => setNewMaintModalOpen(false)}
                className={depth.btn}
                style={{ minHeight: 28, padding: '3px 8px' }}
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleCreateQuickMaintenance} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                  Cihaz / Demirbaş / Ekipman Adı *
                </label>
                <input
                  type="text"
                  required
                  value={maintTitle}
                  onChange={(e) => setMaintTitle(e.target.value)}
                  placeholder="Örn: Otoklav Cihazı, Kompresör, Klima, Hizmet Aracı…"
                  className={depth.input}
                  style={{ minHeight: 34, fontSize: 12.5 }}
                  autoFocus
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                    Planlanan Bakım Tarihi
                  </label>
                  <ClinicalDatePicker
                    value={maintScheduledDate}
                    onChange={(nextIso) => setMaintScheduledDate(nextIso || todayIsoDate())}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                    Tahmini Bakım Ücreti (₺)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={maintCost}
                    onChange={(e) => setMaintCost(e.target.value)}
                    placeholder="0,00"
                    className={depth.input}
                    style={{ minHeight: 34, fontSize: 12.5 }}
                  />
                </div>
              </div>

              <div
                className={depth.subcard}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={maintIsPeriodic}
                    onClick={() => setMaintIsPeriodic((v) => !v)}
                    className={depth.switch}
                  />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)' }}>
                    Periyodik Tekrarlayan Bakım
                  </span>
                </div>

                {maintIsPeriodic && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--pc-muted)', fontWeight: 600 }}>
                      Periyot (Gün):
                    </span>
                    <input
                      type="number"
                      min="1"
                      value={maintPeriodicDays}
                      onChange={(e) => setMaintPeriodicDays(e.target.value)}
                      className={depth.input}
                      style={{ width: 82, minHeight: 30, padding: '3px 8px', fontSize: 12 }}
                    />
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                  Yetkili Servis / Not
                </label>
                <input
                  type="text"
                  value={maintNotes}
                  onChange={(e) => setMaintNotes(e.target.value)}
                  placeholder="Servis firması veya seri numarası…"
                  className={depth.input}
                  style={{ minHeight: 34, fontSize: 12.5 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setNewMaintModalOpen(false)}
                  className={depth.btn}
                  style={{ minHeight: 34, padding: '6px 14px', fontSize: 12.5 }}
                >
                  <span>Vazgeç</span>
                </button>
                <button
                  type="submit"
                  disabled={savingMaint}
                  className={depth.btnPrimary}
                  style={{ minHeight: 34, padding: '6px 16px', fontSize: 12.5 }}
                >
                  <Check size={15} color="#ffffff" />
                  <span style={{ color: '#ffffff' }}>
                    {savingMaint ? 'Kaydediliyor…' : 'Bakımı Planla'}
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

