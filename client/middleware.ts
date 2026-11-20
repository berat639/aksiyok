import { NextRequest, NextResponse } from 'next/server'

function decodeJwtPayload(token: string): { sub: string; role: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.exp && payload.exp * 1000 < Date.now()) return null
    return payload
  } catch { return null }
}

const PROTECTED_PREFIXES = ['/admin', '/panel', '/yonetici', '/calisan', '/hekim', '/host', '/shift', '/bildirimler', '/profil']
const ROLE_ROUTES: Record<string, string[]> = {
  yonetici: ['/admin', '/yonetici', '/panel', '/calisan', '/shift', '/bildirimler', '/profil'],
  moderator: ['/admin', '/yonetici', '/panel', '/calisan', '/shift', '/bildirimler', '/profil'],
  calisan: ['/panel', '/calisan', '/shift', '/bildirimler', '/profil'],
  hekim: ['/panel', '/calisan', '/hekim', '/shift', '/bildirimler', '/profil'],
  sekreter: ['/panel', '/calisan', '/shift', '/bildirimler', '/profil'],
  asistan: ['/panel', '/calisan', '/shift', '/bildirimler', '/profil'],
  host: ['/panel', '/calisan', '/host', '/shift', '/bildirimler', '/profil'],
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (pathname === '/login' || pathname === '/kayit' || pathname.startsWith('/kayit/') || pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // /admin → /panel redirect
  if (pathname.startsWith('/admin')) {
    const token = req.cookies.get('token')?.value
    if (!token) return NextResponse.redirect(new URL('/login', req.url))
    const payload = decodeJwtPayload(token)
    if (!payload || (payload.role !== 'yonetici' && payload.role !== 'moderator')) return NextResponse.redirect(new URL('/login', req.url))
    return NextResponse.redirect(new URL('/panel', req.url))
  }

  // /hekim ve /host → /panel yönlendirmesi (tek birleşik çalışma alanı)
  if (pathname === '/hekim' || pathname.startsWith('/hekim/') || pathname === '/host' || pathname.startsWith('/host/') || pathname === '/calisan' || pathname.startsWith('/calisan/')) {
    const token = req.cookies.get('token')?.value
    if (!token) return NextResponse.redirect(new URL('/login', req.url))
    const payload = decodeJwtPayload(token)
    if (!payload) return NextResponse.redirect(new URL('/login', req.url))
    return NextResponse.redirect(new URL('/panel', req.url))
  }

  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p))
  if (!isProtected) return NextResponse.next()

  const token = req.cookies.get('token')?.value
  if (!token) return NextResponse.redirect(new URL('/login', req.url))

  const payload = decodeJwtPayload(token)
  if (!payload) return NextResponse.redirect(new URL('/login', req.url))

  const role = payload.role
  const allowed = ROLE_ROUTES[role] || ROLE_ROUTES.calisan
  if (!allowed) return NextResponse.redirect(new URL('/login', req.url))

  const hasAccess = allowed.some(p => pathname.startsWith(p))
  if (!hasAccess) {
    return NextResponse.redirect(new URL('/panel', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/panel/:path*', '/yonetici/:path*', '/calisan/:path*', '/hekim/:path*', '/host/:path*', '/shift/:path*', '/bildirimler/:path*', '/profil/:path*', '/login'],
}
