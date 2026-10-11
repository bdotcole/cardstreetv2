/**
 * GET /api/admin/social/accounts — every connected social account, tokens
 * stripped, plus which providers the server has credentials for (so the
 * dashboard can grey out a Connect button with the reason).
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { CONNECT_PROVIDERS, isGa4Configured, isProviderConfigured } from '@/lib/social/config';
import { toPublicAccount, type SocialAccountRow } from '@/lib/social/types';

export const runtime = 'nodejs';

export async function GET() {
    const gate = await requireAdmin();
    if (gate) return gate;

    const supabase = createAdminClient();
    const { data, error } = await supabase
        .from('social_accounts').select('*').order('brand').order('platform').order('connected_at');
    if (error) {
        // Table missing = migration not applied; say so instead of a bare 500.
        const missing = /social_accounts/.test(error.message) && /does not exist|schema cache/.test(error.message);
        return NextResponse.json({ error: error.message, migrationMissing: missing }, { status: missing ? 200 : 500 });
    }

    return NextResponse.json({
        accounts: ((data ?? []) as SocialAccountRow[]).map(toPublicAccount),
        providers: Object.fromEntries(CONNECT_PROVIDERS.map((p) => [p, isProviderConfigured(p)])),
        ga4: isGa4Configured(),
    });
}
