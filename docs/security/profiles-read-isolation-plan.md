# Profiles read-isolation — durable fix (Phase 2)

**Status: DONE — shipped + verified in prod 2026-07-14.** View (`20260714_public_profiles_view.sql`),
app repoint (`lib/publicProfiles.ts` + all cross-user reads), and the base-table lock
(`20260715_profiles_own_row_lock.sql`) are all live. Verified: anon base-table reads 231 -> 0;
`public_profiles` still returns all rows; `/api/listings` + `/api/reviews` 200 with sellers hydrated.
The runbook below is retained as the record of how it was rolled out.

## What's already closed
- Anon (no-login) harvest: closed 2026-07-14 by `20260714_profiles_anon_column_privacy.sql`
  (REVOKE sensitive columns from `anon`). This is the only zero-auth vector.

## What's still open (this fix closes it)
1. **Authenticated harvest.** `profiles` SELECT is `USING (true)` and `authenticated` holds column
   grants, so any signed-up user can `GET /rest/v1/profiles?select=*` and dump all PII. Column grants
   can't be row-scoped (own-row PII is read by the browser in DesktopCartDrawer / DesktopSell /
   UserSettingsContext), so the only fix is a **row-level lock to own-row** + a curated view for
   public display.
2. **`role` / admin-identity leak.** Public seller joins select `role`; replaced here by `is_official`.

## Key fact that makes this tractable
A base-table SELECT policy of `USING (auth.uid() = id)` **does not break own-row reads** — every
`.eq('id', user.id)` read (settings, checkout prefill, sell gate, /api/profile) still returns the
caller's row. Only **cross-user** reads break. Full inventory of cross-user profile reads:

| Site | Read | Fix |
|---|---|---|
| `lib/sellerPageData.ts` (direct `.eq('username', …)`) | seller row, safe cols only | `.from('public_profiles')` |
| `lib/sellerPageData.ts` `LISTING_SELECT` | `seller:profiles(…)` embed | embed `public_profiles`, drop `role`→`is_official` |
| `lib/desktopCardData.ts` | `seller:profiles(…)` embed | same |
| `services/marketplaceService.ts` (~120/257/306/345) | 4× `seller:profiles(…)` embeds | same |
| `app/api/listings/route.ts` | `seller:profiles(…)` embed | same |
| `app/api/reviews/route.ts` | `reviewer:profiles!reviewer_id(…)` embed | embed `public_profiles` |
| `app/api/shipping/calculate/route.ts` | `.in('id', sellerIds)` needs **address** | use **service-role** admin client (view lacks address) |
| `app/api/orders/checkout/route.ts` (~192) | sellers for fees+address, buyer | confirm it already uses admin client; if not, switch |

Mobile (`cardstreet-mobile`) reads profiles only through these `/api` routes, so it needs no change.

### Embedding caveat (must verify on staging)
No existing view in this repo is embedded via PostgREST, so `seller:public_profiles(…)` is **unproven
here**. On staging, apply the view and confirm the embed returns the seller object. If PostgREST can't
resolve the view relationship, fall back to a **two-step fetch** (fetch listings, then
`from('public_profiles').in('id', sellerIds)` and stitch `seller` onto each row) — guaranteed to work,
moderate refactor of the listing-fetch functions.

## Deploy runbook (order matters)
1. **Apply the view** — `20260714_public_profiles_view.sql` (additive, safe, no behavior change).
2. **Deploy the app repoint** (table above). Still behavior-preserving: base table is still `USING(true)`,
   so even a missed cross-user read keeps working. Smoke test seller page + marketplace + a logged-in
   user viewing another seller + checkout shipping quote.
3. **Pre-lock verification** — with a NON-owner authenticated JWT, confirm every seller surface renders
   from the view and nothing null-outs. Run the count check below; it should match the view path.
4. **Apply the base-table lock** (the gated SQL) — the only step that closes the harvest. Do this when
   traffic is calm, not during a spike.
5. **Post-lock smoke** — repeat step 2's checks; verify a stranger CANNOT read another user's
   `phone_number`/`address` (should return no rows), and own-profile settings still load.

### Gated lock SQL — DO NOT APPLY until steps 1–3 are done and verified
```sql
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING ((SELECT auth.uid()) = id);
NOTIFY pgrst, 'reload schema';
```

### Pre-lock verification query (read-only; run before the lock)
```sql
-- Every cross-user seller surface must be reachable via public_profiles.
-- This should return the seller rows the app now reads from the view.
SELECT count(*) AS sellers_visible_via_view FROM public.public_profiles
WHERE id IN (SELECT DISTINCT seller_id FROM public.listings WHERE status = 'active');
```

## Rollback
- Lock: `DROP POLICY "Users can view own profile" ON public.profiles;
  CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);`
- View: `DROP VIEW public.public_profiles;`
