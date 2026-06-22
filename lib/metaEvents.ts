'use client';

// Meta (Facebook) app-event tracking, unified across web and the native iOS app.
//
// CardStreet's UI is a remote WebView, so conversion events (ViewContent,
// AddToCart, InitiateCheckout, Purchase, Search) all originate in this web
// layer. `trackMetaEvent` fans each event out to:
//
//   1. the Meta Pixel (`fbq`) — covers desktop/mobile web AND the in-app
//      WebView, env-gated by NEXT_PUBLIC_META_PIXEL_ID (see app/layout.tsx).
//   2. the native Facebook iOS SDK, via the FacebookAppEvents Capacitor plugin,
//      but only when running inside the native app — so the same action also
//      registers as a true iOS app event for App Promotion attribution and
//      shows up in Meta's App Event Tester.
//
// Every dispatch is best-effort and swallows its own errors: analytics must
// never break a checkout or a card view.

import { Capacitor, registerPlugin } from '@capacitor/core';

interface FacebookAppEventsPlugin {
  logEvent(options: {
    eventName: string;
    valueToSum?: number;
    currency?: string;
    params?: Record<string, string | number>;
  }): Promise<void>;
}

// On web this returns a proxy that rejects with "not implemented"; we only ever
// call it behind a Capacitor.isNativePlatform() guard, and catch regardless.
const FacebookAppEvents = registerPlugin<FacebookAppEventsPlugin>('FacebookAppEvents');

type FbqFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    fbq?: FbqFn;
  }
}

// Subset of Meta's standard event parameters we populate.
export interface MetaEventParams {
  value?: number;
  currency?: string; // app label or ISO 4217; normalized below
  content_ids?: string[];
  content_type?: string; // typically 'product'
  num_items?: number;
  search_string?: string;
}

function normalizeCurrency(currency?: string): string | undefined {
  if (!currency) return undefined;
  const upper = currency.toUpperCase();
  // Our app uses ISO-ish labels already ('THB', 'USD'); keep as-is.
  return upper;
}

/**
 * Fire a Meta standard event to the web Pixel and, inside the native app, to
 * the Facebook iOS SDK. `name` is the Pixel event name (e.g. 'Purchase'); the
 * native plugin maps it to the SDK's standard app-event name.
 */
export function trackMetaEvent(name: string, params: MetaEventParams = {}): void {
  if (typeof window === 'undefined') return;

  const currency = normalizeCurrency(params.currency);
  const pixelPayload: Record<string, unknown> = { ...params };
  if (currency) pixelPayload.currency = currency;

  // 1. Web Pixel (also fires inside the WebView).
  try {
    window.fbq?.('track', name, pixelPayload);
  } catch {
    // Pixel not loaded (env var unset) — ignore.
  }

  // 2. Native iOS app event via the Capacitor bridge.
  try {
    if (Capacitor.isNativePlatform()) {
      const nativeParams: Record<string, string | number> = {};
      if (currency) nativeParams.fb_currency = currency;
      if (params.content_type) nativeParams.fb_content_type = params.content_type;
      if (params.content_ids?.length) nativeParams.fb_content_id = JSON.stringify(params.content_ids);
      if (typeof params.num_items === 'number') nativeParams.fb_num_items = params.num_items;
      if (params.search_string) nativeParams.fb_search_string = params.search_string;

      void FacebookAppEvents.logEvent({
        eventName: name,
        valueToSum: typeof params.value === 'number' ? params.value : undefined,
        currency,
        params: nativeParams,
      }).catch(() => {
        // Plugin unavailable on this build — ignore (Pixel still captured it).
      });
    }
  } catch {
    // Not native / bridge missing — ignore.
  }
}
