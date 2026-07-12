import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
    try {
        const supabase = await createClient();

        // Check if user is authenticated
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized. Please sign in to add items to your buylist.' },
                { status: 401 }
            );
        }

        // Parse request body
        const body = await request.json();
        const { card, condition, maxPrice, quantity, notifyMe, currency } = body;

        // Validate required fields
        if (!card || !card.id || !condition || maxPrice === undefined || quantity === undefined) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Coerce + bound the numeric fields. parseFloat/parseInt alone let a
        // non-numeric maxPrice through as NaN and accept negative/absurd values.
        const price = Number(maxPrice);
        const qty = Number(quantity);
        if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) {
            return NextResponse.json({ error: 'Invalid max price' }, { status: 400 });
        }
        if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
            return NextResponse.json({ error: 'Invalid quantity' }, { status: 400 });
        }

        // Insert buylist request into database
        const { data, error } = await supabase
            .from('buylist_requests')
            .insert({
                user_id: user.id,
                card_id: card.id,
                card_name: card.name,
                card_set: card.set,
                card_number: card.number,
                card_rarity: card.rarity,
                card_image_url: card.imageUrl,
                condition: condition,
                max_price: price,
                quantity: qty,
                notify_on_availability: notifyMe !== undefined ? notifyMe : true,
                currency: currency || 'THB',
                status: 'active'
            })
            .select()
            .single();

        if (error) {
            console.error('Error inserting buylist request:', error);
            return NextResponse.json(
                { error: 'Failed to create buylist request' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            data: data,
            message: 'Buylist request created successfully'
        });

    } catch (error) {
        console.error('Unexpected error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// GET endpoint to retrieve user's buylist requests
export async function GET(request: Request) {
    try {
        const supabase = await createClient();

        // Check if user is authenticated
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') || 'active';

        // Fetch user's buylist requests
        const { data, error } = await supabase
            .from('buylist_requests')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', status)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching buylist requests:', error);
            return NextResponse.json(
                { error: 'Failed to fetch buylist requests' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            data: data
        });

    } catch (error) {
        console.error('Unexpected error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
