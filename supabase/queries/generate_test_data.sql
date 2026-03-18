-- Generate test portfolio snapshot data for immediate graph visualization
-- This creates 30 days of hourly snapshots with realistic growth patterns

-- Step 1: Get your user ID (replace with your actual email)
-- SELECT id FROM profiles WHERE email = 'your-email@example.com';

-- Step 2: Insert test snapshots (replace YOUR_USER_ID with actual UUID from step 1)
INSERT INTO portfolio_snapshots (user_id, total_market_value, item_count, timestamp)
SELECT 
  'YOUR_USER_ID'::uuid,  -- Replace this with your actual user ID
  -- Create realistic portfolio value growth from ~500 to current value
  (500 + (random() * 50) + (generate_series * 0.5))::decimal(12,2),
  (100 + (random() * 20))::int,
  NOW() - (generate_series || ' hours')::INTERVAL
FROM generate_series(0, 720, 1) -- 720 hours = 30 days of hourly data
ORDER BY generate_series DESC;

-- Step 3: Verify the snapshots were created
SELECT 
  user_id,
  COUNT(*) as total_snapshots,
  MIN(timestamp) as oldest_snapshot,
  MAX(timestamp) as newest_snapshot,
  MIN(total_market_value) as min_value,
  MAX(total_market_value) as max_value
FROM portfolio_snapshots
GROUP BY user_id;

-- Step 4: View sample data
SELECT timestamp, total_market_value, item_count
FROM portfolio_snapshots
WHERE user_id = 'YOUR_USER_ID'::uuid  -- Replace with your user ID
ORDER BY timestamp DESC
LIMIT 50;
