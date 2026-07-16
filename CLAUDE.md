# CardStreet TCG — developer notes

Marketplace for trading-card games (primarily Pokémon TCG), serving the Thai market with English, Thai, and Japanese card catalogs. Web + Android (via Capacitor). (A separate Expo/React Native companion app, `cardstreet-mobile/`, is **no longer used** as of 2026-07-16 — see the repo-layout note; don't spend effort keeping it in sync.)

## Stack

- **Next.js 15 (App Router) + React 19 + TypeScript 5.8**
- **Supabase (Postgres 15)** — auth, storage, DB. RLS on most tables.
- **Capacitor 8 (Android only)** — wraps the Next.js web app into a native shell.
- **Stripe Connect (Express)** — checkout + seller payouts. Dual-platform (US + TH); currently TH-only. **Flash Express** — Thailand shipping fulfillment.
- **Gemini SDK (`@google/genai`)** — card scanning, search-intent resolution, market insights.
- **Tailwind v4 + Framer Motion + Recharts**
- **Sentry (`@sentry/nextjs`)** for error tracking.

## Repo layout

- `app/` — Next.js routes. The mobile SPA shell (~1k lines) lives at `components/MobileHome.tsx`; `app/page.tsx` is a thin server wrapper around it that owns the homepage metadata (canonical + hreflang).
- `components/` — React components.
- `services/` — Module-style services (`pokemonService`, `scannerService`, `marketplaceService`, `geminiService`).
- `lib/` — Pure utilities, contexts, hooks, Supabase clients, the dHash util, the card mapper.
- `supabase/migrations/` — Timestamped SQL migrations (`YYYYMMDD_short_description.sql`).
- `scripts/` — One-off Node scripts. `.mjs` for ESM with raw fs + supabase-js; `.ts` for tsx-runnable.
- `cardstreet-mobile/` — **DEPRECATED / no longer used (as of 2026-07-16).** Formerly a separate Expo + React Native companion app that hit the same `/api` endpoints via `EXPO_PUBLIC_API_URL`. The app is retired; **ignore the "keep the mobile mapper in sync" and mobile-performance notes elsewhere in this doc — they no longer apply.** Directory kept for history only; don't add features to it or maintain parity with the web app.

## Supabase clients

- `lib/supabase/client.ts` — browser/client component use. Cookies via `@supabase/ssr`.
- `lib/supabase/server.ts` — server component / route use.
- `lib/supabase/admin.ts` — service-role. **Never expose to the browser** or import from a `'use client'` module.

Both the browser and server clients route their `fetch` through **`lib/supabase/sentryFetch.ts`**, which reports non-2xx Supabase responses to Sentry. It deliberately **skips `/auth/v1/*` responses with status 400/401/422** — those are GoTrue control flow (wrong password, expired/rotated refresh token, weak password at signup), not faults, and were flooding Sentry as fake "Supabase API Error" issues. Everything else still reports (403/404/429, all 5xx, network failures, and non-auth responses incl. PostgREST 401s).

## Auth password policy

The Supabase Auth (GoTrue) password policy is enforced by the **dashboard** (Authentication → Policies) — that is the source of truth. Currently: **min 6 chars + one lowercase + one uppercase + one digit** (symbols not required), plus Supabase's breached-password (HaveIBeenPwned) check, which rejects common/leaked passwords like `Password1`.

**`lib/passwordPolicy.ts`** is a hand-maintained client-side mirror of the *structural* rules (`getUnmetPasswordRules` / `isPasswordStructurallyValid`) so signup/reset forms give inline feedback instead of a server-side 422. The breached-password check stays server-side; its message is surfaced inline when it fires. Requirement text is localized via the `passwordPolicy.*` keys in `lib/locales/{en,th}.json`. Consumers: `components/AuthModal.tsx`, `app/reset-password/page.tsx`, `components/PartnerFinishSetup.tsx`. **If you change the dashboard policy, update `lib/passwordPolicy.ts` and the `passwordPolicy.*` locale strings to match** — they don't auto-sync. (The separate Expo app's signup is not yet aligned.)

## Auth email links (confirmation / reset) — prefetch problem

Supabase email links are **one-time**; mail providers' link scanners GET them before the human clicks, consuming the token — GoTrue then redirects the click to `/#error=access_denied&error_code=otp_expired&...` (the error rides the URL *fragment*, invisible to `/api/auth/callback`, and survives its redirect to `/`). For signup links the scanner's GET still *confirms* the email, so "just sign in" usually works. Three defenses, all client-side:

- **`components/AuthLinkErrorNotice.tsx`** — mounted in both shells (`components/MobileHome.tsx`, `app/desktop/layout.tsx`); catches `#error=` hashes on landing, strips them, and shows a bilingual "link already used — try signing in" dialog with its own AuthModal (`authLinkError.*` locale keys).
- **`components/AuthModal.tsx`** — the post-signup verify screen has a **Resend email** button (60s cooldown, `supabase.auth.resend`), and a sign-in failing with "Email not confirmed" routes to that screen instead of dead-ending.
- **`app/auth/confirm/page.tsx`** — prefetch-proof landing: Supabase email templates should link `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` (recovery: `&type=recovery`); the token is only redeemed when the user presses the button, so scanners can't consume it. Old-style `{{ .ConfirmationURL }}` links keep working in parallel. Android App Links intercept **all** cardstreet.app paths, so the `appUrlOpen` handler in `components/MobileHome.tsx` has a matching `/auth/confirm` branch that verifies immediately (a deep-link open is itself the user's click). **The dashboard email templates must be updated for this page to take effect** (Authentication → Email Templates).

## Card catalog

`pokemon_cards` holds all card data, keyed by `id` (e.g. `sv4pt5-234`). Approximate language distribution:

| Language | Rows | pHashed |
|----------|------|---------|
| en | ~19.8k | ~98% |
| th | ~6.6k | ~100% |
| ja | ~5.5k | ~57% (rest have no usable image URL upstream) |

Each row may have `image_large`, `image_small`, and `raw_data` (full original API response). Use **`lib/cardMapper.ts:mapSupabaseCardToInternal`** to normalize into the in-app `Card` type — it handles TCGdex URL fixups (`.png` suffix), price-currency conversion, Thai set-name aliases, and image fallbacks. Don't reinvent this in new code; import it.

**Embedded TCGplayer prices come in two shapes** (the fallback when a card has no `market_values` row). The mapper's `tcgplayerMarketUsd` helper reads both — don't reintroduce a single-shape reader:
- **pokemontcg.io**: `raw_data.tcgplayer.prices.<printing>.{market,mid,low}`
- **TCGdex**: `raw_data.tcgplayer.<printing>.{marketPrice,midPrice,lowPrice}` (printing keys sit directly on `tcgplayer` alongside `unit`/`updated`)

TCGdex-sourced EN sets (e.g. me03, me04) rendered priceless for a while because only the first shape was read. The (retired) mobile mapper in `cardstreet-mobile/services/pokemonService.ts` had the same helper; syncing it is **no longer required** (the Expo app is deprecated — see the `cardstreet-mobile/` repo-layout note). To instead materialize TCGdex prices into `market_values` rows (needed for downstream Thai derivation), use `scripts/price-en-from-rawdata.mjs`.

## Card images (self-hosted)

Card art used to be hotlinked from third-party hosts (TCGdex, ygoprodeck, Scryfall, optcgapi, asia.pokemon-card, pokemontcg.io). When TCGdex went fully unreachable in June 2026, most English Pokémon art blanked. Card images are now **mirrored into our own Supabase storage** so the catalog never depends on an upstream host being up.

- **Storage:** the public `card-images` bucket. New cards use `card-images/<id>/{small,large}.webp` (two pre-sized WebP variants — small ~245w for grids, large ~734w for detail). The older AS-era Thai PDF scans predate this and live at `card-images/cards/<set>/<id>.webp` (single full-res file, small==large); both layouts coexist.
- **`pokemon_cards.image_small` / `image_large`** point at the mirrored objects. The originals stay recoverable from `raw_data`, so the repoint is reversible.
- **Serving:** `lib/imageUtils.ts` passes any `/card-images/` URL through **directly** (no render-endpoint rewrite, `shouldSkipNextOptimization` returns true). This is deliberate — Supabase bills image transformations *per origin image*, so routing ~76k cards through `/render/image/` would be a large recurring cost. Other buckets (`listing-images` seller photos, `jp-set-logos`) keep the render path. **Never point card art through the render endpoint.**
- **Bulk backfill:** `scripts/ingest/mirror-card-images.mjs` (resumable id-cursor pagination, bounded concurrency, idempotent — skips rows already on `supabase.co`, re-encodes via `sharp`). Re-run anytime to sweep stragglers.
- **Staying mirrored:** `app/api/cron/mirror-images/route.ts` is a **monthly Vercel cron** (`vercel.json`, 04:00 UTC on the 1st, `CRON_SECRET` auth, `nodejs` runtime for `sharp`) that mirrors any newly-ingested cards still on a third-party host and re-syncs active-listing `card_data` snapshots. Bounded by a wall-clock budget; overflow is caught next run.
- **Listings carry an image snapshot.** Marketplace tiles render `listing.card_data.images`, not the live catalog. New listings snapshot the (mirrored) catalog URL at creation; pre-mirror listings were backfilled by `scripts/repoint-listing-images.mjs` and the monthly cron keeps them synced.

Coverage is not total: ~2.2k Japanese vintage cards have no image on any host (nothing to mirror), and a handful of promo rows have corrupt upstream URLs. These render imageless regardless of mirroring.

## Scanning pipeline (`/api/scan`)

> **The route must run `nodejs` runtime, not Edge.** `sharp` is a native module.

Tier order. Each tier falls through to the next on failure:

1. **Set code + number → deterministic DB lookup**. `extractCardMetadata` sends two images (full card + bottom-strip crop) to **Gemini 2.5 Flash** with a structured-output prompt asking for `name`, `setCode`, `cardNumber`, `language`, `rarity`. When both `setCode` and `cardNumber` parse cleanly, deterministic lookup `WHERE set_id ILIKE :setCode AND number IN (:n, :n/...) AND language = :lang`. A Thai card printing `MA3 087/198` maps 1:1 to a Thai-language row. The OCR'd set code is split on whitespace first to strip the regional suffix Thai cards print (`"SV8s T"` → `"SV8s"`).
2. **Name + language → pHash disambiguator**. When the set code is unreadable but Flash got the name and language right. Look up `WHERE (name ILIKE :n OR english_name ILIKE :n) AND language = :lang`, optionally narrowed by number, then rank candidates by pHash distance. Ships only when the best print is within 14 bits.
3. **Language + number → pHash disambiguator**. The safety net. Diagnostics on Thai cards show Flash hits **100% on language and 100% on card number** even when the set-code OCR misreads `"8s"` as `"bs"`/`"B5"`/etc. Language + number narrows the catalog to <20 candidates, then pHash picks the right one. Ships when the best print is within 18 bits.
4. **pHash search** — language-filtered when known, retries unfiltered if zero matches. Candidates merge the catalog hashes with the **learned photo-hash index** (`scan_learned_phashes` — dHashes of user photos confirmed via scan feedback; see below). Photo-to-photo matches beat photo-vs-catalog-art, and they cover cards with no catalog phash at all.
5. **OCR text + Gemini Flash** — full-card text path when the device sent native MLKit OCR text.
6. **Image + Gemini Flash** — final fallback.

There is deliberately **no paid-search fallback below Gemini.** The old tier 7 (Google Lens via SerpApi) was removed 2026-07-10: it fired only when Gemini threw, yet needed Gemini itself to parse the Lens titles — so during any Gemini outage it consumed a paid search per scan while structurally unable to succeed, and exhausted the 5k/mo plan with 185 users. Gemini calls now retry once on 429/5xx instead (`geminiWithRetry`). Don't reintroduce a paid API at the bottom of a fallthrough chain.

**Scan modes.** `ScanPayload.mode`: `'live'` (a frame from a continuous auto-capture loop — Expo app) runs tiers 1-4 only and returns an empty result on a miss for the next frame to retry; `'single'` (default; web/Capacitor single-shot) runs the full pipeline. The Expo loop escalates one frame to `'single'` after 5 live misses, then stops. Never let an auto-loop trigger the LLM fallbacks on every frame.

**Telemetry + feedback loop** (`supabase/migrations/20260710_scan_learning.sql`): every scan writes a `scan_events` row (tier that resolved it = `source`, OCR fields, photo dHash, candidates, latency, error) keyed by the `scanId` returned to clients. Clients post implicit verdicts to `/api/scan/feedback` — candidate pick / add-to-vault ⇒ `confirmed`, bail-to-search / "Try Again" ⇒ `rejected`. A confirm stores the photo's dHash → card in `scan_learned_phashes` (via `record_learned_phash`: ≤8 hashes/card, near-dupes bump instead of insert) **only when the confirmed card was among the scan's own candidates** — feedback can't inject arbitrary card ids. Everything fails soft if the migration isn't applied.

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

Google-Lens-style: the scanner detects the card's edges in real time, snaps a highlight overlay onto it, and auto-fires the instant the detected card is sharp and settled. The detection loop runs at `ANALYSIS_FPS` (10fps) on a small grayscale buffer sized to the **visible** video region (object-cover crop), so detected-box coords map cleanly to both screen (overlay) and video pixels (capture).

Per frame:

1. `sobel()` → directional gradients. `detectCardBox()` projects `|gx|` onto columns (left/right borders) and `|gy|` onto rows (top/bottom), takes the outermost strong-edge bins (above `EDGE_PEAK_FRAC` of the projection max, gated by `EDGE_GRADIENT_THRESHOLD`), then **validates** the box is card-shaped (aspect ≈ `CARD_ASPECT` within `ASPECT_TOLERANCE`) and sensibly sized (`MIN/MAX_CARD_AREA_FRAC`). Returns null otherwise.
2. The accepted box is EMA-smoothed (`BOX_SMOOTHING`) and drawn as the snapping highlight.
3. **Fire** when the detected sub-region is sharp (`laplacianVariance` ≥ `FOCUS_VARIANCE_THRESHOLD`) and the box has settled (corner movement < `BOX_STABILITY_PX`) for `STABLE_FRAMES_REQUIRED` frames. Capture uses the detected box (padded), mapped back to video pixels — a tighter crop than the old fixed guide box.

On fire, a white flash + frozen still shows immediately (`frozenFrame`) so the grab reads as instant while the catalog match runs.

**Fallbacks (a detection miss must never strand the user):** if no box locks within `DETECT_TIMEOUT_MS` (2.5s — cluttered background, glare, low contrast), it degrades to the legacy center heuristic (whole-buffer Laplacian variance > 120 + mean-abs-diff < `STABILITY_DIFF_THRESHOLD` for 2 frames, capturing the centered `computeCardCrop`). The manual shutter button is also retained as an override (grabs the center crop).

If auto-capture fires too eagerly or never fires, the knobs are `EDGE_PEAK_FRAC` and `BOX_STABILITY_PX` first, then the aspect/area tolerances — all in the documented constants block at the top of the file.

## Payments + Stripe Connect

CardStreet is a marketplace built on **Stripe Connect with Express accounts**. The codebase supports two Stripe platforms under one organization but is currently running TH-only.

### Why two platforms

Stripe Thailand does **not permit platform-loss-liable Connect accounts** — the platform cannot be merchant of record (MOR) for charges; the seller must be. This rules out the "separate charges and transfers" pattern on TH (platform charges buyer, transfers to seller). Stripe US allows that pattern via the `recipient` service agreement for TH-country connected accounts. To support both, the code branches on `stripe_region`:

| Region | Model | Seller capabilities | MOR | Cart shape |
|---|---|---|---|---|
| `th` (active) | **Direct charges** (PaymentIntent created on the connected account) + `application_fee_amount` | `card_payments` + `transfers` | Seller | Single-seller only |
| `us` (dormant) | Separate charges and transfers + `recipient` agreement | `transfers` only | Platform | Multi-seller OK |

**Who bears the Stripe processing fee:** on TH this is a *direct charge*, so the seller (the connected account, as MOR) automatically bears Stripe's processing fee — it is debited from their balance at charge time. The platform's only take is `application_fee_amount` (the seller's tier fee), which arrives untouched by Stripe fees. The buyer pays item + shipping only; the Stripe fee is never added on top of the buyer's total. On the dormant US path the platform is MOR and bears the Stripe fee instead.

**Platform fee tiers** (the `application_fee_amount`, computed in `app/api/orders/checkout/route.ts`): non-partner sellers pay **9%**; partners pay a tiered rate starting at **5%** (level 1 / bronze) and descending to 2% (level 9). The ladder — downloads→level thresholds and level→fee — is the single source of truth in **`lib/partnerTiers.ts`**; checkout and `components/PartnerPortal.tsx` both import it, and the SQL functions in `supabase/migrations/20260701_partner_level_from_downloads.sql` mirror it. Change all three together.

**Partner tier is earned from downloads.** `profiles.total_downloads` (attributed installs/signups from the referral system) drives `partner_level`: a `BEFORE INSERT/UPDATE` trigger on `profiles` (`sync_partner_tier`) sets `partner_level = GREATEST(admin-set level, level-for-downloads)` and `partner_fee = fee-for-level`, so downloads auto-promote, an admin grant acts as a floor, and nobody is demoted below what they earned. Checkout also derives the fee from `max(partner_level, levelForDownloads(total_downloads))` directly, so the correct fee applies even before the trigger migration is run.

`profiles.stripe_region` and `orders.stripe_region` pin each entity to its platform — Express accounts can't move between platforms after creation, so the column is sticky.

### File map

- `lib/stripe.ts` — region-aware client factory. `getStripeForRegion('us'|'th')`, `isRegionConfigured`, `getWebhookSecretForRegion`, `defaultCurrencyForRegion`, `paymentMethodTypesForRegion`. Lazy-init so unset keys don't crash module load.
- `lib/stripeWebhook.ts` — shared webhook handler. Returns `410 Gone` if the region isn't configured; otherwise verifies the signature with the region's secret and dispatches on event type.
- `app/api/webhooks/stripe/route.ts` — US endpoint, thin shim over the shared handler.
- `app/api/webhooks/stripe/th/route.ts` — TH endpoint, same shim with `region='th'`.
- `app/api/stripe/connect/{start,status,dashboard}/route.ts` — onboarding + status routes, all region-aware. `start` self-heals stale `stripe_account_id` rows by creating a fresh account when Stripe returns `resource_missing`.
- `app/api/checkout/route.ts` — PaymentIntent creation. Region-branched: on TH the PaymentIntent is created **on the seller's connected account** (direct charge — `requestOptions.stripeAccount = seller.stripe_account_id`) with `application_fee_amount`; on US it's a plain platform charge.
- `app/api/orders/checkout/route.ts` — order creation. Enforces single-seller carts on TH and rejects mixed-region carts everywhere.
- `app/api/orders/finalize/route.ts` — client-side webhook fallback; verifies the PaymentIntent on the correct platform.
- `supabase/functions/release-funds/index.ts` — hourly payout cron. On TH it makes **no Stripe payout call** — the buyer's funds already settled into the seller's connected-account balance at charge time (direct charge), so the cron only marks the order `completed`, records a synthetic `direct_charge_${order.id}` id, and notifies the seller. On US it uses `stripe.transfers.create` to move money out of the platform's balance. (See the escrow caveat under Payouts.)
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
- Capabilities: `card_payments` + `transfers` (both required — `card_payments` makes the seller capable of being MOR; `transfers` lets the platform take an application fee) + `promptpay_payments` on TH
- **No payout schedule override** — the account uses Stripe's default automatic payout schedule. (The code does *not* set `settings.payouts.schedule.interval = 'manual'`; see the escrow caveat under Payouts.)
- Pre-filled `business_profile.{url, product_description, mcc=5945}` so individual sellers without a website don't get blocked on a required URL field in Stripe's hosted onboarding

**Self-heal**: if `accountLinks.create` (or any other Stripe call) returns `resource_missing` / `account_invalid` (stale account ID from a deleted account or rotated keys), the start route clears `stripe_account_id` + capability flags and creates a fresh account in the same request. No manual SQL cleanup needed for orphaned rows.

**Return URL hardening**: `return_url`/`refresh_url` default to `getAppBaseUrl()` (cardstreet.app), **not** the request host. Stripe's "Return to CardStreet" button then deep-links into the Capacitor app via Android App Links (autoVerify on `cardstreet.app` per `AndroidManifest.xml`). Client can override via `returnUrl`/`refreshUrl` in the body, validated against an allowlist (cardstreet.app, NEXT_PUBLIC_APP_URL host, localhost).

**Abandonment recovery** (TH KYC is a legal floor — the seller is MOR, so Stripe must fully verify them before `charges_enabled`; the lever is recovering abandoners, not shortening the form). Two nudges for sellers with `stripe_account_id` set but `stripe_details_submitted` false:
- `app/api/cron/stripe-setup-nudge/route.ts` — daily Vercel cron (02:00 UTC = 09:00 Bangkok), one-time bilingual "finish your payout setup" email via `lib/courier.ts:sendStripeSetupReminderEmail`. One email per seller ever, CAS-guarded on `profiles.stripe_setup_nudge_sent_at` (migration `20260704_stripe_setup_nudge.sql`), only after the account sat unchanged >24h. The CTA links `/?stripe_connect=refresh`, which the shell + `Profile` + `StripeConnectSection` already turn into an immediate resume of hosted onboarding.
- The mobile shell (`components/MobileHome.tsx`) shows a dismissible amber banner under the header for stalled sellers (cached flags via `/api/stripe/connect/status`); tapping it hands off to Profile's payouts panel via the `cs_open_payouts` sessionStorage flag. Desktop needs no equivalent — `/sell` already gates on Stripe status with a resume button.

### Charges (TH path)

`/api/checkout` creates the PaymentIntent **on the seller's connected account** (direct charge) by passing `requestOptions.stripeAccount = seller.stripe_account_id`. It does **not** set `transfer_data.destination` or `on_behalf_of` — those belong to the destination-charge model, which TH does not use. The PaymentIntent carries:
- `application_fee_amount: Σ orders.platform_fee` in satang (the platform's 9%/tiered cut)
- `automatic_payment_methods.enabled` so the client PaymentElement can offer card + PromptPay

Funds settle directly into the seller's Stripe balance. The Stripe processing fee comes off that balance (standard for direct charges — the connected account is MOR), so the seller bears it automatically; the platform receives the full `application_fee_amount`.

### Payouts

`release-funds` (Supabase Edge Function) finds orders where `status='delivered'`, `escrow_status='held'`, `funds_release_at <= NOW()`, `stripe_payout_id IS NULL`, and:

- TH: makes **no Stripe call**. With direct charges the buyer's money already sits in the seller's connected-account balance, and (since onboarding sets no manual payout schedule) Stripe pays it out on the account's default automatic schedule. The cron only marks the order `completed`, stamps a synthetic `direct_charge_${order.id}` id (keeps the `stripe_payout_id IS NULL` retry guard meaningful), and notifies the seller. The notification amount is the charge's `balance_transaction.net` (true deposit after Stripe's fee), not `total − platform_fee`.
- US: `stripe.transfers.create(...)` with idempotency key `payout_${order.id}` — moves money from the platform's balance to the seller's connected account, which then auto-pays-out on Stripe's default schedule.

> **Escrow caveat (known gap):** the surrounding language (`escrow_status='held'`, `funds_release_at`) implies funds are *held* by the platform until delivery + 48h, then released. That is true on the US path. On TH it is **not** — direct-charge funds reach the seller's balance at charge time and pay out on Stripe's automatic schedule regardless of delivery state. To make TH a real escrow, onboarding would need `settings.payouts.schedule.interval = 'manual'` and `release-funds` would need to call `stripe.payouts.create({...}, {stripeAccount: sellerId})` on release. Neither is in place today.

### Cart constraints

- **Mixed-region carts**: rejected at `/api/orders/checkout` with 400 (a PaymentIntent on platform A can't transfer to an account on platform B).
- **Multi-seller carts on TH**: rejected at `/api/orders/checkout` with 400 (a direct-charge PaymentIntent is created on exactly one connected account, so one seller per cart). Multi-seller-as-N-charges is a future improvement.
- Both checks fire BEFORE any DB writes or listing reservations, so a rejected cart leaves no side effects to roll back.

### Purchase region gating (Thailand-only)

Shipping (Flash Express) is only configured for Thailand, so **buying is restricted to TH** for now. Browsing, scanning, and collection management are open everywhere — only the purchase/checkout path is gated. The rest of the world is meant to use the collection side until shipping expands.

**Signal**: Vercel's `x-vercel-ip-country` header (ISO 3166-1 alpha-2), derived from the client IP — the same header used for referral attribution and `app/join/[slug]`. The single source of truth is **`lib/geo.ts`** (`getRequestCountry`, `isPurchaseAllowedFromCountry`). Don't re-read the header ad hoc; import the helper.

**Fail-open policy**: a purchase is allowed when the country is `TH` **or unknown** (header absent — local dev / unresolvable IP). We only hard-block a country we can positively see is not Thailand. Blocking unknowns would lock out legitimate Thai buyers on the rare un-geolocatable request, and Vercel reliably sets the header in production. This is geography (IP) based, so a Thai user travelling abroad is also blocked — consistent, since shipping is to a TH address regardless.

**Enforcement (authoritative, server-side)**:
- `app/api/orders/checkout/route.ts` rejects non-TH with `403 { code: 'GEO_RESTRICTED' }` right after auth, **before any DB writes / listing reservations** — a rejected request leaves no side effects.
- `app/api/checkout/route.ts` repeats the gate as defense in depth so a PaymentIntent can never be created out of region.

**UX (popup)**: `components/PurchaseRegionModal.tsx` — "available in Thailand only / coming soon to your country" (bilingual, `purchaseRegion.*` keys in `lib/locales/{en,th}.json`). It's shown by the client gate before the payment modal ever opens:
- `GET /api/geo` returns `{ country, purchaseAllowed }` (per-IP, `no-store`).
- `lib/hooks/usePurchaseRegion.ts` warms that lookup once per session (cached + deduped) and exposes `ensurePurchaseRegion()` for click handlers.
- Mobile `components/MobileHome.tsx`: a shared `ensureCanPurchase()` guard fronts both cart **Checkout** (`handleCheckout`) and listing **Buy Now** (`onBuyNow` — which skips the cart and opens the payment modal directly, so it needs its own gate).
- Desktop `components/desktop/DesktopCartDrawer.tsx`: gated in `beginCheckout`, the only path into the desktop payment phase.

The client gate is UX only and **fails open** (a `/api/geo` hiccup leaves `purchaseAllowed` true); the server gate has the final say. The popup's blocked state can't be reproduced in local dev, since the browser never sends `x-vercel-ip-country` — exercise `/api/geo` with a forced header to verify the logic.

## pHash backfill

`scripts/backfill-phashes.mjs` populates `pokemon_cards.phash` for every row with a usable image URL.

- Concurrent (default 8), idempotent, resumable.
- **Paginates by `id` cursor**, not `OFFSET`. Rows whose phash gets updated drop out of the `phash IS NULL` filter, so OFFSET would silently skip them; pure `LIMIT` without a cursor loops forever on skip-no-url rows.
- Re-run is safe: already-hashed rows are excluded by the filter.

Failures (~400) are cards with broken `image_large` URLs (mostly XY-era promos). Skips (~2.4k) are cards with no image URL in any field. Both classes need upstream catalog fixes, not script fixes.

## Thai `english_name` backfill

Thai (`language='th'`) rows store the Thai card name in `name` and often leave `english_name` null, which hurts English search of Thai cards. `scripts/backfill-thai-english-name.mjs` fills `english_name` from the **Japanese twin** — matched on the same `set_id` + `number`. This is the **only safe source**: Thai reprints a Japanese set 1:1 with identical numbering, so `ja <set>/<n>` is the same card, but the **English twin renumbers**, so an EN number-match would mislabel cards. The `set_bridge` (`scripts/build_set_bridge.ts`) maps Thai→EN for *pricing only* — never use it for names. Dry-run by default, `--commit` to write, idempotent (only fills empty rows), reversible per set.

Coverage is limited to sets whose JA twin is in-catalog under the same code (filled 461 rows across S12/S12a/S9/S9a/SVK). The ~4k rows on "orphan" sets (S8b, S11, S10\*, SC\*, SVM, SVT\*, SVA\*, MAA\*, promos M-P/S-P) have no in-catalog JA twin and need a JA-name→EN-name dictionary instead.

**The 1:1-numbering premise is not universal.** A TH and a JA product can share a set code yet be different, renumbered lineups — `SVK` (JA rows = Deck Build BOX Stella Miracle) mislabeled 22/27 filled rows this way (Mew ex stored as "Radiant Charizard"; repaired 2026-07-03 by pHash-matching each TH row against the JA catalog). The script now **pHash-verifies every pair** (a Thai reprint keeps the same artwork): pairs over 14 bits apart are skipped, and a set where >30% of hashed pairs mismatch is skipped wholesale. The gate is 14, not 20, because **item/trainer cards share near-identical layouts and false-match in the 14–20 band** (SVK's Rare Candy passed as "Nest Ball" at ≤20).

**Shared set codes across languages:** `pokemon_sets.id` is a single-col PK, so a code can only carry one language's set row. When a TH and a JA product genuinely share a code with *different* lineups, the Thai product gets its own suffixed set id — precedent: `SVK-th` (เด็คบิลด์บ็อกซ์ สเตลลาร์มิราเคิล, split 2026-07-03; the 50 Thai cards' `set_id` moved to `SVK-th`, card ids unchanged). The scanner needs no changes for this: tier-1's second matcher leg (`set_id ILIKE '<code>%'` + language filter) resolves a printed "SVK" on a Thai card to `SVK-th`.

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

## Internationalization (i18n), locale routing & SEO

CardStreet is Thailand-first and bilingual (Thai + English), built so adding markets/languages later is mostly config. Keep the four axes separate — **language** (UI), **market/region**, **currency**, **catalog** — they are not the same thing (a Thai buyer may want an English UI with THB pricing).

### Single sources of truth

- `lib/markets.ts` — `MARKETS` config (mirrors `lib/games.ts`). TH is live; SG/MY/PH/US are configured-but-dormant. Each market declares languages, default language, currency, `stripeRegion`, shipping provider, and BCP-47 `locales`. Read from here; don't hardcode per-market values.
- `lib/i18nRouting.ts` — the locale-in-URL scheme and `buildAlternates(path)` / `sitemapAlternates(path)` helpers for canonical + `hreflang`.
- UI strings live in `lib/locales/{en,th}.json`, read via `useTranslation()` (`t('namespace.key')`). The desktop site uses the `desktop.*` namespace (chrome + `desktop.{sell,orders,card,cart}`).

### Locale-in-URL scheme (lightweight, middleware-driven — not next-intl)

- **Thai is canonical at the bare path** (`/`, `/faq`); **English lives under `/en`** (`/en`, `/en/faq`); `/th/*` 301-redirects to the bare path.
- `middleware.ts` strips a leading `/en` and **rewrites** to the bare route while keeping the `/en` URL in the browser; it sets a server-readable `cs_lang` cookie and forwards the resolved locale to the server via the **`x-cs-lang` request header**. First-visit default is **Thai** — English is opt-in via `/en` or the in-app language toggle, **not** geo-negotiated. The locale strip runs *before* the existing desktop-rewrite/admin-guard logic so the two concerns don't tangle (`resolveExperience` returns the internal target; the locale wrapper re-attaches the prefix on redirects, rewrites on `/en`). When adding routes that should be localized, extend the `config.matcher`.
- `app/layout.tsx` is `async`: it reads `x-cs-lang` (then the `cs_lang` cookie) → `<html lang>` + the `initialLanguage` prop on `UserSettingsProvider`, so the server renders the right language with no flash. The provider seeds its initial language from that prop and **writes the `cs_lang` cookie** whenever the language changes (incl. `updateLanguage`). Reading `headers()`/`cookies()` in the root layout makes all routes dynamically rendered — fine for this mostly-dynamic app.

### FAQ + content pages (SEO/GEO)

- `lib/faqData.ts` is the single source for FAQ content (bilingual, plain-string answers so they serialize into schema.org). `buildFaqJsonLd()` emits a `FAQPage` JSON-LD block.
- `app/faq/page.tsx` is the canonical, server-rendered FAQ page (metadata + JSON-LD + `buildAlternates('/faq')` for canonical/hreflang). `components/FaqList.tsx` renders the bilingual accordion (native `<details>`, no-JS-friendly) and is reused by `app/help/page.tsx`. The desktop homepage shows a featured-questions teaser (`components/desktop/DesktopFaqTeaser.tsx`) linking to `/faq`.
- `app/sitemap.ts` lists the public content routes with per-locale `hreflang`; `app/robots.ts` points to it and blocks `/admin`, `/api`, `/desktop`.
- **Universal content pages (mobile-first indexing).** `/card/*`, `/sets/*`, `/seller/*`, and the six game landing pages (`/pokemon`, `/one-piece`, `/yugioh`, `/mtg`, `/lorcana`, `/riftbound` — content in `lib/gameLanding.ts`, route `app/desktop/games/[slug]/page.tsx`) are served from the `/desktop` tree to **every** device — phones included. Do NOT reintroduce a phone→`/` redirect on these paths: Google indexes with its smartphone crawler, and the redirect made the whole catalog invisible (the mid-2026 zero-traffic root cause). Only the native app UA (`CardStreetApp` marker) bounces to the SPA. `DesktopNav` collapses to a hamburger below `lg` to keep these pages phone-usable.
- Sitewide `Organization` + `WebSite` (with `SearchAction`) JSON-LD is emitted by `app/layout.tsx`; card pages add `Product`, set pages `ItemList`, seller pages `OnlineStore`, game pages `FAQPage`/`CollectionPage`/`BreadcrumbList`. `app/llms.txt/route.ts` serves the AI-answer-engine overview.

> Expansion roadmap (TH → SEA → US), phase status, and the open follow-ups (hreflang on the other `'use client'` content pages, language-toggle URL navigation, per-locale OG/JSON-LD) live in the agent memory note `project_i18n_market_expansion.md`, not here.

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
