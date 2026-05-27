# CardStreet TCG — developer notes

Marketplace for trading-card games (primarily Pokémon TCG), serving the Thai market with English, Thai, and Japanese card catalogs. Web + Android (via Capacitor) + separate Expo companion app.

## Stack

- **Next.js 15 (App Router) + React 19 + TypeScript 5.8**
- **Supabase (Postgres 15)** — auth, storage, DB. RLS on most tables.
- **Capacitor 8 (Android only)** — wraps the Next.js web app into a native shell.
- **Stripe Connect (Express)** — checkout + seller payouts. Dual-platform (US + TH); currently TH-only. **Flash Express** — Thailand shipping fulfillment.
- **Gemini SDK (`@google/genai`)** — card scanning, search-intent resolution, market insights.
- **Tailwind v4 + Framer Motion + Recharts**
- **Sentry (`@sentry/nextjs`)** for error tracking.

## Repo layout

- `app/` — Next.js routes. `app/page.tsx` is the main shell (~1k lines).
- `components/` — React components.
- `services/` — Module-style services (`pokemonService`, `scannerService`, `marketplaceService`, `geminiService`).
- `lib/` — Pure utilities, contexts, hooks, Supabase clients, the dHash util, the card mapper.
- `supabase/migrations/` — Timestamped SQL migrations (`YYYYMMDD_short_description.sql`).
- `scripts/` — One-off Node scripts. `.mjs` for ESM with raw fs + supabase-js; `.ts` for tsx-runnable.
- `cardstreet-mobile/` — Separate Expo + React Native companion app. Hits the same `/api` endpoints via `EXPO_PUBLIC_API_URL`. No shared user-settings context yet.

## Supabase clients

- `lib/supabase/client.ts` — browser/client component use. Cookies via `@supabase/ssr`.
- `lib/supabase/server.ts` — server component / route use.
- `lib/supabase/admin.ts` — service-role. **Never expose to the browser** or import from a `'use client'` module.

## Card catalog

`pokemon_cards` holds all card data, keyed by `id` (e.g. `sv4pt5-234`). Approximate language distribution:

| Language | Rows | pHashed |
|----------|------|---------|
| en | ~19.8k | ~98% |
| th | ~6.6k | ~100% |
| ja | ~5.5k | ~57% (rest have no usable image URL upstream) |

Each row may have `image_large`, `image_small`, and `raw_data` (full original API response). Use **`lib/cardMapper.ts:mapSupabaseCardToInternal`** to normalize into the in-app `Card` type — it handles TCGdex URL fixups (`.png` suffix), price-currency conversion, Thai set-name aliases, and image fallbacks. Don't reinvent this in new code; import it.

## Scanning pipeline (`/api/scan`)

> **The route must run `nodejs` runtime, not Edge.** `sharp` is a native module.

Tier order. Each tier falls through to the next on failure:

1. **Set code + number → deterministic DB lookup**. `extractCardMetadata` sends two images (full card + bottom-strip crop) to **Gemini 2.5 Flash** with a structured-output prompt asking for `name`, `setCode`, `cardNumber`, `language`, `rarity`. When both `setCode` and `cardNumber` parse cleanly, deterministic lookup `WHERE set_id ILIKE :setCode AND number IN (:n, :n/...) AND language = :lang`. A Thai card printing `MA3 087/198` maps 1:1 to a Thai-language row. The OCR'd set code is split on whitespace first to strip the regional suffix Thai cards print (`"SV8s T"` → `"SV8s"`).
2. **Name + language → pHash disambiguator**. When the set code is unreadable but Flash got the name and language right. Look up `WHERE (name ILIKE :n OR english_name ILIKE :n) AND language = :lang`, optionally narrowed by number, then rank candidates by pHash distance. Ships only when the best print is within 14 bits.
3. **Language + number → pHash disambiguator**. The safety net. Diagnostics on Thai cards show Flash hits **100% on language and 100% on card number** even when the set-code OCR misreads `"8s"` as `"bs"`/`"B5"`/etc. Language + number narrows the catalog to <20 candidates, then pHash picks the right one. Ships when the best print is within 18 bits.
4. **pHash search** — language-filtered when known, retries unfiltered if zero matches.
5. **OCR text + Gemini Flash** — full-card text path when the device sent native MLKit OCR text.
6. **Image + Gemini Flash** — last LLM fallback.
7. **Google Lens via SerpApi** — final fallback. Slow (>5s).

Tiers 1-3 share a single Flash call and a single dHash compute, **run in parallel** with `Promise.all`. Wall clock ≈ max of the two legs (~4-8s, bounded by Flash).

**Why Flash, not Pro**: Pro 2.5 mandates thinking tokens that count against the output budget. On multi-field structured outputs this regularly causes truncation or 30 KB degenerate strings (one diagnostic card spent 185 s producing `"sv8s T H sv8s T H sv8s T..."`). Flash has no thinking, ~2-3× faster, ~30× cheaper, and *more reliable* on this specific task — 10/10 vs 4/10 on a 10-card sample. The Flash set-OCR shortfall (5/10) is fully absorbed by tier 3.

**Why set code is the kingpin signal when it does parse**: a printed set ID is a deterministic language tag and narrows the catalog from 32k cards to typically 1-5. `MA3` only exists for `language='th'`. `swsh3` only for `'en'`. No classifier guessing.

When native OCR text already contains the set code or Thai/Japanese script (cheap regex check via `parseMetadataFromOcrText`), the Pro call is skipped entirely.

The user's app locale is **not** a filter at any tier — it's only a tiebreaker when pHash distances are tied across regional prints. Multi-language collectors get correct results regardless of their UI language.

Relevant files: `services/scannerService.ts`, `lib/phash.ts`, `lib/cardMapper.ts`, `app/api/scan/route.ts`.

## Debugging the scanner

**Measure before iterating.** The scanning pipeline went through four rebuilds before I built a diagnostic; three of those rebuilds were wrong because I was guessing at root causes. A 30-minute diagnostic harness would have prevented all of them.

The pattern is in `scripts/test-scan-thai.mjs` (intentionally untracked — local-only). It:

1. Pulls N random rows from `pokemon_cards` in a given language.
2. Downloads each card's `image_large`.
3. Runs them through the same `extractCardMetadata` prompt the production code uses.
4. Reports per-field accuracy (lang/set/num/name) and latency.

Use it whenever you're tempted to change the model, the prompt, the bottom-crop ratio, or the tier order. **Don't ship scanner changes without running it.**

Production logs the structured output as `[ScannerService] Flash extraction: { name, setCode, cardNumber, language, confidence }` on every scan — search Vercel logs for that line when a user reports a misidentification, and you'll see exactly what the model saw.

The pipeline is intentionally redundant (3 lookup tiers off the same Flash call) so individual field failures don't tank the result. Don't remove a tier without checking the diagnostic against it first.

## Continuous capture (`components/WebLiveScanner.tsx`)

Auto-fires a scan when the camera frame is sharp + stable for 2 consecutive frames at 3fps:

- Laplacian variance > 120 → in focus
- Mean absolute per-pixel diff < 6 vs previous frame → stable

All checks run on a tiny 80×112 grayscale buffer (constants at top of file). If auto-capture fires too eagerly or never fires, those thresholds are the knobs.

The manual shutter button is retained as an override.

## Payments + Stripe Connect

CardStreet is a marketplace built on **Stripe Connect with Express accounts**. The codebase supports two Stripe platforms under one organization but is currently running TH-only.

### Why two platforms

Stripe Thailand does **not permit platform-loss-liable Connect accounts** — the platform cannot be merchant of record (MOR) for charges; the seller must be. This rules out the "separate charges and transfers" pattern on TH (platform charges buyer, transfers to seller). Stripe US allows that pattern via the `recipient` service agreement for TH-country connected accounts. To support both, the code branches on `stripe_region`:

| Region | Model | Seller capabilities | MOR | Cart shape |
|---|---|---|---|---|
| `th` (active) | Destination charges + `application_fee_amount` + manual payouts | `card_payments` + `transfers` | Seller | Single-seller only |
| `us` (dormant) | Separate charges and transfers + `recipient` agreement | `transfers` only | Platform | Multi-seller OK |

`profiles.stripe_region` and `orders.stripe_region` pin each entity to its platform — Express accounts can't move between platforms after creation, so the column is sticky.

### File map

- `lib/stripe.ts` — region-aware client factory. `getStripeForRegion('us'|'th')`, `isRegionConfigured`, `getWebhookSecretForRegion`, `defaultCurrencyForRegion`, `paymentMethodTypesForRegion`. Lazy-init so unset keys don't crash module load.
- `lib/stripeWebhook.ts` — shared webhook handler. Returns `410 Gone` if the region isn't configured; otherwise verifies the signature with the region's secret and dispatches on event type.
- `app/api/webhooks/stripe/route.ts` — US endpoint, thin shim over the shared handler.
- `app/api/webhooks/stripe/th/route.ts` — TH endpoint, same shim with `region='th'`.
- `app/api/stripe/connect/{start,status,dashboard}/route.ts` — onboarding + status routes, all region-aware. `start` self-heals stale `stripe_account_id` rows by creating a fresh account when Stripe returns `resource_missing`.
- `app/api/checkout/route.ts` — PaymentIntent creation. Region-branched (destination charge for TH, plain platform charge for US).
- `app/api/orders/checkout/route.ts` — order creation. Enforces single-seller carts on TH and rejects mixed-region carts everywhere.
- `app/api/orders/finalize/route.ts` — client-side webhook fallback; verifies the PaymentIntent on the correct platform.
- `supabase/functions/release-funds/index.ts` — hourly payout cron. On TH uses `stripe.payouts.create({...}, {stripeAccount: sellerId})` to push the seller's already-credited balance to their bank. On US uses `stripe.transfers.create` to move money out of the platform's balance.
- `supabase/migrations/20260515_stripe_region_dual_platform.sql` — adds `stripe_region` + `preferred_currency` columns + backfill.

### Env vars

```
STRIPE_SECRET_KEY_TH         # sk_live_... or sk_test_...
STRIPE_WEBHOOK_SECRET_TH     # whsec_... from the TH webhook endpoint
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY   # TH publishable pk_...

# Only needed if/when the US platform comes back online:
# STRIPE_SECRET_KEY
# STRIPE_WEBHOOK_SECRET
```

Each platform's webhook URL must be set in its respective Stripe Dashboard:
- TH: `https://cardstreet.app/api/webhooks/stripe/th`
- US: `https://cardstreet.app/api/webhooks/stripe`

Subscribed events for both: `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`.

### Seller onboarding (TH path)

`app/api/stripe/connect/start/route.ts` creates connected accounts with:
- `country: 'TH'`, `business_type: 'individual'`
- Capabilities: `card_payments` + `transfers` (both required — `card_payments` makes the seller capable of being MOR; `transfers` lets the platform take an application fee)
- `settings.payouts.schedule.interval = 'manual'` — funds accumulate in the seller's Stripe balance instead of auto-paying out, so `release-funds` is our explicit escrow gate
- Pre-filled `business_profile.{url, product_description, mcc=5945}` so individual sellers without a website don't get blocked on a required URL field in Stripe's hosted onboarding

**Self-heal**: if `accountLinks.create` (or any other Stripe call) returns `resource_missing` / `account_invalid` (stale account ID from a deleted account or rotated keys), the start route clears `stripe_account_id` + capability flags and creates a fresh account in the same request. No manual SQL cleanup needed for orphaned rows.

**Return URL hardening**: `return_url`/`refresh_url` default to `getAppBaseUrl()` (cardstreet.app), **not** the request host. Stripe's "Return to CardStreet" button then deep-links into the Capacitor app via Android App Links (autoVerify on `cardstreet.app` per `AndroidManifest.xml`). Client can override via `returnUrl`/`refreshUrl` in the body, validated against an allowlist (cardstreet.app, NEXT_PUBLIC_APP_URL host, localhost).

### Charges (TH path)

`/api/checkout` builds a PaymentIntent with:
- `transfer_data.destination: sellerAccountId`
- `on_behalf_of: sellerAccountId`
- `application_fee_amount: Σ orders.platform_fee` in satang

Funds settle directly into the seller's Stripe balance. The Stripe processing fee comes off the seller's balance (standard for destination charges). With manual payouts enabled, the seller can't withdraw until `release-funds` pushes the balance to their bank.

### Payouts

`release-funds` (Supabase Edge Function) finds orders where `status='delivered'`, `escrow_status='held'`, `funds_release_at <= NOW()`, `stripe_payout_id IS NULL`, and:

- TH: `stripe.payouts.create({...}, {stripeAccount: sellerId, idempotencyKey: 'payout_' + order.id})` — pushes the seller's balance to their bank.
- US: `stripe.transfers.create(...)` — moves money from the platform's balance to the seller's connected account, which then auto-pays-out on Stripe's default schedule.

Same `payout_${order.id}` idempotency key in both paths so a retry never double-charges.

### Cart constraints

- **Mixed-region carts**: rejected at `/api/orders/checkout` with 400 (a PaymentIntent on platform A can't transfer to an account on platform B).
- **Multi-seller carts on TH**: rejected at `/api/orders/checkout` with 400 (destination charges support exactly one destination per PaymentIntent). Multi-seller-as-N-charges is a future improvement.
- Both checks fire BEFORE any DB writes or listing reservations, so a rejected cart leaves no side effects to roll back.

## pHash backfill

`scripts/backfill-phashes.mjs` populates `pokemon_cards.phash` for every row with a usable image URL.

- Concurrent (default 8), idempotent, resumable.
- **Paginates by `id` cursor**, not `OFFSET`. Rows whose phash gets updated drop out of the `phash IS NULL` filter, so OFFSET would silently skip them; pure `LIMIT` without a cursor loops forever on skip-no-url rows.
- Re-run is safe: already-hashed rows are excluded by the filter.

Failures (~400) are cards with broken `image_large` URLs (mostly XY-era promos). Skips (~2.4k) are cards with no image URL in any field. Both classes need upstream catalog fixes, not script fixes.

## Applying migrations

**Don't use `supabase db push`.** The local migration history is desynced from the remote DB — `db push` would try to replay 27 already-applied migrations.

For a new migration, apply it directly via:

```bash
npx supabase db query --linked -f supabase/migrations/<file>.sql
```

For programmatic SQL via the service-role client, follow the pattern in `scripts/run_migration.ts`.

## Deploying

Vercel auto-deploys on push to `origin/main`.

**Local working tree usually has large unrelated WIP** (Android assets, env files, deleted routes). When shipping a focused change, deploy from a fresh worktree off `origin/main` rather than the local tree:

```bash
git fetch origin main
git worktree add ../cs-<name> origin/main
# Apply only the focused changes inside ../cs-<name>
cd ../cs-<name> && git checkout -b <branch>
git add <only-the-relevant-files>
git commit -m "..."
git push origin <branch>:main
cd .. && git worktree remove cs-<name> --force && git worktree prune
```

This keeps unrelated WIP out of production and avoids accidental clobbering of teammate commits on `main`.

## Performance: card and set load speed

Tested and confirmed effective on 2026-05-20. Preserve these patterns when touching grid/list views or the pokemonService layer in either web or `cardstreet-mobile/`.

### Always thumbnail with `image_small`, never `image_large`

`pokemon_cards` has both `image_small` and `image_large` columns. Grid/list views must use `image_small`; only the card detail screen should hit `image_large`. The mobile mapper in [cardstreet-mobile/services/pokemonService.ts](cardstreet-mobile/services/pokemonService.ts) returns both as `card.images.small` and `card.images.large` — components must pick the right one. Loading the large image as a thumbnail was the single biggest cause of slow set loads.

### Origin-specific thumbnail URL transforms

`image_small` from the DB may be a base URL with no quality suffix. Two origins need explicit thumbnail variants:

- **TCGdex** (`tcgdex.net`): strip any trailing `/(low|high)(\.ext)?` or `.ext`, then append `/low.webp` for thumbs, `/high.webp` for full.
- **pokemontcg.io**: `foo.png` is small, `foo_hires.png` is large. Strip `_hires` for thumbs.

Web: implemented in [lib/imageUtils.ts](lib/imageUtils.ts) (`getThumbnailUrl`, `getPreviewUrl`, `getOptimizedImageUrl`). Mobile: inline in the card mapper since `next/image` isn't available.

The legacy `fixTcgdexUrl` helpers that append `.png` only work for *full-size* fetches — never use them on a path destined for the thumbnail grid.

### Don't `select('*')` from `pokemon_cards`

The `raw_data` JSONB column is large (~tens of KB per row). For list queries, select explicit columns plus only the joins the mapper needs:

```ts
.select('id, name, english_name, set_id, number, rarity, image_small, image_large, language, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(market_avg, last_updated)')
```

The `raw_data->tcgplayer` JSONB path keeps the price fallback without pulling the rest of the blob. The web `/api/sets/[setId]/cards` route and the mobile `fetchCardsBySet`/`searchCards` both follow this pattern.

### `.eq('set_id', ...)` — never `.ilike` without wildcards

`.ilike` without wildcards defeats the b-tree index on `set_id` and forces a sequential scan. If you hit a case-mismatch issue, normalize at write time, not query time.

### `expo-image` cache policy + prefetch (mobile)

All `<Image>` components in `cardstreet-mobile/` should pass `cachePolicy="memory-disk"` so images survive screen unmounts. When a set is selected, call `Image.prefetch(...)` on the first ~30 small-image URLs and on all set logos so the second visit feels instant. The detail screen uses the cached small image as `placeholder` for the large one, eliminating the blank-flash transition.

### Persistent set/card cache (mobile)

In `cardstreet-mobile/services/pokemonService.ts`, `setsCache` and `cardsCache` are in-memory Maps **backed by AsyncStorage** with TTL — 24h for sets, 6h for cards. Cache key prefix is `pokemonCache:v1:` — bump the version segment if the schema of a cached value changes (e.g. you add a new field to `Card` that consumers now require). Without the version bump, returning users will hit stale shapes from disk and crash.

## Conventions

- Avoid emojis in code, comments, and UI unless the user explicitly asks for them.
- Comments explain **why**, not what — well-named identifiers do the rest.
- Single source of truth for the `Card` shape: `types.ts`. Mapping from DB rows: `lib/cardMapper.ts`.
- Migrations are timestamped `YYYYMMDD_short_description.sql`.
- Service-role keys, payment secrets, and SerpAPI keys live only in server code / env, never in `'use client'` modules.
- Server-side scanner / migration scripts read env from `.env.local` directly (see `scripts/backfill-phashes.mjs` for the convention).
- **Homegrown dotenv parsers must strip surrounding quotes.** Values in `.env.local` are often wrapped in `"..."`; Next.js strips those automatically (per the dotenv spec), but the naive `process.env[k] = v` parser used in `scripts/*.mjs` does not. A `GEMINI_API_KEY="AIza..."` line passed through unstripped sends Google a literal quoted string and you get `API_KEY_INVALID` on every call. If a script's API calls fail with auth errors when production works, this is almost certainly why.

## Useful breadcrumbs

- Card scanning architecture decisions: see commit messages on `fa035ba`, `9ed7dbd`, `74cc0fe`.
- pHash thresholds (`DIST_HIGH_CONFIDENCE = 8`, `DIST_CANDIDATE_CEILING = 20`): top of `services/scannerService.ts`.
- Hamming-distance SQL function and the search RPC: `supabase/migrations/20260519_phash_card_scanning.sql`.
- Flash Express integration: `lib/flashExpress.ts`, `supabase/migrations/20260502_flash_express_migration.sql`.
- Stripe Connect architecture evolution: `23835f9` (dual-platform skeleton), `a129fff` (TH destination-charge refactor), `6b8251d` (self-heal stale account IDs), `1e00ac0` (return URL allowlist), `6bfef54` (webhook 410 fallback for unconfigured regions). Initial `stripe_account_id` schema: `supabase/migrations/20260412120000_add_stripe_account_id.sql`. Dual-platform columns: `supabase/migrations/20260515_stripe_region_dual_platform.sql`.
