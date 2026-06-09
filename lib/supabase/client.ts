import { createBrowserClient } from '@supabase/ssr'
import { SupabaseClient, processLock } from '@supabase/supabase-js'
import { sentryFetch } from './sentryFetch'

export function createClient(): SupabaseClient {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            global: {
                fetch: sentryFetch
            },
            // Use Supabase's in-memory lock instead of the default Web Locks API
            // (navigator.locks). navigator.locks can deadlock inside the iOS
            // WKWebView (Capacitor), making signInWithPassword/signUp/getSession
            // hang forever — the "indefinite loading" that got the app rejected.
            // processLock is single-context safe and works identically on web/Android.
            auth: {
                lock: processLock
            }
        }
    )
}
