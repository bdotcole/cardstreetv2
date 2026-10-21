// close-auctions -- every-minute auction lifecycle tick (pg_cron → this fn).
//
// Deliberately a thin relay into POST /api/auctions/sweep on the Next.js app:
// all the state transitions are Postgres RPCs, but the money/shipping math
// (partner-tier fees, Pro floor, live Flash quotes) lives in the app's lib/
// modules, and duplicating it in Deno would drift. Wired like release-funds
// on the cron side; auth into the app is the CRON_SECRET bearer, same as the
// Vercel mirror-images cron.
//
// Required function secrets:
//   CRON_SECRET   -- must match the Vercel env of the same name
//   APP_BASE_URL  -- optional, defaults to https://cardstreet.app

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (_req) => {
    try {
        const cronSecret = Deno.env.get('CRON_SECRET')
        if (!cronSecret) {
            throw new Error('CRON_SECRET function secret is not set')
        }
        const baseUrl = (Deno.env.get('APP_BASE_URL') || 'https://cardstreet.app').replace(/\/$/, '')

        console.log('[close-auctions] Running auction sweep...')
        const res = await fetch(`${baseUrl}/api/auctions/sweep`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${cronSecret}`,
                'Content-Type': 'application/json',
            },
        })

        const body = await res.text()
        if (!res.ok) {
            console.error(`[close-auctions] Sweep responded ${res.status}: ${body}`)
            return new Response(
                JSON.stringify({ success: false, status: res.status, body }),
                { status: 500, headers: { 'Content-Type': 'application/json' } },
            )
        }

        console.log(`[close-auctions] Sweep OK: ${body}`)
        return new Response(body, { headers: { 'Content-Type': 'application/json' } })
    } catch (error) {
        console.error('[close-auctions] Fatal error:', error)
        return new Response(
            JSON.stringify({ error: (error as Error).message || 'Internal server error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
        )
    }
})
