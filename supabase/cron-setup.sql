-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily market update at 04:00 GMT+7 (21:00 UTC)
SELECT cron.schedule(
  'daily-market-update',
  '0 21 * * *',
  $$
  SELECT net.http_post(
    url:='https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/daily-market-update',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTc3MTksImV4cCI6MjA4NDg5MzcxOX0.xvoLoBzTP_Tzff5E35tupTBNdUFUuiMOaOAQd6zGI6I"}'::jsonb
  ) AS request_id
  $$
);

-- Verify cron job is scheduled
SELECT * FROM cron.job;

-- View execution logs
-- SELECT * FROM cron.job_run_details WHERE jobname = 'daily-market-update' ORDER BY start_time DESC LIMIT 10;

-- Remove cron job (if needed)
-- SELECT cron.unschedule('daily-market-update');
