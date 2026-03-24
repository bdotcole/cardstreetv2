import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function check() {
  const { data: ma1 } = await supabase.from('thai_cards_matched')
    .select('card_number, english_name, thai_name, thai_rarity, en_set_id, en_number, en_name, en_rarity, match_method, confidence_score')
    .eq('thai_set_id', 'MA1')
    .in('card_number', ['240/193', '246/193', '223/193', '234/193', '250/193', '210/193'])
    .order('card_number')

  console.log("MA1 Checked Cards:")
  ma1?.forEach(c => {
    console.log(`TH: ${c.card_number} [${c.thai_rarity}] ${c.english_name}`)
    console.log(`EN: ${c.en_number} [${c.en_rarity}] ${c.en_name} (${c.en_set_id})`)
    console.log(`Method: ${c.match_method} Score: ${c.confidence_score}\n`)
  })
}
check()
