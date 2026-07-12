import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')

    // Check for cookie intention in case Supabase strips query params on fallback
    const cookieStore = await cookies()
    const storedNext = cookieStore.get('cardstreet_auth_redirect')?.value

    // if "next" is in param, use it; otherwise fallback to cookie, then '/'
    const requestedNext = searchParams.get('next') ?? storedNext ?? '/'
    // Only honor same-site relative paths. `next` is concatenated onto the base
    // origin below, so `//evil.com`, `/\evil.com` (protocol-relative host swaps)
    // and `@evil.com` (userinfo host swap) would all redirect off-site — an
    // open-redirect / phishing vector. Anything that isn't a clean single-slash
    // path falls back to the homepage.
    const next =
        requestedNext.startsWith('/') &&
        !requestedNext.startsWith('//') &&
        !requestedNext.startsWith('/\\')
            ? requestedNext
            : '/'

    // Resolve the public-facing origin once. In production the request reaches us
    // behind a load balancer, so the original host is in x-forwarded-host; falling
    // back to it (then host, then the request origin) keeps every redirect below
    // on the host the user's browser is actually on.
    const forwardedHost = request.headers.get('x-forwarded-host')
    const host = request.headers.get('host')
    const isLocalEnv = process.env.NODE_ENV === 'development'
    const base = isLocalEnv
        ? origin
        : forwardedHost
            ? `https://${forwardedHost}`
            : host && !host.includes('localhost')
                ? `https://${host}`
                : origin

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            return NextResponse.redirect(`${base}${next}`)
        }

        // The PKCE auth code is single-use. A duplicated/retried callback request
        // (browser speculative load, double navigation, flaky-network retry), or
        // an OAuth round-trip made while a valid session already existed, lands
        // here with a "code already used / verifier mismatch" error even though
        // the user IS authenticated. Don't bounce an authenticated user to an
        // error page — confirm the session and continue to `next`. getUser()
        // validates the token with Supabase, so we never honor a forged cookie.
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            return NextResponse.redirect(`${base}${next}`)
        }

        // Log the real error server-side; show the user only a static code.
        // Reflecting error.message into the redirect URL is an XSS / phishing
        // surface (an attacker can craft a code that produces a chosen string).
        console.error('[Auth Callback] Code exchange failed:', error.message)
        return NextResponse.redirect(`${base}/?error=auth_failed&code=exchange_failed`)
    }

    // return the user to an error page with instructions
    console.error('[Auth Callback] Code missing')
    return NextResponse.redirect(`${base}/?error=auth_failed&code=missing_code`)
}
