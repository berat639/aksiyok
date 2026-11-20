'use client'

import { useEffect, useRef, useState } from 'react'
import InfoTooltip from './ui/InfoTooltip'
import { checkBrowserAudioSupport, runMicrophoneTest, type BrowserAudioSupport } from '../../../lib/browser-audio-support'
import { normalizeTrPhone } from '../../../lib/phone-mask'

export type FlowRuntimeModeOption = 'legacy' | 'observe' | 'active'
export type AssistantChannelKey = 'inbound' | 'outbound' | 'whatsapp' | 'web'
export type WhatsAppToneStyle = 'kurumsal' | 'samimi' | 'kisa_net'
export type WhatsAppOffTopicAction = 'reply_only' | 'pause_ai'
type LiveModelId = 'gemini-3.8-live' | 'gemini-3.8-live-extended-thinking'
type ThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH'
type TurnDetectionMode = 'semantic' | 'standard'
type NoiseFilterMode = 'rnnoise' | 'off'
type SubSectionKey = 'greeting' | 'voice' | 'rules' | 'browser'

export interface InboundAssistantSettings {
  greeting: string
  flowRuntimeMode: FlowRuntimeModeOption
  model: LiveModelId
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

export interface OutboundAssistantSettings {
  callerId: string
  assignedNumbers: string[]
  greeting: string
  flowRuntimeMode: FlowRuntimeModeOption
  useInboundVoice: boolean
  voiceName: string
  model: LiveModelId
  thinkingLevel: ThinkingLevel
  startWaitSeconds: number
  turnDetectionMode: TurnDetectionMode
  noiseFilterMode: NoiseFilterMode
  callSilenceTimeout: number
  callSilenceCloseTimeout: number
  callMaxDuration: number
  offTopicMaxStrikes: number
  offTopicCloseMessage: string
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

export interface WebAssistantSettings {
  greeting: string
  flowRuntimeMode: FlowRuntimeModeOption
  useInboundVoice: boolean
  voiceName: string
  model: LiveModelId
  thinkingLevel: ThinkingLevel
  startWaitSeconds: number
  turnDetectionMode: TurnDetectionMode
  noiseFilterMode: NoiseFilterMode
  callSilenceTimeout: number
  callSilenceCloseTimeout: number
  callMaxDuration: number
  offTopicMaxStrikes: number
  offTopicCloseMessage: string
}

export interface AssistantChannelsPayload {
  inbound: InboundAssistantSettings
  outbound: OutboundAssistantSettings
  whatsapp: WhatsAppAssistantSettings
  web: WebAssistantSettings
}

const DEFAULT_OFF_TOPIC_CLOSE_MESSAGE =
  'Yardımcı olabileceğim başka bir işleminiz yoksa görüşmemizi sonlandırıyorum, iyi günler dilerim.'

const DEFAULT_WHATSAPP_OFF_TOPIC_MESSAGE =
  'Bu hat yalnızca işletmemiz ve randevu/hizmet işlemleriniz için hizmet vermektedir. İşlemleriniz için dilediğiniz zaman yazabilirsiniz, iyi günler dileriz.'

const OFF_TOPIC_MESSAGE_PRESETS: Array<[string, string]> = [
  ['Standart Kurumsal Veda (Önerilen)', DEFAULT_OFF_TOPIC_CLOSE_MESSAGE],
  ['Kısa ve Net Kapanış', 'İşletme veya randevu dışında yardımcı olamadığım için görüşmemizi sonlandırıyorum, iyi günler dilerim.'],
  ['Resmi Kurumsal Kapanış', 'Hattımızı yalnızca işletme ve randevu işlemlerinizde kullanabiliyoruz; görüşmemizi sonlandırıyorum, iyi günler dilerim.'],
]

const WHATSAPP_OFF_TOPIC_PRESETS: Array<[string, string]> = [
  ['Standart Kurumsal Yanıt (Önerilen)', DEFAULT_WHATSAPP_OFF_TOPIC_MESSAGE],
  ['Kısa ve Net Yanıt', 'Yalnızca işletmemiz ve randevu işlemleriniz konusunda yardımcı olabiliyoruz. İyi günler dileriz.'],
  ['Telefon Yönlendirmeli Yanıt', 'Bu WhatsApp hattı yalnızca randevu ve hizmet bilgilendirmesi içindir; diğer konular için işletmemizi arayabilirsiniz.'],
]

const GREETING_MIN_LENGTH = 3
const GREETING_MAX_LENGTH = 280

const DEFAULT_CHANNELS: AssistantChannelsPayload = {
  inbound: {
    greeting: 'Merhaba, hoş geldiniz! Size nasıl yardımcı olabilirim?',
    flowRuntimeMode: 'legacy',
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
  },
  outbound: {
    callerId: '08503096119',
    assignedNumbers: [],
    greeting: 'Merhaba, işletmemizden arıyorum. Randevu teyit ve memnuniyet görüşmemiz için müsait misiniz?',
    flowRuntimeMode: 'active',
    useInboundVoice: true,
    voiceName: 'Aoede',
    model: 'gemini-3.8-live',
    thinkingLevel: 'LOW',
    startWaitSeconds: 0.6,
    turnDetectionMode: 'semantic',
    noiseFilterMode: 'rnnoise',
    callSilenceTimeout: 30,
    callSilenceCloseTimeout: 15,
    callMaxDuration: 600,
    offTopicMaxStrikes: 2,
    offTopicCloseMessage: DEFAULT_OFF_TOPIC_CLOSE_MESSAGE,
  },
  whatsapp: {
    greeting: 'Merhaba, hoş geldiniz. Size nasıl yardımcı olabilirim?',
    flowRuntimeMode: 'legacy',
    toneStyle: 'kurumsal',
    allowEmoji: true,
    allowLocationSharing: true,
    autoHandoverOnUnclear: true,
    offTopicMaxStrikes: 2,
    offTopicAction: 'reply_only',
    offTopicCloseMessage: DEFAULT_WHATSAPP_OFF_TOPIC_MESSAGE,
  },
  web: {
    greeting: 'Merhaba, hoş geldiniz! Size nasıl yardımcı olabilirim?',
    flowRuntimeMode: 'legacy',
    useInboundVoice: true,
    voiceName: 'Aoede',
    model: 'gemini-3.8-live',
    thinkingLevel: 'LOW',
    startWaitSeconds: 0.4,
    turnDetectionMode: 'semantic',
    noiseFilterMode: 'rnnoise',
    callSilenceTimeout: 30,
    callSilenceCloseTimeout: 15,
    callMaxDuration: 600,
    offTopicMaxStrikes: 2,
    offTopicCloseMessage: DEFAULT_OFF_TOPIC_CLOSE_MESSAGE,
  },
}

const VOICES: Array<[string, string]> = [
  ['Zephyr', 'kadın, parlak'], ['Puck', 'erkek, neşeli'], ['Charon', 'erkek, bilgilendirici'], ['Kore', 'kadın, kararlı'],
  ['Fenrir', 'erkek, coşkulu'], ['Leda', 'kadın, genç'], ['Orus', 'erkek, kararlı'], ['Aoede', 'kadın, rahat'],
  ['Callirrhoe', 'kadın, rahat tavırlı'], ['Autonoe', 'kadın, parlak'], ['Enceladus', 'erkek, yumuşak soluklu'], ['Iapetus', 'erkek, net'],
  ['Umbriel', 'erkek, rahat tavırlı'], ['Algieba', 'erkek, akıcı'], ['Despina', 'kadın, akıcı'], ['Erinome', 'kadın, net'],
  ['Algenib', 'erkek, tok'], ['Rasalgethi', 'erkek, bilgilendirici'], ['Laomedeia', 'kadın, neşeli'], ['Achernar', 'kadın, yumuşak'],
  ['Alnilam', 'erkek, kararlı'], ['Schedar', 'erkek, dengeli'], ['Gacrux', 'kadın, olgun'], ['Pulcherrima', 'kadın, atılgan'],
  ['Achird', 'erkek, samimi'], ['Zubenelgenubi', 'erkek, sade'], ['Vindemiatrix', 'kadın, nazik'], ['Sadachbia', 'erkek, canlı'],
  ['Sadaltager', 'erkek, bilgili'], ['Sulafat', 'kadın, sıcak'],
]

const SCENARIO_MODE_OPTIONS: Array<{
  id: FlowRuntimeModeOption
  shortTitle: string
  subtitle: string
  description: string
}> = [
  {
    id: 'legacy',
    shortTitle: 'Serbest Sohbet',
    subtitle: 'Esnek rehber',
    description: 'Çizilen senaryoyu genel rehber alır; müşterinin cümlelerine göre doğal ve esnek sohbet eder.',
  },
  {
    id: 'active',
    shortTitle: 'Adım Adım Sıralı',
    subtitle: 'Tam senaryo takibi',
    description: 'Diyagramdaki soruları ve kuralları sırasıyla uygular; adım atlamaz ve senaryo dışına çıkmaz.',
  },
  {
    id: 'observe',
    shortTitle: 'Gözlem / Test',
    subtitle: 'İşlem yapmadan dene',
    description: 'Senaryo adımlarını takip eder ancak kayıt ekleme, SMS veya çağrı aktarma gibi gerçek işlemleri çalıştırmaz.',
  },
]

const WHATSAPP_TONE_OPTIONS: Array<{
  id: WhatsAppToneStyle
  shortTitle: string
  subtitle: string
  description: string
}> = [
  {
    id: 'kurumsal',
    shortTitle: 'Kurumsal ve Resmi',
    subtitle: 'Güven veren dil',
    description: 'Saygılı, kurumsal ve güven veren bir işletme diliyle yanıt oluşturur.',
  },
  {
    id: 'samimi',
    shortTitle: 'Sıcak ve Samimi',
    subtitle: 'Yakın iletişim',
    description: 'Güler yüzlü, rahatlatıcı ve yakın bir iletişim dili kullanır.',
  },
  {
    id: 'kisa_net',
    shortTitle: 'Kısa ve Net',
    subtitle: 'Öz ve hızlı yanıt',
    description: 'Uzun açıklamalar yerine doğrudan, öz ve hızlı mesajlar gönderir.',
  },
]

const CHANNEL_TABS: Array<{ id: AssistantChannelKey; label: string; shortLabel: string; summary: string }> = [
  {
    id: 'inbound',
    label: '📞 Gelen Arama Asistanı',
    shortLabel: '📞 Gelen Arama',
    summary: 'İşletmeyi telefonla arayan müşterileri karşılayan santral sesli asistanı',
  },
  {
    id: 'outbound',
    label: '📤 Giden Arama Asistanı',
    shortLabel: '📤 Giden Arama',
    summary: 'Randevu teyit, kontrol ve memnuniyet anketi için dış arama yapan sesli asistan',
  },
  {
    id: 'whatsapp',
    label: '💬 WhatsApp Asistanı',
    shortLabel: '💬 WhatsApp',
    summary: 'WhatsApp üzerinden gelen müşteri mesajlarını yanıtlayan yazılı asistan',
  },
  {
    id: 'web',
    label: '🌐 Web Asistanı',
    shortLabel: '🌐 Web Asistanı',
    summary: 'İşletme web sitesi ve tarayıcı üzerinden sesli görüşme yapan asistan',
  },
]

const FIELD_SUBSECTION_MAP: Record<string, SubSectionKey> = {
  greeting: 'greeting',
  flowRuntimeMode: 'greeting',
  model: 'voice',
  thinkingLevel: 'voice',
  voiceName: 'voice',
  useInboundVoice: 'voice',
  startWaitSeconds: 'voice',
  turnDetectionMode: 'voice',
  noiseFilterMode: 'voice',
  toneStyle: 'voice',
  allowEmoji: 'voice',
  allowLocationSharing: 'voice',
  autoHandoverOnUnclear: 'voice',
  callSilenceTimeout: 'rules',
  callSilenceCloseTimeout: 'rules',
  callMaxDuration: 'rules',
  maxActivePhoneCalls: 'rules',
  offTopicMaxStrikes: 'rules',
  offTopicAction: 'rules',
  offTopicCloseMessage: 'rules',
}

const card = {
  background: 'var(--card-bg)',
  border: '1.5px solid var(--input-border)',
  borderRadius: 14,
  boxShadow: 'var(--pc-neo-card)',
} as const

const subCard = {
  background: 'var(--card-bg)',
  border: '1px solid var(--input-border)',
  borderRadius: 10,
  boxShadow: 'var(--pc-neo-subcard)',
} as const

const clayBtn = {
  padding: '5px 10px',
  borderRadius: 8,
  color: 'var(--accent)',
  background: 'var(--card-bg)',
  border: '1px solid var(--input-border)',
  boxShadow: 'var(--pc-clay-btn)',
  fontSize: 11,
  fontWeight: 650,
} as const

const primaryBtn = {
  padding: '5px 11px',
  borderRadius: 8,
  color: '#ffffff',
  background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
  border: '1px solid #1d4ed8',
  boxShadow: 'var(--pc-clay-primary)',
  fontSize: 11,
  fontWeight: 700,
} as const

const paleBadge = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  background: 'var(--pc-tint, #e0f2fe)',
  color: 'var(--pc-tint-fg, #0369a1)',
  border: '1px solid var(--input-border)',
  boxShadow: 'var(--pc-clay-pale)',
} as const

const errorText = {
  display: 'block',
  marginTop: 3,
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--danger)',
} as const

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 9px',
  fontSize: 12,
  color: 'var(--foreground)',
  background: 'var(--input-bg)',
  border: '1px solid var(--input-border)',
  borderRadius: 8,
  boxShadow: 'var(--pc-neo-inset)',
  outline: 'none',
} as const

const labelStyle = { display: 'block', fontSize: 11.5, fontWeight: 650, color: 'var(--foreground-2)' } as const
const hintStyle = { margin: 0, fontSize: 11, color: 'var(--foreground-3)' } as const

function sanitizeGreetingInput(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD\u202A-\u202E]/g, '')
    .slice(0, GREETING_MAX_LENGTH)
}

function mergeChannelsPayload(raw: unknown): AssistantChannelsPayload {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<AssistantChannelKey, Record<string, unknown>>>
  const rawOutbound = (src.outbound && typeof src.outbound === 'object' ? src.outbound : {}) as Partial<OutboundAssistantSettings>
  const normalizedAssigned = Array.isArray(rawOutbound.assignedNumbers)
    ? Array.from(new Set(rawOutbound.assignedNumbers.map(n => normalizeTrPhone(String(n))).filter(Boolean)))
    : DEFAULT_CHANNELS.outbound.assignedNumbers

  return {
    inbound: {
      ...DEFAULT_CHANNELS.inbound,
      ...(src.inbound && typeof src.inbound === 'object' ? (src.inbound as Partial<InboundAssistantSettings>) : {}),
    },
    outbound: {
      ...DEFAULT_CHANNELS.outbound,
      ...rawOutbound,
      callerId: rawOutbound.callerId ? normalizeTrPhone(rawOutbound.callerId) : DEFAULT_CHANNELS.outbound.callerId,
      assignedNumbers: normalizedAssigned,
    },
    whatsapp: {
      ...DEFAULT_CHANNELS.whatsapp,
      ...(src.whatsapp && typeof src.whatsapp === 'object' ? (src.whatsapp as Partial<WhatsAppAssistantSettings>) : {}),
    },
    web: {
      ...DEFAULT_CHANNELS.web,
      ...(src.web && typeof src.web === 'object' ? (src.web as Partial<WebAssistantSettings>) : {}),
    },
  }
}

function normalizeFieldErrors(rawErrors: unknown, fallbackChannel: AssistantChannelKey): Record<string, string> {
  if (!rawErrors || typeof rawErrors !== 'object') return {}
  const out: Record<string, string> = {}
  const channels: AssistantChannelKey[] = ['inbound', 'outbound', 'whatsapp', 'web']
  for (const [key, val] of Object.entries(rawErrors as Record<string, unknown>)) {
    if (typeof val === 'string' && val.trim()) {
      const hasChannelPrefix = channels.some(ch => key.startsWith(`${ch}.`))
      out[hasChannelPrefix ? key : `${fallbackChannel}.${key}`] = val
    } else if (val && typeof val === 'object' && channels.includes(key as AssistantChannelKey)) {
      for (const [subKey, subVal] of Object.entries(val as Record<string, unknown>)) {
        if (typeof subVal === 'string' && subVal.trim()) {
          out[`${key}.${subKey}`] = subVal
        }
      }
    }
  }
  return out
}

function CheckPill({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  const statusColor = ok === null ? 'var(--foreground-3)' : ok ? 'var(--success, #15803d)' : 'var(--danger)'
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 8px',
        borderRadius: 8,
        fontSize: 11,
        background: 'var(--card-bg)',
        border: '1px solid var(--input-border)',
        boxShadow: 'var(--pc-clay-btn)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 15,
          height: 15,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 9.5,
          fontWeight: 800,
          color: '#ffffff',
          background: statusColor,
          flexShrink: 0,
        }}
      >
        {ok === null ? '?' : ok ? '✓' : '✕'}
      </span>
      <strong style={{ color: 'var(--foreground)' }}>{label}:</strong>
      <span style={{ color: statusColor, fontWeight: 600 }}>{detail}</span>
    </div>
  )
}

function BrowserSupportCard({ noiseFilterEnabled }: { noiseFilterEnabled: boolean }) {
  const [support, setSupport] = useState<BrowserAudioSupport | null>(null)
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [suppressedNow, setSuppressedNow] = useState(false)
  const [testMessage, setTestMessage] = useState('')
  const mounted = useRef(true)

  const refresh = () => {
    void checkBrowserAudioSupport().then(result => {
      if (mounted.current) setSupport(result)
    })
  }
  useEffect(() => {
    mounted.current = true
    refresh()
    return () => {
      mounted.current = false
    }
  }, [])

  const testMicrophone = async () => {
    setTesting(true)
    setTestMessage('')
    setSuppressedNow(false)
    try {
      const { peak, suppressedCount } = await runMicrophoneTest(
        (value, meta) => {
          if (mounted.current) {
            setLevel(value)
            setSuppressedNow(Boolean(meta?.suppressed))
          }
        },
        3500,
        { noiseFilter: noiseFilterEnabled },
      )
      if (mounted.current) {
        const filterSummary = noiseFilterEnabled && suppressedCount > 0
          ? ` (${suppressedCount} anlık darbe/öksürük süzüldü)`
          : ''
        setTestMessage(
          peak > 0.05
            ? `Mikrofon çalışıyor, konuşma sesiniz net algılandı${filterSummary}.`
            : suppressedCount > 0
              ? `Yalnızca anlık darbe/öksürük algılandı ve süzgeç tarafından bastırıldı${filterSummary}. Normal konuşarak tekrar deneyin.`
              : 'Mikrofona erişildi ancak ses algılanmadı. Mikrofonunuzun açık olduğundan emin olun.',
        )
      }
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      if (mounted.current) {
        setTestMessage(
          denied
            ? 'Mikrofon izni verilmedi. Tarayıcının adres çubuğundan izin verip tekrar deneyin.'
            : 'Mikrofon açılamadı. Cihazınızın bağlı olduğunu kontrol edin.',
        )
      }
    } finally {
      if (mounted.current) {
        setTesting(false)
        setLevel(0)
        setSuppressedNow(false)
        refresh()
      }
    }
  }

  const permissionLabel = !support
    ? ''
    : support.microphonePermission === 'granted'
    ? 'Verildi'
    : support.microphonePermission === 'denied'
    ? 'Engellendi'
    : support.microphonePermission === 'prompt'
    ? 'Sorulacak'
    : 'Belirsiz'

  return (
    <div style={{ ...subCard, padding: '10px 12px', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <strong style={{ fontSize: 11.5, color: 'var(--foreground)' }}>Tarayıcı Uygunluğu ve Mikrofon Sınaması</strong>
          <InfoTooltip title="Bu kart ne işe yarar?">
            Web asistanı üzerinden sesli görüşme için tarayıcınızın güvenli bağlantı, mikrofon ve ses işleme özelliklerini denetler. Mikrofonu denerken gürültü ve öksürük süzgecinin etkisini canlı görebilirsiniz.
          </InfoTooltip>
        </div>
        <span style={paleBadge}>
          {noiseFilterEnabled ? 'Süzgeç: Açık' : 'Süzgeç: Kapalı'}
        </span>
      </div>
      {support ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <CheckPill ok label="Tarayıcı" detail={support.browserName} />
          <CheckPill ok={support.secureContext} label="Bağlantı" detail={support.secureContext ? 'Güvenli' : 'Güvensiz'} />
          <CheckPill ok={support.microphoneApi} label="Mikrofon" detail={support.microphoneApi ? 'Destekleniyor' : 'Yok'} />
          <CheckPill ok={support.audioProcessing} label="Ses İşleme" detail={support.audioProcessing ? 'Uygun' : 'Güncelleyin'} />
          <CheckPill
            ok={support.microphonePermission === 'granted' ? true : support.microphonePermission === 'denied' ? false : null}
            label="İzin"
            detail={permissionLabel}
          />
        </div>
      ) : (
        <p style={hintStyle}>Denetleniyor…</p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => void testMicrophone()}
          disabled={testing}
          style={{ ...primaryBtn, cursor: testing ? 'wait' : 'pointer' }}
        >
          <span style={{ color: '#ffffff' }}>{testing ? 'Dinleniyor… (3,5 sn)' : 'Mikrofonu dene'}</span>
        </button>
        <div
          role="meter"
          aria-label="Ses seviyesi"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
          style={{
            flex: 1,
            minWidth: 110,
            height: 8,
            borderRadius: 6,
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            boxShadow: 'var(--pc-neo-inset)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.round(level * 100)}%`,
              height: '100%',
              background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
              transition: 'width 80ms linear',
            }}
          />
        </div>
        {testing && suppressedNow && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--accent)' }}>Darbe/öksürük süzüldü</span>}
      </div>
      {testMessage && <p style={{ ...hintStyle, color: 'var(--foreground-2)' }}>{testMessage}</p>}
    </div>
  )
}

function CompactChoiceGrid<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string
  value: T
  options: Array<{ id: T; shortTitle: string; subtitle: string }>
  onChange: (next: T) => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`, gap: 6 }}>
      {options.map(opt => {
        const checked = value === opt.id
        return (
          <label
            key={opt.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 8px',
              border: `1.5px solid ${checked ? '#2563eb' : 'var(--input-border)'}`,
              borderRadius: 8,
              background: checked ? 'var(--pc-tint, #e0f2fe)' : 'var(--card-bg)',
              boxShadow: checked ? 'var(--pc-clay-pale)' : 'var(--pc-clay-btn)',
              cursor: 'pointer',
              minWidth: 0,
            }}
          >
            <input
              type="radio"
              name={name}
              checked={checked}
              onChange={() => onChange(opt.id)}
              style={{ margin: 0, flexShrink: 0, accentColor: '#2563eb' }}
            />
            <div style={{ minWidth: 0, lineHeight: 1.25 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {opt.shortTitle}
              </div>
              <div style={{ fontSize: 10, color: 'var(--foreground-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {opt.subtitle}
              </div>
            </div>
          </label>
        )
      })}
    </div>
  )
}

function CompactTogglePill({
  checked,
  onChange,
  title,
  tooltip,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  title: string
  tooltip?: string
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        padding: '6px 9px',
        border: `1.5px solid ${checked ? '#2563eb' : 'var(--input-border)'}`,
        borderRadius: 8,
        background: checked ? 'var(--pc-tint, #e0f2fe)' : 'var(--card-bg)',
        boxShadow: checked ? 'var(--pc-clay-pale)' : 'var(--pc-clay-btn)',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          style={{ margin: 0, flexShrink: 0, accentColor: '#2563eb' }}
        />
        <strong style={{ color: 'var(--foreground)', fontSize: 11.5 }}>{title}</strong>
      </span>
      {tooltip && (
        <InfoTooltip title={title}>
          {tooltip}
        </InfoTooltip>
      )}
    </label>
  )
}

function ScenarioModeSubcard({
  channel,
  value,
  onChange,
  badgeText,
  error,
}: {
  channel: AssistantChannelKey
  value: FlowRuntimeModeOption
  onChange: (next: FlowRuntimeModeOption) => void
  badgeText?: string
  error?: string
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <strong style={{ fontSize: 11.5, color: 'var(--foreground)' }}>Konuşma Senaryosu Uygulama Biçimi</strong>
          <InfoTooltip title="Senaryo uygulama biçimi nedir?">
            {SCENARIO_MODE_OPTIONS.map(o => `${o.shortTitle}: ${o.description}`).join(' • ')}
          </InfoTooltip>
        </div>
        {badgeText && <span style={paleBadge}>{badgeText}</span>}
      </div>

      <CompactChoiceGrid
        name={`scenario-mode-${channel}`}
        value={value}
        options={SCENARIO_MODE_OPTIONS}
        onChange={onChange}
      />
      {error && <span role="alert" style={errorText}>{error}</span>}
    </div>
  )
}

function GreetingFieldBlock({
  id,
  label,
  tooltip,
  value,
  placeholder,
  onChange,
  error,
}: {
  id: string
  label: string
  tooltip: string
  value: string
  placeholder: string
  onChange: (next: string) => void
  error?: string
}) {
  const len = value.trim().length
  const outOfRange = len > 0 && len < GREETING_MIN_LENGTH
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 5 }}>
        <label htmlFor={id} style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <strong style={{ color: 'var(--foreground)' }}>{label}</strong>
          <InfoTooltip title={label}>{tooltip}</InfoTooltip>
        </label>
        <span
          style={{
            ...paleBadge,
            color: outOfRange || value.length >= GREETING_MAX_LENGTH ? 'var(--danger)' : 'var(--pc-tint-fg, #0369a1)',
          }}
        >
          {value.length}/{GREETING_MAX_LENGTH}
        </span>
      </div>
      <textarea
        id={id}
        rows={2}
        maxLength={GREETING_MAX_LENGTH}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(sanitizeGreetingInput(e.target.value))}
        style={{
          ...inputStyle,
          resize: 'vertical',
          borderColor: error ? 'var(--danger)' : 'var(--input-border)',
        }}
      />
      {error && <span role="alert" style={errorText}>{error}</span>}
    </div>
  )
}

function ModelAndVoiceFields({
  channel,
  model,
  thinkingLevel,
  voiceName,
  onChange,
  errors,
}: {
  channel: AssistantChannelKey
  model: LiveModelId
  thinkingLevel: ThinkingLevel
  voiceName: string
  onChange: (patch: { model?: LiveModelId; thinkingLevel?: ThinkingLevel; voiceName?: string }) => void
  errors: Record<string, string>
}) {
  const err = (field: string) => errors[`${channel}.${field}`]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 8 }}>
      <label style={labelStyle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
          Asistan Sesi
          <InfoTooltip title="Türkçe konuşma davranışı">
            Kısa cümle, tek soru, doğal konuşma hızı ve seçili sesi koruma davranışı tüm sesli oturumlara otomatik uygulanır.
          </InfoTooltip>
        </span>
        <select
          value={voiceName}
          onChange={e => onChange({ voiceName: e.target.value })}
          style={inputStyle}
        >
          {VOICES.map(([voice, desc]) => (
            <option key={voice} value={voice}>
              {voice} — {desc}
              {voice === 'Aoede' ? ' (varsayılan)' : ''}
            </option>
          ))}
        </select>
        {err('voiceName') && <span role="alert" style={errorText}>{err('voiceName')}</span>}
      </label>

      <label style={labelStyle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
          Yanıt ve Düşünme Hızı
          <InfoTooltip title="Derin düşünen mod nasıl çalışır?">
            Hızlı mod günlük müşteri görüşmelerinde en seri yanıtı üretir. Derin düşünen mod karmaşık talepleri arka planda değerlendirir; işlem sürerken doğal kısa ara cümleler kurarak çağrının sessiz kalmasını önler.
          </InfoTooltip>
        </span>
        <select
          value={model}
          onChange={e => onChange({ model: e.target.value as LiveModelId })}
          style={inputStyle}
        >
          <option value="gemini-3.8-live">Hızlı ve Akıcı Mod (Önerilen)</option>
          <option value="gemini-3.8-live-extended-thinking">Derin Düşünen Mod</option>
        </select>
        {err('model') && <span role="alert" style={errorText}>{err('model')}</span>}
      </label>

      {model === 'gemini-3.8-live-extended-thinking' && (
        <label style={labelStyle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            Düşünme Seviyesi
          </span>
          <select
            value={thinkingLevel}
            onChange={e => onChange({ thinkingLevel: e.target.value as ThinkingLevel })}
            style={inputStyle}
          >
            <option value="LOW">Düşük — önerilen; daha seri</option>
            <option value="MEDIUM">Orta — dengeli</option>
            <option value="HIGH">Yüksek — en ayrıntılı</option>
          </select>
          {err('thinkingLevel') && <span role="alert" style={errorText}>{err('thinkingLevel')}</span>}
        </label>
      )}
    </div>
  )
}

function TurnAndNoiseFields({
  channel,
  turnDetectionMode,
  noiseFilterMode,
  startWaitSeconds,
  waitLabel,
  recommendedWaitHint,
  onChange,
  errors,
}: {
  channel: AssistantChannelKey
  turnDetectionMode: TurnDetectionMode
  noiseFilterMode: NoiseFilterMode
  startWaitSeconds: number
  waitLabel: string
  recommendedWaitHint: string
  onChange: (patch: {
    turnDetectionMode?: TurnDetectionMode
    noiseFilterMode?: NoiseFilterMode
    startWaitSeconds?: number
  }) => void
  errors: Record<string, string>
}) {
  const err = (field: string) => errors[`${channel}.${field}`]
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 8 }}>
        <label style={labelStyle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            Türkçe Konuşma Sırası
            <InfoTooltip title="Akıllı konuşma sırası nasıl çalışır?">
              Akıllı modda asistan, müşterinin cümlesinin anlam olarak bitip bitmediğini değerlendirir. Bağlaçlardan (&quot;ve&quot;, &quot;ama&quot;, &quot;yani&quot;, &quot;şey&quot;) veya yarım kalan telefon numaralarından sonraki düşünme duraksamalarında araya girmez.
            </InfoTooltip>
          </span>
          <select
            value={turnDetectionMode}
            onChange={e => onChange({ turnDetectionMode: e.target.value as TurnDetectionMode })}
            style={inputStyle}
          >
            <option value="semantic">Akıllı Algılama — Söz Kesmeme (Önerilen)</option>
            <option value="standard">Standart Süre Algılama</option>
          </select>
          {err('turnDetectionMode') && <span role="alert" style={errorText}>{err('turnDetectionMode')}</span>}
        </label>

        <label style={labelStyle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            Gürültü ve Öksürük Süzgeci
            <InfoTooltip title="Gürültü ve öksürük süzgeci ne yapar?">
              Mikrofondan gelen öksürük, hapşırık, boğaz temizleme, masa tıklaması ve arka plan uğultusunu ses yapay zekaya ulaşmadan önce süzer. Böylece asistan öksürük sesini konuşma sanıp sözü kesmez.
            </InfoTooltip>
          </span>
          <select
            value={noiseFilterMode}
            onChange={e => onChange({ noiseFilterMode: e.target.value as NoiseFilterMode })}
            style={inputStyle}
          >
            <option value="rnnoise">Açık — Öksürük ve Gürültü Süzgeci (Önerilen)</option>
            <option value="off">Kapalı — Ham Mikrofon Sesi</option>
          </select>
          {err('noiseFilterMode') && <span role="alert" style={errorText}>{err('noiseFilterMode')}</span>}
        </label>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 3 }}>
          <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {waitLabel}
            <InfoTooltip title="Bekleme süresi">
              {recommendedWaitHint}. Çok düşük değer karşı tarafın ilk hecesini kesebilir. 0 ile 2 saniye arasında seçebilirsiniz.
            </InfoTooltip>
          </span>
          <span style={paleBadge}>{startWaitSeconds.toLocaleString('tr-TR')} sn</span>
        </div>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={startWaitSeconds}
          onChange={e => onChange({ startWaitSeconds: Number(e.target.value) })}
          style={{ width: '100%', margin: 0 }}
        />
        {err('startWaitSeconds') && <span role="alert" style={errorText}>{err('startWaitSeconds')}</span>}
      </div>
    </div>
  )
}

function OffTopicSection({
  channel,
  title,
  strikeLabel,
  closeLabel,
  offTopicMaxStrikes,
  offTopicCloseMessage,
  onChange,
  errors,
}: {
  channel: AssistantChannelKey
  title: string
  strikeLabel: string
  closeLabel: string
  offTopicMaxStrikes: number
  offTopicCloseMessage: string
  onChange: (patch: { offTopicMaxStrikes?: number; offTopicCloseMessage?: string }) => void
  errors: Record<string, string>
}) {
  const err = (field: string) => errors[`${channel}.${field}`]
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <strong style={{ fontSize: 11.5, color: 'var(--foreground)' }}>{title}</strong>
          <InfoTooltip title="Konu dışı otomatik kapatma nasıl çalışır?">
            Arayan kişi işletme veya randevu dışında sohbet açıp konuyu dağıttığında asistan önce nazikçe işletme işlemine yönlendirir. Seçtiğiniz sınırda ısrar sürerse aşağıdaki veda cümlesini iletip görüşmeyi otomatik sonlandırır.
          </InfoTooltip>
        </div>
        <span style={paleBadge}>
          {offTopicMaxStrikes === 1 ? '1. konu dışında anında kapatır' : `${offTopicMaxStrikes}. konu dışında kapatır`}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        <label style={labelStyle}>
          <span style={{ display: 'block', marginBottom: 4 }}>{strikeLabel}</span>
          <select
            value={offTopicMaxStrikes}
            onChange={e => onChange({ offTopicMaxStrikes: Number(e.target.value) })}
            style={inputStyle}
          >
            <option value={1}>1. kez — Uyarmadan kapat</option>
            <option value={2}>2. kez — 1 uyar, 2. kez kapat (Önerilen)</option>
            <option value={3}>3. kez — 2 uyar, 3. kez kapat</option>
            <option value={4}>4. kez — 3 uyar, 4. kez kapat</option>
            <option value={5}>5. kez — 4 uyar, 5. kez kapat</option>
          </select>
          {err('offTopicMaxStrikes') && <span role="alert" style={errorText}>{err('offTopicMaxStrikes')}</span>}
        </label>

        <label style={labelStyle}>
          <span style={{ display: 'block', marginBottom: 4 }}>{closeLabel}</span>
          <input
            type="text"
            maxLength={240}
            value={offTopicCloseMessage}
            onChange={e => onChange({ offTopicCloseMessage: e.target.value })}
            placeholder={DEFAULT_OFF_TOPIC_CLOSE_MESSAGE}
            style={inputStyle}
          />
          {err('offTopicCloseMessage') && <span role="alert" style={errorText}>{err('offTopicCloseMessage')}</span>}
        </label>
      </div>

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {OFF_TOPIC_MESSAGE_PRESETS.map(([presetLabel, presetText]) => {
          const active = offTopicCloseMessage === presetText
          return (
            <button
              key={presetLabel}
              type="button"
              onClick={() => onChange({ offTopicCloseMessage: presetText })}
              style={
                active
                  ? { ...primaryBtn, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }
                  : { ...clayBtn, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }
              }
            >
              <span style={{ color: active ? '#ffffff' : 'var(--accent)' }}>{presetLabel}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WhatsAppOffTopicSection({
  offTopicMaxStrikes,
  offTopicAction,
  offTopicCloseMessage,
  onChange,
  errors,
}: {
  offTopicMaxStrikes: number
  offTopicAction: WhatsAppOffTopicAction
  offTopicCloseMessage: string
  onChange: (patch: Partial<Pick<WhatsAppAssistantSettings, 'offTopicMaxStrikes' | 'offTopicAction' | 'offTopicCloseMessage'>>) => void
  errors: Record<string, string>
}) {
  const err = (field: string) => errors[`whatsapp.${field}`]
  const badgeText =
    offTopicAction === 'pause_ai'
      ? `${offTopicMaxStrikes}. mesajda yanıtlar ve duraklatır`
      : `${offTopicMaxStrikes}. mesajda sınır yanıtı gönderir`

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <strong style={{ fontSize: 11.5, color: 'var(--foreground)' }}>
            Konu Dışı Mesaj ve Gereksiz Sohbet Koruması
          </strong>
          <InfoTooltip title="Yazılı sohbette konu dışı koruma nasıl çalışır?">
            WhatsApp yazılı bir kanal olduğu için telefon kapatma yoktur. Kullanıcı hizmet veya randevu dışında alakasız mesajlar yazdığında asistan önce işletmeye yönlendirir; seçtiğiniz sınır aşılırsa gereksiz sohbeti kesip belirlediğiniz davranışı uygular.
          </InfoTooltip>
        </div>
        <span style={paleBadge}>{badgeText}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        <label style={labelStyle}>
          <span style={{ display: 'block', marginBottom: 4 }}>Kaçıncı konu dışı mesajda devreye girsin?</span>
          <select
            value={offTopicMaxStrikes}
            onChange={e => onChange({ offTopicMaxStrikes: Number(e.target.value) })}
            style={inputStyle}
          >
            <option value={1}>1. mesajda — Doğrudan sınır mesajı</option>
            <option value={2}>2. mesajda — 1 yönlendir, 2. kez sınır mesajı (Önerilen)</option>
            <option value={3}>3. mesajda — 2 yönlendir, 3. kez sınır mesajı</option>
            <option value={4}>4. mesajda — 3 yönlendir, 4. kez sınır mesajı</option>
            <option value={5}>5. mesajda — 4 yönlendir, 5. kez sınır mesajı</option>
          </select>
          {err('offTopicMaxStrikes') && <span role="alert" style={errorText}>{err('offTopicMaxStrikes')}</span>}
        </label>

        <label style={labelStyle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            Sınır aşıldığında ne yapsın?
            <InfoTooltip title="Sınır sonrası davranış">
              Sohbet Açık Kalır: Sınır mesajını gönderir, kişi sonradan randevu sorarsa yanıtlamaya devam eder. Otomatik Yanıtlamayı Duraklat: Sınır mesajından sonra bu numarada botu duraklatır.
            </InfoTooltip>
          </span>
          <select
            value={offTopicAction}
            onChange={e => onChange({ offTopicAction: e.target.value as WhatsAppOffTopicAction })}
            style={inputStyle}
          >
            <option value="reply_only">Yalnızca Sınır Yanıtı Gönder (Sohbet Açık Kalır)</option>
            <option value="pause_ai">Sınır Yanıtı Gönder ve Botu Duraklat (Kota Koruması)</option>
          </select>
          {err('offTopicAction') && <span role="alert" style={errorText}>{err('offTopicAction')}</span>}
        </label>
      </div>

      <div>
        <label style={labelStyle}>
          <span style={{ display: 'block', marginBottom: 4 }}>Gönderilecek yazılı sınır mesajı</span>
          <input
            type="text"
            maxLength={240}
            value={offTopicCloseMessage}
            onChange={e => onChange({ offTopicCloseMessage: e.target.value })}
            placeholder={DEFAULT_WHATSAPP_OFF_TOPIC_MESSAGE}
            style={inputStyle}
          />
          {err('offTopicCloseMessage') && <span role="alert" style={errorText}>{err('offTopicCloseMessage')}</span>}
        </label>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
          {WHATSAPP_OFF_TOPIC_PRESETS.map(([presetLabel, presetText]) => {
            const active = offTopicCloseMessage === presetText
            return (
              <button
                key={presetLabel}
                type="button"
                onClick={() => onChange({ offTopicCloseMessage: presetText })}
                style={
                  active
                    ? { ...primaryBtn, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }
                    : { ...clayBtn, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }
                }
              >
                <span style={{ color: active ? '#ffffff' : 'var(--accent)' }}>{presetLabel}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function DurationAndSilenceGrid({
  channel,
  callSilenceTimeout,
  callSilenceCloseTimeout,
  callMaxDuration,
  maxActivePhoneCalls,
  silenceLabel = 'Sessizlik uyarısı',
  closeLabel = 'Uyarı sonrası kapanış',
  maxDurationLabel = 'Maksimum görüşme süresi',
  onChange,
  errors,
}: {
  channel: AssistantChannelKey
  callSilenceTimeout: number
  callSilenceCloseTimeout: number
  callMaxDuration: number
  maxActivePhoneCalls?: number
  silenceLabel?: string
  closeLabel?: string
  maxDurationLabel?: string
  onChange: (patch: {
    callSilenceTimeout?: number
    callSilenceCloseTimeout?: number
    callMaxDuration?: number
    maxActivePhoneCalls?: number
  }) => void
  errors: Record<string, string>
}) {
  const err = (field: string) => errors[`${channel}.${field}`]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: 8 }}>
      {typeof maxActivePhoneCalls === 'number' && (
        <label style={labelStyle}>
          <span style={{ display: 'block', marginBottom: 4 }}>Aktif telefon kapasitesi</span>
          <select
            value={maxActivePhoneCalls}
            onChange={e => onChange({ maxActivePhoneCalls: Number(e.target.value) })}
            style={inputStyle}
          >
            {[2, 3, 4, 5].map(count => (
              <option key={count} value={count}>
                {count} aktif çağrı
              </option>
            ))}
          </select>
          {err('maxActivePhoneCalls') && <span role="alert" style={errorText}>{err('maxActivePhoneCalls')}</span>}
        </label>
      )}

      <label style={labelStyle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          {silenceLabel}
          <InfoTooltip title={silenceLabel}>5 – 120 saniye arası (varsayılan: 30 sn)</InfoTooltip>
        </span>
        <div style={{ position: 'relative' }}>
          <input
            type="number"
            min="5"
            max="120"
            value={callSilenceTimeout}
            onChange={e => onChange({ callSilenceTimeout: Number(e.target.value) })}
            style={{ ...inputStyle, paddingRight: 32 }}
          />
          <span
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 10.5,
              fontWeight: 700,
              color: 'var(--foreground-3)',
              pointerEvents: 'none',
            }}
          >
            sn
          </span>
        </div>
        {err('callSilenceTimeout') && <span role="alert" style={errorText}>{err('callSilenceTimeout')}</span>}
      </label>

      <label style={labelStyle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          {closeLabel}
          <InfoTooltip title={closeLabel}>5 – 120 saniye arası (varsayılan: 15 sn)</InfoTooltip>
        </span>
        <div style={{ position: 'relative' }}>
          <input
            type="number"
            min="5"
            max="120"
            value={callSilenceCloseTimeout}
            onChange={e => onChange({ callSilenceCloseTimeout: Number(e.target.value) })}
            style={{ ...inputStyle, paddingRight: 32 }}
          />
          <span
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 10.5,
              fontWeight: 700,
              color: 'var(--foreground-3)',
              pointerEvents: 'none',
            }}
          >
            sn
          </span>
        </div>
        {err('callSilenceCloseTimeout') && <span role="alert" style={errorText}>{err('callSilenceCloseTimeout')}</span>}
      </label>

      <label style={labelStyle}>
        <span style={{ display: 'block', marginBottom: 4 }}>{maxDurationLabel}</span>
        <select
          value={callMaxDuration}
          onChange={e => onChange({ callMaxDuration: Number(e.target.value) })}
          style={inputStyle}
        >
          {Array.from({ length: 13 }, (_, i) => i + 3).map(minutes => (
            <option key={minutes} value={minutes * 60}>
              {minutes} dakika
            </option>
          ))}
        </select>
        {err('callMaxDuration') && <span role="alert" style={errorText}>{err('callMaxDuration')}</span>}
      </label>
    </div>
  )
}

export interface VoiceAiSettingsProps {
  onToast: (message: string, type?: 'success' | 'error') => void
  activeDirection?: AssistantChannelKey
  onDirectionChange?: (dir: AssistantChannelKey) => void
}

export default function VoiceAiSettings({
  onToast,
  activeDirection,
  onDirectionChange,
}: VoiceAiSettingsProps) {
  const [tab, setTab] = useState<AssistantChannelKey>(activeDirection ?? 'inbound')
  const [subTab, setSubTab] = useState<SubSectionKey>('greeting')
  const [collapsed, setCollapsed] = useState(false)
  const [settings, setSettings] = useState<AssistantChannelsPayload>(DEFAULT_CHANNELS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (activeDirection) {
      setTab(activeDirection)
      if (activeDirection !== 'web' && subTab === 'browser') {
        setSubTab('greeting')
      }
    }
  }, [activeDirection, subTab])

  useEffect(() => {
    fetch('/api/admin/settings/assistants')
      .then(async response => {
        if (!response.ok) throw new Error('Ayarlar alınamadı')
        const data = await response.json()
        const payload = data?.settings && typeof data.settings === 'object' ? data.settings : data
        const merged = mergeChannelsPayload(payload)
        setSettings(merged)
      })
      .catch(() => onToast('Kanal asistanları ayarları yüklenemedi', 'error'))
      .finally(() => setLoading(false))
  }, [onToast])

  const selectTab = (next: AssistantChannelKey) => {
    setTab(next)
    if (next !== 'web' && subTab === 'browser') {
      setSubTab('greeting')
    }
    onDirectionChange?.(next)
  }

  const patchChannel = <K extends AssistantChannelKey>(
    channel: K,
    values: Partial<AssistantChannelsPayload[K]>,
  ) => {
    setFieldErrors(prev => {
      if (Object.keys(prev).length === 0) return prev
      const next = { ...prev }
      for (const fieldKey of Object.keys(values)) {
        delete next[`${channel}.${fieldKey}`]
      }
      return next
    })
    setSettings(current => ({
      ...current,
      [channel]: {
        ...current[channel],
        ...values,
      },
    }))
  }

  const validateBeforeSave = (target: AssistantChannelsPayload): Record<string, string> => {
    const errs: Record<string, string> = {}
    const channels: AssistantChannelKey[] = ['inbound', 'outbound', 'whatsapp', 'web']
    for (const ch of channels) {
      const greetingLen = target[ch].greeting.trim().length
      if (greetingLen < GREETING_MIN_LENGTH) {
        errs[`${ch}.greeting`] = `Karşılama metni en az ${GREETING_MIN_LENGTH} karakter olmalıdır.`
      } else if (greetingLen > GREETING_MAX_LENGTH) {
        errs[`${ch}.greeting`] = `Karşılama metni en fazla ${GREETING_MAX_LENGTH} karakter olabilir.`
      }
    }
    return errs
  }

  const focusFirstError = (errorsMap: Record<string, string>) => {
    const firstKey = Object.keys(errorsMap)[0]
    if (!firstKey) return
    const [errChannel, errField] = firstKey.split('.') as [AssistantChannelKey | undefined, string | undefined]
    if (errChannel && errChannel !== tab) {
      selectTab(errChannel)
    }
    if (errField && FIELD_SUBSECTION_MAP[errField]) {
      setSubTab(FIELD_SUBSECTION_MAP[errField])
    }
    setCollapsed(false)
  }

  const persistSettings = async (
    target: AssistantChannelsPayload,
    toastMessage = 'Kanal asistanları ayarları kaydedildi',
  ) => {
    const clientErrors = validateBeforeSave(target)
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors)
      focusFirstError(clientErrors)
      const firstErrKey = Object.keys(clientErrors)[0]
      onToast(clientErrors[firstErrKey] || 'Lütfen hatalı alanları kontrol edin', 'error')
      return
    }

    setSaving(true)
    setFieldErrors({})
    try {
      const normalizedTarget: AssistantChannelsPayload = {
        ...target,
        inbound: { ...target.inbound, greeting: target.inbound.greeting.trim() },
        outbound: {
          ...target.outbound,
          callerId: normalizeTrPhone(target.outbound.callerId),
          greeting: target.outbound.greeting.trim(),
        },
        whatsapp: { ...target.whatsapp, greeting: target.whatsapp.greeting.trim() },
        web: { ...target.web, greeting: target.web.greeting.trim() },
      }
      const {
        callerId: _omitCallerId,
        assignedNumbers: _omitAssigned,
        ...outboundWithoutLine
      } = normalizedTarget.outbound
      const response = await fetch('/api/admin/settings/assistants', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: tab,
          inbound: normalizedTarget.inbound,
          outbound: outboundWithoutLine,
          whatsapp: normalizedTarget.whatsapp,
          web: normalizedTarget.web,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (result?.fieldErrors && typeof result.fieldErrors === 'object') {
          const normalized = normalizeFieldErrors(result.fieldErrors, tab)
          setFieldErrors(normalized)
          focusFirstError(normalized)
        }
        throw new Error(result?.error || 'Kayıt başarısız')
      }
      const savedSettings = mergeChannelsPayload(result?.settings ?? normalizedTarget)
      setSettings(savedSettings)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clinic:assistant-settings-updated', { detail: savedSettings }))
      }
      onToast(toastMessage)
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Kayıt başarısız', 'error')
    } finally {
      setSaving(false)
    }
  }

  const save = () => void persistSettings(settings)

  const resetActiveChannelToDefaults = () => {
    const nextChannelValue =
      tab === 'outbound'
        ? {
            ...DEFAULT_CHANNELS.outbound,
            callerId: settings.outbound.callerId || DEFAULT_CHANNELS.outbound.callerId,
            assignedNumbers: settings.outbound.assignedNumbers,
          }
        : DEFAULT_CHANNELS[tab]
    const nextSettings: AssistantChannelsPayload = {
      ...settings,
      [tab]: nextChannelValue,
    }
    setSettings(nextSettings)
    const activeTabMeta = CHANNEL_TABS.find(t => t.id === tab)
    void persistSettings(
      nextSettings,
      `${activeTabMeta?.label.replace(/^[^\s]+\s/, '') || 'Asistan'} varsayılan ayarlara sıfırlandı`,
    )
  }

  const tabHasError = (id: AssistantChannelKey) =>
    Object.keys(fieldErrors).some(key => key.startsWith(`${id}.`))

  const subTabHasError = (channel: AssistantChannelKey, section: SubSectionKey) =>
    Object.keys(fieldErrors).some(key => {
      if (!key.startsWith(`${channel}.`)) return false
      const field = key.slice(channel.length + 1)
      return FIELD_SUBSECTION_MAP[field] === section
    })

  if (loading) {
    return (
      <div style={{ ...card, padding: '12px 14px', color: 'var(--foreground-3)', fontSize: 12 }}>
        Kanal asistanları ayarları yükleniyor…
      </div>
    )
  }

  const activeChannelMeta = CHANNEL_TABS.find(t => t.id === tab) ?? CHANNEL_TABS[0]
  const inboundModelSummary =
    settings.inbound.model === 'gemini-3.8-live-extended-thinking' ? 'Derin Düşünen Mod' : 'Hızlı ve Akıcı Mod'

  const subTabs: Array<{ id: SubSectionKey; label: string }> =
    tab === 'whatsapp'
      ? [
          { id: 'greeting', label: '🗣️ Karşılama & Senaryo' },
          { id: 'voice', label: '✍️ Üslup & Otomasyon' },
          { id: 'rules', label: '🛡️ Konu Dışı Koruması' },
        ]
      : tab === 'web'
      ? [
          { id: 'greeting', label: '🗣️ Karşılama & Senaryo' },
          { id: 'voice', label: '🎙️ Ses & Algılama' },
          { id: 'rules', label: '⏱️ Süre & Kapanış' },
          { id: 'browser', label: '🎧 Mikrofon Testi' },
        ]
      : [
          { id: 'greeting', label: '🗣️ Karşılama & Senaryo' },
          { id: 'voice', label: '🎙️ Ses & Algılama' },
          { id: 'rules', label: '⏱️ Süre & Kapanış' },
        ]

  const effectiveSubTab = subTabs.some(s => s.id === subTab) ? subTab : 'greeting'

  return (
    <div style={{ ...card, padding: '12px 14px' }}>
      {/* Kompakt Başlık ve Daraltma */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          borderBottom: collapsed ? 'none' : '1px solid var(--input-border)',
          paddingBottom: collapsed ? 0 : 8,
          marginBottom: collapsed ? 0 : 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <strong style={{ fontSize: 13, fontWeight: 750, color: 'var(--foreground)' }}>
            Gelişmiş Sesli Yapay Zeka ve Kanal Asistanları Ayarları
          </strong>
          <InfoTooltip title="Kanal asistanları yönetimi">
            Gelen arama, giden arama, WhatsApp ve web asistanlarının karşılama metinlerini, senaryo uygulama biçimini ve görüşme kurallarını ayrı ayrı yönetin. {activeChannelMeta.summary}.
          </InfoTooltip>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={paleBadge}>{activeChannelMeta.shortLabel}</span>
          <button
            type="button"
            onClick={() => setCollapsed(prev => !prev)}
            aria-expanded={!collapsed}
            style={{ ...clayBtn, padding: '3px 8px', fontSize: 10.5, cursor: 'pointer' }}
          >
            {collapsed ? 'Genişlet ▾' : 'Daralt ▴'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* 4 Üst Asistan Sekmesi */}
          <div
            role="tablist"
            aria-label="Asistan kanalları"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 4,
              marginBottom: 8,
              padding: 4,
              borderRadius: 9,
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              boxShadow: 'var(--pc-neo-inset)',
            }}
          >
            {CHANNEL_TABS.map(({ id, shortLabel, summary }) => {
              const active = tab === id
              const hasErr = tabHasError(id)
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  title={summary}
                  aria-selected={active}
                  onClick={() => selectTab(id)}
                  style={
                    active
                      ? { ...primaryBtn, cursor: 'pointer', padding: '5px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
                      : {
                          ...clayBtn,
                          cursor: 'pointer',
                          padding: '5px 6px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          borderColor: hasErr ? 'var(--danger)' : 'var(--input-border)',
                        }
                  }
                >
                  <span style={{ color: active ? '#ffffff' : hasErr ? 'var(--danger)' : 'var(--accent)' }}>
                    {shortLabel}
                    {hasErr ? ' •' : ''}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Alt Bölüm Sekmeleri */}
          <div
            role="tablist"
            aria-label="Kanal ayar bölümleri"
            style={{
              display: 'flex',
              gap: 4,
              flexWrap: 'wrap',
              marginBottom: 10,
            }}
          >
            {subTabs.map(({ id, label }) => {
              const active = effectiveSubTab === id
              const hasErr = subTabHasError(tab, id)
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSubTab(id)}
                  style={
                    active
                      ? { ...primaryBtn, cursor: 'pointer', flex: '1 1 auto', padding: '4px 8px', fontSize: 10.5 }
                      : {
                          ...clayBtn,
                          cursor: 'pointer',
                          flex: '1 1 auto',
                          padding: '4px 8px',
                          fontSize: 10.5,
                          borderColor: hasErr ? 'var(--danger)' : 'var(--input-border)',
                        }
                  }
                >
                  <span style={{ color: active ? '#ffffff' : hasErr ? 'var(--danger)' : 'var(--accent)' }}>
                    {label}
                    {hasErr ? ' •' : ''}
                  </span>
                </button>
              )
            })}
          </div>

          {/* GELEN ARAMA */}
          {tab === 'inbound' && (
            <div style={{ ...subCard, padding: '10px 12px' }}>
              {effectiveSubTab === 'greeting' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <GreetingFieldBlock
                    id="inbound-greeting"
                    label="Karşılama Cümlesi"
                    tooltip="Müşteri işletmeyi telefonla aradığında asistanın söyleyeceği ilk açılış cümlesidir (3–280 karakter)."
                    value={settings.inbound.greeting}
                    placeholder="Merhaba, hoş geldiniz! Size nasıl yardımcı olabilirim?"
                    onChange={greeting => patchChannel('inbound', { greeting })}
                    error={fieldErrors['inbound.greeting']}
                  />
                  <ScenarioModeSubcard
                    channel="inbound"
                    value={settings.inbound.flowRuntimeMode}
                    onChange={flowRuntimeMode => patchChannel('inbound', { flowRuntimeMode })}
                    error={fieldErrors['inbound.flowRuntimeMode']}
                  />
                </div>
              )}

              {effectiveSubTab === 'voice' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <ModelAndVoiceFields
                    channel="inbound"
                    model={settings.inbound.model}
                    thinkingLevel={settings.inbound.thinkingLevel}
                    voiceName={settings.inbound.voiceName}
                    onChange={vals => patchChannel('inbound', vals)}
                    errors={fieldErrors}
                  />
                  <TurnAndNoiseFields
                    channel="inbound"
                    turnDetectionMode={settings.inbound.turnDetectionMode}
                    noiseFilterMode={settings.inbound.noiseFilterMode}
                    startWaitSeconds={settings.inbound.startWaitSeconds}
                    waitLabel="Konuşmaya başlamadan önce bekleme süresi"
                    recommendedWaitHint="Önerilen ayar 0,4 sn"
                    onChange={vals => patchChannel('inbound', vals)}
                    errors={fieldErrors}
                  />
                </div>
              )}

              {effectiveSubTab === 'rules' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <DurationAndSilenceGrid
                    channel="inbound"
                    maxActivePhoneCalls={settings.inbound.maxActivePhoneCalls}
                    callSilenceTimeout={settings.inbound.callSilenceTimeout}
                    callSilenceCloseTimeout={settings.inbound.callSilenceCloseTimeout}
                    callMaxDuration={settings.inbound.callMaxDuration}
                    onChange={vals => patchChannel('inbound', vals)}
                    errors={fieldErrors}
                  />
                  <div style={{ borderTop: '1px solid var(--input-border)', paddingTop: 8 }}>
                    <OffTopicSection
                      channel="inbound"
                      title="Konu Dışı Israr (Otomatik Veda ve Kapatma)"
                      strikeLabel="Kaçıncı ısrarda kapatılsın?"
                      closeLabel="Otomatik veda ve kapanış cümlesi"
                      offTopicMaxStrikes={settings.inbound.offTopicMaxStrikes}
                      offTopicCloseMessage={settings.inbound.offTopicCloseMessage}
                      onChange={vals => patchChannel('inbound', vals)}
                      errors={fieldErrors}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* GİDEN ARAMA */}
          {tab === 'outbound' && (
            <div style={{ ...subCard, padding: '10px 12px' }}>
              {effectiveSubTab === 'greeting' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <GreetingFieldBlock
                    id="outbound-greeting"
                    label="Açılış ve Kendini Tanıtma Cümlesi"
                    tooltip="Asistan randevu teyit, kontrol veya memnuniyet anketi için dış arama yaptığında karşı taraf telefonu açar açmaz söyleyeceği ilk cümledir (3–280 karakter)."
                    value={settings.outbound.greeting}
                    placeholder="Merhaba, işletmemizden arıyorum. Randevu teyit ve memnuniyet görüşmemiz için müsait misiniz?"
                    onChange={greeting => patchChannel('outbound', { greeting })}
                    error={fieldErrors['outbound.greeting']}
                  />
                  <ScenarioModeSubcard
                    channel="outbound"
                    value={settings.outbound.flowRuntimeMode}
                    onChange={flowRuntimeMode => patchChannel('outbound', { flowRuntimeMode })}
                    badgeText="Anketlerde Adım Adım Sıralı önerilir"
                    error={fieldErrors['outbound.flowRuntimeMode']}
                  />
                </div>
              )}

              {effectiveSubTab === 'voice' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <CompactTogglePill
                    checked={settings.outbound.useInboundVoice}
                    onChange={useInboundVoice => patchChannel('outbound', { useInboundVoice })}
                    title="Gelen arama asistanıyla aynı ses ve zeka modelini kullan"
                    tooltip={`Etkin olduğunda gelen arama asistanındaki ses (${settings.inbound.voiceName}) ve hız modu (${inboundModelSummary}) dış aramalarda da kullanılır.`}
                  />

                  {!settings.outbound.useInboundVoice && (
                    <ModelAndVoiceFields
                      channel="outbound"
                      model={settings.outbound.model}
                      thinkingLevel={settings.outbound.thinkingLevel}
                      voiceName={settings.outbound.voiceName}
                      onChange={vals => patchChannel('outbound', vals)}
                      errors={fieldErrors}
                    />
                  )}

                  <TurnAndNoiseFields
                    channel="outbound"
                    turnDetectionMode={settings.outbound.turnDetectionMode}
                    noiseFilterMode={settings.outbound.noiseFilterMode}
                    startWaitSeconds={settings.outbound.startWaitSeconds}
                    waitLabel="Alo demesini bekleme süresi"
                    recommendedWaitHint="Dış aramalarda önerilen ayar 0,6 sn"
                    onChange={vals => patchChannel('outbound', vals)}
                    errors={fieldErrors}
                  />
                </div>
              )}

              {effectiveSubTab === 'rules' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <DurationAndSilenceGrid
                    channel="outbound"
                    callSilenceTimeout={settings.outbound.callSilenceTimeout}
                    callSilenceCloseTimeout={settings.outbound.callSilenceCloseTimeout}
                    callMaxDuration={settings.outbound.callMaxDuration}
                    onChange={vals => patchChannel('outbound', vals)}
                    errors={fieldErrors}
                  />
                  <div style={{ borderTop: '1px solid var(--input-border)', paddingTop: 8 }}>
                    <OffTopicSection
                      channel="outbound"
                      title="Konu Dışı Israr (Otomatik Veda ve Kapatma)"
                      strikeLabel="Kaçıncı ısrarda kapatılsın?"
                      closeLabel="Otomatik veda ve kapanış cümlesi"
                      offTopicMaxStrikes={settings.outbound.offTopicMaxStrikes}
                      offTopicCloseMessage={settings.outbound.offTopicCloseMessage}
                      onChange={vals => patchChannel('outbound', vals)}
                      errors={fieldErrors}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* WHATSAPP */}
          {tab === 'whatsapp' && (
            <div style={{ ...subCard, padding: '10px 12px' }}>
              {effectiveSubTab === 'greeting' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <GreetingFieldBlock
                    id="whatsapp-greeting"
                    label="Yazılı Karşılama Mesajı"
                    tooltip="Kullanıcı yalnızca selam verdiğinde veya belirsiz bir mesaj yazdığında gönderilir. Doğrudan randevu veya işlem talebi yazılırsa bu kalıp otomatik atlanır."
                    value={settings.whatsapp.greeting}
                    placeholder="Merhaba, hoş geldiniz. Size nasıl yardımcı olabilirim?"
                    onChange={greeting => patchChannel('whatsapp', { greeting })}
                    error={fieldErrors['whatsapp.greeting']}
                  />
                  <ScenarioModeSubcard
                    channel="whatsapp"
                    value={settings.whatsapp.flowRuntimeMode}
                    onChange={flowRuntimeMode => patchChannel('whatsapp', { flowRuntimeMode })}
                    error={fieldErrors['whatsapp.flowRuntimeMode']}
                  />
                </div>
              )}

              {effectiveSubTab === 'voice' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                      <strong style={{ fontSize: 11.5, color: 'var(--foreground)' }}>Yazışma Üslubu</strong>
                      <InfoTooltip title="Yazışma üslubu">
                        {WHATSAPP_TONE_OPTIONS.map(o => `${o.shortTitle}: ${o.description}`).join(' • ')}
                      </InfoTooltip>
                    </div>
                    <CompactChoiceGrid
                      name="whatsapp-tone-style"
                      value={settings.whatsapp.toneStyle}
                      options={WHATSAPP_TONE_OPTIONS}
                      onChange={toneStyle => patchChannel('whatsapp', { toneStyle })}
                    />
                    {fieldErrors['whatsapp.toneStyle'] && (
                      <span role="alert" style={errorText}>
                        {fieldErrors['whatsapp.toneStyle']}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'grid', gap: 6 }}>
                    <span style={labelStyle}>Otomasyon ve Yanıt Tercihleri</span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: 6 }}>
                      <CompactTogglePill
                        checked={settings.whatsapp.allowEmoji}
                        onChange={allowEmoji => patchChannel('whatsapp', { allowEmoji })}
                        title="Mesajlarda Emoji Kullanımı"
                        tooltip="Uygun yerlerde ölçülü kurumsal ve iletişim emojileri kullanır."
                      />
                      <CompactTogglePill
                        checked={settings.whatsapp.allowLocationSharing}
                        onChange={allowLocationSharing => patchChannel('whatsapp', { allowLocationSharing })}
                        title="Otomatik Konum Paylaşımı"
                        tooltip="Müşteri adres veya konum sorduğunda işletmenin harita bağlantısını otomatik gönderir."
                      />
                      <CompactTogglePill
                        checked={settings.whatsapp.autoHandoverOnUnclear}
                        onChange={autoHandoverOnUnclear => patchChannel('whatsapp', { autoHandoverOnUnclear })}
                        title="Çözülemeyende Yetkiliye Devret"
                        tooltip="Asistan net yanıt veremediği durumlarda görüşmeyi işletme personeline devreder."
                      />
                    </div>
                  </div>
                </div>
              )}

              {effectiveSubTab === 'rules' && (
                <WhatsAppOffTopicSection
                  offTopicMaxStrikes={settings.whatsapp.offTopicMaxStrikes}
                  offTopicAction={settings.whatsapp.offTopicAction}
                  offTopicCloseMessage={settings.whatsapp.offTopicCloseMessage}
                  onChange={vals => patchChannel('whatsapp', vals)}
                  errors={fieldErrors}
                />
              )}
            </div>
          )}

          {/* WEB ASİSTANI */}
          {tab === 'web' && (
            <div>
              {effectiveSubTab === 'browser' ? (
                <BrowserSupportCard noiseFilterEnabled={settings.web.noiseFilterMode !== 'off'} />
              ) : (
                <div style={{ ...subCard, padding: '10px 12px' }}>
                  {effectiveSubTab === 'greeting' && (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <GreetingFieldBlock
                        id="web-greeting"
                        label="Web Karşılama Cümlesi"
                        tooltip="Ziyaretçi web sitesinden veya tarayıcıdan sesli görüşmeyi başlattığında asistanın söyleyeceği ilk cümledir (3–280 karakter)."
                        value={settings.web.greeting}
                        placeholder="Merhaba, hoş geldiniz! Size nasıl yardımcı olabilirim?"
                        onChange={greeting => patchChannel('web', { greeting })}
                        error={fieldErrors['web.greeting']}
                      />
                      <ScenarioModeSubcard
                        channel="web"
                        value={settings.web.flowRuntimeMode}
                        onChange={flowRuntimeMode => patchChannel('web', { flowRuntimeMode })}
                        error={fieldErrors['web.flowRuntimeMode']}
                      />
                    </div>
                  )}

                  {effectiveSubTab === 'voice' && (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <CompactTogglePill
                        checked={settings.web.useInboundVoice}
                        onChange={useInboundVoice => patchChannel('web', { useInboundVoice })}
                        title="Gelen arama asistanıyla aynı ses ve zeka modelini kullan"
                        tooltip={`Etkin olduğunda gelen arama asistanındaki ses (${settings.inbound.voiceName}) ve hız modu (${inboundModelSummary}) web oturumlarında da kullanılır.`}
                      />

                      {!settings.web.useInboundVoice && (
                        <ModelAndVoiceFields
                          channel="web"
                          model={settings.web.model}
                          thinkingLevel={settings.web.thinkingLevel}
                          voiceName={settings.web.voiceName}
                          onChange={vals => patchChannel('web', vals)}
                          errors={fieldErrors}
                        />
                      )}

                      <TurnAndNoiseFields
                        channel="web"
                        turnDetectionMode={settings.web.turnDetectionMode}
                        noiseFilterMode={settings.web.noiseFilterMode}
                        startWaitSeconds={settings.web.startWaitSeconds}
                        waitLabel="Başlangıç bekleme süresi"
                        recommendedWaitHint="Web görüşmelerinde önerilen ayar 0,4 sn"
                        onChange={vals => patchChannel('web', vals)}
                        errors={fieldErrors}
                      />
                    </div>
                  )}

                  {effectiveSubTab === 'rules' && (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <DurationAndSilenceGrid
                        channel="web"
                        silenceLabel="Sessizlik uyarısı"
                        closeLabel="Sessizlikte kapatma"
                        maxDurationLabel="Maksimum konuşma süresi"
                        callSilenceTimeout={settings.web.callSilenceTimeout}
                        callSilenceCloseTimeout={settings.web.callSilenceCloseTimeout}
                        callMaxDuration={settings.web.callMaxDuration}
                        onChange={vals => patchChannel('web', vals)}
                        errors={fieldErrors}
                      />
                      <div style={{ borderTop: '1px solid var(--input-border)', paddingTop: 8 }}>
                        <OffTopicSection
                          channel="web"
                          title="Konu Dışı Israr (Otomatik Veda ve Kapatma)"
                          strikeLabel="Kaçıncı ısrarda kapatılsın?"
                          closeLabel="Otomatik veda ve kapanış cümlesi"
                          offTopicMaxStrikes={settings.web.offTopicMaxStrikes}
                          offTopicCloseMessage={settings.web.offTopicCloseMessage}
                          onChange={vals => patchChannel('web', vals)}
                          errors={fieldErrors}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Alt İşlem Çubuğu */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button
              type="button"
              onClick={resetActiveChannelToDefaults}
              disabled={saving}
              style={{ ...clayBtn, cursor: saving ? 'wait' : 'pointer' }}
            >
              Bu kanalı varsayılanlara sıfırla
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              style={{ ...primaryBtn, cursor: saving ? 'wait' : 'pointer' }}
            >
              <span style={{ color: '#ffffff' }}>{saving ? 'Kaydediliyor…' : 'Değişiklikleri Kaydet'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
