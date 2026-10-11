/**
 * Admin access to the weekly insights report.
 *
 *   GET  ?brand=&weekEnd=YYYY-MM-DD   build (and store) the report, return html + stats + narrative
 *   GET  ?id=<report id>              the stored email as text/html (open in a tab)
 *   POST { brand, weekEnd?, to? }     build, store and SEND now (defaults to the configured recipient)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { produceWeeklyReport, insightsRecipient } from '@/lib/social/insights';
import { SOCIAL_BRANDS, type SocialBrand } from '@/lib/social/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function brandOf(v: string | null | undefined): SocialBrand {
    return (SOCIAL_BRANDS as string[]).includes(v ?? '') ? (v as SocialBrand) : 'cardstreet';
}

export async function GET(request: NextRequest) {
    const gate = await requireAdmin();
    if (gate) return gate;
    const sp = request.nextUrl.searchParams;

    const id = sp.get('id');
    if (id) {
        if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });
        const { data, error } = await createAdminClient().from('social_insight_reports').select('html').eq('id', id).maybeSingle();
        if (error || !data?.html) return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 });
        return new NextResponse(data.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    const weekEnd = sp.get('weekEnd');
    try {
        const r = await produceWeeklyReport(brandOf(sp.get('brand')), { weekEnd: weekEnd && DAY_RE.test(weekEnd) ? weekEnd : undefined, send: false });
        return NextResponse.json({ reportId: r.reportId, stats: r.stats, narrative: r.narrative, html: r.html, recipient: insightsRecipient(), storeError: r.error });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Report failed' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const gate = await requireAdmin();
    if (gate) return gate;
    const body = await request.json().catch(() => ({}));
    const weekEnd = typeof body.weekEnd === 'string' && DAY_RE.test(body.weekEnd) ? body.weekEnd : undefined;
    const to = typeof body.to === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.to) ? body.to : undefined;
    try {
        const r = await produceWeeklyReport(brandOf(body.brand), { weekEnd, send: true, to });
        return NextResponse.json({ reportId: r.reportId, sent: r.sent, sentTo: r.sentTo, headline: r.narrative.headline, narrativeBy: r.narrative.generatedBy, storeError: r.error });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Send failed' }, { status: 500 });
    }
}
