// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { resetGoogleMapsLoaderForTests } from '@/lib/google-maps-loader'
import GenelBilgilerSection from './GenelBilgilerSection'

let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

const byText = (text: string) =>
  Array.from(container.querySelectorAll<HTMLElement>('button, h2, h3, span, p, label, div')).find(
    (el) => el.textContent?.trim() === text,
  )

const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function mockFetch() {
  return vi.fn(async (url: string) => {
    const body = url.startsWith('/api/calendar/working-hours')
      ? { startTime: '09:00', endTime: '19:00', workingDays: [0, 1, 2, 3, 4, 5] }
      : url.startsWith('/api/admin/settings/working-hours')
        ? { workingHours: { startTime: '09:00', endTime: '19:00', workingDays: [0, 1, 2, 3, 4, 5] } }
        : {}
    return { ok: true, json: async () => body } as Response
  })
}

beforeEach(() => {
  window.localStorage.clear()
  resetGoogleMapsLoaderForTests()
  vi.stubGlobal('fetch', mockFetch())
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('GenelBilgilerSection', () => {
  it('hero şeridi, 4 bölüm kartı ve temel alanları render eder', async () => {
    await act(async () => root.render(<GenelBilgilerSection scope="c1" />))
    await flush()

    expect(container.textContent).toContain('Ana İşletme')
    expect(container.textContent).toContain('İşletme Ekle')
    expect(container.textContent).toContain('Bugün:')
    expect(container.textContent).toContain('İşletme adı ve kategorisi')
    expect(container.textContent).toContain('Çalışma saatleri')
    expect(container.textContent).toContain('Tam Adres Tarifi')
    expect(container.textContent).toContain('Konum ve Google Harita')
    expect(container.textContent).toContain('İşletme konumu')
    expect(container.textContent).toContain('Cmt')
    expect(container.querySelector('#isletme-adi')).toBeTruthy()
    expect(container.querySelector('#isletme-adres-tarifi')).toBeTruthy()
    expect(container.querySelector('#isletme-konum-ara')).toBeTruthy()
  })

  it('kategori alanı tek kategori seçer ve arama ile günceller', async () => {
    await act(async () => root.render(<GenelBilgilerSection scope="c1" />))
    await flush()

    const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!
    await act(async () => {
      input.focus()
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    expect(container.textContent).toContain('Popüler kategorileri keşfedin')
    await click(byText('Hizmetler'))
    await click(byText('Çilingir'))
    expect(container.textContent).toContain('Çilingir')
    expect(container.textContent).not.toContain('· Birincil')

    await type(container.querySelector<HTMLInputElement>('input[role="combobox"]')!, 'kuaf')
    await click(Array.from(container.querySelectorAll('[role="option"]')).find((o) => o.textContent?.startsWith('Kuaför')))
    expect(container.textContent).toContain('Kuaför')
    expect(container.textContent).not.toContain('Çilingir')
  })

  it('eksik alanlarla kaydetmeye izin vermez; zorunlu alan hatalarını gösterir', async () => {
    await act(async () => root.render(<GenelBilgilerSection scope="c1" />))
    await flush()

    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Kaydet'))
    expect(container.textContent).toContain('İşletme adı gerekli.')
    expect(container.textContent).toContain('Bir işletme kategorisi seçin.')
    expect(container.textContent).toContain('İşletme konumunu belirleyin.')
  })

  it('çalışma saatleri takvim ayarından başlar, gün açıp kapatır ve özel saatleri açar', async () => {
    await act(async () => root.render(<GenelBilgilerSection scope="c1" />))
    await flush()

    const sat = container.querySelector<HTMLButtonElement>('[aria-label="Cumartesi açık"]')
    expect(sat).toBeTruthy()
    expect(container.textContent).toContain('09:00')
    await click(container.querySelector('[aria-label="Pazar kapalı"]'))
    expect(container.querySelector('[aria-label="Pazar açık"]')).toBeTruthy()
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Günlere özel saat belirle')))
    expect(container.textContent).toContain('Pazartesi')
  })

  it('konum araması adresi ve Google Harita embed iframe URL sini günceller', async () => {
    await act(async () => root.render(<GenelBilgilerSection scope="c1" />))
    await flush()

    const iframe = container.querySelector<HTMLIFrameElement>('iframe[title="İşletme konumu Google Harita"]')
    expect(iframe?.src).toContain('maps.google.com/maps')
    expect(iframe?.src).not.toContain('openstreetmap')

    await type(container.querySelector<HTMLInputElement>('#isletme-konum-ara')!, 'Çankaya')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 360))
    })
    await click(Array.from(container.querySelectorAll('[role="option"]')).find((o) => o.textContent?.includes('Çankaya')))
    expect(container.textContent).toContain('Çankaya, Ankara')
    expect(container.querySelector<HTMLIFrameElement>('iframe')?.src).toContain('39.9179,32.8627')
  })

  it('çoklu işletme ekleme/seçme/kaldırma ve dolu profil kaydını tamamlar', async () => {
    const onSaved = vi.fn()
    await act(async () => root.render(<GenelBilgilerSection scope="c1" onSaved={onSaved} />))
    await flush()

    await type(container.querySelector<HTMLInputElement>('#isletme-adi')!, 'Örnek İşletme Merkez')
    const catInput = container.querySelector<HTMLInputElement>('input[role="combobox"]')!
    await act(async () => {
      catInput.focus()
      catInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    await click(byText('Hizmetler'))
    await click(byText('Çilingir'))

    await type(container.querySelector<HTMLInputElement>('#isletme-konum-ara')!, 'Çankaya')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 360))
    })
    await click(Array.from(container.querySelectorAll('[role="option"]')).find((o) => o.textContent?.includes('Çankaya')))

    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'İşletme Ekle'))
    expect(container.textContent).toContain('+1 şube')
    expect(container.textContent).toContain('İşletme 2')
    expect(container.textContent).toContain('Ortak kategori:')

    await type(container.querySelector<HTMLInputElement>('#isletme-adi')!, 'Örnek İşletme Şube')
    expect(container.textContent).toContain('Örnek İşletme Şube')

    await click(container.querySelector('[aria-label="Bu işletmeyi kaldır"]'))
    expect(container.textContent).not.toContain('+1 şube')
    expect(container.textContent).toContain('Örnek İşletme Merkez')

    await click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Kaydet'))
    await flush()

    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Genel işletme bilgileri kaydedildi.')
    expect(container.textContent).toContain('Takvim saat aralığı')
  })
})
