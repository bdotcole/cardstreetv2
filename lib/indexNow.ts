/**
 * IndexNow — tell search engines a URL changed instead of waiting to be crawled.
 *
 * Bing (which also feeds ChatGPT's web answers), Yandex, Naver and Seznam share
 * one IndexNow endpoint: submitting once reaches all of them. Google does not
 * participate, so this complements rather than replaces sitemaps.
 *
 * Why card pages: a listing has no public URL of its own — it is an offer that
 * renders on /card/<card_id> (see app/cards-sitemap). Tens of thousands of card
 * pages sit "discovered, not indexed", so the ones that just gained real
 * inventory are exactly the ones worth pushing to the front of the queue.
 *
 * Ownership is proved by hosting the key as plain text at KEY_LOCATION. The key
 * is public by design — it is not a secret, and it must stay in lockstep with
 * public/<key>.txt or every submission is rejected.
 *
 * Every function here fails soft: indexing is best-effort and must never break
 * a listing write.
 */

import { BASE_URL, localizedUrl } from '@/lib/i18nRouting';

const INDEXNOW_KEY = 'b290165708233e037d7c8ab841f592ea';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

// IndexNow accepts up to 10k URLs per request; we send far fewer, but a runaway
// batch should be truncated rather than rejected wholesale.
const MAX_URLS_PER_REQUEST = 10_000;

export const INDEXNOW_KEY_FILENAME = `${INDEXNOW_KEY}.txt`;

/**
 * Submissions only make sense for the live site. Preview deploys and local dev
 * would either advertise unreachable URLs or double-submit production ones.
 */
function shouldSubmit(): boolean {
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return false;
    return !/localhost|127\.0\.0\.1/.test(BASE_URL);
}

/**
 * Submit absolute URLs to IndexNow. Never throws.
 */
export async function submitUrlsToIndexNow(urls: string[]): Promise<void> {
    if (!shouldSubmit() || urls.length === 0) return;

    const host = new URL(BASE_URL).host;
    const urlList = Array.from(new Set(urls)).slice(0, MAX_URLS_PER_REQUEST);

    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                host,
                key: INDEXNOW_KEY,
                keyLocation: `${BASE_URL}/${INDEXNOW_KEY_FILENAME}`,
                urlList,
            }),
        });
        // 200 accepted, 202 accepted-pending-key-validation. Anything else is
        // worth a log line but not an exception.
        if (res.status !== 200 && res.status !== 202) {
            console.error(`[IndexNow] submission rejected (${res.status}) for ${urlList.length} url(s)`);
        }
    } catch (e) {
        console.error('[IndexNow] submission failed:', e);
    }
}

/**
 * Push the card pages behind the given listings. Both locale variants are
 * submitted because each is its own self-canonical indexable URL.
 */
export async function submitCardIdsToIndexNow(cardIds: (string | null | undefined)[]): Promise<void> {
    const ids = Array.from(new Set(cardIds.filter((id): id is string => typeof id === 'string' && id.length > 0)));
    if (ids.length === 0) return;

    const urls = ids.flatMap((id) => [
        localizedUrl(`/card/${id}`, 'th'),
        localizedUrl(`/card/${id}`, 'en'),
    ]);
    await submitUrlsToIndexNow(urls);
}
