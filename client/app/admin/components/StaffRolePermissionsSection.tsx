'use client'

import React from 'react'
import { Check, RotateCcw, ShieldCheck } from 'lucide-react'
import InfoTooltip from './ui/InfoTooltip'
import { termLabel } from '@/lib/ui-glossary'

export type ConfigurableStaffRole = 'calisan' | 'hekim' | 'sekreter' | 'asistan'

export interface StaffGranularPermissions {
  viewShiftPlanner: boolean
  editShifts: boolean
  manageLeaves: boolean
  editClinicWorkingHours: boolean
  manageStaff: boolean
  manageDynamicTables: boolean
  showOnCalendar?: boolean
}

export const STAFF_ROLE_OPTIONS: Array<{ value: ConfigurableStaffRole; label: string }> = [
  { value: 'calisan', label: 'Çalışan' },
]

export const ROLE_BADGE_META: Record<
  string,
  { label: string; color: string; bg: string; border: string }
> = {
  yonetici: {
    label: 'Yönetici',
    color: 'var(--badge-clinic-fg, #0369a1)',
    bg: 'var(--badge-clinic-bg, #e0f2fe)',
    border: 'var(--badge-clinic-border, #bae6fd)',
  },
  calisan: {
    label: 'Çalışan',
    color: 'var(--btn-clinic-blue-fg, #1d4ed8)',
    bg: 'var(--btn-clinic-blue-bg, #eff6ff)',
    border: 'var(--btn-clinic-blue-border, #93c5fd)',
  },
  hekim: {
    label: 'Çalışan',
    color: 'var(--btn-clinic-blue-fg, #1d4ed8)',
    bg: 'var(--btn-clinic-blue-bg, #eff6ff)',
    border: 'var(--btn-clinic-blue-border, #93c5fd)',
  },
  sekreter: {
    label: 'Çalışan (Karşılama)',
    color: 'var(--btn-clinic-mint-fg, #15803d)',
    bg: 'var(--btn-clinic-mint-bg, #f0fdf4)',
    border: 'var(--btn-clinic-mint-border, #86efac)',
  },
  host: {
    label: 'Çalışan (Karşılama)',
    color: 'var(--btn-clinic-mint-fg, #15803d)',
    bg: 'var(--btn-clinic-mint-bg, #f0fdf4)',
    border: 'var(--btn-clinic-mint-border, #86efac)',
  },
  asistan: {
    label: 'Çalışan (Asistan)',
    color: 'var(--pc-tint-fg, #0369a1)',
    bg: 'var(--pc-tint, #e0f2fe)',
    border: 'var(--badge-clinic-border, #bae6fd)',
  },
}

export const DEFAULT_ROLE_TABS: Record<ConfigurableStaffRole, string[]> = {
  calisan: ['calendar', 'patients', 'knowledge', 'klinik'],
  hekim: ['calendar', 'patients', 'knowledge', 'klinik'],
  sekreter: ['calendar', 'patients', 'payments', 'klinik'],
  asistan: ['calendar', 'patients', 'klinik'],
}

export const DEFAULT_ROLE_STAFF_PERMS: Record<ConfigurableStaffRole, StaffGranularPermissions> = {
  calisan: {
    viewShiftPlanner: true,
    editShifts: false,
    manageLeaves: true,
    editClinicWorkingHours: false,
    manageStaff: false,
    manageDynamicTables: false,
    showOnCalendar: true,
  },
  hekim: {
    viewShiftPlanner: true,
    editShifts: false,
    manageLeaves: true,
    editClinicWorkingHours: false,
    manageStaff: false,
    manageDynamicTables: false,
    showOnCalendar: true,
  },
  sekreter: {
    viewShiftPlanner: true,
    editShifts: true,
    manageLeaves: true,
    editClinicWorkingHours: false,
    manageStaff: false,
    manageDynamicTables: false,
    showOnCalendar: false,
  },
  asistan: {
    viewShiftPlanner: true,
    editShifts: false,
    manageLeaves: false,
    editClinicWorkingHours: false,
    manageStaff: false,
    manageDynamicTables: false,
    showOnCalendar: false,
  },
}

export function normalizeStaffRoleForForm(role?: string | null): string {
  if (role === 'yonetici') return 'yonetici'
  if (role === 'hekim') return 'calisan'
  if (role === 'asistan' || role === 'sekreter' || role === 'host') return 'calisan'
  return 'calisan'
}

export function normalizeConfigurableRoleKey(role?: string | null): ConfigurableStaffRole {
  if (role === 'hekim') return 'hekim'
  if (role === 'asistan') return 'asistan'
  if (role === 'sekreter' || role === 'host') return 'sekreter'
  return 'calisan'
}

export function getPresetForRole(
  role: string,
  roleTabsMap?: Record<string, string[]> | null,
  roleStaffMap?: Record<string, StaffGranularPermissions> | null,
): { allowedTabs: string[]; staffPermissions: StaffGranularPermissions } {
  const key = normalizeConfigurableRoleKey(role)
  const rawTabs =
    roleTabsMap?.[key] ||
    (key === 'calisan' ? roleTabsMap?.hekim : undefined) ||
    (key === 'sekreter' ? roleTabsMap?.host : undefined) ||
    DEFAULT_ROLE_TABS[key]
  const rawStaff =
    roleStaffMap?.[key] ||
    (key === 'calisan' ? roleStaffMap?.hekim : undefined) ||
    (key === 'sekreter' ? roleStaffMap?.host : undefined) ||
    DEFAULT_ROLE_STAFF_PERMS[key]

  return {
    allowedTabs: Array.isArray(rawTabs) && rawTabs.length > 0 ? [...rawTabs] : [...DEFAULT_ROLE_TABS[key]],
    staffPermissions: { ...DEFAULT_ROLE_STAFF_PERMS[key], ...(rawStaff || {}) },
  }
}

const STAFF_PERM_DEFS: Array<{ key: keyof StaffGranularPermissions; label: string }> = [
  { key: 'showOnCalendar', label: 'Takvimde çalışan sütunu ve vardiya listesinde göster' },
  { key: 'viewShiftPlanner', label: 'Mesai Planla sekmesini görüntüleyebilir' },
  { key: 'editShifts', label: 'Mesai ekleyebilir, düzenleyebilir veya silebilir' },
  { key: 'manageLeaves', label: 'İzin ve kapalı saat ekleyebilir veya kaldırabilir' },
  { key: 'editClinicWorkingHours', label: 'İşletme genel mesai saatini değiştirebilir' },
  { key: 'manageStaff', label: 'Personel davet edebilir veya hesap dondurabilir' },
]

export interface StaffRolePermissionsSectionProps {
  role: string
  allowedTabs: string[]
  staffPermissions: StaffGranularPermissions
  onChangeAllowedTabs: (next: string[]) => void
  onChangeStaffPermissions: (next: StaffGranularPermissions) => void
  onResetToRoleDefault?: () => void
  saveAsRoleDefault?: boolean
  onChangeSaveAsRoleDefault?: (next: boolean) => void
  canUpdateRoleDefaults?: boolean
  dynamicTabLabel?: string
}

export default function StaffRolePermissionsSection({
  role,
  allowedTabs,
  staffPermissions,
  onChangeAllowedTabs,
  onChangeStaffPermissions,
  onResetToRoleDefault,
  saveAsRoleDefault = false,
  onChangeSaveAsRoleDefault,
  canUpdateRoleDefaults = false,
  dynamicTabLabel = 'Veri Tabloları',
}: StaffRolePermissionsSectionProps) {
  const panelTabs = [
    { id: 'calendar', label: 'Takvim' },
    { id: 'patients', label: dynamicTabLabel || 'Veri Tabloları' },
    { id: 'incoming', label: 'Gelen Kayıtlar' },
    { id: 'payments', label: 'Ödemeler ve Finans' },
    { id: 'stok', label: 'Stok ve Bakım' },
    { id: 'knowledge', label: termLabel('knowledgeBlock') },
    { id: 'klinik', label: 'İşletme Personeli' },
  ]

  const isAdminRole = role === 'yonetici'
  const roleTitle = ROLE_BADGE_META[role]?.label || 'Personel'

  const toggleTab = (tabId: string) => {
    const exists = allowedTabs.includes(tabId)
    if (exists) {
      const next = allowedTabs.filter((id) => id !== tabId)
      if (next.length === 0) return
      onChangeAllowedTabs(next)
    } else {
      onChangeAllowedTabs([...allowedTabs, tabId])
    }
  }

  const toggleStaffPerm = (permKey: keyof StaffGranularPermissions) => {
    onChangeStaffPermissions({
      ...staffPermissions,
      [permKey]: !staffPermissions[permKey],
    })
  }

  return (
    <div
      style={{
        background: 'var(--card-inner)',
        padding: 14,
        borderRadius: 10,
        border: '1px solid var(--input-border)',
        boxShadow: 'var(--pc-neo-subcard)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Başlık ve Bilgi İkonu */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={16} color="var(--accent, #0284c7)" />
          <span style={{ fontSize: '0.84rem', fontWeight: 750, color: 'var(--foreground)' }}>
            Rol Sekme ve İşlem Yetkileri
          </span>
          <InfoTooltip title="Rol ve Yetki İzinleri">
            Bu çalışanın sol menüde görebileceği sekmeleri ve İşletme Personeli ekranındaki mesai, izin ve personel işlem yetkilerini belirler. İşletme yöneticisi her zaman tüm yetkilere sahiptir.
          </InfoTooltip>
        </div>

        {!isAdminRole && onResetToRoleDefault && (
          <button
            type="button"
            onClick={onResetToRoleDefault}
            style={{
              padding: '4px 9px',
              borderRadius: 7,
              border: '1px solid var(--btn-clinic-outline-border, #93c5fd)',
              background: 'var(--btn-clinic-outline-bg, #eff6ff)',
              color: 'var(--btn-clinic-outline-text, #1d4ed8)',
              boxShadow: 'var(--pc-clay-btn)',
              fontSize: '0.68rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
            title={`${roleTitle} rolünün varsayılan izinlerini yükle`}
          >
            <RotateCcw size={11} />
            <span>Varsayılan</span>
          </button>
        )}
      </div>

      {isAdminRole ? (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 9,
            background: 'var(--badge-clinic-bg, #e0f2fe)',
            border: '1px solid var(--badge-clinic-border, #bae6fd)',
            color: 'var(--badge-clinic-text, #0369a1)',
            fontSize: '0.76rem',
            fontWeight: 700,
            lineHeight: 1.45,
          }}
        >
          İşletme yöneticisi rolü tüm panel sekmelerine ve işlem yetkilerine tam erişime sahiptir.
        </div>
      ) : (
        <>
          {/* 1. Görünür Panel Sekmeleri */}
          <div>
            <div
              style={{
                fontSize: '0.73rem',
                fontWeight: 750,
                color: 'var(--foreground-2)',
                marginBottom: 7,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Görünür Panel Sekmeleri</span>
              <span
                style={{
                  fontSize: '0.66rem',
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: 'var(--badge-clinic-bg, #e0f2fe)',
                  border: '1px solid var(--badge-clinic-border, #bae6fd)',
                  color: 'var(--badge-clinic-text, #0369a1)',
                  fontWeight: 750,
                }}
              >
                {allowedTabs.length} sekme açık
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6,
              }}
            >
              {panelTabs.map((tab) => {
                const checked = allowedTabs.includes(tab.id)
                const isLastSelected = checked && allowedTabs.length === 1
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => toggleTab(tab.id)}
                    aria-pressed={checked}
                    title={isLastSelected ? 'En az bir sekme açık kalmalıdır' : undefined}
                    style={{
                      padding: '7px 9px',
                      borderRadius: 8,
                      border: checked
                        ? '1.5px solid var(--btn-clinic-outline-border, #3b82f6)'
                        : '1px solid var(--input-border)',
                      background: checked
                        ? 'var(--btn-clinic-outline-bg, #eff6ff)'
                        : 'var(--card-bg)',
                      color: checked
                        ? 'var(--btn-clinic-outline-text, #1d4ed8)'
                        : 'var(--foreground-2)',
                      boxShadow: checked ? 'var(--pc-clay-pale)' : 'var(--pc-clay-btn)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      cursor: isLastSelected ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                      fontSize: '0.73rem',
                      fontWeight: checked ? 750 : 600,
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 5,
                        background: checked ? '#2563eb' : 'var(--input-bg)',
                        border: checked ? '1px solid #1d4ed8' : '1px solid var(--input-border)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {checked && <Check size={11} color="#ffffff" strokeWidth={3} />}
                    </span>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tab.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 2. Veri Tabloları Yapılandırma Yetkisi */}
          <div
            style={{
              paddingTop: 10,
              borderTop: '1px solid var(--input-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div
              style={{
                fontSize: '0.73rem',
                fontWeight: 750,
                color: 'var(--foreground-2)',
                marginBottom: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{dynamicTabLabel || 'Veri Tabloları'} Yetkisi</span>
              <InfoTooltip title="Tablo ve Sütun Oluşturma Yetkisi">
                Bu yetki kapalıysa çalışan yalnızca mevcut tablolardaki kayıtlara veri ekleyebilir ve düzenleyebilir. Açıldığında solda ilişki şeması ile sağda tablo yan yana açılır; yeni tablo, sütun ve ilişki ekleme de görünür olur.
              </InfoTooltip>
            </div>

            {(() => {
              const checked = Boolean(staffPermissions.manageDynamicTables)
              return (
                <button
                  type="button"
                  onClick={() => toggleStaffPerm('manageDynamicTables')}
                  aria-pressed={checked}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: checked
                      ? '1px solid var(--btn-clinic-outline-border, #3b82f6)'
                      : '1px solid var(--input-border)',
                    background: checked
                      ? 'var(--btn-clinic-outline-bg, #eff6ff)'
                      : 'var(--card-bg)',
                    color: checked
                      ? 'var(--btn-clinic-outline-text, #1d4ed8)'
                      : 'var(--foreground)',
                    boxShadow: 'var(--pc-clay-btn)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '0.73rem',
                    fontWeight: checked ? 700 : 600,
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 5,
                      background: checked ? '#2563eb' : 'var(--input-bg)',
                      border: checked ? '1px solid #1d4ed8' : '1px solid var(--input-border)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {checked && <Check size={11} color="#ffffff" strokeWidth={3} />}
                  </span>
                  <span style={{ lineHeight: 1.3 }}>
                    Tablo ve sütun oluşturabilir, ilişki şemasını düzenleyebilir
                  </span>
                </button>
              )
            })()}
          </div>

          {/* 3. Klinik Personeli Sekmesi İşlem Yetkileri */}
          <div
            style={{
              paddingTop: 10,
              borderTop: '1px solid var(--input-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div
              style={{
                fontSize: '0.73rem',
                fontWeight: 750,
                color: 'var(--foreground-2)',
                marginBottom: 2,
              }}
            >
              İşletme Personeli İşlem Yetkileri
            </div>

            {STAFF_PERM_DEFS.map((perm) => {
              const checked = Boolean(staffPermissions[perm.key])
              return (
                <button
                  key={perm.key}
                  type="button"
                  onClick={() => toggleStaffPerm(perm.key)}
                  aria-pressed={checked}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: checked
                      ? '1px solid var(--btn-clinic-outline-border, #3b82f6)'
                      : '1px solid var(--input-border)',
                    background: checked
                      ? 'var(--btn-clinic-outline-bg, #eff6ff)'
                      : 'var(--card-bg)',
                    color: checked
                      ? 'var(--btn-clinic-outline-text, #1d4ed8)'
                      : 'var(--foreground)',
                    boxShadow: 'var(--pc-clay-btn)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '0.73rem',
                    fontWeight: checked ? 700 : 600,
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 5,
                      background: checked ? '#2563eb' : 'var(--input-bg)',
                      border: checked ? '1px solid #1d4ed8' : '1px solid var(--input-border)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {checked && <Check size={11} color="#ffffff" strokeWidth={3} />}
                  </span>
                  <span style={{ lineHeight: 1.3 }}>{perm.label}</span>
                </button>
              )
            })}
          </div>

          {/* 3. Opsiyonel: Bu rolün varsayılan şablonu olarak da güncelle */}
          {canUpdateRoleDefaults && onChangeSaveAsRoleDefault && (
            <label
              style={{
                marginTop: 2,
                padding: '7px 10px',
                borderRadius: 8,
                background: 'var(--card-bg)',
                border: '1px dashed var(--input-border)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                fontSize: '0.71rem',
                fontWeight: 650,
                color: 'var(--foreground-2)',
              }}
            >
              <input
                type="checkbox"
                checked={saveAsRoleDefault}
                onChange={(e) => onChangeSaveAsRoleDefault(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: '#2563eb', cursor: 'pointer', flexShrink: 0 }}
              />
              <span>
                Bu izinleri <strong>{roleTitle}</strong> rolünün varsayılan şablonu olarak da kaydet
              </span>
            </label>
          )}
        </>
      )}
    </div>
  )
}

