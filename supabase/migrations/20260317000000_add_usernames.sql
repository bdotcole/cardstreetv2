-- 1. Add username and username_updated_at columns
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS username_updated_at TIMESTAMPTZ;

-- 2. Create a helper function to generate a unique username from an email prefix
CREATE OR REPLACE FUNCTION generate_unique_username(base_username TEXT)
RETURNS TEXT AS $$
DECLARE
  final_username TEXT;
  counter INTEGER := 0;
  is_unique BOOLEAN := false;
BEGIN
  -- Strip out any non-alphanumeric characters, convert to lowercase
  final_username := LOWER(REGEXP_REPLACE(base_username, '[^a-zA-Z0-9]', '', 'g'));
  
  -- If empty after stripping, just use 'user'
  IF final_username = '' THEN
    final_username := 'user';
  END IF;

  -- Check uniqueness and append numbers if needed
  WHILE NOT is_unique LOOP
    IF counter > 0 THEN
      -- Check if base + counter exists
      PERFORM 1 FROM profiles WHERE username = final_username || counter::TEXT;
      IF NOT FOUND THEN
        final_username := final_username || counter::TEXT;
        is_unique := true;
      ELSE
        counter := counter + 1;
      END IF;
    ELSE
      -- Check if base exists
      PERFORM 1 FROM profiles WHERE username = final_username;
      IF NOT FOUND THEN
        is_unique := true;
      ELSE
        counter := 1;
      END IF;
    END IF;
  END LOOP;

  RETURN final_username;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update the auth handle_new_user trigger to include username generation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_username TEXT;
BEGIN
  -- If a username was provided during manual signup, try to use it
  IF NEW.raw_user_meta_data->>'username' IS NOT NULL THEN
    -- Make it lowercase and strip invalid chars just in case
    new_username := LOWER(REGEXP_REPLACE(NEW.raw_user_meta_data->>'username', '[^a-zA-Z0-9_]', '', 'g'));
    
    -- Final uniqueness check, just in case (though API should catch this first)
    PERFORM 1 FROM profiles WHERE username = new_username;
    IF FOUND THEN
        -- Fallback to generating one from email
        new_username := generate_unique_username(SPLIT_PART(NEW.email, '@', 1));
    END IF;
  ELSE
    -- Google OAuth or manual signup without username: auto-generate from email prefix
    new_username := generate_unique_username(SPLIT_PART(NEW.email, '@', 1));
  END IF;

  INSERT INTO public.profiles (id, display_name, avatar_url, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
    new_username
  );
  
  -- Create default collection for new user
  INSERT INTO public.collections (user_id, name, include_in_portfolio)
  VALUES (NEW.id, 'Main Vault', true);
  
  -- Create default notification preferences
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);
  
  -- Create default rewards profile
  INSERT INTO public.rewards (user_id)
  VALUES (NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Backfill existing users
-- First, handle the specific user request:
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Find the user by ID from profiles where email matches (Note: email is in auth.users, so we join)
  SELECT p.id INTO v_user_id
  FROM profiles p
  JOIN auth.users au ON p.id = au.id
  WHERE au.email = 'brandonlcole35@gmail.com'
  LIMIT 1;

  IF FOUND THEN
    UPDATE profiles
    SET username = 'bdot', username_updated_at = NOW()
    WHERE id = v_user_id;
  END IF;
END $$;

-- Second, backfill all other users who don't have a username yet
DO $$
DECLARE
  user_record RECORD;
  new_username TEXT;
BEGIN
  FOR user_record IN 
    SELECT p.id, au.email 
    FROM profiles p
    JOIN auth.users au ON p.id = au.id
    WHERE p.username IS NULL
  LOOP
    new_username := generate_unique_username(SPLIT_PART(user_record.email, '@', 1));
    UPDATE profiles
    SET username = new_username
    WHERE id = user_record.id;
  END LOOP;
END $$;
