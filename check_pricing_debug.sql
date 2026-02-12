
-- Check market values for Mega Heracross ex or similar cards in MA2
SELECT 
    c.id, 
    c.name, 
    c.set_id, 
    mv.market_avg, 
    mv.currency,
    mv.updated_at
FROM pokemon_cards c
LEFT JOIN market_values mv ON c.id = mv.card_id
WHERE c.set_id = 'MA2' 
AND c.name ILIKE '%Heracross%'
LIMIT 5;

-- Check if there are any default $5 values (approx 160-170 THB or just 5)
SELECT count(*) as count_5_avg FROM market_values WHERE market_avg = 5;
