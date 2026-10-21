# Slab Packs — mechanics and design

Mystery packs that each hold one real graded slab. The buyer rips the pack, the slab is revealed, and they keep it, have it shipped, or sell it back on the spot for credit.

**Status (2026-10-01): playable prototype behind the admin wall, at `/packs`.** It covers the mechanics and the full mobile experience. It takes no money: there is no inventory, wallet, payment or shipping behind it yet. See [What is real and what is stand-in](#what-is-real-and-what-is-stand-in).

## The mechanic: sealed series

A pack is not a dice roll. Each tier sells **series**: a fixed list of real slabs, shuffled once when the series opens. Buying a pack takes the next slab off that list.

Three things follow, and they are why it is built this way:

- **Nothing is decided at purchase time.** The slab in pack 37 was fixed when the series was sealed. A fingerprint (SHA-256) of the order is published at that moment; when the series sells out the seed is released and anyone can check that nothing was moved.
- **The odds are a count, not an estimate.** What is shown is what is still sealed, so the odds can never drift from the truth the way a printed percentage does once a chase card has been pulled. The chance for the next pack changes as the series sells.
- **The house result on a series is known when it is built.** Packs sold times price, against the cost of exactly those slabs. There is no pull variance to fund.

It also gives the lobby its pull: a finite pool everyone can see draining, with the chase slabs marked as they go.

### The ladder

Single source of truth: [lib/slabPacks/tiers.ts](../../lib/slabPacks/tiers.ts). All numbers are working defaults for the prototype and have not been through pricing or legal review.

| Tier | Pack price | Packs per series | Odds when a series opens (D / C / B / A / S / SS) |
|---|---|---|---|
| Spark | ฿1,490 | 120 | 46.7% / 31.7% / 14.2% / 5.0% / 1.7% / 0.8% |
| Surge | ฿3,490 | 100 | 47% / 32% / 14% / 4% / 2% / 1% |
| Nova | ฿6,990 | 80 | 47.5% / 32.5% / 13.8% / 3.8% / 1.3% / 1.3% |
| Eclipse | ฿14,900 | 60 | 50% / 30% / 13.3% / 3.3% / 1.7% / 1.7% |
| Apex | ฿34,900 | 50 | 50% / 32% / 12% / 2% / 2% / 2% |

### Hit classes

A class is a band of slab value relative to the pack price, so the same slab is an SS in a cheap pack and a D in an expensive one.

| Class | Name | Value as a multiple of the pack price |
|---|---|---|
| D | Base | 0.45 to 0.62 |
| C | Solid | 0.62 to 0.90 |
| B | Hit | 0.90 to 1.5 |
| A | Big Hit | 1.5 to 3.5 |
| S | Monster | 3.5 to 8 |
| SS | Grail | 8 to 30 |

- **Floor:** a slab worth less than 45% of the pack price is never put in that tier's packs. The worst pull is a real guarantee.
- **Average value:** the series builder steers each manifest to 90% of the pack price (`TARGET_EV`). The real figure is computed from the manifest and shown to the buyer.
- **Sell-back:** 85% of market value, instantly, as credit (`sellBackRate`).
- **Last-pack bonus:** whoever buys the final pack of a series also gets an extra A-class slab. It gives a picked-over series a reason to be finished, which is the usual weakness of a finite pool.

With those defaults a sold-out series keeps about 10% of gross if every slab is shipped (slabs valued at market) and about 23.5% if every slab is sold back. Sell-backs return the slab to stock at 85% of market, so the second figure is closer to buying inventory at a discount than to margin. `npx tsx scripts/check-slab-packs.ts` prints these per tier.

## The experience

Mobile-first: one 480px column, centred on anything wider. Always dark, whatever the app theme.

### Navigation

- **Packs** (lobby): pack carousel, price, the series pool, the chase board, live odds for the next pack, and the buy dock.
- **Vault:** slabs kept, slabs still face-down, slabs sold back. A slab opens to a tiltable view with sell-back and ship.
- **Pulls:** the live feed and the buyer's own history and totals.
- **Odds and details** (sheet): average value, floor, sell-back rate, what is still sealed by class, the last-pack bonus, the series seal and past seals verified.
- The Android back button and the iOS back swipe close whatever is on top (a sheet, the opening) before they leave the feature.
- Slabs bought but not yet flipped (the app was closed mid-opening) wait in the vault and can be revealed from there.

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

- The whole sequence is theatre over a result that is already fixed and already owned. It can be skipped at any point (tap during the tell, "Reveal all" on a multi-pack, the Fast reveals setting).
- From tap to reveal is about 2.7 seconds for a D and about 5 for an SS. Fast reveals is about 1.4.
- `prefers-reduced-motion` gets the same sequence without shake, spin, particles or travelling poses.

### Sound and haptics

- **Sound** is built at play time with Web Audio ([lib/slabPacks/sfx.ts](../../lib/slabPacks/sfx.ts)): no audio files to download or license, and each layer can follow the gesture or the pull. The physical sounds are modelled on the objects: foil is crackle (random bursts through the resonances of thin film, played faster as the finger moves faster), a slab is an acrylic knock, coins are metal. The musical layer stays in one key; an SS reveal climbs through three chords.
- **Sound check:** the preview menu has a board that plays each sound on its own, and the full build-up, flip and reveal for each class. Use it to judge a sound without waiting to pull the hit that plays it.
- If the modelled rip still falls short, the surest upgrade is a recording of a real pack being torn, dropped in as a sample for the tear and burst.
- **Haptics** use the Vibration API, which works on Android (browser and the app) and is a no-op on iOS. iPhones need `@capacitor/haptics`, which the app does not ship yet.

## What is real and what is stand-in

| Piece | State |
|---|---|
| Tier ladder, hit classes, floor, sell-back maths | Real. `lib/slabPacks/tiers.ts`. |
| Series builder, draw, live odds, fairness seal | Real and tested. `lib/slabPacks/engine.ts`, checked by `scripts/check-slab-packs.ts`. |
| UI, animation, sound, navigation | Real. `components/slabPacks/`. |
| Slabs | **Stand-in.** Real catalog cards with real PSA 9/10 market prices (`lib/slabPacks/demoPool.ts`), not stock Cardstreet holds. |
| Credits, vault, series state | **Stand-in.** Play money and state in the browser's localStorage (`lib/slabPacks/previewStore.ts`). The seed is in the browser too, so the seal is demonstrated, not secure. |
| Other collectors in the feed | **Simulated**, labelled, and switchable off in the preview menu. |
| Payment, wallet ledger, shipping, KYC | **Not built.** |

## Access

- `/packs` is open to `profiles.role = 'admin'` only ([lib/slabPacks/access.ts](../../lib/slabPacks/access.ts)). Everyone else gets the same 404 as a route that does not exist.
- The door is a "Packs" pill in the mobile Shop tab's section switch, shown to admins only. `/api/beta/status` now also returns `isAdmin` for this.
- It is deliberately not a `lib/betaFeatures` entry yet: that system's kill switch needs a seeded `beta_feature_flags` row, and nothing here touches money. When packs take payments, give them a `BetaFeature` and put every money-touching route behind `requireBeta()`.
- Local development: `SLAB_PACKS_DEV_OPEN=1` in `.env.local` opens the page without a session. It is ignored unless `NODE_ENV` is `development`.

## Development

- **Check the mechanics:** `npx tsx scripts/check-slab-packs.ts`. Asserts composition totals, average value within 5 points of target over 200 seeds per tier, the floor, determinism, seal verification, tamper detection, no over-draw, and the bonus paid once.
- **Refresh the preview pool:** `node scripts/slab-packs-preview-pool.mjs --write`, then run the check.
- **Look at one opening** (development only, see [lib/slabPacks/debug.ts](../../lib/slabPacks/debug.ts)):
  - `/packs?demo=nova:ss` opens one Nova pack that is an SS pull.
  - `/packs?demo=spark:d,b,a` opens three slabs of those classes.
  - `&auto=1` cuts the pack without a gesture; `&still=1` turns all motion off.
- **See it move without a phone:** `node scripts/slab-packs-visual-check.mjs walk` taps through every screen in headless Chrome at a phone viewport and screenshots each; `... open nova:ss` records one opening, with a real swipe across the pack, as a filmstrip. Output goes to `scripts/out/slab-packs/`. Needs the dev server and Chrome.
- **Browser floor:** the styles use container-query units, `color-mix()` and `dvh`, so the page needs iOS 16.2 or later and a current Android WebView or Chrome. It has only been run in desktop Chrome with phone emulation: not yet on a real phone, in the Capacitor app, or in Safari.
- **Not verified by ear:** the sounds were checked by rendering each one offline and measuring level, length and clipping. Nobody has listened to them yet.

## What a real launch needs

In rough order of dependency. None of it is engineering-first; see the repack evaluation notes for the payment-rail and legal findings.

1. **Inventory.** Real slabs, each with a cert number, cost and custody record. The series builder already takes `Slab[]`; feed it from an inventory table and delete `demoPool.ts`.
2. **Server-side series.** Tables for series, manifest and pulls; `buy` becomes one call that moves the series pointer under a row lock and returns the pulls. The seed stays on the server until the series sells out. The UI reads the same state shape and does not change.
3. **Wallet ledger.** Two balances if sell-back is ever cash: withdrawable sell-back proceeds, and non-withdrawable top-ups. Whether sell-back pays cash or credit is still open, and it decides the payment rail.
4. **Payment rail and written approval** for randomised physical goods, kept separate from the marketplace's Stripe Connect account so a risk action cannot stop seller payouts.
5. **Legal and compliance:** the gambling-law opinion, VAT as merchant of record, Direct Sales Act registration, AMLO KYC.
6. **Fulfilment:** custody, shipping a slab safely, insurance.
7. **Native haptics** on iOS, and a pass by a native Thai speaker over the Thai copy.
