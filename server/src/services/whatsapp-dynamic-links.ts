import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { whatsappConversations } from '../db/schema'
import { ensureWhatsAppSetupSchema } from '../db/repositories/whatsapp'
import {
  findDynamicRecordsByLinkUrls,
  loadDynamicRecordsByRowIds,
  lookupDynamicFieldsByPhone,
  type MatchedDynamicLinkRecord,
} from '../db/repositories/dynamic-tables'
import { getGreeting } from '../db/repositories/settings'
import { getOrCreateWhatsAppFlowEngine, releaseWhatsAppFlowEngine, type FlowEngine } from './flow-engine'
import { extractUrlsFromText } from './dynamic-link-matcher'

export type WhatsAppDynamicLinkStatus = 'matched' | 'rehydrated' | 'not_found' | 'none'

export interface ActiveDynamicContextState {
  rowIds: string[]
  matchedUrl: string | null
  tableName?: string | null
  updatedAt: string
}

export interface ResolvedWhatsAppDynamicLinkContext {
  status: WhatsAppDynamicLinkStatus
  requestedUrls: string[]
  matchedRecords: MatchedDynamicLinkRecord[]
  matchedRowIds: string[]
  matchedUrl: string | null
  summaryText: string
  fieldPatch: Record<string, unknown>
  promptContext: string
  stepGuardNote: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function persistActiveDynamicContext(params: {
  clinicId: string
  conversationId: string
  state: ActiveDynamicContextState | null
}): Promise<void> {
  if (!UUID_RE.test(params.conversationId)) return
  try {
    await ensureWhatsAppSetupSchema()
    await db
      .update(whatsappConversations)
      .set({
        activeDynamicContext: params.state,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(whatsappConversations.id, params.conversationId),
          eq(whatsappConversations.clinicId, params.clinicId),
        ),
      )
  } catch (err) {
    console.warn('[persistActiveDynamicContext] Sohbet bağlamı kaydedilemedi:', err)
  }
}

async function loadExistingActiveDynamicContext(params: {
  clinicId: string
  conversationId: string
}): Promise<ActiveDynamicContextState | null> {
  if (!UUID_RE.test(params.conversationId)) return null
  try {
    await ensureWhatsAppSetupSchema()
    const [row] = await db
      .select({ activeDynamicContext: whatsappConversations.activeDynamicContext })
      .from(whatsappConversations)
      .where(
        and(
          eq(whatsappConversations.id, params.conversationId),
          eq(whatsappConversations.clinicId, params.clinicId),
        ),
      )
      .limit(1)
    return (row?.activeDynamicContext as ActiveDynamicContextState | null) ?? null
  } catch {
    return null
  }
}

function buildFieldPatchAndSummary(records: MatchedDynamicLinkRecord[]): {
  fieldPatch: Record<string, unknown>
  summaryText: string
} {
  const fieldPatch: Record<string, unknown> = {}
  // Preserve primary (most exact/recent) record values on conflicting table column keys
  for (let i = records.length - 1; i >= 0; i--) {
    Object.assign(fieldPatch, records[i].fieldPatch)
  }
  const summaryText = records
    .map(r => r.summaryLine)
    .filter(Boolean)
    .join('\n')
  return { fieldPatch, summaryText }
}

/**
 * WhatsApp mesajındaki linkleri Google/dış arama yapmadan doğrudan kiracının
 * dinamik veri tablolarında arar, eşleşen satırı konuşmaya sabitler (`active_dynamic_context`),
 * takip mesajlarında aynı satırı canlı veritabanından yeniden yükler ve
 * tabloda olmayan yeni bir link geldiğinde eski bağlamı temizler.
 */
export async function resolveWhatsAppDynamicLinkContext(params: {
  clinicId: string
  conversationId?: string | null
  incomingText: string
  existingActiveContext?: ActiveDynamicContextState | null
}): Promise<ResolvedWhatsAppDynamicLinkContext> {
  const empty: ResolvedWhatsAppDynamicLinkContext = {
    status: 'none',
    requestedUrls: [],
    matchedRecords: [],
    matchedRowIds: [],
    matchedUrl: null,
    summaryText: '',
    fieldPatch: {},
    promptContext: '',
    stepGuardNote: '',
  }

  if (!params.clinicId || params.clinicId === 'memory') return empty

  const incomingText = String(params.incomingText || '').trim()
  const requestedUrls = extractUrlsFromText(incomingText)

  if (requestedUrls.length > 0) {
    const matchedRecords = await findDynamicRecordsByLinkUrls(params.clinicId, requestedUrls)

    if (matchedRecords.length > 0) {
      const matchedRowIds = matchedRecords.map(r => r.rowId)
      const matchedUrl = matchedRecords[0].matchedUrl || requestedUrls[0]
      const nextState: ActiveDynamicContextState = {
        rowIds: matchedRowIds,
        matchedUrl,
        tableName: matchedRecords[0].tableName,
        updatedAt: new Date().toISOString(),
      }

      if (params.conversationId) {
        await persistActiveDynamicContext({
          clinicId: params.clinicId,
          conversationId: params.conversationId,
          state: nextState,
        })
      }

      const { fieldPatch, summaryText } = buildFieldPatchAndSummary(matchedRecords)
      return {
        status: 'matched',
        requestedUrls,
        matchedRecords,
        matchedRowIds,
        matchedUrl,
        summaryText,
        fieldPatch,
        promptContext: `\n\nGÖNDERİLEN LİNKE GÖRE EŞLEŞEN VERİ TABLOSU KAYDI (CANLI VERİTABANI — Yalnızca bu gerçek satırdaki bilgileri kullan; tabloda olmayan bilgileri Google'dan arama veya uydurma):\n${summaryText}`,
        stepGuardNote:
          'Kullanıcı bu mesajda bir ilan/kayıt linki paylaştı ve sistemdeki tablo kaydıyla eşleşti. Önce yukarıdaki eşleşen canlı satır verilerine göre sorusunu (fiyat, özellik, durum vb.) doğrudan yanıtla; ardından gerekiyorsa kısa bir sonraki adımı sor. URL/link metnini asla Ad Soyad veya isim alanına kaydetme.',
      }
    }

    // New link did not match any row in tenant's tables: clear any stale pinned listing
    if (params.conversationId && params.existingActiveContext?.rowIds?.length) {
      await persistActiveDynamicContext({
        clinicId: params.clinicId,
        conversationId: params.conversationId,
        state: null,
      })
    } else if (params.conversationId && params.existingActiveContext === undefined) {
      await persistActiveDynamicContext({
        clinicId: params.clinicId,
        conversationId: params.conversationId,
        state: null,
      })
    }

    return {
      status: 'not_found',
      requestedUrls,
      matchedRecords: [],
      matchedRowIds: [],
      matchedUrl: null,
      summaryText: '',
      fieldPatch: {},
      promptContext: `\n\nGÖNDERİLEN LİNK VERİ TABLOLARINDA ARANDI (EŞLEŞME BULUNAMADI):\nKullanıcının paylaştığı link (${requestedUrls.join(', ')}) sistemdeki veri tablolarında kayıtlı değil. Google araması yapma, dış kaynaklardan tahmin yürütme veya portföydeki başka bir kaydın bilgilerini bu linkmiş gibi sunma. Kullanıcıya bu linke ait bir kayıt/ilan bulunamadığını nazikçe bildir.`,
      stepGuardNote:
        'Kullanıcının paylaştığı link tablolarda bulunamadı. Önce nazikçe bu linke ait kayıt/ilan bulunamadığını söyle; asla başka bir satırı uydurma ve URL metnini Ad Soyad/isim alanına kaydetme.',
    }
  }

  // No URL in this turn -> rehydrate pinned row from earlier turn if available
  const existingState =
    params.existingActiveContext !== undefined
      ? params.existingActiveContext
      : params.conversationId
        ? await loadExistingActiveDynamicContext({
            clinicId: params.clinicId,
            conversationId: params.conversationId,
          })
        : null

  const prevRowIds = Array.isArray(existingState?.rowIds) ? existingState.rowIds.filter(Boolean) : []
  if (prevRowIds.length === 0) return empty

  const rehydrated = await loadDynamicRecordsByRowIds(params.clinicId, prevRowIds)
  if (rehydrated.length === 0) {
    if (params.conversationId) {
      await persistActiveDynamicContext({
        clinicId: params.clinicId,
        conversationId: params.conversationId,
        state: null,
      })
    }
    return empty
  }

  const { fieldPatch, summaryText } = buildFieldPatchAndSummary(rehydrated)
  return {
    status: 'rehydrated',
    requestedUrls: [],
    matchedRecords: rehydrated,
    matchedRowIds: rehydrated.map(r => r.rowId),
    matchedUrl: existingState?.matchedUrl ?? rehydrated[0].matchedUrl ?? null,
    summaryText,
    fieldPatch,
    promptContext: `\n\nSOHBETTE DAHA ÖNCE LİNKLE SEÇİLMİŞ AKTİF VERİ TABLOSU KAYDI (CANLI VERİTABANI — Takip sorularını bu güncel satır bilgilerine göre yanıtla; tabloda olmayan detayı uydurma):\n${summaryText}`,
    stepGuardNote:
      'Kullanıcı önceki mesajda linkle açtığı aktif kayıt hakkında takip sorusu soruyor olabilir; önce yukarıdaki canlı kayıt bilgilerine göre sorusunu yanıtla, ardından gerekiyorsa akış sorusuna geç.',
  }
}

export async function prepareWhatsAppTurnContext(params: {
  clinicId: string
  conversationId: string
  incomingText: string
  phone?: string | null
  patientId?: string | null
  isVagueOpening: boolean
  existingActiveContext?: ActiveDynamicContextState | null
  stepPromptPrefix?: string
}): Promise<{
  waEngine: FlowEngine | null
  flowStepInstruction: string
  dynamicProfileContext: string
  linkContext: ResolvedWhatsAppDynamicLinkContext | null
}> {
  let flowStepInstruction = ''
  let dynamicProfileContext = ''
  let waEngine: FlowEngine | null = null

  const [dynFields, linkContext] = await Promise.all([
    params.phone
      ? lookupDynamicFieldsByPhone(params.phone, params.clinicId).catch((): Record<string, unknown> => ({}))
      : Promise.resolve({} as Record<string, unknown>),
    resolveWhatsAppDynamicLinkContext({
      clinicId: params.clinicId,
      conversationId: params.conversationId,
      incomingText: params.incomingText,
      existingActiveContext: params.existingActiveContext,
    }).catch(() => null),
  ])

  if (typeof dynFields._dynamicSummary === 'string' && dynFields._dynamicSummary.trim()) {
    dynamicProfileContext += `\n\nGÖNDERİCİNİN VERİ TABLOSU KAYITLARI (CANLI VERİTABANI — Koşul ve bilgilendirme adımlarında dikkate al):\n${dynFields._dynamicSummary.trim()}`
  }
  if (linkContext?.promptContext) {
    dynamicProfileContext += linkContext.promptContext
  }

  const isKnown = Boolean(params.patientId || dynFields._dynamicKnownCaller === 'true')
  if (!params.isVagueOpening) {
    waEngine = await getOrCreateWhatsAppFlowEngine({
      clinicId: params.clinicId,
      conversationId: params.conversationId,
      phone: params.phone ?? undefined,
      initialFields: {
        ...dynFields,
        ...(linkContext?.fieldPatch || {}),
        ...(params.phone ? { telefon: params.phone } : {}),
        ...(isKnown ? { kayitli: 'true', 'caller.isKnownPatient': 'true' } : {}),
        ...(typeof dynFields._dynamicCallerName === 'string' ? { musteri_adi: dynFields._dynamicCallerName } : {}),
      },
    })
    if (waEngine) {
      const step = await waEngine.accept({
        fields: {
          ...(linkContext?.fieldPatch || {}),
          son_mesaj: params.incomingText,
          ...(params.phone ? { telefon: params.phone } : {}),
        },
        eventTrigger: 'on_whatsapp_message',
      })
      if (step.next?.prompt) {
        const prefix =
          params.stepPromptPrefix ||
          'Sıradaki Akış Adımı Görevi:'
        flowStepInstruction = `\n${prefix} ${step.next.prompt}\n(Kullanıcı doğrudan konuya girdi; sabit karşılama cümlesini YAZMA, varsa kullanıcı mesajındaki bilgiyi önce akisBilgisiGuncelle aracını çağırarak kaydet ve doğrudan bu adımı uygula.)`
      }
      if (linkContext?.stepGuardNote) {
        flowStepInstruction = flowStepInstruction
          ? `${flowStepInstruction}\n(${linkContext.stepGuardNote})`
          : `\n(${linkContext.stepGuardNote})`
      }
      if (step.completed) {
        await releaseWhatsAppFlowEngine(params.clinicId, params.conversationId)
      }
    } else if (linkContext?.stepGuardNote) {
      flowStepInstruction = `\n(${linkContext.stepGuardNote})`
    }
  } else {
    const savedWaGreeting =
      (await getGreeting('whatsapp', params.clinicId).catch(() => null))?.trim() ||
      'Merhaba, hoş geldiniz! Size nasıl yardımcı olabilirim?'
    flowStepInstruction = `\nKullanıcı henüz somut bir talep belirtmedi (yalnızca selam veya belirsiz bir mesaj yazdı). Akış sorusuna geçmeden önce yalnızca şu karşılama mesajını gönder: "${savedWaGreeting}"`
  }

  return { waEngine, flowStepInstruction, dynamicProfileContext, linkContext }
}
