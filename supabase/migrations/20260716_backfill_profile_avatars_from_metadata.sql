-- Backfill: mirror in-app uploaded avatars from auth metadata onto profiles.
--
-- In-app avatar uploads historically wrote the new URL only to
-- auth.users.raw_user_meta_data.avatar_url. profiles.avatar_url is seeded ONCE
-- at signup (handle_new_user trigger) from the OAuth provider's picture — for
-- Google sign-ups that is the Gmail avatar. The seller/shop pages read
-- profiles.avatar_url (via the public_profiles view), so a user who changed
-- their photo in the app kept showing their stale Gmail picture on their shop.
--
-- The app now writes both fields on upload (components/Profile.tsx +
-- components/desktop/DesktopSettings.tsx). This one-time backfill fixes users
-- who uploaded BEFORE that change: copy their in-app uploaded avatar (URLs that
-- live in our own public 'avatars' storage bucket) from metadata onto profiles.
--
-- Safe + idempotent: only rows whose metadata avatar is a real in-app upload AND
-- differs from the stored profiles value are touched. Users who never uploaded
-- (metadata still equals the seeded Gmail URL) are left untouched.

UPDATE public.profiles p
SET avatar_url = u.raw_user_meta_data->>'avatar_url'
FROM auth.users u
WHERE u.id = p.id
  AND u.raw_user_meta_data->>'avatar_url' LIKE '%/storage/v1/object/public/avatars/%'
  AND COALESCE(p.avatar_url, '') <> COALESCE(u.raw_user_meta_data->>'avatar_url', '');

NOTIFY pgrst, 'reload schema';
