# CardStreet TCG — developer notes

Marketplace for trading-card games (primarily Pokémon TCG), serving the Thai market with English, Thai, and Japanese card catalogs. Web + Android (via Capacitor) + separate Expo companion app.

## Stack

- **Next.js 15 (App Router) + React 19 + TypeScript 5.8**
- **Supabase (Postgres 15)** — auth, storage, DB. RLS on most tables.
- **Capacitor 8 (Android only)** — wraps the Next.js web app into a native shell.
- **Stripe + PayPal** — checkout. **Flash Express** — Thailand shipping fulfillment.
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

Pipeline order (each tier falls through to the next on failure):

1. **pHash search** — server computes dHash of the captured frame via `sharp` and queries the `search_pokemon_by_phash` RPC. Filtered by *detected card language*. Fast (~400–600ms typical) and the most accurate path.
2. **OCR text + Gemini Flash** — if pHash misses and the device sent native OCR text.
3. **Image + Gemini Flash** — last LLM fallback. (Was Pro originally; Flash is plenty.)
4. **Google Lens via SerpApi** — final fallback. Slow (>5s) but kept around for catalog gaps.

Language detection runs **inside** the pHash step, in parallel with the hash compute (`Promise.all` so the wall clock = max, not sum):

- If OCR text is provided, inspect script directly: Thai chars → `th`, Hiragana/Katakana/Han → `jp`, Latin → `en`. Pokémon cards are single-language prints so this is unambiguous.
- Otherwise call Gemini 2.5 Flash with a one-shot classifier prompt (single-token output, `thinkingBudget: 0`, ~400ms).

The user's app locale is **not** a filter — it's only a tiebreaker when two prints have identical pHash distance. Multi-language collectors get correct results regardless of their UI language.

Relevant files: `services/scannerService.ts`, `lib/phash.ts`, `lib/cardMapper.ts`, `app/api/scan/route.ts`.

## Continuous capture (`components/WebLiveScanner.tsx`)

Auto-fires a scan when the camera frame is sharp + stable for 2 consecutive frames at 3fps:

- Laplacian variance > 120 → in focus
- Mean absolute per-pixel diff < 6 vs previous frame → stable

All checks run on a tiny 80×112 grayscale buffer (constants at top of file). If auto-capture fires too eagerly or never fires, those thresholds are the knobs.

The manual shutter button is retained as an override.

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

## Conventions

- Avoid emojis in code, comments, and UI unless the user explicitly asks for them.
- Comments explain **why**, not what — well-named identifiers do the rest.
- Single source of truth for the `Card` shape: `types.ts`. Mapping from DB rows: `lib/cardMapper.ts`.
- Migrations are timestamped `YYYYMMDD_short_description.sql`.
- Service-role keys, payment secrets, and SerpAPI keys live only in server code / env, never in `'use client'` modules.
- Server-side scanner / migration scripts read env from `.env.local` directly (see `scripts/backfill-phashes.mjs` for the convention).

## Useful breadcrumbs

- Card scanning architecture decisions: see commit messages on `fa035ba`, `9ed7dbd`, `74cc0fe`.
- pHash thresholds (`DIST_HIGH_CONFIDENCE = 8`, `DIST_CANDIDATE_CEILING = 20`): top of `services/scannerService.ts`.
- Hamming-distance SQL function and the search RPC: `supabase/migrations/20260519_phash_card_scanning.sql`.
- Flash Express integration: `lib/flashExpress.ts`, `supabase/migrations/20260502_flash_express_migration.sql`.
- Stripe Connect onboarding: `supabase/migrations/20260412120000_add_stripe_account_id.sql` and `app/api/profile/stripe/`.
