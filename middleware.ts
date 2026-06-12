import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// The native Capacitor shells append this marker to their WebView user-agent
// (appendUserAgent in capacitor.config.ts), so the app is always recognized
// as mobile even where WebView UAs misreport the device — iPad WKWebViews
// identify themselves as desktop Macs.
const APP_UA_MARKER = 'CardStreetApp'

// Clean public URLs owned by the desktop experience. They render from the
// internal /desktop/* tree; phones hitting them are bounced to the mobile SPA.
const DESKTOP_ONLY_PREFIXES = ['/card', '/sell', '/orders']

// Same URL, different experience: desktop browsers get the desktop site,
// phones and the native app get the mobile SPA. The cs_view cookie (set via
// the ?view= escape hatch below) is a manual override in either direction.
function isDesktopClient(request: NextRequest): boolean {
    const override = request.cookies.get('cs_view')?.value
    if (override === 'mobile') return false
    if (override === 'desktop') return true

    const ua = request.headers.get('user-agent') ?? ''
    if (ua.includes(APP_UA_MARKER)) return false
    return !/Android|iPhone|iPod|iPad|Mobile|Mobi/i.test(ua)
}

function withUaVary(response: NextResponse): NextResponse {
    // The HTML served at this URL depends on the user-agent, so any cache
    // between us and the user must key on it.
    response.headers.set('Vary', 'User-Agent')
    return response
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    if (pathname.startsWith('/admin')) {
        return adminGuard(request)
    }

    // ?view=desktop / ?view=mobile pins the experience via cookie. This is the
    // only mobile→desktop escape hatch for now, since the mobile UI is frozen.
    const viewParam = request.nextUrl.searchParams.get('view')
    if (viewParam === 'mobile' || viewParam === 'desktop') {
        const url = request.nextUrl.clone()
        url.searchParams.delete('view')
        const response = NextResponse.redirect(url)
        response.cookies.set('cs_view', viewParam, { path: '/' })
        return response
    }

    if (pathname === '/') {
        if (isDesktopClient(request)) {
            const url = request.nextUrl.clone()
            url.pathname = '/desktop'
            return withUaVary(NextResponse.rewrite(url))
        }
        return withUaVary(NextResponse.next())
    }

    if (DESKTOP_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
        if (isDesktopClient(request)) {
            const url = request.nextUrl.clone()
            url.pathname = `/desktop${pathname}`
            return withUaVary(NextResponse.rewrite(url))
        }
        // Phones land on the mobile SPA. The card id rides along as a query
        // param so the SPA can learn to deep-link into it later.
        const url = request.nextUrl.clone()
        const cardId = pathname.startsWith('/card/') ? pathname.slice('/card/'.length) : ''
        url.pathname = '/'
        if (cardId) url.searchParams.set('card', cardId)
        return withUaVary(NextResponse.redirect(url))
    }

    // /desktop/* is an internal rendering target, not a public URL. Rewrites
    // don't re-enter middleware, so any request seen here was typed directly —
    // send it to the canonical clean URL.
    if (pathname === '/desktop' || pathname.startsWith('/desktop/')) {
        const url = request.nextUrl.clone()
        url.pathname = pathname === '/desktop' ? '/' : pathname.slice('/desktop'.length)
        return NextResponse.redirect(url)
    }

    return NextResponse.next()
}

// Guards /admin routes — but lets the login page through.
async function adminGuard(request: NextRequest) {
    const { pathname } = request.nextUrl

    if (pathname.startsWith('/admin/login')) {
        return NextResponse.next()
    }

    const response = NextResponse.next({
        request: { headers: request.headers },
    })

    // Build a server-side Supabase client using cookies
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // Get the current session (reads from cookie)
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        const loginUrl = new URL('/admin/login', request.nextUrl.origin)
        return NextResponse.redirect(loginUrl)
    }

    // Check admin role via profiles table
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

    if (!profile || profile.role !== 'admin') {
        const loginUrl = new URL('/admin/login', request.nextUrl.origin)
        loginUrl.searchParams.set('error', 'not_admin')
        return NextResponse.redirect(loginUrl)
    }

    return response
}

export const config = {
    matcher: ['/admin/:path*', '/', '/card/:path*', '/sell', '/orders', '/desktop/:path*'],
}
