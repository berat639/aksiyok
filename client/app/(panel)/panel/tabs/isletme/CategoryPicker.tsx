'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { CATEGORY_GROUPS, foldTr, searchCategories, type CategoryGroup } from '@/lib/business-profile'
import s from './isletme.module.css'

/**
 * Google İşletme Profili tarzı tek kategori seçici:
 * Her işletme tek bir kategori seçer; odaklanınca popüler gruplar,
 * gruba girince alt kategoriler, yazınca tüm kategorilerde arama.
 */
export default function CategoryPicker({
  primary,
  onChange,
  invalid,
}: {
  primary: string
  onChange: (nextPrimary: string) => void
  invalid?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<CategoryGroup | null>(null)
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

  const exclude = useMemo(() => (primary ? [primary] : []), [primary])
  const results = useMemo(() => searchCategories(query, 10, exclude), [query, exclude])
  const groupItems = useMemo(
    () => (group ? group.items.filter((item) => !primary || foldTr(primary) !== foldTr(item)) : []),
    [group, primary],
  )

  const pick = (label: string) => {
    onChange(label)
    setQuery('')
    setGroup(null)
    setOpen(false)
    setActive(0)
  }

  const clearPrimary = () => {
    onChange('')
    setQuery('')
    setGroup(null)
    setActive(0)
  }

  const list: string[] = query.trim() ? results.map((r) => r.label) : group ? groupItems : []
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setGroup(null)
      return
    }
    if (!list.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(list.length - 1, i + 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = list[active]
      if (item) pick(item)
    }
  }

  return (
    <div className={s.field} ref={wrapRef}>
      <label className={s.fieldLabel} htmlFor={id}>
        İşletme kategorisi*
      </label>
      <div className={`${s.fieldBox} ${open ? s.fieldBoxActive : ''} ${invalid && !primary ? s.fieldBoxInvalid : ''}`}>
        <Search size={16} color="var(--foreground-3)" />
        <input
          id={id}
          ref={inputRef}
          className={s.fieldInput}
          placeholder={primary ? 'Kategoriyi değiştirmek için arayın…' : 'İşletme kategorisi seçin'}
          value={query}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setGroup(null)
            setOpen(true)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button
            type="button"
            className={s.iconBtn}
            aria-label="Aramayı temizle"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            <X size={15} />
          </button>
        )}
      </div>
      <p className={s.helper}>İşletmeniz için tek bir kategori seçilir; dilediğiniz zaman değiştirebilirsiniz.</p>
      {invalid && !primary && <p className={s.error}>{invalid}</p>}

      {open && (
        <div className={s.dropdown} id={`${id}-list`} role="listbox" aria-label="Kategori önerileri">
          {query.trim() ? (
            results.length ? (
              results.map((r, i) => (
                <button
                  key={r.label}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`${s.dropdownItem} ${i === active ? s.dropdownItemActive : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(r.label)}
                >
                  <span>
                    {r.label}
                    <small>{r.group}</small>
                  </span>
                </button>
              ))
            ) : (
              <div className={s.dropdownEmpty}>
                “{query}” için kategori bulunamadı. Daha genel bir ifade deneyin (ör. “Klinik”, “Mağaza”).
              </div>
            )
          ) : group ? (
            <>
              <div className={s.dropdownHeading}>
                <button
                  type="button"
                  className={s.iconBtn}
                  aria-label="Popüler kategorilere dön"
                  onClick={() => {
                    setGroup(null)
                    setActive(0)
                  }}
                >
                  <ChevronLeft size={16} />
                </button>
                {group.label}
              </div>
              {groupItems.map((item, i) => (
                <button
                  key={item}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`${s.dropdownItem} ${i === active ? s.dropdownItemActive : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(item)}
                >
                  {item}
                </button>
              ))}
            </>
          ) : (
            <>
              <div className={s.dropdownHeading}>Popüler kategorileri keşfedin</div>
              {CATEGORY_GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={s.dropdownItem}
                  onClick={() => {
                    setGroup(g)
                    setActive(0)
                  }}
                >
                  {g.label}
                  <ChevronRight size={20} color="var(--foreground-2)" />
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {primary && (
        <div className={s.chips} aria-label="Seçili kategori">
          <span className={s.catChipPrimary} title="Seçili işletme kategorisi">
            {primary}
            <button type="button" aria-label={`${primary} kategorisini kaldır`} onClick={clearPrimary}>
              <X size={13} color="#ffffff" />
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
