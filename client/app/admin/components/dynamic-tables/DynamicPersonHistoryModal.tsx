'use client'

import React, { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Calendar, Link2, Table2, X } from 'lucide-react'
import depth from '@/styles/clinic-depth.module.css'
import { useBackdropDismiss } from '../../../../hooks/useBackdropDismiss'
import {
  extractCompactFieldBadges,
  getRelatedRowsMapForAnchors,
} from './appointmentWorkflowHelpers'
import type {
  AppointmentBookingContextData,
  AppointmentContextRow,
  AppointmentContextTableEntry,
} from './AppointmentDynamicRecordsSection'

interface DynamicPersonHistoryModalProps {
  isOpen: boolean
  personName: string
  personPhone?: string | null
  personRowIds: string[]
  context: AppointmentBookingContextData
  workflowEntries: AppointmentContextTableEntry[]
  events: any[]
  doctors: any[]
  onClose: () => void
  onFocusAppointment: (appointmentId: string, startTime: string) => void
}

const STATUS_TR: Record<string, string> = {
  scheduled: '📅 Planlandı',
  confirmed: '✅ Onaylandı',
  arrived_unconfirmed: '🚶 Teyitsiz Geldi',
  waiting_in_clinic: '📍 Bekliyor',
  in_progress: '🔄 Devam Ediyor',
  completed: '✓ Tamamlandı',
  postponed: '⏳ Ertelendi',
  cancelled: '❌ İptal',
  no_show: '🚫 Gelmedi',
  pending_assignment: '⚠️ Atama Bekliyor',
  pending_review: '🤖 Doğrulama Bekliyor',
}

export default function DynamicPersonHistoryModal({
  isOpen,
  personName,
  personPhone,
  personRowIds,
  context,
  workflowEntries,
  events,
  doctors,
  onClose,
  onFocusAppointment,
}: DynamicPersonHistoryModalProps) {
  const backdropDismiss = useBackdropDismiss(onClose)

  const relatedRowIdsSet = useMemo(
    () => getRelatedRowsMapForAnchors(context.relations, context.rowLinks, personRowIds),
    [context.relations, context.rowLinks, personRowIds]
  )

  const relatedRecordsByTable = useMemo(() => {
    const groups: Array<{ entry: AppointmentContextTableEntry; rows: AppointmentContextRow[] }> = []
    for (const entry of workflowEntries) {
      const matched = entry.rows.filter((r) => relatedRowIdsSet.has(r.id))
      if (matched.length > 0) groups.push({ entry, rows: matched })
    }
    return groups
  }, [workflowEntries, relatedRowIdsSet])

  const personAppointments = useMemo(() => {
    const idSet = new Set(personRowIds)
    const phoneDigits = String(personPhone || '').replace(/\D/g, '').slice(-10)
    const cleanName = personName.trim().toLocaleLowerCase('tr-TR')
    return (events || [])
      .filter((ev) => {
        if (!ev) return false
        const links = Array.isArray(ev.dynamicLinks) ? ev.dynamicLinks : []
        if (links.some((lk: any) => idSet.has(lk.rowId))) return true
        if (
          phoneDigits.length === 10 &&
          String(ev.intakePatientPhone || '').replace(/\D/g, '').endsWith(phoneDigits)
        ) {
          return true
        }
        return (
          cleanName &&
          String(ev.intakePatientName || '')
            .trim()
            .toLocaleLowerCase('tr-TR') === cleanName
        )
      })
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
  }, [events, personRowIds, personPhone, personName])

  if (!isOpen || typeof document === 'undefined' || !document.body) return null

  return createPortal(
    <div className={depth.backdrop} style={{ zIndex: 100025 }} {...backdropDismiss}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(620px, calc(100vw - 24px))',
          maxWidth: 620,
          maxHeight: '88vh',
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
            padding: '15px 20px',
            borderBottom: '1px solid var(--input-border)',
            background: 'var(--card-inner)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--foreground)' }}>
              📋 Tüm Kayıtlar ve Randevu Geçmişi
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--foreground-3)', marginTop: 2 }}>
              {personName}
              {personPhone ? ` · ${personPhone}` : ''}
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
            padding: '16px 20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {/* Appointments List */}
          <div className={depth.subcard} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700 }}>
              <Calendar size={14} style={{ color: 'var(--pc-blue)' }} />
              <span>Randevular ({personAppointments.length})</span>
            </div>
            {personAppointments.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--pc-muted)' }}>
                Kayıtlı başka randevu bulunamadı.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {personAppointments.map((ev) => {
                  const docName = doctors.find((d) => d.id === ev.doctorId)?.name
                  const startObj = new Date(ev.startTime)
                  const dateTxt = Number.isNaN(startObj.getTime())
                    ? ''
                    : startObj.toLocaleDateString('tr-TR', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                  const hourTxt = Number.isNaN(startObj.getTime())
                    ? ''
                    : startObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
                  return (
                    <div
                      key={ev.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 9,
                        background: 'var(--card-bg)',
                        border: '1px solid var(--pc-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--foreground)' }}>
                          {ev.title}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--foreground-3)', marginTop: 2 }}>
                          {dateTxt} {hourTxt} · {STATUS_TR[ev.status] || ev.status}
                          {docName ? ` · ${docName}` : ''}
                        </div>
                        {ev.notes && (
                          <div style={{ fontSize: 11, color: 'var(--foreground-2)', marginTop: 2 }}>
                            📝 {ev.notes}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose()
                          onFocusAppointment(ev.id, ev.startTime)
                        }}
                        className={depth.btnPale}
                        style={{ minHeight: 26, padding: '2px 9px', fontSize: 11 }}
                      >
                        <span>Aç</span>
                        <ArrowUpRight size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Connected Workflow Table Records */}
          <div className={depth.subcard} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700 }}>
              <Link2 size={14} style={{ color: 'var(--pc-blue)' }} />
              <span>Kişiye Bağlı İş Akışı Kayıtları</span>
            </div>
            {relatedRecordsByTable.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--pc-muted)' }}>
                Diğer tablolarda bu kişiye bağlı kayıt bulunmuyor.
              </div>
            ) : (
              relatedRecordsByTable.map(({ entry, rows }) => (
                <div key={entry.table.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: 'var(--foreground-2)',
                    }}
                  >
                    <Table2 size={12} style={{ color: entry.table.color || 'var(--pc-blue)' }} />
                    <span>
                      {entry.table.name} ({rows.length})
                    </span>
                  </div>
                  {rows.map((r) => {
                    const badges = extractCompactFieldBadges(r, entry.columns, new Set(), 4)
                    return (
                      <div
                        key={r.id}
                        style={{
                          padding: '7px 10px',
                          borderRadius: 8,
                          background: 'var(--card-bg)',
                          border: '1px solid var(--pc-border)',
                          borderLeft: `4px solid ${entry.table.color || '#2563eb'}`,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)' }}>
                          {r.displayTitle}
                        </div>
                        {badges.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {badges.map((b) => (
                              <span
                                key={b.colId}
                                style={{
                                  fontSize: 10.5,
                                  padding: '1px 6px',
                                  borderRadius: 5,
                                  background: 'var(--card-inner)',
                                  border: '1px solid var(--input-border)',
                                  color: 'var(--foreground-2)',
                                }}
                              >
                                {b.label}: {b.value}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
