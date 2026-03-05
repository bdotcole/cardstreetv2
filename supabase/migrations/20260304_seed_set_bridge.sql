-- Migration: 20260304_seed_set_bridge.sql
-- Creates and seeds the set_bridge table from the Thai Set Tracker CSV data.
-- Maps Thai set IDs to their English set equivalents for card matching.

-- Create the set_bridge table if it doesn't exist
CREATE TABLE IF NOT EXISTS set_bridge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thai_set_id VARCHAR NOT NULL,
    english_set_id VARCHAR,  -- References pokemon_sets.id (the set slug/ID in our DB)
    english_set_name VARCHAR, -- The human-readable English set name (for lookup fallback)
    release_date_th DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(thai_set_id)
);

CREATE INDEX IF NOT EXISTS idx_set_bridge_thai ON set_bridge(thai_set_id);
CREATE INDEX IF NOT EXISTS idx_set_bridge_english ON set_bridge(english_set_id);

-- Seed from Thai Set Tracker (rows with a known English equivalent only)
-- english_set_id will be filled in via a follow-up UPDATE that joins pokemon_sets by name.
INSERT INTO set_bridge (thai_set_id, english_set_name, release_date_th) VALUES
  ('MA3',  'Ascended Heroes',           '2025-06-09'),
  ('MA2',  'Phantasmal Flames',         '2025-07-11'),
  ('MA1',  'Mega Evolution',            '2025-12-09'),
  ('SV11s','Black Bolt & White Flare',  '2025-11-07'),
  ('SV10s','Destined Rivals',           '2025-06-13'),
  ('SV9s', 'Journey Together',          '2025-04-11'),
  ('SV8a', 'Prismatic Evolutions',      '2025-08-24'),
  ('SV8s', 'Stellar Crown',             '2025-06-30'),
  ('SV7s', 'Stellar Crown',             '2025-08-10'),
  ('SV6',  'Twilight Masquerade',       '2024-05-01'),
  ('SV5a', 'Twilight Masquerade',       '2024-04-01'),
  ('SV5M', 'Temporal Forces',           '2024-02-01'),
  ('SV5K', 'Temporal Forces',           '2024-02-01'),
  ('SV4a', 'Paldean Fates',             '2024-01-01'),
  ('SV4M', 'Paradox Rift',              '2023-12-01'),
  ('SV4K', 'Paradox Rift',              '2023-12-01'),
  ('SV3a', 'Paradox Rift',              '2023-10-01'),
  ('SV3',  'Obsidian Flames',           '2023-09-01'),
  ('SV2a', 'Pokemon 151',               '2023-07-01'),
  ('SV2D', 'Paldea Evolved',            '2023-06-01'),
  ('SV2P', 'Paldea Evolved',            '2023-06-01'),
  ('SV1a', 'Paldea Evolved',            '2023-04-01'),
  ('SV1V', 'Scarlet & Violet',          '2023-02-01'),
  ('SV1S', 'Scarlet & Violet',          '2023-02-01')
ON CONFLICT (thai_set_id) DO UPDATE SET
  english_set_name = EXCLUDED.english_set_name,
  release_date_th  = EXCLUDED.release_date_th;

-- Attempt to auto-resolve english_set_id from pokemon_sets table by name match
-- This handles different capitalizations or slight name differences
UPDATE set_bridge sb
SET english_set_id = ps.id
FROM pokemon_sets ps
WHERE ps.language = 'en'
  AND (
    LOWER(ps.name) = LOWER(sb.english_set_name)
    OR ps.name ILIKE '%' || sb.english_set_name || '%'
    OR sb.english_set_name ILIKE '%' || ps.name || '%'
  )
  AND sb.english_set_id IS NULL;

-- Summary of what was seeded
SELECT thai_set_id, english_set_name, english_set_id,
       CASE WHEN english_set_id IS NOT NULL THEN 'RESOLVED' ELSE 'UNRESOLVED' END AS status
FROM set_bridge
ORDER BY thai_set_id;
