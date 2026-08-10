import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// The native Capacitor shells append this marker to their WebView user-agent
// (appendUserAgent in capacitor.config.ts), so the app is always recognized
// as mobile even where WebView UAs misreport the device — iPad WKWebViews
// identify themselves as desktop Macs.
const APP_UA_MARKER = 'CardStreetApp'

// Public content URLs (card / set / seller pages + game landing pages). These
// render from the internal /desktop/* tree for EVERY browser — the page bodies
// are responsive, so phones get the same server-rendered HTML as desktops.
// Serving one document per URL (instead of bouncing phones to the SPA) is what
// makes these pages visible to Google's mobile-first crawler. Only the native
// Capacitor app keeps the old redirect into the SPA, which deep-links /card/*
// via the ?card= param.
const PUBLIC_CONTENT_PREFIXES = ['/card', '/sets', '/seller']

// Game landing pages: clean top-level URLs that render from /desktop/games/*.
// Universal (all devices) like the other public content pages.
const GAME_LANDING_PATHS = ['/pokemon', '/mtg', '/yugioh', '/one-piece', '/riftbound', '/lorcana']

// Account/workflow URLs owned by the desktop experience. They render from the
// internal /desktop/* tree; phones hitting them are bounced to the mobile SPA.
const DESKTOP_ONLY_PREFIXES = ['/sell', '/orders', '/collection', '/settings']

// URLs that exist for BOTH experiences at the same path: desktop browsers get
// the desktop-shell wrapper under /desktop/*, phones keep the standalone page
// (never redirected — the native shells deep-link here).
const DESKTOP_WRAPPED_PREFIXES = ['/premium']

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

// The native Capacitor shells navigate card links through the SPA's own
// deep-link handling, so only they keep the redirect-to-SPA behavior on the
// public content URLs. Every real browser (including crawlers) gets the page.
function isNativeApp(request: NextRequest): boolean {
    return (request.headers.get('user-agent') ?? '').includes(APP_UA_MARKER)
}

function withUaVary(response: NextResponse): NextResponse {
    // The HTML served at this URL depends on the user-agent, so any cache
    // between us and the user must key on it.
    response.headers.set('Vary', 'User-Agent')
    return response
}

// Locale-in-URL scheme (see lib/i18nRouting.ts): Thai is canonical at the bare
// path, English lives under /en, /th/* is an alias that redirects to bare.
// First-visit default is Thai (the canonical market language) — English is
// opt-in via the /en prefix or the in-app language toggle, not geo-negotiated.
type Lang = 'EN' | 'TH'
const LANG_COOKIE = 'cs_lang'

// Shared attributes for the cookies middleware sets (cs_lang, cs_view). Secure
// only in production so localhost dev over http still gets them; SameSite=Lax
// keeps them on top-level navigations (how they're always set) while blocking
// cross-site send.
const COOKIE_OPTS = { path: '/', sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' }

// Resolve the internal render target for a locale-stripped path, applying the
// existing desktop-vs-mobile routing. Kept separate from locale handling so the
// two concerns don't tangle.
type Decision =
    | { kind: 'rewrite'; pathname: string; uaVary: boolean }
    // `permanent` marks a redirect that is a property of the URL itself (a
    // fixed alias) rather than of this request's user-agent. Only those may be
    // 308 — a UA-conditional bounce must stay temporary, or a browser that
    // cached it would keep bouncing after the UA (or cs_view override) changes.
    | { kind: 'redirect'; pathname: string; search?: string; uaVary: boolean; permanent?: boolean }
    | { kind: 'next'; uaVary: boolean }

function resolveExperience(request: NextRequest, basePath: string): Decision {
    if (basePath === '/') {
        return isDesktopClient(request)
            ? { kind: 'rewrite', pathname: '/desktop', uaVary: true }
            : { kind: 'next', uaVary: true }
    }

    if (PUBLIC_CONTENT_PREFIXES.some((p) => basePath === p || basePath.startsWith(`${p}/`))) {
        // The native app bounces to the SPA (deep-linking /card/* via ?card=);
        // every browser — phone, desktop, crawler — gets the server-rendered page.
        if (isNativeApp(request)) {
            const cardId = basePath.startsWith('/card/') ? basePath.slice('/card/'.length) : ''
            return { kind: 'redirect', pathname: '/', search: cardId ? `?card=${cardId}` : '', uaVary: true }
        }
        return { kind: 'rewrite', pathname: `/desktop${basePath}`, uaVary: true }
    }

    if (GAME_LANDING_PATHS.includes(basePath)) {
        return { kind: 'rewrite', pathname: `/desktop/games${basePath}`, uaVary: false }
    }

    if (DESKTOP_ONLY_PREFIXES.some((p) => basePath === p || basePath.startsWith(`${p}/`))) {
        if (isDesktopClient(request)) {
            return { kind: 'rewrite', pathname: `/desktop${basePath}`, uaVary: true }
        }
        // Phones land on the mobile SPA — these are account surfaces whose
        // mobile equivalents live inside the SPA's own tabs.
        return { kind: 'redirect', pathname: '/', search: '', uaVary: true }
    }

    if (DESKTOP_WRAPPED_PREFIXES.some((p) => basePath === p || basePath.startsWith(`${p}/`))) {
        return isDesktopClient(request)
            ? { kind: 'rewrite', pathname: `/desktop${basePath}`, uaVary: true }
            : { kind: 'next', uaVary: true }
    }

    // /desktop/* is an internal rendering target, not a public URL. Rewrites
    // don't re-enter middleware, so any request seen here was typed directly —
    // send it to the canonical clean URL.
    if (basePath === '/desktop' || basePath.startsWith('/desktop/')) {
        return { kind: 'redirect', pathname: basePath === '/desktop' ? '/' : basePath.slice('/desktop'.length), uaVary: false, permanent: true }
    }

    return { kind: 'next', uaVary: false }
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    // Admin is not localized. A locale-prefixed admin URL (/en/admin, /th/admin)
    // must be redirected to the canonical bare path FIRST — otherwise the /en
    // branch below rewrites it to the internal /admin route without re-entering
    // middleware, so adminGuard never runs and the console renders to anyone.
    // Redirecting sends a fresh /admin request that re-enters middleware and
    // hits adminGuard.
    if (pathname.startsWith('/en/admin') || pathname.startsWith('/th/admin')) {
        const url = request.nextUrl.clone()
        url.pathname = pathname.replace(/^\/(en|th)/, '')
        return NextResponse.redirect(url)
    }

    // Admin is not localized and has its own auth flow.
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
        response.cookies.set('cs_view', viewParam, COOKIE_OPTS)
        return response
    }

    // --- Locale prefix handling ---
    let locale: Lang | null = null
    let basePath = pathname
    if (pathname === '/en' || pathname.startsWith('/en/')) {
        locale = 'EN'
        basePath = pathname.slice('/en'.length) || '/'
    } else if (pathname === '/th' || pathname.startsWith('/th/')) {
        // Thai is canonical at the bare path — strip the redundant prefix.
        // 308 (permanent): /th/* is a fixed alias, so search engines should
        // consolidate its signals onto the bare URL rather than keep recrawling.
        const url = request.nextUrl.clone()
        url.pathname = pathname.slice('/th'.length) || '/'
        const res = NextResponse.redirect(url, 308)
        res.cookies.set(LANG_COOKIE, 'TH', COOKIE_OPTS)
        return res
    }

    const cookieLang = request.cookies.get(LANG_COOKIE)?.value as Lang | undefined
    const lang: Lang = locale ?? (cookieLang === 'EN' || cookieLang === 'TH' ? cookieLang : 'TH')

    // The chosen language travels to the server render via a request header so
    // the root layout can set <html lang> and seed the settings provider on the
    // very first request, before the cookie round-trips.
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-cs-lang', lang)
    // URL-derived locale only (never the cookie): buildAlternatesForRequest
    // uses this to keep each locale variant's canonical pointing at itself.
    requestHeaders.set('x-cs-path-locale', locale === 'EN' ? 'en' : 'th')

    const applyLang = (res: NextResponse): NextResponse => {
        if (cookieLang !== lang) res.cookies.set(LANG_COOKIE, lang, COOKIE_OPTS)
        return res
    }

    const decision = resolveExperience(request, basePath)
    const prefix = locale === 'EN' ? '/en' : ''

    if (decision.kind === 'redirect') {
        const url = request.nextUrl.clone()
        url.pathname = `${prefix}${decision.pathname}`
        url.search = decision.search ?? ''
        const res = NextResponse.redirect(url, decision.permanent ? 308 : 307)
        return decision.uaVary ? withUaVary(applyLang(res)) : applyLang(res)
    }

    if (decision.kind === 'rewrite') {
        const url = request.nextUrl.clone()
        url.pathname = decision.pathname
        const res = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
        return decision.uaVary ? withUaVary(applyLang(res)) : applyLang(res)
    }

    // kind === 'next'. Under /en there is no /en/* route, so rewrite to the
    // bare route while keeping the /en URL in the browser.
    if (locale === 'EN') {
        const url = request.nextUrl.clone()
        url.pathname = basePath
        const res = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
        return decision.uaVary ? withUaVary(applyLang(res)) : applyLang(res)
    }

    const res = NextResponse.next({ request: { headers: requestHeaders } })
    return decision.uaVary ? withUaVary(applyLang(res)) : applyLang(res)
}

// Guards /admin routes — but lets the login page through.
async function adminGuard(request: NextRequest) {
    const { pathname } = request.nextUrl

    // Forward the real admin path to the server layout (via a header middleware
    // controls — it overwrites any client-supplied value) so the layout's
    // defense-in-depth requireAdmin can let /admin/login through while guarding
    // every other admin page.
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-pathname', pathname)

    if (pathname.startsWith('/admin/login')) {
        return NextResponse.next({ request: { headers: requestHeaders } })
    }

    const response = NextResponse.next({
        request: { headers: requestHeaders },
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
    matcher: [
        '/admin/:path*',
        '/',
        '/card/:path*',
        '/sets',
        '/sets/:path*',
        '/seller/:path*',
        '/sell',
        '/orders',
        '/collection',
        '/settings',
        '/premium',
        // Game landing pages (see GAME_LANDING_PATHS).
        '/pokemon',
        '/mtg',
        '/yugioh',
        '/one-piece',
        '/riftbound',
        '/lorcana',
        '/desktop/:path*',
        // Locale prefixes and the localized public content pages.
        '/en',
        '/en/:path*',
        '/th',
        '/th/:path*',
        '/faq',
        '/help',
        '/terms',
        '/privacy',
        '/contact',
        '/prices',
        '/graded',
        '/sell-cards',
        '/become-a-breaker',
    ],
}
