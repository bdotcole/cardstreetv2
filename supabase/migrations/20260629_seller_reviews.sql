-- Seller reviews
--
-- The buyer-facing capture UI already existed (the "Confirm Delivery & Review"
-- modal on mobile Profile + desktop Orders posts { reviewScore, reviewComment }
-- to /api/orders/complete), but the endpoint only console.log'd the review with
-- a "wire to a real reviews table when one exists" placeholder. This adds the
-- table that finishes that flow, plus denormalized aggregates on profiles so the
-- marketplace listing chips can show a seller's rating without an N+1 join.

-- 1. Reviews table. One review per order (a verified purchase) — orders are one
--    row per listing, so order_id is the natural unique key.
CREATE TABLE IF NOT EXISTS public.reviews (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    seller_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rating      SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment     TEXT,
    -- Snapshot of the purchased card's name so a deleted listing can't blank the
    -- review's "item" label later.
    item_name   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_seller_id ON public.reviews(seller_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_id ON public.reviews(reviewer_id);

-- 2. Denormalized aggregates on profiles. Kept current by the trigger below so
--    listing/seller queries just select these two columns.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2),
    ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0;

-- 3. Recompute a seller's aggregate rating + count whenever their reviews change.
--    SECURITY DEFINER so it can write profiles regardless of the row-owner RLS.
CREATE OR REPLACE FUNCTION public.recompute_seller_rating()
RETURNS TRIGGER AS $$
DECLARE
    affected_seller UUID := COALESCE(NEW.seller_id, OLD.seller_id);
BEGIN
    UPDATE public.profiles p
    SET review_count = sub.cnt,
        rating       = sub.avg_rating
    FROM (
        SELECT COUNT(*)::int AS cnt,
               ROUND(AVG(rating)::numeric, 2) AS avg_rating
        FROM public.reviews
        WHERE seller_id = affected_seller
    ) sub
    WHERE p.id = affected_seller;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_recompute_seller_rating ON public.reviews;
CREATE TRIGGER trg_recompute_seller_rating
    AFTER INSERT OR UPDATE OR DELETE ON public.reviews
    FOR EACH ROW EXECUTE FUNCTION public.recompute_seller_rating();

-- Keep updated_at fresh (function defined in 20260124_initial_schema.sql).
DROP TRIGGER IF EXISTS update_reviews_updated_at ON public.reviews;
CREATE TRIGGER update_reviews_updated_at
    BEFORE UPDATE ON public.reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. RLS. Reviews are public to read; a buyer may only write a review for their
--    own delivered/completed order with that seller. (The server route inserts
--    via the service-role client, which bypasses RLS — these policies guard any
--    direct client access as defense in depth.)
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviews are viewable by everyone"
    ON public.reviews FOR SELECT
    USING (true);

CREATE POLICY "Buyers can review their delivered orders"
    ON public.reviews FOR INSERT
    WITH CHECK (
        auth.uid() = reviewer_id
        AND EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = reviews.order_id
              AND o.buyer_id = auth.uid()
              AND o.seller_id = reviews.seller_id
              AND o.status IN ('delivered', 'completed')
        )
    );

CREATE POLICY "Buyers can update their own reviews"
    ON public.reviews FOR UPDATE
    USING (auth.uid() = reviewer_id)
    WITH CHECK (auth.uid() = reviewer_id);

CREATE POLICY "Buyers can delete their own reviews"
    ON public.reviews FOR DELETE
    USING (auth.uid() = reviewer_id);
