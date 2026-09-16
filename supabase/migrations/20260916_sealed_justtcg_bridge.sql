-- Sealed products: bridge to JustTCG (TCGplayer market data) for REAL daily
-- price history.
--
-- PriceCharting (our sealed headline) has no history API and its sealed prices
-- move rarely, so every sealed "Price Over Time" chart was a near-flat line
-- built from daily snapshots of the same number. JustTCG indexes sealed
-- products (condition 'Sealed') with 180 days of daily TCGplayer market prices
-- and is looked up exactly by TCGplayer product id -- the id our TCGplayer-hosted
-- packshot URLs already carry (product-images.tcgplayer.com/.../<id>.jpg).
--
-- tcgplayer_id : the TCGplayer product id (stable bridge; survives the image
--                mirror, which replaces the URL the id was parsed from)
-- justtcg_id   : JustTCG card id for the sealed product, used by the daily
--                history merge in /api/cron/price-snapshots and by
--                scripts/ingest/justtcg-sealed-history.mjs.
--
-- Both nullable; everything reading them fails soft when the columns are absent.
ALTER TABLE public.sealed_products
  ADD COLUMN IF NOT EXISTS tcgplayer_id text,
  ADD COLUMN IF NOT EXISTS justtcg_id text;

CREATE INDEX IF NOT EXISTS idx_sealed_products_justtcg_id
  ON public.sealed_products (justtcg_id)
  WHERE justtcg_id IS NOT NULL;

COMMENT ON COLUMN public.sealed_products.tcgplayer_id IS 'TCGplayer product id (from the packshot URL); exact-match bridge to JustTCG';
COMMENT ON COLUMN public.sealed_products.justtcg_id IS 'JustTCG card id of this sealed product; drives the daily real-history merge';
