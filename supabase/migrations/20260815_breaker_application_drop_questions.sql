-- The breaker application form dropped five questions on 2026-08-15:
-- current equipment (+ other), streaming setup status, and the entire written
-- section (why_apply, trust_and_entertainment, anything_else).
--
-- The columns stay — applications submitted before the change carry answers the
-- review console still shows — but the three NOT NULL ones must become nullable
-- so new submissions (which no longer send them) can insert. equipment already
-- defaults to '{}' and needs no change. The CHECK on setup_status passes NULL
-- as-is, so it can stay.
--
-- Run BEFORE deploying the form change: dropping NOT NULL is compatible with
-- the old code (which always sends values), but the new code fails against the
-- old constraints.

ALTER TABLE public.breaker_applications
    ALTER COLUMN setup_status DROP NOT NULL,
    ALTER COLUMN why_apply DROP NOT NULL,
    ALTER COLUMN trust_and_entertainment DROP NOT NULL;
