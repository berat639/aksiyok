import { isLiveModel, normalizeThinkingLevel, type ThinkingLevel } from './live-model-profile'
import type { NoiseFilterMode, TurnDetectionMode } from './turn-detector'

export const DEFAULT_OFF_TOPIC_CLOSE_MESSAGE =
  'Yardımcı olabileceğim başka bir işleminiz yoksa görüşmemizi sonlandırıyorum, iyi günler dilerim.'

export const DEFAULT_WHATSAPP_OFF_TOPIC_MESSAGE =
  'Bu hat yalnızca işletmemiz ve randevu/hizmet işlemleriniz için hizmet vermektedir. İşlemleriniz için dilediğiniz zaman yazabilirsiniz, iyi günler dileriz.'

export const ASSISTANT_GREETING_DEFAULTS = {
  inbound: 'Merhaba, hoş geldiniz! Size nasıl yardımcı olabilirim?',
  outbound: 'Merhaba, işletmemizden arıyorum. Randevu teyit ve memnuniyet görüşmemiz için müsait misiniz?',
  whatsapp: 'Merhaba, hoş geldiniz. Size nasıl yardımcı olabilirim?',
  web: 'Merhaba, web sesli asistanımıza hoş geldiniz. Size nasıl yardımcı olabilirim?',
} as const

export type FlowRuntimeModeOption = 'legacy' | 'observe' | 'active'
export type AssistantChannelKey = 'inbound' | 'outbound' | 'whatsapp' | 'web'
export type WhatsAppToneStyle = 'kurumsal' | 'samimi' | 'kisa_net'
export type WhatsAppOffTopicAction = 'reply_only' | 'pause_ai'

export interface VoiceSettings {
  model: 'gemini-3.8-live' | 'gemini-3.8-live-extended-thinking'
  thinkingLevel: ThinkingLevel
  voiceName: string
  startWaitSeconds: number
  turnDetectionMode: TurnDetectionMode
  noiseFilterMode: NoiseFilterMode
  callSilenceTimeout: number
  callSilenceCloseTimeout: number
  callMaxDuration: number
  maxActivePhoneCalls: number
  offTopicMaxStrikes: number
  offTopicCloseMessage: string
}

export interface InboundAssistantSettings extends VoiceSettings {
  greeting: string
  flowRuntimeMode: FlowRuntimeModeOption
}

export interface OutboundAssistantSettings extends Omit<VoiceSettings, 'maxActivePhoneCalls'> {
  callerId: string
  assignedNumbers: string[]
  greeting: string
  flowRuntimeMode: FlowRuntimeModeOption
  useInboundVoice: boolean
}

export interface WhatsAppAssistantSettings {
  greeting: string
  flowRuntimeMode: FlowRuntimeModeOption
  toneStyle: WhatsAppToneStyle
  allowEmoji: boolean
  allowLocationSharing: boolean
  autoHandoverOnUnclear: boolean
  offTopicMaxStrikes: number
  offTopicAction: WhatsAppOffTopicAction
  offTopicCloseMessage: string
}

export interface WebAssistantSettings extends Omit<VoiceSettings, 'maxActivePhoneCalls'> {
  greeting: string
  flowRuntimeMode: FlowRuntimeModeOption
  useInboundVoice: boolean
}

export interface AssistantChannelsPayload {
  inbound: InboundAssistantSettings
  outbound: OutboundAssistantSettings
  whatsapp: WhatsAppAssistantSettings
  web: WebAssistantSettings
}

export const VOICE_SETTINGS_DEFAULTS: VoiceSettings = {
  model: 'gemini-3.8-live',
  thinkingLevel: 'LOW',
  voiceName: 'Aoede',
  startWaitSeconds: 0.4,
  turnDetectionMode: 'semantic',
  noiseFilterMode: 'rnnoise',
  callSilenceTimeout: 30,
  callSilenceCloseTimeout: 15,
  callMaxDuration: 600,
  maxActivePhoneCalls: 3,
  offTopicMaxStrikes: 2,
  offTopicCloseMessage: DEFAULT_OFF_TOPIC_CLOSE_MESSAGE,
}

export const WHATSAPP_SETTINGS_DEFAULTS: Omit<WhatsAppAssistantSettings, 'greeting' | 'flowRuntimeMode'> = {
  toneStyle: 'kurumsal',
  allowEmoji: true,
  allowLocationSharing: true,
  autoHandoverOnUnclear: true,
  offTopicMaxStrikes: 2,
  offTopicAction: 'reply_only',
  offTopicCloseMessage: DEFAULT_WHATSAPP_OFF_TOPIC_MESSAGE,
}

export function buildOffTopicPromptRule(
  maxStrikes: number = VOICE_SETTINGS_DEFAULTS.offTopicMaxStrikes,
  closeMessage: string = VOICE_SETTINGS_DEFAULTS.offTopicCloseMessage,
  isDentalTemplate = false,
): string {
  const strikes = Math.min(5, Math.max(1, Math.round(Number(maxStrikes) || 2)))
  const msg = (closeMessage || DEFAULT_OFF_TOPIC_CLOSE_MESSAGE).trim() || DEFAULT_OFF_TOPIC_CLOSE_MESSAGE
  const domainWord = isDentalTemplate ? 'klinik veya randevu' : 'işletme veya randevu/hizmet'
  const redirectSentence = isDentalTemplate
    ? 'Bu konuda yardımcı olamıyorum, ancak kliniğimiz veya randevu işlemleriniz konusunda yardımcı olabilirim.'
    : 'Bu konuda yardımcı olamıyorum, ancak hizmetlerimiz veya randevu işlemleriniz konusunda yardımcı olabilirim.'
  if (strikes === 1) {
    return `KONU DIŞI OTOMATİK VEDA VE KAPATMA KURALI (SINIR: 1 KEZ): Karşı taraf ${domainWord} dışında alakasız bir konu açar ya da konuyu dağıtırsa sohbeti KESİNLİKLE sürdürme; doğrudan "${msg}" de ve cagriySonlandir aracını çağır.`
  }
  return `KONU DIŞI ISRAR VE OTOMATİK KAPATMA KURALI (SINIR: ${strikes}. KEZ):
1. Karşı taraf ${domainWord} dışında alakasız bir konu açarsa ilk ${strikes - 1} seferde konuyu açıklamadan nazikçe işleme yönlendir: "${redirectSentence}"
2. Karşı taraf uyarıya rağmen ${strikes}. kez konu dışına çıkar veya konuyu dağıtmaya devam ederse sohbeti KESİNLİKLE uzatma; aynen "${msg}" de ve hemen cagriySonlandir aracını çağır.`
}

export const ALLOWED_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
] as const

function toLocalTurkishPhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('90')) return `0${digits.slice(2)}`
  if (digits.length === 10 && !digits.startsWith('0')) return `0${digits}`
  return digits || String(raw || '').trim()
}

export function normalizeTurkishPhoneOrNull(raw: string): string | null {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null
  if (/[a-zA-ZğüşöçıİĞÜŞÖÇ]/.test(trimmed)) return null
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('90')) {
    return `0${digits.slice(2)}`
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits
  }
  if (digits.length === 10 && !digits.startsWith('0')) {
    return `0${digits}`
  }
  return null
}

export async function resolveVoiceSettings(
  clinicId?: string,
  direction: 'inbound' | 'outbound' | 'web' = 'inbound',
): Promise<VoiceSettings> {
  const [{ getSetting }, { resolveLiveModel }] = await Promise.all([
    import('../db/repositories/settings'),
    import('./assistant-config'),
  ])
  const [
    model,
    thinkingLevelRaw,
    voiceNameRaw,
    startWaitRaw,
    turnDetectionRaw,
    noiseFilterRaw,
    silenceWarnRaw,
    silenceCloseRaw,
    maxDurationRaw,
    maxCallsRaw,
    offTopicStrikesRaw,
    offTopicMsgRaw,
  ] = await Promise.all([
    resolveLiveModel(clinicId),
    getSetting('ai.thinking_level', clinicId),
    getSetting('ai.voice_name', clinicId),
    getSetting('ai.start_wait_seconds', clinicId),
    getSetting('ai.turn_detection_mode', clinicId),
    getSetting('ai.noise_filter_mode', clinicId),
    getSetting('ai.call_silence_timeout', clinicId),
    getSetting('ai.call_silence_close_timeout', clinicId),
    getSetting('ai.call_max_duration', clinicId),
    getSetting('ai.max_active_phone_calls', clinicId),
    getSetting('ai.off_topic_max_strikes', clinicId),
    getSetting('ai.off_topic_close_message', clinicId),
  ])

  const startWaitNum = Number(startWaitRaw)
  const silenceWarnNum = Number(silenceWarnRaw)
  const silenceCloseNum = Number(silenceCloseRaw)
  const maxDurationNum = Number(maxDurationRaw)
  const maxCallsNum = Number(maxCallsRaw)
  const offTopicStrikesNum = Number(offTopicStrikesRaw)
  const offTopicMsgClean = offTopicMsgRaw?.trim() || ''

  const inbound: VoiceSettings = {
    model: (isLiveModel(model) ? model : VOICE_SETTINGS_DEFAULTS.model) as VoiceSettings['model'],
    thinkingLevel: normalizeThinkingLevel(thinkingLevelRaw),
    voiceName: voiceNameRaw?.trim() || VOICE_SETTINGS_DEFAULTS.voiceName,
    startWaitSeconds: Number.isFinite(startWaitNum) && startWaitRaw !== null
      ? Math.min(2, Math.max(0, startWaitNum))
      : VOICE_SETTINGS_DEFAULTS.startWaitSeconds,
    turnDetectionMode: turnDetectionRaw === 'standard' || turnDetectionRaw === 'semantic'
      ? turnDetectionRaw
      : VOICE_SETTINGS_DEFAULTS.turnDetectionMode,
    noiseFilterMode: noiseFilterRaw === 'off' || noiseFilterRaw === 'rnnoise'
      ? noiseFilterRaw
      : VOICE_SETTINGS_DEFAULTS.noiseFilterMode,
    callSilenceTimeout: Number.isFinite(silenceWarnNum) && silenceWarnNum >= 5 && silenceWarnNum <= 120
      ? silenceWarnNum
      : VOICE_SETTINGS_DEFAULTS.callSilenceTimeout,
    callSilenceCloseTimeout: Number.isFinite(silenceCloseNum) && silenceCloseNum >= 5 && silenceCloseNum <= 120
      ? silenceCloseNum
      : VOICE_SETTINGS_DEFAULTS.callSilenceCloseTimeout,
    callMaxDuration: Number.isFinite(maxDurationNum) && maxDurationNum >= 180 && maxDurationNum <= 900
      ? maxDurationNum
      : VOICE_SETTINGS_DEFAULTS.callMaxDuration,
    maxActivePhoneCalls: Number.isInteger(maxCallsNum) && maxCallsNum >= 2 && maxCallsNum <= 5
      ? maxCallsNum
      : VOICE_SETTINGS_DEFAULTS.maxActivePhoneCalls,
    offTopicMaxStrikes: Number.isInteger(offTopicStrikesNum) && offTopicStrikesNum >= 1 && offTopicStrikesNum <= 5
      ? offTopicStrikesNum
      : VOICE_SETTINGS_DEFAULTS.offTopicMaxStrikes,
    offTopicCloseMessage: offTopicMsgClean.length >= 10 && offTopicMsgClean.length <= 240
      ? offTopicMsgClean
      : VOICE_SETTINGS_DEFAULTS.offTopicCloseMessage,
  }

  if (direction !== 'outbound' && direction !== 'web') {
    return inbound
  }

  const prefix = `ai.${direction}.`
  const [
    useInboundVoiceRaw,
    chModelRaw,
    chThinkingRaw,
    chVoiceRaw,
    chStartWaitRaw,
    chTurnDetectionRaw,
    chNoiseFilterRaw,
    chSilenceWarnRaw,
    chSilenceCloseRaw,
    chMaxDurationRaw,
    chOffTopicStrikesRaw,
    chOffTopicMsgRaw,
  ] = await Promise.all([
    getSetting(`${prefix}use_inbound_voice`, clinicId),
    getSetting(`${prefix}model`, clinicId),
    getSetting(`${prefix}thinking_level`, clinicId),
    getSetting(`${prefix}voice_name`, clinicId),
    getSetting(`${prefix}start_wait_seconds`, clinicId),
    getSetting(`${prefix}turn_detection_mode`, clinicId),
    getSetting(`${prefix}noise_filter_mode`, clinicId),
    getSetting(`${prefix}call_silence_timeout`, clinicId),
    getSetting(`${prefix}call_silence_close_timeout`, clinicId),
    getSetting(`${prefix}call_max_duration`, clinicId),
    getSetting(`${prefix}off_topic_max_strikes`, clinicId),
    getSetting(`${prefix}off_topic_close_message`, clinicId),
  ])

  const useInboundVoice = useInboundVoiceRaw !== 'false'
  const chStartWaitNum = Number(chStartWaitRaw)
  const chSilenceWarnNum = Number(chSilenceWarnRaw)
  const chSilenceCloseNum = Number(chSilenceCloseRaw)
  const chMaxDurationNum = Number(chMaxDurationRaw)
  const chOffTopicStrikesNum = Number(chOffTopicStrikesRaw)
  const chOffTopicMsgClean = chOffTopicMsgRaw?.trim() || ''
  const chVoiceClean = chVoiceRaw?.trim() || ''

  return {
    model: useInboundVoice
      ? inbound.model
      : ((chModelRaw && isLiveModel(chModelRaw) ? chModelRaw : inbound.model) as VoiceSettings['model']),
    thinkingLevel: useInboundVoice
      ? inbound.thinkingLevel
      : (chThinkingRaw !== null ? normalizeThinkingLevel(chThinkingRaw) : inbound.thinkingLevel),
    voiceName: useInboundVoice
      ? inbound.voiceName
      : ((ALLOWED_VOICES as readonly string[]).includes(chVoiceClean) ? chVoiceClean : inbound.voiceName),
    startWaitSeconds: chStartWaitRaw !== null && Number.isFinite(chStartWaitNum)
      ? Math.min(2, Math.max(0, chStartWaitNum))
      : inbound.startWaitSeconds,
    turnDetectionMode: chTurnDetectionRaw === 'standard' || chTurnDetectionRaw === 'semantic'
      ? chTurnDetectionRaw
      : inbound.turnDetectionMode,
    noiseFilterMode: chNoiseFilterRaw === 'off' || chNoiseFilterRaw === 'rnnoise'
      ? chNoiseFilterRaw
      : inbound.noiseFilterMode,
    callSilenceTimeout: chSilenceWarnRaw !== null && Number.isFinite(chSilenceWarnNum) && chSilenceWarnNum >= 5 && chSilenceWarnNum <= 120
      ? chSilenceWarnNum
      : inbound.callSilenceTimeout,
    callSilenceCloseTimeout: chSilenceCloseRaw !== null && Number.isFinite(chSilenceCloseNum) && chSilenceCloseNum >= 5 && chSilenceCloseNum <= 120
      ? chSilenceCloseNum
      : inbound.callSilenceCloseTimeout,
    callMaxDuration: chMaxDurationRaw !== null && Number.isFinite(chMaxDurationNum) && chMaxDurationNum >= 180 && chMaxDurationNum <= 900
      ? chMaxDurationNum
      : inbound.callMaxDuration,
    maxActivePhoneCalls: inbound.maxActivePhoneCalls,
    offTopicMaxStrikes: chOffTopicStrikesRaw !== null && Number.isInteger(chOffTopicStrikesNum) && chOffTopicStrikesNum >= 1 && chOffTopicStrikesNum <= 5
      ? chOffTopicStrikesNum
      : inbound.offTopicMaxStrikes,
    offTopicCloseMessage: chOffTopicMsgClean.length >= 10 && chOffTopicMsgClean.length <= 240
      ? chOffTopicMsgClean
      : inbound.offTopicCloseMessage,
  }
}

export function validateVoiceSettings(input: Record<string, unknown>): {
  valid: boolean
  error?: string
  fieldErrors: Partial<Record<keyof VoiceSettings, string>>
} {
  const fieldErrors: Partial<Record<keyof VoiceSettings, string>> = {}

  if (input.model !== undefined && !isLiveModel(String(input.model))) {
    fieldErrors.model = 'Geçersiz canlı model seçimi'
  }
  if (input.thinkingLevel !== undefined && !['LOW', 'MEDIUM', 'HIGH'].includes(String(input.thinkingLevel).toUpperCase())) {
    fieldErrors.thinkingLevel = 'Düşünme seviyesi düşük, orta veya yüksek olmalıdır'
  }
  if (input.voiceName !== undefined && !(ALLOWED_VOICES as readonly string[]).includes(String(input.voiceName).trim())) {
    fieldErrors.voiceName = 'Geçersiz asistan sesi seçimi'
  }
  if (input.startWaitSeconds !== undefined) {
    const wait = Number(input.startWaitSeconds)
    if (!Number.isFinite(wait) || wait < 0 || wait > 2) {
      fieldErrors.startWaitSeconds = 'Başlangıç bekleme süresi 0 ile 2 saniye arasında olmalıdır'
    }
  }
  if (input.turnDetectionMode !== undefined && !['semantic', 'standard'].includes(String(input.turnDetectionMode))) {
    fieldErrors.turnDetectionMode = 'Geçersiz konuşma sırası algılama modu'
  }
  if (input.noiseFilterMode !== undefined && !['rnnoise', 'off'].includes(String(input.noiseFilterMode))) {
    fieldErrors.noiseFilterMode = 'Geçersiz gürültü süzgeci modu'
  }
  if (input.callSilenceTimeout !== undefined) {
    const s = Number(input.callSilenceTimeout)
    if (!Number.isFinite(s) || s < 5 || s > 120) {
      fieldErrors.callSilenceTimeout = 'Sessizlik uyarısı 5 ile 120 saniye arasında olmalıdır'
    }
  }
  if (input.callSilenceCloseTimeout !== undefined) {
    const s = Number(input.callSilenceCloseTimeout)
    if (!Number.isFinite(s) || s < 5 || s > 120) {
      fieldErrors.callSilenceCloseTimeout = 'Uyarı sonrası kapanış süresi 5 ile 120 saniye arasında olmalıdır'
    }
  }
  if (input.callMaxDuration !== undefined) {
    const s = Number(input.callMaxDuration)
    if (!Number.isFinite(s) || s < 180 || s > 900) {
      fieldErrors.callMaxDuration = 'Maksimum görüşme süresi 3 ile 15 dakika arasında olmalıdır'
    }
  }
  if (input.maxActivePhoneCalls !== undefined) {
    const n = Number(input.maxActivePhoneCalls)
    if (!Number.isInteger(n) || n < 2 || n > 5) {
      fieldErrors.maxActivePhoneCalls = 'Aktif telefon çağrısı kapasitesi 2 ile 5 arasında olmalıdır'
    }
  }
  if (input.offTopicMaxStrikes !== undefined) {
    const n = Number(input.offTopicMaxStrikes)
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      fieldErrors.offTopicMaxStrikes = 'Konu dışı ısrar sınırı 1 ile 5 arasında olmalıdır'
    }
  }
  if (input.offTopicCloseMessage !== undefined) {
    const msg = String(input.offTopicCloseMessage ?? '').trim()
    if (msg.length < 10 || msg.length > 240) {
      fieldErrors.offTopicCloseMessage = 'Konu dışı kapanış mesajı 10 ile 240 karakter arasında olmalıdır'
    }
  }

  const firstError = Object.values(fieldErrors)[0]
  return {
    valid: !firstError,
    error: firstError,
    fieldErrors,
  }
}

export async function saveVoiceSettings(input: Record<string, unknown>, clinicId?: string): Promise<VoiceSettings> {
  const { setAiModel, setSetting } = await import('../db/repositories/settings')
  if (input.model !== undefined) await setAiModel(String(input.model), clinicId)
  if (input.thinkingLevel !== undefined) await setSetting('ai.thinking_level', normalizeThinkingLevel(String(input.thinkingLevel)), clinicId)
  if (input.voiceName !== undefined) await setSetting('ai.voice_name', String(input.voiceName).trim() || VOICE_SETTINGS_DEFAULTS.voiceName, clinicId)
  if (input.startWaitSeconds !== undefined) await setSetting('ai.start_wait_seconds', String(Number(input.startWaitSeconds)), clinicId)
  if (input.turnDetectionMode === 'semantic' || input.turnDetectionMode === 'standard') {
    await setSetting('ai.turn_detection_mode', input.turnDetectionMode, clinicId)
  }
  if (input.noiseFilterMode === 'rnnoise' || input.noiseFilterMode === 'off') {
    await setSetting('ai.noise_filter_mode', input.noiseFilterMode, clinicId)
  }
  if (input.callSilenceTimeout !== undefined) await setSetting('ai.call_silence_timeout', String(Number(input.callSilenceTimeout)), clinicId)
  if (input.callSilenceCloseTimeout !== undefined) await setSetting('ai.call_silence_close_timeout', String(Number(input.callSilenceCloseTimeout)), clinicId)
  if (input.callMaxDuration !== undefined) await setSetting('ai.call_max_duration', String(Number(input.callMaxDuration)), clinicId)
  if (input.maxActivePhoneCalls !== undefined) await setSetting('ai.max_active_phone_calls', String(Number(input.maxActivePhoneCalls)), clinicId)
  if (input.offTopicMaxStrikes !== undefined) await setSetting('ai.off_topic_max_strikes', String(Number(input.offTopicMaxStrikes)), clinicId)
  if (input.offTopicCloseMessage !== undefined) {
    await setSetting('ai.off_topic_close_message', String(input.offTopicCloseMessage).trim() || DEFAULT_OFF_TOPIC_CLOSE_MESSAGE, clinicId)
  }

  return resolveVoiceSettings(clinicId, 'inbound')
}

async function resolveOutboundCallerInfo(clinicId?: string): Promise<{ callerId: string; assignedNumbers: string[] }> {
  const assignedNumbers: string[] = []
  let providerCallerId = ''
  let savedSetting: string | null = null
  let effectiveClinicId = clinicId

  if (!effectiveClinicId) {
    try {
      const { currentClinicId } = await import('../tenancy/context')
      effectiveClinicId = currentClinicId() ?? undefined
    } catch {}
  }

  if (effectiveClinicId) {
    savedSetting = await import('../db/repositories/settings')
      .then(m => m.getSetting('outbound_caller_id', effectiveClinicId))
      .catch(() => null)

    try {
      const { getRow, decrypt } = await import('../integrations/managed/store')
      const row = await getRow(effectiveClinicId, 'phone').catch(() => null)
      const activeCfg = row?.active ? decrypt(row.active as any) : null
      const draftCfg = row?.draft ? decrypt(row.draft as any) : null
      const cfg = activeCfg || draftCfg
      if (cfg?.numbers && Array.isArray(cfg.numbers)) {
        for (const n of cfg.numbers) {
          const local = toLocalTurkishPhone(String(n))
          if (local && !assignedNumbers.includes(local)) assignedNumbers.push(local)
        }
      }
      if (cfg?.callerId) {
        providerCallerId = toLocalTurkishPhone(String(cfg.callerId))
        if (providerCallerId && !assignedNumbers.includes(providerCallerId)) {
          assignedNumbers.unshift(providerCallerId)
        }
      }
    } catch {}

    try {
      const { db } = await import('../db/client')
      const { sql } = await import('drizzle-orm')
      const rawRows = await db
        .execute(
          sql`SELECT phone_number, is_primary FROM clinic_phone_numbers WHERE clinic_id = ${effectiveClinicId} AND is_active = true ORDER BY is_primary DESC`,
        )
        .catch(() => [])
      const phoneRows = Array.isArray(rawRows)
        ? rawRows
        : Array.isArray((rawRows as any)?.rows)
          ? (rawRows as any).rows
          : []
      for (const pr of phoneRows as any[]) {
        const local = toLocalTurkishPhone(String(pr.phone_number || ''))
        if (local && !assignedNumbers.includes(local)) assignedNumbers.push(local)
        if (!providerCallerId && pr.is_primary && local) providerCallerId = local
      }
    } catch {}
  }

  const normalizedSaved = savedSetting ? toLocalTurkishPhone(savedSetting) : ''
  const effectiveCallerId =
    (normalizedSaved && (!assignedNumbers.length || assignedNumbers.includes(normalizedSaved)) ? normalizedSaved : '') ||
    providerCallerId ||
    normalizedSaved ||
    assignedNumbers[0] ||
    '08503096119'

  return { callerId: effectiveCallerId, assignedNumbers }
}

export async function resolveAssistantChannelsConfig(clinicId?: string): Promise<AssistantChannelsPayload> {
  const [{ getGreeting, getSetting }, { resolveFlowRuntimeMode }] = await Promise.all([
    import('../db/repositories/settings'),
    import('./flow-engine'),
  ])

  const [
    inboundVoice,
    outboundVoiceFull,
    webVoiceFull,
    inboundGreetingRaw,
    outboundGreetingRaw,
    whatsappGreetingRaw,
    webGreetingRaw,
    inboundMode,
    outboundMode,
    whatsappMode,
    webMode,
    outboundUseInboundRaw,
    webUseInboundRaw,
    outboundCallerInfo,
    waToneRaw,
    waEmojiRaw,
    waLocationRaw,
    waHandoverRaw,
    waStrikesRaw,
    waActionRaw,
    waCloseMsgRaw,
  ] = await Promise.all([
    resolveVoiceSettings(clinicId, 'inbound'),
    resolveVoiceSettings(clinicId, 'outbound'),
    resolveVoiceSettings(clinicId, 'web'),
    getGreeting('inbound', clinicId).catch(() => null),
    getGreeting('outbound', clinicId).catch(() => null),
    getGreeting('whatsapp', clinicId).catch(() => null),
    getGreeting('web', clinicId).catch(() => null),
    resolveFlowRuntimeMode(clinicId, 'inbound'),
    resolveFlowRuntimeMode(clinicId, 'outbound'),
    resolveFlowRuntimeMode(clinicId, 'whatsapp'),
    resolveFlowRuntimeMode(clinicId, 'web'),
    getSetting('ai.outbound.use_inbound_voice', clinicId).catch(() => null),
    getSetting('ai.web.use_inbound_voice', clinicId).catch(() => null),
    resolveOutboundCallerInfo(clinicId).catch(() => ({ callerId: '08503096119', assignedNumbers: [] as string[] })),
    getSetting('ai.whatsapp.tone_style', clinicId).catch(() => null),
    getSetting('ai.whatsapp.allow_emoji', clinicId).catch(() => null),
    getSetting('ai.whatsapp.allow_location_sharing', clinicId).catch(() => null),
    getSetting('ai.whatsapp.auto_handover_on_unclear', clinicId).catch(() => null),
    getSetting('ai.whatsapp.off_topic_max_strikes', clinicId).catch(() => null),
    getSetting('ai.whatsapp.off_topic_action', clinicId).catch(() => null),
    getSetting('ai.whatsapp.off_topic_close_message', clinicId).catch(() => null),
  ])

  const { maxActivePhoneCalls: _unusedOutboundMax, ...outboundVoice } = outboundVoiceFull
  const { maxActivePhoneCalls: _unusedWebMax, ...webVoice } = webVoiceFull

  const waStrikesNum = Number(waStrikesRaw)
  const waCloseClean = waCloseMsgRaw?.trim() || ''

  return {
    inbound: {
      ...inboundVoice,
      greeting: inboundGreetingRaw?.trim() || ASSISTANT_GREETING_DEFAULTS.inbound,
      flowRuntimeMode: inboundMode,
    },
    outbound: {
      ...outboundVoice,
      callerId: outboundCallerInfo.callerId,
      assignedNumbers: outboundCallerInfo.assignedNumbers,
      greeting: outboundGreetingRaw?.trim() || ASSISTANT_GREETING_DEFAULTS.outbound,
      flowRuntimeMode: outboundMode,
      useInboundVoice: outboundUseInboundRaw !== 'false',
    },
    whatsapp: {
      greeting: whatsappGreetingRaw?.trim() || ASSISTANT_GREETING_DEFAULTS.whatsapp,
      flowRuntimeMode: whatsappMode,
      toneStyle: waToneRaw === 'samimi' || waToneRaw === 'kisa_net' || waToneRaw === 'kurumsal'
        ? waToneRaw
        : WHATSAPP_SETTINGS_DEFAULTS.toneStyle,
      allowEmoji: waEmojiRaw !== 'false',
      allowLocationSharing: waLocationRaw !== 'false',
      autoHandoverOnUnclear: waHandoverRaw !== 'false',
      offTopicMaxStrikes: Number.isInteger(waStrikesNum) && waStrikesNum >= 1 && waStrikesNum <= 5
        ? waStrikesNum
        : WHATSAPP_SETTINGS_DEFAULTS.offTopicMaxStrikes,
      offTopicAction: waActionRaw === 'pause_ai' ? 'pause_ai' : 'reply_only',
      offTopicCloseMessage: waCloseClean.length >= 10 && waCloseClean.length <= 240
        ? waCloseClean
        : WHATSAPP_SETTINGS_DEFAULTS.offTopicCloseMessage,
    },
    web: {
      ...webVoice,
      greeting: webGreetingRaw?.trim() || inboundGreetingRaw?.trim() || ASSISTANT_GREETING_DEFAULTS.web,
      flowRuntimeMode: webMode,
      useInboundVoice: webUseInboundRaw !== 'false',
    },
  }
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function validateGreetingField(raw: unknown): string | undefined {
  const g = String(raw ?? '').trim()
  if (g.length < 3 || g.length > 280) {
    return 'Karşılama mesajı 3 ile 280 karakter arasında olmalıdır'
  }
  return undefined
}

function validateFlowModeField(raw: unknown): string | undefined {
  if (!['legacy', 'observe', 'active'].includes(String(raw))) {
    return 'Geçersiz akış çalışma modu'
  }
  return undefined
}

export function validateAssistantChannelsConfig(input: Record<string, unknown>): {
  valid: boolean
  error?: string
  fieldErrors: Record<string, string>
} {
  const fieldErrors: Record<string, string> = {}

  if (!isPlainRecord(input)) {
    return {
      valid: false,
      error: 'Geçersiz ayar verisi',
      fieldErrors: { root: 'Geçersiz ayar verisi' },
    }
  }

  for (const ch of ['inbound', 'outbound', 'whatsapp', 'web'] as const) {
    if (input[ch] !== undefined && !isPlainRecord(input[ch])) {
      fieldErrors[ch] = 'Geçersiz kanal yapılandırması'
    }
  }

  if (isPlainRecord(input.inbound)) {
    const inbound = input.inbound
    if (inbound.greeting !== undefined) {
      const err = validateGreetingField(inbound.greeting)
      if (err) fieldErrors['inbound.greeting'] = err
    }
    if (inbound.flowRuntimeMode !== undefined) {
      const err = validateFlowModeField(inbound.flowRuntimeMode)
      if (err) fieldErrors['inbound.flowRuntimeMode'] = err
    }
    const voiceRes = validateVoiceSettings(inbound)
    for (const [k, msg] of Object.entries(voiceRes.fieldErrors)) {
      if (msg) fieldErrors[`inbound.${k}`] = msg
    }
  }

  if (isPlainRecord(input.outbound)) {
    const outbound = input.outbound
    if (outbound.greeting !== undefined) {
      const err = validateGreetingField(outbound.greeting)
      if (err) fieldErrors['outbound.greeting'] = err
    }
    if (outbound.flowRuntimeMode !== undefined) {
      const err = validateFlowModeField(outbound.flowRuntimeMode)
      if (err) fieldErrors['outbound.flowRuntimeMode'] = err
    }
    if (outbound.callerId !== undefined) {
      const rawCaller = String(outbound.callerId ?? '').trim()
      if (rawCaller.length > 0 && !normalizeTurkishPhoneOrNull(rawCaller)) {
        fieldErrors['outbound.callerId'] = 'Geçerli bir 10 veya 11 haneli Türkiye telefon numarası girin'
      }
    }
    if (outbound.useInboundVoice !== undefined && typeof outbound.useInboundVoice !== 'boolean') {
      fieldErrors['outbound.useInboundVoice'] = 'Geçersiz ses mirası seçimi'
    }
    const { maxActivePhoneCalls: _ignoreMax, ...outboundVoiceCandidate } = outbound
    if (outbound.useInboundVoice === true) {
      if (outboundVoiceCandidate.voiceName === '') delete outboundVoiceCandidate.voiceName
      if (outboundVoiceCandidate.model === '') delete outboundVoiceCandidate.model
      if (outboundVoiceCandidate.thinkingLevel === '') delete outboundVoiceCandidate.thinkingLevel
    }
    const voiceRes = validateVoiceSettings(outboundVoiceCandidate)
    for (const [k, msg] of Object.entries(voiceRes.fieldErrors)) {
      if (msg) fieldErrors[`outbound.${k}`] = msg
    }
  }

  if (isPlainRecord(input.whatsapp)) {
    const wa = input.whatsapp
    if (wa.greeting !== undefined) {
      const err = validateGreetingField(wa.greeting)
      if (err) fieldErrors['whatsapp.greeting'] = err
    }
    if (wa.flowRuntimeMode !== undefined) {
      const err = validateFlowModeField(wa.flowRuntimeMode)
      if (err) fieldErrors['whatsapp.flowRuntimeMode'] = err
    }
    if (wa.toneStyle !== undefined && !['kurumsal', 'samimi', 'kisa_net'].includes(String(wa.toneStyle))) {
      fieldErrors['whatsapp.toneStyle'] = 'Geçersiz WhatsApp üslup seçimi'
    }
    if (wa.allowEmoji !== undefined && typeof wa.allowEmoji !== 'boolean') {
      fieldErrors['whatsapp.allowEmoji'] = 'Geçersiz emoji ayarı'
    }
    if (wa.allowLocationSharing !== undefined && typeof wa.allowLocationSharing !== 'boolean') {
      fieldErrors['whatsapp.allowLocationSharing'] = 'Geçersiz konum paylaşımı ayarı'
    }
    if (wa.autoHandoverOnUnclear !== undefined && typeof wa.autoHandoverOnUnclear !== 'boolean') {
      fieldErrors['whatsapp.autoHandoverOnUnclear'] = 'Geçersiz otomatik devir ayarı'
    }
    if (wa.offTopicMaxStrikes !== undefined) {
      const n = Number(wa.offTopicMaxStrikes)
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        fieldErrors['whatsapp.offTopicMaxStrikes'] = 'Klinik dışı mesaj sınırı 1 ile 5 arasında olmalıdır'
      }
    }
    if (wa.offTopicAction !== undefined && !['reply_only', 'pause_ai'].includes(String(wa.offTopicAction))) {
      fieldErrors['whatsapp.offTopicAction'] = 'Geçersiz kapsam dışı koruma davranışı'
    }
    if (wa.offTopicCloseMessage !== undefined) {
      const msg = String(wa.offTopicCloseMessage ?? '').trim()
      if (msg.length < 10 || msg.length > 240) {
        fieldErrors['whatsapp.offTopicCloseMessage'] = 'Sınır yanıt mesajı 10 ile 240 karakter arasında olmalıdır'
      }
    }
  }

  if (isPlainRecord(input.web)) {
    const web = input.web
    if (web.greeting !== undefined) {
      const err = validateGreetingField(web.greeting)
      if (err) fieldErrors['web.greeting'] = err
    }
    if (web.flowRuntimeMode !== undefined) {
      const err = validateFlowModeField(web.flowRuntimeMode)
      if (err) fieldErrors['web.flowRuntimeMode'] = err
    }
    if (web.useInboundVoice !== undefined && typeof web.useInboundVoice !== 'boolean') {
      fieldErrors['web.useInboundVoice'] = 'Geçersiz ses mirası seçimi'
    }
    const { maxActivePhoneCalls: _ignoreMax, ...webVoiceCandidate } = web
    if (web.useInboundVoice === true) {
      if (webVoiceCandidate.voiceName === '') delete webVoiceCandidate.voiceName
      if (webVoiceCandidate.model === '') delete webVoiceCandidate.model
      if (webVoiceCandidate.thinkingLevel === '') delete webVoiceCandidate.thinkingLevel
    }
    const voiceRes = validateVoiceSettings(webVoiceCandidate)
    for (const [k, msg] of Object.entries(voiceRes.fieldErrors)) {
      if (msg) fieldErrors[`web.${k}`] = msg
    }
  }

  const firstError = Object.values(fieldErrors)[0]
  return {
    valid: !firstError,
    error: firstError,
    fieldErrors,
  }
}

async function saveOverlayVoiceChannelSettings(
  direction: 'outbound' | 'web',
  channelObj: Record<string, unknown>,
  clinicId?: string,
): Promise<void> {
  const { setSetting } = await import('../db/repositories/settings')
  const prefix = `ai.${direction}.`
  if (channelObj.useInboundVoice !== undefined) {
    await setSetting(`${prefix}use_inbound_voice`, String(Boolean(channelObj.useInboundVoice)), clinicId)
  }
  if (channelObj.model !== undefined && isLiveModel(String(channelObj.model))) {
    await setSetting(`${prefix}model`, String(channelObj.model), clinicId)
  }
  if (channelObj.thinkingLevel !== undefined) {
    await setSetting(`${prefix}thinking_level`, normalizeThinkingLevel(String(channelObj.thinkingLevel)), clinicId)
  }
  if (channelObj.voiceName !== undefined && String(channelObj.voiceName).trim()) {
    await setSetting(`${prefix}voice_name`, String(channelObj.voiceName).trim(), clinicId)
  }
  if (channelObj.startWaitSeconds !== undefined) {
    await setSetting(`${prefix}start_wait_seconds`, String(Number(channelObj.startWaitSeconds)), clinicId)
  }
  if (channelObj.turnDetectionMode === 'semantic' || channelObj.turnDetectionMode === 'standard') {
    await setSetting(`${prefix}turn_detection_mode`, channelObj.turnDetectionMode, clinicId)
  }
  if (channelObj.noiseFilterMode === 'rnnoise' || channelObj.noiseFilterMode === 'off') {
    await setSetting(`${prefix}noise_filter_mode`, channelObj.noiseFilterMode, clinicId)
  }
  if (channelObj.callSilenceTimeout !== undefined) {
    await setSetting(`${prefix}call_silence_timeout`, String(Number(channelObj.callSilenceTimeout)), clinicId)
  }
  if (channelObj.callSilenceCloseTimeout !== undefined) {
    await setSetting(`${prefix}call_silence_close_timeout`, String(Number(channelObj.callSilenceCloseTimeout)), clinicId)
  }
  if (channelObj.callMaxDuration !== undefined) {
    await setSetting(`${prefix}call_max_duration`, String(Number(channelObj.callMaxDuration)), clinicId)
  }
  if (channelObj.offTopicMaxStrikes !== undefined) {
    await setSetting(`${prefix}off_topic_max_strikes`, String(Number(channelObj.offTopicMaxStrikes)), clinicId)
  }
  if (channelObj.offTopicCloseMessage !== undefined) {
    await setSetting(
      `${prefix}off_topic_close_message`,
      String(channelObj.offTopicCloseMessage).trim() || DEFAULT_OFF_TOPIC_CLOSE_MESSAGE,
      clinicId,
    )
  }
}

export async function saveAssistantChannelsConfig(
  input: Record<string, unknown>,
  clinicId?: string,
): Promise<AssistantChannelsPayload> {
  const { setGreeting, setOutboundCallerId, setSetting } = await import('../db/repositories/settings')

  if (isPlainRecord(input.inbound)) {
    const inbound = input.inbound
    await saveVoiceSettings(inbound, clinicId)
    if (inbound.greeting !== undefined) {
      await setGreeting(String(inbound.greeting).trim(), 'inbound', clinicId)
    }
    if (inbound.flowRuntimeMode !== undefined && ['legacy', 'observe', 'active'].includes(String(inbound.flowRuntimeMode))) {
      const mode = String(inbound.flowRuntimeMode)
      await setSetting('ai.flow_runtime_mode.inbound', mode, clinicId)
      await setSetting('ai.flow_runtime_mode', mode, clinicId)
    }
  }

  if (isPlainRecord(input.outbound)) {
    const outbound = input.outbound
    await saveOverlayVoiceChannelSettings('outbound', outbound, clinicId)
    if (outbound.greeting !== undefined) {
      await setGreeting(String(outbound.greeting).trim(), 'outbound', clinicId)
    }
    if (outbound.flowRuntimeMode !== undefined && ['legacy', 'observe', 'active'].includes(String(outbound.flowRuntimeMode))) {
      await setSetting('ai.flow_runtime_mode.outbound', String(outbound.flowRuntimeMode), clinicId)
    }
    if (outbound.callerId !== undefined) {
      const normalizedCaller = normalizeTurkishPhoneOrNull(String(outbound.callerId))
      if (normalizedCaller) {
        await setOutboundCallerId(normalizedCaller, clinicId)
        try {
          const { currentClinicId } = await import('../tenancy/context')
          const effectiveClinicId = clinicId ?? currentClinicId() ?? undefined
          if (effectiveClinicId) {
            const { getRow, decrypt, encrypt } = await import('../integrations/managed/store')
            const { phone: toE164 } = await import('../integrations/managed/model')
            const { db } = await import('../db/client')
            const { sql } = await import('drizzle-orm')
            const e164CallerId = toE164(normalizedCaller)
            const row = await getRow(effectiveClinicId, 'phone').catch(() => null)
            if (row) {
              const draftCfg = row.draft ? decrypt(row.draft as any) : null
              const activeCfg = row.active ? decrypt(row.active as any) : null
              const nextDraft = draftCfg
                ? encrypt({
                    ...draftCfg,
                    callerId: e164CallerId,
                    numbers: Array.isArray(draftCfg.numbers)
                      ? (draftCfg.numbers.includes(e164CallerId) ? draftCfg.numbers : [...draftCfg.numbers, e164CallerId])
                      : [e164CallerId],
                  })
                : null
              const nextActive = activeCfg
                ? encrypt({
                    ...activeCfg,
                    callerId: e164CallerId,
                    numbers: Array.isArray(activeCfg.numbers)
                      ? (activeCfg.numbers.includes(e164CallerId) ? activeCfg.numbers : [...activeCfg.numbers, e164CallerId])
                      : [e164CallerId],
                  })
                : null
              await db.execute(sql`
                UPDATE managed_integrations
                SET draft = COALESCE(${nextDraft ? JSON.stringify(nextDraft) : null}::jsonb, draft),
                    active = CASE WHEN active IS NOT NULL AND ${nextActive ? JSON.stringify(nextActive) : null}::jsonb IS NOT NULL THEN ${nextActive ? JSON.stringify(nextActive) : null}::jsonb ELSE active END,
                    updated_at = now()
                WHERE clinic_id = ${effectiveClinicId} AND service = 'phone'
              `)
              await db.execute(sql`UPDATE clinic_phone_numbers SET is_primary = (phone_number = ${e164CallerId}) WHERE clinic_id = ${effectiveClinicId}`)
            }
          }
        } catch {}
      }
    }
  }

  if (isPlainRecord(input.whatsapp)) {
    const wa = input.whatsapp
    if (wa.greeting !== undefined) {
      await setGreeting(String(wa.greeting).trim(), 'whatsapp', clinicId)
    }
    if (wa.flowRuntimeMode !== undefined && ['legacy', 'observe', 'active'].includes(String(wa.flowRuntimeMode))) {
      await setSetting('ai.flow_runtime_mode.whatsapp', String(wa.flowRuntimeMode), clinicId)
    }
    if (wa.toneStyle !== undefined && ['kurumsal', 'samimi', 'kisa_net'].includes(String(wa.toneStyle))) {
      await setSetting('ai.whatsapp.tone_style', String(wa.toneStyle), clinicId)
    }
    if (wa.allowEmoji !== undefined) {
      await setSetting('ai.whatsapp.allow_emoji', String(Boolean(wa.allowEmoji)), clinicId)
    }
    if (wa.allowLocationSharing !== undefined) {
      await setSetting('ai.whatsapp.allow_location_sharing', String(Boolean(wa.allowLocationSharing)), clinicId)
    }
    if (wa.autoHandoverOnUnclear !== undefined) {
      await setSetting('ai.whatsapp.auto_handover_on_unclear', String(Boolean(wa.autoHandoverOnUnclear)), clinicId)
    }
    if (wa.offTopicMaxStrikes !== undefined) {
      await setSetting('ai.whatsapp.off_topic_max_strikes', String(Number(wa.offTopicMaxStrikes)), clinicId)
    }
    if (wa.offTopicAction === 'reply_only' || wa.offTopicAction === 'pause_ai') {
      await setSetting('ai.whatsapp.off_topic_action', wa.offTopicAction, clinicId)
    }
    if (wa.offTopicCloseMessage !== undefined) {
      await setSetting(
        'ai.whatsapp.off_topic_close_message',
        String(wa.offTopicCloseMessage).trim() || DEFAULT_WHATSAPP_OFF_TOPIC_MESSAGE,
        clinicId,
      )
    }
  }

  if (isPlainRecord(input.web)) {
    const web = input.web
    await saveOverlayVoiceChannelSettings('web', web, clinicId)
    if (web.greeting !== undefined) {
      await setGreeting(String(web.greeting).trim(), 'web', clinicId)
    }
    if (web.flowRuntimeMode !== undefined && ['legacy', 'observe', 'active'].includes(String(web.flowRuntimeMode))) {
      await setSetting('ai.flow_runtime_mode.web', String(web.flowRuntimeMode), clinicId)
    }
  }

  return resolveAssistantChannelsConfig(clinicId)
}
