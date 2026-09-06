/**
 * Web paths the native shell must open at their real URL instead of dropping.
 *
 * Android App Links are registered against the cardstreet.app HOST with no path
 * restriction (android/app/src/main/AndroidManifest.xml), so every
 * cardstreet.app link tapped on a device with the app installed opens the app
 * rather than a browser. Capacitor does NOT navigate the WebView to the tapped
 * path — it only fires `appUrlOpen` — so any path without an explicit branch in
 * that handler is silently discarded and the user lands on the SPA home.
 *
 * That is what happened to /become-a-breaker (reported 2026-08-15): the breaker
 * recruitment link was unreachable for anyone who already had the app — which
 * is precisely the audience it gets shared with.
 *
 * An allowlist, not a catch-all: navigating the WebView to an arbitrary path
 * would strand the user outside the SPA shell whenever that path isn't a real
 * standalone page. Everything here is server-reachable and renders on its own,
 * with the Android back button returning to the shell.
 *
 * Pure module (no next/* or @capacitor/* imports) so the client shell can
 * import it freely.
 */

/**
 * Exact-match pages: public content and policy first, then the standalone
 * feature routes that double as share / QR targets.
 *
 * Adding a page here does not make it routable — check middleware.ts's
 * `config.matcher` too if the page needs locale handling. That matcher must be
 * a static literal (Next.js analyses it at build time), so it cannot import
 * this list; the two are kept in sync by hand.
 */
const EXACT_PATHS = new Set([
    // Breaker program — the funnel this list was added for.
    '/become-a-breaker',
    '/breaker-terms',

    // Help, contact and policy.
    '/faq',
    '/help',
    '/contact',
    '/terms',
    '/privacy',

    // Long-form SEO content.
    '/prices',
    '/graded',
    '/sell-cards',

    // Game landing pages (copy in lib/gameLanding.ts, rendered from
    // /desktop/games/* — see GAME_LANDING_PATHS in middleware.ts).
    '/pokemon',
    '/one-piece',
    '/yugioh',
    '/mtg',
    '/lorcana',
    '/riftbound',

    // Standalone feature routes. /trade is the target a trade QR encodes, so a
    // scan has to reach it for the same reason the table-cam /live/ link does.
    // /pay/<offerId> is prefix-matched below, not here.
    '/premium',
    '/grade',
    '/trade',
    '/insights',

    // Play Store requires a reachable account-deletion page.
    '/delete',
])

/**
 * Prefix-matched trees.
 *
 * /card/ is listed for the hand-off, not for the page itself: middleware turns
 * a native-UA request for /card/<id> into /?card=<id>, which the shell's own
 * deep-link effect opens as a card detail view. Without the navigation this
 * enables, that redirect never runs and a shared card link just lands on home.
 *
 * /sets/ and /seller/ are deliberately absent — middleware collapses both to
 * bare '/' for the native app, so navigating would spend a round trip to land
 * exactly where doing nothing already leaves the user.
 */
/**
 * /pay/ is the accepted-offer pay link, shared over LINE. Tapping it on a phone
 * with the app installed fires appUrlOpen and nothing else, so without this
 * entry the link a seller sent to chase payment silently lands the buyer on the
 * SPA home — the exact failure /become-a-breaker had.
 */
const PREFIX_PATHS = ['/card/', '/pay/']

/**
 * Strip a locale prefix so /en/faq matches the same entry as /faq. The lookahead
 * keeps it from eating real paths that merely start with those letters
 * ("/enroll" is not "/en" + "roll").
 */
function stripLocale(pathname: string): string {
    return pathname.replace(/^\/(en|th)(?=\/|$)/, '') || '/'
}

/** True when the native shell should navigate its WebView to this path. */
export function isNativeWebPath(pathname: string): boolean {
    // Normalize the trailing slash before stripping the locale, so '/en/faq/'
    // and '/faq' resolve to the same entry.
    const path = stripLocale(pathname.replace(/\/+$/, '') || '/')
    return EXACT_PATHS.has(path) || PREFIX_PATHS.some((prefix) => path.startsWith(prefix))
}
