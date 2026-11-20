export function normalizeHostname(value: string | null | undefined): string {
  if (!value) return ''
  const first = value.split(',')[0]?.trim().toLowerCase() ?? ''
  const withoutProtocol = first.replace(/^https?:\/\//, '').split('/')[0] ?? ''
  return withoutProtocol.replace(/\.$/, '').replace(/:\d+$/, '')
}

export function hostnameFromRequest(request: Request, proxySecret = process.env.INTERNAL_PROXY_SECRET): string {
  const trusted = verifiedPublicHostname(request, proxySecret)
  if (trusted) return trusted
  const forwarded = request.headers.get('x-forwarded-host')
  const host = forwarded || request.headers.get('host')
  return normalizeHostname(host)
}

export function verifiedPublicHostname(
  request: Request,
  secret = process.env.INTERNAL_PROXY_SECRET,
): string {
  const hostname = normalizeHostname(request.headers.get('x-voiceai-public-host'))
  const actualSignature = request.headers.get('x-voiceai-public-host-signature') || ''
  if (!hostname || !secret || !actualSignature) return ''
  const expectedSignature = createHmac('sha256', secret).update(hostname).digest('hex')
  const actual = Buffer.from(actualSignature)
  const expected = Buffer.from(expectedSignature)
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? hostname : ''
}
import { createHmac, timingSafeEqual } from 'node:crypto'

const BUILTIN_SHARED_APP_HOSTS = new Set<string>([
  'localhost',
  '127.0.0.1',
  '::1',
  'axamaz.com',
  'www.axamaz.com',
  'app.axamaz.com',
  'panel.axamaz.com',
])

export function isSharedAppHostname(
  hostname: string | null | undefined,
  extraHostsEnv: string | undefined = process.env.SHARED_APP_HOSTS,
): boolean {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return false
  if (BUILTIN_SHARED_APP_HOSTS.has(normalized)) return true
  if (extraHostsEnv) {
    for (const part of extraHostsEnv.split(/[\s,]+/)) {
      const candidate = normalizeHostname(part)
      if (candidate && candidate === normalized) return true
    }
  }
  return false
}
