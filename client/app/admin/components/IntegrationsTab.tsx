'use client'

import EvolutionWhatsAppCard from './EvolutionWhatsAppCard'
import N8nMetaWhatsAppCard from './N8nMetaWhatsAppCard'
import BillingIntegrationsCard from './BillingIntegrationsCard'
import SubscriptionCheckoutModal, {
  type SubscriptionModalMode,
  type UpgradeRequestType,
} from './SubscriptionCheckoutModal'
import { useAuth } from '@/lib/auth-context'
import clay from '@/app/(panel)/panel/tabs/isletme/isletme-clay.module.css'
import depth from '@/styles/clinic-depth.module.css'
import { Settings } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import styles from './IntegrationsTab.module.css'

type IntegrationTest = { id?: string; status: string; confirmed_at?: string | null; message?: string | null } | null
type IntegrationState = {
  configured: boolean
  enabled: boolean
  revision?: number
  health: string
  checkedAt: string | null
  test: IntegrationTest
  numbers: string[]
  callerId: string | null
  senderId: string | null
  fromAddress: string | null
  config?: {
    username?: string
    hasPassword?: boolean
    numbers?: string[]
    callerId?: string
    transferNumber?: string
    senderId?: string
    host?: string
    port?: number
    secure?: 'tls' | 'ssl'
    fromName?: string
    fromAddress?: string
  } | null
}
type IntegrationOverview = { phone: IntegrationState; sms: IntegrationState; smtp: IntegrationState }
const emptyIntegrationState = (): IntegrationState => ({
  configured: false,
  enabled: false,
  revision: 0,
  health: 'unknown',
  checkedAt: null,
  test: null,
  numbers: [],
  callerId: null,
  senderId: null,
  fromAddress: null,
  config: null,
})
const emptyIntegrationOverview = (): IntegrationOverview => ({ phone: emptyIntegrationState(), sms: emptyIntegrationState(), smtp: emptyIntegrationState() })

type NotificationChannelKey = 'whatsapp' | 'sms' | 'email' | 'assistant_call'

interface NotificationPolicyState {
  channelPriority: NotificationChannelKey[]
  enabledChannels: Record<NotificationChannelKey, boolean>
  confirmationWaitHours: number
  recallWaitHours: number
  reminderLeadHours: number
  instantAppointmentNotify: boolean
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
}

const DEFAULT_NOTIFICATION_POLICY_STATE: NotificationPolicyState = {
  channelPriority: ['whatsapp', 'sms', 'email', 'assistant_call'],
  enabledChannels: {
    whatsapp: true,
    sms: true,
    email: true,
    assistant_call: true,
  },
  confirmationWaitHours: 4,
  recallWaitHours: 48,
  reminderLeadHours: 24,
  instantAppointmentNotify: true,
  quietHoursEnabled: true,
  quietHoursStart: '21:00',
  quietHoursEnd: '09:00',
}

const CHANNEL_META: Record<NotificationChannelKey, { title: string; desc: string }> = {
  whatsapp: {
    title: '💬 WhatsApp (Etkileşimli Mesaj ve Onay Bağlantısı)',
    desc: 'Ücretsiz ve hızlı kanal. Hasta "Geleceğim / Ertele / Gelmiyorum" yanıtı verebilir.',
  },
  sms: {
    title: '📱 Kısa Mesaj (NetGSM ve Onay Bağlantısı)',
    desc: 'Yüksek ulaşım oranı. WhatsApp iletilemezse veya izin yoksa devreye girer.',
  },
  email: {
    title: '✉️ E-Posta (Bilgilendirme ve Onay Bağlantısı)',
    desc: 'Detaylı randevu özeti ve tek tıkla yanıt bağlantısı gönderir.',
  },
  assistant_call: {
    title: '📞 Asistan ile Sesli Arama (Sesli Teyit)',
    desc: 'Son kademe. Yazılı kanallardan yanıt alınamazsa sesli asistan arayarak teyit alır.',
  },
}

function SettingsCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className={styles.card}>
    <h3 className={styles.cardTitle}>{title}</h3>
    <p className={styles.cardDescription}>{description}</p>
    {children}
  </section>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    {children}
  </label>
}

function Spinner() {
  return <div className={styles.spinner} aria-label="Yükleniyor" />
}

function statusFor(service: 'phone' | 'sms' | 'smtp', state: IntegrationState) {
  if (!state.configured) return { label: 'Yapılandırılmadı', detail: 'Aşağıdaki "Bağlantı Ayarlarını Düzenle" butonundan kurulumu yapabilirsiniz.', tone: 'warning' as const, attention: true }
  if (!state.enabled) return { label: 'Etkin değil', detail: 'Ayarlar kaydedilmiş; test ve etkinleştirme bekleniyor.', tone: 'warning' as const, attention: true }
  if (service === 'phone') {
    if (state.health === 'registered') return { label: 'Etkin · Bağlı', detail: state.callerId ? `Birincil numara: ${state.callerId}` : 'Telefon hattı kaydı aktif.', tone: 'success' as const, attention: false }
    if (state.health === 'unregistered') return { label: 'Etkin · Bağlantı koptu', detail: 'Telefon hattı kaydı alınamadı. SIP bilgilerini kontrol edin.', tone: 'danger' as const, attention: true }
    return { label: 'Etkin · Durum kontrol ediliyor', detail: 'Son hat bağlantı kontrolü güncel değil.', tone: 'warning' as const, attention: true }
  }
  if (state.test?.status === 'failed') return { label: 'Etkin · Son test başarısız', detail: state.test.message || 'Sağlayıcı bağlantısını kontrol edin.', tone: 'danger' as const, attention: true }
  if (state.test?.status === 'confirmed' || state.test?.status === 'accepted') return { label: 'Etkin · Hazır', detail: service === 'sms' ? `Başlık: ${state.senderId || state.config?.senderId || '—'}` : `Gönderici: ${state.fromAddress || state.config?.fromAddress || '—'}`, tone: 'success' as const, attention: false }
  return { label: 'Etkin · Hazır', detail: service === 'sms' ? `Başlık: ${state.senderId || state.config?.senderId || '—'}` : `Gönderici: ${state.fromAddress || state.config?.fromAddress || '—'}`, tone: 'success' as const, attention: false }
}

function ManagedIntegrationCard({
  title,
  service,
  state,
  numbers,
  apiPrefix,
  onRefresh,
  onToast,
}: {
  title: string
  service: 'phone' | 'sms' | 'smtp'
  state: IntegrationState
  numbers?: boolean
  apiPrefix: string
  onRefresh: () => Promise<void>
  onToast: (type: 'success' | 'error', text: string) => void
}) {
  const status = statusFor(service, state)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // SMTP form state
  const [smtpHost, setSmtpHost] = useState(state.config?.host || 'mx-out03.natrohost.com')
  const [smtpPort, setSmtpPort] = useState(String(state.config?.port || 465))
  const [smtpUsername, setSmtpUsername] = useState(state.config?.username || state.fromAddress || '')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smtpFromName, setSmtpFromName] = useState(state.config?.fromName || '')
  const [smtpFromAddress, setSmtpFromAddress] = useState(state.config?.fromAddress || state.fromAddress || '')
  const [smtpTarget, setSmtpTarget] = useState('')

  // SMS form state
  const [smsUsername, setSmsUsername] = useState(state.config?.username || '')
  const [smsPassword, setSmsPassword] = useState('')
  const [smsSenderId, setSmsSenderId] = useState(state.config?.senderId || state.senderId || '')
  const [smsTarget, setSmsTarget] = useState('')

  // Phone form state
  const [sipUsername, setSipUsername] = useState(state.config?.username || '')
  const [sipPassword, setSipPassword] = useState('')
  const [phoneNumbersText, setPhoneNumbersText] = useState((state.config?.numbers || state.numbers || []).join(', '))
  const [callerId, setCallerId] = useState(state.config?.callerId || state.callerId || '')
  const [transferNumber, setTransferNumber] = useState(state.config?.transferNumber || '')

  useEffect(() => {
    if (service === 'smtp') {
      if (state.config?.host) setSmtpHost(state.config.host)
      if (state.config?.port) setSmtpPort(String(state.config.port))
      if (state.config?.username) setSmtpUsername(state.config.username)
      if (state.config?.fromName) setSmtpFromName(state.config.fromName)
      if (state.config?.fromAddress || state.fromAddress) setSmtpFromAddress(state.config?.fromAddress || state.fromAddress || '')
    } else if (service === 'sms') {
      if (state.config?.username) setSmsUsername(state.config.username)
      if (state.config?.senderId || state.senderId) setSmsSenderId(state.config?.senderId || state.senderId || '')
    } else if (service === 'phone') {
      if (state.config?.username) setSipUsername(state.config.username)
      const nums = state.config?.numbers?.length ? state.config.numbers : state.numbers
      if (nums?.length) setPhoneNumbersText(nums.join(', '))
      if (state.config?.callerId || state.callerId) setCallerId(state.config?.callerId || state.callerId || '')
      if (state.config?.transferNumber) setTransferNumber(state.config.transferNumber)
    }
  }, [service, state])

  const detail = numbers && state.numbers.length
    ? `Atanmış: ${state.numbers.join(', ')}${state.callerId ? ` · Birincil: ${state.callerId}` : ''}`
    : status.detail

  const handleSaveConfig = async () => {
    setBusy(true)
    try {
      let payload: Record<string, unknown> = {
        revision: state.revision,
        autoActivate: true,
      }
      if (service === 'smtp') {
        const portNum = Number(smtpPort) || 465
        payload = {
          ...payload,
          host: smtpHost.trim(),
          port: portNum,
          secure: portNum === 465 ? 'ssl' : 'tls',
          username: smtpUsername.trim(),
          ...(smtpPassword.trim() ? { password: smtpPassword.trim() } : {}),
          fromName: smtpFromName.trim() || 'Klinik',
          fromAddress: (smtpFromAddress.trim() || smtpUsername.trim()),
        }
      } else if (service === 'sms') {
        payload = {
          ...payload,
          username: smsUsername.trim(),
          ...(smsPassword.trim() ? { password: smsPassword.trim() } : {}),
          senderId: smsSenderId.trim(),
        }
      } else {
        const parsedNums = phoneNumbersText
          .split(/[\s,;]+/)
          .map(s => s.trim())
          .filter(Boolean)
        payload = {
          ...payload,
          username: sipUsername.trim(),
          ...(sipPassword.trim() ? { password: sipPassword.trim() } : {}),
          numbers: parsedNums,
          callerId: callerId.trim() || parsedNums[0] || '',
          transferNumber: transferNumber.trim(),
        }
      }
      const res = await fetch(`${apiPrefix}/${service}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Ayarlar kaydedilemedi.')
      setSmtpPassword('')
      setSmsPassword('')
      setSipPassword('')
      await onRefresh()
      onToast('success', `${title} ayarları kaydedildi ve etkinleştirildi.`)
    } catch (err: any) {
      onToast('error', err.message || 'Kaydetme hatası')
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async () => {
    const target = service === 'smtp' ? smtpTarget.trim() : smsTarget.trim()
    if (!target) {
      onToast('error', service === 'smtp' ? 'Lütfen test alıcı e-posta adresini girin.' : 'Lütfen test alıcı cep telefonu numarasını girin.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`${apiPrefix}/${service}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          revision: state.revision,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Test gönderimi başarısız.')
      if (data.status === 'failed') {
        throw new Error(data.message || 'Test gönderimi başarısız oldu.')
      }
      if (data.id && data.status === 'accepted') {
        await fetch(`${apiPrefix}/${service}/tests/${data.id}/confirm`, { method: 'POST' }).catch(() => {})
      }
      await onRefresh()
      onToast('success', service === 'smtp' ? `Test e-postası (${target}) başarıyla gönderildi ve doğrulandı.` : `Test SMS mesajı (${target}) başarıyla gönderildi ve doğrulandı.`)
    } catch (err: any) {
      await onRefresh()
      onToast('error', err.message || 'Test başarısız')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      title={title}
      description={
        service === 'smtp'
          ? 'Randevu bilgilendirmeleri, personel davetleri ve onay bağlantıları için kullanılan kurumsal e-posta (SMTP) bağlantısı.'
          : service === 'sms'
            ? 'Randevu hatırlatma ve onay mesajları için kullanılan NetGSM kısa mesaj (SMS) bağlantısı.'
            : numbers
              ? 'İşletmeye tanımlı gelen/giden santral telefon numaraları ve birincil arayan numara (Caller ID).'
              : 'Sesli asistan ve çağrı merkezi için NetGSM / SIP santral bağlantısı.'
      }
    >
      <div className={styles.integrationStatus}>
        <span className={`${styles.statusBadge} ${styles[`status${status.tone[0].toUpperCase()}${status.tone.slice(1)}`]}`}>{status.label}</span>
        <p>{detail}</p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
        <button
          type="button"
          className={styles.saveButton}
          onClick={() => setOpen(v => !v)}
        >
          {open ? '▲ Ayarları Gizle' : '⚙️ Bağlantı Ayarlarını Düzenle / Test Et'}
        </button>
      </div>

      {open && (
        <div className={styles.policyRulesBox} style={{ marginTop: 14 }}>
          {service === 'smtp' && (
            <>
              <div className={styles.grid}>
                <Field label="SMTP Sunucu Adresi (Host)">
                  <input
                    value={smtpHost}
                    onChange={e => setSmtpHost(e.target.value)}
                    placeholder="mx-out03.natrohost.com veya smtp.gmail.com"
                  />
                </Field>
                <Field label="Port (465 SSL Önerilen / 587 STARTTLS)">
                  <input
                    inputMode="numeric"
                    value={smtpPort}
                    onChange={e => setSmtpPort(e.target.value)}
                    placeholder="465"
                  />
                </Field>
                <Field label="SMTP Kullanıcı Adı (E-Posta)">
                  <input
                    value={smtpUsername}
                    onChange={e => {
                      setSmtpUsername(e.target.value)
                      if (!smtpFromAddress) setSmtpFromAddress(e.target.value)
                    }}
                    placeholder="ornek@klinik.com"
                  />
                </Field>
                <Field label={state.config?.hasPassword ? 'SMTP Parolası (Kayıtlı — değiştirmek için yazın)' : 'SMTP Parolası / Uygulama Şifresi'}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={smtpPassword}
                    onChange={e => setSmtpPassword(e.target.value)}
                    placeholder={state.config?.hasPassword ? '•••••••• (Kayıtlı)' : 'SMTP parolası'}
                  />
                </Field>
                <Field label="Gönderici Adı (From Name)">
                  <input
                    value={smtpFromName}
                    onChange={e => setSmtpFromName(e.target.value)}
                    placeholder="Klinik Adı"
                  />
                </Field>
                <Field label="Gönderici E-Posta Adresi (From Address)">
                  <input
                    type="email"
                    value={smtpFromAddress}
                    onChange={e => setSmtpFromAddress(e.target.value)}
                    placeholder="ornek@klinik.com"
                  />
                </Field>
              </div>
              <div className={styles.grid} style={{ marginTop: 10 }}>
                <Field label="Test Alıcı E-Posta Adresi">
                  <input
                    type="email"
                    value={smtpTarget}
                    onChange={e => setSmtpTarget(e.target.value)}
                    placeholder="test@ornek.com"
                  />
                </Field>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
                <button type="button" className={styles.saveButton} disabled={busy} onClick={handleSaveConfig}>
                  {busy ? 'Kaydediliyor...' : '💾 Kaydet ve Etkinleştir'}
                </button>
                <button type="button" className={styles.saveButton} disabled={busy} onClick={handleTest}>
                  {busy ? 'Gönderiliyor...' : '📨 Test E-Postası Gönder'}
                </button>
              </div>
            </>
          )}

          {service === 'sms' && (
            <>
              <div className={styles.grid}>
                <Field label="NetGSM API Kullanıcı Kodu / Abone No">
                  <input
                    value={smsUsername}
                    onChange={e => setSmsUsername(e.target.value)}
                    placeholder="8503096119"
                  />
                </Field>
                <Field label={state.config?.hasPassword ? 'NetGSM API Parolası (Kayıtlı — değiştirmek için yazın)' : 'NetGSM API Parolası'}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={smsPassword}
                    onChange={e => setSmsPassword(e.target.value)}
                    placeholder={state.config?.hasPassword ? '•••••••• (Kayıtlı)' : 'API Şifresi'}
                  />
                </Field>
                <Field label="Onaylı Gönderici Başlığı (MsgHeader)">
                  <input
                    value={smsSenderId}
                    onChange={e => setSmsSenderId(e.target.value)}
                    placeholder="Örn: PINECLINIC"
                  />
                </Field>
                <Field label="Test Alıcı Cep Telefonu (+905...)">
                  <input
                    value={smsTarget}
                    onChange={e => setSmsTarget(e.target.value)}
                    placeholder="+905551234567"
                  />
                </Field>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
                <button type="button" className={styles.saveButton} disabled={busy} onClick={handleSaveConfig}>
                  {busy ? 'Kaydediliyor...' : '💾 Kaydet ve Etkinleştir'}
                </button>
                <button type="button" className={styles.saveButton} disabled={busy} onClick={handleTest}>
                  {busy ? 'Gönderiliyor...' : '📲 Test SMS Gönder'}
                </button>
              </div>
            </>
          )}

          {service === 'phone' && (
            <>
              <div className={styles.grid}>
                <Field label="SIP Kullanıcı Adı (Abone No)">
                  <input
                    value={sipUsername}
                    onChange={e => setSipUsername(e.target.value)}
                    placeholder="8503096119"
                  />
                </Field>
                <Field label={state.config?.hasPassword ? 'SIP Parolası (Kayıtlı — değiştirmek için yazın)' : 'SIP Parolası'}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={sipPassword}
                    onChange={e => setSipPassword(e.target.value)}
                    placeholder={state.config?.hasPassword ? '•••••••• (Kayıtlı)' : 'SIP Şifresi'}
                  />
                </Field>
                <Field label="Klinik Telefon Numaraları (+90850... virgülle ayırın)">
                  <input
                    value={phoneNumbersText}
                    onChange={e => setPhoneNumbersText(e.target.value)}
                    placeholder="+908503096119"
                  />
                </Field>
                <Field label="Birincil Çıkış Numarası (Caller ID)">
                  <input
                    value={callerId}
                    onChange={e => setCallerId(e.target.value)}
                    placeholder="+908503096119"
                  />
                </Field>
                <Field label="Çağrı Aktarım Numarası (Transfer - Opsiyonel)">
                  <input
                    value={transferNumber}
                    onChange={e => setTransferNumber(e.target.value)}
                    placeholder="+905551234567"
                  />
                </Field>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
                <button type="button" className={styles.saveButton} disabled={busy} onClick={handleSaveConfig}>
                  {busy ? 'Kaydediliyor...' : '💾 Santral ve Numara Ayarlarını Kaydet'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </SettingsCard>
  )
}

export default function IntegrationsTab({ apiPrefix = '/api/admin/integrations' }: { apiPrefix?: string }) {
  const { user, refreshUser } = useAuth()

  const [subModal, setSubModal] = useState<{
    open: boolean
    mode: SubscriptionModalMode
    featureTitle?: string
    requestType?: UpgradeRequestType
    requestedPlan?: 'pro' | 'kurumsal'
  }>({ open: false, mode: 'Checkout' })

  // Notification Policy State
  const [notificationPolicy, setNotificationPolicy] = useState<NotificationPolicyState>(DEFAULT_NOTIFICATION_POLICY_STATE)
  const [savingPolicy, setSavingPolicy] = useState(false)

  const [loading, setLoading] = useState(true)
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationOverview>(emptyIntegrationOverview)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 4000)
  }

  const refreshIntegrations = async () => {
    try {
      const res = await fetch(apiPrefix, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      if (data.phone && data.sms && data.smtp) {
        setIntegrationStatus(data as IntegrationOverview)
      }
    } catch {}
  }

  useEffect(() => {
    fetch(apiPrefix)
      .then(res => res.json())
      .then(data => {
        if (data.phone && data.sms && data.smtp) setIntegrationStatus(data as IntegrationOverview)
      })
      .catch(() => showToast('error', 'Bağlantı bilgileri alınamadı'))
      .finally(() => setLoading(false))

    fetch('/api/admin/settings/notification-policy')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && Array.isArray(data.channelPriority)) {
          setNotificationPolicy({ ...DEFAULT_NOTIFICATION_POLICY_STATE, ...data })
        }
      })
      .catch(() => {})
  }, [apiPrefix])

  const moveChannelPriority = (index: number, direction: -1 | 1) => {
    setNotificationPolicy(prev => {
      const next = [...prev.channelPriority]
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= next.length) return prev
      const temp = next[index]
      next[index] = next[targetIndex]
      next[targetIndex] = temp
      return { ...prev, channelPriority: next }
    })
  }

  const togglePolicyChannel = (channel: NotificationChannelKey) => {
    setNotificationPolicy(prev => ({
      ...prev,
      enabledChannels: {
        ...prev.enabledChannels,
        [channel]: !prev.enabledChannels[channel],
      },
    }))
  }

  const saveNotificationPolicy = async () => {
    setSavingPolicy(true)
    try {
      const res = await fetch('/api/admin/settings/notification-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notificationPolicy),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Bildirim önceliği kaydedilemedi')
      if (data.policy) setNotificationPolicy(data.policy)
      showToast('success', 'Bildirim kanal önceliği ve otomasyon kuralları kaydedildi')
    } catch (err: any) {
      showToast('error', err.message || 'Bildirim ayarları kaydedilemedi')
    } finally {
      setSavingPolicy(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const policyRes = await fetch('/api/admin/settings/notification-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notificationPolicy),
      })

      if (!policyRes.ok) throw new Error('Kaydedilemedi')
      showToast('success', 'Bildirim önceliği ayarları başarıyla kaydedildi')
    } catch (err: any) {
      showToast('error', err.message || 'Hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className={styles.loading}><Spinner /></div>

  const isDemoLocked = Boolean(user?.plan?.planId === 'demo' && !user?.canManagePlatform)

  return (
    <div className={`${clay.scope} ${styles.page}`}>
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`} role="status">
          {toast.text}
        </div>
      )}

      {/* Üst Güçlü Mavi Clay Hero Şeridi */}
      <div className={clay.hero}>
        <div className={clay.heroMain}>
          <div className={clay.heroLeft}>
            <span className={clay.heroBadgeIcon} aria-hidden="true">
              <Settings size={20} strokeWidth={2.2} color="#ffffff" />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className={clay.heroTitleRow}>
                <h3 className={clay.heroName}>Ayarlar ve Entegrasyonlar</h3>
              </div>
              <p className={clay.heroMeta}>
                Bildirim kanal önceliği, e-posta (SMTP), SMS, santral, WhatsApp ve fatura bağlantılarını buradan yönetin.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Yönetici Bildirim Kanal Önceliği ve Otomatik Kurallar */}
      <SettingsCard
        title="🔔 Bildirim Kanal Önceliği ve Otomatik Kurallar"
        description="Randevu bilgilendirmesi, 24 saat öncesi onay (Geleceğim, Gelmiyorum veya Ertele) ve periyodik kontrol hatırlatmalarında kullanılacak kanalların öncelik sırasını belirleyin. Sistem, hastanın iletişim izinleriyle bu sırayı birleştirir. Üst sıradaki kanaldan ulaşıldığında veya onay alındığında alt sıradaki ücretli kanallar kullanılmaz."
      >
        <div className={styles.priorityList}>
          {notificationPolicy.channelPriority.map((ch, idx) => {
            const meta = CHANNEL_META[ch] || { title: ch, desc: '' }
            const isEnabled = notificationPolicy.enabledChannels[ch] !== false
            return (
              <div
                key={ch}
                className={`${styles.priorityItem} ${!isEnabled ? styles.priorityItemDisabled : ''}`}
              >
                <div className={styles.priorityLeft}>
                  <span className={styles.priorityOrderBadge}>{idx + 1}.</span>
                  <div className={styles.priorityInfo}>
                    <span className={styles.priorityTitle}>{meta.title}</span>
                    <span className={styles.priorityDesc}>{meta.desc}</span>
                  </div>
                </div>
                <div className={styles.priorityControls}>
                  <button
                    type="button"
                    className={styles.orderBtn}
                    disabled={idx === 0}
                    onClick={() => moveChannelPriority(idx, -1)}
                    title="Önceliği Yükselt (Yukarı Taşı)"
                    aria-label="Yukarı taşı"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.orderBtn}
                    disabled={idx === notificationPolicy.channelPriority.length - 1}
                    onClick={() => moveChannelPriority(idx, 1)}
                    title="Önceliği Düşür (Aşağı Taşı)"
                    aria-label="Aşağı taşı"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePolicyChannel(ch)}
                    className={`${styles.channelToggleBtn} ${isEnabled ? styles.channelToggleActive : styles.channelToggleInactive}`}
                  >
                    {isEnabled ? '✓ Aktif' : '✕ Pasif'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className={styles.policyRulesBox}>
          <div className={styles.grid}>
            <Field label="Randevu Öncesi Teyit Zamanı (Saat)">
              <input
                type="number"
                min={1}
                max={168}
                value={notificationPolicy.reminderLeadHours}
                onChange={e => setNotificationPolicy(prev => ({
                  ...prev,
                  reminderLeadHours: Math.max(1, Math.min(168, Number(e.target.value) || 24)),
                }))}
              />
            </Field>
            <Field label="Randevu Onayı Kademe Bekleme (Saat)">
              <input
                type="number"
                min={1}
                max={48}
                value={notificationPolicy.confirmationWaitHours}
                onChange={e => setNotificationPolicy(prev => ({
                  ...prev,
                  confirmationWaitHours: Math.max(1, Math.min(48, Number(e.target.value) || 4)),
                }))}
              />
            </Field>
          </div>

          <div className={styles.policyCheckRow}>
            <label className={styles.permission}>
              <input
                type="checkbox"
                checked={notificationPolicy.instantAppointmentNotify}
                onChange={e => setNotificationPolicy(prev => ({ ...prev, instantAppointmentNotify: e.target.checked }))}
              />
              Randevu oluşturulduğunda veya saati değiştiğinde anında bilgilendirme gönder
            </label>
            <label className={styles.permission}>
              <input
                type="checkbox"
                checked={notificationPolicy.quietHoursEnabled}
                onChange={e => setNotificationPolicy(prev => ({ ...prev, quietHoursEnabled: e.target.checked }))}
              />
              Sessiz saat koruması ({notificationPolicy.quietHoursStart} – {notificationPolicy.quietHoursEnd} arası bildirimleri sabah 09:00&apos;a ertele)
            </label>
          </div>
        </div>

        <div className={styles.policyActionRow}>
          <p className={styles.policyHint}>
            💡 Hasta onay linkinden veya WhatsApp veya sesli asistan üzerinden <strong>&quot;Geleceğim&quot;</strong>, <strong>&quot;Ertele&quot;</strong> veya <strong>&quot;Gelmiyorum&quot;</strong> dediğinde Etkileşimli takvim otomatik güncellenir.
          </p>
          <button
            type="button"
            className={styles.saveButton}
            disabled={savingPolicy}
            onClick={saveNotificationPolicy}
          >
            {savingPolicy ? 'Kaydediliyor...' : 'Bildirim Sırasını Kaydet'}
          </button>
        </div>
      </SettingsCard>

      {isDemoLocked ? (
        <section className={styles.card}>
          <div className={styles.comingSoonHeader}>
            <h3 className={styles.cardTitle}>📞 Gelen ve Giden Sesli Arama (Bulut Santral / SIP) Asistanı</h3>
            <span className={styles.comingSoonBadge}>🔒 Pro Paket Entegrasyonu</span>
          </div>
          <p className={styles.cardDescription}>
            Gelen ve giden telefon çağrılarını 7/24 karşılayan, randevu oluşturan ve sesli teyit araması yapan NetGSM / SIP santral asistanları Pro pakette aktiftir.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button
              type="button"
              className={styles.saveButton}
              onClick={() => setSubModal({ open: true, mode: 'Checkout', requestType: 'pro_upgrade', requestedPlan: 'pro' })}
            >
              <span>Hemen Pro Pakete Geç</span>
            </button>
            <button
              type="button"
              className={depth.btn}
              style={{ minHeight: 40, padding: '8px 14px' }}
              onClick={() =>
                setSubModal({
                  open: true,
                  mode: 'RequestAssistant',
                  featureTitle: 'Gelen / Giden Sesli Arama Asistanı',
                  requestType: 'inbound_call',
                  requestedPlan: 'pro',
                })
              }
            >
              Pro Pakete Geçiş Başvurusu Yap
            </button>
          </div>
        </section>
      ) : (
        <>
          <ManagedIntegrationCard title="Çağrı Merkezi / Santral" service="phone" state={integrationStatus.phone} apiPrefix={apiPrefix} onRefresh={refreshIntegrations} onToast={showToast} />
          <ManagedIntegrationCard title="Klinik Telefon Numaraları" service="phone" state={integrationStatus.phone} numbers apiPrefix={apiPrefix} onRefresh={refreshIntegrations} onToast={showToast} />
        </>
      )}

      <ManagedIntegrationCard title="Kısa Mesaj Ayarları (NetGSM)" service="sms" state={integrationStatus.sms} apiPrefix={apiPrefix} onRefresh={refreshIntegrations} onToast={showToast} />
      <ManagedIntegrationCard title="E-Posta (SMTP)" service="smtp" state={integrationStatus.smtp} apiPrefix={apiPrefix} onRefresh={refreshIntegrations} onToast={showToast} />

      {isDemoLocked ? (
        <section className={styles.card}>
          <div className={styles.comingSoonHeader}>
            <h3 className={styles.cardTitle}>💬 WhatsApp Business Yapay Zeka Asistanı</h3>
            <span className={styles.comingSoonBadge}>🔒 Pro Paket Entegrasyonu</span>
          </div>
          <p className={styles.cardDescription}>
            WhatsApp Business (Karekod ve Resmi Meta Bulut API) üzerinden otomatik karşılama, randevu oluşturma ve etkileşimli onay mesajları Pro pakette aktiftir.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button
              type="button"
              className={styles.saveButton}
              onClick={() => setSubModal({ open: true, mode: 'Checkout', requestType: 'pro_upgrade', requestedPlan: 'pro' })}
            >
              <span>Hemen Pro Pakete Geç</span>
            </button>
            <button
              type="button"
              className={depth.btn}
              style={{ minHeight: 40, padding: '8px 14px' }}
              onClick={() =>
                setSubModal({
                  open: true,
                  mode: 'RequestAssistant',
                  featureTitle: 'WhatsApp Business Asistanı',
                  requestType: 'whatsapp',
                  requestedPlan: 'pro',
                })
              }
            >
              Pro Pakete Geçiş Başvurusu Yap
            </button>
          </div>
        </section>
      ) : (
        <>
          <EvolutionWhatsAppCard />
          <N8nMetaWhatsAppCard />
        </>
      )}

      <BillingIntegrationsCard />

      <div className={styles.footer}>
        <button
          onClick={handleSave}
          disabled={saving}
          className={styles.saveButton}
        >
          {saving ? 'Kaydediliyor...' : 'Tümünü Kaydet'}
        </button>
      </div>

      <SubscriptionCheckoutModal
        isOpen={subModal.open}
        mode={subModal.mode}
        featureTitle={subModal.featureTitle}
        defaultRequestType={subModal.requestType}
        defaultRequestedPlan={subModal.requestedPlan}
        userEmail={user?.email}
        userName={user?.name}
        onClose={() => setSubModal(prev => ({ ...prev, open: false }))}
        onSuccess={() => {
          void refreshUser()
        }}
      />
    </div>
  )
}
