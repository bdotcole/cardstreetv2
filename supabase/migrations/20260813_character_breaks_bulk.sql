-- Character/team breaks + bulk spot discounts (additive-only; run in the
-- Supabase SQL Editor). Companion to 20260804_live_breaks.sql /
-- 20260805_live_breaks_hardening.sql / 20260810_presales.sql.
--
--   character_break  random_pack's spot mechanics (spots_total, spot_price)
--                    plus a breaker-defined character/team list — exactly one
--                    entity per spot, assigned by the audited server
--                    randomizer (purpose 'entity_assignment') instead of a
--                    pack map.
--   bulk_tiers       seller-defined quantity discounts ("3+ spots = -10%"),
--                    applied server-side at spot checkout.
--
-- App code tolerates the pre-migration state: character_break creation fails
-- with a friendly error, bulk_tiers are dropped from new lots, checkout skips
-- discounts, and reads fall back to the old column set.

-- ─── stream_items.item_type: admit 'character_break' ───
-- Drop + re-add keeps every existing value, so current rows all pass the
-- re-validation the ADD runs.
ALTER TABLE public.stream_items
    DROP CONSTRAINT IF EXISTS stream_items_item_type_check;
ALTER TABLE public.stream_items
    ADD CONSTRAINT stream_items_item_type_check CHECK (item_type IN
        ('personal_break', 'pick_your_pack', 'random_pack', 'chase_break', 'pack_wars',
         'character_break', 'buy_now', 'auction'));

-- character_break is spot-shaped like every other break format.
ALTER TABLE public.stream_items
    DROP CONSTRAINT IF EXISTS stream_items_break_shape;
ALTER TABLE public.stream_items
    ADD CONSTRAINT stream_items_break_shape CHECK (
        item_type NOT IN ('personal_break', 'pick_your_pack', 'random_pack', 'chase_break',
                          'pack_wars', 'character_break')
        OR (spots_total IS NOT NULL AND spot_price IS NOT NULL)
    );

-- The breaker-defined character/team list:
-- [{"key":"e1","label":"Pikachu"}, ...]. Exactly one entry per spot; labels
-- 1-40 chars (both enforced in the lots POST).
ALTER TABLE public.stream_items
    ADD COLUMN IF NOT EXISTS break_entities JSONB;

-- Quantity discounts: [{"qty":3,"discountPct":10}, ...] — 1..3 tiers,
-- ascending qty 2..spots_total, discountPct 1..50 (enforced in the lots
-- POST). Checkout applies the highest qualifying tier server-side.
ALTER TABLE public.stream_items
    ADD COLUMN IF NOT EXISTS bulk_tiers JSONB;

-- The randomizer's character assignment, denormalized onto the spot so the
-- board (and Realtime) can show "Spot 4 -> Pikachu" without joining the
-- audit table. The immutable break_randomizations row stays the record.
ALTER TABLE public.break_spots
    ADD COLUMN IF NOT EXISTS assigned_entity TEXT;

-- One character map per lot, EVER — same manipulation-proofing as the
-- spot_to_pack index in 20260805_live_breaks_hardening.sql: the randomize
-- route's pre-check loses a concurrent-request race (both read "no existing
-- run", both insert); the loser's 23505 on this index maps to the route's
-- ALREADY_RANDOMIZED 409.
CREATE UNIQUE INDEX IF NOT EXISTS idx_randomizations_entity_assignment_once
    ON public.break_randomizations (stream_item_id, purpose)
    WHERE purpose = 'entity_assignment';
