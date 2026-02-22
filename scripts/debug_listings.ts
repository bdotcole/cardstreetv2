import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkTriggers() {
    const { data, error } = await supabase.rpc('get_triggers');
    if (error) {
        // Fallback: raw sql if possible via rest, or just select from pg_trigger. But we can't via REST.
        console.log("Error or no rpc:", error.message);
    } else {
        console.log("Triggers:", data);
    }
}

async function debugListings() {
    const { data: listings, error: lErr } = await supabase.from('listings').select('*').limit(5);
    console.log("Listings:", JSON.stringify(listings, null, 2));
}

debugListings();
