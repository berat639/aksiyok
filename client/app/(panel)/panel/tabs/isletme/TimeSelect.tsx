'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Time } from '@internationalized/date'
import { DateInput, DateSegment, TimeField } from 'react-aria-components'
import { WheelPicker, WheelPickerWrapper, type WheelPickerOption } from '@ncdai/react-wheel-picker'
import '@ncdai/react-wheel-picker/style.css'
import { Clock } from 'lucide-react'
import { toMinutes } from '@/lib/business-profile'
import s from './isletme.module.css'

const HOUR_OPTIONS: WheelPickerOption<string>[] = Array.from({ length: 24 }, (_, h) => {
  const v = String(h).padStart(2, '0')
  return { value: v, label: v }
})

const MINUTE_OPTIONS: WheelPickerOption<string>[] = ['00', '15', '30', '45'].map((m) => ({
  value: m,
  label: m,
}))

function parseHourMin(value: string): { hh: string; mm: string; isMidnightEnd: boolean } {
  if (value === '24:00') return { hh: '23', mm: '45', isMidnightEnd: true }
  const [rawH = '09', rawM = '00'] = value.split(':')
  const h = Math.max(0, Math.min(23, Number(rawH) || 0))
  const m = Math.max(0, Math.min(59, Number(rawM) || 0))
  return { hh: String(h).padStart(2, '0'), mm: String(m).padStart(2, '0'), isMidnightEnd: false }
}

function nearestQuarter(mm: string): string {
  const n = Number(mm) || 0
  if (n < 8) return '00'
  if (n < 23) return '15'
  if (n < 38) return '30'
  return '45'
}

/**
 * Kompakt, az yer kaplayan 24 saatlik saat seçici:
 * - Doğrudan satır içi segmentli dijital giriş (react-aria TimeField — klavyeden rakam veya ↑/↓ ile anında düzenlenir)
 * - Saat ikonuna tıklanınca dar 2 sütunlu (Saat | Dakika) dokunsal çark açılır (@ncdai/react-wheel-picker)
 */
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const { hh, mm, isMidnightEnd } = useMemo(() => parseHourMin(value), [value])
  const minMinutes = min ? toMinutes(min) : -1

  const ariaTime = useMemo(() => {
    if (isMidnightEnd) return new Time(23, 59)
    return new Time(Number(hh), Number(mm))
  }, [hh, mm, isMidnightEnd])

  const reposition = useCallback(() => {
    const el = triggerRef.current
    if (!el || !el.isConnected) return
    const rect = el.getBoundingClientRect()
    const popW = 166
    const popH = allowMidnightEnd ? 210 : 176
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.max(8, Math.min(rect.left, vw - popW - 8))
    const spaceBelow = vh - rect.bottom - 8
    const top =
      spaceBelow >= popH || spaceBelow >= rect.top
        ? Math.min(vh - popH - 8, rect.bottom + 6)
        : Math.max(8, rect.top - popH - 6)
    setPos({ top, left })
  }, [allowMidnightEnd])

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    reposition()
  }, [open, reposition])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (popRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, reposition])

  const commitTime = useCallback(
    (nextH: string, nextM: string) => {
      const next = `${nextH}:${nextM}`
      if (minMinutes >= 0 && toMinutes(next) <= minMinutes) {
        if (allowMidnightEnd && minMinutes >= 23 * 60 + 45) {
          onChange('24:00')
          return
        }
        const bumped = Math.min(23 * 60 + 45, minMinutes + 30)
        const bh = String(Math.floor(bumped / 60)).padStart(2, '0')
        const bm = String(bumped % 60).padStart(2, '0')
        onChange(`${bh}:${bm}`)
        return
      }
      onChange(next)
    },
    [minMinutes, allowMidnightEnd, onChange],
  )

  const handleFieldChange = (t: Time | null) => {
    if (!t) return
    const nextH = String(t.hour).padStart(2, '0')
    const nextM = String(t.minute).padStart(2, '0')
    const next = `${nextH}:${nextM}`
    if (allowMidnightEnd && next === '00:00' && minMinutes >= 0) {
      onChange('24:00')
      return
    }
    commitTime(nextH, nextM)
  }

  const hourOptions = useMemo<WheelPickerOption<string>[]>(
    () =>
      HOUR_OPTIONS.map((opt) => ({
        ...opt,
        disabled: minMinutes >= 0 && Number(opt.value) * 60 + 45 <= minMinutes,
      })),
    [minMinutes],
  )

  const minuteOptions = useMemo<WheelPickerOption<string>[]>(
    () =>
      MINUTE_OPTIONS.map((opt) => ({
        ...opt,
        disabled: minMinutes >= 0 && Number(hh) * 60 + Number(opt.value) <= minMinutes,
      })),
    [minMinutes, hh],
  )

  const wheelMinute = isMidnightEnd ? '45' : nearestQuarter(mm)

  return (
    <div className={s.timeWrap} ref={triggerRef}>
      <div className={`${s.timePill} ${open ? s.timePillOpen : ''}`}>
        <span className={s.timePillLabel}>{label}</span>
        {isMidnightEnd ? (
          <button
            type="button"
            className={s.timeMidnightValue}
            aria-label={`${label}: 24:00`}
            onClick={() => setOpen((v) => !v)}
          >
            24:00
          </button>
        ) : (
          <TimeField
            aria-label={label}
            hourCycle={24}
            granularity="minute"
            value={ariaTime}
            onChange={handleFieldChange}
            className={s.timeFieldRoot}
          >
            <DateInput className={s.timeDateInput}>
              {(segment) => (
                <DateSegment
                  segment={segment}
                  className={segment.type === 'literal' ? s.timeSegLiteral : s.timeSeg}
                />
              )}
            </DateInput>
          </TimeField>
        )}
        <button
          type="button"
          className={s.timeClockBtn}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label} saat çarkını aç (${value})`}
          title="Saat çarkından seç"
          onClick={() => setOpen((v) => !v)}
        >
          <Clock size={12} />
        </button>
      </div>

      {open &&
        typeof document !== 'undefined' &&
        document.body &&
        createPortal(
          <div
            ref={popRef}
            className={s.timeWheelPop}
            role="dialog"
            aria-label={`${label} saat seçici`}
            style={{
              top: pos?.top ?? 12,
              left: pos?.left ?? 12,
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            <div className={s.timeWheelColsHead}>
              <span>Saat</span>
              <span>Dakika</span>
            </div>
            <WheelPickerWrapper className={s.timeWheelWrapper}>
              <WheelPicker
                options={hourOptions}
                value={hh}
                visibleCount={12}
                optionItemHeight={28}
                onValueChange={(nextH) => commitTime(nextH, wheelMinute)}
                classNames={{
                  optionItem: s.wheelOpt,
                  highlightWrapper: s.wheelHighlightWrap,
                  highlightItem: s.wheelHighlightItem,
                }}
              />
              <span className={s.wheelColon} aria-hidden="true">
                :
              </span>
              <WheelPicker
                options={minuteOptions}
                value={wheelMinute}
                visibleCount={12}
                optionItemHeight={28}
                onValueChange={(nextM) => commitTime(hh, nextM)}
                classNames={{
                  optionItem: s.wheelOpt,
                  highlightWrapper: s.wheelHighlightWrap,
                  highlightItem: s.wheelHighlightItem,
                }}
              />
            </WheelPickerWrapper>

            {allowMidnightEnd && (
              <div className={s.timeWheelFoot}>
                <button
                  type="button"
                  className={isMidnightEnd ? s.timeQuickChipOn : s.timeQuickChip}
                  onClick={() => {
                    onChange('24:00')
                    setOpen(false)
                  }}
                >
                  24:00 (Gece yarısı)
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
