'use client'

import { useEffect, useRef, useState } from 'react'
import { Building2, Camera, CheckCircle2, Clock, Loader2, Lock, MapPin, Navigation, Plus, Save, Trash2 } from 'lucide-react'
import {
  calendarEnvelope,
  emptyBusinessProfile,
  formatDayHours,
  loadBusinessProfile,
  profileCompletion,
  saveBusinessProfile,
  validateExtraBusiness,
  validateProfile,
  weeklyHoursFromCalendar,
  WEEK_DAYS_SHORT,
  type BusinessProfile,
  type ExtraBusiness,
  type ProfileIssues,
} from '@/lib/business-profile'
import InfoTooltip from '../../../../admin/components/ui/InfoTooltip'
import CategoryPicker from './CategoryPicker'
import LocationCard from './LocationCard'
import WorkingHoursEditor from './WorkingHoursEditor'
import s from './isletme.module.css'

export default function GenelBilgilerSection({ scope, onSaved }: { scope: string | null; onSaved?: (p: BusinessProfile) => void }) {
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
  const [activeId, setActiveId] = useState<string>('primary')
  const [issues, setIssues] = useState<ProfileIssues>({})
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')
  const [syncNote, setSyncNote] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoErr, setLogoErr] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoNotice, setLogoNotice] = useState<{ kind: 'good' | 'err'; text: string } | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/admin/settings/branding', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data?.logoUrl) {
          setLogoUrl(data.logoUrl)
          setLogoErr(false)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [scope])

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingLogo(true)
    setLogoNotice(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/admin/settings/logo-upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        throw new Error(data.error || 'İşletme logosu yüklenemedi.')
      }
      setLogoUrl(data.logoUrl)
      setLogoErr(false)
      setLogoNotice({ kind: 'good', text: 'İşletme logosu güncellendi.' })
      window.dispatchEvent(new CustomEvent('business-branding-logo-updated', { detail: data.logoUrl }))
      setTimeout(() => setLogoNotice(null), 4000)
    } catch (err) {
      setLogoNotice({
        kind: 'err',
        text: err instanceof Error ? err.message : 'İşletme logosu yüklenemedi.',
      })
    } finally {
      setUploadingLogo(false)
    }
  }

  useEffect(() => {
    const stored = loadBusinessProfile(scope)
    if (stored) {
      setProfile(stored)
      return
    }
    let alive = true
    setProfile(emptyBusinessProfile())
    fetch('/api/calendar/working-hours', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (alive && cfg) setProfile((p) => (p ? { ...p, hours: weeklyHoursFromCalendar(cfg) } : p))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [scope])

  if (!profile) return <span className={s.muted}>Yükleniyor…</span>

  const extras = profile.extraBusinesses ?? []
  const activeExtra = activeId === 'primary' ? null : extras.find((b) => b.id === activeId) ?? null
  const isPrimary = !activeExtra
  const activeUnit = activeExtra ?? profile
  const completion = profileCompletion(profile)
  const activeExtraIdx = activeExtra ? extras.findIndex((b) => b.id === activeExtra.id) : -1
  const activeDisplayName =
    activeUnit.name.trim() || (isPrimary ? 'Ana İşletme' : `İşletme ${activeExtraIdx + 2}`)
  const todayIdx = (new Date().getDay() + 6) % 7
  const todaySummary = activeUnit.hours[todayIdx] ? formatDayHours(activeUnit.hours[todayIdx]!) : '—'

  const updatePrimary = (patch: Partial<BusinessProfile>) => {
    const next = { ...profile, ...patch }
    setProfile(next)
    setDirty(true)
    setNotice('')
    if (Object.keys(issues).length) setIssues(validateProfile(next))
  }

  const updateExtra = (id: string, patch: Partial<ExtraBusiness>) => {
    const nextExtras = extras.map((b) => (b.id === id ? { ...b, ...patch } : b))
    const next = { ...profile, extraBusinesses: nextExtras }
    setProfile(next)
    setDirty(true)
    setNotice('')
    const updated = nextExtras.find((b) => b.id === id)
    if (updated && Object.keys(issues).length) setIssues(validateExtraBusiness(updated))
  }

  const updateActive = (patch: Partial<Pick<ExtraBusiness, 'name' | 'location' | 'addressDirections' | 'hours'>>) => {
    if (isPrimary) updatePrimary(patch)
    else updateExtra(activeExtra.id, patch)
  }

  const addBusiness = () => {
    if (!profile.primaryCategory.trim()) {
      setIssues({ ...issues, primaryCategory: 'Yeni işletme eklemek için önce ana kategori seçin.' })
      return
    }
    const nextBiz: ExtraBusiness = {
      id: `biz-${Date.now().toString(36)}`,
      name: '',
      location: null,
      addressDirections: '',
      hours: profile.hours.map((d) => ({ open: d.open, ranges: d.ranges.map((r) => ({ ...r })) })),
    }
    setProfile({ ...profile, extraBusinesses: [...extras, nextBiz] })
    setActiveId(nextBiz.id)
    setIssues({})
    setDirty(true)
    setNotice('')
  }

  const removeActiveExtra = () => {
    if (!activeExtra) return
    const nextExtras = extras.filter((b) => b.id !== activeExtra.id)
    setProfile({ ...profile, extraBusinesses: nextExtras })
    setActiveId('primary')
    setIssues({})
    setDirty(true)
    setNotice('')
  }

  const save = async () => {
    const primaryIssues = validateProfile(profile)
    if (Object.keys(primaryIssues).length) {
      setActiveId('primary')
      setIssues(primaryIssues)
      setNotice('')
      return
    }
    for (const extra of extras) {
      const exIssues = validateExtraBusiness(extra)
      if (Object.keys(exIssues).length) {
        setActiveId(extra.id)
        setIssues(exIssues)
        setNotice('')
        return
      }
    }

    setIssues({})
    const saved = saveBusinessProfile(profile, scope)
    setProfile(saved)
    setDirty(false)
    setNotice(extras.length > 0 ? 'Tüm işletme bilgileri kaydedildi.' : 'Genel işletme bilgileri kaydedildi.')
    onSaved?.(saved)

    const envelope = calendarEnvelope(saved.hours)
    if (!envelope) return
    setSyncNote('')
    try {
      const res = await fetch('/api/admin/settings/working-hours', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(envelope),
      })
      const data = await res.json().catch(() => null)
      if (res.ok) {
        window.dispatchEvent(new CustomEvent('clinicWorkingHoursUpdated', { detail: data?.workingHours || data }))
        setSyncNote(`Takvim saat aralığı ${envelope.startTime}–${envelope.endTime} olarak eşitlendi.`)
      } else {
        setSyncNote(data?.error || 'Takvim saat aralığı güncellenemedi; bilgiler bu cihazda kaydedildi.')
      }
    } catch {
      setSyncNote('Takvim saat aralığı güncellenemedi; bilgiler bu cihazda kaydedildi.')
    }
  }

  return (
    <div className={s.genelWrap}>
      {/* Üst İşletme Şeridi — Facebook tarzı tıklanabilir işletme logosu avatarı */}
      <div className={s.genelHero}>
        <div className={s.genelHeroMain}>
          <div className={s.genelHeroLeft}>
            <div className={s.heroAvatarBox}>
              <button
                type="button"
                className={s.heroAvatarBtn}
                disabled={uploadingLogo}
                aria-label={logoUrl && !logoErr ? 'İşletme logosunu değiştir' : 'İşletme logosu yükle'}
                title="İşletme logosu yüklemek veya değiştirmek için tıklayın (PNG, JPG, WEBP · maks. 2 MB)"
                onClick={() => logoInputRef.current?.click()}
              >
                {logoUrl && !logoErr ? (
                  <img
                    src={logoUrl}
                    alt={`${activeDisplayName} logosu`}
                    className={s.heroAvatarImg}
                    onError={() => setLogoErr(true)}
                  />
                ) : (
                  <Building2 size={24} strokeWidth={2.2} color="#ffffff" />
                )}
                <span className={s.heroAvatarCam} aria-hidden="true">
                  {uploadingLogo ? (
                    <Loader2 size={11} color="#0e2152" className={s.avatarSpin} />
                  ) : (
                    <Camera size={11} color="#0e2152" />
                  )}
                </span>
              </button>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="İşletme logosu dosyası"
                style={{ display: 'none' }}
                onChange={(e) => void handleLogoUpload(e)}
                disabled={uploadingLogo}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className={s.genelHeroTitleRow}>
                <h3 className={s.genelHeroName}>{activeDisplayName}</h3>
                {profile.primaryCategory && (
                  <span className={s.genelHeroPill}>{profile.primaryCategory}</span>
                )}
                {extras.length > 0 && (
                  <span className={s.genelHeroPill}>+{extras.length} şube</span>
                )}
                <InfoTooltip title="İşletme Logosu ve Şubeler" glyph="?">
                  Soldaki yuvarlak ambleme tıklayarak işletme logonuzu yükleyebilirsiniz; yüklenen logo anasayfadaki asistan ekranında da otomatik görünür. Ana işletmenizle aynı kategoride birden fazla şube ekleyebilirsiniz.
                </InfoTooltip>
              </div>
              <div className={s.genelHeroMeta}>
                {activeUnit.location?.address && (
                  <span className={s.genelHeroMetaItem}>
                    <MapPin size={12} color="#ffffff" />
                    <span>{activeUnit.location.address}</span>
                  </span>
                )}
                <span className={s.genelHeroMetaItem}>
                  <Clock size={12} color="#ffffff" />
                  <span>Bugün: {todaySummary}</span>
                </span>
                {logoNotice && (
                  <span
                    role="status"
                    className={logoNotice.kind === 'good' ? s.genelHeroPill : s.heroLogoErrPill}
                  >
                    {logoNotice.text}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className={s.genelHeroActions}>
            <button type="button" className={s.genelHeroPrimaryBtn} onClick={addBusiness}>
              <Plus size={15} strokeWidth={2.5} color="#0e2152" />
              <span>İşletme Ekle</span>
            </button>
          </div>
        </div>

        {extras.length > 0 && (
          <div className={s.genelHeroTabs} role="group" aria-label="İşletmeler ve şubeler">
            <button
              type="button"
              aria-pressed={isPrimary}
              className={isPrimary ? s.genelHeroTabOn : s.genelHeroTab}
              onClick={() => {
                setActiveId('primary')
                setIssues({})
              }}
            >
              <Building2 size={13} color={isPrimary ? '#0e2152' : '#ffffff'} />
              <span>{profile.name.trim() || 'Ana İşletme'}</span>
            </button>

            {extras.map((biz, idx) => {
              const on = activeId === biz.id
              return (
                <button
                  key={biz.id}
                  type="button"
                  aria-pressed={on}
                  className={on ? s.genelHeroTabOn : s.genelHeroTab}
                  onClick={() => {
                    setActiveId(biz.id)
                    setIssues({})
                  }}
                >
                  <Building2 size={13} color={on ? '#0e2152' : '#ffffff'} />
                  <span>{biz.name.trim() || `İşletme ${idx + 2}`}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className={s.genelGrid}>
        {/* Sol Sütun: İşletme Adı/Kategori + Çalışma Saatleri + Tam Adres Tarifi */}
        <div className={s.genelCol}>
          <section className={s.genelCard}>
            <header className={s.genelCardHead}>
              <div className={s.genelCardTitleGroup}>
                <span className={`${s.genelIconChip} ${s.genelChipBrand}`} aria-hidden="true">
                  <Building2 size={17} strokeWidth={2.3} color="#ffffff" />
                </span>
                <div className={s.genelCardTitleRow}>
                  <h3 className={s.genelCardTitle}>İşletme adı ve kategorisi</h3>
                </div>
              </div>
              {!isPrimary && (
                <button
                  type="button"
                  className={s.genelIconToolBtn}
                  title="Bu işletmeyi kaldır"
                  aria-label="Bu işletmeyi kaldır"
                  style={{ color: 'var(--danger)' }}
                  onClick={removeActiveExtra}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </header>

            <div className={s.field}>
              <label className={s.fieldLabel} htmlFor="isletme-adi">İşletme adı*</label>
              <div className={`${s.fieldBox} ${issues.name ? s.fieldBoxInvalid : ''}`}>
                <input
                  id="isletme-adi"
                  className={s.fieldInput}
                  value={activeUnit.name}
                  maxLength={120}
                  placeholder={isPrimary ? 'İşletme adı' : 'Örn. Online Emlaktan — Şube'}
                  onChange={(e) => updateActive({ name: e.target.value })}
                />
              </div>
              {issues.name && <p className={s.error}>{issues.name}</p>}
            </div>

            {isPrimary ? (
              <CategoryPicker
                primary={profile.primaryCategory}
                invalid={issues.primaryCategory}
                onChange={(primary) =>
                  updatePrimary({ primaryCategory: primary, extraCategories: [] })
                }
              />
            ) : (
              <div className={s.lockedCategoryBox}>
                <div className={s.row} style={{ gap: 6 }}>
                  <Lock size={13} color="var(--foreground-2)" />
                  <span className={s.muted}>Ortak kategori:</span>
                  <span className={s.catChipPrimary}>{profile.primaryCategory}</span>
                </div>
                <InfoTooltip title="Aynı kategori kuralı" glyph="?">
                  Ek işletmeler ana işletmenizle aynı kategoride olmalıdır. Kategoriyi ana işletmeden değiştirebilirsiniz.
                </InfoTooltip>
              </div>
            )}
          </section>

          <section className={s.genelCard}>
            <header className={s.genelCardHead}>
              <div className={s.genelCardTitleGroup}>
                <span className={`${s.genelIconChip} ${s.genelChipMint}`} aria-hidden="true">
                  <Clock size={17} strokeWidth={2.3} color="#ffffff" />
                </span>
                <div className={s.genelCardTitleRow}>
                  <h3 className={s.genelCardTitle}>Çalışma saatleri</h3>
                  <InfoTooltip title="Çalışma saatleri" glyph="?">
                    Açık günleri seçip açılış ve kapanış saatlerini belirleyin. İsterseniz “Günlere özel saat belirle” ile her gün için ayrı saat aralığı verebilirsiniz.
                  </InfoTooltip>
                </div>
              </div>
              <span className={s.genelWellPill}>
                {activeUnit.hours.map((d, i) => (d.open ? WEEK_DAYS_SHORT[i] : null)).filter(Boolean).join(', ') || 'Kapalı'}
              </span>
            </header>
            <WorkingHoursEditor value={activeUnit.hours} onChange={(hours) => updateActive({ hours })} />
            {issues.hours && <p className={s.error}>{issues.hours}</p>}
          </section>

          <section className={s.genelCard}>
            <header className={s.genelCardHead}>
              <div className={s.genelCardTitleGroup}>
                <span className={`${s.genelIconChip} ${s.genelChipAmber}`} aria-hidden="true">
                  <Navigation size={17} strokeWidth={2.3} color="#ffffff" />
                </span>
                <div className={s.genelCardTitleRow}>
                  <label className={s.genelCardTitle} htmlFor="isletme-adres-tarifi">Tam Adres Tarifi</label>
                  <InfoTooltip title="Tam Adres Tarifi" glyph="?">
                    Bina, kat, daire ve giriş tarifini yazın; asistan müşterilere yol tarifi verirken bunu kullanır.
                  </InfoTooltip>
                </div>
              </div>
            </header>
            <div className={s.field}>
              <div className={s.fieldBox} style={{ alignItems: 'flex-start' }}>
                <textarea
                  id="isletme-adres-tarifi"
                  aria-label="Tam Adres Tarifi"
                  className={s.fieldTextarea}
                  value={activeUnit.addressDirections}
                  maxLength={600}
                  placeholder="ör. Yıldızevler Mah. 712. Sk. No:5 Kat:4 Daire:8, Çankaya/Ankara. Eczanenin yanındaki girişten asansörle 4. kat."
                  onChange={(e) => updateActive({ addressDirections: e.target.value })}
                />
              </div>
              <p className={s.helper}>Bina, kat, daire ve giriş tarifini yazın; asistan müşterilere yol tarifi verirken bunu kullanır.</p>
            </div>
          </section>
        </div>

        {/* Sağ Sütun: Tam Boy İşletme Konumu ve Google Harita */}
        <section className={s.genelMapCard}>
          <header className={s.genelCardHead}>
            <div className={s.genelCardTitleGroup}>
              <span className={`${s.genelIconChip} ${s.genelChipViolet}`} aria-hidden="true">
                <MapPin size={17} strokeWidth={2.3} color="#ffffff" />
              </span>
              <div className={s.genelCardTitleRow}>
                <h3 className={s.genelCardTitle}>Konum ve Google Harita</h3>
              </div>
            </div>
          </header>
          <LocationCard
            key={activeId}
            value={activeUnit.location}
            invalid={issues.location}
            onChange={(location) => updateActive({ location })}
          />
        </section>
      </div>

      <div className={s.genelSaveBar}>
        <div className={s.row} style={{ gap: 10 }}>
          <span className={s.muted}>Profil doluluğu: <strong>%{completion}</strong></span>
          <div className={s.progressBar} aria-hidden="true">
            <div className={s.progressFill} style={{ width: `${completion}%` }} />
          </div>
          {syncNote && <span className={s.muted}>{syncNote}</span>}
        </div>
        <div className={s.row} style={{ gap: 8 }}>
          {notice && <span className={s.genelSuccessPill}><CheckCircle2 size={14} /> {notice}</span>}
          {Object.keys(issues).length > 0 && <span className={s.error} style={{ margin: 0 }}>Eksik alanları tamamlayın.</span>}
          <button type="button" className={s.genelSaveBtn} onClick={save} disabled={!dirty && !Object.keys(issues).length && Boolean(profile.updatedAt)}>
            <Save size={14} color="#ffffff" />
            <span style={{ color: '#ffffff' }}>Kaydet</span>
          </button>
        </div>
      </div>
    </div>
  )
}
