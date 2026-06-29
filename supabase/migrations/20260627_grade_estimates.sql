-- AI Card Grader: saved grade estimates.
--
-- Premium feature, gated by `ai_grader` in lib/entitlements.ts. Stores the
-- ESTIMATE the vision model returns for a user's card -- explicitly NOT an
-- official PSA / BGS / CGC grade. Source images are not persisted (privacy +
-- storage cost); only the numeric result and short per-aspect notes.

CREATE TABLE IF NOT EXISTS grade_estimates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  card_id      TEXT,                       -- optional link to pokemon_cards.id when the card was identified first
  card_name    TEXT,                       -- denormalized label so history renders without a join
  game         TEXT,
  overall      NUMERIC(3,1) NOT NULL,      -- composite estimate, 1.0 - 10.0
  centering    NUMERIC(3,1),
  corners      NUMERIC(3,1),
  edges        NUMERIC(3,1),
  surface      NUMERIC(3,1),
  confidence   NUMERIC(3,2),               -- 0.00 - 1.00 model confidence
  notes        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- per-aspect notes + summary + image quality
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grade_estimates_user_id
  ON grade_estimates (user_id, created_at DESC);

ALTER TABLE grade_estimates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own grade estimates" ON grade_estimates;
CREATE POLICY "Users can view own grade estimates"
  ON grade_estimates FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own grade estimates" ON grade_estimates;
CREATE POLICY "Users can insert own grade estimates"
  ON grade_estimates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own grade estimates" ON grade_estimates;
CREATE POLICY "Users can delete own grade estimates"
  ON grade_estimates FOR DELETE
  USING (auth.uid() = user_id);
