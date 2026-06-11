/**
 * POST /api/admin/partners — pre-provision a partner account.
 *
 * Built for the welcome-package workflow: an admin creates the shop's
 * account from just a name + email, the referral slug is generated
 * immediately, and the QR/link can be printed before the shop has ever
 * signed in. The shop activates later via Sign In → "Forgot password?"
 * with the same email (no signup — the account already exists).
 *
 * The auth user is created with email_confirm so the password-reset email
 * can be delivered without a separate verification step. No password is
 * set — the account is unusable until the shop sets one via the reset
 * flow, which doubles as proof they control the email address.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/adminAuth';
import { getAppBaseUrl } from '@/lib/stripe';
import { ensurePartnerSlug } from '@/lib/referrals';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
    const gate = await requireAdmin();
    if (gate) return gate;

    try {
        const body = await request.json().catch(() => ({}));
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        const shopName = typeof body?.shopName === 'string' ? body.shopName.trim() : '';
        const levelRaw = Number(body?.level);
        const level = Number.isInteger(levelRaw) && levelRaw >= 1 && levelRaw <= 9 ? levelRaw : 1;

        if (!EMAIL_PATTERN.test(email)) {
            return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
        }
        if (shopName.length < 2) {
            return NextResponse.json({ error: 'Shop name is required' }, { status: 400 });
        }

        const supabase = createAdminClient();

        const { data: created, error: createErr } = await supabase.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: { full_name: shopName },
        });

        if (createErr) {
            const msg = (createErr.message || '').toLowerCase();
            if (msg.includes('already') || (createErr as { code?: string }).code === 'email_exists') {
                return NextResponse.json(
                    {
                        error:
                            'An account with this email already exists. Promote it to ' +
                            'partner from the Users page instead — it will get its ' +
                            'referral link automatically.',
                    },
                    { status: 409 },
                );
            }
            console.error('[Admin/Partners] createUser failed:', createErr);
            return NextResponse.json({ error: createErr.message }, { status: 500 });
        }

        const userId = created.user.id;

        // The handle_new_user trigger created the profile row in the same
        // transaction as the auth user, so it's safe to update immediately.
        const { error: profileErr } = await supabase
            .from('profiles')
            .update({
                display_name: shopName,
                partner_joined_at: new Date().toISOString(),
                partner_level: level,
            })
            .eq('id', userId);

        if (profileErr) {
            console.error('[Admin/Partners] profile update failed:', profileErr);
            return NextResponse.json({ error: 'Account created but profile setup failed' }, { status: 500 });
        }

        const slug = await ensurePartnerSlug(supabase, userId, null, shopName);

        return NextResponse.json({
            userId,
            slug,
            link: `${getAppBaseUrl()}/join/${slug}`,
            shopName,
            email,
            level,
        });
    } catch (err: any) {
        console.error('[Admin/Partners] Error:', err);
        return NextResponse.json({ error: err.message || 'Failed to create partner' }, { status: 500 });
    }
}
