/**
 * Beta feature capability map -- the single source of truth for what each
 * dark-shipped beta feature is called and who can see it.
 *
 * Add a future beta feature HERE, not as a scattered `if (flag)` check.
 * Both the server gate (lib/betaAuth.ts) and the client
 * (lib/hooks/useBetaFeatures.ts) read this module, so the rules can't drift
 * between the two. Keep it pure -- no Supabase / Next imports -- so it runs
 * identically on both sides. Mirrors lib/entitlements.ts for the Pro tier.
 *
 * Access model:
 *   - profiles.beta_features text[] holds the per-user grants ('auctions', ...).
 *   - Admins pass every beta gate by role, evergreen (same admin-is-Pro-by-role
 *     pattern as premiumAuth).
 *   - A global per-feature kill switch lives in the beta_feature_flags table;
 *     lib/betaAuth.ts checks it server-side. It is NOT part of this pure module
 *     because it requires a DB read.
 */

export type BetaFeature = 'auctions' | 'live_streams' | 'live_broadcast' | 'rewards' | 'rewards_vouchers';

// 'live_streams' gates viewing/bidding/buying in a live show; 'live_broadcast'
// is the invite-only broadcaster grant (a live seller is a Connect seller with
// this flag). Both have a matching beta_feature_flags kill-switch row seeded by
// supabase/migrations/20260704_live_streams.sql.
// 'rewards' gates the Collector Pass rewards system (kill-switch row seeded
// by 20260828_collector_pass_foundation.sql; graduated to GA_FEATURES
// 2026-08-30).
// 'rewards_vouchers' separately gates the checkout voucher rail (20260829) so
// the money-touching half is independently killable.
export const BETA_FEATURES: readonly BetaFeature[] = ['auctions', 'live_streams', 'live_broadcast', 'rewards', 'rewards_vouchers'];

/**
 * Features GRADUATED to general availability: every signed-in user passes the
 * per-user grant check — no profiles.beta_features entry needed. Sign-in and
 * the global kill switch STILL apply, so
 * `UPDATE beta_feature_flags SET enabled=false WHERE feature='<name>'`
 * remains the one-statement off switch for everyone.
 *
 * - 'live_streams' (2026-08-16 founder call: "make the live section available
 *   for viewers"). The RLS twin is supabase/migrations/20260819_live_viewers_ga.sql
 *   (Realtime respects RLS, so without it a GA viewer's board/chat would never
 *   update live).
 * - 'rewards' (2026-08-30 founder call: Collector Pass public launch).
 *   'rewards_vouchers' needs no entry — it is checked only as a global
 *   kill switch (isFeatureEnabled), never as a per-user grant.
 *
 * Broadcasting ('live_broadcast') is deliberately NOT here — it stays
 * invite-only behind the admin wall until breaker-application onboarding
 * starts granting it.
 */
export const GA_FEATURES: readonly BetaFeature[] = ['live_streams', 'rewards'];

/**
 * Features switched OFF in code for EVERYONE -- admins and per-user grant
 * holders included. This is a stronger lever than the beta_feature_flags
 * kill switch (which an admin still passes on the client) and than removing a
 * name from GA_FEATURES (which only revokes the blanket grant): a listed
 * feature has no entry point anywhere and every server gate refuses it.
 *
 * - live_streams / live_broadcast (2026-09-04 founder call: hold off on breaks).
 *   The whole Live section is hidden, so the Shop tab opens straight on the
 *   Marketplace instead of the Live-vs-Marketplace chooser.
 *
 * Re-enabling is deleting the entry -- no migration, no per-user grant edits,
 * and the DB kill-switch rows stay exactly as they were.
 */
export const DISABLED_FEATURES: readonly BetaFeature[] = ['live_streams', 'live_broadcast'];

/** Is this feature switched off in code, ahead of any grant or DB lookup? */
export function isFeatureDisabledInCode(feature: BetaFeature): boolean {
  return (DISABLED_FEATURES as readonly string[]).includes(feature);
}

export function isBetaFeature(value: unknown): value is BetaFeature {
  return typeof value === 'string' && (BETA_FEATURES as readonly string[]).includes(value);
}

/**
 * Does this user pass the beta gate for a feature, given their cached grants?
 * `betaFeatures` is profiles.beta_features (may be null on old rows); a feature in
 * DISABLED_FEATURES is refused outright, admins otherwise pass unconditionally,
 * and GA features pass for everyone. The global kill switch is enforced
 * separately on the server -- a `true` here still yields no access while the
 * switch is off.
 */
export function hasBeta(
  feature: BetaFeature,
  betaFeatures: readonly string[] | null | undefined,
  isAdmin: boolean,
): boolean {
  if (isFeatureDisabledInCode(feature)) return false;
  if (isAdmin) return true;
  if ((GA_FEATURES as readonly string[]).includes(feature)) return true;
  return Array.isArray(betaFeatures) && betaFeatures.includes(feature);
}
