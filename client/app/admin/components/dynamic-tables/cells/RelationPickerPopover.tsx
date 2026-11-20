'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Plus, Search, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import type { DynamicTableDef, LinkedRowSummary } from '../types'

interface RelationOptionItem extends LinkedRowSummary {
  subtitle?: string
}

interface RelationPickerPopoverProps {
  targetTable: DynamicTableDef | undefined
  allowMultiple: boolean
  selectedItems: LinkedRowSummary[]
  onChange: (nextIds: string[], nextSummaries: LinkedRowSummary[]) => void
  compact?: boolean
  onNavigateToRow?: (tableId: string, rowId: string) => void
}

export default function RelationPickerPopover({
  targetTable,
  allowMultiple,
  selectedItems,
  onChange,
  compact = false,
  onNavigateToRow,
}: RelationPickerPopoverProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<RelationOptionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [quickTitle, setQuickTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 100, left: 100 })

  const loadTargetRows = useCallback(async () => {
    if (!targetTable) return
    setLoading(true)
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${targetTable.id}/rows`)
      const data = await res.json()
      if (Array.isArray(data)) {
        const secondaryCols = targetTable.columns
          .filter((c) => !c.isPrimaryTitle && c.fieldType !== 'relation' && c.fieldType !== 'boolean')
          .slice(0, 2)

        setOptions(
          data.map((r: any) => {
            const extraParts = secondaryCols
              .map((c) => r.values?.[c.id])
              .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
              .map((v) => (Array.isArray(v) ? v.join(', ') : String(v)))
            return {
              id: r.id,
              tableId: r.tableId,
              displayTitle: r.displayTitle || 'İsimsiz Kayıt',
              subtitle: extraParts.join(' • ') || undefined,
            }
          })
        )
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [targetTable])

  const updatePos = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const popW = 320
    const popH = 350
    const vw = window.innerWidth
    const vh = window.innerHeight
    let top = rect.bottom + 6
    if (top + popH > vh - 12 && rect.top - popH - 6 > 12) {
      top = rect.top - popH - 6
    }
    const left = Math.max(12, Math.min(rect.left, vw - popW - 12))
    setCoords({ top: Math.max(12, top), left })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePos()
    void loadTargetRows()

    const close = () => setOpen(false)
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !popRef.current?.contains(t)) {
        close()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', updatePos)
    }
  }, [open, updatePos, loadTargetRows])

  const selectedIds = new Set(selectedItems.map((s) => s.id))

  const toggleItem = (item: LinkedRowSummary) => {
    const cleanSummary: LinkedRowSummary = {
      id: item.id,
      tableId: item.tableId,
      displayTitle: item.displayTitle,
    }
    if (selectedIds.has(item.id)) {
      const next = selectedItems.filter((s) => s.id !== item.id)
      onChange(
        next.map((n) => n.id),
        next
      )
    } else if (!allowMultiple) {
      onChange([item.id], [cleanSummary])
      setOpen(false)
    } else {
      const next = [...selectedItems, cleanSummary]
      onChange(
        next.map((n) => n.id),
        next
      )
    }
  }

  const handleQuickCreateTargetRow = async () => {
    if (!targetTable) return
    const title = quickTitle.trim()
    if (!title) return
    const primaryCol =
      targetTable.columns.find((c) => c.isPrimaryTitle) ??
      targetTable.columns.find((c) => c.fieldType !== 'relation')
    if (!primaryCol) {
      toast.error('Hedef tabloda veri alanı bulunamadı')
      return
    }
    setCreating(true)
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${targetTable.id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: { [primaryCol.id]: title },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Kayıt oluşturulamadı')
        return
      }
      const summary: RelationOptionItem = {
        id: data.id,
        tableId: targetTable.id,
        displayTitle: data.displayTitle || title,
      }
      setOptions((prev) => [summary, ...prev])
      setQuickTitle('')
      toggleItem(summary)
      toast.success(`"${summary.displayTitle}" eklendi ve bağlandı`)
    } catch {
      toast.error('Kayıt oluşturulamadı')
    } finally {
      setCreating(false)
    }
  }

  const filtered = options.filter((o) => {
    const q = search.trim().toLocaleLowerCase('tr-TR')
    if (!q) return true
    return (
      o.displayTitle.toLocaleLowerCase('tr-TR').includes(q) ||
      (o.subtitle ? o.subtitle.toLocaleLowerCase('tr-TR').includes(q) : false)
    )
  })

  if (!targetTable) {
    return <span style={{ color: 'var(--pc-muted)', fontSize: 12 }}>Silinmiş Tablo</span>
  }

  return (
    <>
      <div
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 4,
          minHeight: compact ? 26 : 34,
          padding: compact ? '2px 4px' : '5px 8px',
          borderRadius: 9,
          border: compact ? '1px solid transparent' : '1px solid var(--pc-border)',
          background: compact ? 'transparent' : 'var(--input-bg)',
          boxShadow: compact ? 'none' : 'var(--pc-neo-inset)',
          cursor: 'pointer',
        }}
      >
        {selectedItems.length === 0 ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              color: 'var(--pc-tint-fg)',
              fontWeight: 600,
            }}
          >
            <Plus size={12} />
            <span>{targetTable.name} seç</span>
          </span>
        ) : (
          <>
            {selectedItems.map((item) => (
              <span
                key={item.id}
                className={depth.badge}
                onClick={(e) => {
                  if (onNavigateToRow) {
                    e.stopPropagation()
                    onNavigateToRow(item.tableId, item.id)
                  }
                }}
                title={onNavigateToRow ? `${targetTable.name} kaydına git` : item.displayTitle}
                style={{
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.displayTitle}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleItem(item)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation()
                      toggleItem(item)
                    }
                  }}
                  title="Bağlantıyı kaldır"
                  style={{ display: 'inline-flex', marginLeft: 2 }}
                >
                  <X size={11} />
                </span>
              </span>
            ))}
            {allowMultiple && (
              <span
                title={`Başka ${targetTable.name} ekle`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  border: '1px solid var(--pc-border)',
                  background: 'var(--pc-surface)',
                  color: 'var(--pc-tint-fg)',
                }}
              >
                <Plus size={11} />
              </span>
            )}
          </>
        )}
      </div>

      {open &&
        typeof document !== 'undefined' &&
        Boolean(document.body) &&
        createPortal(
          <div
            ref={popRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              width: 320,
              zIndex: 200060,
              borderRadius: 14,
              border: '1.5px solid var(--input-border)',
              background: 'var(--card-bg)',
              color: 'var(--foreground)',
              boxShadow: 'var(--pc-modal-shadow)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '9px 12px',
                borderBottom: '1px solid var(--pc-border)',
                background: 'var(--pc-surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{targetTable.name} Seçin</div>
                <div style={{ fontSize: 11, color: 'var(--pc-muted)' }}>
                  {allowMultiple ? 'Birden fazla kayıt seçebilirsiniz' : 'Listeden bir kayıt seçin'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={depth.btn}
                style={{ minHeight: 24, padding: '2px 6px' }}
              >
                <X size={13} />
              </button>
            </div>

            <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--pc-border)' }}>
              <div style={{ position: 'relative' }}>
                <Search
                  size={13}
                  style={{
                    position: 'absolute',
                    left: 9,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--pc-muted)',
                  }}
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`${targetTable.name} ara…`}
                  className={depth.input}
                  style={{ paddingLeft: 28, minHeight: 30, fontSize: 12.5 }}
                  autoFocus
                />
              </div>
            </div>

            <div style={{ maxHeight: 195, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {loading ? (
                <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: 'var(--pc-muted)' }}>
                  Yükleniyor…
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: 'var(--pc-muted)' }}>
                  Henüz eşleşen kayıt yok. Aşağıdan hemen yeni ekleyebilirsiniz.
                </div>
              ) : (
                filtered.map((opt) => {
                  const checked = selectedIds.has(opt.id)
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleItem(opt)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: 9,
                        border: checked ? '1px solid var(--pc-blue)' : '1px solid transparent',
                        background: checked ? 'var(--pc-tint)' : 'var(--card-bg)',
                        color: 'var(--foreground)',
                        fontSize: 12.5,
                        fontWeight: checked ? 700 : 500,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ overflow: 'hidden', minWidth: 0 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {opt.displayTitle}
                        </div>
                        {opt.subtitle && (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--pc-muted)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {opt.subtitle}
                          </div>
                        )}
                      </div>
                      {checked && <Check size={14} style={{ color: 'var(--pc-blue)', flexShrink: 0 }} />}
                    </button>
                  )
                })
              )}
            </div>

            <div
              style={{
                padding: '8px 10px',
                borderTop: '1px solid var(--pc-border)',
                background: 'var(--pc-surface)',
                display: 'flex',
                gap: 6,
              }}
            >
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleQuickCreateTargetRow()
                  }
                }}
                placeholder={`Listede yoksa yeni ${targetTable.name} ekle…`}
                className={depth.input}
                style={{ minHeight: 30, fontSize: 12 }}
              />
              <button
                type="button"
                disabled={creating || !quickTitle.trim()}
                onClick={() => void handleQuickCreateTargetRow()}
                className={depth.btnPrimary}
                style={{ minHeight: 30, padding: '4px 10px', flexShrink: 0, fontSize: 12 }}
              >
                <Plus size={13} />
                <span>Ekle</span>
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
