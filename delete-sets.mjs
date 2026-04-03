import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('Deleting erroneously mapped ME sets from set_bridge...');
    const { data: bData, error: bError } = await supabase
        .from('set_bridge')
        .delete()
        .in('thai_set_id', ['me 02', 'me02.5']);
        
    if (bError) console.error('Error deleting from set_bridge:', bError);
    else console.log('Successfully deleted from set_bridge.');

    const { data: mData, error: mError } = await supabase
        .from('marketplace_configs')
        .delete()
        .in('set_id', ['me 02', 'me02.5']);

    if (mError) console.error('Error deleting from marketplace_configs:', mError);
    else console.log('Successfully deleted from marketplace_configs.');

    console.log('Done.');
}
run();
