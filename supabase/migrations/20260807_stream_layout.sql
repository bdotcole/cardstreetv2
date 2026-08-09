-- Per-feed viewer framing for live streams.
-- Shape: {"main": {"zoom": 1..3, "x": 0..1, "y": 0..1}, "table": {...}} where
-- zoom is the magnification and x/y position the visible 1/zoom window
-- (0.5 = centered). Written by PATCH /api/live/streams/[id]/layout
-- (broadcaster only); viewers pick it up via the existing streams Realtime
-- subscription. NULL / missing keys = default framing (no crop).
ALTER TABLE public.streams ADD COLUMN IF NOT EXISTS layout JSONB;
