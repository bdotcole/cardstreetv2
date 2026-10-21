-- Beta feature gating: per-user grants + a global per-feature kill switch.
--
-- profiles.beta_features holds the features a user is opted into (e.g.
-- '{auctions}'); admins pass every gate by role (checked in lib/betaAuth.ts,
-- not here -- same admin-is-Pro-by-role pattern as premium).
--
-- beta_feature_flags is the kill switch: enabled=false turns a feature off
-- for everyone, admins included, without a deploy. Service-role only -- the
-- client learns its access through GET /api/beta/status.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS beta_features TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.beta_feature_flags (
    feature TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS on with no policies: anon/authenticated can neither read nor write;
-- only service-role code paths touch this table.
ALTER TABLE public.beta_feature_flags ENABLE ROW LEVEL SECURITY;

INSERT INTO public.beta_feature_flags (feature, enabled)
VALUES ('auctions', true)
ON CONFLICT (feature) DO NOTHING;
