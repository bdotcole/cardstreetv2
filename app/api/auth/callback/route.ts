import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATTRIBUTION_COOKIE, parseAttribution, withWriter } from '@/lib/attribution'

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
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            // OAuth signups are invisible to the browser at click time — the page
            // has already navigated away to the provider, and only this exchange
            // reveals whether the returning user is new. Mark a brand-new account
            // on the redirect so the client can fire the GA4 sign_up event inside
            // THIS browser session, which is the only place the acquisition
            // channel still exists (components/SignupTracker.tsx picks it up).
            //
            // Age of created_at is the test. last_sign_in_at cannot be used:
            // Supabase leaves it frozen at signup for the large majority of
            // accounts, so it never distinguishes a new account from an old one.
            const createdAt = data?.user?.created_at
            const isNewAccount = createdAt
                ? Date.now() - new Date(createdAt).getTime() < 60_000
                : false
            if (!isNewAccount) {
                return NextResponse.redirect(`${base}${next}`)
            }
            // Durable first-touch attribution for OAuth signups. Metadata cannot
            // be injected through an OAuth round trip the way it can on
            // supabase.auth.signUp, so the cookie AttributionCapture wrote is read
            // here and written straight to the profile the trigger just created.
            //
            // Service role rather than the user's own session: this is a one-shot
            // system write, and routing it through RLS would make the column
            // depend on a policy that exists for a different purpose.
            //
            // Fails soft on purpose. If the migration adding the column has not
            // run, or the profile row is not visible yet, the user must still get
            // signed in — an analytics field is never worth failing auth over.
            const attribution = parseAttribution(cookieStore.get(ATTRIBUTION_COOKIE)?.value)
            if (attribution && data?.user?.id) {
                try {
                    const admin = createAdminClient()
                    const { error: attrErr } = await admin
                        .from('profiles')
                        .update({ signup_attribution: withWriter(attribution, 'callback') })
                        .eq('id', data.user.id)
                        .is('signup_attribution', null)
                    if (attrErr) console.error('[Auth Callback] attribution write failed:', attrErr.message)
                } catch (e) {
                    console.error('[Auth Callback] attribution write threw:', e)
                }
            }
            // Carry the provider through so the event can say google vs apple
            // rather than guessing; SignupTracker falls back to a plain oauth.
            const provider = data?.user?.app_metadata?.provider ?? 'oauth'
            const sep = next.includes('?') ? '&' : '?'
            return NextResponse.redirect(
                `${base}${next}${sep}cs_new_account=${encodeURIComponent(provider)}`
            )
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
