# CardStreet TCG

A Thai-market Pokémon TCG marketplace. Buyers and sellers list, trade, and pay
for cards through an Android app + web companion.

## Stack

- **Frontend**: Next.js 15 (App Router) + React 19 + Tailwind 4 + Framer Motion
- **Backend**: Next.js API routes + Supabase (Postgres, Auth, Storage, Realtime)
- **Payments**: Stripe Connect (separate charges and transfers) + PayPal
- **Shipping**: Flash Express (Thai courier) with HMAC-signed in-app label PDFs
- **Notifications**: Courier (Postmark email + Firebase push)
- **Mobile**: Capacitor 8, Android only — WebView loads the live deployment
- **Observability**: Sentry

## Run locally

Prerequisites: Node.js 20+, npm.

1. Copy the example env and fill in real values (ask the maintainer for keys):

   ```
   cp .env.example .env.local
   ```

2. Install and run:

   ```
   npm install
   npm run dev
   ```

3. Useful scripts:

   ```
   npm run lint        # ESLint
   npm run typecheck   # tsc --noEmit
   npm run build       # production build
   ```

## Mobile (Android)

```
npm run build
npx cap sync android
npx cap open android   # opens Android Studio
```

The Capacitor config points the WebView at `https://cardstreet.app`. To run
against a local dev server, edit `capacitor.config.ts` and point `server.url`
at your machine.

## Project layout

```
app/                # Next.js routes (pages + API)
components/         # Client components
lib/                # Shared server + client utilities
  fulfillOrder.ts   # Post-payment fulfillment pipeline
  flashExpress.ts   # Flash Express API client + webhook verifier
  courier.ts        # Notifications (email + push)
  stripe.ts         # Stripe client + Connect helpers
hooks/              # React hooks
supabase/           # Migrations + edge functions
android/            # Native Android shell
```

## Architecture highlights

- **Orders are created before payment.** `/api/orders/checkout` reserves
  listings and creates `pending_payment` orders; `/api/checkout` then charges
  Stripe with a `transfer_group` linking the two. The Stripe webhook flips
  orders to `paid` via a CAS guard so duplicate deliveries can't double-fulfill.
- **Inventory transfers happen after payment confirmation** in
  `lib/fulfillOrder.ts` — see the inventory-transfer block. If payment fails,
  no card movement happens.
- **Label PDFs** are fetched live from Flash on each click and handed to
  Capacitor's Filesystem + Share plugins for on-device save.

## Security notes

- All secrets live in environment variables. `.env*` is gitignored — never
  commit one. See `.env.example` for the full list.
- `SUPABASE_SERVICE_ROLE_KEY` is used only in server-side code; routes that
  use it must perform their own auth check above the call.
- Admin routes under `/api/admin/**` go through `lib/adminAuth.ts`'s
  `requireAdmin()` helper, which checks `profiles.role = 'admin'`.

## Reporting issues

For the moment, file issues in the project's private tracker. Do not share
logs containing FCM tokens, Stripe payment intent ids, or session JWTs.
