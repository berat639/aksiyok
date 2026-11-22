'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'react-hot-toast'
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  Check,
  Clock,
  DownloadCloud,
  History,
  Minus,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import {
  MOVEMENT_LABELS,
  PERIOD_PRESETS,
  UNIVERSAL_UNITS,
  buildMaintenanceRowValues,
  buildPostponeMaintenanceValues,
  buildStockRowValues,
  extractStockCategories,
  filterMaintenanceItems,
  filterStockItems,
  inverseMovementType,
  stockSeverity,
  todayIsoDate,
  type MaintenanceOverviewItem,
  type MovementType,
  type StockAlertFilter,
  type StockOverviewData,
  type StockOverviewItem,
} from '@/lib/stock-helpers'
import {
  formatCurrencyTR,
  formatDynamicDateTR,
  type DynamicTableDef,
  type StudioSchemaResponse,
} from '@/app/admin/components/dynamic-tables/types'
import ClinicalDatePicker from '@/app/admin/components/dynamic-tables/ui/ClinicalDatePicker'
import ConfirmModal from '@/app/admin/components/ConfirmModal'
import InfoTooltip from '@/app/admin/components/ui/InfoTooltip'
import clay from './isletme-clay.module.css'
import s from './isletme.module.css'
import local from './StokBakimSection.module.css'

type SubTab = 'inventory' | 'maintenance' | 'history'

type StockDraft = {
  rowId: string | null
  tableId: string | null
  name: string
  category: string
  unit: string
  quantity: string
  minThreshold: string
  unitCost: string
  hasExpiry: boolean
  expiryDate: string | null
  notes: string
}

type MaintDraft = {
  rowId: string | null
  tableId: string | null
  name: string
  scheduledDate: string
  isPeriodic: boolean
  periodicDays: string
  estimatedCost: string
  notes: string
}

type LastAction = {
  rowId: string
  name: string
  unitLabel: string
  movementType: MovementType
  quantity: number
  unitCost: number
}

const emptyStockDraft = (): StockDraft => ({
  rowId: null,
  tableId: null,
  name: '',
  category: '',
  unit: 'Adet',
  quantity: '10',
  minThreshold: '3',
  unitCost: '',
  hasExpiry: false,
  expiryDate: null,
  notes: '',
})

const emptyMaintDraft = (): MaintDraft => ({
  rowId: null,
  tableId: null,
  name: '',
  scheduledDate: todayIsoDate(),
  isPeriodic: true,
  periodicDays: '90',
  estimatedCost: '',
  notes: '',
})

export default function StokBakimSection() {
  const [schema, setSchema] = useState<StudioSchemaResponse | null>(null)
  const [overview, setOverview] = useState<StockOverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [subTab, setSubTab] = useState<SubTab>('inventory')

  const [alertFilter, setAlertFilter] = useState<StockAlertFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [onlyDueMaint, setOnlyDueMaint] = useState(false)
  const [search, setSearch] = useState('')
  const [recordInFinance, setRecordInFinance] = useState(true)

  const [setupBusy, setSetupBusy] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [bindTableId, setBindTableId] = useState('')
  const [bindRole, setBindRole] = useState<'stock_inventory' | 'asset_maintenance' | 'stock_movement'>('stock_inventory')

  // Satır içi formlar ve hızlı işlem çekmeceleri
  const [stockFormOpen, setStockFormOpen] = useState(false)
  const [stockDraft, setStockDraft] = useState<StockDraft>(emptyStockDraft)
  const [savingStock, setSavingStock] = useState(false)

  const [maintFormOpen, setMaintFormOpen] = useState(false)
  const [maintDraft, setMaintDraft] = useState<MaintDraft>(emptyMaintDraft)
  const [savingMaint, setSavingMaint] = useState(false)

  const [activeMoveRowId, setActiveMoveRowId] = useState<string | null>(null)
  const [moveQty, setMoveQty] = useState('1')
  const [moveCost, setMoveCost] = useState('')
  const [moveNote, setMoveNote] = useState('')

  const [activeCompleteRowId, setActiveCompleteRowId] = useState<string | null>(null)
  const [completeCost, setCompleteCost] = useState('')
  const [completeNote, setCompleteNote] = useState('')

  const [busyRowId, setBusyRowId] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<LastAction | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState<{ rowId: string; name: string; kind: 'stock' | 'maint' } | null>(null)

  const loadAll = useCallback(async () => {
    try {
      const [schemaRes, overviewRes] = await Promise.all([
        fetch('/api/dynamic-tables/schema', { credentials: 'include' }),
        fetch('/api/dynamic-tables/stock/overview?alertFilter=all', { credentials: 'include' }),
      ])
      const [schemaData, overviewData] = await Promise.all([
        schemaRes.json().catch(() => null),
        overviewRes.json().catch(() => null),
      ])
      if (schemaRes.ok && schemaData) setSchema(schemaData)
      if (overviewRes.ok && overviewData) setOverview(overviewData)
    } catch {
      toast.error('Stok ve bakım verileri yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const canManageSchema = Boolean(schema?.canManageSchema)
  const invMod = useMemo(() => overview?.moduleTables.find((m) => m.moduleRole === 'stock_inventory') ?? null, [overview])
  const maintMod = useMemo(() => overview?.moduleTables.find((m) => m.moduleRole === 'asset_maintenance') ?? null, [overview])
  const invTable = useMemo(() => schema?.tables.find((t) => t.id === invMod?.tableId) ?? null, [schema, invMod])
  const maintTable = useMemo(() => schema?.tables.find((t) => t.id === maintMod?.tableId) ?? null, [schema, maintMod])

  const unboundTables = useMemo<DynamicTableDef[]>(() => {
    if (!schema || !overview) return []
    const bound = new Set(overview.allStockModuleTableIds)
    return schema.tables.filter((t) => !bound.has(t.id))
  }, [schema, overview])

  const categoryOptions = useMemo(() => {
    const fromSchema = invMod?.mapping.categoryColumnId
      ? invTable?.columns.find((c) => c.id === invMod.mapping.categoryColumnId)?.config?.options?.map((o) => o.label) ?? []
      : []
    const fromItems = extractStockCategories(overview?.inventoryItems ?? [])
    return Array.from(new Set([...fromSchema, ...fromItems])).filter(Boolean)
  }, [invMod, invTable, overview])

  const unitOptions = useMemo(() => {
    const fromSchema = invMod?.mapping.unitColumnId
      ? invTable?.columns.find((c) => c.id === invMod.mapping.unitColumnId)?.config?.options?.map((o) => o.label) ?? []
      : []
    return Array.from(new Set([...fromSchema, ...UNIVERSAL_UNITS]))
  }, [invMod, invTable])

  const visibleStock = useMemo(
    () => filterStockItems(overview?.inventoryItems ?? [], { alert: alertFilter, category: categoryFilter, query: search }),
    [overview, alertFilter, categoryFilter, search],
  )

  const visibleMaint = useMemo(
    () => filterMaintenanceItems(overview?.maintenanceItems ?? [], { onlyDue: onlyDueMaint, query: search }),
    [overview, onlyDueMaint, search],
  )

  const visibleMovements = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR')
    const list = overview?.recentMovements ?? []
    if (!q) return list
    return list.filter((m) => `${m.title} ${m.movementTypeLabel} ${m.itemTitle ?? ''} ${m.actor ?? ''}`.toLocaleLowerCase('tr-TR').includes(q))
  }, [overview, search])

  const initializeUniversalStock = async () => {
    setSetupBusy(true)
    try {
      const res = await fetch('/api/dynamic-tables/module-starter-pack', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: 'general_stock' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Stok ve bakım alanı kurulamadı.')
        return
      }
      toast.success('Stok ve bakım alanı hazırlandı.')
      await loadAll()
    } catch {
      toast.error('Bağlantı hatası oluştu.')
    } finally {
      setSetupBusy(false)
    }
  }

  const handleBindTable = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!bindTableId) return
    setSetupBusy(true)
    try {
      const res = await fetch(`/api/dynamic-tables/module-configs/${bindTableId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleRole: bindRole, enabled: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Tablo bağlanamadı.')
        return
      }
      toast.success('Tablo stok ve bakım alanına bağlandı.')
      setBindTableId('')
      await loadAll()
    } catch {
      toast.error('Tablo bağlanamadı.')
    } finally {
      setSetupBusy(false)
    }
  }

  const handleMigrateLegacy = async () => {
    setMigrating(true)
    try {
      const res = await fetch('/api/dynamic-tables/migrate-legacy-module-data', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'stock' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Aktarım tamamlanamadı.')
        return
      }
      toast.success(`${data.importedItemCount || 0} stok kalemi ve ${data.importedMaintenanceCount || 0} bakım kaydı aktarıldı.`)
      await loadAll()
    } catch {
      toast.error('Aktarım sırasında hata oluştu.')
    } finally {
      setMigrating(false)
    }
  }

  /* ───────────── Stok Kalemi Ekle / Düzenle / Hareket ───────────── */

  const openNewStock = () => {
    setStockDraft({ ...emptyStockDraft(), category: categoryOptions[0] || '' })
    setStockFormOpen(true)
    setActiveMoveRowId(null)
  }

  const openEditStock = (item: StockOverviewItem) => {
    setStockDraft({
      rowId: item.rowId,
      tableId: item.tableId,
      name: item.name,
      category: item.categoryLabel,
      unit: item.unitLabel || 'Adet',
      quantity: String(item.quantity),
      minThreshold: String(item.minThreshold),
      unitCost: item.unitCost > 0 ? String(item.unitCost) : '',
      hasExpiry: Boolean(item.expiryDate),
      expiryDate: item.expiryDate,
      notes: item.notes ?? '',
    })
    setStockFormOpen(true)
    setActiveMoveRowId(null)
  }

  const submitStock = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = stockDraft.name.trim()
    if (!clean) {
      toast.error('Kalem adı gerekli.')
      return
    }
    const targetTable = (stockDraft.tableId ? schema?.tables.find((t) => t.id === stockDraft.tableId) : invTable) ?? invTable
    const targetMod = overview?.moduleTables.find((m) => m.tableId === targetTable?.id) ?? invMod
    if (!targetTable || !targetMod) {
      toast.error('Stok tablosu bulunamadı.')
      return
    }

    const qty = Math.max(0, Math.floor(Number(stockDraft.quantity) || 0))
    const minTh = Math.max(0, Math.floor(Number(stockDraft.minThreshold) || 0))
    const uCost = Math.max(0, Number(String(stockDraft.unitCost).replace(',', '.')) || 0)
    const values = buildStockRowValues(targetTable, targetMod.mapping, {
      name: clean,
      category: stockDraft.category,
      unit: stockDraft.unit,
      quantity: qty,
      minThreshold: minTh,
      unitCost: uCost,
      expiryDate: stockDraft.hasExpiry ? stockDraft.expiryDate : null,
      notes: stockDraft.notes,
    })

    setSavingStock(true)
    try {
      const url = stockDraft.rowId
        ? `/api/dynamic-tables/rows/${stockDraft.rowId}`
        : `/api/dynamic-tables/tables/${targetTable.id}/rows`
      const res = await fetch(url, {
        method: stockDraft.rowId ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Stok kalemi kaydedilemedi.')
        return
      }
      if (!stockDraft.rowId && recordInFinance && qty > 0 && uCost > 0) {
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
            itemRowId: data.id,
          }),
        }).catch(() => {})
      }
      toast.success(stockDraft.rowId ? `"${clean}" güncellendi.` : `"${clean}" stoğa eklendi.`)
      setStockFormOpen(false)
      setStockDraft(emptyStockDraft())
      await loadAll()
    } catch {
      toast.error('Kayıt sırasında hata oluştu.')
    } finally {
      setSavingStock(false)
    }
  }

  const openMovement = (item: StockOverviewItem) => {
    if (activeMoveRowId === item.rowId) {
      setActiveMoveRowId(null)
      return
    }
    setActiveMoveRowId(item.rowId)
    setMoveQty('1')
    setMoveCost(item.unitCost > 0 ? String(item.unitCost) : '')
    setMoveNote('')
  }

  const runMovement = async (item: StockOverviewItem, movementType: MovementType) => {
    const qty = Math.max(1, Math.floor(Number(moveQty) || 1))
    if (movementType !== 'giris' && qty > item.quantity) {
      toast.error(`Yetersiz stok: mevcut miktar ${item.quantity} ${item.unitLabel}.`)
      return
    }
    const parsedCost = moveCost.trim() !== '' ? Number(moveCost.replace(',', '.')) : item.unitCost
    const unitCost = Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : item.unitCost

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
          unitCost,
          notes: moveNote.trim() || undefined,
          recordInFinance,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Stok hareketi uygulanamadı.')
        return
      }
      setLastAction({ rowId: item.rowId, name: item.name, unitLabel: item.unitLabel, movementType, quantity: qty, unitCost })
      setActiveMoveRowId(null)
      toast.success(`${item.name} güncel stok: ${data.nextQuantity} ${item.unitLabel}`)
      await loadAll()
    } catch {
      toast.error('Stok hareketi kaydedilemedi.')
    } finally {
      setBusyRowId(null)
    }
  }

  const undoLastAction = async () => {
    if (!lastAction) return
    setUndoBusy(true)
    try {
      const res = await fetch('/api/dynamic-tables/stock/movement', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId: lastAction.rowId,
          movementType: inverseMovementType(lastAction.movementType),
          quantity: lastAction.quantity,
          unitCost: lastAction.unitCost,
          notes: `Geri alma (${MOVEMENT_LABELS[lastAction.movementType]})`,
          recordInFinance: false,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Son işlem geri alınamadı.')
        return
      }
      toast.success(`${lastAction.name} için son hareket geri alındı.`)
      setLastAction(null)
      await loadAll()
    } catch {
      toast.error('Geri alma başarısız oldu.')
    } finally {
      setUndoBusy(false)
    }
  }

  /* ───────────── Bakım Ekle / Düzenle / Tamamla / Ertele ───────────── */

  const openNewMaint = () => {
    setMaintDraft(emptyMaintDraft())
    setMaintFormOpen(true)
    setActiveCompleteRowId(null)
  }

  const openEditMaint = (item: MaintenanceOverviewItem) => {
    setMaintDraft({
      rowId: item.rowId,
      tableId: item.tableId,
      name: item.name,
      scheduledDate: item.effectiveDueDate || item.scheduledDate || todayIsoDate(),
      isPeriodic: item.isPeriodic,
      periodicDays: String(item.periodicDays || 90),
      estimatedCost: item.estimatedCost > 0 ? String(item.estimatedCost) : '',
      notes: item.notes ?? '',
    })
    setMaintFormOpen(true)
    setActiveCompleteRowId(null)
  }

  const submitMaint = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = maintDraft.name.trim()
    if (!clean) {
      toast.error('Ekipman veya varlık adı gerekli.')
      return
    }
    const targetTable = (maintDraft.tableId ? schema?.tables.find((t) => t.id === maintDraft.tableId) : maintTable) ?? maintTable
    const targetMod = overview?.moduleTables.find((m) => m.tableId === targetTable?.id) ?? maintMod
    if (!targetTable || !targetMod) {
      toast.error('Bakım tablosu bulunamadı.')
      return
    }

    const values = buildMaintenanceRowValues(targetTable, targetMod.mapping, {
      name: clean,
      scheduledDate: maintDraft.scheduledDate || todayIsoDate(),
      isPeriodic: maintDraft.isPeriodic,
      periodicDays: Number(maintDraft.periodicDays) || 90,
      estimatedCost: Number(String(maintDraft.estimatedCost).replace(',', '.')) || 0,
      notes: maintDraft.notes,
      setPlannedStatus: !maintDraft.rowId,
    })

    setSavingMaint(true)
    try {
      const url = maintDraft.rowId
        ? `/api/dynamic-tables/rows/${maintDraft.rowId}`
        : `/api/dynamic-tables/tables/${targetTable.id}/rows`
      const res = await fetch(url, {
        method: maintDraft.rowId ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Bakım planı kaydedilemedi.')
        return
      }
      toast.success(maintDraft.rowId ? `"${clean}" güncellendi.` : `"${clean}" bakım planına eklendi.`)
      setMaintFormOpen(false)
      setMaintDraft(emptyMaintDraft())
      await loadAll()
    } catch {
      toast.error('Bakım kaydı oluşturulamadı.')
    } finally {
      setSavingMaint(false)
    }
  }

  const completeMaint = async (item: MaintenanceOverviewItem) => {
    const parsed = completeCost.trim() !== '' ? Number(completeCost.replace(',', '.')) : item.estimatedCost
    const cost = Number.isFinite(parsed) && parsed >= 0 ? parsed : item.estimatedCost
    setBusyRowId(item.rowId)
    try {
      const res = await fetch('/api/dynamic-tables/stock/complete-maintenance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId: item.rowId,
          cost,
          notes: completeNote.trim() || undefined,
          recordInFinance,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Bakım tamamlanamadı.')
        return
      }
      setActiveCompleteRowId(null)
      toast.success(
        data.computedNextDate
          ? `${item.name} tamamlandı · Sonraki: ${formatDynamicDateTR(data.computedNextDate)}`
          : `${item.name} tamamlandı.`,
      )
      await loadAll()
    } catch {
      toast.error('Bakım tamamlanamadı.')
    } finally {
      setBusyRowId(null)
    }
  }

  const postponeMaint = async (item: MaintenanceOverviewItem, extraDays: number) => {
    const targetTable = schema?.tables.find((t) => t.id === item.tableId) ?? maintTable
    const targetMod = overview?.moduleTables.find((m) => m.tableId === item.tableId) ?? maintMod
    if (!targetTable || !targetMod) return
    const { nextIso, values } = buildPostponeMaintenanceValues(targetTable, targetMod.mapping, item, extraDays)
    if (Object.keys(values).length === 0) return

    setBusyRowId(item.rowId)
    try {
      const res = await fetch(`/api/dynamic-tables/rows/${item.rowId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      if (!res.ok) {
        toast.error('Bakım tarihi ertelenemedi.')
        return
      }
      toast.success(`${item.name} ${formatDynamicDateTR(nextIso)} tarihine ertelendi.`)
      await loadAll()
    } catch {
      toast.error('Bağlantı hatası oluştu.')
    } finally {
      setBusyRowId(null)
    }
  }

  const runArchive = async () => {
    if (!confirmArchive) return
    const target = confirmArchive
    setConfirmArchive(null)
    setBusyRowId(target.rowId)
    try {
      const res = await fetch('/api/dynamic-tables/rows/archive', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIds: [target.rowId] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Kayıt kaldırılamadı.')
        return
      }
      toast.success(`"${target.name}" kaldırıldı.`)
      await loadAll()
    } catch {
      toast.error('Kaldırma işlemi başarısız oldu.')
    } finally {
      setBusyRowId(null)
    }
  }

  /* ───────────── Görünüm ───────────── */

  if (loading && !overview) {
    return (
      <div className={clay.scope}>
        <div className={clay.card}>
          <span className={clay.muted}>Stok ve bakım verileri yükleniyor…</span>
        </div>
      </div>
    )
  }

  const alerts = overview?.alerts ?? {
    sktExpiredCount: 0,
    sktSoonCount: 0,
    lowStockCount: 0,
    maintenanceDueCount: 0,
    totalStockItems: 0,
    totalStockValue: 0,
  }

  const hasStockTables = Boolean(overview?.hasStockTables)
  const sktAlertTotal = alerts.sktExpiredCount + alerts.sktSoonCount

  return (
    <div className={clay.scope}>
      {/* Üst Güçlü Mavi Clay Hero Şeridi */}
      <div className={clay.hero}>
        <div className={clay.heroMain}>
          <div className={clay.heroLeft}>
            <span className={clay.heroBadgeIcon} aria-hidden="true">
              <Boxes size={20} strokeWidth={2.2} color="#ffffff" />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className={clay.heroTitleRow}>
                <h3 className={clay.heroName}>Stok ve Bakım</h3>
                <span className={clay.heroPill}>Envanter: {formatCurrencyTR(alerts.totalStockValue)}</span>
                <InfoTooltip title="Stok ve Bakım" glyph="?">
                  Tüm işletme türleriyle uyumlu ürün, sarf malzeme ve ekipman stoklarını, isteğe bağlı son kullanma tarihi (SKT) takibini ve periyodik bakımları buradan yönetin.
                </InfoTooltip>
              </div>
              <div className={clay.heroMeta}>
                <span className={clay.heroMetaItem}>
                  {alerts.lowStockCount} kritik stok · {alerts.maintenanceDueCount} yaklaşan bakım
                </span>
              </div>
            </div>
          </div>

          {hasStockTables && (
            <div className={clay.heroActions}>
              <label className={clay.heroSwitchPill}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={recordInFinance}
                  aria-label="Alım ve bakım tutarlarını giderlere işle"
                  className={clay.switch}
                  onClick={() => setRecordInFinance((v) => !v)}
                />
                <span className={clay.heroSwitchLabel}>Gidere işle</span>
              </label>

              {subTab === 'inventory' && invMod && (
                <button
                  type="button"
                  className={clay.heroPrimaryBtn}
                  onClick={() => (stockFormOpen ? setStockFormOpen(false) : openNewStock())}
                >
                  {stockFormOpen ? <X size={14} color="#0e2152" /> : <Plus size={14} color="#0e2152" />}
                  <span>{stockFormOpen ? 'Kapat' : 'Yeni Kalem'}</span>
                </button>
              )}

              {subTab === 'maintenance' && maintMod && (
                <button
                  type="button"
                  className={clay.heroPrimaryBtn}
                  onClick={() => (maintFormOpen ? setMaintFormOpen(false) : openNewMaint())}
                >
                  {maintFormOpen ? <X size={14} color="#0e2152" /> : <Plus size={14} color="#0e2152" />}
                  <span>{maintFormOpen ? 'Kapat' : 'Bakım Planla'}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {hasStockTables && overview && (
          <div className={clay.heroTabs} role="tablist" aria-label="Stok ve bakım görünümleri">
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'inventory'}
              className={subTab === 'inventory' ? clay.heroTabOn : clay.heroTab}
              onClick={() => setSubTab('inventory')}
            >
              <Package size={13} color={subTab === 'inventory' ? '#0e2152' : '#ffffff'} />
              <span>Stok ({alerts.totalStockItems})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'maintenance'}
              className={subTab === 'maintenance' ? clay.heroTabOn : clay.heroTab}
              onClick={() => setSubTab('maintenance')}
            >
              <Wrench size={13} color={subTab === 'maintenance' ? '#0e2152' : '#ffffff'} />
              <span>Bakım ({overview.maintenanceItems.length})</span>
              {alerts.maintenanceDueCount > 0 && subTab !== 'maintenance' && (
                <span className={local.maintDueDot} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'history'}
              className={subTab === 'history' ? clay.heroTabOn : clay.heroTab}
              onClick={() => setSubTab('history')}
            >
              <History size={13} color={subTab === 'history' ? '#0e2152' : '#ffffff'} />
              <span>Geçmiş ({overview.recentMovements.length})</span>
            </button>
          </div>
        )}
      </div>

      {/* Sıfır Durum Kurulumu */}
      {!hasStockTables ? (
        <>
          {overview?.legacyMigration.hasUnmigratedLegacyStock && canManageSchema && (
            <div className={clay.noticeInfo}>
              <span className={clay.muted}>
                Önceki kayıtlarda <strong>{overview.legacyMigration.unmigratedItems}</strong> stok ve{' '}
                <strong>{overview.legacyMigration.unmigratedMaintenances}</strong> bakım bulundu.
              </span>
              <button
                type="button"
                className={clay.mintBtn}
                disabled={migrating}
                onClick={() => void handleMigrateLegacy()}
              >
                <DownloadCloud size={13} />
                <span>{migrating ? 'Aktarılıyor…' : 'Mevcut Kayıtları Aktar'}</span>
              </button>
            </div>
          )}

          <div className={clay.card}>
            <div className={clay.emptyHero}>
              <span className={`${clay.iconChip} ${clay.chipBrand}`} aria-hidden="true">
                <Package size={19} strokeWidth={2.2} color="#ffffff" />
              </span>
              <strong style={{ fontSize: 15, color: 'var(--foreground)' }}>
                Stok ve Bakım Alanını Başlatın
              </strong>
              <span style={{ maxWidth: 460 }}>
                Tüm işletme türleriyle uyumlu ürün, sarf malzeme, ekipman stoku, isteğe bağlı SKT ve periyodik bakım tablolarını tek tıkla oluşturun.
              </span>
              {canManageSchema ? (
                <button
                  type="button"
                  className={clay.primaryBtn}
                  disabled={setupBusy}
                  onClick={() => void initializeUniversalStock()}
                >
                  <Plus size={14} color="#ffffff" />
                  <span>{setupBusy ? 'Hazırlanıyor…' : 'Stok ve Bakımı Başlat'}</span>
                </button>
              ) : (
                <span className={clay.muted}>
                  Yönetici stok alanını başlattığında kayıtlar burada görünecektir.
                </span>
              )}
            </div>

            {canManageSchema && unboundTables.length > 0 && (
              <form className={clay.noticeInfo} onSubmit={handleBindTable}>
                <span className={clay.muted}>Veya mevcut bir tablonuzu bağlayın:</span>
                <div className={clay.row}>
                  <select
                    aria-label="Bağlanacak tablo"
                    className={clay.wellSelect}
                    style={{ width: 175 }}
                    value={bindTableId}
                    onChange={(e) => setBindTableId(e.target.value)}
                  >
                    <option value="">Tablo seçin…</option>
                    {unboundTables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Modül rolü"
                    className={clay.wellSelect}
                    style={{ width: 170 }}
                    value={bindRole}
                    onChange={(e) => setBindRole(e.target.value as 'stock_inventory' | 'asset_maintenance' | 'stock_movement')}
                  >
                    <option value="stock_inventory">Stok &amp; Envanter</option>
                    <option value="asset_maintenance">Periyodik Bakım</option>
                    <option value="stock_movement">Hareket Geçmişi</option>
                  </select>
                  <button
                    type="submit"
                    className={clay.ctlBtn}
                    disabled={setupBusy || !bindTableId}
                  >
                    <span>Bağla</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Eski Kayıt Aktarım Şeridi */}
          {overview && overview.legacyMigration.hasUnmigratedLegacyStock && canManageSchema && (
            <div className={clay.noticeInfo}>
              <span className={clay.muted}>
                Eski stok kayıtlarında <strong>{overview.legacyMigration.unmigratedItems}</strong> kalem ve{' '}
                <strong>{overview.legacyMigration.unmigratedMaintenances}</strong> bakım var.
              </span>
              <button
                type="button"
                className={clay.mintBtn}
                disabled={migrating}
                onClick={() => void handleMigrateLegacy()}
              >
                <DownloadCloud size={12} />
                <span>{migrating ? 'Aktarılıyor…' : 'Aktar'}</span>
              </button>
            </div>
          )}

          {/* 4 Tıklanabilir Kompakt KPI Kartı */}
          {overview && (
            <div className={clay.statGrid}>
              <button
                type="button"
                className={`${clay.statCardClickable} ${subTab === 'inventory' && alertFilter === 'all' ? clay.statCardActive : ''}`}
                style={{ color: 'var(--foreground)' }}
                onClick={() => {
                  setSubTab('inventory')
                  setAlertFilter('all')
                }}
              >
                <span className={clay.cardHead}>
                  <span className={clay.cardTitleGroup}>
                    <span className={`${clay.iconChip} ${clay.chipBrand}`} aria-hidden="true">
                      <Package size={18} strokeWidth={2.2} color="#ffffff" />
                    </span>
                    <span className={clay.statTitle}>Toplam Kalem</span>
                  </span>
                </span>
                <span className={clay.statVal}>{alerts.totalStockItems}</span>
                <span className={clay.statFoot}>
                  <span className={clay.wellPill}>Değer: {formatCurrencyTR(alerts.totalStockValue)}</span>
                </span>
              </button>

              <button
                type="button"
                className={`${clay.statCardClickable} ${subTab === 'inventory' && alertFilter === 'low_stock' ? clay.statCardActive : ''}`}
                style={{ color: 'var(--foreground)' }}
                onClick={() => {
                  setSubTab('inventory')
                  setAlertFilter('low_stock')
                }}
              >
                <span className={clay.cardHead}>
                  <span className={clay.cardTitleGroup}>
                    <span
                      className={`${clay.iconChip} ${alerts.lowStockCount > 0 ? clay.chipCoral : clay.chipMint}`}
                      aria-hidden="true"
                    >
                      <AlertTriangle size={18} strokeWidth={2.2} color="#ffffff" />
                    </span>
                    <span className={clay.statTitle}>Kritik Stok</span>
                  </span>
                </span>
                <span className={`${clay.statVal} ${alerts.lowStockCount > 0 ? clay.valDanger : clay.valGood}`}>
                  {alerts.lowStockCount}
                </span>
                <span className={clay.statFoot}>
                  <span className={alerts.lowStockCount > 0 ? clay.pillDanger : clay.pillGood}>
                    {alerts.lowStockCount > 0 ? 'Eşik altında' : 'Tümü normal'}
                  </span>
                </span>
              </button>

              <button
                type="button"
                className={`${clay.statCardClickable} ${subTab === 'inventory' && (alertFilter === 'skt_expired' || alertFilter === 'skt_soon') ? clay.statCardActive : ''}`}
                style={{ color: 'var(--foreground)' }}
                onClick={() => {
                  setSubTab('inventory')
                  setAlertFilter(alerts.sktExpiredCount > 0 ? 'skt_expired' : 'skt_soon')
                }}
              >
                <span className={clay.cardHead}>
                  <span className={clay.cardTitleGroup}>
                    <span className={`${clay.iconChip} ${clay.chipAmber}`} aria-hidden="true">
                      <Clock size={18} strokeWidth={2.2} color="#ffffff" />
                    </span>
                    <span className={clay.statTitle}>SKT Uyarıları</span>
                  </span>
                </span>
                <span
                  className={`${clay.statVal} ${
                    alerts.sktExpiredCount > 0 ? clay.valDanger : alerts.sktSoonCount > 0 ? clay.valWatch : ''
                  }`}
                >
                  {sktAlertTotal}
                </span>
                <span className={clay.statFoot}>
                  <span
                    className={
                      alerts.sktExpiredCount > 0
                        ? clay.pillDanger
                        : alerts.sktSoonCount > 0
                          ? clay.pillWatch
                          : clay.wellPill
                    }
                  >
                    {alerts.sktExpiredCount} geçmiş · {alerts.sktSoonCount} ≤30g
                  </span>
                </span>
              </button>

              <button
                type="button"
                className={`${clay.statCardClickable} ${subTab === 'maintenance' && onlyDueMaint ? clay.statCardActive : ''}`}
                style={{ color: 'var(--foreground)' }}
                onClick={() => {
                  setSubTab('maintenance')
                  setOnlyDueMaint(true)
                }}
              >
                <span className={clay.cardHead}>
                  <span className={clay.cardTitleGroup}>
                    <span className={`${clay.iconChip} ${clay.chipViolet}`} aria-hidden="true">
                      <Wrench size={18} strokeWidth={2.2} color="#ffffff" />
                    </span>
                    <span className={clay.statTitle}>Yaklaşan Bakım</span>
                  </span>
                </span>
                <span className={`${clay.statVal} ${alerts.maintenanceDueCount > 0 ? clay.valWatch : ''}`}>
                  {alerts.maintenanceDueCount}
                </span>
                <span className={clay.statFoot}>
                  <span className={alerts.maintenanceDueCount > 0 ? clay.pillWatch : clay.wellPill}>
                    {overview.maintenanceItems.length} planlı kayıt
                  </span>
                </span>
              </button>
            </div>
          )}

          {/* Son Hareketi Geri Alma Şeridi */}
          {lastAction && (
            <div className={clay.noticeGood}>
              <span className={clay.goodText}>
                Son işlem: <strong>{lastAction.name}</strong> · {lastAction.quantity} {lastAction.unitLabel} (
                {MOVEMENT_LABELS[lastAction.movementType]})
              </span>
              <div className={clay.row} style={{ gap: 6 }}>
                <button
                  type="button"
                  className={clay.ctlBtnSm}
                  disabled={undoBusy}
                  onClick={() => void undoLastAction()}
                >
                  <RotateCcw size={12} />
                  <span>{undoBusy ? 'Geri alınıyor…' : 'Geri al'}</span>
                </button>
                <button
                  type="button"
                  className={clay.iconToolBtn}
                  aria-label="Bildirimi kapat"
                  onClick={() => setLastAction(null)}
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          )}

          {/* 1. STOK & ENVANTER */}
          {subTab === 'inventory' && (
            <section className={clay.card}>
              <div className={clay.cardHead}>
                <div className={clay.cardTitleGroup}>
                  <span className={`${clay.iconChipSm} ${clay.chipBrand}`} aria-hidden="true">
                    <Package size={16} strokeWidth={2.2} color="#ffffff" />
                  </span>
                  <div className={clay.cardTitleRow}>
                    <h4 className={clay.cardTitle}>Stok ve Envanter</h4>
                    <span className={clay.wellPill}>{visibleStock.length} kalem</span>
                  </div>
                </div>

                <div className={clay.fieldBox} style={{ minHeight: 36, minWidth: 210, flex: '0 1 250px' }}>
                  <Search size={13} color="var(--pc-muted)" />
                  <input
                    className={clay.fieldInput}
                    style={{ height: 32 }}
                    aria-label="Stok kalemi ara"
                    placeholder="Kalem veya kategori ara…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      type="button"
                      className={clay.iconToolBtn}
                      style={{ width: 22, height: 22 }}
                      aria-label="Aramayı temizle"
                      onClick={() => setSearch('')}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>

              <div className={clay.topBar}>
                <div className={clay.row} style={{ gap: 6 }}>
                  {([
                    ['all', `Tümü (${alerts.totalStockItems})`],
                    ['low_stock', `Kritik (${alerts.lowStockCount})`],
                    ['skt_expired', `SKT Geçmiş (${alerts.sktExpiredCount})`],
                    ['skt_soon', `SKT ≤30g (${alerts.sktSoonCount})`],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={alertFilter === id ? clay.ctlBtnOn : clay.ctlBtnSm}
                      onClick={() => setAlertFilter(id)}
                    >
                      <span>{label}</span>
                    </button>
                  ))}
                  {categoryOptions.length > 1 && (
                    <select
                      aria-label="Kategori filtresi"
                      className={clay.wellSelect}
                      style={{ width: 'auto', minWidth: 130, minHeight: 30, padding: '4px 10px', fontSize: 11.5 }}
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                    >
                      <option value="all">Tüm kategoriler</option>
                      {categoryOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {stockFormOpen && (
                <form className={clay.subCard} onSubmit={submitStock}>
                  <div className={clay.topBar}>
                    <h5 className={clay.cardTitle}>
                      {stockDraft.rowId ? 'Stok kalemini düzenle' : 'Yeni stok kalemi'}
                    </h5>
                    <button
                      type="button"
                      className={clay.iconToolBtn}
                      aria-label="Formu kapat"
                      onClick={() => setStockFormOpen(false)}
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className={local.stockFormGrid}>
                    <input
                      aria-label="Kalem adı"
                      className={clay.wellInput}
                      required
                      placeholder="Kalem adı (ör. Kâğıt havlu, Filtre, Kutu ambalaj)"
                      value={stockDraft.name}
                      onChange={(e) => setStockDraft({ ...stockDraft, name: e.target.value })}
                    />
                    <input
                      aria-label="Kategori"
                      list="stok-kategori-onerileri"
                      className={clay.wellInput}
                      placeholder="Kategori (isteğe bağlı)"
                      value={stockDraft.category}
                      onChange={(e) => setStockDraft({ ...stockDraft, category: e.target.value })}
                    />
                    <datalist id="stok-kategori-onerileri">
                      {categoryOptions.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                    <input
                      aria-label="Birim"
                      list="stok-birim-onerileri"
                      className={clay.wellInput}
                      placeholder="Birim"
                      value={stockDraft.unit}
                      onChange={(e) => setStockDraft({ ...stockDraft, unit: e.target.value })}
                    />
                    <datalist id="stok-birim-onerileri">
                      {unitOptions.map((u) => (
                        <option key={u} value={u} />
                      ))}
                    </datalist>
                  </div>

                  <div className={local.stockNumGrid}>
                    <label className={clay.field}>
                      <span className={clay.fieldLabel}>Miktar</span>
                      <input
                        type="number"
                        min="0"
                        className={clay.wellInput}
                        value={stockDraft.quantity}
                        onChange={(e) => setStockDraft({ ...stockDraft, quantity: e.target.value })}
                      />
                    </label>
                    <label className={clay.field}>
                      <span className={clay.fieldLabel}>Kritik eşik</span>
                      <input
                        type="number"
                        min="0"
                        className={clay.wellInput}
                        value={stockDraft.minThreshold}
                        onChange={(e) => setStockDraft({ ...stockDraft, minThreshold: e.target.value })}
                      />
                    </label>
                    <label className={clay.field}>
                      <span className={clay.fieldLabel}>Birim maliyet (₺)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0,00"
                        className={clay.wellInput}
                        value={stockDraft.unitCost}
                        onChange={(e) => setStockDraft({ ...stockDraft, unitCost: e.target.value })}
                      />
                    </label>
                    <label className={clay.field}>
                      <span className={clay.fieldLabel}>Tedarikçi / Not</span>
                      <input
                        type="text"
                        placeholder="İsteğe bağlı"
                        className={clay.wellInput}
                        value={stockDraft.notes}
                        onChange={(e) => setStockDraft({ ...stockDraft, notes: e.target.value })}
                      />
                    </label>
                  </div>

                  <div className={clay.topBar}>
                    <div className={clay.row}>
                      <label className={clay.row} style={{ gap: 7, cursor: 'pointer' }}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={stockDraft.hasExpiry}
                          aria-label="Son kullanma tarihi ekle"
                          className={clay.switch}
                          onClick={() => setStockDraft({ ...stockDraft, hasExpiry: !stockDraft.hasExpiry })}
                        />
                        <span className={clay.muted}>SKT takibi (isteğe bağlı)</span>
                      </label>
                      {stockDraft.hasExpiry && (
                        <ClinicalDatePicker
                          compact
                          value={stockDraft.expiryDate}
                          onChange={(iso) => setStockDraft({ ...stockDraft, expiryDate: iso })}
                          placeholder="SKT seçin"
                        />
                      )}
                    </div>

                    <div className={clay.row} style={{ gap: 6 }}>
                      <button
                        type="button"
                        className={clay.ctlBtnSm}
                        onClick={() => setStockFormOpen(false)}
                      >
                        <span>Vazgeç</span>
                      </button>
                      <button type="submit" className={clay.primaryBtn} disabled={savingStock}>
                        <Check size={13} color="#ffffff" />
                        <span>{savingStock ? 'Kaydediliyor…' : stockDraft.rowId ? 'Güncelle' : 'Kaydet'}</span>
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {visibleStock.length === 0 ? (
                <div className={clay.emptyHero}>
                  <span className={`${clay.iconChipSm} ${clay.chipBrand}`} aria-hidden="true">
                    <Package size={16} color="#ffffff" />
                  </span>
                  <span>
                    {alerts.totalStockItems === 0
                      ? 'Henüz stok kalemi yok. “Yeni Kalem” ile ilk kaydınızı ekleyin.'
                      : 'Bu filtreyle eşleşen stok kalemi yok.'}
                  </span>
                </div>
              ) : (
                <div className={clay.tableShell}>
                  <table className={clay.table}>
                    <thead>
                      <tr>
                        <th>Kalem &amp; Kategori</th>
                        <th>Mevcut Stok</th>
                        <th>Birim / Toplam</th>
                        <th>Durum / SKT</th>
                        <th className={clay.stickyCol}>İşlemler</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleStock.map((item) => {
                        const sev = stockSeverity(item)
                        const moveOpen = activeMoveRowId === item.rowId
                        const busy = busyRowId === item.rowId
                        const totalValue = item.quantity * item.unitCost
                        return (
                          <Fragment key={item.rowId}>
                            <tr className={moveOpen ? clay.rowOpen : undefined}>
                              <td>
                                <div className={clay.row} style={{ gap: 6 }}>
                                  <strong style={{ fontWeight: 800, color: 'var(--foreground)' }}>
                                    {item.name}
                                  </strong>
                                  <span className={clay.wellPill}>{item.categoryLabel}</span>
                                </div>
                                {item.notes && (
                                  <div className={clay.muted} style={{ marginTop: 3 }}>
                                    {item.notes}
                                  </div>
                                )}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <strong style={{ color: 'var(--foreground)' }}>
                                  {item.quantity} {item.unitLabel}
                                </strong>
                                <div className={clay.muted}>Eşik: ≤{item.minThreshold}</div>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {item.unitCost > 0 ? (
                                  <>
                                    <div style={{ fontWeight: 700 }}>{formatCurrencyTR(item.unitCost)}</div>
                                    <div className={clay.muted}>Top. {formatCurrencyTR(totalValue)}</div>
                                  </>
                                ) : (
                                  <span className={clay.muted}>—</span>
                                )}
                              </td>
                              <td>
                                <div className={clay.row} style={{ gap: 5 }}>
                                  {sev === 'expired' && (
                                    <span className={clay.pillDanger}>
                                      <AlertTriangle size={11} />
                                      SKT Geçmiş
                                    </span>
                                  )}
                                  {item.isLowStock && (
                                    <span className={clay.pillDanger}>Kritik (≤{item.minThreshold})</span>
                                  )}
                                  {!item.isExpired && item.isExpiringSoon && (
                                    <span className={clay.pillWatch}>SKT {item.daysUntilExpiry}g</span>
                                  )}
                                  {sev !== 'expired' && !item.isLowStock && !item.isExpiringSoon && (
                                    <span className={clay.pillGood}>Normal</span>
                                  )}
                                </div>
                                {item.expiryDate && (
                                  <div className={clay.muted} style={{ marginTop: 3 }}>
                                    SKT: {formatDynamicDateTR(item.expiryDate)}
                                  </div>
                                )}
                              </td>
                              <td className={clay.stickyCol}>
                                <div
                                  className={clay.row}
                                  style={{ justifyContent: 'flex-end', gap: 5, flexWrap: 'nowrap' }}
                                >
                                  <button
                                    type="button"
                                    className={moveOpen ? clay.ctlBtnOn : clay.ctlBtnSm}
                                    aria-expanded={moveOpen}
                                    onClick={() => openMovement(item)}
                                  >
                                    {moveOpen ? 'Kapat' : 'Giriş / Çıkış'}
                                  </button>
                                  <button
                                    type="button"
                                    className={clay.iconToolBtn}
                                    title="Düzenle"
                                    aria-label={`${item.name} düzenle`}
                                    onClick={() => openEditStock(item)}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  {canManageSchema && (
                                    <button
                                      type="button"
                                      className={clay.iconToolBtnDanger}
                                      title="Kaldır"
                                      aria-label={`${item.name} kaldır`}
                                      onClick={() =>
                                        setConfirmArchive({ rowId: item.rowId, name: item.name, kind: 'stock' })
                                      }
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>

                            {moveOpen && (
                              <tr>
                                <td colSpan={5} className={clay.drawerWell}>
                                  <div className={local.drawerControls}>
                                    <div className={clay.row} style={{ gap: 6, flex: '1 1 320px' }}>
                                      <input
                                        type="number"
                                        min="1"
                                        aria-label="İşlem adedi"
                                        className={clay.wellInput}
                                        style={{ width: 72, minHeight: 32, padding: '4px 8px' }}
                                        value={moveQty}
                                        onChange={(e) => setMoveQty(e.target.value)}
                                      />
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        aria-label="Birim maliyet"
                                        placeholder="Birim ₺"
                                        className={clay.wellInput}
                                        style={{ width: 96, minHeight: 32, padding: '4px 8px' }}
                                        value={moveCost}
                                        onChange={(e) => setMoveCost(e.target.value)}
                                      />
                                      <input
                                        type="text"
                                        aria-label="Hareket notu"
                                        placeholder="Not (isteğe bağlı)"
                                        className={clay.wellInput}
                                        style={{ flex: 1, minWidth: 140, minHeight: 32, padding: '4px 10px' }}
                                        value={moveNote}
                                        onChange={(e) => setMoveNote(e.target.value)}
                                      />
                                    </div>
                                    <div className={clay.row} style={{ gap: 6 }}>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        className={clay.mintBtn}
                                        onClick={() => void runMovement(item, 'giris')}
                                      >
                                        <Plus size={12} />
                                        <span>Alım / Giriş</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        className={clay.ctlBtnSm}
                                        onClick={() => void runMovement(item, 'cikis')}
                                      >
                                        <Minus size={12} />
                                        <span>Kullanım</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        className={clay.ctlBtnSm}
                                        onClick={() => void runMovement(item, 'iade')}
                                      >
                                        <RotateCcw size={11} />
                                        <span>İade</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        className={clay.ctlBtnSm}
                                        onClick={() => void runMovement(item, 'fire')}
                                      >
                                        <span>Fire / Zayi</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy}
                                        className={clay.dangerBtn}
                                        onClick={() => void runMovement(item, 'imha')}
                                      >
                                        <span>İmha</span>
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* 2. PERİYODİK BAKIM */}
          {subTab === 'maintenance' && overview && (
            <section className={clay.card}>
              <div className={clay.cardHead}>
                <div className={clay.cardTitleGroup}>
                  <span className={`${clay.iconChipSm} ${clay.chipViolet}`} aria-hidden="true">
                    <CalendarClock size={16} strokeWidth={2.2} color="#ffffff" />
                  </span>
                  <div className={clay.cardTitleRow}>
                    <h4 className={clay.cardTitle}>Periyodik Bakım</h4>
                    <span className={clay.wellPill}>{visibleMaint.length} kayıt</span>
                  </div>
                </div>

                <div className={clay.fieldBox} style={{ minHeight: 36, minWidth: 210, flex: '0 1 250px' }}>
                  <Search size={13} color="var(--pc-muted)" />
                  <input
                    className={clay.fieldInput}
                    style={{ height: 32 }}
                    aria-label="Bakım kaydı ara"
                    placeholder="Ekipman veya servis ara…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      type="button"
                      className={clay.iconToolBtn}
                      style={{ width: 22, height: 22 }}
                      aria-label="Aramayı temizle"
                      onClick={() => setSearch('')}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>

              <div className={clay.topBar}>
                <div className={clay.row} style={{ gap: 6 }}>
                  <button
                    type="button"
                    className={!onlyDueMaint ? clay.ctlBtnOn : clay.ctlBtnSm}
                    onClick={() => setOnlyDueMaint(false)}
                  >
                    <span>Tümü ({overview.maintenanceItems.length})</span>
                  </button>
                  <button
                    type="button"
                    className={onlyDueMaint ? clay.ctlBtnOn : clay.ctlBtnSm}
                    onClick={() => setOnlyDueMaint(true)}
                  >
                    <span>Yaklaşan ≤14g ({alerts.maintenanceDueCount})</span>
                  </button>
                </div>
              </div>

              {maintFormOpen && (
                <form className={clay.subCard} onSubmit={submitMaint}>
                  <div className={clay.topBar}>
                    <h5 className={clay.cardTitle}>
                      {maintDraft.rowId ? 'Bakım kaydını düzenle' : 'Yeni bakım planla'}
                    </h5>
                    <button
                      type="button"
                      className={clay.iconToolBtn}
                      aria-label="Formu kapat"
                      onClick={() => setMaintFormOpen(false)}
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className={local.maintFormGrid}>
                    <input
                      aria-label="Ekipman veya varlık adı"
                      className={clay.wellInput}
                      required
                      placeholder="Ekipman / varlık adı (ör. Klima ünitesi, Hizmet aracı, Yazıcı)"
                      value={maintDraft.name}
                      onChange={(e) => setMaintDraft({ ...maintDraft, name: e.target.value })}
                    />
                    <ClinicalDatePicker
                      compact
                      value={maintDraft.scheduledDate}
                      onChange={(iso) => setMaintDraft({ ...maintDraft, scheduledDate: iso || todayIsoDate() })}
                      placeholder="Planlanan tarih"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label="Tahmini ücret"
                      placeholder="Tahmini ücret (₺)"
                      className={clay.wellInput}
                      value={maintDraft.estimatedCost}
                      onChange={(e) => setMaintDraft({ ...maintDraft, estimatedCost: e.target.value })}
                    />
                  </div>

                  <div className={clay.topBar}>
                    <div className={clay.row} style={{ gap: 6 }}>
                      <label className={clay.row} style={{ gap: 7, cursor: 'pointer' }}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={maintDraft.isPeriodic}
                          aria-label="Periyodik tekrarla"
                          className={clay.switch}
                          onClick={() => setMaintDraft({ ...maintDraft, isPeriodic: !maintDraft.isPeriodic })}
                        />
                        <span className={clay.muted}>Periyodik</span>
                      </label>
                      {maintDraft.isPeriodic && (
                        <>
                          {PERIOD_PRESETS.map((p) => {
                            const active = String(p.days) === maintDraft.periodicDays
                            return (
                              <button
                                key={p.days}
                                type="button"
                                className={active ? s.dayBtnOn : s.dayBtn}
                                style={{ minWidth: 'auto', padding: '0 9px' }}
                                onClick={() => setMaintDraft({ ...maintDraft, periodicDays: String(p.days) })}
                              >
                                <span>{p.days}g</span>
                              </button>
                            )
                          })}
                          <input
                            type="number"
                            min="1"
                            aria-label="Periyot gün sayısı"
                            className={clay.wellInput}
                            style={{ width: 68, minHeight: 30, padding: '4px 8px' }}
                            value={maintDraft.periodicDays}
                            onChange={(e) => setMaintDraft({ ...maintDraft, periodicDays: e.target.value })}
                          />
                        </>
                      )}
                    </div>

                    <div className={clay.row} style={{ gap: 6 }}>
                      <input
                        type="text"
                        aria-label="Servis veya not"
                        placeholder="Yetkili servis / not"
                        className={clay.wellInput}
                        style={{ width: 175, minHeight: 32, padding: '4px 10px' }}
                        value={maintDraft.notes}
                        onChange={(e) => setMaintDraft({ ...maintDraft, notes: e.target.value })}
                      />
                      <button type="submit" className={clay.primaryBtn} disabled={savingMaint}>
                        <Check size={13} color="#ffffff" />
                        <span>{savingMaint ? 'Kaydediliyor…' : maintDraft.rowId ? 'Güncelle' : 'Planla'}</span>
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {visibleMaint.length === 0 ? (
                <div className={clay.emptyHero}>
                  <span className={`${clay.iconChipSm} ${clay.chipViolet}`} aria-hidden="true">
                    <CalendarClock size={16} color="#ffffff" />
                  </span>
                  <span>
                    {overview.maintenanceItems.length === 0
                      ? 'Planlanmış bakım kaydı yok.'
                      : 'Bu filtrede bakım kaydı yok.'}
                  </span>
                </div>
              ) : (
                <div className={clay.tableShell}>
                  <table className={clay.table}>
                    <thead>
                      <tr>
                        <th>Ekipman / Varlık</th>
                        <th>Periyot</th>
                        <th>Tarih &amp; Durum</th>
                        <th>Tahmini Ücret</th>
                        <th className={clay.stickyCol}>İşlemler</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleMaint.map((m) => {
                        const busy = busyRowId === m.rowId
                        const openComplete = activeCompleteRowId === m.rowId
                        const overdue = m.daysUntilDue !== null && m.daysUntilDue < 0
                        return (
                          <Fragment key={m.rowId}>
                            <tr className={openComplete ? clay.rowOpen : undefined}>
                              <td>
                                <strong style={{ fontWeight: 800, color: 'var(--foreground)' }}>
                                  {m.name}
                                </strong>
                                {m.notes && (
                                  <div className={clay.muted} style={{ marginTop: 3 }}>
                                    {m.notes}
                                  </div>
                                )}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {m.isPeriodic && m.periodicDays > 0 ? (
                                  <span className={clay.pillBrand}>Her {m.periodicDays}g</span>
                                ) : (
                                  <span className={clay.muted}>Tek seferlik</span>
                                )}
                              </td>
                              <td>
                                <div className={clay.row} style={{ gap: 6 }}>
                                  <span style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
                                    {m.effectiveDueDate ? formatDynamicDateTR(m.effectiveDueDate) : m.statusLabel}
                                  </span>
                                  {overdue ? (
                                    <span className={clay.pillDanger}>
                                      {Math.abs(m.daysUntilDue!)} gün gecikti
                                    </span>
                                  ) : m.isMaintenanceDue && m.daysUntilDue !== null ? (
                                    <span className={clay.pillWatch}>{m.daysUntilDue} gün kaldı</span>
                                  ) : m.status === 'completed' ? (
                                    <span className={clay.pillGood}>Tamamlandı</span>
                                  ) : null}
                                </div>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {m.estimatedCost > 0 ? (
                                  <span style={{ fontWeight: 700 }}>{formatCurrencyTR(m.estimatedCost)}</span>
                                ) : (
                                  <span className={clay.muted}>—</span>
                                )}
                              </td>
                              <td className={clay.stickyCol}>
                                <div
                                  className={clay.row}
                                  style={{ justifyContent: 'flex-end', gap: 5, flexWrap: 'nowrap' }}
                                >
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className={clay.chipBtn}
                                    title="7 gün ertele"
                                    onClick={() => void postponeMaint(m, 7)}
                                  >
                                    +7g
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className={clay.chipBtn}
                                    title="30 gün ertele"
                                    onClick={() => void postponeMaint(m, 30)}
                                  >
                                    +30g
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className={openComplete ? clay.ctlBtnSm : clay.ctlBtnOn}
                                    onClick={() => {
                                      if (openComplete) {
                                        setActiveCompleteRowId(null)
                                      } else {
                                        setActiveCompleteRowId(m.rowId)
                                        setCompleteCost(m.estimatedCost > 0 ? String(m.estimatedCost) : '')
                                        setCompleteNote('')
                                      }
                                    }}
                                  >
                                    {!openComplete && <Check size={12} color="#ffffff" />}
                                    <span>{openComplete ? 'Kapat' : 'Tamamla'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={clay.iconToolBtn}
                                    title="Düzenle"
                                    aria-label={`${m.name} düzenle`}
                                    onClick={() => openEditMaint(m)}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  {canManageSchema && (
                                    <button
                                      type="button"
                                      className={clay.iconToolBtnDanger}
                                      title="Kaldır"
                                      aria-label={`${m.name} kaldır`}
                                      onClick={() =>
                                        setConfirmArchive({ rowId: m.rowId, name: m.name, kind: 'maint' })
                                      }
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>

                            {openComplete && (
                              <tr>
                                <td colSpan={5} className={clay.drawerWell}>
                                  <div className={clay.row} style={{ gap: 8 }}>
                                    <Clock size={14} color="var(--pc-muted)" />
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      aria-label="Gerçekleşen bakım ücreti"
                                      placeholder="Bakım ücreti (₺)"
                                      className={clay.wellInput}
                                      style={{ width: 135, minHeight: 32, padding: '4px 10px' }}
                                      value={completeCost}
                                      onChange={(e) => setCompleteCost(e.target.value)}
                                    />
                                    <input
                                      type="text"
                                      aria-label="Tamamlama notu"
                                      placeholder="Yapılan işlem / not"
                                      className={clay.wellInput}
                                      style={{ flex: 1, minWidth: 160, minHeight: 32, padding: '4px 10px' }}
                                      value={completeNote}
                                      onChange={(e) => setCompleteNote(e.target.value)}
                                    />
                                    <button
                                      type="button"
                                      disabled={busy}
                                      className={clay.primaryBtn}
                                      style={{ minHeight: 32, padding: '0 13px', fontSize: 12 }}
                                      onClick={() => void completeMaint(m)}
                                    >
                                      <Check size={12} color="#ffffff" />
                                      <span>{busy ? 'İşleniyor…' : 'Bakımı Tamamla'}</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* 3. HAREKET GEÇMİŞİ */}
          {subTab === 'history' && (
            <section className={clay.card}>
              <div className={clay.cardHead}>
                <div className={clay.cardTitleGroup}>
                  <span className={`${clay.iconChipSm} ${clay.chipMint}`} aria-hidden="true">
                    <History size={16} strokeWidth={2.2} color="#ffffff" />
                  </span>
                  <div className={clay.cardTitleRow}>
                    <h4 className={clay.cardTitle}>Son stok ve bakım hareketleri</h4>
                    <span className={clay.wellPill}>{visibleMovements.length} kayıt</span>
                  </div>
                </div>

                <div className={clay.fieldBox} style={{ minHeight: 36, minWidth: 210, flex: '0 1 250px' }}>
                  <Search size={13} color="var(--pc-muted)" />
                  <input
                    className={clay.fieldInput}
                    style={{ height: 32 }}
                    aria-label="Hareketlerde ara"
                    placeholder="Hareket veya kişi ara…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      type="button"
                      className={clay.iconToolBtn}
                      style={{ width: 22, height: 22 }}
                      aria-label="Aramayı temizle"
                      onClick={() => setSearch('')}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>

              {visibleMovements.length === 0 ? (
                <div className={clay.emptyHero}>
                  <span className={`${clay.iconChipSm} ${clay.chipMint}`} aria-hidden="true">
                    <History size={16} color="#ffffff" />
                  </span>
                  <span>Henüz kaydedilmiş stok veya bakım hareketi yok.</span>
                </div>
              ) : (
                <div className={clay.tableShell}>
                  <table className={clay.table}>
                    <thead>
                      <tr>
                        <th>Tür</th>
                        <th>Kalem / İşlem</th>
                        <th>Miktar</th>
                        <th>Tutar</th>
                        <th>Tarih</th>
                        <th>İşlemi Yapan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleMovements.map((mv) => {
                        const isLoss = /imha|fire|zayi/i.test(mv.movementTypeLabel)
                        const isEntry = /giriş|alım/i.test(mv.movementTypeLabel)
                        const badgeClass = isLoss
                          ? clay.pillDanger
                          : isEntry
                            ? clay.pillGood
                            : clay.pillBrand
                        return (
                          <tr key={mv.rowId}>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span className={badgeClass}>{mv.movementTypeLabel}</span>
                            </td>
                            <td>
                              <strong style={{ fontWeight: 800, color: 'var(--foreground)' }}>
                                {mv.itemTitle || mv.title}
                              </strong>
                            </td>
                            <td style={{ whiteSpace: 'nowrap', fontWeight: 800 }}>{mv.quantity} br</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {mv.totalAmount > 0 ? (
                                <span className={clay.wellPill}>{formatCurrencyTR(mv.totalAmount)}</span>
                              ) : (
                                <span className={clay.muted}>—</span>
                              )}
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>{formatDynamicDateTR(mv.date)}</td>
                            <td>{mv.actor || <span className={clay.muted}>—</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}

      <ConfirmModal
        isOpen={Boolean(confirmArchive)}
        title={confirmArchive?.kind === 'stock' ? 'Stok kalemini kaldır' : 'Bakım kaydını kaldır'}
        message={`"${confirmArchive?.name ?? ''}" kaydı listeden kaldırılacak (arşivlenecek).`}
        confirmText="Kaldır"
        variant="danger"
        onConfirm={() => void runArchive()}
        onClose={() => setConfirmArchive(null)}
      />
    </div>
  )
}
