-- Collector Pass deferred signals: durable live watch-time sessions (the
-- LiveKit webhook's participant_left ledger), the opt-in weekly leaderboard,
-- and nothing else — scan attribution (scan_events.user_id) already landed in
-- 20260828.
--
-- Requires 20260828 + 20260829. Apply via the Supabase SQL Editor or:
--   npx supabase db query --linked -f supabase/migrations/20260830_collector_pass_signals.sql
-- (NEVER `supabase db push`.) App code fails soft until applied.

-- ============================================================================
-- 1. WATCH-TIME SESSIONS — one row per LiveKit viewer connection, written
-- ONLY by the signature-verified webhook (participant_joined / _left /
-- room_finished). Identity is `${userId}#${uuid}` — globally unique per
-- connection; the user id prefix is the attribution key. Guests never land
-- here. XP-only signal by design (connection is not attention).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.stream_view_sessions (
  identity   TEXT PRIMARY KEY,
  stream_id  UUID NOT NULL,
  user_id    UUID NOT NULL,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at    TIMESTAMPTZ,
  seconds    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stream_view_sessions_user
  ON public.stream_view_sessions (stream_id, user_id);

ALTER TABLE public.stream_view_sessions ENABLE ROW LEVEL SECURITY;
-- RLS on, no policies: service-role (the webhook) only.

-- ============================================================================
-- 2. LEADERBOARD OPT-IN — PDPA posture: the weekly board is opt-IN, shows XP
-- only (never GMV/order counts), and opting out drops the user immediately
-- (the board is computed live from this flag, not materialized).
-- ============================================================================
ALTER TABLE public.rewards
  ADD COLUMN IF NOT EXISTS leaderboard_opt_in BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- 3. WEEKLY LEADERBOARD RPC — XP earned in the current Bangkok ISO week
-- (Monday 00:00), opted-in users only. Returns the top rows plus the caller's
-- own rank/xp regardless of placement. Aggregation must live in SQL:
-- PostgREST can't GROUP and row reads cap at 1000.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reward_leaderboard(p_user UUID, p_limit INTEGER DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_week_start TIMESTAMPTZ :=
    (date_trunc('week', now() AT TIME ZONE 'Asia/Bangkok')) AT TIME ZONE 'Asia/Bangkok';
  v_rows JSONB;
  v_entrants INTEGER;
  v_me RECORD;
BEGIN
  WITH weekly AS (
    SELECT l.user_id, sum(l.xp) AS xp_week
      FROM reward_ledger l
      JOIN rewards r ON r.user_id = l.user_id AND r.leaderboard_opt_in
     WHERE l.entry_type = 'earn' AND l.xp > 0 AND l.created_at >= v_week_start
     GROUP BY l.user_id
    HAVING sum(l.xp) > 0
  ), ranked AS (
    SELECT w.user_id, w.xp_week,
           rank() OVER (ORDER BY w.xp_week DESC) AS rnk
      FROM weekly w
  )
  SELECT
    (SELECT count(*) FROM ranked),
    (SELECT jsonb_agg(t) FROM (
       SELECT rk.rnk AS rank, rk.xp_week, r2.level,
              p.display_name, p.username, rk.user_id
         FROM ranked rk
         JOIN profiles p ON p.id = rk.user_id
         JOIN rewards r2 ON r2.user_id = rk.user_id
        ORDER BY rk.rnk ASC
        LIMIT greatest(1, least(coalesce(p_limit, 20), 50))
     ) t)
  INTO v_entrants, v_rows;

  SELECT rnk, xp_week INTO v_me FROM (
    SELECT rk.user_id, rk.rnk, rk.xp_week FROM (
      SELECT w.user_id, w.xp_week, rank() OVER (ORDER BY w.xp_week DESC) AS rnk
        FROM (
          SELECT l.user_id, sum(l.xp) AS xp_week
            FROM reward_ledger l
            JOIN rewards r ON r.user_id = l.user_id AND r.leaderboard_opt_in
           WHERE l.entry_type = 'earn' AND l.xp > 0 AND l.created_at >= v_week_start
           GROUP BY l.user_id
          HAVING sum(l.xp) > 0
        ) w
    ) rk WHERE rk.user_id = p_user
  ) mine;

  RETURN jsonb_build_object(
    'week_start', v_week_start,
    'entrants', coalesce(v_entrants, 0),
    'rows', coalesce(v_rows, '[]'::jsonb),
    'my_rank', v_me.rnk,
    'my_xp', v_me.xp_week
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reward_leaderboard(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reward_leaderboard(UUID, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
