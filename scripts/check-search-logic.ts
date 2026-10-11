/**
 * Assert-based checks for smart search (lib/search): normalization, query
 * analysis, dictionary build, phase-1/phase-2 resolution (including the
 * must-NOT-resolve words), ranking bands, the PostgREST predicate builder
 * (fuzzed: a malformed or() blanks search with HTTP 400, an empty pattern
 * matches every row) and the client-side filter.
 *
 * Run: npx tsx scripts/check-search-logic.ts [dictionary.json]
 * No network, no DB. Uses lib/search/data/pokemonNames.json; while that file
 * does not exist yet, pass a fixture path (or set SEARCH_DICT_FIXTURE).
 */
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { clipQuery, foldKey, looseKey, MAX_QUERY_CHARS, sanitizeTerm, scriptOf, tokenize, widthFold } from '@/lib/search/normalize';
import { buildSearchDictionary, getFuzzyIndex, type SearchDictionary } from '@/lib/search/dictionary';
import { analyzeQuery, resolveExact, resolveForFilter, resolveLoose } from '@/lib/search/resolve';
import { buildScoreContext, rootKey, scoreName } from '@/lib/search/score';
import {
    buildNamePredicate,
    CATALOG_COLUMNS,
    CATALOG_COLUMNS_NO_ENGLISH,
    encodedPredicateLength,
    LISTING_COLUMNS,
    PREDICATE_MAX_ENCODED,
    type NameColumns,
} from '@/lib/search/postgrestSearch';
import { cardMatchesQuery, prepareCardKeys, prepareQueryKeys } from '@/lib/search/clientMatch';
import type { Resolution, SearchDictionaryFile } from '@/lib/search/types';

let passed = 0;
function check(name: string, fn: () => void) {
    try {
        fn();
        passed++;
        console.log(`  ok  ${name}`);
    } catch (e) {
        console.error(`FAIL  ${name}`);
        throw e;
    }
}

// ── Dictionary source ──

const REAL = path.resolve(process.cwd(), 'lib/search/data/pokemonNames.json');
let dictPath = REAL;
if (process.env.SEARCH_DICT) {
    // Explicit override, e.g. to re-run the battery against a test fixture.
    dictPath = process.env.SEARCH_DICT;
    console.warn(`WARNING: SEARCH_DICT set; running against ${dictPath}`);
} else if (!existsSync(REAL)) {
    const fallback = process.argv[2] || process.env.SEARCH_DICT_FIXTURE;
    if (!fallback || !existsSync(fallback)) {
        console.error('lib/search/data/pokemonNames.json is missing; pass a fixture path or set SEARCH_DICT_FIXTURE.');
        process.exit(1);
    }
    console.warn(`WARNING: ${REAL} not found; running against the fixture ${fallback}`);
    dictPath = fallback;
}
const file = JSON.parse(readFileSync(dictPath, 'utf8')) as SearchDictionaryFile;
const t0 = performance.now();
const dict: SearchDictionary = buildSearchDictionary(file);
const buildMs = performance.now() - t0;

const dexes = (r: Resolution) => r.groups.map((g) => g.group.dex);
const modIds = (r: Resolution) => r.modifiers.map((m) => m.modifier.id).sort();

function resolveBoth(q: string): { phase: 0 | 1 | 2; r: Resolution } {
    const a = analyzeQuery(q);
    const r1 = resolveExact(dict, a);
    if (r1.groups.length > 0) return { phase: 1, r: r1 };
    const r2 = resolveLoose(dict, a);
    return { phase: r2.groups.length > 0 ? 2 : 0, r: r2 };
}

// ── normalize ──

check('foldKey: punctuation, case, width, kana, symbols', () => {
    assert.equal(foldKey('Mr. Mime'), 'mrmime');
    assert.equal(foldKey('mr mime'), 'mrmime');
    assert.equal(foldKey('こいきんぐ'), 'コイキング');
    assert.equal(foldKey('ｺｲｷﾝｸﾞ'), 'コイキング');
    assert.equal(foldKey('Nidoran♀'), 'nidoranf');
    assert.equal(foldKey('Pikachu δ'), 'pikachudelta');
    assert.equal(foldKey('Flabébé'), 'flabebe');
    assert.equal(foldKey('FlabÃ©bÃ©'), 'flabebe');
    assert.equal(foldKey('ลิซาร์ดอน ex'), foldKey('ลิซารดอนex'));
    assert.equal(foldKey('คอยคิ่ง'), foldKey('คอยคิง'));
    assert.equal(foldKey(''), '');
    assert.equal(foldKey(null), '');
});

check('looseKey merges Thai sound-alikes and doubled Latin letters', () => {
    assert.equal(looseKey('ปิกาจู'), looseKey('พิคาชู'));
    assert.equal(looseKey('dito'), looseKey('ditto'));
    assert.notEqual(looseKey('pikachu'), looseKey('raichu'));
});

check('sanitizeTerm: delimiters and wildcards, width-folded first', () => {
    assert.equal(sanitizeTerm('pika,chu'), 'pika chu');
    assert.equal(sanitizeTerm('pika，chu'), 'pika chu');
    assert.equal(sanitizeTerm('（デルタ種）'), 'デルタ種');
    assert.equal(sanitizeTerm('a%b*c_d\\e"f'), 'a b c d e f');
    assert.equal(sanitizeTerm('％＊'), '');
    assert.equal(sanitizeTerm('   '), '');
    // SARA AM must survive (the catalog stores it precomposed).
    assert.equal(widthFold('น้ำ'), 'น้ำ');
    assert.equal(sanitizeTerm('ดำ'), 'ดำ');
});

check('scriptOf and tokenize', () => {
    assert.equal(scriptOf(foldKey('Pikachu')), 'latin');
    assert.equal(scriptOf(foldKey('พิคาชู')), 'thai');
    assert.equal(scriptOf(foldKey('ピカチュウ')), 'kana');
    assert.equal(scriptOf(foldKey('잉어킹')), 'hangul');
    assert.equal(scriptOf(foldKey('鲤鱼王')), 'han');
    assert.deepEqual(tokenize('Monkey.D.Luffy'), ['Monkey', 'D', 'Luffy']);
    assert.deepEqual(tokenize("Farfetch'd ex"), ["Farfetch'd", 'ex']);
    assert.deepEqual(tokenize('Type: Null'), ['Type', 'Null']);
});

// ── analyzeQuery ──

check('analyzeQuery: language and rarity words become preferences', () => {
    const a = analyzeQuery('พิคาชู jp ex');
    assert.equal(a.nameText, 'พิคาชู ex');
    assert.deepEqual(a.languagePref, ['ja']);
    assert.deepEqual(a.tokens, ['พิคาชู', 'ex']);
    const b = analyzeQuery('เมก้าเก็คโคกะ sar');
    assert.equal(b.nameText, 'เมก้าเก็คโคกะ');
    assert.deepEqual(b.rarityPref, ['sar']);
    const c = analyzeQuery('Charizard ex ไทย');
    assert.deepEqual(c.languagePref, ['th']);
    assert.equal(c.nameText, 'Charizard ex');
    assert.equal(c.script, 'latin');
});

check('analyzeQuery: name words are never taken for rarity codes; fullText keeps the whole query', () => {
    // "ace" was a rarity token: "ace trainer" searched as "trainer".
    for (const q of ['ace trainer', 'sky striker ace', 'psychic ace', 'interface ace']) {
        const a = analyzeQuery(q);
        assert.equal(a.nameText, q, q);
        assert.deepEqual(a.rarityPref, [], q);
        assert.equal(a.fullText, q, q);
        assert.equal(a.fullKey, a.nameKey, q);
    }
    const s = analyzeQuery('sir hiss');
    assert.equal(s.nameText, 'hiss');
    assert.equal(s.fullText, 'sir hiss');
    assert.equal(s.fullKey, 'sirhiss');
    const p = analyzeQuery('พิคาชู  jp ex');
    assert.equal(p.fullText, 'พิคาชู jp ex');
    assert.equal(p.nameText, 'พิคาชู ex');
    assert.deepEqual(p.languagePref, ['ja']);
});

check('clipQuery: long input is cut to MAX_QUERY_CHARS code points, never mid-pair', () => {
    assert.equal(clipQuery('pikachu'), 'pikachu');
    assert.equal(clipQuery(null), '');
    assert.equal(Array.from(clipQuery('a'.repeat(5000))).length, MAX_QUERY_CHARS);
    const emoji = clipQuery('😀'.repeat(500));
    assert.equal(Array.from(emoji).length, MAX_QUERY_CHARS);
    assert.ok(!/[\uD800-\uDBFF]$/.test(emoji), 'split surrogate pair');
    const thai = clipQuery('คอยคิง'.repeat(100));
    assert.equal(Array.from(thai).length, MAX_QUERY_CHARS);
    // Everything downstream reads the clipped text.
    const a = analyzeQuery('charizrd '.repeat(2000));
    assert.ok(Array.from(a.raw).length <= MAX_QUERY_CHARS);
    assert.ok(a.tokens.length <= MAX_QUERY_CHARS / 2);
});

check('analyzeQuery: keeps punctuation, never strips everything', () => {
    assert.equal(analyzeQuery('  Mr.  Mime ').nameText, 'Mr. Mime');
    assert.equal(analyzeQuery('Mr. Mime').nameKey, 'mrmime');
    assert.equal(analyzeQuery('promo').nameText, 'promo');
    assert.equal(analyzeQuery('japanese').nameText, 'japanese');
    assert.equal(analyzeQuery('').nameKey, '');
});

// ── dictionary ──

check(`dictionary builds (${dict.groups.length} groups, ${buildMs.toFixed(1)} ms)`, () => {
    assert.ok(dict.groups.length >= 29);
    assert.deepEqual(dict.exact.get('magikarp')?.map((i) => dict.groups[i].dex), [129]);
    assert.deepEqual(dict.exact.get(foldKey('コイキング'))?.map((i) => dict.groups[i].dex), [129]);
    assert.deepEqual(dict.late.get('koiking')?.map((i) => dict.groups[i].dex), [129]);
    // romaji/fr/de words never reach the phase-1 index.
    assert.equal(dict.exact.get('koiking'), undefined);
});

check('dictionary: precomputed keys and recomputed keys agree', () => {
    const recomputed = buildSearchDictionary({ ...file, foldVersion: -1 });
    assert.equal(recomputed.groups.length, dict.groups.length);
    for (let i = 0; i < dict.groups.length; i++) assert.deepEqual(recomputed.keys[i], dict.keys[i], dict.groups[i].en);
});

check('dictionary: malformed rows are skipped, not fatal', () => {
    const broken = { v: 1, foldVersion: 1, built: '', groups: [null, [1], [25, 'Pikachu', null, ['ピカチュウ'], 'x', [], []]], keys: [] } as unknown as SearchDictionaryFile;
    const d = buildSearchDictionary(broken);
    assert.equal(d.groups.length, 1);
    assert.deepEqual(d.exact.get('ピカチュウ'), [0]);
    assert.equal(buildSearchDictionary({} as SearchDictionaryFile).groups.length, 0);
});

check('dictionary: DB-bound spellings are safe to send', () => {
    for (const g of dict.groups) {
        for (const s of [g.en, ...g.enDb, ...g.ja, ...g.th]) {
            assert.ok(s.length >= 2, `too short: ${s}`);
            assert.ok(!/[,()%*_\\"]/.test(s), `unsafe: ${s}`);
        }
    }
});

const tf = performance.now();
getFuzzyIndex(dict);
const fuzzyBuildMs = performance.now() - tf;

// ── resolution battery ──

interface Case {
    q: string;
    dex: number[];
    phase?: 1 | 2;
    mods?: string[];
    residual?: string[];
    langPref?: string[];
}

const POSITIVE: Case[] = [
    { q: 'koiking', dex: [129], phase: 2 },
    { q: 'karpador', dex: [129], phase: 2 },
    { q: 'magicarpe', dex: [129], phase: 2 },
    { q: 'magikarp', dex: [129], phase: 1 },
    { q: 'コイキング', dex: [129], phase: 1 },
    { q: 'こいきんぐ', dex: [129], phase: 1 },
    { q: 'ｺｲｷﾝｸﾞ', dex: [129], phase: 1 },
    { q: 'คอยคิง', dex: [129], phase: 1 },
    { q: '잉어킹', dex: [129], phase: 1 },
    { q: '鲤鱼王', dex: [129], phase: 1 },
    { q: 'ปิกาจู', dex: [25] },
    { q: 'charizrd', dex: [6], phase: 2 },
    { q: 'chrizard', dex: [6], phase: 2 },
    { q: 'pikachoo', dex: [25], phase: 2 },
    { q: 'gyrados', dex: [130], phase: 2 },
    { q: 'mewto', dex: [150], phase: 2 },
    { q: 'lucareo', dex: [448], phase: 2 },
    { q: 'umbrion vmax', dex: [197], phase: 2, mods: ['vmax'] },
    { q: 'rayqaza', dex: [384], phase: 2 },
    { q: 'ลิซาดอน', dex: [6] },
    { q: 'リザドン', dex: [6], phase: 2 },
    { q: 'mr mime', dex: [122], phase: 1 },
    { q: 'farfetchd', dex: [83], phase: 1 },
    { q: 'ho oh', dex: [250], phase: 1 },
    { q: 'type null', dex: [772], phase: 1 },
    { q: 'porygonz', dex: [474], phase: 1 },
    { q: 'nidoran f', dex: [29], phase: 1 },
    { q: 'nidoran m', dex: [32], phase: 1 },
    { q: 'alolan vulpix', dex: [37], phase: 1, mods: ['alolan'] },
    { q: 'アローラロコン', dex: [37], phase: 1, mods: ['alolan'] },
    { q: 'pikachu ex', dex: [25], phase: 1, mods: ['ex'] },
    { q: 'pikachuex', dex: [25], phase: 1, mods: ['ex'] },
    { q: 'リザードン ex', dex: [6], phase: 1, mods: ['ex'] },
    { q: 'リザードンex', dex: [6], phase: 1, mods: ['ex'] },
    { q: 'ไรโค v', dex: [243], phase: 1, mods: ['v'] },
    { q: 'ไรโคv', dex: [243], phase: 1, mods: ['v'] },
    { q: 'โครแบท ex', dex: [169], phase: 1, mods: ['ex'] },
    { q: "team rocket's mewtwo", dex: [150], phase: 1, mods: ['rocket'] },
    { q: 'มิวทู ex ของแก๊งร็อกเกต', dex: [150], phase: 1, mods: ['ex', 'rocket'] },
    { q: "misty's magikarp", dex: [129], phase: 1, residual: ['misty'] },
    { q: 'คอยคิงของคาซุมิ', dex: [129], phase: 1, residual: ['ของคาซุมิ'] },
    // The residual is cut back out of the typed text: a tone mark at the cut
    // stays with the name, and a peeled suffix is not part of it.
    { q: 'คอยคิ่งของคาซุมิ', dex: [129], phase: 1, residual: ['ของคาซุมิ'] },
    { q: 'คอยคิงของคาซุมิex', dex: [129], phase: 1, mods: ['ex'], residual: ['ของคาซุมิ'] },
    { q: 'カスミのコイキング', dex: [129], phase: 1, residual: ['カスミ'] },
    { q: 'พิคาชู jp ex', dex: [25], phase: 1, mods: ['ex'], langPref: ['ja'] },
    { q: 'dark gyarados', dex: [130], phase: 1, mods: ['dark'] },
    { q: 'เกียราดอสชั่วร้าย', dex: [130], phase: 1, mods: ['dark'] },
    { q: 'mega lucario ex', dex: [448], phase: 1, mods: ['ex', 'mega'] },
    { q: 'dito', dex: [132], phase: 2 },
    { q: 'charizrd ex', dex: [6], phase: 2, mods: ['ex'] },
    { q: 'ดิอัลกาดั้งเดิมVSTAR', dex: [483], phase: 2, mods: ['origin', 'vstar'] },
    { q: 'mew', dex: [151], phase: 1 },
    { q: 'charmeleon', dex: [5], phase: 1 },
    { q: 'darkrai', dex: [491], phase: 1 },
    { q: 'ダークライ', dex: [491], phase: 1 },
    // The catalog prints Japanese and Thai Mega names glued (メガルカリオex,
    // เมก้าลิซาร์ดอน X ex); メガヤンマ is still Yanmega, not Mega Yanma.
    { q: 'เมก้าลิซาร์ดอน', dex: [6], phase: 1, mods: ['mega'] },
    { q: 'เมก้าเก็งกาex', dex: [94], phase: 1, mods: ['ex', 'mega'] },
    { q: 'メガルカリオex', dex: [448], phase: 1, mods: ['ex', 'mega'] },
    { q: 'メガヤンマex', dex: [469], phase: 1, mods: ['ex'] },
    { q: 'メガメガニウムex', dex: [154], phase: 1, mods: ['ex', 'mega'] },
    { q: 'メガリザードンXex', dex: [6], phase: 1, mods: ['ex', 'mega'], residual: ['X'] },
    { q: 'เมก้าลิซาร์ดอนXex', dex: [6], phase: 1, mods: ['ex', 'mega'], residual: ['X'] },
    // "card" glued to a name is dropped, not ANDed in as a name fragment.
    { q: 'ピカチュウカード', dex: [25], phase: 1 },
    { q: 'ปิกาจูการ์ด', dex: [25], phase: 1 },
    { q: 'คาปู บูลูลูGX', dex: [787], phase: 1, mods: ['gx'] },
    // A modifier glued to the last word of a multi-word name.
    { q: 'โพรีกอน-แซดGX', dex: [474], phase: 1, mods: ['gx'] },
    { q: 'porygon z ex', dex: [474], phase: 1, mods: ['ex'] },
    // Romaji keeps typo tolerance once the query is long enough to be a name.
    { q: 'koikingu', dex: [129], phase: 2 },
];

const NEGATIVE = [
    'professor', 'dark', 'radiant', 'mega', 'star', 'rocket', 'energy', 'ball', 'booster', 'booster box', 'holo',
    'sleeve', 'sealed', 'trainer', 'fire', 'thunder', 'luffy', 'blue eyes white dragon', 'monkey d luffy', '151',
    'การ์ด', 'บอล', 'v', 'ex', 'radiant v', 'メガ', 'elite trainer box', 'pokemon center',
    // Found by the catalog-token sweep (scratch integ/sweep*.ts): ordinary
    // words that short prefixes, romaji typos, katakana compounds, loose kana
    // budgets or a mid-syllable Thai cut used to turn into species.
    'dragon', 'spirit', 'shield', 'giant', 'maiden', 'lizard', 'buggy', 'mummy', 'commander', 'alligator',
    'ブルーアイズ', 'ガーディアン', 'ゴーストリック', 'メガシグナル', 'ゾロ', 'デス', 'マジシャン', 'シャーロット',
    'โทโกะ', 'ฮิคาริ', 'วีการ์ดเอนเนอร์จี้',
];

const timings: Array<{ q: string; ms: number }> = [];
function timed(q: string): { phase: 0 | 1 | 2; r: Resolution } {
    const s = performance.now();
    const out = resolveBoth(q);
    timings.push({ q, ms: performance.now() - s });
    return out;
}

for (const c of POSITIVE) {
    check(`resolve "${c.q}" -> ${c.dex.join(',')}${c.mods ? ' + ' + c.mods.join(',') : ''}${c.phase ? ` (phase ${c.phase})` : ''}`, () => {
        const { phase, r } = timed(c.q);
        assert.deepEqual(dexes(r), c.dex, `got ${JSON.stringify(dexes(r))} phase ${phase}`);
        if (c.phase) assert.equal(phase, c.phase, 'phase');
        assert.deepEqual(modIds(r), (c.mods || []).slice().sort(), 'modifiers');
        if (c.residual) assert.deepEqual(r.residual, c.residual, 'residual');
        else assert.deepEqual(r.residual, [], 'residual');
        if (c.langPref) assert.deepEqual(analyzeQuery(c.q).languagePref, c.langPref);
    });
}

for (const q of NEGATIVE) {
    check(`resolve "${q}" -> nothing in either phase`, () => {
        const { r } = timed(q);
        assert.deepEqual(dexes(r), [], `got ${JSON.stringify(r.groups.map((g) => `${g.group.en}/${g.kind}/${g.matched}`))}`);
    });
}

check('resolveForFilter: exact + romaji/European exact only, never a guess', () => {
    assert.deepEqual(dexes(resolveForFilter(dict, 'magikarp')), [129]);
    assert.deepEqual(dexes(resolveForFilter(dict, 'koiking')), [129]);
    assert.deepEqual(dexes(resolveForFilter(dict, 'コイキング')), [129]);
    assert.deepEqual(dexes(resolveForFilter(dict, 'charizrd')), []);
    assert.deepEqual(dexes(resolveForFilter(dict, 'dito')), []);
    assert.deepEqual(dexes(resolveForFilter(dict, 'booster')), []);
    assert.deepEqual(dexes(resolveForFilter(dict, 'fire')), []);
    const r = resolveForFilter(dict, 'alolan vulpix');
    assert.deepEqual(dexes(r), [37]);
    assert.deepEqual(modIds(r), ['alolan']);
});

check('Toxapex-style names are never split into species + suffix', () => {
    for (const q of ['toxapex', 'calyrex', 'smoliv', 'dolliv']) {
        const r = resolveExact(dict, analyzeQuery(q));
        assert.ok(r.modifiers.length === 0, q);
    }
});

// ── scoring ──

check('rootKey strips separated suffixes and parentheticals only', () => {
    assert.equal(rootKey('Pikachu V'), 'pikachu');
    assert.equal(rootKey('Pikachu VMAX'), 'pikachu');
    assert.equal(rootKey('พิคาชูV'), foldKey('พิคาชู'));
    assert.equal(rootKey('リザードンex'), foldKey('リザードン'));
    assert.equal(rootKey('Charizard-GX'), 'charizard');
    assert.equal(rootKey('Magikarp (Master Ball Pattern)'), 'magikarp');
    assert.equal(rootKey('ジョルテオン（デルタ種）'), foldKey('ジョルテオン'));
    assert.equal(rootKey('Dialga LV.X'), 'dialga');
    assert.equal(rootKey('Toxapex'), 'toxapex');
    assert.equal(rootKey('Calyrex'), 'calyrex');
    assert.equal(rootKey('Smoliv'), 'smoliv');
    assert.equal(rootKey('Dolliv'), 'dolliv');
    assert.equal(rootKey('V'), 'v');
});

function score(q: string, row: { name: string; english_name?: string | null; language?: string; rarity?: string }, phase2 = false) {
    const a = analyzeQuery(q);
    let res = resolveExact(dict, a);
    if (phase2 && res.groups.length === 0) res = resolveLoose(dict, a);
    return scoreName(row, buildScoreContext(a, res));
}

check('scoring: Charmeleon beats Japanese Charizard for "charmeleon"', () => {
    const own = score('charmeleon', { name: 'リザード', language: 'ja' });
    const foreign = score('charmeleon', { name: 'リザードンex', language: 'ja' });
    const en = score('charmeleon', { name: 'Charmeleon', language: 'en' });
    assert.equal(own.band, 4);
    assert.equal(en.band, 4);
    assert.ok(foreign.band < 4, `charizard band ${foreign.band}`);
});

check('scoring: every Mew print outranks Mewtwo for "mew"', () => {
    const mew = score('mew', { name: 'Mew ex', language: 'en' });
    const mewJa = score('mew', { name: 'ミュウV', language: 'ja' });
    const mewtwo = score('mew', { name: 'Mewtwo', language: 'en' });
    assert.equal(mew.band, 4);
    assert.equal(mewJa.band, 4);
    assert.equal(mewtwo.band, 3);
});

check('scoring: modifiers compose across languages', () => {
    assert.equal(score('pikachu ex', { name: 'ピカチュウex', language: 'ja' }).band, 4);
    assert.equal(score('pikachu ex', { name: 'พิคาชู ex', language: 'th' }).band, 4);
    assert.equal(score('pikachu ex', { name: 'Pikachu ex', language: 'en' }).score, 100);
    assert.ok(score('pikachu ex', { name: 'Pikachu VMAX', language: 'en' }).band < 4);
    assert.equal(score('alolan vulpix', { name: 'อโลลา โรคอนV', language: 'th' }).band, 4);
    assert.equal(score('alolan vulpix', { name: 'アローラ ロコンVSTAR', language: 'ja' }).band, 4);
    assert.equal(score("team rocket's mewtwo", { name: "Team Rocket's Mewtwo ex", language: 'en' }).band, 4);
    assert.equal(score("team rocket's mewtwo", { name: 'มิวทู ex ของแก๊งร็อกเกต', language: 'th' }).band, 4);
    assert.equal(score("team rocket's mewtwo", { name: 'ロケット団のミュウツーex', language: 'ja' }).band, 4);
    assert.ok(score("team rocket's mewtwo", { name: 'Mewtwo', language: 'en' }).band < 4);
    assert.equal(score('dark gyarados', { name: 'เกียราดอสชั่วร้าย', language: 'th' }).band, 4);
    assert.equal(score('mega lucario', { name: 'เมก้าลูคาริโอ ex', language: 'th' }).band, 4);
});

check('scoring: residuals and guessed groups', () => {
    const misty = score("misty's magikarp", { name: 'คอยคิง ของคาซุมิ', english_name: "Misty's Magikarp", language: 'th' });
    assert.equal(misty.band, 4);
    const koiking = score('koiking', { name: "Misty's Magikarp", language: 'en' }, true);
    assert.equal(koiking.band, 1);
    const plain = score('koiking', { name: 'Magikarp', language: 'en' }, true);
    assert.equal(plain.band, 4);
    assert.ok(plain.score < 100, 'late matches are discounted');
});

check('scoring: same-script, language and rarity preferences', () => {
    const ja = score('ピカチュウ', { name: 'ピカチュウ', language: 'ja' });
    const en = score('ピカチュウ', { name: 'Pikachu', language: 'en' });
    assert.equal(ja.band, 4);
    assert.equal(en.band, 4);
    assert.ok(ja.score > en.score);
    const pref = score('พิคาชู jp ex', { name: 'ピカチュウex', language: 'ja' });
    const noPref = score('พิคาชู jp ex', { name: 'พิคาชูex', language: 'th' });
    assert.equal(pref.band, 4);
    assert.ok(pref.score >= noPref.score + 5);
    const sar = score('pikachu sar', { name: 'Pikachu ex', language: 'en', rarity: 'SAR' });
    const nonSar = score('pikachu sar', { name: 'Pikachu ex', language: 'en', rarity: 'RR' });
    assert.equal(sar.score - nonSar.score, 15);
});

check('scoring: literal prefix and token bands', () => {
    assert.equal(score('pikach', { name: 'Pikachu V', language: 'en' }).band, 3);
    assert.equal(score('blue eyes white dragon', { name: 'Blue-Eyes White Dragon', language: 'en' }).band, 4);
    assert.equal(score('professors research', { name: "Professor's Research", language: 'en' }).band, 4);
    assert.equal(score('research professor', { name: "Professor's Research", language: 'en' }).band, 2);
    assert.equal(score('luffy', { name: 'Monkey.D.Luffy', language: 'en' }).band, 1);
    assert.equal(score('zzz', { name: 'Pikachu', language: 'en' }).band, 0);
});

check('scoring: a name that IS the query outranks names merely starting with its last word', () => {
    // "ace trainer" once ranked Trainers' Mail (prefix of "trainer") above Ace Trainer.
    assert.equal(score('ace trainer', { name: 'Ace Trainer', language: 'en' }).band, 4);
    assert.ok(score('ace trainer', { name: "Trainers' Mail", language: 'en' }).band < 3);
    assert.equal(score('sky striker ace', { name: 'Sky Striker Ace', language: 'en' }).band, 4);
    assert.equal(score('sky striker ace', { name: 'Sky Striker Ace - Kagari', language: 'en' }).band, 3);
    assert.ok(score('sky striker ace', { name: 'Sky Striker Maneuver - Afterburners!', language: 'en' }).band < 3);
    // The whole query ranks too when a word in it was read as a rarity code.
    assert.equal(score('sir hiss', { name: 'Sir Hiss', language: 'en' }).band, 4);
});

check('scoring: a leading owner does not demote the name after it to "contains"', () => {
    // Listed "N's Zoroark ex" and "Team Rocket's Mewtwo ex" must reach the
    // as-you-type dropdown for "zoro" / "mewt", just under plain prefix hits.
    const n = score('zoro', { name: "N's Zoroark ex", language: 'en' });
    const plain = score('zoro', { name: 'Zoroark', language: 'en' });
    assert.equal(n.band, 3);
    assert.equal(plain.band, 3);
    assert.ok(n.score < plain.score);
    assert.equal(score('mewt', { name: "Team Rocket's Mewtwo ex", language: 'en' }).band, 3);
    assert.equal(score('mewt', { name: "Lt. Surge's Mewtwo", language: 'en' }).band, 3);
    // An owner never makes an exact hit: the plain print is what "zoroark" names.
    assert.equal(score('zoroark', { name: "N's Zoroark ex", language: 'en' }).band, 3);
    assert.equal(score('zoroark', { name: 'Zoroark ex', language: 'en' }).band, 4);
    // Only possessive words count as an owner.
    assert.ok(score('zoro', { name: 'Dark Zoroark', language: 'en' }).band < 3);
});

// ── predicate builder ──

function validatePredicate(pred: string) {
    let i = 0;
    const LEG = /^(name|english_name|game|card_data->>(name|thaiName|game))\.(ilike|eq|is)\.(.*)$/s;
    const parseItem = (): void => {
        const nested = /^(and|or)\(/.exec(pred.slice(i));
        if (nested) {
            i += nested[0].length;
            const n = parseList();
            assert.ok(n >= 2, `single-child ${nested[1]}() at ${i} in ${pred}`);
            assert.equal(pred[i], ')', `unclosed ${nested[1]}( in ${pred}`);
            i++;
            return;
        }
        let j = i;
        while (j < pred.length && pred[j] !== ',' && pred[j] !== ')') j++;
        const leg = pred.slice(i, j);
        assert.ok(!leg.includes('('), `paren inside leg "${leg}"`);
        const m = LEG.exec(leg);
        assert.ok(m, `bad leg "${leg}" in ${pred}`);
        const [, , , op, value] = m!;
        if (op === 'ilike') {
            // %t% (contains), t% (name start: ปี%, "M %") or %t (a short
            // mechanic printed last: %V, %ex), never a bare exact value.
            assert.ok(value.endsWith('%') || value.startsWith('%'), `pattern without a wildcard: "${leg}"`);
            if (!value.endsWith('%')) assert.ok(/^%[A-Za-z]{1,2}$/.test(value), `end-anchored leg that is not a short mechanic: "${leg}"`);
            assert.ok(!value.includes('%%'), `empty pattern: "${leg}"`);
            const inner = value.replace(/^%/, '').replace(/%$/, '');
            assert.ok(inner.trim().length > 0, `empty term: "${leg}"`);
            assert.ok(!/[,()%*_\\"]/.test(inner), `unsafe char in "${leg}"`);
            assert.ok(inner === inner.trimStart(), `leading space in "${leg}"`);
        } else if (op === 'eq') {
            assert.ok(value === 'pokemon' || value === '', `unexpected eq "${leg}"`);
        } else {
            assert.equal(value, 'null');
        }
        i = j;
    };
    const parseList = (): number => {
        let n = 0;
        for (;;) {
            parseItem();
            n++;
            if (pred[i] === ',') {
                i++;
                continue;
            }
            return n;
        }
    };
    assert.ok(pred.length > 0);
    parseList();
    assert.equal(i, pred.length, `trailing garbage at ${i} in ${pred}`);
    assert.ok(encodedPredicateLength(pred) <= 13000, 'over the URL limit');
}

const ALL_COLS: Array<[string, NameColumns]> = [
    ['catalog', CATALOG_COLUMNS],
    ['catalog-en', CATALOG_COLUMNS_NO_ENGLISH],
    ['listings', LISTING_COLUMNS],
];

function predFor(q: string, cols: NameColumns, phase2 = false, includeResidual = true) {
    const a = analyzeQuery(q);
    let res = resolveExact(dict, a);
    if (phase2 && res.groups.length === 0) res = resolveLoose(dict, a);
    // As searchCards calls it.
    return buildNamePredicate({ literal: a.nameText, fullLiteral: a.fullText, resolution: res, cols, includeResidual });
}

// ── Predicate evaluation (what PostgREST would match) ──

type PNode = { op: 'and' | 'or'; items: PNode[] } | { leg: string };

function parsePredicate(pred: string): PNode {
    let i = 0;
    const item = (): PNode => {
        const m = /^(and|or)\(/.exec(pred.slice(i));
        if (m) {
            i += m[0].length;
            const items = list();
            assert.equal(pred[i], ')', `unclosed ${m[1]}( in ${pred}`);
            i++;
            return { op: m[1] as 'and' | 'or', items };
        }
        let j = i;
        while (j < pred.length && pred[j] !== ',' && pred[j] !== ')') j++;
        const leg = pred.slice(i, j);
        i = j;
        return { leg };
    };
    const list = (): PNode[] => {
        const out = [item()];
        while (pred[i] === ',') {
            i++;
            out.push(item());
        }
        return out;
    };
    const items = list();
    assert.equal(i, pred.length, `trailing garbage in ${pred}`);
    // `.or(pred)`: the top level is an OR of its items.
    return { op: 'or', items };
}

type Row = { name: string; english_name?: string | null; game?: string | null };

const COLUMN_OF: Record<string, keyof Row> = {
    name: 'name', english_name: 'english_name', game: 'game',
    'card_data->>name': 'name', 'card_data->>thaiName': 'english_name', 'card_data->>game': 'game',
};

/** ILIKE as Postgres runs it: % is any run of characters, case-insensitive, whole value. */
function ilike(value: string | null | undefined, pattern: string): boolean {
    if (value == null) return false;
    const re = pattern.split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${re}$`, 'is').test(value);
}

function evalNode(n: PNode, row: Row): boolean {
    if ('leg' in n) {
        const m = /^(name|english_name|game|card_data->>(?:name|thaiName|game))\.(ilike|eq|is)\.(.*)$/s.exec(n.leg);
        assert.ok(m, `bad leg ${n.leg}`);
        const v = row[COLUMN_OF[m![1]]];
        if (m![2] === 'ilike') return ilike(v, m![3]);
        if (m![2] === 'eq') return (v ?? null) === m![3];
        return v == null;
    }
    return n.op === 'and' ? n.items.every((x) => evalNode(x, row)) : n.items.some((x) => evalNode(x, row));
}

/** Only the resolved-species alternative, as phase 2 fetches it (no literal legs). */
function speciesArmMatches(q: string, row: Row): boolean {
    const a = analyzeQuery(q);
    const res = resolveExact(dict, a);
    assert.ok(res.groups.length > 0, `"${q}" did not resolve`);
    const pred = buildNamePredicate({ literal: '', resolution: res, cols: CATALOG_COLUMNS });
    assert.ok(pred);
    return evalNode(parsePredicate(pred!), { english_name: null, game: 'pokemon', ...row });
}

check('predicate: literal only when nothing resolves', () => {
    assert.equal(predFor('zzzz', CATALOG_COLUMNS), 'name.ilike.%zzzz%,english_name.ilike.%zzzz%');
    assert.equal(predFor('zzzz', CATALOG_COLUMNS_NO_ENGLISH), 'name.ilike.%zzzz%');
    assert.equal(predFor('zzzz', LISTING_COLUMNS), 'card_data->>name.ilike.%zzzz%,card_data->>thaiName.ilike.%zzzz%');
});

check('predicate: token-AND for multi-word non-Pokémon names', () => {
    const p = predFor('monkey d luffy', CATALOG_COLUMNS)!;
    assert.ok(p.includes('and(or(name.ilike.%monkey%,english_name.ilike.%monkey%),or(name.ilike.%luffy%,english_name.ilike.%luffy%))'), p);
    const q = predFor('professors research', CATALOG_COLUMNS)!;
    assert.ok(q.includes('or(name.ilike.%professor%,english_name.ilike.%professor%)'), q);
    // Token-AND is redundant once a species resolved, and costs ~40% latency.
    assert.ok(!predFor('pikachu ex', CATALOG_COLUMNS)!.includes('and(or(name.ilike.%pikachu%'));
    // Two short words cannot drive the trigram index.
    assert.equal(predFor('mr ex', CATALOG_COLUMNS_NO_ENGLISH), 'name.ilike.%mr ex%');
});

check('predicate: species alternative shape', () => {
    const p = predFor('pikachu ex', CATALOG_COLUMNS)!;
    assert.ok(p.startsWith('name.ilike.%pikachu ex%,english_name.ilike.%pikachu ex%,and(game.eq.pokemon,or('), p);
    assert.ok(p.includes('and(english_name.is.null,name.ilike.%ピカチュウ%)'), p);
    assert.ok(p.includes('and(english_name.is.null,name.ilike.%พิคาชู%)'), p);
    // A short mechanic is anchored where the catalog prints it: last, or
    // before a space (an owner or a parenthetical follows).
    assert.ok(p.endsWith(',or(name.ilike.%ex,name.ilike.%ex %,english_name.ilike.%ex,english_name.ilike.%ex %))'), p);
    assert.ok(!p.includes('%ex%,'), p);
    const en = predFor('pikachu ex', CATALOG_COLUMNS_NO_ENGLISH)!;
    assert.ok(!en.includes('english_name'), en);
    const l = predFor('pikachu', LISTING_COLUMNS)!;
    assert.ok(l.includes('and(or(card_data->>game.eq.pokemon,card_data->>game.is.null),or(card_data->>name.ilike.%Pikachu%'), l);
    assert.ok(l.includes('and(or(card_data->>thaiName.is.null,card_data->>thaiName.eq.),card_data->>name.ilike.%พิคาชู%)'), l);
});

check('predicate: short mechanics must end the name, not hide inside the species', () => {
    // Every Eevee contains a "v" and every Toxapex an "ex": a %V% leg filtered
    // nothing, and the unordered LIMIT then dropped the real Eevee V prints.
    const yes: Array<[string, string, string | null]> = [
        ['eevee v', 'Eevee V', null],
        ['eevee v', 'อีวุยV', null],
        ['pikachu v', 'ピカチュウV', null],
        ['pikachu v', 'Pikachu V', null],
        ['pikachu ex', 'Pikachu-EX', null],
        ['pikachu ex', 'Pikachu ex', null],
        ['pikachu ex', 'พิคาชู ex ของแก๊งร็อกเกต', null],
        ['pikachu ex', 'ピカチュウex', 'Pikachu ex'],
        ['mewtwo ex', 'Mewtwo EX', null],
        ['mewtwo ex', 'Mewtwo-EX (Full Art)', null],
        ['mewtwo ex', 'มิวทูex ของแก๊งร็อกเกต', null],
        ['charizard ex', 'リザードンex', null],
        ['charizard ex', 'Mega Charizard X ex', null],
        ['charizard gx', 'Charizard-GX', null],
    ];
    for (const [q, name, english] of yes) assert.ok(speciesArmMatches(q, { name, english_name: english }), `"${q}" should match ${name}`);
    const no: Array<[string, string]> = [
        ['eevee v', 'Eevee'],
        ['eevee v', 'Eevee VMAX'],
        ['vulpix v', 'Vulpix'],
        ['pikachu v', 'Pikachu V-UNION'],
        ['pikachu v', 'Pikachu VSTAR'],
        ['pikachu ex', 'Pikachu'],
        ['pikachu ex', 'Pikachu V'],
        ['charizard ex', 'Charizard'],
    ];
    for (const [q, name] of no) assert.ok(!speciesArmMatches(q, { name }), `"${q}" should not match ${name}`);
    // Longer mechanics and other games keep plain containment.
    assert.ok(speciesArmMatches('umbreon vmax', { name: 'Umbreon VMAX (Alternate Art)' }));
    assert.ok(!speciesArmMatches('pikachu ex', { name: 'Pikachu ex', game: 'onepiece' }));
});

check('predicate: words taken out as language/rarity stay a literal of the whole query', () => {
    // "sir" is a rarity code, but "Sir Hiss" is a card name.
    const p = predFor('sir hiss', CATALOG_COLUMNS)!;
    assert.ok(p.includes('name.ilike.%hiss%') && p.includes('name.ilike.%sir hiss%'), p);
    assert.ok(evalNode(parsePredicate(p), { name: 'Sir Hiss' }));
    const ace = predFor('ace trainer', CATALOG_COLUMNS_NO_ENGLISH)!;
    assert.ok(ace.startsWith('name.ilike.%ace trainer%'), ace);
    assert.ok(evalNode(parsePredicate(ace), { name: 'Ace Trainer' }));
    // "jp" stays a preference: the species arm does not require it.
    const jp = predFor('พิคาชู jp ex', CATALOG_COLUMNS)!;
    assert.ok(evalNode(parsePredicate(jp), { name: 'ピカチュウex', english_name: 'Pikachu ex', game: 'pokemon' }), jp);
    assert.ok(evalNode(parsePredicate(jp), { name: 'พิคาชูex', game: 'pokemon' }), jp);
});

check('predicate: short native names are left-anchored, M-prefix keeps its space', () => {
    const p = predFor('cleffa', CATALOG_COLUMNS)!;
    assert.ok(p.includes('and(english_name.is.null,name.ilike.ปี%)'), p);
    assert.ok(p.includes('and(english_name.is.null,name.ilike.ピィ%)'), p);
    const m = predFor('mega charizard', CATALOG_COLUMNS)!;
    assert.ok(m.includes('name.ilike.M %'), m);
    assert.ok(m.includes('english_name.ilike.M %'), m);
});

check('predicate: residuals, owners, full-width spellings, hiragana', () => {
    const p = predFor("misty's magikarp", CATALOG_COLUMNS)!;
    assert.ok(p.endsWith(',or(name.ilike.%misty%,english_name.ilike.%misty%))'), p);
    const noRes = predFor("misty's magikarp", CATALOG_COLUMNS, false, false)!;
    assert.ok(!noRes.includes('%misty%,english_name.ilike.%misty%)'), noRes);
    const t = predFor('type null', CATALOG_COLUMNS)!;
    assert.ok(t.includes('name.ilike.%タイプ:ヌル%') && t.includes('name.ilike.%タイプ：ヌル%'), t);
    const h = predFor('こいきんぐ', CATALOG_COLUMNS)!;
    assert.ok(h.includes('name.ilike.%こいきんぐ%') && h.includes('name.ilike.%コイキング%'), h);
});

check('predicate: phase-2 group-only and nothing-searchable', () => {
    const a = analyzeQuery('koiking');
    const res = resolveLoose(dict, a);
    const g = buildNamePredicate({ literal: '', resolution: res, cols: CATALOG_COLUMNS })!;
    assert.ok(g.startsWith('and(game.eq.pokemon,or(name.ilike.%Magikarp%'), g);
    assert.equal(buildNamePredicate({ literal: '', resolution: null, cols: CATALOG_COLUMNS }), null);
    assert.equal(buildNamePredicate({ literal: '%%,()', resolution: null, cols: CATALOG_COLUMNS }), null);
    assert.equal(buildNamePredicate({ literal: ' ＊＿ ', resolution: null, cols: CATALOG_COLUMNS }), null);
});

check('predicate: size budget degrades aliases, never the canonical name', () => {
    const big = resolveExact(dict, analyzeQuery('pikachu charizard magikarp'));
    assert.equal(big.groups.length, 3);
    const longResidual = { ...big, residual: Array.from({ length: 40 }, (_, i) => `ของผู้ฝึกสอนคนที่${i}`) };
    const p = buildNamePredicate({ literal: 'pikachu charizard magikarp', resolution: longResidual, cols: CATALOG_COLUMNS })!;
    validatePredicate(p);
    assert.ok(encodedPredicateLength(p) <= PREDICATE_MAX_ENCODED, String(encodedPredicateLength(p)));
    assert.ok(p.includes('%Pikachu%'), 'first group keeps its English name');
});

// Deterministic PRNG so a failure reproduces.
function mulberry32(seed: number) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

check('predicate invariants hold over every dictionary term + random punctuation', () => {
    const rnd = mulberry32(20261003);
    const PUNCT = [',', '(', ')', '%', '*', '_', '\\', '"', '，', '（', '）', '％', '＊', '＿', '＂', '　', ' ', '.', ':', "'", '’', '&', '+', '-', '/', '#', '[', ']', '{', '}', 'の', 'ของ', 'ex', 'V', 'jp'];
    const terms: string[] = [];
    for (const g of dict.groups) terms.push(g.en, ...g.enDb, ...g.ja, ...g.th, ...g.aliases, ...g.late);
    terms.push('', ' ', '%', '%%', ',', '()', '*', '_', '\\', '"', '，（）', 'ex', 'v', 'jp', 'M ', '151', 'booster box');
    let count = 0;
    for (const term of terms) {
        const variants = [term];
        for (let k = 0; k < 2; k++) {
            let s = term;
            const inserts = 1 + Math.floor(rnd() * 3);
            for (let x = 0; x < inserts; x++) {
                const at = Math.floor(rnd() * (s.length + 1));
                s = s.slice(0, at) + PUNCT[Math.floor(rnd() * PUNCT.length)] + s.slice(at);
            }
            variants.push(s);
        }
        for (const v of variants) {
            const a = analyzeQuery(v);
            const exact = resolveExact(dict, a);
            // Phase 2 only ever runs when phase 1 found nothing, as in searchCards.
            const resolutions = [null, exact.groups.length > 0 ? exact : resolveLoose(dict, a)];
            const literals = v === a.nameText ? [v, ''] : [a.nameText, v, ''];
            for (const res of resolutions) {
                for (const [, cols] of ALL_COLS) {
                    for (const literal of literals) {
                        for (const includeResidual of res && res.residual.length > 0 ? [true, false] : [true]) {
                            const fullLiteral = literal === a.nameText ? a.fullText : undefined;
                            const p = buildNamePredicate({ literal, fullLiteral, resolution: res, cols, includeResidual });
                            count++;
                            if (p === null) {
                                assert.ok(!sanitizeTerm(literal) && !(res && res.groups.length), `null predicate for "${literal}"`);
                                continue;
                            }
                            validatePredicate(p);
                        }
                    }
                }
            }
        }
    }
    console.log(`        (${count} predicates validated)`);
});

// ── client filter ──

check('client filter: literal, words, species in any language, modifiers', () => {
    const filter = (query: string, card: Parameters<typeof prepareCardKeys>[0]) =>
        cardMatchesQuery(prepareCardKeys(card), prepareQueryKeys(query), resolveForFilter(dict, query));
    assert.ok(filter('pikachu ex', { name: 'ピカチュウex', thaiName: 'Pikachu ex' }));
    assert.ok(filter('magikarp', { name: 'コイキング' }));
    assert.ok(filter('koiking', { name: 'คอยคิง' }));
    assert.ok(filter('コイキング', { name: 'Magikarp', set: { name: 'Base Set' } }));
    assert.ok(!filter('charizard', { name: 'コイキング' }));
    assert.ok(!filter('charizrd', { name: 'リザードン' }), 'no typo guessing in filters');
    assert.ok(filter('pikachu ex', { name: 'พิคาชูex' }));
    assert.ok(!filter('pikachu ex', { name: 'พิคาชูV' }));
    assert.ok(filter('cleffa', { name: 'ピィ' }));
    assert.ok(!filter('cleffa', { name: 'เปี่ยมพลัง' }), 'short native names must start the name');
    assert.ok(filter('pikachu sv4a', { name: 'Pikachu', set: 'SV4a', number: '001' }));
    assert.ok(filter('001/190', { name: 'Pikachu', number: '001/190' }));
    assert.ok(filter('', { name: 'anything' }));
    assert.ok(cardMatchesQuery(prepareCardKeys({ name: 'Pikachu' }), prepareQueryKeys('pika'), null));
    // Residuals are required, as in the catalog predicate.
    assert.ok(filter("misty's magikarp", { name: "Misty's Magikarp" }));
    assert.ok(filter("misty's magikarp", { name: 'คอยคิง ของคาซุมิ', thaiName: "Misty's Magikarp" }));
    assert.ok(!filter("misty's magikarp", { name: 'Magikarp' }));
    // A half-typed Thai name (Kingambit, โดโดเกซัน) must not show every Doduo (โดโด).
    assert.ok(filter('โดโดเกซั', { name: 'โดโดเกซัน' }));
    assert.ok(!filter('โดโดเกซั', { name: 'โดโด' }));
});

check('client filter: numbers never match across the slash', () => {
    const filter = (query: string, card: Parameters<typeof prepareCardKeys>[0]) =>
        cardMatchesQuery(prepareCardKeys(card), prepareQueryKeys(query), resolveForFilter(dict, query));
    // "004/102" used to fold to "004102", so "41" and "151" matched across the slash.
    assert.ok(!filter('41', { name: 'Charmander', number: '004/102' }));
    assert.ok(!filter('151', { name: 'Charmander', number: '015/165' }));
    assert.ok(!filter('41', { name: 'Charmander', number: '014/193' }));
    assert.ok(filter('41', { name: 'Charmander', number: '041/193' }));
    assert.ok(filter('004/102', { name: 'Charmander', number: '004/102' }));
    assert.ok(filter('102', { name: 'Charmander', number: '004/102' }));
    // A number word next to a name must be a whole part of the card number.
    assert.ok(filter('charizard 4', { name: 'Charizard', number: '4/102' }));
    assert.ok(!filter('charizard 4', { name: 'Charizard', number: '14/102' }));
});

check('client filter: mechanics and forms must be in their place, not just somewhere', () => {
    const filter = (query: string, card: Parameters<typeof prepareCardKeys>[0]) =>
        cardMatchesQuery(prepareCardKeys(card), prepareQueryKeys(query), resolveForFilter(dict, query));
    // "m" is in Mewtwo and "v" in Vulpix and Eevee: those used to satisfy the modifier.
    assert.ok(!filter('mega mewtwo', { name: 'Mewtwo' }));
    assert.ok(!filter('mega mewtwo', { name: 'Mewtwo ex' }));
    assert.ok(filter('mega mewtwo', { name: 'M Mewtwo-EX' }));
    assert.ok(filter('mega mewtwo', { name: 'Mega Mewtwo ex' }));
    assert.ok(filter('mega mewtwo', { name: 'メガミュウツーex' }));
    assert.ok(!filter('vulpix v', { name: 'Vulpix' }));
    assert.ok(filter('vulpix v', { name: 'Vulpix V' }));
    assert.ok(filter('vulpix v', { name: 'Alolan Vulpix V' }));
    assert.ok(filter('vulpix v', { name: 'ロコンV' }));
    assert.ok(!filter('eevee v', { name: 'Eevee' }));
    assert.ok(filter('eevee v', { name: 'อีวุยV' }));
    assert.ok(!filter('toxapex ex', { name: 'Toxapex' }));
    assert.ok(filter('alolan vulpix', { name: 'アローラ ロコン' }));
    assert.ok(!filter('alolan vulpix', { name: 'ロコン' }));
    assert.ok(filter("team rocket's mewtwo", { name: 'มิวทู ex ของแก๊งร็อกเกต' }));
    assert.ok(!filter("team rocket's mewtwo", { name: 'มิวทู ex' }));
});

check('filters do not jump to a romaji/European name while a real name is half-typed', () => {
    // "ratta" is Raticate's romaji, "melo" Cleffa in French, "arbo" Ekans in
    // romaji; each is also the start of Rattata, Meloetta, Arbok.
    for (const q of ['ratta', 'melo', 'arbo', 'araqua']) assert.deepEqual(dexes(resolveForFilter(dict, q)), [], q);
    assert.deepEqual(dexes(resolveForFilter(dict, 'lizardon')), [6]);
});

// ── speed ──

check('pasted text costs about what a typed query does', () => {
    // GET /api/listings resolves whatever ?search= holds, for anyone: 13 KB of
    // repeated words cost ~1 s of CPU, and a long glued kana/Thai token
    // re-folded every prefix of itself (rawSlice).
    const pasted = [
        'charizrd '.repeat(1500),
        'pikachuex'.repeat(1500),
        'qwertyuiop '.repeat(1300),
        'コイキング' + 'ア'.repeat(1500),
        'คอยคิง' + 'ก'.repeat(1500),
        'คอยคิงของคาซุมิ'.repeat(100),
        'คอยคิง' + 'ก'.repeat(110),
    ];
    let slowest = 0;
    for (const q of pasted) {
        const s = performance.now();
        resolveForFilter(dict, q);
        resolveBoth(q);
        const ms = performance.now() - s;
        slowest = Math.max(slowest, ms);
        assert.ok(ms < 40, `${q.slice(0, 20)}... took ${ms.toFixed(1)} ms`);
    }
    console.log(`        slowest pasted input: ${slowest.toFixed(2)} ms (filter + phase 1 + phase 2)`);
    // Within the cap, a long Thai leftover is still cut back out intact.
    const r = resolveExact(dict, analyzeQuery('คอยคิง' + 'ก'.repeat(100)));
    assert.deepEqual(dexes(r), [129]);
    assert.deepEqual(r.residual, ['ก'.repeat(100)]);
});

check('resolution speed (after the lazy index build)', () => {
    const queries = [...POSITIVE.map((c) => c.q), ...NEGATIVE];
    const per: Array<{ q: string; ms: number }> = [];
    for (const q of queries) {
        const s = performance.now();
        for (let k = 0; k < 20; k++) resolveBoth(q);
        per.push({ q, ms: (performance.now() - s) / 20 });
    }
    const avg = per.reduce((s, p) => s + p.ms, 0) / per.length;
    console.log(`        index build: exact ${buildMs.toFixed(1)} ms, fuzzy ${fuzzyBuildMs.toFixed(1)} ms`);
    console.log(`        per query, phase 1 + phase 2 (ms):`);
    for (let i = 0; i < per.length; i += 4) {
        console.log('          ' + per.slice(i, i + 4).map((p) => `${p.ms.toFixed(3)} ${p.q}`.padEnd(34)).join(''));
    }
    per.sort((a, b) => b.ms - a.ms);
    console.log(`        avg ${avg.toFixed(3)} ms, slowest ${per[0].ms.toFixed(3)} ms (${per[0].q})`);
    const first = timings.slice().sort((a, b) => b.ms - a.ms)[0];
    if (first) console.log(`        slowest first call in the battery: ${first.ms.toFixed(3)} ms (${first.q})`);
    assert.ok(per[0].ms < 3, `slowest query ${per[0].q} took ${per[0].ms.toFixed(2)} ms`);
});

console.log(`\n${passed} checks passed${dictPath === REAL ? '' : ' (FIXTURE dictionary)'}`);
