import { Elysia } from 'elysia'
import { authenticateRequest } from '../middleware/auth'
import { requireClinicId, currentTenant } from '../tenancy/context'

function resolveAppointmentActor(user: { role?: string | null; name?: string | null } | null) {
  if (!user) return undefined
  const actorType =
    user.role === 'hekim' || user.role === 'calisan'
      ? 'doctor'
      : user.role === 'yonetici'
        ? 'admin'
        : 'desk'
  return { actorType, actorName: user.name || '' }
}

export const calendarHandlers = {
  async listEmployees() {
    const { listCalendarEmployees } = await import('../db/repositories/dental')
    return listCalendarEmployees()
  },

  async createEmployee(body: unknown, set: { status?: number | string }) {
    const { createDoctor } = await import('../db/repositories/dental')
    const b = (body || {}) as Record<string, any>
    if (!b.name || !b.specialty) {
      set.status = 400
      return { error: 'Ad ve ünvan/uzmanlık alanları zorunludur' }
    }
    return createDoctor({ name: b.name, specialty: b.specialty, color: b.color })
  },

  async listLeaves(query: Record<string, unknown>) {
    const { getDoctorLeaves } = await import('../db/repositories/dental')
    return getDoctorLeaves({
      doctorId: (query.employeeId ?? query.doctorId) as string | undefined,
      date: query.date as string | undefined,
      startDate: query.startDate as string | undefined,
      endDate: query.endDate as string | undefined,
    })
  },

  async createLeave(body: unknown, set: { status?: number | string }, cookie: any, request?: Request) {
    const user = await authenticateRequest(cookie?.token?.value as string | undefined, request)
    const { createDoctorLeave } = await import('../db/repositories/dental')
    const b = (body || {}) as Record<string, any>
    const employeeId = b.employeeId || b.doctorId
    if (!employeeId || !b.date || !b.startTime || !b.endTime) {
      set.status = 400
      return { error: 'Çalışan, tarih ve saat aralığı zorunludur' }
    }
    return createDoctorLeave({
      doctorId: employeeId,
      substituteDoctorId: b.substituteEmployeeId || b.substituteDoctorId || null,
      unassignAppointments: Boolean(b.unassignAppointments),
      cancelAppointments: Boolean(b.cancelAppointments),
      appointmentIds: Array.isArray(b.appointmentIds) ? b.appointmentIds : undefined,
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime,
      isFullDay: Boolean(b.isFullDay),
      reason: b.reason,
      notes: b.notes,
      createdBy: user?.id,
    })
  },

  async deleteLeave(id: string, set: { status?: number | string }) {
    const { deleteDoctorLeave } = await import('../db/repositories/dental')
    const ok = await deleteDoctorLeave(id)
    if (!ok) {
      set.status = 404
      return { error: 'İzin bulunamadı' }
    }
    return { success: true }
  },

  async listAppointments(query: Record<string, unknown>) {
    const { listDentalAppointments } = await import('../db/repositories/dental')
    return listDentalAppointments(query.date as string | undefined)
  },

  async createAppointment(body: unknown, set: { status?: number | string }, cookie: any, request?: Request) {
    const user = await authenticateRequest(cookie?.token?.value as string | undefined, request).catch(() => null)
    const actor = resolveAppointmentActor(user)
    const { createDentalAppointment } = await import('../db/repositories/dental')
    const b = (body || {}) as Record<string, any>
    if (!b.title || !b.startTime || !b.endTime) {
      set.status = 400
      return { error: 'Randevu başlığı ve saat bilgileri zorunludur' }
    }
    try {
      return await createDentalAppointment(
        {
          patientId: b.patientId || null,
          doctorId: b.employeeId || b.doctorId || null,
          title: b.title,
          startTime: new Date(b.startTime),
          endTime: new Date(b.endTime),
          status: b.status,
          type: b.type,
          notes: b.notes,
          intakeSource: b.intakeSource || null,
          intakePatientName: b.intakePatientName || null,
          intakePatientPhone: b.intakePatientPhone || null,
          dynamicLinks: Array.isArray(b.dynamicLinks) ? b.dynamicLinks : undefined,
        },
        actor,
      )
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Randevu oluşturulamadı' }
    }
  },

  async deleteAppointment(id: string, set: { status?: number | string }) {
    const { deleteDentalAppointment } = await import('../db/repositories/dental')
    const ok = await deleteDentalAppointment(id)
    if (!ok) {
      set.status = 404
      return { error: 'Not found' }
    }
    return { success: true }
  },

  async updateAppointment(id: string, body: unknown, set: { status?: number | string }, cookie: any, request?: Request) {
    const user = await authenticateRequest(cookie?.token?.value as string | undefined, request).catch(() => null)
    const actor = resolveAppointmentActor(user)
    const { updateDentalAppointment } = await import('../db/repositories/dental')
    const b = (body || {}) as Record<string, unknown>
    const resolvedDoctorId =
      b.employeeId !== undefined
        ? (b.employeeId as string | null)
        : b.doctorId !== undefined
          ? (b.doctorId as string | null)
          : undefined
    try {
      const updated = await updateDentalAppointment(
        id,
        {
          patientId: b.patientId !== undefined ? (b.patientId as string | null) : undefined,
          doctorId: resolvedDoctorId,
          timeConfirmed: b.timeConfirmed !== undefined ? (b.timeConfirmed as boolean) : undefined,
          status: b.status as string | undefined,
          startTime: b.startTime ? new Date(b.startTime as string) : undefined,
          endTime: b.endTime ? new Date(b.endTime as string) : undefined,
          type: b.type as string | undefined,
          complaint: b.complaint as string | undefined,
          notes: b.notes as string | undefined,
          title: b.title as string | undefined,
          dynamicLinks: Array.isArray(b.dynamicLinks) ? (b.dynamicLinks as Array<{ tableId: string; rowId: string }>) : undefined,
        },
        actor,
      )
      if (!updated) {
        set.status = 404
        return { error: 'Not found' }
      }
      return updated
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Randevu güncellenemedi' }
    }
  },

  async approveAiAppointment(id: string, body: unknown, set: { status?: number | string }, cookie: any, request?: Request) {
    const user = await authenticateRequest(cookie?.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const b = (body || {}) as Record<string, any>
    try {
      const { approveAiAppointment } = await import('../db/repositories/dental')
      return await approveAiAppointment(id, {
        patientId: b.patientId || undefined,
        patient: b.newPatient
          ? { name: String(b.newPatient.name || ''), phone: b.newPatient.phone ? String(b.newPatient.phone) : undefined }
          : undefined,
        patientUpdate: b.patientUpdate
          ? {
              name: String(b.patientUpdate.name || ''),
              phone: b.patientUpdate.phone === undefined ? undefined : String(b.patientUpdate.phone),
            }
          : undefined,
        doctorId: b.employeeId || b.doctorId || null,
        startTime: new Date(b.startTime),
        endTime: new Date(b.endTime),
        complaint: typeof b.complaint === 'string' ? b.complaint : undefined,
        reviewedBy: user.id,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'AI randevusu onaylanamadı' }
    }
  },

  async rejectAiAppointment(id: string, body: unknown, set: { status?: number | string }, cookie: any, request?: Request) {
    const user = await authenticateRequest(cookie?.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    try {
      const { rejectAiAppointment } = await import('../db/repositories/dental')
      return await rejectAiAppointment(id, String((body as any)?.reason || ''), user.id)
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'AI randevusu iptal edilemedi' }
    }
  },

  async applyAppointmentResponse(id: string, body: unknown, set: { status?: number | string }) {
    const b = (body || {}) as Record<string, unknown>
    const action = String(b.action || '') as 'confirm' | 'postpone' | 'cancel'
    if (!['confirm', 'postpone', 'cancel'].includes(action)) {
      set.status = 400
      return { error: 'Geçersiz işlem (confirm | postpone | cancel)' }
    }
    try {
      const { applyPatientAppointmentResponse } = await import('../services/appointment-notifications')
      return await applyPatientAppointmentResponse({
        clinicId: requireClinicId(),
        appointmentId: id,
        action,
        note: typeof b.note === 'string' ? b.note : null,
        preferredDate: typeof b.preferredDate === 'string' ? b.preferredDate : null,
        channel: 'link',
      })
    } catch (err: any) {
      set.status = err?.status || 400
      return { error: err?.message || 'Yanıt kaydedilemedi' }
    }
  },

  async getWorkingHours() {
    const { getClinicWorkingHours } = await import('../db/repositories/settings')
    return getClinicWorkingHours()
  },

  async getStaffPermissions(cookie: any, request?: Request) {
    const isAdmin = cookie?.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici' } : await authenticateRequest(cookie?.token?.value as string | undefined, request)
    const {
      getClinicStaffPermissions,
      getClinicRoleTabPermissions,
      getEffectiveUserAccess,
    } = await import('../services/staff-invitations')
    const clinicId = requireClinicId()
    const role = user?.role || 'yonetici'
    const [config, roleTabs, effectiveAccess] = await Promise.all([
      getClinicStaffPermissions(clinicId),
      getClinicRoleTabPermissions(clinicId),
      getEffectiveUserAccess(clinicId, { id: user?.id, role }),
    ])
    return {
      role,
      businessTemplate: currentTenant()?.businessTemplate || 'general',
      config,
      roleTabs,
      effective: effectiveAccess.staffPermissions,
      effectiveAllowedTabs: effectiveAccess.allowedTabs,
    }
  },
}

export const calendarPlugin = new Elysia({ prefix: '/api/calendar' })
  .get('/employees', () => calendarHandlers.listEmployees())
  .post('/employees', ({ body, set }) => calendarHandlers.createEmployee(body, set))
  .get('/employees/leaves', ({ query }) => calendarHandlers.listLeaves(query))
  .get('/leaves', ({ query }) => calendarHandlers.listLeaves(query))
  .post('/employees/leaves', ({ body, set, cookie, request }) => calendarHandlers.createLeave(body, set, cookie, request))
  .post('/leaves', ({ body, set, cookie, request }) => calendarHandlers.createLeave(body, set, cookie, request))
  .delete('/employees/leaves/:id', ({ params, set }) => calendarHandlers.deleteLeave(params.id, set))
  .delete('/leaves/:id', ({ params, set }) => calendarHandlers.deleteLeave(params.id, set))
  .get('/appointments', ({ query }) => calendarHandlers.listAppointments(query))
  .post('/appointments', ({ body, set, cookie, request }) => calendarHandlers.createAppointment(body, set, cookie, request))
  .put('/appointments/:id', ({ params, body, set, cookie, request }) => calendarHandlers.updateAppointment(params.id, body, set, cookie, request))
  .delete('/appointments/:id', ({ params, set }) => calendarHandlers.deleteAppointment(params.id, set))
  .post('/appointments/:id/approve-ai', ({ params, body, set, cookie, request }) => calendarHandlers.approveAiAppointment(params.id, body, set, cookie, request))
  .post('/appointments/:id/reject-ai', ({ params, body, set, cookie, request }) => calendarHandlers.rejectAiAppointment(params.id, body, set, cookie, request))
  .post('/appointments/:id/recipient-response', ({ params, body, set }) => calendarHandlers.applyAppointmentResponse(params.id, body, set))
  .post('/appointments/:id/patient-response', ({ params, body, set }) => calendarHandlers.applyAppointmentResponse(params.id, body, set))
  .get('/working-hours', () => calendarHandlers.getWorkingHours())
  .get('/staff-permissions', ({ cookie, request }) => calendarHandlers.getStaffPermissions(cookie, request))
