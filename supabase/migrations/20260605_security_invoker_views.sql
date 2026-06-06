-- ============================================================
-- Fix Supabase linter: 0010_security_definer_view
--
-- Views created without `security_invoker` run with the view
-- OWNER's privileges (postgres), bypassing RLS on the underlying
-- tables. Setting security_invoker = on makes each view enforce
-- the querying role's permissions and RLS instead.
--
-- All four views below are read-only catalog/reference views over
-- non-sensitive data (public card catalog, search counts, Thai<->
-- English mappings). No app code reads them via the anon client;
-- dev tooling uses the service role (which bypasses RLS regardless),
-- so this change is behavior-neutral for actual consumers.
-- ============================================================

ALTER VIEW public.popular_cards          SET (security_invoker = on);
ALTER VIEW public.pokemon_cards_simple   SET (security_invoker = on);
ALTER VIEW public.thai_cards_matched     SET (security_invoker = on);
ALTER VIEW public.thai_cards_unmatched   SET (security_invoker = on);
