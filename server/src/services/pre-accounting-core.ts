import { createHash } from 'node:crypto'

export type FinanceModuleRole = 'finance_income' | 'finance_expense'
export type AccountingDirection = 'income' | 'expense'
export type AccountingCurrencyCode = 'TRY' | 'USD' | 'EUR' | 'GBP'
export type AccountingPaymentStatus = 'completed' | 'partial' | 'pending' | 'cancelled'
export type AccountingSyncStatus = 'pending' | 'ready' | 'synced' | 'failed' | 'ignored'
export type AccountingDocumentType =
  | 'efatura'
  | 'earsiv'
  | 'esmm'
  | 'fis_makbuz'
  | 'gider_pusulasi'
  | 'banka_dekont'
  | 'belgesiz'

export type PreAccountingProviderKey =
  | 'parasut'
  | 'logo_isbasi'
  | 'bizim_hesap'
  | 'kolaybi'
  | 'mikro'
  | 'uyumsoft'
  | 'dia'
  | 'custom_webhook'

export interface AccountingSelectOption {
  id: string
  label: string
  color: string
}

export const CANONICAL_FINANCE_ROLES: readonly FinanceModuleRole[] = [
  'finance_income',
  'finance_expense',
] as const

export function isFinanceModuleRole(role: unknown): role is FinanceModuleRole {
  return role === 'finance_income' || role === 'finance_expense'
}

export const CANONICAL_FINANCE_TABLE_NAMES: Record<FinanceModuleRole, string> = {
  finance_income: 'Gelirler & Tahsilatlar',
  finance_expense: 'Giderler & Masraflar',
}

export const CANONICAL_FINANCE_TABLE_DESCRIPTIONS: Record<FinanceModuleRole, string> = {
  finance_income:
    'Tüm sektörlere uyumlu standart gelir ve tahsilat tablosu. KDV, belge, cari ve ödeme bilgileri ön muhasebe aktarımına hazır yapıda saklanır.',
  finance_expense:
    'Tüm sektörlere uyumlu standart gider ve masraf tablosu. Alış faturaları, stok/bakım maliyetleri ve işletme giderleri ön muhasebe aktarımına hazır yapıda saklanır.',
}

export const STANDARD_PAYMENT_STATUS_OPTIONS: AccountingSelectOption[] = [
  { id: 'tamamlandi', label: 'Tamamlandı / Ödendi', color: '#15803d' },
  { id: 'kismi', label: 'Kısmi Ödendi', color: '#0284c7' },
  { id: 'bekliyor', label: 'Bekliyor / Vadeli', color: '#d97706' },
  { id: 'iptal', label: 'İptal', color: '#ef4444' },
]

export const STANDARD_PAYMENT_METHOD_OPTIONS: AccountingSelectOption[] = [
  { id: 'nakit', label: 'Nakit (Kasa)', color: '#15803d' },
  { id: 'kredi_karti', label: 'Kredi Kartı / POS', color: '#2563eb' },
  { id: 'havale_eft', label: 'Havale / EFT / FAST', color: '#0284c7' },
  { id: 'online_odeme', label: 'Online Ödeme / Sanal POS', color: '#7c3aed' },
  { id: 'cek_senet', label: 'Çek / Senet', color: '#0d9488' },
  { id: 'taksit_senet', label: 'Vadeli / Açık Hesap', color: '#d97706' },
  { id: 'diger', label: 'Diğer / Kurum', color: '#64748b' },
]

export const STANDARD_INCOME_CATEGORY_OPTIONS: AccountingSelectOption[] = [
  { id: 'urun_satis', label: 'Ürün / Mal Satışı', color: '#15803d' },
  { id: 'hizmet_geliri', label: 'Hizmet / İşlem Geliri', color: '#2563eb' },
  { id: 'abonelik_paket', label: 'Abonelik / Paket / Sözleşme', color: '#0284c7' },
  { id: 'komisyon_prim', label: 'Komisyon / Aracılık / Prim', color: '#7c3aed' },
  { id: 'on_odeme_kapora', label: 'Ön Ödeme / Kapora / Avans', color: '#0d9488' },
  { id: 'diger_gelir', label: 'Diğer Gelirler', color: '#64748b' },
]

export const STANDARD_EXPENSE_CATEGORY_OPTIONS: AccountingSelectOption[] = [
  { id: 'stok_malzeme', label: 'Mal, Hammadde & Stok Alımı', color: '#0284c7' },
  { id: 'kira_fatura', label: 'Kira, Aidat & Faturalar', color: '#2563eb' },
  { id: 'personel', label: 'Personel, Maaş & SGK', color: '#7c3aed' },
  { id: 'pazarlama', label: 'Pazarlama & Reklam', color: '#d97706' },
  { id: 'yazilim_abonelik', label: 'Yazılım, Abonelik & Lisans', color: '#0369a1' },
  { id: 'bakim_onarim', label: 'Bakım, Onarım & Teknik Servis', color: '#0d9488' },
  { id: 'lojistik_ulasim', label: 'Lojistik, Kargo & Ulaşım', color: '#4f46e5' },
  { id: 'dis_hizmet', label: 'Danışmanlık & Dış Hizmet', color: '#0891b2' },
  { id: 'vergi_resmi', label: 'Vergi, Harç & Resmi Gider', color: '#dc2626' },
  { id: 'iade_mahsup', label: 'Tedarikçi İade / Mahsup', color: '#15803d' },
  { id: 'diger_gider', label: 'Diğer İşletme Giderleri', color: '#64748b' },
]

export const STANDARD_DOCUMENT_TYPE_OPTIONS: AccountingSelectOption[] = [
  { id: 'efatura', label: 'e-Fatura', color: '#2563eb' },
  { id: 'earsiv', label: 'e-Arşiv Fatura', color: '#0284c7' },
  { id: 'esmm', label: 'e-SMM (Serbest Meslek Makbuzu)', color: '#7c3aed' },
  { id: 'fis_makbuz', label: 'Fiş / Tahsilat Makbuzu', color: '#15803d' },
  { id: 'gider_pusulasi', label: 'Gider Pusulası', color: '#d97706' },
  { id: 'banka_dekont', label: 'Banka Dekontu', color: '#0d9488' },
  { id: 'belgesiz', label: 'Belgesiz / İç Kayıt', color: '#64748b' },
]

export const STANDARD_CURRENCY_OPTIONS: AccountingSelectOption[] = [
  { id: 'TRY', label: 'TRY (₺)', color: '#2563eb' },
  { id: 'USD', label: 'USD ($)', color: '#15803d' },
  { id: 'EUR', label: 'EUR (€)', color: '#0284c7' },
  { id: 'GBP', label: 'GBP (£)', color: '#7c3aed' },
]

export const STANDARD_VAT_RATE_OPTIONS: AccountingSelectOption[] = [
  { id: '0', label: '%0 (KDV Muaf / İstisna)', color: '#64748b' },
  { id: '1', label: '%1', color: '#0d9488' },
  { id: '10', label: '%10', color: '#0284c7' },
  { id: '20', label: '%20', color: '#2563eb' },
]

export const STANDARD_ACCOUNTING_SYNC_OPTIONS: AccountingSelectOption[] = [
  { id: 'bekliyor', label: 'Aktarım Bekliyor', color: '#d97706' },
  { id: 'hazir', label: 'Aktarıma Hazır', color: '#0284c7' },
  { id: 'aktarildi', label: 'Muhasebeye Aktarıldı', color: '#15803d' },
  { id: 'hata', label: 'Aktarım Hatası', color: '#ef4444' },
  { id: 'kapsam_disi', label: 'Kapsam Dışı', color: '#64748b' },
]

// Tek Düzen Hesap Planı (TDHP) varsayılan hesap kodları — ileride ön muhasebe eşleştirmeleri için temel
export const DEFAULT_TDHP_INCOME_ACCOUNTS: Record<string, string> = {
  urun_satis: '600.01',
  hizmet_geliri: '600.02',
  hizmet_tahsilat: '600.02',
  hizmet_satis: '600.02',
  abonelik_paket: '600.03',
  sozlesme: '600.03',
  komisyon_prim: '600.04',
  satis_komisyon: '600.04',
  kira_komisyon: '600.04',
  acente_komisyon: '600.04',
  on_odeme_kapora: '340.01',
  kapora_on_odeme: '340.01',
  kapora: '340.01',
  on_odeme: '340.01',
  diger_gelir: '602.01',
}

export const DEFAULT_TDHP_EXPENSE_ACCOUNTS: Record<string, string> = {
  stok_malzeme: '153.01',
  kira_fatura: '770.01',
  kira_aidat: '770.01',
  ofis_kira: '770.01',
  sabit_gider: '770.01',
  personel: '770.02',
  pazarlama: '760.01',
  portal_ilan: '760.01',
  afis_reklam: '760.01',
  yazilim_abonelik: '770.03',
  yazilim: '770.03',
  bakim_onarim: '770.04',
  lojistik_ulasim: '760.02',
  kargo_ofis: '760.02',
  dis_hizmet: '740.01',
  vergi_resmi: '770.05',
  iade_mahsup: '153.99',
  diger_gider: '770.99',
  diger: '770.99',
}

export interface AccountingAmountsResult {
  netAmount: number
  vatRate: number
  vatAmount: number
  grossAmount: number
  exchangeRate: number
  baseAmountTry: number
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  const rounded =
    (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100
  return rounded === 0 ? 0 : rounded
}

export function normalizeCurrencyCode(raw: unknown): AccountingCurrencyCode {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
  if (s === 'USD' || s.startsWith('USD') || s === '$') return 'USD'
  if (s === 'EUR' || s.startsWith('EUR') || s === '€') return 'EUR'
  if (s === 'GBP' || s.startsWith('GBP') || s === '£') return 'GBP'
  return 'TRY'
}

export function normalizeVatRate(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(100, roundMoney(raw)))
  }
  const cleaned = String(raw)
    .trim()
    .replace(/%/g, '')
    .replace(/[^0-9.,-]/g, '')
    .replace(',', '.')
  if (!cleaned) return 0
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(100, roundMoney(parsed)))
}

export function normalizeExchangeRate(raw: unknown, currency: AccountingCurrencyCode): number {
  if (currency === 'TRY') return 1
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw * 10000) / 10000
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw.trim().replace(/\s/g, '').replace(',', '.'))
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed * 10000) / 10000
    }
  }
  return 1
}

/**
 * KDV dahil veya KDV hariç tutarlardan matrah (net), KDV tutarı ve genel toplamı
 * kuruş sapması olmadan (net + vat === gross) hesaplar.
 * İade / mahsup için negatif tutarları da destekler.
 */
export function calculateAccountingAmounts(input: {
  grossAmount?: number | null
  netAmount?: number | null
  vatRate?: unknown
  vatIncluded?: boolean
  currency?: unknown
  exchangeRate?: unknown
}): AccountingAmountsResult {
  const currency = normalizeCurrencyCode(input.currency)
  const exchangeRate = normalizeExchangeRate(input.exchangeRate, currency)
  const vatRate = normalizeVatRate(input.vatRate)
  const vatIncluded = input.vatIncluded !== false

  const hasNet = typeof input.netAmount === 'number' && Number.isFinite(input.netAmount)
  const hasGross = typeof input.grossAmount === 'number' && Number.isFinite(input.grossAmount)

  let netAmount = 0
  let vatAmount = 0
  let grossAmount = 0

  if (!vatIncluded && hasNet) {
    netAmount = roundMoney(input.netAmount!)
    vatAmount = roundMoney((netAmount * vatRate) / 100)
    grossAmount = roundMoney(netAmount + vatAmount)
  } else if (!vatIncluded && hasGross) {
    // Caller passed base amount in grossAmount with vatIncluded=false
    netAmount = roundMoney(input.grossAmount!)
    vatAmount = roundMoney((netAmount * vatRate) / 100)
    grossAmount = roundMoney(netAmount + vatAmount)
  } else if (hasGross) {
    grossAmount = roundMoney(input.grossAmount!)
    if (vatRate <= 0) {
      netAmount = grossAmount
      vatAmount = 0
    } else {
      netAmount = roundMoney(grossAmount / (1 + vatRate / 100))
      vatAmount = roundMoney(grossAmount - netAmount)
    }
  } else if (hasNet) {
    netAmount = roundMoney(input.netAmount!)
    vatAmount = roundMoney((netAmount * vatRate) / 100)
    grossAmount = roundMoney(netAmount + vatAmount)
  }

  const baseAmountTry = roundMoney(grossAmount * exchangeRate)

  return {
    netAmount,
    vatRate,
    vatAmount,
    grossAmount,
    exchangeRate,
    baseAmountTry,
  }
}

export interface TaxIdValidationResult {
  normalized: string | null
  type: 'vkn' | 'tckn' | null
  isValid: boolean
}

/**
 * Türkiye Vergi Kimlik Numarası (10 hane) ve T.C. Kimlik Numarası (11 hane) doğrulayıcı.
 */
export function validateTurkishTaxId(raw: unknown): TaxIdValidationResult {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) {
    return { normalized: null, type: null, isValid: true }
  }

  if (digits.length === 10) {
    // GİB VKN mod-10 checksum
    let sum = 0
    for (let i = 0; i < 9; i++) {
      const digit = Number(digits[i])
      const tmp = (digit + (9 - i)) % 10
      const pow = (tmp * Math.pow(2, 9 - i)) % 9
      sum += tmp !== 0 && pow === 0 ? 9 : pow
    }
    const expected = (10 - (sum % 10)) % 10
    return {
      normalized: digits,
      type: 'vkn',
      isValid: expected === Number(digits[9]),
    }
  }

  if (digits.length === 11) {
    if (digits[0] === '0') {
      return { normalized: digits, type: 'tckn', isValid: false }
    }
    const d = digits.split('').map(Number)
    const oddSum = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!
    const evenSum = d[1]! + d[3]! + d[5]! + d[7]!
    const check10 = ((oddSum * 7 - evenSum) % 10 + 10) % 10
    const check11 = (oddSum + evenSum + d[9]!) % 10
    return {
      normalized: digits,
      type: 'tckn',
      isValid: check10 === d[9] && check11 === d[10],
    }
  }

  return {
    normalized: digits,
    type: null,
    isValid: false,
  }
}

export function normalizeAccountingPaymentStatus(
  raw: unknown,
  label?: string | null
): AccountingPaymentStatus {
  const hay = `${String(raw ?? '')} ${label ?? ''}`.toLocaleLowerCase('tr-TR').trim()
  if (!hay) return 'completed'
  if (/(iptal|cancel|red)/i.test(hay)) return 'cancelled'
  if (/(kısmi|kismi|partial)/i.test(hay)) return 'partial'
  if (/(bekliyor|pending|vadeli|planlan|ödenmedi|odenmedi|açık|acik)/i.test(hay)) {
    return 'pending'
  }
  return 'completed'
}

export function normalizeAccountingSyncStatus(raw: unknown): AccountingSyncStatus {
  const hay = String(raw ?? '')
    .toLocaleLowerCase('tr-TR')
    .trim()
  if (!hay) return 'pending'
  if (/(aktarildi|aktarıldı|synced|sent|senkron)/i.test(hay)) return 'synced'
  if (/(hata|error|failed|başarısız|basarisiz)/i.test(hay)) return 'failed'
  if (/(kapsam|ignored|haric|hariç|skip)/i.test(hay)) return 'ignored'
  if (/(hazir|hazır|ready)/i.test(hay)) return 'ready'
  return 'pending'
}

export function syncStatusToOptionId(status: AccountingSyncStatus): string {
  switch (status) {
    case 'ready':
      return 'hazir'
    case 'synced':
      return 'aktarildi'
    case 'failed':
      return 'hata'
    case 'ignored':
      return 'kapsam_disi'
    default:
      return 'bekliyor'
  }
}

export function normalizeDocumentType(raw: unknown): AccountingDocumentType {
  const hay = String(raw ?? '')
    .toLocaleLowerCase('tr-TR')
    .trim()
  if (!hay) return 'belgesiz'
  if (/(e-?fatura|efatura)/i.test(hay)) return 'efatura'
  if (/(e-?arşiv|e-?arsiv|earsiv)/i.test(hay)) return 'earsiv'
  if (/(e-?smm|esmm|serbest meslek)/i.test(hay)) return 'esmm'
  if (/(gider pusul|gider_pusulasi)/i.test(hay)) return 'gider_pusulasi'
  if (/(dekont|banka)/i.test(hay)) return 'banka_dekont'
  if (/(fiş|fis|makbuz)/i.test(hay)) return 'fis_makbuz'
  return 'belgesiz'
}

export function resolveTdhpAccountCode(
  direction: AccountingDirection,
  categoryCode: string | null | undefined,
  explicitCode?: string | null
): string {
  const cleanExplicit = String(explicitCode ?? '').trim()
  if (cleanExplicit) return cleanExplicit
  const key = String(categoryCode ?? '')
    .toLocaleLowerCase('tr-TR')
    .trim()
  if (direction === 'income') {
    return DEFAULT_TDHP_INCOME_ACCOUNTS[key] ?? '600.02'
  }
  return DEFAULT_TDHP_EXPENSE_ACCOUNTS[key] ?? '770.99'
}

export interface CanonicalAccountingEntry {
  idempotencyKey: string
  rowId: string
  tableId: string
  clinicId: string
  direction: AccountingDirection
  voucherKind: 'sales_invoice' | 'purchase_bill' | 'receipt' | 'expense_slip' | 'credit_note'
  title: string
  description: string | null
  issueDate: string
  dueDate: string | null
  currency: AccountingCurrencyCode
  exchangeRate: number
  quantity: number
  unitPriceNet: number
  netAmount: number
  vatRate: number
  vatAmount: number
  grossAmount: number
  baseAmountTry: number
  paymentStatus: AccountingPaymentStatus
  paymentMethodCode: string
  paymentMethodLabel: string
  categoryCode: string
  categoryLabel: string
  accountingAccountCode: string
  documentType: AccountingDocumentType
  documentNumber: string | null
  counterparty: {
    linkedRowId: string | null
    name: string | null
    taxId: string | null
    taxIdType: 'vkn' | 'tckn' | null
    taxIdValid: boolean
  }
  linkedItems: Array<{ rowId: string; tableId: string; title: string }>
  sync: {
    status: AccountingSyncStatus
    provider: string | null
    externalDocumentId: string | null
    externalContactId: string | null
    externalPaymentId: string | null
    externalDocumentNumber: string | null
    lastSyncedAt: string | null
    lastError: string | null
  }
  payloadHash: string
  readiness: {
    isReadyForAccounting: boolean
    missingFields: string[]
  }
  updatedAt: string
}

export function resolveVoucherKind(
  direction: AccountingDirection,
  documentType: AccountingDocumentType,
  grossAmount: number
): CanonicalAccountingEntry['voucherKind'] {
  if (grossAmount < 0) return 'credit_note'
  if (direction === 'income') {
    if (documentType === 'efatura' || documentType === 'earsiv' || documentType === 'esmm') {
      return 'sales_invoice'
    }
    return 'receipt'
  }
  if (documentType === 'efatura' || documentType === 'earsiv') {
    return 'purchase_bill'
  }
  return 'expense_slip'
}

export function computeAccountingPayloadHash(payload: Record<string, unknown>): string {
  const canonicalJson = JSON.stringify(payload, Object.keys(payload).sort())
  return createHash('sha256').update(canonicalJson).digest('hex')
}

export function buildCanonicalAccountingEntry(input: {
  clinicId: string
  tableId: string
  rowId: string
  direction: AccountingDirection
  title: string
  description?: string | null
  issueDate: string
  dueDate?: string | null
  quantity?: number
  grossAmount: number
  netAmount?: number | null
  vatRate?: unknown
  vatAmount?: number | null
  currency?: unknown
  exchangeRate?: unknown
  paymentStatus: AccountingPaymentStatus
  paymentMethodCode?: string | null
  paymentMethodLabel?: string | null
  categoryCode?: string | null
  categoryLabel?: string | null
  accountingAccountCode?: string | null
  documentType?: unknown
  documentNumber?: string | null
  counterpartyLinkedRowId?: string | null
  counterpartyName?: string | null
  counterpartyTaxId?: string | null
  linkedItems?: Array<{ rowId: string; tableId: string; title: string }>
  sync?: {
    status?: AccountingSyncStatus
    provider?: string | null
    externalDocumentId?: string | null
    externalContactId?: string | null
    externalPaymentId?: string | null
    externalDocumentNumber?: string | null
    lastSyncedAt?: string | null
    lastError?: string | null
  }
  updatedAt?: string
}): CanonicalAccountingEntry {
  const currency = normalizeCurrencyCode(input.currency)
  const exchangeRate = normalizeExchangeRate(input.exchangeRate, currency)
  const vatRate = normalizeVatRate(input.vatRate)
  const qty = Math.max(1, Number.isFinite(input.quantity) && (input.quantity ?? 0) > 0 ? input.quantity! : 1)

  const hasExplicitNet =
    typeof input.netAmount === 'number' &&
    Number.isFinite(input.netAmount) &&
    input.netAmount !== 0
  const hasExplicitGross = Number.isFinite(input.grossAmount) && input.grossAmount !== 0

  const computed = calculateAccountingAmounts({
    grossAmount: hasExplicitGross ? input.grossAmount : undefined,
    netAmount: hasExplicitNet ? input.netAmount : undefined,
    vatRate,
    vatIncluded: hasExplicitGross ? true : !hasExplicitNet,
    currency,
    exchangeRate,
  })

  // Respect explicit net/vat if they reconcile with gross within 0.02
  let netAmount = computed.netAmount
  let vatAmount = computed.vatAmount
  if (
    typeof input.netAmount === 'number' &&
    Number.isFinite(input.netAmount) &&
    typeof input.vatAmount === 'number' &&
    Number.isFinite(input.vatAmount) &&
    Math.abs(roundMoney(input.netAmount + input.vatAmount) - computed.grossAmount) <= 0.02
  ) {
    netAmount = roundMoney(input.netAmount)
    vatAmount = roundMoney(input.vatAmount)
  }

  const documentType = normalizeDocumentType(input.documentType)
  const documentNumber = String(input.documentNumber ?? '').trim() || null
  const counterpartyName = String(input.counterpartyName ?? '').trim() || null
  const taxValidation = validateTurkishTaxId(input.counterpartyTaxId)
  const categoryCode = String(input.categoryCode ?? (input.direction === 'income' ? 'hizmet_geliri' : 'diger_gider')).trim()
  const categoryLabel = String(input.categoryLabel ?? (input.direction === 'income' ? 'Hizmet / İşlem Geliri' : 'Diğer İşletme Giderleri')).trim()
  const paymentMethodCode = String(input.paymentMethodCode ?? 'nakit').trim()
  const paymentMethodLabel = String(input.paymentMethodLabel ?? 'Nakit (Kasa)').trim()
  const accountingAccountCode = resolveTdhpAccountCode(
    input.direction,
    categoryCode,
    input.accountingAccountCode
  )

  const missingFields: string[] = []
  if (!input.title.trim()) missingFields.push('Başlık')
  if (!Number.isFinite(computed.grossAmount) || computed.grossAmount === 0) missingFields.push('Tutar')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) missingFields.push('İşlem Tarihi')
  if (taxValidation.normalized && !taxValidation.isValid) {
    missingFields.push('Geçerli VKN / TCKN')
  }
  if (
    (documentType === 'efatura' || documentType === 'earsiv' || documentType === 'esmm') &&
    !counterpartyName
  ) {
    missingFields.push('Cari / Karşı Taraf Adı')
  }

  const isReadyForAccounting = input.paymentStatus !== 'cancelled' && missingFields.length === 0

  const hashBasis = {
    direction: input.direction,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    issueDate: input.issueDate,
    dueDate: input.dueDate || null,
    currency,
    exchangeRate,
    quantity: qty,
    netAmount,
    vatRate,
    vatAmount,
    grossAmount: computed.grossAmount,
    paymentStatus: input.paymentStatus,
    paymentMethodCode,
    categoryCode,
    accountingAccountCode,
    documentType,
    documentNumber,
    counterpartyName,
    counterpartyTaxId: taxValidation.normalized,
  }
  const payloadHash = computeAccountingPayloadHash(hashBasis)

  const defaultSyncStatus: AccountingSyncStatus =
    input.paymentStatus === 'cancelled'
      ? 'ignored'
      : isReadyForAccounting
        ? 'ready'
        : 'pending'

  return {
    idempotencyKey: `${input.clinicId}:${input.rowId}`,
    rowId: input.rowId,
    tableId: input.tableId,
    clinicId: input.clinicId,
    direction: input.direction,
    voucherKind: resolveVoucherKind(input.direction, documentType, computed.grossAmount),
    title: input.title.trim(),
    description: input.description?.trim() || null,
    issueDate: input.issueDate,
    dueDate: input.dueDate || null,
    currency,
    exchangeRate,
    quantity: qty,
    unitPriceNet: roundMoney(netAmount / qty),
    netAmount,
    vatRate,
    vatAmount,
    grossAmount: computed.grossAmount,
    baseAmountTry: computed.baseAmountTry,
    paymentStatus: input.paymentStatus,
    paymentMethodCode,
    paymentMethodLabel,
    categoryCode,
    categoryLabel,
    accountingAccountCode,
    documentType,
    documentNumber,
    counterparty: {
      linkedRowId: input.counterpartyLinkedRowId ?? null,
      name: counterpartyName,
      taxId: taxValidation.normalized,
      taxIdType: taxValidation.type,
      taxIdValid: taxValidation.isValid,
    },
    linkedItems: input.linkedItems ?? [],
    sync: {
      status: input.sync?.status ?? defaultSyncStatus,
      provider: input.sync?.provider ?? null,
      externalDocumentId: input.sync?.externalDocumentId ?? null,
      externalContactId: input.sync?.externalContactId ?? null,
      externalPaymentId: input.sync?.externalPaymentId ?? null,
      externalDocumentNumber: input.sync?.externalDocumentNumber ?? null,
      lastSyncedAt: input.sync?.lastSyncedAt ?? null,
      lastError: input.sync?.lastError ?? null,
    },
    payloadHash,
    readiness: {
      isReadyForAccounting,
      missingFields,
    },
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }
}

// ── Pre-Accounting Provider Adapter Contract & Registry ──────────────────────

export interface PreAccountingProviderCapabilities {
  salesInvoices: boolean
  purchaseBills: boolean
  contactsSync: boolean
  eInvoice: boolean
  eArchive: boolean
  eSmm: boolean
  twoWaySync: boolean
}

export interface PreAccountingProviderAdapter {
  readonly provider: PreAccountingProviderKey
  readonly displayName: string
  readonly description: string
  readonly capabilities: PreAccountingProviderCapabilities
  mapEntryToProviderPayload(
    entry: CanonicalAccountingEntry,
    accountMapping?: Record<string, string>
  ): Record<string, unknown>
}

export const SUPPORTED_PRE_ACCOUNTING_PROVIDERS: readonly PreAccountingProviderAdapter[] = [
  {
    provider: 'parasut',
    displayName: 'Paraşüt',
    description: 'Satış faturaları, alış faturaları, cari kartlar ve kasa/banka tahsilatları ile uyumlu şema.',
    capabilities: {
      salesInvoices: true,
      purchaseBills: true,
      contactsSync: true,
      eInvoice: true,
      eArchive: true,
      eSmm: true,
      twoWaySync: true,
    },
    mapEntryToProviderPayload(entry, accountMapping = {}) {
      const isIncome = entry.direction === 'income'
      return {
        data: {
          type: isIncome ? 'sales_invoices' : 'purchase_bills',
          attributes: {
            item_type: entry.voucherKind === 'credit_note' ? 'refund' : 'invoice',
            description: entry.title,
            issue_date: entry.issueDate,
            due_date: entry.dueDate ?? entry.issueDate,
            invoice_series: entry.documentNumber ? entry.documentNumber.slice(0, 3) : undefined,
            invoice_id: entry.documentNumber ?? undefined,
            currency: entry.currency === 'TRY' ? 'TRL' : entry.currency,
            exchange_rate: entry.exchangeRate,
            net_total: entry.netAmount,
            total_vat: entry.vatAmount,
            gross_total: entry.grossAmount,
            withholding_rate: 0,
            payment_status: entry.paymentStatus === 'completed' ? 'paid' : 'unpaid',
            account_id: accountMapping[entry.paymentMethodCode] ?? null,
            category_id: accountMapping[entry.categoryCode] ?? null,
            external_reference: entry.idempotencyKey,
          },
          relationships: {
            contact: {
              name: entry.counterparty.name,
              tax_number: entry.counterparty.taxId,
              external_id: entry.sync.externalContactId,
            },
            details: [
              {
                description: entry.title,
                quantity: entry.quantity,
                unit_price: entry.unitPriceNet,
                vat_rate: entry.vatRate,
              },
            ],
          },
        },
      }
    },
  },
  {
    provider: 'logo_isbasi',
    displayName: 'Logo İşbaşı',
    description: 'Logo İşbaşı e-Fatura, e-Arşiv, gelir/gider fişleri ve cari entegrasyonu için hazır veri modeli.',
    capabilities: {
      salesInvoices: true,
      purchaseBills: true,
      contactsSync: true,
      eInvoice: true,
      eArchive: true,
      eSmm: true,
      twoWaySync: true,
    },
    mapEntryToProviderPayload(entry, accountMapping = {}) {
      return {
        externalRef: entry.idempotencyKey,
        documentDirection: entry.direction === 'income' ? 'SALES' : 'PURCHASE',
        documentType: entry.documentType.toUpperCase(),
        documentNo: entry.documentNumber,
        issueDate: entry.issueDate,
        dueDate: entry.dueDate ?? entry.issueDate,
        currencyCode: entry.currency,
        exchangeRate: entry.exchangeRate,
        customerOrVendor: {
          title: entry.counterparty.name,
          taxId: entry.counterparty.taxId,
          externalId: entry.sync.externalContactId,
        },
        accountCode: accountMapping[entry.categoryCode] ?? entry.accountingAccountCode,
        paymentAccountCode: accountMapping[entry.paymentMethodCode] ?? entry.paymentMethodCode,
        lines: [
          {
            description: entry.title,
            quantity: entry.quantity,
            unitPrice: entry.unitPriceNet,
            vatRate: entry.vatRate,
            vatAmount: entry.vatAmount,
            lineTotal: entry.grossAmount,
          },
        ],
        totals: {
          net: entry.netAmount,
          vat: entry.vatAmount,
          gross: entry.grossAmount,
          tryEquivalent: entry.baseAmountTry,
        },
      }
    },
  },
  {
    provider: 'bizim_hesap',
    displayName: 'Bizim Hesap',
    description: 'Bizim Hesap cari, fatura ve tahsilat API aktarımlarına uyumlu yapı.',
    capabilities: {
      salesInvoices: true,
      purchaseBills: true,
      contactsSync: true,
      eInvoice: true,
      eArchive: true,
      eSmm: false,
      twoWaySync: true,
    },
    mapEntryToProviderPayload(entry, accountMapping = {}) {
      return {
        invoiceNo: entry.documentNumber ?? entry.idempotencyKey,
        invoiceType: entry.direction === 'income' ? 3 : 5,
        dates: {
          invoiceDate: entry.issueDate,
          dueDate: entry.dueDate ?? entry.issueDate,
        },
        customer: {
          title: entry.counterparty.name ?? 'Genel Cari',
          taxNo: entry.counterparty.taxId ?? '',
        },
        currency: entry.currency,
        exchangeRate: entry.exchangeRate,
        amounts: {
          gross: entry.netAmount,
          tax: entry.vatAmount,
          net: entry.grossAmount,
        },
        accountCode: accountMapping[entry.categoryCode] ?? entry.accountingAccountCode,
        details: [
          {
            productName: entry.title,
            quantity: entry.quantity,
            unitPrice: entry.unitPriceNet,
            taxRate: entry.vatRate,
            tax: entry.vatAmount,
            total: entry.grossAmount,
          },
        ],
        note: entry.description ?? '',
      }
    },
  },
  {
    provider: 'kolaybi',
    displayName: "KolayBi'",
    description: "KolayBi' ön muhasebe, e-Belge ve gelir/gider aktarımı için standart eşleme.",
    capabilities: {
      salesInvoices: true,
      purchaseBills: true,
      contactsSync: true,
      eInvoice: true,
      eArchive: true,
      eSmm: true,
      twoWaySync: true,
    },
    mapEntryToProviderPayload(entry, accountMapping = {}) {
      return {
        order_reference: entry.idempotencyKey,
        type: entry.direction === 'income' ? 'sale' : 'purchase',
        document_type: entry.documentType,
        document_no: entry.documentNumber,
        issue_date: entry.issueDate,
        due_date: entry.dueDate,
        currency: entry.currency,
        exchange_rate: entry.exchangeRate,
        contact: {
          name: entry.counterparty.name,
          identity_no: entry.counterparty.taxId,
        },
        account_code: accountMapping[entry.categoryCode] ?? entry.accountingAccountCode,
        items: [
          {
            name: entry.title,
            quantity: entry.quantity,
            unit_price: entry.unitPriceNet,
            vat_rate: entry.vatRate,
          },
        ],
        gross_total: entry.grossAmount,
        payment_status: entry.paymentStatus,
      }
    },
  },
  {
    provider: 'mikro',
    displayName: 'Mikro / MikroX',
    description: 'Mikro ERP ve MikroX ticari/ön muhasebe fiş aktarımı için TDHP uyumlu model.',
    capabilities: {
      salesInvoices: true,
      purchaseBills: true,
      contactsSync: true,
      eInvoice: true,
      eArchive: true,
      eSmm: false,
      twoWaySync: true,
    },
    mapEntryToProviderPayload(entry, accountMapping = {}) {
      return {
        evrakId: entry.idempotencyKey,
        evrakTipi: entry.direction === 'income' ? 'SATIS' : 'ALIS',
        belgeTuru: entry.documentType,
        belgeNo: entry.documentNumber,
        tarih: entry.issueDate,
        vadeTarihi: entry.dueDate,
        cariUnvan: entry.counterparty.name,
        vknTckn: entry.counterparty.taxId,
        muhasebeHesapKodu: accountMapping[entry.categoryCode] ?? entry.accountingAccountCode,
        kasaBankaKodu: accountMapping[entry.paymentMethodCode] ?? entry.paymentMethodCode,
        dovizCinsi: entry.currency,
        dovizKuru: entry.exchangeRate,
        matrah: entry.netAmount,
        kdvOrani: entry.vatRate,
        kdvTutari: entry.vatAmount,
        genelToplam: entry.grossAmount,
        tlKarsiligi: entry.baseAmountTry,
        aciklama: entry.title,
      }
    },
  },
  {
    provider: 'uyumsoft',
    displayName: 'Uyumsoft e-Belge',
    description: 'Uyumsoft e-Fatura, e-Arşiv ve e-SMM entegratör şemasıyla uyumlu veri yapısı.',
    capabilities: {
      salesInvoices: true,
      purchaseBills: true,
      contactsSync: true,
      eInvoice: true,
      eArchive: true,
      eSmm: true,
      twoWaySync: false,
    },
    mapEntryToProviderPayload(entry) {
      return {
        localDocumentId: entry.idempotencyKey,
        profileId: entry.documentType === 'efatura' ? 'TICARIFATURA' : 'EARSIVFATURA',
        invoiceTypeCode: entry.voucherKind === 'credit_note' ? 'IADE' : 'SATIS',
        issueDate: entry.issueDate,
        documentCurrencyCode: entry.currency,
        accountingParty: {
          name: entry.counterparty.name,
          taxId: entry.counterparty.taxId,
        },
        taxTotal: {
          vatRate: entry.vatRate,
          taxAmount: entry.vatAmount,
        },
        legalMonetaryTotal: {
          lineExtensionAmount: entry.netAmount,
          taxExclusiveAmount: entry.netAmount,
          taxInclusiveAmount: entry.grossAmount,
          payableAmount: entry.grossAmount,
        },
      }
    },
  },
  {
    provider: 'dia',
    displayName: 'DİA Bulut ERP',
    description: 'DİA muhasebe, cari ve fatura web servisleri için standart aktarım şeması.',
    capabilities: {
      salesInvoices: true,
      purchaseBills: true,
      contactsSync: true,
      eInvoice: true,
      eArchive: true,
      eSmm: false,
      twoWaySync: true,
    },
    mapEntryToProviderPayload(entry, accountMapping = {}) {
      return {
        dis_referans: entry.idempotencyKey,
        tur: entry.direction === 'income' ? 'satis_faturasi' : 'alis_faturasi',
        belge_turu: entry.documentType,
        belge_no: entry.documentNumber,
        tarih: entry.issueDate,
        vade_tarihi: entry.dueDate,
        cari_unvan: entry.counterparty.name,
        vergi_no: entry.counterparty.taxId,
        hesap_kodu: accountMapping[entry.categoryCode] ?? entry.accountingAccountCode,
        doviz: entry.currency,
        kur: entry.exchangeRate,
        net_tutar: entry.netAmount,
        kdv_orani: entry.vatRate,
        kdv_tutari: entry.vatAmount,
        toplam_tutar: entry.grossAmount,
      }
    },
  },
  {
    provider: 'custom_webhook',
    displayName: 'Özel Ön Muhasebe / Webhook',
    description: 'Herhangi bir muhasebe yazılımı veya ERP için standart JSON/Webhook aktarım formatı.',
    capabilities: {
      salesInvoices: true,
      purchaseBills: true,
      contactsSync: true,
      eInvoice: true,
      eArchive: true,
      eSmm: true,
      twoWaySync: true,
    },
    mapEntryToProviderPayload(entry) {
      return { ...entry }
    },
  },
]

export const ALLOWED_PRE_ACCOUNTING_PROVIDERS: readonly PreAccountingProviderKey[] =
  SUPPORTED_PRE_ACCOUNTING_PROVIDERS.map((p) => p.provider)

export function getPreAccountingProviderAdapter(
  provider: string
): PreAccountingProviderAdapter | null {
  return SUPPORTED_PRE_ACCOUNTING_PROVIDERS.find((p) => p.provider === provider) ?? null
}

// ── Accountant CSV Export (RFC-4180 + Excel Formula Injection Safe) ──────────

function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value)
  // Guard against spreadsheet formula injection (=, +, -, @, leading tab/CR or whitespace before them) on non-numeric strings
  const neutralized =
    /^\s*[=+\-@\t\r]/.test(raw) && !/^\s*-?\d+([.,]\d+)?\s*$/.test(raw) ? `'${raw}` : raw
  if (/[;"\n\r,]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`
  }
  return neutralized
}

const DIRECTION_TR: Record<AccountingDirection, string> = {
  income: 'Gelir / Tahsilat',
  expense: 'Gider / Masraf',
}

const PAYMENT_STATUS_TR: Record<AccountingPaymentStatus, string> = {
  completed: 'Tamamlandı / Ödendi',
  partial: 'Kısmi Ödendi',
  pending: 'Bekliyor / Vadeli',
  cancelled: 'İptal',
}

const DOC_TYPE_TR = new Map(STANDARD_DOCUMENT_TYPE_OPTIONS.map((o) => [o.id, o.label]))
const SYNC_STATUS_TR: Record<AccountingSyncStatus, string> = {
  pending: 'Aktarım Bekliyor',
  ready: 'Aktarıma Hazır',
  synced: 'Muhasebeye Aktarıldı',
  failed: 'Aktarım Hatası',
  ignored: 'Kapsam Dışı',
}

export function formatAccountingCsv(entries: CanonicalAccountingEntry[]): string {
  const headers = [
    'İşlem Yönü',
    'Belge Türü',
    'Belge / Fatura No',
    'İşlem Tarihi',
    'Vade Tarihi',
    'Cari / Karşı Taraf',
    'VKN / TCKN',
    'Başlık',
    'Kategori',
    'Muhasebe Hesap Kodu (TDHP)',
    'Miktar',
    'Birim Net Tutar',
    'Matrah (KDV Hariç)',
    'KDV Oranı (%)',
    'KDV Tutarı',
    'Genel Toplam (Brüt)',
    'Para Birimi',
    'Döviz Kuru',
    'TRY Karşılığı',
    'Ödeme Durumu',
    'Ödeme Yöntemi',
    'Ön Muhasebe Durumu',
    'Harici Belge Kimliği',
    'Açıklama / Not',
    'Tekil Aktarım Anahtarı',
  ]

  const lines: string[] = [headers.map(escapeCsvCell).join(';')]
  for (const e of entries) {
    lines.push(
      [
        DIRECTION_TR[e.direction],
        DOC_TYPE_TR.get(e.documentType) ?? e.documentType,
        e.documentNumber ?? '',
        e.issueDate,
        e.dueDate ?? '',
        e.counterparty.name ?? '',
        e.counterparty.taxId ?? '',
        e.title,
        e.categoryLabel,
        e.accountingAccountCode,
        e.quantity,
        e.unitPriceNet,
        e.netAmount,
        e.vatRate,
        e.vatAmount,
        e.grossAmount,
        e.currency,
        e.exchangeRate,
        e.baseAmountTry,
        PAYMENT_STATUS_TR[e.paymentStatus],
        e.paymentMethodLabel,
        SYNC_STATUS_TR[e.sync.status],
        e.sync.externalDocumentId ?? '',
        e.description ?? '',
        e.idempotencyKey,
      ]
        .map(escapeCsvCell)
        .join(';')
    )
  }

  // UTF-8 BOM for seamless Turkish character support in Excel & Turkish accounting software
  return `\uFEFF${lines.join('\r\n')}`
}
