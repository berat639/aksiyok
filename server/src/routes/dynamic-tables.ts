import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { clinics } from '../db/schema'
import { invalidateTenantCache, requireClinicId } from '../tenancy/context'
import { authenticateRequest, type AuthUser } from '../middleware/auth'
import {
  applyDynamicStockMovement,
  applyModuleStarterPack,
  completeDynamicMaintenance,
  createQuickDynamicFinanceEntry,
  ensureCanonicalFinanceTables,
  getDynamicFinanceOverview,
  getDynamicStockOverview,
  migrateLegacyModuleData,
  type FinanceChartPeriod,
  type ModuleStarterPackKey,
} from '../services/dynamic-finance-stock'
import {
  acknowledgePreAccountingSync,
  exportCanonicalAccountingLedger,
  listCanonicalAccountingEntries,
  listPreAccountingProviders,
  upsertPreAccountingConnection,
} from '../services/pre-accounting'
import {
  evaluateKpiCards,
  getKpiBootstrap,
  getKpiSourcesAndPresets,
  getSavedKpiCards,
  saveKpiCards,
  type KpiCardConfig,
} from '../services/dynamic-kpi'
import {
  generateOfferingsWithGemini,
  validateOfferingWithGemini,
} from '../services/offerings-ai'
import { buildDynamicSchemaFromScenario } from '../services/dynamic-schema-ai'
import { hasClinicStaffPermission } from '../services/staff-invitations'
import {
  ALLOWED_MODULE_ROLES,
  applyStarterBlueprint,
  archiveDynamicRows,
  batchSaveCanvasLayout,
  bulkImportDynamicRows,
  clearDynamicTables,
  createDynamicColumn,
  createDynamicRelation,
  createDynamicRow,
  createDynamicTable,
  deleteAppointmentConfig,
  deleteDynamicColumn,
  deleteDynamicRelation,
  deleteDynamicRows,
  deleteDynamicTable,
  deleteModuleConfig,
  getAppointmentBookingContext,
  getDynamicRowDetail,
  getStudioSchema,
  listDynamicRows,
  restoreDynamicRows,
  updateAppointmentDynamicLinksAndMeta,
  updateDynamicColumn,
  updateDynamicRow,
  updateDynamicTable,
  updateStudioSettings,
  upsertAppointmentConfig,
  upsertModuleConfig,
  type DynamicFieldType,
  type DynamicModuleRole,
  type RelationCardinality,
} from '../db/repositories/dynamic-tables'

async function canManageSchema(user: AuthUser | null): Promise<boolean> {
  if (!user) return false
  if (user.role === 'yonetici' || Boolean(user.isPlatformAdmin)) return true
  return await hasClinicStaffPermission(user.clinicId, user.role, 'manageDynamicTables', user.id)
}

export const dynamicTablesPlugin = new Elysia({ prefix: '/api/dynamic-tables' })

  .get('/schema', async ({ cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const [schema, allowed] = await Promise.all([
      getStudioSchema(),
      canManageSchema(user),
    ])
    return {
      ...schema,
      canManageSchema: allowed,
    }
  })

  .put('/settings', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Tablo yapılandırma yetkiniz bulunmuyor' }
    }
    const b = (body || {}) as Record<string, any>
    try {
      const schema = await updateStudioSettings({
        tabLabel: typeof b.tabLabel === 'string' ? b.tabLabel : undefined,
        appointmentNodePosition: b.appointmentNodePosition,
      })
      return { ...schema, canManageSchema: true }
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Ayarlar güncellenemedi' }
    }
  })

  .post('/starter-blueprint', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Şablon oluşturma yetkiniz bulunmuyor' }
    }
    const blueprint = (body as any)?.blueprint
    if (
      ![
        'real_estate_appointment',
        'insurance_quote',
        'dental_clinic',
        'customer_service',
        'consultant_sessions',
        'vehicle_service',
      ].includes(blueprint)
    ) {
      set.status = 400
      return { error: 'Geçersiz başlangıç şablonu' }
    }
    try {
      const schema = await applyStarterBlueprint(blueprint)
      const nextTemplate = blueprint === 'dental_clinic' ? 'dental_clinic' : 'general'
      try {
        const clinicId = requireClinicId()
        await db.update(clinics).set({ businessTemplate: nextTemplate }).where(eq(clinics.id, clinicId))
        invalidateTenantCache()
      } catch {
        // Test veya bellek içi modda devam edilir
      }
      return { ...schema, businessTemplate: nextTemplate, canManageSchema: true }
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Şablon uygulanamadı' }
    }
  })

  .post('/ai-build', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Senaryo ile tablo oluşturma yetkiniz bulunmuyor' }
    }
    const scenario = typeof (body as any)?.scenario === 'string' ? (body as any).scenario : ''
    try {
      const result = await buildDynamicSchemaFromScenario(scenario, user?.id)
      return {
        summary: result.summary,
        modelUsed: result.modelUsed,
        createdTableCount: result.createdTableCount,
        createdRelationCount: result.createdRelationCount,
        schema: {
          ...result.schema,
          canManageSchema: true,
        },
      }
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Senaryo uygulanamadı' }
    }
  })

  .put('/canvas-layout', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Şema yerleşimini kaydetme yetkiniz bulunmuyor' }
    }
    const b = (body || {}) as any
    try {
      return await batchSaveCanvasLayout({
        tables: b.tables,
        appointmentNodePosition: b.appointmentNodePosition,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Yerleşim kaydedilemedi' }
    }
  })

  // ── Tables ───────────────────────────────────────────────────────────────

  .post('/tables/clear', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Tabloları temizleme yetkiniz yok' }
    }
    const b = (body || {}) as {
      mode?: 'all' | 'manual' | 'selected'
      tableIds?: string[]
    }
    const mode =
      b.mode === 'all' || b.mode === 'manual' || b.mode === 'selected' ? b.mode : undefined
    try {
      const result = await clearDynamicTables({
        mode,
        tableIds: Array.isArray(b.tableIds) ? b.tableIds : undefined,
      })
      return {
        ...result,
        schema: {
          ...result.schema,
          canManageSchema: true,
        },
      }
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Tablolar temizlenemedi' }
    }
  })

  .post('/tables', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Tablo oluşturma yetkiniz yok' }
    }
    const b = (body || {}) as any
    try {
      return await createDynamicTable({
        name: b.name,
        icon: b.icon,
        color: b.color,
        description: b.description,
        canvasX: b.canvasX,
        canvasY: b.canvasY,
        initialColumns: b.initialColumns,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Tablo oluşturulamadı' }
    }
  })

  .put('/tables/:tableId', async ({ params, body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Tablo düzenleme yetkiniz yok' }
    }
    const b = (body || {}) as any
    try {
      return await updateDynamicTable(params.tableId, {
        name: b.name,
        icon: b.icon,
        color: b.color,
        description: b.description,
        canvasX: b.canvasX,
        canvasY: b.canvasY,
        sortOrder: b.sortOrder,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Tablo güncellenemedi' }
    }
  })

  .delete('/tables/:tableId', async ({ params, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Tablo silme yetkiniz yok' }
    }
    try {
      return await deleteDynamicTable(params.tableId)
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Tablo silinemedi' }
    }
  })

  // ── Columns ──────────────────────────────────────────────────────────────

  .post('/tables/:tableId/columns', async ({ params, body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Sütun ekleme yetkiniz yok' }
    }
    const b = (body || {}) as any
    try {
      return await createDynamicColumn(params.tableId, {
        name: b.name,
        fieldType: b.fieldType as DynamicFieldType,
        isPrimaryTitle: b.isPrimaryTitle,
        isRequired: b.isRequired,
        isUnique: b.isUnique,
        showInTable: b.showInTable,
        width: b.width,
        config: b.config,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Sütun eklenemedi' }
    }
  })

  .put('/columns/:columnId', async ({ params, body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const b = (body || {}) as any
    // Allow non-admin staff to resize columns visually only if they only send width, otherwise require manageDynamicTables
    const keys = Object.keys(b)
    const isResizeOnly = keys.length === 1 && keys[0] === 'width'
    if (!isResizeOnly && !(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Sütun ayarlarını değiştirme yetkiniz yok' }
    }
    try {
      return await updateDynamicColumn(params.columnId, {
        name: b.name,
        fieldType: b.fieldType,
        isPrimaryTitle: b.isPrimaryTitle,
        isRequired: b.isRequired,
        isUnique: b.isUnique,
        showInTable: b.showInTable,
        width: b.width,
        sortOrder: b.sortOrder,
        config: b.config,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Sütun güncellenemedi' }
    }
  })

  .delete('/columns/:columnId', async ({ params, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Sütun silme yetkiniz yok' }
    }
    try {
      return await deleteDynamicColumn(params.columnId)
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Sütun silinemedi' }
    }
  })

  // ── Relations ────────────────────────────────────────────────────────────

  .post('/relations', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'İlişki tanımlama yetkiniz yok' }
    }
    const b = (body || {}) as any
    try {
      return await createDynamicRelation({
        sourceTableId: b.sourceTableId,
        targetTableId: b.targetTableId,
        sourceColumnName: b.sourceColumnName,
        inverseColumnName: b.inverseColumnName,
        createInverseColumn: b.createInverseColumn,
        cardinality: b.cardinality as RelationCardinality,
        onDelete: b.onDelete,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'İlişki oluşturulamadı' }
    }
  })

  .delete('/relations/:relationId', async ({ params, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'İlişki silme yetkiniz yok' }
    }
    try {
      return await deleteDynamicRelation(params.relationId)
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'İlişki silinemedi' }
    }
  })

  // ── Appointment Configs ──────────────────────────────────────────────────

  .put('/appointment-configs/:tableId', async ({ params, body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Randevu bağlantı ayarlarını değiştirme yetkiniz yok' }
    }
    const b = (body || {}) as any
    try {
      return await upsertAppointmentConfig({
        tableId: params.tableId,
        enabled: b.enabled,
        titleColumnId: b.titleColumnId,
        phoneColumnId: b.phoneColumnId,
        emailColumnId: b.emailColumnId,
        isRequiredInAppointment: b.isRequiredInAppointment,
        allowMultiple: b.allowMultiple,
        includeRelatedTables: b.includeRelatedTables,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Randevu bağlantısı kaydedilemedi' }
    }
  })

  .delete('/appointment-configs/:tableId', async ({ params, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Randevu bağlantısını kaldırma yetkiniz yok' }
    }
    try {
      return await deleteAppointmentConfig(params.tableId)
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Randevu bağlantısı kaldırılamadı' }
    }
  })

  .get('/appointment-context', async ({ cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    return await getAppointmentBookingContext()
  })

  .put('/appointments/:appointmentId/links', async ({ params, body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const b = (body || {}) as any
    try {
      return await updateAppointmentDynamicLinksAndMeta(
        params.appointmentId,
        Array.isArray(b.links) ? b.links : [],
        { syncTitle: Boolean(b.syncTitle) }
      )
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Randevu bağlantıları güncellenemedi' }
    }
  })

  // ── Rows & Bulk Data ─────────────────────────────────────────────────────

  .get('/tables/:tableId/rows', async ({ params, query, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const q = (query || {}) as Record<string, string | undefined>
    return await listDynamicRows(params.tableId, {
      archived: q.archived === 'true',
      search: q.search,
    })
  })

  .post('/tables/:tableId/rows', async ({ params, body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const b = (body || {}) as any
    try {
      return await createDynamicRow(
        params.tableId,
        {
          values: b.values || {},
          relations: b.relations || {},
        },
        user.id
      )
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Kayıt eklenemedi' }
    }
  })

  .post('/tables/:tableId/rows/bulk', async ({ params, body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const b = (body || {}) as any
    if (!Array.isArray(b.rows)) {
      set.status = 400
      return { error: 'Geçersiz toplu veri listesi' }
    }
    try {
      return await bulkImportDynamicRows(params.tableId, b.rows, user.id)
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Toplu aktarım başarısız' }
    }
  })

  .get('/rows/:rowId/detail', async ({ params, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const detail = await getDynamicRowDetail(params.rowId)
    if (!detail) {
      set.status = 404
      return { error: 'Kayıt bulunamadı' }
    }
    return detail
  })

  .put('/rows/:rowId', async ({ params, body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const b = (body || {}) as any
    try {
      return await updateDynamicRow(params.rowId, {
        values: b.values,
        relations: b.relations,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Kayıt güncellenemedi' }
    }
  })

  .post('/rows/archive', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Kayıt arşivleme yetkiniz bulunmuyor' }
    }
    const rowIds = Array.isArray((body as any)?.rowIds) ? (body as any).rowIds : []
    return await archiveDynamicRows(rowIds)
  })

  .post('/rows/restore', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Kayıt geri yükleme yetkiniz bulunmuyor' }
    }
    const rowIds = Array.isArray((body as any)?.rowIds) ? (body as any).rowIds : []
    return await restoreDynamicRows(rowIds)
  })

  .post('/rows/delete', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Kayıt silme yetkiniz bulunmuyor' }
    }
    const rowIds = Array.isArray((body as any)?.rowIds) ? (body as any).rowIds : []
    try {
      return await deleteDynamicRows(rowIds)
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Kayıtlar silinemedi' }
    }
  })

  // ── Finance & Stock Module Configs, Starter Packs & Legacy Importer ──────

  .put('/module-configs/:tableId', async ({ params, body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Modül bağlantısını değiştirme yetkiniz bulunmuyor' }
    }
    const b = (body || {}) as any
    const role = b.moduleRole as DynamicModuleRole
    if (!ALLOWED_MODULE_ROLES.includes(role)) {
      set.status = 400
      return { error: 'Geçersiz modül rolü' }
    }
    try {
      return await upsertModuleConfig({
        tableId: params.tableId,
        moduleRole: role,
        enabled: b.enabled !== undefined ? Boolean(b.enabled) : true,
        mapping: b.mapping && typeof b.mapping === 'object' ? b.mapping : undefined,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Modül bağlantısı kaydedilemedi' }
    }
  })

  .delete('/module-configs/:tableId', async ({ params, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Modül bağlantısını kaldırma yetkiniz bulunmuyor' }
    }
    try {
      return await deleteModuleConfig(params.tableId)
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Modül bağlantısı kaldırılamadı' }
    }
  })

  .post('/module-starter-pack', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Hazır modül paketi kurma yetkiniz bulunmuyor' }
    }
    const pack = (body as any)?.pack as ModuleStarterPackKey
    const allowedPacks: ModuleStarterPackKey[] = [
      'general_finance',
      'real_estate_finance',
      'insurance_finance',
      'clinic_finance',
      'general_stock',
      'clinic_stock',
      'service_parts_stock',
    ]
    if (!allowedPacks.includes(pack)) {
      set.status = 400
      return { error: 'Geçersiz modül başlangıç paketi' }
    }
    try {
      const schema = await applyModuleStarterPack(pack)
      return { ...schema, canManageSchema: true }
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Modül paketi kurulamadı' }
    }
  })

  .post('/migrate-legacy-module-data', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Mevcut kayıtları aktarma yetkiniz bulunmuyor' }
    }
    const domain = (body as any)?.domain
    if (domain !== 'finance' && domain !== 'stock') {
      set.status = 400
      return { error: 'Geçersiz aktarım alanı' }
    }
    try {
      return await migrateLegacyModuleData(domain, user?.id)
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Kayıt aktarımı başarısız oldu' }
    }
  })

  // ── Dynamic Finance Engine & Pre-Accounting Integration Endpoints ────────

  .post('/finance/ensure', async ({ cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    try {
      const ensured = await ensureCanonicalFinanceTables()
      const [schema, allowed] = await Promise.all([getStudioSchema(), canManageSchema(user)])
      return {
        provisioned: ensured.provisioned,
        upgradedColumnsCount: ensured.upgradedColumnsCount,
        incomeTableId: ensured.incomeTable.table.id,
        expenseTableId: ensured.expenseTable.table.id,
        schema: {
          ...schema,
          canManageSchema: allowed,
        },
      }
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Standart finans tabloları hazırlanamadı' }
    }
  })

  .get('/finance/overview', async ({ query, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const q = (query || {}) as Record<string, string | undefined>
    const period: FinanceChartPeriod =
      q.period === 'daily' || q.period === 'weekly' || q.period === 'monthly'
        ? q.period
        : 'monthly'
    const status =
      q.status === 'completed' ||
      q.status === 'partial' ||
      q.status === 'pending' ||
      q.status === 'cancelled'
        ? q.status
        : 'all'
    const autoEnsure = q.ensure === '1' || q.ensure === 'true'
    try {
      return await getDynamicFinanceOverview({
        period,
        month: q.month,
        search: q.search,
        status,
        appointmentId: q.appointmentId,
        autoEnsure,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Finans özeti alınamadı' }
    }
  })

  .post('/finance/quick-entry', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const b = (body || {}) as any
    try {
      return await createQuickDynamicFinanceEntry(
        {
          entryType: b.entryType === 'expense' ? 'expense' : 'income',
          tableId: typeof b.tableId === 'string' ? b.tableId : undefined,
          title: typeof b.title === 'string' ? b.title : '',
          amount: Number(b.amount) || 0,
          netAmount: b.netAmount !== undefined && b.netAmount !== null && b.netAmount !== '' ? Number(b.netAmount) : undefined,
          vatRate: b.vatRate !== undefined && b.vatRate !== null && b.vatRate !== '' ? Number(b.vatRate) : undefined,
          vatIncluded: b.vatIncluded !== false,
          currency: typeof b.currency === 'string' ? b.currency : undefined,
          exchangeRate:
            b.exchangeRate !== undefined && b.exchangeRate !== null && b.exchangeRate !== ''
              ? Number(b.exchangeRate)
              : undefined,
          quantity: b.quantity !== undefined ? Number(b.quantity) : undefined,
          unitCost: b.unitCost !== undefined ? Number(b.unitCost) : undefined,
          date: typeof b.date === 'string' ? b.date : undefined,
          dueDate: typeof b.dueDate === 'string' ? b.dueDate : null,
          status:
            b.status === 'pending' ||
            b.status === 'partial' ||
            b.status === 'cancelled' ||
            b.status === 'completed'
              ? b.status
              : 'completed',
          method: typeof b.method === 'string' ? b.method : undefined,
          category: typeof b.category === 'string' ? b.category : undefined,
          documentType: typeof b.documentType === 'string' ? b.documentType : undefined,
          documentNumber: typeof b.documentNumber === 'string' ? b.documentNumber : null,
          counterpartyName: typeof b.counterpartyName === 'string' ? b.counterpartyName : null,
          counterpartyTaxId: typeof b.counterpartyTaxId === 'string' ? b.counterpartyTaxId : null,
          accountingCode: typeof b.accountingCode === 'string' ? b.accountingCode : null,
          notes: typeof b.notes === 'string' ? b.notes : undefined,
          personRowId: typeof b.personRowId === 'string' && b.personRowId ? b.personRowId : null,
          serviceRowIds: Array.isArray(b.serviceRowIds) ? b.serviceRowIds : undefined,
          itemRowId: typeof b.itemRowId === 'string' && b.itemRowId ? b.itemRowId : null,
          appointmentId:
            typeof b.appointmentId === 'string' && b.appointmentId ? b.appointmentId : null,
        },
        user.id
      )
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Finans kaydı eklenemedi' }
    }
  })

  .get('/finance/accounting/providers', async ({ cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    try {
      return await listPreAccountingProviders()
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Ön muhasebe sağlayıcıları alınamadı' }
    }
  })

  .put('/finance/accounting/connections/:provider', async ({ params, body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Ön muhasebe entegrasyon ayarlarını değiştirme yetkiniz bulunmuyor' }
    }
    const b = (body || {}) as Record<string, any>
    try {
      return await upsertPreAccountingConnection(
        params.provider,
        {
          status: b.status,
          syncMode: b.syncMode,
          externalCompanyId: b.externalCompanyId,
          credentials: b.credentials,
          accountMapping: b.accountMapping,
        },
        user?.id
      )
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Ön muhasebe bağlantısı kaydedilemedi' }
    }
  })

  .get('/finance/accounting/entries', async ({ query, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const q = (query || {}) as Record<string, string | undefined>
    const direction = q.direction === 'income' || q.direction === 'expense' ? q.direction : 'all'
    const syncStatus =
      q.syncStatus === 'pending' ||
      q.syncStatus === 'ready' ||
      q.syncStatus === 'synced' ||
      q.syncStatus === 'failed' ||
      q.syncStatus === 'ignored'
        ? q.syncStatus
        : 'all'
    try {
      return await listCanonicalAccountingEntries({
        direction,
        syncStatus,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        updatedAfter: q.updatedAfter,
        provider: q.provider,
        includeProviderPayload: q.includeProviderPayload === '1' || q.includeProviderPayload === 'true',
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Ön muhasebe kayıtları alınamadı' }
    }
  })

  .get('/finance/accounting/export', async ({ query, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const q = (query || {}) as Record<string, string | undefined>
    const format = q.format === 'csv' ? 'csv' : 'json'
    const direction = q.direction === 'income' || q.direction === 'expense' ? q.direction : 'all'
    const syncStatus =
      q.syncStatus === 'pending' ||
      q.syncStatus === 'ready' ||
      q.syncStatus === 'synced' ||
      q.syncStatus === 'failed' ||
      q.syncStatus === 'ignored'
        ? q.syncStatus
        : 'all'
    try {
      const exported = await exportCanonicalAccountingLedger({
        format,
        direction,
        syncStatus,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        provider: q.provider,
      })
      if (exported.format === 'csv') {
        return new Response(exported.body, {
          status: 200,
          headers: {
            'Content-Type': exported.contentType,
            'Content-Disposition': `attachment; filename="${exported.filename}"`,
          },
        })
      }
      return exported.data
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Ön muhasebe dışa aktarımı oluşturulamadı' }
    }
  })

  .post('/finance/accounting/sync-ack', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    if (!(await canManageSchema(user))) {
      set.status = 403
      return { error: 'Senkronizasyon durumunu güncelleme yetkiniz bulunmuyor' }
    }
    const b = (body || {}) as Record<string, any>
    const syncStatus =
      b.syncStatus === 'synced' ||
      b.syncStatus === 'failed' ||
      b.syncStatus === 'pending' ||
      b.syncStatus === 'ignored'
        ? b.syncStatus
        : null
    if (!syncStatus) {
      set.status = 400
      return { error: 'Geçersiz senkronizasyon durumu' }
    }
    try {
      return await acknowledgePreAccountingSync({
        provider: String(b.provider || ''),
        rowId: typeof b.rowId === 'string' ? b.rowId : undefined,
        idempotencyKey: typeof b.idempotencyKey === 'string' ? b.idempotencyKey : undefined,
        syncStatus,
        externalDocumentId: typeof b.externalDocumentId === 'string' ? b.externalDocumentId : null,
        externalContactId: typeof b.externalContactId === 'string' ? b.externalContactId : null,
        externalPaymentId: typeof b.externalPaymentId === 'string' ? b.externalPaymentId : null,
        externalDocumentNumber:
          typeof b.externalDocumentNumber === 'string' ? b.externalDocumentNumber : null,
        lastError: typeof b.lastError === 'string' ? b.lastError : null,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Senkronizasyon onayı kaydedilemedi' }
    }
  })

  // ── Dynamic Stock & Maintenance Engine Endpoints ─────────────────────────

  .get('/stock/overview', async ({ query, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const q = (query || {}) as Record<string, string | undefined>
    const alertFilter =
      q.alertFilter === 'skt_expired' ||
      q.alertFilter === 'skt_soon' ||
      q.alertFilter === 'low_stock' ||
      q.alertFilter === 'maintenance_due'
        ? q.alertFilter
        : 'all'
    try {
      return await getDynamicStockOverview({
        search: q.search,
        alertFilter,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Stok ve bakım özeti alınamadı' }
    }
  })

  .post('/stock/movement', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const b = (body || {}) as any
    try {
      return await applyDynamicStockMovement(
        {
          rowId: String(b.rowId || ''),
          movementType: b.movementType,
          quantity: Number(b.quantity) || 0,
          unitCost: b.unitCost !== undefined ? Number(b.unitCost) : undefined,
          notes: typeof b.notes === 'string' ? b.notes : undefined,
          recordInFinance: b.recordInFinance !== false,
        },
        { id: user.id, name: user.name }
      )
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Stok hareketi uygulanamadı' }
    }
  })

  .post('/stock/complete-maintenance', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const b = (body || {}) as any
    try {
      return await completeDynamicMaintenance(
        {
          rowId: String(b.rowId || ''),
          cost: b.cost !== undefined ? Number(b.cost) : undefined,
          notes: typeof b.notes === 'string' ? b.notes : undefined,
          recordInFinance: b.recordInFinance !== false,
        },
        { id: user.id, name: user.name }
      )
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Bakım tamamlanamadı' }
    }
  })

  // ── Dynamic Business KPI Engine Endpoints ───────────────────────────────

  .get('/kpi/bootstrap', async ({ query, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const forceRefresh = (query as Record<string, string | undefined>)?.refresh === '1'
    try {
      return await getKpiBootstrap(forceRefresh)
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'KPI özeti yüklenemedi' }
    }
  })

  .get('/kpi/sources', async ({ cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    try {
      return await getKpiSourcesAndPresets()
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'KPI kaynakları alınamadı' }
    }
  })

  .get('/kpi/cards', async ({ cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    try {
      const cards = await getSavedKpiCards()
      return { cards }
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'KPI kartları alınamadı' }
    }
  })

  .put('/kpi/cards', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const raw = (body as any)?.cards
    if (!Array.isArray(raw)) {
      set.status = 400
      return { error: 'Geçersiz kart listesi' }
    }
    try {
      const cards = await saveKpiCards(raw as KpiCardConfig[])
      return { cards }
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'KPI kartları kaydedilemedi' }
    }
  })

  .post('/kpi/evaluate', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const raw = (body as any)?.cards
    if (!Array.isArray(raw)) {
      set.status = 400
      return { error: 'Geçersiz kart listesi' }
    }
    try {
      const metrics = await evaluateKpiCards(raw as KpiCardConfig[])
      return { metrics }
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'KPI değerleri hesaplanamadı' }
    }
  })

  // ── Offerings (Ürün ve Hizmet) Gemini Lite Kontrol & Şablon Üretici ─────

  .post('/offerings/validate', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const b = (body || {}) as Record<string, unknown>
    try {
      return await validateOfferingWithGemini({
        kind: b.kind === 'urun' ? 'urun' : 'hizmet',
        title: typeof b.title === 'string' ? b.title : '',
        content: typeof b.content === 'string' ? b.content : '',
        businessName: typeof b.businessName === 'string' ? b.businessName : undefined,
        businessCategory: typeof b.businessCategory === 'string' ? b.businessCategory : undefined,
      })
    } catch (err: any) {
      set.status = 503
      return { error: err?.message || 'Uygunluk kontrolü yapılamadı' }
    }
  })

  .post('/offerings/ai-generate', async ({ body, cookie, request, set }) => {
    const user = await authenticateRequest(cookie.token?.value as string | undefined, request)
    if (!user) {
      set.status = 401
      return { error: 'Oturum geçersiz' }
    }
    const b = (body || {}) as Record<string, unknown>
    try {
      return await generateOfferingsWithGemini({
        prompt: typeof b.prompt === 'string' ? b.prompt : '',
        businessName: typeof b.businessName === 'string' ? b.businessName : undefined,
        businessCategory: typeof b.businessCategory === 'string' ? b.businessCategory : undefined,
        existingTitles: Array.isArray(b.existingTitles)
          ? b.existingTitles.filter((t): t is string => typeof t === 'string')
          : undefined,
      })
    } catch (err: any) {
      set.status = 400
      return { error: err?.message || 'Örnek şablon oluşturulamadı' }
    }
  })

