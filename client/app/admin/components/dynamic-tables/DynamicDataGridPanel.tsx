'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type ColumnDef,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Columns3,
  Download,
  Edit3,
  FileSpreadsheet,
  Link2,
  PanelRightOpen,
  Plus,
  Search,
  Settings2,
  Table2,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import DynamicFieldInput from './cells/DynamicFieldInput'
import styles from './DynamicTablesStudio.module.css'
import ExpandedLinkedRecordsRow from './ExpandedLinkedRecordsRow'
import InlineColumnComposer from './InlineColumnComposer'
import InlineTableConnectionsBar from './InlineTableConnectionsBar'
import RowDetailDrawer from './RowDetailDrawer'
import TablePropertiesPanel from './TablePropertiesPanel'
import {
  createDynamicTableWithPurpose,
  type TablePurpose,
} from './tableSetupHelpers'
import type {
  DynamicAppointmentConfigDef,
  DynamicColumnDef,
  DynamicModuleConfigDef,
  DynamicModuleRole,
  DynamicRelationDef,
  DynamicRowItem,
  DynamicTableDef,
  LinkedRowSummary,
} from './types'

const gridFeatures = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns,
})

const columnHelper = createColumnHelper<typeof gridFeatures, DynamicRowItem>()

interface DynamicDataGridPanelProps {
  tables: DynamicTableDef[]
  allTables?: DynamicTableDef[]
  relations: DynamicRelationDef[]
  appointmentConfigs: DynamicAppointmentConfigDef[]
  moduleConfigs?: DynamicModuleConfigDef[]
  defaultNewTableModuleRole?: DynamicModuleRole
  externalSearch?: string
  selectedTableId: string | null
  canManageSchema: boolean
  refreshToken: number
  focusedDetailRowId: string | null
  onChangeFocusedDetailRowId: (rowId: string | null) => void
  onSelectTable: (tableId: string) => void
  onTableCreated: (tableId: string) => void
  onDataMutated: () => void
  onNavigateToRow: (tableId: string, rowId: string) => void
}

export default function DynamicDataGridPanel({
  tables,
  allTables,
  relations,
  appointmentConfigs,
  moduleConfigs = [],
  defaultNewTableModuleRole,
  externalSearch,
  selectedTableId,
  canManageSchema,
  refreshToken,
  focusedDetailRowId,
  onChangeFocusedDetailRowId,
  onSelectTable,
  onTableCreated,
  onDataMutated,
  onNavigateToRow,
}: DynamicDataGridPanelProps) {
  const effectiveAllTables = allTables ?? tables
  const activeTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId) || tables[0] || null,
    [tables, selectedTableId]
  )

  const [rows, setRows] = useState<DynamicRowItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [importing, setImporting] = useState(false)

  // Inline create-table / rename-table / delete-table states
  const [addingTableInline, setAddingTableInline] = useState(false)
  const [newTableName, setNewTableName] = useState('')
  const [newTablePurpose, setNewTablePurpose] = useState<TablePurpose>('person')
  const [creatingTable, setCreatingTable] = useState(false)
  const [renamingTableId, setRenamingTableId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmDeleteActiveTable, setConfirmDeleteActiveTable] = useState(false)

  // Inline panels (mutually exclusive: 'properties', 'connections', or 'column')
  const [openTableProperties, setOpenTableProperties] = useState(false)
  const [openConnectionsBar, setOpenConnectionsBar] = useState(false)
  const [columnComposer, setColumnComposer] = useState<{
    open: boolean
    editing: DynamicColumnDef | null
  }>({ open: false, editing: null })

  // Expandable Master-Detail row ID
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  // Inline new-row draft state
  const [addingRowInline, setAddingRowInline] = useState(false)
  const [draftRowValues, setDraftRowValues] = useState<Record<string, any>>({})
  const [draftRowRelations, setDraftRowRelations] = useState<Record<string, LinkedRowSummary[]>>({})
  const [savingNewRow, setSavingNewRow] = useState(false)

  // Inline delete confirmation states
  const [inlineDeleteRowId, setInlineDeleteRowId] = useState<string | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  const activeApptConfig = useMemo(
    () =>
      activeTable
        ? appointmentConfigs.find((c) => c.tableId === activeTable.id && c.enabled) || null
        : null,
    [activeTable, appointmentConfigs]
  )
  const activeModuleConfig = useMemo(
    () =>
      activeTable
        ? moduleConfigs.find((c) => c.tableId === activeTable.id && c.enabled) || null
        : null,
    [activeTable, moduleConfigs]
  )
  const appointmentLinked = Boolean(activeApptConfig)

  useEffect(() => {
    if (externalSearch !== undefined) {
      setSearch(externalSearch)
    }
  }, [externalSearch])

  const activeRelations = useMemo(
    () =>
      activeTable
        ? relations.filter(
            (r) => r.sourceTableId === activeTable.id || r.targetTableId === activeTable.id
          )
        : [],
    [activeTable, relations]
  )

  const hasExpandableRelations = useMemo(
    () =>
      Boolean(
        activeTable &&
          (activeTable.columns.some((c) => c.fieldType === 'relation') || appointmentLinked)
      ),
    [activeTable, appointmentLinked]
  )

  const resetDraftRow = useCallback((tbl: DynamicTableDef | null) => {
    if (!tbl) {
      setDraftRowValues({})
      setDraftRowRelations({})
      return
    }
    const initVals: Record<string, any> = {}
    for (const col of tbl.columns) {
      if (col.fieldType === 'boolean') initVals[col.id] = false
      else if (col.fieldType === 'multiselect') initVals[col.id] = []
      else if (col.fieldType !== 'relation') initVals[col.id] = ''
    }
    setDraftRowValues(initVals)
    setDraftRowRelations({})
  }, [])

  const openInlineNewRow = useCallback(() => {
    if (!activeTable) return
    setShowArchived(false)
    resetDraftRow(activeTable)
    onChangeFocusedDetailRowId(null)
    setAddingRowInline(true)
  }, [activeTable, resetDraftRow, onChangeFocusedDetailRowId])

  useEffect(() => {
    setAddingRowInline(false)
    setColumnComposer({ open: false, editing: null })
    setOpenConnectionsBar(false)
    setOpenTableProperties(false)
    setExpandedRowId(null)
    setInlineDeleteRowId(null)
    setConfirmBulkDelete(false)
    setConfirmDeleteActiveTable(false)
  }, [activeTable?.id])

  const fetchRows = useCallback(async () => {
    if (!activeTable) {
      setRows([])
      return
    }
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (showArchived) qs.set('archived', 'true')
      if (search.trim()) qs.set('search', search.trim())
      const res = await fetch(`/api/dynamic-tables/tables/${activeTable.id}/rows?${qs.toString()}`)
      const data = await res.json()
      if (Array.isArray(data)) {
        setRows(data)
      }
    } catch {
      toast.error('Tablo verileri yüklenemedi')
    } finally {
      setLoading(false)
    }
  }, [activeTable, showArchived, search])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchRows()
    }, 140)
    return () => window.clearTimeout(timer)
  }, [fetchRows, refreshToken])

  const handleSubmitInlineTable = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = newTableName.trim()
    if (!clean) {
      toast.error('Lütfen liste adını yazınız')
      return
    }
    setCreatingTable(true)
    try {
      const created = await createDynamicTableWithPurpose(
        clean,
        defaultNewTableModuleRole ? 'detail' : newTablePurpose
      )
      if (defaultNewTableModuleRole) {
        await fetch(`/api/dynamic-tables/module-configs/${created.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleRole: defaultNewTableModuleRole, enabled: true }),
        }).catch(() => {})
      }
      toast.success(
        defaultNewTableModuleRole
          ? `"${clean}" modül tablosu oluşturuldu`
          : newTablePurpose === 'person'
            ? `"${clean}" Kişi Listesi oluşturuldu ve takvime bağlandı`
            : newTablePurpose === 'service'
              ? `"${clean}" Hizmet / İşlem Listesi oluşturuldu ve takvime bağlandı`
              : `"${clean}" listesi oluşturuldu`
      )
      setNewTableName('')
      setAddingTableInline(false)
      onTableCreated(created.id)
    } catch (err: any) {
      toast.error(err?.message || 'Liste oluşturulamadı')
    } finally {
      setCreatingTable(false)
    }
  }

  const commitInlineTabRename = async (tbl: DynamicTableDef) => {
    const clean = renameDraft.trim()
    setRenamingTableId(null)
    if (!clean || clean === tbl.name) return
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${tbl.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clean }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Tablo adı değiştirilemedi')
        return
      }
      toast.success('Tablo adı güncellendi')
      onDataMutated()
    } catch {
      toast.error('Tablo adı güncellenemedi')
    }
  }

  const handleDeleteActiveTable = async () => {
    if (!activeTable) return
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${activeTable.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        toast.error('Tablo silinemedi')
        return
      }
      toast.success(`"${activeTable.name}" tablosu silindi`)
      setConfirmDeleteActiveTable(false)
      onDataMutated()
    } catch {
      toast.error('Tablo silinemedi')
    }
  }

  const submitInlineNewRow = useCallback(async () => {
    if (!activeTable || savingNewRow) return
    setSavingNewRow(true)
    try {
      const relationIdsPayload: Record<string, string[]> = {}
      for (const [colId, list] of Object.entries(draftRowRelations)) {
        relationIdsPayload[colId] = list.map((item) => item.id)
      }

      const res = await fetch(`/api/dynamic-tables/tables/${activeTable.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: draftRowValues,
          relations: relationIdsPayload,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Kayıt eklenemedi')
        return
      }
      toast.success('Yeni kayıt eklendi')
      resetDraftRow(activeTable)
      setAddingRowInline(false)
      await fetchRows()
      onDataMutated()
    } catch {
      toast.error('Kayıt eklenirken hata oluştu')
    } finally {
      setSavingNewRow(false)
    }
  }, [activeTable, savingNewRow, draftRowRelations, draftRowValues, resetDraftRow, fetchRows, onDataMutated])

  const handleInlineValueChange = useCallback(
    async (row: DynamicRowItem, col: DynamicColumnDef, nextVal: any) => {
      const prevValues = row.values
      const nextValues = { ...(row.values || {}), [col.id]: nextVal }

      setRows((curr) =>
        curr.map((r) =>
          r.id === row.id
            ? {
                ...r,
                values: nextValues,
                displayTitle: col.isPrimaryTitle && nextVal ? String(nextVal) : r.displayTitle,
              }
            : r
        )
      )

      try {
        const res = await fetch(`/api/dynamic-tables/rows/${row.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: { [col.id]: nextVal } }),
        })
        const updated = await res.json()
        if (!res.ok) {
          toast.error(updated.error || 'Hücre güncellenemedi')
          setRows((curr) => curr.map((r) => (r.id === row.id ? { ...r, values: prevValues } : r)))
          return
        }
        setRows((curr) => curr.map((r) => (r.id === row.id ? updated : r)))
      } catch {
        toast.error('Hücre güncellenirken hata oluştu')
        setRows((curr) => curr.map((r) => (r.id === row.id ? { ...r, values: prevValues } : r)))
      }
    },
    []
  )

  const handleInlineRelationChange = useCallback(
    async (
      row: DynamicRowItem,
      col: DynamicColumnDef,
      nextIds: string[],
      nextSummaries: LinkedRowSummary[]
    ) => {
      const prevRelations = row.relations
      setRows((curr) =>
        curr.map((r) =>
          r.id === row.id
            ? { ...r, relations: { ...(r.relations || {}), [col.id]: nextSummaries } }
            : r
        )
      )

      try {
        const res = await fetch(`/api/dynamic-tables/rows/${row.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relations: { [col.id]: nextIds } }),
        })
        const updated = await res.json()
        if (!res.ok) {
          toast.error(updated.error || 'Bağlantı güncellenemedi')
          setRows((curr) =>
            curr.map((r) => (r.id === row.id ? { ...r, relations: prevRelations } : r))
          )
          return
        }
        setRows((curr) => curr.map((r) => (r.id === row.id ? updated : r)))
        onDataMutated()
      } catch {
        toast.error('Bağlantı kaydedilemedi')
        setRows((curr) =>
          curr.map((r) => (r.id === row.id ? { ...r, relations: prevRelations } : r))
        )
      }
    },
    [onDataMutated]
  )

  const confirmDeleteIds = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      try {
        const res = await fetch('/api/dynamic-tables/rows/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowIds: ids }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || 'Kayıtlar silinemedi')
          return
        }
        toast.success(`${ids.length} kayıt silindi`)
        if (focusedDetailRowId && ids.includes(focusedDetailRowId)) {
          onChangeFocusedDetailRowId(null)
        }
        if (expandedRowId && ids.includes(expandedRowId)) {
          setExpandedRowId(null)
        }
        setInlineDeleteRowId(null)
        setConfirmBulkDelete(false)
        tableRef.current.resetRowSelection()
        await fetchRows()
        onDataMutated()
      } catch {
        toast.error('Silme işlemi başarısız oldu')
      }
    },
    [fetchRows, focusedDetailRowId, expandedRowId, onChangeFocusedDetailRowId, onDataMutated]
  )

  const visibleSchemaColumns = useMemo(
    () => (activeTable?.columns || []).filter((c) => c.showInTable !== false),
    [activeTable]
  )

  const columns = useMemo<ColumnDef<typeof gridFeatures, DynamicRowItem, any>[]>(() => {
    if (!activeTable) return []

    const showLeadingCol = canManageSchema || hasExpandableRelations

    const selectAndExpandCols = showLeadingCol
      ? [
          columnHelper.display({
            id: '__select__',
            size: canManageSchema ? (hasExpandableRelations ? 68 : 40) : 38,
            enableResizing: false,
            enableSorting: false,
            header: ({ table: tbl }) =>
              canManageSchema ? (
                <input
                  type="checkbox"
                  checked={tbl.getIsAllPageRowsSelected()}
                  onChange={tbl.getToggleAllPageRowsSelectedHandler()}
                  aria-label="Tümünü seç"
                  style={{ cursor: 'pointer', accentColor: '#2563eb' }}
                />
              ) : null,
            cell: ({ row }) => {
              const item = row.original
              const isExpanded = expandedRowId === item.id
              return (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {canManageSchema && (
                    <input
                      type="checkbox"
                      checked={row.getIsSelected()}
                      onChange={row.getToggleSelectedHandler()}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Satırı seç"
                      style={{ cursor: 'pointer', accentColor: '#2563eb' }}
                    />
                  )}
                  {hasExpandableRelations && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpandedRowId((curr) => (curr === item.id ? null : item.id))
                      }}
                      className={isExpanded ? depth.btnPale : depth.btn}
                      style={{ minHeight: 22, padding: '1px 4px' }}
                      title="Bu kayda bağlı diğer tablo kayıtlarını ve randevuları aç"
                    >
                      {isExpanded ? <ChevronDown size={13} /> : <ChevronRightIcon size={13} />}
                    </button>
                  )}
                </div>
              )
            },
          }),
        ]
      : []

    const dynamicCols = visibleSchemaColumns.map((col) =>
      columnHelper.accessor(
        (row) => {
          if (col.fieldType === 'relation') {
            return (row.relations?.[col.id] || []).map((i) => i.displayTitle).join(', ')
          }
          const raw = row.values?.[col.id]
          if (Array.isArray(raw)) return raw.join(', ')
          if (typeof raw === 'boolean') return raw ? 1 : 0
          return raw ?? ''
        },
        {
          id: col.id,
          size: col.width || 180,
          minSize: 100,
          maxSize: 520,
          header: () => (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                width: '100%',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                {col.fieldType === 'relation' && (
                  <Link2 size={12} style={{ color: 'var(--pc-blue)', flexShrink: 0 }} />
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {col.name}
                  {col.isRequired ? ' *' : ''}
                </span>
              </span>
              {canManageSchema && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenTableProperties(false)
                    setOpenConnectionsBar(false)
                    setColumnComposer((curr) =>
                      curr.open && curr.editing?.id === col.id
                        ? { open: false, editing: null }
                        : { open: true, editing: col }
                    )
                  }}
                  className={depth.btn}
                  style={{
                    minHeight: 22,
                    padding: '2px 5px',
                    flexShrink: 0,
                  }}
                  title="Sütunu düzenle"
                >
                  <Edit3 size={11} />
                </button>
              )}
            </div>
          ),
          cell: ({ row }) => {
            const item = row.original
            return (
              <DynamicFieldInput
                mode="readonly"
                column={col}
                value={item.values?.[col.id]}
                allTables={effectiveAllTables}
                linkedItems={item.relations?.[col.id] || []}
                onNavigateToRow={onNavigateToRow}
              />
            )
          },
        }
      )
    )

    const apptCol = appointmentLinked
      ? [
          columnHelper.accessor((row): any => row.appointmentCount || 0, {
            id: '__appointments__',
            size: 118,
            enableResizing: false,
            header: () => (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Calendar size={12} style={{ color: 'var(--pc-blue)' }} />
                <span>Randevu</span>
              </span>
            ),
            cell: ({ row }) => {
              const count = row.original.appointmentCount || 0
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setExpandedRowId(row.original.id)
                  }}
                  className={count > 0 ? depth.badge : depth.btn}
                  style={{ minHeight: 24, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}
                >
                  {count > 0 ? `${count} Randevu` : 'Yok'}
                </button>
              )
            },
          }),
        ]
      : []

    const actionsCol = columnHelper.display({
      id: '__actions__',
      size: canManageSchema ? 128 : 96,
      enableResizing: false,
      enableSorting: false,
      header: () => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>{canManageSchema ? 'İşlem' : 'Düzenle'}</span>
          {canManageSchema && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setOpenTableProperties(false)
                setOpenConnectionsBar(false)
                setColumnComposer((curr) =>
                  curr.open && !curr.editing
                    ? { open: false, editing: null }
                    : { open: true, editing: null }
                )
              }}
              className={depth.btnPale}
              style={{ minHeight: 22, padding: '1px 7px', fontSize: 10.5 }}
              title="Yeni sütun veya bağlı tablo ekle"
            >
              <Plus size={11} />
              <span>Sütun</span>
            </button>
          )}
        </div>
      ),
      cell: ({ row }) => {
        const item = row.original
        if (canManageSchema && inlineDeleteRowId === item.id) {
          return (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void confirmDeleteIds([item.id])
                }}
                className={depth.btn}
                style={{
                  minHeight: 24,
                  padding: '1px 7px',
                  fontSize: 11,
                  color: 'var(--danger)',
                  borderColor: 'var(--danger)',
                }}
              >
                Sil
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setInlineDeleteRowId(null)
                }}
                className={depth.btn}
                style={{ minHeight: 24, padding: '1px 6px', fontSize: 11 }}
              >
                İptal
              </button>
            </div>
          )
        }

        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setAddingRowInline(false)
                onChangeFocusedDetailRowId(
                  focusedDetailRowId === item.id ? null : item.id
                )
              }}
              className={focusedDetailRowId === item.id ? depth.btnPale : depth.btn}
              style={{ minHeight: 26, padding: '2px 8px', fontSize: 11 }}
              title="Kaydı düzenle"
            >
              <Edit3 size={12} />
              <span>Düzenle</span>
            </button>
            {canManageSchema && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setInlineDeleteRowId(item.id)
                }}
                className={depth.btn}
                style={{ minHeight: 26, padding: '2px 6px', color: 'var(--danger)' }}
                title="Kaydı sil"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )
      },
    })

    return [...selectAndExpandCols, ...dynamicCols, ...apptCol, actionsCol]
  }, [
    activeTable,
    visibleSchemaColumns,
    hasExpandableRelations,
    expandedRowId,
    canManageSchema,
    effectiveAllTables,
    appointmentLinked,
    inlineDeleteRowId,
    focusedDetailRowId,
    handleInlineValueChange,
    handleInlineRelationChange,
    onNavigateToRow,
    onChangeFocusedDetailRowId,
    confirmDeleteIds,
  ])

  const getRowId = useCallback((row: DynamicRowItem) => row.id, [])

  const initialTableState = useMemo(
    () => ({
      pagination: {
        pageIndex: 0,
        pageSize: 50,
      },
    }),
    []
  )

  const tableOptions = useMemo(
    () => ({
      features: gridFeatures,
      columns,
      data: rows,
      columnResizeMode: 'onChange' as const,
      getRowId,
      initialState: initialTableState,
    }),
    [columns, rows, getRowId, initialTableState]
  )

  const table = useTable(tableOptions)
  const tableRef = useRef(table)
  tableRef.current = table

  useEffect(() => {
    const currentSelection = tableRef.current.state.rowSelection || {}
    if (Object.keys(currentSelection).length > 0) {
      tableRef.current.resetRowSelection()
    }
    if ((tableRef.current.state.pagination?.pageIndex || 0) !== 0) {
      tableRef.current.setPageIndex(0)
    }
  }, [activeTable?.id, showArchived])

  const pageRows = table.getRowModel().rows

  const selectedRowIds = useMemo(() => {
    const sel = table.state.rowSelection || {}
    return Object.keys(sel).filter((k) => sel[k])
  }, [table.state.rowSelection])

  const handleBulkArchiveOrRestore = async (mode: 'archive' | 'restore') => {
    if (selectedRowIds.length === 0) return
    try {
      const endpoint =
        mode === 'archive'
          ? '/api/dynamic-tables/rows/archive'
          : '/api/dynamic-tables/rows/restore'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIds: selectedRowIds }),
      })
      if (!res.ok) {
        toast.error('İşlem tamamlanamadı')
        return
      }
      toast.success(
        mode === 'archive'
          ? `${selectedRowIds.length} kayıt arşivlendi`
          : `${selectedRowIds.length} kayıt geri yüklendi`
      )
      table.resetRowSelection()
      await fetchRows()
      onDataMutated()
    } catch {
      toast.error('İşlem sırasında hata oluştu')
    }
  }

  const handleDownloadTemplate = async () => {
    if (!activeTable) return
    try {
      const XLSX = await import('xlsx')
      const headers = activeTable.columns.map((c) => c.name)
      const sampleRow: Record<string, any> = {}
      for (const col of activeTable.columns) {
        if (col.fieldType === 'phone') sampleRow[col.name] = '0532 000 00 00'
        else if (col.fieldType === 'email') sampleRow[col.name] = 'ornek@eposta.com'
        else if (col.fieldType === 'date') sampleRow[col.name] = '2026-05-15'
        else if (col.fieldType === 'number' || col.fieldType === 'currency') sampleRow[col.name] = 1500
        else if (col.fieldType === 'boolean') sampleRow[col.name] = 'Evet'
        else if (col.fieldType === 'select')
          sampleRow[col.name] = col.config?.options?.[0]?.label || 'Seçenek'
        else if (col.fieldType === 'multiselect')
          sampleRow[col.name] = (col.config?.options || [])
            .slice(0, 2)
            .map((o) => o.label)
            .join(', ')
        else if (col.fieldType === 'relation') sampleRow[col.name] = 'Bağlı Kayıt Adı'
        else sampleRow[col.name] = col.isPrimaryTitle ? 'Örnek Kayıt Adı' : 'Örnek Metin'
      }

      const ws = XLSX.utils.json_to_sheet([sampleRow], { header: headers })
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, activeTable.name.slice(0, 31))
      XLSX.writeFile(wb, `${activeTable.slug || 'tablo'}_sablon.xlsx`)
    } catch {
      toast.error('Excel şablonu oluşturulamadı')
    }
  }

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !activeTable) return

    setImporting(true)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const firstSheet = wb.SheetNames[0]
      if (!firstSheet) {
        toast.error('Dosyada sayfa bulunamadı')
        return
      }
      const rawJson = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[firstSheet]!, {
        defval: '',
      })
      if (rawJson.length === 0) {
        toast.error('Aktarılacak veri satırı bulunamadı')
        return
      }

      const normalize = (s: string) => s.trim().toLocaleLowerCase('tr-TR')
      const colLookup = new Map<string, DynamicColumnDef>()
      for (const col of activeTable.columns) {
        colLookup.set(normalize(col.name), col)
        colLookup.set(normalize(col.slug), col)
      }

      const payloadRows = rawJson.map((raw) => {
        const values: Record<string, any> = {}
        const relationTitles: Record<string, string[]> = {}

        for (const [headerKey, cellVal] of Object.entries(raw)) {
          const col = colLookup.get(normalize(headerKey))
          if (!col) continue
          const text = String(cellVal ?? '').trim()
          if (!text && col.fieldType !== 'boolean') continue

          if (col.fieldType === 'relation') {
            relationTitles[col.id] = text
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean)
          } else if (col.fieldType === 'boolean') {
            values[col.id] = ['evet', 'true', '1', 'aktif', 'var'].includes(normalize(text))
          } else if (col.fieldType === 'select') {
            const matched = col.config?.options?.find(
              (o) => normalize(o.label) === normalize(text) || normalize(o.id) === normalize(text)
            )
            values[col.id] = matched ? matched.id : text
          } else if (col.fieldType === 'multiselect') {
            const parts = text
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean)
            values[col.id] = parts.map((p) => {
              const matched = col.config?.options?.find(
                (o) => normalize(o.label) === normalize(p) || normalize(o.id) === normalize(p)
              )
              return matched ? matched.id : p
            })
          } else {
            values[col.id] = cellVal
          }
        }

        return { values, relationTitles }
      })

      const res = await fetch(`/api/dynamic-tables/tables/${activeTable.id}/rows/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payloadRows }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Excel aktarımı başarısız')
        return
      }
      toast.success(`${data.importedCount || 0} kayıt başarıyla aktarıldı`)
      await fetchRows()
      onDataMutated()
    } catch {
      toast.error('Excel dosyası okunurken hata oluştu')
    } finally {
      setImporting(false)
    }
  }

  if (!activeTable) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 36,
          textAlign: 'center',
        }}
      >
        <Table2 size={34} style={{ color: 'var(--pc-blue)' }} />
        <strong style={{ fontSize: 15 }}>Henüz Tablo Oluşturmadınız</strong>
        <span style={{ fontSize: 13, color: 'var(--pc-muted)', maxWidth: 400 }}>
          Yukarıdaki hazır örnek şablonlardan birini yükleyebilir veya aşağıya ilk tablonuzun adını yazıp başlayabilirsiniz.
        </span>
        {canManageSchema && (
          <form
            onSubmit={handleSubmitInlineTable}
            style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}
          >
            <input
              type="text"
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
              placeholder="Tablo adı (Örn: Müşteriler)…"
              className={depth.input}
              style={{ width: 230, minHeight: 34, fontSize: 13 }}
              autoFocus
            />
            <button type="submit" disabled={creatingTable} className={depth.btnPrimary}>
              <Plus size={15} color="#ffffff" />
              <span>{creatingTable ? 'Oluşturuluyor…' : 'Tabloyu Oluştur'}</span>
            </button>
          </form>
        )}
      </div>
    )
  }

  const pageCount = Math.max(1, table.getPageCount())
  const currentPageIndex = table.state.pagination?.pageIndex || 0

  return (
    <>
      {/* Table Tabs Bar */}
      <div className={styles.tableTabsBar}>
        <div className={styles.tableTabsStrip}>
          {tables.map((t) => {
            const active = t.id === activeTable.id
            if (renamingTableId === t.id) {
              return (
                <div key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <input
                    type="text"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => void commitInlineTabRename(t)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitInlineTabRename(t)
                      if (e.key === 'Escape') setRenamingTableId(null)
                    }}
                    className={depth.input}
                    style={{ width: 150, minHeight: 29, padding: '2px 8px', fontSize: 12.5 }}
                    autoFocus
                  />
                </div>
              )
            }

            return (
              <div key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => {
                    onSelectTable(t.id)
                    onChangeFocusedDetailRowId(null)
                  }}
                  className={active ? depth.btnPrimary : depth.btn}
                  style={{ minHeight: 31, padding: '4px 11px', fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }}
                  title={t.name}
                >
                  <Table2 size={13} color={active ? '#ffffff' : undefined} />
                  <span>{t.name}</span>
                  <span style={{ fontSize: 11, opacity: active ? 0.92 : 0.72, fontWeight: 700 }}>
                    ({t.rowCount})
                  </span>
                </button>
                {canManageSchema && active && (
                  <button
                    type="button"
                    onClick={() => {
                      setRenameDraft(t.name)
                      setRenamingTableId(t.id)
                    }}
                    className={depth.btn}
                    style={{ minHeight: 29, padding: '3px 7px' }}
                    title="Tablo adını düzenle"
                  >
                    <Edit3 size={11} />
                  </button>
                )}
              </div>
            )
          })}

          {canManageSchema && !addingTableInline && (
            <button
              type="button"
              onClick={() => {
                setNewTableName('')
                setNewTablePurpose('detail')
                setOpenTableProperties(false)
                setOpenConnectionsBar(false)
                setColumnComposer({ open: false, editing: null })
                setAddingTableInline(true)
              }}
              className={depth.btnPale}
              style={{ minHeight: 30, padding: '3px 11px', fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              <Plus size={13} />
              <span>Yeni Tablo</span>
            </button>
          )}
        </div>

        {/* Active Table Properties (Includes Randevu Relation Settings & Live Preview) */}
        {canManageSchema && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => {
                setAddingTableInline(false)
                setOpenConnectionsBar(false)
                setColumnComposer({ open: false, editing: null })
                setOpenTableProperties((v) => !v)
              }}
              className={openTableProperties || appointmentLinked ? depth.btnPale : depth.btn}
              style={{ minHeight: 30, padding: '4px 11px', fontSize: 12 }}
              title="Tablo adı, randevu ile ilişkisi ve canlı randevu önizlemesini aç"
            >
              <Settings2 size={13} />
              <span>Tablo Özellikleri</span>
              {appointmentLinked && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: 'var(--card-bg)',
                    border: '1px solid var(--pc-border)',
                  }}
                >
                  Randevu Açık
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Inline New Table Strip */}
      {addingTableInline && canManageSchema && (
        <form
          onSubmit={handleSubmitInlineTable}
          style={{
            padding: '10px 16px',
            borderBottom: '1.5px solid var(--pc-border)',
            background: 'var(--card-inner)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: '1 1 260px', minWidth: 0 }}>
            <input
              type="text"
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setAddingTableInline(false)
              }}
              placeholder="Yeni tablo adı (Örn: Müşteriler, Portföy İlanları, Sigorta Teklifleri)…"
              className={depth.input}
              style={{ width: 'min(260px, 100%)', minHeight: 31, fontSize: 12.5 }}
              autoFocus
            />

            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--pc-muted)' }}>
              Başlangıç Şablonu:
            </span>
            {[
              { key: 'detail' as const, label: 'Detay / Yardımcı Liste' },
              { key: 'person' as const, label: 'Kişi / Müşteri (+ Randevu Açık)' },
              { key: 'service' as const, label: 'Hizmet / Teklif / İlan (+ Çoklu Randevu)' },
            ].map((opt) => {
              const selected = newTablePurpose === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setNewTablePurpose(opt.key)}
                  className={selected ? depth.btnPale : depth.btn}
                  style={{ minHeight: 28, padding: '2px 10px', fontSize: 11.5 }}
                >
                  <span>{opt.label}</span>
                </button>
              )
            })}
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button
              type="submit"
              disabled={creatingTable}
              className={depth.btnPrimary}
              style={{ minHeight: 30, padding: '4px 13px', fontSize: 12 }}
            >
              <Check size={13} color="#ffffff" />
              <span>{creatingTable ? 'Oluşturuluyor…' : 'Tabloyu Oluştur'}</span>
            </button>
            <button
              type="button"
              onClick={() => setAddingTableInline(false)}
              className={depth.btn}
              style={{ minHeight: 30, padding: '4px 9px', fontSize: 12 }}
            >
              <X size={13} />
              <span>Vazgeç</span>
            </button>
          </div>
        </form>
      )}

      {/* Inline Table Properties Panel (General + Randevu Relation Properties + Live Preview) */}
      {openTableProperties && canManageSchema && (
        <TablePropertiesPanel
          activeTable={activeTable}
          allTables={effectiveAllTables}
          relations={relations}
          allAppointmentConfigs={appointmentConfigs}
          appointmentConfig={activeApptConfig}
          moduleConfig={activeModuleConfig}
          onClose={() => setOpenTableProperties(false)}
          onMutated={onDataMutated}
          onTableDeleted={() => {
            setOpenTableProperties(false)
            onDataMutated()
          }}
        />
      )}

      {/* Grid Action & Connection Toolbar */}
      <div className={styles.gridToolbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: '1 1 220px', minWidth: 0 }}>
          <div className={styles.searchBoxWrap}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--pc-muted)',
              }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`${activeTable.name} içinde ara…`}
              className={depth.input}
              style={{ paddingLeft: 30, minHeight: 32, fontSize: 12.5, width: '100%' }}
            />
          </div>

          {canManageSchema && (
            <div className={depth.segmentTrack}>
              <button
                type="button"
                onClick={() => setShowArchived(false)}
                className={`${depth.segment} ${!showArchived ? depth.segmentActive : ''}`}
              >
                Aktif ({activeTable.rowCount})
              </button>
              <button
                type="button"
                onClick={() => setShowArchived(true)}
                className={`${depth.segment} ${showArchived ? depth.segmentActive : ''}`}
              >
                Arşiv ({activeTable.archivedRowCount || 0})
              </button>
            </div>
          )}

          {activeTable.description && (
            <span style={{ fontSize: 12, color: 'var(--pc-muted)' }}>
              {activeTable.description}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {canManageSchema && (
            <button
              type="button"
              onClick={() => {
                setAddingTableInline(false)
                setOpenTableProperties(false)
                setColumnComposer({ open: false, editing: null })
                setOpenConnectionsBar((v) => !v)
              }}
              className={openConnectionsBar || activeRelations.length > 0 ? depth.btnPale : depth.btn}
              style={{ minHeight: 31, padding: '4px 10px', fontSize: 12 }}
            >
              <Link2 size={13} />
              <span>
                {activeRelations.length > 0
                  ? `Bağlı Tablolar (${activeRelations.length})`
                  : 'Başka Tabloyla Bağla'}
              </span>
            </button>
          )}

          {canManageSchema && (
            <button
              type="button"
              onClick={() => {
                setAddingTableInline(false)
                setOpenTableProperties(false)
                setOpenConnectionsBar(false)
                setColumnComposer((curr) =>
                  curr.open && !curr.editing
                    ? { open: false, editing: null }
                    : { open: true, editing: null }
                )
              }}
              className={columnComposer.open && !columnComposer.editing ? depth.btnPale : depth.btn}
              style={{ minHeight: 31, padding: '4px 10px', fontSize: 12 }}
            >
              <Columns3 size={13} />
              <span>Sütun Ekle</span>
            </button>
          )}

          {canManageSchema && (
            <>
              <button
                type="button"
                onClick={() => void handleDownloadTemplate()}
                className={depth.btn}
                style={{ minHeight: 31, padding: '4px 10px', fontSize: 12 }}
                title="Bu tablonun alanlarına uygun Excel şablonunu indir"
              >
                <Download size={13} />
                <span>Şablon</span>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => void handleImportExcel(e)}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                className={depth.btnMint}
                style={{ minHeight: 31, padding: '4px 10px', fontSize: 12 }}
              >
                <FileSpreadsheet size={13} />
                <span>{importing ? 'Aktarılıyor…' : 'Excel Yükle'}</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              if (addingRowInline) {
                setAddingRowInline(false)
              } else {
                openInlineNewRow()
              }
            }}
            className={depth.btnPrimary}
            style={{ minHeight: 31, padding: '4px 12px', fontSize: 12.5 }}
          >
            <Plus size={14} color="#ffffff" />
            <span>{addingRowInline ? 'Satır Açık' : 'Yeni Kayıt'}</span>
          </button>
        </div>
      </div>

      {/* Inline Human Table Connections Bar */}
      {openConnectionsBar && canManageSchema && (
        <InlineTableConnectionsBar
          activeTable={activeTable}
          allTables={effectiveAllTables}
          relations={relations}
          onClose={() => setOpenConnectionsBar(false)}
          onMutated={onDataMutated}
        />
      )}

      {/* Inline Column Composer Strip */}
      {columnComposer.open && canManageSchema && (
        <InlineColumnComposer
          table={activeTable}
          allTables={effectiveAllTables}
          editingColumn={columnComposer.editing}
          onClose={() => setColumnComposer({ open: false, editing: null })}
          onSaved={onDataMutated}
        />
      )}

      {/* Bulk Action Bar */}
      {canManageSchema && selectedRowIds.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '7px 14px',
            background: 'var(--pc-tint)',
            borderBottom: '1px solid var(--pc-border)',
            fontSize: 12.5,
          }}
        >
          <strong style={{ color: 'var(--pc-tint-fg)' }}>
            {selectedRowIds.length} kayıt seçildi
          </strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {!showArchived ? (
              <button
                type="button"
                onClick={() => void handleBulkArchiveOrRestore('archive')}
                className={depth.btn}
                style={{ minHeight: 28, padding: '3px 10px', fontSize: 12 }}
              >
                <Archive size={13} />
                <span>Arşivle</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleBulkArchiveOrRestore('restore')}
                className={depth.btn}
                style={{ minHeight: 28, padding: '3px 10px', fontSize: 12 }}
              >
                <ArchiveRestore size={13} />
                <span>Geri Yükle</span>
              </button>
            )}

            {!confirmBulkDelete ? (
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(true)}
                className={depth.btn}
                style={{ minHeight: 28, padding: '3px 10px', fontSize: 12, color: 'var(--danger)' }}
              >
                <Trash2 size={13} />
                <span>Kalıcı Sil</span>
              </button>
            ) : (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--danger)' }}>
                  Silinsin mi?
                </span>
                <button
                  type="button"
                  onClick={() => void confirmDeleteIds(selectedRowIds)}
                  className={depth.btn}
                  style={{
                    minHeight: 27,
                    padding: '2px 9px',
                    fontSize: 11.5,
                    color: 'var(--danger)',
                    borderColor: 'var(--danger)',
                  }}
                >
                  Evet, Sil
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(false)}
                  className={depth.btn}
                  style={{ minHeight: 27, padding: '2px 8px', fontSize: 11.5 }}
                >
                  Vazgeç
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Area: Data Table + Optional Right Detail Card */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div ref={viewportRef} className={styles.gridViewport}>
            <table className={styles.dataTable}>
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const canSort = header.column.getCanSort()
                      const sorted = header.column.getIsSorted()
                      return (
                        <th
                          key={header.id}
                          className={styles.thCell}
                          style={{ width: header.getSize() }}
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 4,
                              cursor: canSort ? 'pointer' : 'default',
                            }}
                          >
                            <table.FlexRender header={header} />
                            {canSort && (
                              <span
                                style={{
                                  color: 'var(--pc-muted)',
                                  flexShrink: 0,
                                  display: 'inline-flex',
                                }}
                              >
                                {sorted === 'asc' ? (
                                  <ArrowUp size={12} />
                                ) : sorted === 'desc' ? (
                                  <ArrowDown size={12} />
                                ) : (
                                  <ArrowUpDown size={11} style={{ opacity: 0.45 }} />
                                )}
                              </span>
                            )}
                          </div>
                          {header.column.getCanResize() && (
                            <div
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              onClick={(e) => e.stopPropagation()}
                              className={`${styles.resizer} ${
                                header.column.getIsResizing() ? styles.resizerActive : ''
                              }`}
                            />
                          )}
                        </th>
                      )
                    })}
                  </tr>
                ))}
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      style={{ padding: 28, textAlign: 'center', color: 'var(--pc-muted)', fontSize: 13 }}
                    >
                      Veriler yükleniyor…
                    </td>
                  </tr>
                ) : pageRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      style={{ padding: 32, textAlign: 'center', color: 'var(--pc-muted)', fontSize: 13 }}
                    >
                      {search.trim() ? (
                        'Arama kriterine uygun kayıt bulunamadı.'
                      ) : showArchived ? (
                        'Arşivde kayıt bulunmuyor.'
                      ) : (
                        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                          <span>&quot;{activeTable.name}&quot; tablosunda henüz kayıt yok.</span>
                          <button
                            type="button"
                            onClick={openInlineNewRow}
                            className={depth.btnPale}
                            style={{ minHeight: 29, padding: '3px 12px', fontSize: 12 }}
                          >
                            <Plus size={13} />
                            <span>İlk Kaydı Ekle</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  <>
                    {pageRows.map((row) => {
                      const isSelected =
                        row.getIsSelected() || focusedDetailRowId === row.original.id
                      const isExpanded = expandedRowId === row.original.id
                      return (
                        <React.Fragment key={row.id}>
                          <tr
                            className={`${styles.trRow} ${
                              isSelected || isExpanded ? styles.trRowSelected : ''
                            }`}
                          >
                            {row.getVisibleCells().map((cell) => (
                              <td
                                key={cell.id}
                                className={styles.tdCell}
                                style={{ width: cell.column.getSize() }}
                              >
                                <table.FlexRender cell={cell} />
                              </td>
                            ))}
                          </tr>

                          {isExpanded && hasExpandableRelations && (
                            <ExpandedLinkedRecordsRow
                              colSpan={columns.length}
                              parentRow={row.original}
                              activeTable={activeTable}
                              allTables={effectiveAllTables}
                              appointmentLinked={appointmentLinked}
                              onParentRelationUpdated={(col, ids, summaries) =>
                                handleInlineRelationChange(row.original, col, ids, summaries)
                              }
                              onDataMutated={() => {
                                void fetchRows()
                                onDataMutated()
                              }}
                              onNavigateToRow={onNavigateToRow}
                            />
                          )}
                        </React.Fragment>
                      )
                    })}

                    {/* Yeni Kayıt Ekleme Satırı */}
                    {!showArchived && (
                      <tr>
                        <td
                          colSpan={columns.length}
                          onClick={openInlineNewRow}
                          style={{
                            padding: '9px 14px',
                            borderBottom: '1px solid var(--pc-border)',
                            background: 'var(--card-bg)',
                            color: 'var(--pc-tint-fg)',
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Plus size={13} />
                            <span>Yeni kayıt ekle…</span>
                          </span>
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer Pagination Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
              padding: '8px 14px',
              borderTop: '1px solid var(--pc-border)',
              background: 'var(--card-bg)',
              fontSize: 12,
              color: 'var(--foreground-2)',
            }}
          >
            <span>
              Toplam <strong>{rows.length}</strong> kayıt
              {hasExpandableRelations
                ? ' • Satırların solundaki ok ile bağlı kayıtları açabilirsiniz'
                : ''}
            </span>

            <div className={depth.pager}>
              <button
                type="button"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
                className={depth.pagerBtn}
                title="Önceki sayfa"
              >
                <ChevronLeft size={14} />
              </button>
              <span style={{ padding: '0 8px', fontWeight: 700, fontSize: 12 }}>
                {currentPageIndex + 1} / {pageCount}
              </span>
              <button
                type="button"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
                className={depth.pagerBtn}
                title="Sonraki sayfa"
              >
                <ChevronRightIcon size={14} />
              </button>
            </div>
          </div>
        </div>

        <RowDetailDrawer
          rowId={focusedDetailRowId}
          isCreatingNew={addingRowInline}
          table={activeTable}
          allTables={effectiveAllTables}
          hasAppointmentLink={appointmentLinked}
          canManageSchema={canManageSchema}
          onClose={() => {
            onChangeFocusedDetailRowId(null)
            setAddingRowInline(false)
          }}
          onRowMutated={() => {
            void fetchRows()
            onDataMutated()
          }}
          onNavigateToRow={onNavigateToRow}
        />
      </div>
    </>
  )
}
