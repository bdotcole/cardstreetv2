/**
 * POST /api/admin/partners — pre-provision a partner account.
 *
 * Welcome-package workflow: an admin creates a card shop's account from a shop
 * name + an ASCII username + a temporary password (profile pic optional). No
 * email is needed up front. The account is created with a stable synthetic
 * login email (<username>@partner.cardstreet.app) that is never shown to
 * anyone; the partner signs in the first time with username + temp password
 * (POST /api/auth/partner-login), then a forced flow collects their real
 * email, phone, and a new password (POST /api/partner/complete-onboarding).
 *
 * The referral slug is generated here so the QR/link is printable immediately,
 * before the shop has ever signed in.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/adminAuth';
import { getAppBaseUrl } from '@/lib/stripe';
import { ensurePartnerSlug, isValidUsername, partnerLoginEmail } from '@/lib/referrals';

export async function POST(request: Request) {
    const gate = await requireAdmin();
    if (gate) return gate;

    try {
        const body = await request.json().catch(() => ({}));
        const shopName = typeof body?.shopName === 'string' ? body.shopName.trim() : '';
        const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
        const tempPassword = typeof body?.tempPassword === 'string' ? body.tempPassword : '';
        const avatarUrl = typeof body?.avatarUrl === 'string' && body.avatarUrl.startsWith('http')
            ? body.avatarUrl
            : null;
        const levelRaw = Number(body?.level);
        const level = Number.isInteger(levelRaw) && levelRaw >= 1 && levelRaw <= 9 ? levelRaw : 1;

        if (shopName.length < 2) {
            return NextResponse.json({ error: 'Shop name is required' }, { status: 400 });
        }
        if (!isValidUsername(username)) {
            return NextResponse.json(
                { error: 'Username must be 3-20 characters: lowercase letters, numbers, or underscores' },
                { status: 400 },
            );
        }
        if (tempPassword.length < 6) {
            return NextResponse.json({ error: 'Temporary password must be at least 6 characters' }, { status: 400 });
        }

        const supabase = createAdminClient();

        // Reject a taken username before creating the auth user, so we don't
        // leave an orphaned auth row when the profile username collides.
        const { data: existing } = await supabase
            .from('profiles')
            .select('id')
            .eq('username', username)
            .maybeSingle();
        if (existing) {
            return NextResponse.json({ error: 'That username is already taken' }, { status: 409 });
        }

        const loginEmail = partnerLoginEmail(username);

        const { data: created, error: createErr } = await supabase.auth.admin.createUser({
            email: loginEmail,
            password: tempPassword,
            email_confirm: true,
            user_metadata: { full_name: shopName, username, ...(avatarUrl ? { avatar_url: avatarUrl } : {}) },
        });

        if (createErr) {
            const msg = (createErr.message || '').toLowerCase();
            if (msg.includes('already') || (createErr as { code?: string }).code === 'email_exists') {
                return NextResponse.json({ error: 'That username is already taken' }, { status: 409 });
            }
            console.error('[Admin/Partners] createUser failed:', createErr);
            return NextResponse.json({ error: createErr.message }, { status: 500 });
        }

        const userId = created.user.id;

        // handle_new_user created the profile row in the same transaction, so
        // it's safe to update. We set username explicitly (the trigger may have
        // generated a different one from the synthetic email prefix).
        const { error: profileErr } = await supabase
            .from('profiles')
            .update({
                display_name: shopName,
                username,
                ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
                partner_joined_at: new Date().toISOString(),
                partner_level: level,
                partner_onboarding_complete: false,
                has_placeholder_email: true,
            })
            .eq('id', userId);

        if (profileErr) {
            console.error('[Admin/Partners] profile update failed:', profileErr);
            return NextResponse.json({ error: 'Account created but profile setup failed' }, { status: 500 });
        }

        const slug = await ensurePartnerSlug(supabase, userId, null, shopName);

        return NextResponse.json({
            userId,
            shopName,
            username,
            level,
            slug,
            link: `${getAppBaseUrl()}/join/${slug}`,
        });
    } catch (err: any) {
        console.error('[Admin/Partners] Error:', err);
        return NextResponse.json({ error: err.message || 'Failed to create partner' }, { status: 500 });
    }
}
