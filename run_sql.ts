import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
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
    const sql = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20260506_add_shipping_fee_to_orders.sql'), 'utf-8');
    
    // Quick hack: call the rpc 'exec_sql' if it exists, otherwise we'll have to use the API or tell the user to run it.
    // Actually we can't reliably execute arbitrary SQL via JS client unless there is an RPC.
    console.log("Please run this SQL in Supabase SQL editor manually if `rpc` fails.");
    try {
        const { error } = await supabase.rpc('exec_sql', { sql });
        if (error) {
            console.error('RPC Error (ignoring as exec_sql might not exist):', error.message);
        } else {
            console.log('SQL Executed successfully via RPC.');
        }
    } catch (e) {
        console.error(e);
    }
}

run();
