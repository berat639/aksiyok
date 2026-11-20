'use client'

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'
import {
  Check,
  ChevronDown,
  Edit3,
  Link2,
  Plus,
  Search,
  Table2,
  X,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { matchesPhoneSearch } from '@/lib/phone-mask'
import depth from '@/styles/clinic-depth.module.css'
import DynamicFieldInput from './cells/DynamicFieldInput'
import {
  formatCurrencyTR,
  formatDynamicDateTR,
  type DynamicColumnDef,
  type DynamicRelationDef,
  type DynamicTableDef,
} from './types'

export interface AppointmentContextRow {
  id: string
  tableId: string
  displayTitle: string
  phone: string | null
  values: Record<string, any>
}

export interface AppointmentContextTableEntry {
  table: DynamicTableDef
  moduleRole?: string | null
  config?: {
    id: string
    tableId: string
    enabled: boolean
    titleColumnId: string | null
    phoneColumnId: string | null
    emailColumnId: string | null
    isRequiredInAppointment: boolean
    allowMultiple?: boolean
    includeRelatedTables?: boolean
  } | null
  columns: DynamicColumnDef[]
  rows: AppointmentContextRow[]
}

export interface AppointmentBookingContextData {
  hasAnyDynamicTables: boolean
  linkedTables: AppointmentContextTableEntry[]
  allTables: AppointmentContextTableEntry[]
  relations: DynamicRelationDef[]
  rowLinks: Array<{
    relationId: string
    sourceRowId: string
    targetRowId: string
  }>
}

export interface AppointmentDynamicRecordsHandle {
  flushPendingChanges: () => Promise<{
    ok: boolean
    selectedIdsByTable: Record<string, string[]>
  }>
}

interface RowFieldBadge {
  colId: string
  label: string
  value: string
}

function extractRowFieldBadges(
  row: AppointmentContextRow,
  columns: DynamicColumnDef[],
  titleColId?: string | null,
  limit = 5
): RowFieldBadge[] {
  const badges: RowFieldBadge[] = []
  for (const col of columns) {
    if (col.fieldType === 'relation') continue
    if (col.isPrimaryTitle || col.id === titleColId) continue
    const raw = row.values?.[col.id]
    if (raw === null || raw === undefined || raw === '') continue

    let formatted = ''
    if (col.fieldType === 'boolean') {
      if (raw === true) formatted = 'Evet'
      else continue
    } else if (col.fieldType === 'currency') {
      formatted = formatCurrencyTR(raw, col.config?.currencySymbol || '₺')
    } else if (col.fieldType === 'date') {
      formatted = formatDynamicDateTR(raw)
    } else if (col.fieldType === 'select') {
      const opt = col.config?.options?.find((o) => o.id === raw)
      formatted = opt ? opt.label : String(raw)
    } else if (col.fieldType === 'multiselect' && Array.isArray(raw) && raw.length > 0) {
      const labels = raw.map(
        (id) => col.config?.options?.find((o) => o.id === id)?.label || String(id)
      )
      formatted = labels.join(', ')
    } else {
      formatted = String(raw).trim()
    }

    if (!formatted) continue
    badges.push({
      colId: col.id,
      label: col.name,
      value: formatted,
    })
    if (badges.length >= limit) break
  }
  return badges
}

function summarizeRowValues(
  row: AppointmentContextRow,
  columns: DynamicColumnDef[],
  titleColId?: string | null
): string {
  return extractRowFieldBadges(row, columns, titleColId, 3)
    .map((b) => `${b.label}: ${b.value}`)
    .join(' • ')
}

function buildInitialFieldDraft(columns: DynamicColumnDef[]): Record<string, any> {
  const init: Record<string, any> = {}
  for (const col of columns) {
    if (col.fieldType === 'relation') continue
    if (col.fieldType === 'boolean') init[col.id] = false
    else if (col.fieldType === 'multiselect') init[col.id] = []
    else init[col.id] = ''
  }
  return init
}

function hasMeaningfulDraftInput(
  draft: Record<string, any> | undefined,
  relDraft?: Record<string, string[]>
): boolean {
  if (draft) {
    for (const val of Object.values(draft)) {
      if (typeof val === 'string' && val.trim().length > 0) return true
      if (typeof val === 'number' && !Number.isNaN(val)) return true
      if (val === true) return true
      if (Array.isArray(val) && val.length > 0) return true
    }
  }
  if (relDraft) {
    for (const ids of Object.values(relDraft)) {
      if (Array.isArray(ids) && ids.length > 0) return true
    }
  }
  return false
}

function isFullWidthColumn(col: DynamicColumnDef): boolean {
  return (
    col.isPrimaryTitle ||
    col.fieldType === 'multiselect' ||
    col.fieldType === 'boolean' ||
    /(not|aciklama|açıklama|adres|detay)/i.test(`${col.name} ${col.slug}`)
  )
}

interface AppointmentDynamicRecordsSectionProps {
  context: AppointmentBookingContextData
  selectedIdsByTable: Record<string, string[]>
  onChangeSelectedIdsByTable: (next: Record<string, string[]>) => void
  onRefreshContext: () => Promise<void> | void
  /** Called whenever a record's own fields are edited (useful to refresh calendar event titles) */
  onRecordDataUpdated?: () => void
  /** 'quick-create' restricts UI to fast booking-flow fields only without extra/unlinked tables or deep nested editors */
  mode?: 'quick-create' | 'full'
}

const AppointmentDynamicRecordsSection = forwardRef<
  AppointmentDynamicRecordsHandle,
  AppointmentDynamicRecordsSectionProps
>(function AppointmentDynamicRecordsSection(
  {
    context,
    selectedIdsByTable,
    onChangeSelectedIdsByTable,
    onRefreshContext,
    onRecordDataUpdated,
    mode = 'full',
  },
  ref
) {
  const isQuickCreate = mode === 'quick-create'
  const [extraEnabledTableIds, setExtraEnabledTableIds] = useState<string[]>([])

  const tableEntryById = useMemo(() => {
    const map = new Map<string, AppointmentContextTableEntry>()
    for (const t of context.allTables) map.set(t.table.id, t)
    for (const lt of context.linkedTables) map.set(lt.table.id, lt)
    return map
  }, [context.allTables, context.linkedTables])

  const effectiveLinkedTables = useMemo<AppointmentContextTableEntry[]>(() => {
    const orderedLinked = [...context.linkedTables].sort(
      (a, b) => Number(Boolean(a.config?.allowMultiple)) - Number(Boolean(b.config?.allowMultiple))
    )
    if (isQuickCreate) {
      return orderedLinked
    }

    const baseIds = new Set(orderedLinked.map((lt) => lt.table.id))
    const extras: AppointmentContextTableEntry[] = []

    for (const entry of context.allTables) {
      if (baseIds.has(entry.table.id)) continue
      const hasSelected = (selectedIdsByTable[entry.table.id]?.length || 0) > 0
      const isManuallyOpened = extraEnabledTableIds.includes(entry.table.id)
      if (!hasSelected && !isManuallyOpened) continue
      extras.push({
        ...entry,
        config: entry.config || {
          id: `extra_${entry.table.id}`,
          tableId: entry.table.id,
          enabled: true,
          titleColumnId: null,
          phoneColumnId: null,
          emailColumnId: null,
          isRequiredInAppointment: false,
          allowMultiple: true,
          includeRelatedTables: true,
        },
      })
    }

    return [...orderedLinked, ...extras]
  }, [context.linkedTables, context.allTables, selectedIdsByTable, extraEnabledTableIds, isQuickCreate])

  const remainingUnlinkedTables = useMemo(() => {
    if (isQuickCreate) return []
    const activeIds = new Set(effectiveLinkedTables.map((lt) => lt.table.id))
    return context.allTables.filter((t) => !activeIds.has(t.table.id))
  }, [context.allTables, effectiveLinkedTables, isQuickCreate])

  const allTableDefs = useMemo(
    () => Array.from(tableEntryById.values()).map((e) => e.table),
    [tableEntryById]
  )

  // Picker & inline creation states per top-level table
  const [pickerOpenByTable, setPickerOpenByTable] = useState<Record<string, boolean>>({})
  const [searchByTable, setSearchByTable] = useState<Record<string, string>>({})
  const [showUnrelatedByTable, setShowUnrelatedByTable] = useState<Record<string, boolean>>({})
  const [creatingInTable, setCreatingInTable] = useState<Record<string, boolean>>({})
  const [createDraftByTable, setCreateDraftByTable] = useState<
    Record<string, Record<string, any>>
  >({})
  const [createRelDraftByTable, setCreateRelDraftByTable] = useState<
    Record<string, Record<string, string[]>>
  >({})
  const [createRelPickerOpenKey, setCreateRelPickerOpenKey] = useState<Record<string, boolean>>({})
  const [createRelSearchKey, setCreateRelSearchKey] = useState<Record<string, string>>({})
  const [createRelInlineNewKey, setCreateRelInlineNewKey] = useState<Record<string, boolean>>({})
  const [createRelInlineDraftKey, setCreateRelInlineDraftKey] = useState<
    Record<string, Record<string, any>>
  >({})
  const [savingCreateRelKey, setSavingCreateRelKey] = useState<string | null>(null)
  const [savingCreateTableId, setSavingCreateTableId] = useState<string | null>(null)

  // Expanded attached row card state (rowId -> open)
  const [expandedRowCards, setExpandedRowCards] = useState<Record<string, boolean>>({})
  const [editDraftByRowId, setEditDraftByRowId] = useState<Record<string, Record<string, any>>>({})
  const [dirtyRowIds, setDirtyRowIds] = useState<Record<string, boolean>>({})
  const [savingRowId, setSavingRowId] = useState<string | null>(null)

  // Nested related sub-table states keyed by `${parentRowId}:${relColId}`
  const [subPickerOpenKey, setSubPickerOpenKey] = useState<Record<string, boolean>>({})
  const [subPickerSearchKey, setSubPickerSearchKey] = useState<Record<string, string>>({})
  const [subCreatingKey, setSubCreatingKey] = useState<Record<string, boolean>>({})
  const [subCreateDraftKey, setSubCreateDraftKey] = useState<
    Record<string, Record<string, any>>
  >({})
  const [savingSubKey, setSavingSubKey] = useState<string | null>(null)

  // Inline editing of a nested sub-row (subRowId -> open)
  const [expandedSubRowIds, setExpandedSubRowIds] = useState<Record<string, boolean>>({})
  const [subEditDraftByRowId, setSubEditDraftByRowId] = useState<
    Record<string, Record<string, any>>
  >({})
  const [subDirtyRowIds, setSubDirtyRowIds] = useState<Record<string, boolean>>({})

  // Helper: get linked sub-row IDs for (parentRowId, relCol)
  const getLinkedSubRowIds = useCallback(
    (parentRowId: string, relCol: DynamicColumnDef): string[] => {
      const relId = relCol.config?.relationId
      if (!relId) return []
      const rel = context.relations.find((r) => r.id === relId)
      if (!rel) return []
      const isForward = rel.sourceColumnId === relCol.id
      const ids: string[] = []
      for (const lk of context.rowLinks) {
        if (lk.relationId !== rel.id) continue
        if (isForward && lk.sourceRowId === parentRowId) {
          ids.push(lk.targetRowId)
        } else if (!isForward && lk.targetRowId === parentRowId) {
          ids.push(lk.sourceRowId)
        }
      }
      return Array.from(new Set(ids))
    },
    [context.relations, context.rowLinks]
  )

  // Helper: find candidate row IDs in `tableId` related to already-selected rows in OTHER top-level tables
  const getRelatedCandidateSet = useCallback(
    (tableId: string): Set<string> | null => {
      if (context.relations.length === 0 || context.rowLinks.length === 0) return null
      const matched = new Set<string>()
      let hasOtherSelection = false

      for (const rel of context.relations) {
        if (rel.sourceTableId === tableId && rel.targetTableId !== tableId) {
          const otherSelected = selectedIdsByTable[rel.targetTableId] || []
          if (otherSelected.length > 0) {
            hasOtherSelection = true
            const otherSet = new Set(otherSelected)
            for (const lk of context.rowLinks) {
              if (lk.relationId === rel.id && otherSet.has(lk.targetRowId)) {
                matched.add(lk.sourceRowId)
              }
            }
          }
        } else if (rel.targetTableId === tableId && rel.sourceTableId !== tableId) {
          const otherSelected = selectedIdsByTable[rel.sourceTableId] || []
          if (otherSelected.length > 0) {
            hasOtherSelection = true
            const otherSet = new Set(otherSelected)
            for (const lk of context.rowLinks) {
              if (lk.relationId === rel.id && otherSet.has(lk.sourceRowId)) {
                matched.add(lk.targetRowId)
              }
            }
          }
        }
      }

      return hasOtherSelection ? matched : null
    },
    [context.relations, context.rowLinks, selectedIdsByTable]
  )

  const buildInitialRelationDraft = useCallback(
    (columns: DynamicColumnDef[]): Record<string, string[]> => {
      const relInit: Record<string, string[]> = {}
      for (const col of columns) {
        if (col.fieldType === 'relation' && col.config?.targetTableId) {
          const otherSelected = selectedIdsByTable[col.config.targetTableId] || []
          if (otherSelected.length > 0) {
            relInit[col.id] =
              col.config.allowMultiple !== false ? [...otherSelected] : [otherSelected[0]!]
          } else {
            relInit[col.id] = []
          }
        }
      }
      return relInit
    },
    [selectedIdsByTable]
  )

  const toggleExpandRowCard = (row: AppointmentContextRow, columns: DynamicColumnDef[]) => {
    setExpandedRowCards((prev) => {
      const nextOpen = !prev[row.id]
      if (nextOpen) {
        const draft: Record<string, any> = {}
        for (const col of columns) {
          if (col.fieldType === 'relation') continue
          const v = row.values?.[col.id]
          if (col.fieldType === 'boolean') draft[col.id] = Boolean(v)
          else if (col.fieldType === 'multiselect') draft[col.id] = Array.isArray(v) ? v : []
          else draft[col.id] = v ?? ''
        }
        setEditDraftByRowId((d) => ({ ...d, [row.id]: draft }))
        setDirtyRowIds((d) => ({ ...d, [row.id]: false }))
      }
      return { ...prev, [row.id]: nextOpen }
    })
  }

  const handleSaveRowFields = async (rowId: string, isSubRow = false, silent = false) => {
    const values = isSubRow ? subEditDraftByRowId[rowId] : editDraftByRowId[rowId]
    if (!values) return true
    setSavingRowId(rowId)
    try {
      const res = await fetch(`/api/dynamic-tables/rows/${rowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Kayıt bilgileri güncellenemedi')
        return false
      }
      if (isSubRow) {
        setSubDirtyRowIds((prev) => ({ ...prev, [rowId]: false }))
      } else {
        setDirtyRowIds((prev) => ({ ...prev, [rowId]: false }))
      }
      if (!silent) {
        await onRefreshContext()
        onRecordDataUpdated?.()
        toast.success('Bilgiler güncellendi')
      }
      return true
    } catch {
      toast.error('Kayıt kaydedilirken hata oluştu')
      return false
    } finally {
      setSavingRowId(null)
    }
  }

  const buildRelationsPayloadForCreate = useCallback(
    (entry: AppointmentContextTableEntry): Record<string, string[]> => {
      const explicitRels = createRelDraftByTable[entry.table.id] || {}
      const relationsPayload: Record<string, string[]> = {}

      for (const col of entry.columns) {
        if (col.fieldType !== 'relation' || !col.config?.targetTableId) continue
        const explicitIds = explicitRels[col.id]
        if (Array.isArray(explicitIds) && explicitIds.length > 0) {
          relationsPayload[col.id] =
            col.config.allowMultiple !== false ? explicitIds : [explicitIds[0]!]
        } else {
          const otherSelected = selectedIdsByTable[col.config.targetTableId] || []
          if (otherSelected.length > 0) {
            relationsPayload[col.id] =
              col.config.allowMultiple !== false ? otherSelected : [otherSelected[0]!]
          }
        }
      }
      return relationsPayload
    },
    [createRelDraftByTable, selectedIdsByTable]
  )

  const handleCreateTopLevelRow = async (
    entry: AppointmentContextTableEntry,
    silent = false,
    baseSelectedMap: Record<string, string[]> = selectedIdsByTable
  ): Promise<{ ok: boolean; nextSelectedMap: Record<string, string[]> }> => {
    const draft = createDraftByTable[entry.table.id] || {}
    const allowMultiple = Boolean(entry.config?.allowMultiple)
    const relationsPayload = buildRelationsPayloadForCreate(entry)

    setSavingCreateTableId(entry.table.id)
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${entry.table.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: draft,
          relations: relationsPayload,
        }),
      })
      const created = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(created.error || `${entry.table.name} kaydı eklenemedi`)
        return { ok: false, nextSelectedMap: baseSelectedMap }
      }

      const prevSelected = baseSelectedMap[entry.table.id] || []
      const nextIds = allowMultiple
        ? Array.from(new Set([...prevSelected, created.id]))
        : [created.id]

      const nextSelectedMap: Record<string, string[]> = {
        ...baseSelectedMap,
        [entry.table.id]: nextIds,
      }

      setCreatingInTable((prev) => ({ ...prev, [entry.table.id]: false }))
      setCreateDraftByTable((prev) => ({ ...prev, [entry.table.id]: {} }))
      setCreateRelDraftByTable((prev) => ({ ...prev, [entry.table.id]: {} }))

      if (!silent) {
        await onRefreshContext()
        onChangeSelectedIdsByTable(nextSelectedMap)
        const hasRelations = entry.columns.some((c) => c.fieldType === 'relation')
        if (hasRelations) {
          setExpandedRowCards((prev) => ({ ...prev, [created.id]: true }))
          setEditDraftByRowId((prev) => ({ ...prev, [created.id]: created.values || draft }))
        }
        toast.success(`"${created.displayTitle || entry.table.name}" eklendi`)
      }

      return { ok: true, nextSelectedMap }
    } catch {
      toast.error('Kayıt oluşturulurken hata oluştu')
      return { ok: false, nextSelectedMap: baseSelectedMap }
    } finally {
      setSavingCreateTableId(null)
    }
  }

  const handleCreateInlineTargetForCreateForm = async (
    parentTableId: string,
    relCol: DynamicColumnDef,
    targetEntry: AppointmentContextTableEntry
  ) => {
    const relKey = `${parentTableId}:${relCol.id}`
    const draft = createRelInlineDraftKey[relKey] || {}
    setSavingCreateRelKey(relKey)
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${targetEntry.table.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: draft }),
      })
      const created = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(created.error || `${targetEntry.table.name} oluşturulamadı`)
        return
      }
      const allowMulti = relCol.config?.allowMultiple !== false
      setCreateRelDraftByTable((prev) => {
        const curTable = prev[parentTableId] || {}
        const curIds = curTable[relCol.id] || []
        const nextIds = allowMulti
          ? Array.from(new Set([...curIds, created.id]))
          : [created.id]
        return {
          ...prev,
          [parentTableId]: {
            ...curTable,
            [relCol.id]: nextIds,
          },
        }
      })
      setCreateRelInlineNewKey((prev) => ({ ...prev, [relKey]: false }))
      await onRefreshContext()
      toast.success(`"${created.displayTitle || targetEntry.table.name}" oluşturuldu ve seçildi`)
    } catch {
      toast.error('Bağlantılı kayıt eklenirken hata oluştu')
    } finally {
      setSavingCreateRelKey(null)
    }
  }

  const handleUpdateParentSubLinks = async (
    parentRowId: string,
    relCol: DynamicColumnDef,
    nextSubIds: string[]
  ) => {
    const key = `${parentRowId}:${relCol.id}`
    setSavingSubKey(key)
    try {
      const res = await fetch(`/api/dynamic-tables/rows/${parentRowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relations: {
            [relCol.id]: nextSubIds,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Bağlantı güncellenemedi')
        return
      }
      await onRefreshContext()
    } catch {
      toast.error('Bağlantı kaydedilemedi')
    } finally {
      setSavingSubKey(null)
    }
  }

  const handleCreateAndAttachSubRow = async (
    parentRowId: string,
    relCol: DynamicColumnDef,
    subEntry: AppointmentContextTableEntry,
    silent = false
  ): Promise<boolean> => {
    const key = `${parentRowId}:${relCol.id}`
    const draft = subCreateDraftKey[key] || {}
    setSavingSubKey(key)
    try {
      const createRes = await fetch(`/api/dynamic-tables/tables/${subEntry.table.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: draft }),
      })
      const createdSub = await createRes.json().catch(() => ({}))
      if (!createRes.ok) {
        toast.error(createdSub.error || `${subEntry.table.name} eklenemedi`)
        return false
      }

      const currentSubIds = getLinkedSubRowIds(parentRowId, relCol)
      const allowMultiSub = relCol.config?.allowMultiple !== false
      const nextSubIds = allowMultiSub
        ? Array.from(new Set([...currentSubIds, createdSub.id]))
        : [createdSub.id]

      const linkRes = await fetch(`/api/dynamic-tables/rows/${parentRowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relations: {
            [relCol.id]: nextSubIds,
          },
        }),
      })
      if (!linkRes.ok) {
        toast.error('Alt kayıt oluşturuldu ancak bağlanamadı')
        return false
      }

      setSubCreatingKey((prev) => ({ ...prev, [key]: false }))
      if (!silent) {
        await onRefreshContext()
        toast.success(`"${createdSub.displayTitle || subEntry.table.name}" eklendi ve bağlandı`)
      }
      return true
    } catch {
      toast.error('Alt kayıt eklenirken hata oluştu')
      return false
    } finally {
      setSavingSubKey(null)
    }
  }

  // Imperative flush so clicking main modal "Kaydet" never drops unsaved dynamic field edits or open drafts
  useImperativeHandle(ref, () => ({
    flushPendingChanges: async () => {
      let workingSelectedMap: Record<string, string[]> = { ...selectedIdsByTable }
      let didMutate = false

      // 1. Auto-save any open top-level create form that has user-typed values
      for (const entry of effectiveLinkedTables) {
        if (!creatingInTable[entry.table.id]) continue
        const draft = createDraftByTable[entry.table.id]
        const relDraft = createRelDraftByTable[entry.table.id]
        if (!hasMeaningfulDraftInput(draft, relDraft)) continue

        const res = await handleCreateTopLevelRow(entry, true, workingSelectedMap)
        if (!res.ok) {
          return { ok: false, selectedIdsByTable: workingSelectedMap }
        }
        workingSelectedMap = res.nextSelectedMap
        didMutate = true
      }

      // 2. Auto-save any open sub-row create form that has user-typed values
      for (const [subKey, isOpen] of Object.entries(subCreatingKey)) {
        if (!isOpen) continue
        const subDraft = subCreateDraftKey[subKey]
        if (!hasMeaningfulDraftInput(subDraft)) continue
        const sepIdx = subKey.indexOf(':')
        if (sepIdx <= 0) continue
        const parentRowId = subKey.slice(0, sepIdx)
        const relColId = subKey.slice(sepIdx + 1)
        let matchedCol: DynamicColumnDef | undefined
        for (const entry of effectiveLinkedTables) {
          const found = entry.columns.find((c) => c.id === relColId)
          if (found) {
            matchedCol = found
            break
          }
        }
        const subTableId = matchedCol?.config?.targetTableId
        const subEntry = subTableId ? tableEntryById.get(subTableId) : undefined
        if (matchedCol && subEntry) {
          const ok = await handleCreateAndAttachSubRow(parentRowId, matchedCol, subEntry, true)
          if (!ok) {
            return { ok: false, selectedIdsByTable: workingSelectedMap }
          }
          didMutate = true
        }
      }

      // 3. Auto-save any dirty inline edits on attached rows & sub-rows
      for (const [rowId, isDirty] of Object.entries(dirtyRowIds)) {
        if (!isDirty) continue
        const ok = await handleSaveRowFields(rowId, false, true)
        if (!ok) return { ok: false, selectedIdsByTable: workingSelectedMap }
        didMutate = true
      }

      for (const [subRowId, isSubDirty] of Object.entries(subDirtyRowIds)) {
        if (!isSubDirty) continue
        const ok = await handleSaveRowFields(subRowId, true, true)
        if (!ok) return { ok: false, selectedIdsByTable: workingSelectedMap }
        didMutate = true
      }

      if (didMutate) {
        onChangeSelectedIdsByTable(workingSelectedMap)
        await onRefreshContext()
        onRecordDataUpdated?.()
      }

      return { ok: true, selectedIdsByTable: workingSelectedMap }
    },
  }))

  if (effectiveLinkedTables.length === 0 && remainingUnlinkedTables.length === 0) {
    return null
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {effectiveLinkedTables.map((entry) => {
        const allowMultiple = Boolean(entry.config?.allowMultiple)
        const isRequired = Boolean(entry.config?.isRequiredInAppointment)
        const includeRelated = entry.config?.includeRelatedTables !== false

        const selectedIds = selectedIdsByTable[entry.table.id] || []
        const selectedRows = selectedIds
          .map((id) => entry.rows.find((r) => r.id === id))
          .filter((r): r is AppointmentContextRow => Boolean(r))

        const isCreating = Boolean(creatingInTable[entry.table.id])
        const isPickerOpen =
          Boolean(pickerOpenByTable[entry.table.id]) ||
          (!allowMultiple && selectedRows.length === 0 && !isCreating)

        const searchQuery = searchByTable[entry.table.id] || ''
        const relatedSet = getRelatedCandidateSet(entry.table.id)
        const showUnrelated = Boolean(showUnrelatedByTable[entry.table.id])

        const filteredCandidates = entry.rows.filter((r) => {
          if (selectedIds.includes(r.id)) return false
          const q = searchQuery.trim().toLocaleLowerCase('tr-TR')
          if (!q) return true
          if (r.displayTitle.toLocaleLowerCase('tr-TR').includes(q)) return true
          if (matchesPhoneSearch(r.phone, searchQuery)) return true
          return Object.values(r.values || {}).some((v) =>
            String(v ?? '')
              .toLocaleLowerCase('tr-TR')
              .includes(q)
          )
        })

        const prioritizedCandidates =
          relatedSet && !searchQuery.trim() && !showUnrelated
            ? filteredCandidates.filter((r) => relatedSet.has(r.id))
            : filteredCandidates

        // Show ALL connected relation columns for this table in full mode; omit deep relation management in quick-create
        const allRelColumns = !isQuickCreate && includeRelated
          ? entry.columns.filter(
              (c) => c.fieldType === 'relation' && Boolean(c.config?.targetTableId)
            )
          : []

        const nonRelationColumns = entry.columns.filter((c) => c.fieldType !== 'relation')
        const quickCreateEssentialCols = (() => {
          const picked = nonRelationColumns.filter(
            (c) =>
              c.isPrimaryTitle ||
              c.id === entry.config?.titleColumnId ||
              c.fieldType === 'phone' ||
              c.id === entry.config?.phoneColumnId ||
              c.isRequired
          )
          return picked.length > 0 ? picked : nonRelationColumns.slice(0, 2)
        })()
        const formColumnsToRender = isQuickCreate ? quickCreateEssentialCols : nonRelationColumns

        return (
          <div
            key={entry.table.id}
            style={{
              padding: '10px 11px',
              borderRadius: 11,
              background: 'var(--card-inner)',
              border: '1px solid var(--input-border)',
              boxShadow: 'var(--pc-neo-subcard)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {/* Section Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Table2 size={13} style={{ color: entry.table.color || 'var(--pc-blue)' }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--foreground)' }}>
                  {entry.table.name}
                  {isRequired ? ' *' : ''}
                </span>
                {!isQuickCreate && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: 'var(--pc-tint)',
                      color: 'var(--pc-tint-fg)',
                      border: '1px solid var(--pc-border)',
                    }}
                  >
                    {nonRelationColumns.length} alan
                    {allRelColumns.length > 0 ? ` • ${allRelColumns.length} bağlantı` : ''}
                  </span>
                )}
                {allowMultiple && selectedRows.length > 0 && (
                  <span className={depth.badge}>{selectedRows.length} seçili</span>
                )}
              </div>

              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {(allowMultiple || selectedRows.length === 0) && !isCreating && (
                  <button
                    type="button"
                    onClick={() =>
                      setPickerOpenByTable((prev) => ({
                        ...prev,
                        [entry.table.id]: !isPickerOpen,
                      }))
                    }
                    className={depth.btn}
                    style={{ minHeight: 26, padding: '2px 8px', fontSize: 11.5 }}
                  >
                    <Search size={11} />
                    <span>{isPickerOpen ? 'Listeyi Gizle' : 'Mevcut Seç'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (isCreating) {
                      setCreatingInTable((prev) => ({ ...prev, [entry.table.id]: false }))
                    } else {
                      setCreateDraftByTable((prev) => ({
                        ...prev,
                        [entry.table.id]: buildInitialFieldDraft(entry.columns),
                      }))
                      setCreateRelDraftByTable((prev) => ({
                        ...prev,
                        [entry.table.id]: buildInitialRelationDraft(entry.columns),
                      }))
                      setCreatingInTable((prev) => ({ ...prev, [entry.table.id]: true }))
                      setPickerOpenByTable((prev) => ({ ...prev, [entry.table.id]: false }))
                    }
                  }}
                  className={isCreating ? depth.btn : depth.btnPale}
                  style={{ minHeight: 26, padding: '2px 9px', fontSize: 11.5 }}
                >
                  {isCreating ? (
                    <>
                      <X size={11} />
                      <span>Vazgeç</span>
                    </>
                  ) : (
                    <>
                      <Plus size={12} />
                      <span>Yeni {entry.table.name}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Attached / Selected Record Cards */}
            {selectedRows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {selectedRows.map((row) => {
                  const isExpanded = !isQuickCreate && Boolean(expandedRowCards[row.id])
                  const fieldBadges = extractRowFieldBadges(
                    row,
                    formColumnsToRender,
                    entry.config?.titleColumnId,
                    isQuickCreate ? 2 : 5
                  )
                  const emptyFieldCount = nonRelationColumns.filter((c) => {
                    if (c.isPrimaryTitle || c.id === entry.config?.titleColumnId) return false
                    const v = row.values?.[c.id]
                    if (c.fieldType === 'boolean') return false
                    if (Array.isArray(v)) return v.length === 0
                    return v === null || v === undefined || String(v).trim() === ''
                  }).length

                  const rowDraft = editDraftByRowId[row.id] || row.values || {}
                  const isDirty = Boolean(dirtyRowIds[row.id])

                  return (
                    <div
                      key={row.id}
                      style={{
                        borderRadius: 9,
                        border: isExpanded
                          ? '1.5px solid var(--pc-blue)'
                          : '1px solid var(--pc-border)',
                        background: 'var(--card-bg)',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Attached Card Summary Bar */}
                      <div
                        style={{
                          padding: '8px 10px',
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: 'var(--foreground)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.displayTitle}
                          </div>

                          {/* Populated Dynamic Field Pills */}
                          {(fieldBadges.length > 0 || row.phone) && (
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 4,
                                marginTop: 4,
                              }}
                            >
                              {fieldBadges.length > 0 ? (
                                fieldBadges.map((b) => (
                                  <span
                                    key={b.colId}
                                    style={{
                                      fontSize: 10.5,
                                      fontWeight: 600,
                                      padding: '2px 7px',
                                      borderRadius: 6,
                                      background: 'var(--pc-surface)',
                                      border: '1px solid var(--pc-border)',
                                      color: 'var(--foreground-2)',
                                    }}
                                  >
                                    <strong style={{ color: 'var(--foreground)', fontWeight: 700 }}>
                                      {b.label}:
                                    </strong>{' '}
                                    {b.value}
                                  </span>
                                ))
                              ) : row.phone ? (
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: 'var(--foreground-2)',
                                    fontWeight: 600,
                                  }}
                                >
                                  📞 {row.phone}
                                </span>
                              ) : null}
                            </div>
                          )}

                          {/* Connected Relation Pills (e.g. Mülk Sahibi: Kemal Arslan • Özellikler: 2) */}
                          {allRelColumns.length > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                flexWrap: 'wrap',
                                marginTop: 5,
                              }}
                            >
                              {allRelColumns.map((rc) => {
                                const linkedIds = getLinkedSubRowIds(row.id, rc)
                                const subTarget = rc.config?.targetTableId
                                  ? tableEntryById.get(rc.config.targetTableId)
                                  : undefined
                                const linkedTitles = subTarget
                                  ? linkedIds
                                      .map((id) => subTarget.rows.find((sr) => sr.id === id)?.displayTitle)
                                      .filter(Boolean)
                                  : []
                                const labelText =
                                  linkedTitles.length > 0
                                    ? `${rc.name}: ${linkedTitles.slice(0, 2).join(', ')}${linkedTitles.length > 2 ? ` +${linkedTitles.length - 2}` : ''}`
                                    : `${rc.name}: + Bağla`
                                return (
                                  <button
                                    key={rc.id}
                                    type="button"
                                    onClick={() => {
                                      if (!isExpanded) toggleExpandRowCard(row, entry.columns)
                                    }}
                                    className={depth.badge}
                                    style={{ cursor: 'pointer', fontSize: 10.5 }}
                                  >
                                    <Link2 size={10} />
                                    <span>{labelText}</span>
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>

                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            flexShrink: 0,
                          }}
                        >
                          {!isQuickCreate && (
                            <button
                              type="button"
                              onClick={() => toggleExpandRowCard(row, entry.columns)}
                              className={isExpanded ? depth.btnPrimary : depth.btn}
                              style={{ minHeight: 26, padding: '2px 8px', fontSize: 11 }}
                              title="Tablo alanlarını ve bağlı kayıtları doldur / düzenle"
                            >
                              <Edit3 size={11} color={isExpanded ? '#ffffff' : undefined} />
                              <span style={isExpanded ? { color: '#ffffff' } : undefined}>
                                {isExpanded
                                  ? 'Kapat'
                                  : emptyFieldCount > 0
                                    ? `Alanlar (${nonRelationColumns.length})`
                                    : 'Düzenle'}
                              </span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              const nextForTable = selectedIds.filter((id) => id !== row.id)
                              onChangeSelectedIdsByTable({
                                ...selectedIdsByTable,
                                [entry.table.id]: nextForTable,
                              })
                            }}
                            className={depth.btn}
                            style={{ minHeight: 26, padding: '2px 6px', color: 'var(--danger)' }}
                            title="Randevudan kaldır"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Expanded Inline Field Editor + Connected Relational Tables */}
                      {isExpanded && (
                        <div
                          style={{
                            padding: '10px 10px 11px',
                            borderTop: '1px solid var(--pc-border)',
                            background: 'var(--pc-surface)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 10,
                          }}
                        >
                          {/* 1. Direct Fields of this Record (Compact 2-Column Grid) */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 6,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: 'var(--pc-muted)',
                                }}
                              >
                                {entry.table.name} Tablo Alanları
                              </span>
                              {isDirty && (
                                <button
                                  type="button"
                                  disabled={savingRowId === row.id}
                                  onClick={() => void handleSaveRowFields(row.id, false)}
                                  className={depth.btnPrimary}
                                  style={{ minHeight: 25, padding: '2px 9px', fontSize: 11 }}
                                >
                                  <Check size={12} color="#ffffff" />
                                  <span style={{ color: '#ffffff' }}>
                                    {savingRowId === row.id ? 'Kaydediliyor…' : 'Alanları Güncelle'}
                                  </span>
                                </button>
                              )}
                            </div>

                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                                gap: 8,
                              }}
                            >
                              {nonRelationColumns.map((col) => (
                                <div
                                  key={col.id}
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 3,
                                    gridColumn: isFullWidthColumn(col) ? '1 / -1' : undefined,
                                  }}
                                >
                                  <label
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 600,
                                      color: 'var(--foreground-2)',
                                    }}
                                  >
                                    {col.name}
                                    {col.isRequired ? ' *' : ''}
                                  </label>
                                  <DynamicFieldInput
                                    mode="form"
                                    column={col}
                                    value={rowDraft[col.id]}
                                    onChange={(val) => {
                                      setEditDraftByRowId((prev) => ({
                                        ...prev,
                                        [row.id]: { ...(prev[row.id] || {}), [col.id]: val },
                                      }))
                                      setDirtyRowIds((prev) => ({ ...prev, [row.id]: true }))
                                    }}
                                    allTables={allTableDefs}
                                  />
                                </div>
                              ))}
                            </div>

                            {isDirty && (
                              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button
                                  type="button"
                                  disabled={savingRowId === row.id}
                                  onClick={() => void handleSaveRowFields(row.id, false)}
                                  className={depth.btnPrimary}
                                  style={{ minHeight: 28, padding: '3px 11px', fontSize: 11.5 }}
                                >
                                  <Check size={12} color="#ffffff" />
                                  <span style={{ color: '#ffffff' }}>
                                    {savingRowId === row.id
                                      ? 'Kaydediliyor…'
                                      : 'Değişiklikleri Kaydet'}
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>

                          {/* 2. Connected Relational Tables (Both Sub-Tables & Linked Tables) */}
                          {allRelColumns.map((relCol) => {
                            const subTableId = relCol.config?.targetTableId
                            const subEntry = subTableId ? tableEntryById.get(subTableId) : undefined
                            if (!subEntry) return null

                            const subKey = `${row.id}:${relCol.id}`
                            const linkedSubIds = getLinkedSubRowIds(row.id, relCol)
                            const linkedSubRows = linkedSubIds
                              .map((sid) => subEntry.rows.find((sr) => sr.id === sid))
                              .filter((sr): sr is AppointmentContextRow => Boolean(sr))

                            const allowMultiSub = relCol.config?.allowMultiple !== false
                            const isSubPickerOpen = Boolean(subPickerOpenKey[subKey])
                            const isSubCreating = Boolean(subCreatingKey[subKey])
                            const subSearch = subPickerSearchKey[subKey] || ''
                            const isSubBusy = savingSubKey === subKey

                            const availableSubRows = subEntry.rows.filter((sr) => {
                              if (linkedSubIds.includes(sr.id)) return false
                              const q = subSearch.trim().toLocaleLowerCase('tr-TR')
                              if (!q) return true
                              if (sr.displayTitle.toLocaleLowerCase('tr-TR').includes(q)) return true
                              return Object.values(sr.values || {}).some((v) =>
                                String(v ?? '')
                                  .toLocaleLowerCase('tr-TR')
                                  .includes(q)
                              )
                            })

                            return (
                              <div
                                key={relCol.id}
                                style={{
                                  padding: '9px 10px',
                                  borderRadius: 9,
                                  border: '1px solid var(--pc-border)',
                                  background: 'var(--card-bg)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 7,
                                }}
                              >
                                {/* Sub-Table Header */}
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 6,
                                    flexWrap: 'wrap',
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 700,
                                      color: 'var(--foreground)',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 5,
                                    }}
                                  >
                                    <Link2 size={12} style={{ color: 'var(--pc-blue)' }} />
                                    <span>
                                      {relCol.name} ({linkedSubRows.length})
                                    </span>
                                  </span>

                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    {(allowMultiSub || linkedSubRows.length === 0) && (
                                      <button
                                        type="button"
                                        disabled={isSubBusy}
                                        onClick={() => {
                                          setSubCreatingKey((prev) => ({ ...prev, [subKey]: false }))
                                          setSubPickerOpenKey((prev) => ({
                                            ...prev,
                                            [subKey]: !isSubPickerOpen,
                                          }))
                                        }}
                                        className={depth.btn}
                                        style={{ minHeight: 24, padding: '2px 7px', fontSize: 11 }}
                                      >
                                        <span>{isSubPickerOpen ? 'Gizle' : '+ Mevcut Bağla'}</span>
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      disabled={isSubBusy}
                                      onClick={() => {
                                        if (isSubCreating) {
                                          setSubCreatingKey((prev) => ({ ...prev, [subKey]: false }))
                                        } else {
                                          setSubPickerOpenKey((prev) => ({
                                            ...prev,
                                            [subKey]: false,
                                          }))
                                          setSubCreateDraftKey((prev) => ({
                                            ...prev,
                                            [subKey]: buildInitialFieldDraft(subEntry.columns),
                                          }))
                                          setSubCreatingKey((prev) => ({ ...prev, [subKey]: true }))
                                        }
                                      }}
                                      className={isSubCreating ? depth.btn : depth.btnPale}
                                      style={{ minHeight: 24, padding: '2px 8px', fontSize: 11 }}
                                    >
                                      {isSubCreating ? 'Vazgeç' : `+ Yeni ${subEntry.table.name}`}
                                    </button>
                                  </div>
                                </div>

                                {/* Linked Sub-Rows List */}
                                {linkedSubRows.length === 0 && !isSubCreating && !isSubPickerOpen ? (
                                  <div style={{ fontSize: 11.5, color: 'var(--pc-muted)' }}>
                                    Henüz bağlı {subEntry.table.name.toLocaleLowerCase('tr-TR')} seçilmedi.
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    {linkedSubRows.map((subRow) => {
                                      const subSummary = summarizeRowValues(
                                        subRow,
                                        subEntry.columns,
                                        subEntry.config?.titleColumnId
                                      )
                                      const isSubEditing = Boolean(expandedSubRowIds[subRow.id])
                                      const subDraft =
                                        subEditDraftByRowId[subRow.id] || subRow.values || {}
                                      const isSubDirty = Boolean(subDirtyRowIds[subRow.id])

                                      return (
                                        <div
                                          key={subRow.id}
                                          style={{
                                            padding: '6px 8px',
                                            borderRadius: 8,
                                            border: '1px solid var(--pc-border)',
                                            background: 'var(--pc-surface)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 6,
                                          }}
                                        >
                                          <div
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'space-between',
                                              gap: 6,
                                            }}
                                          >
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                              <div
                                                style={{
                                                  fontSize: 12,
                                                  fontWeight: 700,
                                                  color: 'var(--foreground)',
                                                  overflow: 'hidden',
                                                  textOverflow: 'ellipsis',
                                                  whiteSpace: 'nowrap',
                                                }}
                                              >
                                                {subRow.displayTitle}
                                              </div>
                                              {subSummary && (
                                                <div
                                                  style={{
                                                    fontSize: 11,
                                                    color: 'var(--pc-muted)',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                  }}
                                                >
                                                  {subSummary}
                                                </div>
                                              )}
                                            </div>

                                            <div style={{ display: 'inline-flex', gap: 4 }}>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setExpandedSubRowIds((prev) => {
                                                    const nextOpen = !prev[subRow.id]
                                                    if (nextOpen) {
                                                      const init: Record<string, any> = {}
                                                      for (const c of subEntry.columns) {
                                                        if (c.fieldType === 'relation') continue
                                                        const v = subRow.values?.[c.id]
                                                        if (c.fieldType === 'boolean')
                                                          init[c.id] = Boolean(v)
                                                        else if (c.fieldType === 'multiselect')
                                                          init[c.id] = Array.isArray(v) ? v : []
                                                        else init[c.id] = v ?? ''
                                                      }
                                                      setSubEditDraftByRowId((d) => ({
                                                        ...d,
                                                        [subRow.id]: init,
                                                      }))
                                                      setSubDirtyRowIds((d) => ({
                                                        ...d,
                                                        [subRow.id]: false,
                                                      }))
                                                    }
                                                    return { ...prev, [subRow.id]: nextOpen }
                                                  })
                                                }}
                                                className={depth.btn}
                                                style={{
                                                  minHeight: 23,
                                                  padding: '1px 6px',
                                                  fontSize: 10.5,
                                                }}
                                              >
                                                {isSubEditing ? 'Kapat' : 'Alanlar'}
                                              </button>

                                              <button
                                                type="button"
                                                disabled={isSubBusy}
                                                onClick={() =>
                                                  void handleUpdateParentSubLinks(
                                                    row.id,
                                                    relCol,
                                                    linkedSubIds.filter((id) => id !== subRow.id)
                                                  )
                                                }
                                                className={depth.btn}
                                                style={{
                                                  minHeight: 23,
                                                  padding: '1px 5px',
                                                  color: 'var(--danger)',
                                                }}
                                                title="Bağlantıyı ayır"
                                              >
                                                <X size={12} />
                                              </button>
                                            </div>
                                          </div>

                                          {isSubEditing && (
                                            <div
                                              style={{
                                                paddingTop: 6,
                                                borderTop: '1px solid var(--pc-border)',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 6,
                                              }}
                                            >
                                              <div
                                                style={{
                                                  display: 'grid',
                                                  gridTemplateColumns:
                                                    'repeat(auto-fit, minmax(155px, 1fr))',
                                                  gap: 6,
                                                }}
                                              >
                                                {subEntry.columns
                                                  .filter((c) => c.fieldType !== 'relation')
                                                  .map((sc) => (
                                                    <div
                                                      key={sc.id}
                                                      style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: 2,
                                                        gridColumn: isFullWidthColumn(sc)
                                                          ? '1 / -1'
                                                          : undefined,
                                                      }}
                                                    >
                                                      <label
                                                        style={{
                                                          fontSize: 10.5,
                                                          fontWeight: 600,
                                                          color: 'var(--foreground-2)',
                                                        }}
                                                      >
                                                        {sc.name}
                                                      </label>
                                                      <DynamicFieldInput
                                                        mode="form"
                                                        column={sc}
                                                        value={subDraft[sc.id]}
                                                        onChange={(val) => {
                                                          setSubEditDraftByRowId((prev) => ({
                                                            ...prev,
                                                            [subRow.id]: {
                                                              ...(prev[subRow.id] || {}),
                                                              [sc.id]: val,
                                                            },
                                                          }))
                                                          setSubDirtyRowIds((prev) => ({
                                                            ...prev,
                                                            [subRow.id]: true,
                                                          }))
                                                        }}
                                                        allTables={allTableDefs}
                                                      />
                                                    </div>
                                                  ))}
                                              </div>

                                              {isSubDirty && (
                                                <div
                                                  style={{
                                                    display: 'flex',
                                                    justifyContent: 'flex-end',
                                                  }}
                                                >
                                                  <button
                                                    type="button"
                                                    disabled={savingRowId === subRow.id}
                                                    onClick={() =>
                                                      void handleSaveRowFields(subRow.id, true)
                                                    }
                                                    className={depth.btnPrimary}
                                                    style={{
                                                      minHeight: 25,
                                                      padding: '2px 9px',
                                                      fontSize: 11,
                                                    }}
                                                  >
                                                    <Check size={11} color="#ffffff" />
                                                    <span style={{ color: '#ffffff' }}>Kaydet</span>
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}

                                {/* Sub-Table Picker */}
                                {isSubPickerOpen && (
                                  <div
                                    style={{
                                      padding: 7,
                                      borderRadius: 8,
                                      border: '1px solid var(--pc-border)',
                                      background: 'var(--pc-surface)',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 5,
                                    }}
                                  >
                                    <input
                                      type="text"
                                      value={subSearch}
                                      onChange={(e) =>
                                        setSubPickerSearchKey((prev) => ({
                                          ...prev,
                                          [subKey]: e.target.value,
                                        }))
                                      }
                                      placeholder={`${subEntry.table.name} ara…`}
                                      className={depth.input}
                                      style={{ minHeight: 28, fontSize: 11.5 }}
                                    />
                                    <div
                                      style={{
                                        maxHeight: 125,
                                        overflowY: 'auto',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 3,
                                      }}
                                    >
                                      {availableSubRows.length === 0 ? (
                                        <span
                                          style={{
                                            fontSize: 11,
                                            color: 'var(--pc-muted)',
                                            padding: 4,
                                          }}
                                        >
                                          Eklenecek kayıt bulunamadı.
                                        </span>
                                      ) : (
                                        availableSubRows.slice(0, 25).map((sr) => {
                                          const srSub = summarizeRowValues(
                                            sr,
                                            subEntry.columns,
                                            subEntry.config?.titleColumnId
                                          )
                                          return (
                                            <button
                                              key={sr.id}
                                              type="button"
                                              disabled={isSubBusy}
                                              onClick={() => {
                                                const nextSubIds = allowMultiSub
                                                  ? [...linkedSubIds, sr.id]
                                                  : [sr.id]
                                                void handleUpdateParentSubLinks(
                                                  row.id,
                                                  relCol,
                                                  nextSubIds
                                                )
                                                if (!allowMultiSub) {
                                                  setSubPickerOpenKey((prev) => ({
                                                    ...prev,
                                                    [subKey]: false,
                                                  }))
                                                }
                                              }}
                                              style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '5px 8px',
                                                borderRadius: 6,
                                                border: '1px solid var(--pc-border)',
                                                background: 'var(--card-bg)',
                                                color: 'var(--foreground)',
                                                fontSize: 11.5,
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                              }}
                                            >
                                              <div style={{ minWidth: 0, flex: 1 }}>
                                                <div>{sr.displayTitle}</div>
                                                {srSub && (
                                                  <div
                                                    style={{
                                                      fontSize: 10,
                                                      color: 'var(--pc-muted)',
                                                      fontWeight: 500,
                                                    }}
                                                  >
                                                    {srSub}
                                                  </div>
                                                )}
                                              </div>
                                              <Plus size={12} style={{ color: 'var(--pc-blue)' }} />
                                            </button>
                                          )
                                        })
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Sub-Table Inline Create Form */}
                                {isSubCreating && (
                                  <div
                                    style={{
                                      padding: 8,
                                      borderRadius: 8,
                                      border: '1.5px solid var(--pc-blue)',
                                      background: 'var(--pc-surface)',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 6,
                                    }}
                                  >
                                    <div style={{ fontSize: 11.5, fontWeight: 700 }}>
                                      Yeni {subEntry.table.name} Oluştur ve Bağla
                                    </div>
                                    <div
                                      style={{
                                        display: 'grid',
                                        gridTemplateColumns:
                                          'repeat(auto-fit, minmax(155px, 1fr))',
                                        gap: 6,
                                      }}
                                    >
                                      {subEntry.columns
                                        .filter((c) => c.fieldType !== 'relation')
                                        .map((sc, idx) => (
                                          <div
                                            key={sc.id}
                                            style={{
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: 2,
                                              gridColumn: isFullWidthColumn(sc)
                                                ? '1 / -1'
                                                : undefined,
                                            }}
                                          >
                                            <label
                                              style={{
                                                fontSize: 10.5,
                                                fontWeight: 600,
                                                color: 'var(--foreground-2)',
                                              }}
                                            >
                                              {sc.name}
                                              {sc.isRequired ? ' *' : ''}
                                            </label>
                                            <DynamicFieldInput
                                              mode="form"
                                              column={sc}
                                              value={subCreateDraftKey[subKey]?.[sc.id]}
                                              onChange={(val) =>
                                                setSubCreateDraftKey((prev) => ({
                                                  ...prev,
                                                  [subKey]: {
                                                    ...(prev[subKey] || {}),
                                                    [sc.id]: val,
                                                  },
                                                }))
                                              }
                                              autoFocusField={idx === 0}
                                              allTables={allTableDefs}
                                            />
                                          </div>
                                        ))}
                                    </div>
                                    <div
                                      style={{ display: 'flex', justifyContent: 'flex-end', gap: 5 }}
                                    >
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setSubCreatingKey((prev) => ({ ...prev, [subKey]: false }))
                                        }
                                        className={depth.btn}
                                        style={{ minHeight: 25, padding: '2px 8px', fontSize: 11 }}
                                      >
                                        İptal
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isSubBusy}
                                        onClick={() =>
                                          void handleCreateAndAttachSubRow(row.id, relCol, subEntry)
                                        }
                                        className={depth.btnPrimary}
                                        style={{ minHeight: 25, padding: '2px 10px', fontSize: 11 }}
                                      >
                                        <Check size={11} color="#ffffff" />
                                        <span style={{ color: '#ffffff' }}>
                                          {isSubBusy ? 'Ekleniyor…' : 'Oluştur ve Bağla'}
                                        </span>
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
                  )
                })}
              </div>
            )}

            {/* Inline New Top-Level Record Creation Form (ALL Dynamic Fields + Connected Relational Fields!) */}
            {isCreating && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 9,
                  border: '1.5px solid var(--pc-blue)',
                  background: 'var(--card-bg)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)' }}>
                  {isQuickCreate ? `Hızlı ${entry.table.name} Ekle` : `Yeni ${entry.table.name} Kaydı ve Alanları`}
                </div>

                {/* Direct Fields Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                    gap: 8,
                  }}
                >
                  {formColumnsToRender.map((col, idx) => (
                    <div
                      key={col.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        gridColumn: isFullWidthColumn(col) ? '1 / -1' : undefined,
                      }}
                    >
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--foreground-2)',
                        }}
                      >
                        {col.name}
                        {col.isRequired ? ' *' : ''}
                      </label>
                      <DynamicFieldInput
                        mode="form"
                        column={col}
                        value={createDraftByTable[entry.table.id]?.[col.id]}
                        onChange={(val) =>
                          setCreateDraftByTable((prev) => ({
                            ...prev,
                            [entry.table.id]: {
                              ...(prev[entry.table.id] || {}),
                              [col.id]: val,
                            },
                          }))
                        }
                        autoFocusField={idx === 0}
                        allTables={allTableDefs}
                      />
                    </div>
                  ))}
                </div>
                {isQuickCreate && formColumnsToRender.length < nonRelationColumns.length && (
                  <div style={{ fontSize: 10.5, color: 'var(--pc-muted)' }}>
                    Diğer tüm alanları ve bağlı kayıtları randevu oluşturduktan sonra sağ detay panelinden düzenleyebilirsiniz.
                  </div>
                )}

                {/* Connected Relation Fields During Creation */}
                {allRelColumns.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 7,
                      paddingTop: 6,
                      borderTop: '1px solid var(--pc-border)',
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--pc-muted)' }}>
                      Bağlantılı Tablo Alanları
                    </span>
                    {allRelColumns.map((relCol) => {
                      const targetTableId = relCol.config?.targetTableId
                      const targetEntry = targetTableId
                        ? tableEntryById.get(targetTableId)
                        : undefined
                      if (!targetEntry) return null

                      const relKey = `${entry.table.id}:${relCol.id}`
                      const allowMultiRel = relCol.config?.allowMultiple !== false
                      const pickedRelIds =
                        createRelDraftByTable[entry.table.id]?.[relCol.id] || []
                      const pickedRelRows = pickedRelIds
                        .map((id) => targetEntry.rows.find((r) => r.id === id))
                        .filter((r): r is AppointmentContextRow => Boolean(r))

                      const isRelPickerOpen = Boolean(createRelPickerOpenKey[relKey])
                      const isRelInlineNew = Boolean(createRelInlineNewKey[relKey])
                      const relSearch = createRelSearchKey[relKey] || ''

                      const availableRelRows = targetEntry.rows.filter((tr) => {
                        if (pickedRelIds.includes(tr.id)) return false
                        const q = relSearch.trim().toLocaleLowerCase('tr-TR')
                        if (!q) return true
                        if (tr.displayTitle.toLocaleLowerCase('tr-TR').includes(q)) return true
                        return Object.values(tr.values || {}).some((v) =>
                          String(v ?? '')
                            .toLocaleLowerCase('tr-TR')
                            .includes(q)
                        )
                      })

                      return (
                        <div
                          key={relCol.id}
                          style={{
                            padding: '7px 9px',
                            borderRadius: 8,
                            border: '1px solid var(--pc-border)',
                            background: 'var(--pc-surface)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 6,
                              flexWrap: 'wrap',
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 700,
                                color: 'var(--foreground)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <Link2 size={11} style={{ color: 'var(--pc-blue)' }} />
                              <span>
                                {relCol.name} ({targetEntry.table.name})
                              </span>
                            </span>
                            <div style={{ display: 'inline-flex', gap: 4 }}>
                              {(allowMultiRel || pickedRelRows.length === 0) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCreateRelInlineNewKey((prev) => ({
                                      ...prev,
                                      [relKey]: false,
                                    }))
                                    setCreateRelPickerOpenKey((prev) => ({
                                      ...prev,
                                      [relKey]: !isRelPickerOpen,
                                    }))
                                  }}
                                  className={depth.btn}
                                  style={{ minHeight: 23, padding: '1px 7px', fontSize: 10.5 }}
                                >
                                  {isRelPickerOpen ? 'Gizle' : '+ Seç'}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  if (isRelInlineNew) {
                                    setCreateRelInlineNewKey((prev) => ({
                                      ...prev,
                                      [relKey]: false,
                                    }))
                                  } else {
                                    setCreateRelPickerOpenKey((prev) => ({
                                      ...prev,
                                      [relKey]: false,
                                    }))
                                    setCreateRelInlineDraftKey((prev) => ({
                                      ...prev,
                                      [relKey]: buildInitialFieldDraft(targetEntry.columns),
                                    }))
                                    setCreateRelInlineNewKey((prev) => ({
                                      ...prev,
                                      [relKey]: true,
                                    }))
                                  }
                                }}
                                className={isRelInlineNew ? depth.btn : depth.btnPale}
                                style={{ minHeight: 23, padding: '1px 7px', fontSize: 10.5 }}
                              >
                                {isRelInlineNew ? 'Vazgeç' : `+ Yeni ${targetEntry.table.name}`}
                              </button>
                            </div>
                          </div>

                          {pickedRelRows.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {pickedRelRows.map((pr) => (
                                <span
                                  key={pr.id}
                                  className={depth.badge}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 10.5,
                                  }}
                                >
                                  <span>{pr.displayTitle}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCreateRelDraftByTable((prev) => ({
                                        ...prev,
                                        [entry.table.id]: {
                                          ...(prev[entry.table.id] || {}),
                                          [relCol.id]: pickedRelIds.filter((id) => id !== pr.id),
                                        },
                                      }))
                                    }
                                    style={{
                                      border: 'none',
                                      background: 'transparent',
                                      color: 'inherit',
                                      cursor: 'pointer',
                                      padding: 0,
                                      display: 'inline-flex',
                                    }}
                                  >
                                    <X size={11} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}

                          {isRelPickerOpen && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <input
                                type="text"
                                value={relSearch}
                                onChange={(e) =>
                                  setCreateRelSearchKey((prev) => ({
                                    ...prev,
                                    [relKey]: e.target.value,
                                  }))
                                }
                                placeholder={`${targetEntry.table.name} ara…`}
                                className={depth.input}
                                style={{ minHeight: 27, fontSize: 11 }}
                              />
                              <div
                                style={{
                                  maxHeight: 110,
                                  overflowY: 'auto',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 3,
                                }}
                              >
                                {availableRelRows.length === 0 ? (
                                  <span style={{ fontSize: 10.5, color: 'var(--pc-muted)' }}>
                                    Kayıt bulunamadı.
                                  </span>
                                ) : (
                                  availableRelRows.slice(0, 20).map((tr) => (
                                    <button
                                      key={tr.id}
                                      type="button"
                                      onClick={() => {
                                        const nextRelIds = allowMultiRel
                                          ? Array.from(new Set([...pickedRelIds, tr.id]))
                                          : [tr.id]
                                        setCreateRelDraftByTable((prev) => ({
                                          ...prev,
                                          [entry.table.id]: {
                                            ...(prev[entry.table.id] || {}),
                                            [relCol.id]: nextRelIds,
                                          },
                                        }))
                                        if (!allowMultiRel) {
                                          setCreateRelPickerOpenKey((prev) => ({
                                            ...prev,
                                            [relKey]: false,
                                          }))
                                        }
                                      }}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '4px 8px',
                                        borderRadius: 6,
                                        border: '1px solid var(--pc-border)',
                                        background: 'var(--card-bg)',
                                        color: 'var(--foreground)',
                                        fontSize: 11,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                      }}
                                    >
                                      <span>{tr.displayTitle}</span>
                                      <Plus size={11} style={{ color: 'var(--pc-blue)' }} />
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}

                          {isRelInlineNew && (
                            <div
                              style={{
                                padding: 7,
                                borderRadius: 7,
                                border: '1px solid var(--pc-blue)',
                                background: 'var(--card-bg)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 5,
                              }}
                            >
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
                                  gap: 5,
                                }}
                              >
                                {targetEntry.columns
                                  .filter((c) => c.fieldType !== 'relation')
                                  .map((tc, tIdx) => (
                                    <div
                                      key={tc.id}
                                      style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 2,
                                        gridColumn: isFullWidthColumn(tc) ? '1 / -1' : undefined,
                                      }}
                                    >
                                      <label
                                        style={{
                                          fontSize: 10,
                                          fontWeight: 600,
                                          color: 'var(--foreground-2)',
                                        }}
                                      >
                                        {tc.name}
                                      </label>
                                      <DynamicFieldInput
                                        mode="form"
                                        column={tc}
                                        value={createRelInlineDraftKey[relKey]?.[tc.id]}
                                        onChange={(val) =>
                                          setCreateRelInlineDraftKey((prev) => ({
                                            ...prev,
                                            [relKey]: {
                                              ...(prev[relKey] || {}),
                                              [tc.id]: val,
                                            },
                                          }))
                                        }
                                        autoFocusField={tIdx === 0}
                                        allTables={allTableDefs}
                                      />
                                    </div>
                                  ))}
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                                <button
                                  type="button"
                                  disabled={savingCreateRelKey === relKey}
                                  onClick={() =>
                                    void handleCreateInlineTargetForCreateForm(
                                      entry.table.id,
                                      relCol,
                                      targetEntry
                                    )
                                  }
                                  className={depth.btnPrimary}
                                  style={{ minHeight: 24, padding: '2px 9px', fontSize: 10.5 }}
                                >
                                  <Check size={11} color="#ffffff" />
                                  <span style={{ color: '#ffffff' }}>
                                    {savingCreateRelKey === relKey ? 'Ekleniyor…' : 'Ekle ve Seç'}
                                  </span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 2 }}>
                  <button
                    type="button"
                    onClick={() =>
                      setCreatingInTable((prev) => ({ ...prev, [entry.table.id]: false }))
                    }
                    className={depth.btn}
                    style={{ minHeight: 28, padding: '3px 9px', fontSize: 11.5 }}
                  >
                    İptal
                  </button>
                  <button
                    type="button"
                    disabled={savingCreateTableId === entry.table.id}
                    onClick={() => void handleCreateTopLevelRow(entry)}
                    className={depth.btnPrimary}
                    style={{ minHeight: 28, padding: '3px 11px', fontSize: 11.5 }}
                  >
                    <Check size={12} color="#ffffff" />
                    <span style={{ color: '#ffffff' }}>
                      {savingCreateTableId === entry.table.id
                        ? 'Kaydediliyor…'
                        : 'Kaydet ve Randevuya Ekle'}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Existing Record Search & Selection Picker */}
            {isPickerOpen && !isCreating && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ position: 'relative' }}>
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
                    value={searchQuery}
                    onChange={(e) =>
                      setSearchByTable((prev) => ({
                        ...prev,
                        [entry.table.id]: e.target.value,
                      }))
                    }
                    placeholder={`${entry.table.name} içinde başlık veya alan ara…`}
                    className={depth.input}
                    style={{ paddingLeft: 28, minHeight: 31, fontSize: 12 }}
                  />
                </div>

                {relatedSet && !searchQuery.trim() && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 11,
                      color: 'var(--foreground-2)',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Link2 size={11} style={{ color: 'var(--pc-blue)' }} />
                      {showUnrelated
                        ? 'Tüm kayıtlar gösteriliyor'
                        : `Seçili kayda bağlı ${prioritizedCandidates.length} kayıt`}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setShowUnrelatedByTable((prev) => ({
                          ...prev,
                          [entry.table.id]: !showUnrelated,
                        }))
                      }
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--pc-blue)',
                        fontWeight: 700,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      {showUnrelated ? 'Sadece Bağlılar' : 'Tümünü Göster'}
                    </button>
                  </div>
                )}

                <div
                  style={{
                    maxHeight: 142,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {prioritizedCandidates.length === 0 ? (
                    <div
                      style={{
                        padding: '7px 8px',
                        fontSize: 11.5,
                        color: 'var(--pc-muted)',
                        textAlign: 'center',
                      }}
                    >
                      {entry.rows.length === 0
                        ? `Henüz ${entry.table.name} kaydı yok. Yukarıdan alanlarıyla yeni ekleyebilirsiniz.`
                        : 'Eşleşen kayıt bulunamadı.'}
                    </div>
                  ) : (
                    prioritizedCandidates.slice(0, 30).map((r) => {
                      const rowSub = summarizeRowValues(
                        r,
                        formColumnsToRender,
                        entry.config?.titleColumnId
                      )
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            const nextForTable = allowMultiple
                              ? Array.from(new Set([...selectedIds, r.id]))
                              : [r.id]
                            onChangeSelectedIdsByTable({
                              ...selectedIdsByTable,
                              [entry.table.id]: nextForTable,
                            })
                            if (!allowMultiple) {
                              setPickerOpenByTable((prev) => ({
                                ...prev,
                                [entry.table.id]: false,
                              }))
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            padding: '6px 9px',
                            borderRadius: 7,
                            border: '1px solid var(--pc-border)',
                            background: 'var(--card-bg)',
                            color: 'var(--foreground)',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {r.displayTitle}
                            </div>
                            {(rowSub || r.phone) && (
                              <div
                                style={{
                                  fontSize: 10.5,
                                  color: 'var(--pc-muted)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {rowSub || r.phone}
                              </div>
                            )}
                          </div>
                          <ChevronDown
                            size={12}
                            style={{ transform: 'rotate(-90deg)', color: 'var(--pc-blue)' }}
                          />
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Optional Extra Dynamic Tables Switcher (so EVERY table in workspace can be linked directly too) */}
      {remainingUnlinkedTables.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flexWrap: 'wrap',
            padding: '6px 9px',
            borderRadius: 9,
            background: 'var(--card-inner)',
            border: '1px dashed var(--input-border)',
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-3)' }}>
            Diğer tablolar:
          </span>
          {remainingUnlinkedTables.map((ut) => (
            <button
              key={ut.table.id}
              type="button"
              onClick={() => {
                setExtraEnabledTableIds((prev) =>
                  prev.includes(ut.table.id) ? prev : [...prev, ut.table.id]
                )
                setPickerOpenByTable((prev) => ({ ...prev, [ut.table.id]: true }))
              }}
              className={depth.btnPale}
              style={{ minHeight: 24, padding: '1px 8px', fontSize: 10.5 }}
            >
              <Plus size={11} />
              <span>{ut.table.name} Bağla</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

export default AppointmentDynamicRecordsSection
