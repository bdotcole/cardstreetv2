-- Card pages in small sets top up their "more cards" block from the same game
-- (lib/desktopCardData.ts getSetSiblings fill query):
--   WHERE game = $1 AND language = $2 AND set_id <> $3 AND image_small IS NOT NULL
--     AND id > $4 ORDER BY id LIMIT 80
-- With no index leading on (game, language) in id order, Postgres walks the
-- primary key from $4 to the end of the table: 74k rows filtered, 3.5 s on an idle
-- database for a One Piece card, past the 8 s statement timeout under load
-- (Sentry CARDSTREET-3F/4N/4P). This index turns it into a short range scan.
-- CONCURRENTLY so catalog writes are not blocked while it builds; it cannot run
-- inside a transaction, so run this statement on its own. Safe to re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cards_game_lang_id
  ON public.pokemon_cards (game, language, id);
