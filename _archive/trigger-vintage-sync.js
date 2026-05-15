import { createClient } from '@supabase/supabase-js';
import process from 'process';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function triggerSync() {
    const setsToSync = ['gym2', 'gym1', 'ecard3', 'si1', 'lc', 'ecard1', 'ecard2'];

    console.log("Triggering Edge Function for Vintage Sets...");

    for (const setId of setsToSync) {
        console.log(`\n⏳ Pinging Edge Function for set_id: ${setId}`);
        const { data, error } = await supabase.functions.invoke('batch-price-english', {
            body: { set_id: setId }
        });

        if (error) {
            console.error(`❌ Error invoking for ${setId}:`, error);
        } else {
            console.log(`✅ Success for ${setId}:`, data);
        }

        // Wait 10 seconds between edge function triggers to give it time to crunch JustTCG
        await new Promise(r => setTimeout(r, 10000));
    }
}

triggerSync().catch(console.error);
