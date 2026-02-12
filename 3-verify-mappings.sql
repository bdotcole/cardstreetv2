-- Check matching results
-- 1. How many cards were mapped?
SELECT COUNT(*) as total_mappings FROM card_mappings;

-- 2. What English sets did they map to?
SELECT pc.set_id, COUNT(*) as count
FROM card_mappings cm
JOIN pokemon_cards pc ON cm.card_id_en = pc.id
GROUP BY pc.set_id
ORDER BY count DESC;

-- 3. Sample of high-confidence matches
SELECT 
    th.name as thai_name,
    th.english_name,
    th.rarity as thai_rarity,
    en.name as english_name,
    en.set_id as english_set,
    en.rarity as english_rarity,
    cm.confidence_score,
    cm.match_method
FROM card_mappings cm
JOIN pokemon_cards th ON cm.card_id_th = th.id
JOIN pokemon_cards en ON cm.card_id_en = en.id
ORDER BY cm.confidence_score DESC
LIMIT 10;

-- 4. Check for any MA2 mappings (should be 0!)
SELECT COUNT(*) as ma2_mappings
FROM card_mappings cm
JOIN pokemon_cards pc ON cm.card_id_en = pc.id
WHERE pc.set_id ~ '^MA\d*';
