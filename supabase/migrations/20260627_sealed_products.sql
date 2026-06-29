-- Sealed products catalog (PriceCharting-sourced).
--
-- Booster boxes, Elite Trainer Boxes, packs, bundles, etc. live here rather than
-- in pokemon_cards so the single-card catalog stays clean (no rarity / collector
-- number / pHash / language-disambiguation plumbing applies to sealed). Prices
-- come from PriceCharting (Legendary plan) via scripts/ingest/pricecharting.mjs.
--
-- Stored in USD (matching market_values.currency='USD'); the app converts to THB
-- at display time via constants.EXCHANGE_RATES, same as the graded-prices route.
--
-- set_id is a plain TEXT link to pokemon_sets.id when the PriceCharting console
-- name resolves to one of our sets; it is intentionally NOT a FK because many
-- PriceCharting products (cross-set bundles, region variants) have no exact set
-- row, and we still want to list them.

CREATE TABLE IF NOT EXISTS sealed_products (
  id               TEXT PRIMARY KEY,            -- pc-<pricechartingId>
  game             TEXT NOT NULL,               -- pokemon | mtg | yugioh | onepiece | lorcana | riftbound
  language         TEXT NOT NULL DEFAULT 'en',  -- en | jp
  set_id           TEXT,                        -- pokemon_sets.id when resolvable (no FK; may be NULL)
  name             TEXT NOT NULL,               -- "Booster Box", "Elite Trainer Box", ...
  product_type     TEXT,                        -- booster_box | etb | booster_pack | bundle | collection | other
  image_url        TEXT,
  pricecharting_id TEXT,
  console_name     TEXT,                        -- PriceCharting console-name, for traceability / re-match
  loose_price      NUMERIC,                     -- USD (opened / used)
  cib_price        NUMERIC,                     -- USD (complete)
  new_price        NUMERIC,                     -- USD (factory sealed = headline)
  currency         TEXT NOT NULL DEFAULT 'USD',
  last_updated     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sealed_products_game_set  ON sealed_products (game, set_id);
CREATE INDEX IF NOT EXISTS idx_sealed_products_game_lang ON sealed_products (game, language);
CREATE INDEX IF NOT EXISTS idx_sealed_products_pc        ON sealed_products (pricecharting_id);

-- Card -> PriceCharting product id resolution, captured the first time the ingest
-- matches a card. Lets the weekly refresh (and any re-run) re-fetch graded prices
-- by id instead of re-running the fuzzy name/number match across the whole catalog.
-- market_values has no place for the id, so it lives here.
CREATE TABLE IF NOT EXISTS pricecharting_map (
  card_id          TEXT PRIMARY KEY,       -- pokemon_cards.id
  pricecharting_id TEXT NOT NULL,
  game             TEXT,
  console_name     TEXT,
  matched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_priced_at   TIMESTAMPTZ             -- last successful graded refresh, for stale-first ordering
);

CREATE INDEX IF NOT EXISTS idx_pricecharting_map_stale ON pricecharting_map (last_priced_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_pricecharting_map_game  ON pricecharting_map (game);

-- Public catalog read, mirroring pokemon_cards/pokemon_sets. No INSERT/UPDATE/DELETE
-- policy => writes are blocked for authenticated users and allowed only for the
-- service-role client (which bypasses RLS), used by the ingest + cron.
ALTER TABLE sealed_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sealed products are viewable by everyone" ON sealed_products;
CREATE POLICY "Sealed products are viewable by everyone"
  ON sealed_products FOR SELECT
  USING (true);

ALTER TABLE pricecharting_map ENABLE ROW LEVEL SECURITY;
-- No policies => readable/writable only by the service-role client (ingest + cron).
