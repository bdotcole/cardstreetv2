/**
 * POST /api/live/lots/[id]/randomize — the server-side fairness randomizer.
 *
 * The seller never rolls dice on camera; the server draws entropy, derives a
 * deterministic Fisher-Yates shuffle from sha256(seed + step), and logs the
 * seed + full assignment map to break_randomizations (immutable audit).
 * Anyone can re-run the shuffle from the published seed and verify the result.
 *
 * Two purposes:
 *   spot_to_pack   (random_pack) — shuffle pack numbers 1..(spots*packs_per_spot)
 *                  across ALL spots, sold or not. The map must be fixed before
 *                  the reveal so a buyer's purchase can never re-roll anyone's
 *                  packs, and unsold spots' packs stay visible (they belong to
 *                  the house, on the record). One run per lot, ever.
 *   hit_assignment (chase_break) — a pulled hit lands on one of the SOLD spots
 *                  only: hits belong to buyers, and an unsold spot winning a
 *                  hit would hand it back to the seller. One run per hit.
 */

import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { postSystemChat, requireLotBroadcaster } from '@/lib/liveBreaks';

/**
 * Deterministic Fisher-Yates: swap index j at step i comes from
 * sha256(`${seed}:${i}`). 6 digest bytes give a 48-bit integer; the modulo
 * bias over at most 10,000 candidates is < 2^-34 — negligible for fairness
 * and, more importantly, exactly reproducible from the stored seed.
 */
function seededShuffle<T>(items: readonly T[], seed: string): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const digest = createHash('sha256').update(`${seed}:${i}`).digest();
        const j = digest.readUIntBE(0, 6) % (i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

interface SpotLite {
    id: string;
    spot_number: number;
    status: string;
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireLotBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, lot, stream } = ctx;

        const body = await req.json().catch(() => ({}));
        const purpose = body?.purpose;
        if (purpose !== 'spot_to_pack' && purpose !== 'hit_assignment') {
            return NextResponse.json(
                { error: "purpose must be 'spot_to_pack' or 'hit_assignment'" },
                { status: 400 },
            );
        }

        const admin = createAdminClient();
        const seed = randomBytes(16).toString('hex');

        const { data: allSpots } = await admin
            .from('break_spots')
            .select('id, spot_number, status')
            .eq('stream_item_id', lot.id)
            .order('spot_number', { ascending: true })
            .returns<SpotLite[]>();
        const spots = allSpots ?? [];
        if (spots.length === 0) {
            return NextResponse.json({ error: 'Lot has no spots' }, { status: 409 });
        }

        if (purpose === 'spot_to_pack') {
            // pick_your_pack is deterministic by definition and chase_break
            // assigns hits, not packs — only random_pack shuffles the map.
            if (lot.item_type !== 'random_pack') {
                return NextResponse.json(
                    { error: 'spot_to_pack randomization only applies to random_pack lots' },
                    { status: 400 },
                );
            }

            // One map per lot, ever. A re-roll after buyers have seen (or
            // bought against) the map is exactly the manipulation the audit
            // table exists to prevent.
            const { data: existing } = await admin
                .from('break_randomizations')
                .select('id')
                .eq('stream_item_id', lot.id)
                .eq('purpose', 'spot_to_pack')
                .limit(1);
            if (existing && existing.length > 0) {
                return NextResponse.json(
                    { error: 'Pack map already randomized for this lot', code: 'ALREADY_RANDOMIZED' },
                    { status: 409 },
                );
            }

            const packsPerSpot = lot.packs_per_spot || 1;
            const packCount = spots.length * packsPerSpot;
            const packs = Array.from({ length: packCount }, (_, i) => i + 1);
            const shuffled = seededShuffle(packs, seed);

            const assignments = spots.map((spot, i) => ({
                spot: spot.spot_number,
                packs: shuffled
                    .slice(i * packsPerSpot, (i + 1) * packsPerSpot)
                    .sort((a, b) => a - b),
            }));

            // Audit row FIRST: if the spot updates below partially fail, the
            // logged map is still the binding one and a retry can re-apply it.
            const { error: auditErr } = await admin.from('break_randomizations').insert({
                stream_item_id: lot.id,
                stream_id: stream.id,
                run_by: user.id,
                purpose,
                seed,
                algorithm: 'fisher-yates-sha256',
                assignments,
            });
            if (auditErr) {
                // The partial unique index on (stream_item_id, purpose) WHERE
                // purpose='spot_to_pack' closes the race the pre-check above
                // can lose: two concurrent runs both read "no existing map"
                // and both insert. The loser's 23505 means a binding map
                // already exists — same outcome as the pre-check.
                if (auditErr.code === '23505') {
                    return NextResponse.json(
                        { error: 'Pack map already randomized for this lot', code: 'ALREADY_RANDOMIZED' },
                        { status: 409 },
                    );
                }
                console.error('[Live/Randomize] audit insert failed:', auditErr.message);
                return NextResponse.json({ error: 'Failed to record randomization' }, { status: 500 });
            }

            const updateErrors: string[] = [];
            for (let i = 0; i < spots.length; i++) {
                const { error } = await admin
                    .from('break_spots')
                    .update({ assigned_packs: assignments[i].packs })
                    .eq('id', spots[i].id);
                if (error) updateErrors.push(`${spots[i].spot_number}: ${error.message}`);
            }
            if (updateErrors.length > 0) {
                console.error('[Live/Randomize] assigned_packs updates failed:', updateErrors);
            }

            await postSystemChat(
                stream.id,
                user.id,
                `Pack randomizer: ${spots.length} spots shuffled across ${packCount} packs. Seed ${seed}`,
            );

            return NextResponse.json({ success: true, purpose, seed, assignments });
        }

        // ─── hit_assignment ───
        if (lot.item_type !== 'chase_break') {
            return NextResponse.json(
                { error: 'hit_assignment randomization only applies to chase_break lots' },
                { status: 400 },
            );
        }
        // Hits are pulled and assigned on camera — the audit row anchors to a
        // moment viewers watched.
        if (stream.status !== 'live') {
            return NextResponse.json(
                { error: 'Stream must be live to assign hits' },
                { status: 409 },
            );
        }
        const hit = typeof body?.hit === 'string' ? body.hit.trim() : '';
        if (hit.length === 0 || hit.length > 200) {
            return NextResponse.json(
                { error: 'hit (1-200 chars) is required for hit_assignment' },
                { status: 400 },
            );
        }

        // One run per hit: re-rolling an already-assigned hit until it lands
        // on a preferred spot is the hit-side twin of the pack-map re-roll.
        // Matched on the exact hit string — a genuinely distinct second copy
        // of the same card must be entered with a distinguishing suffix.
        const { data: dupHit } = await admin
            .from('break_randomizations')
            .select('id')
            .eq('stream_item_id', lot.id)
            .eq('purpose', 'hit_assignment')
            .eq('assignments->>hit', hit)
            .limit(1);
        if (dupHit && dupHit.length > 0) {
            return NextResponse.json(
                { error: 'This hit was already assigned for this lot', code: 'ALREADY_ASSIGNED' },
                { status: 409 },
            );
        }

        const soldSpotNumbers = spots.filter(s => s.status === 'sold').map(s => s.spot_number);
        if (soldSpotNumbers.length === 0) {
            return NextResponse.json(
                { error: 'No sold spots to assign the hit to' },
                { status: 409 },
            );
        }

        const order = seededShuffle(soldSpotNumbers, seed);
        const winner = order[0];
        const assignments = { hit, spot: winner, order };

        const { error: auditErr } = await admin.from('break_randomizations').insert({
            stream_item_id: lot.id,
            stream_id: stream.id,
            run_by: user.id,
            purpose,
            seed,
            algorithm: 'fisher-yates-sha256',
            assignments,
        });
        if (auditErr) {
            console.error('[Live/Randomize] audit insert failed:', auditErr.message);
            return NextResponse.json({ error: 'Failed to record randomization' }, { status: 500 });
        }

        await postSystemChat(
            stream.id,
            user.id,
            `Hit assignment: ${hit} -> Spot ${winner}. Seed ${seed}`,
        );

        return NextResponse.json({ success: true, purpose, seed, assignments });
    } catch (err: any) {
        console.error('[Live/Randomize] error:', err);
        return NextResponse.json({ error: 'Randomization failed' }, { status: 500 });
    }
}
