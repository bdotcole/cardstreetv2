-- Typo-tolerant card search: english_name trigram index + search_cards_fuzzy_v2.
--
-- Smart search (lib/search/*) resolves Pokemon names in any language and with
-- typos on the client, from a dictionary. This file adds the database side.
--
--   1. idx_cards_english_name_trgm: the index that makes smart search fast.
--      Smart search adds english_name ILIKE legs to every catalog fetch, so
--      the ja/th rows' English names are searchable. `name` has had a GIN
--      trigram index since 20260126. english_name only has lower() btrees,
--      which cannot serve a leading-wildcard ILIKE, so one english_name leg
--      turns the whole OR into a sequential scan: about 0.5 s per scope, and
--      statement timeouts (57014) at three concurrent searches. With both
--      columns indexed the OR plans as a BitmapOr in about 40 ms.
--      About 554k trigram entries, against 1.71M for the 14 MB name index, so
--      roughly 4-5 MB. Expect a build of a few seconds. A plain CREATE INDEX
--      holds a SHARE lock while it builds: writes to pokemon_cards wait,
--      reads do not. Run it outside an ingestion window. CONCURRENTLY cannot
--      run inside the SQL Editor's transaction. To avoid blocking writes, run
--      `CREATE INDEX CONCURRENTLY idx_cards_english_name_trgm ...` on its own
--      first; IF NOT EXISTS then skips it here.
--
--   2. search_cards_fuzzy_v2(p_query, p_limit, p_game): the nearest card
--      names by pg_trgm similarity. searchCards calls it in phase 2 only, when
--      the literal and dictionary passes found nothing good. It catches what
--      the Pokemon dictionary does not cover: other games ("dark magican",
--      "blue eyes white dragn", "exodia forbiden", "elsa spirt of winter") and
--      trainer/item names ("professor reserch", "nest bal"). The client turns
--      the call off for the session on 404/PGRST202, so it fails soft until
--      this file runs.
--      - The match is on raw columns: `name % q OR english_name % q`. That is
--        a BitmapOr over the two trigram indexes. Do not wrap a column in
--        COALESCE in the WHERE clause. No index covers the expression
--        COALESCE(english_name, '') % q, so the whole OR becomes a seq scan
--        that builds trigrams for both columns on all 120k rows. Measured
--        today: 435-705 ms per call, against 4-26 ms for the indexed name leg.
--      - Threshold: `%` uses the connection's pg_trgm.similarity_threshold.
--        It defaults to 0.3, and nothing in this codebase changes it. The
--        function cannot set it safely. set_limit() lasts for the whole
--        connection, and PostgREST shares connections. A function-level SET
--        on an extension GUC fails for a non-superuser when pg_trgm is not yet
--        loaded. So `%` only finds the candidates (with index support), and
--        an explicit filter decides the result: similarity >=
--        GREATEST(0.3, 0.6 * best). The absolute 0.3 keeps results the same
--        if a connection has lowered the threshold. The relative 0.6 * best
--        drops weak matches that would otherwise fill the slots when there
--        are fewer real hits than the limit:
--          "elsa spirt of winter"  keeps the 3 Elsa rows, drops "Early Winter" and "Winter Eladrin"
--          "exodia forbiden"       drops "Forbidden Lance" and "Forbidden Dress"
--          "ブラッキ"               drops Black Maria; keeps every Umbreon print
--        A factor of 0.7 was too tight: it cut Umbreon VMAX for "ブラッキ".
--      - Ordering: by similarity, then id. SETOF cannot carry the score, so
--        the array order IS the rank. When the client re-scores these rows,
--        it should keep that order as the tiebreak.
--      - It returns SETOF public.pokemon_cards. PostgREST therefore applies
--        `select=` and the embeds (market_values, pokemon_sets, through the
--        existing FKs) to the result, and one round trip returns mapped-ready
--        rows. The old ids-plus-refetch shape needed two serial requests.
--      - Queries shorter than 4 characters return nothing; they have too few
--        trigrams to rank. The client sends p_query already folded
--        (widthFold, then hiragana to katakana). pg_trgm lowercases and skips
--        punctuation itself. In this database it treats Thai (vowel and tone
--        marks included) and katakana as word characters. Checked with
--        show_trgm: "ลิซาดอน" finds ลิซาร์ดอน at 0.50, "リザドン" finds リザードン
--        at 0.38.
--      - LANGUAGE sql with SET search_path, so the body is not inlined.
--        PG 17 plans it per call with unknown parameter values (a generic
--        plan). The timings above came from PREPARE under
--        plan_cache_mode = force_generic_plan, which plans the same way.
--
-- This supersedes the search parts of 20260907_search_fuzzy_and_indexes.sql,
-- which was never applied. As of 2026-10-03, prod has no search_cards%
-- function and no english_name trigram index. Do not edit that file. Its
-- index statement is identical to the one here, with the same name, so either
-- file can run after the other. Its search_cards_fuzzy is replaced by v2.
-- It returned ids only, and its COALESCE leg defeated the index. The client
-- no longer calls it, so it is not created here. Its search_pokemon_by_phash
-- part is scanner work that this file does not touch.
--
-- Measured read-only against prod on 2026-10-03 (PG 17.6, 120,618 rows),
-- top 30 for each query:
--   charizrd               -> Charizard x30 (0.58)
--   pikachoo               -> Pikachu x30 (0.55)
--   blue eyes white dragn  -> Blue-Eyes White Dragon x30 (0.80)
--   monkey d luffy         -> Monkey.D.Luffy x30 (1.00)
--   professor reserch      -> Professor's Research x30 (0.70)
--   dark magican           -> Dark Magician x30 (0.69)
--   umbreon vmax           -> 9 Umbreon VMAX (1.00), then Umbreon V / Umbreon
--   lugia                  -> Lugia x25, Lugia V x5
--   ลิซาดอน                -> Thai and English-named Charizard prints only
--   リザドン                -> 3 Charizard rows
--   mew                    -> nothing (under 4 characters)
--   Name leg: 4-26 ms with idx_cards_name_trgm. english_name leg: 130-200 ms
--   as a seq scan today. That leg has 40-50% as many index candidates as
--   name, so it should take about 2-13 ms once indexed. Estimated total after
--   this file: about 10-40 ms per call.
--
-- Apply through the Supabase SQL Editor, or with
--   npx supabase db query --linked -f supabase/migrations/20261003_search_trigram_fuzzy.sql
-- Never use `supabase db push`. Everything here is idempotent.
--
-- Verify after applying:
--   SET plan_cache_mode = force_generic_plan;
--   PREPARE chk(text) AS SELECT id FROM public.pokemon_cards WHERE name % $1 OR english_name % $1;
--   EXPLAIN EXECUTE chk('charizrd');   -- expect a BitmapOr over both *_trgm indexes, no Seq Scan
--   SELECT id, name, english_name FROM public.search_cards_fuzzy_v2('charizrd', 5);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_cards_english_name_trgm
  ON public.pokemon_cards USING gin (english_name gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_cards_fuzzy_v2(
  p_query text,
  p_limit integer DEFAULT 30,
  p_game  text    DEFAULT NULL
)
RETURNS SETOF public.pokemon_cards
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH hits AS (
    SELECT pc.id,
           GREATEST(similarity(pc.name, p_query),
                    similarity(coalesce(pc.english_name, ''), p_query)) AS sim
      FROM public.pokemon_cards pc
     WHERE length(btrim(p_query)) >= 4
       AND (pc.name % p_query OR pc.english_name % p_query)
       AND (coalesce(p_game, '') = '' OR pc.game = p_game)
     ORDER BY sim DESC, pc.id
     LIMIT LEAST(GREATEST(coalesce(p_limit, 30), 1), 60)
  )
  SELECT pc.*
    FROM hits
    JOIN public.pokemon_cards pc ON pc.id = hits.id
   WHERE hits.sim >= GREATEST(0.3, 0.6 * (SELECT max(sim) FROM hits))
   ORDER BY hits.sim DESC, pc.id;
$$;

ALTER FUNCTION public.search_cards_fuzzy_v2(text, integer, text) SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.search_cards_fuzzy_v2(text, integer, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
