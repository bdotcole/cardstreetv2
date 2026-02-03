# Quick Start: Run Buylist Migration

## Option 1: Supabase Dashboard (Easiest)

1. Go to your Supabase project: https://supabase.com/dashboard
2. Select your project (`cardstreetv2`)
3. Click **SQL Editor** in the left sidebar
4. Click **New Query**
5. Copy the entire contents of `supabase/migrations/20260203_buylist_requests.sql`
6. Paste into the SQL editor
7. Click **Run** (or press Ctrl+Enter)

✅ Done! The `buylist_requests` table is now created with all RLS policies.

## Option 2: Supabase CLI (If you want to install it)

```bash
# Install Supabase CLI
npm install -g supabase

# Link your project
supabase link --project-ref your-project-ref

# Run migrations
supabase db push
```

## Verify It Worked

1. In Supabase Dashboard, go to **Table Editor**
2. Look for `buylist_requests` table
3. You should see columns: id, user_id, card_id, card_name, condition, max_price, etc.

## Test the API

1. Deploy your code to Vercel (already done)
2. Sign in to your app
3. Find a card with no listings
4. Click "Shop Now"
5. Fill out the buylist form
6. Submit
7. Check Supabase Table Editor - you should see a new row!

## Troubleshooting

**"relation does not exist" error**: The table wasn't created. Re-run the SQL migration.

**"permission denied" error**: RLS policies should be set up automatically, but if you see this, make sure you're signed in when testing.

**"uuid_generate_v4 not found"**: Run this first in SQL Editor:
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```
