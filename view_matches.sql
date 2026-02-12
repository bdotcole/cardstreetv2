-- View recent matches with breakdown by set
SELECT 
    th.set_id as set_code,
    th.name as thai_name,
    th.rarity as thai_rarity,
    en.name as english_name,
    en.rarity as english_rarity,
    cm.confidence_score,
    cm.algorithm_version,
    cm.created_at
FROM card_mappings cm
JOIN pokemon_cards th ON cm.card_id_th = th.id
JOIN pokemon_cards en ON cm.card_id_en = en.id
ORDER BY cm.created_at DESC
LIMIT 50;

-- Check coverage stats
SELECT 
    pc.set_id,
    COUNT(*) as total_cards,
    COUNT(cm.id) as mapped_cards,
    ROUND(COUNT(cm.id) * 100.0 / COUNT(*), 1) as coverage_percent
FROM pokemon_cards pc
LEFT JOIN card_mappings cm ON pc.id = cm.card_id_th
WHERE pc.language = 'th'
  AND pc.set_id IN ('MA', 'MA1', 'MA2', 'SV11s', 'SV10s', 'SV9s')
GROUP BY pc.set_id
ORDER BY coverage_percent ASC;
