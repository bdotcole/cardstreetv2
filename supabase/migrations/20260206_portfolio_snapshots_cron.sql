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
        url := 'https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/create-portfolio-snapshots',
        headers := jsonb_build_object(
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTc3MTksImV4cCI6MjA4NDg5MzcxOX0.xvoLoBzTP_Tzff5E35tupTBNdUFUuiMOaOAQd6zGI6I',
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
