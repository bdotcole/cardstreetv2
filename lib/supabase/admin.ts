import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client for admin API routes.
 * Bypasses RLS — use ONLY in server-side code (Route Handlers, Server Actions).
 * NEVER expose this to the client.
 */
export function createAdminClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Missing Supabase admin credentials')
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    })
}
