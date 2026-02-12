-- Test queries to verify the market data system is working

-- 1. Check if cron job is scheduled
SELECT jobname, schedule, command, active 
FROM cron.job 
WHERE jobname LIKE '%market%';

-- 2. Check cron job execution history
SELECT jobid, jobname, status, return_message, start_time, end_time
FROM cron.job_run_details 
WHERE jobname LIKE '%market%'
ORDER BY start_time DESC 
LIMIT 5;

-- 3. Check if any Thai cards have been mapped
SELECT COUNT(*) as total_mappings,
       COUNT(card_id_en) as en_mappings,
       COUNT(card_id_jp) as jp_mappings,
       AVG(confidence_score) as avg_confidence
FROM card_mappings;

-- 4. Check if any market values have been stored
SELECT COUNT(*) as total_values,
       COUNT(DISTINCT card_id) as unique_cards,
       MIN(market_avg) as min_price,
       MAX(market_avg) as max_price,
       AVG(market_avg) as avg_price
FROM market_values
WHERE language = 'th';

-- 5. View recent market values
SELECT mv.*, pc.name as card_name
FROM market_values mv
JOIN pokemon_cards pc ON mv.card_id = pc.id
WHERE mv.language = 'th'
ORDER BY mv.last_updated DESC
LIMIT 10;

-- 6. View sample mappings
SELECT 
    th.name as thai_card,
    COALESCE(en.name, jp.name) as matched_card,
    CASE WHEN cm.card_id_en IS NOT NULL THEN 'EN' ELSE 'JP' END as match_language,
    cm.match_method,
    cm.confidence_score
FROM card_mappings cm
JOIN pokemon_cards th ON cm.card_id_th = th.id
LEFT JOIN pokemon_cards en ON cm.card_id_en = en.id
LEFT JOIN pokemon_cards jp ON cm.card_id_jp = jp.id
ORDER BY cm.created_at DESC
LIMIT 10;
