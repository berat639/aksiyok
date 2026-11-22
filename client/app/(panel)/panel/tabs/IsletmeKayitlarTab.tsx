'use client'

import { useEffect, useState } from 'react'
import { Activity, Boxes, Building2, ChevronRight, Lock, Package, Users, Wallet } from 'lucide-react'
import { loadBusinessProfile, profileCompletion } from '@/lib/business-profile'
import depth from '@/styles/clinic-depth.module.css'
import PaymentsTab from '../../../admin/components/PaymentsTab'
import GenelBilgilerSection from './isletme/GenelBilgilerSection'
import UrunHizmetSection from './isletme/UrunHizmetSection'
import PersonelMesaiSection from './isletme/PersonelMesaiSection'
import StokBakimSection from './isletme/StokBakimSection'
import s from './isletme/isletme.module.css'

export type IsletmeSection = 'genel' | 'urunler' | 'personel' | 'finans' | 'stok'

export const ISLETME_SECTIONS: { id: IsletmeSection; title: string; subtitle: string; icon: typeof Building2 }[] = [
  { id: 'genel', title: 'Genel İşletme Bilgileri', subtitle: 'İşletme adı, kategori, konum, adres tarifi ve çalışma saatleri.', icon: Building2 },
  { id: 'urunler', title: 'Ürün ve Hizmet Bilgileri', subtitle: 'Sunduğunuz ürün ve hizmetleri başlık ve içerikle tanımlayın.', icon: Package },
  { id: 'personel', title: 'Personel ve Mesai', subtitle: 'Ekibinizin zamanı ve yetkileri kontrolünüzde.', icon: Users },
  { id: 'finans', title: 'Finans ve Raporlama', subtitle: 'Tahsilat, vadeli alacak ve giderler tek bakışta.', icon: Wallet },
  { id: 'stok', title: 'Stok ve Bakım', subtitle: 'Envanter, kritik stok, isteğe bağlı SKT ve periyodik bakımlar.', icon: Boxes },
]

export type SectionAccess = { visible: boolean; locked?: boolean }

export default function IsletmeKayitlarTab({
  section,
  onSectionChange,
  access,
  onLocked,
  scope,
}: {
  section: IsletmeSection
  onSectionChange: (next: IsletmeSection) => void
  access: Record<IsletmeSection, SectionAccess>
  onLocked: (featureTitle: string) => void
  /** localStorage kayıtlarını işletmeye göre ayırmak için (clinicId). */
  scope: string | null
}) {
  const sections = ISLETME_SECTIONS.filter((x) => access[x.id]?.visible)
  const current = sections.find((x) => x.id === section) || sections[0]
  const [completion, setCompletion] = useState<number | null>(null)

  useEffect(() => {
    const p = loadBusinessProfile(scope)
    setCompletion(p ? profileCompletion(p) : 0)
  }, [scope])

  useEffect(() => {
    if (current && current.id !== section) onSectionChange(current.id)
  }, [current, section, onSectionChange])

  if (!current) {
    return <div className={s.miniWindow}><div className={s.windowBody}><span className={s.muted}>Bu bölümü görüntüleme yetkiniz bulunmuyor.</span></div></div>
  }

  const locked = Boolean(access[current.id]?.locked)

  return (
    <div className={s.layout}>
      <nav className={s.moduleTabs} role="tablist" aria-label="İşletme ve kayıt bölümleri">
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
              <Icon size={16} />
              <span className={s.tabNo}>{i + 1}.</span>
              <span className={s.tabLabel}>{x.title}</span>
              <span className={s.tabMeta}>
                {isLocked && <Lock size={12} />}
                {x.id === 'genel' && completion !== null && completion < 100 && !selected && (
                  <span className={depth.badge} style={{ padding: '1px 6px', fontSize: 10 }}>%{completion}</span>
                )}
                {selected && <ChevronRight size={15} />}
              </span>
            </button>
          )
        })}
      </nav>

      <div className={s.stage} role="tabpanel" aria-label={current.title}>
        <div className={s.stageHead}>
          <div>
            <h2>{current.title}</h2>
            <p>{current.subtitle}</p>
          </div>
          <span className={depth.badge}>İşletme ve Kayıtlar</span>
        </div>

        <div className={s.miniWindow}>
          <div className={s.windowBar}>
            <strong>axamaz · {current.title}</strong>
            <span className={s.muted}>
              {current.id === 'genel' && completion !== null ? `%${completion} tamamlandı` : 'İşletme yönetimi'}
            </span>
          </div>
          <div className={s.windowBody}>
            {locked ? (
              <div className={s.lockCard}>
                <Lock size={24} color="var(--accent)" />
                <h3>{current.title} Pro pakette</h3>
                <p>Bu modül mevcut paketinizde kapalı. Pro pakete geçerek tüm ekip ve finans özelliklerini açabilirsiniz.</p>
                <button type="button" className={depth.btnPrimary} onClick={() => onLocked(current.title)}>
                  <span style={{ color: '#ffffff' }}>Paketleri incele</span>
                </button>
              </div>
            ) : current.id === 'genel' ? (
              <GenelBilgilerSection scope={scope} onSaved={(p) => setCompletion(profileCompletion(p))} />
            ) : current.id === 'urunler' ? (
              <UrunHizmetSection scope={scope} />
            ) : current.id === 'personel' ? (
              <PersonelMesaiSection />
            ) : current.id === 'finans' ? (
              <PaymentsTab />
            ) : (
              <StokBakimSection />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
