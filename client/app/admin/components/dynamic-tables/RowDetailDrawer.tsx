'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, Check, Clock, Edit3, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import DynamicFieldInput from './cells/DynamicFieldInput'
import {
  FIELD_TYPE_META,
  type DynamicColumnDef,
  type DynamicRowItem,
  type DynamicTableDef,
  type LinkedRowSummary,
} from './types'

interface RowDetailDrawerProps {
  rowId: string | null
  isCreatingNew?: boolean
  table: DynamicTableDef | null
  allTables: DynamicTableDef[]
  hasAppointmentLink: boolean
  canManageSchema?: boolean
  onClose: () => void
  onRowMutated: () => void
  onNavigateToRow: (tableId: string, rowId: string) => void
}

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

function buildEmptyValues(tbl: DynamicTableDef | null): Record<string, any> {
  if (!tbl) return {}
  const initVals: Record<string, any> = {}
  for (const col of tbl.columns) {
    if (col.fieldType === 'boolean') initVals[col.id] = false
    else if (col.fieldType === 'multiselect') initVals[col.id] = []
    else if (col.fieldType !== 'relation') initVals[col.id] = ''
  }
  return initVals
}

export default function RowDetailDrawer({
  rowId,
  isCreatingNew = false,
  table,
  allTables,
  hasAppointmentLink,
  canManageSchema = false,
  onClose,
  onRowMutated,
  onNavigateToRow,
}: RowDetailDrawerProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draftValues, setDraftValues] = useState<Record<string, any>>({})
  const [draftRelations, setDraftRelations] = useState<Record<string, LinkedRowSummary[]>>({})
  const [detail, setDetail] = useState<{
    row: DynamicRowItem
    appointments: Array<{
      id: string
      title: string
      startTime: string
      endTime: string
      status: string
      doctorName: string | null
      notes: string | null
    }>
  } | null>(null)

  useEffect(() => {
    setConfirmDelete(false)
    if (isCreatingNew) {
      setDetail(null)
      setLoading(false)
      setDraftValues(buildEmptyValues(table))
      setDraftRelations({})
      return
    }
    if (!rowId) {
      setDetail(null)
      return
    }
    let active = true
    setLoading(true)
    fetch(`/api/dynamic-tables/rows/${rowId}/detail`)
      .then((r) => r.json())
      .then((data) => {
        if (active && !data.error && data.row) {
          setDetail(data)
          setDraftValues({ ...(data.row.values || {}) })
          setDraftRelations({ ...(data.row.relations || {}) })
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [rowId, isCreatingNew, table])

  const isOpen = Boolean((rowId || isCreatingNew) && table)
  if (!isOpen || !table || typeof document === 'undefined' || !document.body) return null

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (saving) return

    const relationIdsPayload: Record<string, string[]> = {}
    for (const col of table.columns) {
      if (col.fieldType === 'relation') {
        relationIdsPayload[col.id] = (draftRelations[col.id] || []).map((item) => item.id)
      }
    }

    setSaving(true)
    try {
      if (isCreatingNew) {
        const res = await fetch(`/api/dynamic-tables/tables/${table.id}/rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: draftValues,
            relations: relationIdsPayload,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || 'Kayıt eklenemedi')
          return
        }
        toast.success('Yeni kayıt eklendi')
        onRowMutated()
        onClose()
      } else if (rowId) {
        const res = await fetch(`/api/dynamic-tables/rows/${rowId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: draftValues,
            relations: relationIdsPayload,
          }),
        })
        const updated = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(updated.error || 'Kayıt güncellenemedi')
          return
        }
        toast.success('Kayıt güncellendi')
        onRowMutated()
        onClose()
      }
    } catch {
      toast.error('Kayıt kaydedilirken hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRow = async () => {
    if (!detail?.row) return
    try {
      const res = await fetch('/api/dynamic-tables/rows/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIds: [detail.row.id] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Kayıt silinemedi')
        return
      }
      toast.success('Kayıt silindi')
      onRowMutated()
      onClose()
    } catch {
      toast.error('Silme işlemi başarısız')
    }
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'var(--modal-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
      }}
    >
      <form
        onSubmit={(e) => void handleSave(e)}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, calc(100vw - 24px))',
          maxWidth: 460,
          maxHeight: '90vh',
          borderRadius: 14,
          border: '1.5px solid var(--input-border)',
          background: 'var(--card-bg)',
          boxShadow: 'var(--pc-modal-shadow)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '13px 16px',
            borderBottom: '1px solid var(--input-border)',
            background: 'var(--card-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden', minWidth: 0 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                boxShadow: 'var(--pc-clay-primary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {isCreatingNew ? <Plus size={16} color="#ffffff" /> : <Edit3 size={15} color="#ffffff" />}
            </div>
            <div style={{ overflow: 'hidden', minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pc-tint-fg)' }}>
                {table.name} — {isCreatingNew ? 'Yeni Kayıt Ekle' : 'Kayıt Düzenle'}
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 750,
                  color: 'var(--foreground)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {isCreatingNew ? `Yeni ${table.name} Kaydı` : detail?.row?.displayTitle || 'Yükleniyor…'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={depth.btn}
            style={{ minHeight: 28, padding: '3px 7px', flexShrink: 0 }}
            title="Kapat"
          >
            <X size={14} />
          </button>
        </div>

        {/* Modal Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            background: 'var(--card-bg)',
          }}
        >
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--pc-muted)', fontSize: 12.5 }}>
              Kayıt bilgileri yükleniyor…
            </div>
          ) : !isCreatingNew && !detail ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--danger)', fontSize: 12.5 }}>
              Kayıt bilgisi alınamadı.
            </div>
          ) : (
            <>
              <div className={depth.subcard} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {table.columns.map((col: DynamicColumnDef, idx: number) => (
                  <div
                    key={col.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color: 'var(--foreground-2)' }}>
                        {col.name}
                        {col.isRequired ? ' *' : ''}
                      </span>
                      <span style={{ fontSize: 10.5, color: 'var(--pc-muted)' }}>
                        {FIELD_TYPE_META[col.fieldType].label}
                      </span>
                    </div>
                    <DynamicFieldInput
                      mode="form"
                      autoFocusField={idx === 0}
                      column={col}
                      value={draftValues[col.id]}
                      onChange={(nextVal) =>
                        setDraftValues((prev) => ({ ...prev, [col.id]: nextVal }))
                      }
                      allTables={allTables}
                      linkedItems={draftRelations[col.id] || []}
                      onRelationChange={(_ids, summaries) =>
                        setDraftRelations((prev) => ({ ...prev, [col.id]: summaries }))
                      }
                      onNavigateToRow={onNavigateToRow}
                      onEnterSubmit={() => void handleSave()}
                    />
                  </div>
                ))}
              </div>

              {!isCreatingNew && detail && (hasAppointmentLink || detail.appointments.length > 0) && (
                <div className={depth.subcard} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <Calendar size={13} style={{ color: 'var(--pc-blue)' }} />
                      <span>Bağlı Randevular ({detail.appointments.length})</span>
                    </span>
                  </div>
                  {detail.appointments.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--pc-muted)' }}>
                      Bu kayda bağlı randevu bulunmuyor.
                    </span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {detail.appointments.map((appt) => {
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
                          : dt.toLocaleTimeString('tr-TR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                        return (
                          <div
                            key={appt.id}
                            style={{
                              padding: '7px 9px',
                              borderRadius: 9,
                              border: '1px solid var(--input-border)',
                              background: 'var(--card-bg)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 3,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 6,
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              <span>{appt.title}</span>
                              <span className={depth.badge}>
                                {APPT_STATUS_LABELS[appt.status] || appt.status}
                              </span>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 11.5,
                                color: 'var(--pc-muted)',
                              }}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <Clock size={11} />
                                {dateStr} {timeStr}
                              </span>
                              {appt.doctorName && <span>• {appt.doctorName}</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--input-border)',
            background: 'var(--card-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div>
            {!isCreatingNew && canManageSchema && detail?.row && !confirmDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className={depth.btn}
                style={{ minHeight: 32, padding: '4px 10px', color: 'var(--danger)', fontSize: 12 }}
                title="Kaydı sil"
              >
                <Trash2 size={13} />
                <span>Sil</span>
              </button>
            )}
            {!isCreatingNew && canManageSchema && detail?.row && confirmDelete && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <button
                  type="button"
                  onClick={() => void handleDeleteRow()}
                  className={depth.btn}
                  style={{
                    minHeight: 30,
                    padding: '3px 10px',
                    fontSize: 11.5,
                    color: 'var(--danger)',
                    borderColor: 'var(--danger)',
                  }}
                >
                  Evet, Sil
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className={depth.btn}
                  style={{ minHeight: 30, padding: '3px 8px', fontSize: 11.5 }}
                >
                  Vazgeç
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <button
              type="button"
              onClick={onClose}
              className={depth.btn}
              style={{ minHeight: 32, padding: '5px 12px', fontSize: 12 }}
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={saving || loading}
              className={depth.btnPrimary}
              style={{ minHeight: 32, padding: '5px 14px', fontSize: 12 }}
            >
              <Check size={14} color="#ffffff" />
              <span style={{ color: '#ffffff' }}>
                {saving
                  ? 'Kaydediliyor…'
                  : isCreatingNew
                    ? 'Kaydı Oluştur'
                    : 'Değişiklikleri Kaydet'}
              </span>
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body
  )
}
