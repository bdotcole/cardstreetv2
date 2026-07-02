'use client';

/**
 * RevenueCat native purchases -- the mobile IAP rail (web keeps Stripe).
 *
 * Only called inside the Capacitor shells: /premium gates on native detection
 * before touching this module, and the plugin import stays dynamic so the web
 * bundle doesn't carry it. On builds that predate the native plugin the calls
 * reject and every helper degrades to "no offer" -- the page then shows the
 * coming-soon card, so shipping this JS ahead of the binaries is safe.
 *
 * The SDK keys are RevenueCat's PUBLIC per-platform keys (client-safe, like
 * Stripe publishable keys). App User ID = the Supabase auth user id, set at
 * configure() -- the webhook (app/api/webhooks/revenuecat) maps events back
 * to profiles.premium_until through it, exactly like Stripe's
 * metadata.user_id.
 */

import { createClient } from '@/lib/supabase/client';

const RC_API_KEYS: Record<string, string> = {
  ios: 'appl_mawXgldEYdmCPMBQMvDJFLUpwRm',
  android: 'goog_CvfCeqaxuQRYCoXOmWdfjTHaJBt',
};

const ENTITLEMENT_ID = 'pro';

let configuredFor: string | null = null;
let cachedPackage: any | null = null;

async function purchasesPlugin() {
  const mod = await import('@revenuecat/purchases-capacitor');
  return mod.Purchases;
}

function nativePlatform(): 'ios' | 'android' | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as any).Capacitor;
  const p = cap?.getPlatform?.();
  return p === 'ios' || p === 'android' ? p : null;
}

async function ensureConfigured(): Promise<boolean> {
  const platform = nativePlatform();
  if (!platform) return false;
  const apiKey = RC_API_KEYS[platform];
  const { data: { user } } = await createClient().auth.getUser();
  if (!user) return false;
  const Purchases = await purchasesPlugin();
  if (configuredFor !== platform) {
    await Purchases.configure({ apiKey, appUserID: user.id });
    configuredFor = platform;
  }
  return true;
}

export interface NativeProOffer {
  /** Store-localized price, e.g. "฿149.00" -- always display this, never a hardcoded number. */
  priceString: string;
}

/**
 * Load the monthly Pro package from the current offering. Null when IAP isn't
 * available (web, logged out, old binary without the plugin, store product
 * not yet approved) -- callers fall back to the coming-soon card.
 */
export async function loadNativeProOffer(): Promise<NativeProOffer | null> {
  try {
    if (!(await ensureConfigured())) return null;
    const Purchases = await purchasesPlugin();
    const { current } = await Purchases.getOfferings();
    const pkg = current?.availablePackages?.find((p: any) => p.packageType === 'MONTHLY')
      ?? current?.availablePackages?.[0];
    if (!pkg?.product?.priceString) return null;
    cachedPackage = pkg;
    return { priceString: pkg.product.priceString };
  } catch (e) {
    console.warn('[RevenueCat] offerings unavailable:', e);
    return null;
  }
}

/** Run the store purchase sheet. 'cancelled' is the user backing out, not an error. */
export async function purchaseNativePro(): Promise<'purchased' | 'cancelled'> {
  if (!cachedPackage) throw new Error('No package loaded');
  const Purchases = await purchasesPlugin();
  try {
    await Purchases.purchasePackage({ aPackage: cachedPackage });
    return 'purchased';
  } catch (e: any) {
    if (e?.code === '1' || /cancel/i.test(e?.message ?? '')) return 'cancelled';
    throw new Error(e?.message || 'Purchase failed');
  }
}

/** Apple-required restore path; true when the pro entitlement came back. */
export async function restoreNativePro(): Promise<boolean> {
  if (!(await ensureConfigured())) return false;
  const Purchases = await purchasesPlugin();
  const { customerInfo } = await Purchases.restorePurchases();
  return !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
}

/** The store's own subscription-management page (never a web billing portal in-app). */
export function storeSubscriptionsUrl(): string {
  return nativePlatform() === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions?sku=cardstreet_pro&package=com.cardstreet.tcg';
}
