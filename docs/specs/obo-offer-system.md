Confirmed: `/api/checkout` derives the amount from the DB orders (`total_amount + shipping_fee`) and the fee from `platform_fee`, never from the client. So once `/api/orders/checkout` writes the overridden amount into the orders, `/api/checkout` charges correctly with no offer-specific change. The spec's §6.2 is the single correct seam.

I have complete grounding. Here is the deliverable.

---

## Verification changelog

**Corrected (factual errors that would break the build):**

1. **`marketplaceService.createListing` does NOT POST to `/api/listings`.** It inserts **directly** into the `listings` table via the browser Supabase client (`services/marketplaceService.ts:230-249`) under RLS policy `"Users can create own listings"` (WITH CHECK `auth.uid() = seller_id`), then fire-and-forgets to `/api/alerts/listing-created` (not `/api/listings`). The spec's claim that the toggle "flows through the shared form → `createListing` → POST `/api/listings`" is wrong. **The primary write path for `accepts_offers` is `createListing`'s insert object plus the two shell handlers that call it** — modifying `/api/listings/route.ts` alone would persist nothing. Rewrote §2.2 and the file-change list accordingly.

2. **`components/ListingForm.tsx` `listingData` (:163-172) has no `card_data` and no server round-trip.** It passes `card_id`, `price`, `condition`, `is_graded`, `grading_company`, `grade`, `image_front_url`, `image_back_url`. Adding `accepts_offers: acceptsOffers` here is correct, but it must then be threaded through `createListing`'s params/insert and both shell handlers (`app/page.tsx:1031` `handlePublishListing`; `components/desktop/DesktopSell.tsx:134` `publishListing`). Confirmed line refs.

3. **Desktop sell handler path was wrong.** Spec cited `app/desktop/sell/page.tsx` `publishListing` (:131-157). That file is a 11-line Suspense wrapper; the real `publishListing` handler is in **`components/desktop/DesktopSell.tsx:131`**. Corrected everywhere.

4. **`app/api/orders/checkout/route.ts` does not import `after`** (only `NextResponse` from `next/server`, line 29). The spec's §7.2 Hook 2 uses `after(async () => …)` in that route — it would need `after` added to the import. Flagged; and since the spec already recommends **shipping Hook 1 only**, Hook 2 is downgraded to explicitly-optional with the import caveat called out.

5. **`fulfillOrder` never flips listings to `sold`.** The only `active → sold` transition in the codebase is the checkout **reservation CAS** at `app/api/orders/checkout/route.ts:382` (before payment). `fulfillOrder`'s CAS flips **orders** `pending_payment → paid` (`lib/fulfillOrder.ts:97-127`). Hook 1 still belongs in `fulfillOrder` (it reads the sold listings at `:147-150` and is the authoritative post-payment point), but I corrected the spec's implication that fulfillOrder is where the listing "sells." Clarified the timing window and why Hook-1-only is correct.

6. **The function is `fulfillOrdersByTransferGroup`, not `fulfillOrder`** (the *file* is `lib/fulfillOrder.ts`). Corrected the name.

7. **`/api/checkout` needs NO offer-price change.** It derives the charge amount and `application_fee_amount` from the **orders** table (`total_amount + shipping_fee`, `platform_fee` — `app/api/checkout/route.ts:22-23, 260-267`), not from listing price. So once §6.2 writes the overridden values into the orders in `/api/orders/checkout`, `/api/checkout` charges the discounted amount automatically. Removed the implication (§11) that `/api/checkout` re-derives price; clarified it's already covered.

8. **Missing market-pricing interaction.** `services/marketData/pricingCalculator.ts:159-180` (`calculateThaiCardPrice`) and `supabase/functions/daily-market-update/index.ts:381` read `listings WHERE status='sold'` and average `price` as CardStreet **internal sales**. A paid accepted offer produces a `sold` listing at the (discounted) `offer.amount`, so **offer sales feed the internal-sales market average**. The spec never mentioned this. Added as a documented cross-feature interaction (§10 + §6 note). It is not a defect for launch but must be acknowledged for Feature B pricing integrity.

**Confirmed accurate:**

- `listings` base table + columns `supabase/migrations/20260124_initial_schema.sql:39-53`; RLS convention `:94-209`; `listings.price DECIMAL(10,2)` at `:44`.
- Listing-form grading toggle to mirror `components/ListingForm.tsx:272-283`; grading detail block ends `:314`; Photos section starts `:316`; `isGraded` state `:31`.
- `app/api/listings/route.ts` Zod schema `:13-21`, insert object `:145-159` — real (just not the shells' path).
- `components/ListingDetails.tsx` action bar `:275-290` (Add to Cart :276-282, Buy Now :283-289).
- Checkout price derivation `:328`, platform fee `:329`, order-build loop `:326-354`, reservation CAS `:380-402`, order insert `:405-414` — all correct.
- `fulfillOrder` CAS `:97-127`, sold-listing re-read `:147-150`, inventory move `:172-195` — correct.
- Courier pattern: `TEMPLATES` object `lib/courier.ts:44-55`, `getUserNotifContext` defaults `:77-81`, `sendSoldNotification` `:114-154`, template-id-from-Send-tab warning `:45-49`, `template:`+`data:` (never `content:`) convention — correct.
- Cron pattern `app/api/cron/reconcile-shipments/route.ts` (`createAdminClient` from `lib/supabase/admin`, `runtime='nodejs'`, Bearer `CRON_SECRET`, time budget) — correct (its `maxDuration` is 120, not 60; expire-offers using 60 is fine).
- `vercel.json` crons array present; adding one entry is correct.
- `orders` table: `gen_random_uuid()` PK, **no CHECK on `status`** (`supabase/migrations/20260221_orders_schema.sql:2-15`), so `accepted_order_id REFERENCES orders(id)` is safe.
- `notification_preferences` (`:2-13`): base cols `sold_*`/`label_*`/`shipped_*`, `gen_random_uuid()` PK, a **"System can read" RLS SELECT `USING(true)`** so the service-role/edge reads work; ADD COLUMN for the 10 `offer_*` prefs is additive and safe.
- No pre-existing `offers` table, `accepts_offers` column, or `NEXT_PUBLIC_ENABLE_OFFERS` flag — clean slate.
- Feature A does **not** write `market_values` at all (grep-confirmed) — the `'jp'`-not-`'ja'` and grade-in-`condition` cautions apply only to Feature B and are noted so a future implementer doesn't trip on them.

**Minor notes folded in:** `offers.amount DECIMAL(10,2)` exactly matches `listings.price` but `orders.total_amount` is untyped `NUMERIC` (not a defect). `uuid_generate_v4()` works (uuid-ossp enabled at initial schema `:2`), though `orders`/`notification_preferences` use `gen_random_uuid()`; I switched the offers migration to `gen_random_uuid()` for consistency with the money-adjacent tables it references and to avoid depending on the uuid-ossp extension name.

---

# CardStreet TCG — Build Spec: OBO Best-Offer System (Feature A)

**Status:** Build DARK on a named branch. All migrations delivered as raw SQL for the Supabase SQL Editor (the user applies migrations there, not via CLI). All new columns/tables are additive and DEFAULTED — production behavior is unchanged until `NEXT_PUBLIC_ENABLE_OFFERS` flips. **No prod ship without explicit launch approval** (admins are Pro-/admin-by-role and would see live features immediately, so the flag must stay `0` in prod until the founder says launch).

**Founder-locked constraints baked into this spec:** NO RESERVE ever (listing stays `active`/buyable while an offer is pending or accepted; Buy-Now always wins the CAS); PAY-ON-ACCEPTANCE (no pre-auth — TH direct charge + PromptPay has no auth-capture-later); accepted offer can be sniped, founder accepts this; accepted offers become ordinary paid orders and count as sales at full weight (Feature B territory, out of scope here except the seam).

---

## 1. Overview & Goals

Sellers opt a listing into "Accept offers (OBO)". Buyers on those listings can submit a price offer instead of paying list. The seller can **accept / reject / counter**; on a counter the buyer can **accept / decline / counter**, and so on — a bidirectional handshake. Acceptance does **not** reserve or lock the listing; it grants the offer's buyer a **server-authoritative price override** to pay through the existing checkout. The existing checkout reservation CAS (`active → sold`, `app/api/orders/checkout/route.ts:380-402`) remains the sole arbiter of who actually buys — Buy-Now and offer-checkout race on equal footing.

**Non-goals for this launch:** no reserve/hold, no multi-item offers (one listing per offer, consistent with the TH single-seller-cart rule at `app/api/orders/checkout/route.ts:210-222`), no auto-accept thresholds, no offer on non-OBO listings.

---

## 2. `listings.accepts_offers` column

### 2.1 Migration (paste-ready)

```sql
-- supabase/migrations/20260707_listings_accepts_offers.sql
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS accepts_offers BOOLEAN NOT NULL DEFAULT false;
```

Additive + defaulted → every existing listing is `false` (no "Make an offer" button appears anywhere) until sellers opt in. Base table is `supabase/migrations/20260124_initial_schema.sql:39-53`.

### 2.2 Where the toggle goes — **and the real write path**

> **Correction from draft:** the shells do **not** create listings through `POST /api/listings`. `services/marketplaceService.createListing()` **inserts directly into `listings` via the browser Supabase client** (`services/marketplaceService.ts:230-249`), gated by RLS policy `"Users can create own listings"` (`WITH CHECK (auth.uid() = seller_id)`, initial schema `:177-179`). It then fire-and-forgets to `/api/alerts/listing-created` for wishlist alerts. The `POST /api/listings` route exists but is **not** on the publish path used by either shell.
>
> `accepts_offers` is not a price/fee/status field, so letting the client set it directly (subject to the seller-owns-row RLS check) is acceptable — the server-authoritative fields (`price`, `status`, fee) are untouched.

The field must be threaded through **four** places:

**(a) Shared form — `components/ListingForm.tsx`:**
- **State:** add near the other listing state (alongside `isGraded` at `:31`):
  ```tsx
  const [acceptsOffers, setAcceptsOffers] = useState(false);
  ```
- **UI:** insert an "Accept offers (OBO)" toggle after the grading detail block (which ends at `:314`) and before the Photos section (`:316` `{/* Mandatory Photos Section */}`). Mirror the grading toggle markup at `:272-283`. Gate behind the flag so it renders nothing while dark, and hide it for sealed products (grading is already hidden for sealed via `!isSealed`; OBO is fine on sealed, so gate only on the flag):
  ```tsx
  {process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1' && (
    <div className="flex items-center gap-3 py-2">
      <button
        type="button"
        onClick={() => setAcceptsOffers(!acceptsOffers)}
        className={`w-12 h-6 rounded-full p-1 transition-colors ${acceptsOffers ? 'bg-brand-cyan' : 'bg-slate-700'}`}
      >
        <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${acceptsOffers ? 'translate-x-6' : 'translate-x-0'}`}></div>
      </button>
      <span className="text-sm font-bold text-white">
        {isThai ? 'รับข้อเสนอราคา (ต่อรองได้)' : 'Accept offers (OBO)'}
      </span>
    </div>
  )}
  ```
- **Submit body:** the `listingData` object is built at `:163-172` (note: it does **not** carry `card_data`; the parent supplies the Card). Add:
  ```ts
  accepts_offers: acceptsOffers,
  ```

**(b) Service — `services/marketplaceService.ts` `createListing`:**
- Add `acceptsOffers?: boolean;` to the `params` type (`:192-202`).
- Add to the insert object (`:232-244`):
  ```ts
  accepts_offers: params.acceptsOffers ?? false,
  ```

**(c) Mobile shell handler — `app/page.tsx` `handlePublishListing` (:1026-1069):** in the `createListing({...})` call (`:1031-1041`) add:
  ```ts
  acceptsOffers: listingData.accepts_offers,
  ```

**(d) Desktop shell handler — `components/desktop/DesktopSell.tsx` `publishListing` (:131-157):** in the `createListing({...})` call (`:134-144`) add:
  ```ts
  acceptsOffers: listingData.accepts_offers,
  ```
  (`app/desktop/sell/page.tsx` is only an 11-line Suspense wrapper around this component — no change there.)

**(e) Optional belt-and-suspenders — `POST /api/listings/route.ts`:** this route is not on the shell path but is a real endpoint; keep it consistent for any future/API consumer.
- Zod schema (`:13-21`): add `accepts_offers: z.boolean().optional().default(false),`
- Insert object (`:145-159`): add `accepts_offers: body.accepts_offers ?? false,`

### 2.3 "Make an offer" button (buyer side)

`components/ListingDetails.tsx` action bar is at `:275-290` (Add to Cart `:276-282`, Buy Now `:283-289`). When `listing.accepts_offers === true` **and** the flag is on **and** viewer is not the seller, render a third "Make an offer" button that opens a new `<OfferModal>` (amount input, optional message, shows the 48h expiry and the min-floor). It POSTs to `/api/offers`. Keep Buy Now and Add to Cart untouched — the offer path is purely additive.

> **Desktop entry point (not pinned):** desktop uses `/card/*` detail; verify its action-bar component during build (likely under `components/desktop/*`). Same three gates (flag + `accepts_offers` + not-seller).

---

## 3. `offers` table migration (paste-ready)

RLS convention in this repo: RLS is enabled and `auth.uid()`-scoped for direct client reads (`supabase/migrations/20260124_initial_schema.sql:94-209`; `notification_preferences` even adds a `USING(true)` "system can read" policy for backend reads). **All offer writes go through API routes on the service-role admin client**, which bypasses RLS. So RLS here is a read-safety net (buyers/sellers see only their own offers); every state transition is enforced server-side by CAS in the API routes, not by RLS.

> **Admin-client note:** `app/api/orders/checkout/route.ts` and `lib/fulfillOrder.ts` build a service-role client **inline** (`createClient(url, SERVICE_ROLE_KEY)`), while the offer routes and crons below use the shared `lib/supabase/admin.ts:createAdminClient()`. Both are service-role and both bypass RLS — either is fine; the offer code standardizes on `createAdminClient()`.

```sql
-- supabase/migrations/20260707_offers.sql
-- OBO Best-Offer system. Additive; no production behavior until the app flag flips.

CREATE TABLE IF NOT EXISTS public.offers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  buyer_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- THB decimal. Matches listings.price DECIMAL(10,2) exactly; orders.total_amount
  -- is an untyped NUMERIC, so this is at least as precise as both.
  amount            DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','rejected','countered','expired','withdrawn')),
  -- who made THIS offer row (the party the other side must respond to)
  actor_role        TEXT NOT NULL CHECK (actor_role IN ('buyer','seller')),
  -- self-referential counter chain: this row counters counter_of
  counter_of        UUID REFERENCES public.offers(id) ON DELETE SET NULL,
  -- set when an accepted offer is paid; links to the resulting order.
  -- orders.status has no CHECK constraint, so this FK is safe.
  accepted_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  message           TEXT,
  stripe_region     TEXT NOT NULL DEFAULT 'th',
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Query paths: list-my-offers by buyer/seller, per-listing sweep, expiry cron.
CREATE INDEX IF NOT EXISTS idx_offers_buyer   ON public.offers(buyer_id);
CREATE INDEX IF NOT EXISTS idx_offers_seller  ON public.offers(seller_id);
CREATE INDEX IF NOT EXISTS idx_offers_listing ON public.offers(listing_id);
-- expiry cron scans pending rows by expires_at
CREATE INDEX IF NOT EXISTS idx_offers_pending_expiry
  ON public.offers(expires_at) WHERE status = 'pending';

-- ANTI-ABUSE: at most ONE live (pending) offer per buyer per listing.
-- 'pending' is the only state that permits an incoming action; all others are
-- transient/terminal, so a partial unique index on pending is the exact guard.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_offers_one_live_per_buyer_listing
  ON public.offers(listing_id, buyer_id) WHERE status = 'pending';

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.offers_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_offers_touch ON public.offers;
CREATE TRIGGER trg_offers_touch
  BEFORE UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.offers_touch_updated_at();

-- RLS: read-safety net. Writes go through the service-role admin client which
-- bypasses RLS; API routes enforce transitions via CAS.
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own offers"
  ON public.offers FOR SELECT
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id);
-- No INSERT/UPDATE/DELETE policies: clients never write directly.
-- (Absent a permissive write policy, RLS denies all anon/authed writes,
--  which is intended — the service-role admin client is exempt.)
```

**Notes:**
- `gen_random_uuid()` is used (matching `orders`, `shipping_labels`, `notification_preferences`), so this migration doesn't depend on the `uuid-ossp` extension name. (`uuid_generate_v4()` would also work — uuid-ossp is enabled at initial schema `:2` — but the money-adjacent tables this references all use `gen_random_uuid()`.)
- `counter_of` chains the handshake: buyer's original offer → seller's counter (`counter_of` = original, `actor_role='seller'`) → buyer's counter (`counter_of` = seller's counter, `actor_role='buyer'`) → …. Only the newest row in a chain is ever `pending`; countering an offer sets the parent to `countered` and inserts a new `pending` child in one transaction (see §5.4).
- The partial unique index enforces "ONE live offer per buyer per listing" at the DB level — inserting a second `pending` row for the same `(listing_id, buyer_id)` raises `23505`, which the create route maps to a clean 409.

---

## 4. State machine & who-can-do-what

### 4.1 States

| status | meaning | terminal? |
|---|---|---|
| `pending` | awaiting the counterparty's response (the counterparty = the party who is NOT `actor_role`) | no |
| `accepted` | counterparty accepted; the offer's **buyer** may now pay at `amount` via checkout | no (→ terminal when paid, expired, or voided) |
| `countered` | superseded by a child counter-offer (`counter_of` points here) | yes (superseded) |
| `rejected` | counterparty rejected | yes |
| `withdrawn` | the actor pulled their own pending offer | yes |
| `expired` | passed `expires_at` while `pending`, or voided because the listing sold | yes |

### 4.2 Transition table

| From | Action | Who | To | Side effects |
|---|---|---|---|---|
| `pending` (actor=buyer) | accept | **seller** | `accepted` | notify buyer (accepted); buyer may now checkout with this offer id |
| `pending` (actor=buyer) | reject | **seller** | `rejected` | notify buyer (rejected); start post-reject cooldown |
| `pending` (actor=buyer) | counter | **seller** | this→`countered`, new child `pending` (actor=seller) | notify buyer (countered) |
| `pending` (actor=buyer) | withdraw | **buyer** | `withdrawn` | none |
| `pending` (actor=seller) | accept | **buyer** | `accepted` | buyer may now checkout with this offer id |
| `pending` (actor=seller) | reject/decline | **buyer** | `rejected` | notify seller (rejected) |
| `pending` (actor=seller) | counter | **buyer** | this→`countered`, new child `pending` (actor=buyer) | notify seller (countered) |
| `pending` (actor=seller) | withdraw | **seller** | `withdrawn` | none |
| `accepted` | pay | **buyer** (the offer's buyer) | terminal via `accepted_order_id` set + listing reservation CAS `active→sold` | see §6 |
| `accepted`/`pending` | listing sold via any path | system | `expired` (voided) | notify offeror (expired/void) — §7.2 |
| `pending` | passed `expires_at` | cron | `expired` | notify offeror (expired) — §7.1 |

**Actor/counterparty rule:** a `pending` row's `actor_role` is who *made* it; the only party allowed to accept/reject/counter it is the *other* party. Withdraw is allowed only by the actor. Every route enforces this with a CAS `WHERE` clause on both `status='pending'` and the acting user matching the correct column (see §5).

---

## 5. API routes

All routes: Next.js App Router, `export const runtime = 'nodejs'`, authenticate the caller with the SSR client (`lib/supabase/server.ts` `createClient()` → `supabase.auth.getUser()`), then perform state writes on the **service-role admin client** (`lib/supabase/admin.ts` `createAdminClient()`) so RLS is bypassed and the CAS `WHERE` clauses are the authority. Every mutating route is gated: if `process.env.NEXT_PUBLIC_ENABLE_OFFERS !== '1'` return `404` (feature dark).

CAS pattern mirrors checkout (`app/api/orders/checkout/route.ts:380-402`) and fulfillment (`lib/fulfillOrder.ts:97-127`, function `fulfillOrdersByTransferGroup`): `.update(...).eq('id', offerId).eq('status', <expected>)… .select('id')`, then assert the returned row count. Zero rows ⇒ someone else already transitioned it ⇒ `409`.

### 5.1 `POST /api/offers` — create (buyer opens an offer)

**Request:**
```json
{ "listing_id": "uuid", "amount": 250.00, "message": "optional string" }
```
**Server logic:**
1. Auth → `buyerId`.
2. Load listing (admin client): `.select('id, seller_id, price, status, accepts_offers')`.
3. Reject if: listing not found / `status !== 'active'` (delisted or sold) / `accepts_offers !== true` / `seller_id === buyerId` (can't offer on own listing) → `400`.
4. **Anti-abuse gates (§8):** min-floor, global pending cap, post-reject cooldown, endpoint rate-limit.
5. Insert:
```ts
const { data, error } = await admin.from('offers').insert({
  listing_id, buyer_id: buyerId, seller_id: listing.seller_id,
  amount, status: 'pending', actor_role: 'buyer',
  message: message ?? null, stripe_region: 'th',
  // expires_at defaults to NOW()+48h
}).select('id, amount, expires_at').single();
```
The partial unique index `uniq_offers_one_live_per_buyer_listing` enforces one-live-per-buyer atomically. On Postgres error code `23505`, return `409 { code: 'OFFER_ALREADY_LIVE' }`.
6. `after(() => sendOfferReceivedNotification(listing.seller_id, {...}))` — notify the seller (§8/§9). (`after` is importable from `next/server` in a route handler.)

**Response `201`:** `{ id, amount, expires_at, status: "pending" }`

### 5.2 `POST /api/offers/[id]/accept`

Accept the newest pending offer in a chain.

**Request:** empty body.
**CAS (accept the pending row only if the caller is the correct counterparty):**
```ts
// Load first to determine actor_role → counterparty column.
const { data: offer } = await admin.from('offers')
  .select('id, listing_id, buyer_id, seller_id, actor_role, amount, status')
  .eq('id', id).single();
if (!offer || offer.status !== 'pending') return 409;

// counterparty of a buyer-made offer is the seller, and vice-versa
const counterpartyId = offer.actor_role === 'buyer' ? offer.seller_id : offer.buyer_id;
if (user.id !== counterpartyId) return 403;

const { data: won } = await admin.from('offers')
  .update({ status: 'accepted' })
  .eq('id', id).eq('status', 'pending')
  .select('id');
if (!won || won.length !== 1) return 409;  // lost the race (withdrawn/countered/expired)
```
Notify the **offer's buyer** (whoever will pay): `sendOfferAcceptedNotification(offer.buyer_id, {...})`. Note: acceptance does **NOT** touch `listings.status` — no reserve. The listing stays `active`.

**Response `200`:** `{ id, status: "accepted", amount, listing_id }` — the client uses `id` as `acceptedOfferId` at checkout (§6).

### 5.3 `POST /api/offers/[id]/reject`

Same load + counterparty check as accept. CAS `pending → rejected`. Notify the offeror (`sendOfferRejectedNotification`). No extra cooldown column — the `rejected` row's `updated_at` (maintained by `trg_offers_touch`) is the cooldown anchor (§8.4).

**Response `200`:** `{ id, status: "rejected" }`

### 5.4 `POST /api/offers/[id]/counter`

Counterparty counters with a new amount. **Two writes must be atomic** (parent → `countered`, child inserted `pending`). Do it via a Postgres RPC so it's a single transaction and the CAS is airtight:

```sql
-- add to supabase/migrations/20260707_offers.sql
CREATE OR REPLACE FUNCTION public.counter_offer(
  p_offer_id  UUID,
  p_actor_id  UUID,
  p_amount    NUMERIC
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_parent   public.offers%ROWTYPE;
  v_counterparty UUID;
  v_new_role TEXT;
  v_new_id   UUID;
BEGIN
  SELECT * INTO v_parent FROM public.offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_parent.status <> 'pending' THEN
    RAISE EXCEPTION 'offer_not_pending';
  END IF;

  v_counterparty := CASE WHEN v_parent.actor_role = 'buyer'
                         THEN v_parent.seller_id ELSE v_parent.buyer_id END;
  IF p_actor_id <> v_counterparty THEN
    RAISE EXCEPTION 'not_counterparty';
  END IF;

  UPDATE public.offers SET status = 'countered'
    WHERE id = p_offer_id AND status = 'pending';

  v_new_role := CASE WHEN v_parent.actor_role = 'buyer' THEN 'seller' ELSE 'buyer' END;

  INSERT INTO public.offers(
    listing_id, buyer_id, seller_id, amount, status, actor_role,
    counter_of, stripe_region, expires_at)
  VALUES (
    v_parent.listing_id, v_parent.buyer_id, v_parent.seller_id, p_amount,
    'pending', v_new_role, p_offer_id, 'th', NOW() + INTERVAL '48 hours')
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;
```
Route calls `admin.rpc('counter_offer', { p_offer_id: id, p_actor_id: user.id, p_amount: amount })`; maps `offer_not_pending`→409, `not_counterparty`→403. The partial unique index is not violated because the parent flips out of `pending` in the same transaction before the child inserts. Notify the offeror of the *parent* (`sendOfferCounteredNotification`).

> `SECURITY DEFINER` here runs the function as its owner (bypassing RLS on the write). Since the route already authenticated the caller and passes `p_actor_id = user.id`, and the function re-checks counterparty identity internally, this is safe. The RPC is callable by the admin client; do not expose it to the anon role.

**Request:** `{ "amount": 275.00 }` **Response `200`:** `{ id: "<new child id>", status: "pending", amount }`

### 5.5 `POST /api/offers/[id]/withdraw`

Only the **actor** may withdraw their own pending offer. CAS `pending → withdrawn` with an extra `WHERE` on the actor's column:
```ts
const actorCol = offer.actor_role === 'buyer' ? 'buyer_id' : 'seller_id';
const { data: won } = await admin.from('offers')
  .update({ status: 'withdrawn' })
  .eq('id', id).eq('status', 'pending').eq(actorCol, user.id)
  .select('id');
if (!won || won.length !== 1) return 409;
```
No notification. **Response `200`:** `{ id, status: "withdrawn" }`

### 5.6 `GET /api/offers` — list-my-offers

**Query params:** `?role=buyer|seller` (default: both), `?state=active|all` (default `active` = `status IN ('pending','accepted')`).
```ts
let q = admin.from('offers')
  .select('id, listing_id, buyer_id, seller_id, amount, status, actor_role, counter_of, expires_at, created_at, updated_at')
  .order('updated_at', { ascending: false });
if (role === 'buyer') q = q.eq('buyer_id', user.id);
else if (role === 'seller') q = q.eq('seller_id', user.id);
else q = q.or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);
if (state === 'active') q = q.in('status', ['pending','accepted']);
```
Enrich each row with a listing snapshot (`listings.card_data`, `price`, `status`) for display. **Do not `select('*')` on `listings`** (perf rule, `feedback_perf_patterns`); select the explicit columns the UI needs. **Response `200`:** `{ offers: [...] }`.

---

## 6. Acceptance → pay-on-acceptance (pinned checkout seam)

No reserve. Acceptance just authorizes the buyer to pay at `offer.amount`. The **existing** `/api/orders/checkout` enforces price server-side and the **existing** reservation CAS arbitrates the race. **`/api/checkout` (the PaymentIntent route) needs no offer-specific change** — it derives the charge amount and `application_fee_amount` from the **orders** table (`total_amount + shipping_fee`, `platform_fee` — `app/api/checkout/route.ts:22-23, 260-267`), so once `/api/orders/checkout` writes the overridden `total_amount`/`platform_fee` into the orders, the PaymentIntent charges the discounted amount and the correct fee automatically.

### 6.1 Client

When a buyer opens an `accepted` offer where they are the buyer, the "Pay ฿X" button calls the existing checkout with one extra body field:
```json
POST /api/orders/checkout
{ "items": [{ "id": "<listing_id>" }], "acceptedOfferId": "<offer_id>", "expectedTotal": 285.00 }
```
(Note the item shape is `{ id }[]`, per `CheckoutItem` at `app/api/orders/checkout/route.ts:50-52`.)

### 6.2 Server price override — `app/api/orders/checkout/route.ts`

Inject inside the order-build loop (`:326-354`), replacing the price derivation at `:328`. This is the pinned seam: `platform_fee` (`:329`) recomputes off the overridden price automatically; shipping (`:331-339`) is price-independent. In this file the service-role client is the local variable `supabase` (`:110-113`).

```ts
for (const listing of listings) {
  const feePct = feeMap.get(listing.seller_id) || NON_PARTNER_FEE_FRACTION;

  // ─── Offer price override (server-authoritative) ───
  let priceSatang: number;
  if (body?.acceptedOfferId) {
    const { data: offer } = await supabase
      .from('offers')
      .select('amount, status, buyer_id, listing_id, accepted_order_id')
      .eq('id', body.acceptedOfferId)
      .eq('listing_id', listing.id)
      .single();
    if (!offer || offer.status !== 'accepted' || offer.buyer_id !== buyerId || offer.accepted_order_id) {
      return NextResponse.json({ error: 'Offer not payable', code: 'OFFER_NOT_PAYABLE' }, { status: 400 });
    }
    priceSatang = Math.round(Number(offer.amount) * 100);
  } else {
    priceSatang = Math.round(Number(listing.price) * 100);  // existing line 328
  }

  const platformFeeSatang = Math.round(priceSatang * feePct);  // existing line 329 — recomputes off override
  // ... shipping + ordersToInsert unchanged (:331-353) ...
}
```

**Guards:** the offer must be `accepted`, belong to the paying buyer, match the listing, and not already be linked to an order (`accepted_order_id IS NULL`). The client-supplied amount (`expectedTotal`) is never trusted for price — `offer.amount` is read from the DB. (`expectedTotal` still only feeds the existing no-overcharge guard at `:356-375`.)

### 6.3 Buy-Now race arbitration (existing reservation CAS, unchanged)

The reservation CAS at `app/api/orders/checkout/route.ts:380-402` (`.update({status:'sold'}).in('id', listingIds).eq('status','active')`) is the sole arbiter. Whoever hits it first — a Buy-Now buyer or the offer's buyer — wins; the loser gets the existing `409 "One or more listings were just sold by another buyer"`. An accepted offer confers **no** priority; it can be sniped. Founder-accepted.

### 6.4 Link the offer to its order

After the order insert succeeds (`:405-414`), stamp the offer so it can't be re-paid and so `list-my-offers` shows it resolved. Add right after `insertedOrders` is confirmed:
```ts
if (body?.acceptedOfferId && insertedOrders?.[0]?.id) {
  await supabase.from('offers')
    .update({ accepted_order_id: insertedOrders[0].id })
    .eq('id', body.acceptedOfferId)
    .eq('status', 'accepted')
    .is('accepted_order_id', null);
}
```
This is best-effort (non-fatal). The authoritative void of the *other* offers happens post-payment in the sell-sweep (§7.2) when fulfillment confirms the sale.

### 6.5 Market-pricing interaction (documented, out of scope to change)

A paid accepted offer produces a `listings` row at `status='sold'` with `price` still = the **list** price (the offer discount lives on the order's `total_amount`, not on `listings.price`, which is never rewritten). `services/marketData/pricingCalculator.ts:159-180` (`calculateThaiCardPrice`) and `supabase/functions/daily-market-update/index.ts:381` compute CardStreet **internal sales** from `listings WHERE status='sold'` averaging **`listings.price`** — i.e. the list price, not the discounted `total_amount`. So today, an offer sale contributes the *list* price to the internal average, not the accepted amount. Feature B (which is where "sales count at full weight" is scoped) will decide whether internal-sale pricing should read the true paid amount from `orders.total_amount` instead. **No change here; flagged so the Feature B author knows the two tables disagree on "what the card sold for."**

---

## 7. Crons & the void sweep

### 7.1 Expire-offers cron (hourly)

**File:** `app/api/cron/expire-offers/route.ts` — mirrors the pinned cron pattern (`app/api/cron/reconcile-shipments/route.ts`: `createAdminClient` from `lib/supabase/admin`, `runtime='nodejs'`, Bearer `CRON_SECRET`, time-budget loop, JSON summary).

```ts
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendOfferExpiredNotification } from '@/lib/courier';

export const runtime = 'nodejs';
export const maxDuration = 60;
const TIME_BUDGET_MS = 50_000;

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.NEXT_PUBLIC_ENABLE_OFFERS !== '1') {
    return NextResponse.json({ ok: true, skipped: 'flag off' });
  }

  const supabase = createAdminClient();
  const started = Date.now();
  const summary = { expired: 0, notified: 0, errors: 0 };

  const { data: due, error } = await supabase
    .from('offers')
    .select('id, buyer_id, seller_id, actor_role, listing_id, amount')
    .eq('status', 'pending')
    .lte('expires_at', new Date().toISOString())
    .limit(200);

  if (error) {
    Sentry.captureException(new Error(`expire-offers query failed: ${error.message}`));
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  for (const offer of due || []) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    // CAS: only expire if still pending (a concurrent accept/withdraw may have won)
    const { data: won, error: updErr } = await supabase
      .from('offers')
      .update({ status: 'expired' })
      .eq('id', offer.id).eq('status', 'pending')
      .select('id');
    if (updErr) { summary.errors++; Sentry.captureException(updErr); continue; }
    if (!won || won.length !== 1) continue;  // lost the race; skip
    summary.expired++;

    // Notify the party who is waiting: the offeror (actor) is left hanging.
    const offerorId = offer.actor_role === 'buyer' ? offer.buyer_id : offer.seller_id;
    try {
      await sendOfferExpiredNotification(offerorId, {
        offerId: offer.id, amount: offer.amount, listingId: offer.listing_id,
      });
      summary.notified++;
    } catch (e) { console.error('[ExpireOffers] notify (non-fatal):', e); }
  }

  return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
```

**`vercel.json` (append to the existing `crons` array, alongside `reconcile-shipments` etc.):**
```json
{ "path": "/api/cron/expire-offers", "schedule": "0 * * * *" }
```

### 7.2 Void-offers-when-listing-sells sweep

When a listing sells, its remaining `pending`/`accepted` offers must become terminal (`expired`) and their offerors notified.

> **Where does a listing actually flip to `sold`?** The **only** `active → sold` transition in the codebase is the checkout reservation CAS at `app/api/orders/checkout/route.ts:382` — which runs at **reservation time, before payment**. `fulfillOrdersByTransferGroup` never flips listings; it flips **orders** `pending_payment → paid` (`lib/fulfillOrder.ts:97-127`) and then reads the already-sold listings (`:147-150`). So a listing is `sold` from reservation, but the sale is only *confirmed* at fulfillment. The safe, no-false-positive place to void other offers is at fulfillment.

**Helper — `lib/voidOffersForListing.ts` (new):**
```ts
import { createAdminClient } from '@/lib/supabase/admin';
import { sendOfferExpiredNotification } from '@/lib/courier';

/** Void every still-open offer on a sold listing, except the one that won (paidOfferId). */
export async function voidOffersForSoldListing(listingId: string, paidOfferId?: string | null) {
  if (process.env.NEXT_PUBLIC_ENABLE_OFFERS !== '1') return;
  const admin = createAdminClient();
  const { data: open } = await admin
    .from('offers')
    .select('id, buyer_id, seller_id, actor_role, amount')
    .eq('listing_id', listingId)
    .in('status', ['pending', 'accepted']);
  for (const o of open || []) {
    if (paidOfferId && o.id === paidOfferId) continue;
    const { data: won } = await admin
      .from('offers')
      .update({ status: 'expired' })
      .eq('id', o.id).in('status', ['pending', 'accepted'])
      .select('id');
    if (!won || won.length !== 1) continue;
    const offerorId = o.actor_role === 'buyer' ? o.buyer_id : o.seller_id;
    try {
      await sendOfferExpiredNotification(offerorId, { offerId: o.id, amount: o.amount, listingId });
    } catch (e) { console.error('[VoidOffers] notify (non-fatal):', e); }
  }
}
```

**Hook 1 (SHIP THIS) — `lib/fulfillOrder.ts`** (authoritative sale confirmation). Inside `fulfillOrdersByTransferGroup`, in the inventory-transfer block that already re-reads sold listings (`:147-150`), loop over `soldListings` (which carry `id`) after the inventory move (`:172-195`):
```ts
// Void any remaining open offers on this now-sold listing (non-fatal).
try {
  await voidOffersForSoldListing(listing.id, /* paidOfferId */ null);
} catch (e) { console.error('[Fulfillment] voidOffers (non-fatal):', e); result.errors.push(`voidOffers: ${e}`); }
```
`fulfillOrdersByTransferGroup` is idempotent (its `pending_payment→paid` CAS aborts side effects on re-run at `:114-127`), and the sweep's own CAS (`.in('status',['pending','accepted'])`) makes any re-run a no-op. Passing `paidOfferId: null` is correct here — the winning offer is stamped with `accepted_order_id` in §6.4, but it may still be `accepted` at this moment; if you want the winner spared from the sweep, pass the paid offer id through. **Simplest correct option: leave it `null` and let the winner's order stand regardless (the winning offer being flipped to `expired` after the order already exists is harmless — the order is what matters). If you prefer to keep the winning offer visibly `accepted`+`accepted_order_id`, thread the paid offer id from the order.** For launch, `null` is fine.

**Hook 2 (OPTIONAL, do NOT ship for launch) — `app/api/orders/checkout/route.ts`** reservation point. The reservation CAS at `:380-402` flips `active → sold` *before* payment. To notify losing offerors promptly on any successful reservation, you could add, after the successful reservation + order insert (`:414`), a fire-and-forget sweep. **This requires importing `after` from `next/server`** — the route currently imports only `NextResponse` (`:29`):
```ts
// add `after` to the next/server import first:
// import { NextResponse, after } from 'next/server';
after(async () => {
  for (const lid of listingIds) {
    await voidOffersForSoldListing(lid, body?.acceptedOfferId ?? null);
  }
});
```
Passing `acceptedOfferId` spares the winning offer. **Downside:** if the checkout later fails and the reservation rolls back to `active` (`:412`), the offers were already `expired` — a false void (an offeror told "gone" who could still have won). **Recommendation: ship Hook 1 only for launch** (correct-on-payment, zero false-voids). Add Hook 2 later only if offerors complain about stale "still pending" UI, and accept the import change + false-void tradeoff.

---

## 8. Anti-abuse (concrete thresholds)

Enforced in `POST /api/offers` (create) unless noted. Put the tunable constants in a new `lib/offerPolicy.ts` so they're a single source of truth (mirrors `lib/partnerTiers.ts` convention).

```ts
// lib/offerPolicy.ts
export const OFFER_MIN_FLOOR_FRACTION = 0.60;   // offer must be >= 60% of list price
export const OFFER_MAX_PENDING_PER_BUYER = 15;  // global cap on live pending offers per buyer
export const OFFER_REJECT_COOLDOWN_HOURS = 6;   // after a reject, buyer waits before re-offering same listing
export const OFFER_CREATE_RATE_PER_MIN = 5;     // endpoint rate-limit per buyer
export const OFFER_EXPIRY_HOURS = 48;           // mirrors the SQL default
```

1. **Min-offer floor:** reject `amount < listing.price * OFFER_MIN_FLOOR_FRACTION` → `422 { code: 'OFFER_TOO_LOW', min: <floor> }`. (Offers *above* list price are allowed — see §10.)
2. **One live offer per buyer per listing:** enforced by the partial unique index (§3). `23505` → `409 { code: 'OFFER_ALREADY_LIVE' }`.
3. **Global pending cap:** `SELECT count(*) FROM offers WHERE buyer_id=$1 AND status='pending' AND actor_role='buyer'` ≥ `OFFER_MAX_PENDING_PER_BUYER` → `429 { code: 'OFFER_LIMIT_REACHED' }`.
4. **Post-reject cooldown:** reject if a `rejected` offer exists for `(listing_id, buyer_id)` with `updated_at > now() - OFFER_REJECT_COOLDOWN_HOURS` (the `rejected` row's `updated_at`, maintained by `trg_offers_touch`) → `429 { code: 'OFFER_COOLDOWN' }`.
5. **Endpoint rate-limit:** ≤ `OFFER_CREATE_RATE_PER_MIN` creates/min/buyer. **Not pinned — no reusable rate-limiter helper was located in-tree; grep for one during build (the prelaunch audit added a scan rate limit per `project_prelaunch_audit_2026_07` — verify whether it's reusable).** If none is reusable, a lightweight check: count `offers` rows by this buyer with `created_at > now() - 1 min`. `429 { code: 'RATE_LIMITED' }`.
6. **Passive same-pair flag (gates nothing):** on accept, if this buyer↔seller pair already has ≥3 accepted offers historically, log a Sentry breadcrumb / admin-visible note. No enforcement. (Wash-trading watch for Feature B pricing integrity — relevant because offer sales feed internal-sale pricing, see §6.5.)

---

## 9. Courier notifications

Follow the pinned pattern exactly (`lib/courier.ts:114-154` `sendSoldNotification`): fetch prefs+contact via `getUserNotifContext`, early-exit if opted out or no contact, build recipient+routing via `buildRecipient`/`buildRouting`, `courier.send.message({ message: { to, template, routing, data } })`, log `requestId`, catch-and-log (never throw). Always pass `template:` + `data:`, never `content:` (`project_courier_templates`).

### 9.1 New pref keys — migration (paste-ready)

```sql
-- supabase/migrations/20260707_offer_notification_prefs.sql
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS offer_email            BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_push             BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_accepted_email   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_accepted_push    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_rejected_email   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_rejected_push    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_countered_email  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_countered_push   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_expired_email    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS offer_expired_push     BOOLEAN NOT NULL DEFAULT true;
```

The `notification_preferences` base table (`supabase/migrations/20260222_notification_preferences.sql:2-13`) already has a `"System can read" ... USING(true)` SELECT policy, so the service-role reads in `getUserNotifContext` see the new columns. Also extend the `defaults` object in `getUserNotifContext` (`lib/courier.ts:77-81`) with these ten keys so a user whose prefs row predates this migration (or has no row) still gets defaults:
```ts
offer_email: true, offer_push: true,
offer_accepted_email: true, offer_accepted_push: true,
offer_rejected_email: true, offer_rejected_push: true,
offer_countered_email: true, offer_countered_push: true,
offer_expired_email: true, offer_expired_push: true,
```
(`getUserNotifContext` returns `{ ...defaults, ...prefs }` when a row exists and `defaults` when it doesn't — `lib/courier.ts:83-87` — so both paths are covered. Note: because it spreads the *actual row* over defaults, a NULL column value would override the default; the migration's `NOT NULL DEFAULT true` prevents NULLs, so this is safe.)

### 9.2 Template registry + env vars (`lib/courier.ts:44-55`, the `TEMPLATES` object)

```ts
offerReceived:  (process.env.COURIER_OFFER_RECEIVED_TEMPLATE_ID  || '<base32-from-dashboard>').trim(),
offerAccepted:  (process.env.COURIER_OFFER_ACCEPTED_TEMPLATE_ID  || '<base32-from-dashboard>').trim(),
offerRejected:  (process.env.COURIER_OFFER_REJECTED_TEMPLATE_ID  || '<base32-from-dashboard>').trim(),
offerCountered: (process.env.COURIER_OFFER_COUNTERED_TEMPLATE_ID || '<base32-from-dashboard>').trim(),
offerExpired:   (process.env.COURIER_OFFER_EXPIRED_TEMPLATE_ID   || '<base32-from-dashboard>').trim(),
```
**Template IDs must be taken from each template's own Send tab in the Courier dashboard** (the `lib/courier.ts:45-49` warning: UUID-looking ids silently fail — the dashboard logs "Sent: 0"; use the base32 content-template ids). These five templates must be created in the dashboard before go-live — **not pinned; founder/ops action.** (If a template isn't ready, follow the `sendWishlistListingAlert` pattern at `:857-916`: fall back to inline bilingual `content` when the env template id is empty. Recommended so the dark→live flip doesn't require the dashboard work to land first.)

### 9.3 Send functions (append to `lib/courier.ts`)

Five functions, each modeled on `sendSoldNotification` (`:114-154`) with the matching pref keys, template, and `type` for the push deep-link:

| Function | Recipient | pref keys | template | fired from |
|---|---|---|---|---|
| `sendOfferReceivedNotification(recipientId, {offerId, amount, listingId, cardName})` | seller (new buyer offer) or the counterparty being countered | `offer_email`/`offer_push` | `offerReceived` | `POST /api/offers` (§5.1) |
| `sendOfferAcceptedNotification(buyerId, {...})` | the offer's buyer | `offer_accepted_*` | `offerAccepted` | accept route (§5.2) |
| `sendOfferRejectedNotification(offerorId, {...})` | the offeror | `offer_rejected_*` | `offerRejected` | reject route (§5.3) |
| `sendOfferCounteredNotification(offerorId, {...})` | the offeror of the parent | `offer_countered_*` | `offerCountered` | counter route (§5.4) |
| `sendOfferExpiredNotification(offerorId, {...})` | the offeror | `offer_expired_*` | `offerExpired` | expire cron (§7.1) + void sweep (§7.2) |

Each passes only the fields its template reads, plus `{ offerId, listingId, type: 'offer_<x>' }` for the FCM deep-link handler. Wrap route-side sends in `after(...)` so they never block the API response; the cron/sweep call them inline (already off the request path).

---

## 10. Edge cases

| Case | Behavior |
|---|---|
| **Listing delisted (cancelled) while offer pending** | `listings.status='cancelled'`. Create route rejects new offers (`status !== 'active'`). Existing pending offers are NOT auto-voided by delisting (the void sweep only fires on *sale confirmation*, §7.2). A delisted listing can't be paid (`/api/orders/checkout:159-161` requires `status='active'`), and the offer expires naturally at 48h via the cron. **Known small gap, out of scope for launch.** Add a cancel-time sweep later if desired. |
| **Seller counters, then the listing sells** | The pending counter is voided by the sell sweep (§7.2) → `expired`, offeror notified. Buyer is under no obligation. |
| **Offer above list price** | Allowed. Min-floor only guards the low side. The buyer pays their (higher) accepted amount via the price override (§6.2); `platform_fee` recomputes off it; `/api/checkout` charges it from the order. |
| **Buyer == seller** | Rejected at create (`seller_id === buyerId` → 400). Also can't happen via accept (counterparty check) since one user can't be both. |
| **Accepted offer sniped by Buy-Now** | Founder-accepted. The offer's buyer loses the reservation CAS (`409`), their offer is voided by the sell sweep → `expired`, notified. No refund needed (pay-on-acceptance means they never paid). |
| **Two accepted offers, same listing** | No reserve means both can be `accepted` simultaneously. First to win the reservation CAS buys; the sell sweep voids the other. Consistent with no-reserve. |
| **Buyer tries to pay an expired/withdrawn/countered offer** | Checkout override guard (`offer.status !== 'accepted'`) → `400 OFFER_NOT_PAYABLE`. |
| **Double-pay same accepted offer** | `accepted_order_id IS NULL` guard (§6.2) + the reservation CAS (listing already `sold` after first pay) both block it. |
| **Counter race (both sides counter simultaneously)** | The `counter_offer` RPC takes `FOR UPDATE` on the parent; the second caller sees `status <> 'pending'` → `offer_not_pending` → 409. |
| **Offer sale drags down internal market price** | A paid offer creates a `sold` listing; `calculateThaiCardPrice` averages `listings.price` of sold rows — which is the **list** price, not the discounted amount (the discount is on the order, not the listing). So offer sales currently contribute list price to internal averaging. Feature B decides whether to read `orders.total_amount` instead (§6.5). No launch action. |

---

## 11. Feature flag

Single env flag, checked both client (toggle + buttons + modal) and server (all mutating routes + crons + the void helper return 404/skip when off):

```
NEXT_PUBLIC_ENABLE_OFFERS=0   # 0/unset = dark (default); 1 = live
```

`NEXT_PUBLIC_` prefix so the client bundle can read it for conditional rendering; server routes read the same var. While `0`: no toggle in the form, no "Make an offer" button, all `/api/offers*` routes 404, the expire cron skips, and `voidOffersForSoldListing` early-returns (so Hook 1 in fulfillment is inert even though the code is deployed). The migrations are already applied but inert (columns defaulted `false`/`true`, no offers ever created). Per `feedback_no_prod_ship_without_launch_approval`: admins are Pro-/admin-by-role and see live features immediately, so keep this flag `0` in prod until explicit launch approval — build and test on the branch with it `1`. **No pre-existing feature-flag convention exists in-tree (grep confirmed) — `NEXT_PUBLIC_ENABLE_OFFERS` is newly defined here.**

---

## 12. File-by-file change list

| Path | Change | Why |
|---|---|---|
| `supabase/migrations/20260707_listings_accepts_offers.sql` | **NEW** — `ALTER TABLE listings ADD accepts_offers BOOLEAN DEFAULT false` | OBO opt-in flag (§2.1) |
| `supabase/migrations/20260707_offers.sql` | **NEW** — `offers` table + indexes + partial unique index + `offers_touch_updated_at` trigger + `counter_offer` RPC + RLS (§3, §5.4) | core data model + atomic counter |
| `supabase/migrations/20260707_offer_notification_prefs.sql` | **NEW** — 10 `offer_*` pref columns on `notification_preferences` (§9.1) | notification opt-outs |
| `lib/offerPolicy.ts` | **NEW** — anti-abuse constants (§8) | single source of truth for thresholds |
| `lib/voidOffersForListing.ts` | **NEW** — `voidOffersForSoldListing()` (§7.2), flag-gated | void + notify on sale confirmation |
| `app/api/offers/route.ts` | **NEW** — `POST` create (§5.1) + `GET` list-my-offers (§5.6) | offer creation + inbox |
| `app/api/offers/[id]/accept/route.ts` | **NEW** — accept (§5.2) | CAS accept |
| `app/api/offers/[id]/reject/route.ts` | **NEW** — reject (§5.3) | CAS reject |
| `app/api/offers/[id]/counter/route.ts` | **NEW** — counter via RPC (§5.4) | atomic counter |
| `app/api/offers/[id]/withdraw/route.ts` | **NEW** — withdraw (§5.5) | actor-only withdraw |
| `app/api/cron/expire-offers/route.ts` | **NEW** — hourly expiry cron (§7.1) | 48h expiry |
| `services/marketplaceService.ts` | **MODIFY** — `createListing` params type (:192-202) + insert object (:232-244) add `accepts_offers` | **primary write path** — the shells insert here, not via `/api/listings` |
| `app/page.tsx` | **MODIFY** — `handlePublishListing` `createListing({...})` call (:1031-1041) pass `acceptsOffers: listingData.accepts_offers` | mobile shell persists the toggle |
| `components/desktop/DesktopSell.tsx` | **MODIFY** — `publishListing` `createListing({...})` call (:134-144) pass `acceptsOffers: listingData.accepts_offers` | desktop shell persists the toggle |
| `app/api/listings/route.ts` | **MODIFY (optional)** — Zod schema :13-21 + insert :145-159 add `accepts_offers` | belt-and-suspenders for any API-path consumer (NOT the shell path) |
| `app/api/orders/checkout/route.ts` | **MODIFY** — price override in loop :326-354 (replace :328); link offer→order after insert :414 (§6.2, §6.4). Optional Hook 2 requires adding `after` to the `next/server` import (:29). | pay-on-acceptance seam |
| `lib/fulfillOrder.ts` | **MODIFY** — in `fulfillOrdersByTransferGroup`, call `voidOffersForSoldListing()` after the inventory move (~:195) (Hook 1) | authoritative void on payment |
| `lib/courier.ts` | **MODIFY** — 5 template ids in `TEMPLATES` :44-55; 10 pref defaults in `getUserNotifContext` :77-81; 5 new send functions appended | offer notifications |
| `components/ListingForm.tsx` | **MODIFY** — `acceptsOffers` state (near :31); flag-gated toggle after :314; `accepts_offers` in `listingData` :163-172 | seller opt-in UI |
| `components/ListingDetails.tsx` | **MODIFY** — "Make an offer" button in action bar :275-290 (flag + `accepts_offers` + not-seller gated); mount `<OfferModal>` | buyer entry point (mobile) |
| `components/OfferModal.tsx` | **NEW** — amount/message input, min-floor + 48h display, POSTs `/api/offers` | offer creation UI |
| `components/OffersInbox.tsx` (or a tab in Profile) | **NEW** — lists my offers via `GET /api/offers`, action buttons per state | negotiation UI |
| `vercel.json` | **MODIFY** — append `{ "path": "/api/cron/expire-offers", "schedule": "0 * * * *" }` to the existing `crons` array | schedule expiry |
| `types.ts` | **MODIFY** — add `Offer` type + `accepts_offers?: boolean` on listing-adjacent shapes | typing (untyped admin `.select()` columns still need live-DB probing per `feedback_supabase_untyped_select_columns`) |
| `lib/locales/{en,th}.json` | **MODIFY** — `offer.*` keys (toggle label, modal, inbox states, errors) | bilingual UI |
| `.env` / Vercel env | **MODIFY** — `NEXT_PUBLIC_ENABLE_OFFERS=0`; 5 `COURIER_OFFER_*_TEMPLATE_ID` | flag + templates |

**Not pinned (verify before implementing):** the exact desktop "Make an offer" placement (desktop card detail is under `/card/*` → likely a `components/desktop/*` component); the `OffersInbox` mount point (Profile tab vs a dedicated route); whether a reusable rate-limiter helper already exists for §8.5.

---

## 13. Manual test plan

Run on the branch with `NEXT_PUBLIC_ENABLE_OFFERS=1`. Two test accounts: **S** (seller) and **B** (buyer). Apply the three migrations in the SQL Editor first (`20260707_listings_accepts_offers.sql`, `20260707_offers.sql` — which also contains the `counter_offer` RPC, `20260707_offer_notification_prefs.sql`).

**Setup & gating**
1. Flag off (`=0`): confirm no OBO toggle in ListingForm, no "Make an offer" button, `POST /api/offers` → 404, cron `GET /api/cron/expire-offers` with valid Bearer → `{ ok, skipped: 'flag off' }`.
2. Flag on: S creates a listing with the OBO toggle ON → **verify the `listings` row has `accepts_offers=true`** (this confirms the field threaded through `ListingForm.listingData → shell handler → createListing insert`, not the unused `/api/listings` route). Create one with it OFF → `false`; confirm B sees no "Make an offer" on the OFF listing.

**Happy-path handshake**
3. B offers ฿250 on a ฿400 listing → `201`, S receives `offerReceived` notification, offer `pending` (actor=buyer).
4. S counters ฿320 → parent `countered`, child `pending` (actor=seller), B receives `offerCountered`.
5. B accepts → child `accepted`, B receives `offerAccepted` (verify the accepted-notification recipient is **B, the buyer**).
6. B opens the accepted offer, taps Pay → `/api/orders/checkout` with `acceptedOfferId`, then `/api/checkout`. Confirm the order's `total_amount = 320` (override applied, not list 400), `platform_fee` recomputed off 320, the PaymentIntent amount = 320 + shipping, listing flips `sold`, offer gets `accepted_order_id`.

**Anti-abuse**
7. B offers below floor (฿200 < 60% of ฿400 = ฿240) → `422 OFFER_TOO_LOW`.
8. B offers again on the same listing while one is pending → `409 OFFER_ALREADY_LIVE`.
9. Rapid-fire 6 creates in a minute → 6th → `429 RATE_LIMITED`.
10. S rejects an offer → B gets `offerRejected`; B re-offers same listing immediately → `429 OFFER_COOLDOWN`; after 6h (or manually backdate the `rejected` row's `updated_at`) → allowed.
11. Global cap: B creates 15 pending offers across listings, 16th → `429 OFFER_LIMIT_REACHED`.

**Race / no-reserve**
12. S accepts B's offer. A different buyer C hits Buy-Now on the same listing first → C's checkout wins the reservation CAS, listing `sold`; B's Pay → `409` (listing sold); after C's payment fulfills, B's offer voided → `expired`, B notified. Confirms snipe is accepted behavior.
13. Two offers accepted on one listing (S accepts B and C). B pays first → listing sold; after fulfillment C's offer voided → `expired`, notified.

**Withdraw / expire / void**
14. B withdraws own pending offer → `withdrawn`, no notification. Confirm S can't accept it afterward (`409`).
15. Backdate an offer's `expires_at` to the past, run the expire cron with Bearer `CRON_SECRET` → offer `expired`, offeror notified, summary `{ expired:1, notified:1 }`. Re-run → no double-processing (CAS makes it a no-op).
16. With two pending offers on a listing, complete a Buy-Now sale (drive `fulfillOrdersByTransferGroup` to `paid`) → both offers `expired`, both offerors notified (Hook 1).

**Edge**
17. B offers *above* list (฿450 on ฿400) → allowed; accept + pay charges ฿450.
18. S tries to offer on own listing → `400`.
19. S delists (cancel) a listing with a pending offer → new offers rejected; existing offer stays pending until 48h expiry (known gap, §10).
20. Attempt to pay an expired/withdrawn offer → `400 OFFER_NOT_PAYABLE`. Attempt to pay the same accepted offer twice → second blocked by `accepted_order_id`/listing-sold CAS.

**Notifications**
21. Toggle each `offer_*` pref off for a user and confirm the corresponding send is suppressed (early-exit in the send function), and that a user with no `notification_preferences` row (or one predating the migration) still gets defaults (all true).

**Market-pricing sanity (documented interaction, §6.5)**
22. After test #6, run `calculateThaiCardPrice` for that card and confirm the internal-sales average uses the **list** price of the sold row (offer discount lives on the order, not the listing). Note for Feature B.

---

**Key grounded seams (verified citations):** listings base table `supabase/migrations/20260124_initial_schema.sql:39-53`; RLS convention `:94-209`; listing create schema/insert (API route, not shell path) `app/api/listings/route.ts:13-21, 145-159`; **real shell write path** `services/marketplaceService.ts:230-249` + `app/page.tsx:1031` + `components/desktop/DesktopSell.tsx:134`; grading toggle to mirror `components/ListingForm.tsx:272-283`; `listingData` `:163-172`; action bar for the offer button `components/ListingDetails.tsx:275-290`; checkout price seam `app/api/orders/checkout/route.ts:326-354`, reservation CAS `:380-402`, order insert `:405-414`, imports only `NextResponse` `:29`; `/api/checkout` derives amount/fee from orders `app/api/checkout/route.ts:22-23, 260-267`; `fulfillOrdersByTransferGroup` order CAS `lib/fulfillOrder.ts:97-127`, sold-listing re-read `:147-150`, inventory move `:172-195`; courier pattern `lib/courier.ts:44-55, 77-81, 114-154`; cron pattern `app/api/cron/reconcile-shipments/route.ts`; `vercel.json` crons array `:8-29`; orders table (no status CHECK) `supabase/migrations/20260221_orders_schema.sql:2-15`; notification_preferences base + system-read RLS `supabase/migrations/20260222_notification_preferences.sql:2-32`; internal-sale pricing readers `services/marketData/pricingCalculator.ts:159-180` + `supabase/functions/daily-market-update/index.ts:381`.