import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectTable() {
    const { data: records, error } = await supabase.from('notification_preferences').select('*').limit(5);
    if (error) {
        console.error("Error fetching notification_preferences:", error);
        return;
    }
    console.log("Columns:", Object.keys(records[0] || {}));
    console.log("Sample records:", records);
}
inspectTable();
