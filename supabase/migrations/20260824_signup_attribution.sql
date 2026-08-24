-- Durable first-touch signup attribution on the account row.
--
-- WHY, given the GA4 sign_up event shipped the same day (de51eef): GA4 can
-- count how many accounts organic search produced, but it does not join to
-- orders or listings, so it can never answer whether those accounts became
-- sellers or buyers. That question needs the source stored beside the account.
--
-- Shape is one JSONB column rather than six scalar ones so that adding an
-- attribution key later needs no further migration.
--   { "src": "google", "med": "organic", "cmp": "...", "ref": "www.google.co.th",
--     "lp": "/card/MA5-229-th", "ts": "2026-08-24" }
--
-- Written from two places:
--   - email signup, via auth.users.raw_user_meta_data -> the trigger below
--   - OAuth signup, via app/api/auth/callback/route.ts (metadata cannot be
--     injected through an OAuth round trip)
--
-- NOTE ON THE TRIGGER BELOW: it is a copy of the function CURRENTLY LIVE in the
-- database (read back with pg_get_functiondef on 2026-08-24), plus the one new
-- INSERT column. It is NOT rebuilt from the migration files in this repo — the
-- local migration history is desynced from the remote per CLAUDE.md, and the
-- live body already carries the DiceBear avatar fallback from
-- 20260716_backfill_profile_avatars_from_metadata.sql that the 20260518 file
-- does not. Rebuilding from 20260518 alone would silently revert that.
-- If this function has changed since 2026-08-24, re-read it before applying.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signup_attribution JSONB;

COMMENT ON COLUMN public.profiles.signup_attribution IS
  'First-touch acquisition record captured at signup: {src, med, cmp, ref, lp, ts}. '
  'Null for accounts created before 2026-08-24 and for signups with no cookie. '
  'Referrer is stored as hostname only and the landing page as a path only.';

-- Partial index: analytics queries always filter to rows that HAVE attribution,
-- and the pre-2026-08-24 back catalogue is permanently null. No point indexing it.
CREATE INDEX IF NOT EXISTS idx_profiles_signup_attribution
  ON public.profiles USING GIN (signup_attribution)
  WHERE signup_attribution IS NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_username TEXT;
BEGIN
  IF NEW.raw_user_meta_data->>'username' IS NOT NULL THEN
    new_username := LOWER(REGEXP_REPLACE(NEW.raw_user_meta_data->>'username', '[^a-zA-Z0-9_]', '', 'g'));

    PERFORM 1 FROM public.profiles WHERE username = new_username;
    IF FOUND THEN
      new_username := public.generate_unique_username(SPLIT_PART(NEW.email, '@', 1));
    END IF;
  ELSE
    new_username := public.generate_unique_username(SPLIT_PART(NEW.email, '@', 1));
  END IF;

  INSERT INTO public.profiles (id, display_name, avatar_url, username, signup_attribution)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'avatar_url', ''),
      'https://api.dicebear.com/7.x/avataaars/svg?seed=' || NEW.id::text
    ),
    new_username,
    -- jsonb_typeof guards against a client sending a string or a number here.
    -- Anything that is not an object is discarded rather than stored, so the
    -- column's shape is guaranteed for anything querying it later.
    CASE
      WHEN jsonb_typeof(NEW.raw_user_meta_data->'signup_attribution') = 'object'
        THEN NEW.raw_user_meta_data->'signup_attribution'
      ELSE NULL
    END
  );

  INSERT INTO public.collections (user_id, name, include_in_portfolio)
  VALUES (NEW.id, 'Main Vault', true);

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.rewards (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Backfill for accounts created between the app deploy and this migration.
-- The metadata was captured all along; only the column was missing, so nothing
-- from that window is lost. Safe and idempotent to re-run.
UPDATE public.profiles p
SET signup_attribution = u.raw_user_meta_data->'signup_attribution'
FROM auth.users u
WHERE u.id = p.id
  AND p.signup_attribution IS NULL
  AND jsonb_typeof(u.raw_user_meta_data->'signup_attribution') = 'object';
