-- Breaker applications: submissions from the public /become-a-breaker landing
-- page, where breakers, card shops, sellers and TCG creators apply to host on
-- Cardstreet Live.
--
-- Applicants are NOT required to have a CardStreet account — most of the target
-- audience is currently selling on Facebook/TikTok and has never signed up — so
-- there is deliberately no INSERT policy here. Writes go exclusively through
-- app/api/breaker-applications (service-role, rate-limited, honeypotted); RLS
-- with no INSERT policy means an anon or authenticated key cannot write rows
-- directly, which is the point. Signed-in applicants get their user_id stamped
-- so the reviewer can see the existing profile, and can read their own row.
--
-- Approved applicants are granted the existing 'live_broadcast' beta flag
-- (profiles.beta_features, see lib/betaFeatures.ts) — this table is the intake
-- queue in front of that grant, not a second permission system.

CREATE TABLE IF NOT EXISTS public.breaker_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Null for logged-out applicants. ON DELETE SET NULL keeps the application
    -- readable by the team if the account is later deleted.
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'reviewing', 'test_stream', 'approved', 'rejected', 'withdrawn')),
    -- UI language the application was filled in — drives which language the
    -- team replies in, and is not the same as preferred_language below.
    locale TEXT NOT NULL DEFAULT 'th' CHECK (locale IN ('th', 'en')),

    -- ── Contact information ──
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    line_id TEXT,
    city TEXT NOT NULL,
    province TEXT NOT NULL,
    preferred_language TEXT NOT NULL CHECK (preferred_language IN ('th', 'en', 'bilingual')),
    is_adult BOOLEAN NOT NULL,

    -- ── Applicant profile ──
    applicant_types TEXT[] NOT NULL,
    applicant_type_other TEXT,
    business_name TEXT,
    social_links TEXT[] NOT NULL DEFAULT '{}',
    cardstreet_username TEXT,

    -- ── TCG experience ──
    games TEXT[] NOT NULL,
    games_other TEXT,
    breaking_experience TEXT NOT NULL
        CHECK (breaking_experience IN ('none', 'under_1y', '1_to_3y', 'over_3y')),
    experience_summary TEXT NOT NULL,
    sample_video_url TEXT,

    -- ── Streaming readiness ──
    equipment TEXT[] NOT NULL DEFAULT '{}',
    equipment_other TEXT,
    setup_status TEXT NOT NULL CHECK (setup_status IN ('ready', 'minor_improvements', 'building')),
    availability TEXT NOT NULL,
    break_types TEXT NOT NULL,
    inventory_notes TEXT,

    -- ── Written application ──
    why_apply TEXT NOT NULL,
    trust_and_entertainment TEXT NOT NULL,
    anything_else TEXT,

    -- ── Consent ──
    -- Each checkbox is timestamped separately: if the wording of one changes
    -- later, the record of the others is still meaningful.
    consent_accurate_at TIMESTAMPTZ NOT NULL,
    consent_no_guarantee_at TIMESTAMPTZ NOT NULL,
    consent_terms_at TIMESTAMPTZ NOT NULL,

    -- ── Attribution ──
    utm JSONB NOT NULL DEFAULT '{}'::jsonb,
    referrer TEXT,

    -- ── Review ──
    review_notes TEXT,
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,

    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Review queue: newest first within a status.
CREATE INDEX IF NOT EXISTS idx_breaker_applications_status
    ON public.breaker_applications(status, submitted_at DESC);

-- Duplicate-submission guard. Case-insensitive so Bob@x.com and bob@x.com are
-- the same applicant. Not UNIQUE — a rejected applicant may reapply later, and
-- the endpoint decides what counts as a duplicate.
CREATE INDEX IF NOT EXISTS idx_breaker_applications_email
    ON public.breaker_applications(lower(email), submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_breaker_applications_user
    ON public.breaker_applications(user_id)
    WHERE user_id IS NOT NULL;

ALTER TABLE public.breaker_applications ENABLE ROW LEVEL SECURITY;

-- No INSERT policy on purpose (see the header): the API route is the only
-- writer, via the service-role key.

-- A signed-in applicant can read back the applications stamped with their id.
DROP POLICY IF EXISTS "Applicants read own breaker applications" ON public.breaker_applications;
CREATE POLICY "Applicants read own breaker applications"
    ON public.breaker_applications FOR SELECT
    USING (user_id IS NOT NULL AND user_id = auth.uid());

-- Admins manage the queue.
DROP POLICY IF EXISTS "Admins manage breaker applications" ON public.breaker_applications;
CREATE POLICY "Admins manage breaker applications"
    ON public.breaker_applications FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

DROP TRIGGER IF EXISTS handle_updated_at ON public.breaker_applications;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.breaker_applications
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
