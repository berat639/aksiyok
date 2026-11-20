import type {
  DynamicAppointmentConfigDef,
  DynamicFieldType,
  DynamicTableDef,
} from './types'

export type TablePurpose = 'person' | 'service' | 'detail'
export type AppointmentUsageMode = 'off' | 'person' | 'service'

export type StarterBlueprintKey =
  | 'real_estate_appointment'
  | 'insurance_quote'
  | 'consultant_sessions'
  | 'vehicle_service'
  | 'dental_clinic'
  | 'customer_service'

export const STARTER_BLUEPRINTS: Array<{
  key: StarterBlueprintKey
  sectorBadge: string
  title: string
  subtitle: string
}> = [
  {
    key: 'customer_service',
    sectorBadge: 'Genel İşletme',
    title: 'Müşteri & Talep / Hizmet Yönetimi',
    subtitle: 'Her sektöre uyumlu müşteri kartları ve çoklu talep/hizmet takibi',
  },
  {
    key: 'real_estate_appointment',
    sectorBadge: 'Emlak',
    title: 'Emlak Gösterim & Randevu Kurgusu',
    subtitle: 'Alıcı/kiracı adayları, ilan linkli portföy ilanları, mülk sahipleri ve gayrimenkul özellikleri hazır gelir',
  },
  {
    key: 'insurance_quote',
    sectorBadge: 'Sigorta',
    title: 'Sigorta Teklif & Poliçe Görüşmesi',
    subtitle: 'Sigortalı müşteriler, kasko/sağlık teklifleri, sigorta şirketleri ve ek teminatlar hazır gelir',
  },
  {
    key: 'consultant_sessions',
    sectorBadge: 'Danışmanlık',
    title: 'Danışmanlık & Hizmet Paketleri',
    subtitle: 'Danışanlar ve çoklu seans/program paketleri örnek kayıtlarla kurulur',
  },
  {
    key: 'vehicle_service',
    sectorBadge: 'Servis / Oto',
    title: 'Teknik Servis & Araç / Cihaz Takibi',
    subtitle: 'Müşteriler, servis işlemleri ve plakalı araç/cihaz kayıtları birbirine bağlanır',
  },
  {
    key: 'dental_clinic',
    sectorBadge: 'Klinik',
    title: 'Klinik Hasta & Tedavi Planı Kurgusu',
    subtitle: 'Hastalar, tedavi planları (odontogram diş/yüzey/katman, iskonto, TDB kontrol, röntgen & onam), tedaviler, endikasyonlar, malzemeler ve çalışan/hekimler tam bağlantılı kurulur',
  },
]

export function samplePreviewTitle(tableName: string, idx: 1 | 2): string {
  const lower = tableName.toLocaleLowerCase('tr-TR')
  if (
    lower.includes('aday') ||
    lower.includes('alıcı') ||
    lower.includes('kiracı') ||
    lower.includes('müşteri') ||
    lower.includes('sigortalı') ||
    lower.includes('danışan') ||
    lower.includes('hasta') ||
    lower.includes('kişi')
  ) {
    return idx === 1 ? 'Caner Yıldız' : 'Zeynep Arslan'
  }
  if (lower.includes('ilan') || lower.includes('portföy') || lower.includes('konut') || lower.includes('daire')) {
    return idx === 1 ? 'Moda 3+1 Daire' : 'Ataşehir 2+1 Rezidans'
  }
  if (lower.includes('mülk') || lower.includes('sahib')) {
    return idx === 1 ? 'Hakan Özdemir' : 'Selin Karaca'
  }
  if (lower.includes('özellik')) {
    return idx === 1 ? 'Kapalı Otopark' : 'Krediye Uygun'
  }
  if (lower.includes('teklif') || lower.includes('poliçe') || lower.includes('branş')) {
    return idx === 1 ? 'Genişletilmiş Kasko Teklifi' : 'Tamamlayıcı Sağlık Sigortası'
  }
  if (lower.includes('şirket') || lower.includes('acente')) {
    return idx === 1 ? 'Allianz Sigorta' : 'Anadolu Sigorta'
  }
  if (lower.includes('teminat')) {
    return idx === 1 ? 'İkame Araç (15 Gün)' : 'Cam Muafiyetsiz'
  }
  if (lower.includes('araç') || lower.includes('plaka')) {
    return idx === 1 ? '34 ABC 482' : '06 TRK 214'
  }
  if (lower.includes('cihaz')) {
    return idx === 1 ? 'Cihaz #1' : 'Cihaz #2'
  }
  if (lower.includes('paket') || lower.includes('program')) {
    return idx === 1 ? '8 Seans Danışmanlık Paketi' : 'Kurumsal Paket'
  }
  if (lower.includes('hekim') || lower.includes('doktor')) {
    return idx === 1 ? 'Dt. Selin Yılmaz' : 'Uzm. Dt. Emre Arslan'
  }
  if (lower.includes('plan')) {
    return idx === 1 ? 'Tedavi Planı — Diş #36 Kompozit Dolgu' : 'Tedavi Planı — Diş #46 İmplant'
  }
  if (lower.includes('tedavi')) {
    return idx === 1 ? 'Kompozit Dolgu (Tek Yüzey)' : 'Kanal Tedavisi (Tek Kanal)'
  }
  if (lower.includes('malzeme')) {
    return idx === 1 ? 'Kompozit Rezin' : 'Guta Perka Kon'
  }
  if (lower.includes('endikasyon')) {
    return idx === 1 ? 'Derin Dentin Çürüğü' : 'İrreversible Pulpitis'
  }
  if (lower.includes('işlem') || lower.includes('hizmet') || lower.includes('talep')) {
    return idx === 1 ? 'Standart Hizmet Paketi' : 'Yerinde Keşif & Görüşme'
  }
  return `${tableName} Örnek ${idx}`
}

export const TABLE_PURPOSE_OPTIONS: Array<{
  key: TablePurpose
  label: string
  shortHint: string
  placeholder: string
}> = [
  {
    key: 'person',
    label: 'Kişi / Müşteri Listesi',
    shortHint: 'Ad Soyad + Telefon ile açılır, takvimde randevu kişisi olur',
    placeholder: 'Liste adı (Örn: Müşteriler, Adaylar, Sigortalılar)…',
  },
  {
    key: 'service',
    label: 'Hizmet / Teklif / İlan Listesi',
    shortHint: 'Başlık + Tutar ile açılır, takvimde çoklu seçim olur',
    placeholder: 'Liste adı (Örn: Portföy İlanları, Sigorta Teklifleri, Hizmetler)…',
  },
  {
    key: 'detail',
    label: 'Detay / Alt Liste',
    shortHint: 'Başka bir tabloya bağlanacak yardımcı liste',
    placeholder: 'Liste adı (Örn: Ek Teminatlar, Mülk Sahipleri, Özellikler)…',
  },
]

export function getInitialColumnsForPurpose(purpose: TablePurpose): Array<{
  name: string
  fieldType: DynamicFieldType
  isPrimaryTitle?: boolean
  isRequired?: boolean
  width?: number
}> {
  if (purpose === 'person') {
    return [
      { name: 'Ad Soyad', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 220 },
      { name: 'Telefon', fieldType: 'phone', isPrimaryTitle: false, isRequired: false, width: 175 },
    ]
  }
  if (purpose === 'service') {
    return [
      { name: 'İşlem / Hizmet Adı', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 230 },
      { name: 'Ücret', fieldType: 'currency', isPrimaryTitle: false, isRequired: false, width: 145 },
    ]
  }
  return [
    { name: 'Ad / Başlık', fieldType: 'text', isPrimaryTitle: true, isRequired: true, width: 220 },
  ]
}

export function resolveAutoColumnMapping(table: DynamicTableDef): {
  titleColumnId: string | null
  phoneColumnId: string | null
  emailColumnId: string | null
} {
  const nonRel = (table.columns || []).filter((c) => c.fieldType !== 'relation')
  const titleColumnId = nonRel.find((c) => c.isPrimaryTitle)?.id || nonRel[0]?.id || null
  const phoneColumnId = nonRel.find((c) => c.fieldType === 'phone')?.id || null
  const emailColumnId = nonRel.find((c) => c.fieldType === 'email')?.id || null
  return { titleColumnId, phoneColumnId, emailColumnId }
}

export function getAppointmentUsageMode(
  config: DynamicAppointmentConfigDef | null | undefined
): AppointmentUsageMode {
  if (!config || !config.enabled) return 'off'
  return config.allowMultiple ? 'service' : 'person'
}

export async function saveTableAppointmentUsageMode(
  table: DynamicTableDef,
  mode: AppointmentUsageMode,
  options?: {
    isRequiredInAppointment?: boolean
    existingConfig?: DynamicAppointmentConfigDef | null
  }
): Promise<void> {
  if (mode === 'off') {
    const res = await fetch(`/api/dynamic-tables/appointment-configs/${table.id}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Takvim ayarı kapatılamadı')
    }
    return
  }

  const autoMap = resolveAutoColumnMapping(table)
  const existing = options?.existingConfig
  const allowMultiple = mode === 'service'
  const defaultRequired = mode === 'person'
  const isRequiredInAppointment =
    options?.isRequiredInAppointment !== undefined
      ? options.isRequiredInAppointment
      : existing
        ? existing.isRequiredInAppointment
        : defaultRequired

  const res = await fetch(`/api/dynamic-tables/appointment-configs/${table.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enabled: true,
      allowMultiple,
      includeRelatedTables: true,
      isRequiredInAppointment,
      titleColumnId: existing?.titleColumnId || autoMap.titleColumnId,
      phoneColumnId: existing?.phoneColumnId || autoMap.phoneColumnId,
      emailColumnId: existing?.emailColumnId || autoMap.emailColumnId,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Takvim bağlantısı kaydedilemedi')
  }
}

export async function createDynamicTableWithPurpose(
  rawName: string,
  purpose: TablePurpose
): Promise<DynamicTableDef> {
  const clean = rawName.trim()
  if (!clean) {
    throw new Error('Lütfen liste adını yazınız')
  }

  const res = await fetch('/api/dynamic-tables/tables', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: clean,
      initialColumns: getInitialColumnsForPurpose(purpose),
    }),
  })
  const created = await res.json()
  if (!res.ok) {
    throw new Error(created.error || 'Tablo oluşturulamadı')
  }

  if (purpose === 'person' || purpose === 'service') {
    await saveTableAppointmentUsageMode(created as DynamicTableDef, purpose, {
      isRequiredInAppointment: purpose === 'person',
    })
  }

  return created as DynamicTableDef
}

