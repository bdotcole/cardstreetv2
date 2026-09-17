import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://cardstreet.app';

// Crawlers that send no buyers and were the bulk of our traffic. On
// 2026-09-17 bots were >60% of all edge requests, almost all on /card pages,
// which render dynamically (a function invocation, ~3 Supabase calls and a
// Sentry call each) — every hit is billed as several Vercel Observability
// events. Meta's AI-training crawler alone was 39% of ALL requests; Googlebot
// was under 2%. These agents honour robots.txt. Search engines that matter
// here (Googlebot, Bingbot, Applebot) and the AI answer engines the GEO
// strategy targets (PerplexityBot, OAI-SearchBot) stay allowed via '*'.
// meta-externalfetcher (Facebook/Instagram link previews) is deliberately NOT
// listed — shared links still need their preview card.
const BLOCKED_BOTS = [
  'meta-externalagent', // Meta AI training crawler
  'AhrefsBot',
  'SemrushBot',
  'MJ12bot',
  'DotBot',
  'DataForSeoBot',
  'PetalBot', // Huawei
  'Amazonbot',
  'Baiduspider',
  'Bytespider', // ByteDance
  'Yandex', // no Thai audience; IndexNow still pings it, harmless
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Internal/authenticated surfaces — no SEO value, keep crawlers out.
        disallow: ['/admin', '/api', '/desktop'],
      },
      {
        userAgent: BLOCKED_BOTS,
        disallow: '/',
      },
    ],
    sitemap: [`${BASE_URL}/sitemap.xml`, `${BASE_URL}/sets-sitemap`, `${BASE_URL}/cards-sitemap`, `${BASE_URL}/sellers-sitemap`],
  };
}
