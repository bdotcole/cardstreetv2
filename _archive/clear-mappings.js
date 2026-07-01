import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://fdxgzddvywtmnqsaqysx.supabase.co';
// Never hard-code the service-role key — export SUPABASE_SERVICE_ROLE_KEY (see .env.local).
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY in the environment');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function clearMappings() {
    console.log('Clearing all card mappings...');
    const { error } = await supabase
        .from('card_mappings')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (error) {
        console.error('Error clearing mappings:', error);
    } else {
        console.log('Mappings cleared.');
    }
}

clearMappings();
