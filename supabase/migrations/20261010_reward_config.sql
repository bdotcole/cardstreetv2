-- Collector Pass: admin-editable earn settings + per-rule tracking.
--
-- 1. reward_config: ONE row holding the JSON document /admin/rewards edits
--    (shape + validation: lib/rewardConfig.ts). reward_config_history keeps
--    every saved version with who saved it.
-- 2. award_reward_event applies config.rules[<rule_key>] (xp, coins, dailyCap,
--    enabled) to every award of that key — routes, DB triggers and the
--    release-funds edge function all pass through it, so one override reaches
--    every caller — and reads config.bandBonusCoins.
-- 3. claim_daily_checkin reads config.checkin (calendar, xp, streak milestone
--    coins). Body otherwise identical to 20260921_streak_freeze_multi_day.sql.
-- 4. admin_reward_rule_stats(): the console's tracking numbers.
--
-- With no config row every function behaves exactly as before: the defaults
-- below are the old hardcoded values. A malformed document is ignored (the
-- defaults apply) rather than stopping awards.
--
-- Safe to re-run. Apply with the Supabase SQL Editor or
--   npx supabase db query --linked -f supabase/migrations/20261010_reward_config.sql

-- ============================================================================
-- 1. CONFIG + HISTORY (service-role only: RLS on, no policies)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.reward_config (
  id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID
);
ALTER TABLE public.reward_config ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.reward_config_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  config      JSONB NOT NULL,
  sections    TEXT[] NOT NULL DEFAULT '{}',
  note        TEXT,
  changed_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reward_config_history_created
  ON public.reward_config_history (created_at DESC);
ALTER TABLE public.reward_config_history ENABLE ROW LEVEL SECURITY;

-- Internal helper for the SECURITY DEFINER functions below.
CREATE OR REPLACE FUNCTION public.reward_config_doc()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT config FROM reward_config WHERE id = 1), '{}'::jsonb);
$$;

-- ============================================================================
-- 2. AWARD RPC — 20260828 body plus the config override.
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
  v_xp INTEGER := p_xp;
  v_coins INTEGER := p_coins;
  v_cap INTEGER := p_daily_cap;
  v_band_bonus INTEGER := 100;
  v_cfg JSONB;
  v_rule JSONB;
  v_disabled BOOLEAN := false;
BEGIN
  IF p_user IS NULL OR coalesce(p_rule_key, '') = '' THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'bad_args');
  END IF;

  -- Admin overrides. lib/rewardConfig.ts only ever writes allowlisted rule
  -- keys with whole-number values; anything malformed is ignored and the
  -- caller's values stand.
  BEGIN
    v_cfg := reward_config_doc();
    v_rule := v_cfg -> 'rules' -> p_rule_key;
    IF jsonb_typeof(v_rule) = 'object' THEN
      v_disabled := coalesce((v_rule -> 'enabled') = 'false'::jsonb, false);
      IF jsonb_typeof(v_rule -> 'xp') = 'number' THEN v_xp := (v_rule ->> 'xp')::int; END IF;
      IF jsonb_typeof(v_rule -> 'coins') = 'number' THEN v_coins := (v_rule ->> 'coins')::int; END IF;
      IF v_rule ? 'dailyCap' THEN
        v_cap := CASE WHEN jsonb_typeof(v_rule -> 'dailyCap') = 'number' THEN (v_rule ->> 'dailyCap')::int END;
      END IF;
    END IF;
    IF jsonb_typeof(v_cfg -> 'bandBonusCoins') = 'number' THEN
      v_band_bonus := greatest((v_cfg ->> 'bandBonusCoins')::int, 0);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_xp := p_xp; v_coins := p_coins; v_cap := p_daily_cap; v_band_bonus := 100; v_disabled := false;
  END;

  IF v_disabled THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'disabled');
  END IF;

  IF v_cap IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM reward_ledger
     WHERE user_id = p_user AND rule_key = p_rule_key AND entry_type = 'earn'
       AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = v_today;
    IF v_count >= v_cap THEN
      RETURN jsonb_build_object('awarded', false, 'reason', 'daily_cap');
    END IF;
  END IF;

  -- Coins expire at the end of the 12th month after the earn month.
  IF v_coins > 0 THEN
    v_expires := (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok')
                  + interval '13 months') AT TIME ZONE 'Asia/Bangkok';
  END IF;

  BEGIN
    INSERT INTO reward_ledger (user_id, rule_key, ref_id, entry_type, xp, coins,
                               coins_remaining, expires_at)
    VALUES (p_user, p_rule_key, coalesce(p_ref_id, ''), 'earn',
            greatest(v_xp, 0), greatest(v_coins, 0),
            CASE WHEN v_coins > 0 THEN v_coins END, v_expires);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'duplicate');
  END;

  INSERT INTO rewards (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;

  UPDATE rewards SET
    xp_total = xp_total + greatest(v_xp, 0),
    coin_balance = coin_balance + greatest(v_coins, 0),
    level = reward_level_for_xp(xp_total + greatest(v_xp, 0)),
    last_points_earned_at = now(),
    updated_at = now()
  WHERE user_id = p_user
  RETURNING level, reward_level_for_xp(xp_total - greatest(v_xp, 0)) AS prior_level,
            xp_total, coin_balance INTO v_row;

  v_new_level := v_row.level;
  v_old_level := v_row.prior_level;

  -- Band-entry bonus per rarity band entered (bands 2..8), once ever per band
  -- via the ledger UNIQUE. A 0 bonus still records the band (no coins).
  IF reward_band_for_level(v_new_level) > reward_band_for_level(v_old_level) THEN
    FOR v_band IN (reward_band_for_level(v_old_level) + 1)..reward_band_for_level(v_new_level) LOOP
      BEGIN
        INSERT INTO reward_ledger (user_id, rule_key, ref_id, entry_type, xp, coins,
                                   coins_remaining, expires_at)
        VALUES (p_user, 'band_bonus', v_band::text, 'earn', 0, v_band_bonus,
                CASE WHEN v_band_bonus > 0 THEN v_band_bonus END,
                CASE WHEN v_band_bonus > 0 THEN
                  (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok')
                   + interval '13 months') AT TIME ZONE 'Asia/Bangkok'
                END);
        v_band_coins := v_band_coins + v_band_bonus;
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
-- 3. DAILY CHECK-IN — 20260921 body; calendar, XP and streak milestone coins
-- come from config.checkin when present.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_daily_checkin(p_user UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_calendar INTEGER[] := ARRAY[5, 5, 10, 10, 15, 15, 40];
  v_checkin_xp INTEGER := 5;
  v_milestones JSONB := '{"7": 50, "30": 100, "100": 300, "365": 1000}'::jsonb;
  v_cfg JSONB;
  v_cfg_calendar INTEGER[];
  v_today DATE := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_rw RECORD;
  v_missed INTEGER;
  v_need INTEGER;
  v_new_streak INTEGER;
  v_free_repair BOOLEAN := false;
  v_freezes_used INTEGER := 0;
  v_cycle INTEGER;
  v_coins INTEGER;
  v_milestone INTEGER := 0;
  v_award JSONB;
BEGIN
  IF p_user IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'bad_args');
  END IF;

  BEGIN
    v_cfg := reward_config_doc() -> 'checkin';
    IF jsonb_typeof(v_cfg -> 'calendar') = 'array' AND jsonb_array_length(v_cfg -> 'calendar') = 7 THEN
      SELECT array_agg(greatest(e::int, 0) ORDER BY i) INTO v_cfg_calendar
        FROM jsonb_array_elements_text(v_cfg -> 'calendar') WITH ORDINALITY AS t(e, i);
      v_calendar := v_cfg_calendar;
    END IF;
    IF jsonb_typeof(v_cfg -> 'xp') = 'number' THEN
      v_checkin_xp := greatest((v_cfg ->> 'xp')::int, 0);
    END IF;
    IF jsonb_typeof(v_cfg -> 'streakMilestones') = 'object' THEN
      v_milestones := v_cfg -> 'streakMilestones';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_calendar := ARRAY[5, 5, 10, 10, 15, 15, 40];
    v_checkin_xp := 5;
    v_milestones := '{"7": 50, "30": 100, "100": 300, "365": 1000}'::jsonb;
  END;

  INSERT INTO rewards (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;

  SELECT streak_days, last_checkin_date, streak_freezes, free_repair_used
    INTO v_rw FROM rewards WHERE user_id = p_user FOR UPDATE;

  IF v_rw.last_checkin_date = v_today THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_claimed');
  END IF;

  IF v_rw.last_checkin_date IS NULL THEN
    v_new_streak := 1;
  ELSE
    -- Days with no check-in strictly between the last claim and today.
    v_missed := (v_today - v_rw.last_checkin_date) - 1;
    IF v_missed <= 0 THEN
      v_new_streak := v_rw.streak_days + 1;
    ELSE
      -- Grace before monetization: the free repair takes the first missed
      -- day, held freezes take the rest. Only consume when the whole gap is
      -- covered.
      v_need := v_missed - (CASE WHEN v_rw.free_repair_used THEN 0 ELSE 1 END);
      IF v_need <= coalesce(v_rw.streak_freezes, 0) THEN
        v_free_repair := NOT v_rw.free_repair_used;
        v_freezes_used := greatest(v_need, 0);
        v_new_streak := v_rw.streak_days + 1;
      ELSE
        v_new_streak := 1;
      END IF;
    END IF;
  END IF;

  v_cycle := ((v_new_streak - 1) % 7) + 1;
  v_coins := v_calendar[v_cycle];

  -- Ledger write + balance bump through the shared award path. ref_id = the
  -- Bangkok date, so a concurrent double-claim is a structural no-op even
  -- without the row lock above.
  v_award := award_reward_event(p_user, 'checkin', v_today::text, v_checkin_xp, v_coins, NULL);
  IF (v_award->>'awarded')::boolean IS NOT true THEN
    RETURN jsonb_build_object('claimed', false, 'reason', coalesce(v_award->>'reason', 'award_failed'));
  END IF;

  UPDATE rewards SET
    streak_days = v_new_streak,
    streak_best = greatest(streak_best, v_new_streak),
    last_checkin_date = v_today,
    free_repair_used = free_repair_used OR v_free_repair,
    streak_freezes = greatest(streak_freezes - v_freezes_used, 0),
    updated_at = now()
  WHERE user_id = p_user;

  -- Once-ever streak milestones — UNIQUE-guarded by ref_id. A rebuilt streak
  -- re-hitting a milestone is a duplicate: zero the figure so the returned
  -- balance matches what was actually minted.
  BEGIN
    v_milestone := greatest(coalesce((v_milestones ->> v_new_streak::text)::int, 0), 0);
  EXCEPTION WHEN OTHERS THEN
    v_milestone := 0;
  END;
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
    'xp', v_checkin_xp,
    'free_repair_used', v_free_repair,
    'freeze_used', v_freezes_used > 0,
    'freezes_used', v_freezes_used,
    'milestone_coins', v_milestone,
    'level', v_award->'level',
    'leveled_up', v_award->'leveled_up',
    'coin_balance', (v_award->>'coin_balance')::bigint + v_milestone,
    'xp_total', v_award->'xp_total'
  );
END;
$$;

-- ============================================================================
-- 4. TRACKING — one call for the console: per-rule totals (today / 7d / 30d /
-- all time), the last 14 Bangkok days of the daily loop, today's claims per
-- challenge slot, and badge counts.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_reward_rule_stats()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_day_start TIMESTAMPTZ := v_today::timestamp AT TIME ZONE 'Asia/Bangkok';
  v JSONB;
BEGIN
  SELECT jsonb_build_object(
    'today', v_today,
    'profiles_total', (SELECT count(*) FROM profiles),
    'rules', coalesce((
      SELECT jsonb_agg(t ORDER BY t.events_30d DESC, t.rule_key) FROM (
        SELECT rule_key,
          count(*) FILTER (WHERE created_at >= v_day_start) AS events_today,
          count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS events_7d,
          count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS events_30d,
          count(DISTINCT user_id) FILTER (WHERE created_at >= now() - interval '30 days') AS users_30d,
          coalesce(sum(xp) FILTER (WHERE created_at >= now() - interval '30 days'), 0) AS xp_30d,
          coalesce(sum(coins) FILTER (WHERE created_at >= now() - interval '30 days'), 0) AS coins_30d,
          count(*) AS events_all,
          count(DISTINCT user_id) AS users_all,
          coalesce(sum(xp), 0) AS xp_all,
          coalesce(sum(coins), 0) AS coins_all,
          max(created_at) AS last_at
        FROM reward_ledger
        WHERE entry_type = 'earn'
        GROUP BY rule_key
      ) t), '[]'::jsonb),
    'daily', coalesce((
      SELECT jsonb_agg(d ORDER BY d.day DESC) FROM (
        SELECT s.day,
          coalesce(a.checkins, 0) AS checkins,
          coalesce(a.quests, 0) AS quests,
          coalesce(a.quest_bonus, 0) AS quest_bonus,
          coalesce(a.earners, 0) AS earners,
          coalesce(a.xp, 0) AS xp,
          coalesce(a.coins, 0) AS coins
        FROM (SELECT v_today - g AS day FROM generate_series(0, 13) AS g) s
        LEFT JOIN (
          SELECT (created_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
            count(*) FILTER (WHERE rule_key = 'checkin') AS checkins,
            count(*) FILTER (WHERE rule_key = 'quest') AS quests,
            count(*) FILTER (WHERE rule_key = 'quest_bonus') AS quest_bonus,
            count(DISTINCT user_id) AS earners,
            sum(xp) AS xp,
            sum(coins) AS coins
          FROM reward_ledger
          WHERE entry_type = 'earn' AND created_at >= v_day_start - interval '13 days'
          GROUP BY 1
        ) a ON a.day = s.day
      ) d), '[]'::jsonb),
    'quest_slots_today', coalesce((
      SELECT jsonb_object_agg(slot, n) FROM (
        SELECT split_part(ref_id, ':', 2) AS slot, count(*) AS n
          FROM reward_ledger
         WHERE entry_type = 'earn' AND rule_key = 'quest'
           AND ref_id LIKE v_today::text || ':%'
         GROUP BY 1
      ) q), '{}'::jsonb),
    'badges', coalesce((
      SELECT jsonb_object_agg(ref_id, n) FROM (
        SELECT ref_id, count(*) AS n
          FROM reward_ledger
         WHERE entry_type = 'earn' AND rule_key = 'badge'
         GROUP BY ref_id
      ) b), '{}'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;

-- ============================================================================
-- 5. GRANTS (revoking PUBLIC also drops service_role's implicit execute — the
-- explicit re-grant is mandatory; 20260702 idiom)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.reward_config_doc() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_reward_event(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_daily_checkin(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_reward_rule_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reward_config_doc() TO service_role;
GRANT EXECUTE ON FUNCTION public.award_reward_event(UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_daily_checkin(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reward_rule_stats() TO service_role;

NOTIFY pgrst, 'reload schema';
