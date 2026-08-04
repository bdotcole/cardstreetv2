# Live Breaking — Whatnot Parity Spec & Build Plan

> Branch-only design reference (do NOT ship until launch approval). Target: match
> Whatnot's live-selling product 1:1 **except** formats Thailand's Gambling Act
> plausibly makes illegal (razz / random / team / spot breaks, PYT, and all
> random-draw giveaways/sweepstakes), which stay counsel-gated behind clean
> extension points. Grounded in the 2026-07-04 research workflow (10 facets,
> adversarially source-verified) against the existing auction engine
> (`20260704_auction_house.sql`) and the drafted `20260704_live_streams.sql`.

**Status legend**

- `schema_done` — already covered by the drafted migrations; only routes/UI to wire.
- `partial` — engine/schema mostly there; a small column or route is missing.
- `needs_build` — no schema; must be built.
- `legally_gated` — Thai Gambling Act; build nothing until Thai counsel clears it.
- `infeasible` / `different_by_design` — divergent by market/rail necessity or model.

---

## Parity matrix

### Auction mechanics

- **Countdown timer + last-second reset (Counter Bid Time)** — `schema_done` · MVP.
  Whatnot: seller sets Auction Time (~30s typical) + Counter Bid Time; a bid in the
  final <10s resets the clock, repeating until 10s pass with no bid.
  CardStreet: `place_bid()` soft-close already does exactly this generically —
  `stream_items.timer_seconds` (15–60) is the Auction Time; the live lot's
  `auctions` row gets `soft_close_window/extension = 10s/10s`. No engine change.
- **Sudden Death (no extension)** — `partial` · fast-follow.
  Engine supports it by config (window=0 → hard close); need a per-lot
  `stream_items.sudden_death BOOLEAN` to drive the choice + skull UI.
- **Seller-set starting bid; edit/cancel only while unbid** — `schema_done` · MVP.
  `stream_items.starting_price` + `cancel_auction()` already enforces "only while
  `bid_count=0`". Edit-while-unbid = a small guarded lot-edit route.
- **Bid increments (price-scaled)** — `different_by_design` · MVP.
  CardStreet uses a fixed platform ladder (`auction_bid_increment()`, ฿5→฿500),
  single-sourced in `lib/auctionRules.ts` + SQL mirror. Sellers do NOT set custom
  increments — deliberate, for a uniform TH bid UX. `min_next_bid` is returned to the client.
- **One-tap quick-bid at next increment** — `schema_done` · MVP.
  Live bid route submits `p_max_bid = min_next_bid`; proxy degenerates to plain
  ascending bids. Pure wiring.
- **Custom bid with Secret Max / proxy (default ON)** — `schema_done` · fast-follow.
  This is the eBay proxy the auction engine already implements; `bids.max_amount`
  is secret (RLS + API strips it). Same RPC — the route just passes the typed ceiling.
- **Pre-bidding before the lot runs** — `needs_build` · later.
  Needs `stream_item_prebids(stream_item_id, bidder_id, max_amount)` replayed
  through `place_bid` at lot-start; also needs the card saved at pre-bid time.
- **Hammer / auto-charge winner at close** — `partial` · MVP.
  Close is done (`close_due_auctions` → `record_stream_win` → `stream_wins`).
  The **off-session charge is the unproven leg** (see Payments) — a charge worker
  + E2E verification is still to build. This is the critical MVP risk.
- **Bids binding; narrow remedies** — `partial` · fast-follow.
  Binding is enforced. No live-specific 24h buyer-cancel / 2h tech-issue window;
  deadbeat void + shared strikes cover nonpayment. Add per-win cancel if wanted.

### Buy It Now & pinned items

- **Buy It Now instant purchase** — `schema_done` · MVP.
  `stream_items.item_type='buy_now'` + `buy_stream_item()` first-click-wins CAS on
  the listing. In-stream BIN uses the **live off-session card rail** (not PromptPay).
- **Pin a fixed-price item to the stream** — `schema_done` · MVP.
  `streams.current_item_id` + `stream_items.position/status`; realtime pushes the pin.
- **Flash Sale (discounted, time-limited BIN)** — `needs_build` · fast-follow.
  Add `stream_items.flash_price` + `flash_ends_at`; countdown-gated price in `buy_stream_item()`.
- **Quantity / multiples on one listing** — `needs_build` · later.
  Both listings and `stream_items` are single-unit; needs a qty/remaining column + decrementing CAS.
- **Product variants on one listing** — `infeasible` · later.
  CardStreet models each condition/grade as its own row. Sellers pin separate lots.
- **Make an Offer (incl. Offers in Lives)** — `needs_build` · later.
  No offer subsystem exists; also needs off-session charge on accept.
- **No cart; per-item charge + post-hoc bundling (Smart Bundling)** — `schema_done` · MVP.
  Matches CardStreet's live design exactly: each win is its own charge; `shipments`
  groups a buyer's wins into ONE Flash parcel at close. (Diverges from CardStreet's
  own marketplace cart — live is cartless by design.)
- **Reserved-for-show vs anytime-shop** — `partial` · fast-follow.
  A pinned BIN references a marketplace listing that stays shop-purchasable; CAS
  prevents double-sell. Add a `live_reserved` flag only if hard exclusivity is wanted.
- **Sold-out handling & relisting** — `partial` · fast-follow.
  Single-unit sold-out is implicit; void rolls the listing back to `active` (re-pinnable).
  No structured relist UI / multi-unit decrement.

### Giveaways & breaks (the legal frontier)

- **Random giveaways (Standard/Follower/Buyer-Appreciation)** — `legally_gated` · later.
  Chance-based prize draw. Thai Gambling Act B.E. 2478. Not representable; build nothing.
- **Platform-run sweepstakes** — `legally_gated` · later. Same exposure.
- **Personal break / Rip-and-Ship (single buyer, deterministic)** — `schema_done` · MVP.
  The ONLY break format permitted: `item_type='personal_break'`, `break_opened_at`
  anchors the rip in the VOD. Buyer keeps everything — retail+entertainment, not chance.
- **Pick Your Team (PYT) — deterministic spots** — `legally_gated` · later.
  Deterministic but a group-buy-splitting-one-box format; must go through the SAME
  counsel review. Not in the permitted set; needs the `item_type` CHECK widened.
- **Random Team/Player, Razz, Division, Serial, Draft, Surprise Set** — `legally_gated` · later.
  All randomized allocation. Explicitly out. (Even Whatnot bans pure razz.)
- **Breaks Manager / spot tooling** — `legally_gated` · later. Only meaningful once PYT/random are legal.
- **High-Value Loss Reimbursement + onscreen-visibility policy** — `needs_build` · fast-follow.
  Applies to personal breaks (the one legal format). Policy + a claim flag on top of
  reviews/refund; VOD + `break_opened_at` are the evidence trail.

### Discovery & channel surface

- **For You / Following live feed** — `partial` · MVP (simple) / later (personalized).
  `streams.status` + indexes support a live-now grid sorted by viewer_peak/recency.
  No personalized ranking; no Following feed (needs `follows`).
- **Scheduled shows + go-live reminders** — `partial` · fast-follow.
  `streams.status='scheduled'` + `scheduled_at` exist; need `stream_reminders` + the
  go-live push (FCM + Courier infra already exists).
- **Follow a seller + go-live notification tiers** — `needs_build` · fast-follow.
  No social graph anywhere. Add `follows(follower_id, seller_id, notify_tier)` — foundational,
  also benefits the wider marketplace.
- **Share / deep links into a running show** — `partial` · fast-follow.
  `streams.id` gives a natural URL; Android App Links already wired. Add `/stream/[id]`.
- **Promoted shows / Boost (paid placement)** — `needs_build` · later. Monetization layer; needs the feed first.
- **Private / unlisted shows** — `needs_build` · fast-follow.
  Add `streams.visibility` — also the recommended "Rehearsal Mode" for pilot broadcasters.

### Broadcaster tools

- **Schedule + go live; mobile camera broadcast** — `partial` · MVP.
  Schema ready; broadcast is **blocked on native camera/mic perms** (a signed AAB
  release). `live_broadcast` beta flag gates who can host.
- **LiveKit video (view + broadcast in WebView)** — `needs_build` · MVP.
  The single biggest build item. Only `streams.livekit_*` hooks exist; no token
  route, room lifecycle, or egress→VOD. Viewing is lower-risk; broadcasting is release-gated.
- **Pre-show run-of-show / lot queue** — `schema_done` · MVP.
  `stream_items.position/status` + `current_item_id`. Matches Whatnot's stock-then-run model.
- **Show Notes** — `partial` · later. `streams.description` suffices for MVP.
- **Add products live** — `schema_done` · fast-follow. Insert a `stream_items` row mid-show; same run path.
- **Two-device / OBS / multi-camera** — `needs_build` · later. Phone-first for the pilot.
- **Multicasting (YouTube/FB/Twitch)** — `infeasible` · later. Whatnot lacks Android multicast too.
- **On-screen overlays (title/timer/price/next-bid/sold)** — `schema_done` · MVP.
  All data is realtime already (`card_data`, `auctions` row, `min_next_bid`). Pure client render.
- **In-show live stats** — `partial` · fast-follow. Derivable from `stream_wins` (realtime sum/count).
- **Seller Hub analytics + T&S metrics** — `partial` · fast-follow. Compose from existing tables.
- **Video receipts / VOD** — `partial` · fast-follow.
  `streams.vod_url` + `vod_expires_at` (30d, vs Whatnot 60d) hold the full show. No per-item clips.
- **Rehearsal Mode** — `needs_build` · later. Ship private streams instead of a bespoke mode.
- **Co-host** — `needs_build` · later. Add `stream_cohosts` + 2nd LiveKit publisher grant.

### Chat & community

- **Live text chat (realtime)** — `schema_done` · MVP.
  `stream_chat_messages` via Supabase Realtime under RLS; sends via API route with
  `bump_rate_limit` + ban check (no INSERT policy by design).
- **Moderation: mute/ban, delete, freeze** — `partial` · MVP (core) / fast-follow (mods).
  `stream_chat_bans` + soft-delete + `streams.chat_disabled` are there. Missing: a
  `stream_moderators` role (only `seller_id` has power today), muted-words, slash-commands.
- **@mention + pinned/announcement** — `partial` · later. `is_system` exists; no pin/mention notify.
- **Raid** — `needs_build` · later. Rare with 2–3 pilot broadcasters.
- **Tipping** — `needs_build` · later. Another off-session charge; quick TH-law check.
- **Gems / tap-reactions** — `needs_build` · later. Ephemeral over the LiveKit data channel.
- **Rewards Club buyer tiers** — `different_by_design` · later.
  CardStreet loyalty is seller-side (partner tiers). Top-buyer recognition is derivable.

### Payments & checkout

- **Card on file required; auto-charge on win (no checkout)** — `partial` · MVP.
  `profiles.stripe_customer_id_th` + `live_default_payment_method` (SetupIntent
  off_session on the TH platform customer); at hammer the PM is cloned to the
  seller's connected account and charged off-session (direct charge, seller MOR).
  **SetupIntent save + PM clone VALIDATED in test mode; the off-session direct
  charge itself is structurally correct but NOT yet E2E-confirmed — the critical
  MVP risk to close.** Live bidding is card-only (PromptPay can't off-session).
- **Accepted methods** — `different_by_design` · MVP. Card + PromptPay (Stripe TH) only;
  live bidding is card-only by necessity. Narrower parity, on purpose.
- **Failed-payment grace / pay window** — `schema_done` · MVP.
  `stream_wins.payment_status='pay_window'` + `payment_due_at` → on-session retry on
  the existing PaymentModal rail; lapse → `voided` + strike.
- **Buyer strikes / nonpayment** — `schema_done` · MVP.
  `auction_strikes` + `auction_bidding_suspended()` (2/90d) **shared** between the
  auction house and live streams — a deadbeat in either is suspended in both.
- **Order cancellation window (24h)** — `partial` · fast-follow.
  General cancel exists; no live-specific 24h path (consolidated shipment complicates single-lot cancels).
- **Sales tax / VAT facilitator** — `different_by_design` · later.
  TH seller is MOR on direct charges — platform-as-facilitator doesn't apply. Finance review only.
- **Verified-buyer gate / auth hold** — `needs_build` · later. Card-on-file requirement is soft verification.
- **Buyer spend controls** — `needs_build` · later. Good fit for impulse bidding; not MVP.

### Shipping & orders

- **Smart Bundling — one buyer's wins → one shipment** — `schema_done` · MVP.
  The `shipments` table is purpose-built: paid wins from one stream group into ONE
  Flash parcel (one waybill, one fee) at close; `orders.shipment_id` links the
  synthetic orders. Cleanest parity win — structurally matches Smart Bundling.
- **Incremental / weight-tier shipping** — `partial` · MVP.
  Bundle quoted ONCE by combined weight (Flash by weight/destination). **Divergence:
  CardStreet charges shipping once per stream at close, not incrementally per win.** Document it.
- **Flash Express fulfillment** — `schema_done` · MVP.
  `shipments.courier='flash'`, `out_trade_no` UNIQUE (our idempotency key — Flash
  does NOT dedupe outTradeNo), reuses `lib/flashExpress.ts` + delivered webhook + release-funds.
- **Who pays shipping; free-shipping option** — `partial` · fast-follow.
  Buyer pays (own off-session charge at close). No live "seller offers free shipping" toggle.

### Post-show & trust

- **Seller ratings & reviews** — `schema_done` · MVP.
  A live win becomes a synthetic order (`stream_wins.order_id`), so the existing
  `reviews` flow applies unchanged.
- **Buyer Protection / dispute + refund** — `partial` · fast-follow.
  General dispute/refund + VOD evidence exist; no codified claim-window policy or billback.
- **Seller payout / holds / escrow** — `different_by_design` · MVP (flag).
  **KNOWN TH ESCROW GAP: on direct charges the seller receives funds at hammer-time
  and Stripe auto-pays out — there is NO platform-held escrow-to-delivery on TH.**
  Live wins inherit this. Do NOT promote Whatnot-style delivery-gated buyer protection.
- **Seller onboarding / KYC** — `schema_done` · MVP.
  Reuses Stripe Connect Express onboarding; `live_broadcast` grant is the extra host gate.
- **Community-guidelines / account health** — `partial` · fast-follow.
  `auction_strikes` is the enforcement backbone; no assembled account-health dashboard yet.

---

## Legal flags (Thai counsel)

1. **Gambling Act B.E. 2478 is the dominant constraint.** `stream_items.item_type`
   CHECK permits ONLY `auction | buy_now | personal_break`. Razz, random-team/player/
   spot, serial, tiered, Surprise-Set breaks, PYT, and ALL random-draw giveaways/
   sweepstakes are plausibly illegal gambling and are deliberately not representable.
   **Do NOT widen the CHECK or add spot/randomizer/giveaway tables before per-format
   counsel clearance** — the extension point is a NEW migration after clearance, never
   softening the CHECK in place.
2. **PYT breaks** (deterministic but group-buy-splitting-one-box) need the same review.
3. **Escrow / consumer-protection gap:** TH sellers get funds at hammer; no platform
   escrow-to-delivery. Buyers have weaker protection than Whatnot's model implies.
4. **Tipping** (if ever built) to individuals is generally lawful in TH but warrants a check.
5. **High-value-loss / counterfeit liability** for breaks needs a written TH policy.
6. **Impulse-bidding / responsible-selling:** no buyer spend controls; worth a policy note.

## Tech constraints

- **Video = LiveKit Cloud (WebRTC)**, view + broadcast inside the Capacitor Android
  WebView. Only `streams.livekit_*` hooks exist — token route, room lifecycle, egress→VOD unbuilt.
- **Broadcasting needs native camera/mic perms** in `AndroidManifest.xml` + a signed
  AAB release (next versionCode ≥ 18; never build AABs in the stale main tree). A hard
  release dependency — schema readiness does not unblock it.
- **Off-session live charge** is the critical unproven leg (SetupIntent + PM clone
  validated; direct charge pending 2-min test onboarding + watcher E2E).
- **Live bidding is card-only** (PromptPay can't off-session; stays for BIN/checkout).
- **Flash Express** is the only shipper, TH-only (aligns with the purchase-region gate);
  `out_trade_no` must be our idempotency key before the Flash call.
- **Realtime** on `streams`/`stream_items`/`stream_chat_messages`/`stream_wins`/`auctions`
  under RLS keeps the feature dark on the wire; chat sends via API route, not client INSERT.
- **Beta gating** via `requireBeta('live_streams'|'live_broadcast')`. **Code gap:**
  `lib/betaFeatures.ts` still lists only `'auctions'` — must add both flags or the TS gate won't compile.
- **Engine reuse:** a live lot IS an `auctions` row with `mode='live'`; `place_bid()`
  reused UNCHANGED. Do not fork it.
- **Money units:** auction/win money = INTEGER SATANG (BIGINT); orders/shipping = THB
  NUMERIC. Convert at settlement; single source `lib/auctionRules.ts` + SQL mirror.

## Schema gaps (patches the drafted migration is missing for parity)

`follows` (social graph — foundational) · `stream_reminders` · `streams.visibility` ·
`stream_items.sudden_death` · `stream_items.flash_price/flash_ends_at` · multi-quantity
on `stream_items` · `stream_item_prebids` · `stream_moderators` + muted-words +
`streams.pinned_message_id` · `stream_cohosts` · reactions/tips/offers tables ·
per-item video-receipt clips · **`lib/betaFeatures.ts` type extension (code, parity-blocking)**.

---

## Build plan (dependency-ordered; branch-only until launch approval)

- **Phase 0 — Foundations.** Apply migrations in order (`beta_features` → `auction_house`
  → `live_streams`) to the dev/branch DB via `db query --linked` (never `db push`).
  Extend `lib/betaFeatures.ts` (+`useBetaFeatures`) with `live_streams`/`live_broadcast`.
  Smoke-test schema + RLS + realtime. No routes yet.
- **Phase 1 — Close the payment leg (E2E).** `/api/streams/payment-method/{setup,confirm}`
  (SetupIntent off_session, card-only), `lib/stripe.ts` clone-PM + off-session direct
  charge helper, `AddCardToBid` component. **Exit criterion: the off-session direct
  charge captures E2E** (the 2-min test onboarding + watcher). Nothing charges until this passes.
- **Phase 2 — LiveKit video.** Token route (viewer subscribe / seller publish gated by
  `live_broadcast`), go-live/end + egress recording, egress→VOD (30d) + reaper. Ship
  **viewer** first; **broadcaster** (`getUserMedia`) is the native-perms AAB dependency.
- **Phase 3 — Lot control + overlay + bidding.** `sudden_death` patch; lot run/pin/edit/
  reorder routes; `place_bid` one-tap wiring (Secret Max as fast-follow); `StreamOverlay`,
  `BroadcasterConsole`, `QuickBidBar`.
- **Phase 4 — BIN, personal breaks, hammer charge worker.** Buy route; charge worker
  (record_win → off-session charge → paid | pay_window); void sweep → strike; system
  chat rows; win toasts. Real-payment E2E (hammer→paid, decline→retry, lapse→void).
- **Phase 5 — Chat + moderation.** Send route (rate-limit + ban + freeze), moderate route
  (ban/delete/freeze), `StreamChat`. `stream_moderators` + muted-words as fast-follow.
- **Phase 6 — Shipment consolidation + settlement on close.** `/api/streams/[id]/settle`:
  group paid wins → one `shipments` row + synthetic orders; quote Flash ONCE; charge
  shipping as its own off-session PI; waybill via `flashExpress.ts`. Reviews unchanged.
  Surface the escrow-gap flag (ops/legal).
- **Phase 7 — Discovery & channel.** `follows` + `stream_reminders` + `streams.visibility`
  patches; live-now + following feeds; go-live push (FCM/Courier); `/stream/[id]` deep link;
  feed/schedule/follow/share components.
- **Phase 8 — Fast-follow parity fills.** Flash Sale, in-stream Secret Max UI, live-reserved
  flag, buyer 24h cancel, break claim workflow, seller analytics, mention/pin/muted-words, video-receipt clips.
- **Phase 9 — Reserved extension points (build nothing).** Legally-gated formats (per-format
  counsel), later/large items (pre-bids, multi-qty, offers, tipping, reactions, co-host, OBS,
  Boost, spend controls), infeasible/divergent (variants, Android multicast, custom
  increments, tax-facilitator, Rewards Club). Keep the whole feature dark until sign-off.
