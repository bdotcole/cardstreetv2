-- Live-show blast preferences (additive-only; run in the Supabase SQL Editor).
--
-- WHY THIS EXISTS: lib/courier.ts has filtered on these two columns since the
-- show blasts shipped — sendShowLivePushBlast skips a row whose show_live_push
-- is false, and sendShowEmailBlast collects show_live_email = false into an
-- opt-out set — but the columns were never created. Every other alert in this
-- table has its pair (sold_*, label_*, shipped_*, confirmation_*, offer_*);
-- these two were the exception, so both filters read undefined on every row
-- and the opt-out was unreachable. Confirmed against production 2026-08-24:
-- absent from information_schema.columns.
--
-- What that costs today: a PUBLIC scheduled show fires four whole-base sends —
-- announce email + announce push (app/api/cron/show-reminders, T-3h..T-27h)
-- and go-live email + go-live push (app/api/live/streams/[id]/go-live). At
-- 1,021 accounts and 357 push tokens that is roughly 2,042 emails and 714
-- pushes per show that nobody can refuse. Those blasts share a sending domain
-- with order confirmations, offer alerts and Stripe payout nudges, so the
-- deliverability risk is not confined to marketing mail.
--
-- NOT NULL DEFAULT true matches the `!== false` opt-in convention every other
-- pref in this table uses, so behavior is unchanged the moment this runs:
-- everyone stays subscribed and the existing filters simply start being real.
-- Rows predating this migration — and accounts with no prefs row at all — are
-- already covered by the `defaults` object in lib/courier.ts:getUserNotifContext,
-- and a NOT NULL column can never spread a NULL over those defaults.
--
-- This migration only makes the opt-out STORABLE. Two things still have to
-- ship before a user can actually reach it:
--   1. a Settings toggle that writes these columns, and
--   2. an unsubscribe link in sendShowEmailBlast's inline content — the blast
--      body has none today, which is what Gmail's bulk-sender rules (one-click
--      List-Unsubscribe) care about, independent of any in-app setting.
--
-- Base table + the "System can read" RLS policy backend/edge sends rely on:
-- supabase/migrations/20260222_notification_preferences.sql.

ALTER TABLE public.notification_preferences
    ADD COLUMN IF NOT EXISTS show_live_email BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS show_live_push  BOOLEAN NOT NULL DEFAULT true;
