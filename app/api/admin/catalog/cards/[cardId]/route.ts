import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { cleanStr, toIntOrNull, csvToArray } from '@/lib/catalogFields';
import { processAndUploadCardImage, deleteCardImage, type CardImageSource } from '@/lib/catalogImages';

export const runtime = 'nodejs';
export const maxDuration = 60;

// PATCH /api/admin/catalog/cards/[cardId] — edit a card (multipart so the image
// can be replaced). Only fields actually present in the form are touched.
export async function PATCH(request: Request, props: { params: Promise<{ cardId: string }> }) {
    const gate = await requireAdmin();
    if (gate) return gate;

    const { cardId } = await props.params;
    if (!cardId) return NextResponse.json({ error: 'Missing cardId' }, { status: 400 });

    try {
        const form = await request.formData();
        const supabase = createAdminClient();

        const patch: Record<string, unknown> = {};
        if (form.has('name')) {
            const name = cleanStr(form.get('name'));
            if (!name) return NextResponse.json({ error: 'Card name cannot be empty' }, { status: 400 });
            patch.name = name;
        }
        if (form.has('number')) patch.number = cleanStr(form.get('number'));
        if (form.has('english_name')) patch.english_name = cleanStr(form.get('english_name'));
        if (form.has('rarity')) patch.rarity = cleanStr(form.get('rarity'));
        if (form.has('supertype')) patch.supertype = cleanStr(form.get('supertype'));
        if (form.has('hp')) patch.hp = toIntOrNull(form.get('hp'));
        if (form.has('types')) patch.types = csvToArray(form.get('types'));
        if (form.has('subtypes')) patch.subtypes = csvToArray(form.get('subtypes'));

        // Optional image replacement (file wins over URL). Re-keyed by the
        // card's existing id so it overwrites the prior variants.
        let imageSource: CardImageSource | null = null;
        const file = form.get('image');
        const imageUrl = cleanStr(form.get('imageUrl'));
        if (file instanceof File && file.size > 0) {
            imageSource = file;
        } else if (imageUrl) {
            imageSource = { url: imageUrl };
        }
        if (imageSource) {
            const urls = await processAndUploadCardImage({ source: imageSource, id: cardId });
            patch.image_small = urls.smallUrl;
            patch.image_large = urls.largeUrl;
        }

        if (Object.keys(patch).length === 0) {
            return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('pokemon_cards')
            .update(patch)
            .eq('id', cardId)
            .select('id, set_id, game, language, number, name, english_name, rarity, supertype, hp, types, subtypes, image_small, image_large')
            .single();

        if (error) throw error;
        if (!data) return NextResponse.json({ error: 'Card not found' }, { status: 404 });
        return NextResponse.json({ card: data });
    } catch (error: any) {
        console.error('Admin update-card error:', error);
        return NextResponse.json({ error: error.message ?? 'Failed to update card' }, { status: 500 });
    }
}

// DELETE /api/admin/catalog/cards/[cardId] — remove a card and its mirrored art.
export async function DELETE(_request: Request, props: { params: Promise<{ cardId: string }> }) {
    const gate = await requireAdmin();
    if (gate) return gate;

    const { cardId } = await props.params;
    if (!cardId) return NextResponse.json({ error: 'Missing cardId' }, { status: 400 });

    try {
        const supabase = createAdminClient();
        const { error } = await supabase.from('pokemon_cards').delete().eq('id', cardId);
        if (error) throw error;

        // Best-effort: clear the bucket objects. A leftover image is harmless, so
        // don't fail the request if storage cleanup hiccups.
        await deleteCardImage(cardId).catch(() => {});

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Admin delete-card error:', error);
        return NextResponse.json({ error: error.message ?? 'Failed to delete card' }, { status: 500 });
    }
}
