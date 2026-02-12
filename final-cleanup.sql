-- Step 1: Delete ALL mappings to cards from Thai sets (MA, MA2, etc.)
DELETE FROM card_mappings
WHERE card_id_en IN (
    SELECT id FROM pokemon_cards 
    WHERE set_id ~ '^MA\d*'
);

-- Step 2: Verify all remaining mappings are to international sets
SELECT 
    pc.set_id,
    COUNT(*) as mapping_count
FROM card_mappings cm
JOIN pokemon_cards pc ON cm.card_id_en = pc.id
GROUP BY pc.set_id
ORDER BY mapping_count DESC;

-- Step 3: After running the Edge Function, check if prices were created
SELECT COUNT(*) FROM market_values WHERE language = 'th';
