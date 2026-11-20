import { AsyncLocalStorage } from 'node:async_hooks'
import { and, eq, sql as drizzleSql } from 'drizzle-orm'
import { db } from '../db/client'
import { clinicDomains, clinics } from '../db/schema'
import { hostnameFromRequest, normalizeHostname } from './hostname'
import { type BusinessTemplate, normalizeBusinessTemplate } from '../platform/roles'

export { hostnameFromRequest, normalizeHostname } from './hostname'

export interface TenantContext {
  clinicId: string
  hostname: string
  isActive?: boolean
  businessTemplate?: BusinessTemplate
}

let ensuredBusinessTemplateColumn = false
async function ensureBusinessTemplateColumnOnce(): Promise<void> {
  if (ensuredBusinessTemplateColumn) return
  ensuredBusinessTemplateColumn = true
  try {
    await db.execute(drizzleSql`ALTER TABLE clinics ADD COLUMN IF NOT EXISTS business_template TEXT NOT NULL DEFAULT 'general'`)
  } catch {
    ensuredBusinessTemplateColumn = false
  }
}

async function queryTenantByHostname(hostname: string): Promise<TenantContext | null> {
  try {
    const [row] = await db.select({
      clinicId: clinicDomains.clinicId,
      isActive: clinics.isActive,
      businessTemplate: clinics.businessTemplate,
    })
      .from(clinicDomains)
      .innerJoin(clinics, eq(clinicDomains.clinicId, clinics.id))
      .where(and(
        eq(clinicDomains.hostname, hostname),
        eq(clinicDomains.isActive, true),
      ))
      .limit(1)
    return row
      ? {
        clinicId: row.clinicId,
        hostname,
        isActive: row.isActive,
        businessTemplate: normalizeBusinessTemplate(row.businessTemplate),
      }
      : null
  } catch {
    await ensureBusinessTemplateColumnOnce()
    const [row] = await db.select({ clinicId: clinicDomains.clinicId, isActive: clinics.isActive })
      .from(clinicDomains)
      .innerJoin(clinics, eq(clinicDomains.clinicId, clinics.id))
      .where(and(
        eq(clinicDomains.hostname, hostname),
        eq(clinicDomains.isActive, true),
      ))
      .limit(1)
    return row ? { clinicId: row.clinicId, hostname, isActive: row.isActive, businessTemplate: 'general' } : null
  }
}

const storage = new AsyncLocalStorage<TenantContext>()
const requestStorage = new AsyncLocalStorage<Request>()
const requestTenants = new WeakMap<Request, TenantContext | null>()
const cache = new Map<string, { value: TenantContext | null; expiresAt: number }>()
const clinicByIdCache = new Map<string, { value: Omit<TenantContext, 'hostname'> & { primaryHostname: string }; expiresAt: number }>()
const CACHE_TTL_MS = 30_000

const BUILTIN_SHARED_APP_HOSTS = new Set<string>([
  'localhost',
  '127.0.0.1',
  '::1',
  'axamaz.com',
  'www.axamaz.com',
  'app.axamaz.com',
  'panel.axamaz.com',
])

export function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

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

export async function getTenantByClinicId(
  clinicId: string,
  fallbackHostname?: string,
): Promise<TenantContext | null> {
  const trimmedId = String(clinicId || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmedId)) {
    return null
  }

  const now = Date.now()
  const cached = clinicByIdCache.get(trimmedId)
  if (cached && cached.expiresAt > now) {
    return {
      clinicId: cached.value.clinicId,
      isActive: cached.value.isActive,
      businessTemplate: cached.value.businessTemplate,
      hostname: normalizeHostname(fallbackHostname) || cached.value.primaryHostname || 'axamaz.com',
    }
  }

  try {
    const [row] = await db
      .select({
        clinicId: clinics.id,
        isActive: clinics.isActive,
        businessTemplate: clinics.businessTemplate,
        primaryHostname: drizzleSql<string | null>`(
          SELECT d.hostname
          FROM clinic_domains d
          WHERE d.clinic_id = ${clinics.id} AND d.is_active = true
          ORDER BY d.is_primary DESC, d.created_at ASC
          LIMIT 1
        )`,
      })
      .from(clinics)
      .where(eq(clinics.id, trimmedId))
      .limit(1)

    if (!row) return null
    const base = {
      clinicId: row.clinicId,
      isActive: row.isActive,
      businessTemplate: normalizeBusinessTemplate(row.businessTemplate),
      primaryHostname: row.primaryHostname || '',
    }
    clinicByIdCache.set(trimmedId, { value: base, expiresAt: now + CACHE_TTL_MS })
    return {
      clinicId: base.clinicId,
      isActive: base.isActive,
      businessTemplate: base.businessTemplate,
      hostname: normalizeHostname(fallbackHostname) || base.primaryHostname || 'axamaz.com',
    }
  } catch {
    await ensureBusinessTemplateColumnOnce()
    const [row] = await db
      .select({ clinicId: clinics.id, isActive: clinics.isActive })
      .from(clinics)
      .where(eq(clinics.id, trimmedId))
      .limit(1)
    if (!row) return null
    return {
      clinicId: row.clinicId,
      isActive: row.isActive,
      businessTemplate: 'general',
      hostname: normalizeHostname(fallbackHostname) || 'axamaz.com',
    }
  }
}

export async function findTenantByHostname(hostnameValue: string): Promise<TenantContext | null> {
  const hostname = normalizeHostname(hostnameValue)
  if (!hostname) return null

  const cached = cache.get(hostname)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const value = await queryTenantByHostname(hostname)
  cache.set(hostname, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}

export async function resolveTenantFromRequest(request: Request): Promise<TenantContext | null> {
  const hostname = hostnameFromRequest(request)
  const tenant = await findTenantByHostname(hostname)
  if (tenant) return tenant

  if (process.env.NODE_ENV !== 'production' && isLocalHostname(hostname)) {
    try {
      const [activeClinic] = await db.select({
        id: clinics.id,
        isActive: clinics.isActive,
        businessTemplate: clinics.businessTemplate,
      }).from(clinics).where(eq(clinics.isActive, true)).limit(1)
      if (activeClinic) {
        return {
          clinicId: activeClinic.id,
          hostname,
          isActive: activeClinic.isActive,
          businessTemplate: normalizeBusinessTemplate(activeClinic.businessTemplate),
        }
      }
      const [anyClinic] = await db.select({
        id: clinics.id,
        isActive: clinics.isActive,
        businessTemplate: clinics.businessTemplate,
      }).from(clinics).limit(1)
      return anyClinic
        ? {
          clinicId: anyClinic.id,
          hostname,
          isActive: anyClinic.isActive,
          businessTemplate: normalizeBusinessTemplate(anyClinic.businessTemplate),
        }
        : null
    } catch {
      const [activeClinic] = await db.select({ id: clinics.id, isActive: clinics.isActive }).from(clinics)
        .where(eq(clinics.isActive, true)).limit(1)
      if (activeClinic) return { clinicId: activeClinic.id, hostname, isActive: activeClinic.isActive, businessTemplate: 'general' }
      const [anyClinic] = await db.select({ id: clinics.id, isActive: clinics.isActive }).from(clinics).limit(1)
      return anyClinic ? { clinicId: anyClinic.id, hostname, isActive: anyClinic.isActive, businessTemplate: 'general' } : null
    }
  }

  return null
}

export function enterTenantContext(tenant: TenantContext | null): void {
  if (tenant) storage.enterWith(tenant)
}

/** Bind the request before any awaited lifecycle work. Elysia can resume an
 * async hook on a different resource; the request object itself remains a
 * stable, concurrency-safe key for the resolved tenant. */
export function bindRequestContext(request: Request): void {
  requestStorage.enterWith(request)
}

export function setRequestTenant(request: Request, tenant: TenantContext | null): void {
  requestTenants.set(request, tenant)
  if (tenant) storage.enterWith(tenant)
}

export function runWithTenantContext<T>(tenant: TenantContext, operation: () => T): T {
  return storage.run(tenant, operation)
}

export function currentTenant(): TenantContext | null {
  const stored = storage.getStore()
  if (stored) return stored
  const request = requestStorage.getStore()
  return request ? (requestTenants.get(request) ?? null) : null
}

const activeCorsHostnames = new Set<string>(['axamaz.com', 'www.axamaz.com', 'localhost', '127.0.0.1'])
let corsRefreshTimerStarted = false

export function registerAllowedTenantHostname(hostname: string | null | undefined): void {
  const normalized = normalizeHostname(hostname)
  if (normalized) activeCorsHostnames.add(normalized)
}

export async function refreshAllowedTenantHostnames(): Promise<void> {
  try {
    const rows = await db
      .select({ hostname: clinicDomains.hostname })
      .from(clinicDomains)
      .innerJoin(clinics, eq(clinicDomains.clinicId, clinics.id))
      .where(and(eq(clinicDomains.isActive, true), eq(clinics.isActive, true)))
    const next = new Set<string>(['axamaz.com', 'www.axamaz.com', 'localhost', '127.0.0.1'])
    for (const r of rows) {
      const n = normalizeHostname(r.hostname)
      if (n) next.add(n)
    }
    activeCorsHostnames.clear()
    for (const h of next) activeCorsHostnames.add(h)
  } catch {
    // DB henüz hazır değilse mevcut önbellek korunur
  }
}

export function startTenantCorsHostSync(): void {
  if (corsRefreshTimerStarted) return
  corsRefreshTimerStarted = true
  void refreshAllowedTenantHostnames()
  const timer = setInterval(() => {
    void refreshAllowedTenantHostnames()
  }, 60_000)
  timer.unref?.()
}

export function isAllowedTenantCorsHostname(hostname: string | null | undefined): boolean {
  const n = normalizeHostname(hostname)
  if (!n) return false
  if (n === 'axamaz.com' || n.endsWith('.axamaz.com')) return true
  if (isSharedAppHostname(n)) return true
  return activeCorsHostnames.has(n)
}

export function currentClinicId(): string | null {
  return currentTenant()?.clinicId ?? null
}

export function currentBusinessTemplate(): BusinessTemplate {
  return normalizeBusinessTemplate(currentTenant()?.businessTemplate)
}

export function requireClinicId(): string {
  const clinicId = currentClinicId()
  if (!clinicId) throw new Error('Bu alan adı için aktif işletme bulunamadı')
  return clinicId
}

export function invalidateTenantCache(hostname?: string): void {
  clinicByIdCache.clear()
  if (hostname) cache.delete(normalizeHostname(hostname))
  else cache.clear()
}
