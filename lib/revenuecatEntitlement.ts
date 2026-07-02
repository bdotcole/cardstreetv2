import { createAdminClient } from '@/lib/supabase/admin';

/**
 * RevenueCat webhook -> entitlement writer. The mobile-IAP twin of
 * lib/premiumEntitlement.ts (Stripe): writes the same two places under the
 * same rules -- never-shrink profiles.premium_until, +3 days grace on active
 * states, select-then-write ledger row (the unique index on
 * (provider, provider_subscription_id) is partial, so PostgREST upsert can't
 * infer it).
 *
 * The RevenueCat App User ID is the Supabase auth user id (set at
 * Purchases.configure in lib/revenuecat.ts), which is how events map back to
 * a profile -- the equivalent of Stripe's metadata.user_id. Anonymous
 * ($RCAnonymousID:...) ids can appear in aliases when a purchase happened
 * before login; the resolver picks the first UUID-shaped candidate.
 */

const GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const ENTITLEMENT_ID = 'pro';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RevenueCatEvent {
  type: string;
  id?: string;
  store?: string;
  environment?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  entitlement_ids?: string[] | null;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  original_transaction_id?: string;
}

// Event type -> subscriptions.status enum. Types not listed (TEST,
// NON_RENEWING_PURCHASE, invoice events, ...) grant nothing and are skipped.
const STATUS_MAP: Record<string, string> = {
  INITIAL_PURCHASE: 'active',
  RENEWAL: 'active',
  UNCANCELLATION: 'active',
  PRODUCT_CHANGE: 'active',
  SUBSCRIPTION_EXTENDED: 'active',
  TRANSFER: 'active',
  BILLING_ISSUE: 'past_due',
  CANCELLATION: 'canceled', // auto-renew off; stays paid through expiration
  SUBSCRIPTION_PAUSED: 'paused',
  EXPIRATION: 'expired',
};

const PLATFORM_MAP: Record<string, string> = {
  APP_STORE: 'ios',
  MAC_APP_STORE: 'ios',
  PLAY_STORE: 'android',
  AMAZON: 'android',
  STRIPE: 'web',
};

export async function syncPremiumFromRevenueCatEvent(event: RevenueCatEvent): Promise<void> {
  const logPrefix = '[RevenueCatEntitlement]';

  const status = STATUS_MAP[event.type];
  if (!status) {
    console.log(`${logPrefix} ${event.type} carries no entitlement change; ignored`);
    return;
  }

  // Only the pro entitlement drives premium_until. entitlement_ids can be
  // absent on some event shapes (e.g. TRANSFER); those still process, since
  // the project sells nothing but pro subscriptions.
  if (Array.isArray(event.entitlement_ids) && event.entitlement_ids.length > 0
      && !event.entitlement_ids.includes(ENTITLEMENT_ID)) {
    console.log(`${logPrefix} ${event.type} for entitlements [${event.entitlement_ids}] — not '${ENTITLEMENT_ID}', ignored`);
    return;
  }

  const candidates = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])];
  const userId = candidates.find((c) => c && UUID_RE.test(c));
  if (!userId) {
    console.warn(`${logPrefix} ${event.type} has no UUID app user id (candidates: ${candidates.filter(Boolean).join(', ')}); skipping`);
    return;
  }

  const expirationMs = event.expiration_at_ms ?? null;
  const periodEnd = expirationMs ? new Date(expirationMs).toISOString() : null;

  // Entitled through the paid period, grace-extended while the store retries
  // billing; a cancellation keeps exactly what was paid for; an expiration
  // grants nothing new (never-shrink protects longer grants below).
  let entitledUntil: string | null = null;
  if (expirationMs && ['active', 'past_due'].includes(status)) {
    entitledUntil = new Date(expirationMs + GRACE_MS).toISOString();
  } else if (expirationMs && status === 'canceled') {
    entitledUntil = new Date(expirationMs).toISOString();
  }

  const admin = createAdminClient();

  const ledger = {
    user_id: userId,
    provider: 'revenuecat',
    platform: PLATFORM_MAP[event.store ?? ''] ?? null,
    provider_subscription_id: event.original_transaction_id || `${userId}:${event.product_id ?? 'unknown'}`,
    product_id: event.product_id ?? null,
    status,
    current_period_end: periodEnd,
  };
  const { data: existing, error: selErr } = await admin
    .from('subscriptions')
    .select('id')
    .eq('provider', 'revenuecat')
    .eq('provider_subscription_id', ledger.provider_subscription_id)
    .maybeSingle();
  if (selErr) {
    console.error(`${logPrefix} ledger select failed:`, selErr.message);
  } else if (existing) {
    const { error } = await admin.from('subscriptions').update(ledger).eq('id', existing.id);
    if (error) console.error(`${logPrefix} ledger update failed:`, error.message);
  } else {
    const { error } = await admin.from('subscriptions').insert(ledger);
    if (error) console.error(`${logPrefix} ledger insert failed:`, error.message);
  }

  if (entitledUntil) {
    // Never shrink: an admin comp, the Stripe rail, or a longer store grant
    // may already reach further out than this event does.
    const { data: profile } = await admin
      .from('profiles')
      .select('premium_until')
      .eq('id', userId)
      .single();
    const current = profile?.premium_until ? Date.parse(profile.premium_until) : 0;
    if (Date.parse(entitledUntil) > current) {
      const { error } = await admin
        .from('profiles')
        .update({ premium_until: entitledUntil })
        .eq('id', userId);
      if (error) console.error(`${logPrefix} premium_until write failed:`, error.message);
      else console.log(`${logPrefix} ${userId} entitled until ${entitledUntil} (${event.type}, ${event.store}, ${event.environment})`);
    }
  } else {
    console.log(`${logPrefix} ${event.type} (${event.store}) grants no entitlement; ledger updated`);
  }
}
