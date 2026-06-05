-- Weekly price refresh for non-English-Pokemon catalogs (batch-price-games).
-- One game per invocation (each fits the Edge Function wall-clock limit),
-- staggered Sunday slots so they never overlap (50 req/min JustTCG limit) and
-- sit after the daily English job (21:00 UTC). ~180 JustTCG calls/week total.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  fn_url text := 'https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/batch-price-games';
  auth  text := 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTc3MTksImV4cCI6MjA4NDg5MzcxOX0.xvoLoBzTP_Tzff5E35tupTBNdUFUuiMOaOAQd6zGI6I';
  j record;
  grp text;
  mins int;
BEGIN
  -- staggered minute offsets per group
  FOR grp, mins IN SELECT * FROM (VALUES ('mtg',0),('onepiece',5),('yugioh',9),('pokemon-jp',12)) AS t(g,m) LOOP
    -- remove any prior schedule with this name
    FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'price-games-' || grp LOOP
      PERFORM cron.unschedule(j.jobid);
    END LOOP;
    PERFORM cron.schedule(
      'price-games-' || grp,
      mins || ' 22 * * 0',
      format(
        $q$SELECT net.http_post(url:=%L, headers:=%L::jsonb, body:=%L::jsonb)$q$,
        fn_url,
        json_build_object('Content-Type','application/json','Authorization', auth)::text,
        json_build_object('group', grp)::text
      )
    );
  END LOOP;
END $$;

SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'price-games-%' ORDER BY jobname;
