-- When a seller's Stripe Connect account first became chargeable.
--
-- The admin dashboard counts completed seller accounts (stripe_charges_enabled)
-- and shows how many completed inside a 24h / 7d / 30d window. The only
-- timestamp the Connect sync writes is stripe_account_updated_at, which every
-- account.updated webhook and status refresh bumps, so it reads as "last
-- change", not "completed". This column is stamped once, on the false -> true
-- edge, by a trigger so both writers (the webhook and the status route) and any
-- hand-run SQL are covered without touching app code.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS stripe_charges_enabled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.stripe_charges_enabled_at IS
    'First time stripe_charges_enabled flipped true (Stripe Connect onboarding complete). NULL = never chargeable.';

CREATE OR REPLACE FUNCTION public.stamp_stripe_charges_enabled_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only the first completion is recorded: an account that Stripe restricts
    -- and later re-enables keeps its original completion date.
    IF NEW.stripe_charges_enabled IS TRUE
       AND NEW.stripe_charges_enabled_at IS NULL
       AND (TG_OP = 'INSERT' OR OLD.stripe_charges_enabled IS DISTINCT FROM TRUE) THEN
        NEW.stripe_charges_enabled_at := NOW();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_stripe_charges_enabled_at ON public.profiles;
CREATE TRIGGER trg_stamp_stripe_charges_enabled_at
    BEFORE INSERT OR UPDATE OF stripe_charges_enabled ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.stamp_stripe_charges_enabled_at();

-- Backfill sellers who completed before this column existed. The last Connect
-- sync time is the closest record we have of when that happened; the account
-- creation date is the floor for rows the sync never stamped.
UPDATE public.profiles
SET stripe_charges_enabled_at = COALESCE(stripe_account_updated_at, created_at)
WHERE stripe_charges_enabled IS TRUE
  AND stripe_charges_enabled_at IS NULL;
