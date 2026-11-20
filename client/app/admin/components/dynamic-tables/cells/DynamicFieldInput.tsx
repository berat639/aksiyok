'use client'

import React, { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { PhoneMaskedInput } from '@/lib/phone-mask'
import depth from '@/styles/clinic-depth.module.css'
import ClinicalDatePicker from '../ui/ClinicalDatePicker'
import RelationPickerPopover from './RelationPickerPopover'
import {
  formatCurrencyTR,
  formatDynamicDateTR,
  type DynamicColumnDef,
  type DynamicTableDef,
  type LinkedRowSummary,
  type SelectOptionItem,
} from '../types'

interface DynamicFieldInputProps {
  column: DynamicColumnDef
  value: any
  onChange?: (nextVal: any) => void
  allTables?: DynamicTableDef[]
  linkedItems?: LinkedRowSummary[]
  onRelationChange?: (nextIds: string[], nextSummaries: LinkedRowSummary[]) => void
  onNavigateToRow?: (tableId: string, rowId: string) => void
  mode: 'form' | 'grid' | 'inlineNew' | 'readonly'
  autoFocusField?: boolean
  onEnterSubmit?: () => void
  onEscapeCancel?: () => void
}

export default function DynamicFieldInput({
  column,
  value,
  onChange = () => {},
  allTables = [],
  linkedItems = [],
  onRelationChange,
  onNavigateToRow,
  mode,
  autoFocusField = false,
  onEnterSubmit,
  onEscapeCancel,
}: DynamicFieldInputProps) {
  const [editingInline, setEditingInline] = useState(false)
  const [draft, setDraft] = useState<string>(value === null || value === undefined ? '' : String(value))

  useEffect(() => {
    setDraft(value === null || value === undefined ? '' : String(value))
  }, [value])

  const options: SelectOptionItem[] = Array.isArray(column.config?.options) ? column.config.options : []
  const isCompact = mode === 'grid' || mode === 'inlineNew'

  // ── Read-Only Table Cell Mode (No Inline Table Editing) ────────────────────
  if (mode === 'readonly') {
    if (column.fieldType === 'relation') {
      if (!linkedItems || linkedItems.length === 0) {
        return <span style={{ color: 'var(--pc-muted)' }}>—</span>
      }
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {linkedItems.map((item) => (
            <span
              key={item.id}
              onClick={
                onNavigateToRow
                  ? (e) => {
                      e.stopPropagation()
                      onNavigateToRow(item.tableId, item.id)
                    }
                  : undefined
              }
              className={depth.badge}
              style={{
                cursor: onNavigateToRow ? 'pointer' : 'default',
                fontSize: 11.5,
                padding: '2px 8px',
              }}
              title={onNavigateToRow ? 'Bağlı kayda git' : item.displayTitle}
            >
              <span>{item.displayTitle}</span>
              {onNavigateToRow && <ArrowUpRight size={11} />}
            </span>
          ))}
        </div>
      )
    }

    if (column.fieldType === 'boolean') {
      const checked = Boolean(value)
      return (
        <span
          className={depth.badge}
          style={
            checked
              ? undefined
              : {
                  background: 'var(--input-bg)',
                  color: 'var(--foreground-3)',
                  borderColor: 'var(--input-border)',
                  boxShadow: 'none',
                }
          }
        >
          {checked ? 'Evet' : 'Hayır'}
        </span>
      )
    }

    if (column.fieldType === 'date') {
      return (
        <span style={{ color: value ? 'var(--foreground)' : 'var(--pc-muted)' }}>
          {formatDynamicDateTR(value)}
        </span>
      )
    }

    if (column.fieldType === 'select') {
      const selectedOpt = options.find((o) => o.id === value || o.label === value)
      if (selectedOpt) {
        return <span className={depth.badge}>{selectedOpt.label}</span>
      }
      if (value) {
        return <span className={depth.badge}>{String(value)}</span>
      }
      return <span style={{ color: 'var(--pc-muted)' }}>—</span>
    }

    if (column.fieldType === 'multiselect') {
      const selectedArr: string[] = Array.isArray(value) ? value : []
      if (selectedArr.length === 0) {
        return <span style={{ color: 'var(--pc-muted)' }}>—</span>
      }
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {selectedArr.map((idOrLabel) => {
            const matched = options.find((o) => o.id === idOrLabel || o.label === idOrLabel)
            return (
              <span key={idOrLabel} className={depth.badge} style={{ fontSize: 11, padding: '2px 7px' }}>
                {matched ? matched.label : idOrLabel}
              </span>
            )
          })}
        </div>
      )
    }

    let display = '—'
    if (column.fieldType === 'currency') {
      display = formatCurrencyTR(value, column.config?.currencySymbol || '₺')
    } else if (value !== null && value !== undefined && String(value).trim() !== '') {
      display = String(value)
    }

    return (
      <span
        style={{
          fontWeight: column.isPrimaryTitle ? 700 : 500,
          color: display === '—' ? 'var(--pc-muted)' : 'var(--foreground)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {display}
      </span>
    )
  }

  // ── Interactive Modes ('form' | 'grid' | 'inlineNew') ──────────────────────
  if (column.fieldType === 'relation') {
    const targetTable = allTables.find((t) => t.id === column.config?.targetTableId)
    const allowMultiple = column.config?.allowMultiple !== false
    return (
      <RelationPickerPopover
        targetTable={targetTable}
        allowMultiple={allowMultiple}
        selectedItems={linkedItems}
        onChange={(ids, summaries) => onRelationChange?.(ids, summaries)}
        compact={mode === 'grid'}
        onNavigateToRow={onNavigateToRow}
      />
    )
  }

  if (column.fieldType === 'boolean') {
    const checked = Boolean(value)
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={(e) => {
            e.stopPropagation()
            onChange(!checked)
          }}
          className={depth.switch}
        />
        {mode === 'form' && (
          <span style={{ fontSize: 12.5, color: 'var(--foreground-2)', fontWeight: 500 }}>
            {checked ? 'Evet' : 'Hayır'}
          </span>
        )}
      </div>
    )
  }

  if (column.fieldType === 'date') {
    if (mode === 'grid' && !editingInline) {
      return (
        <div
          onClick={(e) => {
            e.stopPropagation()
            setEditingInline(true)
          }}
          title="Tarihi düzenlemek için tıklayın"
          style={{ minHeight: 24, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ color: value ? 'var(--foreground)' : 'var(--pc-muted)' }}>
            {formatDynamicDateTR(value)}
          </span>
        </div>
      )
    }
    return (
      <ClinicalDatePicker
        value={value}
        onChange={(nextIso) => {
          onChange(nextIso)
          setEditingInline(false)
        }}
        compact={isCompact}
        autoOpen={mode === 'grid' && editingInline}
        onClosePopover={() => setEditingInline(false)}
      />
    )
  }

  if (column.fieldType === 'select') {
    const selectedOpt = options.find((o) => o.id === value || o.label === value)
    if (mode === 'grid' && !editingInline) {
      return (
        <div
          onClick={(e) => {
            e.stopPropagation()
            setEditingInline(true)
          }}
          style={{ minHeight: 24, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        >
          {selectedOpt ? (
            <span className={depth.badge}>{selectedOpt.label}</span>
          ) : value ? (
            <span className={depth.badge}>{String(value)}</span>
          ) : (
            <span style={{ color: 'var(--pc-muted)' }}>Seçin…</span>
          )}
        </div>
      )
    }

    return (
      <select
        value={value ?? ''}
        autoFocus={mode === 'grid' || autoFocusField}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => {
          if (mode === 'grid') setEditingInline(false)
        }}
        onChange={(e) => {
          onChange(e.target.value || null)
          if (mode === 'grid') setEditingInline(false)
        }}
        onKeyDown={(e) => {
          if (mode === 'inlineNew' && e.key === 'Escape') {
            e.preventDefault()
            onEscapeCancel?.()
          }
        }}
        className={depth.input}
        style={isCompact ? { minHeight: 28, padding: '2px 8px', fontSize: 12.5 } : undefined}
      >
        <option value="">Seçiniz…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }

  if (column.fieldType === 'multiselect') {
    const selectedArr: string[] = Array.isArray(value) ? value : []
    const toggleOpt = (optId: string) => {
      if (selectedArr.includes(optId)) {
        onChange(selectedArr.filter((v) => v !== optId))
      } else {
        onChange([...selectedArr, optId])
      }
    }

    return (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}
      >
        {options.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--pc-muted)' }}>Seçenek tanımlı değil</span>
        ) : (
          options.map((o) => {
            const active = selectedArr.includes(o.id)
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggleOpt(o.id)}
                className={active ? depth.btnPale : depth.btn}
                style={{
                  minHeight: 23,
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: active ? 700 : 500,
                }}
              >
                <span>{o.label}</span>
              </button>
            )
          })
        )}
      </div>
    )
  }

  if (column.fieldType === 'phone') {
    if (mode === 'grid' && !editingInline) {
      return (
        <div
          onClick={(e) => {
            e.stopPropagation()
            setEditingInline(true)
          }}
          style={{ minHeight: 24, display: 'flex', alignItems: 'center', cursor: 'text' }}
        >
          <span style={{ color: value ? 'var(--foreground)' : 'var(--pc-muted)' }}>
            {value || '—'}
          </span>
        </div>
      )
    }

    return (
      <div onClick={(e) => e.stopPropagation()}>
        <PhoneMaskedInput
          placeholder="0 (5XX) XXX XX XX"
          value={draft}
          onValueChange={(nextPhone) => {
            setDraft(nextPhone)
            if (mode === 'form' || mode === 'inlineNew') onChange(nextPhone)
          }}
          onBlur={() => {
            if (mode === 'grid') {
              setEditingInline(false)
              if (draft !== (value ?? '')) onChange(draft || null)
            }
          }}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
              if (mode === 'grid') {
                setEditingInline(false)
                if (draft !== (value ?? '')) onChange(draft || null)
              } else if (mode === 'inlineNew' || mode === 'form') {
                e.preventDefault()
                onEnterSubmit?.()
              }
            } else if (e.key === 'Escape') {
              if (mode === 'grid') {
                setDraft(value ?? '')
                setEditingInline(false)
              } else if (mode === 'inlineNew') {
                e.preventDefault()
                onEscapeCancel?.()
              }
            }
          }}
          className={depth.input}
          style={isCompact ? { minHeight: 28, padding: '3px 8px', fontSize: 12.5 } : undefined}
        />
      </div>
    )
  }

  // text | email | number | currency
  if (mode === 'grid' && !editingInline) {
    let display: string = '—'
    if (column.fieldType === 'currency') {
      display = formatCurrencyTR(value, column.config?.currencySymbol || '₺')
    } else if (value !== null && value !== undefined && String(value).trim() !== '') {
      display = String(value)
    }

    return (
      <div
        onClick={(e) => {
          e.stopPropagation()
          setEditingInline(true)
        }}
        title="Düzenlemek için tıklayın"
        style={{
          minHeight: 24,
          display: 'flex',
          alignItems: 'center',
          cursor: 'text',
          fontWeight: column.isPrimaryTitle ? 700 : 500,
          color: display === '—' ? 'var(--pc-muted)' : 'var(--foreground)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {display}
      </div>
    )
  }

  const inputType =
    column.fieldType === 'number' || column.fieldType === 'currency'
      ? 'number'
      : column.fieldType === 'email'
        ? 'email'
        : 'text'

  const commitInline = () => {
    setEditingInline(false)
    const trimmed = draft.trim()
    if (column.fieldType === 'number' || column.fieldType === 'currency') {
      const nextNum = trimmed === '' ? null : Number(trimmed)
      if (nextNum !== value) onChange(Number.isFinite(nextNum as number) ? nextNum : null)
    } else {
      const nextStr = trimmed === '' ? null : trimmed
      if (nextStr !== (value ?? null)) onChange(nextStr)
    }
  }

  return (
    <input
      type={inputType}
      step={column.fieldType === 'currency' || column.fieldType === 'number' ? 'any' : undefined}
      value={draft}
      autoFocus={mode === 'grid' || autoFocusField}
      placeholder={column.config?.placeholder || `${column.name}…`}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        setDraft(e.target.value)
        if (mode === 'form' || mode === 'inlineNew') {
          if (column.fieldType === 'number' || column.fieldType === 'currency') {
            onChange(e.target.value === '' ? null : Number(e.target.value))
          } else {
            onChange(e.target.value)
          }
        }
      }}
      onBlur={() => {
        if (mode === 'grid') commitInline()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (mode === 'grid') {
            e.preventDefault()
            commitInline()
          } else if (mode === 'inlineNew' || mode === 'form') {
            e.preventDefault()
            onEnterSubmit?.()
          }
        } else if (e.key === 'Escape') {
          if (mode === 'grid') {
            setDraft(value === null || value === undefined ? '' : String(value))
            setEditingInline(false)
          } else if (mode === 'inlineNew') {
            e.preventDefault()
            onEscapeCancel?.()
          }
        }
      }}
      className={depth.input}
      style={isCompact ? { minHeight: 28, padding: '3px 8px', fontSize: 12.5 } : undefined}
    />
  )
}
