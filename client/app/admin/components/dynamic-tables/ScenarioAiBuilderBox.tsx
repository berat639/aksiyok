'use client'

import React, { useState } from 'react'
import { Check, ChevronDown, ChevronUp, Loader2, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import InfoTooltip from '../ui/InfoTooltip'
import type { StudioSchemaResponse } from './types'

export interface ScenarioAiBuilderBoxProps {
  existingTableCount: number
  collapsible?: boolean
  defaultExpanded?: boolean
  floatingDropdown?: boolean
  onScenarioApplied: (nextSchema: StudioSchemaResponse) => void
}

const ADDITIVE_SUGGESTIONS: Array<{ label: string; prompt: string }> = [
  {
    label: '+ Şirket / Tedarikçi Bağla',
    prompt:
      'Mevcut ana işlem/teklif listesine bağlı Partner Şirketler listesi ekle; şirket adı, telefon ve tutar/taksit bilgileri tutulsun.',
  },
  {
    label: '+ Özellik / Teminat',
    prompt:
      'Ana listeye bağlı Ek Özellikler ve Detaylar listesi ekle; başlık ve açıklama alanlarıyla 2 örnek kayıt oluştur.',
  },
  {
    label: '+ Evrak / Sözleşme',
    prompt:
      'Görüşme ve işlemlere bağlı Gerekli Evraklar listesi ekle; evrak adı ve teslim durumu tutulsun.',
  },
]

const INITIAL_SUGGESTIONS: Array<{ label: string; prompt: string }> = [
  {
    label: 'Danışmanlık / Hizmet',
    prompt:
      'Danışmanlık ve hizmet merkezimiz için müşteriler randevuya gelsin, yapılacak hizmet paketleri ve alt detay kalemleri seçilebilsin.',
  },
  {
    label: 'Emlak Randevu',
    prompt:
      'Emlak ofisiyiz; alıcı ve kiracı adayları randevuya gelsin, gösterilecek portföy ilanlarında İlan Linki (Sahibinden/Hepsiemlak URL) alanı da bulunsun ve seçilsin, her ilana bağlı mülk sahipleri ve gayrimenkul özellikleri olsun.',
  },
  {
    label: 'Sigorta Teklif',
    prompt:
      'Sigorta acentesiyiz; müşteriler görüşmeye gelsin, sunulacak sigorta teklifleri seçilsin, her teklifin altında sigorta şirketleri ve ek teminatlar seçilebilsin.',
  },
  {
    label: 'Klinik Tedavi Planı',
    prompt:
      'Kliniğimiz için hastalar, sorumlu hekimler, tedavi planları (diş/çene bölgesi, yüzeyler, katman, fiyat, iskonto, TDB kontrol hatırlatma, röntgen ve onam durumu), tedaviler kataloğu, bağlı endikasyonlar ve sarf malzemeler listelerini tam bağlantılı oluştur.',
  },
]

export default function ScenarioAiBuilderBox({
  existingTableCount,
  collapsible = true,
  defaultExpanded = true,
  floatingDropdown = false,
  onScenarioApplied,
}: ScenarioAiBuilderBoxProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [scenarioText, setScenarioText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [lastResultSummary, setLastResultSummary] = useState<string | null>(null)

  const suggestions =
    existingTableCount > 0 ? ADDITIVE_SUGGESTIONS : INITIAL_SUGGESTIONS

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const clean = scenarioText.trim()
    if (clean.length < 4) {
      toast.error('Lütfen ne eklemek istediğinizi kısaca yazınız')
      return
    }
    setSubmitting(true)
    setLastResultSummary(null)
    try {
      const res = await fetch('/api/dynamic-tables/ai-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: clean }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Senaryo uygulanamadı')
        return
      }
      setScenarioText('')
      const msg =
        typeof data.summary === 'string' && data.summary.trim()
          ? data.summary.trim()
          : 'Yeni listeler ve bağlantılar eklendi.'
      setLastResultSummary(msg)
      if (data.schema) {
        onScenarioApplied(data.schema as StudioSchemaResponse)
      }
      toast.success(msg)
    } catch {
      toast.error('Senaryo işlenirken ağ hatası oluştu')
    } finally {
      setSubmitting(false)
    }
  }

  if (collapsible && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={depth.btnPrimary}
        style={{
          minHeight: 32,
          padding: '5px 12px',
          fontSize: 12,
          borderRadius: 999,
          boxShadow: 'var(--pc-modal-shadow)',
        }}
        title="Senaryonuzu yazarak mevcut yapıya ek tablolar ve bağlantılar oluşturun"
      >
        <Sparkles size={13} color="#ffffff" />
        <span>Senaryodan Tablo Ekle</span>
        <ChevronDown size={13} color="#ffffff" />
      </button>
    )
  }

  const cardBody = (
    <div
      className="nodrag"
      onClick={(e) => e.stopPropagation()}
      style={{
        width: collapsible ? 'min(314px, calc(100vw - 32px))' : '100%',
        borderRadius: 13,
        border: '1.5px solid var(--input-border)',
        background: 'var(--card-bg)',
        color: 'var(--foreground)',
        boxShadow: collapsible ? 'var(--pc-modal-shadow)' : 'var(--pc-neo-subcard)',
        padding: '9px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
      }}
    >
      {/* Kompakt Başlık */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Sparkles size={14} style={{ color: 'var(--pc-blue)', flexShrink: 0 }} />
          <strong
            style={{
              fontSize: 12,
              color: 'var(--foreground)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Senaryodan Otomatik Tablo Kur
          </strong>
          <InfoTooltip title="Senaryodan Otomatik Tablo & Bağlantı" placement="left">
            Ne kurmak veya mevcut yapınıza <strong>ek olarak</strong> ne bağlamak istediğinizi günlük dille yazın. Mevcut tablolarınız silinmez; yeni tablolar, sütunlar, örnek kayıtlar ve randevu bağlantıları üzerine eklenir.
          </InfoTooltip>
        </div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span
            className={depth.badge}
            style={{ fontSize: 10, padding: '1px 6px' }}
          >
            Üzerine Ekler
          </span>
          {collapsible && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className={depth.btn}
              style={{ minHeight: 22, padding: '1px 5px' }}
              title="Kutuyu küçült"
            >
              <ChevronUp size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Kompakt Metin Kutusu */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          rows={2}
          value={scenarioText}
          disabled={submitting}
          onChange={(e) => setScenarioText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void handleSubmit()
            }
          }}
          placeholder={
            existingTableCount > 0
              ? 'Ne eklemek istiyorsunuz? Örn: Tekliflere bağlı Ek Teminatlar veya İlanlara bağlı Mülk Sahipleri ekle…'
              : 'Sektörünüzü ve senaryonuzu yazın: Örn: Emlak randevusu, sigorta teklif takibi, danışmanlık…'
          }
          className={depth.input}
          style={{
            width: '100%',
            minHeight: 52,
            maxHeight: 92,
            resize: 'vertical',
            fontSize: 11.5,
            lineHeight: 1.4,
            padding: '6px 8px',
          }}
        />

        {/* Tek Tıkla Örnek Senaryo Çipleri + Gönder Butonu */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 5,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
            {suggestions.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={submitting}
                onClick={() => setScenarioText(item.prompt)}
                className={depth.btn}
                style={{
                  minHeight: 22,
                  padding: '1px 6px',
                  fontSize: 10,
                }}
                title={item.prompt}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="submit"
            disabled={submitting || scenarioText.trim().length < 4}
            className={depth.btnPrimary}
            style={{
              minHeight: 27,
              padding: '3px 10px',
              fontSize: 11.5,
              marginLeft: 'auto',
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={12} color="#ffffff" className="animate-spin" />
                <span>Kuruluyor…</span>
              </>
            ) : (
              <>
                <Wand2 size={12} color="#ffffff" />
                <span>Oluştur / Ekle</span>
              </>
            )}
          </button>
        </div>
      </form>

      {lastResultSummary && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 5,
            padding: '5px 7px',
            borderRadius: 8,
            background: 'var(--pc-tint)',
            border: '1px solid var(--pc-border)',
            color: 'var(--pc-tint-fg)',
            fontSize: 10.5,
            fontWeight: 600,
            lineHeight: 1.35,
          }}
        >
          <Check size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{lastResultSummary}</span>
        </div>
      )}
    </div>
  )

  if (floatingDropdown) {
    return (
      <div style={{ position: 'relative', display: 'inline-flex', maxWidth: '100%' }}>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className={depth.btnPale}
          style={{
            minHeight: 31,
            padding: '4px 11px',
            fontSize: 12,
            borderRadius: 999,
          }}
        >
          <Sparkles size={13} />
          <span>Senaryo Kutusunu Kapat</span>
          <ChevronUp size={13} />
        </button>
        <div
          onClick={() => setExpanded(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'transparent' }}
        />
        <div
          style={{
            position: 'fixed',
            top: 138,
            right: 16,
            left: 'auto',
            maxWidth: 'calc(100vw - 32px)',
            zIndex: 60,
          }}
        >
          {cardBody}
        </div>
      </div>
    )
  }

  return cardBody
}
