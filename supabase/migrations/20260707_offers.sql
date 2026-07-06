-- OBO Best-Offer system. Additive; no production behavior until the app flag flips.
--
-- RLS is a read-safety net only: buyers/sellers see only their own offers.
-- Every write goes through an API route on the service-role admin client, which
-- bypasses RLS, and every state transition is enforced server-side by a
-- compare-and-swap (CAS) WHERE clause in the route — not by RLS.

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

-- ── Atomic counter-offer ─────────────────────────────────────────────────────
-- Two writes must be atomic (parent -> 'countered', child inserted 'pending').
-- Doing it in a single transaction via a Postgres RPC makes the CAS airtight and
-- keeps the partial unique index from tripping (the parent flips out of 'pending'
-- in the same transaction before the child inserts).
CREATE OR REPLACE FUNCTION public.counter_offer(
  p_offer_id  UUID,
  p_actor_id  UUID,
  p_amount    NUMERIC
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_parent       public.offers%ROWTYPE;
  v_counterparty UUID;
  v_new_role     TEXT;
  v_new_id       UUID;
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
    'pending', v_new_role, p_offer_id, v_parent.stripe_region, NOW() + INTERVAL '48 hours')
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- Lock the RPC to the service-role caller (the API route, which authenticates the
-- actor and passes their id). Postgres grants EXECUTE to PUBLIC by default, which
-- would let an authenticated user call this directly via PostgREST with a forged
-- p_actor_id and inject a counter on someone's behalf. service_role is exempt from
-- these REVOKEs, so the API route keeps working.
REVOKE ALL ON FUNCTION public.counter_offer(UUID, UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.counter_offer(UUID, UUID, NUMERIC) FROM anon, authenticated;

-- RLS: read-safety net. Writes go through the service-role admin client which
-- bypasses RLS; API routes enforce transitions via CAS.
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own offers" ON public.offers;
CREATE POLICY "Users can view own offers"
  ON public.offers FOR SELECT
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id);
-- No INSERT/UPDATE/DELETE policies: clients never write directly.
-- (Absent a permissive write policy, RLS denies all anon/authed writes,
--  which is intended — the service-role admin client is exempt.)
