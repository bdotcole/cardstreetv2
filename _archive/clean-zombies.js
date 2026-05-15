const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
const roleMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);

const supabaseUrl = urlMatch[1].trim();
const supabaseKey = roleMatch[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanZombies() {
    console.log("Deleting phantom THB records for English SV10 cards...");
    const { error: err1 } = await supabase
        .from('market_values')
        .delete()
        .like('card_id', 'sv10-%')
        .eq('language', 'th');

    if (err1) console.error(err1);

    console.log("Deleting phantom THB records for English SV09 cards...");
    const { error: err2 } = await supabase
        .from('market_values')
        .delete()
        .like('card_id', 'sv09-%')
        .eq('language', 'th');

    if (err2) console.error(err2);

    console.log("Cleanup complete!");
}

cleanZombies();
