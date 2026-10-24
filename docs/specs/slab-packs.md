# Slab Packs (Digital Packs) — mechanics, money and design

Mystery packs that each hold one real graded slab, sold per game (Pokémon, One Piece, Lorcana to start; a switch above the packs picks the game, and each game has its own pool and its own odds tables). The buyer rips the pack, the slab is revealed, and they keep it in the vault (where it is part of their Cardstreet collection), sell it back on the spot for wallet credit, list it on the Cardstreet marketplace, or have it shipped.

**Status (2026-10-24): playable prototype behind the admin wall, at `/packs`.** It covers the mechanics, the money rules and the full mobile experience. It takes no money: card payments are simulated, the wallet, the identity checks, the listings and the shipments are browser state. See [What is real and what is stand-in](#what-is-real-and-what-is-stand-in) and [Connecting to the rest of Cardstreet](#connecting-to-the-rest-of-cardstreet).

## The mechanic: fixed, published odds

A pack is one independent draw from a published table. Each tier shows, before purchase, every card the pack can contain and the exact chance of each. The chances never move: a pull does not change the odds of the next pull, nothing is counted down, and nothing is shown as pulled or gone. A card that is pulled is restocked, not crossed off. This is the model the large digital-pack operators run (Courtyard shows per-card odds that update only when the pool itself changes, with "real-time odds" meaning the table, not a countdown).

**Fairness is per pull, commit-then-reveal.** Before the pack is ripped the buyer is shown a fingerprint (SHA-256) of a secret seed. After the reveal the seed is published. The draw is a pure function of the seed, the buyer's own client seed and the table, so hashing the seed checks the fingerprint and re-running the draw checks the card. The house cannot pick the result once the fingerprint is out, and cannot pick the seed alone because the buyer's seed is mixed in. The slab's page in the vault runs this check and shows Verified.

**What this changes against the earlier sealed-series design.** The house result is no longer fixed per series; it has pull variance, funded by the margin between pack price and average value and by the sell-back spread. Stock has to be managed so that every class always has cards (a chase that is pulled must be replaced before the next sale, or the tier is paused). In exchange the buyer sees a stable table with no "someone else got the grail" tells, which is what the founder asked for.

### The ladder

Single source of truth: [lib/slabPacks/tiers.ts](../../lib/slabPacks/tiers.ts). The names and prices are the founder's (2026-10-24), after the NBA 2K card tiers, in steps of ฿775; the odds are working defaults that have not been through pricing or legal review.

| Tier | Material | Pack price | Odds (D / C / B / A / S / SS) | Average pull | Floor | Top prize |
|---|---|---|---|---|---|---|
| Silver | metal | ฿775 | 44% / 30% / 20% / 4% / 1.4% / 0.6% | 96% | ฿411 | ฿22,834 |
| Gold | metal | ฿1,550 | 45% / 30% / 19% / 4% / 1.4% / 0.6% | 94% | ฿786 | ฿44,643 |
| Platinum | metal | ฿2,325 | 45% / 30% / 19% / 4% / 1.3% / 0.7% | 96% | ฿1,191 | ฿67,857 |
| Emerald | gem | ฿3,875 | 46% / 30% / 18% / 4% / 1.2% / 0.8% | 95% | ฿2,059 | ฿107,143 |
| Diamond | gem | ฿7,750 | 47% / 30% / 17% / 4% / 1.2% / 0.8% | 95% | ฿3,929 | ฿232,143 |
| Galaxy Opal | galaxy | ฿15,500 | 48% / 30% / 16% / 4% / 1.2% / 0.8% | 96% | ฿8,036 | ฿459,265 |

Average pull, floor and top prize are the Pokémon pool's; One Piece and Lorcana land within a point or two of the same averages with thinner pools at the dear end (a tier a game's pool cannot fill is simply not offered for that game).

Emerald's price is an assumption: the brief listed both Emerald and Diamond at ฿7,750, so Emerald took the ฿775 × 5 step between Platinum and Diamond. It is one constant in `tiers.ts`.

The shape follows what Courtyard's pulls measure out to (PackSpy, ~10,000 Pokémon pulls): nothing under half the price, 71% under the price, 26% paid for itself, 2% a good hit, well under 1% beyond 5x. The average pull targets 95% of the price (`TARGET_EV`), where Courtyard sits; the margin is taken in the 85% sell-back, not the pull. Average pull, floor and top prize are computed from the pool, not assumed (`npx tsx scripts/check-slab-packs.ts` prints them per game).

**Materials.** Each tier declares a material (`theme.material`) that drives the pack surface, the lobby's ambient light and the opening stage, the way NBA 2K dresses a pull by tier: **metal** is brushed foil with a hard specular sweep and almost no rainbow (Platinum keeps a faint cool iridescence); **gem** is foil cut into facets that catch light one at a time, with twinkling sparkle points; **galaxy** is a drifting nebula with a star field, the full prismatic holo, a gradient wordmark, and the stage's rainbow rays on every pull. The CSS lives under `[data-material]` in `slabPacks.css`; the pack emblem per tier is in `components/slabPacks/ui.tsx` (medal, crown, hexagon badge, emerald cut, brilliant cut, ringed planet).

### Hit classes

A class is a band of slab value relative to the pack price, so the same slab is an SS in a cheap pack and a D in an expensive one.

| Class | Name | Value as a multiple of the pack price | On a ฿775 Silver |
|---|---|---|---|
| D | Base | 0.5 to 0.7 | ฿388 – ฿543 |
| C | Solid | 0.7 to 1 | ฿543 – ฿775 |
| B | Hit | 1 to 2 | ฿775 – ฿1,550 |
| A | Big Hit | 2 to 5 | ฿1,550 – ฿3,875 |
| S | Monster | 5 to 10 | ฿3,875 – ฿7,750 |
| SS | Grail | 10 to 30 | ฿7,750 – ฿23,250 |

The lobby and the odds sheet show each class as its name, its odds and its money range for the pack on screen (no card counts). Any card on the top-pulls strip or in the odds sheet's list opens with its own chance.

- **Floor:** a slab worth less than half the pack price is never put in that tier's packs.
- **Within a class** the draw leans toward the cheaper cards; the lean is chosen per tier so the average pull lands near `TARGET_EV` (90%). The per-card odds shown to the buyer are the real weights.
- **Average value:** the target is a design knob. The repack evaluation argued for 70–75% for Cardstreet; Courtyard runs ~96–100% and takes its margin in the buyback. Nothing here decides that; it is one constant.

## Money

Single source of truth: [lib/slabPacks/policy.ts](../../lib/slabPacks/policy.ts). The shape mirrors the operators that run this at scale; the numbers are working defaults.

### Paying for a pack

- **Card or PromptPay at purchase**, like any Cardstreet order. There is **no stored-value top-up**: the platform never issues credit a user has bought, so there is no e-money and nothing to withdraw that was deposited.
- **Wallet credit** (below) can pay for a pack when it covers the full price.
- **Cardstreet coins** can pay for a pack at the coin's existing redemption value, **100 coins = ฿1** (one coin is one satang everywhere else in Collector Pass). Coins only ever buy packs; they are never paid out and never become wallet credit. A coin-paid pack is a real-cost redemption and counts against the monthly reward budget. A card-paid pack earns coins (1 per baht), the same proportion as the market leader's points.

### After a pull

| Exit | Rule | Why |
|---|---|---|
| **Keep** | The slab stays in the vault and appears in the collector's Cardstreet collection, priced with the rest of it. | Pulls are collection items, not a separate ledger. |
| **Sell back** | Instant, 85% of market value, paid as wallet credit. | The cheap, fast exit; the house recycles the slab. |
| **List on Cardstreet** | A **5% seller fee instead of the usual 9%**. The slab stays in the vault while listed; when it sells Cardstreet packs and ships it, and the payout lands in the wallet. Shipping is inside the price, like every listing. | Keeps the card and the money on the platform. Courtyard charges 0% to relist a vaulted pull for the same reason. |
| **Ship to me** | A three-step flow, nothing prefilled: (1) name, phone and address typed in; (2) a quote that "calculates" (฿1,200 flat, about USD 35; the 14–21 day window as dates; optional transit insurance at 1.5% of market value, ฿50 minimum; the terms to accept: paid up front, no cancellation, once out of the vault no sell-back or listing); (3) a checkout that takes shipping plus insurance up front, from the wallet when it covers the total, else by card. | Deliberate friction. Courtyard: KYC before redemption, shipping at cost, up to 10 business days processing plus transit, $2 per card surcharge in busy periods. |

### The wallet

- Holds **only** what sell-backs have paid in. No top-ups.
- Spendable at once on packs, and (once built) on the marketplace.
- **Cash-out** is slow by design: identity **and** a Thai bank account in the same name verified first; sell-back credit held **7 days** before it can be withdrawn (the dispute window); **฿1,000 minimum**; **3% fee, ฿50 minimum**; **฿100,000 per rolling 30 days**; **5–7 business days** to the bank. Each rule is one constant in `policy.ts`. Courtyard requires KYC before the first withdrawal and lets its payout partner impose its own.
- Verification is three separate checks, each done once: **identity** (ID + selfie, vendor review), **address** (confirmed on the account, SMS code), **bank** (passbook or statement, name matched to the ID).

### Not a virtual currency

The founder's steer: no VC, no crypto rail. Courtyard's wallet is USDC under the hood and its withdrawals run through a crypto-native payout partner; that is what lets it pay cash buybacks outside card networks. Cardstreet's version keeps everything in baht on a card rail: packs are card purchases, the wallet is a ledger of money Cardstreet already owes the collector, and cash-out is a bank transfer that the platform settles. The repack evaluation's finding still stands: the variable that pushes an operator off mainstream rails is user-withdrawable cash. The friction above exists to keep withdrawals rare and reviewable, but the rail question (written pre-approval from the payment provider for a product with cash-out) is a launch gate, not something the prototype resolves.

## The experience

Mobile-first: one 480px column, centred on anything wider. Always dark, whatever the app theme.

### Navigation

- **Packs** (lobby): pack carousel, price, a one-line summary (average pull and top prize), the top pulls strip (the dearest cards with their chance), the class odds, and the buy dock with the payment method (Card / Wallet / Coins).
- **Packs** also carries the game switch (Pokémon / One Piece / Lorcana) above the carousel; the pack face names the game.
- **Vault:** slabs held (kept, listed, shipping), slabs sold back, and the "in your Cardstreet collection" line with a link to the collection. A slab opens to a tiltable view with sell-back, list, ship, its status (a shipment shows the recipient, the window, the fee and whether it is insured), and the fairness check.
- **Pulls:** the live feed and the buyer's own history and totals.
- **Odds & cards** (sheet): average pull, floor, top prize, the odds by class, every card in the pack with its chance, how fairness works, and the four rules.
- **Wallet** (sheet, from the header chip): balance, what is withdrawable now, coins, pending transfers, the ledger, and the cash-out flow with its verification checklist.
- The Android back button and the iOS back swipe close whatever is on top before they leave the feature. Slabs bought but not yet flipped wait in the vault and can be revealed from there.

### The opening

| Beat | What happens |
|---|---|
| Present | The pack drops onto the stage. |
| Cut | A finger drags a line of light across the top seal; the hiss, the pitch and the sparks follow it. A tap does it for them. |
| Burst | The seal comes away and light spills out. |
| Rise | The slab lifts out face-down and the pack falls away. |
| Tell | The glow starts steel-grey and climbs one class at a time to the slab's real class: green, blue, violet, gold, rainbow. The longer it keeps climbing, the bigger the pull. |
| Flip | A beat of dark and silence, then the slab turns over. |
| Reveal | Class stamp, effects scaled to the class, the value counts up. Keep or sell. |

- The whole sequence is theatre over a result that is already fixed and already owned. It can be skipped at any point.
- From tap to reveal is about 2.7 seconds for a D and about 5 for an SS. Fast reveals is about 1.4.
- `prefers-reduced-motion` gets the same sequence without shake, spin, particles or travelling poses.

### Sound and haptics

- **Sound** is built at play time with Web Audio ([lib/slabPacks/sfx.ts](../../lib/slabPacks/sfx.ts)): no audio files to download or license. Foil is crackle, a slab is an acrylic knock, coins are metal. The musical layer stays in one key; an SS reveal climbs through three chords.
- **Sound check:** the preview menu has a board that plays each sound on its own.
- **Haptics** use the Vibration API (Android only; iPhones need `@capacitor/haptics`, which the app does not ship yet).

## What is real and what is stand-in

| Piece | State |
|---|---|
| Tier ladder, hit classes, odds, floor, sell-back maths | Real. `lib/slabPacks/tiers.ts`. |
| Table builder, draw, per-pull fairness proof | Real and tested. `lib/slabPacks/engine.ts`, checked by `scripts/check-slab-packs.ts`. |
| Money rules: fees, shipping, cash-out, coins | Real as constants. `lib/slabPacks/policy.ts`. |
| UI, animation, sound, navigation | Real. `components/slabPacks/`. |
| Slabs | **Stand-in.** Real catalog cards with real PSA 9/10 market prices (`lib/slabPacks/demoPool.ts`, ~700 slabs across the three games), not stock Cardstreet holds. |
| Card payment | **Simulated**, instant and always successful. |
| Wallet, ledger, cash-out requests | **Stand-in.** Browser state (`lib/slabPacks/previewStore.ts`). The seed of every pull is generated in the browser, so the fairness proof is demonstrated, not secure. |
| Identity, address, bank verification | **Mock.** A sheet that "reviews" for a moment and flips a flag. |
| Marketplace listing, shipment | **Stand-in.** Status on the pull; nothing is posted and nothing moves. |
| Coins | **Demo balance**, not `rewards.coin_balance`. |
| Other collectors in the feed | **Simulated**, labelled, and switchable off in the preview menu. |

## Connecting to the rest of Cardstreet

Mapped on 2026-10-23 against the live schema. Short answer to "is it ready to connect to the marketplace": **no, not yet**, and the gaps are specific.

### Collection (the Vault tab)

- Pulls fit: a `collection_items` row per pull (`card_id`, `card_data` snapshot via `buildSnapshot`, `quantity: 1`, `is_graded`, `grading_company: 'PSA'`, `grade`), under the user's first collection, written server-side with the admin client the way `app/api/collection/bulk-import` does. Collection value is the sum of `card_data.marketPrice`, so the graded value must be written into the snapshot at insert time (bulk-import's `unitValueThb` already does this from the `PSA 10` / `PSA 9` rows in `market_values`).
- Missing: columns for **custody** (`cardstreet_vault`), **cert number**, **source** (pull id) and a **listing link**. Without custody the Vault would offer "List" through the ordinary seller flow, which assumes the user holds the card.
- Known defects to fix on the way: the client `addCardToCollection`, `updateCollectionItem` and `lib/fulfillOrder.ts` all drop the grading columns; `collection_items` rejects `TAG` while `listings` accepts it; vault snapshots are never re-priced.
- The `trg_award_collection_item` trigger will fire on the insert (vault XP, `first_vault` coins). Decide whether a pull should earn it.

### Marketplace listing

- Today a listing needs the **seller's own Stripe Connect account** (`stripe_details_submitted`, `charges_enabled` at purchase), **front and back photos** in the `listing-images` bucket for anything graded or ≥฿100 (enforced by a DB trigger, service-role writes included), and shipping that the seller does from their own address with Flash.
- A vaulted pull breaks all three: the user has no card to photograph or ship, and may have no Connect account. What is needed is a **custody listing**: `seller_id` = the user, a `custody` flag, Cardstreet's own photos of the slab (taken at intake, stored in `listing-images` so the trigger passes), fulfilment by Cardstreet from the vault, and the payout credited to the pull wallet instead of a Connect transfer. The direct-charge rail cannot pay the user (no Connect account), so the buyer's payment must land on a **house account** and the seller side becomes a wallet credit. The house `admin` seller path (fee 0) already exists in checkout; a custody listing is a variant of it with the fee and payout redirected.
- The **5% fee** has no hook today: checkout derives the fee from the seller's tier (9% / partner ladder / admin 0 / Pro 5%) with no per-listing override. The `feeMap` loop in `app/api/orders/checkout/route.ts` is where a custody listing's rate goes.
- Nothing of this exists yet. The auction settlement (`lib/auctionSettlement.ts`, synthetic sold listing + pending order) is the nearest precedent for "a listing the system creates on the user's behalf".

### Wallet and cash-out

- There is **no wallet or store credit anywhere**; coins are the only balance, and a guide tells users there is no wallet to withdraw from. The pull wallet is a new ledger: `pack_wallet_ledger` (user, kind, amount, ref, created_at) with the balance derived, a `cashout_requests` table with status and the holding-period and cap rules from `policy.ts` enforced server-side, and payouts made by the ops team (bank transfer) with the request as the audit trail.
- Verification: `profiles` has shipping fields but no identity or bank verification. A KYC vendor (Courtyard uses Persona) and two new profile flags are needed before cash-out or shipping can be enforced. AMLO e-commerce KYC applies from 1 May 2026 regardless.

### Payment

- Every live charge is a **direct charge on a seller's connected account**. A pack is sold by Cardstreet, so it needs its own PaymentIntent on the TH platform account (as the disabled Pro subscription does), a `pack_` `transfer_group` branch in `lib/stripeWebhook.ts`, and its own finalize path. Spending wallet credit or coins on a pack is a server-side debit with no Stripe call.
- Written pre-approval from the payment provider for randomised physical goods with cash-out, kept separate from the marketplace's Connect account, remains the gate the repack evaluation named.

## Access

- `/packs` is open to `profiles.role = 'admin'` only ([lib/slabPacks/access.ts](../../lib/slabPacks/access.ts)). Everyone else gets the same 404 as a route that does not exist.
- The door is the Digital Packs tile in the Shop hub (itself grant-only).
- It is deliberately not a `lib/betaFeatures` entry yet. When packs take payments, give them a `BetaFeature` and put every money-touching route behind `requireBeta()`.
- Local development: `SLAB_PACKS_DEV_OPEN=1` in `.env.local` opens the page without a session. It is ignored unless `NODE_ENV` is `development`.

## Development

- **Check the mechanics:** `npx tsx scripts/check-slab-packs.ts`. Asserts the class odds and the per-card odds sum to 1, every card sits in its band, the floor, the average pull within 8 points of target, a deterministic table and draw, an honest draw verifying and tampered seeds or commits failing, and 40k draws landing on the published odds. Run it before changing a tier, a band or the engine.
- **Refresh the preview pool:** `node scripts/slab-packs-preview-pool.mjs --write` (reads PSA 9/10 rows from `market_values` with the public key, keeps mirrored art, samples 10 slabs per game per log-spaced value bucket from Silver's floor to Galaxy Opal's ceiling), then run the check. Re-run it whenever a tier price moves outside the pool's range or a game is added (`PACK_GAMES` in `tiers.ts` and `GAMES` in the script).
- **Look at one opening** (development only): `/packs?demo=opal:ss`, `/packs?demo=silver:d,b,a`, `&auto=1`, `&still=1` ([lib/slabPacks/debug.ts](../../lib/slabPacks/debug.ts)).
- **Drive it without a phone:** in the desktop app's browser pane a mobile-emulated tap zooms the page instead of pressing; dispatch pointer events from `javascript_tool` for the swipe (see the memory note on browser automation).
- **Browser floor:** container-query units, `color-mix()` and `dvh`, so iOS 16.2 or later and a current Android WebView.
- **Thai copy** was written by the engineer and needs a native pass.

## What a real launch needs

In rough order of dependency. See [Connecting to the rest of Cardstreet](#connecting-to-the-rest-of-cardstreet) for the schema detail.

1. **Inventory.** Real slabs, each with a cert number, intake photos, cost and custody record. The table builder already takes `Slab[]`; feed it from an inventory table and delete `demoPool.ts`. Stock rules: every class must always have cards; a pulled chase is replaced before the next sale.
2. **Server-side draws.** `buy` becomes one call that charges the card (or debits wallet / coins), generates the seed server-side, stores the commit with the pull, and returns the pulls. The seed is released at reveal.
3. **Collection rows** per pull with custody, cert and source columns.
4. **Wallet ledger, cash-out requests, verification flags** and the ops payout process.
5. **Custody listings** on the marketplace with the 5% fee, house-account charge and vault fulfilment.
6. **Payment rail and written approval**, separate from Connect.
7. **Legal and compliance:** gambling-law opinion, VAT as merchant of record, Direct Sales Act, AMLO KYC.
8. **Fulfilment:** vault custody, insured shipping, the 14–21 day SLA.
9. **Native haptics** on iOS and a Thai copy pass.
