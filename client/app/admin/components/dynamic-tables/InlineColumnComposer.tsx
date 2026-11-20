'use client'

import React, { useEffect, useState } from 'react'
import { Check, Columns3, Eye, Link2, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import type { HumanRelationChoice } from './InlineTableConnectionsBar'
import {
  NON_RELATION_FIELD_TYPES,
  type DynamicColumnDef,
  type DynamicFieldType,
  type DynamicTableDef,
  type SelectOptionItem,
} from './types'

const HUMAN_FIELD_LABELS: Record<DynamicFieldType, string> = {
  text: 'Yazı (Metin)',
  phone: 'Telefon',
  currency: 'Para Tutarı (₺)',
  date: 'Tarih',
  select: 'Tekli Seçenek',
  multiselect: 'Çoklu Seçenek',
  boolean: 'Evet / Hayır',
  number: 'Sayı',
  email: 'E-posta',
  relation: 'Başka Tablodan Seçim',
}

const ORDERED_COMPOSER_TYPES: DynamicFieldType[] = [
  'text',
  'phone',
  'currency',
  'date',
  'select',
  'multiselect',
  'boolean',
  'number',
  'email',
  'relation',
]

interface InlineColumnComposerProps {
  table: DynamicTableDef
  allTables: DynamicTableDef[]
  editingColumn: DynamicColumnDef | null
  initialFieldType?: DynamicFieldType
  onClose: () => void
  onSaved: () => void
}

export default function InlineColumnComposer({
  table,
  allTables,
  editingColumn,
  initialFieldType = 'text',
  onClose,
  onSaved,
}: InlineColumnComposerProps) {
  const otherTables = allTables.filter((t) => t.id !== table.id)

  const [name, setName] = useState('')
  const [fieldType, setFieldType] = useState<DynamicFieldType>(initialFieldType)
  const [isPrimaryTitle, setIsPrimaryTitle] = useState(false)
  const [isRequired, setIsRequired] = useState(false)
  const [isUnique, setIsUnique] = useState(false)
  const [showInTable, setShowInTable] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [options, setOptions] = useState<SelectOptionItem[]>([
    { id: 'secenek_1', label: 'Aktif' },
    { id: 'secenek_2', label: 'Beklemede' },
  ])
  const [newOptionLabel, setNewOptionLabel] = useState('')

  // When fieldType === 'relation'
  const [targetTableId, setTargetTableId] = useState<string>(otherTables[0]?.id || '__new__')
  const [newTargetTableName, setNewTargetTableName] = useState('')
  const [relationChoice, setRelationChoice] = useState<HumanRelationChoice>('both_many')

  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setConfirmDelete(false)
    setShowAdvanced(false)
    if (editingColumn) {
      setName(editingColumn.name)
      setFieldType(editingColumn.fieldType)
      setIsPrimaryTitle(editingColumn.isPrimaryTitle)
      setIsRequired(editingColumn.isRequired)
      setIsUnique(editingColumn.isUnique)
      setShowInTable(editingColumn.showInTable)
      setOptions(
        Array.isArray(editingColumn.config?.options) && editingColumn.config.options.length > 0
          ? editingColumn.config.options.map((o) => ({ id: o.id, label: o.label }))
          : [{ id: 'secenek_1', label: 'Seçenek 1' }]
      )
    } else {
      setName('')
      setFieldType(initialFieldType)
      setIsPrimaryTitle(table.columns.length === 0)
      setIsRequired(table.columns.length === 0)
      setIsUnique(false)
      setShowInTable(true)
      setOptions([
        { id: 'aktif', label: 'Aktif' },
        { id: 'beklemede', label: 'Beklemede' },
      ])
      setTargetTableId(otherTables[0]?.id || '__new__')
      setNewTargetTableName('')
      setRelationChoice('both_many')
    }
    setNewOptionLabel('')
  }, [editingColumn, initialFieldType, table.id, table.columns.length])

  const isEditingRelationCol = editingColumn?.fieldType === 'relation'

  const previewOtherName =
    targetTableId === '__new__'
      ? newTargetTableName.trim() || name.trim() || 'Malzemeler'
      : otherTables.find((t) => t.id === targetTableId)?.name || 'Malzemeler'

  const addOption = () => {
    const clean = newOptionLabel.trim()
    if (!clean) return
    const slug =
      clean
        .toLocaleLowerCase('tr-TR')
        .replace(/[^a-z0-9ğüşıöç]+/g, '_')
        .replace(/^_+|_+$/g, '') || `opt_${Date.now()}`
    setOptions((prev) => [...prev, { id: `${slug}_${prev.length + 1}`, label: clean }])
    setNewOptionLabel('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!editingColumn && fieldType === 'relation') {
      setSaving(true)
      try {
        let resolvedOtherId = targetTableId
        let resolvedOtherName =
          otherTables.find((t) => t.id === targetTableId)?.name || 'Bağlı Tablo'

        if (targetTableId === '__new__') {
          const cleanNewTbl = newTargetTableName.trim() || name.trim()
          if (!cleanNewTbl) {
            toast.error('Bağlanacak tablonun adını yazınız')
            return
          }
          const createRes = await fetch('/api/dynamic-tables/tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: cleanNewTbl,
              initialColumns: [
                { name: 'Ad / Başlık', fieldType: 'text', isPrimaryTitle: true, isRequired: true },
              ],
            }),
          })
          const created = await createRes.json()
          if (!createRes.ok) {
            toast.error(created.error || 'Tablo oluşturulamadı')
            return
          }
          resolvedOtherId = created.id
          resolvedOtherName = created.name
        }

        const sourceTableId =
          relationChoice === 'other_has_many_active' ? resolvedOtherId : table.id
        const targetId =
          relationChoice === 'other_has_many_active' ? table.id : resolvedOtherId
        const cardinality =
          relationChoice === 'both_many'
            ? 'many_to_many'
            : relationChoice === 'single_pair'
              ? 'one_to_one'
              : 'one_to_many'

        const customColName = name.trim() || undefined
        const res = await fetch('/api/dynamic-tables/relations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceTableId,
            targetTableId: targetId,
            sourceColumnName: sourceTableId === table.id ? customColName : undefined,
            inverseColumnName: targetId === table.id ? customColName : undefined,
            cardinality,
            createInverseColumn: true,
            onDelete: 'set_null',
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          toast.error(data.error || 'Tablo bağlantısı kurulamadı')
          return
        }
        toast.success(`"${resolvedOtherName}" tablosu bağlandı`)
        onSaved()
        onClose()
      } catch {
        toast.error('Bağlantı kurulamadı')
      } finally {
        setSaving(false)
      }
      return
    }

    if (!name.trim()) {
      toast.error('Alan adı zorunludur')
      return
    }
    setSaving(true)
    try {
      const url = editingColumn
        ? `/api/dynamic-tables/columns/${editingColumn.id}`
        : `/api/dynamic-tables/tables/${table.id}/columns`
      const method = editingColumn ? 'PUT' : 'POST'
      const config =
        fieldType === 'select' || fieldType === 'multiselect'
          ? {
              ...(editingColumn?.config || {}),
              options: options.map((o) => ({ id: o.id, label: o.label.trim() || o.id })),
            }
          : editingColumn?.config || {}

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          fieldType,
          isPrimaryTitle,
          isRequired: isPrimaryTitle ? true : isRequired,
          isUnique,
          showInTable,
          config,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Alan kaydedilemedi')
        return
      }
      toast.success(editingColumn ? 'Alan güncellendi' : 'Yeni alan eklendi')
      onSaved()
      onClose()
    } catch {
      toast.error('Alan kaydedilemedi')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editingColumn) return
    setSaving(true)
    try {
      const res = await fetch(`/api/dynamic-tables/columns/${editingColumn.id}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Alan silinemedi')
        return
      }
      toast.success(isEditingRelationCol ? 'Tablo bağlantısı kaldırıldı' : 'Alan silindi')
      onSaved()
      onClose()
    } catch {
      toast.error('Alan silinirken hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  // Render live sample cell content based on selected fieldType
  const renderPreviewCellValue = () => {
    switch (fieldType) {
      case 'phone':
        return <span style={{ fontWeight: 600 }}>0532 123 45 67</span>
      case 'currency':
        return <span style={{ fontWeight: 700, color: 'var(--pc-tint-fg)' }}>2.500 ₺</span>
      case 'date':
        return <span>15 May 2026</span>
      case 'number':
        return <span style={{ fontWeight: 600 }}>3</span>
      case 'email':
        return <span>ayse@ornek.com</span>
      case 'boolean':
        return (
          <span className={depth.badge} style={{ fontSize: 10.5, padding: '1px 7px' }}>
            ✓ Evet
          </span>
        )
      case 'select':
        return (
          <span className={depth.badge} style={{ fontSize: 10.5, padding: '1px 7px' }}>
            {options[0]?.label || 'Seçenek 1'}
          </span>
        )
      case 'multiselect':
        return (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            <span className={depth.badge} style={{ fontSize: 10.5, padding: '1px 6px' }}>
              {options[0]?.label || 'Seçenek 1'}
            </span>
            <span className={depth.badge} style={{ fontSize: 10.5, padding: '1px 6px' }}>
              {options[1]?.label || 'Seçenek 2'}
            </span>
          </span>
        )
      case 'relation': {
        const multi = relationChoice === 'both_many' || relationChoice === 'active_has_many_other'
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span className={depth.badge} style={{ fontSize: 10.5, padding: '1px 6px' }}>
              {previewOtherName} #1
            </span>
            {multi && (
              <span className={depth.badge} style={{ fontSize: 10.5, padding: '1px 6px' }}>
                {previewOtherName} #2
              </span>
            )}
          </span>
        )
      }
      default:
        return <span>Örnek metin değeri</span>
    }
  }

  const previewHeaderLabel =
    fieldType === 'relation' && !editingColumn
      ? name.trim() || previewOtherName
      : name.trim() || HUMAN_FIELD_LABELS[fieldType]

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        padding: '12px 16px',
        borderBottom: '1.5px solid var(--pc-border)',
        background: 'var(--card-inner)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <Columns3 size={14} style={{ color: 'var(--pc-blue)' }} />
          <strong style={{ fontSize: 13 }}>
            {editingColumn
              ? `"${editingColumn.name}" Alanını Düzenle`
              : `${table.name} — Yeni Alan (Sütun) Ekle`}
          </strong>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {editingColumn && !confirmDelete && (
            <button
              type="button"
              disabled={saving}
              onClick={() => setConfirmDelete(true)}
              className={depth.btn}
              style={{ minHeight: 27, padding: '2px 9px', fontSize: 11.5, color: 'var(--danger)' }}
            >
              <Trash2 size={12} />
              <span>{isEditingRelationCol ? 'Bağlantıyı Kaldır' : 'Alanı Sil'}</span>
            </button>
          )}
          {editingColumn && confirmDelete && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--danger)' }}>Emin misiniz?</span>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleDelete()}
                className={depth.btn}
                style={{ minHeight: 26, padding: '2px 8px', fontSize: 11.5, color: 'var(--danger)', borderColor: 'var(--danger)' }}
              >
                Evet, Sil
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className={depth.btn}
                style={{ minHeight: 26, padding: '2px 8px', fontSize: 11.5 }}
              >
                Vazgeç
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className={depth.btn}
            style={{ minHeight: 27, padding: '2px 8px', fontSize: 11.5 }}
          >
            <X size={13} />
            <span>Kapat</span>
          </button>

          <button
            type="submit"
            disabled={saving}
            className={depth.btnPrimary}
            style={{ minHeight: 27, padding: '2px 12px', fontSize: 11.5 }}
          >
            <Check size={13} color="#ffffff" />
            <span>{saving ? 'Kaydediliyor…' : editingColumn ? 'Güncelle' : 'Ekle'}</span>
          </button>
        </div>
      </div>

      {/* Quick Type Pills */}
      {!isEditingRelationCol && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--pc-muted)' }}>Tür:</span>
          {(editingColumn ? NON_RELATION_FIELD_TYPES : ORDERED_COMPOSER_TYPES).map((ft) => {
            const selected = fieldType === ft
            const isRel = ft === 'relation'
            return (
              <button
                key={ft}
                type="button"
                onClick={() => setFieldType(ft)}
                className={selected ? depth.btnPrimary : isRel ? depth.btnPale : depth.btn}
                style={{ minHeight: 27, padding: '2px 10px', fontSize: 11.5 }}
              >
                {isRel && <Link2 size={12} color={selected ? '#ffffff' : undefined} />}
                <span>{HUMAN_FIELD_LABELS[ft]}</span>
              </button>
            )
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 10, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
            }}
            placeholder={
              fieldType === 'relation' && !editingColumn
                ? 'Sütun başlığı (boş bırakırsanız bağlı tablonun adı kullanılır)…'
                : 'Alan adı (Örn: Ad Soyad, Telefon, Ücret, Not)…'
            }
            className={depth.input}
            style={{ flex: '1 1 210px', minHeight: 32, fontSize: 12.5 }}
            autoFocus
          />

          {fieldType !== 'relation' && !isEditingRelationCol && (
            <>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isPrimaryTitle || isRequired}
                  disabled={isPrimaryTitle}
                  onClick={() => setIsRequired((v) => !v)}
                  className={depth.switch}
                />
                <span>Zorunlu</span>
              </label>

              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className={showAdvanced ? depth.btnPale : depth.btn}
                style={{ minHeight: 30, padding: '3px 9px', fontSize: 11.5 }}
              >
                <SlidersHorizontal size={12} />
                <span>Diğer Ayarlar</span>
              </button>
            </>
          )}
        </div>

        {/* Live Cell Preview Strip */}
        <div
          className={depth.subcard}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '6px 11px',
            background: 'var(--card-bg)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--pc-tint-fg)' }}>
            <Eye size={13} />
            <span>Hücre Önizlemesi:</span>
          </span>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ fontWeight: 700, color: 'var(--foreground-2)' }}>
              {previewHeaderLabel}
              {isRequired || isPrimaryTitle ? ' *' : ''}:
            </span>
            {renderPreviewCellValue()}
          </div>
        </div>
      </div>

      {/* Relation Picker when "Başka Tablodan Seçim" is selected */}
      {!editingColumn && fieldType === 'relation' && (
        <div
          className={depth.subcard}
          style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: 'var(--card-bg)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Hangi tabloyla bağlansın?</span>
            {otherTables.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTargetTableId(t.id)}
                className={targetTableId === t.id ? depth.btnPrimary : depth.btn}
                style={{ minHeight: 27, padding: '2px 10px', fontSize: 12 }}
              >
                {t.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTargetTableId('__new__')}
              className={targetTableId === '__new__' ? depth.btnPrimary : depth.btnPale}
              style={{ minHeight: 27, padding: '2px 10px', fontSize: 12 }}
            >
              <Plus size={12} color={targetTableId === '__new__' ? '#ffffff' : undefined} />
              <span>Yeni Tablo Oluşturup Bağla</span>
            </button>
            {targetTableId === '__new__' && (
              <input
                type="text"
                value={newTargetTableName}
                onChange={(e) => setNewTargetTableName(e.target.value)}
                placeholder="Yeni tablo adı (Örn: Malzemeler)…"
                className={depth.input}
                style={{ width: 220, minHeight: 29, fontSize: 12 }}
              />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 6 }}>
            {[
              {
                key: 'both_many' as const,
                label: `Çoklu ⇄ Çoklu (İki tarafta da çoklu seçim)`,
              },
              {
                key: 'active_has_many_other' as const,
                label: `1 "${table.name}" ➔ Çok "${previewOtherName}"`,
              },
              {
                key: 'other_has_many_active' as const,
                label: `1 "${previewOtherName}" ➔ Çok "${table.name}"`,
              },
              {
                key: 'single_pair' as const,
                label: `1 ⇄ 1 (Bire bir tek kayıt)`,
              },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setRelationChoice(opt.key)}
                className={relationChoice === opt.key ? depth.btnPale : depth.btn}
                style={{
                  minHeight: 31,
                  padding: '4px 9px',
                  fontSize: 11.5,
                  textAlign: 'left',
                  justifyContent: 'flex-start',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Advanced Options */}
      {showAdvanced && fieldType !== 'relation' && (
        <div
          className={depth.subcard}
          style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '7px 12px', background: 'var(--card-bg)' }}
        >
          {!isEditingRelationCol && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <button
                type="button"
                role="switch"
                aria-checked={isPrimaryTitle}
                onClick={() => setIsPrimaryTitle((v) => !v)}
                className={depth.switch}
              />
              <span>Kaydın görünen ana adı bu alan olsun</span>
            </label>
          )}

          {!isEditingRelationCol && fieldType !== 'boolean' && fieldType !== 'multiselect' && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <button
                type="button"
                role="switch"
                aria-checked={isUnique}
                onClick={() => setIsUnique((v) => !v)}
                className={depth.switch}
              />
              <span>Aynı değer iki kez girilemesin</span>
            </label>
          )}

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            <button
              type="button"
              role="switch"
              aria-checked={showInTable}
              onClick={() => setShowInTable((v) => !v)}
              className={depth.switch}
            />
            <span>Tabloda görünür olsun</span>
          </label>
        </div>
      )}

      {(fieldType === 'select' || fieldType === 'multiselect') && (
        <div
          className={depth.subcard}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '7px 10px', background: 'var(--card-bg)' }}
        >
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--pc-muted)' }}>Seçenekler:</span>
          {options.map((opt, idx) => (
            <span
              key={opt.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 999,
                border: '1px solid var(--pc-border)',
                background: 'var(--pc-surface)',
                fontSize: 12,
              }}
            >
              <input
                type="text"
                value={opt.label}
                onChange={(e) => {
                  const next = [...options]
                  next[idx] = { ...opt, label: e.target.value }
                  setOptions(next)
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--foreground)',
                  fontSize: 12,
                  fontWeight: 600,
                  width: Math.max(56, opt.label.length * 7.5),
                  outline: 'none',
                }}
              />
              {options.length > 1 && (
                <button
                  type="button"
                  onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--danger)',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'inline-flex',
                  }}
                  title="Seçeneği sil"
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <input
              type="text"
              value={newOptionLabel}
              onChange={(e) => setNewOptionLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addOption()
                }
              }}
              placeholder="Yeni seçenek…"
              className={depth.input}
              style={{ width: 135, minHeight: 27, padding: '2px 8px', fontSize: 12 }}
            />
            <button
              type="button"
              onClick={addOption}
              className={depth.btnPale}
              style={{ minHeight: 27, padding: '2px 9px', fontSize: 11.5 }}
            >
              <Plus size={12} />
              <span>Ekle</span>
            </button>
          </div>
        </div>
      )}
    </form>
  )
}
