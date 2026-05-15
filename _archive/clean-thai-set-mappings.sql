-- Clean up incorrect card mappings pointing to Thai sets (MA, MA2, etc.)
-- This removes mappings where the English card is actually from a Thai set

-- Step 1: Check how many incorrect mappings exist
SELECT COUNT(*) as incorrect_mappings_count
FROM card_mappings cm
WHERE cm.card_id_en IN (
    SELECT id FROM pokemon_cards 
    WHERE set_id ~ '^MA\d*'
);

-- Step 2: Show sample incorrect mappings before deletion
SELECT 
    cm.id,
    th.name as thai_card_name,
    th.set_id as thai_set,
    en.name as english_card_name,
    en.set_id as english_set,
    cm.confidence_score
FROM card_mappings cm
JOIN pokemon_cards th ON cm.card_id_th = th.id
JOIN pokemon_cards en ON cm.card_id_en = en.id
WHERE en.set_id ~ '^MA\d*'
LIMIT 10;

-- Step 3: Delete incorrect mappings
DELETE FROM card_mappings
WHERE card_id_en IN (
    SELECT id FROM pokemon_cards 
    WHERE set_id ~ '^MA\d*'
);

-- Step 4: Verify deletion
SELECT COUNT(*) as remaining_ma_mappings
FROM card_mappings cm
WHERE cm.card_id_en IN (
    SELECT id FROM pokemon_cards 
    WHERE set_id ~ '^MA\d*'
);
