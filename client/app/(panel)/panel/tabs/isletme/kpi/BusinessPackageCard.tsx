'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Crown, ShieldCheck, Sparkles, UserPlus, Users, X } from 'lucide-react'
import { useAuth, type ClinicEntitlements } from '@/lib/auth-context'
import { PhoneMaskedInput } from '@/lib/phone-mask'
import ConfirmModal from '../../../../../admin/components/ConfirmModal'
import SubscriptionCheckoutModal, {
  type SubscriptionModalMode,
  type UpgradeRequestType,
} from '../../../../../admin/components/SubscriptionCheckoutModal'
import InfoTooltip from '../../../../../admin/components/ui/InfoTooltip'
import clay from '../isletme-clay.module.css'
import s from './kpi.module.css'

type DemoAdminUser = {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  phone?: string
}

type SubscriptionOverview = {
  entitlements?: ClinicEntitlements
  requests?: Array<{
    id: string
    requestType: string
    requestedPlan?: string | null
    status: string
    createdAt?: string
  }>
  payments?: Array<Record<string, unknown>>
  iyzicoConfigured?: boolean
}

const PLAN_STATUS_LABELS: Record<string, string> = {
  trial: '7 Günlük Deneme',
  active: 'Aktif Abonelik',
  past_due: 'Ödeme Bekliyor',
  canceled: 'İptal Edildi',
  expired: 'Süre Doldu',
}

const UPGRADE_REQ_LABELS: Record<string, string> = {
  pro_upgrade: 'Pro Paket',
  whatsapp: 'WhatsApp Asistanı',
  inbound_call: 'Gelen Arama',
  outbound_call: 'Giden Arama',
  kurumsal_lead: 'Kurumsal Paket',
}

const UPGRADE_REQ_STATUS_LABELS: Record<string, string> = {
  pending: 'İnceleniyor',
  contacted: 'İletişime Geçildi',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
}

/**
 * İşletme Özet KPI ızgarasında varsayılan ve sabit (silinemez) olarak yer alan
 * Paket ve Yükseltme analiz kartı.
 */
export function BusinessPackageCard() {
  const { user, refreshUser } = useAuth()
  const [subscription, setSubscription] = useState<SubscriptionOverview | null>(null)
  const [demoAdmins, setDemoAdmins] = useState<DemoAdminUser[]>([])
  const [newAdminForm, setNewAdminForm] = useState({ name: '', email: '', password: '', phone: '' })
  const [addingAdmin, setAddingAdmin] = useState(false)
  const [showAdminModal, setShowAdminModal] = useState(false)
  const [notice, setNotice] = useState<{ type: 'good' | 'err'; text: string } | null>(null)
  const [confirmCancelSub, setConfirmCancelSub] = useState(false)
  const [cancelingSub, setCancelingSub] = useState(false)
  const [subModal, setSubModal] = useState<{
    open: boolean
    mode: SubscriptionModalMode
    featureTitle?: string
    requestType?: UpgradeRequestType
    requestedPlan?: 'pro' | 'kurumsal'
  }>({ open: false, mode: 'Checkout' })

  const showNotice = (type: 'good' | 'err', text: string) => {
    setNotice({ type, text })
    setTimeout(() => setNotice(null), 4500)
  }

  const refreshAll = useCallback(async () => {
    try {
      const [subRes, usersRes] = await Promise.all([
        fetch('/api/billing/subscription', { cache: 'no-store', credentials: 'include' }).catch(() => null),
        fetch('/api/admin/users', { cache: 'no-store', credentials: 'include' }).catch(() => null),
      ])
      if (subRes && subRes.ok) {
        const subData = await subRes.json().catch(() => null)
        if (subData && typeof subData === 'object') setSubscription(subData as SubscriptionOverview)
      }
      if (usersRes && usersRes.ok) {
        const usersData = await usersRes.json().catch(() => [])
        if (Array.isArray(usersData)) setDemoAdmins(usersData as DemoAdminUser[])
      }
    } catch {
      /* sessiz fallback: user.plan kullanılır */
    }
  }, [])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const effectivePlan: ClinicEntitlements | undefined = subscription?.entitlements || user?.plan
  const adminOnlyUsers = demoAdmins.filter((u) => u.role === 'yonetici')
  const maxAllowedUsers =
    effectivePlan?.maxUsers ||
    (effectivePlan?.planId === 'pro' ? 10 : effectivePlan?.planId === 'kurumsal' ? 50 : 2)
  const activeCount =
    effectivePlan?.activeUsersCount ?? (demoAdmins.filter((u) => u.active !== false).length || 1)
  const planDisplayName =
    effectivePlan?.planName ||
    (effectivePlan?.planId === 'pro'
      ? 'Pro Paket'
      : effectivePlan?.planId === 'kurumsal'
        ? 'Kurumsal Paket'
        : 'Demo Paket')

  const isDemo = !effectivePlan || effectivePlan.planId === 'demo'
  const canUpgradeToPro =
    !effectivePlan ||
    effectivePlan.planId === 'demo' ||
    effectivePlan.planStatus === 'expired' ||
    effectivePlan.planStatus === 'canceled'

  const statusText = effectivePlan
    ? PLAN_STATUS_LABELS[effectivePlan.planStatus] || effectivePlan.planStatus
    : '7 Günlük Deneme'

  const periodDetail = effectivePlan?.trialEndsAt
    ? effectivePlan.isTrialExpired
      ? 'Deneme süresi sona erdi'
      : `Kalan ${effectivePlan.trialDaysRemaining ?? 0} gün`
    : effectivePlan?.currentPeriodEnd
      ? `Yenileme: ${new Date(effectivePlan.currentPeriodEnd).toLocaleDateString('tr-TR')}`
      : statusText

  const latestRequest = subscription?.requests?.[0]

  const handleAddDemoAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAdminForm.name.trim() || !newAdminForm.email.trim() || newAdminForm.password.length < 6) {
      showNotice('err', 'Lütfen ad soyad, e-posta ve en az 6 karakterli şifre girin.')
      return
    }
    setAddingAdmin(true)
    try {
      const res = await fetch('/api/yonetici/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newAdminForm.name.trim(),
          email: newAdminForm.email.trim().toLowerCase(),
          password: newAdminForm.password,
          phone: newAdminForm.phone || undefined,
          role: 'yonetici',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showNotice('err', data.error || '2. yönetici eklenemedi.')
        return
      }
      setNewAdminForm({ name: '', email: '', password: '', phone: '' })
      setShowAdminModal(false)
      await refreshAll()
      await refreshUser()
      showNotice('good', 'Yeni yönetici hesabı oluşturuldu.')
    } catch {
      showNotice('err', 'Sunucuya bağlanılamadı.')
    } finally {
      setAddingAdmin(false)
    }
  }

  const handleCancelSubscription = async () => {
    setCancelingSub(true)
    try {
      const res = await fetch('/api/billing/cancel', { method: 'POST', credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showNotice('err', data.error || 'Abonelik iptal edilemedi.')
        return
      }
      setConfirmCancelSub(false)
      await refreshAll()
      await refreshUser()
      showNotice('good', 'Abonelik yenilemesi iptal edildi. Dönem sonuna kadar erişiminiz sürer.')
    } catch {
      showNotice('err', 'İptal işlemi sırasında hata oluştu.')
    } finally {
      setCancelingSub(false)
    }
  }

  return (
    <>
      <article className={s.kpiCardCompact} aria-label="Paket ve Abonelik Bilgileri">
        <header className={s.cardHead}>
          <div className={s.cardTitleGroup}>
            <span
              className={s.iconChipCompact}
              style={{
                background: 'linear-gradient(145deg, #4a82f2, #1d52d1)',
                boxShadow:
                  '4px 6px 12px #1d52d155, inset 3px 3px 6px rgba(255,255,255,0.48), inset -4px -4px 8px rgba(0,0,0,0.22)',
              }}
              aria-hidden="true"
            >
              <Crown size={17} strokeWidth={2.3} color="#ffffff" />
            </span>
            <div className={s.cardTitleRow}>
              <h3 className={s.cardTitleCompact}>
                Paket ve Abonelik
                <span className={s.titleTip}>
                  <InfoTooltip title="Paket ve Abonelik Bilgileri" glyph="?">
                    Demo pakette 7 gün boyunca Web Asistanı ve en fazla 2 Yönetici hesabı aktiftir. Pro pakette (7.000 ₺ + KDV / ay) 10 kullanıcı, Personel, Finans, Stok, WhatsApp Business ve Sesli Santral asistanları açılır.
                  </InfoTooltip>
                </span>
              </h3>
            </div>
          </div>
        </header>

        <div className={s.valStack}>
          <span className={s.pkgHeadline}>{planDisplayName}</span>
          <span className={s.cardSubtitle}>
            {activeCount} / {maxAllowedUsers} kullanıcı · {periodDetail}
          </span>
          {latestRequest && (
            <span className={s.cardSubtitle}>
              Talep: {UPGRADE_REQ_LABELS[latestRequest.requestType] || latestRequest.requestType} ·{' '}
              {UPGRADE_REQ_STATUS_LABELS[latestRequest.status] || latestRequest.status}
            </span>
          )}
        </div>

        <div className={s.pkgActions}>
          {canUpgradeToPro && (
            <button
              type="button"
              className={s.pkgPrimaryBtn}
              onClick={() =>
                setSubModal({
                  open: true,
                  mode: 'Checkout',
                  requestType: 'pro_upgrade',
                  requestedPlan: 'pro',
                })
              }
            >
              <Sparkles size={12} color="#ffffff" />
              <span>Pro&apos;ya Yükselt</span>
            </button>
          )}

          <button
            type="button"
            className={s.pkgSecondaryBtn}
            onClick={() =>
              setSubModal({
                open: true,
                mode: 'RequestAssistant',
                requestType: 'kurumsal_lead',
                requestedPlan: 'kurumsal',
                featureTitle: 'Kurumsal Paket',
              })
            }
          >
            <ShieldCheck size={12} />
            <span>Kurumsal</span>
          </button>

          {isDemo && adminOnlyUsers.length < maxAllowedUsers && (
            <button
              type="button"
              className={s.pkgSecondaryBtn}
              onClick={() => setShowAdminModal(true)}
            >
              <UserPlus size={12} />
              <span>2. Yönetici</span>
            </button>
          )}

          {effectivePlan?.planId === 'pro' && effectivePlan.planStatus === 'active' && (
            <button
              type="button"
              disabled={cancelingSub}
              className={s.pkgDangerBtn}
              onClick={() => setConfirmCancelSub(true)}
            >
              <span>İptal Et</span>
            </button>
          )}
        </div>

        {notice && (
          <span
            role="status"
            className={s.cardSubtitle}
            style={{ color: notice.type === 'good' ? 'var(--kpi-good)' : 'var(--danger)' }}
          >
            {notice.text}
          </span>
        )}
      </article>

      {showAdminModal &&
        typeof document !== 'undefined' &&
        document.body &&
        createPortal(
          <div
            className={s.pkgModalOverlay}
            role="presentation"
            onClick={() => setShowAdminModal(false)}
          >
            <div
              className={`${clay.scope} ${s.pkgModalCard}`}
              role="dialog"
              aria-modal="true"
              aria-label="Demo 2. Yönetici Hesabı Ekle"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={clay.cardHead}>
                <div className={clay.cardTitleGroup}>
                  <span className={`${clay.iconChipSm} ${clay.chipBrand}`} aria-hidden="true">
                    <Users size={15} color="#ffffff" />
                  </span>
                  <h3 className={clay.cardTitle}>
                    2. Yönetici Ekle ({adminOnlyUsers.length}/{maxAllowedUsers})
                  </h3>
                </div>
                <button
                  type="button"
                  className={s.iconToolBtn}
                  aria-label="Kapat"
                  onClick={() => setShowAdminModal(false)}
                >
                  <X size={15} />
                </button>
              </div>

              <form onSubmit={handleAddDemoAdmin} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label className={clay.field}>
                  <span className={clay.fieldLabel}>Ad Soyad*</span>
                  <input
                    required
                    className={clay.wellInput}
                    value={newAdminForm.name}
                    onChange={(e) => setNewAdminForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Örn: Mehmet Demir"
                  />
                </label>
                <label className={clay.field}>
                  <span className={clay.fieldLabel}>E-posta*</span>
                  <input
                    type="email"
                    required
                    className={clay.wellInput}
                    value={newAdminForm.email}
                    onChange={(e) => setNewAdminForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="ortak@isletme.com"
                  />
                </label>
                <label className={clay.field}>
                  <span className={clay.fieldLabel}>Şifre* (En az 6 karakter)</span>
                  <input
                    type="password"
                    required
                    minLength={6}
                    className={clay.wellInput}
                    value={newAdminForm.password}
                    onChange={(e) => setNewAdminForm((p) => ({ ...p, password: e.target.value }))}
                    placeholder="••••••••"
                  />
                </label>
                <label className={clay.field}>
                  <span className={clay.fieldLabel}>Telefon (İsteğe bağlı)</span>
                  <PhoneMaskedInput
                    className={clay.wellInput}
                    value={newAdminForm.phone}
                    onValueChange={(phone) => setNewAdminForm((p) => ({ ...p, phone }))}
                    placeholder="0 (5XX) XXX XX XX"
                  />
                </label>
                <div className={clay.row} style={{ justifyContent: 'flex-end', marginTop: 4 }}>
                  <button
                    type="button"
                    className={clay.ctlBtnSm}
                    onClick={() => setShowAdminModal(false)}
                  >
                    Vazgeç
                  </button>
                  <button type="submit" disabled={addingAdmin} className={clay.primaryBtn}>
                    <span style={{ color: '#ffffff' }}>
                      {addingAdmin ? 'Ekleniyor…' : '2. Yöneticiyi Ekle'}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      <SubscriptionCheckoutModal
        isOpen={subModal.open}
        mode={subModal.mode}
        featureTitle={subModal.featureTitle}
        defaultRequestType={subModal.requestType}
        defaultRequestedPlan={subModal.requestedPlan}
        userEmail={user?.email}
        userName={user?.name}
        onClose={() => setSubModal((prev) => ({ ...prev, open: false }))}
        onSuccess={() => {
          void refreshAll()
          void refreshUser()
        }}
      />

      {confirmCancelSub && (
        <ConfirmModal
          isOpen={true}
          title="Pro Aboneliği İptal Et"
          message="Pro paket otomatik yenilemesini iptal etmek istediğinize emin misiniz? Mevcut fatura döneminizin sonuna kadar tüm Pro modüllerini kullanmaya devam edebilirsiniz."
          confirmText="Evet, Aboneliği İptal Et"
          cancelText="Vazgeç"
          variant="warning"
          onConfirm={() => void handleCancelSubscription()}
          onClose={() => setConfirmCancelSub(false)}
        />
      )}
    </>
  )
}
