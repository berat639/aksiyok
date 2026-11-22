'use client'

import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { TIME_OPTIONS, toMinutes } from '@/lib/business-profile'
import s from './isletme.module.css'

/** Uzun <select> yerine 30 dakikalık ızgaradan saat seçtiren kompakt alan. */
export default function TimeSelect({
  label,
  value,
  onChange,
  min,
  allowMidnightEnd = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  /** Bu saatten önceki ve eşit seçenekler pasif olur (bitiş saati için). */
  min?: string
  allowMidnightEnd?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    activeRef.current?.scrollIntoView?.({ block: 'center' })
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const options = allowMidnightEnd ? TIME_OPTIONS : TIME_OPTIONS.filter((t) => t !== '24:00')
  const minM = min ? toMinutes(min) : -1

  return (
    <div className={s.timeWrap} ref={wrapRef}>
      <button type="button" className={s.timeBtn} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${value}`} onClick={() => setOpen((v) => !v)}>
        <Clock size={13} />
        <span>{label}</span>
        {value}
      </button>
      {open && (
        <div className={s.timePop} role="listbox" aria-label={label}>
          {options.map((t) => {
            const active = t === value
            return (
              <button
                key={t}
                ref={active ? activeRef : undefined}
                type="button"
                role="option"
                aria-selected={active}
                disabled={min !== undefined && toMinutes(t) <= minM}
                className={active ? s.timeOptActive : s.timeOpt}
                onClick={() => {
                  onChange(t)
                  setOpen(false)
                }}
              >
                {t}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
