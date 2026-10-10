/**
 * Weekly social insights: what moved, what worked, what to try — per brand.
 *
 * Built from the data the daily sync already stores (social_metrics_daily,
 * social_posts with the content columns, social_site_traffic_daily), so a
 * report never calls a platform API. The numbers are computed here; the
 * narrative (headline, what worked / didn't, recommendations, experiments)
 * is written by Gemini Flash from those numbers, with a rule-based fallback
 * so the Monday email goes out even when Gemini is down or unkeyed. Every
 * report is stored (social_insight_reports, one per brand per week) so the
 * dashboard can show it and the cron can be re-run safely.
 *
 * Engagement rate = (likes + comments + shares + saves) / max(reach, views):
 * reach-based where the platform reports reach (Instagram), view-based
 * otherwise (Facebook, YouTube). Posting hours and "best time" are Bangkok
 * time; Instagram's online_followers hours arrive in UTC.
 *
 * Server-only: service-role Supabase, Gemini key, Courier.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendHtmlEmail } from '@/lib/courier';
import { getAppBaseUrl } from '@/lib/stripe';
import {
    BRAND_LABELS, PLATFORM_LABELS, SITE_BRAND, isoDay, shiftDay,
    type SocialBrand, type SocialPlatform,
} from './types';

export const INSIGHTS_EMAIL_DEFAULT = 'support@thailandtcg.com';
export function insightsRecipient(): string {
    return (process.env.SOCIAL_INSIGHTS_EMAIL || INSIGHTS_EMAIL_DEFAULT).trim();
}

const BANGKOK_OFFSET_HOURS = 7;
const CONTENT_WINDOW_DAYS = 28;
const MIN_AUDIENCE_FOR_RANKING = 50;
const GEMINI_MODEL = 'gemini-2.5-flash';

export interface PlatformWeek {
    platform: SocialPlatform;
    label: string;
    followersNow: number | null;
    followersDelta: number | null;
    followersDeltaPrev: number | null;
    reach: number | null;
    reachPrev: number | null;
    views: number | null;
    viewsPrev: number | null;
    engagements: number | null;
    engagementsPrev: number | null;
    posts: number;
    postsPrev: number;
    linkClicks: number | null;
    linkClicksPrev: number | null;
    /** Cardstreet only: the organic share of link clicks (bio / page / video / plain referrals), the rest being paid placements. */
    linkClicksOrganic: number | null;
    linkClicksOrganicPrev: number | null;
    signups: number | null;
    signupsPrev: number | null;
}

// GA4 mediums that mean money was spent; everything else is organic.
const PAID_MEDIUM = /paid|cpc|cpm|ppc|ads?$|_ads|right_column|desktop_feed|mobile_feed|instagram_feed|reels_ads|boost/i;
export function isPaidMedium(medium: string | null | undefined): boolean {
    return PAID_MEDIUM.test(medium ?? '');
}

export interface PostSummary {
    platform: SocialPlatform;
    format: string | null;
    caption: string;
    permalink: string | null;
    publishedAt: string | null;
    publishedHourBangkok: number | null;
    reach: number | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    follows: number | null;
    engagementRate: number | null;
    avgWatchSeconds: number | null;
    avgWatchPct: number | null;
    hookPct: number | null;
    durationSeconds: number | null;
}

export interface FormatSummary {
    platform: SocialPlatform;
    format: string;
    count: number;
    avgEngagementRate: number | null;
    avgReach: number | null;
    avgWatchPct: number | null;
    avgHookPct: number | null;
}

export interface HourBucket {
    bucket: 'night' | 'morning' | 'afternoon' | 'evening';
    hours: string;
    count: number;
    avgEngagementRate: number | null;
    avgReach: number | null;
}

export interface WeeklyStats {
    brand: SocialBrand;
    brandLabel: string;
    weekStart: string;
    weekEnd: string;
    prevStart: string;
    prevEnd: string;
    platforms: PlatformWeek[];
    topPosts: PostSummary[];
    bottomPosts: PostSummary[];
    formats: FormatSummary[];
    postingHours: HourBucket[];
    /** Bangkok hours when Instagram followers are most often online, best first. */
    bestOnlineHours: number[];
    postsAnalysed: number;
    notes: string[];
}

export interface Narrative {
    headline: string;
    summary: string;
    whatWorked: string[];
    whatDidnt: string[];
    recommendations: string[];
    experiments: string[];
    generatedBy: 'gemini' | 'rules';
}

// --- helpers ------------------------------------------------------------------

const sum = (vals: (number | null | undefined)[]): number | null => {
    let any = false; let t = 0;
    for (const v of vals) if (v !== null && v !== undefined) { any = true; t += v; }
    return any ? t : null;
};
const avg = (vals: (number | null | undefined)[]): number | null => {
    const xs = vals.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
    return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;
};
const pctChange = (now: number | null, prev: number | null): number | null =>
    now === null || prev === null || prev === 0 ? null : Math.round(((now - prev) / prev) * 1000) / 10;
const fmt = (n: number | null | undefined): string => (n === null || n === undefined ? 'n/a' : Math.round(n).toLocaleString('en-US'));
const fmtPct = (n: number | null | undefined): string => (n === null || n === undefined ? 'n/a' : `${n.toFixed(1)}%`);
const arrow = (p: number | null): string => (p === null ? '' : p > 0 ? ` (+${p}%)` : p < 0 ? ` (${p}%)` : ' (0%)');

function bangkokHour(iso: string | null): number | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return (d.getUTCHours() + BANGKOK_OFFSET_HOURS) % 24;
}
function bucketOf(hour: number): HourBucket['bucket'] {
    if (hour < 6) return 'night';
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
}
const BUCKET_HOURS: Record<HourBucket['bucket'], string> = { night: '00–05', morning: '06–11', afternoon: '12–17', evening: '18–23' };

/**
 * Null when the platform reported no interaction counts at all (a Facebook
 * post before the pages_read_user_content reconnect): unknown is not zero,
 * and a zero here would rank real posts as failures.
 */
function engagementRate(p: { likes?: number | null; comments?: number | null; shares?: number | null; saves?: number | null; reach?: number | null; views?: number | null }): number | null {
    const base = Math.max(p.reach ?? 0, p.views ?? 0);
    if (base < 1) return null;
    const parts = [p.likes, p.comments, p.shares, p.saves];
    if (parts.every((v) => v === null || v === undefined)) return null;
    const inter = parts.reduce<number>((a, v) => a + (v ?? 0), 0);
    return Math.round((inter / base) * 10000) / 100;
}

// --- stats ----------------------------------------------------------------------

export async function buildWeeklyStats(brand: SocialBrand, weekEnd: string): Promise<WeeklyStats> {
    const supabase = createAdminClient();
    const weekStart = shiftDay(weekEnd, -6);
    const prevEnd = shiftDay(weekStart, -1);
    const prevStart = shiftDay(prevEnd, -6);
    const contentSince = shiftDay(weekEnd, -(CONTENT_WINDOW_DAYS - 1));
    const notes: string[] = [];

    const { data: accounts, error: accErr } = await supabase
        .from('social_accounts').select('id, platform, display_name').eq('brand', brand).eq('enabled', true);
    if (accErr) throw new Error(accErr.message);
    const platformOf = new Map<string, SocialPlatform>((accounts ?? []).map((a: any) => [a.id, a.platform]));
    const ids = [...platformOf.keys()];

    const { data: daily } = ids.length
        ? await supabase.from('social_metrics_daily')
            .select('account_id, day, followers, follower_delta, reach, views, engagements, link_clicks, raw')
            .in('account_id', ids).gte('day', prevStart).lte('day', weekEnd).order('day')
        : { data: [] as any[] };
    const { data: postRows } = ids.length
        ? await supabase.from('social_posts').select('*').in('account_id', ids).gte('published_at', `${contentSince}T00:00:00Z`).limit(500)
        : { data: [] as any[] };

    // Cardstreet's link clicks and sign-ups come from GA4 rows; the pet channel's are Meta taps.
    let traffic: any[] = [];
    if (brand === SITE_BRAND) {
        const res = await supabase.from('social_site_traffic_daily')
            .select('day, platform, medium, sessions, signups').gte('day', prevStart).lte('day', weekEnd);
        if (res.error) {
            const legacy = await supabase.from('social_site_traffic_daily').select('day, platform, sessions').gte('day', prevStart).lte('day', weekEnd);
            traffic = legacy.data ?? [];
            notes.push('Sign-ups per link need migration 20261010.');
        } else traffic = res.data ?? [];
    }

    const inWeek = (d: string) => d >= weekStart && d <= weekEnd;
    const inPrev = (d: string) => d >= prevStart && d <= prevEnd;
    const rows = (daily ?? []) as any[];
    const posts = ((postRows ?? []) as any[]).map((p): PostSummary => ({
        platform: platformOf.get(p.account_id) ?? 'facebook',
        format: p.format ?? p.media_type ?? null,
        caption: String(p.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 90) || '(no caption)',
        permalink: p.permalink ?? null,
        publishedAt: p.published_at ?? null,
        publishedHourBangkok: bangkokHour(p.published_at),
        reach: p.reach ?? null,
        views: p.views ?? null,
        likes: p.likes ?? null,
        comments: p.comments ?? null,
        shares: p.shares ?? null,
        saves: p.saves ?? null,
        follows: p.follows ?? null,
        engagementRate: engagementRate(p),
        avgWatchSeconds: p.avg_watch_seconds !== null && p.avg_watch_seconds !== undefined ? Number(p.avg_watch_seconds) : null,
        avgWatchPct: p.avg_watch_pct !== null && p.avg_watch_pct !== undefined ? Number(p.avg_watch_pct) : null,
        hookPct: p.hook_pct !== null && p.hook_pct !== undefined ? Number(p.hook_pct) : null,
        durationSeconds: p.duration_seconds ?? null,
    }));

    const platformsPresent = [...new Set(platformOf.values())];
    const platforms: PlatformWeek[] = platformsPresent.map((platform) => {
        const accIds = ids.filter((id) => platformOf.get(id) === platform);
        const mine = rows.filter((r) => accIds.includes(r.account_id));
        const week = mine.filter((r) => inWeek(r.day));
        const prev = mine.filter((r) => inPrev(r.day));
        const followersNow = [...mine].reverse().find((r) => r.followers !== null)?.followers ?? null;
        const postsWeek = posts.filter((p) => p.platform === platform && p.publishedAt && inWeek(p.publishedAt.slice(0, 10))).length;
        const postsPrev = posts.filter((p) => p.platform === platform && p.publishedAt && inPrev(p.publishedAt.slice(0, 10))).length;
        const tWeek = traffic.filter((t) => t.platform === platform && inWeek(t.day));
        const tPrev = traffic.filter((t) => t.platform === platform && inPrev(t.day));
        const useSite = brand === SITE_BRAND;
        return {
            platform,
            label: PLATFORM_LABELS[platform],
            followersNow,
            followersDelta: sum(week.map((r) => r.follower_delta)),
            followersDeltaPrev: sum(prev.map((r) => r.follower_delta)),
            reach: platform === 'instagram' ? sum(week.map((r) => r.reach)) : null,
            reachPrev: platform === 'instagram' ? sum(prev.map((r) => r.reach)) : null,
            views: sum(week.map((r) => r.views)),
            viewsPrev: sum(prev.map((r) => r.views)),
            engagements: sum(week.map((r) => r.engagements)),
            engagementsPrev: sum(prev.map((r) => r.engagements)),
            posts: postsWeek,
            postsPrev,
            linkClicks: useSite ? tWeek.reduce((a, t) => a + (t.sessions ?? 0), 0) : (platform === 'youtube' ? null : sum(week.map((r) => r.link_clicks))),
            linkClicksPrev: useSite ? tPrev.reduce((a, t) => a + (t.sessions ?? 0), 0) : (platform === 'youtube' ? null : sum(prev.map((r) => r.link_clicks))),
            linkClicksOrganic: useSite ? tWeek.filter((t) => !isPaidMedium(t.medium)).reduce((a, t) => a + (t.sessions ?? 0), 0) : null,
            linkClicksOrganicPrev: useSite ? tPrev.filter((t) => !isPaidMedium(t.medium)).reduce((a, t) => a + (t.sessions ?? 0), 0) : null,
            signups: useSite ? tWeek.reduce((a, t) => a + (t.signups ?? 0), 0) : null,
            signupsPrev: useSite ? tPrev.reduce((a, t) => a + (t.signups ?? 0), 0) : null,
        };
    });

    const ranked = posts
        .filter((p) => Math.max(p.reach ?? 0, p.views ?? 0) >= MIN_AUDIENCE_FOR_RANKING && p.engagementRate !== null)
        .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0));
    const topPosts = ranked.slice(0, 5);
    const bottomPosts = ranked.length > 5 ? ranked.slice(-3).reverse() : [];

    const formatGroups = new Map<string, PostSummary[]>();
    for (const p of posts) {
        const key = `${p.platform}|${p.format ?? 'post'}`;
        formatGroups.set(key, [...(formatGroups.get(key) ?? []), p]);
    }
    const formats: FormatSummary[] = [...formatGroups.entries()].map(([key, ps]) => {
        const [platform, format] = key.split('|');
        return {
            platform: platform as SocialPlatform,
            format,
            count: ps.length,
            avgEngagementRate: avg(ps.map((p) => p.engagementRate)),
            avgReach: avg(ps.map((p) => p.reach ?? p.views)),
            avgWatchPct: avg(ps.map((p) => p.avgWatchPct)),
            avgHookPct: avg(ps.map((p) => p.hookPct)),
        };
    }).sort((a, b) => b.count - a.count);

    const buckets: HourBucket['bucket'][] = ['morning', 'afternoon', 'evening', 'night'];
    const postingHours: HourBucket[] = buckets.map((bucket) => {
        const ps = posts.filter((p) => p.publishedHourBangkok !== null && bucketOf(p.publishedHourBangkok) === bucket);
        return { bucket, hours: BUCKET_HOURS[bucket], count: ps.length, avgEngagementRate: avg(ps.map((p) => p.engagementRate)), avgReach: avg(ps.map((p) => p.reach ?? p.views)) };
    });

    // Instagram online_followers: average each UTC hour across the stored days, shift to Bangkok.
    const hourTotals = new Array(24).fill(0);
    let hourDays = 0;
    for (const r of rows) {
        const online = (r.raw as any)?.online_followers;
        if (!online || typeof online !== 'object' || platformOf.get(r.account_id) !== 'instagram') continue;
        hourDays++;
        for (const [h, n] of Object.entries(online)) {
            const hour = Number(h);
            if (hour >= 0 && hour < 24) hourTotals[(hour + BANGKOK_OFFSET_HOURS) % 24] += Number(n) || 0;
        }
    }
    const bestOnlineHours = hourDays
        ? hourTotals.map((t, h) => [t, h] as [number, number]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, h]) => h)
        : [];

    if (posts.length === 0) notes.push('No posts in the last 28 days with stored metrics.');
    const fbPosts = posts.filter((p) => p.platform === 'facebook');
    if (fbPosts.length && fbPosts.every((p) => p.engagementRate === null)) {
        notes.push('Facebook post likes/comments are not available yet (the Meta app needs a Reconnect for pages_read_user_content), so Facebook engagement rates are unknown — not zero — and those posts are left out of the rankings.');
    }

    return {
        brand, brandLabel: BRAND_LABELS[brand], weekStart, weekEnd, prevStart, prevEnd,
        platforms, topPosts, bottomPosts, formats, postingHours, bestOnlineHours,
        postsAnalysed: posts.length, notes,
    };
}

// --- narrative -----------------------------------------------------------------

function rulesNarrative(s: WeeklyStats): Narrative {
    const movers = s.platforms
        .map((p) => ({ p, change: pctChange(p.views, p.viewsPrev) }))
        .filter((m) => m.change !== null)
        .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!));
    const biggest = movers[0];
    const headline = biggest
        ? `${biggest.p.label} views ${biggest.change! >= 0 ? 'up' : 'down'} ${Math.abs(biggest.change!)}% week on week`
        : `${s.brandLabel}: week of ${s.weekStart} to ${s.weekEnd}`;
    const followers = sum(s.platforms.map((p) => p.followersDelta));
    const summary = `${s.brandLabel} added ${fmt(followers)} followers across ${s.platforms.length} platform${s.platforms.length === 1 ? '' : 's'} this week; ${s.postsAnalysed} posts from the last 28 days were analysed.`;
    const whatWorked = s.topPosts.slice(0, 3).map((p) => `${PLATFORM_LABELS[p.platform]} ${p.format ?? 'post'} "${p.caption}" — ${fmtPct(p.engagementRate)} engagement${p.saves ? `, ${p.saves} saves` : ''}${p.shares ? `, ${p.shares} shares` : ''}.`);
    const whatDidnt = s.bottomPosts.slice(0, 2).map((p) => `${PLATFORM_LABELS[p.platform]} ${p.format ?? 'post'} "${p.caption}" — ${fmtPct(p.engagementRate)} engagement on ${fmt(Math.max(p.reach ?? 0, p.views ?? 0))} reached.`);
    const site = s.platforms.filter((p) => p.linkClicksOrganic !== null);
    if (site.length) {
        const org = sum(site.map((p) => p.linkClicksOrganic));
        const orgPrev = sum(site.map((p) => p.linkClicksOrganicPrev));
        const total = sum(site.map((p) => p.linkClicks));
        whatDidnt.push(`Organic link clicks ${fmt(org)} vs ${fmt(orgPrev)} last week (${fmt(total)} total including paid).`);
    }
    const recommendations: string[] = [];
    const bestFormat = [...s.formats].filter((f) => f.count >= 2 && f.avgEngagementRate !== null).sort((a, b) => (b.avgEngagementRate ?? 0) - (a.avgEngagementRate ?? 0))[0];
    if (bestFormat) recommendations.push(`${PLATFORM_LABELS[bestFormat.platform]} ${bestFormat.format}s average ${fmtPct(bestFormat.avgEngagementRate)} engagement over ${bestFormat.count} posts — lean into that format.`);
    const bestBucket = [...s.postingHours].filter((b) => b.count >= 2 && b.avgEngagementRate !== null).sort((a, b) => (b.avgEngagementRate ?? 0) - (a.avgEngagementRate ?? 0))[0];
    if (bestBucket) recommendations.push(`Posts published in the ${bestBucket.bucket} (${bestBucket.hours} Bangkok) engaged best (${fmtPct(bestBucket.avgEngagementRate)}).`);
    if (s.bestOnlineHours.length) recommendations.push(`Instagram followers are most often online around ${s.bestOnlineHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')} Bangkok time — schedule Reels just before those hours.`);
    const experiments = [
        'Post the same idea as a Reel and as a carousel in the same week and compare saves.',
        'Open the next three videos with the result in the first 3 seconds and watch the hook figure.',
    ];
    return { headline, summary, whatWorked, whatDidnt, recommendations, experiments, generatedBy: 'rules' };
}

let _ai: GoogleGenAI | null | undefined;
function getAi(): GoogleGenAI | null {
    if (_ai !== undefined) return _ai;
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    _ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
    return _ai;
}

export async function narrate(stats: WeeklyStats): Promise<Narrative> {
    const fallback = rulesNarrative(stats);
    const ai = getAi();
    if (!ai) return fallback;
    const context = stats.brand === SITE_BRAND
        ? 'Cardstreet is a trading-card (Pokémon, One Piece, Yu-Gi-Oh, MTG) marketplace app in Thailand; the social channels exist to bring collectors to the app and turn them into buyers and sellers. Link clicks are visits to cardstreet.app from the bio links; sign-ups are accounts created after such a visit.'
        : 'Chopper & Kuma is a pet (dog) entertainment channel — unrelated to any product; the goal is audience growth and engagement. Link clicks are taps on the profile link.';
    const prompt = `You are a social media analyst writing the Monday report for ${stats.brandLabel}'s content lead (Arisa). ${context}

Below are this week's numbers (${stats.weekStart} to ${stats.weekEnd}) versus the previous week, plus the last 28 days of posts with their metrics. Engagement rate = (likes+comments+shares+saves) / max(reach, views). "hookPct" (YouTube only) = % of viewers still watching at 30 seconds. "avgWatchPct" = average % of the video watched (Shorts loop, so it can exceed 100%). "linkClicksOrganic" is the part of linkClicks that came from bio/page/video links and plain shares; the remainder came from paid placements, so a fall in total clicks when organic held steady means ads stopped, not that content got worse. Hours are Bangkok time. Numbers marked null were not reported by the platform — never invent them, and never describe a null metric as zero or poor. Read the "notes" first: they say which metrics are unavailable this week.

Write a short, concrete, honest analysis. Cite the actual numbers. Prefer specific observations ("the two carousels averaged 4.1% vs 1.3% for photos") over generic advice. If the data is too thin to support a claim, say so instead of guessing. Keep each bullet under 30 words. 3-5 bullets per list; experiments are 2-3 testable ideas for next week. Each list item must be a complete sentence.

DATA:
${JSON.stringify({
        platforms: stats.platforms,
        topPosts: stats.topPosts,
        bottomPosts: stats.bottomPosts,
        formats: stats.formats,
        postingHours: stats.postingHours,
        bestOnlineHoursBangkok: stats.bestOnlineHours,
        postsAnalysed: stats.postsAnalysed,
        notes: stats.notes,
    })}`;
    try {
        const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        headline: { type: Type.STRING },
                        summary: { type: Type.STRING },
                        whatWorked: { type: Type.ARRAY, items: { type: Type.STRING } },
                        whatDidnt: { type: Type.ARRAY, items: { type: Type.STRING } },
                        recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
                        experiments: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['headline', 'summary', 'whatWorked', 'whatDidnt', 'recommendations', 'experiments'],
                },
            },
        });
        const parsed = JSON.parse(response.text || '{}');
        if (!parsed?.headline || !Array.isArray(parsed.recommendations)) return fallback;
        // Gemini occasionally leaks a stray key ("whatDidnt':") or a one-word fragment into a list.
        const list = (v: unknown) => (Array.isArray(v)
            ? v.map((x) => String(x).trim().replace(/^["'“]+|["'”]+$/g, '').trim())
                .filter((x) => x.length >= 15 && !/^(what|recommend|experiment|summary|headline)\w*['"]?:?$/i.test(x))
                .slice(0, 6)
            : []);
        return {
            headline: String(parsed.headline).slice(0, 160),
            summary: String(parsed.summary ?? '').slice(0, 600),
            whatWorked: list(parsed.whatWorked),
            whatDidnt: list(parsed.whatDidnt),
            recommendations: list(parsed.recommendations),
            experiments: list(parsed.experiments),
            generatedBy: 'gemini',
        };
    } catch (e) {
        console.error('[social-insights] Gemini narrative failed, using rules:', e instanceof Error ? e.message : e);
        return fallback;
    }
}

// --- email ----------------------------------------------------------------------

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function renderInsightsHtml(s: WeeklyStats, n: Narrative): string {
    const dash = `${getAppBaseUrl()}/admin/social`;
    const td = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;';
    const th = 'padding:6px 8px;border-bottom:2px solid #d1d5db;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;text-align:left;';
    const num = `${td}text-align:right;white-space:nowrap;`;
    const h2 = 'font-size:15px;margin:22px 0 8px;color:#111827;';
    const li = (items: string[]) => items.length ? `<ul style="margin:0;padding-left:18px;">${items.map((i) => `<li style="margin:4px 0;font-size:13px;color:#111827;">${esc(i)}</li>`).join('')}</ul>` : '<p style="font-size:13px;color:#6b7280;margin:0;">Nothing to report yet.</p>';
    const post = (p: PostSummary) => `<tr>
        <td style="${td}"><span style="color:#6b7280;">${esc(PLATFORM_LABELS[p.platform])} · ${esc(p.format ?? 'post')}</span><br>${p.permalink ? `<a href="${esc(p.permalink)}" style="color:#0e7490;text-decoration:none;">${esc(p.caption)}</a>` : esc(p.caption)}</td>
        <td style="${num}">${fmt(p.reach ?? p.views)}</td>
        <td style="${num}">${fmtPct(p.engagementRate)}</td>
        <td style="${num}">${fmt(p.saves)} / ${fmt(p.shares)}</td>
        <td style="${num}">${p.hookPct !== null ? fmtPct(p.hookPct) : (p.avgWatchPct !== null ? fmtPct(p.avgWatchPct) : 'n/a')}</td>
    </tr>`;
    const platformRows = s.platforms.map((p) => `<tr>
        <td style="${td}"><b>${esc(p.label)}</b></td>
        <td style="${num}">${fmt(p.followersNow)}<br><span style="color:#059669;font-size:11px;">${p.followersDelta !== null ? (p.followersDelta >= 0 ? '+' : '') + fmt(p.followersDelta) : 'n/a'} this week</span></td>
        <td style="${num}">${fmt(p.reach)}${arrow(pctChange(p.reach, p.reachPrev))}</td>
        <td style="${num}">${fmt(p.views)}${arrow(pctChange(p.views, p.viewsPrev))}</td>
        <td style="${num}">${fmt(p.engagements)}${arrow(pctChange(p.engagements, p.engagementsPrev))}</td>
        <td style="${num}">${fmt(p.linkClicks)}${arrow(pctChange(p.linkClicks, p.linkClicksPrev))}${p.linkClicksOrganic !== null && p.linkClicks !== null && p.linkClicksOrganic !== p.linkClicks ? `<br><span style="color:#6b7280;font-size:11px;">${fmt(p.linkClicksOrganic)} organic${arrow(pctChange(p.linkClicksOrganic, p.linkClicksOrganicPrev))}</span>` : ''}</td>
        <td style="${num}">${p.signups === null ? '—' : fmt(p.signups) + arrow(pctChange(p.signups, p.signupsPrev))}</td>
        <td style="${num}">${p.posts}</td>
    </tr>`).join('');
    const formatRows = s.formats.filter((f) => f.count >= 1).slice(0, 10).map((f) => `<tr>
        <td style="${td}">${esc(PLATFORM_LABELS[f.platform])} · ${esc(f.format)}</td>
        <td style="${num}">${f.count}</td>
        <td style="${num}">${fmtPct(f.avgEngagementRate)}</td>
        <td style="${num}">${fmt(f.avgReach)}</td>
        <td style="${num}">${f.avgHookPct !== null ? fmtPct(f.avgHookPct) : (f.avgWatchPct !== null ? fmtPct(f.avgWatchPct) : 'n/a')}</td>
    </tr>`).join('');
    const hourRows = s.postingHours.filter((b) => b.count > 0).map((b) => `<tr>
        <td style="${td}">${b.bucket} (${b.hours})</td><td style="${num}">${b.count}</td><td style="${num}">${fmtPct(b.avgEngagementRate)}</td><td style="${num}">${fmt(b.avgReach)}</td>
    </tr>`).join('');
    const best = s.bestOnlineHours.length ? `Instagram followers are most often online around <b>${s.bestOnlineHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')}</b> (Bangkok).` : 'No Instagram online-followers data yet.';

    return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
<div style="max-width:680px;margin:0 auto;padding:24px 16px;">
  <div style="background:#ffffff;border-radius:16px;padding:24px;border:1px solid #e5e7eb;">
    <p style="margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Weekly social insights · ${esc(s.brandLabel)}</p>
    <h1 style="font-size:20px;margin:6px 0 2px;color:#111827;">${esc(n.headline)}</h1>
    <p style="margin:0 0 14px;font-size:12px;color:#6b7280;">${s.weekStart} → ${s.weekEnd}, compared with ${s.prevStart} → ${s.prevEnd}. ${s.postsAnalysed} posts from the last 28 days analysed.</p>
    <p style="font-size:14px;line-height:1.5;color:#111827;margin:0 0 6px;">${esc(n.summary)}</p>

    <h2 style="${h2}">This week by platform</h2>
    <table style="width:100%;border-collapse:collapse;"><thead><tr>
      <th style="${th}">Platform</th><th style="${th}text-align:right;">Followers</th><th style="${th}text-align:right;">Reach</th><th style="${th}text-align:right;">Views</th><th style="${th}text-align:right;">Engage.</th><th style="${th}text-align:right;">Link clicks</th><th style="${th}text-align:right;">Sign-ups</th><th style="${th}text-align:right;">Posts</th>
    </tr></thead><tbody>${platformRows}</tbody></table>

    <h2 style="${h2}">What worked</h2>${li(n.whatWorked)}
    <h2 style="${h2}">What didn't</h2>${li(n.whatDidnt)}
    <h2 style="${h2}">Recommendations</h2>${li(n.recommendations)}
    <h2 style="${h2}">Experiments for next week</h2>${li(n.experiments)}

    <h2 style="${h2}">Top posts, last 28 days (by engagement rate)</h2>
    ${s.topPosts.length ? `<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="${th}">Post</th><th style="${th}text-align:right;">Reach/views</th><th style="${th}text-align:right;">Engage.</th><th style="${th}text-align:right;">Saves / shares</th><th style="${th}text-align:right;">Hook / watch</th></tr></thead><tbody>${s.topPosts.map(post).join('')}</tbody></table>` : '<p style="font-size:13px;color:#6b7280;">No posts with enough reach to rank yet.</p>'}
    ${s.bottomPosts.length ? `<h2 style="${h2}">Weakest posts</h2><table style="width:100%;border-collapse:collapse;"><tbody>${s.bottomPosts.map(post).join('')}</tbody></table>` : ''}

    <h2 style="${h2}">By format</h2>
    ${formatRows ? `<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="${th}">Format</th><th style="${th}text-align:right;">Posts</th><th style="${th}text-align:right;">Avg engage.</th><th style="${th}text-align:right;">Avg reach</th><th style="${th}text-align:right;">Hook / watch</th></tr></thead><tbody>${formatRows}</tbody></table>` : '<p style="font-size:13px;color:#6b7280;">No format data yet.</p>'}

    <h2 style="${h2}">Posting time (Bangkok)</h2>
    ${hourRows ? `<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="${th}">When published</th><th style="${th}text-align:right;">Posts</th><th style="${th}text-align:right;">Avg engage.</th><th style="${th}text-align:right;">Avg reach</th></tr></thead><tbody>${hourRows}</tbody></table>` : ''}
    <p style="font-size:13px;color:#111827;margin:8px 0 0;">${best}</p>

    ${s.notes.length ? `<p style="font-size:11px;color:#9ca3af;margin-top:16px;">${s.notes.map(esc).join(' ')}</p>` : ''}
    <p style="font-size:11px;color:#9ca3af;margin-top:16px;">Numbers from each platform's own API and GA4, stored daily by Cardstreet. Narrative written by ${n.generatedBy === 'gemini' ? 'Gemini from those numbers' : 'rules (Gemini unavailable)'}. Full dashboard: <a href="${dash}" style="color:#0e7490;">${dash}</a></p>
  </div>
</div></body></html>`;
}

// --- orchestration -------------------------------------------------------------

export interface ReportResult {
    reportId: string | null;
    stats: WeeklyStats;
    narrative: Narrative;
    html: string;
    sent: boolean;
    sentTo: string | null;
    error?: string;
}

/**
 * Build, narrate, render, store and optionally send one brand's report for
 * the week ending `weekEnd` (default yesterday). Storing is best-effort
 * (the table arrives with migration 20261010); sending is not attempted
 * without a recipient.
 */
export async function produceWeeklyReport(brand: SocialBrand, opts: { weekEnd?: string; send?: boolean; to?: string } = {}): Promise<ReportResult> {
    const weekEnd = opts.weekEnd ?? shiftDay(isoDay(new Date()), -1);
    const stats = await buildWeeklyStats(brand, weekEnd);
    const narrative = await narrate(stats);
    const html = renderInsightsHtml(stats, narrative);
    const supabase = createAdminClient();

    let reportId: string | null = null;
    let storeError: string | undefined;
    const { data: stored, error } = await supabase
        .from('social_insight_reports')
        .upsert({ brand, week_start: stats.weekStart, week_end: stats.weekEnd, stats, narrative, html }, { onConflict: 'brand,week_start' })
        .select('id')
        .single();
    if (error) storeError = error.message; else reportId = stored?.id ?? null;

    let sent = false;
    const to = opts.send ? (opts.to ?? insightsRecipient()) : null;
    if (opts.send && to) {
        sent = await sendHtmlEmail({
            to,
            subject: `Social insights — ${stats.brandLabel}, week of ${stats.weekStart}: ${narrative.headline}`,
            html,
            data: { type: 'social_weekly_insights', brand, weekStart: stats.weekStart },
        });
        if (sent && reportId) {
            await supabase.from('social_insight_reports').update({ sent_to: to, sent_at: new Date().toISOString() }).eq('id', reportId);
        }
    }
    return { reportId, stats, narrative, html, sent, sentTo: sent ? to : null, error: storeError };
}
