-- Verification queries for Thai-to-English card matching

-- Query 1: Distribution of mappings by English set
-- Should show international sets (sv01, sv02, base1, etc.)
-- Should NOT show Thai sets (MA, MA2, MA3)
SELECT 
    pc.set_id,
    COUNT(*) as mapping_count,
    AVG(cm.confidence_score) as avg_confidence
FROM card_mappings cm
JOIN pokemon_cards pc ON cm.card_id_en = pc.id
GROUP BY pc.set_id
ORDER BY mapping_count DESC
LIMIT 20;

-- Query 2: Check for any MA* set mappings (should be ZERO)
SELECT COUNT(*) as ma_set_mappings
FROM card_mappings cm
JOIN pokemon_cards pc ON cm.card_id_en = pc.id
WHERE pc.set_id ~ '^MA\d*';

-- Query 3: Overall mapping statistics
SELECT 
    COUNT(DISTINCT pc.id) as total_thai_cards,
    COUNT(DISTINCT cm.card_id_th) as mapped_thai_cards,
    ROUND(100.0 * COUNT(DISTINCT cm.card_id_th) / NULLIF(COUNT(DISTINCT pc.id), 0), 2) as mapping_percentage,
    AVG(cm.confidence_score) as avg_confidence_score,
    MIN(cm.confidence_score) as min_confidence_score,
    MAX(cm.confidence_score) as max_confidence_score
FROM pokemon_cards pc
LEFT JOIN card_mappings cm ON pc.id = cm.card_id_th
WHERE pc.language = 'th';

-- Query 4: Sample matched cards with details
SELECT 
    th.name as thai_name,
    th.english_name,
    th.set_id as thai_set,
    en.name as matched_english_name,
    en.set_id as english_set,
    en.rarity as english_rarity,
    cm.confidence_score,
    cm.match_method,
    cm.verified
FROM card_mappings cm
JOIN pokemon_cards th ON cm.card_id_th = th.id
JOIN pokemon_cards en ON cm.card_id_en = en.id
ORDER BY cm.confidence_score DESC
LIMIT 20;

-- Query 5: Cards with prices vs without prices
SELECT 
    COUNT(DISTINCT cm.card_id_th) as mapped_cards,
    COUNT(DISTINCT mv.card_id) as cards_with_prices,
    ROUND(100.0 * COUNT(DISTINCT mv.card_id) / NULLIF(COUNT(DISTINCT cm.card_id_th), 0), 2) as price_coverage_percentage
FROM card_mappings cm
LEFT JOIN market_values mv ON cm.card_id_th = mv.card_id;

-- Query 6: Unmapped Thai cards (need manual review)
SELECT 
    id,
    name,
    english_name,
    set_id,
    number,
    rarity
FROM pokemon_cards
WHERE language = 'th'
AND id NOT IN (SELECT card_id_th FROM card_mappings)
ORDER BY set_id, CAST(number AS INTEGER)
LIMIT 50;

-- Query 7: Low confidence mappings (may need review)
SELECT 
    th.name as thai_name,
    th.english_name,
    en.name as matched_english_name,
    en.set_id as english_set,
    cm.confidence_score,
    cm.match_method
FROM card_mappings cm
JOIN pokemon_cards th ON cm.card_id_th = th.id
JOIN pokemon_cards en ON cm.card_id_en = en.id
WHERE cm.confidence_score < 0.8
ORDER BY cm.confidence_score ASC
LIMIT 30;
