/**
 * First-touch signup attribution.
 *
 * WHY THIS EXISTS ALONGSIDE THE GA4 sign_up EVENT: GA4 can tell you how many
 * accounts organic search produced. It cannot tell you whether any of them ever
 * listed a card or spent a baht, because it does not join to orders. For that,
 * the source has to live on the account row — which is what this feeds.
 *
 * FIRST touch, not last. A visitor who finds a card page through Google, leaves,
 * and comes back a week later by typing the URL is an organic acquisition; last-
 * touch would record that as Direct and quietly credit SEO with nothing. The
 * cookie is therefore written once and never overwritten while it lives.
 *
 * Deliberately free of next/headers and of 'use client', so the same parsing
 * runs in the browser (capture) and in the auth callback (read).
 */

/** Readable by document.cookie on purpose: the OAuth callback reads it server-side. */
export const ATTRIBUTION_COOKIE = 'cs_attribution';

/** 90 days — a conventional acquisition window, and long enough that a slow
 *  browse-then-decide journey still credits the source that started it. */
export const ATTRIBUTION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export interface SignupAttribution {
    /** utm_source, else the referrer host, else 'direct'. */
    src: string;
    /** utm_medium, else a channel guessed from the referrer. */
    med: string;
    /** utm_campaign, when present. */
    cmp?: string;
    /** Referrer HOSTNAME only — never the full URL. See the privacy note below. */
    ref?: string;
    /** Landing path, query string stripped. Same reason. */
    lp: string;
    /** First-touch timestamp, ISO date only (no clock time — this is analytics,
     *  not a session log, and a date is enough to cohort by). */
    ts: string;
}

/**
 * Search engines whose referrals should read as organic search rather than as a
 * generic referral. Matched as a suffix on the hostname, so `www.google.co.th`
 * and `google.com` both land on 'google'.
 */
const SEARCH_HOSTS: ReadonlyArray<[match: string, name: string]> = [
    ['google.', 'google'],
    ['bing.', 'bing'],
    ['duckduckgo.', 'duckduckgo'],
    ['yahoo.', 'yahoo'],
    ['yandex.', 'yandex'],
    ['naver.', 'naver'],
    ['baidu.', 'baidu'],
    ['ecosia.', 'ecosia'],
    ['brave.', 'brave'],
];

/**
 * Assistants and answer engines. Split out from SEARCH_HOSTS because AI-referred
 * traffic is its own acquisition story — GA4 already reports it separately, and
 * lumping it into organic would hide whether the llms.txt / FAQ-schema work pays
 * off.
 */
const AI_HOSTS: ReadonlyArray<[match: string, name: string]> = [
    ['chatgpt.com', 'chatgpt'],
    ['openai.com', 'openai'],
    ['perplexity.ai', 'perplexity'],
    ['claude.ai', 'claude'],
    ['gemini.google.com', 'gemini'],
    ['copilot.microsoft.com', 'copilot'],
];

const SOCIAL_HOSTS: ReadonlyArray<[match: string, name: string]> = [
    ['facebook.', 'facebook'],
    ['instagram.', 'instagram'],
    ['tiktok.', 'tiktok'],
    ['twitter.', 'twitter'],
    ['x.com', 'x'],
    ['line.me', 'line'],
    ['pantip.com', 'pantip'],
    ['youtube.', 'youtube'],
    ['reddit.', 'reddit'],
];

function classify(host: string): { src: string; med: string } | null {
    const h = host.toLowerCase();
    // gemini.google.com must be tested before google., or it reads as search.
    for (const [match, name] of AI_HOSTS) if (h.includes(match)) return { src: name, med: 'ai' };
    for (const [match, name] of SEARCH_HOSTS) if (h.includes(match)) return { src: name, med: 'organic' };
    for (const [match, name] of SOCIAL_HOSTS) if (h.includes(match)) return { src: name, med: 'social' };
    return null;
}

const MAX_FIELD = 120;
const clamp = (v: string) => v.slice(0, MAX_FIELD);

/**
 * Build the first-touch record from a landing URL and a referrer.
 *
 * PRIVACY: the referrer is reduced to its hostname and the landing URL to its
 * path. Full referrer URLs and our own query string can both carry arbitrary
 * user-supplied text (search terms, and in the worst case tokens), and none of
 * that belongs in a column that exists to answer "which channel works".
 */
export function buildAttribution(href: string, referrer: string): SignupAttribution | null {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return null;
    }

    const p = url.searchParams;
    const utmSource = p.get('utm_source') || p.get('ref') || '';
    const utmMedium = p.get('utm_medium') || '';
    const utmCampaign = p.get('utm_campaign') || '';

    let refHost = '';
    if (referrer) {
        try {
            const r = new URL(referrer);
            // Our own pages are not an acquisition source; an internal navigation
            // that beat the capture would otherwise record src=cardstreet.app.
            if (r.hostname !== url.hostname) refHost = r.hostname;
        } catch {
            /* malformed referrer — treat as absent */
        }
    }

    const classified = refHost ? classify(refHost) : null;

    // Explicit utm tags always win: they are a deliberate statement about the
    // campaign, where the referrer is only ever an inference.
    const src = utmSource || classified?.src || (refHost ? refHost : 'direct');
    const med = utmMedium || classified?.med || (refHost ? 'referral' : 'direct');

    const record: SignupAttribution = {
        src: clamp(src),
        med: clamp(med),
        lp: clamp(url.pathname),
        ts: new Date().toISOString().slice(0, 10),
    };
    if (utmCampaign) record.cmp = clamp(utmCampaign);
    if (refHost) record.ref = clamp(refHost);
    return record;
}

/** Parse the cookie value. Returns null on anything malformed — attribution is
 *  best-effort and must never throw into a signup path. */
export function parseAttribution(raw: string | undefined | null): SignupAttribution | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(decodeURIComponent(raw));
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.src !== 'string' || typeof parsed.med !== 'string') return null;
        return parsed as SignupAttribution;
    } catch {
        return null;
    }
}

export function serializeAttribution(a: SignupAttribution): string {
    return encodeURIComponent(JSON.stringify(a));
}
