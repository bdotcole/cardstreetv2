-- Parcels that leave outside our Flash waybill.
--
-- An order advances from label_generated only when Flash scans OUR waybill
-- (the status webhook and the reconcile-shipments cron). When the seller
-- hands the parcel to Flash staff who key it in as a walk-in, sends it with
-- another courier, or delivers it by hand, the waybill sits at Flash state 0
-- forever: the order freezes at label_generated, the ship reminders nag the
-- seller, the 72h founder alert fires, and the buyer cannot confirm receipt
-- (order fe7a1567, delivered off-waybill 2026-10-16).
--
-- These columns record the seller's "Shipped another way" answer
-- (POST /api/orders/label/handoff -> lib/parcels handOffParcel): the carrier
-- they used, the number that carrier gave them, and when. The reconcile cron
-- stops polling Flash for a label whose handed_off_at is set. The code fails
-- soft without these columns (the handoff still flips the order; only the
-- carrier and number go unrecorded).
--
-- Safe to re-run. Run in the Supabase SQL Editor.

ALTER TABLE public.shipping_labels
  ADD COLUMN IF NOT EXISTS handoff_carrier TEXT,
  ADD COLUMN IF NOT EXISTS handoff_tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS handed_off_at TIMESTAMPTZ;

COMMENT ON COLUMN public.shipping_labels.handoff_carrier IS
  'Carrier the seller says the parcel left with when it did not travel under our Flash waybill (seller-entered free text).';
COMMENT ON COLUMN public.shipping_labels.handoff_tracking_number IS
  'Tracking number that carrier gave the seller, if any.';
COMMENT ON COLUMN public.shipping_labels.handed_off_at IS
  'When the seller marked the parcel as shipped another way; reconcile-shipments stops polling Flash for this waybill.';
