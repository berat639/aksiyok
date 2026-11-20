import { Elysia } from 'elysia'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/client'
import { expenses, inventoryItems, auditLog, users } from '../db/schema'
import { authenticateRequest } from '../middleware/auth'
import { requireClinicId } from '../tenancy/context'
import { getClinicEntitlements } from '../services/subscriptions'

function requireYonetici(user: any, set: any) {
  if (!user) { set.status = 401; return false }
  if (user.role !== 'yonetici') { set.status = 403; return false }
  return true
}

async function checkInventoryModuleAccess(user: any, set: any) {
  if (user?.isPlatformAdmin) return null
  const plan = await getClinicEntitlements(requireClinicId())
  if (!plan.features.inventoryModule) {
    set.status = 403
    return {
      error: 'Stok ve bakım modülü Pro ve Kurumsal paketlerde aktiftir.',
      upgradeRequired: true,
      requiredPlan: 'pro',
    }
  }
  return null
}

async function checkPhoneIntegrationAccess(service: string, user: any, set: any) {
  if (service !== 'phone' || user?.isPlatformAdmin) return null
  const plan = await getClinicEntitlements(requireClinicId())
  if (!plan.features.inboundCalls) {
    set.status = 403
    return {
      error: 'Gelen ve giden sesli arama entegrasyonu Pro pakette aktiftir. Pro pakete geçiş başvurusu yapabilirsiniz.',
      upgradeRequired: true,
      requiredPlan: 'pro',
    }
  }
  return null
}

export const yoneticiPlugin = new Elysia({ prefix: '/api/yonetici' })

  .get('/telephony-numbers', async ({ cookie, set }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined))
    if (!requireYonetici(user, set)) return { error: 'Yetki yok' }
    const { listClinicPhoneNumbers } = await import('../db/repositories/clinic-phone-numbers')
    return listClinicPhoneNumbers()
  })

  .post('/telephony-numbers', ({ set }) => { set.status = 403; return { error: 'Telefon numaraları yalnız platform İşletmeler ekranından yönetilir.' } })

  .put('/telephony-numbers/:id', ({ set }) => { set.status = 403; return { error: 'Telefon numaraları yalnız platform İşletmeler ekranından yönetilir.' } })

  .delete('/telephony-numbers/:id', ({ set }) => { set.status = 403; return { error: 'Telefon numaraları yalnız platform İşletmeler ekranından yönetilir.' } })

  // ── Inventory ──────────────────────────────────────────────────────────────
  .get('/inventory', async ({ cookie, set, request }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!requireYonetici(user, set)) return { error: 'Yetki yok' }
    const denied = await checkInventoryModuleAccess(user, set)
    if (denied) return denied
    return db.select().from(inventoryItems).where(eq(inventoryItems.clinicId, requireClinicId())).orderBy(inventoryItems.name)
  })

  .post('/inventory', async ({ body, cookie, set, request }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!requireYonetici(user, set)) return { error: 'Yetki yok' }
    const denied = await checkInventoryModuleAccess(user, set)
    if (denied) return denied

    const b = body as any
    if (!b.name) { set.status = 400; return { error: 'name gerekli' } }

    const quantity = Number(b.quantity || 0)
    const unitCost = Number(b.costPerUnit || 0)
    const totalCost = Number(b.totalCost || (quantity * unitCost) || 0)
    const isRefund = Boolean(b.isRefund)

    const [created] = await db.insert(inventoryItems).values({
      clinicId: requireClinicId(),
      name: b.name, category: b.category || 'genel', quantity: b.quantity || 0,
      minThreshold: b.minThreshold || 5, unit: b.unit || 'adet', costPerUnit: unitCost,
      brand: b.brand || null, expiryDate: b.expiryDate || null, supplierName: b.supplierName || null,
    }).returning()

    if (totalCost > 0) {
      await db.insert(expenses).values({
        clinicId: requireClinicId(),
        category: b.category === 'cihaz' ? 'cihaz_alim' : 'malzeme_alim',
        itemName: created.name,
        quantity: Math.max(1, quantity || 1),
        unitCost,
        totalCost: isRefund ? -Math.abs(totalCost) : Math.abs(totalCost),
        enteredBy: user!.id,
        notes: b.notes || (isRefund ? 'Alım iadesi' : 'Stok alımı'),
        date: new Date().toISOString().slice(0, 10),
      })
    }

    return created
  })

  // ── User Management & KVKK Email Invitations ───────────────────────────────
  .get('/users/invitations', async ({ cookie, set }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici' } : await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined))
    const { hasClinicStaffPermission, listStaffInvitations, getClinicSmtpStatus } = await import('../services/staff-invitations')
    const clinicId = requireClinicId()
    if (!user || !(await hasClinicStaffPermission(clinicId, user.role, 'manageStaff', user.id))) {
      set.status = 403; return { error: 'Yetki yok' }
    }
    const [invitations, smtpStatus] = await Promise.all([
      listStaffInvitations(clinicId),
      getClinicSmtpStatus(clinicId),
    ])
    return { invitations, smtpStatus }
  })

  .post('/users/invite', async ({ body, cookie, set, request }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici', isPlatformAdmin: false } : await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    const {
      hasClinicStaffPermission,
      createStaffInvitation,
      saveInviteAccessOverride,
      saveClinicRoleTabPermissions,
      saveClinicStaffPermissions,
      normalizeConfigurableRole,
    } = await import('../services/staff-invitations')
    const clinicId = requireClinicId()
    if (!user || !(await hasClinicStaffPermission(clinicId, user.role, 'manageStaff', user.id))) {
      set.status = 403; return { error: 'Yetki yok' }
    }

    const b = (body || {}) as any
    const plan = await getClinicEntitlements(clinicId)

    if (!user.isPlatformAdmin) {
      if (plan.adminOnlyUsers) {
        if (b.role !== 'yonetici') {
          set.status = 403
          return {
            error: 'Demo paketinde yalnızca yönetici yetkili 2 kullanıcı tanımlanabilir. Personel yönetimi Pro pakette aktiftir.',
            upgradeRequired: true,
            requiredPlan: 'pro',
          }
        }
      } else if (b.role === 'yonetici') {
        set.status = 403
        return { error: 'İşletme yöneticisi ataması ve e-posta daveti yalnızca satış ekibi tarafından İşletmeler sekmesinden yapılabilir.' }
      }

      if (plan.activeUsersCount + plan.pendingInvitesCount >= plan.maxUsers) {
        set.status = 403
        return {
          error:
            plan.planId === 'demo'
              ? 'Demo paketinde en fazla 2 yönetici kullanıcı tanımlanabilir. 10 kullanıcıya kadar eklemek için Pro pakete geçin.'
              : `Paket kullanıcı sınırına (${plan.maxUsers}) ulaşıldı.`,
          upgradeRequired: true,
          requiredPlan: plan.planId === 'demo' ? 'pro' : 'kurumsal',
        }
      }
    }

    const assignedRole =
      b.role === 'yonetici' && (plan.adminOnlyUsers || user.isPlatformAdmin)
        ? 'yonetici'
        : ['calisan', 'hekim', 'sekreter', 'host', 'asistan'].includes(b.role)
          ? b.role
          : 'calisan'
    const hostname = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000'
    try {
      const invitation = await createStaffInvitation({
        clinicId,
        invitedBy: user.id || null,
        name: b.name,
        email: b.email,
        role: assignedRole,
        specialty: b.specialty,
        color: b.color,
        hostname,
      })

      if (b.allowedTabs !== undefined || b.staffPermissions !== undefined) {
        await saveInviteAccessOverride(
          clinicId,
          b.email,
          { allowedTabs: b.allowedTabs, staffPermissions: b.staffPermissions },
          assignedRole,
        )
        if (b.saveAsRoleDefault === true && (user.role === 'yonetici' || user.role === 'moderator')) {
          const normRole = normalizeConfigurableRole(assignedRole)
          if (b.allowedTabs !== undefined) {
            await saveClinicRoleTabPermissions(clinicId, { [normRole]: b.allowedTabs })
          }
          if (b.staffPermissions !== undefined) {
            await saveClinicStaffPermissions(clinicId, { [normRole]: b.staffPermissions })
          }
        }
      }

      return { ok: true, invitation }
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Davet gönderilemedi.' }
    }
  })

  .delete('/users/invitations/:id', async ({ params, cookie, set }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici' } : await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined))
    const { hasClinicStaffPermission, revokeStaffInvitation } = await import('../services/staff-invitations')
    const clinicId = requireClinicId()
    if (!user || !(await hasClinicStaffPermission(clinicId, user.role, 'manageStaff', user.id))) {
      set.status = 403; return { error: 'Yetki yok' }
    }
    const ok = await revokeStaffInvitation(clinicId, params.id)
    if (!ok) { set.status = 404; return { error: 'Davet bulunamadı' } }
    return { ok: true }
  })

  .post('/users', async ({ body, cookie, set, request }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici', isPlatformAdmin: false } : await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    const {
      hasClinicStaffPermission,
      saveUserAccessOverride,
      saveClinicRoleTabPermissions,
      saveClinicStaffPermissions,
      normalizeConfigurableRole,
    } = await import('../services/staff-invitations')
    const clinicId = requireClinicId()
    if (!user || !(await hasClinicStaffPermission(clinicId, user.role, 'manageStaff', user.id))) {
      set.status = 403; return { error: 'Yetki yok' }
    }

    const b = body as any
    if (!b.email || !b.name || !b.password || !b.role) {
      set.status = 400; return { error: 'E-posta, ad soyad, şifre ve rol gerekli' }
    }

    const plan = await getClinicEntitlements(clinicId)
    if (!user.isPlatformAdmin) {
      if (plan.adminOnlyUsers) {
        if (b.role !== 'yonetici') {
          set.status = 403
          return {
            error: 'Demo paketinde yalnızca yönetici yetkili 2 kullanıcı tanımlanabilir. Personel yönetimi Pro pakette aktiftir.',
            upgradeRequired: true,
            requiredPlan: 'pro',
          }
        }
      } else if (b.role === 'yonetici') {
        set.status = 403
        return { error: 'İşletme yöneticisi ataması yalnızca satış ekibi tarafından İşletmeler sekmesinden yapılabilir.' }
      }

      if (plan.activeUsersCount + plan.pendingInvitesCount >= plan.maxUsers) {
        set.status = 403
        return {
          error:
            plan.planId === 'demo'
              ? 'Demo paketinde en fazla 2 yönetici kullanıcı tanımlanabilir. 10 kullanıcıya kadar eklemek için Pro pakete geçin.'
              : `Paket kullanıcı sınırına (${plan.maxUsers}) ulaşıldı.`,
          upgradeRequired: true,
          requiredPlan: plan.planId === 'demo' ? 'pro' : 'kurumsal',
        }
      }
    }

    const allowedRoles =
      plan.adminOnlyUsers || user.isPlatformAdmin
        ? ['yonetici', 'calisan', 'hekim', 'sekreter', 'host', 'asistan']
        : ['calisan', 'hekim', 'sekreter', 'host', 'asistan']
    if (!allowedRoles.includes(b.role)) {
      set.status = 400; return { error: 'Geçersiz personel rolü seçildi' }
    }

    const { getUserByEmail, createUser } = await import('../db/repositories/users')
    const existing = await getUserByEmail(b.email.toLowerCase().trim())
    if (existing) { set.status = 409; return { error: 'Bu e-posta zaten kayıtlı' } }

    const hash = await Bun.password.hash(b.password)
    const created = await createUser({
      email: b.email.toLowerCase().trim(),
      passwordHash: hash,
      name: b.name,
      role: b.role,
      phone: b.phone,
      specialty: b.specialty,
      color: b.color,
    })

    if (b.allowedTabs !== undefined || b.staffPermissions !== undefined) {
      await saveUserAccessOverride(
        clinicId,
        created.id,
        { allowedTabs: b.allowedTabs, staffPermissions: b.staffPermissions },
        created.role,
      )
      if (b.saveAsRoleDefault === true && (user.role === 'yonetici' || user.role === 'moderator')) {
        const normRole = normalizeConfigurableRole(created.role)
        if (b.allowedTabs !== undefined) {
          await saveClinicRoleTabPermissions(clinicId, { [normRole]: b.allowedTabs })
        }
        if (b.staffPermissions !== undefined) {
          await saveClinicStaffPermissions(clinicId, { [normRole]: b.staffPermissions })
        }
      }
    }

    return { id: created.id, email: created.email, name: created.name, role: created.role }
  })

  .put('/users/:id', async ({ params, body, cookie, set }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici' } : await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined))
    const {
      hasClinicStaffPermission,
      saveUserAccessOverride,
      saveClinicRoleTabPermissions,
      saveClinicStaffPermissions,
      normalizeConfigurableRole,
    } = await import('../services/staff-invitations')
    const clinicId = requireClinicId()
    if (!user || !(await hasClinicStaffPermission(clinicId, user.role, 'manageStaff', user.id))) {
      set.status = 403; return { error: 'Yetki yok' }
    }

    const { updateUser, getUserById } = await import('../db/repositories/users')
    const b = body as any

    const targetUser = await getUserById(params.id)
    if (!targetUser) { set.status = 404; return { error: 'Kullanıcı bulunamadı' } }

    const isTargetAdmin = targetUser.role === 'yonetici'
    if (isTargetAdmin && b.active !== undefined && b.active !== targetUser.active) {
      set.status = 403
      return {
        error:
          'Yönetici hesabı yalnızca satışçı tarafından İşletmeler sekmesinden ilgili işletme altında dondurulabilir veya aktifleştirilebilir.',
      }
    }
    if (isTargetAdmin && b.role && b.role !== 'yonetici') {
      set.status = 403
      return {
        error:
          'Yönetici hesabının rolü personel ekranından düşürülemez. Yönetici işlemleri yalnızca satışçı tarafından İşletmeler sekmesinden yapılabilir.',
      }
    }
    if (!isTargetAdmin && b.role === 'yonetici') {
      set.status = 403
      return {
        error:
          'İşletme yöneticisi ataması yalnızca satışçı tarafından İşletmeler sekmesinden ilgili işletme altında yapılabilir.',
      }
    }

    const data: any = {}
    if (b.name) data.name = b.name
    if (b.email) data.email = b.email.toLowerCase().trim()
    if (b.phone !== undefined) data.phone = b.phone
    if (b.role && ['yonetici', 'calisan', 'hekim', 'sekreter', 'host', 'asistan'].includes(b.role)) data.role = b.role
    if (b.specialty !== undefined) data.specialty = b.specialty || null
    if (b.color !== undefined) data.color = b.color || null
    if (b.active !== undefined) data.active = b.active
    if (b.password) data.passwordHash = await Bun.password.hash(b.password)

    const updated = await updateUser(params.id, data)
    if (!updated) { set.status = 404; return { error: 'Kullanıcı bulunamadı' } }

    const finalRole = data.role || updated.role
    if (!isTargetAdmin && (b.allowedTabs !== undefined || b.staffPermissions !== undefined)) {
      await saveUserAccessOverride(
        clinicId,
        params.id,
        { allowedTabs: b.allowedTabs, staffPermissions: b.staffPermissions },
        finalRole,
      )
      if (b.saveAsRoleDefault === true && (user.role === 'yonetici' || user.role === 'moderator')) {
        const normRole = normalizeConfigurableRole(finalRole)
        if (b.allowedTabs !== undefined) {
          await saveClinicRoleTabPermissions(clinicId, { [normRole]: b.allowedTabs })
        }
        if (b.staffPermissions !== undefined) {
          await saveClinicStaffPermissions(clinicId, { [normRole]: b.staffPermissions })
        }
      }
    }

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      active: updated.active,
      unassignedAppointmentsCount: updated.unassignedAppointmentsCount ?? 0,
    }
  })

  .delete('/users/:id', async ({ params, cookie, set }) => {
    const isAdmin = cookie.admin_auth?.value === 'true'
    const user = isAdmin ? { id: null, role: 'yonetici' } : await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined))
    const { hasClinicStaffPermission } = await import('../services/staff-invitations')
    const clinicId = requireClinicId()
    if (!user || !(await hasClinicStaffPermission(clinicId, user.role, 'manageStaff', user.id))) {
      set.status = 403; return { error: 'Yetki yok' }
    }

    if (user.id === params.id) {
      set.status = 400; return { error: 'Kendi hesabınızı silemezsiniz' }
    }

    const { deleteUser, getUserById } = await import('../db/repositories/users')
    const targetUser = await getUserById(params.id)
    if (targetUser?.role === 'yonetici') {
      set.status = 403
      return { error: 'Yönetici hesabı personel ekranından silinemez. Yönetici işlemleri yalnızca satışçı tarafından İşletmeler sekmesinden yapılabilir.' }
    }

    const ok = await deleteUser(params.id)
    if (!ok) { set.status = 404; return { error: 'Kullanıcı bulunamadı' } }
    return { success: true }
  })

  // ── Integrations ───────────────────────────────────────────────────────────
  .get('/integrations', async ({ cookie, set }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined))
    if (!requireYonetici(user, set)) return { error: 'Yetki yok' }

    const { integrationView } = await import('../integrations/managed/store')
    return integrationView(requireClinicId(), true)
  })

  .put('/integrations/:service', async ({ params, body, cookie, set, request }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!requireYonetici(user, set)) return { error: 'Yetki yok' }
    const denied = await checkPhoneIntegrationAccess(params.service, user, set)
    if (denied) return denied
    try {
      const { serviceOf } = await import('../integrations/managed/model')
      const { saveConfig } = await import('../integrations/managed/store')
      return await saveConfig(requireClinicId(), serviceOf(params.service), (body ?? {}) as Record<string, unknown>, user!.id)
    } catch (err: any) {
      set.status = err?.status || 400
      return { error: err?.message || 'Entegrasyon ayarları kaydedilemedi.' }
    }
  })

  .post('/integrations/:service/test', async ({ params, body, cookie, set, request }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!requireYonetici(user, set)) return { error: 'Yetki yok' }
    const denied = await checkPhoneIntegrationAccess(params.service, user, set)
    if (denied) return denied
    try {
      const { serviceOf } = await import('../integrations/managed/model')
      const { beginTest } = await import('../integrations/managed/workflow')
      return await beginTest(requireClinicId(), serviceOf(params.service), (body ?? {}) as Record<string, unknown>, user!.id)
    } catch (err: any) {
      set.status = err?.status || 400
      return { error: err?.message || 'Bağlantı testi başlatılamadı.' }
    }
  })

  .post('/integrations/:service/tests/:testId/confirm', async ({ params, cookie, set, request }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!requireYonetici(user, set)) return { error: 'Yetki yok' }
    const denied = await checkPhoneIntegrationAccess(params.service, user, set)
    if (denied) return denied
    try {
      const { serviceOf } = await import('../integrations/managed/model')
      const { confirmTest } = await import('../integrations/managed/workflow')
      return await confirmTest(requireClinicId(), serviceOf(params.service), params.testId, user!.id)
    } catch (err: any) {
      set.status = err?.status || 400
      return { error: err?.message || 'Test doğrulaması tamamlanamadı.' }
    }
  })

  .post('/integrations/:service/tests/:testId/cancel', async ({ params, cookie, set, request }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!requireYonetici(user, set)) return { error: 'Yetki yok' }
    const denied = await checkPhoneIntegrationAccess(params.service, user, set)
    if (denied) return denied
    try {
      const { serviceOf } = await import('../integrations/managed/model')
      const { cancelTest } = await import('../integrations/managed/workflow')
      return await cancelTest(requireClinicId(), serviceOf(params.service), params.testId, user!.id)
    } catch (err: any) {
      set.status = err?.status || 400
      return { error: err?.message || 'Test iptal edilemedi.' }
    }
  })

  .post('/integrations/:service/activate', async ({ params, body, cookie, set, request }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!requireYonetici(user, set)) return { error: 'Yetki yok' }
    const denied = await checkPhoneIntegrationAccess(params.service, user, set)
    if (denied) return denied
    try {
      const { serviceOf } = await import('../integrations/managed/model')
      const { setEnabled } = await import('../integrations/managed/workflow')
      const payload = (body ?? {}) as { revision?: number; force?: boolean }
      return await setEnabled(requireClinicId(), serviceOf(params.service), true, Number(payload.revision || 0), user!.id, payload.force !== false)
    } catch (err: any) {
      set.status = err?.status || 400
      return { error: err?.message || 'Entegrasyon etkinleştirilemedi.' }
    }
  })

  .post('/integrations/:service/deactivate', async ({ params, body, cookie, set, request }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!requireYonetici(user, set)) return { error: 'Yetki yok' }
    const denied = await checkPhoneIntegrationAccess(params.service, user, set)
    if (denied) return denied
    try {
      const { serviceOf } = await import('../integrations/managed/model')
      const { setEnabled } = await import('../integrations/managed/workflow')
      const payload = (body ?? {}) as { revision?: number }
      return await setEnabled(requireClinicId(), serviceOf(params.service), false, Number(payload.revision || 0), user!.id)
    } catch (err: any) {
      set.status = err?.status || 400
      return { error: err?.message || 'Entegrasyon devre dışı bırakılamadı.' }
    }
  })

  .delete('/integrations/:service', async ({ params, cookie, set, request }) => {
    const user = await authenticateRequest(((cookie.token?.value as string | undefined) as string | undefined), request)
    if (!requireYonetici(user, set)) return { error: 'Yetki yok' }
    const denied = await checkPhoneIntegrationAccess(params.service, user, set)
    if (denied) return denied
    try {
      const { serviceOf } = await import('../integrations/managed/model')
      const { removeConfig } = await import('../integrations/managed/store')
      return await removeConfig(requireClinicId(), serviceOf(params.service), user!.id)
    } catch (err: any) {
      set.status = err?.status || 400
      return { error: err?.message || 'Entegrasyon kaldırılamadı.' }
    }
  })
