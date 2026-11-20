/**
 * services/knowledge.ts — PostgreSQL / pgvector tabanlı RAG arama servisi
 */
import { embedText as ragEmbedText, retrieveTopK } from '../rag'
import { searchByText } from '../db/repositories/knowledge'
import { listDoctors } from '../db/repositories/dental'
import { getClinicWorkingHours } from '../db/repositories/settings'
import { currentBusinessTemplate, currentClinicId } from '../tenancy/context'

export type KnowledgeSearchResult = {
  id?: string
  chunkText: string
  score: number
  documentName: string
}

export interface SearchKnowledgeOptions {
  limit?: number
  direction?: string
  channel?: string
}

const DAY_NAMES_TR = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']

const DOCTOR_OR_CLINIC_QUERY_RE =
  /\b(ekip\w*|çalışan\w*|calisan\w*|personel\w*|danışman\w*|danisman\w*|temsilci\w*|yetkili\w*|görevli\w*|gorevli\w*|işletme\w*|isletme\w*|şirket\w*|sirket\w*|ofis\w*|şube\w*|sube\w*|adres\w*|hekim\w*|doktor\w*|uzman\w*|branş\w*|brans\w*|kadro\w*|ortodont\w*|implant\w*|cerrah\w*|pedodont\w*|endodont\w*|protez\w*|periodont\w*|diş\s*hekim\w*|dis\s*hekim\w*|çalışma\s+saat\w*|calisma\s+saat\w*|mesai\w*|kaça\s+kadar|kaca\s+kadar|kaçta\s+açıl\w*|kacta\s+acil\w*|açık\s+mı|acik\s+mi|klinik\w*|kliniğ\w*|pine)\b/iu

const META_DIALOGUE_DOC_TITLE_RE =
  /^(?:doğal\s+diyalog(?:\s+ve\s+konuşma)?|konuşma\s+kuralları|diyalog\s+kuralları|sistem\s+kuralları)$/iu

const ROSTER_CACHE_TTL_MS = 60_000
const rosterCache = new Map<string, { text: string; expiresAt: number }>()

/**
 * Veritabanındaki aktif hekim kadrosunu (isim ve uzmanlık/branş) ve klinik çalışma
 * saatlerini canlı olarak okur; hem sistem promptunda hem de searchKnowledgeBase aracında kullanılır.
 * 60 saniyelik bellek önbelleği ile çağrı başlangıcı ve araç çağrılarında gecikme yaratmaz.
 */
export async function buildClinicRosterAndHoursText(explicitClinicId?: string): Promise<string> {
  const clinicId = explicitClinicId ?? currentClinicId()
  if (!clinicId) return ''

  const isDental = currentBusinessTemplate() === 'dental_clinic'
  const cacheKey = `${clinicId}:${isDental ? 'dental' : 'general'}`
  const cached = rosterCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.text
  }

  try {
    const [doctors, workingHours] = await Promise.all([
      listDoctors().catch(() => []),
      getClinicWorkingHours(clinicId).catch(() => null),
    ])

    const lines: string[] = []

    if (workingHours) {
      const openDays = Array.isArray(workingHours.workingDays) && workingHours.workingDays.length > 0
        ? workingHours.workingDays.map(d => DAY_NAMES_TR[d] || '').filter(Boolean).join(', ')
        : 'Pazartesi - Cumartesi'
      lines.push(
        isDental
          ? `Klinik Çalışma Günleri ve Saatleri: ${openDays} günleri ${workingHours.startTime} - ${workingHours.endTime} saatleri arasında hizmet vermektedir.`
          : `İşletme Çalışma Günleri ve Saatleri: ${openDays} günleri ${workingHours.startTime} - ${workingHours.endTime} saatleri arasında hizmet vermektedir.`,
      )
    }

    if (doctors.length > 0) {
      const docList = doctors
        .map(d => {
          const spec = d.specialty && d.specialty.trim()
            ? (isDental ? ` — Uzmanlık / Branş: ${d.specialty.trim()}` : ` — Görev / Uzmanlık: ${d.specialty.trim()}`)
            : (isDental ? ' — Diş Hekimi' : '')
          return `• ${d.name}${spec}`
        })
        .join('\n')
      lines.push(
        isDental
          ? `Kliniğimizde Görev Yapan Hekimlerimiz (${doctors.length} Hekim):\n${docList}`
          : `İşletmemizde Görev Yapan Ekip Üyelerimiz (${doctors.length} Çalışan):\n${docList}`,
      )
    }

    const text = lines.join('\n\n')
    rosterCache.set(cacheKey, { text, expiresAt: Date.now() + ROSTER_CACHE_TTL_MS })
    return text
  } catch {
    return ''
  }
}

/** Search knowledge base using pgvector similarity + text fallback + live clinic DB roster */
export async function searchKnowledge(
  query: string,
  optionsOrLimit: number | SearchKnowledgeOptions = 5,
): Promise<KnowledgeSearchResult[]> {
  const opts: SearchKnowledgeOptions = typeof optionsOrLimit === 'number'
    ? { limit: optionsOrLimit }
    : optionsOrLimit
  const limit = opts.limit ?? 5
  // Tüm kanallar (gelen, giden, web, WhatsApp) ortak bilgi tabanından beslenir
  const direction = 'all'

  const allResults: KnowledgeSearchResult[] = []
  const seenIds = new Set<string>()
  const isDoctorOrClinicQuery = DOCTOR_OR_CLINIC_QUERY_RE.test(query)

  // 0. Hekim / doktor / branş / çalışma saati sorgularında DB'deki canlı hekim ve mesai bilgisini en üste ekle
  if (isDoctorOrClinicQuery) {
    try {
      const liveRosterText = await buildClinicRosterAndHoursText()
      if (liveRosterText) {
        seenIds.add('__live_clinic_roster__')
        allResults.push({
          id: '__live_clinic_roster__',
          documentName: currentBusinessTemplate() === 'dental_clinic'
            ? 'Klinik Hekim Kadrosu ve Çalışma Saatleri'
            : 'İşletme Ekip Kadrosu ve Çalışma Saatleri',
          chunkText: liveRosterText,
          score: 0.99,
        })
      }
    } catch (err) {
      console.warn('[Knowledge] Canlı hekim kadrosu okunamadı:', err)
    }
  }

  // 1. Embedding-based arama
  try {
    const results = await retrieveTopK(query, limit, direction)
    for (const r of results) {
      if (isDoctorOrClinicQuery && META_DIALOGUE_DOC_TITLE_RE.test(r.title.trim())) {
        continue
      }
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id)
        allResults.push({ id: r.id, chunkText: r.content, score: r.score, documentName: r.title })
      }
    }
  } catch (err) {
    console.error('[Knowledge] Embedding arama hatası:', err)
  }

  // 2. Text-based arama — her zaman çalıştır, embedding sonuçlarını tamamlar
  try {
    const textResults = await searchByText(query, limit, direction)
    for (const r of textResults) {
      if (isDoctorOrClinicQuery && META_DIALOGUE_DOC_TITLE_RE.test(r.title.trim())) {
        continue
      }
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id)
        allResults.push({ id: r.id, chunkText: r.content, score: r.score, documentName: r.title })
      }
    }
  } catch (err) {
    console.error('[Knowledge] Text fallback hatası:', err)
  }

  // Eğer hiçbir RAG sonucu bulunamadıysa ve henüz canlı klinik özeti eklenmediyse fallback olarak ekle
  if (allResults.length === 0 && !seenIds.has('__live_clinic_roster__')) {
    const liveRosterText = await buildClinicRosterAndHoursText().catch(() => '')
    if (liveRosterText) {
      allResults.push({
        id: '__live_clinic_roster__',
        documentName: currentBusinessTemplate() === 'dental_clinic'
          ? 'Klinik Hekim Kadrosu ve Çalışma Saatleri'
          : 'İşletme Ekip Kadrosu ve Çalışma Saatleri',
        chunkText: liveRosterText,
        score: 0.85,
      })
    }
  }

  // Score'a göre sırala, limit kadar döndür
  allResults.sort((a, b) => b.score - a.score)
  return allResults.slice(0, limit)
}

export async function embedText(text: string): Promise<number[]> {
  return ragEmbedText(text)
}
