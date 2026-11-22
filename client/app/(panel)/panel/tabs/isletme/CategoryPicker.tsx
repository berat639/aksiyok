'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react'
import { CATEGORY_GROUPS, foldTr, searchCategories, type CategoryGroup } from '@/lib/business-profile'
import s from './isletme.module.css'

const MAX_EXTRA = 9

/**
 * Google İşletme Profili'ndeki kategori alanı gibi çalışır: odaklanınca popüler gruplar,
 * gruba girince alt kategoriler, yazınca tüm kategorilerde arama.
 */
export default function CategoryPicker({
  primary,
  extras,
  onChange,
  invalid,
}: {
  primary: string
  extras: string[]
  onChange: (next: { primary: string; extras: string[] }) => void
  invalid?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<CategoryGroup | null>(null)
  const [mode, setMode] = useState<'primary' | 'extra'>(primary ? 'extra' : 'primary')
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setGroup(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const taken = useMemo(() => [primary, ...extras].filter(Boolean), [primary, extras])
  const results = useMemo(() => searchCategories(query, 10, taken), [query, taken])
  const groupItems = useMemo(
    () => (group ? group.items.filter((item) => !taken.some((t) => foldTr(t) === foldTr(item))) : []),
    [group, taken],
  )

  const pick = (label: string) => {
    if (mode === 'primary' || !primary) onChange({ primary: label, extras: extras.filter((e) => e !== label) })
    else if (extras.length < MAX_EXTRA) onChange({ primary, extras: [...extras, label] })
    setQuery('')
    setGroup(null)
    setOpen(false)
    setMode('extra')
    setActive(0)
  }

  const makePrimary = (label: string) => onChange({ primary: label, extras: [primary, ...extras.filter((e) => e !== label)].filter(Boolean) })
  const removeExtra = (label: string) => onChange({ primary, extras: extras.filter((e) => e !== label) })
  const clearPrimary = () => {
    const [nextPrimary = '', ...rest] = extras
    onChange({ primary: nextPrimary, extras: rest })
    setMode(nextPrimary ? 'extra' : 'primary')
  }

  const list: string[] = query.trim() ? results.map((r) => r.label) : group ? groupItems : []
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); setGroup(null); return }
    if (!list.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(list.length - 1, i + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    if (e.key === 'Enter') { e.preventDefault(); const item = list[active]; if (item) pick(item) }
  }

  const label = mode === 'primary' || !primary ? 'İşletme kategorisi*' : 'Ek kategori'
  const canAddMore = !primary || extras.length < MAX_EXTRA

  return (
    <div className={s.field} ref={wrapRef}>
      {(canAddMore || mode === 'primary') && (
        <div className={`${s.fieldBox} ${open ? s.fieldBoxActive : ''} ${invalid && !primary ? s.fieldBoxInvalid : ''}`}>
          <label className={s.fieldLabel} htmlFor={id}>{label}</label>
          <Search size={16} color="var(--foreground-3)" />
          <input
            id={id}
            ref={inputRef}
            className={s.fieldInput}
            placeholder={mode === 'primary' || !primary ? 'İşletme kategorisi' : 'Ek kategori ekleyin (isteğe bağlı)'}
            value={query}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            autoComplete="off"
            onFocus={() => setOpen(true)}
            onChange={(e) => { setQuery(e.target.value); setGroup(null); setOpen(true); setActive(0) }}
            onKeyDown={onKeyDown}
          />
          {query && (
            <button type="button" className={s.iconBtn} aria-label="Aramayı temizle" onClick={() => { setQuery(''); inputRef.current?.focus() }}>
              <X size={15} />
            </button>
          )}
        </div>
      )}
      <p className={s.helper}>Daha sonra değiştirebilir ve daha fazla ekleyebilirsiniz</p>
      {invalid && !primary && <p className={s.error}>{invalid}</p>}

      {open && (
        <div className={s.dropdown} id={`${id}-list`} role="listbox" aria-label="Kategori önerileri">
          {query.trim() ? (
            results.length ? (
              results.map((r, i) => (
                <button key={r.label} type="button" role="option" aria-selected={i === active} className={`${s.dropdownItem} ${i === active ? s.dropdownItemActive : ''}`} onMouseEnter={() => setActive(i)} onClick={() => pick(r.label)}>
                  <span>{r.label}<small>{r.group}</small></span>
                </button>
              ))
            ) : (
              <div className={s.dropdownEmpty}>“{query}” için kategori bulunamadı. Daha genel bir ifade deneyin (ör. “Klinik”, “Mağaza”).</div>
            )
          ) : group ? (
            <>
              <div className={s.dropdownHeading}>
                <button type="button" className={s.iconBtn} aria-label="Popüler kategorilere dön" onClick={() => { setGroup(null); setActive(0) }}>
                  <ChevronLeft size={16} />
                </button>
                {group.label}
              </div>
              {groupItems.map((item, i) => (
                <button key={item} type="button" role="option" aria-selected={i === active} className={`${s.dropdownItem} ${i === active ? s.dropdownItemActive : ''}`} onMouseEnter={() => setActive(i)} onClick={() => pick(item)}>
                  {item}
                </button>
              ))}
            </>
          ) : (
            <>
              <div className={s.dropdownHeading}>Popüler kategorileri keşfedin</div>
              {CATEGORY_GROUPS.map((g) => (
                <button key={g.id} type="button" className={s.dropdownItem} onClick={() => { setGroup(g); setActive(0) }}>
                  {g.label}
                  <ChevronRight size={20} color="var(--foreground-2)" />
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {(primary || extras.length > 0) && (
        <div className={s.chips} aria-label="Seçili kategoriler">
          {primary && (
            <span className={s.catChipPrimary} title="Birincil kategori">
              {primary} · Birincil
              <button type="button" aria-label={`${primary} kategorisini kaldır`} onClick={clearPrimary}><X size={13} /></button>
            </span>
          )}
          {extras.map((e) => (
            <span key={e} className={s.catChip}>
              <button type="button" style={{ fontWeight: 700 }} title="Birincil yap" onClick={() => makePrimary(e)}>{e}</button>
              <button type="button" aria-label={`${e} kategorisini kaldır`} onClick={() => removeExtra(e)}><X size={13} /></button>
            </span>
          ))}
          {primary && canAddMore && mode !== 'extra' && (
            <button type="button" className={s.catChip} onClick={() => { setMode('extra'); inputRef.current?.focus() }}>
              <Plus size={13} /> Kategori ekle
            </button>
          )}
        </div>
      )}
    </div>
  )
}
