-- Alternative: Use pg_cron to schedule portfolio snapshots
-- This runs entirely within Postgres and calls the Edge Function via HTTP

-- 1. Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Schedule the job to run every hour
SELECT cron.schedule(
  'create-portfolio-snapshots-hourly', -- Job name
  '0 * * * *',                          -- Cron expression: every hour at minute 0
  $$
    SELECT
      net.http_post(
        url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/create-portfolio-snapshots',
        headers := jsonb_build_object(
          'Authorization', 'Bearer YOUR_ANON_KEY',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      ) AS request_id;
  $$
);

-- 3. Verify the job was created
SELECT * FROM cron.job;

-- 4. Check job run history
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
