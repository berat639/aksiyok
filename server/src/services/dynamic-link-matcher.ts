/**
 * Yardımcı modül: Metinlerdeki URL'leri çıkarır, kanonsal link ve portal ilan
 * numaralarına normalize eder ve veri tablosu hücreleriyle kesin eşleştirme yapar.
 */

export interface ParsedUrlLookupParts {
  raw: string
  host: string
  pathname: string
  canonicalUrl: string
  listingIds: string[]
  pathFallbackToken: string | null
}

const URL_IN_TEXT_RE =
  /(?:https?:\/\/[^\s<>"{}|\\^`[\]]+|(?:www\.|m\.|mobil\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"{}|\\^`[\]]*|(?:sahibinden\.com|hepsiemlak\.com|emlakjet\.com|zingat\.com|hurriyetemlak\.com|arabam\.com)\/[^\s<>"{}|\\^`[\]]*)/gi

const TRAILING_PUNCT_RE = /[.,;:!?)'"”’\]>]+$/
const COMMON_LISTING_QUERY_KEYS = ['id', 'ilanno', 'ilan_no', 'listingid', 'adid']

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export function extractUrlsFromText(text: string): string[] {
  const input = String(text || '')
  if (!input.trim()) return []
  const matches = input.match(URL_IN_TEXT_RE) || []
  const out: string[] = []
  const seen = new Set<string>()
  for (const rawHit of matches) {
    const cleaned = rawHit.replace(TRAILING_PUNCT_RE, '').trim()
    if (!cleaned || cleaned.length < 4) continue
    const key = cleaned.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(cleaned)
    }
  }
  return out
}

function extractListingIdsFromUrlObj(parsed: URL, decodedPath: string): string[] {
  const ids = new Set<string>()
  // Path içindeki -123456789/detay veya /123456789/ gibi ilan numaraları (6-14 hane)
  const pathRegex = /(?:^|[-_/=])(\d{6,14})(?=$|[-_/])/g
  let m: RegExpExecArray | null
  while ((m = pathRegex.exec(decodedPath)) !== null) {
    if (m[1]) ids.add(m[1])
  }
  for (const [k, v] of parsed.searchParams.entries()) {
    const keyLow = k.toLowerCase()
    const valTrim = v.trim()
    if (COMMON_LISTING_QUERY_KEYS.includes(keyLow) && /^\d{5,14}$/.test(valTrim)) {
      ids.add(valTrim)
    }
  }
  return Array.from(ids)
}

export function parseUrlLookupParts(rawUrl: string): ParsedUrlLookupParts | null {
  const trimmed = String(rawUrl || '').replace(TRAILING_PUNCT_RE, '').trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }
  if (!parsed.hostname || !parsed.hostname.includes('.')) return null

  const host = parsed.hostname
    .toLowerCase()
    .replace(/^(?:www\.|m\.|mobil\.)+/i, '')
  const decodedPath = safeDecodeUriComponent(parsed.pathname || '')
  const pathname = decodedPath
    .replace(/\/+$/, '')
    .toLocaleLowerCase('tr-TR')
  const canonicalUrl = `${host}${pathname}`
  const listingIds = extractListingIdsFromUrlObj(parsed, decodedPath)
  const pathFallbackToken = pathname.length >= 12 ? pathname : null

  return {
    raw: trimmed,
    host,
    pathname,
    canonicalUrl,
    listingIds,
    pathFallbackToken,
  }
}

export function isUrlOnlyQuery(rawQuery: string): boolean {
  const trimmed = String(rawQuery || '').trim()
  if (!trimmed) return false
  const urls = extractUrlsFromText(trimmed)
  if (urls.length !== 1) return false
  const remainder = trimmed.replace(urls[0]!, '').replace(/[.,;:!?()\s]+/g, '')
  return remainder.length === 0
}

/**
 * Tek bir hücre değerinin sorgulanan URL ile kanonsal veya aynı-domain ilan ID'si
 * üzerinden kesin eşleşip eşleşmediğini doğrular.
 */
export function cellMatchesParsedUrl(rawCellValue: unknown, queryUrl: ParsedUrlLookupParts): boolean {
  const cellText = String(rawCellValue ?? '').trim()
  if (!cellText) return false

  const cellUrls = extractUrlsFromText(cellText)
  for (const cellUrlRaw of cellUrls) {
    const cellParsed = parseUrlLookupParts(cellUrlRaw)
    if (!cellParsed) continue

    if (cellParsed.canonicalUrl === queryUrl.canonicalUrl) {
      return true
    }

    if (
      cellParsed.host === queryUrl.host &&
      queryUrl.listingIds.length > 0 &&
      cellParsed.listingIds.some((id) => queryUrl.listingIds.includes(id))
    ) {
      return true
    }

    // Aynı domain altında farklı önek/uzantı ama güçlü path eşleşmesi (ör. /detay eklenmiş/çıkarılmış)
    if (cellParsed.host === queryUrl.host && queryUrl.pathname.length >= 12 && cellParsed.pathname.length >= 12) {
      if (cellParsed.pathname.startsWith(queryUrl.pathname) || queryUrl.pathname.startsWith(cellParsed.pathname)) {
        return true
      }
    }
  }

  // Hücrede doğrudan URL değil de tekil ilan ID'si veya şemasız kanonsal metin saklandıysa
  const cellLower = cellText.toLocaleLowerCase('tr-TR').replace(/\/+$/, '')
  if (cellLower === queryUrl.canonicalUrl) {
    return true
  }
  return false
}

export function extractSearchWordTokens(query: string): string[] {
  return String(query || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
    .slice(0, 8)
}
