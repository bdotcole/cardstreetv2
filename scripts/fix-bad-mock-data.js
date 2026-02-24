const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) env[key] = value.trim();
});

const supabase = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

async function fixDatabase() {
    console.log("Removing malformed mock collection items...");

    // Find bad collection items
    const { data: badItems, error: getErr } = await supabase.from('collection_items').select('id, card_data');
    if (getErr) {
        console.error("Error reading collection items", getErr);
        return;
    }

    const badItemIds = [];
    for (const item of badItems) {
        if (!item.card_data || !item.card_data.set || !item.card_data.number) {
            badItemIds.push(item.id);
        }
    }

    if (badItemIds.length > 0) {
        const { error: delErr } = await supabase.from('collection_items').delete().in('id', badItemIds);
        if (delErr) {
            console.error("Error deleting bad collection items", delErr);
        } else {
            console.log(`Deleted ${badItemIds.length} bad collection items.`);
        }
    } else {
        console.log("No bad collection items found.");
    }

    // Find bad listings as well (just in case they were listed)
    console.log("Checking for bad listings...");
    const { data: badListings } = await supabase.from('listings').select('id, card_id').eq('card_id', 'mock_card_id');
    if (badListings && badListings.length > 0) {
        const badListingIds = badListings.map(l => l.id);
        const { error: delListErr } = await supabase.from('listings').delete().in('id', badListingIds);
        if (delListErr) {
            console.error("Error deleting bad listings", delListErr);
        } else {
            console.log(`Deleted ${badListingIds.length} bad listings.`);
        }
    } else {
        console.log("No bad listings found.");
    }
}

fixDatabase();
