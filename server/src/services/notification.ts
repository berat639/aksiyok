import { db } from '../db/client'
import { clinicMemberships, notifications } from '../db/schema'
import { and, eq } from 'drizzle-orm'
import { requireClinicId } from '../tenancy/context'

export async function notify(userId: string, type: string, title: string, body?: string, link?: string) {
  const clinicId = requireClinicId()
  const [n] = await db.insert(notifications).values({ clinicId, userId, type, title, body, link }).returning()
  return n
}

export async function notifyRole(role: string, type: string, title: string, body?: string, link?: string) {
  const roleUsers = await db.select({ id: clinicMemberships.userId }).from(clinicMemberships)
    .where(and(eq(clinicMemberships.clinicId, requireClinicId()), eq(clinicMemberships.role, role), eq(clinicMemberships.active, true)))
  for (const u of roleUsers) {
    await notify(u.id, type, title, body, link)
  }
}

// doctorId IS the userId now (hekim user.id = doctor)
export async function notifyDoctorUser(doctorId: string, type: string, title: string, body?: string, link?: string) {
  await notify(doctorId, type, title, body, link)
}
