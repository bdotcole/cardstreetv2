-- Per-user "last active" timestamp (additive-only; run in the Supabase SQL
-- Editor).
--
-- WHY THIS EXISTS: as of 2026-08-19 there was NO way to answer "how many
-- people used the app this week" from the database. The obvious column lies —
-- auth.users.last_sign_in_at is frozen at signup for ~96% of accounts (only 6
-- of 231 August signups and 25 of 605 July signups ever got a later value)
-- because Supabase refreshes sessions silently instead of re-issuing a
-- sign-in event. Retention queries built on it report "signed up recently",
-- not "came back". profiles.updated_at is no better: it only moves when the
-- profile itself is edited.
--
-- The only real engagement signals were notification_preferences.updated_at
-- (native app only, and only for the ~40% of users holding a push token) and
-- anonymous scan_events counts. This column closes that gap for every signed-in
-- user on every platform — the native shell loads the same web app, so one
-- client-side ping covers both.
--
-- Written by /api/users/ping, throttled client-side to at most once an hour
-- per browser, so the write volume is bounded by active users, not page views.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

-- DAU/WAU/MAU are all "count rows newer than X", so a plain DESC index serves
-- every one of them. Partial: a user who has never pinged is not interesting
-- to an activity query and would otherwise bloat the index by ~2/3.
CREATE INDEX IF NOT EXISTS idx_profiles_last_active
    ON public.profiles (last_active_at DESC)
    WHERE last_active_at IS NOT NULL;

-- Backfill so the metric is not blind on day one: the best pre-existing
-- evidence of a real app open is the push-token upsert, which the client
-- rewrites on every launch. Only fills rows where it is actually newer than
-- nothing; leaves web-only users NULL rather than inventing activity for them.
UPDATE public.profiles p
SET last_active_at = np.updated_at
FROM public.notification_preferences np
WHERE np.user_id = p.id
  AND np.fcm_token IS NOT NULL
  AND p.last_active_at IS NULL;
