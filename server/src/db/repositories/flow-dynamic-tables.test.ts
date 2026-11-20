import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from '../client'
import { clinics, conversationFlows, dynamicRows, flowSessions } from '../schema'
import { runWithTenantContext } from '../../tenancy/context'
import {
  buildFlowDynamicFieldKey,
  buildFlowDynamicTableExistsKey,
  clearDynamicTables,
  createDynamicRelation,
  createDynamicRow,
  createDynamicTable,
  getStudioSchema,
  hydrateDynamicConditionLookups,
  listDynamicRows,
  lookupDynamicFieldsByPhone,
  queryDynamicTableRecord,
  saveFlowDynamicRecord,
  updateDynamicColumn,
  updateDynamicTable,
} from './dynamic-tables'
import {
  evaluateConditionRule,
  flowToPromptText,
  getActiveFlow,
  saveFlow,
  type FlowEdge,
  type FlowNode,
} from './flows'
import {
  FlowEngine,
  getOrCreateWhatsAppFlowEngine,
  releaseWhatsAppFlowEngine,
} from '../../services/flow-engine'
import { buildToolDeclarations } from '../../services/assistant-tool-declarations'
import { executeWhatsAppTool } from '../../services/whatsapp-tools'
import { runFlowSimulationStep } from '../../services/flow-simulator'
import { createLiveSession } from '../../gemini'
import { setSetting } from './settings'

const hasDatabase = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDatabase)('Dynamic Tables <-> Flow Builder & Assistant Integration (PostgreSQL)', () => {
  let clinicId = ''
  let customersTableId = ''
  let surveyTableId = ''
  let customerColsBySlug: Record<string, string> = {}
  let surveyColsBySlug: Record<string, string> = {}

  beforeAll(async () => {
    const [createdClinic] = await db
      .insert(clinics)
      .values({
        name: `Flow Dynamic Test Clinic ${crypto.randomUUID().slice(0, 8)}`,
        isActive: true,
      })
      .returning({ id: clinics.id })

    if (!createdClinic?.id) throw new Error('Test kliniği oluşturulamadı')
    clinicId = createdClinic.id

    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      const customersTable = await createDynamicTable({
        name: 'Müşteriler',
        icon: 'users',
        color: '#0284c7',
        initialColumns: [
          { name: 'Ad Soyad', fieldType: 'text', isPrimaryTitle: true, isRequired: true },
          { name: 'Telefon', fieldType: 'phone', isUnique: true },
          { name: 'Özel Üye', fieldType: 'boolean' },
          {
            name: 'Müşteri Grubu',
            fieldType: 'select',
            config: {
              options: [
                { id: 'opt_gold', label: 'Altın', color: '#f59e0b' },
                { id: 'opt_silver', label: 'Gümüş', color: '#94a3b8' },
              ],
            },
          },
          {
            name: 'Hizmetler',
            fieldType: 'multiselect',
            config: {
              options: [
                { id: 'srv_imp', label: 'İmplant', color: '#0284c7' },
                { id: 'srv_kan', label: 'Kanal Tedavisi', color: '#15803d' },
              ],
            },
          },
          { name: 'Bakiye', fieldType: 'currency' },
        ],
      })
      customersTableId = customersTable.id
      customerColsBySlug = Object.fromEntries(customersTable.columns.map(c => [c.slug, c.id]))

      const surveyTable = await createDynamicTable({
        name: 'Anket',
        icon: 'clipboard-check',
        color: '#15803d',
        initialColumns: [
          { name: 'Katılımcı', fieldType: 'text', isPrimaryTitle: true },
          { name: 'Memnuniyet Puanı', fieldType: 'number' },
          { name: 'Görüş', fieldType: 'text' },
        ],
      })
      surveyTableId = surveyTable.id
      surveyColsBySlug = Object.fromEntries(surveyTable.columns.map(c => [c.slug, c.id]))

      await createDynamicRow(customersTableId, {
        values: {
          [customerColsBySlug.ad_soyad!]: 'Zeynep Kaya',
          // Formatlı numara: boşluk, parantez ve ülke kodu içerir
          [customerColsBySlug.telefon!]: '+90 (532) 999 88 77',
          [customerColsBySlug.ozel_uye!]: true,
          [customerColsBySlug.musteri_grubu!]: 'Altın',
          [customerColsBySlug.hizmetler!]: ['İmplant', 'Kanal Tedavisi'],
          [customerColsBySlug.bakiye!]: 1500,
        },
      })
    })
  })

  afterAll(async () => {
    if (!clinicId) return
    try {
      await db.delete(flowSessions).where(eq(flowSessions.clinicId, clinicId))
      await db.delete(conversationFlows).where(eq(conversationFlows.clinicId, clinicId))
      await db.delete(clinics).where(eq(clinics.id, clinicId))
    } catch {
      // Kaskad temizlik hatası testi düşürmemeli
    }
  })

  test('lookupDynamicFieldsByPhone formatlı numarayı bulur ve select/multiselect etiketlerini Türkçe çözer', async () => {
    const hydrated = await lookupDynamicFieldsByPhone('05329998877', clinicId)

    expect(hydrated._dynamicKnownCaller).toBe('true')
    expect(hydrated._dynamicCallerName).toBe('Zeynep Kaya')
    expect(hydrated[buildFlowDynamicFieldKey('musteriler', 'ad_soyad')]).toBe('Zeynep Kaya')
    expect(hydrated[buildFlowDynamicFieldKey('musteriler', 'ozel_uye')]).toBe('true')
    // Option ID ('opt_gold') yerine Türkçe etiket ('Altın') gelmeli
    expect(hydrated[buildFlowDynamicFieldKey('musteriler', 'musteri_grubu')]).toBe('Altın')
    expect(hydrated[buildFlowDynamicFieldKey('musteriler', 'hizmetler')]).toEqual(['İmplant', 'Kanal Tedavisi'])
    expect(hydrated[buildFlowDynamicFieldKey('musteriler', 'bakiye')]).toBe('1500')
  })

  test('her 4 asistanda (inbound, outbound, web, whatsapp) dinamik alanlar ve AI Sorusu dokunulmadan kaydedilir', async () => {
    const customQuestion = 'Kliniğimizden aldığınız hizmetten 1 ile 10 arasında ne kadar memnun kaldınız?'
    const nodes: FlowNode[] = [
      { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: { label: 'Karşılama' } },
      {
        id: 'f_puan',
        type: 'FIELD',
        position: { x: 0, y: 120 },
        data: {
          label: 'Anket · Memnuniyet Puanı',
          fieldName: 'anket__memnuniyet_puani',
          fieldType: 'number',
          description: customQuestion,
          required: true,
          sourceTableId: surveyTableId,
          sourceTableName: 'Anket',
          sourceTableSlug: 'anket',
          sourceColumnId: surveyColsBySlug.memnuniyet_puani,
          sourceColumnName: 'Memnuniyet Puanı',
          sourceColumnSlug: 'memnuniyet_puani',
          sourceColumnType: 'number',
        },
      },
      {
        id: 'f_gorus',
        type: 'FIELD',
        position: { x: 0, y: 240 },
        data: {
          label: 'Anket · Görüş',
          fieldName: 'anket__gorus',
          fieldType: 'text',
          description: 'Eklemek istediğiniz görüşünüz var mı?',
          required: true,
          sourceTableId: surveyTableId,
          sourceTableName: 'Anket',
          sourceTableSlug: 'anket',
          sourceColumnId: surveyColsBySlug.gorus,
          sourceColumnName: 'Görüş',
          sourceColumnSlug: 'gorus',
          sourceColumnType: 'text',
        },
      },
      {
        id: 'cond_1',
        type: 'CONDITION',
        position: { x: 0, y: 360 },
        data: {
          label: 'Altın Müşteri ve Yüksek Puan mı?',
          conditionLogic: 'AND',
          conditionField: 'musteriler__musteri_grubu',
          operator: 'equals',
          conditionValue: 'Altın',
          rules: [
            {
              field: 'musteriler__musteri_grubu',
              fieldLabel: 'Müşteriler · Müşteri Grubu',
              operator: 'equals',
              value: 'Altın',
              sourceTableId: customersTableId,
              sourceTableName: 'Müşteriler',
            },
            {
              field: 'musteriler__hizmetler',
              fieldLabel: 'Müşteriler · Hizmetler',
              operator: 'contains',
              value: 'İmplant',
              sourceTableId: customersTableId,
              sourceTableName: 'Müşteriler',
            },
            {
              field: 'anket__memnuniyet_puani',
              fieldLabel: 'Anket · Memnuniyet Puanı',
              operator: 'gte',
              value: '8',
              sourceTableId: surveyTableId,
              sourceTableName: 'Anket',
            },
          ],
        },
      },
      {
        id: 'act_save',
        type: 'ACTION',
        position: { x: -120, y: 500 },
        data: {
          action: 'save_record',
          label: 'Anket Kaydını Tabloya Yaz',
          targetTableId: surveyTableId,
          targetTableName: 'Anket',
        },
      },
      { id: 'end_yes', type: 'END', position: { x: -120, y: 640 }, data: { label: 'Teşekkürler', message: 'Görüşünüz kaydedildi.' } },
      { id: 'end_no', type: 'END', position: { x: 140, y: 640 }, data: { label: 'Geri Bildirim', message: 'Sizi arayacağız.' } },
    ]
    const edges: FlowEdge[] = [
      { id: 'e1', source: 'start', target: 'f_puan' },
      { id: 'e2', source: 'f_puan', target: 'f_gorus' },
      { id: 'e3', source: 'f_gorus', target: 'cond_1' },
      { id: 'e4', source: 'cond_1', target: 'act_save', sourceHandle: 'true', label: 'Evet' },
      { id: 'e5', source: 'cond_1', target: 'end_no', sourceHandle: 'false', label: 'Hayır' },
      { id: 'e6', source: 'act_save', target: 'end_yes' },
    ]

    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      for (const direction of ['inbound', 'outbound', 'web', 'whatsapp'] as const) {
        await saveFlow(nodes, edges, direction)
        const loaded = await getActiveFlow(direction)
        expect(loaded).not.toBeNull()
        const puanNode = loaded!.nodes.find(n => n.id === 'f_puan')
        expect(puanNode?.data.fieldName).toBe('anket__memnuniyet_puani')
        expect(puanNode?.data.description).toBe(customQuestion)
        expect(puanNode?.data.sourceTableId).toBe(surveyTableId)
      }
    })
  })

  test('FlowEngine dinamik tablo koşullarını değerlendirir ve save_record ile Anket tablosuna gerçek satır yazar', async () => {
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      const callerFields = await lookupDynamicFieldsByPhone('0532 999 88 77', clinicId)
      const engine = await FlowEngine.create({
        clinicId,
        direction: 'whatsapp',
        channel: 'whatsapp',
        mode: 'active',
        initialFields: {
          ...callerFields,
          telefon: '05329998877',
        },
      })
      expect(engine).not.toBeNull()

      // İlk adımda kullanıcının girdiği AI Sorusu dokunulmadan sunulmalı
      const initRes = await engine!.accept({})
      expect(initRes.next?.nodeId).toBe('f_puan')
      expect(initRes.next?.prompt).toContain(
        'Kliniğimizden aldığınız hizmetten 1 ile 10 arasında ne kadar memnun kaldınız?',
      )

      const step1 = await engine!.accept({ fields: { anket__memnuniyet_puani: '9' } })
      expect(step1.success).toBe(true)
      expect(step1.next?.nodeId).toBe('f_gorus')

      const step2 = await engine!.accept({ fields: { anket__gorus: 'Çok memnun kaldım, teşekkür ederim' } })
      expect(step2.success).toBe(true)
      expect(step2.completed).toBe(true)
      expect(step2.next?.nodeId).toBe('end_yes')
      await engine!.close()

      const savedSurveyRows = await db
        .select()
        .from(dynamicRows)
        .where(and(eq(dynamicRows.clinicId, clinicId), eq(dynamicRows.tableId, surveyTableId)))

      expect(savedSurveyRows.length).toBe(1)
      const savedVals = savedSurveyRows[0]!.values as Record<string, unknown>
      expect(savedVals[surveyColsBySlug.katilimci!]).toBe('Zeynep Kaya')
      expect(savedVals[surveyColsBySlug.memnuniyet_puani!]).toBe(9)
      expect(savedVals[surveyColsBySlug.gorus!]).toBe('Çok memnun kaldım, teşekkür ederim')
    })
  })

  test('saveFlowDynamicRecord benzersiz telefon sütunu eşleştiğinde mevcut müşteri kaydını günceller (upsert)', async () => {
    const res = await saveFlowDynamicRecord({
      clinicId,
      targetTableId: customersTableId,
      fields: {
        telefon: '05329998877',
        musteriler__musteri_grubu: 'Gümüş',
        musteriler__bakiye: '2.450,75 ₺',
      },
    })

    expect(res.savedCount).toBe(1)

    const customerRows = await db
      .select()
      .from(dynamicRows)
      .where(and(eq(dynamicRows.clinicId, clinicId), eq(dynamicRows.tableId, customersTableId)))

    expect(customerRows.length).toBe(1)
    const vals = customerRows[0]!.values as Record<string, unknown>
    expect(vals[customerColsBySlug.ad_soyad!]).toBe('Zeynep Kaya')
    expect(vals[customerColsBySlug.musteri_grubu!]).toBe('opt_silver')
    expect(vals[customerColsBySlug.bakiye!]).toBe(2450.75)

    // Sonraki testler için müşteriyi tekrar 'Altın' grubuna alalım
    await saveFlowDynamicRecord({
      clinicId,
      targetTableId: customersTableId,
      fields: {
        telefon: '05329998877',
        musteriler__musteri_grubu: 'Altın',
      },
    })
  })

  test('buildToolDeclarations her 4 asistanda akisBilgisiGuncelle ve veriTablosunaKaydet şemalarına dinamik sütunları ekler', async () => {
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      for (const direction of ['inbound', 'outbound', 'web', 'whatsapp'] as const) {
        const decls = await buildToolDeclarations(direction)
        const akisTool = decls.find(t => t.name === 'akisBilgisiGuncelle')
        const saveTool = decls.find(t => t.name === 'veriTablosunaKaydet')

        expect(akisTool).toBeDefined()
        expect(saveTool).toBeDefined()

        const akisProps = (akisTool!.parameters as any)?.properties?.bilgiler?.properties || {}
        expect(akisProps.anket__memnuniyet_puani).toBeDefined()
        expect(akisProps.anket__gorus).toBeDefined()

        const saveProps = (saveTool!.parameters as any)?.properties?.bilgiler?.properties || {}
        expect(saveProps.anket__memnuniyet_puani).toBeDefined()

        const flow = await getActiveFlow(direction)
        const promptText = flowToPromptText(flow!)
        expect(promptText).toContain('VERİ TABLOSUNA KAYDET')
        expect(promptText).toContain('veriTablosunaKaydet')
      }
    })
  })

  test('Web Sesli Asistan görüşme ortasında telefon numarası alındığında veri tablosunu sorgular ve koşulu değerlendirir', async () => {
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      // Web ziyaretçisinin başlangıçta CallerID numarası yoktur
      const webEngine = await FlowEngine.create({
        clinicId,
        direction: 'web',
        channel: 'web_direct',
        mode: 'active',
        initialFields: {},
      })
      expect(webEngine).not.toBeNull()

      const startStep = await webEngine!.accept({})
      expect(startStep.next?.nodeId).toBe('f_puan')

      // Görüşme sırasında telefon numarası ve anket cevapları gelir
      const finalStep = await webEngine!.accept({
        fields: {
          telefon: '0532 999 88 77',
          anket__memnuniyet_puani: '10',
          anket__gorus: 'Web asistanı üzerinden hızlıca yanıtladım',
        },
      })

      expect(finalStep.success).toBe(true)
      expect(finalStep.completed).toBe(true)
      // Görüşme ortasında Müşteriler tablosundan 'Altın' + 'İmplant' çekildiği için Evet dalına gitmeli
      expect(finalStep.next?.nodeId).toBe('end_yes')
      expect(webEngine!.hasSavedDynamicRecord()).toBe(true)
      await webEngine!.close()
    })
  })

  test('WhatsApp çok turlu (stateful) oturumda akisBilgisiGuncelle adımları korur ve legacy modda veriTablosunaKaydet çalışır', async () => {
    const convId = `wa_conv_${crypto.randomUUID().slice(0, 8)}`
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      // 1. Mesaj: WhatsApp akış oturumu açılır ve ilk webhook accept ile f_puan adımına ilerler
      const engineTurn1 = await getOrCreateWhatsAppFlowEngine({
        clinicId,
        conversationId: convId,
        phone: '05329998877',
        mode: 'active',
      })
      expect(engineTurn1).not.toBeNull()
      const initWaStep = await engineTurn1!.accept({
        fields: { son_mesaj: 'Merhaba' },
        eventTrigger: 'on_whatsapp_message',
      })
      expect(initWaStep.next?.prompt).toContain(
        'Kliniğimizden aldığınız hizmetten 1 ile 10 arasında ne kadar memnun kaldınız?',
      )

      const toolRes1 = await executeWhatsAppTool(
        'akisBilgisiGuncelle',
        { bilgiler: { anket__memnuniyet_puani: '9' } },
        { clinicId, conversationId: convId, messageId: 'm1', phone: '05329998877', flowEngine: engineTurn1 },
      )
      expect(toolRes1.success).toBe(true)

      // 2. Mesaj: Yeni webhook isteğinde aynı oturum kaldığı düğümden ('f_gorus') devam etmeli
      const engineTurn2 = await getOrCreateWhatsAppFlowEngine({
        clinicId,
        conversationId: convId,
        phone: '05329998877',
        mode: 'active',
      })
      expect(engineTurn2).toBe(engineTurn1)
      const turn2Step = await engineTurn2!.accept({
        fields: { son_mesaj: 'Çok iyiydi' },
        eventTrigger: 'on_whatsapp_message',
      })
      expect(turn2Step.next?.nodeId).toBe('f_gorus')
      expect(turn2Step.next?.prompt).toContain('Eklemek istediğiniz görüşünüz var mı?')

      const toolRes2 = await executeWhatsAppTool(
        'akisBilgisiGuncelle',
        { bilgiler: { anket__gorus: 'WhatsApp üzerinden çok pratik oldu' } },
        { clinicId, conversationId: convId, messageId: 'm2', phone: '05329998877', flowEngine: engineTurn2 },
      )
      expect(toolRes2.success).toBe(true)

      await releaseWhatsAppFlowEngine(clinicId, convId)

      // Legacy modda (flowEngine olmadan) doğrudan veriTablosunaKaydet çağrısı
      const legacySaveRes = await executeWhatsAppTool(
        'veriTablosunaKaydet',
        {
          hedef_tablo_id: surveyTableId,
          bilgiler: {
            anket__katilimci: 'Esnek Mod Hastası',
            anket__memnuniyet_puani: '8',
            anket__gorus: 'Legacy modda araçla kaydedildi',
          },
        },
        { clinicId, conversationId: `${convId}_legacy`, messageId: 'm3', phone: null, flowEngine: null },
      )
      expect(legacySaveRes.success).toBe(true)
      expect(legacySaveRes.kaydedilen_satir).toBe(1)
    })
  })

  test('Veri Stüdyosunda tablo veya sütun yeniden adlandırılsa bile kaydedilmiş akışlar sourceColumnId ile çalışmaya devam eder', async () => {
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      // Kaydedilmiş akışta alan adları hâlâ 'musteriler__musteri_grubu' ve 'anket__memnuniyet_puani'
      // Şimdi Veri Stüdyosunda tablo ve sütun adlarını (dolayısıyla slug'larını) değiştirelim:
      await updateDynamicColumn(customerColsBySlug.musteri_grubu!, { name: 'Sadakat Segmenti' })
      await updateDynamicTable(surveyTableId, { name: 'Hasta Memnuniyet Anketleri' })
      await updateDynamicColumn(surveyColsBySlug.memnuniyet_puani!, { name: 'Genel Skor' })

      const beforeRows = await db
        .select()
        .from(dynamicRows)
        .where(and(eq(dynamicRows.clinicId, clinicId), eq(dynamicRows.tableId, surveyTableId)))

      const callerFields = await lookupDynamicFieldsByPhone('05329998877', clinicId)
      // Yeni slug farklı olsa da _col__<columnId> anahtarı sayesinde eski akış kuralı eşleşmeli
      expect(callerFields[`_col__${customerColsBySlug.musteri_grubu!}`]).toBe('Altın')

      // Akıştaki CONDITION kuralına sourceColumnId bilgisini ekleyip kaydedelim (editörün ürettiği gibi)
      const currentFlow = await getActiveFlow('inbound')
      expect(currentFlow).not.toBeNull()
      const updatedNodes = currentFlow!.nodes.map(n => {
        if (n.id !== 'cond_1') return n
        return {
          ...n,
          data: {
            ...n.data,
            sourceColumnId: customerColsBySlug.musteri_grubu,
            rules: (n.data.rules || []).map((r: any) => {
              if (r.field === 'musteriler__musteri_grubu') {
                return { ...r, sourceColumnId: customerColsBySlug.musteri_grubu }
              }
              if (r.field === 'musteriler__hizmetler') {
                return { ...r, sourceColumnId: customerColsBySlug.hizmetler }
              }
              if (r.field === 'anket__memnuniyet_puani') {
                return { ...r, sourceColumnId: surveyColsBySlug.memnuniyet_puani }
              }
              return r
            }),
          },
        }
      })
      await saveFlow(updatedNodes, currentFlow!.edges, 'inbound')

      const engine = await FlowEngine.create({
        clinicId,
        direction: 'inbound',
        channel: 'phone',
        mode: 'active',
        initialFields: {
          ...callerFields,
          telefon: '05329998877',
        },
      })
      expect(engine).not.toBeNull()

      await engine!.accept({})
      const step1 = await engine!.accept({ fields: { anket__memnuniyet_puani: '10' } })
      expect(step1.next?.nodeId).toBe('f_gorus')

      const step2 = await engine!.accept({ fields: { anket__gorus: 'İsim değişikliğinden sonra bile kusursuz çalıştı' } })
      expect(step2.completed).toBe(true)
      expect(step2.next?.nodeId).toBe('end_yes')
      await engine!.close()

      const afterRows = await db
        .select()
        .from(dynamicRows)
        .where(and(eq(dynamicRows.clinicId, clinicId), eq(dynamicRows.tableId, surveyTableId)))
      expect(afterRows.length).toBe(beforeRows.length + 1)

      const latestRow = afterRows.find(r => !beforeRows.some(b => b.id === r.id))
      expect(latestRow).toBeDefined()
      const latestVals = latestRow!.values as Record<string, unknown>
      expect(latestVals[surveyColsBySlug.memnuniyet_puani!]).toBe(10)
      expect(latestVals[surveyColsBySlug.gorus!]).toBe('İsim değişikliğinden sonra bile kusursuz çalıştı')
    })
  })

  test('relation (Başka Tablodan Seçim) sütunları telefon sorgusunda, koşul değerlendirmede ve kayıtta uçtan uca çalışır', async () => {
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      const doctorsTable = await createDynamicTable({
        name: 'Hekimler',
        icon: 'stethoscope',
        color: '#2563eb',
        initialColumns: [{ name: 'Hekim Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true }],
      })
      const docNameColId = doctorsTable.columns[0]!.id
      const drAyse = await createDynamicRow(doctorsTable.id, { values: { [docNameColId]: 'Dr. Ayşe Yılmaz' } })
      await createDynamicRow(doctorsTable.id, { values: { [docNameColId]: 'Dr. Burak Demir' } })

      const packagesTable = await createDynamicTable({
        name: 'Tedavi Paketleri',
        icon: 'package',
        color: '#16a34a',
        initialColumns: [{ name: 'Paket Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true }],
      })
      const pkgNameColId = packagesTable.columns[0]!.id
      await createDynamicRow(packagesTable.id, { values: { [pkgNameColId]: 'İmplant Paketi' } })
      await createDynamicRow(packagesTable.id, { values: { [pkgNameColId]: 'Ortodonti Paketi' } })

      // 1) Ters (inverse) tekli ilişki: Hekimler (1) -> Müşteriler (N), Müşteriler tablosunda 'Sorumlu Hekim' sütunu
      const docToCustomerRel = await createDynamicRelation({
        sourceTableId: doctorsTable.id,
        targetTableId: customersTableId,
        sourceColumnName: 'Hastalar',
        inverseColumnName: 'Sorumlu Hekim',
        cardinality: 'one_to_many',
      })
      expect(docToCustomerRel.inverseColumnId).toBeTruthy()

      // 2) İleri (forward) çoklu ilişki: Müşteriler (N) <-> Tedavi Paketleri (N), Müşteriler tablosunda 'Aktif Paketler' sütunu
      const customerToPkgRel = await createDynamicRelation({
        sourceTableId: customersTableId,
        targetTableId: packagesTable.id,
        sourceColumnName: 'Aktif Paketler',
        cardinality: 'many_to_many',
      })

      // 3) Anket tablosuna ileri tekli ilişki: Anket -> Hekimler ('İlgili Hekim')
      const surveyToDocRel = await createDynamicRelation({
        sourceTableId: surveyTableId,
        targetTableId: doctorsTable.id,
        sourceColumnName: 'İlgili Hekim',
        createInverseColumn: false,
        cardinality: 'one_to_many',
      })

      // Mevcut müşteriyi yalnızca relation sütunlarını (başlık adlarıyla) göndererek güncelle
      const updateRelRes = await saveFlowDynamicRecord({
        clinicId,
        targetTableId: customersTableId,
        fields: {
          telefon: '05329998877',
          musteriler__sorumlu_hekim: 'Dr. Ayşe Yılmaz',
          musteriler__aktif_paketler: 'İmplant Paketi, Ortodonti Paketi',
        },
      })
      expect(updateRelRes.savedCount).toBe(1)

      // Telefonla sorgulandığında dynamic_row_links üzerinden hem forward hem inverse relation başlıkları çözülmeli
      const hydrated = await lookupDynamicFieldsByPhone('0532 999 88 77', clinicId)
      expect(hydrated.musteriler__sorumlu_hekim).toBe('Dr. Ayşe Yılmaz')
      expect(hydrated[`_col__${docToCustomerRel.inverseColumnId!}`]).toBe('Dr. Ayşe Yılmaz')
      expect(hydrated.musteriler__aktif_paketler).toEqual(['İmplant Paketi', 'Ortodonti Paketi'])
      expect(hydrated[`_col__${customerToPkgRel.sourceColumnId}`]).toEqual(['İmplant Paketi', 'Ortodonti Paketi'])
      expect(String(hydrated._dynamicSummary || '')).toContain('Sorumlu Hekim: Dr. Ayşe Yılmaz')
      expect(String(hydrated._dynamicSummary || '')).toContain('Aktif Paketler: İmplant Paketi, Ortodonti Paketi')

      // Akışta relation sütunu sorup, relation koşullarıyla yönlendirip save_record ile kaydetme
      const relFlowNodes: FlowNode[] = [
        { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: { label: 'Başla' } },
        {
          id: 'f_hekim',
          type: 'FIELD',
          position: { x: 0, y: 120 },
          data: {
            label: 'Hasta Memnuniyet Anketleri · İlgili Hekim',
            fieldName: 'hasta_memnuniyet_anketleri__ilgili_hekim',
            fieldType: 'enum',
            enumValues: ['Dr. Ayşe Yılmaz', 'Dr. Burak Demir'],
            description: 'Hangi hekimimizden hizmet aldığınızı paylaşır mısınız?',
            required: true,
            sourceTableId: surveyTableId,
            sourceColumnId: surveyToDocRel.sourceColumnId,
            sourceColumnType: 'relation',
          },
        },
        {
          id: 'cond_rel',
          type: 'CONDITION',
          position: { x: 0, y: 260 },
          data: {
            label: 'Hekim ve Paket Kontrolü',
            conditionLogic: 'AND',
            conditionField: 'musteriler__sorumlu_hekim',
            operator: 'equals',
            conditionValue: 'Dr. Ayşe Yılmaz',
            rules: [
              {
                field: 'musteriler__sorumlu_hekim',
                operator: 'equals',
                value: 'Dr. Ayşe Yılmaz',
                sourceColumnId: docToCustomerRel.inverseColumnId ?? undefined,
              },
              {
                field: 'musteriler__aktif_paketler',
                operator: 'contains',
                value: 'Ortodonti Paketi',
                sourceColumnId: customerToPkgRel.sourceColumnId,
              },
            ],
          },
        },
        {
          id: 'act_save_rel',
          type: 'ACTION',
          position: { x: -100, y: 400 },
          data: {
            action: 'save_record',
            label: 'Anketi Kaydet',
            targetTableId: surveyTableId,
          },
        },
        { id: 'end_ok', type: 'END', position: { x: -100, y: 520 }, data: { label: 'Tamamlandı' } },
        { id: 'end_fail', type: 'END', position: { x: 120, y: 520 }, data: { label: 'Eşleşmedi' } },
      ]
      const relFlowEdges: FlowEdge[] = [
        { id: 're1', source: 'start', target: 'f_hekim' },
        { id: 're2', source: 'f_hekim', target: 'cond_rel' },
        { id: 're3', source: 'cond_rel', sourceHandle: 'true', target: 'act_save_rel' },
        { id: 're4', source: 'cond_rel', sourceHandle: 'false', target: 'end_fail' },
        { id: 're5', source: 'act_save_rel', target: 'end_ok' },
      ]

      await saveFlow(relFlowNodes, relFlowEdges, 'outbound')
      const relEngine = await FlowEngine.create({
        clinicId,
        direction: 'outbound',
        channel: 'phone',
        mode: 'active',
        initialFields: {
          ...hydrated,
          telefon: '05329998877',
        },
      })
      expect(relEngine).not.toBeNull()

      const askStep = await relEngine!.accept({})
      expect(askStep.next?.nodeId).toBe('f_hekim')
      expect(askStep.next?.prompt).toContain('Hangi hekimimizden hizmet aldığınızı paylaşır mısınız?')

      const doneStep = await relEngine!.accept({
        fields: {
          hasta_memnuniyet_anketleri__ilgili_hekim: 'Dr. Ayşe Yılmaz',
        },
      })
      expect(doneStep.completed).toBe(true)
      expect(doneStep.next?.nodeId).toBe('end_ok')
      await relEngine!.close()

      const surveyRowsWithLinks = await listDynamicRows(surveyTableId)
      const linkedSurveyRow = surveyRowsWithLinks.find(
        r => (r.relations?.[surveyToDocRel.sourceColumnId] || []).some(link => link.id === drAyse.id),
      )
      expect(linkedSurveyRow).toBeDefined()
      expect(linkedSurveyRow!.relations[surveyToDocRel.sourceColumnId]![0]!.displayTitle).toBe('Dr. Ayşe Yılmaz')

      // Akış yeniden kaydedilmeden Hekimler tablosuna yeni kayıt eklendiğinde getActiveFlow ve araç şeması canlı güncellenmeli
      await createDynamicRow(doctorsTable.id, { values: { [docNameColId]: 'Dr. Can Özkan' } })
      const liveFlow = await getActiveFlow('outbound')
      const liveHekimNode = liveFlow?.nodes.find(n => n.id === 'f_hekim')
      expect(liveHekimNode?.data.enumValues).toContain('Dr. Can Özkan')
      expect(liveHekimNode?.data.description).toBe('Hangi hekimimizden hizmet aldığınızı paylaşır mısınız?')

      const outboundTools = await buildToolDeclarations('outbound')
      const akisOutbound = outboundTools.find(t => t.name === 'akisBilgisiGuncelle')
      const hekimProp = (akisOutbound?.parameters as any)?.properties?.bilgiler?.properties?.hasta_memnuniyet_anketleri__ilgili_hekim
      expect(hekimProp?.enum).toContain('Dr. Can Özkan')

      // Simülatör (runFlowSimulationStep) telefon numarasından dinamik ve relation sütunlarını salt-okunur çözer, DB'ye yazmaz
      const rowCountBeforeSim = (await listDynamicRows(surveyTableId)).length
      const simRes = await runFlowSimulationStep({
        direction: 'outbound',
        nodes: relFlowNodes,
        edges: relFlowEdges,
        currentNodeId: 'f_hekim',
        fields: {
          telefon: '0532 999 88 77',
          hasta_memnuniyet_anketleri__ilgili_hekim: 'Dr. Ayşe Yılmaz',
        },
        skipReply: true,
      })
      expect(simRes.completed).toBe(true)
      expect(simRes.currentNodeId).toBe('end_ok')
      expect(simRes.visitedNodeIds).toContain('act_save_rel')
      expect(String(simRes.fields._dynamicSummary || '')).toContain('Dr. Ayşe Yılmaz')
      const rowCountAfterSim = (await listDynamicRows(surveyTableId)).length
      expect(rowCountAfterSim).toBe(rowCountBeforeSim)

      // Aynı tabloda 2 farklı relation sütunu aynı anda kaydedilmeli ve kısmi upsert diğer relation bağını silmemeli
      const surveyToPkgRel = await createDynamicRelation({
        sourceTableId: surveyTableId,
        targetTableId: packagesTable.id,
        sourceColumnName: 'Önerilen Paketler',
        createInverseColumn: false,
        cardinality: 'many_to_many',
      })
      const multiRelSave = await saveFlowDynamicRecord({
        clinicId,
        targetTableId: 'Hasta Memnuniyet Anketleri', // UUID yerine tablo başlığı ile çözümleme
        fields: {
          musteri_adi: 'Çoklu İlişki Hastası',
          hasta_memnuniyet_anketleri__ilgili_hekim: 'Dr. Can Özkan',
          hasta_memnuniyet_anketleri__onerilen_paketler: 'İmplant Paketi, Ortodonti Paketi',
        },
      })
      expect(multiRelSave.savedCount).toBe(1)
      const allSurveyRows = await listDynamicRows(surveyTableId)
      const createdMultiRow = allSurveyRows.find(r => r.id === multiRelSave.rowIds[0])
      expect(createdMultiRow).toBeDefined()
      expect(createdMultiRow!.relations[surveyToDocRel.sourceColumnId]?.map(x => x.displayTitle)).toEqual(['Dr. Can Özkan'])
      expect(
        createdMultiRow!.relations[surveyToPkgRel.sourceColumnId]?.map(x => x.displayTitle).sort((a, b) => a.localeCompare(b, 'tr')),
      ).toEqual(['İmplant Paketi', 'Ortodonti Paketi'])

      // Müşteriler tablosunda yalnızca tek relation sütununu güncellediğimizde diğer relation sütunu korunmalı
      await saveFlowDynamicRecord({
        clinicId,
        targetTableId: customersTableId,
        fields: {
          telefon: '05329998877',
          musteriler__sorumlu_hekim: 'Dr. Burak Demir',
        },
      })
      const afterPartialRel = await lookupDynamicFieldsByPhone('05329998877', clinicId)
      expect(afterPartialRel.musteriler__sorumlu_hekim).toBe('Dr. Burak Demir')
      expect(afterPartialRel.musteriler__aktif_paketler).toEqual(['İmplant Paketi', 'Ortodonti Paketi'])
    })
  })

  test('createLiveSession (gemini.ts) legacy modda musteriSorgula ve düz/iç içe veriTablosunaKaydet araç çağrılarını uçtan uca işler', async () => {
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      await setSetting('ai.flow_runtime_mode', 'legacy')

      let capturedCallbacks: any = null
      let capturedConfig: any = null
      const toolResponses: Array<{ id?: string; name?: string; response?: Record<string, unknown> }> = []

      const fakeAi = {
        live: {
          connect: async ({ callbacks, config }: any) => {
            capturedCallbacks = callbacks
            capturedConfig = config
            queueMicrotask(() => {
              callbacks.onopen?.()
              callbacks.onmessage?.({ setupComplete: {} })
            })
            return {
              sendRealtimeInput: () => {},
              sendClientContent: () => {},
              sendToolResponse: (payload: any) => {
                if (Array.isArray(payload?.functionResponses)) {
                  toolResponses.push(...payload.functionResponses)
                }
              },
              close: () => {
                callbacks.onclose?.({})
              },
            }
          },
        },
      }

      const liveSession = await createLiveSession(
        fakeAi as any,
        {
          onReady: () => {},
          onAudio: () => {},
          onTranscript: () => {},
          onInterrupted: () => {},
          onTurnComplete: () => {},
          onError: () => {},
          onClose: () => {},
        },
        {
          dbSessionId: 'sim_live_test_1',
          systemPrompt: 'Test sistem talimatı',
          model: 'gemini-3.8-live',
          clinicId,
          hostname: 'localhost',
          direction: 'outbound',
          callerPhone: '0532 999 88 77',
        },
      )

      expect(String(capturedConfig?.systemInstruction || '')).toContain('ARAYAN KİŞİNİN VERİ TABLOSU KAYITLARI')
      expect(String(capturedConfig?.systemInstruction || '')).toContain('Zeynep Kaya')

      // Legacy modda akisBilgisiGuncelle aracı modele sunulmamalı, veriTablosunaKaydet sunulmalı
      const declaredNames = (capturedConfig?.tools?.[0]?.functionDeclarations || []).map((f: any) => f.name)
      expect(declaredNames).not.toContain('akisBilgisiGuncelle')
      expect(declaredNames).toContain('veriTablosunaKaydet')

      const waitForToolResponse = async (id: string) => {
        const deadline = Date.now() + 2000
        while (Date.now() < deadline) {
          const hit = toolResponses.find(r => r.id === id)
          if (hit) return hit
          await new Promise(r => setTimeout(r, 15))
        }
        return toolResponses.find(r => r.id === id)
      }

      // 1) musteriSorgula çağrısı (yalnızca dinamik tabloda kayıtlı olan arayanı tanımalı)
      await capturedCallbacks.onmessage({
        toolCall: {
          functionCalls: [
            { id: 'call_lookup', name: 'musteriSorgula', args: { telefon: '0532 999 88 77' } },
          ],
        },
      })
      const lookupResp = await waitForToolResponse('call_lookup')
      expect(lookupResp?.response?.kayitli).toBe(true)
      expect(lookupResp?.response?.musteri_adi).toBe('Zeynep Kaya')
      expect(String(lookupResp?.response?.sonuc || '')).toContain('Dr. Burak Demir')

      // 2) Legacy modda hedef_tablo_id olmadan DÜZ (flat) argümanlarla veriTablosunaKaydet (akıştaki save_record düğümünden tabloyu çözer)
      const beforeCount = (await listDynamicRows(surveyTableId)).length
      await capturedCallbacks.onmessage({
        toolCall: {
          functionCalls: [
            {
              id: 'call_save_flat',
              name: 'veriTablosunaKaydet',
              args: {
                hasta_memnuniyet_anketleri__ilgili_hekim: 'Dr. Can Özkan',
                puan: 10,
                hastaNotu: 'Canlı ses oturumu düz argüman testi',
              },
            },
          ],
        },
      })
      const flatSaveResp = await waitForToolResponse('call_save_flat')
      expect(flatSaveResp?.response?.success).toBe(true)
      expect(flatSaveResp?.response?.kaydedilen_satir).toBe(1)

      // 3) Legacy modda bilgiler nesnesi altında (nested) argümanlarla veriTablosunaKaydet
      await capturedCallbacks.onmessage({
        toolCall: {
          functionCalls: [
            {
              id: 'call_save_nested',
              name: 'veriTablosunaKaydet',
              args: {
                bilgiler: {
                  musteri_adi: 'İç İçe Kayıt Hastası',
                  hasta_memnuniyet_anketleri__ilgili_hekim: 'Dr. Ayşe Yılmaz',
                },
              },
            },
          ],
        },
      })
      const nestedSaveResp = await waitForToolResponse('call_save_nested')
      expect(nestedSaveResp?.response?.success).toBe(true)
      expect(nestedSaveResp?.response?.kaydedilen_satir).toBe(1)

      const afterCount = (await listDynamicRows(surveyTableId)).length
      expect(afterCount).toBe(beforeCount + 2)

      liveSession.close()
    })
  })

  test('executeWhatsAppTool düz argümanlı akisBilgisiGuncelle ve musteriSorgula dinamik alan senkronizasyonunu destekler', async () => {
    const convId = `wa_flat_${crypto.randomUUID().slice(0, 8)}`
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      await setSetting('ai.flow_runtime_mode', 'active')
      const waQueryRes = await executeWhatsAppTool(
        'musteriSorgula',
        { telefon: '+90 (532) 999 88 77' },
        { clinicId, conversationId: convId, messageId: 'm_q1', phone: '905329998877', flowEngine: null },
      )
      expect(waQueryRes.kayitli).toBe(true)
      expect(waQueryRes.musteri_adi).toBe('Zeynep Kaya')
      expect((waQueryRes.dinamik_alanlar as Record<string, unknown>)?.musteriler__sorumlu_hekim).toBe('Dr. Burak Demir')

      // Giden arama akışını WhatsApp'a da kaydedip düz argümanla akisBilgisiGuncelle'yi sınayalım
      const outFlow = await getActiveFlow('outbound')
      await saveFlow(outFlow!.nodes, outFlow!.edges, 'whatsapp')

      const waEngine = await getOrCreateWhatsAppFlowEngine({
        clinicId,
        conversationId: convId,
        phone: '05329998877',
        mode: 'active',
      })
      expect(waEngine).not.toBeNull()
      await waEngine!.accept({ fields: { son_mesaj: 'Merhaba' }, eventTrigger: 'on_whatsapp_message' })

      // Düz (bilgiler sarmalayıcısı olmadan) argüman ile akisBilgisiGuncelle
      const flatUpdate = await executeWhatsAppTool(
        'akisBilgisiGuncelle',
        {
          musteriler__sorumlu_hekim: 'Dr. Ayşe Yılmaz',
          hasta_memnuniyet_anketleri__ilgili_hekim: 'Dr. Can Özkan',
        },
        { clinicId, conversationId: convId, messageId: 'm_u1', phone: '05329998877', flowEngine: waEngine },
      )
      expect(flatUpdate.success).toBe(true)
      await releaseWhatsAppFlowEngine(clinicId, convId)
    })
  })

  test('tablo bazlı ____kayitli, existsInTable, HH:MM, endsWith ve veriTablosuSorgula uçtan uca çalışır', async () => {
    await runWithTenantContext({ clinicId, hostname: 'localhost', isActive: true }, async () => {
      // Ürün & Demirbaş Stoku tablosu oluştur
      const stockTable = await createDynamicTable({
        name: 'Ürün & Demirbaş Stoku',
        icon: 'box',
        initialColumns: [
          { name: 'Kalem / Ürün Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true },
          { name: 'Stok Kodu', fieldType: 'text' },
          { name: 'Stok Adedi', fieldType: 'number' },
        ],
      })
      const stockSlug = stockTable.slug
      const stockNameCol = stockTable.columns.find(c => c.name === 'Kalem / Ürün Adı')!
      const stockCodeCol = stockTable.columns.find(c => c.name === 'Stok Kodu')!
      const stockQtyCol = stockTable.columns.find(c => c.name === 'Stok Adedi')!
      await createDynamicRow(stockTable.id, {
        values: {
          [stockNameCol.id]: 'Straumann İmplant',
          [stockCodeCol.id]: 'IMP-TR-VIP',
          [stockQtyCol.id]: 12,
        },
      })

      // 1) lookupDynamicFieldsByPhone eşleşen tabloda 'true', eşleşmeyen tabloda 'false' döner
      const matchedHydrated = await lookupDynamicFieldsByPhone('05329998877', clinicId)
      expect(matchedHydrated[buildFlowDynamicTableExistsKey('musteriler')]).toBe('true')
      expect(matchedHydrated[buildFlowDynamicTableExistsKey(stockSlug)]).toBe('false')

      const unknownHydrated = await lookupDynamicFieldsByPhone('05551112233', clinicId)
      expect(unknownHydrated[buildFlowDynamicTableExistsKey('musteriler')]).toBe('false')
      expect(unknownHydrated._dynamicKnownCaller).toBeUndefined()

      // 2) evaluateConditionRule: HH:MM, endsWith, Türkçe weekday
      expect(evaluateConditionRule(
        { field: 'time.hour', operator: 'between', value: '09:00', valueTo: '18:00' },
        { 'time.hour': '14:30' },
      )).toBe(true)
      expect(evaluateConditionRule(
        { field: `${stockSlug}__${stockCodeCol.slug}`, operator: 'endsWith', value: '-VIP' },
        { [`${stockSlug}__${stockCodeCol.slug}`]: 'IMP-TR-VIP' },
      )).toBe(true)
      expect(evaluateConditionRule(
        { field: 'time.weekday', operator: 'in', value: 'Pazartesi, Cuma' },
        { 'time.weekday': '1' },
      )).toBe(true)

      // 3) FlowEngine hydrateDynamicConditionLookups -> existsInTable + tablo ____kayitli dallanması
      const stockItemKey = buildFlowDynamicFieldKey(stockSlug, stockNameCol.slug)
      const nodes: FlowNode[] = [
        { id: 's', type: 'START', position: { x: 0, y: 0 }, data: { label: 'Başla' } },
        {
          id: 'c_cust',
          type: 'CONDITION',
          position: { x: 0, y: 120 },
          data: {
            label: 'Müşteriler · Bu tabloda kayıtlı mı?',
            conditionField: 'musteriler____kayitli',
            operator: 'equals',
            conditionValue: 'true',
            sourceTableId: customersTableId,
            sourceTableName: 'Müşteriler',
            sourceColumnId: '__row_exists__',
          },
        },
        {
          id: 'c_item',
          type: 'CONDITION',
          position: { x: 0, y: 240 },
          data: {
            label: 'Ürün & Demirbaş Stoku · Kalem / Ürün Adı',
            conditionField: stockItemKey,
            operator: 'existsInTable',
            conditionValue: '',
            sourceTableId: stockTable.id,
            sourceTableName: 'Ürün & Demirbaş Stoku',
            sourceColumnId: stockNameCol.id,
            sourceColumnName: 'Kalem / Ürün Adı',
          },
        },
        { id: 'e_yes', type: 'END', position: { x: 0, y: 360 }, data: { label: 'Stokta Var' } },
        { id: 'e_no', type: 'END', position: { x: 240, y: 360 }, data: { label: 'Yok' } },
      ]
      const edges: FlowEdge[] = [
        { id: 'e1', source: 's', target: 'c_cust' },
        { id: 'e2', source: 'c_cust', sourceHandle: 'true', target: 'c_item' },
        { id: 'e3', source: 'c_cust', sourceHandle: 'false', target: 'e_no' },
        { id: 'e4', source: 'c_item', sourceHandle: 'true', target: 'e_yes' },
        { id: 'e5', source: 'c_item', sourceHandle: 'false', target: 'e_no' },
      ]

      const condHydrated = await hydrateDynamicConditionLookups({
        clinicId,
        node: nodes[2],
        fields: { [stockItemKey]: 'Straumann İmplant' },
      })
      expect(condHydrated[`_col_exists__${stockNameCol.id}`]).toBe('true')
      expect(condHydrated[buildFlowDynamicFieldKey(stockSlug, stockCodeCol.slug)]).toBe('IMP-TR-VIP')

      await saveFlow(nodes, edges, 'web')
      const engine = await FlowEngine.create({
        clinicId,
        direction: 'web',
        channel: 'web_direct',
        mode: 'active',
        initialFields: {
          telefon: '05329998877',
          [stockItemKey]: 'Straumann İmplant',
        },
      })
      expect(engine).not.toBeNull()
      const step = await engine!.accept({})
      expect(step.completed).toBe(true)
      expect(step.next?.nodeId).toBe('e_yes')
      await engine!.close()

      // Prompt metninde ham ____kayitli sızmadan veriTablosuSorgula rehberi olmalı
      const prompt = flowToPromptText({ id: 'f_dyn_cond', name: 'Test', nodes, edges, isActive: true, createdAt: '', updatedAt: '' })
      expect(prompt).toContain('veriTablosuSorgula')
      expect(prompt).toContain('Müşteriler')

      // 4) veriTablosuSorgula bildirimi + queryDynamicTableRecord + executeWhatsAppTool
      const decls = await buildToolDeclarations('inbound')
      expect(decls.some(t => t.name === 'veriTablosuSorgula')).toBe(true)

      const directStock = await queryDynamicTableRecord({
        clinicId,
        tableIdOrName: 'Ürün & Demirbaş Stoku',
        searchValue: 'Straumann',
      })
      expect(directStock.found).toBe(true)
      expect(directStock.record?.['Stok Kodu']).toBe('IMP-TR-VIP')

      const waStockRes = await executeWhatsAppTool(
        'veriTablosuSorgula',
        { tablo: 'Ürün & Demirbaş Stoku', aranan_deger: 'Straumann İmplant' },
        { clinicId, conversationId: `wa_q_${crypto.randomUUID().slice(0, 6)}`, messageId: 'm_stock', phone: '05329998877', flowEngine: null },
      )
      expect(waStockRes.kayitli).toBe(true)
      expect((waStockRes.kayit as Record<string, unknown>)?.['Stok Adedi']).toBe('12')
    })
  })

  test('sektör şablonu (real_estate_appointment) tüm 4 yönü dinamik üretir, main akışı korur ve dinamik randevu alanlarını ayıklar', async () => {
    const [tempClinic] = await db
      .insert(clinics)
      .values({
        name: `Blueprint Sync Test ${crypto.randomUUID().slice(0, 8)}`,
        isActive: true,
      })
      .returning({ id: clinics.id })

    const {
      appointments,
      dentalAppointments,
      dynamicTables,
    } = await import('../schema')

    try {
      await runWithTenantContext({ clinicId: tempClinic.id, hostname: 'localhost', isActive: true }, async () => {
        const {
          applyStarterBlueprint,
          DYNAMIC_AUTO_TEMPLATE_FLOW_NAME,
          syncClinicFlowsWithDynamicTables,
          VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID,
        } = await import('./dynamic-tables')
        const { getActiveFlow, saveFlow } = await import('./flows')
        const { createAssistantAppointment } = await import('../../services/assistant-appointments')

        const schemaRes = await applyStarterBlueprint('real_estate_appointment')
        const realTableIds = new Set(schemaRes.tables.map((t) => t.id))
        const buyersTable = schemaRes.tables.find((t) => t.name.includes('Alıcı'))!
        expect(buyersTable).toBeDefined()

        // 1. Tüm 4 yönde dynamic-auto-template üretilmiş ve eski 'kayitli' sistem koşulu olmamalı
        for (const dir of ['inbound', 'outbound', 'web', 'whatsapp'] as const) {
          const active = await getActiveFlow(dir)
          expect(active).not.toBeNull()
          const [dbRow] = await db
            .select()
            .from(conversationFlows)
            .where(
              and(
                eq(conversationFlows.clinicId, tempClinic.id),
                eq(conversationFlows.direction, dir),
                eq(conversationFlows.isActive, true),
              ),
            )
            .limit(1)
          expect(dbRow?.name).toBe(DYNAMIC_AUTO_TEMPLATE_FLOW_NAME)

          const condNodes = active!.nodes.filter((n) => n.type === 'CONDITION')
          const fieldNodes = active!.nodes.filter((n) => n.type === 'FIELD')
          expect(condNodes.some((c) => c.data?.conditionField === 'kayitli')).toBe(false)
          expect(
            fieldNodes.some((f) => f.data?.sourceTableId && realTableIds.has(String(f.data.sourceTableId))),
          ).toBe(true)

          if (dir !== 'outbound') {
            expect(
              fieldNodes.some(
                (f) =>
                  f.data?.sourceTableId === VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID &&
                  (f.data?.fieldName === 'tarih' || f.data?.fieldName === 'saat'),
              ),
            ).toBe(true)
          }
        }

        // 2. Kullanıcının kaydettiği akış 'main' adına yükselir ve forceRebuild=false senkronunda ezilmez
        const inboundFlow = await getActiveFlow('inbound')
        await saveFlow(inboundFlow!.nodes, inboundFlow!.edges, 'inbound')
        const [savedRow] = await db
          .select()
          .from(conversationFlows)
          .where(
            and(
              eq(conversationFlows.clinicId, tempClinic.id),
              eq(conversationFlows.direction, 'inbound'),
              eq(conversationFlows.isActive, true),
            ),
          )
          .limit(1)
        expect(savedRow?.name).toBe('main')

        const resync = await syncClinicFlowsWithDynamicTables(tempClinic.id, {
          forceRebuild: false,
          directions: ['inbound'],
        })
        expect(resync.updated).toBe(0)
        const afterResync = await getActiveFlow('inbound')
        expect(afterResync?.id).toBe(savedRow!.id)

        // 3. createAssistantAppointment dinamik tablo alanlarından ad, telefon ve talebi ayıklar
        const nameCol = buyersTable.columns.find((c) => c.isPrimaryTitle || /ad/i.test(c.slug))!
        const phoneCol = buyersTable.columns.find((c) => c.fieldType === 'phone' || /telefon/i.test(c.slug))!
        const topicCol = buyersTable.columns.find((c) => /arayis|arayış|tip|butce/i.test(c.slug))!

        const now = new Date()
        const probe = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2))
        while (probe.getUTCDay() !== 1) {
          probe.setUTCDate(probe.getUTCDate() + 1)
        }
        const futureMonday = probe.toISOString().slice(0, 10)

        await createAssistantAppointment(
          {
            [`${buyersTable.slug}__${nameCol.slug}`]: 'Kerem Aydın',
            [`${buyersTable.slug}__${phoneCol.slug}`]: '05334445566',
            [`${buyersTable.slug}__${topicCol.slug}`]: 'Satılık 3+1 Kadıköy',
            tarih: futureMonday,
            saat: '11:00',
          },
          {
            sessionId: `re_sess_${crypto.randomUUID().slice(0, 8)}`,
            clinicId: tempClinic.id,
            source: 'web_ai',
          },
        )

        const [createdAppt] = await db
          .select()
          .from(appointments)
          .where(eq(appointments.clinicId, tempClinic.id))
          .limit(1)
        expect(createdAppt?.customerName).toBe('Kerem Aydın')

        const [createdDental] = await db
          .select()
          .from(dentalAppointments)
          .where(eq(dentalAppointments.clinicId, tempClinic.id))
          .limit(1)
        expect(createdDental?.intakePatientName).toBe('Kerem Aydın')
        expect(createdDental?.complaint).toBe('Satılık 3+1 Kadıköy')
      })
    } finally {
      await db.delete(dentalAppointments).where(eq(dentalAppointments.clinicId, tempClinic.id))
      await db.delete(appointments).where(eq(appointments.clinicId, tempClinic.id))
      await db.delete(flowSessions).where(eq(flowSessions.clinicId, tempClinic.id))
      await db.delete(conversationFlows).where(eq(conversationFlows.clinicId, tempClinic.id))
      await db.delete(dynamicTables).where(eq(dynamicTables.clinicId, tempClinic.id))
      await db.delete(clinics).where(eq(clinics.id, tempClinic.id))
    }
  })
})

describe.skipIf(!hasDatabase)('Dynamic Table Link Lookup, Zero 500-Row Limit & Real Estate WhatsApp Flow (PostgreSQL)', () => {
  test('500 satır sınırı olmadan en eski (#561.) satırı kanonik/mobil URL ve çok kelimeli Türkçe arama ile bulur, olmayan linki reddeder', async () => {
    const {
      dynamicTables,
    } = await import('../schema')

    const [bigClinic] = await db
      .insert(clinics)
      .values({ name: `Big Table Link Test ${Date.now()}` })
      .returning()

    try {
      await runWithTenantContext({ clinicId: bigClinic.id, hostname: 'big-table.local', isActive: true }, async () => {
        const created = await createDynamicTable({
          name: 'Portföy İlanları',
          icon: 'layers',
          color: '#2563eb',
          initialColumns: [
            { name: 'İlan Başlığı', fieldType: 'text', isPrimaryTitle: true, isRequired: true },
            { name: 'Fiyat', fieldType: 'currency' },
            { name: 'İlan Linki', fieldType: 'text' },
            { name: 'Bölge', fieldType: 'text' },
          ],
        })

        const titleCol = created.columns.find(c => c.name === 'İlan Başlığı')!
        const priceCol = created.columns.find(c => c.name === 'Fiyat')!
        const linkCol = created.columns.find(c => c.name === 'İlan Linki')!
        const areaCol = created.columns.find(c => c.name === 'Bölge')!

        const targetUrl = 'https://www.sahibinden.com/ilan/emlak-konut-satilik-besiktas-4-1-555000111/detay'
        const oldestTs = new Date('2025-01-01T00:00:00Z')
        await db.insert(dynamicRows).values({
          clinicId: bigClinic.id,
          tableId: created.id,
          displayTitle: 'Beşiktaş Boğaz Manzaralı 4+1 Daire',
          values: {
            [titleCol.id]: 'Beşiktaş Boğaz Manzaralı 4+1 Daire',
            [priceCol.id]: 18500000,
            [linkCol.id]: targetUrl,
            [areaCol.id]: 'Beşiktaş / Arnavutköy',
          },
          createdAt: oldestTs,
          updatedAt: oldestTs,
        })

        const newerTs = new Date('2026-10-01T00:00:00Z')
        const dummyBatch = Array.from({ length: 560 }, (_, idx) => ({
          clinicId: bigClinic.id,
          tableId: created.id,
          displayTitle: `Örnek Daire ${idx + 1}`,
          values: {
            [titleCol.id]: `Örnek Daire ${idx + 1}`,
            [priceCol.id]: 2000000 + idx * 1000,
            [linkCol.id]: `https://www.sahibinden.com/ilan/emlak-konut-satilik-ornek-${100000 + idx}/detay`,
            [areaCol.id]: 'Ümraniye',
          },
          createdAt: newerTs,
          updatedAt: newerTs,
        }))
        await db.insert(dynamicRows).values(dummyBatch)

        // 1. Mobil alt domain + utm takip parametreli link ile 561. sıradaki en eski satırı bulmalı
        const mobileRes = await queryDynamicTableRecord({
          clinicId: bigClinic.id,
          searchValue: 'https://m.sahibinden.com/ilan/besiktas-daire-555000111/detay?utm_source=whatsapp&utm_medium=share',
        })
        expect(mobileRes.found).toBe(true)
        expect(mobileRes.record?.['İlan Başlığı']).toBe('Beşiktaş Boğaz Manzaralı 4+1 Daire')
        expect(mobileRes.record?.['Fiyat']).toBe('18500000')

        // 2. Aynı siteden (sahibinden.com) ama tabloda OLMAYAN ilan linki asla yanlış eşleşmemeli
        const unknownUrlRes = await queryDynamicTableRecord({
          clinicId: bigClinic.id,
          searchValue: 'https://www.sahibinden.com/ilan/emlak-konut-satilik-olmayan-daire-888999000/detay',
        })
        expect(unknownUrlRes.found).toBe(false)
        expect(unknownUrlRes.records ?? []).toHaveLength(0)

        // 3. Türkçe karaktersiz + çok kelimeli arama da 500 satır sınırı olmadan en eski satırı bulmalı
        const textRes = await queryDynamicTableRecord({
          clinicId: bigClinic.id,
          searchValue: 'besiktas bogaz manzarali',
        })
        expect(textRes.found).toBe(true)
        expect(textRes.record?.['İlan Başlığı']).toBe('Beşiktaş Boğaz Manzaralı 4+1 Daire')

        // 4. CONDITION düğümü existsInTable kontrolü de 500 satır sınırı olmadan çalışmalı
        const condNode: FlowNode = {
          id: 'cond-link',
          type: 'CONDITION',
          position: { x: 0, y: 0 },
          data: {
            sourceTableId: created.id,
            sourceColumnId: linkCol.id,
            conditionField: buildFlowDynamicFieldKey(created.slug, linkCol.slug),
            operator: 'existsInTable',
          },
        }
        const hydratedMatch = await hydrateDynamicConditionLookups({
          clinicId: bigClinic.id,
          node: condNode,
          fields: {
            [buildFlowDynamicFieldKey(created.slug, linkCol.slug)]:
              'https://m.sahibinden.com/ilan/emlak-konut-555000111/detay?ref=wa',
          },
        })
        expect(hydratedMatch[`_col_exists__${linkCol.id}`]).toBe('true')

        const hydratedMiss = await hydrateDynamicConditionLookups({
          clinicId: bigClinic.id,
          node: condNode,
          fields: {
            [buildFlowDynamicFieldKey(created.slug, linkCol.slug)]:
              'https://www.sahibinden.com/ilan/emlak-konut-777888999/detay',
          },
        })
        expect(hydratedMiss[`_col_exists__${linkCol.id}`]).toBe('false')
      })
    } finally {
      await db.delete(dynamicTables).where(eq(dynamicTables.clinicId, bigClinic.id))
      await db.delete(clinics).where(eq(clinics.id, bigClinic.id))
    }
  })

  test('real_estate_appointment örnek senaryosunda İlan Linki çok turlu WhatsApp konuşmasında eşleşir, canlı güncellenir ve yeni bilinmeyen linkte sıfırlanır', async () => {
    const {
      appointments,
      dentalAppointments,
      dynamicColumns,
      dynamicTables,
      whatsappConversations,
    } = await import('../schema')
    const {
      applyStarterBlueprint,
      syncClinicFlowsWithDynamicTables,
      updateDynamicRow,
    } = await import('./dynamic-tables')
    const { ensureWhatsAppSetupSchema } = await import('./whatsapp')
    const { isNonSubstantiveWhatsAppOpening } = await import('../../services/assistant-config')
    const { prepareWhatsAppTurnContext } = await import('../../services/whatsapp-dynamic-links')

    await ensureWhatsAppSetupSchema()

    const [reClinic] = await db
      .insert(clinics)
      .values({ name: `Emlak Link Senaryo ${Date.now()}` })
      .returning()

    const convId = crypto.randomUUID()
    try {
      await runWithTenantContext({ clinicId: reClinic.id, hostname: 're-test.local', isActive: true }, async () => {
        const applied = await applyStarterBlueprint('real_estate_appointment')
        expect(applied.tables.some(t => t.name === 'Portföy İlanları')).toBe(true)

        await syncClinicFlowsWithDynamicTables(reClinic.id, {
          forceRebuild: true,
          directions: ['whatsapp'],
        })

        const listingsTbl = applied.tables.find(t => t.name === 'Portföy İlanları')!
        const cols = await db
          .select()
          .from(dynamicColumns)
          .where(eq(dynamicColumns.tableId, listingsTbl.id))
        const linkCol = cols.find(c => c.name === 'İlan Linki')
        const priceCol = cols.find(c => c.name === 'Fiyat')
        expect(linkCol).toBeDefined()
        expect(priceCol).toBeDefined()

        const seededRows = await listDynamicRows(listingsTbl.id)
        const modaRow = seededRows.find(r => r.displayTitle.includes('Moda 3+1'))
        expect(modaRow).toBeDefined()
        expect(String((modaRow!.values as Record<string, unknown>)[linkCol!.id])).toContain('123456789')

        await db.insert(whatsappConversations).values({
          id: convId,
          clinicId: reClinic.id,
          patientPhone: null,
          instanceName: 'wa-emlak-test',
          remoteJid: '905551112233@s.whatsapp.net',
          history: [],
        })

        // Sadece URL veya ilan numarası içeren açılış mesajı asla anlamsız selamlama sayılmamalı
        expect(
          isNonSubstantiveWhatsAppOpening('https://www.sahibinden.com/ilan/emlak-konut-satilik-moda-deniz-manzarali-3-1-daire-123456789/detay'),
        ).toBe(false)
        expect(isNonSubstantiveWhatsAppOpening('123456789')).toBe(false)

        // Tur 1: Kullanıcı mobil/utm sahibinden linki gönderir -> Moda 3+1 satırı eşleşip konuşmaya sabitlenir
        const turn1 = await prepareWhatsAppTurnContext({
          clinicId: reClinic.id,
          conversationId: convId,
          incomingText:
            'Merhaba https://m.sahibinden.com/ilan/moda-daire-123456789/detay?utm_source=wa bunun fiyatı ve özellikleri nedir?',
          phone: null,
          isVagueOpening: false,
        })
        expect(turn1.linkContext?.status).toBe('matched')
        expect(turn1.linkContext?.matchedRowIds).toEqual([modaRow!.id])
        expect(turn1.dynamicProfileContext).toContain('Moda 3+1 Deniz Manzaralı Daire')
        expect(turn1.dynamicProfileContext).toContain('7250000')
        expect(turn1.dynamicProfileContext).toContain('Kadıköy / Moda')
        expect(turn1.flowStepInstruction).toContain('Ad Soyad')

        const [convAfterT1] = await db
          .select()
          .from(whatsappConversations)
          .where(eq(whatsappConversations.id, convId))
        expect(convAfterT1.activeDynamicContext?.rowIds).toEqual([modaRow!.id])

        // Arada tablodaki fiyat güncellendiğinde 2. tur güncel satırı veritabanından çekmeli
        await updateDynamicRow(modaRow!.id, {
          values: {
            ...(modaRow!.values as Record<string, unknown>),
            [priceCol!.id]: 7490000,
          },
        })

        // Tur 2: Kullanıcı linki tekrar yazmadan takip sorusu sorar -> canlı güncellenmiş satır yüklenir
        const turn2 = await prepareWhatsAppTurnContext({
          clinicId: reClinic.id,
          conversationId: convId,
          incomingText: 'Bunun son fiyatı ne oldu, bir de kime ait?',
          phone: null,
          isVagueOpening: false,
          existingActiveContext: convAfterT1.activeDynamicContext ?? null,
        })
        expect(turn2.linkContext?.status).toBe('rehydrated')
        expect(turn2.dynamicProfileContext).toContain('Moda 3+1 Deniz Manzaralı Daire')
        expect(turn2.dynamicProfileContext).toContain('7490000')

        // Tur 3: Kullanıcı portföyde olmayan yeni bir link gönderir -> eski satır bağlamı temizlenir ve Google/uydurma yasaklanır
        const turn3 = await prepareWhatsAppTurnContext({
          clinicId: reClinic.id,
          conversationId: convId,
          incomingText: 'Peki şu ilana bakar mısınız? https://www.sahibinden.com/ilan/olmayan-baska-ilan-777666555/detay',
          phone: null,
          isVagueOpening: false,
          existingActiveContext: convAfterT1.activeDynamicContext ?? null,
        })
        expect(turn3.linkContext?.status).toBe('not_found')
        expect(turn3.dynamicProfileContext).not.toContain('Moda 3+1 Deniz Manzaralı Daire')
        expect(turn3.dynamicProfileContext).toContain('Google araması yapma')

        const [convAfterT3] = await db
          .select()
          .from(whatsappConversations)
          .where(eq(whatsappConversations.id, convId))
        expect(convAfterT3.activeDynamicContext).toBeNull()
      })
    } finally {
      await db.delete(whatsappConversations).where(eq(whatsappConversations.clinicId, reClinic.id))
      await db.delete(dentalAppointments).where(eq(dentalAppointments.clinicId, reClinic.id))
      await db.delete(appointments).where(eq(appointments.clinicId, reClinic.id))
      await db.delete(flowSessions).where(eq(flowSessions.clinicId, reClinic.id))
      await db.delete(conversationFlows).where(eq(conversationFlows.clinicId, reClinic.id))
      await db.delete(dynamicTables).where(eq(dynamicTables.clinicId, reClinic.id))
      await db.delete(clinics).where(eq(clinics.id, reClinic.id))
    }
  })

  test('buildSystemPrompt ve veriTablosuSorgula emlak kiracısında dental fiyat/konu-dışı engellerini kaldırır, diş kliniğini korur', async () => {
    const {
      appointments,
      dentalAppointments,
      dynamicTables,
    } = await import('../schema')
    const {
      applyStarterBlueprint,
      getClinicDynamicPromptMetadata,
    } = await import('./dynamic-tables')
    const { buildSystemPrompt } = await import('../../services/assistant-config')

    const [reClinic] = await db
      .insert(clinics)
      .values({ name: `Prompt Emlak Test ${Date.now()}` })
      .returning()
    const [dentalClinic] = await db
      .insert(clinics)
      .values({ name: `Prompt Dental Test ${Date.now()}`, businessTemplate: 'dental_clinic' })
      .returning()

    try {
      await runWithTenantContext({ clinicId: reClinic.id, hostname: 'prompt-re.local', isActive: true }, async () => {
        await applyStarterBlueprint('real_estate_appointment')
        const meta = await getClinicDynamicPromptMetadata()
        expect(meta.isNonDentalTenant).toBe(true)
        expect(meta.sectorKind).toBe('real_estate')
        expect(meta.hasPriceColumn).toBe(true)
        expect(meta.hasLinkColumn).toBe(true)

        const waPrompt = await buildSystemPrompt('', 'whatsapp')
        expect(waPrompt).toContain('Portföy İlanları')
        expect(waPrompt).toContain('İlan Linki')
        expect(waPrompt).toContain('Google veya harici internet araması KESİNLİKLE YAPMA')
        expect(waPrompt).not.toContain('Telefonda net ücret veya borç bilgisi verilmez')
        expect(waPrompt).not.toContain('TELEFONDA ÜCRET, BORÇ, BAKİYE VEYA FİYAT BİLGİSİ VERME')
        expect(waPrompt).not.toContain('tıbbi değerlendirme')
        expect(waPrompt).not.toContain('Klinik Dışı Mesaj Koruması')

        const waTools = await buildToolDeclarations('whatsapp')
        const queryTool = waTools.find(t => t.name === 'veriTablosuSorgula')
        expect(queryTool?.description).toContain('Portföy İlanları')
        expect(queryTool?.description).toContain('Google')
      })

      await runWithTenantContext({ clinicId: dentalClinic.id, hostname: 'prompt-dental.local', isActive: true, businessTemplate: 'dental_clinic' }, async () => {
        const dentalMeta = await getClinicDynamicPromptMetadata()
        expect(dentalMeta.isNonDentalTenant).toBe(false)

        const dentalWaPrompt = await buildSystemPrompt('', 'whatsapp')
        expect(dentalWaPrompt).toContain('Telefonda net ücret veya borç bilgisi verilmez')
        expect(dentalWaPrompt).toContain('tıbbi değerlendirme')
      })
    } finally {
      for (const id of [reClinic.id, dentalClinic.id]) {
        await db.delete(dentalAppointments).where(eq(dentalAppointments.clinicId, id))
        await db.delete(appointments).where(eq(appointments.clinicId, id))
        await db.delete(flowSessions).where(eq(flowSessions.clinicId, id))
        await db.delete(conversationFlows).where(eq(conversationFlows.clinicId, id))
        await db.delete(dynamicTables).where(eq(dynamicTables.clinicId, id))
        await db.delete(clinics).where(eq(clinics.id, id))
      }
    }
  })

  test('real_estate_appointment örnek senaryosu stok modülü yerine Portföy İlanları tablosunu seçer ve WhatsApp/Web akışlarına İlan Linki ekler', async () => {
    const {
      appointments,
      dentalAppointments,
      dynamicTables,
    } = await import('../schema')
    const {
      applyStarterBlueprint,
      buildClinicDynamicFlowForDirection,
      getStudioSchema,
    } = await import('./dynamic-tables')

    const [reClinic] = await db
      .insert(clinics)
      .values({ name: `Emlak Akış Link Test ${Date.now()}` })
      .returning()

    try {
      await runWithTenantContext({ clinicId: reClinic.id, hostname: 'flow-link-re.local', isActive: true }, async () => {
        await applyStarterBlueprint('real_estate_appointment')
        const studio = await getStudioSchema(reClinic.id)
        const waFlow = buildClinicDynamicFlowForDirection('whatsapp', studio)
        const webFlow = buildClinicDynamicFlowForDirection('web', studio)
        const inboundFlow = buildClinicDynamicFlowForDirection('inbound', studio)

        for (const flow of [waFlow, webFlow, inboundFlow]) {
          const fieldLabels = flow.nodes
            .filter(n => n.type === 'FIELD')
            .map(n => String(n.data?.label || ''))
          expect(fieldLabels.some(l => l.includes('Ofis & Saha Malzeme Stoku'))).toBe(false)
          expect(fieldLabels.some(l => l.includes('Portföy İlanları'))).toBe(true)
        }

        const waLinkNode = waFlow.nodes.find(
          n => n.type === 'FIELD' && String(n.data?.sourceColumnName || '') === 'İlan Linki',
        )
        const webLinkNode = webFlow.nodes.find(
          n => n.type === 'FIELD' && String(n.data?.sourceColumnName || '') === 'İlan Linki',
        )
        expect(waLinkNode).toBeDefined()
        expect(waLinkNode?.data?.sourceTableName).toBe('Portföy İlanları')
        expect(waLinkNode?.data?.required).toBe(false)
        expect(webLinkNode).toBeDefined()
        expect(webLinkNode?.data?.sourceTableName).toBe('Portföy İlanları')
      })
    } finally {
      await db.delete(dentalAppointments).where(eq(dentalAppointments.clinicId, reClinic.id))
      await db.delete(appointments).where(eq(appointments.clinicId, reClinic.id))
      await db.delete(flowSessions).where(eq(flowSessions.clinicId, reClinic.id))
      await db.delete(conversationFlows).where(eq(conversationFlows.clinicId, reClinic.id))
      await db.delete(dynamicTables).where(eq(dynamicTables.clinicId, reClinic.id))
      await db.delete(clinics).where(eq(clinics.id, reClinic.id))
    }
  })

  test('clearDynamicTables manuel eklenen tabloları toplu temizler, şablon tablolarını ve diğer kiracıyı korur, kopan ilişki sütunlarını siler', async () => {
    const { dynamicTables } = await import('../schema')

    const [clinicA] = await db
      .insert(clinics)
      .values({ name: `Bulk Clear Clinic A ${Date.now()}` })
      .returning()
    const [clinicB] = await db
      .insert(clinics)
      .values({ name: `Bulk Clear Clinic B ${Date.now()}` })
      .returning()

    try {
      let otherClinicTableId = ''
      await runWithTenantContext({ clinicId: clinicB.id, hostname: 'clear-b.local', isActive: true }, async () => {
        const foreign = await createDynamicTable({ name: 'Diğer İşletme Tablosu' })
        otherClinicTableId = foreign.id
      })

      await runWithTenantContext({ clinicId: clinicA.id, hostname: 'clear-a.local', isActive: true }, async () => {
        const tplTable = await createDynamicTable({ name: 'Şablon Müşteriler', origin: 'template' })
        const aiTable = await createDynamicTable({ name: 'Yapay Zeka Talepler', origin: 'ai' })
        const manualA = await createDynamicTable({ name: 'Manuel Notlar' })
        const manualB = await createDynamicTable({ name: 'Manuel Etiketler' })

        // Şablon tablosu ile manuel tablo arasında ilişki kur (manuel tablo silinince şablon tablosundaki ilişki sütunu da temizlenmeli)
        await createDynamicRelation({
          sourceTableId: tplTable.id,
          targetTableId: manualA.id,
          sourceColumnName: 'Bağlı Notlar',
          inverseColumnName: 'İlgili Müşteri',
          createInverseColumn: true,
          cardinality: 'many_to_many',
        })

        // 1) mode: 'manual' yalnızca manuel eklenen 2 tabloyu silmeli, şablon & AI tablolarını korumalı
        const manualCleared = await clearDynamicTables({ mode: 'manual' })
        expect(manualCleared.deletedCount).toBe(2)
        expect(new Set(manualCleared.deletedTableIds)).toEqual(new Set([manualA.id, manualB.id]))
        expect(manualCleared.schema.tables.map((t) => t.id).sort()).toEqual([tplTable.id, aiTable.id].sort())
        expect(manualCleared.schema.relations).toHaveLength(0)
        // Şablon tablosunda yetim ilişki sütunu kalmamalı
        const keptTpl = manualCleared.schema.tables.find((t) => t.id === tplTable.id)!
        expect(keptTpl.columns.some((c) => c.fieldType === 'relation')).toBe(false)

        // 2) mode: 'selected' diğer kiracıya ait tableId'yi asla silmemeli, yalnızca kendi seçili tablosunu silmeli
        const selectedCleared = await clearDynamicTables({
          mode: 'selected',
          tableIds: [aiTable.id, otherClinicTableId],
        })
        expect(selectedCleared.deletedCount).toBe(1)
        expect(selectedCleared.deletedTableIds).toEqual([aiTable.id])
        expect(selectedCleared.schema.tables.map((t) => t.id)).toEqual([tplTable.id])

        // 3) mode: 'all' kalan tüm tabloları temizlemeli
        const allCleared = await clearDynamicTables({ mode: 'all' })
        expect(allCleared.deletedCount).toBe(1)
        expect(allCleared.schema.tables).toHaveLength(0)
      })

      // Diğer kiracının tablosu kesinlikle korunmuş olmalı
      await runWithTenantContext({ clinicId: clinicB.id, hostname: 'clear-b.local', isActive: true }, async () => {
        const bSchema = await getStudioSchema()
        expect(bSchema.tables.map((t) => t.id)).toEqual([otherClinicTableId])
      })
    } finally {
      await db.delete(dynamicTables).where(eq(dynamicTables.clinicId, clinicA.id))
      await db.delete(dynamicTables).where(eq(dynamicTables.clinicId, clinicB.id))
      await db.delete(clinics).where(eq(clinics.id, clinicA.id))
      await db.delete(clinics).where(eq(clinics.id, clinicB.id))
    }
  })
})
