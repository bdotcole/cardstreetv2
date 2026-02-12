
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkPrices() {
    console.log('--- Checking for 10 THB Default Prices ---');
    const { count, error } = await supabase
        .from('market_values')
        .select('*', { count: 'exact', head: true })
        .eq('market_avg', 10)
        .gte('last_updated', new Date(Date.now() - 10 * 60 * 1000).toISOString()); // Last 10 mins

    console.log(`New default prices (10 THB) created in last 10 mins: ${count}`);

    console.log('\n--- Checking MA1 Pricing Coverage ---');
    // Get total MA1 cards
    const { count: totalMA1 } = await supabase
        .from('pokemon_cards')
        .select('*', { count: 'exact', head: true })
        .eq('set_id', 'MA1');

    // Get priced MA1 cards
    const { data: ma1Cards } = await supabase
        .from('pokemon_cards')
        .select('id')
        .eq('set_id', 'MA1');

    const ma1Ids = ma1Cards.map(c => c.id);
    const { count: pricedMA1 } = await supabase
        .from('market_values')
        .select('*', { count: 'exact', head: true })
        .in('card_id', ma1Ids);

    console.log(`MA1 Pricing: ${pricedMA1} / ${totalMA1} (${((pricedMA1 / totalMA1) * 100).toFixed(1)}%)`);
}

checkPrices();
