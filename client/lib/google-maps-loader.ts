// Tarayıcıda Google Maps JavaScript API yükleyicisi (yalnızca istemci tarafında çalışır).
declare global {
  interface Window {
    __aksiyokMapsReady?: () => void
    google?: any
  }
}

export const getGoogleMapsBrowserKey = (): string =>
  (process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim()

export const hasGoogleMapsKey = (): boolean => typeof window !== 'undefined' && Boolean(getGoogleMapsBrowserKey())

// Koyu tema için 2. referans görselle uyumlu gece mavisi Google Harita stili.
export const DARK_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#1f2937' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1f2937' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#374151' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#cbd5e1' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4b5563' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
]

let pending: Promise<any> | null = null

export function loadGoogleMaps(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Sunucu tarafında harita yüklenemez'))
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps)
  if (pending) return pending
  const key = getGoogleMapsBrowserKey()
  if (!key) return Promise.reject(new Error('Google Maps anahtarı tanımlı değil'))

  pending = new Promise((resolve, reject) => {
    window.__aksiyokMapsReady = () => {
      if (window.google?.maps?.Map) resolve(window.google.maps)
      else {
        pending = null
        reject(new Error('Google Maps başlatılamadı'))
      }
    }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=__aksiyokMapsReady&language=tr&region=TR&libraries=places`
    script.async = true
    script.onerror = () => {
      pending = null
      reject(new Error('Google Maps yüklenemedi'))
    }
    document.head.appendChild(script)
  })
  return pending
}

export function resetGoogleMapsLoaderForTests() {
  pending = null
}
