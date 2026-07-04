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

export type BetaFeature = 'auctions';

export const BETA_FEATURES: readonly BetaFeature[] = ['auctions'];

export function isBetaFeature(value: unknown): value is BetaFeature {
  return typeof value === 'string' && (BETA_FEATURES as readonly string[]).includes(value);
}

/**
 * Does this user pass the beta gate for a feature, given their cached grants?
 * `betaFeatures` is profiles.beta_features (may be null on old rows); admins
 * pass unconditionally. The global kill switch is enforced separately on the
 * server -- a `true` here still yields no access while the switch is off.
 */
export function hasBeta(
  feature: BetaFeature,
  betaFeatures: readonly string[] | null | undefined,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  return Array.isArray(betaFeatures) && betaFeatures.includes(feature);
}
