/**
 * POST /api/partner/complete-onboarding — finish a provisioned partner's setup.
 *
 * Called by the forced first-login flow (components/PartnerFinishSetup.tsx)
 * after the partner sets their new password client-side. This endpoint swaps
 * the synthetic login email for the partner's real email (via the Admin API
 * with email_confirm, so no confirmation round-trip and notifications now
 * reach a deliverable address), stores their phone, and clears the onboarding
 * gate.
 *
 * Caller must be the authenticated partner whose onboarding is still pending.
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { PARTNER_LOGIN_EMAIL_DOMAIN } from '@/lib/referrals';
import { sendPartnerActivatedNotification } from '@/lib/courier';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
    try {
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';

        if (!EMAIL_PATTERN.test(email) || email.endsWith(`@${PARTNER_LOGIN_EMAIL_DOMAIN}`)) {
            return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
        }
        if (phone.replace(/\D/g, '').length < 9) {
            return NextResponse.json({ error: 'A valid phone number is required' }, { status: 400 });
        }

        const admin = createAdminClient();

        const { data: profile } = await admin
            .from('profiles')
            .select('partner_joined_at, partner_onboarding_complete, display_name, username, partner_level, partner_qr_slug')
            .eq('id', user.id)
            .single();

        if (!profile?.partner_joined_at) {
            return NextResponse.json({ error: 'Not a partner account' }, { status: 403 });
        }
        if (profile.partner_onboarding_complete) {
            return NextResponse.json({ success: true, alreadyComplete: true });
        }

        // Swap the synthetic login email for the real one, pre-confirmed.
        const { error: emailErr } = await admin.auth.admin.updateUserById(user.id, {
            email,
            email_confirm: true,
            user_metadata: { ...user.user_metadata, phone_number: phone },
        });
        if (emailErr) {
            const msg = (emailErr.message || '').toLowerCase();
            if (msg.includes('already') || (emailErr as { code?: string }).code === 'email_exists') {
                return NextResponse.json(
                    { error: 'That email is already used by another account.' },
                    { status: 409 },
                );
            }
            console.error('[Partner/CompleteOnboarding] email update failed:', emailErr);
            return NextResponse.json({ error: 'Could not save your email' }, { status: 500 });
        }

        const { error: profileErr } = await admin
            .from('profiles')
            .update({
                phone_number: phone,
                partner_onboarding_complete: true,
                has_placeholder_email: false,
            })
            .eq('id', user.id);

        if (profileErr) {
            console.error('[Partner/CompleteOnboarding] profile update failed:', profileErr);
            return NextResponse.json({ error: 'Could not finish setup' }, { status: 500 });
        }

        // Fire-and-forget internal alert so the team can see which mailed welcome
        // packages convert. We reach here only on the genuine first activation
        // (the route short-circuits above if onboarding was already complete), so
        // it's a one-shot per partner. Never block or fail activation on a
        // notification error.
        const partnerUsername = profile.username || user.user_metadata?.username || '';
        void sendPartnerActivatedNotification({
            shopName: profile.display_name || user.user_metadata?.full_name || partnerUsername || 'Unknown shop',
            username: partnerUsername,
            email,
            phone,
            level: profile.partner_level,
            slug: profile.partner_qr_slug,
        }).catch((e) => console.error('[Partner/CompleteOnboarding] activation alert failed:', e));

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Partner/CompleteOnboarding] Error:', err);
        return NextResponse.json({ error: err.message || 'Could not finish setup' }, { status: 500 });
    }
}
