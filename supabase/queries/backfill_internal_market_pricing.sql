-- Feature B backfill (run in the Supabase SQL Editor, AFTER 20260707_internal_market_pricing.sql).
--
-- Seeds market_value_sales from past realized orders, then runs the first recompute for
-- every seeded key. Idempotent via market_value_sales.order_id UNIQUE — safe to re-run.
-- Only run this once you intend to switch internal pricing on; the recompute in step 2
-- will materialize source='cardstreet' rows for keys that already cross threshold.
--
-- Sale amount = orders.total_amount (item price only — shipping is orders.shipping_fee).
-- Exchange rate 0.028 USD/THB (constants.tsx). Thai-sealed only (non-Thai sealed excluded).

-- ---------------------------------------------------------------------------
-- Step 0 (OPTIONAL dry-run): preview the seed set + derived condition/language
-- before writing anything. Eyeball graded strings ('PSA 10' etc.) and confirm no
-- non-Thai sealed rows slip through. Comment step 1 out and run this alone first.
-- ---------------------------------------------------------------------------
-- SELECT
--   o.id AS order_id, l.card_id,
--   COALESCE(NULLIF(l.card_data->>'language',''), pc.language, 'en') AS language_raw,
--   CASE
--     WHEN l.is_graded AND l.grading_company IS NOT NULL AND l.grade IS NOT NULL
--       THEN upper(l.grading_company) || ' ' ||
--            CASE WHEN l.grade = trunc(l.grade) THEN trunc(l.grade)::int::text
--                 ELSE l.grade::text END
--     WHEN l.condition = 'Sealed' THEN 'Sealed'
--     WHEN l.condition IS NULL OR btrim(l.condition) = ''
--          OR btrim(l.condition) IN ('Near Mint','Mint') THEN 'Raw_NM'
--     ELSE btrim(l.condition)
--   END AS condition,
--   (l.condition = 'Sealed') AS is_sealed,
--   o.total_amount
-- FROM public.orders o
-- JOIN public.listings l ON l.id = o.listing_id
-- LEFT JOIN public.pokemon_cards pc ON pc.id = l.card_id
-- WHERE o.status IN ('paid','label_generated','shipped','in_transit',
--                    'out_for_delivery','delivered','completed')
--   AND o.total_amount > 0
--   AND NOT (l.condition = 'Sealed'
--            AND COALESCE(NULLIF(l.card_data->>'language',''), pc.language, 'en') <> 'th');

-- ---------------------------------------------------------------------------
-- Step 1: Seed the audit table from historical orders JOIN listings.
-- ---------------------------------------------------------------------------
INSERT INTO public.market_value_sales
  (order_id, card_id, language, condition, game, is_sealed, sale_amount_thb, sale_amount_usd, sold_at)
SELECT
  o.id,
  l.card_id,
  COALESCE(NULLIF(l.card_data->>'language',''), pc.language, 'en'),   -- normalized below
  CASE
    WHEN l.is_graded AND l.grading_company IS NOT NULL AND l.grade IS NOT NULL
      THEN upper(l.grading_company) || ' ' ||
           CASE WHEN l.grade = trunc(l.grade) THEN trunc(l.grade)::int::text
                ELSE l.grade::text END
    WHEN l.condition = 'Sealed' THEN 'Sealed'
    -- Only Near Mint / Mint / unlabeled feed 'Raw_NM'; played conditions keep their
    -- own key so they never drag down the NM price (matches lib/internalPricing.ts).
    WHEN l.condition IS NULL OR btrim(l.condition) = ''
         OR btrim(l.condition) IN ('Near Mint','Mint') THEN 'Raw_NM'
    ELSE btrim(l.condition)
  END,
  COALESCE(l.card_data->>'game', 'pokemon'),
  (l.condition = 'Sealed'),
  o.total_amount,
  o.total_amount * 0.028,
  COALESCE(o.updated_at, o.created_at)
FROM public.orders o
JOIN public.listings l ON l.id = o.listing_id
LEFT JOIN public.pokemon_cards pc ON pc.id = l.card_id
WHERE o.status IN ('paid','label_generated','shipped','in_transit',
                   'out_for_delivery','delivered','completed')
  AND o.total_amount > 0
  AND NOT (l.condition = 'Sealed'
           AND COALESCE(NULLIF(l.card_data->>'language',''), pc.language, 'en') <> 'th')
ON CONFLICT (order_id) DO NOTHING;

-- Normalize 'ja' -> 'jp' to match the market_values language convention.
UPDATE public.market_value_sales SET language = 'jp' WHERE language = 'ja';

-- ---------------------------------------------------------------------------
-- Step 2: Run the first recompute for every seeded key.
-- ---------------------------------------------------------------------------
SELECT
  CASE WHEN is_sealed
    THEN public.recompute_thai_sealed_price(card_id)::text
    ELSE public.recompute_internal_price(card_id, language, condition)
  END AS result
FROM (
  SELECT DISTINCT card_id, language, condition, is_sealed
    FROM public.market_value_sales
) k;
