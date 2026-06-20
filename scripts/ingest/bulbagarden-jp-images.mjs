// Real Japanese card images for Japan-EXCLUSIVE sets from Bulbagarden Archives.
//
// TCGPlayer has no scan for some Japan-only cards (e.g. VS-series Pokemon),
// but Bulbagarden hosts the genuine Japanese scan under a constructible name:
//   File:<EnglishNameNoSpacesNoPossessive><SetToken><number>.jpg
//   e.g. "Janine's Arbok" #62 in VS  ->  File:JanineArbokVS62.jpg
// (Trainer/Technical-Machine cards are mostly absent upstream and stay imageless.)
//
//   node scripts/ingest/bulbagarden-jp-images.mjs --set=VS1 --token=VS [--dry]
//
// Only fills rows that are image-less AND already carry an english_name (filled
// by the JustTCG pricing pass). Idempotent. After committing, self-host via
// scripts/ingest/mirror-card-images.mjs --language=ja.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i < 0 || line.trim().startsWith('#')) continue;
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[k] = v;
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const ARC = 'https://archives.bulbagarden.net/w/api.php';
const H = { 'User-Agent': 'cardstreet-ingest/1.0' };

const DRY = !process.argv.includes('--commit');
const SET = (process.argv.find((a) => a.startsWith('--set=')) || '').replace('--set=', '');
const TOKEN = (process.argv.find((a) => a.startsWith('--token=')) || '').replace('--token=', '');

const numOf = (s) => { const m = String(s || '').match(/\d+/); return m ? parseInt(m[0], 10) : null; };
// "Janine's Arbok" -> "JanineArbok" (drop possessive 's, punctuation, spaces).
const cleanName = (en) => en.replace(/'s\b/gi, '').replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, '');

async function api(params) {
  const u = ARC + '?' + new URLSearchParams({ format: 'json', ...params });
  const r = await fetch(u, { headers: H });
  return r.json();
}

async function main() {
  if (!SET || !TOKEN) throw new Error('usage: --set=VS1 --token=VS');
  const { data, error } = await supabase
    .from('pokemon_cards').select('id, number, english_name, image_small')
    .eq('game', 'pokemon').eq('language', 'ja').eq('set_id', SET);
  if (error) throw error;
  const imageless = data.filter((c) => !(c.image_small && c.image_small.trim()) && c.english_name);
  console.log(`${SET}: ${imageless.length} image-less rows with english_name | mode ${DRY ? 'DRY' : 'COMMIT'}`);

  const cand = imageless.map((c) => ({ id: c.id, en: c.english_name, file: `File:${cleanName(c.english_name)}${TOKEN}${numOf(c.number)}.jpg` }));

  let filled = 0;
  for (let i = 0; i < cand.length; i += 25) {
    const batch = cand.slice(i, i + 25);
    const info = await api({ action: 'query', titles: batch.map((c) => c.file).join('|'), prop: 'imageinfo', iiprop: 'url' });
    const pages = info.query?.pages || {};
    const byTitle = {};
    for (const k in pages) byTitle[pages[k].title] = pages[k].imageinfo?.[0]?.url;
    for (const c of batch) {
      const url = byTitle[c.file];
      if (!url) continue;
      if (!DRY) {
        const { error: e } = await supabase.from('pokemon_cards').update({ image_small: url, image_large: url }).eq('id', c.id);
        if (e) throw e;
      }
      filled++;
      if (filled <= 10) console.log(`  ${DRY ? '[dry] ' : ''}${c.en} -> ${url.split('/').pop()}`);
    }
  }
  console.log(`${SET}: ${DRY ? 'would fill' : 'filled'} ${filled}/${cand.length} (rest absent on Bulbagarden)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
