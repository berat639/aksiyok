'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Trash2, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useBackdropDismiss } from '@/hooks/useBackdropDismiss'
import depth from '@/styles/clinic-depth.module.css'
import {
  MODULE_ROLE_META,
  TABLE_ORIGIN_META,
  type DynamicAppointmentConfigDef,
  type DynamicModuleConfigDef,
  type DynamicRelationDef,
  type DynamicTableDef,
  type DynamicTableOrigin,
  type StudioSchemaResponse,
} from './types'

interface BulkClearTablesModalProps {
  isOpen: boolean
  tables: DynamicTableDef[]
  relations: DynamicRelationDef[]
  appointmentConfigs: DynamicAppointmentConfigDef[]
  moduleConfigs?: DynamicModuleConfigDef[]
  onClose: () => void
  onCleared: (nextSchema: StudioSchemaResponse, deletedCount: number) => void
}

function resolveTableOrigin(table: DynamicTableDef): DynamicTableOrigin {
  const o = table.origin
  if (o === 'template' || o === 'ai' || o === 'system' || o === 'manual') return o
  return 'manual'
}

export default function BulkClearTablesModal({
  isOpen,
  tables,
  relations,
  appointmentConfigs,
  moduleConfigs = [],
  onClose,
  onCleared,
}: BulkClearTablesModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [clearing, setClearing] = useState(false)

  const manualTableIds = useMemo(
    () => tables.filter((t) => resolveTableOrigin(t) === 'manual').map((t) => t.id),
    [tables]
  )

  const allTableIds = useMemo(() => tables.map((t) => t.id), [tables])

  // Smart default: when both manual and template/AI/system tables exist, pre-select only manual tables
  useEffect(() => {
    if (!isOpen) return
    if (manualTableIds.length > 0 && manualTableIds.length < allTableIds.length) {
      setSelectedIds(new Set(manualTableIds))
    } else {
      setSelectedIds(new Set(allTableIds))
    }
  }, [isOpen, manualTableIds, allTableIds])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !clearing) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, clearing, onClose])

  const backdropDismiss = useBackdropDismiss(() => {
    if (!clearing) onClose()
  })

  const apptRoleByTableId = useMemo(() => {
    const map = new Map<string, string>()
    for (const cfg of appointmentConfigs) {
      if (!cfg.enabled) continue
      map.set(cfg.tableId, cfg.allowMultiple ? 'Konu / Hizmet' : 'Müşteri / Kişi')
    }
    return map
  }, [appointmentConfigs])

  const moduleRoleByTableId = useMemo(() => {
    const map = new Map<string, string>()
    for (const cfg of moduleConfigs) {
      if (!cfg.enabled) continue
      const meta = MODULE_ROLE_META[cfg.moduleRole]
      if (meta) map.set(cfg.tableId, meta.shortBadge)
    }
    return map
  }, [moduleConfigs])

  const selectedCount = selectedIds.size
  const isAllSelected = tables.length > 0 && selectedCount === tables.length
  const isExactManualSelected =
    manualTableIds.length > 0 &&
    selectedCount === manualTableIds.length &&
    manualTableIds.every((id) => selectedIds.has(id))

  const totalSelectedRecords = useMemo(() => {
    let sum = 0
    for (const t of tables) {
      if (selectedIds.has(t.id)) {
        sum += Number(t.rowCount || 0) + Number(t.archivedRowCount || 0)
      }
    }
    return sum
  }, [tables, selectedIds])

  const affectsKeptRelations = useMemo(() => {
    if (selectedCount === 0 || isAllSelected) return false
    return relations.some(
      (r) =>
        (selectedIds.has(r.sourceTableId) && !selectedIds.has(r.targetTableId)) ||
        (!selectedIds.has(r.sourceTableId) && selectedIds.has(r.targetTableId))
    )
  }, [relations, selectedIds, selectedCount, isAllSelected])

  if (!isOpen) return null

  const toggleTable = (tableId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(tableId)) next.delete(tableId)
      else next.add(tableId)
      return next
    })
  }

  const handleConfirmClear = async () => {
    if (clearing || selectedIds.size === 0) return
    setClearing(true)
    try {
      const payload = isAllSelected
        ? { mode: 'all' as const }
        : { mode: 'selected' as const, tableIds: Array.from(selectedIds) }

      const res = await fetch('/api/dynamic-tables/tables/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Tablolar temizlenemedi')
        return
      }
      const deletedCount = Number(data.deletedCount ?? selectedIds.size)
      if (data.schema) {
        onCleared(data.schema, deletedCount)
      }
      onClose()
      toast.success(
        isAllSelected
          ? `Tüm tablolar (${deletedCount}) temizlendi`
          : `${deletedCount} tablo temizlendi`
      )
    } catch {
      toast.error('Tablolar temizlenirken ağ hatası oluştu')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className={depth.backdrop} style={{ zIndex: 100000 }} {...backdropDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-clear-tables-title"
        className={depth.modal}
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Başlık */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '15px 18px',
            borderBottom: '1px solid var(--input-border)',
            background: 'var(--card-inner)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#dc2626',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--pc-clay-primary)',
                flexShrink: 0,
              }}
            >
              <Trash2 size={16} color="#ffffff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                id="bulk-clear-tables-title"
                style={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: 'var(--foreground)',
                  lineHeight: 1.2,
                }}
              >
                Tabloları Temizle
              </div>
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--foreground-3)',
                  marginTop: 2,
                }}
              >
                Toplu silinecek tabloları seçin (geri alınamaz)
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={clearing}
            aria-label="Kapat"
            style={{
              background: 'var(--input-bg)',
              border: '1px solid var(--input-border)',
              borderRadius: 7,
              width: 28,
              height: 28,
              cursor: clearing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--foreground-2)',
              flexShrink: 0,
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Gövde */}
        <div
          style={{
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            overflowY: 'auto',
          }}
        >
          {/* Hızlı Seçim Butonları */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={manualTableIds.length === 0 || clearing}
              onClick={() => setSelectedIds(new Set(manualTableIds))}
              className={isExactManualSelected && !isAllSelected ? depth.btnPrimary : depth.btnPale}
              style={{ minHeight: 29, padding: '4px 10px', fontSize: 12 }}
            >
              <span>Manuel Eklenenler ({manualTableIds.length})</span>
            </button>
            <button
              type="button"
              disabled={tables.length === 0 || clearing}
              onClick={() => setSelectedIds(new Set(allTableIds))}
              className={isAllSelected ? depth.btnPrimary : depth.btn}
              style={{ minHeight: 29, padding: '4px 10px', fontSize: 12 }}
            >
              <span>Tüm Tablolar ({tables.length})</span>
            </button>
            <button
              type="button"
              disabled={selectedCount === 0 || clearing}
              onClick={() => setSelectedIds(new Set())}
              className={depth.btn}
              style={{ minHeight: 29, padding: '4px 10px', fontSize: 12 }}
            >
              <span>Seçimi Kaldır</span>
            </button>
          </div>

          {/* Tablo Seçim Listesi */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              maxHeight: 265,
              overflowY: 'auto',
              padding: 8,
              borderRadius: 11,
              border: '1px solid var(--input-border)',
              background: 'var(--input-bg)',
              boxShadow: 'var(--pc-neo-inset)',
            }}
          >
            {tables.map((table) => {
              const checked = selectedIds.has(table.id)
              const origin = resolveTableOrigin(table)
              const originLabel = TABLE_ORIGIN_META[origin].label
              const apptBadge = apptRoleByTableId.get(table.id)
              const modBadge = moduleRoleByTableId.get(table.id)
              const totalRows = Number(table.rowCount || 0) + Number(table.archivedRowCount || 0)

              return (
                <label
                  key={table.id}
                  className={depth.subcard}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    cursor: clearing ? 'not-allowed' : 'pointer',
                    borderColor: checked ? 'var(--danger)' : 'var(--input-border)',
                    background: checked ? 'var(--flow-danger-bg)' : 'var(--card-bg)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={clearing}
                    onChange={() => toggleTable(table.id)}
                    style={{
                      width: 16,
                      height: 16,
                      accentColor: '#dc2626',
                      cursor: clearing ? 'not-allowed' : 'pointer',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      background: table.color || '#0284c7',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: 'var(--foreground)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {table.name}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        flexWrap: 'wrap',
                        marginTop: 3,
                      }}
                    >
                      <span
                        className={depth.badge}
                        style={{ fontSize: 10, padding: '1px 6px' }}
                      >
                        {originLabel}
                      </span>
                      {apptBadge && (
                        <span
                          className={depth.badge}
                          style={{ fontSize: 10, padding: '1px 6px' }}
                        >
                          {apptBadge}
                        </span>
                      )}
                      {modBadge && (
                        <span
                          className={depth.badge}
                          style={{ fontSize: 10, padding: '1px 6px' }}
                        >
                          {modBadge}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--foreground-3)' }}>
                        {totalRows} kayıt
                      </span>
                    </div>
                  </div>
                  {checked && (
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: '#dc2626',
                        color: '#ffffff',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Check size={12} color="#ffffff" />
                    </span>
                  )}
                </label>
              )
            })}
          </div>

          {/* Uyarı Özeti */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--input-border)',
              background: 'var(--card-inner)',
              fontSize: 12,
              lineHeight: 1.45,
              color: 'var(--foreground-2)',
            }}
          >
            <AlertTriangle
              size={16}
              style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }}
            />
            <div>
              {selectedCount > 0 ? (
                <>
                  <strong style={{ color: 'var(--foreground)' }}>
                    {selectedCount} tablo
                  </strong>{' '}
                  ve içindeki{' '}
                  <strong style={{ color: 'var(--foreground)' }}>
                    {totalSelectedRecords} kayıt
                  </strong>{' '}
                  kalıcı olarak silinecektir.
                  {affectsKeptRelations && (
                    <div style={{ marginTop: 4 }}>
                      Silinen tablolara bağlı diğer tablolardaki ilişki sütunları da otomatik kaldırılır.
                    </div>
                  )}
                </>
              ) : (
                <span>Temizlemek istediğiniz en az bir tablo seçin.</span>
              )}
            </div>
          </div>
        </div>

        {/* Alt Butonlar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 18px',
            borderTop: '1px solid var(--input-border)',
            background: 'var(--card-inner)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={clearing}
            className={depth.btn}
            style={{ minHeight: 34, padding: '6px 14px', fontSize: 12.5 }}
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={clearing || selectedCount === 0}
            onClick={() => void handleConfirmClear()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              minHeight: 34,
              padding: '6px 15px',
              borderRadius: 9,
              border: '1px solid #b91c1c',
              background: '#dc2626',
              color: '#ffffff',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: clearing || selectedCount === 0 ? 'not-allowed' : 'pointer',
              opacity: clearing || selectedCount === 0 ? 0.55 : 1,
              boxShadow: 'var(--pc-clay-primary)',
            }}
          >
            <Trash2 size={14} color="#ffffff" />
            <span style={{ color: '#ffffff' }}>
              {clearing
                ? 'Temizleniyor…'
                : isAllSelected
                ? `Tüm Tabloları Temizle (${selectedCount})`
                : `Seçili Tabloları Temizle (${selectedCount})`}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
