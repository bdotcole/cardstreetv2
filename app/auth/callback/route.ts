import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * /auth/callback
 *
 * This route handles the PKCE OAuth code exchange for server-side sessions.
 * Supabase redirects here after Google/OAuth login with ?code=...
 * We exchange it for a session that gets stored in an HTTP cookie,
 * which the middleware can then read to protect /admin routes.
 *
 * Query params:
 *   code  - PKCE auth code from Supabase
 *   next  - where to redirect after successful auth (defaults to '/')
 *   error - error from Supabase (we forward to the next page)
 */
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const next = searchParams.get('next') ?? '/'
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    // Forward any auth errors back to the destination
    if (error) {
        const redirectUrl = new URL(next, origin)
        redirectUrl.searchParams.set('error', error)
        if (errorDescription) redirectUrl.searchParams.set('error_description', errorDescription)
        return NextResponse.redirect(redirectUrl)
    }

    if (code) {
        const cookieStore = await cookies()

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll()
                    },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    },
                },
            }
        )

        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

        if (!exchangeError) {
            // Session cookie is now set — redirect to the intended destination
            return NextResponse.redirect(new URL(next, origin))
        }

        console.error('[auth/callback] Code exchange failed:', exchangeError.message)
    }

    // Fallback: redirect to home with an error
    const redirectUrl = new URL('/', origin)
    redirectUrl.searchParams.set('error', 'auth_failed')
    return NextResponse.redirect(redirectUrl)
}
