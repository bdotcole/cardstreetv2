
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

async function checkCardDetails() {
    console.log('--- Checking Card Details for MA1-161 ---');
    const { data: card, error } = await supabase
        .from('pokemon_cards')
        .select('*')
        .eq('id', 'MA1-161/126')
        .single();

    if (card) {
        console.log('Card:', card);
    } else {
        console.log('Error:', error);
    }
}

checkCardDetails();
