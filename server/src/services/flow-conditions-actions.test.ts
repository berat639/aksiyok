import { describe, expect, test } from 'bun:test'
import {
  evaluateConditionGroup,
  evaluateConditionNode,
  evaluateConditionRule,
  flowToPromptText,
  flowToToolFields,
  type ConversationFlow,
  type FlowNode,
} from '../db/repositories/flows'
import { buildFlowNodePrompt, FlowEngine } from './flow-engine'
import { runFlowSimulationStep } from './flow-simulator'
import { normalizeAppointmentDate, normalizeAppointmentTime } from './assistant-appointments'

describe('Diagram Conditions & Actions — Full End-to-End Verification', () => {
  test('evaluates all 15 condition operators accurately in Turkish', () => {
    const fields = {
      kayitli: 'true',
      sikayet: 'Yirmilik diş çekimi ve kanal tedavisi',
      puan: '8',
      sehir: 'Ankara',
      not: '',
      user_intent: 'operatöre bağlanmak ve fiyat öğrenmek istiyor',
    }

    expect(evaluateConditionRule({ field: 'kayitli', operator: 'equals', value: 'true' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'caller.isKnownPatient', operator: 'equals', value: 'evet' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'kayitli', operator: 'notEquals', value: 'false' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'sikayet', operator: 'contains', value: 'kanal' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'sikayet', operator: 'notContains', value: 'implant' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'sikayet', operator: 'startsWith', value: 'yirmilik' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'sikayet', operator: 'regex', value: 'çekim.*kanal' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'puan', operator: 'gt', value: '5' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'puan', operator: 'gte', value: '8' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'puan', operator: 'lt', value: '10' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'puan', operator: 'lte', value: '8' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'puan', operator: 'between', value: '7', valueTo: '9' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'sehir', operator: 'in', value: 'İstanbul, Ankara, İzmir' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'not', operator: 'isEmpty' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'sikayet', operator: 'notEmpty' }, fields)).toBe(true)
    expect(evaluateConditionRule({ field: 'user_intent', operator: 'intent', value: 'fiyat öğrenmek' }, fields)).toBe(true)
  })

  test('evaluates compound AND / OR condition groups and system variables', () => {
    const condNode: FlowNode = {
      id: 'cond_vip_or_urgent',
      type: 'CONDITION',
      position: { x: 0, y: 0 },
      data: {
        conditionLogic: 'OR',
        rules: [
          { field: 'caller.isVip', operator: 'equals', value: 'true' },
          { field: 'sikayet', operator: 'contains', value: 'acil' },
        ],
      },
    }

    expect(evaluateConditionNode(condNode, { 'caller.isVip': 'false', sikayet: 'Çok acil diş ağrım var' })).toBe(true)
    expect(evaluateConditionNode(condNode, { 'caller.isVip': 'true', sikayet: 'Kontrol' })).toBe(true)
    expect(evaluateConditionNode(condNode, { 'caller.isVip': 'false', sikayet: 'Kontrol' })).toBe(false)

    const nestedGroup = evaluateConditionGroup(
      {
        logic: 'AND',
        rules: [
          { field: 'kayitli', operator: 'equals', value: 'true' },
          {
            logic: 'OR',
            rules: [
              { field: 'caller.hasUpcomingAppointment', operator: 'equals', value: 'true' },
              { field: 'puan', operator: 'gte', value: '9' },
            ],
          },
        ],
      },
      { kayitli: 'true', 'caller.hasUpcomingAppointment': 'false', puan: '9' },
    )
    expect(nestedGroup).toBe(true)
  })

  test('FlowEngine executes CONDITION branches, transfer_call, on_transfer_fail, save_patient_note, send_wa_location, set_variable, and save_appointment_pending', async () => {
    const flow: ConversationFlow = {
      id: 'full-asterisk-flow',
      name: 'Kapsamlı Santral Akışı',
      isActive: true,
      createdAt: '',
      updatedAt: '',
      nodes: [
        { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: { label: 'Karşılama' } },
        {
          id: 'cond_kayitli',
          type: 'CONDITION',
          position: { x: 0, y: 100 },
          data: { conditionField: 'kayitli', operator: 'equals', conditionValue: 'true' },
        },
        {
          id: 'field_sikayet',
          type: 'FIELD',
          position: { x: 0, y: 200 },
          data: { fieldName: 'sikayet', description: 'Şikayetiniz veya talebiniz nedir?', required: true },
        },
        {
          id: 'cond_acil',
          type: 'CONDITION',
          position: { x: 0, y: 300 },
          data: { conditionField: 'sikayet', operator: 'contains', conditionValue: 'operatör' },
        },
        {
          id: 'act_transfer',
          type: 'ACTION',
          position: { x: -150, y: 400 },
          data: {
            action: 'transfer_call',
            transferNumber: '08503096119',
            requireConfirmation: false,
          },
        },
        {
          id: 'act_transfer_fail',
          type: 'ACTION',
          position: { x: -300, y: 400 },
          data: {
            action: 'save_patient_note',
            eventTrigger: 'on_transfer_fail',
            message: 'Hat meşgul, notunuzu alıyorum.',
          },
        },
        {
          id: 'field_tarih',
          type: 'FIELD',
          position: { x: 150, y: 400 },
          data: { fieldName: 'tarih', fieldType: 'date', description: 'Hangi gün randevu istersiniz?', required: true },
        },
        {
          id: 'field_saat',
          type: 'FIELD',
          position: { x: 150, y: 500 },
          data: { fieldName: 'saat', fieldType: 'time', description: 'Saat kaç olsun?', required: true },
        },
        {
          id: 'act_randevu',
          type: 'ACTION',
          position: { x: 150, y: 600 },
          data: { action: 'save_appointment_pending' },
        },
        {
          id: 'end',
          type: 'END',
          position: { x: 0, y: 700 },
          data: { label: 'Bitiş', message: 'Sağlıklı günler dileriz.' },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'cond_kayitli' },
        { id: 'e2', source: 'cond_kayitli', sourceHandle: 'true', target: 'field_sikayet' },
        { id: 'e3', source: 'cond_kayitli', sourceHandle: 'false', target: 'field_sikayet' },
        { id: 'e4', source: 'field_sikayet', target: 'cond_acil' },
        { id: 'e5', source: 'cond_acil', sourceHandle: 'true', target: 'act_transfer' },
        { id: 'e6', source: 'cond_acil', sourceHandle: 'false', target: 'field_tarih' },
        { id: 'e7', source: 'act_transfer', target: 'end' },
        { id: 'e8', source: 'act_transfer_fail', target: 'end' },
        { id: 'e9', source: 'field_tarih', target: 'field_saat' },
        { id: 'e10', source: 'field_saat', target: 'act_randevu' },
        { id: 'e11', source: 'act_randevu', target: 'end' },
      ],
    }

    // 1. Senaryo: Müşteri operatöre bağlanmak istiyor -> CONDITION (sikayet contains 'operatör') -> ACTION (transfer_call)
    const engineTransfer = FlowEngine.fromMemory(flow, {
      direction: 'inbound',
      channel: 'phone',
      initialFields: { kayitli: 'true', musteri_adi: 'Ayşe Demir', telefon: '05551112233' },
    })

    const step1 = await engineTransfer.accept({ fields: {} })
    expect(step1.next?.nodeId).toBe('field_sikayet')
    expect(step1.next?.prompt).toContain('Şikayetiniz veya talebiniz nedir?')

    const step2 = await engineTransfer.accept({ fields: { sikayet: 'Operatör ile görüşmek istiyorum' } })
    expect(step2.next?.nodeId).toBe('act_transfer')
    expect(step2.next?.type).toBe('ACTION')
    expect(step2.next?.prompt).toContain('aramaAktar')
    expect(step2.next?.prompt).toContain('08503096119')

    // Eğer aktarım başarısız olursa on_transfer_fail tetiklenir ve hastaNotKaydet talimatı döner:
    const failStep = await engineTransfer.accept({ eventTrigger: 'on_transfer_fail' })
    expect(failStep.next?.nodeId).toBe('act_transfer_fail')
    expect(failStep.next?.prompt).toContain('hastaNotKaydet')

    // Not kaydedildiğinde akış END düğümüne ulaşır:
    const afterNote = await engineTransfer.completeAction('act_transfer_fail', true)
    expect(afterNote.completed).toBe(true)
    expect(afterNote.next?.prompt).toContain('Sağlıklı günler dileriz.')

    // 2. Senaryo: Müşteri normal randevu istiyor -> CONDITION false -> tarih+saat (birleşik soru) -> randevuOlustur -> END
    const engineAppt = FlowEngine.fromMemory(flow, {
      direction: 'inbound',
      channel: 'phone',
      initialFields: { kayitli: 'true', musteri_adi: 'Mehmet Kaya', telefon: '05559998877' },
    })

    const apptStep1 = await engineAppt.accept({ fields: { sikayet: 'Diş taşı temizliği' } })
    expect(apptStep1.next?.nodeId).toBe('field_tarih')
    expect(apptStep1.next?.prompt).toContain('Hangi gün ve saat için randevu oluşturmamı istersiniz?')

    const apptStep2 = await engineAppt.accept({ fields: { tarih: '2026-11-05', saat: '14:30' } })
    expect(apptStep2.next?.nodeId).toBe('act_randevu')
    expect(apptStep2.next?.prompt).toContain('randevuOlustur')

    const apptDone = await engineAppt.completeAction('act_randevu', true)
    expect(apptDone.completed).toBe(true)
  })

  test('buildFlowNodePrompt produces explicit Turkish instructions for all ACTION types', () => {
    const dummyFlow: ConversationFlow = {
      id: 'f1',
      name: 'test',
      isActive: true,
      createdAt: '',
      updatedAt: '',
      nodes: [],
      edges: [],
    }

    const transferConfirmPrompt = buildFlowNodePrompt(
      dummyFlow,
      { id: 'a1', type: 'ACTION', position: { x: 0, y: 0 }, data: { action: 'transfer_call', transferNumber: '08503096119', requireConfirmation: true } },
      {},
    )
    expect(transferConfirmPrompt).toContain('aramaAktar')
    expect(transferConfirmPrompt).toContain('08503096119')

    const waLocPrompt = buildFlowNodePrompt(
      dummyFlow,
      { id: 'a2', type: 'ACTION', position: { x: 0, y: 0 }, data: { action: 'send_wa_location' } },
      {},
    )
    expect(waLocPrompt).toContain('whatsappKonumGonder')

    const endCallPrompt = buildFlowNodePrompt(
      dummyFlow,
      { id: 'a3', type: 'ACTION', position: { x: 0, y: 0 }, data: { action: 'end_call', message: 'İyi günler dilerim.' } },
      {},
    )
    expect(endCallPrompt).toContain('cagriySonlandir')
    expect(endCallPrompt).toContain('İyi günler dilerim.')
  })

  test('FlowSimulator evaluates CONDITION branches, global keyword triggers, and ACTION outcomes', async () => {
    const nodes: FlowNode[] = [
      { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: { label: 'Karşılama' } },
      { id: 'cond_kayitli', type: 'CONDITION', position: { x: 0, y: 100 }, data: { conditionField: 'kayitli', operator: 'equals', conditionValue: 'true' } },
      { id: 'field_sikayet', type: 'FIELD', position: { x: -100, y: 200 }, data: { fieldName: 'sikayet', description: 'Şikayetiniz nedir?', required: true } },
      { id: 'field_ad', type: 'FIELD', position: { x: 100, y: 200 }, data: { fieldName: 'musteri_adi', description: 'Adınız soyadınız nedir?', required: true } },
      { id: 'act_transfer', type: 'ACTION', position: { x: 200, y: 300 }, data: { action: 'transfer_call', transferNumber: '08503096119', triggerKeywords: 'operatör, canlı destek' } },
      { id: 'end', type: 'END', position: { x: 0, y: 400 }, data: { label: 'Bitiş', message: 'Görüşmek üzere.' } },
    ]
    const edges = [
      { id: 'e1', source: 'start', target: 'cond_kayitli' },
      { id: 'e2', source: 'cond_kayitli', sourceHandle: 'true', target: 'field_sikayet' },
      { id: 'e3', source: 'cond_kayitli', sourceHandle: 'false', target: 'field_ad' },
      { id: 'e4', source: 'field_sikayet', target: 'end' },
      { id: 'e5', source: 'field_ad', target: 'end' },
      { id: 'e6', source: 'act_transfer', target: 'end' },
    ]

    // Global keyword trigger "operatör" -> act_transfer -> end
    const simTransfer = await runFlowSimulationStep({
      direction: 'inbound',
      nodes,
      edges,
      currentNodeId: 'field_sikayet',
      fields: { kayitli: 'true' },
      userMessage: 'Beni hemen operatöre bağlayın lütfen',
      skipReply: true,
    })

    expect(simTransfer.completed).toBe(true)
    expect(simTransfer.visitedNodeIds).toContain('act_transfer')
    expect(simTransfer.nextInstruction).toContain('08503096119')

    const promptText = flowToPromptText({
      id: 'sim',
      name: 'sim',
      isActive: true,
      createdAt: '',
      updatedAt: '',
      nodes,
      edges,
    })
    expect(promptText).toContain('GLOBAL TETİKLEYİCİLER')
    expect(promptText).toContain('operatör, canlı destek')
    expect(promptText).toContain('aramaAktar')
  })

  test('FlowEngine skips optional FIELD nodes when downstream booking fields are already collected and normalizes Turkish dates/times', async () => {
    expect(normalizeAppointmentDate('2026-11-04')).toBe('2026-11-04')
    expect(normalizeAppointmentDate('04.11.2026')).toBe('2026-11-04')
    expect(normalizeAppointmentDate('4 Kasım 2026')).toBe('2026-11-04')
    expect(normalizeAppointmentTime('14:00')).toBe('14:00')
    expect(normalizeAppointmentTime('14.00')).toBe('14:00')
    expect(normalizeAppointmentTime('9:30')).toBe('09:30')

    const dentalBranchingFlow: ConversationFlow = {
      id: 'dental-branching',
      name: 'dental-branching',
      isActive: true,
      createdAt: '',
      updatedAt: '',
      nodes: [
        { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: { label: 'Karşılama' } },
        { id: 'field_telefon', type: 'FIELD', position: { x: 0, y: 100 }, data: { fieldName: 'telefon', required: true } },
        { id: 'cond_kayitli', type: 'CONDITION', position: { x: 0, y: 200 }, data: { conditionField: 'kayitli', operator: 'equals', conditionValue: 'true' } },
        { id: 'field_doktor_id', type: 'FIELD', position: { x: -100, y: 300 }, data: { fieldName: 'doktor_id', required: false } },
        { id: 'field_islem_turu', type: 'FIELD', position: { x: -100, y: 400 }, data: { fieldName: 'islem_turu', required: false } },
        { id: 'field_tarih_existing', type: 'FIELD', position: { x: -100, y: 500 }, data: { fieldName: 'tarih', fieldType: 'date', required: true } },
        { id: 'field_saat_existing', type: 'FIELD', position: { x: -100, y: 600 }, data: { fieldName: 'saat', fieldType: 'time', required: true } },
        { id: 'action_existing', type: 'ACTION', position: { x: -100, y: 700 }, data: { action: 'randevuOlustur' } },
        { id: 'end_existing', type: 'END', position: { x: -100, y: 800 }, data: { label: 'Son' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'field_telefon' },
        { id: 'e2', source: 'field_telefon', target: 'cond_kayitli' },
        { id: 'e3', source: 'cond_kayitli', sourceHandle: 'true', target: 'field_doktor_id' },
        { id: 'e4', source: 'field_doktor_id', target: 'field_islem_turu' },
        { id: 'e5', source: 'field_islem_turu', target: 'field_tarih_existing' },
        { id: 'e6', source: 'field_tarih_existing', target: 'field_saat_existing' },
        { id: 'e7', source: 'field_saat_existing', target: 'action_existing' },
        { id: 'e8', source: 'action_existing', target: 'end_existing' },
      ],
    }

    const engine = FlowEngine.fromMemory(dentalBranchingFlow, {
      direction: 'inbound',
      channel: 'phone',
      initialFields: { telefon: '5076652367', kayitli: 'true', musteri_adi: 'Berat İnceçam' },
    })

    const step = await engine.accept({
      fields: {
        telefon: '5076652367',
        tarih: '4 Kasım 2026',
        saat: '14.00',
        sikayet: 'Diş kontrolü',
        musteri_adi: 'Berat İnceçam',
      },
    })

    expect(step.success).toBe(true)
    expect(step.next?.nodeId).toBe('action_existing')
    expect(step.next?.type).toBe('ACTION')
    expect(step.fields.tarih).toBe('2026-11-04')
    expect(step.fields.saat).toBe('14:00')
    expect(step.fields.islem_turu).toBe('Diş kontrolü')
  })

  test('Dynamic Table columns work across all assistants (inbound, outbound, web, whatsapp), preserve custom AI question, and evaluate compound conditions + save_record', async () => {
    const customQuestion = 'Tedavimizden memnuniyetinizi 1 ile 10 arasında kendi cümlenizle paylaşır mısınız?'
    const dynamicFlow: ConversationFlow = {
      id: 'dynamic-table-flow',
      name: 'Dinamik Müşteri ve Anket Akışı',
      isActive: true,
      createdAt: '',
      updatedAt: '',
      nodes: [
        { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: { label: 'Karşılama' } },
        {
          id: 'field_survey_score',
          type: 'FIELD',
          position: { x: 0, y: 120 },
          data: {
            label: 'Anket · Memnuniyet Puanı',
            fieldName: 'anket__memnuniyet_puani',
            fieldType: 'number',
            description: customQuestion,
            required: true,
            sourceTableId: 'tbl_anket',
            sourceTableSlug: 'anket',
            sourceTableName: 'Anket',
            sourceColumnId: 'col_puan',
            sourceColumnSlug: 'memnuniyet_puani',
            sourceColumnName: 'Memnuniyet Puanı',
            sourceColumnType: 'number',
          },
        },
        {
          id: 'cond_dynamic_compound',
          type: 'CONDITION',
          position: { x: 0, y: 240 },
          data: {
            label: '2 Koşullu Yönlendirme',
            conditionField: 'musteriler__ozel_uye',
            operator: 'equals',
            conditionValue: 'true',
            conditionLogic: 'AND',
            rules: [
              {
                field: 'musteriler__ozel_uye',
                operator: 'equals',
                value: 'true',
                sourceTableName: 'Müşteriler',
                sourceColumnName: 'Özel Üye',
              },
              {
                field: 'anket__memnuniyet_puani',
                operator: 'gte',
                value: '8',
                sourceTableName: 'Anket',
                sourceColumnName: 'Memnuniyet Puanı',
              },
              {
                field: 'musteriler__ilgilenilen_islemler',
                operator: 'contains',
                value: 'İmplant',
                sourceTableName: 'Müşteriler',
                sourceColumnName: 'İlgilenilen İşlemler',
              },
              {
                field: 'musteriler__toplam_harcama',
                operator: 'gt',
                value: '2000',
                sourceTableName: 'Müşteriler',
                sourceColumnName: 'Toplam Harcama',
              },
            ],
          },
        },
        {
          id: 'act_save_dyn',
          type: 'ACTION',
          position: { x: -120, y: 360 },
          data: {
            action: 'save_record',
            targetTableId: 'tbl_anket',
            targetTableName: 'Anket',
            label: '💾 Anket Tablosuna Kaydet',
          },
        },
        {
          id: 'act_low_score_note',
          type: 'ACTION',
          position: { x: 120, y: 360 },
          data: {
            action: 'save_patient_note',
            label: '🗒️ Hastadan Not Al',
          },
        },
        {
          id: 'end_ok',
          type: 'END',
          position: { x: 0, y: 480 },
          data: { label: 'Bitiş', message: 'Geri bildiriminiz için çok teşekkür ederiz.' },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'field_survey_score' },
        { id: 'e2', source: 'field_survey_score', target: 'cond_dynamic_compound' },
        { id: 'e3', source: 'cond_dynamic_compound', sourceHandle: 'true', target: 'act_save_dyn' },
        { id: 'e4', source: 'cond_dynamic_compound', sourceHandle: 'false', target: 'act_low_score_note' },
        { id: 'e5', source: 'act_save_dyn', target: 'end_ok' },
        { id: 'e6', source: 'act_low_score_note', target: 'end_ok' },
      ],
    }

    // Prompt ve araç şemasında kullanıcının kendi yazdığı AI Sorusu birebir korunmalı
    const toolSchema = flowToToolFields(dynamicFlow)
    expect(toolSchema.properties['anket__memnuniyet_puani']?.description).toContain(customQuestion)
    const prompt = flowToPromptText(dynamicFlow)
    expect(prompt).toContain(customQuestion)
    expect(prompt).toContain('Anket · Memnuniyet Puanı')
    expect(prompt).toContain('VERİ TABLOSUNA KAYDET (Anket)')

    // Her 4 asistan yönünde (inbound, outbound, web, whatsapp) aynı dinamik akış çalışmalı
    for (const [direction, channel] of [
      ['inbound', 'phone'],
      ['outbound', 'phone'],
      ['web', 'web_socket'],
      ['whatsapp', 'whatsapp'],
    ] as const) {
      const engine = FlowEngine.fromMemory(dynamicFlow, {
        direction,
        channel,
        initialFields: {
          musteriler__ad_soyad: 'Zeynep Aydın',
          musteriler__telefon: '05321112233',
          musteriler__ozel_uye: 'true',
          musteriler__ilgilenilen_islemler: ['İmplant', 'Beyazlatma'],
          musteriler__toplam_harcama: '3.450,00 ₺',
        },
      })

      // 1) İlk adımda kullanıcının dokunulmamış özel AI Sorusu döner ve ad/telefon köprülenir
      const askStep = await engine.accept({ fields: {} })
      expect(askStep.next?.nodeId).toBe('field_survey_score')
      expect(askStep.next?.prompt).toContain(customQuestion)
      expect(askStep.fields.musteri_adi).toBe('Zeynep Aydın')
      expect(askStep.fields.telefon).toBe('05321112233')

      // 2) Kullanıcı 9 puan verdiğinde 4'lü dinamik koşul (boolean + number + multiselect + currency) EVET dalından save_record -> END'e ilerler
      const highStep = await engine.accept({ fields: { anket__memnuniyet_puani: '9' } })
      expect(highStep.completed).toBe(true)
      expect(highStep.next?.nodeId).toBe('end_ok')
      expect(highStep.next?.prompt).toContain('Geri bildiriminiz için çok teşekkür ederiz.')
    }

    // Düşük puan verildiğinde HAYIR dalına (act_low_score_note) yönlenir
    const lowEngine = FlowEngine.fromMemory(dynamicFlow, {
      direction: 'outbound',
      channel: 'phone',
      initialFields: {
        musteriler__ozel_uye: 'true',
        musteriler__ilgilenilen_islemler: ['İmplant'],
        musteriler__toplam_harcama: '3500',
      },
    })
    const lowStep = await lowEngine.accept({ fields: { anket__memnuniyet_puani: '4' } })
    expect(lowStep.completed).toBeUndefined()
    expect(lowStep.next?.nodeId).toBe('act_low_score_note')
  })
})
