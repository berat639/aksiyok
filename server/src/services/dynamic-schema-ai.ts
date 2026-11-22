import {
  ALLOWED_MODULE_ROLES,
  createDynamicColumn,
  createDynamicRelation,
  createDynamicRow,
  createDynamicTable,
  getStudioSchema,
  isFinanceModuleRole,
  syncClinicFlowsWithDynamicTables,
  updateDynamicRow,
  upsertAppointmentConfig,
  upsertModuleConfig,
  type DynamicColumnConfig,
  type DynamicFieldType,
  type DynamicModuleRole,
  type InitialColumnInput,
} from '../db/repositories/dynamic-tables'
import { ensureCanonicalFinanceTables } from './dynamic-finance-stock'
import { recordAiTokenUsage } from '../db/repositories/ai-usage'
import { getGeminiClient } from './gemini-client'

const ALLOWED_AI_FIELD_TYPES: DynamicFieldType[] = [
  'text',
  'phone',
  'currency',
  'number',
  'date',
  'boolean',
  'select',
  'multiselect',
  'email',
]

const SCENARIO_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Kullanıcıya gösterilecek 1 cümlelik net Türkçe özet.',
    },
    tables: {
      type: 'array',
      description: 'Oluşturulacak veya yeni alan eklenecek listeler.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Türkçe, çoğul ve sade liste adı (Örn: Müşteriler, Portföy İlanları, Sigorta Teklifleri, Ek Teminatlar, Paketler, Tedaviler).',
          },
          appointmentRole: {
            type: 'string',
            enum: ['person', 'service', 'none'],
            description:
              'person = Randevu kimin için açılıyor (tek kişi seçilir). service = Randevuda yapılacak işlem/paket/hizmet (çoklu seçilir). none = Alt detay listesi, finans, stok veya bağımsız liste.',
          },
          moduleRole: {
            type: 'string',
            enum: [
              'none',
              'stock_inventory',
              'stock_movement',
              'asset_maintenance',
            ],
            description:
              'Tablonun Stok & Bakım ekranındaki özel rolü: stock_inventory = Stok/Envanter/Malzeme/Yedek Parça, asset_maintenance = Cihaz/Ekipman/Periyodik Bakım, stock_movement = Stok Hareket Geçmişi, none = Standart liste. (Finans tabloları sistem tarafından standart ve sabit olarak yönetilir, yeni finans tablosu oluşturma.)',
          },
          isRequiredInAppointment: {
            type: 'boolean',
          },
          columns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                fieldType: {
                  type: 'string',
                  enum: [
                    'text',
                    'phone',
                    'currency',
                    'number',
                    'date',
                    'boolean',
                    'select',
                    'multiselect',
                    'email',
                  ],
                },
                isPrimaryTitle: { type: 'boolean' },
                options: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['name', 'fieldType'],
            },
          },
          sampleRecords: {
            type: 'array',
            description: 'Bu liste için 2 adet gerçekçi Türkçe örnek kayıt başlığı.',
            items: { type: 'string' },
          },
        },
        required: ['name', 'appointmentRole', 'columns'],
      },
    },
    relations: {
      type: 'array',
      description: 'Listeler arasındaki bağlantılar.',
      items: {
        type: 'object',
        properties: {
          sourceTableName: {
            type: 'string',
            description:
              'Ana liste adı (Örn: Portföy İlanları, Sigorta Teklifleri, Hizmet Paketleri, Tedaviler).',
          },
          targetTableName: {
            type: 'string',
            description:
              'İçinde seçilecek bağlı detay liste adı (Örn: Mülk Sahipleri, Ek Teminatlar, Sigorta Şirketleri, Malzemeler).',
          },
          allowMultiple: {
            type: 'boolean',
            description: 'Birden fazla seçilebilsin mi? Genellikle true.',
          },
        },
        required: ['sourceTableName', 'targetTableName', 'allowMultiple'],
      },
    },
  },
  required: ['summary', 'tables', 'relations'],
}

interface AiGeneratedColumn {
  name: string
  fieldType: string
  isPrimaryTitle?: boolean
  options?: string[]
}

interface AiGeneratedTable {
  name: string
  appointmentRole: 'person' | 'service' | 'none'
  moduleRole?: 'none' | DynamicModuleRole
  isRequiredInAppointment?: boolean
  columns: AiGeneratedColumn[]
  sampleRecords?: string[]
}

interface AiGeneratedRelation {
  sourceTableName: string
  targetTableName: string
  allowMultiple?: boolean
}

export interface AiScenarioPlan {
  summary: string
  tables: AiGeneratedTable[]
  relations: AiGeneratedRelation[]
}

const SELECT_OPTION_COLORS = ['#0284c7', '#2563eb', '#15803d', '#0369a1', '#0d9488']

function normTr(s: string): string {
  return String(s || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
}

function detectFinanceRoleFromAiTable(
  item: AiGeneratedTable
): 'finance_income' | 'finance_expense' | null {
  if (isFinanceModuleRole(item.moduleRole)) return item.moduleRole
  if (item.moduleRole && item.moduleRole !== 'none') return null
  if (item.appointmentRole === 'person' || item.appointmentRole === 'service') return null
  const lower = normTr(item.name)
  if (/(giderler|masraflar|harcamalar|gider\s*(&|ve)\s*masraf|işletme\s+gider|isletme\s+gider|klinik\s+gider|ofis.*gider|gider\s+takib|masraf\s+takib)/i.test(lower)) {
    return 'finance_expense'
  }
  if (/(gelirler|tahsilatlar|ödemeler|odemeler|gelir\s*(&|ve)\s*tahsilat|tahsilat\s+takib|gelir\s+takib|fatura\s*(&|ve)\s*tahsilat)/i.test(lower)) {
    return 'finance_income'
  }
  return null
}

export async function buildDynamicSchemaFromScenario(
  rawScenario: string,
  userId?: string
): Promise<{
  summary: string
  modelUsed: string
  createdTableCount: number
  createdRelationCount: number
  schema: Awaited<ReturnType<typeof getStudioSchema>>
}> {
  const scenario = String(rawScenario || '').trim()
  if (scenario.length < 4) {
    throw new Error('Lütfen kurmak veya eklemek istediğiniz senaryoyu kısaca yazınız.')
  }
  if (scenario.length > 2000) {
    throw new Error('Senaryo metni çok uzun (en fazla 2000 karakter).')
  }

  const currentSchema = await getStudioSchema()
  const existingSummary =
    currentSchema.tables.length > 0
      ? currentSchema.tables
          .map(
            (t) =>
              `- "${t.name}" (Mevcut alanlar: ${t.columns
                .filter((c) => c.fieldType !== 'relation')
                .map((c) => c.name)
                .join(', ')})`
          )
          .join('\n')
      : 'Henüz hiç liste yok.'

  const client = await getGeminiClient()

  // En düşük maliyetli / en hızlı güncel Gemini Lite model zinciri
  const configuredPrimary =
    (process.env.GEMINI_SCHEMA_BUILDER_MODEL || '').trim() || 'gemini-3.1-flash-lite'
  const candidateModels = Array.from(
    new Set([
      configuredPrimary,
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-flash-lite-latest',
    ])
  )

  const systemInstruction = `Sen SEKTÖR BAĞIMSIZ (emlak, sigorta, danışmanlık, teknik servis, otomotiv, güzellik, sağlık, eğitim, B2B satış vb. her sektöre uyumlu) bir "Dinamik Liste ve Randevu Kurgu Tasarımcısı"sın.
Kullanıcının Türkçe yazdığı senaryoya göre EK OLARAK oluşturulacak (veya mevcut listelere eklenecek) listeleri, bilgi alanlarını, birbirleriyle bağlantılarını ve takvim randevusundaki rollerini planla.

KURALLAR:
1. Mevcut listeleri SİLME. Kullanıcı mevcut bir listeye yeni bir liste bağlamak veya yeni alan eklemek istiyorsa mevcut listenin TAM ADINI kullan; yeni eklenecek listeleri de tables dizisine ekle.
2. Randevu Rolleri (appointmentRole):
   - "person": Randevu veya görüşme kimin için açılıyor? (Örn: Müşteriler, Alıcı Adayları, Sigortalılar, Danışanlar, Hastalar -> Tek kayıt seçilir).
   - "service": Randevuda/görüşmede ne konuşulacak, hangi ilan gösterilecek, hangi teklif sunulacak veya hangi işlem yapılacak? (Örn: Portföy İlanları, Sigorta Teklifleri, Hizmet Paketleri, Servis İşlemleri, Tedaviler -> Çoklu seçilebilir, bağlı alt listeleri de randevu içinde otomatik açılır).
   - "none": Ana işlemin/ilanın/teklifin alt detay listesi (Örn: Mülk Sahipleri, Gayrimenkul Özellikleri, Sigorta Şirketleri, Ek Teminatlar, Yedek Parçalar, Malzemeler) veya randevu dışı bağımsız liste.
3. Alt detay listelerini (Örn: Mülk Sahipleri, Ek Teminatlar, Sigorta Şirketleri, Malzemeler) ilgili ana listeye (Örn: Portföy İlanları, Sigorta Teklifleri, Paketler) relations dizisinde bağla (sourceTableName = Ana Liste, targetTableName = Alt Detay Listesi, allowMultiple = true).
4. Kullanıcının belirttiği sektöre %100 uygun Türkçe terimler kullan (asla alakasız sektör terimi karıştırma). Her yeni liste için ilk alan isPrimaryTitle: true olmalı, telefon varsa "phone", tutar/fiyat/prim/bütçe varsa "currency" seçilmeli ve 2 adet gerçekçi Türkçe sampleRecords üretilmelidir.
5. Gereksiz karmaşık tablo uydurma; senaryoda anlatılan ihtiyacı en temiz ve anlaşılır 1 ila 7 liste ile kur.
6. Finans ve Stok/Bakım Rolleri (moduleRole):
   - Ödemeler & Finans tabloları (Gelirler & Tahsilatlar ve Giderler & Masraflar) sistem tarafından sabit ve ön muhasebe uyumlu olarak otomatik yönetilir; kesinlikle ekstra gelir/tahsilat veya gider/masraf tablosu OLUŞTURMA.
   - Stok, malzeme, yedek parça, sarf, ürün envanteri geçiyorsa ilgili listeye moduleRole: "stock_inventory" ver (Mevcut Stok number, Kritik Eşik number, Birim Maliyet currency, gerekiyorsa Son Kullanma Tarihi date ile).
   - Cihaz bakımı, periyodik bakım, muayene veya kalibrasyon geçiyorsa ilgili listeye moduleRole: "asset_maintenance" ver (Periyodik mi boolean, Periyot Günü number, Planlanan Tarih date, Sonraki Bakım Tarihi date, Durum select, Tahmini Ücret currency ile).
   - Bunların dışındaki müşteri, hizmet, ilan, teklif vb. standart listelerde moduleRole: "none" bırak. Saf stok/bakım listelerinde appointmentRole her zaman "none" olmalıdır.
7. Senaryo emlak ilanı, araç ilanı, ürün veya harici ilan bağlantısı içeriyorsa ilgili ana listeye mutlaka "İlan Linki" (fieldType: "text") alanı ekle ve sampleRecords içinde gerçekçi örnek URL değerleri (ör. "https://www.sahibinden.com/ilan/emlak-konut-satilik-ornek-1042851920/detay") üret.`

  const userPrompt = `Mevcut Listeler:\n${existingSummary}\n\nKullanıcının Senaryosu / İsteği:\n${scenario}`

  let rawJsonText = ''
  let modelUsed = candidateModels[0]!
  let lastErr: unknown = null

  for (const modelName of candidateModels) {
    try {
      const interaction = await client.interactions.create({
        model: modelName,
        input: userPrompt,
        system_instruction: systemInstruction,
        store: false,
        generation_config: {
          temperature: 0.15,
        },
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: SCENARIO_JSON_SCHEMA,
        },
      })

      const fallbackJoinedText = Array.isArray((interaction as any)?.outputs)
        ? (interaction as any).outputs
            .filter((o: any) => o?.type === 'text' && typeof o?.text === 'string')
            .map((o: any) => o.text)
            .join('')
        : ''
      const outText =
        typeof interaction.output_text === 'string' && interaction.output_text.trim()
          ? interaction.output_text
          : fallbackJoinedText
      if (typeof outText === 'string' && outText.trim()) {
        rawJsonText = outText.trim()
        modelUsed = modelName
        const usage = (interaction as any)?.usage
        if (usage) {
          void recordAiTokenUsage({
            source: 'simulator',
            promptTokens: Number(usage.input_tokens || 0),
            responseTokens: Number(usage.output_tokens || 0),
            totalTokens: Number(usage.total_tokens || 0),
            callCount: 1,
          }).catch(() => {})
        }
        break
      }
    } catch (err) {
      lastErr = err
    }
  }

  if (!rawJsonText) {
    const errMsg =
      lastErr instanceof Error ? lastErr.message : 'Yapay zeka yanıt üretemedi'
    throw new Error(`Senaryo çözümlenemedi: ${errMsg}`)
  }

  let plan: AiScenarioPlan
  try {
    const cleaned = rawJsonText
      .replace(/^```json\s*/i, '')
      .replace(/```$/i, '')
      .trim()
    plan = JSON.parse(cleaned) as AiScenarioPlan
  } catch {
    throw new Error('Yapay zeka çıktısı okunamadı, lütfen cümlenizi biraz daha net yazıp tekrar deneyin.')
  }

  return applyAiScenarioPlan(plan, { userId, modelUsed })
}

export async function applyAiScenarioPlan(
  plan: AiScenarioPlan,
  opts?: { userId?: string; modelUsed?: string }
): Promise<{
  summary: string
  modelUsed: string
  createdTableCount: number
  createdRelationCount: number
  schema: Awaited<ReturnType<typeof getStudioSchema>>
}> {
  const userId = opts?.userId
  const modelUsed = opts?.modelUsed ?? 'manual-plan'
  const currentSchema = await getStudioSchema()

  const plannedTables = Array.isArray(plan.tables) ? plan.tables.slice(0, 8) : []
  const plannedRelations = Array.isArray(plan.relations) ? plan.relations.slice(0, 12) : []

  if (plannedTables.length === 0 && plannedRelations.length === 0) {
    throw new Error('Senaryodan eklenecek liste veya bağlantı çıkarılamadı.')
  }

  // Mevcut tabloları isimle eşleştir
  const tableByNormName = new Map<string, { id: string; name: string; isNew: boolean; sampleRowIds: string[] }>()
  for (const existing of currentSchema.tables) {
    tableByNormName.set(normTr(existing.name), {
      id: existing.id,
      name: existing.name,
      isNew: false,
      sampleRowIds: [],
    })
  }

  let createdTableCount = 0
  let createdRelationCount = 0

  for (let idx = 0; idx < plannedTables.length; idx++) {
    const item = plannedTables[idx]!
    const cleanTableName = String(item.name || '').trim()
    if (!cleanTableName) continue

    const key = normTr(cleanTableName)
    const rawCols = Array.isArray(item.columns) ? item.columns.slice(0, 8) : []

    // Finans tabloları sabittir; yapay zeka ekstra gelir/gider tablosu oluşturamaz, mevcut standart tabloyu eşleştirir
    const detectedFinRole = detectFinanceRoleFromAiTable(item)
    if (detectedFinRole) {
      const ensured = await ensureCanonicalFinanceTables()
      const targetFin =
        detectedFinRole === 'finance_expense' ? ensured.expenseTable.table : ensured.incomeTable.table
      tableByNormName.set(key, {
        id: targetFin.id,
        name: targetFin.name,
        isNew: false,
        sampleRowIds: [],
      })
      continue
    }

    const existingMatch = currentSchema.tables.find((t) => normTr(t.name) === key)

    if (existingMatch) {
      // Mevcut tabloya sadece eksik yeni alanları ekle (ek olarak davranış!)
      const existingColNames = new Set(existingMatch.columns.map((c) => normTr(c.name)))
      for (const rc of rawCols) {
        const cName = String(rc.name || '').trim()
        if (!cName || existingColNames.has(normTr(cName))) continue
        const fType: DynamicFieldType = ALLOWED_AI_FIELD_TYPES.includes(
          rc.fieldType as DynamicFieldType
        )
          ? (rc.fieldType as DynamicFieldType)
          : 'text'
        const cfg: DynamicColumnConfig = {}
        if (fType === 'currency') cfg.currencySymbol = '₺'
        if ((fType === 'select' || fType === 'multiselect') && Array.isArray(rc.options)) {
          const opts = rc.options
            .map((o) => String(o || '').trim())
            .filter(Boolean)
            .slice(0, 12)
            .map((label, oIdx) => ({
              id: `opt_${Date.now()}_${oIdx}`,
              label,
              color: SELECT_OPTION_COLORS[oIdx % SELECT_OPTION_COLORS.length]!,
            }))
          if (opts.length > 0) cfg.options = opts
        }
        await createDynamicColumn(existingMatch.id, {
          name: cName,
          fieldType: fType,
          isPrimaryTitle: false,
          isRequired: false,
          showInTable: true,
          config: cfg,
        })
        existingColNames.add(normTr(cName))
      }

      if (item.appointmentRole === 'person' || item.appointmentRole === 'service') {
        await upsertAppointmentConfig({
          tableId: existingMatch.id,
          enabled: true,
          allowMultiple: item.appointmentRole === 'service',
          includeRelatedTables: true,
          isRequiredInAppointment:
            item.appointmentRole === 'person'
              ? true
              : Boolean(item.isRequiredInAppointment),
        })
      }
      continue
    }

    // Yeni tablo oluştur
    const initialColumns: InitialColumnInput[] =
      rawCols.length > 0
        ? rawCols.map((rc, cIdx) => {
            const fType: DynamicFieldType = ALLOWED_AI_FIELD_TYPES.includes(
              rc.fieldType as DynamicFieldType
            )
              ? (rc.fieldType as DynamicFieldType)
              : 'text'
            const cfg: DynamicColumnConfig = {}
            if (fType === 'currency') cfg.currencySymbol = '₺'
            if ((fType === 'select' || fType === 'multiselect') && Array.isArray(rc.options)) {
              const opts = rc.options
                .map((o) => String(o || '').trim())
                .filter(Boolean)
                .slice(0, 12)
                .map((label, oIdx) => ({
                  id: `opt_${Date.now()}_${oIdx}`,
                  label,
                  color: SELECT_OPTION_COLORS[oIdx % SELECT_OPTION_COLORS.length]!,
                }))
              if (opts.length > 0) cfg.options = opts
            }
            return {
              name: String(rc.name || '').trim() || `Alan ${cIdx + 1}`,
              fieldType: fType,
              isPrimaryTitle: cIdx === 0 || Boolean(rc.isPrimaryTitle),
              isRequired: cIdx === 0,
              showInTable: true,
              config: cfg,
            }
          })
        : [{ name: 'Ad / Başlık', fieldType: 'text', isPrimaryTitle: true, isRequired: true }]

    // Diyagramda rolüne göre düzenli başlangıç koordinatı
    const totalOffset = currentSchema.tables.length + createdTableCount
    const canvasX = item.appointmentRole === 'none' ? 60 : 440
    const canvasY = 60 + (totalOffset % 4) * 280

    const createdTbl = await createDynamicTable({
      name: cleanTableName,
      origin: 'ai',
      canvasX,
      canvasY,
      initialColumns,
    })
    createdTableCount++

    if (item.appointmentRole === 'person' || item.appointmentRole === 'service') {
      await upsertAppointmentConfig({
        tableId: createdTbl.id,
        enabled: true,
        allowMultiple: item.appointmentRole === 'service',
        includeRelatedTables: true,
        isRequiredInAppointment:
          item.appointmentRole === 'person'
            ? true
            : Boolean(item.isRequiredInAppointment),
      })
    }

    // 2 adet örnek kaydı ekle ki kartta ve sağdaki canlı randevu simülasyonunda hemen görünsün
    const primaryCol =
      createdTbl.columns.find((c) => c.isPrimaryTitle) || createdTbl.columns[0]
    const sampleRowIds: string[] = []
    const samples = Array.isArray(item.sampleRecords)
      ? item.sampleRecords.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 2)
      : []

    if (primaryCol && samples.length > 0) {
      for (const sampleTitle of samples) {
        try {
          const createdRow = await createDynamicRow(
            createdTbl.id,
            { values: { [primaryCol.id]: sampleTitle } },
            userId
          )
          sampleRowIds.push(createdRow.id)
        } catch {
          // Örnek kayıt eklenemezse şema oluşturmayı bozma
        }
      }
    }

    tableByNormName.set(key, {
      id: createdTbl.id,
      name: createdTbl.name,
      isNew: true,
      sampleRowIds,
    })
  }

  // Bağlantıları oluştur (mükerrer bağlantı açma)
  const freshSchemaBeforeRels = await getStudioSchema()
  const existingRelPairs = new Set<string>()
  for (const r of freshSchemaBeforeRels.relations) {
    existingRelPairs.add(`${r.sourceTableId}:${r.targetTableId}`)
    existingRelPairs.add(`${r.targetTableId}:${r.sourceTableId}`)
  }

  for (const rel of plannedRelations) {
    const srcEntry = tableByNormName.get(normTr(rel.sourceTableName))
    const tgtEntry = tableByNormName.get(normTr(rel.targetTableName))
    if (!srcEntry || !tgtEntry || srcEntry.id === tgtEntry.id) continue

    const pairKey = `${srcEntry.id}:${tgtEntry.id}`
    if (existingRelPairs.has(pairKey)) continue

    try {
      const createdRel = await createDynamicRelation({
        sourceTableId: srcEntry.id,
        targetTableId: tgtEntry.id,
        cardinality: rel.allowMultiple === false ? 'one_to_one' : 'many_to_many',
        createInverseColumn: true,
        onDelete: 'set_null',
      })
      existingRelPairs.add(pairKey)
      existingRelPairs.add(`${tgtEntry.id}:${srcEntry.id}`)
      createdRelationCount++

      // Yeni oluşturulan örnek kayıtları da birbirine bağla ki önizleme anında dolu gelsin
      if (
        createdRel?.sourceColumnId &&
        srcEntry.sampleRowIds[0] &&
        tgtEntry.sampleRowIds.length > 0
      ) {
        await updateDynamicRow(srcEntry.sampleRowIds[0], {
          relations: {
            [createdRel.sourceColumnId]:
              rel.allowMultiple === false
                ? [tgtEntry.sampleRowIds[0]!]
                : tgtEntry.sampleRowIds,
          },
        }).catch(() => {})
      }
    } catch {
      // Devam et
    }
  }

  // Modül rollerini (Ödemeler & Finans / Stok & Bakım) bağlantılar kurulduktan sonra kaydet ki ilişki sütunları otomatik eşleşsin
  for (const item of plannedTables) {
    if (
      item.moduleRole &&
      item.moduleRole !== 'none' &&
      !isFinanceModuleRole(item.moduleRole) &&
      ALLOWED_MODULE_ROLES.includes(item.moduleRole as DynamicModuleRole)
    ) {
      const entry = tableByNormName.get(normTr(item.name))
      if (entry) {
        await upsertModuleConfig({
          tableId: entry.id,
          moduleRole: item.moduleRole as DynamicModuleRole,
          enabled: true,
        }).catch(() => {})
      }
    }
  }

  try {
    await syncClinicFlowsWithDynamicTables(undefined, { forceRebuild: false })
  } catch (err) {
    console.warn('[dynamic-schema-ai] Dinamik akış senkronizasyonu atlandı:', err)
  }

  const finalSchema = await getStudioSchema()
  return {
    summary:
      String(plan.summary || '').trim() ||
      `${createdTableCount} yeni liste ve ${createdRelationCount} bağlantı eklendi.`,
    modelUsed,
    createdTableCount,
    createdRelationCount,
    schema: finalSchema,
  }
}
