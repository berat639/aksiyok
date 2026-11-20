import { Elysia } from 'elysia'
import { GoogleGenAI } from '@google/genai'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { clinics } from '../db/schema'
import { getDailyAiCallCount, recordAiTokenUsage } from '../db/repositories/ai-usage'
import { getGreeting } from '../db/repositories/settings'
import { getPreWarmedRagContext } from '../rag'
import { buildSystemPrompt } from '../services/assistant-config'
import { getGeminiClient, resolveClinicGeminiKey } from '../services/gemini-client'
import { getClinicEntitlements } from '../services/subscriptions'
import { currentClinicId, isLocalHostname, hostnameFromRequest, resolveTenantFromRequest } from '../tenancy/context'

async function resolveAssistantClinicId(request: Request): Promise<string | null> {
  const fromContext = currentClinicId()
  if (fromContext) return fromContext

  const fromReq = await resolveTenantFromRequest(request)
  if (fromReq?.clinicId) return fromReq.clinicId

  if (process.env.NODE_ENV !== 'production' && isLocalHostname(hostnameFromRequest(request))) {
    const [active] = await db
      .select({ id: clinics.id })
      .from(clinics)
      .where(eq(clinics.isActive, true))
      .limit(1)
    if (active?.id) return active.id
  }

  return null
}

async function checkAssistantQuota(
  clinicId: string,
  set: { status?: number | string },
): Promise<{ error: string; upgradeRequired?: boolean } | null> {
  const entitlements = await getClinicEntitlements(clinicId)
  if (entitlements.isTrialExpired) {
    set.status = 403
    return {
      error: '7 günlük ücretsiz deneme süreniz sona erdi. Devam etmek için Pro pakete geçin.',
      upgradeRequired: true,
    }
  }

  const todayCalls = await getDailyAiCallCount(clinicId)
  if (todayCalls >= entitlements.dailyAiCallLimit) {
    set.status = 429
    return {
      error: 'Günlük yapay zekâ görüşme kotasına ulaşıldı.',
    }
  }

  return null
}

export const webAssistantPlugin = new Elysia({ prefix: '/api/web-assistant' })
  .post('/live-token', async ({ request, set }) => {
    const clinicId = await resolveAssistantClinicId(request)
    if (!clinicId) {
      set.status = 404
      return { error: 'Bu alan adı için aktif işletme bulunamadı.' }
    }

    const blocked = await checkAssistantQuota(clinicId, set)
    if (blocked) return blocked

    let apiKey: string
    try {
      const resolved = await resolveClinicGeminiKey(clinicId)
      apiKey = resolved.apiKey
    } catch {
      set.status = 503
      return { error: 'Yapay zekâ servisi şu anda yapılandırılmamış.' }
    }

    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString()
    const newSessionExpireTime = new Date(Date.now() + 2 * 60_000).toISOString()

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: 'v1alpha' },
      })
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime: expiresAt,
          newSessionExpireTime,
        },
      })

      if (!token?.name) {
        set.status = 502
        return { error: 'Geçici oturum anahtarı oluşturulamadı.' }
      }

      await recordAiTokenUsage({
        clinicId,
        source: 'web_live',
        callCount: 1,
      })

      return {
        token: token.name,
        expiresAt,
      }
    } catch (err) {
      console.error('[WebAssistant] Ephemeral token oluşturulamadı:', err instanceof Error ? err.message : 'unknown')
      set.status = 502
      return { error: 'Sesli asistan oturumu başlatılamadı.' }
    }
  })

  .post('/chat', async ({ body, request, set }) => {
    const clinicId = await resolveAssistantClinicId(request)
    if (!clinicId) {
      set.status = 404
      return { error: 'Bu alan adı için aktif işletme bulunamadı.' }
    }

    const blocked = await checkAssistantQuota(clinicId, set)
    if (blocked) return blocked

    const b = (body || {}) as {
      message?: string
      history?: Array<{ role?: string; text?: string }>
      systemPrompt?: string
    }

    const message = String(b.message || '').trim()
    if (!message) {
      set.status = 400
      return { error: 'Mesaj metni boş olamaz.' }
    }
    if (message.length > 4000) {
      set.status = 400
      return { error: 'Mesaj metni çok uzun.' }
    }

    let systemInstruction = typeof b.systemPrompt === 'string' ? b.systemPrompt.trim().slice(0, 12_000) : ''
    if (!systemInstruction) {
      try {
        const [greetingRaw, ragContext] = await Promise.all([
          getGreeting('web', clinicId).then((g) => g || getGreeting('inbound', clinicId)),
          getPreWarmedRagContext(clinicId, 'web', 250),
        ])
        const basePrompt = await buildSystemPrompt(
          greetingRaw || 'Merhaba, size nasıl yardımcı olabilirim?',
          'web',
        )
        systemInstruction = `${basePrompt}${ragContext}`
      } catch {
        systemInstruction = 'Sen profesyonel ve nazik bir Türkçe işletme asistanısın. Kısa ve net yanıt ver.'
      }
    }

    const safeHistory = Array.isArray(b.history)
      ? b.history
          .slice(-30)
          .filter((turn) => turn && typeof turn.text === 'string' && turn.text.trim().length > 0)
          .map((turn) => ({
            role: turn.role === 'model' ? ('model' as const) : ('user' as const),
            parts: [{ text: String(turn.text).trim().slice(0, 4000) }],
          }))
      : []

    const contents = [
      ...safeHistory,
      {
        role: 'user' as const,
        parts: [{ text: message }],
      },
    ]

    try {
      const ai = await getGeminiClient(clinicId)
      const model = (process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
        },
      })

      const reply = (response.text || '').trim()
      const usage = response.usageMetadata
      await recordAiTokenUsage({
        clinicId,
        source: 'web_text',
        promptTokens: usage?.promptTokenCount ?? 0,
        responseTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
        callCount: 1,
      })

      return { reply }
    } catch (err) {
      console.error('[WebAssistant] Metin yanıtı üretilemedi:', err instanceof Error ? err.message : 'unknown')
      set.status = 502
      return { error: 'Yapay zekâ asistanından yanıt alınamadı.' }
    }
  })
