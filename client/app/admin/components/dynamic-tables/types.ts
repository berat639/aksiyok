export type DynamicFieldType =
  | 'text'
  | 'number'
  | 'currency'
  | 'phone'
  | 'email'
  | 'date'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'relation'

export type RelationCardinality = 'one_to_one' | 'one_to_many' | 'many_to_many'

export type DynamicTableOrigin = 'manual' | 'template' | 'ai' | 'system'

export const TABLE_ORIGIN_META: Record<DynamicTableOrigin, { label: string }> = {
  manual: { label: 'Manuel' },
  template: { label: 'Şablon' },
  ai: { label: 'Yapay Zeka' },
  system: { label: 'Sistem' },
}

export interface SelectOptionItem {
  id: string
  label: string
  color?: string
}

export interface DynamicColumnConfig {
  options?: SelectOptionItem[]
  currencySymbol?: string
  placeholder?: string
  helpText?: string
  relationId?: string
  targetTableId?: string
  relationDirection?: 'forward' | 'inverse'
  cardinality?: RelationCardinality
  allowMultiple?: boolean
}

export interface DynamicColumnDef {
  id: string
  clinicId: string
  tableId: string
  name: string
  slug: string
  fieldType: DynamicFieldType
  isPrimaryTitle: boolean
  isRequired: boolean
  isUnique: boolean
  showInTable: boolean
  width: number
  sortOrder: number
  config: DynamicColumnConfig
}

export interface DynamicTableDef {
  id: string
  clinicId: string
  name: string
  slug: string
  icon: string
  color: string
  description: string | null
  origin?: DynamicTableOrigin
  canvasX: number
  canvasY: number
  sortOrder: number
  rowCount: number
  archivedRowCount: number
  columns: DynamicColumnDef[]
}

export interface DynamicRelationDef {
  id: string
  clinicId: string
  sourceTableId: string
  sourceColumnId: string
  targetTableId: string
  inverseColumnId: string | null
  cardinality: RelationCardinality
  onDelete: 'set_null' | 'cascade' | 'restrict'
}

export interface DynamicAppointmentConfigDef {
  id: string
  clinicId: string
  tableId: string
  enabled: boolean
  titleColumnId: string | null
  phoneColumnId: string | null
  emailColumnId: string | null
  isRequiredInAppointment: boolean
  allowMultiple: boolean
  includeRelatedTables: boolean
}

export type DynamicModuleRole =
  | 'finance_income'
  | 'finance_expense'
  | 'stock_inventory'
  | 'stock_movement'
  | 'asset_maintenance'

export interface DynamicModuleMapping {
  amountColumnId?: string | null
  dateColumnId?: string | null
  dueDateColumnId?: string | null
  statusColumnId?: string | null
  methodColumnId?: string | null
  categoryColumnId?: string | null
  personRelationColumnId?: string | null
  serviceRelationColumnId?: string | null
  quantityColumnId?: string | null
  minThresholdColumnId?: string | null
  unitColumnId?: string | null
  unitCostColumnId?: string | null
  expiryDateColumnId?: string | null
  isPeriodicColumnId?: string | null
  periodicDaysColumnId?: string | null
  scheduledDateColumnId?: string | null
  completedDateColumnId?: string | null
  nextDateColumnId?: string | null
  movementTypeColumnId?: string | null
  itemRelationColumnId?: string | null
  actorColumnId?: string | null
  notesColumnId?: string | null
}

export interface DynamicModuleConfigDef {
  id: string
  clinicId: string
  tableId: string
  moduleRole: DynamicModuleRole
  enabled: boolean
  mapping: DynamicModuleMapping
}

export const MODULE_ROLE_META: Record<
  DynamicModuleRole,
  { label: string; shortBadge: string; tabHint: string }
> = {
  finance_income: {
    label: 'Gelir & Tahsilat Tablosu',
    shortBadge: 'Gelir / Tahsilat',
    tabHint: 'Ödemeler & Finans sekmesinde tahsilat ve alacak takibini besler.',
  },
  finance_expense: {
    label: 'Gider & Masraf Tablosu',
    shortBadge: 'Gider / Masraf',
    tabHint: 'Ödemeler & Finans sekmesinde gider grafiğini ve net nakit akışını besler.',
  },
  stock_inventory: {
    label: 'Stok & Envanter Tablosu',
    shortBadge: 'Stok / Envanter',
    tabHint: 'Stok & Bakım sekmesinde kritik stok, son kullanma tarihi ve hızlı stok düşümünü çalıştırır.',
  },
  asset_maintenance: {
    label: 'Cihaz & Periyodik Bakım Tablosu',
    shortBadge: 'Periyodik Bakım',
    tabHint: 'Stok & Bakım sekmesinde yaklaşan periyodik bakımları ve otomatik sonraki bakım hesabını çalıştırır.',
  },
  stock_movement: {
    label: 'Stok & Bakım Hareket Geçmişi',
    shortBadge: 'Stok Hareketi',
    tabHint: 'Stok giriş, kullanım, zayi, imha, iade ve bakım hareketlerinin tarihçesini tutar.',
  },
}

export interface StudioSchemaResponse {
  tabLabel: string
  canManageSchema: boolean
  appointmentNodePosition: { x: number; y: number }
  tables: DynamicTableDef[]
  relations: DynamicRelationDef[]
  appointmentConfigs: DynamicAppointmentConfigDef[]
  moduleConfigs?: DynamicModuleConfigDef[]
}

export interface LinkedRowSummary {
  id: string
  tableId: string
  displayTitle: string
}

export interface DynamicRowItem {
  id: string
  clinicId: string
  tableId: string
  displayTitle: string
  values: Record<string, any>
  relations: Record<string, LinkedRowSummary[]>
  appointmentCount: number
  isArchived: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export const NON_RELATION_FIELD_TYPES: DynamicFieldType[] = [
  'text',
  'phone',
  'number',
  'currency',
  'date',
  'select',
  'multiselect',
  'boolean',
  'email',
]

export const FIELD_TYPE_META: Record<
  DynamicFieldType,
  { label: string; shortBadge: string; description: string }
> = {
  text: { label: 'Yazı', shortBadge: '', description: 'Ad, başlık, adres veya açıklama metni' },
  number: { label: 'Sayı', shortBadge: '', description: 'Tam veya ondalıklı sayı' },
  currency: { label: 'Para Tutarı (₺)', shortBadge: '', description: 'Para birimi formatlı tutar' },
  phone: { label: 'Telefon', shortBadge: '', description: 'Telefon numarası alanı' },
  email: { label: 'E-posta', shortBadge: '', description: 'E-posta adresi' },
  date: { label: 'Tarih', shortBadge: '', description: 'Takvim seçicili tarih alanı' },
  boolean: { label: 'Evet / Hayır', shortBadge: '', description: 'Evet veya Hayır kutusu' },
  select: { label: 'Tekli Seçenek', shortBadge: '', description: 'Açılır seçenek listesi' },
  multiselect: { label: 'Çoklu Seçenek', shortBadge: '', description: 'Birden fazla seçenek' },
  relation: { label: 'Başka Tablodan Seçim', shortBadge: '', description: 'Başka bir tablodaki kayıtlara bağlantı' },
}

export const CARDINALITY_LABELS: Record<RelationCardinality, string> = {
  one_to_many: 'Alt Liste Bağlantısı',
  many_to_many: 'Çoklu Eşleşme',
  one_to_one: 'Bire Bir Eşleşme',
}

export const ON_DELETE_LABELS: Record<'set_null' | 'cascade' | 'restrict', string> = {
  set_null: 'Bağlantıyı Boşa Çıkar',
  cascade: 'Bağlı Alt Kayıtları da Sil',
  restrict: 'Bağlı Kayıt Varsa Silmeyi Engelle',
}

export function formatDynamicDateTR(val: unknown): string {
  if (!val) return '—'
  const str = String(val).trim()
  if (!str) return '—'
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const d = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
    }
  }
  const d = new Date(str)
  if (Number.isNaN(d.getTime())) return str
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatCurrencyTR(val: unknown, symbol = '₺'): string {
  if (val === null || val === undefined || val === '') return '—'
  const num = Number(val)
  if (!Number.isFinite(num)) return String(val)
  return `${num.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${symbol}`
}
