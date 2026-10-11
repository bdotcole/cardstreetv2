/**
 * "Someone wants a card in your vault" — Wednesday 12:00 UTC (19:00 Bangkok).
 *
 * The seller-side counterpart of the buyer digest. Wishlist rows have been
 * accumulating since launch with no route to the people who own the cards, so a
 * collector could be sitting on the only copy of a card three other users are
 * waiting for and never learn it.
 *
 * TWO WISHLISTERS MINIMUM. One is noise — with 297 wishlist rows across 289
 * cards, almost every card has exactly one, and a weekly push about a single
 * person's maybe-interest is how a notification channel gets muted. Two is a
 * pattern.
 *
 * Cards with an active listing are skipped: that demand is already being met,
 * by this seller or another.
 *
 * Midweek rather than the weekend on purpose — this asks the seller to do work
 * (photograph and list a card), not to browse, and it must not land on the same
 * day as the buyer digest.
 *
 * Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendVaultDemandNotification } from '@/lib/courier';
import { suggestedSellPrice } from '@/lib/listingPriceGuidance';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PAGE = 1000;
const CHUNK = 200;
const MIN_WISHLISTERS = 2;
const MAX_SENDS = 300;
const TIME_BUDGET_MS = 250_000;

interface WishRow { card_id: string; user_id: string }
interface ItemRow { collection_id: string; card_id: string; card_data: { name?: string; marketPrice?: number } | null }

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const started = Date.now();

    try {
        // ─── Demand: card -> distinct wishlisters ───
        const wishlisters = new Map<string, Set<string>>();
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await admin
                .from('wishlists')
                .select('card_id, user_id')
                .order('card_id', { ascending: true })
                .range(from, from + PAGE - 1)
                .returns<WishRow[]>();
            if (error) throw new Error(`wishlists: ${error.message}`);
            for (const w of data ?? []) {
                if (!wishlisters.has(w.card_id)) wishlisters.set(w.card_id, new Set());
                wishlisters.get(w.card_id)!.add(w.user_id);
            }
            if (!data || data.length < PAGE) break;
        }

        const wanted = [...wishlisters.entries()]
            .filter(([, users]) => users.size >= MIN_WISHLISTERS)
            .map(([cardId, users]) => ({ cardId, users }));
        if (wanted.length === 0) {
            console.log('[Cron/VaultDemand] no card has 2+ wishlisters');
            return NextResponse.json({ ok: true, sent: 0 });
        }

        // ─── Drop anything already for sale ───
        const wantedIds = wanted.map((w) => w.cardId);
        const listed = new Set<string>();
        for (let i = 0; i < wantedIds.length; i += CHUNK) {
            const { data } = await admin
                .from('listings')
                .select('card_id')
                .eq('status', 'active')
                .in('card_id', wantedIds.slice(i, i + CHUNK));
            for (const l of data ?? []) listed.add(l.card_id as string);
        }
        const unmet = wanted.filter((w) => !listed.has(w.cardId));
        if (unmet.length === 0) {
            console.log('[Cron/VaultDemand] every wanted card already has a listing');
            return NextResponse.json({ ok: true, sent: 0 });
        }

        // ─── Who owns them ───
        const unmetIds = unmet.map((w) => w.cardId);
        const items: ItemRow[] = [];
        for (let i = 0; i < unmetIds.length; i += CHUNK) {
            const { data } = await admin
                .from('collection_items')
                .select('collection_id, card_id, card_data')
                .in('card_id', unmetIds.slice(i, i + CHUNK));
            items.push(...((data ?? []) as ItemRow[]));
        }
        if (items.length === 0) return NextResponse.json({ ok: true, sent: 0 });

        const colIds = [...new Set(items.map((i) => i.collection_id))];
        const ownerOf = new Map<string, string>();
        for (let i = 0; i < colIds.length; i += CHUNK) {
            const { data } = await admin
                .from('collections')
                .select('id, user_id')
                .in('id', colIds.slice(i, i + CHUNK));
            for (const c of data ?? []) ownerOf.set(c.id as string, c.user_id as string);
        }

        const demandOf = new Map(unmet.map((w) => [w.cardId, w.users]));

        // Best card per owner, plus how many others they hold. One named card
        // beats a count — see the sender.
        interface Best { cardName: string; wishlisters: number; suggestedPrice: number; othersCount: number }
        const best = new Map<string, Best>();
        for (const item of items) {
            const owner = ownerOf.get(item.collection_id);
            if (!owner) continue;
            const users = demandOf.get(item.card_id);
            if (!users) continue;
            // The owner's own wishlist entry is not demand for their own card.
            const others = new Set(users);
            others.delete(owner);
            if (others.size < MIN_WISHLISTERS) continue;

            const price = suggestedSellPrice(item.card_data?.marketPrice);
            // No usable market value means no price to suggest, and "someone
            // wants this, list it for 20 baht" is worse than silence.
            if (price <= 0) continue;

            const prev = best.get(owner);
            if (!prev) {
                best.set(owner, {
                    cardName: item.card_data?.name || item.card_id,
                    wishlisters: others.size,
                    suggestedPrice: price,
                    othersCount: 0,
                });
            } else {
                if (others.size > prev.wishlisters) {
                    best.set(owner, {
                        cardName: item.card_data?.name || item.card_id,
                        wishlisters: others.size,
                        suggestedPrice: price,
                        othersCount: prev.othersCount + 1,
                    });
                } else {
                    prev.othersCount++;
                }
            }
        }

        const targets = [...best.entries()]
            .sort((a, b) => b[1].wishlisters - a[1].wishlisters)
            .slice(0, MAX_SENDS);

        // ?dryRun=1 counts recipients and sends nothing. The only way to
        // exercise this route used to be to notify real users; a dev server
        // holds the live Courier token, so "let me just check it runs" was a
        // real blast. Vercel Cron never passes it, so production is unchanged.
        const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
        if (dryRun) {
            console.log(`[Cron/VaultDemand] DRY RUN — would notify ${targets.length} owner(s)`);
            return NextResponse.json({ ok: true, dryRun: true, owners: targets.length, push: 0, email: 0 });
        }

        let push = 0;
        let email = 0;
        const SEND_CHUNK = 10;
        for (let i = 0; i < targets.length; i += SEND_CHUNK) {
            if (Date.now() - started > TIME_BUDGET_MS) break;
            const results = await Promise.allSettled(
                targets.slice(i, i + SEND_CHUNK).map(([userId, top]) =>
                    sendVaultDemandNotification(userId, top),
                ),
            );
            for (const r of results) {
                if (r.status !== 'fulfilled') continue;
                if (r.value === 'push') push++;
                else if (r.value === 'email') email++;
            }
        }

        console.log(`[Cron/VaultDemand] ${targets.length} owner(s): ${push} push, ${email} email`);
        return NextResponse.json({ ok: true, owners: targets.length, push, email });
    } catch (err) {
        console.error('[Cron/VaultDemand] error:', err);
        return NextResponse.json({ ok: false, push: 0, email: 0 });
    }
}
