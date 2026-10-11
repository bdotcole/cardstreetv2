import type { MetadataRoute } from 'next';
import { BASE_URL, sitemapAlternates } from '@/lib/i18nRouting';
import { GUIDES } from '@/lib/guides';

// Public, indexable routes. The marketplace homepage plus the evergreen content
// pages — the surfaces search engines and AI answer engines should crawl. Each
// entry advertises its Thai (bare) and English (/en) variants via hreflang.
//
// `lastModified` IS A REAL PER-ROUTE DATE, hand-maintained. It used to be a
// single `new Date()` applied to all 17 routes, which told crawlers that every
// page changed on every fetch — not a weak signal but a false one, and Google
// discards a site's lastmod values wholesale once it decides they are
// unreliable. These are hand-written content pages, so the honest date is when
// the copy last changed; each value below came from `git log -1 --format=%cs`
// over that route's sources on 2026-08-14.
//
// WHEN YOU CHANGE A PAGE'S COPY, BUMP ITS DATE HERE. A slightly stale date is a
// far smaller sin than a fabricated one, but it is still worth keeping current.
const ROUTES: {
  path: string;
  lastModified: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
}[] = [
  { path: '/', lastModified: '2026-08-12', changeFrequency: 'daily', priority: 1 },
  // Per-game landing pages — the head-term targets (การ์ดโปเกมอน, การ์ดวันพีช, ...).
  // All six share lib/gameLanding.ts, so they share its date (c2cb6ac).
  { path: '/pokemon', lastModified: '2026-08-13', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/one-piece', lastModified: '2026-08-13', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/yugioh', lastModified: '2026-08-13', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/mtg', lastModified: '2026-08-13', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/lorcana', lastModified: '2026-08-13', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/riftbound', lastModified: '2026-08-13', changeFrequency: 'weekly', priority: 0.9 },
  // Set index — the crawl entry point to all ~1k set pages.
  { path: '/sets', lastModified: '2026-08-07', changeFrequency: 'weekly', priority: 0.8 },
  // Seller shop directory — the crawl path to every shop with live inventory.
  { path: '/shops', lastModified: '2026-09-01', changeFrequency: 'daily', priority: 0.8 },
  // Price-check landing — targets เช็คราคาการ์ดโปเกม่อน, the best-ranking query.
  { path: '/prices', lastModified: '2026-08-14', changeFrequency: 'weekly', priority: 0.8 },
  // Graded-cards landing — targets การ์ดเกรด / ราคาการ์ดเกรด / PSA 10 ราคา.
  { path: '/graded', lastModified: '2026-08-14', changeFrequency: 'weekly', priority: 0.7 },
  // Seller landing — targets ขายการ์ดโปเกมอน / รับซื้อการ์ด. Distinct from /sell,
  // which is the auth-gated listing form and deliberately stays noindex.
  { path: '/sell-cards', lastModified: '2026-08-14', changeFrequency: 'monthly', priority: 0.7 },
  // Breaker application landing — the intake funnel for Cardstreet Live hosts.
  { path: '/become-a-breaker', lastModified: '2026-08-10', changeFrequency: 'monthly', priority: 0.7 },
  // Guides index — the crawl entry point to the long-form articles.
  { path: '/guides', lastModified: '2026-08-30', changeFrequency: 'weekly', priority: 0.8 },
  // One entry per guide. lastModified comes from each guide's own `updated`,
  // so editing one article does not falsely re-date the rest.
  ...GUIDES.map((g) => ({
    path: `/guides/${g.slug}`,
    lastModified: g.updated,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  })),
  { path: '/faq', lastModified: '2026-08-12', changeFrequency: 'monthly', priority: 0.8 },
  // /help is deliberately absent: it duplicates the /faq accordion and
  // canonicalizes there (app/help/page.tsx) — sitemaps list canonicals only.
  { path: '/contact', lastModified: '2026-08-12', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/terms', lastModified: '2026-08-12', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', lastModified: '2026-08-12', changeFrequency: 'yearly', priority: 0.3 },
  // Breaker program supplement to /terms — linked from the application's consent box.
  { path: '/breaker-terms', lastModified: '2026-08-10', changeFrequency: 'yearly', priority: 0.3 },
];

// ONE <url> PER LOCALE VARIANT, not one Thai entry carrying hreflang hints.
// Google's documented pattern is a <loc> for every variant, each repeating the
// full alternate set. Until 2026-09-01 this emitted only the bare Thai URL, so
// the whole /en tree had no sitemap presence at all and — with the language
// control still a <button> — no internal links either. hreflang is a hint about
// a page a crawler already found; it is not a way to find one.
const variantUrl = (path: string, locale: 'th' | 'en'): string => {
  const clean = path === '/' ? '' : path;
  // The Thai form is kept byte-identical to what has been in the sitemap since
  // 2026-08-14 (homepage = bare origin, no trailing slash). Rewriting an already
  // indexed <loc> for cosmetic consistency is churn with no upside.
  return locale === 'en' ? `${BASE_URL}/en${clean}` : `${BASE_URL}${clean}` || `${BASE_URL}/`;
};

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.flatMap(({ path, lastModified, changeFrequency, priority }) =>
    (['th', 'en'] as const).map((locale) => ({
      url: variantUrl(path, locale),
      lastModified: new Date(lastModified),
      changeFrequency,
      priority,
      alternates: { languages: sitemapAlternates(path) },
    })),
  );
}
