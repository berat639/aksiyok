// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FlowAiChatBox from './FlowAiChatBox'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('FlowAiChatBox kanal bazlı sohbet ve akış üretimi', () => {
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
    vi.restoreAllMocks()
  })

  it('her asistan kanalı için ayrı sohbet geçmişi tutar ve yanıtla akışı günceller', async () => {
    const messagesByDir: Record<string, any[]> = {
      inbound: [
        {
          id: 'in_1',
          direction: 'inbound',
          role: 'user',
          content: 'Arayandan adını alalım.',
          appliedFlow: false,
          nodeCount: null,
          edgeCount: null,
          changeSummary: null,
          canRevert: false,
          createdAt: '2026-11-16T00:00:00.000Z',
        },
      ],
      whatsapp: [],
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method || 'GET').toUpperCase()
      if (url.startsWith('/api/admin/flow/ai-chat') && method === 'GET') {
        const u = new URL(url, 'http://localhost')
        const dir = u.searchParams.get('direction') || 'inbound'
        return new Response(JSON.stringify({ direction: dir, messages: messagesByDir[dir] || [] }), { status: 200 })
      }
      if (url === '/api/admin/flow/ai-chat' && method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}'))
        const generatedFlow = {
          nodes: [
            { id: 'start', type: 'START', position: { x: 100, y: 40 }, data: { label: 'WhatsApp Hoş Geldiniz' } },
            {
              id: 'wa_msg',
              type: 'ACTION',
              position: { x: 100, y: 180 },
              data: { label: 'WhatsApp Yanıt', action: 'send_wa_message', message: 'Buyurun, yardımcı olalım.' },
            },
            { id: 'end', type: 'END', position: { x: 100, y: 320 }, data: { label: 'Bitir' } },
          ],
          edges: [
            { id: 'e1', source: 'start', target: 'wa_msg' },
            { id: 'e2', source: 'wa_msg', target: 'end' },
          ],
        }
        messagesByDir[body.direction] = [
          {
            id: 'wa_u1',
            direction: body.direction,
            role: 'user',
            content: body.message,
            appliedFlow: false,
            nodeCount: null,
            edgeCount: null,
            changeSummary: null,
            canRevert: false,
            createdAt: '2026-11-16T00:01:00.000Z',
          },
          {
            id: 'wa_a1',
            direction: body.direction,
            role: 'assistant',
            content: 'WhatsApp akışınızı isteğinize göre hazırladım.',
            appliedFlow: true,
            nodeCount: 3,
            edgeCount: 2,
            changeSummary: 'WhatsApp yanıt adımı eklendi',
            canRevert: true,
            createdAt: '2026-11-16T00:01:01.000Z',
          },
        ]
        return new Response(
          JSON.stringify({
            direction: body.direction,
            reply: 'WhatsApp akışınızı isteğinize göre hazırladım.',
            appliedFlow: true,
            changeSummary: 'WhatsApp yanıt adımı eklendi',
            flow: generatedFlow,
            issues: [],
            messages: messagesByDir[body.direction],
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const onApplyGeneratedFlow = vi.fn()
    const getCurrentGraph = () => ({ nodes: [], edges: [] })

    // 1. Inbound (Gelen Arama) ile başlat ve aç
    await act(async () => {
      root.render(
        <FlowAiChatBox
          direction="inbound"
          getCurrentGraph={getCurrentGraph}
          onApplyGeneratedFlow={onApplyGeneratedFlow}
        />,
      )
    })
    await flushMicrotasks()

    const inboundBtn = container.querySelector('[data-testid="flow-ai-chat-toggle-inbound"]') as HTMLButtonElement
    expect(inboundBtn).toBeTruthy()
    await act(async () => {
      inboundBtn.click()
    })
    expect(container.textContent).toContain('Arayandan adını alalım.')

    // 2. WhatsApp kanalına geç: inbound mesajı gizlenmeli, WhatsApp boş durumu görünmeli
    await act(async () => {
      root.render(
        <FlowAiChatBox
          direction="whatsapp"
          getCurrentGraph={getCurrentGraph}
          onApplyGeneratedFlow={onApplyGeneratedFlow}
        />,
      )
    })
    await flushMicrotasks()

    const waBtn = container.querySelector('[data-testid="flow-ai-chat-toggle-whatsapp"]') as HTMLButtonElement
    await act(async () => {
      waBtn.click()
    })
    expect(container.textContent).not.toContain('Arayandan adını alalım.')

    // 3. WhatsApp sohbetine senaryo yaz ve gönder
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(textarea, 'WhatsApp üzerinden müşteriye hoş geldin mesajı göndersin.')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushMicrotasks()

    expect(onApplyGeneratedFlow).toHaveBeenCalledTimes(1)
    expect(onApplyGeneratedFlow.mock.calls[0][1].direction).toBe('whatsapp')
    expect(container.textContent).toContain('WhatsApp akışınızı isteğinize göre hazırladım.')
    expect(container.textContent).toContain('Önceki Akışa Dön')
  })

  it('son değişikliği geri alabilir ve yalnızca aktif kanalın sohbet geçmişini temizler', async () => {
    const revertRequests: any[] = []
    const deleteUrls: string[] = []

    const initialAssistant = {
      id: 'out_a1',
      direction: 'outbound',
      role: 'assistant',
      content: 'Giden arama anket akışı güncellendi.',
      appliedFlow: true,
      nodeCount: 3,
      edgeCount: 2,
      changeSummary: 'Anket adımı eklendi',
      canRevert: true,
      createdAt: '2026-11-16T00:02:00.000Z',
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method || 'GET').toUpperCase()
        if (url.startsWith('/api/admin/flow/ai-chat') && method === 'GET') {
          return new Response(JSON.stringify({ direction: 'outbound', messages: [initialAssistant] }), { status: 200 })
        }
        if (url === '/api/admin/flow/ai-chat/revert' && method === 'POST') {
          const body = JSON.parse(String(init?.body || '{}'))
          revertRequests.push(body)
          return new Response(
            JSON.stringify({
              direction: 'outbound',
              flow: {
                nodes: [
                  { id: 'start', type: 'START', position: { x: 100, y: 40 }, data: { label: 'Başla' } },
                  { id: 'end', type: 'END', position: { x: 100, y: 200 }, data: { label: 'Bitir' } },
                ],
                edges: [{ id: 'e0', source: 'start', target: 'end' }],
              },
              issues: [],
              messages: [{ ...initialAssistant, appliedFlow: false, canRevert: false }],
            }),
            { status: 200 },
          )
        }
        if (url.startsWith('/api/admin/flow/ai-chat') && method === 'DELETE') {
          deleteUrls.push(url)
          return new Response(JSON.stringify({ direction: 'outbound', messages: [] }), { status: 200 })
        }
        return new Response(JSON.stringify({}), { status: 200 })
      }),
    )

    const onApplyGeneratedFlow = vi.fn()
    await act(async () => {
      root.render(
        <FlowAiChatBox
          direction="outbound"
          getCurrentGraph={() => ({ nodes: [], edges: [] })}
          onApplyGeneratedFlow={onApplyGeneratedFlow}
        />,
      )
    })
    await flushMicrotasks()

    const toggle = container.querySelector('[data-testid="flow-ai-chat-toggle-outbound"]') as HTMLButtonElement
    await act(async () => {
      toggle.click()
    })

    const revertBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Önceki Akışa Dön'),
    ) as HTMLButtonElement
    expect(revertBtn).toBeTruthy()
    await act(async () => {
      revertBtn.click()
    })
    await flushMicrotasks()

    expect(revertRequests).toEqual([{ direction: 'outbound', messageId: 'out_a1' }])
    expect(onApplyGeneratedFlow).toHaveBeenCalledTimes(1)
    expect(onApplyGeneratedFlow.mock.calls[0][1].direction).toBe('outbound')

    const clearBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Temizle'),
    ) as HTMLButtonElement
    await act(async () => {
      clearBtn.click()
    })
    const confirmDel = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Sil') as HTMLButtonElement
    await act(async () => {
      confirmDel.click()
    })
    await flushMicrotasks()

    expect(deleteUrls).toEqual(['/api/admin/flow/ai-chat?direction=outbound'])
    expect(container.textContent).not.toContain('Giden arama anket akışı güncellendi.')
  })
})
