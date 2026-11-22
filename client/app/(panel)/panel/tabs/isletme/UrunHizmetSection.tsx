'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  LayoutTemplate,
  Loader2,
  Package,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import {
  loadBusinessProfile,
  loadOfferings,
  saveOfferings,
  type BusinessProfile,
  type OfferingItem,
  type OfferingKind,
} from '@/lib/business-profile'
import InfoTooltip from '../../../../admin/components/ui/InfoTooltip'
import clay from './isletme-clay.module.css'
import local from './UrunHizmetSection.module.css'

type Draft = { kind: OfferingKind; title: string; content: string }
const emptyDraft: Draft = { kind: 'hizmet', title: '', content: '' }
const newId = () => `of-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const QUICK_SNIPPETS: { label: string; text: string }[] = [
  { label: '+ Süre & fiyat', text: 'Süre: 45 dakika · Ücret: 750 ₺' },
  { label: '+ Kapsam', text: 'Dahil olanlar: Ön görüşme ve uygulama' },
]

export default function UrunHizmetSection({ scope }: { scope: string | null }) {
  const [items, setItems] = useState<OfferingItem[]>([])
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | OfferingKind>('all')
  const [search, setSearch] = useState('')
  const [warning, setWarning] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedNotice, setSavedNotice] = useState('')
  const [templateBusy, setTemplateBusy] = useState(false)

  useEffect(() => {
    setItems(loadOfferings(scope))
    setProfile(loadBusinessProfile(scope))
  }, [scope])

  const commit = (next: OfferingItem[]) => {
    setItems(next)
    saveOfferings(next, scope)
  }

  const businessCategory = profile?.primaryCategory?.trim() || ''
  const businessName = profile?.name?.trim() || ''

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = draft.title.trim()
    const content = draft.content.trim()
    if (!title) {
      setWarning('Başlık gerekli.')
      return
    }
    if (!content) {
      setWarning('İçerik gerekli.')
      return
    }

    setWarning('')
    setSavedNotice('')
    setSaving(true)

    try {
      const res = await fetch('/api/dynamic-tables/offerings/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          kind: draft.kind,
          title,
          content,
          businessName,
          businessCategory,
        }),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setWarning(data?.error || 'Kayıt doğrulanamadı. Lütfen tekrar deneyin.')
        return
      }

      if (data && data.approved === false) {
        setWarning(
          data.reason ||
            (businessCategory
              ? `Bu kayıt seçtiğiniz "${businessCategory}" sektörü için uygun görünmüyor.`
              : 'Bu kayıt işletme kataloğu için uygun görünmüyor.'),
        )
        return
      }

      const now = new Date().toISOString()
      if (editingId) {
        commit(items.map((it) => (it.id === editingId ? { ...it, kind: draft.kind, title, content, updatedAt: now } : it)))
        setSavedNotice('Kayıt güncellendi.')
      } else {
        commit([{ id: newId(), kind: draft.kind, title, content, updatedAt: now }, ...items])
        setSavedNotice('Kayıt eklendi.')
      }
      setDraft({ ...emptyDraft, kind: draft.kind })
      setEditingId(null)
    } catch {
      setWarning('Bağlantı hatası nedeniyle kayıt eklenemedi. Lütfen tekrar deneyin.')
    } finally {
      setSaving(false)
    }
  }

  const addSectorTemplate = async () => {
    if (templateBusy) return
    setTemplateBusy(true)
    setWarning('')
    setSavedNotice('')
    try {
      const prompt = businessCategory
        ? `${businessCategory} işletmesi için en temel 4 gerçekçi ürün ve hizmet şablonu oluştur.`
        : 'Genel bir işletme için en temel 4 gerçekçi ürün ve hizmet şablonu oluştur.'
      const res = await fetch('/api/dynamic-tables/offerings/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt,
          businessName,
          businessCategory,
          existingTitles: items.map((it) => it.title),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setWarning(data?.error || 'Sektöre uygun şablon eklenemedi. Lütfen tekrar deneyin.')
        return
      }
      const generated = Array.isArray(data?.items) ? data.items : []
      if (generated.length === 0) {
        setWarning('Sektörünüze uygun örnek şablon oluşturulamadı.')
        return
      }
      const now = new Date().toISOString()
      const created: OfferingItem[] = generated.map((g: { kind?: string; title: string; content: string }) => ({
        id: newId(),
        kind: g.kind === 'urun' ? 'urun' : 'hizmet',
        title: g.title,
        content: g.content,
        updatedAt: now,
      }))
      commit([...created, ...items])
      setSavedNotice(`${created.length} örnek şablon eklendi.`)
    } catch {
      setWarning('Bağlantı hatası nedeniyle şablon eklenemedi.')
    } finally {
      setTemplateBusy(false)
    }
  }

  const edit = (it: OfferingItem) => {
    setEditingId(it.id)
    setDraft({ kind: it.kind, title: it.title, content: it.content })
    setWarning('')
    setSavedNotice('')
  }

  const cancel = () => {
    setEditingId(null)
    setDraft({ ...emptyDraft, kind: draft.kind })
    setWarning('')
  }

  const remove = (id: string) => {
    commit(items.filter((it) => it.id !== id))
    if (editingId === id) cancel()
  }

  const duplicate = (it: OfferingItem) => {
    commit([{ id: newId(), kind: it.kind, title: `${it.title} (Kopya)`, content: it.content, updatedAt: new Date().toISOString() }, ...items])
  }

  const appendSnippet = (snippet: string) => {
    setDraft({ ...draft, content: draft.content.trim() ? `${draft.content.trimEnd()}\n${snippet}` : snippet })
    setWarning('')
  }

  const count = (k: OfferingKind) => items.filter((it) => it.kind === k).length
  const serviceCount = count('hizmet')
  const productCount = count('urun')

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR')
    return items.filter((it) => {
      if (filter !== 'all' && it.kind !== filter) return false
      if (!q) return true
      return it.title.toLocaleLowerCase('tr-TR').includes(q) || it.content.toLocaleLowerCase('tr-TR').includes(q)
    })
  }, [items, filter, search])

  return (
    <div className={clay.scope}>
      {/* Üst Güçlü Mavi Clay Hero Şeridi */}
      <div className={clay.hero}>
        <div className={clay.heroMain}>
          <div className={clay.heroLeft}>
            <span className={clay.heroBadgeIcon} aria-hidden="true">
              <Package size={20} strokeWidth={2.3} color="#ffffff" />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className={clay.heroTitleRow}>
                <h3 className={clay.heroName}>
                  {businessName ? `${businessName} — Ürün ve Hizmetler` : 'Ürün ve Hizmet Kataloğu'}
                </h3>
                {businessCategory && <span className={clay.heroPill}>{businessCategory}</span>}
                <span className={clay.heroPill}>{items.length} kayıt</span>
                <span className={clay.heroPill}>
                  {serviceCount} hizmet · {productCount} ürün
                </span>
                <InfoTooltip title="Ürün ve Hizmet Kataloğu" glyph="?">
                  Sunduğunuz ürün ve hizmetleri başlık ve içerikle tanımlayın. Eklenen kayıtlar işletmenizin seçili kategorisine göre katalogda düzenli biçimde saklanır.
                </InfoTooltip>
              </div>
              <div className={clay.heroMeta}>
                <span className={clay.heroMetaItem}>
                  <span>Sunduğunuz ürün ve hizmetleri başlık, süre, fiyat ve kapsam bilgileriyle tanımlayın.</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2 Sütunlu Çalışma Alanı */}
      <div className={local.splitGrid}>
        {/* Sol Sütun: Sabit Ürün/Hizmet Ekleme Formu */}
        <form className={`${clay.card} ${local.stickyForm}`} onSubmit={(e) => void submit(e)}>
          <div className={clay.cardHead}>
            <div className={clay.cardTitleGroup}>
              <span className={`${clay.iconChipSm} ${clay.chipBrand}`} aria-hidden="true">
                {editingId ? (
                  <Pencil size={15} strokeWidth={2.2} color="#ffffff" />
                ) : (
                  <Plus size={16} strokeWidth={2.3} color="#ffffff" />
                )}
              </span>
              <div className={clay.cardTitleRow}>
                <h3 className={clay.cardTitle}>{editingId ? 'Kaydı düzenle' : 'Yeni ürün veya hizmet'}</h3>
              </div>
            </div>

            <div className={clay.segmentTrack} role="radiogroup" aria-label="Kayıt türü">
              {(['hizmet', 'urun'] as OfferingKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={draft.kind === k}
                  className={draft.kind === k ? clay.segmentOn : clay.segment}
                  onClick={() => setDraft({ ...draft, kind: k })}
                >
                  {k === 'hizmet' ? (
                    <Wrench size={12} color={draft.kind === k ? '#ffffff' : undefined} />
                  ) : (
                    <Package size={12} color={draft.kind === k ? '#ffffff' : undefined} />
                  )}
                  <span>{k === 'hizmet' ? 'Hizmet' : 'Ürün'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={clay.field}>
            <label htmlFor="teklif-baslik" className={clay.fieldLabel}>
              Başlık
            </label>
            <div className={clay.fieldBox}>
              <input
                id="teklif-baslik"
                aria-label="Başlık"
                className={clay.fieldInput}
                value={draft.title}
                maxLength={120}
                placeholder={
                  draft.kind === 'hizmet'
                    ? 'Örn. Ön görüşme, Danışmanlık, Bakım hizmeti'
                    : 'Örn. Başlangıç paketi, Yedek parça'
                }
                onChange={(e) => {
                  setDraft({ ...draft, title: e.target.value })
                  setWarning('')
                  setSavedNotice('')
                }}
              />
            </div>
          </div>

          <div className={clay.field}>
            <label htmlFor="teklif-icerik" className={clay.fieldLabel}>
              İçerik ve kapsam
            </label>
            <div className={clay.fieldBox} style={{ alignItems: 'flex-start' }}>
              <textarea
                id="teklif-icerik"
                aria-label="İçerik"
                className={clay.fieldTextarea}
                value={draft.content}
                maxLength={2000}
                placeholder="İçerik (süre, fiyat, kapsam ve koşullar)"
                onChange={(e) => {
                  setDraft({ ...draft, content: e.target.value })
                  setWarning('')
                  setSavedNotice('')
                }}
              />
            </div>
          </div>

          <div className={clay.row} style={{ gap: 6 }}>
            {QUICK_SNIPPETS.map((sn) => (
              <button
                key={sn.label}
                type="button"
                className={clay.chipBtn}
                onClick={() => appendSnippet(sn.text)}
              >
                {sn.label}
              </button>
            ))}
          </div>

          <div className={clay.row} style={{ justifyContent: 'flex-end', gap: 8 }}>
            {editingId && (
              <button type="button" className={clay.ctlBtn} onClick={cancel}>
                Vazgeç
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className={clay.primaryBtn}
              style={{ flex: editingId ? undefined : 1 }}
            >
              {saving ? (
                <Loader2 size={14} color="#ffffff" className={local.spin} />
              ) : editingId ? (
                <Save size={14} color="#ffffff" />
              ) : (
                <Plus size={14} color="#ffffff" />
              )}
              <span>{saving ? (editingId ? 'Kaydediliyor…' : 'Ekleniyor…') : editingId ? 'Güncelle' : 'Ekle'}</span>
            </button>
          </div>

          {savedNotice && (
            <span className={clay.goodText} role="status">
              <CheckCircle2 size={14} />
              <span>{savedNotice}</span>
            </span>
          )}

          {warning && (
            <div className={clay.noticeWarn} role="alert">
              <div className={local.warnTitle}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                <span>{warning}</span>
              </div>
            </div>
          )}
        </form>

        {/* Sağ Sütun: Filtre + Arama + Katalog Kartları */}
        <div className={local.rightCol}>
          <div className={local.toolbar}>
            <div className={clay.segmentTrack} role="tablist" aria-label="Kayıt filtresi">
              {(
                [
                  ['all', `Tümü (${items.length})`],
                  ['hizmet', `Hizmetler (${serviceCount})`],
                  ['urun', `Ürünler (${productCount})`],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={filter === k}
                  className={filter === k ? clay.segmentOn : clay.segment}
                  onClick={() => setFilter(k)}
                >
                  <span>{l}</span>
                </button>
              ))}
            </div>

            <div className={`${clay.fieldBox} ${local.searchBox}`}>
              <Search size={14} className={local.wellIcon} aria-hidden="true" />
              <input
                className={clay.fieldInput}
                aria-label="Ürün ve hizmetlerde ara"
                placeholder="Katalogda ara…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className={clay.iconToolBtn}
                  style={{ width: 24, height: 24 }}
                  aria-label="Aramayı temizle"
                  onClick={() => setSearch('')}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <div className={clay.card}>
            <div className={clay.cardHead}>
              <div className={clay.cardTitleGroup}>
                <span className={`${clay.iconChipSm} ${clay.chipMint}`} aria-hidden="true">
                  <Package size={16} strokeWidth={2.2} color="#ffffff" />
                </span>
                <div className={clay.cardTitleRow}>
                  <h3 className={clay.cardTitle}>Kayıtlı ürün ve hizmetler</h3>
                </div>
              </div>
              <span className={clay.wellPill}>{visible.length} kayıt</span>
            </div>

            {visible.length === 0 ? (
              <div className={clay.emptyHero}>
                <span className={`${clay.iconChip} ${clay.chipMint}`} aria-hidden="true">
                  <Package size={18} strokeWidth={2.2} color="#ffffff" />
                </span>
                <span>
                  {items.length === 0
                    ? 'Henüz ürün veya hizmet eklenmedi. Soldaki formdan ekleyebilir veya sektörünüze uygun hazır şablonu yükleyebilirsiniz.'
                    : 'Eşleşen kayıt bulunamadı.'}
                </span>
                {items.length === 0 && (
                  <button
                    type="button"
                    className={clay.primaryBtn}
                    disabled={templateBusy}
                    onClick={() => void addSectorTemplate()}
                  >
                    {templateBusy ? (
                      <Loader2 size={14} color="#ffffff" className={local.spin} />
                    ) : (
                      <LayoutTemplate size={14} color="#ffffff" />
                    )}
                    <span>
                      {templateBusy
                        ? 'Şablon ekleniyor…'
                        : businessCategory
                          ? `${businessCategory} İçin Şablon Ekle`
                          : 'Sektöre Uygun Şablon Ekle'}
                    </span>
                  </button>
                )}
              </div>
            ) : (
              <div className={local.catalogGrid}>
                {visible.map((it) => {
                  const isService = it.kind === 'hizmet'
                  return (
                    <article key={it.id} className={editingId === it.id ? clay.subCardActive : clay.subCard}>
                      <div className={local.itemHead}>
                        <h4 className={local.itemTitle}>{it.title}</h4>
                        <span className={isService ? clay.pillBrand : clay.wellPill} style={{ flexShrink: 0 }}>
                          {isService ? <Wrench size={10} /> : <Package size={10} />}
                          {isService ? 'Hizmet' : 'Ürün'}
                        </span>
                      </div>
                      <div className={local.itemContent}>{it.content}</div>
                      <div className={local.itemFoot}>
                        <span className={clay.muted} style={{ fontSize: 11 }}>
                          {it.updatedAt ? new Date(it.updatedAt).toLocaleDateString('tr-TR') : ''}
                        </span>
                        <div className={clay.row} style={{ gap: 4 }}>
                          <button
                            type="button"
                            className={clay.iconToolBtn}
                            title="Kopyala"
                            aria-label={`${it.title} kopyala`}
                            onClick={() => duplicate(it)}
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            type="button"
                            className={clay.ctlBtnSm}
                            aria-label={`${it.title} düzenle`}
                            onClick={() => edit(it)}
                          >
                            <Pencil size={11} />
                            <span>Düzenle</span>
                          </button>
                          <button
                            type="button"
                            className={clay.iconToolBtnDanger}
                            title="Sil"
                            aria-label={`${it.title} sil`}
                            onClick={() => remove(it.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
