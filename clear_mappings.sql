
-- clear mappings for MA1 and MA2 so they get regenerated with correct set IDs
DELETE FROM card_mappings 
WHERE card_id_th IN (
    SELECT id FROM pokemon_cards WHERE set_id IN ('MA1', 'MA2')
);

-- Also clear market values for these sets to force price update
DELETE FROM market_values
WHERE card_id IN (
    SELECT id FROM pokemon_cards WHERE set_id IN ('MA1', 'MA2')
);
