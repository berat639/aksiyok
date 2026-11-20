import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../client'
import { clinics, knowledgeDocuments } from '../schema'
import { runWithTenantContext } from '../../tenancy/context'
import { createDoc, searchByText } from './knowledge'

const hasDatabase = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDatabase)('Knowledge Base cross-channel availability (PostgreSQL)', () => {
  test('tüm bilgi tabanı belgeleri (eski inbound/outbound dahil) gelen, giden, web ve WhatsApp kanallarında ortak döner', async () => {
    const [clinic] = await db
      .insert(clinics)
      .values({ name: `KB Cross Channel Test ${Date.now()}` })
      .returning()

    try {
      await runWithTenantContext(
        { clinicId: clinic.id, hostname: 'kb-cross-channel.local', isActive: true },
        async () => {
          const token = `ortakkanal${Date.now()}`
          await createDoc(
            {
              category: 'genel',
              title: `Genel Kampanya ${token}`,
              content: `Bu kampanya ${token} tüm kanallar için geçerlidir.`,
              callDirection: 'both',
              active: true,
            },
            [],
          )
          await createDoc(
            {
              category: 'genel',
              title: `Eski Gelen Belge ${token}`,
              content: `Eski gelen arama belgesi ${token} artık her kanalda görünmeli.`,
              callDirection: 'inbound',
              active: true,
            },
            [],
          )
          await createDoc(
            {
              category: 'genel',
              title: `Eski Giden Belge ${token}`,
              content: `Eski giden arama belgesi ${token} artık her kanalda görünmeli.`,
              callDirection: 'outbound',
              active: true,
            },
            [],
          )

          for (const dir of ['inbound', 'outbound', 'web', 'whatsapp', 'all']) {
            const results = await searchByText(token, 10, dir)
            const titles = results.map((r) => r.title)
            expect(titles).toContain(`Genel Kampanya ${token}`)
            expect(titles).toContain(`Eski Gelen Belge ${token}`)
            expect(titles).toContain(`Eski Giden Belge ${token}`)
          }
        },
      )
    } finally {
      await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.clinicId, clinic.id))
      await db.delete(clinics).where(eq(clinics.id, clinic.id))
    }
  })
})
