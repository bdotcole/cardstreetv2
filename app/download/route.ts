/**
 * GET /download — generic "get the app" landing for the public download QR.
 *
 * Unlike /join/[slug] (partner-attributed), this carries no referral: it's the
 * link behind a generic QR on packaging, posters, etc. It only routes by
 * platform:
 *   - Android browser → Play Store
 *   - Android WebView (already inside the Capacitor app via App Links) → web app
 *   - iOS → App Store
 *   - Desktop / unknown → web app
 *
 * Keep the store URLs here in sync with app/join/[slug]/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/lib/stripe';

export const runtime = 'nodejs';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.cardstreet.tcg';
const IOS_APP_STORE_URL =
    'https://apps.apple.com/us/app/cardstreet-tcg-marketplace/id6776266347';

function destinationFor(userAgent: string, baseUrl: string): string {
    const ua = userAgent.toLowerCase();

    if (ua.includes('android')) {
        // '; wv' marks the Android System WebView: the visitor is already inside
        // the Capacitor app (App Links routed them here), so keep them in-app.
        if (ua.includes('; wv')) return baseUrl;
        return `${PLAY_STORE_URL}&referrer=${encodeURIComponent('utm_source=download_qr')}`;
    }
    if (/iphone|ipad|ipod/.test(ua)) {
        return IOS_APP_STORE_URL;
    }
    return baseUrl;
}

export async function GET(request: NextRequest) {
    const baseUrl = getAppBaseUrl();
    const userAgent = request.headers.get('user-agent') || '';
    return NextResponse.redirect(destinationFor(userAgent, baseUrl));
}
