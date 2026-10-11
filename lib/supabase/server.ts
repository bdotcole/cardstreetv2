import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { sentryFetch } from './sentryFetch'

export async function createClient() {
    const cookieStore = await cookies()

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            global: {
                fetch: sentryFetch
            },
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    // Server Components may not write cookies, and Next throws if
                    // they try. A signed-in visitor whose access token expired makes
                    // the client refresh it mid-render (card, set and seller pages),
                    // which threw here. Route Handlers and Server Actions still
                    // persist the refresh; in a render the browser client refreshes
                    // its own session on the next load.
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    } catch {
                        // Called from a Server Component render.
                    }
                }
            }
        }
    )
}
