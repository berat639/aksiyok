'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, ArrowRight, Check, Eye, Link2, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import InfoTooltip from '../ui/InfoTooltip'
import type { DynamicRelationDef, DynamicTableDef } from './types'

export type HumanRelationChoice =
  | 'active_has_many_other'
  | 'other_has_many_active'
  | 'both_many'
  | 'single_pair'

export function describeRelationInPlainTurkish(
  rel: DynamicRelationDef,
  activeTable: DynamicTableDef,
  allTables: DynamicTableDef[]
): { otherTableName: string; otherTableId: string; badge: string; sentence: string } {
  const isSource = rel.sourceTableId === activeTable.id
  const otherId = isSource ? rel.targetTableId : rel.sourceTableId
  const otherTable = allTables.find((t) => t.id === otherId)
  const otherName = otherTable?.name || 'Diğer Tablo'

  if (rel.cardinality === 'many_to_many') {
    return {
      otherTableId: otherId,
      otherTableName: otherName,
      badge: 'Çoklu ⇄ Çoklu',
      sentence: `Bir "${activeTable.name}" kaydına birden çok "${otherName}" seçilebilir; aynı "${otherName}" başka "${activeTable.name}" kayıtlarında da kullanılabilir.`,
    }
  }
  if (rel.cardinality === 'one_to_one') {
    return {
      otherTableId: otherId,
      otherTableName: otherName,
      badge: '1 ⇄ 1 Eşleşme',
      sentence: `Her "${activeTable.name}" kaydı yalnızca tek bir "${otherName}" kaydıyla eşleşir.`,
    }
  }

  if (isSource) {
    return {
      otherTableId: otherId,
      otherTableName: otherName,
      badge: `1 ${activeTable.name} ➔ Çok ${otherName}`,
      sentence: `Bir "${activeTable.name}" kaydının altında birden çok "${otherName}" yer alır; her "${otherName}" tek bir "${activeTable.name}" kaydına aittir.`,
    }
  }
  return {
    otherTableId: otherId,
    otherTableName: otherName,
    badge: `1 ${otherName} ➔ Çok ${activeTable.name}`,
    sentence: `Her "${activeTable.name}" kaydı tek bir "${otherName}" kaydına bağlanır.`,
  }
}

function makeSampleItemName(tableName: string, index: number): string {
  const lower = tableName.toLocaleLowerCase('tr-TR')
  if (
    lower.includes('müşteri') ||
    lower.includes('aday') ||
    lower.includes('sigortalı') ||
    lower.includes('danışan') ||
    lower.includes('hasta')
  ) {
    return index === 1 ? 'Caner Yıldız' : 'Zeynep Arslan'
  }
  if (lower.includes('ilan') || lower.includes('portföy')) {
    return index === 1 ? 'Moda 3+1 Daire' : 'Ataşehir 2+1 Rezidans'
  }
  if (lower.includes('teklif') || lower.includes('poliçe')) {
    return index === 1 ? 'Genişletilmiş Kasko Teklifi' : 'Tamamlayıcı Sağlık Sigortası'
  }
  if (lower.includes('teminat')) {
    return index === 1 ? 'İkame Araç (15 Gün)' : 'Cam Muafiyetsiz'
  }
  if (lower.includes('işlem') || lower.includes('hizmet') || lower.includes('tedavi')) {
    return index === 1 ? 'Standart Hizmet Paketi' : 'Yerinde Keşif & Görüşme'
  }
  if (lower.includes('araç') || lower.includes('cihaz')) {
    return index === 1 ? '34 ABC 482' : '06 TRK 214'
  }
  if (lower.includes('paket') || lower.includes('kategori') || lower.includes('grup')) {
    return index === 1 ? 'Standart Paket' : 'Kurumsal Paket'
  }
  return `${tableName} #${index}`
}

interface InlineTableConnectionsBarProps {
  activeTable: DynamicTableDef
  allTables: DynamicTableDef[]
  relations: DynamicRelationDef[]
  allowCreateNewTable?: boolean
  onClose: () => void
  onMutated: () => void
}

export default function InlineTableConnectionsBar({
  activeTable,
  allTables,
  relations,
  allowCreateNewTable = true,
  onClose,
  onMutated,
}: InlineTableConnectionsBarProps) {
  const otherTables = allTables.filter((t) => t.id !== activeTable.id)

  const activeRelations = relations.filter(
    (r) => r.sourceTableId === activeTable.id || r.targetTableId === activeTable.id
  )

  const [selectedOtherTableId, setSelectedOtherTableId] = useState<string>(
    otherTables[0]?.id || (allowCreateNewTable ? '__new__' : '')
  )
  const [newOtherTableName, setNewOtherTableName] = useState('')
  const [choice, setChoice] = useState<HumanRelationChoice>('both_many')
  const [saving, setSaving] = useState(false)
  const [confirmUnlinkId, setConfirmUnlinkId] = useState<string | null>(null)

  useEffect(() => {
    const others = allTables.filter((t) => t.id !== activeTable.id)
    setSelectedOtherTableId((curr) => {
      if (curr === '__new__') {
        if (!allowCreateNewTable) return others[0]?.id || ''
        return others.length === 0 ? '__new__' : curr
      }
      if (others.some((t) => t.id === curr)) return curr
      return others[0]?.id || (allowCreateNewTable ? '__new__' : '')
    })
  }, [activeTable.id, allTables, allowCreateNewTable])

  const selectedOtherObj = otherTables.find((t) => t.id === selectedOtherTableId)
  const previewOtherName =
    selectedOtherTableId === '__new__'
      ? newOtherTableName.trim() || 'Malzemeler'
      : selectedOtherObj?.name || 'Malzemeler'

  const sampleA1 = useMemo(() => makeSampleItemName(activeTable.name, 1), [activeTable.name])
  const sampleA2 = useMemo(() => makeSampleItemName(activeTable.name, 2), [activeTable.name])
  const sampleB1 = useMemo(() => makeSampleItemName(previewOtherName, 1), [previewOtherName])
  const sampleB2 = useMemo(() => makeSampleItemName(previewOtherName, 2), [previewOtherName])

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      let targetOtherId = selectedOtherTableId
      let finalOtherName = previewOtherName

      if (selectedOtherTableId === '__new__') {
        if (!allowCreateNewTable) {
          toast.error('Bu alanda yeni tablo oluşturulamaz; mevcut bir tabloyu seçebilirsiniz')
          return
        }
        const cleanNew = newOtherTableName.trim()
        if (!cleanNew) {
          toast.error('Bağlanacak yeni tablonun adını yazınız')
          return
        }
        const createRes = await fetch('/api/dynamic-tables/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: cleanNew,
            initialColumns: [
              { name: 'Ad / Başlık', fieldType: 'text', isPrimaryTitle: true, isRequired: true },
            ],
          }),
        })
        const created = await createRes.json()
        if (!createRes.ok) {
          toast.error(created.error || 'Yeni tablo oluşturulamadı')
          return
        }
        targetOtherId = created.id
        finalOtherName = created.name
      }

      if (!targetOtherId || targetOtherId === '__new__') {
        toast.error('Lütfen bağlanacak tabloyu seçin')
        return
      }

      const sourceTableId =
        choice === 'other_has_many_active' ? targetOtherId : activeTable.id
      const targetTableId =
        choice === 'other_has_many_active' ? activeTable.id : targetOtherId
      const cardinality =
        choice === 'both_many'
          ? 'many_to_many'
          : choice === 'single_pair'
            ? 'one_to_one'
            : 'one_to_many'

      const res = await fetch('/api/dynamic-tables/relations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceTableId,
          targetTableId,
          cardinality,
          createInverseColumn: true,
          onDelete: 'set_null',
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Tablolar bağlanamadı')
        return
      }
      toast.success(`"${activeTable.name}" ile "${finalOtherName}" birbirine bağlandı`)
      setNewOtherTableName('')
      onMutated()
    } catch {
      toast.error('Bağlantı kurulurken hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = async (relationId: string) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/dynamic-tables/relations/${relationId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Bağlantı kaldırılamadı')
        return
      }
      toast.success('Tablo bağlantısı kaldırıldı')
      setConfirmUnlinkId(null)
      onMutated()
    } catch {
      toast.error('Bağlantı kaldırılamadı')
    } finally {
      setSaving(false)
    }
  }

  const choices: Array<{
    key: HumanRelationChoice
    badge: string
    recommended?: boolean
    title: string
    shortDesc: string
  }> = [
    {
      key: 'both_many',
      badge: 'Çoklu ⇄ Çoklu',
      recommended: true,
      title: `İki tabloda da çoklu seçim (En Esnek)`,
      shortDesc: `Bir "${activeTable.name}" içinde birden çok "${previewOtherName}" seçilir; aynı "${previewOtherName}" başka kayıtlarda da kullanılır.`,
    },
    {
      key: 'active_has_many_other',
      badge: `1 ➔ Çok`,
      title: `Bir "${activeTable.name}" kaydına ait alt kayıtlar`,
      shortDesc: `Bir "${activeTable.name}" altında birçok "${previewOtherName}" olur; her "${previewOtherName}" sadece tek bir "${activeTable.name}" kaydına aittir.`,
    },
    {
      key: 'other_has_many_active',
      badge: `Üst Grup ➔ Çok`,
      title: `"${previewOtherName}" üst grup / kategori olsun`,
      shortDesc: `Bir "${previewOtherName}" altında birden çok "${activeTable.name}" toplanır.`,
    },
    {
      key: 'single_pair',
      badge: '1 ⇄ 1',
      title: `Bire bir tek kayıt eşleşmesi`,
      shortDesc: `Her "${activeTable.name}" yalnızca 1 "${previewOtherName}" ile eşleşir.`,
    },
  ]

  // Compute what each side shows in the Live Preview
  const activeSideAllowsMulti = choice === 'both_many' || choice === 'active_has_many_other'
  const otherSideAllowsMulti = choice === 'both_many' || choice === 'other_has_many_active'

  return (
    <div
      style={{
        padding: '14px 16px',
        borderBottom: '1.5px solid var(--pc-border)',
        background: 'var(--card-inner)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Link2 size={15} style={{ color: 'var(--pc-blue)' }} />
          <strong style={{ fontSize: 13.5, color: 'var(--foreground)' }}>
            {activeTable.name} — Tablo Bağlantısı Kur
          </strong>
          <InfoTooltip title="Tablolar Arası Bağlantı Nedir?">
            İki tabloyu bağladığınızda her iki tabloda da otomatik seçim sütunu açılır. Seçeneklere tıkladığınızda sağdaki &ldquo;Canlı Önizleme&rdquo; kutusunda satırların ve etiketlerin ekranda tam olarak nasıl görüneceğini anında görebilirsiniz.
          </InfoTooltip>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={depth.btn}
          style={{ minHeight: 28, padding: '3px 9px', fontSize: 12 }}
        >
          <X size={13} />
          <span>Kapat</span>
        </button>
      </div>

      {/* Existing Connections */}
      {activeRelations.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground-2)' }}>
            Mevcut Bağlantılar ({activeRelations.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
            {activeRelations.map((rel) => {
              const info = describeRelationInPlainTurkish(rel, activeTable, allTables)
              const confirming = confirmUnlinkId === rel.id
              return (
                <div
                  key={rel.id}
                  className={depth.subcard}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '8px 12px',
                    background: 'var(--card-bg)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 12.5, color: 'var(--foreground)' }}>
                        {activeTable.name} ↔ {info.otherTableName}
                      </strong>
                      <span className={depth.badge} style={{ fontSize: 10.5, padding: '1px 7px' }}>
                        {info.badge}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--pc-muted)', marginTop: 2, lineHeight: 1.35 }}>
                      {info.sentence}
                    </div>
                  </div>

                  {!confirming ? (
                    <button
                      type="button"
                      onClick={() => setConfirmUnlinkId(rel.id)}
                      className={depth.btn}
                      style={{
                        minHeight: 26,
                        padding: '2px 8px',
                        fontSize: 11,
                        color: 'var(--danger)',
                        flexShrink: 0,
                      }}
                    >
                      <Trash2 size={12} />
                      <span>Kaldır</span>
                    </button>
                  ) : (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleDisconnect(rel.id)}
                        className={depth.btn}
                        style={{
                          minHeight: 25,
                          padding: '2px 8px',
                          fontSize: 11,
                          color: 'var(--danger)',
                          borderColor: 'var(--danger)',
                        }}
                      >
                        Onayla
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmUnlinkId(null)}
                        className={depth.btn}
                        style={{ minHeight: 25, padding: '2px 7px', fontSize: 11 }}
                      >
                        Vazgeç
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Split Layout: Left = Selection Steps | Right = Live Interactive Visual Preview */}
      <form
        onSubmit={handleConnect}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 12,
          alignItems: 'stretch',
        }}
      >
        {/* LEFT: Step 1 & Step 2 */}
        <div
          className={depth.subcard}
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 14px',
            background: 'var(--card-bg)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Step 1 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)' }}>
                1. &ldquo;{activeTable.name}&rdquo; tablosunu hangi tabloyla bağlayalım?
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {otherTables.map((t) => {
                  const active = selectedOtherTableId === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedOtherTableId(t.id)}
                      className={active ? depth.btnPrimary : depth.btn}
                      style={{ minHeight: 29, padding: '3px 11px', fontSize: 12 }}
                    >
                      <span>{t.name}</span>
                    </button>
                  )
                })}

                {allowCreateNewTable && (
                  <button
                    type="button"
                    onClick={() => setSelectedOtherTableId('__new__')}
                    className={selectedOtherTableId === '__new__' ? depth.btnPrimary : depth.btnPale}
                    style={{ minHeight: 29, padding: '3px 10px', fontSize: 12 }}
                  >
                    <Plus size={12} color={selectedOtherTableId === '__new__' ? '#ffffff' : undefined} />
                    <span>Yeni Tablo Oluşturup Bağla</span>
                  </button>
                )}
                {!allowCreateNewTable && otherTables.length === 0 && (
                  <span style={{ fontSize: 12, color: 'var(--pc-muted)' }}>
                    Bağlanabilecek mevcut başka bir tablo bulunmuyor.
                  </span>
                )}
              </div>

              {allowCreateNewTable && selectedOtherTableId === '__new__' && (
                <input
                  type="text"
                  value={newOtherTableName}
                  onChange={(e) => setNewOtherTableName(e.target.value)}
                  placeholder="Yeni tablo adı (Örn: Malzemeler, Endikasyonlar, Cihazlar)…"
                  className={depth.input}
                  style={{ width: '100%', minHeight: 32, fontSize: 12.5 }}
                  autoFocus
                />
              )}
            </div>

            {/* Step 2 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)' }}>
                2. Bağlantı türünü seçin (Sağdaki önizlemeden farkını görün):
              </span>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                {choices.map((item) => {
                  const selected = choice === item.key
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setChoice(item.key)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 4,
                        padding: '8px 10px',
                        borderRadius: 10,
                        border: selected
                          ? '1.5px solid var(--pc-blue)'
                          : '1px solid var(--pc-border)',
                        background: selected ? 'var(--pc-tint)' : 'var(--pc-surface)',
                        color: 'var(--foreground)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        boxShadow: selected ? 'var(--pc-clay-pale)' : 'none',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%',
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 999,
                            background: 'var(--card-bg)',
                            border: '1px solid var(--pc-border)',
                            color: 'var(--pc-tint-fg)',
                          }}
                        >
                          {item.badge}
                        </span>
                        {item.recommended && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--pc-blue)' }}>
                            Önerilen
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 700, lineHeight: 1.3 }}>
                        {item.title}
                      </span>
                      <span style={{ fontSize: 10.5, color: 'var(--pc-muted)', lineHeight: 1.3 }}>
                        {item.shortDesc}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={saving}
              className={depth.btnPrimary}
              style={{ minHeight: 32, padding: '5px 15px', fontSize: 12.5 }}
            >
              <Link2 size={13} color="#ffffff" />
              <span>{saving ? 'Bağlanıyor…' : 'Tabloları Birbirine Bağla'}</span>
            </button>
          </div>
        </div>

        {/* RIGHT: LIVE VISUAL PREVIEW ("Canlı Önizleme") */}
        <div
          className={depth.subcard}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px 14px',
            background: 'var(--pc-surface)',
            border: '1.5px solid var(--pc-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: 'var(--pc-tint-fg)' }}>
              <Eye size={14} />
              <span>CANLI ÖNİZLEME — Tablolarda Nasıl Görünecek?</span>
            </span>
            <span className={depth.badge} style={{ fontSize: 10.5 }}>
              <ArrowLeftRight size={11} />
              <span>
                {activeTable.name} ↔ {previewOtherName}
              </span>
            </span>
          </div>

          {/* Mockup 1: Active Table Row View */}
          <div
            style={{
              borderRadius: 10,
              border: '1px solid var(--pc-border)',
              background: 'var(--card-bg)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '5px 10px',
                background: 'var(--pc-tint)',
                borderBottom: '1px solid var(--pc-border)',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--pc-tint-fg)',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>1) &ldquo;{activeTable.name}&rdquo; Tablosundaki Satır Görünümü</span>
              <span>{activeSideAllowsMulti ? 'Çoklu Seçim Açık' : 'Tek Kayıt Seçilir'}</span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1.4fr',
                fontSize: 11.5,
                borderBottom: '1px solid var(--pc-border)',
                background: 'var(--pc-surface)',
                fontWeight: 700,
                color: 'var(--foreground-2)',
              }}
            >
              <div style={{ padding: '5px 9px', borderRight: '1px solid var(--pc-border)' }}>
                {activeTable.columns[0]?.name || 'Ad / Başlık'}
              </div>
              <div style={{ padding: '5px 9px', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Link2 size={11} style={{ color: 'var(--pc-blue)' }} />
                <span>{previewOtherName} (Yeni Sütun)</span>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1.4fr',
                fontSize: 12,
                alignItems: 'center',
              }}
            >
              <div style={{ padding: '8px 9px', borderRight: '1px solid var(--pc-border)', fontWeight: 600 }}>
                ▸ {sampleA1}
              </div>
              <div style={{ padding: '7px 9px', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                <span className={depth.badge} style={{ fontSize: 11, padding: '2px 7px' }}>
                  {sampleB1}
                </span>
                {activeSideAllowsMulti ? (
                  <>
                    <span className={depth.badge} style={{ fontSize: 11, padding: '2px 7px' }}>
                      {sampleB2}
                    </span>
                    <span
                      style={{
                        fontSize: 10.5,
                        padding: '1px 6px',
                        borderRadius: 999,
                        border: '1px dashed var(--pc-border)',
                        color: 'var(--pc-muted)',
                      }}
                    >
                      + Ekle
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 10.5, color: 'var(--pc-muted)' }}>
                    (En fazla 1 kayıt)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Mockup 2: Connected Table Row View */}
          <div
            style={{
              borderRadius: 10,
              border: '1px solid var(--pc-border)',
              background: 'var(--card-bg)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '5px 10px',
                background: 'var(--card-inner)',
                borderBottom: '1px solid var(--pc-border)',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--foreground-2)',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>2) &ldquo;{previewOtherName}&rdquo; Tablosundaki Karşı Görünüm</span>
              <span>{otherSideAllowsMulti ? 'Birden Çok Kayıtta Kullanılır' : 'Tek Kayda Ait Olur'}</span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1.4fr',
                fontSize: 12,
                alignItems: 'center',
              }}
            >
              <div style={{ padding: '8px 9px', borderRight: '1px solid var(--pc-border)', fontWeight: 600 }}>
                ▸ {sampleB1}
              </div>
              <div style={{ padding: '7px 9px', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                <span className={depth.badge} style={{ fontSize: 11, padding: '2px 7px' }}>
                  {sampleA1}
                </span>
                {otherSideAllowsMulti ? (
                  <span className={depth.badge} style={{ fontSize: 11, padding: '2px 7px' }}>
                    {sampleA2}
                  </span>
                ) : (
                  <span style={{ fontSize: 10.5, color: 'var(--pc-muted)' }}>
                    (Sadece {sampleA1} kaydına ait)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Summary Bar at Bottom of Preview */}
          <div
            style={{
              padding: '7px 10px',
              borderRadius: 8,
              background: 'var(--pc-tint)',
              border: '1px solid var(--pc-border)',
              fontSize: 11.5,
              color: 'var(--foreground)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Check size={13} style={{ color: 'var(--pc-blue)', flexShrink: 0 }} />
            <span>
              <strong>Randevu Etkisi:</strong> Eğer &ldquo;{activeTable.name}&rdquo; randevuya açıksa, randevuda <strong>{sampleA1}</strong> seçildiğinde altında <strong>{previewOtherName}</strong> ({sampleB1}{activeSideAllowsMulti ? `, ${sampleB2}` : ''}) otomatik açılır.
            </span>
          </div>
        </div>
      </form>
    </div>
  )
}
