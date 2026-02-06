import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
    try {
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // Get all users
        const { data: users, error: usersError } = await supabaseAdmin
            .from('profiles')
            .select('id');

        if (usersError) {
            console.error('Error fetching users:', usersError);
            return new Response(
                JSON.stringify({ success: false, error: usersError.message }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }

        if (!users || users.length === 0) {
            return new Response(
                JSON.stringify({ success: true, message: 'No users found', snapshotsCreated: 0 }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        let snapshotsCreated = 0;
        let errors = 0;

        // Create snapshot for each user
        for (const user of users) {
            try {
                // Get portfolio collections for this user
                const { data: collections, error: collectionsError } = await supabaseAdmin
                    .from('collections')
                    .select('id')
                    .eq('user_id', user.id)
                    .eq('include_in_portfolio', true);

                if (collectionsError) {
                    console.error(`Error fetching collections for user ${user.id}:`, collectionsError);
                    errors++;
                    continue;
                }

                if (!collections || collections.length === 0) {
                    // User has no portfolio collections - skip
                    continue;
                }

                const collectionIds = collections.map(c => c.id);

                // Get all items from portfolio collections
                const { data: items, error: itemsError } = await supabaseAdmin
                    .from('collection_items')
                    .select('card_data, quantity')
                    .in('collection_id', collectionIds);

                if (itemsError) {
                    console.error(`Error fetching items for user ${user.id}:`, itemsError);
                    errors++;
                    continue;
                }

                // Calculate total market value
                let totalValue = 0;
                let itemCount = 0;

                if (items && items.length > 0) {
                    for (const item of items) {
                        const marketPrice = item.card_data?.marketPrice || 0;
                        const quantity = item.quantity || 1;
                        totalValue += marketPrice * quantity;
                        itemCount += quantity;
                    }
                }

                // Create snapshot (rounded to current hour)
                const timestamp = new Date();
                timestamp.setMinutes(0, 0, 0);

                const { error: insertError } = await supabaseAdmin
                    .from('portfolio_snapshots')
                    .upsert({
                        user_id: user.id,
                        total_market_value: totalValue,
                        item_count: itemCount,
                        timestamp: timestamp.toISOString()
                    }, {
                        onConflict: 'user_id,date_trunc',
                        ignoreDuplicates: false
                    });

                if (insertError) {
                    console.error(`Error creating snapshot for user ${user.id}:`, insertError);
                    errors++;
                } else {
                    snapshotsCreated++;
                }
            } catch (userError) {
                console.error(`Error processing user ${user.id}:`, userError);
                errors++;
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: `Portfolio snapshots created successfully`,
                snapshotsCreated,
                errors,
                timestamp: new Date().toISOString()
            }),
            { headers: { 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Fatal error in create-portfolio-snapshots:', error);
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
});
