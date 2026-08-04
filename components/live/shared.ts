/**
 * Client-shared row shapes + tiny formatters for the live-breaks UI.
 *
 * The row interfaces mirror what the /api/live routes return (which is what
 * Supabase Realtime also delivers as payload.new), so pages can patch their
 * state directly from either source without re-mapping.
 */

export interface LiveStreamRow {
    id: string;
    seller_id: string;
    title: string;
    description: string | null;
    cover_image_url: string | null;
    game_id: string | null;
    status: 'scheduled' | 'live' | 'ended' | 'cancelled';
    visibility: 'public' | 'unlisted';
    scheduled_at: string | null;
    started_at: string | null;
    ended_at: string | null;
    current_item_id: string | null;
    livekit_room: string | null;
    chat_disabled: boolean;
    viewer_peak: number;
    settled_at: string | null;
    created_at: string;
    seller?: { display_name: string | null; avatar_url: string | null } | null;
}

export interface LiveLotRow {
    id: string;
    stream_id: string;
    seller_id: string;
    item_type: string;
    position: number;
    status: 'queued' | 'active' | 'sold' | 'unsold' | 'cancelled';
    card_data: { name?: string; isSealed?: boolean; productType?: string | null; images?: { small?: string; large?: string } } | null;
    listing_id: string | null;
    spots_total: number | null;
    spot_price: number | null; // satang
    packs_per_spot: number;
    price: number | null; // satang
    break_opened_at: string | null;
    created_at: string;
}

export interface LiveSpotRow {
    id: string;
    stream_item_id: string;
    spot_number: number;
    price: number; // satang
    status: 'open' | 'held' | 'sold' | 'cancelled';
    held_by: string | null;
    hold_expires_at: string | null;
    buyer_id: string | null;
    order_id: string | null;
    sold_at: string | null;
    assigned_packs: number[] | null;
}

export interface LiveChatMessage {
    id: string;
    stream_id: string;
    sender_id: string;
    body: string;
    is_system: boolean;
    created_at: string;
    sender?: { display_name: string | null; avatar_url: string | null } | null;
}

/** Spot/lot money is INTEGER SATANG everywhere in the live schema; the UI is
 *  THB-only (live selling is Thailand-gated), so no currency switching here. */
export function formatSatang(satang: number): string {
    const thb = satang / 100;
    return `฿${thb.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: thb % 1 === 0 ? 0 : 2,
    })}`;
}

/** "Somchai P." -> "SP" — the sold-spot owner marker on the board. */
export function nameInitials(name: string | null | undefined): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    const first = parts[0][0] ?? '';
    const second = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : parts[0][1] ?? '';
    return (first + second).toUpperCase();
}

export function formatCountdown(msLeft: number): string {
    const s = Math.max(0, Math.ceil(msLeft / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}
