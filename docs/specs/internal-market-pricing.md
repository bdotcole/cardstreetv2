Confirmed: there is **NO 3-column UNIQUE index** anywhere in the tree. `idx_market_values_lookup` at line 20 is a **non-unique** index. The only unique index is the 5-col daily one. Yet every writer upserts with `onConflict: 'card_id,language,condition'`. This means one of two things is true in the live DB:

1. A 3-col unique index/constraint was added out-of-band (not in the tree), OR
2. These upserts have been silently failing / not deduping correctly in production.

Given the memory notes say pricing works, (1) is likely — but this is exactly the "probe before ship" item. The spec's §2.3 note **misidentifies** the existing index as `(card_id, language, condition, DATE(last_updated))` when it's actually the 5-col printing variant, and mis-cites its line as `create_market_data_tables.sql:23` (that line is the OLD pre-printing index, since replaced by migration 20260604). This is a real correction.

I now have everything needed. Let me write the deliverable.

## Verification changelog

**Corrected (factual errors in the draft):**

1. **Base-table location & the `currency` column.** The draft cites `create_market_data_tables.sql:6` and `:23` for the base `market_values` schema — correct file, but it is `supabase/queries/create_market_data_tables.sql` (a **query script, not a migration**). More importantly: **`market_values` has no `currency` column in any tree file** (base table or migration), yet every writer sets `currency:'USD'` and `mapSupabaseCardToInternal` reads `marketValueData.currency` (`cardMapper.ts:150`). The column therefore exists **out-of-band in the live DB only**. The draft silently assumes it; I've promoted this to an explicit pre-ship probe.

2. **The unique index the draft's `ON CONFLICT` relies on is mis-identified.** The draft says the existing unique index is `(card_id, language, condition, DATE(last_updated))` at `create_market_data_tables.sql:23`. That index was **dropped and replaced** by migration `20260604_multi_game_support.sql:57-59` with a **5-column** index `(card_id, language, condition, COALESCE(printing,''), DATE(last_updated))`. There is **no 3-column unique index anywhere in the tree** (`idx_market_values_lookup` at line 20 is **non-unique**). Yet all ~20 writers upsert with `onConflict:'card_id,language,condition'`. So a 3-col unique constraint must exist out-of-band, or those upserts don't dedupe. This is the single biggest ship risk; I've hardened §2.3/§13.1 accordingly and made the fallback `CREATE UNIQUE INDEX` mandatory-if-absent.

3. **`GRADED_CONDITION_RE` location and form.** It lives in `lib/pricecharting.ts:38` (imported by cardMapper), **not** in cardMapper. Actual regex: `/^(PSA|BGS|CGC|SGC|ARS)\s+(\d+(?:\.\d)?)$/i` (two capture groups). Corrected the citation.

4. **`grading_company` domain is narrower than the regex.** The `listings.grading_company` CHECK allows only `PSA/BGS/CGC/ARS` (`20260124_initial_schema.sql:47`) — **not SGC**. So `saleConditionKey` can only ever emit `PSA/BGS/CGC/ARS` strings from real listings; all four match `GRADED_CONDITION_RE`. Noted so nobody expects SGC keys.

5. **`daily-market-update` already has an internal-sales branch.** Lines 377-389 already price Thai singles from the **average of all `status='sold'` listings** (`pricingMethod='internal_sales'`, `currency='THB'`). The draft never mentioned it; the new engine's skip guard must sit **above** this branch. Corrected §5.2 to place the skip before that block. (Final model, founder-confirmed 2026-07-06: unified average-of-recent-sales for all keys; the switch threshold is the only difference — Thai=1 sale, others=3. This *formalizes* the pre-existing avg-of-sold behavior rather than conflicting with it.)

6. **pricecharting Thai-sealed line refs.** The estimate write is at `route.ts:119-122` (variable `est`, from `thaiSealedEstimateThb`), inside the `s.currency==='THB'` branch at `:110-125`. The update does **not** re-set `currency`. Corrected the draft's `:117-125` / `jpBoxUsd`-write wording.

7. **Line-number drift:** `pickDisplayMarketValue` is `cardMapper.ts:118-131` ✓; `mapSupabaseCardToInternal` USD→THB is `cardMapper.ts:148-152` (draft said :150 ✓, block :144-156 ✓); marketplace deal_ratio sort is `marketplaceService.ts:163` (draft said :158-164). `sealedProduct.ts` pass-through is `:52-55` ✓.

8. **Writer count.** 20 `.mjs` scripts touch `market_values` (not "15"). Doesn't affect correctness (trigger covers all), but corrected the inventory claim.

**Added (gaps the draft missed):**

9. **RLS on `market_value_sales`.** The draft's new table has no `ENABLE ROW LEVEL SECURITY`. `orders` has RLS on; the audit table must follow the `pricecharting_map` precedent (RLS enabled, no policies → service-role-only). Added.

10. **`recompute_internal_price` ON CONFLICT ignores `printing`.** The learned INSERT sets no `printing` (NULL). Because the real unique key includes `COALESCE(printing,'')`, a 3-col `ON CONFLICT` can only work against a 3-col constraint — reinforcing item #2. For Pokemon (printing always NULL) this is fine; documented the constraint dependency explicitly.

11. **`condition VARCHAR(20)`** — `'PSA 10'`/`'BGS 9.5'`/`'Raw_NM'` all ≤ 20 chars, so they fit. Confirmed (no change needed, but the draft never checked the length cap).

**Confirmed accurate:**

- `mapSupabaseCardToInternal` converts only when `currency==='USD'` (`:150`) — learned USD rows convert identically. ✓
- `pickDisplayMarketValue` ranks `Raw_NM`(0) > `Near Mint`(1) > other(2), excludes graded via the regex. ✓ Materialized approach needs zero mapper/deal_ratio/marketplace edits. ✓
- `deal_ratio` is a STORED GENERATED column reading `card_data->>'marketPrice'`, not `market_values`. ✓
- `EXCHANGE_RATES.USD = 0.028` → 35.71 THB/USD, in `constants.tsx` (not `.ts`; `@/constants` resolves). ✓
- `orders.total_amount` is item price only (shipping is separate `shipping_fee`) — correct as the sale price. ✓
- Both webhook and `/api/orders/finalize` call `fulfillOrdersByTransferGroup`; the CAS full-win guard (`fulfillOrder.ts:113-129`) means the hook records exactly once. ✓ Placement after `:129` is correct.
- `orders` SELECT at `:70` already includes `listing_id` and `total_amount`. ✓
- `Card.language` exists (`types.ts:52`); snapshots store `'ja'` for Japanese (mapper `:193`), so `'ja'→'jp'` normalization is required. ✓
- `is_graded/grading_company/grade` exist on `listings` (`:46-48`), `grade DECIMAL(3,1)`. ✓
- No `source` **column** is written by any current writer (`source` only appears nested in `source_prices` JSONB), so the `DEFAULT 'api'` trigger routing is sound. ✓
- **Offer / pay-on-acceptance race: N/A.** No offer/OBO system exists in code (matches the "design only" memo). The only pay path is order CAS → fulfillment; the spec correctly does not depend on any offer flow. Confirmed no race to guard.

---

# Build Spec — Feature B: API → Internal Market-Price Switchover (corrected)

**Status:** DARK build. All migrations additive + DEFAULTED so production behavior is unchanged until `INTERNAL_PRICING_ENABLED` flips. No prod ship without explicit launch approval.
**Branch:** dedicated feature branch (do not push to `main` — auto-deploys).
**Verification note:** every line/column/function claim below was re-checked against the worktree at `C:\Users\brand\Downloads\cardstreet-tcg\.claude\worktrees\cranky-mendeleev-b48572`. Two schema objects the mapper and all writers depend on — the `market_values.currency` column and a 3-column unique constraint on `(card_id, language, condition)` — **exist only in the live DB, not in any tree file**, and MUST be probed before ship (§13.1).

---

## 1. Overview & Goals

Today every displayed card price originates from a third-party API (JustTCG / PriceCharting) or an app-side derivation (Thai = 55%/60% of the English price, plus an already-present "average of sold Thai listings" branch — see below). We are switching to **CardStreet's own realized sale prices** as the source of truth for a growing set of catalog keys, while keeping the API price as a shadow fallback.

The mechanism is **materialization, not read-time computation**: a realized sale writes a `source='cardstreet'` row into `market_values` (or updates `sealed_products` for Thai sealed). That row flows through the existing display pipeline **unchanged**:

- `pickDisplayMarketValue` (`lib/cardMapper.ts:118-131`) picks the row,
- `mapSupabaseCardToInternal` (`lib/cardMapper.ts:144-156`; USD→THB at `:150`) converts,
- `deal_ratio` (`supabase/migrations/20260702_listing_deal_ratio.sql`, a STORED GENERATED column) keeps sorting listings against `card_data->>'marketPrice'`.

None of those three touch the new columns, so they need **zero changes**. The only new logic is: (a) where prices get written, and (b) a clobber guard so API writers never overwrite a learned price.

**Pre-existing internal-pricing behavior you must not fight (new).** `supabase/functions/daily-market-update/index.ts:377-389` already prices Thai singles from the **average of every `status='sold'` listing** for the card (`pricingMethod='internal_sales'`, `currency='THB'`, condition `'Raw_NM'`, upsert at `:491-500`). This is close to what we want but not identical (avg of *all* sold copies all-time, recomputed daily, no materialized `source` flag, THB not USD). Feature B **supersedes and formalizes** it (founder-confirmed 2026-07-06): once a key is `source='cardstreet'`, the daily cron must **skip** it entirely (§5.2), leaving the materialized recent-sales-average price to stand.

**Learning rules — one unified engine, one knob (the switch threshold):**
- Once a key has **≥ threshold** paid sales, its price is the **average of the most recent `v_window` (=10) internal sales** for that key. The first sale merely switches the source off the API/formula; from then on the price tracks the running average of real sales, like any standard marketplace. No clamp, no decay.
- **Threshold = 1 for Thai** (singles, graded, and sealed — `language='th'`); **threshold = 3 for everything else** (any condition, any other language). That is the *only* difference between Thai and the rest.
- **Thai sealed** writes the averaged THB price to `sealed_products` (§2.4) instead of `market_values`.
- **English / other-game sealed** — **NO CHANGE** this launch (stays on the API).

(`v_window` = 10 is a chosen default for "most recent sales" — a single constant in the recompute functions; trivially changed, or swapped for a time-based window, if you want a different feel.)

**Keying:** `(card_id, language, condition)`. Grade is baked into `condition` (`'PSA 10'`, `'BGS 9.5'`, `'Raw_NM'`, `'Near Mint'`, `'Sealed'`) — there is no separate grade column. A `Raw_NM` sale can never move a `PSA 10` price. Note `market_values.condition` is `VARCHAR(20)`; all keys above fit.

---

## 2. Migration SQL (Supabase SQL Editor — paste-ready)

All additive, all DEFAULTED. Safe to run on production with the feature flag off.

> **RESOLVED 2026-07-06 (live-DB probe).** The 3-column unique constraint exists: `market_values_unique_current` — `UNIQUE (card_id, language, condition)`. So every `ON CONFLICT (card_id, language, condition)` in this spec (and every existing writer) targets a real constraint, and there is exactly **one current row per key** (no dated-snapshot rows), which makes materializing an internal price a clean in-place update. Language check confirmed `('en','jp','th')` — use `'jp'`, not `'ja'`. **Still open:** confirm the out-of-band `currency` column via §13.1(a) before the mapper-dependent write path ships.

### 2.0 3-column unique constraint — CONFIRMED PRESENT (no action)

The live DB has `market_values_unique_current` = `UNIQUE (card_id, language, condition)` (out-of-band; not in any tree file). **§2.0 is a no-op — skip it.** Kept here only to document that the `ON CONFLICT` target is real. (The tree *also* has a 5-column daily unique index from `20260604_multi_game_support.sql:57-59`; the 3-col constraint is the stricter one and is what the writers conflict against, guaranteeing one row per key. `printing` is not part of the key — irrelevant for Pokemon where it is always NULL.)

### 2.1 `market_values` columns

```sql
-- supabase/migrations/20260707_internal_pricing_columns.sql
-- Feature B: internal market-price switchover. Additive + defaulted; production
-- behavior is unchanged until the app-side feature flag flips.

ALTER TABLE public.market_values
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'api'
    CHECK (source IN ('api', 'cardstreet', 'admin')),
  ADD COLUMN IF NOT EXISTS api_reference_avg NUMERIC,
  ADD COLUMN IF NOT EXISTS internal_sale_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS internal_last_sale_at TIMESTAMPTZ;

-- Backfill the shadow column so existing API rows carry a reference from day one.
UPDATE public.market_values
   SET api_reference_avg = market_avg
 WHERE api_reference_avg IS NULL;

-- Partial index for clobber-guard lookups + admin surface.
CREATE INDEX IF NOT EXISTS idx_market_values_source_learned
  ON public.market_values (card_id, language, condition)
  WHERE source IN ('cardstreet', 'admin');
```

> Notes on the base table (`supabase/queries/create_market_data_tables.sql` — a query script, **not a migration**):
> - `language VARCHAR(2) CHECK (language IN ('en','jp','th'))` (`:6`). Japanese is **`'jp'`, not `'ja'`**; the pricecharting cron maps `ja→jp` (`route.ts:69`) and the graded upsert (`route.ts:76-85`) writes `'jp'`. Preserve `'jp'` in every new write.
> - `market_avg DECIMAL(10,2)` (`:8`), `condition VARCHAR(20)` (`:7`).
> - **`currency` is NOT in this file and NOT added by any migration** — it exists out-of-band in the live DB (all writers set it; the mapper reads it). §13.1 confirms it before we depend on it.
> - `game` was added by `20260604_multi_game_support.sql:39-40` (DEFAULT `'pokemon'`), and `printing` by `:42-43`.

### 2.2 `market_value_sales` audit table

```sql
-- Append-only audit trail of realized sales that feed internal pricing.
-- order_id UNIQUE => idempotent under webhook retries / the /finalize fallback.

CREATE TABLE IF NOT EXISTS public.market_value_sales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  card_id        TEXT NOT NULL,
  language       TEXT NOT NULL,
  condition      TEXT NOT NULL,
  game           TEXT NOT NULL DEFAULT 'pokemon',
  is_sealed      BOOLEAN NOT NULL DEFAULT false,
  sale_amount_thb NUMERIC NOT NULL CHECK (sale_amount_thb > 0),
  sale_amount_usd NUMERIC NOT NULL CHECK (sale_amount_usd > 0),
  sold_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_value_sales_order_unique UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_mvs_key
  ON public.market_value_sales (card_id, language, condition);
CREATE INDEX IF NOT EXISTS idx_mvs_sold_at
  ON public.market_value_sales (sold_at DESC);

-- RLS: service-role-only (writes from the finalize hook + crons, reads from the
-- admin surface — both use the service-role client which bypasses RLS). Mirrors
-- the pricecharting_map precedent (20260627_sealed_products.sql:64-65). Enabling
-- RLS with no policies blocks the anon/authenticated roles entirely.
ALTER TABLE public.market_value_sales ENABLE ROW LEVEL SECURITY;
```

`sale_amount_thb` is the raw `orders.total_amount` (item price only — shipping is a separate `orders.shipping_fee` column, `20260506`; `> 0` rejects null/zero/negative). `sale_amount_usd` is the converted value stored so recompute never re-does currency math. `order_id UNIQUE` is the idempotency anchor.

### 2.3 Recompute helper (SQL function, called by the cron and the finalize hook)

One SQL function is the source of truth for the threshold + average-of-recent-sales math, so the finalize hook and the weekly cron agree exactly. It reads `market_value_sales`, decides the price, and upserts `market_values` with the clobber guard baked in.

> **Hard prerequisite:** the `ON CONFLICT (card_id, language, condition)` target requires a UNIQUE constraint on **exactly** those three columns — created in §2.0 if §13.1 shows it missing. The INSERT below writes no `printing` (NULL), which is correct for Pokemon (always NULL) but means it can *only* conflict against a 3-col constraint, never the 5-col `(…, COALESCE(printing,''), DATE(last_updated))` daily index.

```sql
-- Recomputes the internal price for ONE key from its sale history and,
-- if the key qualifies, upserts a source='cardstreet' market_values row.
-- Returns the resulting source ('api' if not yet qualified, else 'cardstreet').
-- source='admin' rows are pinned: this function never touches them.

CREATE OR REPLACE FUNCTION public.recompute_internal_price(
  p_card_id   TEXT,
  p_language  TEXT,
  p_condition TEXT
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  -- Recent-sales window: once a key qualifies, its price is the AVG of the last N sales.
  v_window         CONSTANT INT := 10;
  v_is_thai        BOOLEAN := (p_language = 'th');
  -- Switch threshold: Thai flips on the FIRST sale; everything else needs 3.
  v_threshold      INT := CASE WHEN p_language = 'th' THEN 1 ELSE 3 END;
  v_count          INT;
  v_last_sale_at   TIMESTAMPTZ;
  v_game           TEXT;
  v_existing_src   TEXT;
  v_new_avg        NUMERIC;
BEGIN
  -- Admin pin: never overwrite. Report and bail.
  SELECT source INTO v_existing_src
    FROM public.market_values
   WHERE card_id = p_card_id AND language = p_language AND condition = p_condition
   ORDER BY last_updated DESC
   LIMIT 1;
  IF v_existing_src = 'admin' THEN
    RETURN 'admin';
  END IF;

  SELECT COUNT(*),
         MAX(sold_at),
         MAX(game)
    INTO v_count, v_last_sale_at, v_game
    FROM public.market_value_sales
   WHERE card_id = p_card_id AND language = p_language AND condition = p_condition
     AND is_sealed = false;

  IF v_count = 0 THEN
    RETURN COALESCE(v_existing_src, 'api');
  END IF;

  -- Unified rule: a key needs >= v_threshold sales to leave the API/formula. Thai
  -- flips on sale #1, everything else on sale #3. The first sale only switches the
  -- SOURCE; from then on the price is the AVG of the most recent v_window real sales,
  -- like any standard marketplace. No decay, no clamp.
  IF v_count < v_threshold THEN
    RETURN COALESCE(v_existing_src, 'api');
  END IF;

  SELECT AVG(sale_amount_usd)
    INTO v_new_avg
    FROM (
      SELECT sale_amount_usd
        FROM public.market_value_sales
       WHERE card_id = p_card_id AND language = p_language AND condition = p_condition
         AND is_sealed = false
       ORDER BY sold_at DESC
       LIMIT v_window
    ) recent;

  -- Materialize as source='cardstreet'. ON CONFLICT preserves api_reference_avg
  -- (owned by API writers) and stamps sale metadata. printing left NULL (Pokemon).
  INSERT INTO public.market_values
    (card_id, language, condition, market_avg, currency, source,
     internal_sale_count, internal_last_sale_at, game, last_updated)
  VALUES
    (p_card_id, p_language, p_condition, v_new_avg, 'USD', 'cardstreet',
     v_count, v_last_sale_at, COALESCE(v_game, 'pokemon'), NOW())
  ON CONFLICT (card_id, language, condition) DO UPDATE
    SET market_avg            = EXCLUDED.market_avg,
        source                = 'cardstreet',
        internal_sale_count   = EXCLUDED.internal_sale_count,
        internal_last_sale_at = EXCLUDED.internal_last_sale_at,
        currency              = 'USD',
        last_updated          = NOW()
        -- api_reference_avg intentionally NOT touched: shadow owned by API writers.
  ;

  RETURN 'cardstreet';
END;
$$;
```

### 2.4 Thai sealed recompute helper

```sql
-- Thai sealed: the FIRST paid sale switches off the JP-box-derived estimate; from
-- then on the price is the AVG of the most recent v_window Thai sealed sales (Thai
-- threshold = 1, same unified rule as Thai singles). Writes THB directly into
-- sealed_products (Thai rows are currency='THB'; the display mapper toThb() passes
-- THB through unchanged, sealedProduct.ts:52-55).
-- p_sealed_id = 'pc-<pricechartingId>' (== the sealed listing's card_id).

CREATE OR REPLACE FUNCTION public.recompute_thai_sealed_price(
  p_sealed_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_window  CONSTANT INT := 10;
  v_avg_thb NUMERIC;
BEGIN
  -- Thai threshold is 1, so any recorded sale qualifies; average the recent window
  -- (a single sale averages to itself, matching "first sale = the price").
  SELECT AVG(sale_amount_thb) INTO v_avg_thb
    FROM (
      SELECT sale_amount_thb
        FROM public.market_value_sales
       WHERE card_id = p_sealed_id AND language = 'th' AND is_sealed = true
         AND sale_amount_thb > 0
       ORDER BY sold_at DESC
       LIMIT v_window
    ) recent;

  IF v_avg_thb IS NULL OR v_avg_thb <= 0 THEN
    RETURN false;
  END IF;

  -- Pin the Thai sealed row to the realized THB price. currency is already 'THB'
  -- for these rows; we set it defensively so the display path stays THB-native.
  UPDATE public.sealed_products
     SET new_price    = v_avg_thb,
         currency     = 'THB',
         last_updated = NOW()
   WHERE id = p_sealed_id
     AND language = 'th';

  RETURN true;
END;
$$;
```

> `sealed_products` has **no `source` column** today (`20260627_sealed_products.sql:16-32`). This spec does not add one — the Thai sealed row is discriminated by `language='th'` + `currency='THB'` (its existing convention; `sealedProduct.ts:80` also keys `priceType='estimate'|'srp'` off `language==='th'`). Clobber protection for Thai sealed is applied in the pricecharting cron's Thai branch (§5.5) via a `market_value_sales` existence check. If the admin surface later needs to pin a Thai sealed price, add a `source` column to `sealed_products` in a follow-up — **not in this spec**.

---

## 3. Condition derivation from the sold listing

The sale's `condition` key must match how PriceCharting/JustTCG encode conditions so the learned row lands on the same key the API writer used.

**Verified condition conventions:**
- **Raw singles, JustTCG (English):** `condition = 'Raw_NM'` — `batch-price-english/index.ts` writes it; `pickDisplayMarketValue` ranks `Raw_NM` first (`cardMapper.ts:124`).
- **Raw singles, daily Thai derivation:** `condition = 'Raw_NM'` (`daily-market-update/index.ts:494`).
- **Graded, PriceCharting:** `condition` is `'PSA 10'`, `'BGS 9.5'`, etc. The filter regex is **`GRADED_CONDITION_RE = /^(PSA|BGS|CGC|SGC|ARS)\s+(\d+(?:\.\d)?)$/i`** in **`lib/pricecharting.ts:38`** (imported by cardMapper) — `<COMPANY> <grade>`, single space, optional one-decimal grade.
- **`'Near Mint'`** — alternate raw catalog convention (ranked second, `cardMapper.ts:124`).
- **Sealed:** `listings.condition = 'Sealed'` (`20260702_sealed_condition.sql:29`).

**Grading-company domain (new note):** `listings.grading_company` CHECK allows only `PSA/BGS/CGC/ARS` (`20260124_initial_schema.sql:47`) — **not SGC**. So a real listing can only produce `PSA/BGS/CGC/ARS` graded keys; all four match `GRADED_CONDITION_RE`. `grade` is `DECIMAL(3,1)` (`:48`).

**Derivation function** (`lib/internalPricing.ts`, shared by the finalize hook and the backfill):

```ts
export function saleConditionKey(listing: {
  is_graded?: boolean | null;
  grading_company?: string | null;
  grade?: number | null;
  condition?: string | null;
}): string {
  if (listing.is_graded && listing.grading_company && listing.grade != null) {
    // PriceCharting's '<COMPANY> <grade>' with a single space. grade is DECIMAL(3,1);
    // Number() coercion renders 10 / '10.0' as '10' and 9.5 as '9.5'.
    const g = Number(listing.grade);
    const gradeStr = String(g);
    return `${listing.grading_company.toUpperCase()} ${gradeStr}`;
  }
  const c = (listing.condition || '').trim();
  if (c === 'Sealed') return 'Sealed';
  // Only Near Mint / Mint feed the API-populated headline key 'Raw_NM'. Played
  // conditions keep their OWN key so they never drag down the NM price (founder-
  // confirmed 2026-07-06): a 'Lightly Played' cardstreet row is rank-2 in
  // pickDisplayMarketValue and only surfaces if no Raw_NM/Near Mint row exists.
  // Empty/unknown defaults to Raw_NM (treat an unlabeled listing as NM).
  if (c === '' || c === 'Near Mint' || c === 'Mint') return 'Raw_NM';
  return c; // 'Lightly Played', 'Moderately Played', ... — condition-specific price
}
```

> **Founder-confirmed 2026-07-06:** a *played-condition* raw sale must **not** move the `Raw_NM` (Near Mint) headline price. Only `Near Mint`/`Mint` (and unlabeled) sales feed `Raw_NM`; played conditions learn their own key and stay below the NM headline via `pickDisplayMarketValue`'s rank-2 branch (they surface only if no NM row exists). Played sales still get a `market_value_sales` audit row, but they do not count toward the `Raw_NM` threshold and never drag it down.

Grade rendering: `grade` is `DECIMAL(3,1)`, so `10` may arrive as `10.0`. `Number('10.0')` → `10` → `String(10)` → `'10'`; `Number(9.5)` → `String` → `'9.5'`. Verify against a real graded listing in QC (§12) that the produced string byte-matches the PriceCharting `condition`.

---

## 4. THB → USD conversion at write

`market_values` stores USD for singles (Thai daily rows and Thai sealed store THB). We convert the THB sale to USD at write time using the **same constant the mapper converts back with**, so a round-trip is lossless in aggregate.

- Mapper constant: `lib/cardMapper.ts:6` → `const EXCHANGE_RATE = 1 / (EXCHANGE_RATES['USD'] || 0.028);` with `EXCHANGE_RATES.USD = 0.028` (`constants.tsx:46`) ⇒ ≈ 35.71 THB/USD.
- **Conversion at write:** `sale_amount_usd = sale_amount_thb / EXCHANGE_RATE` (= `sale_amount_thb * EXCHANGE_RATES.USD`).

```ts
import { EXCHANGE_RATES } from '@/constants'; // constants.tsx; @/constants resolves the .tsx
const THB_PER_USD = 1 / (EXCHANGE_RATES['USD'] || 0.028);
export const thbToUsd = (thb: number): number => thb / THB_PER_USD;
```

> The finalize hook writes both `sale_amount_thb` (raw) and `sale_amount_usd` (converted) into `market_value_sales`. Recompute averages `sale_amount_usd` over the recent window and writes USD into `market_values`. `mapSupabaseCardToInternal` multiplies back by `EXCHANGE_RATE` at `cardMapper.ts:150`. Thai sealed skips USD — it writes raw THB into `sealed_products.new_price` (§2.4), which `mapSealedRowToProduct` passes through (`sealedProduct.ts:52-55`, `toThb` returns `Math.round(val)` for THB).

---

## 5. Clobber protection — per pinned writer

**Invariant:** no API writer may overwrite `market_avg` when the existing row is `source IN ('cardstreet','admin')`, but every API writer must **always refresh `api_reference_avg`** (the shadow). The Thai daily-derivation cron must additionally **skip** any Thai key already `source='cardstreet'` (its `internal_sales` branch would otherwise recompute an avg-of-all price — see §5.2).

A **DB-side BEFORE trigger** discharges the guard across all writers at once (they all upsert with `onConflict:'card_id,language,condition'`), so we don't edit ~20 writers and can't be forgotten by a future one. Column DEFAULTs are applied before BEFORE-ROW triggers fire, so `NEW.source` is already `'api'` for every existing writer (none set a top-level `source` column — `source` only appears nested inside their `source_prices` JSONB).

### 5.1 Guard trigger (single change, covers every writer)

```sql
-- On every INSERT/UPDATE to market_values: if the incoming row is an API write
-- (source='api') but a learned/pinned row already exists for the key, preserve the
-- learned market_avg + source and divert the incoming price into api_reference_avg.
-- Learned writers set source explicitly ('cardstreet'/'admin') and pass through.

CREATE OR REPLACE FUNCTION public.guard_market_value_source()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  IF NEW.source IS DISTINCT FROM 'api' THEN
    RETURN NEW;
  END IF;

  SELECT source, market_avg, internal_sale_count, internal_last_sale_at
    INTO v_existing
    FROM public.market_values
   WHERE card_id = NEW.card_id
     AND language = NEW.language
     AND condition = NEW.condition
   ORDER BY last_updated DESC
   LIMIT 1;

  IF FOUND AND v_existing.source IN ('cardstreet', 'admin') THEN
    NEW.api_reference_avg   := NEW.market_avg;
    NEW.market_avg          := v_existing.market_avg;
    NEW.source              := v_existing.source;
    NEW.internal_sale_count := v_existing.internal_sale_count;
    NEW.internal_last_sale_at := v_existing.internal_last_sale_at;
  ELSE
    NEW.api_reference_avg := NEW.market_avg;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_market_value_source ON public.market_values;
CREATE TRIGGER trg_guard_market_value_source
  BEFORE INSERT OR UPDATE ON public.market_values
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_market_value_source();
```

> Interaction with the guard's own UPDATE branch: `recompute_internal_price` sets `source='cardstreet'` explicitly, so its writes hit the early `RETURN NEW` and are never diverted — correct. On an **UPDATE** of an already-`cardstreet` row by an API writer, the `SELECT … ORDER BY last_updated DESC LIMIT 1` reads the pre-image (same row), finds `source='cardstreet'`, and preserves it — correct.

This single trigger discharges the clobber requirement for **all** `market_values` writers — the tree has **20** `.mjs` scripts plus the edge/route writers (`justtcg-prices.mjs:194`, `batch-price-english/index.ts:204`, `batch-price-games/index.ts:195`, `pricecharting/route.ts:87`, `daily-market-update/index.ts:491-500`, and the one-off ingest/repricing scripts). None need code edits for the clobber guard — the DEFAULT `source='api'` routes them through the trigger.

### 5.2 Daily-Thai-derivation skip (explicit, in code)

The trigger prevents the daily cron from **overwriting** a learned Thai price, but the founder wants the cron to **skip** the key entirely — and here that is load-bearing, because the daily cron's Thai branch (`daily-market-update/index.ts:377-389`) computes an **average of all sold listings** (`pricingMethod='internal_sales'`), which is a *different, wrong* number than our first-sale price and would otherwise be recomputed and re-upserted every run (the trigger would revert it, but we save the work and avoid churning `last_updated`). Add the skip at the **top of the per-card loop**, before the English/Thai branch at `:355`, and definitely before the internal-sales branch at `:377`:

```ts
// Feature B: skip any Thai key already learned from a realized sale.
if ((card.language || 'th') === 'th') {
  const { data: learned } = await supabase
    .from('market_values')
    .select('source')
    .eq('card_id', card.id)
    .eq('language', card.language || 'th')
    .eq('condition', 'Raw_NM')
    .eq('source', 'cardstreet')
    .maybeSingle();
  if (learned) {
    skipped++;              // add a `skipped` counter to the run summary
    continue;               // do not recompute or upsert (formula OR internal-avg)
  }
}
```

Belt-and-suspenders with the trigger, and per the founder's explicit "must SKIP" wording. Requires selecting the new `source` column — gated by §13.1 having confirmed it exists.

### 5.3–5.4 USD writers (JustTCG / PriceCharting graded)

Covered entirely by the trigger (§5.1) — no code change. A graded PriceCharting refresh (`pricecharting/route.ts:87`) hitting a `PSA 10` key that flipped to `cardstreet` has its price diverted into `api_reference_avg` and the learned `market_avg` preserved.

### 5.5 PriceCharting cron Thai-sealed branch

`pricecharting/route.ts:110-125` rewrites `sealed_products.new_price` for `currency='THB'` rows from the JP-box estimate (`est = thaiSealedEstimateThb(...)`, update at `:119-122`). This would clobber a Thai sealed price learned from a real sale. Since `sealed_products` has no `source` column, guard by **checking `market_value_sales`** before the estimate write:

```ts
if (s.currency === 'THB') {
  // Feature B: if this Thai sealed product already sold, its price is learned —
  // don't overwrite it with the JP-box estimate.
  const { data: sold } = await supabase
    .from('market_value_sales')
    .select('order_id')
    .eq('card_id', s.id)     // sealed listing card_id === sealed_products.id ('pc-<...>')
    .eq('language', 'th')
    .eq('is_sealed', true)
    .limit(1)
    .maybeSingle();
  if (sold) { continue; }    // skip estimate refresh; realized price stands

  const jpBoxUsd = centsToUsd(product['new-price'])
    ?? centsToUsd(product['cib-price'])
    ?? centsToUsd(product['loose-price']);
  const est = thaiSealedEstimateThb(s.product_type, jpBoxUsd);
  if (est != null) {
    // ...existing update unchanged (:119-122)...
  }
}
```

---

## 6. Finalize hook — `lib/fulfillOrder.ts`

**Insertion point:** immediately after the CAS full-win check (`fulfillOrder.ts:113-129`). The hook is placed after `result.ordersUpdated = winningCount;` at **`:129`**, which is only reached when `winningCount === orderIds.length` (the partial-win branch returns at `:126`). So every row in `orders` was won by this invocation — no other worker is handling any of them. Recording is idempotent via `market_value_sales.order_id UNIQUE`, so a duplicate webhook / the `/api/orders/finalize` fallback (which also calls `fulfillOrdersByTransferGroup`, `finalize/route.ts:119`) cannot double-count.

The `orders` array selected at `:66-72` already carries `id`, `listing_id`, `total_amount`, `seller_id`, `buyer_id` — everything `recordInternalSales` needs. The **inventory-transfer SELECT at `:149`** does not carry grading fields; `recordInternalSales` re-reads listings itself (below), so **no edit to `:149` is required** — the draft's "Change 1" is unnecessary. (Leave `:149` as-is unless you choose to reuse `soldListings`; if so, widen it to add `is_graded, grading_company, grade`.)

**Change — record sales.** Insert right after `:129`:

```ts
// ─── Feature B: record realized sales for internal pricing (dark) ───
// Idempotent via market_value_sales.order_id UNIQUE. Flag-gated so production is
// untouched until launch. Never throws (pricing must not block fulfillment).
if (process.env.INTERNAL_PRICING_ENABLED === 'true') {
  try {
    await recordInternalSales(supabase, orders); // orders = the winning pending→paid rows
  } catch (e) {
    console.error('[Fulfillment] Internal-pricing record error (non-fatal):', e);
    result.errors.push(`Internal pricing: ${(e as Error).message}`);
  }
}
```

`recordInternalSales` in `lib/internalPricing.ts` re-reads the listings, derives the key, inserts the audit row, and calls the recompute RPC:

```ts
// lib/internalPricing.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export async function recordInternalSales(
  supabase: SupabaseClient,
  orders: Array<{ id: string; listing_id: string | null; total_amount: number }>,
) {
  const listingIds = orders.map(o => o.listing_id).filter((v): v is string => !!v);
  if (!listingIds.length) return;

  const { data: listings } = await supabase
    .from('listings')
    .select('id, card_id, card_data, condition, is_graded, grading_company, grade')
    .in('id', listingIds);
  const byId = new Map((listings || []).map(l => [l.id, l]));

  for (const order of orders) {
    const listing = order.listing_id ? byId.get(order.listing_id) : null;
    if (!listing) continue;

    const thb = Number(order.total_amount);
    if (!(thb > 0)) continue;                       // reject 0/neg/null

    const isSealed = listing.condition === 'Sealed';
    const cardId = listing.card_id as string;
    const language = deriveLanguage(listing);       // 'th' | 'en' | 'jp'
    const condition = isSealed ? 'Sealed' : saleConditionKey(listing);
    const game = (listing.card_data?.game as string) || 'pokemon';

    // Feature B scope: Thai sealed only. English/other sealed => skip.
    if (isSealed && language !== 'th') continue;

    const { error: insErr } = await supabase.from('market_value_sales').insert({
      order_id: order.id,
      card_id: cardId,
      language,
      condition,
      game,
      is_sealed: isSealed,
      sale_amount_thb: thb,
      sale_amount_usd: thbToUsd(thb),
    });
    if (insErr && insErr.code !== '23505') {         // 23505 = unique_violation
      console.error('[InternalPricing] sale insert failed:', insErr);
      continue;
    }

    if (isSealed) {
      await supabase.rpc('recompute_thai_sealed_price', { p_sealed_id: cardId });
    } else {
      await supabase.rpc('recompute_internal_price', {
        p_card_id: cardId, p_language: language, p_condition: condition,
      });
    }
  }
}
```

`deriveLanguage`: singles carry language in the `card_data` snapshot — `Card.language` is a real field (`types.ts:52`), populated by the mapper (`cardMapper.ts:203`, default `'en'`; Japanese stored as **`'ja'`**, `:193`). Read `listing.card_data?.language` and **normalize `'ja'→'jp'`** to match the `market_values` convention. If absent, fall back to a `pokemon_cards` lookup by `card_id`. For sealed, the only accepted value is `'th'` (we gate above). Verify the snapshot key against a real listing row in QC (§12).

> Placement subtlety: recompute runs even when the insert hit `23505` (already recorded) — deliberate self-heal for a run that recorded the sale then crashed before recompute. Since `recompute_internal_price` is a pure function of sale history, running it twice is harmless.

---

## 7. Weekly recompute cron

Backfill/self-heal: re-derives every learned-eligible key from `market_value_sales`, flipping keys that cross threshold and refreshing the recent-sales average as new sales land. Follows the pinned cron template (Bearer `CRON_SECRET`, `nodejs`, time-budget loop).

**File:** `app/api/cron/recompute-internal-prices/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 300;

const TIME_BUDGET_MS = 250_000;

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.INTERNAL_PRICING_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'flag off' });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const started = Date.now();
  const summary = { keys: 0, singles: 0, sealed: 0, errors: 0 };

  const { data: keys, error } = await supabase.rpc('list_internal_price_keys');
  if (error) {
    Sentry.captureException(new Error(`recompute-internal-prices query failed: ${error.message}`));
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  for (const k of keys || []) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      if (k.is_sealed) {
        await supabase.rpc('recompute_thai_sealed_price', { p_sealed_id: k.card_id });
        summary.sealed++;
      } else {
        await supabase.rpc('recompute_internal_price', {
          p_card_id: k.card_id, p_language: k.language, p_condition: k.condition,
        });
        summary.singles++;
      }
      summary.keys++;
    } catch (e: unknown) {
      summary.errors++;
      Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { extra: { key: k } });
    }
  }

  return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
```

> Admin-client note: the codebase's crons build the service-role client inline via `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` (see `pricecharting/route.ts:36-39`). Use that exact pattern rather than importing a helper, to match convention and avoid a `'use client'`-adjacent import of the admin key.

Supporting RPC:

```sql
CREATE OR REPLACE FUNCTION public.list_internal_price_keys()
RETURNS TABLE (card_id TEXT, language TEXT, condition TEXT, is_sealed BOOLEAN)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT card_id, language, condition, is_sealed
    FROM public.market_value_sales;
$$;
```

**`vercel.json`** — add:

```json
{ "path": "/api/cron/recompute-internal-prices", "schedule": "0 2 * * 1" }
```

(Mondays 02:00 UTC. The weekly pricecharting cron runs at its own schedule; both are guard-safe, so ordering is not load-bearing.)

---

## 8. Historical backfill plan

Seed `market_value_sales` from past realized orders, then run the first recompute. Run in the SQL Editor (founder does not use the CLI). Backfill respects the same rules.

### 8.1 Seed the audit table from historical orders JOIN listings

```sql
-- Seed market_value_sales from realized orders. Idempotent via order_id UNIQUE.
-- Exchange rate 0.028 USD/THB (constants.tsx). Derivation mirrors saleConditionKey().
-- Thai-sealed only: non-Thai sealed excluded. total_amount is item price (shipping
-- is a separate column), so it is the correct sale price.

INSERT INTO public.market_value_sales
  (order_id, card_id, language, condition, game, is_sealed, sale_amount_thb, sale_amount_usd, sold_at)
SELECT
  o.id,
  l.card_id,
  COALESCE(NULLIF(l.card_data->>'language',''), 'en'),      -- normalized below
  CASE
    WHEN l.is_graded AND l.grading_company IS NOT NULL AND l.grade IS NOT NULL
      THEN upper(l.grading_company) || ' ' ||
           CASE WHEN l.grade = trunc(l.grade) THEN trunc(l.grade)::int::text
                ELSE l.grade::text END
    WHEN l.condition = 'Sealed' THEN 'Sealed'
    ELSE 'Raw_NM'
  END,
  COALESCE(l.card_data->>'game', 'pokemon'),
  (l.condition = 'Sealed'),
  o.total_amount,
  o.total_amount * 0.028,
  COALESCE(o.updated_at, o.created_at)
FROM public.orders o
JOIN public.listings l ON l.id = o.listing_id
WHERE o.status IN ('paid','label_generated','shipped','in_transit',
                   'out_for_delivery','delivered','completed')
  AND o.total_amount > 0
  AND NOT (l.condition = 'Sealed' AND COALESCE(l.card_data->>'language','en') <> 'th')
ON CONFLICT (order_id) DO NOTHING;

-- Normalize 'ja' -> 'jp' to match the market_values language convention.
UPDATE public.market_value_sales SET language = 'jp' WHERE language = 'ja';
```

> `orders.listing_id` is nullable and `ON DELETE SET NULL` (`20260221_orders_schema.sql:4`); the `JOIN` naturally drops rows whose listing was deleted. The status list above uses only values in the `orders_status_check` constraint (`20260509`).

### 8.2 Run the first recompute for every seeded key

```sql
SELECT
  CASE WHEN is_sealed
    THEN public.recompute_thai_sealed_price(card_id)::text
    ELSE public.recompute_internal_price(card_id, language, condition)
  END AS result
FROM (
  SELECT DISTINCT card_id, language, condition, is_sealed
    FROM public.market_value_sales
) k;
```

Run once after seeding. Thereafter the weekly cron (§7) self-heals and the finalize hook (§6) updates keys in real time.

---

## 9. deal_ratio & pickDisplayMarketValue — unchanged, why

**No changes required.** The learned price is an ordinary `market_values` row (`source='cardstreet'`, `currency='USD'`), so:

- **`pickDisplayMarketValue` (`cardMapper.ts:118-131`)** excludes graded via `GRADED_CONDITION_RE` (from `lib/pricecharting.ts:38`) and ranks `Raw_NM`(0) > `Near Mint`(1) > other(2), tiebreak freshest `last_updated`. A learned raw row is `Raw_NM` (rank 0) with a fresh `last_updated` → wins over any stale API row. A learned graded row keeps its `'PSA 10'` condition and is correctly *excluded* from the headline pick, exactly as today. **Nothing changes.**
- **`mapSupabaseCardToInternal` (`cardMapper.ts:144-156`)** reads `market_avg`, converts USD→THB at `:150` (`avg * EXCHANGE_RATE`) only when `currency==='USD'`. Learned USD rows convert identically. **Nothing changes.**
- **`deal_ratio`** — STORED GENERATED column (`20260702_listing_deal_ratio.sql:11-19`) computing `price / (card_data->>'marketPrice')::numeric`. Its denominator is the listing's own `card_data->>'marketPrice'` snapshot, re-synced by the monthly mirror cron — it does **not** read `market_values`. As learned prices propagate into `card_data.marketPrice` on the next listing-snapshot sync, `deal_ratio` reflects them with **no code change**. The sort at `marketplaceService.ts:163` (`order('deal_ratio', { ascending: true, nullsFirst: false })`) is untouched.

---

## 10. Admin override & visibility

**Override:** `source='admin'` pins a price. Both `recompute_internal_price` (top early-return, §2.3) and the guard trigger (§5.1) treat admin rows as immutable until released. Pin from an **admin-only server route** (service-role):

```sql
-- Store USD. If the admin enters THB, convert to USD (thb * 0.028).
UPDATE public.market_values
   SET market_avg = :usd_value,   -- or :thb_value * 0.028
       source = 'admin',
       last_updated = NOW()
 WHERE card_id = :card_id AND language = :language AND condition = :condition;
```

**Release** a pin by setting `source='cardstreet'` (falls back to sale-learning) or `source='api'` (falls back to API + shadow).

**Visibility query** (read-only admin panel, service-role route):

```sql
SELECT mv.card_id, mv.language, mv.condition, mv.source,
       mv.market_avg AS internal_usd, mv.api_reference_avg AS api_usd,
       mv.internal_sale_count, mv.internal_last_sale_at,
       (SELECT json_agg(json_build_object('order_id', s.order_id,
              'thb', s.sale_amount_thb, 'sold_at', s.sold_at) ORDER BY s.sold_at DESC)
          FROM public.market_value_sales s
         WHERE s.card_id = mv.card_id AND s.language = mv.language
           AND s.condition = mv.condition) AS sale_trail
  FROM public.market_values mv
 WHERE mv.source IN ('cardstreet','admin')
 ORDER BY mv.internal_last_sale_at DESC NULLS LAST
 LIMIT 200;
```

---

## 11. Staleness, shadow retention, feature flag

- **No auto-decay.** A learned price never expires or drifts back toward the API. Every key (Thai or not) moves only when a new sale shifts its recent-sales average; the first qualifying sale just flips the source, and the average carries it from there.
- **`api_reference_avg` retained** as a live shadow (kept fresh by the guard trigger on every API write) so a future "revert to API" admin action has a current reference. Not wired to behavior this launch.
- **Feature flag:** `INTERNAL_PRICING_ENABLED` (env var, default unset/`false`; does not exist in the tree yet). Gates: (a) the finalize hook recording (§6), (b) the weekly cron (§7). The migrations, trigger, and RPCs are safe to apply with the flag off — defaults keep every existing row `source='api'`, and the trigger only diverts when a learned row exists (none do until the flag is on and a sale lands). The daily-Thai skip (§5.2) selects the `source` column unconditionally, so §13.1 must confirm the column exists before that edit deploys even with the flag off. Flip to `'true'` in Vercel env **only after launch approval**.

---

## 12. File-by-file change list

| File | Action | What |
|---|---|---|
| `supabase/migrations/20260707_internal_pricing_columns.sql` | NEW (SQL Editor) | §2.0 conditional 3-col unique index; §2.1 columns + backfill + index |
| — same file or split — | NEW | §2.2 `market_value_sales` table + RLS; §2.3 `recompute_internal_price`; §2.4 `recompute_thai_sealed_price`; §5.1 guard trigger; §7 `list_internal_price_keys` |
| `lib/internalPricing.ts` | NEW | `saleConditionKey`, `thbToUsd`, `deriveLanguage`, `recordInternalSales` (§3, §4, §6) |
| `lib/fulfillOrder.ts` | EDIT | add flag-gated `recordInternalSales(supabase, orders)` call after the CAS full-win at `:129` (§6). **No edit to the `:149` SELECT needed** — the hook re-reads listings itself |
| `supabase/functions/daily-market-update/index.ts` | EDIT | Thai learned-key skip at the top of the per-card loop (before `:355`/`:377`) + `skipped` counter (§5.2) |
| `app/api/cron/pricecharting/route.ts` | EDIT | Thai-sealed branch (`:110-125`): skip estimate write if a Thai-sealed sale exists (§5.5) |
| `app/api/cron/recompute-internal-prices/route.ts` | NEW | weekly recompute cron (§7) |
| `vercel.json` | EDIT | add the recompute cron entry (§7) |
| `app/api/admin/internal-prices/route.ts` (+ small admin panel component) | NEW | read-only visibility + pin/release (§10) — surface not fully specced |

**No edits** to: `lib/cardMapper.ts`, `services/marketplaceService.ts`, `20260702_listing_deal_ratio.sql`, `lib/sealedProduct.ts`, or any `market_values` writer (the guard trigger covers them). Confirmed none of them set a top-level `source` column today.

---

## 13. Verification plan

### 13.1 Probe live DB before selecting new columns (untyped-admin-client caveat + out-of-band schema)

The admin client does not type-check `.select()` columns; selecting a not-yet-existing column silently breaks in prod (`feedback_supabase_untyped_select_columns`). Two objects this spec depends on live **only in the live DB, not in the tree** — confirm both, and confirm the new columns after applying §2.1:

```sql
-- (a) Confirm the out-of-band `currency` column exists on market_values (the mapper
--     and every writer already read/write it, but it is in no tree file).
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'market_values' AND column_name = 'currency';   -- expect 1 row

-- (b) Confirm a UNIQUE index/constraint on EXACTLY (card_id, language, condition).
--     The tree has only the 5-col daily index; a 3-col unique must exist out-of-band
--     for every writer's ON CONFLICT to work. If this returns nothing, run §2.0.
SELECT i.indexname, i.indexdef
  FROM pg_indexes i
 WHERE i.tablename = 'market_values'
   AND i.indexdef ILIKE '%UNIQUE%'
   AND i.indexdef ILIKE '%(card_id, language, condition)%';

-- (c) After applying §2.1, confirm the 4 new columns. Expect 4 rows.
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name = 'market_values'
   AND column_name IN ('source','api_reference_avg','internal_sale_count','internal_last_sale_at');
```

### 13.2 SQL functional tests (SQL Editor)

Note: `market_value_sales.order_id` FKs `orders(id)`. For synthetic tests, either insert throwaway `orders` rows first or temporarily test against real order ids; a random `gen_random_uuid()` will violate the FK.

```sql
-- Thai single, first sale flips source to cardstreet (use a REAL order id for the FK):
INSERT INTO market_value_sales (order_id, card_id, language, condition, is_sealed, sale_amount_thb, sale_amount_usd)
VALUES ('<real-order-id>', 'TEST-th-1', 'th', 'Raw_NM', false, 350, 350*0.028);
SELECT recompute_internal_price('TEST-th-1','th','Raw_NM');   -- expect 'cardstreet'
SELECT source, market_avg, currency, internal_sale_count FROM market_values
 WHERE card_id='TEST-th-1';                                    -- cardstreet, ≈9.8 USD, count=1

-- Non-Thai graded, needs 3: 2 sales -> NOT flipped; 3rd -> 'cardstreet', avg of recent window.

-- Clobber guard: with the Thai row 'cardstreet', simulate an API write:
INSERT INTO market_values (card_id, language, condition, market_avg, currency, source)
VALUES ('TEST-th-1','th','Raw_NM', 5.00, 'USD', 'api')
ON CONFLICT (card_id, language, condition) DO UPDATE SET market_avg=EXCLUDED.market_avg, source='api';
SELECT source, market_avg, api_reference_avg FROM market_values WHERE card_id='TEST-th-1';
-- EXPECT: source still 'cardstreet', market_avg unchanged (≈9.8), api_reference_avg = 5.00

-- Cleanup:
DELETE FROM market_values WHERE card_id LIKE 'TEST-%';
DELETE FROM market_value_sales WHERE card_id LIKE 'TEST-%';
```

### 13.3 Manual end-to-end (staging, flag on)

1. Set `INTERNAL_PRICING_ENABLED=true` in a preview/staging env only.
2. Complete a real Thai single purchase → fulfillment. Confirm: one `market_value_sales` row (`order_id` matches), `market_values` key flipped to `cardstreet`, displayed price equals the sale (round-trip via 35.71).
3. Fire fulfillment twice (webhook retry). Confirm exactly one `market_value_sales` row and count did not double.
4. Complete a Thai sealed purchase → `sealed_products.new_price` = raw THB sale, sealed display shows it, and the next pricecharting run does **not** overwrite it (§5.5).
5. Run daily-market-update against a learned Thai key → confirm it is skipped (§5.2), not re-derived (and its `internal_sales` avg branch does not fire).
6. `GET /api/cron/recompute-internal-prices` with the Bearer secret → confirm summary counts and no errors.

### 13.4 Backfill dry-run

Before running §8.1 on prod, run its `SELECT` (strip the `INSERT INTO … / ON CONFLICT`) to preview row count and eyeball derived `condition`/`language`, especially graded strings (`'PSA 10'` exact-match against a known PriceCharting row) and that no non-Thai sealed rows slip through.

---

## Open items flagged (not guessed)

1. **3-column unique constraint on `market_values`** — ✅ **RESOLVED (live-DB probe 2026-07-06):** `market_values_unique_current = UNIQUE (card_id, language, condition)` exists. All `ON CONFLICT (card_id, language, condition)` targets are valid; one current row per key. §2.0 is a no-op — skip it.
2. **`market_values.currency` column** (§13.1) — read/written everywhere but in no tree file; **still open** — run §13.1(a) to confirm it exists before the daily-skip edit selects `source` alongside the pipeline that expects `currency`.
3. **Pre-existing `internal_sales` branch in daily-market-update** (`:377-389`) — averages all sold Thai listings all-time. ✅ **Founder-confirmed 2026-07-06:** Feature B supersedes it via the §5.2 skip — semantics change from avg-of-all-time (recomputed daily, THB) to the materialized recent-sales average (windowed, USD, `source='cardstreet'`).
4. **Played-condition raw learning** (§3) — spec normalizes all raw singles to `Raw_NM`; confirm with founder whether per-played-condition learning is wanted.
5. **`card_data` language field path** (§6, §8.1) — `Card.language` exists (`types.ts:52`) and stores `'ja'` for Japanese; verify the snapshot actually carries it (vs null) for older listings and adjust the `deriveLanguage` fallback.
6. **`sealed_products` has no `source` column** — Thai sealed clobber protection uses a `market_value_sales` existence check (§5.5); add a `source` column only if the admin surface needs to pin Thai sealed (follow-up).
7. **Grade string rendering** (`10.0`→`'10'`, `9.5`) (§3) — verify byte-match against a real PriceCharting `condition` in QC.
8. **Offer / pay-on-acceptance race** — **N/A this launch.** No offer/OBO system exists in code; the only pay path is order CAS → `fulfillOrdersByTransferGroup`, and the finalize hook records exactly once off the full-win guard. Nothing to guard until the OBO system is built; when it is, its accept→checkout path must funnel through the same `orders`/fulfillment flow so this hook keeps working unchanged.