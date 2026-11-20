// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import BulkClearTablesModal from './BulkClearTablesModal'
import type { DynamicTableDef, StudioSchemaResponse } from './types'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const SAMPLE_TABLES: DynamicTableDef[] = [
  {
    id: 'tbl_tpl_1',
    clinicId: 'c1',
    name: 'Şablon Müşteriler',
    slug: 'sablon_musteriler',
    icon: 'users',
    color: '#0284c7',
    description: null,
    origin: 'template',
    canvasX: 100,
    canvasY: 100,
    sortOrder: 0,
    rowCount: 12,
    archivedRowCount: 0,
    columns: [],
  },
  {
    id: 'tbl_manual_1',
    clinicId: 'c1',
    name: 'Manuel Notlar',
    slug: 'manuel_notlar',
    icon: 'table',
    color: '#2563eb',
    description: null,
    origin: 'manual',
    canvasX: 400,
    canvasY: 100,
    sortOrder: 1,
    rowCount: 3,
    archivedRowCount: 1,
    columns: [],
  },
  {
    id: 'tbl_manual_2',
    clinicId: 'c1',
    name: 'Manuel Etiketler',
    slug: 'manuel_etiketler',
    icon: 'tag',
    color: '#15803d',
    description: null,
    origin: 'manual',
    canvasX: 700,
    canvasY: 100,
    sortOrder: 2,
    rowCount: 5,
    archivedRowCount: 0,
    columns: [],
  },
]

const flushAsync = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

describe('BulkClearTablesModal', () => {
  let container: HTMLDivElement
  let root: Root

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

  it('şablon + manuel tablo birlikteyken varsayılan olarak yalnızca manuel tabloları seçer ve toplu silme isteği gönderir', async () => {
    const requests: Array<{ url: string; method: string; body: any }> = []
    const nextSchema: StudioSchemaResponse = {
      tabLabel: 'Veri Tabloları',
      canManageSchema: true,
      appointmentNodePosition: { x: 660, y: 120 },
      tables: [SAMPLE_TABLES[0]],
      relations: [],
      appointmentConfigs: [],
      moduleConfigs: [],
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: String(input),
          method: init?.method || 'GET',
          body: init?.body ? JSON.parse(String(init.body)) : null,
        })
        return new Response(
          JSON.stringify({
            success: true,
            deletedCount: 2,
            deletedTableIds: ['tbl_manual_1', 'tbl_manual_2'],
            schema: nextSchema,
          }),
          { status: 200 }
        )
      })
    )

    const onCleared = vi.fn()
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <BulkClearTablesModal
          isOpen
          tables={SAMPLE_TABLES}
          relations={[]}
          appointmentConfigs={[]}
          moduleConfigs={[]}
          onClose={onClose}
          onCleared={onCleared}
        />
      )
    })
    await flushAsync()

    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]
    expect(checkboxes).toHaveLength(3)
    expect(checkboxes[0].checked).toBe(false) // Şablon tablo seçili değil
    expect(checkboxes[1].checked).toBe(true) // Manuel 1 seçili
    expect(checkboxes[2].checked).toBe(true) // Manuel 2 seçili

    const confirmBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Seçili Tabloları Temizle (2)')
    )
    expect(confirmBtn).toBeDefined()

    await act(async () => {
      confirmBtn!.click()
    })
    await flushAsync()

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('/api/dynamic-tables/tables/clear')
    expect(requests[0].method).toBe('POST')
    expect(requests[0].body).toEqual({
      mode: 'selected',
      tableIds: ['tbl_manual_1', 'tbl_manual_2'],
    })
    expect(onCleared).toHaveBeenCalledWith(nextSchema, 2)
    expect(onClose).toHaveBeenCalled()
  })

  it('Tüm Tablolar butonuna basıldığında tüm tabloları seçer ve mode: all gönderir', async () => {
    const requests: Array<{ url: string; method: string; body: any }> = []
    const emptySchema: StudioSchemaResponse = {
      tabLabel: 'Veri Tabloları',
      canManageSchema: true,
      appointmentNodePosition: { x: 660, y: 120 },
      tables: [],
      relations: [],
      appointmentConfigs: [],
      moduleConfigs: [],
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: String(input),
          method: init?.method || 'GET',
          body: init?.body ? JSON.parse(String(init.body)) : null,
        })
        return new Response(
          JSON.stringify({
            success: true,
            deletedCount: 3,
            deletedTableIds: ['tbl_tpl_1', 'tbl_manual_1', 'tbl_manual_2'],
            schema: emptySchema,
          }),
          { status: 200 }
        )
      })
    )

    const onCleared = vi.fn()
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <BulkClearTablesModal
          isOpen
          tables={SAMPLE_TABLES}
          relations={[]}
          appointmentConfigs={[]}
          moduleConfigs={[]}
          onClose={onClose}
          onCleared={onCleared}
        />
      )
    })
    await flushAsync()

    const selectAllBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Tüm Tablolar (3)')
    )
    expect(selectAllBtn).toBeDefined()

    await act(async () => {
      selectAllBtn!.click()
    })
    await flushAsync()

    const confirmAllBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Tüm Tabloları Temizle (3)')
    )
    expect(confirmAllBtn).toBeDefined()

    await act(async () => {
      confirmAllBtn!.click()
    })
    await flushAsync()

    expect(requests).toHaveLength(1)
    expect(requests[0].body).toEqual({ mode: 'all' })
    expect(onCleared).toHaveBeenCalledWith(emptySchema, 3)
  })
})
