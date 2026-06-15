import type { Metadata } from 'next';

// Locale-in-URL scheme (lightweight, middleware-driven):
//   - Thai is the canonical default and lives at the BARE path  (/, /faq, ...)
//   - English lives under the /en prefix                        (/en, /en/faq)
//   - /th/* is an alias that redirects to the bare path (see middleware.ts)
//
// These are the two locales worth indexing today; new markets/languages extend
// the map here and in lib/markets.ts.

export const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://cardstreet.app';

export type UiLocale = 'th' | 'en';

/** Absolute URL for a path in a given UI locale. */
export function localizedUrl(path: string, locale: UiLocale): string {
  const clean = path === '/' ? '' : path;
  return locale === 'en' ? `${BASE_URL}/en${clean}` : `${BASE_URL}${clean || '/'}`;
}

/**
 * Canonical + hreflang alternates for a page, for use in a route's exported
 * `metadata`. Thai (bare URL) is both the `th-TH` target and `x-default`.
 */
export function buildAlternates(path: string): NonNullable<Metadata['alternates']> {
  return {
    canonical: localizedUrl(path, 'th'),
    languages: {
      'th-TH': localizedUrl(path, 'th'),
      'en-TH': localizedUrl(path, 'en'),
      'x-default': localizedUrl(path, 'th'),
    },
  };
}

/** Sitemap-shaped alternate languages map for a path. */
export function sitemapAlternates(path: string): Record<string, string> {
  return {
    th: localizedUrl(path, 'th'),
    en: localizedUrl(path, 'en'),
  };
}
