-- Test query to check image URLs in the database
SELECT 
    id,
    name,
    image_small,
    image_large,
    raw_data->>'image' as raw_image
FROM pokemon_cards 
WHERE language = 'en'
LIMIT 5;
