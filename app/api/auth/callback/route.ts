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
    const next = searchParams.get('next') ?? storedNext ?? '/'

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            const forwardedHost = request.headers.get('x-forwarded-host') // original origin before load balancer
            const isLocalEnv = process.env.NODE_ENV === 'development'

            if (isLocalEnv) {
                return NextResponse.redirect(`${origin}${next}`)
            } else if (forwardedHost) {
                return NextResponse.redirect(`https://${forwardedHost}${next}`)
            } else {
                const host = request.headers.get('host')
                if (host && !host.includes('localhost')) {
                    return NextResponse.redirect(`https://${host}${next}`)
                }
                return NextResponse.redirect(`${origin}${next}`)
            }
        } else {
            // Log the real error server-side; show the user only a static code.
            // Reflecting error.message into the redirect URL is an XSS / phishing
            // surface (an attacker can craft a code that produces a chosen string).
            console.error('[Auth Callback] Code exchange failed:', error.message)
            return NextResponse.redirect(`${origin}/?error=auth_failed&code=exchange_failed`)
        }
    }

    // return the user to an error page with instructions
    console.error('[Auth Callback] Code missing')
    return NextResponse.redirect(`${origin}/?error=auth_failed&code=missing_code`)
}
