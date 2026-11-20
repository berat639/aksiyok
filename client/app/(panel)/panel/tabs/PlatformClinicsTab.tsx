'use client'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { IMaskInput } from 'react-imask'
import ConfirmModal from '../../../admin/components/ConfirmModal'
import N8nMetaWhatsAppCard from '../../../admin/components/N8nMetaWhatsAppCard'
import PlatformSystemPrompts from './PlatformSystemPrompts'
import styles from './PlatformClinicsTab.module.css'

type Clinic = { id: string; name: string; hostname: string; domains?: string[]; businessTemplate?: 'general' | 'dental_clinic'; isActive?: boolean; planId?: 'demo' | 'pro' | 'kurumsal'; planStatus?: 'trial' | 'active' | 'past_due' | 'canceled' | 'expired'; maxUsers?: number; trialEndsAt?: string | null }; type Test = { id: string; kind: string; status: string; message: string | null; revision: number; expiresAt?: string }; type State = { configured: boolean; enabled: boolean; revision: number; health: string; test: Test | null; tests?: Test[]; config?: Record<string, unknown> }; type Integrations = { phone: State; sms: State; smtp: State; connection: { ip: string; port: number; protocol: string } }; type Wa = { connectionState: string; expectedPhone: string | null; linkedPhone?: string | null; numberVerifiedAt: string | null; enabled?: boolean; setupStatus?: string }
type PlatformUpgradeRequest = { id: string; clinicId?: string | null; clinicName?: string | null; companyName?: string | null; contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null; requestType: string; requestedPlan?: string | null; status: string; notes?: string | null; createdAt?: string }
const UPGRADE_TYPE_TR: Record<string, string> = { pro_upgrade: 'Pro Paket Geçişi', whatsapp: 'WhatsApp Asistanı Talebi', inbound_call: 'Gelen Arama Asistanı Talebi', outbound_call: 'Giden Arama Asistanı Talebi', kurumsal_lead: 'Kurumsal Paket Başvurusu' }
const UPGRADE_STATUS_TR: Record<string, string> = { pending: 'Bekliyor', contacted: 'İletişime Geçildi', approved: 'Onaylandı', rejected: 'Reddedildi' }
const slugifyHostLabel = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
type GeminiKeyInfo = { configured: boolean; source: 'clinic' | 'shared' | 'missing'; last4: string | null; updatedAt: string | null; conflict?: boolean }
type ClinicAdmin = { id: string; email: string; name: string; phone: string | null; role: string; active: boolean; isPlatformAdmin: boolean; createdAt: string }
type ClinicAdminInvite = { id: string; email: string; name: string; role: string; status: string; expiresAt: string; createdAt: string }
type ClinicAdminsPayload = { clinicId: string; clinicName: string; clinicIsActive: boolean; primaryHostname: string; admins: ClinicAdmin[]; invitations: ClinicAdminInvite[]; smtpStatus: { configured: boolean; enabled: boolean; ready: boolean; fromAddress: string | null; message: string } }
type PhoneForm = { username: string; password: string; numbers: string[]; callerId: string; transferNumber: string; target: string }
const digits = (v: string) => v.replace(/\D/g, ''); const national = (v: string) => { let n = digits(v); if (n.startsWith('90')) n = n.slice(2); if (n.startsWith('0')) n = n.slice(1); return n.slice(0, 10) }; const e164 = (v: string) => `+90${national(v)}`; const validPhone = (v: string) => /^[1-9]\d{9}$/.test(national(v)); const validMobile = (v: string) => /^5\d{9}$/.test(national(v)); const mask = '+{90} (000) 000 00 00'
const PhoneInput = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <IMaskInput mask={mask} unmask value={`90${national(value)}`} placeholder="+90 (___) ___ __ __" inputMode="tel" autoComplete="tel" onAccept={v => onChange(national(String(v)))} />
const Field = ({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) => <label className={styles.field}><span>{label}</span>{children}{help && <small>{help}</small>}</label>
const PhoneList = ({ values, onChange, onRemoveLast, canRemoveLast }: { values: string[]; onChange: (values: string[]) => void; onRemoveLast?: () => void; canRemoveLast?: boolean }) => <div className={styles.phoneList}>{values.map((value, index) => <div className={styles.phoneRow} key={index}><PhoneInput value={value} onChange={next => onChange(values.map((item, i) => i === index ? next : item))} />{(values.length > 1 || Boolean(value) || canRemoveLast) && <button type="button" className={styles.removeButton} onClick={() => { if (values.length > 1) { onChange(values.filter((_, i) => i !== index)) } else if (onRemoveLast && canRemoveLast) { onRemoveLast() } else { onChange(['']) } }}>Sil</button>}</div>)}<button type="button" className={styles.secondaryButton} onClick={() => onChange([...values, ''])}>Numara ekle</button></div>
async function api<T>(url: string, init?: RequestInit) { const r = await fetch(url, { cache: 'no-store', ...init }); const d = await r.json(); if (!r.ok) throw new Error(d.error || 'İşlem tamamlanamadı'); return d as T }
const current = (s: State, kind: string) => { const t = s.tests?.find(t => t.revision === s.revision && t.kind === kind); return t && ['pending', 'accepted'].includes(t.status) && t.expiresAt && Date.parse(t.expiresAt) <= Date.now() ? { ...t, status: 'expired' } : t }; const done = (s: State, kind: string) => current(s, kind)?.status === 'confirmed'

function parseDiagnostic(raw: string, service?: 'phone' | 'sms' | 'smtp', smtpState?: { host: string; port: string }): { cause: string; suggestion: string } {
  const parts = raw.split(/💡\s*Öneri:\s*/i)
  if (parts.length > 1) {
    return { cause: parts[0].trim(), suggestion: parts.slice(1).join(' ').trim() }
  }
  const lower = raw.toLowerCase()
  if (lower.includes('saniye bekleyin') || lower.includes('429')) {
    return {
      cause: raw,
      suggestion: 'Üst üste test isteği gönderildi. Ayarlarda değişiklik yaptıysanız önce "1. Bilgileri kaydedin → Kaydet" butonuna basın, ardından tekrar "Test gönder" deyin.',
    }
  }
  if (service === 'smtp') {
    if (smtpState?.port === '587') {
      return {
        cause: raw,
        suggestion: 'Natro ve birçok kurumsal e-posta sunucusunda Port 587 (STARTTLS) zaman aşımına uğrayabilir veya sertifika uyuşmazlığı yaşayabilir. Port değerini 465 (SSL) yapıp (Natro için sunucu: mx-out03.natrohost.com) tekrar Kaydet → Test gönder adımlarını uygulayın.',
      }
    }
    return {
      cause: raw,
      suggestion: '1) Sunucu adresini (Natro için mx-out03.natrohost.com) ve Port 465 (SSL) değerini kontrol edin. 2) Kullanıcı ve Gönderici e-posta alanlarına tam e-posta adresinizi (örn. app@axamaz.com) yazın. 3) Gmail/Yandex kullanıyorsanız normal şifre yerine Uygulama Şifresi girin.',
    }
  }
  if (service === 'sms') {
    return {
      cause: raw,
      suggestion: '1) NetGSM API kullanıcı kodu (örn. 312... / 850...) ve alt kullanıcı parolasını kontrol edin. 2) Başlık (MsgHeader) değerinin NetGSM panelindeki onaylı başlığınızla birebir aynı olduğundan emin olun. 3) NetGSM panelinde API erişiminin açık olduğunu doğrulayın.',
    }
  }
  if (service === 'phone') {
    return {
      cause: raw,
      suggestion: '1) SIP kullanıcı adı ve SIP şifresinin doğru olduğundan emin olun. 2) Çıkış numarasının Gelen numaralar listesinde yer aldığını ve test numarasının geçerli bir telefon numarası olduğunu kontrol edin.',
    }
  }
  return {
    cause: raw,
    suggestion: 'Bağlantı bilgilerini kontrol edip "1. Bilgileri kaydedin → Kaydet" butonuna bastıktan sonra işlemi tekrar deneyin.',
  }
}

function DiagnosticAlert({ message, service, smtpState, onQuickFix }: { message: string; service?: 'phone' | 'sms' | 'smtp'; smtpState?: { host: string; port: string; username: string; fromAddress: string }; onQuickFix?: (patch: Partial<{ host: string; port: string; secure: string; fromAddress: string }>) => void }) {
  const { cause, suggestion } = parseDiagnostic(message, service, smtpState)
  const showPort465Fix = service === 'smtp' && smtpState && smtpState.port !== '465' && onQuickFix
  const showNatroHostFix = service === 'smtp' && smtpState && (smtpState.host.includes('axamaz.com') || smtpState.host.includes('thinpine.com') || !smtpState.host.includes('natrohost.com')) && onQuickFix
  const showFromMatchFix = service === 'smtp' && smtpState && smtpState.username && smtpState.fromAddress !== smtpState.username && onQuickFix

  return (
    <div className={styles.diagnosticBox} role="alert">
      <div className={styles.diagnosticTitle}>
        <span>⚠️</span>
        <span>Hata Nedeni: {cause}</span>
      </div>
      <div className={styles.suggestionBox}>
        <strong>💡 Çözüm Önerisi:</strong> {suggestion}
        {(showPort465Fix || showNatroHostFix || showFromMatchFix) && (
          <div className={styles.quickFixRow}>
            {showPort465Fix && (
              <button type="button" className={styles.quickFixButton} onClick={() => onQuickFix({ port: '465', secure: 'ssl' })}>
                ⚡ Portu 465 (SSL) Yap
              </button>
            )}
            {showNatroHostFix && (
              <button type="button" className={styles.quickFixButton} onClick={() => onQuickFix({ host: 'mx-out03.natrohost.com', port: '465', secure: 'ssl' })}>
                ⚡ Natro Sunucusu (mx-out03.natrohost.com · Port 465) Uygula
              </button>
            )}
            {showFromMatchFix && (
              <button type="button" className={styles.quickFixButton} onClick={() => onQuickFix({ fromAddress: smtpState.username })}>
                ⚡ Gönderici E-postayı ({smtpState.username}) Eşitle
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Step({ complete, title, detail, action, disabled, onClick, onCancel, alwaysShowAction }: { complete: boolean; title: string; detail: string; action: string; disabled?: boolean; onClick: () => void; onCancel?: () => void; alwaysShowAction?: boolean }) { const waiting = action === 'Bağlantı bekleniyor'; return <div className={`${styles.step} ${complete ? styles.stepComplete : ''}`}><div><strong>{complete ? `${title} (Kayıtlı)` : title}</strong><p>{detail}</p></div>{(!complete || alwaysShowAction) && <div className={styles.stepActions}>{onCancel && <button type="button" className={styles.removeButton} disabled={disabled} onClick={onCancel}>Testi iptal et</button>}<button type="button" className={waiting ? styles.removeButton : styles.secondaryButton} disabled={waiting ? false : disabled} onClick={onClick}>{waiting ? 'Testi iptal et' : action}</button></div>}</div> }

export default function PlatformClinicsTab() {
  const [clinics, setClinics] = useState<Clinic[]>([]), [selected, setSelected] = useState<string | null>(null), [ints, setInts] = useState<Integrations | null>(null), [wa, setWa] = useState<Wa | null>(null), [geminiKey, setGeminiKey] = useState<GeminiKeyInfo | null>(null), [geminiKeyInput, setGeminiKeyInput] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState(''), [name, setName] = useState(''), [host, setHost] = useState(''), [hostTouched, setHostTouched] = useState(false), [businessTemplate, setBusinessTemplate] = useState<'general' | 'dental_clinic'>('general'), [sourceClinicId, setSourceClinicId] = useState(''), [zone, setZone] = useState('Europe/Istanbul'), [waPhone, setWaPhone] = useState(''), [qr, setQr] = useState<string | null>(null)
  const [editBusinessName, setEditBusinessName] = useState(''), [editBusinessTemplate, setEditBusinessTemplate] = useState<'general' | 'dental_clinic'>('general'), [newDomainHost, setNewDomainHost] = useState(''), [makePrimaryDomain, setMakePrimaryDomain] = useState(false)
  const [clinicAdmins, setClinicAdmins] = useState<ClinicAdmin[]>([]), [adminInvites, setAdminInvites] = useState<ClinicAdminInvite[]>([]), [adminSmtp, setAdminSmtp] = useState<{ ready: boolean; message: string }>({ ready: false, message: '' }), [adminMode, setAdminMode] = useState<'seed' | 'invite'>('seed'), [adminForm, setAdminForm] = useState({ name: '', email: '', password: '', phone: '' })
  const [confirmFreezeClinic, setConfirmFreezeClinic] = useState<Clinic | null>(null), [confirmFreezeAdmin, setConfirmFreezeAdmin] = useState<ClinicAdmin | null>(null), [confirmRemoveKey, setConfirmRemoveKey] = useState(false)
  const [upgradeRequests, setUpgradeRequests] = useState<PlatformUpgradeRequest[]>([])
  const [planForm, setPlanForm] = useState<{ planId: 'demo' | 'pro' | 'kurumsal'; planStatus: 'trial' | 'active' | 'expired' | 'canceled'; maxUsers: string }>({ planId: 'demo', planStatus: 'trial', maxUsers: '2' })
  const [phone, setPhone] = useState<PhoneForm>({ username: '', password: '', numbers: [''], callerId: '', transferNumber: '', target: '' }), [sms, setSms] = useState({ username: '', password: '', senderId: '', target: '' }), [smtp, setSmtp] = useState({ host: '', port: '465', username: '', password: '', secure: 'ssl', fromName: '', fromAddress: '', target: '' }); const serial = useRef(0)
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'İşlem tamamlanamadı') } finally { setBusy(false) } }
  const loadUpgradeRequests = useCallback(async () => {
    try {
      const raw = await api<PlatformUpgradeRequest[] | { requests?: PlatformUpgradeRequest[] }>('/api/platform/upgrade-requests')
      setUpgradeRequests(Array.isArray(raw) ? raw : (Array.isArray(raw?.requests) ? raw.requests : []))
    } catch {
      // Yoksay
    }
  }, [])
  const load = useCallback(async () => {
    const [clinicRows] = await Promise.all([
      api<Clinic[]>('/api/platform/clinics'),
      loadUpgradeRequests(),
    ])
    setClinics(clinicRows)
  }, [loadUpgradeRequests])
  const loadClinicAdmins = useCallback(async (id: string) => {
    const a = await api<ClinicAdminsPayload>(`/api/platform/clinics/${id}/admins`)
    setClinicAdmins(a.admins || [])
    setAdminInvites((a.invitations || []).filter(inv => inv.status === 'pending'))
    setAdminSmtp({ ready: Boolean(a.smtpStatus?.ready), message: a.smtpStatus?.message || '' })
  }, [])
  const loadClinic = useCallback(async (id: string) => { const req = ++serial.current; const [i, w, a, gk] = await Promise.all([api<Integrations>(`/api/platform/clinics/${id}/integrations`), api<Wa>(`/api/platform/clinics/${id}/whatsapp`), api<ClinicAdminsPayload>(`/api/platform/clinics/${id}/admins`), api<GeminiKeyInfo>(`/api/platform/clinics/${id}/gemini-key`).catch(() => ({ configured: false, source: 'missing' as const, last4: null, updatedAt: null }))]); if (req !== serial.current) return; setInts(i); setWa(w); setGeminiKey(gk); setGeminiKeyInput(''); setClinicAdmins(a.admins || []); setAdminInvites((a.invitations || []).filter(inv => inv.status === 'pending')); setAdminSmtp({ ready: Boolean(a.smtpStatus?.ready), message: a.smtpStatus?.message || '' }); setWaPhone(national(w.expectedPhone || '')); const p = i.phone.config || {}, s = i.sms.config || {}, m = i.smtp.config || {}; setPhone(x => ({ ...x, password: '', username: String(p.username || ''), numbers: Array.isArray(p.numbers) && p.numbers.length ? p.numbers.map(v => national(String(v))) : [''], callerId: national(String(p.callerId || '')), transferNumber: national(String(p.transferNumber || '')) })); setSms(x => ({ ...x, password: '', username: String(s.username || ''), senderId: String(s.senderId || '') })); setSmtp(x => ({ ...x, password: '', host: String(m.host || ''), port: String(m.port || 465), username: String(m.username || ''), secure: String(m.secure || (Number(m.port || 465) === 465 ? 'ssl' : 'tls')), fromName: String(m.fromName || ''), fromAddress: String(m.fromAddress || '') })) }, [])
  useEffect(() => { void load().catch(e => setError(e.message)) }, [load])
  const choose = (id: string) => {
    setSelected(id)
    setInts(null)
    setQr(null)
    const found = clinics.find(c => c.id === id)
    if (found) {
      setEditBusinessName(found.name)
      setEditBusinessTemplate(found.businessTemplate === 'dental_clinic' ? 'dental_clinic' : 'general')
      setNewDomainHost('')
      setMakePrimaryDomain(false)
      const pId = found.planId === 'pro' || found.planId === 'kurumsal' ? found.planId : 'demo'
      const pStatus =
        found.planStatus === 'active' || found.planStatus === 'expired' || found.planStatus === 'canceled'
          ? found.planStatus
          : 'trial'
      const defaultMax = pId === 'pro' ? 10 : pId === 'kurumsal' ? 50 : 2
      setPlanForm({
        planId: pId,
        planStatus: pStatus,
        maxUsers: String(found.maxUsers || defaultMax),
      })
    }
    void loadClinic(id).catch(e => setError(e.message))
  }

  const updateSelectedClinicPlan = (payload: {
    planId?: 'demo' | 'pro' | 'kurumsal'
    planStatus?: 'trial' | 'active' | 'expired' | 'canceled'
    maxUsers?: number
    extendTrialDays?: number
  }) => {
    if (!selected) return
    void run(async () => {
      await api(`/api/platform/clinics/${selected}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await load()
      setNotice(
        payload.extendTrialDays
          ? `Deneme süresi +${payload.extendTrialDays} gün uzatıldı.`
          : 'İşletme paket ve kullanıcı limitleri güncellendi.',
      )
    })
  }

  const handleUpgradeRequestPatch = (
    requestId: string,
    payload: { status: 'pending' | 'contacted' | 'approved' | 'rejected'; applyPlan?: 'demo' | 'pro' | 'kurumsal' },
  ) => {
    void run(async () => {
      await api(`/api/platform/upgrade-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await load()
      setNotice('Paket / asistan geçiş talebi durumu güncellendi.')
    })
  }
  // Refresh status without resetting unsaved configuration or WhatsApp state.
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    let running = false
    const timer = setInterval(async () => {
      if (running) return
      running = true
      const req = serial.current
      try {
        const next = await api<Integrations>(`/api/platform/clinics/${selected}/integrations`)
        if (!cancelled && req === serial.current) setInts(next)
        if (qr || wa?.connectionState === 'connecting') {
          const nextWa = await api<Wa>(`/api/platform/clinics/${selected}/whatsapp`)
          if (!cancelled && req === serial.current) {
            setWa(nextWa)
            if (nextWa.expectedPhone && !waPhone) setWaPhone(national(nextWa.expectedPhone))
            if (nextWa.connectionState === 'open' && qr) {
              setQr(null)
              setNotice('WhatsApp karekodu okutuldu ve bağlantı kuruldu. "Gönderimleri etkinleştir" butonuna basabilirsiniz.')
            }
          }
        }
      } catch {
      } finally {
        running = false
      }
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [selected, qr, wa?.connectionState, waPhone])
  const save = async (service: 'phone' | 'sms' | 'smtp', body: Record<string, unknown>) => { if (!selected || !ints) return; await api(`/api/platform/clinics/${selected}/integrations/${service}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, revision: ints[service].revision }) }); await loadClinic(selected); setNotice('Kaydedildi. Sıradaki test adımına geçebilirsiniz.') }
  const cancelActiveTest = async (service: 'phone' | 'sms' | 'smtp', testId: string) => { if (!selected) return; await api(`/api/platform/clinics/${selected}/integrations/${service}/tests/${testId}/cancel`, { method: 'POST' }); await loadClinic(selected); setNotice('Bekleyen test iptal edildi. Yeni test başlatabilirsiniz.') }
  const test = async (service: 'phone' | 'sms' | 'smtp', target: string, kind = 'delivery') => {
    if (!selected || !ints) return
    const active = current(ints[service], kind)
    if (active?.status === 'accepted') { await cancelActiveTest(service, active.id); return }
    if (service === 'sms' && !validMobile(target)) throw new Error('Test için kendi cep telefonunuzu +90 (5__) ___ __ __ biçiminde girin.')
    if (service === 'phone' && !validPhone(target)) throw new Error('Test için geçerli bir telefon numarasını +90 (___) ___ __ __ biçiminde girin.')
    let currentRevision = ints[service].revision
    if (service === 'smtp') {
      const m = ints.smtp.config || {}
      const smtpDirty =
        Boolean(smtp.password.trim()) ||
        smtp.host.trim() !== String(m.host || '') ||
        String(Number(smtp.port || 465)) !== String(m.port || 465) ||
        smtp.username.trim() !== String(m.username || '') ||
        (smtp.fromAddress.trim() || smtp.username.trim()) !== String(m.fromAddress || '') ||
        smtp.fromName.trim() !== String(m.fromName || '')
      if (smtpDirty) {
        const saved = await api<{ ok: boolean; revision?: number }>(`/api/platform/clinics/${selected}/integrations/smtp`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...smtp,
            port: Number(smtp.port),
            secure: Number(smtp.port) === 465 ? 'ssl' : 'tls',
            fromAddress: smtp.fromAddress || smtp.username,
            revision: currentRevision,
          }),
        })
        if (typeof saved.revision === 'number') currentRevision = saved.revision
        else currentRevision += 1
      }
    } else if (service === 'sms') {
      const s = ints.sms.config || {}
      const smsDirty =
        Boolean(sms.password.trim()) ||
        sms.username.trim() !== String(s.username || '') ||
        sms.senderId.trim() !== String(s.senderId || '')
      if (smsDirty) {
        const saved = await api<{ ok: boolean; revision?: number }>(`/api/platform/clinics/${selected}/integrations/sms`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...sms, revision: currentRevision }),
        })
        if (typeof saved.revision === 'number') currentRevision = saved.revision
        else currentRevision += 1
      }
    }
    const r = await api<Test>(`/api/platform/clinics/${selected}/integrations/${service}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: currentRevision, target: service === 'smtp' ? target : e164(target), kind, operationId: crypto.randomUUID() }) })
    await loadClinic(selected)
    if (r.status === 'failed') setError(r.message || 'Test başarısız oldu.')
    else setNotice(r.message || 'Test başlatıldı.')
  }
  const confirm = async (service: 'phone' | 'sms' | 'smtp', id: string) => { if (!selected) return; await api(`/api/platform/clinics/${selected}/integrations/${service}/tests/${id}/confirm`, { method: 'POST' }); await loadClinic(selected); setNotice('Test doğrulandı. Sıradaki adıma geçebilirsiniz.') }; const toggle = async (service: 'phone' | 'sms' | 'smtp') => { if (!selected || !ints) return; const active = !ints[service].enabled; await api(`/api/platform/clinics/${selected}/integrations/${service}/${active ? 'activate' : 'deactivate'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: ints[service].revision }) }); await loadClinic(selected); setNotice(active ? 'Entegrasyon etkinleştirildi.' : 'Yeni kullanım kapatıldı.') }; const removeIntegration = async (service: 'phone' | 'sms' | 'smtp') => { if (!selected) return; await api(`/api/platform/clinics/${selected}/integrations/${service}`, { method: 'DELETE' }); if (service === 'phone') setPhone({ username: '', password: '', numbers: [''], callerId: '', transferNumber: '', target: '' }); await loadClinic(selected); setNotice('İşletme telefon numarası ve bağlantısı silindi. Numarayı başka bir işletmeye ekleyebilirsiniz.') }
  const executeClinicStatusChange = async (targetClinic: Clinic, nextActive: boolean) => {
    await run(async () => {
      const updated = await api<Clinic>(`/api/platform/clinics/${targetClinic.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextActive }),
      })
      setClinics(prev => prev.map(item => item.id === updated.id ? { ...item, isActive: updated.isActive } : item))
      setConfirmFreezeClinic(null)
      setNotice(nextActive ? `"${updated.name}" işletmesi yeniden aktifleştirildi.` : `"${updated.name}" işletmesi donduruldu ve kullanıcılarının aktif oturumları sonlandırıldı.`)
    })
  }
  const submitClinicAdminForm = (e: FormEvent) => {
    e.preventDefault()
    if (!selected) return
    void run(async () => {
      if (adminMode === 'seed') {
        await api(`/api/platform/clinics/${selected}/admins/seed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: adminForm.name.trim(),
            email: adminForm.email.trim(),
            password: adminForm.password,
            phone: adminForm.phone ? e164(adminForm.phone) : undefined,
          }),
        })
        setAdminForm({ name: '', email: '', password: '', phone: '' })
        await loadClinicAdmins(selected)
        setNotice('İşletme için Seed User (Yönetici) başarıyla atandı.')
      } else {
        await api(`/api/platform/clinics/${selected}/admins/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: adminForm.name.trim(),
            email: adminForm.email.trim(),
          }),
        })
        setAdminForm({ name: '', email: '', password: '', phone: '' })
        await loadClinicAdmins(selected)
        setNotice('İşletme yöneticisi (Seed User) davet e-postası gönderildi.')
      }
    })
  }
  const revokeAdminInvitation = (invitationId: string) => {
    if (!selected) return
    void run(async () => {
      await api(`/api/platform/clinics/${selected}/admins/invitations/${invitationId}`, { method: 'DELETE' })
      await loadClinicAdmins(selected)
      setNotice('Bekleyen yönetici daveti iptal edildi.')
    })
  }
  const executeAdminStatusChange = async (targetAdmin: ClinicAdmin, nextActive: boolean) => {
    if (!selected) return
    await run(async () => {
      await api(`/api/platform/clinics/${selected}/admins/${targetAdmin.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: nextActive }),
      })
      setConfirmFreezeAdmin(null)
      await loadClinicAdmins(selected)
      setNotice(nextActive ? `"${targetAdmin.name}" yönetici hesabı yeniden aktifleştirildi.` : `"${targetAdmin.name}" yönetici hesabı donduruldu ve oturumları kapatıldı.`)
    })
  }
  const updateSelectedBusiness = (e: FormEvent) => {
    e.preventDefault()
    if (!selected) return
    void run(async () => {
      const updated = await api<Clinic>(`/api/platform/clinics/${selected}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editBusinessName.trim(),
          businessTemplate: editBusinessTemplate,
        }),
      })
      setClinics(prev => prev.map(item => (item.id === updated.id ? updated : item)))
      setEditBusinessName(updated.name)
      setEditBusinessTemplate(updated.businessTemplate === 'dental_clinic' ? 'dental_clinic' : 'general')
      setNotice('İşletme bilgileri ve şablonu güncellendi.')
    })
  }
  const addDomainToSelected = (e: FormEvent) => {
    e.preventDefault()
    if (!selected || !newDomainHost.trim()) return
    void run(async () => {
      const updated = await api<Clinic>(`/api/platform/clinics/${selected}/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostname: newDomainHost.trim().toLowerCase(),
          isPrimary: makePrimaryDomain,
        }),
      })
      setClinics(prev => prev.map(item => (item.id === updated.id ? updated : item)))
      setNewDomainHost('')
      setMakePrimaryDomain(false)
      setNotice('Alan adı işletmeye bağlandı.')
    })
  }
  const removeDomainFromSelected = (domainHost: string) => {
    if (!selected) return
    void run(async () => {
      const updated = await api<Clinic>(`/api/platform/clinics/${selected}/domains/${encodeURIComponent(domainHost)}`, {
        method: 'DELETE',
      })
      setClinics(prev => prev.map(item => (item.id === updated.id ? updated : item)))
      setNotice(`"${domainHost}" alan adı işletmeden kaldırıldı.`)
    })
  }
  const create = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const payload: Record<string, unknown> = {
        name,
        hostname: host,
        timezone: zone,
        businessTemplate,
      }
      if (sourceClinicId) payload.sourceClinicId = sourceClinicId
      const c = await api<Clinic>('/api/platform/clinics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setClinics(v => [c, ...v])
      setName('')
      setHost('')
      setHostTouched(false)
      setBusinessTemplate('general')
      setSourceClinicId('')
      setSelected(c.id)
      setEditBusinessName(c.name)
      setEditBusinessTemplate(c.businessTemplate === 'dental_clinic' ? 'dental_clinic' : 'general')
      setNotice('İşletme oluşturuldu.')
    })
  }
  const clinic = clinics.find(c => c.id === selected); const phoneSaved = Boolean(ints?.phone.config?.hasPassword), smsSaved = Boolean(ints?.sms.config?.hasPassword), smtpSaved = Boolean(ints?.smtp.config?.hasPassword); const inbound = ints && current(ints.phone, 'inbound'), outbound = ints && current(ints.phone, 'outbound'), transfer = ints && current(ints.phone, 'transfer'); const phoneValid = Boolean(phone.username && (phone.password || phoneSaved) && phone.numbers.length && phone.numbers.every(validPhone) && validPhone(phone.callerId) && phone.numbers.some(n => national(n) === national(phone.callerId)) && (!phone.transferNumber || validPhone(phone.transferNumber)))
  const phoneFailedMsg = [inbound, outbound, transfer].find(t => t?.status === 'failed')?.message || null
  return <div className={styles.page}>
    <section className={styles.card}>
      <h2 className={styles.title}>Yeni İşletme Ekle</h2>
      <p className={styles.description}>
        Ana platform alanı <strong>axamaz.com</strong> üzerinde genel işletmeler veya mevcut klinik şablonuna sahip sağlık işletmeleri tanımlayın; isterseniz mevcut bir kaydın şablonunu ve kategorilerini kopyalayın.
      </p>
      <form className={styles.form} onSubmit={create}>
        <Field label="İşletme adı">
          <input
            required
            placeholder="Örn: Yıldız Kuaför veya Kaya Klinik"
            value={name}
            onChange={e => {
              const val = e.target.value
              setName(val)
              if (!hostTouched) {
                const slug = slugifyHostLabel(val)
                setHost(slug ? `${slug}.axamaz.com` : '')
              }
            }}
          />
        </Field>
        <Field label="Hostname / alan adı" help="Varsayılan: <ad>.axamaz.com veya özel alan adı">
          <input
            required
            placeholder="isletme.axamaz.com"
            value={host}
            onChange={e => {
              setHostTouched(true)
              setHost(e.target.value.toLowerCase())
            }}
          />
        </Field>
        <Field label="İşletme şablonu">
          <select
            value={businessTemplate}
            onChange={e => setBusinessTemplate(e.target.value as 'general' | 'dental_clinic')}
          >
            <option value="general">Genel İşletme (Tüm Sektörler)</option>
            <option value="dental_clinic">Klinik / Sağlık Şablonu (Odontogram, Tedavi, DICOM)</option>
          </select>
        </Field>
        <Field label="Mevcut İşletme/Klinikten Kopyala (Opsiyonel)">
          <select
            value={sourceClinicId}
            onChange={e => {
              const nextId = e.target.value
              setSourceClinicId(nextId)
              const src = clinics.find(item => item.id === nextId)
              if (src?.businessTemplate) {
                setBusinessTemplate(src.businessTemplate === 'dental_clinic' ? 'dental_clinic' : 'general')
              }
            }}
          >
            <option value="">Sıfırdan oluştur (Varsayılan şablon)</option>
            {clinics.map(item => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.businessTemplate === 'dental_clinic' ? 'Klinik' : 'Genel'})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Saat dilimi"><input value={zone} onChange={e => setZone(e.target.value)} /></Field>
        <button className={styles.button} disabled={busy}>İşletmeyi oluştur</button>
      </form>
    </section>
    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <DiagnosticAlert message={error} smtpState={smtp} onQuickFix={patch => { setSmtp(v => ({ ...v, ...patch })); setError(''); setNotice('Önerilen SMTP ayarları forma uygulandı. "1. Bilgileri kaydedin → Kaydet" butonuna basıp tekrar test edin.') }} />}
    <section className={styles.card}>
      <h2 className={styles.title}>İşletmeler</h2>
      <div className={styles.list}>
        {clinics.map(c => {
          const isClinicActive = c.isActive !== false
          const isDental = c.businessTemplate === 'dental_clinic'
          const hostSummary = c.domains && c.domains.length > 0 ? c.domains.join(' · ') : c.hostname
          return (
            <div className={styles.row} key={c.id}>
              <div>
                <strong>{c.name}</strong>
                <small>{hostSummary}</small>
              </div>
              <div className={styles.rowMeta}>
                <span className={styles.badgePlatform}>
                  {isDental ? '🏥 Klinik Şablonu' : '🏢 Genel İşletme'}
                </span>
                {c.planId && (
                  <span className={styles.badgePlatform}>
                    {c.planId === 'pro' ? '★ Pro' : c.planId === 'kurumsal' ? '🏢 Kurumsal' : '⏱ Demo'}
                    {c.maxUsers ? ` · ${c.maxUsers} Kul.` : ''}
                  </span>
                )}
                <span className={isClinicActive ? styles.badgeActive : styles.badgeFrozen}>
                  {isClinicActive ? '● İşletme Aktif' : '❄ İşletme Donduruldu'}
                </span>
              </div>
              <div className={styles.rowActions}>
                {isClinicActive ? (
                  <button
                    type="button"
                    className={styles.removeButton}
                    disabled={busy}
                    onClick={() => setConfirmFreezeClinic(c)}
                  >
                    İşletmeyi Dondur
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={busy}
                    onClick={() => void executeClinicStatusChange(c, true)}
                  >
                    İşletmeyi Aktifleştir
                  </button>
                )}
                <button className={styles.secondaryButton} onClick={() => choose(c.id)}>
                  {selected === c.id ? 'Seçildi' : 'Kurulumu aç'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>

    <section className={styles.card}>
      <div className={styles.setupHeading}>
        <div>
          <h2 className={styles.title}>Paket & Asistan Geçiş Talepleri ({upgradeRequests.length})</h2>
          <p className={styles.description}>
            Demo işletmelerden gelen WhatsApp / Sesli Arama asistan talepleri, Pro paket geçiş başvuruları ve Kurumsal teklif formları.
          </p>
        </div>
        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => void run(loadUpgradeRequests)}
          >
            Talepleri Yenile
          </button>
        </div>
      </div>

      <div className={styles.list}>
        {upgradeRequests.length === 0 ? (
          <div className={styles.empty}>Henüz bekleyen veya kayıtlı bir paket/asistan geçiş talebi bulunmuyor.</div>
        ) : (
          upgradeRequests.map(reqItem => {
            const titleLabel = reqItem.clinicName || reqItem.companyName || 'İşletme Başvurusu'
            const contactSummary = [reqItem.contactName, reqItem.contactEmail, reqItem.contactPhone]
              .filter(Boolean)
              .join(' · ')
            return (
              <div className={styles.row} key={reqItem.id}>
                <div>
                  <strong>{titleLabel}</strong>
                  {contactSummary && <small style={{ display: 'block' }}>{contactSummary}</small>}
                  {reqItem.notes && <small style={{ display: 'block', marginTop: 3 }}>Not: {reqItem.notes}</small>}
                  {reqItem.createdAt && (
                    <small style={{ display: 'block', marginTop: 2 }}>
                      {new Date(reqItem.createdAt).toLocaleString('tr-TR')}
                    </small>
                  )}
                </div>
                <div className={styles.rowMeta}>
                  <span className={styles.badgePlatform}>
                    {UPGRADE_TYPE_TR[reqItem.requestType] || reqItem.requestType}
                  </span>
                  <span
                    className={
                      reqItem.status === 'approved'
                        ? styles.badgeActive
                        : reqItem.status === 'rejected'
                          ? styles.badgeFrozen
                          : styles.badgePlatform
                    }
                  >
                    {UPGRADE_STATUS_TR[reqItem.status] || reqItem.status}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  {reqItem.clinicId && (
                    <button
                      type="button"
                      className={styles.button}
                      disabled={busy}
                      onClick={() => handleUpgradeRequestPatch(reqItem.id, { status: 'approved', applyPlan: 'pro' })}
                    >
                      Onayla ve Pro&apos;ya Geçir
                    </button>
                  )}
                  {reqItem.clinicId && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={busy}
                      onClick={() => handleUpgradeRequestPatch(reqItem.id, { status: 'approved', applyPlan: 'kurumsal' })}
                    >
                      Kurumsal Yap
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={busy}
                    onClick={() => handleUpgradeRequestPatch(reqItem.id, { status: 'contacted' })}
                  >
                    İletişime Geçildi
                  </button>
                  <button
                    type="button"
                    className={styles.removeButton}
                    disabled={busy}
                    onClick={() => handleUpgradeRequestPatch(reqItem.id, { status: 'rejected' })}
                  >
                    Reddet
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>

    {selected && ints && <>
      <section className={styles.card}>
        <div className={styles.setupHeading}>
          <div>
            <h2 className={styles.title}>{clinic?.name} · İşletme Şablonu, Alan Adları & Erişim Kontrolü</h2>
            <p className={styles.description}>
              Ana alan adı: <strong>{clinic?.hostname || '—'}</strong> · İşletme dondurulduğunda o işletmeye bağlı yönetici ve çalışan hesaplarının erişimi askıya alınır ve aktif oturumları kapatılır.
            </p>
          </div>
          <div className={styles.rowActions}>
            <span className={styles.badgePlatform}>
              {clinic?.businessTemplate === 'dental_clinic' ? '🏥 Klinik Şablonu' : '🏢 Genel İşletme'}
            </span>
            <span className={clinic?.isActive !== false ? styles.badgeActive : styles.badgeFrozen}>
              {clinic?.isActive !== false ? '● İşletme Aktif' : '❄ İşletme Donduruldu'}
            </span>
            {clinic && (clinic.isActive !== false ? (
              <button
                type="button"
                className={styles.removeButton}
                disabled={busy}
                onClick={() => setConfirmFreezeClinic(clinic)}
              >
                İşletmeyi Dondur
              </button>
            ) : (
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() => void executeClinicStatusChange(clinic, true)}
              >
                İşletmeyi Aktifleştir
              </button>
            ))}
          </div>
        </div>

        <form className={styles.form} style={{ marginTop: 14 }} onSubmit={updateSelectedBusiness}>
          <Field label="İşletme Adı">
            <input
              required
              value={editBusinessName}
              onChange={e => setEditBusinessName(e.target.value)}
            />
          </Field>
          <Field label="Aktif Şablon">
            <select
              value={editBusinessTemplate}
              onChange={e => setEditBusinessTemplate(e.target.value as 'general' | 'dental_clinic')}
            >
              <option value="general">Genel İşletme (Tüm Sektörler)</option>
              <option value="dental_clinic">Klinik / Sağlık Şablonu (Odontogram, Tedavi, DICOM)</option>
            </select>
          </Field>
          <button type="submit" className={styles.button} disabled={busy}>
            Bilgileri ve Şablonu Kaydet
          </button>
        </form>

        <div className={styles.adminSubSection}>
          <h3 className={styles.subTitle}>Bağlı Alan Adları ({clinic?.domains?.length || (clinic?.hostname ? 1 : 0)})</h3>
          <div className={styles.list}>
            {(clinic?.domains && clinic.domains.length > 0 ? clinic.domains : (clinic?.hostname ? [clinic.hostname] : [])).map(domainHost => {
              const isPrimary = domainHost === clinic?.hostname
              const canRemove = !isPrimary && (clinic?.domains?.length || 1) > 1
              return (
                <div className={styles.row} key={domainHost}>
                  <div>
                    <strong className={styles.domain}>{domainHost}</strong>
                    <small>{isPrimary ? 'Ana alan adı' : 'Ek alan adı'}</small>
                  </div>
                  <div className={styles.rowMeta}>
                    <span className={isPrimary ? styles.badgeActive : styles.badgePlatform}>
                      {isPrimary ? '★ Birincil' : 'Yönlendirme'}
                    </span>
                  </div>
                  <div className={styles.rowActions}>
                    {canRemove && (
                      <button
                        type="button"
                        className={styles.removeButton}
                        disabled={busy}
                        onClick={() => removeDomainFromSelected(domainHost)}
                      >
                        Kaldır
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <form className={styles.form} style={{ marginTop: 12 }} onSubmit={addDomainToSelected}>
            <Field label="Yeni alan adı ekle" help="Örn: firma.axamaz.com veya firma.com">
              <input
                required
                placeholder="yeni-sub.axamaz.com"
                value={newDomainHost}
                onChange={e => setNewDomainHost(e.target.value.toLowerCase())}
              />
            </Field>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 42, fontSize: 13, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={makePrimaryDomain}
                onChange={e => setMakePrimaryDomain(e.target.checked)}
              />
              Ana alan adı yap
            </label>
            <button type="submit" className={styles.secondaryButton} disabled={busy || !newDomainHost.trim()}>
              Alan Adı Ekle
            </button>
          </form>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.title}>{clinic?.name} · İşletme Yöneticisi (Seed User) Atama & E-posta Daveti</h2>
        <p className={styles.description}>
          Bu alanda yalnızca ilgili işletmenin <strong>Yönetici (Seed User)</strong> hesabı atanabilir, e-posta ile davet gönderilebilir veya mevcut yönetici hesabı dondurulabilir. Diğer çalışanlar işletme içindeki Ekip / Kullanıcılar sekmesinden yönetilir.
        </p>

        <div className={styles.modeTabs} role="tablist" aria-label="Yönetici atama yöntemi">
          <button
            type="button"
            role="tab"
            aria-selected={adminMode === 'seed'}
            className={`${styles.modeTab} ${adminMode === 'seed' ? styles.modeTabActive : ''}`}
            onClick={() => setAdminMode('seed')}
          >
            Seed User (Yönetici) Ata
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={adminMode === 'invite'}
            className={`${styles.modeTab} ${adminMode === 'invite' ? styles.modeTabActive : ''}`}
            onClick={() => setAdminMode('invite')}
          >
            E-posta ile Yönetici Daveti Gönder
          </button>
        </div>

        {adminMode === 'invite' && !adminSmtp.ready && (
          <div className={styles.hintBanner} style={{ marginBottom: 14 }}>
            <span>
              ⚠️ <strong>Bilgi:</strong> {adminSmtp.message || 'Bu işletme için E-posta / SMTP kurulumu henüz etkinleştirilmemiş.'} E-posta daveti göndermek için aşağıdaki <strong>E-posta / SMTP</strong> bölümünü etkinleştirin veya doğrudan <strong>Seed User (Yönetici) Ata</strong> sekmesini kullanın.
            </span>
          </div>
        )}

        <form className={styles.form} onSubmit={submitClinicAdminForm}>
          <Field label="Yönetici Ad Soyad">
            <input
              required
              placeholder="Örn: Ahmet Yılmaz"
              value={adminForm.name}
              onChange={e => setAdminForm(v => ({ ...v, name: e.target.value }))}
            />
          </Field>
          <Field label="Yönetici E-posta">
            <input
              type="email"
              required
              placeholder="yonetici@axamaz.com"
              value={adminForm.email}
              onChange={e => setAdminForm(v => ({ ...v, email: e.target.value.toLowerCase() }))}
            />
          </Field>
          {adminMode === 'seed' && (
            <>
              <Field label="Başlangıç Şifresi" help="En az 6 karakter">
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="En az 6 karakter"
                  value={adminForm.password}
                  onChange={e => setAdminForm(v => ({ ...v, password: e.target.value }))}
                />
              </Field>
              <Field label="Telefon (Opsiyonel)">
                <PhoneInput
                  value={adminForm.phone}
                  onChange={phoneVal => setAdminForm(v => ({ ...v, phone: phoneVal }))}
                />
              </Field>
            </>
          )}
          <Field label="Atanacak Rol">
            <input value="Yönetici (Seed User)" disabled />
          </Field>
          <button
            type="submit"
            className={styles.button}
            disabled={busy || (adminMode === 'invite' && !adminSmtp.ready)}
          >
            {adminMode === 'seed' ? 'Seed Yönetici Ata' : 'E-posta ile Davet Gönder'}
          </button>
        </form>

        {adminInvites.length > 0 && (
          <div className={styles.adminSubSection}>
            <h3 className={styles.subTitle}>Bekleyen Yönetici E-posta Davetleri ({adminInvites.length})</h3>
            <div className={styles.list}>
              {adminInvites.map(inv => (
                <div className={styles.row} key={inv.id}>
                  <div>
                    <strong>{inv.name}</strong>
                    <small>{inv.email}</small>
                  </div>
                  <div className={styles.rowMeta}>
                    <span className={styles.badgePlatform}>Yönetici Daveti · Onay Bekliyor</span>
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.removeButton}
                      disabled={busy}
                      onClick={() => revokeAdminInvitation(inv.id)}
                    >
                      Daveti İptal Et
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={styles.adminSubSection}>
          <h3 className={styles.subTitle}>İşletme Yöneticileri ({clinicAdmins.length})</h3>
          <div className={styles.list}>
            {clinicAdmins.map(adm => (
              <div className={styles.row} key={adm.id}>
                <div>
                  <strong>{adm.name}</strong>
                  <small>{adm.email}{adm.phone ? ` · ${adm.phone}` : ''}</small>
                </div>
                <div className={styles.rowMeta}>
                  <span className={styles.badgePlatform}>
                    {adm.isPlatformAdmin ? 'Satışçı / Platform Hesabı' : 'İşletme Yöneticisi'}
                  </span>
                  <span className={adm.active ? styles.badgeActive : styles.badgeFrozen}>
                    {adm.active ? '● Aktif' : '❄ Donduruldu'}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  {adm.isPlatformAdmin ? (
                    <small>Satışçı ana hesabı (korumalı)</small>
                  ) : adm.active ? (
                    <button
                      type="button"
                      className={styles.removeButton}
                      disabled={busy}
                      onClick={() => setConfirmFreezeAdmin(adm)}
                    >
                      Yöneticiyi Dondur
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.button}
                      disabled={busy}
                      onClick={() => void executeAdminStatusChange(adm, true)}
                    >
                      Yöneticiyi Aktifleştir
                    </button>
                  )}
                </div>
              </div>
            ))}
            {clinicAdmins.length === 0 && (
              <div className={styles.empty}>Bu işletme için henüz atanmış bir yönetici bulunmuyor.</div>
            )}
          </div>
        </div>
      </section>
      <section className={styles.card}><h2 className={styles.title}>{clinic?.name} · Netgsm telefon</h2><p className={styles.description}>Netgsm paneline: {ints.connection.ip || 'IP yapılandırılmamış'} · {ints.connection.port} · {ints.connection.protocol}</p><div className={styles.setupGrid}><Field label="SIP kullanıcı adı"><input value={phone.username} onChange={e => setPhone(v => ({ ...v, username: e.target.value }))} /></Field><Field label="SIP parolası" help={phoneSaved ? 'Parola kayıtlıdır. Değiştirmek istemiyorsanız boş bırakın.' : 'Netgsm SIP parolasını girin.'}><input type="password" autoComplete="new-password" placeholder={phoneSaved ? 'Parola kayıtlı — değiştirmek için yazın' : 'SIP parolası'} value={phone.password} onChange={e => setPhone(v => ({ ...v, password: e.target.value }))} /></Field><Field label="Gelen numaralar" help="0850 sabit hat veya mobil numara girin. Örnek: +90 (850) 309 61 19."><PhoneList values={phone.numbers} canRemoveLast={ints.phone.configured} onRemoveLast={() => void run(() => removeIntegration('phone'))} onChange={numbers => setPhone(v => { const nextCaller = numbers.some(n => national(n) === national(v.callerId)) ? v.callerId : (numbers.find(Boolean) || ''); return { ...v, numbers, callerId: nextCaller } })} /></Field><Field label="Çıkış numarası" help="Gelen numaralardan biri olmalı; arayanlarda görünecek işletme hattıdır."><PhoneInput value={phone.callerId} onChange={callerId => setPhone(v => ({ ...v, callerId }))} /></Field><Field label="Aktarım numarası" help="Flow Builder hedefiyle aynı olmalı; 0850 veya mobil numara olabilir, zorunlu değildir."><PhoneInput value={phone.transferNumber} onChange={transferNumber => setPhone(v => ({ ...v, transferNumber }))} /></Field><Field label="Test numarası" help="Test araması yapılacak cep veya sabit telefon numarasını girin (+90 5XX... önerilir)."><PhoneInput value={phone.target} onChange={target => setPhone(v => ({ ...v, target }))} /></Field></div>{phoneFailedMsg && <DiagnosticAlert message={phoneFailedMsg} service="phone" />}<div className={styles.steps}><Step complete={ints.phone.configured} alwaysShowAction title="1. Bilgileri kaydedin" detail={phoneValid ? 'Ayarlar kaydedildi; değişiklik yaptıysanız tekrar kaydedebilir veya çağrı testini başlatabilirsiniz.' : 'Tüm telefon numaralarını eksiksiz girin.'} action={ints.phone.configured ? 'Güncelle / Kaydet' : 'Kaydet'} disabled={busy || !phoneValid} onClick={() => void run(() => save('phone', { ...phone, numbers: phone.numbers.map(e164), callerId: e164(phone.callerId), transferNumber: phone.transferNumber ? e164(phone.transferNumber) : '' }))} /><Step complete={Boolean(inbound?.status === 'confirmed')} title="2. Gelen çağrıyı test edin" detail={inbound?.status === 'accepted' ? '15 dakika içinde test telefonundan işletme hattını arayın. Bağlantı otomatik doğrulanır.' : 'Gelen çağrı testini başlatıp işletme hattını arayın.'} action={inbound?.status === 'accepted' ? 'Bağlantı bekleniyor' : 'Gelen çağrı testi başlat'} disabled={busy || inbound?.status === 'accepted' || !ints.phone.configured || !validPhone(phone.target)} onClick={() => void run(() => test('phone', phone.target, 'inbound'))} /><Step complete={Boolean(outbound?.status === 'confirmed')} title="3. Giden çağrıyı test edin" detail={outbound?.status === 'accepted' ? 'Telefonunuz çaldığında açın. Bağlantı otomatik doğrulanır.' : 'İşletme hattından test numarasına giden aramayı başlatın.'} action={outbound?.status === 'accepted' ? 'Bağlantı bekleniyor' : 'Giden çağrı testi başlat'} disabled={busy || outbound?.status === 'accepted' || !ints.phone.configured || !validPhone(phone.target)} onClick={() => void run(() => test('phone', phone.target, 'outbound'))} />{phone.transferNumber && <Step complete={Boolean(transfer?.status === 'confirmed')} title="4. Aktarımı test edin" detail={transfer?.status === 'accepted' ? 'Aktarım hedefi cevapladığında bağlantı otomatik doğrulanır.' : 'Canlı aktarım testini başlatın.'} action={transfer?.status === 'accepted' ? 'Bağlantı bekleniyor' : 'Aktarım testi başlat'} disabled={busy || transfer?.status === 'accepted' || !ints.phone.configured || !validPhone(phone.target)} onClick={() => void run(() => test('phone', phone.target, 'transfer'))} />}<Step complete={ints.phone.enabled} title="5. Telefonu etkinleştirin" detail={ints.phone.health === 'registered' ? 'SIP kaydı aktif; hattı canlı kullanıma açabilirsiniz.' : 'SIP kaydı veya test doğrulandıktan sonra canlı kullanımı açın.'} action="Etkinleştir" disabled={busy || ints.phone.enabled || !ints.phone.configured || (ints.phone.health !== 'registered' && !done(ints.phone, 'inbound') && !done(ints.phone, 'outbound'))} onClick={() => void run(() => toggle('phone'))} /></div>{ints.phone.configured && <div className={styles.actions}>{ints.phone.enabled && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void run(() => toggle('phone'))}>Hattı devre dışı bırak</button>}<button type="button" className={styles.removeButton} disabled={busy} onClick={() => void run(() => removeIntegration('phone'))}>Telefon bağlantısını kaldır (Numarayı boşa çıkar)</button></div>}</section>
      {(['sms', 'smtp'] as const).map(service => { const s = ints[service], delivery = current(s, 'delivery'), isSms = service === 'sms', configured = isSms ? Boolean(sms.username && (sms.password || smsSaved) && sms.senderId) : Boolean(smtp.host && smtp.port && smtp.username && (smtp.password || smtpSaved) && (smtp.fromAddress || smtp.username)), target = isSms ? sms.target : smtp.target; const showNatroHint = !isSms && (smtp.host.toLowerCase().includes('axamaz.com') || smtp.host.toLowerCase().includes('thinpine.com') || (smtp.host.toLowerCase().includes('natro') && smtp.port === '587')); return <section className={styles.card} key={service}><h2 className={styles.title}>{isSms ? 'SMS / Netgsm' : 'E-posta / SMTP'}</h2><div className={styles.setupGrid}>{isSms ? <><Field label="API kullanıcı kodu"><input value={sms.username} onChange={e => setSms(v => ({ ...v, username: e.target.value }))} /></Field><Field label="API parolası" help={smsSaved ? 'Parola kayıtlıdır. Değiştirmek istemiyorsanız boş bırakın.' : undefined}><input type="password" autoComplete="new-password" placeholder={smsSaved ? 'Parola kayıtlı — değiştirmek için yazın' : 'API parolası'} value={sms.password} onChange={e => setSms(v => ({ ...v, password: e.target.value }))} /></Field><Field label="Başlık"><input value={sms.senderId} onChange={e => setSms(v => ({ ...v, senderId: e.target.value }))} /></Field><Field label="Test alıcısı" help="Teslimatı doğrulamak için kendi cep telefonunuzu +90 (5__) ___ __ __ biçiminde girin."><PhoneInput value={sms.target} onChange={target => setSms(v => ({ ...v, target }))} /></Field></> : <><Field label="Sunucu" help="Natro için mx-out03.natrohost.com önerilir."><input value={smtp.host} onChange={e => setSmtp(v => ({ ...v, host: e.target.value }))} /></Field><Field label="Port" help="SSL için 465 (Önerilen), STARTTLS için 587."><input inputMode="numeric" value={smtp.port} onChange={e => { const port = e.target.value; setSmtp(v => ({ ...v, port, secure: port.trim() === '465' ? 'ssl' : 'tls' })) }} /></Field><Field label="Kullanıcı"><input value={smtp.username} onChange={e => setSmtp(v => ({ ...v, username: e.target.value, fromAddress: v.fromAddress || e.target.value }))} /></Field><Field label="Parola" help={smtpSaved ? 'Parola kayıtlıdır. Değiştirmek istemiyorsanız boş bırakın.' : undefined}><input type="password" autoComplete="new-password" placeholder={smtpSaved ? 'Parola kayıtlı — değiştirmek için yazın' : 'SMTP parolası'} value={smtp.password} onChange={e => setSmtp(v => ({ ...v, password: e.target.value }))} /></Field><Field label="Gönderici adı"><input value={smtp.fromName} onChange={e => setSmtp(v => ({ ...v, fromName: e.target.value }))} /></Field><Field label="Gönderici e-posta"><input type="email" value={smtp.fromAddress} onChange={e => setSmtp(v => ({ ...v, fromAddress: e.target.value }))} /></Field><Field label="Test alıcısı"><input type="email" value={smtp.target} onChange={e => setSmtp(v => ({ ...v, target: e.target.value }))} /></Field></>}</div>{showNatroHint && <div className={styles.hintBanner}><span>💡 <strong>Natro Kurumsal E-posta İpucu:</strong> <code>mail.*</code> ve Port <code>587</code> paylaşımlı SSL/zaman aşımı nedeniyle takılabilir. Natro giden sunucusu <code>mx-out03.natrohost.com</code> ve Port <code>465 (SSL)</code> ile doğrudan çalışır.</span><button type="button" className={styles.quickFixButton} onClick={() => setSmtp(v => ({ ...v, host: 'mx-out03.natrohost.com', port: '465', secure: 'ssl', fromAddress: v.fromAddress || v.username }))}>⚡ Önerilen Ayarı Uygula (mx-out03.natrohost.com : 465)</button></div>}{delivery?.status === 'failed' && delivery.message && <DiagnosticAlert message={delivery.message} service={service} smtpState={!isSms ? smtp : undefined} onQuickFix={!isSms ? patch => { setSmtp(v => ({ ...v, ...patch })); setNotice('Önerilen SMTP ayarları forma uygulandı. "1. Bilgileri kaydedin → Kaydet" butonuna basıp tekrar test edin.') } : undefined} />}<div className={styles.steps}><Step complete={s.configured} alwaysShowAction title="1. Bilgileri kaydedin" detail="Bağlantı bilgilerini kaydedin veya güncelleyin." action={s.configured ? 'Güncelle / Kaydet' : 'Kaydet'} disabled={busy || !configured} onClick={() => void run(() => save(service, isSms ? sms : { ...smtp, port: Number(smtp.port), secure: Number(smtp.port) === 465 ? 'ssl' : 'tls', fromAddress: smtp.fromAddress || smtp.username }))} /><Step complete={Boolean(delivery?.status === 'confirmed')} title="2. Test gönderin ve doğrulayın" detail={delivery?.status === 'accepted' ? 'Mesajı/e-postayı aldıktan sonra doğrulayın.' : (delivery?.status === 'failed' ? 'Son test başarısız oldu; yukarıdaki çözüm önerisini inceleyip tekrar deneyin.' : 'Kaydedilen bilgilerle test gönderin.')} action={delivery?.status === 'accepted' ? 'Teslimatı doğrula' : 'Test gönder'} disabled={busy || !s.configured || (delivery?.status !== 'accepted' && (isSms ? !validMobile(target) : !/^\S+@\S+\.\S+$/.test(target)))} onClick={() => void run(() => delivery?.status === 'accepted' ? confirm(service, delivery.id) : test(service, target))} onCancel={delivery?.status === 'accepted' ? () => void run(() => cancelActiveTest(service, delivery.id)) : undefined} /><Step complete={s.enabled} title="3. Etkinleştirin" detail="Doğrulanan bağlantıyı canlı kullanıma açın." action="Etkinleştir" disabled={busy || s.enabled || !done(s, 'delivery')} onClick={() => void run(() => toggle(service))} /></div></section> })}
      <section className={styles.card}>
        <div className={styles.setupHeading}>
          <div>
            <h2 className={styles.title}>{clinic?.name} · WhatsApp Kurulumu</h2>
            <p className={styles.description}>
              İşletme telefon numarasını kaydedip karekod (QR) oluşturun; okutulduktan sonra gönderimleri etkinleştirin.
            </p>
          </div>
          <div className={styles.rowActions}>
            <span className={wa?.connectionState === 'open' ? styles.badgeActive : wa?.connectionState === 'connecting' ? styles.badgePlatform : styles.badgeFrozen}>
              {wa?.connectionState === 'open'
                ? (wa?.enabled ? '● Bağlı ve Gönderimler Aktif' : '● QR Bağlı (Etkinleştirme Bekliyor)')
                : wa?.connectionState === 'connecting'
                  ? '● Bağlanıyor…'
                  : '○ Bağlı Değil'}
            </span>
          </div>
        </div>
        <Field label="İşletme WhatsApp telefonu" help="WhatsApp hesabına bağlı cep telefonu: +90 (5__) ___ __ __. Boş bırakılırsa QR okutulduğunda bağlanan numara otomatik alınır.">
          <PhoneInput value={waPhone} onChange={setWaPhone} />
        </Field>
        <div className={styles.actions}>
          <button
            className={styles.button}
            disabled={busy || !validMobile(waPhone)}
            onClick={() => void run(async () => {
              if (!selected) return
              setWa(await api<Wa>(`/api/platform/clinics/${selected}/whatsapp`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expectedPhone: e164(waPhone) }),
              }))
              setNotice('Telefon kaydedildi. Şimdi "QR göster" butonuna basabilirsiniz.')
            })}
          >
            Telefonu kaydet
          </button>
          <button
            className={styles.button}
            disabled={busy}
            onClick={() => void run(async () => {
              if (!selected) return
              if (validMobile(waPhone) && e164(waPhone) !== wa?.expectedPhone) {
                const savedWa = await api<Wa>(`/api/platform/clinics/${selected}/whatsapp`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ expectedPhone: e164(waPhone) }),
                })
                setWa(savedWa)
              }
              const r = await api<{ clinic?: Wa; qrcode: string | null; connectionState?: string }>(
                `/api/platform/clinics/${selected}/whatsapp/connect`,
                { method: 'POST' },
              )
              if (r.clinic) setWa(r.clinic)
              setQr(r.qrcode)
              if (r.connectionState === 'open') {
                setNotice('WhatsApp zaten bağlı. Gönderimleri etkinleştirebilirsiniz.')
              } else if (r.qrcode) {
                setNotice('WhatsApp karekodu hazır. İşletme telefonundan okutun.')
              } else {
                setNotice('Bağlantı isteği gönderildi; durum kontrol ediliyor.')
              }
            })}
          >
            {qr ? 'QR yenile' : 'QR göster'}
          </button>
          <button
            className={styles.button}
            disabled={busy || wa?.connectionState !== 'open'}
            onClick={() => void run(async () => {
              if (!selected) return
              setWa(await api<Wa>(`/api/platform/clinics/${selected}/whatsapp/activate`, { method: 'POST' }))
              setNotice('WhatsApp etkinleştirildi.')
            })}
          >
            Gönderimleri etkinleştir
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => void run(async () => {
              if (!selected) return
              const refreshed = await api<Wa>(`/api/platform/clinics/${selected}/whatsapp`)
              setWa(refreshed)
              if (refreshed.expectedPhone) setWaPhone(national(refreshed.expectedPhone))
              if (refreshed.connectionState === 'open') setQr(null)
              setNotice('WhatsApp bağlantı durumu güncellendi.')
            })}
          >
            Durumu yenile
          </button>
          {Boolean(wa?.expectedPhone || waPhone) && (
            <button
              type="button"
              className={styles.removeButton}
              disabled={busy}
              onClick={() => void run(async () => {
                if (!selected) return
                setWa(await api<Wa>(`/api/platform/clinics/${selected}/whatsapp`, { method: 'DELETE' }))
                setWaPhone('')
                setQr(null)
                setNotice('İşletme WhatsApp numarası silindi.')
              })}
            >
              Numarayı sil
            </button>
          )}
        </div>
        {qr && (
          <div className={styles.qr}>
            <img src={qr} width={240} height={240} alt="WhatsApp QR" />
          </div>
        )}
      </section>
      <N8nMetaWhatsAppCard clinicId={selected} />

      <section className={styles.card}>
        <div className={styles.setupHeading}>
          <div>
            <h2 className={styles.title}>{clinic?.name} · Paket ve Abonelik Yönetimi (Satış Ekibi)</h2>
            <p className={styles.description}>
              İşletmenin aktif paketini (Demo, Pro, Kurumsal), abonelik durumunu, maksimum kullanıcı sayısını ve deneme süresini buradan yönetin.
            </p>
          </div>
          {clinic?.trialEndsAt && (
            <div className={styles.rowActions}>
              <span className={styles.badgePlatform}>
                Deneme Bitiş: {new Date(clinic.trialEndsAt).toLocaleDateString('tr-TR')}
              </span>
            </div>
          )}
        </div>

        <div className={styles.form}>
          <Field label="Paket Türü">
            <select
              value={planForm.planId}
              onChange={e => {
                const nextPlan = e.target.value as 'demo' | 'pro' | 'kurumsal'
                const suggestedMax = nextPlan === 'pro' ? '10' : nextPlan === 'kurumsal' ? '50' : '2'
                setPlanForm(prev => ({
                  ...prev,
                  planId: nextPlan,
                  planStatus: nextPlan === 'demo' ? 'trial' : 'active',
                  maxUsers: suggestedMax,
                }))
              }}
            >
              <option value="demo">Demo Paket (7 Gün · 2 Yönetici)</option>
              <option value="pro">Pro Paket (7.000 ₺ + KDV · 10 Kullanıcı)</option>
              <option value="kurumsal">Kurumsal Paket (Özel Limit & SLA)</option>
            </select>
          </Field>

          <Field label="Abonelik Durumu">
            <select
              value={planForm.planStatus}
              onChange={e => setPlanForm(prev => ({ ...prev, planStatus: e.target.value as 'trial' | 'active' | 'expired' | 'canceled' }))}
            >
              <option value="trial">Deneme Süresi</option>
              <option value="active">Aktif</option>
              <option value="expired">Süresi Doldu</option>
              <option value="canceled">İptal Edildi</option>
            </select>
          </Field>

          <Field label="Maksimum Kullanıcı Sayısı">
            <input
              type="number"
              min={1}
              max={500}
              value={planForm.maxUsers}
              onChange={e => setPlanForm(prev => ({ ...prev, maxUsers: e.target.value }))}
            />
          </Field>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() =>
              updateSelectedClinicPlan({
                planId: planForm.planId,
                planStatus: planForm.planStatus,
                maxUsers: Math.max(1, Number(planForm.maxUsers) || 2),
              })
            }
          >
            Paket ve Limitleri Kaydet
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => updateSelectedClinicPlan({ extendTrialDays: 7 })}
          >
            +7 Gün Deneme Uzat
          </button>
        </div>

        <div className={styles.hintBanner} style={{ marginTop: 14 }}>
          <span>
            💡 <strong>Bilgi:</strong> İşletmeye özel Gemini API anahtarını hemen aşağıdaki <strong>Yapay Zeka API Anahtarı</strong> kartından tanımlayabilir, doğrulayabilir veya güncelleyebilirsiniz.
          </span>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.setupHeading}>
          <div>
            <h2 className={styles.title}>{clinic?.name} · Yapay Zeka API Anahtarı</h2>
            <p className={styles.description}>
              Her işletme kendine ait ayrı bir anahtar kullanmalıdır (1 anahtar = 1 işletme). Tanımlandığında sesli asistan, yazışma asistanı ve bilgi bankası işlemleri bu anahtarla çalışır; tanımlanmazsa ortak yedek anahtar kullanılır.
            </p>
          </div>
          <div className={styles.rowActions}>
            <span className={geminiKey?.source === 'clinic' ? styles.badgeActive : geminiKey?.source === 'shared' ? styles.badgePlatform : styles.badgeFrozen}>
              {geminiKey?.source === 'clinic'
                ? `● İşletmeye Özel Anahtar (••••${geminiKey.last4 || ''})`
                : geminiKey?.source === 'shared'
                ? '● Ortak Platform Anahtarı'
                : '⚠ Anahtar Tanımlı Değil'}
            </span>
          </div>
        </div>
        {geminiKey?.conflict && <div className={styles.error}>Bu anahtar başka bir işletmeyle çakışıyor, lütfen yeni anahtar tanımlayın.</div>}
        <Field
          label="Yapay Zeka API Anahtarı"
          help={
            geminiKey?.configured
              ? `Kayıtlı anahtar: ••••${geminiKey.last4 || ''}${geminiKey.updatedAt ? ` · Son güncelleme: ${new Date(geminiKey.updatedAt).toLocaleString('tr-TR')}` : ''}. Değiştirmek istemiyorsanız boş bırakabilirsiniz.`
              : 'Yapay zeka hizmet sağlayıcısından alınan API anahtarını girin.'
          }
        >
          <input
            type="password"
            autoComplete="new-password"
            placeholder={geminiKey?.configured ? `Kayıtlı (••••${geminiKey.last4 || ''}) — değiştirmek için yeni anahtar yazın` : 'AIzaSy...'}
            value={geminiKeyInput}
            onChange={e => setGeminiKeyInput(e.target.value)}
          />
        </Field>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={busy || geminiKeyInput.trim().length < 20}
            onClick={() => void run(async () => {
              if (!selected) return
              const saved = await api<{ ok: boolean; configured: boolean; source: 'clinic'; last4: string | null; updatedAt: string | null }>(`/api/platform/clinics/${selected}/gemini-key`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: geminiKeyInput.trim() }),
              })
              setGeminiKey({ configured: saved.configured, source: saved.source, last4: saved.last4, updatedAt: saved.updatedAt })
              setGeminiKeyInput('')
              setNotice('İşletmeye özel API anahtarı doğrulandı ve kaydedildi.')
            })}
          >
            Anahtarı doğrula ve kaydet
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy || (!geminiKeyInput.trim() && !geminiKey?.configured && geminiKey?.source === 'missing')}
            onClick={() => void run(async () => {
              if (!selected) return
              const res = await api<{ ok: boolean; latencyMs: number; source: 'clinic' | 'shared' | 'input' }>(`/api/platform/clinics/${selected}/gemini-key/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(geminiKeyInput.trim() ? { apiKey: geminiKeyInput.trim() } : {}),
              })
              setNotice(`API anahtarı testi başarılı (${res.latencyMs} ms).`)
            })}
          >
            Anahtarı test et
          </button>
          {geminiKey?.configured && (
            <button
              type="button"
              className={styles.removeButton}
              disabled={busy}
              onClick={() => setConfirmRemoveKey(true)}
            >
              Özel anahtarı kaldır
            </button>
          )}
        </div>
      </section>
    </>}
    <PlatformSystemPrompts clinics={clinics} />
    {confirmRemoveKey && (
      <ConfirmModal
        isOpen={true}
        title="Özel Anahtarı Kaldır"
        message="İşletmeye özel anahtar kaldırılacak. Bu işletme, yeni anahtar tanımlanana kadar ortak yedek anahtarla çalışır."
        confirmText="Evet, Kaldır"
        cancelText="Vazgeç"
        variant="warning"
        onConfirm={() => void run(async () => {
          if (!selected) return
          const next = await api<GeminiKeyInfo>(`/api/platform/clinics/${selected}/gemini-key`, { method: 'DELETE' })
          setGeminiKey(next)
          setGeminiKeyInput('')
          setConfirmRemoveKey(false)
          setNotice('İşletmeye özel anahtar kaldırıldı; işletme ortak yedek anahtarla çalışıyor.')
        })}
        onClose={() => setConfirmRemoveKey(false)}
      />
    )}
    {confirmFreezeClinic && (
      <ConfirmModal
        isOpen={true}
        title="İşletmeyi Dondur"
        message={`"${confirmFreezeClinic.name}" (${confirmFreezeClinic.hostname}) işletmesini dondurmak istediğinize emin misiniz? İşletme dondurulduğunda o işletmeye bağlı yönetici ve çalışanların aktif oturumları kapatılır ve işletme tekrar aktifleştirilene kadar sisteme giriş yapamazlar.`}
        confirmText="Evet, İşletmeyi Dondur"
        cancelText="Vazgeç"
        variant="danger"
        onConfirm={() => void executeClinicStatusChange(confirmFreezeClinic, false)}
        onClose={() => setConfirmFreezeClinic(null)}
      />
    )}
    {confirmFreezeAdmin && (
      <ConfirmModal
        isOpen={true}
        title="İşletme Yöneticisini (Seed User) Dondur"
        message={`"${confirmFreezeAdmin.name}" (${confirmFreezeAdmin.email}) yönetici hesabını dondurmak istediğinize emin misiniz? Yöneticinin aktif oturumları derhal sonlandırılır ve tekrar aktifleştirilene kadar panele giriş yapamaz.`}
        confirmText="Evet, Yöneticiyi Dondur"
        cancelText="Vazgeç"
        variant="warning"
        onConfirm={() => void executeAdminStatusChange(confirmFreezeAdmin, false)}
        onClose={() => setConfirmFreezeAdmin(null)}
      />
    )}
  </div>
}
