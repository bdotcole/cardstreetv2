const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load env vars
const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) env[key] = value.trim();
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testCheckoutNotification() {
    console.log("Fetching users...");

    // Get two random users
    const { data: users, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .limit(2);

    if (userError || !users || users.length < 2) {
        console.error("Not enough users found to test.", userError);
        return;
    }

    const buyerId = users[0].id;
    const sellerId = users[1].id;

    console.log(`Buyer: ${buyerId}, Seller: ${sellerId}`);

    // Create a mock listing
    const { data: newListing, error: insertListingError } = await supabase
        .from('listings')
        .insert({
            seller_id: sellerId,
            card_id: 'test-card-123',
            card_data: { name: 'Test Courier Card' },
            price: 150,
            condition: 'Near Mint',
            status: 'active'
        })
        .select()
        .single();

    if (insertListingError) {
        console.error("Failed to insert mock listing:", insertListingError);
        return;
    }

    console.log(`Created mock listing: ${newListing.id}`);

    const checkoutPayload = {
        buyerId: buyerId,
        paymentMethod: 'credit_card',
        paymentId: 'test_payment_' + Date.now(),
        items: [
            {
                id: newListing.id,
                cardId: newListing.card_id,
                sellerId: sellerId,
                price: newListing.price,
                condition: newListing.condition,
                card: { name: 'Courier Test Event Card' }
            }
        ]
    };

    console.log("Mocking POST request to /api/orders/checkout...");

    try {
        const response = await fetch('http://localhost:3001/api/orders/checkout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(checkoutPayload)
        });

        const data = await response.json();
        console.log("Checkout Response:", data);

        if (data.success) {
            console.log("Checkout successful! The 'Sold' notification should have fired.");
        }

    } catch (err) {
        console.error("Error calling checkout API:", err);
    } finally {
        // CLEANUP
        console.log("Cleaning up mock data...");
        await supabase.from('orders').delete().eq('listing_id', newListing.id);
        await supabase.from('listings').delete().eq('id', newListing.id);
        console.log("Done.");
    }
}

testCheckoutNotification();
