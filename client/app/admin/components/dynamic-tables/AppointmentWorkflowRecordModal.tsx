'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Edit3, Link2, Plus, Search, Table2, Trash2, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import { matchesPhoneSearch } from '@/lib/phone-mask'
import { useBackdropDismiss } from '../../../../hooks/useBackdropDismiss'
import DynamicFieldInput from './cells/DynamicFieldInput'
import {
  buildEmptyFieldDraft,
  buildRelationDraftFromSelected,
  extractCompactFieldBadges,
  getLinkedSubRowIds,
  getRelatedRowsMapForAnchors,
  isFullWidthField,
} from './appointmentWorkflowHelpers'
import type {
  AppointmentBookingContextData,
  AppointmentContextRow,
  AppointmentContextTableEntry,
} from './AppointmentDynamicRecordsSection'
import type { DynamicColumnDef } from './types'

type ModalMode =
  | { kind: 'add'; initialTableId?: string }
  | { kind: 'edit'; entry: AppointmentContextTableEntry; row: AppointmentContextRow }

interface AppointmentWorkflowRecordModalProps {
  mode: ModalMode | null
  context: AppointmentBookingContextData
  workflowEntries: AppointmentContextTableEntry[]
  tableEntryMap: Map<string, AppointmentContextTableEntry>
  selectedIdsByTable: Record<string, string[]>
  personAnchorRowIds: string[]
  onClose: () => void
  onAttachRows: (tableId: string, rowIds: string[]) => Promise<void> | void
  onDetachRow?: (tableId: string, rowId: string) => Promise<void> | void
  onRefreshContext: () => Promise<void> | void
  onRecordMutated?: () => void
}

export default function AppointmentWorkflowRecordModal({
  mode,
  context,
  workflowEntries,
  tableEntryMap,
  selectedIdsByTable,
  personAnchorRowIds,
  onClose,
  onAttachRows,
  onDetachRow,
  onRefreshContext,
  onRecordMutated,
}: AppointmentWorkflowRecordModalProps) {
  const backdropDismiss = useBackdropDismiss(onClose)

  const allTableDefs = useMemo(
    () => Array.from(tableEntryMap.values()).map((e) => e.table),
    [tableEntryMap]
  )

  // Add mode states
  const [selectedAddTableId, setSelectedAddTableId] = useState<string>('')
  const [addSubTab, setAddSubTab] = useState<'pick' | 'create'>('pick')
  const [pickSearch, setPickSearch] = useState('')
  const [pickedCandidateIds, setPickedCandidateIds] = useState<string[]>([])

  // Create / Edit form states
  const [fieldDraft, setFieldDraft] = useState<Record<string, any>>({})
  const [relDraft, setRelDraft] = useState<Record<string, string[]>>({})
  const [relPickerOpenCol, setRelPickerOpenCol] = useState<Record<string, boolean>>({})
  const [relSearchCol, setRelSearchCol] = useState<Record<string, string>>({})
  const [relInlineCreateCol, setRelInlineCreateCol] = useState<Record<string, boolean>>({})
  const [relInlineDraftCol, setRelInlineDraftCol] = useState<Record<string, Record<string, any>>>({})
  const [savingRelCol, setSavingRelCol] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDetach, setConfirmDetach] = useState(false)

  const activeEntry: AppointmentContextTableEntry | null = useMemo(() => {
    if (!mode) return null
    if (mode.kind === 'edit') {
      return tableEntryMap.get(mode.entry.table.id) || mode.entry
    }
    return (
      workflowEntries.find((w) => w.table.id === selectedAddTableId) ||
      workflowEntries[0] ||
      null
    )
  }, [mode, selectedAddTableId, workflowEntries, tableEntryMap])

  const activeEditRow: AppointmentContextRow | null = useMemo(() => {
    if (!mode || mode.kind !== 'edit') return null
    const freshEntry = tableEntryMap.get(mode.entry.table.id)
    return freshEntry?.rows.find((r) => r.id === mode.row.id) || mode.row
  }, [mode, tableEntryMap])

  const initCreateFormForEntry = (entry: AppointmentContextTableEntry) => {
    setFieldDraft(buildEmptyFieldDraft(entry.columns))
    setRelDraft(buildRelationDraftFromSelected(entry.columns, selectedIdsByTable))
    setRelPickerOpenCol({})
    setRelSearchCol({})
    setRelInlineCreateCol({})
    setRelInlineDraftCol({})
  }

  useEffect(() => {
    if (!mode) return
    setConfirmDetach(false)
    if (mode.kind === 'add') {
      const startTable =
        workflowEntries.find((w) => w.table.id === mode.initialTableId) || workflowEntries[0]
      setSelectedAddTableId(startTable?.table.id || '')
      setAddSubTab('pick')
      setPickSearch('')
      setPickedCandidateIds([])
      if (startTable) {
        initCreateFormForEntry(startTable)
      }
      return
    }

    // Edit mode
    const entry = tableEntryMap.get(mode.entry.table.id) || mode.entry
    const row = entry.rows.find((r) => r.id === mode.row.id) || mode.row
    const initVals: Record<string, any> = {}
    for (const col of entry.columns) {
      if (col.fieldType === 'relation') continue
      const v = row.values?.[col.id]
      if (col.fieldType === 'boolean') initVals[col.id] = Boolean(v)
      else if (col.fieldType === 'multiselect') initVals[col.id] = Array.isArray(v) ? v : []
      else initVals[col.id] = v ?? ''
    }
    const initRels: Record<string, string[]> = {}
    for (const col of entry.columns) {
      if (col.fieldType === 'relation') {
        initRels[col.id] = getLinkedSubRowIds(context.relations, context.rowLinks, row.id, col)
      }
    }
    setFieldDraft(initVals)
    setRelDraft(initRels)
    setRelPickerOpenCol({})
    setRelSearchCol({})
    setRelInlineCreateCol({})
    setRelInlineDraftCol({})
  }, [mode])

  if (!mode || !activeEntry || typeof document === 'undefined' || !document.body) return null

  const nonRelationCols = activeEntry.columns.filter((c) => c.fieldType !== 'relation')
  const relationCols = activeEntry.columns.filter(
    (c) => c.fieldType === 'relation' && Boolean(c.config?.targetTableId)
  )

  const handleSwitchAddTable = (entry: AppointmentContextTableEntry) => {
    setSelectedAddTableId(entry.table.id)
    setPickSearch('')
    setPickedCandidateIds([])
    initCreateFormForEntry(entry)
  }

  const handleCreateInlineTarget = async (
    relCol: DynamicColumnDef,
    targetEntry: AppointmentContextTableEntry
  ) => {
    const draft = relInlineDraftCol[relCol.id] || {}
    setSavingRelCol(relCol.id)
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
      setRelDraft((prev) => {
        const curr = prev[relCol.id] || []
        return {
          ...prev,
          [relCol.id]: allowMulti ? Array.from(new Set([...curr, created.id])) : [created.id],
        }
      })
      setRelInlineCreateCol((prev) => ({ ...prev, [relCol.id]: false }))
      await onRefreshContext()
      toast.success(`"${created.displayTitle || targetEntry.table.name}" oluşturuldu ve bağlandı`)
    } catch {
      toast.error('Bağlı kayıt oluşturulurken hata oluştu')
    } finally {
      setSavingRelCol(null)
    }
  }

  const handleAttachSelected = async () => {
    if (pickedCandidateIds.length === 0 || saving) return
    setSaving(true)
    try {
      await onAttachRows(activeEntry.table.id, pickedCandidateIds)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleSaveCreateOrEdit = async () => {
    if (saving) return
    setSaving(true)
    try {
      if (mode.kind === 'add') {
        const res = await fetch(`/api/dynamic-tables/tables/${activeEntry.table.id}/rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: fieldDraft,
            relations: relDraft,
          }),
        })
        const created = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(created.error || `${activeEntry.table.name} eklenemedi`)
          return
        }
        await onRefreshContext()
        await onAttachRows(activeEntry.table.id, [created.id])
        toast.success(`"${created.displayTitle || activeEntry.table.name}" oluşturuldu ve randevuya eklendi`)
        onClose()
      } else if (activeEditRow) {
        const res = await fetch(`/api/dynamic-tables/rows/${activeEditRow.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: fieldDraft,
            relations: relDraft,
          }),
        })
        const updated = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(updated.error || 'Kayıt güncellenemedi')
          return
        }
        await onRefreshContext()
        onRecordMutated?.()
        toast.success('Kayıt güncellendi')
        onClose()
      }
    } catch {
      toast.error('İşlem sırasında hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  // Existing candidate rows (for Pick tab in 'add' mode)
  const alreadyLinkedInTable = selectedIdsByTable[activeEntry.table.id] || []
  const relatedToPersonSet = getRelatedRowsMapForAnchors(
    context.relations,
    context.rowLinks,
    personAnchorRowIds
  )
  const q = pickSearch.trim().toLocaleLowerCase('tr-TR')
  const candidateRows = activeEntry.rows.filter((r) => {
    if (alreadyLinkedInTable.includes(r.id)) return false
    if (!q) return true
    if (r.displayTitle.toLocaleLowerCase('tr-TR').includes(q)) return true
    if (matchesPhoneSearch(r.phone, pickSearch)) return true
    return Object.values(r.values || {}).some((v) =>
      String(v ?? '')
        .toLocaleLowerCase('tr-TR')
        .includes(q)
    )
  })
  const personRelatedCandidates = candidateRows.filter((r) => relatedToPersonSet.has(r.id))
  const otherCandidates = candidateRows.filter((r) => !relatedToPersonSet.has(r.id))

  const renderFormFieldsAndRelations = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        className={depth.subcard}
        style={{ display: 'flex', flexDirection: 'column', gap: 9 }}
      >
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
          {activeEntry.table.name} Bilgileri ve Not
        </span>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
            gap: 8,
          }}
        >
          {nonRelationCols.map((col, idx) => (
            <div
              key={col.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                gridColumn: isFullWidthField(col) ? '1 / -1' : undefined,
              }}
            >
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-2)' }}>
                {col.name}
                {col.isRequired ? ' *' : ''}
              </label>
              <DynamicFieldInput
                mode="form"
                column={col}
                value={fieldDraft[col.id]}
                onChange={(val) => setFieldDraft((prev) => ({ ...prev, [col.id]: val }))}
                autoFocusField={idx === 0}
                allTables={allTableDefs}
              />
            </div>
          ))}
        </div>
      </div>

      {relationCols.length > 0 && (
        <div
          className={depth.subcard}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
            Bağlı Tablolar & Alt Kayıtlar
          </span>

          {relationCols.map((relCol) => {
            const targetEntry = relCol.config?.targetTableId
              ? tableEntryMap.get(relCol.config.targetTableId)
              : undefined
            if (!targetEntry) return null

            const allowMulti = relCol.config?.allowMultiple !== false
            const selectedRelIds = relDraft[relCol.id] || []
            const selectedRelRows = selectedRelIds
              .map((id) => targetEntry.rows.find((r) => r.id === id))
              .filter((r): r is AppointmentContextRow => Boolean(r))

            const isPickerOpen = Boolean(relPickerOpenCol[relCol.id])
            const isInlineNew = Boolean(relInlineCreateCol[relCol.id])
            const rQuery = (relSearchCol[relCol.id] || '').trim().toLocaleLowerCase('tr-TR')
            const availRows = targetEntry.rows.filter((tr) => {
              if (selectedRelIds.includes(tr.id)) return false
              if (!rQuery) return true
              return tr.displayTitle.toLocaleLowerCase('tr-TR').includes(rQuery)
            })

            return (
              <div
                key={relCol.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: 9,
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
                      {relCol.name} ({selectedRelRows.length})
                    </span>
                  </span>

                  <div style={{ display: 'inline-flex', gap: 4 }}>
                    {(allowMulti || selectedRelRows.length === 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          setRelInlineCreateCol((prev) => ({ ...prev, [relCol.id]: false }))
                          setRelPickerOpenCol((prev) => ({ ...prev, [relCol.id]: !isPickerOpen }))
                        }}
                        className={depth.btn}
                        style={{ minHeight: 24, padding: '1px 7px', fontSize: 10.5 }}
                      >
                        {isPickerOpen ? 'Gizle' : '+ Seç'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (isInlineNew) {
                          setRelInlineCreateCol((prev) => ({ ...prev, [relCol.id]: false }))
                        } else {
                          setRelPickerOpenCol((prev) => ({ ...prev, [relCol.id]: false }))
                          setRelInlineDraftCol((prev) => ({
                            ...prev,
                            [relCol.id]: buildEmptyFieldDraft(targetEntry.columns),
                          }))
                          setRelInlineCreateCol((prev) => ({ ...prev, [relCol.id]: true }))
                        }
                      }}
                      className={isInlineNew ? depth.btn : depth.btnPale}
                      style={{ minHeight: 24, padding: '1px 8px', fontSize: 10.5 }}
                    >
                      {isInlineNew ? 'Vazgeç' : `+ Yeni ${targetEntry.table.name}`}
                    </button>
                  </div>
                </div>

                {selectedRelRows.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {selectedRelRows.map((sr) => (
                      <span
                        key={sr.id}
                        className={depth.badge}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                      >
                        <span>{sr.displayTitle}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setRelDraft((prev) => ({
                              ...prev,
                              [relCol.id]: selectedRelIds.filter((id) => id !== sr.id),
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
                          title="Bağlantıyı kaldır"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {isPickerOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <input
                      type="text"
                      value={relSearchCol[relCol.id] || ''}
                      onChange={(e) =>
                        setRelSearchCol((prev) => ({ ...prev, [relCol.id]: e.target.value }))
                      }
                      placeholder={`${targetEntry.table.name} ara…`}
                      className={depth.input}
                      style={{ minHeight: 28, fontSize: 11.5 }}
                    />
                    <div
                      style={{
                        maxHeight: 115,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                      }}
                    >
                      {availRows.length === 0 ? (
                        <span style={{ fontSize: 11, color: 'var(--pc-muted)', padding: 4 }}>
                          Seçilebilecek kayıt bulunamadı.
                        </span>
                      ) : (
                        availRows.slice(0, 25).map((tr) => (
                          <button
                            key={tr.id}
                            type="button"
                            onClick={() => {
                              setRelDraft((prev) => ({
                                ...prev,
                                [relCol.id]: allowMulti
                                  ? Array.from(new Set([...selectedRelIds, tr.id]))
                                  : [tr.id],
                              }))
                              if (!allowMulti) {
                                setRelPickerOpenCol((prev) => ({ ...prev, [relCol.id]: false }))
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
                            <span>{tr.displayTitle}</span>
                            <Plus size={12} style={{ color: 'var(--pc-blue)' }} />
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {isInlineNew && (
                  <div
                    style={{
                      padding: 8,
                      borderRadius: 8,
                      border: '1px solid var(--pc-blue)',
                      background: 'var(--card-bg)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: 6,
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
                              gridColumn: isFullWidthField(tc) ? '1 / -1' : undefined,
                            }}
                          >
                            <label
                              style={{
                                fontSize: 10.5,
                                fontWeight: 600,
                                color: 'var(--foreground-2)',
                              }}
                            >
                              {tc.name}
                            </label>
                            <DynamicFieldInput
                              mode="form"
                              column={tc}
                              value={relInlineDraftCol[relCol.id]?.[tc.id]}
                              onChange={(val) =>
                                setRelInlineDraftCol((prev) => ({
                                  ...prev,
                                  [relCol.id]: { ...(prev[relCol.id] || {}), [tc.id]: val },
                                }))
                              }
                              autoFocusField={tIdx === 0}
                              allTables={allTableDefs}
                            />
                          </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        disabled={savingRelCol === relCol.id}
                        onClick={() => void handleCreateInlineTarget(relCol, targetEntry)}
                        className={depth.btnPrimary}
                        style={{ minHeight: 26, padding: '2px 10px', fontSize: 11 }}
                      >
                        <Check size={11} color="#ffffff" />
                        <span style={{ color: '#ffffff' }}>
                          {savingRelCol === relCol.id ? 'Ekleniyor…' : 'Ekle ve Bağla'}
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

  return createPortal(
    <div className={depth.backdrop} style={{ zIndex: 100025 }} {...backdropDismiss}>
      <div
        className={depth.modal}
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Header */}
        <div
          style={{
            padding: '15px 20px',
            borderBottom: '1px solid var(--input-border)',
            background: 'var(--card-inner)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--pc-clay-primary)',
                flexShrink: 0,
              }}
            >
              {mode.kind === 'edit' ? (
                <Edit3 size={16} color="#ffffff" />
              ) : (
                <Plus size={17} color="#ffffff" />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '0.98rem',
                  fontWeight: 700,
                  color: 'var(--foreground)',
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {mode.kind === 'edit'
                  ? `${activeEntry.table.name} · Düzenle`
                  : 'İşlem / Akış Kaydı Ekle'}
              </div>
              <div
                style={{
                  fontSize: '0.74rem',
                  color: 'var(--foreground-3)',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {mode.kind === 'edit'
                  ? activeEditRow?.displayTitle
                  : 'Mevcut kayıtlardan seçin veya yeni kayıt oluşturup bağlayın'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={depth.btn}
            style={{ width: 28, height: 28, minHeight: 28, padding: 0, justifyContent: 'center' }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: '14px 18px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {mode.kind === 'add' && (
            <>
              {/* Workflow Table Tabs */}
              {workflowEntries.length > 1 && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {workflowEntries.map((we) => {
                    const isActive = we.table.id === activeEntry.table.id
                    return (
                      <button
                        key={we.table.id}
                        type="button"
                        onClick={() => handleSwitchAddTable(we)}
                        className={isActive ? depth.btnPrimary : depth.btn}
                        style={{ minHeight: 28, padding: '3px 10px', fontSize: 11.5 }}
                      >
                        <Table2 size={12} color={isActive ? '#ffffff' : we.table.color || undefined} />
                        <span style={isActive ? { color: '#ffffff' } : undefined}>
                          {we.table.name}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Pick vs Create Switch */}
              <div className={depth.segmentTrack} style={{ alignSelf: 'flex-start' }}>
                <button
                  type="button"
                  onClick={() => setAddSubTab('pick')}
                  className={addSubTab === 'pick' ? depth.segmentActive : depth.segment}
                  style={{ fontSize: 12 }}
                >
                  <span style={addSubTab === 'pick' ? { color: '#ffffff' } : undefined}>
                    Mevcut Kayıttan Seç ({candidateRows.length})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setAddSubTab('create')}
                  className={addSubTab === 'create' ? depth.segmentActive : depth.segment}
                  style={{ fontSize: 12 }}
                >
                  <span style={addSubTab === 'create' ? { color: '#ffffff' } : undefined}>
                    + Yeni {activeEntry.table.name}
                  </span>
                </button>
              </div>
            </>
          )}

          {mode.kind === 'add' && addSubTab === 'pick' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <Search
                  size={13}
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
                  value={pickSearch}
                  onChange={(e) => setPickSearch(e.target.value)}
                  placeholder={`${activeEntry.table.name} içinde ara…`}
                  className={depth.input}
                  style={{ paddingLeft: 30, minHeight: 33, fontSize: 12 }}
                />
              </div>

              {candidateRows.length === 0 ? (
                <div
                  className={depth.subcard}
                  style={{ textAlign: 'center', fontSize: 12, color: 'var(--pc-muted)', padding: 18 }}
                >
                  {activeEntry.rows.length === 0
                    ? `Henüz kayıtlı ${activeEntry.table.name.toLocaleLowerCase('tr-TR')} bulunmuyor. Üstten "+ Yeni ${activeEntry.table.name}" sekmesine geçip ekleyebilirsiniz.`
                    : 'Eklenebilecek eşleşen kayıt bulunamadı.'}
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    maxHeight: 320,
                    overflowY: 'auto',
                  }}
                >
                  {personRelatedCandidates.length > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pc-blue)', marginTop: 2 }}>
                      🔗 Kişiyle İlişkili Kayıtlar
                    </div>
                  )}
                  {[...personRelatedCandidates, ...otherCandidates].map((r, idx) => {
                    const isChecked = pickedCandidateIds.includes(r.id)
                    const badges = extractCompactFieldBadges(r, activeEntry.columns, new Set(), 3)
                    const showDivider =
                      personRelatedCandidates.length > 0 &&
                      idx === personRelatedCandidates.length
                    return (
                      <React.Fragment key={r.id}>
                        {showDivider && (
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pc-muted)', marginTop: 4 }}>
                            Tüm {activeEntry.table.name}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setPickedCandidateIds((prev) =>
                              prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id]
                            )
                          }
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            padding: '8px 10px',
                            borderRadius: 9,
                            border: isChecked
                              ? '1.5px solid var(--pc-blue)'
                              : '1px solid var(--pc-border)',
                            background: isChecked ? 'var(--pc-tint)' : 'var(--card-bg)',
                            color: 'var(--foreground)',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{r.displayTitle}</div>
                            {badges.length > 0 && (
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: 4,
                                  marginTop: 3,
                                }}
                              >
                                {badges.map((b) => (
                                  <span
                                    key={b.colId}
                                    style={{
                                      fontSize: 10.5,
                                      color: 'var(--foreground-2)',
                                      background: 'var(--card-inner)',
                                      padding: '1px 6px',
                                      borderRadius: 5,
                                      border: '1px solid var(--input-border)',
                                    }}
                                  >
                                    {b.label}: {b.value}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <span
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 6,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: isChecked
                                ? '1px solid #1d4ed8'
                                : '1px solid var(--input-border)',
                              background: isChecked ? '#2563eb' : 'var(--input-bg)',
                              color: '#ffffff',
                              flexShrink: 0,
                            }}
                          >
                            {isChecked && <Check size={13} color="#ffffff" />}
                          </span>
                        </button>
                      </React.Fragment>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            renderFormFieldsAndRelations()
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '13px 18px',
            borderTop: '1px solid var(--input-border)',
            background: 'var(--card-inner)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div>
            {mode.kind === 'edit' && onDetachRow && activeEditRow && (
              confirmDetach ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <button
                    type="button"
                    onClick={async () => {
                      await onDetachRow(activeEntry.table.id, activeEditRow.id)
                      onClose()
                    }}
                    className={depth.btn}
                    style={{
                      borderColor: 'var(--danger)',
                      color: 'var(--danger)',
                      fontSize: 11.5,
                      padding: '4px 9px',
                    }}
                  >
                    Evet, Çıkar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDetach(false)}
                    className={depth.btn}
                    style={{ fontSize: 11.5, padding: '4px 8px' }}
                  >
                    Vazgeç
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDetach(true)}
                  className={depth.btn}
                  style={{ color: 'var(--danger)', fontSize: 11.5 }}
                >
                  <Trash2 size={13} />
                  <span>Randevudan Çıkar</span>
                </button>
              )
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={onClose} className={depth.btn}>
              İptal
            </button>

            {mode.kind === 'add' && addSubTab === 'pick' ? (
              <button
                type="button"
                disabled={saving || pickedCandidateIds.length === 0}
                onClick={() => void handleAttachSelected()}
                className={depth.btnPrimary}
              >
                <Check size={14} color="#ffffff" />
                <span style={{ color: '#ffffff' }}>
                  {saving
                    ? 'Ekleniyor…'
                    : pickedCandidateIds.length > 0
                      ? `Randevuya Ekle (${pickedCandidateIds.length})`
                      : 'Kayıt Seçiniz'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveCreateOrEdit()}
                className={depth.btnPrimary}
              >
                <Check size={14} color="#ffffff" />
                <span style={{ color: '#ffffff' }}>
                  {saving
                    ? 'Kaydediliyor…'
                    : mode.kind === 'edit'
                      ? 'Değişiklikleri Kaydet'
                      : 'Oluştur ve Ekle'}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
