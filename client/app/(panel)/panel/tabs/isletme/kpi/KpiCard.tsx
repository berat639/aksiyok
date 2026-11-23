'use client'

import { memo } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import InfoTooltip from '../../../../../admin/components/ui/InfoTooltip'
import { KpiChartView } from './KpiCharts'
import type { KpiChartType, KpiMetric } from './kpi-types'
import {
  CHIP_COLORS,
  formatKpiNumber,
  getKpiHeadline,
  getMetricIcon,
} from './kpi-utils'
import s from './kpi.module.css'

export const KpiCard = memo(function KpiCard({
  metric,
  chart,
  isEditing = false,
  onEdit,
  onRemove,
}: {
  metric: KpiMetric
  chart: KpiChartType
  isEditing?: boolean
  onEdit: (anchor: HTMLButtonElement) => void
  onRemove: () => void
}) {
  const activeChart = metric.supports.includes(chart) ? chart : metric.defaultChart
  const Icon = getMetricIcon(metric.icon)
  const chip = CHIP_COLORS[metric.chip] ?? CHIP_COLORS.brand
  const headline = getKpiHeadline(metric)

  const compact = activeChart === 'number'
  const lastSpace = metric.title.lastIndexOf(' ')
  const titleTail = lastSpace > 0 ? metric.title.slice(lastSpace + 1) : metric.title
  const titleHead = lastSpace > 0 ? metric.title.slice(0, lastSpace + 1) : ''
  const glueTail = titleTail.length <= 22

  return (
    <article
      className={compact ? s.kpiCardCompact : s.kpiCard}
      aria-label={metric.title}
    >
      <header className={s.cardHead}>
        <div className={s.cardTitleGroup}>
          <span
            className={compact ? s.iconChipCompact : s.iconChip}
            style={{
              background: `linear-gradient(145deg, ${chip.light}, ${chip.dark})`,
              boxShadow: `4px 6px 12px ${chip.dark}55, inset 3px 3px 6px rgba(255,255,255,0.48), inset -4px -4px 8px rgba(0,0,0,0.22)`,
            }}
            aria-hidden="true"
          >
            <Icon size={compact ? 17 : 20} strokeWidth={2.3} color="#ffffff" />
          </span>
          <div className={s.cardTitleRow}>
            <h3 className={compact ? s.cardTitleCompact : s.cardTitle} title={metric.title}>
              {titleHead}
              <span className={glueTail ? s.titleTail : undefined}>
                {titleTail}
                <span className={s.titleTip}>
                  <InfoTooltip title={metric.title} glyph="?">
                    {metric.tooltip}
                  </InfoTooltip>
                </span>
              </span>
            </h3>
          </div>
        </div>

        <div className={s.cardTools}>
          <button
            type="button"
            className={isEditing ? s.iconToolBtnActive : s.iconToolBtn}
            title="Kartı ve grafik görünümünü düzenle"
            aria-label={`${metric.title} düzenle`}
            aria-expanded={isEditing}
            onClick={(e) => onEdit(e.currentTarget)}
          >
            <Pencil size={13} color={isEditing ? '#ffffff' : undefined} />
          </button>
          <button
            type="button"
            className={s.iconToolBtn}
            title="Kartı kaldır"
            aria-label={`${metric.title} kaldır`}
            style={{ color: 'var(--danger)' }}
            onClick={onRemove}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </header>

      {compact ? (
        <div className={s.compactBody}>
          <div className={s.valStack}>
            <span className={s.compactVal}>{formatKpiNumber(headline, metric.unit)}</span>
            {metric.subtitle && <span className={s.cardSubtitle}>{metric.subtitle}</span>}
          </div>
        </div>
      ) : (
        <>
          <div className={s.headlineRow}>
            <div className={s.valStack}>
              <span className={s.headlineVal}>{formatKpiNumber(headline, metric.unit)}</span>
              {metric.subtitle && <span className={s.cardSubtitle}>{metric.subtitle}</span>}
            </div>
          </div>

          <div className={s.chartArea}>
            <KpiChartView metric={metric} type={activeChart} height={162} />
          </div>
        </>
      )}
    </article>
  )
})
