-- Sealed products can be added to collections and listed for sale. They ride
-- the same card_data-snapshot pipeline as single cards (collection_items /
-- listings JSONB snapshots), so the only schema change needed is allowing the
-- 'Sealed' condition value that sealed items carry instead of a card grade.
--
-- The condition CHECK constraints were created inline in 20260124_initial_schema,
-- so their names are the Postgres defaults (<table>_condition_check) — but drop
-- by inspecting pg_constraint rather than by name, so a differently-named
-- leftover check can't survive and keep rejecting 'Sealed' inserts.

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname, conrelid::regclass::text AS tbl
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('public.collection_items'::regclass, 'public.listings'::regclass)
      AND pg_get_constraintdef(oid) ILIKE '%condition%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

ALTER TABLE collection_items ADD CONSTRAINT collection_items_condition_check
  CHECK (condition IN ('Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged', 'Sealed'));

ALTER TABLE listings ADD CONSTRAINT listings_condition_check
  CHECK (condition IN ('Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged', 'Sealed'));
