-- Seller ship-by reminders.
--
-- A paid order has a 2-day handling promise (HANDLING_DAYS in lib/orderDisputes.ts,
-- the same window the Product JSON-LD publishes). Nothing enforced it: the seller
-- saw no deadline and heard nothing until the buyer complained. The
-- /api/cron/ship-reminders route now sends the seller a push (email fallback) at
-- 24h and 48h after payment while the parcel has not moved, and pages the founder
-- at 72h. These two columns make each stage send exactly once per parcel (CAS on
-- ship_reminder_count). Fails soft: the cron exits clean until this runs.
--
-- Run in the Supabase SQL Editor.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ship_reminder_count   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ship_reminder_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_awaiting_shipment
  ON public.orders (created_at)
  WHERE status IN ('paid', 'label_generated', 'processing');
