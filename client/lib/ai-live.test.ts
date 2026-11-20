import { describe, expect, it, vi } from 'vitest'
import { AiLiveSession, hasSpokenFarewell } from './ai-live'

describe('hasSpokenFarewell (Web Asistan Otomatik Mikrofon Kapatma)', () => {
  it('standart Türkçe kapanış ve veda cümlelerini algılar', () => {
    expect(hasSpokenFarewell('Randevunuz oluşturuldu, sağlıklı günler dilerim, hoşça kalın.')).toBe(true)
    expect(hasSpokenFarewell('Yardımcı olabileceğim başka bir konu yoksa iyi günler dilerim.')).toBe(true)
    expect(hasSpokenFarewell('Görüşmemizi sonlandırıyorum, iyi akşamlar.')).toBe(true)
    expect(hasSpokenFarewell('Tekrar görüşmek üzere, kendinize iyi bakın.')).toBe(true)
  })

  it('kliniğe özel konu dışı kapanış mesajını algılar', () => {
    const customMsg = 'Talebiniz kaydedildi, kliniğimizde bekliyoruz.'
    expect(hasSpokenFarewell('Teşekkür ederiz. Talebiniz kaydedildi, kliniğimizde bekliyoruz.', customMsg)).toBe(true)
  })

  it('açılış karşılamalarını ve soru cümlelerini yanlışlıkla veda saymaz', () => {
    expect(hasSpokenFarewell('İyi günler, kliniğimize hoş geldiniz, size nasıl yardımcı olabilirim?')).toBe(false)
    expect(hasSpokenFarewell('İyi akşamlar, hangi gün için randevu istersiniz?')).toBe(false)
    expect(hasSpokenFarewell('Merhaba, adınızı ve soyadınızı öğrenebilir miyim?')).toBe(false)
  })

  it('ephemeral veya __server__ anahtarıyla yazılı modda /api/web-assistant/chat uç noktasını kullanır ve ham anahtar sızdırmaz', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Merhaba, randevu konusunda size yardımcı olabilirim.' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const receivedTexts: string[] = []
      let turnCompleted = false
      const session = new AiLiveSession({
        onAudioChunk: () => {},
        onText: (t) => receivedTexts.push(t),
        onTurnComplete: () => { turnCompleted = true },
        onConnectionChange: () => {},
        onError: (e) => { throw new Error(e) },
        onInterrupted: () => {},
      })

      await session.connect(
        'auth_tokens/ephemeral-test-token',
        {
          systemPrompt: 'Test talimatı',
          toolDeclarations: [],
          model: 'gemini-3.8-live',
          textModel: 'gemini-3.8-flash',
          greeting: 'Merhaba',
          branding: { title: 'Test', subtitle: '', logoUrl: '' },
        },
        'text',
      )

      session.sendText('Yarın saat 14:00 uygun mu?')
      await new Promise((r) => setTimeout(r, 25))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/web-assistant/chat')
      expect(receivedTexts).toEqual(['Merhaba, randevu konusunda size yardımcı olabilirim.'])
      expect(turnCompleted).toBe(true)
      session.disconnect()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
