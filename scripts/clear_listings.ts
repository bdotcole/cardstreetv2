import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function cleanSpam() {
    console.log("Deleting existing listings...");
    const { error } = await supabase.from('listings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
        console.error("Failed to delete listings:", error.message);
    } else {
        console.log("Successfully removed spam listings!");
    }
}

cleanSpam();
