const { createClient } = require('@supabase/supabase-js');
const fs = require('fs'), path = require('path');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function testListing() {
    console.log('Testing listing creation...');
    // We use service role to bypass RLS for this test just to see if it's a schema issue, 
    // but RLS could also be the issue. Let's try first with service_role.
    
    const mockCard = { id: 'test-card-id', name: 'Test Card', set_id: 'test-set', number: '1' };
    
    // We need a valid user id. We'll pick one from profiles.
    const { data: users } = await supabase.from('profiles').select('id').limit(1);
    if (!users || users.length === 0) {
        console.log('No users found.');
        return;
    }
    const userId = users[0].id;

    const { data, error } = await supabase
        .from('listings')
        .insert({
            seller_id: userId,
            card_id: mockCard.id,
            card_data: mockCard,
            price: 100,
            condition: 'Raw_NM',
            is_graded: false,
            status: 'active'
        })
        .select(`
            *,
            seller:profiles(id, display_name, avatar_url, partner_tier, rating)
        `);

    if (error) {
        console.error('Supabase Error:', error);
    } else {
        console.log('Success:', data);
        // Clean up
        await supabase.from('listings').delete().eq('id', data[0].id);
    }
}

testListing().catch(console.error);
