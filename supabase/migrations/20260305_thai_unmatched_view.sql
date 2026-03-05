-- ============================================================
-- thai_cards_unmatched view
-- Shows all Thai cards that don't yet have an entry in card_mappings.
-- When you insert a row into card_mappings for a Thai card,
-- it automatically disappears from this view.
-- ============================================================

CREATE OR REPLACE VIEW thai_cards_unmatched AS
SELECT
    tc.id                   AS thai_card_id,
    tc.set_id               AS thai_set_id,
    tc.number               AS card_number,
    tc.english_name,
    tc.name                 AS thai_name,
    tc.rarity,
    -- Look up the English set name from set_bridge for context
    sb.english_set_id,
    -- Helpful URL to search pokemontcg.io for the English card
    'https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/?cardName=' ||
        replace(coalesce(tc.english_name, ''), ' ', '+') AS search_url
FROM pokemon_cards tc
LEFT JOIN card_mappings cm
    ON cm.card_id_th = tc.id
LEFT JOIN set_bridge sb
    ON sb.thai_set_id = tc.set_id
WHERE tc.language = 'th'
  AND cm.card_id_th IS NULL   -- no match yet
ORDER BY tc.set_id, tc.number;

-- ============================================================
-- thai_cards_matched view (companion view — for reference)
-- Shows all matched Thai cards with their English counterparts.
-- ============================================================

CREATE OR REPLACE VIEW thai_cards_matched AS
SELECT
    tc.id                   AS thai_card_id,
    tc.set_id               AS thai_set_id,
    tc.number               AS card_number,
    tc.english_name,
    tc.name                 AS thai_name,
    tc.rarity               AS thai_rarity,
    cm.card_id_en,
    ec.set_id               AS en_set_id,
    ec.number               AS en_number,
    ec.name                 AS en_name,
    ec.rarity               AS en_rarity,
    cm.match_method,
    cm.confidence_score,
    cm.verified
FROM pokemon_cards tc
INNER JOIN card_mappings cm
    ON cm.card_id_th = tc.id
LEFT JOIN pokemon_cards ec
    ON ec.id = cm.card_id_en
WHERE tc.language = 'th'
ORDER BY tc.set_id, tc.number;

-- ============================================================
-- Enable read access for anon and authenticated roles
-- ============================================================

GRANT SELECT ON thai_cards_unmatched TO anon, authenticated;
GRANT SELECT ON thai_cards_matched   TO anon, authenticated;
