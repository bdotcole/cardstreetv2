# Complete Manual Deployment Package

I cannot access the browser due to a system error, so here's everything you need to deploy manually. It's actually very simple - just 3 steps!

## 📋 Step 1: Clean Old Mappings (30 seconds)

1. Go to: https://supabase.com/dashboard/project/fdxgzddvywtmnqsaqysx/editor
2. Click **SQL Editor**
3. Paste and run:

```sql
DELETE FROM card_mappings;
SELECT COUNT(*) FROM card_mappings; -- Should return 0
```

## 🚀 Step 2: Deploy Enhanced Edge Function (2 minutes)

1. Go to: https://supabase.com/dashboard/project/fdxgzddvywtmnqsaqysx/functions/daily-market-update
2. Click the **"Code"** tab
3. Click inside the code editor and press **Ctrl+A** to select all
4. Press **Delete** to clear
5. Open this file: `c:\Users\brand\Downloads\cardstreet-tcg\supabase\functions\daily-market-update\index.ts`
6. Press **Ctrl+A** to select all, then **Ctrl+C** to copy
7. Go back to the Supabase Code tab
8. Press **Ctrl+V** to paste
9. Click the green **"Deploy"** button
10. Wait for "Deployment successful" message

## ✅ Step 3: Run Matching & Verify (1 minute)

1. Go back to **SQL Editor**
2. Paste and run:

```sql
-- Trigger matching for first 50 cards
SELECT net.http_post(
  url:='https://fdxgzddvywtmnqsaqysx.supabase.co/functions/v1/daily-market-update',
  headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTc3MTksImV4cCI6MjA4NDg5MzcxOX0.xvoLoBzTP_Tzff5E35tupTBNdUFUuiMOaOAQd6zGI6I"}'::jsonb
) AS request_id;
```

3. Check the logs: https://supabase.com/dashboard/project/fdxgzddvywtmnqsaqysx/functions/daily-market-update/logs

4. Verify mappings were created:

```sql
-- Check results
SELECT COUNT(*) as total_mappings FROM card_mappings;

SELECT pc.set_id, COUNT(*) as count
FROM card_mappings cm
JOIN pokemon_cards pc ON cm.card_id_en = pc.id
GROUP BY pc.set_id
ORDER BY count DESC
LIMIT 10;
```

## 🎯 Success Indicators

**In the logs, you should see:**
- ✅ `Matched "ไกลกา" → "Gligar" (set: sv02, score: 0.95, rarity: Common/Common)`
- ✅ `Processing X mapped cards from international sets`
- ❌ **NO** "Skipping MA2 mapping" (that's the OLD behavior)

**In the verification query:**
- ✅ Mappings to real English sets: sv02, base1, neo1, swsh1, etc.
- ❌ **NO** mappings to MA, MA2, or MA3

## 🔄 Repeat for All Cards

Run Step 3 multiple times until all Thai cards are mapped. Each run processes 50 cards.

---

That's it! Only 3 simple steps. Let me know what you see in the logs after Step 3!
