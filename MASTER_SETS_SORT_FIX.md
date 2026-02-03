# Fix Master Sets Sorting - Supabase SQL Query

## Issue
Master sets are not sorting by release date correctly. Sets like "Base Set" and "Jungle" (1999) are appearing first instead of newest sets.

## Root Cause
The `release_date` field in the `pokemon_sets` table likely has:
- NULL values for many sets
- Incorrect date formats
- Missing or incomplete data

## Solution

### Step 1: Check Current Data

Run this query in Supabase SQL Editor to see what the data looks like:

```sql
-- Check current release dates for English sets
SELECT 
  name, 
  release_date,
  TO_CHAR(release_date, 'YYYY-MM-DD') as formatted_date,
  CASE 
    WHEN release_date IS NULL THEN 'NULL'
    ELSE 'HAS DATE'
  END as status
FROM pokemon_sets 
WHERE language = 'en'
ORDER BY release_date DESC NULLS LAST
LIMIT 20;
```

### Step 2: Count NULL vs Valid Dates

```sql
-- Count how many sets have NULL vs valid dates
SELECT 
  language,
  COUNT(*) as total_sets,
  COUNT(release_date) as sets_with_dates,
  COUNT(*) - COUNT(release_date) as sets_without_dates
FROM pokemon_sets
GROUP BY language;
```

### Step 3: Fix the Query in pokemonService.ts

The API query needs to handle NULL dates properly:

**Current query (line 60 in pokemonService.ts):**
```typescript
.order('release_date', { ascending: false })
```

**Should be:**
```typescript
.order('release_date', { ascending: false, nullsFirst: false })
```

This ensures NULL dates appear at the end, not the beginning.

### Step 4: If Many Dates Are NULL

If most sets have NULL release dates, you'll need to populate them. Here's how:

**Option A: Use raw_data field**
If the `raw_data` JSONB column contains release date info:

```sql
-- Check if raw_data has release dates
SELECT 
  name,
  release_date,
  raw_data->>'releaseDate' as raw_date,
  raw_data->'set'->>'releaseDate' as set_date
FROM pokemon_sets 
WHERE language = 'en'
AND release_date IS NULL
LIMIT 10;
```

If dates exist in `raw_data`, update from there:

```sql
-- Update NULL release_date from raw_data
UPDATE pokemon_sets
SET release_date = (raw_data->'set'->>'releaseDate')::date
WHERE release_date IS NULL 
AND raw_data->'set'->>'releaseDate' IS NOT NULL;
```

**Option B: Manual data entry**
If dates aren't in raw_data, you may need to import them from an external source.

### Step 5: Verify the Fix

```sql
-- Verify newest sets appear first
SELECT 
  name, 
  release_date,
  series
FROM pokemon_sets 
WHERE language = 'en'
ORDER BY release_date DESC NULLS LAST
LIMIT 10;
```

You should see recent sets like:
- Surging Sparks (2024-11-08)
- Stellar Crown (2024-09-13)
- Shrouded Fable (2024-08-02)

NOT old sets like Base Set (1999).

---

## Quick Fix (If You Need It Now)

If you just need it working ASAP, I can modify the frontend to fetch ALL sets at once and do the sorting purely client-side. But fixing the database is the better long-term solution.

Let me know what you find when you run these queries!
