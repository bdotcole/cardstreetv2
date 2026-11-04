-- Graded cards always need the seller's photos.
--
-- 20261021_listing_photos_required.sql let the catalog image stand in for a
-- near-mint single under 100 THB and judged nothing else. The graded flag
-- was not part of the rule, so on 2026-11-04 a seller listed a "PSA 10" at
-- 20 THB and a "CGC 10" at 50 THB with no photo at all: a raw common wearing
-- a grade nobody can check, at exactly the price where the rule looked away.
-- The slab is the product (label, grade, cert number) and the catalog image
-- shows none of it, so a graded listing needs the seller's front and back
-- photo of the slab whatever its price.
--
-- Mirror of catalogArtAllowed / listingPhotosSatisfied in
-- lib/listingPhotoPolicy.ts, which gained the same third input. Change the
-- two together.
--
-- Idempotent: safe to re-run. The new 5-argument function is created before
-- the trigger function is replaced and the old 4-argument one dropped last,
-- so a concurrent insert always finds a consistent pair.

-- ============================================================================
-- 1. The rule, with the graded flag
-- ============================================================================
CREATE OR REPLACE FUNCTION public.listing_photos_satisfied(
    p_price numeric,
    p_condition text,
    p_front text,
    p_back text,
    p_is_graded boolean
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(
        (
            NOT COALESCE(p_is_graded, false)
            AND p_price IS NOT NULL AND p_price > 0 AND p_price < 100
            AND p_condition = 'Near Mint'
        )
        OR (
            p_front LIKE '%/storage/v1/object/public/listing-images/%'
            AND (p_condition = 'Sealed' OR p_back LIKE '%/storage/v1/object/public/listing-images/%')
        ),
        false
    );
$$;

-- ============================================================================
-- 2. The trigger
-- ============================================================================
-- Same shape as before (strict for inserts and for a row entering the market,
-- lenient for an edit to a row already on it) with two additions: the graded
-- flag is part of the rule, and the lenient path no longer lets a photo-less
-- row BECOME graded — flipping is_graded on a grandfathered catalog-art row
-- is exactly the write this migration exists to refuse.
CREATE OR REPLACE FUNCTION public.trg_enforce_listing_photos()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    strict_check boolean;
    becomes_graded boolean;
BEGIN
    IF NEW.status NOT IN ('active', 'draft', 'paused') THEN
        RETURN NEW;
    END IF;

    IF public.listing_photos_satisfied(
        NEW.price, NEW.condition, NEW.image_front_url, NEW.image_back_url, NEW.is_graded
    ) THEN
        RETURN NEW;
    END IF;

    strict_check := TG_OP = 'INSERT'
        OR (NEW.status IS DISTINCT FROM OLD.status AND OLD.status NOT IN ('active', 'paused', 'sold'));

    IF NOT strict_check THEN
        becomes_graded := COALESCE(NEW.is_graded, false) AND NOT COALESCE(OLD.is_graded, false);
        -- An edit to a listing already on the market: allowed unless it
        -- introduces the violation, raises the price, or adds a grade.
        IF public.listing_photos_satisfied(
               OLD.price, OLD.condition, OLD.image_front_url, OLD.image_back_url, OLD.is_graded
           ) = false
           AND NEW.price <= OLD.price
           AND NOT becomes_graded THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'LISTING_PHOTOS_REQUIRED: photos of the actual item are required at 100 THB and above, below near-mint, for graded cards, or for sealed products'
        USING ERRCODE = 'P0001',
              HINT = 'Upload a front and back photo of the card or slab (one photo for a sealed product), or list an ungraded near-mint single under 100 THB with the catalog image.';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_listing_photos ON public.listings;
CREATE TRIGGER trg_enforce_listing_photos
    BEFORE INSERT OR UPDATE OF price, condition, image_front_url, image_back_url, status, is_graded
    ON public.listings
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_listing_photos();

COMMENT ON FUNCTION public.trg_enforce_listing_photos() IS
    'Refuses a listing on the market without the seller photos lib/listingPhotoPolicy.ts requires (catalog art only for an ungraded near-mint single under 100 THB; a graded card always needs slab photos). Raises LISTING_PHOTOS_REQUIRED.';

-- ============================================================================
-- 3. Retire the 4-argument rule
-- ============================================================================
-- Nothing calls it any more; keeping it would leave two rules with the same
-- name and let a future caller pick the one without the graded gate.
DROP FUNCTION IF EXISTS public.listing_photos_satisfied(numeric, text, text, text);
