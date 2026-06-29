/**
 * Single source of truth for app-store links and device-based routing.
 *
 * Used by every QR/redirect that sends a visitor to "get the app":
 *   - /download         — generic public download QR (no attribution)
 *   - /join/[slug]      — partner-attributed referral QR
 *
 * Keeping the store URLs and the iOS/Android/desktop branching here means a
 * link change (new store URL, a new platform) happens in one place instead of
 * drifting across routes.
 */

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.cardstreet.tcg';
export const IOS_APP_STORE_URL = 'https://apps.apple.com/us/app/cardstreet-tcg-marketplace/id6776266347';

export type DeviceType = 'android' | 'android-app' | 'ios' | 'desktop';

/**
 * Normalize a campaign tag (e.g. ?c=poster1) to a safe slug for use in store
 * attribution params. Returns '' if nothing usable remains.
 */
export function sanitizeCampaign(raw: string | null | undefined): string {
    return (raw || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 40);
}

export function deviceTypeFromUA(userAgent: string): DeviceType {
    const ua = userAgent.toLowerCase();
    if (ua.includes('android')) {
        // '; wv' marks the Android System WebView — the visitor is already inside
        // the Capacitor app (App Links routed them here).
        return ua.includes('; wv') ? 'android-app' : 'android';
    }
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    return 'desktop';
}

interface StoreDestinationOpts {
    /** Canonical app base URL (cardstreet.app). */
    baseUrl: string;
    /** Appended to the Play Store URL as &referrer= for install attribution. */
    playReferrer?: string;
    /** Where non-store devices land (in-app WebView, desktop). Defaults to baseUrl. */
    webAppUrl?: string;
    /**
     * Campaign token appended to the App Store URL as ?ct=, surfacing the
     * install under App Store Connect → App Analytics → Campaigns. Unknown
     * tokens are harmless (the link still opens the listing).
     */
    iosCampaign?: string;
}

/**
 * The URL a visitor should be redirected to, by device:
 *   - Android browser → Play Store (+ optional install referrer)
 *   - Android in-app WebView → webAppUrl (stay in the app)
 *   - iOS → App Store (+ optional ?ct= campaign token)
 *   - Desktop / unknown → webAppUrl
 */
export function storeDestinationFor(userAgent: string, opts: StoreDestinationOpts): string {
    const { baseUrl, playReferrer, webAppUrl = baseUrl, iosCampaign } = opts;
    switch (deviceTypeFromUA(userAgent)) {
        case 'android':
            return playReferrer
                ? `${PLAY_STORE_URL}&referrer=${encodeURIComponent(playReferrer)}`
                : PLAY_STORE_URL;
        case 'android-app':
            return webAppUrl;
        case 'ios':
            return iosCampaign
                ? `${IOS_APP_STORE_URL}?ct=${encodeURIComponent(iosCampaign)}`
                : IOS_APP_STORE_URL;
        default:
            return webAppUrl;
    }
}
