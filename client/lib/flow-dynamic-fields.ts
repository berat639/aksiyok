import type { DynamicColumnDef, DynamicFieldType, DynamicTableDef } from '@/app/admin/components/dynamic-tables/types'

export type FlowFieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'phone'
  | 'email'
  | 'date'
  | 'time'
  | 'enum'
  | 'user'

const TR_CHAR_MAP: Record<string, string> = {
  ğ: 'g',
  Ğ: 'g',
  ü: 'u',
  Ü: 'u',
  ş: 's',
  Ş: 's',
  ı: 'i',
  İ: 'i',
  ö: 'o',
  Ö: 'o',
  ç: 'c',
  Ç: 'c',
}

/**
 * Türkçe karakterleri ve boşlukları temizleyerek akış/araç şemasına uygun
 * küçük harfli ASCII tanımlayıcı üretir.
 */
export function sanitizeFlowSlug(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  let ascii = ''
  for (const ch of raw) {
    ascii += TR_CHAR_MAP[ch] ?? ch
  }
  return ascii
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Dinamik tablo ve sütun için çakışmasız akış alan anahtarı üretir.
 * Örn: ("musteriler", "ad_soyad") -> "musteriler__ad_soyad"
 */
export function buildDynamicFieldKey(tableSlugOrName: string, columnSlugOrName: string): string {
  const tSlug = sanitizeFlowSlug(tableSlugOrName) || 'tablo'
  const cSlug = sanitizeFlowSlug(columnSlugOrName) || 'alan'
  return `${tSlug}__${cSlug}`
}

/**
 * Kullanıcı arayüzünde gösterilecek temiz Türkçe etiket (asla ham değişken kodu içermez).
 * Örn: "Müşteriler · Ad Soyad"
 */
export function formatDynamicColumnDisplayLabel(tableName: string, columnName: string): string {
  const t = String(tableName || '').trim()
  const c = String(columnName || '').trim()
  if (t && c) return `${t} · ${c}`
  return c || t || 'Tablo Alanı'
}

const DYNAMIC_TABLE_ICON_EMOJI_MAP: Record<string, string> = {
  box: '📦',
  package: '📦',
  users: '👥',
  user: '👤',
  'user-check': '🧑‍⚕️',
  wrench: '🔧',
  tool: '🔧',
  'credit-card': '💳',
  wallet: '💳',
  banknote: '💵',
  clipboard: '📋',
  'clipboard-list': '📋',
  'file-text': '📄',
  'scroll-text': '📜',
  calendar: '📅',
  'calendar-check': '📅',
  phone: '📞',
  'phone-call': '📞',
  mail: '✉️',
  'message-square': '💬',
  heart: '❤️',
  'heart-pulse': '🩺',
  stethoscope: '🩺',
  activity: '📈',
  pill: '💊',
  'flask-conical': '🧪',
  syringe: '💉',
  star: '⭐',
  sparkles: '✨',
  award: '🏆',
  tag: '🏷️',
  tags: '🏷️',
  database: '📊',
  table: '📊',
  layers: '🗂️',
  folder: '📁',
  shield: '🛡️',
  'shield-check': '🛡️',
  building: '🏥',
  hospital: '🏥',
  'shopping-bag': '🛍️',
  'shopping-cart': '🛒',
  'check-circle': '✅',
  'check-square': '✅',
  clock: '🕒',
  home: '🏠',
  'building-2': '🏢',
  landmark: '🏛️',
  key: '🔑',
  car: '🚗',
  truck: '🚚',
  briefcase: '💼',
  headphones: '🎧',
  headset: '🎧',
  'clipboard-check': '📋',
  'user-plus': '👤',
  'file-check': '📄',
  coins: '🪙',
  receipt: '🧾',
}

/**
 * Dinamik tablo ikon alanındaki Lucide teknik anahtarlarını ('box', 'users' vb.)
 * arayüzde okunabilir emoji ikonuna dönüştürür. Asla ham ASCII anahtar döndürmez.
 */
export function formatDynamicTableIcon(icon?: string | null): string {
  const raw = String(icon || '').trim()
  if (!raw) return '📊'
  if (/^[a-z0-9_-]+$/i.test(raw)) {
    return DYNAMIC_TABLE_ICON_EMOJI_MAP[raw.toLowerCase()] || '📊'
  }
  return raw
}

export const DYNAMIC_TABLE_ROW_EXISTS_COL_ID = '__row_exists__'
export const VIRTUAL_APPOINTMENT_TABLE_ID = '__appointment_calendar__'
export const VIRTUAL_APPOINTMENT_DATE_COL_ID = '__appt_date__'
export const VIRTUAL_APPOINTMENT_TIME_COL_ID = '__appt_time__'

export const VIRTUAL_APPOINTMENT_TABLE: DynamicTableDef = {
  id: VIRTUAL_APPOINTMENT_TABLE_ID,
  clinicId: '',
  name: 'Randevu Takvimi',
  slug: 'randevu_takvimi',
  icon: 'calendar',
  color: '#0284c7',
  description: 'Randevu tarih ve saat slotları',
  canvasX: 0,
  canvasY: 0,
  sortOrder: 9999,
  rowCount: 0,
  archivedRowCount: 0,
  columns: [
    {
      id: VIRTUAL_APPOINTMENT_DATE_COL_ID,
      clinicId: '',
      tableId: VIRTUAL_APPOINTMENT_TABLE_ID,
      name: 'Randevu Tarihi',
      slug: 'tarih',
      fieldType: 'date',
      isPrimaryTitle: false,
      isRequired: true,
      isUnique: false,
      showInTable: true,
      width: 160,
      sortOrder: 0,
      config: {},
    },
    {
      id: VIRTUAL_APPOINTMENT_TIME_COL_ID,
      clinicId: '',
      tableId: VIRTUAL_APPOINTMENT_TABLE_ID,
      name: 'Randevu Saati',
      slug: 'saat',
      fieldType: 'text',
      isPrimaryTitle: false,
      isRequired: true,
      isUnique: false,
      showInTable: true,
      width: 140,
      sortOrder: 1,
      config: {},
    },
  ],
}

export function isVirtualAppointmentTable(tableId?: string | null): boolean {
  return tableId === VIRTUAL_APPOINTMENT_TABLE_ID
}

export function getSelectableFlowTables(
  tables: DynamicTableDef[] = [],
  includeAppointmentCalendar = true,
): DynamicTableDef[] {
  const base = Array.isArray(tables) ? tables : []
  if (!includeAppointmentCalendar) return base
  if (base.some(t => t.id === VIRTUAL_APPOINTMENT_TABLE_ID)) return base
  return [...base, VIRTUAL_APPOINTMENT_TABLE]
}

export function findSelectableFlowTable(
  tableId: string | undefined | null,
  tables: DynamicTableDef[] = [],
): DynamicTableDef | undefined {
  if (!tableId) return undefined
  if (tableId === VIRTUAL_APPOINTMENT_TABLE_ID) return VIRTUAL_APPOINTMENT_TABLE
  return (tables || []).find(t => t.id === tableId)
}

/**
 * Bir dinamik tabloda "arayan / kişi bu tabloda kayıtlı mı?" koşulu için
 * benzersiz alan anahtarı üretir. Örn: "musteriler" -> "musteriler____kayitli".
 */
export function buildDynamicTableExistsKey(tableSlugOrName: string): string {
  const tSlug = sanitizeFlowSlug(tableSlugOrName) || 'tablo'
  if (tableSlugOrName === VIRTUAL_APPOINTMENT_TABLE_ID || tSlug === 'randevu_takvimi') {
    return 'caller.hasUpcomingAppointment'
  }
  return `${tSlug}____kayitli`
}

export function isDynamicTableExistsField(field?: string | null, sourceColumnId?: string | null): boolean {
  if (sourceColumnId === DYNAMIC_TABLE_ROW_EXISTS_COL_ID) return true
  const trimmed = String(field || '').trim()
  return trimmed.endsWith('____kayitli') || trimmed === 'caller.hasUpcomingAppointment'
}

export function formatDynamicTableExistsLabel(tableName: string): string {
  const t = String(tableName || '').trim() || 'Tablo'
  if (t === 'Randevu Takvimi') return 'Randevu Takvimi · Yaklaşan randevusu var mı?'
  return `${t} · Bu tabloda kayıtlı mı?`
}

export interface DynamicFlowFieldPatch {
  fieldName: string
  label: string
  fieldType: FlowFieldType
  enumValues?: string[]
  sourceTableId: string
  sourceTableSlug: string
  sourceTableName: string
  sourceColumnId: string
  sourceColumnSlug: string
  sourceColumnName: string
  sourceColumnType: DynamicFieldType
}

export type RelationTitlesByTableId = Record<string, string[]>

export function getOptionsForDynamicColumn(
  column: DynamicColumnDef,
  relationTitlesByTableId?: RelationTitlesByTableId,
): string[] {
  if (column.fieldType === 'relation') {
    const targetTableId = column.config?.targetTableId
    const rawTitles = targetTableId && relationTitlesByTableId ? relationTitlesByTableId[targetTableId] || [] : []
    return Array.from(
      new Set(
        rawTitles
          .map(t => String(t || '').trim())
          .filter(t => Boolean(t) && t !== 'İsimsiz Kayıt'),
      ),
    )
  }

  return (column.config?.options || [])
    .map(opt => String(opt?.label || '').trim())
    .filter(Boolean)
}

/**
 * Dinamik tablo sütununu FlowBuilder FieldNode мета verisine dönüştürür.
 * ÖNEMLİ: `description` (AI Sorusu) alanına KESİNLİKLE dokunmaz.
 */
export function mapDynamicColumnToFlowField(
  table: Pick<DynamicTableDef, 'id' | 'name' | 'slug'>,
  column: DynamicColumnDef,
  relationTitlesByTableId?: RelationTitlesByTableId,
): DynamicFlowFieldPatch {
  if (table.id === VIRTUAL_APPOINTMENT_TABLE_ID) {
    if (column.id === VIRTUAL_APPOINTMENT_TIME_COL_ID || column.slug === 'saat') {
      return {
        fieldName: 'saat',
        label: 'Randevu Takvimi · Randevu Saati',
        fieldType: 'time',
        enumValues: undefined,
        sourceTableId: VIRTUAL_APPOINTMENT_TABLE_ID,
        sourceTableSlug: 'randevu_takvimi',
        sourceTableName: 'Randevu Takvimi',
        sourceColumnId: VIRTUAL_APPOINTMENT_TIME_COL_ID,
        sourceColumnSlug: 'saat',
        sourceColumnName: 'Randevu Saati',
        sourceColumnType: 'text',
      }
    }
    return {
      fieldName: 'tarih',
      label: 'Randevu Takvimi · Randevu Tarihi',
      fieldType: 'date',
      enumValues: undefined,
      sourceTableId: VIRTUAL_APPOINTMENT_TABLE_ID,
      sourceTableSlug: 'randevu_takvimi',
      sourceTableName: 'Randevu Takvimi',
      sourceColumnId: VIRTUAL_APPOINTMENT_DATE_COL_ID,
      sourceColumnSlug: 'tarih',
      sourceColumnName: 'Randevu Tarihi',
      sourceColumnType: 'date',
    }
  }

  const fieldName = buildDynamicFieldKey(table.slug || table.name, column.slug || column.name)
  const label = formatDynamicColumnDisplayLabel(table.name, column.name)
  const options = getOptionsForDynamicColumn(column, relationTitlesByTableId)

  let fieldType: FlowFieldType = 'text'
  let enumValues: string[] | undefined = undefined

  switch (column.fieldType) {
    case 'select':
    case 'multiselect':
    case 'relation':
      if (options.length > 0) {
        fieldType = 'enum'
        enumValues = options
      } else {
        fieldType = 'text'
      }
      break
    case 'boolean':
      fieldType = 'boolean'
      break
    case 'number':
    case 'currency':
      fieldType = 'number'
      break
    case 'date':
      fieldType = 'date'
      break
    case 'phone':
      fieldType = 'phone'
      break
    case 'email':
      fieldType = 'email'
      break
    default:
      fieldType = 'text'
      break
  }

  return {
    fieldName,
    label,
    fieldType,
    enumValues,
    sourceTableId: table.id,
    sourceTableSlug: table.slug,
    sourceTableName: table.name,
    sourceColumnId: column.id,
    sourceColumnSlug: column.slug,
    sourceColumnName: column.name,
    sourceColumnType: column.fieldType,
  }
}

/**
 * Mevcut bir FieldNode verisine dinamik tablo sütunu seçimini uygular.
 * Kullanıcının girdiği `description` (AI Sorusu) cümlesini olduğu gibi korur.
 */
export function applyDynamicColumnToFieldData<T extends Record<string, any>>(
  currentData: T,
  table: Pick<DynamicTableDef, 'id' | 'name' | 'slug'>,
  column: DynamicColumnDef,
  relationTitlesByTableId?: RelationTitlesByTableId,
): T & DynamicFlowFieldPatch {
  const patch = mapDynamicColumnToFlowField(table, column, relationTitlesByTableId)
  return {
    ...currentData,
    ...patch,
    description: currentData.description ?? '',
  }
}

/**
 * Hazır veya özel alana geçildiğinde dinamik tablo kaynak işaretlerini temizler.
 */
export function clearDynamicSourceMeta(): Record<string, undefined> {
  return {
    sourceTableId: undefined,
    sourceTableSlug: undefined,
    sourceTableName: undefined,
    sourceColumnId: undefined,
    sourceColumnSlug: undefined,
    sourceColumnName: undefined,
    sourceColumnType: undefined,
  }
}

export interface ResolvedDynamicColumnMeta {
  table: DynamicTableDef
  column: DynamicColumnDef
  fieldKey: string
  label: string
  flowFieldType: FlowFieldType
  options: string[]
  samples: string[]
}

export function getSamplesForDynamicColumn(
  column: DynamicColumnDef,
  relationTitlesByTableId?: RelationTitlesByTableId,
): string[] {
  if (column.id === VIRTUAL_APPOINTMENT_TIME_COL_ID) {
    return ['10:30', '14:00', '16:30']
  }

  const options = getOptionsForDynamicColumn(column, relationTitlesByTableId)

  switch (column.fieldType) {
    case 'boolean':
      return ['Evet', 'Hayır']
    case 'select':
    case 'multiselect':
      return options.length > 0 ? options.slice(0, 4) : ['Seçenek 1', 'Seçenek 2']
    case 'relation':
      return options.length > 0 ? options.slice(0, 4) : [`Örnek ${column.name}`]
    case 'number':
      return ['10', '8', '5']
    case 'currency':
      return ['1500', '3500', '5000']
    case 'phone':
      return ['05321234567', '05449876543']
    case 'email':
      return ['bilgi@ornek.com']
    case 'date': {
      const today = new Date()
      const tomorrow = new Date(today.getTime() + 86400_000)
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return [fmt(today), fmt(tomorrow)]
    }
    default:
      return [`Örnek ${column.name}`]
  }
}

/**
 * Alan anahtarından veya düğüm/kural ipucundan ilgili dinamik tablo ve sütunu bulur.
 */
export function resolveDynamicColumnMeta(
  fieldKey: string | undefined,
  tables: DynamicTableDef[],
  hint?: {
    sourceTableId?: string
    sourceColumnId?: string
  },
  relationTitlesByTableId?: RelationTitlesByTableId,
): ResolvedDynamicColumnMeta | null {
  const normalizedKey = String(fieldKey || '').trim().toLowerCase()

  if (
    hint?.sourceTableId === VIRTUAL_APPOINTMENT_TABLE_ID ||
    hint?.sourceColumnId === VIRTUAL_APPOINTMENT_DATE_COL_ID ||
    hint?.sourceColumnId === VIRTUAL_APPOINTMENT_TIME_COL_ID ||
    normalizedKey === 'tarih' ||
    normalizedKey === 'saat' ||
    normalizedKey === 'time.hour'
  ) {
    const col =
      hint?.sourceColumnId === VIRTUAL_APPOINTMENT_TIME_COL_ID ||
      normalizedKey === 'saat' ||
      normalizedKey === 'time.hour'
        ? VIRTUAL_APPOINTMENT_TABLE.columns[1]!
        : VIRTUAL_APPOINTMENT_TABLE.columns[0]!
    const mapped = mapDynamicColumnToFlowField(VIRTUAL_APPOINTMENT_TABLE, col, relationTitlesByTableId)
    return {
      table: VIRTUAL_APPOINTMENT_TABLE,
      column: col,
      fieldKey: mapped.fieldName,
      label: mapped.label,
      flowFieldType: mapped.fieldType,
      options: [],
      samples: getSamplesForDynamicColumn(col, relationTitlesByTableId),
    }
  }

  if (!Array.isArray(tables) || tables.length === 0) return null

  if (hint?.sourceTableId && hint?.sourceColumnId) {
    const table = tables.find(t => t.id === hint.sourceTableId)
    const column = table?.columns?.find(c => c.id === hint.sourceColumnId)
    if (table && column) {
      const mapped = mapDynamicColumnToFlowField(table, column, relationTitlesByTableId)
      return {
        table,
        column,
        fieldKey: mapped.fieldName,
        label: mapped.label,
        flowFieldType: mapped.fieldType,
        options: mapped.enumValues || [],
        samples: getSamplesForDynamicColumn(column, relationTitlesByTableId),
      }
    }
  }

  if (!normalizedKey) return null

  for (const table of tables) {
    for (const column of table.columns || []) {
      const candidateKey = buildDynamicFieldKey(table.slug || table.name, column.slug || column.name)
      if (candidateKey === normalizedKey) {
        const mapped = mapDynamicColumnToFlowField(table, column, relationTitlesByTableId)
        return {
          table,
          column,
          fieldKey: candidateKey,
          label: mapped.label,
          flowFieldType: mapped.fieldType,
          options: mapped.enumValues || [],
          samples: getSamplesForDynamicColumn(column, relationTitlesByTableId),
        }
      }
    }
  }

  return null
}

/**
 * Akıştaki tüm alan anahtarları için Türkçe okunabilir etiket haritası oluşturur.
 * Koşul düğümlerinde, yol özetlerinde ve önizlemelerde ham değişken adlarının görünmesini engeller.
 */
export function buildFieldLabelMap(
  nodes: Array<{ type?: string; data?: Record<string, any> }>,
  tables: DynamicTableDef[] = [],
  presets: ReadonlyArray<{ value: string; label: string }> = [],
): Record<string, string> {
  const map: Record<string, string> = {
    tarih: 'Randevu Takvimi · Randevu Tarihi',
    saat: 'Randevu Takvimi · Randevu Saati',
    'caller.hasUpcomingAppointment': 'Randevu Takvimi · Yaklaşan randevusu var mı?',
  }

  for (const preset of presets) {
    if (preset.value && preset.label) {
      map[preset.value] = preset.label
    }
  }

  for (const table of tables) {
    map[buildDynamicTableExistsKey(table.slug || table.name)] = formatDynamicTableExistsLabel(table.name)
    for (const col of table.columns || []) {
      const key = buildDynamicFieldKey(table.slug || table.name, col.slug || col.name)
      map[key] = formatDynamicColumnDisplayLabel(table.name, col.name)
    }
  }

  for (const node of nodes || []) {
    const d = node?.data || {}
    if ((node.type === 'fieldNode' || node.type === 'FIELD') && d.fieldName) {
      const key = String(d.fieldName).trim()
      if (d.sourceTableName && d.sourceColumnName) {
        map[key] = formatDynamicColumnDisplayLabel(String(d.sourceTableName), String(d.sourceColumnName))
      } else if (d.label && String(d.label).trim() && String(d.label).trim() !== key) {
        map[key] = String(d.label).trim()
      }
    }

    if (node.type === 'conditionNode' || node.type === 'CONDITION') {
      if (d.conditionField) {
        const cKey = String(d.conditionField).trim()
        if (!map[cKey]) {
          if (isDynamicTableExistsField(cKey, d.sourceColumnId) && d.sourceTableName) {
            map[cKey] = formatDynamicTableExistsLabel(String(d.sourceTableName))
          } else if (d.sourceTableName && d.sourceColumnName) {
            map[cKey] = formatDynamicColumnDisplayLabel(String(d.sourceTableName), String(d.sourceColumnName))
          } else if (d.conditionFieldLabel) {
            map[cKey] = String(d.conditionFieldLabel).trim()
          }
        }
      }
      if (Array.isArray(d.rules)) {
        for (const r of d.rules) {
          if (!r?.field) continue
          const rKey = String(r.field).trim()
          if (!map[rKey]) {
            if (isDynamicTableExistsField(rKey, r.sourceColumnId) && r.sourceTableName) {
              map[rKey] = formatDynamicTableExistsLabel(String(r.sourceTableName))
            } else if (r.sourceTableName && r.sourceColumnName) {
              map[rKey] = formatDynamicColumnDisplayLabel(String(r.sourceTableName), String(r.sourceColumnName))
            } else if (r.fieldLabel) {
              map[rKey] = String(r.fieldLabel).trim()
            }
          }
        }
      }
    }
  }

  return map
}

/**
 * Akıştaki ve dinamik tablolardaki Evet/Hayır (boolean) alanlarının kümesini döndürür.
 */
export function buildBooleanFieldSet(
  nodes: Array<{ type?: string; data?: Record<string, any> }> = [],
  tables: DynamicTableDef[] = [],
): Set<string> {
  const set = new Set<string>([
    'kayitli',
    'caller.isKnownPatient',
    'caller.isVip',
    'caller.hasUpcomingAppointment',
    'clinic.isOpen',
  ])

  for (const table of tables) {
    set.add(buildDynamicTableExistsKey(table.slug || table.name))
    for (const col of table.columns || []) {
      if (col.fieldType === 'boolean') {
        set.add(buildDynamicFieldKey(table.slug || table.name, col.slug || col.name))
      }
    }
  }

  for (const node of nodes) {
    const d = node?.data || {}
    if ((node.type === 'fieldNode' || node.type === 'FIELD') && d.fieldName) {
      if (d.fieldType === 'boolean' || d.sourceColumnType === 'boolean') {
        set.add(String(d.fieldName).trim())
      }
    }
    if (node.type === 'conditionNode' || node.type === 'CONDITION') {
      if (d.conditionField && (d.sourceColumnType === 'boolean' || isDynamicTableExistsField(d.conditionField, d.sourceColumnId))) {
        set.add(String(d.conditionField).trim())
      }
      if (Array.isArray(d.rules)) {
        for (const r of d.rules) {
          if (r?.field && (r.sourceColumnType === 'boolean' || isDynamicTableExistsField(r.field, r.sourceColumnId))) {
            set.add(String(r.field).trim())
          }
        }
      }
    }
  }

  return set
}

export type ConditionFieldKind =
  | 'table_exists'
  | 'boolean'
  | 'number'
  | 'date'
  | 'time'
  | 'phone'
  | 'email'
  | 'select'
  | 'multiselect'
  | 'text'

export function inferConditionFieldKind(params: {
  field: string
  sourceColumnId?: string
  dynamicColumnType?: DynamicFieldType
  dynamicColumnAllowMultiple?: boolean
  canvasFieldNode?: { fieldType?: string; enumValues?: string[]; sourceColumnType?: DynamicFieldType }
  booleanFields?: Set<string>
}): ConditionFieldKind {
  const { field, sourceColumnId, dynamicColumnType, dynamicColumnAllowMultiple, canvasFieldNode, booleanFields } = params
  const f = String(field || '').trim()
  const canonical = f === 'kayitli' ? 'caller.isKnownPatient' : f === 'saat' ? 'time.hour' : f

  if (isDynamicTableExistsField(f, sourceColumnId)) return 'table_exists'
  if (booleanFields?.has(f) || booleanFields?.has(canonical)) return 'boolean'

  const colType = dynamicColumnType || canvasFieldNode?.sourceColumnType
  if (colType === 'boolean') return 'boolean'
  if (colType === 'number' || colType === 'currency') return 'number'
  if (colType === 'date') return 'date'
  if (colType === 'phone') return 'phone'
  if (colType === 'email') return 'email'
  if (colType === 'select') return 'select'
  if (colType === 'multiselect') return 'multiselect'
  if (colType === 'relation') return dynamicColumnAllowMultiple ? 'multiselect' : 'select'

  if (
    canonical === 'caller.isKnownPatient' ||
    canonical === 'caller.isVip' ||
    canonical === 'caller.hasUpcomingAppointment' ||
    canonical === 'clinic.isOpen' ||
    canvasFieldNode?.fieldType === 'boolean'
  ) {
    return 'boolean'
  }
  if (
    canonical === 'call.silenceCount' ||
    canonical === 'call.durationSec' ||
    canonical === 'caller.visitCount' ||
    canonical === 'puan' ||
    canvasFieldNode?.fieldType === 'number'
  ) {
    return 'number'
  }
  if (canonical === 'tarih' || canvasFieldNode?.fieldType === 'date') return 'date'
  if (canonical === 'time.hour' || canvasFieldNode?.fieldType === 'time') return 'time'
  if (canonical === 'caller.phone' || canvasFieldNode?.fieldType === 'phone') return 'phone'
  if (canvasFieldNode?.fieldType === 'email') return 'email'
  if (
    canonical === 'time.weekday' ||
    canonical === 'call.direction' ||
    canonical === 'call.channel' ||
    canvasFieldNode?.fieldType === 'enum' ||
    canvasFieldNode?.fieldType === 'user' ||
    (Array.isArray(canvasFieldNode?.enumValues) && canvasFieldNode.enumValues.length > 0)
  ) {
    return 'select'
  }
  return 'text'
}

const ALLOWED_OPS_BY_KIND: Record<ConditionFieldKind, Set<string>> = {
  table_exists: new Set(['equals', 'notEquals']),
  boolean: new Set(['equals', 'notEquals', 'isEmpty', 'notEmpty']),
  number: new Set(['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'notEmpty']),
  date: new Set(['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'notEmpty']),
  time: new Set(['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'notEmpty']),
  phone: new Set([
    'equals',
    'notEquals',
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'in',
    'existsInTable',
    'notExistsInTable',
    'isEmpty',
    'notEmpty',
  ]),
  email: new Set([
    'equals',
    'notEquals',
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'in',
    'existsInTable',
    'notExistsInTable',
    'isEmpty',
    'notEmpty',
  ]),
  select: new Set(['equals', 'notEquals', 'in', 'existsInTable', 'notExistsInTable', 'isEmpty', 'notEmpty']),
  multiselect: new Set(['contains', 'notContains', 'in', 'equals', 'notEquals', 'isEmpty', 'notEmpty']),
  text: new Set([
    'equals',
    'notEquals',
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'in',
    'existsInTable',
    'notExistsInTable',
    'isEmpty',
    'notEmpty',
  ]),
}

const KIND_OP_LABEL_OVERRIDES: Partial<Record<ConditionFieldKind, Record<string, string>>> = {
  table_exists: {
    equals: 'ise',
    notEquals: 'değilse',
  },
  date: {
    equals: 'şu tarihteyse',
    notEquals: 'şu tarihte değilse',
    gt: 'tarihinden sonraysa',
    gte: 've sonrasıysa',
    lt: 'tarihinden önceyse',
    lte: 've öncesiyse',
    between: 'tarihleri arasındaysa',
  },
  time: {
    equals: 'şu saatteyse',
    notEquals: 'şu saatte değilse',
    gt: 'saatinden sonraysa',
    gte: 've sonrasıysa',
    lt: 'saatinden önceyse',
    lte: 've öncesiyse',
    between: 'saatleri arasındaysa',
  },
  multiselect: {
    contains: 'şunu içeriyorsa',
    notContains: 'şunu içermiyorsa',
  },
}

export function getDefaultOperatorForFieldKind(kind: ConditionFieldKind): string {
  if (kind === 'multiselect') return 'contains'
  return 'equals'
}

export function getOperatorsForFieldKind(
  kind: ConditionFieldKind,
  allOperators: ReadonlyArray<{ value: string; label: string }>,
  _currentOperator?: string,
  options?: { hasTableContext?: boolean },
): Array<{ value: string; label: string }> {
  const allowed = ALLOWED_OPS_BY_KIND[kind] || ALLOWED_OPS_BY_KIND.text
  const hasTableContext = options?.hasTableContext
  const labelOverrides = KIND_OP_LABEL_OVERRIDES[kind]
  const filtered = allOperators
    .filter(op => {
      if (!allowed.has(op.value)) return false
      if (hasTableContext === false && (op.value === 'existsInTable' || op.value === 'notExistsInTable')) {
        return false
      }
      return true
    })
    .map(op => ({
      value: op.value,
      label: labelOverrides?.[op.value] ?? op.label,
    }))
  return filtered.length > 0 ? filtered : [...allOperators]
}

export function parseComparableNumberOrDate(raw: string): number | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null

  // HH:MM veya H:MM saat karşılaştırması (saat bazlı kesirli değer: "14:30" -> 14.5)
  const timeMatch = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (timeMatch) {
    return Number(timeMatch[1]) + Number(timeMatch[2]) / 60
  }

  // ISO Date: YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const ts = Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
    if (Number.isFinite(ts)) return ts
  }

  // TR Date: DD.MM.YYYY
  const trDateMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (trDateMatch) {
    const ts = Date.UTC(Number(trDateMatch[3]), Number(trDateMatch[2]) - 1, Number(trDateMatch[1]))
    if (Number.isFinite(ts)) return ts
  }

  // Currency / Turkish formatted number: "1.250,50 ₺" or "1250.5"
  const cleanedCurrency = trimmed.replace(/[₺$€£%\s]/g, '')
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleanedCurrency)) {
    const n = Number(cleanedCurrency.replace(/\./g, '').replace(',', '.'))
    if (Number.isFinite(n)) return n
  }
  const direct = Number(cleanedCurrency.replace(',', '.'))
  return Number.isFinite(direct) ? direct : null
}

const WEEKDAY_TR_TO_NUM: Record<string, string> = {
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

function normalizeWeekdayToken(val: string): string {
  const low = val.trim().toLocaleLowerCase('tr-TR')
  return WEEKDAY_TR_TO_NUM[low] ?? low
}

/**
 * Tarayıcı tarafı (çevrimdışı / yerel simülasyon yedeği) için tam uyumlu koşul değerlendirici.
 * Tekli ve çoklu (ve / veya) kuralları, dizi (çoklu seçenek), sayı, para, tarih, saat ve Evet/Hayır değerlerini destekler.
 */
export function evaluateLocalConditionRule(
  rule: { field: string; operator: string; value?: string; valueTo?: string; sourceTableId?: string; sourceColumnId?: string },
  fields: Record<string, unknown>,
): boolean {
  const field = String(rule.field || '').trim()
  const op = rule.operator || 'equals'
  const isTableExists = isDynamicTableExistsField(field, rule.sourceColumnId)
  const rawVal =
    fields[field] ??
    (isTableExists && rule.sourceTableId ? fields[`_tbl_exists__${rule.sourceTableId}`] : undefined) ??
    (rule.sourceColumnId ? fields[`_col__${rule.sourceColumnId}`] : undefined) ??
    (field === 'caller.isKnownPatient'
      ? fields['kayitli']
      : field === 'kayitli'
      ? fields['caller.isKnownPatient']
      : field === 'saat'
      ? fields['time.hour']
      : field === 'time.hour'
      ? fields['saat']
      : undefined)

  const listValues = Array.isArray(rawVal)
    ? rawVal.map(v => String(v ?? '').trim()).filter(Boolean)
    : null
  const actual = listValues ? listValues.join(', ') : String(rawVal ?? '').trim()
  const expected = String(rule.value ?? '').trim()
  const expectedTo = String(rule.valueTo ?? '').trim()

  const actualLow = field === 'time.weekday' ? normalizeWeekdayToken(actual) : actual.toLocaleLowerCase('tr-TR')
  const expectedLow = field === 'time.weekday' ? normalizeWeekdayToken(expected) : expected.toLocaleLowerCase('tr-TR')
  const listLow = listValues
    ? listValues.map(v => (field === 'time.weekday' ? normalizeWeekdayToken(v) : v.toLocaleLowerCase('tr-TR')))
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
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const aNum = parseComparableNumberOrDate(actual)
      const eNum = parseComparableNumberOrDate(expected)
      if (aNum === null || eNum === null) return false
      if (op === 'gt') return aNum > eNum
      if (op === 'gte') return aNum >= eNum
      if (op === 'lt') return aNum < eNum
      return aNum <= eNum
    }
    case 'between': {
      const aNum = parseComparableNumberOrDate(actual)
      let parts = expectedTo ? [expected, expectedTo] : expected.split(/\s*[,;]\s*/)
      if (parts.length < 2 && /^\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?$/.test(expected)) {
        parts = expected.split(/\s*-\s*/)
      }
      const low = parseComparableNumberOrDate(parts[0] ?? '')
      const high = parseComparableNumberOrDate(parts[1] ?? '')
      if (aNum === null || low === null || high === null) return false
      return aNum >= Math.min(low, high) && aNum <= Math.max(low, high)
    }
    case 'in': {
      const items = expected
        .split(/[,;|]+/)
        .map(s => (field === 'time.weekday' ? normalizeWeekdayToken(s) : s.trim().toLocaleLowerCase('tr-TR')))
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
      const aComparable = parseComparableNumberOrDate(actual)
      const eComparable = parseComparableNumberOrDate(expected)
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
      const aComparable = parseComparableNumberOrDate(actual)
      const eComparable = parseComparableNumberOrDate(expected)
      if (aComparable !== null && eComparable !== null) return aComparable === eComparable
      if (aComparable === null && !expectedLow.includes(',') && actualLow.includes(',')) {
        const actualParts = actualLow.split(/[,;|]+/).map(s => s.trim()).filter(Boolean)
        if (actualParts.length > 1) return actualParts.includes(expectedLow)
      }
      return actualLow === expectedLow
    }
  }
}

export function evaluateLocalConditionNode(
  data: Record<string, any> | undefined,
  fields: Record<string, unknown>,
): boolean {
  const d = data || {}
  const evalGroupOrRule = (item: any): boolean => {
    if (item && typeof item === 'object' && Array.isArray(item.rules)) {
      const grpLogic = item.logic === 'OR' ? 'OR' : 'AND'
      return grpLogic === 'OR'
        ? item.rules.some(evalGroupOrRule)
        : item.rules.every(evalGroupOrRule)
    }
    return evaluateLocalConditionRule(item, fields)
  }
  if (Array.isArray(d.rules) && d.rules.length > 0) {
    const logic = d.conditionLogic === 'OR' ? 'OR' : 'AND'
    return logic === 'OR'
      ? d.rules.some(evalGroupOrRule)
      : d.rules.every(evalGroupOrRule)
  }
  return evaluateLocalConditionRule(
    {
      field: String(d.conditionField || ''),
      operator: String(d.operator || 'equals'),
      value: d.conditionValue,
      valueTo: d.conditionValueTo,
      sourceTableId: d.sourceTableId,
      sourceColumnId: d.sourceColumnId,
    },
    fields,
  )
}

export interface FlowAppointmentConfigHint {
  tableId: string
  enabled?: boolean
  allowMultiple?: boolean
  isRequiredInAppointment?: boolean
  titleColumnId?: string | null
  phoneColumnId?: string | null
}

export interface FlowModuleConfigHint {
  moduleRole: string
  tableId?: string | null
  targetTableId?: string | null
  isEnabled?: boolean
  enabled?: boolean
}

export type ClinicSectorKind =
  | 'dental'
  | 'real_estate'
  | 'insurance'
  | 'automotive'
  | 'consulting'
  | 'support'
  | 'inventory'
  | 'generic'

export interface ClinicDynamicProfile {
  sectorKind: ClinicSectorKind
  primaryTable: DynamicTableDef | null
  secondaryTable: DynamicTableDef | null
  nameCol: DynamicColumnDef | null
  phoneCol: DynamicColumnDef | null
  emailCol: DynamicColumnDef | null
  topicTable: DynamicTableDef | null
  topicCol: DynamicColumnDef | null
  linkTable?: DynamicTableDef | null
  linkCol?: DynamicColumnDef | null
  branchTable: DynamicTableDef | null
  branchCol: DynamicColumnDef | null
  ratingTable: DynamicTableDef | null
  ratingCol: DynamicColumnDef | null
  entitySingular: string
  entityLower: string
  appointmentNoun: string
  requestTopicLabel: string
  sampleCallerPhrase: string
}

export type DynamicTemplateKey =
  | 'inbound'
  | 'full_asterisk'
  | 'quick_note'
  | 'outbound'
  | 'web'
  | 'whatsapp'

export interface DynamicFlowTemplateOption {
  id: DynamicTemplateKey
  label: string
  description: string
  direction: 'inbound' | 'outbound' | 'web' | 'whatsapp'
}

const PERSON_TABLE_REGEX =
  /(hasta|musteri|müşteri|danisan|danışan|alici|alıcı|kiraci|kiracı|sigortali|sigortalı|sahip|arac_sahibi|uye|üye|kisi|kişi|rehber|iletisim|iletişim|aday|lead|crm)/i

const SECONDARY_TABLE_REGEX =
  /(hizmet|islem|işlem|tedavi|randevu|seans|mulk|mülk|ilan|portfoy|portföy|arac|araç|police|poliçe|urun|ürün|stok|demirbas|demirbaş|talep|basvuru|başvuru|anket|destek|sikayet|şikayet|servis)/i

function cleanSingularTableTitle(name: string): string {
  const trimmed = String(name || '').trim()
  if (!trimmed) return 'Müşteri'
  return trimmed
    .replace(/\b(Kayıtları|Kayitlari|Listesi|Tablosu|Bilgileri|Müşterileri|Musterileri|Hastaları|Hastalari)\b/gi, '')
    .replace(/(lar|ler)$/i, '')
    .trim() || trimmed
}

function inferEntitySingular(table: DynamicTableDef | null): string {
  if (!table) return 'Müşteri'
  const text = `${table.name} ${table.slug}`
  if (/hasta/i.test(text)) return 'Hasta'
  if (/danisan|danışan/i.test(text)) return 'Danışan'
  if (/alici|alıcı/i.test(text)) return 'Alıcı'
  if (/kiraci|kiracı/i.test(text)) return 'Kiracı'
  if (/mulk_sahib|mülk sahib/i.test(text)) return 'Mülk Sahibi'
  if (/sigortali|sigortalı/i.test(text)) return 'Sigortalı'
  if (/arac_sahib|araç sahib/i.test(text)) return 'Araç Sahibi'
  if (/uye|üye/i.test(text)) return 'Üye'
  if (/musteri|müşteri/i.test(text)) return 'Müşteri'
  return cleanSingularTableTitle(table.name)
}

function findColumnByHint(
  table: DynamicTableDef | null,
  preferredId?: string | null,
  matcher?: RegExp,
  typeFilter?: DynamicFieldType[],
): DynamicColumnDef | null {
  if (!table) return null
  const cols = table.columns || []
  if (preferredId) {
    const exact = cols.find((c) => c.id === preferredId)
    if (exact) return exact
  }
  if (matcher) {
    const matched = cols.find(
      (c) => matcher.test(`${c.slug} ${c.name}`) && (!typeFilter || typeFilter.includes(c.fieldType)),
    )
    if (matched) return matched
  }
  if (typeFilter) {
    const byType = cols.find((c) => typeFilter.includes(c.fieldType))
    if (byType) return byType
  }
  return null
}

function pickBestDescriptiveColumn(
  table: DynamicTableDef | null,
  excludedIds: Set<string>,
): DynamicColumnDef | null {
  if (!table) return null
  const cols = (table.columns || []).filter((c) => !excludedIds.has(c.id))
  if (cols.length === 0) return null
  return (
    cols.find((c) => c.fieldType === 'select' && (c.config?.options?.length || 0) > 0) ||
    cols.find((c) => c.fieldType === 'relation') ||
    cols.find((c) => c.fieldType === 'boolean') ||
    cols.find((c) => c.isPrimaryTitle) ||
    cols.find((c) => /(sikayet|şikayet|hizmet|tedavi|islem|işlem|konu|talep|urun|ürün|mulk|mülk|arac|araç|police|poliçe|kategori|bolge|bölge|durum|not)/i.test(`${c.slug} ${c.name}`)) ||
    cols.find((c) => c.fieldType === 'text') ||
    cols[0] ||
    null
  )
}

function pickBestBranchColumn(
  tables: DynamicTableDef[],
  primaryTable: DynamicTableDef | null,
  secondaryTable: DynamicTableDef | null,
  excludedIds: Set<string>,
): { table: DynamicTableDef | null; col: DynamicColumnDef | null } {
  const orderedTables = [primaryTable, secondaryTable, ...tables].filter(
    (t, idx, arr): t is DynamicTableDef =>
      Boolean(t) && !isVirtualAppointmentTable(t!.id) && arr.findIndex((x) => x?.id === t!.id) === idx,
  )

  for (const tbl of orderedTables) {
    const cols = (tbl.columns || []).filter((c) => !excludedIds.has(c.id))
    const selectCol = cols.find((c) => c.fieldType === 'select' && (c.config?.options?.length || 0) > 0)
    if (selectCol) return { table: tbl, col: selectCol }
  }
  for (const tbl of orderedTables) {
    const cols = (tbl.columns || []).filter((c) => !excludedIds.has(c.id))
    const boolCol = cols.find((c) => c.fieldType === 'boolean')
    if (boolCol) return { table: tbl, col: boolCol }
  }
  for (const tbl of orderedTables) {
    const cols = (tbl.columns || []).filter((c) => !excludedIds.has(c.id))
    const numCol = cols.find((c) => (c.fieldType === 'number' || c.fieldType === 'currency') && !c.isPrimaryTitle)
    if (numCol) return { table: tbl, col: numCol }
  }
  for (const tbl of orderedTables) {
    const cols = (tbl.columns || []).filter((c) => !excludedIds.has(c.id))
    const descCol = cols.find((c) => c.fieldType === 'text' && !/telefon|phone|email|eposta/i.test(`${c.slug} ${c.name}`))
    if (descCol) return { table: tbl, col: descCol }
  }
  return { table: null, col: null }
}

export function inferClinicDynamicProfile(
  tables: DynamicTableDef[] = [],
  appointmentConfigs: FlowAppointmentConfigHint[] = [],
  moduleConfigs: FlowModuleConfigHint[] = [],
): ClinicDynamicProfile {
  const realTables = tables.filter((t) => !isVirtualAppointmentTable(t.id))
  const combinedAllText = realTables
    .map((t) => `${t.name} ${t.slug} ${(t.columns || []).map((c) => c.slug).join(' ')}`)
    .join(' ')

  let sectorKind: ClinicSectorKind = 'generic'
  if (/dis|diş|dental|muayene|implant|kanal|klinik|ortodonti/i.test(combinedAllText)) {
    sectorKind = 'dental'
  } else if (/emlak|mulk|mülk|daire|konut|kiraci|kiracı|portfoy|portföy|tapu|ilan_linki|ilan_basligi|\bilan\b|sahibinden|hepsiemlak|emlakjet/i.test(combinedAllText)) {
    sectorKind = 'real_estate'
  } else if (/sigorta|police|poliçe|kasko|hasar|teklif/i.test(combinedAllText)) {
    sectorKind = 'insurance'
  } else if (/arac|araç|servis|plaka|otomotiv|bakim|bakım/i.test(combinedAllText)) {
    sectorKind = 'automotive'
  } else if (/danisman|danışman|seans|psikolog|terapi/i.test(combinedAllText)) {
    sectorKind = 'consulting'
  } else if (/destek|ticket|sikayet|şikayet|cagri|çağrı/i.test(combinedAllText)) {
    sectorKind = 'support'
  } else if (/stok|urun|ürün|demirbas|demirbaş|envanter|depo/i.test(combinedAllText)) {
    sectorKind = 'inventory'
  }

  let primaryTable: DynamicTableDef | null = null
  const personModule = moduleConfigs.find(
    (mc) =>
      mc.isEnabled !== false &&
      mc.enabled !== false &&
      /(patient|customer|client|crm|person|contact|member|musteri|hasta|danisan)/i.test(mc.moduleRole),
  )
  const personModuleTableId = personModule?.tableId || personModule?.targetTableId
  if (personModuleTableId) {
    primaryTable = realTables.find((t) => t.id === personModuleTableId) || null
  }
  if (!primaryTable) {
    const requiredAppt =
      appointmentConfigs.find((ac) => ac.enabled !== false && ac.isRequiredInAppointment && !ac.allowMultiple) ||
      appointmentConfigs.find((ac) => ac.enabled !== false && !ac.allowMultiple)
    if (requiredAppt) {
      primaryTable = realTables.find((t) => t.id === requiredAppt.tableId) || null
    }
  }
  if (!primaryTable) {
    primaryTable =
      realTables.find(
        (t) =>
          PERSON_TABLE_REGEX.test(`${t.name} ${t.slug}`) &&
          (t.columns || []).some((c) => c.fieldType === 'phone' || /telefon|phone|gsm/i.test(`${c.slug} ${c.name}`)),
      ) ||
      realTables.find((t) => PERSON_TABLE_REGEX.test(`${t.name} ${t.slug}`)) ||
      realTables.find((t) => (t.columns || []).some((c) => c.fieldType === 'phone')) ||
      realTables[0] ||
      null
  }

  const isExplicitServiceRole = (role: string) =>
    /(service|product|catalog|listing|treatment|policy|vehicle|hizmet|urun|ilan|tedavi)/i.test(role) &&
    !/(stock_inventory|asset_maintenance|finance_)/i.test(role)

  let secondaryTable: DynamicTableDef | null = null
  const serviceModule = moduleConfigs.find(
    (mc) =>
      mc.isEnabled !== false &&
      mc.enabled !== false &&
      isExplicitServiceRole(mc.moduleRole) &&
      (mc.tableId || mc.targetTableId) !== primaryTable?.id,
  )
  const serviceModuleTableId = serviceModule?.tableId || serviceModule?.targetTableId
  if (serviceModuleTableId) {
    secondaryTable = realTables.find((t) => t.id === serviceModuleTableId) || null
  }
  if (!secondaryTable) {
    const multiAppt =
      appointmentConfigs.find((ac) => ac.enabled !== false && ac.allowMultiple && ac.tableId !== primaryTable?.id) ||
      appointmentConfigs.find((ac) => ac.enabled !== false && ac.tableId !== primaryTable?.id)
    if (multiAppt) {
      secondaryTable = realTables.find((t) => t.id === multiAppt.tableId) || null
    }
  }
  if (!secondaryTable) {
    const inventoryOrAssetModule = moduleConfigs.find(
      (mc) =>
        mc.isEnabled !== false &&
        mc.enabled !== false &&
        /(inventory|asset|stok|demirbas)/i.test(mc.moduleRole) &&
        !/finance_/i.test(mc.moduleRole) &&
        (mc.tableId || mc.targetTableId) !== primaryTable?.id,
    )
    const invModuleTableId = inventoryOrAssetModule?.tableId || inventoryOrAssetModule?.targetTableId
    if (invModuleTableId) {
      secondaryTable = realTables.find((t) => t.id === invModuleTableId) || null
    }
  }
  if (!secondaryTable) {
    secondaryTable =
      realTables.find(
        (t) =>
          t.id !== primaryTable?.id &&
          SECONDARY_TABLE_REGEX.test(`${t.name} ${t.slug}`) &&
          !/(stok|envanter|demirbas|gelir|gider|masraf|bakim)/i.test(`${t.name} ${t.slug}`),
      ) ||
      realTables.find((t) => t.id !== primaryTable?.id && SECONDARY_TABLE_REGEX.test(`${t.name} ${t.slug}`)) ||
      realTables.find((t) => t.id !== primaryTable?.id) ||
      null
  }

  const primaryApptCfg = appointmentConfigs.find((ac) => ac.tableId === primaryTable?.id)
  const nameCol =
    findColumnByHint(
      primaryTable,
      primaryApptCfg?.titleColumnId,
      /^(ad_soyad|adsoyad|full_name|hasta_adi|musteri_adi|isim|ad|unvan)$/i,
    ) ||
    findColumnByHint(primaryTable, undefined, /ad|isim|unvan|name|baslik/i, ['text']) ||
    (primaryTable?.columns || []).find((c) => c.isPrimaryTitle && c.fieldType === 'text') ||
    (primaryTable?.columns || []).find((c) => c.fieldType === 'text') ||
    null

  const phoneCol =
    findColumnByHint(
      primaryTable,
      primaryApptCfg?.phoneColumnId,
      /telefon|phone|gsm|cep|tel/i,
      ['phone', 'text'],
    ) ||
    (primaryTable?.columns || []).find((c) => c.fieldType === 'phone') ||
    null

  const emailCol =
    findColumnByHint(primaryTable, undefined, /email|e_posta|eposta|mail/i, ['email', 'text']) ||
    (primaryTable?.columns || []).find((c) => c.fieldType === 'email') ||
    null

  const excludedIdentityIds = new Set<string>(
    [nameCol?.id, phoneCol?.id, emailCol?.id].filter((x): x is string => Boolean(x)),
  )

  const secondaryDescCol = pickBestDescriptiveColumn(secondaryTable, excludedIdentityIds)
  const primaryDescCol = pickBestDescriptiveColumn(primaryTable, excludedIdentityIds)
  const topicTable = secondaryDescCol ? secondaryTable : primaryDescCol ? primaryTable : null
  const topicCol = secondaryDescCol || primaryDescCol || null

  let linkTable: DynamicTableDef | null = null
  let linkCol: DynamicColumnDef | null = null
  const linkSearchTables = [secondaryTable, primaryTable, ...realTables].filter(
    (t, idx, arr): t is DynamicTableDef =>
      Boolean(t) && arr.findIndex((x) => x?.id === t!.id) === idx,
  )
  for (const tbl of linkSearchTables) {
    const found = (tbl.columns || []).find(
      (c) =>
        !excludedIdentityIds.has(c.id) &&
        c.fieldType === 'text' &&
        /(ilan_link|link|url|baglanti|bağlantı)/i.test(`${c.slug} ${c.name}`),
    )
    if (found) {
      linkTable = tbl
      linkCol = found
      break
    }
  }

  const excludedForBranch = new Set<string>(excludedIdentityIds)
  const { table: branchTable, col: branchCol } = pickBestBranchColumn(
    realTables,
    primaryTable,
    secondaryTable,
    excludedForBranch,
  )

  let ratingTable: DynamicTableDef | null = null
  let ratingCol: DynamicColumnDef | null = null
  for (const tbl of realTables) {
    const found = (tbl.columns || []).find((c) =>
      /(memnuniyet|puan|skor|rating|degerlendirme|değerlendirme)/i.test(`${c.slug} ${c.name}`),
    )
    if (found) {
      ratingTable = tbl
      ratingCol = found
      break
    }
  }

  const entitySingular = inferEntitySingular(primaryTable)
  const entityLower = entitySingular.toLocaleLowerCase('tr-TR')

  const appointmentNoun =
    sectorKind === 'real_estate'
      ? 'Gösterim / Randevu'
      : sectorKind === 'automotive'
        ? 'Servis Randevusu'
        : sectorKind === 'insurance'
          ? 'Teklif / Görüşme'
          : sectorKind === 'inventory'
            ? 'Sipariş / Görüşme'
            : 'Randevu'

  const requestTopicLabel =
    topicCol?.name || secondaryTable?.name || (sectorKind === 'dental' ? 'Şikayet / Talep' : 'Talep / Konu')

  const sampleCallerPhrase =
    sectorKind === 'real_estate'
      ? 'Yarın saat 14:30 için portföydeki daireyi görmek ve randevu almak istiyorum'
      : sectorKind === 'insurance'
        ? 'Aracım için kasko ve trafik sigortası teklifi almak istiyorum'
        : sectorKind === 'automotive'
          ? 'Yarın saat 14:30 için periyodik bakım servis randevusu almak istiyorum'
          : sectorKind === 'inventory'
            ? 'Stoktaki ürünler hakkında bilgi ve tedarik randevusu almak istiyorum'
            : sectorKind === 'support'
              ? 'Mevcut talebim hakkında bilgi ve destek görüşmesi planlamak istiyorum'
              : 'Yarın saat 14:30 için randevu oluşturmak ve bilgi almak istiyorum'

  return {
    sectorKind,
    primaryTable,
    secondaryTable,
    nameCol,
    phoneCol,
    emailCol,
    topicTable,
    topicCol,
    linkTable,
    linkCol,
    branchTable,
    branchCol,
    ratingTable,
    ratingCol,
    entitySingular,
    entityLower,
    appointmentNoun,
    requestTopicLabel,
    sampleCallerPhrase,
  }
}

export function getDynamicTemplateOptions(
  profile: ClinicDynamicProfile,
  tables: DynamicTableDef[] = [],
  direction?: 'inbound' | 'outbound' | 'web' | 'whatsapp',
): DynamicFlowTemplateOption[] {
  const realCount = tables.filter((t) => !isVirtualAppointmentTable(t.id)).length
  const primaryLabel = profile.primaryTable?.name || profile.entitySingular
  const secondaryLabel = profile.secondaryTable?.name || profile.requestTopicLabel
  const tableSuffix = realCount > 0 ? primaryLabel : 'Standart'

  const all: DynamicFlowTemplateOption[] = [
    {
      id: 'inbound',
      direction: 'inbound',
      label: `⚡ Gelen Arama: ${tableSuffix} · Hızlı ${profile.appointmentNoun}`,
      description: `${primaryLabel} kaydını kontrol eder, eksik bilgileri sorar ve ${secondaryLabel} talebine göre yönlendirir.`,
    },
    {
      id: 'full_asterisk',
      direction: 'inbound',
      label: `🏥 Gelen Arama: ${tableSuffix} · Aktarım & Konum Dahil`,
      description: `${primaryLabel} kaydı + santral aktarımı ve WhatsApp konum gönderimi adımlarını içerir.`,
    },
    {
      id: 'quick_note',
      direction: direction === 'web' ? 'web' : 'inbound',
      label: `🗒️ Hızlı Not Bırakma (${profile.entitySingular} Geri Arama)`,
      description: `Kısa bir mesaj veya geri arama notu alıp görüşmeyi sonlandırır.`,
    },
    {
      id: 'outbound',
      direction: 'outbound',
      label: `📤 Giden Arama: ${profile.entitySingular} Geri Bildirim & Takip`,
      description: `${profile.entitySingular} memnuniyeti ve aktif kayıt takibi için otomatik arama akışı.`,
    },
    {
      id: 'web',
      direction: 'web',
      label: `🌐 Web Sohbeti: Hızlı ${profile.appointmentNoun} Akışı`,
      description: `Web ziyaretçisinden ${profile.entityLower} bilgilerini alıp ${profile.appointmentNoun.toLowerCase()} oluşturur.`,
    },
    {
      id: 'whatsapp',
      direction: 'whatsapp',
      label: `💬 WhatsApp: ${primaryLabel} Bilgi & ${profile.appointmentNoun}`,
      description: profile.linkCol
        ? `WhatsApp mesajlarında kayıt ve ${profile.linkCol.name.toLocaleLowerCase('tr-TR')} eşleştirme kontrolü yaparak hızlı yanıt veya ${profile.appointmentNoun.toLowerCase()} sunar.`
        : `WhatsApp mesajlarında kayıt kontrolü yaparak hızlı yanıt veya ${profile.appointmentNoun.toLowerCase()} sunar.`,
    },
  ]

  if (!direction) return all.filter((o) => o.id !== 'full_asterisk' && o.id !== 'quick_note')
  if (direction === 'inbound') return all.filter((o) => o.id === 'inbound' || o.id === 'full_asterisk' || o.id === 'quick_note')
  if (direction === 'web') return all.filter((o) => o.id === 'web' || o.id === 'quick_note')
  return all.filter((o) => o.direction === direction)
}

export function buildFieldNodeDataForColumn(
  table: DynamicTableDef,
  col: DynamicColumnDef,
  existingDescription?: string,
  relationTitlesByTableId?: RelationTitlesByTableId,
): Record<string, any> {
  const patch = mapDynamicColumnToFlowField(table, col, relationTitlesByTableId)
  const descTrim = (existingDescription || '').trim()
  const defaultQuestion =
    isVirtualAppointmentTable(table.id) && col.id === VIRTUAL_APPOINTMENT_DATE_COL_ID
      ? 'Hangi gün için randevu planlamak istersiniz?'
      : isVirtualAppointmentTable(table.id) && col.id === VIRTUAL_APPOINTMENT_TIME_COL_ID
        ? 'Saat kaçta müsait olursunuz?'
        : col.config?.helpText ||
          (/telefon|phone|gsm/i.test(`${col.slug} ${col.name}`)
            ? 'Size ulaşabileceğimiz telefon numaranızı alabilir miyim?'
            : /ad_soyad|isim|ad$/i.test(col.slug)
              ? 'İsminizi ve soyisminizi öğrenebilir miyim?'
              : `${col.name} bilginizi paylaşabilir misiniz?`)

  return {
    ...patch,
    required: col.isRequired !== false,
    description: descTrim || defaultQuestion,
  }
}

interface DynamicBuiltRule {
  field: string
  fieldLabel: string
  operator: string
  value: string
  sourceTableId: string
  sourceTableSlug: string
  sourceTableName: string
  sourceColumnId: string
  sourceColumnSlug: string
  sourceColumnName: string
  sourceColumnType: string
  nodeLabel: string
}

function buildConditionRuleForBranchColumn(
  table: DynamicTableDef,
  col: DynamicColumnDef,
  entitySingular = 'Müşteri',
): DynamicBuiltRule {
  if (col.id === DYNAMIC_TABLE_ROW_EXISTS_COL_ID) {
    const field = buildDynamicTableExistsKey(table.slug || table.name)
    return {
      field,
      fieldLabel: formatDynamicTableExistsLabel(table.name),
      operator: 'equals',
      value: 'true',
      sourceTableId: table.id,
      sourceTableSlug: table.slug,
      sourceTableName: table.name,
      sourceColumnId: DYNAMIC_TABLE_ROW_EXISTS_COL_ID,
      sourceColumnSlug: '__row_exists__',
      sourceColumnName: 'Bu tabloda kayıtlı mı?',
      sourceColumnType: 'boolean',
      nodeLabel: isVirtualAppointmentTable(table.id)
        ? 'Yaklaşan Randevusu Var mı?'
        : `${entitySingular} Kayıtlı mı?`,
    }
  }
  const field = buildDynamicFieldKey(table.slug || table.name, col.slug || col.name)
  const fieldLabel = formatDynamicColumnDisplayLabel(table.name, col.name)
  let operator = 'notEmpty'
  let value = ''
  let nodeLabel = `${col.name} Bilgisi Var mı?`

  if (col.fieldType === 'boolean') {
    operator = 'equals'
    value = 'true'
    nodeLabel = `${col.name} Evet mi?`
  } else {
    const opts = getOptionsForDynamicColumn(col)
    if ((col.fieldType === 'select' || col.fieldType === 'multiselect') && opts.length > 0) {
      operator = col.fieldType === 'multiselect' ? 'contains' : 'equals'
      value = opts[0]
      nodeLabel = `${col.name} · ${opts[0]}`
    } else if (col.fieldType === 'number' || col.fieldType === 'currency') {
      operator = 'gt'
      value = '0'
      nodeLabel = `${col.name} Uygun mu?`
    }
  }

  return {
    field,
    fieldLabel,
    operator,
    value,
    sourceTableId: table.id,
    sourceTableSlug: table.slug,
    sourceTableName: table.name,
    sourceColumnId: col.id,
    sourceColumnSlug: col.slug,
    sourceColumnName: col.name,
    sourceColumnType: col.fieldType,
    nodeLabel,
  }
}

function buildConditionNodeData(rule: DynamicBuiltRule, customNodeLabel?: string): Record<string, any> {
  const { nodeLabel, ...rulePayload } = rule
  return {
    label: customNodeLabel || nodeLabel,
    conditionField: rule.field,
    conditionFieldLabel: rule.fieldLabel,
    operator: rule.operator,
    conditionValue: rule.value,
    sourceTableId: rule.sourceTableId,
    sourceTableSlug: rule.sourceTableSlug,
    sourceTableName: rule.sourceTableName,
    sourceColumnId: rule.sourceColumnId,
    sourceColumnSlug: rule.sourceColumnSlug,
    sourceColumnName: rule.sourceColumnName,
    sourceColumnType: rule.sourceColumnType,
    conditionLogic: 'AND',
    rules: [rulePayload],
  }
}

export function buildDynamicSampleFlow(
  templateId: string,
  tables: DynamicTableDef[] = [],
  explicitProfile?: ClinicDynamicProfile,
  relationTitlesByTableId?: RelationTitlesByTableId,
): { nodes: Array<Record<string, any>>; edges: Array<Record<string, any>> } {
  const normalizedKey =
    templateId === 'fast_survey'
      ? 'outbound'
      : templateId === 'fast_web'
        ? 'web'
        : templateId === 'fast_wa'
          ? 'whatsapp'
          : templateId === 'fast_phone'
            ? 'inbound'
            : templateId

  const profile = explicitProfile || inferClinicDynamicProfile(tables)
  const {
    primaryTable,
    secondaryTable,
    nameCol,
    phoneCol,
    topicTable,
    topicCol,
    linkTable,
    linkCol,
    branchTable,
    branchCol,
    ratingTable,
    ratingCol,
    entityLower,
    entitySingular,
    appointmentNoun,
  } = profile

  const dateCol = VIRTUAL_APPOINTMENT_TABLE.columns.find((c) => c.id === VIRTUAL_APPOINTMENT_DATE_COL_ID)!
  const timeCol = VIRTUAL_APPOINTMENT_TABLE.columns.find((c) => c.id === VIRTUAL_APPOINTMENT_TIME_COL_ID)!

  const nameNodeData =
    primaryTable && nameCol
      ? buildFieldNodeDataForColumn(primaryTable, nameCol, undefined, relationTitlesByTableId)
      : {
          fieldName: 'ad_soyad',
          label: 'Ad Soyad',
          fieldType: 'text',
          required: true,
          description: 'İsminizi ve soyisminizi öğrenebilir miyim?',
        }

  const phoneNodeData =
    primaryTable && phoneCol
      ? buildFieldNodeDataForColumn(primaryTable, phoneCol, undefined, relationTitlesByTableId)
      : {
          fieldName: 'telefon',
          label: 'Telefon Numarası',
          fieldType: 'phone',
          required: true,
          description: 'Size ulaşabileceğimiz telefon numaranızı alabilir miyim?',
        }

  const topicLinkHint =
    !String(topicCol?.config?.helpText || '').trim() && linkTable && linkCol && topicTable?.id === linkTable.id && topicCol
      ? `${topicCol.name} bilginizi veya ilgilendiğiniz ilanın adını paylaşabilir misiniz? (WhatsApp üzerinden doğrudan ilan linki de gönderebilirsiniz.)`
      : undefined

  const topicNodeData =
    topicTable && topicCol && topicCol.id !== nameCol?.id && topicCol.id !== phoneCol?.id
      ? buildFieldNodeDataForColumn(topicTable, topicCol, topicLinkHint, relationTitlesByTableId)
      : {
          fieldName: 'talep_konusu',
          label: secondaryTable ? `${secondaryTable.name} · Talep` : 'Talep / Konu',
          fieldType: 'text',
          required: false,
          description: secondaryTable
            ? `Hangi ${secondaryTable.name.toLocaleLowerCase('tr-TR')} hakkında görüşmek istersiniz?`
            : 'Size hangi konuda yardımcı olabilirim?',
        }

  const linkNodeData =
    linkTable && linkCol && linkCol.id !== nameCol?.id && linkCol.id !== phoneCol?.id
      ? {
          ...buildFieldNodeDataForColumn(
            linkTable,
            linkCol,
            'İlgilendiğiniz ilanın linkini (ör. Sahibinden, Hepsiemlak) veya ilan adını paylaşabilir misiniz?',
            relationTitlesByTableId,
          ),
          required: false,
        }
      : null
  const hasDistinctTopicNode = !(
    linkNodeData &&
    topicTable?.id === linkTable?.id &&
    topicCol?.id === linkCol?.id
  )

  const dateNodeData = buildFieldNodeDataForColumn(VIRTUAL_APPOINTMENT_TABLE, dateCol)
  const timeNodeData = buildFieldNodeDataForColumn(VIRTUAL_APPOINTMENT_TABLE, timeCol)

  if (normalizedKey === 'quick_note') {
    return {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 260, y: 20 }, data: { label: 'Karşılama Mesajı' } },
        { id: 'f_name', type: 'fieldNode', position: { x: 260, y: 150 }, data: nameNodeData },
        {
          id: 'f_note',
          type: 'fieldNode',
          position: { x: 260, y: 280 },
          data: topicTable && topicCol
            ? { ...topicNodeData, description: 'Ekibimize iletmek istediğiniz mesajınızı veya talebinizi paylaşır mısınız?' }
            : {
                fieldName: 'talep_notu',
                label: `${entitySingular} Notu / Talebi`,
                fieldType: 'text',
                required: true,
                description: 'Ekibimize iletmek istediğiniz mesajınızı paylaşır mısınız?',
              },
        },
        {
          id: 'act_note',
          type: 'actionNode',
          position: { x: 260, y: 410 },
          data: { action: 'save_patient_note', label: '🗒️ Notu Kaydet ve Bankoya İlet' },
        },
        {
          id: 'end',
          type: 'endNode',
          position: { x: 260, y: 540 },
          data: { label: 'Görüşmeyi Bitir', message: 'Notunuz ekibimize iletildi, en kısa sürede size dönüş yapılacaktır. İyi günler dileriz.' },
        },
      ],
      edges: [
        { id: 'e_s_ad', source: 'start', target: 'f_name' },
        { id: 'e_ad_not', source: 'f_name', target: 'f_note' },
        { id: 'e_not_act', source: 'f_note', target: 'act_note' },
        { id: 'e_act_end', source: 'act_note', target: 'end' },
      ],
    }
  }

  if (normalizedKey === 'outbound') {
    const condTable = ratingTable || branchTable || primaryTable || VIRTUAL_APPOINTMENT_TABLE
    const condCol: DynamicColumnDef =
      ratingCol ||
      branchCol ||
      ({
        id: DYNAMIC_TABLE_ROW_EXISTS_COL_ID,
        clinicId: '',
        tableId: condTable.id,
        name: 'Bu tabloda kayıtlı mı?',
        slug: '__row_exists__',
        fieldType: 'boolean',
        isPrimaryTitle: false,
        isRequired: false,
        isUnique: false,
        showInTable: false,
        width: 120,
        sortOrder: 0,
        config: {},
      } as DynamicColumnDef)
    const builtRule = buildConditionRuleForBranchColumn(condTable, condCol, entitySingular)

    const ratingFieldData =
      ratingTable && ratingCol
        ? buildFieldNodeDataForColumn(ratingTable, ratingCol, undefined, relationTitlesByTableId)
        : topicTable && topicCol
          ? buildFieldNodeDataForColumn(topicTable, topicCol, undefined, relationTitlesByTableId)
          : {
              fieldName: 'memnuniyet_notu',
              label: 'Değerlendirme',
              fieldType: 'text',
              required: true,
              description: `Aldığınız hizmetten memnuniyetinizi paylaşır mısınız?`,
            }

    return {
      nodes: [
        {
          id: 'start',
          type: 'startNode',
          position: { x: 250, y: 20 },
          data: {
            label: 'Giden Arama Başladı',
            greeting: `Merhaba, ${entityLower} memnuniyeti ve taleplerinizle ilgili kısaca görüşmek için arıyoruz. Müsait misiniz?`,
          },
        },
        { id: 'f1', type: 'fieldNode', position: { x: 250, y: 150 }, data: ratingFieldData },
        {
          id: 'cond1',
          type: 'conditionNode',
          position: { x: 250, y: 290 },
          data: buildConditionNodeData(builtRule),
        },
        {
          id: 'end_happy',
          type: 'endNode',
          position: { x: 80, y: 450 },
          data: { label: 'Olumlu Kapanış', message: 'Değerli geri bildiriminiz için çok teşekkür ederiz, iyi günler!' },
        },
        {
          id: 'act_followup',
          type: 'actionNode',
          position: { x: 420, y: 450 },
          data: {
            action: 'save_patient_note',
            label: primaryTable ? `🗒️ ${primaryTable.name} Geri Bildirim Notu` : '🗒️ Geri Bildirim Notu Kaydet',
          },
        },
        {
          id: 'end_sad',
          type: 'endNode',
          position: { x: 420, y: 590 },
          data: { label: 'Takip Kapanışı', message: 'Notumuzu aldık, yetkili ekibimiz en kısa sürede sizinle iletişime geçecektir.' },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'f1' },
        { id: 'e2', source: 'f1', target: 'cond1' },
        { id: 'e3', source: 'cond1', target: 'end_happy', sourceHandle: 'true', label: 'Evet' },
        { id: 'e4', source: 'cond1', target: 'act_followup', sourceHandle: 'false', label: 'Hayır' },
        { id: 'e5', source: 'act_followup', target: 'end_sad' },
      ],
    }
  }

  if (normalizedKey === 'web') {
    if (linkNodeData) {
      const yOff = hasDistinctTopicNode ? 130 : 0
      return {
        nodes: [
          {
            id: 'start',
            type: 'startNode',
            position: { x: 260, y: 20 },
            data: {
              label: 'Web Karşılama Mesajı',
              greeting: `Hoş geldiniz! İlgilendiğiniz ${secondaryTable ? `${secondaryTable.name.toLocaleLowerCase('tr-TR')} kaydının ` : ''}ilan linkini veya başlığını paylaşabilir, detay alabilir ve hızlıca ${appointmentNoun.toLocaleLowerCase('tr-TR')} oluşturabilirsiniz.`,
            },
          },
          { id: 'f_name', type: 'fieldNode', position: { x: 260, y: 140 }, data: nameNodeData },
          { id: 'f_phone', type: 'fieldNode', position: { x: 260, y: 270 }, data: phoneNodeData },
          { id: 'f_link', type: 'fieldNode', position: { x: 260, y: 400 }, data: linkNodeData },
          ...(hasDistinctTopicNode
            ? [{ id: 'f_topic', type: 'fieldNode', position: { x: 260, y: 530 }, data: topicNodeData }]
            : []),
          { id: 'f_date', type: 'fieldNode', position: { x: 260, y: 530 + yOff }, data: dateNodeData },
          { id: 'f_time', type: 'fieldNode', position: { x: 260, y: 660 + yOff }, data: timeNodeData },
          {
            id: 'act_save',
            type: 'actionNode',
            position: { x: 260, y: 790 + yOff },
            data: { action: 'save_appointment_pending', label: `📝 ${appointmentNoun} Talebi Oluştur` },
          },
          {
            id: 'end_ok',
            type: 'endNode',
            position: { x: 260, y: 920 + yOff },
            data: { label: 'Görüşmeyi Bitir', message: 'Talebiniz başarıyla oluşturuldu, iyi günler dileriz.' },
          },
        ],
        edges: hasDistinctTopicNode
          ? [
              { id: 'e1', source: 'start', target: 'f_name' },
              { id: 'e2', source: 'f_name', target: 'f_phone' },
              { id: 'e3', source: 'f_phone', target: 'f_link' },
              { id: 'e4', source: 'f_link', target: 'f_topic' },
              { id: 'e5', source: 'f_topic', target: 'f_date' },
              { id: 'e6', source: 'f_date', target: 'f_time' },
              { id: 'e7', source: 'f_time', target: 'act_save' },
              { id: 'e8', source: 'act_save', target: 'end_ok' },
            ]
          : [
              { id: 'e1', source: 'start', target: 'f_name' },
              { id: 'e2', source: 'f_name', target: 'f_phone' },
              { id: 'e3', source: 'f_phone', target: 'f_link' },
              { id: 'e4', source: 'f_link', target: 'f_date' },
              { id: 'e5', source: 'f_date', target: 'f_time' },
              { id: 'e6', source: 'f_time', target: 'act_save' },
              { id: 'e7', source: 'act_save', target: 'end_ok' },
            ],
      }
    }

    return {
      nodes: [
        {
          id: 'start',
          type: 'startNode',
          position: { x: 260, y: 20 },
          data: {
            label: 'Web Karşılama Mesajı',
            greeting: `Hoş geldiniz! Size hızlıca ${appointmentNoun.toLocaleLowerCase('tr-TR')} oluşturabilirim.`,
          },
        },
        { id: 'f_name', type: 'fieldNode', position: { x: 260, y: 140 }, data: nameNodeData },
        { id: 'f_phone', type: 'fieldNode', position: { x: 260, y: 270 }, data: phoneNodeData },
        { id: 'f_topic', type: 'fieldNode', position: { x: 260, y: 400 }, data: topicNodeData },
        { id: 'f_date', type: 'fieldNode', position: { x: 260, y: 530 }, data: dateNodeData },
        { id: 'f_time', type: 'fieldNode', position: { x: 260, y: 660 }, data: timeNodeData },
        {
          id: 'act_save',
          type: 'actionNode',
          position: { x: 260, y: 790 },
          data: { action: 'save_appointment_pending', label: `📝 ${appointmentNoun} Talebi Oluştur` },
        },
        {
          id: 'end_ok',
          type: 'endNode',
          position: { x: 260, y: 920 },
          data: { label: 'Görüşmeyi Bitir', message: 'Talebiniz başarıyla oluşturuldu, iyi günler dileriz.' },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'f_name' },
        { id: 'e2', source: 'f_name', target: 'f_phone' },
        { id: 'e3', source: 'f_phone', target: 'f_topic' },
        { id: 'e4', source: 'f_topic', target: 'f_date' },
        { id: 'e5', source: 'f_date', target: 'f_time' },
        { id: 'e6', source: 'f_time', target: 'act_save' },
        { id: 'e7', source: 'act_save', target: 'end_ok' },
      ],
    }
  }

  const condTable = primaryTable || branchTable || VIRTUAL_APPOINTMENT_TABLE
  const condCol: DynamicColumnDef =
    primaryTable || !branchCol
      ? ({
          id: DYNAMIC_TABLE_ROW_EXISTS_COL_ID,
          clinicId: '',
          tableId: condTable.id,
          name: 'Bu tabloda kayıtlı mı?',
          slug: '__row_exists__',
          fieldType: 'boolean',
          isPrimaryTitle: false,
          isRequired: false,
          isUnique: false,
          showInTable: false,
          width: 120,
          sortOrder: 0,
          config: {},
        } as DynamicColumnDef)
      : branchCol

  const condRule = buildConditionRuleForBranchColumn(condTable, condCol, entitySingular)

  if (normalizedKey === 'whatsapp') {
    if (linkNodeData) {
      const yOff = hasDistinctTopicNode ? 130 : 0
      return {
        nodes: [
          {
            id: 'start',
            type: 'startNode',
            position: { x: 260, y: 20 },
            data: {
              label: 'WhatsApp Mesajı Geldi',
              greeting: `Merhaba! WhatsApp hattımıza hoş geldiniz. İlgilendiğiniz ${secondaryTable ? `${secondaryTable.name.toLocaleLowerCase('tr-TR')} kaydının ` : ''}ilan linkini veya adını paylaşabilir, detay sorabilir ya da ${appointmentNoun.toLocaleLowerCase('tr-TR')} alabilirsiniz.`,
            },
          },
          {
            id: 'c_reg',
            type: 'conditionNode',
            position: { x: 260, y: 130 },
            data: buildConditionNodeData(condRule),
          },
          { id: 'f_name', type: 'fieldNode', position: { x: 440, y: 280 }, data: nameNodeData },
          { id: 'f_link', type: 'fieldNode', position: { x: 260, y: 400 }, data: linkNodeData },
          ...(hasDistinctTopicNode
            ? [{ id: 'f_topic', type: 'fieldNode', position: { x: 260, y: 530 }, data: topicNodeData }]
            : []),
          { id: 'f_date', type: 'fieldNode', position: { x: 260, y: 530 + yOff }, data: dateNodeData },
          { id: 'f_time', type: 'fieldNode', position: { x: 260, y: 660 + yOff }, data: timeNodeData },
          {
            id: 'act_save',
            type: 'actionNode',
            position: { x: 260, y: 790 + yOff },
            data: { action: 'save_appointment_pending', label: `📝 ${appointmentNoun} Talebi Oluştur` },
          },
          {
            id: 'end_ok',
            type: 'endNode',
            position: { x: 260, y: 920 + yOff },
            data: { label: 'Talebi Onayla ve Bitir', message: 'WhatsApp talebiniz kaydedildi, sağlıklı günler dileriz.' },
          },
        ],
        edges: hasDistinctTopicNode
          ? [
              { id: 'e1', source: 'start', target: 'c_reg' },
              { id: 'e2', source: 'c_reg', target: 'f_link', sourceHandle: 'true', label: 'Evet' },
              { id: 'e3', source: 'c_reg', target: 'f_name', sourceHandle: 'false', label: 'Hayır' },
              { id: 'e4', source: 'f_name', target: 'f_link' },
              { id: 'e5', source: 'f_link', target: 'f_topic' },
              { id: 'e6', source: 'f_topic', target: 'f_date' },
              { id: 'e7', source: 'f_date', target: 'f_time' },
              { id: 'e8', source: 'f_time', target: 'act_save' },
              { id: 'e9', source: 'act_save', target: 'end_ok' },
            ]
          : [
              { id: 'e1', source: 'start', target: 'c_reg' },
              { id: 'e2', source: 'c_reg', target: 'f_link', sourceHandle: 'true', label: 'Evet' },
              { id: 'e3', source: 'c_reg', target: 'f_name', sourceHandle: 'false', label: 'Hayır' },
              { id: 'e4', source: 'f_name', target: 'f_link' },
              { id: 'e5', source: 'f_link', target: 'f_date' },
              { id: 'e6', source: 'f_date', target: 'f_time' },
              { id: 'e7', source: 'f_time', target: 'act_save' },
              { id: 'e8', source: 'act_save', target: 'end_ok' },
            ],
      }
    }

    return {
      nodes: [
        {
          id: 'start',
          type: 'startNode',
          position: { x: 260, y: 20 },
          data: {
            label: 'WhatsApp Mesajı Geldi',
            greeting: `Merhaba! WhatsApp hattımıza hoş geldiniz. ${secondaryTable ? `${secondaryTable.name} veya ` : ''}${appointmentNoun.toLocaleLowerCase('tr-TR')} konusunda nasıl yardımcı olabilirim?`,
          },
        },
        {
          id: 'c_reg',
          type: 'conditionNode',
          position: { x: 260, y: 130 },
          data: buildConditionNodeData(condRule),
        },
        { id: 'f_name', type: 'fieldNode', position: { x: 440, y: 280 }, data: nameNodeData },
        { id: 'f_topic', type: 'fieldNode', position: { x: 260, y: 400 }, data: topicNodeData },
        { id: 'f_date', type: 'fieldNode', position: { x: 260, y: 530 }, data: dateNodeData },
        { id: 'f_time', type: 'fieldNode', position: { x: 260, y: 660 }, data: timeNodeData },
        {
          id: 'act_save',
          type: 'actionNode',
          position: { x: 260, y: 790 },
          data: { action: 'save_appointment_pending', label: `📝 ${appointmentNoun} Talebi Oluştur` },
        },
        {
          id: 'end_ok',
          type: 'endNode',
          position: { x: 260, y: 920 },
          data: { label: 'Talebi Onayla ve Bitir', message: 'WhatsApp talebiniz kaydedildi, sağlıklı günler dileriz.' },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'c_reg' },
        { id: 'e2', source: 'c_reg', target: 'f_topic', sourceHandle: 'true', label: 'Evet' },
        { id: 'e3', source: 'c_reg', target: 'f_name', sourceHandle: 'false', label: 'Hayır' },
        { id: 'e4', source: 'f_name', target: 'f_topic' },
        { id: 'e5', source: 'f_topic', target: 'f_date' },
        { id: 'e6', source: 'f_date', target: 'f_time' },
        { id: 'e7', source: 'f_time', target: 'act_save' },
        { id: 'e8', source: 'act_save', target: 'end_ok' },
      ],
    }
  }

  // Default: inbound or full_asterisk
  return {
    nodes: [
      {
        id: 'start',
        type: 'startNode',
        position: { x: 260, y: 20 },
        data: { label: 'Karşılama Mesajı' },
      },
      {
        id: 'c_registered',
        type: 'conditionNode',
        position: { x: 260, y: 130 },
        data: buildConditionNodeData(condRule),
      },
      { id: 'f_name', type: 'fieldNode', position: { x: 440, y: 270 }, data: nameNodeData },
      { id: 'f_topic', type: 'fieldNode', position: { x: 260, y: 400 }, data: topicNodeData },
      { id: 'f_date', type: 'fieldNode', position: { x: 260, y: 530 }, data: dateNodeData },
      { id: 'f_time', type: 'fieldNode', position: { x: 260, y: 660 }, data: timeNodeData },
      {
        id: 'act_book',
        type: 'actionNode',
        position: { x: 260, y: 790 },
        data: { action: 'save_appointment_pending', label: `📝 ${appointmentNoun} Talebi Oluştur` },
      },
      {
        id: 'end_ok',
        type: 'endNode',
        position: { x: 260, y: 920 },
        data: { label: 'Görüşmeyi Bitir', message: `${appointmentNoun} talebiniz kaydedildi, iyi günler dileriz!` },
      },
      ...(normalizedKey === 'full_asterisk'
        ? [
            {
              id: 'action_transfer_global',
              type: 'actionNode',
              position: { x: 640, y: 80 },
              data: {
                action: 'transfer_call',
                label: '📞 Santrale / Yetkiliye Aktar',
                transferNumber: 'resepsiyon',
                triggerKeywords: 'resepsiyon, operatör, sekreter, yetkili, canlı destek',
                requireConfirmation: true,
              },
            },
            {
              id: 'action_wa_loc_global',
              type: 'actionNode',
              position: { x: 640, y: 220 },
              data: {
                action: 'send_wa_location',
                label: '📍 WhatsApp’tan Konum Gönder',
                triggerKeywords: 'konum, adres, yol tarifi, nerede',
              },
            },
          ]
        : []),
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'c_registered' },
      { id: 'e2', source: 'c_registered', target: 'f_topic', sourceHandle: 'true', label: 'Evet' },
      { id: 'e3', source: 'c_registered', target: 'f_name', sourceHandle: 'false', label: 'Hayır' },
      { id: 'e4', source: 'f_name', target: 'f_topic' },
      { id: 'e5', source: 'f_topic', target: 'f_date' },
      { id: 'e6', source: 'f_date', target: 'f_time' },
      { id: 'e7', source: 'f_time', target: 'act_book' },
      { id: 'e8', source: 'act_book', target: 'end_ok' },
    ],
  }
}

export function rebindLegacyNodesToDynamicTables<T extends { id: string; type?: string; data?: Record<string, any> }>(
  nodes: T[],
  tables: DynamicTableDef[],
  explicitProfile?: ClinicDynamicProfile,
  relationTitlesByTableId?: RelationTitlesByTableId,
): { nodes: T[]; changed: boolean } {
  if (!Array.isArray(nodes) || nodes.length === 0) return { nodes, changed: false }
  const profile = explicitProfile || inferClinicDynamicProfile(tables)
  const realTables = tables.filter((t) => !isVirtualAppointmentTable(t.id))
  const validTableIds = new Set<string>([
    ...realTables.map((t) => t.id),
    VIRTUAL_APPOINTMENT_TABLE_ID,
  ])

  let changed = false

  const nextNodes = nodes.map((node) => {
    const data = node.data || {}
    const isFieldNode = node.type === 'fieldNode' || node.type === 'FIELD'
    const isConditionNode = node.type === 'conditionNode' || node.type === 'CONDITION'

    if (isFieldNode) {
      const currentTableId = String(data.sourceTableId || '').trim()
      const hasValidTable = Boolean(currentTableId && validTableIds.has(currentTableId))
      const rawField = String(data.fieldName || '').trim()

      if (hasValidTable) {
        if (currentTableId === VIRTUAL_APPOINTMENT_TABLE_ID) return node
        const tbl = realTables.find((t) => t.id === currentTableId)
        const col = tbl?.columns.find((c) => c.id === data.sourceColumnId)
        if (tbl && col) return node
      }

      if (rawField === 'tarih') {
        const col = VIRTUAL_APPOINTMENT_TABLE.columns.find((c) => c.id === VIRTUAL_APPOINTMENT_DATE_COL_ID)!
        const rebound = buildFieldNodeDataForColumn(VIRTUAL_APPOINTMENT_TABLE, col, data.description, relationTitlesByTableId)
        changed = true
        return { ...node, data: { ...data, ...rebound, description: (data.description || '').trim() ? data.description : rebound.description } }
      }
      if (rawField === 'saat') {
        const col = VIRTUAL_APPOINTMENT_TABLE.columns.find((c) => c.id === VIRTUAL_APPOINTMENT_TIME_COL_ID)!
        const rebound = buildFieldNodeDataForColumn(VIRTUAL_APPOINTMENT_TABLE, col, data.description, relationTitlesByTableId)
        changed = true
        return { ...node, data: { ...data, ...rebound, description: (data.description || '').trim() ? data.description : rebound.description } }
      }

      const lowerField = rawField.toLocaleLowerCase('tr-TR')
      let targetTable: DynamicTableDef | null = null
      let targetCol: DynamicColumnDef | null = null

      if (/(musteri_adi|ad_soyad|hasta_adi|^ad$|^isim$)/i.test(lowerField) && profile.primaryTable && profile.nameCol) {
        targetTable = profile.primaryTable
        targetCol = profile.nameCol
      } else if (/^(telefon|phone|gsm|cep)$/i.test(lowerField) && profile.primaryTable && profile.phoneCol) {
        targetTable = profile.primaryTable
        targetCol = profile.phoneCol
      } else if (/^(email|eposta|e_posta)$/i.test(lowerField) && profile.primaryTable && profile.emailCol) {
        targetTable = profile.primaryTable
        targetCol = profile.emailCol
      } else if (/^(sikayet|şikayet|talep|konu|hizmet|randevu_turu|not|notlar|islem_turu)$/i.test(lowerField) && profile.topicTable && profile.topicCol) {
        targetTable = profile.topicTable
        targetCol = profile.topicCol
      } else if (/^(memnuniyet|puan|skor)$/i.test(lowerField) && profile.ratingTable && profile.ratingCol) {
        targetTable = profile.ratingTable
        targetCol = profile.ratingCol
      } else if (currentTableId && !hasValidTable) {
        const colSlugPart = rawField.includes('__') ? rawField.split('__').slice(1).join('__') : rawField
        for (const tbl of realTables) {
          const found = tbl.columns.find((c) => sanitizeFlowSlug(c.slug) === colSlugPart || c.slug === colSlugPart)
          if (found) {
            targetTable = tbl
            targetCol = found
            break
          }
        }
      }

      if (targetTable && targetCol) {
        const rebound = buildFieldNodeDataForColumn(targetTable, targetCol, data.description, relationTitlesByTableId)
        changed = true
        return {
          ...node,
          data: {
            ...data,
            ...rebound,
            description: (data.description || '').trim() ? data.description : rebound.description,
          },
        }
      }
      return node
    }

    if (isConditionNode) {
      if (data.conditionField === 'user_intent' || data.operator === 'intent') return node

      const rawRules: Array<Record<string, any>> =
        Array.isArray(data.rules) && data.rules.length > 0
          ? data.rules
          : Array.isArray(data.conditions) && data.conditions.length > 0
            ? data.conditions
            : [
                {
                  field: data.conditionField || '',
                  operator: data.operator || 'equals',
                  value: data.conditionValue ?? '',
                  valueTo: data.conditionValueTo,
                  fieldLabel: data.conditionFieldLabel,
                  sourceTableId: data.sourceTableId,
                  sourceTableSlug: data.sourceTableSlug,
                  sourceTableName: data.sourceTableName,
                  sourceColumnId: data.sourceColumnId,
                  sourceColumnSlug: data.sourceColumnSlug,
                  sourceColumnName: data.sourceColumnName,
                  sourceColumnType: data.sourceColumnType,
                },
              ]

      let ruleChanged = false
      const nextRules = rawRules.map((rule) => {
        if (rule.field === 'user_intent' || rule.operator === 'intent') return rule
        let nextOp = String(rule.operator || 'equals')
        if (nextOp === 'not_empty') {
          nextOp = 'notEmpty'
          ruleChanged = true
        } else if (nextOp === 'not_equals') {
          nextOp = 'notEquals'
          ruleChanged = true
        }

        const rField = String(rule.field || '').trim()
        const rTableId = String(rule.sourceTableId || '').trim()
        const hasValidRTable = Boolean(rTableId && validTableIds.has(rTableId))

        if (hasValidRTable && rTableId !== VIRTUAL_APPOINTMENT_TABLE_ID) {
          const tbl = realTables.find((t) => t.id === rTableId)
          const col = tbl?.columns.find((c) => c.id === rule.sourceColumnId)
          if (tbl && (col || rule.sourceColumnId === DYNAMIC_TABLE_ROW_EXISTS_COL_ID)) {
            if (col?.fieldType === 'text' && ['gt', 'gte', 'lt', 'lte'].includes(nextOp)) {
              ruleChanged = true
              return { ...rule, operator: 'contains' }
            }
            return nextOp !== rule.operator ? { ...rule, operator: nextOp } : rule
          }
        }
        if (rTableId === VIRTUAL_APPOINTMENT_TABLE_ID && rule.sourceColumnId) {
          return nextOp !== rule.operator ? { ...rule, operator: nextOp } : rule
        }

        if ((rField === 'kayitli' || rField === 'caller.isRegistered' || rField === 'caller.isKnownPatient' || rField.endsWith('____kayitli')) && profile.primaryTable) {
          ruleChanged = true
          return {
            ...rule,
            field: buildDynamicTableExistsKey(profile.primaryTable.slug || profile.primaryTable.name),
            fieldLabel: formatDynamicTableExistsLabel(profile.primaryTable.name),
            sourceTableId: profile.primaryTable.id,
            sourceTableSlug: profile.primaryTable.slug,
            sourceTableName: profile.primaryTable.name,
            sourceColumnId: DYNAMIC_TABLE_ROW_EXISTS_COL_ID,
            sourceColumnSlug: '__row_exists__',
            sourceColumnName: 'Bu tabloda kayıtlı mı?',
            sourceColumnType: 'boolean',
            operator: nextOp === 'notEquals' ? 'notEquals' : 'equals',
            value: String(rule.value ?? 'true') === 'false' ? 'false' : 'true',
          }
        }
        if (rField === 'tarih') {
          ruleChanged = true
          const col = VIRTUAL_APPOINTMENT_TABLE.columns.find((c) => c.id === VIRTUAL_APPOINTMENT_DATE_COL_ID)!
          return {
            ...rule,
            ...mapDynamicColumnToFlowField(VIRTUAL_APPOINTMENT_TABLE, col),
            field: 'tarih',
            fieldLabel: formatDynamicColumnDisplayLabel('Randevu Takvimi', col.name),
            operator: nextOp,
          }
        }
        if (rField === 'saat') {
          ruleChanged = true
          const col = VIRTUAL_APPOINTMENT_TABLE.columns.find((c) => c.id === VIRTUAL_APPOINTMENT_TIME_COL_ID)!
          return {
            ...rule,
            ...mapDynamicColumnToFlowField(VIRTUAL_APPOINTMENT_TABLE, col),
            field: 'saat',
            fieldLabel: formatDynamicColumnDisplayLabel('Randevu Takvimi', col.name),
            operator: nextOp,
          }
        }
        if (rField === 'caller.hasUpcomingAppointment' || rField === 'caller.isKnownPatient' || rField === 'caller.isRegistered') {
          ruleChanged = true
          return {
            ...rule,
            field: 'caller.hasUpcomingAppointment',
            fieldLabel: formatDynamicTableExistsLabel('Randevu Takvimi'),
            sourceTableId: VIRTUAL_APPOINTMENT_TABLE_ID,
            sourceTableSlug: 'randevu_takvimi',
            sourceTableName: 'Randevu Takvimi',
            sourceColumnId: DYNAMIC_TABLE_ROW_EXISTS_COL_ID,
            sourceColumnSlug: '__row_exists__',
            sourceColumnName: 'Yaklaşan randevusu var mı?',
            sourceColumnType: 'boolean',
            operator: 'equals',
            value: String(rule.value ?? 'true') === 'false' ? 'false' : 'true',
          }
        }
        if (rField === 'sikayet' && profile.topicTable && profile.topicCol) {
          ruleChanged = true
          const op =
            profile.topicCol.fieldType === 'text' && ['gt', 'gte', 'lt', 'lte'].includes(nextOp)
              ? 'contains'
              : nextOp === 'equals' && !rule.value
                ? 'notEmpty'
                : nextOp
          const mapped = mapDynamicColumnToFlowField(profile.topicTable, profile.topicCol, relationTitlesByTableId)
          return {
            ...rule,
            field: mapped.fieldName,
            fieldLabel: mapped.label,
            sourceTableId: mapped.sourceTableId,
            sourceTableSlug: mapped.sourceTableSlug,
            sourceTableName: mapped.sourceTableName,
            sourceColumnId: mapped.sourceColumnId,
            sourceColumnSlug: mapped.sourceColumnSlug,
            sourceColumnName: mapped.sourceColumnName,
            sourceColumnType: mapped.sourceColumnType,
            operator: op,
          }
        }
        if ((rField === 'memnuniyet' || rField === 'memnuniyet_puani') && profile.ratingTable && profile.ratingCol) {
          ruleChanged = true
          const mapped = mapDynamicColumnToFlowField(profile.ratingTable, profile.ratingCol, relationTitlesByTableId)
          return {
            ...rule,
            field: mapped.fieldName,
            fieldLabel: mapped.label,
            sourceTableId: mapped.sourceTableId,
            sourceTableSlug: mapped.sourceTableSlug,
            sourceTableName: mapped.sourceTableName,
            sourceColumnId: mapped.sourceColumnId,
            sourceColumnSlug: mapped.sourceColumnSlug,
            sourceColumnName: mapped.sourceColumnName,
            sourceColumnType: mapped.sourceColumnType,
            operator: nextOp,
          }
        }
        if (rTableId && !hasValidRTable) {
          if (rField.endsWith('____kayitli') && profile.primaryTable) {
            ruleChanged = true
            return {
              ...rule,
              field: buildDynamicTableExistsKey(profile.primaryTable.slug || profile.primaryTable.name),
              fieldLabel: formatDynamicTableExistsLabel(profile.primaryTable.name),
              sourceTableId: profile.primaryTable.id,
              sourceTableSlug: profile.primaryTable.slug,
              sourceTableName: profile.primaryTable.name,
              sourceColumnId: DYNAMIC_TABLE_ROW_EXISTS_COL_ID,
              sourceColumnSlug: '__row_exists__',
              sourceColumnName: 'Bu tabloda kayıtlı mı?',
              sourceColumnType: 'boolean',
              operator: nextOp,
            }
          }
          const colSlugPart = rField.includes('__') ? rField.split('__').slice(1).join('__') : rField
          for (const tbl of realTables) {
            const found = tbl.columns.find((c) => sanitizeFlowSlug(c.slug) === colSlugPart || c.slug === colSlugPart)
            if (found) {
              ruleChanged = true
              const mapped = mapDynamicColumnToFlowField(tbl, found, relationTitlesByTableId)
              return {
                ...rule,
                field: mapped.fieldName,
                fieldLabel: mapped.label,
                sourceTableId: mapped.sourceTableId,
                sourceTableSlug: mapped.sourceTableSlug,
                sourceTableName: mapped.sourceTableName,
                sourceColumnId: mapped.sourceColumnId,
                sourceColumnSlug: mapped.sourceColumnSlug,
                sourceColumnName: mapped.sourceColumnName,
                sourceColumnType: mapped.sourceColumnType,
                operator: nextOp,
              }
            }
          }
        }
        return nextOp !== rule.operator ? { ...rule, operator: nextOp } : rule
      })

      if (!ruleChanged) return node
      changed = true
      const primary = nextRules[0] || {}
      const updatedLabel =
        (!data.label ||
          data.label === 'Hasta Kayıtlı mı?' ||
          data.label === 'Arayan Numara (CallerID) Kayıtlı mı?' ||
          data.label === 'Koşul') &&
        primary.sourceColumnId === DYNAMIC_TABLE_ROW_EXISTS_COL_ID &&
        profile.primaryTable
          ? `${profile.entitySingular} Kayıtlı mı?`
          : data.label

      return {
        ...node,
        data: {
          ...data,
          label: updatedLabel,
          conditionLogic: data.conditionLogic === 'OR' ? 'OR' : 'AND',
          rules: nextRules,
          conditionField: primary.field ?? data.conditionField,
          conditionFieldLabel: primary.fieldLabel ?? data.conditionFieldLabel,
          operator: primary.operator ?? data.operator,
          conditionValue: primary.value ?? data.conditionValue,
          conditionValueTo: primary.valueTo,
          sourceTableId: primary.sourceTableId ?? data.sourceTableId,
          sourceTableSlug: primary.sourceTableSlug ?? data.sourceTableSlug,
          sourceTableName: primary.sourceTableName ?? data.sourceTableName,
          sourceColumnId: primary.sourceColumnId ?? data.sourceColumnId,
          sourceColumnSlug: primary.sourceColumnSlug ?? data.sourceColumnSlug,
          sourceColumnName: primary.sourceColumnName ?? data.sourceColumnName,
          sourceColumnType: primary.sourceColumnType ?? data.sourceColumnType,
        },
      }
    }

    return node
  })

  return { nodes: nextNodes, changed }
}

