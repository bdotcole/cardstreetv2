
-- Delete market values for me01 cards to force re-pricing
DELETE FROM market_values
WHERE card_id IN (
    SELECT id FROM pokemon_cards WHERE set_id = 'me01'
);
