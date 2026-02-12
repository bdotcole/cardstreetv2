-- Check if target English sets exist
SELECT id, name, release_date FROM pokemon_sets WHERE id IN ('me01', 'me02', 'sv09', 'sv10');

-- Check some unmapped MA1 cards
SELECT id, name, english_name, rarity 
FROM pokemon_cards 
WHERE set_id = 'MA1' 
AND id NOT IN (SELECT card_id_th FROM card_mappings)
LIMIT 5;

-- Check candidates in me01 that SHOULD match
SELECT id, name, rarity, set_id 
FROM pokemon_cards 
WHERE set_id = 'me01' 
LIMIT 5;
