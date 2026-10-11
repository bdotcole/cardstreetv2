/**
 * PATCH /api/admin/social/accounts/<id>  { brand?, enabled? }
 *   Move an account between brands (one Facebook login often admins both
 *   brands' Pages, so a connect files them together) or pause its sync.
 *   An Instagram account follows its parent Page's brand when the Page moves.
 *
 * DELETE /api/admin/social/accounts/<id>
 *   Disconnect: removes the row, its tokens, its history and its posts
 *   (cascades). Deleting a Facebook Page also removes its Instagram account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { SOCIAL_BRANDS } from '@/lib/social/types';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const gate = await requireAdmin();
    if (gate) return gate;
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.brand === 'string') {
        if (!(SOCIAL_BRANDS as string[]).includes(body.brand)) return NextResponse.json({ error: 'Bad brand' }, { status: 400 });
        patch.brand = body.brand;
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

    const supabase = createAdminClient();
    const { error } = await supabase.from('social_accounts').update(patch).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (patch.brand) {
        const { error: childErr } = await supabase.from('social_accounts').update({ brand: patch.brand }).eq('parent_account_id', id);
        if (childErr) return NextResponse.json({ error: childErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const gate = await requireAdmin();
    if (gate) return gate;
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

    const supabase = createAdminClient();
    const { error } = await supabase.from('social_accounts').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
