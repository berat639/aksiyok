import { describe, expect, test } from 'bun:test'
import { generateWhatsAppReply } from './whatsapp-live'

describe('generateWhatsAppReply structured history', () => {
  test('geçmiş mesajları systemInstruction yerine yapılandırılmış contents dizisine aktarır', async () => {
    let capturedCall: { contents?: unknown; config?: { systemInstruction?: string } } | null = null
    const mockAi = {
      models: {
        generateContent: async (args: { contents?: unknown; config?: { systemInstruction?: string } }) => {
          capturedCall = args
          return { text: 'Tabii, size yardımcı olayım.', functionCalls: [] }
        },
      },
    } as any

    const reply = await generateWhatsAppReply(
      {
        model: 'gemini-3.8-live',
        systemPrompt: 'Kanal: WhatsApp. İşletme: Test İşletme.',
        history: [
          { role: 'user', text: 'Merhaba' },
          { role: 'model', text: 'Merhaba, nasıl yardımcı olabilirim?' },
          { role: 'assistant', text: 'Saat seçebilirsiniz.' },
          { role: 'user', text: 'Yarın 14:00 uygun mu?' },
        ],
        text: 'Yarın 14:00 uygun mu?',
        tools: [],
        executeTool: async () => ({}),
      },
      mockAi,
    )

    expect(reply).toBe('Tabii, size yardımcı olayım.')
    expect(capturedCall).not.toBeNull()
    const sys = capturedCall!.config?.systemInstruction || ''
    expect(sys).toContain('Kanal: WhatsApp. İşletme: Test İşletme.')
    expect(sys).not.toContain('"role":"user"')
    expect(sys).not.toContain('Merhaba, nasıl yardımcı olabilirim?')

    const contents = capturedCall!.contents as Array<{ role: string; parts: Array<{ text: string }> }>
    expect(contents).toHaveLength(3)
    expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'Merhaba' }] })
    expect(contents[1]).toEqual({
      role: 'model',
      parts: [{ text: 'Merhaba, nasıl yardımcı olabilirim?\nSaat seçebilirsiniz.' }],
    })
    expect(contents[2]).toEqual({ role: 'user', parts: [{ text: 'Yarın 14:00 uygun mu?' }] })
  })
})
