'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, CalendarDays, ArrowUpRight, Check, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import { useBackdropDismiss } from '../../../../hooks/useBackdropDismiss'
import FancyHourPicker from '../FancyHourPicker'
import ClinicalDatePicker from './ui/ClinicalDatePicker'
import { findDurationMinutesColumn } from './appointmentWorkflowHelpers'
import type {
  AppointmentContextRow,
  AppointmentContextTableEntry,
} from './AppointmentDynamicRecordsSection'

interface QuickScheduleItemModalProps {
  isOpen: boolean
  entry: AppointmentContextTableEntry
  row: AppointmentContextRow
  personLink?: {
    tableId: string
    rowId: string
    displayTitle: string
    phone?: string | null
  } | null
  currentAppointmentId: string
  existingEvents: any[]
  doctors: any[]
  shifts: any[]
  doctorLeaves: any[]
  defaultDate?: string
  defaultDoctorId?: string | null
  isClinicMode?: boolean
  onClose: () => void
  onScheduled: (createdAppt: any, targetDate: string) => void | Promise<void>
  onFocusExistingAppointment?: (appointmentId: string, startTime: string) => void
}

function formatNumberTime(val: number): string {
  const h = Math.floor(val).toString().padStart(2, '0')
  const m = val % 1 === 0.5 ? '30' : '00'
  return `${h}:${m}`
}

export default function QuickScheduleItemModal({
  isOpen,
  entry,
  row,
  personLink,
  currentAppointmentId,
  existingEvents,
  doctors,
  shifts,
  doctorLeaves,
  defaultDate,
  defaultDoctorId,
  isClinicMode = false,
  onClose,
  onScheduled,
  onFocusExistingAppointment,
}: QuickScheduleItemModalProps) {
  const backdropDismiss = useBackdropDismiss(onClose)

  const todayIso = useMemo(() => new Date().toLocaleDateString('sv'), [])
  const [targetDate, setTargetDate] = useState<string>(() => (defaultDate || todayIso).slice(0, 10))
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(() => defaultDoctorId || '')
  const [notes, setNotes] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const inferredDurationHours = useMemo(() => {
    const durCol = findDurationMinutesColumn(entry.columns)
    const mins = durCol ? Number(row.values?.[durCol.id]) : 0
    if (Number.isFinite(mins) && mins >= 15) {
      return Math.max(0.5, Math.ceil(mins / 30) * 0.5)
    }
    return 0.5
  }, [entry.columns, row.values])

  const [timeRange, setTimeRange] = useState<[number, number]>(() => [
    10,
    Math.min(24, 10 + inferredDurationHours),
  ])

  useEffect(() => {
    if (!isOpen) return
    const nextDate = (defaultDate || todayIso).slice(0, 10)
    setTargetDate(nextDate)
    setSelectedDoctorId(defaultDoctorId || '')
    setNotes('')

    const dayShifts = (shifts || []).filter(
      (s: any) => String(s.date || '').slice(0, 10) === nextDate
    )
    const matchingShift =
      (defaultDoctorId
        ? dayShifts.find((s: any) => s.userId === defaultDoctorId)
        : dayShifts[0]) || null

    if (matchingShift?.startTime) {
      const [h, m] = String(matchingShift.startTime).split(':').map(Number)
      const startNum = Math.max(6, Math.min(23, (h || 9) + (m >= 30 ? 0.5 : 0)))
      setTimeRange([startNum, Math.min(24, startNum + inferredDurationHours)])
    } else {
      setTimeRange([10, Math.min(24, 10 + inferredDurationHours)])
    }
  }, [isOpen, defaultDate, defaultDoctorId, todayIso, shifts, inferredDurationHours])

  const linkedAppointments = useMemo(() => {
    return (existingEvents || []).filter((ev) => {
      if (!ev || ev.status === 'cancelled') return false
      const links = Array.isArray(ev.dynamicLinks) ? ev.dynamicLinks : []
      return links.some((lk: any) => lk.rowId === row.id)
    })
  }, [existingEvents, row.id])

  const dayShifts = useMemo(
    () => (shifts || []).filter((s: any) => String(s.date || '').slice(0, 10) === targetDate),
    [shifts, targetDate]
  )

  const selectedDoctorShifts = useMemo(() => {
    if (!selectedDoctorId) return []
    return dayShifts.filter((s: any) => s.userId === selectedDoctorId)
  }, [dayShifts, selectedDoctorId])

  const shiftValidationError = useMemo(() => {
    if (!targetDate) return 'Lütfen geçerli bir tarih seçin.'
    const startMin = Math.round(timeRange[0] * 60)
    const endMin = Math.round(timeRange[1] * 60)

    const isShiftCoveringRange = (shift: any) => {
      const [sH, sM] = String(shift.startTime || '00:00').split(':').map(Number)
      const [eH, eM] = String(shift.endTime || '23:59').split(':').map(Number)
      const shiftStartMin = (sH || 0) * 60 + (sM || 0)
      let shiftEndMin = (eH || 0) * 60 + (eM || 0)
      if (shiftEndMin <= shiftStartMin) shiftEndMin += 1440
      let evStart = startMin
      let evEnd = endMin
      if (evEnd <= evStart) evEnd += 1440
      if (shiftEndMin > 1440 && evStart < shiftStartMin) {
        evStart += 1440
        evEnd += 1440
      }
      return evStart >= shiftStartMin && evEnd <= shiftEndMin
    }

    const findLeaveConflict = (docId: string) =>
      (doctorLeaves || []).find((l: any) => {
        if (l.doctorId !== docId || String(l.date || '').slice(0, 10) !== targetDate) return false
        if (l.isFullDay) return true
        const [sH, sM] = String(l.startTime || '00:00').split(':').map(Number)
        const [eH, eM] = String(l.endTime || '23:59').split(':').map(Number)
        const lStart = (sH || 0) * 60 + (sM || 0)
        const lEnd = (eH || 0) * 60 + (eM || 0)
        return startMin < lEnd && endMin > lStart
      })

    if (!selectedDoctorId) {
      if (dayShifts.length === 0) {
        return `Bu tarihte (${targetDate}) tanımlı vardiya bulunmamaktadır.`
      }
      const covering = dayShifts.filter(isShiftCoveringRange)
      if (covering.length === 0) {
        const ranges = Array.from(
          new Set(dayShifts.map((s: any) => `${s.startTime}-${s.endTime}`))
        ).join(', ')
        return `Seçilen saat aralığı (${formatNumberTime(timeRange[0])}-${formatNumberTime(timeRange[1])}), vardiya saatleri (${ranges}) dışındadır.`
      }
      const hasAvailable = covering.some((s: any) => !s.userId || !findLeaveConflict(s.userId))
      if (!hasAvailable) {
        return 'Seçilen saat aralığında vardiyası olan çalışan(lar) izinlidir.'
      }
      return null
    }

    const docName = doctors.find((d) => d.id === selectedDoctorId)?.name || 'Seçilen çalışan'
    if (selectedDoctorShifts.length === 0) {
      return `${docName} için bu tarihte (${targetDate}) tanımlı vardiya yok.`
    }
    if (!selectedDoctorShifts.some(isShiftCoveringRange)) {
      const ranges = selectedDoctorShifts.map((s: any) => `${s.startTime}-${s.endTime}`).join(', ')
      return `Seçilen saat aralığı, ${docName} vardiya saatleri (${ranges}) dışındadır.`
    }
    const leave = findLeaveConflict(selectedDoctorId)
    if (leave) {
      const rangeTxt = leave.isFullDay ? 'Tüm gün' : `${leave.startTime}-${leave.endTime}`
      return `${docName} bu saatlerde (${rangeTxt}) izinlidir.`
    }
    return null
  }, [targetDate, timeRange, selectedDoctorId, dayShifts, selectedDoctorShifts, doctorLeaves, doctors])

  if (!isOpen || typeof document === 'undefined' || !document.body) return null

  const handleSchedule = async () => {
    if (saving || shiftValidationError) return
    setSaving(true)
    try {
      const sTime = formatNumberTime(timeRange[0])
      const eTime = formatNumberTime(timeRange[1])
      const dynamicLinks: Array<{ tableId: string; rowId: string }> = []
      if (personLink?.tableId && personLink?.rowId) {
        dynamicLinks.push({ tableId: personLink.tableId, rowId: personLink.rowId })
      }
      dynamicLinks.push({ tableId: entry.table.id, rowId: row.id })

      const composedTitle = personLink?.displayTitle
        ? `${personLink.displayTitle} • ${row.displayTitle}`
        : row.displayTitle

      const res = await fetch('/api/calendar/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: null,
          doctorId: selectedDoctorId || null,
          title: composedTitle,
          startTime: `${targetDate}T${sTime}:00+03:00`,
          endTime: `${targetDate}T${eTime}:00+03:00`,
          type: isClinicMode ? 'Muayene' : 'general',
          notes: notes.trim() || null,
          intakeSource: 'dynamic_table',
          intakePatientName: personLink?.displayTitle || row.displayTitle,
          intakePatientPhone: personLink?.phone || row.phone || null,
          dynamicLinks,
          status: selectedDoctorId ? 'scheduled' : 'pending_assignment',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Randevu planlanamadı')
        return
      }
      toast.success('📅 Tarih ve randevu takvime işlendi')
      await onScheduled(body, targetDate)
    } catch {
      toast.error('Randevu planlanırken hata oluştu')
    } finally {
      setSaving(false)
    }
  }

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
              <CalendarDays size={17} color="#ffffff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '0.98rem',
                  fontWeight: 700,
                  color: 'var(--foreground)',
                  lineHeight: 1.2,
                }}
              >
                Tarih / Randevu Belirle
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
                {entry.table.name}: {row.displayTitle}
                {personLink?.displayTitle ? ` · ${personLink.displayTitle}` : ''}
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
            padding: '16px 20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {linkedAppointments.length > 0 && (
            <div
              className={depth.subcard}
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                Bu Kayda Bağlı Mevcut Randevular ({linkedAppointments.length})
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {linkedAppointments.map((ev) => {
                  const isCurrent = ev.id === currentAppointmentId
                  const docName = doctors.find((d) => d.id === ev.doctorId)?.name
                  const startObj = new Date(ev.startTime)
                  const endObj = new Date(ev.endTime)
                  const dateLabel = Number.isNaN(startObj.getTime())
                    ? ''
                    : startObj.toLocaleDateString('tr-TR', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                  const hourLabel = Number.isNaN(startObj.getTime())
                    ? ''
                    : `${startObj.toLocaleTimeString('tr-TR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}–${endObj.toLocaleTimeString('tr-TR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                  return (
                    <div
                      key={ev.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 9px',
                        borderRadius: 8,
                        background: 'var(--card-inner)',
                        border: isCurrent
                          ? '1.5px solid var(--pc-blue)'
                          : '1px solid var(--input-border)',
                        fontSize: 11.5,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--foreground)' }}>
                          📅 {dateLabel} · {hourLabel}
                          {isCurrent ? ' (Açık Randevu)' : ''}
                        </div>
                        {docName && (
                          <div style={{ fontSize: 10.5, color: 'var(--foreground-3)' }}>
                            {docName}
                          </div>
                        )}
                      </div>
                      {!isCurrent && onFocusExistingAppointment && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose()
                            onFocusExistingAppointment(ev.id, ev.startTime)
                          }}
                          className={depth.btnPale}
                          style={{ minHeight: 24, padding: '2px 8px', fontSize: 10.5 }}
                        >
                          <span>Git</span>
                          <ArrowUpRight size={11} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* New Appointment Date + Staff */}
          <div className={depth.subcard} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                  Yeni Randevu Tarihi
                </label>
                <ClinicalDatePicker
                  value={targetDate}
                  onChange={(iso) => setTargetDate(iso || todayIso)}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
                  {isClinicMode ? 'İlgili Hekim' : 'İlgili Çalışan'}
                </label>
                <select
                  value={selectedDoctorId}
                  onChange={(e) => setSelectedDoctorId(e.target.value)}
                  className={depth.input}
                  style={{ minHeight: 34, fontSize: 12 }}
                >
                  <option value="">⚠️ Atama Bekliyor</option>
                  {doctors.map((d) => {
                    const dShifts = dayShifts.filter((s: any) => s.userId === d.id)
                    const suffix =
                      dShifts.length > 0
                        ? ` (${dShifts.map((s: any) => `${s.startTime}-${s.endTime}`).join(', ')})`
                        : ' (Vardiya Yok)'
                    return (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {suffix}
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>

            {shiftValidationError && (
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--danger, #ef4444)',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--danger, #ef4444)',
                  borderRadius: 8,
                  padding: '7px 10px',
                  fontWeight: 600,
                }}
              >
                ⚠️ {shiftValidationError}
              </div>
            )}
          </div>

          {/* Time Picker */}
          <div className={depth.subcard} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)' }}>
                Saat Aralığı
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--pc-blue)' }}>
                <Calendar size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: '-2px' }} />
                {targetDate}
              </span>
            </div>
            <FancyHourPicker range={timeRange} onChange={setTimeRange} />
          </div>

          {/* Note */}
          <div className={depth.subcard} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
              Randevu Notu (İsteğe Bağlı)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Örn: Kontrol seansı / 2. görüşme notu…"
              className={depth.input}
              style={{ fontSize: 12.5 }}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '13px 20px',
            borderTop: '1px solid var(--input-border)',
            background: 'var(--card-inner)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button type="button" onClick={onClose} className={depth.btn}>
            İptal
          </button>
          <button
            type="button"
            disabled={saving || Boolean(shiftValidationError)}
            onClick={() => void handleSchedule()}
            className={depth.btnPrimary}
          >
            <Check size={14} color="#ffffff" />
            <span style={{ color: '#ffffff' }}>
              {saving ? 'Planlanıyor…' : 'Randevu Oluştur ve Bağla'}
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
