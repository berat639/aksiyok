'use client'

import { useEffect, useRef, useState } from 'react'
import { Info, LocateFixed, MapPin, Pencil, Search, X } from 'lucide-react'
import type { BusinessLocation } from '@/lib/business-profile'
import { labelFor, searchPlaces } from '@/lib/places-tr'
import depth from '@/styles/clinic-depth.module.css'
import GoogleMapView from './GoogleMapView'
import s from './isletme.module.css'

type GeoResult = { title: string; address: string; lat: number; lng: number }

async function searchWithGoogleMaps(q: string): Promise<GeoResult[]> {
  const maps = typeof window !== 'undefined' ? window.google?.maps : null
  const out: GeoResult[] = []

  if (maps?.Geocoder) {
    try {
      const geocoder = new maps.Geocoder()
      const res = await new Promise<any[]>((resolve) => {
        geocoder.geocode({ address: q, region: 'TR', language: 'tr' }, (items: any, status: string) => {
          resolve(status === 'OK' && Array.isArray(items) ? items : [])
        })
      })
      for (const item of res.slice(0, 5)) {
        const loc = item?.geometry?.location
        if (!loc) continue
        const address = String(item.formatted_address || '')
        const title = String(address.split(',')[0] || q).trim()
        out.push({ title, address, lat: Number(loc.lat().toFixed(6)), lng: Number(loc.lng().toFixed(6)) })
      }
    } catch { /* yerel semt yedeğine geç */ }
  }

  if (out.length === 0) {
    for (const p of searchPlaces(q)) {
      out.push({ title: p.label.split(',')[0] || p.label, address: p.label, lat: p.lat, lng: p.lng })
    }
  }
  return out
}

async function reverseWithGoogleMaps(lat: number, lng: number): Promise<string> {
  const maps = typeof window !== 'undefined' ? window.google?.maps : null
  if (maps?.Geocoder) {
    try {
      const geocoder = new maps.Geocoder()
      const addr = await new Promise<string | null>((resolve) => {
        geocoder.geocode({ location: { lat, lng }, language: 'tr' }, (items: any, status: string) => {
          resolve(status === 'OK' && Array.isArray(items) && items[0]?.formatted_address ? String(items[0].formatted_address) : null)
        })
      })
      if (addr) return addr
    } catch { /* yerel semt yedeğine geç */ }
  }
  return labelFor({ lat, lng })
}

/** "İşletme konumu" kartı: ana sayfadaki gibi Google Maps ile arama, tıklama/sürükleme ve GPS konumu. */
export default function LocationCard({
  value,
  onChange,
  invalid,
}: {
  value: BusinessLocation | null
  onChange: (loc: BusinessLocation | null) => void
  invalid?: string
}) {
  const [editing, setEditing] = useState(!value)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[]>([])
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  const [banner, setBanner] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pickSeq = useRef(0)

  const runSearch = (q: string) => {
    setLoading(true)
    searchWithGoogleMaps(q)
      .then((list) => setResults(list))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = query.trim()
    if (q.length < 2) { setResults([]); setLoading(false); return }
    setLoading(true)
    timer.current = setTimeout(() => runSearch(q), 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query])

  const choose = (loc: BusinessLocation, message: string, closeEditor = true) => {
    onChange(loc)
    if (closeEditor) setEditing(false)
    setQuery('')
    setResults([])
    setNote('')
    setBanner(message)
  }

  const pickCoordinates = async (lat: number, lng: number, bannerMsg: string, closeEditor = false) => {
    const seq = ++pickSeq.current
    onChange({ lat, lng, address: labelFor({ lat, lng }) })
    if (closeEditor) setEditing(false)
    setNote('Adres çözümleniyor…')
    setBanner(bannerMsg)
    const resolved = await reverseWithGoogleMaps(lat, lng)
    if (pickSeq.current !== seq) return
    onChange({ lat, lng, address: resolved })
    setNote('')
  }

  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setNote('Tarayıcınız konum paylaşımını desteklemiyor; haritaya tıklayarak seçebilirsiniz.')
      return
    }
    setNote('Konumunuz alınıyor…')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = Number(p.coords.latitude.toFixed(6))
        const lng = Number(p.coords.longitude.toFixed(6))
        void pickCoordinates(
          lat,
          lng,
          'İşletmenizin bulunduğu konum Google Harita üzerinde cihaz konumunuza göre güncellendi.',
          true,
        )
      },
      () => setNote('Konum izni verilmedi; haritaya tıklayarak veya adres arayarak seçebilirsiniz.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className={s.stack} style={{ gap: 12 }}>
      <div className={s.locHead}>
        İşletme konumu
        {!editing && (
          <button type="button" className={s.iconBtn} aria-label="İşletme konumunu düzenle" onClick={() => setEditing(true)}>
            <Pencil size={15} />
          </button>
        )}
      </div>

      {banner && (
        <div className={s.infoBanner} role="status">
          <Info size={20} />
          <p>{banner}</p>
          <button type="button" className={s.bannerAction} onClick={() => setBanner('')}>Tamam</button>
        </div>
      )}

      {editing && (
        <div className={s.field}>
          <div className={`${s.fieldBox} ${invalid && !value ? s.fieldBoxInvalid : ''}`}>
            <label className={s.fieldLabel} htmlFor="isletme-konum-ara">Adres veya semt ara</label>
            <Search size={16} color="var(--foreground-3)" />
            <input
              id="isletme-konum-ara"
              className={s.fieldInput}
              value={query}
              autoComplete="off"
              placeholder="ör. Yıldızevler Çankaya veya Kadıköy"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim().length >= 2) {
                  e.preventDefault()
                  if (timer.current) clearTimeout(timer.current)
                  runSearch(query.trim())
                }
              }}
            />
            {value && (
              <button type="button" className={s.iconBtn} aria-label="Düzenlemeyi kapat" onClick={() => { setEditing(false); setQuery('') }}>
                <X size={15} />
              </button>
            )}
          </div>
          {(loading || results.length > 0 || (query.trim().length >= 2 && !loading)) && (
            <div className={s.dropdown} role="listbox" aria-label="Adres önerileri">
              {loading ? (
                <div className={s.dropdownEmpty}>Adresler aranıyor…</div>
              ) : results.length ? (
                results.map((r) => (
                  <button
                    key={`${r.lat},${r.lng},${r.address}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={s.dropdownItem}
                    onClick={() => choose({ lat: r.lat, lng: r.lng, address: r.address }, 'İşletmenizin bulunduğu konum Google tarafından güncellendi.')}
                  >
                    <span style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <MapPin size={16} style={{ marginTop: 2, flexShrink: 0 }} />
                      <span>{r.title}<small>{r.address}</small></span>
                    </span>
                  </button>
                ))
              ) : (
                <div className={s.dropdownEmpty}>Sonuç bulunamadı. Harita üzerinde doğrudan tıklayarak işaretleyebilirsiniz.</div>
              )}
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className={s.row}>
          <button type="button" className={depth.btn} onClick={useMyLocation}>
            <LocateFixed size={14} /> Konumumu kullan
          </button>
          {note ? <span className={s.muted}>{note}</span> : <span className={s.muted}>veya harita üzerinde nokta işaretleyin</span>}
        </div>
      )}

      {value && <p className={s.address}>{value.address}</p>}
      {invalid && !value && <p className={s.error}>{invalid}</p>}

      <div className={s.mapFrame}>
        <GoogleMapView
          value={value ? { lat: value.lat, lng: value.lng } : null}
          onPick={(pt) => {
            void pickCoordinates(
              pt.lat,
              pt.lng,
              'İşletmenizin bulunduğu konum Google Harita üzerinde işaretlendi.',
              false,
            )
          }}
        />
      </div>
    </div>
  )
}
