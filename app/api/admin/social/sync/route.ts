/**
 * POST /api/admin/social/sync  { days?, brand?, accountId? }
 *
 * "Sync now" from the dashboard, and the first backfill after a connect
 * (days=90). Same orchestrator as the cron; this one just answers to an
 * admin cookie instead of CRON_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { syncSocialAccounts, DEFAULT_SYNC_DAYS, MAX_SYNC_DAYS } from '@/lib/social/sync';
import { SOCIAL_BRANDS, type SocialBrand } from '@/lib/social/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
    const gate = await requireAdmin();
    if (gate) return gate;

    const body = await request.json().catch(() => ({}));
    const days = Math.max(1, Math.min(MAX_SYNC_DAYS, Number(body.days) || DEFAULT_SYNC_DAYS));
    const brand = (SOCIAL_BRANDS as string[]).includes(body.brand) ? (body.brand as SocialBrand) : undefined;
    const accountId = typeof body.accountId === 'string' ? body.accountId : undefined;

    try {
        const summary = await syncSocialAccounts({ days, brand, accountId });
        return NextResponse.json(summary);
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Sync failed' }, { status: 500 });
    }
}
