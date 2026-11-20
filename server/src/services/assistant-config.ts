import { getAiModel, getGreeting, getSetting } from '../db/repositories/settings'
import { PROMPT_SECTION_KEYS, getDefaultPromptValue } from '../data/default-prompts'
import { getEffectivePromptSections, renderPromptTemplate } from '../prompts/registry'
import { ALLOWED_LIVE_MODELS, DEFAULT_LIVE_MODEL, isLiveModel } from './live-model-profile'
import { wrapWithTurkishLanguageLock } from './turn-detector'
import { extractUrlsFromText } from './dynamic-link-matcher'
import { getClinicDynamicPromptMetadata, type ClinicDynamicPromptMetadata } from '../db/repositories/dynamic-tables'
import { currentBusinessTemplate } from '../tenancy/context'

export { ALLOWED_LIVE_MODELS, DEFAULT_LIVE_MODEL }

export async function resolveLiveModel(clinicId?: string): Promise<string> {
  const saved = await getAiModel(clinicId).catch(() => null)
  if (isLiveModel(saved)) return saved
  const fromEnv = process.env.GEMINI_LIVE_MODEL
  if (isLiveModel(fromEnv)) return fromEnv
  return DEFAULT_LIVE_MODEL
}

const PURE_WHATSAPP_GREETING_TOKENS = new Set([
  'merhaba', 'merhabalar', 'mrb', 'selam', 'selamlar', 'slm', 'selamunaleykum', 'aleykumselam',
  'iyi', 'gunler', 'aksamlar', 'sabahlar', 'geceler', 'gunaydin', 'tunaydin',
  'hayirli', 'isler', 'kolay', 'gelsin', 'alo', 'hey', 'hi', 'hello',
  'orada', 'orda', 'misiniz', 'musait', 'kimse', 'var', 'mi', 'bakar', 'deneme', 'test',
])

/**
 * Kullanıcının WhatsApp ilk mesajının yalnızca selamlama, noktalama/emoji veya
 * anlamsız kısa karakter dizisi olup olmadığını belirler.
 * Somut bir talep/soru varsa false döner (böylece sabit karşılama cümlesi atlanır).
 */
export function isNonSubstantiveWhatsAppOpening(rawText: string): boolean {
  if (extractUrlsFromText(String(rawText || '')).length > 0) return false

  const folded = String(rawText || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!folded) return true
  if (folded.length <= 2) return true

  const words = folded.split(' ').filter(Boolean)
  if (words.every(w => PURE_WHATSAPP_GREETING_TOKENS.has(w))) return true

  // 6+ haneli ilan no / sipariş no / telefon numarası doğrudan somut girdi sayılır
  if (/^\d{6,}$/.test(folded)) return false

  // Rastgele klavye tuşlamaları ("asdfgh", "qwrty", "zxcvb", "1234" vb.)
  const digitsOnly = folded.replace(/\D/g, '')
  if (
    digitsOnly.length < 6 &&
    words.length === 1 &&
    (!/[aeiou]/.test(folded) || /[bcdfghjklmnpqrstvwxyz]{5,}/.test(folded) || /^\d+$/.test(folded))
  ) {
    return true
  }

  return false
}

export async function buildSystemPrompt(greeting: string, direction: string = 'inbound'): Promise<string> {
  const businessTemplate = currentBusinessTemplate()
  const isDentalTemplate = businessTemplate === 'dental_clinic'
  let dbSections: Record<string, string> = {}
  try {
    dbSections = await getEffectivePromptSections(businessTemplate)
  } catch { }

  let dynMeta: ClinicDynamicPromptMetadata | null = null
  try {
    dynMeta = await getClinicDynamicPromptMetadata()
  } catch { }

  const parts: string[] = []
  let activeFlow: import('../db/repositories/flows').ConversationFlow | null = null
  let minimalFlow = false
  let hasStructuredFlow = false
  let flowRuntimeActive = false
  try {
    const flows = await import('../db/repositories/flows')
    const { resolveFlowRuntimeMode } = await import('./flow-engine')
    activeFlow = await flows.getActiveFlow(direction)
    minimalFlow = Boolean(activeFlow && flows.isMinimalGreetingEndFlow(activeFlow))
    hasStructuredFlow = Boolean(activeFlow && activeFlow.nodes.length > 2)
    flowRuntimeActive = (await resolveFlowRuntimeMode(undefined, direction)) === 'active'
  } catch { }
  const isWhatsApp = direction === 'whatsapp'
  for (const key of PROMPT_SECTION_KEYS) {
    // Minimal veya yapılandırılmış Flow Builder akışı aktifken varsayılan randevu kurallarını ekleme
    if ((minimalFlow || hasStructuredFlow || flowRuntimeActive) && key === 'prompt.appointment_rules') continue
    // WhatsApp yazılı kanalında ses/mikrofon/çağrı aktarım odaklı bölümleri bağlama ekleme
    if (isWhatsApp && (key === 'prompt.scope' || key === 'prompt.service_flow' || key === 'prompt.general_rules' || key === 'prompt.rag_template')) {
      continue
    }
    // sales_flow zaten searchKnowledgeBase kuralını verir; özelleştirilmemiş rag_template tekrarını atla
    if (key === 'prompt.rag_template' && !dbSections[key]) continue

    // Web kanalında telefon santral aktarımı (aramaAktar) talimatlarını ekleme
    if (direction === 'web' && key === 'prompt.service_flow') {
      parts.push('NOT BIRAKMA: Müşteri mesaj, şikayet veya geri arama notu bırakmak isterse hastaNotKaydet çağır.')
      continue
    }
    let value = dbSections[key] || getDefaultPromptValue(key, businessTemplate) || ''
    if (key === 'prompt.greeting_flow') {
      if (isWhatsApp) {
        value = dbSections['prompt.whatsapp_greeting_flow']
          || getDefaultPromptValue('prompt.whatsapp_greeting_flow')
          || 'WhatsApp yazılı destek veriyorsun. Kısa ve net yaz; her mesajda tekrar karşılama ve telefon/arama kurallarını uygulama.'
      } else if (direction === 'outbound') {
        const outboundTpl = dbSections['prompt.outbound_greeting_flow']
          || getDefaultPromptValue('prompt.outbound_greeting_flow')
          || 'GİDEN ARAMA: Karşı taraf açınca İLK cümlede "{{greeting}}" de ve akış adımlarını sırayla uygula.'
        value = /\{\{\s*greeting\s*\}\}/.test(outboundTpl)
          ? renderPromptTemplate(outboundTpl, { greeting })
          : `${outboundTpl}\n"${greeting}"`
      } else if (direction === 'web') {
        value = `WEB SESLİ KARŞILAMA: İlk cümlede "${greeting}" de; müşteriyi dinle, bilinen bilgileri tekrar sorma.`
      } else {
        value = /\{\{\s*greeting\s*\}\}/.test(value)
          ? renderPromptTemplate(value, { greeting })
          : `KARŞILAMA: İlk cümlede "${greeting}" de; ardından müşterinin talebini dinle.`
      }
    }

    if (dynMeta?.isNonDentalTenant) {
      if (key === 'prompt.price_policy' && (dynMeta.hasPriceColumn || dynMeta.hasLinkColumn || dynMeta.hasDynamicTables)) {
        if (/telefonda net ücret|muayene sonrası|tedavi ücreti|diş|hekim|klinikte belirlenir/i.test(value)) {
          value =
            'FİYAT VE TABLO POLİTİKASI: Kullanıcı veri tablolarındaki bir ilan, ürün veya kayıt için fiyat/detay sorduğunda veriTablosuSorgula veya canlı satır bilgisindeki gerçek değeri paylaş; tabloda olmayan fiyatı uydurma.'
        }
      } else if (key === 'prompt.forbidden_patterns' && (dynMeta.hasPriceColumn || dynMeta.hasLinkColumn || dynMeta.hasDynamicTables)) {
        value = value
          .split('\n')
          .filter(line => !/TELEFONDA ÜCRET|FİYAT BİLGİSİ VERME|hekim muayenesi/i.test(line))
          .join('\n')
          .trim()
      } else if (key === 'prompt.scope' && /diş|hekim|tıbbi|tedavi|muayene|klinik dışı|kliniğimiz/i.test(value)) {
        value =
          'KAPSAM: Aktif veri tablolarındaki kayıtlar, linkler, hizmetler ve randevu planlamasında yardımcı ol; tablo dışı dış kaynaklı bilgi uydurma.\n- ÖKSÜRÜK, HAPŞIRIK VE İNSANİ SESLER: Öksürük/hapşırık kapsam dışı değildir; "Çok geçmiş olsun" deyip devam et.'
      } else if (key === 'prompt.sales_flow' && /diş|hekim|tıbbi|tedavi|muayene|klinik/i.test(value)) {
        value =
          'BİLGİLENDİRME VE RANDEVU AKIŞI: Müşterinin ilettiği link veya talepte önce veri tablolarındaki canlı kaydı kontrol et, gerçek bilgileri paylaş ve randevu/görüşme planlamasına yardımcı ol.'
      } else if (key === 'prompt.general_rules' && /klinik dışı|kliniğimiz|klinik/i.test(value)) {
        value = value
          .replace(/klinik dışı/gi, 'işletme kapsamı dışı')
          .replace(/klinik\/randevu/gi, 'işletme/randevu')
          .replace(/kliniğimiz/gi, 'işletmemiz')
      } else if (key === 'prompt.greeting_flow' && isWhatsApp && /diş|kliniğimiz|hastalarımız/i.test(value)) {
        value =
          'WhatsApp yazılı destek veriyorsun. Kısa ve net yaz; canlı veri tablolarındaki bilgileri doğrudan paylaş, her mesajda tekrar karşılama.'
      }
    }

    if (value) parts.push(value)
  }

  // Inject conversation flow as prompt text
  try {
    const { flowToPromptText } = await import('../db/repositories/flows')
    // The runtime sends only the active task through its tool result. Keeping
    // the whole graph out of the Live instruction avoids charging it every turn.
    if (activeFlow && !flowRuntimeActive) {
      let flowText = flowToPromptText(activeFlow)
      if (flowText && dynMeta?.isNonDentalTenant) {
        flowText = flowText
          .replace(/klinikle ilgili/gi, 'işletme veya kayıtlarla ilgili')
          .replace(/klinik dışı/gi, 'işletme kapsamı dışı')
          .replace(/klinik adımına/gi, 'kayıt/randevu adımına')
          .replace(/klinik işleminiz/gi, 'işleminiz')
      }
      if (flowText) parts.push(flowText)
    }
  } catch { }

  if (dynMeta?.hasDynamicTables && dynMeta.tablesSummary) {
    parts.push(
      `AKTİF VERİ TABLOLARI (CANLI VERİTABANI):\n${dynMeta.tablesSummary}\n- Link/URL, başlık veya kayıt sorularında Google veya harici internet araması KESİNLİKLE YAPMA; yalnızca veriTablosuSorgula ve canlı tablo bağlamını kullan. Eşleşen satır yoksa uydurma, bulunamadığını söyle.${dynMeta.hasPriceColumn ? ' Satırdaki Fiyat/Ücret değerini doğrudan paylaş.' : ''}`,
    )
  }

  // Inject live clinic doctor roster and working hours from DB so the assistant
  // immediately knows active doctors, their specialties, and clinic hours.
  if (!minimalFlow) {
    try {
      const { buildClinicRosterAndHoursText } = await import('./knowledge')
      const rosterText = await buildClinicRosterAndHoursText()
      if (rosterText) {
        parts.push(
          isDentalTemplate
            ? `KLİNİK HEKİMLER VE MESAİ:\n${rosterText}\n(Buradaki bilgiler için searchKnowledgeBase çağırma.)`
            : `EKİP KADROSU VE MESAİ:\n${rosterText}\n(Buradaki bilgiler için searchKnowledgeBase çağırma.)`,
        )
      }
    } catch { }
  }

  if (isWhatsApp) {
    try {
      const { DEFAULT_WHATSAPP_OFF_TOPIC_MESSAGE, ASSISTANT_GREETING_DEFAULTS } = await import('./voice-settings')
      const [
        toneStyleRaw,
        allowEmojiRaw,
        autoHandoverRaw,
        waStrikesRaw,
        waActionRaw,
        waCloseMsgRaw,
        savedWaGreeting,
      ] = await Promise.all([
        getSetting('ai.whatsapp.tone_style'),
        getSetting('ai.whatsapp.allow_emoji'),
        getSetting('ai.whatsapp.auto_handover_on_unclear'),
        getSetting('ai.whatsapp.off_topic_max_strikes'),
        getSetting('ai.whatsapp.off_topic_action'),
        getSetting('ai.whatsapp.off_topic_close_message'),
        getGreeting('whatsapp'),
      ])
      const waLines: string[] = []
      if (dynMeta?.isNonDentalTenant) {
        waLines.push('- Kapsam: Aktif veri tablolarındaki kayıtlar, linkler, hizmetler ve randevu taleplerinde yardımcı ol; dış internet bilgisi sunma.')
      }
      const effectiveWaGreeting =
        greeting.trim() || savedWaGreeting?.trim() || ASSISTANT_GREETING_DEFAULTS.whatsapp
      waLines.push(
        `- İlk Mesaj: Yalnızca selam/belirsiz mesajsa "${effectiveWaGreeting}" yaz; somut randevu/hizmet/link talebindeyse bu kalıbı atla ve doğrudan konuya yanıt ver. Devam eden sohbette tekrar karşılama.`,
      )
      const toneStyle = toneStyleRaw === 'samimi' || toneStyleRaw === 'kisa_net' || toneStyleRaw === 'kurumsal'
        ? toneStyleRaw
        : 'kurumsal'
      if (toneStyle === 'samimi') {
        waLines.push('- Üslup: Sıcak ve samimi bir dil kullan.')
      } else if (toneStyle === 'kisa_net') {
        waLines.push('- Üslup: Çok kısa ve net yaz.')
      } else {
        waLines.push('- Üslup: Kurumsal ve resmi ("Siz" dili) yaz.')
      }

      const allowEmoji = allowEmojiRaw !== 'false'
      waLines.push(allowEmoji ? '- Emoji: Ölçülü emoji kullanabilirsin.' : '- Emoji: Kesinlikle emoji kullanma.')

      const autoHandoverOnUnclear = autoHandoverRaw !== 'false'
      if (autoHandoverOnUnclear) {
        waLines.push(
          dynMeta?.isNonDentalTenant
            ? '- Belirsiz Talep: Yanıtı tabloda bulunmayan veya yetkili gereken durumlarda insanaAktar çağır.'
            : '- Belirsiz Talep: Karmaşık veya tıbbi değerlendirme gerektiren taleplerde insanaAktar çağır.',
        )
      }

      const waStrikesNum = Number(waStrikesRaw)
      const waStrikes = Number.isInteger(waStrikesNum) && waStrikesNum >= 1 && waStrikesNum <= 5
        ? waStrikesNum
        : 2
      const waPauseAi = waActionRaw === 'pause_ai'
      const waCloseMsg = (waCloseMsgRaw?.trim() || DEFAULT_WHATSAPP_OFF_TOPIC_MESSAGE).trim()
      const inScopeSubject = dynMeta?.isNonDentalTenant
        ? 'veri tabloları, ilan/kayıt bilgileri, hizmetler veya randevu'
        : 'klinik veya randevu'
      const scopeHint = dynMeta?.hasDynamicTables
        ? ' (Link, ürün/kayıt, fiyat ve tablo soruları kapsam içidir.)'
        : ''
      if (waStrikes === 1) {
        waLines.push(
          waPauseAi
            ? `- Kapsam Dışı (1 Kez — Duraklat): ${inScopeSubject} dışı mesajda hemen konuDisiSohbetDuraklat çağır ve yalnızca "${waCloseMsg}" yaz.${scopeHint}`
            : `- Kapsam Dışı (1 Kez): ${inScopeSubject} dışı mesajda yeni soru sormadan yalnızca "${waCloseMsg}" yaz.${scopeHint}`,
        )
      } else {
        waLines.push(
          waPauseAi
            ? `- Kapsam Dışı (${waStrikes} Kez — Duraklat): ${inScopeSubject} dışı ilk ${waStrikes - 1} mesajda kısaca konuya yönlendir; ${waStrikes}. mesajda konuDisiSohbetDuraklat çağır ve yalnızca "${waCloseMsg}" yaz.${scopeHint}`
            : `- Kapsam Dışı (${waStrikes} Kez): ${inScopeSubject} dışı ilk ${waStrikes - 1} mesajda kısaca konuya yönlendir; ${waStrikes}. mesajda yalnızca "${waCloseMsg}" yaz.${scopeHint}`,
        )
      }

      if (waLines.length > 0) {
        parts.push(`WHATSAPP AYARLARI:\n${waLines.join('\n')}`)
      }
    } catch { }
    return parts.join('\n\n')
  } else {
    const joined = parts.join('\n\n')
    if (!joined.toLowerCase().includes('öksür')) {
      parts.push(
        'KONUŞMA DIŞI SESLER (ÖKSÜRÜK / HAPŞIRIK): Öksürük, hapşırık veya gürültü kapsam dışı değildir; "Çok geçmiş olsun" deyip kaldığın yerden devam et.',
      )
    }
    try {
      const { buildOffTopicPromptRule, DEFAULT_OFF_TOPIC_CLOSE_MESSAGE } = await import('./voice-settings')
      const channelPrefix = direction === 'outbound' || direction === 'web' ? `ai.${direction}.` : null
      const [channelStrikesRaw, channelCloseMsgRaw, baseStrikesRaw, baseCloseMsgRaw] = await Promise.all([
        channelPrefix ? getSetting(`${channelPrefix}off_topic_max_strikes`) : Promise.resolve(null),
        channelPrefix ? getSetting(`${channelPrefix}off_topic_close_message`) : Promise.resolve(null),
        getSetting('ai.off_topic_max_strikes'),
        getSetting('ai.off_topic_close_message'),
      ])
      const strikesRaw = channelStrikesRaw ?? baseStrikesRaw
      const closeMsgRaw = channelCloseMsgRaw?.trim() ? channelCloseMsgRaw : baseCloseMsgRaw
      const strikes = Number.isInteger(Number(strikesRaw)) && Number(strikesRaw) >= 1 && Number(strikesRaw) <= 5
        ? Number(strikesRaw)
        : 2
      const closeMsg = closeMsgRaw?.trim() || DEFAULT_OFF_TOPIC_CLOSE_MESSAGE
      parts.push(
        dynMeta?.isNonDentalTenant
          ? `${buildOffTopicPromptRule(strikes, closeMsg, isDentalTemplate)}\nNot: Veri tabloları, linkler, kayıt bilgileri, fiyatlar ve randevu talepleri kapsam içidir.`
          : buildOffTopicPromptRule(strikes, closeMsg, isDentalTemplate),
      )
    } catch {
      if (!joined.includes('KONU DIŞI ISRAR')) {
        parts.push(
          dynMeta?.isNonDentalTenant
            ? 'KONU DIŞI ISRAR: İşletme, veri tabloları veya randevu dışı konuda ilkinde yönlendir; ikincisinde vedalaşıp cagriySonlandir çağır.'
            : 'KONU DIŞI ISRAR: Klinik veya randevu dışı konuda ilkinde yönlendir; ikincisinde vedalaşıp cagriySonlandir çağır.',
        )
      }
    }
  }

  return wrapWithTurkishLanguageLock(parts.join('\n\n'))
}
