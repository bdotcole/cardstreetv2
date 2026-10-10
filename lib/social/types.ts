/**
 * Shared shapes for the social media dashboard (Admin -> Social).
 *
 * One daily row per connected account, normalized across platforms. Every
 * metric is optional because the platforms genuinely differ: TikTok's public
 * API has no reach or profile views, YouTube has no link clicks, Facebook
 * stopped serving unique reach in Graph v25. The dashboard shows what a
 * platform reports and says "n/a" for the rest instead of inventing zeros.
 */

export type SocialPlatform = 'facebook' | 'instagram' | 'youtube' | 'tiktok';
export type SocialBrand = 'cardstreet' | 'chopper_kuma';

export const SOCIAL_PLATFORMS: SocialPlatform[] = ['facebook', 'instagram', 'youtube', 'tiktok'];
export const SOCIAL_BRANDS: SocialBrand[] = ['cardstreet', 'chopper_kuma'];

export const BRAND_LABELS: Record<SocialBrand, string> = {
    cardstreet: 'Cardstreet',
    chopper_kuma: 'Chopper & Kuma',
};

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    youtube: 'YouTube',
    tiktok: 'TikTok',
};

/**
 * Visits to cardstreet.app belong to Cardstreet alone. The Chopper & Kuma pet
 * channel is unrelated to the site and never links here, so its "link
 * clicks" are the platforms' own profile-link taps, not GA4 sessions.
 */
export const SITE_BRAND: SocialBrand = 'cardstreet';

/** A social_accounts row as the server reads it (tokens included). */
export interface SocialAccountRow {
    id: string;
    brand: SocialBrand;
    platform: SocialPlatform;
    external_id: string;
    handle: string | null;
    display_name: string | null;
    avatar_url: string | null;
    profile_url: string | null;
    access_token_enc: string | null;
    refresh_token_enc: string | null;
    token_expires_at: string | null;
    token_scopes: string[] | null;
    parent_account_id: string | null;
    connected_by: string | null;
    connected_at: string;
    enabled: boolean;
    last_synced_at: string | null;
    last_sync_error: string | null;
}

/** What the dashboard is allowed to see — never a token. */
export type SocialAccountPublic = Omit<SocialAccountRow, 'access_token_enc' | 'refresh_token_enc'> & {
    has_token: boolean;
};

export function toPublicAccount(row: SocialAccountRow): SocialAccountPublic {
    const { access_token_enc, refresh_token_enc, ...rest } = row;
    return { ...rest, has_token: Boolean(access_token_enc || refresh_token_enc) };
}

/** One day of one account. `day` is YYYY-MM-DD in the platform's reporting zone. */
export interface DailyMetrics {
    day: string;
    followers?: number | null;
    follower_delta?: number | null;
    reach?: number | null;
    views?: number | null;
    profile_views?: number | null;
    link_clicks?: number | null;
    engagements?: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    watch_minutes?: number | null;
    posts?: number | null;
    raw?: Record<string, unknown>;
}

/** reel / short / video / live / photo / carousel / story / post / link */
export type PostFormat = 'reel' | 'short' | 'video' | 'live' | 'photo' | 'carousel' | 'story' | 'post' | 'link';

/**
 * One post / video. The content fields are undefined when a platform never
 * reports them (so a re-sync leaves the stored value alone) and null when
 * it reported nothing — a refused metric must not become a fake zero.
 */
export interface PostMetrics {
    external_id: string;
    published_at: string | null;
    caption: string | null;
    media_type: string | null;
    permalink: string | null;
    thumbnail_url: string | null;
    reach?: number | null;
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    format?: PostFormat | null;
    duration_seconds?: number | null;
    watch_time_seconds?: number | null;
    avg_watch_seconds?: number | null;
    avg_watch_pct?: number | null;
    /** % of viewers still watching at the 30-second mark (YouTube retention curve). */
    hook_pct?: number | null;
    follows?: number | null;
    profile_visits?: number | null;
    total_interactions?: number | null;
    /** YouTube audience retention: [elapsedRatio, watchRatio] pairs. */
    retention?: [number, number][] | null;
    raw?: Record<string, unknown>;
}

/** A provider's complete answer for one account over one window. */
export interface SyncResult {
    days: DailyMetrics[];
    posts: PostMetrics[];
    /** Profile fields worth refreshing on the account row. */
    profile?: {
        handle?: string | null;
        display_name?: string | null;
        avatar_url?: string | null;
        profile_url?: string | null;
    };
    /** Rotated credentials to persist (TikTok rotates refresh tokens; Google/Meta renew access tokens). */
    tokens?: {
        access_token?: string;
        refresh_token?: string;
        expires_at?: string | null;
    };
    /** Metrics a platform refused this run (deprecated / not permitted) — surfaced in the UI, not fatal. */
    notes?: string[];
}

export interface SyncWindow {
    /** Inclusive, YYYY-MM-DD. */
    since: string;
    /** Inclusive, YYYY-MM-DD. */
    until: string;
}

/** YYYY-MM-DD for a Date, in UTC. */
export function isoDay(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD shifted by `days` (negative = earlier). */
export function shiftDay(day: string, days: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return isoDay(d);
}

/** Every day from `since` to `until` inclusive. */
export function eachDay(since: string, until: string): string[] {
    const out: string[] = [];
    for (let d = since; d <= until; d = shiftDay(d, 1)) out.push(d);
    return out;
}

/** Unix seconds for the start of a YYYY-MM-DD day (UTC). */
export function dayStartUnix(day: string): number {
    return Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);
}

export function toInt(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
}
