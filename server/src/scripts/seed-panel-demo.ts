/**
 * Idempotent local/demo seed script for:
 *  - Personel ve Mesai (realistic Turkish staff + shifts + permissions)
 *  - Stok ve Bakım (normal, low stock, SKT soon, SKT expired, overdue/upcoming/planned maintenance, movement history)
 *
 * Usage: cd server && bun --env-file=../.env run src/scripts/seed-panel-demo.ts
 * Safe to run repeatedly (idempotent).
 */

import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import {
  clinicDomains,
  clinicMemberships,
  clinics,
  dynamicColumns,
  dynamicModuleConfigs,
  dynamicRows,
  dynamicTables,
  shifts,
  users,
} from '../db/schema'
import { createDynamicRow } from '../db/repositories/dynamic-tables'
import { runWithTenantContext } from '../tenancy/context'
import { saveUserAccessOverride } from '../services/staff-invitations'
import { applyModuleStarterPack } from '../services/dynamic-finance-stock'

function isoDateOffset(daysOffset: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + daysOffset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function mondayOfCurrentWeek(): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  const diff = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - diff)
  return d
}

function formatIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function resolveTargetClinicId(): Promise<string> {
  const [localDomain] = await db
    .select({ clinicId: clinicDomains.clinicId })
    .from(clinicDomains)
    .where(eq(clinicDomains.hostname, 'localhost'))
    .limit(1)
  if (localDomain?.clinicId) return localDomain.clinicId

  const [first] = await db
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.isActive, true))
    .limit(1)
  if (!first?.id) throw new Error('Aktif işletme bulunamadı')
  return first.id
}

async function seedStaffAndShifts(clinicId: string) {
  // Eski dağınık test kayıtlarını (FK bozmadan) aktif üyelikten çıkar
  const messyEmails = [
    'sadsad@kilinik.com',
    'incecamberat@gmail.com',
    'smndrmz66@gmail.com',
    'hekim@test.com',
    'resepsiyon@klinik.com',
  ]
  for (const email of messyEmails) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
    if (u) {
      await db
        .update(clinicMemberships)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(clinicMemberships.clinicId, clinicId), eq(clinicMemberships.userId, u.id)))
    }
  }

  const defaultPassHash = await Bun.password.hash('Personel123!')

  const staffSpecs = [
    {
      email: 'admin@klinik.com',
      name: 'Berat İnce',
      role: 'yonetici',
      specialty: 'Kurucu & Yönetici',
      phone: '0532 410 20 30',
      color: '#2563eb',
      weekdays: [0, 1, 2, 3, 4],
      startTime: '09:00',
      endTime: '18:00',
      showOnCalendar: false,
      allowedTabs: ['calendar', 'patients', 'knowledge', 'stok', 'klinik', 'payments'],
      lastLoginDaysAgo: 0,
    },
    {
      email: 'selin.kaya@onlineemlaktan.com',
      name: 'Selin Kaya',
      role: 'hekim',
      specialty: 'Kıdemli Portföy Danışmanı',
      phone: '0533 612 44 18',
      color: '#0284c7',
      weekdays: [0, 1, 2, 3, 4],
      startTime: '09:00',
      endTime: '18:00',
      showOnCalendar: true,
      allowedTabs: ['calendar', 'patients', 'knowledge'],
      lastLoginDaysAgo: 0,
    },
    {
      email: 'emre.demir@onlineemlaktan.com',
      name: 'Emre Demir',
      role: 'calisan',
      specialty: 'Saha & Kiralama Danışmanı',
      phone: '0535 784 22 90',
      color: '#10b981',
      weekdays: [0, 1, 2, 3, 4, 5],
      startTime: '09:30',
      endTime: '18:30',
      showOnCalendar: true,
      allowedTabs: ['calendar', 'patients'],
      lastLoginDaysAgo: 1,
    },
    {
      email: 'zeynep.arslan@onlineemlaktan.com',
      name: 'Zeynep Arslan',
      role: 'sekreter',
      specialty: 'Ofis Koordinatörü',
      phone: '0530 495 11 04',
      color: '#8b5cf6',
      weekdays: [0, 1, 2, 3, 4],
      startTime: '08:30',
      endTime: '17:30',
      showOnCalendar: false,
      allowedTabs: ['calendar', 'patients', 'payments', 'stok', 'klinik'],
      lastLoginDaysAgo: 0,
    },
    {
      email: 'murat.yilmaz@onlineemlaktan.com',
      name: 'Murat Yılmaz',
      role: 'asistan',
      specialty: 'Ekspertiz & Destek Uzmanı',
      phone: '0542 331 67 82',
      color: '#f59e0b',
      weekdays: [1, 2, 3, 4, 5],
      startTime: '10:00',
      endTime: '19:00',
      showOnCalendar: true,
      allowedTabs: ['calendar', 'patients', 'stok'],
      lastLoginDaysAgo: 2,
    },
  ]

  const monday = mondayOfCurrentWeek()
  let createdShifts = 0

  for (const spec of staffSpecs) {
    const lastLoginAt = new Date(Date.now() - spec.lastLoginDaysAgo * 24 * 60 * 60 * 1000)
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, spec.email))
      .limit(1)

    let userId: string
    if (existing) {
      userId = existing.id
      await db
        .update(users)
        .set({
          name: spec.name,
          role: spec.role,
          specialty: spec.specialty,
          phone: spec.phone,
          color: spec.color,
          active: true,
          lastLoginAt: existing.lastLoginAt ?? lastLoginAt,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
    } else {
      const [inserted] = await db
        .insert(users)
        .values({
          email: spec.email,
          passwordHash: defaultPassHash,
          name: spec.name,
          role: spec.role,
          specialty: spec.specialty,
          phone: spec.phone,
          color: spec.color,
          active: true,
          lastLoginAt,
        })
        .returning({ id: users.id })
      userId = inserted!.id
    }

    await db
      .insert(clinicMemberships)
      .values({
        clinicId,
        userId,
        role: spec.role,
        active: true,
      })
      .onConflictDoUpdate({
        target: [clinicMemberships.clinicId, clinicMemberships.userId],
        set: { role: spec.role, active: true, updatedAt: new Date() },
      })

    if (spec.role !== 'yonetici') {
      await saveUserAccessOverride(
        clinicId,
        userId,
        {
          allowedTabs: spec.allowedTabs,
          staffPermissions: {
            viewShiftPlanner: true,
            editShifts: spec.role === 'sekreter',
            manageLeaves: spec.role === 'sekreter',
            editClinicWorkingHours: false,
            manageStaff: false,
            manageDynamicTables: spec.role === 'sekreter',
            showOnCalendar: spec.showOnCalendar,
          },
        },
        spec.role,
      )
    }

    // Önceki hafta, bu hafta ve gelecek hafta için mesailer (idempotent)
    for (let weekOffset = -1; weekOffset <= 1; weekOffset++) {
      for (const wd of spec.weekdays) {
        const d = new Date(monday)
        d.setDate(d.getDate() + weekOffset * 7 + wd)
        const dateStr = formatIso(d)
        const existingShift = await db
          .select({ id: shifts.id })
          .from(shifts)
          .where(and(eq(shifts.clinicId, clinicId), eq(shifts.userId, userId), eq(shifts.date, dateStr)))
          .limit(1)
        if (existingShift.length === 0) {
          await db.insert(shifts).values({
            clinicId,
            userId,
            date: dateStr,
            startTime: spec.startTime,
            endTime: spec.endTime,
            shiftType: 'Mesai',
          })
          createdShifts += 1
        }
      }
    }
  }

  console.log(`[Seed] Personel & Mesai hazır (${staffSpecs.length} personel, ${createdShifts} yeni mesai kaydı)`)
}

function pickOptionId(
  col: { config: unknown } | undefined,
  preferredIds: string[],
  fallbackLabelMatch?: RegExp,
): string | null {
  const options = ((col?.config as { options?: Array<{ id: string; label: string }> } | null)?.options || [])
  if (options.length === 0) return preferredIds[0] ?? null
  for (const pid of preferredIds) {
    const found = options.find((o) => o.id === pid)
    if (found) return found.id
  }
  if (fallbackLabelMatch) {
    const matched = options.find((o) => fallbackLabelMatch.test(o.label))
    if (matched) return matched.id
  }
  return options[0]?.id ?? null
}

async function seedStockAndMaintenance(clinicId: string) {
  await runWithTenantContext({ clinicId, hostname: 'localhost' }, async () => {
    let modConfigs = await db
      .select()
      .from(dynamicModuleConfigs)
      .where(eq(dynamicModuleConfigs.clinicId, clinicId))

    if (!modConfigs.some((m) => m.moduleRole === 'stock_inventory' && m.enabled)) {
      await applyModuleStarterPack('general_stock')
      modConfigs = await db
        .select()
        .from(dynamicModuleConfigs)
        .where(eq(dynamicModuleConfigs.clinicId, clinicId))
    }

    const invMod = modConfigs.find((m) => m.moduleRole === 'stock_inventory' && m.enabled)
    const maintMod = modConfigs.find((m) => m.moduleRole === 'asset_maintenance' && m.enabled)
    const movMod = modConfigs.find((m) => m.moduleRole === 'stock_movement' && m.enabled)

    const findTableMeta = async (tableId: string) => {
      const [tbl] = await db.select().from(dynamicTables).where(eq(dynamicTables.id, tableId)).limit(1)
      const cols = await db.select().from(dynamicColumns).where(eq(dynamicColumns.tableId, tableId))
      const rows = await db
        .select()
        .from(dynamicRows)
        .where(and(eq(dynamicRows.tableId, tableId), eq(dynamicRows.isArchived, false)))
      return { tbl, cols, rows }
    }

    const rowIdByTitle = new Map<string, string>()

    // 1. Stok & Envanter seed kalemleri (Normal, Kritik, SKT ≤30g, SKT Geçmiş)
    if (invMod) {
      const { cols, rows } = await findTableMeta(invMod.tableId)
      const mapping = (invMod.mapping || {}) as Record<string, string | null | undefined>
      const primaryCol = cols.find((c) => c.isPrimaryTitle) ?? cols.find((c) => c.fieldType === 'text')
      const colById = new Map(cols.map((c) => [c.id, c]))

      for (const r of rows) rowIdByTitle.set(r.displayTitle.trim().toLowerCase(), r.id)

      const stockSamples = [
        {
          name: 'Şifreli Portföy Anahtar Kasası',
          categoryIds: ['anahtar_kilit', 'ana_urun'],
          unitIds: ['adet'],
          qty: 12,
          minThreshold: 4,
          unitCost: 650,
          expiryDate: null as string | null,
          notes: 'Boş daire gösterimleri için normal stok örneği',
        },
        {
          name: 'Balkon Tipi Satılık Brandası (100x70)',
          categoryIds: ['afis_branda', 'sarf'],
          unitIds: ['adet'],
          qty: 4,
          minThreshold: 6,
          unitCost: 320,
          expiryDate: null as string | null,
          notes: 'Kritik stok uyarısı örneği — yeni baskı siparişi verilecek',
        },
        {
          name: 'Lazer Mesafe Ölçer Pili (CR2)',
          categoryIds: ['ofis_ekipman', 'sarf', 'anahtar_kilit'],
          unitIds: ['paket', 'adet'],
          qty: 3,
          minThreshold: 5,
          unitCost: 190,
          expiryDate: isoDateOffset(14),
          notes: 'Hem kritik stok hem yaklaşan SKT (≤30g) örneği',
        },
        {
          name: 'Ofis İkram Kahve Kapsül Seti',
          categoryIds: ['sarf', 'tanitim'],
          unitIds: ['kutu', 'paket'],
          qty: 8,
          minThreshold: 3,
          unitCost: 420,
          expiryDate: isoDateOffset(18),
          notes: 'Müşteri ikram stoğu — SKT 30 gün içinde doluyor',
        },
        {
          name: 'İlk Yardım Çantası Yedek Kiti',
          categoryIds: ['sarf', 'ofis_ekipman'],
          unitIds: ['set', 'adet'],
          qty: 2,
          minThreshold: 2,
          unitCost: 550,
          expiryDate: isoDateOffset(-5),
          notes: 'SKT geçmiş kayıt uyarısı örneği — yenilenmeli',
        },
      ]

      let addedStock = 0
      for (const item of stockSamples) {
        const key = item.name.trim().toLowerCase()
        if (rowIdByTitle.has(key)) continue
        const values: Record<string, unknown> = {}
        if (primaryCol) values[primaryCol.id] = item.name
        if (mapping.categoryColumnId) {
          values[mapping.categoryColumnId] = pickOptionId(colById.get(mapping.categoryColumnId), item.categoryIds)
        }
        if (mapping.unitColumnId) {
          values[mapping.unitColumnId] = pickOptionId(colById.get(mapping.unitColumnId), item.unitIds)
        }
        if (mapping.quantityColumnId) values[mapping.quantityColumnId] = item.qty
        if (mapping.minThresholdColumnId) values[mapping.minThresholdColumnId] = item.minThreshold
        if (mapping.unitCostColumnId) values[mapping.unitCostColumnId] = item.unitCost
        if (mapping.expiryDateColumnId && item.expiryDate) values[mapping.expiryDateColumnId] = item.expiryDate
        if (mapping.notesColumnId) values[mapping.notesColumnId] = item.notes

        const created = await createDynamicRow(invMod.tableId, { values })
        rowIdByTitle.set(key, created.id)
        addedStock += 1
      }
      console.log(`[Seed] Stok kalemleri kontrol edildi (${addedStock} yeni örnek kalem eklendi)`)
    }

    // 2. Periyodik Bakım seed kayıtları (Yaklaşan, Geciken, Planlı, Tamamlanan)
    if (maintMod) {
      const { cols, rows } = await findTableMeta(maintMod.tableId)
      const mapping = (maintMod.mapping || {}) as Record<string, string | null | undefined>
      const primaryCol = cols.find((c) => c.isPrimaryTitle) ?? cols.find((c) => c.fieldType === 'text')
      const colById = new Map(cols.map((c) => [c.id, c]))
      const existingTitles = new Set(rows.map((r) => r.displayTitle.trim().toLowerCase()))

      const maintSamples = [
        {
          name: 'Ofis Klima & Havalandırma Filtre Bakımı',
          typeIds: ['periyodik_bakim', 'ofis_bakim'],
          isPeriodic: true,
          periodicDays: 90,
          scheduledDate: isoDateOffset(-3),
          nextDate: isoDateOffset(-3),
          cost: 1650,
          statusIds: ['gecikti', 'planlandi'],
          notes: 'Gecikmiş bakım uyarısı örneği — teknik servis aranacak',
        },
        {
          name: 'Renkli Lazer Yazıcı & Tarayıcı Kalibrasyonu',
          typeIds: ['kalibrasyon', 'periyodik_bakim'],
          isPeriodic: true,
          periodicDays: 120,
          scheduledDate: isoDateOffset(42),
          nextDate: isoDateOffset(42),
          cost: 1200,
          statusIds: ['planlandi'],
          notes: 'Sözleşme baskı kalitesi için düzenli toner & tambur bakımı',
        },
      ]

      let addedMaint = 0
      for (const m of maintSamples) {
        if (existingTitles.has(m.name.trim().toLowerCase())) continue
        const values: Record<string, unknown> = {}
        if (primaryCol) values[primaryCol.id] = m.name
        if (mapping.categoryColumnId) {
          values[mapping.categoryColumnId] = pickOptionId(colById.get(mapping.categoryColumnId), m.typeIds)
        }
        if (mapping.isPeriodicColumnId) values[mapping.isPeriodicColumnId] = m.isPeriodic
        if (mapping.periodicDaysColumnId) values[mapping.periodicDaysColumnId] = m.periodicDays
        if (mapping.scheduledDateColumnId) values[mapping.scheduledDateColumnId] = m.scheduledDate
        if (mapping.nextDateColumnId) values[mapping.nextDateColumnId] = m.nextDate
        if (mapping.amountColumnId) values[mapping.amountColumnId] = m.cost
        if (mapping.statusColumnId) {
          values[mapping.statusColumnId] = pickOptionId(colById.get(mapping.statusColumnId), m.statusIds)
        }
        if (mapping.notesColumnId) values[mapping.notesColumnId] = m.notes

        await createDynamicRow(maintMod.tableId, { values })
        addedMaint += 1
      }
      console.log(`[Seed] Periyodik bakım kayıtları kontrol edildi (${addedMaint} yeni örnek kayıt eklendi)`)
    }

    // 3. Stok & Bakım Hareket Geçmişi seed kayıtları (Alım, Kullanım, Fire, Bakım)
    if (movMod) {
      const { cols, rows } = await findTableMeta(movMod.tableId)
      const mapping = (movMod.mapping || {}) as Record<string, string | null | undefined>
      const primaryCol = cols.find((c) => c.isPrimaryTitle) ?? cols.find((c) => c.fieldType === 'text')
      const colById = new Map(cols.map((c) => [c.id, c]))
      const existingTitles = new Set(rows.map((r) => r.displayTitle.trim().toLowerCase()))

      const movementSamples = [
        {
          title: 'Alım — Şifreli Portföy Anahtar Kasası',
          itemName: 'Şifreli Portföy Anahtar Kasası',
          typeId: 'giris',
          qty: 10,
          unitCost: 650,
          totalAmount: 6500,
          date: isoDateOffset(-6),
          actor: 'Berat İnce',
          notes: 'Yeni portföy açılışları için toplu tedarik',
        },
        {
          title: 'Kullanım — Balkon Tipi Satılık Brandası (100x70)',
          itemName: 'Balkon Tipi Satılık Brandası (100x70)',
          typeId: 'cikis',
          qty: 3,
          unitCost: 320,
          totalAmount: 960,
          date: isoDateOffset(-4),
          actor: 'Emre Demir',
          notes: 'Çankaya yeni portföy dairelerine asıldı',
        },
        {
          title: 'Alım — Ofis İkram Kahve Kapsül Seti',
          itemName: 'Ofis İkram Kahve Kapsül Seti',
          typeId: 'giris',
          qty: 8,
          unitCost: 420,
          totalAmount: 3360,
          date: isoDateOffset(-3),
          actor: 'Zeynep Arslan',
          notes: 'Aylık ofis ikram alımı',
        },
        {
          title: 'Fire / Zayi — Kurumsal Portföy Sunum Dosyası',
          itemName: 'Kurumsal Portföy Sunum Dosyası',
          typeId: 'fire',
          qty: 2,
          unitCost: 240,
          totalAmount: 480,
          date: isoDateOffset(-2),
          actor: 'Selin Kaya',
          notes: 'Yağmurda hasar gören saha dosyaları',
        },
        {
          title: 'Periyodik Bakım — DJI Çekim Drone Batarya & Sensör Kontrolü',
          itemName: '',
          typeId: 'bakim',
          qty: 1,
          unitCost: 1800,
          totalAmount: 1800,
          date: isoDateOffset(-1),
          actor: 'Murat Yılmaz',
          notes: 'Pervane ve kalibrasyon yenilemesi tamamlandı',
        },
      ]

      let addedMov = 0
      for (const mv of movementSamples) {
        if (existingTitles.has(mv.title.trim().toLowerCase())) continue
        const values: Record<string, unknown> = {}
        if (primaryCol) values[primaryCol.id] = mv.title
        if (mapping.movementTypeColumnId) {
          values[mapping.movementTypeColumnId] = pickOptionId(
            colById.get(mapping.movementTypeColumnId),
            [mv.typeId],
          )
        }
        if (mapping.quantityColumnId) values[mapping.quantityColumnId] = mv.qty
        if (mapping.unitCostColumnId) values[mapping.unitCostColumnId] = mv.unitCost
        if (mapping.amountColumnId) values[mapping.amountColumnId] = mv.totalAmount
        if (mapping.dateColumnId) values[mapping.dateColumnId] = mv.date
        if (mapping.actorColumnId) values[mapping.actorColumnId] = mv.actor
        if (mapping.notesColumnId) values[mapping.notesColumnId] = mv.notes
        if (mapping.itemRelationColumnId && mv.itemName) {
          const itemId = rowIdByTitle.get(mv.itemName.trim().toLowerCase())
          if (itemId) values[mapping.itemRelationColumnId] = [itemId]
        }

        await createDynamicRow(movMod.tableId, { values })
        addedMov += 1
      }
      console.log(`[Seed] Stok hareket geçmişi kontrol edildi (${addedMov} yeni örnek hareket eklendi)`)
    }
  })
}

async function main() {
  const clinicId = await resolveTargetClinicId()
  console.log(`[Seed] Hedef işletme: ${clinicId}`)
  await seedStaffAndShifts(clinicId)
  await seedStockAndMaintenance(clinicId)
  console.log('[Seed] Panel demo seed tamamlandı.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[Seed] Hata:', err)
  process.exit(1)
})
