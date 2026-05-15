# Portfolio History Tracking System - README

## Overview

This directory contains the implementation for the portfolio history tracking system. It stores periodic snapshots of user portfolio values for historical tracking and charting.

## Components

### Database
- **Migration**: `20260206_portfolio_snapshots.sql`
  - Creates `portfolio_snapshots` table
  - Adds proper indexes for performance
  - Sets up RLS policies

### Backend
- **Edge Function**: `create-portfolio-snapshots/index.ts`
  - Runs hourly via cron job
  - Calculates portfolio value for all users
  - Creates snapshots in database
  
- **API Endpoint**: `/api/portfolio/history`
  - Fetches user's portfolio history
  - Supports timeframes: 1D, 1W, 1M, 1Y
  - Zero-fills missing data points

### Frontend
- **Vault.tsx**: Updated to fetch real data from API

## Deployment Steps

### 1. Apply Database Migration

```bash
cd supabase
npx supabase migration up
```

Or via Supabase Dashboard:
- Go to SQL Editor
- Paste contents of `20260206_portfolio_snapshots.sql`
- Run migration

### 2. Deploy Edge Function

```bash
npx supabase functions deploy create-portfolio-snapshots
```

### 3. Configure Cron Schedule

In Supabase Dashboard → Edge Functions → create-portfolio-snapshots:
- Set cron schedule: `0 * * * *` (every hour)

Or use Supabase CLI:
```bash
npx supabase functions schedule create-portfolio-snapshots \
  --schedule "0 * * * *"
```

### 4. Test the Function

Manually invoke to create initial snapshots:
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/create-portfolio-snapshots \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### 5. Generate Test Data (Development Only)

```sql
-- Insert hourly snapshots for last 30 days for testing
INSERT INTO portfolio_snapshots (user_id, total_market_value, item_count, timestamp)
SELECT 
  'YOUR_USER_ID',
  50000 + (random() * 10000)::int,
  100 + (random() * 20)::int,
  NOW() - (generate_series || ' hours')::INTERVAL
FROM generate_series(0, 720, 1);
```

## Testing

1. **Test API Endpoint**:
   ```bash
   curl http://localhost:3000/api/portfolio/history?range=1M
   ```

2. **Verify Chart Display**:
   - Navigate to Vault
   - Switch between timeframes (1D, 1W, 1M, 1Y)
   - Verify chart displays historical data

## Maintenance

### Data Retention

Run this monthly to clean up old data (optional):
```sql
DELETE FROM portfolio_snapshots 
WHERE timestamp < NOW() - INTERVAL '1 year';
```

### Monitor Performance

```sql
-- Check snapshot count per user
SELECT user_id, COUNT(*) as snapshot_count
FROM portfolio_snapshots
GROUP BY user_id
ORDER BY snapshot_count DESC
LIMIT 10;

-- Check latest snapshot times
SELECT user_id, MAX(timestamp) as latest_snapshot
FROM portfolio_snapshots
GROUP BY user_id;
```

## Troubleshooting

### No Data Showing

1. Check if snapshots exist:
   ```sql
   SELECT * FROM portfolio_snapshots WHERE user_id = 'YOUR_USER_ID' LIMIT 10;
   ```

2. Manually create a snapshot:
   - Call the Edge Function manually
   - Or insert a test snapshot via SQL

### Performance Issues

1. Verify indexes exist:
   ```sql
   \d portfolio_snapshots
   ```

2. Analyze query performance:
   ```sql
   EXPLAIN ANALYZE
   SELECT * FROM portfolio_snapshots
   WHERE user_id = 'YOUR_USER_ID'
   AND timestamp >= NOW() - INTERVAL '30 days'
   ORDER BY timestamp ASC;
   ```
