'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'react-hot-toast'
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Mail,
  Pencil,
  Phone,
  Play,
  Plus,
  Repeat,
  Send,
  ShieldCheck,
  Snowflake,
  Trash2,
  UserCheck,
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
import ConfirmModal from '../../../../admin/components/ConfirmModal'
import {
  DEFAULT_ROLE_STAFF_PERMS,
  DEFAULT_ROLE_TABS,
  ROLE_BADGE_META,
  getPresetForRole,
  type StaffGranularPermissions,
} from '../../../../admin/components/StaffRolePermissionsSection'
import InfoTooltip from '../../../../admin/components/ui/InfoTooltip'
import TimeSelect from './TimeSelect'
import clay from './isletme-clay.module.css'
import s from './isletme.module.css'
import pm from './PersonelMesaiSection.module.css'

type StaffUser = {
  id: string
  email: string
  name: string
  role: string
  active: boolean
  phone?: string | null
  specialty?: string | null
  color?: string | null
  lastLoginAt?: string | null
  createdAt?: string | null
  allowedTabs?: string[]
  staffPermissions?: StaffGranularPermissions
}
type ShiftItem = { id: string; userId: string; date: string; startTime: string; endTime: string; shiftType: string }
type Invitation = { id: string; email: string; name: string; role: string; specialty?: string | null; token: string; status: string }
type Smtp = { ready: boolean; message: string }
type EffectivePerms = { editShifts?: boolean; manageStaff?: boolean }
type RepeatMode = 'week' | 'month'
type Editor = { userId: string; days: number[]; start: string; end: string; repeat: RepeatMode }
type ProfileEditor = {
  userId: string
  name: string
  email: string
  phone: string
  specialty: string
  role: string
  color: string
  password: string
}

const STAFF_COLORS = ['#0284c7', '#2563eb', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#ef4444', '#0d9488']
const EDITABLE_ROLES = [
  { id: 'calisan', label: 'Çalışan' },
  { id: 'hekim', label: 'Uzman / Danışman' },
  { id: 'sekreter', label: 'Karşılama / Sekreter' },
  { id: 'asistan', label: 'Asistan' },
]

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toLocaleUpperCase('tr-TR')).join('') || 'P'
const isAdmin = (u: StaffUser) => u.role === 'yonetici'

const shortDate = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
const formatLoginDate = (iso?: string | null) => {
  if (!iso) return 'Henüz giriş yok'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Henüz giriş yok'
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function PersonelMesaiSection() {
  const { user } = useAuth()
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
  const [profileEditor, setProfileEditor] = useState<ProfileEditor | null>(null)
  const [savingShift, setSavingShift] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [openPermId, setOpenPermId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'freeze' | 'delete'; user: StaffUser } | null>(null)

  const [invite, setInvite] = useState({ name: '', specialty: '', email: '', phone: '', role: 'calisan', onCalendar: true })
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
    ].map((p) => p.catch(() => { }))).finally(() => setLoaded(true))
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const isManager = user?.role === 'yonetici' || user?.role === 'super_admin'
  const canManageStaff = isManager || perms.manageStaff === true
  const canEditShifts = isManager || perms.editShifts !== false

  const onCalendarCount = useMemo(() => users.filter(isOnCalendar).length, [users])
  const pending = invitations.filter((i) => i.status === 'pending')

  const permDefs = useMemo(
    () => [
      { id: 'calendar', label: 'Takvim' },
      { id: 'patients', label: dynamicLabel },
      { id: 'incoming', label: 'Gelen Kayıtlar' },
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
    setOpenPermId(null)
    setProfileEditor(null)
    const sum = summarizeStaffWeek(shifts, u.id, weekStart)
    setEditor({ userId: u.id, days: sum?.days ?? [0, 1, 2, 3, 4], start: sum?.startTime ?? '09:00', end: sum?.endTime ?? '18:00', repeat: 'week' })
  }

  const togglePerms = (u: StaffUser) => {
    setEditor(null)
    setProfileEditor(null)
    setOpenPermId((prev) => (prev === u.id ? null : u.id))
  }

  const openProfileEditor = (u: StaffUser) => {
    if (profileEditor?.userId === u.id) { setProfileEditor(null); return }
    setEditor(null)
    setOpenPermId(null)
    setProfileEditor({
      userId: u.id,
      name: u.name || '',
      email: u.email || '',
      phone: u.phone || '',
      specialty: u.specialty || '',
      role: u.role || 'calisan',
      color: u.color || '#0284c7',
      password: '',
    })
  }

  const saveProfileEdit = async (u: StaffUser, e: React.FormEvent) => {
    e.preventDefault()
    if (!profileEditor) return
    const name = profileEditor.name.trim()
    const email = profileEditor.email.trim().toLowerCase()
    if (!name) { toast.error('Ad soyad gerekli.'); return }
    if (!email || !email.includes('@')) { toast.error('Geçerli bir e-posta adresi girin.'); return }
    if (profileEditor.password && profileEditor.password.length < 6) {
      toast.error('Yeni şifre en az 6 karakter olmalı.')
      return
    }

    const payload: Record<string, unknown> = {
      name,
      email,
      phone: profileEditor.phone.trim(),
      specialty: profileEditor.specialty.trim(),
      color: profileEditor.color,
    }
    if (!isAdmin(u) && profileEditor.role && profileEditor.role !== u.role) {
      payload.role = profileEditor.role
    }
    if (profileEditor.password) {
      payload.password = profileEditor.password
    }

    setSavingProfile(true)
    try {
      await putUser(u, payload, 'Kullanıcı bilgileri güncellendi.')
      setProfileEditor(null)
      fetchAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bilgiler güncellenemedi.')
    } finally {
      setSavingProfile(false)
    }
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
    const preset = getPresetForRole(invite.role || 'calisan', roleTabs, roleStaff)
    setSending(true)
    try {
      const res = await fetch('/api/yonetici/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: invite.name.trim(),
          email: invite.email.trim(),
          role: invite.role || 'calisan',
          phone: invite.phone.trim(),
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
      setInvite({ name: '', specialty: '', email: '', phone: '', role: invite.role, onCalendar: invite.onCalendar })
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
    const toggleDay = (d: number) =>
      setEditor({
        ...editor,
        days: editor.days.includes(d) ? editor.days.filter((x) => x !== d) : [...editor.days, d].sort((a, b) => a - b),
      })
    const range = editor.repeat === 'week' ? { start: weekStart, end: addDaysKey(weekStart, 6) } : monthBounds(weekStart)
    return (
      <div className={pm.drawerStack}>
        <div className={clay.topBar}>
          <div className={s.dayGrid} aria-label="Çalışma günleri">
            {WEEK_DAYS_SHORT.map((d, i) => {
              const on = editor.days.includes(i)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  className={on ? s.dayBtnOn : s.dayBtn}
                  onClick={() => toggleDay(i)}
                >
                  <span style={on ? { color: '#ffffff' } : undefined}>{d}</span>
                </button>
              )
            })}
          </div>
          <div className={clay.segmentTrack} role="radiogroup" aria-label="Tekrar">
            <Repeat size={13} style={{ alignSelf: 'center', margin: '0 4px', color: 'var(--foreground-2)' }} />
            {([['week', 'Haftalık'], ['month', 'Aylık']] as const).map(([k, l]) => {
              const active = editor.repeat === k
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={active ? clay.segmentOn : clay.segment}
                  onClick={() => setEditor({ ...editor, repeat: k })}
                >
                  <span style={active ? { color: '#ffffff' } : undefined}>{l}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div className={clay.topBar}>
          <div className={clay.row}>
            <TimeSelect label="Başlangıç" value={editor.start} onChange={(start) => setEditor({ ...editor, start })} />
            <TimeSelect label="Bitiş" value={editor.end} min={editor.start} allowMidnightEnd onChange={(end) => setEditor({ ...editor, end })} />
          </div>
          <div className={clay.row}>
            <span className={clay.wellPill}>
              {shortDate(range.start)} – {shortDate(range.end)}
            </span>
            <button type="button" className={clay.ctlBtnSm} onClick={() => setEditor(null)}>
              Kapat
            </button>
            <button
              type="button"
              className={clay.primaryBtn}
              style={{ minHeight: 32, padding: '0 14px', fontSize: 12 }}
              disabled={savingShift}
              onClick={saveShift}
            >
              <Check size={13} color="#ffffff" />
              <span style={{ color: '#ffffff' }}>{savingShift ? 'Kaydediliyor…' : 'Kaydet'}</span>
            </button>
          </div>
        </div>
        {!editor.days.length && (
          <p className={clay.muted} style={{ margin: 0 }}>
            Gün seçmezseniz bu aralıktaki mesaileri kaldırılır.
          </p>
        )}
      </div>
    )
  }

  const activeUserCount = users.filter((u) => u.active !== false).length

  return (
    <div className={clay.scope}>
      {/* Üst Güçlü Mavi Clay Hero Şeridi */}
      <div className={clay.hero}>
        <div className={clay.heroMain}>
          <div className={clay.heroLeft}>
            <span className={clay.heroBadgeIcon} aria-hidden="true">
              <Users size={20} strokeWidth={2.3} color="#ffffff" />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className={clay.heroTitleRow}>
                <h3 className={clay.heroName}>Personeller ve Mesai ({users.length})</h3>
                <InfoTooltip title="Personel ve mesai" glyph="?">
                  Her çalışanın satırından haftalık/aylık mesaisini ve yetkilerini doğrudan düzenleyebilirsiniz. İşletme saatleri Genel İşletme Bilgileri’nden belirlenir.
                </InfoTooltip>
                <span className={clay.heroPill}>
                  <CalendarDays size={11} color="#ffffff" />
                  {onCalendarCount ? `${onCalendarCount} çalışan takvimde görünüyor` : 'Takvimde görünen çalışan yok'}
                </span>
                {pending.length > 0 && (
                  <span className={clay.heroPill}>
                    <Send size={11} color="#ffffff" />
                    {pending.length} bekleyen davet
                  </span>
                )}
              </div>
              <p className={clay.heroMeta}>
                Her çalışanın satırından profil, haftalık/aylık mesai ve modül yetkilerini doğrudan düzenleyin.
              </p>
            </div>
          </div>

          <div className={clay.heroActions}>
            <div className={clay.heroPager}>
              <button
                type="button"
                className={clay.heroPagerBtn}
                aria-label="Önceki hafta"
                onClick={() => {
                  setWeekStart(addDaysKey(weekStart, -7))
                  setEditor(null)
                }}
              >
                <ChevronLeft size={15} color="#ffffff" />
              </button>
              <span className={clay.heroPagerText}>
                {shortDate(weekStart)} – {shortDate(addDaysKey(weekStart, 6))}
              </span>
              <button
                type="button"
                className={clay.heroPagerBtn}
                aria-label="Sonraki hafta"
                onClick={() => {
                  setWeekStart(addDaysKey(weekStart, 7))
                  setEditor(null)
                }}
              >
                <ChevronRight size={15} color="#ffffff" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Ekip Listesi ve Mesai Ana Kartı */}
      <section className={clay.card}>
        <div className={clay.cardHead}>
          <div className={clay.cardTitleGroup}>
            <span className={`${clay.iconChipSm} ${clay.chipBrand}`} aria-hidden="true">
              <Users size={16} strokeWidth={2.3} color="#ffffff" />
            </span>
            <div className={clay.cardTitleRow}>
              <h3 className={clay.cardTitle}>Ekip Listesi ve Mesai</h3>
            </div>
          </div>
          <span className={clay.wellPill}>{activeUserCount} aktif</span>
        </div>

        {!loaded ? (
          <div className={clay.emptyHero}>
            <span className={clay.muted}>Yükleniyor…</span>
          </div>
        ) : users.length === 0 && pending.length === 0 ? (
          <div className={clay.emptyHero}>
            <span className={clay.muted}>Henüz ekip üyesi bulunmuyor.</span>
          </div>
        ) : (
          <div className={clay.tableShell}>
            <table className={clay.table}>
              <thead>
                <tr>
                  <th>Kullanıcı / Personel</th>
                  <th>Rol &amp; Hesap</th>
                  <th>Mesai ({shortDate(weekStart)})</th>
                  <th>Takvim</th>
                  <th>Durum</th>
                  <th className={clay.stickyCol}>İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const permOpen = openPermId === u.id
                  const shiftOpen = editor?.userId === u.id
                  const profileOpen = profileEditor?.userId === u.id
                  const rowExpanded = permOpen || shiftOpen || profileOpen
                  const role = ROLE_BADGE_META[u.role] || ROLE_BADGE_META.calisan!
                  const { tabs, staff } = accessOf(u)
                  const activeCount = permDefs.filter((p) => tabs.includes(p.id)).length + (staff.showOnCalendar ? 1 : 0)
                  const admin = isAdmin(u)
                  const sum = summarizeStaffWeek(shifts, u.id, weekStart)
                  return (
                    <Fragment key={u.id}>
                      <tr
                        className={`${canManageStaff ? clay.rowClick : ''} ${rowExpanded ? clay.rowOpen : ''}`}
                        onClick={() => canManageStaff && openProfileEditor(u)}
                      >
                        <td>
                          <span className={pm.staffCell}>
                            <span className={clay.avatarChip} style={{ background: u.color || '#255ee3' }}>
                              {initials(u.name)}
                            </span>
                            <span className={pm.staffText}>
                              <strong className={pm.staffName}>
                                {u.name}
                                {u.specialty ? (
                                  <span className={`${clay.muted} ${pm.staffSpecialty}`}> · {u.specialty}</span>
                                ) : null}
                              </strong>
                              <span className={pm.staffSubRow}>
                                <span className={pm.staffContact}>
                                  <Mail size={10} /> {u.email || 'E-posta yok'}
                                </span>
                                {u.phone && (
                                  <span className={pm.staffContact}>
                                    <Phone size={10} /> {u.phone}
                                  </span>
                                )}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td>
                          <div className={pm.roleWrap}>
                            <span
                              className={pm.rolePill}
                              style={{ background: role.bg, borderColor: role.border, color: role.color }}
                            >
                              {role.label}
                            </span>
                            <span className={`${clay.muted} ${pm.loginMeta}`}>
                              <UserCheck size={10} /> {formatLoginDate(u.lastLoginAt)}
                            </span>
                          </div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {sum ? (
                            <span className={clay.wellPill}>
                              <Clock size={11} />
                              {formatDayList(sum.days)} · {sum.startTime}–{sum.endTime}
                            </span>
                          ) : (
                            <span className={clay.muted}>Bu hafta mesai yok</span>
                          )}
                        </td>
                        <td>
                          {isOnCalendar(u) ? (
                            <span className={clay.pillBrand}>
                              <CalendarDays size={11} />
                              Takvimde
                            </span>
                          ) : (
                            <span className={clay.muted}>Kapalı</span>
                          )}
                        </td>
                        <td>
                          {u.active !== false ? (
                            <span className={clay.pillGood}>Aktif</span>
                          ) : (
                            <span className={clay.pillDanger}>Donduruldu</span>
                          )}
                        </td>
                        <td className={clay.stickyCol} onClick={(e) => e.stopPropagation()}>
                          <div className={pm.actionGroup}>
                            {canManageStaff && (
                              <button
                                type="button"
                                className={profileOpen ? `${clay.ctlBtnSm} ${clay.ctlBtnOn}` : clay.ctlBtnSm}
                                aria-expanded={profileOpen}
                                aria-label={`${u.name} bilgilerini düzenle`}
                                onClick={() => openProfileEditor(u)}
                              >
                                <Pencil size={12} color={profileOpen ? '#ffffff' : undefined} />
                                <span style={profileOpen ? { color: '#ffffff' } : undefined}>
                                  {profileOpen ? 'Kapat' : 'Düzenle'}
                                </span>
                              </button>
                            )}
                            {canEditShifts && u.active !== false && (
                              <button
                                type="button"
                                className={shiftOpen ? `${clay.ctlBtnSm} ${clay.ctlBtnOn}` : clay.ctlBtnSm}
                                aria-expanded={shiftOpen}
                                aria-label={`${u.name} mesaisini düzenle`}
                                onClick={() => openEditor(u)}
                              >
                                <Clock size={12} color={shiftOpen ? '#ffffff' : undefined} />
                                <span style={shiftOpen ? { color: '#ffffff' } : undefined}>
                                  {shiftOpen ? 'Kapat' : 'Mesai'}
                                </span>
                              </button>
                            )}
                            {admin ? (
                              <span className={clay.wellPill} title="Yönetici tüm modüllere erişir">
                                Tüm yetkiler
                              </span>
                            ) : canManageStaff ? (
                              <button
                                type="button"
                                className={permOpen ? `${clay.ctlBtnSm} ${clay.ctlBtnOn}` : clay.ctlBtnSm}
                                aria-expanded={permOpen}
                                aria-label={`${u.name} yetkilerini düzenle`}
                                onClick={() => togglePerms(u)}
                              >
                                <ShieldCheck size={12} color={permOpen ? '#ffffff' : undefined} />
                                <span style={permOpen ? { color: '#ffffff' } : undefined}>
                                  Yetkiler ({activeCount})
                                </span>
                                {permOpen ? <ChevronUp size={12} color="#ffffff" /> : <ChevronDown size={12} />}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>

                      {profileOpen && profileEditor && (
                        <tr>
                          <td colSpan={6} className={clay.drawerWell}>
                            <form className={pm.drawerStack} onSubmit={(e) => void saveProfileEdit(u, e)}>
                              <div className={clay.topBar}>
                                <span className={clay.muted}>
                                  <strong>{u.name}</strong> · kullanıcı hesap ve profil bilgileri
                                </span>
                                <span className={clay.muted}>
                                  {u.createdAt ? `Kayıt: ${new Date(u.createdAt).toLocaleDateString('tr-TR')} · ` : ''}
                                  Son giriş: {formatLoginDate(u.lastLoginAt)}
                                </span>
                              </div>

                              <div className={pm.grid3}>
                                <label className={clay.field}>
                                  <span className={clay.fieldLabel}>Ad soyad*</span>
                                  <input
                                    aria-label="Kullanıcı ad soyad"
                                    className={clay.wellInput}
                                    required
                                    maxLength={100}
                                    value={profileEditor.name}
                                    onChange={(e) => setProfileEditor({ ...profileEditor, name: e.target.value })}
                                  />
                                </label>

                                <label className={clay.field}>
                                  <span className={clay.fieldLabel}>E-posta (giriş hesabı)*</span>
                                  <input
                                    type="email"
                                    aria-label="Kullanıcı e-posta"
                                    className={clay.wellInput}
                                    required
                                    maxLength={255}
                                    value={profileEditor.email}
                                    onChange={(e) => setProfileEditor({ ...profileEditor, email: e.target.value })}
                                  />
                                </label>

                                <label className={clay.field}>
                                  <span className={clay.fieldLabel}>Telefon</span>
                                  <input
                                    type="tel"
                                    aria-label="Kullanıcı telefon"
                                    className={clay.wellInput}
                                    placeholder="05XX XXX XX XX"
                                    maxLength={32}
                                    value={profileEditor.phone}
                                    onChange={(e) => setProfileEditor({ ...profileEditor, phone: e.target.value })}
                                  />
                                </label>

                                <label className={clay.field}>
                                  <span className={clay.fieldLabel}>Unvan / Görev</span>
                                  <input
                                    aria-label="Kullanıcı unvan"
                                    className={clay.wellInput}
                                    placeholder="Örn. Danışman, Muhasebe"
                                    maxLength={80}
                                    value={profileEditor.specialty}
                                    onChange={(e) => setProfileEditor({ ...profileEditor, specialty: e.target.value })}
                                  />
                                </label>

                                <label className={clay.field}>
                                  <span className={clay.fieldLabel}>Kullanıcı rolü</span>
                                  {admin ? (
                                    <input
                                      className={`${clay.wellInput} ${pm.readonlyInput}`}
                                      value="Yönetici (sabit)"
                                      disabled
                                    />
                                  ) : (
                                    <select
                                      aria-label="Kullanıcı rolü"
                                      className={clay.wellSelect}
                                      value={profileEditor.role}
                                      onChange={(e) => setProfileEditor({ ...profileEditor, role: e.target.value })}
                                    >
                                      {EDITABLE_ROLES.map((r) => (
                                        <option key={r.id} value={r.id}>
                                          {r.label}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </label>

                                <label className={clay.field}>
                                  <span className={clay.fieldLabel}>Yeni şifre (isteğe bağlı)</span>
                                  <input
                                    type="password"
                                    aria-label="Yeni şifre"
                                    className={clay.wellInput}
                                    placeholder="Boş bırakılırsa değişmez"
                                    autoComplete="new-password"
                                    value={profileEditor.password}
                                    onChange={(e) => setProfileEditor({ ...profileEditor, password: e.target.value })}
                                  />
                                </label>
                              </div>

                              <div className={clay.topBar}>
                                <div className={pm.swatchRow}>
                                  <span className={clay.muted}>Takvim rengi:</span>
                                  {STAFF_COLORS.map((col) => (
                                    <button
                                      key={col}
                                      type="button"
                                      aria-label={`Renk ${col}`}
                                      aria-pressed={profileEditor.color === col}
                                      className={profileEditor.color === col ? pm.swatchOn : pm.swatch}
                                      style={{ background: col }}
                                      onClick={() => setProfileEditor({ ...profileEditor, color: col })}
                                    />
                                  ))}
                                </div>

                                <div className={clay.row}>
                                  <button type="button" className={clay.ctlBtnSm} onClick={() => setProfileEditor(null)}>
                                    Vazgeç
                                  </button>
                                  <button
                                    type="submit"
                                    className={clay.primaryBtn}
                                    style={{ minHeight: 32, padding: '0 14px', fontSize: 12 }}
                                    disabled={savingProfile}
                                  >
                                    <Check size={13} color="#ffffff" />
                                    <span style={{ color: '#ffffff' }}>
                                      {savingProfile ? 'Kaydediliyor…' : 'Bilgileri Kaydet'}
                                    </span>
                                  </button>
                                </div>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}

                      {shiftOpen && (
                        <tr>
                          <td colSpan={6} className={clay.drawerWell}>
                            {editorFor(u)}
                          </td>
                        </tr>
                      )}

                      {permOpen && (
                        <tr>
                          <td colSpan={6} className={clay.drawerWell}>
                            <div className={pm.drawerStack}>
                              <div className={clay.topBar}>
                                <span className={clay.muted}>
                                  <strong>{u.name}</strong> · modül ve takvim yetkileri
                                </span>
                                <div className={clay.row}>
                                  <button
                                    type="button"
                                    className={clay.ctlBtnSm}
                                    onClick={() =>
                                      setAccess(
                                        u,
                                        permDefs.map((p) => p.id),
                                        { ...staff, showOnCalendar: true },
                                      )
                                    }
                                  >
                                    Tüm yetkiler
                                  </button>
                                  <button
                                    type="button"
                                    className={u.active !== false ? clay.ctlBtnSm : clay.mintBtn}
                                    onClick={() => setConfirm({ kind: 'freeze', user: u })}
                                  >
                                    {u.active !== false ? <Snowflake size={13} /> : <Play size={13} />}
                                    <span>{u.active !== false ? 'Dondur' : 'Etkinleştir'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={clay.dangerBtn}
                                    onClick={() => setConfirm({ kind: 'delete', user: u })}
                                  >
                                    <Trash2 size={13} />
                                    <span>Kaldır</span>
                                  </button>
                                </div>
                              </div>
                              <div className={clay.permGrid}>
                                <label className={staff.showOnCalendar ? clay.permItemOn : clay.permItem}>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(staff.showOnCalendar)}
                                    onChange={(e) => setAccess(u, tabs, { ...staff, showOnCalendar: e.target.checked })}
                                    aria-label={`${u.name} — Takvimde görünsün`}
                                  />
                                  <CalendarDays size={13} /> Takvimde görünsün
                                </label>
                                {permDefs.map((p) => {
                                  const on = tabs.includes(p.id)
                                  return (
                                    <label key={p.id} className={on ? clay.permItemOn : clay.permItem}>
                                      <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={(e) =>
                                          setAccess(
                                            u,
                                            e.target.checked ? [...tabs, p.id] : tabs.filter((t) => t !== p.id),
                                            staff,
                                          )
                                        }
                                        aria-label={`${u.name} — ${p.label}`}
                                      />
                                      {p.label}
                                    </label>
                                  )
                                })}
                              </div>
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
                      <span className={pm.staffCell}>
                        <span className={clay.avatarChip} style={{ background: '#475569' }}>
                          {initials(inv.name)}
                        </span>
                        <span className={pm.staffText}>
                          <strong className={pm.staffName}>{inv.name}</strong>
                          <span className={pm.staffSubRow}>
                            {inv.specialty || 'Çalışan'} · {inv.email}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className={clay.muted}>Çalışan</span>
                    </td>
                    <td>
                      <span className={clay.muted}>—</span>
                    </td>
                    <td>
                      <span className={clay.muted}>—</span>
                    </td>
                    <td>
                      <span className={clay.pillBrand}>
                        <Send size={11} />
                        Davet gönderildi
                      </span>
                    </td>
                    <td className={clay.stickyCol}>
                      {canManageStaff && (
                        <span className={pm.actionGroup}>
                          <button
                            type="button"
                            className={clay.iconToolBtn}
                            title="Davet bağlantısını kopyala"
                            aria-label={`${inv.name} davet bağlantısını kopyala`}
                            onClick={() => {
                              navigator.clipboard?.writeText(`${window.location.origin}/invite/${inv.token}`)
                              toast.success('Davet bağlantısı kopyalandı.')
                            }}
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            type="button"
                            className={clay.iconToolBtnDanger}
                            title="Daveti iptal et"
                            aria-label={`${inv.name} davetini iptal et`}
                            onClick={() => revokeInvite(inv)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Yeni Kullanıcı / Personel Davet Kartı */}
      {loaded && canManageStaff && (
        <form className={clay.card} onSubmit={sendInvite}>
          <div className={clay.cardHead}>
            <div className={clay.cardTitleGroup}>
              <span className={`${clay.iconChipSm} ${clay.chipMint}`} aria-hidden="true">
                <Plus size={16} strokeWidth={2.4} color="#ffffff" />
              </span>
              <div className={clay.cardTitleRow}>
                <h3 className={clay.cardTitle}>Yeni kullanıcı / personel davet et</h3>
                <InfoTooltip title="Ekip daveti" glyph="?">
                  Davet edilen kullanıcı KVKK onaylı e-posta bağlantısı üzerinden şifresini belirleyerek ekibe katılır.
                </InfoTooltip>
              </div>
            </div>
          </div>

          <div className={pm.grid3}>
            <input
              className={clay.wellInput}
              aria-label="Ad soyad"
              placeholder="Ad soyad*"
              value={invite.name}
              maxLength={100}
              onChange={(e) => {
                setInvite({ ...invite, name: e.target.value })
                setInviteError('')
              }}
            />
            <input
              className={clay.wellInput}
              aria-label="E-posta"
              type="email"
              placeholder="ad@isletme.com*"
              value={invite.email}
              maxLength={255}
              onChange={(e) => {
                setInvite({ ...invite, email: e.target.value })
                setInviteError('')
              }}
            />
            <input
              className={clay.wellInput}
              aria-label="Telefon"
              type="tel"
              placeholder="Telefon (isteğe bağlı)"
              value={invite.phone}
              maxLength={32}
              onChange={(e) => setInvite({ ...invite, phone: e.target.value })}
            />
            <input
              className={clay.wellInput}
              aria-label="Unvan veya branş"
              placeholder="Unvan / görev"
              value={invite.specialty}
              maxLength={80}
              onChange={(e) => setInvite({ ...invite, specialty: e.target.value })}
            />
            <select
              className={clay.wellSelect}
              aria-label="Rol"
              value={invite.role}
              onChange={(e) => setInvite({ ...invite, role: e.target.value })}
            >
              {EDITABLE_ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className={clay.primaryBtn}
              disabled={sending || !invite.name.trim()}
            >
              <Plus size={14} color="#ffffff" />
              <span style={{ color: '#ffffff' }}>{sending ? 'Gönderiliyor…' : 'Davet et'}</span>
            </button>
          </div>

          <div className={clay.topBar}>
            <label className={pm.checkLabel}>
              <input
                type="checkbox"
                checked={invite.onCalendar}
                onChange={(e) => setInvite({ ...invite, onCalendar: e.target.checked })}
                className={pm.checkbox}
              />
              <CalendarDays size={13} />
              <span>Takvimde görünsün</span>
            </label>
            <span className={clay.muted}>KVKK onamlı e-posta daveti gönderilir.</span>
          </div>

          {!smtp.ready && (
            <p className={clay.errorText}>
              {smtp.message || 'Davet için Ayarlar ve Entegrasyonlar bölümünden E-posta (SMTP) kurulumunu tamamlayın.'}
            </p>
          )}
          {inviteError && (
            <p className={clay.errorText} role="alert">
              {inviteError}
            </p>
          )}
        </form>
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
