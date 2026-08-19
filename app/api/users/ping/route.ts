/**
 * POST /api/users/ping — stamp profiles.last_active_at for the caller.
 *
 * The app had no per-user activity signal at all (see
 * 20260819_profiles_last_active.sql for why last_sign_in_at and
 * profiles.updated_at both fail), so DAU/WAU/retention were unanswerable
 * without GA. This is that signal: one cheap write, from the same web app the
 * native shell loads, so web and native are counted identically.
 *
 * Deliberately silent about failure. A missing column (migration not yet run)
 * or a write error must never surface to the user or retry — it is telemetry,
 * and a 200 keeps the client's fire-and-forget call from logging noise.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function POST() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        // Anonymous browsing is expected and is not an error — GA covers
        // logged-out traffic; this column is per-account by definition.
        if (!user) return NextResponse.json({ ok: true, anonymous: true });

        // Service role: the profiles UPDATE policy is deliberately narrow, and
        // this write is not user-authored data.
        const admin = createAdminClient();
        const { error } = await admin
            .from('profiles')
            .update({ last_active_at: new Date().toISOString() })
            .eq('id', user.id);

        if (error) {
            // 42703 = column absent until the migration runs. Expected, quiet.
            if (error.code !== '42703') {
                console.warn('[Ping] last_active_at write failed:', error.message);
            }
            return NextResponse.json({ ok: false });
        }
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ ok: false });
    }
}
