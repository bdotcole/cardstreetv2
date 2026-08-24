/**
 * POST /api/unsubscribe — honor an emailed unsubscribe link.
 *
 * The signed token IS the authorization (lib/unsubscribeToken.ts); there is no
 * session, because someone unsubscribing from an inbox usually isn't signed in
 * on that device and shouldn't have to be.
 *
 * STRICTLY ONE-WAY: this route only ever writes `false`. It takes no value
 * from the caller, so a token that leaks or gets replayed can never be used to
 * re-subscribe somebody, and replaying it is a no-op rather than a toggle.
 *
 * POST, never GET. Mail providers' link scanners GET every URL in a message
 * before the human sees it — the same behavior that broke Supabase auth links
 * here (see app/auth/confirm/page.tsx) — so a GET that unsubscribed would let
 * a scanner silently opt users out of mail they still want. /unsubscribe
 * renders a confirm button and only this POST writes.
 *
 * Accepts the token from a JSON body, a form-encoded body, or the query
 * string. The last two are what RFC 8058 one-click (`List-Unsubscribe-Post:
 * List-Unsubscribe=One-Click`) sends if those headers are enabled on the
 * blast — the endpoint is ready for it, so turning the header on later needs
 * no change here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyUnsubscribeToken } from '@/lib/unsubscribeToken';

export const runtime = 'nodejs';

async function readToken(req: NextRequest): Promise<string> {
    const fromQuery = req.nextUrl.searchParams.get('token');
    if (fromQuery) return fromQuery;

    const type = req.headers.get('content-type') || '';
    try {
        if (type.includes('application/json')) {
            const body = await req.json();
            return typeof body?.token === 'string' ? body.token : '';
        }
        if (type.includes('form')) {
            const form = await req.formData();
            const value = form.get('token');
            return typeof value === 'string' ? value : '';
        }
    } catch {
        // Malformed body — treated as a missing token below.
    }
    return '';
}

export async function POST(req: NextRequest) {
    const token = await readToken(req);
    const claim = verifyUnsubscribeToken(token);
    if (!claim) {
        return NextResponse.json(
            { error: 'This unsubscribe link is not valid', code: 'INVALID_TOKEN' },
            { status: 400 },
        );
    }

    const admin = createAdminClient();
    // Upsert, not update: a web-only account has no notification_preferences
    // row at all (one is created only when a device registers an FCM token),
    // and without this insert their opt-out would silently write nothing.
    // merge-duplicates touches only the named column on an existing row.
    const { error } = await admin
        .from('notification_preferences')
        .upsert(
            {
                user_id: claim.userId,
                [claim.scope]: false,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' },
        );

    if (error) {
        // The column is missing, i.e. 20260824_show_blast_preferences has not
        // been run. Say so plainly rather than reporting success for a write
        // that did not happen — a false confirmation here is how someone ends
        // up filing a spam complaint instead.
        //
        // BOTH codes are required and were measured, not guessed: PostgREST
        // answers a WRITE naming an unknown column with PGRST204 ("not found
        // in the schema cache") and a READ with Postgres's own 42703. This is
        // a write, so PGRST204 is the one that actually fires; 42703 is kept
        // for a direct-SQL path or a future PostgREST that reports it.
        if (error.code === 'PGRST204' || error.code === '42703') {
            console.error('[Unsubscribe] column missing — run 20260824_show_blast_preferences.sql');
            return NextResponse.json(
                { error: 'Unsubscribe is not available yet', code: 'SCHEMA_MISSING' },
                { status: 503 },
            );
        }
        console.error('[Unsubscribe] write failed:', error.message);
        return NextResponse.json({ error: 'Could not update your preferences' }, { status: 500 });
    }

    console.log(`[Unsubscribe] ${claim.scope} disabled for ${claim.userId}`);
    return NextResponse.json({ success: true, scope: claim.scope });
}
