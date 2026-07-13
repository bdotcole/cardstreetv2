import { createAdminClient } from '@/lib/supabase/admin'

/**
 * DB-backed fixed-window rate limiter (supabase/migrations/20260702_rate_limits.sql).
 * Server-side only — uses the service-role client.
 *
 * Fail-open by DEFAULT: a limiter hiccup (DB error, missing migration) must not
 * take down the endpoint it protects, so errors log and allow. Pass
 * `failClosed: true` for a coarse cost ceiling where "block on a limiter outage"
 * is safer than "allow unbounded" — e.g. the global budget on the
 * unauthenticated, paid /api/scan endpoint.
 */
export async function checkRateLimit(
    key: string,
    { windowSeconds, max, failClosed = false }: { windowSeconds: number; max: number; failClosed?: boolean },
): Promise<{ allowed: boolean; count: number }> {
    try {
        const admin = createAdminClient()
        const { data, error } = await admin.rpc('bump_rate_limit', {
            p_key: key,
            p_window_seconds: windowSeconds,
        })
        if (error || typeof data !== 'number') {
            if (error) console.error('[rateLimit] bump failed:', error.message)
            return { allowed: !failClosed, count: 0 }
        }
        return { allowed: data <= max, count: data }
    } catch (e) {
        console.error('[rateLimit] error:', e)
        return { allowed: !failClosed, count: 0 }
    }
}

/**
 * Client IP for rate-limit keys. On Vercel, x-forwarded-for's first hop is the
 * real client IP (Vercel strips spoofed values at the edge).
 */
export function requestIp(req: Request): string {
    const fwd = req.headers.get('x-forwarded-for')
    if (fwd) return fwd.split(',')[0].trim()
    return req.headers.get('x-real-ip') ?? 'unknown'
}
