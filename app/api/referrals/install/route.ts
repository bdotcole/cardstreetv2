/**
 * POST /api/referrals/install — record a confirmed Android install for a
 * partner referral.
 *
 * The Android shell reads the Play Install Referrer after first launch
 * (lib/installReferrer.ts + android/.../InstallReferrerPlugin.java); when it
 * carries utm_source=partner&utm_content=<slug>, the app posts { slug,
 * installId } here exactly once. This is the Android counterpart of the iOS
 * store_visit proxy in /join/[slug] — unlike iOS, it's a confirmed install,
 * so it uses the 'install' event type reserved for it since
 * 20260611_referral_tracking.sql.
 *
 * Unauthenticated by necessity (the user hasn't signed up yet), so defenses:
 *   - slug must resolve to a real partner
 *   - install_id is unique-indexed — replays with the same id can't double
 *     count, and the client persists its id before the first post
 *   - per-IP rate limit keeps minted-UUID spam from inflating a partner
 *
 * Responses are 200 with { counted: false, reason } for all terminal
 * non-credit outcomes (duplicate, dead slug) so the client stops retrying;
 * only transient failures return non-2xx.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isValidSlugFormat, isValidInstallId } from '@/lib/referrals';
import { checkRateLimit, requestIp } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const slug = body?.slug;
        const installId = body?.installId;
        if (!isValidSlugFormat(slug) || !isValidInstallId(installId)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        // A real device reports one install, ever. 429 (not a terminal 200)
        // so a rate-limited legitimate report retries on a later launch.
        const { allowed } = await checkRateLimit(`referral-install:${requestIp(request)}`, {
            windowSeconds: 3600,
            max: 10,
        });
        if (!allowed) {
            return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
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
            return NextResponse.json({ counted: false, reason: 'invalid_partner' });
        }

        const { error: insertErr } = await admin.from('partner_downloads').insert({
            partner_id: partner.id,
            event_type: 'install',
            device_type: 'android',
            country: request.headers.get('x-vercel-ip-country') || null,
            install_id: installId,
        });

        if (insertErr) {
            // 23505 = unique violation on install_id — already counted.
            if (String(insertErr.code) === '23505') {
                return NextResponse.json({ counted: false, reason: 'duplicate' });
            }
            console.error('[Referrals/Install] event insert failed:', insertErr);
            return NextResponse.json({ error: 'Install log failed' }, { status: 500 });
        }

        const { error: rpcErr } = await admin.rpc('increment_partner_downloads', {
            p_partner_id: partner.id,
        });
        if (rpcErr) console.error('[Referrals/Install] total_downloads bump failed:', rpcErr);

        console.log(`[Referrals/Install] counted Android install for partner ${partner.id} (slug ${slug})`);
        return NextResponse.json({ counted: true });
    } catch (err: any) {
        console.error('[Referrals/Install] Error:', err);
        return NextResponse.json({ error: err.message || 'Install report failed' }, { status: 500 });
    }
}
