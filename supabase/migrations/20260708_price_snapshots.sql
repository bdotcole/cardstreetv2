-- Price history snapshots: append-only daily market-value points for singles + sealed.
--
-- Powers the real "Price Over Time" chart on card / sealed-product pages, REPLACING
-- the fabricated trend lines that used to render there (lib/cardMapper.ts injected a
-- Math.random() priceHistory; components/SealedProductDetail rolled its own seeded PRNG).
-- PriceCharting cannot supply history (their API/CSV are current-value only), so the
-- series is grown forward from here: one snapshot per subject per day.
--
-- Keying mirrors market_values / market_value_sales: (subject_id, language, condition).
--   * subject_id = pokemon_cards.id  -> a single, condition='Market'
--             or   sealed_products.id ('pc-<id>') -> sealed, condition='Sealed', is_sealed=true
-- The daily cron (app/api/cron/price-snapshots) UPSERTs on (subject_id, language,
-- condition, captured_on), so a re-run within the same UTC day refreshes that day's
-- point instead of duplicating it.
--
-- market_thb is the value the chart plots (THB base, matching PriceChart's hardcoded
-- ฿ axis), normalized at capture time so a later edit to constants.EXCHANGE_RATES never
-- rewrites historical points. market_native + currency are retained for traceability.
--
-- Run in the Supabase SQL Editor (the founder does not use the CLI). Safe on prod:
-- purely additive, writes to no existing table.

CREATE TABLE IF NOT EXISTS public.price_snapshots (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_id    TEXT NOT NULL,               -- pokemon_cards.id OR sealed_products.id (pc-<id>)
  language      TEXT NOT NULL,               -- en | th | ja | jp (the subject's own language)
  condition     TEXT NOT NULL DEFAULT 'Market', -- 'Market' for singles, 'Sealed' for sealed
  is_sealed     BOOLEAN NOT NULL DEFAULT false,
  market_thb    NUMERIC NOT NULL CHECK (market_thb > 0), -- the plotted value (THB base)
  market_native NUMERIC,                      -- source price before THB conversion (traceability)
  currency      TEXT NOT NULL DEFAULT 'THB',  -- native currency of market_native
  source        TEXT,                         -- 'pricecharting' (sealed) | 'catalog' (singles)
  captured_on   DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')::date,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT price_snapshots_day_unique UNIQUE (subject_id, language, condition, captured_on)
);

-- Series read: WHERE subject_id/language/condition ORDER BY captured_on.
CREATE INDEX IF NOT EXISTS idx_price_snapshots_series
  ON public.price_snapshots (subject_id, language, condition, captured_on);

ALTER TABLE public.price_snapshots ENABLE ROW LEVEL SECURITY;

-- Public catalog read, mirroring sealed_products / market_values (prices are public).
-- No INSERT/UPDATE/DELETE policy => writes happen only via the service-role cron,
-- which bypasses RLS.
DROP POLICY IF EXISTS "Price snapshots are viewable by everyone" ON public.price_snapshots;
CREATE POLICY "Price snapshots are viewable by everyone"
  ON public.price_snapshots FOR SELECT
  USING (true);
