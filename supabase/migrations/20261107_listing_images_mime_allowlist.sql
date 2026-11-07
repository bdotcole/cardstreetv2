-- Seller photos are decoded and re-encoded as JPEG on the device before upload
-- (lib/listingPhoto.ts). Storage now refuses anything else, so a photo that
-- nothing can render (HEIC under a .jpg name on 2026-11-07, RAW DNG on
-- 2026-10-08) can never reach a listing again. This is the check that bites:
-- supabase-js uploads a Blob with the blob's own type, whatever contentType
-- the caller asked for.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'listing-images';
