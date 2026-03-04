import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Rarity mapping from English names → Thai/JP symbol + name
// Source: Rarity Table - Sheet1.csv + expanded for variants found in dry-run
const ENGLISH_TO_THAI: Record<string, { symbol: string; name: string }> = {
    // Core mappings from the CSV
    'common': { symbol: 'C', name: 'Common' },
    'uncommon': { symbol: 'U', name: 'Uncommon' },
    'rare': { symbol: 'R', name: 'Rare' },
    'double rare': { symbol: 'RR', name: 'Double Rare' },
    'ultra rare': { symbol: 'SR', name: 'Super Rare' },
    'illustration rare': { symbol: 'AR', name: 'Art Rare' },
    'special illustration rare': { symbol: 'SAR', name: 'Special Art Rare' },
    'hyper rare': { symbol: 'UR', name: 'Ultra Rare' },
    'pokeball reverse holo': { symbol: 'PB', name: 'Pokeball reverse holo' },
    'energy reverse holo': { symbol: 'EH', name: 'energy reverse holo' },

    // Already-Thai names stored as full names (should be symbols)
    'art rare': { symbol: 'AR', name: 'Art Rare' },
    'special art rare': { symbol: 'SAR', name: 'Special Art Rare' },

    // Holo Rare variants → R (closest Thai equivalent)
    'holo rare': { symbol: 'R', name: 'Rare' },
    'rare holo': { symbol: 'R', name: 'Rare' },
    'rare holo lv.x': { symbol: 'R', name: 'Rare' },
    'rare prime': { symbol: 'R', name: 'Rare' },
    'holo rare v': { symbol: 'RR', name: 'Double Rare' },
    'holo rare vmax': { symbol: 'RR', name: 'Double Rare' },
    'holo rare vstar': { symbol: 'RR', name: 'Double Rare' },

    // Secret Rare / Full Art → SAR or UR
    'secret rare': { symbol: 'SAR', name: 'Special Art Rare' },
    'full art trainer': { symbol: 'SAR', name: 'Special Art Rare' },

    // Shiny variants
    'shiny rare': { symbol: 'AR', name: 'Art Rare' },
    'shiny rare v': { symbol: 'AR', name: 'Art Rare' },
    'shiny rare vmax': { symbol: 'SAR', name: 'Special Art Rare' },
    'shiny ultra rare': { symbol: 'UR', name: 'Ultra Rare' },

    // ACE SPEC → SR (SR is the functional closest Scarlet/Violet equivalent)
    'ace spec rare': { symbol: 'SR', name: 'Super Rare' },

    // Radiant / Amazing → SR
    'radiant rare': { symbol: 'SR', name: 'Super Rare' },
    'amazing rare': { symbol: 'SR', name: 'Super Rare' },

    // Black & White era / LEGEND / PRIME / Classic
    'black & white rare': { symbol: 'R', name: 'Rare' },
    'black white rare': { symbol: 'R', name: 'Rare' },
    'classic collection': { symbol: 'R', name: 'Rare' },
    'legend': { symbol: 'UR', name: 'Ultra Rare' },
    'mega hyper rare': { symbol: 'UR', name: 'Ultra Rare' },
    'muster rare': { symbol: 'R', name: 'Rare' },

    // None → treat as common if somehow stored
    'none': { symbol: 'C', name: 'Common' },
};


// Thai/JP symbols that are already correct — no change needed
// MA and MUR appear to be valid existing Thai-specific codes in the database
const ALREADY_THAI = new Set(['C', 'U', 'R', 'RR', 'SR', 'AR', 'SAR', 'UR', 'PB', 'EH', 'MA', 'MUR']);

async function auditAndFix(dryRun = true) {
    console.log(dryRun ? "\n=== DRY RUN — no changes will be made ===" : "\n=== LIVE UPDATE — applying fixes ===");

    // Paginate through all records (Supabase default limit is 1000 per page)
    let allCards: any[] = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('pokemon_cards')
            .select('id, name, set_id, rarity')
            .order('set_id', { ascending: true })
            .range(from, from + pageSize - 1);

        if (error) { console.error("Fetch error:", error); return; }
        if (!data || data.length === 0) break;
        allCards = allCards.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
    }

    console.log(`\nTotal cards in database: ${allCards.length}`);

    const toFix: { id: string; name: string; set_id: string; from: string; to: string; toSymbol: string }[] = [];
    const correct: number[] = [];
    const unknownRarities = new Set<string>();

    for (const card of allCards) {
        const rarity: string = (card.rarity || '').trim();

        if (!rarity) continue;

        if (ALREADY_THAI.has(rarity)) {
            correct.push(1);
            continue;
        }

        const mapped = ENGLISH_TO_THAI[rarity.toLowerCase()];
        if (mapped) {
            toFix.push({
                id: card.id,
                name: card.name,
                set_id: card.set_id,
                from: rarity,
                to: mapped.name,
                toSymbol: mapped.symbol,
            });
        } else {
            unknownRarities.add(rarity);
        }
    }

    console.log(`\n✅ Already correct Thai/JP: ${correct.length} cards`);
    console.log(`🔄 Need updating:           ${toFix.length} cards`);
    console.log(`❓ Unknown rarities:         ${unknownRarities.size} distinct values`);

    // Grouped summary of what will change
    const grouped: Record<string, number> = {};
    for (const c of toFix) {
        const key = `"${c.from}" → "${c.toSymbol}" (${c.to})`;
        grouped[key] = (grouped[key] || 0) + 1;
    }
    if (Object.keys(grouped).length > 0) {
        console.log("\n--- Changes to be applied ---");
        for (const [key, count] of Object.entries(grouped).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${key}: ${count} cards`);
        }
    }

    if (unknownRarities.size > 0) {
        console.log("\n--- Unknown rarities (no mapping available) ---");
        for (const r of [...unknownRarities].sort()) {
            console.log(`  "${r}"`);
        }
    }

    if (!dryRun && toFix.length > 0) {
        console.log("\nApplying updates...");
        // Batch by toSymbol to minimize round-trips
        const bySymbol: Record<string, string[]> = {};
        for (const c of toFix) {
            if (!bySymbol[c.toSymbol]) bySymbol[c.toSymbol] = [];
            bySymbol[c.toSymbol].push(c.id);
        }

        let totalUpdated = 0;
        for (const [symbol, ids] of Object.entries(bySymbol)) {
            // Supabase in() filter supports up to ~500 ids safely
            const chunks: string[][] = [];
            for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
            for (const chunk of chunks) {
                const { error } = await supabase
                    .from('pokemon_cards')
                    .update({ rarity: symbol })
                    .in('id', chunk);
                if (error) {
                    console.error(`  Failed to update chunk for symbol "${symbol}":`, error.message);
                } else {
                    totalUpdated += chunk.length;
                    console.log(`  Updated ${chunk.length} cards → "${symbol}"`);
                }
            }
        }
        console.log(`\n✅ Done. ${totalUpdated} cards updated.`);
    }
}

// Default: dry run.  Pass --fix to actually update.
const dryRun = !process.argv.includes('--fix');
auditAndFix(dryRun);
