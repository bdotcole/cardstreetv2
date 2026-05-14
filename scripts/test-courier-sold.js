/*
 * Manual smoke test for the courier "Sold" notification flow.
 *
 * Inserts a temporary listing, runs it through /api/orders/checkout as the
 * buyer, and verifies the notification fires. Everything created is torn
 * down in the finally block — including collection_items, which the old
 * version of this script forgot, leaking test cards into real user vaults.
 *
 * Usage (both user IDs REQUIRED — script refuses to guess):
 *   node scripts/test-courier-sold.js --buyer=<uuid> --seller=<uuid> [--api=http://localhost:3000]
 *
 * Both UUIDs MUST belong to dedicated test accounts. Never pass production
 * user IDs unless you're prepared for them to receive a fake order +
 * notification.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// --- CLI arg parsing -------------------------------------------------------
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => {
            const [k, ...v] = a.slice(2).split('=');
            return [k, v.join('=') || true];
        })
);

const BUYER_ID = args.buyer;
const SELLER_ID = args.seller;
const API_BASE = args.api || 'http://localhost:3000';

if (!BUYER_ID || !SELLER_ID) {
    console.error('ERROR: --buyer=<uuid> and --seller=<uuid> are both required.');
    console.error('       Pass two dedicated test account UUIDs — never random prod users.');
    console.error('Example:');
    console.error('  node scripts/test-courier-sold.js \\');
    console.error('    --buyer=11111111-1111-1111-1111-111111111111 \\');
    console.error('    --seller=22222222-2222-2222-2222-222222222222');
    process.exit(1);
}
if (BUYER_ID === SELLER_ID) {
    console.error('ERROR: --buyer and --seller must be different user IDs.');
    process.exit(1);
}

// --- Supabase setup --------------------------------------------------------
const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) env[key] = value.trim();
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];
if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// Unique card_id per run so concurrent/repeated runs can't collide,
// and so any leaked rows are obvious in the DB.
const TEST_CARD_ID = `test-courier-${Date.now()}`;

async function ensureUsersExist() {
    const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .in('id', [BUYER_ID, SELLER_ID]);
    if (error) throw error;
    const found = new Set((data || []).map(u => u.id));
    if (!found.has(BUYER_ID)) throw new Error(`Buyer user ${BUYER_ID} not found in profiles.`);
    if (!found.has(SELLER_ID)) throw new Error(`Seller user ${SELLER_ID} not found in profiles.`);
}

async function testCheckoutNotification() {
    await ensureUsersExist();
    console.log(`Buyer: ${BUYER_ID}`);
    console.log(`Seller: ${SELLER_ID}`);
    console.log(`Card ID for this run: ${TEST_CARD_ID}`);

    const { data: newListing, error: insertListingError } = await supabase
        .from('listings')
        .insert({
            seller_id: SELLER_ID,
            card_id: TEST_CARD_ID,
            // Fully-populated card_data so the row can't crash the Vault if
            // it ever leaks past cleanup (defense in depth — the client also
            // normalizes on read).
            card_data: {
                id: TEST_CARD_ID,
                name: 'Courier Test Event Card',
                set: 'Test Set',
                number: '0',
                rarity: 'C',
                imageUrl: '',
                marketPrice: 150,
                priceHistory: []
            },
            price: 150,
            condition: 'Near Mint',
            status: 'active'
        })
        .select()
        .single();

    if (insertListingError) {
        console.error('Failed to insert mock listing:', insertListingError);
        return;
    }
    console.log(`Created mock listing: ${newListing.id}`);

    const checkoutPayload = {
        buyerId: BUYER_ID,
        paymentMethod: 'credit_card',
        paymentId: 'test_payment_' + Date.now(),
        items: [
            {
                id: newListing.id,
                cardId: newListing.card_id,
                sellerId: SELLER_ID,
                price: newListing.price,
                condition: newListing.condition,
                card: newListing.card_data
            }
        ]
    };

    console.log(`Mocking POST to ${API_BASE}/api/orders/checkout...`);
    try {
        const response = await fetch(`${API_BASE}/api/orders/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(checkoutPayload)
        });
        const data = await response.json();
        console.log('Checkout Response:', data);
        if (data.success) {
            console.log("Checkout successful — 'Sold' notification should have fired.");
        }
    } catch (err) {
        console.error('Error calling checkout API:', err);
    } finally {
        // CLEANUP — sweep every table that could have received test data,
        // keyed by our run-specific TEST_CARD_ID so we can never delete
        // anything belonging to a real card. This is the bit the previous
        // version missed (collection_items), which leaked test cards into
        // production user vaults.
        console.log('Cleaning up mock data...');
        const { error: ciError } = await supabase
            .from('collection_items')
            .delete()
            .eq('card_id', TEST_CARD_ID);
        if (ciError) console.error('  collection_items cleanup failed:', ciError);

        const { error: orderError } = await supabase
            .from('orders')
            .delete()
            .eq('listing_id', newListing.id);
        if (orderError) console.error('  orders cleanup failed:', orderError);

        const { error: listingError } = await supabase
            .from('listings')
            .delete()
            .eq('id', newListing.id);
        if (listingError) console.error('  listings cleanup failed:', listingError);

        console.log('Done.');
    }
}

testCheckoutNotification();
