-- Reassert the write-side RLS fixes that were applied as raw SQL in the Supabase
-- SQL Editor on 2026-07-12 (pre-ad-push audit criticals #2 and #3) but were never
-- committed as migrations. Until now the repo still advertised the *vulnerable*
-- policies:
--
--   * 20260124_initial_schema.sql       — profiles UPDATE policy with no column guard
--   * 20260204_shipping_automation.sql  — orders "Buyers and sellers can update orders"
--                                         + shipping_labels "System can ..." WITH CHECK(true)
--   * 20260515_lock_seller_order_updates.sql — tried to DROP policies by names that never
--                                         existed ("Sellers can ..."), so it was a NO-OP.
--
-- Anyone provisioning a fresh DB / preview / staging environment from migrations would
-- have silently reintroduced all three holes. This migration is idempotent and matches
-- live production (verified via pg_policies / pg_get_functiondef on 2026-07-14).

-- ─────────────────────────────────────────────────────────────────────────────
-- Critical #2 — profiles privileged-column lock.
-- The base UPDATE policy is USING (auth.uid() = id) with no column guard, so a user
-- could self-set role='admin' or partner_level=9 (fee 9%->2%). This BEFORE UPDATE
-- trigger blocks any non-service-role write to platform-managed columns.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.protect_privileged_profile_columns()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND (
       NEW.role             IS DISTINCT FROM OLD.role
    OR NEW.partner_level     IS DISTINCT FROM OLD.partner_level
    OR NEW.partner_fee       IS DISTINCT FROM OLD.partner_fee
    OR NEW.total_downloads   IS DISTINCT FROM OLD.total_downloads
    OR NEW.is_verified_shop  IS DISTINCT FROM OLD.is_verified_shop
    OR NEW.rating            IS DISTINCT FROM OLD.rating
    OR NEW.review_count      IS DISTINCT FROM OLD.review_count
    OR NEW.partner_joined_at IS DISTINCT FROM OLD.partner_joined_at
  ) THEN
    RAISE EXCEPTION 'These profile columns are managed by the platform and cannot be changed directly';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS protect_privileged_profile_columns ON public.profiles;
CREATE TRIGGER protect_privileged_profile_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_privileged_profile_columns();

-- ─────────────────────────────────────────────────────────────────────────────
-- Critical #3 — remove client-writable order / shipping-label policies.
-- All order + shipping-label writes go through service-role code paths
-- (fulfillOrder, release-funds, flashRecovery, the Flash webhook) which bypass RLS.
-- Dropping these by their REAL names (the 20260515 migration used wrong names).
-- SELECT policies are intentionally left in place (buyers/sellers read their own rows).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Buyers and sellers can update orders" ON public.orders;
DROP POLICY IF EXISTS "Buyers can create orders"             ON public.orders;
DROP POLICY IF EXISTS "System can create shipping labels"    ON public.shipping_labels;
DROP POLICY IF EXISTS "System can update shipping labels"    ON public.shipping_labels;

-- ─────────────────────────────────────────────────────────────────────────────
-- #18 — ensure RLS is enabled on admin/config tables that were open by default.
-- (Admin-scoped write policies already exist live; this only guarantees RLS is ON so
-- a fresh environment can't fall back to default-allow. Safe/idempotent.)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.set_bridge          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_popularity   ENABLE ROW LEVEL SECURITY;
