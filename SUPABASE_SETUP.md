# Supabase Setup Guide

## Step 1: Create Supabase Project

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Click "New Project"
3. Fill in:
   - **Name:** cardstreet-tcg
   - **Database Password:** (Generate a strong password, save it securely)
   - **Region:** Singapore (closest to Thailand)
   - **Plan:** Free tier (upgrade later if needed)
4. Click "Create new project"
5. Wait 2-3 minutes for project provisioning

## Step 2: Get Your API Keys

1. In your Supabase project dashboard, go to **Settings** → **API**
2. Copy the following values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon public** key
   - **service_role** key (keep this secret!)

3. Update your `.env.local` file in the project root:

```env
NEXT_PUBLIC_GEMINI_API_KEY=your_existing_gemini_key
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_public_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

## Step 3: Run Database Migration

1. In your Supabase dashboard, go to **SQL Editor**
2. Click "New Query"
3. Copy the contents of `supabase/migrations/20260124_initial_schema.sql`
4. Paste into the SQL editor
5. Click "Run" or press `Ctrl+Enter`

You should see a success message. This creates:
- ✅ All database tables (profiles, collections, listings, transactions, wishlists)
- ✅ Row Level Security policies
- ✅ Automatic profile/collection creation on signup
- ✅ Indexes for query performance

## Step 4: Configure Authentication Providers

### LINE Login (Priority for Thai Market)

1. Create a LINE Developer account:
   - Go to [https://developers.line.biz/console/](https://developers.line.biz/console/)
   - Click "Create a new provider"
   - Name: "CardStreet TCG"

2. Create a LINE Login channel:
   - Click "Create a Messaging API channel"
   - Fill in app details
   - **Callback URL:** `https://[YOUR_PROJECT_REF].supabase.co/auth/v1/callback`
   - Save your **Channel ID** and **Channel Secret**

3. In Supabase dashboard, go to **Authentication** → **Providers** → **LINE**:
   - Enable LINE provider
   - Enter Channel ID
   - Enter Channel Secret
   - Save

### Google OAuth

1. In Supabase dashboard, go to **Authentication** → **Providers** → **Google**
2. Click "Enable"
3. **Authorized redirect URIs:** automatically configured by Supabase
4. Save

### Apple Sign In (Optional for Day 1, but needed for App Store)

1. Go to [Apple Developer Console](https://developer.apple.com/)
2. Create a Services ID for Sign in with Apple
3. Configure in Supabase: **Authentication** → **Providers** → **Apple**

## Step 5: Verify Setup

1. Start your Next.js dev server:
   ```bash
   npm run dev
   ```

2. Open [http://localhost:3000](http://localhost:3000)

3. Check browser console for errors

## Step 6: Test Database Connection

You can test the database connection by going to your Supabase dashboard:
- **Table Editor** → Click on "profiles", "collections", etc. to view tables
- They should be empty (no data yet)

## Next Steps

Once your Supabase project is configured:
- [ ] Test LINE login flow (Day 3-4)
- [ ] Migrate localStorage data to Supabase (backend migration script)
- [ ] Deploy to Vercel for staging environment

## Troubleshooting

**Issue:** "Cannot find module '@supabase/supabase-js'"
- **Fix:** Run `npm install` again

**Issue:** Environment variables not loading
- **Fix:** Restart the Next.js dev server (`npm run dev`)

**Issue:** Database migration fails
- **Fix:** Make sure you're connected to the correct database
- Check SQL Editor for specific error messages

**Issue:** LINE login shows "Invalid redirect URI"
- **Fix:** Make sure callback URL in LINE Console matches Supabase exactly
- Format: `https://[PROJECT_REF].supabase.co/auth/v1/callback`
