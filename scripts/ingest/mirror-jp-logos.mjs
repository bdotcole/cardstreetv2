// Mirror JP set logos (currently hotlinked from Bulbapedia) into our own Supabase
// storage, because Bulbagarden blocks Vercel's image optimizer (next/image 502s).
// Serving from Supabase storage (already an allowlisted host) renders reliably.
//
//   node scripts/ingest/mirror-jp-logos.mjs

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
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL;
const supabase = createClient(SUPA, env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = 'listing-images';

async function main() {
  const { data: sets, error } = await supabase
    .from('pokemon_sets')
    .select('id, logo_url')
    .eq('game', 'pokemon').eq('language', 'ja')
    .like('logo_url', '%bulbagarden%');
  if (error) throw error;
  console.log(`mirroring ${sets.length} JP logos`);

  let ok = 0;
  for (const s of sets) {
    const r = await fetch(s.logo_url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) { console.log('skip', s.id, r.status); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const path = `jp-set-logos/${s.id}.png`;
    const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: 'image/png', upsert: true });
    if (up.error) { console.log('upload fail', s.id, up.error.message); continue; }
    const publicUrl = `${SUPA}/storage/v1/object/public/${BUCKET}/${path}`;
    const { error: ue } = await supabase.from('pokemon_sets').update({ logo_url: publicUrl, symbol_url: publicUrl }).eq('id', s.id);
    if (ue) { console.log('db fail', s.id, ue.message); continue; }
    ok++;
    console.log('mirrored', s.id);
  }
  console.log(`done: ${ok}/${sets.length} mirrored to Supabase storage`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
