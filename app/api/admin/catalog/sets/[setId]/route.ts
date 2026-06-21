import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { dbLanguage, cleanStr, toIntOrNull } from '@/lib/catalogFields';

export const runtime = 'nodejs';

// PATCH /api/admin/catalog/sets/[setId] — edit set metadata.
export async function PATCH(request: Request, props: { params: Promise<{ setId: string }> }) {
    const gate = await requireAdmin();
    if (gate) return gate;

    const { setId } = await props.params;
    if (!setId) return NextResponse.json({ error: 'Missing setId' }, { status: 400 });

    try {
        const body = await request.json();
        const supabase = createAdminClient();

        // Only assign fields the caller actually sent, so a partial PATCH never
        // nulls untouched columns. The set id itself is immutable (FK target).
        const patch: Record<string, unknown> = {};
        if ('name' in body) patch.name = cleanStr(body.name);
        if ('series' in body) patch.series = cleanStr(body.series);
        if ('language' in body) patch.language = dbLanguage(body.language);
        if ('printed_total' in body) patch.printed_total = toIntOrNull(body.printed_total);
        if ('total' in body) patch.total = toIntOrNull(body.total);
        if ('release_date' in body) patch.release_date = cleanStr(body.release_date);
        if ('logo_url' in body) patch.logo_url = cleanStr(body.logo_url);
        if ('symbol_url' in body) patch.symbol_url = cleanStr(body.symbol_url);

        if (Object.keys(patch).length === 0) {
            return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
        }
        if (patch.name === null) {
            return NextResponse.json({ error: 'Set name cannot be empty' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('pokemon_sets')
            .update(patch)
            .eq('id', setId)
            .select()
            .single();

        if (error) throw error;
        if (!data) return NextResponse.json({ error: 'Set not found' }, { status: 404 });
        return NextResponse.json({ set: data });
    } catch (error: any) {
        console.error('Admin update-set error:', error);
        return NextResponse.json({ error: error.message ?? 'Failed to update set' }, { status: 500 });
    }
}

// DELETE /api/admin/catalog/sets/[setId] — remove an empty set.
export async function DELETE(_request: Request, props: { params: Promise<{ setId: string }> }) {
    const gate = await requireAdmin();
    if (gate) return gate;

    const { setId } = await props.params;
    if (!setId) return NextResponse.json({ error: 'Missing setId' }, { status: 400 });

    try {
        const supabase = createAdminClient();

        // Guard: pokemon_cards.set_id is ON DELETE CASCADE, so deleting a set
        // would silently wipe its cards. Refuse unless the set is already empty.
        const { count } = await supabase
            .from('pokemon_cards')
            .select('id', { count: 'exact', head: true })
            .eq('set_id', setId);

        if ((count ?? 0) > 0) {
            return NextResponse.json(
                { error: `Set still has ${count} card(s). Delete the cards first.` },
                { status: 409 },
            );
        }

        const { error } = await supabase.from('pokemon_sets').delete().eq('id', setId);
        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Admin delete-set error:', error);
        return NextResponse.json({ error: error.message ?? 'Failed to delete set' }, { status: 500 });
    }
}
