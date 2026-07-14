// Two-step seller/reviewer hydration used by every CROSS-USER profile read.
//
// The base `profiles` table is (being) locked to own-row SELECT so a signed-in
// user can't harvest other users' PII (phone, address, Stripe id) — see
// docs/security/profiles-read-isolation-plan.md. Public display data therefore
// can no longer come from a `seller:profiles(...)` embed (RLS would null it out
// for other users). It comes from the `public_profiles` view instead, which is a
// curated, non-sensitive projection readable by anon/authenticated.
//
// A separate query (not a PostgREST embed) is used deliberately: embedding a view
// as a relationship is unproven in this project, whereas a plain `.in('id', …)`
// select against the view is guaranteed to work regardless of relationship
// detection. Fails soft: on any error the rows render without a seller chip
// rather than throwing.

// Structural client type so this works with the browser, server, and admin
// Supabase clients without dragging in their differing Database generics.
type QueryableClient = { from: (table: string) => any };

export interface PublicSeller {
    id: string;
    username?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
    partner_tier?: string | null;
    partner_joined_at?: string | null;
    rating?: number | string | null;
    review_count?: number | null;
    is_verified_shop?: boolean | null;
    // Owner/official-account flag derived in the view from role='admin'. Replaces
    // the raw `role` in cross-user reads so admin identity isn't enumerable.
    is_official?: boolean;
}

const PUBLIC_SELLER_COLUMNS =
    'id, username, display_name, avatar_url, partner_tier, partner_joined_at, rating, review_count, is_verified_shop, is_official';

/** Fetch public seller rows for a set of ids, keyed by id. Deduped, fail-soft. */
export async function fetchPublicSellers(
    supabase: QueryableClient,
    ids: (string | null | undefined)[],
): Promise<Map<string, PublicSeller>> {
    const map = new Map<string, PublicSeller>();
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (unique.length === 0) return map;

    const { data, error } = await supabase
        .from('public_profiles')
        .select(PUBLIC_SELLER_COLUMNS)
        .in('id', unique);

    if (error) {
        console.error('[publicProfiles] seller fetch failed:', error.message);
        return map; // fail soft — callers render without the seller chip
    }
    for (const row of (data || []) as PublicSeller[]) map.set(row.id, row);
    return map;
}

/**
 * Attach a `seller` object to each row (matched on `row.seller_id`) from the
 * public_profiles view. Mutates and returns the same array.
 */
export async function attachSellers<T extends { seller_id: string; seller?: unknown }>(
    supabase: QueryableClient,
    rows: T[],
): Promise<T[]> {
    if (!rows || rows.length === 0) return rows;
    const sellers = await fetchPublicSellers(supabase, rows.map((r) => r.seller_id));
    for (const row of rows) (row as { seller?: unknown }).seller = sellers.get(row.seller_id);
    return rows;
}
