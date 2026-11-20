import { randomUUID } from 'crypto'
import { db } from '../db/client'
import { flowSessions } from '../db/schema'
import { isRemovedWebhookAction } from './flow-validation'
import {
  evaluateConditionNode,
  getActiveFlow,
  getTransferPromptConfig,
  injectFlowSystemVariables,
  renderFlowTemplate,
  validateConversationFlow,
  type ConversationFlow,
  type FlowEdge,
  type FlowEventTrigger,
  type FlowNode,
} from '../db/repositories/flows'
import { getSetting } from '../db/repositories/settings'
import {
  hydrateDynamicConditionLookups,
  lookupDynamicFieldsByPhone,
  saveFlowDynamicRecord,
} from '../db/repositories/dynamic-tables'
import { normalizeAppointmentDate, normalizeAppointmentTime } from './assistant-appointments'

export type FlowRuntimeMode = 'legacy' | 'observe' | 'active'
export type FlowChannel = 'web_direct' | 'web_socket' | 'phone' | 'whatsapp'

export type FlowEngineEvent = {
  id?: string
  revision?: number
  fields?: Record<string, unknown>
  intent?: 'continue' | 'end' | 'new_person'
  eventTrigger?: FlowEventTrigger
}

export type FlowEngineResult = {
  success: boolean
  revision: number
  fields: Record<string, unknown>
  next?: { nodeId: string; type: FlowNode['type']; prompt?: string }
  completed?: boolean
  message?: string
  replayed?: boolean
}

type StoredState = {
  flow: ConversationFlow
  currentNodeId?: string
  fields: Record<string, unknown>
  handledEvents: Record<string, FlowEngineResult>
  completedActions: string[]
  savedDynamicRecord?: boolean
  hydratedPhoneDigits?: string
}

function extractPhoneDigitsFromFields(fields: Record<string, unknown> = {}): string {
  const candidate =
    fields.telefon ??
    Object.entries(fields).find(([k, v]) => v !== undefined && v !== null && /__(telefon|tel|gsm|cep)/i.test(k))?.[1]
  const digits = String(candidate ?? '').replace(/\D/g, '').slice(-10)
  return digits.length === 10 ? digits : ''
}

function isPreservedInternalDynamicKey(key: string): boolean {
  return (
    key.startsWith('_col__') ||
    key.startsWith('_tbl_exists__') ||
    key.startsWith('_col_exists__') ||
    key.startsWith('_exists__')
  )
}

function hasPrehydratedDynamicFields(fields: Record<string, unknown> = {}): boolean {
  return Boolean(
    fields._dynamicKnownCaller !== undefined ||
    fields._dynamicSummary !== undefined ||
    Object.keys(fields).some(k => k.startsWith('_col__')),
  )
}

function cleanFields(fields: Record<string, unknown> = {}, flowNodes?: FlowNode[]) {
  const out = Object.fromEntries(Object.entries(fields).filter(([key, value]) => {
    if (!key || (key.startsWith('_') && !isPreservedInternalDynamicKey(key)) || value === undefined || value === null) return false
    if (Array.isArray(value)) return value.length > 0
    return typeof value !== 'string' || value.trim().length > 0
  }))
  if (fields._dynamicKnownCaller === 'true') {
    out.kayitli ??= 'true'
  }
  if (typeof fields._dynamicCallerName === 'string' && fields._dynamicCallerName.trim()) {
    out.musteri_adi ??= fields._dynamicCallerName.trim()
  }
  if (typeof out.tarih === 'string') out.tarih = normalizeAppointmentDate(out.tarih)
  if (typeof out.saat === 'string') out.saat = normalizeAppointmentTime(out.saat)

  if (Array.isArray(flowNodes)) {
    for (const n of flowNodes) {
      if (n.type !== 'FIELD' || !n.data.fieldName) continue
      const fn = n.data.fieldName
      if (n.data.fieldType === 'date' && typeof out[fn] === 'string') {
        out[fn] = normalizeAppointmentDate(out[fn] as string)
      } else if (n.data.fieldType === 'time' && typeof out[fn] === 'string') {
        out[fn] = normalizeAppointmentTime(out[fn] as string)
      }
    }
  }

  // Dinamik tablo sütunlarından gelen değerleri standart randevu/not alanlarına yedek olarak aktar
  for (const [k, v] of Object.entries(out)) {
    if (!k.includes('__') || v === undefined || v === null) continue
    const colPart = k.split('__').slice(1).join('__').toLowerCase()
    if (/^(ad_soyad|musteri_adi|hasta_adi|isim)$/.test(colPart)) {
      out.musteri_adi ??= v
      out.ad_soyad ??= v
    } else if (/^(telefon|tel|gsm|cep_telefonu)$/.test(colPart)) {
      out.telefon ??= v
    } else if (/^(sikayet|hasta_sikayeti|talep|islem_turu)$/.test(colPart)) {
      out.sikayet ??= v
    } else if (/^(tarih|randevu_tarihi)$/.test(colPart) && typeof v === 'string') {
      out.tarih ??= normalizeAppointmentDate(v)
    } else if (/^(saat|randevu_saati)$/.test(colPart) && typeof v === 'string') {
      out.saat ??= normalizeAppointmentTime(v)
    } else if (/^(not|notlar|hasta_notu|yorum|aciklama)$/.test(colPart)) {
      out.hastaNotu ??= v
    }
  }

  const nameVal = out.musteri_adi || out.ad_soyad || out.hasta_adi
  if (nameVal) {
    out.musteri_adi ??= nameVal
    out.ad_soyad ??= nameVal
  }
  const complaintVal = out.sikayet || out.hasta_sikayeti || out.talep || out.islem_turu || out.randevu_turu || out.sorun_veya_talep || out.notlar || out.not || out.hastaNotu || out.complaint
  if (complaintVal) {
    out.sikayet ??= complaintVal
    out.islem_turu ??= complaintVal
    out.randevu_turu ??= complaintVal
  }
  return out
}

function edgesFrom(edges: FlowEdge[], nodeId: string) { return edges.filter(edge => edge.source === nodeId) }

function validField(node: FlowNode, fields: Record<string, unknown>) {
  const name = node.data.fieldName || ''
  const rawVal = fields[name] ?? (node.data.sourceColumnId ? fields[`_col__${node.data.sourceColumnId}`] : undefined)
  if (Array.isArray(rawVal)) return rawVal.length > 0
  const raw = String(rawVal ?? '').trim()
  if (!raw) return false
  if (node.data.fieldType === 'date' || name === 'tarih') return /^\d{4}-\d{2}-\d{2}$/.test(normalizeAppointmentDate(raw))
  if (node.data.fieldType === 'time' || name === 'saat') return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalizeAppointmentTime(raw))
  if (node.data.fieldType === 'phone' || name === 'telefon') return raw.replace(/\D/g, '').length >= 10
  if (node.data.fieldType === 'number') {
    const cleaned = raw.replace(/[₺$€£%\s]/g, '')
    return Number.isFinite(Number(cleaned.replace(/\./g, '').replace(',', '.'))) || Number.isFinite(Number(cleaned.replace(',', '.')))
  }
  if (node.data.fieldType === 'boolean') {
    return ['true', 'false', 'evet', 'hayır', 'hayir', '1', '0', 'var', 'yok'].includes(raw.toLocaleLowerCase('tr-TR'))
  }
  return true
}

function hasCompletedDownstreamField(flow: ConversationFlow, startNodeId: string, fields: Record<string, unknown>): boolean {
  const visited = new Set<string>()
  const queue = [startNodeId]
  while (queue.length > 0) {
    const curr = queue.shift()!
    if (visited.has(curr)) continue
    visited.add(curr)
    for (const edge of edgesFrom(flow.edges, curr)) {
      const target = flow.nodes.find(n => n.id === edge.target)
      if (!target) continue
      if (target.type === 'FIELD' && validField(target, fields)) return true
      queue.push(target.id)
    }
  }
  return false
}

export function buildFlowNodePrompt(
  flow: ConversationFlow,
  node: FlowNode,
  fields: Record<string, unknown> = {},
): string | undefined {
  if (node.type === 'FIELD') {
    const nextEdge = edgesFrom(flow.edges, node.id)[0]
    const nextNode = nextEdge ? flow.nodes.find(n => n.id === nextEdge.target) : undefined
    if (
      node.data.fieldName === 'tarih' &&
      nextNode?.type === 'FIELD' &&
      nextNode.data.fieldName === 'saat' &&
      !validField(nextNode, fields)
    ) {
      return 'Hangi gün ve saat için randevu oluşturmamı istersiniz? (Bu soruyu sorduktan sonra DUR ve müşterinin konuşmasını/cevabını bekle; cevap almadan sıradaki adıma geçme.)'
    }
    const extractFieldSlug = (fn?: string, colSlug?: string) =>
      String(colSlug || (fn && fn.includes('__') ? fn.split('__').pop() : fn) || '')
    const isDynamicNamePhonePair =
      !node.data.description &&
      Boolean(node.data.sourceTableId) &&
      /(ad_soyad|adsoyad|musteri_adi|hasta_adi|isim|^ad$)/i.test(extractFieldSlug(node.data.fieldName, node.data.sourceColumnSlug)) &&
      nextNode?.type === 'FIELD' &&
      !nextNode.data.description &&
      (nextNode.data.fieldType === 'phone' ||
        /(telefon|phone|gsm|cep)/i.test(extractFieldSlug(nextNode.data.fieldName, nextNode.data.sourceColumnSlug))) &&
      !validField(nextNode, fields)
    if (
      ((node.data.fieldName === 'musteri_adi' &&
        nextNode?.type === 'FIELD' &&
        nextNode.data.fieldName === 'telefon' &&
        !validField(nextNode, fields)) ||
        isDynamicNamePhonePair)
    ) {
      return 'Randevunuz için adınızı, soyadınızı ve telefon numaranızı alabilir miyim? (Bu soruyu sorduktan sonra DUR ve müşterinin konuşmasını/cevabını bekle; cevap almadan sıradaki adıma geçme.)'
    }
    const readableTarget =
      node.data.sourceTableName && node.data.sourceColumnName
        ? `${node.data.sourceTableName} · ${node.data.sourceColumnName}`
        : node.data.label || node.data.fieldName || 'Bu bilgiyi'
    const base = node.data.description || `${readableTarget} bilgisini kullanıcıdan kısa ve açık biçimde iste.`
    return `${base} (Bu soruyu sorduktan sonra DUR ve müşterinin konuşmasını/cevabını bekle; cevap almadan sıradaki adıma geçme.)`
  }
  if (node.type === 'END') return node.data.message || 'Görüşmeyi kısa ve nazikçe tamamla.'
  if (node.type === 'ACTION') {
    const act = String(node.data.action || '')
    if (act === 'wait_reprompt' || act === 'wait') {
      return renderFlowTemplate(node.data.message || 'Sizi dinliyorum, nasıl yardımcı olabilirim?', fields)
    }
    if (act === 'switch_prompt') {
      return renderFlowTemplate(node.data.promptInstruction || node.data.message || '', fields)
    }
    if (act === 'transfer_call' || act === 'transfer') {
      const { target, requiresConfirmation, questionInstruction } = getTransferPromptConfig(node.data as Record<string, unknown>)
      const confirmAskedKey = `_transferConfirmAsked_${node.id}`
      if (requiresConfirmation && fields[confirmAskedKey] !== 'true') {
        return `Önce kullanıcıya ${questionInstruction} ve müşterinin cevabını bekle. Açıkça olumlu cevap gelirse aramaAktar aracını "hedef": "${target || 'resepsiyon'}" parametresiyle çağır.`
      }
      return `Şimdi aramaAktar aracını "hedef": "${target || 'resepsiyon'}" parametresiyle çağır ve aramayı yetkili birime aktar.`
    }
    if (act === 'save_appointment_pending' || act === 'randevuOlustur') {
      return 'Tüm randevu bilgileri tamamlandı. Şimdi randevuOlustur aracını çağırarak randevuyu kaydet.'
    }
    if (act === 'save_patient_note' || act === 'notBirak') {
      return 'Şimdi hastaNotKaydet aracını çağırarak müşterinin notunu veya mesajını kaydet.'
    }
    if (act === 'send_wa_location') {
      return 'Şimdi whatsappKonumGonder aracını çağırarak işletmenin konumunu arayan numaraya WhatsApp üzerinden gönder.'
    }
    if (act === 'send_wa_message') {
      const msg = renderFlowTemplate(String(node.data.message || ''), fields)
      return msg ? `Müşteriye şu mesajı ilet: "${msg}".` : 'Müşteriye bilgilendirme mesajını ilet.'
    }
    if (act === 'send_sms') {
      const msg = renderFlowTemplate(String(node.data.message || ''), fields)
      return msg ? `Müşteriye "${msg}" içerikli bilgilendirme SMS'inin gönderildiğini belirt.` : 'Müşteriye bilgilendirme SMS\'inin gönderildiğini belirt.'
    }
    if (act === 'end_call') {
      const msg = renderFlowTemplate(String(node.data.message || ''), fields)
      if (fields['call.channel'] === 'whatsapp' || fields['call.direction'] === 'whatsapp') {
        return msg
          ? `Müşteriye "${msg}" mesajını ileterek yazılı görüşmeyi kısa ve nazikçe tamamla.`
          : 'Yazılı görüşmeyi kısa ve nazikçe tamamla.'
      }
      return `${msg ? `"${msg}" diyerek ` : ''}cagriySonlandir aracını çağır ve görüşmeyi sonlandır.`
    }
    if (act === 'save_record') {
      return 'Toplanan tablo verileri kaydedildi; sıradaki adıma devam et.'
    }
  }
  return undefined
}

export async function resolveFlowRuntimeMode(clinicId?: string, direction?: string): Promise<FlowRuntimeMode> {
  const dir = direction && ['inbound', 'outbound', 'whatsapp', 'web'].includes(direction)
    ? direction
    : undefined
  if (dir) {
    const channelVal = await getSetting(`ai.flow_runtime_mode.${dir}`, clinicId).catch(() => null)
    if (channelVal === 'legacy' || channelVal === 'observe' || channelVal === 'active') {
      return channelVal
    }
  }
  const value = await getSetting('ai.flow_runtime_mode', clinicId).catch(() => null)
  return value === 'active' || value === 'observe' ? value : 'legacy'
}

export class FlowEngine {
  private state: StoredState
  private revision = 0
  private chain: Promise<unknown> = Promise.resolve()
  private persistChain: Promise<unknown> = Promise.resolve()
  private skipPersist = false
  readonly id: string
  readonly mode: FlowRuntimeMode
  readonly channel: FlowChannel
  readonly direction: string
  readonly clinicId: string

  private constructor(args: { id: string; state: StoredState; mode: FlowRuntimeMode; channel: FlowChannel; direction: string; clinicId: string; skipPersist?: boolean }) {
    this.id = args.id; this.state = args.state; this.mode = args.mode; this.channel = args.channel; this.direction = args.direction; this.clinicId = args.clinicId; this.skipPersist = Boolean(args.skipPersist)
  }

  static fromMemory(flow: ConversationFlow, opts?: { direction?: string; channel?: FlowChannel; mode?: FlowRuntimeMode; initialFields?: Record<string, unknown> }) {
    const direction = opts?.direction || 'inbound'
    const channel = opts?.channel || 'phone'
    const mode = opts?.mode || 'active'
    const start = flow.nodes.find(node => node.type === 'START')
    const initialWithSys = injectFlowSystemVariables(cleanFields(opts?.initialFields, flow.nodes), {
      direction,
      channel,
    })
    return new FlowEngine({
      id: randomUUID(),
      mode,
      channel,
      direction,
      clinicId: 'memory',
      skipPersist: true,
      state: { flow: structuredClone(flow), currentNodeId: start?.id, fields: initialWithSys, handledEvents: {}, completedActions: [] },
    })
  }

  static async create(args: { clinicId: string; direction: string; channel: FlowChannel; mode?: FlowRuntimeMode; initialFields?: Record<string, unknown> }) {
    const [flow, resolvedMode] = await Promise.all([
      getActiveFlow(args.direction, args.clinicId),
      args.mode ? Promise.resolve(args.mode) : resolveFlowRuntimeMode(args.clinicId, args.direction),
    ])
    if (!flow) return null
    const validation = validateConversationFlow(flow.nodes, flow.edges)
    if (validation.some(issue => issue.level === 'error')) return null
    const mode = args.mode || resolvedMode
    if (mode === 'legacy') return null
    const start = flow.nodes.find(node => node.type === 'START')
    const initialWithSys = injectFlowSystemVariables(cleanFields(args.initialFields, flow.nodes), {
      direction: args.direction,
      channel: args.channel,
    })
    const prehydratedDigits = hasPrehydratedDynamicFields(args.initialFields)
      ? extractPhoneDigitsFromFields(initialWithSys) || undefined
      : undefined
    const engine = new FlowEngine({
      id: randomUUID(), mode, channel: args.channel, direction: args.direction, clinicId: args.clinicId,
      state: {
        flow: structuredClone(flow),
        currentNodeId: start?.id,
        fields: initialWithSys,
        handledEvents: {},
        completedActions: [],
        savedDynamicRecord: false,
        hydratedPhoneDigits: prehydratedDigits,
      },
    })
    engine.schedulePersist('active')
    return engine
  }

  private async persistSnapshot(status: string, revision: number, stateSnapshot: StoredState) {
    if (this.skipPersist) return
    const expiresAt = new Date(Date.now() + 35 * 60_000)
    await db.insert(flowSessions).values({
      id: this.id, clinicId: this.clinicId, direction: this.direction, channel: this.channel, flowId: stateSnapshot.flow.id,
      status, revision, state: stateSnapshot, expiresAt, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: flowSessions.id,
      set: { status, revision, state: stateSnapshot, expiresAt, updatedAt: new Date() },
    }).catch(error => console.error('[FlowEngine] durum kaydedilemedi:', error))
  }

  private schedulePersist(status = 'active') {
    if (this.skipPersist) return
    const revision = this.revision
    const snapshot = structuredClone(this.state)
    const run = () => this.persistSnapshot(status, revision, snapshot)
    this.persistChain = this.persistChain.then(run, run)
  }

  private node() { return this.state.flow.nodes.find(node => node.id === this.state.currentNodeId) }

  getFlow(): ConversationFlow {
    return this.state.flow
  }

  getFields(): Record<string, unknown> {
    return { ...this.state.fields }
  }

  hasSavedDynamicRecord(): boolean {
    return Boolean(this.state.savedDynamicRecord)
  }

  private async hydrateDynamicCallerIfNeeded() {
    if (!this.clinicId || this.clinicId === 'memory' || this.skipPersist) return
    const digits = extractPhoneDigitsFromFields(this.state.fields)
    if (!digits || this.state.hydratedPhoneDigits === digits) return
    this.state.hydratedPhoneDigits = digits
    const hydrated = await lookupDynamicFieldsByPhone(digits, this.clinicId).catch((): Record<string, unknown> => ({}))
    if (hydrated._dynamicKnownCaller === 'true' && this.state.fields.kayitli === undefined) {
      this.state.fields.kayitli = 'true'
    }
    if (typeof hydrated._dynamicCallerName === 'string' && hydrated._dynamicCallerName.trim()) {
      this.state.fields.musteri_adi ??= hydrated._dynamicCallerName.trim()
      this.state.fields.ad_soyad ??= hydrated._dynamicCallerName.trim()
    }
    for (const [hk, hv] of Object.entries(hydrated)) {
      if (!hk || (hk.startsWith('_') && !isPreservedInternalDynamicKey(hk)) || hv === undefined || hv === null) continue
      const isExistsFlag = hk.endsWith('____kayitli') || hk.startsWith('_tbl_exists__')
      if (this.state.fields[hk] === undefined || (isExistsFlag && hv === 'true')) {
        this.state.fields[hk] = hv
      }
    }
  }

  expectedAction() {
    const node = this.node()
    return node?.type === 'ACTION' ? { nodeId: node.id, action: String(node.data.action || '') } : undefined
  }

  isTransferConfirmationAsked(nodeId?: string): boolean {
    if (nodeId) return this.state.fields[`_transferConfirmAsked_${nodeId}`] === 'true'
    const current = this.node()
    if (current && this.state.fields[`_transferConfirmAsked_${current.id}`] === 'true') return true
    return Object.keys(this.state.fields).some(k => k.startsWith('_transferConfirmAsked_') && this.state.fields[k] === 'true')
  }

  private next(edge?: FlowEdge) { this.state.currentNodeId = edge?.target }

  private promptFor(node: FlowNode) {
    return buildFlowNodePrompt(this.state.flow, node, this.state.fields)
  }

  private async advance(): Promise<FlowEngineResult> {
    this.state.fields = injectFlowSystemVariables(this.state.fields, {
      direction: this.direction,
      channel: this.channel,
    })

    for (let guard = 0; guard < this.state.flow.nodes.length + 2; guard += 1) {
      const node = this.node()
      if (!node) return { success: false, revision: this.revision, fields: this.state.fields, message: 'Akışın devam edeceği adım bulunamadı.' }
      if (node.type === 'START') { this.next(edgesFrom(this.state.flow.edges, node.id)[0]); continue }
      if (node.type === 'FIELD') {
        if (!validField(node, this.state.fields)) {
          const isOptional = node.data.required === false
          if (isOptional && hasCompletedDownstreamField(this.state.flow, node.id, this.state.fields)) {
            this.next(edgesFrom(this.state.flow.edges, node.id)[0])
            continue
          }
          return { success: true, revision: this.revision, fields: this.state.fields, next: { nodeId: node.id, type: node.type, prompt: this.promptFor(node) } }
        }
        this.next(edgesFrom(this.state.flow.edges, node.id)[0]); continue
      }
      if (node.type === 'CONDITION') {
        if (this.clinicId && this.clinicId !== 'memory' && !this.skipPersist) {
          const condPatch = await hydrateDynamicConditionLookups({
            clinicId: this.clinicId,
            node,
            fields: this.state.fields,
          }).catch((): Record<string, unknown> => ({}))
          for (const [ck, cv] of Object.entries(condPatch)) {
            if (cv === undefined || cv === null) continue
            if (this.state.fields[ck] === undefined) {
              this.state.fields[ck] = cv
            }
          }
        }
        const matched = evaluateConditionNode(node, this.state.fields, undefined, {
          direction: this.direction,
          channel: this.channel,
        })
        const branch = matched ? 'true' : 'false'
        this.next(edgesFrom(this.state.flow.edges, node.id).find(edge => edge.sourceHandle === branch)); continue
      }
      if (node.type === 'ACTION') {
        const act = String(node.data.action || '')
        if (!this.state.completedActions.includes(node.id)) {
          if (act === 'set_variable') {
            const varName = String(node.data.variableName || '').trim()
            if (varName) {
              this.state.fields[varName] = renderFlowTemplate(String(node.data.variableValue ?? ''), this.state.fields)
            }
            this.state.completedActions.push(node.id)
            this.next(edgesFrom(this.state.flow.edges, node.id)[0])
            continue
          }
          if (act === 'switch_prompt') {
            const instr = renderFlowTemplate(String(node.data.promptInstruction || node.data.message || ''), this.state.fields)
            if (instr) this.state.fields['activePromptOverride'] = instr
            this.state.completedActions.push(node.id)
            this.next(edgesFrom(this.state.flow.edges, node.id)[0])
            continue
          }
          if (act === 'save_record') {
            if (this.mode === 'observe') {
              return {
                success: true,
                revision: this.revision,
                fields: this.state.fields,
                next: { nodeId: node.id, type: node.type, prompt: this.promptFor(node) },
                message: 'Akış bu adımda veri tablosuna kayıt yapacaktı.',
              }
            }
            if (this.clinicId && this.clinicId !== 'memory' && !this.skipPersist) {
              const saved = await saveFlowDynamicRecord({
                clinicId: this.clinicId,
                fields: this.state.fields,
                targetTableId: node.data.targetTableId,
                flowNodes: this.state.flow.nodes,
              })
              if (saved.savedCount > 0) {
                this.state.savedDynamicRecord = true
              }
            }
            this.state.completedActions.push(node.id)
            const outEdge = edgesFrom(this.state.flow.edges, node.id)[0]
            if (!outEdge) {
              return { success: true, revision: this.revision, fields: this.state.fields, completed: true }
            }
            this.next(outEdge)
            continue
          }
          if (isRemovedWebhookAction(node)) {
            // Kaldırılan eski akış webhook'u: çalışma anında pas geçilir (DB'ye dokunulmaz).
            console.warn(`[FlowEngine] Kaldırılmış 'webhook' işlemi pas geçildi (node: ${node.id})`)
            this.state.completedActions.push(node.id)
            const outEdge = edgesFrom(this.state.flow.edges, node.id)[0]
            if (!outEdge) {
              return { success: true, revision: this.revision, fields: this.state.fields, completed: true }
            }
            this.next(outEdge)
            continue
          }
          if (act === 'wait_reprompt' || act === 'wait' || act === 'send_sms' || act === 'send_wa_message') {
            this.state.completedActions.push(node.id)
            return {
              success: true,
              revision: this.revision,
              fields: this.state.fields,
              next: { nodeId: node.id, type: node.type, prompt: this.promptFor(node) },
            }
          }
        }
        if (this.mode === 'observe') return { success: true, revision: this.revision, fields: this.state.fields, next: { nodeId: node.id, type: node.type, prompt: this.promptFor(node) }, message: 'Akış bu adımda bir işlem yapacaktı.' }
        if (!this.state.completedActions.includes(node.id)) {
          const prompt = this.promptFor(node)
          if ((act === 'transfer_call' || act === 'transfer') && node.data.requireConfirmation !== false) {
            this.state.fields[`_transferConfirmAsked_${node.id}`] = 'true'
          }
          return { success: true, revision: this.revision, fields: this.state.fields, next: { nodeId: node.id, type: node.type, prompt } }
        }
        this.next(edgesFrom(this.state.flow.edges, node.id)[0]); continue
      }
      if (node.type === 'END') return { success: true, revision: this.revision, fields: this.state.fields, completed: true, next: { nodeId: node.id, type: node.type, prompt: this.promptFor(node) } }
    }
    return { success: false, revision: this.revision, fields: this.state.fields, message: 'Akışta tamamlanamayan bir döngü var.' }
  }

  async accept(event: FlowEngineEvent): Promise<FlowEngineResult> {
    const run = async () => {
      const eventId = event.id || randomUUID()
      const replay = this.state.handledEvents[eventId]
      if (replay) return { ...replay, replayed: true }
      if (event.revision !== undefined && event.revision !== this.revision) return { success: false, revision: this.revision, fields: this.state.fields, message: 'Bu görüşme adımı güncel değil.' }
      if (event.intent === 'new_person') {
        this.state.fields = {}
        this.state.completedActions = []
        this.state.savedDynamicRecord = false
        this.state.hydratedPhoneDigits = undefined
        const start = this.state.flow.nodes.find(node => node.type === 'START')
        this.state.currentNodeId = start?.id
      }
      if (event.eventTrigger) {
        const startNode = this.state.flow.nodes.find(n => n.type === 'START')
        const shouldJump =
          event.eventTrigger !== 'on_whatsapp_message' ||
          this.revision === 0 ||
          this.state.currentNodeId === startNode?.id
        if (shouldJump) {
          const triggerNode = this.state.flow.nodes.find(n => n.type === 'ACTION' && n.data.eventTrigger === event.eventTrigger)
          if (triggerNode) {
            this.state.currentNodeId = triggerNode.id
          }
        }
      }
      this.state.fields = { ...this.state.fields, ...cleanFields(event.fields, this.state.flow.nodes) }
      await this.hydrateDynamicCallerIfNeeded()
      const result = await this.advance()
      this.revision += 1
      const committed = { ...result, revision: this.revision }
      this.state.handledEvents[eventId] = committed
      if (Object.keys(this.state.handledEvents).length > 50) delete this.state.handledEvents[Object.keys(this.state.handledEvents)[0]]
      this.schedulePersist(committed.completed ? 'completed' : 'active')
      return committed
    }
    const queued = this.chain.then(run, run) as Promise<FlowEngineResult>
    this.chain = queued.then(() => undefined, () => undefined)
    return queued
  }

  async completeAction(nodeId: string, success: boolean, message?: string): Promise<FlowEngineResult> {
    const node = this.node()
    if (!node || node.id !== nodeId || node.type !== 'ACTION') return { success: false, revision: this.revision, fields: this.state.fields, message: 'Bu işlem görüşmenin mevcut adımına ait değil.' }
    if (!success) return { success: false, revision: this.revision, fields: this.state.fields, message: message || 'İşlem tamamlanamadı.' }
    if (node.data.action === 'save_record') this.state.savedDynamicRecord = true
    if (!this.state.completedActions.includes(nodeId)) this.state.completedActions.push(nodeId)
    this.next(edgesFrom(this.state.flow.edges, node.id)[0])
    const result = await this.advance(); this.revision += 1; this.schedulePersist(result.completed ? 'completed' : 'active')
    return { ...result, revision: this.revision }
  }

  async close() {
    this.schedulePersist('closed')
    await this.persistChain
  }
}

const liveEngines = new Map<string, FlowEngine>()
const webSessionKeys = new Map<string, string>()
const webToolSessionKeys = new Map<string, { clinicId: string; expiresAt: number }>()
const WEB_TOOL_KEY_TTL_MS = 2 * 60 * 60_000

export function issueWebToolSessionKey(clinicId: string): string {
  const now = Date.now()
  if (webToolSessionKeys.size > 500) {
    for (const [k, v] of webToolSessionKeys) {
      if (v.expiresAt <= now) webToolSessionKeys.delete(k)
    }
  }
  const token = randomUUID() + randomUUID().replace(/-/g, '')
  webToolSessionKeys.set(token, { clinicId, expiresAt: now + WEB_TOOL_KEY_TTL_MS })
  return token
}

export function isAuthorizedWebToolSession(clinicId: string, token: string | undefined): boolean {
  if (!token || !clinicId) return false
  const now = Date.now()
  const standalone = webToolSessionKeys.get(token)
  if (standalone) {
    if (standalone.expiresAt <= now) {
      webToolSessionKeys.delete(token)
      return false
    }
    if (standalone.clinicId === clinicId) return true
  }
  for (const [engineId, expectedToken] of webSessionKeys) {
    if (expectedToken === token) {
      const engine = liveEngines.get(engineId)
      if (engine && engine.clinicId === clinicId) return true
    }
  }
  return false
}

export function keepFlowEngine(engine: FlowEngine) { liveEngines.set(engine.id, engine); return engine }
export function getFlowEngine(id: string) { return liveEngines.get(id) }
export async function createWebFlowSession(clinicId: string, direction = 'inbound') {
  const engine = await FlowEngine.create({ clinicId, direction, channel: 'web_direct' })
  if (!engine) return null
  const token = issueWebToolSessionKey(clinicId)
  keepFlowEngine(engine); webSessionKeys.set(engine.id, token)
  return { id: engine.id, token, revision: 0 }
}
export function getAuthorizedWebFlowEngine(id: string, token: string | undefined) {
  const expected = webSessionKeys.get(id)
  return expected && token === expected ? liveEngines.get(id) : undefined
}
export async function closeFlowEngine(id: string) { const engine = liveEngines.get(id); if (engine) { await engine.close(); liveEngines.delete(id); webSessionKeys.delete(id) } }

const whatsappSessionEngines = new Map<string, { engine: FlowEngine; updatedAt: number }>()
const WHATSAPP_SESSION_TTL_MS = 35 * 60_000

export async function getOrCreateWhatsAppFlowEngine(args: {
  clinicId: string
  conversationId: string
  phone?: string | null
  mode?: FlowRuntimeMode
  initialFields?: Record<string, unknown>
}): Promise<FlowEngine | null> {
  const now = Date.now()
  if (whatsappSessionEngines.size > 500) {
    for (const [k, v] of whatsappSessionEngines) {
      if (now - v.updatedAt > WHATSAPP_SESSION_TTL_MS) {
        whatsappSessionEngines.delete(k)
      }
    }
  }
  const key = `${args.clinicId}:${args.conversationId}`
  const existing = whatsappSessionEngines.get(key)
  if (existing && now - existing.updatedAt <= WHATSAPP_SESSION_TTL_MS) {
    existing.updatedAt = now
    return existing.engine
  }
  if (existing) {
    whatsappSessionEngines.delete(key)
  }

  let mergedInitialFields: Record<string, unknown> = { ...(args.initialFields || {}) }
  const rawPhone = args.phone || (typeof mergedInitialFields.telefon === 'string' ? mergedInitialFields.telefon : '')
  if (rawPhone && !hasPrehydratedDynamicFields(mergedInitialFields)) {
    const dynFields = await lookupDynamicFieldsByPhone(rawPhone, args.clinicId).catch((): Record<string, unknown> => ({}))
    mergedInitialFields = {
      ...dynFields,
      telefon: rawPhone,
      ...(dynFields._dynamicKnownCaller === 'true' ? { kayitli: 'true', 'caller.isKnownPatient': 'true' } : {}),
      ...(typeof dynFields._dynamicCallerName === 'string' ? { musteri_adi: dynFields._dynamicCallerName } : {}),
      ...mergedInitialFields,
    }
  } else if (rawPhone && !mergedInitialFields.telefon) {
    mergedInitialFields.telefon = rawPhone
  }

  const engine = await FlowEngine.create({
    clinicId: args.clinicId,
    direction: 'whatsapp',
    channel: 'whatsapp',
    mode: args.mode,
    initialFields: mergedInitialFields,
  })
  if (!engine) return null
  whatsappSessionEngines.set(key, { engine, updatedAt: now })
  return engine
}

export async function releaseWhatsAppFlowEngine(clinicId: string, conversationId: string): Promise<void> {
  const key = `${clinicId}:${conversationId}`
  const existing = whatsappSessionEngines.get(key)
  whatsappSessionEngines.delete(key)
  if (existing) {
    await existing.engine.close()
  }
}
