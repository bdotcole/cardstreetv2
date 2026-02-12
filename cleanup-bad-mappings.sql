-- Delete mappings where the English card is from a Thai set (MA, MA2, etc.)
DELETE FROM card_mappings
WHERE card_id_en IN (
    SELECT id FROM pokemon_cards 
    WHERE language = 'en' 
    AND set_id ~ '^MA\d*'
);

-- Check how many mappings remain
SELECT COUNT(*) as remaining_mappings FROM card_mappings;

-- Check which English sets the remaining mappings use
SELECT DISTINCT pc.set_id, COUNT(*) as count
FROM card_mappings cm
JOIN pokemon_cards pc ON cm.card_id_en = pc.id
GROUP BY pc.set_id
ORDER BY count DESC;
