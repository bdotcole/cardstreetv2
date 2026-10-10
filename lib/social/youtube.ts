/**
 * YouTube provider: YouTube Analytics API (daily views / watch time /
 * subscriber flow) plus the Data API (live subscriber total, recent uploads).
 *
 * Service accounts cannot read YouTube Analytics — the channel owner must
 * grant OAuth consent once. Google only issues a refresh token when the
 * consent screen is published ("In production"); in "Testing" status the
 * refresh token dies after 7 days and the account would need reconnecting
 * weekly (docs/social-dashboard.md walks through this). Access tokens last an
 * hour, so every sync refreshes first and hands the new one back to be stored.
 *
 * Quota: the Analytics API is free of quota concerns at this volume; the Data
 * API's default 10k units/day is far above the ~5 units a sync spends
 * (playlistItems + videos.list, never search.list which costs 100).
 */

import { eachDay, isoDay, mapLimit, shiftDay, toInt, type DailyMetrics, type PostMetrics, type SyncResult, type SyncWindow } from './types';
import { providerCredentials } from './config';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const DATA = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';

export const YOUTUBE_SCOPES = [
    'https://www.googleapis.com/auth/yt-analytics.readonly',
    'https://www.googleapis.com/auth/youtube.readonly',
];

const POSTS_PER_SYNC = 15;
// Analytics finalizes a day roughly 48-72h later; the orchestrator re-pulls recent days anyway.

export class YouTubeError extends Error {
    constructor(message: string, public status: number) {
        super(message);
        this.name = 'YouTubeError';
    }
}

async function getJson<T = any>(url: string, token: string): Promise<T> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new YouTubeError(json?.error?.message || `YouTube ${res.status}`, res.status);
    return json as T;
}

// --- OAuth ---------------------------------------------------------------

export function googleAuthUrl(state: string, redirectUri: string): string {
    const creds = providerCredentials('youtube');
    if (!creds) throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set');
    const url = new URL(AUTH);
    url.searchParams.set('client_id', creds.id);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', YOUTUBE_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    // Force the consent screen so a refresh token is issued even on a re-connect.
    url.searchParams.set('prompt', 'consent select_account');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    return url.toString();
}

export interface GoogleTokens {
    access_token: string;
    refresh_token?: string;
    expires_at: string;
    scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
    const res = await fetch(TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
        cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
        throw new YouTubeError(json?.error_description || json?.error || `Google token ${res.status}`, res.status);
    }
    return {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: new Date(Date.now() + (Number(json.expires_in) || 3600) * 1000).toISOString(),
        scope: json.scope,
    };
}

export async function googleExchangeCode(code: string, redirectUri: string): Promise<GoogleTokens> {
    const creds = providerCredentials('youtube');
    if (!creds) throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set');
    return tokenRequest({
        code,
        client_id: creds.id,
        client_secret: creds.secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
    });
}

export async function googleRefresh(refreshToken: string): Promise<GoogleTokens> {
    const creds = providerCredentials('youtube');
    if (!creds) throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set');
    const t = await tokenRequest({
        refresh_token: refreshToken,
        client_id: creds.id,
        client_secret: creds.secret,
        grant_type: 'refresh_token',
    });
    // Google does not rotate refresh tokens; keep the one we have.
    return { ...t, refresh_token: refreshToken };
}

// --- Discovery -----------------------------------------------------------

export interface DiscoveredChannel {
    channelId: string;
    title: string;
    handle: string | null;
    avatarUrl: string | null;
    uploadsPlaylistId: string | null;
}

/** The channel the user picked at Google's account chooser (Brand Accounts included). */
export async function youtubeDiscoverChannel(accessToken: string): Promise<DiscoveredChannel | null> {
    const res = await getJson<any>(`${DATA}/channels?part=snippet,contentDetails&mine=true`, accessToken);
    const c = res?.items?.[0];
    if (!c?.id) return null;
    return {
        channelId: String(c.id),
        title: c.snippet?.title ?? '',
        handle: c.snippet?.customUrl ?? null,
        avatarUrl: c.snippet?.thumbnails?.default?.url ?? null,
        uploadsPlaylistId: c.contentDetails?.relatedPlaylists?.uploads ?? null,
    };
}

// --- Sync ----------------------------------------------------------------

const DAILY_METRICS = ['views', 'estimatedMinutesWatched', 'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares'];

export async function syncYouTubeChannel(accessToken: string, window: SyncWindow): Promise<SyncResult> {
    const notes: string[] = [];

    const reportUrl = new URL(ANALYTICS);
    reportUrl.searchParams.set('ids', 'channel==MINE');
    reportUrl.searchParams.set('startDate', window.since);
    reportUrl.searchParams.set('endDate', window.until);
    reportUrl.searchParams.set('metrics', DAILY_METRICS.join(','));
    reportUrl.searchParams.set('dimensions', 'day');
    reportUrl.searchParams.set('sort', 'day');
    const report = await getJson<any>(reportUrl.toString(), accessToken);
    const cols: string[] = (report?.columnHeaders ?? []).map((h: any) => h.name);
    const byDay = new Map<string, Record<string, number | null>>();
    for (const row of report?.rows ?? []) {
        const rec: Record<string, number | null> = {};
        cols.forEach((name, i) => { if (name !== 'day') rec[name] = toInt(row[i]); });
        byDay.set(String(row[0]), rec);
    }

    const channel = await getJson<any>(`${DATA}/channels?part=snippet,statistics,contentDetails&mine=true`, accessToken);
    const c = channel?.items?.[0];
    const subscribersNow = toInt(c?.statistics?.subscriberCount);

    const days: DailyMetrics[] = eachDay(window.since, window.until).map((day) => {
        const r = byDay.get(day);
        const gained = r?.subscribersGained ?? null;
        const lost = r?.subscribersLost ?? null;
        const likes = r?.likes ?? null;
        return {
            day,
            follower_delta: gained !== null || lost !== null ? (gained ?? 0) - (lost ?? 0) : null,
            views: r?.views ?? null,
            watch_minutes: r?.estimatedMinutesWatched ?? null,
            engagements: likes !== null ? likes + (r?.comments ?? 0) + (r?.shares ?? 0) : null,
            likes,
            comments: r?.comments ?? null,
            shares: r?.shares ?? null,
        };
    });
    const last = days[days.length - 1];
    if (last && subscribersNow !== null && last.day === shiftDay(isoDay(new Date()), -1)) last.followers = subscribersNow;
    if (c?.statistics?.hiddenSubscriberCount) notes.push('YouTube: subscriber count is hidden on this channel.');

    const posts = await youtubeUploads(accessToken, c?.contentDetails?.relatedPlaylists?.uploads ?? null, notes);

    return {
        days,
        posts,
        profile: {
            handle: c?.snippet?.customUrl ?? null,
            display_name: c?.snippet?.title ?? null,
            avatar_url: c?.snippet?.thumbnails?.default?.url ?? null,
            profile_url: c?.snippet?.customUrl ? `https://www.youtube.com/${c.snippet.customUrl}` : (c?.id ? `https://www.youtube.com/channel/${c.id}` : null),
        },
        notes,
    };
}

/** ISO 8601 duration (PT1H2M3S) -> seconds. */
function parseDuration(iso: string | undefined): number | null {
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
    if (!m) return null;
    return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

/** Rows of an Analytics report as objects keyed by column name. */
async function analyticsRows(accessToken: string, params: Record<string, string>): Promise<Record<string, string>[]> {
    const url = new URL(ANALYTICS);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const report = await getJson<any>(url.toString(), accessToken);
    const cols: string[] = (report?.columnHeaders ?? []).map((h: any) => h.name);
    return (report?.rows ?? []).map((row: any[]) => Object.fromEntries(cols.map((c, i) => [c, String(row[i])])));
}

const PER_VIDEO_METRICS = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained';
// Analytics covers the last 90 days per video — lifetime for anything recent, which is what the content tab ranks.
const CONTENT_LOOKBACK_DAYS = 90;
const HOOK_SECONDS = 30;

function formatFromContentType(v: string | undefined): PostMetrics['format'] {
    const t = (v ?? '').toLowerCase();
    if (t.includes('short')) return 'short';
    if (t.includes('live')) return 'live';
    if (t.includes('story')) return 'story';
    return 'video';
}

/**
 * Recent uploads with what the Analytics API knows about each: average view
 * duration and percentage, watch time, subscribers the video earned, and the
 * audience-retention curve (100 points), from which the hook figure — the
 * share of viewers still watching at 30 seconds — is read. Retention is one
 * request per video, so it is bounded by POSTS_PER_SYNC.
 */
async function youtubeUploads(accessToken: string, uploadsPlaylistId: string | null, notes: string[]): Promise<PostMetrics[]> {
    if (!uploadsPlaylistId) return [];
    const items = await getJson<any>(
        `${DATA}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=${POSTS_PER_SYNC}`,
        accessToken,
    );
    const ids: string[] = (items?.items ?? []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
    if (ids.length === 0) return [];
    const videos = await getJson<any>(`${DATA}/videos?part=snippet,statistics,contentDetails&id=${ids.join(',')}`, accessToken);

    const endDate = shiftDay(isoDay(new Date()), -1);
    const startDate = shiftDay(endDate, -CONTENT_LOOKBACK_DAYS);
    const base = { ids: 'channel==MINE', startDate, endDate, metrics: PER_VIDEO_METRICS, filters: `video==${ids.join(',')}` };
    let perVideo = new Map<string, Record<string, string>>();
    try {
        let rows: Record<string, string>[];
        try {
            rows = await analyticsRows(accessToken, { ...base, dimensions: 'video,creatorContentType' });
        } catch (e) {
            // Older channels / some combinations refuse the content-type split; the metrics still matter.
            if (!(e instanceof YouTubeError) || e.status !== 400) throw e;
            rows = await analyticsRows(accessToken, { ...base, dimensions: 'video' });
        }
        perVideo = new Map(rows.map((r) => [r.video, r]));
    } catch (e) {
        notes.push(`YouTube per-video analytics unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Retention is one Analytics call per video; four at a time keeps a 15-video sync under ~5 s.
    return mapLimit(videos?.items ?? [], 4, async (v: any): Promise<PostMetrics> => {
        const a = perVideo.get(String(v.id));
        const duration = parseDuration(v.contentDetails?.duration);
        const post: PostMetrics = {
            external_id: String(v.id),
            published_at: v.snippet?.publishedAt ?? null,
            caption: v.snippet?.title ?? null,
            media_type: 'video',
            permalink: `https://www.youtube.com/watch?v=${v.id}`,
            thumbnail_url: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? null,
            views: toInt(v.statistics?.viewCount),
            likes: toInt(v.statistics?.likeCount),
            comments: toInt(v.statistics?.commentCount),
            duration_seconds: duration,
            format: a?.creatorContentType ? formatFromContentType(a.creatorContentType) : (duration !== null && duration <= 60 ? 'short' : 'video'),
        };
        if (a) {
            post.shares = toInt(a.shares);
            post.follows = toInt(a.subscribersGained);
            const minutes = Number(a.estimatedMinutesWatched);
            post.watch_time_seconds = Number.isFinite(minutes) ? Math.round(minutes * 60) : null;
            const avg = Number(a.averageViewDuration);
            post.avg_watch_seconds = Number.isFinite(avg) ? Math.round(avg * 100) / 100 : null;
            const pct = Number(a.averageViewPercentage);
            post.avg_watch_pct = Number.isFinite(pct) ? Math.round(pct * 100) / 100 : null;
        }
        // Retention curve -> hook. audienceWatchRatio can exceed 1 on rewatched segments; the hook is capped at 100.
        try {
            const curve = await analyticsRows(accessToken, {
                ids: 'channel==MINE', startDate, endDate, metrics: 'audienceWatchRatio',
                dimensions: 'elapsedVideoTimeRatio', filters: `video==${v.id}`,
            });
            const points: [number, number][] = curve
                .map((r) => [Number(r.elapsedVideoTimeRatio), Number(r.audienceWatchRatio)] as [number, number])
                .filter(([e, w]) => Number.isFinite(e) && Number.isFinite(w))
                .map(([e, w]) => [Math.round(e * 1000) / 1000, Math.round(w * 1000) / 1000]);
            if (points.length) {
                post.retention = points;
                const target = duration && duration > 0 ? Math.min(1, HOOK_SECONDS / duration) : 0.05;
                const at = points.find(([e]) => e >= target) ?? points[points.length - 1];
                post.hook_pct = Math.min(100, Math.round(at[1] * 10000) / 100);
            }
        } catch {
            // A video too new or too small for retention data — the rest still lands.
        }
        return post;
    });
}
