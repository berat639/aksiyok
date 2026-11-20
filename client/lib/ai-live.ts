import {
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  type Session,
  type LiveServerMessage,
  type FunctionDeclaration,
} from '@google/genai'
import {
  buildRealtimeDetectionConfig,
  ENGLISH_INTERCEPT_RECOVERY_PROMPT,
  evaluateLiveKitTurkishTurn,
  isEnglishResponseDetected,
  SEMANTIC_TURN_PROMPT_INSTRUCTION,
  wrapWithTurkishLanguageLock,
  type NoiseFilterMode,
  type TurnAnalysisResult,
  type TurnDetectionMode,
} from './turn-detector'

export function hasSpokenFarewell(text: string, customCloseMessage?: string): boolean {
  const raw = String(text || '').trim()
  const normalize = (value: string) =>
    String(value || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/[.,!?;:()[\]{}"']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const normalized = normalize(raw)
  if (!normalized) return false

  if (customCloseMessage) {
    const customNorm = normalize(customCloseMessage)
    if (customNorm.length >= 10 && normalized.includes(customNorm)) {
      return true
    }
  }

  // Soru ile biten veya karşılama cümlesi olan ifadeler kapanış sayılmaz ("İyi günler, nasıl yardımcı olabilirim?" vb.)
  if (
    raw.endsWith('?') ||
    /\b(?:hoş\s*geldiniz|nasıl\s+yardımcı\s+olabilirim)\b/u.test(normalized)
  ) {
    return /\b(?:hoşça\s*kalın|hoşçakalın|görüş(?:meyi|memizi)\s+sonlandır)\b/u.test(normalized)
  }

  return [
    /\bhoşça\s*kalın\b/u,
    /\bhoşçakalın\b/u,
    /\bgüle\s*güle\b/u,
    /\biyi\s+(?:günler|akşamlar|geceler)\b/u,
    /\bsağlıklı\s+günler\b/u,
    /\bkendinize\s+iyi\s+bakın\b/u,
    /\bgörüş(?:meyi|memizi)\s+sonlandır/u,
    /\bbaşka\s+bir\s+zaman\s+(?:tekrar\s+)?görüş/u,
    /\bgörüşmek\s+(?:üzere|dileğiyle)\b/u,
  ].some(pattern => pattern.test(normalized))
}

export type LiveChatCallbacks = {
  onAudioChunk: (base64Data: string) => void
  onText: (text: string) => void
  onTurnComplete: () => void
  onConnectionChange: (connected: boolean) => void
  onError: (error: string) => void
  onInterrupted: () => void
  onInteractionStatus?: (status: 'IN_PROGRESS' | 'IDLE') => void
  /** Asistan görüşmeyi sonlandırdığında (cagriySonlandir) mikrofonu ve oturumu kapatmak için tetiklenir. */
  onHangup?: (opts: { alreadySpokeFarewell: boolean }) => void
  /** Kullanıcının konuşmasının yazıya dökümü (sesli modda). */
  onUserText?: (text: string) => void
  /** LiveKit + Türkçe SOV sıra algılayıcı sonucu */
  onTurnDetection?: (result: TurnAnalysisResult) => void
}

export type SessionConfig = {
  systemPrompt: string
  toolDeclarations: FunctionDeclaration[]
  model: string
  /** Metin sohbeti Live modelini kullanmaz; Live modelleri TEXT çıktısı desteklemez. */
  textModel: string
  greeting: string
  branding: {
    title: string
    subtitle: string
    logoUrl: string
  }
  voiceName?: string
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH'
  startWaitSeconds?: number
  turnDetectionMode?: TurnDetectionMode
  noiseFilterMode?: NoiseFilterMode
  callSilenceTimeout?: number
  callSilenceCloseTimeout?: number
  callMaxDuration?: number
  offTopicMaxStrikes?: number
  offTopicCloseMessage?: string
  flowSession?: { id: string; token: string; revision?: number }
  sessionKey?: string
  /**
   * Verilirse araç çağrıları sunucudaki canlı uç noktalara gitmez, bu işleyiciye
   * yönlenir (ör. simülatör: hiçbir gerçek kayıt oluşturulmaz).
   */
  toolHandler?: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
}

// ── Tool call → server HTTP ────────────────────────────────────────────────
async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  flowSession?: { id: string; token: string; revision?: number },
  sessionKey?: string,
  legacyCollectedFields?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = flowSession?.token || sessionKey
  const post = async (path: string, body: Record<string, unknown>) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['x-flow-session-key'] = token
      const res = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      return await res.json()
    } catch {
      return { error: 'Sunucuya erişilemedi.' }
    }
  }

  switch (name) {
    case 'akisBilgisiGuncelle': {
      if (!flowSession) return { success: false, message: 'Akışla çalışma bu görüşmede açık değil.' }
      const rawNested = (args.bilgiler && typeof args.bilgiler === 'object') ? (args.bilgiler as Record<string, unknown>) : {}
      const flatFields = Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'bilgiler' && k !== 'yeni_kisi'))
      const mergedFields = { ...flatFields, ...rawNested }
      if (legacyCollectedFields) Object.assign(legacyCollectedFields, mergedFields)
      let result: Record<string, unknown>
      try {
        const response = await fetch(`/api/flow-sessions/${flowSession.id}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-flow-session-key': flowSession.token },
          body: JSON.stringify({
            id: `${Date.now()}-${Math.random()}`,
            revision: flowSession.revision,
            fields: mergedFields,
            intent: args.yeni_kisi === true ? 'new_person' : 'continue',
          }),
        })
        result = await response.json()
      } catch { return { success: false, message: 'Akış bilgisi güncellenemedi.' } }
      if (typeof result.revision === 'number') flowSession.revision = result.revision
      return result
    }
    case 'randevuOlustur': {
      if (!flowSession) return post('/api/tools/create-appointment', { ...(legacyCollectedFields || {}), ...args })
      try {
        const response = await fetch(`/api/flow-sessions/${flowSession.id}/actions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-flow-session-key': flowSession.token },
          body: JSON.stringify({ name, args }),
        })
        return await response.json()
      } catch { return { success: false, message: 'Randevu işlemi şu an tamamlanamadı.' } }
    }
    case 'hastaNotKaydet': {
      if (flowSession) {
        try {
          const response = await fetch(`/api/flow-sessions/${flowSession.id}/actions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-flow-session-key': flowSession.token },
            body: JSON.stringify({ name, args }),
          })
          return await response.json()
        } catch { return { success: false, message: 'Not kaydedilirken bir hata oluştu.' } }
      }
      return post('/api/tools/patient-note', { ...(legacyCollectedFields || {}), ...args })
    }
    case 'veriTablosunaKaydet': {
      const rawNested = (args.bilgiler && typeof args.bilgiler === 'object') ? (args.bilgiler as Record<string, unknown>) : {}
      const extraArgs = Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'bilgiler' && k !== 'hedef_tablo_id'))
      if (legacyCollectedFields) Object.assign(legacyCollectedFields, extraArgs, rawNested)
      if (flowSession) {
        try {
          const response = await fetch(`/api/flow-sessions/${flowSession.id}/actions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-flow-session-key': flowSession.token },
            body: JSON.stringify({ name, args }),
          })
          return await response.json()
        } catch { return { success: false, message: 'Veri tablosuna kayıt yapılırken bir hata oluştu.' } }
      }
      return post('/api/tools/save-dynamic-record', {
        ...(legacyCollectedFields || {}),
        ...extraArgs,
        ...(args.hedef_tablo_id ? { hedef_tablo_id: args.hedef_tablo_id } : {}),
        bilgiler: { ...(legacyCollectedFields || {}), ...extraArgs, ...rawNested },
      })
    }
    case 'searchKnowledgeBase': return post('/api/tools/search-knowledge', { sorgu: args.sorgu })
    case 'musteriSorgula': {
      const res = await post('/api/tools/customer-query', { telefon: args.telefon })
      if (res && typeof res === 'object' && 'kayitli' in res) {
        const dynFields = (res.dinamik_alanlar && typeof res.dinamik_alanlar === 'object')
          ? (res.dinamik_alanlar as Record<string, unknown>)
          : {}
        if (legacyCollectedFields) {
          Object.assign(legacyCollectedFields, {
            ...dynFields,
            ...(args.telefon ? { telefon: String(args.telefon) } : {}),
            ...(typeof res.musteri_adi === 'string' && res.musteri_adi ? { musteri_adi: res.musteri_adi } : {}),
          })
        }
        if (flowSession) {
          try {
            const evRes = await fetch(`/api/flow-sessions/${flowSession.id}/events`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-flow-session-key': flowSession.token },
              body: JSON.stringify({
                id: `${Date.now()}-${Math.random()}`,
                revision: flowSession.revision,
                fields: {
                  ...dynFields,
                  telefon: String(args.telefon || ''),
                  kayitli: res.kayitli ? 'true' : 'false',
                  'caller.isKnownPatient': res.kayitli ? 'true' : 'false',
                  ...(typeof res.musteri_adi === 'string' && res.musteri_adi ? { musteri_adi: res.musteri_adi } : {}),
                },
                intent: 'continue',
              }),
            })
            const evJson = await evRes.json().catch(() => null)
            if (evJson && typeof evJson.revision === 'number') flowSession.revision = evJson.revision
          } catch {}
        }
      }
      return res
    }
    case 'randevuGuncelle': return post('/api/tools/create-appointment', { ...args, _update: true })
    case 'randevuDurumBildir': return post('/api/tools/appointment-status', args)
    case 'randevuMusaitlikKontrol': return post('/api/tools/check-availability', args)
    case 'gecmisRandevular': return post('/api/tools/customer-query', { telefon: args.telefon })
    case 'aramaAktar':
    case 'whatsappKonumGonder':
    case 'cagriySonlandir': {
      if (flowSession) {
        try {
          const response = await fetch(`/api/flow-sessions/${flowSession.id}/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-flow-session-key': flowSession.token },
            body: JSON.stringify({ name, args }),
          })
          return await response.json()
        } catch {
          return { success: false, message: 'İşlem şu anda tamamlanamadı.' }
        }
      }
      if (name === 'aramaAktar') {
        const hedef = String(args.hedef || 'yetkili birim')
        return { success: true, message: `Görüşmeniz ${hedef} birimine aktarılıyor, lütfen hattan ayrılmayın.` }
      }
      if (name === 'whatsappKonumGonder') {
        return { success: true, message: 'Klinik konumu WhatsApp üzerinden paylaşıldı.' }
      }
      return { success: true, message: 'Görüşme sonlandırılıyor.' }
    }
    case 'havaDurumuSorgula': return { success: true, sehir: String(args.sehir || 'Ankara'), sicaklik: '21°C', durum: 'açık ve güneşli', message: `${String(args.sehir || 'Ankara')}'da hava şu an yaklaşık 21 derece, açık ve güneşli.` }
    default: return { error: `Bilinmeyen araç: ${name}` }
  }
}

export class AiLiveSession {
  private session: Session | null = null
  private textAi: GoogleGenAI | null = null
  private _useServerTextChat = false
  private _serverTextHistory: Array<{ role: 'user' | 'model'; text: string }> = []
  private textConfig: SessionConfig | null = null
  private textHistory: Array<Record<string, unknown>> = []
  private textQueue: Promise<void> = Promise.resolve()
  private callbacks: LiveChatCallbacks
  private _isConnected = false
  private _sendGuard = false
  private flowSession?: { id: string; token: string; revision?: number }
  private sessionKey?: string
  private legacyCollectedFields: Record<string, unknown> = {}
  private toolHandler?: SessionConfig['toolHandler']
  private _interactionInProgress = false
  private _pendingToolCalls = 0
  private _closingSession = false
  private _hangupToolCalled = false
  private _offTopicCloseMessage?: string
  private _turnMode: TurnDetectionMode = 'semantic'
  private _lastAssistantTranscript = ''
  private _currentModelTranscript = ''
  private _currentUserTranscript = ''
  private _englishInterceptedInTurn = false
  private _englishRecoveryCount = 0
  private _pendingClientTexts: string[] = []
  private _setupReady = false

  constructor(callbacks: LiveChatCallbacks) {
    this.callbacks = callbacks
  }

  private flushPendingTexts() {
    if (!this.session || !this._isConnected || this._sendGuard || this._pendingClientTexts.length === 0) return
    while (this._pendingClientTexts.length > 0) {
      const text = this._pendingClientTexts.shift()
      if (text) {
        try {
          this.session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          })
        } catch { /* ignore */ }
      }
    }
  }

  async connect(apiKey: string, config: SessionConfig, mode: 'audio' | 'text' = 'audio'): Promise<void> {
    const modelName = config.model || 'gemini-3.8-live'
    this.flowSession = config.flowSession
    this.sessionKey = config.flowSession?.token || config.sessionKey
    this.legacyCollectedFields = {}
    this.toolHandler = config.toolHandler
    this._interactionInProgress = false
    this._pendingToolCalls = 0
    this._closingSession = false
    this._hangupToolCalled = false
    this._offTopicCloseMessage = config.offTopicCloseMessage
    this._turnMode = config.turnDetectionMode === 'standard' ? 'standard' : 'semantic'
    this._lastAssistantTranscript = ''
    this._currentModelTranscript = ''
    this._currentUserTranscript = ''
    this._englishInterceptedInTurn = false
    this._englishRecoveryCount = 0
    this._pendingClientTexts = []
    this._setupReady = false

    // Gemini Live is an audio session. Requesting TEXT from it causes
    // "response modalities (TEXT) is not supported". Keep text chat on the
    // server chat endpoint when using ephemeral/server mode, while preserving
    // direct SDK fallback for non-ephemeral unit test keys.
    if (mode === 'text') {
      const useServerChat = !apiKey || apiKey === '__server__' || apiKey.startsWith('auth_tokens/')
      this._useServerTextChat = useServerChat
      this.textAi = useServerChat ? null : new GoogleGenAI({ apiKey })
      this.textConfig = config
      this.textHistory = []
      this._serverTextHistory = []
      this.textQueue = Promise.resolve()
      this._sendGuard = false
      this._isConnected = true
      this.callbacks.onConnectionChange(true)
      return
    }

    const turnMode: TurnDetectionMode = config.turnDetectionMode === 'standard' ? 'standard' : 'semantic'
    const baseSystemPrompt = turnMode === 'semantic'
      ? `${config.systemPrompt}\n\n${SEMANTIC_TURN_PROMPT_INSTRUCTION}`
      : config.systemPrompt
    const effectiveSystemPrompt = wrapWithTurkishLanguageLock(baseSystemPrompt)

    return new Promise<void>((resolve, reject) => {
      const isEphemeral = apiKey.startsWith('auth_tokens/')
      const ai = new GoogleGenAI(
        isEphemeral
          ? { apiKey, httpOptions: { apiVersion: 'v1alpha' } }
          : { apiKey },
      )
      let resolved = false
      const finishConnect = () => {
        if (!resolved && this.session && this._isConnected) {
          resolved = true
          this._setupReady = true
          this.flushPendingTexts()
          resolve()
        }
      }

      ai.live
        .connect({
          model: `models/${modelName}`,
          callbacks: {
            onopen: () => {
              this._isConnected = true
              this.callbacks.onConnectionChange(true)
            },
            onmessage: (message: LiveServerMessage) => {
              if ((message as any).setupComplete) {
                this._setupReady = true
                finishConnect()
              }
              this.handleMessage(message)
            },
            onerror: (e: ErrorEvent) => {
              console.error('[Live] Error:', e.message || e)
              this._isConnected = false
              this._sendGuard = true
              this.callbacks.onError(e.message || 'Bağlantı hatası')
              if (!resolved) { resolved = true; reject(new Error(e.message || 'Failed')) }
            },
            onclose: (e: CloseEvent) => {
              this._isConnected = false
              this._sendGuard = true
              this.callbacks.onConnectionChange(false)
              if (e.code !== 1000) {
                const reason = e.reason || `Bağlantı kesildi (kod: ${e.code})`
                console.error(`[Live] Closed: ${e.code} reason: ${e.reason}`)
                this.callbacks.onError(reason)
                if (!resolved) { resolved = true; reject(new Error(reason)) }
              } else {
                if (!resolved) { resolved = true; resolve() }
              }
            },
          },
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: effectiveSystemPrompt,
            tools: config.toolDeclarations.length > 0
              ? [{ functionDeclarations: config.toolDeclarations }]
              : undefined,
            contextWindowCompression: {
              triggerTokens: '25600',
              slidingWindow: {
                targetTokens: '16000',
              },
            },
            speechConfig: mode === 'audio' ? {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: config.voiceName || 'Aoede',
                },
              },
            } : undefined,
            realtimeInputConfig: mode === 'audio'
              ? buildRealtimeDetectionConfig(turnMode)
              : undefined,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            ...(modelName === 'gemini-3.8-live-extended-thinking' ? {
              thinkingConfig: { thinkingLevel: ThinkingLevel[config.thinkingLevel || 'LOW'] },
            } : {}),
          },
        })
        .then((session) => {
          this.session = session
          if (this._setupReady) {
            finishConnect()
          } else {
            // setupComplete onmessage içinde gelmiş veya 120ms içinde gelecek olabilir
            setTimeout(() => finishConnect(), 120)
          }
        })
        .catch((err) => {
          console.error('[Live] Connect failed:', err)
          this._isConnected = false
          if (!resolved) { resolved = true; reject(err) }
        })
    })
  }

  sendAudio(base64PCM: string) {
    if (!this.session || !this._isConnected || this._sendGuard || this._closingSession) return
    try {
      this.session.sendRealtimeInput({
        audio: { data: base64PCM, mimeType: 'audio/pcm;rate=16000' },
      })
    } catch {
      this._isConnected = false
      this._sendGuard = true
    }
  }

  sendText(text: string) {
    if (!this._isConnected || this._sendGuard) return

    if ((this._useServerTextChat || this.textAi) && this.textConfig) {
      // Greeting and a quickly typed first message must retain their order.
      this.textQueue = this.textQueue.then(() =>
        this._useServerTextChat ? this.sendServerTextChat(text) : this.sendTextChat(text),
      )
      return
    }

    if (!this.session || !this._setupReady) {
      this._pendingClientTexts.push(text)
      return
    }
    try {
      this.session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true,
      })
    } catch { /* ignore */ }
  }

  private async sendServerTextChat(text: string): Promise<void> {
    const config = this.textConfig
    if (!config || !this._isConnected || this._sendGuard) return

    try {
      const res = await fetch('/api/web-assistant/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.sessionKey ? { 'x-flow-session-key': this.sessionKey } : {}),
        },
        body: JSON.stringify({
          message: text,
          history: this._serverTextHistory,
          systemPrompt: config.systemPrompt,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' && data.error.trim()
            ? data.error
            : 'Yazılı asistan şu anda yanıt veremedi.',
        )
      }
      const reply = typeof data.reply === 'string' ? data.reply.trim() : ''
      this._serverTextHistory.push({ role: 'user', text })
      if (reply) {
        this._serverTextHistory.push({ role: 'model', text: reply })
      }
      if (this._serverTextHistory.length > 30) {
        this._serverTextHistory = this._serverTextHistory.slice(-30)
      }
      if (reply) this.callbacks.onText(reply)
      this.callbacks.onTurnComplete()
      if (data.hangup === true) {
        this.callbacks.onHangup?.({ alreadySpokeFarewell: true })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Yazılı asistan yanıt veremedi.'
      console.error('[Server text chat] Error:', error)
      this._isConnected = false
      this.callbacks.onConnectionChange(false)
      this.callbacks.onError(message)
    }
  }

  private async sendTextChat(text: string): Promise<void> {
    const ai = this.textAi
    const config = this.textConfig
    if (!ai || !config || !this._isConnected || this._sendGuard) return

    this.textHistory.push({ role: 'user', parts: [{ text }] })
    let hangupTriggeredInTurn = false

    try {
      // A tool can require one or more model round trips before it produces
      // visible text. Cap the loop to avoid a malformed tool response keeping
      // the browser request alive forever.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await ai.models.generateContent({
          model: config.textModel || 'gemini-3.8-flash',
          contents: this.textHistory as any,
          config: {
            systemInstruction: wrapWithTurkishLanguageLock(config.systemPrompt),
            tools: config.toolDeclarations.length > 0
              ? [{ functionDeclarations: config.toolDeclarations }]
              : undefined,
          },
        })

        const candidateParts = (response.candidates?.[0]?.content?.parts ?? []) as Array<Record<string, unknown>>
        const functionCalls = response.functionCalls ?? []
        if (functionCalls.length === 0) {
          const answer = response.text?.trim()
          if (candidateParts.length > 0) {
            this.textHistory.push({
              role: 'model',
              parts: candidateParts.map(part => ({ ...part })),
            })
          } else if (answer) {
            this.textHistory.push({
              role: 'model',
              parts: [{ text: answer }],
            })
          }
          if (answer) this.callbacks.onText(answer)
          this.callbacks.onTurnComplete()
          if (hangupTriggeredInTurn) {
            this.callbacks.onHangup?.({ alreadySpokeFarewell: true })
          }
          return
        }

        if (functionCalls.some(call => call.name === 'cagriySonlandir')) {
          hangupTriggeredInTurn = true
          this._closingSession = true
          this._hangupToolCalled = true
        }

        // Preserve exact candidate.content.parts so thought: true and
        // thoughtSignature / thought_signature on functionCall parts are kept.
        this.textHistory.push({
          role: 'model',
          parts: candidateParts.length > 0
            ? candidateParts.map(part => ({ ...part }))
            : functionCalls.map(call => ({
                functionCall: { name: call.name, args: call.args ?? {} },
              })),
        })

        const results = await Promise.all(functionCalls.map(async (call) => ({
          ...(call.id ? { id: call.id } : {}),
          name: call.name,
          response: await this.runTool(call.name ?? '', (call.args ?? {}) as Record<string, unknown>),
        })))
        this.textHistory.push({
          role: 'user',
          parts: results.map(result => ({ functionResponse: result })),
        })
      }

      throw new Error('Araç yanıtı tamamlanamadı. Lütfen tekrar deneyin.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Yazılı asistan yanıt veremedi.'
      console.error('[Text chat] Error:', error)
      this._isConnected = false
      this.callbacks.onConnectionChange(false)
      this.callbacks.onError(message)
    }
  }

  disconnect() {
    this._isConnected = false
    this._closingSession = false
    this._pendingToolCalls = 0
    if (this.session) {
      try { this.session.close() } catch { /* */ }
      this.session = null
    }
    this.textAi = null
    this._useServerTextChat = false
    this._serverTextHistory = []
    this.textConfig = null
    this.textHistory = []
    this.textQueue = Promise.resolve()
    this.legacyCollectedFields = {}
    this.toolHandler = undefined
    if (this.flowSession) {
      const { id, token } = this.flowSession
      this.flowSession = undefined
      void fetch(`/api/flow-sessions/${id}`, { method: 'DELETE', headers: { 'x-flow-session-key': token } })
    }
  }

  get connected() { return this._isConnected }
  get interactionInProgress() { return this._interactionInProgress }
  get hasPendingToolCalls() { return this._pendingToolCalls > 0 }

  private runTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.toolHandler) return this.toolHandler(name, args)
    return handleToolCall(name, args, this.flowSession, this.sessionKey, this.legacyCollectedFields)
  }

  private triggerEnglishGuard() {
    if (this._englishInterceptedInTurn) return
    this._englishInterceptedInTurn = true
    this._currentModelTranscript = ''
    this.callbacks.onInterrupted()
    if (this._englishRecoveryCount < 4 && this.session && this._isConnected && !this._sendGuard) {
      this._englishRecoveryCount += 1
      try {
        this.session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: ENGLISH_INTERCEPT_RECOVERY_PROMPT }] }],
          turnComplete: true,
        })
      } catch { /* ignore */ }
    }
  }

  private handleMessage(message: LiveServerMessage) {
    // Tool calls
    if (message.toolCall?.functionCalls?.length) {
      for (const fc of message.toolCall.functionCalls) {
        const toolName = fc.name ?? ''
        const isHangupTool = toolName === 'cagriySonlandir'
        let alreadySpokeFarewell = false

        if (isHangupTool) {
          const alreadyClosing = this._hangupToolCalled
          this._closingSession = true
          this._hangupToolCalled = true
          alreadySpokeFarewell =
            alreadyClosing ||
            hasSpokenFarewell(this._currentModelTranscript, this._offTopicCloseMessage) ||
            hasSpokenFarewell(this._lastAssistantTranscript, this._offTopicCloseMessage)
        }

        this._pendingToolCalls += 1
        this.runTool(toolName, (fc.args ?? {}) as Record<string, unknown>)
          .then((result) => {
            if (isHangupTool) {
              this.callbacks.onHangup?.({ alreadySpokeFarewell })
              if (alreadySpokeFarewell) {
                // Veda cümlesi zaten söylendiyse modele ikinci kez veda ettirmemek için yanıt gönderme
                return
              }
            } else if (this._closingSession) {
              return
            }

            if (this.session && this._isConnected) {
              const responsePayload = isHangupTool
                ? {
                    ...result,
                    success: true,
                    message:
                      typeof result.message === 'string' && result.message.trim() && result.message !== 'Görüşme sonlandırılıyor.'
                        ? result.message
                        : 'Görüşme sonlandırılıyor. Yalnızca tek bir kısa veda cümlesi ("Sağlıklı günler dilerim, hoşça kalın.") söyle ve başka araç çağırmadan dur.',
                    _dil_kurali: 'YALNIZCA TÜRKÇE KONUŞ. İngilizce tek kelime bile kullanma.',
                  }
                : {
                    ...result,
                    _dil_kurali: 'YALNIZCA TÜRKÇE KONUŞ. İngilizce tek kelime bile kullanma.',
                  }
              try {
                this.session.sendToolResponse({
                  functionResponses: [{
                    id: fc.id,
                    name: toolName,
                    response: responsePayload,
                  }],
                })
              } catch { /* */ }
            }
          })
          .catch(() => {
            if (isHangupTool) {
              this.callbacks.onHangup?.({ alreadySpokeFarewell })
              return
            }
            if (!this._closingSession && this.session && this._isConnected) {
              try {
                this.session.sendToolResponse({
                  functionResponses: [{
                    id: fc.id,
                    name: toolName,
                    response: {
                      success: false,
                      message: 'Araç çalıştırılamadı. Yalnızca Türkçe yanıt ver.',
                      _dil_kurali: 'YALNIZCA TÜRKÇE KONUŞ.',
                    },
                  }],
                })
              } catch { /* */ }
            }
          })
          .finally(() => {
            this._pendingToolCalls = Math.max(0, this._pendingToolCalls - 1)
          })
      }
    }

    const interactionStatus = (message.serverContent as any)?.interactionStatus ?? (message as any).interactionStatus
    if (interactionStatus === 'IN_PROGRESS' || interactionStatus === 'IDLE') {
      this._interactionInProgress = interactionStatus === 'IN_PROGRESS'
      this.callbacks.onInteractionStatus?.(interactionStatus)
    }

    // Output transcription (text of what AI said in audio mode) — kontrolü
    // ses parçalarından önce yapılır ki İngilizce algılandığı anda ses kesilsin.
    const transcript = (message as any).serverContent?.outputTranscription?.text
    if (transcript && !this._englishInterceptedInTurn) {
      this._currentModelTranscript = `${this._currentModelTranscript}${transcript}`.slice(-600)
      this._currentUserTranscript = ''
      if (isEnglishResponseDetected(this._currentModelTranscript)) {
        this.triggerEnglishGuard()
      } else {
        this.callbacks.onText(transcript)
      }
    }

    // Audio parts (modelTurn.parts[].text Native Audio modunda iç düşünce/thought içerdiği için yok sayılır)
    if (!this._englishInterceptedInTurn && message.serverContent?.modelTurn?.parts) {
      for (const part of message.serverContent.modelTurn.parts) {
        if (!this._englishInterceptedInTurn && part?.inlineData?.data) {
          this.callbacks.onAudioChunk(part.inlineData.data)
        }
      }
    }

    const userTranscript = (message as any).serverContent?.inputTranscription?.text
    if (userTranscript) {
      this._currentUserTranscript = `${this._currentUserTranscript} ${userTranscript}`.trim().slice(-500)
      this.callbacks.onUserText?.(userTranscript)
      if (this._turnMode === 'semantic') {
        const analysis = evaluateLiveKitTurkishTurn({
          userText: this._currentUserTranscript,
          assistantText: this._lastAssistantTranscript,
        })
        this.callbacks.onTurnDetection?.(analysis)
      }
    }

    if (message.serverContent?.turnComplete) {
      const wasEnglishBlocked = this._englishInterceptedInTurn
      if (!wasEnglishBlocked && this._currentModelTranscript.trim()) {
        this._lastAssistantTranscript = this._currentModelTranscript.trim()
      }
      this._currentModelTranscript = ''
      this._currentUserTranscript = ''
      this._englishInterceptedInTurn = false
      if (!wasEnglishBlocked) {
        this.callbacks.onTurnComplete()
      }
    }
    if (message.serverContent?.interrupted) {
      this._currentModelTranscript = ''
      this._englishInterceptedInTurn = false
      this.callbacks.onInterrupted()
    }
  }
}
