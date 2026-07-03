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
 *        param; after install the app reads it back and posts to
 *        /api/referrals/install for confirmed download credit.
 *      - Android WebView (the Capacitor app intercepts cardstreet.app links
 *        via App Links, so an installed app opens this URL in-app) → stay in
 *        the app; the cookie lands directly in the WebView session.
 *      - iOS → App Store.
 *      - Desktop → the web app.
 *   Store URLs + the device branching live in lib/appLinks.ts (shared with
 *   /download).
 *
 * The ?ref=<slug> param on web-app redirects is a belt-and-braces fallback:
 * the shell stores it in localStorage and passes it to the attribute
 * endpoint, covering browsers that drop the cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getAppBaseUrl } from '@/lib/stripe';
import { REF_COOKIE, REF_COOKIE_MAX_AGE_SECONDS, isValidSlugFormat } from '@/lib/referrals';
import { storeDestinationFor, deviceTypeFromUA } from '@/lib/appLinks';

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
    const deviceType = deviceTypeFromUA(userAgent);
    const country = request.headers.get('x-vercel-ip-country') || null;

    // Click logging is best-effort: a DB hiccup must never break the redirect
    // a customer just scanned a QR code for.
    try {
        await admin.from('partner_downloads').insert({
            partner_id: partner.id,
            event_type: 'click',
            device_type: deviceType,
            country,
        });
    } catch (err) {
        console.error('[Join] Failed to log referral click:', err);
    }

    // iOS "App Store visit" — our best download proxy for iPhone, since Apple
    // exposes no install referrer to confirm the actual install. We count the
    // scan-that-we-sent-to-the-App-Store once per device (deduped by a cookie)
    // and bump total_downloads. Android is NOT counted here: its exact install
    // is confirmed later via the Play Install Referrer (/api/referrals/install),
    // so counting a store visit too would double-count.
    const dedupeCookie = `cs_dl_${slug}`;
    const alreadyCounted = request.cookies.get(dedupeCookie)?.value === '1';
    if (deviceType === 'ios' && !alreadyCounted) {
        try {
            await admin.from('partner_downloads').insert({
                partner_id: partner.id,
                event_type: 'store_visit',
                device_type: 'ios',
                country,
            });
            await admin.rpc('increment_partner_downloads', { p_partner_id: partner.id });
        } catch (err) {
            console.error('[Join] Failed to log store_visit:', err);
        }
    }

    const response = NextResponse.redirect(
        storeDestinationFor(userAgent, {
            baseUrl,
            playReferrer: `utm_source=partner&utm_content=${slug}`,
            webAppUrl: `${baseUrl}/?ref=${encodeURIComponent(slug)}`,
        })
    );
    response.cookies.set(REF_COOKIE, slug, {
        maxAge: REF_COOKIE_MAX_AGE_SECONDS,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
    });
    // Mark this device as counted for this partner so repeat iPhone scans don't
    // re-inflate the store-visit total. Long-lived; best-effort dedupe.
    if (deviceType === 'ios') {
        response.cookies.set(dedupeCookie, '1', {
            maxAge: 180 * 24 * 60 * 60,
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
        });
    }
    return response;
}
