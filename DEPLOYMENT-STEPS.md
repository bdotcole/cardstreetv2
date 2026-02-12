# Quick Deployment Checklist

## ✓ Step 1: Clean Mappings
Run: `1-cleanup-mappings.sql`

## ✓ Step 2: Deploy Edge Function

1. Open: https://supabase.com/dashboard/project/fdxgzddvywtmnqsaqysx/functions/daily-market-update
2. Click **Code** tab  
3. **Select all and delete**
4. Open: `supabase\functions\daily-market-update\index.ts`
5. **Copy all** (Ctrl+A, Ctrl+C)
6. **Paste** into Supabase editor
7. Click **Deploy**

## ✓ Step 3: Trigger Matching (First Batch)
Run: `2-trigger-matching.sql`

This processes 50 Thai cards at a time.

## ✓ Step 4: Check Logs
https://supabase.com/dashboard/project/fdxgzddvywtmnqsaqysx/functions/daily-market-update/logs

Look for:
- `Matched "ไกลกา" → "Gligar" (set: sv02, score: 0.95, rarity: Common/Common)`
- NO "Skipping MA2" messages
- NO "Fetching prices for Thai sets" messages

## ✓ Step 5: Verify Results  
Run: `3-verify-mappings.sql`

Check that:
- ✅ Mappings created
- ✅ English sets only (sv02, base1, etc.)
- ✅ NO MA2 mappings
- ✅ High confidence scores

## ✓ Step 6: Repeat Until Complete

Run Step 3 again until all Thai cards are mapped.

---

**Questions?** Check the logs after each run to see progress!
