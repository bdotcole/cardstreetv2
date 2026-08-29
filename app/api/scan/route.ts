import { NextResponse } from 'next/server';
import { scannerService } from '@/services/scannerService';
import { checkRateLimit, requestIp } from '@/lib/rateLimit';
import { createClient as createServerClient } from '@/lib/supabase/server';

// nodejs runtime is required: the pHash step uses `sharp` for image decoding,
// which is a native module unavailable in Edge.
export const runtime = 'nodejs';
// 300s (Pro plan ceiling) so the slow tail — pathological Gemini responses,
// retried transient failures — degrades gracefully instead of 504ing mid-pipeline.
export const maxDuration = 300;

export async function POST(req: Request) {
    try {
        // Per-IP abuse cap. Scanning is unauthenticated (the Expo app calls it
        // without Supabase cookies) and every request costs a Gemini call, so
        // this is the cost/abuse backstop. A real scan takes 4-8s, so 15/min
        // never throttles a human; 500/day covers a full binder-cataloging
        // session. The limiter fails open — never blocks scans on a DB hiccup.
        const ip = requestIp(req);
        // Coarse GLOBAL ceiling on top of the per-IP windows. Two reasons it's
        // fail-CLOSED (unlike the per-IP checks): (1) it caps total Gemini spend
        // even when an attacker rotates IPs to dodge the per-IP cap, and (2)
        // because it blocks on a limiter outage, a Supabase hiccup can't uncap
        // this unauthenticated, paid endpoint. Generous vs real traffic; tune via
        // SCAN_GLOBAL_MAX_PER_MIN.
        const globalMax = Number(process.env.SCAN_GLOBAL_MAX_PER_MIN) || 300;
        const [minute, day, global] = await Promise.all([
            checkRateLimit(`scan:${ip}:1m`, { windowSeconds: 60, max: 15 }),
            checkRateLimit(`scan:${ip}:1d`, { windowSeconds: 86400, max: 500 }),
            checkRateLimit('scan:global:1m', { windowSeconds: 60, max: globalMax, failClosed: true }),
        ]);
        if (!minute.allowed || !day.allowed || !global.allowed) {
            return NextResponse.json(
                { error: 'Too many scans right now. Please wait a moment and try again.' },
                { status: 429, headers: { 'Retry-After': !day.allowed ? '3600' : '30' } },
            );
        }

        const payload = await req.json();

        if (!payload.image && !payload.text) {
            return NextResponse.json({ error: 'No image or native text payload provided' }, { status: 400 });
        }

        // OPTIONAL attribution for Collector Pass scan awards: resolve the
        // cookie session if one rode along; anonymous scans keep working
        // exactly as before. The client can never claim an identity — any
        // body-supplied userId is overwritten here.
        payload.userId = null;
        try {
            const { data: { user } } = await (await createServerClient()).auth.getUser();
            payload.userId = user?.id ?? null;
        } catch { /* anonymous scan */ }

        const result = await scannerService.scanCard(payload);
        return NextResponse.json(result);
    } catch (error: any) {
        console.error('API /api/scan Error:', error);

        if (error.message?.includes('API key') || error.message?.includes('GEMINI_API_KEY')) {
            return NextResponse.json({
                error: 'API keys are not configured correctly. Please set GEMINI_API_KEY.'
            }, { status: 403 });
        }

        return NextResponse.json({ error: error.message || 'Scan failed' }, { status: 500 });
    }
}
