-- Live breaks: one parcel per buyer PER LOT (supersedes the per-stream model).
--
-- Shipping is collected per lot at spot checkout (20260816): each break's
-- Flash-quoted base fee (+ optional per-spot increments) funds that break's
-- OWN parcel. Settle therefore mints one shipments row per (buyer, lot) —
-- stream_item_id identifies the lot the parcel fulfills; stream_id stays
-- populated for provenance. Run in the Supabase SQL Editor; the settle route
-- fails soft (42703 / PGRST204 -> legacy per-stream grouping) until this runs.

ALTER TABLE public.shipments
    ADD COLUMN IF NOT EXISTS stream_item_id UUID REFERENCES public.stream_items(id) ON DELETE SET NULL;

-- The old per-stream index MUST go, not merely be superseded: it allows only
-- one shipment per (stream, buyer), so a buyer's SECOND per-lot parcel in the
-- same stream would 23505 against it and settle would wrongly adopt the first
-- lot's parcel for a different lot's orders.
DROP INDEX IF EXISTS public.idx_shipments_one_per_stream_buyer;

-- Same concurrency guarantee as the dropped index, at the new grain: two
-- concurrent settle runs can't mint twin parcels for one (lot, buyer) — the
-- loser gets 23505, which the settle route treats as "already exists"
-- (refetch and adopt). Legacy per-stream rows (stream_item_id NULL) are
-- exempt and keep their history untouched.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_one_per_lot_buyer
    ON public.shipments (stream_item_id, buyer_id)
    WHERE stream_item_id IS NOT NULL;
