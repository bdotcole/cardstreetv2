-- Fix: handle_new_user() was failing in live DB with
--   "function generate_unique_username(text) does not exist"
-- The 20260317 migration's trigger body referenced an unqualified
-- generate_unique_username() that wasn't resolvable from the
-- SECURITY DEFINER context. Recreate both with explicit public.
-- schema and a pinned search_path so the resolution can't drift.

CREATE OR REPLACE FUNCTION public.generate_unique_username(base_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  final_username TEXT;
  counter INTEGER := 0;
  is_unique BOOLEAN := false;
BEGIN
  final_username := LOWER(REGEXP_REPLACE(base_username, '[^a-zA-Z0-9]', '', 'g'));

  IF final_username = '' THEN
    final_username := 'user';
  END IF;

  WHILE NOT is_unique LOOP
    IF counter > 0 THEN
      PERFORM 1 FROM public.profiles WHERE username = final_username || counter::TEXT;
      IF NOT FOUND THEN
        final_username := final_username || counter::TEXT;
        is_unique := true;
      ELSE
        counter := counter + 1;
      END IF;
    ELSE
      PERFORM 1 FROM public.profiles WHERE username = final_username;
      IF NOT FOUND THEN
        is_unique := true;
      ELSE
        counter := 1;
      END IF;
    END IF;
  END LOOP;

  RETURN final_username;
END;
$$;

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

  INSERT INTO public.profiles (id, display_name, avatar_url, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
    new_username
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
