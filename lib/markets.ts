// Single source of truth for the markets (regions) CardStreet operates in.
//
// The point of this file is to keep the four expansion axes *separate* instead
// of conflating them the way the early TH-only code did:
//
//   - language   : the UI language a visitor reads (th, en, ...)
//   - market     : the country/region they transact in (TH, SG, ... US)
//   - currency   : how prices display and charge (THB, SGD, USD)
//   - payments   : which Stripe platform + shipping carrier serve the market
//
// A Thai visitor might want an English UI, THB pricing, and the TH marketplace
// — three different values on three different axes. US is not "English again":
// different Stripe platform, currency, carrier, and legal entity.
//
// Mirrors the shape of lib/games.ts so adding/enabling a market is a one-line
// change here rather than edits scattered across the app. Today only TH is
// enabled; the rest are configured-but-dormant so routing, currency, and SEO
// surfaces can be built against the real shape before launch.

export type MarketId = 'TH' | 'SG' | 'MY' | 'PH' | 'US';

// UI languages. Extend as markets bring their own (ms, vi, tl, ...).
export type UiLanguageCode = 'en' | 'th';

// Which Stripe platform serves a market (see lib/stripe.ts). SEA markets beyond
// TH will each need their own platform/PSP — Stripe availability and the
// merchant-of-record model differ per country — so they are null until wired.
export type StripeRegion = 'th' | 'us';

export interface MarketConfig {
  id: MarketId;
  /** Display name. */
  name: string;
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  /** UI languages offered in this market, default first. */
  languages: UiLanguageCode[];
  defaultLanguage: UiLanguageCode;
  /** ISO 4217 currency code prices charge in. */
  currency: string;
  currencySymbol: string;
  /** Stripe platform serving the market, or null if not yet wired. */
  stripeRegion: StripeRegion | null;
  /** Domestic shipping carrier integration, or null if not yet wired. */
  shippingProvider: 'flash_express' | null;
  /**
   * BCP-47 locales (language-REGION) this market exposes for locale-in-URL
   * routing + hreflang, default first. e.g. 'th-TH', 'en-TH'.
   */
  locales: string[];
  /** When false the market is configured but not yet selectable/live. */
  enabled: boolean;
}

export const MARKETS: MarketConfig[] = [
  {
    id: 'TH',
    name: 'Thailand',
    country: 'TH',
    languages: ['th', 'en'],
    defaultLanguage: 'th',
    currency: 'THB',
    currencySymbol: '฿',
    stripeRegion: 'th',
    shippingProvider: 'flash_express',
    locales: ['th-TH', 'en-TH'],
    enabled: true,
  },
  {
    id: 'SG',
    name: 'Singapore',
    country: 'SG',
    languages: ['en'],
    defaultLanguage: 'en',
    currency: 'SGD',
    currencySymbol: 'S$',
    stripeRegion: null,
    shippingProvider: null,
    locales: ['en-SG'],
    enabled: false,
  },
  {
    id: 'MY',
    name: 'Malaysia',
    country: 'MY',
    languages: ['en'],
    defaultLanguage: 'en',
    currency: 'MYR',
    currencySymbol: 'RM',
    stripeRegion: null,
    shippingProvider: null,
    locales: ['en-MY'],
    enabled: false,
  },
  {
    id: 'PH',
    name: 'Philippines',
    country: 'PH',
    languages: ['en'],
    defaultLanguage: 'en',
    currency: 'PHP',
    currencySymbol: '₱',
    stripeRegion: null,
    shippingProvider: null,
    locales: ['en-PH'],
    enabled: false,
  },
  {
    id: 'US',
    name: 'United States',
    country: 'US',
    languages: ['en'],
    defaultLanguage: 'en',
    currency: 'USD',
    currencySymbol: '$',
    // The US Stripe platform exists in code but is dormant (see CLAUDE.md).
    stripeRegion: 'us',
    shippingProvider: null,
    locales: ['en-US'],
    enabled: false,
  },
];

export const DEFAULT_MARKET: MarketId = 'TH';

export function getMarket(id: string | null | undefined): MarketConfig {
  return MARKETS.find((m) => m.id === id) ?? MARKETS[0];
}

/** Markets that are live and selectable today. */
export function enabledMarkets(): MarketConfig[] {
  return MARKETS.filter((m) => m.enabled);
}

/** Every BCP-47 locale across enabled markets — the set worth indexing. */
export function enabledLocales(): string[] {
  return enabledMarkets().flatMap((m) => m.locales);
}
