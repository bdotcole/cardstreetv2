-- Public bucket for user-uploaded profile photos.
-- Avatar URLs are stored on auth.users.user_metadata.avatar_url; this bucket
-- just holds the image bytes. Files live under a per-user folder ("{uid}/...")
-- so the write policies can scope each user to their own avatars.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read avatars (public bucket; URLs are served by the CDN).
CREATE POLICY "Avatar public read"
ON storage.objects FOR SELECT
USING ( bucket_id = 'avatars' );

-- Authenticated users can upload only into their own "{uid}/" folder.
CREATE POLICY "Avatar owner insert"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Users can overwrite/replace files in their own folder.
CREATE POLICY "Avatar owner update"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Users can delete files in their own folder.
CREATE POLICY "Avatar owner delete"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
);
