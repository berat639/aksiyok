'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { toast } from 'react-hot-toast'
import { useAuth } from '../../../../lib/auth-context'
import ShiftContextMenu from '../../../admin/components/ShiftContextMenu'
import DoctorLeaveModal from '../../../admin/components/DoctorLeaveModal'
import ConfirmModal from '../../../admin/components/ConfirmModal'
import StaffRolePermissionsSection, {
  ROLE_BADGE_META,
  STAFF_ROLE_OPTIONS,
  DEFAULT_ROLE_TABS,
  DEFAULT_ROLE_STAFF_PERMS,
  getPresetForRole,
  normalizeStaffRoleForForm,
  type StaffGranularPermissions,
} from '../../../admin/components/StaffRolePermissionsSection'
import ShiftPlanner, { type StaffPlannerPermissions } from './ShiftPlanner'
import { useBackdropDismiss } from '../../../../hooks/useBackdropDismiss'
import { PhoneMaskedInput } from '@/lib/phone-mask'
import {
  User as UserIcon,
  Mail,
  Check,
  X,
  Pencil,
  Trash2,
  CalendarOff,
  ShieldAlert,
  Copy,
  Send,
  Snowflake,
  Play,
} from 'lucide-react'

interface User {
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

interface ShiftItem {
  id: string
  userId: string
  userName: string
  userRole?: string
  userColor?: string
  date: string
  startTime: string
  endTime: string
  shiftType: string
  notes?: string | null
}

interface StaffInvitationItem {
  id: string
  email: string
  name: string
  role: string
  phone?: string | null
  specialty?: string | null
  color?: string | null
  token: string
  status: string
  expiresAt: string
  createdAt: string
}

interface SmtpStatus {
  configured: boolean
  enabled: boolean
  ready: boolean
  fromAddress: string | null
  message: string
}

const neoCardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1.5px solid var(--input-border)',
  borderRadius: 14,
  boxShadow: 'var(--pc-neo-card)',
}

const neoSubCardStyle: React.CSSProperties = {
  background: 'var(--card-inner)',
  border: '1px solid var(--input-border)',
  borderRadius: 12,
  boxShadow: 'var(--pc-neo-subcard)',
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 10,
  border: '1.5px solid var(--input-border)',
  background: 'var(--input-bg)',
  color: 'var(--foreground)',
  boxShadow: 'var(--pc-neo-inset)',
  fontSize: '0.82rem',
  fontWeight: 600,
  outline: 'none',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
}

const clayPrimaryBtnStyle: React.CSSProperties = {
  padding: '9px 16px',
  borderRadius: 10,
  border: '1px solid #1d4ed8',
  background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
  color: '#ffffff',
  boxShadow: 'var(--pc-clay-primary)',
  fontSize: '0.8rem',
  fontWeight: 750,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
}

const clayOutlineBtnStyle: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: 10,
  border: '1px solid var(--btn-clinic-outline-border, #93c5fd)',
  background: 'var(--btn-clinic-outline-bg, #eff6ff)',
  color: 'var(--btn-clinic-outline-text, #1d4ed8)',
  boxShadow: 'var(--pc-clay-btn)',
  fontSize: '0.8rem',
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
}

const ROLE_META = ROLE_BADGE_META

export default function KlinikPersonelTab() {
  const { user } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [shifts, setShifts] = useState<ShiftItem[]>([])
  const [invitations, setInvitations] = useState<StaffInvitationItem[]>([])
  const [smtpStatus, setSmtpStatus] = useState<SmtpStatus>({
    configured: true,
    enabled: true,
    ready: true,
    fromAddress: null,
    message: '',
  })
  const [permissions, setPermissions] = useState<StaffPlannerPermissions>({
    viewShiftPlanner: true,
    editShifts: true,
    manageLeaves: true,
    editClinicWorkingHours: true,
    manageStaff: true,
  })
  const [roleTabsPresets, setRoleTabsPresets] = useState<Record<string, string[]>>(DEFAULT_ROLE_TABS)
  const [roleStaffPresets, setRoleStaffPresets] = useState<Record<string, StaffGranularPermissions>>(DEFAULT_ROLE_STAFF_PERMS)
  const [dynamicTabLabel, setDynamicTabLabel] = useState<string>('Veri Tabloları')

  const [workspace, setWorkspace] = useState<'planner' | 'people'>('planner')

  // Invite Modal State (Yeni Randevu 460px Standart Modal)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const inviteBackdropDismiss = useBackdropDismiss(() => setShowInviteModal(false))
  const [inviteForm, setInviteForm] = useState({
    email: '',
    name: '',
    role: 'calisan',
    phone: '',
    specialty: '',
    color: '#0284c7',
  })
  const [inviteAllowedTabs, setInviteAllowedTabs] = useState<string[]>([...DEFAULT_ROLE_TABS.calisan])
  const [inviteStaffPerms, setInviteStaffPerms] = useState<StaffGranularPermissions>({ ...DEFAULT_ROLE_STAFF_PERMS.calisan })
  const [inviteSaveAsRoleDefault, setInviteSaveAsRoleDefault] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [sendingInvite, setSendingInvite] = useState(false)

  // Context Menu & Leave Modal State
  const [shiftContextMenu, setShiftContextMenu] = useState<{ x: number; y: number; doctorId: string; date: string } | null>(null)
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false)
  const [leaveDoctorId, setLeaveDoctorId] = useState<string | undefined>(undefined)
  const [leaveDate, setLeaveDate] = useState<string | undefined>(undefined)

  // Edit User Modal State (Yeni Randevu 460px Standart Modal)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const editUserBackdropDismiss = useBackdropDismiss(() => setEditingUser(null))
  const [editForm, setEditForm] = useState<{
    name: string
    email: string
    phone: string
    role: string
    specialty: string
    color: string
    active: boolean
  }>({ name: '', email: '', phone: '', role: 'calisan', specialty: '', color: '#0284c7', active: true })
  const [editAllowedTabs, setEditAllowedTabs] = useState<string[]>([...DEFAULT_ROLE_TABS.calisan])
  const [editStaffPerms, setEditStaffPerms] = useState<StaffGranularPermissions>({ ...DEFAULT_ROLE_STAFF_PERMS.calisan })
  const [editSaveAsRoleDefault, setEditSaveAsRoleDefault] = useState(false)
  const [editError, setEditError] = useState('')
  const [isSavingUser, setIsSavingUser] = useState(false)
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<User | null>(null)
  const [confirmFreezeUser, setConfirmFreezeUser] = useState<User | null>(null)

  const activeAdminCount = users.filter((x) => x.role === 'yonetici' && x.active !== false).length
  const canUpdateRoleDefaults = user?.role === 'yonetici' || user?.role === 'super_admin' || user?.role === 'moderator'

  const fetchData = useCallback(() => {
    fetch('/api/admin/users', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setUsers(Array.isArray(list) ? list : []))
      .catch(() => { })

    fetch('/api/shifts', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setShifts(Array.isArray(list) ? list : []))
      .catch(() => { })

    fetch('/api/dental/staff-permissions', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.effective) {
          setPermissions(data.effective)
          if (data.effective.viewShiftPlanner === false) {
            setWorkspace('people')
          }
        }
        if (data?.roleTabs && typeof data.roleTabs === 'object') {
          setRoleTabsPresets((prev) => ({ ...prev, ...data.roleTabs }))
        }
        if (data?.config && typeof data.config === 'object') {
          setRoleStaffPresets((prev) => ({ ...prev, ...data.config }))
        }
        if (data?.smtpStatus) {
          setSmtpStatus(data.smtpStatus)
        }
      })
      .catch(() => { })

    fetch('/api/dynamic-tables/schema', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.tabLabel === 'string' && d.tabLabel.trim()) {
          setDynamicTabLabel(d.tabLabel.trim())
        }
      })
      .catch(() => { })

    fetch('/api/yonetici/users/invitations', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.invitations && Array.isArray(data.invitations)) {
          setInvitations(data.invitations)
        }
        if (data?.smtpStatus) {
          setSmtpStatus(data.smtpStatus)
        }
      })
      .catch(() => { })
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const canManageStaff = user?.role === 'yonetici' || user?.role === 'super_admin' || permissions.manageStaff
  const canManageLeaves = user?.role === 'yonetici' || user?.role === 'super_admin' || permissions.manageLeaves

  const openInviteModal = () => {
    const preset = getPresetForRole('calisan', roleTabsPresets, roleStaffPresets)
    setInviteForm({ email: '', name: '', role: 'calisan', phone: '', specialty: '', color: '#0284c7' })
    setInviteAllowedTabs(preset.allowedTabs)
    setInviteStaffPerms(preset.staffPermissions)
    setInviteSaveAsRoleDefault(false)
    setInviteError('')
    setShowInviteModal(true)
  }

  const handleInviteRoleChange = (nextRole: string) => {
    const preset = getPresetForRole(nextRole, roleTabsPresets, roleStaffPresets)
    setInviteForm((prev) => ({ ...prev, role: nextRole }))
    setInviteAllowedTabs(preset.allowedTabs)
    setInviteStaffPerms(preset.staffPermissions)
  }

  // KVKK-Compliant Email Staff Invite
  async function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault()
    setInviteError('')
    if (!smtpStatus.ready) {
      setInviteError(smtpStatus.message || 'E-Posta (SMTP) entegrasyonu tamamlanmadan personel daveti gönderilemez.')
      return
    }
    setSendingInvite(true)
    try {
      const res = await fetch('/api/yonetici/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...inviteForm,
          allowedTabs: inviteAllowedTabs,
          staffPermissions: inviteStaffPerms,
          saveAsRoleDefault: inviteSaveAsRoleDefault,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setInviteError(data.error || 'Davet gönderilemedi.')
        return
      }
      setShowInviteModal(false)
      setInviteForm({ email: '', name: '', role: 'calisan', phone: '', specialty: '', color: '#0284c7' })
      toast.success('KVKK uyumlu davet e-postası ve rol yetkileri kaydedildi.')
      fetchData()
    } catch {
      setInviteError('Bağlantı hatası oluştu.')
    } finally {
      setSendingInvite(false)
    }
  }

  async function handleRevokeInvitation(id: string) {
    try {
      const res = await fetch(`/api/yonetici/users/invitations/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setInvitations((prev) => prev.filter((item) => item.id !== id))
        toast.success('Davet iptal edildi.')
      } else {
        toast.error('Davet iptal edilemedi.')
      }
    } catch {
      toast.error('Davet iptal edilirken hata oluştu.')
    }
  }

  const openEditModal = (u: User) => {
    if (!canManageStaff) return
    const normalizedRole = normalizeStaffRoleForForm(u.role)
    const preset = getPresetForRole(normalizedRole, roleTabsPresets, roleStaffPresets)
    setEditingUser(u)
    setEditForm({
      name: u.name || '',
      email: u.email || '',
      phone: u.phone || '',
      role: normalizedRole,
      specialty: u.specialty || '',
      color: u.color || '#0284c7',
      active: u.active ?? true,
    })
    setEditAllowedTabs(
      Array.isArray(u.allowedTabs) && u.allowedTabs.length > 0 ? [...u.allowedTabs] : preset.allowedTabs,
    )
    setEditStaffPerms(u.staffPermissions ? { ...preset.staffPermissions, ...u.staffPermissions } : preset.staffPermissions)
    setEditSaveAsRoleDefault(false)
    setEditError('')
  }

  const handleEditRoleChange = (nextRole: string) => {
    const preset = getPresetForRole(nextRole, roleTabsPresets, roleStaffPresets)
    setEditForm((prev) => ({ ...prev, role: nextRole }))
    setEditAllowedTabs(preset.allowedTabs)
    setEditStaffPerms(preset.staffPermissions)
  }

  async function handleUpdateUser(e: React.FormEvent) {
    e.preventDefault()
    if (!editingUser) return
    if (editingUser.id === user?.id && !editForm.active) {
      const msg = 'Güvenlik Uyarısı: Kendi yönetici hesabınızı donduramazsınız.'
      setEditError(msg)
      toast.error(msg)
      return
    }
    if (editingUser.role === 'yonetici' && editingUser.active !== false && activeAdminCount <= 1 && (!editForm.active || editForm.role !== 'yonetici')) {
      const msg = 'Güvenlik Uyarısı: İşletmedeki tek aktif yönetici hesabı dondurulamaz veya yetkisi düşürülemez. Önce başka bir yönetici tanımlayın.'
      setEditError(msg)
      toast.error(msg)
      return
    }
    setIsSavingUser(true)
    setEditError('')
    try {
      const payload: Record<string, unknown> = {
        name: editForm.name,
        email: editForm.email,
        phone: editForm.phone,
        role: editForm.role,
        specialty: editForm.role !== 'yonetici' ? editForm.specialty : null,
        color: editForm.role !== 'yonetici' ? editForm.color : null,
        active: editForm.active,
        ...(editingUser.role !== 'yonetici'
          ? {
              allowedTabs: editAllowedTabs,
              staffPermissions: editStaffPerms,
              saveAsRoleDefault: editSaveAsRoleDefault,
            }
          : {}),
      }
      const res = await fetch(`/api/yonetici/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Güncelleme başarısız')

      setEditingUser(null)
      if (!editForm.active && editingUser.active && Number(data.unassignedAppointmentsCount) > 0) {
        toast.success(`${editForm.name} hesabı donduruldu. Gelecekteki ${data.unassignedAppointmentsCount} randevu boşa çıkarıldı (Atama Bekliyor).`)
      } else {
        toast.success('Personel bilgileri, rol ve yetki izinleri güncellendi.')
      }
      fetchData()
    } catch (err: any) {
      setEditError(err.message || 'Hata oluştu')
      toast.error(err.message || 'Hata oluştu')
    } finally {
      setIsSavingUser(false)
    }
  }

  async function executeFreezeToggle(u: User, nextActive: boolean) {
    try {
      const res = await fetch(`/api/yonetici/users/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ active: nextActive }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Hesap durumu güncellenemedi')
      setConfirmFreezeUser(null)
      if (!nextActive && Number(data.unassignedAppointmentsCount) > 0) {
        toast.success(`${u.name} hesabı donduruldu. Gelecekteki ${data.unassignedAppointmentsCount} randevu boşa çıkarıldı (Atama Bekliyor).`)
      } else {
        toast.success(nextActive ? `${u.name} hesabı yeniden aktifleştirildi.` : `${u.name} hesabı donduruldu ve aktif oturumları kapatıldı.`)
      }
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'İşlem başarısız')
    }
  }

  async function handleToggleFreezeUser(u: User, e?: React.MouseEvent) {
    if (e) e.stopPropagation()
    if (!canManageStaff) return
    if (u.role === 'yonetici') {
      toast.error('⚠️ Yönetici hesabı yalnızca satışçı tarafından İşletmeler sekmesinden ilgili işletme altında dondurulabilir.')
      return
    }
    const nextActive = !u.active
    if (!nextActive) {
      setConfirmFreezeUser(u)
      return
    }
    await executeFreezeToggle(u, true)
  }

  async function handleDeleteUser(u: User) {
    try {
      const res = await fetch(`/api/yonetici/users/${u.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Kaldırılamadı')
      }
      setUsers((prev) => prev.filter((x) => x.id !== u.id))
      setEditingUser(null)
      setConfirmDeleteUser(null)
      toast.success(data.message || 'Personel KVKK uyumlu olarak sistemden kaldırıldı.')
      fetchData()
    } catch (err: any) {
      toast.error(err.message || 'Silme işlemi başarısız')
    }
  }

  const pendingInvitations = invitations.filter((inv) => inv.status === 'pending')

  return (
    <div style={{ width: '100%' }}>
      {/* Zorunlu E-Posta (SMTP) Entegrasyon Uyarı Banner'ı */}
      {!smtpStatus.ready && (users.length === 0 || workspace === 'people' || showInviteModal) && (
        <div
          role="alert"
          style={{
            ...neoSubCardStyle,
            padding: '14px 16px',
            marginBottom: 16,
            border: '1.5px solid var(--danger, #ef4444)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'var(--danger, #ef4444)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ShieldAlert size={19} color="#ffffff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--danger, #ef4444)', marginBottom: 3 }}>
              E-Posta (SMTP) Entegrasyonu Tamamlanmalı
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--foreground)', lineHeight: 1.45, fontWeight: 600 }}>
              {smtpStatus.message ||
                'İşletmenin KVKK uyumlu olarak yeni çalışan veya personel davet edebilmesi için E-Posta (SMTP) entegrasyonunun yapılandırılmış ve aktif olması zorunludur. Lütfen Entegrasyonlar (Ayarlar) sekmesinden E-Posta kurulumunu tamamlayın.'}
            </div>
          </div>
        </div>
      )}

      {/* Üst Sekme Seçici (Yalnızca Mesai Planı ve Personeller — Şablonlar kaldırıldı) */}
      <nav
        aria-label="Ekip ve vardiya bölümleri"
        style={{
          display: 'inline-flex',
          gap: 4,
          marginBottom: 16,
          padding: 4,
          borderRadius: 12,
          background: 'var(--card-inner)',
          border: '1px solid var(--input-border)',
          boxShadow: 'var(--pc-neo-inset)',
        }}
      >
        {permissions.viewShiftPlanner !== false && (
          <button
            type="button"
            onClick={() => setWorkspace('planner')}
            aria-pressed={workspace === 'planner'}
            className={workspace === 'planner' ? 'btn-clinic-primary' : ''}
            style={{
              minHeight: 38,
              padding: '0 16px',
              border: workspace === 'planner' ? '1px solid #1d4ed8' : '1px solid transparent',
              borderRadius: 9,
              cursor: 'pointer',
              fontWeight: 750,
              fontSize: 13,
              background: workspace === 'planner' ? 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)' : 'transparent',
              color: workspace === 'planner' ? '#ffffff' : 'var(--foreground-2)',
              boxShadow: workspace === 'planner' ? 'var(--pc-clay-primary)' : 'none',
            }}
          >
            <span style={{ color: workspace === 'planner' ? '#ffffff' : 'inherit' }}>Mesai Planı</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setWorkspace('people')}
          aria-pressed={workspace === 'people'}
          className={workspace === 'people' ? 'btn-clinic-primary' : ''}
          style={{
            minHeight: 38,
            padding: '0 16px',
            border: workspace === 'people' ? '1px solid #1d4ed8' : '1px solid transparent',
            borderRadius: 9,
            cursor: 'pointer',
            fontWeight: 750,
            fontSize: 13,
            background: workspace === 'people' ? 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)' : 'transparent',
            color: workspace === 'people' ? '#ffffff' : 'var(--foreground-2)',
            boxShadow: workspace === 'people' ? 'var(--pc-clay-primary)' : 'none',
          }}
        >
          <span style={{ color: workspace === 'people' ? '#ffffff' : 'inherit' }}>
            Personeller ({users.length})
          </span>
        </button>
      </nav>

      {/* SEKME 1: MESAİ PLANI */}
      {workspace === 'planner' && permissions.viewShiftPlanner !== false && (
        <ShiftPlanner
          users={users}
          shifts={shifts}
          permissions={permissions}
          onChanged={fetchData}
          onOpenLeave={(userId, date) => {
            setLeaveDoctorId(userId || users[0]?.id)
            setLeaveDate(date)
            setIsLeaveModalOpen(true)
          }}
        />
      )}

      {/* SEKME 2: PERSONELLER & KVKK DAVET YÖNETİMİ */}
      {workspace === 'people' && (
        <section style={{ ...neoCardStyle, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--foreground)', margin: 0 }}>
                İşletme Ekibi & Çalışanlar
              </h2>
              <span
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 750,
                  color: 'var(--badge-clinic-text, #0369a1)',
                  background: 'var(--badge-clinic-bg, #e0f2fe)',
                  padding: '3px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--badge-clinic-border, #bae6fd)',
                }}
              >
                {users.length} kayıtlı · {users.filter((u) => u.active !== false).length} aktif
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canManageLeaves && (
                <button
                  type="button"
                  onClick={() => {
                    setLeaveDoctorId(undefined)
                    setLeaveDate(new Date().toISOString().split('T')[0])
                    setIsLeaveModalOpen(true)
                  }}
                  style={clayOutlineBtnStyle}
                >
                  <CalendarOff size={15} /> İzin / Kapalı Saat Yönetimi
                </button>
              )}

              {canManageStaff && (
                <button
                  type="button"
                  onClick={openInviteModal}
                  className="btn-clinic-primary"
                  style={clayPrimaryBtnStyle}
                >
                  <Mail size={15} color="#ffffff" />
                  <span style={{ color: '#ffffff' }}>+ E-Posta ile Personel Davet Et</span>
                </button>
              )}
            </div>
          </div>

          {/* Bekleyen E-Posta Davetleri */}
          {pendingInvitations.length > 0 && (
            <div style={{ ...neoSubCardStyle, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--foreground)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mail size={15} color="var(--accent)" /> Bekleyen Personel Davetleri ({pendingInvitations.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 10 }}>
                {pendingInvitations.map((inv) => {
                  const roleMeta = ROLE_META[inv.role] || ROLE_META.calisan
                  const inviteLink = typeof window !== 'undefined' ? `${window.location.origin}/invite/${inv.token}` : `/invite/${inv.token}`
                  return (
                    <div
                      key={inv.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: 'var(--card-bg)',
                        border: '1px solid var(--input-border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 750, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {inv.name}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--foreground-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {inv.email}
                        </div>
                        <span
                          style={{
                            display: 'inline-block',
                            marginTop: 4,
                            fontSize: '0.65rem',
                            fontWeight: 750,
                            padding: '2px 7px',
                            borderRadius: 6,
                            background: roleMeta.bg,
                            border: `1px solid ${roleMeta.border}`,
                            color: roleMeta.color,
                          }}
                        >
                          {roleMeta.label} · Onay Bekliyor
                        </span>
                      </div>
                      {canManageStaff && (
                        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(inviteLink)
                              toast.success('Davet bağlantısı panoya kopyalandı')
                            }}
                            style={{ ...clayOutlineBtnStyle, padding: '6px 8px', fontSize: '0.7rem' }}
                            title="Davet bağlantısını kopyala"
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevokeInvitation(inv.id)}
                            style={{
                              ...clayOutlineBtnStyle,
                              padding: '6px 8px',
                              fontSize: '0.7rem',
                              border: '1px solid var(--danger)',
                              color: 'var(--danger)',
                            }}
                            title="Daveti iptal et"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Personel Kartları */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 310px), 1fr))', gap: 12 }}>
            {users.map((u) => {
              const role = ROLE_META[u.role] || ROLE_META.calisan
              return (
                <div
                  key={u.id}
                  onClick={() => openEditModal(u)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setShiftContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      doctorId: u.id,
                      date: new Date().toISOString().split('T')[0]!,
                    })
                  }}
                  style={{
                    ...neoSubCardStyle,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: canManageStaff ? 'pointer' : 'default',
                    opacity: u.active === false ? 0.72 : 1,
                  }}
                >
                  {/* Avatar */}
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 999,
                      background: u.color || '#0284c7',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: '0.88rem',
                      flexShrink: 0,
                      boxShadow: 'var(--pc-clay-btn)',
                    }}
                  >
                    {u.name?.charAt(0)?.toUpperCase() || 'P'}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 750, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.name}
                    </div>
                    <div style={{ fontSize: '0.73rem', color: 'var(--foreground-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.email}
                    </div>
                    {u.specialty && (
                      <div style={{ fontSize: '0.69rem', color: 'var(--accent)', marginTop: 2, fontWeight: 700 }}>
                        {u.specialty}
                      </div>
                    )}
                    {u.role !== 'yonetici' && Array.isArray(u.allowedTabs) && (
                      <div style={{ fontSize: '0.67rem', color: 'var(--foreground-3)', marginTop: 2, fontWeight: 650 }}>
                        {u.allowedTabs.length} görünür sekme · Karttan yetkileri düzenle
                      </div>
                    )}
                  </div>

                  {/* Rozetler ve Hızlı Aksiyonlar */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          padding: '2px 7px',
                          borderRadius: 6,
                          background: role.bg,
                          border: `1px solid ${role.border}`,
                          color: role.color,
                          fontWeight: 750,
                        }}
                      >
                        {role.label}
                      </span>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          padding: '2px 7px',
                          borderRadius: 6,
                          background: u.active ? 'var(--btn-mint-bg, #f0fdf4)' : 'var(--card-bg)',
                          border: u.active ? '1px solid var(--btn-mint-border, #86efac)' : '1px solid var(--danger, #ef4444)',
                          color: u.active ? 'var(--btn-mint-text, #15803d)' : 'var(--danger, #ef4444)',
                          fontWeight: 750,
                        }}
                      >
                        {u.active ? 'Aktif' : 'Donduruldu'}
                      </span>
                    </div>

                    {canManageStaff && (
                      <div style={{ display: 'flex', gap: 5 }}>
                        {u.role === 'yonetici' ? (
                          <span
                            style={{
                              fontSize: '0.64rem',
                              padding: '4px 8px',
                              borderRadius: 7,
                              background: 'var(--card-bg)',
                              border: '1px solid var(--input-border)',
                              color: 'var(--foreground-3)',
                              fontWeight: 700,
                            }}
                            title="Yönetici hesabı yalnızca satışçı tarafından İşletmeler sekmesinden dondurulabilir"
                          >
                            Satış Ekibi (İşletmeler)
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => handleToggleFreezeUser(u, e)}
                            style={{
                              ...clayOutlineBtnStyle,
                              padding: '4px 8px',
                              fontSize: '0.68rem',
                              borderRadius: 7,
                            }}
                            title={u.active ? 'Hesabı Dondur' : 'Hesabı Aktifleştir'}
                          >
                            {u.active ? <Snowflake size={11} /> : <Play size={11} />}
                            {u.active ? 'Dondur' : 'Aktifleştir'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openEditModal(u)
                          }}
                          style={{
                            ...clayOutlineBtnStyle,
                            padding: '4px 7px',
                            fontSize: '0.68rem',
                            borderRadius: 7,
                          }}
                          title="Düzenle"
                        >
                          <Pencil size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── MODAL 1: KVKK Uyumlu E-Posta İle Personel Davet Modalı (Yeni Randevu 460px Standart Modal) ── */}
      {showInviteModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--modal-overlay, rgba(15, 23, 42, 0.6))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100020,
            padding: 16,
          }}
          {...inviteBackdropDismiss}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label="E-Posta ile Personel Davet Et"
            onSubmit={handleInviteSubmit}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(460px, calc(100vw - 24px))',
              maxWidth: 460,
              maxHeight: '90vh',
              background: 'var(--card-bg)',
              borderRadius: 14,
              border: '1.5px solid var(--input-border)',
              boxShadow: 'var(--pc-modal-shadow)',
              boxSizing: 'border-box',
              color: 'var(--foreground)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header (Yeni Randevu Standardı) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '15px 20px',
                borderBottom: '1px solid var(--input-border)',
                background: 'var(--card-inner)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: '#2563eb',
                    boxShadow: 'var(--pc-clay-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Mail size={17} color="#ffffff" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.2 }}>
                    Personel Davet Et (KVKK Uyumlu)
                  </h3>
                  <div style={{ fontSize: '0.75rem', color: 'var(--foreground-3)', marginTop: 2 }}>
                    Şifreyi personel kendi e-postasından belirler
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                aria-label="Kapat"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid var(--input-border)',
                  background: 'var(--input-bg)',
                  color: 'var(--foreground)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: 'var(--pc-clay-btn)',
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div
              style={{
                padding: '18px 20px',
                flex: 1,
                overflowY: 'auto',
                background: 'var(--card-bg)',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              {!smtpStatus.ready && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--card-inner)',
                    border: '1px solid var(--danger)',
                    color: 'var(--danger)',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                  }}
                >
                  ⚠️ {smtpStatus.message || 'E-Posta (SMTP) entegrasyonu aktif değil. Davet göndermeden önce SMTP ayarlarını tamamlayın.'}
                </div>
              )}

              <div
                style={{
                  background: 'var(--card-inner)',
                  padding: 14,
                  borderRadius: 10,
                  border: '1px solid var(--input-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--foreground)' }}>
                  Personel Bilgileri
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-2)', display: 'block', marginBottom: 4 }}>
                    Ad Soyad *
                  </label>
                  <input
                    placeholder="Örn: Dr. Ahmet Yılmaz"
                    value={inviteForm.name}
                    onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                    required
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-2)', display: 'block', marginBottom: 4 }}>
                    Kurumsal / Kişisel E-Posta *
                  </label>
                  <input
                    type="email"
                    placeholder="ornek@axamaz.com"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                    required
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-2)', display: 'block', marginBottom: 4 }}>
                      Rol *
                    </label>
                    <select
                      value={inviteForm.role}
                      onChange={(e) => handleInviteRoleChange(e.target.value)}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                      {STAFF_ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-2)', display: 'block', marginBottom: 4 }}>
                      Telefon (Opsiyonel)
                    </label>
                    <PhoneMaskedInput
                      placeholder="0 (5XX) XXX XX XX"
                      value={inviteForm.phone}
                      onValueChange={(phone) => setInviteForm({ ...inviteForm, phone })}
                      style={inputStyle}
                    />
                  </div>
                </div>

                {inviteForm.role !== 'yonetici' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-2)', display: 'block', marginBottom: 4 }}>
                        Ünvan / Uzmanlık Alanı
                      </label>
                      <input
                        placeholder="Örn: Müşteri Temsilcisi, Uzman"
                        value={inviteForm.specialty}
                        onChange={(e) => setInviteForm({ ...inviteForm, specialty: e.target.value })}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-2)', display: 'block', marginBottom: 4 }}>
                        Takvim Rengi
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38 }}>
                        <input
                          type="color"
                          value={inviteForm.color}
                          onChange={(e) => setInviteForm({ ...inviteForm, color: e.target.value })}
                          style={{ width: 42, height: 34, border: 'none', borderRadius: 8, cursor: 'pointer', background: 'transparent' }}
                        />
                        <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--foreground-2)' }}>{inviteForm.color}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <StaffRolePermissionsSection
                role={inviteForm.role}
                allowedTabs={inviteAllowedTabs}
                staffPermissions={inviteStaffPerms}
                onChangeAllowedTabs={setInviteAllowedTabs}
                onChangeStaffPermissions={setInviteStaffPerms}
                onResetToRoleDefault={() => {
                  const preset = getPresetForRole(inviteForm.role, roleTabsPresets, roleStaffPresets)
                  setInviteAllowedTabs(preset.allowedTabs)
                  setInviteStaffPerms(preset.staffPermissions)
                }}
                saveAsRoleDefault={inviteSaveAsRoleDefault}
                onChangeSaveAsRoleDefault={setInviteSaveAsRoleDefault}
                canUpdateRoleDefaults={canUpdateRoleDefaults}
                dynamicTabLabel={dynamicTabLabel}
              />

              {inviteError && (
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 10,
                    background: 'var(--card-inner)',
                    border: '1px solid var(--danger)',
                    color: 'var(--danger)',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                  }}
                >
                  ⚠️ {inviteError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid var(--input-border)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
                background: 'var(--card-inner)',
              }}
            >
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                style={{
                  padding: '9px 18px',
                  borderRadius: 8,
                  border: '1px solid var(--input-border)',
                  background: 'var(--card-bg)',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                  fontSize: '0.86rem',
                  fontWeight: 600,
                  boxShadow: 'var(--pc-clay-btn)',
                }}
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={sendingInvite || !smtpStatus.ready}
                className="btn-clinic-primary"
                style={{
                  padding: '9px 24px',
                  borderRadius: 8,
                  background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  border: '1px solid #1d4ed8',
                  cursor: sendingInvite || !smtpStatus.ready ? 'not-allowed' : 'pointer',
                  fontSize: '0.86rem',
                  fontWeight: 700,
                  boxShadow: 'var(--pc-clay-primary)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  opacity: sendingInvite || !smtpStatus.ready ? 0.6 : 1,
                }}
              >
                <Send size={14} color="#ffffff" />
                <span style={{ color: '#ffffff' }}>
                  {sendingInvite ? 'Gönderiliyor…' : 'Kaydet'}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── MODAL 2: Personel Düzenleme / Rol & Yetki / Dondurma Modalı (Yeni Randevu 460px Standart Modal) ── */}
      {editingUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--modal-overlay, rgba(15, 23, 42, 0.6))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100020,
            padding: 16,
          }}
          {...editUserBackdropDismiss}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Personel Düzenle"
            onSubmit={handleUpdateUser}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(460px, calc(100vw - 24px))',
              maxWidth: 460,
              maxHeight: '90vh',
              background: 'var(--card-bg)',
              borderRadius: 14,
              border: '1.5px solid var(--input-border)',
              boxShadow: 'var(--pc-modal-shadow)',
              boxSizing: 'border-box',
              color: 'var(--foreground)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header (Yeni Randevu Standardı) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '15px 20px',
                borderBottom: '1px solid var(--input-border)',
                background: 'var(--card-inner)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: '#2563eb',
                    boxShadow: 'var(--pc-clay-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    flexShrink: 0,
                  }}
                >
                  <UserIcon size={17} color="#ffffff" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.2 }}>
                    Personel Bilgileri & Yetki
                  </h3>
                  <div style={{ fontSize: '0.75rem', color: 'var(--foreground-3)', marginTop: 2 }}>{editingUser.email}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                aria-label="Kapat"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid var(--input-border)',
                  background: 'var(--input-bg)',
                  color: 'var(--foreground)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: 'var(--pc-clay-btn)',
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div
              style={{
                padding: '18px 20px',
                flex: 1,
                overflowY: 'auto',
                background: 'var(--card-bg)',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div
                style={{
                  background: 'var(--card-inner)',
                  padding: 14,
                  borderRadius: 10,
                  border: '1px solid var(--input-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--foreground)' }}>
                  Kişisel Bilgiler
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-2)', display: 'block', marginBottom: 4 }}>
                      Ad Soyad *
                    </label>
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      required
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-2)', display: 'block', marginBottom: 4 }}>
                      E-Posta *
                    </label>
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      required
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-2)', display: 'block', marginBottom: 4 }}>
                      Telefon
                    </label>
                    <PhoneMaskedInput
                      value={editForm.phone}
                      onValueChange={(phone) => setEditForm({ ...editForm, phone })}
                      placeholder="0 (5XX) XXX XX XX"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-2)', display: 'block', marginBottom: 4 }}>
                      Rol
                    </label>
                    {editingUser.role === 'yonetici' ? (
                      <input
                        value="İşletme Yöneticisi"
                        disabled
                        style={{ ...inputStyle, opacity: 0.75, cursor: 'not-allowed' }}
                      />
                    ) : (
                      <select
                        value={editForm.role}
                        onChange={(e) => handleEditRoleChange(e.target.value)}
                        style={{ ...inputStyle, cursor: 'pointer' }}
                      >
                        {STAFF_ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {editForm.role !== 'yonetici' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-2)', display: 'block', marginBottom: 4 }}>
                        Ünvan / Uzmanlık
                      </label>
                      <input
                        value={editForm.specialty}
                        onChange={(e) => setEditForm({ ...editForm, specialty: e.target.value })}
                        placeholder="Örn: Müşteri Temsilcisi, Uzman"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-2)', display: 'block', marginBottom: 4 }}>
                        Takvim Rengi
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38 }}>
                        <input
                          type="color"
                          value={editForm.color}
                          onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                          style={{ width: 42, height: 34, border: 'none', borderRadius: 8, cursor: 'pointer', background: 'transparent' }}
                        />
                        <span style={{ fontSize: '0.76rem', color: 'var(--foreground-2)', fontWeight: 700 }}>{editForm.color}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <StaffRolePermissionsSection
                role={editingUser.role === 'yonetici' ? 'yonetici' : editForm.role}
                allowedTabs={editAllowedTabs}
                staffPermissions={editStaffPerms}
                onChangeAllowedTabs={setEditAllowedTabs}
                onChangeStaffPermissions={setEditStaffPerms}
                onResetToRoleDefault={() => {
                  const preset = getPresetForRole(editForm.role, roleTabsPresets, roleStaffPresets)
                  setEditAllowedTabs(preset.allowedTabs)
                  setEditStaffPerms(preset.staffPermissions)
                }}
                saveAsRoleDefault={editSaveAsRoleDefault}
                onChangeSaveAsRoleDefault={setEditSaveAsRoleDefault}
                canUpdateRoleDefaults={canUpdateRoleDefaults}
                dynamicTabLabel={dynamicTabLabel}
              />

              {/* Hesap Dondurma / Aktifleştirme Kartı */}
              {(() => {
                const isTargetAdmin = editingUser.role === 'yonetici'
                const freezeLocked = isTargetAdmin
                return (
                  <div
                    style={{
                      background: 'var(--card-inner)',
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: '1px solid var(--input-border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--foreground)' }}>
                          Hesap Durumu ({editForm.active ? 'Aktif' : 'Donduruldu'})
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--foreground-3)' }}>
                          Dondurulan çalışan sisteme giriş yapamaz, geçmiş kayıtları korunur.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (freezeLocked) {
                            toast.error(
                              '⚠️ Yönetici hesabı yalnızca satışçı tarafından İşletmeler sekmesinden ilgili işletme altında dondurulabilir.'
                            )
                            return
                          }
                          setEditForm({ ...editForm, active: !editForm.active })
                        }}
                        style={{
                          ...clayOutlineBtnStyle,
                          padding: '6px 12px',
                          fontSize: '0.75rem',
                          borderRadius: 8,
                          border: editForm.active ? '1px solid var(--btn-mint-border, #86efac)' : '1px solid var(--danger, #ef4444)',
                          background: editForm.active ? 'var(--btn-mint-bg, #f0fdf4)' : 'var(--card-bg)',
                          color: editForm.active ? 'var(--btn-mint-text, #15803d)' : 'var(--danger, #ef4444)',
                          opacity: freezeLocked ? 0.65 : 1,
                        }}
                      >
                        {editForm.active ? <Check size={13} /> : <Snowflake size={13} />}
                        {editForm.active ? 'Aktif' : 'Donduruldu'}
                      </button>
                    </div>
                    {freezeLocked && (
                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          background: 'var(--card-bg)',
                          border: '1px solid #f59e0b',
                          color: '#d97706',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <ShieldAlert size={14} style={{ flexShrink: 0 }} />
                        <span>
                          İşletme yöneticisi hesabı yalnızca satışçı tarafından İşletmeler sekmesinden ilgili işletme altında dondurulabilir.
                        </span>
                      </div>
                    )}
                    {!editForm.active && editingUser.active && (editForm.role === 'hekim' || editForm.role === 'calisan') && (
                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          background: 'var(--calendar-unassigned-bg, #ffedd5)',
                          border: '1px solid var(--calendar-unassigned-border, #f97316)',
                          color: 'var(--calendar-unassigned-text, #9a3412)',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          lineHeight: 1.4,
                        }}
                      >
                        ⚠️ Çalışan hesabı dondurulduğunda, gelecekteki aktif randevuları boşa çıkarılır ve ana takvimde turuncu renkli &quot;Çalışan ayrıldı, atama bekliyor&quot; uyarısıyla gösterilir.
                      </div>
                    )}
                  </div>
                )
              })()}

              {editError && (
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 10,
                    background: 'var(--card-inner)',
                    border: '1px solid var(--danger)',
                    color: 'var(--danger)',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                  }}
                >
                  ⚠️ {editError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid var(--input-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                background: 'var(--card-inner)',
              }}
            >
              {editingUser.role !== 'yonetici' ? (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteUser(editingUser)}
                  style={{
                    ...clayOutlineBtnStyle,
                    border: '1px solid var(--danger)',
                    background: 'var(--card-bg)',
                    color: 'var(--danger)',
                    padding: '9px 12px',
                    borderRadius: 8,
                    fontSize: '0.78rem',
                  }}
                >
                  <Trash2 size={14} /> KVKK Kaldır
                </button>
              ) : (
                <div />
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 8,
                    border: '1px solid var(--input-border)',
                    background: 'var(--card-bg)',
                    color: 'var(--foreground)',
                    cursor: 'pointer',
                    fontSize: '0.86rem',
                    fontWeight: 600,
                    boxShadow: 'var(--pc-clay-btn)',
                  }}
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSavingUser}
                  className="btn-clinic-primary"
                  style={{
                    padding: '9px 24px',
                    borderRadius: 8,
                    background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
                    color: '#ffffff',
                    border: '1px solid #1d4ed8',
                    cursor: isSavingUser ? 'not-allowed' : 'pointer',
                    fontSize: '0.86rem',
                    fontWeight: 700,
                    boxShadow: 'var(--pc-clay-primary)',
                  }}
                >
                  <span style={{ color: '#ffffff' }}>{isSavingUser ? 'Kaydediliyor…' : 'Kaydet'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Hesap Dondurma Onay Modalı */}
      {confirmFreezeUser && (
        <ConfirmModal
          isOpen={true}
          title={confirmFreezeUser.role === 'hekim' || confirmFreezeUser.role === 'calisan' ? 'Çalışan Hesabını Dondur' : 'Personel Hesabını Dondur'}
          message={
            confirmFreezeUser.role === 'hekim' || confirmFreezeUser.role === 'calisan'
              ? `"${confirmFreezeUser.name}" adlı çalışanın hesabını dondurmak istediğinize emin misiniz? Aktif oturumları kapatılır ve gelecekteki tüm aktif randevuları boşa çıkarılarak ana takvimde turuncu renkli "Çalışan ayrıldı, atama bekliyor" uyarısıyla gösterilir.`
              : `"${confirmFreezeUser.name}" adlı personelin hesabını dondurmak istediğinize emin misiniz? Dondurulan personel sisteme giriş yapamaz, geçmiş kayıtları korunur.`
          }
          confirmText="Evet, Hesabı Dondur"
          cancelText="Vazgeç"
          variant="warning"
          onConfirm={() => executeFreezeToggle(confirmFreezeUser, false)}
          onClose={() => setConfirmFreezeUser(null)}
        />
      )}

      {/* KVKK Uyumlu Kaldırma Onay Modalı */}
      {confirmDeleteUser && (
        <ConfirmModal
          isOpen={true}
          title="Personeli KVKK Uyumlu Kaldır"
          message={`"${confirmDeleteUser.name}" adlı personeli sistemden kaldırmak istediğinize emin misiniz? Geçmiş randevu ve işlem kayıtları varsa KVKK gereği kişisel bilgileri anonimleştirilerek arşivlenir, yoksa tamamen silinir.`}
          confirmText="Evet, KVKK Uyumlu Kaldır"
          cancelText="Vazgeç"
          variant="danger"
          onConfirm={() => handleDeleteUser(confirmDeleteUser)}
          onClose={() => setConfirmDeleteUser(null)}
        />
      )}

      {/* Sağ Tık Vardiya / İzin Menüsü */}
      {shiftContextMenu && (
        <ShiftContextMenu
          x={shiftContextMenu.x}
          y={shiftContextMenu.y}
          doctorId={shiftContextMenu.doctorId}
          doctorName={users.find((u) => u.id === shiftContextMenu.doctorId)?.name}
          users={users}
          date={shiftContextMenu.date}
          onClose={() => setShiftContextMenu(null)}
          onOpenLeaveModal={
            canManageLeaves
              ? (docId, dt) => {
                setLeaveDoctorId(docId)
                setLeaveDate(dt)
                setIsLeaveModalOpen(true)
              }
              : undefined
          }
          onSave={async (shift) => {
            await fetch('/api/shifts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify(shift),
            })
            setShiftContextMenu(null)
            fetchData()
          }}
        />
      )}

      {/* Hekim İzin / Kapalı Saat Modalı */}
      <DoctorLeaveModal
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        doctors={users.map((u) => ({ id: u.id, name: u.name, specialty: u.specialty, color: u.color }))}
        shifts={shifts}
        initialDoctorId={leaveDoctorId}
        initialDate={leaveDate || new Date().toISOString().split('T')[0]}
        onSuccess={() => fetchData()}
      />
    </div>
  )
}
