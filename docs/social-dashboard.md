# Social dashboard (Admin -> Social) — setup and how it works

Added 2026-10-05 so Arisa can see reach, followers, views and link clicks for
the Cardstreet channels and the Chopper & Kuma pet channel in one place,
without paying for a social-analytics vendor. Everything comes straight from
the platforms' own free APIs and is stored in our Supabase, so history is
ours for good (Metricool's free tier keeps 30 days for one brand).

## The one-sentence model

A daily cron (`/api/cron/social-metrics`, 08:30 Bangkok) pulls yesterday's
numbers for every connected account into `social_metrics_daily`, and the
admin page at `/admin/social` charts them per brand.

## Pieces

| Piece | File |
|---|---|
| Tables (accounts w/ encrypted tokens, daily metrics, posts, site traffic) | `supabase/migrations/20261005_social_metrics.sql` |
| Providers | `lib/social/meta.ts` (Facebook Page + Instagram), `lib/social/youtube.ts`, `lib/social/tiktok.ts`, `lib/social/ga4.ts` (visits to cardstreet.app from each platform) |
| Orchestrator (decrypts tokens, merges rows) | `lib/social/sync.ts` |
| Token encryption / signed OAuth state | `lib/social/tokenCrypto.ts`, `lib/social/oauthState.ts` |
| Connect flows | `app/api/admin/social/connect/[provider]/{start,callback}/route.ts` |
| Dashboard data + account management + manual sync | `app/api/admin/social/{metrics,accounts,accounts/[id],sync}/route.ts` |
| Daily cron | `app/api/cron/social-metrics/route.ts` (+ `vercel.json`) |
| UI | `app/admin/social/page.tsx` |

## What each platform can tell us (free API)

| | Followers | Reach | Views | Profile views | Link clicks | Per-post |
|---|---|---|---|---|---|---|
| Facebook Page | yes (`page_follows`, daily follows/unfollows) | `page_impressions_unique` while Graph v24 serves it (deprecated from v25) | `page_media_view` | `page_views_total` | `page_total_actions` (CTA + contact clicks) | reactions, comments, shares, views |
| Instagram (professional) | yes | yes | yes | yes (if Meta still serves `profile_views`) | `profile_links_taps` (+ `website_clicks` if served) | reach, views, likes, comments, saves, shares |
| YouTube | subscribers (+ gained/lost per day) | no | yes (+ watch minutes) | no | no | views, likes, comments |
| TikTok | yes | **no** | derived: change in total video views between daily snapshots | **no** | **no** | views, likes, comments, shares |
| GA4 (Cardstreet only) | — | — | — | — | **sessions on cardstreet.app by referring platform** — the click number that matters | — |

Anything a platform cannot report shows **n/a**, never a zero. Instagram only
serves ~90 days of history; the first backfill grabs what exists.

A metric Meta retires does not break the sync: each insights call drops the
refused metric, logs it in the account's "note" (shown under Connections),
and keeps the rest. The Graph version is pinned (`GRAPH_VERSION` in
`lib/social/meta.ts`); bump it deliberately.

## One-time setup (founder)

### 0. Database

Run `supabase/migrations/20261005_social_metrics.sql` in the Supabase SQL
Editor. Until it runs the page says so and the cron returns 200 with an error
message (it never pages anyone over a missing table).

### 1. Server env vars (Vercel -> Settings -> Environment Variables, Production)

```
META_APP_ID=
META_APP_SECRET=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=

# Optional — visits to cardstreet.app from each platform (same service account as scripts/ga4-report.mjs)
GA4_PROPERTY_ID=529792127
GA4_SA_KEY_JSON=<the whole ga4-reader-key.json on one line>

# Optional — dedicated token-encryption secret (falls back to SUPABASE_SERVICE_ROLE_KEY)
SOCIAL_TOKEN_SECRET=
```

A provider whose two keys are missing simply shows "Not configured" on its
Connect button; the others work.

### 2. Meta app (Facebook + Instagram)

> Done 2026-10-06 on the existing **Cardstreet** app (App ID `901554606295641`,
> Live, business portfolio Cardstreet): use cases *Manage everything on your
> Page* + *Manage messaging & content on Instagram* added; business_management,
> pages_show_list, pages_read_engagement, read_insights, instagram_basic,
> instagram_manage_insights all "Ready for testing"; the redirect URI is saved
> under Facebook Login for Business -> Settings. Only remaining step: copy the
> App secret (App settings -> Basic) into Vercel. Brandon is the only app admin
> — add Arisa under App roles if she will be the one clicking Connect.

1. developers.facebook.com -> **Create app** -> type **Business** (or reuse an
   existing Cardstreet app). You must be admin of the app.
2. Add the product **Facebook Login for Business** -> Settings -> **Valid
   OAuth Redirect URIs**: `https://cardstreet.app/api/admin/social/connect/meta/callback`
3. Leave the app in **Development mode**. Our own Pages work in development
   as long as the person who clicks Connect is an admin/developer/tester of
   the app (App roles) — no App Review, no Business Verification needed for
   reading our own insights.
4. Permissions requested: `pages_show_list`, `pages_read_engagement`,
   `pages_read_user_content` (comment/reaction counts on posts), `read_insights`,
   `instagram_basic`, `instagram_manage_insights`, `business_management`.
   Facebook Page *reach* is no longer served by the Graph API at all (Meta's
   November 2025 cull); the dashboard shows it as n/a for Facebook.
5. Each Instagram account must be a **Professional** account linked to its
   Facebook Page (Instagram app -> Settings -> Account -> Linked accounts).
   Both the Cardstreet and the Chopper & Kuma Pages/IG accounts can be
   connected in ONE click if one Facebook login admins both — tick all Pages
   in Meta's permission dialog; they land under the brand you were viewing,
   and the Brand dropdown under Connections moves a Page (with its Instagram)
   to the other brand.

### 3. Google (YouTube)

> Done 2026-10-06 in project `clever-case-464300-s6` (number 385207592781):
> both YouTube APIs enabled, consent screen branded (home/privacy/terms,
> authorized domains `cardstreet.app` **and** the Supabase auth domain — the
> latter was there before for Google sign-in and must stay), the two scopes
> added, publishing status **In production**, and the web client
> **Cardstreet Social (YouTube)** created (client id
> `385207592781-06fu8ujlh4984n5ga0not4emmvom99kg.apps.googleusercontent.com`).
> Google shows the client secret once, in the creation dialog — if it was
> lost, create a new client the same way; the old one can be deleted.

1. console.cloud.google.com -> the project that already holds the GA4 service
   account (385207592781) -> **APIs & Services -> Enable**: *YouTube Data API
   v3* and *YouTube Analytics API*.
2. **OAuth consent screen**: User type **External**, fill name/support email,
   add the scopes `.../auth/youtube.readonly` and
   `.../auth/yt-analytics.readonly`, then **Publish app** (status "In
   production"). Do NOT leave it in "Testing": Google expires refresh tokens
   after 7 days in Testing and the channel would need reconnecting weekly.
   Publishing without verification is fine for our own use — the consent
   page shows "Google hasn't verified this app"; click *Advanced -> Go to
   Cardstreet (unsafe)*.
3. **Credentials -> Create OAuth client ID -> Web application** ->
   Authorised redirect URI `https://cardstreet.app/api/admin/social/connect/youtube/callback`.
   Copy client id + secret into the env vars.
4. When connecting, Google's account chooser must be answered with the
   account **that owns the channel** (for a Brand Account channel, pick the
   Brand Account row). Connect once per channel (Cardstreet, Chopper & Kuma).

### 4. TikTok

> **Parked (founder, 2026-10-06).** The dashboard hides the TikTok card until
> `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` are set or an account exists;
> the provider code stays in place. Steps for when it's time:

1. developers.tiktok.com -> **Manage apps -> Connect an app**. Fill the basics
   (website `https://cardstreet.app`, Terms `https://cardstreet.app/terms`,
   Privacy `https://cardstreet.app/privacy`).
2. Add products **Login Kit** and **Display API**; scopes `user.info.basic`,
   `user.info.profile`, `user.info.stats`, `video.list`.
3. Login Kit -> **Redirect URI**: `https://cardstreet.app/api/admin/social/connect/tiktok/callback`
4. Start in the app's **Sandbox**: add both TikTok accounts (@cardstreet_ and
   the pet channel) as **target users**, and use the sandbox client key /
   secret in the env vars. Sandbox lets the target users authorise without
   App Review. If TikTok refuses the connect from the sandbox, submit the app
   for review (needs the URLs above plus a short screen recording of the
   Connect flow) and switch to the production keys once approved.
5. TikTok access tokens live 24h and refresh tokens 365 days; the sync
   refreshes and stores the rotated refresh token every run.

### 5. Connect and backfill

`/admin/social` -> pick the brand tab -> **Connect** for each provider. The
callback lands back on the page and the browser immediately asks the server
to pull the last 90 days. After that the cron keeps it current; **Sync now**
re-pulls the visible range on demand.

## How the sync behaves

- Window: every run re-pulls the last 3 days (Meta and YouTube restate a day
  for ~48h). Null never overwrites a stored number.
- Snapshots: follower totals and TikTok's figures are snapshots taken at run
  time and filed under *yesterday*, the completed day they approximate.
- One dead token marks only that account (`last_sync_error`, shown under
  Connections); the others still sync. Reconnecting the provider refreshes
  tokens without moving the account's brand.
- Tokens: Facebook Page tokens do not expire while the admin keeps their
  Page role; Google refresh tokens persist (if the consent screen is
  published); TikTok rotates refresh tokens — stored each run.
- Everything is service-role only (RLS on, no policies); the browser never
  receives a token, only `has_token`.

## Link clicks and the tracked short links (added 2026-10-07)

"Link clicks" means two different things, by brand, because only one brand
owns a website:

- **Cardstreet**: GA4 sessions on cardstreet.app credited to a platform —
  i.e. clicks on the tracked short links below. Meta's own "profile taps"
  (profile-link / Page-button taps) are shown separately.
- **Chopper & Kuma**: the pet channel is unrelated to the site and never
  links to it, so its link clicks are Meta's profile-link / Page-button taps
  (Facebook + Instagram); YouTube has no equivalent. No short links, no GA4.
  (A first cut gave the pet channel `cardstreet.app/ck/...` links — removed
  2026-10-07 at the founder's objection; don't bring them back.)

The Cardstreet short links (`lib/social/shortLinks.ts` data,
`lib/socialLinks.ts` + `app/{ig,fb,yt,tt}/route.ts` redirects) tag every
visit with `utm_source` (platform) and `utm_medium` (where the link sat).
GA4 ranks `utm_source` above the referrer, so a tap from Instagram's in-app
browser is still credited.

| Paste where | Link |
|---|---|
| Instagram bio | `cardstreet.app/ig` |
| Facebook Page button / About | `cardstreet.app/fb` |
| YouTube channel link + descriptions | `cardstreet.app/yt` |
| TikTok bio | `cardstreet.app/tt` |

Add `?utm_medium=story` (post, ad, ...) to any of them for a one-off placement.
Untagged referrals (someone shares a plain cardstreet.app link on Facebook)
still count, under medium "referral".

**Get-the-app popup** (`components/GetAppPrompt.tsx`, mounted in the mobile
shell): a phone visitor arriving with a social `utm_source` is offered the
app after the page paints — App Store on iPhone/iPad, Play Store on Android,
chosen from the user agent in the browser. Never shown inside the Capacitor
shell or on desktop; "Continue on the web" or a store tap snoozes it for 7
days on that device. The store links carry the source as an install tag
(Play install referrer `utm_source=<platform>&utm_medium=<placement>`,
App Store `?ct=<platform>_<placement>`), and GA4 gets a `get_app_prompt`
event with `action` shown / store / dismiss. Founder's call (2026-10-07): the
links themselves stay web-first so every tap is tracked; the popup carries
the install push.

`social_site_traffic_daily` is keyed by `(day, platform, campaign, medium)`
since migration `20261007_social_link_clicks.sql`; the sync and the metrics
route fall back to the old `(day, platform)` shape until it runs.

## Known limits

- TikTok reach / profile views / link clicks: not in the Display API. The
  derived "views" is the day-over-day change in total views across the 20
  most recent videos. TikTok Studio stays the source for reach.
- Instagram "link clicks" = taps on the profile link + CTA buttons; a link in
  a Story or bio tool is counted by GA4 on our side, not by Instagram.
- GA4 covers cardstreet.app only — the pet channel has no site, so its tab
  shows Engagements in that tile's place.
- Admin-only: Arisa needs `profiles.role = 'admin'` to open `/admin/social`.
