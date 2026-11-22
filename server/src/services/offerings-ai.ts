import { recordAiTokenUsage } from '../db/repositories/ai-usage'
import { getGeminiClient } from './gemini-client'

export type OfferingKind = 'urun' | 'hizmet'

export interface OfferingValidationInput {
  kind: OfferingKind
  title: string
  content: string
  businessName?: string
  businessCategory?: string
}

export interface OfferingValidationResult {
  approved: boolean
  reason: string
  suggestedTitle?: string
  suggestedContent?: string
  modelUsed: string
}

export interface OfferingGenerationInput {
  prompt: string
  businessName?: string
  businessCategory?: string
  existingTitles?: string[]
}

export interface GeneratedOffering {
  kind: OfferingKind
  title: string
  content: string
}

export interface OfferingGenerationResult {
  reply: string
  items: GeneratedOffering[]
  modelUsed: string
}

const VALIDATE_SCHEMA = {
  type: 'object',
  properties: {
    approved: {
      type: 'boolean',
      description: 'Ürün veya hizmet işletme kataloğuna eklenmeye uygunsa true, değilse false.',
    },
    reason: {
      type: 'string',
      description: 'Kullanıcıya gösterilecek en fazla 1-2 cümlelik net Türkçe açıklama.',
    },
    suggestedTitle: {
      type: 'string',
      description: 'Eğer düzeltme gerekiyorsa önerilen temiz Türkçe başlık; gerekmiyorsa boş string.',
    },
    suggestedContent: {
      type: 'string',
      description: 'Eğer düzeltme gerekiyorsa önerilen kısa, düzenli Türkçe içerik; gerekmiyorsa boş string.',
    },
  },
  required: ['approved', 'reason'],
}

const GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'Kullanıcıya 1 cümlelik kısa, samimi Türkçe yanıt.',
    },
    items: {
      type: 'array',
      description: 'Eklenecek 1 ila 6 adet gerçekçi Türkçe ürün veya hizmet şablonu.',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['hizmet', 'urun'],
          },
          title: {
            type: 'string',
            description: 'Kısa ve net başlık (en fazla 60 karakter).',
          },
          content: {
            type: 'string',
            description: 'Süre, ücret/fiyat aralığı, kapsam ve koşulları içeren kısa ve anlaşılır Türkçe açıklama.',
          },
        },
        required: ['kind', 'title', 'content'],
      },
    },
  },
  required: ['reply', 'items'],
}

function getLiteCandidateModels(): string[] {
  const configured = (process.env.GEMINI_OFFERINGS_MODEL || process.env.GEMINI_SCHEMA_BUILDER_MODEL || '').trim()
  return Array.from(
    new Set([
      ...(configured ? [configured] : []),
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-2.5-flash-lite',
    ])
  )
}

async function callGeminiLiteJson<T>(
  systemInstruction: string,
  userPrompt: string,
  schema: Record<string, unknown>,
  temperature = 0.15
): Promise<{ data: T; modelUsed: string }> {
  const client = await getGeminiClient()
  const candidates = getLiteCandidateModels()
  let lastErr: unknown = null

  for (const modelName of candidates) {
    try {
      const interaction = await client.interactions.create({
        model: modelName,
        input: userPrompt,
        system_instruction: systemInstruction,
        store: false,
        generation_config: { temperature },
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema,
        },
      })

      const fallbackJoined = Array.isArray((interaction as any)?.outputs)
        ? (interaction as any).outputs
            .filter((o: any) => o?.type === 'text' && typeof o?.text === 'string')
            .map((o: any) => o.text)
            .join('')
        : ''
      const rawText =
        typeof interaction.output_text === 'string' && interaction.output_text.trim()
          ? interaction.output_text.trim()
          : fallbackJoined.trim()

      if (rawText) {
        const usage = (interaction as any)?.usage
        if (usage) {
          void recordAiTokenUsage({
            source: 'simulator',
            promptTokens: Number(usage.input_tokens || 0),
            responseTokens: Number(usage.output_tokens || 0),
            totalTokens: Number(usage.total_tokens || 0),
            callCount: 1,
          }).catch(() => {})
        }
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
        return { data: JSON.parse(cleaned) as T, modelUsed: modelName }
      }
    } catch (err) {
      lastErr = err
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : 'yanıt alınamadı'
  console.error('[offerings-ai] doğrulama/şablon hatası:', msg)
  throw new Error('İşlem şu an tamamlanamadı. Lütfen birkaç saniye sonra tekrar deneyin.')
}

export async function validateOfferingWithGemini(
  input: OfferingValidationInput
): Promise<OfferingValidationResult> {
  const title = String(input.title || '').trim()
  const content = String(input.content || '').trim()
  if (!title || !content) {
    return { approved: false, reason: 'Başlık ve içerik boş bırakılamaz.', modelUsed: 'local' }
  }

  const bizInfo = [
    input.businessName?.trim() ? `İşletme Adı: ${input.businessName.trim()}` : null,
    input.businessCategory?.trim() ? `İşletme Kategorisi: ${input.businessCategory.trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const systemInstruction = `Sen bir işletme ürün ve hizmet kataloğu doğrulama filtresisin.
Görevin, kullanıcının eklemek istediği ürün/hizmet kaydının işletmenin seçtiği sektör/kategoriyle tutarlı ve yasal/uygun olup olmadığını evrensel olarak denetlemektir.

KURALLAR:
1. Aşağıdaki durumlarda approved = false ver ve kullanıcıya tek cümlelik net, kibar Türkçe bir uyarı mesajı (reason) yaz (asla "yapay zeka", "AI", "model" veya "Gemini" kelimelerini kullanma):
   - Girilen ürün veya hizmet, işletmenin seçili kategorisi/sektörü ile açıkça uyumsuz veya alakasızsa (hangi sektör olursa olsun; sektörle ilgisi olmayan başka alanların ürün/hizmetleri kabul edilmez).
   - Müstehcen, yetişkin içerikli, yasa dışı, zararlı, hakaret/küfür içeren veya ticari katalog standartlarına aykırı kayıtlar.
   - Anlamsız rastgele harfler, spam veya test metinleri (ör. "asdf", "aaa", "123123", "deneme").
   - Müşteriye hiçbir gerçek ürün veya hizmet bilgisi sunmayan boş/geçersiz metinler.
2. İşletmenin seçili sektörüyle makul ölçüde ilişkili, gerçek ve yasal ürün/hizmetlerde gereksiz katı olma — fiyat veya süre yazılmamış olsa bile geçerliyse approved = true ver.
3. reason alanı daima tek, sade ve doğrudan anlaşılır bir Türkçe cümle olsun (ör. "Bu kayıt seçili işletme kategorinizle uyumlu görünmüyor; lütfen faaliyet alanınıza uygun bir ürün veya hizmet girin.").`

  const userPrompt = `${bizInfo || 'İşletme Kategorisi: Belirtilmemiş'}
Tür: ${input.kind === 'urun' ? 'Ürün' : 'Hizmet'}
Başlık: ${title}
İçerik: ${content}`

  const { data, modelUsed } = await callGeminiLiteJson<{
    approved: boolean
    reason: string
    suggestedTitle?: string
    suggestedContent?: string
  }>(systemInstruction, userPrompt, VALIDATE_SCHEMA, 0.1)

  return {
    approved: Boolean(data.approved),
    reason: String(data.reason || (data.approved ? 'Katalog için uygun.' : 'Bu kayıt katalog için uygun görünmüyor.')).trim(),
    suggestedTitle: typeof data.suggestedTitle === 'string' && data.suggestedTitle.trim() ? data.suggestedTitle.trim() : undefined,
    suggestedContent: typeof data.suggestedContent === 'string' && data.suggestedContent.trim() ? data.suggestedContent.trim() : undefined,
    modelUsed,
  }
}

export async function generateOfferingsWithGemini(
  input: OfferingGenerationInput
): Promise<OfferingGenerationResult> {
  const prompt = String(input.prompt || '').trim()
  if (prompt.length < 2) {
    throw new Error('Lütfen ne tür ürün veya hizmet şablonu istediğinizi kısaca yazın.')
  }
  if (prompt.length > 800) {
    throw new Error('İstek metni en fazla 800 karakter olabilir.')
  }

  const bizInfo = [
    input.businessName?.trim() ? `İşletme Adı: ${input.businessName.trim()}` : null,
    input.businessCategory?.trim() ? `İşletme Kategorisi: ${input.businessCategory.trim()}` : null,
    input.existingTitles && input.existingTitles.length > 0
      ? `Mevcut Kayıtlar (tekrar etme): ${input.existingTitles.slice(0, 20).join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  const systemInstruction = `Sen işletmeler için sade ve profesyonel Türkçe ürün & hizmet şablonu oluşturan bir asistansın.

KURALLAR:
1. İşletmenin kategorisine ve kullanıcının isteğine %100 uygun, müşteriye doğrudan sunulabilecek gerçekçi Türkçe ürün/hizmet şablonları üret.
2. Kullanıcı sayı belirtmediyse 3 adet kaliteli şablon üret; sayı belirttiyse o kadar üret (en fazla 6).
3. Her şablonda:
   - kind: fiziksel/paket ürünse "urun", servis/danışmanlık/uygulama ise "hizmet".
   - title: kısa, net Türkçe başlık.
   - content: 1-2 satırda kapsam, süre ve fiyat/komisyon/teslim bilgisini içeren düzenli şablon (gereksiz uzun paragraf yazma).
4. Mevcut kayıtlardaki başlıkları birebir tekrarlama.
5. reply alanında ne eklediğini 1 kısa Türkçe cümleyle özetle.`

  const userPrompt = `${bizInfo || 'İşletme Kategorisi: Genel İşletme'}\n\nKullanıcı İsteği:\n${prompt}`

  const { data, modelUsed } = await callGeminiLiteJson<{
    reply: string
    items: Array<{ kind?: string; title?: string; content?: string }>
  }>(systemInstruction, userPrompt, GENERATE_SCHEMA, 0.35)

  const items: GeneratedOffering[] = (Array.isArray(data.items) ? data.items : [])
    .filter((it) => it && typeof it.title === 'string' && it.title.trim() && typeof it.content === 'string' && it.content.trim())
    .slice(0, 6)
    .map((it) => ({
      kind: it.kind === 'urun' ? 'urun' : 'hizmet',
      title: String(it.title).trim().slice(0, 120),
      content: String(it.content).trim().slice(0, 2000),
    }))

  if (items.length === 0) {
    throw new Error('Şablon üretilemedi; lütfen isteğinizi biraz daha net yazın.')
  }

  return {
    reply: String(data.reply || `${items.length} örnek şablon eklendi.`).trim(),
    items,
    modelUsed,
  }
}
