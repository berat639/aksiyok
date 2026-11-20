'use client'

import React, { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { IMaskInput } from 'react-imask'
import { CheckCircle2, Sparkles, Building2 } from 'lucide-react'
import { ThemeToggle } from '../theme-provider'
import { useAuth } from '@/lib/auth-context'
import { LegalDocumentModal, PaymentTrustFooter, type LegalDocKey } from '@/lib/legal-documents'
import InfoTooltip from '../admin/components/ui/InfoTooltip'
import depth from '@/styles/clinic-depth.module.css'

type SelectedPlan = 'demo' | 'pro' | 'kurumsal'

const PHONE_INTL_MASK = '+{90} (000) 000 00 00'

function extractNational10(raw: string): string {
  let digits = String(raw || '').replace(/\D/g, '')
  if (digits.startsWith('90') && digits.length >= 10) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  return digits.slice(0, 10)
}

function toE164Tr(national10: string): string {
  const n = extractNational10(national10)
  return n ? `+90${n}` : ''
}

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.8-5.4 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z" />
      <path fill="#34A853" d="M3.6 7.4l3.2 2.4C7.7 7.8 9.7 6 12 6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.5 12 2.5 8.3 2.5 5.1 4.6 3.6 7.4z" />
      <path fill="#FBBC05" d="M12 21.5c2.5 0 4.7-.8 6.3-2.3l-2.9-2.4c-.8.6-1.9 1-3.4 1-3.7 0-5.1-2.5-5.4-3.7l-3.2 2.5c1.6 3 4.8 4.9 8.6 4.9z" />
      <path fill="#4285F4" d="M21.1 12.2c0-.6-.1-1.1-.2-1.6H12v3.9h5.4c-.3 1.3-1.1 2.3-2 2.9l2.9 2.4c1.7-1.6 2.8-4 2.8-7.6z" />
    </svg>
  )
}

function KayitContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refreshUser } = useAuth()

  const rawPlan = searchParams.get('plan')
  const initialPlan: SelectedPlan =
    rawPlan === 'pro' || rawPlan === 'kurumsal' ? rawPlan : 'demo'
  const stepParam = searchParams.get('step')
  const errorParam = searchParams.get('error')

  const [plan, setPlan] = useState<SelectedPlan>(initialPlan)
  const [isGoogleOnboarding, setIsGoogleOnboarding] = useState(stepParam === 'complete-google')
  const [step, setStep] = useState<'form' | 'otp'>('form')

  // Signup form fields
  const [name, setName] = useState(searchParams.get('name') || '')
  const [businessName, setBusinessName] = useState('')
  const [phoneNational, setPhoneNational] = useState('')
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [password, setPassword] = useState('')
  const [otpChannel, setOtpChannel] = useState<'sms' | 'email'>('sms')

  // 3 mandatory legal checkboxes
  const [consentSales, setConsentSales] = useState(false)
  const [consentRefund, setConsentRefund] = useState(false)
  const [consentKvkk, setConsentKvkk] = useState(false)
  const [openLegalDoc, setOpenLegalDoc] = useState<LegalDocKey | null>(null)

  // Step 2 OTP state
  const [otpCode, setOtpCode] = useState('')
  const [deliveryChannel, setDeliveryChannel] = useState<'sms' | 'email'>('sms')
  const [devOtpCode, setDevOtpCode] = useState<string | null>(null)

  // Kurumsal lead fields
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [leadNotes, setLeadNotes] = useState('')
  const [leadSubmitted, setLeadSubmitted] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (errorParam === 'google_yapilandirilmamis') {
      setError('Google ile hızlı kayıt şu anda bu ortamda yapılandırılmamış. Formu doldurarak devam edebilirsiniz.')
    } else if (errorParam) {
      setError('Google doğrulaması tamamlanamadı. Lütfen formu doldurarak devam edin.')
    }
  }, [errorParam])

  useEffect(() => {
    if (stepParam !== 'complete-google') return
    setIsGoogleOnboarding(true)
    fetch('/api/auth/google/onboarding', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return
        if (data.pending) {
          if (typeof data.name === 'string' && data.name.trim()) setName(data.name.trim())
          if (typeof data.email === 'string' && data.email.trim()) setEmail(data.email.trim())
          if (data.plan === 'pro' || data.plan === 'demo') setPlan(data.plan)
        }
      })
      .catch(() => {})
  }, [stepParam])

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (phoneNational.length !== 10 || !phoneNational.startsWith('5')) {
      setError('Lütfen geçerli bir cep telefonu numarasını +90 (5XX) XXX XX XX biçiminde girin.')
      return
    }
    if (!isGoogleOnboarding && password.length < 6) {
      setError('Şifreniz en az 6 karakter olmalıdır.')
      return
    }
    if (!consentSales || !consentRefund || !consentKvkk) {
      setError('Devam etmek için 3 yasal bilgilendirme ve sözleşme onay kutusunu işaretlemelisiniz.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/public/signup/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          businessName: businessName.trim(),
          email: email.trim().toLowerCase(),
          phone: toE164Tr(phoneNational),
          channel: otpChannel,
          planId: plan === 'pro' ? 'pro' : 'demo',
          consents: {
            onBilgilendirme: true,
            mesafeliSatis: true,
            iptalIade: true,
            kvkk: true,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Doğrulama kodu gönderilemedi. Lütfen bilgilerinizi kontrol edin.')
        return
      }
      setDeliveryChannel(data.deliveryChannel === 'email' ? 'email' : 'sms')
      setDevOtpCode(typeof data.devOtpCode === 'string' && data.devOtpCode ? data.devOtpCode : null)
      setStep('otp')
    } catch {
      setError('Sunucuya bağlanılamadı. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const cleanCode = otpCode.replace(/\D/g, '').slice(0, 6)
    if (cleanCode.length !== 6) {
      setError('Lütfen 6 haneli doğrulama kodunu eksiksiz girin.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/public/signup/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: toE164Tr(phoneNational),
          email: email.trim().toLowerCase(),
          code: cleanCode,
          ...(isGoogleOnboarding ? {} : { password }),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Doğrulama kodu geçersiz veya süresi dolmuş.')
        return
      }
      await refreshUser()
      const targetUrl =
        typeof data.redirectTo === 'string' && data.redirectTo.trim()
          ? data.redirectTo
          : plan === 'pro'
            ? '/panel?tab=integrations&upgrade=pro'
            : '/panel'
      router.push(targetUrl)
    } catch {
      setError('Doğrulama sırasında bağlantı hatası oluştu.')
    } finally {
      setLoading(false)
    }
  }

  const handleKurumsalSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          contactName: contactName.trim(),
          contactEmail: contactEmail.trim().toLowerCase(),
          contactPhone: contactPhone ? toE164Tr(contactPhone) : undefined,
          notes: leadNotes.trim() || undefined,
          requestType: 'kurumsal_lead',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Kurumsal başvuru iletilemedi. Lütfen tekrar deneyin.')
        return
      }
      setLeadSubmitted(true)
    } catch {
      setError('Sunucuya bağlanılamadı. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '28px 16px',
        background: 'var(--background)',
      }}
    >
      <div
        className={depth.card}
        style={{
          width: '100%',
          maxWidth: 500,
          padding: '24px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: '1.18rem', fontWeight: 800, margin: 0, color: 'var(--foreground)' }}>
              {plan === 'kurumsal' ? 'Kurumsal Paket Başvurusu' : 'İşletme Hesabı Oluştur'}
            </h1>
            <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: 'var(--foreground-2)' }}>
              {plan === 'kurumsal'
                ? 'Çok şubeli yapılar ve özel entegrasyonlar için satış ekibimizle görüşün'
                : 'Dakikalar içinde işletmenizi ve yapay zeka asistanınızı hazırlayın'}
            </p>
          </div>
          <ThemeToggle />
        </div>

        {/* Plan selector */}
        {step === 'form' && (
          <div className={depth.segmentTrack} style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <button
              type="button"
              className={plan === 'demo' ? depth.segmentActive : depth.segment}
              onClick={() => { setPlan('demo'); setError(''); setLeadSubmitted(false) }}
            >
              <span style={{ color: plan === 'demo' ? '#ffffff' : undefined }}>7 Gün Demo</span>
            </button>
            <button
              type="button"
              className={plan === 'pro' ? depth.segmentActive : depth.segment}
              onClick={() => { setPlan('pro'); setError(''); setLeadSubmitted(false) }}
            >
              <span style={{ color: plan === 'pro' ? '#ffffff' : undefined }}>Pro Paket</span>
            </button>
            <button
              type="button"
              className={plan === 'kurumsal' ? depth.segmentActive : depth.segment}
              onClick={() => { setPlan('kurumsal'); setError('') }}
            >
              <span style={{ color: plan === 'kurumsal' ? '#ffffff' : undefined }}>Kurumsal</span>
            </button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--flow-danger-bg)',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              fontSize: '0.8rem',
              fontWeight: 600,
              lineHeight: 1.45,
            }}
          >
            {error}
          </div>
        )}

        {/* KURUMSAL FLOW */}
        {plan === 'kurumsal' ? (
          leadSubmitted ? (
            <div
              className={depth.subcard}
              style={{
                padding: '18px 16px',
                background: 'var(--btn-clinic-mint-bg)',
                borderColor: 'var(--btn-clinic-mint-border)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 10,
              }}
            >
              <CheckCircle2 size={28} color="var(--btn-clinic-mint-fg)" />
              <div style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--foreground)' }}>
                Kurumsal Başvurunuz Alındı
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--foreground-2)', lineHeight: 1.5 }}>
                Satış ve teknik mimari ekibimiz en kısa sürede kurumsal iletişim bilgileriniz üzerinden sizinle irtibata geçecektir.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className={depth.btnPrimary}
                  onClick={() => { setPlan('demo'); setLeadSubmitted(false) }}
                >
                  <span style={{ color: '#ffffff' }}>7 Gün Ücretsiz Demo Deneyin</span>
                </button>
                <Link href="/login" className={depth.btn} style={{ textDecoration: 'none' }}>
                  Giriş Ekranına Dön
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleKurumsalSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                className={depth.subcard}
                style={{
                  background: 'var(--pc-tint)',
                  borderColor: 'var(--pc-border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Building2 size={16} color="var(--pc-tint-fg)" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--pc-tint-fg)' }}>
                  Kurumsal Paket — Satış Ekibiyle İletişime Geç · Özel Santral, Çoklu Şube ve SLA
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--foreground-2)' }}>Kurum Adı *</span>
                  <input
                    className={depth.input}
                    required
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    placeholder="Örn: Anadolu Sağlık Grubu"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--foreground-2)' }}>Ad Soyad *</span>
                  <input
                    className={depth.input}
                    required
                    value={contactName}
                    onChange={e => setContactName(e.target.value)}
                    placeholder="Yetkili Ad Soyad"
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--foreground-2)' }}>Kurumsal E-posta *</span>
                  <input
                    type="email"
                    className={depth.input}
                    required
                    value={contactEmail}
                    onChange={e => setContactEmail(e.target.value)}
                    placeholder="iletisim@kurum.com.tr"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--foreground-2)' }}>Telefon</span>
                  <IMaskInput
                    mask={PHONE_INTL_MASK}
                    unmask={true}
                    value={contactPhone ? `90${contactPhone}` : ''}
                    placeholder="+90 (5XX) XXX XX XX"
                    inputMode="tel"
                    className={depth.input}
                    onAccept={val => setContactPhone(extractNational10(String(val)))}
                  />
                </label>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--foreground-2)' }}>İhtiyaç Özeti</span>
                <textarea
                  className={depth.input}
                  rows={3}
                  value={leadNotes}
                  onChange={e => setLeadNotes(e.target.value)}
                  placeholder="Şube sayısı, kullanıcı adedi, özel santral/CRM entegrasyonu beklentileriniz..."
                  style={{ resize: 'vertical', minHeight: 74 }}
                />
              </label>

              <button
                type="submit"
                disabled={loading}
                className={depth.btnPrimary}
                style={{ width: '100%', minHeight: 42, borderRadius: 10, fontSize: '0.88rem', fontWeight: 700 }}
              >
                <span style={{ color: '#ffffff' }}>
                  {loading ? 'Gönderiliyor...' : 'Satış Ekibiyle Görüşme Talep Et'}
                </span>
              </button>
            </form>
          )
        ) : step === 'form' ? (
          /* DEMO & PRO STEP 1: SIGNUP FORM */
          <>
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 11,
                background: 'var(--pc-tint)',
                border: '1px solid var(--pc-border)',
                boxShadow: 'var(--pc-clay-pale)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={16} color="var(--pc-tint-fg)" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: '0.77rem', fontWeight: 700, color: 'var(--pc-tint-fg)', lineHeight: 1.4 }}>
                  {plan === 'pro'
                    ? 'Pro: 7.000 ₺ + KDV (8.400 ₺ / ay) · 10 Kullanıcı · Tüm Modüller — Önce 7 Gün Ücretsiz Demo ile Başlar'
                    : 'Demo: 7 Gün Ücretsiz · 2 Yönetici · Web Asistanı'}
                </span>
              </div>
              <InfoTooltip title="Paket Detayı">
                Kayıt tamamlandığında kredi kartı gerekmeksizin 7 günlük ücretsiz Demo başlar. Pro paketi seçtiyseniz giriş sonrası dilediğiniz an iyzico 3D Secure ile aboneliğinizi başlatabilirsiniz.
              </InfoTooltip>
            </div>

            {isGoogleOnboarding ? (
              <div
                className={depth.subcard}
                style={{
                  background: 'var(--btn-clinic-mint-bg)',
                  borderColor: 'var(--btn-clinic-mint-border)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: 'var(--btn-clinic-mint-fg)',
                }}
              >
                ✓ Google hesabınız doğrulandı. İşletme adı ve telefon doğrulaması ile kaydı tamamlayın.
              </div>
            ) : (
              <>
                <a
                  href={`/api/auth/google/start?mode=signup&plan=${plan}`}
                  className={depth.btn}
                  style={{
                    width: '100%',
                    minHeight: 40,
                    padding: '9px 14px',
                    borderRadius: 10,
                    textDecoration: 'none',
                    background: 'var(--card-inner)',
                    border: '1.5px solid var(--input-border)',
                    color: 'var(--foreground)',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    gap: 8,
                  }}
                >
                  <GoogleIcon />
                  <span>Google ile Hızlı Devam Et</span>
                </a>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--input-border)' }} />
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--foreground-3)' }}>
                    veya bilgilerinizi girin
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--input-border)' }} />
                </div>
              </>
            )}

            <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--foreground-2)' }}>Ad Soyad *</span>
                  <input
                    className={depth.input}
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Örn: Ayşe Kaya"
                    autoComplete="name"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--foreground-2)' }}>İşletme Adı *</span>
                  <input
                    className={depth.input}
                    required
                    value={businessName}
                    onChange={e => setBusinessName(e.target.value)}
                    placeholder="Örn: Kaya Polikliniği"
                    autoComplete="organization"
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--foreground-2)' }}>Telefon Numarası *</span>
                  <IMaskInput
                    mask={PHONE_INTL_MASK}
                    unmask={true}
                    value={phoneNational ? `90${phoneNational}` : ''}
                    placeholder="+90 (5XX) XXX XX XX"
                    inputMode="tel"
                    autoComplete="tel"
                    className={depth.input}
                    required
                    onAccept={val => setPhoneNational(extractNational10(String(val)))}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--foreground-2)' }}>E-posta Adresi *</span>
                  <input
                    type="email"
                    className={depth.input}
                    required
                    readOnly={isGoogleOnboarding && Boolean(email)}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="yonetici@isletme.com"
                    autoComplete="email"
                    style={isGoogleOnboarding && email ? { opacity: 0.8 } : undefined}
                  />
                </label>
              </div>

              {!isGoogleOnboarding && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                    Şifre * (En az 6 karakter)
                  </span>
                  <input
                    type="password"
                    className={depth.input}
                    required
                    minLength={6}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </label>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                  Doğrulama Kodu Kanalı:
                </span>
                <div className={depth.segmentTrack}>
                  <button
                    type="button"
                    className={otpChannel === 'sms' ? depth.segmentActive : depth.segment}
                    onClick={() => setOtpChannel('sms')}
                    style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                  >
                    <span style={{ color: otpChannel === 'sms' ? '#ffffff' : undefined }}>SMS ile Gönder</span>
                  </button>
                  <button
                    type="button"
                    className={otpChannel === 'email' ? depth.segmentActive : depth.segment}
                    onClick={() => setOtpChannel('email')}
                    style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                  >
                    <span style={{ color: otpChannel === 'email' ? '#ffffff' : undefined }}>E-posta ile Gönder</span>
                  </button>
                </div>
              </div>

              {/* 3 Mandatory Legal Checkboxes */}
              <div
                className={depth.subcard}
                style={{
                  background: 'var(--card-inner)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 9,
                  padding: '12px 14px',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: '0.76rem', lineHeight: 1.45, color: 'var(--foreground-2)' }}>
                  <input
                    type="checkbox"
                    checked={consentSales}
                    onChange={e => setConsentSales(e.target.checked)}
                    style={{ width: 16, height: 16, marginTop: 2, accentColor: '#2563eb', flexShrink: 0 }}
                  />
                  <span>
                    <button
                      type="button"
                      onClick={() => setOpenLegalDoc('sales')}
                      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--pc-tint-fg)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                    >
                      Ön Bilgilendirme Formu & Mesafeli Hizmet Satış Sözleşmesi
                    </button>
                    ’ni okudum ve kabul ediyorum. *
                  </span>
                </label>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: '0.76rem', lineHeight: 1.45, color: 'var(--foreground-2)' }}>
                  <input
                    type="checkbox"
                    checked={consentRefund}
                    onChange={e => setConsentRefund(e.target.checked)}
                    style={{ width: 16, height: 16, marginTop: 2, accentColor: '#2563eb', flexShrink: 0 }}
                  />
                  <span>
                    <button
                      type="button"
                      onClick={() => setOpenLegalDoc('refund')}
                      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--pc-tint-fg)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                    >
                      İptal ve İade Politikası
                    </button>
                    ’nı okudum ve kabul ediyorum. *
                  </span>
                </label>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: '0.76rem', lineHeight: 1.45, color: 'var(--foreground-2)' }}>
                  <input
                    type="checkbox"
                    checked={consentKvkk}
                    onChange={e => setConsentKvkk(e.target.checked)}
                    style={{ width: 16, height: 16, marginTop: 2, accentColor: '#2563eb', flexShrink: 0 }}
                  />
                  <span>
                    <button
                      type="button"
                      onClick={() => setOpenLegalDoc('kvkk')}
                      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--pc-tint-fg)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                    >
                      KVKK Aydınlatma Metni
                    </button>
                    ’ni okudum ve kişisel verilerimin işlenmesini kabul ediyorum. *
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className={depth.btnPrimary}
                style={{ width: '100%', minHeight: 42, borderRadius: 10, fontSize: '0.9rem', fontWeight: 700 }}
              >
                <span style={{ color: '#ffffff' }}>
                  {loading ? 'Doğrulama kodu gönderiliyor...' : 'Doğrulama Kodu Gönder ve Devam Et'}
                </span>
              </button>
            </form>
          </>
        ) : (
          /* DEMO & PRO STEP 2: 6-DIGIT OTP VERIFICATION */
          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              className={depth.subcard}
              style={{
                background: 'var(--card-inner)',
                padding: '12px 14px',
                fontSize: '0.82rem',
                color: 'var(--foreground-2)',
                lineHeight: 1.5,
              }}
            >
              <strong>{deliveryChannel === 'email' ? email : `+90 ${phoneNational}`}</strong> adresine gönderilen{' '}
              <strong>6 haneli doğrulama kodunu</strong> girerek işletme hesabınızı etkinleştirin.
            </div>

            {devOtpCode && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--pc-tint)',
                  border: '1px solid var(--pc-border)',
                  color: 'var(--pc-tint-fg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: '0.8rem',
                  fontWeight: 700,
                }}
              >
                <span>Geliştirici Test Kodu: {devOtpCode}</span>
                <button
                  type="button"
                  className={depth.btn}
                  onClick={() => setOtpCode(devOtpCode)}
                  style={{ minHeight: 28, padding: '3px 10px', fontSize: '0.75rem' }}
                >
                  Kodu Doldur
                </button>
              </div>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                6 Haneli Doğrulama Kodu
              </span>
              <input
                className={depth.input}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={otpCode}
                onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                style={{
                  minHeight: 46,
                  fontSize: '1.3rem',
                  fontWeight: 800,
                  letterSpacing: '0.32em',
                  textAlign: 'center',
                }}
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className={depth.btnPrimary}
              style={{ width: '100%', minHeight: 42, borderRadius: 10, fontSize: '0.9rem', fontWeight: 700 }}
            >
              <span style={{ color: '#ffffff' }}>
                {loading ? 'Doğrulanıyor ve hesabınız açılıyor...' : 'Kodu Doğrula ve Hesabı Başlat'}
              </span>
            </button>

            <button
              type="button"
              className={depth.btn}
              onClick={() => { setStep('form'); setOtpCode(''); setError('') }}
              style={{ width: '100%' }}
            >
              ← Bilgileri Düzenle / Yeniden Kod Gönder
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--foreground-2)' }}>
          Zaten hesabınız var mı?{' '}
          <Link href="/login" style={{ color: 'var(--pc-tint-fg)', fontWeight: 700, textDecoration: 'none' }}>
            Giriş Yapın
          </Link>
        </div>

        <PaymentTrustFooter compact />
      </div>

      <LegalDocumentModal docKey={openLegalDoc} onClose={() => setOpenLegalDoc(null)} />
    </div>
  )
}

export default function KayitPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--background)',
            color: 'var(--foreground-2)',
            fontSize: '0.9rem',
          }}
        >
          Yükleniyor...
        </div>
      }
    >
      <KayitContent />
    </Suspense>
  )
}
