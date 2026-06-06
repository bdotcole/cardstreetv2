-- ============================================================
-- Supabase linter hardening (WARN-level findings)
--
-- A. function_search_path_mutable: pin search_path on 12 functions
-- B. anon/authenticated_security_definer_function_executable:
--    revoke EXECUTE on 3 trigger/helper functions not meant as RPC
-- C. rls_policy_always_true: scope portfolio_snapshots INSERT to owner
-- D. public_bucket_allows_listing: drop broad listing-images SELECT
--
-- pg_trgm-in-public (0014) and leaked-password protection (auth) are
-- intentionally NOT addressed here: the former risks the trigram GIN
-- index / similarity() calls, the latter is a dashboard Auth setting.
-- ============================================================

-- ---- A. Pin search_path (matches Supabase's own `public, pg_temp` convention) ----
ALTER FUNCTION public.decay_search_popularity()                                              SET search_path = public, pg_temp;
ALTER FUNCTION public.get_unmapped_thai_cards(batch_size integer)                            SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user_preferences()                                          SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_updated_at()                                                    SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_search_popularity(p_card_id text)                            SET search_path = public, pg_temp;
ALTER FUNCTION public.search_pokemon_cards(search_query text, result_limit integer)          SET search_path = public, pg_temp;
ALTER FUNCTION public.update_buylist_updated_at()                                            SET search_path = public, pg_temp;
ALTER FUNCTION public.update_pokemon_updated_at()                                            SET search_path = public, pg_temp;
ALTER FUNCTION public.update_support_tickets_updated_at_fn()                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at_column()                                             SET search_path = public, pg_temp;
ALTER FUNCTION public.search_pokemon_by_phash(query_phash bytea, max_distance integer, result_limit integer, language_filter text) SET search_path = public, pg_temp;
ALTER FUNCTION public.hamming_distance(a bytea, b bytea)                                     SET search_path = public, pg_temp;

-- ---- B. Revoke EXECUTE on DEFINER functions that should not be public RPC ----
-- These run as triggers on auth.users (or as their helper); triggers fire as the
-- table owner regardless of grants, so signup is unaffected.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                     FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_preferences()         FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.generate_unique_username(text)        FROM anon, authenticated, public;

-- ---- C. Scope portfolio_snapshots INSERT to the owning user ----
-- Legitimate writes come from the create-portfolio-snapshots edge function via the
-- service role (which bypasses RLS); WITH CHECK (true) let any signed-in user forge
-- a snapshot for any user_id.
ALTER POLICY "System can insert portfolio snapshots" ON public.portfolio_snapshots
  WITH CHECK (auth.uid() = user_id);

-- ---- D. Drop broad public listing of the listing-images bucket ----
-- Bucket is public, so object URLs are served by the CDN without this policy. The
-- app only uses upload() + getPublicUrl(), never .list(); this policy only enabled
-- filename enumeration.
DROP POLICY "Public Access" ON storage.objects;
