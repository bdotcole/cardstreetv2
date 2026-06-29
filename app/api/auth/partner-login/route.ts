/**
 * POST /api/auth/partner-login — sign in with a username instead of an email.
 *
 * Partner accounts are provisioned with a username + temp password and a
 * synthetic login email the partner never sees. This resolves the username to
 * the account's current email server-side and signs in via the cookie-bound
 * server client, so the email is never exposed to the browser (no enumeration)
 * and the auth cookies are set on the response exactly like a normal sign-in.
 *
 * Works before AND after the partner sets a real email — it resolves to
 * whichever email is currently on the account — so a partner who types their
 * username out of habit still gets in.
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isValidUsername } from '@/lib/referrals';

const INVALID = NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
        const password = typeof body?.password === 'string' ? body.password : '';

        if (!isValidUsername(username) || password.length < 1) {
            return INVALID;
        }

        const admin = createAdminClient();

        const { data: profile } = await admin
            .from('profiles')
            .select('id')
            .eq('username', username)
            .maybeSingle();
        if (!profile) return INVALID;

        const { data: authUser, error: getErr } = await admin.auth.admin.getUserById(profile.id);
        if (getErr || !authUser?.user?.email) return INVALID;

        // Sign in through the cookie-bound server client so the session cookies
        // land on this response. The email stays server-side.
        const supabase = await createServerClient();
        const { error: signInErr } = await supabase.auth.signInWithPassword({
            email: authUser.user.email,
            password,
        });
        if (signInErr) return INVALID;

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Auth/PartnerLogin] Error:', err);
        return NextResponse.json({ error: 'Sign-in failed' }, { status: 500 });
    }
}
