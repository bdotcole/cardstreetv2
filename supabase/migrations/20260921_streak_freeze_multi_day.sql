-- Streak freezes cover CONSECUTIVE missed days.
--
-- The launch claim_daily_checkin only recognised a gap of exactly one missed
-- day: a collector holding two freezes who missed two days in a row lost the
-- streak anyway, while the shop sells "hold up to 2". Now missed days are
-- covered first by the once-ever free repair, then by one held freeze per
-- remaining day. If the gap cannot be fully covered, NOTHING is consumed and
-- the streak resets — a lost streak must not also burn freezes.
--
-- Everything else (calendar, award path, milestones, return shape) is
-- unchanged; the payload gains `freezes_used` (integer) beside the existing
-- `freeze_used` boolean. Mirror: app/api/rewards/summary/route.ts
-- (prospectiveStreak) and lib/rewardTiers.ts (CHECKIN_CALENDAR).

CREATE OR REPLACE FUNCTION public.claim_daily_checkin(p_user UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_calendar CONSTANT INTEGER[] := ARRAY[5, 5, 10, 10, 15, 15, 40];
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
  v_award := award_reward_event(p_user, 'checkin', v_today::text, 5, v_coins, NULL);
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

REVOKE EXECUTE ON FUNCTION public.claim_daily_checkin(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_checkin(UUID) TO service_role;
