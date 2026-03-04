import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runMigration() {
    console.log('Running pricing pipeline migration...\n');

    // Use the Supabase RPC to run raw SQL
    const statements = [
        {
            name: 'Add last_priced_at to market_values',
            sql: `ALTER TABLE market_values ADD COLUMN IF NOT EXISTS last_priced_at TIMESTAMPTZ;`
        },
        {
            name: 'Backfill last_priced_at from last_updated',
            sql: `UPDATE market_values SET last_priced_at = last_updated WHERE last_priced_at IS NULL AND last_updated IS NOT NULL;`
        },
        {
            name: 'Index on pokemon_cards.language',
            sql: `CREATE INDEX IF NOT EXISTS idx_pokemon_cards_language ON pokemon_cards(language);`
        },
        {
            name: 'Index on market_values.last_priced_at',
            sql: `CREATE INDEX IF NOT EXISTS idx_market_values_last_priced ON market_values(last_priced_at ASC NULLS FIRST);`
        },
        {
            name: 'Composite index on market_values (card_id, language, condition)',
            sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_market_values_card_lang_cond ON market_values(card_id, language, condition);`
        }
    ];

    for (const stmt of statements) {
        const { error } = await supabase.rpc('exec_sql' as any, { sql: stmt.sql });
        if (error) {
            // Try via a direct query using a workaround
            console.log(`⚠  ${stmt.name}: rpc failed (${error.message}), trying workaround...`);

            // Use REST API admin endpoint
            const result = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
                method: 'POST',
                headers: {
                    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
                    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sql: stmt.sql })
            });
            if (!result.ok) {
                console.log(`  ✗ ${stmt.name}: failed - will need manual execution`);
                console.log(`    SQL: ${stmt.sql}`);
            } else {
                console.log(`  ✓ ${stmt.name}`);
            }
        } else {
            console.log(`  ✓ ${stmt.name}`);
        }
    }

    // Verify last_priced_at column is present by checking market_values
    const { data } = await supabase
        .from('market_values')
        .select('last_priced_at')
        .limit(1);

    if (data !== null) {
        console.log('\n✅ Migration verified — last_priced_at column is present');
    } else {
        console.log('\n❌ Column not found — manual SQL execution needed');
    }
}

runMigration();
