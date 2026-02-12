-- Test query to verify rarity mapping will work
-- This tests if English cards exist with the mapped rarities

-- 1. Check what rarities exist in Thai cards from target sets
SELECT DISTINCT rarity, COUNT(*) as card_count
FROM pokemon_cards
WHERE language = 'th' 
  AND set_id IN ('MA', 'MA1', 'MA2', 'SV11s', 'SV10s', 'SV9s')
GROUP BY rarity
ORDER BY rarity;

-- 2. Sample Thai cards with their English names
SELECT id, name, english_name, rarity, set_id
FROM pokemon_cards
WHERE language = 'th'
  AND set_id IN ('MA', 'MA1', 'MA2', 'SV11s', 'SV10s', 'SV9s')
  AND english_name IS NOT NULL
LIMIT 10;

-- 3. Check if English cards exist with mapped rarities
-- Example: RR (Thai) should match to "Double Rare" (English)
SELECT rarity, COUNT(*) as card_count
FROM pokemon_cards
WHERE language = 'en'
  AND rarity IN ('Common', 'Uncommon', 'Rare', 'Double Rare', 'Ultra Rare', 'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare')
GROUP BY rarity
ORDER BY rarity;

-- 4. Test potential match for a specific Thai card
--  (Update this with a real Thai card from step 2)
-- Example: If Thai card has english_name='Charizard' and rarity='RR' (maps to 'Double Rare')
SELECT 
    'Thai: Charizard (RR)' as source,
    name as english_card_name,
    rarity,
    set_id
FROM pokemon_cards
WHERE language = 'en'
  AND name ILIKE '%Charizard%'
  AND rarity = 'Double Rare'
LIMIT 5;

-- 5. Count cards by language to verify database content
SELECT language, COUNT(*) as total_cards
FROM pokemon_cards
GROUP BY language
ORDER BY language;
