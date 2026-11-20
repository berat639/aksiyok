// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DynamicTableDef } from './dynamic-tables/types'
import {
  buildDynamicSampleFlow,
  inferClinicDynamicProfile,
  rebindLegacyNodesToDynamicTables,
} from '../../../lib/flow-dynamic-fields'

// React 19 act() ortam işareti
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@xyflow/react', () => {
  return {
    ReactFlow: ({ nodes = [], nodeTypes = {}, onNodeClick, children }: any) => (
      <div data-testid="mock-reactflow">
        {nodes.map((n: any) => {
          const Comp = nodeTypes[n.type]
          return (
            <div
              key={n.id}
              data-testid={`rf-node-${n.id}`}
              onClick={e => onNodeClick?.(e, n)}
            >
              {Comp ? <Comp id={n.id} data={n.data} selected={Boolean(n.selected)} /> : n.id}
            </div>
          )
        })}
        {children}
      </div>
    ),
    Background: () => <div data-testid="rf-bg" />,
    Controls: () => <div data-testid="rf-controls" />,
    Handle: () => <span data-testid="rf-handle" />,
    Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    useNodesState: (initial: any[]) => {
      const [nodes, setNodes] = useState(initial)
      return [nodes, setNodes, vi.fn()] as const
    },
    useEdgesState: (initial: any[]) => {
      const [edges, setEdges] = useState(initial)
      return [edges, setEdges, vi.fn()] as const
    },
    addEdge: (edge: any, eds: any[]) => [...eds, edge],
  }
})

vi.mock('@xyflow/react/dist/style.css', () => ({}))
vi.mock('./flow/SimulatorVoicePanel', () => ({
  default: () => <div data-testid="mock-voice-panel" />,
}))

import FlowBuilder from './FlowBuilder'

const MOCK_TABLES: DynamicTableDef[] = [
  {
    id: 'tbl_customers',
    clinicId: 'c1',
    name: 'Müşteriler',
    slug: 'musteriler',
    description: null,
    icon: '👥',
    color: '#0284c7',
    canvasX: 0,
    canvasY: 0,
    sortOrder: 0,
    rowCount: 2,
    archivedRowCount: 0,
    columns: [
      {
        id: 'col_cust_name',
        clinicId: 'c1',
        tableId: 'tbl_customers',
        name: 'Ad Soyad',
        slug: 'ad_soyad',
        fieldType: 'text',
        isPrimaryTitle: true,
        isRequired: true,
        isUnique: false,
        showInTable: true,
        width: 180,
        sortOrder: 0,
        config: {},
      },
      {
        id: 'col_cust_vip',
        clinicId: 'c1',
        tableId: 'tbl_customers',
        name: 'Özel Üye',
        slug: 'ozel_uye',
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
        id: 'col_cust_group',
        clinicId: 'c1',
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
            { id: 'opt_1', label: 'Altın', color: '#f59e0b' },
            { id: 'opt_2', label: 'Gümüş', color: '#64748b' },
          ],
        },
      },
    ],
  },
  {
    id: 'tbl_survey',
    clinicId: 'c1',
    name: 'Anket',
    slug: 'anket',
    description: null,
    icon: '📋',
    color: '#16a34a',
    canvasX: 200,
    canvasY: 0,
    sortOrder: 1,
    rowCount: 1,
    archivedRowCount: 0,
    columns: [
      {
        id: 'col_survey_score',
        clinicId: 'c1',
        tableId: 'tbl_survey',
        name: 'Memnuniyet Puanı',
        slug: 'memnuniyet_puani',
        fieldType: 'number',
        isPrimaryTitle: false,
        isRequired: true,
        isUnique: false,
        showInTable: true,
        width: 150,
        sortOrder: 0,
        config: {},
      },
      {
        id: 'col_survey_doc_rel',
        clinicId: 'c1',
        tableId: 'tbl_survey',
        name: 'Sorumlu Hekim',
        slug: 'sorumlu_hekim',
        fieldType: 'relation',
        isPrimaryTitle: false,
        isRequired: false,
        isUnique: false,
        showInTable: true,
        width: 180,
        sortOrder: 1,
        config: {
          targetTableId: 'tbl_doctors',
          allowMultiple: false,
        },
      },
    ],
  },
]

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) {
    setter.call(el, value)
  } else {
    el.value = value
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

async function flushAsync() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 25))
  })
}

describe('FlowBuilder DOM Bileşen Testleri', () => {
  let container: HTMLDivElement
  let root: Root
  let savedPayloads: Array<{ url: string; method: string; body: any }>

  const setupFetchMock = (opts?: {
    tables?: DynamicTableDef[]
    doctorRows?: Array<{ id: string; displayTitle: string }>
    flowByDirection?: Record<string, { nodes: any[]; edges: any[] }>
    appointmentConfigs?: any[]
    moduleConfigs?: any[]
  }) => {
    const tables = opts?.tables ?? MOCK_TABLES
    const doctorRows = opts?.doctorRows ?? [
      { id: 'doc_1', displayTitle: 'Dr. Ayşe Yılmaz' },
      { id: 'doc_2', displayTitle: 'Dr. Burak Demir' },
    ]
    savedPayloads = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method || 'GET').toUpperCase()
        if (method === 'PUT' || method === 'POST') {
          const parsedBody = init?.body ? JSON.parse(String(init.body)) : null
          savedPayloads.push({ url, method, body: parsedBody })
        }

        if (url.includes('/api/dynamic-tables/schema')) {
          return new Response(
            JSON.stringify({
              tables,
              relations: [],
              appointmentConfigs: opts?.appointmentConfigs ?? [],
              moduleConfigs: opts?.moduleConfigs ?? [],
            }),
            { status: 200 },
          )
        }
        if (url.includes('/api/dynamic-tables/tables/tbl_doctors/rows')) {
          return new Response(JSON.stringify(doctorRows), { status: 200 })
        }
        if (url.includes('/api/admin/flow/runtime')) {
          return new Response(JSON.stringify({ mode: 'active' }), { status: 200 })
        }
        if (url.includes('/api/admin/settings/transfer-phonebook')) {
          return new Response(JSON.stringify([]), { status: 200 })
        }
        if (url.includes('/api/admin/flow') && method === 'GET') {
          const u = new URL(url, 'http://localhost')
          const dir = u.searchParams.get('direction') || 'inbound'
          const customFlow = opts?.flowByDirection?.[dir]
          return new Response(
            JSON.stringify(customFlow || { nodes: [], edges: [] }),
            { status: 200 },
          )
        }
        if (url.includes('/api/admin/flow') && method === 'PUT') {
          return new Response(JSON.stringify({ ok: true, validation: [] }), { status: 200 })
        }
        if (url.includes('/api/admin/settings/greeting')) {
          return new Response(JSON.stringify({ greeting: 'Merhaba', greetingOutbound: 'Merhaba' }), { status: 200 })
        }
        if (url.includes('/api/admin/settings/caller-id')) {
          return new Response(JSON.stringify({ callerId: '' }), { status: 200 })
        }
        if (url.includes('/api/admin/settings/connection-mode')) {
          return new Response(JSON.stringify({ mode: 'server' }), { status: 200 })
        }
        if (url.includes('/api/admin/settings/ai-model')) {
          return new Response(JSON.stringify({ model: 'gemini-live', available: ['gemini-live'] }), { status: 200 })
        }
        if (url.includes('/api/admin/settings/calendar')) {
          return new Response(JSON.stringify({ connected: false, authType: null, email: null, calendarId: null }), { status: 200 })
        }
        return new Response(JSON.stringify({}), { status: 200 })
      }),
    )
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
  })

  it('FieldNode dinamik tablo/sütun (relation dahil) seçer, AI Sorusuna kesinlikle dokunmaz ve kullanıcının düzenlemesine izin verir', async () => {
    setupFetchMock()

    await act(async () => {
      root.render(<FlowBuilder direction="inbound" />)
    })
    await flushAsync()

    const addFieldBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('+ Bilgi Al (Soru)'),
    )
    expect(addFieldBtn).toBeDefined()

    await act(async () => {
      addFieldBtn!.click()
    })
    await flushAsync()

    const questionTextarea = Array.from(container.querySelectorAll('textarea')).find(t =>
      t.placeholder.includes('Sorulacak cümleyi kendi ifadenizle yazın'),
    ) as HTMLTextAreaElement
    expect(questionTextarea).toBeDefined()

    // 1. Kullanıcı kendi AI sorusunu yazar
    const initialUserQuestion = 'Son ziyaretinizden memnun kaldınız mı, 1 ile 10 arasında puanlar mısınız?'
    await act(async () => {
      setNativeValue(questionTextarea, initialUserQuestion)
    })
    expect(questionTextarea.value).toBe(initialUserQuestion)

    // 2. Tabloyu Müşteriler -> Anket olarak değiştir
    const tableSelect = container.querySelector('select[aria-label="Veri Tablosu"]') as HTMLSelectElement
    expect(tableSelect).toBeDefined()
    await act(async () => {
      setNativeValue(tableSelect, 'tbl_survey')
    })
    await flushAsync()
    expect(questionTextarea.value).toBe(initialUserQuestion)

    // 3. Sütunu 'Sorumlu Hekim' (relation) olarak seç -> hedef tablodaki kayıt başlıkları seçenek olmalı, AI Sorusu korunmalı
    const colSelect = container.querySelector('select[aria-label="Tablo Sütunu"]') as HTMLSelectElement
    expect(colSelect).toBeDefined()
    await act(async () => {
      setNativeValue(colSelect, 'col_survey_doc_rel')
    })
    await flushAsync()

    expect(questionTextarea.value).toBe(initialUserQuestion)
    const enumInput = Array.from(container.querySelectorAll('input')).find(inp =>
      inp.placeholder.includes('danışmanlık, bilgi talebi'),
    ) as HTMLInputElement
    expect(enumInput).toBeDefined()
    expect(enumInput.value).toBe('Dr. Ayşe Yılmaz, Dr. Burak Demir')

    // 4. Hazır Alan tamamen kaldırılmış olmalı; Özel Alana geçip tekrar Veri Tablosuna dönüldüğünde de AI Sorusu korunmalı
    expect(container.textContent).not.toContain('Hazır Alan')
    const tableOptionsText = Array.from(tableSelect.options).map(o => o.textContent || '')
    expect(tableOptionsText.some(t => t.includes('Randevu Takvimi'))).toBe(true)

    const customTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find(b =>
      b.textContent?.includes('Özel Alan'),
    )!
    expect(customTab).toBeDefined()
    await act(async () => {
      customTab.click()
    })
    expect(questionTextarea.value).toBe(initialUserQuestion)

    const tableTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find(b =>
      b.textContent?.includes('Veri Tablosu'),
    )!
    await act(async () => {
      tableTab.click()
    })
    await flushAsync()
    expect(questionTextarea.value).toBe(initialUserQuestion)

    // 5. Kullanıcı sonrasında da AI sorusunu özgürce güncelleyebilmeli
    const editedQuestion = 'Hangi hekimimizden randevu veya kontrol talep ediyorsunuz?'
    await act(async () => {
      setNativeValue(container.querySelector('select[aria-label="Veri Tablosu"]') as HTMLSelectElement, 'tbl_survey')
    })
    await act(async () => {
      setNativeValue(container.querySelector('select[aria-label="Tablo Sütunu"]') as HTMLSelectElement, 'col_survey_doc_rel')
    })
    await act(async () => {
      setNativeValue(questionTextarea, editedQuestion)
    })
    expect(questionTextarea.value).toBe(editedQuestion)

    // Kaydet ve gönderilen yükü doğrula
    const saveBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Değişiklikleri Kaydet'),
    )!
    await act(async () => {
      saveBtn.click()
    })
    await flushAsync()

    const putCall = savedPayloads.find(p => p.url.includes('/api/admin/flow') && p.method === 'PUT')
    expect(putCall).toBeDefined()
    const savedFieldNode = putCall!.body.nodes.find((n: any) => n.type === 'FIELD')
    expect(savedFieldNode.data.fieldName).toBe('anket__sorumlu_hekim')
    expect(savedFieldNode.data.sourceColumnType).toBe('relation')
    expect(savedFieldNode.data.enumValues).toEqual(['Dr. Ayşe Yılmaz', 'Dr. Burak Demir'])
    expect(savedFieldNode.data.description).toBe(editedQuestion)
  })

  it('4 asistan yönünün tamamında (inbound, outbound, web, whatsapp) dinamik tablo sütunu seçilebilir ve kaydedilir', async () => {
    for (const direction of ['inbound', 'outbound', 'web', 'whatsapp'] as const) {
      setupFetchMock()
      await act(async () => {
        root.render(<FlowBuilder key={direction} direction={direction} />)
      })
      await flushAsync()

      const addFieldBtn = Array.from(container.querySelectorAll('button')).find(b =>
        b.textContent?.includes('+ Bilgi Al (Soru)'),
      )!
      await act(async () => {
        addFieldBtn.click()
      })
      await flushAsync()

      const tableSelect = container.querySelector('select[aria-label="Veri Tablosu"]') as HTMLSelectElement
      expect(tableSelect).toBeDefined()
      await act(async () => {
        setNativeValue(tableSelect, 'tbl_customers')
      })
      const colSelect = container.querySelector('select[aria-label="Tablo Sütunu"]') as HTMLSelectElement
      await act(async () => {
        setNativeValue(colSelect, 'col_cust_group')
      })

      const saveBtn = Array.from(container.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Değişiklikleri Kaydet'),
      )!
      await act(async () => {
        saveBtn.click()
      })
      await flushAsync()

      const putCall = savedPayloads.find(p => p.url.includes('/api/admin/flow') && p.method === 'PUT')
      expect(putCall).toBeDefined()
      expect(new URL(putCall!.url, 'http://localhost').searchParams.get('direction')).toBe(direction)
      const savedFieldNode = putCall!.body.nodes.find((n: any) => n.type === 'FIELD')
      expect(savedFieldNode.data.fieldName).toBe('musteriler__musteri_grubu')
      expect(savedFieldNode.data.enumValues).toEqual(['Altın', 'Gümüş'])
    }
  })

  it('+ Koşul ve + Koşul ekle ile dinamik sütunlara (boolean, relation, number) göre çoklu kural ve ve/veya bağlacı oluşturur', async () => {
    setupFetchMock()

    await act(async () => {
      root.render(<FlowBuilder direction="inbound" />)
    })
    await flushAsync()

    const addCondBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('+ Koşul (Evet/Hayır)'),
    )!
    await act(async () => {
      addCondBtn.click()
    })
    await flushAsync()

    // Kural 1: Akış / Görüşme sekmesi olmadan doğrudan Veri Tablosu seçimi -> Müşteriler · Özel Üye (boolean)
    expect(container.textContent).not.toContain('Akış / Görüşme')

    let condTableSelects = container.querySelectorAll('select[aria-label="Koşul veri tablosu"]')
    let condColSelects = container.querySelectorAll('select[aria-label="Koşul tablo sütunu"]')
    expect(condTableSelects.length).toBe(1)
    await act(async () => {
      setNativeValue(condTableSelects[0] as HTMLSelectElement, 'tbl_customers')
    })
    await flushAsync()
    condColSelects = container.querySelectorAll('select[aria-label="Koşul tablo sütunu"]')
    await act(async () => {
      setNativeValue(condColSelects[0] as HTMLSelectElement, 'col_cust_vip')
    })
    await flushAsync()

    // Kural 2 ekle (+ Koşul ekle) -> Anket · Sorumlu Hekim (relation seçenek listesi gelmeli)
    const addRuleBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('+ Koşul ekle'),
    )!
    await act(async () => {
      addRuleBtn.click()
    })
    await flushAsync()

    condTableSelects = container.querySelectorAll('select[aria-label="Koşul veri tablosu"]')
    expect(condTableSelects.length).toBe(2)
    await act(async () => {
      setNativeValue(condTableSelects[1] as HTMLSelectElement, 'tbl_survey')
    })
    await flushAsync()

    condColSelects = container.querySelectorAll('select[aria-label="Koşul tablo sütunu"]')
    await act(async () => {
      setNativeValue(condColSelects[1] as HTMLSelectElement, 'col_survey_doc_rel')
    })
    await flushAsync()

    // Relation sütunu için hedef tablo kayıt başlıklarının <select> içinde yüklendiğini doğrula
    const drOption = Array.from(container.querySelectorAll('option')).find(
      o => o.value === 'Dr. Burak Demir' && o.textContent === 'Dr. Burak Demir',
    )
    expect(drOption).toBeDefined()
    const relationValueSelect = drOption!.parentElement as HTMLSelectElement
    await act(async () => {
      setNativeValue(relationValueSelect, 'Dr. Burak Demir')
    })

    // Bağlacı 've' -> 'veya' olarak değiştir
    const logicToggleBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.title === 'Tıklayarak ve / veya arasında değiştirin',
    )!
    expect(logicToggleBtn.textContent).toBe('ve')
    await act(async () => {
      logicToggleBtn.click()
    })
    expect(logicToggleBtn.textContent).toBe('veya')

    // Kaydet ve doğrula
    const saveBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Değişiklikleri Kaydet'),
    )!
    await act(async () => {
      saveBtn.click()
    })
    await flushAsync()

    const putCall = savedPayloads.find(p => p.url.includes('/api/admin/flow') && p.method === 'PUT')
    expect(putCall).toBeDefined()
    const savedCondNode = putCall!.body.nodes.find((n: any) => n.type === 'CONDITION')
    expect(savedCondNode.data.conditionLogic).toBe('OR')
    expect(savedCondNode.data.rules).toHaveLength(2)
    expect(savedCondNode.data.rules[0].field).toBe('musteriler__ozel_uye')
    expect(savedCondNode.data.rules[0].value).toBe('true')
    expect(savedCondNode.data.rules[1].field).toBe('anket__sorumlu_hekim')
    expect(savedCondNode.data.rules[1].value).toBe('Dr. Burak Demir')
    expect(savedCondNode.data.rules[1].sourceColumnType).toBe('relation')
  })

  it('user_intent (isIntent) kuralından Veri Tablosu sekmesine geçildiğinde tablo veya sütun boş olsa bile niyet kutusu takılı kalmaz', async () => {
    const intentFlow = {
      nodes: [
        { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: { label: 'Başla' } },
        {
          id: 'cond_intent',
          type: 'CONDITION',
          position: { x: 0, y: 120 },
          data: {
            label: 'Hastanın isteği',
            conditionField: 'user_intent',
            operator: 'intent',
            conditionValue: 'Fiyat bilgisi soruyor',
          },
        },
        { id: 'end', type: 'END', position: { x: 0, y: 240 }, data: { label: 'Bitir' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'cond_intent' },
        { id: 'e2', source: 'cond_intent', sourceHandle: 'true', target: 'end' },
        { id: 'e3', source: 'cond_intent', sourceHandle: 'false', target: 'end' },
      ],
    }

    // Durum A: Hiç veri tablosu yokken (dynamicTables = [])
    setupFetchMock({ tables: [], flowByDirection: { inbound: intentFlow } })
    await act(async () => {
      root.render(<FlowBuilder key="empty-tables" direction="inbound" />)
    })
    await flushAsync()

    await act(async () => {
      ;(container.querySelector('[data-testid="rf-node-cond_intent"]') as HTMLElement).click()
    })
    await flushAsync()
    expect(container.textContent).toContain('Yapay zeka hangi isteği algılasın?')

    expect(container.textContent).not.toContain('Akış / Görüşme')
    const convertBtnEmpty = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(b =>
      b.textContent?.includes('Veri Tablosu Koşuluna Dönüştür'),
    )!
    expect(convertBtnEmpty).toBeDefined()
    await act(async () => {
      convertBtnEmpty.click()
    })
    await flushAsync()

    expect(container.textContent).not.toContain('Yapay zeka hangi isteği algılasın?')
    expect(container.textContent).toContain('Özel veri tablosu henüz yok — Randevu Takvimi koşulu seçebilirsiniz.')

    // Durum B: Sütunu olmayan boş bir tablo varken (columns = [])
    const tableWithNoCols: DynamicTableDef = {
      id: 'tbl_empty_cols',
      clinicId: 'c1',
      name: 'Boş Tablo',
      slug: 'bos_tablo',
      description: null,
      icon: '📊',
      color: '#0284c7',
      canvasX: 0,
      canvasY: 0,
      sortOrder: 0,
      rowCount: 0,
      archivedRowCount: 0,
      columns: [],
    }
    setupFetchMock({ tables: [tableWithNoCols], flowByDirection: { inbound: intentFlow } })
    await act(async () => {
      root.render(<FlowBuilder key="no-cols-table" direction="inbound" />)
    })
    await flushAsync()

    await act(async () => {
      ;(container.querySelector('[data-testid="rf-node-cond_intent"]') as HTMLElement).click()
    })
    await flushAsync()
    expect(container.textContent).toContain('Yapay zeka hangi isteği algılasın?')

    const convertBtnNoCols = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(b =>
      b.textContent?.includes('Veri Tablosu Koşuluna Dönüştür'),
    )!
    expect(convertBtnNoCols).toBeDefined()
    await act(async () => {
      convertBtnNoCols.click()
    })
    await flushAsync()

    expect(container.textContent).not.toContain('Yapay zeka hangi isteği algılasın?')
    expect(container.textContent).toContain('Bu tabloda henüz sütun tanımlanmamış.')
  })

  it('Hedef tablosu boş (0 kayıt) olan relation sütununda serbest metne düşer ve save_record işleminde hedef tabloyu kaydeder', async () => {
    setupFetchMock({ doctorRows: [] })

    await act(async () => {
      root.render(<FlowBuilder direction="inbound" />)
    })
    await flushAsync()

    // 1. Relation sütununda hedef tabloda 0 kayıt varken FieldNode string tipine düşer, AI Sorusu korunur
    const addFieldBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('+ Bilgi Al (Soru)'),
    )!
    await act(async () => {
      addFieldBtn.click()
    })
    await flushAsync()

    const questionTextarea = Array.from(container.querySelectorAll('textarea')).find(t =>
      t.placeholder.includes('Sorulacak cümleyi kendi ifadenizle yazın'),
    ) as HTMLTextAreaElement
    await act(async () => {
      setNativeValue(questionTextarea, 'Hangi hekimimizi tercih edersiniz?')
    })
    await act(async () => {
      setNativeValue(container.querySelector('select[aria-label="Veri Tablosu"]') as HTMLSelectElement, 'tbl_survey')
    })
    await act(async () => {
      setNativeValue(container.querySelector('select[aria-label="Tablo Sütunu"]') as HTMLSelectElement, 'col_survey_doc_rel')
    })
    await flushAsync()
    expect(questionTextarea.value).toBe('Hangi hekimimizi tercih edersiniz?')

    // 2. + İşlem ekle -> Veri Tablosuna Kaydet -> Hedef Veri Tablosu = Anket
    const addActionBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.onclick && b.textContent?.includes('İşlem'),
    ) || Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('+ İşlem'))!
    expect(addActionBtn).toBeDefined()
    await act(async () => {
      addActionBtn.click()
    })
    await flushAsync()

    const actionSelect = Array.from(container.querySelectorAll('select')).find(s =>
      Array.from(s.options).some(o => o.value === 'save_record'),
    )!
    await act(async () => {
      setNativeValue(actionSelect, 'save_record')
    })
    await flushAsync()

    const targetTableSelect = Array.from(container.querySelectorAll('select')).find(s =>
      Array.from(s.options).some(o => o.textContent?.includes('Otomatik (Sorulan Sütunların Tablosuna Kaydet)')),
    )!
    expect(targetTableSelect).toBeDefined()
    await act(async () => {
      setNativeValue(targetTableSelect, 'tbl_survey')
    })

    const saveBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Değişiklikleri Kaydet'),
    )!
    await act(async () => {
      saveBtn.click()
    })
    await flushAsync()

    const putCall = savedPayloads.find(p => p.url.includes('/api/admin/flow') && p.method === 'PUT')
    expect(putCall).toBeDefined()
    const savedFieldNode = putCall!.body.nodes.find((n: any) => n.type === 'FIELD')
    expect(savedFieldNode.data.fieldName).toBe('anket__sorumlu_hekim')
    expect(savedFieldNode.data.fieldType).toBe('text')
    expect(savedFieldNode.data.enumValues).toBeUndefined()
    expect(savedFieldNode.data.description).toBe('Hangi hekimimizi tercih edersiniz?')

    const savedActionNode = putCall!.body.nodes.find((n: any) => n.type === 'ACTION')
    expect(savedActionNode.data.action).toBe('save_record')
    expect(savedActionNode.data.targetTableId).toBe('tbl_survey')
    expect(savedActionNode.data.targetTableSlug).toBe('anket')
    expect(savedActionNode.data.targetTableName).toBe('Anket')
  })

  it('metin sütununa geçerken gt/true değerlerini temizler, box ikonunu gizler ve "Bu tabloda kayıtlı mı?" koşulu kurar', async () => {
    const stockTable: DynamicTableDef = {
      id: 'tbl_stock',
      clinicId: 'c1',
      name: 'Ürün & Demirbaş Stoku',
      slug: 'urun_demirbas_stoku',
      description: null,
      icon: 'box',
      color: '#0284c7',
      canvasX: 0,
      canvasY: 0,
      sortOrder: 0,
      rowCount: 2,
      archivedRowCount: 0,
      columns: [
        {
          id: 'col_stock_name',
          tableId: 'tbl_stock',
          clinicId: 'c1',
          name: 'Kalem / Ürün Adı',
          slug: 'kalem_urun_adi',
          fieldType: 'text',
          isRequired: true,
          isUnique: false,
          isPrimaryTitle: true,
          showInTable: true,
          width: 180,
          sortOrder: 0,
          config: {},
        },
        {
          id: 'col_stock_qty',
          tableId: 'tbl_stock',
          clinicId: 'c1',
          name: 'Stok Adedi',
          slug: 'stok_adedi',
          fieldType: 'number',
          isRequired: false,
          isUnique: false,
          isPrimaryTitle: false,
          showInTable: true,
          width: 120,
          sortOrder: 1,
          config: {},
        },
      ],
    }

    const legacyBooleanFlow = {
      nodes: [
        { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: { label: 'Başla' } },
        {
          id: 'cond_1',
          type: 'CONDITION',
          position: { x: 0, y: 120 },
          data: {
            label: 'Kayıtlı hasta mı?',
            conditionField: 'kayitli',
            operator: 'gt',
            conditionValue: 'true',
          },
        },
        { id: 'end', type: 'END', position: { x: 0, y: 240 }, data: { label: 'Bitir' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'cond_1' },
        { id: 'e2', source: 'cond_1', sourceHandle: 'true', target: 'end' },
        { id: 'e3', source: 'cond_1', sourceHandle: 'false', target: 'end' },
      ],
    }

    setupFetchMock({ tables: [...MOCK_TABLES, stockTable], flowByDirection: { inbound: legacyBooleanFlow } })
    await act(async () => {
      root.render(<FlowBuilder key="screenshot-regression" direction="inbound" />)
    })
    await flushAsync()

    await act(async () => {
      ;(container.querySelector('[data-testid="rf-node-cond_1"]') as HTMLElement).click()
    })
    await flushAsync()

    // Akış / Görüşme sekmesi olmadan doğrudan Veri Tablosu seçimi ve 'box' ikonu yerine emoji görünümünü doğrula
    expect(container.textContent).not.toContain('Akış / Görüşme')

    const condTableSelect = container.querySelector('select[aria-label="Koşul veri tablosu"]') as HTMLSelectElement
    const stockOption = Array.from(condTableSelect.options).find(o => o.value === 'tbl_stock')
    expect(stockOption?.textContent).toContain('📦 Ürün & Demirbaş Stoku')
    expect(stockOption?.textContent).not.toContain('box ')

    // Stok tablosunun metin sütununu seç
    await act(async () => {
      setNativeValue(condTableSelect, 'tbl_stock')
    })
    await flushAsync()

    const condColSelect = container.querySelector('select[aria-label="Koşul tablo sütunu"]') as HTMLSelectElement
    await act(async () => {
      setNativeValue(condColSelect, 'col_stock_name')
    })
    await flushAsync()

    // Sayısal operatörler ("büyükse" vb.) ve "Sayısal değer girin" / "Evet büyükse" artık görünmemeli
    const opSelect = container.querySelector('select[aria-label="Karşılaştırma Koşulu"]') as HTMLSelectElement
    const opLabels = Array.from(opSelect.options).map(o => o.textContent)
    expect(opLabels).not.toContain('büyükse')
    expect(opLabels).not.toContain('en az')
    expect(opLabels).toContain('tabloda kayıtlıysa')
    expect(container.textContent).not.toContain('Evet büyükse')
    expect(container.querySelector('input[placeholder="Sayısal değer girin"]')).toBeNull()

    // Tek tıkla "Bu sütunda kayıtlıysa" operatörüne geç
    const colLookupChip = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Bu sütunda kayıtlıysa'),
    )!
    expect(colLookupChip).toBeDefined()
    await act(async () => {
      colLookupChip.click()
    })
    await flushAsync()
    expect(container.textContent).toContain('tabloda kayıtlıysa')

    // Tek tıkla "Bu tabloda kayıtlı mı?" koşulunu seç ve kaydet
    const rowExistsChip = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Bu tabloda kayıtlı mı?'),
    )!
    expect(rowExistsChip).toBeDefined()
    await act(async () => {
      rowExistsChip.click()
    })
    await flushAsync()

    const saveBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Değişiklikleri Kaydet'),
    )!
    await act(async () => {
      saveBtn.click()
    })
    await flushAsync()

    const putCall = savedPayloads.find(p => p.url.includes('/api/admin/flow') && p.method === 'PUT')
    const savedCond = putCall!.body.nodes.find((n: any) => n.type === 'CONDITION')
    expect(savedCond.data.conditionField).toBe('urun_demirbas_stoku____kayitli')
    expect(savedCond.data.sourceColumnId).toBe('__row_exists__')
    expect(savedCond.data.operator).toBe('equals')
    expect(savedCond.data.conditionValue).toBe('true')
  })

  it('sektöre özgü (örn. Emlak) veri tablolarına göre Hazır Şablon seçenekleri üretir ve düğümleri gerçek tablolara bağlar', async () => {
    const realEstateTables: DynamicTableDef[] = [
      {
        id: 'tbl_buyers',
        clinicId: 'c1',
        name: 'Alıcı & Arayanlar',
        slug: 'alici_arayanlar',
        description: null,
        icon: '👥',
        color: '#0284c7',
        canvasX: 0,
        canvasY: 0,
        sortOrder: 0,
        rowCount: 1,
        archivedRowCount: 0,
        columns: [
          {
            id: 'col_re_name',
            tableId: 'tbl_buyers',
            clinicId: 'c1',
            name: 'Ad Soyad',
            slug: 'ad_soyad',
            fieldType: 'text',
            isRequired: true,
            isUnique: false,
            isPrimaryTitle: true,
            showInTable: true,
            width: 180,
            sortOrder: 0,
            config: {},
          },
          {
            id: 'col_re_phone',
            tableId: 'tbl_buyers',
            clinicId: 'c1',
            name: 'Telefon',
            slug: 'telefon',
            fieldType: 'phone',
            isRequired: true,
            isUnique: true,
            isPrimaryTitle: false,
            showInTable: true,
            width: 160,
            sortOrder: 1,
            config: {},
          },
          {
            id: 'col_re_budget',
            tableId: 'tbl_buyers',
            clinicId: 'c1',
            name: 'Bütçe / Talep',
            slug: 'butce_talep',
            fieldType: 'text',
            isRequired: false,
            isUnique: false,
            isPrimaryTitle: false,
            showInTable: true,
            width: 180,
            sortOrder: 2,
            config: {},
          },
        ],
      },
      {
        id: 'tbl_portfolio',
        clinicId: 'c1',
        name: 'Emlak Portföyü',
        slug: 'emlak_portfoyu',
        description: null,
        icon: '🏠',
        color: '#059669',
        canvasX: 280,
        canvasY: 0,
        sortOrder: 1,
        rowCount: 3,
        archivedRowCount: 0,
        columns: [
          {
            id: 'col_re_listing',
            tableId: 'tbl_portfolio',
            clinicId: 'c1',
            name: 'İlan Başlığı',
            slug: 'ilan_basligi',
            fieldType: 'text',
            isRequired: true,
            isUnique: false,
            isPrimaryTitle: true,
            showInTable: true,
            width: 200,
            sortOrder: 0,
            config: {},
          },
          {
            id: 'col_re_loc',
            tableId: 'tbl_portfolio',
            clinicId: 'c1',
            name: 'İlçe / Semt',
            slug: 'ilce_semt',
            fieldType: 'text',
            isRequired: false,
            isUnique: false,
            isPrimaryTitle: false,
            showInTable: true,
            width: 160,
            sortOrder: 1,
            config: {},
          },
        ],
      },
    ]

    setupFetchMock({
      tables: realEstateTables,
      appointmentConfigs: [
        {
          id: 'ac_1',
          tableId: 'tbl_buyers',
          enabled: true,
          titleColumnId: 'col_re_name',
          phoneColumnId: 'col_re_phone',
          emailColumnId: null,
          isRequiredInAppointment: true,
          allowMultiple: false,
          includeRelatedTables: true,
        },
      ],
    })

    await act(async () => {
      root.render(<FlowBuilder key="real-estate-tpl" direction="inbound" />)
    })
    await flushAsync()

    // Hazır şablon seçicisinde sektöre özgü şablonlar olmalı, Akış/Görüşme veya Hazır Alan olmamalı
    expect(container.textContent).not.toContain('Akış / Görüşme')
    expect(container.textContent).not.toContain('Hazır Alan')

    const tplSelect = Array.from(container.querySelectorAll('select')).find(s =>
      Array.from(s.options).some(o => o.textContent?.includes('Hazır Şablon Yükle')),
    ) as HTMLSelectElement
    expect(tplSelect).toBeDefined()
    const tplOptions = Array.from(tplSelect.options)
    expect(tplOptions.some(o => o.value === 'inbound')).toBe(true)
    expect(tplOptions.some(o => o.value === 'full_asterisk')).toBe(true)
    expect(tplOptions.some(o => o.value === 'quick_note')).toBe(true)

    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)

    await act(async () => {
      setNativeValue(tplSelect, 'inbound')
    })
    await flushAsync()
    expect(confirmSpy).toHaveBeenCalled()

    const saveBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Değişiklikleri Kaydet'),
    )!
    await act(async () => {
      saveBtn.click()
    })
    await flushAsync()

    const putCall = savedPayloads.find(p => p.url.includes('/api/admin/flow') && p.method === 'PUT')
    expect(putCall).toBeDefined()
    const savedNodes = putCall!.body.nodes as any[]
    const fieldNodes = savedNodes.filter(n => n.type === 'FIELD')
    const condNodes = savedNodes.filter(n => n.type === 'CONDITION')
    expect(condNodes.some(c => c.data?.conditionField === 'alici_arayanlar____kayitli')).toBe(true)
    expect(fieldNodes.some(f => f.data?.sourceTableId === 'tbl_buyers')).toBe(true)
    expect(fieldNodes.some(f => f.data?.sourceTableId === '__appointment_calendar__' && f.data?.fieldName === 'tarih')).toBe(true)
    expect(fieldNodes.some(f => f.data?.sourceTableId === '__appointment_calendar__' && f.data?.fieldName === 'saat')).toBe(true)

    // Doğrudan yardımcı fonksiyon doğrulamaları: profil çıkarma + legacy yeniden bağlama + AI Sorusu koruma
    const profile = inferClinicDynamicProfile(realEstateTables, [
      {
        tableId: 'tbl_buyers',
        enabled: true,
        titleColumnId: 'col_re_name',
        phoneColumnId: 'col_re_phone',
      },
    ])
    expect(profile.sectorKind).toBe('real_estate')

    const builtSample = buildDynamicSampleFlow('inbound', realEstateTables, profile)
    expect(builtSample.nodes.some((n: any) => n.data?.sourceTableId === 'tbl_buyers')).toBe(true)

    const customQuestion = 'Size hangi bütçe aralığında ilan önerebilirim?'
    const legacyInput: Array<{ id: string; type?: string; data?: Record<string, any> }> = [
      {
        id: 'c_old',
        type: 'conditionNode',
        data: {
          label: 'Eski Kayıt Kontrolü',
          conditionField: 'kayitli',
          operator: 'equals',
          conditionValue: 'true',
        },
      },
      {
        id: 'f_old',
        type: 'fieldNode',
        data: {
          label: 'Ad Soyad',
          fieldName: 'musteri_adi',
          description: customQuestion,
        },
      },
    ]
    const rebound = rebindLegacyNodesToDynamicTables(legacyInput, realEstateTables, profile)
    expect(rebound.changed).toBe(true)
    expect(rebound.nodes[0].data?.sourceTableId).toBe('tbl_buyers')
    expect(rebound.nodes[0].data?.sourceColumnId).toBe('__row_exists__')
    expect(rebound.nodes[0].data?.conditionField).toBe('alici_arayanlar____kayitli')
    expect(rebound.nodes[1].data?.sourceTableId).toBe('tbl_buyers')
    expect(rebound.nodes[1].data?.description).toBe(customQuestion)
  })

  it('stok modülü olsa bile Emlak örnek senaryosunda Portföy İlanları ve İlan Linki alanını önceliklendirir', () => {
    const tablesWithStockAndLink: DynamicTableDef[] = [
      {
        id: 'tbl_buyers',
        clinicId: 'c1',
        name: 'Alıcı & Kiracı Adayları',
        slug: 'alici_kiraci_adaylari',
        description: null,
        icon: '👥',
        color: '#0284c7',
        canvasX: 0,
        canvasY: 0,
        sortOrder: 0,
        rowCount: 1,
        archivedRowCount: 0,
        columns: [
          {
            id: 'col_name',
            tableId: 'tbl_buyers',
            clinicId: 'c1',
            name: 'Ad Soyad',
            slug: 'ad_soyad',
            fieldType: 'text',
            isRequired: true,
            isUnique: false,
            isPrimaryTitle: true,
            showInTable: true,
            width: 180,
            sortOrder: 0,
            config: {},
          },
          {
            id: 'col_phone',
            tableId: 'tbl_buyers',
            clinicId: 'c1',
            name: 'Telefon',
            slug: 'telefon',
            fieldType: 'phone',
            isRequired: true,
            isUnique: true,
            isPrimaryTitle: false,
            showInTable: true,
            width: 160,
            sortOrder: 1,
            config: {},
          },
        ],
      },
      {
        id: 'tbl_portfolio',
        clinicId: 'c1',
        name: 'Portföy İlanları',
        slug: 'portfoy_ilanlari',
        description: null,
        icon: '🏠',
        color: '#2563eb',
        canvasX: 280,
        canvasY: 0,
        sortOrder: 1,
        rowCount: 2,
        archivedRowCount: 0,
        columns: [
          {
            id: 'col_title',
            tableId: 'tbl_portfolio',
            clinicId: 'c1',
            name: 'İlan Başlığı',
            slug: 'ilan_basligi',
            fieldType: 'text',
            isRequired: true,
            isUnique: false,
            isPrimaryTitle: true,
            showInTable: true,
            width: 220,
            sortOrder: 0,
            config: {},
          },
          {
            id: 'col_room',
            tableId: 'tbl_portfolio',
            clinicId: 'c1',
            name: 'Oda Planı',
            slug: 'oda_plani',
            fieldType: 'select',
            isRequired: false,
            isUnique: false,
            isPrimaryTitle: false,
            showInTable: true,
            width: 140,
            sortOrder: 1,
            config: {
              options: [{ id: 'o1', label: '3+1', color: '#2563eb' }],
            },
          },
          {
            id: 'col_link',
            tableId: 'tbl_portfolio',
            clinicId: 'c1',
            name: 'İlan Linki',
            slug: 'ilan_linki',
            fieldType: 'text',
            isRequired: false,
            isUnique: false,
            isPrimaryTitle: false,
            showInTable: true,
            width: 260,
            sortOrder: 2,
            config: {},
          },
        ],
      },
      {
        id: 'tbl_stock',
        clinicId: 'c1',
        name: 'Ofis & Saha Malzeme Stoku',
        slug: 'ofis_saha_malzeme_stoku',
        description: null,
        icon: '📦',
        color: '#0369a1',
        canvasX: 560,
        canvasY: 0,
        sortOrder: 2,
        rowCount: 1,
        archivedRowCount: 0,
        columns: [
          {
            id: 'col_cat',
            tableId: 'tbl_stock',
            clinicId: 'c1',
            name: 'Kategori',
            slug: 'kategori',
            fieldType: 'select',
            isRequired: false,
            isUnique: false,
            isPrimaryTitle: false,
            showInTable: true,
            width: 140,
            sortOrder: 0,
            config: {
              options: [{ id: 'c1', label: 'Genel', color: '#0369a1' }],
            },
          },
        ],
      },
    ]

    const profile = inferClinicDynamicProfile(
      tablesWithStockAndLink,
      [
        {
          tableId: 'tbl_buyers',
          enabled: true,
          allowMultiple: false,
          isRequiredInAppointment: true,
        },
        {
          tableId: 'tbl_portfolio',
          enabled: true,
          allowMultiple: true,
          isRequiredInAppointment: false,
        },
      ],
      [
        {
          tableId: 'tbl_stock',
          moduleRole: 'stock_inventory',
          enabled: true,
          isEnabled: true,
        },
      ],
    )

    expect(profile.secondaryTable?.id).toBe('tbl_portfolio')
    expect(profile.linkCol?.id).toBe('col_link')

    const waTemplate = buildDynamicSampleFlow('whatsapp', tablesWithStockAndLink, profile)
    const waFieldLabels = waTemplate.nodes
      .filter((n: any) => n.type === 'fieldNode')
      .map((n: any) => String(n.data?.label || ''))
    expect(waFieldLabels.some(l => l.includes('Ofis & Saha Malzeme Stoku'))).toBe(false)
    expect(waFieldLabels.some(l => l === 'Portföy İlanları · İlan Linki')).toBe(true)

    const webTemplate = buildDynamicSampleFlow('web', tablesWithStockAndLink, profile)
    expect(
      webTemplate.nodes.some(
        (n: any) => n.type === 'fieldNode' && n.data?.sourceTableId === 'tbl_portfolio' && n.data?.sourceColumnId === 'col_link',
      ),
    ).toBe(true)
  })

  it('Temizle butonu onay penceresini açar, onaylandığında akışı başlangıç-bitiş adımına sıfırlayıp kaydeder ve Geri butonuyla geri alınabilir', async () => {
    setupFetchMock({
      flowByDirection: {
        inbound: {
          nodes: [
            { id: 'start', type: 'START', position: { x: 200, y: 20 }, data: { label: 'Karşılama Mesajı' } },
            {
              id: 'f_name',
              type: 'FIELD',
              position: { x: 200, y: 140 },
              data: { label: 'Ad Soyad', fieldName: 'ad_soyad', description: 'Adınız nedir?', required: true, fieldType: 'text' },
            },
            {
              id: 'a_save',
              type: 'ACTION',
              position: { x: 200, y: 260 },
              data: { label: 'Kayıt Oluştur', action: 'save_record' },
            },
            { id: 'end', type: 'END', position: { x: 200, y: 380 }, data: { label: 'Görüşmeyi Bitir' } },
          ],
          edges: [
            { id: 'e1', source: 'start', target: 'f_name' },
            { id: 'e2', source: 'f_name', target: 'a_save' },
            { id: 'e3', source: 'a_save', target: 'end' },
          ],
        },
      },
    })

    await act(async () => {
      root.render(<FlowBuilder key="clear-flow-test" direction="inbound" />)
    })
    await flushAsync()

    // Başlangıçta 4 düğüm yüklü olmalı
    expect(container.querySelector('[data-testid="rf-node-f_name"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="rf-node-a_save"]')).not.toBeNull()

    // Temizle butonuna tıkla
    const clearBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Temizle'),
    )
    expect(clearBtn).toBeDefined()

    await act(async () => {
      clearBtn!.click()
    })
    await flushAsync()

    // Onay modalı açılmış olmalı
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('Akışı Temizle')

    const confirmBtn = Array.from(dialog!.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Akışı Temizle'),
    )
    expect(confirmBtn).toBeDefined()

    await act(async () => {
      confirmBtn!.click()
    })
    await flushAsync()

    // Ek adımlar temizlenmiş, yalnızca start ve end kalmış olmalı
    expect(container.querySelector('[data-testid="rf-node-f_name"]')).toBeNull()
    expect(container.querySelector('[data-testid="rf-node-a_save"]')).toBeNull()
    expect(container.querySelector('[data-testid="rf-node-start"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="rf-node-end"]')).not.toBeNull()

    // Sunucuya PUT /api/admin/flow?direction=inbound gönderilmiş olmalı
    const putCall = savedPayloads.find(p => p.url.includes('/api/admin/flow') && p.method === 'PUT')
    expect(putCall).toBeDefined()
    expect(putCall!.body.nodes).toHaveLength(2)
    expect(putCall!.body.nodes.map((n: any) => n.type)).toEqual(['START', 'END'])
    expect(putCall!.body.edges).toHaveLength(1)

    // Geri Al butonu önceki akışı geri getirmeli
    const undoBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Geri'),
    )
    expect(undoBtn).toBeDefined()
    expect(undoBtn!.disabled).toBe(false)

    await act(async () => {
      undoBtn!.click()
    })
    await flushAsync()

    expect(container.querySelector('[data-testid="rf-node-f_name"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="rf-node-a_save"]')).not.toBeNull()
  })
})
