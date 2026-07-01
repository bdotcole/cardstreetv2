// IMPROVED: Generate portfolio snapshot data with REAL variation
// This creates a realistic growth curve from ฿500 → ฿1,074 with daily fluctuations

const { createClient } = require('@supabase/supabase-js');

// Supabase connection. Never hard-code the service-role key — read it from
// .env.local like the other scripts (CRLF-safe, strips surrounding quotes).
const env = {};
for (const line of require('fs').readFileSync(require('path').join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0 || line.trim().startsWith('#')) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function generateRealisticData() {
    console.log('🔍 Finding users...');

    const { data: users, error: userError } = await supabase
        .from('profiles')
        .select('id, display_name')
        .limit(1);

    if (userError || !users || users.length === 0) {
        console.error('❌ Error:', userError || 'No users found');
        return;
    }

    const userId = users[0].id;
    console.log(`\n📊 User: ${users[0].display_name || userId}`);

    // DELETE old snapshots first
    console.log('🗑️  Deleting old test data...');
    await supabase
        .from('portfolio_snapshots')
        .delete()
        .eq('user_id', userId);
    console.log('✅ Deleted old data\n');

    // Generate 30 days with REAL growth curve
    const snapshots = [];
    const now = new Date();
    const startValue = 500;
    const endValue = 1074; // User's actual current value
    const totalGrowth = endValue - startValue; // ฿574 growth

    console.log(`📈 Creating growth curve: ฿${startValue} → ฿${endValue} (+${Math.round((totalGrowth / startValue) * 100)}%)\n`);

    for (let i = 0; i <= 720; i++) {
        const timestamp = new Date(now);
        timestamp.setHours(timestamp.getHours() - (720 - i));
        timestamp.setMinutes(0, 0, 0);

        const progress = i / 720; // 0 to 1

        // Sigmoid S-curve for realistic growth
        const sigmoid = 1 / (1 + Math.exp(-10 * (progress - 0.5)));
        const baseValue = startValue + (totalGrowth * sigmoid);

        // Add market-like fluctuations
        const dailyWave = Math.sin((i / 24) * Math.PI * 2) * (baseValue * 0.025); // ±2.5% daily wave
        const hourlyNoise = (Math.random() - 0.5) * (baseValue * 0.015); // ±1.5% random

        const finalValue = baseValue + dailyWave + hourlyNoise;

        snapshots.push({
            user_id: userId,
            total_market_value: Math.round(finalValue * 100) / 100,
            item_count: Math.floor(100 + (progress * 50) + Math.random() * 10),
            timestamp: timestamp.toISOString()
        });
    }

    // Last snapshot = exactly current value
    snapshots[snapshots.length - 1].total_market_value = endValue;

    console.log('💾 Inserting snapshots...');

    // Insert in batches
    for (let i = 0; i < snapshots.length; i += 100) {
        const batch = snapshots.slice(i, i + 100);
        const { error } = await supabase.from('portfolio_snapshots').insert(batch);
        if (error) {
            console.error(`❌ Batch error:`, error);
            return;
        }
        process.stdout.write(`\r✅ ${Math.min(i + 100, snapshots.length)} / ${snapshots.length}`);
    }

    console.log('\n\n✨ Success!\n');
    console.log('📊 Stats:');
    console.log(`   Start:  ฿${snapshots[0].total_market_value.toFixed(2)}`);
    console.log(`   End:    ฿${snapshots[snapshots.length - 1].total_market_value.toFixed(2)}`);
    console.log(`   Growth: +${(((endValue - startValue) / startValue) * 100).toFixed(1)}%`);
    console.log(`   Points: ${snapshots.length}\n`);
    console.log('🎯 Refresh Vault - graph will show realistic growth with variation!');
}

generateRealisticData().catch(console.error);
