import { Elysia } from 'elysia'
import { eq, and, gte, lte } from 'drizzle-orm'
import { db } from '../db/client'
import { shifts, users } from '../db/schema'
import { authenticateRequest } from '../middleware/auth'
import { requireClinicId } from '../tenancy/context'
import { applyShiftPlan, latestShiftPlanOperation, undoShiftPlan } from '../db/repositories/shift-planning'
import { hasClinicStaffPermission } from '../services/staff-invitations'
import { getClinicEntitlements } from '../services/subscriptions'

async function canEditShifts(userRole: string | undefined | null, userId?: string | null): Promise<boolean> {
  if (!userRole) return false
  if (userRole === 'yonetici') return true
  return hasClinicStaffPermission(requireClinicId(), userRole, 'editShifts', userId)
}

async function checkStaffModuleAccess(user: { isPlatformAdmin?: boolean } | null | undefined, set: any) {
  if (user?.isPlatformAdmin) return null
  const plan = await getClinicEntitlements(requireClinicId())
  if (!plan.features.staffModule) {
    set.status = 403
    return {
      error: 'Personel ve mesai planlama modülü Pro ve Kurumsal paketlerde aktiftir.',
      upgradeRequired: true,
      requiredPlan: 'pro',
    }
  }
  return null
}

export const shiftsPlugin = new Elysia({ prefix: '/api/shifts' })

  .post('/plan/apply', async ({ body, cookie, set, request }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici', isPlatformAdmin: false } : await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) { set.status = 401; return { error: 'Oturum geçersiz' } }
    if (!(await canEditShifts(user.role, user.id))) { set.status = 403; return { error: 'Yetki yok' } }
    const denied = await checkStaffModuleAccess(user, set)
    if (denied) return denied
    const payload = body as any
    try { return await applyShiftPlan(requireClinicId(), user.id, String(payload.requestId || ''), payload.plan) }
    catch (error) { set.status = 400; return { error: error instanceof Error ? error.message : 'Mesai planı kaydedilemedi.' } }
  })

  .get('/plan/latest', async ({ cookie, set, request }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici', isPlatformAdmin: false } : await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) { set.status = 401; return { error: 'Oturum geçersiz' } }
    if (!(await canEditShifts(user.role, user.id))) { set.status = 403; return { error: 'Yetki yok' } }
    return latestShiftPlanOperation(requireClinicId())
  })

  .post('/plan/:operationId/undo', async ({ params, cookie, set, request }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici', isPlatformAdmin: false } : await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) { set.status = 401; return { error: 'Oturum geçersiz' } }
    if (!(await canEditShifts(user.role, user.id))) { set.status = 403; return { error: 'Yetki yok' } }
    const denied = await checkStaffModuleAccess(user, set)
    if (denied) return denied
    try { return await undoShiftPlan(requireClinicId(), params.operationId) }
    catch (error) { set.status = 400; return { error: error instanceof Error ? error.message : 'Mesai işlemi geri alınamadı.' } }
  })

  .get('/', async ({ query, cookie, set }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici' } : await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined))
    if (!user) { set.status = 401; return { error: 'Oturum geçersiz' } }

    const week = query.week as string | undefined
    const startDate = query.startDate as string | undefined
    const endDate = query.endDate as string | undefined
    const month = query.month as string | undefined // e.g. "2026-08"

    const conditions = [eq(shifts.clinicId, requireClinicId())]
    if (startDate && endDate) {
      conditions.push(gte(shifts.date, startDate), lte(shifts.date, endDate))
    } else if (month) {
      conditions.push(gte(shifts.date, `${month}-01`), lte(shifts.date, `${month}-31`))
    }

    let q = db.select({
      id: shifts.id,
      userId: shifts.userId,
      userName: users.name,
      userRole: users.role,
      userColor: users.color,
      date: shifts.date,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      shiftType: shifts.shiftType,
      notes: shifts.notes,
      createdAt: shifts.createdAt,
    })
      .from(shifts)
      .leftJoin(users, eq(shifts.userId, users.id))

    if (conditions.length > 0) {
      return await q.where(and(...conditions)).orderBy(shifts.date, shifts.startTime)
    }

    const rows = await q.orderBy(shifts.date, shifts.startTime)
    return rows
  })

  .post('/batch', async ({ body, cookie, set, request }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici', isPlatformAdmin: false } : await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!user) { set.status = 401; return { error: 'Oturum geçersiz' } }
    if (user.role !== 'yonetici') { set.status = 403; return { error: 'Yetki yok' } }
    const denied = await checkStaffModuleAccess(user, set)
    if (denied) return denied

    const b = body as {
      shifts: Array<{
        userId: string
        date: string
        startTime: string
        endTime: string
        shiftType?: string
        notes?: string
      }>
      overwrite?: boolean
    }

    if (!b || !Array.isArray(b.shifts) || b.shifts.length === 0) {
      set.status = 400; return { error: 'Vardiya listesi boş' }
    }

    const insertedOrUpdated = []
    for (const s of b.shifts) {
      if (!s.userId || !s.date || !s.startTime || !s.endTime) continue

      const existing = await db.select().from(shifts)
        .where(and(eq(shifts.clinicId, requireClinicId()), eq(shifts.userId, s.userId), eq(shifts.date, s.date)))

      if (existing.length > 0) {
        if (b.overwrite) {
          const [updated] = await db.update(shifts).set({
            startTime: s.startTime,
            endTime: s.endTime,
            shiftType: s.shiftType || 'tam',
            notes: s.notes || null,
          }).where(and(eq(shifts.id, existing[0].id), eq(shifts.clinicId, requireClinicId()))).returning()
          if (updated) insertedOrUpdated.push(updated)
        }
      } else {
        const [created] = await db.insert(shifts).values({
          clinicId: requireClinicId(),
          userId: s.userId,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          shiftType: s.shiftType || 'tam',
          notes: s.notes || null,
          createdBy: user.id,
        }).returning()
        if (created) insertedOrUpdated.push(created)
      }
    }

    return { ok: true, count: insertedOrUpdated.length, data: insertedOrUpdated }
  })

  .post('/', async ({ body, cookie, set, request }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici', isPlatformAdmin: false } : await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!user) { set.status = 401; return { error: 'Oturum geçersiz' } }
    if (!(await canEditShifts(user.role, user.id))) { set.status = 403; return { error: 'Yetki yok' } }
    const denied = await checkStaffModuleAccess(user, set)
    if (denied) return denied

    const b = body as any
    if (!b.userId || !b.date || !b.startTime || !b.endTime) {
      set.status = 400; return { error: 'userId, date, startTime, endTime gerekli' }
    }

    // Upsert if shift already exists on the same day
    const existing = await db.select().from(shifts)
      .where(and(eq(shifts.clinicId, requireClinicId()), eq(shifts.userId, b.userId), eq(shifts.date, b.date)))
    if (existing.length > 0) {
      const [updated] = await db.update(shifts).set({
        startTime: b.startTime,
        endTime: b.endTime,
        shiftType: b.shiftType || 'Mesai',
        notes: b.notes ?? existing[0].notes,
      }).where(and(eq(shifts.id, existing[0].id), eq(shifts.clinicId, requireClinicId()))).returning()
      return updated
    }

    const [created] = await db.insert(shifts).values({
      clinicId: requireClinicId(),
      userId: b.userId,
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime,
      shiftType: b.shiftType || 'Mesai',
      notes: b.notes,
      createdBy: user.id,
    }).returning()

    return created
  })

  .delete('/:id', async ({ params, cookie, set, request }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici', isPlatformAdmin: false } : await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!user) { set.status = 401; return { error: 'Oturum geçersiz' } }
    if (!(await canEditShifts(user.role, user.id))) { set.status = 403; return { error: 'Yetki yok' } }
    const denied = await checkStaffModuleAccess(user, set)
    if (denied) return denied

    await db.delete(shifts).where(and(eq(shifts.id, params.id), eq(shifts.clinicId, requireClinicId())))
    return { ok: true }
  })
