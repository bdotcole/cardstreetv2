-- Fixed-window rate limiting for expensive public endpoints (/api/scan first).
-- One row per key (e.g. 'scan:1.2.3.4:1m'); bump_rate_limit atomically
-- increments within the window or resets it, returning the new count. The
-- caller compares against its own max, so limits live in code, not SQL.

CREATE TABLE IF NOT EXISTS public.rate_limits (
    key TEXT PRIMARY KEY,
    window_start TIMESTAMPTZ NOT NULL,
    count INTEGER NOT NULL DEFAULT 0
);

-- Service-role only: RLS on with no policies blocks anon/authenticated reads,
-- and EXECUTE on the bump function is revoked below.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.bump_rate_limit(p_key TEXT, p_window_seconds INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO public.rate_limits AS rl (key, window_start, count)
    VALUES (p_key, NOW(), 1)
    ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rl.window_start < NOW() - MAKE_INTERVAL(secs => p_window_seconds)
                     THEN 1 ELSE rl.count + 1 END,
        window_start = CASE WHEN rl.window_start < NOW() - MAKE_INTERVAL(secs => p_window_seconds)
                            THEN NOW() ELSE rl.window_start END
    RETURNING count INTO v_count;

    -- Opportunistic cleanup so stale per-IP rows never accumulate unbounded.
    IF random() < 0.005 THEN
        DELETE FROM public.rate_limits WHERE window_start < NOW() - INTERVAL '2 days';
    END IF;

    RETURN v_count;
END;
$$;

-- Revoking PUBLIC also drops service_role's implicit execute — re-grant it
-- explicitly or the admin-client caller fails (and the limiter, which fails
-- open, would silently never limit).
REVOKE EXECUTE ON FUNCTION public.bump_rate_limit(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_rate_limit(TEXT, INTEGER) TO service_role;
