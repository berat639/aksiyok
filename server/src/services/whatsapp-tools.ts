import { and, desc, eq, gte, lt, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { appointments, dentalAppointments, patients, patientNotes, whatsappConversations, whatsappToolExecutions } from '../db/schema'
import { patientPhoneMatches } from '../db/repositories/whatsapp'
import { last10Digits, normalizePhone } from '../integrations/whatsapp'
import { currentBusinessTemplate } from '../tenancy/context'
import { findUpcomingAppointmentByPhone } from './appointment-notifications'
import { searchKnowledge } from './knowledge'
import { appointmentTime, createAssistantAppointment, updateWhatsAppAppointment } from './assistant-appointments'

export interface WhatsAppToolContext {
  clinicId: string
  conversationId: string
  messageId: string
  phone: string | null
  flowEngine?: import('./flow-engine').FlowEngine | null
}
export const WHATSAPP_TOOL_NAMES = new Set([
  'akisBilgisiGuncelle',
  'veriTablosunaKaydet',
  'veriTablosuSorgula',
  'searchKnowledgeBase',
  'musteriSorgula',
  'gecmisRandevular',
  'randevuMusaitlikKontrol',
  'randevuOlustur',
  'randevuGuncelle',
  'randevuDurumBildir',
  'hastaNotKaydet',
  'musteriNotKaydet',
  'insanaAktar',
  'konuDisiSohbetDuraklat',
])

export async function executeWhatsAppTool(name: string, args: Record<string, unknown>, context: WhatsAppToolContext): Promise<Record<string, unknown>> {
  if (!WHATSAPP_TOOL_NAMES.has(name)) return { success: false, message: 'Bu araç WhatsApp kanalında kullanılamaz.' }
  try {
    if (name === 'akisBilgisiGuncelle') {
      if (!context.flowEngine) {
        return { success: false, message: 'Akışla çalışma bu görüşmede açık değil.' }
      }
      const rawFields = (args.bilgiler && typeof args.bilgiler === 'object')
        ? (args.bilgiler as Record<string, unknown>)
        : {}
      const flatFields = Object.fromEntries(
        Object.entries(args).filter(([k]) => k !== 'bilgiler' && k !== 'yeni_kisi'),
      )
      const step = await context.flowEngine.accept({
        fields: {
          ...(context.phone ? { telefon: context.phone } : {}),
          ...flatFields,
          ...rawFields,
        },
        intent: args.yeni_kisi === true ? 'new_person' : 'continue',
      })
      if (step.completed) {
        const { releaseWhatsAppFlowEngine } = await import('./flow-engine')
        await releaseWhatsAppFlowEngine(context.clinicId, context.conversationId)
      }
      return {
        success: step.success,
        message: step.message || step.next?.prompt || (step.completed ? 'Görüşmeyi kısa ve nazikçe tamamla.' : 'Kullanıcının yanıtını bekle.'),
        sonraki_adim: step.next?.type,
        revision: step.revision,
      }
    }
    if (name === 'veriTablosunaKaydet') {
      const rawNested = (args.bilgiler && typeof args.bilgiler === 'object')
        ? (args.bilgiler as Record<string, unknown>)
        : {}
      const extraArgs = Object.fromEntries(
        Object.entries(args).filter(([k]) => k !== 'bilgiler' && k !== 'hedef_tablo_id'),
      )
      const explicitPhone = String(rawNested.telefon || extraArgs.telefon || '').trim()
      if (context.phone && explicitPhone && normalizePhone(explicitPhone) !== normalizePhone(context.phone)) {
        throw new Error('Yalnızca bu WhatsApp numarasına ait kayıt işlemlerini yapabilirsiniz.')
      }
      let acceptedStep: Awaited<ReturnType<NonNullable<WhatsAppToolContext['flowEngine']>['accept']>> | undefined
      if (context.flowEngine) {
        if (Object.keys(rawNested).length === 0 && Object.keys(extraArgs).length === 0 && context.flowEngine.hasSavedDynamicRecord()) {
          return { success: true, kaydedilen_satir: 1, message: 'Veri tablosu kaydı tamamlandı.' }
        }
        acceptedStep = await context.flowEngine.accept({
          fields: {
            ...(context.phone ? { telefon: context.phone } : {}),
            ...extraArgs,
            ...rawNested,
          },
        })
      }
      const { saveFlowDynamicRecord } = await import('../db/repositories/dynamic-tables')
      const { getActiveFlow } = await import('../db/repositories/flows')
      const activeFlow = context.flowEngine
        ? context.flowEngine.getFlow()
        : await getActiveFlow('whatsapp', context.clinicId).catch(() => null)
      const targetTableId = typeof args.hedef_tablo_id === 'string' && args.hedef_tablo_id.trim()
        ? args.hedef_tablo_id.trim()
        : undefined
      const saved = await saveFlowDynamicRecord({
        clinicId: context.clinicId,
        fields: {
          ...(context.flowEngine ? context.flowEngine.getFields() : {}),
          ...(acceptedStep?.fields || {}),
          ...(context.phone ? { telefon: context.phone } : {}),
          ...extraArgs,
          ...rawNested,
        },
        targetTableId,
        flowNodes: activeFlow?.nodes,
      })
      if (context.flowEngine) {
        let completed = Boolean(acceptedStep?.completed)
        const expected = context.flowEngine.expectedAction()
        if (expected && expected.action === 'save_record') {
          const afterAction = await context.flowEngine.completeAction(expected.nodeId, true)
          completed = completed || Boolean(afterAction.completed)
        }
        if (completed) {
          const { releaseWhatsAppFlowEngine } = await import('./flow-engine')
          await releaseWhatsAppFlowEngine(context.clinicId, context.conversationId)
        }
      }
      return {
        success: true,
        kaydedilen_satir: saved.savedCount,
        message: saved.savedCount > 0
          ? 'Bilgiler veri tablosuna kaydedildi.'
          : 'Kaydedilecek tablo alanı bulunamadı.',
      }
    }
    if (name === 'veriTablosuSorgula') {
      const explicitPhone = String(args.telefon || '').trim()
      if (context.phone && explicitPhone && normalizePhone(explicitPhone) !== normalizePhone(context.phone)) {
        throw new Error('Yalnızca bu WhatsApp numarasına ait telefon sorgularını yapabilirsiniz.')
      }
      const { queryDynamicTableRecord } = await import('../db/repositories/dynamic-tables')
      const searchVal = typeof args.aranan_deger === 'string' ? args.aranan_deger.trim() : ''
      const lookupPhone = explicitPhone || (!searchVal && context.phone ? context.phone : '')
      const res = await queryDynamicTableRecord({
        clinicId: context.clinicId,
        tableIdOrName: typeof args.tablo === 'string' ? args.tablo : undefined,
        searchValue: searchVal || undefined,
        columnNameOrSlug: typeof args.sutun === 'string' ? args.sutun : undefined,
        phone: lookupPhone || undefined,
      })
      if (context.flowEngine && Object.keys(res.fieldPatch).length > 0) {
        const step = await context.flowEngine.accept({ fields: res.fieldPatch }).catch(() => null)
        if (step?.completed) {
          const { releaseWhatsAppFlowEngine } = await import('./flow-engine')
          await releaseWhatsAppFlowEngine(context.clinicId, context.conversationId)
        }
      }
      return {
        success: true,
        kayitli: res.found,
        tablo: res.tableName,
        kayit: res.record,
        kayitlar: res.records,
        message: res.message,
      }
    }
    if (name === 'searchKnowledgeBase') {
      const results = await searchKnowledge(String(args.sorgu || '').slice(0, 1000), {
        limit: 5,
        direction: 'whatsapp',
        channel: 'whatsapp',
      })
      return { sonuc: results.map(r => `${r.documentName}: ${r.chunkText}`).join('\n\n') || 'İlgili bilgi bulunamadı.' }
    }
    if (name === 'randevuMusaitlikKontrol') {
      const from = String(args.tarih || args.baslangic_tarih || '')
      const to = String(args.tarih || args.bitis_tarih || from)
      const start = appointmentTime(from, '00:00')
      const end = new Date(appointmentTime(to, '00:00').getTime() + 86400_000)
      if (end <= start || end.getTime() - start.getTime() > 31 * 86400_000) throw new Error('En fazla 31 günlük bir tarih aralığı belirtin.')
      const slots = await db.select({ start: dentalAppointments.startTime, end: dentalAppointments.endTime }).from(dentalAppointments)
        .where(and(eq(dentalAppointments.clinicId, context.clinicId), gte(dentalAppointments.startTime, start), lt(dentalAppointments.startTime, end), sql`${dentalAppointments.status} <> 'cancelled'`)).limit(300)
      const isDental = currentBusinessTemplate() === 'dental_clinic'
      return { dolu_araliklar: slots, message: `Yalnızca kayıtlı dolu aralıklar gösterilir; kesin saat için ${isDental ? 'klinik' : 'işletme'} onayı gerekir.` }
    }
    if (name !== 'insanaAktar' && name !== 'konuDisiSohbetDuraklat') {
      if (!context.phone) throw new Error('Gönderici numarası doğrulanamadı. Kişisel işlemler için insanaAktar aracını kullanın.')
      if (args.telefon && normalizePhone(String(args.telefon)) !== normalizePhone(context.phone)) throw new Error('Yalnızca bu WhatsApp numarasına ait kişi işlemlerini yapabilirsiniz.')
    }
    if (name === 'musteriSorgula' || name === 'gecmisRandevular') {
      const { lookupDynamicFieldsByPhone } = await import('../db/repositories/dynamic-tables')
      const [[patient], dynFields] = await Promise.all([
        db.select({ id: patients.id, name: patients.name }).from(patients)
          .where(and(eq(patients.clinicId, context.clinicId), patientPhoneMatches(context.phone!))).limit(1),
        lookupDynamicFieldsByPhone(context.phone!, context.clinicId).catch((): Record<string, unknown> => ({})),
      ])
      const dynSummary = typeof dynFields._dynamicSummary === 'string' ? dynFields._dynamicSummary : ''
      const dynName = typeof dynFields._dynamicCallerName === 'string' ? dynFields._dynamicCallerName : null
      const publicDynamicFields = Object.fromEntries(
        Object.entries(dynFields).filter(([k]) => !k.startsWith('_') || k.startsWith('_col__')),
      )
      const isKnown = Boolean(patient || dynFields._dynamicKnownCaller === 'true' || dynSummary)
      if (context.flowEngine) {
        await context.flowEngine.accept({
          fields: {
            ...publicDynamicFields,
            telefon: context.phone!,
            kayitli: isKnown ? 'true' : 'false',
            'caller.isKnownPatient': isKnown ? 'true' : 'false',
            ...(patient?.name ? { musteri_adi: patient.name } : dynName ? { musteri_adi: dynName } : {}),
          },
        }).catch(() => null)
      }
      const p10 = last10Digits(context.phone!)
      const intakePhonePred = p10.length >= 10
        ? sql`RIGHT(regexp_replace(COALESCE(${dentalAppointments.intakePatientPhone}, ''), '[^0-9]', '', 'g'), 10) = ${p10}`
        : null
      const calendarOwnerPred = patient && intakePhonePred
        ? or(eq(dentalAppointments.patientId, patient.id), intakePhonePred)
        : patient
          ? eq(dentalAppointments.patientId, patient.id)
          : intakePhonePred

      const history = await db.select({ id: appointments.id, tarih: appointments.date, saat: appointments.time }).from(appointments)
        .where(and(eq(appointments.clinicId, context.clinicId), eq(appointments.phone, context.phone!))).orderBy(desc(appointments.date)).limit(10)
      const calendar = calendarOwnerPred
        ? await db.select({ id: dentalAppointments.id, tarih: dentalAppointments.startTime, durum: dentalAppointments.status }).from(dentalAppointments)
            .where(and(eq(dentalAppointments.clinicId, context.clinicId), calendarOwnerPred)).orderBy(desc(dentalAppointments.startTime)).limit(10)
        : []

      if (!patient) {
        if (dynFields._dynamicKnownCaller === 'true' || dynSummary || calendar.length > 0 || history.length > 0) {
          return {
            kayitli: true,
            musteri_adi: dynName,
            randevular: history,
            takvim: calendar,
            ...(Object.keys(publicDynamicFields).length > 0 ? { dinamik_alanlar: publicDynamicFields } : {}),
            veri_tablosu_kayitlari: dynSummary || undefined,
          }
        }
        return {
          kayitli: false,
          sonuc: currentBusinessTemplate() === 'dental_clinic'
            ? 'Bu klinikte kayıtlı hasta bulunamadı.'
            : 'Bu işletmede kayıtlı kişi bulunamadı.',
        }
      }
      return {
        kayitli: true,
        musteri_adi: patient.name,
        randevular: history,
        takvim: calendar,
        ...(Object.keys(publicDynamicFields).length > 0 ? { dinamik_alanlar: publicDynamicFields } : {}),
        ...(dynSummary ? { veri_tablosu_kayitlari: dynSummary } : {}),
      }
    }
    // Mutation + result commit in one transaction. A restarted AI turn reuses the recorded result.
    return await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.messageId}:${name}`}, 0))`)
      const [done] = await tx.select().from(whatsappToolExecutions).where(and(eq(whatsappToolExecutions.messageId, context.messageId), eq(whatsappToolExecutions.name, name)))
      if (done) return { ...done.result as Record<string, unknown>, tekrar: true, bilgi: 'Bu mesaj için işlem zaten yapıldı; kaydedilen sonuç döndürüldü.' }
      const isDental = currentBusinessTemplate() === 'dental_clinic'
      const orgLabel = isDental ? 'klinik' : 'işletme'
      let result: Record<string, unknown>
      if (name === 'randevuOlustur') {
        const created = await createAssistantAppointment({ ...args, telefon: context.phone }, { sessionId: `wa_${context.messageId}`, clinicId: context.clinicId, source: 'whatsapp_ai' }, tx)
        result = { success: true, id: created.id, message: `${created.date} ${created.time} için randevu talebi alındı; ${orgLabel} onayı bekleniyor.` }
      } else if (name === 'randevuDurumBildir' || (name === 'randevuGuncelle' && args.durum)) {
        const rawDurum = String(args.durum || '')
        const action = rawDurum === 'confirm' || rawDurum === 'confirmed'
          ? 'confirm'
          : rawDurum === 'postpone' || rawDurum === 'postponed'
            ? 'postpone'
            : 'cancel'
        const targetAppt = await findUpcomingAppointmentByPhone(context.clinicId, context.phone!, String(args.randevu_id || ''))
        if (!targetAppt) throw new Error('Bu numaraya ait aktif ileri tarihli bir randevu bulunamadı.')
        const { applyPatientAppointmentResponse } = await import('./appointment-notifications')
        await applyPatientAppointmentResponse({
          clinicId: context.clinicId,
          appointmentId: targetAppt.id,
          action,
          note: String(args.not || args.sorun_veya_talep || '') || null,
          preferredDate: String(args.tercih_edilen_tarih || args.tarih || '') || null,
          channel: 'whatsapp',
        })
        result = {
          success: true,
          id: targetAppt.id,
          message: action === 'confirm'
            ? 'Randevunuz onaylandı olarak takvime işlendi.'
            : action === 'postpone'
              ? `Erteleme talebiniz ${orgLabel} takvimine iletildi; ekibimiz yeni saat için sizinle iletişime geçecektir.`
              : `Randevunuz iptal edildi ve ${orgLabel} takviminde güncellendi.`,
        }
      } else if (name === 'randevuGuncelle') {
        result = await updateWhatsAppAppointment(tx, args, context.clinicId, context.phone!)
      } else if (name === 'hastaNotKaydet' || name === 'musteriNotKaydet') {
        const note = String(args.not || '').trim()
        if (!note || note.length > 4000) throw new Error('1–4000 karakterlik bir not gerekli.')
        const [patient] = await tx.select({ id: patients.id }).from(patients).where(and(eq(patients.clinicId, context.clinicId), patientPhoneMatches(context.phone!))).limit(1)
        await tx.insert(patientNotes).values({ clinicId: context.clinicId, patientId: patient?.id ?? null, phone: context.phone, content: note, source: 'whatsapp' })
        result = { success: true, message: isDental ? 'Not kliniğe iletildi.' : 'Notunuz işletmeye iletildi.' }
      } else if (name === 'konuDisiSohbetDuraklat') {
        await tx.update(whatsappConversations).set({ aiPaused: true, updatedAt: new Date() }).where(and(eq(whatsappConversations.id, context.conversationId), eq(whatsappConversations.clinicId, context.clinicId)))
        const { releaseWhatsAppFlowEngine } = await import('./flow-engine')
        await releaseWhatsAppFlowEngine(context.clinicId, context.conversationId).catch(() => {})
        result = { success: true, message: 'Konu dışı ısrar nedeniyle bu sohbette otomatik yanıtlar duraklatıldı. Kullanıcıya yalnızca belirlenen sınır mesajını gönder.' }
      } else {
        await tx.update(whatsappConversations).set({ aiPaused: true }).where(and(eq(whatsappConversations.id, context.conversationId), eq(whatsappConversations.clinicId, context.clinicId)))
        result = { success: true, message: 'Sohbet personel desteğine alındı. Kullanıcıya ekibin buradan devam edeceğini söyle.' }
      }
      await tx.insert(whatsappToolExecutions).values({ messageId: context.messageId, name, arguments: args, result })
      return result
    })
  } catch (error) {
    // Database errors can contain query arguments; return only intentional validation messages.
    return { success: false, message: error instanceof Error && !('query' in error) && !('code' in error) ? error.message : 'İşlem tamamlanamadı. İşletme yetkilisinden destek isteyin.' }
  }
}
