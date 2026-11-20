import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { flowAiMessages } from '../schema'
import { requireClinicId } from '../../tenancy/context'
import { saveFlow, validateConversationFlow, type ConversationFlow, type FlowEdge, type FlowNode, type FlowValidationIssue } from './flows'

export const FLOW_DIRECTIONS = ['inbound', 'outbound', 'web', 'whatsapp'] as const
export type FlowDirection = (typeof FLOW_DIRECTIONS)[number]

export interface FlowSnapshot {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface FlowAiMessageDto {
  id: string
  direction: FlowDirection
  role: 'user' | 'assistant'
  content: string
  appliedFlow: boolean
  nodeCount: number | null
  edgeCount: number | null
  changeSummary: string | null
  canRevert: boolean
  createdAt: string
}

let ensureSchemaPromise: Promise<void> | null = null

export async function ensureFlowAiChatSchema(): Promise<void> {
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS flow_ai_messages (
          id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          clinic_id      UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
          direction      TEXT NOT NULL DEFAULT 'inbound',
          role           TEXT NOT NULL,
          content        TEXT NOT NULL,
          applied_flow   BOOLEAN NOT NULL DEFAULT false,
          node_count     INTEGER,
          edge_count     INTEGER,
          change_summary TEXT,
          previous_flow  JSONB,
          created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS flow_ai_messages_clinic_dir_created_idx
        ON flow_ai_messages (clinic_id, direction, created_at ASC)
      `)
    })().catch((err) => {
      ensureSchemaPromise = null
      throw err
    })
  }
  await ensureSchemaPromise
}

export function parseFlowDirection(raw: unknown): FlowDirection | null {
  if (raw === undefined || raw === null || raw === '') return 'inbound'
  const val = String(raw).trim().toLowerCase()
  if ((FLOW_DIRECTIONS as readonly string[]).includes(val)) {
    return val as FlowDirection
  }
  return null
}

function toDto(row: typeof flowAiMessages.$inferSelect): FlowAiMessageDto {
  const prev = row.previousFlow as FlowSnapshot | null | undefined
  const hasPrev = Boolean(prev && Array.isArray(prev.nodes) && Array.isArray(prev.edges))
  const safeDir = parseFlowDirection(row.direction) ?? 'inbound'
  return {
    id: row.id,
    direction: safeDir,
    role: row.role === 'user' ? 'user' : 'assistant',
    content: row.content,
    appliedFlow: Boolean(row.appliedFlow),
    nodeCount: typeof row.nodeCount === 'number' ? row.nodeCount : null,
    edgeCount: typeof row.edgeCount === 'number' ? row.edgeCount : null,
    changeSummary: row.changeSummary ?? null,
    canRevert: Boolean(row.role === 'assistant' && row.appliedFlow && hasPrev),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
  }
}

export async function listFlowAiMessages(
  direction: FlowDirection,
  explicitClinicId?: string,
  limit = 60,
): Promise<FlowAiMessageDto[]> {
  await ensureFlowAiChatSchema()
  const clinicId = explicitClinicId ?? requireClinicId()
  const rows = await db
    .select()
    .from(flowAiMessages)
    .where(and(eq(flowAiMessages.clinicId, clinicId), eq(flowAiMessages.direction, direction)))
    .orderBy(asc(flowAiMessages.createdAt))
  const sliced = rows.length > limit ? rows.slice(rows.length - limit) : rows
  return sliced.map(toDto)
}

export async function appendFlowAiTurn(input: {
  clinicId?: string
  direction: FlowDirection
  userContent: string
  assistantContent: string
  appliedFlow: boolean
  nodeCount?: number | null
  edgeCount?: number | null
  changeSummary?: string | null
  previousFlow?: FlowSnapshot | null
  userId?: string | null
}): Promise<void> {
  await ensureFlowAiChatSchema()
  const clinicId = input.clinicId ?? requireClinicId()
  const nowMs = Date.now()
  const userTime = new Date(nowMs)
  const assistantTime = new Date(nowMs + 2)

  await db.insert(flowAiMessages).values([
    {
      clinicId,
      direction: input.direction,
      role: 'user',
      content: input.userContent,
      appliedFlow: false,
      nodeCount: null,
      edgeCount: null,
      changeSummary: null,
      previousFlow: null,
      createdBy: input.userId ?? null,
      createdAt: userTime,
    },
    {
      clinicId,
      direction: input.direction,
      role: 'assistant',
      content: input.assistantContent,
      appliedFlow: input.appliedFlow,
      nodeCount: input.appliedFlow ? (input.nodeCount ?? null) : null,
      edgeCount: input.appliedFlow ? (input.edgeCount ?? null) : null,
      changeSummary: input.changeSummary ?? null,
      previousFlow: input.appliedFlow && input.previousFlow ? input.previousFlow : null,
      createdBy: input.userId ?? null,
      createdAt: assistantTime,
    },
  ])
}

export async function clearFlowAiMessages(
  direction: FlowDirection,
  explicitClinicId?: string,
): Promise<void> {
  await ensureFlowAiChatSchema()
  const clinicId = explicitClinicId ?? requireClinicId()
  await db
    .delete(flowAiMessages)
    .where(and(eq(flowAiMessages.clinicId, clinicId), eq(flowAiMessages.direction, direction)))
}

export async function revertFlowAiTurn(input: {
  messageId: string
  direction: FlowDirection
  explicitClinicId?: string
}): Promise<{ flow: ConversationFlow; issues: FlowValidationIssue[]; messages: FlowAiMessageDto[] }> {
  await ensureFlowAiChatSchema()
  const clinicId = input.explicitClinicId ?? requireClinicId()
  const rows = await db
    .select()
    .from(flowAiMessages)
    .where(
      and(
        eq(flowAiMessages.id, input.messageId),
        eq(flowAiMessages.clinicId, clinicId),
        eq(flowAiMessages.direction, input.direction),
      ),
    )
    .limit(1)

  const target = rows[0]
  if (!target || target.role !== 'assistant' || !target.appliedFlow) {
    throw new Error('Geri alınabilecek bir akış değişikliği bulunamadı.')
  }

  const prev = target.previousFlow as FlowSnapshot | null | undefined
  if (!prev || !Array.isArray(prev.nodes) || !Array.isArray(prev.edges)) {
    throw new Error('Bu adım için kaydedilmiş önceki akış görüntüsü bulunamadı.')
  }

  const restoredFlow = await saveFlow(prev.nodes, prev.edges, input.direction, clinicId)
  const issues = validateConversationFlow(restoredFlow.nodes, restoredFlow.edges)

  await db
    .update(flowAiMessages)
    .set({
      appliedFlow: false,
      previousFlow: null,
      changeSummary: target.changeSummary ? `${target.changeSummary} (Geri alındı)` : 'Değişiklik geri alındı',
    })
    .where(eq(flowAiMessages.id, target.id))

  const messages = await listFlowAiMessages(input.direction, clinicId)
  return { flow: restoredFlow, issues, messages }
}
