# Profiles read-isolation — durable fix (Phase 2)

**Status:** designed, NOT yet applied. Ships as one unit: DB migration + app change + verify.
**Depends on:** `20260714_profiles_anon_column_privacy.sql` (the anon stopgap) already applied.

## Problem

`profiles` is world-readable: policy `"Public profiles are viewable by everyone" SELECT USING (true)`.
The stopgap revoked sensitive columns from `anon`, which closes the **no-login** harvest. Two gaps remain:

1. **Authenticated harvest.** `authenticated` still has SELECT on every column of every row, so any
   signed-up user can `GET /rest/v1/profiles?select=*` and dump all users' PII/Stripe. Column grants
   can't be row-scoped, so this can't be fixed by grants alone — the base-table SELECT policy must be
   locked to the owner's own row, and legit public display must move to a whitelist view.
2. **`role` / admin-identity leak.** Public seller/marketplace joins select `role` (to flag the owner
   account), so `anon` can still see which accounts are admins. Closing it requires removing `role`
   from the public projection first.

## The fix

### 1. Whitelist view (safe columns only — new sensitive columns default to hidden)

```sql
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = true) AS
SELECT id, username, display_name, avatar_url, bio,
       partner_tier, partner_qr_slug, partner_joined_at,
       rating, review_count, is_verified_shop, created_at,
       (role = 'admin') AS is_official   -- replaces raw `role` in public joins
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;
```

### 2. Lock the base table to own-row reads

```sql
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING ((SELECT auth.uid()) = id);
```

> After this, `anon`/`authenticated` cannot read *other* users' rows from the base table at all —
> so the leftover column grants on the base table no longer matter. All cross-user display must come
> from `public_profiles`.

### 3. App change — repoint every cross-user profiles read to the view

Embeds change from `seller:profiles(...)` to `seller:public_profiles(...)` and drop `role`
(use `is_official` instead). Own-profile reads (`.eq('id', user.id)`) stay on `profiles`.

Sites (verified 2026-07-14):
- `lib/sellerPageData.ts` — direct seller select + `LISTING_SELECT` embed (drop `role`)
- `lib/desktopCardData.ts` — seller embed
- `services/marketplaceService.ts` — 4 seller embeds (lines ~120/257/306/345)
- `app/api/listings/route.ts` — seller embed
- `app/api/reviews/route.ts` — `reviewer:profiles!reviewer_id(...)` embed
- Consumers of `SellerProfile.role` (marketplace tiles / seller header): switch admin-badge logic
  from `role === 'admin'` to `is_official`.

PostgREST embedding a view requires the relationship to resolve — **verify embeds return the seller
object** (see below) before shipping; if PostgREST can't infer it, add a computed relationship or fall
back to a two-step fetch.

## Verify before deploy (do NOT skip — step 2 breaks all public seller display if the app isn't repointed)

1. Apply the view (step 1) in a branch/staging DB.
2. With the **anon key**, confirm: `public_profiles` returns rows; `GET /profiles?select=phone_number`
   is denied for other rows; seller page + marketplace tiles still render seller name/avatar/badge.
3. Only after the app repoint is deployed, apply step 2 (base-table lock). Ship SQL + code together.
4. Post-deploy smoke: logged-out seller page, marketplace browse, a logged-in user viewing another
   seller, own profile settings still load.
