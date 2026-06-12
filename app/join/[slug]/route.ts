/**
 * GET /join/[slug] — partner referral landing.
 *
 * This is the URL behind every partner QR code and share link. It:
 *   1. Resolves the slug to a partner (unknown slug → silent redirect home).
 *   2. Logs a 'click' event into partner_downloads (analytics only — clicks
 *      never increment total_downloads).
 *   3. Sets the cs_ref cookie so a later signup on this device attributes to
 *      the partner (POST /api/referrals/attribute).
 *   4. Routes by platform:
 *      - Android browser → Play Store, with the slug in the install-referrer
 *        param (readable by a future native Install Referrer integration).
 *      - Android WebView (the Capacitor app intercepts cardstreet.app links
 *        via App Links, so an installed app opens this URL in-app) → stay in
 *        the app; the cookie lands directly in the WebView session.
 *      - iOS → the web app for now; swap IOS_APP_STORE_URL in once the App
 *        Store listing is live.
 *      - Desktop → the web app.
 *
 * The ?ref=<slug> param on web-app redirects is a belt-and-braces fallback:
 * the shell stores it in localStorage and passes it to the attribute
 * endpoint, covering browsers that drop the cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getAppBaseUrl } from '@/lib/stripe';
import { REF_COOKIE, REF_COOKIE_MAX_AGE_SECONDS, isValidSlugFormat } from '@/lib/referrals';

export const runtime = 'nodejs';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.cardstreet.tcg';
const IOS_APP_STORE_URL: string | null =
    'https://apps.apple.com/us/app/cardstreet-tcg-marketplace/id6776266347';

function destinationFor(userAgent: string, slug: string, baseUrl: string): string {
    const ua = userAgent.toLowerCase();
    const webAppUrl = `${baseUrl}/?ref=${encodeURIComponent(slug)}`;

    if (ua.includes('android')) {
        // '; wv' is the Android System WebView marker: the visitor is already
        // inside the Capacitor app (App Links routed them here), so keep them
        // in the app rather than bouncing to the Play Store.
        if (ua.includes('; wv')) return webAppUrl;
        const referrer = encodeURIComponent(`utm_source=partner&utm_content=${slug}`);
        return `${PLAY_STORE_URL}&referrer=${referrer}`;
    }
    if (/iphone|ipad|ipod/.test(ua)) {
        return IOS_APP_STORE_URL ?? webAppUrl;
    }
    return webAppUrl;
}

function deviceTypeFor(userAgent: string): string {
    const ua = userAgent.toLowerCase();
    if (ua.includes('android')) return ua.includes('; wv') ? 'android-app' : 'android';
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    return 'desktop';
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ slug: string }> }
) {
    const { slug } = await params;
    const baseUrl = getAppBaseUrl();

    if (!isValidSlugFormat(slug)) {
        return NextResponse.redirect(baseUrl);
    }

    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: partner } = await admin
        .from('profiles')
        .select('id')
        .eq('partner_qr_slug', slug)
        .not('partner_joined_at', 'is', null)
        .maybeSingle();

    if (!partner) {
        return NextResponse.redirect(baseUrl);
    }

    const userAgent = request.headers.get('user-agent') || '';

    // Click logging is best-effort: a DB hiccup must never break the redirect
    // a customer just scanned a QR code for.
    try {
        await admin.from('partner_downloads').insert({
            partner_id: partner.id,
            event_type: 'click',
            device_type: deviceTypeFor(userAgent),
            country: request.headers.get('x-vercel-ip-country') || null,
        });
    } catch (err) {
        console.error('[Join] Failed to log referral click:', err);
    }

    const response = NextResponse.redirect(destinationFor(userAgent, slug, baseUrl));
    response.cookies.set(REF_COOKIE, slug, {
        maxAge: REF_COOKIE_MAX_AGE_SECONDS,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
    });
    return response;
}
