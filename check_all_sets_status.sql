-- Check mapping status for ALL targeted Thai sets
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

-- Total Summary
SELECT 
    COUNT(*) as total_target_cards,
    COUNT(cm.id) as total_mapped,
    ROUND(COUNT(cm.id) * 100.0 / COUNT(*), 1) as total_coverage_percent
FROM pokemon_cards pc
LEFT JOIN card_mappings cm ON pc.id = cm.card_id_th
WHERE pc.language = 'th'
  AND pc.set_id IN ('MA', 'MA1', 'MA2', 'SV11s', 'SV10s', 'SV9s');
