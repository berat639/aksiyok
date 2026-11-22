'use client'

import { useEffect, useRef, useState } from 'react'
import { DARK_MAP_STYLES, hasGoogleMapsKey, loadGoogleMaps } from '@/lib/google-maps-loader'
import s from './isletme.module.css'

export type MapPoint = { lat: number; lng: number }

const DEFAULT_CENTER: MapPoint = { lat: 39.1, lng: 34.8 }
const DEFAULT_ZOOM = 6
const PIN_ZOOM = 16

function useThemeDark(): boolean {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const read = () => setDark((document.documentElement.getAttribute('data-theme') ?? 'dark') === 'dark')
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

const googleEmbedUrl = (point: MapPoint | null) =>
  point
    ? `https://maps.google.com/maps?q=${point.lat},${point.lng}&z=${PIN_ZOOM}&hl=tr&output=embed`
    : `https://maps.google.com/maps?q=${DEFAULT_CENTER.lat},${DEFAULT_CENTER.lng}&z=${DEFAULT_ZOOM}&hl=tr&output=embed`

/**
 * Ana sayfadaki gibi Google Maps JavaScript API haritası.
 * Anahtar yoksa veya alan adı engellenirse Google Maps gömülü görünümüne düşer.
 */
export default function GoogleMapView({
  value,
  onPick,
}: {
  value: MapPoint | null
  onPick: (point: MapPoint) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  const dark = useThemeDark()
  const [fallback, setFallback] = useState(() => !hasGoogleMapsKey())
  const [ready, setReady] = useState<{ map: any; marker: any } | null>(null)

  useEffect(() => {
    if (!hasGoogleMapsKey()) {
      setFallback(true)
      return
    }
    let alive = true
    const win = window as Window & { gm_authFailure?: () => void }
    const prevAuthFail = win.gm_authFailure
    win.gm_authFailure = () => {
      if (alive) setFallback(true)
    }

    loadGoogleMaps()
      .then((maps) => {
        if (!alive || !hostRef.current) return
        const center = value ?? DEFAULT_CENTER
        const map = new maps.Map(hostRef.current, {
          center,
          zoom: value ? PIN_ZOOM : DEFAULT_ZOOM,
          clickableIcons: true,
          disableDefaultUI: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          styles: dark ? DARK_MAP_STYLES : null,
        })
        const marker = new maps.Marker({
          position: center,
          map: value ? map : null,
          draggable: true,
        })

        const emit = (latLng: any) => {
          if (!latLng) return
          onPickRef.current({
            lat: Number(latLng.lat().toFixed(6)),
            lng: Number(latLng.lng().toFixed(6)),
          })
        }

        map.addListener('click', (e: any) => emit(e.latLng))
        marker.addListener('dragend', (e: any) => emit(e.latLng))
        setReady({ map, marker })
      })
      .catch(() => {
        if (alive) setFallback(true)
      })

    return () => {
      alive = false
      win.gm_authFailure = prevAuthFail
    }
    // Harita bir kez oluşturulur; koordinat ve tema güncellemeleri ayrı efektlerle uygulanır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready) return
    ready.map.setOptions({ styles: dark ? DARK_MAP_STYLES : null })
  }, [ready, dark])

  useEffect(() => {
    if (!ready) return
    if (value) {
      ready.marker.setPosition(value)
      ready.marker.setMap(ready.map)
      ready.map.panTo(value)
      if ((ready.map.getZoom?.() ?? 0) < 14) ready.map.setZoom(PIN_ZOOM)
    } else {
      ready.marker.setMap(null)
    }
  }, [ready, value])

  if (fallback) {
    return (
      <div className={s.googleMapWrap}>
        <iframe
          title="İşletme konumu Google Harita"
          src={googleEmbedUrl(value)}
          className={s.googleMapFrame}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    )
  }

  return (
    <div className={s.googleMapWrap}>
      <div ref={hostRef} className={s.googleMapCanvas} aria-label="İşletme konumu Google Harita" />
      <div className={s.mapHint}>Google Harita’ya tıklayın veya kırmızı işareti sürükleyin</div>
    </div>
  )
}
