'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  Calendar,
  Check,
  Edit3,
  Link2,
  Plus,
  Search,
  Table2,
  X,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { matchesPhoneSearch } from '@/lib/phone-mask'
import { useBackdropDismiss } from '../../../../hooks/useBackdropDismiss'
import depth from '@/styles/clinic-depth.module.css'
import DynamicFieldInput from './cells/DynamicFieldInput'
import type {
  AppointmentBookingContextData,
  AppointmentContextRow,
  AppointmentContextTableEntry,
} from './AppointmentDynamicRecordsSection'
import {
  formatCurrencyTR,
  formatDynamicDateTR,
  type DynamicColumnDef,
} from './types'

function buildInitialDraft(columns: DynamicColumnDef[]): Record<string, any> {
  const init: Record<string, any> = {}
  for (const col of columns) {
    if (col.fieldType === 'relation') continue
    if (col.fieldType === 'boolean') init[col.id] = false
    else if (col.fieldType === 'multiselect') init[col.id] = []
    else init[col.id] = ''
  }
  return init
}

function isFullWidthCol(col: DynamicColumnDef): boolean {
  return (
    col.isPrimaryTitle ||
    col.fieldType === 'multiselect' ||
    col.fieldType === 'boolean' ||
    /(not|aciklama|açıklama|adres|detay)/i.test(`${col.name} ${col.slug}`)
  )
}

function formatFieldBadges(
  row: AppointmentContextRow,
  columns: DynamicColumnDef[],
  limit = 4
): Array<{ id: string; label: string; value: string }> {
  const out: Array<{ id: string; label: string; value: string }> = []
  for (const col of columns) {
    if (col.fieldType === 'relation' || col.isPrimaryTitle) continue
    const raw = row.values?.[col.id]
    if (raw === null || raw === undefined || raw === '') continue
    let text = ''
    if (col.fieldType === 'boolean') {
      if (raw === true) text = 'Evet'
      else continue
    } else if (col.fieldType === 'currency') {
      text = formatCurrencyTR(raw, col.config?.currencySymbol || '₺')
    } else if (col.fieldType === 'date') {
      text = formatDynamicDateTR(raw)
    } else if (col.fieldType === 'select') {
      text = col.config?.options?.find((o) => o.id === raw)?.label || String(raw)
    } else if (col.fieldType === 'multiselect' && Array.isArray(raw) && raw.length > 0) {
      text = raw
        .map((id) => col.config?.options?.find((o) => o.id === id)?.label || String(id))
        .join(', ')
    } else {
      text = String(raw).trim()
    }
    if (!text) continue
    out.push({ id: col.id, label: col.name, value: text })
    if (out.length >= limit) break
  }
  return out
}

interface DynamicQuickRecordModalProps {
  isOpen: boolean
  context: AppointmentBookingContextData
  initialTableId?: string | null
  onClose: () => void
  onCreated: (payload: {
    tableId: string
    rowId: string
    openAppointmentPlanner: boolean
    relatedSelectionMap: Record<string, string[]>
  }) => void | Promise<void>
}

export function DynamicQuickRecordModal({
  isOpen,
  context,
  initialTableId,
  onClose,
  onCreated,
}: DynamicQuickRecordModalProps) {
  const backdropDismiss = useBackdropDismiss(onClose)

  const orderedTables = useMemo<AppointmentContextTableEntry[]>(() => {
    const seen = new Set<string>()
    const list: AppointmentContextTableEntry[] = []
    for (const lt of context.linkedTables) {
      if (!seen.has(lt.table.id)) {
        seen.add(lt.table.id)
        list.push(lt)
      }
    }
    for (const at of context.allTables) {
      if (!seen.has(at.table.id)) {
        seen.add(at.table.id)
        list.push(at)
      }
    }
    return list
  }, [context.linkedTables, context.allTables])

  const [activeTableId, setActiveTableId] = useState<string>('')
  const [valuesDraft, setValuesDraft] = useState<Record<string, any>>({})
  const [relationsDraft, setRelationsDraft] = useState<Record<string, string[]>>({})
  const [relSearchByCol, setRelSearchByCol] = useState<Record<string, string>>({})
  const [openRelPickerCol, setOpenRelPickerCol] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen || orderedTables.length === 0) return
    const targetId =
      (initialTableId && orderedTables.some((t) => t.table.id === initialTableId)
        ? initialTableId
        : orderedTables[0]?.table.id) || ''
    setActiveTableId(targetId)
    const found = orderedTables.find((t) => t.table.id === targetId)
    if (found) {
      setValuesDraft(buildInitialDraft(found.columns))
      setRelationsDraft({})
      setRelSearchByCol({})
      setOpenRelPickerCol({})
    }
  }, [isOpen, initialTableId, orderedTables])

  const activeEntry = useMemo(
    () => orderedTables.find((t) => t.table.id === activeTableId) || orderedTables[0] || null,
    [orderedTables, activeTableId]
  )

  const tableMap = useMemo(() => {
    const m = new Map<string, AppointmentContextTableEntry>()
    for (const t of orderedTables) m.set(t.table.id, t)
    return m
  }, [orderedTables])

  const allTableDefs = useMemo(() => orderedTables.map((t) => t.table), [orderedTables])

  if (!isOpen || !activeEntry) return null

  const nonRelationCols = activeEntry.columns.filter((c) => c.fieldType !== 'relation')
  const relationCols = activeEntry.columns.filter(
    (c) => c.fieldType === 'relation' && Boolean(c.config?.targetTableId)
  )

  const handleSwitchTable = (tableId: string) => {
    setActiveTableId(tableId)
    const found = orderedTables.find((t) => t.table.id === tableId)
    if (found) {
      setValuesDraft(buildInitialDraft(found.columns))
      setRelationsDraft({})
      setRelSearchByCol({})
      setOpenRelPickerCol({})
    }
  }

  const handleSubmit = async (openAppointmentPlanner: boolean) => {
    if (saving) return
    for (const col of nonRelationCols) {
      if (col.isRequired || col.isPrimaryTitle) {
        const val = valuesDraft[col.id]
        if (val === null || val === undefined || String(val).trim() === '') {
          toast.error(`Lütfen "${col.name}" alanını doldurun.`)
          return
        }
      }
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${activeEntry.table.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: valuesDraft,
          relations: relationsDraft,
        }),
      })
      const created = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(created.error || 'Kayıt oluşturulamadı')
        return
      }

      const relatedSelectionMap: Record<string, string[]> = {
        [activeEntry.table.id]: [created.id],
      }
      for (const relCol of relationCols) {
        const targetId = relCol.config?.targetTableId
        const ids = relationsDraft[relCol.id] || []
        if (targetId && ids.length > 0) {
          relatedSelectionMap[targetId] = ids
        }
      }

      toast.success(`"${created.displayTitle || activeEntry.table.name}" kaydedildi`)
      await onCreated({
        tableId: activeEntry.table.id,
        rowId: created.id,
        openAppointmentPlanner,
        relatedSelectionMap,
      })
      onClose()
    } catch {
      toast.error('Kayıt oluşturulurken hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100004,
        background: 'var(--modal-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
      }}
      {...backdropDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, calc(100vw - 24px))',
          maxWidth: 460,
          maxHeight: '90vh',
          borderRadius: 14,
          background: 'var(--card-bg)',
          border: '1.5px solid var(--input-border)',
          boxShadow: 'var(--pc-modal-shadow)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '15px 20px',
            borderBottom: '1px solid var(--input-border)',
            background: 'var(--card-inner)',
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
              <Table2 size={16} color="#ffffff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '1.02rem',
                  fontWeight: 700,
                  color: 'var(--foreground)',
                  lineHeight: 1.2,
                }}
              >
                Yeni {activeEntry.table.name} Ekle
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--foreground-3)', marginTop: 2 }}>
                Dinamik tablo alanlarını doldurun ve takvime bağlayın
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid var(--input-border)',
              background: 'var(--input-bg)',
              color: 'var(--foreground)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--pc-clay-btn)',
              flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: '16px 20px',
            flex: 1,
            overflowY: 'auto',
            background: 'var(--card-bg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Table Switcher Pills */}
          {orderedTables.length > 1 && (
            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                padding: 6,
                borderRadius: 10,
                background: 'var(--input-bg)',
                border: '1px solid var(--input-border)',
                boxShadow: 'var(--pc-neo-inset)',
              }}
            >
              {orderedTables.map((t) => {
                const isActive = t.table.id === activeEntry.table.id
                return (
                  <button
                    key={t.table.id}
                    type="button"
                    onClick={() => handleSwitchTable(t.table.id)}
                    className={isActive ? depth.btnPrimary : depth.btn}
                    style={{ minHeight: 28, padding: '3px 10px', fontSize: 11.5 }}
                  >
                    <span style={isActive ? { color: '#ffffff' } : undefined}>{t.table.name}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Direct Fields */}
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: 'var(--card-inner)',
              border: '1px solid var(--input-border)',
              boxShadow: 'var(--pc-neo-subcard)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
              gap: 10,
            }}
          >
            {nonRelationCols.map((col, idx) => (
              <div
                key={col.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  gridColumn: isFullWidthCol(col) ? '1 / -1' : undefined,
                }}
              >
                <label
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'var(--foreground-2)',
                  }}
                >
                  {col.name}
                  {col.isRequired || col.isPrimaryTitle ? ' *' : ''}
                </label>
                <DynamicFieldInput
                  mode="form"
                  column={col}
                  value={valuesDraft[col.id]}
                  onChange={(val) =>
                    setValuesDraft((prev) => ({
                      ...prev,
                      [col.id]: val,
                    }))
                  }
                  autoFocusField={idx === 0}
                  allTables={allTableDefs}
                />
              </div>
            ))}
          </div>

          {/* Connected Relation Fields */}
          {relationCols.length > 0 && (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: 'var(--card-inner)',
                border: '1px solid var(--input-border)',
                boxShadow: 'var(--pc-neo-subcard)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--foreground)' }}>
                Bağlantılı Tablo Alanları
              </div>

              {relationCols.map((relCol) => {
                const targetEntry = relCol.config?.targetTableId
                  ? tableMap.get(relCol.config.targetTableId)
                  : undefined
                if (!targetEntry) return null

                const allowMulti = relCol.config?.allowMultiple !== false
                const pickedIds = relationsDraft[relCol.id] || []
                const pickedRows = pickedIds
                  .map((id) => targetEntry.rows.find((r) => r.id === id))
                  .filter((r): r is AppointmentContextRow => Boolean(r))
                const isOpenPicker = Boolean(openRelPickerCol[relCol.id])
                const q = (relSearchByCol[relCol.id] || '').trim().toLocaleLowerCase('tr-TR')
                const candidates = targetEntry.rows.filter((r) => {
                  if (pickedIds.includes(r.id)) return false
                  if (!q) return true
                  return r.displayTitle.toLocaleLowerCase('tr-TR').includes(q)
                })

                return (
                  <div
                    key={relCol.id}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--pc-border)',
                      background: 'var(--card-bg)',
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
                          {relCol.name} ({targetEntry.table.name})
                        </span>
                      </span>
                      {(allowMulti || pickedRows.length === 0) && (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenRelPickerCol((prev) => ({
                              ...prev,
                              [relCol.id]: !isOpenPicker,
                            }))
                          }
                          className={depth.btn}
                          style={{ minHeight: 24, padding: '2px 8px', fontSize: 11 }}
                        >
                          {isOpenPicker ? 'Gizle' : '+ Seç'}
                        </button>
                      )}
                    </div>

                    {pickedRows.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {pickedRows.map((pr) => (
                          <span
                            key={pr.id}
                            className={depth.badge}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 11,
                            }}
                          >
                            <span>{pr.displayTitle}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setRelationsDraft((prev) => ({
                                  ...prev,
                                  [relCol.id]: pickedIds.filter((id) => id !== pr.id),
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

                    {isOpenPicker && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <input
                          type="text"
                          value={relSearchByCol[relCol.id] || ''}
                          onChange={(e) =>
                            setRelSearchByCol((prev) => ({
                              ...prev,
                              [relCol.id]: e.target.value,
                            }))
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
                          {candidates.length === 0 ? (
                            <span style={{ fontSize: 11, color: 'var(--pc-muted)' }}>
                              Kayıt bulunamadı.
                            </span>
                          ) : (
                            candidates.slice(0, 20).map((cr) => (
                              <button
                                key={cr.id}
                                type="button"
                                onClick={() => {
                                  const nextIds = allowMulti
                                    ? Array.from(new Set([...pickedIds, cr.id]))
                                    : [cr.id]
                                  setRelationsDraft((prev) => ({
                                    ...prev,
                                    [relCol.id]: nextIds,
                                  }))
                                  if (!allowMulti) {
                                    setOpenRelPickerCol((prev) => ({
                                      ...prev,
                                      [relCol.id]: false,
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
                                  background: 'var(--pc-surface)',
                                  color: 'var(--foreground)',
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                              >
                                <span>{cr.displayTitle}</span>
                                <Plus size={12} style={{ color: 'var(--pc-blue)' }} />
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '13px 20px',
            borderTop: '1px solid var(--input-border)',
            background: 'var(--card-inner)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className={depth.btn}
            style={{ minHeight: 34, padding: '6px 13px', fontSize: '0.82rem' }}
          >
            İptal
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSubmit(false)}
              className={depth.btnPale}
              style={{ minHeight: 34, padding: '6px 13px', fontSize: '0.82rem' }}
            >
              <Check size={14} />
              <span>Kaydet</span>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSubmit(true)}
              className={depth.btnPrimary}
              style={{ minHeight: 34, padding: '6px 14px', fontSize: '0.82rem' }}
            >
              <Calendar size={14} color="#ffffff" />
              <span style={{ color: '#ffffff' }}>
                {saving ? 'Kaydediliyor…' : 'Kaydet ve Randevu Planla'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface DynamicRecordsSidePanelProps {
  isOpen: boolean
  context: AppointmentBookingContextData
  events: any[]
  onClose: () => void
  onOpenNewRecordModal: (tableId?: string) => void
  onPlanAppointmentForRow: (
    tableId: string,
    rowId: string,
    extraSelectedMap?: Record<string, string[]>
  ) => void
  onFocusAppointment: (appointmentId: string, startTime: string) => void
  onRefreshContext: () => Promise<void> | void
}

export function DynamicRecordsSidePanel({
  isOpen,
  context,
  events,
  onClose,
  onOpenNewRecordModal,
  onPlanAppointmentForRow,
  onFocusAppointment,
  onRefreshContext,
}: DynamicRecordsSidePanelProps) {
  const backdropDismiss = useBackdropDismiss(onClose)
  const [selectedTableFilter, setSelectedTableFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Record<string, any>>({})
  const [savingEdit, setSavingEdit] = useState(false)

  const orderedTables = useMemo<AppointmentContextTableEntry[]>(() => {
    const seen = new Set<string>()
    const list: AppointmentContextTableEntry[] = []
    for (const lt of context.linkedTables) {
      if (!seen.has(lt.table.id)) {
        seen.add(lt.table.id)
        list.push(lt)
      }
    }
    for (const at of context.allTables) {
      if (!seen.has(at.table.id)) {
        seen.add(at.table.id)
        list.push(at)
      }
    }
    return list
  }, [context.linkedTables, context.allTables])

  const allTableDefs = useMemo(() => orderedTables.map((t) => t.table), [orderedTables])

  const appointmentsByRowId = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const ev of events || []) {
      const links = Array.isArray(ev?.dynamicLinks) ? ev.dynamicLinks : []
      for (const lk of links) {
        if (!lk?.rowId) continue
        const arr = map.get(lk.rowId) || []
        arr.push(ev)
        map.set(lk.rowId, arr)
      }
    }
    return map
  }, [events])

  const visibleEntries = useMemo(() => {
    if (selectedTableFilter === 'all') return orderedTables
    return orderedTables.filter((t) => t.table.id === selectedTableFilter)
  }, [orderedTables, selectedTableFilter])

  if (!isOpen) return null

  const q = searchQuery.trim().toLocaleLowerCase('tr-TR')

  const handleSaveInlineEdit = async (rowId: string) => {
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/dynamic-tables/rows/${rowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: editDraft }),
      })
      if (!res.ok) {
        toast.error('Kayıt güncellenemedi')
        return
      }
      setEditingRowId(null)
      await onRefreshContext()
      toast.success('Kayıt alanları güncellendi')
    } catch {
      toast.error('Güncelleme sırasında hata oluştu')
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: 'var(--modal-overlay)',
      }}
      {...backdropDismiss}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(450px, 100vw)',
          background: 'var(--card-bg)',
          borderLeft: '1.5px solid var(--input-border)',
          boxShadow: 'var(--pc-modal-shadow)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--input-border)',
            background: 'var(--card-inner)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3
              style={{
                margin: 0,
                fontSize: '1.05rem',
                fontWeight: 700,
                color: 'var(--foreground)',
              }}
            >
              Tablo Kayıtları ve Hızlı Randevu
            </h3>
            <div style={{ fontSize: '0.75rem', color: 'var(--foreground-3)', marginTop: 2 }}>
              Kayıt alanlarını inceleyin veya tek tıkla takvime randevu bağlayın
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() =>
                onOpenNewRecordModal(
                  selectedTableFilter !== 'all' ? selectedTableFilter : undefined
                )
              }
              className={depth.btnPrimary}
              style={{ minHeight: 30, padding: '4px 10px', fontSize: 11.5 }}
            >
              <Plus size={13} color="#ffffff" />
              <span style={{ color: '#ffffff' }}>Yeni Kayıt</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className={depth.btn}
              style={{ width: 30, height: 30, padding: 0, justifyContent: 'center' }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Search & Table Filter */}
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--input-border)',
            background: 'var(--card-bg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ position: 'relative' }}>
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
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ad, telefon veya herhangi bir dinamik alan ara…"
              className={depth.input}
              style={{ paddingLeft: 31, minHeight: 34, fontSize: 12.5 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setSelectedTableFilter('all')}
              className={selectedTableFilter === 'all' ? depth.btnPrimary : depth.btn}
              style={{ minHeight: 26, padding: '2px 9px', fontSize: 11 }}
            >
              <span style={selectedTableFilter === 'all' ? { color: '#ffffff' } : undefined}>
                Tümü
              </span>
            </button>
            {orderedTables.map((entry) => {
              const isSelected = selectedTableFilter === entry.table.id
              return (
                <button
                  key={entry.table.id}
                  type="button"
                  onClick={() => setSelectedTableFilter(entry.table.id)}
                  className={isSelected ? depth.btnPrimary : depth.btn}
                  style={{ minHeight: 26, padding: '2px 9px', fontSize: 11 }}
                >
                  <span style={isSelected ? { color: '#ffffff' } : undefined}>
                    {entry.table.name} ({entry.rows.length})
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Records List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {visibleEntries.map((entry) => {
            const filteredRows = entry.rows.filter((r) => {
              if (!q) return true
              if (r.displayTitle.toLocaleLowerCase('tr-TR').includes(q)) return true
              if (matchesPhoneSearch(r.phone, searchQuery)) return true
              return Object.values(r.values || {}).some((v) =>
                String(v ?? '')
                  .toLocaleLowerCase('tr-TR')
                  .includes(q)
              )
            })

            if (filteredRows.length === 0 && q) return null

            return (
              <div
                key={entry.table.id}
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
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
                      fontSize: 12,
                      fontWeight: 800,
                      color: 'var(--foreground-2)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.4px',
                    }}
                  >
                    {entry.table.name} ({filteredRows.length})
                  </span>
                </div>

                {filteredRows.length === 0 ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 9,
                      background: 'var(--card-inner)',
                      border: '1px dashed var(--input-border)',
                      fontSize: 12,
                      color: 'var(--foreground-3)',
                      textAlign: 'center',
                    }}
                  >
                    Bu tabloda henüz kayıt yok.
                  </div>
                ) : (
                  filteredRows.slice(0, 40).map((row) => {
                    const badges = formatFieldBadges(row, entry.columns, 5)
                    const rowAppts = appointmentsByRowId.get(row.id) || []
                    const isEditing = editingRowId === row.id

                    return (
                      <div
                        key={row.id}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          background: 'var(--card-inner)',
                          border: isEditing
                            ? '1.5px solid var(--pc-blue)'
                            : '1px solid var(--input-border)',
                          boxShadow: 'var(--pc-neo-subcard)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: 8,
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontSize: 13.5,
                                fontWeight: 700,
                                color: 'var(--foreground)',
                              }}
                            >
                              {row.displayTitle}
                            </div>

                            {badges.length > 0 && (
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: 4,
                                  marginTop: 5,
                                }}
                              >
                                {badges.map((b) => (
                                  <span
                                    key={b.id}
                                    style={{
                                      fontSize: 10.5,
                                      fontWeight: 600,
                                      padding: '2px 7px',
                                      borderRadius: 6,
                                      background: 'var(--card-bg)',
                                      border: '1px solid var(--pc-border)',
                                      color: 'var(--foreground-2)',
                                    }}
                                  >
                                    <strong style={{ color: 'var(--foreground)' }}>
                                      {b.label}:
                                    </strong>{' '}
                                    {b.value}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={() => {
                                if (isEditing) {
                                  setEditingRowId(null)
                                } else {
                                  const init: Record<string, any> = {}
                                  for (const c of entry.columns) {
                                    if (c.fieldType === 'relation') continue
                                    const v = row.values?.[c.id]
                                    if (c.fieldType === 'boolean') init[c.id] = Boolean(v)
                                    else if (c.fieldType === 'multiselect')
                                      init[c.id] = Array.isArray(v) ? v : []
                                    else init[c.id] = v ?? ''
                                  }
                                  setEditDraft(init)
                                  setEditingRowId(row.id)
                                }
                              }}
                              className={depth.btn}
                              style={{ minHeight: 27, padding: '2px 8px', fontSize: 11 }}
                              title="Alanları düzenle"
                            >
                              <Edit3 size={11} />
                              <span>{isEditing ? 'Kapat' : 'Düzenle'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onPlanAppointmentForRow(entry.table.id, row.id)}
                              className={depth.btnPrimary}
                              style={{ minHeight: 27, padding: '2px 9px', fontSize: 11 }}
                            >
                              <Calendar size={11} color="#ffffff" />
                              <span style={{ color: '#ffffff' }}>Randevu Planla</span>
                            </button>
                          </div>
                        </div>

                        {isEditing && (
                          <div
                            style={{
                              paddingTop: 8,
                              borderTop: '1px solid var(--pc-border)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
                                gap: 8,
                              }}
                            >
                              {entry.columns
                                .filter((c) => c.fieldType !== 'relation')
                                .map((col) => (
                                  <div
                                    key={col.id}
                                    style={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 3,
                                      gridColumn: isFullWidthCol(col) ? '1 / -1' : undefined,
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
                                    </label>
                                    <DynamicFieldInput
                                      mode="form"
                                      column={col}
                                      value={editDraft[col.id]}
                                      onChange={(val) =>
                                        setEditDraft((prev) => ({ ...prev, [col.id]: val }))
                                      }
                                      allTables={allTableDefs}
                                    />
                                  </div>
                                ))}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                disabled={savingEdit}
                                onClick={() => void handleSaveInlineEdit(row.id)}
                                className={depth.btnPrimary}
                                style={{ minHeight: 27, padding: '3px 11px', fontSize: 11.5 }}
                              >
                                <Check size={12} color="#ffffff" />
                                <span style={{ color: '#ffffff' }}>
                                  {savingEdit ? 'Kaydediliyor…' : 'Alanları Kaydet'}
                                </span>
                              </button>
                            </div>
                          </div>
                        )}

                        {rowAppts.length > 0 && (
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 5,
                              paddingTop: 6,
                              borderTop: '1px solid var(--pc-border)',
                            }}
                          >
                            {rowAppts.slice(0, 4).map((ap) => {
                              const dt = new Date(ap.startTime)
                              const label = isNaN(dt.getTime())
                                ? ap.title
                                : `${dt.toLocaleDateString('tr-TR', {
                                    day: 'numeric',
                                    month: 'short',
                                  })} ${dt.toLocaleTimeString('tr-TR', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}`
                              return (
                                <button
                                  key={ap.id}
                                  type="button"
                                  onClick={() => onFocusAppointment(ap.id, ap.startTime)}
                                  className={depth.btnPale}
                                  style={{ minHeight: 23, padding: '1px 8px', fontSize: 10.5 }}
                                  title="Takvimde bu randevuya git"
                                >
                                  📅 {label}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )
          })}
        </div>
      </aside>
    </div>
  )
}
