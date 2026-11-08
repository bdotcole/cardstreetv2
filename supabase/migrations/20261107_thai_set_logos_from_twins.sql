-- Thai sets reprint a Japanese product 1:1 under the same code (S11a-th <-> S11a),
-- and 20 of the Thai set rows (S5a-th .. S11a-th, SVM-th) carry no logo_url while
-- the JP twin does. /api/sets borrows the twin's logo at read time for the mobile
-- set picker; this persists the same borrow so the surfaces that read
-- pokemon_sets directly (desktop set pages, the master-set browser) show the
-- set's artwork instead of a blank tile.
--
-- Idempotent: only rows with no logo are touched. Reversible: the Thai rows
-- written here are exactly those whose logo_url equals their twin's, so
--   UPDATE pokemon_sets th SET logo_url = NULL FROM pokemon_sets ja
--   WHERE th.language = 'th' AND ja.id = regexp_replace(th.id, '-th$', '', 'i')
--     AND ja.language <> 'th' AND th.logo_url = ja.logo_url;
-- puts them back.

UPDATE pokemon_sets th
SET logo_url = ja.logo_url,
    symbol_url = COALESCE(NULLIF(th.symbol_url, ''), ja.symbol_url)
FROM pokemon_sets ja
WHERE th.language = 'th'
  AND (th.logo_url IS NULL OR th.logo_url = '')
  AND ja.id = regexp_replace(th.id, '-th$', '', 'i')
  AND ja.language <> 'th'
  AND ja.logo_url IS NOT NULL
  AND ja.logo_url <> '';
