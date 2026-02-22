import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function purgeDuplicate() {
    console.log("Deleting duplicate listing 65639a15-0d82-4276-a9be-2f033e9694c4");
    const { error } = await supabase.from('listings').delete().eq('id', '65639a15-0d82-4276-a9be-2f033e9694c4');
    if (error) console.log("Error:", error);
    else console.log("Deleted successfully.");
}

purgeDuplicate();
