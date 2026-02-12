SELECT id, name, release_date 
FROM pokemon_sets 
WHERE name ILIKE '%Black Bolt%' OR name ILIKE '%White Flare%' OR name ILIKE '%Black%' OR name ILIKE '%White%';
