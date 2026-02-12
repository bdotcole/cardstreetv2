-- Test the exact query the Edge Function is using to see the structure
SELECT 
    cm.card_id_th, 
    cm.card_id_en, 
    cm.card_id_jp,
    pc.set_id as en_set_id,
    pc.name as en_name
FROM card_mappings cm
LEFT JOIN pokemon_cards pc ON cm.card_id_en = pc.id
ORDER BY cm.created_at DESC
LIMIT 10;
