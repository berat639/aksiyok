'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
} from 'lucide-react'
import depth from '@/styles/clinic-depth.module.css'
import InfoTooltip from '../../../../../admin/components/ui/InfoTooltip'
import type {
  KpiAggregation,
  KpiCardConfig,
  KpiChartType,
  KpiChipTone,
  KpiDateRange,
  KpiMetricKind,
  KpiSourceDescriptor,
} from './kpi-types'
import {
  CHARTS_BY_KIND,
  CHART_META,
  CHIP_COLORS,
  DATE_RANGE_LABELS,
  GOAL_CHARTS,
  TIME_ALL_CHARTS,
  suggestCardTitle,
} from './kpi-utils'
import s from './kpi.module.css'

interface MeasureChoice {
  key: string
  label: string
  kind: KpiMetricKind
  aggregation: KpiAggregation
  valueColumnId?: string | null
  groupByColumnId?: string | null
}

function buildMeasureChoices(source: KpiSourceDescriptor | undefined): MeasureChoice[] {
  if (!source) return []
  const list: MeasureChoice[] = [
    { key: 'count', label: 'Kayıt sayısı', kind: 'time', aggregation: 'count' },
  ]
  for (const col of source.columns) {
    if (col.fieldType === 'currency' || col.fieldType === 'number') {
      list.push({
        key: `sum:${col.id}`,
        label: `Toplam ${col.name}`,
        kind: 'time',
        aggregation: 'sum',
        valueColumnId: col.id,
      })
      list.push({
        key: `avg:${col.id}`,
        label: `Ortalama ${col.name}`,
        kind: 'time',
        aggregation: 'avg',
        valueColumnId: col.id,
      })
    }
  }
  for (const col of source.columns) {
    if (['select', 'multiselect', 'boolean', 'relation'].includes(col.fieldType)) {
      list.push({
        key: `brk:${col.id}`,
        label: `${col.name} dağılımı`,
        kind: 'breakdown',
        aggregation: 'count',
        groupByColumnId: col.id,
      })
    }
  }
  return list
}

function measureKeyFromCard(card: KpiCardConfig): string {
  if (card.kind === 'breakdown' && card.groupByColumnId) return `brk:${card.groupByColumnId}`
  if (card.aggregation === 'sum' && card.valueColumnId) return `sum:${card.valueColumnId}`
  if (card.aggregation === 'avg' && card.valueColumnId) return `avg:${card.valueColumnId}`
  return 'count'
}

const EDGE = 12
const GAP = 8

export function KpiBuilderModal({
  open,
  anchorEl,
  sources,
  presets,
  editing,
  existingIds,
  onClose,
  onSave,
  onQuickAddPreset,
}: {
  open: boolean
  anchorEl: HTMLElement | null
  sources: KpiSourceDescriptor[]
  presets: KpiCardConfig[]
  editing: KpiCardConfig | null
  existingIds: Set<string>
  onClose: () => void
  onSave: (card: KpiCardConfig) => void
  onQuickAddPreset: (preset: KpiCardConfig) => void
}) {
  const [sourceId, setSourceId] = useState<string>(sources[0]?.id || 'builtin:finance')
  const [measureKey, setMeasureKey] = useState<string>('count')
  const [chart, setChart] = useState<KpiChartType>('number')
  const [targetValue, setTargetValue] = useState<string>('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [title, setTitle] = useState<string>('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [dateRange, setDateRange] = useState<KpiDateRange>('30d')
  const [filterColumnId, setFilterColumnId] = useState<string>('')
  const [filterValue, setFilterValue] = useState<string>('')
  const [chip, setChip] = useState<KpiChipTone>('brand')
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const panelRef = useRef<HTMLFormElement>(null)

  const source = useMemo(() => sources.find((x) => x.id === sourceId) || sources[0], [sources, sourceId])
  const measures = useMemo(() => buildMeasureChoices(source), [source])
  const activeMeasure = useMemo(
    () => measures.find((m) => m.key === measureKey) || measures[0],
    [measures, measureKey]
  )
  const filterCols = useMemo(
    () => (source?.columns ?? []).filter((c) => ['select', 'multiselect', 'boolean', 'relation'].includes(c.fieldType)),
    [source]
  )
  const activeFilterCol = useMemo(
    () => filterCols.find((c) => c.id === filterColumnId),
    [filterCols, filterColumnId]
  )

  useEffect(() => {
    if (!open) return
    if (editing) {
      setSourceId(editing.sourceId)
      setMeasureKey(measureKeyFromCard(editing))
      setChart(editing.chart)
      setTargetValue(editing.targetValue ? String(editing.targetValue) : '')
      setTitle(editing.title)
      setTitleTouched(true)
      setDateRange(editing.dateRange || '30d')
      setFilterColumnId(editing.filterColumnId || '')
      setFilterValue(editing.filterValue || '')
      setChip(editing.chip || 'brand')
      setMoreOpen(Boolean(editing.filterColumnId))
      return
    }
    const first = sources[0]
    const firstMeasures = buildMeasureChoices(first)
    const defaultM = firstMeasures[1] || firstMeasures[0]
    setSourceId(first?.id || 'builtin:finance')
    setMeasureKey(defaultM?.key || 'count')
    setChart(defaultM?.kind === 'breakdown' ? 'donut' : 'number')
    setTargetValue('')
    setTitleTouched(false)
    setDateRange(first?.id === 'builtin:stock' || first?.id === 'builtin:staff' || first?.id === 'local:offerings' ? 'all' : '30d')
    setFilterColumnId('')
    setFilterValue('')
    setChip('brand')
    setMoreOpen(false)
  }, [open, editing, sources])

  const effectiveKind: KpiMetricKind =
    activeMeasure?.kind === 'breakdown'
      ? 'breakdown'
      : GOAL_CHARTS.includes(chart)
        ? 'goal'
        : 'time'

  useEffect(() => {
    if (!open || titleTouched || !activeMeasure) return
    setTitle(
      suggestCardTitle(
        source,
        effectiveKind,
        activeMeasure.aggregation,
        activeMeasure.valueColumnId,
        activeMeasure.groupByColumnId,
        filterValue || null
      )
    )
  }, [open, titleTouched, source, activeMeasure, effectiveKind, filterValue])

  const reposition = useCallback(() => {
    const panel = panelRef.current
    if (!panel || !anchorEl || !anchorEl.isConnected) return
    const rect = anchorEl.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pw = panel.offsetWidth || Math.min(392, vw - EDGE * 2)
    const ph = panel.offsetHeight || 360

    let left = rect.right - pw
    left = Math.max(EDGE, Math.min(left, vw - pw - EDGE))

    const spaceBelow = vh - rect.bottom - GAP - EDGE
    const spaceAbove = rect.top - GAP - EDGE
    let top: number
    let maxHeight: number
    if (spaceBelow >= Math.min(ph, 260) || spaceBelow >= spaceAbove) {
      top = Math.max(EDGE, rect.bottom + GAP)
      maxHeight = Math.max(220, vh - top - EDGE)
    } else {
      maxHeight = Math.max(220, spaceAbove)
      top = Math.max(EDGE, rect.top - GAP - Math.min(ph, maxHeight))
    }
    setPos({ top, left, maxHeight })
  }, [anchorEl])

  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setPos(null)
      return
    }
    reposition()
    const raf = window.requestAnimationFrame(reposition)
    return () => window.cancelAnimationFrame(raf)
  }, [open, anchorEl, editing?.id, moreOpen, chart, reposition])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (anchorEl?.contains(target)) return
      if (target.closest('[role="tooltip"]')) return
      onClose()
    }
    const onScrollOrResize = (e: Event) => {
      const target = e.target as Node | null
      if (target && panelRef.current?.contains(target)) return
      reposition()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
    }
  }, [open, anchorEl, onClose, reposition])

  if (!open || typeof document === 'undefined' || !document.body) return null

  const availablePresets = presets.filter((p) => !existingIds.has(p.id))
  const myTables = sources.filter((x) => x.group === 'Veri Tablolarım')
  const moduleTables = sources.filter((x) => x.group === 'İşletme Modülleri')
  const isBreakdown = activeMeasure?.kind === 'breakdown'
  const chartChoices: KpiChartType[] = isBreakdown ? CHARTS_BY_KIND.breakdown : TIME_ALL_CHARTS
  const isGoalChart = !isBreakdown && GOAL_CHARTS.includes(chart)

  const handleSourceChange = (nextId: string) => {
    setSourceId(nextId)
    const nextSrc = sources.find((x) => x.id === nextId)
    const nextMeasures = buildMeasureChoices(nextSrc)
    const pick = nextMeasures[1] || nextMeasures[0]
    setMeasureKey(pick?.key || 'count')
    setChart(pick?.kind === 'breakdown' ? 'donut' : 'number')
    setFilterColumnId('')
    setFilterValue('')
    if (nextId === 'builtin:stock' || nextId === 'builtin:staff' || nextId === 'local:offerings') {
      setDateRange('all')
    }
  }

  const handleMeasureChange = (nextKey: string) => {
    setMeasureKey(nextKey)
    const m = measures.find((x) => x.key === nextKey)
    if (m?.kind === 'breakdown') {
      if (!CHARTS_BY_KIND.breakdown.includes(chart)) setChart('donut')
    } else if (!TIME_ALL_CHARTS.includes(chart)) {
      setChart('area')
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!source || !activeMeasure) return
    const firstDateCol = source.columns.find((c) => c.fieldType === 'date')
    const parsedTarget = Number(targetValue)
    const validChart = chartChoices.includes(chart) ? chart : chartChoices[0]
    const icon =
      activeMeasure.valueColumnId &&
      source.columns.find((c) => c.id === activeMeasure.valueColumnId)?.fieldType === 'currency'
        ? 'wallet'
        : effectiveKind === 'breakdown'
          ? 'channels'
          : effectiveKind === 'goal'
            ? 'target'
            : 'sales'

    onSave({
      id: editing?.id || `kpi-${Date.now().toString(36)}`,
      title: title.trim() || source.name,
      sourceId: source.id,
      kind: effectiveKind,
      aggregation: activeMeasure.aggregation,
      valueColumnId: activeMeasure.valueColumnId ?? null,
      groupByColumnId: effectiveKind === 'breakdown' ? activeMeasure.groupByColumnId ?? null : null,
      dateColumnId: effectiveKind === 'time' ? firstDateCol?.id || '__createdAt__' : null,
      dateRange,
      filterColumnId: filterColumnId && filterValue ? filterColumnId : null,
      filterValue: filterColumnId && filterValue ? filterValue : null,
      targetValue: effectiveKind === 'goal' && Number.isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : null,
      chart: validChart,
      icon: editing?.icon || icon,
      chip,
    })
  }

  const chartSection = (
    <div className={s.formLabel}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        Grafik görünümü
        <InfoTooltip title="Grafik görünümü" glyph="?">
          Sade sayı veya istediğiniz grafik türünü seçin.
        </InfoTooltip>
      </span>
      <div className={s.chartChoiceGrid} role="radiogroup" aria-label="Grafik görünümü">
        {chartChoices.map((id) => {
          const meta = CHART_META[id]
          const Icon = meta.icon
          const on = chart === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              title={meta.hint}
              className={on ? s.chartChoiceOn : s.chartChoice}
              onClick={() => setChart(id)}
            >
              <Icon size={12} color={on ? '#ffffff' : undefined} style={{ flexShrink: 0 }} />
              <span className={s.chartChoiceText}>{meta.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )

  const sourceAndMeasure = (
    <div className={s.formGrid2}>
      <label className={s.formLabel}>
        <span>Tablo</span>
        <select
          aria-label="Veri kaynağı tablo"
          className={s.formField}
          value={source?.id || ''}
          onChange={(e) => handleSourceChange(e.target.value)}
        >
          {myTables.length > 0 && (
            <optgroup label="Veri Tablolarım">
              {myTables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.rowCount})
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="İşletme Modülleri">
            {moduleTables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.rowCount})
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <label className={s.formLabel}>
        <span>Ne ölçelim?</span>
        <select
          aria-label="Ölçüm seçimi"
          className={s.formField}
          value={activeMeasure?.key || 'count'}
          onChange={(e) => handleMeasureChange(e.target.value)}
        >
          {measures.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )

  return createPortal(
    <form
      ref={panelRef}
      className={s.dropdownPanel}
      role="dialog"
      aria-label={editing ? 'Kartı Düzenle' : 'Analiz Kartı Ekle'}
      style={{
        top: pos?.top ?? 12,
        left: pos?.left ?? 12,
        maxHeight: pos?.maxHeight ?? 560,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
      onSubmit={submit}
    >
      <div className={s.dropdownBody}>
        {/* Yeni eklerken tek tık hazır öneriler */}
        {!editing && availablePresets.length > 0 && (
          <>
            <div className={s.dropSectionHead}>
              <span className={s.dropSectionLabel}>
                Hızlı Ekle
                <InfoTooltip title="Hızlı Ekle" glyph="?">
                  Mevcut tablolarınızdan hazır kartları tek tıkla ekleyin.
                </InfoTooltip>
              </span>
              <button type="button" className={s.iconToolBtn} style={{ width: 24, height: 24 }} aria-label="Kapat" onClick={onClose}>
                <X size={14} />
              </button>
            </div>
            <div className={s.presetGrid}>
              {availablePresets.slice(0, 4).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={s.presetChip}
                  onClick={() => onQuickAddPreset(preset)}
                >
                  <Plus size={11} color="var(--accent)" />
                  <span>{preset.title}</span>
                </button>
              ))}
            </div>
            <div className={s.dropDivider} />
          </>
        )}

        <div className={s.dropSectionHead}>
          <span className={s.dropSectionLabel}>
            {editing ? 'Kartı Düzenle' : 'Kendin Oluştur'}
            <InfoTooltip title={editing ? 'Kartı Düzenle' : 'Özel Analiz Kartı'} glyph="?">
              Grafik görünümünü, veri kaynağını ve başlığı buradan anında düzenleyebilirsiniz.
            </InfoTooltip>
          </span>
          {(editing || availablePresets.length === 0) && (
            <button type="button" className={s.iconToolBtn} style={{ width: 24, height: 24 }} aria-label="Kapat" onClick={onClose}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* Düzenlemede grafik görünümü hemen üstte; yeni eklemede önce tablo/ölçüm */}
        {editing ? (
          <>
            {chartSection}
            {sourceAndMeasure}
          </>
        ) : (
          <>
            {sourceAndMeasure}
            {chartSection}
          </>
        )}

        {isGoalChart && (
          <label className={s.formLabel}>
            <span>Hedef sayı (isteğe bağlı)</span>
            <input
              type="number"
              min="1"
              className={s.formField}
              placeholder="Boş bırakılırsa otomatik hesaplanır"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
            />
          </label>
        )}

        {/* İsteğe bağlı detaylar (başlık, dönem, filtre, renk) */}
        <button
          type="button"
          className={s.moreToggle}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          {moreOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>Başlık, dönem veya filtre</span>
        </button>

        {moreOpen && (
          <div className={s.moreBox}>
            <div className={s.formGrid2}>
              <label className={s.formLabel}>
                <span>Başlık</span>
                <input
                  type="text"
                  maxLength={60}
                  className={s.formField}
                  value={title}
                  onChange={(e) => {
                    setTitleTouched(true)
                    setTitle(e.target.value)
                  }}
                />
              </label>

              <label className={s.formLabel}>
                <span>Dönem</span>
                <select
                  className={s.formField}
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as KpiDateRange)}
                >
                  {(Object.keys(DATE_RANGE_LABELS) as KpiDateRange[]).map((k) => (
                    <option key={k} value={k}>
                      {DATE_RANGE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {filterCols.length > 0 && (
              <div className={s.formGrid2}>
                <label className={s.formLabel}>
                  <span>Filtre</span>
                  <select
                    className={s.formField}
                    value={filterColumnId}
                    onChange={(e) => {
                      const nextCol = e.target.value
                      setFilterColumnId(nextCol)
                      const col = filterCols.find((c) => c.id === nextCol)
                      setFilterValue(col?.values?.[0] || '')
                    }}
                  >
                    <option value="">Tümü</option>
                    {filterCols.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>

                {filterColumnId && (
                  <label className={s.formLabel}>
                    <span>Değer</span>
                    {activeFilterCol?.values && activeFilterCol.values.length > 0 ? (
                      <select
                        className={s.formField}
                        value={filterValue}
                        onChange={(e) => setFilterValue(e.target.value)}
                      >
                        {activeFilterCol.values.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className={s.formField}
                        placeholder="Değer"
                        value={filterValue}
                        onChange={(e) => setFilterValue(e.target.value)}
                      />
                    )}
                  </label>
                )}
              </div>
            )}

            <div className={s.pillRow} style={{ alignItems: 'center', gap: 7 }}>
              {(Object.keys(CHIP_COLORS) as KpiChipTone[]).map((tone) => (
                <button
                  key={tone}
                  type="button"
                  aria-label={CHIP_COLORS[tone].label}
                  className={chip === tone ? s.colorDotBtnOn : s.colorDotBtn}
                  style={{
                    width: 20,
                    height: 20,
                    background: `linear-gradient(145deg, ${CHIP_COLORS[tone].light}, ${CHIP_COLORS[tone].dark})`,
                  }}
                  onClick={() => setChip(tone)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={s.dropdownFoot}>
        <button type="button" className={depth.btn} style={{ minHeight: 30, fontSize: 12 }} onClick={onClose}>
          Vazgeç
        </button>
        <button type="submit" className={depth.btnPrimary} style={{ minHeight: 30, padding: '0 14px', fontSize: 12 }}>
          <Check size={13} color="#ffffff" />
          <span style={{ color: '#ffffff' }}>{editing ? 'Kaydet' : 'Ekle'}</span>
        </button>
      </div>
    </form>,
    document.body
  )
}
