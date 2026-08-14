import type { MetadataRoute } from 'next';
import { BASE_URL, sitemapAlternates } from '@/lib/i18nRouting';

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
  // Price-check landing — targets เช็คราคาการ์ดโปเกม่อน, the best-ranking query.
  { path: '/prices', lastModified: '2026-08-14', changeFrequency: 'weekly', priority: 0.8 },
  // Graded-cards landing — targets การ์ดเกรด / ราคาการ์ดเกรด / PSA 10 ราคา.
  { path: '/graded', lastModified: '2026-08-14', changeFrequency: 'weekly', priority: 0.7 },
  // Seller landing — targets ขายการ์ดโปเกมอน / รับซื้อการ์ด. Distinct from /sell,
  // which is the auth-gated listing form and deliberately stays noindex.
  { path: '/sell-cards', lastModified: '2026-08-14', changeFrequency: 'monthly', priority: 0.7 },
  // Breaker application landing — the intake funnel for Cardstreet Live hosts.
  { path: '/become-a-breaker', lastModified: '2026-08-10', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/faq', lastModified: '2026-08-12', changeFrequency: 'monthly', priority: 0.8 },
  // /help is deliberately absent: it duplicates the /faq accordion and
  // canonicalizes there (app/help/page.tsx) — sitemaps list canonicals only.
  { path: '/contact', lastModified: '2026-08-12', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/terms', lastModified: '2026-08-12', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', lastModified: '2026-08-12', changeFrequency: 'yearly', priority: 0.3 },
  // Breaker program supplement to /terms — linked from the application's consent box.
  { path: '/breaker-terms', lastModified: '2026-08-10', changeFrequency: 'yearly', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map(({ path, lastModified, changeFrequency, priority }) => ({
    url: `${BASE_URL}${path === '/' ? '' : path}` || `${BASE_URL}/`,
    lastModified: new Date(lastModified),
    changeFrequency,
    priority,
    alternates: { languages: sitemapAlternates(path) },
  }));
}
