import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    // Only guard /admin routes
    if (!pathname.startsWith('/admin')) {
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

    // Get the current session
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = '/'
        redirectUrl.searchParams.set('error', 'unauthorized')
        return NextResponse.redirect(redirectUrl)
    }

    // Check admin role via profiles table
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

    if (!profile || profile.role !== 'admin') {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = '/'
        redirectUrl.searchParams.set('error', 'unauthorized')
        return NextResponse.redirect(redirectUrl)
    }

    return response
}

export const config = {
    matcher: ['/admin/:path*'],
}
