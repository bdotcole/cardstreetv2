/**
 * Live, read-only replay of the REAL catalog search
 * (services/pokemonService.ts searchCards) against production PostgREST.
 *
 * Run: npx tsx scripts/replay-search.ts [--out <dir>] [--baseline <results.json>] [--only <q1|q2>] </dev/null
 *
 * How it stays read-only:
 * - '@/lib/supabase/client' is swapped (CommonJS resolver hook below) for a
 *   supabase-js client with the ANON key from .env.local (searched upward
 *   from this file; surrounding quotes stripped, see CLAUDE.md).
 * - Its fetch refuses every non-GET request except the read-only typo RPC
 *   (search_cards_fuzzy_v2), so increment_search_popularity, the only write
 *   in the search path, never leaves the machine. `.rpc` is wrapped too, as a
 *   second guard.
 * - Requests still go through the real lib/supabase/sentryFetch.ts, with
 *   Sentry initialised to a dead DSN and a beforeSend that only counts, so a
 *   search that would raise a Sentry issue in production shows up here.
 *
 * Per query it records the top-30 language mix, whether the intended card is
 * there and its best rank, latency and the request count (the set list and
 * dictionary are warmed first, as they are once per session in the app).
 * Writes replay.json + replay.md to --out (default scripts/out/replay-search,
 * which is gitignored).
 */
import Module, { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as Sentry from '@sentry/nextjs';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Card } from '../types';

// ── Args, env ──

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(arg('--out') || path.join(ROOT, 'scripts', 'out', 'replay-search'));
const BASELINE = arg('--baseline');
const ONLY = arg('--only')?.split('|');

function findEnvFile(): string {
    for (let dir = ROOT; ; dir = path.dirname(dir)) {
        const p = path.join(dir, '.env.local');
        if (existsSync(p)) return p;
        if (path.dirname(dir) === dir) throw new Error('.env.local not found above ' + ROOT);
    }
}

function readEnv(file: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        env[m[1]] = v;
    }
    return env;
}

const env = readEnv(findEnvFile());
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing');

// ── Sentry: count, never send ──

const sentryEvents: Array<{ message: string; url?: string }> = [];
Sentry.init({
    dsn: 'https://public@o0.ingest.sentry.io/0',
    defaultIntegrations: false,
    beforeSend(event) {
        const ex = event.exception?.values?.[0];
        sentryEvents.push({ message: `${ex?.type || ''}: ${ex?.value || event.message || ''}`, url: (event.extra as { url?: string } | undefined)?.url });
        return null;
    },
} as Parameters<typeof Sentry.init>[0]);

// ── Recording, write-blocking client ──

interface Req { method: string; path: string; status: number; ms: number; blocked?: boolean; aborted?: boolean; url?: string }
let requests: Req[] = [];
const ALLOWED_POST = new Set(['rpc/search_cards_fuzzy_v2']);

const req = createRequire(path.join(ROOT, 'scripts', 'replay-search.ts'));
const { sentryFetch } = req('@/lib/supabase/sentryFetch') as typeof import('../lib/supabase/sentryFetch');

function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
    const abortError = () => new DOMException('This operation was aborted', 'AbortError');
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        p.then(
            (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
            (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
        );
    });
}

const recordingFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || 'GET').toUpperCase();
    const p = new URL(url).pathname.replace(/^\/rest\/v1\//, '');
    if (method !== 'GET' && method !== 'HEAD' && !(method === 'POST' && ALLOWED_POST.has(p))) {
        requests.push({ method, path: p, status: 204, ms: 0, blocked: true });
        return new Response(null, { status: 204 });
    }
    const t0 = performance.now();
    const rec: Req = { method, path: p, status: 0, ms: 0, url: decodeURIComponent(new URL(url).search) };
    requests.push(rec);
    try {
        const res = await sentryFetch(input, init);
        rec.status = res.status;
        rec.ms = Math.round(performance.now() - t0);
        if (!init?.signal) return res;
        // Node's fetch (undici, Node 22) never settles res.text() when the
        // signal aborts mid-body; browsers reject it with AbortError, as the
        // Fetch spec says. Read the body here under the browser's rule so an
        // abort test measures searchCards, not that Node bug.
        const body = await untilAborted(res.arrayBuffer(), init.signal);
        const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
        return new Response(nullBody ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (e) {
        rec.status = 0;
        rec.ms = Math.round(performance.now() - t0);
        rec.aborted = (e as Error)?.name === 'AbortError';
        throw e;
    }
};

const client: SupabaseClient = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
    global: { fetch: recordingFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const realRpc = client.rpc.bind(client);
(client as unknown as { rpc: unknown }).rpc = (fn: string, ...rest: unknown[]) => {
    if (fn === 'increment_search_popularity') {
        requests.push({ method: 'POST', path: `rpc/${fn}`, status: 204, ms: 0, blocked: true });
        return Promise.resolve({ data: null, error: null, status: 204 });
    }
    return (realRpc as (...a: unknown[]) => unknown)(fn, ...rest);
};

// Route '@/lib/supabase/client' to the client above. tsx runs this repo's .ts
// as CommonJS and resolves the '@/' alias by wrapping the same resolver, so
// wrapping it again here sees the request first.
const MOCK_ID = path.join(ROOT, 'lib', 'supabase', '__replay_client__.js');
const mock = new Module(MOCK_ID);
mock.filename = MOCK_ID;
mock.loaded = true;
mock.exports = { createClient: () => client };
const M = Module as unknown as {
    _cache: Record<string, unknown>;
    _resolveFilename: (request: string, ...rest: unknown[]) => string;
};
M._cache[MOCK_ID] = mock;
const origResolve = M._resolveFilename;
M._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request === '@/lib/supabase/client') return MOCK_ID;
    return origResolve.call(this, request, ...rest);
};

const { pokemonService } = req('@/services/pokemonService') as typeof import('../services/pokemonService');
const dictionaryMod = req('@/lib/search/dictionary') as typeof import('../lib/search/dictionary');
const { foldKey } = req('@/lib/search/normalize') as typeof import('../lib/search/normalize');
const { rootKey } = req('@/lib/search/score') as typeof import('../lib/search/score');

// ── Targets ──

type Target = (c: Card) => boolean;
const texts = (c: Card) => [c.name || '', c.thaiName || ''];
const rx = (en: RegExp, nat: RegExp): Target => (c) => texts(c).some(s => en.test(s)) || nat.test(c.name || '');

// Same regexes as the baseline replay (scratchpad baseline/replay.mjs), so the
// 44-query comparison is like for like.
const T: Record<string, Target> = {
    charizard: rx(/charizard/i, /リザードン|カリザード|ลิซาร์ดอน/),
    pikachu: rx(/pikachu/i, /ピカチュウ|พิคาชู/),
    gyarados: rx(/gyarados/i, /ギャラドス|เกียราดอส/),
    mewtwo: rx(/mewtwo/i, /ミュウツー|มิวทู/),
    lucario: rx(/lucario/i, /ルカリオ|ลูคาริโอ/),
    umbreonVmax: rx(/umbreon ?vmax/i, /ブラッキー ?VMAX|แบล็กกี ?VMAX/i),
    blastoise: rx(/blastoise/i, /カメックス|คาเม็กซ์/),
    eevee: rx(/eevee/i, /イーブイ|อีวุย/),
    dragonite: rx(/dragonite/i, /カイリュー|ドラゴナイト|ไคริว/),
    garchomp: rx(/garchomp/i, /ガブリアス|กาเบรียส/),
    rayquaza: rx(/rayquaza/i, /レックウザ|เร็คควอซา/),
    magikarp: rx(/magikarp/i, /コイキング|คอยคิง/),
    pikachuEx: rx(/pikachu[ -]?ex/i, /ピカチュウ ?ex|พิคาชู ?ex/i),
    charizardEx: rx(/charizard[ -]?ex/i, /リザードン ?ex|ลิซาร์ดอน ?ex/i),
    crobatEx: rx(/crobat[ -]?ex/i, /クロバット ?ex|โครแบท ?ex/i),
    raikouV: rx(/raikou[ -]?v\b(?!max|star)/i, /ライコウV(?!MAX|STAR)|ไรโค ?V(?!MAX|STAR)/i),
    alolanVulpix: rx(/alolan vulpix/i, /アローラ ?ロコン|อโลลา ?โรคอน/),
    vulpix: rx(/vulpix/i, /ロコン|โรคอน/),
    bewd: rx(/blue-?eyes white dragon/i, /青眼の白龍/),
    luffy: rx(/\bluffy/i, /ルフィ/),
    monkeyDLuffy: rx(/monkey\W*d\W*luffy/i, /モンキー・[DＤ]・ルフィ/),
    profResearch: rx(/professor'?s research/i, /博士の研究|งานวิจัยของศาสตราจารย์/),
    bossOrders: rx(/boss'?s orders/i, /ボスの指令|คำสั่งของบอส/),
    charmander: rx(/charmander/i, /ヒトカゲ|ฮิโตคาเงะ/),
};

let dict: import('../lib/search/dictionary').SearchDictionary | null = null;

// A print OF the species (root name equal to one of its names), not one that
// merely contains it: Mewtwo is not a Mew, リザードン not a リザード.
function species(en: string): Target {
    const g = dict!.groups.find(x => x.en === en);
    if (!g) throw new Error('no species ' + en);
    const keys = new Set([g.en, ...g.enDb, ...g.ja, ...g.th].map(foldKey));
    return (c) => texts(c).some(s => s && keys.has(rootKey(s)));
}
const numberIs = (n: number): Target => (c) => new RegExp(`^0*${n}/`).test(c.number || '');
const nameIs = (re: RegExp): Target => (c) => re.test(c.name || '');
const idIs = (re: RegExp): Target => (c) => re.test(c.id || '');
const both = (a: Target, b: Target): Target => (c) => a(c) && b(c);

interface Case {
    cls: string;
    q: string;
    key: string;
    language?: string;
    game?: string;
    target: () => Target | null;
}

const BASE_CASES: Array<[string, string, string]> = [
    ['EN typo', 'charizrd', 'charizard'], ['EN typo', 'chrizard', 'charizard'], ['EN typo', 'pikachoo', 'pikachu'],
    ['EN typo', 'gyrados', 'gyarados'], ['EN typo', 'mewto', 'mewtwo'], ['EN typo', 'lucareo', 'lucario'],
    ['EN typo', 'umbrion vmax', 'umbreonVmax'], ['EN typo', 'blastois', 'blastoise'], ['EN typo', 'evee', 'eevee'],
    ['EN typo', 'dragonight', 'dragonite'], ['EN typo', 'garchom', 'garchomp'], ['EN typo', 'rayqaza', 'rayquaza'],
    ['X-lang', 'magikarp', 'magikarp'], ['X-lang', 'koiking', 'magikarp'], ['X-lang', 'lizardon', 'charizard'],
    ['X-lang', 'hitokage', 'charmander'], ['X-lang', 'karpador', 'magikarp'], ['X-lang', 'magicarpe', 'magikarp'],
    ['X-lang', 'コイキング', 'magikarp'], ['X-lang', 'こいきんぐ', 'magikarp'], ['X-lang', 'ｺｲｷﾝｸﾞ', 'magikarp'],
    ['X-lang', 'คอยคิง', 'magikarp'], ['X-lang', 'ปิกาจู', 'pikachu'], ['X-lang', 'พิคาชู', 'pikachu'],
    ['X-lang', 'ลิซาดอน', 'charizard'], ['X-lang', 'ลิซาร์ดอน', 'charizard'], ['X-lang', '잉어킹', 'magikarp'],
    ['X-lang', '鲤鱼王', 'magikarp'], ['X-lang', 'pikachu ex', 'pikachuEx'], ['X-lang', 'リザードン ex', 'charizardEx'],
    ['X-lang', 'リザードンex', 'charizardEx'], ['X-lang', 'โครแบท ex', 'crobatEx'], ['X-lang', 'ไรโค v', 'raikouV'],
    ['X-lang', 'alolan vulpix', 'alolanVulpix'], ['X-lang', 'アローラロコン', 'alolanVulpix'], ['X-lang', 'ロコン', 'vulpix'],
    ['Non-PKM', 'blue eyes white dragn', 'bewd'], ['Non-PKM', 'blue-eyes white dragon', 'bewd'],
    ['Non-PKM', 'monkey d luffy', 'monkeyDLuffy'], ['Non-PKM', 'luffy', 'luffy'],
    ['Non-PKM', "professor's research", 'profResearch'], ['Non-PKM', '博士の研究', 'profResearch'],
    ['Non-PKM', "boss's orders", 'bossOrders'], ['Non-PKM', 'ボスの指令', 'bossOrders'],
];

const CASES: Case[] = [
    ...BASE_CASES.map(([cls, q, key]): Case => ({ cls, q, key, game: 'all', target: () => T[key] })),
    { cls: 'Regression', q: 'Mewtwo 51', key: 'mewtwo #51', game: 'all', target: () => both(T.mewtwo, numberIs(51)) },
    { cls: 'Regression', q: 'Pikachu #25', key: 'pikachu #25', game: 'all', target: () => both(T.pikachu, numberIs(25)) },
    { cls: 'Regression', q: 'Charizard 4/102', key: 'charizard #4', game: 'all', target: () => both(T.charizard, numberIs(4)) },
    { cls: 'Regression', q: 'Mega Evolution 3', key: 'me01 #3', game: 'all', target: () => (c) => /^me01-0*3$/.test(c.id) },
    { cls: 'Regression', q: 'Great Tusk 54', key: 'great tusk', game: 'all', target: () => species('Great Tusk') },
    { cls: 'Regression', q: 'pikachu', key: 'pikachu', game: 'all', target: () => T.pikachu },
    { cls: 'Regression', q: 'charizard', key: 'charizard', game: 'all', target: () => T.charizard },
    { cls: 'Regression', q: 'mew', key: 'mew (species)', game: 'all', target: () => species('Mew') },
    { cls: 'Regression', q: 'charmeleon', key: 'charmeleon (species)', game: 'all', target: () => species('Charmeleon') },
    { cls: 'Regression', q: 'cleffa', key: 'cleffa (species)', game: 'all', target: () => species('Cleffa') },
    { cls: 'Regression', q: 'ledian', key: 'ledian (species)', game: 'all', target: () => species('Ledian') },
    { cls: 'Regression', q: 'ลิซาร์ดอน', key: 'charizard', game: 'all', target: () => T.charizard },
    { cls: 'Regression', q: 'ピカチュウ', key: 'pikachu', game: 'all', target: () => T.pikachu },
    { cls: 'Regression', q: 'luffy', key: 'luffy', game: 'all', target: () => T.luffy },
    { cls: 'Regression', q: 'arceus', key: 'arceus (species)', game: 'all', target: () => species('Arceus') },
    { cls: 'Regression', q: 'booster box', key: '(none expected)', game: 'all', target: () => null },
    { cls: 'Regression', q: '162/130', key: '#162/130', game: 'all', target: () => (c) => /^0*162\/130$/.test(c.number || '') },
    { cls: 'Scanner', q: 'Pikachu', key: 'pikachu', language: 'ja', game: 'pokemon', target: () => T.pikachu },
    { cls: 'Scanner', q: 'Pikachu', key: 'pikachu', language: 'jp', game: 'pokemon', target: () => T.pikachu },
    { cls: 'Scanner', q: 'Charizard ex', key: 'charizardEx', language: 'th', game: 'pokemon', target: () => T.charizardEx },
    { cls: 'Scanner', q: 'Magikarp', key: 'magikarp', language: 'th', game: 'pokemon', target: () => T.magikarp },
    { cls: 'Scanner', q: 'Pikachu', key: 'pikachu', language: 'other', game: 'pokemon', target: () => T.pikachu },
    // Paths the battery above does not reach: the alias pass (non-Latin, not
    // in the dictionary), residual/modifier relaxation, exact set names,
    // phase-2 loose resolution, and words that must not turn into Pokémon.
    { cls: 'Extra', q: 'ルフィ', key: 'luffy', game: 'all', target: () => T.luffy },
    { cls: 'Extra', q: '青眼の白龍', key: 'bewd', game: 'all', target: () => T.bewd },
    { cls: 'Extra', q: 'blue eyes white dragon', key: 'bewd', game: 'all', target: () => T.bewd },
    { cls: 'Extra', q: 'professors research', key: 'profResearch', game: 'all', target: () => T.profResearch },
    { cls: 'Extra', q: 'boss orders', key: 'bossOrders', game: 'all', target: () => T.bossOrders },
    { cls: 'Extra', q: 'giratina origin', key: 'giratina (species)', game: 'all', target: () => species('Giratina') },
    { cls: 'Extra', q: "misty's magikarp", key: 'magikarp', game: 'all', target: () => T.magikarp },
    { cls: 'Extra', q: 'คอยคิงของคาซุมิ', key: 'magikarp', game: 'all', target: () => T.magikarp },
    { cls: 'Extra', q: 'พิคาชู jp ex', key: 'pikachuEx', game: 'all', target: () => T.pikachuEx },
    { cls: 'Extra', q: 'dito', key: 'ditto (species)', game: 'all', target: () => species('Ditto') },
    { cls: 'Extra', q: 'mr mime', key: 'mr. mime (species)', game: 'all', target: () => species('Mr. Mime') },
    { cls: 'Extra', q: 'farfetchd', key: "farfetch'd (species)", game: 'all', target: () => species("Farfetch'd") },
    { cls: 'Extra', q: 'deoxys', key: 'deoxys (species)', game: 'all', target: () => species('Deoxys') },
    { cls: 'Extra', q: 'detective pikachu', key: 'pikachu', game: 'all', target: () => T.pikachu },
    { cls: 'Extra', q: '151', key: '(set 151)', game: 'all', target: () => null },
    { cls: 'Extra', q: 'dark', key: '(Dark ... cards)', game: 'all', target: () => null },
    { cls: 'Extra', q: 'holo', key: '(no species)', game: 'all', target: () => null },
    { cls: 'Extra', q: 'sealed', key: '(no species)', game: 'all', target: () => null },
    { cls: 'Extra', q: 'การ์ด', key: '(no species)', game: 'all', target: () => null },
    { cls: 'Extra', q: 'pikachu', key: 'pikachu', language: 'th', game: 'pokemon', target: () => T.pikachu },
    { cls: 'Extra', q: 'luffy', key: 'luffy', game: 'onepiece', target: () => T.luffy },
    // Final-review regressions: words that are also rarity codes, mechanic
    // legs that matched the species' own letters, exact and partial set
    // names, Thai set codes, and listed prints behind an owner prefix.
    { cls: 'Review', q: 'ace trainer', key: 'Ace Trainer', game: 'all', target: () => nameIs(/^ace trainer$/i) },
    { cls: 'Review', q: 'sky striker ace', key: 'Sky Striker Ace', game: 'all', target: () => nameIs(/^sky striker ace\b/i) },
    { cls: 'Review', q: 'psychic ace', key: 'Psychic Ace', game: 'all', target: () => nameIs(/^psychic ace$/i) },
    { cls: 'Review', q: 'sir hiss', key: 'Sir Hiss', game: 'all', target: () => nameIs(/sir hiss/i) },
    { cls: 'Review', q: 'jungle', key: 'set base2', game: 'all', target: () => idIs(/^base2-/) },
    { cls: 'Review', q: 'fossil', key: 'set base3', game: 'all', target: () => idIs(/^base3-/) },
    { cls: 'Review', q: 'team rocket', key: 'set base5', game: 'all', target: () => idIs(/^base5-/) },
    { cls: 'Review', q: 'xy', key: 'set xy1', game: 'all', target: () => idIs(/^xy1-/) },
    { cls: 'Review', q: 'evolving skies', key: 'set swsh7', game: 'all', target: () => idIs(/^swsh7-/) },
    { cls: 'Review', q: 'evolving', key: 'set swsh7', game: 'all', target: () => idIs(/^swsh7-/) },
    { cls: 'Review', q: 'brilliant', key: 'set swsh9', game: 'all', target: () => idIs(/^swsh9-/) },
    { cls: 'Review', q: 'astral', key: 'set swsh10', game: 'all', target: () => idIs(/^swsh10-/) },
    // A word later in a set name is who the set is named after: the cards
    // named for it come first, not the deck's other cards.
    { cls: 'Review', q: 'pika', key: 'pikachu', game: 'all', target: () => T.pikachu },
    { cls: 'Review', q: 'MA3', key: 'set MA3', game: 'all', target: () => idIs(/^MA3-/) },
    { cls: 'Review', q: 'sv4a', key: 'set SV4a', game: 'all', target: () => idIs(/^SV4a-/i) },
    { cls: 'Review', q: 'เงามืดคุกคาม', key: 'set MA5', game: 'all', target: () => idIs(/^MA5-/) },
    { cls: 'Review', q: 'eevee v', key: 'Eevee V', game: 'all', target: () => rx(/eevee v\b(?!max|star|-union)/i, /イーブイV(?!MAX|STAR)|อีวุย ?V(?!MAX|STAR)/i) },
    { cls: 'Review', q: 'vulpix v', key: 'Vulpix V', game: 'all', target: () => rx(/vulpix v\b(?!max|star|-union)/i, /ロコンV(?!MAX|STAR)|โรคอน ?V(?!MAX|STAR)/i) },
    { cls: 'Review', q: 'mega mewtwo', key: 'Mega Mewtwo', game: 'all', target: () => rx(/^(?:mega|m) mewtwo/i, /メガミュウツー|เมก้ามิวทู/) },
    { cls: 'Review', q: 'zoro', key: "listed N's Zoroark ex", game: 'all', target: () => idIs(/^MA3-(?:112|242)$/) },
    { cls: 'Review', q: 'mewt', key: "listed Team Rocket's Mewtwo ex", game: 'all', target: () => idIs(/^MA3-063$/) },
    { cls: 'Review', q: 'char', key: 'charizard', game: 'all', target: () => T.charizard },
    { cls: 'Review', q: 'พิคาชู', key: 'pikachu', game: 'all', target: () => T.pikachu },
];

// ── Run ──

// Straight to PostgREST, not through the recording client, so it never counts
// as one of the search's own requests.
async function countListed(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const list = ids.map(id => `"${id.replace(/"/g, '')}"`).join(',');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=card_id&status=eq.active&card_id=in.(${encodeURIComponent(list)})`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) return -1;
    const rows = (await res.json()) as Array<{ card_id: string }>;
    return new Set(rows.map(r => r.card_id)).size;
}

const langMix = (cards: Card[]) => {
    const c: Record<string, number> = { en: 0, ja: 0, th: 0 };
    for (const x of cards) c[x.language || '?'] = (c[x.language || '?'] || 0) + 1;
    return `${c.en}/${c.ja}/${c.th}${Object.keys(c).length > 3 ? ' +' + Object.entries(c).filter(([k]) => !['en', 'ja', 'th'].includes(k)).map(([k, v]) => `${k}:${v}`).join(',') : ''}`;
};

const describe = (x: Card) => `${x.language}:${x.name}${x.thaiName ? ` [${x.thaiName}]` : ''} #${x.number}`;

function summarizeRequests(list: Req[]) {
    const counts: Record<string, number> = {};
    for (const r of list) {
        const k = r.blocked ? `blocked:${r.path}` : `${r.path.split('?')[0]}${r.status >= 400 || r.status === 0 ? `(${r.status})` : ''}`;
        counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
}

async function main() {
    // Warm what the app loads once per session: the dictionary (the browser
    // also builds the typo index in idle time) and the set list.
    dict = await dictionaryMod.loadSearchDictionary(0);
    if (!dict) throw new Error('dictionary failed to load');
    dictionaryMod.getFuzzyIndex(dict);
    requests = [];
    // A query outside the battery that resolves exactly (no phase 2), so the
    // first battery typo is the one that meets the typo RPC.
    await pokemonService.searchCards('eevee', false, undefined, 'all');
    const warmReqs = requests.length;

    const out: unknown[] = [];
    for (const c of CASES) {
        if (ONLY && !ONLY.includes(c.q)) continue;
        requests = [];
        const sentryBefore = sentryEvents.length;
        const t0 = performance.now();
        const cards = await pokemonService.searchCards(c.q, false, c.language, c.game || 'all');
        const ms = Math.round(performance.now() - t0);
        const target = c.target();
        const hits = target ? cards.filter(target) : [];
        const firstRank = target ? cards.findIndex(target) : -1;
        const sent = requests.filter(r => !r.blocked);
        // Prints a buyer can act on: a live listing among the results.
        const listed = await countListed(cards.map(x => x.id));
        const row = {
            cls: c.cls,
            q: c.q,
            language: c.language ?? null,
            game: c.game,
            key: c.key,
            ms,
            reqs: sent.length,
            blockedWrites: requests.filter(r => r.blocked).length,
            requests: summarizeRequests(requests),
            // The slow ones in full, to see which filter the database struggled with.
            slowRequests: requests.filter(r => r.ms >= 700).map(r => ({ path: r.path, ms: r.ms, status: r.status, query: (r.url || '').slice(0, 1500) })),
            requestMs: requests.filter(r => !r.blocked).map(r => `${r.path}:${r.ms}`),
            top: cards.length,
            topLang: langMix(cards),
            topTarget: target ? langMix(hits) : null,
            listed,
            offTarget: target ? cards.length - hits.length : null,
            firstTargetRank: firstRank < 0 ? null : firstRank + 1,
            top5: cards.slice(0, 5).map(describe),
            // What else made the list, with its rank: contamination shows here.
            offTargetRows: target
                ? cards.map((x, i) => ({ x, i })).filter(({ x }) => !target(x)).slice(0, 12).map(({ x, i }) => `${i + 1}. ${describe(x)}`)
                : cards.slice(0, 12).map((x, i) => `${i + 1}. ${describe(x)}`),
            sentry: sentryEvents.slice(sentryBefore),
        };
        out.push(row);
        console.log(`${c.cls}\t${c.q}${c.language ? '/' + c.language : ''}\ttop=${row.top} (${row.topLang})\ttarget=${row.topTarget} rank=${row.firstTargetRank}\tlisted=${row.listed}\t${ms}ms ${row.reqs} req\t${JSON.stringify(row.requests)}${row.sentry.length ? '\tSENTRY ' + JSON.stringify(row.sentry) : ''}`);
    }

    // Abort: a superseded query must stop between stages, return nothing, and
    // raise no Sentry event (DesktopNav aborts on every keystroke).
    const abortChecks: Array<Record<string, unknown>> = [];
    // Queries outside the battery, so no cache hit answers them early; delays
    // spread so the abort lands in different stages.
    const ABORTS: Array<[string, number]> = [
        ['mewtoo', 0], ['lucarioo', 5], ['gyaradoss', 20], ['garchompp', 40], ['rayquazza', 80],
        ['blastoisee', 150], ['umbreonn', 250], ['dragonitee', 400], ['koikingu', 700],
    ];
    for (const [q, delay] of ABORTS) {
        requests = [];
        const sentryBefore = sentryEvents.length;
        const ac = new AbortController();
        const t0 = performance.now();
        const p = pokemonService.searchCards(q, false, undefined, 'all', { signal: ac.signal });
        setTimeout(() => ac.abort(), delay);
        // A search that never settles after an abort would leave its caller
        // waiting forever; the guard timer also keeps Node from exiting quietly
        // on a promise nothing will resolve.
        let guard: ReturnType<typeof setTimeout> | undefined;
        const outcome = await Promise.race([
            p.then(cards => ({ returned: cards.length })),
            new Promise<{ hung: true }>(resolve => { guard = setTimeout(() => resolve({ hung: true }), 15000); }),
        ]);
        clearTimeout(guard);
        abortChecks.push({
            q, abortAfterMs: delay, ...outcome, ms: Math.round(performance.now() - t0),
            requests: summarizeRequests(requests), sentry: sentryEvents.slice(sentryBefore),
        });
    }
    for (const a of abortChecks) console.log('abort', JSON.stringify(a));

    // The card-request "did you mean" panel (findRequestCandidates): where
    // users land after a failed search, so typed names there are the misses.
    const REQUEST_CASES: Array<[string, string, string]> = [
        ['koiking', '', 'en'], ['ปิกาจู', '', 'th'], ['charizrd', '', ''], ['คอยคิงของคาซุมิ', '', 'th'],
        ['umbrion vmax', '', 'jp'], ['charizrd', '4/102', 'en'], ['พิคาชู', '049/067', 'th'],
    ];
    const requestCandidates: Array<Record<string, unknown>> = [];
    for (const [name, num, lang] of REQUEST_CASES) {
        requests = [];
        const t0 = performance.now();
        const cards = await pokemonService.findRequestCandidates(name, num, lang, 'pokemon');
        requestCandidates.push({
            name, number: num, language: lang, ms: Math.round(performance.now() - t0),
            requests: summarizeRequests(requests), candidates: cards.map(describe),
        });
    }
    for (const r of requestCandidates) console.log('request', JSON.stringify(r));

    // sentryFetch self-test, so "0 Sentry events" above is not vacuous: an
    // unrelated 404 (a table that does not exist, read-only GET) must still be
    // captured, and an aborted request must not be.
    const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
    const beforeSelfTest = sentryEvents.length;
    await sentryFetch(`${SUPABASE_URL}/rest/v1/__replay_no_such_table__?select=id`, { headers }).catch(() => undefined);
    const capturedUnrelated404 = sentryEvents.length - beforeSelfTest;
    const ac = new AbortController();
    const aborted = sentryFetch(`${SUPABASE_URL}/rest/v1/pokemon_cards?select=id&limit=1`, { headers, signal: ac.signal });
    ac.abort();
    await aborted.catch(() => undefined);
    const capturedAbort = sentryEvents.length - beforeSelfTest - capturedUnrelated404;
    const sentrySelfTest = { capturedUnrelated404, capturedAbort, ok: capturedUnrelated404 === 1 && capturedAbort === 0 };
    console.log('sentry self-test', JSON.stringify(sentrySelfTest));

    await Sentry.flush(2000);
    mkdirSync(OUT_DIR, { recursive: true });
    const result = {
        ranAt: new Date().toISOString(),
        warmupRequests: warmReqs,
        cases: out,
        abortChecks,
        requestCandidates,
        sentrySelfTest,
        // Events raised by the searches themselves (the self-test's are excluded).
        sentryEventsFromSearches: beforeSelfTest,
    };
    writeFileSync(path.join(OUT_DIR, 'replay.json'), JSON.stringify(result, null, 1));
    writeFileSync(path.join(OUT_DIR, 'replay.md'), renderMarkdown(out as RowOut[], BASELINE, result));
    console.log('wrote', OUT_DIR);
}

interface RowOut {
    cls: string; q: string; language: string | null; game?: string; key: string; ms: number; reqs: number;
    top: number; topLang: string; topTarget: string | null; listed: number; offTarget: number | null; firstTargetRank: number | null; top5: string[];
    sentry: unknown[];
}

function renderMarkdown(
    rows: RowOut[],
    baselinePath: string | undefined,
    extra: { abortChecks: Array<Record<string, unknown>>; sentrySelfTest: unknown; sentryEventsFromSearches: number },
): string {
    const base = new Map<string, { topTarget: string; firstTargetRank: number | null; ms: number; reqs: number; topLang: string }>();
    if (baselinePath && existsSync(baselinePath)) {
        for (const b of JSON.parse(readFileSync(baselinePath, 'utf8'))) base.set(b.q, b);
    }
    const sum = (s: string | null) => (s ? s.split(/[/ ]/).slice(0, 3).reduce((a, x) => a + (parseInt(x, 10) || 0), 0) : 0);
    const lines = [
        '| Class | Query | Top 30 (en/ja/th) | Target in top 30 | Best rank | Listed | Before: target / rank | ms (before) | Requests (before) |',
        '|---|---|---|---|---|---|---|---|---|',
    ];
    for (const r of rows) {
        const b = r.language || r.game !== 'all' ? undefined : base.get(r.q);
        lines.push(`| ${r.cls} | ${r.q}${r.language ? ` (lang ${r.language})` : ''}${r.game !== 'all' ? ` (game ${r.game})` : ''} | ${r.topLang} | ${r.topTarget ?? 'n/a'} | ${r.firstTargetRank ?? '-'} | ${r.listed} | ${b ? `${b.topTarget} / ${b.firstTargetRank ?? '-'}` : '-'} | ${r.ms}${b ? ` (${b.ms})` : ''} | ${r.reqs}${b ? ` (${b.reqs})` : ''} |`);
    }
    const withBase = rows.filter(r => !r.language && r.game === 'all' && r.cls !== 'Regression' && base.has(r.q));
    const improved = withBase.filter(r => sum(r.topTarget) > sum(base.get(r.q)!.topTarget)).length;
    const worse = withBase.filter(r => sum(r.topTarget) < sum(base.get(r.q)!.topTarget)).length;
    return [
        `Replay of searchCards, ${new Date().toISOString()}`,
        '',
        `Compared with baseline: ${withBase.length} queries; target count in top 30 up on ${improved}, down on ${worse}.`,
        '',
        ...lines,
        '',
        `Sentry events raised by the searches: ${extra.sentryEventsFromSearches}. Self-test: ${JSON.stringify(extra.sentrySelfTest)}`,
        '',
        'Abort checks:',
        '',
        ...extra.abortChecks.map(a =>
            `- ${a.q}: abort at ${a.abortAfterMs} ms -> ${a.hung ? 'HUNG' : `returned ${a.returned}`} in ${a.ms} ms, ${JSON.stringify(a.requests)}`),
        '',
    ].join('\n');
}

let finished = false;
// Node exits quietly (code 0) when the event loop drains under a promise
// nothing will settle; say so instead of looking like a clean run.
process.on('beforeExit', () => {
    if (!finished) {
        console.error('EXITED EARLY: event loop drained while main() was still pending');
        process.exitCode = 2;
    }
});
main().then(() => { finished = true; }, (e) => {
    console.error(e);
    process.exit(1);
});
