-- A referral slug for every account, not just partners.
--
-- The referral machinery has been complete since 20260611_referral_tracking:
-- /join/<slug> drops the cs_ref cookie, /api/referrals/attribute stamps
-- referred_by and pays the referrer (referral_signup XP now, referral_converted
-- coins on the referred user's first settled order). Only partners could reach
-- any of it, because only partners had a slug and /api/referrals/me returned
-- 403 to everyone else. That is a growth channel switched off for ~1,070
-- accounts on a marketplace whose measured constraint is demand.
--
-- Slug shape is byte-for-byte the one in 20260611 step 3 and in
-- lib/referrals.ts generatePartnerSlug: ASCII-only name prefix + 4 hex chars.
-- ASCII matters -- these end up in printed QR codes and Play Store referrer
-- params. A Thai-only display_name reduces to nothing, so username (already
-- constrained to [a-z0-9_]) is tried before falling back to 'user'.
--
-- 'user' rather than 'partner' as the last resort: an ordinary collector's
-- invite link should not read /join/partner-a1b2.
--
-- Idempotent (only fills NULLs). The unique index on partner_qr_slug makes a
-- collision a hard error rather than a silent overwrite, so the loop retries.
-- app/api/referrals/me also mints lazily, so accounts created after this runs
-- get one on first use and this file never needs re-running for them.

DO $$
DECLARE
  v_row RECORD;
  v_base TEXT;
  v_slug TEXT;
  v_attempt INT;
BEGIN
  FOR v_row IN
    SELECT id, display_name, username FROM public.profiles WHERE partner_qr_slug IS NULL
  LOOP
    v_base := coalesce(
      nullif(btrim(left(lower(regexp_replace(coalesce(v_row.display_name, ''), '[^a-zA-Z0-9]+', '-', 'g')), 20), '-'), ''),
      nullif(btrim(left(lower(regexp_replace(coalesce(v_row.username, ''), '[^a-zA-Z0-9]+', '-', 'g')), 20), '-'), ''),
      'user'
    );
    FOR v_attempt IN 1..5 LOOP
      v_slug := v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
      BEGIN
        UPDATE public.profiles SET partner_qr_slug = v_slug WHERE id = v_row.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- Regenerate the suffix and try again; 5 attempts over a 65k suffix
        -- space against a few thousand rows is not a realistic failure.
        NULL;
      END;
    END LOOP;
  END LOOP;
END $$;

-- Reporting check: every account should now have a slug.
-- SELECT count(*) FILTER (WHERE partner_qr_slug IS NULL) AS missing,
--        count(*) AS total
-- FROM public.profiles;
