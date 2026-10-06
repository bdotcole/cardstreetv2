/**
 * GET /api/admin/social/connect/<meta|youtube|tiktok>/start?brand=<brand>
 *
 * Begins the OAuth dance for one provider on behalf of the signed-in admin.
 * The `state` is HMAC-signed (brand + admin + nonce + expiry) and mirrored in
 * a short-lived cookie; the callback accepts it only when both match.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/adminAuth';
import { isConnectProvider, isProviderConfigured, providerRedirectUri, dashboardPath } from '@/lib/social/config';
import { mintOAuthState, OAUTH_STATE_COOKIE } from '@/lib/social/oauthState';
import { SOCIAL_BRANDS, type SocialBrand } from '@/lib/social/types';
import { metaAuthUrl } from '@/lib/social/meta';
import { googleAuthUrl } from '@/lib/social/youtube';
import { tiktokAuthUrl } from '@/lib/social/tiktok';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
    const gate = await requireAdminUser();
    if (gate instanceof NextResponse) return gate;

    const { provider } = await params;
    if (!isConnectProvider(provider)) {
        return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
    }
    const brandParam = request.nextUrl.searchParams.get('brand') ?? 'cardstreet';
    const brand = (SOCIAL_BRANDS as string[]).includes(brandParam) ? (brandParam as SocialBrand) : 'cardstreet';

    const back = new URL(dashboardPath(), request.nextUrl.origin);
    if (!isProviderConfigured(provider)) {
        back.searchParams.set('error', `${provider} is not configured on the server yet (see docs/social-dashboard.md).`);
        return NextResponse.redirect(back);
    }

    // The platform is the connect target; Meta fills in facebook + instagram rows itself.
    const state = mintOAuthState({ brand, platform: provider === 'meta' ? 'facebook' : provider, adminId: gate.user.id });
    if (!state) {
        back.searchParams.set('error', 'Server has no secret to sign the OAuth state.');
        return NextResponse.redirect(back);
    }

    const redirectUri = providerRedirectUri(provider);
    let target: string;
    try {
        target = provider === 'meta' ? metaAuthUrl(state, redirectUri)
            : provider === 'youtube' ? googleAuthUrl(state, redirectUri)
                : tiktokAuthUrl(state, redirectUri);
    } catch (e) {
        back.searchParams.set('error', e instanceof Error ? e.message : 'Could not start the connection.');
        return NextResponse.redirect(back);
    }

    const res = NextResponse.redirect(target);
    res.cookies.set(OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: process.env.NODE_ENV !== 'development',
        // Lax: the provider sends the browser back with a top-level GET, which Lax cookies ride along on.
        sameSite: 'lax',
        path: '/api/admin/social/connect',
        maxAge: 15 * 60,
    });
    return res;
}
