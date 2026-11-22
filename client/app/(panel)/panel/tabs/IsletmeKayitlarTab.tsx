'use client'

import { useEffect, useState } from 'react'
import {
  Activity,
  Boxes,
  Building2,
  ChevronRight,
  LayoutDashboard,
  Lock,
  Package,
  Settings,
  Users,
  Wallet,
} from 'lucide-react'
import {
  isBusinessProfileFilled,
  loadBusinessProfile,
  profileCompletion,
  type BusinessProfile,
} from '@/lib/business-profile'
import depth from '@/styles/clinic-depth.module.css'
import IntegrationsTab from '../../../admin/components/IntegrationsTab'
import PaymentsTab from '../../../admin/components/PaymentsTab'
import GenelBilgilerSection from './isletme/GenelBilgilerSection'
import UrunHizmetSection from './isletme/UrunHizmetSection'
import PersonelMesaiSection from './isletme/PersonelMesaiSection'
import StokBakimSection from './isletme/StokBakimSection'
import IsletmeOzetSection from './isletme/kpi/IsletmeOzetSection'
import s from './isletme/isletme.module.css'

export type IsletmeSection =
  | 'ozet'
  | 'genel'
  | 'urunler'
  | 'personel'
  | 'finans'
  | 'stok'
  | 'ayarlar'

type NavChipTone = 'brand' | 'mint' | 'amber' | 'violet' | 'coral'

export const ISLETME_SECTIONS: {
  id: IsletmeSection
  title: string
  subtitle: string
  icon: typeof Building2
  tone: NavChipTone
}[] = [
  {
    id: 'ozet',
    title: 'İşletme Özet',
    subtitle: 'Paket bilgileriniz ve tablolarınızdan canlı analiz kartları.',
    icon: LayoutDashboard,
    tone: 'brand',
  },
  {
    id: 'genel',
    title: 'Genel İşletme Bilgileri',
    subtitle: 'İşletme adı, amblem, kategori, konum, adres tarifi ve çalışma saatleri.',
    icon: Building2,
    tone: 'brand',
  },
  {
    id: 'urunler',
    title: 'Ürün ve Hizmet Bilgileri',
    subtitle: 'Sunduğunuz ürün ve hizmetleri başlık ve içerikle tanımlayın.',
    icon: Package,
    tone: 'mint',
  },
  {
    id: 'personel',
    title: 'Personel ve Mesai',
    subtitle: 'Ekibinizin zamanı ve yetkileri kontrolünüzde.',
    icon: Users,
    tone: 'violet',
  },
  {
    id: 'finans',
    title: 'Finans ve Raporlama',
    subtitle: 'Tahsilat, vadeli alacak ve giderler tek bakışta.',
    icon: Wallet,
    tone: 'amber',
  },
  {
    id: 'stok',
    title: 'Stok ve Bakım',
    subtitle: 'Envanter, kritik stok, isteğe bağlı SKT ve periyodik bakımlar.',
    icon: Boxes,
    tone: 'coral',
  },
  {
    id: 'ayarlar',
    title: 'Ayarlar ve Entegrasyonlar',
    subtitle: 'Bildirim önceliği, iletişim kanalları ve entegrasyon ayarları.',
    icon: Settings,
    tone: 'brand',
  },
]

export type SectionAccess = { visible: boolean; locked?: boolean }

const CHIP_TONE_CLASS: Record<NavChipTone, string> = {
  brand: s.navChipBrand,
  mint: s.navChipMint,
  amber: s.navChipAmber,
  violet: s.navChipViolet,
  coral: s.navChipCoral,
}

export default function IsletmeKayitlarTab({
  section,
  onSectionChange,
  access,
  onLocked,
  scope,
}: {
  section: IsletmeSection
  onSectionChange: (next: IsletmeSection) => void
  access: Partial<Record<IsletmeSection, SectionAccess>>
  onLocked: (featureTitle: string) => void
  /** localStorage kayıtlarını işletmeye göre ayırmak için (clinicId). */
  scope: string | null
}) {
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)

  useEffect(() => {
    setProfile(loadBusinessProfile(scope))
    setProfileLoaded(true)
  }, [scope])

  const profileFilled = isBusinessProfileFilled(profile)
  const completion = profileLoaded ? (profile ? profileCompletion(profile) : 0) : null

  const sections = ISLETME_SECTIONS.filter((x) => {
    if (x.id === 'ozet') return profileFilled && (access.ozet?.visible ?? true)
    return Boolean(access[x.id]?.visible)
  })
  const current = sections.find((x) => x.id === section) || sections[0]

  useEffect(() => {
    if (!profileLoaded) return
    if (current && current.id !== section) onSectionChange(current.id)
  }, [profileLoaded, current, section, onSectionChange])

  if (!current) {
    return (
      <div className={s.miniWindow}>
        <div className={s.windowBody}>
          <span className={s.muted}>Bu bölümü görüntüleme yetkiniz bulunmuyor.</span>
        </div>
      </div>
    )
  }

  const locked = Boolean(access[current.id]?.locked)
  const CurrentIcon = current.icon || Activity

  return (
    <div className={s.layout}>
      <nav className={s.moduleTabs} role="tablist" aria-label="İşletme ve kayıt bölümleri">
        <div className={s.moduleTabsHead}>
          <span className={s.moduleTabsHeadTitle}>İşletme ve Kayıtlar</span>
          <span className={s.moduleTabsCount}>{sections.length}</span>
        </div>
        <div className={s.moduleTabsList}>
          {sections.map((x, i) => {
            const Icon = x.icon || Activity
            const selected = x.id === current.id
            const isLocked = Boolean(access[x.id]?.locked)
            return (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={selected ? s.moduleTabActive : s.moduleTab}
                onClick={() => (isLocked ? onLocked(x.title) : onSectionChange(x.id))}
              >
                <span
                  className={selected ? s.navIconChipActive : `${s.navIconChip} ${CHIP_TONE_CLASS[x.tone]}`}
                  aria-hidden="true"
                >
                  <Icon size={14} strokeWidth={2.2} color="#ffffff" />
                </span>
                <span className={s.tabNo}>{i + 1}.</span>
                <span className={s.tabLabel}>{x.title}</span>
                <span className={s.tabMeta}>
                  {isLocked && <Lock size={12} color={selected ? '#ffffff' : undefined} />}
                  {x.id === 'genel' && completion !== null && completion < 100 && !selected && (
                    <span className={s.navPctPill}>%{completion}</span>
                  )}
                  {selected && <ChevronRight size={14} color="#ffffff" />}
                </span>
              </button>
            )
          })}
        </div>
      </nav>

      <div className={s.stage} role="tabpanel" aria-label={current.title}>
        <div className={s.miniWindow}>
          <div className={s.windowHeader}>
            <div className={s.windowHeaderLeft}>
              <span className={`${s.windowHeaderIcon} ${CHIP_TONE_CLASS[current.tone]}`}>
                <CurrentIcon size={17} strokeWidth={2.3} color="#ffffff" />
              </span>
              <div style={{ minWidth: 0 }}>
                <h2>{current.title}</h2>
                <p>{current.subtitle}</p>
              </div>
            </div>
            <span className={s.windowBadge}>
              {current.id === 'genel' && completion !== null ? `%${completion} tamamlandı` : 'İşletme ve Kayıtlar'}
            </span>
          </div>

          <div className={current.id === 'finans' ? s.windowBodyFlush : s.windowBody}>
            {locked ? (
              <div className={s.lockCard}>
                <Lock size={24} color="var(--accent)" />
                <h3>{current.title} Pro pakette</h3>
                <p>Bu modül mevcut paketinizde kapalı. Pro pakete geçerek tüm ekip, finans ve stok özelliklerini açabilirsiniz.</p>
                <button type="button" className={depth.btnPrimary} onClick={() => onLocked(current.title)}>
                  <span style={{ color: '#ffffff' }}>Paketleri incele</span>
                </button>
              </div>
            ) : current.id === 'ozet' && profile ? (
              <IsletmeOzetSection profile={profile} scope={scope} />
            ) : current.id === 'genel' ? (
              <GenelBilgilerSection scope={scope} onSaved={(p) => setProfile(p)} />
            ) : current.id === 'urunler' ? (
              <UrunHizmetSection scope={scope} />
            ) : current.id === 'personel' ? (
              <PersonelMesaiSection />
            ) : current.id === 'finans' ? (
              <PaymentsTab />
            ) : current.id === 'ayarlar' ? (
              <IntegrationsTab apiPrefix="/api/yonetici/integrations" />
            ) : (
              <StokBakimSection />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
