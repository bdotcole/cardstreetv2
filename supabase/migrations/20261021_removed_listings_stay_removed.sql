-- Removed listings stay removed.
--
-- An admin takedown sets listings.status = 'removed' (lib/adminModeration.ts,
-- the /api/admin/listings/[id] DELETE route, bans). The seller's UPDATE policy
-- ("Sellers can update own listings") has no WITH CHECK, so a seller could put
-- the row back on the market with a single update({ status: 'active' }) call.
-- trg_enforce_listing_photos (2026-10-21) stops that only for rows without
-- seller photos; a removed counterfeit that has photos could still come back.
--
-- RLS cannot compare OLD and NEW, so this is a trigger. The name sorts before
-- trg_enforce_listing_photos (BEFORE triggers fire alphabetically). It refuses
-- any move out of 'removed' when the current database role is one PostgREST
-- uses for end users (authenticated, anon). The service role (admin console,
-- crons) and the SQL editor keep the ability to restore a listing. Deliberately
-- not SECURITY DEFINER: current_user has to be the caller's role.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.trg_block_removed_listing_reactivation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF OLD.status = 'removed'
       AND NEW.status IS DISTINCT FROM 'removed'
       AND current_user IN ('authenticated', 'anon') THEN
        RAISE EXCEPTION 'LISTING_REMOVED_LOCKED: this listing was removed by Cardstreet moderation and cannot be relisted'
            USING ERRCODE = 'P0001',
                  HINT = 'Contact support if you think this was a mistake.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_removed_listing_reactivation ON public.listings;
CREATE TRIGGER trg_block_removed_listing_reactivation
    BEFORE UPDATE OF status ON public.listings
    FOR EACH ROW EXECUTE FUNCTION public.trg_block_removed_listing_reactivation();

COMMENT ON FUNCTION public.trg_block_removed_listing_reactivation() IS
    'Refuses an end-user role (authenticated/anon) moving a listing out of status=removed; the service role and the SQL editor may still restore it. Raises LISTING_REMOVED_LOCKED.';
