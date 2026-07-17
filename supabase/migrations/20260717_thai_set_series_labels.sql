-- Thai set rows split from their Japanese twins (the *-th rows) kept the
-- placeholder series 'Pokémon (JP)' that scripts/ingest/jp-sets-backfill.mjs
-- stamps on JA rows. The Explore expansion picker shows pokemon_sets.series as
-- the subtitle, so these Thai sets read "POKÉMON (JP)" instead of their era.
-- Relabel by set-code prefix, matching detectSeries() in scripts/import-thai-sets.js.

-- Sword & Shield era (S* codes)
UPDATE pokemon_sets
SET series = 'Sword & Shield'
WHERE language = 'th'
  AND series = 'Pokémon (JP)'
  AND id IN ('S9-th', 'S9a-th', 'S12-th', 'S12a-th');

-- Scarlet & Violet era (SV* codes)
UPDATE pokemon_sets
SET series = 'Scarlet & Violet'
WHERE language = 'th'
  AND series = 'Pokémon (JP)'
  AND id LIKE 'SV%';

-- s6k (ภูตทมิฬ / Jet-Black Spirit) was imported with series 'Other'.
UPDATE pokemon_sets
SET series = 'Sword & Shield'
WHERE language = 'th'
  AND id = 's6k';

-- Verify: no Thai row should still carry the JP placeholder.
SELECT id, name, series
FROM pokemon_sets
WHERE language = 'th'
  AND (series = 'Pokémon (JP)' OR series = 'Other')
ORDER BY id;

-- Optional polish (uncomment to run): the starter-deck / promo rows below have
-- NULL series today, so the picker shows the generic "EXPANSION" fallback.
-- UPDATE pokemon_sets SET series = 'Sword & Shield'
--   WHERE language = 'th' AND series IS NULL AND id IN ('SC1D','SCA','SCB','SCC','SCD','SCE','SCF','SH');
-- UPDATE pokemon_sets SET series = 'Scarlet & Violet'
--   WHERE language = 'th' AND series IS NULL AND id IN ('SVAL','SVAM','SVAW','SVDs','SVHK');
-- UPDATE pokemon_sets SET series = 'Mega Evolution'
--   WHERE language = 'th' AND series IS NULL AND id IN ('MAAF','MAAL');
