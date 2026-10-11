# Live multistream (social simulcast) — how it works and how to run a show

Added 2026-09-16 for the second test break. The goal: put the break in front
of the audiences we already have on Facebook / TikTok / Instagram / YouTube,
and pull them to the website (or app) to buy — the site is where the checkout,
the spot board and the chat live, and it is what the social live-stream ads
will land on.

## The one-sentence model

The LiveKit room-composite egress that already records the VOD is given the
seller's RTMP destinations as extra outputs, and instead of LiveKit's bare
grid it renders **our own template page** (`/live/overlay`) — the two camera
feeds plus a burned-in call to action: `cardstreet.app/watch` + a QR code +
the lot on the block with price and spots left + the pinned message + the
last chat lines.

`cardstreet.app/watch` (`app/watch/route.ts`) always 302s to the public show
that is live right now (else the next scheduled one, else `/live`), tagging
the visit `utm_source=social&utm_medium=overlay` unless the link already
carries its own UTM (ads do).

One egress serves every channel, so five destinations cost the same LiveKit
egress-minutes as recording alone.

## Pieces

| Piece | File |
|---|---|
| Saved destinations (encrypted keys) | `supabase/migrations/20260916_stream_destinations.sql`, `lib/streamKeyCrypto.ts`, `lib/streamDestinations.ts`, `lib/streamDestinationPresets.ts` |
| Destination CRUD | `app/api/live/destinations/route.ts`, `app/api/live/destinations/[id]/route.ts` |
| Go-live wiring | `app/api/live/streams/[id]/go-live/route.ts` -> `lib/livekit.ts startRoomEgress` |
| Mid-show start/stop + status | `app/api/live/streams/[id]/simulcast/route.ts` (console polls it every 15 s while live) |
| Per-output status from LiveKit | `app/api/webhooks/livekit/route.ts` (`egress_updated` / `egress_ended` streamResults) |
| Console UI | `components/live/MultistreamPanel.tsx` (mounted above the Music panel in the console) |
| Overlay template | `app/live/overlay/page.tsx` |
| Short link | `app/watch/route.ts` |
| Funnel analytics | `lib/liveEvents.ts` (GA4 `live_view` / `live_spot_purchase` + Meta `ViewContent` / `Purchase`) |

## Before the show (founder / breaker checklist)

1. **Run the migration** (SQL Editor): `supabase/migrations/20260916_stream_destinations.sql`.
   Until it runs the panel says "migration pending" and go-live records the VOD only.
2. Open the show's console (`/live/broadcast/<id>`) and expand **Multistream**.
3. Add destinations. Keys are encrypted at rest and never shown again (hint only).
   - **Facebook Page**: Live video → Go live → Streaming software → *Persistent stream key* on → paste the key. Server URL is prefilled.
   - **YouTube**: Studio → Go live → Stream → copy the (reusable) stream key. Server URL prefilled.
   - **Instagram**: `instagram.com/live/producer` on a desktop → it issues a stream URL **and** a key for that broadcast → paste both (they change every time).
   - **TikTok**: needs LIVE access on the account (LIVE Studio / the LIVE access page gives Server URL + key). Paste both.
4. Leave **Portrait 9:16** unless the show is aimed at YouTube on TVs; leave **Branded overlay** on.
5. Rehearse on an **unlisted** show first: unlisted go-live sends no notifications, and the panel shows each channel flip Connecting → Live within ~10 s. The social platforms show the branded frame with the QR.
6. On the platforms, **start the broadcast** (Facebook / YouTube usually auto-detect the incoming stream and need a "Go live" click; Instagram Producer and TikTok show a preview first). Put `cardstreet.app/watch` in the post caption / pinned comment too.
7. Go live in the console. The toast lists the channels it is pushing to; the panel shows per-channel status and lets you Stop / Start any of them mid-show.
8. **Show day: unhide the Live section.** Remove `'live_streams'` from `HIDDEN_ENTRY_POINTS` in `lib/betaFeatures.ts` and push to main; the Shop chooser and the desktop "Live" item reappear once Vercel deploys (a few minutes). Until then everything works by link only: `/live/<id>`, `/live`, `/watch`, the console at `/live/broadcast/<id>`, and Profile > Live shows for broadcasters.

## Show audio (music + desktop capture)

The console's **Music** panel feeds a single extra audio track alongside the
mic, mixed from two optional sources:

- **Library** — files in the public `live-music` bucket (the bucket is empty
  until you put something in it). YouTube's own Audio Library
  (studio.youtube.com -> Audio Library) is free, downloadable and licensed for
  broadcast, which makes it the easiest legitimate filler.
- **Desktop audio** — `getDisplayMedia`: share a tab or the whole screen with
  the audio box ticked and whatever your machine is playing goes into the
  stream. **Desktop browser only** (the button hides itself in the app WebView,
  on phones and in Safari), so a phone-run show cannot use it.

Both mix into one published track with independent volume sliders. The capture
branch is deliberately not monitored locally: you already hear that sound, and
routing system audio back to your speakers would feed the next capture buffer
and howl.

> **Copyright.** Facebook and TikTok fingerprint live audio. Commercial music
> (YouTube Music, Spotify, a CD rip) can mute the stream mid-show or cost the
> account its LIVE access. Desktop capture makes it *possible* to broadcast
> anything; it does not make it licensed.

## Limitations to know

- **Social comments are not mirrored into CardStreet chat** (that needs each platform's comment API — not built). Keep the Facebook/TikTok app open on a second phone, or read them out.
- **One canvas for all channels.** Portrait goes to every destination; YouTube on desktop will pillarbox it.
- **Instagram/TikTok keys are per-broadcast** — re-enter them before each show (Edit key).
- **The overlay template must be reachable by LiveKit's cloud egress** (public https). From a local dev server go-live falls back to LiveKit's built-in grid automatically; the template only takes effect on production deploys.
- If **all** RTMP outputs fail LiveKit keeps the egress running for the VOD; a failed channel shows its reason in the panel (Start again after fixing the key).
- `viewer_peak` counts CardStreet viewers only; social viewers are counted by each platform.

## Testing the overlay without an egress

`https://cardstreet.app/live/overlay?stream=<streamId>&layout=portrait` (or a
dev server) renders the data layers over a blank stage — the lot card, CTA
and chat ticker update live from the same Realtime feeds as the viewer page.
Size the browser window to 1080x1920 (portrait) or 1920x1080 to see it at the
recorder's resolution.

## Ads

Point ads at `https://cardstreet.app/watch?utm_source=facebook&utm_medium=paid&utm_campaign=<name>` —
the route keeps those UTMs and lands on the live show. The live page fires
Meta `ViewContent` on load and `Purchase` (THB value) on a paid spot, so a
Facebook campaign can optimize for purchases.
