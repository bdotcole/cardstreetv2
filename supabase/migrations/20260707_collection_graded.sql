-- Graded fields on collection_items.
--
-- A graded copy must be stored AS graded so its graded market value (not the raw
-- catalog price) flows into portfolio valuation. Mirrors the grading columns on
-- `listings`; grade domain is 1.0-10.0. `grading_company` accepts the graders whose
-- prices the market_values engine recognizes (PSA/BGS/CGC/SGC/ARS).
--
-- Idempotent: safe to run more than once from the SQL Editor.

ALTER TABLE collection_items
  ADD COLUMN IF NOT EXISTS is_graded BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS grading_company TEXT,
  ADD COLUMN IF NOT EXISTS grade NUMERIC(3,1);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_items_grading_company_chk') THEN
    ALTER TABLE collection_items
      ADD CONSTRAINT collection_items_grading_company_chk
      CHECK (grading_company IS NULL OR grading_company IN ('PSA','BGS','CGC','SGC','ARS'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_items_grade_chk') THEN
    ALTER TABLE collection_items
      ADD CONSTRAINT collection_items_grade_chk
      CHECK (grade IS NULL OR (grade >= 1.0 AND grade <= 10.0));
  END IF;
END $$;
