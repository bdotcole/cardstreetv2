-- Index pokemon_cards.number so a search by printed card number stops
-- scanning the whole catalog.
--
-- Search ("146/187", "#25"), the scanner's number tiers and the collection
-- import all filter on `number = '<n>'` OR `number ILIKE '<n>/%'`. With no
-- index on the column, the fallback leg of a "146/187" search (number only, no
-- set filter) seq-scanned ~123k rows: 5.8 s cold on 2026-11-12, past the anon
-- role's 3 s statement_timeout, so it reached Sentry as "canceling statement
-- due to statement timeout" (issues 1A / 4T, real users).
--
-- text_pattern_ops makes the btree usable for the prefix legs as well as for
-- equality: Postgres turns an ILIKE whose pattern starts with non-alphabetic
-- characters ('146/%') into an index range, and the numerators are digits.
--
-- CONCURRENTLY so catalog writes are not blocked while it builds; it cannot
-- run inside a transaction, so run this statement on its own. Safe to re-run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pokemon_cards_number_pattern
    ON public.pokemon_cards (number text_pattern_ops);
