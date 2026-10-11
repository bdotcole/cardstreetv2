/**
 * "How did you hear about us?" — the fallback for signups whose channel the
 * cookie never captured.
 *
 * Measured 2026-09-05 over the 111 accounts created since the attribution
 * column shipped: 27 had a null column. 26 of those land in the first two days
 * (the pre-2026-08-25 backlog, permanently unrecoverable from the data), and
 * ~2% keeps leaking — all OAuth, all cases where /api/auth/callback ran but
 * found no cs_attribution cookie. No amount of cookie hardening recovers a
 * cookie a browser refused to store, so the remaining source of truth is the
 * person who signed up.
 *
 * Writes into the SAME profiles.signup_attribution column rather than a new one:
 * every query that already groups by src/med picks the answers up for free, and
 * `w: 'survey'` keeps self-reported rows separable from measured ones — they
 * are not the same evidence and should never be silently pooled.
 *
 * GET  -> { needed, options }
 * POST { source } -> { ok }
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
// SURVEY_SOURCES lives in lib/attribution.ts, not here: a route module may only
// export the HTTP handlers (Next.js type-checks that), and the client card needs
// the same list.
import { SURVEY_SOURCES } from '@/lib/attribution';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Only ask accounts younger than this. The question is "how did you hear about
 * us", and someone who signed up five months ago is guessing, not reporting —
 * a guess stored beside measured data is worse than a gap. 90 days matches
 * ATTRIBUTION_MAX_AGE_SECONDS, the window the cookie itself would have covered.
 */
const MAX_ACCOUNT_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Attribution values that mean "we never found out" and can still be filled. */
function isUnresolved(attr: unknown): boolean {
    if (!attr || typeof attr !== 'object') return true;
    const src = (attr as { src?: unknown }).src;
    return src === 'unknown';
}

export async function GET() {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    const noStore = { headers: { 'Cache-Control': 'no-store' } };
    if (!user) return NextResponse.json({ needed: false }, noStore);

    const admin = createAdminClient();
    const { data, error } = await admin
        .from('profiles')
        .select('created_at, signup_attribution')
        .eq('id', user.id)
        .single();

    // Fail closed on a read error: an unnecessary prompt is a worse outcome
    // than a missed one.
    if (error || !data) return NextResponse.json({ needed: false }, noStore);

    const ageMs = Date.now() - new Date(data.created_at as string).getTime();
    const needed =
        Number.isFinite(ageMs) &&
        ageMs < MAX_ACCOUNT_AGE_MS &&
        isUnresolved(data.signup_attribution);

    return NextResponse.json({ needed, options: SURVEY_SOURCES }, noStore);
}

export async function POST(req: Request) {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const source = body?.source;
    if (!SURVEY_SOURCES.includes(source)) {
        return NextResponse.json({ error: 'Unknown source' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
        .from('profiles')
        .select('created_at, signup_attribution')
        .eq('id', user.id)
        .single();
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

    // A measured record always beats a self-reported one — never overwrite one.
    // (The eq() filter below cannot express "is null OR src=unknown", so the
    // decision is made here and the write is idempotent either way.)
    if (!isUnresolved(profile.signup_attribution)) {
        return NextResponse.json({ ok: true, stored: false, reason: 'already_attributed' });
    }

    const { error } = await admin
        .from('profiles')
        .update({
            signup_attribution: {
                src: source,
                med: 'survey',
                lp: '/',
                ts: new Date().toISOString().slice(0, 10),
                w: 'survey',
            },
        })
        .eq('id', user.id);

    if (error) {
        console.error('[Attribution/Survey] write failed:', error.message);
        return NextResponse.json({ error: 'Save failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, stored: true });
}
