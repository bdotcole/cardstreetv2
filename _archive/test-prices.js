const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
const roleMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);

const supabaseUrl = urlMatch[1].trim();
const supabaseKey = roleMatch[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPrices() {
    const { data: mv1 } = await supabase
        .from('market_values')
        .select('*')
        .eq('card_id', 'sv10-3');

    console.log("All SV10-3 market_values:", mv1);

    const { data: mv2, error } = await supabase
        .from('market_values')
        .select('*')
        .eq('language', 'en')
        .eq('condition', 'Raw_NM')
        .order('created_at', { ascending: false })
        .limit(5);

    console.log("Latest EN market_values globally:", mv2, error);

    // Check if SV10 has any EN prices at all
    const { count } = await supabase
        .from('market_values')
        .select('id', { count: 'exact', head: true })
        .eq('language', 'en')
        .like('card_id', 'sv10-%');

    console.log("Total EN market values for SV10: ", count);
}

checkPrices();
