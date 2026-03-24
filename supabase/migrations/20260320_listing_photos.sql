-- Add real photo columns to listings table
ALTER TABLE public.listings
ADD COLUMN IF NOT EXISTS image_front_url TEXT,
ADD COLUMN IF NOT EXISTS image_back_url TEXT;

-- Create listing-images storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('listing-images', 'listing-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies for listing-images
-- 1. Public can read images
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING ( bucket_id = 'listing-images' );

-- 2. Authenticated users can upload images
CREATE POLICY "Auth Upload Access"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'listing-images' 
    AND auth.role() = 'authenticated'
);

-- 3. Users can update/delete their own uploads
CREATE POLICY "Auth Update Access"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'listing-images' 
    AND auth.uid() = owner
);

CREATE POLICY "Auth Delete Access"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'listing-images' 
    AND auth.uid() = owner
);
