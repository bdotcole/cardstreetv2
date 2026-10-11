/**
 * GET /api/referrals/me — the logged-in user's referral link + stats.
 *
 * Generates and persists partner_qr_slug on first call, for EVERY account, not
 * just partners. The referral machinery — /join/<slug>, the cs_ref cookie, the
 * attribution endpoint, the referral_signup / referral_converted rewards — was
 * already complete and already paid out; the only thing standing between an
 * ordinary collector and inviting a friend was this 403. Growth for a
 * marketplace with a demand problem should not be limited to the handful of
 * accounts with partner_joined_at set.
 *
 * `isPartner` is still reported so the partner portal can keep showing the
 * commercial framing (tier, fee ladder) that only applies to partners.
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getAppBaseUrl } from '@/lib/stripe';
import { ensurePartnerSlug } from '@/lib/referrals';

export async function GET() {
    try {
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: profile, error: profileErr } = await admin
            .from('profiles')
            .select('id, display_name, username, role, partner_joined_at, partner_qr_slug, total_downloads')
            .eq('id', user.id)
            .single();

        if (profileErr || !profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }
        // Same partner test the app shell uses (partner_joined_at is canonical,
        // role === 'partner' covers legacy rows) — reported, no longer a gate.
        const isPartner = !!profile.partner_joined_at || profile.role === 'partner';

        // display_name first, username as the fallback: generatePartnerSlug is
        // ASCII-only (slugs end up in QR codes and Play Store referrer params),
        // and a Thai-only display name reduces to nothing, which would give
        // every Thai collector a slug reading 'partner-<hex>'. Usernames are
        // already constrained to [a-z0-9_], so they always survive.
        const slug = await ensurePartnerSlug(
            admin, profile.id, profile.partner_qr_slug, profile.display_name || profile.username
        );

        const countOf = async (eventType: string): Promise<number> => {
            const { count } = await admin
                .from('partner_downloads')
                .select('id', { count: 'exact', head: true })
                .eq('partner_id', profile.id)
                .eq('event_type', eventType);
            return count ?? 0;
        };
        const [clicks, installs, signups, storeVisits] = await Promise.all([
            countOf('click'), countOf('install'), countOf('signup'), countOf('store_visit'),
        ]);

        return NextResponse.json({
            slug,
            isPartner,
            link: `${getAppBaseUrl()}/join/${slug}`,
            clicks,
            installs,
            signups,
            // iOS App Store visits — counted as downloads, tracked separately so
            // the softer iOS signal can be monitored vs Android's exact installs.
            storeVisits,
            totalDownloads: profile.total_downloads ?? 0,
        });
    } catch (err: any) {
        console.error('[Referrals/Me] Error:', err);
        return NextResponse.json({ error: err.message || 'Failed to load referral data' }, { status: 500 });
    }
}
