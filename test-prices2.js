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
    const { data: mv2, error } = await supabase
        .from('market_values')
        .select('*')
        .eq('language', 'en')
        .like('card_id', 'sv10-%')
        .limit(3);

    console.log("SV10 EN market_values:", mv2);
}

checkPrices();
