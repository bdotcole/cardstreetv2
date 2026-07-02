import { NextResponse } from 'next/server';
import { scannerService } from '@/services/scannerService';
import { checkRateLimit, requestIp } from '@/lib/rateLimit';

// nodejs runtime is required: the pHash step uses `sharp` for image decoding,
// which is a native module unavailable in Edge.
export const runtime = 'nodejs';
// 300s (Pro plan ceiling) so the slow tail — SerpApi fallback, pathological
// Gemini responses — degrades gracefully instead of 504ing mid-pipeline.
export const maxDuration = 300;

export async function POST(req: Request) {
    try {
        // Per-IP abuse cap. Scanning is unauthenticated (the Expo app calls it
        // without Supabase cookies) and every request costs a Gemini call, so
        // this is the cost/abuse backstop. A real scan takes 4-8s, so 15/min
        // never throttles a human; 500/day covers a full binder-cataloging
        // session. The limiter fails open — never blocks scans on a DB hiccup.
        const ip = requestIp(req);
        const [minute, day] = await Promise.all([
            checkRateLimit(`scan:${ip}:1m`, { windowSeconds: 60, max: 15 }),
            checkRateLimit(`scan:${ip}:1d`, { windowSeconds: 86400, max: 500 }),
        ]);
        if (!minute.allowed || !day.allowed) {
            return NextResponse.json(
                { error: 'Too many scans from this connection. Please wait a moment and try again.' },
                { status: 429, headers: { 'Retry-After': minute.allowed ? '3600' : '30' } },
            );
        }

        const payload = await req.json();

        if (!payload.image && !payload.text) {
            return NextResponse.json({ error: 'No image or native text payload provided' }, { status: 400 });
        }

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
