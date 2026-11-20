import { describe, expect, it } from 'vitest'
import type { DynamicTableDef } from '@/app/admin/components/dynamic-tables/types'
import {
  DYNAMIC_TABLE_ROW_EXISTS_COL_ID,
  applyDynamicColumnToFieldData,
  buildBooleanFieldSet,
  buildDynamicFieldKey,
  buildDynamicTableExistsKey,
  buildFieldLabelMap,
  evaluateLocalConditionNode,
  formatDynamicColumnDisplayLabel,
  formatDynamicTableIcon,
  getOperatorsForFieldKind,
  inferConditionFieldKind,
  mapDynamicColumnToFlowField,
  parseComparableNumberOrDate,
  resolveDynamicColumnMeta,
  sanitizeFlowSlug,
} from './flow-dynamic-fields'

const SAMPLE_TABLES: DynamicTableDef[] = [
  {
    id: 'tbl_customers',
    clinicId: 'clinic_1',
    name: 'Müşteriler',
    slug: 'musteriler',
    description: null,
    icon: '👥',
    color: '#2563eb',
    canvasX: 100,
    canvasY: 100,
    sortOrder: 0,
    rowCount: 12,
    archivedRowCount: 0,
    columns: [
      {
        id: 'col_name',
        clinicId: 'clinic_1',
        tableId: 'tbl_customers',
        name: 'Ad Soyad',
        slug: 'ad_soyad',
        fieldType: 'text',
        isPrimaryTitle: true,
        isRequired: true,
        isUnique: false,
        showInTable: true,
        width: 200,
        sortOrder: 0,
        config: {},
      },
      {
        id: 'col_vip',
        clinicId: 'clinic_1',
        tableId: 'tbl_customers',
        name: 'Özel Üye mi?',
        slug: 'ozel_uye_mi',
        fieldType: 'boolean',
        isPrimaryTitle: false,
        isRequired: false,
        isUnique: false,
        showInTable: true,
        width: 140,
        sortOrder: 1,
        config: {},
      },
      {
        id: 'col_segment',
        clinicId: 'clinic_1',
        tableId: 'tbl_customers',
        name: 'Müşteri Grubu',
        slug: 'musteri_grubu',
        fieldType: 'select',
        isPrimaryTitle: false,
        isRequired: false,
        isUnique: false,
        showInTable: true,
        width: 160,
        sortOrder: 2,
        config: {
          options: [
            { id: 'opt_altin', label: 'Altın', color: '#f59e0b' },
            { id: 'opt_gumus', label: 'Gümüş', color: '#64748b' },
          ],
        },
      },
    ],
  },
  {
    id: 'tbl_survey',
    clinicId: 'clinic_1',
    name: 'Memnuniyet Anketi',
    slug: 'memnuniyet_anketi',
    description: null,
    icon: '📋',
    color: '#16a34a',
    canvasX: 400,
    canvasY: 100,
    sortOrder: 1,
    rowCount: 5,
    archivedRowCount: 0,
    columns: [
      {
        id: 'col_score',
        clinicId: 'clinic_1',
        tableId: 'tbl_survey',
        name: 'Puan (1-10)',
        slug: 'puan',
        fieldType: 'number',
        isPrimaryTitle: false,
        isRequired: true,
        isUnique: false,
        showInTable: true,
        width: 140,
        sortOrder: 0,
        config: {},
      },
      {
        id: 'col_budget',
        clinicId: 'clinic_1',
        tableId: 'tbl_survey',
        name: 'Bütçe',
        slug: 'butce',
        fieldType: 'currency',
        isPrimaryTitle: false,
        isRequired: false,
        isUnique: false,
        showInTable: true,
        width: 150,
        sortOrder: 1,
        config: { currencySymbol: '₺' },
      },
      {
        id: 'col_tags',
        clinicId: 'clinic_1',
        tableId: 'tbl_survey',
        name: 'İlgilenilen İşlemler',
        slug: 'ilgilenilen_islemler',
        fieldType: 'multiselect',
        isPrimaryTitle: false,
        isRequired: false,
        isUnique: false,
        showInTable: true,
        width: 200,
        sortOrder: 2,
        config: {
          options: [
            { id: 't1', label: 'İmplant', color: '#2563eb' },
            { id: 't2', label: 'Zirkonyum', color: '#0284c7' },
          ],
        },
      },
      {
        id: 'col_followup_date',
        clinicId: 'clinic_1',
        tableId: 'tbl_survey',
        name: 'Kontrol Tarihi',
        slug: 'kontrol_tarihi',
        fieldType: 'date',
        isPrimaryTitle: false,
        isRequired: false,
        isUnique: false,
        showInTable: true,
        width: 160,
        sortOrder: 3,
        config: {},
      },
      {
        id: 'col_doctor_rel',
        clinicId: 'clinic_1',
        tableId: 'tbl_survey',
        name: 'Sorumlu Hekim',
        slug: 'sorumlu_hekim',
        fieldType: 'relation',
        isPrimaryTitle: false,
        isRequired: false,
        isUnique: false,
        showInTable: true,
        width: 180,
        sortOrder: 4,
        config: {
          targetTableId: 'tbl_doctors',
          allowMultiple: false,
        },
      },
      {
        id: 'col_pkg_rel',
        clinicId: 'clinic_1',
        tableId: 'tbl_survey',
        name: 'Tedavi Paketleri',
        slug: 'tedavi_paketleri',
        fieldType: 'relation',
        isPrimaryTitle: false,
        isRequired: false,
        isUnique: false,
        showInTable: true,
        width: 200,
        sortOrder: 5,
        config: {
          targetTableId: 'tbl_packages',
          allowMultiple: true,
        },
      },
    ],
  },
]

describe('flow-dynamic-fields', () => {
  it('Türkçe tablo ve sütun adlarından temiz tanımlayıcı üretir', () => {
    expect(sanitizeFlowSlug('Müşteri Anketi (2026)')).toBe('musteri_anketi_2026')
    expect(sanitizeFlowSlug('   ')).toBe('')
    expect(buildDynamicFieldKey('Müşteriler', 'Ad Soyad')).toBe('musteriler__ad_soyad')
    expect(formatDynamicColumnDisplayLabel('Müşteriler', 'Ad Soyad')).toBe('Müşteriler · Ad Soyad')
  })

  it('dinamik tablo veya sütun değiştirildiğinde AI Sorusu (description) alanına KESİNLİKLE dokunmaz', () => {
    const customQuestion = 'Kliniğimizdeki son deneyiminizi 1 ile 10 arasında nasıl değerlendirirsiniz?'
    const initialNodeData = {
      label: 'Eski Etiket',
      fieldName: 'eski_alan',
      description: customQuestion,
      required: true,
      fieldType: 'text' as const,
    }

    // 1. Müşteriler -> Müşteri Grubu sütununa geçiş
    const afterSelectCol = applyDynamicColumnToFieldData(
      initialNodeData,
      SAMPLE_TABLES[0],
      SAMPLE_TABLES[0].columns[2],
    )
    expect(afterSelectCol.fieldName).toBe('musteriler__musteri_grubu')
    expect(afterSelectCol.label).toBe('Müşteriler · Müşteri Grubu')
    expect(afterSelectCol.fieldType).toBe('enum')
    expect(afterSelectCol.enumValues).toEqual(['Altın', 'Gümüş'])
    expect(afterSelectCol.description).toBe(customQuestion)

    // 2. Memnuniyet Anketi -> Puan sütununa geçiş
    const afterNumberCol = applyDynamicColumnToFieldData(
      afterSelectCol,
      SAMPLE_TABLES[1],
      SAMPLE_TABLES[1].columns[0],
    )
    expect(afterNumberCol.fieldName).toBe('memnuniyet_anketi__puan')
    expect(afterNumberCol.label).toBe('Memnuniyet Anketi · Puan (1-10)')
    expect(afterNumberCol.fieldType).toBe('number')
    expect(afterNumberCol.description).toBe(customQuestion)

    // 3. Boş AI sorusu da boş kalır; otomatik soru yazılmaz
    const emptyDescApplied = applyDynamicColumnToFieldData(
      { ...initialNodeData, description: '' },
      SAMPLE_TABLES[0],
      SAMPLE_TABLES[0].columns[0],
    )
    expect(emptyDescApplied.description).toBe('')
    expect('description' in mapDynamicColumnToFlowField(SAMPLE_TABLES[0], SAMPLE_TABLES[0].columns[0])).toBe(false)
  })

  it('resolveDynamicColumnMeta hem ID ipucuyla hem de alan anahtarıyla sütunu bulur', () => {
    const byHint = resolveDynamicColumnMeta('', SAMPLE_TABLES, {
      sourceTableId: 'tbl_survey',
      sourceColumnId: 'col_tags',
    })
    expect(byHint?.fieldKey).toBe('memnuniyet_anketi__ilgilenilen_islemler')
    expect(byHint?.options).toEqual(['İmplant', 'Zirkonyum'])

    const byKey = resolveDynamicColumnMeta('musteriler__ozel_uye_mi', SAMPLE_TABLES)
    expect(byKey?.column.id).toBe('col_vip')
    expect(byKey?.flowFieldType).toBe('boolean')
  })

  it('sütun veri tipine göre doğru karşılaştırma operatörlerini filtreler', () => {
    const allOps = [
      { value: 'equals', label: 'eşitse' },
      { value: 'notEquals', label: 'farklıysa' },
      { value: 'contains', label: 'içeriyorsa' },
      { value: 'gt', label: 'büyükse' },
      { value: 'between', label: 'arasındaysa' },
      { value: 'isEmpty', label: 'boşsa' },
    ]
    const boolSet = buildBooleanFieldSet([], SAMPLE_TABLES)
    expect(boolSet.has('musteriler__ozel_uye_mi')).toBe(true)

    const boolKind = inferConditionFieldKind({
      field: 'musteriler__ozel_uye_mi',
      booleanFields: boolSet,
    })
    expect(boolKind).toBe('boolean')
    const boolOps = getOperatorsForFieldKind(boolKind, allOps).map(o => o.value)
    expect(boolOps).toEqual(['equals', 'notEquals', 'isEmpty', 'notEmpty'].filter(v => allOps.some(o => o.value === v)))

    const numKind = inferConditionFieldKind({
      field: 'memnuniyet_anketi__butce',
      dynamicColumnType: 'currency',
    })
    expect(numKind).toBe('number')
    const numOps = getOperatorsForFieldKind(numKind, allOps).map(o => o.value)
    expect(numOps).toContain('gt')
    expect(numOps).toContain('between')
    expect(numOps).not.toContain('contains')
  })

  it('yerel koşul değerlendirici çoklu kuralları, para birimini, tarihi ve çoklu seçimi doğru hesaplar', () => {
    const fields = {
      musteriler__ozel_uye_mi: 'Evet',
      memnuniyet_anketi__puan: '9',
      memnuniyet_anketi__butce: '2.500,50 ₺',
      memnuniyet_anketi__ilgilenilen_islemler: ['İmplant', 'Zirkonyum'],
      memnuniyet_anketi__kontrol_tarihi: '15.11.2026',
    }

    expect(
      evaluateLocalConditionNode(
        {
          conditionLogic: 'AND',
          rules: [
            { field: 'musteriler__ozel_uye_mi', operator: 'equals', value: 'true' },
            { field: 'memnuniyet_anketi__puan', operator: 'gte', value: '8' },
            { field: 'memnuniyet_anketi__butce', operator: 'gt', value: '2000' },
            { field: 'memnuniyet_anketi__ilgilenilen_islemler', operator: 'contains', value: 'İmplant' },
            { field: 'memnuniyet_anketi__kontrol_tarihi', operator: 'between', value: '2026-11-01', valueTo: '2026-11-30' },
          ],
        },
        fields,
      ),
    ).toBe(true)

    expect(
      evaluateLocalConditionNode(
        {
          conditionLogic: 'AND',
          rules: [
            { field: 'musteriler__ozel_uye_mi', operator: 'equals', value: 'true' },
            { field: 'memnuniyet_anketi__puan', operator: 'lt', value: '5' },
          ],
        },
        fields,
      ),
    ).toBe(false)

    const labelMap = buildFieldLabelMap([], SAMPLE_TABLES)
    expect(labelMap['memnuniyet_anketi__puan']).toBe('Memnuniyet Anketi · Puan (1-10)')
  })

  it('relation (Başka Tablodan Seçim) sütunlarında bağlı tablo başlıklarını seçenek olarak yükler ve AI Sorusunu korur', () => {
    const relationTitles = {
      tbl_doctors: ['Dr. Ayşe Yılmaz', 'Dr. Burak Demir', 'İsimsiz Kayıt'],
      tbl_packages: ['İmplant Paketi', 'Ortodonti Paketi'],
    }
    const relCol = SAMPLE_TABLES[1].columns.find(c => c.id === 'col_doctor_rel')!
    const multiRelCol = SAMPLE_TABLES[1].columns.find(c => c.id === 'col_pkg_rel')!

    const customQuestion = 'Sizi takip eden hekimimizin adını biliyor musunuz?'
    const applied = applyDynamicColumnToFieldData(
      { label: 'Eski', fieldName: 'eski', description: customQuestion, required: true, fieldType: 'text' },
      SAMPLE_TABLES[1],
      relCol,
      relationTitles,
    )
    expect(applied.fieldName).toBe('memnuniyet_anketi__sorumlu_hekim')
    expect(applied.fieldType).toBe('enum')
    expect(applied.enumValues).toEqual(['Dr. Ayşe Yılmaz', 'Dr. Burak Demir'])
    expect(applied.description).toBe(customQuestion)

    // Hedef tabloda henüz satır yoksa text alanına düşer
    const emptyRel = mapDynamicColumnToFlowField(SAMPLE_TABLES[1], relCol, {})
    expect(emptyRel.fieldType).toBe('text')
    expect(emptyRel.enumValues).toBeUndefined()

    const meta = resolveDynamicColumnMeta('memnuniyet_anketi__tedavi_paketleri', SAMPLE_TABLES, undefined, relationTitles)
    expect(meta?.options).toEqual(['İmplant Paketi', 'Ortodonti Paketi'])
    expect(meta?.samples).toEqual(['İmplant Paketi', 'Ortodonti Paketi'])

    expect(
      inferConditionFieldKind({
        field: 'memnuniyet_anketi__sorumlu_hekim',
        dynamicColumnType: 'relation',
        dynamicColumnAllowMultiple: false,
      }),
    ).toBe('select')

    expect(
      inferConditionFieldKind({
        field: 'memnuniyet_anketi__tedavi_paketleri',
        dynamicColumnType: 'relation',
        dynamicColumnAllowMultiple: true,
      }),
    ).toBe('multiselect')

    expect(
      evaluateLocalConditionNode(
        {
          conditionLogic: 'AND',
          rules: [
            { field: 'memnuniyet_anketi__sorumlu_hekim', operator: 'equals', value: 'Dr. Ayşe Yılmaz' },
            { field: 'memnuniyet_anketi__tedavi_paketleri', operator: 'contains', value: 'Ortodonti Paketi' },
          ],
        },
        {
          memnuniyet_anketi__sorumlu_hekim: 'Dr. Ayşe Yılmaz',
          memnuniyet_anketi__tedavi_paketleri: ['İmplant Paketi', 'Ortodonti Paketi'],
        },
      ),
    ).toBe(true)

    // Virgülle ayrılmış çoklu seçim metinleri, sourceColumnId (_col__) yedeklemesi ve sayısal notEquals uyumu
    expect(
      evaluateLocalConditionNode(
        {
          conditionLogic: 'AND',
          rules: [
            {
              field: 'eski_tablo__eski_sutun',
              sourceColumnId: 'col_renamed_1',
              operator: 'equals',
              value: 'Ortodonti Paketi',
            },
            {
              field: 'memnuniyet_anketi__tedavi_paketleri',
              operator: 'in',
              value: 'Beyazlatma, İmplant Paketi',
            },
            {
              field: 'memnuniyet_anketi__butce',
              operator: 'between',
              value: '1000 - 3000',
            },
          ],
        },
        {
          _col__col_renamed_1: 'İmplant Paketi, Ortodonti Paketi',
          memnuniyet_anketi__tedavi_paketleri: 'İmplant Paketi, Kanal',
          memnuniyet_anketi__butce: '1.500,00 ₺',
        },
      ),
    ).toBe(true)

    expect(
      evaluateLocalConditionNode(
        {
          conditionField: 'memnuniyet_anketi__butce',
          operator: 'notEquals',
          conditionValue: '1500',
        },
        { memnuniyet_anketi__butce: '1.500,00 ₺' },
      ),
    ).toBe(false)
  })

  it('metin/telefon/e-posta sütunlarında sayısal operatörlere izin vermez ve Lucide ikon adlarını emojiye çevirir', () => {
    expect(formatDynamicTableIcon('box')).toBe('📦')
    expect(formatDynamicTableIcon('users')).toBe('👥')
    expect(formatDynamicTableIcon('unknown_icon_key')).toBe('📊')
    expect(formatDynamicTableIcon('🏥')).toBe('🏥')

    const allOps = [
      { value: 'equals', label: 'eşitse' },
      { value: 'notEquals', label: 'eşit değilse' },
      { value: 'contains', label: 'içeriyorsa' },
      { value: 'startsWith', label: 'ile başlıyorsa' },
      { value: 'endsWith', label: 'ile bitiyorsa' },
      { value: 'gt', label: 'büyükse' },
      { value: 'gte', label: 'en az' },
      { value: 'lt', label: 'küçükse' },
      { value: 'lte', label: 'en fazla' },
      { value: 'between', label: 'arasındaysa' },
      { value: 'existsInTable', label: 'tabloda kayıtlıysa' },
      { value: 'notExistsInTable', label: 'tabloda kayıtlı değilse' },
      { value: 'isEmpty', label: 'cevap verilmediyse' },
    ]

    for (const colType of ['text', 'phone', 'email', 'select'] as const) {
      const kind = inferConditionFieldKind({
        field: `stok__${colType}`,
        dynamicColumnType: colType,
      })
      // Eski kuralda 'gt' kalmış olsa dahi sızmamalı
      const ops = getOperatorsForFieldKind(kind, allOps, 'gt').map(o => o.value)
      expect(ops).not.toContain('gt')
      expect(ops).not.toContain('gte')
      expect(ops).not.toContain('lt')
      expect(ops).not.toContain('lte')
      expect(ops).not.toContain('between')
    }

    // Sistem alanlarında (tablo bağlamı yokken) tablo varlık operatörleri gizlenir
    const sysOps = getOperatorsForFieldKind('text', allOps, undefined, { hasTableContext: false }).map(o => o.value)
    expect(sysOps).not.toContain('existsInTable')
    expect(sysOps).not.toContain('notExistsInTable')
  })

  it('tablo varlık koşulunu (__row_exists__), existsInTable, HH:MM saat ve Türkçe gün karşılaştırmalarını hesaplar', () => {
    const existsKey = buildDynamicTableExistsKey('urun_stok')
    expect(existsKey).toBe('urun_stok____kayitli')
    expect(
      inferConditionFieldKind({
        field: existsKey,
        sourceColumnId: DYNAMIC_TABLE_ROW_EXISTS_COL_ID,
      }),
    ).toBe('table_exists')

    const labels = buildFieldLabelMap([], SAMPLE_TABLES)
    expect(labels['musteriler____kayitli']).toBe('Müşteriler · Bu tabloda kayıtlı mı?')
    expect(buildBooleanFieldSet([], SAMPLE_TABLES).has('musteriler____kayitli')).toBe(true)

    expect(parseComparableNumberOrDate('14:30')).toBe(14.5)
    expect(
      evaluateLocalConditionNode(
        {
          conditionLogic: 'AND',
          rules: [
            { field: 'musteriler____kayitli', operator: 'equals', value: 'true', sourceTableId: 'tbl_customers', sourceColumnId: DYNAMIC_TABLE_ROW_EXISTS_COL_ID },
            { field: 'stok__kalem', operator: 'existsInTable', sourceColumnId: 'col_item' },
            { field: 'stok__kod', operator: 'notExistsInTable', sourceColumnId: 'col_code' },
            { field: 'stok__kod', operator: 'endsWith', value: '-VIP' },
            { field: 'time.hour', operator: 'between', value: '09:00', valueTo: '18:00' },
            { field: 'time.weekday', operator: 'in', value: 'Pazartesi, Çarşamba' },
          ],
        },
        {
          _tbl_exists__tbl_customers: 'true',
          _col_exists__col_item: 'true',
          _col_exists__col_code: 'false',
          stok__kod: 'IMP-100-VIP',
          'time.hour': '14:30',
          'time.weekday': '1',
        },
      ),
    ).toBe(true)
  })
})
