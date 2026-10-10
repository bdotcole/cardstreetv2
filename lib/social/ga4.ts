/**
 * GA4 side of the social dashboard: sessions on cardstreet.app that arrived
 * from each social platform, per day.
 *
 * This is the link-click number that matters for Cardstreet. The platforms'
 * own click counts are patchy (Instagram counts profile-link taps only,
 * Facebook lumps CTA and contact clicks, YouTube and TikTok report nothing),
 * whereas GA4 sees every visit that actually landed — from a bio link, a
 * post, a story, a comment, or the live-stream overlay.
 *
 * Same zero-dependency service-account JWT grant as scripts/ga4-report.mjs,
 * with the key accepted as a JSON string (GA4_SA_KEY_JSON — what Vercel can
 * hold) or a file path (GOOGLE_APPLICATION_CREDENTIALS — local dev). Server-only.
 */

import { createSign } from 'crypto';
import { readFileSync } from 'fs';
import { toInt, type SocialPlatform, type SyncWindow } from './types';

interface ServiceAccountKey { client_email: string; private_key: string }

/**
 * The key as pasted into Vercel is rarely clean JSON: the dashboard keeps the
 * real line breaks inside private_key (invalid JSON), or wraps the whole
 * thing in quotes. Parse strictly first, then fall back to pulling the two
 * fields we need out of the raw text, so a paste of the file "as is" works.
 */
function parseKey(raw: string): ServiceAccountKey | null {
    let text = raw.trim();
    if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"') && text.includes('{'))) {
        text = text.slice(1, -1);
    }
    try {
        const j = JSON.parse(text);
        if (j?.client_email && j?.private_key) return { client_email: j.client_email, private_key: j.private_key };
    } catch {
        // fall through to the lenient reader
    }
    const email = text.match(/"client_email"\s*:\s*"([^"]+)"/)?.[1];
    const key = text.match(/"private_key"\s*:\s*"([\s\S]*?)"\s*,?\s*(?:"client_email"|"client_id"|"auth_uri"|\})/)?.[1];
    if (!email || !key) return null;
    return { client_email: email, private_key: key.replace(/\\n/g, '\n') };
}

function loadKey(): { key: ServiceAccountKey | null; reason: string } {
    const inline = process.env.GA4_SA_KEY_JSON;
    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (inline) {
        const key = parseKey(inline);
        return { key, reason: key ? '' : 'GA4_SA_KEY_JSON is set but client_email / private_key could not be read from it' };
    }
    if (path) {
        try {
            const key = parseKey(readFileSync(path, 'utf8'));
            return { key, reason: key ? '' : `GOOGLE_APPLICATION_CREDENTIALS file has no client_email / private_key` };
        } catch (e) {
            return { key: null, reason: `GOOGLE_APPLICATION_CREDENTIALS not readable (${e instanceof Error ? e.message : String(e)}) — on Vercel use GA4_SA_KEY_JSON instead` };
        }
    }
    return { key: null, reason: 'GA4_SA_KEY_JSON / GOOGLE_APPLICATION_CREDENTIALS not set' };
}

let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const { key, reason } = loadKey();
    if (!key) throw new Error(`GA4 service-account key: ${reason}`);
    const b64 = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
    const iat = Math.floor(Date.now() / 1000);
    const claim = {
        iss: key.client_email,
        scope: 'https://www.googleapis.com/auth/analytics.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        exp: iat + 3600,
        iat,
    };
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claim)}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${unsigned}.${sig}`,
        }),
        cache: 'no-store',
    });
    const j = await res.json().catch(() => ({}));
    if (!j.access_token) throw new Error(`GA4 token exchange failed: ${JSON.stringify(j).slice(0, 200)}`);
    cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    return cached.token;
}

/** Referrer host / utm_source -> platform. Null for anything that is not one of ours. */
export function platformFromSource(source: string): SocialPlatform | null {
    const s = source.toLowerCase();
    if (s.includes('instagram') || s === 'ig') return 'instagram';
    if (s.includes('facebook') || s.includes('fb') || s.includes('messenger') || s.includes('meta')) return 'facebook';
    if (s.includes('tiktok')) return 'tiktok';
    if (s.includes('youtube') || s.includes('youtu.be')) return 'youtube';
    return null;
}

/**
 * One row per day x platform x campaign x medium. campaign is the utm_campaign
 * ('' when untagged — a plain referral), which decides the brand; medium is
 * the utm_medium ('' when none, 'referral' for an untagged referral), which
 * says where the link sat (bio / page / video / story).
 */
export interface SiteTrafficRow {
    day: string;
    platform: SocialPlatform;
    campaign: string;
    medium: string;
    sessions: number;
    users: number;
}

const GA_UNSET = new Set(['(not set)', '(none)', '(direct)']);
function clean(v: string | undefined): string {
    const s = (v ?? '').trim();
    return GA_UNSET.has(s.toLowerCase()) ? '' : s.toLowerCase();
}

export async function fetchSocialSiteTraffic(window: SyncWindow): Promise<SiteTrafficRow[]> {
    const property = process.env.GA4_PROPERTY_ID;
    if (!property) throw new Error('GA4_PROPERTY_ID not set');
    const token = await accessToken();
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            dateRanges: [{ startDate: window.since, endDate: window.until }],
            dimensions: [{ name: 'date' }, { name: 'sessionSource' }, { name: 'sessionCampaignName' }, { name: 'sessionMedium' }],
            metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
            dimensionFilter: {
                filter: {
                    fieldName: 'sessionSource',
                    stringFilter: { matchType: 'PARTIAL_REGEXP', value: 'facebook|fb|messenger|instagram|^ig$|tiktok|youtu', caseSensitive: false },
                },
            },
            limit: 10000,
        }),
        cache: 'no-store',
    });
    const j = await res.json().catch(() => ({}));
    if (j.error) throw new Error(`GA4 ${j.error.status}: ${j.error.message}`);

    // Several sources fold into one platform (l.facebook.com, m.facebook.com, fb) — sum them.
    const acc = new Map<string, SiteTrafficRow>();
    for (const row of j.rows ?? []) {
        const ymd: string = row.dimensionValues?.[0]?.value ?? '';
        const source: string = row.dimensionValues?.[1]?.value ?? '';
        const platform = platformFromSource(source);
        if (!platform || ymd.length !== 8) continue;
        const day = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
        const campaign = clean(row.dimensionValues?.[2]?.value);
        const medium = clean(row.dimensionValues?.[3]?.value);
        const key = `${day}|${platform}|${campaign}|${medium}`;
        const cur = acc.get(key) ?? { day, platform, campaign, medium, sessions: 0, users: 0 };
        cur.sessions += toInt(row.metricValues?.[0]?.value) ?? 0;
        cur.users += toInt(row.metricValues?.[1]?.value) ?? 0;
        acc.set(key, cur);
    }
    return [...acc.values()];
}

export interface SignupRow { day: string; platform: SocialPlatform; campaign: string; medium: string; signups: number }

/**
 * sign_up events by the user's FIRST-touch source — "accounts whose first
 * visit ever came from this platform" — which is the question a bio link
 * asks. Session-scoped attribution (used for clicks) would hand a sign-up
 * that happens two visits later to "(direct)".
 */
export async function fetchSocialSignups(window: SyncWindow): Promise<SignupRow[]> {
    const property = process.env.GA4_PROPERTY_ID;
    if (!property) throw new Error('GA4_PROPERTY_ID not set');
    const token = await accessToken();
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            dateRanges: [{ startDate: window.since, endDate: window.until }],
            dimensions: [{ name: 'date' }, { name: 'firstUserSource' }, { name: 'firstUserCampaignName' }, { name: 'firstUserMedium' }],
            metrics: [{ name: 'eventCount' }],
            dimensionFilter: {
                andGroup: {
                    expressions: [
                        { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'sign_up' } } },
                        { filter: { fieldName: 'firstUserSource', stringFilter: { matchType: 'PARTIAL_REGEXP', value: 'facebook|fb|messenger|instagram|^ig$|tiktok|youtu', caseSensitive: false } } },
                    ],
                },
            },
            limit: 10000,
        }),
        cache: 'no-store',
    });
    const j = await res.json().catch(() => ({}));
    if (j.error) throw new Error(`GA4 ${j.error.status}: ${j.error.message}`);

    const acc = new Map<string, SignupRow>();
    for (const row of j.rows ?? []) {
        const ymd: string = row.dimensionValues?.[0]?.value ?? '';
        const platform = platformFromSource(row.dimensionValues?.[1]?.value ?? '');
        if (!platform || ymd.length !== 8) continue;
        const day = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
        const campaign = clean(row.dimensionValues?.[2]?.value);
        const medium = clean(row.dimensionValues?.[3]?.value);
        const key = `${day}|${platform}|${campaign}|${medium}`;
        const cur = acc.get(key) ?? { day, platform, campaign, medium, signups: 0 };
        cur.signups += toInt(row.metricValues?.[0]?.value) ?? 0;
        acc.set(key, cur);
    }
    return [...acc.values()];
}
