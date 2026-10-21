// Shared client-side types + formatting for the auction UI (mobile + desktop).
// All amounts arriving from /api/auctions are INTEGER SATANG.

export interface AuctionSeller {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    rating: number | null;
    review_count: number | null;
}

export interface AuctionRecord {
    id: string;
    seller_id: string;
    card_id: string;
    card_data: any;
    condition: string;
    is_graded: boolean;
    grading_company: string | null;
    grade: number | null;
    image_front_url: string | null;
    image_back_url: string | null;
    starting_price: number;
    reserve_price: number | null;
    buy_now_price: number | null;
    current_price: number;
    reserve_met: boolean;
    bid_count: number;
    high_bidder_id: string | null;
    status: 'live' | 'sold' | 'unsold' | 'cancelled';
    ends_at: string;
    extension_count: number;
    mode: string;
    winner_id: string | null;
    winning_amount: number | null;
    won_via: string | null;
    order_id: string | null;
    payment_due_at: string | null;
    second_chance_offered_to: string | null;
    second_chance_amount: number | null;
    second_chance_expires_at: string | null;
    second_chance_status: string | null;
    closed_at: string | null;
    created_at: string;
    seller?: AuctionSeller | null;
    order?: { id: string; status: string; transfer_group: string | null } | null;
}

export interface AuctionBidRow {
    id: string;
    bidder_id: string;
    bidder?: { display_name: string | null; avatar_url: string | null } | null;
    amount: number;
    is_proxy: boolean;
    created_at: string;
    max_amount?: number;
}

export const satangToDisplay = (satang: number | null | undefined): string =>
    `฿${(Math.round(Number(satang ?? 0)) / 100).toLocaleString()}`;

/**
 * Compact time-left string derived from the SERVER clock: callers must pass
 * remaining ms computed as endsAt - (Date.now() + serverOffset), where
 * serverOffset = serverNow - clientNow at fetch time. Never trust the raw
 * client clock for auction countdowns.
 */
export function formatTimeLeft(remainingMs: number, isThai: boolean): string {
    if (remainingMs <= 0) return isThai ? 'จบแล้ว' : 'Ended';
    const s = Math.floor(remainingMs / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return isThai ? `${d}วัน ${h}ชม.` : `${d}d ${h}h`;
    if (h > 0) return isThai ? `${h}ชม. ${m}น.` : `${h}h ${m}m`;
    if (m > 0) return isThai ? `${m}น. ${sec}วิ` : `${m}m ${sec}s`;
    return isThai ? `${sec}วิ` : `${sec}s`;
}

/** Under this remaining time the countdown renders in the danger style. */
export const COUNTDOWN_DANGER_MS = 2 * 60 * 1000;

/** serverNow ISO → offset to add to Date.now() to approximate server time. */
export function computeServerOffset(serverNowIso: string | null | undefined): number {
    if (!serverNowIso) return 0;
    const t = Date.parse(serverNowIso);
    return Number.isFinite(t) ? t - Date.now() : 0;
}
