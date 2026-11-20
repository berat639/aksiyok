import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import {
  PLAN_CATALOG,
  computeClinicEntitlements,
  normalizePlanId,
  normalizeTurkishMobilePhone,
} from './subscriptions'
import {
  buildIyzicoAuthHeader,
  resolveIyzicoBuyerIdentityNumber,
} from './iyzico'
import { isSharedAppHostname } from '../tenancy/hostname'

describe('SaaS plan catalog & normalization', () => {
  test('normalizes legacy baslangic to demo and preserves pro/kurumsal', () => {
    expect(normalizePlanId('baslangic')).toBe('demo')
    expect(normalizePlanId('BAŞLANGIÇ')).toBe('demo')
    expect(normalizePlanId('demo')).toBe('demo')
    expect(normalizePlanId('pro')).toBe('pro')
    expect(normalizePlanId('kurumsal')).toBe('kurumsal')
    expect(normalizePlanId(undefined)).toBe('kurumsal')
    expect(normalizePlanId('', 'demo')).toBe('demo')
  })

  test('demo plan enforces 2 admin-only users, 7-day trial, and disables Pro modules', () => {
    const demo = PLAN_CATALOG.demo
    expect(demo.name).toBe('Demo (7 Gün Ücretsiz)')
    expect(demo.monthlyNetTry).toBe(0)
    expect(demo.monthlyGrossTry).toBe(0)
    expect(demo.trialDays).toBe(7)
    expect(demo.maxUsers).toBe(2)
    expect(demo.adminOnlyUsers).toBe(true)
    expect(demo.dailyAiCallLimit).toBe(30)
    expect(demo.allowedTabs).toEqual(['calendar', 'patients', 'knowledge', 'integrations'])
    expect(demo.features.webAssistant).toBe(true)
    expect(demo.features.whatsapp).toBe(false)
    expect(demo.features.inboundCalls).toBe(false)
    expect(demo.features.outboundCalls).toBe(false)
    expect(demo.features.staffModule).toBe(false)
    expect(demo.features.financeModule).toBe(false)
    expect(demo.features.inventoryModule).toBe(false)
  })

  test('pro plan enforces 10 users, 7000 net + 20% VAT = 8400 TRY gross, and full operational modules', () => {
    const pro = PLAN_CATALOG.pro
    expect(pro.name).toBe('Pro')
    expect(pro.monthlyNetTry).toBe(7000)
    expect(pro.vatPercent).toBe(20)
    expect(pro.monthlyGrossTry).toBe(8400)
    expect(pro.maxUsers).toBe(10)
    expect(pro.adminOnlyUsers).toBe(false)
    expect(pro.dailyAiCallLimit).toBe(500)
    expect(pro.features.whatsapp).toBe(true)
    expect(pro.features.inboundCalls).toBe(true)
    expect(pro.features.outboundCalls).toBe(true)
    expect(pro.features.staffModule).toBe(true)
    expect(pro.features.financeModule).toBe(true)
    expect(pro.features.inventoryModule).toBe(true)
    expect(pro.features.customGeminiKey).toBe(false)
  })

  test('kurumsal plan defaults to 999 users and custom Gemini key access', () => {
    const kurumsal = PLAN_CATALOG.kurumsal
    expect(kurumsal.monthlyNetTry).toBeNull()
    expect(kurumsal.monthlyGrossTry).toBeNull()
    expect(kurumsal.maxUsers).toBe(999)
    expect(kurumsal.features.customGeminiKey).toBe(true)
    expect(kurumsal.dailyAiCallLimit).toBe(10000)
  })
})

describe('computeClinicEntitlements & trial expiration', () => {
  const fixedNow = new Date('2026-11-20T12:00:00.000Z')

  test('active demo trial reports remaining days, adminOnlyUsers=true, maxUsers=2, and isReadOnly=false', () => {
    const ent = computeClinicEntitlements({
      planId: 'demo',
      planStatus: 'trial',
      trialEndsAt: new Date('2026-11-25T12:00:00.000Z'),
      currentPeriodEnd: null,
      maxUsers: 2,
      activeUsersCount: 1,
      pendingInvitesCount: 1,
      iyzicoConfigured: false,
      now: fixedNow,
    })

    expect(ent.planId).toBe('demo')
    expect(ent.planStatus).toBe('trial')
    expect(ent.trialDaysRemaining).toBe(5)
    expect(ent.isTrialExpired).toBe(false)
    expect(ent.isReadOnly).toBe(false)
    expect(ent.adminOnlyUsers).toBe(true)
    expect(ent.maxUsers).toBe(2)
    expect(ent.activeUsersCount + ent.pendingInvitesCount).toBe(2)
  })

  test('expired demo trial flips effective planStatus to expired, isTrialExpired=true, and isReadOnly=true', () => {
    const ent = computeClinicEntitlements({
      planId: 'demo',
      planStatus: 'trial',
      trialEndsAt: new Date('2026-11-19T11:59:59.000Z'),
      currentPeriodEnd: null,
      maxUsers: 2,
      activeUsersCount: 2,
      pendingInvitesCount: 0,
      iyzicoConfigured: true,
      now: fixedNow,
    })

    expect(ent.planId).toBe('demo')
    expect(ent.planStatus).toBe('expired')
    expect(ent.trialDaysRemaining).toBe(0)
    expect(ent.isTrialExpired).toBe(true)
    expect(ent.isReadOnly).toBe(true)
    expect(ent.iyzicoConfigured).toBe(true)
  })

  test('canceled pro subscription retains access until currentPeriodEnd and expires afterwards', () => {
    const stillActive = computeClinicEntitlements({
      planId: 'pro',
      planStatus: 'canceled',
      trialEndsAt: null,
      currentPeriodEnd: new Date('2026-12-05T12:00:00.000Z'),
      maxUsers: 10,
      activeUsersCount: 6,
      pendingInvitesCount: 2,
      now: fixedNow,
    })
    expect(stillActive.planStatus).toBe('canceled')
    expect(stillActive.isReadOnly).toBe(false)
    expect(stillActive.maxUsers).toBe(10)

    const pastPeriod = computeClinicEntitlements({
      planId: 'pro',
      planStatus: 'canceled',
      trialEndsAt: null,
      currentPeriodEnd: new Date('2026-11-10T12:00:00.000Z'),
      maxUsers: 10,
      activeUsersCount: 6,
      pendingInvitesCount: 0,
      now: fixedNow,
    })
    expect(pastPeriod.planStatus).toBe('expired')
    expect(pastPeriod.isReadOnly).toBe(true)
  })
})

describe('iyzico IYZWSv2 HMAC-SHA256 signing & Turkish VKN/TCKN validation', () => {
  test('generates deterministic IYZWSv2 base64 header matching official iyzico formula', () => {
    const apiKey = 'sandbox-api-key-123'
    const secretKey = 'sandbox-secret-key-456'
    const uriPath = '/payment/iyzipos/checkoutform/initialize/auth/ecom'
    const bodyJson = JSON.stringify({ locale: 'tr', conversationId: 'conv_1', price: '8400.00' })
    const randomKey = '1700000000000abcdef'

    const res = buildIyzicoAuthHeader({
      apiKey,
      secretKey,
      uriPath,
      bodyJson,
      randomKey,
    })

    const expectedSig = createHmac('sha256', secretKey)
      .update(randomKey + uriPath + bodyJson)
      .digest('hex')

    expect(res.randomKey).toBe(randomKey)
    expect(res.signature).toBe(expectedSig)
    expect(res.authorization.startsWith('IYZWSv2 ')).toBe(true)

    const decoded = Buffer.from(res.authorization.slice('IYZWSv2 '.length), 'base64').toString('utf8')
    expect(decoded).toBe(`apiKey:${apiKey}&randomKey:${randomKey}&signature:${expectedSig}`)
  })

  test('maps 10-digit corporate VKN to 11111111110 and validates 11-digit TCKN', () => {
    const vkn = resolveIyzicoBuyerIdentityNumber('1234567890')
    expect(vkn.valid).toBe(true)
    expect(vkn.kind).toBe('vkn')
    expect(vkn.iyzicoIdentityNumber).toBe('11111111110')

    const tckn = resolveIyzicoBuyerIdentityNumber('11111111110')
    expect(tckn.valid).toBe(true)
    expect(tckn.kind).toBe('tckn')
    expect(tckn.iyzicoIdentityNumber).toBe('11111111110')

    expect(resolveIyzicoBuyerIdentityNumber('12345').valid).toBe(false)
    expect(resolveIyzicoBuyerIdentityNumber('01234567890').valid).toBe(false)
    expect(resolveIyzicoBuyerIdentityNumber('11111111111').valid).toBe(false)
  })
})

describe('shared-host single-URL tenancy & phone normalization', () => {
  test('recognizes built-in shared hosts and custom SHARED_APP_HOSTS while isolating tenant domains', () => {
    expect(isSharedAppHostname('localhost:3000', '')).toBe(true)
    expect(isSharedAppHostname('127.0.0.1', '')).toBe(true)
    expect(isSharedAppHostname('axamaz.com', '')).toBe(true)
    expect(isSharedAppHostname('https://www.axamaz.com/', '')).toBe(true)
    expect(isSharedAppHostname('app.axamaz.com', '')).toBe(true)
    expect(isSharedAppHostname('panel.axamaz.com', '')).toBe(true)
    expect(isSharedAppHostname('portal.ornek.com', 'portal.ornek.com, staging-app.axamaz.com')).toBe(true)

    expect(isSharedAppHostname('klinik-ankara-a1b2.axamaz.com', '')).toBe(false)
    expect(isSharedAppHostname('dis-klinigi.com', '')).toBe(false)
    expect(isSharedAppHostname('', '')).toBe(false)
  })

  test('normalizes Turkish mobile numbers to +905XXXXXXXXX and rejects landlines/invalid numbers', () => {
    expect(normalizeTurkishMobilePhone('0532 123 45 67')).toBe('+905321234567')
    expect(normalizeTurkishMobilePhone('+90 (555) 987-6543')).toBe('+905559876543')
    expect(normalizeTurkishMobilePhone('5421112233')).toBe('+905421112233')
    expect(normalizeTurkishMobilePhone('00905051234567')).toBe('+905051234567')

    expect(normalizeTurkishMobilePhone('0212 123 45 67')).toBeNull()
    expect(normalizeTurkishMobilePhone('12345')).toBeNull()
  })
})
