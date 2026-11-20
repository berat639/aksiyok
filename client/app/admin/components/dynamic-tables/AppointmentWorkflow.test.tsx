// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppointmentDynamicRecordsSection, {
  type AppointmentBookingContextData,
} from './AppointmentDynamicRecordsSection'
import AppointmentDetailDynamicEditor from './AppointmentDetailDynamicEditor'
import { classifyAppointmentTables } from './appointmentWorkflowHelpers'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('react-hot-toast', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

function buildSampleContext(): AppointmentBookingContextData {
  const patientsTableId = 'tbl-patients'
  const treatmentsTableId = 'tbl-treatments'
  const indicationsTableId = 'tbl-indications'
  const expenseTableId = 'tbl-expenses'

  const makeCol = (partial: any) => ({
    clinicId: 'clinic-1',
    width: 150,
    ...partial,
  })

  const colPatName = makeCol({
    id: 'col-pat-name',
    tableId: patientsTableId,
    name: 'Ad Soyad',
    slug: 'ad_soyad',
    fieldType: 'text' as const,
    isRequired: true,
    isUnique: false,
    isPrimaryTitle: true,
    showInTable: true,
    sortOrder: 0,
    config: {},
  })
  const colPatPhone = makeCol({
    id: 'col-pat-phone',
    tableId: patientsTableId,
    name: 'Telefon',
    slug: 'telefon',
    fieldType: 'phone' as const,
    isRequired: false,
    isUnique: false,
    isPrimaryTitle: false,
    showInTable: true,
    sortOrder: 1,
    config: {},
  })
  const colPatTc = makeCol({
    id: 'col-pat-tc',
    tableId: patientsTableId,
    name: 'TC Kimlik No',
    slug: 'tc_kimlik',
    fieldType: 'text' as const,
    isRequired: false,
    isUnique: false,
    isPrimaryTitle: false,
    showInTable: true,
    sortOrder: 2,
    config: {},
  })
  const colPatPlansRel = makeCol({
    id: 'col-pat-ind-rel',
    tableId: patientsTableId,
    name: 'Kayıtlı Endikasyonlar',
    slug: 'kayitli_endikasyonlar',
    fieldType: 'relation' as const,
    isRequired: false,
    isUnique: false,
    isPrimaryTitle: false,
    showInTable: true,
    sortOrder: 3,
    config: { targetTableId: indicationsTableId, relationId: 'rel-pat-ind', allowMultiple: true },
  })

  const colTrName = makeCol({
    id: 'col-tr-name',
    tableId: treatmentsTableId,
    name: 'İşlem Adı',
    slug: 'islem_adi',
    fieldType: 'text' as const,
    isRequired: true,
    isUnique: false,
    isPrimaryTitle: true,
    showInTable: true,
    sortOrder: 0,
    config: {},
  })
  const colTrStatus = makeCol({
    id: 'col-tr-status',
    tableId: treatmentsTableId,
    name: 'Durum',
    slug: 'durum',
    fieldType: 'select' as const,
    isRequired: false,
    isUnique: false,
    isPrimaryTitle: false,
    showInTable: true,
    sortOrder: 1,
    config: {
      options: [
        { id: 'planned', label: 'Planlandı', color: '#2563eb' },
        { id: 'done', label: 'Yapıldı', color: '#15803d' },
      ],
    },
  })
  const colTrPrice = makeCol({
    id: 'col-tr-price',
    tableId: treatmentsTableId,
    name: 'Ücret',
    slug: 'ucret',
    fieldType: 'currency' as const,
    isRequired: false,
    isUnique: false,
    isPrimaryTitle: false,
    showInTable: true,
    sortOrder: 2,
    config: { currencySymbol: '₺' },
  })
  const colTrNote = makeCol({
    id: 'col-tr-note',
    tableId: treatmentsTableId,
    name: 'Uygulama Notu',
    slug: 'uygulama_notu',
    fieldType: 'text' as const,
    isRequired: false,
    isUnique: false,
    isPrimaryTitle: false,
    showInTable: true,
    sortOrder: 3,
    config: {},
  })
  const colTrIndRel = makeCol({
    id: 'col-tr-ind-rel',
    tableId: treatmentsTableId,
    name: 'Bağlı Endikasyonlar',
    slug: 'bagli_endikasyonlar',
    fieldType: 'relation' as const,
    isRequired: false,
    isUnique: false,
    isPrimaryTitle: false,
    showInTable: true,
    sortOrder: 4,
    config: { targetTableId: indicationsTableId, relationId: 'rel-tr-ind', allowMultiple: true },
  })

  const colIndName = makeCol({
    id: 'col-ind-name',
    tableId: indicationsTableId,
    name: 'Endikasyon Adı',
    slug: 'endikasyon_adi',
    fieldType: 'text' as const,
    isRequired: true,
    isUnique: false,
    isPrimaryTitle: true,
    showInTable: true,
    sortOrder: 0,
    config: {},
  })

  const colExpTitle = makeCol({
    id: 'col-exp-title',
    tableId: expenseTableId,
    name: 'Gider Kalemi',
    slug: 'gider_kalemi',
    fieldType: 'text' as const,
    isRequired: true,
    isUnique: false,
    isPrimaryTitle: true,
    showInTable: true,
    sortOrder: 0,
    config: {},
  })

  const makeTableDef = (id: string, name: string, color: string, columns: any[]) => ({
    id,
    clinicId: 'clinic-1',
    name,
    slug: id,
    icon: 'table',
    color,
    description: null,
    canvasX: 0,
    canvasY: 0,
    sortOrder: 0,
    columns,
    rowCount: 1,
    archivedRowCount: 0,
  })

  const patRow = {
    id: 'row-pat-1',
    tableId: patientsTableId,
    displayTitle: 'Ayşe Demir',
    phone: '0532 411 22 33',
    values: {
      [colPatName.id]: 'Ayşe Demir',
      [colPatPhone.id]: '0532 411 22 33',
      [colPatTc.id]: '12345678901',
    },
  }

  const trRow = {
    id: 'row-tr-1',
    tableId: treatmentsTableId,
    displayTitle: 'Kompozit Dolgu',
    phone: null,
    values: {
      [colTrName.id]: 'Kompozit Dolgu',
      [colTrStatus.id]: 'planned',
      [colTrPrice.id]: 2500,
      [colTrNote.id]: '',
    },
  }

  const indRow = {
    id: 'row-ind-1',
    tableId: indicationsTableId,
    displayTitle: 'Derin Çürük',
    phone: null,
    values: { [colIndName.id]: 'Derin Çürük' },
  }

  const expRow = {
    id: 'row-exp-1',
    tableId: expenseTableId,
    displayTitle: 'Kira Gideri',
    phone: null,
    values: { [colExpTitle.id]: 'Kira Gideri' },
  }

  const patEntry = {
    table: makeTableDef(patientsTableId, 'Hastalar', '#0284c7', [
      colPatName,
      colPatPhone,
      colPatTc,
      colPatPlansRel,
    ]),
    moduleRole: null,
    config: {
      id: 'cfg-pat',
      tableId: patientsTableId,
      enabled: true,
      titleColumnId: colPatName.id,
      phoneColumnId: colPatPhone.id,
      emailColumnId: null,
      isRequiredInAppointment: true,
      allowMultiple: false,
      includeRelatedTables: true,
    },
    columns: [colPatName, colPatPhone, colPatTc, colPatPlansRel],
    rows: [patRow],
  }

  const trEntry = {
    table: makeTableDef(treatmentsTableId, 'Tedaviler', '#2563eb', [
      colTrName,
      colTrStatus,
      colTrPrice,
      colTrNote,
      colTrIndRel,
    ]),
    moduleRole: null,
    config: {
      id: 'cfg-tr',
      tableId: treatmentsTableId,
      enabled: true,
      titleColumnId: colTrName.id,
      phoneColumnId: null,
      emailColumnId: null,
      isRequiredInAppointment: false,
      allowMultiple: true,
      includeRelatedTables: true,
    },
    columns: [colTrName, colTrStatus, colTrPrice, colTrNote, colTrIndRel],
    rows: [trRow],
  }

  const indEntry = {
    table: makeTableDef(indicationsTableId, 'Endikasyonlar', '#0369a1', [colIndName]),
    moduleRole: null,
    config: null,
    columns: [colIndName],
    rows: [indRow],
  }

  const expEntry = {
    table: makeTableDef(expenseTableId, 'Klinik Giderleri', '#64748b', [colExpTitle]),
    moduleRole: 'finance_expense',
    config: null,
    columns: [colExpTitle],
    rows: [expRow],
  }

  return {
    hasAnyDynamicTables: true,
    linkedTables: [patEntry, trEntry],
    allTables: [patEntry, trEntry, indEntry, expEntry],
    relations: [
      {
        id: 'rel-tr-ind',
        clinicId: 'clinic-1',
        sourceTableId: treatmentsTableId,
        targetTableId: indicationsTableId,
        sourceColumnId: colTrIndRel.id,
        inverseColumnId: null,
        cardinality: 'many_to_many' as const,
        onDelete: 'set_null' as const,
      },
    ],
    rowLinks: [
      {
        relationId: 'rel-tr-ind',
        sourceRowId: trRow.id,
        targetRowId: indRow.id,
      },
    ],
  }
}

describe('Yeni Randevu (quick-create) & İnteraktif Randevu Detayı', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/rows/')) {
          return new Response(JSON.stringify({ id: 'row-tr-1', ok: true }), { status: 200 })
        }
        return new Response(JSON.stringify({}), { status: 200 })
      })
    )
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
  })

  it('quick-create modunda yalnızca randevuya bağlı tabloları gösterir, Diğer tabloları ve detay editörünü gizler', async () => {
    const ctx = buildSampleContext()

    await act(async () => {
      root.render(
        <AppointmentDynamicRecordsSection
          mode="quick-create"
          context={ctx}
          selectedIdsByTable={{ 'tbl-patients': ['row-pat-1'] }}
          onChangeSelectedIdsByTable={vi.fn()}
          onRefreshContext={vi.fn()}
        />
      )
    })

    const text = container.textContent || ''
    expect(text).toContain('Hastalar')
    expect(text).toContain('Tedaviler')
    expect(text).toContain('Ayşe Demir')
    expect(text).not.toContain('Diğer tablolar')
    expect(text).not.toContain('Klinik Giderleri Bağla')
    expect(text).not.toContain('Endikasyonlar Bağla')
    expect(text).not.toContain('Alanlar (')
    expect(text).not.toContain('Kayıtlı Endikasyonlar: + Bağla')

    // "+ Yeni Hastalar" hızlı formunda yalnızca temel/zorunlu alanlar (Ad Soyad, Telefon) görünmeli, TC Kimlik No gizlenmeli
    const addBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Yeni Hastalar')
    )
    expect(addBtn).toBeDefined()
    await act(async () => {
      addBtn!.click()
    })

    const afterText = container.textContent || ''
    expect(afterText).toContain('Hızlı Hastalar Ekle')
    expect(afterText).toContain('Ad Soyad')
    expect(afterText).toContain('Telefon')
    expect(afterText).not.toContain('TC Kimlik No')
    expect(afterText).not.toContain('Bağlantılı Tablo Alanları')
  })

  it('classifyAppointmentTables kişi tablosunu ayırır ve muhasebe/gider tablolarını iş akışına karıştırmaz', () => {
    const ctx = buildSampleContext()
    const { personEntry, workflowEntries } = classifyAppointmentTables(ctx, {})
    expect(personEntry?.table.id).toBe('tbl-patients')
    expect(workflowEntries.map((w) => w.table.id)).toEqual(['tbl-treatments', 'tbl-indications'])
  })

  it('AppointmentDetailDynamicEditor person ve workflow slotlarında interaktif kartları, Düzenle/Ekle/Tarih Belirle/Not akışını sunar', async () => {
    const ctx = buildSampleContext()
    const onLinksUpdated = vi.fn()

    await act(async () => {
      root.render(
        <div>
          <AppointmentDetailDynamicEditor
            slot="person"
            appointmentId="appt-1"
            initialDynamicLinks={[
              {
                tableId: 'tbl-patients',
                tableName: 'Hastalar',
                tableIcon: 'users',
                tableColor: '#0284c7',
                rowId: 'row-pat-1',
                displayTitle: 'Ayşe Demir',
                phone: '0532 411 22 33',
                email: null,
                values: {},
              },
              {
                tableId: 'tbl-treatments',
                tableName: 'Tedaviler',
                tableIcon: 'table',
                tableColor: '#2563eb',
                rowId: 'row-tr-1',
                displayTitle: 'Kompozit Dolgu',
                phone: null,
                email: null,
                values: {},
              },
            ]}
            sharedContext={ctx}
            onAppointmentLinksUpdated={onLinksUpdated}
          />
          <AppointmentDetailDynamicEditor
            slot="workflow"
            appointmentId="appt-1"
            initialDynamicLinks={[
              {
                tableId: 'tbl-patients',
                tableName: 'Hastalar',
                tableIcon: 'users',
                tableColor: '#0284c7',
                rowId: 'row-pat-1',
                displayTitle: 'Ayşe Demir',
                phone: '0532 411 22 33',
                email: null,
                values: {},
              },
              {
                tableId: 'tbl-treatments',
                tableName: 'Tedaviler',
                tableIcon: 'table',
                tableColor: '#2563eb',
                rowId: 'row-tr-1',
                displayTitle: 'Kompozit Dolgu',
                phone: null,
                email: null,
                values: {},
              },
            ]}
            sharedContext={ctx}
            events={[]}
            doctors={[]}
            shifts={[]}
            doctorLeaves={[]}
            onAppointmentLinksUpdated={onLinksUpdated}
          />
        </div>
      )
    })

    const htmlText = container.textContent || ''
    expect(htmlText).toContain('Ayşe Demir')
    expect(htmlText).toContain('Kompozit Dolgu')
    expect(htmlText).toContain('2.500')
    expect(htmlText).toContain('Bağlı Endikasyonlar: Derin Çürük')
    expect(htmlText).toContain('Uygulama Notu ekle…')
    expect(htmlText).toContain('Tarih / Randevu Belirle')
    expect(htmlText).toContain('Düzenle')
    expect(htmlText).toContain('Ekle')

    // Durum select değişikliği PUT isteği tetiklemeli
    const statusSelect = container.querySelector('select') as HTMLSelectElement | null
    expect(statusSelect).not.toBeNull()
    await act(async () => {
      statusSelect!.value = 'done'
      statusSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect((globalThis.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes('/rows/row-tr-1'))).toBe(true)

    // "+ Ekle" butonu Workflow Record Modal'ını açmalı
    const addBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Ekle'
    )
    expect(addBtn).toBeDefined()
    await act(async () => {
      addBtn!.click()
    })
    expect(document.body.textContent).toContain('İşlem / Akış Kaydı Ekle')
  })
})
