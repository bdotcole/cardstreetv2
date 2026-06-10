/**
 * Diagnostic — picks 5 random Thai cards from the catalog, runs them through
 * extractCardMetadata using Gemini 2.5 Pro, and prints what the model actually
 * returns so we can verify behaviour without UI in the loop.
 *
 * Usage:  node scripts/test-scan-thai.mjs [--n=5] [--language=th]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^=#]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    // Strip surrounding single or double quotes (dotenv spec — Next.js does this too).
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1].trim()] = v;
  }
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const N = parseInt(args.n ?? '5', 10);
const LANG = args.language ?? 'th';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function pickCards() {
  const { data, error } = await supabase
    .from('pokemon_cards')
    .select('id, name, english_name, set_id, number, language, image_large')
    .eq('language', LANG)
    .not('image_large', 'is', null)
    .limit(200);
  if (error) throw error;
  const shuffled = (data ?? []).sort(() => Math.random() - 0.5);
  return shuffled.slice(0, N);
}

async function fetchImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function extractCardMetadata(imageBuffer) {
  const meta = await sharp(imageBuffer).metadata();
  const fullJpeg = await sharp(imageBuffer).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const cropTop = Math.floor(meta.height * 0.78);
  const bottom = await sharp(imageBuffer)
    .extract({ left: 0, top: cropTop, width: meta.width, height: meta.height - cropTop })
    .jpeg({ quality: 92 })
    .toBuffer();

  const t0 = Date.now();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        parts: [
          { inlineData: { data: fullJpeg.toString('base64'), mimeType: 'image/jpeg' } },
          { inlineData: { data: bottom.toString('base64'), mimeType: 'image/jpeg' } },
          {
            text: `You are a Pokémon TCG identification expert. Two images are provided: the full card, then a magnified view of its bottom edge.

Extract the following fields. Be concise — values are short strings, not paragraphs.

- name: The Pokémon's name in English (canonical). Even on Thai or Japanese cards, return the standard English name (e.g. "Charizard ex", "Pikachu V").
- setCode: The short alphanumeric printed near the bottom corners. Examples: "MA3", "MA2", "SV5K", "SV4a", "sv4pt5", "swsh3", "PROMO", "s12a", "s9a". Maximum 10 characters. Preserve exact casing. Strip any trailing region marker like " T" (Thai) or " J" (Japanese). If unreadable, return null.
- cardNumber: As printed, usually digits with a forward slash. Examples: "087/198", "132/190", "14/214", "SV001". Maximum 12 characters. If unreadable, return null.
- language: How to decide — this is critical, do it carefully:
    Step 1: Look at the ATTACK BOX (middle of the card, where moves are described).
    Step 2: Is ANY non-Latin script visible there? Thai characters (e.g. ก ข ค ง จ ฉ พ ม ภ ภาษาไทย) or Japanese hiragana/katakana/kanji (e.g. の は を します ポケモン)?
    Step 3: If you see Thai script anywhere → "th". If you see hiragana/katakana/kanji → "ja". If only Latin/English → "en".
    Important: Pokémon NAMES are often shown in English on regional cards (a Thai card may still show "Charizard ex" in Latin). What matters is the BODY TEXT in the attack box. Do NOT decide based on the card name or set code alone.
- rarity: Best guess: "C", "U", "R", "RR", "RRR", "SR", "AR", "SAR", "UR", or similar.
- confidence: Overall 0.0 to 1.0.

Return JSON only. Keep values terse — single short string per field.`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          setCode: { type: Type.STRING },
          cardNumber: { type: Type.STRING },
          language: { type: Type.STRING, enum: ['en', 'th', 'ja'] },
          rarity: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
        },
      },
    },
  });
  const elapsedMs = Date.now() - t0;
  return { parsed: JSON.parse(response.text || '{}'), elapsedMs };
}

(async () => {
  console.log(`Picking ${N} ${LANG.toUpperCase()} cards...\n`);
  const cards = await pickCards();
  if (cards.length === 0) {
    console.error('No cards found in DB for that language.');
    process.exit(1);
  }

  for (const card of cards) {
    const expected = `${card.set_id} #${card.number} (${card.language}) — ${card.english_name || card.name}`;
    console.log('───────────────────────────────────────────────');
    console.log('EXPECTED:', expected);
    console.log('IMAGE:', card.image_large);
    try {
      const buf = await fetchImage(card.image_large);
      const { parsed, elapsedMs } = await extractCardMetadata(buf);
      const langOk = (parsed.language === 'ja' ? 'jp' : parsed.language) === card.language;
      // Strip language suffix (" T" Thai / " J" Japanese) before comparing.
      const normSet = (s) => (s || '').toLowerCase().replace(/\s+[tj]$/i, '').trim();
      const setOk = normSet(parsed.setCode) === normSet(card.set_id);
      const normNum = (s) => String(s || '').split('/')[0].replace(/[^0-9a-zA-Z]/g, '').replace(/^0+/, '');
      const numOk = normNum(parsed.cardNumber) === normNum(card.number);
      console.log(`GOT      : ${parsed.setCode || '?'} #${parsed.cardNumber || '?'} (${parsed.language || '?'}) — ${parsed.name || '?'}  [conf=${parsed.confidence ?? '?'}]`);
      console.log(`           lang ${langOk ? 'OK' : 'WRONG'} | set ${setOk ? 'OK' : 'WRONG'} | num ${numOk ? 'OK' : 'WRONG'} | ${elapsedMs}ms`);
    } catch (e) {
      console.log('FAILED:', e.message);
    }
  }
  console.log('───────────────────────────────────────────────');
})();
