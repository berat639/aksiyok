import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { clinics, conversationFlows, flowAiMessages } from '../db/schema'
import { createDynamicTable } from '../db/repositories/dynamic-tables'
import { getActiveFlow } from '../db/repositories/flows'
import {
  clearFlowAiMessages,
  listFlowAiMessages,
  revertFlowAiTurn,
} from '../db/repositories/flow-ai-chat'
import { runWithTenantContext } from '../tenancy/context'
import {
  runFlowBuilderChatTurn,
  sanitizeAndLayoutGeneratedFlow,
  sanitizeTurkishFlowText,
} from './flow-builder-ai'

const hasDatabase = Boolean(process.env.DATABASE_URL)

describe('flow-builder-ai saf doğrulama ve kanal kuralları', () => {
  test('teknik değişken ve operatör adlarını doğal Türkçeye temizler', () => {
    const cleaned = sanitizeTurkishFlowText(
      'Eğer `caller.isVip` == true ise `save_appointment_pending` yerine `transfer_call` çalışır.',
    )
    expect(cleaned).not.toContain('caller.isVip')
    expect(cleaned).not.toContain('save_appointment_pending')
    expect(cleaned).not.toContain('transfer_call')
    expect(cleaned).not.toContain('==')
    expect(cleaned).toContain('özel hat durumu')
    expect(cleaned).toContain('randevu talebi oluşturma')
    expect(cleaned).toContain('yetkiliye aktarma')
  })

  test('eksik koşul kollarını otomatik bağlar ve WhatsApp kanalında telefon aksiyonlarını dönüştürür', () => {
    const res = sanitizeAndLayoutGeneratedFlow({
      direction: 'whatsapp',
      rawNodes: [
        { id: 'start', type: 'START', label: 'Hoş Geldiniz' },
        {
          id: 'cond_fiyat',
          type: 'CONDITION',
          label: 'Fiyat soruyor mu?',
          conditionField: 'user_intent',
          operator: 'intent',
          conditionValue: 'Fiyat bilgisi istiyor',
        },
        {
          id: 'act_transfer',
          type: 'ACTION',
          label: 'Yetkiliye Aktar',
          action: 'transfer_call',
        },
        {
          id: 'act_end',
          type: 'ACTION',
          label: 'Görüşmeyi Bitir',
          action: 'end_call',
          message: 'İyi günler dileriz.',
        },
      ],
      rawEdges: [
        { source: 'start', target: 'cond_fiyat' },
        { source: 'cond_fiyat', target: 'act_transfer', sourceHandle: 'true' },
        // false kolu bilerek eksik bırakıldı; sanitizer tamamlamalı
      ],
    })

    expect(res.issues.filter(i => i.level === 'error')).toEqual([])
    const transferNode = res.nodes.find(n => n.id === 'act_transfer')
    expect(transferNode?.type).toBe('ACTION')
    expect(transferNode?.data.action).toBe('save_patient_note')

    const endConverted = res.nodes.find(n => n.id === 'act_end')
    expect(endConverted?.type).toBe('END')
    expect(endConverted?.data.message).toBe('İyi günler dileriz.')

    const condTrueEdges = res.edges.filter(e => e.source === 'cond_fiyat' && e.sourceHandle === 'true')
    const condFalseEdges = res.edges.filter(e => e.source === 'cond_fiyat' && e.sourceHandle === 'false')
    expect(condTrueEdges.length).toBe(1)
    expect(condFalseEdges.length).toBe(1)
  })
})

describe.skipIf(!hasDatabase)('flow-builder-ai kanal bazlı sohbet ve akış izolasyonu (PostgreSQL)', () => {
  let clinicId = ''
  let portfolioTableId = ''
  let priceColId = ''

  beforeAll(async () => {
    const slug = `flow-ai-test-${Date.now()}`
    const [created] = await db
      .insert(clinics)
      .values({
        name: `Flow Chat Test İşletmesi ${Date.now()}`,
        businessTemplate: 'general',
        isActive: true,
      })
      .returning({ id: clinics.id })
    clinicId = created.id

    await runWithTenantContext(
      { clinicId, hostname: `${slug}.axamaz.com`, isActive: true, businessTemplate: 'general' },
      async () => {
        const tbl = await createDynamicTable({
          name: 'Portföy İlanları',
          initialColumns: [
            { name: 'İlan Başlığı', fieldType: 'text', isPrimaryTitle: true, isRequired: true },
            { name: 'Bütçe', fieldType: 'currency', isRequired: true },
          ],
        })
        portfolioTableId = tbl.id
        const budgetCol = tbl.columns.find(c => c.name === 'Bütçe')
        priceColId = budgetCol?.id || ''
      },
    )
  })

  afterAll(async () => {
    if (!clinicId) return
    await db.delete(flowAiMessages).where(eq(flowAiMessages.clinicId, clinicId)).catch(() => {})
    await db.delete(conversationFlows).where(eq(conversationFlows.clinicId, clinicId)).catch(() => {})
    await db.delete(clinics).where(eq(clinics.id, clinicId)).catch(() => {})
  })

  test('her asistan kanalı (inbound / whatsapp / web / outbound) ayrı akış ve sohbet geçmişi tutar', async () => {
    await runWithTenantContext(
      { clinicId, hostname: 'flow-ai.axamaz.com', isActive: true, businessTemplate: 'general' },
      async () => {
        // 1. Gelen Arama (inbound) için akış kur
        const inboundTurn = await runFlowBuilderChatTurn(
          {
            clinicId,
            direction: 'inbound',
            message: 'Arayanın bütçe bilgisini sor, tarih saat alıp randevu talebi oluştur.',
          },
          {
            generatePlan: async ({ promptText }) => {
              expect(promptText).toContain('Portföy İlanları')
              expect(promptText).toContain('KANAL: Telefon (Santral) Gelen Arama')
              return {
                reply: 'Gelen arama asistanı için bütçe sorusu ve randevu adımlarını hazırladım.',
                shouldUpdateFlow: true,
                changeSummary: 'Bütçe ve randevu akışı kuruldu',
                nodes: [
                  { id: 'start', type: 'START', label: 'Telefon Karşılama' },
                  {
                    id: 'ask_budget',
                    type: 'FIELD',
                    label: 'Bütçe Bilgisi',
                    sourceTableId: portfolioTableId,
                    sourceColumnId: priceColId,
                    description: 'Ortalama bütçenizi öğrenebilir miyim?',
                  },
                  {
                    id: 'ask_date',
                    type: 'FIELD',
                    label: 'Randevu Tarihi',
                    sourceTableId: '__appointment_calendar__',
                    sourceColumnId: '__appt_date__',
                  },
                  {
                    id: 'act_book',
                    type: 'ACTION',
                    label: 'Randevu Talebi Oluştur',
                    action: 'save_appointment_pending',
                  },
                  { id: 'end', type: 'END', label: 'Telefon Görüşmesini Bitir' },
                ],
                edges: [
                  { source: 'start', target: 'ask_budget' },
                  { source: 'ask_budget', target: 'ask_date' },
                  { source: 'ask_date', target: 'act_book' },
                  { source: 'act_book', target: 'end' },
                ],
              }
            },
          },
        )

        expect(inboundTurn.direction).toBe('inbound')
        expect(inboundTurn.appliedFlow).toBe(true)
        expect(inboundTurn.flow?.nodes.some(n => n.data.sourceColumnId === priceColId)).toBe(true)
        expect(inboundTurn.flow?.nodes.some(n => n.data.fieldName === 'tarih')).toBe(true)

        // 2. WhatsApp kanalı için tamamen farklı bir akış kur
        const waTurn = await runFlowBuilderChatTurn(
          {
            clinicId,
            direction: 'whatsapp',
            message: 'WhatsApp mesajlarına otomatik karşılama yanıtı yazsın.',
          },
          {
            generatePlan: async ({ promptText }) => {
              expect(promptText).toContain('KANAL: WhatsApp Mesaj Asistanı')
              expect(promptText).not.toContain('Gelen arama asistanı için bütçe sorusu')
              return {
                reply: 'WhatsApp asistanı için özel yazılı yanıt akışını oluşturdum.',
                shouldUpdateFlow: true,
                changeSummary: 'WhatsApp karşılama akışı kuruldu',
                nodes: [
                  { id: 'start', type: 'START', label: 'WhatsApp Karşılama' },
                  {
                    id: 'wa_reply',
                    type: 'ACTION',
                    label: 'WhatsApp Yanıtı',
                    action: 'send_wa_message',
                    message: 'Merhaba, nasıl yardımcı olabiliriz?',
                  },
                  { id: 'end', type: 'END', label: 'Yanıtı Tamamla' },
                ],
                edges: [
                  { source: 'start', target: 'wa_reply' },
                  { source: 'wa_reply', target: 'end' },
                ],
              }
            },
          },
        )

        expect(waTurn.direction).toBe('whatsapp')
        expect(waTurn.appliedFlow).toBe(true)

        // Her asistanın sohbet geçmişi tamamen ayrı kalmalı
        const [inboundMsgs, waMsgs, webMsgs] = await Promise.all([
          listFlowAiMessages('inbound', clinicId),
          listFlowAiMessages('whatsapp', clinicId),
          listFlowAiMessages('web', clinicId),
        ])
        expect(inboundMsgs.length).toBe(2)
        expect(waMsgs.length).toBe(2)
        expect(webMsgs.length).toBe(0)
        expect(inboundMsgs[1].content).toContain('Gelen arama asistanı')
        expect(waMsgs[1].content).toContain('WhatsApp asistanı')

        // Akışlar da birbirini ezmemeli
        const activeInbound = await getActiveFlow('inbound', clinicId, { skipAutoSync: true })
        const activeWa = await getActiveFlow('whatsapp', clinicId, { skipAutoSync: true })
        expect(activeInbound?.nodes.some(n => n.id === 'ask_budget')).toBe(true)
        expect(activeWa?.nodes.some(n => n.id === 'wa_reply')).toBe(true)
        expect(activeWa?.nodes.some(n => n.id === 'ask_budget')).toBe(false)

        // 3. WhatsApp sohbetini temizlemek Gelen Arama sohbetini etkilememeli
        await clearFlowAiMessages('whatsapp', clinicId)
        expect((await listFlowAiMessages('whatsapp', clinicId)).length).toBe(0)
        expect((await listFlowAiMessages('inbound', clinicId)).length).toBe(2)

        // 4. Gelen Arama son AI değişikliğini geri alınca önceki grafik dönmeli
        const lastInboundAssistant = inboundMsgs[1]
        const reverted = await revertFlowAiTurn({
          messageId: lastInboundAssistant.id,
          direction: 'inbound',
          explicitClinicId: clinicId,
        })
        expect(reverted.flow.nodes.some(n => n.id === 'ask_budget')).toBe(false)

        // 5. Danışma sorusunda (shouldUpdateFlow=false) mevcut web akışı korunmalı, sohbet geçmişi birikmeli
        const advisoryTurn = await runFlowBuilderChatTurn(
          {
            clinicId,
            direction: 'web',
            message: 'Web asistanında neleri sormamızı önerirsin?',
          },
          {
            generatePlan: async () => ({
              reply: 'Ziyaretçiden ad soyad, telefon ve tarih bilgisini kısaca isteyebiliriz.',
              shouldUpdateFlow: false,
            }),
          },
        )
        expect(advisoryTurn.appliedFlow).toBe(false)
        expect(advisoryTurn.flow).toBeNull()
        expect(advisoryTurn.messages.length).toBe(2)

        const followupTurn = await runFlowBuilderChatTurn(
          {
            clinicId,
            direction: 'web',
            message: 'Tamam bunları ekle',
          },
          {
            generatePlan: async ({ promptText }) => {
              // Önceki web sohbet geçmişi LLM'e gitmeli
              expect(promptText).toContain('Ziyaretçiden ad soyad, telefon ve tarih bilgisini kısaca isteyebiliriz.')
              return {
                reply: 'Önerdiğimiz adımları web asistanına ekledim.',
                shouldUpdateFlow: true,
                changeSummary: 'Web asistanı bilgi ve randevu akışı kuruldu',
                nodes: [
                  { id: 'start', type: 'START', label: 'Web Karşılama' },
                  { id: 'ask_name', type: 'FIELD', label: 'Ad Soyad', fieldName: 'ad_soyad', fieldType: 'text' },
                  { id: 'end', type: 'END', label: 'Tamamla' },
                ],
                edges: [
                  { source: 'start', target: 'ask_name' },
                  { source: 'ask_name', target: 'end' },
                ],
              }
            },
          },
        )
        expect(followupTurn.appliedFlow).toBe(true)
        expect(followupTurn.messages.length).toBe(4)
      },
    )
  })
})
