-- Query 1: Check if market values were created
SELECT 
    mv.created_at,
    pc.name as card_name,
    mv.market_avg,
    mv.condition,
    mv.source_links
FROM market_values mv
JOIN pokemon_cards pc ON mv.card_id = pc.id
WHERE mv.language = 'th'
ORDER BY mv.created_at DESC
LIMIT 10;

-- Query 2: Count total market values
SELECT COUNT(*) as total_thai_prices FROM market_values WHERE language = 'th';

-- Query 3: Check mappings that don't have prices yet
SELECT 
    cm.created_at,
    th.name as thai_name,
    en.name as english_name,
    cm.confidence_score
FROM card_mappings cm
JOIN pokemon_cards th ON cm.card_id_th = th.id
LEFT JOIN pokemon_cards en ON cm.card_id_en = en.id
LEFT JOIN market_values mv ON mv.card_id = cm.card_id_th AND mv.language = 'th'
WHERE mv.id IS NULL
ORDER BY cm.created_at DESC
LIMIT 10;
