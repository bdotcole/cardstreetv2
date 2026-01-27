# Pokemon TCG Supabase Migration Guide

This guide walks through the steps to migrate your Pokemon card data to Supabase.

## Step 1: Apply Database Schema

### Option A: Using Supabase Dashboard (Recommended)

1. Navigate to your Supabase project dashboard
2. Go to **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the contents of `supabase/migrations/20260126_pokemontcg_data.sql`
5. Paste into the SQL editor
6. Click **Run** to execute the migration
7. Verify success - you should see "Success. No rows returned"

### Option B: Using Supabase CLI (Advanced)

```bash
# If you have Supabase CLI installed
supabase db push
```

## Step 2: Run Data Migration Script

### Prerequisites

Install required dependency (if not already installed):

```bash
npm install tsx @supabase/supabase-js
```

### Execute Migration

```bash
npx tsx scripts/migrate-pokemon-data.ts
```

**Expected output:**
```
🚀 Starting Pokemon TCG data migration...

📦 Fetching all Pokemon sets...
   ✓ Fetched page 1: 100 sets (Total: 100)
   
✅ Total sets to migrate: 100+

💾 Importing sets to Supabase...
   ✓ Upserted 100/100 records to pokemon_sets
✅ Successfully imported 100+ sets

[1/100] Processing set: Twilight Masquerade (sv4pt5)
   📥 Fetching cards...
   📝 Found 234 cards
   💾 Importing to Supabase...
   ✓ Upserted 234/234 records to pokemon_cards
   ✅ Imported 234 cards
   Progress: 1.0% complete

...

🎉 Migration completed successfully!
📊 Summary:
   - Sets imported: 100+
   - Cards imported: 20,000+
   - Average cards per set: 200
```

**Migration time:** Approximately 30-60 minutes depending on API rate limits.

**Tips:**
- The script handles rate limiting automatically with exponential backoff
- If interrupted, you can re-run it - it will upsert (update or insert) so no duplicates
- Monitor the console output for any errors
- Leave the terminal window open until completion

## Step 3: Verify Data Import

### Check Record Counts

Run this query in Supabase SQL Editor:

```sql
-- Check total sets
SELECT COUNT(*) as total_sets FROM pokemon_sets;

-- Check total cards
SELECT COUNT(*) as total_cards FROM pokemon_cards;

-- Check cards per set
SELECT 
  ps.name,
  COUNT(pc.id) as card_count
FROM pokemon_sets ps
LEFT JOIN pokemon_cards pc ON pc.set_id = ps.id
GROUP BY ps.id, ps.name
ORDER BY ps.release_date DESC
LIMIT 10;
```

Expected results:
- Total sets: 100-120
- Total cards: 15,000-25,000
- Cards per set: Varies (50-300 typically)

### Test Search Functionality

```sql
-- Search for Charizard cards
SELECT name, set_id, rarity, image_small 
FROM pokemon_cards 
WHERE name ILIKE '%charizard%'
LIMIT 10;

-- Test full-text search function
SELECT * FROM search_pokemon_cards('pikachu', 10);
```

## Step 4: Update Application Code

Once data is verified, **switch to the new Supabase implementation:**

### 4a. Rename Files

```bash
# Backup original file
mv services/pokemonService.ts services/pokemonService.api.ts.backup

# Activate Supabase version
mv services/pokemonService.supabase.ts services/pokemonService.ts
```

### 4b. Update API Route

```bash
# Backup original route
mv app/api/sets/route.ts app/api/sets/route.api.ts.backup

# Activate Supabase version
mv app/api/sets/route.supabase.ts app/api/sets/route.ts
```

## Step 5: Test Application

```bash
# Start development server
npm run dev
```

### Test Checklist

1. **Homepage** (http://localhost:3000)
   - [ ] Trending cards load correctly
   - [ ] Card images display
   - [ ] Prices show in THB

2. **Explore Page**
   - [ ] Set list loads
   - [ ] Can select a set
   - [ ] Cards from set display correctly
   - [ ] Search bar works

3. **Set Browser**
   - [ ] Sets load with pagination
   - [ ] Set logos display
   - [ ] Can navigate through pages

4. **Card Details**
   - [ ] Card details modal opens
   - [ ] All card information displays correctly
   - [ ] TCGPlayer link works (if available)

5. **Performance**
   - [ ] Page loads faster than before
   - [ ] No errors in browser console
   - [ ] Network tab shows requests to Supabase, not pokemontcg.io

## Troubleshooting

### Migration Script Errors

**"Missing required environment variables"**
- Check `.env.local` has `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

**"Rate limit exceeded"**
- Wait a few minutes and re-run the script
- Consider getting a Pokemon TCG API key from https://dev.pokemontcg.io

**"Network error"**
- Check internet connection
- Script will auto-retry - just wait

### Application Errors

**"pokemon_sets does not exist"**
- Database schema wasn't applied
- Re-run Step 1

**"No cards loading"**
- Check data was imported successfully
- Run queries from Step 3 to verify

**"Prices not showing"**
- Check that `raw_data` column contains price information
- Prices come from the cached API response in raw_data JSONB field

### Performance Issues

If queries are slow:

```sql
-- Rebuild indexes
REINDEX TABLE pokemon_sets;
REINDEX TABLE pokemon_cards;

-- Analyze tables for query planner
ANALYZE pokemon_sets;
ANALYZE pokemon_cards;
```

## Rollback Plan

If you need to revert to the external API:

```bash
# Restore original files
mv services/pokemonService.api.ts.backup services/pokemonService.ts
mv app/api/sets/route.api.ts.backup app/api/sets/route.ts

# Restart dev server
npm run dev
```

## Next Steps

After successful migration:

1. **Keep data updated:** Run migration script monthly for new sets
2. **Monitor performance:** Check Supabase dashboard for query metrics
3. **Optimize further:** Add more indexes if specific queries are slow
4. **Consider caching:** Add Redis or similar for ultra-fast responses

## Support

If you encounter issues:
- Check Supabase logs in the dashboard (Logs section)
- Review browser console for client-side errors
- Check the migration script output for API errors
