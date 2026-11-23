'use client'

import { useState, useEffect, useCallback } from 'react'
import { Lock, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useAuth, type AuthUser } from '../../../lib/auth-context'
import { ThemeToggle } from '../../theme-provider'
import depth from '@/styles/clinic-depth.module.css'

import CalendarTab from '../../admin/components/CalendarTab'
import PatientsTab from '../../admin/components/PatientsTab'
import KnowledgeTab from '../../admin/components/KnowledgeTab'
import SubscriptionCheckoutModal, {
  type SubscriptionModalMode,
  type UpgradeRequestType,
} from '../../admin/components/SubscriptionCheckoutModal'
import VipAssistantTab from './tabs/VipAssistantTab'
import PlatformClinicsTab from './tabs/PlatformClinicsTab'
import IsletmeKayitlarTab, { type IsletmeSection, type SectionAccess } from './tabs/IsletmeKayitlarTab'
import GelenKayitlarTab from './tabs/GelenKayitlarTab'

type Tab = 'isletme' | 'calendar' | 'patients' | 'incoming' | 'payments' | 'stok' | 'knowledge' | 'klinik' | 'integrations' | 'vip' | 'platform-clinics'

// Üst sekme çubuğu. "Ödemeler & Finans" (payments), "İşletme Personeli" (klinik), "Stok & Bakım" (stok)
// ve "Ayarlar ve Entegrasyonlar" (integrations) artık "İşletme ve Kayıtlar" altında; yetki anahtarları geriye dönük uyumluluk için korunur.
const BASE_TABS: { id: Tab; label: string }[] = [
  { id: 'isletme', label: 'İşletme ve Kayıtlar' },
  { id: 'calendar', label: 'Takvim' },
  { id: 'patients', label: 'Veri Tabloları' },
  { id: 'incoming', label: 'Gelen Kayıtlar' },
  { id: 'knowledge', label: 'Bilgi Tabanı' },
]

/** İşletme ve Kayıtlar içine taşınan eski sekmeler → ilgili bölüm. */
const NESTED_TAB_SECTION: Partial<Record<Tab, IsletmeSection>> = {
  klinik: 'personel',
  payments: 'finans',
  stok: 'stok',
  integrations: 'ayarlar',
}
const YONETICI_TABS: Tab[] = [...BASE_TABS.map(t => t.id), 'klinik', 'payments', 'stok', 'integrations']
const TAB_LABELS: Record<string, string> = {
  ...Object.fromEntries(BASE_TABS.map(t => [t.id, t.label])),
  klinik: 'Personel ve Mesai',
  payments: 'Finans ve Raporlama',
  stok: 'Stok ve Bakım',
  integrations: 'Ayarlar ve Entegrasyonlar',
}

const DEMO_LOCKED_CANDIDATES: Tab[] = ['payments', 'stok', 'klinik']

const PANEL_TAB_STORAGE_KEY = 'voiceai_panel_active_tab'

function isTabLockedByPlan(tabId: Tab, user: AuthUser | null): boolean {
  if (!user || user.canManagePlatform || !user.plan) return false
  if (!DEMO_LOCKED_CANDIDATES.includes(tabId)) return false
  const allowed = (user.plan.allowedTabs || []).map(t => t.trim().toLowerCase())
  if (allowed.length === 0) {
    return user.plan.planId === 'demo'
  }
  if (tabId === 'payments') return !allowed.includes('payments') && !allowed.includes('finance')
  if (tabId === 'stok') return !allowed.includes('stok') && !allowed.includes('inventory')
  if (tabId === 'klinik') return !allowed.includes('klinik') && !allowed.includes('team')
  return false
}

function resolveInitialPanelTab(allowed: Tab[], defaultTab: Tab, user: AuthUser | null): Tab {
  const unlocked = allowed.filter(t => !isTabLockedByPlan(t, user))
  const pool = unlocked.length > 0 ? unlocked : allowed
  if (typeof window !== 'undefined') {
    const urlTab = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (urlTab && pool.includes(urlTab)) return urlTab
    const sessionTab = window.sessionStorage.getItem(PANEL_TAB_STORAGE_KEY) as Tab | null
    if (sessionTab && pool.includes(sessionTab)) return sessionTab
    const localTab = window.localStorage.getItem(PANEL_TAB_STORAGE_KEY) as Tab | null
    if (localTab && pool.includes(localTab)) return localTab
  }
  return pool.includes(defaultTab) ? defaultTab : (pool[0] || 'calendar')
}

export default function YoneticiPage() {
  const { user, logout, refreshUser } = useAuth()
  const [tab, setTabState] = useState<Tab | null>(null)
  const [isletmeSection, setIsletmeSection] = useState<IsletmeSection>('ozet')
  const [allowedTabs, setAllowedTabs] = useState<Tab[] | null>(null)
  const [dynamicTabLabel, setDynamicTabLabel] = useState<string>('Veri Tabloları')
  const [paymentBanner, setPaymentBanner] = useState<'success' | 'failed' | null>(null)
  const [subModal, setSubModal] = useState<{
    open: boolean
    mode: SubscriptionModalMode
    featureTitle?: string
    requestType?: UpgradeRequestType
  }>({ open: false, mode: 'LockedFeature' })

  useEffect(() => {
    fetch('/api/dynamic-tables/schema')
      .then(r => r.json())
      .then(d => {
        if (d && typeof d.tabLabel === 'string' && d.tabLabel.trim()) {
          setDynamicTabLabel(d.tabLabel.trim())
        }
      })
      .catch(() => {})

    const onLabelChange = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (typeof detail === 'string' && detail.trim()) {
        setDynamicTabLabel(detail.trim())
      }
    }
    window.addEventListener('dynamic-studio-label-changed', onLabelChange)
    return () => window.removeEventListener('dynamic-studio-label-changed', onLabelChange)
  }, [])

  // Handle ?upgrade=pro and ?payment=success|failed query params
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const url = new URL(window.location.href)
      const upgradeParam = url.searchParams.get('upgrade')
      const paymentParam = url.searchParams.get('payment')
      let changed = false

      if (upgradeParam === 'pro') {
        setSubModal({ open: true, mode: 'Checkout', requestType: 'pro_upgrade' })
        url.searchParams.delete('upgrade')
        changed = true
      }
      if (paymentParam === 'success') {
        setPaymentBanner('success')
        void refreshUser()
        url.searchParams.delete('payment')
        changed = true
      } else if (paymentParam === 'failed') {
        setPaymentBanner('failed')
        url.searchParams.delete('payment')
        changed = true
      }

      if (changed) {
        window.history.replaceState(null, '', url.toString())
      }
    } catch {}
  }, [refreshUser])

  const setTab = useCallback((nextTab: Tab) => {
    const nested = NESTED_TAB_SECTION[nextTab]
    if (nested) {
      setIsletmeSection(nested)
      setTabState('isletme')
      return
    }
    if (isTabLockedByPlan(nextTab, user)) {
      setSubModal({
        open: true,
        mode: 'LockedFeature',
        featureTitle: TAB_LABELS[nextTab] || 'Bu Modül',
        requestType: 'pro_upgrade',
      })
      return
    }
    setTabState(nextTab)
  }, [user])

  // Eski bağlantılar (?tab=klinik / ?tab=payments) ve kayıtlı sekme tercihleri yeni bölüme yönlenir.
  useEffect(() => {
    if (!tab) return
    const nested = NESTED_TAB_SECTION[tab]
    if (!nested) return
    setIsletmeSection(nested)
    setTabState('isletme')
  }, [tab])

  useEffect(() => {
    if (!tab || typeof window === 'undefined') return
    if (NESTED_TAB_SECTION[tab]) return
    if (isTabLockedByPlan(tab, user)) {
      setTabState('calendar')
      return
    }
    try {
      window.sessionStorage.setItem(PANEL_TAB_STORAGE_KEY, tab)
      window.localStorage.setItem(PANEL_TAB_STORAGE_KEY, tab)
      const url = new URL(window.location.href)
      if (url.searchParams.get('tab') !== tab) {
        url.searchParams.set('tab', tab)
        window.history.replaceState(null, '', url.toString())
      }
    } catch {}
  }, [tab, user])

  const isModerator = user?.role === 'moderator'
  const isDemoNonPlatform = Boolean(user?.plan?.planId === 'demo' && !user?.canManagePlatform)

  const roleTabs = isModerator
    ? [{ id: 'vip' as Tab, label: '🌟 Özel Asistan (VIP)' }, ...BASE_TABS]
    : BASE_TABS
  const tabsList = user?.canManagePlatform
    ? [{ id: 'platform-clinics' as Tab, label: 'İşletmeler' }, ...roleTabs]
    : roleTabs

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const aliasToPanelTab = (raw: string): Tab | null => {
      const normalized = raw.trim().toLowerCase()
      if (normalized === 'records') return 'patients'
      if (normalized === 'gelen-kayitlar' || normalized === 'gelen_kayitlar' || normalized === 'whatsapp') return 'incoming'
      if (normalized === 'finance') return 'payments'
      if (normalized === 'inventory') return 'stok'
      if (normalized === 'team') return 'klinik'
      if (['isletme', 'calendar', 'patients', 'incoming', 'payments', 'stok', 'knowledge', 'klinik', 'integrations', 'vip', 'platform-clinics'].includes(normalized)) {
        return normalized as Tab
      }
      return null
    }
    if (isModerator) {
      const allowed: Tab[] = [
        ...(user.canManagePlatform ? ['platform-clinics' as Tab] : []),
        'vip', 'incoming', 'knowledge', 'calendar',
      ]
      setAllowedTabs(allowed)
      setTabState(prev => (prev && allowed.includes(prev) && !isTabLockedByPlan(prev, user) ? prev : resolveInitialPanelTab(allowed, 'vip', user)))
    } else if (user.role === 'yonetici') {
      const allowed: Tab[] = [
        ...(user.canManagePlatform ? ['platform-clinics' as Tab] : []),
        ...YONETICI_TABS,
      ]
      setAllowedTabs(allowed)
      // İlk girişte Takvim'den önce İşletme ve Kayıtlar açılır.
      setTabState(prev => (prev && allowed.includes(prev) && !isTabLockedByPlan(prev, user) ? prev : resolveInitialPanelTab(allowed, 'isletme', user)))
    } else {
      fetch('/api/admin/settings/roles', { credentials: 'include' })
        .then(r => r.json())
        .then(perms => {
          if (cancelled) return
          const rawRolePerms: string[] =
            (Array.isArray(perms?.effectiveAllowedTabs) && perms.effectiveAllowedTabs.length > 0
              ? perms.effectiveAllowedTabs
              : perms?.[user.role] || perms?.calisan || (user.role === 'host' ? perms?.sekreter : undefined)) || ['calendar']
          const rolePerms = Array.from(new Set(rawRolePerms.map(aliasToPanelTab).filter((t): t is Tab => Boolean(t))))
          // Personel, finans, stok veya ayarlar yetkisi olan çalışan bu bölümlere İşletme ve Kayıtlar üzerinden ulaşır.
          if (!rolePerms.includes('isletme') && (rolePerms.includes('klinik') || rolePerms.includes('payments') || rolePerms.includes('stok') || rolePerms.includes('integrations'))) rolePerms.push('isletme')
          const safeRolePerms: Tab[] = rolePerms.length > 0 ? rolePerms : ['calendar']
          setAllowedTabs(safeRolePerms)
          setTabState(prev => (prev && safeRolePerms.includes(prev) && !isTabLockedByPlan(prev, user) ? prev : resolveInitialPanelTab(safeRolePerms, safeRolePerms[0] || 'calendar', user)))
        })
        .catch(() => {
          if (cancelled) return
          const fallback: Tab[] = ['calendar']
          setAllowedTabs(fallback)
          setTabState(prev => (prev && fallback.includes(prev) ? prev : 'calendar'))
        })
    }
    return () => {
      cancelled = true
    }
  }, [user, isModerator])

  useEffect(() => {
    if (typeof window === 'undefined' || !allowedTabs) return
    const handlePopState = () => {
      const urlTab = new URLSearchParams(window.location.search).get('tab') as Tab | null
      if (urlTab && allowedTabs.includes(urlTab) && !isTabLockedByPlan(urlTab, user)) {
        setTabState(urlTab)
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [allowedTabs, user])

  const visibleTabs = tabsList.filter(t => {
    if (allowedTabs?.includes(t.id)) return true
    if (isDemoNonPlatform && DEMO_LOCKED_CANDIDATES.includes(t.id)) return true
    return false
  })

  const canEditBusiness = Boolean(user && (user.role === 'yonetici' || user.canManagePlatform))
  const hasTab = (t: Tab) => Boolean(allowedTabs?.includes(t))
  const isletmeAccess: Record<IsletmeSection, SectionAccess> = {
    ozet: { visible: canEditBusiness || hasTab('payments') || hasTab('stok') || hasTab('klinik') },
    genel: { visible: canEditBusiness },
    urunler: { visible: canEditBusiness },
    personel: { visible: hasTab('klinik') || isDemoNonPlatform, locked: isTabLockedByPlan('klinik', user) },
    finans: { visible: hasTab('payments') || isDemoNonPlatform, locked: isTabLockedByPlan('payments', user) },
    stok: { visible: hasTab('stok') || isDemoNonPlatform, locked: isTabLockedByPlan('stok', user) },
    ayarlar: { visible: canEditBusiness || hasTab('integrations') },
  }
  const openLockedFeature = useCallback((featureTitle: string) => {
    setSubModal({ open: true, mode: 'LockedFeature', featureTitle, requestType: 'pro_upgrade' })
  }, [])

  return (
    <div className="admin-content" style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px clamp(20px, 3.5vw, 56px)', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 'clamp(1rem, 2.6vw, 1.25rem)', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>
          {user?.role === 'yonetici' ? 'Yönetici Paneli' : 'İşletme Paneli'}
        </h1>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--foreground-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</span>
          <ThemeToggle />
          <button onClick={logout} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--foreground-3)' }}>Çıkış</button>
        </div>
      </div>

      {/* Payment Result Banner */}
      {paymentBanner && (
        <div
          className={depth.card}
          style={{
            width: '100%',
            marginBottom: 14,
            padding: '12px 16px',
            background: paymentBanner === 'success' ? 'var(--btn-clinic-mint-bg)' : 'var(--flow-danger-bg)',
            borderColor: paymentBanner === 'success' ? 'var(--btn-clinic-mint-border)' : 'var(--danger)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', fontWeight: 700 }}>
            {paymentBanner === 'success' ? (
              <>
                <CheckCircle2 size={18} color="var(--btn-clinic-mint-fg)" />
                <span>Ödemeniz başarıyla tamamlandı! Pro paket özellikleriniz ve tüm modülleriniz aktifleştirildi.</span>
              </>
            ) : (
              <>
                <AlertTriangle size={18} color="var(--danger)" />
                <span>Ödeme işlemi tamamlanamadı. Tekrar deneyebilir veya satış ekibimize talep gönderebilirsiniz.</span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {paymentBanner === 'failed' && (
              <button
                type="button"
                className={depth.btnPrimary}
                onClick={() => setSubModal({ open: true, mode: 'Checkout', requestType: 'pro_upgrade' })}
              >
                <span style={{ color: '#ffffff' }}>Tekrar Dene</span>
              </button>
            )}
            <button type="button" className={depth.btn} onClick={() => setPaymentBanner(null)}>
              Kapat
            </button>
          </div>
        </div>
      )}

      <div style={{ width: '100%', maxWidth: '100%' }}>
        <div style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', WebkitOverflowScrolling: 'touch', gap: 6, marginBottom: 20, borderBottom: '1px solid var(--glass-border)', paddingBottom: 6, width: '100%' }}>
          {allowedTabs === null ? (
            <div style={{ padding: 10, fontSize: 13, color: 'var(--foreground-3)' }}>Yükleniyor...</div>
          ) : (
            visibleTabs.map(t => {
              const locked = isTabLockedByPlan(t.id, user)
              const displayLabel = t.id === 'patients' ? dynamicTabLabel : t.label
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    if (locked) {
                      setSubModal({
                        open: true,
                        mode: 'LockedFeature',
                        featureTitle: displayLabel,
                        requestType: 'pro_upgrade',
                      })
                      return
                    }
                    setTab(t.id)
                  }}
                  style={{
                    padding: '8px 14px',
                    fontSize: '0.82rem',
                    fontWeight: tab === t.id ? 600 : 500,
                    color: tab === t.id ? 'var(--foreground)' : 'var(--foreground-3)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                    marginBottom: -1,
                    borderRadius: 8,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    opacity: locked ? 0.85 : 1,
                  }}
                >
                  {locked && <Lock size={12} />}
                  <span>{displayLabel}</span>
                </button>
              )
            })
          )}
        </div>

        <div style={{ width: '100%' }}>
          {tab === 'isletme' && (
            <IsletmeKayitlarTab
              section={isletmeSection}
              onSectionChange={setIsletmeSection}
              access={isletmeAccess}
              onLocked={openLockedFeature}
              scope={user?.clinicId || null}
            />
          )}
          {tab === 'calendar' && <CalendarTab onNavigateToClinicStaff={() => setTab('klinik')} />}
          {tab === 'patients' && <PatientsTab />}
          {tab === 'incoming' && <GelenKayitlarTab />}
          {tab === 'knowledge' && <KnowledgeTab />}
          {tab === 'vip' && <VipAssistantTab />}
          {tab === 'platform-clinics' && user?.canManagePlatform && <PlatformClinicsTab />}
        </div>
      </div>

      <SubscriptionCheckoutModal
        isOpen={subModal.open}
        mode={subModal.mode}
        featureTitle={subModal.featureTitle}
        defaultRequestType={subModal.requestType}
        userEmail={user?.email}
        userName={user?.name}
        onClose={() => setSubModal(prev => ({ ...prev, open: false }))}
        onSuccess={() => void refreshUser()}
      />
    </div>
  )
}
