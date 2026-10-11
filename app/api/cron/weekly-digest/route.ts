/**
 * Weekly digest — Friday 18:00 Bangkok (11:00 UTC).
 *
 * Two facts, per user, both of which the app already knows and never told
 * anyone: how many cards on their wishlist are currently for sale, and the
 * biggest 7-day price move in their vault. Nothing is invented for the digest —
 * a user with neither gets no send at all, because "nothing happened this week"
 * is the notification that teaches people to turn notifications off.
 *
 * PUSH FIRST (lib/courier.ts sendWeeklyDigestNotification): a push when the
 * account has an FCM token, email only for accounts that cannot receive one.
 * The app's email is transactional — orders, shipping, payouts — and a weekly
 * marketing send from the same domain spends the reputation those depend on.
 *
 * Friday evening rather than Monday morning: the browse-and-buy behaviour this
 * is trying to restart happens at the weekend.
 *
 * Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { sendWeeklyDigestNotification, type WeeklyDigest } from '@/lib/courier';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PAGE = 1000;
/** Bound the fan-out and the wall clock. */
const MAX_SENDS = 500;
const TIME_BUDGET_MS = 250_000;
/** A move smaller than this is noise, not news. */
const MIN_MOVE_PERCENT = 5;
/** Chunk size for .in() filters — a few thousand ids would blow the URL length. */
const CHUNK = 200;

interface WishRow { user_id: string; card_id: string }
interface CollectionItemRow { collection_id: string; card_id: string }

/** Read a whole table page by page — .limit() alone caps at 1000 silently. */
async function readAll<T>(
    admin: SupabaseClient,
    table: string,
    columns: string,
    orderBy: string,
): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from(table)
            .select(columns)
            .order(orderBy, { ascending: true })
            .range(from, from + PAGE - 1)
            .returns<T[]>();
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
    }
    return out;
}

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
        // ─── Wishlist matches: wishlisted cards that have an active listing ───
        const wishes = await readAll<WishRow>(admin, 'wishlists', 'user_id, card_id', 'user_id');
        const wishedCardIds = [...new Set(wishes.map((w) => w.card_id))];

        // card_id -> cheapest active listing, so the digest can name an example.
        const cheapest = new Map<string, { price: number; name: string; sellerId: string }>();
        for (let i = 0; i < wishedCardIds.length; i += CHUNK) {
            const { data, error } = await admin
                .from('listings')
                .select('card_id, price, seller_id, card_data')
                .eq('status', 'active')
                .in('card_id', wishedCardIds.slice(i, i + CHUNK));
            if (error) throw new Error(`listings: ${error.message}`);
            for (const l of data ?? []) {
                const price = Number(l.price);
                const prev = cheapest.get(l.card_id as string);
                if (!prev || price < prev.price) {
                    cheapest.set(l.card_id as string, {
                        price,
                        name: ((l.card_data as { name?: string } | null)?.name) ?? '',
                        sellerId: l.seller_id as string,
                    });
                }
            }
        }

        const digests = new Map<string, WeeklyDigest>();
        for (const w of wishes) {
            const match = cheapest.get(w.card_id);
            // A seller's own listing is not a match — telling someone their own
            // card is for sale is the digest making itself look broken.
            if (!match || match.sellerId === w.user_id) continue;
            const d = digests.get(w.user_id) ?? { wishlistMatches: 0 };
            d.wishlistMatches++;
            if (d.topMatchPrice === undefined || match.price < d.topMatchPrice) {
                d.topMatchPrice = match.price;
                d.topMatchName = match.name;
            }
            digests.set(w.user_id, d);
        }

        // ─── Biggest 7-day mover in each of those users' vaults ───
        // Scoped to users who already have a digest entry: a full price sweep
        // across every vault is a lot of work to tell someone with no wishlist
        // that a card moved 6%, and wishlisters are the population that has
        // actually signalled they want to hear from us.
        const userIds = [...digests.keys()];
        if (userIds.length > 0 && Date.now() - started < TIME_BUDGET_MS) {
            const ownerOf = new Map<string, string>();
            for (let i = 0; i < userIds.length; i += CHUNK) {
                const { data } = await admin
                    .from('collections')
                    .select('id, user_id')
                    .in('user_id', userIds.slice(i, i + CHUNK));
                for (const c of data ?? []) ownerOf.set(c.id as string, c.user_id as string);
            }

            const items: CollectionItemRow[] = [];
            const colIds = [...ownerOf.keys()];
            for (let i = 0; i < colIds.length; i += CHUNK) {
                const { data } = await admin
                    .from('collection_items')
                    .select('collection_id, card_id')
                    .in('collection_id', colIds.slice(i, i + CHUNK));
                items.push(...((data ?? []) as CollectionItemRow[]));
            }

            const vaultCardIds = [...new Set(items.map((i) => i.card_id))];
            const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

            // Two ordered reads rather than a window function: PostgREST cannot
            // express "first and last row per subject", and pulling the whole
            // 7-day window for thousands of subjects is far more rows than the
            // two endpoint days. First row seen per subject wins — ascending
            // yields the oldest day in the window, descending the newest.
            const priceAt = async (ascending: boolean) => {
                const m = new Map<string, number>();
                for (let i = 0; i < vaultCardIds.length; i += CHUNK) {
                    const { data } = await admin
                        .from('price_snapshots')
                        .select('subject_id, market_thb, captured_on')
                        .in('subject_id', vaultCardIds.slice(i, i + CHUNK))
                        .gte('captured_on', weekAgo)
                        .order('captured_on', { ascending })
                        .limit(1000);
                    for (const r of data ?? []) {
                        if (!m.has(r.subject_id as string)) {
                            m.set(r.subject_id as string, Number(r.market_thb));
                        }
                    }
                }
                return m;
            };
            const before = await priceAt(true);
            const after = await priceAt(false);

            const nameOf = new Map<string, string>();
            for (let i = 0; i < vaultCardIds.length; i += CHUNK) {
                const { data } = await admin
                    .from('pokemon_cards')
                    .select('id, name, english_name')
                    .in('id', vaultCardIds.slice(i, i + CHUNK));
                for (const c of data ?? []) {
                    nameOf.set(c.id as string, (c.english_name as string) || (c.name as string) || '');
                }
            }

            for (const item of items) {
                const userId = ownerOf.get(item.collection_id);
                const d = userId ? digests.get(userId) : undefined;
                if (!d) continue;
                const start = before.get(item.card_id);
                const end = after.get(item.card_id);
                if (!start || !end || start <= 0) continue;
                const pct = Math.round(((end - start) / start) * 100);
                if (Math.abs(pct) < MIN_MOVE_PERCENT) continue;
                if (d.moverPercent === undefined || Math.abs(pct) > Math.abs(d.moverPercent)) {
                    d.moverPercent = pct;
                    d.moverName = nameOf.get(item.card_id) || '';
                }
            }
        }

        // ─── Send ───
        const targets = [...digests.entries()]
            .filter(([, d]) => d.wishlistMatches > 0 || d.moverPercent !== undefined)
            // Most to say first, so the fan-out cap cuts the least useful sends.
            .sort((a, b) => b[1].wishlistMatches - a[1].wishlistMatches)
            .slice(0, MAX_SENDS);

        // ?dryRun=1 counts and sends nothing — see the note in vault-demand.
        if (request.nextUrl.searchParams.get('dryRun') === '1') {
            console.log(`[Cron/WeeklyDigest] DRY RUN — would notify ${targets.length} user(s)`);
            return NextResponse.json({ ok: true, dryRun: true, candidates: targets.length, push: 0, email: 0 });
        }

        let push = 0;
        let email = 0;
        const SEND_CHUNK = 10;
        for (let i = 0; i < targets.length; i += SEND_CHUNK) {
            if (Date.now() - started > TIME_BUDGET_MS) break;
            const results = await Promise.allSettled(
                targets.slice(i, i + SEND_CHUNK).map(([userId, d]) =>
                    sendWeeklyDigestNotification(userId, d),
                ),
            );
            for (const r of results) {
                if (r.status !== 'fulfilled') continue;
                if (r.value === 'push') push++;
                else if (r.value === 'email') email++;
            }
        }

        console.log(
            `[Cron/WeeklyDigest] ${targets.length} candidate(s): ${push} push, ${email} email`,
        );
        return NextResponse.json({ ok: true, candidates: targets.length, push, email });
    } catch (err) {
        console.error('[Cron/WeeklyDigest] error:', err);
        return NextResponse.json({ ok: false, push: 0, email: 0 });
    }
}
