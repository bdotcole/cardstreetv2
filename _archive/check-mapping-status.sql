-- Step 1: Check how many Thai cards we have
SELECT COUNT(*) as total_thai_cards 
FROM pokemon_cards 
WHERE language = 'th';

-- Step 2: Check how many are currently mapped
SELECT COUNT(*) as currently_mapped 
FROM card_mappings;

-- Step 3: Check which English sets we have available for matching
SELECT set_id, COUNT(*) as card_count
FROM pokemon_cards 
WHERE language = 'en' 
GROUP BY set_id
ORDER BY card_count DESC;

-- Step 4: Find unmapped Thai cards
SELECT id, name, english_name, set_id
FROM pokemon_cards
WHERE language = 'th'
AND id NOT IN (SELECT card_id_th FROM card_mappings)
LIMIT 20;
