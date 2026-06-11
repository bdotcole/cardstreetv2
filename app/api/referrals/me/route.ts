/**
 * GET /api/referrals/me — the logged-in partner's referral link + stats.
 *
 * Generates and persists partner_qr_slug on first call (lazily, so partners
 * promoted after the 20260611 backfill still get one). Non-partners get 403.
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
            .select('id, display_name, role, partner_joined_at, partner_qr_slug, total_downloads')
            .eq('id', user.id)
            .single();

        if (profileErr || !profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }
        // Same partner gate the app shell uses: partner_joined_at is canonical,
        // role === 'partner' covers legacy rows.
        if (!profile.partner_joined_at && profile.role !== 'partner') {
            return NextResponse.json({ error: 'Not a partner account' }, { status: 403 });
        }

        const slug = await ensurePartnerSlug(
            admin, profile.id, profile.partner_qr_slug, profile.display_name
        );

        const countOf = async (eventType: string): Promise<number> => {
            const { count } = await admin
                .from('partner_downloads')
                .select('id', { count: 'exact', head: true })
                .eq('partner_id', profile.id)
                .eq('event_type', eventType);
            return count ?? 0;
        };
        const [clicks, installs, signups] = await Promise.all([
            countOf('click'), countOf('install'), countOf('signup'),
        ]);

        return NextResponse.json({
            slug,
            link: `${getAppBaseUrl()}/join/${slug}`,
            clicks,
            installs,
            signups,
            totalDownloads: profile.total_downloads ?? 0,
        });
    } catch (err: any) {
        console.error('[Referrals/Me] Error:', err);
        return NextResponse.json({ error: err.message || 'Failed to load referral data' }, { status: 500 });
    }
}
