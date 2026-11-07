import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { normalizeCard } from '@/lib/utils/normalizeCard';
import { PUBLIC_WISHLIST_MAX_CARDS, type PublicWishlist, type PublicWishlistCard } from '@/lib/wishlistShare';

// Loader for the public /wishlist/<token> page. The read is one RPC call,
// public_wishlist_by_token() (20261107_wishlist_shares.sql), which resolves
// the token to the owner's display fields and their wishlist rows and returns
// nothing for an unknown or turned-off link. The availability pass then asks
// the live listings which of those cards can be bought right now: that is
// what turns a list of wishes into something a gift-giver can act on.

// PostgREST `in` filters ride the URL; chunking keeps each request short and
// under the 1000-row page cap.
const LISTING_CHUNK = 100;

interface RpcRow {
    owner: { id: string; display_name: string | null; username: string | null; avatar_url: string | null };
    shared_at: string | null;
    cards: { card_id: string; card_data: unknown; added_at: string }[];
}

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Availability = NonNullable<PublicWishlistCard['available']>;

// React cache() dedupes the lookup across generateMetadata + the page body
// within one request.
export const getPublicWishlist = cache(async (token: string): Promise<PublicWishlist | null> => {
    if (!token || token.length > 64) return null;
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('public_wishlist_by_token', { p_token: token });
    if (error) {
        // A missing function (pre-migration) is a 404 like any unknown token.
        if (error.code !== 'PGRST202' && error.code !== '42883') {
            console.error('[wishlistShareData] rpc failed:', error.message);
        }
        return null;
    }
    const row = data as RpcRow | null;
    if (!row?.owner?.id) return null;

    const all = Array.isArray(row.cards) ? row.cards : [];
    const entries = all
        .slice(0, PUBLIC_WISHLIST_MAX_CARDS)
        .map((c) => ({ card: normalizeCard(c.card_data, c.card_id), addedAt: c.added_at }))
        .filter((c) => c.card.id);

    const availability = await fetchAvailability(supabase, entries.map((e) => e.card.id));
    const cards: PublicWishlistCard[] = entries.map((e) => ({ ...e, available: availability.get(e.card.id) ?? null }));
    // Stable partition: the RPC already ordered newest first.
    const buyable = cards.filter((c) => c.available);
    const rest = cards.filter((c) => !c.available);

    return {
        owner: {
            id: row.owner.id,
            displayName: row.owner.display_name?.trim() || row.owner.username?.trim() || null,
            username: row.owner.username ?? null,
            avatarUrl: row.owner.avatar_url || null,
        },
        sharedAt: row.shared_at ?? null,
        cards: buyable.concat(rest),
        availableCount: buyable.length,
        totalCards: all.length,
    };
});

async function fetchAvailability(supabase: Supabase, cardIds: string[]): Promise<Map<string, Availability>> {
    const result = new Map<string, Availability>();
    const sellersByCard = new Map<string, Set<string>>();
    for (let i = 0; i < cardIds.length; i += LISTING_CHUNK) {
        const chunk = cardIds.slice(i, i + LISTING_CHUNK);
        const { data, error } = await supabase
            .from('listings')
            .select('card_id, price, seller_id')
            .in('card_id', chunk)
            .eq('status', 'active')
            .order('price', { ascending: true })
            .limit(1000);
        if (error) {
            // Availability is a bonus on top of the list; the page still renders without it.
            console.error('[wishlistShareData] listings failed:', error.message);
            continue;
        }
        for (const l of (data ?? []) as { card_id: string; price: number | string; seller_id: string }[]) {
            const price = Number(l.price);
            if (!Number.isFinite(price) || price <= 0) continue;
            const current = result.get(l.card_id);
            if (!current) result.set(l.card_id, { fromPrice: price, sellers: 0 });
            else if (price < current.fromPrice) current.fromPrice = price;
            let sellers = sellersByCard.get(l.card_id);
            if (!sellers) {
                sellers = new Set();
                sellersByCard.set(l.card_id, sellers);
            }
            sellers.add(l.seller_id);
        }
    }
    for (const [cardId, entry] of result) entry.sellers = sellersByCard.get(cardId)?.size ?? 1;
    return result;
}
