'use client'

import React from 'react'
import { FileText, ShieldCheck, X } from 'lucide-react'
import { useBackdropDismiss } from '@/hooks/useBackdropDismiss'
import depth from '@/styles/clinic-depth.module.css'

export type LegalDocKey = 'sales' | 'refund' | 'kvkk'

export interface LegalDocumentDefinition {
  title: string
  subtitle: string
  sections: Array<{ heading: string; body: string }>
}

export const LEGAL_DOCUMENTS: Record<LegalDocKey, LegalDocumentDefinition> = {
  sales: {
    title: 'Ön Bilgilendirme Formu & Mesafeli Hizmet Satış Sözleşmesi',
    subtitle: '6502 Sayılı Kanun ve Mesafeli Sözleşmeler Yönetmeliği Kapsamında',
    sections: [
      {
        heading: '1. Konu ve Hizmetin Niteliği',
        body: 'İşbu Ön Bilgilendirme Formu ve Mesafeli Hizmet Satış Sözleşmesi, elektronik ortamda sunulan bulut tabanlı randevu yönetimi, veri tablosu, ekip planlama ve yapay zeka destekli iletişim asistanı yazılım hizmetlerinin (SaaS) abonelik ve kullanım koşullarını düzenler.',
      },
      {
        heading: '2. Paketler, Deneme Süresi ve Ücretlendirme',
        body: 'Demo Paket 7 (yedi) gün boyunca ücretsiz sunulur; en fazla 2 yönetici hesabı ve Web Asistanı içerir. Pro Paket aylık net 7.000 ₺ + %20 KDV (KDV dahil 8.400 ₺ / ay) olarak ücretlendirilir ve 10 kullanıcıya kadar tüm modülleri kapsar. Kurumsal Paket kapsam ve fiyatlandırması işletmeye özel sözleşme ile belirlenir.',
      },
      {
        heading: '3. Hizmetin İfası ve Güvenli Ödeme',
        body: 'Hizmet, kayıt ve doğrulama işleminin tamamlanmasıyla birlikte çevrim içi olarak anında erişime açılır. Kredi veya banka kartı ödemeleri BDDK lisanslı ödeme kuruluşu iyzico altyapısı ve 3D Secure güvenlik doğrulaması üzerinden tahsil edilir; kart bilgileri sistemlerimizde saklanmaz.',
      },
      {
        heading: '4. Tarafların Hak ve Yükümlülükleri',
        body: 'Abone, sisteme girdiği müşteri/hasta verileri ve iletişim izinleri bakımından yürürlükteki mevzuata uymakla yükümlüdür. Hizmet sağlayıcı, sistem sürekliliği, veri güvenliği ve kiracı izolasyonu için gerekli teknik ve idari tedbirleri uygular.',
      },
      {
        heading: '5. Uyuşmazlıkların Çözümü',
        body: 'İşbu sözleşmeden doğabilecek uyuşmazlıklarda Türkiye Cumhuriyeti kanunları uygulanır; ticari abonelerde İstanbul (Merkez) Mahkemeleri ve İcra Daireleri, tüketici sıfatını haiz işlemlerde ilgili Tüketici Hakem Heyetleri ve Tüketici Mahkemeleri yetkilidir.',
      },
    ],
  },
  refund: {
    title: 'İptal ve İade Politikası',
    subtitle: 'Dijital Abonelik, Deneme Süresi ve Yenileme Kuralları',
    sections: [
      {
        heading: '1. 7 Günlük Ücretsiz Deneme Süresi',
        body: '7 günlük Demo deneme süresi boyunca herhangi bir ücret tahsil edilmez. Deneme süresi sonunda ücretli pakete geçiş yapılmazsa hesap otomatik olarak borçlandırılmaz; mevcut kayıtlar salt okunur olarak korunur.',
      },
      {
        heading: '2. Aylık Abonelik İptali',
        body: 'Ücretli Pro Paket aboneliğinizi dilediğiniz an Yönetim Paneli > Entegrasyonlar (Ayarlar) > Abonelik bölümünden tek tıkla iptal edebilirsiniz. İptal işlemi gerçekleştiğinde takip eden dönem için yenileme tahsilatı durdurulur ve mevcut fatura döneminizin sonuna kadar tüm Pro özellikleri kullanmaya devam edersiniz.',
      },
      {
        heading: '3. İade Koşulları',
        body: 'Mesafeli Sözleşmeler Yönetmeliği m.15/1-ğ uyarınca elektronik ortamda anında ifa edilen bulut yazılım hizmetlerinde aktif kullanılan dönem için kısmi gün iadesi yapılmaz. Mükerrer çekim veya teknik aksaklık kaynaklı hatalı tahsilatlar ise bildirimi takiben 7 iş günü içinde ödeme yapılan karta iade edilir.',
      },
    ],
  },
  kvkk: {
    title: '6698 Sayılı KVKK Aydınlatma Metni',
    subtitle: 'Kişisel Verilerin İşlenmesi ve Korunması Hakkında Bilgilendirme',
    sections: [
      {
        heading: '1. İşlenen Kişisel Veriler',
        body: 'Üyelik, kimlik doğrulama ve faturalandırma süreçlerinde ad-soyad, işletme/ticari unvan, e-posta adresi, cep telefonu numarası, vergi/kimlik numarası, fatura adresi ve işlem güvenliği (IP, oturum ve onay zaman damgası) verileriniz işlenmektedir.',
      },
      {
        heading: '2. Kişisel Verilerin İşlenme Amaçları ve Hukuki Sebebi',
        body: 'Verileriniz; KVKK m.5/2 kapsamında sözleşmenin kurulması ve ifası, tek kullanımlık doğrulama kodu (OTP) gönderimi, fatura düzenlenmesi, yasal yükümlülüklerin yerine getirilmesi ve bilgi güvenliği süreçlerinin yürütülmesi amaçlarıyla işlenir.',
      },
      {
        heading: '3. Aktarım ve Güvenlik Tedbirleri',
        body: 'Kişisel verileriniz yalnızca hizmetin ifası için zorunlu olduğu ölçüde yetkili ödeme kuruluşu (iyzico), elektronik ileti/SMS altyapı sağlayıcıları ve yasal mercilerle paylaşılır; şifreli iletişim ve erişim kontrolü ile korunur.',
      },
      {
        heading: '4. İlgili Kişinin Hakları (KVKK m.11)',
        body: 'KVKK’nın 11. maddesi uyarınca kişisel verilerinizin işlenip işlenmediğini öğrenme, düzeltilmesini veya silinmesini talep etme ve kanuna aykırı işleme nedeniyle zararın giderilmesini isteme haklarına sahipsiniz.',
      },
    ],
  },
}

export function LegalDocumentModal({
  docKey,
  onClose,
}: {
  docKey: LegalDocKey | null
  onClose: () => void
}) {
  const backdropDismiss = useBackdropDismiss(onClose)
  if (!docKey) return null
  const doc = LEGAL_DOCUMENTS[docKey]

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000030,
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
        aria-label={doc.title}
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '14px 18px',
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
              <FileText size={16} color="#ffffff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.25 }}>
                {doc.title}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.73rem', color: 'var(--foreground-3)' }}>
                {doc.subtitle}
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

        <div
          style={{
            padding: '16px 18px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            background: 'var(--card-bg)',
          }}
        >
          {doc.sections.map(sec => (
            <div
              key={sec.heading}
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                background: 'var(--card-inner)',
                border: '1px solid var(--input-border)',
                boxShadow: 'var(--pc-neo-subcard)',
              }}
            >
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>
                {sec.heading}
              </div>
              <div style={{ fontSize: '0.79rem', lineHeight: 1.55, color: 'var(--foreground-2)' }}>
                {sec.body}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            padding: '12px 18px',
            background: 'var(--card-inner)',
            borderTop: '1px solid var(--input-border)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button type="button" onClick={onClose} className={depth.btnPrimary}>
            <span style={{ color: '#ffffff' }}>Okudum, Kapat</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export function PaymentTrustFooter({ compact = false }: { compact?: boolean }) {
  const badges = ['iyzico ile Öde', '3D Secure', 'VISA', 'Mastercard', 'TROY']
  return (
    <div
      style={{
        marginTop: compact ? 10 : 18,
        padding: compact ? '10px 12px' : '12px 14px',
        borderRadius: 12,
        background: 'var(--card-inner)',
        border: '1px solid var(--input-border)',
        boxShadow: 'var(--pc-neo-subcard)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {badges.map((label, idx) => (
          <span
            key={label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 9px',
              borderRadius: 999,
              fontSize: '0.72rem',
              fontWeight: 700,
              background: idx === 0 ? 'var(--pc-tint)' : 'var(--card-bg)',
              color: idx === 0 ? 'var(--pc-tint-fg)' : 'var(--foreground)',
              border: `1px solid ${idx === 0 ? 'var(--pc-border)' : 'var(--input-border)'}`,
              boxShadow: idx === 0 ? 'var(--pc-clay-pale)' : 'var(--pc-clay-btn)',
            }}
          >
            {idx === 0 && <ShieldCheck size={12} />}
            {label}
          </span>
        ))}
      </div>
      <div
        style={{
          fontSize: '0.7rem',
          color: 'var(--foreground-3)',
          textAlign: 'center',
          lineHeight: 1.4,
        }}
      >
        WhatsApp, Meta Platforms, Inc. şirketinin tescilli ticari markasıdır.
      </div>
    </div>
  )
}
