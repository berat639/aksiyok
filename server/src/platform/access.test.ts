import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { hasMatchingRequestOrigin, isPlatformAdminHostname } from './access'
import { hostnameFromRequest } from '../tenancy/hostname'

describe('platform admin hostname access', () => {
  const configured = 'axamaz.com, platform-staging.axamaz.com'

  test('accepts only configured, normalized hostnames', () => {
    expect(isPlatformAdminHostname('axamaz.com', configured)).toBe(true)
    expect(isPlatformAdminHostname('AXAMAZ.COM:443', configured)).toBe(true)
    expect(isPlatformAdminHostname('https://platform-staging.axamaz.com/', configured)).toBe(true)
  })

  test('rejects suffix tricks and unconfigured hosts', () => {
    expect(isPlatformAdminHostname('axamaz.com.attacker.test', configured)).toBe(false)
    expect(isPlatformAdminHostname('fakeaxamaz.com', configured)).toBe(false)
    expect(isPlatformAdminHostname('otherdomain.com', configured)).toBe(false)
  })

  test('fails closed when configuration is missing', () => {
    expect(isPlatformAdminHostname('axamaz.com', '')).toBe(false)
    expect(isPlatformAdminHostname('', configured)).toBe(false)
  })

  test('accepts only a matching browser origin when one is present', () => {
    expect(hasMatchingRequestOrigin(new Request('http://server/api/platform/clinics', { headers: {
      host: 'server', 'x-forwarded-host': 'axamaz.com', origin: 'https://axamaz.com',
    } }))).toBe(true)
    expect(hasMatchingRequestOrigin(new Request('http://server/api/platform/clinics', { headers: {
      host: 'server', 'x-forwarded-host': 'axamaz.com', origin: 'https://other-tenant.example.com',
    } }))).toBe(false)
  })

  test('uses a signed public hostname across the reverse proxy hop', () => {
    const secret = 'proxy-test-secret'
    const hostname = 'axamaz.com'
    const signature = createHmac('sha256', secret).update(hostname).digest('hex')
    const request = new Request('http://server/api/auth/me', { headers: {
      'x-forwarded-host': 'api.axamaz.com',
      'x-voiceai-public-host': hostname,
      'x-voiceai-public-host-signature': signature,
    } })
    expect(hostnameFromRequest(request, secret)).toBe(hostname)
    expect(hostnameFromRequest(new Request(request.url, { headers: {
      ...Object.fromEntries(request.headers),
      'x-voiceai-public-host-signature': 'invalid',
    } }), secret)).toBe('api.axamaz.com')
  })
})
