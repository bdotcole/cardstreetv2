-- Draft-first listings: let a seller create listings BEFORE finishing Stripe
-- onboarding. They insert as status='draft' and auto-publish (status='active')
-- the moment stripe_details_submitted flips true (connect status refresh +
-- account.updated webhook both publish).
--
-- Why: 74 of 108 sellers who started Stripe onboarding abandoned it, and the
-- KYC wall currently stands BEFORE the rewarding part (listing cards). Drafts
-- move the wall after the effort investment: "your 12 listings are ready —
-- finish payout setup" is a far stronger motivator than an abstract
-- prerequisite. Money safety is unchanged: RLS hides drafts from everyone but
-- the owner (the existing SELECT policy is `status = 'active' OR auth.uid() =
-- seller_id`), every buyer-facing query filters status='active', checkout
-- rejects non-active listings, and Stripe itself refuses charges on
-- non-charges_enabled accounts.
--
-- The application fails soft until this runs: a draft insert violates the old
-- CHECK and the client degrades to the previous "finish Stripe first" block.
--
-- Idempotent: safe to run more than once from the SQL Editor.

DO $$
DECLARE
  con RECORD;
BEGIN
  -- The original CHECK was declared inline in 20260124_initial_schema.sql
  -- ('active','sold','cancelled'), so its name is auto-generated — look it
  -- up instead of assuming. No other listings CHECK mentions "status".
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.listings'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.listings DROP CONSTRAINT %I', con.conname);
  END LOOP;

  ALTER TABLE public.listings
    ADD CONSTRAINT listings_status_check
    CHECK (status IN ('active', 'sold', 'cancelled', 'draft'));
END $$;

COMMENT ON COLUMN public.listings.status IS
    'active | sold (also the checkout reservation state) | cancelled | draft (created before Stripe onboarding finished; owner-only via RLS, auto-published when stripe_details_submitted flips true)';
