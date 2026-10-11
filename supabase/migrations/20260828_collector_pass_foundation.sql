-- Collector Pass foundation: locks the legacy rewards table's client-write
-- hole, adds the XP/coin balance columns, creates the append-only ledger, the
-- SECURITY DEFINER award/spend/check-in RPCs, and the DB triggers that award
-- XP on client-writable surfaces (vault, wishlist, listings, reviews) where no
-- server route sees the write.
--
-- Apply with the Supabase SQL Editor or:
--   npx supabase db query --linked -f supabase/migrations/20260828_collector_pass_foundation.sql
-- (NEVER `supabase db push` — local migration history is desynced from remote.)
--
-- App code fails soft until this is applied (missing function/column errors
-- are swallowed by lib/rewards.ts), so code can ship first.
--
-- The XP ladder, check-in calendar, and earn values here MUST match
-- lib/rewardTiers.ts — change both together (lib/partnerTiers.ts convention).

-- ============================================================================
-- 1. LOCK THE SELF-GRANT HOLE
-- 20260518_create_missing_user_settings_rewards.sql granted users INSERT and
-- UPDATE on their own rewards row, making points_balance client-writable via
-- PostgREST. Drop both; own-row SELECT stays. The signup trigger
-- (handle_new_user, SECURITY DEFINER) and service-role writes bypass RLS, so
-- nothing legitimate breaks.
-- ============================================================================
DROP POLICY IF EXISTS "Users can insert own rewards" ON public.rewards;
DROP POLICY IF EXISTS "Users can update own rewards" ON public.rewards;

-- Audit any pre-lock self-inflation before honoring ANY legacy balance.
-- Legacy points_balance/lifetime_points are NOT migrated into the new economy;
-- they simply stop being displayed. Founder decision at launch: zero them.
--   SELECT user_id, points_balance, lifetime_points, updated_at
--   FROM public.rewards
--   WHERE points_balance <> 0 OR lifetime_points <> 0
--   ORDER BY points_balance DESC;

-- ============================================================================
-- 2. NEW BALANCE COLUMNS (legacy points_balance/tier/tier_progress left
-- dormant — UI copy for the new system says Level/Rank, never Tier)
-- ============================================================================
ALTER TABLE public.rewards
  ADD COLUMN IF NOT EXISTS xp_total          BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level             INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS coin_balance      BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_days       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_best       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_checkin_date DATE,
  ADD COLUMN IF NOT EXISTS streak_freezes    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_repair_used  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS displayed_badges  TEXT[]  NOT NULL DEFAULT '{}';

-- ============================================================================
-- 3. APPEND-ONLY LEDGER
-- UNIQUE (user_id, rule_key, ref_id) on earn rows is the system-wide
-- idempotency key: webhook/finalize races, re-entrant fulfillment, and cron
-- re-runs all collapse to no-ops.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.reward_ledger (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rule_key    TEXT NOT NULL,
  ref_id      TEXT NOT NULL DEFAULT '',
  entry_type  TEXT NOT NULL DEFAULT 'earn'
              CHECK (entry_type IN ('earn', 'spend', 'expire', 'adjust')),
  xp          INTEGER NOT NULL DEFAULT 0,
  coins       INTEGER NOT NULL DEFAULT 0,   -- earn >= 0; spend/expire < 0
  coins_remaining INTEGER,                  -- FIFO expiry lots on earn rows
  expires_at  TIMESTAMPTZ,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_reward_ledger_earn
  ON public.reward_ledger (user_id, rule_key, ref_id) WHERE entry_type = 'earn';
CREATE INDEX IF NOT EXISTS idx_reward_ledger_user_created
  ON public.reward_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_expiry
  ON public.reward_ledger (expires_at) WHERE coins_remaining > 0;

ALTER TABLE public.reward_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own reward ledger" ON public.reward_ledger;
CREATE POLICY "Users can view own reward ledger"
  ON public.reward_ledger FOR SELECT
  USING ((SELECT auth.uid()) = user_id);
-- Deliberately NO INSERT/UPDATE/DELETE policies: writes go only through the
-- SECURITY DEFINER RPCs below (scan_events / rate_limits idiom).

-- ============================================================================
-- 4. LEVEL LADDER — SQL mirror of lib/rewardTiers.ts LEVEL_THRESHOLDS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reward_level_for_xp(p_xp BIGINT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_xp >= 135000 THEN 20
    WHEN p_xp >= 105000 THEN 19
    WHEN p_xp >= 82000  THEN 18
    WHEN p_xp >= 63000  THEN 17
    WHEN p_xp >= 48000  THEN 16
    WHEN p_xp >= 36000  THEN 15
    WHEN p_xp >= 27000  THEN 14
    WHEN p_xp >= 20000  THEN 13
    WHEN p_xp >= 14500  THEN 12
    WHEN p_xp >= 10500  THEN 11
    WHEN p_xp >= 7500   THEN 10
    WHEN p_xp >= 5200   THEN 9
    WHEN p_xp >= 3600   THEN 8
    WHEN p_xp >= 2400   THEN 7
    WHEN p_xp >= 1500   THEN 6
    WHEN p_xp >= 900    THEN 5
    WHEN p_xp >= 500    THEN 4
    WHEN p_xp >= 250    THEN 3
    WHEN p_xp >= 100    THEN 2
    ELSE 1
  END;
$$;

-- Rarity band for a level (1=Common .. 8=Crown Rare) — mirrors bandForLevel.
CREATE OR REPLACE FUNCTION public.reward_band_for_level(p_level INTEGER)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_level >= 20 THEN 8
    WHEN p_level >= 19 THEN 7
    WHEN p_level >= 16 THEN 6
    WHEN p_level >= 13 THEN 5
    WHEN p_level >= 10 THEN 4
    WHEN p_level >= 7  THEN 3
    WHEN p_level >= 4  THEN 2
    ELSE 1
  END;
$$;

-- ============================================================================
-- 5. AWARD RPC — the single choke point for every earn rule.
-- Idempotent via the ledger UNIQUE (duplicate replays return awarded=false),
-- Bangkok-day caps enforced in SQL, atomic balance bump (supabase-js cannot do
-- col = col + 1; increment_partner_downloads precedent). Entering a new rarity
-- band mints a one-shot 100-coin band bonus, itself UNIQUE-guarded.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.award_reward_event(
  p_user UUID,
  p_rule_key TEXT,
  p_ref_id TEXT,
  p_xp INTEGER,
  p_coins INTEGER,
  p_daily_cap INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_expires TIMESTAMPTZ;
  v_count INTEGER;
  v_old_level INTEGER;
  v_new_level INTEGER;
  v_band_coins INTEGER := 0;
  v_band INTEGER;
  v_row RECORD;
BEGIN
  IF p_user IS NULL OR coalesce(p_rule_key, '') = '' THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'bad_args');
  END IF;

  IF p_daily_cap IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM reward_ledger
     WHERE user_id = p_user AND rule_key = p_rule_key AND entry_type = 'earn'
       AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = v_today;
    IF v_count >= p_daily_cap THEN
      RETURN jsonb_build_object('awarded', false, 'reason', 'daily_cap');
    END IF;
  END IF;

  -- Coins expire at the end of the 12th month after the earn month.
  IF p_coins > 0 THEN
    v_expires := (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok')
                  + interval '13 months') AT TIME ZONE 'Asia/Bangkok';
  END IF;

  BEGIN
    INSERT INTO reward_ledger (user_id, rule_key, ref_id, entry_type, xp, coins,
                               coins_remaining, expires_at)
    VALUES (p_user, p_rule_key, coalesce(p_ref_id, ''), 'earn',
            greatest(p_xp, 0), greatest(p_coins, 0),
            CASE WHEN p_coins > 0 THEN p_coins END, v_expires);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'duplicate');
  END;

  INSERT INTO rewards (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;

  UPDATE rewards SET
    xp_total = xp_total + greatest(p_xp, 0),
    coin_balance = coin_balance + greatest(p_coins, 0),
    level = reward_level_for_xp(xp_total + greatest(p_xp, 0)),
    last_points_earned_at = now(),
    updated_at = now()
  WHERE user_id = p_user
  RETURNING level, reward_level_for_xp(xp_total - greatest(p_xp, 0)) AS prior_level,
            xp_total, coin_balance INTO v_row;

  v_new_level := v_row.level;
  v_old_level := v_row.prior_level;

  -- Band-entry bonus: +100 coins per rarity band entered (bands 2..8),
  -- once ever per band via the ledger UNIQUE.
  IF reward_band_for_level(v_new_level) > reward_band_for_level(v_old_level) THEN
    FOR v_band IN (reward_band_for_level(v_old_level) + 1)..reward_band_for_level(v_new_level) LOOP
      BEGIN
        INSERT INTO reward_ledger (user_id, rule_key, ref_id, entry_type, xp, coins,
                                   coins_remaining, expires_at)
        VALUES (p_user, 'band_bonus', v_band::text, 'earn', 0, 100, 100,
                (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok')
                 + interval '13 months') AT TIME ZONE 'Asia/Bangkok');
        v_band_coins := v_band_coins + 100;
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
    IF v_band_coins > 0 THEN
      UPDATE rewards SET coin_balance = coin_balance + v_band_coins, updated_at = now()
      WHERE user_id = p_user;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'awarded', true,
    'xp_total', v_row.xp_total,
    'level', v_new_level,
    'coin_balance', v_row.coin_balance + v_band_coins,
    'leveled_up', v_new_level > v_old_level,
    'band_up', reward_band_for_level(v_new_level) > reward_band_for_level(v_old_level)
  );
END;
$$;

-- ============================================================================
-- 6. DAILY CHECK-IN RPC — Shopee-style 7-day calendar, Bangkok calendar day,
-- streak with one free auto-repair (first break ever) then streak freezes.
-- Calendar coins MUST match CHECKIN_CALENDAR in lib/rewardTiers.ts.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_daily_checkin(p_user UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_calendar CONSTANT INTEGER[] := ARRAY[5, 5, 10, 10, 15, 15, 40];
  v_today DATE := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_rw RECORD;
  v_gap INTEGER;
  v_new_streak INTEGER;
  v_free_repair BOOLEAN := false;
  v_freeze_used BOOLEAN := false;
  v_cycle INTEGER;
  v_coins INTEGER;
  v_milestone INTEGER := 0;
  v_award JSONB;
BEGIN
  IF p_user IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'bad_args');
  END IF;

  INSERT INTO rewards (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;

  SELECT streak_days, last_checkin_date, streak_freezes, free_repair_used
    INTO v_rw FROM rewards WHERE user_id = p_user FOR UPDATE;

  IF v_rw.last_checkin_date = v_today THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_claimed');
  END IF;

  IF v_rw.last_checkin_date IS NULL THEN
    v_new_streak := 1;
  ELSE
    v_gap := v_today - v_rw.last_checkin_date;
    IF v_gap = 1 THEN
      v_new_streak := v_rw.streak_days + 1;
    ELSIF v_gap = 2 THEN
      -- Exactly one missed day: the first break ever auto-repairs free
      -- (grace before monetization), after that a held streak freeze burns.
      IF NOT v_rw.free_repair_used THEN
        v_free_repair := true;
        v_new_streak := v_rw.streak_days + 1;
      ELSIF v_rw.streak_freezes > 0 THEN
        v_freeze_used := true;
        v_new_streak := v_rw.streak_days + 1;
      ELSE
        v_new_streak := 1;
      END IF;
    ELSE
      v_new_streak := 1;
    END IF;
  END IF;

  v_cycle := ((v_new_streak - 1) % 7) + 1;
  v_coins := v_calendar[v_cycle];

  -- Ledger write + balance bump through the shared award path. ref_id = the
  -- Bangkok date, so a concurrent double-claim is a structural no-op even
  -- without the row lock above.
  v_award := award_reward_event(p_user, 'checkin', v_today::text, 5, v_coins, NULL);
  IF (v_award->>'awarded')::boolean IS NOT true THEN
    RETURN jsonb_build_object('claimed', false, 'reason', coalesce(v_award->>'reason', 'award_failed'));
  END IF;

  UPDATE rewards SET
    streak_days = v_new_streak,
    streak_best = greatest(streak_best, v_new_streak),
    last_checkin_date = v_today,
    free_repair_used = free_repair_used OR v_free_repair,
    streak_freezes = CASE WHEN v_freeze_used THEN streak_freezes - 1 ELSE streak_freezes END,
    updated_at = now()
  WHERE user_id = p_user;

  -- Once-ever streak milestones (7/30/100/365) — UNIQUE-guarded by ref_id.
  -- A rebuilt streak re-hitting a milestone is a duplicate: zero the figure so
  -- the returned balance matches what was actually minted.
  v_milestone := CASE v_new_streak
    WHEN 7 THEN 50 WHEN 30 THEN 100 WHEN 100 THEN 300 WHEN 365 THEN 1000 ELSE 0 END;
  IF v_milestone > 0 THEN
    IF (award_reward_event(p_user, 'streak_milestone', v_new_streak::text, 0, v_milestone, NULL)->>'awarded')::boolean IS NOT true THEN
      v_milestone := 0;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'streak', v_new_streak,
    'cycle_day', v_cycle,
    'coins', v_coins,
    'xp', 5,
    'free_repair_used', v_free_repair,
    'freeze_used', v_freeze_used,
    'milestone_coins', v_milestone,
    'level', v_award->'level',
    'leveled_up', v_award->'leveled_up',
    'coin_balance', (v_award->>'coin_balance')::bigint + v_milestone,
    'xp_total', v_award->'xp_total'
  );
END;
$$;

-- ============================================================================
-- 7. SPEND RPC — row-locks the balance, FIFO-consumes unexpired earn lots,
-- writes one negative 'spend' row. Used by the Phase 4 coin store; created now
-- so the ledger contract is complete from day one.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.spend_reward_coins(
  p_user UUID, p_item TEXT, p_coins INTEGER, p_ref_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_bal BIGINT;
  r RECORD;
  v_left INTEGER := p_coins;
  v_take INTEGER;
BEGIN
  IF p_user IS NULL OR p_coins <= 0 THEN RETURN false; END IF;

  SELECT coin_balance INTO v_bal FROM rewards WHERE user_id = p_user FOR UPDATE;
  IF v_bal IS NULL OR v_bal < p_coins THEN RETURN false; END IF;

  FOR r IN SELECT id, coins_remaining FROM reward_ledger
           WHERE user_id = p_user AND entry_type = 'earn'
             AND coins_remaining > 0
             AND (expires_at IS NULL OR expires_at > now())
           ORDER BY created_at ASC
           FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(r.coins_remaining, v_left);
    UPDATE reward_ledger SET coins_remaining = coins_remaining - v_take WHERE id = r.id;
    v_left := v_left - v_take;
  END LOOP;

  -- Balance/lot drift (expired lots not yet swept): refuse rather than
  -- oversell; the expiry cron reconciles.
  IF v_left > 0 THEN RETURN false; END IF;

  INSERT INTO reward_ledger (user_id, rule_key, ref_id, entry_type, coins)
  VALUES (p_user, 'spend:' || coalesce(p_item, 'unknown'), coalesce(p_ref_id, ''), 'spend', -p_coins);

  UPDATE rewards SET coin_balance = coin_balance - p_coins, updated_at = now()
  WHERE user_id = p_user;

  RETURN true;
END;
$$;

-- Revoking PUBLIC also drops service_role's implicit execute — the explicit
-- re-grant is mandatory (20260702_rate_limits.sql precedent).
REVOKE EXECUTE ON FUNCTION public.award_reward_event(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_daily_checkin(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.spend_reward_coins(UUID, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_reward_event(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_daily_checkin(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.spend_reward_coins(UUID, TEXT, INTEGER, TEXT) TO service_role;

-- ============================================================================
-- 8. XP TRIGGERS for client-writable surfaces. Vault adds, wishlist adds, and
-- the primary listing-publish path are pure browser RLS inserts with no API
-- route — a DB trigger is the only hook that sees every write. XP only, never
-- coins (the firewall rule); bodies swallow every error so rewards can never
-- break a vault add or listing publish.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_award_collection_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user UUID;
BEGIN
  SELECT user_id INTO v_user FROM collections WHERE id = NEW.collection_id;
  IF v_user IS NOT NULL THEN
    -- ref_id = card_id: once per card per user for life, so delete/re-add
    -- farming is worthless; 10 XP-bearing adds per Bangkok day.
    PERFORM award_reward_event(v_user, 'vault_add', coalesce(NEW.card_id, ''), 3, 0, 10);
    PERFORM award_reward_event(v_user, 'first_vault', 'first', 20, 10, NULL);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_award_collection_item ON public.collection_items;
CREATE TRIGGER trg_award_collection_item
  AFTER INSERT ON public.collection_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_award_collection_item();

CREATE OR REPLACE FUNCTION public.trg_award_wishlist()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM award_reward_event(NEW.user_id, 'wishlist_add', coalesce(NEW.card_id, ''), 2, 0, 5);
  PERFORM award_reward_event(NEW.user_id, 'first_wishlist', 'first', 10, 10, NULL);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_award_wishlist ON public.wishlists;
CREATE TRIGGER trg_award_wishlist
  AFTER INSERT ON public.wishlists
  FOR EACH ROW EXECUTE FUNCTION public.trg_award_wishlist();

-- Reviews: RLS also permits direct client inserts alongside the
-- /api/orders/complete upsert, so the trigger is the only complete hook
-- (trg_recompute_seller_rating precedent). ref_id = order_id (order_id is
-- UNIQUE on reviews) so delete + re-insert can never double-award.
CREATE OR REPLACE FUNCTION public.trg_award_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM award_reward_event(NEW.reviewer_id, 'review', NEW.order_id::text, 15, 20, NULL);
  PERFORM award_reward_event(NEW.reviewer_id, 'first_review', 'first', 20, 20, NULL);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_award_review ON public.reviews;
CREATE TRIGGER trg_award_review
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.trg_award_review();

-- Listings: fires ONLY on INSERT with status='active' and on draft->active.
-- Never on the sold->active restores from cancelled/failed checkouts.
CREATE OR REPLACE FUNCTION public.trg_award_listing_publish()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status = 'active')
     OR (TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'active') THEN
    PERFORM award_reward_event(NEW.seller_id, 'listing_publish', NEW.id::text, 10, 0, 5);
    PERFORM award_reward_event(NEW.seller_id, 'first_listing', 'first', 100, 50, NULL);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_award_listing_publish ON public.listings;
CREATE TRIGGER trg_award_listing_publish
  AFTER INSERT OR UPDATE OF status ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.trg_award_listing_publish();

-- ============================================================================
-- 9. SCAN ATTRIBUTION (Phase 5 enabler) — nullable; the scan routes stay
-- anonymous-usable.
-- ============================================================================
ALTER TABLE public.scan_events ADD COLUMN IF NOT EXISTS user_id UUID;

-- ============================================================================
-- 10. PUBLIC DISPLAY — append reward_level + displayed_badges to the
-- public_profiles view (CREATE OR REPLACE VIEW may only APPEND columns; the
-- existing column list below is byte-identical to 20260714). Live chat, seller
-- pages, and profiles all hydrate from this view, so rank chips ride along
-- with zero new queries.
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
  COALESCE(r.displayed_badges, '{}') AS displayed_badges
FROM public.profiles p
LEFT JOIN public.rewards r ON r.user_id = p.id;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- ============================================================================
-- 11. KILL SWITCH — dark-launch flag. beta_feature_flags was applied outside
-- this repo; guard so this migration still applies if the table is absent.
-- Enable with: UPDATE beta_feature_flags SET enabled = true WHERE feature = 'rewards';
-- ============================================================================
DO $$
BEGIN
  INSERT INTO public.beta_feature_flags (feature, enabled)
  VALUES ('rewards', false)
  ON CONFLICT (feature) DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'beta_feature_flags missing — create the rewards flag row manually';
END;
$$;

NOTIFY pgrst, 'reload schema';
