-- Adds confirmation_email and confirmation_push columns to notification_preferences.
-- Required by lib/courier.ts sendOrderConfirmationNotification (Patch 3 from the
-- Phase 1 audit). Default TRUE matches the `!== false` opt-in convention already
-- used by payout_* and delivered_* prefs in the same file. Without these columns,
-- the existing fall-through (`prefs.confirmation_email !== false`) treats undefined
-- as opted-in, which is correct behavior — but a future settings page that lets
-- users toggle these prefs cannot persist them until the columns exist.

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS confirmation_email BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS confirmation_push BOOLEAN NOT NULL DEFAULT TRUE;
