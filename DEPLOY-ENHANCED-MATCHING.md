# Enhanced Card Matching - Deployment Guide

## What Changed

**New Matching Algorithm:**
- 70% weight: English name similarity (Levenshtein distance)
- 20% weight: Rarity match bonus
- 10% weight: Release date proximity (within 2 years)
- Still filters out Thai sets (MA, MA2, etc.)

**Example Scoring:**
- "Gengar" + "Gengar" = 1.0 name similarity
- Same rarity = +0.2 bonus
- Released within 2 years = +0.1 bonus  
- **Total: 0.70 + 0.20 + 0.10 = 1.00 (perfect match)**

## Step 1: Clean Old Mappings

```sql
-- Delete all existing mappings (we'll recreate with better algorithm)
DELETE FROM card_mappings;
```

## Step 2: Deploy Updated Edge Function

1. Open: https://supabase.com/dashboard/project/fdxgzddvywtmnqsaqysx/functions/daily-market-update
2. Click "Code" tab
3. Delete all existing code
4. Copy ALL content from: `supabase\functions\daily-market-update\index.ts`
5. Paste into editor
6. Click "Deploy"
7. Wait for deployment success

## Step 3: Trigger Matching (First Batch)

```sql
SELECT net.http_post(
  url:='https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/daily-market-update',
  headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTc3MTksImV4cCI6MjA4NDg5MzcxOX0.xvoLoBzTP_Tzff5E35tupTBNdUFUuiMOaOAQd6zGI6I"}'::jsonb
);
```

## Step 4: Check Logs

Go to: https://supabase.com/dashboard/project/fdxgzddvywtmnqsaqysx/functions/daily-market-update/logs

**Expected output:**
```
Matched "ไกลกา" → "Gligar" (set: sv02, score: 0.95, rarity: Common/Common)
Matched "โกส" → "Gastly" (set: base1, score: 1.00, rarity: Common/Common)
Skipping MA2 mapping: ...  (should NOT appear anymore)
```

## Step 5: Verify Mappings

```sql
-- Check how many were mapped
SELECT COUNT(*) FROM card_mappings;

-- Check which English sets they mapped to
SELECT pc.set_id, COUNT(*) as count
FROM card_mappings cm
JOIN pokemon_cards pc ON cm.card_id_en = pc.id
GROUP BY pc.set_id
ORDER BY count DESC;

-- Should see: sv02, base1, neo1, etc.
-- Should NOT see: MA, MA2, MA3
```

## Step 6: Repeat Until All Mapped

Run Step 3 (trigger function) multiple times until all Thai cards are mapped.

Each run processes 50 cards, so:
- 100 Thai cards = 2 runs
- 500 Thai cards = 10 runs  
- 1000 Thai cards = 20 runs

## Step 7: View Sample Mappings

```sql
SELECT 
    th.name as thai_name,
    th.english_name,
    th.rarity as thai_rarity,
    en.name as english_name,
    en.set_id as english_set,
    en.rarity as english_rarity,
    cm.confidence_score,
    cm.match_method
FROM card_mappings cm
JOIN pokemon_cards th ON cm.card_id_th = th.id
JOIN pokemon_cards en ON cm.card_id_en = en.id
ORDER BY cm.confidence_score DESC
LIMIT 20;
```

## Success Criteria

✅ No mappings to MA/MA2 sets
✅ High confidence scores (0.8+)
✅ Rarity matches where possible
✅ Ready for price fetching!

## Next Phase

Once all cards are mapped, move to:
- Fetching English prices from APIs
- Calculating Thai prices
- Storing in market_values table
