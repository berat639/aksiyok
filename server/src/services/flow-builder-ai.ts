import {
  buildFlowDynamicFieldKey,
  getStudioSchema,
} from '../db/repositories/dynamic-tables'
import { recordAiTokenUsage } from '../db/repositories/ai-usage'
import {
  getActiveFlow,
  saveFlow,
  type ConversationFlow,
  type FlowConditionOperator,
  type FlowConditionRule,
  type FlowEdge,
  type FlowEventTrigger,
  type FlowNode,
} from '../db/repositories/flows'
import {
  FLOW_DIRECTIONS,
  appendFlowAiTurn,
  listFlowAiMessages,
  type FlowAiMessageDto,
  type FlowDirection,
} from '../db/repositories/flow-ai-chat'
import {
  EXECUTABLE_ACTIONS,
  FLOW_EVENT_TRIGGERS,
  validateConversationFlow,
  type FlowValidationIssue,
} from './flow-validation'
import { getGeminiClient } from './gemini-client'
import { currentBusinessTemplate, requireClinicId } from '../tenancy/context'

const VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID = '__appointment_calendar__'
const VIRTUAL_APPOINTMENT_DATE_COL_ID = '__appt_date__'
const VIRTUAL_APPOINTMENT_TIME_COL_ID = '__appt_time__'

type StudioSchemaSnapshot = Awaited<ReturnType<typeof getStudioSchema>>
type StudioTableSnapshot = StudioSchemaSnapshot['tables'][number]
type StudioColumnSnapshot = StudioTableSnapshot['columns'][number]

export interface RawAiFlowRule {
  field?: string
  operator?: string
  value?: string
  valueTo?: string
  fieldLabel?: string
  sourceTableId?: string
  sourceColumnId?: string
}

export interface RawAiFlowNode {
  id?: string
  type?: string
  label?: string
  fieldName?: string
  description?: string
  required?: boolean
  fieldType?: string
  enumValues?: string[]
  sourceTableId?: string
  sourceColumnId?: string
  conditionField?: string
  conditionFieldLabel?: string
  operator?: string
  conditionValue?: string
  conditionValueTo?: string
  conditionLogic?: string
  rules?: RawAiFlowRule[]
  action?: string
  targetTableId?: string
  message?: string
  variableName?: string
  variableValue?: string
  promptInstruction?: string
  transferNumber?: string
  triggerKeywords?: string
  eventTrigger?: string
  requireConfirmation?: boolean
  confirmationQuestion?: string
}

export interface RawAiFlowEdge {
  id?: string
  source?: string
  target?: string
  sourceHandle?: string
  label?: string
}

export interface AiFlowBuilderPlan {
  reply: string
  shouldUpdateFlow: boolean
  changeSummary?: string
  nodes?: RawAiFlowNode[]
  edges?: RawAiFlowEdge[]
}

const VALID_OPERATORS = new Set<FlowConditionOperator>([
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'regex',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'existsInTable',
  'notExistsInTable',
  'in',
  'isEmpty',
  'notEmpty',
  'intent',
])

const VALID_FIELD_TYPES = new Set([
  'text',
  'number',
  'boolean',
  'phone',
  'email',
  'date',
  'time',
  'enum',
  'user',
])

const DIRECTION_LABELS: Record<FlowDirection, string> = {
  inbound: 'Telefon Santral — Gelen Arama Asistanı',
  outbound: 'Telefon Santral — Giden Arama Asistanı',
  web: 'Web Tarayıcı Sesli Asistanı',
  whatsapp: 'WhatsApp Mesaj Asistanı',
}

const DIRECTION_ALLOWED_ACTIONS: Record<FlowDirection, Set<string>> = {
  inbound: new Set([
    'save_appointment_pending',
    'save_patient_note',
    'save_record',
    'set_variable',
    'send_sms',
    'wait_reprompt',
    'switch_prompt',
    'transfer_call',
    'send_wa_location',
    'end_call',
  ]),
  outbound: new Set([
    'save_appointment_pending',
    'save_patient_note',
    'save_record',
    'set_variable',
    'send_sms',
    'wait_reprompt',
    'switch_prompt',
    'transfer_call',
    'send_wa_location',
    'end_call',
  ]),
  web: new Set([
    'save_appointment_pending',
    'save_patient_note',
    'save_record',
    'set_variable',
    'send_sms',
    'wait_reprompt',
    'switch_prompt',
    'end_call',
  ]),
  whatsapp: new Set([
    'send_wa_message',
    'save_appointment_pending',
    'save_patient_note',
    'save_record',
    'set_variable',
    'send_sms',
    'wait_reprompt',
    'switch_prompt',
  ]),
}

export const FLOW_BUILDER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description:
        'Kullanıcıya gösterilecek samimi, anlaşılır, sade Türkçe yanıt. Asla teknik terim, kod adı, değişken adı (örn. caller.isVip) veya == != gibi operatörler yazma.',
    },
    shouldUpdateFlow: {
      type: 'boolean',
      description:
        'Kullanıcı yeni akış kurmak, akışı değiştirmek, adım/koşul/işlem eklemek veya düzeltmek istediyse true; yalnızca soru sorduysa ve grafik değişmeyecekse false.',
    },
    changeSummary: {
      type: 'string',
      description:
        'Yapılan akış değişikliğini özetleyen 1 kısa Türkçe cümle (shouldUpdateFlow true ise zorunlu).',
    },
    nodes: {
      type: 'array',
      description: 'shouldUpdateFlow true olduğunda eksiksiz konuşma akışı adımları listesi.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Benzersiz kısa adım kimliği (ör. start, sor_ad, kosul_kayitli, islem_randevu, end).' },
          type: {
            type: 'string',
            enum: ['START', 'FIELD', 'CONDITION', 'ACTION', 'END'],
            description: 'Düğüm türü: START=Karşılama, FIELD=Bilgi Al (Soru), CONDITION=Koşul (Evet/Hayır), ACTION=İşlem Yap, END=Görüşmeyi Bitir.',
          },
          label: { type: 'string', description: 'Görsel kutuda görünecek kısa Türkçe başlık.' },
          fieldName: { type: 'string', description: 'FIELD adımı için alan anahtarı (tablo bağlantısı varsa tablo_sutun anahtarı, yoksa snake_case).' },
          description: { type: 'string', description: 'FIELD adımı için asistanın kullanıcıya soracağı doğal Türkçe soru cümlesi.' },
          required: { type: 'boolean' },
          fieldType: {
            type: 'string',
            enum: ['text', 'number', 'boolean', 'phone', 'email', 'date', 'time', 'enum', 'user'],
          },
          enumValues: { type: 'array', items: { type: 'string' } },
          sourceTableId: { type: 'string', description: 'Bağlı Dinamik Tablo ID veya randevu tarih/saat için __appointment_calendar__.' },
          sourceColumnId: { type: 'string', description: 'Bağlı Sütun ID veya __appt_date__ / __appt_time__ / __row_exists__.' },
          conditionField: { type: 'string', description: 'CONDITION adımı için kontrol edilecek alan (kayitli, user_intent, caller.isKnownPatient, clinic.isOpen vb. veya tablo alanı).' },
          conditionFieldLabel: { type: 'string' },
          operator: {
            type: 'string',
            enum: [
              'equals',
              'notEquals',
              'contains',
              'notContains',
              'startsWith',
              'endsWith',
              'gt',
              'gte',
              'lt',
              'lte',
              'between',
              'existsInTable',
              'notExistsInTable',
              'in',
              'isEmpty',
              'notEmpty',
              'intent',
            ],
          },
          conditionValue: { type: 'string' },
          conditionValueTo: { type: 'string' },
          conditionLogic: { type: 'string', enum: ['AND', 'OR'] },
          rules: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                operator: { type: 'string' },
                value: { type: 'string' },
                valueTo: { type: 'string' },
                fieldLabel: { type: 'string' },
                sourceTableId: { type: 'string' },
                sourceColumnId: { type: 'string' },
              },
              required: ['field', 'operator'],
            },
          },
          action: {
            type: 'string',
            enum: [
              'save_appointment_pending',
              'save_patient_note',
              'save_record',
              'set_variable',
              'send_sms',
              'wait_reprompt',
              'switch_prompt',
              'transfer_call',
              'send_wa_location',
              'send_wa_message',
              'end_call',
            ],
          },
          targetTableId: { type: 'string', description: 'ACTION=save_record olduğunda kaydedilecek tablo ID.' },
          message: { type: 'string', description: 'END veya ACTION (end_call, send_wa_message, send_sms, wait_reprompt) için Türkçe metin.' },
          variableName: { type: 'string' },
          variableValue: { type: 'string' },
          promptInstruction: { type: 'string' },
          transferNumber: { type: 'string' },
          triggerKeywords: { type: 'string', description: 'Global tetikleyici kelimeler (virgülle ayrılmış). Küresel tetikleyici düğüme kenar bağlanmaz.' },
          eventTrigger: {
            type: 'string',
            enum: ['on_silence', 'on_no_match', 'on_transfer_fail', 'on_call_end', 'on_whatsapp_message'],
          },
          requireConfirmation: { type: 'boolean' },
          confirmationQuestion: { type: 'string' },
        },
        required: ['id', 'type', 'label'],
      },
    },
    edges: {
      type: 'array',
      description: 'Düğümler arasındaki ok bağlantıları. CONDITION düğümünden mutlaka hem sourceHandle="true" hem sourceHandle="false" çıkmalıdır.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          source: { type: 'string' },
          target: { type: 'string' },
          sourceHandle: { type: 'string', description: 'CONDITION düğümü için "true" veya "false", diğerleri için boş bırak veya "default".' },
          label: { type: 'string' },
        },
        required: ['source', 'target'],
      },
    },
  },
  required: ['reply', 'shouldUpdateFlow'],
}

function sanitizeSlugId(raw: unknown, fallback: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return cleaned || fallback
}

function sanitizeFieldKey(raw: unknown, fallback: string): string {
  const trMap: Record<string, string> = {
    ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u',
    Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u',
  }
  const normalized = String(raw || '')
    .trim()
    .split('')
    .map(ch => trMap[ch] || ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return normalized || fallback
}

function mapColumnFieldType(
  fieldType: string,
): 'text' | 'number' | 'boolean' | 'phone' | 'email' | 'date' | 'enum' {
  switch (fieldType) {
    case 'number':
    case 'currency':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'phone':
      return 'phone'
    case 'email':
      return 'email'
    case 'date':
      return 'date'
    case 'select':
    case 'multiselect':
    case 'relation':
      return 'enum'
    default:
      return 'text'
  }
}

/**
 * Kullanıcıya dönen Türkçe metindeki olası teknik/kod ifadelerini sadeleştirir.
 */
export function sanitizeTurkishFlowText(raw: unknown): string {
  let text = String(raw || '').trim()
  if (!text) return ''

  const replacements: Array<[RegExp, string]> = [
    [/`+/g, ''],
    [/\bcaller\.isKnownPatient\b/gi, 'kayıtlı kişi durumu'],
    [/\bcaller\.isVip\b/gi, 'özel hat durumu'],
    [/\bcaller\.hasUpcomingAppointment\b/gi, 'yaklaşan randevu durumu'],
    [/\bclinic\.isOpen\b/gi, 'çalışma saatleri durumu'],
    [/\buser_intent\b/gi, 'konuşma niyeti'],
    [/\bsave_appointment_pending\b/gi, 'randevu talebi oluşturma'],
    [/\bsave_patient_note\b/gi, 'not kaydetme'],
    [/\bsave_record\b/gi, 'veri tablosuna kaydetme'],
    [/\btransfer_call\b/gi, 'yetkiliye aktarma'],
    [/\bsend_wa_location\b/gi, 'konum gönderme'],
    [/\bsend_wa_message\b/gi, 'WhatsApp mesajı gönderme'],
    [/\bsend_sms\b/gi, 'kısa mesaj gönderme'],
    [/\bend_call\b/gi, 'görüşmeyi sonlandırma'],
    [/\bwait_reprompt\b/gi, 'bekleyip tekrar sorma'],
    [/\bswitch_prompt\b/gi, 'konuşma tarzı değiştirme'],
    [/\bset_variable\b/gi, 'bilgi kaydetme'],
    [/!==|!=/g, ' eşit değilse '],
    [/===|==/g, ' eşitse '],
  ]

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement)
  }
  return text.replace(/\s{2,}/g, ' ').trim()
}

function findColumnMatch(
  studio: StudioSchemaSnapshot | null | undefined,
  tableId?: string,
  columnId?: string,
  fieldName?: string,
): { table: StudioTableSnapshot | 'virtual_appointment'; col: StudioColumnSnapshot | { id: string; slug: string; name: string; fieldType: string; isRequired?: boolean; config?: any } } | null {
  if (
    tableId === VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID ||
    columnId === VIRTUAL_APPOINTMENT_DATE_COL_ID ||
    columnId === VIRTUAL_APPOINTMENT_TIME_COL_ID ||
    fieldName === 'tarih' ||
    fieldName === 'saat'
  ) {
    if (columnId === VIRTUAL_APPOINTMENT_DATE_COL_ID || fieldName === 'tarih') {
      return {
        table: 'virtual_appointment',
        col: { id: VIRTUAL_APPOINTMENT_DATE_COL_ID, slug: 'tarih', name: 'Randevu Tarihi', fieldType: 'date', isRequired: true },
      }
    }
    if (columnId === VIRTUAL_APPOINTMENT_TIME_COL_ID || fieldName === 'saat') {
      return {
        table: 'virtual_appointment',
        col: { id: VIRTUAL_APPOINTMENT_TIME_COL_ID, slug: 'saat', name: 'Randevu Saati', fieldType: 'text', isRequired: true },
      }
    }
  }

  const tables = studio?.tables ?? []
  if (tableId && columnId) {
    const tbl = tables.find(t => t.id === tableId)
    const col = tbl?.columns.find(c => c.id === columnId)
    if (tbl && col) return { table: tbl, col }
  }
  if (columnId) {
    for (const tbl of tables) {
      const col = tbl.columns.find(c => c.id === columnId)
      if (col) return { table: tbl, col }
    }
  }
  if (fieldName) {
    for (const tbl of tables) {
      for (const col of tbl.columns) {
        if (buildFlowDynamicFieldKey(tbl.slug || tbl.name, col.slug || col.name) === fieldName) {
          return { table: tbl, col }
        }
      }
    }
  }
  return null
}

function normalizeConditionRule(
  raw: RawAiFlowRule,
  studio: StudioSchemaSnapshot | null | undefined,
): FlowConditionRule | null {
  const rawField = String(raw.field || '').trim()
  if (!rawField) return null
  const normalizedField =
    rawField === 'is_registered' || rawField === 'kayitli_mi'
      ? 'kayitli'
      : rawField
  const rawOp = String(raw.operator || 'equals').trim()
  const op: FlowConditionOperator = VALID_OPERATORS.has(rawOp as FlowConditionOperator)
    ? (rawOp as FlowConditionOperator)
    : 'equals'

  const rule: FlowConditionRule = {
    field: normalizedField,
    operator: op,
    ...(raw.value !== undefined ? { value: String(raw.value) } : {}),
    ...(raw.valueTo !== undefined ? { valueTo: String(raw.valueTo) } : {}),
    ...(raw.fieldLabel ? { fieldLabel: sanitizeTurkishFlowText(raw.fieldLabel) } : {}),
  }

  if (raw.sourceTableId && raw.sourceColumnId === '__row_exists__') {
    const tbl = studio?.tables.find(t => t.id === raw.sourceTableId)
    if (tbl) {
      rule.sourceTableId = tbl.id
      rule.sourceTableSlug = tbl.slug
      rule.sourceTableName = tbl.name
      rule.sourceColumnId = '__row_exists__'
      rule.sourceColumnSlug = '__row_exists__'
      rule.sourceColumnName = 'Bu tabloda kayıtlı mı?'
      rule.sourceColumnType = 'boolean'
      rule.field = `${tbl.slug}____kayitli`
      rule.fieldLabel = `${tbl.name} · Kayıtlı mı?`
      if (rule.value === undefined) rule.value = 'true'
    }
  } else {
    const match = findColumnMatch(studio, raw.sourceTableId, raw.sourceColumnId, normalizedField)
    if (match && match.table !== 'virtual_appointment') {
      rule.sourceTableId = match.table.id
      rule.sourceTableSlug = match.table.slug
      rule.sourceTableName = match.table.name
      rule.sourceColumnId = match.col.id
      rule.sourceColumnSlug = match.col.slug
      rule.sourceColumnName = match.col.name
      rule.sourceColumnType = match.col.fieldType
      rule.field = buildFlowDynamicFieldKey(match.table.slug || match.table.name, match.col.slug || match.col.name)
      if (!rule.fieldLabel) rule.fieldLabel = `${match.table.name} · ${match.col.name}`
    }
  }

  if ((rule.field === 'user_intent' || rule.operator === 'intent') && !String(rule.value || '').trim()) {
    rule.value = rule.fieldLabel || 'Kullanıcı talebi'
  }
  return rule
}

function normalizeActionForDirection(
  rawAction: string,
  direction: FlowDirection,
  rawNode: RawAiFlowNode,
): { convertToEnd?: boolean; action: string; label?: string; message?: string } {
  const allowed = DIRECTION_ALLOWED_ACTIONS[direction]
  let action = rawAction.trim()

  if (action === 'randevuOlustur') action = 'save_appointment_pending'
  if (action === 'notBirak') action = 'save_patient_note'
  if (action === 'wait') action = 'wait_reprompt'
  if (action === 'transfer') action = 'transfer_call'

  if (!EXECUTABLE_ACTIONS.has(action)) {
    action = direction === 'whatsapp' ? 'send_wa_message' : direction === 'outbound' ? 'save_patient_note' : 'save_appointment_pending'
  }

  if (!allowed.has(action)) {
    if (direction === 'whatsapp') {
      if (action === 'end_call') {
        return {
          convertToEnd: true,
          action: 'END',
          label: sanitizeTurkishFlowText(rawNode.label) || 'Görüşmeyi Bitir',
          message: sanitizeTurkishFlowText(rawNode.message) || 'Yardımcı olabileceğimiz başka bir konu olursa buradan yazabilirsiniz.',
        }
      }
      if (action === 'transfer_call') {
        return {
          action: 'save_patient_note',
          label: sanitizeTurkishFlowText(rawNode.label) || 'Yetkili Geri Dönüş Notu Al',
          message: sanitizeTurkishFlowText(rawNode.message) || 'Talebinizi ekip arkadaşlarımıza iletiyorum, size en kısa sürede buradan dönüş sağlanacaktır.',
        }
      }
      if (action === 'send_wa_location') {
        return {
          action: 'send_wa_message',
          label: sanitizeTurkishFlowText(rawNode.label) || 'Adres ve Konum Bilgisi Gönder',
          message: sanitizeTurkishFlowText(rawNode.message) || 'İşletmemizin açık adres ve konum bilgisini sizinle paylaşıyorum.',
        }
      }
    }
    if (direction === 'web') {
      if (action === 'transfer_call') {
        return {
          action: 'save_patient_note',
          label: sanitizeTurkishFlowText(rawNode.label) || 'Geri Arama Talebi Kaydet',
          message: sanitizeTurkishFlowText(rawNode.message) || 'Talebinizi kaydettim, yetkilimiz sizi telefonla arayacaktır.',
        }
      }
      if (action === 'send_wa_location' || action === 'send_wa_message') {
        return {
          action: 'save_patient_note',
          label: sanitizeTurkishFlowText(rawNode.label) || 'Bilgi ve Talep Notu Kaydet',
        }
      }
    }
    if ((direction === 'inbound' || direction === 'outbound') && action === 'send_wa_message') {
      return {
        action: 'send_sms',
        label: sanitizeTurkishFlowText(rawNode.label) || 'Bilgilendirme Mesajı Gönder',
        message: sanitizeTurkishFlowText(rawNode.message),
      }
    }
  }

  return { action }
}

/**
 * Yapay zekanın ürettiği ham adımları ve bağlantıları temiz, çalışan ve
 * hatasız bir FlowNode / FlowEdge grafiğine dönüştürür.
 */
export function sanitizeAndLayoutGeneratedFlow(input: {
  rawNodes: RawAiFlowNode[]
  rawEdges: RawAiFlowEdge[]
  direction: FlowDirection
  studio?: StudioSchemaSnapshot | null
}): { nodes: FlowNode[]; edges: FlowEdge[]; issues: FlowValidationIssue[] } {
  const { rawNodes, rawEdges, direction, studio } = input
  const tables = studio?.tables ?? []
  const idMap = new Map<string, string>()
  const usedIds = new Set<string>()
  const nodes: FlowNode[] = []

  let hasStart = false
  let nodeCounter = 1

  for (const raw of rawNodes) {
    if (!raw || typeof raw !== 'object') continue
    const rawType = String(raw.type || '').toUpperCase().trim()
    if (!['START', 'FIELD', 'CONDITION', 'ACTION', 'END'].includes(rawType)) continue

    if (rawType === 'START') {
      if (hasStart) continue
      hasStart = true
    }

    const originalId = String(raw.id || '').trim()
    let cleanId =
      rawType === 'START'
        ? 'start'
        : sanitizeSlugId(originalId, `step_${nodeCounter}`)
    while (usedIds.has(cleanId)) {
      cleanId = `${sanitizeSlugId(originalId, 'step')}_${nodeCounter++}`
    }
    usedIds.add(cleanId)
    if (originalId) idMap.set(originalId, cleanId)

    const label = sanitizeTurkishFlowText(raw.label) || (
      rawType === 'START'
        ? 'Karşılama Mesajı'
        : rawType === 'END'
          ? 'Görüşmeyi Bitir'
          : rawType === 'FIELD'
            ? 'Bilgi Al'
            : rawType === 'CONDITION'
              ? 'Koşul Kontrolü'
              : 'İşlem Yap'
    )

    if (rawType === 'START') {
      nodes.push({
        id: cleanId,
        type: 'START',
        position: { x: 240, y: 40 },
        data: { label },
      })
      continue
    }

    if (rawType === 'END') {
      const msg = sanitizeTurkishFlowText(raw.message)
      nodes.push({
        id: cleanId,
        type: 'END',
        position: { x: 240, y: 400 },
        data: {
          label,
          ...(msg ? { message: msg } : {}),
        },
      })
      continue
    }

    if (rawType === 'FIELD') {
      const match = findColumnMatch(studio, raw.sourceTableId, raw.sourceColumnId, raw.fieldName)
      if (match && match.table === 'virtual_appointment') {
        const isDate = match.col.id === VIRTUAL_APPOINTMENT_DATE_COL_ID
        nodes.push({
          id: cleanId,
          type: 'FIELD',
          position: { x: 240, y: 180 },
          data: {
            label: sanitizeTurkishFlowText(raw.label) || `Randevu Takvimi · ${match.col.name}`,
            fieldName: isDate ? 'tarih' : 'saat',
            fieldType: isDate ? 'date' : 'time',
            required: raw.required !== false,
            description:
              sanitizeTurkishFlowText(raw.description) ||
              (isDate ? 'Hangi gün için randevu oluşturmamı istersiniz?' : 'Saat kaç sizin için uygundur?'),
            sourceTableId: VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID,
            sourceTableSlug: 'randevu_takvimi',
            sourceTableName: 'Randevu Takvimi',
            sourceColumnId: match.col.id,
            sourceColumnSlug: match.col.slug,
            sourceColumnName: match.col.name,
            sourceColumnType: match.col.fieldType,
          },
        })
      } else if (match && match.table !== 'virtual_appointment') {
        const col = match.col
        const tbl = match.table
        const cfg = (col.config || {}) as { options?: Array<{ label?: string }>; helpText?: string }
        const colEnums = Array.isArray(cfg.options)
          ? cfg.options.map(o => String(o.label || '').trim()).filter(Boolean)
          : []
        const rawEnums = Array.isArray(raw.enumValues) ? raw.enumValues.map(s => String(s || '').trim()).filter(Boolean) : []
        const enumValues = colEnums.length > 0 ? colEnums : rawEnums
        nodes.push({
          id: cleanId,
          type: 'FIELD',
          position: { x: 240, y: 180 },
          data: {
            label: sanitizeTurkishFlowText(raw.label) || `${tbl.name} · ${col.name}`,
            fieldName: buildFlowDynamicFieldKey(tbl.slug || tbl.name, col.slug || col.name),
            fieldType: mapColumnFieldType(col.fieldType),
            required: raw.required !== undefined ? Boolean(raw.required) : col.isRequired !== false,
            description:
              sanitizeTurkishFlowText(raw.description) ||
              sanitizeTurkishFlowText(cfg.helpText) ||
              `${col.name} bilginizi paylaşabilir misiniz?`,
            ...(enumValues.length ? { enumValues } : {}),
            sourceTableId: tbl.id,
            sourceTableSlug: tbl.slug,
            sourceTableName: tbl.name,
            sourceColumnId: col.id,
            sourceColumnSlug: col.slug,
            sourceColumnName: col.name,
            sourceColumnType: col.fieldType,
          },
        })
      } else {
        const cleanFieldName = sanitizeFieldKey(raw.fieldName || label, `alan_${nodeCounter++}`)
        const rawFieldType = String(raw.fieldType || 'text').trim()
        const fieldType = VALID_FIELD_TYPES.has(rawFieldType)
          ? (rawFieldType as FlowNode['data']['fieldType'])
          : 'text'
        const enumValues = Array.isArray(raw.enumValues)
          ? raw.enumValues.map(v => sanitizeTurkishFlowText(v)).filter(Boolean)
          : []
        nodes.push({
          id: cleanId,
          type: 'FIELD',
          position: { x: 240, y: 180 },
          data: {
            label,
            fieldName: cleanFieldName,
            fieldType: enumValues.length > 0 && fieldType === 'text' ? 'enum' : fieldType,
            required: raw.required !== false,
            description: sanitizeTurkishFlowText(raw.description) || `${label} bilginizi öğrenebilir miyim?`,
            ...(enumValues.length > 0 ? { enumValues } : {}),
          },
        })
      }
      continue
    }

    if (rawType === 'CONDITION') {
      const normalizedRules = Array.isArray(raw.rules)
        ? raw.rules
            .map(r => normalizeConditionRule(r, studio))
            .filter((r): r is FlowConditionRule => Boolean(r))
        : []

      if (normalizedRules.length > 0) {
        const primaryRule = normalizedRules[0]
        nodes.push({
          id: cleanId,
          type: 'CONDITION',
          position: { x: 240, y: 260 },
          data: {
            label,
            conditionField: primaryRule.field,
            ...(primaryRule.fieldLabel ? { conditionFieldLabel: primaryRule.fieldLabel } : {}),
            operator: primaryRule.operator,
            conditionValue: primaryRule.value ?? '',
            ...(primaryRule.valueTo ? { conditionValueTo: primaryRule.valueTo } : {}),
            conditionLogic: raw.conditionLogic === 'OR' ? 'OR' : 'AND',
            rules: normalizedRules,
            ...(primaryRule.sourceTableId ? {
              sourceTableId: primaryRule.sourceTableId,
              sourceTableSlug: primaryRule.sourceTableSlug,
              sourceTableName: primaryRule.sourceTableName,
              sourceColumnId: primaryRule.sourceColumnId,
              sourceColumnSlug: primaryRule.sourceColumnSlug,
              sourceColumnName: primaryRule.sourceColumnName,
              sourceColumnType: primaryRule.sourceColumnType,
            } : {}),
          },
        })
      } else {
        const single = normalizeConditionRule(
          {
            field: raw.conditionField || (raw.operator === 'intent' ? 'user_intent' : 'kayitli'),
            operator: raw.operator || 'equals',
            value: raw.conditionValue ?? (raw.conditionField === 'kayitli' || !raw.conditionField ? 'true' : ''),
            valueTo: raw.conditionValueTo,
            fieldLabel: raw.conditionFieldLabel || label,
            sourceTableId: raw.sourceTableId,
            sourceColumnId: raw.sourceColumnId,
          },
          studio,
        )!
        nodes.push({
          id: cleanId,
          type: 'CONDITION',
          position: { x: 240, y: 260 },
          data: {
            label,
            conditionField: single.field,
            ...(single.fieldLabel ? { conditionFieldLabel: single.fieldLabel } : {}),
            operator: single.operator,
            conditionValue: single.value ?? '',
            ...(single.valueTo ? { conditionValueTo: single.valueTo } : {}),
            ...(single.sourceTableId ? {
              sourceTableId: single.sourceTableId,
              sourceTableSlug: single.sourceTableSlug,
              sourceTableName: single.sourceTableName,
              sourceColumnId: single.sourceColumnId,
              sourceColumnSlug: single.sourceColumnSlug,
              sourceColumnName: single.sourceColumnName,
              sourceColumnType: single.sourceColumnType,
            } : {}),
          },
        })
      }
      continue
    }

    if (rawType === 'ACTION') {
      const normalizedAct = normalizeActionForDirection(String(raw.action || ''), direction, raw)
      if (normalizedAct.convertToEnd) {
        nodes.push({
          id: cleanId,
          type: 'END',
          position: { x: 240, y: 400 },
          data: {
            label: normalizedAct.label || label,
            ...(normalizedAct.message ? { message: normalizedAct.message } : {}),
          },
        })
        continue
      }

      const actionData: FlowNode['data'] = {
        label: normalizedAct.label || label,
        action: normalizedAct.action,
      }

      const msg = sanitizeTurkishFlowText(normalizedAct.message ?? raw.message)
      if (msg) actionData.message = msg
      if (normalizedAct.action === 'save_record') {
        const targetTbl = tables.find(t => t.id === raw.targetTableId) || tables[0]
        if (targetTbl) {
          actionData.targetTableId = targetTbl.id
          actionData.targetTableSlug = targetTbl.slug
          actionData.targetTableName = targetTbl.name
        }
      }
      if (normalizedAct.action === 'set_variable') {
        actionData.variableName = sanitizeFieldKey(raw.variableName || 'durum', 'durum')
        actionData.variableValue = sanitizeTurkishFlowText(raw.variableValue || 'evet')
      }
      if (normalizedAct.action === 'switch_prompt' && raw.promptInstruction) {
        actionData.promptInstruction = sanitizeTurkishFlowText(raw.promptInstruction)
      }
      if (normalizedAct.action === 'transfer_call') {
        if (raw.transferNumber) actionData.transferNumber = String(raw.transferNumber).trim().slice(0, 40)
        actionData.requireConfirmation = raw.requireConfirmation !== false
        if (raw.confirmationQuestion) actionData.confirmationQuestion = sanitizeTurkishFlowText(raw.confirmationQuestion)
      }
      if (raw.triggerKeywords && typeof raw.triggerKeywords === 'string' && raw.triggerKeywords.trim()) {
        actionData.triggerKeywords = sanitizeTurkishFlowText(raw.triggerKeywords)
      }
      if (raw.eventTrigger && FLOW_EVENT_TRIGGERS.has(raw.eventTrigger)) {
        actionData.eventTrigger = raw.eventTrigger as FlowEventTrigger
      }

      nodes.push({
        id: cleanId,
        type: 'ACTION',
        position: { x: 240, y: 320 },
        data: actionData,
      })
    }
  }

  if (!hasStart) {
    nodes.unshift({
      id: usedIds.has('start') ? `start_${Date.now()}` : 'start',
      type: 'START',
      position: { x: 240, y: 40 },
      data: { label: 'Karşılama Mesajı' },
    })
  }

  let endNode = nodes.find(n => n.type === 'END')
  if (!endNode) {
    const endId = usedIds.has('end') ? `end_${nodeCounter++}` : 'end'
    endNode = {
      id: endId,
      type: 'END',
      position: { x: 240, y: 460 },
      data: { label: 'Görüşmeyi Bitir' },
    }
    nodes.push(endNode)
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const startNode = nodes.find(n => n.type === 'START')!

  // Bağlantıları normalize et
  const edges: FlowEdge[] = []
  const edgeSeen = new Set<string>()
  const outgoingByNode = new Map<string, FlowEdge[]>()

  for (let i = 0; i < rawEdges.length; i++) {
    const re = rawEdges[i]
    if (!re || typeof re !== 'object') continue
    const src = idMap.get(String(re.source || '').trim()) || String(re.source || '').trim()
    const tgt = idMap.get(String(re.target || '').trim()) || String(re.target || '').trim()
    if (!src || !tgt || src === tgt) continue
    const srcNode = nodeMap.get(src)
    const tgtNode = nodeMap.get(tgt)
    if (!srcNode || !tgtNode || srcNode.type === 'END') continue

    const curOut = outgoingByNode.get(src) || []
    if (srcNode.type === 'CONDITION') {
      let handle = re.sourceHandle === 'true' || re.sourceHandle === 'false' ? re.sourceHandle : ''
      const lblLow = String(re.label || '').toLocaleLowerCase('tr-TR')
      if (!handle) {
        if (/evet|doğru|true|kayıtlı/i.test(lblLow)) handle = 'true'
        else if (/hayır|yanlış|false|değil/i.test(lblLow)) handle = 'false'
        else if (!curOut.some(e => e.sourceHandle === 'true')) handle = 'true'
        else handle = 'false'
      }
      if (curOut.some(e => e.sourceHandle === handle)) continue
      const key = `${src}:${handle}->${tgt}`
      if (edgeSeen.has(key)) continue
      edgeSeen.add(key)
      const edge: FlowEdge = {
        id: `e_${src}_${handle}_${tgt}_${i}`,
        source: src,
        target: tgt,
        sourceHandle: handle,
        label: handle === 'true' ? 'Evet' : 'Hayır',
      }
      edges.push(edge)
      curOut.push(edge)
      outgoingByNode.set(src, curOut)
    } else {
      if (curOut.length >= 1) continue
      const key = `${src}->${tgt}`
      if (edgeSeen.has(key)) continue
      edgeSeen.add(key)
      const edge: FlowEdge = {
        id: `e_${src}_${tgt}_${i}`,
        source: src,
        target: tgt,
      }
      edges.push(edge)
      curOut.push(edge)
      outgoingByNode.set(src, curOut)
    }
  }

  // Koşul düğümlerinin eksik Evet/Hayır kollarını tamamla
  for (const node of nodes) {
    if (node.type !== 'CONDITION') continue
    const out = outgoingByNode.get(node.id) || []
    for (const handle of ['true', 'false'] as const) {
      if (!out.some(e => e.sourceHandle === handle)) {
        const edge: FlowEdge = {
          id: `e_${node.id}_${handle}_${endNode.id}`,
          source: node.id,
          target: endNode.id,
          sourceHandle: handle,
          label: handle === 'true' ? 'Evet' : 'Hayır',
        }
        edges.push(edge)
        out.push(edge)
        outgoingByNode.set(node.id, out)
      }
    }
  }

  // Başlangıç adımının mutlaka devam yolu olmasını sağla
  if ((outgoingByNode.get(startNode.id) || []).length === 0) {
    const firstNonTrigger = nodes.find(
      n =>
        n.id !== startNode.id &&
        !(n.type === 'ACTION' && ((n.data as any).triggerKeywords || (n.data as any).eventTrigger)),
    ) || endNode
    const edge: FlowEdge = {
      id: `e_${startNode.id}_${firstNonTrigger.id}`,
      source: startNode.id,
      target: firstNonTrigger.id,
    }
    edges.push(edge)
    outgoingByNode.set(startNode.id, [edge])
  }

  // Ana akıştaki çıkışsız FIELD/ACTION adımlarını sonraki adıma ya da Bitiş'e bağla
  for (const node of nodes) {
    if (node.type !== 'FIELD' && node.type !== 'ACTION') continue
    const isGlobalTrigger =
      node.type === 'ACTION' &&
      Boolean((node.data as any).triggerKeywords || ((node.data as any).eventTrigger && FLOW_EVENT_TRIGGERS.has(String((node.data as any).eventTrigger))))
    if (isGlobalTrigger) continue
    if ((outgoingByNode.get(node.id) || []).length === 0) {
      const edge: FlowEdge = {
        id: `e_${node.id}_${endNode.id}`,
        source: node.id,
        target: endNode.id,
      }
      edges.push(edge)
      outgoingByNode.set(node.id, [edge])
    }
  }

  // Basit ve temiz hiyerarşik konumlandırma (Frontend Dagre ile daha da ince hizalanır)
  const depthMap = new Map<string, number>([[startNode.id, 0]])
  const bfsQueue: string[] = [startNode.id]
  while (bfsQueue.length > 0) {
    const cur = bfsQueue.shift()!
    const curDepth = depthMap.get(cur) ?? 0
    for (const e of outgoingByNode.get(cur) || []) {
      if (!depthMap.has(e.target)) {
        depthMap.set(e.target, curDepth + 1)
        bfsQueue.push(e.target)
      }
    }
  }

  const levelBuckets = new Map<number, FlowNode[]>()
  const standaloneGlobals: FlowNode[] = []
  for (const node of nodes) {
    const isGlobal =
      node.type === 'ACTION' &&
      Boolean((node.data as any).triggerKeywords || (node.data as any).eventTrigger) &&
      !edges.some(e => e.source === node.id || e.target === node.id)
    if (isGlobal) {
      standaloneGlobals.push(node)
      continue
    }
    const lvl = depthMap.get(node.id) ?? 99
    const arr = levelBuckets.get(lvl) || []
    arr.push(node)
    levelBuckets.set(lvl, arr)
  }

  for (const [lvl, list] of levelBuckets.entries()) {
    const rowY = 40 + (lvl === 99 ? 4 : lvl) * 155
    const totalWidth = list.length * 300
    const startX = Math.max(40, Math.round(360 - totalWidth / 2))
    list.forEach((n, idx) => {
      n.position = { x: startX + idx * 300, y: rowY }
    })
  }
  standaloneGlobals.forEach((n, idx) => {
    n.position = { x: 760, y: 120 + idx * 145 }
  })

  const issues = validateConversationFlow(nodes, edges)
  return { nodes, edges, issues }
}

export function buildFlowBuilderContextPrompt(input: {
  direction: FlowDirection
  businessTemplate: string
  studio: StudioSchemaSnapshot | null | undefined
  currentFlow: { nodes: FlowNode[]; edges: FlowEdge[] }
}): string {
  const { direction, businessTemplate, studio, currentFlow } = input
  const tables = studio?.tables ?? []
  const apptConfigs = studio?.appointmentConfigs ?? []
  const apptByTable = new Map(apptConfigs.map(c => [c.tableId, c]))

  const tablesText =
    tables.length > 0
      ? tables
          .map(t => {
            const cfg = apptByTable.get(t.id)
            const roleTag = cfg?.enabled ? ` [Randevu Rolü: ${cfg.isRequiredInAppointment ? 'Zorunlu' : 'Opsiyonel'}]` : ''
            const cols = t.columns
              .filter(c => c.fieldType !== 'relation')
              .map(c => {
                const cCfg = (c.config || {}) as { options?: Array<{ label?: string }> }
                const opts = Array.isArray(cCfg.options)
                  ? cCfg.options.map(o => o.label).filter(Boolean).join(', ')
                  : ''
                return `  * Kolon ID="${c.id}" Ad="${c.name}" Tip=${c.fieldType} Anahtar="${buildFlowDynamicFieldKey(t.slug, c.slug)}"${opts ? ` Seçenekler=[${opts}]` : ''}`
              })
              .join('\n')
            return `- Tablo ID="${t.id}" Ad="${t.name}" Slug="${t.slug}"${roleTag}\n  * Özel Varlık Kontrolü Koşulu: sourceTableId="${t.id}", sourceColumnId="__row_exists__", field="${t.slug}____kayitli"\n${cols}`
          })
          .join('\n')
      : 'Henüz özel veri tablosu yok.'

  const compactFlow = {
    nodes: currentFlow.nodes.map(n => ({
      id: n.id,
      type: n.type,
      ...n.data,
    })),
    edges: currentFlow.edges.map(e => ({
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.label ? { label: e.label } : {}),
    })),
  }

  const directionGuide: Record<FlowDirection, string> = {
    inbound:
      'KANAL: Telefon (Santral) Gelen Arama. Arayan telefon numarası otomatik bilinir; kayıtlı müşteri kontrolü, randevu alma, not bırakma, yetkiliye aktarma (transfer_call) ve WhatsApp konum gönderme (send_wa_location) desteklenir.',
    outbound:
      'KANAL: Telefon (Santral) Giden Arama. Asistan arama yapar (memnuniyet anketi, randevu hatırlatma, bilgilendirme/geri dönüş); karşılama mutlaka arama amacını söylemelidir. Tüm telefon işlemleri desteklenir.',
    web:
      'KANAL: Web Tarayıcı Sesli Asistan. Santral aktarma (transfer_call) veya WhatsApp (send_wa_location/send_wa_message) KULLANILMAZ; kısa ve hızlı bilgi alma, randevu talebi, veri kaydetme veya talep notu bırakma tercih edilir.',
    whatsapp:
      'KANAL: WhatsApp Mesaj Asistanı. Müşteri yazılı mesaj/link gönderir. Telefon hattına özgü transfer_call, end_call ve send_wa_location YERİNE send_wa_message, save_appointment_pending, save_patient_note, save_record ve END düğümleri kullanılır.',
  }

  const templateNote =
    businessTemplate === 'dental_clinic'
      ? 'İŞLETME ŞABLONU: Klinik / Sağlık İşletmesi.'
      : 'İŞLETME ŞABLONU: Genel İşletme (sektör bağımsız: veri tablolarındaki terimleri esas al, asla alakasız klinik terimi uydurma).'

  return [
    `AKTİF ASİSTAN KANALI: ${DIRECTION_LABELS[direction]} (${direction})`,
    directionGuide[direction],
    templateNote,
    '',
    'RANDEVU TAKVİMİ SANAL ALANLARI (Randevu tarihi/saati istenecekse bu kimlikleri kullan):',
    `- Tarih: sourceTableId="${VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID}", sourceColumnId="${VIRTUAL_APPOINTMENT_DATE_COL_ID}", fieldName="tarih", fieldType="date"`,
    `- Saat: sourceTableId="${VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID}", sourceColumnId="${VIRTUAL_APPOINTMENT_TIME_COL_ID}", fieldName="saat", fieldType="time"`,
    '',
    'İŞLETMENİN MEVCUT DİNAMİK VERİ TABLOLARI:',
    tablesText,
    '',
    'BU ASİSTANIN MEVCUT AKIŞ ŞEMASI (Kullanıcı değişiklik isterse bunu temel alıp geliştir):',
    JSON.stringify(compactFlow),
  ].join('\n')
}

function buildSystemInstruction(direction: FlowDirection): string {
  return `Sen Türkçe konuşan uzman bir "Konuşma Akışı Tasarımcısı Asistanı"sın.
Görevin: Kullanıcının sohbet yoluyla anlattığı iş sürecine, şikayete veya soruna göre YALNIZCA şu an seçili olan asistan kanalı (${DIRECTION_LABELS[direction]}) için eksiksiz, sade ve çalışabilir konuşma akışı diyagramı tasarlamak veya mevcut akışı sohbet doğrultusunda güncellemektir.

KRİTİK KURALLAR:
1. SADECE BU ASİSTANI TASARLA: Diğer kanallarla (gelen/giden/web/whatsapp) karıştırma; yalnızca "${direction}" kanalına uygun adımları ve işlemleri kullan.
2. HER SEFERİNDE SADECE DOĞAL TÜRKÇE KONUŞ: Kullanıcıya verdiğin "reply" ve "changeSummary" metinlerinde ve düğüm "label" / "description" / "message" alanlarında ASLA teknik terim, kod adı, değişken adı (ör. caller.isVip, save_appointment_pending, user_intent), UUID veya == != > AND OR gibi operatörler yazma. İş kurallarını sade Türkçe cümlelerle anlat.
3. MEVCUT VERİ TABLOLARINI KULLAN: İşletmenin mevcut Dinamik Veri Tablolarında ilgili kolon varsa FIELD ve CONDITION düğümlerinde mutlaka gerçek "sourceTableId" ve "sourceColumnId" değerlerini kullan; yoksa anlamlı snake_case alan adı ver.
4. RANDEVU AKIŞI: Kullanıcı randevu/görüşme planlamak isterse tarih (sourceColumnId="__appt_date__") ve saat (sourceColumnId="__appt_time__") adımlarını ekleyip ardından action="save_appointment_pending" işlemine ve "END" adımına bağla.
5. KOŞUL DALLANMASI: Her CONDITION düğümünden mutlaka hem sourceHandle="true" (Evet) hem sourceHandle="false" (Hayır) çıkışı bağla. Niyet kontrolünde operator="intent", conditionField="user_intent" ve conditionValue kısmına kısa Türkçe niyet cümlesi yaz (ör. "Fiyat veya ücret bilgisi sormak istiyor").
6. HAFİF VE NET GRAFİK: Gereksiz düğüm kalabalığı yaratma; kullanıcının anlattığı ihtiyacı karşılayan en net 4 ila 12 düğümlük temiz bir akış üret.
7. Yalnızca kullanıcı genel bir soru sorduysa (ör. "Bu akışta eksiklik var mı?") shouldUpdateFlow=false döndür; senaryo anlattıysa, "şöyle olsun / ekle / değiştir / baştan kur" dediyse shouldUpdateFlow=true ve tam güncellenmiş nodes + edges listesini döndür.`
}

async function generatePlanWithGemini(input: {
  clinicId: string
  systemInstruction: string
  promptText: string
}): Promise<AiFlowBuilderPlan> {
  const client = await getGeminiClient(input.clinicId)
  const configuredPrimary =
    (process.env.GEMINI_FLOW_BUILDER_MODEL || process.env.GEMINI_SCHEMA_BUILDER_MODEL || '').trim() ||
    'gemini-3.1-flash-lite'
  const candidateModels = Array.from(
    new Set([
      configuredPrimary,
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-flash-lite-latest',
    ]),
  )

  let rawJsonText = ''
  let lastErr: unknown = null

  if (typeof (client as any)?.interactions?.create === 'function') {
    for (const modelName of candidateModels) {
      try {
        const interaction = await client.interactions.create({
          model: modelName,
          input: input.promptText,
          system_instruction: input.systemInstruction,
          store: false,
          generation_config: { temperature: 0.2 },
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: FLOW_BUILDER_JSON_SCHEMA,
          },
        })
        const fallbackJoinedText = Array.isArray((interaction as any)?.outputs)
          ? (interaction as any).outputs
              .filter((o: any) => o?.type === 'text' && typeof o?.text === 'string')
              .map((o: any) => o.text)
              .join('')
          : ''
        const outText =
          typeof (interaction as any)?.output_text === 'string' && (interaction as any).output_text.trim()
            ? (interaction as any).output_text
            : fallbackJoinedText
        if (typeof outText === 'string' && outText.trim()) {
          rawJsonText = outText.trim()
          const usage = (interaction as any)?.usage
          if (usage) {
            void recordAiTokenUsage({
              clinicId: input.clinicId,
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
  }

  if (!rawJsonText && typeof (client as any)?.models?.generateContent === 'function') {
    try {
      const genModel = (process.env.GEMINI_SIMULATION_MODEL || process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash').trim()
      const genRes = await client.models.generateContent({
        model: genModel,
        contents: [{ role: 'user', parts: [{ text: input.promptText }] }],
        config: {
          systemInstruction: input.systemInstruction,
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseJsonSchema: FLOW_BUILDER_JSON_SCHEMA,
        },
      })
      const txt = typeof genRes.text === 'string' ? genRes.text.trim() : ''
      if (txt) {
        rawJsonText = txt
        const meta = (genRes as any)?.usageMetadata
        if (meta) {
          void recordAiTokenUsage({
            clinicId: input.clinicId,
            source: 'simulator',
            promptTokens: Number(meta.promptTokenCount ?? 0),
            responseTokens: Number(meta.candidatesTokenCount ?? 0),
            totalTokens: Number(meta.totalTokenCount ?? 0),
            callCount: 1,
          }).catch(() => {})
        }
      }
    } catch (err) {
      lastErr = err
    }
  }

  if (!rawJsonText) {
    const errMsg = lastErr instanceof Error ? lastErr.message : 'Yapay zeka yanıt üretemedi'
    throw new Error(`Akış tasarımı üretilemedi: ${errMsg}`)
  }

  try {
    const cleaned = rawJsonText
      .replace(/^```json\s*/i, '')
      .replace(/```$/i, '')
      .trim()
    return JSON.parse(cleaned) as AiFlowBuilderPlan
  } catch {
    throw new Error('Yapay zeka çıktısı çözümlenemedi, lütfen isteğinizi biraz daha açık yazıp tekrar deneyin.')
  }
}

export async function runFlowBuilderChatTurn(
  input: {
    clinicId?: string
    userId?: string | null
    direction: FlowDirection
    message: string
    currentNodes?: FlowNode[]
    currentEdges?: FlowEdge[]
  },
  deps?: {
    generatePlan?: (ctx: {
      clinicId: string
      systemInstruction: string
      promptText: string
    }) => Promise<AiFlowBuilderPlan>
    studio?: StudioSchemaSnapshot | null
    businessTemplate?: string
  },
): Promise<{
  direction: FlowDirection
  reply: string
  appliedFlow: boolean
  changeSummary: string | null
  flow: ConversationFlow | null
  issues: FlowValidationIssue[]
  messages: FlowAiMessageDto[]
}> {
  const direction = input.direction
  if (!FLOW_DIRECTIONS.includes(direction)) {
    throw new Error('Geçersiz asistan kanalı.')
  }

  const message = String(input.message || '').trim()
  if (message.length < 2) {
    throw new Error('Lütfen istediğiniz akışı kısaca yazın.')
  }
  if (message.length > 2000) {
    throw new Error('Mesaj çok uzun (en fazla 2000 karakter).')
  }

  const clinicId = input.clinicId ?? requireClinicId()
  const [studio, existingMessages, persistedFlow] = await Promise.all([
    deps?.studio !== undefined ? Promise.resolve(deps.studio) : getStudioSchema(clinicId).catch(() => null),
    listFlowAiMessages(direction, clinicId, 20),
    getActiveFlow(direction, clinicId, { skipAutoSync: true }),
  ])

  const currentFlowNodes: FlowNode[] = Array.isArray(input.currentNodes) && input.currentNodes.length > 0
    ? input.currentNodes
    : (persistedFlow?.nodes ?? [
        { id: 'start', type: 'START', position: { x: 240, y: 40 }, data: { label: 'Karşılama Mesajı' } },
        { id: 'end', type: 'END', position: { x: 240, y: 240 }, data: { label: 'Görüşmeyi Bitir' } },
      ])
  const currentFlowEdges: FlowEdge[] = Array.isArray(input.currentEdges) && input.currentNodes?.length
    ? input.currentEdges
    : (persistedFlow?.edges ?? [{ id: 'e_start_end', source: 'start', target: 'end' }])

  const historyText =
    existingMessages.length > 0
      ? existingMessages
          .slice(-10)
          .map(m => `${m.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${m.content}`)
          .join('\n')
      : 'Henüz önceki sohbet mesajı yok.'

  const contextBlock = buildFlowBuilderContextPrompt({
    direction,
    businessTemplate: deps?.businessTemplate ?? currentBusinessTemplate(),
    studio,
    currentFlow: { nodes: currentFlowNodes, edges: currentFlowEdges },
  })

  const promptText = `${contextBlock}\n\nÖNCEKİ SOHBET GEÇMİŞİ (Sadece ${DIRECTION_LABELS[direction]}):\n${historyText}\n\nKULLANICININ YENİ MESAJI:\n${message}`
  const systemInstruction = buildSystemInstruction(direction)

  const plan = await (deps?.generatePlan ?? generatePlanWithGemini)({
    clinicId,
    systemInstruction,
    promptText,
  })

  const shouldUpdateFlow = Boolean(plan.shouldUpdateFlow && Array.isArray(plan.nodes) && plan.nodes.length > 0)
  let savedFlow: ConversationFlow | null = null
  let issues: FlowValidationIssue[] = []
  let changeSummary: string | null = null
  let reply = sanitizeTurkishFlowText(plan.reply) || (
    shouldUpdateFlow
      ? 'Konuşma akışınızı anlattığınız senaryoya göre hazırladım ve diyagrama uyguladım.'
      : 'İsteğiniz doğrultusunda yardımcı olmaya hazırım.'
  )

  if (shouldUpdateFlow) {
    const sanitized = sanitizeAndLayoutGeneratedFlow({
      rawNodes: plan.nodes || [],
      rawEdges: Array.isArray(plan.edges) ? plan.edges : [],
      direction,
      studio,
    })
    savedFlow = await saveFlow(sanitized.nodes, sanitized.edges, direction, clinicId)
    issues = sanitized.issues
    changeSummary =
      sanitizeTurkishFlowText(plan.changeSummary) ||
      `${sanitized.nodes.length} adımlı konuşma akışı güncellendi`
  }

  await appendFlowAiTurn({
    clinicId,
    direction,
    userContent: message,
    assistantContent: reply,
    appliedFlow: shouldUpdateFlow && Boolean(savedFlow),
    nodeCount: savedFlow ? savedFlow.nodes.length : null,
    edgeCount: savedFlow ? savedFlow.edges.length : null,
    changeSummary,
    previousFlow: shouldUpdateFlow
      ? { nodes: currentFlowNodes, edges: currentFlowEdges }
      : null,
    userId: input.userId ?? null,
  })

  const messages = await listFlowAiMessages(direction, clinicId)
  return {
    direction,
    reply,
    appliedFlow: Boolean(savedFlow),
    changeSummary,
    flow: savedFlow,
    issues,
    messages,
  }
}
