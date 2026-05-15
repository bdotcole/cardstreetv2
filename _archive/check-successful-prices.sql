-- Check if the 5 successfully matched cards got priced
SELECT 
    pc_th.name as thai_name,
    pc_en.name as english_name,
    cm.created_at as mapped_at,
    mv.market_avg as thai_price,
    mv.created_at as priced_at
FROM card_mappings cm
JOIN pokemon_cards pc_th ON cm.card_id_th = pc_th.id
JOIN pokemon_cards pc_en ON cm.card_id_en = pc_en.id
LEFT JOIN market_values mv ON mv.card_id = cm.card_id_th AND mv.language = 'th'
WHERE pc_en.name IN ('Paldean Tauros', 'Brambleghast', 'Bramblin', 'Zacian', 'Alcremie')
ORDER BY cm.created_at DESC;
