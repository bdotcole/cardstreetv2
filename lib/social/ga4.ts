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

function loadKey(): ServiceAccountKey | null {
    const inline = process.env.GA4_SA_KEY_JSON;
    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    try {
        if (inline) return JSON.parse(inline);
        if (path) return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
    return null;
}

let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const key = loadKey();
    if (!key) throw new Error('GA4 service-account key not configured');
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

export interface SiteTrafficRow { day: string; platform: SocialPlatform; sessions: number; users: number }

export async function fetchSocialSiteTraffic(window: SyncWindow): Promise<SiteTrafficRow[]> {
    const property = process.env.GA4_PROPERTY_ID;
    if (!property) throw new Error('GA4_PROPERTY_ID not set');
    const token = await accessToken();
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            dateRanges: [{ startDate: window.since, endDate: window.until }],
            dimensions: [{ name: 'date' }, { name: 'sessionSource' }],
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
        const key = `${day}|${platform}`;
        const cur = acc.get(key) ?? { day, platform, sessions: 0, users: 0 };
        cur.sessions += toInt(row.metricValues?.[0]?.value) ?? 0;
        cur.users += toInt(row.metricValues?.[1]?.value) ?? 0;
        acc.set(key, cur);
    }
    return [...acc.values()];
}
