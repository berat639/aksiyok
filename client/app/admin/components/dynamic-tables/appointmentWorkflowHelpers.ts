import {
  formatCurrencyTR,
  formatDynamicDateTR,
  type DynamicColumnDef,
  type DynamicRelationDef,
} from './types'
import type {
  AppointmentBookingContextData,
  AppointmentContextRow,
  AppointmentContextTableEntry,
} from './AppointmentDynamicRecordsSection'

export interface FieldBadgeSummary {
  colId: string
  label: string
  value: string
  color?: string
}

const BACKOFFICE_LEDGER_ROLES = new Set([
  'finance_income',
  'finance_expense',
  'stock_movement',
])

export function isBackofficeLedgerEntry(entry: AppointmentContextTableEntry): boolean {
  if (entry.moduleRole && BACKOFFICE_LEDGER_ROLES.has(entry.moduleRole)) return true
  const lower = (entry.table.name || '').toLocaleLowerCase('tr-TR')
  return /(tahsilat|gider|masraf|kasa hareket|stok hareket|envanter hareket)/i.test(lower)
}

export function isPersonLikeEntry(entry: AppointmentContextTableEntry): boolean {
  if (entry.config?.enabled && !entry.config.allowMultiple) return true
  const lower = (entry.table.name || '').toLocaleLowerCase('tr-TR')
  if (/(özellik|malzeme|endikasyon|tedavi|plan|ilan|portföy|poliçe|teklif|paket|cihaz|araç|servis)/i.test(lower)) {
    return false
  }
  return /(müşteri|kişi|danışan|hasta|aday|sigortalı|alıcı|kiracı|üye)/i.test(lower)
}

export function classifyAppointmentTables(
  context: AppointmentBookingContextData,
  selectedIdsByTable: Record<string, string[]>
): {
  personEntry: AppointmentContextTableEntry | null
  workflowEntries: AppointmentContextTableEntry[]
  tableEntryMap: Map<string, AppointmentContextTableEntry>
} {
  const tableEntryMap = new Map<string, AppointmentContextTableEntry>()
  for (const t of context.allTables) tableEntryMap.set(t.table.id, t)
  for (const lt of context.linkedTables) tableEntryMap.set(lt.table.id, lt)

  // 1. Primary person/customer table (single-select appointment-linked table preferred)
  const personEntry =
    context.linkedTables.find((lt) => lt.config?.enabled && !lt.config.allowMultiple) ||
    context.linkedTables.find((lt) => isPersonLikeEntry(lt)) ||
    context.allTables.find((at) => !isBackofficeLedgerEntry(at) && isPersonLikeEntry(at)) ||
    null

  const personId = personEntry?.table.id || null

  // 2. Determine relational neighborhood of person & appointment tables for smart ordering
  const neighborTableIds = new Set<string>()
  const primaryNeighborAnchorIds = new Set<string>(
    [personId, ...context.linkedTables.map((lt) => lt.table.id)].filter(Boolean) as string[]
  )
  for (const rel of context.relations) {
    if (primaryNeighborAnchorIds.has(rel.sourceTableId)) neighborTableIds.add(rel.targetTableId)
    if (primaryNeighborAnchorIds.has(rel.targetTableId)) neighborTableIds.add(rel.sourceTableId)
  }

  const seen = new Set<string>()
  const workflowEntries: AppointmentContextTableEntry[] = []

  const pushIfEligible = (entry: AppointmentContextTableEntry, allowLedgerIfLinked = false) => {
    if (entry.table.id === personId || seen.has(entry.table.id)) return
    const hasLinkedRows = (selectedIdsByTable[entry.table.id]?.length || 0) > 0
    if (isBackofficeLedgerEntry(entry) && !(allowLedgerIfLinked && hasLinkedRows)) return
    seen.add(entry.table.id)
    workflowEntries.push(entry)
  }

  for (const lt of context.linkedTables) pushIfEligible(lt, true)
  for (const at of context.allTables) {
    if (neighborTableIds.has(at.table.id)) pushIfEligible(at, true)
  }
  for (const at of context.allTables) pushIfEligible(at, true)

  return { personEntry, workflowEntries, tableEntryMap }
}

export function findStatusColumn(columns: DynamicColumnDef[]): DynamicColumnDef | null {
  return (
    columns.find(
      (c) =>
        c.fieldType === 'select' &&
        /(durum|statu|statü|asama|aşama|teklif_durum|plan_durum|sonuc|sonuç|karar|stage|status)/i.test(
          `${c.name} ${c.slug}`
        )
    ) ||
    columns.find(
      (c) =>
        c.fieldType === 'boolean' &&
        /(tamam|yapildi|yapıldı|onay|completed|done)/i.test(`${c.name} ${c.slug}`)
    ) ||
    null
  )
}

export function findNoteColumn(columns: DynamicColumnDef[]): DynamicColumnDef | null {
  return (
    columns.find(
      (c) =>
        c.fieldType === 'text' &&
        !c.isPrimaryTitle &&
        /(not|aciklama|açıklama|yorum|detay|konsultasyon|konsültasyon|sikayet|şikayet|note)/i.test(
          `${c.name} ${c.slug}`
        )
    ) || null
  )
}

export function findAmountColumn(columns: DynamicColumnDef[]): DynamicColumnDef | null {
  return (
    columns.find((c) => c.fieldType === 'currency') ||
    columns.find(
      (c) =>
        c.fieldType === 'number' &&
        /(fiyat|ucret|ücret|tutar|butce|bütçe|prim|bedel)/i.test(`${c.name} ${c.slug}`)
    ) ||
    null
  )
}

export function findDurationMinutesColumn(columns: DynamicColumnDef[]): DynamicColumnDef | null {
  return (
    columns.find(
      (c) =>
        c.fieldType === 'number' && /(süre|sure|dakika|\bdk\b)/i.test(`${c.name} ${c.slug}`)
    ) || null
  )
}

export function findDateColumn(columns: DynamicColumnDef[]): DynamicColumnDef | null {
  return (
    columns.find(
      (c) =>
        c.fieldType === 'date' &&
        /(tarih|plan|randevu|bitis|bitiş|vade|date)/i.test(`${c.name} ${c.slug}`)
    ) ||
    columns.find((c) => c.fieldType === 'date') ||
    null
  )
}

export function findRecordAccentColor(
  row: AppointmentContextRow,
  columns: DynamicColumnDef[],
  fallbackColor: string
): string {
  const colorSelectCol = columns.find(
    (c) => c.fieldType === 'select' && /(renk|color|islem_rengi)/i.test(`${c.name} ${c.slug}`)
  )
  if (colorSelectCol) {
    const val = row.values?.[colorSelectCol.id]
    const matchedOpt = colorSelectCol.config?.options?.find((o) => o.id === val || o.label === val)
    if (matchedOpt?.color) return matchedOpt.color
    if (typeof val === 'string' && /^#[0-9a-f]{3,8}$/i.test(val.trim())) return val.trim()
  }
  return fallbackColor || '#2563eb'
}

export function isCompletedStatusLabel(label: string): boolean {
  return /(yapıldı|yapildi|tamamland|onayland|satıldı|satildi|kiralandı|kiralandi|teslim edild|kabul|completed|done)/i.test(
    label
  )
}

export function isInProgressStatusLabel(label: string): boolean {
  return /(devam|bekl|incelen|hazır|hazir|görüşülüyor|gorusuluyor|tedavide|planland)/i.test(label)
}

export function getLinkedSubRowIds(
  relations: DynamicRelationDef[],
  rowLinks: Array<{ relationId: string; sourceRowId: string; targetRowId: string }>,
  parentRowId: string,
  relCol: DynamicColumnDef
): string[] {
  const relId = relCol.config?.relationId
  if (!relId) return []
  const rel = relations.find((r) => r.id === relId)
  if (!rel) return []
  const isForward = rel.sourceColumnId === relCol.id
  const ids: string[] = []
  for (const lk of rowLinks) {
    if (lk.relationId !== rel.id) continue
    if (isForward && lk.sourceRowId === parentRowId) ids.push(lk.targetRowId)
    else if (!isForward && lk.targetRowId === parentRowId) ids.push(lk.sourceRowId)
  }
  return Array.from(new Set(ids))
}

export function getRelatedRowsMapForAnchors(
  relations: DynamicRelationDef[],
  rowLinks: Array<{ relationId: string; sourceRowId: string; targetRowId: string }>,
  anchorRowIds: string[]
): Set<string> {
  const anchorSet = new Set(anchorRowIds.filter(Boolean))
  const related = new Set<string>()
  if (anchorSet.size === 0) return related
  for (const lk of rowLinks) {
    if (anchorSet.has(lk.sourceRowId)) related.add(lk.targetRowId)
    if (anchorSet.has(lk.targetRowId)) related.add(lk.sourceRowId)
  }
  return related
}

export function extractCompactFieldBadges(
  row: AppointmentContextRow,
  columns: DynamicColumnDef[],
  excludeColIds: Set<string>,
  limit = 4
): FieldBadgeSummary[] {
  const badges: FieldBadgeSummary[] = []
  for (const col of columns) {
    if (col.fieldType === 'relation' || col.isPrimaryTitle || excludeColIds.has(col.id)) continue
    const raw = row.values?.[col.id]
    if (raw === null || raw === undefined || raw === '') continue

    let formatted = ''
    let optColor: string | undefined
    if (col.fieldType === 'boolean') {
      if (raw === true) formatted = 'Evet'
      else continue
    } else if (col.fieldType === 'currency') {
      formatted = formatCurrencyTR(raw, col.config?.currencySymbol || '₺')
    } else if (col.fieldType === 'date') {
      formatted = formatDynamicDateTR(raw)
    } else if (col.fieldType === 'select') {
      const opt = col.config?.options?.find((o) => o.id === raw)
      formatted = opt ? opt.label : String(raw)
      optColor = opt?.color
    } else if (col.fieldType === 'multiselect' && Array.isArray(raw) && raw.length > 0) {
      formatted = raw
        .map((id) => col.config?.options?.find((o) => o.id === id)?.label || String(id))
        .join(', ')
    } else {
      formatted = String(raw).trim()
    }

    if (!formatted) continue
    badges.push({ colId: col.id, label: col.name, value: formatted, color: optColor })
    if (badges.length >= limit) break
  }
  return badges
}

export function buildEmptyFieldDraft(columns: DynamicColumnDef[]): Record<string, any> {
  const init: Record<string, any> = {}
  for (const col of columns) {
    if (col.fieldType === 'relation') continue
    if (col.fieldType === 'boolean') init[col.id] = false
    else if (col.fieldType === 'multiselect') init[col.id] = []
    else init[col.id] = ''
  }
  return init
}

export function buildRelationDraftFromSelected(
  columns: DynamicColumnDef[],
  selectedIdsByTable: Record<string, string[]>
): Record<string, string[]> {
  const relInit: Record<string, string[]> = {}
  for (const col of columns) {
    if (col.fieldType === 'relation' && col.config?.targetTableId) {
      const otherSelected = selectedIdsByTable[col.config.targetTableId] || []
      if (otherSelected.length > 0) {
        relInit[col.id] =
          col.config.allowMultiple !== false ? [...otherSelected] : [otherSelected[0]!]
      } else {
        relInit[col.id] = []
      }
    }
  }
  return relInit
}

export function isFullWidthField(col: DynamicColumnDef): boolean {
  return (
    col.isPrimaryTitle ||
    col.fieldType === 'multiselect' ||
    col.fieldType === 'boolean' ||
    /(not|aciklama|açıklama|adres|detay|gecmis|geçmiş|sikayet|şikayet)/i.test(
      `${col.name} ${col.slug}`
    )
  )
}
