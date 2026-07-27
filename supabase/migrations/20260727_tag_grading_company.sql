-- Accept TAG as a grading company on listings and collection_items.
--
-- listings.grading_company was constrained inline in 20260124_initial_schema.sql
-- (PSA/BGS/CGC/ARS, auto-named constraint); collection_items got
-- collection_items_grading_company_chk in 20260707_collection_graded.sql
-- (PSA/BGS/CGC/SGC/ARS). Both are rebuilt here to the same domain so the two
-- tables can't drift: PSA / BGS / CGC / SGC / ARS / TAG.
--
-- Idempotent: safe to run more than once from the SQL Editor.

DO $$
DECLARE
  con RECORD;
BEGIN
  -- The original CHECK was declared inline, so its name is auto-generated —
  -- look it up instead of assuming.
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.listings'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%grading_company%'
  LOOP
    EXECUTE format('ALTER TABLE public.listings DROP CONSTRAINT %I', con.conname);
  END LOOP;

  ALTER TABLE public.listings
    ADD CONSTRAINT listings_grading_company_check
    CHECK (grading_company IS NULL OR grading_company IN ('PSA','BGS','CGC','SGC','ARS','TAG'));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_items_grading_company_chk') THEN
    ALTER TABLE collection_items DROP CONSTRAINT collection_items_grading_company_chk;
  END IF;

  ALTER TABLE collection_items
    ADD CONSTRAINT collection_items_grading_company_chk
    CHECK (grading_company IS NULL OR grading_company IN ('PSA','BGS','CGC','SGC','ARS','TAG'));
END $$;
