import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://fdxgzddvywtmnqsaqysx.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeGd6ZGR2eXd0bW5xc2FxeXN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTMxNzcxOSwiZXhwIjoyMDg0ODkzNzE5fQ.Hz5vJpnCeiUDoD4owCd-LCTJ1VTdViH1v-cx6g1smKU';

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
