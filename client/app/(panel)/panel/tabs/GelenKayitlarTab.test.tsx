// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../admin/components/FlowBuilder', () => ({ default: () => <div>akış-editörü</div> }))
vi.mock('../../../admin/components/VoiceAiSettings', () => ({ default: () => <div>sesli-asistan-ayarları</div> }))

import GelenKayitlarTab from './GelenKayitlarTab'
import KnowledgeTab from '../../../admin/components/KnowledgeTab'

const sampleConfigs = [
  { clinicId: '11111111-1111-4111-8111-111111111111', clinicName: 'Örnek İşletme', provider: 'evolution' as const },
]

const sampleConversations = [
  {
    id: '22222222-2222-4222-8222-222222222221',
    phone: '+905551112233',
    remoteJid: '905551112233@s.whatsapp.net',
    aiPaused: false,
    lastMessageAt: '2026-11-23T11:30:00.000Z',
    contactName: 'Ayşe Kaya',
    isPhonebookContact: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    phone: '+905559998877',
    remoteJid: '905559998877@s.whatsapp.net',
    aiPaused: true,
    lastMessageAt: '2026-11-23T11:10:00.000Z',
    contactName: 'Mehmet Demir',
    isPhonebookContact: true,
  },
]

const sampleMessages = [
  {
    id: '33333333-3333-4333-8333-333333333331',
    direction: 'inbound',
    text: 'Yarın için randevu müsaitliğiniz var mı?',
    replyText: 'Merhaba, yarın 14:00 ve 16:30 saatleri müsaittir.',
    status: 'sent',
    deliveryStatus: 'delivered',
    error: null,
    createdAt: '2026-11-23T11:30:00.000Z',
  },
]

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 25))
  })
}

async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

async function setInput(el: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
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
  vi.clearAllMocks()
})

describe('Gelen Kayıtlar sekmesi ve WhatsApp taşınması', () => {
  it('Gelen Kayıtlar sekmesi WhatsApp gelen mesajları gösterir, filtreler, mesaj açar ve personel desteğine alır', async () => {
    let conversationsState = sampleConversations.map(c => ({ ...c }))
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/whatsapp/') {
        return { ok: true, json: async () => sampleConfigs } as Response
      }
      if (url.endsWith('/conversations') && (!init?.method || init.method === 'GET')) {
        return { ok: true, json: async () => conversationsState } as Response
      }
      if (url.includes('/conversations/') && url.endsWith('/messages')) {
        return { ok: true, json: async () => sampleMessages } as Response
      }
      if (url.includes('/conversations/') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body || '{}'))
        const convId = url.split('/conversations/')[1]
        conversationsState = conversationsState.map(c => (c.id === convId ? { ...c, aiPaused: Boolean(body.paused) } : c))
        return { ok: true, json: async () => ({ success: true }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root.render(<GelenKayitlarTab />)
    })
    await flush()

    const text = container.textContent || ''
    expect(text).toContain('Gelen Kayıtlar')
    expect(text).toContain('WhatsApp Gelen Mesajlar')
    expect(text).toContain('Ayşe Kaya')
    expect(text).toContain('Mehmet Demir')
    expect(text).toContain('Tümü (2)')
    expect(text).toContain('Yapay Zeka Açık (1)')
    expect(text).toContain('Personel Desteğinde (1)')

    // Durum filtresi: Personel Desteğinde
    const staffBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Personel Desteğinde (1)'),
    )
    await click(staffBtn)
    expect(container.textContent).toContain('Mehmet Demir')
    expect(container.textContent).not.toContain('Ayşe Kaya')

    // Tümü + arama
    const allBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Tümü (2)'))
    await click(allBtn)
    const searchInput = container.querySelector('input[type="search"]') as HTMLInputElement
    expect(searchInput).toBeTruthy()
    await setInput(searchInput, 'Ayşe')
    expect(container.textContent).toContain('Ayşe Kaya')
    expect(container.textContent).not.toContain('Mehmet Demir')

    // Sohbet seçimi ve mesaj görüntüleme
    const convBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Ayşe Kaya'))
    await click(convBtn)
    await flush()
    expect(container.textContent).toContain('Yarın için randevu müsaitliğiniz var mı?')
    expect(container.textContent).toContain('Yapay zeka yanıtı')

    // Personel desteğine alma
    const pauseBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Personel desteğine al'),
    )
    await click(pauseBtn)
    await flush()
    expect(
      fetchMock.mock.calls.some(
        ([u, init]) => String(u).includes('/conversations/22222222-2222-4222-8222-222222222221') && init?.method === 'PUT',
      ),
    ).toBe(true)
    expect(container.textContent).toContain('Sonraki mesajlarda yapay zekayı aç')
  })

  it('Bilgi Tabanı artık WhatsApp Gelen Mesajlar bileşenini içermez', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/knowledge')) {
        return { ok: true, json: async () => ({ docs: [], totalEmbedded: 0, needsReindex: 0 }) } as Response
      }
      if (url.startsWith('/api/admin/categories')) {
        return { ok: true, json: async () => [] } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root.render(<KnowledgeTab />)
    })
    await flush()

    const text = container.textContent || ''
    expect(text).toContain('Bilgi Bankası ve Yapay Zeka Akışları')
    expect(text).not.toContain('WhatsApp Gelen Mesajlar')
    expect(text).not.toContain('WhatsApp Sohbetleri')
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/admin/whatsapp'))).toBe(false)
  })
})
