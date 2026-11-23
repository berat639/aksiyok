import {
  BatteryFull,
  Bot,
  ChartArea,
  ChartBarBig,
  ChartBarStacked,
  ChartColumn,
  ChartLine,
  ChartNoAxesColumn,
  ChartPie,
  ChartSpline,
  CircleDot,
  Clock,
  Cloud,
  CreditCard,
  Gauge,
  Grid3x3,
  Hash,
  LayoutGrid,
  Package,
  PhoneCall,
  Radar,
  ShoppingBag,
  Smile,
  Store,
  Table2,
  Target,
  Truck,
  Undo2,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { OfferingItem } from '@/lib/business-profile'
import type {
  KpiCardConfig,
  KpiChartType,
  KpiChipTone,
  KpiDateRange,
  KpiIconKey,
  KpiMetric,
  KpiMetricKind,
  KpiSourceDescriptor,
  KpiUnitFormat,
} from './kpi-types'

export interface ChartMeta {
  id: KpiChartType
  label: string
  hint: string
  icon: LucideIcon
}

export const CHART_META: Record<KpiChartType, ChartMeta> = {
  line: { id: 'line', label: 'Çizgi', hint: 'Zamanla değişim', icon: ChartLine },
  area: { id: 'area', label: 'Alan', hint: 'Dolu eğri görünümü', icon: ChartArea },
  bar: { id: 'bar', label: 'Sütun', hint: 'Her dönem için sütun', icon: ChartColumn },
  step: { id: 'step', label: 'Basamak', hint: 'Kademeli değişim', icon: ChartSpline },
  spark: { id: 'spark', label: 'Mini eğri', hint: 'Sade eğri görünümü', icon: ChartNoAxesColumn },
  heat: { id: 'heat', label: 'Yoğunluk', hint: 'Koyu ton = yüksek değer', icon: Grid3x3 },
  donut: { id: 'donut', label: 'Halka', hint: 'Parçaların payı', icon: CircleDot },
  pie: { id: 'pie', label: 'Pasta', hint: 'Dilim dağılımı', icon: ChartPie },
  hbar: { id: 'hbar', label: 'Yatay bar', hint: 'Sıralı karşılaştırma', icon: ChartBarBig },
  radar: { id: 'radar', label: 'Radar', hint: 'Denge görünümü', icon: Radar },
  blocks: { id: 'blocks', label: 'Kutular', hint: 'Büyük kutu = büyük pay', icon: LayoutGrid },
  stack: { id: 'stack', label: 'Yığın bar', hint: 'Tek şeritte paylar', icon: ChartBarStacked },
  gauge: { id: 'gauge', label: 'Gösterge', hint: 'Yarım daire hedef göstergesi', icon: Gauge },
  ring: { id: 'ring', label: 'Halka hedef', hint: 'Doluluk halkası', icon: CircleDot },
  progress: { id: 'progress', label: 'İlerleme', hint: 'İlerleme çubuğu', icon: ChartBarBig },
  segments: { id: 'segments', label: 'Dilimli hedef', hint: 'Parçalı doluluk', icon: BatteryFull },
  number: { id: 'number', label: 'Sade sayı', hint: 'Grafiksiz, sadece sayı', icon: Hash },
  table: { id: 'table', label: 'Tablo', hint: 'Satır satır liste', icon: Table2 },
}

export const GOAL_CHARTS: KpiChartType[] = ['gauge', 'ring', 'progress', 'segments']

export const CHARTS_BY_KIND: Record<KpiMetricKind, KpiChartType[]> = {
  time: ['number', 'area', 'line', 'bar', 'step', 'spark', 'heat', 'table'],
  breakdown: ['donut', 'pie', 'hbar', 'bar', 'radar', 'blocks', 'stack', 'number', 'table'],
  goal: ['gauge', 'ring', 'progress', 'segments', 'number', 'table'],
}

export const TIME_ALL_CHARTS: KpiChartType[] = [...CHARTS_BY_KIND.time, ...GOAL_CHARTS]

export const METRIC_ICONS: Record<KpiIconKey, { icon: LucideIcon; label: string }> = {
  wallet: { icon: Wallet, label: 'Finans' },
  sales: { icon: ShoppingBag, label: 'Satış' },
  visitors: { icon: Users, label: 'Ziyaret' },
  customers: { icon: UserPlus, label: 'Müşteri' },
  clock: { icon: Clock, label: 'Zaman' },
  package: { icon: Package, label: 'Stok' },
  channels: { icon: Store, label: 'Dağılım' },
  target: { icon: Target, label: 'Hedef' },
  smile: { icon: Smile, label: 'Memnuniyet' },
  truck: { icon: Truck, label: 'Operasyon' },
  returns: { icon: Undo2, label: 'İade' },
  phone: { icon: PhoneCall, label: 'Görüşme' },
  cloud: { icon: Cloud, label: 'Hesap' },
  credit: { icon: CreditCard, label: 'Harcama' },
  bot: { icon: Bot, label: 'Asistan' },
}

export const CHIP_COLORS: Record<KpiChipTone, { label: string; light: string; dark: string }> = {
  brand: { label: 'Mavi', light: '#4a82f2', dark: '#1d52d1' },
  mint: { label: 'Yeşil', light: '#2fd6a6', dark: '#0e9a74' },
  amber: { label: 'Kehribar', light: '#ffbe3d', dark: '#d97706' },
  coral: { label: 'Mercan', light: '#ff8591', dark: '#dc2626' },
  violet: { label: 'Mor', light: '#a58bff', dark: '#6d28d9' },
}

export const DATE_RANGE_LABELS: Record<KpiDateRange, string> = {
  today: 'Bugün',
  '7d': 'Son 7 gün',
  '30d': 'Son 30 gün',
  this_month: 'Bu ay',
  '6m': 'Son 6 ay',
  all: 'Tüm kayıtlar',
}

export function getMetricIcon(key: KpiIconKey): LucideIcon {
  return METRIC_ICONS[key]?.icon ?? ChartColumn
}

export function formatKpiNumber(value: number, unit: KpiUnitFormat = {}): string {
  const safe = Number.isFinite(value) ? value : 0
  const decimals = unit.decimals ?? 0
  const text = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(safe)
  return `${unit.prefix ?? ''}${text}${unit.suffix ?? ''}`
}

export function formatKpiCompact(value: number, unit: KpiUnitFormat = {}): string {
  const safe = Number.isFinite(value) ? value : 0
  if (Math.abs(safe) >= 10000) {
    const compact = new Intl.NumberFormat('tr-TR', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(safe)
    return `${unit.prefix ?? ''}${compact}${unit.suffix ?? ''}`
  }
  return formatKpiNumber(safe, unit)
}

export function getKpiHeadline(metric: KpiMetric): number {
  if (metric.kind === 'goal') return metric.value
  if (metric.kind === 'breakdown') {
    return metric.items.reduce((sum, item) => sum + item.value, 0)
  }
  if (typeof metric.headlineValue === 'number' && Number.isFinite(metric.headlineValue)) {
    return metric.headlineValue
  }
  if (metric.points.length === 0) return 0
  const values = metric.points.map((p) => p.value)
  if (metric.headline === 'sum') return values.reduce((a, b) => a + b, 0)
  if (metric.headline === 'avg') return values.reduce((a, b) => a + b, 0) / values.length
  return values[values.length - 1] ?? 0
}

export function getGoalPercent(metric: KpiMetric): number {
  if (metric.kind !== 'goal' || metric.target <= 0) return 0
  return Math.max(0, Math.min(100, (metric.value / metric.target) * 100))
}

/** Yerel Ürün ve Hizmetler verisini aynı kaynak ve metrik formatına dönüştürür. */
export function buildOfferingsSource(items: OfferingItem[]): KpiSourceDescriptor {
  return {
    id: 'local:offerings',
    kind: 'local',
    name: 'Ürün ve Hizmetler',
    group: 'İşletme Modülleri',
    rowCount: items.length,
    columns: [
      { id: 'kind', name: 'Tür', fieldType: 'select', values: ['Hizmet', 'Ürün'] },
    ],
  }
}

export function evaluateLocalOfferingCard(cfg: KpiCardConfig, items: OfferingItem[]): KpiMetric {
  const filtered =
    cfg.filterColumnId === 'kind' && cfg.filterValue
      ? items.filter((i) => (i.kind === 'urun' ? 'Ürün' : 'Hizmet') === cfg.filterValue)
      : items

  const base = {
    id: cfg.id,
    title: cfg.title,
    tooltip: `Kaynak: Ürün ve Hizmetler · ${cfg.filterValue ? `Filtre: ${cfg.filterValue} · ` : ''}Toplam ${filtered.length} kayıt`,
    sourceName: 'Ürün ve Hizmetler',
    icon: cfg.icon || 'sales',
    chip: cfg.chip || 'violet',
    unit: { decimals: 0 },
    goodDirection: cfg.goodDirection || 'up',
    previous: null,
    compareLabel: '',
    upWord: 'artış',
    downWord: 'düşüş',
    defaultChart: cfg.chart,
    supports: CHARTS_BY_KIND[cfg.kind],
  } as const

  if (cfg.kind === 'breakdown') {
    const hizmet = filtered.filter((i) => i.kind === 'hizmet').length
    const urun = filtered.filter((i) => i.kind === 'urun').length
    const breakdownItems = [
      ...(hizmet > 0 ? [{ name: 'Hizmet', value: hizmet }] : []),
      ...(urun > 0 ? [{ name: 'Ürün', value: urun }] : []),
    ]
    return { ...base, kind: 'breakdown', items: breakdownItems }
  }
  if (cfg.kind === 'goal') {
    const target = cfg.targetValue && cfg.targetValue > 0 ? cfg.targetValue : Math.max(10, items.length)
    return { ...base, kind: 'goal', value: filtered.length, target, targetLabel: cfg.targetLabel || 'Hedef' }
  }
  return {
    ...base,
    kind: 'time',
    headline: 'sum',
    points: [{ label: 'Katalog', value: filtered.length }],
  }
}

/** Yeni bir kart oluştururken tablo+ölçüme göre sade Türkçe başlık önerir. */
export function suggestCardTitle(
  source: KpiSourceDescriptor | undefined,
  kind: KpiMetricKind,
  aggregation: 'count' | 'sum' | 'avg',
  valueColId?: string | null,
  groupByColId?: string | null,
  filterVal?: string | null
): string {
  if (!source) return 'Yeni Gösterge'
  const valCol = valueColId ? source.columns.find((c) => c.id === valueColId) : undefined
  const grpCol = groupByColId ? source.columns.find((c) => c.id === groupByColId) : undefined
  const suffix = filterVal ? ` (${filterVal})` : ''
  if (kind === 'breakdown' && grpCol) {
    return `${source.name} — ${grpCol.name}${suffix}`
  }
  if (aggregation === 'sum' && valCol) {
    return `${source.name} ${valCol.name}${suffix}`
  }
  if (aggregation === 'avg' && valCol) {
    return `Ort. ${valCol.name}${suffix}`
  }
  return `${source.name}${suffix}`
}

const LOCAL_CARDS_KEY = 'axamaz.kpi-cards.v1'
export function loadLocalKpiCards(scope?: string | null): KpiCardConfig[] | null {
  try {
    const key = scope ? `${LOCAL_CARDS_KEY}:${scope}` : LOCAL_CARDS_KEY
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveLocalKpiCards(cards: KpiCardConfig[], scope?: string | null): void {
  try {
    const key = scope ? `${LOCAL_CARDS_KEY}:${scope}` : LOCAL_CARDS_KEY
    window.localStorage.setItem(key, JSON.stringify(cards))
  } catch {
    /* depolama kapalı */
  }
}
