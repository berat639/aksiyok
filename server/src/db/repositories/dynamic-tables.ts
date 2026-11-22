import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  clinics,
  conversationFlows,
  dentalAppointments,
  dynamicAppointmentConfigs,
  dynamicAppointmentLinks,
  dynamicColumns,
  dynamicModuleConfigs,
  dynamicRelations,
  dynamicRowLinks,
  dynamicRows,
  dynamicTables,
  financeAccountingSyncRecords,
  users,
} from '../schema'
import { ensureDynamicTablesSchema } from '../dynamic-tables-schema'
import { getSetting, setSetting } from './settings'
import { currentBusinessTemplate, currentClinicId, requireClinicId } from '../../tenancy/context'
import type { FlowConditionGroup, FlowConditionRule, FlowEdge, FlowNode } from './flows'
import {
  cellMatchesParsedUrl,
  escapeSqlLike,
  extractSearchWordTokens,
  extractUrlsFromText,
  isUrlOnlyQuery,
  parseUrlLookupParts,
  type ParsedUrlLookupParts,
} from '../../services/dynamic-link-matcher'
import {
  buildCanonicalAccountingEntry,
  calculateAccountingAmounts,
  CANONICAL_FINANCE_TABLE_DESCRIPTIONS,
  CANONICAL_FINANCE_TABLE_NAMES,
  isFinanceModuleRole,
  normalizeAccountingPaymentStatus,
  normalizeCurrencyCode,
  normalizeDocumentType,
  normalizeExchangeRate,
  normalizeVatRate,
  resolveTdhpAccountCode,
  roundMoney,
  STANDARD_ACCOUNTING_SYNC_OPTIONS,
  STANDARD_CURRENCY_OPTIONS,
  STANDARD_DOCUMENT_TYPE_OPTIONS,
  STANDARD_EXPENSE_CATEGORY_OPTIONS,
  STANDARD_INCOME_CATEGORY_OPTIONS,
  STANDARD_PAYMENT_METHOD_OPTIONS,
  STANDARD_PAYMENT_STATUS_OPTIONS,
  STANDARD_VAT_RATE_OPTIONS,
  syncStatusToOptionId,
} from '../../services/pre-accounting-core'

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

export const ALLOWED_TABLE_ORIGINS: readonly DynamicTableOrigin[] = [
  'manual',
  'template',
  'ai',
  'system',
] as const

export interface SelectOptionItem {
  id: string
  label: string
  color: string
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

export const ALLOWED_FIELD_TYPES: readonly DynamicFieldType[] = [
  'text',
  'number',
  'currency',
  'phone',
  'email',
  'date',
  'boolean',
  'select',
  'multiselect',
  'relation',
] as const

export type DynamicModuleRole =
  | 'finance_income'
  | 'finance_expense'
  | 'stock_inventory'
  | 'stock_movement'
  | 'asset_maintenance'

export const ALLOWED_MODULE_ROLES: readonly DynamicModuleRole[] = [
  'finance_income',
  'finance_expense',
  'stock_inventory',
  'stock_movement',
  'asset_maintenance',
] as const

export interface DynamicModuleMapping {
  amountColumnId?: string | null
  netAmountColumnId?: string | null
  vatRateColumnId?: string | null
  vatAmountColumnId?: string | null
  currencyColumnId?: string | null
  exchangeRateColumnId?: string | null
  documentTypeColumnId?: string | null
  documentNumberColumnId?: string | null
  counterpartyNameColumnId?: string | null
  counterpartyTaxIdColumnId?: string | null
  accountingCodeColumnId?: string | null
  accountingSyncStatusColumnId?: string | null
  dateColumnId?: string | null
  dueDateColumnId?: string | null
  statusColumnId?: string | null
  methodColumnId?: string | null
  categoryColumnId?: string | null
  quantityColumnId?: string | null
  minThresholdColumnId?: string | null
  unitColumnId?: string | null
  unitCostColumnId?: string | null
  expiryDateColumnId?: string | null
  isPeriodicColumnId?: string | null
  periodicDaysColumnId?: string | null
  scheduledDateColumnId?: string | null
  nextDateColumnId?: string | null
  completedDateColumnId?: string | null
  movementTypeColumnId?: string | null
  personRelationColumnId?: string | null
  serviceRelationColumnId?: string | null
  itemRelationColumnId?: string | null
  notesColumnId?: string | null
  actorColumnId?: string | null
}

export const CORE_PROTECTED_FINANCE_MAPPING_KEYS: ReadonlyArray<keyof DynamicModuleMapping> = [
  'amountColumnId',
  'netAmountColumnId',
  'vatRateColumnId',
  'vatAmountColumnId',
  'currencyColumnId',
  'exchangeRateColumnId',
  'documentTypeColumnId',
  'documentNumberColumnId',
  'counterpartyNameColumnId',
  'counterpartyTaxIdColumnId',
  'accountingCodeColumnId',
  'accountingSyncStatusColumnId',
  'dateColumnId',
  'dueDateColumnId',
  'statusColumnId',
  'methodColumnId',
  'categoryColumnId',
  'quantityColumnId',
  'unitCostColumnId',
  'notesColumnId',
]

const CORE_PROTECTED_FINANCE_KEY_SET = new Set<string>(CORE_PROTECTED_FINANCE_MAPPING_KEYS)

function mergeFinanceMappingPreservingCore(
  inferred: DynamicModuleMapping,
  saved: Record<string, unknown> | null | undefined,
  validColIds: Set<string>
): DynamicModuleMapping {
  const merged: DynamicModuleMapping = { ...inferred }
  if (!saved || typeof saved !== 'object') return merged
  for (const [k, v] of Object.entries(saved)) {
    if (typeof v === 'string' && validColIds.has(v)) {
      ;(merged as Record<string, unknown>)[k] = v
    } else if (v === null && !CORE_PROTECTED_FINANCE_KEY_SET.has(k)) {
      ;(merged as Record<string, unknown>)[k] = null
    }
  }
  return merged
}

export function getProtectedFinanceColumnIds(
  columns: Array<{ id: string; isPrimaryTitle?: boolean }>,
  mapping: DynamicModuleMapping
): Set<string> {
  const locked = new Set<string>()
  for (const col of columns) {
    if (col.isPrimaryTitle) locked.add(col.id)
  }
  for (const key of CORE_PROTECTED_FINANCE_MAPPING_KEYS) {
    const colId = mapping[key]
    if (typeof colId === 'string' && colId) locked.add(colId)
  }
  return locked
}

export function inferModuleMappingForTable(
  role: DynamicModuleRole,
  columns: Array<{ id: string; name: string; slug: string; fieldType: string; isPrimaryTitle?: boolean; config: any }>,
  allTables?: Array<{ id: string; name: string }>
): DynamicModuleMapping {
  const tableById = new Map((allTables ?? []).map((t) => [t.id, t]))
  const primaryTitleIds = new Set(columns.filter((c) => c.isPrimaryTitle).map((c) => c.id))
  const findCol = (regex: RegExp, fieldTypes?: string[], excludeIds?: Set<string>) =>
    columns.find((c) => {
      if (excludeIds?.has(c.id)) return false
      if (fieldTypes && !fieldTypes.includes(c.fieldType)) return false
      const hay = `${c.name} ${c.slug}`.toLocaleLowerCase('tr-TR')
      return regex.test(hay)
    })?.id ?? null

  const relationCols = columns.filter((c) => c.fieldType === 'relation')
  const findRelCol = (regex: RegExp) =>
    relationCols.find((c) => {
      const targetId = (c.config as DynamicColumnConfig | undefined)?.targetTableId
      const targetName = targetId ? tableById.get(targetId)?.name ?? '' : ''
      const hay = `${c.name} ${targetName}`.toLocaleLowerCase('tr-TR')
      return regex.test(hay)
    })?.id ?? null

  if (role === 'finance_income') {
    const personRel =
      findRelCol(/(müşteri|musteri|kişi|kisi|hasta|danışan|danisan|aday|sigortalı|sigortali|alıcı|alici|kiracı|kiraci|cari|sahip|firma|üye|uye|öğrenci|ogrenci)/i) ??
      relationCols[0]?.id ??
      null
    const serviceRel =
      relationCols.find((c) => {
        if (c.id === personRel) return false
        const targetId = (c.config as DynamicColumnConfig | undefined)?.targetTableId
        const targetName = targetId ? tableById.get(targetId)?.name ?? '' : ''
        const hay = `${c.name} ${targetName}`.toLocaleLowerCase('tr-TR')
        return /(hizmet|ürün|urun|tedavi|plan|ilan|portföy|portfoy|teklif|poliçe|police|paket|servis|talep|işlem|islem|sipariş|siparis|proje)/i.test(hay)
      })?.id ??
      relationCols.find((c) => c.id !== personRel)?.id ??
      null

    const netAmountCol = findCol(/(net tutar|kdv hariç|kdv haric|matrah|ara toplam)/i, ['currency', 'number'])
    const vatAmountCol = findCol(/(kdv tutar|vergi tutar)/i, ['currency', 'number'])
    const vatRateCol = findCol(/(kdv oran|kdv %|vergi oran)/i, ['select', 'number', 'text'])
    const exchangeRateCol = findCol(/(döviz kuru|doviz kuru|\bkur\b)/i, ['number'])
    const excludedAmountIds = new Set(
      [netAmountCol, vatAmountCol, vatRateCol, exchangeRateCol].filter((id): id is string => Boolean(id))
    )
    const grossAmountCol =
      findCol(/(brüt|brut|genel toplam|toplam tutar|^tutar\b|ödenen|odenen|tahsilat|komisyon|prim|ücret|ucret|fiyat|bedel)/i, ['currency', 'number'], excludedAmountIds) ??
      columns.find((c) => c.fieldType === 'currency' && !excludedAmountIds.has(c.id))?.id ??
      null
    const accountingSyncCol = findCol(/(ön muhasebe|on muhasebe|muhasebe durum|senkron)/i, ['select', 'text'])
    const docTypeCol = findCol(/(belge türü|belge turu|fatura türü|fatura turu|evrak türü|evrak turu)/i, ['select', 'text'])
    const excludedStatusIds = new Set(
      [accountingSyncCol, docTypeCol].filter((id): id is string => Boolean(id))
    )

    const docNumCol = findCol(/(belge\s*\/?\s*fatura\s*no|fatura.*no|evrak.*no|fiş.*no|fis.*no|seri.*sıra|^belge\s*no)/i, ['text'], primaryTitleIds)
    const excludedNonNoteIds = new Set(
      [...primaryTitleIds, docNumCol].filter((id): id is string => Boolean(id))
    )

    return {
      amountColumnId: grossAmountCol,
      netAmountColumnId: netAmountCol,
      vatRateColumnId: vatRateCol,
      vatAmountColumnId: vatAmountCol,
      currencyColumnId: findCol(/(para birimi|döviz cinsi|doviz cinsi|döviz|doviz|currency)/i, ['select', 'text'], primaryTitleIds),
      exchangeRateColumnId: exchangeRateCol,
      documentTypeColumnId: docTypeCol,
      documentNumberColumnId: docNumCol,
      counterpartyNameColumnId: findCol(/(cari|karşı taraf|karsi taraf|müşteri adı|musteri adi|firma|ünvan|unvan)/i, ['text'], primaryTitleIds),
      counterpartyTaxIdColumnId: findCol(/(vkn|tckn|vergi.*no|kimlik.*no)/i, ['text'], primaryTitleIds),
      accountingCodeColumnId: findCol(/(hesap kodu|muhasebe kodu|tdhp)/i, ['text'], primaryTitleIds),
      accountingSyncStatusColumnId: accountingSyncCol,
      dateColumnId:
        findCol(/(ödeme tarihi|odeme tarihi|işlem tarihi|islem tarihi|tahsilat tarihi|belge tarihi|^tarih\b)/i, ['date']) ??
        columns.find((c) => c.fieldType === 'date' && !/(vade|son)/i.test(c.name.toLocaleLowerCase('tr-TR')))?.id ??
        null,
      dueDateColumnId: findCol(/(vade|son ödeme|son odeme|beklenen)/i, ['date']),
      statusColumnId: findCol(/(tahsilat durum|ödeme durum|odeme durum|^durum\b|statü|statu)/i, ['select', 'text'], excludedStatusIds),
      methodColumnId: findCol(/(yöntem|yontem|ödeme tipi|odeme tipi|kanal|kasa|banka|kart|nakit)/i, ['select', 'text'], primaryTitleIds),
      categoryColumnId: findCol(/(kategori|gelir türü|gelir turu|gelir kalem|tür|tur|kalem)/i, ['select', 'text'], new Set([...primaryTitleIds, docTypeCol, accountingSyncCol].filter((id): id is string => Boolean(id)))),
      personRelationColumnId: personRel,
      serviceRelationColumnId: serviceRel,
      notesColumnId: findCol(/(not|açıklama|aciklama|detay)/i, ['text'], excludedNonNoteIds),
    }
  }

  if (role === 'finance_expense') {
    const netAmountCol = findCol(/(net tutar|kdv hariç|kdv haric|matrah|ara toplam)/i, ['currency', 'number'])
    const vatAmountCol = findCol(/(kdv tutar|vergi tutar)/i, ['currency', 'number'])
    const vatRateCol = findCol(/(kdv oran|kdv %|vergi oran)/i, ['select', 'number', 'text'])
    const exchangeRateCol = findCol(/(döviz kuru|doviz kuru|\bkur\b)/i, ['number'])
    const unitCostCol = findCol(/(birim tutar|birim maliyet|birim fiyat|birim)/i, ['currency', 'number'])
    const excludedTotalIds = new Set(
      [netAmountCol, vatAmountCol, vatRateCol, exchangeRateCol, unitCostCol].filter((id): id is string => Boolean(id))
    )
    const totalCol =
      findCol(/(brüt|brut|toplam tutar|genel toplam|toplam maliyet|toplam|gider tutarı|gider tutari|^tutar\b)/i, ['currency', 'number'], excludedTotalIds) ??
      findCol(/(tutar|maliyet|bedel|ücret|ucret)/i, ['currency', 'number'], excludedTotalIds) ??
      columns.find((c) => c.fieldType === 'currency' && !excludedTotalIds.has(c.id))?.id ??
      null
    const accountingSyncCol = findCol(/(ön muhasebe|on muhasebe|muhasebe durum|senkron)/i, ['select', 'text'])
    const docTypeCol = findCol(/(belge türü|belge turu|fatura türü|fatura turu|evrak türü|evrak turu)/i, ['select', 'text'])
    const excludedStatusIds = new Set(
      [...primaryTitleIds, accountingSyncCol, docTypeCol].filter((id): id is string => Boolean(id))
    )
    const docNumCol = findCol(/(belge\s*\/?\s*fatura\s*no|fatura.*no|evrak.*no|fiş.*no|fis.*no|seri.*sıra|^belge\s*no)/i, ['text'], primaryTitleIds)
    const excludedNonNoteIds = new Set(
      [...primaryTitleIds, docNumCol].filter((id): id is string => Boolean(id))
    )

    return {
      amountColumnId: totalCol,
      netAmountColumnId: netAmountCol,
      vatRateColumnId: vatRateCol,
      vatAmountColumnId: vatAmountCol,
      currencyColumnId: findCol(/(para birimi|döviz cinsi|doviz cinsi|döviz|doviz|currency)/i, ['select', 'text'], primaryTitleIds),
      exchangeRateColumnId: exchangeRateCol,
      documentTypeColumnId: docTypeCol,
      documentNumberColumnId: docNumCol,
      counterpartyNameColumnId: findCol(/(tedarikçi|tedarikci|cari|karşı taraf|karsi taraf|satıcı|satici|firma|ünvan|unvan)/i, ['text'], primaryTitleIds),
      counterpartyTaxIdColumnId: findCol(/(vkn|tckn|vergi.*no|kimlik.*no)/i, ['text'], primaryTitleIds),
      accountingCodeColumnId: findCol(/(hesap kodu|muhasebe kodu|tdhp)/i, ['text'], primaryTitleIds),
      accountingSyncStatusColumnId: accountingSyncCol,
      unitCostColumnId: unitCostCol,
      quantityColumnId: findCol(/(adet|miktar)/i, ['number']),
      dateColumnId:
        findCol(/(işlem tarihi|islem tarihi|gider tarihi|fatura tarihi|belge tarihi|^tarih\b)/i, ['date']) ??
        columns.find((c) => c.fieldType === 'date' && !/(vade|son)/i.test(c.name.toLocaleLowerCase('tr-TR')))?.id ??
        null,
      dueDateColumnId: findCol(/(vade|son ödeme|son odeme)/i, ['date']),
      categoryColumnId:
        findCol(/(kategori|gider türü|gider turu|gider kalem|tür|tur|kalem)/i, ['select', 'text'], excludedStatusIds) ??
        columns.find((c) => c.fieldType === 'select' && !excludedStatusIds.has(c.id))?.id ??
        null,
      methodColumnId: findCol(/(yöntem|yontem|ödeme tipi|kanal|kasa|banka)/i, ['select', 'text'], primaryTitleIds),
      statusColumnId: findCol(/(ödeme durum|odeme durum|^durum\b|statü|statu)/i, ['select', 'text'], excludedStatusIds),
      itemRelationColumnId:
        findRelCol(/(malzeme|stok|ürün|urun|envanter|cihaz|demirbaş|demirbas|bakım|bakim)/i) ??
        relationCols[0]?.id ??
        null,
      actorColumnId: findCol(/(yapan|giren|personel|sorumlu)/i, ['text'], primaryTitleIds),
      notesColumnId: findCol(/(not|açıklama|aciklama|detay)/i, ['text'], excludedNonNoteIds),
    }
  }

  if (role === 'stock_inventory') {
    const minCol = findCol(/(kritik|eşik|esik|min|asgari)/i, ['number'])
    const qtyCol =
      columns.find(
        (c) =>
          c.fieldType === 'number' &&
          c.id !== minCol &&
          /(stok|miktar|adet|mevcut|kalan)/i.test(c.name.toLocaleLowerCase('tr-TR'))
      )?.id ??
      columns.find((c) => c.fieldType === 'number' && c.id !== minCol)?.id ??
      null

    return {
      quantityColumnId: qtyCol,
      minThresholdColumnId: minCol,
      unitColumnId: findCol(/(birim|ölçü|olcu)/i, ['select', 'text']),
      unitCostColumnId:
        findCol(/(birim maliyet|maliyet|alış|alis|birim tutar|birim fiyat)/i, ['currency', 'number']) ??
        columns.find((c) => c.fieldType === 'currency')?.id ??
        null,
      categoryColumnId: findCol(/(kategori|grup|tür|tur)/i, ['select', 'text']),
      expiryDateColumnId:
        findCol(/(skt|son kullanma|miad|geçerlilik|gecerlilik|yenileme)/i, ['date']) ??
        columns.find((c) => c.fieldType === 'date')?.id ??
        null,
      notesColumnId: findCol(/(not|açıklama|aciklama|tedarikçi|tedarikci|marka|raf)/i, ['text']),
    }
  }

  if (role === 'asset_maintenance') {
    const nextCol = findCol(/(sonraki|gelecek|yenileme tarihi)/i, ['date'])
    const completedCol = findCol(/(tamamlanma|yapılan|son bakım)/i, ['date'])
    const scheduledCol =
      columns.find(
        (c) =>
          c.fieldType === 'date' &&
          c.id !== nextCol &&
          c.id !== completedCol &&
          /(planlanan|bakım tarihi|bakim tarihi|tarih)/i.test(c.name.toLocaleLowerCase('tr-TR'))
      )?.id ??
      columns.find((c) => c.fieldType === 'date' && c.id !== nextCol && c.id !== completedCol)?.id ??
      null

    return {
      categoryColumnId: findCol(/(bakım tipi|bakim tipi|işlem tipi|kategori|tür|tur)/i, ['select', 'text']),
      statusColumnId: findCol(/(durum|statü|statu)/i, ['select', 'text']),
      isPeriodicColumnId:
        findCol(/(periyodik|tekrarlı|tekrarli)/i, ['boolean']) ??
        columns.find((c) => c.fieldType === 'boolean')?.id ??
        null,
      periodicDaysColumnId:
        findCol(/(periyot|gün|gun|aralık|aralik)/i, ['number']) ??
        columns.find((c) => c.fieldType === 'number')?.id ??
        null,
      scheduledDateColumnId: scheduledCol,
      nextDateColumnId: nextCol,
      completedDateColumnId: completedCol,
      amountColumnId:
        findCol(/(ücret|ucret|maliyet|tutar|bedel)/i, ['currency', 'number']) ??
        columns.find((c) => c.fieldType === 'currency')?.id ??
        null,
      notesColumnId: findCol(/(not|açıklama|aciklama|firma|servis|seri)/i, ['text']),
    }
  }

  // stock_movement
  const unitCostCol = findCol(/(birim tutar|birim maliyet|birim fiyat)/i, ['currency', 'number'])
  const totalCol =
    columns.find(
      (c) =>
        (c.fieldType === 'currency' || c.fieldType === 'number') &&
        c.id !== unitCostCol &&
        /(toplam|tutar|maliyet)/i.test(c.name.toLocaleLowerCase('tr-TR'))
    )?.id ??
    columns.find((c) => c.fieldType === 'currency' && c.id !== unitCostCol)?.id ??
    null

  return {
    movementTypeColumnId:
      findCol(/(işlem türü|islem turu|hareket|tür|tur|tip)/i, ['select', 'text']) ??
      columns.find((c) => c.fieldType === 'select')?.id ??
      null,
    quantityColumnId:
      findCol(/(adet|miktar)/i, ['number']) ??
      columns.find((c) => c.fieldType === 'number')?.id ??
      null,
    unitCostColumnId: unitCostCol,
    amountColumnId: totalCol,
    dateColumnId:
      findCol(/(tarih|işlem tarihi)/i, ['date']) ??
      columns.find((c) => c.fieldType === 'date')?.id ??
      null,
    actorColumnId: findCol(/(yapan|personel|kullanıcı|sorumlu)/i, ['text']),
    itemRelationColumnId:
      findRelCol(/(malzeme|stok|ürün|urun|kalem|envanter|cihaz|demirbaş|demirbas)/i) ??
      relationCols[0]?.id ??
      null,
    notesColumnId: findCol(/(not|açıklama|aciklama)/i, ['text']),
  }
}

const TAB_LABEL_SETTING_KEY = 'dynamic_studio.tab_label'
const APPT_NODE_POS_SETTING_KEY = 'dynamic_studio.appt_node_pos'

export function slugifyTr(input: string, fallback = 'alan'): string {
  const map: Record<string, string> = {
    ş: 's', Ş: 's', ı: 'i', İ: 'i', ğ: 'g', Ğ: 'g',
    ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c',
  }
  const replaced = String(input || '')
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return replaced || fallback
}

async function resolveUniqueTableSlug(clinicId: string, rawName: string, excludeId?: string): Promise<string> {
  const base = slugifyTr(rawName, 'tablo')
  const existing = await db
    .select({ id: dynamicTables.id, slug: dynamicTables.slug })
    .from(dynamicTables)
    .where(eq(dynamicTables.clinicId, clinicId))
  const taken = new Set(existing.filter((r) => r.id !== excludeId).map((r) => r.slug))
  if (!taken.has(base)) return base
  let idx = 2
  while (taken.has(`${base}_${idx}`)) idx++
  return `${base}_${idx}`
}

async function resolveUniqueColumnSlug(tableId: string, rawName: string, excludeId?: string): Promise<string> {
  const base = slugifyTr(rawName, 'sutun')
  const existing = await db
    .select({ id: dynamicColumns.id, slug: dynamicColumns.slug })
    .from(dynamicColumns)
    .where(eq(dynamicColumns.tableId, tableId))
  const taken = new Set(existing.filter((r) => r.id !== excludeId).map((r) => r.slug))
  if (!taken.has(base)) return base
  let idx = 2
  while (taken.has(`${base}_${idx}`)) idx++
  return `${base}_${idx}`
}

function isValidUuid(val: unknown): val is string {
  return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val)
}

export function coerceColumnValue(fieldType: DynamicFieldType, raw: unknown, config?: DynamicColumnConfig): unknown {
  if (raw === undefined || raw === null || raw === '') {
    if (fieldType === 'boolean') return false
    if (fieldType === 'multiselect') return []
    return null
  }

  switch (fieldType) {
    case 'text':
    case 'phone':
      return String(raw).trim()
    case 'email': {
      const s = String(raw).trim()
      if (!s) return null
      return s
    }
    case 'number':
    case 'currency': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
      let cleaned = String(raw)
        .trim()
        .replace(/[₺$€£%]/g, '')
        .replace(/\s+/g, '')
      if (!cleaned) return null
      // Handle Turkish / European thousands separators (e.g. "1.250,50") vs US ("1,250.50")
      const lastDot = cleaned.lastIndexOf('.')
      const lastComma = cleaned.lastIndexOf(',')
      if (lastComma > -1 && lastDot > -1) {
        if (lastComma > lastDot) {
          cleaned = cleaned.replace(/\./g, '').replace(',', '.')
        } else {
          cleaned = cleaned.replace(/,/g, '')
        }
      } else if (lastComma > -1) {
        const commaParts = cleaned.split(',')
        if (commaParts.length === 2 && (commaParts[1]?.length ?? 0) <= 4) {
          cleaned = cleaned.replace(',', '.')
        } else {
          cleaned = cleaned.replace(/,/g, '')
        }
      } else if ((cleaned.match(/\./g) || []).length > 1) {
        cleaned = cleaned.replace(/\./g, '')
      }
      const parsed = Number(cleaned)
      if (!Number.isFinite(parsed)) throw new Error(`Geçersiz sayısal değer: "${raw}"`)
      return parsed
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw
      const s = String(raw).trim().toLowerCase()
      return s === 'true' || s === '1' || s === 'evet' || s === 'yes' || s === 'on'
    }
    case 'date': {
      if (raw instanceof Date) {
        return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10)
      }
      // Handle Excel numeric serial dates (days since 1899-12-30)
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 25000 && raw < 75000) {
        const excelEpochMs = Date.UTC(1899, 11, 30)
        const d = new Date(excelEpochMs + Math.round(raw) * 86_400_000)
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
      }
      const s = String(raw).trim()
      if (!s) return null
      const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
      if (dmy) {
        const dd = dmy[1]!.padStart(2, '0')
        const mm = dmy[2]!.padStart(2, '0')
        const yyyy = dmy[3]!
        return `${yyyy}-${mm}-${dd}`
      }
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
      const parsed = new Date(s)
      if (Number.isNaN(parsed.getTime())) throw new Error(`Geçersiz tarih formatı: "${raw}"`)
      return parsed.toISOString().slice(0, 10)
    }
    case 'select': {
      const s = String(raw).trim()
      if (!s) return null
      const opts = Array.isArray(config?.options) ? config!.options! : []
      if (opts.length > 0) {
        const byId = opts.find((o) => o.id === s)
        if (byId) return byId.id
        const byLabel = opts.find((o) => o.label.toLocaleLowerCase('tr-TR') === s.toLocaleLowerCase('tr-TR'))
        if (byLabel) return byLabel.id
      }
      return s
    }
    case 'multiselect': {
      const arr = Array.isArray(raw)
        ? raw.map((v) => String(v).trim()).filter(Boolean)
        : String(raw)
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
      const opts = Array.isArray(config?.options) ? config!.options! : []
      if (opts.length === 0) return arr
      return arr.map((item) => {
        const byId = opts.find((o) => o.id === item)
        if (byId) return byId.id
        const byLabel = opts.find((o) => o.label.toLocaleLowerCase('tr-TR') === item.toLocaleLowerCase('tr-TR'))
        return byLabel ? byLabel.id : item
      })
    }
    case 'relation':
      return null
    default:
      return String(raw)
  }
}

function computeDisplayTitle(
  columns: Array<{ id: string; fieldType: string; isPrimaryTitle: boolean; sortOrder: number; config: any }>,
  values: Record<string, unknown>
): string {
  const nonRelationCols = columns
    .filter((c) => c.fieldType !== 'relation')
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const primaryCol = nonRelationCols.find((c) => c.isPrimaryTitle) ?? nonRelationCols[0]
  if (!primaryCol) return 'Kayıt'

  const rawVal = values[primaryCol.id]
  if (rawVal === null || rawVal === undefined || rawVal === '') {
    for (const col of nonRelationCols) {
      const fallbackVal = values[col.id]
      if (fallbackVal !== null && fallbackVal !== undefined && String(fallbackVal).trim() !== '') {
        return String(fallbackVal).trim()
      }
    }
    return 'İsimsiz Kayıt'
  }

  if (primaryCol.fieldType === 'select' && Array.isArray(primaryCol.config?.options)) {
    const opt = primaryCol.config.options.find((o: SelectOptionItem) => o.id === rawVal)
    if (opt?.label) return opt.label
  }
  return String(rawVal).trim() || 'İsimsiz Kayıt'
}

// ── Studio Schema Snapshot ───────────────────────────────────────────────────

export async function getStudioSchema(explicitClinicId?: string) {
  await ensureDynamicTablesSchema()
  const clinicId = explicitClinicId ?? requireClinicId()

  const [tables, cols, relations, apptConfigs, modConfigsRaw, rowCounts, rawTabLabel, rawApptPos] = await Promise.all([
    db
      .select()
      .from(dynamicTables)
      .where(eq(dynamicTables.clinicId, clinicId))
      .orderBy(asc(dynamicTables.sortOrder), asc(dynamicTables.createdAt)),
    db
      .select()
      .from(dynamicColumns)
      .where(eq(dynamicColumns.clinicId, clinicId))
      .orderBy(asc(dynamicColumns.sortOrder), asc(dynamicColumns.createdAt)),
    db
      .select()
      .from(dynamicRelations)
      .where(eq(dynamicRelations.clinicId, clinicId))
      .orderBy(asc(dynamicRelations.createdAt)),
    db
      .select()
      .from(dynamicAppointmentConfigs)
      .where(eq(dynamicAppointmentConfigs.clinicId, clinicId)),
    db
      .select()
      .from(dynamicModuleConfigs)
      .where(eq(dynamicModuleConfigs.clinicId, clinicId)),
    db
      .select({
        tableId: dynamicRows.tableId,
        activeCount: sql<number>`count(*) filter (where ${dynamicRows.isArchived} = false)::int`,
        archivedCount: sql<number>`count(*) filter (where ${dynamicRows.isArchived} = true)::int`,
      })
      .from(dynamicRows)
      .where(eq(dynamicRows.clinicId, clinicId))
      .groupBy(dynamicRows.tableId),
    getSetting(TAB_LABEL_SETTING_KEY).catch(() => null),
    getSetting(APPT_NODE_POS_SETTING_KEY).catch(() => null),
  ])

  const colsByTable = new Map<string, typeof cols>()
  for (const col of cols) {
    const list = colsByTable.get(col.tableId) ?? []
    list.push(col)
    colsByTable.set(col.tableId, list)
  }

  const countByTable = new Map<string, { activeCount: number; archivedCount: number }>()
  for (const rc of rowCounts) {
    countByTable.set(rc.tableId, {
      activeCount: Number(rc.activeCount || 0),
      archivedCount: Number(rc.archivedCount || 0),
    })
  }

  let appointmentNodePosition = { x: 660, y: 120 }
  if (rawApptPos) {
    try {
      const parsed = JSON.parse(rawApptPos)
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        appointmentNodePosition = { x: Math.round(parsed.x), y: Math.round(parsed.y) }
      }
    } catch {}
  }

  const moduleConfigs = modConfigsRaw.map((mc) => {
    const tCols = colsByTable.get(mc.tableId) ?? []
    const validColIds = new Set(tCols.map((c) => c.id))
    const inferred = ALLOWED_MODULE_ROLES.includes(mc.moduleRole as DynamicModuleRole)
      ? inferModuleMappingForTable(mc.moduleRole as DynamicModuleRole, tCols, tables)
      : {}
    const saved = (mc.mapping ?? {}) as Record<string, unknown>
    const merged: DynamicModuleMapping = { ...inferred }
    for (const [k, v] of Object.entries(saved)) {
      if (typeof v === 'string' && validColIds.has(v)) {
        ;(merged as Record<string, unknown>)[k] = v
      } else if (v === null) {
        ;(merged as Record<string, unknown>)[k] = null
      }
    }
    return {
      ...mc,
      moduleRole: mc.moduleRole as DynamicModuleRole,
      mapping: merged,
    }
  })

  return {
    tabLabel: (rawTabLabel || '').trim() || 'Veri Tabloları',
    appointmentNodePosition,
    tables: tables.map((t) => ({
      ...t,
      columns: colsByTable.get(t.id) ?? [],
      rowCount: countByTable.get(t.id)?.activeCount ?? 0,
      archivedRowCount: countByTable.get(t.id)?.archivedCount ?? 0,
    })),
    relations,
    appointmentConfigs: apptConfigs,
    moduleConfigs,
  }
}

export async function updateStudioSettings(input: {
  tabLabel?: string
  appointmentNodePosition?: { x: number; y: number }
}) {
  await ensureDynamicTablesSchema()
  if (input.tabLabel !== undefined) {
    const clean = input.tabLabel.trim() || 'Veri Tabloları'
    await setSetting(TAB_LABEL_SETTING_KEY, clean)
  }
  if (
    input.appointmentNodePosition &&
    Number.isFinite(input.appointmentNodePosition.x) &&
    Number.isFinite(input.appointmentNodePosition.y)
  ) {
    await setSetting(
      APPT_NODE_POS_SETTING_KEY,
      JSON.stringify({
        x: Math.round(input.appointmentNodePosition.x),
        y: Math.round(input.appointmentNodePosition.y),
      })
    )
  }
  return getStudioSchema()
}

// ── Table CRUD ───────────────────────────────────────────────────────────────

export interface InitialColumnInput {
  name: string
  fieldType: DynamicFieldType
  isPrimaryTitle?: boolean
  isRequired?: boolean
  isUnique?: boolean
  showInTable?: boolean
  width?: number
  config?: DynamicColumnConfig
}

export async function createDynamicTable(input: {
  name: string
  icon?: string
  color?: string
  description?: string
  origin?: DynamicTableOrigin
  canvasX?: number
  canvasY?: number
  initialColumns?: InitialColumnInput[]
}) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  const cleanName = String(input.name || '').trim()
  if (!cleanName) throw new Error('Tablo adı zorunludur')

  const safeOrigin: DynamicTableOrigin =
    input.origin && ALLOWED_TABLE_ORIGINS.includes(input.origin) ? input.origin : 'manual'

  const slug = await resolveUniqueTableSlug(clinicId, cleanName)
  const existingCountRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dynamicTables)
    .where(eq(dynamicTables.clinicId, clinicId))
  const nextOrder = Number(existingCountRows[0]?.count || 0)

  const defaultX = input.canvasX !== undefined ? Math.round(input.canvasX) : 60 + (nextOrder % 3) * 320
  const defaultY = input.canvasY !== undefined ? Math.round(input.canvasY) : 70 + Math.floor(nextOrder / 3) * 260

  const [createdTable] = await db
    .insert(dynamicTables)
    .values({
      clinicId,
      name: cleanName,
      slug,
      icon: input.icon || 'table',
      color: input.color || '#0284c7',
      description: input.description?.trim() || null,
      origin: safeOrigin,
      canvasX: defaultX,
      canvasY: defaultY,
      sortOrder: nextOrder,
    })
    .returning()

  if (!createdTable) throw new Error('Tablo oluşturulamadı')

  const colsToCreate: InitialColumnInput[] =
    Array.isArray(input.initialColumns) && input.initialColumns.length > 0
      ? input.initialColumns
      : [{ name: 'Ad / Başlık', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 210 }]

  let hasPrimary = colsToCreate.some((c) => c.isPrimaryTitle && c.fieldType !== 'relation')
  const usedSlugs = new Set<string>()
  const createdColumns = []

  for (let i = 0; i < colsToCreate.length; i++) {
    const col = colsToCreate[i]!
    const colType = ALLOWED_FIELD_TYPES.includes(col.fieldType) && col.fieldType !== 'relation' ? col.fieldType : 'text'
    const baseSlug = slugifyTr(col.name, `sutun_${i + 1}`)
    let finalSlug = baseSlug
    let suffix = 2
    while (usedSlugs.has(finalSlug)) {
      finalSlug = `${baseSlug}_${suffix++}`
    }
    usedSlugs.add(finalSlug)

    const isPrimary = !hasPrimary && i === 0 ? true : Boolean(col.isPrimaryTitle)
    if (isPrimary) hasPrimary = true

    const [inserted] = await db
      .insert(dynamicColumns)
      .values({
        clinicId,
        tableId: createdTable.id,
        name: String(col.name || '').trim() || `Sütun ${i + 1}`,
        slug: finalSlug,
        fieldType: colType,
        isPrimaryTitle: isPrimary,
        isRequired: isPrimary ? true : Boolean(col.isRequired),
        isUnique: Boolean(col.isUnique),
        showInTable: col.showInTable !== false,
        width: col.width && col.width >= 80 ? Math.round(col.width) : 180,
        sortOrder: i,
        config: col.config ?? {},
      })
      .returning()

    if (inserted) createdColumns.push(inserted)
  }

  return {
    ...createdTable,
    columns: createdColumns,
    rowCount: 0,
    archivedRowCount: 0,
  }
}

export async function updateDynamicTable(
  tableId: string,
  patch: {
    name?: string
    icon?: string
    color?: string
    description?: string | null
    canvasX?: number
    canvasY?: number
    sortOrder?: number
  }
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  const updateData: Record<string, unknown> = { updatedAt: new Date() }

  if (patch.name !== undefined) {
    const clean = patch.name.trim()
    if (!clean) throw new Error('Tablo adı boş olamaz')
    const [existingTable] = await db
      .select({ id: dynamicTables.id, name: dynamicTables.name })
      .from(dynamicTables)
      .where(and(eq(dynamicTables.id, tableId), eq(dynamicTables.clinicId, clinicId)))
    if (!existingTable) throw new Error('Tablo bulunamadı')
    if (clean !== existingTable.name) {
      const [finMod] = await db
        .select({ moduleRole: dynamicModuleConfigs.moduleRole })
        .from(dynamicModuleConfigs)
        .where(
          and(
            eq(dynamicModuleConfigs.clinicId, clinicId),
            eq(dynamicModuleConfigs.tableId, tableId),
            eq(dynamicModuleConfigs.enabled, true)
          )
        )
      if (finMod && isFinanceModuleRole(finMod.moduleRole)) {
        throw new Error('Standart finans tablolarının adı değiştirilemez')
      }
      updateData.name = clean
      updateData.slug = await resolveUniqueTableSlug(clinicId, clean, tableId)
    }
  }
  if (patch.icon !== undefined) updateData.icon = patch.icon || 'table'
  if (patch.color !== undefined) updateData.color = patch.color || '#0284c7'
  if (patch.description !== undefined) updateData.description = patch.description ? patch.description.trim() : null
  if (patch.canvasX !== undefined && Number.isFinite(patch.canvasX)) updateData.canvasX = Math.round(patch.canvasX)
  if (patch.canvasY !== undefined && Number.isFinite(patch.canvasY)) updateData.canvasY = Math.round(patch.canvasY)
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder)) updateData.sortOrder = Math.round(patch.sortOrder)

  const [updated] = await db
    .update(dynamicTables)
    .set(updateData)
    .where(and(eq(dynamicTables.id, tableId), eq(dynamicTables.clinicId, clinicId)))
    .returning()

  if (!updated) throw new Error('Tablo bulunamadı')
  return updated
}

export async function batchSaveCanvasLayout(input: {
  tables?: Array<{ id: string; canvasX: number; canvasY: number }>
  appointmentNodePosition?: { x: number; y: number }
}) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  if (Array.isArray(input.tables)) {
    for (const item of input.tables) {
      if (!isValidUuid(item.id)) continue
      if (!Number.isFinite(item.canvasX) || !Number.isFinite(item.canvasY)) continue
      await db
        .update(dynamicTables)
        .set({
          canvasX: Math.round(item.canvasX),
          canvasY: Math.round(item.canvasY),
          updatedAt: new Date(),
        })
        .where(and(eq(dynamicTables.id, item.id), eq(dynamicTables.clinicId, clinicId)))
    }
  }
  if (
    input.appointmentNodePosition &&
    Number.isFinite(input.appointmentNodePosition.x) &&
    Number.isFinite(input.appointmentNodePosition.y)
  ) {
    await setSetting(
      APPT_NODE_POS_SETTING_KEY,
      JSON.stringify({
        x: Math.round(input.appointmentNodePosition.x),
        y: Math.round(input.appointmentNodePosition.y),
      })
    )
  }
  return { success: true }
}

export async function deleteDynamicTable(tableId: string) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const [modCfg] = await db
    .select({ moduleRole: dynamicModuleConfigs.moduleRole, enabled: dynamicModuleConfigs.enabled })
    .from(dynamicModuleConfigs)
    .where(
      and(
        eq(dynamicModuleConfigs.clinicId, clinicId),
        eq(dynamicModuleConfigs.tableId, tableId)
      )
    )
    .limit(1)
  if (modCfg?.enabled && isFinanceModuleRole(modCfg.moduleRole)) {
    throw new Error('Standart finans tabloları silinemez.')
  }

  const rels = await db
    .select()
    .from(dynamicRelations)
    .where(
      and(
        eq(dynamicRelations.clinicId, clinicId),
        or(eq(dynamicRelations.sourceTableId, tableId), eq(dynamicRelations.targetTableId, tableId))
      )
    )

  const extraColIdsToDelete: string[] = []
  for (const rel of rels) {
    if (rel.sourceTableId !== tableId && rel.sourceColumnId) extraColIdsToDelete.push(rel.sourceColumnId)
    if (rel.targetTableId !== tableId && rel.inverseColumnId) extraColIdsToDelete.push(rel.inverseColumnId)
  }
  if (extraColIdsToDelete.length > 0) {
    await db
      .delete(dynamicColumns)
      .where(and(eq(dynamicColumns.clinicId, clinicId), inArray(dynamicColumns.id, extraColIdsToDelete)))
  }

  const [deleted] = await db
    .delete(dynamicTables)
    .where(and(eq(dynamicTables.id, tableId), eq(dynamicTables.clinicId, clinicId)))
    .returning({ id: dynamicTables.id })

  if (!deleted) throw new Error('Tablo bulunamadı')
  return { success: true }
}

export async function clearDynamicTables(input: {
  mode?: 'all' | 'manual' | 'selected'
  tableIds?: string[]
}) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const [existing, financeConfigs] = await Promise.all([
    db
      .select({ id: dynamicTables.id, origin: dynamicTables.origin })
      .from(dynamicTables)
      .where(eq(dynamicTables.clinicId, clinicId)),
    db
      .select({ tableId: dynamicModuleConfigs.tableId, moduleRole: dynamicModuleConfigs.moduleRole })
      .from(dynamicModuleConfigs)
      .where(
        and(
          eq(dynamicModuleConfigs.clinicId, clinicId),
          eq(dynamicModuleConfigs.enabled, true)
        )
      ),
  ])

  const protectedFinanceIds = new Set(
    financeConfigs.filter((mc) => isFinanceModuleRole(mc.moduleRole)).map((mc) => mc.tableId)
  )
  const existingIdSet = new Set(existing.map((t) => t.id))
  let targetIds: string[] = []

  if (input.mode === 'all') {
    targetIds = existing.filter((t) => !protectedFinanceIds.has(t.id)).map((t) => t.id)
  } else if (input.mode === 'manual') {
    targetIds = existing
      .filter((t) => (t.origin || 'manual') === 'manual' && !protectedFinanceIds.has(t.id))
      .map((t) => t.id)
  } else if (Array.isArray(input.tableIds)) {
    targetIds = Array.from(
      new Set(
        input.tableIds
          .map((id) => String(id || '').trim())
          .filter((id) => existingIdSet.has(id) && !protectedFinanceIds.has(id))
      )
    )
  } else {
    throw new Error('Temizlenecek tablolar belirtilmedi')
  }

  if (targetIds.length === 0) {
    return {
      success: true,
      deletedCount: 0,
      deletedTableIds: [] as string[],
      schema: await getStudioSchema(),
    }
  }

  const targetIdSet = new Set(targetIds)

  // Clean up orphaned relation columns living on tables that are NOT being deleted
  const rels = await db
    .select()
    .from(dynamicRelations)
    .where(
      and(
        eq(dynamicRelations.clinicId, clinicId),
        or(
          inArray(dynamicRelations.sourceTableId, targetIds),
          inArray(dynamicRelations.targetTableId, targetIds)
        )
      )
    )

  const extraColIdsToDelete: string[] = []
  for (const rel of rels) {
    if (!targetIdSet.has(rel.sourceTableId) && rel.sourceColumnId) {
      extraColIdsToDelete.push(rel.sourceColumnId)
    }
    if (!targetIdSet.has(rel.targetTableId) && rel.inverseColumnId) {
      extraColIdsToDelete.push(rel.inverseColumnId)
    }
  }
  if (extraColIdsToDelete.length > 0) {
    await db
      .delete(dynamicColumns)
      .where(
        and(
          eq(dynamicColumns.clinicId, clinicId),
          inArray(dynamicColumns.id, Array.from(new Set(extraColIdsToDelete)))
        )
      )
  }

  const deleted = await db
    .delete(dynamicTables)
    .where(and(eq(dynamicTables.clinicId, clinicId), inArray(dynamicTables.id, targetIds)))
    .returning({ id: dynamicTables.id })

  const schema = await getStudioSchema()
  return {
    success: true,
    deletedCount: deleted.length,
    deletedTableIds: deleted.map((d) => d.id),
    schema,
  }
}

// ── Column CRUD ──────────────────────────────────────────────────────────────

async function refreshTableDisplayTitles(clinicId: string, tableId: string) {
  const cols = await db
    .select()
    .from(dynamicColumns)
    .where(and(eq(dynamicColumns.clinicId, clinicId), eq(dynamicColumns.tableId, tableId)))
    .orderBy(asc(dynamicColumns.sortOrder))
  const rows = await db
    .select({ id: dynamicRows.id, values: dynamicRows.values })
    .from(dynamicRows)
    .where(and(eq(dynamicRows.clinicId, clinicId), eq(dynamicRows.tableId, tableId)))

  for (const r of rows) {
    const nextTitle = computeDisplayTitle(cols as any, (r.values || {}) as Record<string, unknown>)
    await db
      .update(dynamicRows)
      .set({ displayTitle: nextTitle })
      .where(eq(dynamicRows.id, r.id))
  }
}

export async function createDynamicColumn(
  tableId: string,
  input: {
    name: string
    fieldType: DynamicFieldType
    isPrimaryTitle?: boolean
    isRequired?: boolean
    isUnique?: boolean
    showInTable?: boolean
    width?: number
    config?: DynamicColumnConfig
  }
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const [table] = await db
    .select({ id: dynamicTables.id })
    .from(dynamicTables)
    .where(and(eq(dynamicTables.id, tableId), eq(dynamicTables.clinicId, clinicId)))
    .limit(1)
  if (!table) throw new Error('Tablo bulunamadı')

  const cleanName = String(input.name || '').trim()
  if (!cleanName) throw new Error('Sütun adı zorunludur')
  if (!ALLOWED_FIELD_TYPES.includes(input.fieldType) || input.fieldType === 'relation') {
    throw new Error('İlişki sütunları İlişki Ekle akışı üzerinden oluşturulmalıdır')
  }

  const slug = await resolveUniqueColumnSlug(tableId, cleanName)
  const existingCols = await db
    .select({ id: dynamicColumns.id })
    .from(dynamicColumns)
    .where(eq(dynamicColumns.tableId, tableId))
  const nextOrder = existingCols.length

  if (input.isPrimaryTitle) {
    await db
      .update(dynamicColumns)
      .set({ isPrimaryTitle: false })
      .where(and(eq(dynamicColumns.clinicId, clinicId), eq(dynamicColumns.tableId, tableId)))
  }

  const [created] = await db
    .insert(dynamicColumns)
    .values({
      clinicId,
      tableId,
      name: cleanName,
      slug,
      fieldType: input.fieldType,
      isPrimaryTitle: Boolean(input.isPrimaryTitle),
      isRequired: input.isPrimaryTitle ? true : Boolean(input.isRequired),
      isUnique: Boolean(input.isUnique),
      showInTable: input.showInTable !== false,
      width: input.width && input.width >= 80 ? Math.round(input.width) : 180,
      sortOrder: nextOrder,
      config: input.config ?? {},
    })
    .returning()

  if (input.isPrimaryTitle) {
    await refreshTableDisplayTitles(clinicId, tableId)
  }

  return created
}

export async function updateDynamicColumn(
  columnId: string,
  patch: {
    name?: string
    fieldType?: DynamicFieldType
    isPrimaryTitle?: boolean
    isRequired?: boolean
    isUnique?: boolean
    showInTable?: boolean
    width?: number
    sortOrder?: number
    config?: DynamicColumnConfig
  }
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const [existing] = await db
    .select()
    .from(dynamicColumns)
    .where(and(eq(dynamicColumns.id, columnId), eq(dynamicColumns.clinicId, clinicId)))
    .limit(1)
  if (!existing) throw new Error('Sütun bulunamadı')

  const [modCfg] = await db
    .select()
    .from(dynamicModuleConfigs)
    .where(
      and(
        eq(dynamicModuleConfigs.clinicId, clinicId),
        eq(dynamicModuleConfigs.tableId, existing.tableId),
        eq(dynamicModuleConfigs.enabled, true)
      )
    )
    .limit(1)
  if (modCfg && isFinanceModuleRole(modCfg.moduleRole)) {
    const tableCols = await db
      .select()
      .from(dynamicColumns)
      .where(and(eq(dynamicColumns.clinicId, clinicId), eq(dynamicColumns.tableId, existing.tableId)))
    const validColIds = new Set(tableCols.map((c) => c.id))
    const inferred = inferModuleMappingForTable(modCfg.moduleRole, tableCols)
    const effectiveMap = mergeFinanceMappingPreservingCore(
      inferred,
      (modCfg.mapping ?? {}) as Record<string, unknown>,
      validColIds
    )
    const protectedIds = getProtectedFinanceColumnIds(tableCols, effectiveMap)
    if (patch.isPrimaryTitle === true && !existing.isPrimaryTitle) {
      throw new Error('Standart finans tablolarının ana başlık sütunu değiştirilemez.')
    }
    if (protectedIds.has(existing.id)) {
      if (patch.fieldType !== undefined && patch.fieldType !== existing.fieldType) {
        throw new Error('Ön muhasebe uyumluluğu için standart finans sütununun veri türü değiştirilemez.')
      }
      if (
        existing.fieldType === 'select' &&
        patch.config &&
        Array.isArray(patch.config.options) &&
        patch.config.options.length === 0
      ) {
        throw new Error('Standart finans seçim sütununun seçenek listesi boş bırakılamaz.')
      }
    }
  }

  const updateData: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const clean = patch.name.trim()
    if (!clean) throw new Error('Sütun adı boş olamaz')
    updateData.name = clean
    updateData.slug = await resolveUniqueColumnSlug(existing.tableId, clean, columnId)
  }
  if (patch.fieldType !== undefined && existing.fieldType !== 'relation' && patch.fieldType !== 'relation') {
    if (ALLOWED_FIELD_TYPES.includes(patch.fieldType)) {
      updateData.fieldType = patch.fieldType
    }
  }
  if (patch.isPrimaryTitle === true && existing.fieldType !== 'relation') {
    await db
      .update(dynamicColumns)
      .set({ isPrimaryTitle: false })
      .where(and(eq(dynamicColumns.clinicId, clinicId), eq(dynamicColumns.tableId, existing.tableId)))
    updateData.isPrimaryTitle = true
    updateData.isRequired = true
  }
  if (patch.isRequired !== undefined && !existing.isPrimaryTitle && updateData.isPrimaryTitle !== true) {
    updateData.isRequired = Boolean(patch.isRequired)
  }
  if (patch.isUnique !== undefined) updateData.isUnique = Boolean(patch.isUnique)
  if (patch.showInTable !== undefined) updateData.showInTable = Boolean(patch.showInTable)
  if (patch.width !== undefined && Number.isFinite(patch.width)) {
    updateData.width = Math.max(80, Math.min(600, Math.round(patch.width)))
  }
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder)) {
    updateData.sortOrder = Math.round(patch.sortOrder)
  }
  if (patch.config !== undefined) {
    updateData.config = { ...(existing.config as Record<string, unknown>), ...patch.config }
  }

  const [updated] = await db
    .update(dynamicColumns)
    .set(updateData)
    .where(and(eq(dynamicColumns.id, columnId), eq(dynamicColumns.clinicId, clinicId)))
    .returning()

  if (patch.isPrimaryTitle === true) {
    await refreshTableDisplayTitles(clinicId, existing.tableId)
  }

  return updated
}

export async function deleteDynamicColumn(columnId: string) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const [col] = await db
    .select()
    .from(dynamicColumns)
    .where(and(eq(dynamicColumns.id, columnId), eq(dynamicColumns.clinicId, clinicId)))
    .limit(1)
  if (!col) throw new Error('Sütun bulunamadı')

  const [modCfg] = await db
    .select()
    .from(dynamicModuleConfigs)
    .where(
      and(
        eq(dynamicModuleConfigs.clinicId, clinicId),
        eq(dynamicModuleConfigs.tableId, col.tableId),
        eq(dynamicModuleConfigs.enabled, true)
      )
    )
    .limit(1)
  if (modCfg && isFinanceModuleRole(modCfg.moduleRole)) {
    const tableCols = await db
      .select()
      .from(dynamicColumns)
      .where(and(eq(dynamicColumns.clinicId, clinicId), eq(dynamicColumns.tableId, col.tableId)))
    const validColIds = new Set(tableCols.map((c) => c.id))
    const inferred = inferModuleMappingForTable(modCfg.moduleRole, tableCols)
    const effectiveMap = mergeFinanceMappingPreservingCore(
      inferred,
      (modCfg.mapping ?? {}) as Record<string, unknown>,
      validColIds
    )
    const protectedIds = getProtectedFinanceColumnIds(tableCols, effectiveMap)
    if (protectedIds.has(col.id)) {
      throw new Error('Ön muhasebe uyumluluğu için standart finans sütunları silinemez.')
    }
  }

  if (col.fieldType === 'relation') {
    const cfg = (col.config || {}) as DynamicColumnConfig
    if (cfg.relationId && isValidUuid(cfg.relationId)) {
      return deleteDynamicRelation(cfg.relationId)
    }
  }

  const siblingNonRelation = await db
    .select()
    .from(dynamicColumns)
    .where(
      and(
        eq(dynamicColumns.clinicId, clinicId),
        eq(dynamicColumns.tableId, col.tableId),
        ne(dynamicColumns.id, columnId),
        ne(dynamicColumns.fieldType, 'relation')
      )
    )
    .orderBy(asc(dynamicColumns.sortOrder))

  if (col.isPrimaryTitle && siblingNonRelation.length === 0) {
    throw new Error('Tablonun tek ana başlık sütunu silinemez. Önce başka bir veri sütunu ekleyin.')
  }

  await db
    .delete(dynamicColumns)
    .where(and(eq(dynamicColumns.id, columnId), eq(dynamicColumns.clinicId, clinicId)))

  if (col.isPrimaryTitle && siblingNonRelation[0]) {
    await db
      .update(dynamicColumns)
      .set({ isPrimaryTitle: true, isRequired: true })
      .where(eq(dynamicColumns.id, siblingNonRelation[0].id))
    await refreshTableDisplayTitles(clinicId, col.tableId)
  }

  return { success: true }
}

// ── Bi-Directional Relations ─────────────────────────────────────────────────

export async function createDynamicRelation(input: {
  sourceTableId: string
  targetTableId: string
  sourceColumnName?: string
  inverseColumnName?: string
  createInverseColumn?: boolean
  cardinality?: RelationCardinality
  onDelete?: 'set_null' | 'cascade' | 'restrict'
}) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const tables = await db
    .select()
    .from(dynamicTables)
    .where(
      and(
        eq(dynamicTables.clinicId, clinicId),
        inArray(dynamicTables.id, [input.sourceTableId, input.targetTableId])
      )
    )
  const sourceTable = tables.find((t) => t.id === input.sourceTableId)
  const targetTable = tables.find((t) => t.id === input.targetTableId)
  if (!sourceTable || !targetTable) throw new Error('Kaynak veya hedef tablo bulunamadı')

  const cardinality: RelationCardinality =
    input.cardinality === 'one_to_one' || input.cardinality === 'many_to_many'
      ? input.cardinality
      : 'one_to_many'
  const onDelete =
    input.onDelete === 'cascade' || input.onDelete === 'restrict' ? input.onDelete : 'set_null'

  const forwardColName = (input.sourceColumnName || '').trim() || targetTable.name
  const forwardSlug = await resolveUniqueColumnSlug(sourceTable.id, forwardColName)
  const sourceColCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dynamicColumns)
    .where(eq(dynamicColumns.tableId, sourceTable.id))

  const [forwardCol] = await db
    .insert(dynamicColumns)
    .values({
      clinicId,
      tableId: sourceTable.id,
      name: forwardColName,
      slug: forwardSlug,
      fieldType: 'relation',
      isPrimaryTitle: false,
      isRequired: false,
      isUnique: false,
      showInTable: true,
      width: 200,
      sortOrder: Number(sourceColCount[0]?.count || 0),
      config: {
        targetTableId: targetTable.id,
        relationDirection: 'forward',
        cardinality,
        allowMultiple: cardinality !== 'one_to_one',
      } satisfies DynamicColumnConfig,
    })
    .returning()

  if (!forwardCol) throw new Error('İlişki sütunu oluşturulamadı')

  let inverseCol: typeof forwardCol | null = null
  const shouldCreateInverse =
    input.createInverseColumn !== false && sourceTable.id !== targetTable.id

  if (shouldCreateInverse) {
    const invName = (input.inverseColumnName || '').trim() || sourceTable.name
    const invSlug = await resolveUniqueColumnSlug(targetTable.id, invName)
    const targetColCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dynamicColumns)
      .where(eq(dynamicColumns.tableId, targetTable.id))

    const [createdInv] = await db
      .insert(dynamicColumns)
      .values({
        clinicId,
        tableId: targetTable.id,
        name: invName,
        slug: invSlug,
        fieldType: 'relation',
        isPrimaryTitle: false,
        isRequired: false,
        isUnique: false,
        showInTable: true,
        width: 200,
        sortOrder: Number(targetColCount[0]?.count || 0),
        config: {
          targetTableId: sourceTable.id,
          relationDirection: 'inverse',
          cardinality,
          allowMultiple: cardinality === 'many_to_many',
        } satisfies DynamicColumnConfig,
      })
      .returning()

    inverseCol = createdInv ?? null
  }

  const [relation] = await db
    .insert(dynamicRelations)
    .values({
      clinicId,
      sourceTableId: sourceTable.id,
      sourceColumnId: forwardCol.id,
      targetTableId: targetTable.id,
      inverseColumnId: inverseCol?.id ?? null,
      cardinality,
      onDelete,
    })
    .returning()

  if (!relation) throw new Error('İlişki kaydı oluşturulamadı')

  await db
    .update(dynamicColumns)
    .set({
      config: {
        ...(forwardCol.config as Record<string, unknown>),
        relationId: relation.id,
      },
    })
    .where(eq(dynamicColumns.id, forwardCol.id))

  if (inverseCol) {
    await db
      .update(dynamicColumns)
      .set({
        config: {
          ...(inverseCol.config as Record<string, unknown>),
          relationId: relation.id,
        },
      })
      .where(eq(dynamicColumns.id, inverseCol.id))
  }

  return relation
}

export async function deleteDynamicRelation(relationId: string) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const [rel] = await db
    .select()
    .from(dynamicRelations)
    .where(and(eq(dynamicRelations.id, relationId), eq(dynamicRelations.clinicId, clinicId)))
    .limit(1)
  if (!rel) throw new Error('İlişki bulunamadı')

  const colIds = [rel.sourceColumnId, rel.inverseColumnId].filter((id): id is string => Boolean(id))
  await db
    .delete(dynamicRelations)
    .where(and(eq(dynamicRelations.id, relationId), eq(dynamicRelations.clinicId, clinicId)))

  if (colIds.length > 0) {
    await db
      .delete(dynamicColumns)
      .where(and(eq(dynamicColumns.clinicId, clinicId), inArray(dynamicColumns.id, colIds)))
  }

  return { success: true }
}

// ── Appointment Config (Table <-> Randevu System Node) ──────────────────────

export async function upsertAppointmentConfig(input: {
  tableId: string
  enabled?: boolean
  titleColumnId?: string | null
  phoneColumnId?: string | null
  emailColumnId?: string | null
  isRequiredInAppointment?: boolean
  allowMultiple?: boolean
  includeRelatedTables?: boolean
}) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const [table] = await db
    .select()
    .from(dynamicTables)
    .where(and(eq(dynamicTables.id, input.tableId), eq(dynamicTables.clinicId, clinicId)))
    .limit(1)
  if (!table) throw new Error('Tablo bulunamadı')

  const [cols, existingRows] = await Promise.all([
    db
      .select()
      .from(dynamicColumns)
      .where(and(eq(dynamicColumns.clinicId, clinicId), eq(dynamicColumns.tableId, table.id)))
      .orderBy(asc(dynamicColumns.sortOrder)),
    db
      .select()
      .from(dynamicAppointmentConfigs)
      .where(
        and(
          eq(dynamicAppointmentConfigs.clinicId, clinicId),
          eq(dynamicAppointmentConfigs.tableId, table.id)
        )
      )
      .limit(1),
  ])

  const existing = existingRows[0] ?? null
  const defaultTitleCol = cols.find((c) => c.isPrimaryTitle) ?? cols.find((c) => c.fieldType !== 'relation') ?? null
  const defaultPhoneCol = cols.find((c) => c.fieldType === 'phone') ?? null
  const defaultEmailCol = cols.find((c) => c.fieldType === 'email') ?? null

  const resolvedTitleId =
    input.titleColumnId !== undefined
      ? input.titleColumnId && cols.some((c) => c.id === input.titleColumnId)
        ? input.titleColumnId
        : defaultTitleCol?.id ?? null
      : existing?.titleColumnId && cols.some((c) => c.id === existing.titleColumnId)
        ? existing.titleColumnId
        : defaultTitleCol?.id ?? null

  const resolvedPhoneId =
    input.phoneColumnId !== undefined
      ? input.phoneColumnId && cols.some((c) => c.id === input.phoneColumnId)
        ? input.phoneColumnId
        : null
      : existing !== null
        ? existing.phoneColumnId && cols.some((c) => c.id === existing.phoneColumnId)
          ? existing.phoneColumnId
          : null
        : defaultPhoneCol?.id ?? null

  const resolvedEmailId =
    input.emailColumnId !== undefined
      ? input.emailColumnId && cols.some((c) => c.id === input.emailColumnId)
        ? input.emailColumnId
        : null
      : existing !== null
        ? existing.emailColumnId && cols.some((c) => c.id === existing.emailColumnId)
          ? existing.emailColumnId
          : null
        : defaultEmailCol?.id ?? null

  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : (existing ? Boolean(existing.enabled) : true)
  const isRequired =
    input.isRequiredInAppointment !== undefined
      ? Boolean(input.isRequiredInAppointment)
      : Boolean(existing?.isRequiredInAppointment)
  const allowMultiple =
    input.allowMultiple !== undefined
      ? Boolean(input.allowMultiple)
      : Boolean(existing?.allowMultiple)
  const includeRelatedTables =
    input.includeRelatedTables !== undefined
      ? Boolean(input.includeRelatedTables)
      : existing
        ? Boolean(existing.includeRelatedTables)
        : true

  const [saved] = await db
    .insert(dynamicAppointmentConfigs)
    .values({
      clinicId,
      tableId: table.id,
      enabled,
      titleColumnId: resolvedTitleId,
      phoneColumnId: resolvedPhoneId,
      emailColumnId: resolvedEmailId,
      isRequiredInAppointment: isRequired,
      allowMultiple,
      includeRelatedTables,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [dynamicAppointmentConfigs.clinicId, dynamicAppointmentConfigs.tableId],
      set: {
        enabled,
        titleColumnId: resolvedTitleId,
        phoneColumnId: resolvedPhoneId,
        emailColumnId: resolvedEmailId,
        isRequiredInAppointment: isRequired,
        allowMultiple,
        includeRelatedTables,
        updatedAt: new Date(),
      },
    })
    .returning()

  return saved
}

export async function deleteAppointmentConfig(tableId: string) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  await db
    .delete(dynamicAppointmentConfigs)
    .where(
      and(
        eq(dynamicAppointmentConfigs.clinicId, clinicId),
        eq(dynamicAppointmentConfigs.tableId, tableId)
      )
    )
  return { success: true }
}

// ── Finance & Stock Module Config (Table <-> Module Role & Column Mapping) ──

export async function upsertModuleConfig(input: {
  tableId: string
  moduleRole: DynamicModuleRole
  enabled?: boolean
  mapping?: DynamicModuleMapping
  allowSystemFinanceBinding?: boolean
}) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  if (!ALLOWED_MODULE_ROLES.includes(input.moduleRole)) {
    throw new Error(`Geçersiz modül rolü: ${input.moduleRole}`)
  }

  const [table] = await db
    .select()
    .from(dynamicTables)
    .where(and(eq(dynamicTables.id, input.tableId), eq(dynamicTables.clinicId, clinicId)))
    .limit(1)
  if (!table) throw new Error('Tablo bulunamadı')

  const [allTables, cols, clinicModConfigs] = await Promise.all([
    db.select().from(dynamicTables).where(eq(dynamicTables.clinicId, clinicId)),
    db
      .select()
      .from(dynamicColumns)
      .where(and(eq(dynamicColumns.clinicId, clinicId), eq(dynamicColumns.tableId, table.id)))
      .orderBy(asc(dynamicColumns.sortOrder)),
    db
      .select()
      .from(dynamicModuleConfigs)
      .where(eq(dynamicModuleConfigs.clinicId, clinicId)),
  ])

  const existing = clinicModConfigs.find((mc) => mc.tableId === table.id) ?? null

  const isAlreadySameFinanceRole = Boolean(
    existing && existing.enabled && isFinanceModuleRole(existing.moduleRole) && existing.moduleRole === input.moduleRole
  )

  // Enforce fixed canonical finance tables: no extra finance tables, no detaching/re-roling standard finance tables
  if (existing && existing.enabled && isFinanceModuleRole(existing.moduleRole)) {
    if (existing.moduleRole !== input.moduleRole) {
      throw new Error('Standart finans tablosunun rolü değiştirilemez.')
    }
    if (input.enabled === false) {
      throw new Error('Standart finans tabloları devre dışı bırakılamaz.')
    }
  }
  if (isFinanceModuleRole(input.moduleRole)) {
    const otherSameFinanceRole = clinicModConfigs.find(
      (mc) => mc.enabled && mc.moduleRole === input.moduleRole && mc.tableId !== table.id
    )
    if (otherSameFinanceRole && !isAlreadySameFinanceRole) {
      throw new Error(
        'Finans modülünde ekstra tablo oluşturulamaz veya bağlanamaz. Yalnızca standart Gelir & Tahsilat ve Gider & Masraf tabloları kullanılır.'
      )
    }
    if (!input.allowSystemFinanceBinding && (!existing || existing.moduleRole !== input.moduleRole)) {
      throw new Error(
        'Finans tabloları standart ve sabittir; harici veya ekstra bir tablo finans modülüne bağlanamaz.'
      )
    }
  }

  const validColIds = new Set(cols.map((c) => c.id))
  const inferred = inferModuleMappingForTable(input.moduleRole, cols, allTables)
  const existingMap =
    existing && existing.moduleRole === input.moduleRole
      ? ((existing.mapping ?? {}) as Record<string, unknown>)
      : {}

  const merged: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(inferred)) {
    merged[k] = typeof v === 'string' && validColIds.has(v) ? v : null
  }
  for (const [k, v] of Object.entries(existingMap)) {
    if (typeof v === 'string' && validColIds.has(v)) merged[k] = v
    else if (v === null && (!isFinanceModuleRole(input.moduleRole) || !CORE_PROTECTED_FINANCE_KEY_SET.has(k))) {
      merged[k] = null
    }
  }
  if (input.mapping) {
    for (const [k, v] of Object.entries(input.mapping)) {
      if (v === undefined) continue
      if (
        isFinanceModuleRole(input.moduleRole) &&
        !input.allowSystemFinanceBinding &&
        CORE_PROTECTED_FINANCE_KEY_SET.has(k)
      ) {
        const currentMapped = merged[k] ?? null
        const requested = v === null || v === '' ? null : String(v)
        if (currentMapped && requested !== currentMapped) {
          throw new Error(
            'Ön muhasebe uyumluluğu için standart finans sütun eşlemeleri değiştirilemez veya kaldırılamaz.'
          )
        }
        continue
      }
      if (v === null || v === '') merged[k] = null
      else if (typeof v === 'string' && validColIds.has(v)) merged[k] = v
    }
  }

  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : (existing ? Boolean(existing.enabled) : true)

  const [saved] = await db
    .insert(dynamicModuleConfigs)
    .values({
      clinicId,
      tableId: table.id,
      moduleRole: input.moduleRole,
      enabled,
      mapping: merged,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [dynamicModuleConfigs.clinicId, dynamicModuleConfigs.tableId],
      set: {
        moduleRole: input.moduleRole,
        enabled,
        mapping: merged,
        updatedAt: new Date(),
      },
    })
    .returning()

  return saved
}

export async function deleteModuleConfig(tableId: string) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  const [existing] = await db
    .select({ moduleRole: dynamicModuleConfigs.moduleRole, enabled: dynamicModuleConfigs.enabled })
    .from(dynamicModuleConfigs)
    .where(
      and(
        eq(dynamicModuleConfigs.clinicId, clinicId),
        eq(dynamicModuleConfigs.tableId, tableId)
      )
    )
    .limit(1)
  if (existing?.enabled && isFinanceModuleRole(existing.moduleRole)) {
    throw new Error('Standart finans tablolarının modül bağlantısı kaldırılamaz.')
  }
  await db
    .delete(dynamicModuleConfigs)
    .where(
      and(
        eq(dynamicModuleConfigs.clinicId, clinicId),
        eq(dynamicModuleConfigs.tableId, tableId)
      )
    )
  return { success: true }
}

// ── Row CRUD & Relational Hydration ──────────────────────────────────────────

export interface LinkedRowSummary {
  id: string
  tableId: string
  displayTitle: string
}

export async function listDynamicRows(
  tableId: string,
  opts?: { archived?: boolean; search?: string }
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  const isArchived = Boolean(opts?.archived)
  const search = (opts?.search || '').trim()

  const conditions = [
    eq(dynamicRows.clinicId, clinicId),
    eq(dynamicRows.tableId, tableId),
    eq(dynamicRows.isArchived, isArchived),
  ]
  if (search) {
    conditions.push(
      or(
        ilike(dynamicRows.displayTitle, `%${search}%`),
        sql`${dynamicRows.values}::text ILIKE ${`%${search}%`}`
      )!
    )
  }

  const [rows, tableRelations] = await Promise.all([
    db
      .select()
      .from(dynamicRows)
      .where(and(...conditions))
      .orderBy(desc(dynamicRows.createdAt)),
    db
      .select()
      .from(dynamicRelations)
      .where(
        and(
          eq(dynamicRelations.clinicId, clinicId),
          or(
            eq(dynamicRelations.sourceTableId, tableId),
            eq(dynamicRelations.targetTableId, tableId)
          )
        )
      ),
  ])

  if (rows.length === 0) return []
  const rowIds = rows.map((r) => r.id)

  const [forwardLinks, inverseLinks, apptCounts] = await Promise.all([
    tableRelations.some((r) => r.sourceTableId === tableId)
      ? db
          .select({
            relationId: dynamicRowLinks.relationId,
            sourceRowId: dynamicRowLinks.sourceRowId,
            targetId: dynamicRows.id,
            targetTableId: dynamicRows.tableId,
            targetTitle: dynamicRows.displayTitle,
          })
          .from(dynamicRowLinks)
          .innerJoin(dynamicRows, eq(dynamicRows.id, dynamicRowLinks.targetRowId))
          .where(
            and(
              eq(dynamicRowLinks.clinicId, clinicId),
              inArray(dynamicRowLinks.sourceRowId, rowIds),
              eq(dynamicRows.isArchived, false)
            )
          )
      : Promise.resolve([]),
    tableRelations.some((r) => r.targetTableId === tableId && r.inverseColumnId)
      ? db
          .select({
            relationId: dynamicRowLinks.relationId,
            targetRowId: dynamicRowLinks.targetRowId,
            sourceId: dynamicRows.id,
            sourceTableId: dynamicRows.tableId,
            sourceTitle: dynamicRows.displayTitle,
          })
          .from(dynamicRowLinks)
          .innerJoin(dynamicRows, eq(dynamicRows.id, dynamicRowLinks.sourceRowId))
          .where(
            and(
              eq(dynamicRowLinks.clinicId, clinicId),
              inArray(dynamicRowLinks.targetRowId, rowIds),
              eq(dynamicRows.isArchived, false)
            )
          )
      : Promise.resolve([]),
    db
      .select({
        rowId: dynamicAppointmentLinks.rowId,
        count: sql<number>`count(*)::int`,
      })
      .from(dynamicAppointmentLinks)
      .innerJoin(dentalAppointments, eq(dentalAppointments.id, dynamicAppointmentLinks.appointmentId))
      .where(
        and(
          eq(dynamicAppointmentLinks.clinicId, clinicId),
          inArray(dynamicAppointmentLinks.rowId, rowIds),
          eq(dentalAppointments.isActive, true),
          ne(dentalAppointments.status, 'cancelled')
        )
      )
      .groupBy(dynamicAppointmentLinks.rowId),
  ])

  const relById = new Map(tableRelations.map((r) => [r.id, r]))
  const linksByRowAndCol = new Map<string, Record<string, LinkedRowSummary[]>>()

  for (const fl of forwardLinks) {
    const rel = relById.get(fl.relationId)
    if (!rel) continue
    const rowMap = linksByRowAndCol.get(fl.sourceRowId) ?? {}
    const list = rowMap[rel.sourceColumnId] ?? []
    list.push({ id: fl.targetId, tableId: fl.targetTableId, displayTitle: fl.targetTitle })
    rowMap[rel.sourceColumnId] = list
    linksByRowAndCol.set(fl.sourceRowId, rowMap)
  }

  for (const il of inverseLinks) {
    const rel = relById.get(il.relationId)
    if (!rel?.inverseColumnId) continue
    const rowMap = linksByRowAndCol.get(il.targetRowId) ?? {}
    const list = rowMap[rel.inverseColumnId] ?? []
    list.push({ id: il.sourceId, tableId: il.sourceTableId, displayTitle: il.sourceTitle })
    rowMap[rel.inverseColumnId] = list
    linksByRowAndCol.set(il.targetRowId, rowMap)
  }

  const apptCountMap = new Map(apptCounts.map((a) => [a.rowId, Number(a.count || 0)]))

  return rows.map((r) => ({
    ...r,
    relations: linksByRowAndCol.get(r.id) ?? {},
    appointmentCount: apptCountMap.get(r.id) ?? 0,
  }))
}

async function syncRowLinksForColumns(
  clinicId: string,
  tableId: string,
  rowId: string,
  relationInputs: Record<string, string[]>
) {
  const relColumns = await db
    .select()
    .from(dynamicColumns)
    .where(
      and(
        eq(dynamicColumns.clinicId, clinicId),
        eq(dynamicColumns.tableId, tableId),
        eq(dynamicColumns.fieldType, 'relation')
      )
    )
  if (relColumns.length === 0) return

  const rels = await db
    .select()
    .from(dynamicRelations)
    .where(
      and(
        eq(dynamicRelations.clinicId, clinicId),
        or(
          eq(dynamicRelations.sourceTableId, tableId),
          eq(dynamicRelations.targetTableId, tableId)
        )
      )
    )
  const relById = new Map(rels.map((r) => [r.id, r]))

  for (const col of relColumns) {
    if (!(col.id in relationInputs)) continue
    const cfg = (col.config || {}) as DynamicColumnConfig
    const rel =
      (cfg.relationId ? relById.get(cfg.relationId) : undefined) ??
      rels.find((r) => r.sourceColumnId === col.id || r.inverseColumnId === col.id)
    if (!rel) continue

    const rawIds = Array.isArray(relationInputs[col.id]) ? relationInputs[col.id]! : []
    const cleanIds = Array.from(new Set(rawIds.filter(isValidUuid)))
    const isForward = rel.sourceColumnId === col.id

    if (isForward) {
      await db
        .delete(dynamicRowLinks)
        .where(
          and(
            eq(dynamicRowLinks.clinicId, clinicId),
            eq(dynamicRowLinks.relationId, rel.id),
            eq(dynamicRowLinks.sourceRowId, rowId)
          )
        )
      const limitedIds = rel.cardinality === 'one_to_one' ? cleanIds.slice(0, 1) : cleanIds
      if (rel.cardinality === 'one_to_one' && limitedIds[0]) {
        await db
          .delete(dynamicRowLinks)
          .where(
            and(
              eq(dynamicRowLinks.clinicId, clinicId),
              eq(dynamicRowLinks.relationId, rel.id),
              eq(dynamicRowLinks.targetRowId, limitedIds[0])
            )
          )
      }
      if (rel.cardinality === 'one_to_many' && limitedIds.length > 0) {
        // In 1:N (source 1 -> target N), a target child belongs to at most one source parent
        await db
          .delete(dynamicRowLinks)
          .where(
            and(
              eq(dynamicRowLinks.clinicId, clinicId),
              eq(dynamicRowLinks.relationId, rel.id),
              inArray(dynamicRowLinks.targetRowId, limitedIds)
            )
          )
      }
      for (const targetId of limitedIds) {
        await db
          .insert(dynamicRowLinks)
          .values({
            clinicId,
            relationId: rel.id,
            sourceRowId: rowId,
            targetRowId: targetId,
          })
          .onConflictDoNothing()
      }
    } else if (rel.inverseColumnId === col.id) {
      await db
        .delete(dynamicRowLinks)
        .where(
          and(
            eq(dynamicRowLinks.clinicId, clinicId),
            eq(dynamicRowLinks.relationId, rel.id),
            eq(dynamicRowLinks.targetRowId, rowId)
          )
        )
      const limitedIds =
        rel.cardinality === 'many_to_many' ? cleanIds : cleanIds.slice(0, 1)
      if (rel.cardinality === 'one_to_one' && limitedIds[0]) {
        await db
          .delete(dynamicRowLinks)
          .where(
            and(
              eq(dynamicRowLinks.clinicId, clinicId),
              eq(dynamicRowLinks.relationId, rel.id),
              eq(dynamicRowLinks.sourceRowId, limitedIds[0])
            )
          )
      }
      for (const sourceId of limitedIds) {
        await db
          .insert(dynamicRowLinks)
          .values({
            clinicId,
            relationId: rel.id,
            sourceRowId: sourceId,
            targetRowId: rowId,
          })
          .onConflictDoNothing()
      }
    }
  }
}

async function validateAndPrepareValues(
  clinicId: string,
  tableId: string,
  columns: Array<typeof dynamicColumns.$inferSelect>,
  incomingValues: Record<string, unknown>,
  existingValues?: Record<string, unknown>,
  excludeRowId?: string
): Promise<Record<string, unknown>> {
  const merged: Record<string, unknown> = { ...(existingValues || {}) }

  for (const col of columns) {
    if (col.fieldType === 'relation') continue
    if (col.id in incomingValues) {
      merged[col.id] = coerceColumnValue(
        col.fieldType as DynamicFieldType,
        incomingValues[col.id],
        col.config as DynamicColumnConfig
      )
    } else if (!(col.id in merged)) {
      merged[col.id] = col.fieldType === 'boolean' ? false : col.fieldType === 'multiselect' ? [] : null
    }

    const val = merged[col.id]
    const isEmpty =
      val === null ||
      val === undefined ||
      (typeof val === 'string' && val.trim() === '') ||
      (Array.isArray(val) && val.length === 0)

    if (col.isRequired && col.fieldType !== 'boolean' && isEmpty) {
      throw new Error(`"${col.name}" alanı zorunludur`)
    }

    if (col.isUnique && !isEmpty && typeof val !== 'boolean' && !Array.isArray(val)) {
      const valText = String(val)
      const dupRows = await db
        .select({ id: dynamicRows.id })
        .from(dynamicRows)
        .where(
          and(
            eq(dynamicRows.clinicId, clinicId),
            eq(dynamicRows.tableId, tableId),
            eq(dynamicRows.isArchived, false),
            excludeRowId ? ne(dynamicRows.id, excludeRowId) : sql`true`,
            sql`${dynamicRows.values} ->> ${col.id} = ${valText}`
          )
        )
        .limit(1)
      if (dupRows.length > 0) {
        throw new Error(`"${col.name}" alanında "${valText}" değeri başka bir kayıtta zaten kullanılıyor`)
      }
    }
  }

  return merged
}

async function getFinanceModuleForTable(
  clinicId: string,
  tableId: string,
  cols: Array<typeof dynamicColumns.$inferSelect>
): Promise<{ role: 'finance_income' | 'finance_expense'; mapping: DynamicModuleMapping } | null> {
  const [modCfg] = await db
    .select()
    .from(dynamicModuleConfigs)
    .where(
      and(
        eq(dynamicModuleConfigs.clinicId, clinicId),
        eq(dynamicModuleConfigs.tableId, tableId),
        eq(dynamicModuleConfigs.enabled, true)
      )
    )
    .limit(1)
  if (!modCfg || !isFinanceModuleRole(modCfg.moduleRole)) return null
  const inferred = inferModuleMappingForTable(modCfg.moduleRole, cols)
  const validColIds = new Set(cols.map((c) => c.id))
  const saved = (modCfg.mapping ?? {}) as Record<string, unknown>
  const merged = mergeFinanceMappingPreservingCore(inferred, saved, validColIds)
  return { role: modCfg.moduleRole, mapping: merged }
}

function resolveOptionLabelForAccounting(
  col: { fieldType: string; config: unknown } | undefined,
  raw: unknown
): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  const str = String(raw).trim()
  if (!str) return null
  if (col && (col.fieldType === 'select' || col.fieldType === 'multiselect')) {
    const opts = ((col.config as DynamicColumnConfig | undefined)?.options ?? []) as SelectOptionItem[]
    const found = opts.find(
      (o) => o.id === str || o.label.toLocaleLowerCase('tr-TR') === str.toLocaleLowerCase('tr-TR')
    )
    if (found) return found.label
  }
  return str
}

function reconcileFinanceRowValues(
  role: 'finance_income' | 'finance_expense',
  cols: Array<typeof dynamicColumns.$inferSelect>,
  mapping: DynamicModuleMapping,
  preparedValues: Record<string, unknown>,
  incomingValues: Record<string, unknown>,
  previousValues?: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...preparedValues }
  const direction = role === 'finance_expense' ? 'expense' : 'income'

  const didFieldChange = (colId: string | null): boolean => {
    if (!colId || !(colId in incomingValues)) return false
    if (!previousValues) return true
    const nextVal = out[colId]
    const prevVal = previousValues[colId]
    if (nextVal === prevVal) return false
    if (
      (nextVal === null || nextVal === undefined || nextVal === '') &&
      (prevVal === null || prevVal === undefined || prevVal === '')
    ) {
      return false
    }
    if (typeof nextVal === 'number' && typeof prevVal === 'number') {
      return Math.abs(nextVal - prevVal) > 1e-6
    }
    return String(nextVal ?? '') !== String(prevVal ?? '')
  }

  // Currency & Exchange Rate defaults
  const currency = mapping.currencyColumnId
    ? normalizeCurrencyCode(out[mapping.currencyColumnId])
    : 'TRY'
  if (mapping.currencyColumnId && (!out[mapping.currencyColumnId] || String(out[mapping.currencyColumnId]).trim() === '')) {
    out[mapping.currencyColumnId] = currency
  }
  const exchangeRate = mapping.exchangeRateColumnId
    ? normalizeExchangeRate(out[mapping.exchangeRateColumnId], currency)
    : 1
  if (mapping.exchangeRateColumnId) {
    if (currency === 'TRY') {
      out[mapping.exchangeRateColumnId] = 1
    } else if (out[mapping.exchangeRateColumnId] === null || out[mapping.exchangeRateColumnId] === undefined || out[mapping.exchangeRateColumnId] === '') {
      out[mapping.exchangeRateColumnId] = exchangeRate
    }
  }

  // Document type default
  if (mapping.documentTypeColumnId && (!out[mapping.documentTypeColumnId] || String(out[mapping.documentTypeColumnId]).trim() === '')) {
    out[mapping.documentTypeColumnId] = 'belgesiz'
  }

  // Status default
  if (mapping.statusColumnId && (!out[mapping.statusColumnId] || String(out[mapping.statusColumnId]).trim() === '')) {
    out[mapping.statusColumnId] = 'tamamlandi'
  }

  // Quantity & Gross/Net/VAT reconciliation
  const amountColId = mapping.amountColumnId ?? null
  const netColId = mapping.netAmountColumnId ?? null
  const vatRateColId = mapping.vatRateColumnId ?? null
  const vatAmountColId = mapping.vatAmountColumnId ?? null
  const qtyColId = mapping.quantityColumnId ?? null
  const unitCostColId = mapping.unitCostColumnId ?? null

  const qtyRaw = qtyColId ? Number(out[qtyColId]) : 1
  const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1
  const unitCostRaw = unitCostColId ? Number(out[unitCostColId]) : NaN

  let amountChanged = didFieldChange(amountColId)
  const netChanged = didFieldChange(netColId)
  const vatRateChanged = didFieldChange(vatRateColId)
  const qtyChanged = didFieldChange(qtyColId)
  const unitCostChanged = didFieldChange(unitCostColId)

  // For expense rows where user entered/updated quantity & unitCost without directly editing total amount
  const amountMissing =
    amountColId !== null &&
    (out[amountColId] === null || out[amountColId] === undefined || out[amountColId] === '')
  if (
    amountColId &&
    Number.isFinite(unitCostRaw) &&
    unitCostRaw !== 0 &&
    (amountMissing || ((qtyChanged || unitCostChanged) && !amountChanged && !netChanged))
  ) {
    out[amountColId] = roundMoney(qty * unitCostRaw)
    amountChanged = true
  }

  const vatRate = vatRateColId ? normalizeVatRate(out[vatRateColId]) : 0
  if (vatRateColId && (out[vatRateColId] === null || out[vatRateColId] === undefined || out[vatRateColId] === '')) {
    const vatCol = cols.find((c) => c.id === vatRateColId)
    out[vatRateColId] = vatCol?.fieldType === 'number' ? 0 : '0'
  }

  const grossVal = amountColId && out[amountColId] !== null && out[amountColId] !== undefined ? Number(out[amountColId]) : NaN
  const netVal = netColId && out[netColId] !== null && out[netColId] !== undefined ? Number(out[netColId]) : NaN
  const vatVal = vatAmountColId && out[vatAmountColId] !== null && out[vatAmountColId] !== undefined ? Number(out[vatAmountColId]) : NaN

  if (netChanged && !amountChanged && Number.isFinite(netVal)) {
    const calc = calculateAccountingAmounts({
      netAmount: netVal,
      vatRate,
      vatIncluded: false,
      currency,
      exchangeRate,
    })
    if (netColId) out[netColId] = calc.netAmount
    if (vatAmountColId) out[vatAmountColId] = calc.vatAmount
    if (amountColId) out[amountColId] = calc.grossAmount
    if (unitCostColId && !unitCostChanged && qty > 0) {
      out[unitCostColId] = roundMoney(calc.grossAmount / qty)
    }
  } else if (
    Number.isFinite(grossVal) &&
    (amountChanged || vatRateChanged || !Number.isFinite(netVal) || !Number.isFinite(vatVal))
  ) {
    const calc = calculateAccountingAmounts({
      grossAmount: grossVal,
      vatRate,
      vatIncluded: true,
      currency,
      exchangeRate,
    })
    if (amountColId) out[amountColId] = calc.grossAmount
    if (netColId) out[netColId] = calc.netAmount
    if (vatAmountColId) out[vatAmountColId] = calc.vatAmount
  }

  // TDHP default account code
  if (mapping.accountingCodeColumnId && (!out[mapping.accountingCodeColumnId] || String(out[mapping.accountingCodeColumnId]).trim() === '')) {
    const catVal = mapping.categoryColumnId ? String(out[mapping.categoryColumnId] ?? '') : ''
    out[mapping.accountingCodeColumnId] = resolveTdhpAccountCode(direction, catVal)
  }

  return out
}

async function upsertFinanceAccountingSyncForRow(params: {
  clinicId: string
  tableId: string
  rowId: string
  role: 'finance_income' | 'finance_expense'
  cols: Array<typeof dynamicColumns.$inferSelect>
  mapping: DynamicModuleMapping
  displayTitle: string
  values: Record<string, unknown>
  relations?: Record<string, LinkedRowSummary[]>
  createdAt?: Date | string
}) {
  try {
    const colById = new Map(params.cols.map((c) => [c.id, c]))
    const m = params.mapping
    const v = params.values
    const direction = params.role === 'finance_expense' ? 'expense' : 'income'

    const grossAmount = m.amountColumnId ? Number(v[m.amountColumnId] ?? 0) : 0
    const netAmount = m.netAmountColumnId && v[m.netAmountColumnId] != null ? Number(v[m.netAmountColumnId]) : null
    const vatAmount = m.vatAmountColumnId && v[m.vatAmountColumnId] != null ? Number(v[m.vatAmountColumnId]) : null
    const qty = m.quantityColumnId && Number(v[m.quantityColumnId]) > 0 ? Number(v[m.quantityColumnId]) : 1

    const rawDate = m.dateColumnId ? v[m.dateColumnId] : null
    const issueDate =
      typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate)
        ? rawDate.slice(0, 10)
        : new Date(params.createdAt ?? new Date()).toISOString().slice(0, 10)
    const rawDue = m.dueDateColumnId ? v[m.dueDateColumnId] : null
    const dueDate =
      typeof rawDue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDue) ? rawDue.slice(0, 10) : null

    const statusCol = m.statusColumnId ? colById.get(m.statusColumnId) : undefined
    const statusLabel = m.statusColumnId ? resolveOptionLabelForAccounting(statusCol, v[m.statusColumnId]) : null
    const paymentStatus = m.statusColumnId
      ? normalizeAccountingPaymentStatus(v[m.statusColumnId], statusLabel)
      : 'completed'

    const methodCol = m.methodColumnId ? colById.get(m.methodColumnId) : undefined
    const methodCode = m.methodColumnId && v[m.methodColumnId] ? String(v[m.methodColumnId]) : 'nakit'
    const methodLabel = (m.methodColumnId ? resolveOptionLabelForAccounting(methodCol, v[m.methodColumnId]) : null) ?? 'Nakit (Kasa)'

    const catCol = m.categoryColumnId ? colById.get(m.categoryColumnId) : undefined
    const catCode = m.categoryColumnId && v[m.categoryColumnId] ? String(v[m.categoryColumnId]) : (direction === 'income' ? 'hizmet_geliri' : 'diger_gider')
    const catLabel = (m.categoryColumnId ? resolveOptionLabelForAccounting(catCol, v[m.categoryColumnId]) : null) ?? (direction === 'income' ? 'Hizmet / İşlem Geliri' : 'Diğer İşletme Giderleri')

    const linkedPersons = (m.personRelationColumnId ? params.relations?.[m.personRelationColumnId] : undefined) ?? []
    const linkedServices = (m.serviceRelationColumnId ? params.relations?.[m.serviceRelationColumnId] : undefined) ?? []
    const linkedItems = (m.itemRelationColumnId ? params.relations?.[m.itemRelationColumnId] : undefined) ?? []

    const explicitCounterparty = m.counterpartyNameColumnId && v[m.counterpartyNameColumnId]
      ? String(v[m.counterpartyNameColumnId]).trim()
      : null
    const counterpartyName = explicitCounterparty || linkedPersons[0]?.displayTitle || null
    const counterpartyTaxId = m.counterpartyTaxIdColumnId && v[m.counterpartyTaxIdColumnId]
      ? String(v[m.counterpartyTaxIdColumnId]).trim()
      : null

    const canonical = buildCanonicalAccountingEntry({
      clinicId: params.clinicId,
      tableId: params.tableId,
      rowId: params.rowId,
      direction,
      title: params.displayTitle,
      description: m.notesColumnId && v[m.notesColumnId] ? String(v[m.notesColumnId]) : null,
      issueDate,
      dueDate,
      quantity: qty,
      grossAmount: Number.isFinite(grossAmount) ? grossAmount : 0,
      netAmount: Number.isFinite(netAmount ?? NaN) ? netAmount : null,
      vatRate: m.vatRateColumnId ? v[m.vatRateColumnId] : 0,
      vatAmount: Number.isFinite(vatAmount ?? NaN) ? vatAmount : null,
      currency: m.currencyColumnId ? v[m.currencyColumnId] : 'TRY',
      exchangeRate: m.exchangeRateColumnId ? v[m.exchangeRateColumnId] : 1,
      paymentStatus,
      paymentMethodCode: methodCode,
      paymentMethodLabel: methodLabel,
      categoryCode: catCode,
      categoryLabel: catLabel,
      accountingAccountCode: m.accountingCodeColumnId && v[m.accountingCodeColumnId] ? String(v[m.accountingCodeColumnId]) : null,
      documentType: m.documentTypeColumnId ? normalizeDocumentType(v[m.documentTypeColumnId]) : 'belgesiz',
      documentNumber: m.documentNumberColumnId && v[m.documentNumberColumnId] ? String(v[m.documentNumberColumnId]) : null,
      counterpartyLinkedRowId: linkedPersons[0]?.id ?? null,
      counterpartyName,
      counterpartyTaxId,
      linkedItems: [...linkedServices, ...linkedItems].map((li) => ({
        rowId: li.id,
        tableId: li.tableId,
        title: li.displayTitle,
      })),
    })

    const nextSyncStatus = canonical.sync.status
    const nextOptionId = syncStatusToOptionId(nextSyncStatus)

    await db
      .insert(financeAccountingSyncRecords)
      .values({
        clinicId: params.clinicId,
        rowId: params.rowId,
        tableId: params.tableId,
        direction,
        provider: 'local',
        idempotencyKey: canonical.idempotencyKey,
        syncStatus: nextSyncStatus,
        payloadHash: canonical.payloadHash,
        canonicalSnapshot: canonical as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          financeAccountingSyncRecords.clinicId,
          financeAccountingSyncRecords.rowId,
          financeAccountingSyncRecords.provider,
        ],
        set: {
          direction,
          syncStatus: nextSyncStatus,
          payloadHash: canonical.payloadHash,
          canonicalSnapshot: canonical as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      })

    // If any external pre-accounting provider had already synced an older payloadHash, flag it as pending re-sync
    const dirtiedExternal = await db
      .update(financeAccountingSyncRecords)
      .set({
        syncStatus: 'pending',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(financeAccountingSyncRecords.clinicId, params.clinicId),
          eq(financeAccountingSyncRecords.rowId, params.rowId),
          ne(financeAccountingSyncRecords.provider, 'local'),
          eq(financeAccountingSyncRecords.syncStatus, 'synced'),
          ne(financeAccountingSyncRecords.payloadHash, canonical.payloadHash)
        )
      )
      .returning({ id: financeAccountingSyncRecords.id })

    // Mirror readiness/pending status into dynamic row column (including when an externally synced row is dirtied!)
    if (m.accountingSyncStatusColumnId) {
      const currentStatusRaw = String(v[m.accountingSyncStatusColumnId] ?? '').trim()
      const targetOptionId = dirtiedExternal.length > 0 ? 'bekliyor' : nextOptionId
      const shouldMirror =
        dirtiedExternal.length > 0 ||
        !currentStatusRaw ||
        currentStatusRaw === 'bekliyor' ||
        currentStatusRaw === 'hazir' ||
        currentStatusRaw === 'kapsam_disi'
      if (shouldMirror && currentStatusRaw !== targetOptionId) {
        const nextVals = { ...v, [m.accountingSyncStatusColumnId]: targetOptionId }
        await db
          .update(dynamicRows)
          .set({ values: nextVals })
          .where(and(eq(dynamicRows.id, params.rowId), eq(dynamicRows.clinicId, params.clinicId)))
      }
    }
  } catch (err) {
    console.warn('[PreAccounting] Sync record upsert skipped:', err)
  }
}

export async function createDynamicRow(
  tableId: string,
  input: {
    values?: Record<string, unknown>
    relations?: Record<string, string[]>
  },
  userId?: string
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const cols = await db
    .select()
    .from(dynamicColumns)
    .where(and(eq(dynamicColumns.clinicId, clinicId), eq(dynamicColumns.tableId, tableId)))
    .orderBy(asc(dynamicColumns.sortOrder))
  if (cols.length === 0) throw new Error('Tablo bulunamadı veya sütun tanımlı değil')

  const financeMod = await getFinanceModuleForTable(clinicId, tableId, cols)
  const validatedValues = await validateAndPrepareValues(
    clinicId,
    tableId,
    cols,
    input.values || {}
  )
  const preparedValues = financeMod
    ? reconcileFinanceRowValues(
        financeMod.role,
        cols,
        financeMod.mapping,
        validatedValues,
        input.values || {}
      )
    : validatedValues
  const displayTitle = computeDisplayTitle(cols as any, preparedValues)

  const [created] = await db
    .insert(dynamicRows)
    .values({
      clinicId,
      tableId,
      displayTitle,
      values: preparedValues,
      createdBy: isValidUuid(userId) ? userId : null,
    })
    .returning()

  if (!created) throw new Error('Kayıt oluşturulamadı')

  if (input.relations && Object.keys(input.relations).length > 0) {
    await syncRowLinksForColumns(clinicId, tableId, created.id, input.relations)
  }

  let hydrated = await listDynamicRows(tableId)
  let hydratedRow = hydrated.find((r) => r.id === created.id) ?? {
    ...created,
    relations: {},
    appointmentCount: 0,
  }

  if (financeMod) {
    await upsertFinanceAccountingSyncForRow({
      clinicId,
      tableId,
      rowId: created.id,
      role: financeMod.role,
      cols,
      mapping: financeMod.mapping,
      displayTitle: hydratedRow.displayTitle,
      values: (hydratedRow.values || {}) as Record<string, unknown>,
      relations: hydratedRow.relations,
      createdAt: created.createdAt,
    })
    hydrated = await listDynamicRows(tableId)
    hydratedRow = hydrated.find((r) => r.id === created.id) ?? hydratedRow
  }

  return hydratedRow
}

export async function updateDynamicRow(
  rowId: string,
  input: {
    values?: Record<string, unknown>
    relations?: Record<string, string[]>
  }
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const [existing] = await db
    .select()
    .from(dynamicRows)
    .where(and(eq(dynamicRows.id, rowId), eq(dynamicRows.clinicId, clinicId)))
    .limit(1)
  if (!existing) throw new Error('Kayıt bulunamadı')

  const cols = await db
    .select()
    .from(dynamicColumns)
    .where(and(eq(dynamicColumns.clinicId, clinicId), eq(dynamicColumns.tableId, existing.tableId)))
    .orderBy(asc(dynamicColumns.sortOrder))

  const financeMod = await getFinanceModuleForTable(clinicId, existing.tableId, cols)

  const validatedValues = input.values
    ? await validateAndPrepareValues(
        clinicId,
        existing.tableId,
        cols,
        input.values,
        (existing.values || {}) as Record<string, unknown>,
        rowId
      )
    : ((existing.values || {}) as Record<string, unknown>)

  const nextValues =
    financeMod && input.values
      ? reconcileFinanceRowValues(
          financeMod.role,
          cols,
          financeMod.mapping,
          validatedValues,
          input.values,
          (existing.values || {}) as Record<string, unknown>
        )
      : validatedValues

  const displayTitle = computeDisplayTitle(cols as any, nextValues)

  const [updated] = await db
    .update(dynamicRows)
    .set({
      displayTitle,
      values: nextValues,
      updatedAt: new Date(),
    })
    .where(and(eq(dynamicRows.id, rowId), eq(dynamicRows.clinicId, clinicId)))
    .returning()

  if (input.relations && Object.keys(input.relations).length > 0) {
    await syncRowLinksForColumns(clinicId, existing.tableId, rowId, input.relations)
  }

  let hydrated = await listDynamicRows(existing.tableId, { archived: existing.isArchived })
  let hydratedRow = hydrated.find((r) => r.id === rowId) ?? updated

  if (financeMod && hydratedRow) {
    await upsertFinanceAccountingSyncForRow({
      clinicId,
      tableId: existing.tableId,
      rowId,
      role: financeMod.role,
      cols,
      mapping: financeMod.mapping,
      displayTitle: hydratedRow.displayTitle,
      values: (hydratedRow.values || {}) as Record<string, unknown>,
      relations:
        'relations' in hydratedRow
          ? (hydratedRow.relations as Record<string, LinkedRowSummary[]>)
          : undefined,
      createdAt: existing.createdAt,
    })
    hydrated = await listDynamicRows(existing.tableId, { archived: existing.isArchived })
    hydratedRow = hydrated.find((r) => r.id === rowId) ?? hydratedRow
  }

  return hydratedRow
}

export async function bulkImportDynamicRows(
  tableId: string,
  rawRows: Array<{ values: Record<string, unknown>; relationTitles?: Record<string, string[]> }>,
  userId?: string
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const cols = await db
    .select()
    .from(dynamicColumns)
    .where(and(eq(dynamicColumns.clinicId, clinicId), eq(dynamicColumns.tableId, tableId)))
    .orderBy(asc(dynamicColumns.sortOrder))
  if (cols.length === 0) throw new Error('Tablo bulunamadı')

  // Preload target table rows by title for any relation columns present in the import
  const relCols = cols.filter((c) => c.fieldType === 'relation')
  const targetTitleLookup = new Map<string, Map<string, string>>()
  for (const rc of relCols) {
    const cfg = (rc.config || {}) as DynamicColumnConfig
    if (!cfg.targetTableId) continue
    if (targetTitleLookup.has(cfg.targetTableId)) continue
    const targetRows = await db
      .select({ id: dynamicRows.id, displayTitle: dynamicRows.displayTitle })
      .from(dynamicRows)
      .where(
        and(
          eq(dynamicRows.clinicId, clinicId),
          eq(dynamicRows.tableId, cfg.targetTableId),
          eq(dynamicRows.isArchived, false)
        )
      )
    const map = new Map<string, string>()
    for (const tr of targetRows) {
      map.set(tr.displayTitle.trim().toLocaleLowerCase('tr-TR'), tr.id)
    }
    targetTitleLookup.set(cfg.targetTableId, map)
  }

  const financeMod = await getFinanceModuleForTable(clinicId, tableId, cols)

  let importedCount = 0
  const errors: string[] = []

  for (let i = 0; i < rawRows.length; i++) {
    const item = rawRows[i]!
    try {
      const validated = await validateAndPrepareValues(clinicId, tableId, cols, item.values || {})
      const prepared = financeMod
        ? reconcileFinanceRowValues(financeMod.role, cols, financeMod.mapping, validated, item.values || {})
        : validated
      const displayTitle = computeDisplayTitle(cols as any, prepared)
      const [inserted] = await db
        .insert(dynamicRows)
        .values({
          clinicId,
          tableId,
          displayTitle,
          values: prepared,
          createdBy: isValidUuid(userId) ? userId : null,
        })
        .returning({ id: dynamicRows.id })

      let resolvedRelationsSummary: Record<string, LinkedRowSummary[]> | undefined
      if (inserted && item.relationTitles) {
        const resolvedRelIds: Record<string, string[]> = {}
        const summaryMap: Record<string, LinkedRowSummary[]> = {}
        for (const rc of relCols) {
          const titles = item.relationTitles[rc.id]
          const cfg = (rc.config || {}) as DynamicColumnConfig
          if (!titles?.length || !cfg.targetTableId) continue
          const map = targetTitleLookup.get(cfg.targetTableId)
          if (!map) continue
          const matchedEntries: LinkedRowSummary[] = []
          for (const rawTitle of titles) {
            const matchedId = map.get(rawTitle.trim().toLocaleLowerCase('tr-TR'))
            if (matchedId) {
              matchedEntries.push({
                id: matchedId,
                tableId: cfg.targetTableId,
                displayTitle: rawTitle.trim(),
              })
            }
          }
          if (matchedEntries.length > 0) {
            resolvedRelIds[rc.id] = matchedEntries.map((m) => m.id)
            summaryMap[rc.id] = matchedEntries
          }
        }
        if (Object.keys(resolvedRelIds).length > 0) {
          await syncRowLinksForColumns(clinicId, tableId, inserted.id, resolvedRelIds)
          resolvedRelationsSummary = summaryMap
        }
      }
      if (inserted && financeMod) {
        await upsertFinanceAccountingSyncForRow({
          clinicId,
          tableId,
          rowId: inserted.id,
          role: financeMod.role,
          cols,
          mapping: financeMod.mapping,
          displayTitle,
          values: prepared,
          relations: resolvedRelationsSummary,
        })
      }
      importedCount++
    } catch (err: any) {
      errors.push(`Satır ${i + 2}: ${err?.message || 'Geçersiz veri'}`)
    }
  }

  return { importedCount, skippedCount: errors.length, errors }
}

export async function archiveDynamicRows(rowIds: string[]) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  const validIds = rowIds.filter(isValidUuid)
  if (validIds.length === 0) return { archivedCount: 0 }

  const res = await db
    .update(dynamicRows)
    .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(dynamicRows.clinicId, clinicId), inArray(dynamicRows.id, validIds)))
    .returning({ id: dynamicRows.id })

  return { archivedCount: res.length }
}

export async function restoreDynamicRows(rowIds: string[]) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  const validIds = rowIds.filter(isValidUuid)
  if (validIds.length === 0) return { restoredCount: 0 }

  const res = await db
    .update(dynamicRows)
    .set({ isArchived: false, archivedAt: null, updatedAt: new Date() })
    .where(and(eq(dynamicRows.clinicId, clinicId), inArray(dynamicRows.id, validIds)))
    .returning({ id: dynamicRows.id })

  return { restoredCount: res.length }
}

export async function deleteDynamicRows(rowIds: string[]) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  const validIds = rowIds.filter(isValidUuid)
  if (validIds.length === 0) return { deletedCount: 0 }

  // Enforce restrict relations if any
  const restrictLinks = await db
    .select({ id: dynamicRowLinks.id })
    .from(dynamicRowLinks)
    .innerJoin(dynamicRelations, eq(dynamicRelations.id, dynamicRowLinks.relationId))
    .where(
      and(
        eq(dynamicRowLinks.clinicId, clinicId),
        eq(dynamicRelations.onDelete, 'restrict'),
        or(
          inArray(dynamicRowLinks.sourceRowId, validIds),
          inArray(dynamicRowLinks.targetRowId, validIds)
        )
      )
    )
    .limit(1)

  if (restrictLinks.length > 0) {
    throw new Error('Bu kayıt(lar) başka bir tabloda korumalı (Silmeyi Engelle) ilişkiye sahip olduğu için silinemez.')
  }

  // Cascade delete dependent rows when relation on_delete = 'cascade'
  const cascadeLinks = await db
    .select({
      sourceRowId: dynamicRowLinks.sourceRowId,
      targetRowId: dynamicRowLinks.targetRowId,
    })
    .from(dynamicRowLinks)
    .innerJoin(dynamicRelations, eq(dynamicRelations.id, dynamicRowLinks.relationId))
    .where(
      and(
        eq(dynamicRowLinks.clinicId, clinicId),
        eq(dynamicRelations.onDelete, 'cascade'),
        inArray(dynamicRowLinks.sourceRowId, validIds)
      )
    )
  const cascadeTargetIds = cascadeLinks.map((c) => c.targetRowId).filter((id) => !validIds.includes(id))
  const allToDelete = Array.from(new Set([...validIds, ...cascadeTargetIds]))

  // Preserve external pre-accounting audit trail: externally synced finance rows cannot be hard-deleted
  const syncedExternalRows = await db
    .select({ id: financeAccountingSyncRecords.id })
    .from(financeAccountingSyncRecords)
    .where(
      and(
        eq(financeAccountingSyncRecords.clinicId, clinicId),
        inArray(financeAccountingSyncRecords.rowId, allToDelete),
        ne(financeAccountingSyncRecords.provider, 'local'),
        eq(financeAccountingSyncRecords.syncStatus, 'synced')
      )
    )
    .limit(1)
  if (syncedExternalRows.length > 0) {
    throw new Error(
      'Ön muhasebe yazılımına aktarılmış finans kayıtları kalıcı olarak silinemez; durumunu "İptal" olarak güncelleyebilir veya arşivleyebilirsiniz.'
    )
  }

  const deleted = await db
    .delete(dynamicRows)
    .where(and(eq(dynamicRows.clinicId, clinicId), inArray(dynamicRows.id, allToDelete)))
    .returning({ id: dynamicRows.id })

  return { deletedCount: deleted.length }
}

export async function getDynamicRowDetail(rowId: string) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const [row] = await db
    .select()
    .from(dynamicRows)
    .where(and(eq(dynamicRows.id, rowId), eq(dynamicRows.clinicId, clinicId)))
    .limit(1)
  if (!row) return null

  const [hydratedList, appts] = await Promise.all([
    listDynamicRows(row.tableId, { archived: row.isArchived }),
    db
      .select({
        id: dentalAppointments.id,
        title: dentalAppointments.title,
        startTime: dentalAppointments.startTime,
        endTime: dentalAppointments.endTime,
        status: dentalAppointments.status,
        type: dentalAppointments.type,
        notes: dentalAppointments.notes,
        doctorId: dentalAppointments.doctorId,
        doctorName: users.name,
      })
      .from(dynamicAppointmentLinks)
      .innerJoin(dentalAppointments, eq(dentalAppointments.id, dynamicAppointmentLinks.appointmentId))
      .leftJoin(users, eq(users.id, dentalAppointments.doctorId))
      .where(
        and(
          eq(dynamicAppointmentLinks.clinicId, clinicId),
          eq(dynamicAppointmentLinks.rowId, rowId),
          eq(dentalAppointments.isActive, true)
        )
      )
      .orderBy(desc(dentalAppointments.startTime)),
  ])

  const hydratedRow = hydratedList.find((r) => r.id === rowId) ?? {
    ...row,
    relations: {},
    appointmentCount: appts.length,
  }

  return {
    row: hydratedRow,
    appointments: appts,
  }
}

// ── Appointment <-> Dynamic Tables Integration ──────────────────────────────

export interface AppointmentDynamicFieldHighlight {
  columnId: string
  name: string
  fieldType: string
  displayValue: string
}

export interface AppointmentDynamicLinkDetail {
  tableId: string
  tableName: string
  tableIcon: string
  tableColor: string
  rowId: string
  displayTitle: string
  phone: string | null
  email: string | null
  values: Record<string, unknown>
  fieldHighlights?: AppointmentDynamicFieldHighlight[]
}

export async function syncAppointmentDynamicLinks(
  appointmentId: string,
  links: Array<{ tableId: string; rowId: string }>
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  if (!isValidUuid(appointmentId)) return

  await db
    .delete(dynamicAppointmentLinks)
    .where(
      and(
        eq(dynamicAppointmentLinks.clinicId, clinicId),
        eq(dynamicAppointmentLinks.appointmentId, appointmentId)
      )
    )

  const seen = new Set<string>()
  for (const item of links) {
    if (!isValidUuid(item.tableId) || !isValidUuid(item.rowId)) continue
    if (seen.has(item.rowId)) continue
    seen.add(item.rowId)
    await db
      .insert(dynamicAppointmentLinks)
      .values({
        clinicId,
        appointmentId,
        tableId: item.tableId,
        rowId: item.rowId,
      })
      .onConflictDoNothing()
  }
}

export async function getAppointmentDynamicLinksMap(
  appointmentIds: string[]
): Promise<Map<string, AppointmentDynamicLinkDetail[]>> {
  const result = new Map<string, AppointmentDynamicLinkDetail[]>()
  if (appointmentIds.length === 0) return result

  try {
    await ensureDynamicTablesSchema()
    const clinicId = requireClinicId()
    const validIds = appointmentIds.filter(isValidUuid)
    if (validIds.length === 0) return result

    const [joined, configs, allCols] = await Promise.all([
      db
        .select({
          appointmentId: dynamicAppointmentLinks.appointmentId,
          tableId: dynamicTables.id,
          tableName: dynamicTables.name,
          tableIcon: dynamicTables.icon,
          tableColor: dynamicTables.color,
          rowId: dynamicRows.id,
          displayTitle: dynamicRows.displayTitle,
          values: dynamicRows.values,
        })
        .from(dynamicAppointmentLinks)
        .innerJoin(dynamicTables, eq(dynamicTables.id, dynamicAppointmentLinks.tableId))
        .innerJoin(dynamicRows, eq(dynamicRows.id, dynamicAppointmentLinks.rowId))
        .where(
          and(
            eq(dynamicAppointmentLinks.clinicId, clinicId),
            inArray(dynamicAppointmentLinks.appointmentId, validIds)
          )
        ),
      db
        .select()
        .from(dynamicAppointmentConfigs)
        .where(eq(dynamicAppointmentConfigs.clinicId, clinicId)),
      db
        .select()
        .from(dynamicColumns)
        .where(eq(dynamicColumns.clinicId, clinicId))
        .orderBy(asc(dynamicColumns.sortOrder)),
    ])

    const cfgByTable = new Map(configs.map((c) => [c.tableId, c]))
    const colsByTable = new Map<string, typeof allCols>()
    for (const c of allCols) {
      const arr = colsByTable.get(c.tableId) ?? []
      arr.push(c)
      colsByTable.set(c.tableId, arr)
    }

    for (const item of joined) {
      const cfg = cfgByTable.get(item.tableId)
      const tCols = colsByTable.get(item.tableId) ?? []
      const vals = (item.values || {}) as Record<string, unknown>
      const phoneColId =
        cfg?.phoneColumnId || tCols.find((c) => c.fieldType === 'phone')?.id || null
      const emailColId =
        cfg?.emailColumnId || tCols.find((c) => c.fieldType === 'email')?.id || null
      const titleColId =
        cfg?.titleColumnId ||
        tCols.find((c) => c.isPrimaryTitle)?.id ||
        tCols.find((c) => c.fieldType !== 'relation')?.id ||
        null

      const phone = phoneColId && vals[phoneColId] ? String(vals[phoneColId]) : null
      const email = emailColId && vals[emailColId] ? String(vals[emailColId]) : null
      const customTitle =
        titleColId && vals[titleColId] ? String(vals[titleColId]).trim() : ''

      const fieldHighlights: AppointmentDynamicFieldHighlight[] = []
      for (const col of tCols) {
        if (col.fieldType === 'relation' || col.fieldType === 'color') continue
        if (col.isPrimaryTitle || col.id === titleColId) continue
        const raw = vals[col.id]
        if (raw === null || raw === undefined || raw === '') continue
        let displayValue = ''
        const colCfg = (col.config || {}) as Record<string, any>
        if (col.fieldType === 'boolean') {
          if (raw === true) displayValue = 'Evet'
          else continue
        } else if (col.fieldType === 'currency') {
          const num = Number(raw)
          const sym = typeof colCfg.currencySymbol === 'string' ? colCfg.currencySymbol : '₺'
          displayValue = Number.isFinite(num)
            ? `${num.toLocaleString('tr-TR')} ${sym}`
            : `${String(raw)} ${sym}`
        } else if (col.fieldType === 'date') {
          const dStr = String(raw).slice(0, 10)
          const parts = dStr.split('-')
          displayValue = parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : String(raw)
        } else if (col.fieldType === 'select') {
          const opts = Array.isArray(colCfg.options) ? colCfg.options : []
          const found = opts.find((o: any) => o.id === raw)
          displayValue = found?.label ? String(found.label) : String(raw)
        } else if (col.fieldType === 'multiselect') {
          if (!Array.isArray(raw) || raw.length === 0) continue
          const opts = Array.isArray(colCfg.options) ? colCfg.options : []
          displayValue = raw
            .map((id) => opts.find((o: any) => o.id === id)?.label || String(id))
            .join(', ')
        } else {
          displayValue = String(raw).trim()
        }
        if (!displayValue) continue
        fieldHighlights.push({
          columnId: col.id,
          name: col.name,
          fieldType: col.fieldType,
          displayValue,
        })
        if (fieldHighlights.length >= 6) break
      }

      const list = result.get(item.appointmentId) ?? []
      list.push({
        tableId: item.tableId,
        tableName: item.tableName,
        tableIcon: item.tableIcon,
        tableColor: item.tableColor,
        rowId: item.rowId,
        displayTitle: customTitle || item.displayTitle,
        phone,
        email,
        values: vals,
        fieldHighlights,
      })
      result.set(item.appointmentId, list)
    }
  } catch (err) {
    console.warn('[DynamicTables] Could not hydrate appointment dynamic links:', err)
  }

  return result
}

export async function updateAppointmentDynamicLinksAndMeta(
  appointmentId: string,
  links: Array<{ tableId: string; rowId: string }>,
  opts?: { syncTitle?: boolean }
) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()
  if (!isValidUuid(appointmentId)) throw new Error('Geçersiz randevu kimliği')

  const [existing] = await db
    .select()
    .from(dentalAppointments)
    .where(and(eq(dentalAppointments.id, appointmentId), eq(dentalAppointments.clinicId, clinicId)))
    .limit(1)
  if (!existing) throw new Error('Randevu bulunamadı')

  await syncAppointmentDynamicLinks(appointmentId, links)
  const map = await getAppointmentDynamicLinksMap([appointmentId])
  const hydratedLinks = map.get(appointmentId) ?? []

  const firstWithPhone = hydratedLinks.find((l) => Boolean(l.phone))
  const firstWithTitle = hydratedLinks[0] ?? null

  const updateFields: Record<string, any> = {
    intakeSource:
      hydratedLinks.length > 0
        ? 'dynamic_table'
        : existing.patientId
          ? null
          : 'standalone',
    intakePatientPhone: firstWithPhone?.phone ?? existing.intakePatientPhone ?? null,
    intakePatientName: firstWithTitle?.displayTitle ?? existing.intakePatientName ?? null,
    updatedAt: new Date(),
  }

  if (opts?.syncTitle && hydratedLinks.length > 0) {
    const composed = hydratedLinks
      .map((l) => l.displayTitle)
      .filter(Boolean)
      .slice(0, 3)
      .join(' • ')
    if (composed) {
      updateFields.title = composed
    }
  }

  const [updatedAppt] = await db
    .update(dentalAppointments)
    .set(updateFields)
    .where(and(eq(dentalAppointments.id, appointmentId), eq(dentalAppointments.clinicId, clinicId)))
    .returning()

  return {
    dynamicLinks: hydratedLinks,
    appointment: updatedAppt ?? existing,
  }
}

export async function getAppointmentBookingContext() {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  const [configs, allTablesRaw] = await Promise.all([
    db
      .select()
      .from(dynamicAppointmentConfigs)
      .where(
        and(
          eq(dynamicAppointmentConfigs.clinicId, clinicId),
          eq(dynamicAppointmentConfigs.enabled, true)
        )
      ),
    db
      .select()
      .from(dynamicTables)
      .where(eq(dynamicTables.clinicId, clinicId))
      .orderBy(asc(dynamicTables.sortOrder)),
  ])

  const hasAnyDynamicTables = allTablesRaw.length > 0

  if (!hasAnyDynamicTables) {
    return {
      hasAnyDynamicTables: false,
      linkedTables: [],
      allTables: [],
      relations: [],
      rowLinks: [],
    }
  }

  const [cols, relations, rows, rowLinks, activeModConfigs] = await Promise.all([
    db
      .select()
      .from(dynamicColumns)
      .where(eq(dynamicColumns.clinicId, clinicId))
      .orderBy(asc(dynamicColumns.sortOrder)),
    db
      .select()
      .from(dynamicRelations)
      .where(eq(dynamicRelations.clinicId, clinicId)),
    db
      .select()
      .from(dynamicRows)
      .where(
        and(
          eq(dynamicRows.clinicId, clinicId),
          eq(dynamicRows.isArchived, false)
        )
      )
      .orderBy(desc(dynamicRows.createdAt)),
    db
      .select()
      .from(dynamicRowLinks)
      .where(eq(dynamicRowLinks.clinicId, clinicId)),
    db
      .select()
      .from(dynamicModuleConfigs)
      .where(
        and(
          eq(dynamicModuleConfigs.clinicId, clinicId),
          eq(dynamicModuleConfigs.enabled, true)
        )
      ),
  ])

  const cfgByTable = new Map(configs.map((c) => [c.tableId, c]))
  const moduleRoleTableIds = new Set(activeModConfigs.map((mc) => mc.tableId))
  const moduleRoleByTable = new Map(activeModConfigs.map((mc) => [mc.tableId, mc.moduleRole]))

  const allTablesHydrated = allTablesRaw.map((t) => {
    const cfg = cfgByTable.get(t.id) ?? null
    const tCols = cols.filter((c) => c.tableId === t.id)
    const phoneColId =
      cfg?.phoneColumnId || tCols.find((c) => c.fieldType === 'phone')?.id || null
    const titleColId =
      cfg?.titleColumnId ||
      tCols.find((c) => c.isPrimaryTitle)?.id ||
      tCols.find((c) => c.fieldType !== 'relation')?.id ||
      null

    const tRows = rows
      .filter((r) => r.tableId === t.id)
      .map((r) => {
        const vals = (r.values || {}) as Record<string, unknown>
        const phone =
          phoneColId && vals[phoneColId] ? String(vals[phoneColId]) : null
        const title =
          titleColId && vals[titleColId]
            ? String(vals[titleColId]).trim() || r.displayTitle
            : r.displayTitle
        return {
          id: r.id,
          tableId: r.tableId,
          displayTitle: title,
          phone,
          values: vals,
        }
      })

    return {
      table: {
        ...t,
        rowCount: tRows.length,
        archivedRowCount: 0,
        columns: tCols,
      },
      moduleRole: moduleRoleByTable.get(t.id) ?? null,
      config: cfg,
      columns: tCols,
      rows: tRows,
    }
  })

  const isPersonLikeTable = (tableName: string, tCols: typeof cols): boolean => {
    const lower = tableName.toLocaleLowerCase('tr-TR')
    if (/(özellik|malzeme|endikasyon|kategori|etiket|ürün|stok|ilan|portföy|poliçe|teklif|paket|cihaz|araç)/i.test(lower)) {
      return false
    }
    if (/(müşteri|kişi|danışan|hasta|aday|sigortalı|alıcı|kiracı|sahip|veli|üye)/i.test(lower)) {
      return true
    }
    return tCols.some((c) => c.fieldType === 'phone')
  }

  let explicitLinked = allTablesHydrated
    .filter((entry) => entry.config !== null && entry.config.enabled)
    .map((entry) => ({
      table: entry.table,
      moduleRole: entry.moduleRole,
      config: entry.config!,
      columns: entry.columns,
      rows: entry.rows,
    }))
    .sort((a, b) => Number(Boolean(a.config.allowMultiple)) - Number(Boolean(b.config.allowMultiple)))

  // Auto-synthesize smart appointment table links when dynamic tables exist
  // so newly created or AI-generated tables never vanish into empty standalone mode
  if (explicitLinked.length === 0 && allTablesHydrated.length > 0) {
    const incomingOnlyTargets = new Set<string>()
    const outgoingSources = new Set<string>()
    for (const rel of relations) {
      outgoingSources.add(rel.sourceTableId)
      if (rel.targetTableId !== rel.sourceTableId) {
        incomingOnlyTargets.add(rel.targetTableId)
      }
    }

    const isBackofficeLedgerOrStock = (tableId: string, tableName: string): boolean => {
      if (moduleRoleTableIds.has(tableId)) return true
      const lower = tableName.toLocaleLowerCase('tr-TR')
      return /(tahsilat|gider|masraf|kasa hareket|stok hareket|envanter hareket|periyodik bakım)/i.test(lower)
    }

    const appointmentEligiblePool = allTablesHydrated.filter(
      (entry) => !isBackofficeLedgerOrStock(entry.table.id, entry.table.name)
    )

    let candidateEntries = appointmentEligiblePool.filter((entry) => {
      const personLike = isPersonLikeTable(entry.table.name, entry.columns)
      if (personLike) return true
      if (outgoingSources.has(entry.table.id)) return true
      if (!incomingOnlyTargets.has(entry.table.id)) return true
      return false
    })

    if (candidateEntries.length === 0) {
      candidateEntries = appointmentEligiblePool
    }

    explicitLinked = candidateEntries
      .map((entry) => {
        const personLike = isPersonLikeTable(entry.table.name, entry.columns)
        const phoneColId = entry.columns.find((c) => c.fieldType === 'phone')?.id ?? null
        const emailColId = entry.columns.find((c) => c.fieldType === 'email')?.id ?? null
        const titleColId =
          entry.columns.find((c) => c.isPrimaryTitle)?.id ??
          entry.columns.find((c) => c.fieldType !== 'relation')?.id ??
          null
        return {
          table: entry.table,
          moduleRole: entry.moduleRole,
          config: {
            id: `auto_${entry.table.id}`,
            clinicId,
            tableId: entry.table.id,
            enabled: true,
            titleColumnId: titleColId,
            phoneColumnId: phoneColId,
            emailColumnId: emailColId,
            isRequiredInAppointment: false,
            allowMultiple: !personLike,
            includeRelatedTables: true,
            createdAt: entry.table.createdAt,
            updatedAt: entry.table.updatedAt,
          },
          columns: entry.columns,
          rows: entry.rows,
        }
      })
      .sort((a, b) => Number(Boolean(a.config.allowMultiple)) - Number(Boolean(b.config.allowMultiple)))
  }

  return {
    hasAnyDynamicTables,
    linkedTables: explicitLinked,
    allTables: allTablesHydrated.map((entry) => ({
      table: entry.table,
      moduleRole: entry.moduleRole,
      columns: entry.columns,
      rows: entry.rows,
    })),
    relations,
    rowLinks: rowLinks.map((rl) => ({
      relationId: rl.relationId,
      sourceRowId: rl.sourceRowId,
      targetRowId: rl.targetRowId,
    })),
  }
}

// ── Optional 1-Click Sector-Independent Starter Blueprints ──────────────────

function offsetDateIso(daysOffset: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysOffset)
  return d.toISOString().slice(0, 10)
}

export {
  CANONICAL_FINANCE_TABLE_DESCRIPTIONS,
  CANONICAL_FINANCE_TABLE_NAMES,
  isFinanceModuleRole,
  STANDARD_ACCOUNTING_SYNC_OPTIONS,
  STANDARD_CURRENCY_OPTIONS,
  STANDARD_DOCUMENT_TYPE_OPTIONS,
  STANDARD_EXPENSE_CATEGORY_OPTIONS,
  STANDARD_INCOME_CATEGORY_OPTIONS,
  STANDARD_PAYMENT_METHOD_OPTIONS,
  STANDARD_PAYMENT_STATUS_OPTIONS,
  STANDARD_VAT_RATE_OPTIONS,
}

export interface CanonicalFinanceColumnSpec {
  mappingKey: keyof DynamicModuleMapping | 'primaryTitle'
  column: InitialColumnInput
}

export function getCanonicalFinanceColumnSpecs(
  role: 'finance_income' | 'finance_expense'
): CanonicalFinanceColumnSpec[] {
  if (role === 'finance_income') {
    return [
      {
        mappingKey: 'primaryTitle',
        column: {
          name: 'İşlem / Tahsilat Başlığı',
          fieldType: 'text',
          isPrimaryTitle: true,
          isRequired: true,
          width: 235,
        },
      },
      {
        mappingKey: 'counterpartyNameColumnId',
        column: { name: 'Cari / Müşteri', fieldType: 'text', width: 175 },
      },
      {
        mappingKey: 'amountColumnId',
        column: { name: 'Tutar (Brüt)', fieldType: 'currency', width: 145, config: { currencySymbol: '₺' } },
      },
      {
        mappingKey: 'vatRateColumnId',
        column: { name: 'KDV Oranı', fieldType: 'select', width: 115, config: { options: STANDARD_VAT_RATE_OPTIONS } },
      },
      {
        mappingKey: 'dateColumnId',
        column: { name: 'İşlem Tarihi', fieldType: 'date', width: 135 },
      },
      {
        mappingKey: 'dueDateColumnId',
        column: { name: 'Vade Tarihi', fieldType: 'date', width: 135 },
      },
      {
        mappingKey: 'statusColumnId',
        column: {
          name: 'Tahsilat Durumu',
          fieldType: 'select',
          width: 165,
          config: { options: STANDARD_PAYMENT_STATUS_OPTIONS },
        },
      },
      {
        mappingKey: 'methodColumnId',
        column: {
          name: 'Ödeme Yöntemi',
          fieldType: 'select',
          width: 175,
          config: { options: STANDARD_PAYMENT_METHOD_OPTIONS },
        },
      },
      {
        mappingKey: 'categoryColumnId',
        column: {
          name: 'Gelir Kategorisi',
          fieldType: 'select',
          width: 185,
          config: { options: STANDARD_INCOME_CATEGORY_OPTIONS },
        },
      },
      {
        mappingKey: 'documentTypeColumnId',
        column: {
          name: 'Belge Türü',
          fieldType: 'select',
          width: 165,
          config: { options: STANDARD_DOCUMENT_TYPE_OPTIONS },
        },
      },
      {
        mappingKey: 'documentNumberColumnId',
        column: { name: 'Belge / Fatura No', fieldType: 'text', width: 155 },
      },
      {
        mappingKey: 'netAmountColumnId',
        column: {
          name: 'Net Tutar (KDV Hariç)',
          fieldType: 'currency',
          showInTable: false,
          width: 155,
          config: { currencySymbol: '₺' },
        },
      },
      {
        mappingKey: 'vatAmountColumnId',
        column: {
          name: 'KDV Tutarı',
          fieldType: 'currency',
          showInTable: false,
          width: 135,
          config: { currencySymbol: '₺' },
        },
      },
      {
        mappingKey: 'currencyColumnId',
        column: {
          name: 'Para Birimi',
          fieldType: 'select',
          showInTable: false,
          width: 115,
          config: { options: STANDARD_CURRENCY_OPTIONS },
        },
      },
      {
        mappingKey: 'exchangeRateColumnId',
        column: { name: 'Döviz Kuru', fieldType: 'number', showInTable: false, width: 115 },
      },
      {
        mappingKey: 'counterpartyTaxIdColumnId',
        column: { name: 'VKN / TCKN', fieldType: 'text', showInTable: false, width: 145 },
      },
      {
        mappingKey: 'accountingCodeColumnId',
        column: { name: 'Muhasebe Hesap Kodu', fieldType: 'text', showInTable: false, width: 155 },
      },
      {
        mappingKey: 'accountingSyncStatusColumnId',
        column: {
          name: 'Ön Muhasebe Durumu',
          fieldType: 'select',
          showInTable: false,
          width: 165,
          config: { options: STANDARD_ACCOUNTING_SYNC_OPTIONS },
        },
      },
      {
        mappingKey: 'notesColumnId',
        column: { name: 'Açıklama / Not', fieldType: 'text', width: 215 },
      },
    ]
  }

  return [
    {
      mappingKey: 'primaryTitle',
      column: {
        name: 'Gider Kalemi / Açıklama',
        fieldType: 'text',
        isPrimaryTitle: true,
        isRequired: true,
        width: 235,
      },
    },
    {
      mappingKey: 'counterpartyNameColumnId',
      column: { name: 'Tedarikçi / Cari', fieldType: 'text', width: 175 },
    },
    {
      mappingKey: 'categoryColumnId',
      column: {
        name: 'Gider Kategorisi',
        fieldType: 'select',
        width: 190,
        config: { options: STANDARD_EXPENSE_CATEGORY_OPTIONS },
      },
    },
    {
      mappingKey: 'quantityColumnId',
      column: { name: 'Adet', fieldType: 'number', width: 95 },
    },
    {
      mappingKey: 'unitCostColumnId',
      column: { name: 'Birim Tutar', fieldType: 'currency', width: 135, config: { currencySymbol: '₺' } },
    },
    {
      mappingKey: 'amountColumnId',
      column: { name: 'Toplam Tutar (Brüt)', fieldType: 'currency', width: 155, config: { currencySymbol: '₺' } },
    },
    {
      mappingKey: 'vatRateColumnId',
      column: { name: 'KDV Oranı', fieldType: 'select', width: 115, config: { options: STANDARD_VAT_RATE_OPTIONS } },
    },
    {
      mappingKey: 'dateColumnId',
      column: { name: 'İşlem Tarihi', fieldType: 'date', width: 135 },
    },
    {
      mappingKey: 'dueDateColumnId',
      column: { name: 'Vade Tarihi', fieldType: 'date', width: 135 },
    },
    {
      mappingKey: 'statusColumnId',
      column: {
        name: 'Ödeme Durumu',
        fieldType: 'select',
        width: 160,
        config: { options: STANDARD_PAYMENT_STATUS_OPTIONS },
      },
    },
    {
      mappingKey: 'methodColumnId',
      column: {
        name: 'Ödeme Yöntemi',
        fieldType: 'select',
        width: 175,
        config: { options: STANDARD_PAYMENT_METHOD_OPTIONS },
      },
    },
    {
      mappingKey: 'documentTypeColumnId',
      column: {
        name: 'Belge Türü',
        fieldType: 'select',
        width: 165,
        config: { options: STANDARD_DOCUMENT_TYPE_OPTIONS },
      },
    },
    {
      mappingKey: 'documentNumberColumnId',
      column: { name: 'Belge / Fatura No', fieldType: 'text', width: 155 },
    },
    {
      mappingKey: 'netAmountColumnId',
      column: {
        name: 'Net Tutar (KDV Hariç)',
        fieldType: 'currency',
        showInTable: false,
        width: 155,
        config: { currencySymbol: '₺' },
      },
    },
    {
      mappingKey: 'vatAmountColumnId',
      column: {
        name: 'KDV Tutarı',
        fieldType: 'currency',
        showInTable: false,
        width: 135,
        config: { currencySymbol: '₺' },
      },
    },
    {
      mappingKey: 'currencyColumnId',
      column: {
        name: 'Para Birimi',
        fieldType: 'select',
        showInTable: false,
        width: 115,
        config: { options: STANDARD_CURRENCY_OPTIONS },
      },
    },
    {
      mappingKey: 'exchangeRateColumnId',
      column: { name: 'Döviz Kuru', fieldType: 'number', showInTable: false, width: 115 },
    },
    {
      mappingKey: 'counterpartyTaxIdColumnId',
      column: { name: 'VKN / TCKN', fieldType: 'text', showInTable: false, width: 145 },
    },
    {
      mappingKey: 'accountingCodeColumnId',
      column: { name: 'Muhasebe Hesap Kodu', fieldType: 'text', showInTable: false, width: 155 },
    },
    {
      mappingKey: 'accountingSyncStatusColumnId',
      column: {
        name: 'Ön Muhasebe Durumu',
        fieldType: 'select',
        showInTable: false,
        width: 165,
        config: { options: STANDARD_ACCOUNTING_SYNC_OPTIONS },
      },
    },
    {
      mappingKey: 'notesColumnId',
      column: { name: 'Not / Detay', fieldType: 'text', width: 215 },
    },
  ]
}

function mapLegacySampleCategoryToUniversal(
  role: 'finance_income' | 'finance_expense',
  rawCategory: string
): string {
  const k = rawCategory.toLocaleLowerCase('tr-TR').trim()
  if (role === 'finance_income') {
    if (/(komisyon|prim|kasko|trafik|saglik|acente)/i.test(k)) return 'komisyon_prim'
    if (/(kapora|on_odeme|avans)/i.test(k)) return 'on_odeme_kapora'
    if (/(paket|sozlesme|abonelik)/i.test(k)) return 'abonelik_paket'
    if (/(urun|satis|mal)/i.test(k) && !/(hizmet)/i.test(k)) return 'urun_satis'
    if (/(diger)/i.test(k)) return 'diger_gelir'
    return 'hizmet_geliri'
  }
  if (/(stok|malzeme|urun|hammadde)/i.test(k)) return 'stok_malzeme'
  if (/(bakim|onarim|servis)/i.test(k)) return 'bakim_onarim'
  if (/(kira|aidat|fatura|ofis_kira|sabit)/i.test(k)) return 'kira_fatura'
  if (/(pazarlama|ilan|reklam|afis|portal)/i.test(k)) return 'pazarlama'
  if (/(yazilim|lisans|abonelik)/i.test(k)) return 'yazilim_abonelik'
  if (/(kargo|lojistik|ulasim)/i.test(k)) return 'lojistik_ulasim'
  if (/(personel|maas|sgk)/i.test(k)) return 'personel'
  if (/(vergi|resmi|harc)/i.test(k)) return 'vergi_resmi'
  if (/(iade|mahsup)/i.test(k)) return 'iade_mahsup'
  return 'diger_gider'
}

export const STANDARD_MAINTENANCE_STATUS_OPTIONS: SelectOptionItem[] = [
  { id: 'planlandi', label: 'Planlandı', color: '#0284c7' },
  { id: 'tamamlandi', label: 'Tamamlandı', color: '#15803d' },
  { id: 'gecikti', label: 'Gecikti', color: '#ef4444' },
]

export const STANDARD_MOVEMENT_TYPE_OPTIONS: SelectOptionItem[] = [
  { id: 'giris', label: 'Giriş / Alım', color: '#15803d' },
  { id: 'cikis', label: 'Kullanım / Çıkış', color: '#0284c7' },
  { id: 'fire', label: 'Zayi / Fire', color: '#d97706' },
  { id: 'imha', label: 'Süresi Doldu', color: '#ef4444' },
  { id: 'iade', label: 'Tedarikçi İadesi', color: '#2563eb' },
  { id: 'bakim', label: 'Periyodik Bakım', color: '#0d9488' },
]

export interface SectorFinanceStockSeedSpec {
  includeFinance?: boolean
  includeStock?: boolean
  canvasStartX?: number
  canvasStartY?: number
  personTable?: {
    id: string
    sampleRowIds?: string[]
    relationLabel: string
    inverseLabel: string
  }
  serviceTable?: {
    id: string
    sampleRowIds?: string[]
    relationLabel: string
    inverseLabel: string
  }
  existingInventoryTable?: {
    id: string
    sampleRowIds?: string[]
  }
  income?: {
    tableName: string
    categories: SelectOptionItem[]
    samples: Array<{
      title: string
      amount: number
      status: 'tamamlandi' | 'bekliyor'
      method: string
      category: string
      daysOffset: number
      dueDaysOffset?: number
      personIdx?: number
      serviceIdx?: number
      notes?: string
    }>
  }
  expense?: {
    tableName: string
    categories: SelectOptionItem[]
    samples: Array<{
      title: string
      category: string
      qty: number
      unitCost: number
      daysOffset: number
      notes?: string
    }>
  }
  inventory?: {
    tableName: string
    categories: SelectOptionItem[]
    units?: SelectOptionItem[]
    samples: Array<{
      name: string
      category: string
      unit: string
      qty: number
      minThreshold: number
      unitCost: number
      expiryDaysOffset?: number
      notes?: string
    }>
  }
  maintenance?: {
    tableName: string
    types: SelectOptionItem[]
    samples: Array<{
      name: string
      type: string
      isPeriodic: boolean
      periodicDays: number
      scheduledDaysOffset: number
      nextDaysOffset?: number
      cost?: number
      status: 'planlandi' | 'tamamlandi'
      notes?: string
    }>
  }
  movementTableName?: string
}

export async function seedSectorFinanceAndStockTables(spec: SectorFinanceStockSeedSpec) {
  const includeFinance = spec.includeFinance !== false
  const includeStock = spec.includeStock !== false
  const baseX = spec.canvasStartX ?? 1160
  const baseY = spec.canvasStartY ?? 50

  let inventoryTableId: string | null = spec.existingInventoryTable?.id ?? null
  const inventorySampleIds: string[] = [...(spec.existingInventoryTable?.sampleRowIds ?? [])]

  // 1) Stock Inventory Table (if requested and not already provided)
  if (includeStock && !inventoryTableId && spec.inventory) {
    const unitOptions: SelectOptionItem[] = spec.inventory.units ?? [
      { id: 'adet', label: 'Adet', color: '#0284c7' },
      { id: 'paket', label: 'Paket', color: '#2563eb' },
      { id: 'kutu', label: 'Kutu', color: '#0d9488' },
      { id: 'set', label: 'Set', color: '#15803d' },
    ]
    const inv = await createDynamicTable({
      name: spec.inventory.tableName,
      icon: 'box',
      color: '#0d9488',
      origin: 'template',
      canvasX: baseX,
      canvasY: baseY + 560,
      initialColumns: [
        { name: 'Kalem / Ürün Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 220 },
        { name: 'Kategori', fieldType: 'select', width: 165, config: { options: spec.inventory.categories } },
        { name: 'Birim', fieldType: 'select', width: 115, config: { options: unitOptions } },
        { name: 'Mevcut Stok', fieldType: 'number', width: 130 },
        { name: 'Kritik Eşik', fieldType: 'number', width: 125 },
        { name: 'Birim Maliyet (₺)', fieldType: 'currency', width: 150, config: { currencySymbol: '₺' } },
        { name: 'Son Kullanma / Kontrol Tarihi', fieldType: 'date', width: 175 },
        { name: 'Tedarikçi / Açıklama', fieldType: 'text', width: 220 },
      ],
    })
    inventoryTableId = inv.id
    const cName = inv.columns[0]?.id
    const cCat = inv.columns[1]?.id
    const cUnit = inv.columns[2]?.id
    const cQty = inv.columns[3]?.id
    const cMin = inv.columns[4]?.id
    const cCost = inv.columns[5]?.id
    const cExp = inv.columns[6]?.id
    const cNote = inv.columns[7]?.id

    await upsertModuleConfig({
      tableId: inv.id,
      moduleRole: 'stock_inventory',
      enabled: true,
      mapping: {
        categoryColumnId: cCat ?? null,
        unitColumnId: cUnit ?? null,
        quantityColumnId: cQty ?? null,
        minThresholdColumnId: cMin ?? null,
        unitCostColumnId: cCost ?? null,
        expiryDateColumnId: cExp ?? null,
        notesColumnId: cNote ?? null,
      },
    })

    if (cName) {
      for (const s of spec.inventory.samples) {
        const created = await createDynamicRow(inv.id, {
          values: {
            [cName]: s.name,
            ...(cCat ? { [cCat]: s.category } : {}),
            ...(cUnit ? { [cUnit]: s.unit } : {}),
            ...(cQty ? { [cQty]: s.qty } : {}),
            ...(cMin ? { [cMin]: s.minThreshold } : {}),
            ...(cCost ? { [cCost]: s.unitCost } : {}),
            ...(cExp && s.expiryDaysOffset !== undefined ? { [cExp]: offsetDateIso(s.expiryDaysOffset) } : {}),
            ...(cNote && s.notes ? { [cNote]: s.notes } : {}),
          },
        })
        inventorySampleIds.push(created.id)
      }
    }
  }

  // 2) Asset / Device Periodic Maintenance Table
  if (includeStock && spec.maintenance) {
    const maint = await createDynamicTable({
      name: spec.maintenance.tableName,
      icon: 'wrench',
      color: '#0369a1',
      origin: 'template',
      canvasX: baseX + 430,
      canvasY: baseY + 560,
      initialColumns: [
        { name: 'Cihaz / Demirbaş Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 225 },
        { name: 'Bakım Tipi', fieldType: 'select', width: 175, config: { options: spec.maintenance.types } },
        { name: 'Periyodik Takip', fieldType: 'boolean', width: 135 },
        { name: 'Periyot (Gün)', fieldType: 'number', width: 125 },
        { name: 'Planlanan Tarih', fieldType: 'date', width: 150 },
        { name: 'Sonraki Bakım Tarihi', fieldType: 'date', width: 165 },
        { name: 'Bakım Ücreti (₺)', fieldType: 'currency', width: 150, config: { currencySymbol: '₺' } },
        { name: 'Durum', fieldType: 'select', width: 145, config: { options: STANDARD_MAINTENANCE_STATUS_OPTIONS } },
        { name: 'Servis Firması / Not', fieldType: 'text', width: 230 },
      ],
    })
    const mName = maint.columns[0]?.id
    const mType = maint.columns[1]?.id
    const mPer = maint.columns[2]?.id
    const mDays = maint.columns[3]?.id
    const mSched = maint.columns[4]?.id
    const mNext = maint.columns[5]?.id
    const mCost = maint.columns[6]?.id
    const mStatus = maint.columns[7]?.id
    const mNote = maint.columns[8]?.id

    await upsertModuleConfig({
      tableId: maint.id,
      moduleRole: 'asset_maintenance',
      enabled: true,
      mapping: {
        categoryColumnId: mType ?? null,
        isPeriodicColumnId: mPer ?? null,
        periodicDaysColumnId: mDays ?? null,
        scheduledDateColumnId: mSched ?? null,
        nextDateColumnId: mNext ?? null,
        amountColumnId: mCost ?? null,
        statusColumnId: mStatus ?? null,
        notesColumnId: mNote ?? null,
      },
    })

    if (mName) {
      for (const s of spec.maintenance.samples) {
        await createDynamicRow(maint.id, {
          values: {
            [mName]: s.name,
            ...(mType ? { [mType]: s.type } : {}),
            ...(mPer ? { [mPer]: s.isPeriodic } : {}),
            ...(mDays ? { [mDays]: s.periodicDays } : {}),
            ...(mSched ? { [mSched]: offsetDateIso(s.scheduledDaysOffset) } : {}),
            ...(mNext && s.nextDaysOffset !== undefined ? { [mNext]: offsetDateIso(s.nextDaysOffset) } : {}),
            ...(mCost && s.cost !== undefined ? { [mCost]: s.cost } : {}),
            ...(mStatus ? { [mStatus]: s.status } : {}),
            ...(mNote && s.notes ? { [mNote]: s.notes } : {}),
          },
        })
      }
    }
  }

  // 3) Stock & Maintenance Movements Log Table
  if (includeStock) {
    const mov = await createDynamicTable({
      name: spec.movementTableName || 'Stok & Bakım Hareketleri',
      icon: 'activity',
      color: '#1d4ed8',
      origin: 'template',
      canvasX: baseX + 210,
      canvasY: baseY + 900,
      initialColumns: [
        { name: 'Hareket Özeti', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 240 },
        { name: 'İşlem Türü', fieldType: 'select', width: 165, config: { options: STANDARD_MOVEMENT_TYPE_OPTIONS } },
        { name: 'Adet', fieldType: 'number', width: 110 },
        { name: 'Birim Tutar (₺)', fieldType: 'currency', width: 145, config: { currencySymbol: '₺' } },
        { name: 'Toplam Tutar (₺)', fieldType: 'currency', width: 155, config: { currencySymbol: '₺' } },
        { name: 'Tarih', fieldType: 'date', width: 145 },
        { name: 'İşlemi Yapan', fieldType: 'text', width: 165 },
        { name: 'Açıklama', fieldType: 'text', width: 220 },
      ],
    })

    let relMovItemColId: string | null = null
    if (inventoryTableId) {
      const relMov = await createDynamicRelation({
        sourceTableId: mov.id,
        targetTableId: inventoryTableId,
        sourceColumnName: 'İlgili Stok Kalemi',
        inverseColumnName: 'Stok Hareketleri',
        createInverseColumn: true,
        cardinality: 'many_to_many',
      })
      relMovItemColId = relMov?.sourceColumnId ?? null
    }

    await upsertModuleConfig({
      tableId: mov.id,
      moduleRole: 'stock_movement',
      enabled: true,
      mapping: {
        movementTypeColumnId: mov.columns[1]?.id ?? null,
        quantityColumnId: mov.columns[2]?.id ?? null,
        unitCostColumnId: mov.columns[3]?.id ?? null,
        amountColumnId: mov.columns[4]?.id ?? null,
        dateColumnId: mov.columns[5]?.id ?? null,
        actorColumnId: mov.columns[6]?.id ?? null,
        notesColumnId: mov.columns[7]?.id ?? null,
        itemRelationColumnId: relMovItemColId,
      },
    })

    const mvTitle = mov.columns[0]?.id
    if (mvTitle && inventorySampleIds[0]) {
      await createDynamicRow(mov.id, {
        values: {
          [mvTitle]: 'Başlangıç Stok Girişi',
          ...(mov.columns[1]?.id ? { [mov.columns[1].id]: 'giris' } : {}),
          ...(mov.columns[2]?.id ? { [mov.columns[2].id]: 10 } : {}),
          ...(mov.columns[3]?.id ? { [mov.columns[3].id]: 250 } : {}),
          ...(mov.columns[4]?.id ? { [mov.columns[4].id]: 2500 } : {}),
          ...(mov.columns[5]?.id ? { [mov.columns[5].id]: offsetDateIso(-3) } : {}),
          ...(mov.columns[6]?.id ? { [mov.columns[6].id]: 'Sistem Kurulumu' } : {}),
          ...(mov.columns[7]?.id ? { [mov.columns[7].id]: 'İlk envanter açılış kaydı' } : {}),
        },
        relations: relMovItemColId ? { [relMovItemColId]: [inventorySampleIds[0]] } : {},
      })
    }
  }

  // 4) Finance Income / Collections Table (Canonical, Universal, Pre-Accounting Ready)
  if (includeFinance && spec.income) {
    const clinicId = requireClinicId()
    const existingIncCfg = await db
      .select()
      .from(dynamicModuleConfigs)
      .where(
        and(
          eq(dynamicModuleConfigs.clinicId, clinicId),
          eq(dynamicModuleConfigs.moduleRole, 'finance_income'),
          eq(dynamicModuleConfigs.enabled, true)
        )
      )
      .limit(1)

    let incTableId: string
    let incColsByKey: Partial<Record<keyof DynamicModuleMapping | 'primaryTitle', string>> = {}
    let personRelColId: string | null = null
    let serviceRelColId: string | null = null

    if (existingIncCfg[0]) {
      incTableId = existingIncCfg[0].tableId
      const existingCols = await db
        .select()
        .from(dynamicColumns)
        .where(and(eq(dynamicColumns.clinicId, clinicId), eq(dynamicColumns.tableId, incTableId)))
      const validColIds = new Set(existingCols.map((c) => c.id))
      const inferred = inferModuleMappingForTable('finance_income', existingCols)
      const mergedMap: DynamicModuleMapping = mergeFinanceMappingPreservingCore(
        inferred,
        (existingIncCfg[0].mapping ?? {}) as Record<string, unknown>,
        validColIds
      )
      const specs = getCanonicalFinanceColumnSpecs('finance_income')
      let mappingTouched = false
      for (const sp of specs) {
        if (sp.mappingKey === 'primaryTitle') continue
        if (mergedMap[sp.mappingKey]) continue
        const byName = existingCols.find(
          (c) => c.name.toLocaleLowerCase('tr-TR') === sp.column.name.toLocaleLowerCase('tr-TR')
        )
        if (byName) {
          ;(mergedMap as Record<string, string | null>)[sp.mappingKey] = byName.id
          mappingTouched = true
          continue
        }
        const createdCol = await createDynamicColumn(incTableId, {
          name: sp.column.name,
          fieldType: sp.column.fieldType,
          isPrimaryTitle: false,
          isRequired: false,
          showInTable: sp.column.showInTable ?? false,
          width: sp.column.width,
          config: sp.column.config,
        })
        if (createdCol?.id) {
          ;(mergedMap as Record<string, string | null>)[sp.mappingKey] = createdCol.id
          mappingTouched = true
        }
      }
      if (!mergedMap.personRelationColumnId && spec.personTable) {
        const relP = await createDynamicRelation({
          sourceTableId: incTableId,
          targetTableId: spec.personTable.id,
          sourceColumnName: spec.personTable.relationLabel,
          inverseColumnName: spec.personTable.inverseLabel,
          createInverseColumn: true,
          cardinality: 'many_to_many',
        })
        if (relP?.sourceColumnId) {
          mergedMap.personRelationColumnId = relP.sourceColumnId
          mappingTouched = true
        }
      }
      if (!mergedMap.serviceRelationColumnId && spec.serviceTable) {
        const relS = await createDynamicRelation({
          sourceTableId: incTableId,
          targetTableId: spec.serviceTable.id,
          sourceColumnName: spec.serviceTable.relationLabel,
          inverseColumnName: spec.serviceTable.inverseLabel,
          createInverseColumn: true,
          cardinality: 'many_to_many',
        })
        if (relS?.sourceColumnId) {
          mergedMap.serviceRelationColumnId = relS.sourceColumnId
          mappingTouched = true
        }
      }
      if (mappingTouched) {
        await upsertModuleConfig({
          tableId: incTableId,
          moduleRole: 'finance_income',
          enabled: true,
          mapping: mergedMap,
          allowSystemFinanceBinding: true,
        })
      }
      incColsByKey = {
        primaryTitle: existingCols.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation')?.id,
        ...mergedMap,
      } as Partial<Record<keyof DynamicModuleMapping | 'primaryTitle', string>>
      personRelColId = mergedMap.personRelationColumnId ?? null
      serviceRelColId = mergedMap.serviceRelationColumnId ?? null
    } else {
      const specs = getCanonicalFinanceColumnSpecs('finance_income')
      const inc = await createDynamicTable({
        name: CANONICAL_FINANCE_TABLE_NAMES.finance_income,
        description: CANONICAL_FINANCE_TABLE_DESCRIPTIONS.finance_income,
        icon: 'credit-card',
        color: '#15803d',
        origin: 'system',
        canvasX: baseX,
        canvasY: baseY,
        initialColumns: specs.map((sp) => sp.column),
      })
      incTableId = inc.id
      specs.forEach((sp, i) => {
        const colId = inc.columns[i]?.id
        if (colId) incColsByKey[sp.mappingKey] = colId
      })

      if (spec.personTable) {
        const relP = await createDynamicRelation({
          sourceTableId: inc.id,
          targetTableId: spec.personTable.id,
          sourceColumnName: spec.personTable.relationLabel,
          inverseColumnName: spec.personTable.inverseLabel,
          createInverseColumn: true,
          cardinality: 'many_to_many',
        })
        personRelColId = relP?.sourceColumnId ?? null
      }

      if (spec.serviceTable) {
        const relS = await createDynamicRelation({
          sourceTableId: inc.id,
          targetTableId: spec.serviceTable.id,
          sourceColumnName: spec.serviceTable.relationLabel,
          inverseColumnName: spec.serviceTable.inverseLabel,
          createInverseColumn: true,
          cardinality: 'many_to_many',
        })
        serviceRelColId = relS?.sourceColumnId ?? null
      }

      const mappingPayload: DynamicModuleMapping = {
        personRelationColumnId: personRelColId,
        serviceRelationColumnId: serviceRelColId,
      }
      for (const sp of specs) {
        if (sp.mappingKey !== 'primaryTitle' && incColsByKey[sp.mappingKey]) {
          ;(mappingPayload as Record<string, string | null>)[sp.mappingKey] =
            incColsByKey[sp.mappingKey] ?? null
        }
      }

      await upsertModuleConfig({
        tableId: inc.id,
        moduleRole: 'finance_income',
        enabled: true,
        mapping: mappingPayload,
        allowSystemFinanceBinding: true,
      })
    }

    const iTitle = incColsByKey.primaryTitle
    if (iTitle) {
      for (const s of spec.income.samples) {
        const relPayload: Record<string, string[]> = {}
        const pRowId =
          s.personIdx !== undefined ? spec.personTable?.sampleRowIds?.[s.personIdx] : undefined
        const sRowId =
          s.serviceIdx !== undefined ? spec.serviceTable?.sampleRowIds?.[s.serviceIdx] : undefined
        if (personRelColId && pRowId) relPayload[personRelColId] = [pRowId]
        if (serviceRelColId && sRowId) relPayload[serviceRelColId] = [sRowId]

        const universalCat = mapLegacySampleCategoryToUniversal('finance_income', s.category)
        await createDynamicRow(incTableId, {
          values: {
            [iTitle]: s.title,
            ...(incColsByKey.amountColumnId ? { [incColsByKey.amountColumnId]: s.amount } : {}),
            ...(incColsByKey.vatRateColumnId ? { [incColsByKey.vatRateColumnId]: '20' } : {}),
            ...(incColsByKey.dateColumnId ? { [incColsByKey.dateColumnId]: offsetDateIso(s.daysOffset) } : {}),
            ...(incColsByKey.dueDateColumnId && s.dueDaysOffset !== undefined
              ? { [incColsByKey.dueDateColumnId]: offsetDateIso(s.dueDaysOffset) }
              : {}),
            ...(incColsByKey.statusColumnId ? { [incColsByKey.statusColumnId]: s.status } : {}),
            ...(incColsByKey.methodColumnId ? { [incColsByKey.methodColumnId]: s.method } : {}),
            ...(incColsByKey.categoryColumnId ? { [incColsByKey.categoryColumnId]: universalCat } : {}),
            ...(incColsByKey.currencyColumnId ? { [incColsByKey.currencyColumnId]: 'TRY' } : {}),
            ...(incColsByKey.exchangeRateColumnId ? { [incColsByKey.exchangeRateColumnId]: 1 } : {}),
            ...(incColsByKey.documentTypeColumnId ? { [incColsByKey.documentTypeColumnId]: 'earsiv' } : {}),
            ...(incColsByKey.notesColumnId && s.notes ? { [incColsByKey.notesColumnId]: s.notes } : {}),
          },
          relations: relPayload,
        })
      }
    }
  }

  // 5) Finance Expense Table (Canonical, Universal, Pre-Accounting Ready)
  if (includeFinance && spec.expense) {
    const clinicId = requireClinicId()
    const existingExpCfg = await db
      .select()
      .from(dynamicModuleConfigs)
      .where(
        and(
          eq(dynamicModuleConfigs.clinicId, clinicId),
          eq(dynamicModuleConfigs.moduleRole, 'finance_expense'),
          eq(dynamicModuleConfigs.enabled, true)
        )
      )
      .limit(1)

    let expTableId: string
    let expColsByKey: Partial<Record<keyof DynamicModuleMapping | 'primaryTitle', string>> = {}
    let expItemRelColId: string | null = null

    if (existingExpCfg[0]) {
      expTableId = existingExpCfg[0].tableId
      const existingCols = await db
        .select()
        .from(dynamicColumns)
        .where(and(eq(dynamicColumns.clinicId, clinicId), eq(dynamicColumns.tableId, expTableId)))
      const validColIds = new Set(existingCols.map((c) => c.id))
      const inferred = inferModuleMappingForTable('finance_expense', existingCols)
      const mergedMap: DynamicModuleMapping = mergeFinanceMappingPreservingCore(
        inferred,
        (existingExpCfg[0].mapping ?? {}) as Record<string, unknown>,
        validColIds
      )
      const specs = getCanonicalFinanceColumnSpecs('finance_expense')
      let mappingTouched = false
      for (const sp of specs) {
        if (sp.mappingKey === 'primaryTitle') continue
        if (mergedMap[sp.mappingKey]) continue
        const byName = existingCols.find(
          (c) => c.name.toLocaleLowerCase('tr-TR') === sp.column.name.toLocaleLowerCase('tr-TR')
        )
        if (byName) {
          ;(mergedMap as Record<string, string | null>)[sp.mappingKey] = byName.id
          mappingTouched = true
          continue
        }
        const createdCol = await createDynamicColumn(expTableId, {
          name: sp.column.name,
          fieldType: sp.column.fieldType,
          isPrimaryTitle: false,
          isRequired: false,
          showInTable: sp.column.showInTable ?? false,
          width: sp.column.width,
          config: sp.column.config,
        })
        if (createdCol?.id) {
          ;(mergedMap as Record<string, string | null>)[sp.mappingKey] = createdCol.id
          mappingTouched = true
        }
      }
      if (!mergedMap.itemRelationColumnId && inventoryTableId) {
        const relExpItem = await createDynamicRelation({
          sourceTableId: expTableId,
          targetTableId: inventoryTableId,
          sourceColumnName: 'İlgili Stok / Envanter',
          inverseColumnName: 'Alım & Gider Kayıtları',
          createInverseColumn: true,
          cardinality: 'many_to_many',
        })
        if (relExpItem?.sourceColumnId) {
          mergedMap.itemRelationColumnId = relExpItem.sourceColumnId
          mappingTouched = true
        }
      }
      if (mappingTouched) {
        await upsertModuleConfig({
          tableId: expTableId,
          moduleRole: 'finance_expense',
          enabled: true,
          mapping: mergedMap,
          allowSystemFinanceBinding: true,
        })
      }
      expColsByKey = {
        primaryTitle: existingCols.find((c) => c.isPrimaryTitle && c.fieldType !== 'relation')?.id,
        ...mergedMap,
      } as Partial<Record<keyof DynamicModuleMapping | 'primaryTitle', string>>
      expItemRelColId = mergedMap.itemRelationColumnId ?? null
    } else {
      const specs = getCanonicalFinanceColumnSpecs('finance_expense')
      const exp = await createDynamicTable({
        name: CANONICAL_FINANCE_TABLE_NAMES.finance_expense,
        description: CANONICAL_FINANCE_TABLE_DESCRIPTIONS.finance_expense,
        icon: 'trending-down',
        color: '#2563eb',
        origin: 'system',
        canvasX: baseX + 430,
        canvasY: baseY,
        initialColumns: specs.map((sp) => sp.column),
      })
      expTableId = exp.id
      specs.forEach((sp, i) => {
        const colId = exp.columns[i]?.id
        if (colId) expColsByKey[sp.mappingKey] = colId
      })

      if (inventoryTableId) {
        const relExpItem = await createDynamicRelation({
          sourceTableId: exp.id,
          targetTableId: inventoryTableId,
          sourceColumnName: 'İlgili Stok / Envanter',
          inverseColumnName: 'Alım & Gider Kayıtları',
          createInverseColumn: true,
          cardinality: 'many_to_many',
        })
        expItemRelColId = relExpItem?.sourceColumnId ?? null
      }

      const mappingPayload: DynamicModuleMapping = {
        itemRelationColumnId: expItemRelColId,
      }
      for (const sp of specs) {
        if (sp.mappingKey !== 'primaryTitle' && expColsByKey[sp.mappingKey]) {
          ;(mappingPayload as Record<string, string | null>)[sp.mappingKey] =
            expColsByKey[sp.mappingKey] ?? null
        }
      }

      await upsertModuleConfig({
        tableId: exp.id,
        moduleRole: 'finance_expense',
        enabled: true,
        mapping: mappingPayload,
        allowSystemFinanceBinding: true,
      })
    }

    const eTitle = expColsByKey.primaryTitle
    if (eTitle) {
      for (const s of spec.expense.samples) {
        const universalCat = mapLegacySampleCategoryToUniversal('finance_expense', s.category)
        await createDynamicRow(expTableId, {
          values: {
            [eTitle]: s.title,
            ...(expColsByKey.categoryColumnId ? { [expColsByKey.categoryColumnId]: universalCat } : {}),
            ...(expColsByKey.quantityColumnId ? { [expColsByKey.quantityColumnId]: s.qty } : {}),
            ...(expColsByKey.unitCostColumnId ? { [expColsByKey.unitCostColumnId]: s.unitCost } : {}),
            ...(expColsByKey.amountColumnId ? { [expColsByKey.amountColumnId]: s.qty * s.unitCost } : {}),
            ...(expColsByKey.vatRateColumnId ? { [expColsByKey.vatRateColumnId]: '20' } : {}),
            ...(expColsByKey.dateColumnId ? { [expColsByKey.dateColumnId]: offsetDateIso(s.daysOffset) } : {}),
            ...(expColsByKey.statusColumnId ? { [expColsByKey.statusColumnId]: 'tamamlandi' } : {}),
            ...(expColsByKey.methodColumnId ? { [expColsByKey.methodColumnId]: 'havale_eft' } : {}),
            ...(expColsByKey.currencyColumnId ? { [expColsByKey.currencyColumnId]: 'TRY' } : {}),
            ...(expColsByKey.exchangeRateColumnId ? { [expColsByKey.exchangeRateColumnId]: 1 } : {}),
            ...(expColsByKey.documentTypeColumnId ? { [expColsByKey.documentTypeColumnId]: 'efatura' } : {}),
            ...(expColsByKey.notesColumnId && s.notes ? { [expColsByKey.notesColumnId]: s.notes } : {}),
          },
        })
      }
    }
  }
}

export type StarterBlueprintKey =
  | 'real_estate_appointment'
  | 'insurance_quote'
  | 'dental_clinic'
  | 'customer_service'
  | 'consultant_sessions'
  | 'vehicle_service'

async function applyStarterBlueprintInternal(blueprint: StarterBlueprintKey) {
  await ensureDynamicTablesSchema()
  const clinicId = requireClinicId()

  // Yeni bir sektör şablonu seçildiğinde önceki şablondan kalan tabloları (örn. Hastalar, Tedaviler vb.) temizle ki sektörler birbirine karışmasın
  await db.delete(dynamicTables).where(eq(dynamicTables.clinicId, clinicId))

  if (blueprint !== 'dental_clinic') {
    const existingLabel = await getSetting(TAB_LABEL_SETTING_KEY).catch(() => null)
    if (existingLabel && existingLabel.toLocaleLowerCase('tr-TR').includes('hasta')) {
      await setSetting(TAB_LABEL_SETTING_KEY, 'Veri Tabloları')
    }
  }

  if (blueprint === 'real_estate_appointment') {
    const prospects = await createDynamicTable({
      name: 'Alıcı & Kiracı Adayları',
      icon: 'users',
      color: '#0284c7',
      canvasX: 430,
      canvasY: 50,
      initialColumns: [
        { name: 'Ad Soyad', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 210 },
        { name: 'Telefon', fieldType: 'phone', width: 170 },
        {
          name: 'Arayış Tipi',
          fieldType: 'select',
          width: 150,
          config: {
            options: [
              { id: 'satilik', label: 'Satılık', color: '#2563eb' },
              { id: 'kiralik', label: 'Kiralık', color: '#0284c7' },
              { id: 'yatirimlik', label: 'Yatırımlık', color: '#15803d' },
            ],
          },
        },
        { name: 'Bütçe', fieldType: 'currency', width: 150 },
      ],
    })

    const listings = await createDynamicTable({
      name: 'Portföy İlanları',
      icon: 'layers',
      color: '#2563eb',
      canvasX: 430,
      canvasY: 360,
      initialColumns: [
        { name: 'İlan Başlığı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 240 },
        { name: 'Bölge / Mahalle', fieldType: 'text', width: 170 },
        { name: 'Fiyat', fieldType: 'currency', width: 150 },
        {
          name: 'Oda Planı',
          fieldType: 'select',
          width: 130,
          config: {
            options: [
              { id: '2_1', label: '2+1', color: '#0284c7' },
              { id: '3_1', label: '3+1', color: '#2563eb' },
              { id: 'villa', label: 'Villa / Müstakil', color: '#15803d' },
              { id: 'ticari', label: 'Ticari / Ofis', color: '#0369a1' },
            ],
          },
        },
        { name: 'İlan Linki', fieldType: 'text', width: 260 },
      ],
    })

    const owners = await createDynamicTable({
      name: 'Mülk Sahipleri',
      icon: 'user-check',
      color: '#15803d',
      canvasX: 50,
      canvasY: 220,
      initialColumns: [
        { name: 'Mülk Sahibi', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 200 },
        { name: 'Telefon', fieldType: 'phone', width: 170 },
      ],
    })

    const features = await createDynamicTable({
      name: 'Gayrimenkul Özellikleri',
      icon: 'tag',
      color: '#0369a1',
      canvasX: 50,
      canvasY: 480,
      initialColumns: [
        { name: 'Özellik / Detay', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 210 },
      ],
    })

    const relOwner = await createDynamicRelation({
      sourceTableId: listings.id,
      targetTableId: owners.id,
      sourceColumnName: 'Mülk Sahibi',
      inverseColumnName: 'Portföydeki Mülkleri',
      createInverseColumn: true,
      cardinality: 'many_to_many',
    })

    const relFeatures = await createDynamicRelation({
      sourceTableId: listings.id,
      targetTableId: features.id,
      sourceColumnName: 'Özellikler',
      inverseColumnName: 'İlgili İlanlar',
      createInverseColumn: true,
      cardinality: 'many_to_many',
    })

    await upsertAppointmentConfig({
      tableId: prospects.id,
      enabled: true,
      allowMultiple: false,
      includeRelatedTables: true,
      isRequiredInAppointment: true,
    })
    await upsertAppointmentConfig({
      tableId: listings.id,
      enabled: true,
      allowMultiple: true,
      includeRelatedTables: true,
      isRequiredInAppointment: false,
    })

    await updateStudioSettings({ appointmentNodePosition: { x: 830, y: 120 } })

    const prName = prospects.columns[0]?.id
    const prPhone = prospects.columns[1]?.id
    const prType = prospects.columns[2]?.id
    const prBudget = prospects.columns[3]?.id
    const prospectSampleIds: string[] = []
    if (prName) {
      const pr1 = await createDynamicRow(prospects.id, {
        values: {
          [prName]: 'Caner Yıldız',
          ...(prPhone ? { [prPhone]: '0532 610 44 12' } : {}),
          ...(prType ? { [prType]: 'satilik' } : {}),
          ...(prBudget ? { [prBudget]: 6500000 } : {}),
        },
      })
      const pr2 = await createDynamicRow(prospects.id, {
        values: {
          [prName]: 'Zeynep Arslan',
          ...(prPhone ? { [prPhone]: '0543 219 88 45' } : {}),
          ...(prType ? { [prType]: 'kiralik' } : {}),
          ...(prBudget ? { [prBudget]: 45000 } : {}),
        },
      })
      prospectSampleIds.push(pr1.id, pr2.id)
    }

    const owName = owners.columns[0]?.id
    const owPhone = owners.columns[1]?.id
    let owner1Id: string | null = null
    if (owName) {
      const o1 = await createDynamicRow(owners.id, {
        values: {
          [owName]: 'Hakan Özdemir',
          ...(owPhone ? { [owPhone]: '0533 701 11 22' } : {}),
        },
      })
      await createDynamicRow(owners.id, {
        values: {
          [owName]: 'Selin Karaca',
          ...(owPhone ? { [owPhone]: '0535 904 33 10' } : {}),
        },
      })
      owner1Id = o1.id
    }

    const ftName = features.columns[0]?.id
    let ft1Id: string | null = null
    let ft2Id: string | null = null
    if (ftName) {
      const f1 = await createDynamicRow(features.id, { values: { [ftName]: 'Kapalı Otopark' } })
      const f2 = await createDynamicRow(features.id, { values: { [ftName]: 'Krediye Uygun' } })
      await createDynamicRow(features.id, { values: { [ftName]: 'Ebeveyn Banyolu' } })
      ft1Id = f1.id
      ft2Id = f2.id
    }

    const lsTitle = listings.columns[0]?.id
    const lsArea = listings.columns[1]?.id
    const lsPrice = listings.columns[2]?.id
    const lsRooms = listings.columns[3]?.id
    const lsLink = listings.columns[4]?.id
    const listingSampleIds: string[] = []
    if (lsTitle) {
      const relPayload: Record<string, string[]> = {}
      if (relOwner?.sourceColumnId && owner1Id) {
        relPayload[relOwner.sourceColumnId] = [owner1Id]
      }
      if (relFeatures?.sourceColumnId && ft1Id && ft2Id) {
        relPayload[relFeatures.sourceColumnId] = [ft1Id, ft2Id]
      }
      const ls1 = await createDynamicRow(listings.id, {
        values: {
          [lsTitle]: 'Moda 3+1 Deniz Manzaralı Daire',
          ...(lsArea ? { [lsArea]: 'Kadıköy / Moda' } : {}),
          ...(lsPrice ? { [lsPrice]: 7250000 } : {}),
          ...(lsRooms ? { [lsRooms]: '3_1' } : {}),
          ...(lsLink
            ? {
                [lsLink]:
                  'https://www.sahibinden.com/ilan/emlak-konut-satilik-moda-deniz-manzarali-3-1-daire-123456789/detay',
              }
            : {}),
        },
        relations: relPayload,
      })
      const ls2 = await createDynamicRow(listings.id, {
        values: {
          [lsTitle]: 'Ataşehir Rezidans 2+1 Kiralık',
          ...(lsArea ? { [lsArea]: 'Ataşehir' } : {}),
          ...(lsPrice ? { [lsPrice]: 42000 } : {}),
          ...(lsRooms ? { [lsRooms]: '2_1' } : {}),
          ...(lsLink
            ? {
                [lsLink]:
                  'https://www.sahibinden.com/ilan/emlak-konut-kiralik-atasehir-rezidans-2-1-daire-987654321/detay',
              }
            : {}),
        },
      })
      listingSampleIds.push(ls1.id, ls2.id)
    }

    await seedSectorFinanceAndStockTables({
      canvasStartX: 1180,
      personTable: {
        id: prospects.id,
        sampleRowIds: prospectSampleIds,
        relationLabel: 'Alıcı / Kiracı',
        inverseLabel: 'Komisyon & Tahsilatlar',
      },
      serviceTable: {
        id: listings.id,
        sampleRowIds: listingSampleIds,
        relationLabel: 'İlgili Portföy İlanı',
        inverseLabel: 'Tahsilat Kayıtları',
      },
      income: {
        tableName: 'Komisyon & Tahsilatlar',
        categories: [
          { id: 'satis_komisyon', label: 'Satış Hizmet Bedeli', color: '#15803d' },
          { id: 'kira_komisyon', label: 'Kiralama Komisyonu', color: '#0284c7' },
          { id: 'kapora', label: 'Kapora / Ön Ödeme', color: '#2563eb' },
          { id: 'ekspertiz', label: 'Ekspertiz & Danışmanlık', color: '#0d9488' },
        ],
        samples: [
          {
            title: 'Ataşehir Rezidans Kiralama Hizmet Bedeli',
            amount: 42000,
            status: 'tamamlandi',
            method: 'havale_eft',
            category: 'kira_komisyon',
            daysOffset: -2,
            personIdx: 1,
            serviceIdx: 1,
            notes: '1 kira bedeli hizmet faturası kesildi',
          },
          {
            title: 'Moda 3+1 Satış Kapora & Komisyon Taahhüdü',
            amount: 145000,
            status: 'bekliyor',
            method: 'havale_eft',
            category: 'satis_komisyon',
            daysOffset: 0,
            dueDaysOffset: 10,
            personIdx: 0,
            serviceIdx: 0,
            notes: 'Tapu devir gününde tahsil edilecek',
          },
        ],
      },
      expense: {
        tableName: 'Ofis & İlan Giderleri',
        categories: [
          { id: 'portal_ilan', label: 'İlan Portalı & Vitrin', color: '#2563eb' },
          { id: 'afis_reklam', label: 'Afiş, Branda & Çekim', color: '#0284c7' },
          { id: 'ofis_kira', label: 'Ofis & Sabit Giderler', color: '#0d9488' },
          { id: 'ulasim_saha', label: 'Saha & Araç Yakıt', color: '#d97706' },
        ],
        samples: [
          {
            title: 'Aylık Kurumsal İlan Portalı Paketi',
            category: 'portal_ilan',
            qty: 1,
            unitCost: 14500,
            daysOffset: -5,
            notes: 'Kurumsal vitrin aboneliği',
          },
          {
            title: 'Profesyonel Drone & İç Mekan Fotoğraf Çekimi',
            category: 'afis_reklam',
            qty: 2,
            unitCost: 3250,
            daysOffset: -1,
            notes: 'Moda ve Ataşehir portföyleri',
          },
        ],
      },
      inventory: {
        tableName: 'Ofis & Saha Malzeme Stoku',
        categories: [
          { id: 'afis_branda', label: 'Satılık / Kiralık Branda', color: '#2563eb' },
          { id: 'tanitim', label: 'Katalog & Sunum Dosyası', color: '#0284c7' },
          { id: 'anahtar_kilit', label: 'Şifreli Anahtar Kutusu', color: '#0d9488' },
          { id: 'ofis_sarf', label: 'Ofis Sarf Malzeme', color: '#15803d' },
        ],
        samples: [
          {
            name: 'Balkon Tipi Satılık Brandası (100x70)',
            category: 'afis_branda',
            unit: 'adet',
            qty: 4,
            minThreshold: 6,
            unitCost: 320,
            notes: 'Kritik seviyenin altında — yeni baskı siparişi verilecek',
          },
          {
            name: 'Şifreli Portföy Anahtar Kasası',
            category: 'anahtar_kilit',
            unit: 'adet',
            qty: 12,
            minThreshold: 4,
            unitCost: 650,
            notes: 'Boş daire gösterimleri için',
          },
          {
            name: 'Kurumsal Portföy Sunum Dosyası',
            category: 'tanitim',
            unit: 'paket',
            qty: 18,
            minThreshold: 5,
            unitCost: 240,
          },
        ],
      },
      maintenance: {
        tableName: 'Araç & Ekipman Periyodik Bakım',
        types: [
          { id: 'arac_bakim', label: 'Saha Aracı Periyodik Bakım', color: '#0284c7' },
          { id: 'drone_kamera', label: 'Drone & Kamera Kalibrasyonu', color: '#2563eb' },
          { id: 'ofis_iklim', label: 'Ofis Klima & Cihaz Bakımı', color: '#0d9488' },
        ],
        samples: [
          {
            name: '34 EML 104 Saha Aracı 15.000 KM Bakımı',
            type: 'arac_bakim',
            isPeriodic: true,
            periodicDays: 180,
            scheduledDaysOffset: 7,
            nextDaysOffset: 7,
            cost: 7500,
            status: 'planlandi',
            notes: 'Yetkili servis randevusu yaklaşıyor',
          },
          {
            name: 'DJI Çekim Drone Batarya & Sensör Kontrolü',
            type: 'drone_kamera',
            isPeriodic: true,
            periodicDays: 90,
            scheduledDaysOffset: -20,
            nextDaysOffset: 70,
            cost: 1800,
            status: 'tamamlandi',
            notes: 'Pervane seti yenilendi',
          },
        ],
      },
    })

    return getStudioSchema()
  }

  if (blueprint === 'insurance_quote') {
    const insureds = await createDynamicTable({
      name: 'Sigortalı Müşteriler',
      icon: 'users',
      color: '#0284c7',
      canvasX: 430,
      canvasY: 50,
      initialColumns: [
        { name: 'Ad Soyad / Ünvan', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 220 },
        { name: 'Telefon', fieldType: 'phone', width: 170 },
        { name: 'Plaka / Varlık Bilgisi', fieldType: 'text', width: 180 },
        { name: 'Poliçe Bitiş Tarihi', fieldType: 'date', width: 150 },
      ],
    })

    const quotes = await createDynamicTable({
      name: 'Sigorta Teklifleri',
      icon: 'briefcase',
      color: '#2563eb',
      canvasX: 430,
      canvasY: 360,
      initialColumns: [
        { name: 'Branş / Teklif Başlığı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 230 },
        { name: 'Teklif Primi', fieldType: 'currency', width: 150 },
        {
          name: 'Teklif Durumu',
          fieldType: 'select',
          width: 160,
          config: {
            options: [
              { id: 'hazirlandi', label: 'Teklif Hazırlandı', color: '#0284c7' },
              { id: 'onay_bekliyor', label: 'Onay Bekliyor', color: '#2563eb' },
              { id: 'policelesti', label: 'Poliçeleşti', color: '#15803d' },
            ],
          },
        },
      ],
    })

    const carriers = await createDynamicTable({
      name: 'Sigorta Şirketleri',
      icon: 'layers',
      color: '#15803d',
      canvasX: 50,
      canvasY: 220,
      initialColumns: [
        { name: 'Şirket Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 200 },
        { name: 'Ödeme / Taksit', fieldType: 'text', width: 160 },
      ],
    })

    const coverages = await createDynamicTable({
      name: 'Ek Teminatlar',
      icon: 'tag',
      color: '#0369a1',
      canvasX: 50,
      canvasY: 480,
      initialColumns: [
        { name: 'Teminat Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 220 },
      ],
    })

    const relCarrier = await createDynamicRelation({
      sourceTableId: quotes.id,
      targetTableId: carriers.id,
      sourceColumnName: 'Sigorta Şirketleri',
      inverseColumnName: 'Verilen Teklifler',
      createInverseColumn: true,
      cardinality: 'many_to_many',
    })

    const relCoverage = await createDynamicRelation({
      sourceTableId: quotes.id,
      targetTableId: coverages.id,
      sourceColumnName: 'Ek Teminatlar',
      inverseColumnName: 'İlgili Teklifler',
      createInverseColumn: true,
      cardinality: 'many_to_many',
    })

    await upsertAppointmentConfig({
      tableId: insureds.id,
      enabled: true,
      allowMultiple: false,
      includeRelatedTables: true,
      isRequiredInAppointment: true,
    })
    await upsertAppointmentConfig({
      tableId: quotes.id,
      enabled: true,
      allowMultiple: true,
      includeRelatedTables: true,
      isRequiredInAppointment: false,
    })

    await updateStudioSettings({ appointmentNodePosition: { x: 830, y: 120 } })

    const inName = insureds.columns[0]?.id
    const inPhone = insureds.columns[1]?.id
    const inAsset = insureds.columns[2]?.id
    const insuredSampleIds: string[] = []
    if (inName) {
      const ins1 = await createDynamicRow(insureds.id, {
        values: {
          [inName]: 'Murat Çelik',
          ...(inPhone ? { [inPhone]: '0532 518 77 09' } : {}),
          ...(inAsset ? { [inAsset]: '34 ABC 482' } : {}),
        },
      })
      const ins2 = await createDynamicRow(insureds.id, {
        values: {
          [inName]: 'Elif Şahin Lojistik Ltd.',
          ...(inPhone ? { [inPhone]: '0542 330 65 18' } : {}),
          ...(inAsset ? { [inAsset]: 'Kurumsal İşyeri Paketi' } : {}),
        },
      })
      insuredSampleIds.push(ins1.id, ins2.id)
    }

    const crName = carriers.columns[0]?.id
    const crInstallment = carriers.columns[1]?.id
    let cr1Id: string | null = null
    let cr2Id: string | null = null
    if (crName) {
      const c1 = await createDynamicRow(carriers.id, {
        values: {
          [crName]: 'Allianz Sigorta',
          ...(crInstallment ? { [crInstallment]: '9 Taksit' } : {}),
        },
      })
      const c2 = await createDynamicRow(carriers.id, {
        values: {
          [crName]: 'Anadolu Sigorta',
          ...(crInstallment ? { [crInstallment]: '6 Taksit' } : {}),
        },
      })
      cr1Id = c1.id
      cr2Id = c2.id
    }

    const cvName = coverages.columns[0]?.id
    let cv1Id: string | null = null
    let cv2Id: string | null = null
    if (cvName) {
      const cov1 = await createDynamicRow(coverages.id, {
        values: { [cvName]: 'İkame Araç (15 Gün)' },
      })
      const cov2 = await createDynamicRow(coverages.id, {
        values: { [cvName]: 'İMM 5.000.000 ₺' },
      })
      await createDynamicRow(coverages.id, {
        values: { [cvName]: 'Cam Muafiyetsiz' },
      })
      cv1Id = cov1.id
      cv2Id = cov2.id
    }

    const qtTitle = quotes.columns[0]?.id
    const qtPremium = quotes.columns[1]?.id
    const qtStatus = quotes.columns[2]?.id
    const quoteSampleIds: string[] = []
    if (qtTitle) {
      const relPayload: Record<string, string[]> = {}
      if (relCarrier?.sourceColumnId && cr1Id && cr2Id) {
        relPayload[relCarrier.sourceColumnId] = [cr1Id, cr2Id]
      }
      if (relCoverage?.sourceColumnId && cv1Id && cv2Id) {
        relPayload[relCoverage.sourceColumnId] = [cv1Id, cv2Id]
      }
      const q1 = await createDynamicRow(quotes.id, {
        values: {
          [qtTitle]: 'Genişletilmiş Kasko Teklifi',
          ...(qtPremium ? { [qtPremium]: 18400 } : {}),
          ...(qtStatus ? { [qtStatus]: 'hazirlandi' } : {}),
        },
        relations: relPayload,
      })
      const q2 = await createDynamicRow(quotes.id, {
        values: {
          [qtTitle]: 'Tamamlayıcı Sağlık Sigortası',
          ...(qtPremium ? { [qtPremium]: 14900 } : {}),
          ...(qtStatus ? { [qtStatus]: 'onay_bekliyor' } : {}),
        },
      })
      quoteSampleIds.push(q1.id, q2.id)
    }

    await seedSectorFinanceAndStockTables({
      canvasStartX: 1180,
      personTable: {
        id: insureds.id,
        sampleRowIds: insuredSampleIds,
        relationLabel: 'Sigortalı Müşteri',
        inverseLabel: 'Prim & Komisyon Ödemeleri',
      },
      serviceTable: {
        id: quotes.id,
        sampleRowIds: quoteSampleIds,
        relationLabel: 'İlgili Poliçe / Teklif',
        inverseLabel: 'Tahsilat Hareketleri',
      },
      income: {
        tableName: 'Prim & Komisyon Tahsilatları',
        categories: [
          { id: 'kasko_trafik', label: 'Kasko & Trafik Primi', color: '#2563eb' },
          { id: 'saglik_tss', label: 'Sağlık / TSS Primi', color: '#15803d' },
          { id: 'isyeri_konut', label: 'İşyeri & Konut Poliçesi', color: '#0284c7' },
          { id: 'acente_komisyon', label: 'Şirket Komisyonakedişi', color: '#0d9488' },
        ],
        samples: [
          {
            title: '34 ABC 482 Genişletilmiş Kasko Peşinatı',
            amount: 18400,
            status: 'tamamlandi',
            method: 'kredi_karti',
            category: 'kasko_trafik',
            daysOffset: -3,
            personIdx: 0,
            serviceIdx: 0,
            notes: 'Sanal POS tek çekim poliçe tahsilatı',
          },
          {
            title: 'Kurumsal Tamamlayıcı Sağlık Poliçe Tahsilatı',
            amount: 14900,
            status: 'bekliyor',
            method: 'havale_eft',
            category: 'saglik_tss',
            daysOffset: 0,
            dueDaysOffset: 7,
            personIdx: 1,
            serviceIdx: 1,
            notes: 'Onay sonrası cari havale bekleniyor',
          },
        ],
      },
      expense: {
        tableName: 'Acente & Ofis Giderleri',
        categories: [
          { id: 'yazilim_ekran', label: 'Poliçe Karşılaştırma Yazılımı', color: '#2563eb' },
          { id: 'ofis_kirtasiye', label: 'Ofis, Kargo & Evrak', color: '#0284c7' },
          { id: 'pazarlama', label: 'Müşteri Promosyon & Dijital İlan', color: '#0d9488' },
        ],
        samples: [
          {
            title: 'Çoklu Şirket Teklif Ekranı Aylık Lisans',
            category: 'yazilim_ekran',
            qty: 1,
            unitCost: 5800,
            daysOffset: -4,
          },
          {
            title: 'Poliçe Kargo & Ruhsat Kabı Gönderimleri',
            category: 'ofis_kirtasiye',
            qty: 1,
            unitCost: 1950,
            daysOffset: -1,
          },
        ],
      },
      inventory: {
        tableName: 'Basılı Evrak & Promosyon Stoku',
        categories: [
          { id: 'ruhsat_dosya', label: 'Ruhsat Kabı & Poliçe Dosyası', color: '#2563eb' },
          { id: 'hasar_tutanak', label: 'Kaza Tespit Tutanağı & Evrak', color: '#0284c7' },
          { id: 'promosyon', label: 'Müşteri Promosyon Ürünleri', color: '#15803d' },
        ],
        samples: [
          {
            name: 'Logolu Deri Ruhsat Kabı',
            category: 'ruhsat_dosya',
            unit: 'adet',
            qty: 8,
            minThreshold: 15,
            unitCost: 45,
            notes: 'Kritik stok altı — matbaa siparişi geçilecek',
          },
          {
            name: 'Baskılı Poliçe Teslim Klasörü',
            category: 'hasar_tutanak',
            unit: 'paket',
            qty: 25,
            minThreshold: 5,
            unitCost: 160,
          },
        ],
      },
      maintenance: {
        tableName: 'Ofis Cihaz & Sertifika Takibi',
        types: [
          { id: 'e_imza_lisans', label: 'E-İmza & SEGEM / Lisans Yenileme', color: '#2563eb' },
          { id: 'yazici_donanim', label: 'Yazıcı & Tarayıcı Bakımı', color: '#0284c7' },
        ],
        samples: [
          {
            name: 'Kurumsal Nitelikli E-İmza Yenilemesi',
            type: 'e_imza_lisans',
            isPeriodic: true,
            periodicDays: 365,
            scheduledDaysOffset: 10,
            nextDaysOffset: 10,
            cost: 1650,
            status: 'planlandi',
            notes: 'Sertifika süresi dolmadan yenilenecek',
          },
        ],
      },
    })

    return getStudioSchema()
  }

  if (blueprint === 'dental_clinic') {
    const CHANNEL_OPTIONS: SelectOptionItem[] = [
      { id: 'sms', label: 'SMS', color: '#0284c7' },
      { id: 'whatsapp', label: 'WhatsApp', color: '#15803d' },
      { id: 'email', label: 'E-Posta', color: '#2563eb' },
      { id: 'assistant_call', label: 'Asistan Araması', color: '#0369a1' },
    ]

    const MEDIA_ATTACHMENT_OPTIONS: SelectOptionItem[] = [
      { id: 'radiology', label: '2B Radyoloji (.dcm)', color: '#0284c7' },
      { id: 'cbct', label: '3B CBCT / DICOM', color: '#2563eb' },
      { id: 'photo', label: 'Klinik Fotoğraflar', color: '#15803d' },
    ]

    const TDB_REMINDER_OPTIONS: SelectOptionItem[] = [
      { id: 'kapali', label: 'Kapalı', color: '#64748b' },
      { id: '7g', label: '7 Gün · Cerrahi / Dikiş', color: '#ef4444' },
      { id: '14g', label: '14 Gün · Kısa Kontrol', color: '#d97706' },
      { id: '30g', label: '1 Ay (30g) · Ortodonti / Splint', color: '#0284c7' },
      { id: '90g', label: '3 Ay (90g) · İmplant / Perio', color: '#0d9488' },
      { id: '180g', label: '6 Ay (180g) · Rutin Kontrol', color: '#2563eb' },
      { id: '365g', label: '1 Yıl (365g) · Yıllık / Protez', color: '#15803d' },
    ]

    const SCOPE_OPTIONS: SelectOptionItem[] = [
      { id: 'tooth', label: 'Diş Bazlı', color: '#0284c7' },
      { id: 'jaw', label: 'Çene Bazlı', color: '#2563eb' },
      { id: 'mouth', label: 'Tüm Ağız', color: '#15803d' },
    ]

    // 1. Hastalar (Modal Başlığı + Bildirim/KVKK Onamı + Hasta Geçmişi)
    const patients = await createDynamicTable({
      name: 'Hastalar',
      icon: 'users',
      color: '#0284c7',
      canvasX: 490,
      canvasY: 40,
      initialColumns: [
        { name: 'Ad Soyad', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 205 },
        { name: 'Telefon', fieldType: 'phone', width: 165 },
        { name: 'E-Posta', fieldType: 'email', width: 195 },
        { name: 'TC Kimlik No', fieldType: 'text', width: 145 },
        {
          name: 'Hasta Durumu',
          fieldType: 'select',
          width: 165,
          config: {
            options: [
              { id: 'yeni', label: 'İlk Muayene', color: '#0284c7' },
              { id: 'tedavide', label: 'Tedavisi Sürüyor', color: '#2563eb' },
              { id: 'kontrol', label: 'Periyodik Kontrol', color: '#15803d' },
              { id: 'tamamlandi', label: 'Tedavisi Tamamlandı', color: '#0d9488' },
            ],
          },
        },
        {
          name: 'İzinli Bildirim Kanalları',
          fieldType: 'multiselect',
          width: 190,
          config: { options: CHANNEL_OPTIONS },
        },
        {
          name: 'KVKK & Aydınlatılmış Onam',
          fieldType: 'select',
          width: 190,
          config: {
            options: [
              { id: 'onaylandi', label: 'Onaylandı', color: '#15803d' },
              { id: 'bekliyor', label: 'Onay Bekliyor', color: '#d97706' },
              { id: 'form_indirildi', label: 'Onam Formu İndirildi', color: '#0284c7' },
              { id: 'kapali', label: 'Bildirim Kapalı', color: '#64748b' },
            ],
          },
        },
        { name: 'Hasta Geçmişi / Sistemik Not', fieldType: 'text', width: 240 },
      ],
    })

    // 2. Hekimler (Adım 4 Sorumlu Hekim Çoklu Seçimi & Müsaitlik)
    const doctors = await createDynamicTable({
      name: 'Hekimler',
      icon: 'user-check',
      color: '#0d9488',
      canvasX: 40,
      canvasY: 40,
      initialColumns: [
        { name: 'Hekim Adı Soyadı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 210 },
        { name: 'Uzmanlık / Branş', fieldType: 'text', width: 210 },
        {
          name: 'Takvim & Plan Rengi',
          fieldType: 'select',
          width: 165,
          config: {
            options: [
              { id: 'mavi', label: 'Medikal Mavi', color: '#0284c7' },
              { id: 'turkuaz', label: 'Klinik Turkuaz', color: '#0d9488' },
              { id: 'nane', label: 'Nane Yeşili', color: '#15803d' },
              { id: 'indigo', label: 'Derin Klinik Mavi', color: '#2563eb' },
            ],
          },
        },
        {
          name: 'Müsaitlik Durumu',
          fieldType: 'select',
          width: 155,
          config: {
            options: [
              { id: 'aktif', label: 'Aktif Mesai', color: '#15803d' },
              { id: 'izinli', label: 'İzinli / Raporlu', color: '#ef4444' },
            ],
          },
        },
      ],
    })

    // 3. Endikasyonlar (Adım 3 Endikasyon / Tanı Kataloğu)
    const indications = await createDynamicTable({
      name: 'Endikasyonlar',
      icon: 'tag',
      color: '#0369a1',
      canvasX: 40,
      canvasY: 470,
      initialColumns: [
        { name: 'Endikasyon / Tanı Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 225 },
        {
          name: 'Hedef Kapsam',
          fieldType: 'select',
          width: 145,
          config: { options: SCOPE_OPTIONS },
        },
        { name: 'Klinik Açıklama', fieldType: 'text', width: 240 },
      ],
    })

    // 4. Malzemeler (Adım 3 & Adım 4 Satır Malzemeleri / Envanter Kataloğu)
    const materials = await createDynamicTable({
      name: 'Malzemeler',
      icon: 'box',
      color: '#15803d',
      canvasX: 40,
      canvasY: 900,
      initialColumns: [
        { name: 'Malzeme Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 215 },
        {
          name: 'Kategori',
          fieldType: 'select',
          width: 165,
          config: {
            options: [
              { id: 'restoratif', label: 'Restoratif / Dolgu', color: '#0284c7' },
              { id: 'endodonti', label: 'Endodonti', color: '#8b5cf6' },
              { id: 'cerrahi', label: 'Cerrahi & İmplant', color: '#0d9488' },
              { id: 'protetik', label: 'Protetik', color: '#d97706' },
              { id: 'sarf', label: 'Anestezi & Sarf', color: '#15803d' },
            ],
          },
        },
        {
          name: 'Birim',
          fieldType: 'select',
          width: 120,
          config: {
            options: [
              { id: 'adet', label: 'Adet', color: '#0284c7' },
              { id: 'karpul', label: 'Karpül', color: '#2563eb' },
              { id: 'set', label: 'Set', color: '#0d9488' },
              { id: 'blok', label: 'Blok', color: '#d97706' },
              { id: 'paket', label: 'Paket', color: '#15803d' },
            ],
          },
        },
        { name: 'Stok Miktarı', fieldType: 'number', width: 125 },
        { name: 'Birim Maliyet (₺)', fieldType: 'currency', width: 150, config: { currencySymbol: '₺' } },
        { name: 'Ek Satış Fiyatı (₺)', fieldType: 'currency', width: 155, config: { currencySymbol: '₺' } },
        { name: 'Kritik Eşik', fieldType: 'number', width: 120 },
        { name: 'Son Kullanma Tarihi', fieldType: 'date', width: 155 },
      ],
    })

    // 5. Tedaviler (Adım 3 Tedaviler Kataloğu: Renk Seçici, Kapsam, Süre, TDB Önerisi)
    const treatments = await createDynamicTable({
      name: 'Tedaviler',
      icon: 'layers',
      color: '#2563eb',
      canvasX: 490,
      canvasY: 900,
      initialColumns: [
        { name: 'Tedavi / İşlem Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 245 },
        { name: 'Baz Fiyat (₺)', fieldType: 'currency', width: 145, config: { currencySymbol: '₺' } },
        {
          name: 'Uygulama Kapsamı',
          fieldType: 'select',
          width: 150,
          config: { options: SCOPE_OPTIONS },
        },
        {
          name: 'Klinik İşlem Rengi',
          fieldType: 'select',
          width: 185,
          config: {
            options: [
              { id: 'mavi', label: 'Medikal Mavi (#0284c7)', color: '#0284c7' },
              { id: 'mor', label: 'Klinik Mor (#8b5cf6)', color: '#8b5cf6' },
              { id: 'turkuaz', label: 'Turkuaz / İmplant (#0d9488)', color: '#0d9488' },
              { id: 'kehribar', label: 'Kehribar / Protez (#d97706)', color: '#d97706' },
              { id: 'kirmizi', label: 'Mercan Kırmızı / Cerrahi (#ef4444)', color: '#ef4444' },
              { id: 'nane', label: 'Nane Yeşili / Perio (#15803d)', color: '#15803d' },
            ],
          },
        },
        { name: 'Seans Süresi (Dk)', fieldType: 'number', width: 135 },
        {
          name: 'Önerilen TDB Kontrol',
          fieldType: 'select',
          width: 195,
          config: { options: TDB_REMINDER_OPTIONS },
        },
      ],
    })

    // 6. Tedavi Planları (Adım 1 Radyoloji/Medya + Adım 2 Odontogram Diş/Yüzey/Katman + Adım 3 Konsültasyon + Adım 4 Tablo, İskonto, TDB Hatırlatma & Onam)
    const treatmentPlansTable = await createDynamicTable({
      name: 'Tedavi Planları',
      icon: 'briefcase',
      color: '#1d4ed8',
      canvasX: 490,
      canvasY: 470,
      initialColumns: [
        { name: 'Plan / İşlem Kalemi', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 245 },
        { name: 'Diş / Çene Bölgesi', fieldType: 'text', width: 150 },
        {
          name: 'Diş Yüzeyleri',
          fieldType: 'multiselect',
          width: 185,
          config: {
            options: [
              { id: 'okluzal', label: 'Okluzal (O)', color: '#0284c7' },
              { id: 'mezial', label: 'Mezial (M)', color: '#2563eb' },
              { id: 'distal', label: 'Distal (D)', color: '#0d9488' },
              { id: 'bukkal', label: 'Bukkal (B)', color: '#15803d' },
              { id: 'lingual', label: 'Lingual / Palatinal (L)', color: '#0369a1' },
            ],
          },
        },
        {
          name: 'Anatomik Katman',
          fieldType: 'multiselect',
          width: 165,
          config: {
            options: [
              { id: 'mine', label: 'Mine', color: '#0284c7' },
              { id: 'pulpa', label: 'Pulpa', color: '#ef4444' },
              { id: 'kok_kanali', label: 'Kök Kanalı', color: '#8b5cf6' },
            ],
          },
        },
        {
          name: 'Odontogram Modu',
          fieldType: 'select',
          width: 150,
          config: {
            options: [
              { id: '2d_chart', label: '2B Chart', color: '#0284c7' },
              { id: '2d_anatomik', label: '2B Anatomik', color: '#2563eb' },
              { id: '3d_anatomik', label: '3B Anatomik', color: '#0d9488' },
            ],
          },
        },
      ],
    })

    // Adım 3 Katalog Çizgisel Bağlantıları (Endikasyon ↔ Tedavi & Malzeme ↔ Tedavi)
    const relTreatInd = await createDynamicRelation({
      sourceTableId: treatments.id,
      targetTableId: indications.id,
      sourceColumnName: 'Bağlı Endikasyonlar',
      inverseColumnName: 'Bağlı Tedaviler',
      createInverseColumn: true,
      cardinality: 'many_to_many',
    })
    const relTreatMat = await createDynamicRelation({
      sourceTableId: treatments.id,
      targetTableId: materials.id,
      sourceColumnName: 'Varsayılan Malzemeler',
      inverseColumnName: 'Varsayılan Tedavileri',
      createInverseColumn: true,
      cardinality: 'many_to_many',
    })

    // Adım 4 Tedavi Planı Sütun Sırasına Birebir Uygun İlişkiler (Hasta -> Endikasyonlar -> Tedavi -> Hekim -> Satır Malzemeleri)
    const relPlanPatient = await createDynamicRelation({
      sourceTableId: patients.id,
      targetTableId: treatmentPlansTable.id,
      sourceColumnName: 'Tedavi Planları',
      inverseColumnName: 'Hasta',
      createInverseColumn: true,
      cardinality: 'one_to_many',
    })
    const relPlanIndications = await createDynamicRelation({
      sourceTableId: treatmentPlansTable.id,
      targetTableId: indications.id,
      sourceColumnName: 'Endikasyonlar',
      inverseColumnName: 'Yer Aldığı Planlar',
      createInverseColumn: true,
      cardinality: 'many_to_many',
    })
    const relPlanTreatment = await createDynamicRelation({
      sourceTableId: treatments.id,
      targetTableId: treatmentPlansTable.id,
      sourceColumnName: 'Uygulandığı Planlar',
      inverseColumnName: 'Tedavi',
      createInverseColumn: true,
      cardinality: 'one_to_many',
    })
    const relPlanDoctors = await createDynamicRelation({
      sourceTableId: treatmentPlansTable.id,
      targetTableId: doctors.id,
      sourceColumnName: 'Sorumlu Hekim',
      inverseColumnName: 'Atandığı Plan Kalemleri',
      createInverseColumn: true,
      cardinality: 'many_to_many',
    })
    const relPlanMaterials = await createDynamicRelation({
      sourceTableId: treatmentPlansTable.id,
      targetTableId: materials.id,
      sourceColumnName: 'Satır Malzemeleri',
      inverseColumnName: 'Kullanıldığı Planlar',
      createInverseColumn: true,
      cardinality: 'many_to_many',
    })

    // Adım 4 Fiyatlandırma, İskonto, Durum, TDB Periyodik Kontrol, Bildirim, Medya & Onam Sütunları
    const colBasePrice = await createDynamicColumn(treatmentPlansTable.id, {
      name: 'İşlem Fiyatı (₺)',
      fieldType: 'currency',
      width: 145,
      config: { currencySymbol: '₺' },
    })
    const colMatExtra = await createDynamicColumn(treatmentPlansTable.id, {
      name: 'Malzeme Ek Tutarı (₺)',
      fieldType: 'currency',
      width: 160,
      config: { currencySymbol: '₺' },
    })
    const colDiscountPct = await createDynamicColumn(treatmentPlansTable.id, {
      name: 'İskonto (%)',
      fieldType: 'number',
      width: 120,
    })
    const colDiscountFixed = await createDynamicColumn(treatmentPlansTable.id, {
      name: 'Manuel İskonto (₺)',
      fieldType: 'currency',
      width: 155,
      config: { currencySymbol: '₺' },
    })
    const colNetTotal = await createDynamicColumn(treatmentPlansTable.id, {
      name: 'Net Tutar (₺)',
      fieldType: 'currency',
      width: 145,
      config: { currencySymbol: '₺' },
    })
    const colPlanStatus = await createDynamicColumn(treatmentPlansTable.id, {
      name: 'İşlem Durumu',
      fieldType: 'select',
      width: 150,
      config: {
        options: [
          { id: 'planlandi', label: 'Planlandı', color: '#0284c7' },
          { id: 'devam_ediyor', label: 'Devam Ediyor', color: '#2563eb' },
          { id: 'tamamlandi', label: 'Tamamlandı', color: '#15803d' },
        ],
      },
    })
    const colTdbReminder = await createDynamicColumn(treatmentPlansTable.id, {
      name: 'TDB Kontrol Hatırlatma',
      fieldType: 'multiselect',
      width: 205,
      config: { options: TDB_REMINDER_OPTIONS },
    })
    const colCustomDays = await createDynamicColumn(treatmentPlansTable.id, {
      name: 'Özel Kontrol Günü',
      fieldType: 'number',
      width: 145,
    })
    const colNotifChannels = await createDynamicColumn(treatmentPlansTable.id, {
      name: 'Bildirim Kanalları',
      fieldType: 'multiselect',
      width: 185,
      config: { options: CHANNEL_OPTIONS },
    })
    const colPlanMedia = await createDynamicColumn(treatmentPlansTable.id, {
      name: 'Radyoloji & Medya Ekleri',
      fieldType: 'multiselect',
      width: 200,
      config: { options: MEDIA_ATTACHMENT_OPTIONS },
    })
    const colConsultNote = await createDynamicColumn(treatmentPlansTable.id, {
      name: 'Konsültasyon Notu',
      fieldType: 'text',
      width: 260,
    })
    const colConsentSigned = await createDynamicColumn(treatmentPlansTable.id, {
      name: 'Sağlık Bakanlığı Onam Formu',
      fieldType: 'boolean',
      width: 195,
    })

    // Randevu Kurgusu: ① Hastalar (Tekli Kişi) + ② Tedaviler (Çoklu İşlem & Alt Tablolar)
    await upsertAppointmentConfig({
      tableId: patients.id,
      enabled: true,
      allowMultiple: false,
      includeRelatedTables: true,
      isRequiredInAppointment: true,
    })
    await upsertAppointmentConfig({
      tableId: treatments.id,
      enabled: true,
      allowMultiple: true,
      includeRelatedTables: true,
      isRequiredInAppointment: false,
    })

    await updateStudioSettings({ appointmentNodePosition: { x: 950, y: 260 } })

    // ── Örnek Kayıtlar & Birebir Bağlantılar ─────────────────────────────────

    // A) Hastalar
    const pNameCol = patients.columns[0]?.id
    const pPhoneCol = patients.columns[1]?.id
    const pEmailCol = patients.columns[2]?.id
    const pTcCol = patients.columns[3]?.id
    const pStatusCol = patients.columns[4]?.id
    const pChannelsCol = patients.columns[5]?.id
    const pConsentCol = patients.columns[6]?.id
    const pHistoryCol = patients.columns[7]?.id

    let pat1Id: string | null = null
    let pat2Id: string | null = null
    let pat3Id: string | null = null
    if (pNameCol) {
      const pt1 = await createDynamicRow(patients.id, {
        values: {
          [pNameCol]: 'Ayşe Demir',
          ...(pPhoneCol ? { [pPhoneCol]: '0532 411 22 33' } : {}),
          ...(pEmailCol ? { [pEmailCol]: 'ayse.demir@ornek.com' } : {}),
          ...(pTcCol ? { [pTcCol]: '14826395104' } : {}),
          ...(pStatusCol ? { [pStatusCol]: 'tedavide' } : {}),
          ...(pChannelsCol ? { [pChannelsCol]: ['sms', 'whatsapp'] } : {}),
          ...(pConsentCol ? { [pConsentCol]: 'onaylandi' } : {}),
          ...(pHistoryCol ? { [pHistoryCol]: 'Sistemik hastalık yok, bilinen ilaç alerjisi yok.' } : {}),
        },
      })
      const pt2 = await createDynamicRow(patients.id, {
        values: {
          [pNameCol]: 'Mehmet Kaya',
          ...(pPhoneCol ? { [pPhoneCol]: '0544 822 10 90' } : {}),
          ...(pEmailCol ? { [pEmailCol]: 'mehmet.kaya@ornek.com' } : {}),
          ...(pTcCol ? { [pTcCol]: '29481057362' } : {}),
          ...(pStatusCol ? { [pStatusCol]: 'yeni' } : {}),
          ...(pChannelsCol ? { [pChannelsCol]: ['sms', 'email'] } : {}),
          ...(pConsentCol ? { [pConsentCol]: 'onaylandi' } : {}),
          ...(pHistoryCol ? { [pHistoryCol]: 'Kontrollü hipertansiyon, sağ alt bölge implant değerlendirmesi.' } : {}),
        },
      })
      const pt3 = await createDynamicRow(patients.id, {
        values: {
          [pNameCol]: 'Zeynep Çelik',
          ...(pPhoneCol ? { [pPhoneCol]: '0533 619 45 78' } : {}),
          ...(pEmailCol ? { [pEmailCol]: 'zeynep.celik@ornek.com' } : {}),
          ...(pTcCol ? { [pTcCol]: '41820593746' } : {}),
          ...(pStatusCol ? { [pStatusCol]: 'kontrol' } : {}),
          ...(pChannelsCol ? { [pChannelsCol]: ['whatsapp', 'assistant_call'] } : {}),
          ...(pConsentCol ? { [pConsentCol]: 'form_indirildi' } : {}),
          ...(pHistoryCol ? { [pHistoryCol]: '6 aylık periyodik detartraj ve protetik kontrol hastası.' } : {}),
        },
      })
      pat1Id = pt1.id
      pat2Id = pt2.id
      pat3Id = pt3.id
    }

    // B) Hekimler
    const dNameCol = doctors.columns[0]?.id
    const dSpecCol = doctors.columns[1]?.id
    const dColorCol = doctors.columns[2]?.id
    const dAvailCol = doctors.columns[3]?.id
    let doc1Id: string | null = null
    let doc2Id: string | null = null
    let doc3Id: string | null = null
    if (dNameCol) {
      const dr1 = await createDynamicRow(doctors.id, {
        values: {
          [dNameCol]: 'Dt. Selin Yılmaz',
          ...(dSpecCol ? { [dSpecCol]: 'Restoratif Diş Tedavisi & Endodonti' } : {}),
          ...(dColorCol ? { [dColorCol]: 'mavi' } : {}),
          ...(dAvailCol ? { [dAvailCol]: 'aktif' } : {}),
        },
      })
      const dr2 = await createDynamicRow(doctors.id, {
        values: {
          [dNameCol]: 'Uzm. Dt. Emre Arslan',
          ...(dSpecCol ? { [dSpecCol]: 'Ağız, Diş ve Çene Cerrahisi' } : {}),
          ...(dColorCol ? { [dColorCol]: 'turkuaz' } : {}),
          ...(dAvailCol ? { [dAvailCol]: 'aktif' } : {}),
        },
      })
      const dr3 = await createDynamicRow(doctors.id, {
        values: {
          [dNameCol]: 'Dt. Burcu Aydın',
          ...(dSpecCol ? { [dSpecCol]: 'Protetik Diş Tedavisi & Periodontoloji' } : {}),
          ...(dColorCol ? { [dColorCol]: 'nane' } : {}),
          ...(dAvailCol ? { [dAvailCol]: 'aktif' } : {}),
        },
      })
      doc1Id = dr1.id
      doc2Id = dr2.id
      doc3Id = dr3.id
    }

    // C) Endikasyonlar
    const iNameCol = indications.columns[0]?.id
    const iScopeCol = indications.columns[1]?.id
    const iNoteCol = indications.columns[2]?.id
    const indMap: Record<string, string> = {}
    if (iNameCol) {
      const defaultIndications = [
        { key: 'curuk', name: 'Derin Dentin Çürüğü', scope: 'tooth', note: 'Mine ve dentin tabakasına ilerlemiş kavitasyon' },
        { key: 'pulpitis', name: 'İrreversible Pulpitis', scope: 'tooth', note: 'Spontan ağrılı geri dönüşümsüz pulpa enflamasyonu' },
        { key: 'periapikal', name: 'Apikal Periodontitis', scope: 'tooth', note: 'Kök ucu periapikal lezyon ve perküsyon hassasiyeti' },
        { key: 'eksiklik', name: 'Diş Eksikliği', scope: 'tooth', note: 'Çekim boşluğu / implant veya köprü endikasyonu' },
        { key: 'harabiyet', name: 'Kuron Harabiyeti', scope: 'tooth', note: 'Geniş madde kaybı nedeniyle protetik kuron ihtiyacı' },
        { key: 'gomulu', name: 'Gömülü / Sürmemiş Diş', scope: 'tooth', note: 'Mukoza veya kemik retansiyonlu yirmi yaş dişi' },
        { key: 'distasi', name: 'Yoğun Diş Taşı & Gingivitis', scope: 'mouth', note: 'Supragingival/subgingival kalkulus ve diş eti kanaması' },
        { key: 'bruksizm', name: 'Bruksizm & Eklem Hassasiyeti', scope: 'jaw', note: 'Gece diş sıkma ve TME kas hassasiyeti' },
      ]
      for (const item of defaultIndications) {
        const created = await createDynamicRow(indications.id, {
          values: {
            [iNameCol]: item.name,
            ...(iScopeCol ? { [iScopeCol]: item.scope } : {}),
            ...(iNoteCol ? { [iNoteCol]: item.note } : {}),
          },
        })
        indMap[item.key] = created.id
      }
    }

    // D) Malzemeler
    const mNameCol = materials.columns[0]?.id
    const mCatCol = materials.columns[1]?.id
    const mUnitCol = materials.columns[2]?.id
    const mStockCol = materials.columns[3]?.id
    const mCostCol = materials.columns[4]?.id
    const mSaleCol = materials.columns[5]?.id
    const mMinCol = materials.columns[6]?.id
    const mExpCol = materials.columns[7]?.id

    await upsertModuleConfig({
      tableId: materials.id,
      moduleRole: 'stock_inventory',
      enabled: true,
      mapping: {
        categoryColumnId: mCatCol ?? null,
        unitColumnId: mUnitCol ?? null,
        quantityColumnId: mStockCol ?? null,
        minThresholdColumnId: mMinCol ?? null,
        unitCostColumnId: mCostCol ?? null,
        expiryDateColumnId: mExpCol ?? null,
      },
    })

    const matMap: Record<string, string> = {}
    if (mNameCol) {
      const defaultMaterials = [
        { key: 'kompozit', name: 'Kompozit Rezin', cat: 'restoratif', unit: 'adet', stock: 45, min: 15, expDays: 240, cost: 180, sale: 200 },
        { key: 'bond', name: 'Adeziv Bond', cat: 'restoratif', unit: 'adet', stock: 4, min: 10, expDays: 18, cost: 90, sale: 100 },
        { key: 'guta', name: 'Guta Perka Kon', cat: 'endodonti', unit: 'paket', stock: 60, min: 15, expDays: 420, cost: 110, sale: 150 },
        { key: 'niti', name: 'NiTi Kanal Eğesi Seti', cat: 'endodonti', unit: 'set', stock: 25, min: 10, expDays: 500, cost: 350, sale: 400 },
        { key: 'anestezi', name: 'Lokal Anestezik Karpül', cat: 'sarf', unit: 'karpul', stock: 120, min: 30, expDays: 25, cost: 45, sale: 0 },
        { key: 'implant', name: 'Titanyum İmplant Gövdesi', cat: 'cerrahi', unit: 'adet', stock: 18, min: 8, expDays: 720, cost: 3200, sale: 0 },
        { key: 'zirkonyum', name: 'Zirkonyum Blok', cat: 'protetik', unit: 'blok', stock: 22, min: 8, expDays: 900, cost: 950, sale: 500 },
        { key: 'sutur', name: 'Cerrahi Sütür İpliği', cat: 'cerrahi', unit: 'adet', stock: 6, min: 12, expDays: 190, cost: 85, sale: 100 },
      ]
      for (const item of defaultMaterials) {
        const created = await createDynamicRow(materials.id, {
          values: {
            [mNameCol]: item.name,
            ...(mCatCol ? { [mCatCol]: item.cat } : {}),
            ...(mUnitCol ? { [mUnitCol]: item.unit } : {}),
            ...(mStockCol ? { [mStockCol]: item.stock } : {}),
            ...(mCostCol ? { [mCostCol]: item.cost } : {}),
            ...(mSaleCol ? { [mSaleCol]: item.sale } : {}),
            ...(mMinCol ? { [mMinCol]: item.min } : {}),
            ...(mExpCol ? { [mExpCol]: offsetDateIso(item.expDays) } : {}),
          },
        })
        matMap[item.key] = created.id
      }
    }

    // E) Tedaviler (Adım 3 Endikasyon & Malzeme Bağlantılarıyla Birlikte)
    const tNameCol = treatments.columns[0]?.id
    const tFeeCol = treatments.columns[1]?.id
    const tScopeCol = treatments.columns[2]?.id
    const tColorCol = treatments.columns[3]?.id
    const tDurationCol = treatments.columns[4]?.id
    const tTdbCol = treatments.columns[5]?.id
    const treatMap: Record<string, string> = {}
    if (tNameCol) {
      const defaultProcedures = [
        {
          key: 'dolgu',
          name: 'Kompozit Dolgu (Tek Yüzey)',
          fee: 2200,
          scope: 'tooth',
          color: 'mavi',
          duration: 30,
          tdb: '180g',
          inds: ['curuk'],
          mats: ['kompozit', 'bond'],
        },
        {
          key: 'kanal',
          name: 'Kanal Tedavisi (Tek Kanal)',
          fee: 4500,
          scope: 'tooth',
          color: 'mor',
          duration: 45,
          tdb: '180g',
          inds: ['pulpitis', 'periapikal'],
          mats: ['guta', 'niti', 'anestezi'],
        },
        {
          key: 'implant',
          name: 'İmplant (Yerli)',
          fee: 14500,
          scope: 'tooth',
          color: 'turkuaz',
          duration: 60,
          tdb: '90g',
          inds: ['eksiklik'],
          mats: ['implant', 'sutur', 'anestezi'],
        },
        {
          key: 'zirkonyum',
          name: 'Zirkonyum Kuron',
          fee: 6500,
          scope: 'tooth',
          color: 'kehribar',
          duration: 40,
          tdb: '365g',
          inds: ['harabiyet'],
          mats: ['zirkonyum'],
        },
        {
          key: 'cekim',
          name: 'Diş Çekimi',
          fee: 1800,
          scope: 'tooth',
          color: 'kirmizi',
          duration: 30,
          tdb: '7g',
          inds: ['gomulu'],
          mats: ['sutur', 'anestezi'],
        },
        {
          key: 'detartraj',
          name: 'Diş Taşı Temizliği (Detartraj)',
          fee: 2500,
          scope: 'mouth',
          color: 'nane',
          duration: 30,
          tdb: '180g',
          inds: ['distasi'],
          mats: [],
        },
        {
          key: 'splint',
          name: 'Gece Plağı / Bruksizm Splinti',
          fee: 4000,
          scope: 'jaw',
          color: 'mavi',
          duration: 25,
          tdb: '30g',
          inds: ['bruksizm'],
          mats: [],
        },
      ]

      for (const proc of defaultProcedures) {
        const relPayload: Record<string, string[]> = {}
        const linkedIndIds = proc.inds.map((k) => indMap[k]).filter((v): v is string => Boolean(v))
        const linkedMatIds = proc.mats.map((k) => matMap[k]).filter((v): v is string => Boolean(v))
        if (relTreatInd?.sourceColumnId && linkedIndIds.length > 0) {
          relPayload[relTreatInd.sourceColumnId] = linkedIndIds
        }
        if (relTreatMat?.sourceColumnId && linkedMatIds.length > 0) {
          relPayload[relTreatMat.sourceColumnId] = linkedMatIds
        }

        const created = await createDynamicRow(treatments.id, {
          values: {
            [tNameCol]: proc.name,
            ...(tFeeCol ? { [tFeeCol]: proc.fee } : {}),
            ...(tScopeCol ? { [tScopeCol]: proc.scope } : {}),
            ...(tColorCol ? { [tColorCol]: proc.color } : {}),
            ...(tDurationCol ? { [tDurationCol]: proc.duration } : {}),
            ...(tTdbCol ? { [tTdbCol]: proc.tdb } : {}),
          },
          relations: relPayload,
        })
        treatMap[proc.key] = created.id
      }
    }

    // F) Tedavi Planları (Adım 1–4 Tüm Alanların Birebir Dolu Örnek Satırları)
    const tpTitleCol = treatmentPlansTable.columns[0]?.id
    const tpTargetCol = treatmentPlansTable.columns[1]?.id
    const tpSurfacesCol = treatmentPlansTable.columns[2]?.id
    const tpLayersCol = treatmentPlansTable.columns[3]?.id
    const tpModeCol = treatmentPlansTable.columns[4]?.id

    if (tpTitleCol) {
      // Plan Satırı 1: Diş #36 Kompozit Dolgu (2B Anatomik, Yüzey + Katman + %10 İskonto + Röntgen)
      const rel1: Record<string, string[]> = {}
      if (relPlanPatient?.inverseColumnId && pat1Id) rel1[relPlanPatient.inverseColumnId] = [pat1Id]
      if (relPlanIndications?.sourceColumnId && indMap.curuk) rel1[relPlanIndications.sourceColumnId] = [indMap.curuk]
      if (relPlanTreatment?.inverseColumnId && treatMap.dolgu) rel1[relPlanTreatment.inverseColumnId] = [treatMap.dolgu]
      if (relPlanDoctors?.sourceColumnId && doc1Id) rel1[relPlanDoctors.sourceColumnId] = [doc1Id]
      if (relPlanMaterials?.sourceColumnId) {
        rel1[relPlanMaterials.sourceColumnId] = [matMap.kompozit, matMap.bond].filter((v): v is string => Boolean(v))
      }

      const plan1 = await createDynamicRow(treatmentPlansTable.id, {
        values: {
          [tpTitleCol]: 'Tedavi Planı — Diş #36 Kompozit Dolgu',
          ...(tpTargetCol ? { [tpTargetCol]: 'Diş #36' } : {}),
          ...(tpSurfacesCol ? { [tpSurfacesCol]: ['okluzal', 'mezial'] } : {}),
          ...(tpLayersCol ? { [tpLayersCol]: ['mine', 'pulpa'] } : {}),
          ...(tpModeCol ? { [tpModeCol]: '2d_anatomik' } : {}),
          ...(colBasePrice?.id ? { [colBasePrice.id]: 2200 } : {}),
          ...(colMatExtra?.id ? { [colMatExtra.id]: 300 } : {}),
          ...(colDiscountPct?.id ? { [colDiscountPct.id]: 10 } : {}),
          ...(colDiscountFixed?.id ? { [colDiscountFixed.id]: 0 } : {}),
          ...(colNetTotal?.id ? { [colNetTotal.id]: 2250 } : {}),
          ...(colPlanStatus?.id ? { [colPlanStatus.id]: 'devam_ediyor' } : {}),
          ...(colTdbReminder?.id ? { [colTdbReminder.id]: ['180g'] } : {}),
          ...(colNotifChannels?.id ? { [colNotifChannels.id]: ['sms', 'whatsapp'] } : {}),
          ...(colPlanMedia?.id ? { [colPlanMedia.id]: ['radiology', 'photo'] } : {}),
          ...(colConsultNote?.id
            ? { [colConsultNote.id]: 'Panoramik röntgende #36 mezial-okluzal derin dentin çürüğü izlendi, vitalite pozitif.' }
            : {}),
          ...(colConsentSigned?.id ? { [colConsentSigned.id]: true } : {}),
        },
        relations: rel1,
      })

      // Plan Satırı 2: Diş #46 İmplant (3B Anatomik, CBCT + Özel Gün 45 + %5 ve Manuel İskonto)
      const rel2: Record<string, string[]> = {}
      if (relPlanPatient?.inverseColumnId && pat2Id) rel2[relPlanPatient.inverseColumnId] = [pat2Id]
      if (relPlanIndications?.sourceColumnId && indMap.eksiklik) rel2[relPlanIndications.sourceColumnId] = [indMap.eksiklik]
      if (relPlanTreatment?.inverseColumnId && treatMap.implant) rel2[relPlanTreatment.inverseColumnId] = [treatMap.implant]
      if (relPlanDoctors?.sourceColumnId && doc2Id) rel2[relPlanDoctors.sourceColumnId] = [doc2Id]
      if (relPlanMaterials?.sourceColumnId) {
        rel2[relPlanMaterials.sourceColumnId] = [matMap.implant, matMap.sutur, matMap.anestezi].filter(
          (v): v is string => Boolean(v)
        )
      }

      const plan2 = await createDynamicRow(treatmentPlansTable.id, {
        values: {
          [tpTitleCol]: 'Tedavi Planı — Diş #46 İmplant (Yerli)',
          ...(tpTargetCol ? { [tpTargetCol]: 'Diş #46' } : {}),
          ...(tpSurfacesCol ? { [tpSurfacesCol]: ['okluzal', 'bukkal'] } : {}),
          ...(tpLayersCol ? { [tpLayersCol]: ['kok_kanali'] } : {}),
          ...(tpModeCol ? { [tpModeCol]: '3d_anatomik' } : {}),
          ...(colBasePrice?.id ? { [colBasePrice.id]: 14500 } : {}),
          ...(colMatExtra?.id ? { [colMatExtra.id]: 100 } : {}),
          ...(colDiscountPct?.id ? { [colDiscountPct.id]: 5 } : {}),
          ...(colDiscountFixed?.id ? { [colDiscountFixed.id]: 370 } : {}),
          ...(colNetTotal?.id ? { [colNetTotal.id]: 13500 } : {}),
          ...(colPlanStatus?.id ? { [colPlanStatus.id]: 'planlandi' } : {}),
          ...(colTdbReminder?.id ? { [colTdbReminder.id]: ['7g', '90g'] } : {}),
          ...(colCustomDays?.id ? { [colCustomDays.id]: 45 } : {}),
          ...(colNotifChannels?.id ? { [colNotifChannels.id]: ['sms', 'email'] } : {}),
          ...(colPlanMedia?.id ? { [colPlanMedia.id]: ['radiology', 'cbct'] } : {}),
          ...(colConsultNote?.id
            ? { [colConsultNote.id]: '3B CBCT kesitinde mandibuler kemik hacmi yeterli, 7. gün dikiş kontrolü planlandı.' }
            : {}),
          ...(colConsentSigned?.id ? { [colConsentSigned.id]: true } : {}),
        },
        relations: rel2,
      })

      // Plan Satırı 3: Tüm Ağız Detartraj (Tamamlandı + 6 Ay Rutin TDB Kontrol)
      const rel3: Record<string, string[]> = {}
      if (relPlanPatient?.inverseColumnId && pat3Id) rel3[relPlanPatient.inverseColumnId] = [pat3Id]
      if (relPlanIndications?.sourceColumnId && indMap.distasi) rel3[relPlanIndications.sourceColumnId] = [indMap.distasi]
      if (relPlanTreatment?.inverseColumnId && treatMap.detartraj) rel3[relPlanTreatment.inverseColumnId] = [treatMap.detartraj]
      if (relPlanDoctors?.sourceColumnId && doc3Id) rel3[relPlanDoctors.sourceColumnId] = [doc3Id]

      const plan3 = await createDynamicRow(treatmentPlansTable.id, {
        values: {
          [tpTitleCol]: 'Tedavi Planı — Tüm Ağız Detartraj',
          ...(tpTargetCol ? { [tpTargetCol]: 'Tüm Ağız' } : {}),
          ...(tpSurfacesCol ? { [tpSurfacesCol]: ['bukkal', 'lingual'] } : {}),
          ...(tpLayersCol ? { [tpLayersCol]: ['mine'] } : {}),
          ...(tpModeCol ? { [tpModeCol]: '2d_chart' } : {}),
          ...(colBasePrice?.id ? { [colBasePrice.id]: 2500 } : {}),
          ...(colMatExtra?.id ? { [colMatExtra.id]: 0 } : {}),
          ...(colDiscountPct?.id ? { [colDiscountPct.id]: 0 } : {}),
          ...(colDiscountFixed?.id ? { [colDiscountFixed.id]: 0 } : {}),
          ...(colNetTotal?.id ? { [colNetTotal.id]: 2500 } : {}),
          ...(colPlanStatus?.id ? { [colPlanStatus.id]: 'tamamlandi' } : {}),
          ...(colTdbReminder?.id ? { [colTdbReminder.id]: ['180g'] } : {}),
          ...(colNotifChannels?.id ? { [colNotifChannels.id]: ['whatsapp'] } : {}),
          ...(colPlanMedia?.id ? { [colPlanMedia.id]: ['photo'] } : {}),
          ...(colConsultNote?.id
            ? { [colConsultNote.id]: 'Alt ve üst çene supragingival diş taşı temizliği tamamlandı, 6 ay sonra rutin kontrol.' }
            : {}),
          ...(colConsentSigned?.id ? { [colConsentSigned.id]: true } : {}),
        },
        relations: rel3,
      })

      await seedSectorFinanceAndStockTables({
        canvasStartX: 1320,
        personTable: {
          id: patients.id,
          sampleRowIds: [pat1Id, pat2Id, pat3Id].filter((v): v is string => Boolean(v)),
          relationLabel: 'Hasta',
          inverseLabel: 'Tahsilat & Ödemeleri',
        },
        serviceTable: {
          id: treatmentPlansTable.id,
          sampleRowIds: [plan1.id, plan2.id, plan3.id],
          relationLabel: 'İlgili Tedavi Planı',
          inverseLabel: 'Alınan Tahsilatlar',
        },
        existingInventoryTable: {
          id: materials.id,
          sampleRowIds: Object.values(matMap),
        },
        income: {
          tableName: 'Hasta Tahsilatları',
          categories: [
            { id: 'tedavi_tahsilat', label: 'Tedavi Tahsilatı', color: '#15803d' },
            { id: 'on_odeme', label: 'İmplant / Protez Ön Ödeme', color: '#0284c7' },
            { id: 'taksit_odeme', label: 'Taksit Tahsilatı', color: '#2563eb' },
            { id: 'muayene', label: 'Muayene & Radyoloji', color: '#0d9488' },
          ],
          samples: [
            {
              title: 'Ayşe Demir — Diş #36 Dolgu Tahsilatı',
              amount: 2250,
              status: 'tamamlandi',
              method: 'kredi_karti',
              category: 'tedavi_tahsilat',
              daysOffset: -1,
              personIdx: 0,
              serviceIdx: 0,
              notes: 'POS tek çekim ödendi',
            },
            {
              title: 'Zeynep Çelik — Tüm Ağız Detartraj',
              amount: 2500,
              status: 'tamamlandi',
              method: 'nakit',
              category: 'tedavi_tahsilat',
              daysOffset: -4,
              personIdx: 2,
              serviceIdx: 2,
            },
            {
              title: 'Mehmet Kaya — Diş #46 İmplant Planlanan Ödeme',
              amount: 13500,
              status: 'bekliyor',
              method: 'taksit_senet',
              category: 'on_odeme',
              daysOffset: 0,
              dueDaysOffset: 14,
              personIdx: 1,
              serviceIdx: 1,
              notes: 'Cerrahi seans günü tahsil edilecek',
            },
          ],
        },
        expense: {
          tableName: 'Klinik Giderleri',
          categories: [
            { id: 'malzeme_alim', label: 'Medikal & Sarf Malzeme', color: '#0284c7' },
            { id: 'laboratuvar', label: 'Protez Laboratuvar Ödemesi', color: '#2563eb' },
            { id: 'cihaz_bakim', label: 'Cihaz Bakım & Kalibrasyon', color: '#0d9488' },
            { id: 'klinik_sabit', label: 'Kira, Fatura & Genel Gider', color: '#d97706' },
          ],
          samples: [
            {
              title: 'Zirkonyum Laboratuvar Aylık Hakediş',
              category: 'laboratuvar',
              qty: 1,
              unitCost: 8400,
              daysOffset: -6,
              notes: 'Anlaşmalı dental laboratuvar',
            },
            {
              title: 'Sterilizasyon Poşeti & Sarf Alımı',
              category: 'malzeme_alim',
              qty: 5,
              unitCost: 420,
              daysOffset: -2,
            },
          ],
        },
        maintenance: {
          tableName: 'Cihaz & Periyodik Bakımlar',
          types: [
            { id: 'sterilizasyon', label: 'Otoklav & Sterilizasyon Testi', color: '#0284c7' },
            { id: 'radyoloji', label: 'Panoramik / CBCT Kalibrasyon', color: '#2563eb' },
            { id: 'unit_kompresor', label: 'Ünit & Kompresör Bakımı', color: '#0d9488' },
          ],
          samples: [
            {
              name: 'B Sınıfı Otoklav Vakum & Biyolojik Kontrol',
              type: 'sterilizasyon',
              isPeriodic: true,
              periodicDays: 90,
              scheduledDaysOffset: 5,
              nextDaysOffset: 5,
              cost: 2400,
              status: 'planlandi',
              notes: '3 aylık periyodik validasyon yaklaşıyor',
            },
            {
              name: 'Panoramik Röntgen Dozimetri & Kalibrasyon',
              type: 'radyoloji',
              isPeriodic: true,
              periodicDays: 365,
              scheduledDaysOffset: -30,
              nextDaysOffset: 335,
              cost: 4800,
              status: 'tamamlandi',
              notes: 'NDK standartlarına uygun tamamlandı',
            },
          ],
        },
      })
    }

    return getStudioSchema()
  }

  if (blueprint === 'vehicle_service') {
    const customers = await createDynamicTable({
      name: 'Müşteriler',
      icon: 'users',
      color: '#0284c7',
      canvasX: 430,
      canvasY: 60,
      initialColumns: [
        { name: 'Ad Soyad', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 200 },
        { name: 'Telefon', fieldType: 'phone', isRequired: false, width: 170 },
        {
          name: 'Müşteri Tipi',
          fieldType: 'select',
          width: 150,
          config: {
            options: [
              { id: 'bireysel', label: 'Bireysel', color: '#0284c7' },
              { id: 'kurumsal', label: 'Kurumsal', color: '#15803d' },
            ],
          },
        },
      ],
    })
    const services = await createDynamicTable({
      name: 'Servis İşlemleri',
      icon: 'layers',
      color: '#2563eb',
      canvasX: 430,
      canvasY: 360,
      initialColumns: [
        { name: 'İşlem Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 210 },
        { name: 'Ücret', fieldType: 'currency', width: 150 },
      ],
    })
    const vehicles = await createDynamicTable({
      name: 'Araç & Cihazlar',
      icon: 'car',
      color: '#15803d',
      canvasX: 50,
      canvasY: 360,
      initialColumns: [
        { name: 'Plaka / Seri No', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 160 },
        { name: 'Marka / Model', fieldType: 'text', width: 200 },
      ],
    })
    const relVeh = await createDynamicRelation({
      sourceTableId: services.id,
      targetTableId: vehicles.id,
      sourceColumnName: 'İlgili Araç / Cihaz',
      inverseColumnName: 'Yapılan İşlemler',
      createInverseColumn: true,
      cardinality: 'many_to_many',
    })
    await upsertAppointmentConfig({
      tableId: customers.id,
      enabled: true,
      allowMultiple: false,
      includeRelatedTables: true,
      isRequiredInAppointment: true,
    })
    await upsertAppointmentConfig({
      tableId: services.id,
      enabled: true,
      allowMultiple: true,
      includeRelatedTables: true,
      isRequiredInAppointment: false,
    })
    await updateStudioSettings({ appointmentNodePosition: { x: 830, y: 120 } })

    const cName = customers.columns[0]?.id
    const cSampleIds: string[] = []
    if (cName) {
      const c1 = await createDynamicRow(customers.id, { values: { [cName]: 'Burak Yılmaz' } })
      const c2 = await createDynamicRow(customers.id, { values: { [cName]: 'Kuzey Filo A.Ş.' } })
      cSampleIds.push(c1.id, c2.id)
    }
    const vPlate = vehicles.columns[0]?.id
    const vModel = vehicles.columns[1]?.id
    let v1Id: string | null = null
    if (vPlate) {
      const v1 = await createDynamicRow(vehicles.id, {
        values: { [vPlate]: '34 KLM 908', ...(vModel ? { [vModel]: 'Volkswagen Passat' } : {}) },
      })
      await createDynamicRow(vehicles.id, {
        values: { [vPlate]: '06 TRK 214', ...(vModel ? { [vModel]: 'Renault Megane' } : {}) },
      })
      v1Id = v1.id
    }
    const sName = services.columns[0]?.id
    const sFee = services.columns[1]?.id
    const sSampleIds: string[] = []
    if (sName) {
      const sv1 = await createDynamicRow(services.id, {
        values: { [sName]: 'Periyodik Bakım (15.000 km)', ...(sFee ? { [sFee]: 6800 } : {}) },
        relations: relVeh?.sourceColumnId && v1Id ? { [relVeh.sourceColumnId]: [v1Id] } : {},
      })
      const sv2 = await createDynamicRow(services.id, {
        values: { [sName]: 'Fren Balata Değişimi', ...(sFee ? { [sFee]: 3900 } : {}) },
      })
      sSampleIds.push(sv1.id, sv2.id)
    }

    await seedSectorFinanceAndStockTables({
      canvasStartX: 1180,
      personTable: {
        id: customers.id,
        sampleRowIds: cSampleIds,
        relationLabel: 'Müşteri',
        inverseLabel: 'Servis Ödemeleri',
      },
      serviceTable: {
        id: services.id,
        sampleRowIds: sSampleIds,
        relationLabel: 'İlgili Servis İşlemi',
        inverseLabel: 'Tahsilatlar',
      },
      income: {
        tableName: 'Servis Tahsilatları',
        categories: [
          { id: 'iscilik_bakim', label: 'Periyodik Bakım & İşçilik', color: '#15803d' },
          { id: 'yedek_parca', label: 'Yedek Parça Satışı', color: '#0284c7' },
          { id: 'filo_cari', label: 'Kurumsal Filo Hakedişi', color: '#2563eb' },
        ],
        samples: [
          {
            title: '34 KLM 908 15.000 KM Bakım Tahsilatı',
            amount: 6800,
            status: 'tamamlandi',
            method: 'kredi_karti',
            category: 'iscilik_bakim',
            daysOffset: -1,
            personIdx: 0,
            serviceIdx: 0,
          },
          {
            title: 'Kuzey Filo Fren Balata Değişim Faturası',
            amount: 3900,
            status: 'bekliyor',
            method: 'havale_eft',
            category: 'filo_cari',
            daysOffset: 0,
            dueDaysOffset: 15,
            personIdx: 1,
            serviceIdx: 1,
          },
        ],
      },
      expense: {
        tableName: 'Atölye & Parça Giderleri',
        categories: [
          { id: 'parca_tedarik', label: 'Yedek Parça & Yağ Tedarik', color: '#2563eb' },
          { id: 'atolye_gider', label: 'Atölye Kira & Enerji', color: '#0284c7' },
        ],
        samples: [
          {
            title: 'Motor Yağı & Filtre Toptan Alımı',
            category: 'parca_tedarik',
            qty: 1,
            unitCost: 9200,
            daysOffset: -4,
          },
        ],
      },
      inventory: {
        tableName: 'Yedek Parça & Sarf Stoku',
        categories: [
          { id: 'fren_suspansiyon', label: 'Fren & Süspansiyon', color: '#2563eb' },
          { id: 'filtre_yag', label: 'Motor Yağı & Filtre', color: '#0284c7' },
          { id: 'sarf_kimyasal', label: 'Balata Spreyi & Sarf', color: '#15803d' },
        ],
        samples: [
          {
            name: 'Ön Fren Balata Takımı (OEM)',
            category: 'fren_suspansiyon',
            unit: 'set',
            qty: 3,
            minThreshold: 5,
            unitCost: 1450,
            notes: 'Kritik stok altı',
          },
          {
            name: '5W-30 Tam Sentetik Motor Yağı (4L)',
            category: 'filtre_yag',
            unit: 'adet',
            qty: 18,
            minThreshold: 6,
            unitCost: 1150,
          },
        ],
      },
      maintenance: {
        tableName: 'Atölye Lift & Cihaz Bakımları',
        types: [
          { id: 'lift_hidrolik', label: 'Hidrolik Lift Güvenlik Kontrolü', color: '#0284c7' },
          { id: 'ariza_cihaz', label: 'Diyagnostik Cihaz & Lisans', color: '#2563eb' },
        ],
        samples: [
          {
            name: '2 Sütunlu Araç Kaldırma Lifti Periyodik Muayene',
            type: 'lift_hidrolik',
            isPeriodic: true,
            periodicDays: 180,
            scheduledDaysOffset: 9,
            nextDaysOffset: 9,
            cost: 3200,
            status: 'planlandi',
          },
        ],
      },
    })
    return getStudioSchema()
  }

  if (blueprint === 'consultant_sessions') {
    const clients = await createDynamicTable({
      name: 'Danışanlar',
      icon: 'user-check',
      color: '#0284c7',
      canvasX: 430,
      canvasY: 60,
      initialColumns: [
        { name: 'Danışan Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 210 },
        { name: 'Telefon', fieldType: 'phone', width: 170 },
      ],
    })
    const packages = await createDynamicTable({
      name: 'Paketler & Programlar',
      icon: 'layers',
      color: '#2563eb',
      canvasX: 430,
      canvasY: 360,
      initialColumns: [
        { name: 'Program Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 210 },
        { name: 'Seans Sayısı', fieldType: 'number', width: 130 },
        { name: 'Paket Ücreti', fieldType: 'currency', width: 150 },
      ],
    })
    await createDynamicRelation({
      sourceTableId: clients.id,
      targetTableId: packages.id,
      sourceColumnName: 'Aldığı Paketler',
      inverseColumnName: 'Kayıtlı Danışanlar',
      createInverseColumn: true,
      cardinality: 'many_to_many',
    })
    await upsertAppointmentConfig({
      tableId: clients.id,
      enabled: true,
      allowMultiple: false,
      includeRelatedTables: true,
      isRequiredInAppointment: true,
    })
    await upsertAppointmentConfig({
      tableId: packages.id,
      enabled: true,
      allowMultiple: true,
      includeRelatedTables: true,
      isRequiredInAppointment: false,
    })
    await updateStudioSettings({ appointmentNodePosition: { x: 830, y: 120 } })

    const clName = clients.columns[0]?.id
    const clIds: string[] = []
    if (clName) {
      const cl1 = await createDynamicRow(clients.id, { values: { [clName]: 'Deniz Aksoy' } })
      const cl2 = await createDynamicRow(clients.id, { values: { [clName]: 'Emre Koç' } })
      clIds.push(cl1.id, cl2.id)
    }
    const pkName = packages.columns[0]?.id
    const pkFee = packages.columns[2]?.id
    const pkIds: string[] = []
    if (pkName) {
      const p1 = await createDynamicRow(packages.id, {
        values: { [pkName]: '8 Seans Birebir Danışmanlık', ...(pkFee ? { [pkFee]: 12000 } : {}) },
      })
      const p2 = await createDynamicRow(packages.id, {
        values: { [pkName]: 'Kurumsal Strateji Paketi', ...(pkFee ? { [pkFee]: 24000 } : {}) },
      })
      pkIds.push(p1.id, p2.id)
    }

    await seedSectorFinanceAndStockTables({
      canvasStartX: 1180,
      personTable: {
        id: clients.id,
        sampleRowIds: clIds,
        relationLabel: 'Danışan',
        inverseLabel: 'Paket Ödemeleri',
      },
      serviceTable: {
        id: packages.id,
        sampleRowIds: pkIds,
        relationLabel: 'İlgili Paket / Program',
        inverseLabel: 'Tahsilatlar',
      },
      income: {
        tableName: 'Seans & Paket Tahsilatları',
        categories: [
          { id: 'bireysel_paket', label: 'Bireysel Paket Ödemesi', color: '#15803d' },
          { id: 'kurumsal_danismanlik', label: 'Kurumsal Danışmanlık', color: '#2563eb' },
          { id: 'tekil_seans', label: 'Tekil Seans Ücreti', color: '#0284c7' },
        ],
        samples: [
          {
            title: 'Deniz Aksoy — 8 Seans Paket Tahsilatı',
            amount: 12000,
            status: 'tamamlandi',
            method: 'kredi_karti',
            category: 'bireysel_paket',
            daysOffset: -2,
            personIdx: 0,
            serviceIdx: 0,
          },
          {
            title: 'Emre Koç — Kurumsal Strateji 2. Taksit',
            amount: 12000,
            status: 'bekliyor',
            method: 'havale_eft',
            category: 'kurumsal_danismanlik',
            daysOffset: 0,
            dueDaysOffset: 12,
            personIdx: 1,
            serviceIdx: 1,
          },
        ],
      },
      expense: {
        tableName: 'Ofis & Platform Giderleri',
        categories: [
          { id: 'dijital_arac', label: 'Online Görüşme & Test Lisansı', color: '#2563eb' },
          { id: 'ofis_gider', label: 'Ofis Kira & İkram', color: '#0284c7' },
        ],
        samples: [
          {
            title: 'Envanter & Değerlendirme Test Kredisi',
            category: 'dijital_arac',
            qty: 1,
            unitCost: 3400,
            daysOffset: -3,
          },
        ],
      },
      inventory: {
        tableName: 'Eğitim Materyali & Ofis Stoku',
        categories: [
          { id: 'calisma_kitapcigi', label: 'Çalışma Kitapçığı & Form', color: '#2563eb' },
          { id: 'ofis_ikram', label: 'Ofis Sarf & İkram', color: '#15803d' },
        ],
        samples: [
          {
            name: 'Danışan Çalışma Rehberi & Defter Seti',
            category: 'calisma_kitapcigi',
            unit: 'set',
            qty: 5,
            minThreshold: 8,
            unitCost: 190,
          },
        ],
      },
      maintenance: {
        tableName: 'Ofis Cihaz & Lisans Yenilemeleri',
        types: [
          { id: 'yazilim_lisans', label: 'Yıllık Platform Lisansı', color: '#2563eb' },
          { id: 'ofis_bakim', label: 'Ofis Klima & Donanım Bakımı', color: '#0284c7' },
        ],
        samples: [
          {
            name: 'Kurumsal Video Konferans Yıllık Yenileme',
            type: 'yazilim_lisans',
            isPeriodic: true,
            periodicDays: 365,
            scheduledDaysOffset: 12,
            nextDaysOffset: 12,
            cost: 4200,
            status: 'planlandi',
          },
        ],
      },
    })
    return getStudioSchema()
  }

  // Default: customer_service
  const customers = await createDynamicTable({
    name: 'Müşteriler',
    icon: 'users',
    color: '#0284c7',
    canvasX: 430,
    canvasY: 60,
    initialColumns: [
      { name: 'Ad Soyad / Ünvan', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 210 },
      { name: 'Telefon', fieldType: 'phone', width: 170 },
      { name: 'E-posta', fieldType: 'email', width: 190 },
    ],
  })
  const orders = await createDynamicTable({
    name: 'Talepler & Hizmetler',
    icon: 'briefcase',
    color: '#2563eb',
    canvasX: 430,
    canvasY: 360,
    initialColumns: [
      { name: 'Talep / Hizmet Başlığı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 210 },
      { name: 'Tutar', fieldType: 'currency', width: 150 },
    ],
  })
  await createDynamicRelation({
    sourceTableId: customers.id,
    targetTableId: orders.id,
    sourceColumnName: 'Talepler',
    inverseColumnName: 'Müşteri',
    createInverseColumn: true,
    cardinality: 'many_to_many',
  })
  await upsertAppointmentConfig({
    tableId: customers.id,
    enabled: true,
    allowMultiple: false,
    includeRelatedTables: true,
    isRequiredInAppointment: true,
  })
  await upsertAppointmentConfig({
    tableId: orders.id,
    enabled: true,
    allowMultiple: true,
    includeRelatedTables: true,
    isRequiredInAppointment: false,
  })
  await updateStudioSettings({ appointmentNodePosition: { x: 830, y: 120 } })

  const cuName = customers.columns[0]?.id
  const cuIds: string[] = []
  if (cuName) {
    const cu1 = await createDynamicRow(customers.id, { values: { [cuName]: 'Selim Aydın' } })
    const cu2 = await createDynamicRow(customers.id, { values: { [cuName]: 'Marmara Grup A.Ş.' } })
    cuIds.push(cu1.id, cu2.id)
  }
  const orName = orders.columns[0]?.id
  const orFee = orders.columns[1]?.id
  const orIds: string[] = []
  if (orName) {
    const o1 = await createDynamicRow(orders.id, {
      values: { [orName]: 'Yıllık Bakım & Destek Sözleşmesi', ...(orFee ? { [orFee]: 18500 } : {}) },
    })
    const o2 = await createDynamicRow(orders.id, {
      values: { [orName]: 'Yerinde Keşif & Kurulum', ...(orFee ? { [orFee]: 4500 } : {}) },
    })
    orIds.push(o1.id, o2.id)
  }

  await seedSectorFinanceAndStockTables({
    canvasStartX: 1180,
    personTable: {
      id: customers.id,
      sampleRowIds: cuIds,
      relationLabel: 'Müşteri',
      inverseLabel: 'Tahsilatlar',
    },
    serviceTable: {
      id: orders.id,
      sampleRowIds: orIds,
      relationLabel: 'İlgili Talep / Hizmet',
      inverseLabel: 'Ödeme Kayıtları',
    },
    income: {
      tableName: 'Tahsilatlar & Gelirler',
      categories: [
        { id: 'hizmet_bedeli', label: 'Hizmet & Kurulum Bedeli', color: '#15803d' },
        { id: 'sozlesme', label: 'Yıllık Sözleşme Tahsilatı', color: '#2563eb' },
        { id: 'urun_satis', label: 'Ürün & Ekipman Satışı', color: '#0284c7' },
      ],
      samples: [
        {
          title: 'Selim Aydın — Yerinde Keşif & Kurulum',
          amount: 4500,
          status: 'tamamlandi',
          method: 'kredi_karti',
          category: 'hizmet_bedeli',
          daysOffset: -2,
          personIdx: 0,
          serviceIdx: 1,
        },
        {
          title: 'Marmara Grup — Yıllık Sözleşme Faturası',
          amount: 18500,
          status: 'bekliyor',
          method: 'havale_eft',
          category: 'sozlesme',
          daysOffset: 0,
          dueDaysOffset: 10,
          personIdx: 1,
          serviceIdx: 0,
        },
      ],
    },
    expense: {
      tableName: 'İşletme Giderleri',
      categories: [
        { id: 'tedarik', label: 'Malzeme & Ürün Alımı', color: '#2563eb' },
        { id: 'operasyon', label: 'Saha, Kargo & Ulaşım', color: '#0284c7' },
        { id: 'sabit', label: 'Kira, Fatura & Genel Gider', color: '#0d9488' },
      ],
      samples: [
        {
          title: 'Aylık Saha Operasyon & Sarf Alımı',
          category: 'tedarik',
          qty: 1,
          unitCost: 5200,
          daysOffset: -4,
        },
      ],
    },
    inventory: {
      tableName: 'Ürün & Malzeme Stoku',
      categories: [
        { id: 'ekipman', label: 'Kurulum Ekipmanı', color: '#2563eb' },
        { id: 'sarf', label: 'Sarf Malzeme', color: '#0284c7' },
      ],
      samples: [
        {
          name: 'Standart Kurulum Bağlantı Kiti',
          category: 'ekipman',
          unit: 'set',
          qty: 4,
          minThreshold: 6,
          unitCost: 680,
          notes: 'Kritik stok altı',
        },
        {
          name: 'Montaj & Kablolama Sarf Paketi',
          category: 'sarf',
          unit: 'paket',
          qty: 20,
          minThreshold: 5,
          unitCost: 220,
        },
      ],
    },
    maintenance: {
      tableName: 'Demirbaş & Periyodik Bakım',
      types: [
        { id: 'cihaz_kalibrasyon', label: 'Ölçüm & Cihaz Kalibrasyonu', color: '#0284c7' },
        { id: 'arac_ekipman', label: 'Saha Aracı & Ekipman Bakımı', color: '#2563eb' },
      ],
      samples: [
        {
          name: 'Saha Test Cihazı Yıllık Kalibrasyonu',
          type: 'cihaz_kalibrasyon',
          isPeriodic: true,
          periodicDays: 365,
          scheduledDaysOffset: 8,
          nextDaysOffset: 8,
          cost: 2600,
          status: 'planlandi',
        },
      ],
    },
  })
  return getStudioSchema()
}

export async function applyStarterBlueprint(blueprint: StarterBlueprintKey) {
  const clinicId = requireClinicId()
  await applyStarterBlueprintInternal(blueprint)
  await db
    .update(dynamicTables)
    .set({ origin: 'template' })
    .where(and(eq(dynamicTables.clinicId, clinicId), ne(dynamicTables.origin, 'system')))
  const schema = await getStudioSchema()
  await syncClinicFlowsWithDynamicTables(clinicId, { forceRebuild: true }).catch((err) => {
    console.warn('[applyStarterBlueprint] Akış senkronizasyonu atlandı:', err)
  })
  return schema
}

export function buildFlowDynamicFieldKey(tableSlugOrName: string, columnSlugOrName: string): string {
  const t = slugifyTr(tableSlugOrName, 'tablo')
  const c = slugifyTr(columnSlugOrName, 'alan')
  return `${t}__${c}`
}

export function buildFlowDynamicTableExistsKey(tableSlugOrName: string): string {
  const t = slugifyTr(tableSlugOrName, 'tablo')
  return `${t}____kayitli`
}

function isPhoneLikeDynamicColumn(col: { fieldType: string; slug: string; name: string }): boolean {
  return (
    col.fieldType === 'phone' ||
    /^(telefon|tel|gsm|cep|phone|numara)/i.test(col.slug) ||
    /(telefon|gsm|cep)/i.test(col.name.toLocaleLowerCase('tr-TR'))
  )
}

async function loadLinkedTitlesForRows(
  clinicId: string,
  matchedRows: Array<{
    row: typeof dynamicRows.$inferSelect
    table: typeof dynamicTables.$inferSelect
    tCols: Array<typeof dynamicColumns.$inferSelect>
  }>,
): Promise<Map<string, Record<string, string[]>>> {
  const linkedTitlesByRowAndCol = new Map<string, Record<string, string[]>>()
  const hasAnyRelationCol = matchedRows.some(({ tCols }) => tCols.some(c => c.fieldType === 'relation'))
  if (!hasAnyRelationCol || matchedRows.length === 0) return linkedTitlesByRowAndCol

  const matchedRowIds = matchedRows.map(m => m.row.id)
  const matchedTableIds = Array.from(new Set(matchedRows.map(m => m.table.id)))
  const tableRelations = await db
    .select()
    .from(dynamicRelations)
    .where(
      and(
        eq(dynamicRelations.clinicId, clinicId),
        or(
          inArray(dynamicRelations.sourceTableId, matchedTableIds),
          inArray(dynamicRelations.targetTableId, matchedTableIds),
        ),
      ),
    )

  if (tableRelations.length === 0) return linkedTitlesByRowAndCol

  const [forwardLinks, inverseLinks] = await Promise.all([
    tableRelations.some(r => matchedTableIds.includes(r.sourceTableId))
      ? db
          .select({
            relationId: dynamicRowLinks.relationId,
            sourceRowId: dynamicRowLinks.sourceRowId,
            targetTitle: dynamicRows.displayTitle,
          })
          .from(dynamicRowLinks)
          .innerJoin(dynamicRows, eq(dynamicRows.id, dynamicRowLinks.targetRowId))
          .where(
            and(
              eq(dynamicRowLinks.clinicId, clinicId),
              inArray(dynamicRowLinks.sourceRowId, matchedRowIds),
              eq(dynamicRows.isArchived, false),
            ),
          )
          .orderBy(asc(dynamicRowLinks.createdAt), asc(dynamicRows.createdAt), asc(dynamicRows.displayTitle))
      : Promise.resolve([]),
    tableRelations.some(r => matchedTableIds.includes(r.targetTableId) && Boolean(r.inverseColumnId))
      ? db
          .select({
            relationId: dynamicRowLinks.relationId,
            targetRowId: dynamicRowLinks.targetRowId,
            sourceTitle: dynamicRows.displayTitle,
          })
          .from(dynamicRowLinks)
          .innerJoin(dynamicRows, eq(dynamicRows.id, dynamicRowLinks.sourceRowId))
          .where(
            and(
              eq(dynamicRowLinks.clinicId, clinicId),
              inArray(dynamicRowLinks.targetRowId, matchedRowIds),
              eq(dynamicRows.isArchived, false),
            ),
          )
          .orderBy(asc(dynamicRowLinks.createdAt), asc(dynamicRows.createdAt), asc(dynamicRows.displayTitle))
      : Promise.resolve([]),
  ])

  const relById = new Map(tableRelations.map(r => [r.id, r]))
  for (const fl of forwardLinks) {
    const rel = relById.get(fl.relationId)
    const title = String(fl.targetTitle || '').trim()
    if (!rel || !title) continue
    const rowMap = linkedTitlesByRowAndCol.get(fl.sourceRowId) ?? {}
    const list = rowMap[rel.sourceColumnId] ?? []
    if (!list.includes(title)) list.push(title)
    rowMap[rel.sourceColumnId] = list
    linkedTitlesByRowAndCol.set(fl.sourceRowId, rowMap)
  }
  for (const il of inverseLinks) {
    const rel = relById.get(il.relationId)
    const title = String(il.sourceTitle || '').trim()
    if (!rel?.inverseColumnId || !title) continue
    const rowMap = linkedTitlesByRowAndCol.get(il.targetRowId) ?? {}
    const list = rowMap[rel.inverseColumnId] ?? []
    if (!list.includes(title)) list.push(title)
    rowMap[rel.inverseColumnId] = list
    linkedTitlesByRowAndCol.set(il.targetRowId, rowMap)
  }

  return linkedTitlesByRowAndCol
}

function extractReadableRowFields(params: {
  table: typeof dynamicTables.$inferSelect
  columns: Array<typeof dynamicColumns.$inferSelect>
  row: typeof dynamicRows.$inferSelect
  linkedTitlesByRowAndCol?: Map<string, Record<string, string[]>>
}): {
  fieldPatch: Record<string, unknown>
  readableRecord: Record<string, unknown>
  tablePairs: string[]
} {
  const { table, columns, row, linkedTitlesByRowAndCol } = params
  const rowVals = (row.values ?? {}) as Record<string, unknown>
  const fieldPatch: Record<string, unknown> = {}
  const readableRecord: Record<string, unknown> = {}
  const tablePairs: string[] = []

  const existsKey = buildFlowDynamicTableExistsKey(table.slug || table.name)
  fieldPatch[existsKey] = 'true'
  fieldPatch[`_tbl_exists__${table.id}`] = 'true'

  for (const col of columns) {
    const key = buildFlowDynamicFieldKey(table.slug || table.name, col.slug || col.name)
    const cfg = (col.config || {}) as DynamicColumnConfig

    if (col.fieldType === 'relation') {
      const linkedTitles = (linkedTitlesByRowAndCol?.get(row.id)?.[col.id] ?? []).filter(Boolean)
      if (linkedTitles.length === 0) continue
      const isMulti = Boolean(cfg.allowMultiple) || linkedTitles.length > 1
      const resolvedRelVal: unknown = isMulti ? linkedTitles : linkedTitles[0]
      const readableRelVal = linkedTitles.join(', ')
      fieldPatch[key] = resolvedRelVal
      fieldPatch[`_col__${col.id}`] = resolvedRelVal
      readableRecord[col.name] = resolvedRelVal
      tablePairs.push(`${col.name}: ${readableRelVal}`)
      continue
    }

    const rawCell = rowVals[col.id]
    if (rawCell === null || rawCell === undefined || rawCell === '') continue
    const opts = Array.isArray(cfg.options) ? cfg.options : []

    let resolvedValue: unknown
    let readableValue = ''
    if (col.fieldType === 'select') {
      const found = opts.find(o => o.id === rawCell || o.label === rawCell)
      resolvedValue = found ? found.label : String(rawCell)
      readableValue = String(resolvedValue)
    } else if (col.fieldType === 'multiselect') {
      const arr = Array.isArray(rawCell) ? rawCell : [rawCell]
      const labels = arr
        .map(item => opts.find(o => o.id === item || o.label === item)?.label ?? String(item ?? '').trim())
        .filter(Boolean)
      if (labels.length > 0) {
        resolvedValue = labels
        readableValue = labels.join(', ')
      }
    } else if (col.fieldType === 'boolean') {
      const boolStr =
        rawCell === true || rawCell === 'true' || rawCell === 1 || rawCell === '1' ? 'true' : 'false'
      resolvedValue = boolStr
      readableValue = boolStr === 'true' ? 'Evet' : 'Hayır'
    } else {
      resolvedValue = String(rawCell)
      readableValue = String(rawCell)
    }

    if (resolvedValue !== undefined) {
      fieldPatch[key] = resolvedValue
      fieldPatch[`_col__${col.id}`] = resolvedValue
      readableRecord[col.name] = readableValue || resolvedValue
      if (readableValue) {
        tablePairs.push(`${col.name}: ${readableValue}`)
      }
    }
  }

  return { fieldPatch, readableRecord, tablePairs }
}

/**
 * Arayan veya WhatsApp'tan yazan numaranın kliniğe ait dinamik tablolardaki
 * aktif kayıtlarını bularak `<tabloSlug>__<sutunSlug>` ve tablo bazlı
 * `<tabloSlug>____kayitli` ("Bu tabloda kayıtlı mı?") anahtarlarıyla döndürür.
 */
export async function lookupDynamicFieldsByPhone(
  phone: string,
  explicitClinicId?: string,
): Promise<Record<string, unknown>> {
  try {
    const clinicId = explicitClinicId || (() => {
      try { return requireClinicId() } catch { return '' }
    })()
    if (!clinicId || clinicId === 'memory') return {}

    const digits = String(phone || '').replace(/\D/g, '').slice(-10)
    if (digits.length < 10) return {}

    await ensureDynamicTablesSchema()

    const [tables, cols] = await Promise.all([
      db.select().from(dynamicTables).where(eq(dynamicTables.clinicId, clinicId)),
      db.select().from(dynamicColumns).where(eq(dynamicColumns.clinicId, clinicId)).orderBy(asc(dynamicColumns.sortOrder)),
    ])
    if (tables.length === 0) return {}

    const hydrated: Record<string, unknown> = {}
    for (const table of tables) {
      hydrated[buildFlowDynamicTableExistsKey(table.slug || table.name)] = 'false'
      hydrated[`_tbl_exists__${table.id}`] = 'false'
    }
    if (cols.length === 0) return hydrated

    const colsByTable = new Map<string, Array<typeof dynamicColumns.$inferSelect>>()
    for (const c of cols) {
      const list = colsByTable.get(c.tableId) ?? []
      list.push(c)
      colsByTable.set(c.tableId, list)
    }

    const phoneCols = cols.filter(isPhoneLikeDynamicColumn)
    if (phoneCols.length === 0) return hydrated

    const candidateTableIds = Array.from(new Set(phoneCols.map(c => c.tableId)))
    const candidateTables = tables.filter(t => candidateTableIds.includes(t.id))
    if (candidateTables.length === 0) return hydrated

    const phoneMatchPredicate = or(
      ...phoneCols.map(
        col => sql`right(regexp_replace(coalesce(${dynamicRows.values} ->> ${col.id}, ''), '[^0-9]', '', 'g'), 10) = ${digits}`,
      ),
    )
    if (!phoneMatchPredicate) return hydrated

    const rows = await db
      .select()
      .from(dynamicRows)
      .where(
        and(
          eq(dynamicRows.clinicId, clinicId),
          inArray(dynamicRows.tableId, candidateTables.map(t => t.id)),
          eq(dynamicRows.isArchived, false),
          phoneMatchPredicate,
        ),
      )
      .orderBy(desc(dynamicRows.updatedAt), desc(dynamicRows.createdAt))
      .limit(50)

    if (rows.length === 0) return hydrated

    const summaryLines: string[] = []
    const tableById = new Map(candidateTables.map(t => [t.id, t]))
    const visitedTableIds = new Set<string>()
    const matchedRows: Array<{
      row: typeof dynamicRows.$inferSelect
      table: typeof dynamicTables.$inferSelect
      tCols: Array<typeof dynamicColumns.$inferSelect>
    }> = []

    for (const row of rows) {
      if (visitedTableIds.has(row.tableId)) continue
      const table = tableById.get(row.tableId)
      if (!table) continue
      const tCols = colsByTable.get(table.id) ?? []
      const rowVals = (row.values ?? {}) as Record<string, unknown>

      const phoneMatches = tCols.some(col => {
        if (!isPhoneLikeDynamicColumn(col)) return false
        const cellDigits = String(rowVals[col.id] ?? '').replace(/\D/g, '').slice(-10)
        return cellDigits.length === 10 && cellDigits === digits
      })
      if (!phoneMatches) continue

      visitedTableIds.add(table.id)
      matchedRows.push({ row, table, tCols })
    }

    if (matchedRows.length === 0) return hydrated

    const linkedTitlesByRowAndCol = await loadLinkedTitlesForRows(clinicId, matchedRows)

    for (const { row, table, tCols } of matchedRows) {
      if (/(musteri|müşteri|hasta|danisan|danışan|kisi|kişi|rehber|uye|üye|alici|alıcı|kiraci|kiracı|sigortali|sigortalı|sahip)/i.test(`${table.name} ${table.slug}`)) {
        hydrated._dynamicKnownCaller = 'true'
        if (row.displayTitle && row.displayTitle !== 'İsimsiz Kayıt' && !hydrated._dynamicCallerName) {
          hydrated._dynamicCallerName = row.displayTitle
        }
      }

      const { fieldPatch, tablePairs } = extractReadableRowFields({
        table,
        columns: tCols,
        row,
        linkedTitlesByRowAndCol,
      })
      Object.assign(hydrated, fieldPatch)

      if (tablePairs.length > 0) {
        summaryLines.push(`- [${table.name}] ${tablePairs.join(' | ')}`)
      }
    }

    if (summaryLines.length > 0) {
      hydrated._dynamicSummary = summaryLines.join('\n')
    }

    return hydrated
  } catch (err) {
    console.warn('[lookupDynamicFieldsByPhone] Dinamik tablo sorgusu atlandı:', err)
    return {}
  }
}

function collectConditionLeafRules(node: FlowNode): FlowConditionRule[] {
  const out: FlowConditionRule[] = []
  const visit = (item: FlowConditionRule | FlowConditionGroup) => {
    if ('logic' in item && Array.isArray((item as FlowConditionGroup).rules)) {
      ;(item as FlowConditionGroup).rules.forEach(visit)
      return
    }
    out.push(item as FlowConditionRule)
  }
  if (Array.isArray(node.data.rules) && node.data.rules.length > 0) {
    node.data.rules.forEach(visit)
  } else if (node.data.conditionGroup && Array.isArray(node.data.conditionGroup.rules) && node.data.conditionGroup.rules.length > 0) {
    node.data.conditionGroup.rules.forEach(visit)
  } else if (node.data.conditionField) {
    out.push({
      field: String(node.data.conditionField || ''),
      operator: (node.data.operator || 'equals') as FlowConditionRule['operator'],
      value: node.data.conditionValue,
      valueTo: node.data.conditionValueTo,
      fieldLabel: node.data.conditionFieldLabel,
      sourceTableId: node.data.sourceTableId,
      sourceTableSlug: node.data.sourceTableSlug,
      sourceTableName: node.data.sourceTableName,
      sourceColumnId: node.data.sourceColumnId,
      sourceColumnSlug: node.data.sourceColumnSlug,
      sourceColumnName: node.data.sourceColumnName,
      sourceColumnType: node.data.sourceColumnType,
    })
  }
  return out
}

function extractReadableCandidateStrings(rawCell: unknown, col: typeof dynamicColumns.$inferSelect): string[] {
  if (rawCell === null || rawCell === undefined) return []
  const cfg = (col.config || {}) as DynamicColumnConfig
  const opts = Array.isArray(cfg.options) ? cfg.options : []
  const values = Array.isArray(rawCell) ? rawCell : [rawCell]
  const out: string[] = []
  for (const item of values) {
    const rawStr = String(item ?? '').trim()
    if (!rawStr) continue
    out.push(rawStr.toLocaleLowerCase('tr-TR'))
    if (col.fieldType === 'select' || col.fieldType === 'multiselect') {
      const matchedOpt = opts.find(o => o.id === rawStr || o.label.toLocaleLowerCase('tr-TR') === rawStr.toLocaleLowerCase('tr-TR'))
      if (matchedOpt) {
        out.push(matchedOpt.id.toLocaleLowerCase('tr-TR'))
        out.push(matchedOpt.label.toLocaleLowerCase('tr-TR'))
      }
    }
  }
  return Array.from(new Set(out))
}

function foldTurkishAscii(input: string): string {
  return String(input || '')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'u')
    .toLowerCase()
}

function buildUrlSqlPatterns(urlParts: ParsedUrlLookupParts): string[] {
  const patterns: string[] = []
  if (urlParts.pathname && urlParts.pathname !== '/') {
    patterns.push(`%${escapeSqlLike(urlParts.host)}%${escapeSqlLike(urlParts.pathname)}%`)
  }
  for (const lid of urlParts.listingIds) {
    if (lid) {
      patterns.push(`%${escapeSqlLike(urlParts.host)}%${escapeSqlLike(lid)}%`)
    }
  }
  if (urlParts.canonicalUrl && urlParts.canonicalUrl.includes('?')) {
    patterns.push(`%${escapeSqlLike(urlParts.canonicalUrl)}%`)
  }
  if (patterns.length === 0) {
    patterns.push(`%${escapeSqlLike(urlParts.canonicalUrl || urlParts.raw)}%`)
  }
  return Array.from(new Set(patterns))
}

function buildPhoneDigitsSqlCondition(colId: string, digits: string) {
  return sql`right(regexp_replace(coalesce(${dynamicRows.values} ->> ${colId}, ''), '[^0-9]', '', 'g'), 10) = ${digits}`
}

function buildColumnTextOrOptionSqlCondition(params: {
  clinicId: string
  col: typeof dynamicColumns.$inferSelect
  term: string
  exact?: boolean
}) {
  const { clinicId, col, term, exact } = params
  const trimmed = term.trim()
  if (!trimmed) return null
  const trimmedLow = trimmed.toLocaleLowerCase('tr-TR')
  const foldedTerm = foldTurkishAscii(trimmed)
  const rawPat = exact ? escapeSqlLike(trimmed) : `%${escapeSqlLike(trimmed)}%`
  const asciiPat = exact ? escapeSqlLike(foldedTerm) : `%${escapeSqlLike(foldedTerm)}%`

  if (col.fieldType === 'relation') {
    if (exact) {
      return sql`EXISTS (
        SELECT 1 FROM dynamic_row_links drl
        JOIN dynamic_relations dr ON dr.id = drl.relation_id
        JOIN dynamic_rows linked ON (
          (drl.source_row_id = ${dynamicRows.id} AND dr.source_column_id = ${col.id} AND linked.id = drl.target_row_id)
          OR
          (drl.target_row_id = ${dynamicRows.id} AND dr.inverse_column_id = ${col.id} AND linked.id = drl.source_row_id)
        )
        WHERE drl.clinic_id = ${clinicId}
          AND linked.is_archived = false
          AND (
            lower(trim(linked.display_title)) = ${trimmedLow}
            OR lower(trim(translate(linked.display_title, 'çÇğĞıİöÖşŞüÜ', 'ccggiioossuu'))) = ${foldedTerm}
          )
      )`
    }
    return sql`EXISTS (
      SELECT 1 FROM dynamic_row_links drl
      JOIN dynamic_relations dr ON dr.id = drl.relation_id
      JOIN dynamic_rows linked ON (
        (drl.source_row_id = ${dynamicRows.id} AND dr.source_column_id = ${col.id} AND linked.id = drl.target_row_id)
        OR
        (drl.target_row_id = ${dynamicRows.id} AND dr.inverse_column_id = ${col.id} AND linked.id = drl.source_row_id)
      )
      WHERE drl.clinic_id = ${clinicId}
        AND linked.is_archived = false
        AND (
          linked.display_title ILIKE ${rawPat}
          OR translate(linked.display_title, 'çÇğĞıİöÖşŞüÜ', 'ccggiioossuu') ILIKE ${asciiPat}
        )
    )`
  }

  if (col.fieldType === 'select' || col.fieldType === 'multiselect') {
    const cfg = (col.config || {}) as DynamicColumnConfig
    const opts = Array.isArray(cfg.options) ? cfg.options : []
    const matchedOptIds = opts
      .filter(o => {
        const idFold = foldTurkishAscii(o.id)
        const lblFold = foldTurkishAscii(o.label)
        if (exact) return idFold === foldedTerm || lblFold === foldedTerm
        return idFold.includes(foldedTerm) || lblFold.includes(foldedTerm) || foldedTerm.includes(lblFold)
      })
      .map(o => o.id)

    const optConds = matchedOptIds.flatMap(optId => [
      sql`coalesce(${dynamicRows.values} ->> ${col.id}, '') = ${optId}`,
      sql`coalesce(${dynamicRows.values} ->> ${col.id}, '') ILIKE ${'%"' + escapeSqlLike(optId) + '"%'}`,
    ])
    optConds.push(
      sql`coalesce(${dynamicRows.values} ->> ${col.id}, '') ILIKE ${rawPat}`,
      sql`translate(coalesce(${dynamicRows.values} ->> ${col.id}, ''), 'çÇğĞıİöÖşŞüÜ', 'ccggiioossuu') ILIKE ${asciiPat}`,
    )
    return or(...optConds)
  }

  if (col.fieldType === 'boolean') {
    const boolMatches: string[] = []
    if (/^(evet|true|1|var)$/.test(foldedTerm)) boolMatches.push('true', '1')
    if (/^(hayir|false|0|yok)$/.test(foldedTerm)) boolMatches.push('false', '0')
    if (boolMatches.length > 0) {
      return or(
        ...boolMatches.map(b => sql`lower(trim(coalesce(${dynamicRows.values} ->> ${col.id}, ''))) = ${b}`),
        sql`coalesce(${dynamicRows.values} ->> ${col.id}, '') ILIKE ${rawPat}`,
      )
    }
  }

  return sql`(
    coalesce(${dynamicRows.values} ->> ${col.id}, '') ILIKE ${rawPat}
    OR translate(coalesce(${dynamicRows.values} ->> ${col.id}, ''), 'çÇğĞıİöÖşŞüÜ', 'ccggiioossuu') ILIKE ${asciiPat}
  )`
}

function buildRowTermPredicateSQL(params: {
  clinicId: string
  cols: Array<typeof dynamicColumns.$inferSelect>
  term: string
  includeDisplayTitle: boolean
}) {
  const { clinicId, cols, term, includeDisplayTitle } = params
  const trimmed = term.trim()
  if (!trimmed) return null
  const folded = foldTurkishAscii(trimmed)
  const rawPat = `%${escapeSqlLike(trimmed)}%`
  const asciiPat = `%${escapeSqlLike(folded)}%`
  const conds: Array<ReturnType<typeof sql> | ReturnType<typeof or> | undefined> = []

  if (includeDisplayTitle) {
    conds.push(
      sql`${dynamicRows.displayTitle} ILIKE ${rawPat}`,
      sql`translate(${dynamicRows.displayTitle}, 'çÇğĞıİöÖşŞüÜ', 'ccggiioossuu') ILIKE ${asciiPat}`,
    )
  }

  for (const col of cols) {
    const colCond = buildColumnTextOrOptionSqlCondition({ clinicId, col, term: trimmed, exact: false })
    if (colCond) conds.push(colCond)
  }

  const valid = conds.filter(Boolean)
  return valid.length > 0 ? or(...(valid as Array<NonNullable<typeof valid[number]>>)) : null
}

function buildUrlCandidateSqlPredicate(params: {
  cols: Array<typeof dynamicColumns.$inferSelect>
  urlPartsList: ParsedUrlLookupParts[]
  includeDisplayTitle: boolean
}) {
  const { cols, urlPartsList, includeDisplayTitle } = params
  const patterns = Array.from(new Set(urlPartsList.flatMap(buildUrlSqlPatterns)))
  if (patterns.length === 0) return null

  const textCols = cols.filter(c => c.fieldType === 'text')
  const conds: Array<ReturnType<typeof sql>> = []
  for (const pat of patterns) {
    if (includeDisplayTitle) {
      conds.push(sql`${dynamicRows.displayTitle} ILIKE ${pat}`)
    }
    for (const col of textCols) {
      conds.push(sql`coalesce(${dynamicRows.values} ->> ${col.id}, '') ILIKE ${pat}`)
    }
  }
  return conds.length > 0 ? or(...conds) : null
}

async function findFirstMatchingRowByColumnSQL(params: {
  clinicId: string
  table: typeof dynamicTables.$inferSelect
  col: typeof dynamicColumns.$inferSelect
  tCols: Array<typeof dynamicColumns.$inferSelect>
  candidateStr: string
}): Promise<typeof dynamicRows.$inferSelect | undefined> {
  const { clinicId, table, col, tCols, candidateStr } = params
  const trimmed = candidateStr.trim()
  if (!trimmed) return undefined

  let sqlPred: ReturnType<typeof sql> | ReturnType<typeof or> | null | undefined = null
  const queryUrl = parseUrlLookupParts(trimmed)

  if (isPhoneLikeDynamicColumn(col)) {
    const digits = trimmed.replace(/\D/g, '').slice(-10)
    if (digits.length >= 10) {
      sqlPred = buildPhoneDigitsSqlCondition(col.id, digits)
    }
  }

  if (!sqlPred && queryUrl && col.fieldType === 'text') {
    sqlPred = buildUrlCandidateSqlPredicate({
      cols: [col],
      urlPartsList: [queryUrl],
      includeDisplayTitle: false,
    })
  }

  if (!sqlPred) {
    sqlPred = buildColumnTextOrOptionSqlCondition({
      clinicId,
      col,
      term: trimmed,
      exact: col.fieldType !== 'text',
    })
  }

  if (!sqlPred) return undefined

  const candidates = await db
    .select()
    .from(dynamicRows)
    .where(
      and(
        eq(dynamicRows.clinicId, clinicId),
        eq(dynamicRows.tableId, table.id),
        eq(dynamicRows.isArchived, false),
        sqlPred,
      ),
    )
    .orderBy(desc(dynamicRows.updatedAt), desc(dynamicRows.createdAt))
    .limit(25)

  if (candidates.length === 0) return undefined

  const linkedMap =
    col.fieldType === 'relation'
      ? await loadLinkedTitlesForRows(
          clinicId,
          candidates.map(row => ({ row, table, tCols })),
        )
      : new Map<string, Record<string, string[]>>()

  return candidates.find(row => cellMatchesSearch(row, col, trimmed, linkedMap.get(row.id)?.[col.id]))
}

function cellMatchesSearch(
  row: typeof dynamicRows.$inferSelect,
  col: typeof dynamicColumns.$inferSelect,
  searchRaw: string,
  linkedTitles?: string[],
): boolean {
  const searchTrimmed = searchRaw.trim()
  if (!searchTrimmed) return false
  const rowVals = (row.values ?? {}) as Record<string, unknown>
  const rawCell = rowVals[col.id]

  if (isPhoneLikeDynamicColumn(col)) {
    const searchDigits = searchTrimmed.replace(/\D/g, '').slice(-10)
    const cellDigits = String(rawCell ?? '').replace(/\D/g, '').slice(-10)
    if (searchDigits.length >= 10 && cellDigits.length >= 10) {
      return cellDigits === searchDigits
    }
    return String(rawCell ?? '').trim().toLocaleLowerCase('tr-TR') === searchTrimmed.toLocaleLowerCase('tr-TR')
  }

  const queryUrl = parseUrlLookupParts(searchTrimmed)
  if (queryUrl && isUrlOnlyQuery(searchTrimmed)) {
    return cellMatchesParsedUrl(rawCell, queryUrl)
  }

  const searchLow = searchTrimmed.toLocaleLowerCase('tr-TR')
  if (col.fieldType === 'relation' && Array.isArray(linkedTitles) && linkedTitles.length > 0) {
    if (linkedTitles.some(t => t.trim().toLocaleLowerCase('tr-TR') === searchLow)) return true
  }

  const candidates = extractReadableCandidateStrings(rawCell, col)
  if (candidates.includes(searchLow)) return true
  if (queryUrl && cellMatchesParsedUrl(rawCell, queryUrl)) return true
  return false
}

/**
 * Akışta bir CONDITION düğümü değerlendirilmeden hemen önce dinamik tablo
 * varlık ("Bu tabloda kayıtlı mı?") ve sütun eşleşme (`existsInTable` / `notExistsInTable`)
 * kontrollerini canlı Postgres verisiyle tüm aktif satırlarda çözer (satır limiti olmadan).
 */
export async function hydrateDynamicConditionLookups(params: {
  clinicId?: string
  node: FlowNode
  fields: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const { clinicId, node, fields } = params
  if (!clinicId || clinicId === 'memory' || node.type !== 'CONDITION') return {}

  const rules = collectConditionLeafRules(node)
  const relevantRules = rules.filter(r => {
    const field = String(r.field || '').trim()
    const isTableExists = r.sourceColumnId === '__row_exists__' || field.endsWith('____kayitli')
    const isColExists = r.operator === 'existsInTable' || r.operator === 'notExistsInTable'
    return isTableExists || isColExists
  })
  if (relevantRules.length === 0) return {}

  try {
    await ensureDynamicTablesSchema()

    const [tables, cols] = await Promise.all([
      db.select().from(dynamicTables).where(eq(dynamicTables.clinicId, clinicId)),
      db.select().from(dynamicColumns).where(eq(dynamicColumns.clinicId, clinicId)).orderBy(asc(dynamicColumns.sortOrder)),
    ])
    if (tables.length === 0) return {}

    const colsByTable = new Map<string, Array<typeof dynamicColumns.$inferSelect>>()
    for (const c of cols) {
      const list = colsByTable.get(c.tableId) ?? []
      list.push(c)
      colsByTable.set(c.tableId, list)
    }

    const patch: Record<string, unknown> = {}
    const mergedFields = (): Record<string, unknown> => ({ ...fields, ...patch })

    for (const rule of relevantRules) {
      const field = String(rule.field || '').trim()
      const isTableExists = rule.sourceColumnId === '__row_exists__' || field.endsWith('____kayitli')

      if (isTableExists) {
        const table = tables.find(
          t => t.id === rule.sourceTableId || buildFlowDynamicTableExistsKey(t.slug || t.name) === field,
        )
        if (!table) {
          if (field) patch[field] = 'false'
          if (rule.sourceTableId) patch[`_tbl_exists__${rule.sourceTableId}`] = 'false'
          continue
        }
        const existsKey = buildFlowDynamicTableExistsKey(table.slug || table.name)
        const curFields = mergedFields()
        if (curFields[existsKey] !== undefined || curFields[`_tbl_exists__${table.id}`] !== undefined) {
          continue
        }

        const tCols = colsByTable.get(table.id) ?? []
        const phoneCols = tCols.filter(isPhoneLikeDynamicColumn)
        const rawPhone =
          curFields.telefon ??
          curFields['caller.phone'] ??
          curFields.phone ??
          tCols.map(c => curFields[buildFlowDynamicFieldKey(table.slug || table.name, c.slug || c.name)]).find((_v, idx) => phoneCols.includes(tCols[idx]))
        const digits = String(rawPhone ?? '').replace(/\D/g, '').slice(-10)

        let matchedRow: typeof dynamicRows.$inferSelect | undefined
        if (digits.length === 10 && phoneCols.length > 0) {
          const phonePred = or(...phoneCols.map(col => buildPhoneDigitsSqlCondition(col.id, digits)))
          if (phonePred) {
            const phoneRows = await db
              .select()
              .from(dynamicRows)
              .where(
                and(
                  eq(dynamicRows.clinicId, clinicId),
                  eq(dynamicRows.tableId, table.id),
                  eq(dynamicRows.isArchived, false),
                  phonePred,
                ),
              )
              .orderBy(desc(dynamicRows.updatedAt), desc(dynamicRows.createdAt))
              .limit(1)
            matchedRow = phoneRows[0]
          }
        }

        if (!matchedRow) {
          for (const col of tCols) {
            const colKey = buildFlowDynamicFieldKey(table.slug || table.name, col.slug || col.name)
            const candidate = curFields[colKey] ?? curFields[`_col__${col.id}`]
            const candidateStr = Array.isArray(candidate) ? String(candidate[0] ?? '').trim() : String(candidate ?? '').trim()
            if (!candidateStr) continue
            const found = await findFirstMatchingRowByColumnSQL({
              clinicId,
              table,
              col,
              tCols,
              candidateStr,
            })
            if (found) {
              matchedRow = found
              break
            }
          }
        }

        const matchedFlag = matchedRow ? 'true' : 'false'
        patch[existsKey] = matchedFlag
        patch[`_tbl_exists__${table.id}`] = matchedFlag
        if (field) patch[field] = matchedFlag

        if (matchedRow) {
          const linkedMap = await loadLinkedTitlesForRows(clinicId, [{ row: matchedRow, table, tCols }])
          const { fieldPatch } = extractReadableRowFields({ table, columns: tCols, row: matchedRow, linkedTitlesByRowAndCol: linkedMap })
          for (const [k, v] of Object.entries(fieldPatch)) {
            if (curFields[k] === undefined && patch[k] === undefined) {
              patch[k] = v
            }
          }
        }
        continue
      }

      // Column-level existsInTable / notExistsInTable
      let targetTable = tables.find(t => t.id === rule.sourceTableId)
      let targetCol = targetTable
        ? (colsByTable.get(targetTable.id) ?? []).find(c => c.id === rule.sourceColumnId)
        : undefined
      if (!targetTable || !targetCol) {
        for (const t of tables) {
          const tCols = colsByTable.get(t.id) ?? []
          const foundCol = tCols.find(c => buildFlowDynamicFieldKey(t.slug || t.name, c.slug || c.name) === field)
          if (foundCol) {
            targetTable = t
            targetCol = foundCol
            break
          }
        }
      }

      if (!targetTable || !targetCol) {
        if (field) patch[`_exists__${field}`] = 'false'
        if (rule.sourceColumnId) patch[`_col_exists__${rule.sourceColumnId}`] = 'false'
        continue
      }

      const curFields = mergedFields()
      const canonicalColKey = buildFlowDynamicFieldKey(targetTable.slug || targetTable.name, targetCol.slug || targetCol.name)
      const isNameCol = /^(ad_soyad|musteri_adi|hasta_adi|isim)/i.test(targetCol.slug)
      const rawCandidate =
        curFields[field] ??
        curFields[canonicalColKey] ??
        curFields[`_col__${targetCol.id}`] ??
        curFields[targetCol.slug] ??
        (isPhoneLikeDynamicColumn(targetCol)
          ? curFields.telefon ?? curFields['caller.phone'] ?? curFields.phone
          : isNameCol
          ? curFields.musteri_adi ?? curFields.ad_soyad
          : undefined)

      const candidateStr = Array.isArray(rawCandidate)
        ? String(rawCandidate[0] ?? '').trim()
        : String(rawCandidate ?? '').trim()

      if (!candidateStr) {
        if (field) patch[`_exists__${field}`] = 'false'
        patch[`_col_exists__${targetCol.id}`] = 'false'
        continue
      }

      const tCols = colsByTable.get(targetTable.id) ?? []
      const matchedRow = await findFirstMatchingRowByColumnSQL({
        clinicId,
        table: targetTable,
        col: targetCol,
        tCols,
        candidateStr,
      })

      const matchFlag = matchedRow ? 'true' : 'false'
      if (field) patch[`_exists__${field}`] = matchFlag
      patch[`_col_exists__${targetCol.id}`] = matchFlag

      if (matchedRow) {
        const rowLinked = await loadLinkedTitlesForRows(clinicId, [{ row: matchedRow, table: targetTable, tCols }])
        const { fieldPatch } = extractReadableRowFields({
          table: targetTable,
          columns: tCols,
          row: matchedRow,
          linkedTitlesByRowAndCol: rowLinked,
        })
        for (const [k, v] of Object.entries(fieldPatch)) {
          if (curFields[k] === undefined && patch[k] === undefined) {
            patch[k] = v
          }
        }
      }
    }

    return patch
  } catch (err) {
    console.warn('[hydrateDynamicConditionLookups] Dinamik koşul sorgusu atlandı:', err)
    return {}
  }
}

let pgTrgmCache: { ok: boolean; checkedAt: number } | null = null

async function isPgTrgmInstalled(): Promise<boolean> {
  const now = Date.now()
  if (pgTrgmCache && now - pgTrgmCache.checkedAt < 60_000) return pgTrgmCache.ok
  try {
    const res = await db.execute(sql`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm' LIMIT 1`)
    const list = (res as { rows?: unknown[] })?.rows ?? (Array.isArray(res) ? res : [])
    const ok = list.length > 0
    pgTrgmCache = { ok, checkedAt: now }
    return ok
  } catch {
    pgTrgmCache = { ok: false, checkedAt: now }
    return false
  }
}

export interface MatchedDynamicLinkRecord {
  rowId: string
  tableId: string
  tableName: string
  matchedUrl: string
  readableRecord: Record<string, unknown>
  fieldPatch: Record<string, unknown>
  summaryLine: string
}

export interface ClinicDynamicPromptMetadata {
  clinicId: string
  hasDynamicTables: boolean
  sectorKind: 'dental' | 'real_estate' | 'insurance' | 'automotive' | 'consulting' | 'support' | 'inventory' | 'generic'
  isNonDentalTenant: boolean
  hasPriceColumn: boolean
  hasLinkColumn: boolean
  tableNames: string[]
  tablesSummary: string
}

/**
 * Verilen URL(ler)i (ör. WhatsApp'tan gönderilen Sahibinden / ilan linki)
 * kliniğin TÜM aktif satırları içinde 500 satır limiti olmadan doğrudan SQL ile arar,
 * Google veya dış arama yapmadan yalnızca tablodaki URL sütunlarıyla kanonik olarak eşleştirir.
 */
export async function findDynamicRecordsByLinkUrls(
  clinicId: string,
  urls: string[],
): Promise<MatchedDynamicLinkRecord[]> {
  try {
    if (!clinicId || clinicId === 'memory') return []
    const parsedList = urls
      .map(u => parseUrlLookupParts(u))
      .filter((x): x is ParsedUrlLookupParts => Boolean(x))
    if (parsedList.length === 0) return []

    await ensureDynamicTablesSchema()

    const [tables, cols] = await Promise.all([
      db.select().from(dynamicTables).where(eq(dynamicTables.clinicId, clinicId)).orderBy(asc(dynamicTables.sortOrder)),
      db.select().from(dynamicColumns).where(eq(dynamicColumns.clinicId, clinicId)).orderBy(asc(dynamicColumns.sortOrder)),
    ])
    if (tables.length === 0) return []

    const textCols = cols.filter(c => c.fieldType === 'text')
    const urlPred = buildUrlCandidateSqlPredicate({
      cols: textCols,
      urlPartsList: parsedList,
      includeDisplayTitle: true,
    })
    if (!urlPred) return []

    const candidates = await db
      .select()
      .from(dynamicRows)
      .where(
        and(
          eq(dynamicRows.clinicId, clinicId),
          eq(dynamicRows.isArchived, false),
          urlPred,
        ),
      )
      .orderBy(desc(dynamicRows.updatedAt), desc(dynamicRows.createdAt))
      .limit(30)

    if (candidates.length === 0) return []

    const tableById = new Map(tables.map(t => [t.id, t]))
    const colsByTable = new Map<string, Array<typeof dynamicColumns.$inferSelect>>()
    for (const c of cols) {
      const list = colsByTable.get(c.tableId) ?? []
      list.push(c)
      colsByTable.set(c.tableId, list)
    }

    const verified: Array<{
      row: typeof dynamicRows.$inferSelect
      table: typeof dynamicTables.$inferSelect
      tCols: Array<typeof dynamicColumns.$inferSelect>
      matchedUrl: string
      score: number
    }> = []

    for (const row of candidates) {
      const table = tableById.get(row.tableId)
      if (!table) continue
      const tCols = colsByTable.get(table.id) ?? []
      const rowVals = (row.values ?? {}) as Record<string, unknown>

      let bestScore = 0
      let matchedUrl = ''

      for (const qUrl of parsedList) {
        if (row.displayTitle && cellMatchesParsedUrl(row.displayTitle, qUrl)) {
          bestScore = Math.max(bestScore, 2)
          matchedUrl = matchedUrl || qUrl.raw
        }
        for (const c of tCols) {
          if (c.fieldType !== 'text') continue
          const cellVal = rowVals[c.id]
          if (!cellVal || !cellMatchesParsedUrl(cellVal, qUrl)) continue
          const cellParsed = parseUrlLookupParts(String(cellVal))
          const isCanonicalExact = cellParsed ? cellParsed.canonicalUrl === qUrl.canonicalUrl : false
          const score = isCanonicalExact ? 3 : 2
          if (score > bestScore) {
            bestScore = score
            matchedUrl = String(cellVal)
          }
        }
      }

      if (bestScore > 0) {
        verified.push({ row, table, tCols, matchedUrl: matchedUrl || parsedList[0].raw, score: bestScore })
      }
    }

    if (verified.length === 0) return []

    verified.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const bTs = new Date(b.row.updatedAt ?? b.row.createdAt ?? 0).getTime()
      const aTs = new Date(a.row.updatedAt ?? a.row.createdAt ?? 0).getTime()
      return bTs - aTs
    })

    const picked = verified.slice(0, 5)
    const linkedMap = await loadLinkedTitlesForRows(
      clinicId,
      picked.map(item => ({ row: item.row, table: item.table, tCols: item.tCols })),
    )

    return picked.map(item => {
      const extracted = extractReadableRowFields({
        table: item.table,
        columns: item.tCols,
        row: item.row,
        linkedTitlesByRowAndCol: linkedMap,
      })
      return {
        rowId: item.row.id,
        tableId: item.table.id,
        tableName: item.table.name,
        matchedUrl: item.matchedUrl,
        readableRecord: extracted.readableRecord,
        fieldPatch: extracted.fieldPatch,
        summaryLine: `- [${item.table.name}] ${extracted.tablePairs.join(' | ')}`,
      }
    })
  } catch (err) {
    console.warn('[findDynamicRecordsByLinkUrls] Link arama hatası:', err)
    return []
  }
}

/**
 * WhatsApp sohbet oturumuna sabitlenmiş (daha önce linkle eşleştirilmiş)
 * dinamik tablo satırlarını ID üzerinden canlı olarak yeniden yükler.
 */
export async function loadDynamicRecordsByRowIds(
  clinicId: string,
  rowIds: string[],
): Promise<MatchedDynamicLinkRecord[]> {
  try {
    if (!clinicId || clinicId === 'memory') return []
    const cleanIds = Array.from(
      new Set(
        rowIds
          .map(id => String(id || '').trim())
          .filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)),
      ),
    )
    if (cleanIds.length === 0) return []

    await ensureDynamicTablesSchema()

    const [tables, cols, rows] = await Promise.all([
      db.select().from(dynamicTables).where(eq(dynamicTables.clinicId, clinicId)),
      db.select().from(dynamicColumns).where(eq(dynamicColumns.clinicId, clinicId)).orderBy(asc(dynamicColumns.sortOrder)),
      db
        .select()
        .from(dynamicRows)
        .where(
          and(
            eq(dynamicRows.clinicId, clinicId),
            inArray(dynamicRows.id, cleanIds),
            eq(dynamicRows.isArchived, false),
          ),
        ),
    ])

    if (rows.length === 0 || tables.length === 0) return []

    const tableById = new Map(tables.map(t => [t.id, t]))
    const colsByTable = new Map<string, Array<typeof dynamicColumns.$inferSelect>>()
    for (const c of cols) {
      const list = colsByTable.get(c.tableId) ?? []
      list.push(c)
      colsByTable.set(c.tableId, list)
    }

    const rowOrder = new Map(cleanIds.map((id, idx) => [id, idx]))
    const items = rows
      .map(row => {
        const table = tableById.get(row.tableId)
        if (!table) return null
        return { row, table, tCols: colsByTable.get(table.id) ?? [] }
      })
      .filter((x): x is { row: typeof dynamicRows.$inferSelect; table: typeof dynamicTables.$inferSelect; tCols: Array<typeof dynamicColumns.$inferSelect> } => Boolean(x))
      .sort((a, b) => (rowOrder.get(a.row.id) ?? 99) - (rowOrder.get(b.row.id) ?? 99))

    if (items.length === 0) return []

    const linkedMap = await loadLinkedTitlesForRows(clinicId, items)
    return items.map(item => {
      const extracted = extractReadableRowFields({
        table: item.table,
        columns: item.tCols,
        row: item.row,
        linkedTitlesByRowAndCol: linkedMap,
      })
      const linkCol = item.tCols.find(c => /link|url|baglanti|bağlantı/i.test(`${c.slug} ${c.name}`))
      const rowVals = (item.row.values ?? {}) as Record<string, unknown>
      const matchedUrl = linkCol && rowVals[linkCol.id] ? String(rowVals[linkCol.id]) : ''
      return {
        rowId: item.row.id,
        tableId: item.table.id,
        tableName: item.table.name,
        matchedUrl,
        readableRecord: extracted.readableRecord,
        fieldPatch: extracted.fieldPatch,
        summaryLine: `- [${item.table.name}] ${extracted.tablePairs.join(' | ')}`,
      }
    })
  } catch (err) {
    console.warn('[loadDynamicRecordsByRowIds] Satır yükleme hatası:', err)
    return []
  }
}

/**
 * Sistem istemi (prompt) oluştururken mevcut kiracının dinamik tablo yapısını,
 * sektör türünü ve fiyat/link sütunu varlığını hafifçe döndürür.
 */
export async function getClinicDynamicPromptMetadata(
  explicitClinicId?: string,
): Promise<ClinicDynamicPromptMetadata> {
  const clinicId = explicitClinicId || (() => {
    try { return currentClinicId() || '' } catch { return '' }
  })()
  let isDentalTemplate = currentBusinessTemplate() === 'dental_clinic'
  if (explicitClinicId && explicitClinicId !== 'memory' && explicitClinicId !== (() => {
    try { return currentClinicId() || '' } catch { return '' }
  })()) {
    try {
      const [c] = await db
        .select({ businessTemplate: clinics.businessTemplate })
        .from(clinics)
        .where(eq(clinics.id, explicitClinicId))
        .limit(1)
      if (c) isDentalTemplate = c.businessTemplate === 'dental_clinic'
    } catch {
      // ignore
    }
  }
  const empty: ClinicDynamicPromptMetadata = {
    clinicId,
    hasDynamicTables: false,
    sectorKind: isDentalTemplate ? 'dental' : 'generic',
    isNonDentalTenant: !isDentalTemplate,
    hasPriceColumn: false,
    hasLinkColumn: false,
    tableNames: [],
    tablesSummary: '',
  }
  if (!clinicId || clinicId === 'memory') return empty

  try {
    await ensureDynamicTablesSchema()
    const [tables, cols] = await Promise.all([
      db.select().from(dynamicTables).where(eq(dynamicTables.clinicId, clinicId)).orderBy(asc(dynamicTables.sortOrder)),
      db.select().from(dynamicColumns).where(eq(dynamicColumns.clinicId, clinicId)).orderBy(asc(dynamicColumns.sortOrder)),
    ])
    if (tables.length === 0) return empty

    const colsByTable = new Map<string, Array<typeof dynamicColumns.$inferSelect>>()
    for (const c of cols) {
      const list = colsByTable.get(c.tableId) ?? []
      list.push(c)
      colsByTable.set(c.tableId, list)
    }

    const combinedAll = tables
      .map(t => `${t.name} ${t.slug} ${(colsByTable.get(t.id) ?? []).map(c => `${c.name} ${c.slug}`).join(' ')}`)
      .join(' ')

    let sectorKind: ClinicDynamicPromptMetadata['sectorKind'] = isDentalTemplate ? 'dental' : 'generic'
    if (isDentalTemplate && /dis|diş|dental|muayene|implant|kanal|klinik|ortodonti/i.test(combinedAll)) sectorKind = 'dental'
    else if (/emlak|mulk|mülk|daire|konut|kiraci|kiracı|portfoy|portföy|tapu|ilan|sahibinden|hepsiemlak|emlakjet/i.test(combinedAll)) sectorKind = 'real_estate'
    else if (/sigorta|police|poliçe|kasko|hasar|teklif/i.test(combinedAll)) sectorKind = 'insurance'
    else if (/arac|araç|servis|plaka|otomotiv|bakim|bakım/i.test(combinedAll)) sectorKind = 'automotive'
    else if (/danisman|danışman|seans|psikolog|terapi/i.test(combinedAll)) sectorKind = 'consulting'
    else if (/destek|ticket|sikayet|şikayet|cagri|çağrı/i.test(combinedAll)) sectorKind = 'support'
    else if (/stok|urun|ürün|demirbas|demirbaş|envanter|depo/i.test(combinedAll)) sectorKind = 'inventory'

    const hasPriceColumn = cols.some(
      c => c.fieldType === 'currency' || /fiyat|ucret|ücret|tutar|bedel|kira/i.test(`${c.slug} ${c.name}`),
    )
    const hasLinkColumn = cols.some(
      c => /link|url|baglanti|bağlantı|ilan_linki|web/i.test(`${c.slug} ${c.name}`),
    )

    const tablesSummary = tables
      .slice(0, 12)
      .map(t => {
        const colNames = (colsByTable.get(t.id) ?? []).map(c => c.name).filter(Boolean).join(', ')
        return `- ${t.name}${colNames ? ` (${colNames})` : ''}`
      })
      .join('\n')

    return {
      clinicId,
      hasDynamicTables: true,
      sectorKind,
      isNonDentalTenant: !isDentalTemplate,
      hasPriceColumn,
      hasLinkColumn,
      tableNames: tables.map(t => t.name),
      tablesSummary,
    }
  } catch (err) {
    console.warn('[getClinicDynamicPromptMetadata] Metadata yüklenemedi:', err)
    return empty
  }
}

/**
 * Yapay zeka asistanının (Sesli / WhatsApp) herhangi bir dinamik veri tablosunu
 * telefon numarası veya aranan değerle (ör. ilan linki, stok/ürün adı, müşteri kaydı) okuma
 * amaçlı sorgulamasını sağlar. 500 satır sınırı olmadan doğrudan PostgreSQL üzerinde arar.
 */
export async function queryDynamicTableRecord(params: {
  clinicId: string
  tableIdOrName?: string
  searchValue?: string
  columnNameOrSlug?: string
  phone?: string
}): Promise<{
  found: boolean
  tableName?: string
  record?: Record<string, unknown>
  records?: Array<Record<string, unknown>>
  fieldPatch: Record<string, unknown>
  message: string
}> {
  try {
    const clinicId = params.clinicId
    if (!clinicId || clinicId === 'memory') {
      return { found: false, fieldPatch: {}, message: 'Bu ortamda veri tablosu sorgusu kullanılamaz.' }
    }

    await ensureDynamicTablesSchema()

    const [tables, cols] = await Promise.all([
      db.select().from(dynamicTables).where(eq(dynamicTables.clinicId, clinicId)).orderBy(asc(dynamicTables.sortOrder)),
      db.select().from(dynamicColumns).where(eq(dynamicColumns.clinicId, clinicId)).orderBy(asc(dynamicColumns.sortOrder)),
    ])
    if (tables.length === 0) {
      return { found: false, fieldPatch: {}, message: 'İşletmede tanımlı veri tablosu bulunamadı.' }
    }

    const tblFilterRaw = String(params.tableIdOrName || '').trim()
    const tblFilterSlug = tblFilterRaw ? slugifyTr(tblFilterRaw, '') : ''
    const tblFilterLow = tblFilterRaw.toLocaleLowerCase('tr-TR')
    const tblFilterFold = foldTurkishAscii(tblFilterRaw)
    const candidateTables = tblFilterRaw
      ? tables.filter(
          t =>
            t.id === tblFilterRaw ||
            t.slug.toLowerCase() === tblFilterSlug ||
            t.name.toLocaleLowerCase('tr-TR') === tblFilterLow ||
            t.name.toLocaleLowerCase('tr-TR').includes(tblFilterLow) ||
            foldTurkishAscii(t.name).includes(tblFilterFold),
        )
      : tables

    if (candidateTables.length === 0) {
      return {
        found: false,
        fieldPatch: {},
        message: `"${tblFilterRaw}" adında bir veri tablosu bulunamadı.`,
      }
    }

    const colsByTable = new Map<string, Array<typeof dynamicColumns.$inferSelect>>()
    for (const c of cols) {
      const list = colsByTable.get(c.tableId) ?? []
      list.push(c)
      colsByTable.set(c.tableId, list)
    }

    const colFilterRaw = String(params.columnNameOrSlug || '').trim()
    const colFilterSlug = colFilterRaw ? slugifyTr(colFilterRaw, '') : ''
    const colFilterLow = colFilterRaw.toLocaleLowerCase('tr-TR')
    const colFilterFold = foldTurkishAscii(colFilterRaw)

    const resolveTargetCols = (tCols: Array<typeof dynamicColumns.$inferSelect>) =>
      colFilterRaw
        ? tCols.filter(
            c =>
              c.id === colFilterRaw ||
              c.slug.toLowerCase() === colFilterSlug ||
              c.name.toLocaleLowerCase('tr-TR').includes(colFilterLow) ||
              foldTurkishAscii(c.name).includes(colFilterFold),
          )
        : tCols

    const candidateTableIds = candidateTables.map(t => t.id)
    const allCandidateTargetCols = candidateTables.flatMap(t => resolveTargetCols(colsByTable.get(t.id) ?? []))

    const phoneDigits = String(params.phone || '').replace(/\D/g, '').slice(-10)
    const searchRaw = String(params.searchValue || '').trim()
    const searchLow = searchRaw.toLocaleLowerCase('tr-TR')
    const searchFold = foldTurkishAscii(searchRaw)
    const embeddedUrls = searchRaw ? extractUrlsFromText(searchRaw) : []
    const embeddedParsedUrls = embeddedUrls
      .map(u => parseUrlLookupParts(u))
      .filter((u): u is ParsedUrlLookupParts => Boolean(u))
    const directParsedUrl = searchRaw ? parseUrlLookupParts(searchRaw) : null
    const urlPartsList = directParsedUrl
      ? [directParsedUrl, ...embeddedParsedUrls.filter(u => u.canonicalUrl !== directParsedUrl.canonicalUrl)]
      : embeddedParsedUrls
    const strictUrlMode = Boolean(directParsedUrl && isUrlOnlyQuery(searchRaw))

    let candidateRows: Array<typeof dynamicRows.$inferSelect> = []

    if (searchRaw) {
      if (strictUrlMode && urlPartsList.length > 0) {
        const urlPred = buildUrlCandidateSqlPredicate({
          cols: allCandidateTargetCols,
          urlPartsList,
          includeDisplayTitle: !colFilterRaw,
        })
        if (urlPred) {
          candidateRows = await db
            .select()
            .from(dynamicRows)
            .where(
              and(
                eq(dynamicRows.clinicId, clinicId),
                inArray(dynamicRows.tableId, candidateTableIds),
                eq(dynamicRows.isArchived, false),
                urlPred,
              ),
            )
            .orderBy(desc(dynamicRows.updatedAt), desc(dynamicRows.createdAt))
            .limit(40)
        }
      } else {
        const sqlBranches: Array<ReturnType<typeof sql> | ReturnType<typeof or> | ReturnType<typeof and>> = []

        if (urlPartsList.length > 0) {
          const urlPred = buildUrlCandidateSqlPredicate({
            cols: allCandidateTargetCols,
            urlPartsList,
            includeDisplayTitle: !colFilterRaw,
          })
          if (urlPred) sqlBranches.push(urlPred)
        }

        const phrasePred = buildRowTermPredicateSQL({
          clinicId,
          cols: allCandidateTargetCols,
          term: searchRaw,
          includeDisplayTitle: !colFilterRaw,
        })
        if (phrasePred) sqlBranches.push(phrasePred)

        const wordTokens = extractSearchWordTokens(searchRaw)
        if (wordTokens.length > 1) {
          const tokenPreds = wordTokens
            .map(tok =>
              buildRowTermPredicateSQL({
                clinicId,
                cols: allCandidateTargetCols,
                term: tok,
                includeDisplayTitle: !colFilterRaw,
              }),
            )
            .filter(Boolean)
          if (tokenPreds.length > 0) {
            sqlBranches.push(and(...(tokenPreds as Array<NonNullable<typeof tokenPreds[number]>>)))
          }
        }

        const searchDigits = searchRaw.replace(/\D/g, '').slice(-10)
        if (searchDigits.length >= 10 && /^[+\d\s().-]+$/.test(searchRaw)) {
          const searchPhoneCols = allCandidateTargetCols.filter(isPhoneLikeDynamicColumn)
          if (searchPhoneCols.length > 0) {
            const pPred = or(...searchPhoneCols.map(c => buildPhoneDigitsSqlCondition(c.id, searchDigits)))
            if (pPred) sqlBranches.push(pPred)
          }
        }

        const combinedSqlPred = sqlBranches.length > 0 ? or(...sqlBranches) : null
        if (combinedSqlPred) {
          candidateRows = await db
            .select()
            .from(dynamicRows)
            .where(
              and(
                eq(dynamicRows.clinicId, clinicId),
                inArray(dynamicRows.tableId, candidateTableIds),
                eq(dynamicRows.isArchived, false),
                combinedSqlPred,
              ),
            )
            .orderBy(desc(dynamicRows.updatedAt), desc(dynamicRows.createdAt))
            .limit(60)
        }

        if (candidateRows.length === 0 && searchFold.length >= 3 && (await isPgTrgmInstalled())) {
          try {
            const textCols = allCandidateTargetCols.filter(c => c.fieldType === 'text')
            const trgmConds = [
              sql`similarity(translate(${dynamicRows.displayTitle}, 'çÇğĞıİöÖşŞüÜ', 'ccggiioossuu'), ${searchFold}) > 0.25`,
              ...textCols.map(
                c =>
                  sql`similarity(translate(coalesce(${dynamicRows.values} ->> ${c.id}, ''), 'çÇğĞıİöÖşŞüÜ', 'ccggiioossuu'), ${searchFold}) > 0.25`,
              ),
            ]
            const trgmPred = or(...trgmConds)
            if (trgmPred) {
              candidateRows = await db
                .select()
                .from(dynamicRows)
                .where(
                  and(
                    eq(dynamicRows.clinicId, clinicId),
                    inArray(dynamicRows.tableId, candidateTableIds),
                    eq(dynamicRows.isArchived, false),
                    trgmPred,
                  ),
                )
                .orderBy(desc(dynamicRows.updatedAt), desc(dynamicRows.createdAt))
                .limit(20)
            }
          } catch {
            // Optional fuzzy fallback silently skipped if unavailable
          }
        }
      }
    } else if (phoneDigits.length === 10) {
      const phoneCols = allCandidateTargetCols.filter(isPhoneLikeDynamicColumn)
      if (phoneCols.length > 0) {
        const phonePred = or(...phoneCols.map(c => buildPhoneDigitsSqlCondition(c.id, phoneDigits)))
        if (phonePred) {
          candidateRows = await db
            .select()
            .from(dynamicRows)
            .where(
              and(
                eq(dynamicRows.clinicId, clinicId),
                inArray(dynamicRows.tableId, candidateTableIds),
                eq(dynamicRows.isArchived, false),
                phonePred,
              ),
            )
            .orderBy(desc(dynamicRows.updatedAt), desc(dynamicRows.createdAt))
            .limit(15)
        }
      }
    } else if (tblFilterRaw) {
      candidateRows = await db
        .select()
        .from(dynamicRows)
        .where(
          and(
            eq(dynamicRows.clinicId, clinicId),
            inArray(dynamicRows.tableId, candidateTableIds),
            eq(dynamicRows.isArchived, false),
          ),
        )
        .orderBy(desc(dynamicRows.updatedAt), desc(dynamicRows.createdAt))
        .limit(20)
    }

    const tableById = new Map(candidateTables.map(t => [t.id, t]))
    const candidateItems = candidateRows
      .map(row => {
        const table = tableById.get(row.tableId)
        if (!table) return null
        return { row, table, tCols: colsByTable.get(table.id) ?? [] }
      })
      .filter((x): x is { row: typeof dynamicRows.$inferSelect; table: typeof dynamicTables.$inferSelect; tCols: Array<typeof dynamicColumns.$inferSelect> } => Boolean(x))

    const linkedMap = candidateItems.length > 0
      ? await loadLinkedTitlesForRows(clinicId, candidateItems)
      : new Map<string, Record<string, string[]>>()

    const scoredMatches: Array<{
      tier: number
      row: typeof dynamicRows.$inferSelect
      table: typeof dynamicTables.$inferSelect
      tCols: Array<typeof dynamicColumns.$inferSelect>
    }> = []

    const wordTokens = !strictUrlMode && searchRaw ? extractSearchWordTokens(searchRaw) : []
    const searchDigitsOnly = !strictUrlMode && searchRaw && /^[+\d\s().-]+$/.test(searchRaw)
      ? searchRaw.replace(/\D/g, '').slice(-10)
      : ''

    for (const item of candidateItems) {
      const { row, table, tCols } = item
      const targetCols = resolveTargetCols(tCols)
      const rowVals = (row.values ?? {}) as Record<string, unknown>

      if (strictUrlMode && urlPartsList.length > 0) {
        let bestUrlTier = 0
        for (const qUrl of urlPartsList) {
          if (!colFilterRaw && row.displayTitle && cellMatchesParsedUrl(row.displayTitle, qUrl)) {
            bestUrlTier = Math.max(bestUrlTier, 4)
          }
          for (const c of targetCols) {
            if (c.fieldType !== 'text') continue
            const rawCell = rowVals[c.id]
            if (!rawCell || !cellMatchesParsedUrl(rawCell, qUrl)) continue
            const cellParsed = parseUrlLookupParts(String(rawCell))
            bestUrlTier = Math.max(bestUrlTier, cellParsed && cellParsed.canonicalUrl === qUrl.canonicalUrl ? 5 : 4)
          }
        }
        if (bestUrlTier > 0) {
          scoredMatches.push({ tier: bestUrlTier, row, table, tCols })
        }
        continue
      }

      if (searchRaw) {
        let tier = 0

        if (urlPartsList.length > 0) {
          for (const qUrl of urlPartsList) {
            if (!colFilterRaw && row.displayTitle && cellMatchesParsedUrl(row.displayTitle, qUrl)) {
              tier = Math.max(tier, 4)
            }
            for (const c of targetCols) {
              if (c.fieldType === 'text' && cellMatchesParsedUrl(rowVals[c.id], qUrl)) {
                tier = Math.max(tier, 4)
              }
            }
          }
        }

        const titleLow = String(row.displayTitle || '').trim().toLocaleLowerCase('tr-TR')
        const titleFold = foldTurkishAscii(titleLow)
        if (!colFilterRaw && titleFold) {
          if (titleLow === searchLow || titleFold === searchFold) tier = Math.max(tier, 3)
          else if (titleLow.includes(searchLow) || titleFold.includes(searchFold)) tier = Math.max(tier, 2)
        }

        const combinedParts: string[] = !colFilterRaw && titleFold ? [titleFold] : []
        for (const c of targetCols) {
          const linkedTitles = c.fieldType === 'relation' ? (linkedMap.get(row.id)?.[c.id] ?? []) : []
          const candidates = [
            ...extractReadableCandidateStrings(rowVals[c.id], c),
            ...linkedTitles.map(t => t.trim().toLocaleLowerCase('tr-TR')),
          ]
          for (const valLow of candidates) {
            const valFold = foldTurkishAscii(valLow)
            combinedParts.push(valFold)
            if (valLow === searchLow || valFold === searchFold) tier = Math.max(tier, 3)
            else if (valLow.includes(searchLow) || valFold.includes(searchFold)) tier = Math.max(tier, 2)
          }
          if (searchDigitsOnly.length >= 10 && isPhoneLikeDynamicColumn(c)) {
            const cellDigits = String(rowVals[c.id] ?? '').replace(/\D/g, '').slice(-10)
            if (cellDigits.length === 10 && cellDigits === searchDigitsOnly) tier = Math.max(tier, 3)
          }
        }

        if (tier === 0 && wordTokens.length > 1) {
          const rowBag = combinedParts.join(' ')
          const allTokensFound = wordTokens.every(tok => rowBag.includes(foldTurkishAscii(tok)))
          if (allTokensFound) tier = 1
        } else if (tier === 0 && candidateItems.length > 0 && !urlPartsList.length) {
          // pg_trgm fallback match when SQL returned it cleanly
          tier = 1
        }

        if (tier > 0) {
          scoredMatches.push({ tier, row, table, tCols })
        }
        continue
      }

      if (phoneDigits.length === 10) {
        const phoneMatched = targetCols.some(c => {
          if (!isPhoneLikeDynamicColumn(c)) return false
          const cellDigits = String(rowVals[c.id] ?? '').replace(/\D/g, '').slice(-10)
          return cellDigits.length === 10 && cellDigits === phoneDigits
        })
        if (phoneMatched) {
          scoredMatches.push({ tier: 3, row, table, tCols })
        }
      } else if (tblFilterRaw) {
        scoredMatches.push({ tier: 1, row, table, tCols })
      }
    }

    scoredMatches.sort((a, b) => {
      if (b.tier !== a.tier) return b.tier - a.tier
      const bTs = new Date(b.row.updatedAt ?? b.row.createdAt ?? 0).getTime()
      const aTs = new Date(a.row.updatedAt ?? a.row.createdAt ?? 0).getTime()
      return bTs - aTs
    })

    const picked = scoredMatches.slice(0, 5)
    if (picked.length === 0) {
      const fieldPatch: Record<string, unknown> = {}
      if (candidateTables.length === 1) {
        const t = candidateTables[0]
        fieldPatch[buildFlowDynamicTableExistsKey(t.slug || t.name)] = 'false'
        fieldPatch[`_tbl_exists__${t.id}`] = 'false'
      }
      return {
        found: false,
        tableName: candidateTables.length === 1 ? candidateTables[0].name : undefined,
        fieldPatch,
        message: strictUrlMode
          ? 'Bu linkle eşleşen bir kayıt veri tablolarında bulunamadı. Başka bir kayıt uydurma.'
          : 'Aranan kritere uygun kayıt bulunamadı.',
      }
    }

    const pickedLinkedMap =
      linkedMap.size > 0
        ? linkedMap
        : await loadLinkedTitlesForRows(clinicId, picked)

    const primary = picked[0]
    const mergedPatch: Record<string, unknown> = {}
    const records: Array<Record<string, unknown>> = []

    for (const item of picked) {
      const extracted = extractReadableRowFields({
        table: item.table,
        columns: item.tCols,
        row: item.row,
        linkedTitlesByRowAndCol: pickedLinkedMap,
      })
      if (item === primary) {
        Object.assign(mergedPatch, extracted.fieldPatch)
      } else {
        mergedPatch[buildFlowDynamicTableExistsKey(item.table.slug || item.table.name)] = 'true'
        mergedPatch[`_tbl_exists__${item.table.id}`] = 'true'
      }
      records.push(extracted.readableRecord)
    }

    const summaryText = records
      .slice(0, 3)
      .map(rec => Object.entries(rec).map(([k, v]) => `${k}: ${v}`).join(', '))
      .filter(Boolean)
      .join(' | ')

    return {
      found: true,
      tableName: primary.table.name,
      record: records[0],
      records,
      fieldPatch: mergedPatch,
      message: summaryText
        ? `"${primary.table.name}" tablosunda kayıt bulundu: ${summaryText}`
        : `"${primary.table.name}" tablosunda eşleşen kayıt bulundu.`,
    }
  } catch (err) {
    console.warn('[queryDynamicTableRecord] Sorgu hatası:', err)
    return { found: false, fieldPatch: {}, message: 'Veri tablosu sorgulanırken bir sorun oluştu.' }
  }
}

/**
 * Akış sırasında toplanan `<tabloSlug>__<sutunSlug>` alanlarını ilgili dinamik
 * veri tablosuna (`dynamic_rows`) kaydeder veya benzersiz telefon sütunu eşleşirse günceller.
 */
export async function saveFlowDynamicRecord(params: {
  clinicId: string
  fields: Record<string, unknown>
  targetTableId?: string
  flowNodes?: Array<{ type?: string; data?: Record<string, unknown> }>
}): Promise<{ savedCount: number; rowIds: string[] }> {
  try {
    const { clinicId, fields, targetTableId, flowNodes } = params
    if (!clinicId || clinicId === 'memory') return { savedCount: 0, rowIds: [] }

    await ensureDynamicTablesSchema()

    const [tables, cols] = await Promise.all([
      db.select().from(dynamicTables).where(eq(dynamicTables.clinicId, clinicId)),
      db.select().from(dynamicColumns).where(eq(dynamicColumns.clinicId, clinicId)).orderBy(asc(dynamicColumns.sortOrder)),
    ])
    if (tables.length === 0) return { savedCount: 0, rowIds: [] }

    const colsByTable = new Map<string, Array<typeof dynamicColumns.$inferSelect>>()
    for (const c of cols) {
      const list = colsByTable.get(c.tableId) ?? []
      list.push(c)
      colsByTable.set(c.tableId, list)
    }

    const lowerFieldEntries = new Map<string, unknown>()
    for (const [k, v] of Object.entries(fields || {})) {
      if ((k.startsWith('_') && !k.startsWith('_col__')) || v === undefined || v === null) continue
      if (typeof v === 'string' && !v.trim()) continue
      if (Array.isArray(v) && v.length === 0) continue
      lowerFieldEntries.set(k.toLowerCase(), v)
    }

    // Akış düğümlerindeki sourceColumnId → eski/yeni fieldName eşlemesi (şema isim değişikliği dayanıklılığı)
    const fieldNamesByColumnId = new Map<string, string[]>()
    const flowSaveRecordTableIds = new Set<string>()
    let hasAutoSaveRecordNode = false
    for (const node of flowNodes || []) {
      const d = node.data || {}
      const colId = typeof d.sourceColumnId === 'string' ? d.sourceColumnId.trim() : ''
      const fn = typeof d.fieldName === 'string' ? d.fieldName.trim().toLowerCase() : ''
      if (colId && fn) {
        const list = fieldNamesByColumnId.get(colId) ?? []
        if (!list.includes(fn)) list.push(fn)
        fieldNamesByColumnId.set(colId, list)
      }
      if (node.type === 'ACTION' && d.action === 'save_record') {
        const rawTarget = String(d.targetTableId || d.targetTableSlug || d.targetTableName || '').trim()
        if (!rawTarget) {
          hasAutoSaveRecordNode = true
        } else {
          const matchedTbl = tables.find(
            t =>
              t.id === rawTarget ||
              t.slug.toLowerCase() === rawTarget.toLowerCase() ||
              t.name.toLocaleLowerCase('tr-TR') === rawTarget.toLocaleLowerCase('tr-TR'),
          )
          if (matchedTbl) flowSaveRecordTableIds.add(matchedTbl.id)
        }
      }
    }

    const normalizedTargetHint = targetTableId?.trim() || ''
    const resolvedExplicitTable = normalizedTargetHint
      ? tables.find(
          t =>
            t.id === normalizedTargetHint ||
            t.slug.toLowerCase() === normalizedTargetHint.toLowerCase() ||
            t.name.toLocaleLowerCase('tr-TR') === normalizedTargetHint.toLocaleLowerCase('tr-TR'),
        )
      : undefined

    const candidateTables = normalizedTargetHint
      ? resolvedExplicitTable
        ? [resolvedExplicitTable]
        : []
      : flowSaveRecordTableIds.size > 0 && !hasAutoSaveRecordNode
      ? tables.filter(t => flowSaveRecordTableIds.has(t.id))
      : tables

    const rowIds: string[] = []
    let cachedRelations: Array<typeof dynamicRelations.$inferSelect> | null = null
    const cachedTargetRowsByTable = new Map<string, Array<{ id: string; displayTitle: string }>>()

    const getClinicRelations = async () => {
      if (!cachedRelations) {
        cachedRelations = await db
          .select()
          .from(dynamicRelations)
          .where(eq(dynamicRelations.clinicId, clinicId))
      }
      return cachedRelations
    }

    const getTargetRowsForTable = async (linkedTableId: string) => {
      const existing = cachedTargetRowsByTable.get(linkedTableId)
      if (existing) return existing
      const fetched = await db
        .select({ id: dynamicRows.id, displayTitle: dynamicRows.displayTitle })
        .from(dynamicRows)
        .where(
          and(
            eq(dynamicRows.clinicId, clinicId),
            eq(dynamicRows.tableId, linkedTableId),
            eq(dynamicRows.isArchived, false),
          ),
        )
      cachedTargetRowsByTable.set(linkedTableId, fetched)
      return fetched
    }

    for (const table of candidateTables) {
      const tCols = colsByTable.get(table.id) ?? []
      if (tCols.length === 0) continue

      const isExplicitlyTargeted =
        resolvedExplicitTable?.id === table.id ||
        (!resolvedExplicitTable && flowSaveRecordTableIds.size === 1 && flowSaveRecordTableIds.has(table.id))

      const incomingByColId: Record<string, unknown> = {}
      const incomingRelationsByColId: Record<string, unknown> = {}
      for (const col of tCols) {
        const expectedKey = buildFlowDynamicFieldKey(table.slug || table.name, col.slug || col.name).toLowerCase()
        const directColKey = `_col__${col.id}`.toLowerCase()
        let matchedVal: unknown = undefined
        let hasMatch = false
        if (lowerFieldEntries.has(expectedKey)) {
          matchedVal = lowerFieldEntries.get(expectedKey)
          hasMatch = true
        } else if (lowerFieldEntries.has(directColKey)) {
          matchedVal = lowerFieldEntries.get(directColKey)
          hasMatch = true
        } else {
          const aliasKeys = fieldNamesByColumnId.get(col.id) || []
          const matchedAlias = aliasKeys.find(ak => lowerFieldEntries.has(ak))
          if (matchedAlias) {
            matchedVal = lowerFieldEntries.get(matchedAlias)
            hasMatch = true
          } else if (isExplicitlyTargeted && lowerFieldEntries.has((col.slug || '').toLowerCase())) {
            matchedVal = lowerFieldEntries.get((col.slug || '').toLowerCase())
            hasMatch = true
          }
        }
        if (hasMatch) {
          if (col.fieldType === 'relation') {
            incomingRelationsByColId[col.id] = matchedVal
          } else {
            incomingByColId[col.id] = matchedVal
          }
        }
      }

      const explicitColIds = new Set(Object.keys(incomingByColId))
      const hasExplicitTableData =
        explicitColIds.size > 0 || Object.keys(incomingRelationsByColId).length > 0

      // Hedef tablo açıkça seçilmişse veya otomatik modda bu tablonun sütunları toplanmışsa standart akış alanlarını eşle
      if (isExplicitlyTargeted || hasExplicitTableData) {
        for (const col of tCols) {
          if (col.fieldType === 'relation' || col.id in incomingByColId) continue
          const hay = `${col.name} ${col.slug}`.toLocaleLowerCase('tr-TR')
          if (col.fieldType === 'phone' || /^(telefon|tel|gsm|cep)/i.test(col.slug)) {
            const telVal = fields.telefon ?? fields._arayanNumara
            if (telVal) incomingByColId[col.id] = telVal
          } else if (col.isPrimaryTitle || /(ad_soyad|ad soyad|isim|müşteri adı|musteri_adi|hasta adı|hasta_adi)/i.test(hay)) {
            const nameVal = fields.musteri_adi ?? fields.ad_soyad ?? fields._dynamicCallerName
            if (nameVal) incomingByColId[col.id] = nameVal
          } else if (isExplicitlyTargeted && col.fieldType === 'date') {
            const dateVal = fields.tarih
            if (dateVal) incomingByColId[col.id] = dateVal
          } else if (isExplicitlyTargeted && col.fieldType === 'number' && /(puan|skor|derece)/i.test(hay)) {
            const scoreVal = fields.puan
            if (scoreVal) incomingByColId[col.id] = scoreVal
          } else if (isExplicitlyTargeted && col.fieldType === 'text' && /(not|şikayet|sikayet|talep|memnuniyet|açıklama|aciklama|yorum)/i.test(hay)) {
            const noteVal = fields.hastaNotu ?? fields.memnuniyet ?? fields.sikayet
            if (noteVal) incomingByColId[col.id] = noteVal
          }
        }
      }

      const resolvedRelationIdsByColId: Record<string, string[]> = {}
      if (Object.keys(incomingRelationsByColId).length > 0) {
        const rels = await getClinicRelations()
        const relById = new Map(rels.map(r => [r.id, r]))

        for (const [colId, rawRelVal] of Object.entries(incomingRelationsByColId)) {
          const col = tCols.find(c => c.id === colId)
          if (!col) continue
          const cfg = (col.config || {}) as DynamicColumnConfig
          const rel =
            (cfg.relationId ? relById.get(cfg.relationId) : undefined) ||
            rels.find(r => r.sourceColumnId === col.id || r.inverseColumnId === col.id)
          const linkedTableId =
            cfg.targetTableId ||
            (rel ? (rel.sourceColumnId === col.id ? rel.targetTableId : rel.sourceTableId) : undefined)
          if (!linkedTableId) continue

          const targetRows = await getTargetRowsForTable(linkedTableId)
          if (targetRows.length === 0) continue

          const matchTokenToRowId = (token: string): string | null => {
            const trimmed = token.trim()
            if (!trimmed) return null
            if (isValidUuid(trimmed) && targetRows.some(r => r.id === trimmed)) {
              return trimmed
            }
            const low = trimmed.toLocaleLowerCase('tr-TR')
            const exact = targetRows.find(
              r => String(r.displayTitle || '').trim().toLocaleLowerCase('tr-TR') === low,
            )
            if (exact) return exact.id
            if (low.length >= 3) {
              const fuzzyMatches = targetRows.filter(r => {
                const title = String(r.displayTitle || '').trim()
                if (!title || title === 'İsimsiz Kayıt') return false
                const titleLow = title.toLocaleLowerCase('tr-TR')
                return titleLow.includes(low) || low.includes(titleLow)
              })
              if (fuzzyMatches.length === 1) return fuzzyMatches[0]!.id
            }
            return null
          }

          const matchedIds: string[] = []
          if (Array.isArray(rawRelVal)) {
            for (const item of rawRelVal) {
              const id = matchTokenToRowId(String(item ?? ''))
              if (id && !matchedIds.includes(id)) matchedIds.push(id)
            }
          } else {
            const wholeStr = String(rawRelVal ?? '').trim()
            const wholeMatch = matchTokenToRowId(wholeStr)
            if (wholeMatch) {
              matchedIds.push(wholeMatch)
            } else {
              for (const part of wholeStr.split(/[,;|]+/)) {
                const id = matchTokenToRowId(part)
                if (id && !matchedIds.includes(id)) matchedIds.push(id)
              }
            }
          }

          if (matchedIds.length > 0) {
            resolvedRelationIdsByColId[col.id] = matchedIds
          }
        }
      }

      if (
        Object.keys(incomingByColId).length === 0 &&
        Object.keys(resolvedRelationIdsByColId).length === 0
      ) {
        continue
      }

      // Benzersiz telefon sütunu veya müşteri/rehber tablosundaki telefon sütunu eşleşirse mevcut kaydı güncelle
      const tableIdentityText = `${table.name} ${table.slug}`
      const isCustomerDirectoryTable =
        /(musteri|müşteri|hasta|danisan|danışan|kisi|kişi|rehber|uye|üye)/i.test(tableIdentityText) &&
        !/(anket|form|talep|sikayet|şikayet|gorus|görüş|degerlendirme|değerlendirme)/i.test(tableIdentityText)
      const phoneUpsertCol =
        tCols.find(c => (c.fieldType === 'phone' || /^(telefon|tel|gsm)/i.test(c.slug)) && c.isUnique) ??
        (isCustomerDirectoryTable
          ? tCols.find(c => c.fieldType === 'phone' || /^(telefon|tel|gsm|cep)/i.test(c.slug))
          : undefined)

      let existingRow: (typeof dynamicRows.$inferSelect) | undefined
      if (phoneUpsertCol) {
        const rawPhoneCandidate = incomingByColId[phoneUpsertCol.id] ?? fields.telefon ?? fields._arayanNumara
        const digits = String(rawPhoneCandidate ?? '').replace(/\D/g, '').slice(-10)
        if (digits.length === 10) {
          const candidates = await db
            .select()
            .from(dynamicRows)
            .where(
              and(
                eq(dynamicRows.clinicId, clinicId),
                eq(dynamicRows.tableId, table.id),
                eq(dynamicRows.isArchived, false),
                sql`right(regexp_replace(coalesce(${dynamicRows.values} ->> ${phoneUpsertCol.id}, ''), '[^0-9]', '', 'g'), 10) = ${digits}`,
              ),
            )
            .limit(10)
          existingRow = candidates.find(r => {
            const vals = (r.values ?? {}) as Record<string, unknown>
            return String(vals[phoneUpsertCol.id] ?? '').replace(/\D/g, '').slice(-10) === digits
          })
          if (!existingRow && !(phoneUpsertCol.id in incomingByColId) && rawPhoneCandidate) {
            incomingByColId[phoneUpsertCol.id] = String(rawPhoneCandidate)
          }
        }
      }

      const baseValues = existingRow ? ((existingRow.values ?? {}) as Record<string, unknown>) : {}
      const preparedValues: Record<string, unknown> = { ...baseValues }

      for (const col of tCols) {
        if (col.fieldType === 'relation') continue
        if (col.id in incomingByColId) {
          // Mevcut satır güncellenirken açıkça gönderilmemiş otomatik bağlam alanları dolu hücreyi ezmesin
          if (
            existingRow &&
            !explicitColIds.has(col.id) &&
            baseValues[col.id] !== undefined &&
            baseValues[col.id] !== null &&
            String(baseValues[col.id]).trim() !== ''
          ) {
            continue
          }
          try {
            let candidateVal = incomingByColId[col.id]
            if ((col.fieldType === 'number' || col.fieldType === 'currency') && typeof candidateVal === 'string') {
              let cleaned = candidateVal.replace(/[₺$€£]|TL|TRY/gi, '').replace(/\s/g, '')
              if (cleaned.includes('.') && cleaned.includes(',')) {
                cleaned =
                  cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
                    ? cleaned.replace(/\./g, '').replace(',', '.')
                    : cleaned.replace(/,/g, '')
              } else if (cleaned.includes(',')) {
                cleaned = cleaned.replace(',', '.')
              }
              candidateVal = cleaned
            }
            preparedValues[col.id] = coerceColumnValue(
              col.fieldType as DynamicFieldType,
              candidateVal,
              col.config as DynamicColumnConfig,
            )
          } catch {
            preparedValues[col.id] = col.fieldType === 'text' ? String(incomingByColId[col.id] ?? '') : (preparedValues[col.id] ?? null)
          }
        } else if (!(col.id in preparedValues)) {
          preparedValues[col.id] = col.fieldType === 'boolean' ? false : col.fieldType === 'multiselect' ? [] : null
        }
      }

      const computedTitle = computeDisplayTitle(tCols, preparedValues)
      const displayTitle =
        existingRow &&
        existingRow.displayTitle &&
        (explicitColIds.size === 0 || (computedTitle === 'İsimsiz Kayıt' && existingRow.displayTitle !== 'İsimsiz Kayıt'))
          ? existingRow.displayTitle
          : computedTitle

      let savedRowId: string | undefined
      if (existingRow) {
        await db
          .update(dynamicRows)
          .set({
            values: preparedValues,
            displayTitle,
            updatedAt: new Date(),
          })
          .where(eq(dynamicRows.id, existingRow.id))
        savedRowId = existingRow.id
        rowIds.push(existingRow.id)
      } else {
        const [inserted] = await db
          .insert(dynamicRows)
          .values({
            clinicId,
            tableId: table.id,
            displayTitle,
            values: preparedValues,
            isArchived: false,
          })
          .returning({ id: dynamicRows.id })
        if (inserted?.id) {
          savedRowId = inserted.id
          rowIds.push(inserted.id)
        }
      }

      if (savedRowId && Object.keys(resolvedRelationIdsByColId).length > 0) {
        await syncRowLinksForColumns(clinicId, table.id, savedRowId, resolvedRelationIdsByColId)
        cachedTargetRowsByTable.delete(table.id)
      }
    }

    return { savedCount: rowIds.length, rowIds }
  } catch (err) {
    console.error('[saveFlowDynamicRecord] Kayıt sırasında hata oluştu:', err)
    return { savedCount: 0, rowIds: [] }
  }
}

export interface HydratedFlowDynamicFieldMeta {
  options: string[]
  allowMultiple: boolean
  columnType: string
}

/**
 * Akıştaki FIELD düğümlerinin bağlı olduğu dinamik tablo sütunlarının güncel seçeneklerini
 * (select, multiselect ve relation hedef tablo aktif satır başlıklarını) canlı veritabanından çözer.
 * Böylece Veri Stüdyosunda yeni satır veya seçenek eklendiğinde akışı yeniden kaydetmeye gerek kalmaz.
 */
export async function hydrateFlowFieldDynamicOptions(
  flowNodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>,
  explicitClinicId?: string,
): Promise<Map<string, HydratedFlowDynamicFieldMeta>> {
  const result = new Map<string, HydratedFlowDynamicFieldMeta>()
  try {
    const clinicId = explicitClinicId || currentClinicId()
    if (!clinicId || clinicId === 'memory') return result

    const candidateNodes = (flowNodes || []).filter(n => {
      if (n.type !== 'FIELD' || !n.data) return false
      return Boolean(n.data.sourceColumnId) || String(n.data.fieldName || '').includes('__')
    })
    if (candidateNodes.length === 0) return result

    await ensureDynamicTablesSchema()
    const [tables, cols] = await Promise.all([
      db.select().from(dynamicTables).where(eq(dynamicTables.clinicId, clinicId)),
      db.select().from(dynamicColumns).where(eq(dynamicColumns.clinicId, clinicId)).orderBy(asc(dynamicColumns.sortOrder)),
    ])
    if (tables.length === 0 || cols.length === 0) return result

    const tableById = new Map(tables.map(t => [t.id, t]))
    const colById = new Map(cols.map(c => [c.id, c]))
    const colByFlowKey = new Map<string, typeof cols[number]>()
    for (const c of cols) {
      const tbl = tableById.get(c.tableId)
      if (!tbl) continue
      const fk = buildFlowDynamicFieldKey(tbl.slug || tbl.name, c.slug || c.name).toLowerCase()
      colByFlowKey.set(fk, c)
    }

    let relationsCache: Array<typeof dynamicRelations.$inferSelect> | null = null
    const targetTitlesCache = new Map<string, string[]>()

    const getRelations = async () => {
      if (!relationsCache) {
        relationsCache = await db
          .select()
          .from(dynamicRelations)
          .where(eq(dynamicRelations.clinicId, clinicId))
      }
      return relationsCache
    }

    const getActiveTargetTitles = async (linkedTableId: string): Promise<string[]> => {
      const cached = targetTitlesCache.get(linkedTableId)
      if (cached) return cached
      const rows = await db
        .select({ displayTitle: dynamicRows.displayTitle })
        .from(dynamicRows)
        .where(
          and(
            eq(dynamicRows.clinicId, clinicId),
            eq(dynamicRows.tableId, linkedTableId),
            eq(dynamicRows.isArchived, false),
          ),
        )
        .orderBy(asc(dynamicRows.createdAt), asc(dynamicRows.displayTitle))
        .limit(100)
      const titles = Array.from(
        new Set(
          rows
            .map(r => String(r.displayTitle || '').trim())
            .filter(t => Boolean(t) && t !== 'İsimsiz Kayıt'),
        ),
      )
      targetTitlesCache.set(linkedTableId, titles)
      return titles
    }

    for (const node of candidateNodes) {
      const d = node.data || {}
      const colIdHint = typeof d.sourceColumnId === 'string' ? d.sourceColumnId.trim() : ''
      const fnHint = typeof d.fieldName === 'string' ? d.fieldName.trim().toLowerCase() : ''
      const col = (colIdHint ? colById.get(colIdHint) : undefined) ?? (fnHint ? colByFlowKey.get(fnHint) : undefined)
      if (!col) continue

      const cfg = (col.config || {}) as DynamicColumnConfig
      if (col.fieldType === 'select' || col.fieldType === 'multiselect') {
        const opts = Array.isArray(cfg.options)
          ? cfg.options.map(o => String(o.label || '').trim()).filter(Boolean)
          : []
        result.set(node.id, {
          options: opts,
          allowMultiple: col.fieldType === 'multiselect',
          columnType: col.fieldType,
        })
      } else if (col.fieldType === 'relation') {
        const rels = await getRelations()
        const rel =
          (cfg.relationId ? rels.find(r => r.id === cfg.relationId) : undefined) ??
          rels.find(r => r.sourceColumnId === col.id || r.inverseColumnId === col.id)
        const linkedTableId =
          cfg.targetTableId ||
          (rel ? (rel.sourceColumnId === col.id ? rel.targetTableId : rel.sourceTableId) : undefined)
        const allowMultiple =
          cfg.allowMultiple !== undefined
            ? Boolean(cfg.allowMultiple)
            : rel
            ? rel.sourceColumnId === col.id
              ? rel.cardinality !== 'one_to_one'
              : rel.cardinality === 'many_to_many'
            : false
        const titles = linkedTableId ? await getActiveTargetTitles(linkedTableId) : []
        result.set(node.id, {
          options: titles,
          allowMultiple,
          columnType: 'relation',
        })
      }
    }
  } catch {
    // Canlı seçenek zenginleştirmesi başarısız olursa akış düğümündeki statik veri kullanılır
  }
  return result
}

// ── Dynamic Flow Auto-Template Builder & Synchronizer ───────────────────────

export const DYNAMIC_AUTO_TEMPLATE_FLOW_NAME = 'dynamic-auto-template'
export const VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID = '__appointment_calendar__'

export const LEGACY_SEED_FLOW_NAMES = new Set<string>([
  'dental-branching',
  'Varsayılan Gelen Arama Akışı',
  'Anket Akışı (Giden Arama)',
  'Hızlı Web Randevu Akışı (2 Soru)',
  'WhatsApp Akışı',
])

type StudioSchemaSnapshot = Awaited<ReturnType<typeof getStudioSchema>>
type StudioTableSnapshot = StudioSchemaSnapshot['tables'][number]
type StudioColumnSnapshot = StudioTableSnapshot['columns'][number]

function mapBackendFieldTypeForFlow(
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

function resolveClinicFlowProfile(studio: StudioSchemaSnapshot) {
  const tables = studio.tables || []
  const appointmentConfigs = studio.appointmentConfigs || []
  const moduleConfigs = studio.moduleConfigs || []

  const personRegex =
    /(hasta|musteri|müşteri|danisan|danışan|alici|alıcı|kiraci|kiracı|sigortali|sigortalı|sahip|arac_sahibi|uye|üye|kisi|kişi|rehber|iletisim|iletişim|aday|lead|crm)/i
  const secondaryRegex =
    /(hizmet|islem|işlem|tedavi|randevu|seans|mulk|mülk|ilan|portfoy|portföy|arac|araç|police|poliçe|urun|ürün|stok|demirbas|demirbaş|talep|basvuru|başvuru|anket|destek|sikayet|şikayet|servis)/i

  const combinedAll = tables
    .map(t => `${t.name} ${t.slug} ${(t.columns || []).map(c => c.slug).join(' ')}`)
    .join(' ')

  let sectorKind = 'generic'
  if (currentBusinessTemplate() === 'dental_clinic' && /dis|diş|dental|muayene|implant|kanal|klinik|ortodonti/i.test(combinedAll)) sectorKind = 'dental'
  else if (/emlak|mulk|mülk|daire|konut|kiraci|kiracı|portfoy|portföy|tapu|ilan_linki|ilan_basligi|\bilan\b|sahibinden|hepsiemlak|emlakjet/i.test(combinedAll)) sectorKind = 'real_estate'
  else if (/sigorta|police|poliçe|kasko|hasar|teklif/i.test(combinedAll)) sectorKind = 'insurance'
  else if (/arac|araç|servis|plaka|otomotiv|bakim|bakım/i.test(combinedAll)) sectorKind = 'automotive'
  else if (/danisman|danışman|seans|psikolog|terapi/i.test(combinedAll)) sectorKind = 'consulting'
  else if (/destek|ticket|sikayet|şikayet|cagri|çağrı/i.test(combinedAll)) sectorKind = 'support'
  else if (/stok|urun|ürün|demirbas|demirbaş|envanter|depo/i.test(combinedAll)) sectorKind = 'inventory'

  let primaryTable: StudioTableSnapshot | null = null
  const personMod = moduleConfigs.find(
    mc =>
      mc.enabled &&
      /(patient|customer|client|crm|person|contact|member|musteri|hasta|danisan)/i.test(mc.moduleRole),
  )
  if (personMod) primaryTable = tables.find(t => t.id === personMod.tableId) ?? null
  if (!primaryTable) {
    const reqAppt =
      appointmentConfigs.find(ac => ac.enabled && ac.isRequiredInAppointment && !ac.allowMultiple) ??
      appointmentConfigs.find(ac => ac.enabled && !ac.allowMultiple)
    if (reqAppt) primaryTable = tables.find(t => t.id === reqAppt.tableId) ?? null
  }
  if (!primaryTable) {
    primaryTable =
      tables.find(
        t =>
          personRegex.test(`${t.name} ${t.slug}`) &&
          (t.columns || []).some(c => c.fieldType === 'phone' || /telefon|phone|gsm/i.test(`${c.slug} ${c.name}`)),
      ) ??
      tables.find(t => personRegex.test(`${t.name} ${t.slug}`)) ??
      tables.find(t => (t.columns || []).some(c => c.fieldType === 'phone')) ??
      tables[0] ??
      null
  }

  const isExplicitServiceRole = (role: string) =>
    /(service|product|catalog|listing|treatment|policy|vehicle|hizmet|urun|ilan|tedavi)/i.test(role) &&
    !/(stock_inventory|asset_maintenance|finance_)/i.test(role)

  let secondaryTable: StudioTableSnapshot | null = null
  const serviceMod = moduleConfigs.find(
    mc =>
      mc.enabled &&
      mc.tableId !== primaryTable?.id &&
      isExplicitServiceRole(mc.moduleRole),
  )
  if (serviceMod) secondaryTable = tables.find(t => t.id === serviceMod.tableId) ?? null
  if (!secondaryTable) {
    const multiAppt =
      appointmentConfigs.find(ac => ac.enabled && ac.allowMultiple && ac.tableId !== primaryTable?.id) ??
      appointmentConfigs.find(ac => ac.enabled && ac.tableId !== primaryTable?.id)
    if (multiAppt) secondaryTable = tables.find(t => t.id === multiAppt.tableId) ?? null
  }
  if (!secondaryTable) {
    const inventoryOrAssetMod = moduleConfigs.find(
      mc =>
        mc.enabled &&
        mc.tableId !== primaryTable?.id &&
        /(inventory|asset|stok|demirbas)/i.test(mc.moduleRole) &&
        !/finance_/i.test(mc.moduleRole),
    )
    if (inventoryOrAssetMod) secondaryTable = tables.find(t => t.id === inventoryOrAssetMod.tableId) ?? null
  }
  if (!secondaryTable) {
    secondaryTable =
      tables.find(
        t =>
          t.id !== primaryTable?.id &&
          secondaryRegex.test(`${t.name} ${t.slug}`) &&
          !/(stok|envanter|demirbas|gelir|gider|masraf|bakim)/i.test(`${t.name} ${t.slug}`),
      ) ??
      tables.find(t => t.id !== primaryTable?.id && secondaryRegex.test(`${t.name} ${t.slug}`)) ??
      tables.find(t => t.id !== primaryTable?.id) ??
      null
  }

  const primaryAppt = appointmentConfigs.find(ac => ac.tableId === primaryTable?.id)
  const nameCol: StudioColumnSnapshot | null =
    (primaryAppt?.titleColumnId && primaryTable?.columns.find(c => c.id === primaryAppt.titleColumnId)) ||
    primaryTable?.columns.find(c => /^(ad_soyad|adsoyad|full_name|hasta_adi|musteri_adi|isim|ad|unvan)$/i.test(c.slug)) ||
    primaryTable?.columns.find(c => c.isPrimaryTitle && c.fieldType === 'text') ||
    primaryTable?.columns.find(c => /ad|isim|unvan|name|baslik/i.test(`${c.slug} ${c.name}`)) ||
    primaryTable?.columns.find(c => c.fieldType === 'text') ||
    null

  const phoneCol: StudioColumnSnapshot | null =
    (primaryAppt?.phoneColumnId && primaryTable?.columns.find(c => c.id === primaryAppt.phoneColumnId)) ||
    primaryTable?.columns.find(c => c.fieldType === 'phone' || /telefon|phone|gsm|cep/i.test(`${c.slug} ${c.name}`)) ||
    null

  const excluded = new Set([nameCol?.id, phoneCol?.id].filter(Boolean))
  const pickTopicCol = (tbl: StudioTableSnapshot | null): StudioColumnSnapshot | null => {
    if (!tbl) return null
    const cols = tbl.columns.filter(c => !excluded.has(c.id))
    return (
      cols.find(c => c.fieldType === 'select') ||
      cols.find(c => c.fieldType === 'relation') ||
      cols.find(c => c.fieldType === 'boolean') ||
      cols.find(c => c.isPrimaryTitle) ||
      cols.find(c => c.fieldType === 'text') ||
      cols[0] ||
      null
    )
  }

  const secCol = pickTopicCol(secondaryTable)
  const priCol = pickTopicCol(primaryTable)
  const topicTable = secCol ? secondaryTable : priCol ? primaryTable : null
  const topicCol = secCol || priCol

  let linkTable: StudioTableSnapshot | null = null
  let linkCol: StudioColumnSnapshot | null = null
  const linkSearchTables = [secondaryTable, primaryTable, ...tables].filter(
    (t, idx, arr): t is StudioTableSnapshot => Boolean(t) && arr.findIndex(x => x?.id === t!.id) === idx,
  )
  for (const tbl of linkSearchTables) {
    const found = tbl.columns.find(
      c =>
        !excluded.has(c.id) &&
        c.fieldType === 'text' &&
        /(ilan_link|link|url|baglanti|bağlantı)/i.test(`${c.slug} ${c.name}`),
    )
    if (found) {
      linkTable = tbl
      linkCol = found
      break
    }
  }

  let ratingTable: StudioTableSnapshot | null = null
  let ratingCol: StudioColumnSnapshot | null = null
  for (const tbl of tables) {
    const found = tbl.columns.find(c => /(memnuniyet|puan|skor|rating|degerlendirme|değerlendirme)/i.test(`${c.slug} ${c.name}`))
    if (found) {
      ratingTable = tbl
      ratingCol = found
      break
    }
  }

  const primaryText = `${primaryTable?.name || ''} ${primaryTable?.slug || ''}`
  const entitySingular = /hasta/i.test(primaryText)
    ? 'Hasta'
    : /danisan|danışan/i.test(primaryText)
      ? 'Danışan'
      : /alici|alıcı/i.test(primaryText)
        ? 'Alıcı'
        : /kiraci|kiracı/i.test(primaryText)
          ? 'Kiracı'
          : /sigortali|sigortalı/i.test(primaryText)
            ? 'Sigortalı'
            : /arac_sahib|araç sahib/i.test(primaryText)
              ? 'Araç Sahibi'
              : /uye|üye/i.test(primaryText)
                ? 'Üye'
                : 'Müşteri'

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

  return {
    primaryTable,
    secondaryTable,
    nameCol,
    phoneCol,
    topicTable,
    topicCol,
    linkTable,
    linkCol,
    ratingTable,
    ratingCol,
    entitySingular,
    entityLower: entitySingular.toLocaleLowerCase('tr-TR'),
    appointmentNoun,
  }
}

function buildServerFieldData(
  table: StudioTableSnapshot,
  col: StudioColumnSnapshot,
  fallbackQuestion?: string,
): FlowNode['data'] {
  const cfg = (col.config || {}) as DynamicColumnConfig
  const enumValues =
    (col.fieldType === 'select' || col.fieldType === 'multiselect') && Array.isArray(cfg.options)
      ? cfg.options.map(o => String(o.label || '').trim()).filter(Boolean)
      : undefined
  const defaultQuestion =
    fallbackQuestion ||
    cfg.helpText ||
    (/telefon|phone|gsm/i.test(`${col.slug} ${col.name}`)
      ? 'Size ulaşabileceğimiz telefon numaranızı alabilir miyim?'
      : /ad_soyad|isim|ad$/i.test(col.slug)
        ? 'Adınızı ve soyisminizi öğrenebilir miyim?'
        : `${col.name} bilginizi paylaşabilir misiniz?`)

  return {
    fieldName: buildFlowDynamicFieldKey(table.slug || table.name, col.slug || col.name),
    label: `${table.name} · ${col.name}`,
    fieldType: mapBackendFieldTypeForFlow(col.fieldType),
    ...(enumValues?.length ? { enumValues } : {}),
    required: col.isRequired !== false,
    description: defaultQuestion,
    sourceTableId: table.id,
    sourceTableSlug: table.slug,
    sourceTableName: table.name,
    sourceColumnId: col.id,
    sourceColumnSlug: col.slug,
    sourceColumnName: col.name,
    sourceColumnType: col.fieldType,
  }
}

export function buildClinicDynamicFlowForDirection(
  direction: string,
  studio: StudioSchemaSnapshot,
): { name: string; nodes: FlowNode[]; edges: FlowEdge[] } {
  const profile = resolveClinicFlowProfile(studio)
  const {
    primaryTable,
    secondaryTable,
    nameCol,
    phoneCol,
    topicTable,
    topicCol,
    linkTable,
    linkCol,
    ratingTable,
    ratingCol,
    entitySingular,
    entityLower,
    appointmentNoun,
  } = profile

  const nameNodeData: FlowNode['data'] =
    primaryTable && nameCol
      ? buildServerFieldData(primaryTable, nameCol)
      : {
          fieldName: 'ad_soyad',
          label: 'Ad Soyad',
          fieldType: 'text',
          required: true,
          description: 'Adınızı ve soyisminizi öğrenebilir miyim?',
        }

  const phoneNodeData: FlowNode['data'] =
    primaryTable && phoneCol
      ? buildServerFieldData(primaryTable, phoneCol)
      : {
          fieldName: 'telefon',
          label: 'Telefon Numarası',
          fieldType: 'phone',
          required: true,
          description: 'Size ulaşabileceğimiz telefon numaranızı alabilir miyim?',
        }

  const topicCustomHelp = String(((topicCol?.config || {}) as DynamicColumnConfig).helpText || '').trim()
  const topicLinkHint =
    !topicCustomHelp && linkTable && linkCol && topicTable?.id === linkTable.id && topicCol
      ? `${topicCol.name} bilginizi veya ilgilendiğiniz ilanın adını paylaşabilir misiniz? (WhatsApp üzerinden doğrudan ilan linki de gönderebilirsiniz.)`
      : undefined

  const topicNodeData: FlowNode['data'] =
    topicTable && topicCol && topicCol.id !== nameCol?.id && topicCol.id !== phoneCol?.id
      ? buildServerFieldData(topicTable, topicCol, topicLinkHint)
      : {
          fieldName: 'talep_konusu',
          label: secondaryTable ? `${secondaryTable.name} · Talep` : 'Talep / Konu',
          fieldType: 'text',
          required: false,
          description: secondaryTable
            ? `Hangi ${secondaryTable.name.toLocaleLowerCase('tr-TR')} hakkında görüşmek istersiniz?`
            : 'Talebinizi kısaca paylaşır mısınız?',
        }

  const linkNodeData: FlowNode['data'] | null =
    linkTable && linkCol && linkCol.id !== nameCol?.id && linkCol.id !== phoneCol?.id
      ? {
          ...buildServerFieldData(
            linkTable,
            linkCol,
            'İlgilendiğiniz ilanın linkini (ör. Sahibinden, Hepsiemlak) veya ilan adını paylaşabilir misiniz?',
          ),
          required: false,
        }
      : null
  const hasDistinctTopicNode = !(
    linkNodeData &&
    topicTable?.id === linkTable?.id &&
    topicCol?.id === linkCol?.id
  )

  const dateNodeData: FlowNode['data'] = {
    fieldName: 'tarih',
    label: 'Randevu Takvimi · Randevu Tarihi',
    fieldType: 'date',
    required: true,
    description: 'Hangi gün için randevu oluşturmamı istersiniz?',
    sourceTableId: VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID,
    sourceTableSlug: 'randevu_takvimi',
    sourceTableName: 'Randevu Takvimi',
    sourceColumnId: '__appt_date__',
    sourceColumnSlug: 'tarih',
    sourceColumnName: 'Randevu Tarihi',
    sourceColumnType: 'date',
  }

  const timeNodeData: FlowNode['data'] = {
    fieldName: 'saat',
    label: 'Randevu Takvimi · Randevu Saati',
    fieldType: 'time',
    required: true,
    description: 'Saat kaç sizin için uygundur?',
    sourceTableId: VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID,
    sourceTableSlug: 'randevu_takvimi',
    sourceTableName: 'Randevu Takvimi',
    sourceColumnId: '__appt_time__',
    sourceColumnSlug: 'saat',
    sourceColumnName: 'Randevu Saati',
    sourceColumnType: 'text',
  }

  const condRule: FlowConditionRule = primaryTable
    ? {
        field: buildFlowDynamicTableExistsKey(primaryTable.slug || primaryTable.name),
        fieldLabel: `${primaryTable.name} · Bu tabloda kayıtlı mı?`,
        operator: 'equals',
        value: 'true',
        sourceTableId: primaryTable.id,
        sourceTableSlug: primaryTable.slug,
        sourceTableName: primaryTable.name,
        sourceColumnId: '__row_exists__',
        sourceColumnSlug: '__row_exists__',
        sourceColumnName: 'Bu tabloda kayıtlı mı?',
        sourceColumnType: 'boolean',
      }
    : {
        field: 'caller.hasUpcomingAppointment',
        fieldLabel: 'Randevu Takvimi · Yaklaşan randevusu var mı?',
        operator: 'equals',
        value: 'true',
        sourceTableId: VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID,
        sourceTableSlug: 'randevu_takvimi',
        sourceTableName: 'Randevu Takvimi',
        sourceColumnId: '__row_exists__',
        sourceColumnSlug: '__row_exists__',
        sourceColumnName: 'Yaklaşan randevusu var mı?',
        sourceColumnType: 'boolean',
      }

  const condNodeData: FlowNode['data'] = {
    label: primaryTable ? `${entitySingular} Kayıtlı mı?` : 'Yaklaşan Randevusu Var mı?',
    conditionField: condRule.field,
    conditionFieldLabel: condRule.fieldLabel,
    operator: condRule.operator,
    conditionValue: condRule.value,
    sourceTableId: condRule.sourceTableId,
    sourceTableSlug: condRule.sourceTableSlug,
    sourceTableName: condRule.sourceTableName,
    sourceColumnId: condRule.sourceColumnId,
    sourceColumnSlug: condRule.sourceColumnSlug,
    sourceColumnName: condRule.sourceColumnName,
    sourceColumnType: condRule.sourceColumnType,
    conditionLogic: 'AND',
    rules: [condRule],
  }

  if (direction === 'outbound') {
    const feedbackField: FlowNode['data'] =
      ratingTable && ratingCol
        ? buildServerFieldData(ratingTable, ratingCol, `Son ${appointmentNoun.toLocaleLowerCase('tr-TR')} deneyiminizden memnun kaldınız mı?`)
        : topicTable && topicCol
          ? buildServerFieldData(topicTable, topicCol, `Size sunduğumuz hizmet hakkında geri bildiriminizi paylaşır mısınız?`)
          : {
              fieldName: 'memnuniyet',
              label: `${entitySingular} Memnuniyeti`,
              fieldType: 'text',
              required: true,
              description: 'Hizmetimizden memnun kaldınız mı?',
            }

    let outCondData: FlowNode['data'] = condNodeData
    if (ratingTable && ratingCol) {
      const cfg = (ratingCol.config || {}) as DynamicColumnConfig
      const opts = Array.isArray(cfg.options) ? cfg.options.map(o => String(o.label || '').trim()).filter(Boolean) : []
      const op = ratingCol.fieldType === 'number' || ratingCol.fieldType === 'currency' ? 'gte' : ratingCol.fieldType === 'boolean' ? 'equals' : opts.length ? 'equals' : 'notEmpty'
      const val = ratingCol.fieldType === 'number' || ratingCol.fieldType === 'currency' ? '7' : ratingCol.fieldType === 'boolean' ? 'true' : opts[0] || ''
      const r: FlowConditionRule = {
        field: buildFlowDynamicFieldKey(ratingTable.slug, ratingCol.slug),
        fieldLabel: `${ratingTable.name} · ${ratingCol.name}`,
        operator: op,
        value: val,
        sourceTableId: ratingTable.id,
        sourceTableSlug: ratingTable.slug,
        sourceTableName: ratingTable.name,
        sourceColumnId: ratingCol.id,
        sourceColumnSlug: ratingCol.slug,
        sourceColumnName: ratingCol.name,
        sourceColumnType: ratingCol.fieldType,
      }
      outCondData = {
        label: `${ratingCol.name} Olumlu mu?`,
        conditionField: r.field,
        conditionFieldLabel: r.fieldLabel,
        operator: r.operator,
        conditionValue: r.value,
        sourceTableId: r.sourceTableId,
        sourceTableSlug: r.sourceTableSlug,
        sourceTableName: r.sourceTableName,
        sourceColumnId: r.sourceColumnId,
        sourceColumnSlug: r.sourceColumnSlug,
        sourceColumnName: r.sourceColumnName,
        sourceColumnType: r.sourceColumnType,
        conditionLogic: 'AND',
        rules: [r],
      }
    }

    return {
      name: DYNAMIC_AUTO_TEMPLATE_FLOW_NAME,
      nodes: [
        { id: 'start', type: 'START', position: { x: 250, y: 20 }, data: { label: 'Giden Arama Başladı' } },
        { id: 'f_feedback', type: 'FIELD', position: { x: 250, y: 150 }, data: feedbackField },
        { id: 'cond_eval', type: 'CONDITION', position: { x: 250, y: 290 }, data: outCondData },
        { id: 'end_happy', type: 'END', position: { x: 80, y: 450 }, data: { label: 'Olumlu Kapanış', message: 'Değerli geri bildiriminiz için teşekkür ederiz, iyi günler!' } },
        { id: 'act_note', type: 'ACTION', position: { x: 420, y: 450 }, data: { action: 'save_patient_note', label: `🗒️ ${entitySingular} Geri Bildirim Notu` } },
        { id: 'end_followup', type: 'END', position: { x: 420, y: 590 }, data: { label: 'Takip Kapanışı', message: 'Notunuz ekibimize iletildi, sizinle ilgilenilecektir.' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'f_feedback' },
        { id: 'e2', source: 'f_feedback', target: 'cond_eval' },
        { id: 'e3', source: 'cond_eval', target: 'end_happy', sourceHandle: 'true', label: 'Evet' },
        { id: 'e4', source: 'cond_eval', target: 'act_note', sourceHandle: 'false', label: 'Hayır' },
        { id: 'e5', source: 'act_note', target: 'end_followup' },
      ],
    }
  }

  if (direction === 'web') {
    if (linkNodeData) {
      const yOff = hasDistinctTopicNode ? 130 : 0
      return {
        name: DYNAMIC_AUTO_TEMPLATE_FLOW_NAME,
        nodes: [
          { id: 'start', type: 'START', position: { x: 260, y: 20 }, data: { label: 'Web Karşılama Mesajı' } },
          { id: 'f_name', type: 'FIELD', position: { x: 260, y: 140 }, data: nameNodeData },
          { id: 'f_phone', type: 'FIELD', position: { x: 260, y: 270 }, data: phoneNodeData },
          { id: 'f_link', type: 'FIELD', position: { x: 260, y: 400 }, data: linkNodeData },
          ...(hasDistinctTopicNode
            ? [{ id: 'f_topic', type: 'FIELD' as const, position: { x: 260, y: 530 }, data: topicNodeData }]
            : []),
          { id: 'f_date', type: 'FIELD', position: { x: 260, y: 530 + yOff }, data: dateNodeData },
          { id: 'f_time', type: 'FIELD', position: { x: 260, y: 660 + yOff }, data: timeNodeData },
          { id: 'act_save', type: 'ACTION', position: { x: 260, y: 790 + yOff }, data: { action: 'save_appointment_pending', label: `📝 ${appointmentNoun} Talebi Oluştur` } },
          { id: 'end', type: 'END', position: { x: 260, y: 920 + yOff }, data: { label: 'Görüşmeyi Bitir', message: `${appointmentNoun} talebiniz alınmıştır, iyi günler dileriz.` } },
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
              { id: 'e8', source: 'act_save', target: 'end' },
            ]
          : [
              { id: 'e1', source: 'start', target: 'f_name' },
              { id: 'e2', source: 'f_name', target: 'f_phone' },
              { id: 'e3', source: 'f_phone', target: 'f_link' },
              { id: 'e4', source: 'f_link', target: 'f_date' },
              { id: 'e5', source: 'f_date', target: 'f_time' },
              { id: 'e6', source: 'f_time', target: 'act_save' },
              { id: 'e7', source: 'act_save', target: 'end' },
            ],
      }
    }

    return {
      name: DYNAMIC_AUTO_TEMPLATE_FLOW_NAME,
      nodes: [
        { id: 'start', type: 'START', position: { x: 260, y: 20 }, data: { label: 'Web Karşılama Mesajı' } },
        { id: 'f_name', type: 'FIELD', position: { x: 260, y: 140 }, data: nameNodeData },
        { id: 'f_phone', type: 'FIELD', position: { x: 260, y: 270 }, data: phoneNodeData },
        { id: 'f_topic', type: 'FIELD', position: { x: 260, y: 400 }, data: topicNodeData },
        { id: 'f_date', type: 'FIELD', position: { x: 260, y: 530 }, data: dateNodeData },
        { id: 'f_time', type: 'FIELD', position: { x: 260, y: 660 }, data: timeNodeData },
        { id: 'act_save', type: 'ACTION', position: { x: 260, y: 790 }, data: { action: 'save_appointment_pending', label: `📝 ${appointmentNoun} Talebi Oluştur` } },
        { id: 'end', type: 'END', position: { x: 260, y: 920 }, data: { label: 'Görüşmeyi Bitir', message: `${appointmentNoun} talebiniz alınmıştır, iyi günler dileriz.` } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'f_name' },
        { id: 'e2', source: 'f_name', target: 'f_phone' },
        { id: 'e3', source: 'f_phone', target: 'f_topic' },
        { id: 'e4', source: 'f_topic', target: 'f_date' },
        { id: 'e5', source: 'f_date', target: 'f_time' },
        { id: 'e6', source: 'f_time', target: 'act_save' },
        { id: 'e7', source: 'act_save', target: 'end' },
      ],
    }
  }

  if (direction === 'whatsapp') {
    if (linkNodeData) {
      const yOff = hasDistinctTopicNode ? 130 : 0
      return {
        name: DYNAMIC_AUTO_TEMPLATE_FLOW_NAME,
        nodes: [
          { id: 'start', type: 'START', position: { x: 260, y: 20 }, data: { label: 'WhatsApp Mesajı Geldi' } },
          { id: 'cond_reg', type: 'CONDITION', position: { x: 260, y: 130 }, data: condNodeData },
          { id: 'f_name', type: 'FIELD', position: { x: 440, y: 280 }, data: nameNodeData },
          { id: 'f_link', type: 'FIELD', position: { x: 260, y: 400 }, data: linkNodeData },
          ...(hasDistinctTopicNode
            ? [{ id: 'f_topic', type: 'FIELD' as const, position: { x: 260, y: 530 }, data: topicNodeData }]
            : []),
          { id: 'f_date', type: 'FIELD', position: { x: 260, y: 530 + yOff }, data: dateNodeData },
          { id: 'f_time', type: 'FIELD', position: { x: 260, y: 660 + yOff }, data: timeNodeData },
          { id: 'act_save', type: 'ACTION', position: { x: 260, y: 790 + yOff }, data: { action: 'save_appointment_pending', label: `📝 ${appointmentNoun} Talebi Oluştur` } },
          { id: 'end', type: 'END', position: { x: 260, y: 920 + yOff }, data: { label: 'Talebi Onayla ve Bitir', message: `${entityLower} talebiniz kaydedildi, iyi günler!` } },
        ],
        edges: hasDistinctTopicNode
          ? [
              { id: 'e1', source: 'start', target: 'cond_reg' },
              { id: 'e2', source: 'cond_reg', target: 'f_link', sourceHandle: 'true', label: 'Evet' },
              { id: 'e3', source: 'cond_reg', target: 'f_name', sourceHandle: 'false', label: 'Hayır' },
              { id: 'e4', source: 'f_name', target: 'f_link' },
              { id: 'e5', source: 'f_link', target: 'f_topic' },
              { id: 'e6', source: 'f_topic', target: 'f_date' },
              { id: 'e7', source: 'f_date', target: 'f_time' },
              { id: 'e8', source: 'f_time', target: 'act_save' },
              { id: 'e9', source: 'act_save', target: 'end' },
            ]
          : [
              { id: 'e1', source: 'start', target: 'cond_reg' },
              { id: 'e2', source: 'cond_reg', target: 'f_link', sourceHandle: 'true', label: 'Evet' },
              { id: 'e3', source: 'cond_reg', target: 'f_name', sourceHandle: 'false', label: 'Hayır' },
              { id: 'e4', source: 'f_name', target: 'f_link' },
              { id: 'e5', source: 'f_link', target: 'f_date' },
              { id: 'e6', source: 'f_date', target: 'f_time' },
              { id: 'e7', source: 'f_time', target: 'act_save' },
              { id: 'e8', source: 'act_save', target: 'end' },
            ],
      }
    }

    return {
      name: DYNAMIC_AUTO_TEMPLATE_FLOW_NAME,
      nodes: [
        { id: 'start', type: 'START', position: { x: 260, y: 20 }, data: { label: 'WhatsApp Mesajı Geldi' } },
        { id: 'cond_reg', type: 'CONDITION', position: { x: 260, y: 130 }, data: condNodeData },
        { id: 'f_name', type: 'FIELD', position: { x: 440, y: 280 }, data: nameNodeData },
        { id: 'f_topic', type: 'FIELD', position: { x: 260, y: 400 }, data: topicNodeData },
        { id: 'f_date', type: 'FIELD', position: { x: 260, y: 530 }, data: dateNodeData },
        { id: 'f_time', type: 'FIELD', position: { x: 260, y: 660 }, data: timeNodeData },
        { id: 'act_save', type: 'ACTION', position: { x: 260, y: 790 }, data: { action: 'save_appointment_pending', label: `📝 ${appointmentNoun} Talebi Oluştur` } },
        { id: 'end', type: 'END', position: { x: 260, y: 920 }, data: { label: 'Talebi Onayla ve Bitir', message: `${entityLower} talebiniz kaydedildi, iyi günler!` } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'cond_reg' },
        { id: 'e2', source: 'cond_reg', target: 'f_topic', sourceHandle: 'true', label: 'Evet' },
        { id: 'e3', source: 'cond_reg', target: 'f_name', sourceHandle: 'false', label: 'Hayır' },
        { id: 'e4', source: 'f_name', target: 'f_topic' },
        { id: 'e5', source: 'f_topic', target: 'f_date' },
        { id: 'e6', source: 'f_date', target: 'f_time' },
        { id: 'e7', source: 'f_time', target: 'act_save' },
        { id: 'e8', source: 'act_save', target: 'end' },
      ],
    }
  }

  // Default: inbound
  return {
    name: DYNAMIC_AUTO_TEMPLATE_FLOW_NAME,
    nodes: [
      { id: 'start', type: 'START', position: { x: 260, y: 20 }, data: { label: 'Karşılama Mesajı' } },
      { id: 'cond_reg', type: 'CONDITION', position: { x: 260, y: 130 }, data: condNodeData },
      { id: 'f_name', type: 'FIELD', position: { x: 440, y: 270 }, data: nameNodeData },
      { id: 'f_topic', type: 'FIELD', position: { x: 260, y: 400 }, data: topicNodeData },
      { id: 'f_date', type: 'FIELD', position: { x: 260, y: 530 }, data: dateNodeData },
      { id: 'f_time', type: 'FIELD', position: { x: 260, y: 660 }, data: timeNodeData },
      { id: 'act_book', type: 'ACTION', position: { x: 260, y: 790 }, data: { action: 'save_appointment_pending', label: `📝 ${appointmentNoun} Talebi Oluştur` } },
      { id: 'end', type: 'END', position: { x: 260, y: 920 }, data: { label: 'Görüşmeyi Bitir', message: `${appointmentNoun} talebiniz alınmıştır, sağlıklı günler dileriz.` } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'cond_reg' },
      { id: 'e2', source: 'cond_reg', target: 'f_topic', sourceHandle: 'true', label: 'Evet' },
      { id: 'e3', source: 'cond_reg', target: 'f_name', sourceHandle: 'false', label: 'Hayır' },
      { id: 'e4', source: 'f_name', target: 'f_topic' },
      { id: 'e5', source: 'f_topic', target: 'f_date' },
      { id: 'e6', source: 'f_date', target: 'f_time' },
      { id: 'e7', source: 'f_time', target: 'act_book' },
      { id: 'e8', source: 'act_book', target: 'end' },
    ],
  }
}

function flowNodesHaveStaleTableReference(nodes: FlowNode[], validTableIds: Set<string>): boolean {
  for (const node of nodes || []) {
    const d = (node.data || {}) as Record<string, any>
    for (const key of ['sourceTableId', 'targetTableId']) {
      const tid = typeof d[key] === 'string' ? d[key].trim() : ''
      if (tid && tid !== VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID && !validTableIds.has(tid)) {
        return true
      }
    }
    if (Array.isArray(d.rules)) {
      for (const r of d.rules) {
        const rtid = typeof r?.sourceTableId === 'string' ? r.sourceTableId.trim() : ''
        if (rtid && rtid !== VIRTUAL_APPOINTMENT_CALENDAR_TABLE_ID && !validTableIds.has(rtid)) {
          return true
        }
      }
    }
  }
  return false
}

export async function syncClinicFlowsWithDynamicTables(
  explicitClinicId?: string,
  opts?: { forceRebuild?: boolean; directions?: string[] },
): Promise<{ updated: number; directions: string[] }> {
  const clinicId = explicitClinicId ?? currentClinicId()
  if (!clinicId) return { updated: 0, directions: [] }

  const studio = await getStudioSchema(clinicId)
  if (!studio.tables || studio.tables.length === 0) {
    return { updated: 0, directions: [] }
  }

  const validTableIds = new Set(studio.tables.map(t => t.id))
  const dirs = opts?.directions?.length ? opts.directions : ['inbound', 'outbound', 'web', 'whatsapp']

  const existingActive = await db
    .select()
    .from(conversationFlows)
    .where(
      and(
        eq(conversationFlows.clinicId, clinicId),
        eq(conversationFlows.isActive, true),
        inArray(conversationFlows.direction, dirs),
      ),
    )
    .orderBy(desc(conversationFlows.updatedAt))

  const latestByDir = new Map<string, (typeof existingActive)[number]>()
  for (const row of existingActive) {
    if (!latestByDir.has(row.direction)) latestByDir.set(row.direction, row)
  }

  const updatedDirs: string[] = []
  for (const dir of dirs) {
    const activeRow = latestByDir.get(dir)
    const shouldWrite = opts?.forceRebuild
      ? true
      : !activeRow ||
        LEGACY_SEED_FLOW_NAMES.has(activeRow.name) ||
        (activeRow.name === DYNAMIC_AUTO_TEMPLATE_FLOW_NAME &&
          flowNodesHaveStaleTableReference((activeRow.nodes || []) as FlowNode[], validTableIds))

    if (!shouldWrite) continue

    const built = buildClinicDynamicFlowForDirection(dir, studio)
    if (activeRow) {
      await db
        .update(conversationFlows)
        .set({
          name: built.name,
          nodes: built.nodes,
          edges: built.edges,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(conversationFlows.id, activeRow.id))
    } else {
      await db.insert(conversationFlows).values({
        clinicId,
        direction: dir,
        name: built.name,
        nodes: built.nodes,
        edges: built.edges,
        isActive: true,
      })
    }
    updatedDirs.push(dir)
  }

  return { updated: updatedDirs.length, directions: updatedDirs }
}


