import type { MetadataRoute } from 'next';
import { BASE_URL, sitemapAlternates } from '@/lib/i18nRouting';

// Public, indexable routes. The marketplace homepage plus the evergreen content
// pages — the surfaces search engines and AI answer engines should crawl. Each
// entry advertises its Thai (bare) and English (/en) variants via hreflang.
const ROUTES: { path: string; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number }[] = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  // Per-game landing pages — the head-term targets (การ์ดโปเกมอน, การ์ดวันพีช, ...).
  { path: '/pokemon', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/one-piece', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/yugioh', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/mtg', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/lorcana', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/riftbound', changeFrequency: 'weekly', priority: 0.9 },
  // Set index — the crawl entry point to all ~1k set pages.
  { path: '/sets', changeFrequency: 'weekly', priority: 0.8 },
  // Price-check landing — targets เช็คราคาการ์ดโปเกม่อน, the best-ranking query.
  { path: '/prices', changeFrequency: 'weekly', priority: 0.8 },
  // Graded-cards landing — targets การ์ดเกรด / ราคาการ์ดเกรด / PSA 10 ราคา.
  { path: '/graded', changeFrequency: 'weekly', priority: 0.7 },
  // Seller landing — targets ขายการ์ดโปเกมอน / รับซื้อการ์ด. Distinct from /sell,
  // which is the auth-gated listing form and deliberately stays noindex.
  { path: '/sell-cards', changeFrequency: 'monthly', priority: 0.7 },
  // Breaker application landing — the intake funnel for Cardstreet Live hosts.
  { path: '/become-a-breaker', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/faq', changeFrequency: 'monthly', priority: 0.8 },
  // /help is deliberately absent: it duplicates the /faq accordion and
  // canonicalizes there (app/help/page.tsx) — sitemaps list canonicals only.
  { path: '/contact', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  // Breaker program supplement to /terms — linked from the application's consent box.
  { path: '/breaker-terms', changeFrequency: 'yearly', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: `${BASE_URL}${path === '/' ? '' : path}` || `${BASE_URL}/`,
    lastModified,
    changeFrequency,
    priority,
    alternates: { languages: sitemapAlternates(path) },
  }));
}
