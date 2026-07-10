-- Scanner telemetry + self-learning photo-hash index.
--
-- scan_events: one row per /api/scan request — which tier resolved it, the
-- extracted OCR fields, the captured photo's dHash, and (via /api/scan/feedback)
-- whether the user confirmed or rejected the result. This is the production
-- version of the "measure before iterating" diagnostic doctrine: tier hit rates,
-- failure clusters, and set-code misread pairs all become queryable.
--
-- scan_learned_phashes: dHashes of real user photos confirmed against a card.
-- The scanner's pHash search unions these with the catalog hashes; real-world
-- photos (glare, sleeves, angle, playmat) match other real-world photos far
-- better than they match pristine catalog art, so every confirmed scan makes
-- that card easier to recognize for everyone — including cards that have no
-- catalog phash at all (~43% of ja rows).
--
-- Code fails soft when this migration hasn't been applied (logging and the
-- learned-hash leg are skipped), so deploy order doesn't matter.

CREATE TABLE IF NOT EXISTS public.scan_events (
    id uuid PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    mode text,                              -- 'live' (auto-capture frame) | 'single' (deliberate shot)
    source text,                            -- resolving tier ('set-code-ocr'|'phash'|'gemini-text'|'gemini-image'); NULL = no match
    phash bytea,                            -- 64-bit dHash of the captured photo (8 bytes)
    ocr jsonb,                              -- Flash-extracted metadata {game,name,setCode,cardNumber,language,confidence}
    matched_card_id text,                   -- top match returned to the client
    candidate_ids text[],                   -- all catalog ids offered; feedback may only confirm one of these (anti-poisoning)
    match_distance int,
    latency_ms int,
    error text,
    outcome text CHECK (outcome IN ('confirmed', 'rejected')),
    confirmed_card_id text,
    outcome_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_scan_events_created ON public.scan_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_outcome ON public.scan_events (outcome) WHERE outcome IS NOT NULL;

-- Service-role only: RLS on with no policies blocks anon/authenticated access.
ALTER TABLE public.scan_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.scan_learned_phashes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    card_id text NOT NULL REFERENCES public.pokemon_cards(id) ON DELETE CASCADE,
    phash bytea NOT NULL,
    confirm_count int NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_confirmed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_learned_phashes_card ON public.scan_learned_phashes (card_id);

ALTER TABLE public.scan_learned_phashes ENABLE ROW LEVEL SECURITY;

-- Record a user-confirmed photo hash for a card.
-- Guardrails: 8-byte hashes only; a near-duplicate (<=4 bits from an existing
-- hash for the same card) bumps that row instead of inserting; at most 8 hashes
-- per card — when full, the least-confirmed/stalest row is replaced so the
-- index tracks how the card actually photographs today.
CREATE OR REPLACE FUNCTION public.record_learned_phash(p_card_id text, p_phash bytea)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_nearest_id bigint;
    v_nearest_dist int;
    v_count int;
BEGIN
    IF p_phash IS NULL OR octet_length(p_phash) <> 8 THEN
        RETURN;
    END IF;

    SELECT lp.id, hamming_distance(lp.phash, p_phash)
    INTO v_nearest_id, v_nearest_dist
    FROM scan_learned_phashes lp
    WHERE lp.card_id = p_card_id
    ORDER BY hamming_distance(lp.phash, p_phash) ASC
    LIMIT 1;

    IF v_nearest_id IS NOT NULL AND v_nearest_dist <= 4 THEN
        UPDATE scan_learned_phashes
        SET confirm_count = confirm_count + 1, last_confirmed_at = now()
        WHERE id = v_nearest_id;
        RETURN;
    END IF;

    SELECT count(*) INTO v_count FROM scan_learned_phashes WHERE card_id = p_card_id;
    IF v_count >= 8 THEN
        DELETE FROM scan_learned_phashes
        WHERE id = (
            SELECT id FROM scan_learned_phashes
            WHERE card_id = p_card_id
            ORDER BY confirm_count ASC, last_confirmed_at ASC
            LIMIT 1
        );
    END IF;

    INSERT INTO scan_learned_phashes (card_id, phash) VALUES (p_card_id, p_phash);
END;
$$;

-- Nearest learned-hash neighbours. Table stays small (<=8 rows/card, only
-- confirmed scans), so a sequential popcount scan is fine indefinitely.
CREATE OR REPLACE FUNCTION public.search_learned_phash(
    query_phash bytea,
    max_distance int DEFAULT 16,
    result_limit int DEFAULT 5
)
RETURNS TABLE (card_id text, distance int)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
    SELECT s.card_id, s.min_d::int AS distance
    FROM (
        SELECT lp.card_id, MIN(hamming_distance(lp.phash, query_phash)) AS min_d
        FROM scan_learned_phashes lp
        GROUP BY lp.card_id
    ) s
    WHERE s.min_d <= max_distance
    ORDER BY s.min_d ASC
    LIMIT result_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.record_learned_phash(text, bytea) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_learned_phash(bytea, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_learned_phash(text, bytea) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_learned_phash(bytea, int, int) TO service_role;
