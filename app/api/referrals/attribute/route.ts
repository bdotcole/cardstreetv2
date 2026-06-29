/**
 * POST /api/referrals/attribute — attribute the logged-in user's signup to a
 * partner referral.
 *
 * The shell calls this once after sign-in (fire-and-forget). The slug comes
 * from the httpOnly cs_ref cookie set by /join/<slug>, with an optional
 * body.slug fallback for the ?ref= localStorage path (covers contexts where
 * the cookie didn't survive, e.g. a different browser opened the verify link).
 *
 * Safe to call repeatedly for any user — attribution only happens when ALL of:
 *   - the user has no referred_by yet (first attribution wins, permanently)
 *   - the account is younger than ATTRIBUTION_WINDOW_DAYS (existing users
 *     clicking partner links are never re-attributed)
 *   - the slug resolves to a real partner who isn't the user themselves
 *
 * On attribution: profiles.referred_by is set, a 'signup' event is logged,
 * and the partner's total_downloads — the tier metric — is incremented.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { REF_COOKIE, ATTRIBUTION_WINDOW_DAYS, isValidSlugFormat } from '@/lib/referrals';

function clearCookie(response: NextResponse): NextResponse {
    response.cookies.set(REF_COOKIE, '', { maxAge: 0, path: '/' });
    return response;
}

export async function POST(request: NextRequest) {
    try {
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const cookieSlug = request.cookies.get(REF_COOKIE)?.value;
        const slug = isValidSlugFormat(cookieSlug)
            ? cookieSlug
            : (isValidSlugFormat(body?.slug) ? body.slug : null);

        if (!slug) {
            return NextResponse.json({ attributed: false, reason: 'no_referral' });
        }

        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: me } = await admin
            .from('profiles')
            .select('id, referred_by, created_at')
            .eq('id', user.id)
            .single();

        if (!me) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }
        if (me.referred_by) {
            return clearCookie(NextResponse.json({ attributed: false, reason: 'already_attributed' }));
        }
        const accountAgeMs = Date.now() - new Date(me.created_at).getTime();
        if (!me.created_at || accountAgeMs > ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
            return clearCookie(NextResponse.json({ attributed: false, reason: 'account_too_old' }));
        }

        const { data: partner } = await admin
            .from('profiles')
            .select('id')
            .eq('partner_qr_slug', slug)
            .not('partner_joined_at', 'is', null)
            .maybeSingle();

        if (!partner || partner.id === user.id) {
            return clearCookie(NextResponse.json({ attributed: false, reason: 'invalid_partner' }));
        }

        // Compare-and-swap on referred_by IS NULL so two concurrent calls
        // can't double-attribute (and double-count) the same signup.
        const { data: updated, error: updateErr } = await admin
            .from('profiles')
            .update({ referred_by: partner.id })
            .eq('id', user.id)
            .is('referred_by', null)
            .select('id');

        if (updateErr) {
            console.error('[Referrals/Attribute] referred_by update failed:', updateErr);
            return NextResponse.json({ error: 'Attribution failed' }, { status: 500 });
        }
        if (!updated || updated.length === 0) {
            return clearCookie(NextResponse.json({ attributed: false, reason: 'already_attributed' }));
        }

        const { error: eventErr } = await admin.from('partner_downloads').insert({
            partner_id: partner.id,
            event_type: 'signup',
            referred_user_id: user.id,
            device_type: null,
            country: request.headers.get('x-vercel-ip-country') || null,
        });
        if (eventErr) console.error('[Referrals/Attribute] signup event insert failed:', eventErr);

        const { error: rpcErr } = await admin.rpc('increment_partner_downloads', {
            p_partner_id: partner.id,
        });
        if (rpcErr) console.error('[Referrals/Attribute] total_downloads bump failed:', rpcErr);

        return clearCookie(NextResponse.json({ attributed: true }));
    } catch (err: any) {
        console.error('[Referrals/Attribute] Error:', err);
        return NextResponse.json({ error: err.message || 'Attribution failed' }, { status: 500 });
    }
}
