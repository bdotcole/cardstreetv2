-- Quick SQL update to fix all image URLs by appending .png
-- Run this in Supabase SQL Editor instead of re-migrating everything

UPDATE pokemon_cards 
SET 
    image_small = CASE 
        WHEN image_small IS NOT NULL AND image_small NOT LIKE '%.png' AND image_small NOT LIKE '%.jpg' 
        THEN image_small || '.png'
        ELSE image_small 
    END,
    image_large = CASE 
        WHEN image_large IS NOT NULL AND image_large NOT LIKE '%.png' AND image_large NOT LIKE '%.jpg'
        THEN image_large || '.png'
        ELSE image_large 
    END
WHERE 
    (image_small IS NOT NULL AND image_small NOT LIKE '%.png' AND image_small NOT LIKE '%.jpg')
    OR 
    (image_large IS NOT NULL AND image_large NOT LIKE '%.png' AND image_large NOT LIKE '%.jpg');

-- Check the results
SELECT 
    id, 
    name, 
    image_small, 
    image_large 
FROM pokemon_cards 
WHERE image_large LIKE '%high.png'
LIMIT 10;
