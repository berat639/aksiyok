'use client'

import React, { useEffect, useState } from 'react'
import { CreditCard, Lock, Send, Sparkles, CheckCircle2, X } from 'lucide-react'
import { useBackdropDismiss } from '@/hooks/useBackdropDismiss'
import { PhoneMaskedInput } from '@/lib/phone-mask'
import { LegalDocumentModal, PaymentTrustFooter, type LegalDocKey } from '@/lib/legal-documents'
import InfoTooltip from './ui/InfoTooltip'
import depth from '@/styles/clinic-depth.module.css'

export type UpgradeRequestType =
  | 'pro_upgrade'
  | 'whatsapp'
  | 'inbound_call'
  | 'outbound_call'
  | 'kurumsal_lead'

export type SubscriptionModalMode = 'LockedFeature' | 'RequestAssistant' | 'Checkout'

export interface SubscriptionCheckoutModalProps {
  isOpen: boolean
  mode: SubscriptionModalMode
  featureTitle?: string
  defaultRequestType?: UpgradeRequestType
  defaultRequestedPlan?: 'pro' | 'kurumsal'
  userEmail?: string
  userName?: string
  onClose: () => void
  onSuccess?: () => void
}

const REQUEST_TYPE_LABELS: Record<UpgradeRequestType, string> = {
  pro_upgrade: 'Pro Paket Geçiş Talebi (Tüm Modüller)',
  whatsapp: 'WhatsApp Business Asistanı Talebi',
  inbound_call: 'Gelen Çağrı / Santral Sesli Asistanı Talebi',
  outbound_call: 'Giden Arama & Sesli Teyit Asistanı Talebi',
  kurumsal_lead: 'Kurumsal Paket & Çoklu Şube Teklifi',
}

export default function SubscriptionCheckoutModal({
  isOpen,
  mode: initialMode,
  featureTitle,
  defaultRequestType = 'pro_upgrade',
  defaultRequestedPlan = 'pro',
  userEmail = '',
  userName = '',
  onClose,
  onSuccess,
}: SubscriptionCheckoutModalProps) {
  const [view, setView] = useState<SubscriptionModalMode>(initialMode)
  const [showRequestForm, setShowRequestForm] = useState(initialMode === 'RequestAssistant')
  const [requestType, setRequestType] = useState<UpgradeRequestType>(defaultRequestType)
  const [requestedPlan, setRequestedPlan] = useState<'pro' | 'kurumsal'>(defaultRequestedPlan)
  const [contactPhone, setContactPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [requestSent, setRequestSent] = useState(false)

  // Checkout fields
  const [buyerName, setBuyerName] = useState(userName)
  const [buyerEmail, setBuyerEmail] = useState(userEmail)
  const [buyerPhone, setBuyerPhone] = useState('')
  const [identityOrTaxNumber, setIdentityOrTaxNumber] = useState('')
  const [taxOffice, setTaxOffice] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('İstanbul')
  const [consentSales, setConsentSales] = useState(false)
  const [consentRefund, setConsentRefund] = useState(false)
  const [consentKvkk, setConsentKvkk] = useState(false)
  const [openLegalDoc, setOpenLegalDoc] = useState<LegalDocKey | null>(null)

  const [iyzicoNotConfigured, setIyzicoNotConfigured] = useState(false)
  const [checkoutHtml, setCheckoutHtml] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const backdropDismiss = useBackdropDismiss(() => {
    if (!openLegalDoc) onClose()
  })

  useEffect(() => {
    if (!isOpen) return
    setView(initialMode)
    setShowRequestForm(initialMode === 'RequestAssistant')
    setRequestType(defaultRequestType)
    setRequestedPlan(defaultRequestedPlan)
    setRequestSent(false)
    setIyzicoNotConfigured(false)
    setCheckoutHtml(null)
    setError('')
    if (userName && !buyerName) setBuyerName(userName)
    if (userEmail && !buyerEmail) setBuyerEmail(userEmail)
  }, [isOpen, initialMode, defaultRequestType, defaultRequestedPlan, userName, userEmail])

  if (!isOpen) return null

  const submitUpgradeRequest = async (overrideType?: UpgradeRequestType, overrideNotes?: string) => {
    setBusy(true)
    setError('')
    try {
      const effectiveType = overrideType || requestType
      const effectivePlan: 'pro' | 'kurumsal' =
        effectiveType === 'kurumsal_lead' ? 'kurumsal' : requestedPlan
      const res = await fetch('/api/billing/upgrade-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType: effectiveType,
          requestedPlan: effectivePlan,
          contactPhone: (contactPhone || buyerPhone || '').trim() || undefined,
          notes: (overrideNotes ?? notes).trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Başvuru iletilemedi. Lütfen tekrar deneyin.')
        return
      }
      setRequestSent(true)
      onSuccess?.()
    } catch {
      setError('Sunucuya bağlanılamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const taxDigits = identityOrTaxNumber.replace(/\D/g, '')
    if (taxDigits.length !== 10 && taxDigits.length !== 11) {
      setError('T.C. Kimlik Numarası (11 hane) veya Vergi Kimlik Numarası (10 hane) geçerli olmalıdır.')
      return
    }
    if (!buyerPhone || buyerPhone.replace(/\D/g, '').length < 10) {
      setError('Lütfen geçerli bir iletişim telefonu girin.')
      return
    }
    if (!consentSales || !consentRefund || !consentKvkk) {
      setError('Ödeme adımına geçmek için 3 yasal sözleşme ve aydınlatma onay kutusunu işaretlemelisiniz.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/billing/iyzico/checkout-initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: 'pro',
          buyer: {
            name: buyerName.trim(),
            legalName: buyerName.trim(),
            email: buyerEmail.trim().toLowerCase(),
            phone: buyerPhone.trim(),
            identityOrTaxNumber: taxDigits,
            taxOffice: taxOffice.trim() || undefined,
            address: address.trim(),
            city: city.trim(),
          },
          consents: {
            onBilgilendirme: true,
            mesafeliSatis: true,
            iptalIade: true,
            kvkk: true,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 503 || data.code === 'IYZICO_NOT_CONFIGURED') {
        setIyzicoNotConfigured(true)
        setError(
          data.error ||
            'Çevrim içi kartla ödeme altyapısı şu anda bakım/kurulum aşamasındadır. Fatura bilgilerinizle başvurunuzu tek tıkla satış ekibimize iletebilirsiniz.',
        )
        return
      }
      if (!res.ok) {
        setError(data.error || 'Ödeme oturumu başlatılamadı. Lütfen bilgilerinizi kontrol edin.')
        return
      }
      if (typeof data.paymentPageUrl === 'string' && data.paymentPageUrl.trim()) {
        window.location.href = data.paymentPageUrl
        return
      }
      if (typeof data.checkoutFormContent === 'string' && data.checkoutFormContent.trim()) {
        setCheckoutHtml(data.checkoutFormContent)
        return
      }
      setError('Ödeme sayfası bağlantısı alınamadı. Başvurunuzu satış ekibimize iletebilirsiniz.')
      setIyzicoNotConfigured(true)
    } catch {
      setError('Ödeme servisine ulaşılamadı. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000010,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
          background: 'var(--modal-overlay)',
        }}
        {...backdropDismiss}
      >
        <div
          role="dialog"
          aria-modal="true"
          onClick={e => e.stopPropagation()}
          style={{
            width: 'min(460px, calc(100vw - 24px))',
            maxWidth: 460,
            maxHeight: '90vh',
            borderRadius: 14,
            background: 'var(--card-bg)',
            border: '1.5px solid var(--input-border)',
            boxShadow: 'var(--pc-modal-shadow)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            color: 'var(--foreground)',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '15px 20px',
              background: 'var(--card-inner)',
              borderBottom: '1px solid var(--input-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
                  border: '1px solid #1d4ed8',
                  color: '#ffffff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: 'var(--pc-clay-primary)',
                }}
              >
                {view === 'Checkout' ? (
                  <CreditCard size={16} color="#ffffff" />
                ) : view === 'LockedFeature' ? (
                  <Lock size={16} color="#ffffff" />
                ) : (
                  <Sparkles size={16} color="#ffffff" />
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.2 }}>
                  {view === 'Checkout'
                    ? 'Pro Paket Abonelik ve Ödeme'
                    : view === 'LockedFeature'
                      ? `${featureTitle || 'Bu Modül'} Pro Pakette Aktiftir`
                      : 'Asistan ve Paket Geçiş Talebi'}
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '0.74rem', color: 'var(--foreground-3)' }}>
                  {view === 'Checkout'
                    ? 'iyzico 3D Secure Korumalı Aylık Abonelik'
                    : 'Demo paketten Pro veya Kurumsal pakete geçiş seçenekleri'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Kapat"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px solid var(--input-border)',
                background: 'var(--input-bg)',
                color: 'var(--foreground)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                boxShadow: 'var(--pc-clay-btn)',
              }}
            >
              <X size={15} />
            </button>
          </div>

          {/* Body */}
          <div
            style={{
              padding: '16px 20px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              background: 'var(--card-bg)',
            }}
          >
            {error && (
              <div
                role="alert"
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--flow-danger-bg)',
                  border: '1px solid var(--danger)',
                  color: 'var(--danger)',
                  fontSize: '0.79rem',
                  fontWeight: 600,
                  lineHeight: 1.45,
                }}
              >
                {error}
              </div>
            )}

            {requestSent ? (
              <div
                className={depth.subcard}
                style={{
                  padding: '16px 14px',
                  background: 'var(--btn-clinic-mint-bg)',
                  borderColor: 'var(--btn-clinic-mint-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  gap: 8,
                }}
              >
                <CheckCircle2 size={26} color="var(--btn-clinic-mint-fg)" />
                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--foreground)' }}>
                  Talebiniz Satış Ekibine İletildi
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--foreground-2)', lineHeight: 1.5 }}>
                  Ekibimiz başvurunuzu inceleyerek en kısa sürede sizinle iletişime geçecek ve paket/asistan aktivasyonunuzu sağlayacaktır.
                </div>
                <button type="button" onClick={onClose} className={depth.btnPrimary} style={{ marginTop: 4 }}>
                  <span style={{ color: '#ffffff' }}>Tamam</span>
                </button>
              </div>
            ) : view !== 'Checkout' ? (
              /* MODE 1: LOCKED FEATURE OR REQUEST ASSISTANT */
              <>
                <div
                  className={depth.subcard}
                  style={{
                    background: 'var(--card-inner)',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--foreground)' }}>
                      {featureTitle
                        ? `🔒 ${featureTitle} modülü Pro pakete dahildir`
                        : '🚀 Tüm Asistan ve Modülleri Aktifleştirin'}
                    </span>
                    <InfoTooltip title="Demo vs Pro Kapsamı">
                      7 günlük Demo pakette 2 Yönetici hesabı, Takvim, Veri Tabloları, Bilgi Tabanı ve Web Asistanı açıktır. Personel yönetimi, Ödemeler & Finans, Stok & Bakım, WhatsApp Business ve Sesli Santral Asistanları Pro pakette yer alır.
                    </InfoTooltip>
                  </div>
                  <div style={{ fontSize: '0.79rem', color: 'var(--foreground-2)', lineHeight: 1.5 }}>
                    Pro pakete geçerek <strong>10 kullanıcıya kadar personel</strong>,{' '}
                    <strong>Ödemeler & Finans</strong>, <strong>Stok & Bakım</strong>,{' '}
                    <strong>WhatsApp Business</strong> ve <strong>Gelen/Giden Sesli Arama Asistanı</strong>{' '}
                    özelliklerini hemen açabilirsiniz.
                  </div>
                </div>

                {/* Path 1: Immediate iyzico Pro Checkout */}
                <button
                  type="button"
                  onClick={() => { setView('Checkout'); setError('') }}
                  className={depth.btnPrimary}
                  style={{
                    width: '100%',
                    minHeight: 42,
                    borderRadius: 10,
                    fontSize: '0.86rem',
                    fontWeight: 700,
                  }}
                >
                  <CreditCard size={16} color="#ffffff" />
                  <span style={{ color: '#ffffff' }}>
                    iyzico ile Pro Pakete Geç (7.000 ₺ + KDV / ay)
                  </span>
                </button>

                {/* Path 2: Send Upgrade / Assistant Request */}
                {!showRequestForm ? (
                  <button
                    type="button"
                    onClick={() => setShowRequestForm(true)}
                    className={depth.btn}
                    style={{
                      width: '100%',
                      minHeight: 38,
                      borderRadius: 10,
                      background: 'var(--card-inner)',
                      color: 'var(--foreground)',
                      fontSize: '0.83rem',
                      fontWeight: 700,
                    }}
                  >
                    <Send size={14} />
                    <span>Asistan / Paket Geçiş Başvurusu Gönder</span>
                  </button>
                ) : (
                  <div
                    className={depth.subcard}
                    style={{
                      background: 'var(--card-inner)',
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--foreground)' }}>
                      Satış ve Kurulum Ekibine Talep Gönderin
                    </div>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                        Talep Konusu
                      </span>
                      <select
                        className={depth.input}
                        value={requestType}
                        onChange={e => {
                          const next = e.target.value as UpgradeRequestType
                          setRequestType(next)
                          if (next === 'kurumsal_lead') setRequestedPlan('kurumsal')
                          else setRequestedPlan('pro')
                        }}
                      >
                        {(Object.keys(REQUEST_TYPE_LABELS) as UpgradeRequestType[]).map(key => (
                          <option key={key} value={key}>
                            {REQUEST_TYPE_LABELS[key]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                        İletişim Telefonu (Opsiyonel)
                      </span>
                      <PhoneMaskedInput
                        className={depth.input}
                        value={contactPhone}
                        onValueChange={setContactPhone}
                        placeholder="0 (5XX) XXX XX XX"
                      />
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                        Notunuz (Opsiyonel)
                      </span>
                      <textarea
                        className={depth.input}
                        rows={2}
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        placeholder="Santral numaranız, WhatsApp hattınız veya aranmak istediğiniz saat..."
                        style={{ resize: 'vertical', minHeight: 56 }}
                      />
                    </label>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submitUpgradeRequest()}
                      className={depth.btn}
                      style={{
                        width: '100%',
                        minHeight: 38,
                        background: 'var(--pc-tint)',
                        borderColor: 'var(--pc-border)',
                        color: 'var(--pc-tint-fg)',
                        fontWeight: 700,
                      }}
                    >
                      <Send size={14} />
                      <span>{busy ? 'Gönderiliyor...' : 'Başvuruyu Gönder'}</span>
                    </button>
                  </div>
                )}
              </>
            ) : checkoutHtml ? (
              <div
                className={depth.subcard}
                style={{ background: 'var(--card-inner)', padding: 12 }}
                dangerouslySetInnerHTML={{ __html: checkoutHtml }}
              />
            ) : (
              /* MODE 2: TRANSPARENT IYZICO CHECKOUT */
              <form onSubmit={handleCheckoutSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {/* Transparent Price Summary */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 11,
                    background: 'var(--pc-tint)',
                    border: '1px solid var(--pc-border)',
                    boxShadow: 'var(--pc-clay-pale)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--foreground-2)' }}>
                    <span>Pro Paket Aylık Bedel (10 Kullanıcı · Tüm Modüller)</span>
                    <strong>7.000 ₺</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--foreground-2)' }}>
                    <span>KDV (%20)</span>
                    <strong>1.400 ₺</strong>
                  </div>
                  <div
                    style={{
                      borderTop: '1px solid var(--pc-border)',
                      paddingTop: 6,
                      marginTop: 2,
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.9rem',
                      fontWeight: 800,
                      color: 'var(--pc-tint-fg)',
                    }}
                  >
                    <span>KDV Dahil Aylık Toplam</span>
                    <span>8.400 ₺ / ay</span>
                  </div>
                </div>

                {iyzicoNotConfigured && (
                  <div
                    className={depth.subcard}
                    style={{
                      background: 'var(--card-inner)',
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: '0.79rem', color: 'var(--foreground-2)', lineHeight: 1.45 }}>
                      Dilerseniz girdiğiniz fatura bilgileriyle talebinizi doğrudan satış ekibimize iletebilirsiniz; hesabınız hızlıca Pro pakete geçirilir.
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void submitUpgradeRequest(
                          'pro_upgrade',
                          `Fatura Unvanı: ${buyerName} | VKN/TCKN: ${identityOrTaxNumber} | Şehir: ${city}`,
                        )
                      }
                      className={depth.btnPrimary}
                      style={{ width: '100%', minHeight: 38 }}
                    >
                      <Send size={14} color="#ffffff" />
                      <span style={{ color: '#ffffff' }}>
                        {busy ? 'İletiliyor...' : 'Başvuruyu Satış Ekibine İlet'}
                      </span>
                    </button>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                      Ad Soyad / Ticari Unvan *
                    </span>
                    <input
                      className={depth.input}
                      required
                      value={buyerName}
                      onChange={e => setBuyerName(e.target.value)}
                      placeholder="Firma Unvanı veya Ad Soyad"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                      T.C. Kimlik No / VKN *
                    </span>
                    <input
                      className={depth.input}
                      required
                      inputMode="numeric"
                      maxLength={11}
                      value={identityOrTaxNumber}
                      onChange={e => setIdentityOrTaxNumber(e.target.value.replace(/\D/g, '').slice(0, 11))}
                      placeholder="10 veya 11 haneli numara"
                    />
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                      Vergi Dairesi (Opsiyonel)
                    </span>
                    <input
                      className={depth.input}
                      value={taxOffice}
                      onChange={e => setTaxOffice(e.target.value)}
                      placeholder="Örn: Kadıköy V.D."
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                      Telefon *
                    </span>
                    <PhoneMaskedInput
                      className={depth.input}
                      required
                      value={buyerPhone}
                      onValueChange={setBuyerPhone}
                      placeholder="0 (5XX) XXX XX XX"
                    />
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 9 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                      Fatura E-postası *
                    </span>
                    <input
                      type="email"
                      className={depth.input}
                      required
                      value={buyerEmail}
                      onChange={e => setBuyerEmail(e.target.value)}
                      placeholder="muhasebe@isletme.com"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                      Şehir *
                    </span>
                    <input
                      className={depth.input}
                      required
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      placeholder="İstanbul"
                    />
                  </label>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
                    Fatura Adresi *
                  </span>
                  <input
                    className={depth.input}
                    required
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="Mahalle, Cadde/Sokak, Bina ve Kapı No, İlçe"
                  />
                </label>

                {/* 3 Mandatory Legal Checkboxes */}
                <div
                  className={depth.subcard}
                  style={{
                    background: 'var(--card-inner)',
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 7,
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: '0.74rem', lineHeight: 1.4, color: 'var(--foreground-2)' }}>
                    <input
                      type="checkbox"
                      checked={consentSales}
                      onChange={e => setConsentSales(e.target.checked)}
                      style={{ width: 15, height: 15, marginTop: 2, accentColor: '#2563eb', flexShrink: 0 }}
                    />
                    <span>
                      <button
                        type="button"
                        onClick={() => setOpenLegalDoc('sales')}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--pc-tint-fg)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                      >
                        Ön Bilgilendirme Formu & Mesafeli Hizmet Satış Sözleşmesi
                      </button>
                      ’ni kabul ediyorum. *
                    </span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: '0.74rem', lineHeight: 1.4, color: 'var(--foreground-2)' }}>
                    <input
                      type="checkbox"
                      checked={consentRefund}
                      onChange={e => setConsentRefund(e.target.checked)}
                      style={{ width: 15, height: 15, marginTop: 2, accentColor: '#2563eb', flexShrink: 0 }}
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

                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: '0.74rem', lineHeight: 1.4, color: 'var(--foreground-2)' }}>
                    <input
                      type="checkbox"
                      checked={consentKvkk}
                      onChange={e => setConsentKvkk(e.target.checked)}
                      style={{ width: 15, height: 15, marginTop: 2, accentColor: '#2563eb', flexShrink: 0 }}
                    />
                    <span>
                      <button
                        type="button"
                        onClick={() => setOpenLegalDoc('kvkk')}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--pc-tint-fg)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                      >
                        KVKK Aydınlatma Metni
                      </button>
                      ’ni okudum ve onaylıyorum. *
                    </span>
                  </label>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  {initialMode !== 'Checkout' && (
                    <button
                      type="button"
                      onClick={() => { setView(initialMode); setError('') }}
                      className={depth.btn}
                      style={{ minHeight: 40 }}
                    >
                      Geri
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={busy}
                    className={depth.btnPrimary}
                    style={{ flex: 1, minHeight: 40, borderRadius: 10, fontSize: '0.86rem', fontWeight: 700 }}
                  >
                    <CreditCard size={15} color="#ffffff" />
                    <span style={{ color: '#ffffff' }}>
                      {busy ? 'Ödeme ekranı hazırlanıyor...' : '8.400 ₺ Güvenli Ödemeye Geç'}
                    </span>
                  </button>
                </div>

                <PaymentTrustFooter compact />
              </form>
            )}
          </div>
        </div>
      </div>

      <LegalDocumentModal docKey={openLegalDoc} onClose={() => setOpenLegalDoc(null)} />
    </>
  )
}
