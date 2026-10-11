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

export type AttributionWriter =
    | 'trigger'
    | 'callback'
    | 'native'
    /**
     * The OAuth callback ran for a brand-new account but found no cs_attribution
     * cookie. Measured 2026-09-05: 27 of 111 accounts created since the feature
     * shipped had a null column, and 26 of those predate the 2026-08-25 native
     * writer fix — but ~2% keep leaking, all OAuth, and every one of them was
     * INDISTINGUISHABLE from a pre-feature row because a missing cookie wrote
     * nothing at all. Writing this instead of null separates "we asked and
     * couldn't tell" from "we never asked", which is the difference between a
     * measurable gap and an invisible one.
     */
    | 'callback_nocookie'
    /** Filled in by the user via the one-tap "how did you hear about us" card. */
    | 'survey';

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
    /**
     * Which code path wrote the row: the DB trigger (email signup, via user
     * metadata), the web OAuth callback, or the native deep-link handler.
     *
     * Exists because three writers feed one column, and without this there is
     * no way to tell from the data which of them is working. That ambiguity
     * cost a full diagnostic cycle on 2026-08-25: a row appeared, and it was
     * impossible to say whether the native fix had produced it.
     */
    w?: AttributionWriter;
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

/**
 * Match a host (or a utm_source that looks like one) against a pattern.
 *
 * Patterns ending in a dot are TLD-agnostic prefixes: 'google.' matches
 * www.google.co.th and google.com alike. Everything else is a full domain and
 * must match exactly or as a subdomain — a bare substring test would make
 * 'x.com' match linux.com, which it did before this was tightened.
 */
function hostMatches(host: string, pattern: string): boolean {
    if (pattern.endsWith('.')) return host.includes(pattern);
    return host === pattern || host.endsWith('.' + pattern);
}

function classify(hint: string): { src: string; med: string } | null {
    const h = hint.toLowerCase();
    // gemini.google.com must be tested before google., or it reads as search.
    for (const [match, name] of AI_HOSTS) if (hostMatches(h, match)) return { src: name, med: 'ai' };
    for (const [match, name] of SEARCH_HOSTS) if (hostMatches(h, match)) return { src: name, med: 'organic' };
    for (const [match, name] of SOCIAL_HOSTS) if (hostMatches(h, match)) return { src: name, med: 'social' };
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

    // Classify the utm_source as well as the referrer, and prefer the utm tag.
    // ChatGPT and other assistants tag outbound links (?utm_source=chatgpt.com)
    // and send NO referrer, so a referrer-only classifier saw an empty referrer
    // and filed a known AI referral as 'direct' — observed on the very first
    // real row this table collected.
    const hint = utmSource || refHost;
    const classified = hint ? classify(hint) : null;

    // A recognised source is normalized to its short name, so a utm-tagged visit
    // (chatgpt.com) and a referrer-derived one (chatgpt) group together instead
    // of splitting a GROUP BY across two spellings. An explicit utm_medium still
    // wins outright: utm_source=google&utm_medium=cpc is paid, not organic.
    const src = classified?.src || utmSource || refHost || 'direct';
    const med = utmMedium || classified?.med || (hint ? 'referral' : 'direct');

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

/**
 * Read the first-touch record from document.cookie.
 *
 * Lives here rather than in a component because three call sites need it: the
 * email signup in AuthModal, the native OAuth deep-link handler in MobileHome,
 * and (by symmetry) anything added later. Returns null when nothing is
 * recorded, so an untagged signup stores null instead of a misleading shell.
 */
export function readAttributionCookie(): SignupAttribution | null {
    if (typeof document === 'undefined') return null;
    try {
        const raw = document.cookie
            .split('; ')
            .find((c) => c.startsWith(ATTRIBUTION_COOKIE + '='))
            ?.slice(ATTRIBUTION_COOKIE.length + 1);
        return parseAttribution(raw);
    } catch {
        return null;
    }
}

export function serializeAttribution(a: SignupAttribution): string {
    return encodeURIComponent(JSON.stringify(a));
}

/**
 * The record to store when a signup path ran but had no cookie to read.
 *
 * src/med are 'unknown' rather than 'direct': a genuinely direct visit DOES get
 * a cookie (buildAttribution always returns a record for a parseable URL), so
 * filing a cookie-less signup as direct would quietly inflate the one bucket
 * that already dominates the data and make the gap unfindable.
 */
/**
 * The answer set for the "how did you hear about us" card
 * (components/AttributionSurvey.tsx, written by /api/attribution/survey).
 *
 * Values are stored as `src`, so they deliberately reuse the vocabulary this
 * module already emits ('google', 'facebook', 'tiktok', 'chatgpt') — a
 * self-reported Google and a measured Google must group together in a GROUP BY,
 * or the survey answers form their own useless island. `med` is always
 * 'survey', so the two kinds of evidence stay separable.
 *
 * 'friend' and 'shop' have no measured equivalent, which is exactly the point:
 * word of mouth and the physical card shops are the channels a referrer-based
 * classifier is structurally blind to, and there is no other way to see them.
 */
export const SURVEY_SOURCES = [
    'google', 'facebook', 'tiktok', 'youtube', 'instagram',
    'chatgpt', 'friend', 'shop', 'other',
] as const;
export type SurveySource = (typeof SURVEY_SOURCES)[number];

export function unknownAttribution(
    writer: AttributionWriter,
    landingPath = '/',
): SignupAttribution {
    return {
        src: 'unknown',
        med: 'unknown',
        lp: landingPath.slice(0, MAX_FIELD),
        ts: new Date().toISOString().slice(0, 10),
        w: writer,
    };
}

/**
 * Stamp the writing code path onto a record, immediately before it is stored.
 * Null passes through as null so a caller with no cookie stores nothing rather
 * than a shell containing only a writer tag.
 */
export function withWriter(
    attribution: SignupAttribution | null,
    writer: AttributionWriter,
): SignupAttribution | null {
    return attribution ? { ...attribution, w: writer } : null;
}
