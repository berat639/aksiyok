'use client'

import { useEffect, useState } from 'react'
import { Building2, CheckCircle2, Clock, MapPin, Save } from 'lucide-react'
import {
  calendarEnvelope,
  emptyBusinessProfile,
  loadBusinessProfile,
  profileCompletion,
  saveBusinessProfile,
  validateProfile,
  weeklyHoursFromCalendar,
  WEEK_DAYS_SHORT,
  type BusinessProfile,
  type ProfileIssues,
} from '@/lib/business-profile'
import depth from '@/styles/clinic-depth.module.css'
import InfoTooltip from '../../../../admin/components/ui/InfoTooltip'
import CategoryPicker from './CategoryPicker'
import LocationCard from './LocationCard'
import WorkingHoursEditor from './WorkingHoursEditor'
import s from './isletme.module.css'

export default function GenelBilgilerSection({ scope, onSaved }: { scope: string | null; onSaved?: (p: BusinessProfile) => void }) {
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
  const [issues, setIssues] = useState<ProfileIssues>({})
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')
  const [syncNote, setSyncNote] = useState('')

  useEffect(() => {
    const stored = loadBusinessProfile(scope)
    if (stored) { setProfile(stored); return }
    let alive = true
    setProfile(emptyBusinessProfile())
    fetch('/api/calendar/working-hours', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => { if (alive && cfg) setProfile((p) => (p ? { ...p, hours: weeklyHoursFromCalendar(cfg) } : p)) })
      .catch(() => {})
    return () => { alive = false }
  }, [scope])

  if (!profile) return <span className={s.muted}>Yükleniyor…</span>

  const update = (patch: Partial<BusinessProfile>) => {
    setProfile({ ...profile, ...patch })
    setDirty(true)
    setNotice('')
    if (Object.keys(issues).length) setIssues(validateProfile({ ...profile, ...patch }))
  }

  const save = async () => {
    const found = validateProfile(profile)
    setIssues(found)
    if (Object.keys(found).length) { setNotice(''); return }
    const saved = saveBusinessProfile(profile, scope)
    setProfile(saved)
    setDirty(false)
    setNotice('Genel işletme bilgileri kaydedildi.')
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
    <div className={s.stack}>
      <div className={s.panelCard}>
        <h3 className={s.sectionTitle}><Building2 size={14} color="var(--accent)" /> İşletme adı ve kategorisi</h3>
        <div className={s.field}>
          <div className={`${s.fieldBox} ${issues.name ? s.fieldBoxInvalid : ''}`}>
            <label className={s.fieldLabel} htmlFor="isletme-adi">İşletme adı*</label>
            <input
              id="isletme-adi"
              className={s.fieldInput}
              value={profile.name}
              maxLength={120}
              placeholder="İşletme adı"
              onChange={(e) => update({ name: e.target.value })}
            />
          </div>
          {issues.name && <p className={s.error}>{issues.name}</p>}
        </div>

        <CategoryPicker
          primary={profile.primaryCategory}
          extras={profile.extraCategories}
          invalid={issues.primaryCategory}
          onChange={({ primary, extras }) => update({ primaryCategory: primary, extraCategories: extras })}
        />
      </div>

      <div className={s.panelCard}>
        <h3 className={s.sectionTitle}><MapPin size={14} color="var(--accent)" /> Konum ve adres</h3>
        <LocationCard value={profile.location} invalid={issues.location} onChange={(location) => update({ location })} />

        <div className={s.field}>
          <div className={s.fieldBox} style={{ alignItems: 'flex-start' }}>
            <label className={s.fieldLabel} htmlFor="isletme-adres-tarifi">Tam Adres Tarifi</label>
            <textarea
              id="isletme-adres-tarifi"
              className={s.fieldTextarea}
              value={profile.addressDirections}
              maxLength={600}
              placeholder="ör. Yıldızevler Mah. 712. Sk. No:5 Kat:4 Daire:8, Çankaya/Ankara. Eczanenin yanındaki girişten asansörle 4. kat."
              onChange={(e) => update({ addressDirections: e.target.value })}
            />
          </div>
          <p className={s.helper}>Bina, kat, daire ve giriş tarifini yazın; asistan müşterilere yol tarifi verirken bunu kullanır.</p>
        </div>
      </div>

      <div className={s.panelCard}>
        <div className={s.topBar}>
          <h3 className={s.sectionTitle}>
            <Clock size={14} color="var(--accent)" /> Çalışma saatleri
            <InfoTooltip title="Çalışma saatleri">
              Açık günleri seçip açılış ve kapanış saatlerini belirleyin. İsterseniz “Günlere özel saat belirle” ile her gün için ayrı saat aralığı verebilirsiniz.
            </InfoTooltip>
          </h3>
          <span className={depth.badge}>
            {profile.hours.map((d, i) => (d.open ? WEEK_DAYS_SHORT[i] : null)).filter(Boolean).join(', ') || 'Tüm günler kapalı'}
          </span>
        </div>
        <WorkingHoursEditor value={profile.hours} onChange={(hours) => update({ hours })} />
        {issues.hours && <p className={s.error}>{issues.hours}</p>}
      </div>

      <div className={s.saveBar}>
        <span className={s.muted}>Profil doluluğu: %{profileCompletion(profile)}</span>
        {syncNote && <span className={s.muted}>{syncNote}</span>}
        {notice && <span className={s.success}><CheckCircle2 size={14} /> {notice}</span>}
        {Object.keys(issues).length > 0 && <span className={s.error} style={{ margin: 0 }}>Eksik alanları tamamlayın.</span>}
        <button type="button" className={depth.btnPrimary} onClick={save} disabled={!dirty && !Object.keys(issues).length && Boolean(profile.updatedAt)}>
          <Save size={13} color="#ffffff" />
          <span style={{ color: '#ffffff' }}>Kaydet</span>
        </button>
      </div>
    </div>
  )
}
