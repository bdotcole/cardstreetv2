// Query to verify imported Thai sets
// Run in Supabase SQL Editor

SELECT 
  id,
  name,
  series,
  printed_total,
  total,
  logo_url,
  created_at
FROM pokemon_sets
WHERE id IN ('MA3', 'MA2', 'MA1', 'SV11s', 'SV10s', 'SV9s', 'SV8s', 'SV7s', 'SV8a')
ORDER BY id;
