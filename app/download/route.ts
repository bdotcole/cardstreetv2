/**
 * GET /download — generic "get the app" landing for the public download QR.
 *
 * Unlike /join/[slug] (partner-attributed), this carries no referral: it's the
 * link behind a generic QR on packaging, posters, etc. Device routing and the
 * store URLs live in lib/appLinks.ts (shared with /join/[slug]):
 *   - Android browser → Play Store (utm_source=download_qr)
 *   - Android WebView (already inside the Capacitor app) → web app
 *   - iOS → App Store
 *   - Desktop / unknown → web app
 *
 * Optional ?c=<campaign> tags the placement (poster1, packaging, ad_jun, …) so
 * you can A/B which placements drive installs: it flows into the Play Store
 * referrer (utm_campaign, visible in Play Console) and the App Store ?ct= token
 * (App Store Connect → App Analytics → Campaigns). No tracking infra needed —
 * the stores attribute it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/lib/stripe';
import { storeDestinationFor, sanitizeCampaign } from '@/lib/appLinks';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
    const baseUrl = getAppBaseUrl();
    const userAgent = request.headers.get('user-agent') || '';
    const campaign = sanitizeCampaign(new URL(request.url).searchParams.get('c'));

    const playReferrer = campaign
        ? `utm_source=download_qr&utm_campaign=${campaign}`
        : 'utm_source=download_qr';
    const webAppUrl = campaign
        ? `${baseUrl}/?utm_source=download_qr&utm_campaign=${campaign}`
        : baseUrl;

    return NextResponse.redirect(
        storeDestinationFor(userAgent, {
            baseUrl,
            playReferrer,
            webAppUrl,
            iosCampaign: campaign || undefined,
        })
    );
}
