import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit, requestIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records the user's verdict on a scan result (see 20260710_scan_learning.sql).
 *
 * POST { scanId, outcome: 'confirmed' | 'rejected', cardId? }
 *
 * The clients wire this to implicit signals — picking a candidate, adding the
 * scanned card to a collection (confirmed), or bailing to manual search
 * (rejected) — so there is no extra UI.
 *
 * On a confirm, the captured photo's dHash is added to the learned-phash index
 * so future scans of the same card match photo-to-photo. Anti-poisoning: the
 * confirmed cardId must be one of the candidates the scanner itself returned
 * for that scan (candidate_ids), and each scan's outcome is recorded once —
 * first verdict wins. Endpoint is deliberately fail-soft: it is telemetry, and
 * must never surface an error into the scan UX.
 */
export async function POST(req: Request) {
    try {
        const ip = requestIp(req);
        const limit = await checkRateLimit(`scanfb:${ip}:1m`, { windowSeconds: 60, max: 30 });
        if (!limit.allowed) {
            return NextResponse.json({ ok: false }, { status: 429 });
        }

        const body = await req.json().catch(() => null);
        const scanId = typeof body?.scanId === 'string' ? body.scanId : '';
        const outcome = body?.outcome;
        const cardId = typeof body?.cardId === 'string' && body.cardId.length <= 64 ? body.cardId : null;

        if (!UUID_RE.test(scanId) || (outcome !== 'confirmed' && outcome !== 'rejected')) {
            return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 });
        }

        const admin = createAdminClient();
        const { data: event, error: readError } = await admin
            .from('scan_events')
            .select('id, outcome, phash, candidate_ids')
            .eq('id', scanId)
            .maybeSingle();

        // Table missing (migration not applied) or DB hiccup: swallow — feedback
        // is best-effort and the client fires and forgets.
        if (readError) {
            console.warn('[scan/feedback] read failed (non-fatal):', readError.message);
            return NextResponse.json({ ok: false });
        }
        if (!event) {
            return NextResponse.json({ ok: false, error: 'Unknown scan' }, { status: 404 });
        }
        if (event.outcome) {
            return NextResponse.json({ ok: true, alreadyRecorded: true });
        }

        const { error: updateError } = await admin
            .from('scan_events')
            .update({
                outcome,
                confirmed_card_id: outcome === 'confirmed' ? cardId : null,
                outcome_at: new Date().toISOString(),
            })
            .eq('id', scanId)
            .is('outcome', null);
        if (updateError) {
            console.warn('[scan/feedback] update failed (non-fatal):', updateError.message);
            return NextResponse.json({ ok: false });
        }

        if (
            outcome === 'confirmed' &&
            cardId &&
            event.phash &&
            Array.isArray(event.candidate_ids) &&
            event.candidate_ids.includes(cardId)
        ) {
            const { error: learnError } = await admin.rpc('record_learned_phash', {
                p_card_id: cardId,
                p_phash: event.phash,
            });
            if (learnError) console.warn('[scan/feedback] learn failed (non-fatal):', learnError.message);
        }

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.warn('[scan/feedback] error (non-fatal):', e?.message ?? e);
        return NextResponse.json({ ok: false });
    }
}
