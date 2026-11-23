export type KpiMetricKind = 'time' | 'breakdown' | 'goal'

export type KpiChartType =
  | 'line'
  | 'area'
  | 'bar'
  | 'step'
  | 'spark'
  | 'heat'
  | 'donut'
  | 'pie'
  | 'hbar'
  | 'radar'
  | 'blocks'
  | 'stack'
  | 'gauge'
  | 'ring'
  | 'progress'
  | 'segments'
  | 'number'
  | 'table'

export type KpiIconKey =
  | 'sales'
  | 'visitors'
  | 'customers'
  | 'smile'
  | 'channels'
  | 'target'
  | 'wallet'
  | 'clock'
  | 'truck'
  | 'returns'
  | 'package'
  | 'phone'
  | 'cloud'
  | 'credit'
  | 'bot'

export type KpiChipTone = 'brand' | 'mint' | 'amber' | 'coral' | 'violet'
export type KpiAggregation = 'count' | 'sum' | 'avg'
export type KpiDateRange = 'today' | '7d' | '30d' | 'this_month' | '6m' | 'all'

export interface KpiUnitFormat {
  prefix?: string
  suffix?: string
  decimals?: number
}

export interface KpiCardConfig {
  id: string
  title: string
  sourceId: string
  kind: KpiMetricKind
  aggregation: KpiAggregation
  valueColumnId?: string | null
  groupByColumnId?: string | null
  dateColumnId?: string | null
  dateRange?: KpiDateRange
  filterColumnId?: string | null
  filterValue?: string | null
  targetValue?: number | null
  targetLabel?: string | null
  goodDirection?: 'up' | 'down'
  chart: KpiChartType
  icon?: KpiIconKey
  chip?: KpiChipTone
}

export interface KpiColumnOption {
  id: string
  name: string
  fieldType: 'number' | 'currency' | 'select' | 'multiselect' | 'boolean' | 'date' | 'relation' | 'text'
  currencySymbol?: string
  values?: string[]
}

export interface KpiSourceDescriptor {
  id: string
  kind: 'dynamic_table' | 'builtin' | 'local'
  name: string
  group: 'Veri Tablolarım' | 'İşletme Modülleri'
  rowCount: number
  columns: KpiColumnOption[]
}

export interface KpiMetricBase {
  id: string
  title: string
  subtitle?: string
  tooltip: string
  sourceName: string
  icon: KpiIconKey
  chip: KpiChipTone
  unit: KpiUnitFormat
  goodDirection: 'up' | 'down'
  previous: number | null
  compareLabel: string
  upWord: string
  downWord: string
  defaultChart: KpiChartType
  supports: KpiChartType[]
}

export interface KpiTimeMetric extends KpiMetricBase {
  kind: 'time'
  headline: 'last' | 'sum' | 'avg'
  headlineValue?: number
  points: { label: string; value: number }[]
}

export interface KpiBreakdownMetric extends KpiMetricBase {
  kind: 'breakdown'
  items: { name: string; value: number }[]
}

export interface KpiGoalMetric extends KpiMetricBase {
  kind: 'goal'
  value: number
  target: number
  targetLabel: string
}

export type KpiMetric = KpiTimeMetric | KpiBreakdownMetric | KpiGoalMetric
