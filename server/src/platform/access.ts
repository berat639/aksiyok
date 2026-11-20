import { hostnameFromRequest, normalizeHostname } from '../tenancy/hostname'

function configuredPlatformHosts(value = process.env.PLATFORM_ADMIN_HOSTS): Set<string> {
  return new Set((value || '')
    .split(',')
    .map(host => normalizeHostname(host))
    .filter(Boolean))
}

export function isPlatformAdminHostname(
  hostname: string | null | undefined,
  configuredHosts = process.env.PLATFORM_ADMIN_HOSTS,
): boolean {
  const normalized = normalizeHostname(hostname)
  return Boolean(normalized) && configuredPlatformHosts(configuredHosts).has(normalized)
}

export function isPlatformAdminRequest(request: Request): boolean {
  const hostname = hostnameFromRequest(request)
  if (isPlatformAdminHostname(hostname)) return true
  if (!process.env.PLATFORM_ADMIN_HOSTS?.trim()) {
    if (hostname === 'axamaz.com' || hostname === 'www.axamaz.com') return true
    if (process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      return true
    }
  }
  return false
}

export function hasMatchingRequestOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return normalizeHostname(new URL(origin).host) === hostnameFromRequest(request)
  } catch {
    return false
  }
}

export function canManagePlatform(user: { isPlatformAdmin: boolean }, request: Request): boolean {
  return user.isPlatformAdmin && isPlatformAdminRequest(request)
}
