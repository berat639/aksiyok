'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'react-hot-toast'
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Pencil,
  Play,
  Plus,
  Repeat,
  Send,
  ShieldCheck,
  Snowflake,
  Trash2,
  Users,
} from 'lucide-react'
import { useAuth } from '../../../../../lib/auth-context'
import {
  addDaysKey,
  dateKey,
  formatDayList,
  isOnCalendar,
  mondayOf,
  monthBounds,
  summarizeStaffWeek,
  weekdayIndex,
  WEEK_DAYS_SHORT,
} from '@/lib/business-profile'
import depth from '@/styles/clinic-depth.module.css'
import ConfirmModal from '../../../../admin/components/ConfirmModal'
import {
  DEFAULT_ROLE_STAFF_PERMS,
  DEFAULT_ROLE_TABS,
  ROLE_BADGE_META,
  getPresetForRole,
  type StaffGranularPermissions,
} from '../../../../admin/components/StaffRolePermissionsSection'
import TimeSelect from './TimeSelect'
import s from './isletme.module.css'

type StaffUser = {
  id: string
  email: string
  name: string
  role: string
  active: boolean
  phone?: string
  specialty?: string
  color?: string
  allowedTabs?: string[]
  staffPermissions?: StaffGranularPermissions
}
type ShiftItem = { id: string; userId: string; date: string; startTime: string; endTime: string; shiftType: string }
type Invitation = { id: string; email: string; name: string; role: string; specialty?: string | null; token: string; status: string }
type Smtp = { ready: boolean; message: string }
type EffectivePerms = { editShifts?: boolean; manageStaff?: boolean }
type RepeatMode = 'week' | 'month'
type Editor = { userId: string; days: number[]; start: string; end: string; repeat: RepeatMode }

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toLocaleUpperCase('tr-TR')).join('') || 'P'
const isAdmin = (u: StaffUser) => u.role === 'yonetici'

const shortDate = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })

export default function PersonelMesaiSection() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'plan' | 'staff'>('plan')
  const [users, setUsers] = useState<StaffUser[]>([])
  const [shifts, setShifts] = useState<ShiftItem[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [smtp, setSmtp] = useState<Smtp>({ ready: true, message: '' })
  const [perms, setPerms] = useState<EffectivePerms>({ editShifts: true, manageStaff: true })
  const [roleTabs, setRoleTabs] = useState<Record<string, string[]>>(DEFAULT_ROLE_TABS)
  const [roleStaff, setRoleStaff] = useState<Record<string, StaffGranularPermissions>>(DEFAULT_ROLE_STAFF_PERMS)
  const [dynamicLabel, setDynamicLabel] = useState('Veri Tabloları')
  const [loaded, setLoaded] = useState(false)

  const [weekStart, setWeekStart] = useState(() => mondayOf(dateKey(new Date())))
  const [editor, setEditor] = useState<Editor | null>(null)
  const [savingShift, setSavingShift] = useState(false)
  const [openPermId, setOpenPermId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'freeze' | 'delete'; user: StaffUser } | null>(null)

  const [invite, setInvite] = useState({ name: '', specialty: '', email: '', onCalendar: true })
  const [inviteError, setInviteError] = useState('')
  const [sending, setSending] = useState(false)

  const fetchAll = useCallback(() => {
    const json = (r: Response) => (r.ok ? r.json() : null)
    Promise.all([
      fetch('/api/admin/users', { credentials: 'include' }).then(json).then((d) => setUsers(Array.isArray(d) ? d : [])),
      fetch('/api/shifts', { credentials: 'include' }).then(json).then((d) => setShifts(Array.isArray(d) ? d : [])),
      fetch('/api/dental/staff-permissions', { credentials: 'include' }).then(json).then((d) => {
        if (d?.effective) setPerms(d.effective)
        if (d?.roleTabs && typeof d.roleTabs === 'object') setRoleTabs((p) => ({ ...p, ...d.roleTabs }))
        if (d?.config && typeof d.config === 'object') setRoleStaff((p) => ({ ...p, ...d.config }))
        if (d?.smtpStatus) setSmtp(d.smtpStatus)
      }),
      fetch('/api/yonetici/users/invitations', { credentials: 'include' }).then(json).then((d) => {
        if (Array.isArray(d?.invitations)) setInvitations(d.invitations)
        if (d?.smtpStatus) setSmtp(d.smtpStatus)
      }),
      fetch('/api/dynamic-tables/schema', { credentials: 'include' }).then(json).then((d) => {
        if (typeof d?.tabLabel === 'string' && d.tabLabel.trim()) setDynamicLabel(d.tabLabel.trim())
      }),
    ].map((p) => p.catch(() => {}))).finally(() => setLoaded(true))
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const isManager = user?.role === 'yonetici' || user?.role === 'super_admin'
  const canManageStaff = isManager || perms.manageStaff === true
  const canEditShifts = isManager || perms.editShifts !== false

  const active = useMemo(() => users.filter((u) => u.active !== false), [users])
  const onCalendarCount = useMemo(() => users.filter(isOnCalendar).length, [users])
  const pending = invitations.filter((i) => i.status === 'pending')

  const permDefs = useMemo(
    () => [
      { id: 'calendar', label: 'Takvim' },
      { id: 'patients', label: dynamicLabel },
      { id: 'knowledge', label: 'Bilgi Tabanı' },
      { id: 'stok', label: 'Stok ve Bakım' },
      { id: 'klinik', label: 'Personel ve Mesai' },
      { id: 'payments', label: 'Finans ve Raporlama' },
    ],
    [dynamicLabel],
  )

  /* ───────────── Mesai ───────────── */

  const openEditor = (u: StaffUser) => {
    if (editor?.userId === u.id) { setEditor(null); return }
    const sum = summarizeStaffWeek(shifts, u.id, weekStart)
    setEditor({ userId: u.id, days: sum?.days ?? [0, 1, 2, 3, 4], start: sum?.startTime ?? '09:00', end: sum?.endTime ?? '18:00', repeat: 'week' })
  }

  const saveShift = async () => {
    if (!editor) return
    if (editor.days.length && editor.end <= editor.start && editor.end !== '24:00') { toast.error('Bitiş saati başlangıçtan sonra olmalı.'); return }
    const range = editor.repeat === 'week' ? { start: weekStart, end: addDaysKey(weekStart, 6) } : monthBounds(weekStart)
    const inRange = shifts.filter((x) => x.userId === editor.userId && x.date >= range.start && x.date <= range.end)
    const toDelete = inRange.filter((x) => !editor.days.includes(weekdayIndex(x.date)))
    setSavingShift(true)
    try {
      if (editor.days.length) {
        const res = await fetch('/api/shifts/plan/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            requestId: `isletme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            plan: {
              userIds: [editor.userId],
              startDate: range.start,
              endDate: range.end,
              weekdays: [...editor.days].sort((a, b) => a - b),
              startTime: editor.start,
              endTime: editor.end,
              shiftType: 'Mesai',
              overwriteAll: true,
            },
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Mesai kaydedilemedi.')
      }
      await Promise.all(toDelete.map((x) => fetch(`/api/shifts/${x.id}`, { method: 'DELETE', credentials: 'include' })))
      toast.success(editor.repeat === 'week' ? 'Haftalık mesai kaydedildi.' : 'Aylık mesai kaydedildi.')
      setEditor(null)
      fetchAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Mesai kaydedilemedi.')
    } finally {
      setSavingShift(false)
    }
  }

  /* ───────────── Personel ───────────── */

  const putUser = async (u: StaffUser, body: Record<string, unknown>, okMsg?: string) => {
    const res = await fetch(`/api/yonetici/users/${u.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Güncellenemedi.')
    if (okMsg) toast.success(okMsg)
    return data
  }

  const setAccess = async (u: StaffUser, nextTabs: string[], nextStaff: StaffGranularPermissions) => {
    if (nextTabs.length === 0) { toast.error('En az bir sekme açık kalmalı.'); return }
    const prev = users
    setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, allowedTabs: nextTabs, staffPermissions: nextStaff } : x)))
    try {
      await putUser(u, { allowedTabs: nextTabs, staffPermissions: nextStaff })
    } catch (err) {
      setUsers(prev)
      toast.error(err instanceof Error ? err.message : 'Yetki güncellenemedi.')
    }
  }

  const accessOf = (u: StaffUser) => {
    const preset = getPresetForRole(u.role, roleTabs, roleStaff)
    return {
      tabs: Array.isArray(u.allowedTabs) && u.allowedTabs.length ? u.allowedTabs : preset.allowedTabs,
      staff: { ...preset.staffPermissions, ...(u.staffPermissions || {}) },
    }
  }

  const runConfirm = async () => {
    if (!confirm) return
    const { kind, user: u } = confirm
    setConfirm(null)
    try {
      if (kind === 'freeze') {
        const data = await putUser(u, { active: !u.active })
        const n = Number(data?.unassignedAppointmentsCount) || 0
        toast.success(u.active ? `${u.name} donduruldu${n ? `; ${n} randevu atama bekliyor.` : '.'}` : `${u.name} yeniden etkinleştirildi.`)
      } else {
        const res = await fetch(`/api/yonetici/users/${u.id}`, { method: 'DELETE', credentials: 'include' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Kaldırılamadı.')
        toast.success(data.message || `${u.name} ekipten kaldırıldı.`)
        setOpenPermId(null)
      }
      fetchAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'İşlem başarısız.')
    }
  }

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteError('')
    if (!invite.name.trim() || !invite.email.trim()) { setInviteError('Ad soyad ve e-posta gerekli.'); return }
    if (!smtp.ready) { setInviteError(smtp.message || 'E-posta (SMTP) entegrasyonu tamamlanmadan davet gönderilemez.'); return }
    const preset = getPresetForRole('calisan', roleTabs, roleStaff)
    setSending(true)
    try {
      const res = await fetch('/api/yonetici/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: invite.name.trim(),
          email: invite.email.trim(),
          role: 'calisan',
          phone: '',
          specialty: invite.specialty.trim(),
          color: '#0284c7',
          allowedTabs: preset.allowedTabs,
          staffPermissions: { ...preset.staffPermissions, showOnCalendar: invite.onCalendar },
          saveAsRoleDefault: false,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setInviteError(data.error || 'Davet gönderilemedi.'); return }
      toast.success('KVKK uyumlu davet e-postası gönderildi.')
      setInvite({ name: '', specialty: '', email: '', onCalendar: invite.onCalendar })
      fetchAll()
    } catch {
      setInviteError('Bağlantı hatası oluştu.')
    } finally {
      setSending(false)
    }
  }

  const revokeInvite = async (inv: Invitation) => {
    const res = await fetch(`/api/yonetici/users/invitations/${inv.id}`, { method: 'DELETE', credentials: 'include' }).catch(() => null)
    if (res?.ok) { setInvitations((p) => p.filter((x) => x.id !== inv.id)); toast.success('Davet iptal edildi.') }
    else toast.error('Davet iptal edilemedi.')
  }

  /* ───────────── Görünüm ───────────── */

  const editorFor = (u: StaffUser) => {
    if (!editor || editor.userId !== u.id) return null
    const toggleDay = (d: number) => setEditor({ ...editor, days: editor.days.includes(d) ? editor.days.filter((x) => x !== d) : [...editor.days, d].sort((a, b) => a - b) })
    const range = editor.repeat === 'week' ? { start: weekStart, end: addDaysKey(weekStart, 6) } : monthBounds(weekStart)
    return (
      <div className={s.compactEdit}>
        <div className={s.row} style={{ justifyContent: 'space-between' }}>
          <div className={s.dayGrid} aria-label="Çalışma günleri">
            {WEEK_DAYS_SHORT.map((d, i) => (
              <button key={d} type="button" aria-pressed={editor.days.includes(i)} className={editor.days.includes(i) ? s.dayBtnOn : s.dayBtn} onClick={() => toggleDay(i)}>
                <span style={editor.days.includes(i) ? { color: '#ffffff' } : undefined}>{d}</span>
              </button>
            ))}
          </div>
          <div className={depth.segmentTrack} role="radiogroup" aria-label="Tekrar">
            <Repeat size={13} style={{ alignSelf: 'center', margin: '0 4px', color: 'var(--foreground-3)' }} />
            {([['week', 'Haftalık'], ['month', 'Aylık']] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={editor.repeat === k} className={editor.repeat === k ? depth.segmentActive : depth.segment} onClick={() => setEditor({ ...editor, repeat: k })}>
                <span style={editor.repeat === k ? { color: '#ffffff' } : undefined}>{l}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={s.row} style={{ justifyContent: 'space-between' }}>
          <div className={s.row}>
            <TimeSelect label="Başlangıç" value={editor.start} onChange={(start) => setEditor({ ...editor, start })} />
            <TimeSelect label="Bitiş" value={editor.end} min={editor.start} allowMidnightEnd onChange={(end) => setEditor({ ...editor, end })} />
          </div>
          <div className={s.row}>
            <span className={s.muted}>{shortDate(range.start)} – {shortDate(range.end)} arasına uygulanır</span>
            <button type="button" className={depth.btn} onClick={() => setEditor(null)}>Kapat</button>
            <button type="button" className={depth.btnPrimary} disabled={savingShift} onClick={saveShift}>
              <span style={{ color: '#ffffff' }}>{savingShift ? 'Kaydediliyor…' : 'Kaydet'}</span>
            </button>
          </div>
        </div>
        {!editor.days.length && <p className={s.muted} style={{ margin: 0 }}>Gün seçmezseniz bu aralıktaki mesaileri kaldırılır.</p>}
      </div>
    )
  }

  return (
    <div className={s.stack}>
      <div className={s.topBar}>
        <div className={depth.segmentTrack} role="tablist" aria-label="Personel bölümleri">
          <button type="button" role="tab" aria-selected={tab === 'plan'} className={tab === 'plan' ? depth.segmentActive : depth.segment} onClick={() => setTab('plan')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...(tab === 'plan' ? { color: '#ffffff' } : {}) }}><Clock size={13} />Mesai Planı</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'staff'} className={tab === 'staff' ? depth.segmentActive : depth.segment} onClick={() => setTab('staff')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...(tab === 'staff' ? { color: '#ffffff' } : {}) }}><Users size={13} />Personeller ({users.length})</span>
          </button>
        </div>
        <span className={depth.badge} style={onCalendarCount ? undefined : { borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          <CalendarDays size={11} />
          {onCalendarCount ? `${onCalendarCount} çalışan takvimde görünüyor` : 'Takvimde görünen çalışan yok'}
        </span>
      </div>

      {!loaded ? (
        <span className={s.muted}>Yükleniyor…</span>
      ) : tab === 'plan' ? (
        <div className={s.panelCard}>
          <div className={s.topBar}>
            <h3 className={s.sectionTitle}>Çalışanlara göre mesai</h3>
            <div className={depth.pager}>
              <button type="button" className={s.iconBtn} aria-label="Önceki hafta" onClick={() => { setWeekStart(addDaysKey(weekStart, -7)); setEditor(null) }}><ChevronLeft size={14} /></button>
              <span style={{ fontWeight: 700, minWidth: 112, textAlign: 'center' }}>{shortDate(weekStart)} – {shortDate(addDaysKey(weekStart, 6))}</span>
              <button type="button" className={s.iconBtn} aria-label="Sonraki hafta" onClick={() => { setWeekStart(addDaysKey(weekStart, 7)); setEditor(null) }}><ChevronRight size={14} /></button>
            </div>
          </div>
          {active.length === 0 ? (
            <div className={s.emptyState}><Users size={18} />Henüz aktif personel yok. Personeller sekmesinden davet edin.</div>
          ) : (
            <div className={s.compactList}>
              {active.map((u) => {
                const sum = summarizeStaffWeek(shifts, u.id, weekStart)
                const editing = editor?.userId === u.id
                return (
                  <div key={u.id} className={s.compactRow}>
                    <div className={s.compactMain}>
                      <span className={s.avatar} style={{ background: u.color || '#0284c7' }}>{initials(u.name)}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className={s.staffName}>{u.name}</div>
                        <div className={s.staffSub}>{sum ? `${formatDayList(sum.days)} · ${sum.startTime}–${sum.endTime}` : 'Bu hafta mesai yok'}</div>
                      </div>
                      <div className={s.compactActions}>
                        {isOnCalendar(u) && <span className={depth.badge}><CalendarDays size={10} />Takvimde</span>}
                        {canEditShifts && (
                          <button type="button" className={editing ? depth.btnPrimary : depth.btn} style={{ minHeight: 28, padding: '3px 9px', fontSize: '11.5px' }} aria-expanded={editing} onClick={() => openEditor(u)}>
                            <Pencil size={12} color={editing ? '#ffffff' : undefined} />
                            <span style={editing ? { color: '#ffffff' } : undefined}>{editing ? 'Kapat' : 'Düzenle'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    {editorFor(u)}
                  </div>
                )
              })}
            </div>
          )}
          <span className={s.muted}>İşletme saatleri Genel İşletme Bilgileri’nden belirlenir; burada yalnızca çalışanların mesaisi planlanır.</span>
        </div>
      ) : (
        <div className={s.stack}>
          <p className={s.muted} style={{ margin: 0 }}>
            <ShieldCheck size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Yetkileri düzenlemek için bir personele dokunun. <strong>Takvimde görünsün</strong> açık olan çalışanlar günlük takvimde sütun olarak yer alır.
          </p>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Personel</th>
                  <th>Rol</th>
                  <th>Takvim</th>
                  <th>Durum</th>
                  <th className={s.stickyCol}><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Yetkiler</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const open = openPermId === u.id
                  const role = ROLE_BADGE_META[u.role] || ROLE_BADGE_META.calisan!
                  const { tabs, staff } = accessOf(u)
                  const activeCount = permDefs.filter((p) => tabs.includes(p.id)).length + (staff.showOnCalendar ? 1 : 0)
                  const admin = isAdmin(u)
                  return (
                    <Fragment key={u.id}>
                      <tr className={`${canManageStaff && !admin ? s.clickRow : ''} ${open ? s.rowOpen : ''}`} onClick={() => canManageStaff && !admin && setOpenPermId(open ? null : u.id)}>
                        <td>
                          <span className={s.row} style={{ flexWrap: 'nowrap' }}>
                            <span className={s.avatar} style={{ background: u.color || '#0284c7' }}>{initials(u.name)}</span>
                            <span style={{ minWidth: 0 }}>
                              <strong className={s.staffName} style={{ display: 'block' }}>{u.name}</strong>
                              <span className={s.staffSub} style={{ display: 'block' }}>{u.specialty || role.label} · {u.email || 'E-posta yok'}</span>
                            </span>
                          </span>
                        </td>
                        <td><span style={{ fontSize: '0.7rem', fontWeight: 750, padding: '2px 8px', borderRadius: 7, background: role.bg, border: `1px solid ${role.border}`, color: role.color, whiteSpace: 'nowrap' }}>{role.label}</span></td>
                        <td>{isOnCalendar(u) ? <span className={depth.badge}><CalendarDays size={11} />Takvimde</span> : <span className={s.muted}>Kapalı</span>}</td>
                        <td>{u.active !== false ? <span className={s.statusOk}>Aktif</span> : <span className={s.statusOff}>Donduruldu</span>}</td>
                        <td className={s.stickyCol} onClick={(e) => e.stopPropagation()}>
                          {admin ? (
                            <span className={s.muted} title="Yönetici tüm modüllere erişir">Tüm yetkiler</span>
                          ) : canManageStaff ? (
                            <button type="button" className={open ? depth.btnPrimary : depth.btn} style={{ minHeight: 30, padding: '4px 10px', whiteSpace: 'nowrap' }} aria-expanded={open} aria-label={`${u.name} yetkilerini düzenle`} onClick={() => setOpenPermId(open ? null : u.id)}>
                              <ShieldCheck size={13} color={open ? '#ffffff' : undefined} />
                              <span style={open ? { color: '#ffffff' } : undefined}>Yetkiler ({activeCount})</span>
                              {open ? <ChevronUp size={13} color="#ffffff" /> : <ChevronDown size={13} />}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={5} className={s.drawer}>
                            <div className={s.row} style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                              <span className={s.muted}><strong>{u.name}</strong> · modül ve takvim yetkileri</span>
                              <div className={s.row} style={{ gap: 6 }}>
                                <button type="button" className={depth.btn} style={{ minHeight: 30 }} onClick={() => setAccess(u, permDefs.map((p) => p.id), { ...staff, showOnCalendar: true })}>Tüm yetkiler</button>
                                <button type="button" className={depth.btn} style={{ minHeight: 30 }} onClick={() => setConfirm({ kind: 'freeze', user: u })}>
                                  {u.active !== false ? <Snowflake size={13} /> : <Play size={13} />}{u.active !== false ? 'Dondur' : 'Etkinleştir'}
                                </button>
                                <button type="button" className={depth.btn} style={{ minHeight: 30, color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => setConfirm({ kind: 'delete', user: u })}>
                                  <Trash2 size={13} />Kaldır
                                </button>
                              </div>
                            </div>
                            <div className={s.permGrid}>
                              <label className={staff.showOnCalendar ? s.permItemOn : s.permItem}>
                                <input type="checkbox" checked={Boolean(staff.showOnCalendar)} onChange={(e) => setAccess(u, tabs, { ...staff, showOnCalendar: e.target.checked })} aria-label={`${u.name} — Takvimde görünsün`} />
                                <CalendarDays size={13} /> Takvimde görünsün
                              </label>
                              {permDefs.map((p) => {
                                const on = tabs.includes(p.id)
                                return (
                                  <label key={p.id} className={on ? s.permItemOn : s.permItem}>
                                    <input type="checkbox" checked={on} onChange={(e) => setAccess(u, e.target.checked ? [...tabs, p.id] : tabs.filter((t) => t !== p.id), staff)} aria-label={`${u.name} — ${p.label}`} />
                                    {p.label}
                                  </label>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {pending.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <span className={s.row} style={{ flexWrap: 'nowrap' }}>
                        <span className={s.avatar} style={{ background: 'var(--foreground-3)' }}>{initials(inv.name)}</span>
                        <span style={{ minWidth: 0 }}>
                          <strong className={s.staffName} style={{ display: 'block' }}>{inv.name}</strong>
                          <span className={s.staffSub} style={{ display: 'block' }}>{inv.specialty || 'Çalışan'} · {inv.email}</span>
                        </span>
                      </span>
                    </td>
                    <td><span className={s.muted}>Çalışan</span></td>
                    <td><span className={s.muted}>—</span></td>
                    <td><span className={depth.badge}><Send size={11} />Davet gönderildi</span></td>
                    <td className={s.stickyCol}>
                      {canManageStaff && (
                        <span className={s.row} style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <button type="button" className={s.iconBtn} title="Davet bağlantısını kopyala" aria-label={`${inv.name} davet bağlantısını kopyala`} onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/invite/${inv.token}`); toast.success('Davet bağlantısı kopyalandı.') }}><Copy size={14} /></button>
                          <button type="button" className={s.iconBtn} title="Daveti iptal et" aria-label={`${inv.name} davetini iptal et`} style={{ color: 'var(--danger)' }} onClick={() => revokeInvite(inv)}><Trash2 size={14} /></button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canManageStaff && (
            <form className={s.panelCard} onSubmit={sendInvite}>
              <h3 className={s.sectionTitle}>Yeni personel davet et</h3>
              <div className={s.inviteGrid}>
                <input className={depth.input} aria-label="Ad soyad" placeholder="Ad soyad" value={invite.name} maxLength={100} onChange={(e) => { setInvite({ ...invite, name: e.target.value }); setInviteError('') }} />
                <input className={depth.input} aria-label="Unvan veya branş" placeholder="Unvan / branş" value={invite.specialty} maxLength={80} onChange={(e) => setInvite({ ...invite, specialty: e.target.value })} />
                <input className={depth.input} aria-label="E-posta" type="email" placeholder="ad@isletme.com" value={invite.email} maxLength={255} onChange={(e) => { setInvite({ ...invite, email: e.target.value }); setInviteError('') }} />
                <button type="submit" className={depth.btnPrimary} disabled={sending || !invite.name.trim()}>
                  <Plus size={14} color="#ffffff" />
                  <span style={{ color: '#ffffff' }}>{sending ? 'Gönderiliyor…' : 'Davet et'}</span>
                </button>
              </div>
              <div className={s.row} style={{ justifyContent: 'space-between', marginTop: 10 }}>
                <label className={s.row} style={{ gap: 6, fontSize: '0.78rem', fontWeight: 650, color: 'var(--foreground)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={invite.onCalendar} onChange={(e) => setInvite({ ...invite, onCalendar: e.target.checked })} style={{ accentColor: '#2563eb' }} />
                  <CalendarDays size={13} /> Takvimde görünsün
                </label>
                <span className={s.muted}>KVKK onamlı e-posta daveti gönderilir.</span>
              </div>
              {!smtp.ready && <p className={s.error}>{smtp.message || 'Davet için Entegrasyonlar (Ayarlar) sekmesinden E-posta (SMTP) kurulumunu tamamlayın.'}</p>}
              {inviteError && <p className={s.error} role="alert">{inviteError}</p>}
            </form>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(confirm)}
        title={confirm?.kind === 'delete' ? 'Personeli kaldır' : confirm?.user.active !== false ? 'Hesabı dondur' : 'Hesabı etkinleştir'}
        message={
          confirm?.kind === 'delete'
            ? `${confirm.user.name} ekipten KVKK uyumlu olarak kaldırılacak. Bu işlem geri alınamaz.`
            : confirm?.user.active !== false
              ? `${confirm?.user.name ?? ''} hesabı dondurulacak ve aktif oturumları kapatılacak. Gelecekteki randevuları atama bekleyen duruma düşer.`
              : `${confirm?.user.name ?? ''} hesabı yeniden etkinleştirilecek.`
        }
        confirmText={confirm?.kind === 'delete' ? 'Kaldır' : confirm?.user.active !== false ? 'Dondur' : 'Etkinleştir'}
        variant={confirm?.kind === 'delete' ? 'danger' : 'warning'}
        onConfirm={runConfirm}
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}
