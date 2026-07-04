-- Schedule the every-minute auction sweep (pg_cron → close-auctions edge fn).
-- Wired exactly like release-funds-hourly. Run in the Supabase SQL Editor.
--
-- Prereqs:
--   1. Edge function deployed:  supabase functions deploy close-auctions
--   2. Function secrets set:    CRON_SECRET (must match Vercel's CRON_SECRET)
--                               APP_BASE_URL optional (default cardstreet.app)

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'close-auctions-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url:='https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/close-auctions',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTc3MTksImV4cCI6MjA4NDg5MzcxOX0.xvoLoBzTP_Tzff5E35tupTBNdUFUuiMOaOAQd6zGI6I"}'::jsonb
  ) AS request_id
  $$
);

-- Verify
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'close-auctions-every-minute';

-- Remove (if needed)
-- SELECT cron.unschedule('close-auctions-every-minute');
