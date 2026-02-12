-- Trigger the Enhanced Matching Edge Function
SELECT net.http_post(
  url:='https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/daily-market-update',
  headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTc3MTksImV4cCI6MjA4NDg5MzcxOX0.xvoLoBzTP_Tzff5E35tupTBNdUFUuiMOaOAQd6zGI6I"}'::jsonb
) AS request_id;
