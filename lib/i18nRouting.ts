import type { Metadata } from 'next';
import { headers } from 'next/headers';

// Locale-in-URL scheme (lightweight, middleware-driven):
//   - Thai is the canonical default and lives at the BARE path  (/, /faq, ...)
//   - English lives under the /en prefix                        (/en, /en/faq)
//   - /th/* is an alias that redirects to the bare path (see middleware.ts)
//
// These are the two locales worth indexing today; new markets/languages extend
// the map here and in lib/markets.ts.

export const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://cardstreet.app';

/**
 * Branded 1200x630 share image (app/opengraph-image.tsx). Next's file-convention
 * image only reaches routes WITHOUT their own openGraph metadata object, so every
 * page that sets openGraph explicitly must reference this or it shares as a blank
 * card on Facebook/Line — which is exactly what /pokemon, /faq and eleven other
 * content pages did until 2026-08-30. Pages with a better subject-specific image
 * (card art, set logos) keep their own.
 */
export const DEFAULT_OG_IMAGE = [{ url: `${BASE_URL}/opengraph-image`, width: 1200, height: 630 }];

export type UiLocale = 'th' | 'en';

/** Absolute URL for a path in a given UI locale. */
export function localizedUrl(path: string, locale: UiLocale): string {
  const clean = path === '/' ? '' : path;
  return locale === 'en' ? `${BASE_URL}/en${clean}` : `${BASE_URL}${clean || '/'}`;
}

/**
 * Path prefix for internal links in a given UI locale: '' for Thai (the bare
 * canonical path), '/en' for English.
 *
 * Every internal link inside the /en tree used to be written bare, so the
 * English pages linked straight back into Thai and the /en tree had no crawl
 * path of its own beyond depth 1. Server components resolve the locale with
 * requestPathLocale() and pass the result of this down to client grids as a
 * plain string — client components must NOT import from this module, which
 * pulls in next/headers.
 */
export function localePrefix(locale: UiLocale): '' | '/en' {
  return locale === 'en' ? '/en' : '';
}

/**
 * Canonical + hreflang alternates for a page, for use in a route's exported
 * `metadata`. Thai (bare URL) is the `x-default`, and the canonical is the
 * URL of the locale variant being served — every hreflang alternate must be
 * self-canonical, or search engines drop the non-canonical variant entirely
 * (which is what kept the /en pages out of the index).
 */
export function buildAlternates(path: string, pathLocale: UiLocale = 'th'): NonNullable<Metadata['alternates']> {
  return {
    canonical: localizedUrl(path, pathLocale),
    languages: {
      'th-TH': localizedUrl(path, 'th'),
      'en-TH': localizedUrl(path, 'en'),
      'x-default': localizedUrl(path, 'th'),
    },
  };
}

/**
 * The locale of the URL variant actually being served (bare Thai path vs /en
 * prefix), read from the `x-cs-path-locale` header middleware derives from the
 * URL alone. The `cs_lang` cookie (and so `x-cs-lang`) must never steer
 * canonicals or og:url — a bare-path render stays the Thai canonical even when
 * a returning EN-cookie user sees it in English.
 */
export async function requestPathLocale(): Promise<UiLocale> {
  return (await headers()).get('x-cs-path-locale') === 'en' ? 'en' : 'th';
}

/** Request-aware alternates: canonical follows the URL variant being served. */
export async function buildAlternatesForRequest(path: string): Promise<NonNullable<Metadata['alternates']>> {
  return buildAlternates(path, await requestPathLocale());
}

/**
 * Sitemap-shaped alternate languages map for a path. Must use the same
 * hreflang vocabulary as the page <head> clusters and the XML catalog
 * sitemaps (th-TH / en-TH / x-default) — Google requires hreflang annotations
 * declared via multiple methods to agree.
 */
export function sitemapAlternates(path: string): Record<string, string> {
  return {
    'th-TH': localizedUrl(path, 'th'),
    'en-TH': localizedUrl(path, 'en'),
    'x-default': localizedUrl(path, 'th'),
  };
}

/**
 * The `<url>` entries for one path in an XML sitemap: ONE PER LOCALE VARIANT,
 * each repeating the full hreflang cluster.
 *
 * The catalog sitemaps used to emit only the bare Thai `<loc>` with the English
 * URL present solely as an hreflang annotation. hreflang tells a crawler that a
 * page it already found has a translation; it is not a discovery path. Combined
 * with a language control that was a `<button>`, that left the entire /en tree
 * with zero inbound links and zero sitemap presence.
 *
 * Shared so the sets and sellers sitemaps cannot drift apart, and so the next
 * XML sitemap gets the right shape by default.
 */
export function sitemapUrlEntries(path: string): string {
  const th = localizedUrl(path, 'th');
  const en = localizedUrl(path, 'en');
  const links =
    `<xhtml:link rel="alternate" hreflang="th-TH" href="${th}"/>` +
    `<xhtml:link rel="alternate" hreflang="en-TH" href="${en}"/>` +
    `<xhtml:link rel="alternate" hreflang="x-default" href="${th}"/>`;
  return `<url><loc>${th}</loc>${links}</url><url><loc>${en}</loc>${links}</url>`;
}
