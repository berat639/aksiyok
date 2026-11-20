'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DayPicker } from 'react-day-picker'
import { tr } from 'date-fns/locale'
import { Calendar, X } from 'lucide-react'
import 'react-day-picker/dist/style.css'
import depth from '@/styles/clinic-depth.module.css'
import { formatDynamicDateTR } from '../types'

interface ClinicalDatePickerProps {
  value: string | null | undefined
  onChange: (isoDate: string | null) => void
  placeholder?: string
  compact?: boolean
  autoOpen?: boolean
  onClosePopover?: () => void
}

function parseIsoToDate(val: string | null | undefined): Date | undefined {
  if (!val) return undefined
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    if (!Number.isNaN(d.getTime())) return d
  }
  const d = new Date(val)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function dateToIsoString(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export default function ClinicalDatePicker({
  value,
  onChange,
  placeholder = 'Tarih seçin',
  compact = false,
  autoOpen = false,
  onClosePopover,
}: ClinicalDatePickerProps) {
  const [open, setOpen] = useState(autoOpen)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const onClosePopoverRef = useRef(onClosePopover)
  onClosePopoverRef.current = onClosePopover
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 80, left: 80 })

  const selectedDate = parseIsoToDate(value)

  const updatePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const popW = 306
    const popH = 338
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
    updatePosition()
    const close = () => {
      setOpen(false)
      onClosePopoverRef.current?.()
    }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!triggerRef.current?.contains(target) && !popRef.current?.contains(target)) {
        close()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className={depth.input}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          minHeight: compact ? 28 : 35,
          padding: compact ? '3px 8px' : '6px 10px',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: compact ? 12.5 : 13,
          color: value ? 'var(--foreground)' : 'var(--pc-muted)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <Calendar size={14} style={{ color: 'var(--pc-tint-fg)', flexShrink: 0 }} />
          <span>{value ? formatDynamicDateTR(value) : placeholder}</span>
        </span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            title="Tarihi temizle"
            onClick={(e) => {
              e.stopPropagation()
              onChange(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation()
                onChange(null)
              }
            }}
            style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--pc-muted)' }}
          >
            <X size={13} />
          </span>
        )}
      </button>

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
              zIndex: 200050,
              padding: '10px 12px',
              borderRadius: 14,
              border: '1.5px solid var(--input-border)',
              background: 'var(--card-bg)',
              color: 'var(--foreground)',
              boxShadow: 'var(--pc-modal-shadow)',
            }}
          >
            <DayPicker
              mode="single"
              locale={tr}
              selected={selectedDate}
              defaultMonth={selectedDate}
              captionLayout="dropdown-buttons"
              fromYear={1925}
              toYear={new Date().getFullYear() + 10}
              onSelect={(day) => {
                onChange(day ? dateToIsoString(day) : null)
                setOpen(false)
                onClosePopover?.()
              }}
              styles={{
                caption: { color: 'var(--foreground)' },
                head_cell: { color: 'var(--pc-muted)', fontSize: '0.75rem' },
                day: { color: 'var(--foreground)', borderRadius: 8 },
              }}
              modifiersStyles={{
                selected: {
                  background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  fontWeight: 700,
                },
                today: {
                  border: '1px solid var(--pc-blue)',
                  fontWeight: 700,
                },
              }}
            />
          </div>,
          document.body
        )}
    </>
  )
}
