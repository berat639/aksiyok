'use client'

import { useCallback, useEffect, useState } from 'react'
import { Crown, ShieldCheck, Sparkles, UserPlus, Users } from 'lucide-react'
import { useAuth, type ClinicEntitlements } from '@/lib/auth-context'
import { PhoneMaskedInput } from '@/lib/phone-mask'
import ConfirmModal from '../../../../../admin/components/ConfirmModal'
import SubscriptionCheckoutModal, {
  type SubscriptionModalMode,
  type UpgradeRequestType,
} from '../../../../../admin/components/SubscriptionCheckoutModal'
import InfoTooltip from '../../../../../admin/components/ui/InfoTooltip'
import clay from '../isletme-clay.module.css'

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
  expired: 'Deneme Süresi Doldu',
}

const UPGRADE_REQ_LABELS: Record<string, string> = {
  pro_upgrade: 'Pro Paket Geçişi',
  whatsapp: 'WhatsApp Asistanı',
  inbound_call: 'Gelen Arama Asistanı',
  outbound_call: 'Giden Arama Asistanı',
  kurumsal_lead: 'Kurumsal Paket',
}

const UPGRADE_REQ_STATUS_LABELS: Record<string, string> = {
  pending: 'İnceleniyor',
  contacted: 'İletişime Geçildi',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
}

export function BusinessPackageCard() {
  const { user, refreshUser } = useAuth()
  const [subscription, setSubscription] = useState<SubscriptionOverview | null>(null)
  const [demoAdmins, setDemoAdmins] = useState<DemoAdminUser[]>([])
  const [newAdminForm, setNewAdminForm] = useState({ name: '', email: '', password: '', phone: '' })
  const [addingAdmin, setAddingAdmin] = useState(false)
  const [showAdminForm, setShowAdminForm] = useState(false)
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

  const isExpired = Boolean(effectivePlan?.isTrialExpired || effectivePlan?.planStatus === 'expired')
  const isDemo = !effectivePlan || effectivePlan.planId === 'demo'

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
      setShowAdminForm(false)
      await refreshAll()
      await refreshUser()
      showNotice('good', 'Yeni yönetici hesabı başarıyla oluşturuldu.')
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
      showNotice('good', 'Abonelik yenilemesi iptal edildi. Dönem sonuna kadar erişiminiz devam edecektir.')
    } catch {
      showNotice('err', 'İptal işlemi sırasında hata oluştu.')
    } finally {
      setCancelingSub(false)
    }
  }

  return (
    <div className={clay.scope}>
      <section className={clay.card} aria-label="Paket ve Abonelik Bilgileri">
        <div className={clay.cardHead}>
          <div className={clay.cardTitleGroup}>
            <span className={`${clay.iconChipSm} ${clay.chipBrand}`} aria-hidden="true">
              <Crown size={16} strokeWidth={2.2} color="#ffffff" />
            </span>
            <div className={clay.cardTitleRow}>
              <h3 className={clay.cardTitle}>Paket ve Abonelik Bilgileri</h3>
              <InfoTooltip title="Paket Hakları ve Kullanıcı Kapasitesi" glyph="?">
                Demo pakette 7 gün boyunca Web Asistanı ve en fazla 2 Yönetici hesabı aktiftir. Pro pakette (7.000 ₺ + KDV / ay) 10 kullanıcı, Personel, Finans, Stok, WhatsApp Business ve Sesli Santral asistanları açılır.
              </InfoTooltip>
            </div>
          </div>

          {effectivePlan && (
            <span
              className={
                isExpired
                  ? clay.pillDanger
                  : effectivePlan.planStatus === 'active'
                    ? clay.pillGood
                    : clay.pillWatch
              }
            >
              {planDisplayName} · {PLAN_STATUS_LABELS[effectivePlan.planStatus] || effectivePlan.planStatus}
            </span>
          )}
        </div>

        <div className={clay.statGrid}>
          <div className={clay.subCard} style={{ gap: 4 }}>
            <span className={clay.fieldLabel} style={{ margin: 0 }}>Aktif Paket</span>
            <strong style={{ fontSize: 15, fontWeight: 850, color: 'var(--foreground)' }}>
              {planDisplayName}
            </strong>
            <span className={clay.muted}>
              {effectivePlan?.planId === 'pro'
                ? '7.000 ₺ + KDV (8.400 ₺ / ay)'
                : effectivePlan?.planId === 'kurumsal'
                  ? 'Kurumsal Özel Sözleşme'
                  : '7 Gün Ücretsiz Başlangıç'}
            </span>
          </div>

          <div className={clay.subCard} style={{ gap: 4 }}>
            <span className={clay.fieldLabel} style={{ margin: 0 }}>Kullanıcı Limiti</span>
            <strong style={{ fontSize: 15, fontWeight: 850, color: 'var(--foreground)' }}>
              {activeCount} / {maxAllowedUsers} Aktif Kullanıcı
            </strong>
            <span className={clay.muted}>
              {effectivePlan?.planId === 'demo'
                ? 'En fazla 2 Yönetici hesabı'
                : effectivePlan?.pendingInvitesCount
                  ? `${effectivePlan.pendingInvitesCount} bekleyen davet`
                  : 'Tüm personel rolleri açık'}
            </span>
          </div>

          <div className={clay.subCard} style={{ gap: 4 }}>
            <span className={clay.fieldLabel} style={{ margin: 0 }}>
              {effectivePlan?.trialEndsAt ? 'Deneme Bitiş Tarihi' : 'Dönem / Yenileme'}
            </span>
            <strong style={{ fontSize: 15, fontWeight: 850, color: 'var(--foreground)' }}>
              {effectivePlan?.trialEndsAt
                ? new Date(effectivePlan.trialEndsAt).toLocaleDateString('tr-TR')
                : effectivePlan?.currentPeriodEnd
                  ? new Date(effectivePlan.currentPeriodEnd).toLocaleDateString('tr-TR')
                  : 'Aktif'}
            </strong>
            <span className={clay.muted}>
              {effectivePlan?.trialEndsAt
                ? effectivePlan.isTrialExpired
                  ? 'Deneme süresi sona erdi'
                  : `Kalan süre: ${effectivePlan.trialDaysRemaining ?? 0} gün`
                : effectivePlan?.planStatus === 'canceled'
                  ? 'Dönem sonunda yenilenmeyecek'
                  : 'Kesintisiz erişim'}
            </span>
          </div>
        </div>

        <div className={clay.topBar}>
          <div className={clay.row}>
            {(!effectivePlan ||
              effectivePlan.planId === 'demo' ||
              effectivePlan.planStatus === 'expired' ||
              effectivePlan.planStatus === 'canceled') && (
              <button
                type="button"
                className={clay.primaryBtn}
                onClick={() =>
                  setSubModal({
                    open: true,
                    mode: 'Checkout',
                    requestType: 'pro_upgrade',
                    requestedPlan: 'pro',
                  })
                }
              >
                <Sparkles size={14} color="#ffffff" />
                <span style={{ color: '#ffffff' }}>Pro Pakete Yükselt (7.000 ₺ + KDV)</span>
              </button>
            )}

            <button
              type="button"
              className={clay.ctlBtn}
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
              <ShieldCheck size={14} />
              <span>Kurumsal Paket İçin Satışla Görüş</span>
            </button>

            {effectivePlan?.planId === 'pro' && effectivePlan.planStatus === 'active' && (
              <button
                type="button"
                disabled={cancelingSub}
                className={clay.dangerBtn}
                onClick={() => setConfirmCancelSub(true)}
              >
                <span>Aboneliği İptal Et</span>
              </button>
            )}
          </div>

          {isDemo && adminOnlyUsers.length < maxAllowedUsers && (
            <button
              type="button"
              className={showAdminForm ? clay.ctlBtnOn : clay.ctlBtnSm}
              onClick={() => setShowAdminForm((v) => !v)}
            >
              <UserPlus size={13} color={showAdminForm ? '#ffffff' : undefined} />
              <span>2. Yönetici Ekle ({adminOnlyUsers.length}/{maxAllowedUsers})</span>
            </button>
          )}
        </div>

        {notice && (
          <div className={notice.type === 'good' ? clay.noticeGood : clay.noticeWarn} role="status">
            <span>{notice.text}</span>
          </div>
        )}

        {subscription?.requests && subscription.requests.length > 0 && (
          <div className={clay.row} style={{ gap: 6 }}>
            <span className={clay.muted}>Son talepler:</span>
            {subscription.requests.slice(0, 4).map((req) => (
              <span key={req.id} className={clay.wellPill}>
                {UPGRADE_REQ_LABELS[req.requestType] || req.requestType} ·{' '}
                {UPGRADE_REQ_STATUS_LABELS[req.status] || req.status}
              </span>
            ))}
          </div>
        )}

        {isDemo && showAdminForm && (
          <form onSubmit={handleAddDemoAdmin} className={clay.subCard}>
            <div className={clay.topBar}>
              <span className={clay.row} style={{ gap: 6 }}>
                <Users size={14} />
                <strong style={{ fontSize: 13, color: 'var(--foreground)' }}>
                  Demo 2. Yönetici Hesabı ({adminOnlyUsers.length} / {maxAllowedUsers})
                </strong>
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
                gap: 10,
              }}
            >
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
            </div>
            <div className={clay.row} style={{ justifyContent: 'flex-end' }}>
              <button type="button" className={clay.ctlBtnSm} onClick={() => setShowAdminForm(false)}>
                Vazgeç
              </button>
              <button type="submit" disabled={addingAdmin} className={clay.primaryBtn}>
                <span style={{ color: '#ffffff' }}>{addingAdmin ? 'Ekleniyor…' : '2. Yöneticiyi Ekle'}</span>
              </button>
            </div>
          </form>
        )}
      </section>

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
    </div>
  )
}
