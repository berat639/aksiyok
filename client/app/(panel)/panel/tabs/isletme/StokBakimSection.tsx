'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'react-hot-toast'
import {
  AlertTriangle,
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
import depth from '@/styles/clinic-depth.module.css'
import s from './isletme.module.css'

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
    return <span className={s.muted}>Stok ve bakım verileri yükleniyor…</span>
  }

  const alerts = overview?.alerts ?? {
    sktExpiredCount: 0,
    sktSoonCount: 0,
    lowStockCount: 0,
    maintenanceDueCount: 0,
    totalStockItems: 0,
    totalStockValue: 0,
  }

  if (!overview?.hasStockTables) {
    return (
      <div className={s.stack}>
        {overview?.legacyMigration.hasUnmigratedLegacyStock && canManageSchema && (
          <div className={s.panelCard}>
            <div className={s.topBar}>
              <span className={s.muted}>
                Önceki kayıtlarda <strong>{overview.legacyMigration.unmigratedItems}</strong> stok ve{' '}
                <strong>{overview.legacyMigration.unmigratedMaintenances}</strong> bakım bulundu.
              </span>
              <button type="button" className={depth.btnMint} disabled={migrating} onClick={() => void handleMigrateLegacy()}>
                <DownloadCloud size={13} />
                {migrating ? 'Aktarılıyor…' : 'Mevcut Kayıtları Aktar'}
              </button>
            </div>
          </div>
        )}

        <div className={s.panelCard}>
          <div className={s.emptyState} style={{ borderStyle: 'solid' }}>
            <Package size={20} color="var(--accent)" />
            <strong style={{ color: 'var(--foreground)' }}>Stok ve Bakım Alanını Başlatın</strong>
            <span style={{ maxWidth: 440 }}>
              Tüm işletme türleriyle uyumlu ürün, sarf malzeme, ekipman stoku, isteğe bağlı SKT ve periyodik bakım tablolarını tek tıkla oluşturun.
            </span>
            {canManageSchema ? (
              <button type="button" className={depth.btnPrimary} disabled={setupBusy} onClick={() => void initializeUniversalStock()}>
                <Plus size={13} color="#ffffff" />
                <span style={{ color: '#ffffff' }}>{setupBusy ? 'Hazırlanıyor…' : 'Stok ve Bakımı Başlat'}</span>
              </button>
            ) : (
              <span className={s.muted}>Yönetici stok alanını başlattığında kayıtlar burada görünecektir.</span>
            )}
          </div>

          {canManageSchema && unboundTables.length > 0 && (
            <form className={s.topBar} onSubmit={handleBindTable}>
              <span className={s.muted}>Veya mevcut bir tablonuzu bağlayın:</span>
              <div className={s.row} style={{ gap: 6 }}>
                <select className={s.compactInput} style={{ width: 170 }} value={bindTableId} onChange={(e) => setBindTableId(e.target.value)}>
                  <option value="">Tablo seçin…</option>
                  {unboundTables.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <select className={s.compactInput} style={{ width: 165 }} value={bindRole} onChange={(e) => setBindRole(e.target.value as any)}>
                  <option value="stock_inventory">Stok &amp; Envanter</option>
                  <option value="asset_maintenance">Periyodik Bakım</option>
                  <option value="stock_movement">Hareket Geçmişi</option>
                </select>
                <button type="submit" className={depth.btn} disabled={setupBusy || !bindTableId} style={{ minHeight: 34 }}>
                  Bağla
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={s.stack}>
      {overview.legacyMigration.hasUnmigratedLegacyStock && canManageSchema && (
        <div className={s.panelCard}>
          <div className={s.topBar}>
            <span className={s.muted}>
              Eski stok kayıtlarında <strong>{overview.legacyMigration.unmigratedItems}</strong> kalem ve{' '}
              <strong>{overview.legacyMigration.unmigratedMaintenances}</strong> bakım var.
            </span>
            <button type="button" className={depth.btnMint} style={{ minHeight: 28, fontSize: '11.5px' }} disabled={migrating} onClick={() => void handleMigrateLegacy()}>
              <DownloadCloud size={12} />
              {migrating ? 'Aktarılıyor…' : 'Aktar'}
            </button>
          </div>
        </div>
      )}

      {/* Üst Sekmeler + Envanter Değeri + Otomatik Gider Anahtarı */}
      <div className={s.topBar}>
        <div className={depth.segmentTrack} role="tablist" aria-label="Stok ve bakım görünümleri">
          <button type="button" role="tab" aria-selected={subTab === 'inventory'} className={subTab === 'inventory' ? depth.segmentActive : depth.segment} onClick={() => setSubTab('inventory')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...(subTab === 'inventory' ? { color: '#ffffff' } : {}) }}>
              <Package size={13} />Stok ({alerts.totalStockItems})
            </span>
          </button>
          <button type="button" role="tab" aria-selected={subTab === 'maintenance'} className={subTab === 'maintenance' ? depth.segmentActive : depth.segment} onClick={() => setSubTab('maintenance')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...(subTab === 'maintenance' ? { color: '#ffffff' } : {}) }}>
              <Wrench size={13} />Bakım ({overview.maintenanceItems.length})
              {alerts.maintenanceDueCount > 0 && subTab !== 'maintenance' && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)' }} />
              )}
            </span>
          </button>
          <button type="button" role="tab" aria-selected={subTab === 'history'} className={subTab === 'history' ? depth.segmentActive : depth.segment} onClick={() => setSubTab('history')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...(subTab === 'history' ? { color: '#ffffff' } : {}) }}>
              <History size={13} />Geçmiş ({overview.recentMovements.length})
            </span>
          </button>
        </div>

        <div className={s.row} style={{ gap: 10 }}>
          <span className={depth.badge}>Envanter: {formatCurrencyTR(alerts.totalStockValue)}</span>
          <label className={s.row} style={{ gap: 6, cursor: 'pointer' }}>
            <button
              type="button"
              role="switch"
              aria-checked={recordInFinance}
              aria-label="Alım ve bakım tutarlarını giderlere işle"
              className={depth.switch}
              onClick={() => setRecordInFinance((v) => !v)}
            />
            <span className={s.muted}>Gidere işle</span>
          </label>
        </div>
      </div>

      {/* Son Hareketi Geri Alma Şeridi */}
      {lastAction && (
        <div className={s.panelCard} style={{ padding: '8px 12px' }}>
          <div className={s.topBar}>
            <span className={s.muted}>
              Son işlem: <strong>{lastAction.name}</strong> · {lastAction.quantity} {lastAction.unitLabel} ({MOVEMENT_LABELS[lastAction.movementType]})
            </span>
            <div className={s.row} style={{ gap: 6 }}>
              <button type="button" className={depth.btn} style={{ minHeight: 26, padding: '2px 9px', fontSize: '11px' }} disabled={undoBusy} onClick={() => void undoLastAction()}>
                <RotateCcw size={12} /> {undoBusy ? 'Geri alınıyor…' : 'Geri al'}
              </button>
              <button type="button" className={s.iconBtn} style={{ width: 24, height: 24 }} aria-label="Bildirimi kapat" onClick={() => setLastAction(null)}>
                <X size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1. STOK & ENVANTER */}
      {subTab === 'inventory' && (
        <div className={s.stack}>
          <div className={s.topBar}>
            <div className={s.row} style={{ gap: 5 }}>
              {([
                ['all', `Tümü (${alerts.totalStockItems})`],
                ['low_stock', `Kritik (${alerts.lowStockCount})`],
                ['skt_expired', `SKT Geçmiş (${alerts.sktExpiredCount})`],
                ['skt_soon', `SKT ≤30g (${alerts.sktSoonCount})`],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={alertFilter === id ? depth.btnPrimary : depth.btn}
                  style={{ minHeight: 28, padding: '3px 9px', fontSize: '11.5px' }}
                  onClick={() => setAlertFilter(id)}
                >
                  <span style={alertFilter === id ? { color: '#ffffff' } : undefined}>{label}</span>
                </button>
              ))}
              {categoryOptions.length > 1 && (
                <select
                  aria-label="Kategori filtresi"
                  className={s.compactInput}
                  style={{ width: 'auto', minWidth: 115, height: 28, fontSize: '11.5px' }}
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="all">Tüm kategoriler</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
            </div>

            <div className={s.row} style={{ gap: 6 }}>
              <div className={s.searchInline} style={{ minWidth: 170 }}>
                <Search size={13} color="var(--foreground-3)" />
                <input aria-label="Stok kalemi ara" placeholder="Kalem veya kategori ara…" value={search} onChange={(e) => setSearch(e.target.value)} />
                {search && (
                  <button type="button" className={s.iconBtn} style={{ width: 20, height: 20 }} aria-label="Aramayı temizle" onClick={() => setSearch('')}>
                    <X size={11} />
                  </button>
                )}
              </div>
              {invMod && (
                <button type="button" className={depth.btnPrimary} style={{ minHeight: 32, padding: '4px 11px', fontSize: '12px' }} onClick={() => (stockFormOpen ? setStockFormOpen(false) : openNewStock())}>
                  <Plus size={13} color="#ffffff" />
                  <span style={{ color: '#ffffff' }}>{stockFormOpen ? 'Kapat' : 'Yeni Kalem'}</span>
                </button>
              )}
            </div>
          </div>

          {stockFormOpen && (
            <form className={s.panelCard} onSubmit={submitStock}>
              <div className={s.topBar}>
                <h3 className={s.sectionTitle}>{stockDraft.rowId ? 'Stok kalemini düzenle' : 'Yeni stok kalemi'}</h3>
                <button type="button" className={s.iconBtn} aria-label="Formu kapat" onClick={() => setStockFormOpen(false)}>
                  <X size={14} />
                </button>
              </div>

              <div className={s.stockFormGrid}>
                <input
                  aria-label="Kalem adı"
                  className={s.compactInput}
                  required
                  placeholder="Kalem adı (ör. Kâğıt havlu, Filtre, Kutu ambalaj)"
                  value={stockDraft.name}
                  onChange={(e) => setStockDraft({ ...stockDraft, name: e.target.value })}
                />
                <input
                  aria-label="Kategori"
                  list="stok-kategori-onerileri"
                  className={s.compactInput}
                  placeholder="Kategori (isteğe bağlı)"
                  value={stockDraft.category}
                  onChange={(e) => setStockDraft({ ...stockDraft, category: e.target.value })}
                />
                <datalist id="stok-kategori-onerileri">
                  {categoryOptions.map((c) => <option key={c} value={c} />)}
                </datalist>
                <input
                  aria-label="Birim"
                  list="stok-birim-onerileri"
                  className={s.compactInput}
                  placeholder="Birim"
                  value={stockDraft.unit}
                  onChange={(e) => setStockDraft({ ...stockDraft, unit: e.target.value })}
                />
                <datalist id="stok-birim-onerileri">
                  {unitOptions.map((u) => <option key={u} value={u} />)}
                </datalist>
              </div>

              <div className={s.stockNumGrid}>
                <label className={s.stack} style={{ gap: 3 }}>
                  <span className={s.muted}>Miktar</span>
                  <input type="number" min="0" className={s.compactInput} value={stockDraft.quantity} onChange={(e) => setStockDraft({ ...stockDraft, quantity: e.target.value })} />
                </label>
                <label className={s.stack} style={{ gap: 3 }}>
                  <span className={s.muted}>Kritik eşik</span>
                  <input type="number" min="0" className={s.compactInput} value={stockDraft.minThreshold} onChange={(e) => setStockDraft({ ...stockDraft, minThreshold: e.target.value })} />
                </label>
                <label className={s.stack} style={{ gap: 3 }}>
                  <span className={s.muted}>Birim maliyet (₺)</span>
                  <input type="number" min="0" step="0.01" placeholder="0,00" className={s.compactInput} value={stockDraft.unitCost} onChange={(e) => setStockDraft({ ...stockDraft, unitCost: e.target.value })} />
                </label>
                <label className={s.stack} style={{ gap: 3 }}>
                  <span className={s.muted}>Tedarikçi / Not</span>
                  <input type="text" placeholder="İsteğe bağlı" className={s.compactInput} value={stockDraft.notes} onChange={(e) => setStockDraft({ ...stockDraft, notes: e.target.value })} />
                </label>
              </div>

              <div className={s.topBar}>
                <div className={s.row} style={{ gap: 8 }}>
                  <label className={s.row} style={{ gap: 6, cursor: 'pointer' }}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={stockDraft.hasExpiry}
                      aria-label="Son kullanma tarihi ekle"
                      className={depth.switch}
                      onClick={() => setStockDraft({ ...stockDraft, hasExpiry: !stockDraft.hasExpiry })}
                    />
                    <span className={s.muted}>SKT takibi (isteğe bağlı)</span>
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

                <div className={s.row} style={{ gap: 6 }}>
                  <button type="button" className={depth.btn} style={{ minHeight: 30 }} onClick={() => setStockFormOpen(false)}>Vazgeç</button>
                  <button type="submit" className={depth.btnPrimary} style={{ minHeight: 30 }} disabled={savingStock}>
                    <Check size={13} color="#ffffff" />
                    <span style={{ color: '#ffffff' }}>{savingStock ? 'Kaydediliyor…' : stockDraft.rowId ? 'Güncelle' : 'Kaydet'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className={s.panelCard}>
            {visibleStock.length === 0 ? (
              <div className={s.emptyState}>
                <Package size={18} />
                <span>{alerts.totalStockItems === 0 ? 'Henüz stok kalemi yok. “Yeni Kalem” ile ilk kaydınızı ekleyin.' : 'Bu filtreyle eşleşen stok kalemi yok.'}</span>
              </div>
            ) : (
              <div className={s.compactList}>
                {visibleStock.map((item) => {
                  const sev = stockSeverity(item)
                  const moveOpen = activeMoveRowId === item.rowId
                  const busy = busyRowId === item.rowId
                  return (
                    <div key={item.rowId} className={s.compactRow}>
                      <div className={s.compactMain} style={{ flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                          <div className={s.row} style={{ gap: 6 }}>
                            <strong className={s.staffName}>{item.name}</strong>
                            <span className={depth.badge} style={{ fontSize: 10.5, padding: '1px 7px' }}>{item.categoryLabel}</span>
                            {sev === 'expired' && <span className={s.statusOff}><AlertTriangle size={10} />SKT Geçmiş</span>}
                            {item.isLowStock && <span className={s.statusOff}>Kritik (≤{item.minThreshold})</span>}
                            {!item.isExpired && item.isExpiringSoon && (
                              <span className={depth.badge} style={{ fontSize: 10.5, padding: '1px 7px' }}>SKT {item.daysUntilExpiry}g</span>
                            )}
                          </div>
                          <div className={s.staffSub} style={{ marginTop: 2 }}>
                            Mevcut: <strong style={{ color: 'var(--foreground)' }}>{item.quantity} {item.unitLabel}</strong>
                            {item.unitCost > 0 && ` · Birim: ${formatCurrencyTR(item.unitCost)}`}
                            {item.expiryDate && ` · SKT: ${formatDynamicDateTR(item.expiryDate)}`}
                            {item.notes && ` · ${item.notes}`}
                          </div>
                        </div>

                        <div className={s.compactActions}>
                          <button
                            type="button"
                            className={moveOpen ? depth.btnPrimary : depth.btn}
                            style={{ minHeight: 28, padding: '3px 9px', fontSize: '11.5px' }}
                            aria-expanded={moveOpen}
                            onClick={() => openMovement(item)}
                          >
                            <span style={moveOpen ? { color: '#ffffff' } : undefined}>{moveOpen ? 'Kapat' : 'Giriş / Çıkış'}</span>
                          </button>
                          <button type="button" className={s.iconBtn} title="Düzenle" aria-label={`${item.name} düzenle`} onClick={() => openEditStock(item)}>
                            <Pencil size={13} />
                          </button>
                          {canManageSchema && (
                            <button type="button" className={s.iconBtn} title="Kaldır" aria-label={`${item.name} kaldır`} style={{ color: 'var(--danger)' }} onClick={() => setConfirmArchive({ rowId: item.rowId, name: item.name, kind: 'stock' })}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>

                      {moveOpen && (
                        <div className={s.compactEdit}>
                          <div className={s.row} style={{ gap: 6 }}>
                            <input
                              type="number"
                              min="1"
                              aria-label="İşlem adedi"
                              className={s.compactInput}
                              style={{ width: 72, height: 30 }}
                              value={moveQty}
                              onChange={(e) => setMoveQty(e.target.value)}
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              aria-label="Birim maliyet"
                              placeholder="Birim ₺"
                              className={s.compactInput}
                              style={{ width: 96, height: 30 }}
                              value={moveCost}
                              onChange={(e) => setMoveCost(e.target.value)}
                            />
                            <input
                              type="text"
                              aria-label="Hareket notu"
                              placeholder="Not (isteğe bağlı)"
                              className={s.compactInput}
                              style={{ flex: 1, minWidth: 130, height: 30 }}
                              value={moveNote}
                              onChange={(e) => setMoveNote(e.target.value)}
                            />
                          </div>
                          <div className={s.row} style={{ gap: 5 }}>
                            <button type="button" disabled={busy} className={depth.btnMint} style={{ minHeight: 28, padding: '3px 9px', fontSize: '11.5px' }} onClick={() => void runMovement(item, 'giris')}>
                              <Plus size={12} />Alım / Giriş
                            </button>
                            <button type="button" disabled={busy} className={depth.btnPale} style={{ minHeight: 28, padding: '3px 9px', fontSize: '11.5px' }} onClick={() => void runMovement(item, 'cikis')}>
                              <Minus size={12} />Kullanım
                            </button>
                            <button type="button" disabled={busy} className={depth.btn} style={{ minHeight: 28, padding: '3px 8px', fontSize: '11.5px' }} onClick={() => void runMovement(item, 'iade')}>
                              <RotateCcw size={11} />İade
                            </button>
                            <button type="button" disabled={busy} className={depth.btn} style={{ minHeight: 28, padding: '3px 8px', fontSize: '11.5px' }} onClick={() => void runMovement(item, 'fire')}>
                              Fire / Zayi
                            </button>
                            <button type="button" disabled={busy} className={depth.btn} style={{ minHeight: 28, padding: '3px 8px', fontSize: '11.5px', color: 'var(--danger)' }} onClick={() => void runMovement(item, 'imha')}>
                              İmha
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. PERİYODİK BAKIM */}
      {subTab === 'maintenance' && (
        <div className={s.stack}>
          <div className={s.topBar}>
            <div className={s.row} style={{ gap: 5 }}>
              <button type="button" className={!onlyDueMaint ? depth.btnPrimary : depth.btn} style={{ minHeight: 28, padding: '3px 9px', fontSize: '11.5px' }} onClick={() => setOnlyDueMaint(false)}>
                <span style={!onlyDueMaint ? { color: '#ffffff' } : undefined}>Tümü ({overview.maintenanceItems.length})</span>
              </button>
              <button type="button" className={onlyDueMaint ? depth.btnPrimary : depth.btn} style={{ minHeight: 28, padding: '3px 9px', fontSize: '11.5px' }} onClick={() => setOnlyDueMaint(true)}>
                <span style={onlyDueMaint ? { color: '#ffffff' } : undefined}>Yaklaşan ≤14g ({alerts.maintenanceDueCount})</span>
              </button>
            </div>

            <div className={s.row} style={{ gap: 6 }}>
              <div className={s.searchInline} style={{ minWidth: 170 }}>
                <Search size={13} color="var(--foreground-3)" />
                <input aria-label="Bakım kaydı ara" placeholder="Ekipman veya servis ara…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {maintMod && (
                <button type="button" className={depth.btnPrimary} style={{ minHeight: 32, padding: '4px 11px', fontSize: '12px' }} onClick={() => (maintFormOpen ? setMaintFormOpen(false) : openNewMaint())}>
                  <Plus size={13} color="#ffffff" />
                  <span style={{ color: '#ffffff' }}>{maintFormOpen ? 'Kapat' : 'Bakım Planla'}</span>
                </button>
              )}
            </div>
          </div>

          {maintFormOpen && (
            <form className={s.panelCard} onSubmit={submitMaint}>
              <div className={s.topBar}>
                <h3 className={s.sectionTitle}>{maintDraft.rowId ? 'Bakım kaydını düzenle' : 'Yeni bakım planla'}</h3>
                <button type="button" className={s.iconBtn} aria-label="Formu kapat" onClick={() => setMaintFormOpen(false)}>
                  <X size={14} />
                </button>
              </div>

              <div className={s.stockFormGrid}>
                <input
                  aria-label="Ekipman veya varlık adı"
                  className={s.compactInput}
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
                  className={s.compactInput}
                  value={maintDraft.estimatedCost}
                  onChange={(e) => setMaintDraft({ ...maintDraft, estimatedCost: e.target.value })}
                />
              </div>

              <div className={s.topBar}>
                <div className={s.row} style={{ gap: 6 }}>
                  <label className={s.row} style={{ gap: 6, cursor: 'pointer' }}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={maintDraft.isPeriodic}
                      aria-label="Periyodik tekrarla"
                      className={depth.switch}
                      onClick={() => setMaintDraft({ ...maintDraft, isPeriodic: !maintDraft.isPeriodic })}
                    />
                    <span className={s.muted}>Periyodik</span>
                  </label>
                  {maintDraft.isPeriodic && (
                    <>
                      {PERIOD_PRESETS.map((p) => (
                        <button
                          key={p.days}
                          type="button"
                          className={String(p.days) === maintDraft.periodicDays ? s.dayBtnOn : s.dayBtn}
                          style={{ minWidth: 'auto', padding: '0 8px' }}
                          onClick={() => setMaintDraft({ ...maintDraft, periodicDays: String(p.days) })}
                        >
                          <span style={String(p.days) === maintDraft.periodicDays ? { color: '#ffffff' } : undefined}>{p.days}g</span>
                        </button>
                      ))}
                      <input
                        type="number"
                        min="1"
                        aria-label="Periyot gün sayısı"
                        className={s.compactInput}
                        style={{ width: 68, height: 28 }}
                        value={maintDraft.periodicDays}
                        onChange={(e) => setMaintDraft({ ...maintDraft, periodicDays: e.target.value })}
                      />
                    </>
                  )}
                </div>

                <div className={s.row} style={{ gap: 6 }}>
                  <input
                    type="text"
                    aria-label="Servis veya not"
                    placeholder="Yetkili servis / not"
                    className={s.compactInput}
                    style={{ width: 170, height: 30 }}
                    value={maintDraft.notes}
                    onChange={(e) => setMaintDraft({ ...maintDraft, notes: e.target.value })}
                  />
                  <button type="submit" className={depth.btnPrimary} style={{ minHeight: 30 }} disabled={savingMaint}>
                    <Check size={13} color="#ffffff" />
                    <span style={{ color: '#ffffff' }}>{savingMaint ? 'Kaydediliyor…' : maintDraft.rowId ? 'Güncelle' : 'Planla'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className={s.panelCard}>
            {visibleMaint.length === 0 ? (
              <div className={s.emptyState}>
                <CalendarClock size={18} />
                <span>{overview.maintenanceItems.length === 0 ? 'Planlanmış bakım kaydı yok.' : 'Bu filtrede bakım kaydı yok.'}</span>
              </div>
            ) : (
              <div className={s.compactList}>
                {visibleMaint.map((m) => {
                  const busy = busyRowId === m.rowId
                  const openComplete = activeCompleteRowId === m.rowId
                  const overdue = m.daysUntilDue !== null && m.daysUntilDue < 0
                  return (
                    <div key={m.rowId} className={s.compactRow}>
                      <div className={s.compactMain} style={{ flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                          <div className={s.row} style={{ gap: 6 }}>
                            <strong className={s.staffName}>{m.name}</strong>
                            {m.isPeriodic && m.periodicDays > 0 && (
                              <span className={depth.badge} style={{ fontSize: 10.5, padding: '1px 7px' }}>Her {m.periodicDays}g</span>
                            )}
                            {overdue ? (
                              <span className={s.statusOff}>{Math.abs(m.daysUntilDue!)} gün gecikti</span>
                            ) : m.isMaintenanceDue && m.daysUntilDue !== null ? (
                              <span className={depth.badge} style={{ fontSize: 10.5, padding: '1px 7px' }}>{m.daysUntilDue} gün kaldı</span>
                            ) : m.status === 'completed' ? (
                              <span className={s.statusOk}>Tamamlandı</span>
                            ) : null}
                          </div>
                          <div className={s.staffSub} style={{ marginTop: 2 }}>
                            {m.effectiveDueDate ? `Tarih: ${formatDynamicDateTR(m.effectiveDueDate)}` : m.statusLabel}
                            {m.estimatedCost > 0 && ` · Tahmini: ${formatCurrencyTR(m.estimatedCost)}`}
                            {m.notes && ` · ${m.notes}`}
                          </div>
                        </div>

                        <div className={s.compactActions}>
                          <button type="button" disabled={busy} className={s.snippetChip} title="7 gün ertele" onClick={() => void postponeMaint(m, 7)}>+7g</button>
                          <button type="button" disabled={busy} className={s.snippetChip} title="30 gün ertele" onClick={() => void postponeMaint(m, 30)}>+30g</button>
                          <button
                            type="button"
                            disabled={busy}
                            className={openComplete ? depth.btn : depth.btnPrimary}
                            style={{ minHeight: 28, padding: '3px 9px', fontSize: '11.5px' }}
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
                            <span style={!openComplete ? { color: '#ffffff' } : undefined}>{openComplete ? 'Kapat' : 'Tamamla'}</span>
                          </button>
                          <button type="button" className={s.iconBtn} title="Düzenle" aria-label={`${m.name} düzenle`} onClick={() => openEditMaint(m)}>
                            <Pencil size={13} />
                          </button>
                          {canManageSchema && (
                            <button type="button" className={s.iconBtn} title="Kaldır" aria-label={`${m.name} kaldır`} style={{ color: 'var(--danger)' }} onClick={() => setConfirmArchive({ rowId: m.rowId, name: m.name, kind: 'maint' })}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>

                      {openComplete && (
                        <div className={s.compactEdit}>
                          <div className={s.row} style={{ gap: 6 }}>
                            <Clock size={13} color="var(--foreground-3)" />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              aria-label="Gerçekleşen bakım ücreti"
                              placeholder="Bakım ücreti (₺)"
                              className={s.compactInput}
                              style={{ width: 120, height: 30 }}
                              value={completeCost}
                              onChange={(e) => setCompleteCost(e.target.value)}
                            />
                            <input
                              type="text"
                              aria-label="Tamamlama notu"
                              placeholder="Yapılan işlem / not"
                              className={s.compactInput}
                              style={{ flex: 1, minWidth: 140, height: 30 }}
                              value={completeNote}
                              onChange={(e) => setCompleteNote(e.target.value)}
                            />
                            <button type="button" disabled={busy} className={depth.btnPrimary} style={{ minHeight: 30, padding: '4px 12px', fontSize: '11.5px' }} onClick={() => void completeMaint(m)}>
                              <Check size={12} color="#ffffff" />
                              <span style={{ color: '#ffffff' }}>{busy ? 'İşleniyor…' : 'Bakımı Tamamla'}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. HAREKET GEÇMİŞİ */}
      {subTab === 'history' && (
        <div className={s.panelCard}>
          <div className={s.topBar}>
            <h3 className={s.sectionTitle}>Son stok ve bakım hareketleri</h3>
            <div className={s.searchInline} style={{ minWidth: 180 }}>
              <Search size={13} color="var(--foreground-3)" />
              <input aria-label="Hareketlerde ara" placeholder="Hareket veya kişi ara…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {visibleMovements.length === 0 ? (
            <div className={s.emptyState}>
              <History size={18} />
              <span>Henüz kaydedilmiş stok veya bakım hareketi yok.</span>
            </div>
          ) : (
            <div className={s.compactList}>
              {visibleMovements.map((mv) => (
                <div key={mv.rowId} className={s.compactRow}>
                  <div className={s.compactMain}>
                    <span className={depth.badge} style={{ fontSize: 10.5, padding: '1px 7px', flexShrink: 0 }}>{mv.movementTypeLabel}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className={s.staffName}>{mv.itemTitle || mv.title}</div>
                      <div className={s.staffSub}>
                        {formatDynamicDateTR(mv.date)}
                        {mv.actor && ` · ${mv.actor}`}
                      </div>
                    </div>
                    <div className={s.compactActions}>
                      <span className={s.muted} style={{ fontWeight: 700 }}>{mv.quantity} br</span>
                      {mv.totalAmount > 0 && <span className={depth.badge}>{formatCurrencyTR(mv.totalAmount)}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
