-- Live breaks: first-checkout shipping model.
--
-- A buyer's FIRST spot purchase from EACH lot carries that lot's Flash-quoted
-- base shipping fee (on the lot's first order row of the batch); additional
-- spots from the same lot ship free by default. This column lets a seller opt
-- a lot into a per-spot increment instead of free — each spot beyond the
-- buyer's first from the lot adds this many satang to that batch's shipping.
--
-- Replaces the settle-time model where stream settlement minted a separate
-- `liveship_` shipping-fee order the buyer paid after the show. The
-- shipments.status enum keeps 'awaiting_shipping_fee' for legacy rows; new
-- shipments start at 'pending'. Code fails soft (42703 / PGRST204) until this
-- migration runs.

ALTER TABLE public.stream_items
    ADD COLUMN IF NOT EXISTS incremental_ship_satang BIGINT NOT NULL DEFAULT 0
        CHECK (incremental_ship_satang >= 0);
