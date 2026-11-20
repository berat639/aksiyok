'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Calendar, Check, Clock, Edit3, Link2, Plus, Unlink, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import DynamicFieldInput from './cells/DynamicFieldInput'
import type {
  DynamicColumnDef,
  DynamicRowItem,
  DynamicTableDef,
  LinkedRowSummary,
} from './types'

const APPT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Planlandı',
  confirmed: 'Onaylandı',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
  postponed: 'Ertelendi',
  pending_assignment: 'Atama Bekliyor',
  pending_review: 'Onay Bekliyor',
  no_show: 'Gelmedi',
}

interface ExpandedLinkedRecordsRowProps {
  colSpan: number
  parentRow: DynamicRowItem
  activeTable: DynamicTableDef
  allTables: DynamicTableDef[]
  appointmentLinked: boolean
  onParentRelationUpdated: (
    col: DynamicColumnDef,
    nextIds: string[],
    nextSummaries: LinkedRowSummary[]
  ) => Promise<void>
  onDataMutated: () => void
  onNavigateToRow: (tableId: string, rowId: string) => void
}

export default function ExpandedLinkedRecordsRow({
  colSpan,
  parentRow,
  activeTable,
  allTables,
  appointmentLinked,
  onParentRelationUpdated,
  onDataMutated,
  onNavigateToRow,
}: ExpandedLinkedRecordsRowProps) {
  const relationCols = useMemo(
    () => activeTable.columns.filter((c) => c.fieldType === 'relation'),
    [activeTable.columns]
  )

  const showAppointmentsTab = appointmentLinked || (parentRow.appointmentCount || 0) > 0

  const [selectedTabKey, setSelectedTabKey] = useState<string>(
    relationCols[0]?.id || '__appointments__'
  )

  useEffect(() => {
    if (selectedTabKey === '__appointments__' && showAppointmentsTab) return
    if (relationCols.some((c) => c.id === selectedTabKey)) return
    setSelectedTabKey(relationCols[0]?.id || '__appointments__')
  }, [relationCols, selectedTabKey, showAppointmentsTab])

  const activeRelCol = relationCols.find((c) => c.id === selectedTabKey) || null
  const targetTable = activeRelCol
    ? allTables.find((t) => t.id === activeRelCol.config?.targetTableId) || null
    : null

  const [targetAllRows, setTargetAllRows] = useState<DynamicRowItem[]>([])
  const [loadingTarget, setLoadingTarget] = useState(false)

  // Quick inline child creation state
  const [creatingChild, setCreatingChild] = useState(false)
  const [childDraftValues, setChildDraftValues] = useState<Record<string, any>>({})
  const [savingChild, setSavingChild] = useState(false)

  // Appointments detail state
  const [appointments, setAppointments] = useState<
    Array<{
      id: string
      title: string
      startTime: string
      endTime: string
      status: string
      doctorName: string | null
    }>
  >([])
  const [loadingAppts, setLoadingAppts] = useState(false)

  const loadTargetTableRows = useCallback(async () => {
    if (!targetTable) {
      setTargetAllRows([])
      return
    }
    setLoadingTarget(true)
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${targetTable.id}/rows`)
      const data = await res.json()
      if (Array.isArray(data)) {
        setTargetAllRows(data)
      }
    } catch {
      // ignore
    } finally {
      setLoadingTarget(false)
    }
  }, [targetTable])

  useEffect(() => {
    setCreatingChild(false)
    if (selectedTabKey === '__appointments__') {
      let active = true
      setLoadingAppts(true)
      fetch(`/api/dynamic-tables/rows/${parentRow.id}/detail`)
        .then((r) => r.json())
        .then((d) => {
          if (active && Array.isArray(d?.appointments)) {
            setAppointments(d.appointments)
          }
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoadingAppts(false)
        })
      return () => {
        active = false
      }
    }
    void loadTargetTableRows()
  }, [selectedTabKey, parentRow.id, loadTargetTableRows])

  const linkedSummaries = activeRelCol ? parentRow.relations?.[activeRelCol.id] || [] : []
  const linkedIdSet = useMemo(
    () => new Set(linkedSummaries.map((s) => s.id)),
    [linkedSummaries]
  )

  const linkedFullRows = useMemo(
    () => targetAllRows.filter((r) => linkedIdSet.has(r.id)),
    [targetAllRows, linkedIdSet]
  )
  const unlinkedRows = useMemo(
    () => targetAllRows.filter((r) => !linkedIdSet.has(r.id)),
    [targetAllRows, linkedIdSet]
  )

  const targetDataColumns = useMemo(
    () => (targetTable?.columns || []).filter((c) => c.fieldType !== 'relation'),
    [targetTable]
  )

  const allowMultiple = activeRelCol ? activeRelCol.config?.allowMultiple !== false : true
  const canAddMore = allowMultiple || linkedSummaries.length === 0

  const startCreatingChild = () => {
    if (!targetTable) return
    const init: Record<string, any> = {}
    for (const c of targetDataColumns) {
      if (c.fieldType === 'boolean') init[c.id] = false
      else if (c.fieldType === 'multiselect') init[c.id] = []
      else init[c.id] = ''
    }
    setChildDraftValues(init)
    setCreatingChild(true)
  }

  const handleSaveNewChildAndLink = async () => {
    if (!targetTable || !activeRelCol || savingChild) return
    setSavingChild(true)
    try {
      const createRes = await fetch(`/api/dynamic-tables/tables/${targetTable.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: childDraftValues }),
      })
      const created = await createRes.json()
      if (!createRes.ok) {
        toast.error(created.error || 'Kayıt eklenemedi')
        return
      }

      const newSummary: LinkedRowSummary = {
        id: created.id,
        tableId: targetTable.id,
        displayTitle: created.displayTitle || 'Yeni Kayıt',
      }

      const nextSummaries = allowMultiple
        ? [...linkedSummaries, newSummary]
        : [newSummary]
      await onParentRelationUpdated(
        activeRelCol,
        nextSummaries.map((s) => s.id),
        nextSummaries
      )
      setCreatingChild(false)
      await loadTargetTableRows()
      onDataMutated()
      toast.success(`"${newSummary.displayTitle}" eklendi ve "${parentRow.displayTitle}" kaydına bağlandı`)
    } catch {
      toast.error('Kayıt oluşturulurken hata oluştu')
    } finally {
      setSavingChild(false)
    }
  }

  const handleAttachExistingChild = async (childId: string) => {
    if (!childId || !activeRelCol || !targetTable) return
    const found = targetAllRows.find((r) => r.id === childId)
    if (!found) return
    const summary: LinkedRowSummary = {
      id: found.id,
      tableId: targetTable.id,
      displayTitle: found.displayTitle || 'Kayıt',
    }
    const nextSummaries = allowMultiple ? [...linkedSummaries, summary] : [summary]
    await onParentRelationUpdated(
      activeRelCol,
      nextSummaries.map((s) => s.id),
      nextSummaries
    )
  }

  const handleDetachChild = async (childId: string) => {
    if (!activeRelCol) return
    const nextSummaries = linkedSummaries.filter((s) => s.id !== childId)
    await onParentRelationUpdated(
      activeRelCol,
      nextSummaries.map((s) => s.id),
      nextSummaries
    )
  }

  const handleInlineChildCellEdit = async (
    childRow: DynamicRowItem,
    col: DynamicColumnDef,
    nextVal: any
  ) => {
    const prevVals = childRow.values
    setTargetAllRows((curr) =>
      curr.map((r) =>
        r.id === childRow.id ? { ...r, values: { ...(r.values || {}), [col.id]: nextVal } } : r
      )
    )
    try {
      const res = await fetch(`/api/dynamic-tables/rows/${childRow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { [col.id]: nextVal } }),
      })
      const updated = await res.json()
      if (!res.ok) {
        toast.error(updated.error || 'Güncellenemedi')
        setTargetAllRows((curr) =>
          curr.map((r) => (r.id === childRow.id ? { ...r, values: prevVals } : r))
        )
        return
      }
      setTargetAllRows((curr) => curr.map((r) => (r.id === childRow.id ? updated : r)))
      onDataMutated()
    } catch {
      setTargetAllRows((curr) =>
        curr.map((r) => (r.id === childRow.id ? { ...r, values: prevVals } : r))
      )
    }
  }

  return (
    <tr>
      <td
        colSpan={colSpan}
        style={{
          padding: '10px 16px 14px 36px',
          background: 'var(--pc-surface)',
          borderBottom: '1.5px solid var(--pc-border)',
        }}
      >
        <div
          className={depth.subcard}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '10px 12px',
            background: 'var(--card-bg)',
          }}
        >
          {/* Connected Tabs Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--pc-muted)', marginRight: 4 }}>
                {parentRow.displayTitle} — Bağlı Kayıtlar:
              </span>

              {relationCols.map((rc) => {
                const cnt = (parentRow.relations?.[rc.id] || []).length
                const active = selectedTabKey === rc.id
                return (
                  <button
                    key={rc.id}
                    type="button"
                    onClick={() => setSelectedTabKey(rc.id)}
                    className={active ? depth.btnPrimary : depth.btn}
                    style={{ minHeight: 27, padding: '2px 10px', fontSize: 11.5 }}
                  >
                    <Link2 size={11} color={active ? '#ffffff' : undefined} />
                    <span>
                      {rc.name} ({cnt})
                    </span>
                  </button>
                )
              })}

              {showAppointmentsTab && (
                <button
                  type="button"
                  onClick={() => setSelectedTabKey('__appointments__')}
                  className={selectedTabKey === '__appointments__' ? depth.btnPrimary : depth.btn}
                  style={{ minHeight: 27, padding: '2px 10px', fontSize: 11.5 }}
                >
                  <Calendar
                    size={11}
                    color={selectedTabKey === '__appointments__' ? '#ffffff' : undefined}
                  />
                  <span>Randevular ({parentRow.appointmentCount || 0})</span>
                </button>
              )}
            </div>

            {activeRelCol && targetTable && canAddMore && !creatingChild && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {unlinkedRows.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) void handleAttachExistingChild(e.target.value)
                    }}
                    className={depth.input}
                    style={{ minHeight: 28, padding: '2px 8px', fontSize: 11.5, width: 200 }}
                  >
                    <option value="">Mevcut {targetTable.name} bağla…</option>
                    {unlinkedRows.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayTitle}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  onClick={startCreatingChild}
                  className={depth.btnPale}
                  style={{ minHeight: 28, padding: '3px 10px', fontSize: 11.5 }}
                >
                  <Plus size={12} />
                  <span>Yeni {targetTable.name} Ekle</span>
                </button>
              </div>
            )}
          </div>

          {/* Tab Body: Connected Table Mini-Grid */}
          {selectedTabKey !== '__appointments__' && activeRelCol && targetTable && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {targetDataColumns.map((col) => (
                      <th
                        key={col.id}
                        style={{
                          textAlign: 'left',
                          padding: '6px 8px',
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--foreground-2)',
                          background: 'var(--pc-surface)',
                          borderBottom: '1px solid var(--pc-border)',
                        }}
                      >
                        {col.name}
                      </th>
                    ))}
                    <th
                      style={{
                        width: 120,
                        textAlign: 'right',
                        padding: '6px 8px',
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--foreground-2)',
                        background: 'var(--pc-surface)',
                        borderBottom: '1px solid var(--pc-border)',
                      }}
                    >
                      İşlem
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {creatingChild && (
                    <tr style={{ background: 'var(--pc-tint)' }}>
                      {targetDataColumns.map((col, idx) => (
                        <td
                          key={col.id}
                          style={{ padding: '5px 8px', borderBottom: '1px solid var(--pc-border)' }}
                        >
                          <DynamicFieldInput
                            mode="inlineNew"
                            autoFocusField={idx === 0}
                            column={col}
                            value={childDraftValues[col.id]}
                            onChange={(v) =>
                              setChildDraftValues((prev) => ({ ...prev, [col.id]: v }))
                            }
                            allTables={allTables}
                            onEnterSubmit={() => void handleSaveNewChildAndLink()}
                            onEscapeCancel={() => setCreatingChild(false)}
                          />
                        </td>
                      ))}
                      <td
                        style={{
                          padding: '5px 8px',
                          borderBottom: '1px solid var(--pc-border)',
                          textAlign: 'right',
                        }}
                      >
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <button
                            type="button"
                            disabled={savingChild}
                            onClick={() => void handleSaveNewChildAndLink()}
                            className={depth.btnPrimary}
                            style={{ minHeight: 25, padding: '2px 8px', fontSize: 11 }}
                          >
                            <Check size={11} color="#ffffff" />
                            <span>Ekle</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCreatingChild(false)}
                            className={depth.btn}
                            style={{ minHeight: 25, padding: '2px 6px' }}
                          >
                            <X size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {loadingTarget ? (
                    <tr>
                      <td
                        colSpan={targetDataColumns.length + 1}
                        style={{ padding: 14, textAlign: 'center', color: 'var(--pc-muted)', fontSize: 12 }}
                      >
                        Bağlı kayıtlar yükleniyor…
                      </td>
                    </tr>
                  ) : linkedFullRows.length === 0 && !creatingChild ? (
                    <tr>
                      <td
                        colSpan={targetDataColumns.length + 1}
                        style={{ padding: 14, textAlign: 'center', color: 'var(--pc-muted)', fontSize: 12 }}
                      >
                        Henüz bağlı {targetTable.name} kaydı yok. Yukarıdan yeni ekleyebilir veya mevcut kaydı bağlayabilirsiniz.
                      </td>
                    </tr>
                  ) : (
                    linkedFullRows.map((child) => (
                      <tr key={child.id}>
                        {targetDataColumns.map((col) => (
                          <td
                            key={col.id}
                            style={{
                              padding: '5px 8px',
                              borderBottom: '1px solid var(--pc-border)',
                            }}
                          >
                            <DynamicFieldInput
                              mode="readonly"
                              column={col}
                              value={child.values?.[col.id]}
                              allTables={allTables}
                            />
                          </td>
                        ))}
                        <td
                          style={{
                            padding: '5px 8px',
                            borderBottom: '1px solid var(--pc-border)',
                            textAlign: 'right',
                          }}
                        >
                          <div style={{ display: 'inline-flex', gap: 4 }}>
                            <button
                              type="button"
                              onClick={() => onNavigateToRow(targetTable.id, child.id)}
                              className={depth.btn}
                              style={{ minHeight: 24, padding: '2px 7px', fontSize: 11 }}
                              title={`${targetTable.name} kaydını düzenle`}
                            >
                              <Edit3 size={11} />
                              <span>Düzenle</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDetachChild(child.id)}
                              className={depth.btn}
                              style={{ minHeight: 24, padding: '2px 7px', fontSize: 11, color: 'var(--danger)' }}
                              title="Kaydı silmeden sadece bağlantıyı kaldırır"
                            >
                              <Unlink size={11} />
                              <span>Ayır</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab Body: Linked Appointments */}
          {selectedTabKey === '__appointments__' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {loadingAppts ? (
                <div style={{ padding: 12, textAlign: 'center', color: 'var(--pc-muted)', fontSize: 12 }}>
                  Randevular yükleniyor…
                </div>
              ) : appointments.length === 0 ? (
                <div style={{ padding: 12, textAlign: 'center', color: 'var(--pc-muted)', fontSize: 12 }}>
                  Bu kayda bağlı randevu bulunmuyor.
                </div>
              ) : (
                appointments.map((appt) => {
                  const dt = new Date(appt.startTime)
                  const dateStr = Number.isNaN(dt.getTime())
                    ? appt.startTime
                    : dt.toLocaleDateString('tr-TR', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })
                  const timeStr = Number.isNaN(dt.getTime())
                    ? ''
                    : dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
                  return (
                    <div
                      key={appt.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '7px 10px',
                        borderRadius: 9,
                        border: '1px solid var(--pc-border)',
                        background: 'var(--pc-surface)',
                        fontSize: 12,
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>{appt.title}</span>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: 'var(--pc-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={11} />
                          {dateStr} {timeStr}
                          {appt.doctorName ? ` • ${appt.doctorName}` : ''}
                        </span>
                        <span className={depth.badge}>
                          {APPT_STATUS_LABELS[appt.status] || appt.status}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

