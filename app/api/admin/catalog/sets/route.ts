import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { VALID_GAME_IDS, dbLanguage, cleanStr, toIntOrNull } from '@/lib/catalogFields';

// nodejs runtime to stay consistent with the card route (sharp) and the rest
// of the admin catalog API surface.
export const runtime = 'nodejs';

// POST /api/admin/catalog/sets — create a pokemon_sets row.
export async function POST(request: Request) {
    const gate = await requireAdmin();
    if (gate) return gate;

    try {
        const body = await request.json();

        const id = cleanStr(body.id);
        const name = cleanStr(body.name);
        const game = cleanStr(body.game) ?? 'pokemon';

        if (!id) return NextResponse.json({ error: 'Set ID is required' }, { status: 400 });
        if (!name) return NextResponse.json({ error: 'Set name is required' }, { status: 400 });
        if (!VALID_GAME_IDS.has(game as any)) {
            return NextResponse.json({ error: `Unknown game "${game}"` }, { status: 400 });
        }

        const supabase = createAdminClient();

        const { data: existing } = await supabase
            .from('pokemon_sets')
            .select('id')
            .eq('id', id)
            .maybeSingle();
        if (existing) {
            return NextResponse.json({ error: `A set with ID "${id}" already exists` }, { status: 409 });
        }

        const row = {
            id,
            name,
            game,
            language: dbLanguage(body.language),
            series: cleanStr(body.series),
            printed_total: toIntOrNull(body.printed_total),
            total: toIntOrNull(body.total),
            release_date: cleanStr(body.release_date), // YYYY-MM-DD or null
            logo_url: cleanStr(body.logo_url),
            symbol_url: cleanStr(body.symbol_url),
        };

        const { data, error } = await supabase
            .from('pokemon_sets')
            .insert(row)
            .select()
            .single();

        if (error) throw error;
        return NextResponse.json({ set: data }, { status: 201 });
    } catch (error: any) {
        console.error('Admin create-set error:', error);
        return NextResponse.json({ error: error.message ?? 'Failed to create set' }, { status: 500 });
    }
}
