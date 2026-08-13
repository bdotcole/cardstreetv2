/**
 * Admin authorization helper.
 *
 * Every route under /api/admin/** should call requireAdmin() at the top.
 * Returns a NextResponse on failure (the route should `return` it directly);
 * returns null on success.
 */

import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export async function requireAdmin(): Promise<NextResponse | null> {
    const gate = await requireAdminUser();
    return gate instanceof NextResponse ? gate : null;
}

/**
 * Same gate as requireAdmin(), but hands back the verified admin's user for
 * routes that need to act AS the admin (e.g. house-reserving break spots).
 * Fails closed: any lookup error is a 403.
 */
export async function requireAdminUser(): Promise<{ user: User } | NextResponse> {
    const cookieSupabase = await createServerClient();
    const { data: { user }, error } = await cookieSupabase.auth.getUser();

    if (error || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Read role with service-role so the policy on profiles can't accidentally
    // hide the row from the caller's session.
    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: profile, error: profileErr } = await admin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (profileErr || !profile || profile.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return { user };
}
