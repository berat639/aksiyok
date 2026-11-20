'use client'

import EvolutionWhatsAppCard from './EvolutionWhatsAppCard'
import N8nMetaWhatsAppCard from './N8nMetaWhatsAppCard'
import BillingIntegrationsCard from './BillingIntegrationsCard'
import ConfirmModal from './ConfirmModal'
import SubscriptionCheckoutModal, {
  type SubscriptionModalMode,
  type UpgradeRequestType,
} from './SubscriptionCheckoutModal'
import InfoTooltip from './ui/InfoTooltip'
import { useAuth, type ClinicEntitlements } from '@/lib/auth-context'
import { PhoneMaskedInput } from '@/lib/phone-mask'
import depth from '@/styles/clinic-depth.module.css'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import styles from './IntegrationsTab.module.css'

type CloudProvider = 'netgsm' | 'twilio' | 'vonage' | 'custom'
type ClinicPhone = { id: string; phoneNumber: string; label: string | null; isActive: boolean; isPrimary: boolean }
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

export default function IntegrationsTab({ apiPrefix = '/api/admin/integrations' }: { apiPrefix?: string }) {
  const { user, refreshUser } = useAuth()

  // Subscription & Demo Admins State
  const [subscription, setSubscription] = useState<SubscriptionOverview | null>(null)
  const [demoAdmins, setDemoAdmins] = useState<DemoAdminUser[]>([])
  const [newAdminForm, setNewAdminForm] = useState({ name: '', email: '', password: '', phone: '' })
  const [addingAdmin, setAddingAdmin] = useState(false)
  const [subModal, setSubModal] = useState<{
    open: boolean
    mode: SubscriptionModalMode
    featureTitle?: string
    requestType?: UpgradeRequestType
    requestedPlan?: 'pro' | 'kurumsal'
  }>({ open: false, mode: 'Checkout' })
  const [confirmCancelSub, setConfirmCancelSub] = useState(false)
  const [cancelingSub, setCancelingSub] = useState(false)

  // VoIP States
  const [voipProvider, setVoipProvider] = useState<CloudProvider>('netgsm')
  const [voipLabel, setVoipLabel] = useState('Netgsm Bulut Santral')
  const [voipBaseUrl, setVoipBaseUrl] = useState('https://api.netgsm.com.tr/voice/v1/')
  const [voipTrunkHost, setVoipTrunkHost] = useState('')
  const [clinicPhones, setClinicPhones] = useState<ClinicPhone[]>([])
  const [newPhone, setNewPhone] = useState('')
  const [newPhoneLabel, setNewPhoneLabel] = useState('')

  // SMS States
  const [smsUsercode, setSmsUsercode] = useState('')
  const [smsPassword, setSmsPassword] = useState('')
  const [smsSenderId, setSmsSenderId] = useState('')

  // SMTP States
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpSecure, setSmtpSecure] = useState('none')

  // Branding / Logo State
  const [brandingLogoUrl, setBrandingLogoUrl] = useState('')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoPreviewError, setLogoPreviewError] = useState(false)

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

  const refreshSubscriptionAndAdmins = useCallback(async () => {
    try {
      const [subRes, usersRes] = await Promise.all([
        fetch('/api/billing/subscription', { cache: 'no-store' }).catch(() => null),
        fetch('/api/admin/users', { cache: 'no-store', credentials: 'include' }).catch(() => null),
      ])
      if (subRes && subRes.ok) {
        const subData = await subRes.json().catch(() => null)
        if (subData && typeof subData === 'object') {
          setSubscription(subData as SubscriptionOverview)
        }
      }
      if (usersRes && usersRes.ok) {
        const usersData = await usersRes.json().catch(() => [])
        if (Array.isArray(usersData)) {
          setDemoAdmins(usersData as DemoAdminUser[])
        }
      }
    } catch {}
  }, [])

  useEffect(() => {
    void refreshSubscriptionAndAdmins()
  }, [refreshSubscriptionAndAdmins])

  const handleAddDemoAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAdminForm.name.trim() || !newAdminForm.email.trim() || newAdminForm.password.length < 6) {
      showToast('error', 'Lütfen ad soyad, e-posta ve en az 6 karakterli şifre girin.')
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
        showToast('error', data.error || '2. yönetici eklenemedi.')
        return
      }
      setNewAdminForm({ name: '', email: '', password: '', phone: '' })
      await refreshSubscriptionAndAdmins()
      await refreshUser()
      showToast('success', 'Yeni yönetici hesabı başarıyla oluşturuldu.')
    } catch {
      showToast('error', 'Sunucuya bağlanılamadı.')
    } finally {
      setAddingAdmin(false)
    }
  }

  const handleCancelSubscription = async () => {
    setCancelingSub(true)
    try {
      const res = await fetch('/api/billing/cancel', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast('error', data.error || 'Abonelik iptal edilemedi.')
        return
      }
      setConfirmCancelSub(false)
      await refreshSubscriptionAndAdmins()
      await refreshUser()
      showToast('success', 'Abonelik yenilemesi iptal edildi. Dönem sonuna kadar erişiminiz devam edecektir.')
    } catch {
      showToast('error', 'İptal işlemi sırasında hata oluştu.')
    } finally {
      setCancelingSub(false)
    }
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
        if (data.voipProvider) setVoipProvider(data.voipProvider as CloudProvider)
        if (data.voipLabel) setVoipLabel(data.voipLabel)
        if (data.voipBaseUrl) setVoipBaseUrl(data.voipBaseUrl)
        if (data.voipTrunkHost) setVoipTrunkHost(data.voipTrunkHost)
        
        if (data.smtpHost) setSmtpHost(data.smtpHost)
        if (data.smtpPort) setSmtpPort(data.smtpPort)
        if (data.smtpUser) setSmtpUser(data.smtpUser)
        if (data.smtpPass) setSmtpPass(data.smtpPass)
        if (data.smtpSecure) setSmtpSecure(data.smtpSecure)

        if (data.smsUsercode) setSmsUsercode(data.smsUsercode)
        if (data.smsPassword) setSmsPassword(data.smsPassword)
        if (data.smsSenderId) setSmsSenderId(data.smsSenderId)


      })
      .catch(() => showToast('error', 'Bağlantı bilgileri alınamadı'))
      .finally(() => setLoading(false))

    fetch('/api/admin/settings/branding')
      .then(r => r.json())
      .then(data => { if (data.logoUrl) setBrandingLogoUrl(data.logoUrl) })
      .catch(() => {})

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

  const addClinicPhone = async () => {
    if (!newPhone.trim()) return
    const res = await fetch('/api/yonetici/telephony-numbers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: newPhone, label: newPhoneLabel, isPrimary: clinicPhones.length === 0 }),
    })
    const data = await res.json()
    if (!res.ok) return showToast('error', data.error || 'Telefon eklenemedi')
    setClinicPhones(prev => [...prev, data]); setNewPhone(''); setNewPhoneLabel('')
    showToast('success', 'Telefon numarası işletmeye bağlandı')
  }

  const toggleClinicPhone = async (phone: ClinicPhone) => {
    const res = await fetch(`/api/yonetici/telephony-numbers/${phone.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !phone.isActive }),
    })
    if (!res.ok) return showToast('error', 'Telefon durumu güncellenemedi')
    setClinicPhones(prev => prev.map(x => x.id === phone.id ? { ...x, isActive: !phone.isActive } : x))
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

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingLogo(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/admin/settings/logo-upload', {
        method: 'POST',
        body: formData
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Yükleme hatası')
      setBrandingLogoUrl(data.logoUrl)
      setLogoPreviewError(false)
      showToast('success', 'Amblem başarıyla yüklendi')
    } catch (err: any) {
      showToast('error', err.message || 'Amblem yüklenemedi')
    } finally {
      setUploadingLogo(false)
    }
  }

  if (loading) return <div className={styles.loading}><Spinner /></div>

  const effectivePlan: ClinicEntitlements | undefined = subscription?.entitlements || user?.plan
  const isDemoLocked = Boolean(effectivePlan?.planId === 'demo' && !user?.canManagePlatform)
  const adminOnlyUsers = demoAdmins.filter(u => u.role === 'yonetici')
  const maxAllowedUsers = effectivePlan?.maxUsers || (effectivePlan?.planId === 'pro' ? 10 : effectivePlan?.planId === 'kurumsal' ? 50 : 2)
  const activeCount = effectivePlan?.activeUsersCount ?? (demoAdmins.filter(u => u.active !== false).length || 1)
  const planDisplayName =
    effectivePlan?.planName ||
    (effectivePlan?.planId === 'pro'
      ? 'Pro Paket'
      : effectivePlan?.planId === 'kurumsal'
        ? 'Kurumsal Paket'
        : 'Demo Paket')

  return (
    <div className={styles.page}>
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`} role="status">
          {toast.text}
        </div>
      )}

      {/* Abonelik, Paket ve Yönetici Hesapları */}
      <section className={styles.card}>
        <div className={styles.comingSoonHeader} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 className={styles.cardTitle} style={{ margin: 0 }}>
              Abonelik, Paket ve Yönetici Hesapları
            </h3>
            <InfoTooltip title="Paket Hakları ve Kullanıcı Kapasitesi">
              Demo pakette 7 gün boyunca Web Asistanı ve en fazla 2 Yönetici hesabı aktiftir. Pro pakette (7.000 ₺ + KDV / ay) 10 kullanıcı, Personel, Finans, Stok, WhatsApp Business ve Sesli Santral asistanları açılır.
            </InfoTooltip>
          </div>
          {effectivePlan && (
            <span
              className={`${styles.statusBadge} ${
                effectivePlan.isTrialExpired || effectivePlan.planStatus === 'expired'
                  ? styles.statusDanger
                  : effectivePlan.planStatus === 'active'
                    ? styles.statusSuccess
                    : styles.statusWarning
              }`}
            >
              {planDisplayName} · {PLAN_STATUS_LABELS[effectivePlan.planStatus] || effectivePlan.planStatus}
            </span>
          )}
        </div>

        <div className={styles.grid} style={{ marginBottom: 16 }}>
          <div className={styles.roleGroup} style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Aktif Paket
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--foreground)', marginTop: 4 }}>
              {planDisplayName}
            </div>
            <div style={{ fontSize: 12, color: 'var(--foreground-2)', marginTop: 2 }}>
              {effectivePlan?.planId === 'pro'
                ? '7.000 ₺ + KDV (8.400 ₺ / ay)'
                : effectivePlan?.planId === 'kurumsal'
                  ? 'Kurumsal Özel Sözleşme'
                  : '7 Gün Ücretsiz Başlangıç'}
            </div>
          </div>

          <div className={styles.roleGroup} style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Kullanıcı Limiti
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--foreground)', marginTop: 4 }}>
              {activeCount} / {maxAllowedUsers} Aktif Kullanıcı
            </div>
            <div style={{ fontSize: 12, color: 'var(--foreground-2)', marginTop: 2 }}>
              {effectivePlan?.planId === 'demo'
                ? 'En fazla 2 Yönetici hesabı'
                : effectivePlan?.pendingInvitesCount
                  ? `${effectivePlan.pendingInvitesCount} bekleyen davet`
                  : 'Tüm personel rolleri açık'}
            </div>
          </div>

          <div className={styles.roleGroup} style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {effectivePlan?.trialEndsAt ? 'Deneme Bitiş Tarihi' : 'Dönem / Yenileme'}
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--foreground)', marginTop: 4 }}>
              {effectivePlan?.trialEndsAt
                ? new Date(effectivePlan.trialEndsAt).toLocaleDateString('tr-TR')
                : effectivePlan?.currentPeriodEnd
                  ? new Date(effectivePlan.currentPeriodEnd).toLocaleDateString('tr-TR')
                  : 'Aktif'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--foreground-2)', marginTop: 2 }}>
              {effectivePlan?.trialEndsAt
                ? effectivePlan.isTrialExpired
                  ? 'Deneme süresi sona erdi'
                  : `Kalan süre: ${effectivePlan.trialDaysRemaining ?? 0} gün`
                : effectivePlan?.planStatus === 'canceled'
                  ? 'Dönem sonunda yenilenmeyecek'
                  : 'Kesintisiz erişim'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {(!effectivePlan || effectivePlan.planId === 'demo' || effectivePlan.planStatus === 'expired' || effectivePlan.planStatus === 'canceled') && (
            <button
              type="button"
              className={styles.saveButton}
              onClick={() => setSubModal({ open: true, mode: 'Checkout', requestType: 'pro_upgrade', requestedPlan: 'pro' })}
            >
              <span>🚀 Pro Pakete Yükselt (7.000 ₺ + KDV)</span>
            </button>
          )}

          <button
            type="button"
            className={depth.btn}
            style={{ minHeight: 40, padding: '8px 14px' }}
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
            Kurumsal Paket İçin Satışla Görüş
          </button>

          {effectivePlan?.planId === 'pro' && effectivePlan.planStatus === 'active' && (
            <button
              type="button"
              disabled={cancelingSub}
              onClick={() => setConfirmCancelSub(true)}
              style={{
                minHeight: 40,
                padding: '8px 14px',
                borderRadius: 9,
                border: '1px solid var(--danger)',
                background: 'var(--card-inner)',
                color: 'var(--danger)',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                boxShadow: 'var(--pc-clay-btn)',
              }}
            >
              Aboneliği İptal Et
            </button>
          )}
        </div>

        {subscription?.requests && subscription.requests.length > 0 && (
          <div className={styles.roleGroup} style={{ marginTop: 14, padding: '10px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)', marginBottom: 6 }}>
              Son Paket & Asistan Talepleriniz
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {subscription.requests.slice(0, 4).map(req => (
                <span key={req.id} className={depth.badge}>
                  {UPGRADE_REQ_LABELS[req.requestType] || req.requestType} ·{' '}
                  {UPGRADE_REQ_STATUS_LABELS[req.status] || req.status}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Demo 2-Admin Management Card */}
        {(!effectivePlan || effectivePlan.planId === 'demo') && (
          <div className={styles.policyRulesBox} style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 750, color: 'var(--foreground)' }}>
                  Demo Yönetici Kullanıcıları (En Fazla {maxAllowedUsers} Yönetici)
                </div>
                <div style={{ fontSize: 12, color: 'var(--foreground-2)', marginTop: 2 }}>
                  Demo pakette İşletme Personeli sekmesi kilitlidir; 2. yönetici ortağınızı doğrudan buradan ekleyebilirsiniz.
                </div>
              </div>
              <span className={depth.badge}>
                {adminOnlyUsers.length} / {maxAllowedUsers} Yönetici
              </span>
            </div>

            {adminOnlyUsers.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {adminOnlyUsers.map(adm => (
                  <div
                    key={adm.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'var(--card-bg)',
                      border: '1px solid var(--input-border)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 13, color: 'var(--foreground)' }}>{adm.name}</strong>
                      <span style={{ fontSize: 12, color: 'var(--foreground-2)', marginLeft: 8 }}>{adm.email}</span>
                    </div>
                    <span className={`${styles.statusBadge} ${adm.active !== false ? styles.statusSuccess : styles.statusWarning}`}>
                      {adm.active !== false ? 'Yönetici · Aktif' : 'Pasif'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {adminOnlyUsers.length < maxAllowedUsers ? (
              <form onSubmit={handleAddDemoAdmin} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className={styles.grid}>
                  <Field label="2. Yönetici Ad Soyad *">
                    <input
                      required
                      value={newAdminForm.name}
                      onChange={e => setNewAdminForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Örn: Mehmet Demir"
                    />
                  </Field>
                  <Field label="E-posta Adresi *">
                    <input
                      type="email"
                      required
                      value={newAdminForm.email}
                      onChange={e => setNewAdminForm(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="ortak@isletme.com"
                    />
                  </Field>
                  <Field label="Başlangıç Şifresi * (En az 6 karakter)">
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newAdminForm.password}
                      onChange={e => setNewAdminForm(prev => ({ ...prev, password: e.target.value }))}
                      placeholder="••••••••"
                    />
                  </Field>
                  <Field label="Telefon (Opsiyonel)">
                    <PhoneMaskedInput
                      value={newAdminForm.phone}
                      onValueChange={phone => setNewAdminForm(prev => ({ ...prev, phone }))}
                      placeholder="0 (5XX) XXX XX XX"
                    />
                  </Field>
                </div>
                <div>
                  <button type="submit" disabled={addingAdmin} className={styles.saveButton}>
                    <span>{addingAdmin ? 'Ekleniyor...' : '+ 2. Yöneticiyi Ekle'}</span>
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--foreground-2)', fontWeight: 600 }}>
                Demo yönetici limitiniz ({maxAllowedUsers}/{maxAllowedUsers}) doldu. 10 kullanıcıya kadar personel ve uzman eklemek için Pro pakete yükseltebilirsiniz.
              </div>
            )}
          </div>
        )}
      </section>

      {/* Marka / Logo Ayarları */}
      <SettingsCard title="Marka ve Görünüm" description="Sistemde, özellikle hasta ekranlarında ve panelde görünecek kurum amblemi.">
        <div className={styles.logoRow}>
          <div className={styles.logoPreview}>
            {brandingLogoUrl && !logoPreviewError ? (
              <img
                src={brandingLogoUrl}
                alt="Amblem"
                onError={() => setLogoPreviewError(true)}
              />
            ) : (
              <span className={styles.logoPlaceholder}>🖼️</span>
            )}
          </div>
          <div className={styles.logoActions}>
            <label
              className={styles.uploadButton}
              style={{ background: '#2563eb', color: '#ffffff' }}
            >
              <span style={{ color: '#ffffff' }}>
                {uploadingLogo ? 'Yükleniyor...' : 'Amblem Seç ve Yükle'}
              </span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} disabled={uploadingLogo} />
            </label>
            <p className={styles.helperText}>
              PNG, JPG veya WEBP formatlarında, maksimum 2 MB boyutunda görsel yükleyebilirsiniz.
            </p>
          </div>
        </div>
      </SettingsCard>

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
          void refreshSubscriptionAndAdmins()
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
