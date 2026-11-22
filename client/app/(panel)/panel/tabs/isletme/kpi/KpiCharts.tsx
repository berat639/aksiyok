'use client'

import { useId, type ReactElement } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  KpiBreakdownMetric,
  KpiChartType,
  KpiGoalMetric,
  KpiMetric,
  KpiTimeMetric,
  KpiUnitFormat,
} from './kpi-types'
import {
  formatKpiCompact,
  formatKpiNumber,
  getGoalPercent,
  getKpiHeadline,
} from './kpi-utils'
import s from './kpi.module.css'

const SERIES = ['var(--kpi-c1)', 'var(--kpi-c2)', 'var(--kpi-c3)', 'var(--kpi-c4)', 'var(--kpi-c5)', 'var(--kpi-c6)']
const seriesColor = (i: number) => SERIES[i % SERIES.length]
const shorten = (text: string, max = 9) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const AXIS_TICK = { fill: 'var(--foreground-2)', fontSize: 11.5, fontWeight: 650 }

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean
  payload?: { value?: number | string; name?: string | number }[]
  label?: string | number
  unit: KpiUnitFormat
}) {
  if (!active || !payload?.length) return null
  const first = payload[0]
  return (
    <div className={s.chartTip}>
      <p className={s.chartTipLabel}>{String(label ?? first?.name ?? '')}</p>
      <p className={s.chartTipVal}>{formatKpiNumber(Number(first?.value ?? 0), unit)}</p>
    </div>
  )
}

function ChartBox({ height, children }: { height: number; children: ReactElement }) {
  return (
    <div style={{ width: '100%', height, minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height }}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

function NumberView({ metric }: { metric: KpiMetric }) {
  const headline = getKpiHeadline(metric)
  return (
    <div className={s.bigNumberWrap}>
      <span className={s.bigNumberVal}>{formatKpiNumber(headline, metric.unit)}</span>
    </div>
  )
}

function TableView({ metric }: { metric: KpiMetric }) {
  let head: string[] = []
  let rows: string[][] = []
  if (metric.kind === 'time') {
    head = ['Dönem', 'Değer']
    rows = metric.points.map((p) => [p.label, formatKpiNumber(p.value, metric.unit)])
  } else if (metric.kind === 'breakdown') {
    const total = metric.items.reduce((sum, i) => sum + i.value, 0)
    head = ['Grup', 'Değer', 'Pay']
    rows = metric.items.map((i) => [
      i.name,
      formatKpiNumber(i.value, metric.unit),
      total > 0 ? `%${Math.round((i.value / total) * 100)}` : '%0',
    ])
  } else {
    head = ['Bilgi', 'Değer']
    rows = [
      ['Mevcut', formatKpiNumber(metric.value, metric.unit)],
      [metric.targetLabel, formatKpiNumber(metric.target, metric.unit)],
      ['Kalan', formatKpiNumber(Math.max(0, metric.target - metric.value), metric.unit)],
      ['Oran', `%${Math.round(getGoalPercent(metric))}`],
    ]
  }
  if (rows.length === 0) return <div className={s.chartEmpty}>Henüz veri yok</div>
  return (
    <div className={s.miniTableWrap}>
      <table className={s.miniTable}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {row.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HeatStrip({ metric }: { metric: KpiTimeMetric }) {
  if (metric.points.length === 0) return <div className={s.chartEmpty}>Henüz veri yok</div>
  const values = metric.points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return (
    <div>
      <ul
        className={s.heatList}
        style={{ gridTemplateColumns: `repeat(${metric.points.length}, minmax(0, 1fr))` }}
      >
        {metric.points.map((point) => {
          const intensity = (point.value - min) / range
          const pct = Math.round(18 + intensity * 78)
          const high = intensity > 0.35
          return (
            <li key={point.label} className={s.heatItem}>
              <span
                className={high ? s.heatCellHigh : s.heatCell}
                style={{
                  background: `color-mix(in srgb, #2563eb ${pct}%, var(--kpi-well))`,
                  color: high ? '#ffffff' : 'var(--foreground)',
                }}
              >
                {formatKpiCompact(point.value, { ...metric.unit, prefix: '', suffix: '' })}
              </span>
              <span className={s.heatLbl}>{point.label}</span>
            </li>
          )
        })}
      </ul>
      <div className={s.heatLegend}>
        <span>Düşük</span>
        <span className={s.heatBar} />
        <span>Yüksek</span>
      </div>
    </div>
  )
}

function TimeChart({ metric, type, height }: { metric: KpiTimeMetric; type: KpiChartType; height: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const data = metric.points
  if (data.length === 0) return <div className={s.chartEmpty}>Bu dönem için veri yok</div>
  if (type === 'heat') return <HeatStrip metric={metric} />

  const margin = { top: 8, right: 8, left: 8, bottom: 0 }
  const tooltip = <ChartTooltip unit={metric.unit} />
  const xAxis = (
    <XAxis
      dataKey="label"
      tickLine={false}
      axisLine={false}
      tick={AXIS_TICK}
      interval="preserveStartEnd"
      minTickGap={20}
      tickMargin={6}
    />
  )
  const grid = <CartesianGrid vertical={false} stroke="var(--input-border)" strokeDasharray="3 6" />

  if (type === 'bar') {
    const lastIdx = data.length - 1
    return (
      <ChartBox height={height}>
        <BarChart data={data} margin={margin}>
          {grid}
          {xAxis}
          <YAxis hide domain={[0, (m: number) => Math.max(1, Math.ceil(m * 1.12))]} />
          <Tooltip content={tooltip} cursor={{ fill: 'var(--kpi-well)' }} />
          <Bar dataKey="value" radius={[12, 12, 12, 12]} maxBarSize={42} isAnimationActive={false}>
            {data.map((p, i) => (
              <Cell key={p.label} fill={i === lastIdx ? 'var(--kpi-c1)' : 'var(--kpi-c2)'} fillOpacity={i === lastIdx ? 1 : 0.82} />
            ))}
          </Bar>
        </BarChart>
      </ChartBox>
    )
  }

  if (type === 'area') {
    return (
      <ChartBox height={height}>
        <AreaChart data={data} margin={margin}>
          <defs>
            <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--kpi-c1)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--kpi-c1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {grid}
          {xAxis}
          <YAxis hide domain={[0, (m: number) => Math.max(1, Math.ceil(m * 1.12))]} />
          <Tooltip content={tooltip} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--kpi-c1)"
            strokeWidth={4}
            strokeLinecap="round"
            fill={`url(#${uid})`}
            activeDot={{ r: 6 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartBox>
    )
  }

  const isSpark = type === 'spark'
  return (
    <ChartBox height={height}>
      <LineChart data={data} margin={margin}>
        {!isSpark && grid}
        {!isSpark && xAxis}
        <YAxis hide domain={[0, (m: number) => Math.max(1, Math.ceil(m * 1.12))]} />
        <Tooltip content={tooltip} />
        <Line
          type={type === 'step' ? 'stepAfter' : 'monotone'}
          dataKey="value"
          stroke="var(--kpi-c1)"
          strokeWidth={isSpark ? 4.5 : 3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={isSpark ? false : { r: 4, fill: 'var(--kpi-c1)', strokeWidth: 0 }}
          activeDot={{ r: 7 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartBox>
  )
}

function BreakdownChart({ metric, type, height }: { metric: KpiBreakdownMetric; type: KpiChartType; height: number }) {
  const items = metric.items
  if (items.length === 0) return <div className={s.chartEmpty}>Dağılım için kayıt yok</div>
  const total = items.reduce((sum, i) => sum + i.value, 0) || 1
  const sorted = [...items].sort((a, b) => b.value - a.value)

  if (type === 'donut' || type === 'pie') {
    const donut = type === 'donut'
    return (
      <div className={s.pieRow}>
        <div className={s.pieBox}>
          <ChartBox height={152}>
            <PieChart>
              <Tooltip content={<ChartTooltip unit={metric.unit} />} />
              <Pie
                data={sorted}
                dataKey="value"
                nameKey="name"
                innerRadius={donut ? '60%' : 0}
                outerRadius="94%"
                paddingAngle={donut ? 3 : 1}
                cornerRadius={donut ? 6 : 3}
                stroke="none"
                isAnimationActive={false}
              >
                {sorted.map((item, idx) => (
                  <Cell key={item.name} fill={seriesColor(idx)} />
                ))}
              </Pie>
            </PieChart>
          </ChartBox>
          {donut && (
            <div className={s.pieCenter}>
              <span className={s.pieCenterLbl}>Toplam</span>
              <span className={s.pieCenterVal}>{formatKpiCompact(total, metric.unit)}</span>
            </div>
          )}
        </div>
        <ul className={s.legendList}>
          {sorted.slice(0, 5).map((item, idx) => (
            <li key={item.name} className={s.legendItem}>
              <span className={s.legendDot} style={{ background: seriesColor(idx) }} />
              <span className={s.legendName}>{item.name}</span>
              <span className={s.legendPct}>%{Math.round((item.value / total) * 100)}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (type === 'bar') {
    return (
      <ChartBox height={height}>
        <BarChart data={sorted} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--input-border)" strokeDasharray="3 6" />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            tickFormatter={(v: string) => shorten(v, 9)}
            interval={0}
          />
          <YAxis hide domain={[0, (m: number) => Math.max(1, Math.ceil(m * 1.12))]} />
          <Tooltip content={<ChartTooltip unit={metric.unit} />} />
          <Bar dataKey="value" radius={[8, 8, 8, 8]} maxBarSize={38} isAnimationActive={false}>
            {sorted.map((item, idx) => (
              <Cell key={item.name} fill={seriesColor(idx)} />
            ))}
          </Bar>
        </BarChart>
      </ChartBox>
    )
  }

  if (type === 'radar') {
    return (
      <ChartBox height={height}>
        <RadarChart data={sorted} outerRadius="68%">
          <PolarGrid stroke="var(--input-border)" />
          <PolarAngleAxis
            dataKey="name"
            tick={{ ...AXIS_TICK, fontSize: 10.5 }}
            tickFormatter={(v: string) => shorten(v, 10)}
          />
          <Tooltip content={<ChartTooltip unit={metric.unit} />} />
          <Radar dataKey="value" stroke="#2563eb" strokeWidth={2.5} fill="#2563eb" fillOpacity={0.28} isAnimationActive={false} />
        </RadarChart>
      </ChartBox>
    )
  }

  if (type === 'blocks') {
    const split = Math.max(1, Math.ceil(sorted.length / 2))
    const rows = [sorted.slice(0, split), sorted.slice(split)].filter((r) => r.length > 0)
    return (
      <div className={s.blocksWrap}>
        {rows.map((row, ri) => {
          const rowSum = row.reduce((acc, i) => acc + i.value, 0) || 1
          return (
            <div key={ri} className={s.blocksRow} style={{ flexGrow: rowSum, flexBasis: 0 }}>
              {row.map((item) => {
                const idx = sorted.indexOf(item)
                return (
                  <div
                    key={item.name}
                    className={s.blockTile}
                    style={{ flexGrow: item.value, flexBasis: 0, background: seriesColor(idx) }}
                    title={`${item.name}: ${formatKpiNumber(item.value, metric.unit)}`}
                  >
                    <span className={s.blockName}>{item.name}</span>
                    <span className={s.blockPct}>%{Math.round((item.value / total) * 100)}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    )
  }

  if (type === 'stack') {
    return (
      <div className={s.stackWrap}>
        <div className={s.stackTrack}>
          {sorted.map((item, idx) => (
            <div
              key={item.name}
              className={s.stackSeg}
              style={{ flexGrow: item.value, flexBasis: 0, background: seriesColor(idx) }}
              title={`${item.name}: ${formatKpiNumber(item.value, metric.unit)} (%${Math.round((item.value / total) * 100)})`}
            />
          ))}
        </div>
        <ul className={s.legendList}>
          {sorted.slice(0, 4).map((item, idx) => (
            <li key={item.name} className={s.legendItem}>
              <span className={s.legendDot} style={{ background: seriesColor(idx) }} />
              <span className={s.legendName}>{item.name}</span>
              <span className={s.legendPct}>%{Math.round((item.value / total) * 100)}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // hbar (default)
  const max = Math.max(...sorted.map((i) => i.value), 1)
  return (
    <ul className={s.hbarList}>
      {sorted.slice(0, 5).map((item, idx) => (
        <li key={item.name}>
          <div className={s.hbarHead}>
            <span className={s.hbarName}>{item.name}</span>
            <span className={s.hbarVal}>{formatKpiNumber(item.value, metric.unit)}</span>
          </div>
          <div className={s.hbarTrack}>
            <div
              className={s.hbarFill}
              style={{ width: `${Math.max(5, (item.value / max) * 100)}%`, background: seriesColor(idx) }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function GoalChart({ metric, type }: { metric: KpiGoalMetric; type: KpiChartType }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const percent = getGoalPercent(metric)

  if (type === 'ring') {
    return (
      <div className={s.ringWrap}>
        <svg viewBox="0 0 120 120" width="158" height="158" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
          <defs>
            <linearGradient id={uid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--kpi-c2)" />
              <stop offset="100%" stopColor="var(--kpi-c1)" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="46" fill="none" stroke="var(--kpi-grid)" strokeWidth="16" />
          <circle
            cx="60"
            cy="60"
            r="46"
            fill="none"
            stroke={`url(#${uid})`}
            strokeWidth="16"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${Math.max(percent, 1)} 100`}
          />
        </svg>
        <div className={s.ringCenter}>
          <p className={s.goalPct}>%{Math.round(percent)}</p>
          <p className={s.goalTarget}>
            {metric.targetLabel}: {formatKpiCompact(metric.target, metric.unit)}
          </p>
        </div>
      </div>
    )
  }

  if (type === 'progress') {
    return (
      <div className={s.progWrap}>
        <div className={s.progHead}>
          <p className={s.goalPct}>%{Math.round(percent)}</p>
          <span className={s.goalTarget}>
            {metric.targetLabel}: {formatKpiNumber(metric.target, metric.unit)}
          </span>
        </div>
        <div className={s.progTrack}>
          <div className={s.progFill} style={{ width: `${Math.max(percent, 3)}%` }} />
        </div>
      </div>
    )
  }

  if (type === 'segments') {
    const total = 10
    const filled = Math.round((percent / 100) * total)
    return (
      <div className={s.progWrap}>
        <div className={s.progHead}>
          <p className={s.goalPct}>%{Math.round(percent)}</p>
          <span className={s.goalTarget}>
            {filled} / {total}
          </span>
        </div>
        <div className={s.segRow}>
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} className={i < filled ? s.segCellOn : s.segCell} />
          ))}
        </div>
      </div>
    )
  }

  // gauge (default)
  return (
    <div className={s.gaugeWrap}>
      <svg viewBox="0 0 200 118" style={{ width: '100%', height: '100%' }} aria-hidden="true">
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--kpi-c2)" />
            <stop offset="100%" stopColor="var(--kpi-c1)" />
          </linearGradient>
        </defs>
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--kpi-grid)" strokeWidth="22" strokeLinecap="round" pathLength={100} />
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={`url(#${uid})`}
          strokeWidth="22"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${Math.max(percent, 1)} 100`}
        />
      </svg>
      <div className={s.gaugeCenter}>
        <p className={s.goalPct}>%{Math.round(percent)}</p>
        <p className={s.goalTarget}>
          {metric.targetLabel}: {formatKpiCompact(metric.target, metric.unit)}
        </p>
      </div>
    </div>
  )
}

export function KpiChartView({
  metric,
  type,
  height = 160,
}: {
  metric: KpiMetric
  type: KpiChartType
  height?: number
}) {
  if (type === 'number') return <NumberView metric={metric} />
  if (type === 'table') return <TableView metric={metric} />
  if (metric.kind === 'time') return <TimeChart metric={metric} type={type} height={height} />
  if (metric.kind === 'breakdown') return <BreakdownChart metric={metric} type={type} height={height} />
  return <GoalChart metric={metric} type={type} />
}
