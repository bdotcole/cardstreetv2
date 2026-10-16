-- Cancelled courier pickups become visible.
--
-- Flash cancels most booked pickups (9 of the 10 booked since 2026-10-04:
-- nobody home, nothing packed) and never tells us, so
-- shipping_labels.pickup_status stayed 'scheduled' forever and the seller
-- waited for a courier who was not coming. The hourly
-- /api/cron/reconcile-pickups route now reads Flash's own pickup ticket list
-- (POST /open/v1/notifications, one request per day), matches tickets to
-- labels by pickup_id (the ticket id requestPickup returned) or by seller
-- phone + postcode after the booking time, and flips a cancelled booking to
-- pickup_status = 'cancelled'. The parcel card then shows "Courier cancelled"
-- with Book again at once (no 6h rebook wait), and the seller is told once per
-- booking.
--
-- pickup_cancelled_at: when the cron saw the cancellation.
-- pickup_cancelled_notified_at: when the seller was told; the cron sends
-- again only for a booking made after this stamp.
--
-- No constraint change: the CHECK that 20260511 meant to add never
-- materialised (the column already existed from 20260502), which is why
-- 'dropoff' and 'requesting' write fine today. Fails soft: the cron exits
-- clean until this runs.
--
-- Apply: npx supabase db query --linked -f supabase/migrations/20261016_pickup_cancelled.sql

ALTER TABLE public.shipping_labels
  ADD COLUMN IF NOT EXISTS pickup_cancelled_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_cancelled_notified_at TIMESTAMPTZ;
