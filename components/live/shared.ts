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
    /** Optional until 20260807_stream_layout.sql is applied — absent = default framing. */
    layout?: StreamLayout | null;
    seller?: { display_name: string | null; avatar_url: string | null } | null;
}

/**
 * Presentation-layer crop for one feed: the viewer sees a 1/zoom window of
 * the video, positioned by x/y (0 = window at the left/top edge, 1 = at the
 * right/bottom edge, 0.5 = centered). Applied as pure CSS in
 * CroppedTrackVideo — no video processing anywhere.
 */
export interface FeedCrop {
    zoom: number;
    x: number;
    y: number;
}

/** streams.layout — per-camera-slot framing the broadcaster set. */
export interface StreamLayout {
    main?: FeedCrop | null;
    table?: FeedCrop | null;
}

export const DEFAULT_CROP: FeedCrop = { zoom: 1, x: 0.5, y: 0.5 };

/**
 * Validate + clamp an untrusted crop (API body, DB JSONB). Returns null for
 * anything that isn't three finite numbers — callers treat null as "no crop".
 * Values are clamped (zoom 1..3, x/y 0..1) and rounded so drag deltas don't
 * persist as 15-decimal floats.
 */
export function clampCrop(value: unknown): FeedCrop | null {
    if (!value || typeof value !== 'object') return null;
    const { zoom, x, y } = value as Record<string, unknown>;
    if (typeof zoom !== 'number' || typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(zoom) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const round = (n: number) => Math.round(n * 10000) / 10000;
    return {
        zoom: round(Math.min(3, Math.max(1, zoom))),
        x: round(Math.min(1, Math.max(0, x))),
        y: round(Math.min(1, Math.max(0, y))),
    };
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

/**
 * The Capacitor shells mark themselves two ways: the CardStreetApp UA marker
 * (Android ships it; iOS from 1.0.4) and the injected Capacitor bridge (all
 * shells, including the pre-marker iOS binary). Same belt-and-suspenders
 * detection as components/PremiumHub.tsx. The broadcast console needs this
 * because the native binaries carry no camera permission — broadcasting must
 * hand off to a real browser, while viewing/buying in-app is unaffected.
 */
export function isNativeShell(): boolean {
    if (typeof window === 'undefined') return false;
    if (navigator.userAgent.includes('CardStreetApp')) return true;
    const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap && (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : true);
}

/**
 * Open a URL in a real browser from inside the native shell — the same
 * Capacitor Browser (Custom Tab) + window.open('_system') fallback convention
 * as components/StripeConnectSection.tsx's openStripeUrl. Camera pages must
 * go through this: getUserMedia works in a Custom Tab (it's Chrome), never in
 * the app WebView. URL fragments survive the handoff, so the table-cam's
 * #-carried LiveKit token stays intact and off the wire.
 */
export async function openInSystemBrowser(url: string): Promise<void> {
    try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url });
    } catch {
        window.open(url, '_system');
    }
}
