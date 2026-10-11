-- Collector Pass store: redemption (coins -> items) with a hard monthly THB
-- budget breaker for real-cost SKUs, the owned-items table (frames, name
-- colors, emote unlocks, Pro trial, vouchers), voucher consume/restore CAS,
-- admin adjust/metrics, milestone badge grants, and the coin-expiry sweep.
--
-- Requires 20260828_collector_pass_foundation.sql (reward_ledger + RPCs).
-- Apply with the Supabase SQL Editor or:
--   npx supabase db query --linked -f supabase/migrations/20260829_collector_pass_store.sql
-- (NEVER `supabase db push`.) App code fails soft until applied.
--
-- Catalog values (coin prices, budget charges, milestone thresholds) MUST
-- match lib/rewardTiers.ts — change both together.

-- ============================================================================
-- 1. OWNED ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.reward_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_key    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'consumed', 'expired')),
  meta        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reward_items_user ON public.reward_items (user_id, status);
CREATE INDEX IF NOT EXISTS idx_reward_items_group
  ON public.reward_items ((meta->>'transfer_group')) WHERE meta ? 'transfer_group';

ALTER TABLE public.reward_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own reward items" ON public.reward_items;
CREATE POLICY "Users can view own reward items"
  ON public.reward_items FOR SELECT
  USING ((SELECT auth.uid()) = user_id);
-- No write policies: service-role + SECURITY DEFINER RPCs only.

-- ============================================================================
-- 2. MONTHLY REAL-COST BUDGET (the deterministic circuit breaker)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.reward_budget (
  month         TEXT PRIMARY KEY,          -- Bangkok 'YYYY-MM'
  budget_satang BIGINT NOT NULL,
  spent_satang  BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.reward_budget ENABLE ROW LEVEL SECURITY;
-- RLS on, no policies: admin API + RPCs only.

-- Launch budget: ฿2,000/month. New months inherit it via the RPC's upsert;
-- raises are founder-only through the admin panel.
INSERT INTO public.reward_budget (month, budget_satang)
VALUES (to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM'), 200000)
ON CONFLICT (month) DO NOTHING;

-- ============================================================================
-- 3. REFUND RECORD — refunds are manual in Stripe with no DB signal; the
-- admin clawback tool writes this row so refunded orders are at least visible
-- to future queries (and never re-awarded thanks to the ledger UNIQUE).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.order_refunds (
  order_id    UUID PRIMARY KEY,
  note        TEXT,
  refunded_by UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. NEW COLUMNS
-- ============================================================================
ALTER TABLE public.rewards
  ADD COLUMN IF NOT EXISTS equipped_frame TEXT,
  ADD COLUMN IF NOT EXISTS equipped_chat_color TEXT;

-- Buyer voucher discount, funded from application_fee_amount (platform_fee is
-- stored ALREADY REDUCED on voucher orders; discount_amount records how much
-- came off the buyer's charge so /api/checkout can subtract it).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC NOT NULL DEFAULT 0;

-- ============================================================================
-- 5. REDEEM RPC — atomic: level gate, once-ever gate, per-item caps, monthly
-- budget check + reserve (real-cost items), FIFO coin spend, item mint, and
-- the streak-freeze counter effect. Everything or nothing.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.redeem_reward_item(
  p_user UUID,
  p_item_key TEXT,
  p_coins INTEGER,
  p_real_cost_satang INTEGER,
  p_min_level INTEGER,
  p_once BOOLEAN,
  p_meta JSONB,
  p_expires_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_month TEXT := to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM');
  v_rw RECORD;
  v_budget RECORD;
  v_item_id UUID;
  v_spent BOOLEAN;
BEGIN
  IF p_user IS NULL OR coalesce(p_item_key, '') = '' OR p_coins <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;

  SELECT level, coin_balance, streak_freezes INTO v_rw
    FROM rewards WHERE user_id = p_user FOR UPDATE;
  IF v_rw IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_account');
  END IF;
  IF coalesce(p_min_level, 1) > v_rw.level THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'level_locked');
  END IF;
  IF p_once AND EXISTS (
    SELECT 1 FROM reward_items WHERE user_id = p_user AND item_key = p_item_key
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_owned');
  END IF;
  IF p_item_key = 'streak_freeze' AND v_rw.streak_freezes >= 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'freeze_cap');
  END IF;

  -- Budget breaker for real-cost SKUs: row-locked, deterministic. When the
  -- month's budget is spent these items read "restocks on the 1st" — never a
  -- baht past the ceiling. New months inherit the latest configured budget.
  IF coalesce(p_real_cost_satang, 0) > 0 THEN
    INSERT INTO reward_budget (month, budget_satang)
    VALUES (
      v_month,
      coalesce((SELECT budget_satang FROM reward_budget ORDER BY month DESC LIMIT 1), 200000)
    )
    ON CONFLICT (month) DO NOTHING;
    SELECT * INTO v_budget FROM reward_budget WHERE month = v_month FOR UPDATE;
    IF v_budget.spent_satang + p_real_cost_satang > v_budget.budget_satang THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'budget_exhausted');
    END IF;
  END IF;

  v_spent := spend_reward_coins(p_user, p_item_key, p_coins, p_item_key);
  IF NOT v_spent THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_coins');
  END IF;

  IF coalesce(p_real_cost_satang, 0) > 0 THEN
    UPDATE reward_budget
       SET spent_satang = spent_satang + p_real_cost_satang, updated_at = now()
     WHERE month = v_month;
  END IF;

  IF p_item_key = 'streak_freeze' THEN
    UPDATE rewards SET streak_freezes = streak_freezes + 1, updated_at = now()
     WHERE user_id = p_user;
    INSERT INTO reward_items (user_id, item_key, status, meta, consumed_at)
    VALUES (p_user, p_item_key, 'consumed', coalesce(p_meta, '{}'::jsonb), now())
    RETURNING id INTO v_item_id;
  ELSE
    INSERT INTO reward_items (user_id, item_key, status, meta, expires_at)
    VALUES (p_user, p_item_key, 'active', coalesce(p_meta, '{}'::jsonb), p_expires_at)
    RETURNING id INTO v_item_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'item_id', v_item_id,
    'coin_balance', (SELECT coin_balance FROM rewards WHERE user_id = p_user)
  );
END;
$$;

-- ============================================================================
-- 6. VOUCHER CONSUME / RESTORE — CAS so a voucher can never double-apply.
-- Consumed BEFORE order insert at checkout; restored on the failure paths and
-- when an unpaid checkout is cancelled.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.consume_reward_item(
  p_item UUID, p_user UUID, p_meta_patch JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE reward_items
     SET status = 'consumed',
         consumed_at = now(),
         meta = meta || coalesce(p_meta_patch, '{}'::jsonb)
   WHERE id = p_item AND user_id = p_user AND status = 'active'
     AND (expires_at IS NULL OR expires_at > now());
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_reward_item(p_item UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE reward_items
     SET status = 'active',
         consumed_at = NULL,
         meta = meta - 'transfer_group'
   WHERE id = p_item AND status = 'consumed';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$$;

-- ============================================================================
-- 7. ADMIN ADJUST — audited manual correction / clawback. Negative balances
-- are allowed by design (clawback on an already-spent balance carries debt
-- against future earns). Level recomputes from the adjusted lifetime XP.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_adjust_rewards(
  p_user UUID, p_xp INTEGER, p_coins INTEGER, p_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row RECORD;
BEGIN
  IF p_user IS NULL OR (p_xp = 0 AND p_coins = 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_args');
  END IF;
  INSERT INTO reward_ledger (user_id, rule_key, ref_id, entry_type, xp, coins, note)
  VALUES (p_user, 'admin_adjust', gen_random_uuid()::text, 'adjust', p_xp, p_coins, p_note);
  UPDATE rewards SET
    xp_total = greatest(0, xp_total + p_xp),
    coin_balance = coin_balance + p_coins,
    level = reward_level_for_xp(greatest(0, xp_total + p_xp)),
    updated_at = now()
  WHERE user_id = p_user
  RETURNING xp_total, level, coin_balance INTO v_row;
  IF v_row IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_account');
  END IF;
  RETURN jsonb_build_object('ok', true, 'xp_total', v_row.xp_total,
    'level', v_row.level, 'coin_balance', v_row.coin_balance);
END;
$$;

-- ============================================================================
-- 8. COIN EXPIRY SWEEP — zeroes expired FIFO lots and debits balances, one
-- 'expire' ledger row per user per run. Coins carry a 12-month expiry, so
-- this is a no-op until the program's 13th month; scheduling it from day one
-- is deliberate (nothing to forget later).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.expire_reward_coins()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rec RECORD;
  v_users INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT user_id, sum(coins_remaining) AS expired
      FROM reward_ledger
     WHERE entry_type = 'earn' AND coins_remaining > 0
       AND expires_at IS NOT NULL AND expires_at <= now()
     GROUP BY user_id
  LOOP
    UPDATE reward_ledger SET coins_remaining = 0
     WHERE user_id = rec.user_id AND entry_type = 'earn'
       AND coins_remaining > 0 AND expires_at IS NOT NULL AND expires_at <= now();
    INSERT INTO reward_ledger (user_id, rule_key, ref_id, entry_type, coins)
    VALUES (rec.user_id, 'expire', to_char(now(), 'YYYY-MM-DD'), 'expire', -rec.expired);
    UPDATE rewards SET coin_balance = coin_balance - rec.expired, updated_at = now()
     WHERE user_id = rec.user_id;
    v_users := v_users + 1;
  END LOOP;
  RETURN v_users;
END;
$$;

-- ============================================================================
-- 9. MILESTONE BADGE GRANTS — nightly sweep. Counters come from the ledger's
-- own earn rows (never client-writable tables); each badge is a one-shot
-- award_reward_event('badge', <key>) so re-runs are structural no-ops.
-- Thresholds MUST match MILESTONES in lib/rewardTiers.ts.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.grant_reward_milestones()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  def RECORD;
  rec RECORD;
  v_granted INTEGER := 0;
  v_award JSONB;
BEGIN
  FOR def IN
    SELECT * FROM (VALUES
      ('order_settled_buyer',  5,   'buyer_5',    100),
      ('order_settled_buyer',  25,  'buyer_25',   300),
      ('order_settled_buyer',  100, 'buyer_100',  1000),
      ('order_settled_seller', 1,   'seller_1',   100),
      ('order_settled_seller', 10,  'seller_10',  300),
      ('order_settled_seller', 50,  'seller_50',  1000),
      ('order_settled_seller', 250, 'seller_250', 3000),
      ('review',               10,  'reviews_10', 100),
      ('review',               50,  'reviews_50', 300),
      ('vault_add',            50,  'vault_50',   0),
      ('vault_add',            250, 'vault_250',  0),
      ('vault_add',            1000,'vault_1000', 0),
      ('chat_stream',          25,  'chat_25',    0)
    ) AS t(rule, threshold, badge, coins)
  LOOP
    FOR rec IN
      SELECT user_id FROM reward_ledger
       WHERE rule_key = def.rule AND entry_type = 'earn'
       GROUP BY user_id
      HAVING count(*) >= def.threshold
    LOOP
      v_award := award_reward_event(rec.user_id, 'badge', def.badge, 0, def.coins, NULL);
      IF (v_award->>'awarded')::boolean IS true THEN
        v_granted := v_granted + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- Streak badges read streak_best (coins were already paid live by
  -- claim_daily_checkin's streak milestones — badges only here).
  FOR def IN
    SELECT * FROM (VALUES (30, 'streak_30'), (100, 'streak_100'), (365, 'streak_365'))
      AS t(threshold, badge)
  LOOP
    FOR rec IN SELECT user_id FROM rewards WHERE streak_best >= def.threshold LOOP
      v_award := award_reward_event(rec.user_id, 'badge', def.badge, 0, 0, NULL);
      IF (v_award->>'awarded')::boolean IS true THEN
        v_granted := v_granted + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- Auto-showcase the first badges for users who have never curated (empty
  -- displayed_badges only — a deliberate selection is never clobbered).
  UPDATE rewards r SET displayed_badges = sub.badges, updated_at = now()
  FROM (
    SELECT user_id, (array_agg(ref_id ORDER BY created_at))[1:3] AS badges
      FROM reward_ledger
     WHERE rule_key = 'badge' AND entry_type = 'earn'
     GROUP BY user_id
  ) sub
  WHERE r.user_id = sub.user_id AND cardinality(r.displayed_badges) = 0;

  RETURN v_granted;
END;
$$;

-- ============================================================================
-- 10. ADMIN METRICS — one call for the admin panel (aggregates need SQL;
-- PostgREST can't GROUP, and row-fetching caps at 1000).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_rewards_metrics()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_coin_balance', coalesce((SELECT sum(coin_balance) FROM rewards), 0),
    'unexpired_lot_coins', coalesce((SELECT sum(coins_remaining) FROM reward_ledger
        WHERE entry_type = 'earn' AND coins_remaining > 0
          AND (expires_at IS NULL OR expires_at > now())), 0),
    'minted_30d', coalesce((SELECT sum(coins) FROM reward_ledger
        WHERE entry_type = 'earn' AND created_at >= now() - interval '30 days'), 0),
    'spent_30d', coalesce((SELECT -sum(coins) FROM reward_ledger
        WHERE entry_type = 'spend' AND created_at >= now() - interval '30 days'), 0),
    'earners', coalesce((SELECT count(*) FROM rewards WHERE xp_total > 0), 0),
    'budget', (SELECT to_jsonb(b) FROM reward_budget b
        WHERE month = to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')),
    'top_earners', coalesce((
      SELECT jsonb_agg(t) FROM (
        SELECT r.user_id, p.display_name, p.username, r.coin_balance, r.xp_total, r.level
          FROM rewards r JOIN profiles p ON p.id = r.user_id
         ORDER BY r.xp_total DESC LIMIT 10
      ) t), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;

-- ============================================================================
-- 11. GRANTS (mandatory explicit service_role re-grant — 20260702 idiom)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.redeem_reward_item(UUID, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_reward_item(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.restore_reward_item(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_rewards(UUID, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_reward_coins() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_reward_milestones() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rewards_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_reward_item(UUID, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN, JSONB, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_reward_item(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_reward_item(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_rewards(UUID, INTEGER, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_reward_coins() TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_reward_milestones() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_rewards_metrics() TO service_role;

-- ============================================================================
-- 12. PUBLIC DISPLAY — append equipped cosmetics to the view (append-only).
-- ============================================================================
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = off) AS
SELECT
  p.id,
  p.username,
  p.display_name,
  p.avatar_url,
  p.bio,
  p.partner_tier,
  p.partner_qr_slug,
  p.partner_joined_at,
  p.rating,
  p.review_count,
  p.is_verified_shop,
  p.created_at,
  (p.role = 'admin') AS is_official,
  COALESCE(r.level, 1) AS reward_level,
  COALESCE(r.displayed_badges, '{}') AS displayed_badges,
  r.equipped_frame,
  r.equipped_chat_color
FROM public.profiles p
LEFT JOIN public.rewards r ON r.user_id = p.id;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- ============================================================================
-- 13. VOUCHER KILL SWITCH — separate flag so the checkout-money rail is
-- independently killable from the rest of the rewards system.
-- ============================================================================
DO $$
BEGIN
  INSERT INTO public.beta_feature_flags (feature, enabled)
  VALUES ('rewards_vouchers', false)
  ON CONFLICT (feature) DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'beta_feature_flags missing — create the rewards_vouchers flag row manually';
END;
$$;

-- ============================================================================
-- LAUNCH-DAY BLOCK (run manually at public launch, founder-approved):
--   -- First Edition badge for the first 1,000 accounts + 200-coin founding
--   -- grant for everyone (one-shot each via the ledger UNIQUE):
--   -- DO $$ DECLARE rec RECORD; BEGIN
--   --   FOR rec IN SELECT id FROM profiles ORDER BY created_at ASC LIMIT 1000 LOOP
--   --     PERFORM award_reward_event(rec.id, 'badge', 'first_edition', 0, 0, NULL);
--   --   END LOOP;
--   --   FOR rec IN SELECT id FROM profiles LOOP
--   --     PERFORM award_reward_event(rec.id, 'founding_grant', 'launch', 0, 200, NULL);
--   --   END LOOP;
--   -- END $$;
-- ============================================================================

NOTIFY pgrst, 'reload schema';
