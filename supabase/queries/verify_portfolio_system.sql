-- Quick verification queries for portfolio history system
-- Run these in Supabase SQL Editor to verify everything is working

-- 1. Check if portfolio_snapshots table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'portfolio_snapshots';

-- 2. Check if pg_cron extension is enabled
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- 3. Check if cron job was created
SELECT * FROM cron.job WHERE jobname = 'create-portfolio-snapshots-hourly';

-- 4. Check if any snapshots exist (will be empty if cron hasn't run yet)
SELECT COUNT(*) as snapshot_count FROM portfolio_snapshots;

-- 5. Check most recent snapshots
SELECT user_id, timestamp, total_market_value, item_count
FROM portfolio_snapshots
ORDER BY timestamp DESC
LIMIT 10;

-- 6. Check cron job execution history
SELECT job_id, runid, start_time, end_time, status, return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'create-portfolio-snapshots-hourly')
ORDER BY start_time DESC
LIMIT 5;

-- 7. Manually trigger the Edge Function to create snapshots now (for testing)
SELECT net.http_post(
  url := 'https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/create-portfolio-snapshots',
  headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTc3MTksImV4cCI6MjA4NDg5MzcxOX0.xvoLoBzTP_Tzff5E35tupTBNdUFUuiMOaOAQd6zGI6I", "Content-Type": "application/json"}'::jsonb,
  body := '{}'::jsonb
) AS manual_trigger_result;

-- 8. After manual trigger, check if snapshots were created
SELECT user_id, COUNT(*) as snapshot_count, MAX(timestamp) as latest_snapshot
FROM portfolio_snapshots
GROUP BY user_id;
