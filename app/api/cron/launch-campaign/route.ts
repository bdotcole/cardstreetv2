/**
 * Vercel cron, every 10 minutes: sends the Oct 9 "shipping inside the listing
 * price" announcements on their schedule — four emails to every user, two
 * pushes to sellers with listings.
 *
 * The schedule is the campaign_messages table (migration
 * 20260930_campaign_messages.sql); the copy, audiences and the run loop are in
 * lib/launchCampaign.ts. Every run is safe to repeat: a recipient is claimed
 * in campaign_sends before anything is sent, so nobody gets a message twice,
 * and a run that hits its time budget is finished by the next one.
 *
 * No-ops until the migration is applied. Remove this route and its
 * vercel.json entry once the campaign is over (after 2026-10-09).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runLaunchCampaign } from '@/lib/launchCampaign';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Stop starting new sends well inside maxDuration; the next run continues.
const BUDGET_MS = 240_000;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    try {
        const result = await runLaunchCampaign(admin, Date.now() + BUDGET_MS);
        return NextResponse.json(result);
    } catch (error) {
        console.error('[Campaign] Run failed:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 });
    }
}
