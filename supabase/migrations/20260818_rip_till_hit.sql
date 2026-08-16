-- Rip 'Til You Hit ("buffet") breaks (additive-only; run in the Supabase SQL
-- Editor). Companion to 20260804_live_breaks.sql / 20260813_character_breaks_bulk.sql.
--
--   rip_till_hit   spots are sequential TURNS, sold strictly one at a time
--                  (the claim route enforces "all lower spots sold"). The
--                  breaker rips packs for the current turn until a hit
--                  appears, records it (break_spots.hit_note/hit_at), and the
--                  next turn opens. Per-lot pricing mode rides card_data:
--                  rtyhPricing 'fixed' (claim + checkout rail) or 'auction'
--                  (each turn auctioned through the live-auction engine).
--
-- App code tolerates the pre-migration state: rip_till_hit creation fails
-- with a friendly error and spot reads fall back to the old column set.

-- ─── stream_items.item_type: admit 'rip_till_hit' ───
-- Drop + re-add keeps every existing value, so current rows all pass the
-- re-validation the ADD runs.
ALTER TABLE public.stream_items
    DROP CONSTRAINT IF EXISTS stream_items_item_type_check;
ALTER TABLE public.stream_items
    ADD CONSTRAINT stream_items_item_type_check CHECK (item_type IN
        ('personal_break', 'pick_your_pack', 'random_pack', 'chase_break', 'pack_wars',
         'character_break', 'rip_till_hit', 'buy_now', 'auction'));

-- rip_till_hit is spot-shaped like every other break format (a spot = a turn).
ALTER TABLE public.stream_items
    DROP CONSTRAINT IF EXISTS stream_items_break_shape;
ALTER TABLE public.stream_items
    ADD CONSTRAINT stream_items_break_shape CHECK (
        item_type NOT IN ('personal_break', 'pick_your_pack', 'random_pack', 'chase_break',
                          'pack_wars', 'character_break', 'rip_till_hit')
        OR (spots_total IS NOT NULL AND spot_price IS NOT NULL)
    );

-- ─── The turn's outcome, recorded by the breaker at the "HIT" moment ───
-- hit_at doubles as the turn-complete flag: the current turn is the
-- lowest-numbered sold spot with hit_at IS NULL. Dispute material like
-- break_opened_at — written once by the mark-hit route, never moved.
ALTER TABLE public.break_spots
    ADD COLUMN IF NOT EXISTS hit_note TEXT
        CHECK (hit_note IS NULL OR char_length(hit_note) <= 200);
ALTER TABLE public.break_spots
    ADD COLUMN IF NOT EXISTS hit_at TIMESTAMPTZ;
