import { NextRequest, NextResponse } from 'next/server'
import { getTenantForwardingHeaders } from '@/lib/forwarded-request'
import { fetchBackend } from '@/lib/backend-request'

export const dynamic = 'force-dynamic'

async function requestEphemeralLiveToken(req: NextRequest) {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-forwarded-for': req.headers.get('x-forwarded-for') || '',
      'user-agent': req.headers.get('user-agent') || '',
      ...getTenantForwardingHeaders(req),
    }
    const cookie = req.headers.get('cookie')
    if (cookie) {
      headers.cookie = cookie
    }

    const res = await fetchBackend('/api/web-assistant/live-token', {
      method: 'POST',
      headers,
      body: '{}',
    })

    let data: Record<string, unknown> = {}
    try {
      const text = await res.text()
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      data = { error: 'Sunucudan geçersiz yanıt alındı.' }
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          error: typeof data.error === 'string' && data.error.trim()
            ? data.error
            : 'Sesli asistan oturumu şu anda başlatılamadı.',
          ...(typeof data.code === 'string' ? { code: data.code } : {}),
        },
        { status: res.status },
      )
    }

    const token = typeof data.token === 'string' ? data.token.trim() : ''
    if (!token) {
      return NextResponse.json(
        { error: 'Geçici sesli oturum anahtarı oluşturulamadı.' },
        { status: 502 },
      )
    }

    return NextResponse.json({
      apiKey: token,
      token,
      expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
      ephemeral: true,
    })
  } catch (error) {
    console.error('[Direct Session] Ephemeral token request failed', error)
    return NextResponse.json(
      { error: 'Sesli asistan servisine şu anda ulaşılamıyor.' },
      { status: 503 },
    )
  }
}

export async function GET(req: NextRequest) {
  return requestEphemeralLiveToken(req)
}

export async function POST(req: NextRequest) {
  return requestEphemeralLiveToken(req)
}
