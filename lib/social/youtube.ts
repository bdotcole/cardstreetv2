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

import { eachDay, isoDay, shiftDay, toInt, type DailyMetrics, type PostMetrics, type SyncResult, type SyncWindow } from './types';
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

    const posts = await youtubeUploads(accessToken, c?.contentDetails?.relatedPlaylists?.uploads ?? null);

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

async function youtubeUploads(accessToken: string, uploadsPlaylistId: string | null): Promise<PostMetrics[]> {
    if (!uploadsPlaylistId) return [];
    const items = await getJson<any>(
        `${DATA}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=${POSTS_PER_SYNC}`,
        accessToken,
    );
    const ids: string[] = (items?.items ?? []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
    if (ids.length === 0) return [];
    const videos = await getJson<any>(`${DATA}/videos?part=snippet,statistics&id=${ids.join(',')}`, accessToken);
    return (videos?.items ?? []).map((v: any): PostMetrics => ({
        external_id: String(v.id),
        published_at: v.snippet?.publishedAt ?? null,
        caption: v.snippet?.title ?? null,
        media_type: 'video',
        permalink: `https://www.youtube.com/watch?v=${v.id}`,
        thumbnail_url: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? null,
        views: toInt(v.statistics?.viewCount),
        likes: toInt(v.statistics?.likeCount),
        comments: toInt(v.statistics?.commentCount),
    }));
}
