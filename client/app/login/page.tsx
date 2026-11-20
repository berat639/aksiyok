'use client'

import React, { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ThemeToggle } from '../theme-provider'
import { useAuth } from '@/lib/auth-context'
import depth from '@/styles/clinic-depth.module.css'

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

function mapOAuthError(code: string | null): string {
  if (!code) return ''
  switch (code) {
    case 'google_yapilandirilmamis':
      return 'Google ile giriş bu sunucuda henüz yapılandırılmamış. Lütfen e-posta ve şifrenizle giriş yapın.'
    case 'google_iptal':
      return 'Google ile giriş işlemi iptal edildi.'
    case 'hesap_donduruldu':
      return 'Bu hesap veya bağlı olduğu işletme pasif durumdadır. Lütfen yöneticinizle iletişime geçin.'
    case 'hesap_bulunamadi':
      return 'Bu Google hesabına bağlı bir kayıt bulunamadı. Aşağıdaki bağlantıdan 7 günlük ücretsiz Demo başlatabilirsiniz.'
    default:
      return 'Google ile oturum açılırken bir hata oluştu. Lütfen tekrar deneyin veya e-posta ile giriş yapın.'
  }
}

function LoginFormContent() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refreshUser } = useAuth()

  const oauthError = mapOAuthError(searchParams.get('error'))
  const visibleError = error || oauthError

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Giriş başarısız. Lütfen bilgilerinizi kontrol edin.')
        return
      }
      await refreshUser()
      router.push('/panel')
    } catch {
      setError('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.')
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
        padding: '24px 16px',
        background: 'var(--background)',
      }}
    >
      <div
        className={depth.card}
        style={{
          width: '100%',
          maxWidth: 420,
          padding: '24px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--foreground)' }}>
              Yönetim Paneline Giriş
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--foreground-2)' }}>
              İşletme ve yapay zeka asistanı hesabınıza erişin
            </p>
          </div>
          <ThemeToggle />
        </div>

        {visibleError && (
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
            {visibleError}
          </div>
        )}

        <a
          href="/api/auth/google/start?mode=login"
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
            fontSize: '0.86rem',
            gap: 8,
          }}
        >
          <GoogleIcon />
          <span>Google ile Giriş Yap</span>
        </a>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--input-border)' }} />
          <span style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--foreground-3)' }}>
            veya e-posta ile giriş yapın
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--input-border)' }} />
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
              E-posta Adresi
            </span>
            <input
              type="email"
              className={depth.input}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="ornek@isletme.com"
              autoComplete="email"
              required
              style={{ minHeight: 40, fontSize: '0.88rem' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--foreground-2)' }}>
              Şifre
            </span>
            <input
              type="password"
              className={depth.input}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              style={{ minHeight: 40, fontSize: '0.88rem' }}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className={depth.btnPrimary}
            style={{
              width: '100%',
              minHeight: 42,
              borderRadius: 10,
              fontSize: '0.9rem',
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            <span style={{ color: '#ffffff' }}>
              {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
            </span>
          </button>
        </form>

        <div
          className={depth.subcard}
          style={{
            background: 'var(--card-inner)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            textAlign: 'center',
            padding: '12px 14px',
          }}
        >
          <Link
            href="/kayit?plan=demo"
            style={{
              color: 'var(--pc-tint-fg)',
              fontWeight: 700,
              fontSize: '0.83rem',
              textDecoration: 'none',
            }}
          >
            Hesabınız yok mu? 7 Gün Ücretsiz Demo Başlatın →
          </Link>
          <Link
            href="/kayit?plan=kurumsal"
            style={{
              color: 'var(--foreground-2)',
              fontWeight: 600,
              fontSize: '0.75rem',
              textDecoration: 'none',
            }}
          >
            Çok şubeli yapı veya özel kurulum için Kurumsal Teklif Alın
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
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
      <LoginFormContent />
    </Suspense>
  )
}
