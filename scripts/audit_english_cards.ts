import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function audit() {
    // Total English cards
    const { count: totalEn } = await supabase
        .from('pokemon_cards')
        .select('id', { count: 'exact', head: true })
        .eq('language', 'en');

    console.log(`\nTotal English cards in DB: ${totalEn}`);

    // How many already have market values?
    const { count: priced } = await supabase
        .from('market_values')
        .select('id', { count: 'exact', head: true });

    console.log(`Total market_values rows: ${priced}`);

    // Sample market_values schema
    const { data: sample } = await supabase
        .from('market_values')
        .select('*')
        .limit(1);

    console.log('\nmarket_values sample row:');
    console.log(JSON.stringify(sample?.[0], null, 2));

    // English cards PER SET (top 20 by count)
    const { data: bySets } = await supabase
        .from('pokemon_cards')
        .select('set_id')
        .eq('language', 'en');

    const setCounts: Record<string, number> = {};
    bySets?.forEach(c => { setCounts[c.set_id] = (setCounts[c.set_id] || 0) + 1; });
    const sorted = Object.entries(setCounts).sort((a, b) => b[1] - a[1]);

    console.log('\nEnglish cards by set (top 20):');
    sorted.slice(0, 20).forEach(([s, c]) => console.log(`  ${s}: ${c}`));
    console.log(`  ... ${sorted.length} sets total`);

    // Check if last_priced_at column exists on market_values
    const { data: cols, error: colErr } = await supabase.rpc('get_column_info' as any, {
        table_name: 'market_values'
    });
    if (colErr) {
        // Try direct query
        const { data: mv2 } = await supabase
            .from('market_values')
            .select('last_updated')
            .limit(1);
        console.log('\nmarket_values has last_updated:', mv2 !== null);
    }
}

audit();
