process.env.DATABASE_URL ||= 'postgres://postgres:postgres@localhost:5432/voiceai'

import { describe, expect, test } from 'bun:test'
import {
  ASSISTANT_GREETING_DEFAULTS,
  buildOffTopicPromptRule,
  DEFAULT_OFF_TOPIC_CLOSE_MESSAGE,
  normalizeTurkishPhoneOrNull,
  validateAssistantChannelsConfig,
  validateVoiceSettings,
  VOICE_SETTINGS_DEFAULTS,
} from './voice-settings'
import { renderPromptTemplate } from '../prompts/registry'
import { PROMPT_SECTIONS } from '../data/default-prompts'

describe('voice-settings validation & prompt registry', () => {
  test('accepts valid voice settings including offTopicMaxStrikes and offTopicCloseMessage', () => {
    const res = validateVoiceSettings({
      model: 'gemini-3.8-live-extended-thinking',
      thinkingLevel: 'HIGH',
      voiceName: 'Aoede',
      startWaitSeconds: 0.6,
      callSilenceTimeout: 25,
      callSilenceCloseTimeout: 10,
      callMaxDuration: 480,
      maxActivePhoneCalls: 4,
      offTopicMaxStrikes: 2,
      offTopicCloseMessage: DEFAULT_OFF_TOPIC_CLOSE_MESSAGE,
    })
    expect(res.valid).toBe(true)
    expect(res.error).toBeUndefined()
  })

  test('rejects invalid voice settings with field-level errors', () => {
    const res = validateVoiceSettings({
      ...VOICE_SETTINGS_DEFAULTS,
      voiceName: 'InvalidVoiceName',
      startWaitSeconds: 5,
      callMaxDuration: 60,
      offTopicMaxStrikes: 9,
      offTopicCloseMessage: 'kısa',
    })
    expect(res.valid).toBe(false)
    expect(res.fieldErrors.voiceName).toBeDefined()
    expect(res.fieldErrors.startWaitSeconds).toBeDefined()
    expect(res.fieldErrors.callMaxDuration).toBeDefined()
    expect(res.fieldErrors.offTopicMaxStrikes).toBeDefined()
    expect(res.fieldErrors.offTopicCloseMessage).toBeDefined()
  })

  test('builds off-topic prompt rule from configured strikes and closing message', () => {
    const rule2 = buildOffTopicPromptRule(2, DEFAULT_OFF_TOPIC_CLOSE_MESSAGE)
    expect(rule2).toContain('SINIR: 2. KEZ')
    expect(rule2).toContain(DEFAULT_OFF_TOPIC_CLOSE_MESSAGE)

    const rule1 = buildOffTopicPromptRule(1, 'Görüşmemizi sonlandırıyorum, iyi günler.')
    expect(rule1).toContain('SINIR: 1 KEZ')
    expect(rule1).toContain('Görüşmemizi sonlandırıyorum, iyi günler.')
  })

  test('renders prompt template variables and includes all Faz 6 prompt keys', () => {
    const rendered = renderPromptTemplate(
      'Karşılama: "{{greeting}}" | Alanlar: {{customFields}}',
      { greeting: 'Hoş geldiniz', customFields: 'isim, telefon' },
    )
    expect(rendered).toBe('Karşılama: "Hoş geldiniz" | Alanlar: isim, telefon')

    const keys = PROMPT_SECTIONS.map(s => s.key)
    expect(keys).toContain('prompt.outbound_greeting_flow')
    expect(keys).toContain('prompt.whatsapp_greeting_flow')
    expect(keys).toContain('prompt.phone_channel_rules')
    expect(keys).toContain('prompt.flow_priority_rules')
    expect(keys).toContain('prompt.vip_default')
  })

  test('flowToPromptText includes wait-for-customer instructions after every question and traverses merged Hayır branch', async () => {
    const { flowToPromptText } = await import('../db/repositories/flows')
    const prompt = flowToPromptText({
      id: 'sample',
      name: 'sample',
      isActive: true,
      createdAt: '',
      updatedAt: '',
      nodes: [
        { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: { label: 'Karşılama Mesajı' } },
        { id: 'cond_kayitli', type: 'CONDITION', position: { x: 0, y: 100 }, data: { conditionField: 'kayitli', operator: 'equals', conditionValue: 'true' } },
        { id: 'field_sikayet', type: 'FIELD', position: { x: 0, y: 200 }, data: { fieldName: 'sikayet', description: 'Şikayetiniz veya yaptırmak istediğiniz işlem nedir?' } },
        { id: 'field_musteri_adi', type: 'FIELD', position: { x: 200, y: 200 }, data: { fieldName: 'musteri_adi', description: 'Adınızı ve soyadınızı alabilir miyim?', required: true } },
        { id: 'field_tel', type: 'FIELD', position: { x: 200, y: 300 }, data: { fieldName: 'telefon', description: 'Size ulaşabileceğimiz telefon numaranızı alabilir miyim?', required: true } },
        { id: 'field_tarih', type: 'FIELD', position: { x: 0, y: 400 }, data: { fieldName: 'tarih', description: 'Hangi tarihe randevu oluşturmak istersiniz?', required: true } },
        { id: 'field_saat', type: 'FIELD', position: { x: 0, y: 500 }, data: { fieldName: 'saat', description: 'Saat kaç için randevu istersiniz?', required: true } },
        { id: 'action_randevu', type: 'ACTION', position: { x: 0, y: 600 }, data: { action: 'save_appointment_pending' } },
        { id: 'end', type: 'END', position: { x: 0, y: 700 }, data: { label: 'Görüşmeyi Bitir' } },
      ],
      edges: [
        { id: 'e_s_c', source: 'start', target: 'cond_kayitli' },
        { id: 'e_c_true', source: 'cond_kayitli', sourceHandle: 'true', target: 'field_sikayet' },
        { id: 'e_c_false', source: 'cond_kayitli', sourceHandle: 'false', target: 'field_musteri_adi' },
        { id: 'e_ad_tel', source: 'field_musteri_adi', target: 'field_tel' },
        { id: 'e_tel_sik', source: 'field_tel', target: 'field_sikayet' },
        { id: 'e_sik_tar', source: 'field_sikayet', target: 'field_tarih' },
        { id: 'e_tar_sa', source: 'field_tarih', target: 'field_saat' },
        { id: 'e_sa_act', source: 'field_saat', target: 'action_randevu' },
        { id: 'e_act_end', source: 'action_randevu', target: 'end' },
      ],
    })

    expect(prompt).toContain('Müşterinin konuşmasını ve cevabını bekle')
    const hayirSection = prompt.split('- Hayır (Kırmızı Yol):')[1] || ''
    expect(hayirSection).toContain('"musteri_adi" bilgisini sor')
    expect(hayirSection).toContain('"telefon" bilgisini sor')
    expect(hayirSection).toContain('"sikayet" bilgisini sor')
    expect(hayirSection).toContain('"tarih" bilgisini sor')
    expect(hayirSection).toContain('"saat" bilgisini sor')
    expect(hayirSection).toContain('RANDEVU OLUŞTUR')
    expect(prompt).toContain('⚡ HIZLI GEÇİŞ VE TEKRARSIZ SORU KURALI')
  })

  test('isEnglishResponseDetected never false-positives on Turkish text or isolated common words', async () => {
    const { isEnglishResponseDetected, buildRealtimeDetectionConfig } = await import('./turn-detector')
    expect(isEnglishResponseDetected('Merhaba, randevu planı için uygun tarih nedir?')).toBe(false)
    expect(isEnglishResponseDetected('Tamam, test sonuçlarınızı kontrol ediyorum.')).toBe(false)
    expect(isEnglishResponseDetected('What time would you like to book your appointment?')).toBe(true)
    expect(isEnglishResponseDetected("I'm sorry, I cannot help with that.")).toBe(true)

    const phoneCfg = buildRealtimeDetectionConfig('semantic', 'phone')
    expect(phoneCfg.automaticActivityDetection?.silenceDurationMs).toBe(280)
    const webCfg = buildRealtimeDetectionConfig('semantic', 'web')
    expect(webCfg.automaticActivityDetection?.silenceDurationMs).toBe(350)
  })

  test('buildFlowNodePrompt combines consecutive musteri_adi+telefon and tarih+saat into single natural questions', async () => {
    const { buildDefaultWebFlow } = await import('../db/repositories/flows')
    const { buildFlowNodePrompt } = await import('./flow-engine')
    const webFlow = buildDefaultWebFlow()

    const firstNode = webFlow.nodes.find(n => n.id === 'field_musteri_adi')!
    const combinedIdentityPrompt = buildFlowNodePrompt(webFlow, firstNode, {})
    expect(combinedIdentityPrompt).toContain('adınızı, soyadınızı ve telefon numaranızı')

    const dateNode = webFlow.nodes.find(n => n.id === 'field_tarih')!
    const combinedSlotPrompt = buildFlowNodePrompt(webFlow, dateNode, { musteri_adi: 'Ahmet Yılmaz', telefon: '05551234567' })
    expect(combinedSlotPrompt).toContain('Hangi gün ve saat için randevu oluşturmamı istersiniz?')
  })

  test('validates 4-channel AI assistant configuration across inbound, outbound, whatsapp, and web', () => {
    const validRes = validateAssistantChannelsConfig({
      inbound: {
        ...VOICE_SETTINGS_DEFAULTS,
        greeting: ASSISTANT_GREETING_DEFAULTS.inbound,
        flowRuntimeMode: 'active',
      },
      outbound: {
        model: 'gemini-3.8-live',
        thinkingLevel: 'MEDIUM',
        voiceName: 'Kore',
        startWaitSeconds: 0.5,
        turnDetectionMode: 'semantic',
        noiseFilterMode: 'rnnoise',
        callSilenceTimeout: 25,
        callSilenceCloseTimeout: 15,
        callMaxDuration: 420,
        offTopicMaxStrikes: 2,
        offTopicCloseMessage: DEFAULT_OFF_TOPIC_CLOSE_MESSAGE,
        callerId: '08503096119',
        greeting: ASSISTANT_GREETING_DEFAULTS.outbound,
        flowRuntimeMode: 'observe',
        useInboundVoice: false,
      },
      whatsapp: {
        greeting: ASSISTANT_GREETING_DEFAULTS.whatsapp,
        flowRuntimeMode: 'active',
        toneStyle: 'samimi',
        allowEmoji: true,
        allowLocationSharing: true,
        autoHandoverOnUnclear: true,
        offTopicMaxStrikes: 3,
        offTopicCloseMessage: DEFAULT_OFF_TOPIC_CLOSE_MESSAGE,
      },
      web: {
        model: 'gemini-3.8-live-extended-thinking',
        thinkingLevel: 'HIGH',
        voiceName: 'Aoede',
        startWaitSeconds: 0.3,
        turnDetectionMode: 'semantic',
        noiseFilterMode: 'off',
        callSilenceTimeout: 30,
        callSilenceCloseTimeout: 15,
        callMaxDuration: 600,
        offTopicMaxStrikes: 2,
        offTopicCloseMessage: DEFAULT_OFF_TOPIC_CLOSE_MESSAGE,
        greeting: ASSISTANT_GREETING_DEFAULTS.web,
        flowRuntimeMode: 'legacy',
        useInboundVoice: true,
      },
    })
    expect(validRes.valid).toBe(true)
    expect(validRes.error).toBeUndefined()
    expect(Object.keys(validRes.fieldErrors)).toHaveLength(0)
  })

  test('rejects invalid 4-channel AI assistant fields with clear Turkish fieldErrors', () => {
    const invalidRes = validateAssistantChannelsConfig({
      inbound: {
        greeting: 'ab',
        flowRuntimeMode: 'invalid_mode',
        maxActivePhoneCalls: 99,
      },
      outbound: {
        callerId: '12345',
        greeting: 'x'.repeat(300),
        voiceName: 'UnknownVoice',
        useInboundVoice: false,
      },
      whatsapp: {
        greeting: 'a',
        toneStyle: 'argo',
        allowEmoji: 'evet' as unknown as boolean,
        offTopicMaxStrikes: 0,
        offTopicCloseMessage: 'kısa',
      },
      web: {
        greeting: 'ok',
        callMaxDuration: 50,
        flowRuntimeMode: 'wrong',
      },
    })
    expect(invalidRes.valid).toBe(false)
    expect(invalidRes.error).toBeDefined()
    expect(invalidRes.fieldErrors['inbound.greeting']).toBeDefined()
    expect(invalidRes.fieldErrors['inbound.flowRuntimeMode']).toBeDefined()
    expect(invalidRes.fieldErrors['inbound.maxActivePhoneCalls']).toBeDefined()
    expect(invalidRes.fieldErrors['outbound.callerId']).toBeDefined()
    expect(invalidRes.fieldErrors['outbound.greeting']).toBeDefined()
    expect(invalidRes.fieldErrors['outbound.voiceName']).toBeDefined()
    expect(invalidRes.fieldErrors['whatsapp.greeting']).toBeDefined()
    expect(invalidRes.fieldErrors['whatsapp.toneStyle']).toBeDefined()
    expect(invalidRes.fieldErrors['whatsapp.allowEmoji']).toBeDefined()
    expect(invalidRes.fieldErrors['whatsapp.offTopicMaxStrikes']).toBeDefined()
    expect(invalidRes.fieldErrors['whatsapp.offTopicCloseMessage']).toBeDefined()
    expect(invalidRes.fieldErrors['web.greeting']).toBeDefined()
    expect(invalidRes.fieldErrors['web.callMaxDuration']).toBeDefined()
    expect(invalidRes.fieldErrors['web.flowRuntimeMode']).toBeDefined()
  })

  test('normalizes valid 10-11 digit TR phone numbers and allows empty outbound callerId', () => {
    expect(normalizeTurkishPhoneOrNull('08503096119')).toBe('08503096119')
    expect(normalizeTurkishPhoneOrNull('8503096119')).toBe('08503096119')
    expect(normalizeTurkishPhoneOrNull('+90 532 123 45 67')).toBe('05321234567')
    expect(normalizeTurkishPhoneOrNull('123')).toBeNull()
    expect(normalizeTurkishPhoneOrNull('abc08503096119')).toBeNull()

    const emptyCallerRes = validateAssistantChannelsConfig({
      outbound: {
        callerId: '',
        greeting: ASSISTANT_GREETING_DEFAULTS.outbound,
      },
    })
    expect(emptyCallerRes.valid).toBe(true)
  })

  test('isNonSubstantiveWhatsAppOpening distinguishes pure greetings/gibberish from direct flow requests', async () => {
    const { isNonSubstantiveWhatsAppOpening } = await import('./assistant-config')
    expect(isNonSubstantiveWhatsAppOpening('Merhaba')).toBe(true)
    expect(isNonSubstantiveWhatsAppOpening('Selam, kolay gelsin!')).toBe(true)
    expect(isNonSubstantiveWhatsAppOpening('İyi günler orada mısınız?')).toBe(true)
    expect(isNonSubstantiveWhatsAppOpening('???')).toBe(true)
    expect(isNonSubstantiveWhatsAppOpening('asdfgh')).toBe(true)

    expect(isNonSubstantiveWhatsAppOpening('Merhaba, yarın saat 15:00 için randevu almak istiyorum')).toBe(false)
    expect(isNonSubstantiveWhatsAppOpening('Kanal tedavisi fiyatınız nedir?')).toBe(false)
    expect(isNonSubstantiveWhatsAppOpening('Dişim çok ağrıyor bugün boş yer var mı')).toBe(false)
    expect(isNonSubstantiveWhatsAppOpening('Randevumu iptal etmek istiyorum')).toBe(false)
  })
})
