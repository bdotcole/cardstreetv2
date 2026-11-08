/**
 * Share your wishlist (20261107_wishlist_shares.sql).
 *
 *   GET    → { available, enabled, token, path }
 *   POST   → { available: true, enabled: true, token, path }   create, or turn back on
 *   DELETE → { available: true, enabled: false, token: null, path: null }
 *
 * Every call goes through the cookie client, so the table's RLS (user_id =
 * auth.uid()) is what keeps a user to their own row; nothing in the body says
 * whose wishlist is being shared. The token is 12 random bytes as base64url
 * (16 chars, 96 bits): unguessable, and short enough to read out over LINE.
 *
 * Turning the link back on after DELETE mints a NEW token. A turned-off link
 * is a promise that whoever has it can no longer see the list; reusing the
 * token would quietly break that the moment sharing is switched on again.
 *
 * Fails soft before the migration: GET reports available: false and the
 * writes answer 503, which the share sheet shows as "not available yet".
 */

import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { wishlistSharePath } from '@/lib/wishlistShare';

export const dynamic = 'force-dynamic';

// PostgREST/Postgres codes for "the migration has not run yet".
const MISSING_SCHEMA_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01']);
function isMissingSchema(error: { code?: string } | null | undefined): boolean {
    return !!error?.code && MISSING_SCHEMA_CODES.has(error.code);
}

interface ShareRow {
    token: string;
    enabled: boolean;
}

function mintToken(): string {
    return randomBytes(12).toString('base64url');
}

function stateOf(row: ShareRow | null) {
    const enabled = !!row?.enabled;
    return {
        available: true,
        enabled,
        token: enabled && row ? row.token : null,
        path: enabled && row ? wishlistSharePath(row.token) : null,
    };
}

const NOT_AVAILABLE = { available: false, enabled: false, token: null, path: null };

export async function GET() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
        .from('wishlist_shares')
        .select('token, enabled')
        .eq('user_id', user.id)
        .maybeSingle<ShareRow>();
    if (error) {
        if (isMissingSchema(error)) return NextResponse.json(NOT_AVAILABLE);
        console.error('[wishlist/share] read failed:', error.message);
        return NextResponse.json({ error: 'Could not read sharing state' }, { status: 500 });
    }
    return NextResponse.json(stateOf(data));
}

export async function POST() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: existing, error: readError } = await supabase
        .from('wishlist_shares')
        .select('token, enabled')
        .eq('user_id', user.id)
        .maybeSingle<ShareRow>();
    if (readError) {
        if (isMissingSchema(readError)) return NextResponse.json(NOT_AVAILABLE, { status: 503 });
        console.error('[wishlist/share] read failed:', readError.message);
        return NextResponse.json({ error: 'Could not read sharing state' }, { status: 500 });
    }

    if (existing?.enabled) return NextResponse.json(stateOf(existing));

    const token = mintToken();
    const now = new Date().toISOString();

    if (existing) {
        const { data, error } = await supabase
            .from('wishlist_shares')
            .update({ token, enabled: true, updated_at: now })
            .eq('user_id', user.id)
            .select('token, enabled')
            .single<ShareRow>();
        if (error) {
            console.error('[wishlist/share] re-enable failed:', error.message);
            return NextResponse.json({ error: 'Could not turn sharing on' }, { status: 500 });
        }
        return NextResponse.json(stateOf(data));
    }

    const { data, error } = await supabase
        .from('wishlist_shares')
        .insert({ user_id: user.id, token })
        .select('token, enabled')
        .single<ShareRow>();
    if (error) {
        if (isMissingSchema(error)) return NextResponse.json(NOT_AVAILABLE, { status: 503 });
        // Two taps raced and the other insert won: hand back its row.
        if (error.code === '23505') {
            const { data: raced } = await supabase
                .from('wishlist_shares')
                .select('token, enabled')
                .eq('user_id', user.id)
                .maybeSingle<ShareRow>();
            if (raced?.enabled) return NextResponse.json(stateOf(raced));
        }
        console.error('[wishlist/share] create failed:', error.message);
        return NextResponse.json({ error: 'Could not create the link' }, { status: 500 });
    }
    return NextResponse.json(stateOf(data));
}

export async function DELETE() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { error } = await supabase
        .from('wishlist_shares')
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
    if (error) {
        if (isMissingSchema(error)) return NextResponse.json(NOT_AVAILABLE, { status: 503 });
        console.error('[wishlist/share] disable failed:', error.message);
        return NextResponse.json({ error: 'Could not turn sharing off' }, { status: 500 });
    }
    return NextResponse.json({ available: true, enabled: false, token: null, path: null });
}
