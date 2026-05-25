-- Normalize Thai card rarities to JP-style abbreviations (AR, SAR, RR, SR, UR, R, U, C).
--
-- Background: ~half of the language='th' rows still carry English rarity strings
-- ("Illustration Rare", "Double Rare", ...). Thai collectors expect the JP codes
-- since the printed Thai cards use the same symbols. This migration is idempotent
-- — rows already in JP form (C, U, R, AR, SAR, ...) are skipped by the WHERE clauses.
--
-- Safety: this does NOT alter the card_mappings table (Thai→English/Japanese mappings
-- for market price estimates). Those mappings are keyed by id, not rarity. The fuzzy
-- matcher uses english_name for primary matching; rarity is only a confidence bonus.

BEGIN;

UPDATE pokemon_cards SET rarity = 'C'   WHERE language = 'th' AND lower(rarity) = 'common';
UPDATE pokemon_cards SET rarity = 'U'   WHERE language = 'th' AND lower(rarity) = 'uncommon';
UPDATE pokemon_cards SET rarity = 'R'   WHERE language = 'th' AND lower(rarity) = 'rare';
UPDATE pokemon_cards SET rarity = 'RR'  WHERE language = 'th' AND lower(rarity) = 'double rare';
UPDATE pokemon_cards SET rarity = 'SR'  WHERE language = 'th' AND lower(rarity) = 'ultra rare';
UPDATE pokemon_cards SET rarity = 'AR'  WHERE language = 'th' AND lower(rarity) = 'illustration rare';
UPDATE pokemon_cards SET rarity = 'SAR' WHERE language = 'th' AND lower(rarity) = 'special illustration rare';
UPDATE pokemon_cards SET rarity = 'UR'  WHERE language = 'th' AND lower(rarity) = 'hyper rare';
UPDATE pokemon_cards SET rarity = 'AR'  WHERE language = 'th' AND lower(rarity) = 'shiny rare';
UPDATE pokemon_cards SET rarity = 'UR'  WHERE language = 'th' AND lower(rarity) = 'shiny ultra rare';
UPDATE pokemon_cards SET rarity = 'UR'  WHERE language = 'th' AND lower(rarity) = 'mega hyper rare';
UPDATE pokemon_cards SET rarity = 'ACE' WHERE language = 'th' AND lower(rarity) = 'ace spec rare';
UPDATE pokemon_cards SET rarity = 'R'   WHERE language = 'th' AND lower(rarity) = 'black & white rare';

-- Holo Rare variants from older sets (rare in Thai catalog but present)
UPDATE pokemon_cards SET rarity = 'R'  WHERE language = 'th' AND lower(rarity) IN ('holo rare', 'rare holo');
UPDATE pokemon_cards SET rarity = 'RR' WHERE language = 'th' AND lower(rarity) IN ('holo rare v', 'holo rare vmax', 'holo rare vstar', 'rare holo v', 'rare holo vmax', 'rare holo vstar');
UPDATE pokemon_cards SET rarity = 'SAR' WHERE language = 'th' AND lower(rarity) = 'secret rare';
UPDATE pokemon_cards SET rarity = 'SR' WHERE language = 'th' AND lower(rarity) IN ('radiant rare', 'amazing rare');

COMMIT;
