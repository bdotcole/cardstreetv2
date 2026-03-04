import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ===================================================================
// SET BRIDGE: Maps Thai set IDs to their English set equivalents
// Based on Thai Set Tracker - Main (1).csv + research on English set IDs
// Some Thai sets have MULTIPLE English equivalents (e.g. SV5M & SV5K
// both map to Temporal Forces sv05)
// Some Thai sets have NO English equivalent (MA1, MA2, MA3 are Thai-
// exclusive Mega Evolution sets that don't exist in English)
// ===================================================================
const SET_BRIDGE: Array<{
    thai_set_id: string;
    thai_set_name: string;
    english_set_ids: string[];   // one or more english IDs this maps to
    notes: string;
}> = [
        // --- Scarlet & Violet Era (SV series) ---
        { thai_set_id: 'SV11s', thai_set_name: 'Black & White', english_set_ids: ['sv10.5b', 'sv10.5w'], notes: 'Thai = Black & White retro set. Maps to both Black Bolt and White Flare.' },
        { thai_set_id: 'SV10s', thai_set_name: 'Rise of the Invincible', english_set_ids: ['sv10'], notes: 'Destined Rivals' },
        { thai_set_id: 'SV9s', thai_set_name: 'Bond of Destiny', english_set_ids: ['sv09'], notes: 'Journey Together' },
        { thai_set_id: 'SV8a', thai_set_name: 'Terastal Festival ex', english_set_ids: ['sv8pt5'], notes: 'Prismatic Evolutions' },
        { thai_set_id: 'SV8s', thai_set_name: 'Supercharged Stellar', english_set_ids: ['sv08'], notes: 'Surging Sparks - Thai SV8s maps to EN sv08' },
        { thai_set_id: 'SV7s', thai_set_name: 'Stellar Guidance', english_set_ids: ['sv07'], notes: 'Stellar Crown' },
        { thai_set_id: 'SV6', thai_set_name: 'Illusionist\'s Mask', english_set_ids: ['sv06'], notes: 'Twilight Masquerade' },
        { thai_set_id: 'SV5a', thai_set_name: 'Crimson Mist', english_set_ids: ['sv06'], notes: 'Thai SV5a also maps to Twilight Masquerade (jp sv5a was subsumed into en sv06)' },
        { thai_set_id: 'SV5M', thai_set_name: 'Cyber Judge', english_set_ids: ['sv05'], notes: 'Temporal Forces' },
        { thai_set_id: 'SV5K', thai_set_name: 'Barbaric Power', english_set_ids: ['sv05'], notes: 'Temporal Forces' },
        { thai_set_id: 'SV4a', thai_set_name: 'Shiny Treasure ex', english_set_ids: ['sv04.5'], notes: 'Paldean Fates' },
        { thai_set_id: 'SV4M', thai_set_name: 'Future Flash', english_set_ids: ['sv04'], notes: 'Paradox Rift' },
        { thai_set_id: 'SV4K', thai_set_name: 'Ancient Roar', english_set_ids: ['sv04'], notes: 'Paradox Rift' },
        { thai_set_id: 'SV3a', thai_set_name: 'Wave of Fury', english_set_ids: ['sv04'], notes: 'Thai SV3a also maps to Paradox Rift (jp sv3a was subsumed into en sv04)' },
        { thai_set_id: 'SV3', thai_set_name: 'King of the Black Flame', english_set_ids: ['sv03'], notes: 'Obsidian Flames' },
        { thai_set_id: 'SV2a', thai_set_name: 'Pokemon 151', english_set_ids: ['sv03.5'], notes: 'Pokemon 151' },
        { thai_set_id: 'SV2D', thai_set_name: 'Clay Burst', english_set_ids: ['sv02'], notes: 'Paldea Evolved' },
        { thai_set_id: 'SV2P', thai_set_name: 'Snow Hazard', english_set_ids: ['sv02'], notes: 'Paldea Evolved' },
        { thai_set_id: 'SV1a', thai_set_name: 'Triple Beat', english_set_ids: ['sv02'], notes: 'Thai SV1a also maps to Paldea Evolved (jp sv1a was in en sv02)' },
        { thai_set_id: 'SV1V', thai_set_name: 'Violet ex', english_set_ids: ['sv01'], notes: 'Scarlet & Violet base' },
        { thai_set_id: 'SV1S', thai_set_name: 'Scarlet ex', english_set_ids: ['sv01'], notes: 'Scarlet & Violet base' },
        // --- Mega Evolution sets (Thai/JP exclusive - no direct English equivalent) ---
        { thai_set_id: 'MA1', thai_set_name: 'Mega Evolution', english_set_ids: ['me01'], notes: 'Thai Mega Evolution set. Matches English me01 (Mega Evolution)' },
        { thai_set_id: 'MA2', thai_set_name: 'Azure Fire', english_set_ids: ['me02'], notes: 'Thai Azure Fire. Matches English me02 (Phantasmal Flames)' },
        { thai_set_id: 'MA3', thai_set_name: 'Mega Dream Evolution EX', english_set_ids: [], notes: 'Thai-exclusive. No English equivalent yet.' },
        // --- Sword & Shield Era ---
        { thai_set_id: 'S12a', thai_set_name: 'VSTAR Universe', english_set_ids: ['swsh12.5'], notes: 'Crown Zenith' },
        { thai_set_id: 'S12', thai_set_name: 'Paradigm Trigger', english_set_ids: ['swsh12'], notes: 'Silver Tempest' },
        { thai_set_id: 'S11a', thai_set_name: 'Incandescent Arcana', english_set_ids: ['swsh11'], notes: 'Lost Origin' },
        { thai_set_id: 'S11', thai_set_name: 'Lost Abyss', english_set_ids: ['swsh11'], notes: 'Lost Origin (Thai S11=Lost Abyss maps to EN Lost Origin)' },
        { thai_set_id: 'S10b', thai_set_name: 'Pokemon GO', english_set_ids: ['swsh10.5'], notes: 'Pokemon GO' },
        { thai_set_id: 'S10a', thai_set_name: 'Dark Phantasma', english_set_ids: ['swsh10'], notes: 'Astral Radiance' },
        { thai_set_id: 'S10P', thai_set_name: 'Space Juggler', english_set_ids: ['swsh10'], notes: 'Astral Radiance' },
        { thai_set_id: 'S10D', thai_set_name: 'Time Gazer', english_set_ids: ['swsh10'], notes: 'Astral Radiance' },
        { thai_set_id: 'S9a', thai_set_name: 'Battle Region', english_set_ids: ['swsh9'], notes: 'Brilliant Stars' },
        { thai_set_id: 'S9', thai_set_name: 'Star Birth', english_set_ids: ['swsh9'], notes: 'Brilliant Stars' },
        { thai_set_id: 'S8b', thai_set_name: 'VMAX Climax', english_set_ids: ['swsh12.5'], notes: 'Contains many cards spread across Crown Zenith and earlier sets. This is a best-effort mapping.' },
        { thai_set_id: 'S8a', thai_set_name: '25th Anniversary Collection', english_set_ids: ['cel25'], notes: 'Celebrations 25th Anniversary' },
        { thai_set_id: 'S8', thai_set_name: 'Fusion Arts', english_set_ids: ['swsh8'], notes: 'Fusion Strike' },
        { thai_set_id: 'S7D', thai_set_name: 'Skyscraping Perfection', english_set_ids: ['swsh7'], notes: 'Evolving Skies' },
        { thai_set_id: 'S7R', thai_set_name: 'Blue Sky', english_set_ids: ['swsh7'], notes: 'Evolving Skies' },
        { thai_set_id: 'S6a', thai_set_name: 'Eevee Heroes', english_set_ids: ['swsh7'], notes: 'Evolving Skies' },
        { thai_set_id: 'S6h', thai_set_name: 'Chilling Reign (snow)', english_set_ids: ['swsh6'], notes: 'Chilling Reign' },
        { thai_set_id: 's6k', thai_set_name: 'Chilling Reign (flame)', english_set_ids: ['swsh6'], notes: 'Chilling Reign' },
        { thai_set_id: 'S5a', thai_set_name: 'Peerless Fighters', english_set_ids: ['swsh5'], notes: 'Battle Styles' },
        { thai_set_id: 'S5I', thai_set_name: 'Single Strike Master', english_set_ids: ['swsh5'], notes: 'Battle Styles' },
        { thai_set_id: 'S5R', thai_set_name: 'Rapid Strike Master', english_set_ids: ['swsh5'], notes: 'Battle Styles' },
        { thai_set_id: 'SC3a', thai_set_name: 'Shiny VMAX Collection A', english_set_ids: ['swsh4.5'], notes: 'Shining Fates' },
        { thai_set_id: 'SC3b', thai_set_name: 'Shiny VMAX Collection B', english_set_ids: ['swsh4.5'], notes: 'Shining Fates' },
        { thai_set_id: 'SC1a', thai_set_name: 'Sword & Shield Set A', english_set_ids: ['swsh1'], notes: 'Sword & Shield base' },
        { thai_set_id: 'SC1b', thai_set_name: 'Sword & Shield Set B', english_set_ids: ['swsh1'], notes: 'Sword & Shield base' },
    ];

async function upsertSetBridge() {
    console.log('Upserting set_bridge mappings...');

    const rows: Array<any> = SET_BRIDGE.flatMap(entry =>
        entry.english_set_ids.length > 0
            ? entry.english_set_ids.map(enId => ({
                thai_set_id: entry.thai_set_id,
                english_set_id: enId,
                notes: entry.notes,
            }))
            : []
    );

    // Use the set_bridge table (create via SQL first if needed)
    const { data, error } = await supabase
        .from('set_bridge' as any)
        .upsert(rows, { onConflict: 'thai_set_id,english_set_id' })
        .select();

    if (error) {
        console.error('Error upserting set_bridge:', error.message);
        console.log('NOTE: You need to create the set_bridge table first. Run the SQL below in Supabase:');
        printCreateTableSQL();
        return false;
    }

    console.log(`✓ Upserted ${rows.length} set bridge mappings`);
    return true;
}

function printCreateTableSQL() {
    const sql = `
-- Run this in Supabase SQL editor:
CREATE TABLE IF NOT EXISTS set_bridge (
    id SERIAL PRIMARY KEY,
    thai_set_id TEXT NOT NULL,
    english_set_id TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(thai_set_id, english_set_id)
);

CREATE INDEX IF NOT EXISTS idx_set_bridge_thai ON set_bridge(thai_set_id);
CREATE INDEX IF NOT EXISTS idx_set_bridge_english ON set_bridge(english_set_id);
`;
    console.log('\n===== SUPABASE SQL =====');
    console.log(sql);
    console.log('========================\n');
}

printCreateTableSQL();
upsertSetBridge();
