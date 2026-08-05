-- Live-breaks concurrency hardening (additive-only, safe on a live DB).
-- Companion to 20260804_live_breaks.sql; run in the Supabase SQL Editor.

-- One parcel per buyer per stream. Settle groups a buyer's paid spot orders
-- into ONE shipments row; two concurrent settle runs could both pass the
-- app-side "already settled" read and insert twin shipments (two parcels,
-- two fee orders, double freight). This makes the second insert fail with
-- 23505, which the settle route treats as "already exists" (refetch and
-- continue). Rows with stream_id NULL (non-live parcels, if any ever exist)
-- are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_one_per_stream_buyer
    ON public.shipments (stream_id, buyer_id)
    WHERE stream_id IS NOT NULL;

-- One spot->pack map per lot, EVER. A re-roll after buyers have seen (or
-- bought against) the map is exactly the manipulation break_randomizations
-- exists to prevent; the randomize route's pre-check is only a fast path and
-- loses a concurrent-request race (both read "no existing run", both insert).
-- The route maps 23505 on this index to its ALREADY_RANDOMIZED 409.
-- hit_assignment stays multi-row (one run per hit) and is not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_randomizations_spot_to_pack_once
    ON public.break_randomizations (stream_item_id, purpose)
    WHERE purpose = 'spot_to_pack';
