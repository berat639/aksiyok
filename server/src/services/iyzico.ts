import { createHmac, randomBytes } from 'node:crypto'

export interface IyzicoBuyerInput {
  clinicId: string
  fullName: string
  email: string
  phone: string
  identityOrTaxNumber: string
  address: string
  city: string
  ipAddress?: string | null
}

export interface IyzicoCheckoutInitializeParams {
  conversationId: string
  basketId: string
  callbackUrl: string
  buyer: IyzicoBuyerInput
}

export interface IyzicoCheckoutInitializeResponse {
  status: string
  locale?: string
  systemTime?: number
  conversationId?: string
  token?: string
  checkoutFormContent?: string
  tokenExpireTime?: number
  paymentPageUrl?: string
  errorCode?: string
  errorMessage?: string
  errorGroup?: string
}

export interface IyzicoCheckoutDetailResponse {
  status: string
  paymentStatus?: string
  paymentId?: string | number
  conversationId?: string
  token?: string
  price?: number
  paidPrice?: number
  currency?: string
  basketId?: string
  fraudStatus?: number
  errorCode?: string
  errorMessage?: string
  [key: string]: unknown
}

export function isIyzicoConfigured(): boolean {
  return Boolean(process.env.IYZICO_API_KEY?.trim() && process.env.IYZICO_SECRET_KEY?.trim())
}

function getIyzicoBaseUrl(): string {
  const configured = (process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com').trim()
  return configured.replace(/\/+$/, '') || 'https://sandbox-api.iyzipay.com'
}

export function buildIyzicoAuthHeader(params: {
  apiKey: string
  secretKey: string
  uriPath: string
  bodyJson: string
  randomKey?: string
}): { authorization: string; randomKey: string; signature: string } {
  const randomKey = params.randomKey || `${Date.now()}${randomBytes(6).toString('hex')}`
  const signature = createHmac('sha256', params.secretKey)
    .update(randomKey + params.uriPath + params.bodyJson)
    .digest('hex')
  const authString = `apiKey:${params.apiKey}&randomKey:${randomKey}&signature:${signature}`
  const encoded = Buffer.from(authString, 'utf8').toString('base64')
  return {
    authorization: `IYZWSv2 ${encoded}`,
    randomKey,
    signature,
  }
}

export function resolveIyzicoBuyerIdentityNumber(rawIdentityOrTax: string): {
  valid: boolean
  kind: 'tckn' | 'vkn' | 'invalid'
  normalizedInput: string
  iyzicoIdentityNumber: string
} {
  const digits = String(rawIdentityOrTax || '').replace(/\D/g, '')
  // 10-digit corporate VKN -> iyzico buyer.identityNumber requires an 11-digit TCKN format
  if (/^\d{10}$/.test(digits)) {
    return {
      valid: true,
      kind: 'vkn',
      normalizedInput: digits,
      iyzicoIdentityNumber: '11111111110',
    }
  }
  // 11-digit TCKN validation (starts 1-9, 11 digits, last digit even per Turkish TCKN parity rule)
  if (/^[1-9]\d{10}$/.test(digits) && Number(digits[10]) % 2 === 0) {
    return {
      valid: true,
      kind: 'tckn',
      normalizedInput: digits,
      iyzicoIdentityNumber: digits,
    }
  }
  return {
    valid: false,
    kind: 'invalid',
    normalizedInput: digits,
    iyzicoIdentityNumber: '',
  }
}

function splitFullName(fullName: string): { name: string; surname: string } {
  const cleaned = String(fullName || '').trim().replace(/\s+/g, ' ')
  const parts = cleaned.split(' ').filter(Boolean)
  if (parts.length === 0) return { name: 'Isletme', surname: 'Yoneticisi' }
  if (parts.length === 1) return { name: parts[0]!, surname: 'Yoneticisi' }
  return {
    name: parts.slice(0, -1).join(' '),
    surname: parts[parts.length - 1]!,
  }
}

function sanitizeGsmNumber(rawPhone: string): string {
  let digits = String(rawPhone || '').replace(/\D/g, '')
  if (digits.startsWith('0090')) digits = digits.slice(4)
  else if (digits.length === 12 && digits.startsWith('90')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length === 10) return `+90${digits}`
  return digits ? `+${digits}` : '+905555555555'
}

async function callIyzico<T>(uriPath: string, payload: Record<string, unknown>): Promise<T> {
  const apiKey = (process.env.IYZICO_API_KEY || '').trim()
  const secretKey = (process.env.IYZICO_SECRET_KEY || '').trim()
  if (!apiKey || !secretKey) {
    throw new Error('iyzico API anahtarları yapılandırılmamış.')
  }

  const bodyJson = JSON.stringify(payload)
  const { authorization, randomKey } = buildIyzicoAuthHeader({
    apiKey,
    secretKey,
    uriPath,
    bodyJson,
  })

  const url = `${getIyzicoBaseUrl()}${uriPath}`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authorization,
      'x-iyzi-rnd': randomKey,
      'x-iyzi-client-version': 'axamaz-iyzipay-v2',
    },
    body: bodyJson,
    signal: AbortSignal.timeout(15_000),
  })

  const data = (await response.json().catch(() => ({}))) as T
  return data
}

export async function initializeCheckoutForm(
  params: IyzicoCheckoutInitializeParams,
): Promise<IyzicoCheckoutInitializeResponse> {
  const identity = resolveIyzicoBuyerIdentityNumber(params.buyer.identityOrTaxNumber)
  if (!identity.valid) {
    throw new Error('Geçerli bir 11 haneli T.C. Kimlik Numarası veya 10 haneli Vergi Kimlik Numarası (VKN) girin.')
  }

  const { name, surname } = splitFullName(params.buyer.fullName)
  const contactName = `${name} ${surname}`.trim()
  const address = params.buyer.address.trim()
  const city = params.buyer.city.trim()
  const gsmNumber = sanitizeGsmNumber(params.buyer.phone)
  const ip = (params.buyer.ipAddress || '').trim() || '85.34.78.112'

  const payload: Record<string, unknown> = {
    locale: 'tr',
    conversationId: params.conversationId,
    price: '8400.00',
    paidPrice: '8400.00',
    currency: 'TRY',
    basketId: params.basketId,
    paymentGroup: 'SUBSCRIPTION',
    callbackUrl: params.callbackUrl,
    enabledInstallments: [1],
    buyer: {
      id: params.buyer.clinicId,
      name,
      surname,
      gsmNumber,
      email: params.buyer.email.trim().toLowerCase(),
      identityNumber: identity.iyzicoIdentityNumber,
      registrationAddress: address,
      ip,
      city,
      country: 'Turkey',
    },
    shippingAddress: {
      contactName,
      city,
      country: 'Turkey',
      address,
    },
    billingAddress: {
      contactName,
      city,
      country: 'Turkey',
      address,
    },
    basketItems: [
      {
        id: 'AXAMAZ-PRO-MONTHLY',
        name: 'axamaz Pro Bulut Isletme Yonetim Yazilimi (Aylik Abonelik - KDV Dahil)',
        category1: 'Bulut Yazilim (SaaS)',
        itemType: 'VIRTUAL',
        price: '8400.00',
      },
    ],
  }

  return callIyzico<IyzicoCheckoutInitializeResponse>(
    '/payment/iyzipos/checkoutform/initialize/auth/ecom',
    payload,
  )
}

export async function retrieveCheckoutForm(
  token: string,
  conversationId: string,
): Promise<IyzicoCheckoutDetailResponse> {
  return callIyzico<IyzicoCheckoutDetailResponse>(
    '/payment/iyzipos/checkoutform/auth/ecom/detail',
    {
      locale: 'tr',
      conversationId,
      token,
    },
  )
}
