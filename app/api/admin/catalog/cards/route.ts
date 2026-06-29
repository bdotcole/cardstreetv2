import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { cleanStr, toIntOrNull, csvToArray } from '@/lib/catalogFields';
import { processAndUploadCardImage, type CardImageSource } from '@/lib/catalogImages';

// nodejs runtime: image re-encoding uses sharp (native module, Edge-incompatible).
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/admin/catalog/cards — create a pokemon_cards row (multipart/form-data
// so it can carry an uploaded image alongside the fields).
export async function POST(request: Request) {
    const gate = await requireAdmin();
    if (gate) return gate;

    try {
        const form = await request.formData();

        const setId = cleanStr(form.get('set_id'));
        const number = cleanStr(form.get('number'));
        const name = cleanStr(form.get('name'));

        if (!setId) return NextResponse.json({ error: 'Set is required' }, { status: 400 });
        if (!number) return NextResponse.json({ error: 'Card number is required' }, { status: 400 });
        if (!name) return NextResponse.json({ error: 'Card name is required' }, { status: 400 });

        const supabase = createAdminClient();

        // The card inherits game + language from its set — keeps a card from ever
        // drifting out of sync with the set it lives in.
        const { data: set } = await supabase
            .from('pokemon_sets')
            .select('id, game, language')
            .eq('id', setId)
            .maybeSingle();
        if (!set) {
            return NextResponse.json({ error: `Set "${setId}" does not exist` }, { status: 400 });
        }

        // Catalog id convention: `{setId}-{number}` (e.g. sv4pt5-234). Allow an
        // explicit override for the rare print whose id diverges from that.
        const id = cleanStr(form.get('id')) ?? `${setId}-${number}`;

        const { data: existing } = await supabase
            .from('pokemon_cards')
            .select('id')
            .eq('id', id)
            .maybeSingle();
        if (existing) {
            return NextResponse.json({ error: `Card "${id}" already exists in this set` }, { status: 409 });
        }

        // Image: an uploaded file wins; otherwise a pasted URL. Either way it is
        // re-encoded into the card-images bucket so the grid gets a small WebP.
        let imageSource: CardImageSource | null = null;
        const file = form.get('image');
        const imageUrl = cleanStr(form.get('imageUrl'));
        if (file instanceof File && file.size > 0) {
            imageSource = file;
        } else if (imageUrl) {
            imageSource = { url: imageUrl };
        }

        let image_small: string | null = null;
        let image_large: string | null = null;
        if (imageSource) {
            const urls = await processAndUploadCardImage({ source: imageSource, id });
            image_small = urls.smallUrl;
            image_large = urls.largeUrl;
        }

        const row = {
            id,
            set_id: setId,
            game: set.game ?? 'pokemon',
            language: set.language ?? 'en',
            number,
            name,
            english_name: cleanStr(form.get('english_name')),
            rarity: cleanStr(form.get('rarity')),
            supertype: cleanStr(form.get('supertype')),
            hp: toIntOrNull(form.get('hp')),
            types: csvToArray(form.get('types')),
            subtypes: csvToArray(form.get('subtypes')),
            image_small,
            image_large,
        };

        const { data, error } = await supabase
            .from('pokemon_cards')
            .insert(row)
            .select('id, set_id, game, language, number, name, english_name, rarity, supertype, hp, types, subtypes, image_small, image_large')
            .single();

        if (error) throw error;
        return NextResponse.json({ card: data }, { status: 201 });
    } catch (error: any) {
        console.error('Admin create-card error:', error);
        return NextResponse.json({ error: error.message ?? 'Failed to create card' }, { status: 500 });
    }
}
