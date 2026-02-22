import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function repairListingSet() {
    const { data: listing } = await supabase.from('listings').select('id, card_id, card_data').eq('id', '94642695-f7b9-42e9-8eaf-fff471f6179f').single();
    if (listing && listing.card_data) {
        listing.card_data.set = 'Mega Evolution Dream ex (วิวัฒนาการเมก้า ดรีมex)';
        await supabase.from('listings').update({ card_data: listing.card_data }).eq('id', listing.id);
        console.log("Repaired listing!");
    }
}
repairListingSet();
