# Professional Launch Setup (Day 2)

To move CardStreet from a local preview to a live URL on Google/Apple, we need to establish your backend and cloud infrastructure.

## Phase 1: Supabase Professional Backend

1. **Create the Project:**
   - Go to [Supabase Dashboard](https://supabase.com/dashboard)
   - Click **New Project** → Name: `cardstreet-tcg`
   - Select Region: **Singapore** (Best for Thailand market)

2. **Initialize Database Schema:**
   - In your new Supabase project, go to the **SQL Editor** (left sidebar).
   - Create a **New Query**.
   - Copy the entire contents of the file: `supabase/migrations/20260124_initial_schema.sql`
   - Paste it and click **Run**.
   - *This creates all tables, security policies, and Thai market specific schemas.*

3. **Get Your Keys:**
   - Go to **Settings** (gear icon) → **API**.
   - Copy the **Project URL**, **anon public**, and **service_role** secret.
   - Update your `.env.local` file with these values.

---

## Phase 2: Vercel Live Deployment

1. **Download Vercel CLI (Optional but recommended):**
   - Run `npm install -g vercel` in your local terminal.
   - Run `vercel login`.

2. **Connect & Deploy:**
   - In your project root, run `vercel link`.
   - Then run `vercel env add NEXT_PUBLIC_SUPABASE_URL` (and repeat for other keys).
   - Finally, run `vercel deploy --prod`.

3. **Alternative (Easiest):**
   - Push your code to a GitHub repository.
   - Import that repo into [Vercel.com](https://vercel.com).
   - Add the environment variables from your `.env.local` in the Vercel Dashboard settings.

---

## Technical Audit Status
- [x] Next.js 15 App Router Architecture
- [x] Tailwind v4 Modern Engine 
- [x] Supabase SSR Auth Foundation
- [ ] Live PostgreSQL Connection (Pending your action)

**Once you provide the Supabase URL and Anon Key, I can verify the connection via the health-check route!**
