const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
const roleMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);

const supabaseUrl = urlMatch[1].trim();
const supabaseKey = roleMatch[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRows() {
    const { data: mv } = await supabase
        .from('market_values')
        .select('*')
        .in('card_id', ['sv10-39', 'sv10-039', 'sv10-231']);

    console.log("All rows for sv10-39 / 039 / 231:");
    console.log(JSON.stringify(mv, null, 2));

    const { data: c } = await supabase
        .from('pokemon_cards')
        .select('id, name, number, set_id')
        .in('id', ['sv10-39', 'sv10-039', 'sv10-231']);

    console.log("Cards in table:");
    console.log(JSON.stringify(c, null, 2));
}

checkRows();
