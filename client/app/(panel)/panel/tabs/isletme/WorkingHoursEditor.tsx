'use client'

import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { WEEK_DAYS, WEEK_DAYS_SHORT, validateDay, type WeeklyHours } from '@/lib/business-profile'
import TimeSelect from './TimeSelect'
import s from './isletme.module.css'

const HOUR_PRESETS: { label: string; start: string; end: string }[] = [
  { label: '09:00–18:00', start: '09:00', end: '18:00' },
  { label: '08:30–19:30', start: '08:30', end: '19:30' },
  { label: '10:00–22:00', start: '10:00', end: '22:00' },
  { label: '24 Saat', start: '00:00', end: '24:00' },
]

const hasDifferentDayHours = (hours: WeeklyHours) => {
  const open = hours.filter((d) => d.open)
  if (open.length <= 1) return false
  const first = open[0]?.ranges[0]
  if (!first) return false
  return open.some((d) => d.ranges.length !== 1 || d.ranges[0]?.start !== first.start || d.ranges[0]?.end !== first.end)
}

/**
 * Verimli ve kompakt çalışma saatleri seçicisi:
 * Pzt–Paz gün düğmeleri + satır içi dijital/çark saat seçici + tek tık hazır saat aralıkları.
 */
export default function WorkingHoursEditor({ value, onChange }: { value: WeeklyHours; onChange: (next: WeeklyHours) => void }) {
  const [perDay, setPerDay] = useState(() => hasDifferentDayHours(value))

  const firstOpen = value.find((d) => d.open) ?? value[0]!
  const common = firstOpen.ranges[0] ?? { start: '09:00', end: '18:00' }

  const toggleDay = (index: number) => {
    const target = value[index]!
    onChange(
      value.map((d, i) =>
        i === index
          ? { open: !target.open, ranges: target.ranges.length ? target.ranges : [{ ...common }] }
          : d,
      ),
    )
  }

  const applyCommonRange = (start: string, end: string) => {
    onChange(
      value.map((d) => ({
        ...d,
        ranges: d.open ? [{ start, end }] : d.ranges,
      })),
    )
  }

  const setDayRange = (index: number, start: string, end: string) => {
    onChange(value.map((d, i) => (i === index ? { ...d, ranges: [{ start, end }] } : d)))
  }

  const openIndices = value.map((d, i) => (d.open ? i : -1)).filter((i) => i >= 0)

  return (
    <div className={s.stack} style={{ gap: 10 }}>
      <div className={s.simpleHoursBar}>
        <div className={s.dayGrid} role="group" aria-label="Çalışma günleri">
          {WEEK_DAYS_SHORT.map((short, i) => {
            const on = value[i]!.open
            return (
              <button
                key={short}
                type="button"
                aria-pressed={on}
                aria-label={`${WEEK_DAYS[i]} ${on ? 'açık' : 'kapalı'}`}
                className={on ? s.dayBtnOn : s.dayBtn}
                onClick={() => toggleDay(i)}
              >
                <span style={on ? { color: '#ffffff' } : undefined}>{short}</span>
              </button>
            )
          })}
        </div>

        <div className={s.row} style={{ gap: 6 }}>
          <TimeSelect
            label="Açılış"
            value={common.start}
            onChange={(start) => {
              const end = common.end <= start && common.end !== '24:00' ? '24:00' : common.end
              applyCommonRange(start, end)
            }}
          />
          <span className={s.muted}>–</span>
          <TimeSelect
            label="Kapanış"
            value={common.end}
            min={common.start}
            allowMidnightEnd
            onChange={(end) => applyCommonRange(common.start, end)}
          />
        </div>
      </div>

      <div className={s.hoursPresetBar}>
        <div className={s.row} style={{ gap: 5 }}>
          {HOUR_PRESETS.map((preset) => {
            const active = !perDay && common.start === preset.start && common.end === preset.end
            return (
              <button
                key={preset.label}
                type="button"
                className={active ? s.timeQuickChipOn : s.timeQuickChip}
                onClick={() => applyCommonRange(preset.start, preset.end)}
              >
                {preset.label}
              </button>
            )
          })}
        </div>

        {openIndices.length > 1 && (
          <button
            type="button"
            className={perDay ? s.genelCtlBtnOn : s.genelCtlBtn}
            style={{ minHeight: 28, padding: '3px 10px', fontSize: '11px' }}
            aria-expanded={perDay}
            onClick={() => setPerDay((v) => !v)}
          >
            <SlidersHorizontal size={11} color={perDay ? '#ffffff' : undefined} />
            <span style={perDay ? { color: '#ffffff' } : undefined}>
              {perDay ? 'Günlere özel saatleri gizle' : 'Günlere özel saat belirle'}
            </span>
          </button>
        )}
      </div>

      {perDay && openIndices.length > 0 && (
        <div className={s.perDayList}>
          {openIndices.map((i) => {
            const day = value[i]!
            const r = day.ranges[0] ?? common
            const issue = validateDay(day)
            return (
              <div key={WEEK_DAYS[i]} className={s.perDayRow}>
                <span className={s.perDayName}>{WEEK_DAYS[i]}</span>
                <div className={s.row} style={{ gap: 6 }}>
                  <TimeSelect label="Açılış" value={r.start} onChange={(start) => setDayRange(i, start, r.end)} />
                  <span className={s.muted}>–</span>
                  <TimeSelect label="Kapanış" value={r.end} min={r.start} allowMidnightEnd onChange={(end) => setDayRange(i, r.start, end)} />
                </div>
                {issue && <span className={s.error} style={{ margin: 0 }}>{issue}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
