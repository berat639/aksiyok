'use client'

import { useEffect, useMemo, useState } from 'react'
import { Copy, Package, Pencil, Plus, Save, Search, Trash2, Wrench, X } from 'lucide-react'
import { loadOfferings, saveOfferings, type OfferingItem, type OfferingKind } from '@/lib/business-profile'
import depth from '@/styles/clinic-depth.module.css'
import s from './isletme.module.css'

type Draft = { kind: OfferingKind; title: string; content: string }
const emptyDraft: Draft = { kind: 'hizmet', title: '', content: '' }
const newId = () => `of-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const QUICK_SNIPPETS: { label: string; text: string }[] = [
  { label: '+ Süre & fiyat', text: 'Süre: 45 dakika · Ücret: 750 ₺' },
  { label: '+ Kapsam', text: 'Dahil olanlar: Ön görüşme ve uygulama' },
]

const STARTER_PRESETS: { kind: OfferingKind; title: string; content: string }[] = [
  { kind: 'hizmet', title: 'Ön Görüşme & Danışmanlık', content: 'Süre: 30 dakika · İlk görüşme ücretsiz.' },
  { kind: 'hizmet', title: 'Standart Hizmet Paketi', content: 'Süre: 60 dakika · Uygulama + kontrol randevusu.' },
  { kind: 'urun', title: 'Bakım & Destek Ürünü', content: 'İşletmeden teslim veya aynı gün kargo.' },
]

export default function UrunHizmetSection({ scope }: { scope: string | null }) {
  const [items, setItems] = useState<OfferingItem[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | OfferingKind>('all')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { setItems(loadOfferings(scope)) }, [scope])

  const commit = (next: OfferingItem[]) => { setItems(next); saveOfferings(next, scope) }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const title = draft.title.trim()
    const content = draft.content.trim()
    if (!title) { setError('Başlık gerekli.'); return }
    if (!content) { setError('İçerik gerekli.'); return }
    const now = new Date().toISOString()
    if (editingId) commit(items.map((it) => (it.id === editingId ? { ...it, kind: draft.kind, title, content, updatedAt: now } : it)))
    else commit([{ id: newId(), kind: draft.kind, title, content, updatedAt: now }, ...items])
    setDraft({ ...emptyDraft, kind: draft.kind })
    setEditingId(null)
    setError('')
  }

  const edit = (it: OfferingItem) => { setEditingId(it.id); setDraft({ kind: it.kind, title: it.title, content: it.content }); setError('') }
  const cancel = () => { setEditingId(null); setDraft({ ...emptyDraft, kind: draft.kind }); setError('') }
  const remove = (id: string) => { commit(items.filter((it) => it.id !== id)); if (editingId === id) cancel() }
  const duplicate = (it: OfferingItem) => {
    commit([{ id: newId(), kind: it.kind, title: `${it.title} (Kopya)`, content: it.content, updatedAt: new Date().toISOString() }, ...items])
  }
  const applyPreset = (preset: { kind: OfferingKind; title: string; content: string }) => {
    setEditingId(null)
    setDraft({ ...preset })
    setError('')
  }
  const appendSnippet = (snippet: string) => {
    setDraft({ ...draft, content: draft.content.trim() ? `${draft.content.trimEnd()}\n${snippet}` : snippet })
    setError('')
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
    <div className={s.stack}>
      <div className={s.topBar}>
        <div className={depth.segmentTrack} role="tablist" aria-label="Kayıt filtresi">
          {([['all', `Tümü (${items.length})`], ['hizmet', `Hizmetler (${serviceCount})`], ['urun', `Ürünler (${productCount})`]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? depth.segmentActive : depth.segment} onClick={() => setFilter(k)}>
              <span style={filter === k ? { color: '#ffffff' } : undefined}>{l}</span>
            </button>
          ))}
        </div>

        <div className={s.searchInline}>
          <Search size={13} color="var(--foreground-3)" />
          <input aria-label="Ürün ve hizmetlerde ara" placeholder="Katalogda ara…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button type="button" className={s.iconBtn} style={{ width: 22, height: 22 }} aria-label="Aramayı temizle" onClick={() => setSearch('')}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <form className={s.panelCard} onSubmit={submit}>
        <div className={s.topBar}>
          <h3 className={s.sectionTitle}>{editingId ? 'Kaydı düzenle' : 'Yeni ürün veya hizmet'}</h3>
          <div className={depth.segmentTrack} role="radiogroup" aria-label="Kayıt türü">
            {(['hizmet', 'urun'] as OfferingKind[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={draft.kind === k} className={draft.kind === k ? depth.segmentActive : depth.segment} onClick={() => setDraft({ ...draft, kind: k })}>
                <span style={draft.kind === k ? { color: '#ffffff' } : undefined}>{k === 'hizmet' ? 'Hizmet' : 'Ürün'}</span>
              </button>
            ))}
          </div>
        </div>

        <input
          id="teklif-baslik"
          aria-label="Başlık"
          className={s.compactInput}
          value={draft.title}
          maxLength={120}
          placeholder={draft.kind === 'hizmet' ? 'Başlık (ör. Saç kesimi, İlk muayene)' : 'Başlık (ör. Bakım kremi, Lastik 205/55 R16)'}
          onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setError('') }}
        />

        <textarea
          id="teklif-icerik"
          aria-label="İçerik"
          className={s.compactTextarea}
          value={draft.content}
          maxLength={2000}
          placeholder="İçerik (süre, fiyat, kapsam ve koşullar)"
          onChange={(e) => { setDraft({ ...draft, content: e.target.value }); setError('') }}
        />

        <div className={s.topBar}>
          <div className={s.row} style={{ gap: 5 }}>
            {QUICK_SNIPPETS.map((sn) => (
              <button key={sn.label} type="button" className={s.snippetChip} onClick={() => appendSnippet(sn.text)}>
                {sn.label}
              </button>
            ))}
          </div>
          <div className={s.row} style={{ gap: 6 }}>
            {editingId && (
              <button type="button" className={depth.btn} style={{ minHeight: 30, padding: '4px 10px' }} onClick={cancel}>
                Vazgeç
              </button>
            )}
            <button type="submit" className={depth.btnPrimary} style={{ minHeight: 30, padding: '4px 12px' }}>
              {editingId ? <Save size={13} color="#ffffff" /> : <Plus size={13} color="#ffffff" />}
              <span style={{ color: '#ffffff' }}>{editingId ? 'Güncelle' : 'Ekle'}</span>
            </button>
          </div>
        </div>
        {error && <p className={s.error} style={{ margin: 0 }} role="alert">{error}</p>}
      </form>

      <div className={s.panelCard}>
        <div className={s.topBar}>
          <h3 className={s.sectionTitle}>Kayıtlı ürün ve hizmetler</h3>
          <span className={s.muted}>{visible.length} kayıt</span>
        </div>

        {visible.length === 0 ? (
          <div className={s.emptyState}>
            <Package size={18} />
            <span>{items.length === 0 ? 'Henüz ürün veya hizmet eklenmedi. Yukarıdan ekleyin veya hazır örnek seçin:' : 'Eşleşen kayıt bulunamadı.'}</span>
            {items.length === 0 && (
              <div className={s.row} style={{ justifyContent: 'center', gap: 6 }}>
                {STARTER_PRESETS.map((p) => (
                  <button key={p.title} type="button" className={s.snippetChip} onClick={() => applyPreset(p)}>
                    <Plus size={11} /> {p.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className={s.compactList}>
            {visible.map((it) => {
              const isService = it.kind === 'hizmet'
              return (
                <div key={it.id} className={s.compactRow}>
                  <div className={s.compactMain} style={{ alignItems: 'flex-start' }}>
                    <span className={depth.badge} style={{ marginTop: 2, flexShrink: 0 }}>
                      {isService ? <Wrench size={11} /> : <Package size={11} />}
                      {isService ? 'Hizmet' : 'Ürün'}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h4 className={s.staffName} style={{ margin: 0 }}>{it.title}</h4>
                      <div className={s.offerContent}>{it.content}</div>
                    </div>
                    <div className={s.compactActions}>
                      <button type="button" className={s.iconBtn} title="Kopyala" aria-label={`${it.title} kopyala`} onClick={() => duplicate(it)}>
                        <Copy size={13} />
                      </button>
                      <button type="button" className={depth.btn} style={{ minHeight: 28, padding: '3px 9px', fontSize: '11.5px' }} aria-label={`${it.title} düzenle`} onClick={() => edit(it)}>
                        <Pencil size={12} /> Düzenle
                      </button>
                      <button type="button" className={s.iconBtn} title="Sil" aria-label={`${it.title} sil`} style={{ color: 'var(--danger)' }} onClick={() => remove(it.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
