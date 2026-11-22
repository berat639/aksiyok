// Google Maps arama / ters coğrafi kodlama yanıt vermediğinde kullanılan yerel Türkiye semt/ilçe listesi.
export type TrPlace = { label: string; lat: number; lng: number }

export const knownPlaces: TrPlace[] = [
  { label: 'Çankaya, Ankara', lat: 39.9179, lng: 32.8627 },
  { label: 'Yıldızevler, Çankaya, Ankara', lat: 39.8858, lng: 32.8632 },
  { label: 'Kızılay, Ankara', lat: 39.9208, lng: 32.8541 },
  { label: 'Kadıköy, İstanbul', lat: 40.9906, lng: 29.029 },
  { label: 'Moda, Kadıköy, İstanbul', lat: 40.9817, lng: 29.0257 },
  { label: 'Ataşehir, İstanbul', lat: 40.9923, lng: 29.1244 },
  { label: 'Üsküdar, İstanbul', lat: 41.0256, lng: 29.0156 },
  { label: 'Beşiktaş, İstanbul', lat: 41.0422, lng: 29.0083 },
  { label: 'Şişli, İstanbul', lat: 41.0602, lng: 28.9877 },
  { label: 'Levent, Beşiktaş, İstanbul', lat: 41.0817, lng: 29.0108 },
  { label: 'Maslak, Sarıyer, İstanbul', lat: 41.1086, lng: 29.0203 },
  { label: 'Taksim, Beyoğlu, İstanbul', lat: 41.0369, lng: 28.985 },
  { label: 'Fatih, İstanbul', lat: 41.0186, lng: 28.9397 },
  { label: 'Bakırköy, İstanbul', lat: 40.9819, lng: 28.8772 },
  { label: 'Maltepe, İstanbul', lat: 40.9357, lng: 29.1306 },
  { label: 'Kartal, İstanbul', lat: 40.8889, lng: 29.1858 },
  { label: 'Pendik, İstanbul', lat: 40.8775, lng: 29.2333 },
  { label: 'Başakşehir, İstanbul', lat: 41.0931, lng: 28.8022 },
  { label: 'Beylikdüzü, İstanbul', lat: 41.0011, lng: 28.6419 },
  { label: 'Konak, İzmir', lat: 38.4192, lng: 27.1287 },
  { label: 'Karşıyaka, İzmir', lat: 38.4594, lng: 27.1163 },
  { label: 'Nilüfer, Bursa', lat: 40.2133, lng: 28.9831 },
  { label: 'Muratpaşa, Antalya', lat: 36.8841, lng: 30.7056 },
]

const fold = (s: string) =>
  s.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i')

export const searchPlaces = (q: string, limit = 6): TrPlace[] => {
  const k = fold(q.trim())
  return k ? knownPlaces.filter((p) => fold(p.label).includes(k)).slice(0, limit) : []
}

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r)
  const y = (b.lat - a.lat) * r
  return Math.sqrt(x * x + y * y) * 6371
}

export const labelFor = (p: { lat: number; lng: number }): string => {
  let best = knownPlaces[0]!
  let d = Infinity
  for (const k of knownPlaces) {
    const n = km(p, k)
    if (n < d) {
      d = n
      best = k
    }
  }
  return d <= 0.8 ? best.label : d <= 5 ? `${best.label} yakını` : `Seçilen konum (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`
}
