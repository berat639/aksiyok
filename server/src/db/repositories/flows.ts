import { and, desc, eq } from 'drizzle-orm'
import { db } from '../client'
import { conversationFlows } from '../schema'
import { requireClinicId } from '../../tenancy/context'
import { getTransferConfirmationQuestion } from '../../services/transfer-triggers'
export { validateConversationFlow, type FlowValidationIssue, EXECUTABLE_ACTIONS, FLOW_EVENT_TRIGGERS } from '../../services/flow-validation'

export type FlowConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'regex'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'existsInTable'
  | 'notExistsInTable'
  | 'in'
  | 'isEmpty'
  | 'notEmpty'
  | 'intent'

export interface FlowConditionRule {
  field: string
  operator: FlowConditionOperator
  value?: string
  valueTo?: string
  fieldLabel?: string
  sourceTableId?: string
  sourceTableSlug?: string
  sourceTableName?: string
  sourceColumnId?: string
  sourceColumnSlug?: string
  sourceColumnName?: string
  sourceColumnType?: string
}

export interface FlowConditionGroup {
  logic: 'AND' | 'OR'
  rules: Array<FlowConditionRule | FlowConditionGroup>
}

export type FlowEventTrigger =
  | 'on_silence'
  | 'on_no_match'
  | 'on_transfer_fail'
  | 'on_call_end'
  | 'on_whatsapp_message'

export interface FlowNode {
  id: string
  type: 'START' | 'FIELD' | 'CONDITION' | 'ACTION' | 'END'
  position: { x: number; y: number }
  data: {
    label?: string
    // FIELD node
    fieldName?: string
    description?: string
    required?: boolean
    fieldType?: 'text' | 'number' | 'boolean' | 'phone' | 'email' | 'date' | 'time' | 'enum' | 'user'
    enumValues?: string[]
    allowMultipleSelection?: boolean
    // Dynamic table column metadata (FIELD & CONDITION)
    sourceTableId?: string
    sourceTableSlug?: string
    sourceTableName?: string
    sourceColumnId?: string
    sourceColumnSlug?: string
    sourceColumnName?: string
    sourceColumnType?: string
    // CONDITION node (legacy + compound)
    conditionField?: string
    conditionFieldLabel?: string
    operator?: FlowConditionOperator
    conditionValue?: string
    conditionValueTo?: string
    conditionLogic?: 'AND' | 'OR'
    rules?: FlowConditionRule[]
    conditionGroup?: FlowConditionGroup
    // ACTION node
    action?: string
    targetTableId?: string
    targetTableSlug?: string
    targetTableName?: string
    message?: string
    variableName?: string
    variableValue?: string
    waitSeconds?: number
    promptInstruction?: string
    transferNumber?: string
    triggerKeywords?: string
    eventTrigger?: FlowEventTrigger
    requireConfirmation?: boolean
    confirmationQuestion?: string
  }
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  label?: string
}

export interface ConversationFlow {
  id: string
  name: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Legacy Flow Builder releases used display-oriented field names. The runtime
 * and appointment service use these stable canonical names exclusively.
 */
const LEGACY_FIELD_ALIASES: Record<string, string> = {
  ad_soyad: 'musteri_adi',
  hasta_adi: 'musteri_adi',
  hastaadisoyadi: 'musteri_adi',
  hastaAdiSoyadi: 'musteri_adi',
  hastatelefonu: 'telefon',
  hastaTelefonu: 'telefon',
  hastasikayeti: 'sikayet',
  hastaSikayeti: 'sikayet',
  randevutarihi: 'tarih',
  randevuTarihi: 'tarih',
  randevusaati: 'saat',
  randevuSaati: 'saat',
}

const LEGACY_CONDITION_ALIASES: Record<string, string> = {
  is_registered: 'kayitli',
}

const ISTANBUL_FLOW_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Istanbul',
  hour: 'numeric',
  hour12: false,
  weekday: 'short',
})

export function injectFlowSystemVariables(
  fields: Record<string, unknown> = {},
  ctx?: {
    direction?: string
    channel?: string
    silenceCount?: number
    durationSec?: number
    now?: Date
  },
): Record<string, unknown> {
  const now = ctx?.now ?? new Date()
  const istanbulParts = ISTANBUL_FLOW_TIME_FORMATTER.formatToParts(now)
  const hourStr = istanbulParts.find(p => p.type === 'hour')?.value ?? String(now.getHours())
  const hour = Number(hourStr) % 24
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const weekdayShort = istanbulParts.find(p => p.type === 'weekday')?.value ?? 'Mon'
  const weekday = weekdayMap[weekdayShort] ?? 1
  const isOpen = weekday >= 1 && weekday <= 6 && hour >= 9 && hour < 19

  const kayitliVal = fields['kayitli'] ?? fields['caller.isKnownPatient']
  const isKnown =
    kayitliVal !== undefined
      ? ['true', 'evet', '1'].includes(String(kayitliVal).toLocaleLowerCase('tr-TR'))
      : false

  return {
    ...fields,
    'caller.isKnownPatient': fields['caller.isKnownPatient'] ?? String(isKnown),
    'caller.isVip': fields['caller.isVip'] ?? 'false',
    'caller.hasUpcomingAppointment': fields['caller.hasUpcomingAppointment'] ?? 'false',
    'call.direction': ctx?.direction ?? fields['call.direction'] ?? 'inbound',
    'call.channel': ctx?.channel ?? fields['call.channel'] ?? 'phone',
    'call.silenceCount': String(ctx?.silenceCount ?? fields['call.silenceCount'] ?? 0),
    'call.durationSec': String(ctx?.durationSec ?? fields['call.durationSec'] ?? 0),
    'time.hour': String(fields['time.hour'] ?? hour),
    'time.weekday': String(fields['time.weekday'] ?? weekday),
    'clinic.isOpen': String(fields['clinic.isOpen'] ?? isOpen),
  }
}

export function renderFlowTemplate(template: string, fields: Record<string, unknown>): string {
  if (!template) return ''
  return template.replace(/\{\{\s*(?:fields\.)?([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key: string) => {
    const val = fields[key]
    return val !== undefined && val !== null ? String(val) : ''
  })
}

function isRuleGroup(item: FlowConditionRule | FlowConditionGroup): item is FlowConditionGroup {
  return 'logic' in item && Array.isArray((item as FlowConditionGroup).rules)
}

function parseComparableFlowValue(raw: string): number | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null

  const timeMatch = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (timeMatch) {
    return Number(timeMatch[1]) + Number(timeMatch[2]) / 60
  }

  const isoDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDate) {
    const ts = Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]))
    if (Number.isFinite(ts)) return ts
  }

  const trDate = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (trDate) {
    const ts = Date.UTC(Number(trDate[3]), Number(trDate[2]) - 1, Number(trDate[1]))
    if (Number.isFinite(ts)) return ts
  }

  const cleanedCurrency = trimmed.replace(/[₺$€£%\s]/g, '')
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleanedCurrency)) {
    const num = Number(cleanedCurrency.replace(/\./g, '').replace(',', '.'))
    if (Number.isFinite(num)) return num
  }
  const direct = Number(cleanedCurrency.replace(',', '.'))
  return Number.isFinite(direct) ? direct : null
}

const FLOW_WEEKDAY_TR_TO_NUM: Record<string, string> = {
  pazartesi: '1',
  pzt: '1',
  sali: '2',
  salı: '2',
  sal: '2',
  carsamba: '3',
  çarşamba: '3',
  car: '3',
  persembe: '4',
  perşembe: '4',
  per: '4',
  cuma: '5',
  cum: '5',
  cumartesi: '6',
  cmt: '6',
  pazar: '7',
  paz: '7',
}

function normalizeFlowWeekday(val: string): string {
  const low = val.trim().toLocaleLowerCase('tr-TR')
  return FLOW_WEEKDAY_TR_TO_NUM[low] ?? low
}

function resolveFieldValue(
  fields: Record<string, unknown>,
  field: string,
  sourceColumnId?: string,
  sourceTableId?: string,
): unknown {
  if (field && field in fields && fields[field] !== undefined) return fields[field]
  if ((sourceColumnId === '__row_exists__' || field.endsWith('____kayitli')) && sourceTableId) {
    const tblKey = `_tbl_exists__${sourceTableId}`
    if (tblKey in fields && fields[tblKey] !== undefined) return fields[tblKey]
  }
  if (sourceColumnId && sourceColumnId !== '__row_exists__') {
    const colKey = `_col__${sourceColumnId}`
    if (colKey in fields && fields[colKey] !== undefined) return fields[colKey]
    const colKeyLow = colKey.toLowerCase()
    for (const key of Object.keys(fields)) {
      if (key.toLowerCase() === colKeyLow && fields[key] !== undefined) return fields[key]
    }
  }
  if (field === 'caller.isKnownPatient' && fields['kayitli'] !== undefined) return fields['kayitli']
  if (field === 'kayitli' && fields['caller.isKnownPatient'] !== undefined) return fields['caller.isKnownPatient']
  if (field === 'saat' && fields['time.hour'] !== undefined) return fields['time.hour']
  if (field === 'time.hour' && fields['saat'] !== undefined) return fields['saat']
  const low = field.toLowerCase()
  if (low) {
    for (const key of Object.keys(fields)) {
      if (key.toLowerCase() === low && fields[key] !== undefined) return fields[key]
    }
  }
  return undefined
}

export function evaluateConditionRule(
  rule: FlowConditionRule,
  fields: Record<string, unknown>,
  intentMatchedByAi?: boolean,
): boolean {
  const field = String(rule.field || '').trim()
  const op = rule.operator || 'equals'
  const rawVal = resolveFieldValue(fields, field, rule.sourceColumnId, rule.sourceTableId)
  const listValues = Array.isArray(rawVal)
    ? rawVal.map(v => String(v ?? '').trim()).filter(Boolean)
    : null
  const actual = listValues ? listValues.join(', ') : String(rawVal ?? '').trim()
  const expected = String(rule.value ?? '').trim()
  const expectedTo = String(rule.valueTo ?? '').trim()

  if (field === 'user_intent' || op === 'intent') {
    if (typeof intentMatchedByAi === 'boolean') return intentMatchedByAi
    if (!actual) return false
    const actualLow = actual.toLocaleLowerCase('tr-TR')
    if (['true', 'evet', '1', 'var'].includes(actualLow)) return true
    if (['false', 'hayır', 'hayir', '0', 'yok'].includes(actualLow)) return false
    const expectedWords = expected.toLocaleLowerCase('tr-TR').split(/[\s,;:.!?]+/).filter(w => w.length >= 3)
    return expectedWords.some(w => actualLow.includes(w)) || actualLow.includes(expected.toLocaleLowerCase('tr-TR'))
  }

  const actualLow = field === 'time.weekday' ? normalizeFlowWeekday(actual) : actual.toLocaleLowerCase('tr-TR')
  const expectedLow = field === 'time.weekday' ? normalizeFlowWeekday(expected) : expected.toLocaleLowerCase('tr-TR')
  const listLow = listValues
    ? listValues.map(v => (field === 'time.weekday' ? normalizeFlowWeekday(v) : v.toLocaleLowerCase('tr-TR')))
    : null

  switch (op) {
    case 'isEmpty':
      return listLow ? listLow.length === 0 : actual.length === 0
    case 'notEmpty':
      return listLow ? listLow.length > 0 : actual.length > 0
    case 'existsInTable': {
      const flag =
        (rule.sourceColumnId ? fields[`_col_exists__${rule.sourceColumnId}`] : undefined) ??
        fields[`_exists__${field}`]
      if (flag !== undefined) {
        return ['true', 'evet', '1', 'var'].includes(String(flag).trim().toLocaleLowerCase('tr-TR'))
      }
      return false
    }
    case 'notExistsInTable': {
      const flag =
        (rule.sourceColumnId ? fields[`_col_exists__${rule.sourceColumnId}`] : undefined) ??
        fields[`_exists__${field}`]
      if (flag !== undefined) {
        return !['true', 'evet', '1', 'var'].includes(String(flag).trim().toLocaleLowerCase('tr-TR'))
      }
      return true
    }
    case 'contains':
      return listLow ? listLow.some(v => v.includes(expectedLow)) : actualLow.includes(expectedLow)
    case 'notContains':
      return listLow ? listLow.every(v => !v.includes(expectedLow)) : !actualLow.includes(expectedLow)
    case 'startsWith':
      return actualLow.startsWith(expectedLow)
    case 'endsWith':
      return actualLow.endsWith(expectedLow)
    case 'regex': {
      if (!expected) return false
      try {
        return new RegExp(expected, 'i').test(actual)
      } catch {
        return false
      }
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const aNum = parseComparableFlowValue(actual)
      const eNum = parseComparableFlowValue(expected)
      if (aNum === null || eNum === null) return false
      if (op === 'gt') return aNum > eNum
      if (op === 'gte') return aNum >= eNum
      if (op === 'lt') return aNum < eNum
      return aNum <= eNum
    }
    case 'between': {
      const aNum = parseComparableFlowValue(actual)
      let parts = expectedTo ? [expected, expectedTo] : expected.split(/\s*[,;]\s*/)
      if (parts.length < 2 && /^\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?$/.test(expected)) {
        parts = expected.split(/\s*-\s*/)
      }
      const low = parseComparableFlowValue(parts[0] ?? '')
      const high = parseComparableFlowValue(parts[1] ?? '')
      if (aNum === null || low === null || high === null) return false
      return aNum >= Math.min(low, high) && aNum <= Math.max(low, high)
    }
    case 'in': {
      const items = expected
        .split(/[,;|]+/)
        .map(s => (field === 'time.weekday' ? normalizeFlowWeekday(s) : s.trim().toLocaleLowerCase('tr-TR')))
        .filter(Boolean)
      if (listLow) return listLow.some(v => items.includes(v))
      if (items.includes(actualLow)) return true
      if (actualLow.includes(',')) {
        const actualParts = actualLow.split(/[,;|]+/).map(s => s.trim()).filter(Boolean)
        return actualParts.some(p => items.includes(p))
      }
      return false
    }
    case 'notEquals': {
      const truthy = ['true', 'evet', '1', 'var']
      const falsy = ['false', 'hayır', 'hayir', '0', 'yok']
      if (truthy.includes(expectedLow)) return !truthy.includes(actualLow)
      if (falsy.includes(expectedLow)) return !falsy.includes(actualLow)
      if (listLow) return !listLow.includes(expectedLow)
      const aComparable = parseComparableFlowValue(actual)
      const eComparable = parseComparableFlowValue(expected)
      if (aComparable !== null && eComparable !== null) return aComparable !== eComparable
      if (aComparable === null && !expectedLow.includes(',') && actualLow.includes(',')) {
        const actualParts = actualLow.split(/[,;|]+/).map(s => s.trim()).filter(Boolean)
        if (actualParts.length > 1) return !actualParts.includes(expectedLow)
      }
      return actualLow !== expectedLow
    }
    case 'equals':
    default: {
      const truthy = ['true', 'evet', '1', 'var']
      const falsy = ['false', 'hayır', 'hayir', '0', 'yok']
      if (truthy.includes(expectedLow) && truthy.includes(actualLow)) return true
      if (falsy.includes(expectedLow) && falsy.includes(actualLow)) return true
      if (listLow) return listLow.includes(expectedLow)
      const aComparable = parseComparableFlowValue(actual)
      const eComparable = parseComparableFlowValue(expected)
      if (aComparable !== null && eComparable !== null) return aComparable === eComparable
      if (aComparable === null && !expectedLow.includes(',') && actualLow.includes(',')) {
        const actualParts = actualLow.split(/[,;|]+/).map(s => s.trim()).filter(Boolean)
        if (actualParts.length > 1) return actualParts.includes(expectedLow)
      }
      return actualLow === expectedLow
    }
  }
}

export function evaluateConditionGroup(
  group: FlowConditionGroup,
  fields: Record<string, unknown>,
  intentMatchedByAi?: boolean,
): boolean {
  if (!group.rules || group.rules.length === 0) return false
  const evalItem = (item: FlowConditionRule | FlowConditionGroup): boolean =>
    isRuleGroup(item)
      ? evaluateConditionGroup(item, fields, intentMatchedByAi)
      : evaluateConditionRule(item, fields, intentMatchedByAi)
  return group.logic === 'OR' ? group.rules.some(evalItem) : group.rules.every(evalItem)
}

export function evaluateConditionNode(
  node: FlowNode,
  rawFields: Record<string, unknown>,
  intentMatchedByAi?: boolean,
  ctx?: { direction?: string; channel?: string; silenceCount?: number; durationSec?: number },
): boolean {
  const fields = injectFlowSystemVariables(rawFields, ctx)
  if (node.data.conditionGroup && Array.isArray(node.data.conditionGroup.rules) && node.data.conditionGroup.rules.length > 0) {
    return evaluateConditionGroup(node.data.conditionGroup, fields, intentMatchedByAi)
  }
  if (Array.isArray(node.data.rules) && node.data.rules.length > 0) {
    return evaluateConditionGroup(
      { logic: node.data.conditionLogic === 'OR' ? 'OR' : 'AND', rules: node.data.rules },
      fields,
      intentMatchedByAi,
    )
  }
  return evaluateConditionRule(
    {
      field: String(node.data.conditionField || ''),
      operator: node.data.operator || 'equals',
      value: node.data.conditionValue,
      valueTo: node.data.conditionValueTo,
      sourceColumnId: node.data.sourceColumnId,
      sourceColumnType: node.data.sourceColumnType,
    },
    fields,
    intentMatchedByAi,
  )
}

function normalizeFlowNodes(nodes: FlowNode[]): { nodes: FlowNode[]; changed: boolean } {
  let changed = false
  const normalized = nodes.map(node => {
    const data = { ...node.data }
    if (
      node.type === 'FIELD' &&
      data.fieldName &&
      !data.sourceTableId &&
      !data.sourceColumnId &&
      !data.fieldName.includes('__')
    ) {
      const canonical = LEGACY_FIELD_ALIASES[data.fieldName] ?? LEGACY_FIELD_ALIASES[data.fieldName.toLowerCase()]
      if (canonical && canonical !== data.fieldName) {
        data.fieldName = canonical
        changed = true
      }
    }
    if (
      node.type === 'CONDITION' &&
      data.conditionField &&
      !data.sourceTableId &&
      !data.sourceColumnId &&
      !data.conditionField.includes('__')
    ) {
      const canonical = LEGACY_CONDITION_ALIASES[data.conditionField] ?? LEGACY_CONDITION_ALIASES[data.conditionField.toLowerCase()]
      if (canonical && canonical !== data.conditionField) {
        data.conditionField = canonical
        changed = true
      }
    }
    return changed || data !== node.data ? { ...node, data } : node
  })
  return { nodes: normalized, changed }
}

export function getTransferPromptConfig(data: Record<string, unknown>) {
  const target = String(data.transferNumber || '')
  const keywords = String(data.triggerKeywords || '')
  const keywordList = keywords.split(/[,;|\n]+/).map(value => value.trim()).filter(Boolean)
  const requiresConfirmation = data.requireConfirmation !== false
  const confirmationQuestion = typeof data.confirmationQuestion === 'string'
    ? data.confirmationQuestion.trim()
    : ''

  const questionInstruction = confirmationQuestion
    ? `yalnızca ${JSON.stringify(confirmationQuestion)} diye sor`
    : keywordList.length > 0
      ? `eşleşen ifadeye ait şu soruyu sor: ${keywordList.map(keyword =>
        `${JSON.stringify(keyword)} için ${JSON.stringify(getTransferConfirmationQuestion({ keyword, target }))}`,
      ).join('; ')}`
      : `yalnızca ${JSON.stringify(getTransferConfirmationQuestion({ keyword: '', target }))} diye sor`

  return { target, keywords, requiresConfirmation, questionInstruction }
}

function toIso(d: Date | null | undefined): string {
  return d ? d.toISOString() : ''
}

export function buildDefaultWebFlow(): ConversationFlow {
  const nowIso = new Date().toISOString()
  return {
    id: 'default-web-flow',
    name: 'Hızlı Web Randevu Akışı (2 Soru)',
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    nodes: [
      { id: 'start', type: 'START', position: { x: 260, y: 20 }, data: { label: 'Web Karşılama Mesajı' } },
      { id: 'field_musteri_adi', type: 'FIELD', position: { x: 260, y: 140 }, data: { label: 'Hasta Adı ve Soyadı', fieldName: 'musteri_adi', fieldType: 'text', description: 'Randevunuz için adınızı, soyadınızı ve telefon numaranızı alabilir miyim?', required: true } },
      { id: 'field_tel', type: 'FIELD', position: { x: 260, y: 270 }, data: { label: 'Telefon Numarası', fieldName: 'telefon', fieldType: 'text', description: 'Size ulaşabileceğimiz telefon numaranızı alabilir miyim?', required: true } },
      { id: 'field_tarih', type: 'FIELD', position: { x: 260, y: 400 }, data: { label: 'Randevu Tarihi', fieldName: 'tarih', fieldType: 'date', description: 'Hangi gün ve saat için randevu oluşturmamı istersiniz?', required: true } },
      { id: 'field_saat', type: 'FIELD', position: { x: 260, y: 530 }, data: { label: 'Randevu Saati', fieldName: 'saat', fieldType: 'time', description: 'Saat kaç sizin için uygundur?', required: true } },
      { id: 'action_randevu', type: 'ACTION', position: { x: 260, y: 660 }, data: { action: 'save_appointment_pending', label: '📝 Randevu Talebi Oluştur (Onay Bekler)' } },
      { id: 'end', type: 'END', position: { x: 260, y: 790 }, data: { label: 'Görüşmeyi Bitir', message: 'Randevu talebiniz alındı, sağlıklı günler dileriz.' } },
    ],
    edges: [
      { id: 'e_s_ad', source: 'start', target: 'field_musteri_adi' },
      { id: 'e_ad_tel', source: 'field_musteri_adi', target: 'field_tel' },
      { id: 'e_tel_tar', source: 'field_tel', target: 'field_tarih' },
      { id: 'e_tar_saat', source: 'field_tarih', target: 'field_saat' },
      { id: 'e_saat_act', source: 'field_saat', target: 'action_randevu' },
      { id: 'e_act_end', source: 'action_randevu', target: 'end' },
    ],
  }
}

function collectFlowTableIds(nodes: FlowNode[]): string[] {
  const ids = new Set<string>()
  for (const n of nodes) {
    const srcId = typeof n.data?.sourceTableId === 'string' ? n.data.sourceTableId.trim() : ''
    if (srcId) ids.add(srcId)
    const tgtId = typeof n.data?.targetTableId === 'string' ? n.data.targetTableId.trim() : ''
    if (tgtId) ids.add(tgtId)
    for (const r of n.data?.rules || []) {
      const rSrc = typeof r.sourceTableId === 'string' ? r.sourceTableId.trim() : ''
      if (rSrc) ids.add(rSrc)
    }
  }
  return Array.from(ids)
}

export async function getActiveFlow(
  direction: string = 'inbound',
  explicitClinicId?: string,
  opts?: { skipAutoSync?: boolean },
): Promise<ConversationFlow | null> {
  const clinicId = explicitClinicId ?? requireClinicId()
  let rows = await db
    .select()
    .from(conversationFlows)
    .where(and(eq(conversationFlows.clinicId, clinicId), eq(conversationFlows.isActive, true), eq(conversationFlows.direction, direction)))
    .orderBy(desc(conversationFlows.updatedAt))
    .limit(1)

  if (!opts?.skipAutoSync) {
    const [{ dynamicTables }, dynRepo] = await Promise.all([
      import('../schema'),
      import('./dynamic-tables'),
    ])
    const current = rows[0]
    let needsSync = !current || dynRepo.LEGACY_SEED_FLOW_NAMES.has(current.name)

    if (!needsSync && current && current.name === dynRepo.DYNAMIC_AUTO_TEMPLATE_FLOW_NAME) {
      const normalizedCur = normalizeFlowNodes((current.nodes as FlowNode[]) || [])
      const referencedIds = collectFlowTableIds(normalizedCur.nodes).filter(
        (id) => id !== dynRepo.VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID,
      )
      if (referencedIds.length > 0) {
        const liveTables = await db
          .select({ id: dynamicTables.id })
          .from(dynamicTables)
          .where(eq(dynamicTables.clinicId, clinicId))
        const liveSet = new Set(liveTables.map((t) => t.id))
        if (referencedIds.some((id) => !liveSet.has(id))) {
          needsSync = true
        }
      }
    }

    if (needsSync) {
      try {
        const syncRes = await dynRepo.syncClinicFlowsWithDynamicTables(clinicId, {
          forceRebuild: false,
          directions: [direction],
        })
        if (syncRes.updated > 0) {
          rows = await db
            .select()
            .from(conversationFlows)
            .where(and(eq(conversationFlows.clinicId, clinicId), eq(conversationFlows.isActive, true), eq(conversationFlows.direction, direction)))
            .orderBy(desc(conversationFlows.updatedAt))
            .limit(1)
        }
      } catch (err) {
        console.warn('[flows] Dinamik akış senkronizasyonu hatası:', err)
      }
    }
  }

  if (rows.length === 0) {
    if (direction === 'web') return buildDefaultWebFlow()
    return null
  }
  const r = rows[0]
  const normalized = normalizeFlowNodes(r.nodes as FlowNode[])
  if (normalized.changed) {
    await db.update(conversationFlows)
      .set({ nodes: normalized.nodes, updatedAt: new Date() })
      .where(eq(conversationFlows.id, r.id))
  }
  let hydratedNodes = normalized.nodes
  try {
    const { hydrateFlowFieldDynamicOptions } = await import('./dynamic-tables')
    const liveMeta = await hydrateFlowFieldDynamicOptions(hydratedNodes, clinicId)
    if (liveMeta.size > 0) {
      hydratedNodes = hydratedNodes.map(node => {
        const meta = liveMeta.get(node.id)
        if (!meta) return node
        const nextData = { ...node.data, sourceColumnType: meta.columnType }
        if (meta.options.length > 0) {
          nextData.enumValues = meta.options
          if (meta.columnType === 'multiselect') {
            if (!nextData.fieldType) nextData.fieldType = 'enum'
          } else if (!nextData.fieldType || nextData.fieldType === 'text' || nextData.fieldType === 'enum') {
            nextData.fieldType = 'enum'
          }
        }
        return { ...node, data: nextData }
      })
    }
  } catch {
    // Canlı seçenek zenginleştirmesi başarısız olursa mevcut düğüm verisi korunur
  }
  return {
    id: r.id,
    name: r.name,
    nodes: hydratedNodes,
    edges: r.edges as FlowEdge[],
    isActive: r.isActive,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  }
}

export async function saveFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  direction: string = 'inbound',
  explicitClinicId?: string,
): Promise<ConversationFlow> {
  const clinicId = explicitClinicId ?? requireClinicId()
  const normalized = normalizeFlowNodes(nodes)
  nodes = normalized.nodes
  const existing = await getActiveFlow(direction, clinicId, { skipAutoSync: true })
  await db
    .update(conversationFlows)
    .set({ isActive: false })
    .where(and(
      eq(conversationFlows.clinicId, clinicId),
      eq(conversationFlows.direction, direction),
      eq(conversationFlows.isActive, true),
    ))
  if (existing && !existing.id.startsWith('default-')) {
    const [updated] = await db
      .update(conversationFlows)
      .set({ name: 'main', nodes, edges, isActive: true, updatedAt: new Date() })
      .where(eq(conversationFlows.id, existing.id))
      .returning()
    return {
      id: updated.id,
      name: updated.name,
      nodes: updated.nodes as FlowNode[],
      edges: updated.edges as FlowEdge[],
      isActive: updated.isActive,
      createdAt: toIso(updated.createdAt),
      updatedAt: toIso(updated.updatedAt),
    }
  }
  const [inserted] = await db
    .insert(conversationFlows)
    .values({ clinicId, name: 'main', nodes, edges, direction })
    .returning()
  return {
    id: inserted.id,
    name: inserted.name,
    nodes: inserted.nodes as FlowNode[],
    edges: inserted.edges as FlowEdge[],
    isActive: inserted.isActive,
    createdAt: toIso(inserted.createdAt),
    updatedAt: toIso(inserted.updatedAt),
  }
}

export function getFieldNodes(flow: ConversationFlow): FlowNode[] {
  return flow.nodes.filter(n => n.type === 'FIELD' && n.data.fieldName)
}

export function isMinimalGreetingEndFlow(flow: ConversationFlow): boolean {
  const start = flow.nodes.find(n => n.type === 'START')
  if (!start) return false
  const nodeMap = new Map(flow.nodes.map(n => [n.id, n]))
  const edgeMap = new Map<string, FlowEdge[]>()
  for (const edge of flow.edges) {
    const list = edgeMap.get(edge.source) || []
    list.push(edge)
    edgeMap.set(edge.source, list)
  }
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    for (const edge of edgeMap.get(id) || []) visit(edge.target)
  }
  visit(start.id)
  const reachable = [...visited].map(id => nodeMap.get(id)).filter(Boolean) as FlowNode[]
  return reachable.length > 0 && reachable.every(n => n.type === 'START' || n.type === 'END')
}

export function flowToToolFields(flow: ConversationFlow): {
  properties: Record<string, { type: string; description: string; enum?: string[] }>
  required: string[]
} {
  const properties: Record<string, { type: string; description: string; enum?: string[] }> = {}
  const requiredSet = new Set<string>()
  for (const node of getFieldNodes(flow)) {
    const originalName = node.data.fieldName!
    const safeName = originalName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()

    if (properties[safeName]) continue
    const readableTitle =
      node.data.sourceTableName && node.data.sourceColumnName
        ? `${node.data.sourceTableName} · ${node.data.sourceColumnName}`
        : node.data.label || originalName
    const typeHint =
      node.data.fieldType === 'date'
        ? ' (YYYY-MM-DD tarih formatında)'
        : node.data.fieldType === 'time'
          ? ' (SS:DD 24 saat formatında)'
          : node.data.fieldType === 'boolean'
            ? ' (Evet ise "true", Hayır ise "false")'
            : node.data.fieldType === 'number'
              ? ' (yalnızca sayısal değer)'
              : ''
    const isMultiOption =
      node.data.sourceColumnType === 'multiselect' ||
      (node.data.fieldType !== 'enum' && Boolean(node.data.enumValues?.length))
    const optionsHint = isMultiOption && node.data.enumValues?.length
      ? ` (Seçenekler: ${node.data.enumValues.join(', ')})`
      : ''
    const prop: { type: string; description: string; enum?: string[] } = {
      type: 'STRING',
      description: node.data.description
        ? `${readableTitle} (${originalName}): ${node.data.description}${typeHint}${optionsHint}`
        : `${readableTitle} (${originalName})${typeHint}${optionsHint}`,
    }
    if (!isMultiOption && node.data.fieldType === 'enum' && node.data.enumValues?.length) {
      prop.enum = node.data.enumValues
    }
    properties[safeName] = prop
    if (node.data.required) requiredSet.add(safeName)
  }
  return { properties, required: [...requiredSet] }
}

const OPERATOR_LABELS: Record<string, string> = {
  equals: '==',
  notEquals: '!=',
  contains: 'içeriyorsa',
  notContains: 'içermiyorsa',
  startsWith: 'ile başlıyorsa',
  endsWith: 'ile bitiyorsa',
  regex: 'regex eşleşiyorsa',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  between: 'arasındaysa',
  existsInTable: 'tabloda kayıtlıysa',
  notExistsInTable: 'tabloda kayıtlı değilse',
  in: 'listesindeyse',
  isEmpty: 'boşsa',
  notEmpty: 'boş değilse',
  intent: 'niyetini taşıyorsa',
}

function formatRuleText(r: FlowConditionRule): string {
  if (r.sourceColumnId === '__row_exists__' || r.field.endsWith('____kayitli')) {
    const valLow = String(r.value ?? 'true').trim().toLowerCase()
    const expectsMatch = (r.operator !== 'notEquals') === (valLow !== 'false' && valLow !== 'hayır')
    const tableLabel = r.sourceTableName || r.fieldLabel || r.field
    return `"${tableLabel}" tablosunda arayan numara/kayıt ${expectsMatch ? 'kayıtlı ise' : 'kayıtlı değilse'} (${r.field}, gerekirse veriTablosuSorgula aracını kullan)`
  }
  const fieldTitle =
    r.sourceTableName && r.sourceColumnName
      ? `${r.sourceTableName} · ${r.sourceColumnName} (${r.field})`
      : r.fieldLabel
        ? `${r.fieldLabel} (${r.field})`
        : r.field
  const opLabel = OPERATOR_LABELS[r.operator] || r.operator
  if (r.operator === 'existsInTable' || r.operator === 'notExistsInTable') {
    return `"${fieldTitle}" ${opLabel} (gerekirse veriTablosuSorgula aracını kullan)`
  }
  if (r.operator === 'isEmpty' || r.operator === 'notEmpty') return `"${fieldTitle}" ${opLabel}`
  if (r.operator === 'between') return `"${fieldTitle}" ${r.value || ''} ile ${r.valueTo || ''} ${opLabel}`
  return `"${fieldTitle}" ${opLabel} "${r.value || ''}"`
}

export function flowToPromptText(flow: ConversationFlow): string {
  if (flow.nodes.length === 0) return ''

  const lines: string[] = [
    'KONUŞMA AKIŞI VE TALİMATLARI:',
    '⚠️ SIRA VE BEKLEME KURALI: Her adımda yalnızca TEK BİR soru sor. Her sorudan sonra DUR ve müşterinin konuşmasını/cevabını bekle; müşteri yanıt vermeden KESİNLİKLE bir sonraki adıma geçme.',
    '⚡ HIZLI GEÇİŞ VE TEKRARSIZ SORU KURALI (SUNUM & CANLI GÖRÜŞME OPTİMİZASYONU): Müşteri konuşmasında aşağıdaki adımlardaki bilgilerden birini veya birkaçını (ör. işlem/şikayet, gün/tarih, saat, ad-soyad veya telefon) ZATEN söylediyse o adımı KESİNLİKLE tekrar sorma; bilinen adımları atlayıp yalnızca eksik kalan ilk bilgiyi sor. "tarih" ve "saat" peş peşe geliyorsa ve ikisi de bilinmiyorsa ayrı ayrı sormak yerine tek cümlede ("Hangi gün ve saat için randevu oluşturmamı istersiniz?") birlikte sor.',
    '',
  ]
  const nodeMap = new Map(flow.nodes.map(n => [n.id, n]))
  const edgeMap = new Map<string, FlowEdge[]>()
  for (const e of flow.edges) {
    const list = edgeMap.get(e.source) || []
    list.push(e)
    edgeMap.set(e.source, list)
  }

  const startNode = flow.nodes.find(n => n.type === 'START')
  if (!startNode) return ''

  let step = 1
  const visited = new Set<string>()

  function traverse(nodeId: string, indent: number, pathVisited: Set<string> = new Set()) {
    if (step > 80) return
    const node = nodeMap.get(nodeId)
    if (!node) return
    const prefix = '  '.repeat(indent)

    if (pathVisited.has(nodeId)) {
      lines.push(`${prefix}${step}. Döngü: "${node.data.fieldName || node.data.label || nodeId}" adımına geri dön ve müşterinin konuşmasını bekle.`)
      step++
      return
    }
    visited.add(nodeId)
    const nextPath = new Set(pathVisited)
    nextPath.add(nodeId)

    switch (node.type) {
      case 'START':
        lines.push(`${prefix}${step}. Karşılama mesajını söyleyerek söze başla.`)
        lines.push(`${prefix}   ↳ Müşterinin konuşmasını bekle ve ne söylediğini dinle.`)
        step++
        break
      case 'FIELD': {
        const readableField =
          node.data.sourceTableName && node.data.sourceColumnName
            ? `${node.data.sourceTableName} · ${node.data.sourceColumnName} (${node.data.fieldName})`
            : node.data.label && node.data.label !== node.data.fieldName
              ? `${node.data.label} (${node.data.fieldName})`
              : String(node.data.fieldName || '')
        const questionHint = node.data.description
          ? `: "${node.data.description}"`
          : ` — "${node.data.label || node.data.fieldName}" bilgisini doğal bir Türkçe soruyla iste.`
        lines.push(`${prefix}${step}. "${readableField}" bilgisini sor${node.data.required ? ' (zorunlu)' : ''}${questionHint}`)
        lines.push(`${prefix}   ↳ Müşterinin konuşmasını ve cevabını bekle; cevap almadan sıradaki adıma geçme.`)
        step++
        break
      }
      case 'CONDITION': {
        const field = node.data.conditionField
        const val = node.data.conditionValue || ''
        if (Array.isArray(node.data.rules) && node.data.rules.length > 0) {
          const joiner = node.data.conditionLogic === 'OR' ? ' VEYA ' : ' VE '
          lines.push(`${prefix}${step}. KOŞUL (${node.data.conditionLogic || 'AND'}): ${node.data.rules.map(formatRuleText).join(joiner)} ise:`)
        } else if (field === 'user_intent' || node.data.operator === 'intent') {
          lines.push(`${prefix}${step}. KOŞUL (KULLANICI NİYETİ): Kullanıcının ifadesi "${val}" niyetini taşıyorsa:`)
        } else if (field === 'kayitli' || field === 'caller.isKnownPatient') {
          const isRegisteredExpected = val.toLowerCase() !== 'false' && val.toLowerCase() !== 'hayır'
          lines.push(`${prefix}${step}. KOŞUL (KİŞİ KAYIT DURUMU): musteriSorgula sonucuna göre kişi sistemde ${isRegisteredExpected ? 'kayıtlı ise (kayitli=true)' : 'kayıtlı değilse (kayitli=false)'}:`)
        } else {
          const singleRuleText = formatRuleText({
            field: String(field || ''),
            operator: node.data.operator || 'equals',
            value: val,
            valueTo: node.data.conditionValueTo,
            fieldLabel: node.data.conditionFieldLabel,
            sourceTableId: node.data.sourceTableId,
            sourceTableName: node.data.sourceTableName,
            sourceColumnId: node.data.sourceColumnId,
            sourceColumnName: node.data.sourceColumnName,
          })
          lines.push(`${prefix}${step}. KOŞUL: ${singleRuleText} ise:`)
        }
        step++
        const edges = edgeMap.get(nodeId) || []
        const trueEdge = edges.find(e => e.sourceHandle === 'true')
        const falseEdge = edges.find(e => e.sourceHandle === 'false')
        if (trueEdge) {
          lines.push(`${prefix}  - Evet (Yeşil Yol):`)
          traverse(trueEdge.target, indent + 2, nextPath)
        }
        if (falseEdge) {
          lines.push(`${prefix}  - Hayır (Kırmızı Yol):`)
          traverse(falseEdge.target, indent + 2, nextPath)
        }
        return
      }
      case 'ACTION': {
        const actionData = node.data as Record<string, unknown>
        const act = actionData.action
        if (act === 'transfer_call') {
          const { target, keywords, requiresConfirmation, questionInstruction } = getTransferPromptConfig(actionData)
          if (requiresConfirmation) {
            lines.push(`${prefix}${step}. ARAMAYI ONAYLA VE AKTAR: Önce kullanıcıya ${questionInstruction} ve müşterinin cevabını bekle. Açık bir olumlu cevap gelmeden aramaAktar aracını çağırma veya aktardığını söyleme. Kullanıcı onaylarsa aramaAktar aracını çağır ve "hedef" parametresine "${target}" değerini yaz.${keywords ? ` Bu kural "${keywords}" tetikleyici ifadeleri için geçerlidir.` : ''}`)
          } else {
            lines.push(`${prefix}${step}. ARAMAYI AKTAR: ŞU AN aramaAktar aracını çağır ve "hedef" parametresine "${target}" değerini yaz.${keywords ? ` Müşteri "${keywords}" ifadelerinden birini söylerse de derhal aktar.` : ''}`)
          }
        } else if (act === 'send_wa_message') {
          const message = (node.data as Record<string, unknown>).message || ''
          lines.push(`${prefix}${step}. WHATSAPP YANITI: Kullanıcıya şu mesajı yanıt olarak yaz: ${JSON.stringify(message)}. Bu adımda randevu oluşturma.`)
        } else if (act === 'send_wa_location') {
          lines.push(`${prefix}${step}. ARAYANA WHATSAPP KONUMU GÖNDER: Kullanıcı konum, adres veya yol tarifi istediğinde whatsappKonumGonder aracını çağır. Araç başarılı olursa konumun WhatsApp'tan gönderildiğini söyle.`)
        } else if (act === 'save_patient_note' || act === 'notBirak') {
          lines.push(`${prefix}${step}. MÜŞTERİDEN NOT AL: Karşı tarafın yanıtını / mesajını hastaNotKaydet aracını çağırarak kaydet.`)
        } else if (act === 'end_call') {
          const msg = (node.data as Record<string, unknown>).message || ''
          lines.push(`${prefix}${step}. BİLGİ VER VE BİTİR: ${msg ? `"${msg}" diyerek ` : ''}cagriySonlandir aracını çağır.`)
        } else if (act === 'set_variable') {
          lines.push(`${prefix}${step}. DEĞİŞKEN ATA: "${actionData.variableName || ''}" alanına "${actionData.variableValue || ''}" değerini ata ve devam et.`)
        } else if (act === 'send_sms') {
          lines.push(`${prefix}${step}. SMS GÖNDER: Müşteriye "${actionData.message || ''}" içerikli bilgilendirme SMS'ini ilet.`)
        } else if (act === 'wait_reprompt' || act === 'wait') {
          lines.push(`${prefix}${step}. BEKLE / YENİDEN SOR: "${actionData.message || 'Sizi dinliyorum, nasıl yardımcı olabilirim?'}" cümlesiyle müşteriyi yönlendir.`)
          lines.push(`${prefix}   ↳ Müşterinin konuşmasını ve cevabını bekle.`)
        } else if (act === 'switch_prompt') {
          lines.push(`${prefix}${step}. MOD / TALİMAT DEĞİŞTİR: Bundan sonraki konuşmada şu talimata göre davran: "${actionData.promptInstruction || actionData.message || ''}".`)
        } else if (act === 'save_record') {
          const tblNote = actionData.targetTableName ? ` (${actionData.targetTableName})` : ''
          const targetIdHint = actionData.targetTableId ? ` ("hedef_tablo_id": "${actionData.targetTableId}")` : ''
          lines.push(`${prefix}${step}. VERİ TABLOSUNA KAYDET${tblNote}: Toplanan tablo alanlarını kaydetmek için veriTablosunaKaydet${targetIdHint} aracını çağır (akış motoru aktifse sistem otomatik kaydeder) ve akışa devam et.`)
        } else {
          lines.push(`${prefix}${step}. RANDEVU OLUŞTUR: Toplanan bilgilerle randevuOlustur aracını çağır.`)
        }
        step++
        break
      }
      case 'END': {
        const endMsg = typeof node.data.message === 'string' ? node.data.message.trim() : ''
        lines.push(`${prefix}${step}. ${endMsg ? `"${endMsg}" diyerek görüşmeyi` : 'Görüşmeyi'} nazikçe tamamla ve veda et.`)
        step++
        return
      }
    }

    const edges = edgeMap.get(nodeId) || []
    for (const e of edges) {
      traverse(e.target, indent, nextPath)
    }
  }

  traverse(startNode.id, 0)

  // ── Global Tetikleyiciler & Olay Düğümleri ──
  const globalActions = flow.nodes.filter(n => n.type === 'ACTION' && ((n.data as any).triggerKeywords || (n.data as any).eventTrigger))
  if (globalActions.length > 0) {
    lines.push('\n⚡ GLOBAL TETİKLEYİCİLER (Görüşmenin HERHANGİ bir anında geçerlidir):')
    for (const node of globalActions) {
      const actionData = node.data as Record<string, unknown>
      const act = actionData.action
      const ev = actionData.eventTrigger as string | undefined

      if (ev === 'on_silence') {
        lines.push(`- [SESSİZLİK OLAYI] Müşteri sessiz kaldığında: ${actionData.message ? `"${actionData.message}" de` : 'nazikçe tekrar sor'}.`)
      } else if (ev === 'on_no_match') {
        lines.push(`- [ANLAŞILAMAMA OLAYI] Müşterinin cevabı anlaşılamadığında: ${actionData.message ? `"${actionData.message}" de` : 'kısaca tekrar etmesini rica et'}.`)
      } else if (ev === 'on_transfer_fail') {
        lines.push(`- [AKTARIM HATASI OLAYI] Aktarım yapılamazsa: ${actionData.message ? `"${actionData.message}" diyerek` : ''} hastaNotKaydet ile iletişim notu al.`)
      }

      if (act === 'transfer_call' && actionData.triggerKeywords) {
        const { target, keywords, requiresConfirmation, questionInstruction } = getTransferPromptConfig(actionData)
        if (requiresConfirmation) {
          lines.push(`- Eğer müşteri "${keywords}" ifadelerinden birini kullanır veya bu ifadelerden belirgin bir parça söylerse, akışı kes ve ${questionInstruction}. Açıkça olumlu cevap gelmeden aramaAktar aracını çağırma veya aktardığını söyleme. Onay gelince aramaAktar aracını çağır ve "hedef" parametresini "${target}" yap.`)
        } else {
          lines.push(`- Eğer müşteri "${keywords}" ifadelerinden birini kullanırsa, akışı derhal kesip aramaAktar aracını çağır ve "hedef" parametresini "${target}" yap.`)
        }
      } else if (act === 'send_wa_location' && actionData.triggerKeywords) {
        const keywords = String(actionData.triggerKeywords || '')
        lines.push(`- Eğer müşteri "${keywords}" ifadelerini kullanır veya konum/adres/yol tarifi isterse, akışı derhal kesip whatsappKonumGonder aracını çağır. Başarılı sonuçtan sonra konumu WhatsApp'tan gönderdiğini söyle.`)
      } else if (act === 'end_call' && actionData.triggerKeywords) {
        const keywords = String(actionData.triggerKeywords || '')
        const msg = (node.data as Record<string, unknown>).message || ''
        lines.push(`- Eğer müşteri "${keywords}" ifadelerini kullanırsa, akışı derhal kesip cagriySonlandir() aracını çağır. ${msg ? `Öncesinde "${msg}" de.` : ''}`)
      }
    }
  }

  const unvisitedRoots = flow.nodes.filter(n => !visited.has(n.id) && !flow.edges.some(e => e.target === n.id) && !(n.type === 'ACTION' && ((n.data as any).triggerKeywords || (n.data as any).eventTrigger)))
  for (const root of unvisitedRoots) {
    if (root.type !== 'END') {
      lines.push(`\nBAĞIMSIZ AKIŞ KURALI:`)
      traverse(root.id, 0)
    }
  }

  if (isMinimalGreetingEndFlow(flow)) {
    lines.push(`\nMİNİMAL AKIŞ KURALI:\nKarşılama mesajını yalnızca bir kez söyle. Sonra karşı tarafın konuşmasını bekle; kendiliğinden randevu, talep, tarih, saat veya başka soru sorma. Karşı taraf işletmeyle ilgili bir soru sorarsa yalnızca o soruya kısa cevap ver ve yeni konu başlatma. Karşı taraf konu dışına çıkarsa ilk seferde nazikçe işletme/randevu konusuna yönlendir; konu dışına devam ederse "Yardımcı olabileceğim başka bir işleminiz yoksa görüşmeyi sonlandırıyorum, iyi günler." deyip cagriySonlandir aracını çağır.`)
  } else {
    const outgoing = edgeMap.get(startNode.id) || []
    if (outgoing.length === 0) {
      lines.push(`\nGENEL İLETİŞİM VE KONU DIŞI KURALI:
Karşılama mesajını söyledikten sonra müşterinin işletme, hizmet ve randevu sorularına doğal, samimi ve net cevaplar ver. Ancak karşı taraf konu dışı sohbet açar veya konuyu dağıtıp vakit kaybettirirse:
1) İlk seferde nazikçe "Size yalnızca işletmemiz ve randevu işlemleriniz konusunda yardımcı olabilirim, randevu veya bilgi talebiniz var mı?" diyerek konuya yönlendir.
2) Karşı taraf ikinci kez konu dışına çıkar veya alakasız konuşmaya devam ederse sohbeti KESİNLİKLE uzatma; "Yardımcı olabileceğim başka bir işleminiz yoksa görüşmemizi sonlandırıyorum, iyi günler dilerim." de ve cagriySonlandir aracını çağır.`)
    } else {
      lines.push(`\nGENEL İLETİŞİM VE KONU DIŞI KURALI:
Akış adımlarını takip ederken karşı taraf işletmeyle ilgili bir soru sorarsa kısaca yanıtlayıp mevcut akış adımına dön. Karşı taraf konu dışı bir başlık açar veya konuyu dağıtırsa ilk seferde nazikçe mevcut randevu/işlem adımına yönlendir; üst üste ikinci kez konu dışına çıkarsa "Yardımcı olabileceğim başka bir işleminiz yoksa görüşmemizi sonlandırıyorum, iyi günler." deyip cagriySonlandir aracını çağır.`)
    }
  }

  return lines.join('\n')
}
