/**
 * Meta Graph API provider: Facebook Pages and the Instagram professional
 * accounts linked to them.
 *
 * Auth model: the admin signs in with Facebook once; the short-lived user
 * token is exchanged for a 60-day one, and the PAGE tokens minted from that
 * long-lived user token do not expire while the admin keeps their Page role
 * and the app stays installed. Only Page tokens are stored — one per Page,
 * reused for the Page's Instagram account.
 *
 * Metrics move under us: Meta retired `impressions` and `page_fans` in
 * November 2025 and marks `page_impressions_unique` (reach) deprecated from
 * v25. Rather than hard-code today's list, every insights call goes through
 * `insightsWithFallback`: a metric the API refuses is dropped and named in
 * `notes` (the dashboard shows it), the rest still land. The API version is
 * pinned so a metric does not vanish between two cron runs.
 *
 * Instagram account insights only reach back ~90 days and accept at most a
 * 30-day since/until span per call, so windows are chunked.
 */

import {
    dayStartUnix, eachDay, isoDay, shiftDay, toInt,
    type DailyMetrics, type PostMetrics, type SyncResult, type SyncWindow,
} from './types';
import { providerCredentials } from './config';

export const GRAPH_VERSION = 'v24.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

export const META_SCOPES = [
    'pages_show_list',
    'pages_read_engagement',
    'read_insights',
    'instagram_basic',
    'instagram_manage_insights',
    'business_management',
];

const POSTS_PER_SYNC = 15;
const IG_MAX_SPAN_DAYS = 30;
const IG_LOOKBACK_DAYS = 88;
const FB_MAX_SPAN_DAYS = 90;

export class GraphError extends Error {
    constructor(message: string, public code: number | null, public subcode: number | null, public status: number) {
        super(message);
        this.name = 'GraphError';
    }
}

async function graphGet<T = any>(path: string, params: Record<string, string | number | undefined>, token?: string): Promise<T> {
    const url = new URL(`${GRAPH}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    if (token) url.searchParams.set('access_token', token);
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
        const e = json?.error ?? {};
        throw new GraphError(e.message || `Graph ${res.status}`, toInt(e.code), toInt(e.error_subcode), res.status);
    }
    return json as T;
}

// --- OAuth ---------------------------------------------------------------

export function metaAuthUrl(state: string, redirectUri: string): string {
    const creds = providerCredentials('meta');
    if (!creds) throw new Error('META_APP_ID / META_APP_SECRET not set');
    const url = new URL(DIALOG);
    url.searchParams.set('client_id', creds.id);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', META_SCOPES.join(','));
    return url.toString();
}

/** Code -> short-lived user token -> long-lived (60-day) user token. */
export async function metaExchangeCode(code: string, redirectUri: string): Promise<string> {
    const creds = providerCredentials('meta');
    if (!creds) throw new Error('META_APP_ID / META_APP_SECRET not set');
    const short = await graphGet<{ access_token: string }>('oauth/access_token', {
        client_id: creds.id,
        client_secret: creds.secret,
        redirect_uri: redirectUri,
        code,
    });
    const long = await graphGet<{ access_token: string }>('oauth/access_token', {
        grant_type: 'fb_exchange_token',
        client_id: creds.id,
        client_secret: creds.secret,
        fb_exchange_token: short.access_token,
    });
    return long.access_token;
}

export interface DiscoveredPage {
    pageId: string;
    name: string;
    pageToken: string;
    avatarUrl: string | null;
    link: string | null;
    instagram: {
        igUserId: string;
        username: string | null;
        name: string | null;
        avatarUrl: string | null;
    } | null;
}

/** Every Page the signed-in user has a role on, with its token and linked IG account. */
export async function metaDiscoverPages(userToken: string): Promise<DiscoveredPage[]> {
    const out: DiscoveredPage[] = [];
    let path = 'me/accounts';
    let params: Record<string, string> = {
        fields: 'id,name,access_token,link,picture{url},instagram_business_account{id,username,name,profile_picture_url}',
        limit: '50',
    };
    for (let page = 0; page < 10; page++) {
        const res = await graphGet<{ data: any[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, params, userToken);
        for (const p of res.data ?? []) {
            if (!p?.id || !p?.access_token) continue;
            const ig = p.instagram_business_account;
            out.push({
                pageId: String(p.id),
                name: p.name ?? '',
                pageToken: p.access_token,
                avatarUrl: p.picture?.data?.url ?? null,
                link: p.link ?? null,
                instagram: ig?.id ? {
                    igUserId: String(ig.id),
                    username: ig.username ?? null,
                    name: ig.name ?? null,
                    avatarUrl: ig.profile_picture_url ?? null,
                } : null,
            });
        }
        const after = res.paging?.cursors?.after;
        if (!res.paging?.next || !after) break;
        params = { ...params, after };
    }
    return out;
}

// --- Insights plumbing ---------------------------------------------------

const LIFETIME = 'lifetime';

interface InsightSeries {
    /** metric -> day -> value (time series); LIFETIME for period=lifetime rows. */
    byDay: Map<string, Map<string, number>>;
    /** metric -> value (total_value). */
    totals: Map<string, number>;
    dropped: string[];
}

/** Graph's end_time is the midnight AFTER the reported day (Pacific); step back one day. */
function dayFromEndTime(endTime: string): string {
    const d = new Date(endTime);
    d.setUTCDate(d.getUTCDate() - 1);
    return isoDay(d);
}

function parseInsights(json: any, into: InsightSeries) {
    for (const row of json?.data ?? []) {
        const name: string = row.name;
        if (!name) continue;
        if (row.total_value && typeof row.total_value.value !== 'undefined') {
            const v = toInt(row.total_value.value);
            if (v !== null) into.totals.set(name, v);
            continue;
        }
        const series = into.byDay.get(name) ?? new Map<string, number>();
        for (const v of row.values ?? []) {
            // Some metrics come broken down (e.g. by content type); the day's figure is their sum.
            const n = typeof v.value === 'object' && v.value !== null
                ? Object.values(v.value as Record<string, unknown>).reduce<number>((a, b) => a + (toInt(b) ?? 0), 0)
                : toInt(v.value);
            if (n === null) continue;
            // Lifetime values (media insights) carry no end_time.
            series.set(v.end_time ? dayFromEndTime(v.end_time) : LIFETIME, n);
        }
        into.byDay.set(name, series);
    }
}

/**
 * Fetch a metric group; if the group is refused, retry each metric alone and
 * drop only the ones the API rejects. A rejected metric is a platform change,
 * not an outage — the rest of the row still lands.
 */
async function insightsWithFallback(
    path: string, metrics: string[], params: Record<string, string | number | undefined>, token: string, into: InsightSeries,
) {
    try {
        parseInsights(await graphGet(path, { ...params, metric: metrics.join(',') }, token), into);
        return;
    } catch (e) {
        // Only a 4xx from Graph means "that metric"; anything else is an outage and should fail the sync.
        if (!(e instanceof GraphError) || e.status >= 500) throw e;
        if (metrics.length === 1) {
            into.dropped.push(`${metrics[0]} (${e.message})`);
            return;
        }
    }
    for (const m of metrics) {
        try {
            parseInsights(await graphGet(path, { ...params, metric: m }, token), into);
        } catch (e) {
            if (e instanceof GraphError && e.status < 500) into.dropped.push(`${m} (${e.message})`);
            else throw e;
        }
    }
}

function clampWindow(window: SyncWindow, maxLookbackDays: number): SyncWindow {
    const floor = shiftDay(isoDay(new Date()), -maxLookbackDays);
    return { since: window.since < floor ? floor : window.since, until: window.until };
}

function* chunks(window: SyncWindow, maxSpan: number): Generator<SyncWindow> {
    let since = window.since;
    while (since <= window.until) {
        const until = shiftDay(since, maxSpan - 1) < window.until ? shiftDay(since, maxSpan - 1) : window.until;
        yield { since, until };
        since = shiftDay(until, 1);
    }
}

// --- Facebook Page -------------------------------------------------------

const FB_DAILY_METRICS = [
    'page_follows',
    'page_daily_follows_unique',
    'page_daily_unfollows_unique',
    'page_views_total',
    'page_post_engagements',
    'page_total_actions',
    'page_media_view',
];
// Deprecated from v25; still served on the pinned version. Dropped cleanly when it goes.
const FB_REACH_METRICS = ['page_impressions_unique'];

export async function syncFacebookPage(pageId: string, pageToken: string, window: SyncWindow): Promise<SyncResult> {
    const series: InsightSeries = { byDay: new Map(), totals: new Map(), dropped: [] };

    for (const w of chunks(window, FB_MAX_SPAN_DAYS)) {
        const params = { period: 'day', since: dayStartUnix(w.since), until: dayStartUnix(w.until) + 86_400 };
        await insightsWithFallback(`${pageId}/insights`, FB_DAILY_METRICS, params, pageToken, series);
        await insightsWithFallback(`${pageId}/insights`, FB_REACH_METRICS, params, pageToken, series);
    }

    const page = await graphGet<any>(pageId, { fields: 'name,link,followers_count,picture{url}' }, pageToken);
    const at = (metric: string, day: string) => series.byDay.get(metric)?.get(day) ?? null;

    const days: DailyMetrics[] = eachDay(window.since, window.until).map((day) => {
        const follows = at('page_daily_follows_unique', day);
        const unfollows = at('page_daily_unfollows_unique', day);
        const engagements = at('page_post_engagements', day);
        return {
            day,
            followers: at('page_follows', day),
            follower_delta: follows !== null || unfollows !== null ? (follows ?? 0) - (unfollows ?? 0) : null,
            reach: at('page_impressions_unique', day),
            views: at('page_media_view', day),
            profile_views: at('page_views_total', day),
            link_clicks: at('page_total_actions', day),
            engagements,
        };
    });
    // The live follower total is the freshest number we have for the last day in the window.
    const last = days[days.length - 1];
    const followersNow = toInt(page?.followers_count);
    if (last && followersNow !== null && last.day === shiftDay(isoDay(new Date()), -1)) last.followers = followersNow;

    const posts = await facebookPosts(pageId, pageToken);

    return {
        days,
        posts,
        profile: {
            display_name: page?.name ?? null,
            profile_url: page?.link ?? null,
            avatar_url: page?.picture?.data?.url ?? null,
        },
        notes: series.dropped.length ? [`Facebook refused: ${series.dropped.join('; ')}`] : [],
    };
}

async function facebookPosts(pageId: string, pageToken: string): Promise<PostMetrics[]> {
    const base = 'id,message,created_time,permalink_url,full_picture,shares,comments.summary(total_count).limit(0),reactions.summary(total_count).limit(0)';
    let res: any;
    try {
        res = await graphGet(`${pageId}/posts`, { fields: `${base},insights.metric(post_media_view)`, limit: POSTS_PER_SYNC }, pageToken);
    } catch (e) {
        if (!(e instanceof GraphError) || e.status >= 500) throw e;
        res = await graphGet(`${pageId}/posts`, { fields: base, limit: POSTS_PER_SYNC }, pageToken);
    }
    return (res?.data ?? []).map((p: any): PostMetrics => {
        const insight = (p.insights?.data ?? []).find((i: any) => i.name === 'post_media_view');
        const views = insight ? toInt(insight.values?.[0]?.value) : null;
        return {
            external_id: String(p.id),
            published_at: p.created_time ?? null,
            caption: p.message ?? null,
            media_type: 'post',
            permalink: p.permalink_url ?? null,
            thumbnail_url: p.full_picture ?? null,
            views,
            likes: toInt(p.reactions?.summary?.total_count),
            comments: toInt(p.comments?.summary?.total_count),
            shares: toInt(p.shares?.count),
        };
    });
}

// --- Instagram professional account -------------------------------------

// time_series metrics: one call per <=30-day chunk.
const IG_SERIES_METRICS = ['reach'];
// Older daily metrics; Meta may retire them, and the fallback copes.
const IG_LEGACY_SERIES_METRICS = ['profile_views', 'website_clicks', 'follower_count'];
// total_value metrics: one call per day (the API aggregates over since..until).
const IG_TOTAL_METRICS = [
    'views', 'profile_links_taps', 'accounts_engaged', 'total_interactions',
    'likes', 'comments', 'shares', 'saves',
];
// total_value days are the slow part (one round trip each); a long backfill
// keeps the cheap series for the whole window and totals for the recent part.
const IG_TOTAL_MAX_DAYS = 31;

export async function syncInstagramAccount(igUserId: string, pageToken: string, window: SyncWindow): Promise<SyncResult> {
    const w = clampWindow(window, IG_LOOKBACK_DAYS);
    const series: InsightSeries = { byDay: new Map(), totals: new Map(), dropped: [] };
    const perDayTotals = new Map<string, Map<string, number>>();

    for (const c of chunks(w, IG_MAX_SPAN_DAYS)) {
        const params = { period: 'day', since: dayStartUnix(c.since), until: dayStartUnix(c.until) + 86_400 };
        await insightsWithFallback(`${igUserId}/insights`, IG_SERIES_METRICS, { ...params, metric_type: 'time_series' }, pageToken, series);
        await insightsWithFallback(`${igUserId}/insights`, IG_LEGACY_SERIES_METRICS, params, pageToken, series);
    }

    const totalDays = eachDay(w.since, w.until).slice(-IG_TOTAL_MAX_DAYS);
    let totalMetrics = [...IG_TOTAL_METRICS];
    for (const day of totalDays) {
        if (totalMetrics.length === 0) break;
        const dayTotals: InsightSeries = { byDay: new Map(), totals: new Map(), dropped: [] };
        await insightsWithFallback(`${igUserId}/insights`, totalMetrics, {
            period: 'day', metric_type: 'total_value', since: dayStartUnix(day), until: dayStartUnix(day) + 86_400,
        }, pageToken, dayTotals);
        perDayTotals.set(day, dayTotals.totals);
        // Whatever the first day rejected, every day will; stop asking.
        if (dayTotals.dropped.length) {
            const rejected = new Set(dayTotals.dropped.map((d) => d.split(' ')[0]));
            totalMetrics = totalMetrics.filter((m) => !rejected.has(m));
            for (const d of dayTotals.dropped) if (!series.dropped.includes(d)) series.dropped.push(d);
        }
    }

    const profile = await graphGet<any>(igUserId, { fields: 'username,name,profile_picture_url,followers_count,media_count' }, pageToken);
    const at = (metric: string, day: string) => series.byDay.get(metric)?.get(day) ?? null;
    const tot = (metric: string, day: string) => perDayTotals.get(day)?.get(metric) ?? null;

    const days: DailyMetrics[] = eachDay(w.since, w.until).map((day) => {
        const linkTaps = tot('profile_links_taps', day);
        const websiteClicks = at('website_clicks', day);
        const engagements = tot('total_interactions', day);
        return {
            day,
            follower_delta: at('follower_count', day),
            reach: at('reach', day),
            views: tot('views', day),
            profile_views: at('profile_views', day),
            link_clicks: linkTaps !== null || websiteClicks !== null ? (linkTaps ?? 0) + (websiteClicks ?? 0) : null,
            engagements: engagements ?? (
                tot('likes', day) !== null
                    ? (tot('likes', day) ?? 0) + (tot('comments', day) ?? 0) + (tot('shares', day) ?? 0) + (tot('saves', day) ?? 0)
                    : null
            ),
            likes: tot('likes', day),
            comments: tot('comments', day),
            shares: tot('shares', day),
            saves: tot('saves', day),
            raw: { accounts_engaged: tot('accounts_engaged', day) },
        };
    });
    const last = days[days.length - 1];
    const followersNow = toInt(profile?.followers_count);
    if (last && followersNow !== null && last.day === shiftDay(isoDay(new Date()), -1)) last.followers = followersNow;

    const posts = await instagramPosts(igUserId, pageToken);

    return {
        days,
        posts,
        profile: {
            handle: profile?.username ?? null,
            display_name: profile?.name ?? profile?.username ?? null,
            avatar_url: profile?.profile_picture_url ?? null,
            profile_url: profile?.username ? `https://www.instagram.com/${profile.username}/` : null,
        },
        notes: series.dropped.length ? [`Instagram refused: ${series.dropped.join('; ')}`] : [],
    };
}

const IG_MEDIA_INSIGHTS = ['reach', 'views', 'saved', 'shares', 'total_interactions'];

async function instagramPosts(igUserId: string, pageToken: string): Promise<PostMetrics[]> {
    const res = await graphGet<any>(`${igUserId}/media`, {
        fields: 'id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count',
        limit: POSTS_PER_SYNC,
    }, pageToken);
    const out: PostMetrics[] = [];
    for (const m of res?.data ?? []) {
        const s: InsightSeries = { byDay: new Map(), totals: new Map(), dropped: [] };
        try {
            await insightsWithFallback(`${m.id}/insights`, IG_MEDIA_INSIGHTS, {}, pageToken, s);
        } catch {
            // A single post's insights are not worth failing the account.
        }
        // Media insights are lifetime figures: parseInsights files them under LIFETIME (or as totals).
        const lifetime = new Map<string, number>();
        for (const [name, byDay] of s.byDay) {
            const v = byDay.get(LIFETIME);
            if (v !== undefined) lifetime.set(name, v);
        }
        for (const [name, v] of s.totals) lifetime.set(name, v);
        out.push({
            external_id: String(m.id),
            published_at: m.timestamp ?? null,
            caption: m.caption ?? null,
            media_type: (m.media_product_type || m.media_type || null)?.toLowerCase() ?? null,
            permalink: m.permalink ?? null,
            thumbnail_url: m.thumbnail_url ?? m.media_url ?? null,
            reach: lifetime.get('reach') ?? null,
            views: lifetime.get('views') ?? null,
            likes: toInt(m.like_count),
            comments: toInt(m.comments_count),
            shares: lifetime.get('shares') ?? null,
            saves: lifetime.get('saved') ?? null,
        });
    }
    return out;
}
