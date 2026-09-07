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
 *
 * RATE LIMITED ON TWO KEYS, because either one alone leaves a hole: per-IP
 * only lets a distributed attempt spray one username from many addresses,
 * per-username only lets a single address spray many usernames. Both are
 * bumped on every attempt, successes included — nobody signs in ten times in
 * fifteen minutes, so counting only failures buys nothing and costs a branch.
 *
 * The 429 is returned before the username is resolved and does not depend on
 * whether the account exists, so throttling cannot be used to enumerate
 * usernames the way a slower/faster response could.
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit, requestIp } from '@/lib/rateLimit';
import { isValidUsername } from '@/lib/referrals';

const INVALID = NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });

/**
 * A partner mistyping their own password ten times in fifteen minutes is
 * already an outlier; a guessing run is not. The per-IP ceiling is looser so a
 * card shop whose staff share one NAT'd address can all sign in.
 */
const WINDOW_SECONDS = 15 * 60;
const MAX_PER_USERNAME = 10;
const MAX_PER_IP = 30;

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
        const password = typeof body?.password === 'string' ? body.password : '';

        if (!isValidUsername(username) || password.length < 1) {
            return INVALID;
        }

        // Shape-checked above, so the username key is bounded by isValidUsername's
        // own charset and cannot be used to write arbitrary limiter keys.
        //
        // Fail-open on a limiter outage, the module default and what every other
        // consumer does: this is a partner's only route into their account, and
        // a bump_rate_limit hiccup must not lock them all out. The exposure that
        // buys back is bounded by GoTrue's own per-IP limits underneath.
        const [byIp, byUsername] = await Promise.all([
            checkRateLimit(`partner-login:ip:${requestIp(request)}`, {
                windowSeconds: WINDOW_SECONDS,
                max: MAX_PER_IP,
            }),
            checkRateLimit(`partner-login:user:${username}`, {
                windowSeconds: WINDOW_SECONDS,
                max: MAX_PER_USERNAME,
            }),
        ]);
        if (!byIp.allowed || !byUsername.allowed) {
            return NextResponse.json(
                { error: 'Too many sign-in attempts. Please try again in a few minutes.' },
                { status: 429 },
            );
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
