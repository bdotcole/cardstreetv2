-- Listing photos, enforced by the database.
--
-- lib/listingPhotoPolicy.ts says when a listing may use the catalog image
-- instead of the seller's own photos: a near-mint single strictly under ฿100.
-- Everything else (฿100 and up, below near-mint, sealed) needs the seller's
-- photo of the item, front and back for a single card.
--
-- Until this migration the rule lived in the listing form alone. The listings
-- table takes writes from the browser directly (RLS checks only seller_id),
-- from /api/listings, from the collection importer and from the vault's bulk
-- lister — and the bulk lister never read the rule at all: on 2026-10-21 one
-- tap published 18 photo-less Charizards at ฿175–฿220,944 (฿357k in asks).
-- Earlier sellers had done the same at smaller prices since 2026-09-22.
--
-- This trigger is the single authority. The client code keeps its own copy
-- of the rule so sellers get a friendly message, but a write that reaches
-- the table without the photos is refused here whichever path it took.
--
-- Idempotent: safe to re-run.

-- ============================================================================
-- 1. The rule, as a pure function (mirror of listingPhotosSatisfied)
-- ============================================================================
-- A photo counts only when it lives in our listing-images bucket, which is
-- where the listing form uploads. A catalog image or an off-site URL pasted
-- into the column is not a photo of the item in the seller's hands.
CREATE OR REPLACE FUNCTION public.listing_photos_satisfied(
    p_price numeric,
    p_condition text,
    p_front text,
    p_back text
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(
        (p_price IS NOT NULL AND p_price > 0 AND p_price < 100 AND p_condition = 'Near Mint')
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
-- Judged: rows on the market or headed there (active, draft, paused). A row
-- being sold, cancelled or removed is never blocked by its photos.
--
-- Strict (the full rule) for a new row and for a row entering the market
-- from outside it: a draft going live, a cancelled or removed listing being
-- re-activated. Lenient for an edit to a row already on the market: the 57
-- live rows listed before this rule may keep trading as they are — lower the
-- price, pause and reopen the shop, the checkout's sold->active rollback —
-- but an edit may not introduce the violation (removing a photo, raising a
-- ฿90 catalog-art listing to ฿150) or push a grandfathered row's price up.
--
-- Not SECURITY DEFINER: it reads only NEW and OLD.
CREATE OR REPLACE FUNCTION public.trg_enforce_listing_photos()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
    strict_check boolean;
BEGIN
    IF NEW.status NOT IN ('active', 'draft', 'paused') THEN
        RETURN NEW;
    END IF;

    IF public.listing_photos_satisfied(NEW.price, NEW.condition, NEW.image_front_url, NEW.image_back_url) THEN
        RETURN NEW;
    END IF;

    strict_check := TG_OP = 'INSERT'
        OR (NEW.status IS DISTINCT FROM OLD.status AND OLD.status NOT IN ('active', 'paused', 'sold'));

    IF NOT strict_check THEN
        -- An edit to a listing already on the market: allowed unless it
        -- introduces the violation or raises the price.
        IF public.listing_photos_satisfied(OLD.price, OLD.condition, OLD.image_front_url, OLD.image_back_url) = false
           AND NEW.price <= OLD.price THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'LISTING_PHOTOS_REQUIRED: photos of the actual item are required at 100 THB and above, below near-mint, or for sealed products'
        USING ERRCODE = 'P0001',
              HINT = 'Upload a front and back photo of the card (one photo for a sealed product), or list a near-mint single under 100 THB with the catalog image.';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_listing_photos ON public.listings;
CREATE TRIGGER trg_enforce_listing_photos
    BEFORE INSERT OR UPDATE OF price, condition, image_front_url, image_back_url, status
    ON public.listings
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_listing_photos();

COMMENT ON FUNCTION public.trg_enforce_listing_photos() IS
    'Refuses a listing on the market without the seller photos lib/listingPhotoPolicy.ts requires (catalog art only for a near-mint single under 100 THB). Raises LISTING_PHOTOS_REQUIRED.';
