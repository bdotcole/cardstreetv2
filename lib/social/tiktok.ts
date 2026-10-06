/**
 * TikTok provider: Display API (Login Kit + user.info.* + video.list).
 *
 * TikTok's free API exposes totals only — follower count, lifetime likes,
 * and per-video view/like/comment/share counts. There is no daily reach,
 * profile-view or link-click report outside TikTok Studio. So each sync
 * takes a SNAPSHOT and the day's figures are the difference from the
 * previous snapshot: followers today minus yesterday, the sum of video views
 * today minus yesterday. The snapshot is filed under yesterday's date, the
 * activity day it approximates, so it lines up with the other platforms'
 * completed-day rows. The dashboard labels TikTok reach as unavailable rather
 * than showing a zero.
 *
 * Tokens: access tokens live 24h, refresh tokens 365 days and ROTATE — the
 * refreshed refresh_token must replace the stored one or the next sync is
 * locked out.
 */

import { isoDay, shiftDay, toInt, type DailyMetrics, type PostMetrics, type SyncResult } from './types';
import { providerCredentials } from './config';

const AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const API = 'https://open.tiktokapis.com/v2';

export const TIKTOK_SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'];

const USER_FIELDS = 'open_id,union_id,avatar_url,display_name,username,profile_deep_link,follower_count,following_count,likes_count,video_count';
const VIDEO_FIELDS = 'id,title,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count';
const VIDEOS_PER_SYNC = 20;

export class TikTokError extends Error {
    constructor(message: string, public code: string | null, public status: number) {
        super(message);
        this.name = 'TikTokError';
    }
}

function checkError(json: any, status: number) {
    const e = json?.error;
    if (status >= 400 || (e && e.code && e.code !== 'ok')) {
        throw new TikTokError(e?.message || json?.error_description || `TikTok ${status}`, e?.code ?? json?.error ?? null, status);
    }
}

// --- OAuth ---------------------------------------------------------------

export function tiktokAuthUrl(state: string, redirectUri: string): string {
    const creds = providerCredentials('tiktok');
    if (!creds) throw new Error('TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not set');
    const url = new URL(AUTH);
    url.searchParams.set('client_key', creds.id);
    url.searchParams.set('scope', TIKTOK_SCOPES.join(','));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
}

export interface TikTokTokens {
    access_token: string;
    refresh_token: string;
    expires_at: string;
    open_id: string;
    scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TikTokTokens> {
    const res = await fetch(TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
        cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    checkError(json, res.status);
    if (!json.access_token) throw new TikTokError(json?.error_description || 'TikTok token: no access_token', json?.error ?? null, res.status);
    return {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: new Date(Date.now() + (Number(json.expires_in) || 86_400) * 1000).toISOString(),
        open_id: json.open_id,
        scope: json.scope,
    };
}

export async function tiktokExchangeCode(code: string, redirectUri: string): Promise<TikTokTokens> {
    const creds = providerCredentials('tiktok');
    if (!creds) throw new Error('TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not set');
    return tokenRequest({
        client_key: creds.id,
        client_secret: creds.secret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
    });
}

export async function tiktokRefresh(refreshToken: string): Promise<TikTokTokens> {
    const creds = providerCredentials('tiktok');
    if (!creds) throw new Error('TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not set');
    return tokenRequest({
        client_key: creds.id,
        client_secret: creds.secret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
    });
}

// --- Data ----------------------------------------------------------------

export interface TikTokUser {
    open_id: string;
    union_id: string | null;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    profile_deep_link: string | null;
    follower_count: number | null;
    following_count: number | null;
    likes_count: number | null;
    video_count: number | null;
}

export async function tiktokUserInfo(accessToken: string): Promise<TikTokUser> {
    const res = await fetch(`${API}/user/info/?fields=${USER_FIELDS}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    checkError(json, res.status);
    const u = json?.data?.user ?? {};
    return {
        open_id: String(u.open_id ?? ''),
        union_id: u.union_id ?? null,
        display_name: u.display_name ?? null,
        username: u.username ?? null,
        avatar_url: u.avatar_url ?? null,
        profile_deep_link: u.profile_deep_link ?? null,
        follower_count: toInt(u.follower_count),
        following_count: toInt(u.following_count),
        likes_count: toInt(u.likes_count),
        video_count: toInt(u.video_count),
    };
}

async function tiktokVideos(accessToken: string): Promise<PostMetrics[]> {
    const res = await fetch(`${API}/video/list/?fields=${VIDEO_FIELDS}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_count: VIDEOS_PER_SYNC }),
        cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    checkError(json, res.status);
    return (json?.data?.videos ?? []).map((v: any): PostMetrics => ({
        external_id: String(v.id),
        published_at: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : null,
        caption: v.title ?? null,
        media_type: 'video',
        permalink: v.share_url ?? null,
        thumbnail_url: v.cover_image_url ?? null,
        views: toInt(v.view_count),
        likes: toInt(v.like_count),
        comments: toInt(v.comment_count),
        shares: toInt(v.share_count),
    }));
}

/** The previous snapshot, so today's row can carry the day's change. */
export interface TikTokPrevSnapshot {
    followers: number | null;
    raw: Record<string, unknown> | null;
}

export async function syncTikTokAccount(accessToken: string, prev: TikTokPrevSnapshot | null): Promise<SyncResult> {
    const user = await tiktokUserInfo(accessToken);
    const posts = await tiktokVideos(accessToken);

    const sum = (key: 'views' | 'likes' | 'comments' | 'shares') => posts.reduce((a, p) => a + (p[key] ?? 0), 0);
    const snapshot = {
        follower_count: user.follower_count,
        likes_count: user.likes_count,
        video_count: user.video_count,
        video_views_total: sum('views'),
        video_likes_total: sum('likes'),
        video_comments_total: sum('comments'),
        video_shares_total: sum('shares'),
        videos_counted: posts.length,
    };
    const prevRaw = (prev?.raw ?? {}) as Record<string, unknown>;
    const delta = (key: keyof typeof snapshot, prevKey = key) => {
        const now = snapshot[key];
        const before = toInt(prevRaw[prevKey]);
        return now !== null && now !== undefined && before !== null ? Math.max(0, Number(now) - before) : null;
    };

    const day = shiftDay(isoDay(new Date()), -1);
    const likesDelta = delta('likes_count');
    const row: DailyMetrics = {
        day,
        followers: user.follower_count,
        follower_delta: prev?.followers !== null && prev?.followers !== undefined && user.follower_count !== null
            ? user.follower_count - prev.followers
            : null,
        views: delta('video_views_total'),
        likes: likesDelta ?? delta('video_likes_total'),
        comments: delta('video_comments_total'),
        shares: delta('video_shares_total'),
        raw: snapshot,
    };
    const parts = [row.likes, row.comments, row.shares];
    row.engagements = parts.some((v) => v !== null) ? parts.reduce((a, v) => (a ?? 0) + (v ?? 0), 0) : null;

    return {
        days: [row],
        posts,
        profile: {
            handle: user.username,
            display_name: user.display_name,
            avatar_url: user.avatar_url,
            profile_url: user.profile_deep_link ?? (user.username ? `https://www.tiktok.com/@${user.username}` : null),
        },
        notes: prev ? [] : ['TikTok: first snapshot taken — daily changes appear from tomorrow.'],
    };
}
