'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Building2, ChevronDown, Clock, MapPin, Plus, RefreshCw } from 'lucide-react'
import {
  formatDayHours,
  loadOfferings,
  type BusinessProfile,
} from '@/lib/business-profile'
import depth from '@/styles/clinic-depth.module.css'
import InfoTooltip from '../../../../../admin/components/ui/InfoTooltip'
import { BusinessPackageCard } from './BusinessPackageCard'
import { KpiBuilderModal } from './KpiBuilderModal'
import { KpiCard } from './KpiCard'
import type {
  KpiCardConfig,
  KpiMetric,
  KpiSourceDescriptor,
} from './kpi-types'
import {
  buildOfferingsSource,
  evaluateLocalOfferingCard,
  loadLocalKpiCards,
  saveLocalKpiCards,
} from './kpi-utils'
import s from './kpi.module.css'

interface CachedSummary {
  sources: KpiSourceDescriptor[]
  presets: KpiCardConfig[]
  cards: KpiCardConfig[]
  metricsById: Record<string, KpiMetric>
}

const memCache = new Map<string, CachedSummary>()
const SESSION_PREFIX = 'axamaz.kpi-cache.v1:'

function readCachedSummary(scope: string | null): CachedSummary | null {
  const key = scope || 'default'
  const mem = memCache.get(key)
  if (mem) return mem
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(SESSION_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedSummary
    if (parsed && Array.isArray(parsed.cards) && Array.isArray(parsed.sources)) {
      memCache.set(key, parsed)
      return parsed
    }
  } catch {
    /* sessionStorage kapalı */
  }
  return null
}

function writeCachedSummary(scope: string | null, data: CachedSummary) {
  const key = scope || 'default'
  memCache.set(key, data)
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify(data))
  } catch {
    /* kota dolu/kapalı */
  }
}

function onlyVisualChanged(prev: KpiCardConfig | undefined, next: KpiCardConfig): boolean {
  if (!prev) return false
  return (
    prev.sourceId === next.sourceId &&
    prev.kind === next.kind &&
    prev.aggregation === next.aggregation &&
    (prev.valueColumnId ?? null) === (next.valueColumnId ?? null) &&
    (prev.groupByColumnId ?? null) === (next.groupByColumnId ?? null) &&
    (prev.dateColumnId ?? null) === (next.dateColumnId ?? null) &&
    prev.dateRange === next.dateRange &&
    (prev.filterColumnId ?? null) === (next.filterColumnId ?? null) &&
    (prev.filterValue ?? null) === (next.filterValue ?? null) &&
    (prev.targetValue ?? null) === (next.targetValue ?? null)
  )
}

export default function IsletmeOzetSection({
  profile,
  scope,
}: {
  profile: BusinessProfile
  scope: string | null
}) {
  const [initialCache] = useState<CachedSummary | null>(() => readCachedSummary(scope))
  const [sources, setSources] = useState<KpiSourceDescriptor[]>(initialCache?.sources ?? [])
  const [presets, setPresets] = useState<KpiCardConfig[]>(initialCache?.presets ?? [])
  const [cards, setCards] = useState<KpiCardConfig[]>(initialCache?.cards ?? [])
  const [metricsById, setMetricsById] = useState<Record<string, KpiMetric>>(initialCache?.metricsById ?? {})
  const [loading, setLoading] = useState(!initialCache)
  const [refreshing, setRefreshing] = useState(false)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<KpiCardConfig | null>(null)
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null)
  const [logoUrl, setLogoUrl] = useState<string>('')
  const [logoErr, setLogoErr] = useState(false)
  const addBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/admin/settings/branding', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.logoUrl) {
          setLogoUrl(d.logoUrl)
          setLogoErr(false)
        }
      })
      .catch(() => { })
    const onLogoUpdated = (e: Event) => {
      const nextUrl = (e as CustomEvent<string>).detail
      if (typeof nextUrl === 'string') {
        setLogoUrl(nextUrl)
        setLogoErr(false)
      }
    }
    window.addEventListener('business-branding-logo-updated', onLogoUpdated)
    return () => {
      alive = false
      window.removeEventListener('business-branding-logo-updated', onLogoUpdated)
    }
  }, [])

  const closePopover = useCallback(() => {
    setBuilderOpen(false)
    setEditingCard(null)
    setPopoverAnchor(null)
  }, [])

  const mergeLocalOfferings = useCallback(
    (cardList: KpiCardConfig[], baseMetrics: Record<string, KpiMetric>) => {
      const offerings = loadOfferings(scope)
      const merged = { ...baseMetrics }
      for (const c of cardList) {
        if (c.sourceId === 'local:offerings') {
          merged[c.id] = evaluateLocalOfferingCard(c, offerings)
        }
      }
      return merged
    },
    [scope]
  )

  const evaluateSubset = useCallback(
    async (subset: KpiCardConfig[], allCards: KpiCardConfig[]) => {
      const offerings = loadOfferings(scope)
      const localUpdates: Record<string, KpiMetric> = {}
      const remoteSubset: KpiCardConfig[] = []
      for (const c of subset) {
        if (c.sourceId === 'local:offerings') localUpdates[c.id] = evaluateLocalOfferingCard(c, offerings)
        else remoteSubset.push(c)
      }

      if (remoteSubset.length === 0) {
        setMetricsById((prev) => {
          const next = { ...prev, ...localUpdates }
          writeCachedSummary(scope, { sources, presets, cards: allCards, metricsById: next })
          return next
        })
        return
      }

      try {
        const res = await fetch('/api/dynamic-tables/kpi/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ cards: remoteSubset, refresh: true }),
        })
        const data = res.ok ? await res.json() : null
        setMetricsById((prev) => {
          const next = { ...prev, ...(data?.metrics || {}), ...localUpdates }
          writeCachedSummary(scope, { sources, presets, cards: allCards, metricsById: next })
          return next
        })
      } catch {
        if (Object.keys(localUpdates).length > 0) {
          setMetricsById((prev) => ({ ...prev, ...localUpdates }))
        }
      }
    },
    [scope, sources, presets]
  )

  const liveCards = useMemo(
    () => cards.filter((c) => c.sourceId === 'builtin:assistant_live' || c.sourceId === 'builtin:ai_usage'),
    [cards]
  )

  useEffect(() => {
    if (liveCards.length === 0) return
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void evaluateSubset(liveCards, cards)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [liveCards, cards, evaluateSubset])

  const loadBootstrap = useCallback(
    async (isManual = false) => {
      if (isManual) setRefreshing(true)
      else if (!readCachedSummary(scope)) setLoading(true)

      try {
        const res = await fetch(
          isManual ? '/api/dynamic-tables/kpi/bootstrap?refresh=1' : '/api/dynamic-tables/kpi/bootstrap',
          { credentials: 'include' }
        )
        if (!res.ok) return
        const data = await res.json()

        const offerings = loadOfferings(scope)
        const offeringsSrc = buildOfferingsSource(offerings)
        const allSources: KpiSourceDescriptor[] = [
          ...(Array.isArray(data.sources) ? data.sources : []),
          offeringsSrc,
        ]
        const allPresets: KpiCardConfig[] = Array.isArray(data.presets) ? [...data.presets] : []
        if (offerings.length > 0) {
          allPresets.push({
            id: 'preset-local-offerings',
            title: 'Ürün & Hizmet Dağılımı',
            sourceId: 'local:offerings',
            kind: 'breakdown',
            aggregation: 'count',
            groupByColumnId: 'kind',
            dateRange: 'all',
            chart: 'donut',
            icon: 'sales',
            chip: 'violet',
          })
        }

        const serverCards: KpiCardConfig[] | null = Array.isArray(data.cards) ? data.cards : null
        const localCards = loadLocalKpiCards(scope)
        const resolvedCards: KpiCardConfig[] =
          serverCards !== null
            ? serverCards
            : localCards !== null
              ? localCards
              : Array.isArray(data.activeCards)
                ? data.activeCards
                : allPresets.slice(0, 4)

        let nextMetrics = mergeLocalOfferings(resolvedCards, data.metrics || {})

        // Yalnızca localStorage'da olup sunucunun henüz bilmediği kartlar varsa ek hesapla
        const missingRemote = resolvedCards.filter(
          (c) => c.sourceId !== 'local:offerings' && !nextMetrics[c.id]
        )
        if (missingRemote.length > 0) {
          const evRes = await fetch('/api/dynamic-tables/kpi/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ cards: missingRemote }),
          })
          if (evRes.ok) {
            const evData = await evRes.json()
            nextMetrics = { ...nextMetrics, ...(evData?.metrics || {}) }
          }
        }

        setSources(allSources)
        setPresets(allPresets)
        setCards(resolvedCards)
        setMetricsById(nextMetrics)
        writeCachedSummary(scope, {
          sources: allSources,
          presets: allPresets,
          cards: resolvedCards,
          metricsById: nextMetrics,
        })
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [scope, mergeLocalOfferings]
  )

  useEffect(() => {
    void loadBootstrap(false)
  }, [loadBootstrap])

  const persistCards = useCallback(
    (next: KpiCardConfig[], nextMetrics?: Record<string, KpiMetric>) => {
      setCards(next)
      saveLocalKpiCards(next, scope)
      writeCachedSummary(scope, {
        sources,
        presets,
        cards: next,
        metricsById: nextMetrics ?? metricsById,
      })
      fetch('/api/dynamic-tables/kpi/cards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cards: next }),
      }).catch(() => { })
    },
    [scope, sources, presets, metricsById]
  )

  const handleSaveCard = useCallback(
    (card: KpiCardConfig) => {
      const prevCard = cards.find((c) => c.id === card.id)
      const next = prevCard ? cards.map((c) => (c.id === card.id ? card : c)) : [...cards, card]
      const existingMetric = metricsById[card.id]

      closePopover()

      // Sadece grafik görünümü/başlık/renk değiştiyse anında (0ms) güncelle
      if (existingMetric && onlyVisualChanged(prevCard, card)) {
        const updatedMetric: KpiMetric = {
          ...existingMetric,
          title: card.title,
          chip: card.chip ?? existingMetric.chip,
          icon: card.icon ?? existingMetric.icon,
          defaultChart: card.chart,
        }
        const nextMetrics = { ...metricsById, [card.id]: updatedMetric }
        setMetricsById(nextMetrics)
        persistCards(next, nextMetrics)
        return
      }

      persistCards(next)
      void evaluateSubset([card], next)
    },
    [cards, metricsById, persistCards, evaluateSubset, closePopover]
  )

  const handleQuickAddPreset = useCallback(
    (preset: KpiCardConfig) => {
      if (cards.some((c) => c.id === preset.id)) return
      const next = [...cards, preset]
      persistCards(next)
      void evaluateSubset([preset], next)
    },
    [cards, persistCards, evaluateSubset]
  )

  const handleRemoveCard = useCallback(
    (cardId: string) => {
      if (editingCard?.id === cardId) closePopover()
      const next = cards.filter((c) => c.id !== cardId)
      const nextMetrics = { ...metricsById }
      delete nextMetrics[cardId]
      setMetricsById(nextMetrics)
      persistCards(next, nextMetrics)
    },
    [cards, metricsById, persistCards, editingCard?.id, closePopover]
  )

  const handleOpenEdit = useCallback(
    (card: KpiCardConfig, anchor: HTMLButtonElement) => {
      if (builderOpen && editingCard?.id === card.id) {
        closePopover()
        return
      }
      setEditingCard(card)
      setPopoverAnchor(anchor)
      setBuilderOpen(true)
    },
    [builderOpen, editingCard?.id, closePopover]
  )

  const todaySummary = useMemo(() => {
    const idx = (new Date().getDay() + 6) % 7
    const day = profile.hours[idx]
    return day ? formatDayHours(day) : '—'
  }, [profile.hours])

  const existingIds = useMemo(() => new Set(cards.map((c) => c.id)), [cards])
  const statCards = useMemo(() => cards.filter((c) => c.chart === 'number' && Boolean(metricsById[c.id])), [cards, metricsById])
  const chartCards = useMemo(() => cards.filter((c) => c.chart !== 'number' && Boolean(metricsById[c.id])), [cards, metricsById])
  const extraCount = profile.extraBusinesses?.length ?? 0

  return (
    <div className={s.summaryWrap}>
      {/* Üst İşletme Şeridi + Analiz Kartı Ekle */}
      <div className={s.bizStrip}>
        <div className={s.bizLeft}>
          {logoUrl && !logoErr ? (
            <span className={s.bizAvatarImgWrap} aria-hidden="true">
              <img
                src={logoUrl}
                alt={`${profile.name} logosu`}
                className={s.bizAvatarImg}
                onError={() => setLogoErr(true)}
              />
            </span>
          ) : (
            <span className={s.bizBadgeIcon} aria-hidden="true">
              <Building2 size={20} strokeWidth={2.3} color="#ffffff" />
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <div className={s.bizTitleRow}>
              <h3 className={s.bizName}>{profile.name}</h3>
              {profile.primaryCategory && (
                <span className={s.bizCatPill}>{profile.primaryCategory}</span>
              )}
              {extraCount > 0 && (
                <span className={s.bizCatPill}>+{extraCount} şube</span>
              )}
              <InfoTooltip title="İşletme Özet" glyph="?">
                Veri Tablolarınızdan ve tüm işletme modüllerinden istediğiniz analiz kartlarını ekleyin. Her kartın sağ üstündeki düzenle (kalem) simgesinden grafik görünümünü ve ayarlarını anında değiştirebilirsiniz.
              </InfoTooltip>
            </div>
            <div className={s.bizMeta}>
              {profile.location?.address && (
                <span className={s.bizMetaItem}>
                  <MapPin size={12} color="#ffffff" />
                  <span>{profile.location.address}</span>
                </span>
              )}
              <span className={s.bizMetaItem}>
                <Clock size={12} color="#ffffff" />
                <span>Bugün: {todaySummary}</span>
              </span>
            </div>
          </div>
        </div>

        <div className={s.bizActions}>
          <button
            type="button"
            className={s.heroGhostBtn}
            style={{ width: 36, padding: 0 }}
            title="Verileri yenile"
            aria-label="Verileri yenile"
            disabled={refreshing}
            onClick={() => void loadBootstrap(true)}
          >
            <RefreshCw size={14} color="#ffffff" />
          </button>

          <button
            ref={addBtnRef}
            type="button"
            className={s.heroPrimaryBtn}
            aria-expanded={builderOpen && !editingCard}
            onClick={() => {
              if (builderOpen && !editingCard) {
                closePopover()
              } else {
                setEditingCard(null)
                setPopoverAnchor(addBtnRef.current)
                setBuilderOpen(true)
              }
            }}
          >
            <Plus size={15} strokeWidth={2.5} color="#0e2152" />
            <span>Analiz Kartı Ekle</span>
            <ChevronDown
              size={14}
              color="#0e2152"
              style={{
                transform: builderOpen && !editingCard ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.18s ease',
              }}
            />
          </button>
        </div>
      </div>

      {/* Sabit Paket ve Abonelik Bilgileri Kartı (yalnızca İşletme Özet'te, silinemez) */}
      <BusinessPackageCard />
      {/* Varsayılan Sabit Paket & Yükseltme Kartı + Kompakt Analiz Kartları */}
      <div className={s.statGrid}>
        <BusinessPackageCard />
        {!loading &&
          statCards.map((card) => (
            <KpiCard
              key={card.id}
              metric={metricsById[card.id]}
              chart={card.chart}
              isEditing={builderOpen && editingCard?.id === card.id}
              onEdit={(anchor) => handleOpenEdit(card, anchor)}
              onRemove={() => handleRemoveCard(card.id)}
            />
          ))}
      </div>

      {/* Analiz Kartları */}
      {/* Grafikli Analiz Kartları / Boş Durum */}
      {loading ? (
        <div className={s.chartEmpty}>Göstergeler hazırlanıyor…</div>
      ) : cards.length === 0 ? (
        <div className={s.emptyHero}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
            Henüz analiz kartı seçilmedi
            Henüz ek analiz kartı seçilmedi
          </span>
          <button
            type="button"
            className={depth.btnPrimary}
            style={{ minHeight: 34, padding: '0 14px', fontSize: 12.5 }}
            onClick={(e) => {
              setEditingCard(null)
              setPopoverAnchor(addBtnRef.current || e.currentTarget)
              setBuilderOpen(true)
            }}
          >
            <Plus size={14} color="#ffffff" />
            <span style={{ color: '#ffffff' }}>İlk Analiz Kartını Ekle</span>
          </button>
        </div>
      ) : (
        <>
          {statCards.length > 0 && (
            <div className={s.statGrid}>
              {statCards.map((card) => (
                <KpiCard
                  key={card.id}
                  metric={metricsById[card.id]}
                  chart={card.chart}
                  isEditing={builderOpen && editingCard?.id === card.id}
                  onEdit={(anchor) => handleOpenEdit(card, anchor)}
                  onRemove={() => handleRemoveCard(card.id)}
                />
              ))}
            </div>
          )}

          {chartCards.length > 0 && (
            <div className={s.kpiGrid}>
              {chartCards.map((card) => (
                <KpiCard
                  key={card.id}
                  metric={metricsById[card.id]}
                  chart={card.chart}
                  isEditing={builderOpen && editingCard?.id === card.id}
                  onEdit={(anchor) => handleOpenEdit(card, anchor)}
                  onRemove={() => handleRemoveCard(card.id)}
                />
              ))}
            </div>
          )}
        </>
        chartCards.length > 0 && (
      <div className={s.kpiGrid}>
        {chartCards.map((card) => (
          <KpiCard
            key={card.id}
            metric={metricsById[card.id]}
            chart={card.chart}
            isEditing={builderOpen && editingCard?.id === card.id}
            onEdit={(anchor) => handleOpenEdit(card, anchor)}
            onRemove={() => handleRemoveCard(card.id)}
          />
        ))}
      </div>
      )
      )}

      {/* Ekle / Kartı Düzenle Popover — tıklanan düğmenin (Ekle veya Kalem) hemen altında açılır */}
      <KpiBuilderModal
        open={builderOpen}
        anchorEl={popoverAnchor}
        sources={sources}
        presets={presets}
        editing={editingCard}
        existingIds={existingIds}
        onClose={closePopover}
        onSave={handleSaveCard}
        onQuickAddPreset={handleQuickAddPreset}
      />
    </div>
  )
}
