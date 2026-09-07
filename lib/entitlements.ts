/**
 * Premium entitlement capability map -- the single source of truth for what
 * the paid "Pro" tier unlocks.
 *
 * Add a future pro feature HERE, not as a scattered `if (premium)` check.
 * Both the server gate (lib/premiumAuth.ts) and the client (lib/hooks/usePremium.ts)
 * read this module, so the rules can't drift between the two. Keep it pure --
 * no Supabase / Next imports -- so it runs identically on both sides.
 */

/**
 * Is the consumer Pro plan on sale?
 *
 * OFF since 2026-09-07. ฿149/month, card-only, in a market that pays by
 * PromptPay; zero subscribers ever; and until 41ab954 the billing granted
 * nothing at all, so the first person to pay would have been charged and given
 * no feature and no way to cancel. Two of the five perks have since become
 * free (trade finder, wishlist alerts), leaving a plan that was never bought,
 * has less in it than it did, and cannot be paid for the way this market pays.
 *
 * A SWITCH, NOT A DELETION. Everything underneath stays live and correct:
 * FEATURE_TIERS, requirePremium/requireFeature, the Stripe webhooks,
 * premiumEntitlement, the RevenueCat bridge. Admins still get every feature by
 * role, an existing subscriber (there are none) would still be entitled and
 * still able to manage their subscription, and turning the plan back on is
 * this one line. Deleting the code would mean rebuilding and re-testing a
 * payment integration to find out whether shops will pay for something —
 * which is a question to ask before writing code, not after deleting it.
 *
 * What it hides: the price, the upgrade buttons, the nav and profile entries,
 * and the upsell CTAs that pointed at a plan nobody could buy. What it does
 * NOT hide: /premium itself, which stays reachable and noindexed so a
 * subscriber or an app-store deep link still lands somewhere real.
 */
export const CONSUMER_PRO_ENABLED = false;

export type PlanTier = 'free' | 'premium';

export type PremiumFeature =
  | 'ai_grader'
  | 'trade_finder'
  | 'advanced_market'
  | 'pro_seller_rate'
  | 'wishlist_alerts';

/** Each feature -> minimum tier required. Anything not listed is free. */
export const FEATURE_TIERS: Record<PremiumFeature, PlanTier> = {
  ai_grader: 'premium',
  // Free since 2026-09-05. Both of the features flipped here are demand-side:
  // with 9 buyers ever, the paywall was protecting revenue that did not exist
  // while suppressing the two things that pull a collector back into the app.
  // They stay LISTED here rather than deleted, so the server gate and the
  // client hook keep resolving them through one map -- putting a tier back is
  // a one-word change, not a hunt through call sites.
  trade_finder: 'free',
  advanced_market: 'premium',
  // 5% seller fee (vs the 9% standard) -- enforced in app/api/orders/checkout.
  pro_seller_rate: 'premium',
  // Email/push when a wishlisted card gets listed -- lib/wishlistAlerts.ts.
  wishlist_alerts: 'free',
};

export const PREMIUM_FEATURES = Object.keys(FEATURE_TIERS) as PremiumFeature[];

/**
 * Is the cached entitlement currently active? `premiumUntil` is the ISO
 * timestamp from profiles.premium_until; null/undefined/past = free.
 */
export function isPremium(premiumUntil: string | null | undefined): boolean {
  if (!premiumUntil) return false;
  const ts = Date.parse(premiumUntil);
  return Number.isFinite(ts) && ts > Date.now();
}

export function planTier(premiumUntil: string | null | undefined): PlanTier {
  return isPremium(premiumUntil) ? 'premium' : 'free';
}

/** Does this entitlement unlock the given feature? */
export function hasFeature(
  feature: PremiumFeature,
  premiumUntil: string | null | undefined,
): boolean {
  return FEATURE_TIERS[feature] === 'free' || isPremium(premiumUntil);
}
