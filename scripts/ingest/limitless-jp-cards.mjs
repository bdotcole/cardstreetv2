// Limitless TCG -> pokemon_sets/pokemon_cards ingestion for JAPANESE Pokemon sets,
// parsing the FULL CARD DETAIL off each card's page.
//
// NOT THE SAME AS ITS SIBLING. `limitless-jp-sets.mjs` also reads Limitless, but
// it takes only the number, the Japanese name and the supertype from there and
// leans on JustTCG for english_name + rarity. That is the right tool for a
// BACKLOG set (JustTCG has had years to index it). It is the wrong tool for a
// set released days ago: JustTCG has not indexed it yet, so rarity comes back
// empty. This script needs no second source -- rarity, HP, types, stage,
// attacks, abilities, weakness/resistance/retreat, illustrator and regulation
// mark all come off the card page itself. Use this one for NEW sets, that one
// for backfilling old ones.
//
// Why either exists: TCGdex, our usual ja source, trails the JP releases by
// roughly two months (M5 released 2026-05-22 and is present; M6 released
// 2026-07-31 and still 404s), and waiting that long leaves a live set out of the
// catalog. Once TCGdex catches up, prefer jp-modern-sets.mjs -- it reads a
// structured API instead of parsing HTML.
//
//   node scripts/ingest/limitless-jp-cards.mjs M6 --name=ストームエメラルダ \
//        --series=ポケモンカードゲーム MEGA --release=2026-07-31 \
//        --printed-total=76 --total=113
//   node scripts/ingest/limitless-jp-cards.mjs M6 --dry-run --limit=5
//
// Carried over from jp-modern-sets.mjs, both deliberate:
//
//   1. COLLISION GUARD. pokemon_sets.id is the PRIMARY KEY, so one set code can
//      hold exactly one language. Thai already owns bare codes like `M-P`,
//      `SV5M` and `SV1a`, and a plain upsert would OVERWRITE those Thai rows --
//      that is the incident that clobbered 19 Thai set rows during the ja name
//      backfill. Refuse to touch any id held by another language.
//
//   2. NO english_name. Filling it from the English twin is unsafe because the
//      English release renumbers, and a wrong mapping silently mislabels cards.
//      Leave it null; the twin backfill is a separate, verified step.
//
// SPECIFIC TO THIS SOURCE:
//
//   3. THE SET METADATA IS NOT DISCOVERABLE. Limitless renders the set name in
//      English ("Storm Emeralda") and its logo host 403s, so the Japanese name,
//      series, release date and card totals must be passed in. They are not
//      guessed -- a wrong `total` would misreport set completeness everywhere it
//      is displayed.
//
//   4. `total` IS THE TRUE SET SIZE, NOT WHAT WE INGESTED. Limitless publishes
//      the regular cards first and adds the secrets (SR/SAR/AR/MUR) later, so an
//      early run lands a partial set on purpose. Recording the real total means
//      the QC completeness check keeps flagging the set until the secrets land,
//      which is the point -- a `total` set to the partial count would look
//      complete and the missing chase cards would go unnoticed.
//
// Rerun is idempotent: rows upsert on their primary key, so a later sweep picks
// up the secrets without disturbing what is already there.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// --- env (.env.local), stripping surrounding quotes per CLAUDE.md gotcha -------
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

const SITE = 'https://limitlesstcg.com';
const CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc';
const UA = 'Mozilla/5.0 (compatible; CardStreetCatalog/1.0)';
const CONCURRENCY = 4;

const rawArgs = process.argv.slice(2);
const flags = {};
const positional = [];
for (const a of rawArgs) {
  if (a.startsWith('--')) {
    const [k, ...rest] = a.slice(2).split('=');
    flags[k] = rest.length ? rest.join('=') : true;
  } else if (positional.length === 0) {
    positional.push(a);
  } else {
    // `--series=ポケモンカードゲーム MEGA` arrives as two argv entries because the
    // value contains a space. Re-attach the tail to the last flag rather than
    // silently truncating the series to its first word.
    const lastFlag = Object.keys(flags).pop();
    if (lastFlag && typeof flags[lastFlag] === 'string') flags[lastFlag] += ` ${a}`;
    else positional.push(a);
  }
}

const SET_ID = positional[0];
const DRY_RUN = !!flags['dry-run'];
const LIMIT = parseInt(flags.limit ?? '0', 10) || Infinity;
// Limitless' CDN token is not always our set_id (it strips the hyphen from promo
// codes: our `M-P` lives at /tpc/MP/). Override when the two differ.
const CDN_SET = flags.cdn || SET_ID;

if (!SET_ID) {
  console.error('usage: node scripts/ingest/limitless-jp-cards.mjs <SET_ID> [--name=..] [--series=..] [--release=YYYY-MM-DD] [--printed-total=N] [--total=N] [--cdn=TOKEN] [--limit=N] [--dry-run]');
  process.exit(1);
}

const ENERGY = {
  G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic',
  F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy', C: 'Colorless', N: 'Dragon',
};

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
const strip = (s) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

/** Card numbers present on the set's grid page, in printed order. */
async function discoverNumbers(setId) {
  const html = await get(`${SITE}/cards/jp/${setId}`);
  const nums = [...html.matchAll(new RegExp(`/cards/jp/${setId}/(\\d+)"`, 'g'))].map((m) => parseInt(m[1], 10));
  return [...new Set(nums)].sort((a, b) => a - b);
}

function parseCard(html, setId, num) {
  const pick = (re) => { const m = html.match(re); return m ? m[1] : null; };

  const titleBlock = pick(/<p class="card-text-title">([\s\S]*?)<\/p>/) || '';
  const name = strip(pick(/<span class="card-text-name">\s*<a[^>]*>([\s\S]*?)<\/a>/) || '');
  if (!name) throw new Error('no card name');

  // Everything after the name span is " - <Type> - <HP> HP" for Pokemon, empty
  // for Trainers and Energy.
  const afterName = strip(titleBlock.replace(/<span class="card-text-name">[\s\S]*?<\/span>/, ''));
  const hpMatch = afterName.match(/(\d+)\s*HP/);
  const hp = hpMatch ? parseInt(hpMatch[1], 10) : null;
  const types = afterName
    .split('-')
    .map((s) => s.trim())
    .filter((s) => s && !/HP/.test(s) && /^[A-Za-z]+$/.test(s));

  // "Pokémon - Basic" / "Trainer - Supporter" / "Energy - Special"
  const typeLine = strip(pick(/<p class="card-text-type">([\s\S]*?)<\/p>/) || '');
  const typeParts = typeLine.split('-').map((s) => s.trim()).filter(Boolean);
  const supertype = typeParts[0] || null;
  const subtypes = typeParts.slice(1);

  const attacks = [];
  for (const m of html.matchAll(/<div class="card-text-attack">([\s\S]*?)<\/div>\s*(?=<div|<\/div>)/g)) {
    const block = m[1];
    const info = block.match(/<p class="card-text-attack-info">([\s\S]*?)<\/p>/);
    if (!info) continue;
    const symbols = (info[1].match(/<span class="ptcg-symbol">([^<]*)<\/span>/) || [, ''])[1].trim();
    const cost = [...symbols].map((c) => ENERGY[c]).filter(Boolean);
    const text = strip(info[1].replace(/<span class="ptcg-symbol">[\s\S]*?<\/span>/, ''));
    // Trailing damage: "10まんばりき 130", "スパイクドロー 20+", "つっぱり 30x"
    const dmg = text.match(/\s(\d+[+x×]?)$/);
    const effectM = block.match(/<p class="card-text-attack-effect">([\s\S]*?)<\/p>/);
    attacks.push({
      name: dmg ? text.slice(0, dmg.index).trim() : text,
      cost,
      convertedEnergyCost: cost.length,
      damage: dmg ? dmg[1] : '',
      text: effectM ? strip(effectM[1]) : '',
    });
  }

  const abilities = [];
  for (const m of html.matchAll(/<div class="card-text-ability">([\s\S]*?)<\/div>\s*(?=<div|<\/div>)/g)) {
    const block = m[1];
    const infoM = block.match(/<p class="card-text-ability-info">([\s\S]*?)<\/p>/);
    const effM = block.match(/<p class="card-text-ability-effect">([\s\S]*?)<\/p>/);
    if (!infoM) continue;
    abilities.push({
      name: strip(infoM[1]).replace(/^Ability:\s*/i, ''),
      text: effM ? strip(effM[1]) : '',
      type: 'Ability',
    });
  }

  const wrr = strip(pick(/<p class="card-text-wrr">([\s\S]*?)<\/p>/) || '');
  const wMatch = wrr.match(/Weakness:\s*([^\s]+(?:\s*[x×]\s*\d+)?)/);
  const rMatch = wrr.match(/Resistance:\s*([^\s]+)/);
  const retMatch = wrr.match(/Retreat:\s*(\d+)/);
  const weakType = wMatch && wMatch[1].toLowerCase() !== 'none' ? wMatch[1] : null;
  const resType = rMatch && rMatch[1].toLowerCase() !== 'none' ? rMatch[1] : null;

  const artist = strip(pick(/<div class="card-text-section card-text-artist">([\s\S]*?)<\/div>/) || '')
    .replace(/^Illustrated by\s*/i, '') || null;
  const regulation = (pick(/<div class="regulation-mark">([\s\S]*?)</) || '')
    .trim().match(/^([A-Z])\s+Regulation Mark/);
  // "#1 · Common" in the prints panel.
  const rarity = pick(/#\d+\s*&middot;\s*([^<\n]+)/) || pick(/#\d+\s*·\s*([^<\n]+)/);

  // Trainers and Energy carry their whole effect as loose text in the middle
  // section rather than as attacks; keep it so the card is not left blank.
  let rules = [];
  if (supertype && supertype !== 'Pokémon' && !attacks.length) {
    const sections = [...html.matchAll(/<div class="card-text-section">([\s\S]*?)<\/div>/g)];
    rules = sections
      // The first section is the name/type header, which is already stored in its
      // own columns -- keeping it here duplicated the card name into the rules text.
      .filter((s) => !/card-text-title|card-text-artist/.test(s[1]))
      .map((s) => strip(s[1]))
      .filter((t) => t && !/^Illustrated by/.test(t));
  }

  const padded = String(num).padStart(3, '0');
  return {
    id: `${setId}-${padded}`,
    name,
    english_name: null, // see header -- never from the renumbered EN release
    language: 'ja',
    game: 'pokemon',
    set_id: setId,
    number: padded,
    supertype,
    subtypes,
    rarity: rarity ? decode(rarity).trim() : null,
    hp,
    types,
    attacks: attacks.length ? attacks : null,
    weaknesses: weakType ? [{ type: weakType, value: 'x2' }] : null,
    resistances: resType ? [{ type: resType, value: '-30' }] : null,
    retreat_cost: retMatch ? Array(parseInt(retMatch[1], 10)).fill('Colorless') : [],
    abilities: abilities.length ? abilities : null,
    rules,
    regulation_mark: regulation ? regulation[1] : null,
    image_small: `${CDN}/${CDN_SET}/${CDN_SET}_${num}_R_JP_SM.png`,
    image_large: `${CDN}/${CDN_SET}/${CDN_SET}_${num}_R_JP_LG.png`,
    tcgplayer_url: null,
    cardmarket_url: null,
    raw_data: {
      source: 'limitlesstcg',
      url: `${SITE}/cards/jp/${setId}/${num}`,
      artist,
      localId: padded,
      set: { id: setId, name: flags.name || setId },
    },
  };
}

async function pool(items, size, worker) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out.push(await worker(items[idx]));
        process.stdout.write('.');
      } catch (e) {
        process.stdout.write('x');
        out.push({ __error: `#${items[idx]}: ${e.message}` });
      }
    }
  }));
  return out;
}

(async () => {
  console.log(`\n=== ${SET_ID} (limitlesstcg) ===`);

  // Collision guard -- see header. Checked before any write.
  const { data: existing, error: exErr } = await supabase
    .from('pokemon_sets').select('id, name, language').eq('id', SET_ID).maybeSingle();
  if (exErr) throw new Error(`collision check: ${exErr.message}`);
  if (existing && existing.language !== 'ja') {
    console.log(
      `SKIPPED: id "${SET_ID}" is already held by a ${existing.language} set ` +
      `("${existing.name}"). Overwriting it would destroy that row.`
    );
    process.exit(0);
  }

  const numbers = (await discoverNumbers(SET_ID)).slice(0, LIMIT);
  if (!numbers.length) throw new Error(`no cards found on ${SITE}/cards/jp/${SET_ID}`);
  console.log(`grid lists ${numbers.length} cards (#${numbers[0]}-#${numbers[numbers.length - 1]})`);

  const results = await pool(numbers, CONCURRENCY, async (n) =>
    parseCard(await get(`${SITE}/cards/jp/${SET_ID}/${n}`), SET_ID, n));
  console.log('');

  const errors = results.filter((r) => r.__error).map((r) => r.__error);
  const cards = results.filter((r) => !r.__error).sort((a, b) => a.number.localeCompare(b.number));
  if (errors.length) {
    console.log(`\n${errors.length} card(s) failed to parse:`);
    for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  }

  if (DRY_RUN) {
    console.log('\n(dry run -- no writes)');
    console.log(JSON.stringify(cards.slice(0, 3), null, 1));
    console.log(`\nwould upsert ${cards.length} cards`);
    return;
  }

  const setRow = {
    id: SET_ID,
    name: flags.name || SET_ID,
    series: flags.series || null,
    printed_total: parseInt(flags['printed-total'] ?? '0', 10) || cards.length,
    total: parseInt(flags.total ?? '0', 10) || cards.length,
    release_date: flags.release || null,
    symbol_url: null,
    logo_url: null, // mirror-jp-logos.mjs fills this; the Limitless logo host 403s
    game: 'pokemon',
    language: 'ja',
  };
  const { error: setErr } = await supabase.from('pokemon_sets').upsert([setRow], { onConflict: 'id' });
  if (setErr) throw new Error(`set upsert: ${setErr.message}`);
  console.log(`set row: ${setRow.name} | ${setRow.release_date} | printed ${setRow.printed_total} / total ${setRow.total}`);

  // PRESERVE MIRRORED ART. This script's whole re-run story (come back later for
  // the secrets) writes every card again, and a naive upsert would push all the
  // already-mirrored rows back onto the Limitless CDN -- silently undoing
  // mirror-card-images.mjs and re-exposing the catalog to an upstream outage.
  // Rows already on our bucket keep the URLs they have.
  const { data: priorRows, error: priorErr } = await supabase
    .from('pokemon_cards').select('id, image_small, image_large').eq('set_id', SET_ID);
  if (priorErr) throw new Error(`prior-image lookup: ${priorErr.message}`);
  const mirrored = new Map(
    (priorRows || [])
      .filter((r) => (r.image_small || '').includes('supabase.co'))
      .map((r) => [r.id, r])
  );
  let kept = 0;
  for (const c of cards) {
    const prior = mirrored.get(c.id);
    if (!prior) continue;
    c.image_small = prior.image_small;
    c.image_large = prior.image_large || prior.image_small;
    kept++;
  }
  if (kept) console.log(`kept mirrored art for ${kept} existing card(s)`);

  for (let j = 0; j < cards.length; j += 50) {
    const batch = cards.slice(j, j + 50);
    const { error } = await supabase.from('pokemon_cards').upsert(batch, { onConflict: 'id' });
    if (error) throw new Error(`card upsert: ${error.message}`);
  }
  console.log(`cards: ${cards.length} upserted`);
  if (cards.length < setRow.total) {
    console.log(`NOTE: ${setRow.total - cards.length} card(s) still missing (Limitless publishes secrets late). Re-run later to fill.`);
  }
})().catch((e) => {
  console.error('\nFailed:', e.message);
  process.exit(1);
});
