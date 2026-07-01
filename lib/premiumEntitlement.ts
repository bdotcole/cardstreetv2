import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The ONLY app-code writer of the premium entitlement (besides the manual
 * admin comp route). Called from the Stripe webhook on subscription lifecycle
 * events; RevenueCat's webhook will call an equivalent when mobile IAP lands.
 *
 * Writes two things, service-role (the protect_premium_until trigger blocks
 * everyone else):
 *   - subscriptions ledger row for this Stripe subscription (select-then-write;
 *     the unique index on (provider, provider_subscription_id) is partial, so
 *     PostgREST upsert can't infer it)
 *   - profiles.premium_until = period end (+3 days grace so a card retry
 *     doesn't flicker the entitlement off mid-billing-cycle)
 */

const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

// Stripe status → subscriptions.status enum.
const STATUS_MAP: Record<string, string> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  canceled: 'canceled',
  unpaid: 'expired',
  paused: 'paused',
  incomplete: 'expired',
  incomplete_expired: 'expired',
};

export async function syncPremiumFromSubscription(sub: Stripe.Subscription): Promise<void> {
  const logPrefix = '[PremiumEntitlement]';
  const userId = sub.metadata?.user_id;
  if (!userId) {
    // Not ours (or created outside checkout) — ignore rather than guess.
    console.warn(`${logPrefix} subscription ${sub.id} has no user_id metadata; skipping`);
    return;
  }

  const status = STATUS_MAP[sub.status] ?? 'expired';
  const periodEndUnix = (sub as any).current_period_end as number | undefined;
  const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

  // Entitled while the paid period runs, grace-extended for retry windows.
  // A canceled sub stays entitled through what was paid for; incomplete /
  // unpaid grant nothing new (but we never shrink an already-later date —
  // e.g. an admin comp — below).
  let entitledUntil: string | null = null;
  if (periodEndUnix && ['active', 'trialing', 'past_due'].includes(sub.status)) {
    entitledUntil = new Date(periodEndUnix * 1000 + GRACE_MS).toISOString();
  } else if (periodEndUnix && sub.status === 'canceled') {
    entitledUntil = new Date(periodEndUnix * 1000).toISOString();
  }

  const admin = createAdminClient();

  // Ledger row: select-then-insert/update on (provider, provider_subscription_id).
  const ledger = {
    user_id: userId,
    provider: 'stripe',
    platform: 'web',
    provider_subscription_id: sub.id,
    provider_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
    product_id: sub.items?.data?.[0]?.price?.id ?? null,
    status,
    current_period_end: periodEnd,
  };
  const { data: existing, error: selErr } = await admin
    .from('subscriptions')
    .select('id')
    .eq('provider', 'stripe')
    .eq('provider_subscription_id', sub.id)
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
    // Never shrink: an admin comp or a second subscription may already grant
    // further out than this event does.
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
      else console.log(`${logPrefix} ${userId} entitled until ${entitledUntil} (sub ${sub.id}, ${sub.status})`);
    }
  } else {
    console.log(`${logPrefix} sub ${sub.id} status=${sub.status} grants no entitlement; ledger updated`);
  }
}
