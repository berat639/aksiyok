/**
 * Migration seed script — run once after database is initialized.
 * Seeds:
 *   1. Default Google Cloud account from .env
 *   2. Existing appointments from data/appointments.json
 *
 * Usage: bun run server/src/scripts/migrate-seed.ts
 * Safe to run multiple times (uses upsert/skip-if-exists logic)
 */

import postgres from 'postgres'
import { buildDefaultWebFlow } from '../db/repositories/flows'
import { syncClinicFlowsWithDynamicTables } from '../db/repositories/dynamic-tables'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL tanımlı değil')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { max: 1 })

async function getDefaultClinicId(): Promise<string> {
  const rows = await sql`SELECT id FROM clinics WHERE is_active = true ORDER BY created_at LIMIT 1`
  if (!rows[0]?.id) throw new Error('Seed için aktif işletme bulunamadı; önce migration çalıştırılmalı')
  return rows[0].id
}

async function seedSystemSettings() {
  const clinicId = await getDefaultClinicId()
  const settings = [
    { key: 'greeting_message', value: 'Merhaba, yapay zeka asistanınızım. Size nasıl yardımcı olabilirim?' },
    { key: 'greeting_message_outbound', value: 'Merhaba, ben işletme asistanıyım. Sizi arıyorum çünkü...' },
    { key: 'outbound_caller_id', value: '08503096119' },
  ]
  for (const s of settings) {
    await sql`
      INSERT INTO clinic_settings (clinic_id, key, value, updated_at)
      VALUES (${clinicId}, ${s.key}, ${s.value}, ${new Date().toISOString()})
      ON CONFLICT (clinic_id, key) DO NOTHING
    `
  }
  console.log('[Seed] Sistem ayarları eklendi')
}

async function seedDefaultFlows() {
  const clinicId = await getDefaultClinicId()
  const existingInbound = await sql`SELECT 1 FROM conversation_flows WHERE clinic_id = ${clinicId} AND direction = 'inbound' LIMIT 1`
  if (existingInbound.length === 0) {
    const inboundNodes = [
      { id: 'start', type: 'START', position: { x: 400, y: 0 }, data: { label: 'Karşılama' } },
      { id: 'end', type: 'END', position: { x: 400, y: 200 }, data: { label: 'Son' } }
    ]
    await sql`
      INSERT INTO conversation_flows (clinic_id, name, direction, is_active, nodes, edges)
      VALUES (${clinicId}, 'Varsayılan Gelen Arama Akışı', 'inbound', true, ${JSON.stringify(inboundNodes)}, '[]')
    `
    console.log('[Seed] Gelen arama akışı eklendi')
  }

  const existingOutbound = await sql`SELECT 1 FROM conversation_flows WHERE clinic_id = ${clinicId} AND direction = 'outbound' LIMIT 1`
  if (existingOutbound.length === 0) {
    const outboundNodes = [
      { id: 'start', type: 'START', position: { x: 400, y: 0 }, data: { label: 'Arama Başladı' } },
      { id: 'anket_q1', type: 'FIELD', position: { x: 400, y: 150 }, data: { fieldName: 'memnuniyet', description: 'Hizmetimizden memnun kaldınız mı? (Evet/Hayır)', required: true, fieldType: 'text' } },
      { id: 'anket_q2', type: 'FIELD', position: { x: 400, y: 300 }, data: { fieldName: 'puan', description: 'Bize 1 ile 10 arasında kaç puan verirsiniz?', required: false, fieldType: 'number' } },
      { id: 'action', type: 'ACTION', position: { x: 400, y: 450 }, data: { action: 'notBirak' } },
      { id: 'end', type: 'END', position: { x: 400, y: 600 }, data: { label: 'Görüşmeyi Sonlandır' } }
    ]
    const outboundEdges = [
      { id: 'e1', source: 'start', target: 'anket_q1' },
      { id: 'e2', source: 'anket_q1', target: 'anket_q2' },
      { id: 'e3', source: 'anket_q2', target: 'action' },
      { id: 'e4', source: 'action', target: 'end' }
    ]
    await sql`
      INSERT INTO conversation_flows (clinic_id, name, direction, is_active, nodes, edges)
      VALUES (${clinicId}, 'Anket Akışı (Giden Arama)', 'outbound', true, ${JSON.stringify(outboundNodes)}, ${JSON.stringify(outboundEdges)})
    `
    console.log('[Seed] Anket Akışı (Giden) eklendi')
  }

  const existingWeb = await sql`SELECT 1 FROM conversation_flows WHERE clinic_id = ${clinicId} AND direction = 'web' LIMIT 1`
  if (existingWeb.length === 0) {
    const defaultWeb = buildDefaultWebFlow()
    await sql`
      INSERT INTO conversation_flows (clinic_id, name, direction, is_active, nodes, edges)
      VALUES (${clinicId}, ${defaultWeb.name}, 'web', true, ${JSON.stringify(defaultWeb.nodes)}, ${JSON.stringify(defaultWeb.edges)})
    `
    console.log('[Seed] Web Sesli Asistan akışı eklendi')
  }
}

async function main() {
  console.log('[Seed] Başlıyor...')
  try {
    await seedSystemSettings()
    await seedDefaultFlows()
    const clinicId = await getDefaultClinicId()
    await syncClinicFlowsWithDynamicTables(clinicId, { forceRebuild: false })
    console.log('[Seed] Tamamlandı')
  } catch (err) {
    console.error('[Seed] Hata:', err)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

main()
