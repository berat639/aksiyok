'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  ArrowUpRight,
  Check,
  Link2,
  Pencil,
  Plus,
  Search,
  StickyNote,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import { matchesPhoneSearch } from '@/lib/phone-mask'
import type {
  AppointmentBookingContextData,
  AppointmentContextRow,
  AppointmentContextTableEntry,
} from './AppointmentDynamicRecordsSection'
import AppointmentWorkflowRecordModal from './AppointmentWorkflowRecordModal'
import DynamicPersonHistoryModal from './DynamicPersonHistoryModal'
import QuickScheduleItemModal from './QuickScheduleItemModal'
import {
  buildEmptyFieldDraft,
  classifyAppointmentTables,
  extractCompactFieldBadges,
  findAmountColumn,
  findDateColumn,
  findNoteColumn,
  findRecordAccentColor,
  findStatusColumn,
  getLinkedSubRowIds,
  getRelatedRowsMapForAnchors,
  isCompletedStatusLabel,
  isInProgressStatusLabel,
} from './appointmentWorkflowHelpers'
import { formatCurrencyTR, formatDynamicDateTR } from './types'

export interface DynamicLinkItem {
  tableId: string
  tableName: string
  tableIcon: string
  tableColor: string
  rowId: string
  displayTitle: string
  phone: string | null
  email: string | null
  values: Record<string, any>
  fieldHighlights?: Array<{
    columnId: string
    name: string
    fieldType: string
    displayValue: string
  }>
}

interface AppointmentDetailDynamicEditorProps {
  appointmentId: string
  initialDynamicLinks: DynamicLinkItem[]
  onAppointmentLinksUpdated: (
    nextDynamicLinks: DynamicLinkItem[],
    updatedAppointment?: Record<string, any>
  ) => void
  onRecordFieldsMutated?: () => void
  slot?: 'all' | 'person' | 'workflow'
  sharedContext?: AppointmentBookingContextData | null
  onRefreshSharedContext?: () => Promise<AppointmentBookingContextData | null> | void
  appointmentMeta?: {
    title?: string
    startTime?: string
    doctorId?: string | null
    intakePatientName?: string | null
    intakePatientPhone?: string | null
  }
  events?: any[]
  doctors?: any[]
  shifts?: any[]
  doctorLeaves?: any[]
  isClinicMode?: boolean
  onFocusAppointment?: (appointmentId: string, startTime: string) => void
  onAppointmentCreated?: (createdAppt: any, targetDate: string) => void | Promise<void>
  showHistoryButtonInWorkflowHeader?: boolean
}

export default function AppointmentDetailDynamicEditor({
  appointmentId,
  initialDynamicLinks,
  onAppointmentLinksUpdated,
  onRecordFieldsMutated,
  slot = 'all',
  sharedContext,
  onRefreshSharedContext,
  appointmentMeta,
  events = [],
  doctors = [],
  shifts = [],
  doctorLeaves = [],
  isClinicMode = false,
  onFocusAppointment,
  onAppointmentCreated,
  showHistoryButtonInWorkflowHeader = true,
}: AppointmentDetailDynamicEditorProps) {
  const [localLoading, setLocalLoading] = useState(!sharedContext)
  const [localContext, setLocalContext] = useState<AppointmentBookingContextData>({
    hasAnyDynamicTables: false,
    linkedTables: [],
    allTables: [],
    relations: [],
    rowLinks: [],
  })

  const context = sharedContext && sharedContext.allTables.length > 0 ? sharedContext : localContext

  const [selectedIdsByTable, setSelectedIdsByTable] = useState<Record<string, string[]>>({})
  const [syncingLinks, setSyncingLinks] = useState(false)

  // Person inline switcher / quick-create state
  const [personPickerOpen, setPersonPickerOpen] = useState(false)
  const [personSearch, setPersonSearch] = useState('')
  const [personQuickCreateOpen, setPersonQuickCreateOpen] = useState(false)
  const [personQuickDraft, setPersonQuickDraft] = useState<Record<string, any>>({})
  const [savingPersonQuick, setSavingPersonQuick] = useState(false)

  // Inline note editing on workflow item cards
  const [editingNoteRowId, setEditingNoteRowId] = useState<string | null>(null)
  const [inlineNoteDraft, setInlineNoteDraft] = useState('')
  const [savingInlineRowId, setSavingInlineRowId] = useState<string | null>(null)

  // Modals
  const [workflowModalMode, setWorkflowModalMode] = useState<
    | null
    | { kind: 'add'; initialTableId?: string }
    | { kind: 'edit'; entry: AppointmentContextTableEntry; row: AppointmentContextRow }
  >(null)
  const [scheduleTarget, setScheduleTarget] = useState<{
    entry: AppointmentContextTableEntry
    row: AppointmentContextRow
  } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    const grouped: Record<string, string[]> = {}
    for (const item of initialDynamicLinks || []) {
      if (!item.tableId || !item.rowId) continue
      const list = grouped[item.tableId] || []
      if (!list.includes(item.rowId)) list.push(item.rowId)
      grouped[item.tableId] = list
    }
    setSelectedIdsByTable(grouped)
  }, [appointmentId, initialDynamicLinks])

  const loadContext = useCallback(async () => {
    if (onRefreshSharedContext) {
      await onRefreshSharedContext()
      return
    }
    try {
      const res = await fetch('/api/dynamic-tables/appointment-context')
      const data = await res.json()
      if (data?.error) return
      setLocalContext({
        hasAnyDynamicTables: Boolean(data.hasAnyDynamicTables),
        linkedTables: Array.isArray(data.linkedTables) ? data.linkedTables : [],
        allTables: Array.isArray(data.allTables) ? data.allTables : [],
        relations: Array.isArray(data.relations) ? data.relations : [],
        rowLinks: Array.isArray(data.rowLinks) ? data.rowLinks : [],
      })
    } catch {
      // ignore transient errors
    }
  }, [onRefreshSharedContext])

  useEffect(() => {
    if (sharedContext && sharedContext.allTables.length > 0) {
      setLocalLoading(false)
      return
    }
    let active = true
    setLocalLoading(true)
    loadContext().finally(() => {
      if (active) setLocalLoading(false)
    })
    return () => {
      active = false
    }
  }, [appointmentId, loadContext, sharedContext])

  useEffect(() => {
    setPersonPickerOpen(false)
    setPersonQuickCreateOpen(false)
    setEditingNoteRowId(null)
    setWorkflowModalMode(null)
    setScheduleTarget(null)
    setHistoryOpen(false)
  }, [appointmentId])

  const { personEntry, workflowEntries, tableEntryMap } = useMemo(
    () => classifyAppointmentTables(context, selectedIdsByTable),
    [context, selectedIdsByTable]
  )

  const persistLinksMap = useCallback(
    async (nextMap: Record<string, string[]>) => {
      setSelectedIdsByTable(nextMap)
      const flatLinks: Array<{ tableId: string; rowId: string }> = []
      const seenRowIds = new Set<string>()
      const orderedTableIds = Array.from(
        new Set([
          ...context.linkedTables.map((lt) => lt.table.id),
          ...context.allTables.map((at) => at.table.id),
          ...Object.keys(nextMap),
        ])
      )
      for (const tableId of orderedTableIds) {
        const ids = nextMap[tableId] || []
        for (const rowId of ids) {
          if (rowId && !seenRowIds.has(rowId)) {
            seenRowIds.add(rowId)
            flatLinks.push({ tableId, rowId })
          }
        }
      }

      setSyncingLinks(true)
      try {
        const res = await fetch(`/api/dynamic-tables/appointments/${appointmentId}/links`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            links: flatLinks,
            syncTitle: flatLinks.length > 0,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || 'Randevu kayıtları güncellenemedi')
          return
        }
        onAppointmentLinksUpdated(
          Array.isArray(data.dynamicLinks) ? data.dynamicLinks : [],
          data.appointment
        )
      } catch {
        toast.error('Randevu bağlantıları kaydedilemedi')
      } finally {
        setSyncingLinks(false)
      }
    },
    [appointmentId, context.linkedTables, context.allTables, onAppointmentLinksUpdated]
  )

  const handleAttachRows = async (tableId: string, rowIds: string[]) => {
    const existing = selectedIdsByTable[tableId] || []
    const nextIds = Array.from(new Set([...existing, ...rowIds]))
    await persistLinksMap({
      ...selectedIdsByTable,
      [tableId]: nextIds,
    })
  }

  const handleDetachRow = async (tableId: string, rowId: string) => {
    const existing = selectedIdsByTable[tableId] || []
    await persistLinksMap({
      ...selectedIdsByTable,
      [tableId]: existing.filter((id) => id !== rowId),
    })
    toast.success('Kayıt randevudan çıkarıldı')
  }

  const handleQuickFieldUpdate = async (rowId: string, columnId: string, value: any) => {
    setSavingInlineRowId(rowId)
    try {
      const res = await fetch(`/api/dynamic-tables/rows/${rowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { [columnId]: value } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Alan güncellenemedi')
        return false
      }
      await loadContext()
      onRecordFieldsMutated?.()
      toast.success('Güncellendi')
      return true
    } catch {
      toast.error('Kayıt güncellenirken hata oluştu')
      return false
    } finally {
      setSavingInlineRowId(null)
    }
  }

  // Selected person row resolution
  const selectedPersonRowIds = personEntry ? selectedIdsByTable[personEntry.table.id] || [] : []
  const selectedPersonRow = useMemo(() => {
    if (!personEntry || selectedPersonRowIds.length === 0) return null
    return personEntry.rows.find((r) => r.id === selectedPersonRowIds[0]) || null
  }, [personEntry, selectedPersonRowIds])

  const personDisplayName =
    selectedPersonRow?.displayTitle ||
    appointmentMeta?.intakePatientName ||
    appointmentMeta?.title?.split(' • ')[0]?.split(' - ')[0] ||
    'Kayıt / Kişi'
  const personDisplayPhone =
    selectedPersonRow?.phone || appointmentMeta?.intakePatientPhone || null

  // Collect workflow card items across all non-person attached rows
  const attachedWorkflowItems = useMemo(() => {
    const items: Array<{ entry: AppointmentContextTableEntry; row: AppointmentContextRow }> = []
    const personId = personEntry?.table.id || null

    for (const [tableId, rowIds] of Object.entries(selectedIdsByTable)) {
      if (tableId === personId) continue
      const entry = tableEntryMap.get(tableId)
      if (!entry) continue
      for (const rid of rowIds) {
        const row = entry.rows.find((r) => r.id === rid)
        if (row) items.push({ entry, row })
      }
    }
    return items
  }, [selectedIdsByTable, personEntry, tableEntryMap])

  // Suggested records already connected to the selected Person in dynamic_row_links
  const personRelatedSuggestions = useMemo(() => {
    if (!selectedPersonRow) return []
    const relatedIds = getRelatedRowsMapForAnchors(
      context.relations,
      context.rowLinks,
      [selectedPersonRow.id]
    )
    const attachedSet = new Set(attachedWorkflowItems.map((it) => it.row.id))
    const suggestions: Array<{ entry: AppointmentContextTableEntry; row: AppointmentContextRow }> = []

    for (const entry of workflowEntries) {
      for (const r of entry.rows) {
        if (relatedIds.has(r.id) && !attachedSet.has(r.id)) {
          suggestions.push({ entry, row: r })
        }
      }
    }
    return suggestions.slice(0, 6)
  }, [selectedPersonRow, context.relations, context.rowLinks, workflowEntries, attachedWorkflowItems])

  // Scheduled appointment lookup per rowId (for "Tarih / Randevu Belirle" pill)
  const scheduledAppointmentByRowId = useMemo(() => {
    const map = new Map<string, any>()
    for (const ev of events || []) {
      if (!ev || ev.status === 'cancelled') continue
      const links = Array.isArray(ev.dynamicLinks) ? ev.dynamicLinks : []
      for (const lk of links) {
        if (!lk?.rowId) continue
        const existing = map.get(lk.rowId)
        // Prefer another/future appointment over the currently open appointment so follow-ups stand out
        if (!existing || (existing.id === appointmentId && ev.id !== appointmentId)) {
          map.set(lk.rowId, ev)
        }
      }
    }
    return map
  }, [events, appointmentId])

  if (localLoading && context.allTables.length === 0) return null
  if (!context.hasAnyDynamicTables || context.allTables.length === 0) return null

  const renderPersonSection = () => {
    if (!personEntry) return null

    const pq = personSearch.trim().toLocaleLowerCase('tr-TR')
    const personCandidates = personEntry.rows.filter((r) => {
      if (r.id === selectedPersonRow?.id) return false
      if (!pq) return true
      if (r.displayTitle.toLocaleLowerCase('tr-TR').includes(pq)) return true
      if (matchesPhoneSearch(r.phone, personSearch)) return true
      return Object.values(r.values || {}).some((v) =>
        String(v ?? '')
          .toLocaleLowerCase('tr-TR')
          .includes(pq)
      )
    })

    const personEssentialCols = (() => {
      const nonRel = personEntry.columns.filter((c) => c.fieldType !== 'relation')
      const picked = nonRel.filter(
        (c) =>
          c.isPrimaryTitle ||
          c.id === personEntry.config?.titleColumnId ||
          c.fieldType === 'phone' ||
          c.id === personEntry.config?.phoneColumnId ||
          c.isRequired
      )
      return picked.length > 0 ? picked : nonRel.slice(0, 2)
    })()

    const handleCreateQuickPerson = async () => {
      if (savingPersonQuick) return
      setSavingPersonQuick(true)
      try {
        const res = await fetch(`/api/dynamic-tables/tables/${personEntry.table.id}/rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: personQuickDraft }),
        })
        const created = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(created.error || `${personEntry.table.name} oluşturulamadı`)
          return
        }
        await loadContext()
        await persistLinksMap({
          ...selectedIdsByTable,
          [personEntry.table.id]: [created.id],
        })
        setPersonQuickCreateOpen(false)
        setPersonPickerOpen(false)
        toast.success(`"${created.displayTitle}" bağlandı`)
      } catch {
        toast.error('Kişi eklenirken hata oluştu')
      } finally {
        setSavingPersonQuick(false)
      }
    }

    const emailColId =
      personEntry.config?.emailColumnId ||
      personEntry.columns.find((c) => c.fieldType === 'email')?.id ||
      null
    const selectedPersonEmail =
      (selectedPersonRow && emailColId ? String(selectedPersonRow.values?.[emailColId] || '').trim() : '') ||
      initialDynamicLinks.find((l) => l.rowId === selectedPersonRow?.id)?.email ||
      ''

    const excludeSet = new Set<string>(
      [personEntry.config?.titleColumnId, personEntry.config?.phoneColumnId, emailColId].filter(
        Boolean
      ) as string[]
    )
    const personBadges = selectedPersonRow
      ? extractCompactFieldBadges(selectedPersonRow, personEntry.columns, excludeSet, 3)
      : []

    const initials = (selectedPersonRow?.displayTitle || personDisplayName)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s: string) => s[0]?.toLocaleUpperCase('tr-TR'))
      .join('') || 'KK'

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {selectedPersonRow ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, flex: 1 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'var(--badge-clinic-bg, #e0f2fe)',
                  border: '1px solid var(--badge-clinic-border, #bae6fd)',
                  color: 'var(--badge-clinic-fg, #0369a1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                  flexShrink: 0,
                }}
              >
                {initials}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: '0.92rem',
                    fontWeight: 700,
                    color: 'var(--foreground)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {selectedPersonRow.displayTitle}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px', marginTop: 2 }}>
                  <span style={{ fontSize: '0.74rem', color: 'var(--foreground-2)', fontWeight: 500 }}>
                    📞 {selectedPersonRow.phone || 'Telefon kayıtlı değil'}
                  </span>
                  {selectedPersonEmail && (
                    <span style={{ fontSize: '0.74rem', color: 'var(--foreground-2)', fontWeight: 500 }}>
                      ✉️ {selectedPersonEmail}
                    </span>
                  )}
                </div>
                {personBadges.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                    {personBadges.map((b) => (
                      <span
                        key={b.colId}
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          padding: '1px 7px',
                          borderRadius: 6,
                          background: 'var(--card-bg)',
                          border: '1px solid var(--pc-border)',
                          color: 'var(--foreground-2)',
                        }}
                      >
                        <strong>{b.label}:</strong> {b.value}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() =>
                  setWorkflowModalMode({
                    kind: 'edit',
                    entry: personEntry,
                    row: selectedPersonRow,
                  })
                }
                className={depth.btnPale}
                style={{ minHeight: 26, padding: '2px 8px', fontSize: 11 }}
                title={`${personEntry.table.name} bilgilerini ve bağlı kayıtları düzenle`}
              >
                <Pencil size={11} />
                <span>Düzenle</span>
              </button>
              <button
                type="button"
                onClick={() => setPersonPickerOpen((v) => !v)}
                className={depth.btn}
                style={{ minHeight: 24, padding: '1px 7px', fontSize: 10.5 }}
              >
                <span>{personPickerOpen ? 'Gizle' : 'Değiştir'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '7px 9px',
              borderRadius: 8,
              background: 'var(--card-bg)',
              border: '1px dashed var(--pc-border)',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--foreground-2)' }}>
              <UserCheck size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: '-2px', color: 'var(--pc-blue)' }} />
              {personEntry.table.name} kaydı bağlı değil
            </div>
            <button
              type="button"
              onClick={() => setPersonPickerOpen((v) => !v)}
              className={depth.btnPale}
              style={{ minHeight: 26, padding: '2px 9px', fontSize: 11 }}
            >
              <Plus size={12} />
              <span>{personPickerOpen ? 'Gizle' : `${personEntry.table.name} Seç / Ekle`}</span>
            </button>
          </div>
        )}

        {personPickerOpen && (
          <div
            style={{
              padding: 8,
              borderRadius: 9,
              background: 'var(--card-bg)',
              border: '1px solid var(--pc-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search
                  size={12}
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--pc-muted)',
                  }}
                />
                <input
                  type="text"
                  value={personSearch}
                  onChange={(e) => setPersonSearch(e.target.value)}
                  placeholder={`${personEntry.table.name} ara…`}
                  className={depth.input}
                  style={{ paddingLeft: 26, minHeight: 29, fontSize: 11.5 }}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!personQuickCreateOpen) {
                    setPersonQuickDraft(buildEmptyFieldDraft(personEntry.columns))
                  }
                  setPersonQuickCreateOpen((v) => !v)
                }}
                className={personQuickCreateOpen ? depth.btn : depth.btnPale}
                style={{ minHeight: 29, padding: '2px 9px', fontSize: 11 }}
              >
                {personQuickCreateOpen ? 'Vazgeç' : '+ Yeni'}
              </button>
            </div>

            {personQuickCreateOpen ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {personEssentialCols.map((col) => (
                  <div key={col.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--foreground-2)' }}>
                      {col.name}
                      {col.isRequired ? ' *' : ''}
                    </label>
                    <input
                      type="text"
                      value={personQuickDraft[col.id] ?? ''}
                      onChange={(e) =>
                        setPersonQuickDraft((prev) => ({ ...prev, [col.id]: e.target.value }))
                      }
                      className={depth.input}
                      style={{ minHeight: 30, fontSize: 12 }}
                    />
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    disabled={savingPersonQuick}
                    onClick={() => void handleCreateQuickPerson()}
                    className={depth.btnPrimary}
                    style={{ minHeight: 27, padding: '2px 10px', fontSize: 11 }}
                  >
                    <Check size={12} color="#ffffff" />
                    <span style={{ color: '#ffffff' }}>
                      {savingPersonQuick ? 'Kaydediliyor…' : 'Oluştur ve Bağla'}
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ maxHeight: 135, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {personCandidates.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--pc-muted)', textAlign: 'center', padding: 6 }}>
                    Eşleşen kayıt bulunamadı.
                  </div>
                ) : (
                  personCandidates.slice(0, 25).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setPersonPickerOpen(false)
                        void persistLinksMap({
                          ...selectedIdsByTable,
                          [personEntry.table.id]: [r.id],
                        })
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 9px',
                        borderRadius: 7,
                        border: '1px solid var(--pc-border)',
                        background: 'var(--pc-surface)',
                        color: 'var(--foreground)',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.displayTitle}
                        {r.phone ? ` · ${r.phone}` : ''}
                      </span>
                      <Check size={12} style={{ color: 'var(--pc-blue)', flexShrink: 0 }} />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderWorkflowSection = () => {
    if (workflowEntries.length === 0 && attachedWorkflowItems.length === 0) {
      return null
    }

    return (
      <div
        style={{
          padding: 12,
          borderRadius: 10,
          background: 'var(--card-inner, #f1f5f9)',
          border: '1px solid var(--input-border, #cbd5e1)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* Header Bar — Cloned cleanly from Klinik Tedavi Planı */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--foreground-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {isClinicMode ? 'İş Akışı ve Tablo Kayıtları' : 'İşlemler ve Bağlı Kayıtlar'}
            </span>
            {attachedWorkflowItems.length > 0 && (
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '1px 7px',
                  borderRadius: 999,
                  background: 'var(--badge-clinic-bg, #e0f2fe)',
                  border: '1px solid var(--badge-clinic-border, #bae6fd)',
                  color: 'var(--badge-clinic-fg, #0369a1)',
                }}
              >
                {attachedWorkflowItems.length}
              </span>
            )}
            {syncingLinks && (
              <span style={{ fontSize: 10.5, color: 'var(--pc-muted)' }}>Güncelleniyor…</span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {showHistoryButtonInWorkflowHeader && (
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                style={{
                  fontSize: '0.73rem',
                  fontWeight: 600,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--btn-clinic-blue-border, #93c5fd)',
                  background: 'var(--btn-clinic-blue-bg, #eff6ff)',
                  color: 'var(--btn-clinic-blue-fg, #0284c7)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                📋 Tüm Kayıtlar
              </button>
            )}

            {workflowEntries.length > 0 && (
              <button
                type="button"
                onClick={() => setWorkflowModalMode({ kind: 'add' })}
                className={depth.btnPrimary}
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  padding: '6px 13px',
                  minHeight: 30,
                  borderRadius: 8,
                }}
              >
                <Plus size={14} color="#ffffff" />
                <span style={{ color: '#ffffff' }}>Ekle</span>
              </button>
            )}
          </div>
        </div>

        {/* Person-connected quick suggestion pills (1-click attach) */}
        {personRelatedSuggestions.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              flexWrap: 'wrap',
              padding: '6px 8px',
              borderRadius: 8,
              background: 'var(--card-bg)',
              border: '1px dashed var(--pc-border)',
            }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--pc-muted)' }}>
              Kişiye bağlı:
            </span>
            {personRelatedSuggestions.map(({ entry, row }) => (
              <button
                key={row.id}
                type="button"
                onClick={() => void handleAttachRows(entry.table.id, [row.id])}
                className={depth.btnPale}
                style={{ minHeight: 23, padding: '1px 7px', fontSize: 10.5 }}
                title={`${entry.table.name} kaydını bu randevuya ekle`}
              >
                <Plus size={10} />
                <span>
                  {entry.table.name}: {row.displayTitle}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Cards List or Dashed Empty Box */}
        {attachedWorkflowItems.length === 0 ? (
          <div
            style={{
              fontSize: '0.76rem',
              color: 'var(--foreground-2)',
              padding: '15px 14px',
              background: 'var(--input-bg, #ffffff)',
              borderRadius: 8,
              textAlign: 'center',
              border: '1px dashed var(--input-border, #cbd5e1)',
              lineHeight: 1.5,
            }}
          >
            Bu randevuya bağlı henüz bir işlem veya akış kaydı bulunmuyor.
            <br />
            Yukarıdaki <strong style={{ color: 'var(--pc-blue)' }}>+ Ekle</strong> butonundan
            mevcut kayıtlardan seçebilir veya yeni kayıt ekleyebilirsiniz.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {attachedWorkflowItems.map(({ entry, row }) => {
              const statusCol = findStatusColumn(entry.columns)
              const noteCol = findNoteColumn(entry.columns)
              const amountCol = findAmountColumn(entry.columns)
              const dateCol = findDateColumn(entry.columns)
              const accentColor = findRecordAccentColor(
                row,
                entry.columns,
                entry.table.color || '#2563eb'
              )

              const rawStatusVal = statusCol ? row.values?.[statusCol.id] : undefined
              const statusLabel = (() => {
                if (!statusCol) return ''
                if (statusCol.fieldType === 'boolean') {
                  return rawStatusVal === true ? 'Tamamlandı' : 'Bekliyor'
                }
                const opt = statusCol.config?.options?.find((o) => o.id === rawStatusVal)
                return opt?.label || String(rawStatusVal || '')
              })()

              const isCompleted = statusLabel ? isCompletedStatusLabel(statusLabel) : false
              const isInProgress = !isCompleted && statusLabel ? isInProgressStatusLabel(statusLabel) : false
              const rawAmount = amountCol ? row.values?.[amountCol.id] : null
              const amountText =
                amountCol && rawAmount !== null && rawAmount !== undefined && rawAmount !== ''
                  ? formatCurrencyTR(rawAmount, amountCol.config?.currencySymbol || '₺')
                  : null
              const rawNoteVal = noteCol ? String(row.values?.[noteCol.id] || '').trim() : ''
              const rawDateVal = dateCol ? row.values?.[dateCol.id] : null

              const excludeIds = new Set<string>(
                [
                  statusCol?.id,
                  noteCol?.id,
                  amountCol?.id,
                  dateCol?.id,
                ].filter(Boolean) as string[]
              )
              const compactBadges = extractCompactFieldBadges(row, entry.columns, excludeIds, 3)

              const relCols = entry.columns.filter(
                (c) => c.fieldType === 'relation' && Boolean(c.config?.targetTableId)
              )

              const linkedAppt = scheduledAppointmentByRowId.get(row.id)
              const hasOtherScheduledAppt = linkedAppt && linkedAppt.id !== appointmentId
              const scheduledDisplayText = (() => {
                if (hasOtherScheduledAppt && linkedAppt.startTime) {
                  const dt = new Date(linkedAppt.startTime)
                  if (!Number.isNaN(dt.getTime())) {
                    return dt.toLocaleDateString('tr-TR', {
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  }
                }
                if (rawDateVal) {
                  return formatDynamicDateTR(rawDateVal)
                }
                return null
              })()

              const isEditingThisNote = editingNoteRowId === row.id

              return (
                <div
                  key={row.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: '10px 11px',
                    borderRadius: 9,
                    background: 'var(--input-bg, #ffffff)',
                    border: isCompleted
                      ? '1px solid var(--btn-clinic-mint-border, #86efac)'
                      : '1px solid var(--input-border, #cbd5e1)',
                    borderLeft: `4px solid ${isCompleted ? '#10b981' : accentColor}`,
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Row 1: Dot + Table Pill + Title + Price + Edit / Delete */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        minWidth: 0,
                        flex: 1,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: isCompleted ? '#10b981' : accentColor,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          padding: '2px 6px',
                          borderRadius: 5,
                          background: isCompleted
                            ? 'var(--btn-clinic-mint-bg, #f0fdf4)'
                            : 'var(--badge-clinic-bg, #e0f2fe)',
                          border: isCompleted
                            ? '1px solid var(--btn-clinic-mint-border, #86efac)'
                            : '1px solid var(--badge-clinic-border, #bae6fd)',
                          color: isCompleted
                            ? 'var(--btn-clinic-mint-fg, #15803d)'
                            : 'var(--badge-clinic-fg, #0369a1)',
                          fontWeight: 700,
                          fontSize: '0.67rem',
                          flexShrink: 0,
                        }}
                      >
                        {entry.table.name}
                      </span>
                      <span
                        style={{
                          fontWeight: 700,
                          color: 'var(--foreground)',
                          fontSize: '0.82rem',
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={row.displayTitle}
                      >
                        {row.displayTitle}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      {amountText && (
                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: 'var(--foreground)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {amountText}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setWorkflowModalMode({ kind: 'edit', entry, row })}
                        style={{
                          background: 'var(--btn-clinic-blue-bg, #eff6ff)',
                          border: '1px solid var(--btn-clinic-blue-border, #93c5fd)',
                          color: 'var(--btn-clinic-blue-fg, #0284c7)',
                          borderRadius: 6,
                          padding: '3px 7px',
                          cursor: 'pointer',
                          fontSize: '0.69rem',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                        title="Tüm alanları, notu ve bağlı kayıtları düzenle"
                      >
                        <Pencil size={10} />
                        <span>Düzenle</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDetachRow(entry.table.id, row.id)}
                        style={{
                          background: 'var(--card-inner, #f1f5f9)',
                          border: '1px solid var(--input-border, #cbd5e1)',
                          borderRadius: 6,
                          color: 'var(--danger, #ef4444)',
                          cursor: 'pointer',
                          padding: '4px 6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Randevudan kaldır"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Row 2: Inline Status Selector + Compact Badges */}
                  {(statusCol || compactBadges.length > 0) && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                      }}
                    >
                      {statusCol && statusCol.fieldType === 'select' && (
                        <select
                          disabled={savingInlineRowId === row.id}
                          value={String(rawStatusVal || '')}
                          onChange={(e) =>
                            void handleQuickFieldUpdate(row.id, statusCol.id, e.target.value)
                          }
                          style={{
                            fontSize: '0.72rem',
                            padding: '4px 7px',
                            borderRadius: 6,
                            border: isCompleted
                              ? '1px solid var(--btn-clinic-mint-border, #86efac)'
                              : '1px solid var(--input-border, #cbd5e1)',
                            background: isCompleted
                              ? 'var(--btn-clinic-mint-bg, #f0fdf4)'
                              : 'var(--card-inner, #f1f5f9)',
                            color: isCompleted
                              ? 'var(--btn-clinic-mint-fg, #15803d)'
                              : isInProgress
                                ? '#d97706'
                                : 'var(--foreground)',
                            fontWeight: 700,
                            cursor: 'pointer',
                            outline: 'none',
                          }}
                        >
                          <option value="">{statusCol.name} seç…</option>
                          {(statusCol.config?.options || []).map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {isCompletedStatusLabel(opt.label) ? `✓ ${opt.label}` : opt.label}
                            </option>
                          ))}
                        </select>
                      )}

                      {statusCol && statusCol.fieldType === 'boolean' && (
                        <button
                          type="button"
                          disabled={savingInlineRowId === row.id}
                          onClick={() =>
                            void handleQuickFieldUpdate(row.id, statusCol.id, !Boolean(rawStatusVal))
                          }
                          style={{
                            fontSize: '0.72rem',
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: isCompleted
                              ? '1px solid var(--btn-clinic-mint-border, #86efac)'
                              : '1px solid var(--input-border, #cbd5e1)',
                            background: isCompleted
                              ? 'var(--btn-clinic-mint-bg, #f0fdf4)'
                              : 'var(--card-inner, #f1f5f9)',
                            color: isCompleted
                              ? 'var(--btn-clinic-mint-fg, #15803d)'
                              : 'var(--foreground-2)',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {isCompleted ? `✓ ${statusCol.name}` : `○ ${statusCol.name}`}
                        </button>
                      )}

                      {compactBadges.map((b) => (
                        <span
                          key={b.colId}
                          style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            padding: '2px 7px',
                            borderRadius: 6,
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

                  {/* Row 2b: Connected Sub-Table Relation Chips */}
                  {relCols.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {relCols.map((rc) => {
                        const subTarget = rc.config?.targetTableId
                          ? tableEntryMap.get(rc.config.targetTableId)
                          : undefined
                        if (!subTarget) return null
                        const linkedIds = getLinkedSubRowIds(
                          context.relations,
                          context.rowLinks,
                          row.id,
                          rc
                        )
                        const titles = linkedIds
                          .map((id) => subTarget.rows.find((sr) => sr.id === id)?.displayTitle)
                          .filter(Boolean)
                        return (
                          <button
                            key={rc.id}
                            type="button"
                            onClick={() => setWorkflowModalMode({ kind: 'edit', entry, row })}
                            className={depth.badge}
                            style={{ cursor: 'pointer', fontSize: 10.5 }}
                            title="Bağlı alt kayıtları düzenle"
                          >
                            <Link2 size={10} />
                            <span>
                              {titles.length > 0
                                ? `${rc.name}: ${titles.slice(0, 2).join(', ')}${titles.length > 2 ? ` +${titles.length - 2}` : ''}`
                                : `${rc.name}: + Bağla`}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* Row 2c: Quick Inline Note Viewer / Editor (if table has a Note column) */}
                  {noteCol && (
                    <div>
                      {isEditingThisNote ? (
                        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                          <input
                            type="text"
                            autoFocus
                            value={inlineNoteDraft}
                            onChange={(e) => setInlineNoteDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                void handleQuickFieldUpdate(row.id, noteCol.id, inlineNoteDraft).then(
                                  (ok) => ok && setEditingNoteRowId(null)
                                )
                              } else if (e.key === 'Escape') {
                                setEditingNoteRowId(null)
                              }
                            }}
                            placeholder={`${noteCol.name} yazın…`}
                            className={depth.input}
                            style={{ minHeight: 28, fontSize: 11.5, flex: 1 }}
                          />
                          <button
                            type="button"
                            disabled={savingInlineRowId === row.id}
                            onClick={() =>
                              void handleQuickFieldUpdate(row.id, noteCol.id, inlineNoteDraft).then(
                                (ok) => ok && setEditingNoteRowId(null)
                              )
                            }
                            className={depth.btnPrimary}
                            style={{ minHeight: 28, padding: '2px 9px', fontSize: 11 }}
                          >
                            <Check size={11} color="#ffffff" />
                            <span style={{ color: '#ffffff' }}>Kaydet</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingNoteRowId(null)}
                            className={depth.btn}
                            style={{ minHeight: 28, padding: '2px 7px', fontSize: 11 }}
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingNoteRowId(row.id)
                            setInlineNoteDraft(rawNoteVal)
                          }}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px dashed var(--input-border)',
                            background: 'var(--card-inner)',
                            color: rawNoteVal ? 'var(--foreground-2)' : 'var(--foreground-3)',
                            fontSize: 11,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <StickyNote size={11} style={{ color: 'var(--pc-blue)', flexShrink: 0 }} />
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              flex: 1,
                            }}
                          >
                            {rawNoteVal || `${noteCol.name} ekle…`}
                          </span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Row 3: Schedule / Assign Date Button — Cloned from Klinik Tedavi Planı */}
                  <button
                    type="button"
                    onClick={() => setScheduleTarget({ entry, row })}
                    style={{
                      width: '100%',
                      background: isCompleted
                        ? 'var(--btn-clinic-mint-bg, #f0fdf4)'
                        : scheduledDisplayText
                          ? 'var(--btn-clinic-blue-bg, #eff6ff)'
                          : 'var(--card-inner, #f1f5f9)',
                      border: isCompleted
                        ? '1px solid var(--btn-clinic-mint-border, #86efac)'
                        : scheduledDisplayText
                          ? '1px solid var(--btn-clinic-blue-border, #93c5fd)'
                          : '1px dashed var(--accent, #0284c7)',
                      color: isCompleted
                        ? 'var(--btn-clinic-mint-fg, #15803d)'
                        : 'var(--btn-clinic-blue-fg, #0284c7)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      padding: '5px 10px',
                      fontSize: '0.73rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      boxSizing: 'border-box',
                    }}
                    title="Bu işlem / kayıt için takvimde tarih veya yeni randevu belirle"
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <CalendarDays size={13} />
                      <span>
                        {scheduledDisplayText ? scheduledDisplayText : 'Tarih / Randevu Belirle'}
                      </span>
                    </span>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                      }}
                    >
                      {scheduledDisplayText ? (
                        <>
                          Değiştir <ArrowUpRight size={12} />
                        </>
                      ) : (
                        '+ Planla'
                      )}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {slot === 'person' && renderPersonSection()}
      {slot === 'workflow' && renderWorkflowSection()}
      {slot === 'all' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {renderPersonSection()}
          {renderWorkflowSection()}
        </div>
      )}

      {/* Interactive Add / Edit Modal */}
      <AppointmentWorkflowRecordModal
        mode={workflowModalMode}
        context={context}
        workflowEntries={workflowEntries}
        tableEntryMap={tableEntryMap}
        selectedIdsByTable={selectedIdsByTable}
        personAnchorRowIds={selectedPersonRow ? [selectedPersonRow.id] : []}
        onClose={() => setWorkflowModalMode(null)}
        onAttachRows={handleAttachRows}
        onDetachRow={handleDetachRow}
        onRefreshContext={loadContext}
        onRecordMutated={onRecordFieldsMutated}
      />

      {/* Interactive Date / Appointment Scheduling Modal */}
      {scheduleTarget && (
        <QuickScheduleItemModal
          isOpen={Boolean(scheduleTarget)}
          entry={scheduleTarget.entry}
          row={scheduleTarget.row}
          personLink={
            personEntry && selectedPersonRow
              ? {
                  tableId: personEntry.table.id,
                  rowId: selectedPersonRow.id,
                  displayTitle: selectedPersonRow.displayTitle,
                  phone: selectedPersonRow.phone,
                }
              : null
          }
          currentAppointmentId={appointmentId}
          existingEvents={events}
          doctors={doctors}
          shifts={shifts}
          doctorLeaves={doctorLeaves}
          defaultDate={
            appointmentMeta?.startTime ? String(appointmentMeta.startTime).slice(0, 10) : undefined
          }
          defaultDoctorId={appointmentMeta?.doctorId || null}
          isClinicMode={isClinicMode}
          onClose={() => setScheduleTarget(null)}
          onFocusExistingAppointment={onFocusAppointment}
          onScheduled={async (createdAppt, targetDate) => {
            setScheduleTarget(null)
            await loadContext()
            if (onAppointmentCreated) {
              await onAppointmentCreated(createdAppt, targetDate)
            } else {
              onRecordFieldsMutated?.()
            }
          }}
        />
      )}

      {/* Dynamic Person Records & Appointments History Modal */}
      <DynamicPersonHistoryModal
        isOpen={historyOpen}
        personName={personDisplayName}
        personPhone={personDisplayPhone}
        personRowIds={selectedPersonRowIds}
        context={context}
        workflowEntries={workflowEntries}
        events={events}
        doctors={doctors}
        onClose={() => setHistoryOpen(false)}
        onFocusAppointment={(apptId, startTime) => {
          onFocusAppointment?.(apptId, startTime)
        }}
      />
    </>
  )
}
