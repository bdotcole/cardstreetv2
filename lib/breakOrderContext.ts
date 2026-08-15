/**
 * Display context for live-break spot orders (server-only).
 *
 * Spot orders carry no listing/card_data snapshot, so every panel that renders
 * `listing.card_data.name` used to fall back to a generic "Card Order" with a
 * blank thumbnail. This resolves the break context — break_spots →
 * stream_items (lot card_data) → streams (title) — with the service-role
 * client (streams/spots are RLS-gated per role, and the buyer isn't the
 * spot's seller) so those rows can display
 * "<stream title> — <lot card name> · Spot #N" with the lot's artwork.
 *
 * One batched query per API render, keyed by break_spot_id. Fails soft: any
 * join failure just yields no entry and the client falls back to its
 * localized "Live break spot" label (never "Card Order").
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { embedArray } from '@/lib/utils/embed';

export interface BreakOrderContext {
    /** "<stream title> — <lot card name> · Spot #N" */
    title: string;
    streamTitle: string;
    lotName: string | null;
    spotNumber: number | null;
    imageSmall: string | null;
    imageLarge: string | null;
}

export async function resolveBreakOrderContexts(
    admin: SupabaseClient,
    spotIds: (string | null | undefined)[],
): Promise<Map<string, BreakOrderContext>> {
    const map = new Map<string, BreakOrderContext>();
    const ids = [...new Set(spotIds.filter((id): id is string => !!id))];
    if (ids.length === 0) return map;

    try {
        const { data, error } = await admin
            .from('break_spots')
            .select('id, spot_number, stream_item:stream_items(card_data), stream:streams(title)')
            .in('id', ids);
        if (error || !data) return map;

        for (const row of data as any[]) {
            // To-one embeds may arrive as object or one-element array
            // depending on PostgREST's FK detection — normalize both.
            const item = embedArray(row.stream_item)[0] as any | undefined;
            const stream = embedArray(row.stream)[0] as any | undefined;
            const streamTitle: string | null = stream?.title || null;
            if (!streamTitle) continue;

            const cardData = item?.card_data ?? null;
            const lotName: string | null = cardData?.name || null;
            const spotNumber: number | null = Number.isFinite(Number(row.spot_number))
                ? Number(row.spot_number)
                : null;

            map.set(row.id as string, {
                title:
                    streamTitle +
                    (lotName ? ` — ${lotName}` : '') +
                    (spotNumber !== null ? ` · Spot #${spotNumber}` : ''),
                streamTitle,
                lotName,
                spotNumber,
                imageSmall: cardData?.images?.small || null,
                imageLarge: cardData?.images?.large || cardData?.images?.small || null,
            });
        }
    } catch {
        // Fail soft — display falls back to the localized "Live break spot".
    }
    return map;
}

/**
 * Attach `break_context` to order rows that carry a break_spot_id. Rows
 * without one (ordinary marketplace orders) get `break_context: null` and are
 * untouched otherwise.
 */
export async function attachBreakContext<T extends { break_spot_id?: string | null }>(
    admin: SupabaseClient,
    rows: T[],
): Promise<(T & { break_context: BreakOrderContext | null })[]> {
    const contexts = await resolveBreakOrderContexts(
        admin,
        rows.map(r => r.break_spot_id),
    );
    return rows.map(r => ({
        ...r,
        break_context: (r.break_spot_id && contexts.get(r.break_spot_id)) || null,
    }));
}
