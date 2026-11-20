'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Edit3,
  LayoutGrid,
  Link2,
  Maximize2,
  Minus,
  MousePointerClick,
  Plus,
  Settings2,
  Sparkles,
  Table2,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import InfoTooltip from '../ui/InfoTooltip'
import styles from './DynamicTablesStudio.module.css'
import {
  createDynamicTableWithPurpose,
  getAppointmentUsageMode,
  samplePreviewTitle,
  saveTableAppointmentUsageMode,
  STARTER_BLUEPRINTS,
  type AppointmentUsageMode,
  type StarterBlueprintKey,
  type TablePurpose,
} from './tableSetupHelpers'
import {
  MODULE_ROLE_META,
  type DynamicAppointmentConfigDef,
  type DynamicModuleConfigDef,
  type DynamicRelationDef,
  type DynamicTableDef,
  type RelationCardinality,
} from './types'

export const APPOINTMENT_NODE_ID = '__appointment_system__'

interface MiniRowItem {
  id: string
  tableId: string
  displayTitle: string
  isSample?: boolean
}

function plainSentenceEdgeLabel(
  rel: DynamicRelationDef,
  targetName: string
): string {
  if (rel.cardinality === 'one_to_one') {
    return `Tek 1 ${targetName} seçilir`
  }
  return `İçinde çoklu ${targetName} seçilir`
}

// ── Custom Node 1: Hikaye Diliyle Kendini Anlatan Liste Kartı ───────────────

interface SalesTableNodeData extends Record<string, unknown> {
  table: DynamicTableDef
  allTables: DynamicTableDef[]
  relations: DynamicRelationDef[]
  isSelected: boolean
  canManageSchema: boolean
  apptConfig: DynamicAppointmentConfigDef | null
  moduleConfig: DynamicModuleConfigDef | null
  parentApptTableNames: string[]
  linkingFromTableId: string | null
  onStartLinkFrom: (tableId: string | null) => void
  onPickLinkTarget: (targetId: string) => void
  onSelectTable: (tableId: string) => void
  onOpenTableData: (tableId: string) => void
  onOpenProperties: (tableId: string) => void
  onSchemaMutated: () => void
}

function SalesTableNode({ data }: { data: SalesTableNodeData }) {
  const {
    table,
    allTables,
    relations,
    isSelected,
    canManageSchema,
    apptConfig,
    moduleConfig,
    parentApptTableNames,
    linkingFromTableId,
    onStartLinkFrom,
    onPickLinkTarget,
    onSelectTable,
    onOpenTableData,
    onOpenProperties,
    onSchemaMutated,
  } = data

  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(table.name)
  const [confirmDeleteTable, setConfirmDeleteTable] = useState(false)
  const [savingRole, setSavingRole] = useState(false)

  // Bağlantı Kaldırma Onayı
  const [confirmRemoveRelId, setConfirmRemoveRelId] = useState<string | null>(null)

  useEffect(() => {
    setDraftName(table.name)
  }, [table.name])

  const currentRole: AppointmentUsageMode = getAppointmentUsageMode(apptConfig)
  const isLinkingSource = linkingFromTableId === table.id
  const isLinkTargetCandidate = Boolean(linkingFromTableId && linkingFromTableId !== table.id)
  const linkingSourceTable = linkingFromTableId
    ? allTables.find((t) => t.id === linkingFromTableId) || null
    : null

  // Bu tablonun diğer tablolarla olan bağlantılarını anlaşılır cümlelere çevir
  const connectedSummaries = useMemo(() => {
    const items: Array<{ relId: string; otherTable: DynamicTableDef; sentence: string }> = []
    for (const r of relations) {
      if (r.sourceTableId === table.id) {
        const other = allTables.find((t) => t.id === r.targetTableId)
        if (!other) continue
        items.push({
          relId: r.id,
          otherTable: other,
          sentence:
            r.cardinality === 'one_to_one'
              ? `İçinde 1 adet "${other.name}" seçilir`
              : `İçinde birden fazla "${other.name}" seçilir`,
        })
      } else if (r.targetTableId === table.id) {
        const other = allTables.find((t) => t.id === r.sourceTableId)
        if (!other) continue
        items.push({
          relId: r.id,
          otherTable: other,
          sentence: `"${other.name}" listesinin içinde seçilir`,
        })
      }
    }
    return items
  }, [relations, table.id, allTables])

  const handleQuickRoleSwitch = async (nextMode: AppointmentUsageMode) => {
    if (!canManageSchema || nextMode === currentRole) return
    setSavingRole(true)
    try {
      await saveTableAppointmentUsageMode(table, nextMode, {
        existingConfig: apptConfig,
        isRequiredInAppointment: nextMode === 'person',
      })
      onSchemaMutated()
      if (nextMode === 'person') {
        toast.success(`"${table.name}" artık randevuda Kişi olarak sorulacak`)
      } else if (nextMode === 'service') {
        toast.success(`"${table.name}" artık randevuda Yapılacak İşlem olarak seçilecek`)
      } else {
        toast.success(`"${table.name}" doğrudan randevu seçiminden çıkarıldı`)
      }
    } catch (err: any) {
      toast.error(err?.message || 'Rol güncellenemedi')
    } finally {
      setSavingRole(false)
    }
  }

  const handleSaveRename = async () => {
    const clean = draftName.trim()
    if (!clean || clean === table.name) {
      setRenaming(false)
      setDraftName(table.name)
      return
    }
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${table.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clean }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(payload.error || 'Ad güncellenemedi')
        return
      }
      setRenaming(false)
      onSchemaMutated()
      toast.success('Liste adı güncellendi')
    } catch {
      toast.error('Liste adı kaydedilemedi')
    }
  }

  const handleDeleteTable = async () => {
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${table.id}`, { method: 'DELETE' })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(payload.error || 'Liste silinemedi')
        return
      }
      setConfirmDeleteTable(false)
      onSchemaMutated()
      toast.success(`"${table.name}" silindi`)
    } catch {
      toast.error('Silme sırasında hata oluştu')
    }
  }

  const handleRemoveRelation = async (relId: string) => {
    try {
      const res = await fetch(`/api/dynamic-tables/relations/${relId}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Bağlantı kaldırılamadı')
        return
      }
      setConfirmRemoveRelId(null)
      onSchemaMutated()
      toast.success('Bağlantı kaldırıldı')
    } catch {
      toast.error('Bağlantı kaldırılamadı')
    }
  }

  return (
    <div
      onClick={() => onSelectTable(table.id)}
      className={`${styles.salesTableNode} ${isSelected ? styles.salesTableNodeSelected : ''} ${
        isLinkTargetCandidate ? styles.salesTableNodeLinkTarget : ''
      }`}
    >
      {/* Sol ve Sağ Sürükle-Bağla Noktaları */}
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className={styles.connectPort}
        title="Basılı tutup başka bir listeye çizgi çekebilirsiniz"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className={styles.connectPort}
        title="Basılı tutup başka bir listeye çizgi çekebilirsiniz"
      />

      {/* Tıklayarak Bağlama Modundaysa Üstte Dev "Buraya Bağla" Butonu */}
      {isLinkTargetCandidate && linkingSourceTable && (
        <div
          className="nodrag"
          style={{
            padding: '7px 10px',
            borderTopLeftRadius: 13,
            borderTopRightRadius: 13,
            background: 'var(--pc-tint)',
            borderBottom: '1.5px solid #2563eb',
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onPickLinkTarget(table.id)
            }}
            className={depth.btnPrimary}
            style={{ width: '100%', minHeight: 30, fontSize: 12 }}
          >
            <Link2 size={13} color="#ffffff" />
            <span>&ldquo;{linkingSourceTable.name}&rdquo; Listesini Buraya Bağla</span>
          </button>
        </div>
      )}

      {/* 1. Kart Başlığı */}
      <div className={styles.salesNodeHeader}>
        {renaming ? (
          <div className="nodrag" style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveRename()
                if (e.key === 'Escape') {
                  setRenaming(false)
                  setDraftName(table.name)
                }
              }}
              className={depth.input}
              style={{ minHeight: 26, padding: '2px 7px', fontSize: 12 }}
              autoFocus
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void handleSaveRename()
              }}
              className={depth.btnPrimary}
              style={{ minHeight: 25, padding: '2px 6px' }}
            >
              <Check size={12} color="#ffffff" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setRenaming(false)
                setDraftName(table.name)
              }}
              className={depth.btn}
              style={{ minHeight: 25, padding: '2px 6px' }}
            >
              <X size={12} />
            </button>
          </div>
        ) : confirmDeleteTable ? (
          <div
            className="nodrag"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              width: '100%',
            }}
          >
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--danger)' }}>
              Bu liste silinsin mi?
            </span>
            <div style={{ display: 'inline-flex', gap: 4 }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDeleteTable()
                }}
                className={depth.btn}
                style={{
                  minHeight: 24,
                  padding: '2px 7px',
                  fontSize: 11,
                  color: 'var(--danger)',
                  borderColor: 'var(--danger)',
                }}
              >
                Evet, Sil
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmDeleteTable(false)
                }}
                className={depth.btn}
                style={{ minHeight: 24, padding: '2px 7px', fontSize: 11 }}
              >
                Vazgeç
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <strong
                onDoubleClick={(e) => {
                  if (!canManageSchema) return
                  e.stopPropagation()
                  setRenaming(true)
                }}
                style={{
                  fontSize: 14,
                  color: 'var(--foreground)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {table.name}
              </strong>
              <button
                type="button"
                className={`nodrag ${depth.badge}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenTableData(table.id)
                }}
                style={{ fontSize: 10.5, padding: '2px 7px', cursor: 'pointer', flexShrink: 0 }}
                title="Tablo verilerini aç"
              >
                <Table2 size={10} />
                <span>{table.rowCount} Kayıt · Aç</span>
              </button>
              {moduleConfig?.enabled && MODULE_ROLE_META[moduleConfig.moduleRole] && (
                <span
                  className={depth.badge}
                  style={{ fontSize: 10, padding: '2px 7px', flexShrink: 0 }}
                  title={MODULE_ROLE_META[moduleConfig.moduleRole].tabHint}
                >
                  {MODULE_ROLE_META[moduleConfig.moduleRole].shortBadge}
                </span>
              )}
            </div>

            {canManageSchema && (
              <div className="nodrag" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenaming(true)
                  }}
                  className={depth.btn}
                  style={{ minHeight: 24, padding: '2px 5px' }}
                  title="Adını değiştir"
                >
                  <Edit3 size={11} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenProperties(table.id)
                  }}
                  className={depth.btn}
                  style={{ minHeight: 24, padding: '2px 5px' }}
                  title="Detaylı Tablo Özellikleri"
                >
                  <Settings2 size={11} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmDeleteTable(true)
                  }}
                  className={depth.btn}
                  style={{ minHeight: 24, padding: '2px 5px', color: 'var(--danger)' }}
                  title="Listeyi sil"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 2. Tek Tıkla Rol Seçici: "Randevuda Ne İşe Yarar?" */}
      <div
        className="nodrag"
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: '7px 10px',
          borderBottom:
            connectedSummaries.length > 0 || canManageSchema
              ? '1px solid var(--pc-border)'
              : undefined,
          borderBottomLeftRadius:
            connectedSummaries.length === 0 && !canManageSchema ? 13 : undefined,
          borderBottomRightRadius:
            connectedSummaries.length === 0 && !canManageSchema ? 13 : undefined,
          background: 'var(--card-inner, var(--card-bg))',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10.5 }}>
          <span style={{ fontWeight: 700, color: 'var(--pc-muted)' }}>
            Randevu Formundaki Rolü
          </span>
          {savingRole && <span style={{ color: 'var(--pc-blue)', fontWeight: 700 }}>Kaydediliyor…</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
          {[
            { key: 'person' as const, label: 'Müşteri / Kişi' },
            { key: 'service' as const, label: 'Konu / Hizmet' },
            { key: 'off' as const, label: 'Alt Detay' },
          ].map((roleOpt) => {
            const active = currentRole === roleOpt.key
            return (
              <button
                key={roleOpt.key}
                type="button"
                disabled={!canManageSchema || savingRole}
                onClick={() => void handleQuickRoleSwitch(roleOpt.key)}
                className={active ? depth.btnPrimary : depth.btn}
                style={{
                  minHeight: 26,
                  padding: '2px 5px',
                  fontSize: 10.5,
                  fontWeight: 700,
                }}
              >
                <span>{roleOpt.label}</span>
              </button>
            )
          })}
        </div>

        {/* Rolün Açıklaması (İnsan Diliyle 1 Satır) */}
        <div style={{ fontSize: 11, color: 'var(--pc-tint-fg)', fontWeight: 600 }}>
          {currentRole === 'person' ? (
            <span>✓ Randevu açarken buradan 1 kişi / müşteri seçilir.</span>
          ) : currentRole === 'service' ? (
            <span>✓ Randevuda buradan 1 veya daha fazla konu / teklif / hizmet seçilir.</span>
          ) : parentApptTableNames.length > 0 ? (
            <span>
              ✓ Randevuda <strong>{parentApptTableNames[0]}</strong> seçilince altında otomatik açılır!
            </span>
          ) : (
            <span style={{ color: 'var(--pc-muted)' }}>
              Ana bir tabloya bağlarsanız randevuda onun altında açılır.
            </span>
          )}
        </div>
      </div>

      {/* 3. Bağlı Olduğu Diğer Listeler (Açık Türkçe Cümlelerle) */}
      {connectedSummaries.length > 0 && (
        <div
          className="nodrag"
          onClick={(e) => e.stopPropagation()}
          style={{
            padding: '7px 10px',
            borderBottom: canManageSchema ? '1px solid var(--pc-border)' : undefined,
            borderBottomLeftRadius: !canManageSchema ? 13 : undefined,
            borderBottomRightRadius: !canManageSchema ? 13 : undefined,
            background: 'var(--pc-tint)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {connectedSummaries.map((item) => (
            <div
              key={`${item.relId}-${item.otherTable.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                fontSize: 11,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, color: 'var(--pc-tint-fg)' }}>
                <Link2 size={11} />
                <span>{item.sentence}</span>
              </span>

              {canManageSchema && (
                confirmRemoveRelId === item.relId ? (
                  <span style={{ display: 'inline-flex', gap: 3 }}>
                    <button
                      type="button"
                      onClick={() => void handleRemoveRelation(item.relId)}
                      className={depth.btn}
                      style={{ minHeight: 20, padding: '1px 5px', fontSize: 10, color: 'var(--danger)' }}
                    >
                      Kaldır
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveRelId(null)}
                      className={depth.btn}
                      style={{ minHeight: 20, padding: '1px 5px', fontSize: 10 }}
                    >
                      İptal
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveRelId(item.relId)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--pc-muted)',
                      cursor: 'pointer',
                      padding: 1,
                    }}
                    title="Bu bağlantıyı kaldır"
                  >
                    <X size={11} />
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {/* 4. Alt Buton: Tıklayarak "Başka Tabloya Bağla" */}
      {canManageSchema && (
        <div
          className="nodrag"
          onClick={(e) => e.stopPropagation()}
          style={{
            padding: '8px 10px',
            background: 'var(--pc-surface)',
            borderBottomLeftRadius: 13,
            borderBottomRightRadius: 13,
            display: 'flex',
            gap: 6,
          }}
        >
          {isLinkingSource ? (
            <button
              type="button"
              onClick={() => onStartLinkFrom(null)}
              className={depth.btn}
              style={{ width: '100%', minHeight: 29, fontSize: 11.5, borderColor: '#2563eb' }}
            >
              <X size={13} />
              <span>Bağlama Seçimini İptal Et</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onStartLinkFrom(table.id)}
              className={depth.btnPale}
              style={{ flex: 1, minHeight: 29, fontSize: 11.5 }}
            >
              <Link2 size={13} />
              <span>Başka Tabloya Bağla</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Custom Node 2: Etkileşimli Canlı "Yeni Randevu" Simülasyon Kartı ────────

interface AppointmentPreviewEntry {
  config: DynamicAppointmentConfigDef
  table: DynamicTableDef
  options: MiniRowItem[]
  subTables: Array<{
    table: DynamicTableDef
    options: MiniRowItem[]
  }>
}

interface AppointmentPreviewNodeData extends Record<string, unknown> {
  entries: AppointmentPreviewEntry[]
  linkingFromTable: DynamicTableDef | null
  onPickApptAsTarget: () => void
  onSelectTable: (tableId: string) => void
  onOpenProperties: (tableId: string) => void
}

function AppointmentPreviewNode({ data }: { data: AppointmentPreviewNodeData }) {
  const {
    entries,
    linkingFromTable,
    onPickApptAsTarget,
    onSelectTable,
    onOpenProperties,
  } = data

  // Tıklanabilir Canlı Simülasyon Seçimleri
  const [selectedByTable, setSelectedByTable] = useState<Record<string, string[]>>({})

  useEffect(() => {
    setSelectedByTable((prev) => {
      const next = { ...prev }
      for (const entry of entries) {
        if (!next[entry.table.id] && entry.options[0]) {
          next[entry.table.id] = [entry.options[0].id]
        }
        for (const sub of entry.subTables) {
          if (!next[sub.table.id] && sub.options[0]) {
            next[sub.table.id] = [sub.options[0].id]
          }
        }
      }
      return next
    })
  }, [entries])

  const toggleSimOption = (tableId: string, optionId: string, allowMulti: boolean) => {
    setSelectedByTable((prev) => {
      const curr = prev[tableId] || []
      if (!allowMulti) {
        return { ...prev, [tableId]: [optionId] }
      }
      const exists = curr.includes(optionId)
      return {
        ...prev,
        [tableId]: exists ? curr.filter((x) => x !== optionId) : [...curr, optionId],
      }
    })
  }

  return (
    <div className={styles.apptNodeCard}>
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className={styles.connectPort}
        title="Liste kartından buraya çizgi çekerek randevuya bağlayabilirsiniz"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className={styles.connectPort}
        title="Liste kartından buraya çizgi çekerek randevuya bağlayabilirsiniz"
      />

      {linkingFromTable && (
        <div
          className="nodrag"
          style={{
            padding: '8px 10px',
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
            background: 'var(--pc-tint)',
            borderBottom: '1.5px solid #2563eb',
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onPickApptAsTarget()
            }}
            className={depth.btnPrimary}
            style={{ width: '100%', minHeight: 31, fontSize: 12 }}
          >
            <Calendar size={13} color="#ffffff" />
            <span>&ldquo;{linkingFromTable.name}&rdquo; Listesini Randevu Ekranına Ekle</span>
          </button>
        </div>
      )}

      {/* Koyu Mavi Başlık (Saf Beyaz Yazı Garantili) */}
      <div className={styles.apptNodeHeader}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 800 }}>
            <Calendar size={15} color="#ffffff" />
            <span>Randevu Formu Canlı Önizleme</span>
          </span>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
              background: '#1e40af',
              border: '1px solid #60a5fa',
            }}
          >
            Canlı Test
          </span>
        </div>
        <div style={{ fontSize: 11, opacity: 0.94 }}>
          Takvimde &ldquo;Yeni Randevu&rdquo; açıldığında ekibiniz / danışmanınız tam olarak bu ekranı görür:
        </div>
      </div>

      {/* Etkileşimli Simülasyon Gövdesi */}
      <div
        className="nodrag"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}
      >
        <div
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            background: 'var(--pc-surface)',
            border: '1px solid var(--pc-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 11.5,
            fontWeight: 700,
          }}
        >
          <span>Yeni Randevu Formu</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--pc-muted)' }}>
            <Clock size={12} />
            <span>Bugün · 14:30 – 15:00</span>
          </span>
        </div>

        {entries.length === 0 ? (
          <div
            style={{
              padding: '16px 12px',
              borderRadius: 10,
              border: '1.5px dashed var(--pc-border)',
              background: 'var(--pc-surface)',
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--pc-muted)',
              lineHeight: 1.5,
            }}
          >
            Sol taraftaki bir tabloda <strong>&ldquo;Müşteri / Kişi&rdquo;</strong> veya{' '}
            <strong>&ldquo;Konu / Hizmet&rdquo;</strong> rolünü seçtiğinizde randevu alanları burada canlı olarak açılır.
          </div>
        ) : (
          entries.map(({ config, table: tbl, options, subTables }, idx) => {
            const pickedIds = selectedByTable[tbl.id] || []
            return (
              <div
                key={tbl.id}
                style={{
                  padding: '9px 10px',
                  borderRadius: 10,
                  border: '1.5px solid var(--pc-border)',
                  background: 'var(--pc-tint)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
                    <strong style={{ fontSize: 12, color: 'var(--foreground)' }}>
                      {idx + 1}. {tbl.name}
                      {config.isRequiredInAppointment ? (
                        <span style={{ color: 'var(--danger)' }}> *</span>
                      ) : null}
                    </strong>
                    <span className={depth.badge} style={{ fontSize: 9.5, padding: '1px 6px' }}>
                      {config.allowMultiple ? 'Çoklu Seçim' : 'Tek Seçim'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectTable(tbl.id)
                      onOpenProperties(tbl.id)
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--pc-blue)',
                      fontSize: 10.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Ayarlar
                  </button>
                </div>

                {/* Tıklanabilir Gerçek/Örnek Seçim Çipleri */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {options.slice(0, 4).map((opt) => {
                    const checked = pickedIds.includes(opt.id)
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => toggleSimOption(tbl.id, opt.id, config.allowMultiple)}
                        className={checked ? depth.btnPrimary : depth.btn}
                        style={{ minHeight: 26, padding: '2px 9px', fontSize: 11 }}
                      >
                        {checked && <Check size={11} color="#ffffff" />}
                        <span>
                          {opt.displayTitle}
                          {opt.isSample ? ' (Örnek)' : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* Seçilen İşlemin Altında Açılan Bağlı Alt Listeler (Malzeme, Endikasyon vb.) */}
                {pickedIds.length > 0 && subTables.length > 0 && (
                  <div
                    style={{
                      marginTop: 2,
                      padding: '7px 9px',
                      borderRadius: 8,
                      background: 'var(--card-bg)',
                      borderLeft: '3px solid #2563eb',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--pc-muted)' }}>
                      Seçilen {tbl.name} kaydına bağlı alt detaylar:
                    </div>
                    {subTables.map((sub) => {
                      const subPicked = selectedByTable[sub.table.id] || []
                      return (
                        <div key={sub.table.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground)' }}>
                            ↳ {sub.table.name}:
                          </span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {sub.options.slice(0, 4).map((sOpt) => {
                              const sChecked = subPicked.includes(sOpt.id)
                              return (
                                <button
                                  key={sOpt.id}
                                  type="button"
                                  onClick={() => toggleSimOption(sub.table.id, sOpt.id, true)}
                                  className={sChecked ? depth.btnPale : depth.btn}
                                  style={{
                                    minHeight: 23,
                                    padding: '1px 7px',
                                    fontSize: 10.5,
                                    borderColor: sChecked ? '#2563eb' : undefined,
                                  }}
                                >
                                  <span>
                                    {sChecked ? '✓ ' : '+ '}
                                    {sOpt.displayTitle}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

const NODE_TYPES = {
  salesTable: SalesTableNode,
  appointmentPreview: AppointmentPreviewNode,
}

// ── Türkçe Yakınlaştırma & Sığdırma Kontrolleri ─────────────────────────────

function CanvasZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  return (
    <Panel position="bottom-left" style={{ margin: 12 }}>
      <div className={styles.zoomControls}>
        <button
          type="button"
          onClick={() => void zoomIn({ duration: 180 })}
          className={depth.btn}
          style={{ minHeight: 28, padding: '3px 8px' }}
          title="Yakınlaştır"
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          onClick={() => void zoomOut({ duration: 180 })}
          className={depth.btn}
          style={{ minHeight: 28, padding: '3px 8px' }}
          title="Uzaklaştır"
        >
          <Minus size={13} />
        </button>
        <button
          type="button"
          onClick={() => void fitView({ padding: 0.14, duration: 220 })}
          className={depth.btn}
          style={{ minHeight: 28, padding: '3px 9px', fontSize: 11.5 }}
          title="Tüm Diyagramı Ekrana Sığdır"
        >
          <Maximize2 size={12} />
          <span>Ekrana Sığdır</span>
        </button>
      </div>
    </Panel>
  )
}

// ── Dagre Akıllı Sol -> Orta -> Sağ (Randevu) Hizalama ──────────────────────

function computeAutoPositions(
  tables: DynamicTableDef[],
  relations: DynamicRelationDef[],
  appointmentConfigs: DynamicAppointmentConfigDef[]
): {
  tableMap: Map<string, { x: number; y: number }>
  appointmentPos: { x: number; y: number }
} {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', ranksep: 135, nodesep: 42, marginx: 36, marginy: 36 })

  const enabledConfigs = appointmentConfigs.filter((c) => c.enabled)
  const apptTableIds = new Set(enabledConfigs.map((c) => c.tableId))

  for (const tbl of tables) {
    g.setNode(tbl.id, { width: 312, height: 196 })
  }

  const apptHeight = Math.max(290, 160 + enabledConfigs.length * 115)
  g.setNode(APPOINTMENT_NODE_ID, { width: 364, height: apptHeight })

  // Alt detay listeleri solda, randevu tabloları ortada, Canlı Randevu Kartı en sağda dursun!
  for (const rel of relations) {
    const srcIsAppt = apptTableIds.has(rel.sourceTableId)
    const tgtIsAppt = apptTableIds.has(rel.targetTableId)
    if (srcIsAppt && !tgtIsAppt) {
      g.setEdge(rel.targetTableId, rel.sourceTableId)
    } else {
      g.setEdge(rel.sourceTableId, rel.targetTableId)
    }
  }

  for (const cfg of enabledConfigs) {
    if (tables.some((t) => t.id === cfg.tableId)) {
      g.setEdge(cfg.tableId, APPOINTMENT_NODE_ID)
    }
  }

  if (enabledConfigs.length === 0 && tables.length > 0) {
    g.setEdge(tables[tables.length - 1].id, APPOINTMENT_NODE_ID)
  }

  dagre.layout(g)

  const tableMap = new Map<string, { x: number; y: number }>()
  for (const tbl of tables) {
    const n = g.node(tbl.id)
    if (n) {
      tableMap.set(tbl.id, {
        x: Math.round(n.x - 156),
        y: Math.round(n.y - 98),
      })
    }
  }

  const apptNode = g.node(APPOINTMENT_NODE_ID)
  const appointmentPos = apptNode
    ? {
        x: Math.round(apptNode.x - 182),
        y: Math.round(apptNode.y - apptHeight / 2),
      }
    : { x: 640, y: 80 }

  return { tableMap, appointmentPos }
}

// ── Ana Görsel Diyagram Bileşeni ───────────────────────────────────────────

export interface SchemaCanvasPanelProps {
  tables: DynamicTableDef[]
  relations: DynamicRelationDef[]
  appointmentConfigs: DynamicAppointmentConfigDef[]
  moduleConfigs?: DynamicModuleConfigDef[]
  appointmentNodePosition: { x: number; y: number }
  selectedTableId: string | null
  canManageSchema: boolean
  refreshToken?: number
  autoArrangeVersion?: number
  onSelectTable: (tableId: string) => void
  onOpenTableData: (tableId: string) => void
  onOpenTableProperties: (tableId: string) => void
  onTableCreated: (tableId: string) => void
  onSchemaMutated: () => void
  onApplyBlueprint?: (blueprint: StarterBlueprintKey) => void
  applyingBlueprint?: string | null
}

function SchemaCanvasInner({
  tables,
  relations,
  appointmentConfigs,
  moduleConfigs = [],
  appointmentNodePosition,
  selectedTableId,
  canManageSchema,
  refreshToken = 0,
  autoArrangeVersion = 0,
  onSelectTable,
  onOpenTableData,
  onOpenTableProperties,
  onTableCreated,
  onSchemaMutated,
  onApplyBlueprint,
  applyingBlueprint = null,
}: SchemaCanvasPanelProps) {
  const { fitView } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const [pendingBlueprintKey, setPendingBlueprintKey] = useState<StarterBlueprintKey | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  // Gerçek kayıt önizlemeleri (Canlı Randevu Deneme Ekranı için)
  const [rowsByTableMap, setRowsByTableMap] = useState<Record<string, MiniRowItem[]>>({})

  // Tıklayarak Bağlama Modu ("Başka Listeye Bağla" tıklandığında kaynak liste)
  const [linkingFromTableId, setLinkingFromTableId] = useState<string | null>(null)

  // Satır içi Yeni Liste Oluşturma
  const [addingTable, setAddingTable] = useState(false)
  const [newTableName, setNewTableName] = useState('')
  const [newTablePurpose, setNewTablePurpose] = useState<TablePurpose>('detail')
  const [creatingTable, setCreatingTable] = useState(false)

  // İki Liste Bağlanırken Sorulan Tek Basit Soru (Çoklu mu, Tek 1 Tane mi?)
  const [pendingTableConnection, setPendingTableConnection] = useState<{
    sourceId: string
    targetId: string
    allowMultiple: boolean
  } | null>(null)
  const [savingConnection, setSavingConnection] = useState(false)

  // Takvim Kartına Bağlanırken Sorulan Rol Sorusu
  const [pendingApptConnection, setPendingApptConnection] = useState<{
    tableId: string
    mode: Exclude<AppointmentUsageMode, 'off'>
  } | null>(null)
  const [savingApptConnection, setSavingApptConnection] = useState(false)

  // Seçili Çizgi
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [confirmRemoveEdge, setConfirmRemoveEdge] = useState(false)

  const autoArrangedOnceRef = useRef(false)
  const initialFitDoneRef = useRef(false)
  const lastArrangedVersionRef = useRef(autoArrangeVersion)

  // Kartlarda ve Randevu Simülasyonunda göstermek için mevcut kayıt başlıklarını çek
  useEffect(() => {
    let active = true
    fetch('/api/dynamic-tables/appointment-context')
      .then((r) => (r.ok ? r.json() : null))
      .then((ctx) => {
        if (!active || !ctx || !Array.isArray(ctx.allTables)) return
        const map: Record<string, MiniRowItem[]> = {}
        for (const item of ctx.allTables) {
          if (item?.table?.id && Array.isArray(item.rows)) {
            map[item.table.id] = item.rows.slice(0, 6).map((r: any) => ({
              id: String(r.id),
              tableId: String(item.table.id),
              displayTitle: String(r.displayTitle || ''),
            }))
          }
        }
        setRowsByTableMap(map)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [tables, refreshToken])

  const getEffectiveSampleRows = useCallback(
    (tbl: DynamicTableDef): MiniRowItem[] => {
      const real = rowsByTableMap[tbl.id]
      if (real && real.length > 0) return real
      return [
        {
          id: `sample_${tbl.id}_1`,
          tableId: tbl.id,
          displayTitle: samplePreviewTitle(tbl.name, 1),
          isSample: true,
        },
        {
          id: `sample_${tbl.id}_2`,
          tableId: tbl.id,
          displayTitle: samplePreviewTitle(tbl.name, 2),
          isSample: true,
        },
      ]
    },
    [rowsByTableMap]
  )

  const persistPositions = useCallback(
    async (
      tablePositions: Array<{ id: string; canvasX: number; canvasY: number }>,
      apptPos?: { x: number; y: number }
    ) => {
      if (!canManageSchema) return
      try {
        await fetch('/api/dynamic-tables/canvas-layout', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tables: tablePositions,
            appointmentNodePosition: apptPos,
          }),
        })
      } catch {
        // Sessizce geç
      }
    },
    [canManageSchema]
  )

  const openConnectionFlow = useCallback(
    (sourceId: string, targetId: string) => {
      if (!canManageSchema || !sourceId || !targetId || sourceId === targetId) return
      setLinkingFromTableId(null)
      setSelectedEdgeId(null)
      setConfirmRemoveEdge(false)

      if (sourceId === APPOINTMENT_NODE_ID || targetId === APPOINTMENT_NODE_ID) {
        const tableId = sourceId === APPOINTMENT_NODE_ID ? targetId : sourceId
        const tbl = tables.find((t) => t.id === tableId)
        if (!tbl) return
        const lower = tbl.name.toLocaleLowerCase('tr-TR')
        const defaultMode: Exclude<AppointmentUsageMode, 'off'> =
          lower.includes('müşteri') ||
          lower.includes('aday') ||
          lower.includes('alıcı') ||
          lower.includes('kiracı') ||
          lower.includes('sigortalı') ||
          lower.includes('danışan') ||
          lower.includes('hasta') ||
          lower.includes('kişi')
            ? 'person'
            : 'service'
        setPendingTableConnection(null)
        setPendingApptConnection({ tableId, mode: defaultMode })
        return
      }

      const alreadyLinked = relations.some(
        (r) =>
          (r.sourceTableId === sourceId && r.targetTableId === targetId) ||
          (r.sourceTableId === targetId && r.targetTableId === sourceId)
      )
      if (alreadyLinked) {
        toast('Bu iki liste zaten birbirine bağlı.')
        return
      }

      setPendingApptConnection(null)
      setPendingTableConnection({
        sourceId,
        targetId,
        allowMultiple: true,
      })
    },
    [canManageSchema, tables, relations]
  )

  const handlePickLinkTarget = useCallback(
    (targetId: string) => {
      if (!linkingFromTableId) return
      openConnectionFlow(linkingFromTableId, targetId)
    },
    [linkingFromTableId, openConnectionFlow]
  )

  // Randevu Simülasyonu ve Alt Liste Haritası
  const { apptEntries, subTableToParentNames } = useMemo(() => {
    const enabledConfigs = [...appointmentConfigs]
      .filter((c) => c.enabled)
      .sort((a, b) => Number(a.allowMultiple) - Number(b.allowMultiple))

    const apptTableIds = new Set(enabledConfigs.map((c) => c.tableId))
    const subMap = new Map<string, string[]>()

    const entries: AppointmentPreviewEntry[] = enabledConfigs
      .map((cfg) => {
        const tbl = tables.find((t) => t.id === cfg.tableId)
        if (!tbl) return null
        const subIds = new Set<string>()
        if (cfg.includeRelatedTables) {
          for (const r of relations) {
            if (r.sourceTableId === tbl.id && !apptTableIds.has(r.targetTableId)) {
              subIds.add(r.targetTableId)
            } else if (r.targetTableId === tbl.id && !apptTableIds.has(r.sourceTableId)) {
              subIds.add(r.sourceTableId)
            }
          }
        }
        const subTables = tables
          .filter((t) => subIds.has(t.id))
          .map((st) => ({
            table: st,
            options: getEffectiveSampleRows(st),
          }))

        for (const st of subTables) {
          const prev = subMap.get(st.table.id) || []
          if (!prev.includes(tbl.name)) prev.push(tbl.name)
          subMap.set(st.table.id, prev)
        }

        return {
          config: cfg,
          table: tbl,
          options: getEffectiveSampleRows(tbl),
          subTables,
        }
      })
      .filter((x): x is AppointmentPreviewEntry => Boolean(x))

    return { apptEntries: entries, subTableToParentNames: subMap }
  }, [tables, relations, appointmentConfigs, getEffectiveSampleRows])

  // Node ve Edge'leri Güncelle
  useEffect(() => {
    const posKeys = new Set<string>()
    let hasOverlap = false
    for (const t of tables) {
      const key = `${Math.round(t.canvasX || 0)}:${Math.round(t.canvasY || 0)}`
      if (posKeys.has(key)) {
        hasOverlap = true
        break
      }
      posKeys.add(key)
    }

    const autoLayout =
      hasOverlap && tables.length > 1
        ? computeAutoPositions(tables, relations, appointmentConfigs)
        : null

    const linkingFromTable = linkingFromTableId
      ? tables.find((t) => t.id === linkingFromTableId) || null
      : null

    const builtNodes: Node[] = tables.map((tbl) => {
      const apptCfg = appointmentConfigs.find((c) => c.tableId === tbl.id && c.enabled) || null
      const modCfg = moduleConfigs.find((c) => c.tableId === tbl.id && c.enabled) || null
      const fallbackPos = autoLayout?.tableMap.get(tbl.id)
      const pos = fallbackPos || { x: tbl.canvasX || 70, y: tbl.canvasY || 80 }

      return {
        id: tbl.id,
        type: 'salesTable',
        position: pos,
        data: {
          table: tbl,
          allTables: tables,
          relations,
          isSelected: tbl.id === selectedTableId,
          canManageSchema,
          apptConfig: apptCfg,
          moduleConfig: modCfg,
          parentApptTableNames: subTableToParentNames.get(tbl.id) || [],
          linkingFromTableId,
          onStartLinkFrom: setLinkingFromTableId,
          onPickLinkTarget: handlePickLinkTarget,
          onSelectTable,
          onOpenTableData,
          onOpenProperties: onOpenTableProperties,
          onSchemaMutated,
        } satisfies SalesTableNodeData,
      }
    })

    const resolvedApptPos = autoLayout
      ? autoLayout.appointmentPos
      : appointmentNodePosition &&
          (appointmentNodePosition.x !== 0 || appointmentNodePosition.y !== 0)
        ? appointmentNodePosition
        : { x: Math.max(520, tables.length * 180), y: 90 }

    builtNodes.push({
      id: APPOINTMENT_NODE_ID,
      type: 'appointmentPreview',
      position: resolvedApptPos,
      data: {
        entries: apptEntries,
        linkingFromTable,
        onPickApptAsTarget: () => {
          if (linkingFromTableId) {
            openConnectionFlow(linkingFromTableId, APPOINTMENT_NODE_ID)
          }
        },
        onSelectTable,
        onOpenProperties: onOpenTableProperties,
      } satisfies AppointmentPreviewNodeData,
    })

    const builtEdges: Edge[] = []
    const apptTableIds = new Set(
      appointmentConfigs.filter((c) => c.enabled).map((c) => c.tableId)
    )

    for (const rel of relations) {
      const src = tables.find((t) => t.id === rel.sourceTableId)
      const tgt = tables.find((t) => t.id === rel.targetTableId)
      if (!src || !tgt) continue
      const edgeId = `rel-${rel.id}`
      const isEdgeSelected = selectedEdgeId === edgeId

      // Görsel akış soldan (alt detaydan) sağa (ana işleme) doğru daima okunaklı aksın
      const swapVisualDirection =
        apptTableIds.has(rel.sourceTableId) && !apptTableIds.has(rel.targetTableId)

      builtEdges.push({
        id: edgeId,
        source: swapVisualDirection ? rel.targetTableId : rel.sourceTableId,
        target: swapVisualDirection ? rel.sourceTableId : rel.targetTableId,
        sourceHandle: 'right',
        targetHandle: 'left',
        type: 'smoothstep',
        label: swapVisualDirection
          ? `${src.name} içinde seçilir`
          : plainSentenceEdgeLabel(rel, tgt.name),
        style: {
          stroke: isEdgeSelected ? '#2563eb' : '#0284c7',
          strokeWidth: isEdgeSelected ? 3.2 : 2.3,
        },
        labelStyle: {
          fill: 'var(--foreground)',
          fontWeight: 700,
          fontSize: 11,
        },
        labelBgPadding: [8, 4],
        labelBgBorderRadius: 7,
        labelBgStyle: {
          fill: 'var(--card-bg)',
          fillOpacity: 1,
          stroke: isEdgeSelected ? '#2563eb' : 'var(--pc-border)',
          strokeWidth: 1.5,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isEdgeSelected ? '#2563eb' : '#0284c7',
          width: 16,
          height: 16,
        },
      })
    }

    for (const cfg of appointmentConfigs) {
      if (!cfg.enabled) continue
      const tbl = tables.find((t) => t.id === cfg.tableId)
      if (!tbl) continue
      const edgeId = `appt-${cfg.tableId}`
      const isEdgeSelected = selectedEdgeId === edgeId

      builtEdges.push({
        id: edgeId,
        source: cfg.tableId,
        target: APPOINTMENT_NODE_ID,
        sourceHandle: 'right',
        targetHandle: 'left',
        type: 'smoothstep',
        animated: true,
        label: cfg.allowMultiple ? '② Çoklu Konu / Hizmet' : '① Müşteri / Kişi',
        style: {
          stroke: '#2563eb',
          strokeWidth: isEdgeSelected ? 3.2 : 2.5,
          strokeDasharray: '6 4',
        },
        labelStyle: {
          fill: 'var(--pc-tint-fg)',
          fontWeight: 800,
          fontSize: 11.5,
        },
        labelBgPadding: [8, 4],
        labelBgBorderRadius: 7,
        labelBgStyle: {
          fill: 'var(--pc-tint)',
          fillOpacity: 1,
          stroke: '#2563eb',
          strokeWidth: 1.5,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#2563eb',
          width: 16,
          height: 16,
        },
      })
    }

    setNodes(builtNodes)
    setEdges(builtEdges)

    let fitTimer: ReturnType<typeof setTimeout> | null = null
    if (autoLayout && !autoArrangedOnceRef.current) {
      autoArrangedOnceRef.current = true
      initialFitDoneRef.current = true
      const tablePayload = Array.from(autoLayout.tableMap.entries()).map(([id, p]) => ({
        id,
        canvasX: p.x,
        canvasY: p.y,
      }))
      void persistPositions(tablePayload, autoLayout.appointmentPos)
      fitTimer = setTimeout(() => {
        void fitView({ padding: 0.14, duration: 200 })
      }, 80)
    } else if (!initialFitDoneRef.current && builtNodes.length > 0) {
      initialFitDoneRef.current = true
      fitTimer = setTimeout(() => {
        void fitView({ padding: 0.14, duration: 150 })
      }, 80)
    }
    return () => {
      if (fitTimer) clearTimeout(fitTimer)
    }
  }, [
    tables,
    relations,
    appointmentConfigs,
    moduleConfigs,
    appointmentNodePosition,
    selectedTableId,
    canManageSchema,
    apptEntries,
    subTableToParentNames,
    linkingFromTableId,
    selectedEdgeId,
    handlePickLinkTarget,
    openConnectionFlow,
    onSelectTable,
    onOpenTableData,
    onOpenTableProperties,
    onSchemaMutated,
    persistPositions,
    setNodes,
    setEdges,
    fitView,
  ])

  const handleAutoLayout = useCallback(() => {
    const { tableMap, appointmentPos } = computeAutoPositions(
      tables,
      relations,
      appointmentConfigs
    )
    setNodes((curr) =>
      curr.map((n) => {
        if (n.id === APPOINTMENT_NODE_ID) {
          return { ...n, position: appointmentPos }
        }
        const next = tableMap.get(n.id)
        return next ? { ...n, position: next } : n
      })
    )
    const tablePayload = Array.from(tableMap.entries()).map(([id, p]) => ({
      id,
      canvasX: p.x,
      canvasY: p.y,
    }))
    void persistPositions(tablePayload, appointmentPos)
    setTimeout(() => {
      void fitView({ padding: 0.14, duration: 240 })
    }, 50)
    toast.success('Kartlar akış sırasına göre (Detaylar ➔ Ana Listeler ➔ Randevu) hizalandı')
  }, [tables, relations, appointmentConfigs, setNodes, persistPositions, fitView])

  useEffect(() => {
    if (autoArrangeVersion <= lastArrangedVersionRef.current) return
    lastArrangedVersionRef.current = autoArrangeVersion
    if (tables.length === 0) return
    const { tableMap, appointmentPos } = computeAutoPositions(
      tables,
      relations,
      appointmentConfigs
    )
    setNodes((curr) =>
      curr.map((n) => {
        if (n.id === APPOINTMENT_NODE_ID) {
          return { ...n, position: appointmentPos }
        }
        const next = tableMap.get(n.id)
        return next ? { ...n, position: next } : n
      })
    )
    const tablePayload = Array.from(tableMap.entries()).map(([id, p]) => ({
      id,
      canvasX: p.x,
      canvasY: p.y,
    }))
    void persistPositions(tablePayload, appointmentPos)
    const timer = setTimeout(() => {
      void fitView({ padding: 0.16, duration: 240 })
    }, 80)
    return () => clearTimeout(timer)
  }, [autoArrangeVersion, tables, relations, appointmentConfigs, setNodes, persistPositions, fitView])

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent, _node: Node, allNodes: Node[]) => {
      if (!canManageSchema) return
      const tablePositions: Array<{ id: string; canvasX: number; canvasY: number }> = []
      let apptPos: { x: number; y: number } | undefined

      for (const n of allNodes) {
        if (n.id === APPOINTMENT_NODE_ID) {
          apptPos = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
        } else {
          tablePositions.push({
            id: n.id,
            canvasX: Math.round(n.position.x),
            canvasY: Math.round(n.position.y),
          })
        }
      }
      void persistPositions(tablePositions, apptPos)
    },
    [canManageSchema, persistPositions]
  )

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return
      openConnectionFlow(conn.source, conn.target)
    },
    [openConnectionFlow]
  )

  const handleConfirmTableConnection = async () => {
    if (!pendingTableConnection) return
    setSavingConnection(true)
    try {
      const cardinality: RelationCardinality = pendingTableConnection.allowMultiple
        ? 'many_to_many'
        : 'one_to_one'
      const res = await fetch('/api/dynamic-tables/relations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceTableId: pendingTableConnection.sourceId,
          targetTableId: pendingTableConnection.targetId,
          cardinality,
          createInverseColumn: true,
          onDelete: 'set_null',
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(payload.error || 'Bağlantı kurulamadı')
        return
      }
      setPendingTableConnection(null)
      onSchemaMutated()
      toast.success('İki liste birbirine bağlandı! Sağdaki randevu kartından hemen deneyebilirsiniz.')
    } catch {
      toast.error('Bağlantı kurulurken ağ hatası oluştu')
    } finally {
      setSavingConnection(false)
    }
  }

  const handleConfirmApptConnection = async () => {
    if (!pendingApptConnection) return
    const tbl = tables.find((t) => t.id === pendingApptConnection.tableId)
    if (!tbl) return
    setSavingApptConnection(true)
    try {
      const existing = appointmentConfigs.find((c) => c.tableId === tbl.id) || null
      await saveTableAppointmentUsageMode(tbl, pendingApptConnection.mode, {
        existingConfig: existing,
        isRequiredInAppointment: pendingApptConnection.mode === 'person',
      })
      setPendingApptConnection(null)
      onSchemaMutated()
      toast.success(`"${tbl.name}" randevu ekranına eklendi`)
    } catch (err: any) {
      toast.error(err?.message || 'Randevu bağlantısı kaydedilemedi')
    } finally {
      setSavingApptConnection(false)
    }
  }

  const handleCreateTableInline = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = newTableName.trim()
    if (!clean) {
      toast.error('Lütfen yeni liste adını yazınız')
      return
    }
    setCreatingTable(true)
    try {
      const created = await createDynamicTableWithPurpose(clean, newTablePurpose)
      const nextY = 70 + (tables.length % 3) * 260
      const nextX = 70 + Math.floor(tables.length / 3) * 350
      await fetch(`/api/dynamic-tables/tables/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvasX: nextX, canvasY: nextY }),
      }).catch(() => {})

      setNewTableName('')
      setAddingTable(false)
      onTableCreated(created.id)
      toast.success(`"${clean}" listesi eklendi`)
    } catch (err: any) {
      toast.error(err?.message || 'Liste oluşturulamadı')
    } finally {
      setCreatingTable(false)
    }
  }

  // Seçili Edge bilgisi
  const selectedRelationInfo = useMemo(() => {
    if (!selectedEdgeId) return null
    if (selectedEdgeId.startsWith('rel-')) {
      const relId = selectedEdgeId.replace('rel-', '')
      const rel = relations.find((r) => r.id === relId)
      if (!rel) return null
      const src = tables.find((t) => t.id === rel.sourceTableId)
      const tgt = tables.find((t) => t.id === rel.targetTableId)
      if (!src || !tgt) return null
      return { kind: 'relation' as const, rel, src, tgt }
    }
    if (selectedEdgeId.startsWith('appt-')) {
      const tableId = selectedEdgeId.replace('appt-', '')
      const tbl = tables.find((t) => t.id === tableId)
      const cfg = appointmentConfigs.find((c) => c.tableId === tableId && c.enabled)
      if (!tbl || !cfg) return null
      return { kind: 'appointment' as const, tbl, cfg }
    }
    return null
  }, [selectedEdgeId, relations, tables, appointmentConfigs])

  const handleDeleteSelectedEdge = async () => {
    if (!selectedRelationInfo) return
    try {
      if (selectedRelationInfo.kind === 'relation') {
        const res = await fetch(`/api/dynamic-tables/relations/${selectedRelationInfo.rel.id}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          toast.error('Bağlantı kaldırılamadı')
          return
        }
        toast.success('Bağlantı kaldırıldı')
      } else {
        await saveTableAppointmentUsageMode(selectedRelationInfo.tbl, 'off')
        toast.success(`"${selectedRelationInfo.tbl.name}" randevu ekranından çıkarıldı`)
      }
      setSelectedEdgeId(null)
      setConfirmRemoveEdge(false)
      onSchemaMutated()
    } catch {
      toast.error('İşlem tamamlanamadı')
    }
  }

  const pendingSourceTable = pendingTableConnection
    ? tables.find((t) => t.id === pendingTableConnection.sourceId) || null
    : null
  const pendingTargetTable = pendingTableConnection
    ? tables.find((t) => t.id === pendingTableConnection.targetId) || null
    : null
  const pendingApptTable = pendingApptConnection
    ? tables.find((t) => t.id === pendingApptConnection.tableId) || null
    : null
  const activeLinkingSource = linkingFromTableId
    ? tables.find((t) => t.id === linkingFromTableId) || null
    : null

  useEffect(() => {
    const el = viewportRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void fitView({ padding: 0.14, duration: 150 })
      }, 140)
    })
    observer.observe(el)
    return () => {
      if (timer) clearTimeout(timer)
      observer.disconnect()
    }
  }, [fitView])

  const selectedPendingBlueprint = pendingBlueprintKey
    ? STARTER_BLUEPRINTS.find((b) => b.key === pendingBlueprintKey) || null
    : null

  return (
    <div className={styles.diagramCard}>
      {/* Üst Araç Çubuğu */}
      <div className={styles.canvasToolbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', minWidth: 0 }}>
          <Sparkles size={15} style={{ color: 'var(--pc-blue)', flexShrink: 0 }} />
          <strong style={{ fontSize: 13.5, color: 'var(--foreground)' }}>
            İlişki Şeması ve Randevu Akışı
          </strong>
          <InfoTooltip title="İlişki Şeması Nasıl Çalışır?">
            <div>
              <strong>1. Rolü Seçin:</strong> Tablo kartından &ldquo;Müşteri / Kişi&rdquo; veya &ldquo;Konu / Hizmet&rdquo; rolünü belirleyin.
              <br />
              <strong>2. Tabloları Bağlayın:</strong> Kartın altındaki &ldquo;Başka Tabloya Bağla&rdquo; butonuna basıp hedef tabloya tıklayın.
              <br />
              <strong>3. Canlı Önizleyin:</strong> &ldquo;Randevu Formu Canlı Önizleme&rdquo; kartında seçeneklere tıklayarak akışı test edin.
            </div>
          </InfoTooltip>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {canManageSchema && onApplyBlueprint && (
            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                type="button"
                disabled={applyingBlueprint !== null}
                onClick={() => {
                  setPendingBlueprintKey(null)
                  setTemplateMenuOpen((v) => !v)
                }}
                className={depth.btnPale}
                style={{ minHeight: 30, padding: '4px 10px', fontSize: 12 }}
                title="Klinik, Emlak, Sigorta, Danışmanlık veya Teknik Servis hazır şablonlarını kurar"
              >
                <Sparkles size={13} />
                <span>
                  {applyingBlueprint ? 'Şablon Kuruluyor…' : 'Hazır Şablonlar'}
                </span>
                <ChevronDown size={13} />
              </button>

              {templateMenuOpen && (
                <>
                  <div
                    onClick={() => {
                      setPendingBlueprintKey(null)
                      setTemplateMenuOpen(false)
                    }}
                    style={{ position: 'fixed', inset: 0, zIndex: 45, background: 'transparent' }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      right: 0,
                      zIndex: 50,
                      width: 'min(336px, calc(100vw - 24px))',
                      maxHeight: 'min(430px, calc(100vh - 180px))',
                      overflowY: 'auto',
                      borderRadius: 13,
                      border: '1.5px solid var(--input-border)',
                      background: 'var(--card-bg)',
                      boxShadow: 'var(--pc-modal-shadow)',
                      padding: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                    }}
                  >
                    {selectedPendingBlueprint && tables.length > 0 ? (
                      <div className={depth.subcard} style={{ padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--foreground)' }}>
                          {selectedPendingBlueprint.title} kurulsun mu?
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--pc-muted)', lineHeight: 1.45 }}>
                          Eski şablon tablolarının yeni şablonla karışmaması için mevcut tablolar sıfırlanıp yalnızca seçtiğiniz sektör şablonu kurulacaktır.
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => setPendingBlueprintKey(null)}
                            className={depth.btn}
                            style={{ minHeight: 28, padding: '3px 10px', fontSize: 11.5 }}
                          >
                            Vazgeç
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const key = selectedPendingBlueprint.key
                              setPendingBlueprintKey(null)
                              setTemplateMenuOpen(false)
                              onApplyBlueprint(key)
                            }}
                            className={depth.btnPrimary}
                            style={{ minHeight: 28, padding: '3px 11px', fontSize: 11.5 }}
                          >
                            <Check size={12} color="#ffffff" />
                            <span>Şablonu Kur</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div
                          style={{
                            padding: '3px 6px',
                            fontSize: 11,
                            fontWeight: 800,
                            color: 'var(--pc-muted)',
                          }}
                        >
                          Sektör Bağımsız Hazır Şablonlar
                        </div>
                        {STARTER_BLUEPRINTS.map((bp) => (
                          <button
                            key={bp.key}
                            type="button"
                            disabled={applyingBlueprint !== null}
                            onClick={() => {
                              if (tables.length > 0) {
                                setPendingBlueprintKey(bp.key)
                              } else {
                                setTemplateMenuOpen(false)
                                onApplyBlueprint(bp.key)
                              }
                            }}
                            className={depth.subcard}
                            style={{
                              textAlign: 'left',
                              padding: '8px 10px',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 3,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                              <strong style={{ fontSize: 12, color: 'var(--foreground)' }}>
                                {bp.title}
                              </strong>
                              <span className={depth.badge} style={{ fontSize: 9.5, padding: '1px 6px' }}>
                                {bp.sectorBadge}
                              </span>
                            </div>
                            <span style={{ fontSize: 10.5, color: 'var(--pc-muted)', lineHeight: 1.35 }}>
                              {bp.subtitle}
                            </span>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {canManageSchema && (
            <>
              {addingTable ? (
                <form
                  onSubmit={handleCreateTableInline}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                >
                  <input
                    type="text"
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    placeholder="Tablo adı (Örn: İlanlar, Teklifler)…"
                    className={depth.input}
                    style={{ width: 'min(185px, 100%)', minHeight: 30, fontSize: 12 }}
                    autoFocus
                  />
                  {[
                    { key: 'person' as const, label: 'Müşteri / Kişi' },
                    { key: 'service' as const, label: 'Konu / Hizmet' },
                    { key: 'detail' as const, label: 'Alt Detay' },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setNewTablePurpose(opt.key)}
                      className={newTablePurpose === opt.key ? depth.btnPale : depth.btn}
                      style={{ minHeight: 28, padding: '2px 8px', fontSize: 11 }}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button
                    type="submit"
                    disabled={creatingTable}
                    className={depth.btnPrimary}
                    style={{ minHeight: 29, padding: '3px 10px', fontSize: 12 }}
                  >
                    <Check size={13} color="#ffffff" />
                    <span>{creatingTable ? 'Ekleniyor…' : 'Oluştur'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingTable(false)}
                    className={depth.btn}
                    style={{ minHeight: 29, padding: '3px 8px' }}
                  >
                    <X size={13} />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingTable(true)}
                  className={depth.btnPrimary}
                  style={{ minHeight: 30, padding: '4px 11px', fontSize: 12 }}
                >
                  <Plus size={14} color="#ffffff" />
                  <span>Tablo Ekle</span>
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={handleAutoLayout}
            className={depth.btn}
            style={{ minHeight: 30, padding: '4px 10px', fontSize: 12 }}
          >
            <LayoutGrid size={13} />
            <span>Hizala</span>
          </button>
        </div>
      </div>

      {/* Tıklayarak Bağlama Modu Bilgilendirme Şeridi */}
      {activeLinkingSource && (
        <div className={styles.canvasActionBanner}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800 }}>
              <MousePointerClick size={16} style={{ color: 'var(--pc-blue)' }} />
              <span>
                Şimdi &ldquo;{activeLinkingSource.name}&rdquo; listesini bağlamak istediğiniz kartın üzerindeki mavi butona tıklayın!
              </span>
            </span>
            <button
              type="button"
              onClick={() => setLinkingFromTableId(null)}
              className={depth.btn}
              style={{ minHeight: 28, padding: '3px 10px', fontSize: 12 }}
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {/* İki Liste Bağlanırken Sorulan TEK BASİT İNSAN DİLİ SORUSU */}
      {pendingTableConnection && pendingSourceTable && pendingTargetTable && (
        <div className={styles.canvasActionBanner}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 800 }}>
              <Link2 size={16} style={{ color: 'var(--pc-blue)' }} />
              <span>
                Bir &ldquo;{pendingSourceTable.name}&rdquo; seçildiğinde içinde kaç tane &ldquo;{pendingTargetTable.name}&rdquo; seçilebilsin?
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                disabled={savingConnection}
                onClick={() => void handleConfirmTableConnection()}
                className={depth.btnPrimary}
                style={{ minHeight: 31, padding: '4px 14px', fontSize: 12.5 }}
              >
                <Check size={14} color="#ffffff" />
                <span>{savingConnection ? 'Bağlanıyor…' : 'Bağlantıyı Tamamla'}</span>
              </button>
              <button
                type="button"
                onClick={() => setPendingTableConnection(null)}
                className={depth.btn}
                style={{ minHeight: 31, padding: '4px 10px', fontSize: 12 }}
              >
                Vazgeç
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
            <button
              type="button"
              onClick={() =>
                setPendingTableConnection((prev) => (prev ? { ...prev, allowMultiple: true } : null))
              }
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 11,
                border: pendingTableConnection.allowMultiple
                  ? '2px solid #2563eb'
                  : '1px solid var(--pc-border)',
                background: pendingTableConnection.allowMultiple ? 'var(--pc-tint)' : 'var(--card-bg)',
                color: 'var(--foreground)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>
                ✓ Birden Fazla Seçilebilsin (En Yaygın — Önerilen)
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--pc-muted)', marginTop: 4, lineHeight: 1.4 }}>
                Örnek: <strong>{samplePreviewTitle(pendingSourceTable.name, 1)}</strong> seçildiğinde yanına hem{' '}
                <strong>{samplePreviewTitle(pendingTargetTable.name, 1)}</strong> hem{' '}
                <strong>{samplePreviewTitle(pendingTargetTable.name, 2)}</strong> eklenebilir.
              </div>
            </button>

            <button
              type="button"
              onClick={() =>
                setPendingTableConnection((prev) => (prev ? { ...prev, allowMultiple: false } : null))
              }
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 11,
                border: !pendingTableConnection.allowMultiple
                  ? '2px solid #2563eb'
                  : '1px solid var(--pc-border)',
                background: !pendingTableConnection.allowMultiple ? 'var(--pc-tint)' : 'var(--card-bg)',
                color: 'var(--foreground)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>
                Sadece 1 Tane Seçilebilsin
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--pc-muted)', marginTop: 4, lineHeight: 1.4 }}>
                Örnek: Her <strong>{pendingSourceTable.name}</strong> kaydı için listeden yalnızca tek bir{' '}
                <strong>{pendingTargetTable.name}</strong> seçilir.
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Takvim Kartına Bağlanırken Sorulan Soru */}
      {pendingApptConnection && pendingApptTable && (
        <div className={styles.canvasActionBanner}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 800 }}>
              <Calendar size={16} style={{ color: 'var(--pc-blue)' }} />
              <span>
                &ldquo;{pendingApptTable.name}&rdquo; randevu oluştururken ne olarak sorulsun?
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                disabled={savingApptConnection}
                onClick={() => void handleConfirmApptConnection()}
                className={depth.btnPrimary}
                style={{ minHeight: 31, padding: '4px 14px', fontSize: 12.5 }}
              >
                <Check size={14} color="#ffffff" />
                <span>{savingApptConnection ? 'Kaydediliyor…' : 'Randevuya Ekle'}</span>
              </button>
              <button
                type="button"
                onClick={() => setPendingApptConnection(null)}
                className={depth.btn}
                style={{ minHeight: 31, padding: '4px 10px', fontSize: 12 }}
              >
                Vazgeç
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
            {[
              {
                key: 'person' as const,
                title: '① Müşteri / Kişi Seçimi (Tek Kayıt)',
                desc: 'Randevu veya görüşme kimin adına açılıyorsa listeden 1 kişi seçilir (Örn: Müşteriler, Adaylar, Sigortalılar).',
              },
              {
                key: 'service' as const,
                title: '② Konu / Teklif / Hizmet Seçimi (Çoklu Kayıt)',
                desc: 'Randevuda birden fazla ilan, teklif veya hizmet seçilebilir; bağlı alt tablolar da (Teminat, Özellik, Mülk Sahibi vb.) altında otomatik açılır.',
              },
            ].map((opt) => {
              const active = pendingApptConnection.mode === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() =>
                    setPendingApptConnection((prev) => (prev ? { ...prev, mode: opt.key } : null))
                  }
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: 11,
                    border: active ? '2px solid #2563eb' : '1px solid var(--pc-border)',
                    background: active ? 'var(--pc-tint)' : 'var(--card-bg)',
                    color: 'var(--foreground)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 800 }}>{opt.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--pc-muted)', marginTop: 4 }}>
                    {opt.desc}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Seçili Bağlantı Çizgisi Bilgi & Silme Çubuğu */}
      {selectedRelationInfo && !pendingTableConnection && !pendingApptConnection && (
        <div className={styles.canvasActionBanner}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            {selectedRelationInfo.kind === 'relation' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, flexWrap: 'wrap' }}>
                <Link2 size={14} style={{ color: 'var(--pc-blue)' }} />
                <strong>{selectedRelationInfo.src.name}</strong>
                <ArrowRight size={13} style={{ color: 'var(--pc-muted)' }} />
                <strong>{selectedRelationInfo.tgt.name}</strong>
                <span className={depth.badge}>
                  {plainSentenceEdgeLabel(selectedRelationInfo.rel, selectedRelationInfo.tgt.name)}
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, flexWrap: 'wrap' }}>
                <Calendar size={14} style={{ color: 'var(--pc-blue)' }} />
                <strong>{selectedRelationInfo.tbl.name}</strong>
                <ArrowRight size={13} style={{ color: 'var(--pc-muted)' }} />
                <strong>Canlı Randevu Ekranı</strong>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {canManageSchema && (
                confirmRemoveEdge ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleDeleteSelectedEdge()}
                      className={depth.btn}
                      style={{ minHeight: 28, padding: '3px 10px', fontSize: 11.5, color: 'var(--danger)' }}
                    >
                      Evet, Bağlantıyı Kaldır
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveEdge(false)}
                      className={depth.btn}
                      style={{ minHeight: 28, padding: '3px 9px', fontSize: 11.5 }}
                    >
                      Vazgeç
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveEdge(true)}
                    className={depth.btn}
                    style={{ minHeight: 28, padding: '3px 10px', fontSize: 11.5, color: 'var(--danger)' }}
                  >
                    <Trash2 size={12} />
                    <span>Bağlantıyı Kaldır</span>
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => setSelectedEdgeId(null)}
                className={depth.btn}
                style={{ minHeight: 28, padding: '3px 8px' }}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Etkileşimli Görsel Harita (@xyflow/react) */}
      <div ref={viewportRef} className={styles.canvasViewport}>
        <div className={styles.canvasFlowInner}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onInit={(instance) => {
              setTimeout(() => {
                void instance.fitView({ padding: 0.14, duration: 0 })
              }, 60)
            }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onNodeDragStop={handleNodeDragStop}
            onEdgeClick={(_e, edge) => {
              setConfirmRemoveEdge(false)
              setSelectedEdgeId((prev) => (prev === edge.id ? null : edge.id))
            }}
            onPaneClick={() => {
              setSelectedEdgeId(null)
              setConfirmRemoveEdge(false)
              setLinkingFromTableId(null)
            }}
            nodeTypes={NODE_TYPES}
            connectionMode={ConnectionMode.Loose}
            nodesDraggable={canManageSchema}
            nodesConnectable={canManageSchema}
            fitView
            fitViewOptions={{ padding: 0.14 }}
            minZoom={0.35}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} color="var(--pc-border)" />
            <CanvasZoomControls />
          </ReactFlow>
        </div>
      </div>
    </div>
  )
}

export default function SchemaCanvasPanel(props: SchemaCanvasPanelProps) {
  return (
    <ReactFlowProvider>
      <SchemaCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
