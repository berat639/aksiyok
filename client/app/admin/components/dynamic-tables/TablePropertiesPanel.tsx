'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Calendar, Check, Clock, Eye, Layers, Link2, Plus, Settings2, Trash2, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import InfoTooltip from '../ui/InfoTooltip'
import { samplePreviewTitle } from './tableSetupHelpers'
import {
  MODULE_ROLE_META,
  type DynamicAppointmentConfigDef,
  type DynamicModuleConfigDef,
  type DynamicModuleMapping,
  type DynamicModuleRole,
  type DynamicRelationDef,
  type DynamicTableDef,
} from './types'

function sampleRecordName(tableName: string, idx: number): string {
  return samplePreviewTitle(tableName, idx === 1 ? 1 : 2)
}

interface TablePropertiesPanelProps {
  activeTable: DynamicTableDef
  allTables: DynamicTableDef[]
  relations: DynamicRelationDef[]
  allAppointmentConfigs?: DynamicAppointmentConfigDef[]
  appointmentConfig: DynamicAppointmentConfigDef | null
  moduleConfig?: DynamicModuleConfigDef | null
  onClose: () => void
  onMutated: () => void
  onTableDeleted: (deletedTableId: string) => void
}

export default function TablePropertiesPanel({
  activeTable,
  allTables,
  relations,
  allAppointmentConfigs = [],
  appointmentConfig,
  moduleConfig = null,
  onClose,
  onMutated,
  onTableDeleted,
}: TablePropertiesPanelProps) {
  const [tableName, setTableName] = useState(activeTable.name)
  const [tableDescription, setTableDescription] = useState(activeTable.description || '')
  const [savingGeneral, setSavingGeneral] = useState(false)
  const [confirmDeleteTable, setConfirmDeleteTable] = useState(false)
  const [deletingTable, setDeletingTable] = useState(false)

  // Appointment Relation State (Previous rich template preserved)
  const nonRelationColumns = useMemo(
    () => activeTable.columns.filter((c) => c.fieldType !== 'relation'),
    [activeTable.columns]
  )
  const phoneColumns = useMemo(
    () => nonRelationColumns.filter((c) => c.fieldType === 'phone'),
    [nonRelationColumns]
  )

  const defaultTitleColId =
    nonRelationColumns.find((c) => c.isPrimaryTitle)?.id || nonRelationColumns[0]?.id || ''
  const defaultPhoneColId = phoneColumns[0]?.id || ''

  const [apptEnabled, setApptEnabled] = useState<boolean>(Boolean(appointmentConfig?.enabled))
  const [allowMultiple, setAllowMultiple] = useState<boolean>(
    Boolean(appointmentConfig?.allowMultiple)
  )
  const [includeRelatedTables, setIncludeRelatedTables] = useState<boolean>(
    appointmentConfig ? Boolean(appointmentConfig.includeRelatedTables) : true
  )
  const [isRequiredInAppt, setIsRequiredInAppt] = useState<boolean>(
    Boolean(appointmentConfig?.isRequiredInAppointment)
  )
  const [titleColumnId, setTitleColumnId] = useState<string>(
    appointmentConfig?.titleColumnId || defaultTitleColId
  )
  const [phoneColumnId, setPhoneColumnId] = useState<string>(
    appointmentConfig?.phoneColumnId || defaultPhoneColId
  )
  const [savingAppt, setSavingAppt] = useState(false)

  // Finance & Stock Module Config State
  const [moduleRole, setModuleRole] = useState<'none' | DynamicModuleRole>(
    moduleConfig?.enabled ? moduleConfig.moduleRole : 'none'
  )
  const [moduleMapping, setModuleMapping] = useState<DynamicModuleMapping>(
    moduleConfig?.mapping || {}
  )
  const [savingModule, setSavingModule] = useState(false)

  useEffect(() => {
    setTableName(activeTable.name)
    setTableDescription(activeTable.description || '')
    setConfirmDeleteTable(false)
  }, [activeTable.id, activeTable.name, activeTable.description])

  useEffect(() => {
    setApptEnabled(Boolean(appointmentConfig?.enabled))
    setAllowMultiple(Boolean(appointmentConfig?.allowMultiple))
    setIncludeRelatedTables(
      appointmentConfig ? Boolean(appointmentConfig.includeRelatedTables) : true
    )
    setIsRequiredInAppt(Boolean(appointmentConfig?.isRequiredInAppointment))
    setTitleColumnId(appointmentConfig?.titleColumnId || defaultTitleColId)
    setPhoneColumnId(appointmentConfig?.phoneColumnId || defaultPhoneColId)
  }, [appointmentConfig, defaultTitleColId, defaultPhoneColId])

  useEffect(() => {
    setModuleRole(moduleConfig?.enabled ? moduleConfig.moduleRole : 'none')
    setModuleMapping(moduleConfig?.mapping || {})
  }, [moduleConfig, activeTable.id])

  // Connected tables of activeTable (e.g. Malzemeler, Endikasyonlar connected to Tedaviler)
  const connectedTables = useMemo(() => {
    const ids = new Set<string>()
    for (const r of relations) {
      if (r.sourceTableId === activeTable.id && r.targetTableId !== activeTable.id) {
        ids.add(r.targetTableId)
      } else if (r.targetTableId === activeTable.id && r.sourceTableId !== activeTable.id) {
        ids.add(r.sourceTableId)
      }
    }
    return allTables.filter((t) => ids.has(t.id))
  }, [relations, activeTable.id, allTables])

  // Check if activeTable is already shown as a nested sub-table under another appointment-enabled table
  const parentAppointmentTables = useMemo(() => {
    const enabledParentIds = new Set(
      allAppointmentConfigs
        .filter((c) => c.enabled && c.includeRelatedTables && c.tableId !== activeTable.id)
        .map((c) => c.tableId)
    )
    return connectedTables.filter((ct) => enabledParentIds.has(ct.id))
  }, [allAppointmentConfigs, connectedTables, activeTable.id])

  const selectedTitleColName =
    nonRelationColumns.find((c) => c.id === titleColumnId)?.name ||
    nonRelationColumns[0]?.name ||
    'Ad / Başlık'

  const selectedPhoneColName = phoneColumns.find((c) => c.id === phoneColumnId)?.name || null

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = tableName.trim()
    if (!clean) {
      toast.error('Tablo adı boş bırakılamaz')
      return
    }
    setSavingGeneral(true)
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${activeTable.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clean,
          description: tableDescription.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Tablo özellikleri kaydedilemedi')
        return
      }
      toast.success('Tablo bilgileri güncellendi')
      onMutated()
    } catch {
      toast.error('Tablo bilgileri kaydedilemedi')
    } finally {
      setSavingGeneral(false)
    }
  }

  const handleDeleteTable = async () => {
    setDeletingTable(true)
    try {
      const res = await fetch(`/api/dynamic-tables/tables/${activeTable.id}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Tablo silinemedi')
        return
      }
      toast.success(`"${activeTable.name}" tablosu silindi`)
      onTableDeleted(activeTable.id)
    } catch {
      toast.error('Tablo silinemedi')
    } finally {
      setDeletingTable(false)
    }
  }

  const persistAppointmentSettings = async (next: {
    enabled: boolean
    allowMultiple: boolean
    includeRelatedTables: boolean
    isRequiredInAppointment: boolean
    titleColumnId: string
    phoneColumnId: string
  }) => {
    setApptEnabled(next.enabled)
    setAllowMultiple(next.allowMultiple)
    setIncludeRelatedTables(next.includeRelatedTables)
    setIsRequiredInAppt(next.isRequiredInAppointment)
    setTitleColumnId(next.titleColumnId)
    setPhoneColumnId(next.phoneColumnId)

    setSavingAppt(true)
    try {
      if (!next.enabled) {
        const res = await fetch(`/api/dynamic-tables/appointment-configs/${activeTable.id}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          toast.error('Randevu ilişkisi kapatılamadı')
          return
        }
        toast.success(`"${activeTable.name}" doğrudan randevu seçiminden çıkarıldı`)
      } else {
        const res = await fetch(`/api/dynamic-tables/appointment-configs/${activeTable.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: true,
            allowMultiple: next.allowMultiple,
            includeRelatedTables: next.includeRelatedTables,
            isRequiredInAppointment: next.isRequiredInAppointment,
            titleColumnId: next.titleColumnId || null,
            phoneColumnId: next.phoneColumnId || null,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || 'Randevu ilişkisi kaydedilemedi')
          return
        }
        toast.success(`"${activeTable.name}" randevu özellikleri güncellendi`)
      }
      onMutated()
    } catch {
      toast.error('Randevu özellikleri kaydedilirken hata oluştu')
    } finally {
      setSavingAppt(false)
    }
  }

  const persistModuleSettings = async (
    nextRole: 'none' | DynamicModuleRole,
    nextMapping?: DynamicModuleMapping
  ) => {
    setModuleRole(nextRole)
    if (nextMapping) setModuleMapping(nextMapping)
    setSavingModule(true)
    try {
      if (nextRole === 'none') {
        const res = await fetch(`/api/dynamic-tables/module-configs/${activeTable.id}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          toast.error('Modül bağlantısı kaldırılamadı')
          return
        }
        setModuleMapping({})
        toast.success(`"${activeTable.name}" özel modül bağlantısından çıkarıldı`)
      } else {
        const res = await fetch(`/api/dynamic-tables/module-configs/${activeTable.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            moduleRole: nextRole,
            enabled: true,
            mapping: nextMapping ?? moduleMapping,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || 'Modül bağlantısı kaydedilemedi')
          return
        }
        if (data.mapping) setModuleMapping(data.mapping)
        toast.success(
          `"${activeTable.name}" ➔ ${MODULE_ROLE_META[nextRole].shortBadge} olarak eşleştirildi`
        )
      }
      onMutated()
    } catch {
      toast.error('Modül bağlantısı kaydedilirken hata oluştu')
    } finally {
      setSavingModule(false)
    }
  }

  const numericColumns = useMemo(
    () => nonRelationColumns.filter((c) => c.fieldType === 'currency' || c.fieldType === 'number'),
    [nonRelationColumns]
  )
  const dateColumns = useMemo(
    () => nonRelationColumns.filter((c) => c.fieldType === 'date'),
    [nonRelationColumns]
  )
  const selectOrTextColumns = useMemo(
    () =>
      nonRelationColumns.filter(
        (c) => c.fieldType === 'select' || c.fieldType === 'text'
      ),
    [nonRelationColumns]
  )

  const previewItem1 = sampleRecordName(tableName || activeTable.name, 1)
  const previewItem2 = sampleRecordName(tableName || activeTable.name, 2)

  return (
    <div
      style={{
        padding: '13px 16px',
        borderBottom: '1.5px solid var(--pc-border)',
        background: 'var(--card-inner)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Settings2 size={15} style={{ color: 'var(--pc-blue)' }} />
          <strong style={{ fontSize: 13.5, color: 'var(--foreground)' }}>
            {activeTable.name} — Tablo Özellikleri ve Randevu Önizlemesi
          </strong>
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 12,
          alignItems: 'stretch',
        }}
      >
        {/* 1. Genel Tablo Bilgileri */}
        <form
          onSubmit={handleSaveGeneral}
          className={depth.subcard}
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 10,
            padding: '12px 14px',
            background: 'var(--card-bg)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--foreground)' }}>
              1. Genel Tablo Bilgileri
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--foreground-2)' }}>
                Tablo Adı
              </label>
              <input
                type="text"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                className={depth.input}
                style={{ minHeight: 32, fontSize: 12.5 }}
                placeholder="Örn: Müşteriler, Portföy İlanları, Sigorta Teklifleri…"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--foreground-2)' }}>
                Açıklama (İsteğe Bağlı)
              </label>
              <input
                type="text"
                value={tableDescription}
                onChange={(e) => setTableDescription(e.target.value)}
                className={depth.input}
                style={{ minHeight: 32, fontSize: 12.5 }}
                placeholder="Bu tablonun ne için kullanıldığını kısaca yazabilirsiniz…"
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
              marginTop: 4,
            }}
          >
            {!confirmDeleteTable ? (
              <button
                type="button"
                onClick={() => setConfirmDeleteTable(true)}
                className={depth.btn}
                style={{
                  minHeight: 30,
                  padding: '4px 10px',
                  fontSize: 12,
                  color: 'var(--danger)',
                }}
              >
                <Trash2 size={13} />
                <span>Tabloyu Sil</span>
              </button>
            ) : (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--danger)' }}>
                  Tüm kayıtlarıyla silinsin mi?
                </span>
                <button
                  type="button"
                  disabled={deletingTable}
                  onClick={() => void handleDeleteTable()}
                  className={depth.btn}
                  style={{
                    minHeight: 28,
                    padding: '3px 9px',
                    fontSize: 11.5,
                    color: 'var(--danger)',
                    borderColor: 'var(--danger)',
                  }}
                >
                  {deletingTable ? 'Siliniyor…' : 'Evet, Sil'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteTable(false)}
                  className={depth.btn}
                  style={{ minHeight: 28, padding: '3px 9px', fontSize: 11.5 }}
                >
                  Vazgeç
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={savingGeneral}
              className={depth.btnPrimary}
              style={{ minHeight: 30, padding: '4px 12px', fontSize: 12 }}
            >
              <Check size={13} color="#ffffff" />
              <span>{savingGeneral ? 'Kaydediliyor…' : 'Bilgileri Kaydet'}</span>
            </button>
          </div>
        </form>

        {/* 2. Randevu ile İlişkisi (Ayarlar) */}
        <div
          className={depth.subcard}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px 14px',
            background: 'var(--card-bg)',
            border: apptEnabled ? '1.5px solid var(--pc-blue)' : '1px solid var(--pc-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Calendar size={15} style={{ color: 'var(--pc-blue)' }} />
              <strong style={{ fontSize: 12.5, color: 'var(--foreground)' }}>
                2. Randevu ile İlişkisi
              </strong>
              <InfoTooltip title="Randevu Bağlantısı Nasıl Çalışır?">
                Doğrudan randevuda seçilecek tablolar (örneğin Müşteriler, Portföy İlanları veya Sigorta Teklifleri) için &ldquo;Randevu ile İlişkili&rdquo; seçeneğini açın. Ek Teminatlar, Mülk Sahipleri veya Özellikler gibi yardımcı listeler için bunu kapalı bırakabilirsiniz; ana listeye bağladığınızda randevuda onun altında kendiliğinden açılır.
              </InfoTooltip>
            </div>
            {savingAppt && (
              <span style={{ fontSize: 11.5, color: 'var(--pc-muted)' }}>Kaydediliyor…</span>
            )}
          </div>

          {/* Açık / Kapalı Seçimi */}
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={savingAppt}
              onClick={() =>
                void persistAppointmentSettings({
                  enabled: false,
                  allowMultiple,
                  includeRelatedTables,
                  isRequiredInAppointment: false,
                  titleColumnId,
                  phoneColumnId,
                })
              }
              className={!apptEnabled ? depth.btnPrimary : depth.btn}
              style={{ flex: 1, minWidth: 135, minHeight: 31, fontSize: 11.5 }}
            >
              <span>Randevu İlişkisi Yok</span>
            </button>

            <button
              type="button"
              disabled={savingAppt}
              onClick={() =>
                void persistAppointmentSettings({
                  enabled: true,
                  allowMultiple,
                  includeRelatedTables,
                  isRequiredInAppointment: isRequiredInAppt,
                  titleColumnId: titleColumnId || defaultTitleColId,
                  phoneColumnId,
                })
              }
              className={apptEnabled ? depth.btnPrimary : depth.btn}
              style={{ flex: 1, minWidth: 165, minHeight: 31, fontSize: 11.5 }}
            >
              <Check size={13} color={apptEnabled ? '#ffffff' : undefined} />
              <span>Randevu ile İlişkili (Açık)</span>
            </button>
          </div>

          {!apptEnabled ? (
            <div style={{ fontSize: 11.5, color: 'var(--pc-muted)', lineHeight: 1.45 }}>
              {parentAppointmentTables.length > 0 ? (
                <span>
                  Bu tablo doğrudan ana alan olarak sorulmaz; ancak bağlı olduğu{' '}
                  <strong>{parentAppointmentTables.map((p) => p.name).join(', ')}</strong> randevuda
                  seçildiğinde onun <strong>alt bilgisi olarak otomatik açılır</strong> (sağdaki
                  önizlemeye bakın).
                </span>
              ) : (
                <span>
                  Bu tablo doğrudan randevu formunda yer almaz. Eğer randevuya açık bir tabloya
                  (örn. Portföy İlanları, Sigorta Teklifleri veya Hizmetler) bağlarsanız, randevuda onun altında alt bilgi olarak açılır.
                </span>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {/* Tek Kayıt / Birden Fazla Kayıt */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--foreground-2)' }}>
                  Bir randevuda kaç kayıt seçilebilsin?
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button
                    type="button"
                    disabled={savingAppt}
                    onClick={() =>
                      void persistAppointmentSettings({
                        enabled: true,
                        allowMultiple: false,
                        includeRelatedTables,
                        isRequiredInAppointment: isRequiredInAppt,
                        titleColumnId,
                        phoneColumnId,
                      })
                    }
                    style={{
                      textAlign: 'left',
                      padding: '7px 9px',
                      borderRadius: 9,
                      border: !allowMultiple
                        ? '1.5px solid var(--pc-blue)'
                        : '1px solid var(--pc-border)',
                      background: !allowMultiple ? 'var(--pc-tint)' : 'var(--pc-surface)',
                      color: 'var(--foreground)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 11.5, fontWeight: 700 }}>Tek Kayıt</div>
                    <div style={{ fontSize: 10.5, color: 'var(--pc-muted)', marginTop: 1 }}>
                      Örn: Müşteri, Alıcı Adayı, Sigortalı
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={savingAppt}
                    onClick={() =>
                      void persistAppointmentSettings({
                        enabled: true,
                        allowMultiple: true,
                        includeRelatedTables,
                        isRequiredInAppointment: isRequiredInAppt,
                        titleColumnId,
                        phoneColumnId,
                      })
                    }
                    style={{
                      textAlign: 'left',
                      padding: '7px 9px',
                      borderRadius: 9,
                      border: allowMultiple
                        ? '1.5px solid var(--pc-blue)'
                        : '1px solid var(--pc-border)',
                      background: allowMultiple ? 'var(--pc-tint)' : 'var(--pc-surface)',
                      color: 'var(--foreground)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 11.5, fontWeight: 700 }}>Birden Fazla Kayıt</div>
                    <div style={{ fontSize: 10.5, color: 'var(--pc-muted)', marginTop: 1 }}>
                      Örn: İlanlar, Sigorta Teklifleri, Hizmetler
                    </div>
                  </button>
                </div>
              </div>

              {/* Alt Tabloları Gösterme */}
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'flex-start',
                  gap: 7,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={includeRelatedTables}
                  disabled={savingAppt}
                  onChange={(e) =>
                    void persistAppointmentSettings({
                      enabled: true,
                      allowMultiple,
                      includeRelatedTables: e.target.checked,
                      isRequiredInAppointment: isRequiredInAppt,
                      titleColumnId,
                      phoneColumnId,
                    })
                  }
                  style={{ marginTop: 2 }}
                />
                <span>
                  Bağlı alt tabloları da randevu içinde ekle / düzenle (Örn: Mülk Sahibi, Ek Teminat, Özellik)
                </span>
              </label>

              {/* Zorunluluk */}
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--foreground-2)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={isRequiredInAppt}
                  disabled={savingAppt}
                  onChange={(e) =>
                    void persistAppointmentSettings({
                      enabled: true,
                      allowMultiple,
                      includeRelatedTables,
                      isRequiredInAppointment: e.target.checked,
                      titleColumnId,
                      phoneColumnId,
                    })
                  }
                />
                <span>Randevu oluştururken bu bilginin seçilmesi zorunlu olsun</span>
              </label>

              {/* Ana Alan & Telefon Eşleşmesi */}
              {nonRelationColumns.length > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: phoneColumns.length > 0 ? '1fr 1fr' : '1fr',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--pc-muted)' }}>
                      Randevuda Görünecek Başlık Sütunu
                    </label>
                    <select
                      value={titleColumnId}
                      disabled={savingAppt}
                      onChange={(e) =>
                        void persistAppointmentSettings({
                          enabled: true,
                          allowMultiple,
                          includeRelatedTables,
                          isRequiredInAppointment: isRequiredInAppt,
                          titleColumnId: e.target.value,
                          phoneColumnId,
                        })
                      }
                      className={depth.select}
                      style={{ minHeight: 29, fontSize: 11.5 }}
                    >
                      {nonRelationColumns.map((col) => (
                        <option key={col.id} value={col.id}>
                          {col.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {phoneColumns.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--pc-muted)' }}>
                        İletişim Telefonu Sütunu
                      </label>
                      <select
                        value={phoneColumnId}
                        disabled={savingAppt}
                        onChange={(e) =>
                          void persistAppointmentSettings({
                            enabled: true,
                            allowMultiple,
                            includeRelatedTables,
                            isRequiredInAppointment: isRequiredInAppt,
                            titleColumnId,
                            phoneColumnId: e.target.value,
                          })
                        }
                        className={depth.select}
                        style={{ minHeight: 29, fontSize: 11.5 }}
                      >
                        <option value="">Kullanma</option>
                        {phoneColumns.map((col) => (
                          <option key={col.id} value={col.id}>
                            {col.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. Finans ve Stok/Bakım Modül Bağlantısı */}
        <div
          className={depth.subcard}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px 14px',
            background: 'var(--card-bg)',
            border: moduleRole !== 'none' ? '1.5px solid var(--pc-blue)' : '1px solid var(--pc-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Layers size={15} style={{ color: 'var(--pc-blue)' }} />
              <strong style={{ fontSize: 12.5, color: 'var(--foreground)' }}>
                3. Finans ve Stok/Bakım Rolü
              </strong>
              <InfoTooltip title="Modül Bağlantısı Nedir?">
                Bu tabloyu Ödemeler &amp; Finans veya Stok &amp; Bakım ekranına bağladığınızda; grafikler, kritik stok / son kullanma tarihi uyarıları ve periyodik bakım sayaçları doğrudan bu tablonun sütunlarından beslenir.
              </InfoTooltip>
            </div>
            {savingModule && (
              <span style={{ fontSize: 11.5, color: 'var(--pc-muted)' }}>Kaydediliyor…</span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground-2)' }}>
              Bu tablo hangi modülü beslesin?
            </label>
            <select
              value={moduleRole}
              disabled={savingModule}
              onChange={(e) => {
                const val = e.target.value as 'none' | DynamicModuleRole
                void persistModuleSettings(val, {})
              }}
              className={depth.input}
              style={{ minHeight: 32, fontSize: 12 }}
            >
              <option value="none">Standart Tablo (Özel Modül Bağlantısı Yok)</option>
              {(Object.keys(MODULE_ROLE_META) as DynamicModuleRole[]).map((rk) => (
                <option key={rk} value={rk}>
                  {MODULE_ROLE_META[rk].label}
                </option>
              ))}
            </select>
          </div>

          {moduleRole === 'none' ? (
            <div style={{ fontSize: 11.5, color: 'var(--pc-muted)', lineHeight: 1.45 }}>
              Ödemeler, komisyonlar, primler, giderler, malzeme stoku veya periyodik bakım listelerinizi buradan ilgili modüle tek tıkla bağlayabilirsiniz.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--pc-tint-fg)', fontWeight: 600 }}>
                ✓ {MODULE_ROLE_META[moduleRole].tabHint}
              </div>

              {(moduleRole === 'finance_income' || moduleRole === 'finance_expense') && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--pc-muted)' }}>
                      Tutar Sütunu
                    </label>
                    <select
                      value={moduleMapping.amountColumnId || ''}
                      disabled={savingModule}
                      onChange={(e) =>
                        void persistModuleSettings(moduleRole, {
                          ...moduleMapping,
                          amountColumnId: e.target.value || null,
                        })
                      }
                      className={depth.input}
                      style={{ minHeight: 28, fontSize: 11.5 }}
                    >
                      <option value="">Otomatik Algıla</option>
                      {numericColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--pc-muted)' }}>
                      İşlem Tarihi Sütunu
                    </label>
                    <select
                      value={moduleMapping.dateColumnId || ''}
                      disabled={savingModule}
                      onChange={(e) =>
                        void persistModuleSettings(moduleRole, {
                          ...moduleMapping,
                          dateColumnId: e.target.value || null,
                        })
                      }
                      className={depth.input}
                      style={{ minHeight: 28, fontSize: 11.5 }}
                    >
                      <option value="">Otomatik Algıla</option>
                      {dateColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {moduleRole === 'finance_income' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, gridColumn: '1 / -1' }}>
                      <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--pc-muted)' }}>
                        Tahsilat Durumu Sütunu (Tamamlandı / Bekliyor)
                      </label>
                      <select
                        value={moduleMapping.statusColumnId || ''}
                        disabled={savingModule}
                        onChange={(e) =>
                          void persistModuleSettings(moduleRole, {
                            ...moduleMapping,
                            statusColumnId: e.target.value || null,
                          })
                        }
                        className={depth.input}
                        style={{ minHeight: 28, fontSize: 11.5 }}
                      >
                        <option value="">Otomatik Algıla</option>
                        {selectOrTextColumns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {moduleRole === 'stock_inventory' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--pc-muted)' }}>
                      Mevcut Stok Sütunu
                    </label>
                    <select
                      value={moduleMapping.quantityColumnId || ''}
                      disabled={savingModule}
                      onChange={(e) =>
                        void persistModuleSettings(moduleRole, {
                          ...moduleMapping,
                          quantityColumnId: e.target.value || null,
                        })
                      }
                      className={depth.input}
                      style={{ minHeight: 28, fontSize: 11.5 }}
                    >
                      <option value="">Otomatik Algıla</option>
                      {numericColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--pc-muted)' }}>
                      Kritik Eşik Sütunu
                    </label>
                    <select
                      value={moduleMapping.minThresholdColumnId || ''}
                      disabled={savingModule}
                      onChange={(e) =>
                        void persistModuleSettings(moduleRole, {
                          ...moduleMapping,
                          minThresholdColumnId: e.target.value || null,
                        })
                      }
                      className={depth.input}
                      style={{ minHeight: 28, fontSize: 11.5 }}
                    >
                      <option value="">Otomatik Algıla</option>
                      {numericColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--pc-muted)' }}>
                      Birim Maliyet Sütunu
                    </label>
                    <select
                      value={moduleMapping.unitCostColumnId || ''}
                      disabled={savingModule}
                      onChange={(e) =>
                        void persistModuleSettings(moduleRole, {
                          ...moduleMapping,
                          unitCostColumnId: e.target.value || null,
                        })
                      }
                      className={depth.input}
                      style={{ minHeight: 28, fontSize: 11.5 }}
                    >
                      <option value="">Otomatik Algıla</option>
                      {numericColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--pc-muted)' }}>
                      Son Kullanma Tarihi (SKT)
                    </label>
                    <select
                      value={moduleMapping.expiryDateColumnId || ''}
                      disabled={savingModule}
                      onChange={(e) =>
                        void persistModuleSettings(moduleRole, {
                          ...moduleMapping,
                          expiryDateColumnId: e.target.value || null,
                        })
                      }
                      className={depth.input}
                      style={{ minHeight: 28, fontSize: 11.5 }}
                    >
                      <option value="">Otomatik Algıla / Yok</option>
                      {dateColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {moduleRole === 'asset_maintenance' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--pc-muted)' }}>
                      Planlanan Bakım Tarihi
                    </label>
                    <select
                      value={moduleMapping.scheduledDateColumnId || ''}
                      disabled={savingModule}
                      onChange={(e) =>
                        void persistModuleSettings(moduleRole, {
                          ...moduleMapping,
                          scheduledDateColumnId: e.target.value || null,
                        })
                      }
                      className={depth.input}
                      style={{ minHeight: 28, fontSize: 11.5 }}
                    >
                      <option value="">Otomatik Algıla</option>
                      {dateColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--pc-muted)' }}>
                      Periyot Günü Sütunu
                    </label>
                    <select
                      value={moduleMapping.periodicDaysColumnId || ''}
                      disabled={savingModule}
                      onChange={(e) =>
                        void persistModuleSettings(moduleRole, {
                          ...moduleMapping,
                          periodicDaysColumnId: e.target.value || null,
                        })
                      }
                      className={depth.input}
                      style={{ minHeight: 28, fontSize: 11.5 }}
                    >
                      <option value="">Otomatik Algıla</option>
                      {numericColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. CANLI RANDEVU FORMU ÖNİZLEMESİ ("Bende canlansın" Kartı) */}
        <div
          className={depth.subcard}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
            padding: '12px 14px',
            background: 'var(--pc-surface)',
            border: '1.5px solid var(--pc-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 800,
                color: 'var(--pc-tint-fg)',
              }}
            >
              <Eye size={14} />
              <span>4. CANLI ÖNİZLEME — Randevu Ekranı</span>
            </span>
            <span className={depth.badge} style={{ fontSize: 10.5 }}>
              Takvim Görünümü
            </span>
          </div>

          {/* Miniature Appointment Modal Mockup */}
          <div
            style={{
              borderRadius: 11,
              border: '1.5px solid var(--input-border)',
              background: 'var(--card-bg)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Mockup Modal Top Bar */}
            <div
              style={{
                padding: '7px 10px',
                borderBottom: '1px solid var(--pc-border)',
                background: 'var(--pc-surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 11.5,
                fontWeight: 700,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Calendar size={12} style={{ color: 'var(--pc-blue)' }} />
                <span>Yeni Randevu / Randevu Detayı</span>
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10.5,
                  color: 'var(--pc-muted)',
                  fontWeight: 600,
                }}
              >
                <Clock size={11} />
                <span>14:30 – 15:00</span>
              </span>
            </div>

            {/* Mockup Body */}
            <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {apptEnabled ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--foreground)' }}>
                      {tableName || activeTable.name}{' '}
                      {isRequiredInAppt && (
                        <span style={{ color: 'var(--danger)', fontWeight: 800 }}>* Zorunlu</span>
                      )}
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--pc-muted)' }}>
                      {allowMultiple ? 'Çoklu Seçim' : 'Tekli Seçim'}
                    </span>
                  </div>

                  {/* Selected Primary Item 1 */}
                  <div
                    style={{
                      padding: '8px 9px',
                      borderRadius: 8,
                      border: '1.5px solid var(--pc-blue)',
                      background: 'var(--pc-tint)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground)' }}>
                          ✓ {previewItem1}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--pc-muted)' }}>
                          Başlık: {selectedTitleColName}
                          {selectedPhoneColName ? ` • Tel (${selectedPhoneColName}): 0532 123 45 67` : ''}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 6,
                          background: 'var(--card-bg)',
                          border: '1px solid var(--pc-border)',
                        }}
                      >
                        Düzenle
                      </span>
                    </div>

                    {/* Nested Related Sub-Tables inside the selected item */}
                    {includeRelatedTables && (
                      <div
                        style={{
                          marginLeft: 8,
                          padding: '6px 8px',
                          borderRadius: 7,
                          background: 'var(--card-bg)',
                          borderLeft: '2.5px solid var(--pc-blue)',
                          borderTop: '1px solid var(--pc-border)',
                          borderRight: '1px solid var(--pc-border)',
                          borderBottom: '1px solid var(--pc-border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        {connectedTables.length > 0 ? (
                          connectedTables.map((ct) => (
                            <div
                              key={ct.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 6,
                                fontSize: 11,
                              }}
                            >
                              <span style={{ fontWeight: 700, color: 'var(--foreground-2)' }}>
                                ↳ {ct.name}:
                              </span>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <span className={depth.badge} style={{ fontSize: 10, padding: '1px 6px' }}>
                                  {sampleRecordName(ct.name, 1)}
                                </span>
                                <span style={{ fontSize: 10, color: 'var(--pc-blue)', fontWeight: 700 }}>
                                  + Ekle
                                </span>
                              </span>
                            </div>
                          ))
                        ) : (
                          <div style={{ fontSize: 10.5, color: 'var(--pc-muted)' }}>
                            ↳ Bağlı alt tablolar (örn. Özellikler, Ek Teminatlar, Mülk Sahibi) bağlandığında burada otomatik açılır.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Second Item if allowMultiple is ON */}
                  {allowMultiple ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <div
                        style={{
                          flex: 1,
                          padding: '6px 9px',
                          borderRadius: 8,
                          border: '1px solid var(--pc-border)',
                          background: 'var(--pc-surface)',
                          fontSize: 11.5,
                          fontWeight: 600,
                        }}
                      >
                        ✓ {previewItem2}
                      </div>
                      <span
                        className={depth.btnPale}
                        style={{ minHeight: 27, padding: '2px 8px', fontSize: 10.5, pointerEvents: 'none' }}
                      >
                        <Plus size={11} />
                        <span>Başka Ekle</span>
                      </span>
                    </div>
                  ) : (
                    <div style={{ fontSize: 10.5, color: 'var(--pc-muted)' }}>
                      Tek kayıt modunda randevu başına 1 kayıt seçilir veya <strong>+ Yeni Ekle</strong> ile anında oluşturulur.
                    </div>
                  )}
                </>
              ) : parentAppointmentTables.length > 0 ? (
                /* Preview when disabled directly, BUT shown under a connected parent table! */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground-2)' }}>
                    {parentAppointmentTables[0]!.name} (Randevuda Seçildiğinde)
                  </div>
                  <div
                    style={{
                      padding: '8px 9px',
                      borderRadius: 8,
                      border: '1px solid var(--pc-border)',
                      background: 'var(--pc-surface)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ fontSize: 11.5, fontWeight: 700 }}>
                      ✓ {sampleRecordName(parentAppointmentTables[0]!.name, 1)}
                    </div>
                    <div
                      style={{
                        marginLeft: 8,
                        padding: '6px 8px',
                        borderRadius: 7,
                        border: '1.5px solid var(--pc-blue)',
                        background: 'var(--pc-tint)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 11,
                      }}
                    >
                      <strong style={{ color: 'var(--foreground)' }}>
                        ↳ {tableName || activeTable.name}:
                      </strong>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span className={depth.badge} style={{ fontSize: 10, padding: '1px 6px' }}>
                          {previewItem1}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--pc-blue)', fontWeight: 700 }}>
                          + Ekle / Düzenle
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: '16px 10px',
                    textAlign: 'center',
                    borderRadius: 8,
                    border: '1px dashed var(--pc-border)',
                    color: 'var(--pc-muted)',
                    fontSize: 11.5,
                  }}
                >
                  <strong>&ldquo;{tableName || activeTable.name}&rdquo;</strong> şu an takvim randevu formunda gösterilmiyor (yalnızca Veri Tabloları ekranında kullanılır).
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
