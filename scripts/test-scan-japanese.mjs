/**
 * Diagnostic — end-to-end Japanese scan check.
 *
 * CLAUDE.md: "Don't ship scanner changes without running it." This is the JA
 * counterpart of test-scan-thai.mjs, extended past OCR into the catalog lookups,
 * because the Japanese failure was never in the model — Flash reads these cards
 * fine — it was that every lookup filtered `language='jp'` while the catalog
 * stores `'ja'`, so all ~24k Japanese rows were invisible to tiers 1/1b/1c and to
 * the language-filtered pHash tier.
 *
 * For each sampled card it runs the production Flash prompt, then replays the
 * lookup tiers twice: once with the pre-fix language code and once with the
 * normalized one, and reports whether the correct card id came back.
 *
 * Usage:  node scripts/test-scan-japanese.mjs [--n=10] [--game=pokemon]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([^=#]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const N = parseInt(args.n ?? '10', 10);
const GAME = args.game ?? 'pokemon';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Mirrors the fix in services/scannerService.ts.
const catalogLanguage = (l) => (!l || l === 'other' ? null : l === 'jp' ? 'ja' : l);

async function extractCardMetadata(imageBuffer) {
  const meta = await sharp(imageBuffer).metadata();
  const full = await sharp(imageBuffer).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const top = Math.floor(meta.height * 0.78);
  const bottom = await sharp(imageBuffer)
    .extract({ left: 0, top, width: meta.width, height: meta.height - top })
    .jpeg({ quality: 92 }).toBuffer();

  const t0 = Date.now();
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ parts: [
      { inlineData: { data: full.toString('base64'), mimeType: 'image/jpeg' } },
      { inlineData: { data: bottom.toString('base64'), mimeType: 'image/jpeg' } },
      { text: `You are a trading card identification expert. Two images are provided: the full card, then a magnified view of its bottom edge.

Extract these fields. Values are short strings, not paragraphs.

- name: The card's name in English (canonical). Even on Thai or Japanese cards, return the standard English name.
- setCode: The short alphanumeric printed near the bottom corners ("S12", "SV5K", "sv4pt5", "swsh3"). Max 10 chars, preserve casing. Strip a trailing region marker like " T"/" J". Null if unreadable.
- cardNumber: As printed, usually digits with a slash ("087/198", "014/172"). Max 12 chars. Null if unreadable.
- language: Look at the ATTACK BOX body text, not the name. Thai script -> "th". Hiragana/katakana/kanji -> "ja". Latin only -> "en".
- confidence: 0.0 to 1.0.

Return JSON only.` },
    ] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: { type: Type.OBJECT, properties: {
        name: { type: Type.STRING }, setCode: { type: Type.STRING }, cardNumber: { type: Type.STRING },
        language: { type: Type.STRING, enum: ['en', 'th', 'ja'] }, confidence: { type: Type.NUMBER },
      } },
    },
  });
  return { parsed: JSON.parse(res.text || '{}'), ms: Date.now() - t0 };
}

// --- the production lookup tiers, parameterised by language code ---
async function tier1(setCode, cardNumber, lang, game) {
  const cleanSet = (setCode || '').trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, '');
  const raw = (cardNumber || '').split('/')[0].replace(/[^a-zA-Z0-9]/g, '');
  if (!cleanSet || !raw) return [];
  const stripped = raw.replace(/^0+/, '') || raw;
  const numberOr = `number.eq.${raw},number.eq.${stripped},number.ilike.${raw}/%,number.ilike.${stripped}/%`;
  for (const apply of [(q) => q.ilike('set_id', cleanSet), (q) => q.ilike('set_id', `${cleanSet}%`), (q) => q.ilike('set_id', `%${cleanSet}`)]) {
    let q = apply(sb.from('pokemon_cards').select('id')).or(numberOr);
    if (lang) q = q.eq('language', lang);
    if (game) q = q.eq('game', game);
    const { data } = await q.limit(5);
    if (data?.length) return data;
  }
  return [];
}
async function tier1b(name, lang, cardNumber, game) {
  const clean = (name || '').replace(/[^a-zA-Z0-9 ]/g, '').trim();
  if (!clean || !lang) return [];
  let q = sb.from('pokemon_cards').select('id')
    .or(`name.ilike.%${clean}%,english_name.ilike.%${clean}%`).eq('language', lang);
  if (game) q = q.eq('game', game);
  if (cardNumber) {
    const n = cardNumber.split('/')[0].replace(/[^a-zA-Z0-9]/g, '');
    if (n) { const s = n.replace(/^0+/, '') || n; q = q.or(`number.eq.${n},number.eq.${s},number.ilike.${n}/%,number.ilike.${s}/%`); }
  }
  const { data } = await q.limit(10);
  return data ?? [];
}
async function tier1c(lang, cardNumber, game) {
  const n = (cardNumber || '').split('/')[0].replace(/[^a-zA-Z0-9]/g, '');
  if (!n || !lang) return [];
  const s = n.replace(/^0+/, '') || n;
  let q = sb.from('pokemon_cards').select('id').eq('language', lang)
    .or(`number.eq.${n},number.eq.${s},number.ilike.${n}/%,number.ilike.${s}/%`);
  if (game) q = q.eq('game', game);
  const { data } = await q.limit(20);
  return data ?? [];
}
async function phashTier(phash, lang, game) {
  const { data } = await sb.rpc('search_pokemon_by_phash', {
    query_phash: phash, max_distance: 20, result_limit: 10, language_filter: lang, game_filter: game,
  });
  return data ?? [];
}

async function runTiers(ocr, card, lang) {
  const hit = (rows) => rows.some((r) => r.id === card.id);
  const t1 = await tier1(ocr.setCode, ocr.cardNumber, lang, GAME);
  const t1b = await tier1b(ocr.name, lang, ocr.cardNumber, GAME);
  const t1c = await tier1c(lang, ocr.cardNumber, GAME);
  const tp = await phashTier(card.phash, lang, GAME);
  return {
    t1: `${t1.length}${t1.length && hit(t1) ? '*' : ''}`,
    t1b: `${t1b.length}${t1b.length && hit(t1b) ? '*' : ''}`,
    t1c: `${t1c.length}${t1c.length && hit(t1c) ? '*' : ''}`,
    ph: `${tp.length}${tp.length && hit(tp) ? '*' : ''}`,
    resolved: hit(t1) || hit(t1b) || hit(t1c) || hit(tp),
  };
}

(async () => {
  const { data } = await sb.from('pokemon_cards')
    .select('id, name, english_name, set_id, number, language, image_large, phash')
    .eq('language', 'ja').eq('game', GAME)
    .not('image_large', 'is', null).not('phash', 'is', null).limit(300);
  const cards = (data ?? []).sort(() => Math.random() - 0.5).slice(0, N);

  console.log(`End-to-end Japanese scan test — ${cards.length} random ja/${GAME} cards`);
  console.log(`"n*" = n rows returned and the CORRECT card was among them\n`);

  let beforeOk = 0, afterOk = 0, langOk = 0, setOk = 0, numOk = 0;
  for (const card of cards) {
    const label = `${card.set_id} #${card.number} ${card.english_name || card.name}`;
    try {
      const buf = Buffer.from(await (await fetch(card.image_large)).arrayBuffer());
      const { parsed, ms } = await extractCardMetadata(buf);
      // Production maps Flash's 'ja' onto its internal 'jp'; that is the value the
      // tiers used to receive verbatim.
      const internal = parsed.language === 'ja' ? 'jp' : parsed.language;
      const norm = (s) => (s || '').toLowerCase().replace(/\s+[tj]$/i, '').trim();
      const nn = (s) => String(s || '').split('/')[0].replace(/[^0-9a-z]/gi, '').replace(/^0+/, '');
      if (parsed.language === 'ja') langOk++;
      if (norm(parsed.setCode) === norm(card.set_id)) setOk++;
      if (nn(parsed.cardNumber) === nn(card.number)) numOk++;

      const before = await runTiers(parsed, card, internal);                    // 'jp'
      const after = await runTiers(parsed, card, catalogLanguage(internal));    // 'ja'
      if (before.resolved) beforeOk++;
      if (after.resolved) afterOk++;

      console.log(`${label}`);
      console.log(`  Flash: set=${parsed.setCode || '?'} num=${parsed.cardNumber || '?'} lang=${parsed.language || '?'} name=${parsed.name || '?'} (${ms}ms)`);
      console.log(`  BEFORE lang=${internal}: t1=${before.t1} t1b=${before.t1b} t1c=${before.t1c} phash=${before.ph}  => ${before.resolved ? 'FOUND' : 'MISS'}`);
      console.log(`  AFTER  lang=${catalogLanguage(internal)}: t1=${after.t1} t1b=${after.t1b} t1c=${after.t1c} phash=${after.ph}  => ${after.resolved ? 'FOUND' : 'MISS'}`);
    } catch (e) {
      console.log(`${label}\n  FAILED: ${e.message}`);
    }
  }
  console.log(`\n=== Flash OCR accuracy: lang ${langOk}/${cards.length}, set ${setOk}/${cards.length}, num ${numOk}/${cards.length}`);
  console.log(`=== Card resolved — BEFORE fix: ${beforeOk}/${cards.length}   AFTER fix: ${afterOk}/${cards.length}`);
})();
