import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const SETS = [
    { th: 'sv8a', en: 'sv8.5', slug: 'sv08.5-prismatic-evolutions-pokemon' },
    { th: 'sv8', en: 'sv8', slug: 'sv08-surging-sparks-pokemon' },
    { th: 'sv7a', en: 'sv7', slug: 'sv07-stellar-crown-pokemon' },
    { th: 'sv7', en: 'sv7', slug: 'sv07-stellar-crown-pokemon' },
    { th: 'sv6a', en: 'sv6.5', slug: 'sv06.5-shrouded-fable-pokemon' },
    { th: 'sv6', en: 'sv6', slug: 'sv06-twilight-masquerade-pokemon' },
    { th: 'sv5M', en: 'sv5', slug: 'sv05-temporal-forces-pokemon' },
    { th: 'sv5a', en: 'sv5', slug: 'sv05-temporal-forces-pokemon' },
    { th: 'sv5K', en: 'sv5', slug: 'sv05-temporal-forces-pokemon' },
    { th: 'sv4a', en: 'sv4.5', slug: 'sv04.5-paldean-fates-pokemon' },
    { th: 'sv4M', en: 'sv4', slug: 'sv04-paradox-rift-pokemon' },
    { th: 'sv4K', en: 'sv4', slug: 'sv04-paradox-rift-pokemon' },
    { th: 'sv3a', en: 'sv3.5', slug: 'sv03.5-151-pokemon' },
    { th: 'sv3', en: 'sv3', slug: 'sv03-obsidian-flames-pokemon' },
    { th: 'sv2a', en: 'sv2', slug: 'sv02-paldea-evolved-pokemon' },
    { th: 'sv2D', en: 'sv2', slug: 'sv02-paldea-evolved-pokemon' },
    { th: 'sv2P', en: 'sv2', slug: 'sv02-paldea-evolved-pokemon' },
    { th: 'sv1a', en: 'sv1', slug: 'sv01-scarlet-and-violet-base-set-pokemon' },
    { th: 'sv1V', en: 'sv1', slug: 'sv01-scarlet-and-violet-base-set-pokemon' },
    { th: 'sv1S', en: 'sv1', slug: 'sv01-scarlet-and-violet-base-set-pokemon' },
    { th: 'MA3', en: 'sv6', slug: 'sv06-twilight-masquerade-pokemon' },
    { th: 'MA4', en: 'sv7', slug: 'sv07-stellar-crown-pokemon' },
    { th: 'me02', en: 'me2', slug: 'me-ascended-heroes-pokemon' },
    { th: 'me02.5', en: 'me2', slug: 'me-ascended-heroes-pokemon' }
]

async function seed() {
    console.log("Seeding Set Metadata using PostgREST...")
    for (const s of SETS) {
        // Insert marketplace configs
        const { error: err1 } = await supabase.from('marketplace_configs').upsert({
            set_id: s.en,
            justtcg_slug: s.slug
        })
        if (err1) console.error("Error setting config for", s.en, err1)
        
        // Insert set bridges
        const { error: err2 } = await supabase.from('set_bridge').upsert({
            thai_set_id: s.th,
            english_set_id: s.en
        }, { onConflict: 'thai_set_id' })
        if (err2) console.error("Error setting bridge for", s.th, err2)
    }
    console.log("Done seeding Sets!")
}
seed()
