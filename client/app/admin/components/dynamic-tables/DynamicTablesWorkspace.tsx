'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  Database,
  Edit3,
  Link2,
  Plus,
  Sparkles,
  Table2,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import InfoTooltip from '../ui/InfoTooltip'
import BulkClearTablesModal from './BulkClearTablesModal'
import DynamicDataGridPanel from './DynamicDataGridPanel'
import styles from './DynamicTablesStudio.module.css'
import ScenarioAiBuilderBox from './ScenarioAiBuilderBox'
import SchemaCanvasPanel from './SchemaCanvasPanel'
import TablePropertiesPanel from './TablePropertiesPanel'
import {
  createDynamicTableWithPurpose,
  STARTER_BLUEPRINTS,
  type StarterBlueprintKey,
  type TablePurpose,
} from './tableSetupHelpers'
import type { DynamicTableDef, StudioSchemaResponse } from './types'

export default function DynamicTablesWorkspace() {
  const [schema, setSchema] = useState<StudioSchemaResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [focusedDetailRowId, setFocusedDetailRowId] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [autoArrangeVersion, setAutoArrangeVersion] = useState(0)
  const [diagramPropertiesTableId, setDiagramPropertiesTableId] = useState<string | null>(null)

  // Editable tab title state
  const [editingLabel, setEditingLabel] = useState(false)
  const [draftLabel, setDraftLabel] = useState('')

  // Zero-state inline create table state
  const [starterPurpose, setStarterPurpose] = useState<TablePurpose>('person')
  const [starterTableName, setStarterTableName] = useState('')
  const [creatingStarterTable, setCreatingStarterTable] = useState(false)
  const [applyingBlueprint, setApplyingBlueprint] = useState<string | null>(null)
  const [clearModalOpen, setClearModalOpen] = useState(false)

  const loadSchema = useCallback(async () => {
    try {
      const res = await fetch('/api/dynamic-tables/schema')
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Tablo yapısı yüklenemedi')
        return
      }
      setSchema(data)
      setSelectedTableId((curr) => {
        if (curr && data.tables?.some((t: DynamicTableDef) => t.id === curr)) return curr
        return data.tables?.[0]?.id || null
      })
    } catch {
      toast.error('Veriler yüklenirken ağ hatası oluştu')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSchema()
  }, [loadSchema])

  const handleSaveTabLabel = async () => {
    const clean = draftLabel.trim()
    if (!clean) {
      setEditingLabel(false)
      return
    }
    try {
      const res = await fetch('/api/dynamic-tables/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabLabel: clean }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Başlık güncellenemedi')
        return
      }
      setSchema(data)
      setEditingLabel(false)
      window.dispatchEvent(new CustomEvent('dynamic-studio-label-changed', { detail: clean }))
      toast.success('Modül adı güncellendi')
    } catch {
      toast.error('Modül adı kaydedilemedi')
    }
  }

  const handleCreateStarterTable = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = starterTableName.trim()
    if (!clean) {
      toast.error('Liste adı yazınız')
      return
    }
    setCreatingStarterTable(true)
    try {
      const created = await createDynamicTableWithPurpose(clean, starterPurpose)
      setStarterTableName('')
      await loadSchema()
      setSelectedTableId(created.id)
      setRefreshToken((n) => n + 1)
      toast.success(`"${clean}" listesi oluşturuldu`)
    } catch (err: any) {
      toast.error(err?.message || 'Liste oluşturulamadı')
    } finally {
      setCreatingStarterTable(false)
    }
  }

  const handleApplyBlueprint = useCallback(async (blueprint: StarterBlueprintKey) => {
    setApplyingBlueprint(blueprint)
    try {
      const res = await fetch('/api/dynamic-tables/starter-blueprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprint }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Hazır kurgu yüklenemedi')
        return
      }
      setSchema(data)
      setSelectedTableId(data.tables?.[data.tables.length - 1]?.id || data.tables?.[0]?.id || null)
      setRefreshToken((n) => n + 1)
      setAutoArrangeVersion((n) => n + 1)
      window.dispatchEvent(new Event('auth-user-refresh'))
      toast.success('Hazır şablon ve örnek kayıtlar yüklendi!')
    } catch {
      toast.error('Şablon yüklenirken hata oluştu')
    } finally {
      setApplyingBlueprint(null)
    }
  }, [])

  const triggerFullRefresh = useCallback(() => {
    void loadSchema()
    setRefreshToken((n) => n + 1)
  }, [loadSchema])

  const handleAiSchemaApplied = useCallback((nextSchema: StudioSchemaResponse) => {
    setSchema(nextSchema)
    setSelectedTableId((curr) => {
      if (curr && nextSchema.tables?.some((t) => t.id === curr)) return curr
      return nextSchema.tables?.[nextSchema.tables.length - 1]?.id || nextSchema.tables?.[0]?.id || null
    })
    setRefreshToken((n) => n + 1)
    setAutoArrangeVersion((n) => n + 1)
  }, [])

  const handleTablesCleared = useCallback((nextSchema: StudioSchemaResponse) => {
    setSchema(nextSchema)
    setDiagramPropertiesTableId((curr) =>
      curr && nextSchema.tables?.some((t) => t.id === curr) ? curr : null
    )
    setSelectedTableId((curr) => {
      if (curr && nextSchema.tables?.some((t) => t.id === curr)) return curr
      return nextSchema.tables?.[0]?.id || null
    })
    setFocusedDetailRowId(null)
    setRefreshToken((n) => n + 1)
    window.dispatchEvent(new Event('auth-user-refresh'))
  }, [])

  const handleTableCreated = useCallback(
    (newId: string) => {
      void loadSchema().then(() => {
        setSelectedTableId(newId)
        setFocusedDetailRowId(null)
        setRefreshToken((n) => n + 1)
      })
    },
    [loadSchema]
  )

  const handleNavigateToRow = useCallback((targetTableId: string, targetRowId: string) => {
    setSelectedTableId(targetTableId)
    setFocusedDetailRowId(targetRowId)
  }, [])

  const handleOpenTablePropertiesFromDiagram = useCallback((tableId: string) => {
    setSelectedTableId(tableId)
    setDiagramPropertiesTableId((curr) => (curr === tableId ? null : tableId))
  }, [])

  const diagramPropertiesTable = useMemo(
    () =>
      schema && diagramPropertiesTableId
        ? schema.tables.find((t) => t.id === diagramPropertiesTableId) || null
        : null,
    [schema, diagramPropertiesTableId]
  )

  const diagramPropertiesApptConfig = useMemo(
    () =>
      schema && diagramPropertiesTable
        ? schema.appointmentConfigs.find((c) => c.tableId === diagramPropertiesTable.id && c.enabled) ||
          null
        : null,
    [schema, diagramPropertiesTable]
  )

  const diagramPropertiesModConfig = useMemo(
    () =>
      schema && diagramPropertiesTable
        ? (schema.moduleConfigs || []).find(
            (c) => c.tableId === diagramPropertiesTable.id && c.enabled
          ) || null
        : null,
    [schema, diagramPropertiesTable]
  )

  if (loading && !schema) {
    return (
      <div className={depth.card} style={{ padding: 36, textAlign: 'center', color: 'var(--pc-muted)' }}>
        Listeler yükleniyor…
      </div>
    )
  }

  if (!schema) {
    return (
      <div className={depth.card} style={{ padding: 36, textAlign: 'center', color: 'var(--danger)' }}>
        Veriler alınamadı. Lütfen sayfayı yenileyin.
      </div>
    )
  }

  return (
    <div className={styles.workspace} data-ready="1">
      {/* Üst Başlık ve Hızlı Senaryo Oluşturucu */}
      <div className={styles.topBar}>
        <div className={styles.titleGroup}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'var(--pc-tint)',
              border: '1px solid var(--pc-border)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Database size={17} style={{ color: 'var(--pc-tint-fg)' }} />
          </span>

          {editingLabel ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <input
                type="text"
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveTabLabel()
                  if (e.key === 'Escape') setEditingLabel(false)
                }}
                className={depth.input}
                style={{ width: 'min(200px, 100%)', minHeight: 30, fontSize: 13 }}
                autoFocus
              />
              <button
                type="button"
                onClick={() => void handleSaveTabLabel()}
                className={depth.btnPrimary}
                style={{ minHeight: 28, padding: '3px 8px' }}
              >
                <Check size={13} color="#ffffff" />
              </button>
              <button
                type="button"
                onClick={() => setEditingLabel(false)}
                className={depth.btn}
                style={{ minHeight: 28, padding: '3px 8px' }}
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <h2 className={styles.studioTitle}>{schema.tabLabel || 'Veri Tabloları'}</h2>
              {schema.canManageSchema && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftLabel(schema.tabLabel || 'Veri Tabloları')
                    setEditingLabel(true)
                  }}
                  className={depth.btn}
                  style={{ minHeight: 26, padding: '2px 7px', fontSize: 11 }}
                  title="Sekme adını değiştir"
                >
                  <Edit3 size={11} />
                </button>
              )}
              <InfoTooltip title="Çalışma Alanı ve Yetki Bilgilendirmesi">
                {schema.canManageSchema ? (
                  <span>
                    Soldaki <strong>İlişki Şeması</strong> panelinden tabloları oluşturup ilişkileri ve randevu akışını kurgulayabilir; sağdaki <strong>Tablo</strong> panelinden sütunları ve kayıt verilerini anında ekleyip düzenleyebilirsiniz.
                  </span>
                ) : (
                  <span>
                    Seçili veri tablolarındaki kayıtlara yeni veri ekleyebilir ve mevcut kayıtları satır sağındaki düzenleme ikonu ile açılan pencereden güncelleyebilirsiniz.
                  </span>
                )}
              </InfoTooltip>
            </div>
          )}

          <span className={depth.badge}>
            <Table2 size={12} />
            <span>{schema.tables.length} Tablo</span>
          </span>
          {schema.canManageSchema && schema.relations.length > 0 && (
            <span className={depth.badge}>
              <Link2 size={12} />
              <span>{schema.relations.length} İlişki</span>
            </span>
          )}
        </div>

        {schema.tables.length > 0 && schema.canManageSchema && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <ScenarioAiBuilderBox
              existingTableCount={schema.tables.length}
              collapsible
              defaultExpanded={false}
              floatingDropdown
              onScenarioApplied={handleAiSchemaApplied}
            />
            <button
              type="button"
              onClick={() => setClearModalOpen(true)}
              className={`${depth.btn} keep-danger`}
              style={{
                minHeight: 32,
                padding: '5px 11px',
                fontSize: 12,
                background: 'var(--flow-danger-bg)',
                borderColor: 'var(--danger)',
                color: 'var(--danger)',
              }}
              title="Manuel eklenen veya tüm tabloları toplu temizle"
            >
              <Trash2 size={13} />
              <span>Temizle</span>
            </button>
          </div>
        )}
      </div>

      {/* Diyagramdan Açılan Detaylı Tablo Özellikleri Paneli */}
      {diagramPropertiesTable && schema.canManageSchema && (
        <div className={depth.card} style={{ padding: 0, overflow: 'hidden' }}>
          <TablePropertiesPanel
            activeTable={diagramPropertiesTable}
            allTables={schema.tables}
            relations={schema.relations}
            allAppointmentConfigs={schema.appointmentConfigs}
            appointmentConfig={diagramPropertiesApptConfig}
            moduleConfig={diagramPropertiesModConfig}
            onClose={() => setDiagramPropertiesTableId(null)}
            onMutated={triggerFullRefresh}
            onTableDeleted={() => {
              setDiagramPropertiesTableId(null)
              triggerFullRefresh()
            }}
          />
        </div>
      )}

      {/* Sıfır Tablo Durumu (Tablo Oluşturma Yetkisi Olanlar) */}
      {schema.tables.length === 0 && schema.canManageSchema && (
        <div className={styles.zeroStarterLayout}>
          <div
            className={depth.card}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: '16px 18px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <Sparkles size={18} style={{ color: 'var(--pc-blue)', flexShrink: 0 }} />
                <div>
                  <strong style={{ fontSize: 14 }}>
                    Sektörünüze Uygun Hazır Şablonla Başlayın veya Kendi Tablonuzu Oluşturun
                  </strong>
                  <div style={{ fontSize: 12.5, color: 'var(--pc-muted)' }}>
                    Klinik, emlak, sigorta, danışmanlık veya teknik servis şablonlarından birini tek tıkla kurabilir ya da sağdan senaryonuzu yazabilirsiniz.
                  </div>
                </div>
              </div>

              <form
                onSubmit={handleCreateStarterTable}
                style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
              >
                <input
                  type="text"
                  value={starterTableName}
                  onChange={(e) => setStarterTableName(e.target.value)}
                  placeholder="Tablo adı yazın (Örn: Müşteriler, İlanlar)…"
                  className={depth.input}
                  style={{ width: 'min(225px, 100%)', minHeight: 34, fontSize: 12.5 }}
                />
                {[
                  { key: 'person' as const, label: 'Müşteri / Kişi' },
                  { key: 'service' as const, label: 'Konu / Hizmet' },
                  { key: 'detail' as const, label: 'Alt Detay' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setStarterPurpose(opt.key)}
                    className={starterPurpose === opt.key ? depth.btnPale : depth.btn}
                    style={{ minHeight: 32, padding: '3px 10px', fontSize: 11.5 }}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  type="submit"
                  disabled={creatingStarterTable}
                  className={depth.btnPrimary}
                >
                  <Plus size={15} color="#ffffff" />
                  <span>{creatingStarterTable ? 'Oluşturuluyor…' : 'Tablo Oluştur'}</span>
                </button>
              </form>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 10 }}>
              {STARTER_BLUEPRINTS.map((bp, idx) => (
                <div
                  key={bp.key}
                  className={depth.subcard}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className={depth.badge} style={{ fontSize: 10, padding: '1px 6px' }}>
                        {bp.sectorBadge}
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{bp.title}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--pc-muted)', marginTop: 3 }}>
                      {bp.subtitle}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={applyingBlueprint !== null}
                    onClick={() => void handleApplyBlueprint(bp.key)}
                    className={idx < 3 ? depth.btnPrimary : depth.btnPale}
                    style={{ minHeight: 29, padding: '3px 11px', fontSize: 11.5, flexShrink: 0 }}
                  >
                    <span>{applyingBlueprint === bp.key ? 'Kuruluyor…' : 'Kur'}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          <ScenarioAiBuilderBox
            existingTableCount={0}
            collapsible={false}
            onScenarioApplied={handleAiSchemaApplied}
          />
        </div>
      )}

      {/* Sıfır Tablo Durumu (Tablo Oluşturma Yetkisi Olmayan Çalışanlar) */}
      {schema.tables.length === 0 && !schema.canManageSchema && (
        <div className={depth.card} style={{ padding: '28px 20px', textAlign: 'center' }}>
          <strong style={{ fontSize: 14, color: 'var(--foreground)' }}>
            Henüz oluşturulmuş bir veri tablosu bulunmuyor
          </strong>
          <div style={{ fontSize: 12.5, color: 'var(--pc-muted)', marginTop: 6 }}>
            Yetkili kullanıcı tabloları oluşturduğunda bu ekrandan kayıt ekleyebilir ve düzenleyebilirsiniz.
          </div>
        </div>
      )}

      {/* Tablo Oluşturma Yetkisi Varsa: Sadece Yan Yana (Solda Diyagram, Sağda Tablo) */}
      {schema.tables.length > 0 && schema.canManageSchema && (
        <div className={styles.splitWorkspace}>
          <SchemaCanvasPanel
            tables={schema.tables}
            relations={schema.relations}
            appointmentConfigs={schema.appointmentConfigs}
            moduleConfigs={schema.moduleConfigs}
            appointmentNodePosition={schema.appointmentNodePosition}
            selectedTableId={selectedTableId}
            canManageSchema={schema.canManageSchema}
            refreshToken={refreshToken}
            autoArrangeVersion={autoArrangeVersion}
            onSelectTable={setSelectedTableId}
            onOpenTableData={setSelectedTableId}
            onOpenTableProperties={handleOpenTablePropertiesFromDiagram}
            onTableCreated={handleTableCreated}
            onSchemaMutated={triggerFullRefresh}
            onApplyBlueprint={(bp) => void handleApplyBlueprint(bp)}
            applyingBlueprint={applyingBlueprint}
          />

          <div className={styles.mainTableCard}>
            <DynamicDataGridPanel
              tables={schema.tables}
              relations={schema.relations}
              appointmentConfigs={schema.appointmentConfigs}
              moduleConfigs={schema.moduleConfigs}
              selectedTableId={selectedTableId}
              canManageSchema={schema.canManageSchema}
              refreshToken={refreshToken}
              focusedDetailRowId={focusedDetailRowId}
              onChangeFocusedDetailRowId={setFocusedDetailRowId}
              onSelectTable={setSelectedTableId}
              onTableCreated={handleTableCreated}
              onDataMutated={triggerFullRefresh}
              onNavigateToRow={handleNavigateToRow}
            />
          </div>
        </div>
      )}

      {/* Tablo Oluşturma Yetkisi Yoksa: Sadece Sağdaki Tablo (Kayıt Ekleme ve Düzeltme) */}
      {schema.tables.length > 0 && !schema.canManageSchema && (
        <div className={styles.mainTableCard}>
          <DynamicDataGridPanel
            tables={schema.tables}
            relations={schema.relations}
            appointmentConfigs={schema.appointmentConfigs}
            moduleConfigs={schema.moduleConfigs}
            selectedTableId={selectedTableId}
            canManageSchema={false}
            refreshToken={refreshToken}
            focusedDetailRowId={focusedDetailRowId}
            onChangeFocusedDetailRowId={setFocusedDetailRowId}
            onSelectTable={setSelectedTableId}
            onTableCreated={handleTableCreated}
            onDataMutated={triggerFullRefresh}
            onNavigateToRow={handleNavigateToRow}
          />
        </div>
      )}
      {/* Toplu Tablo Temizleme Modalı */}
      <BulkClearTablesModal
        isOpen={clearModalOpen}
        tables={schema.tables}
        relations={schema.relations}
        appointmentConfigs={schema.appointmentConfigs}
        moduleConfigs={schema.moduleConfigs}
        onClose={() => setClearModalOpen(false)}
        onCleared={handleTablesCleared}
      />
    </div>
  )
}
