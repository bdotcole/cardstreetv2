/**
 * The words around a Pokémon's name on a card: TCG mechanics (ex, V, VMAX),
 * regional forms (Alolan), special prints (Radiant) and the Team Rocket owner
 * form. Each language prints them differently, and in a different place:
 *
 *   EN  "Alolan Vulpix V"      JA  "アローラ ロコンV"      TH  "อโลลา โรคอนV"
 *   EN  "Dark Gyarados"        JA  "わるいギャラドス"      TH  "เกียราดอสชั่วร้าย"   (suffix in Thai)
 *
 * Search detects them in a query typed in any language, strips them to find
 * the species, and then requires them (in any language's spelling) on the
 * result rows. That is how "alolan vulpix" finds the Japanese and Thai prints,
 * and how "ไรโค v" finds "ไรโคV" even though the catalog never puts a space
 * before V.
 *
 * `en`/`ja`/`th` are the spellings as PRINTED in the catalog; they become
 * ILIKE legs, so keep them free of `,()%*_\"`. `detect` holds extra query-side
 * spellings (compared as fold keys) that are never sent to the database.
 */

export type ModifierKind = 'suffix' | 'prefix' | 'owner';

export interface Modifier {
    id: string;
    kind: ModifierKind;
    en: string[];
    ja: string[];
    th: string[];
    detect?: string[];
    /** Name-start patterns, sent without a leading wildcard ("M " for "M Charizard-EX"). */
    enStartsWith?: string[];
    /** Where Thai prints it, when that differs from `kind` (เกียราดอสชั่วร้าย = Dark Gyarados). */
    thPosition?: 'prefix' | 'suffix';
    /** Where Japanese prints it, when that differs from `kind` (ガチグマ アカツキex). */
    jaPosition?: 'prefix' | 'suffix';
    /**
     * Only recognise the Latin spellings (`en`, `detect`) as a separate word,
     * never glued to a name: "dark" starts Darkrai, "m" starts every M-name.
     * The `ja`/`th` spellings still attach, because the catalog prints them
     * glued (メガルカリオex, เมก้าลิซาร์ดอน X ex); resolution only peels them
     * when what remains is itself a species, after trying the whole word, so
     * メガヤンマ stays Yanmega.
     */
    standaloneOnly?: boolean;
}

export const MODIFIERS: Modifier[] = [
    // Mechanics. Printed in Latin letters in every language.
    { id: 'vmax', kind: 'suffix', en: ['VMAX'], ja: [], th: [] },
    { id: 'vstar', kind: 'suffix', en: ['VSTAR'], ja: [], th: [] },
    { id: 'vunion', kind: 'suffix', en: ['V-UNION'], ja: [], th: [], detect: ['vunion'] },
    { id: 'gx', kind: 'suffix', en: ['GX'], ja: [], th: [] },
    { id: 'ex', kind: 'suffix', en: ['ex'], ja: [], th: [] },
    { id: 'v', kind: 'suffix', en: ['V'], ja: [], th: [] },
    { id: 'break', kind: 'suffix', en: ['BREAK'], ja: [], th: [] },
    { id: 'legend', kind: 'suffix', en: ['LEGEND'], ja: [], th: [] },
    { id: 'lvx', kind: 'suffix', en: ['LV.X'], ja: [], th: [], detect: ['lvx'] },
    { id: 'prismstar', kind: 'suffix', en: ['◇', 'Prism Star'], ja: [], th: [], detect: ['prismstar', '♢'] },
    { id: 'star', kind: 'suffix', en: ['☆'], ja: [], th: [], detect: ['star', 'goldstar'], standaloneOnly: true },
    // EN prints the symbol (191 rows), JA a full-width parenthetical (デルタ種).
    { id: 'delta', kind: 'suffix', en: ['δ'], ja: ['デルタ種'], th: [], detect: ['delta', 'deltaspecies'] },

    // Forms and special prints.
    { id: 'mega', kind: 'prefix', en: ['Mega'], ja: ['メガ'], th: ['เมก้า'], enStartsWith: ['M '], detect: ['m'], standaloneOnly: true },
    { id: 'alolan', kind: 'prefix', en: ['Alolan'], ja: ['アローラ'], th: ['อโลลา'], detect: ['alola'] },
    { id: 'galarian', kind: 'prefix', en: ['Galarian'], ja: ['ガラル'], th: ['กาลาร์'], detect: ['galar'] },
    { id: 'hisuian', kind: 'prefix', en: ['Hisuian'], ja: ['ヒスイ'], th: ['ฮิซุย'], detect: ['hisui'] },
    // The catalog spells Paldea พัลเดีย; พาลเดีย is the spelling people expect.
    { id: 'paldean', kind: 'prefix', en: ['Paldean'], ja: ['パルデア'], th: ['พัลเดีย', 'พาลเดีย'], detect: ['paldea'] },
    { id: 'radiant', kind: 'prefix', en: ['Radiant'], ja: ['かがやく'], th: ['เรเดียนต์'] },
    { id: 'shining', kind: 'prefix', en: ['Shining'], ja: ['ひかる', '輝く'], th: ['ไซนิง'] },
    { id: 'dark', kind: 'prefix', en: ['Dark'], ja: ['わるい', '暗い'], th: ['ชั่วร้าย'], thPosition: 'suffix', standaloneOnly: true },
    { id: 'light', kind: 'prefix', en: ['Light'], ja: ['やさしい', '軽い'], th: [], standaloneOnly: true },
    { id: 'origin', kind: 'prefix', en: ['Origin Forme'], ja: ['オリジン'], th: ['ดั้งเดิม'], thPosition: 'suffix', detect: ['origin', 'originforme'] },
    { id: 'singlestrike', kind: 'prefix', en: ['Single Strike'], ja: ['いちげき'], th: ['จู่โจมครั้งเดียว'], thPosition: 'suffix' },
    { id: 'rapidstrike', kind: 'prefix', en: ['Rapid Strike'], ja: ['れんげき'], th: ['จู่โจมต่อเนื่อง'], thPosition: 'suffix' },
    { id: 'shadowrider', kind: 'prefix', en: ['Shadow Rider'], ja: ['こくば'], th: ['ร่างขี่ม้าดำ'], thPosition: 'suffix' },
    { id: 'icerider', kind: 'prefix', en: ['Ice Rider'], ja: ['はくば'], th: ['ร่างขี่ม้าขาว'], thPosition: 'suffix' },
    { id: 'bloodmoon', kind: 'prefix', en: ['Bloodmoon'], ja: ['アカツキ'], th: ['พระจันทร์สีเลือด'], jaPosition: 'suffix', thPosition: 'suffix' },

    // Owner form. EN "Team Rocket's Mewtwo ex" / older "Rocket's Zapdos"; JA
    // "ロケット団のミュウツー"; TH "มิวทูex ของแก๊งร็อกเกต" (also misspelled แก็ง).
    // The connector-bearing spellings come first so scoring strips them whole.
    {
        id: 'rocket',
        kind: 'owner',
        en: ["Rocket's"],
        ja: ['ロケット団の', 'ロケットの', 'ロケット団'],
        th: ['ของแก๊งร็อกเกต', 'ของแก็งร็อกเกต', 'แก๊งร็อกเกต', 'แก็งร็อกเกต'],
        detect: ['teamrocket', 'teamrockets', 'rocket', 'rockets'],
    },
];

/**
 * Words that say which printing the user wants, not what the card is called.
 * They become a ranking preference instead of a name filter: the real
 * dead-end query "พิคาชู jp ex" returned nothing because "jp" was ANDed in as
 * part of the name.
 */
export const LANGUAGE_TOKENS: Record<'en' | 'ja' | 'th', string[]> = {
    ja: ['jp', 'jpn', 'japan', 'japanese', 'ญี่ปุ่น', 'ญป', 'ญปน', '日本', '日本語'],
    th: ['th', 'thai', 'ไทย'],
    en: ['en', 'eng', 'english', 'อังกฤษ'],
};

/**
 * Rarity codes people type after a name ("เมก้าเก็คโคกะ sar"); matched against
 * the rarity column. Not "ace": it is a word in real card names (Ace Trainer,
 * Psychic Ace, Sky Striker Ace), and stripping it searched them as "trainer".
 */
export const RARITY_TOKENS = ['sar', 'sir', 'ar', 'sr', 'ur', 'hr', 'chr', 'csr', 'rr', 'rrr', 'ssr', 'promo'];

/**
 * Shopping and collecting vocabulary. These are never typo-corrected into a
 * Pokémon: with loose matching on, "holo" became Hoothoot, "sleeve" Drowzee,
 * "trainer" Nosepass and การ์ด (card) Growlithe.
 */
export const STOPWORDS = new Set([
    'holo', 'reverse', 'foil', 'sealed', 'shiny', 'secret', 'trainer', 'trainers', 'art', 'alt', 'full', 'promo',
    'booster', 'boosters', 'box', 'boxes', 'pack', 'packs', 'sleeve', 'sleeves', 'binder', 'graded', 'psa', 'bgs',
    'cgc', 'tag', 'card', 'cards', 'deck', 'decks', 'collection', 'elite', 'etb', 'tin', 'case', 'lot', 'bundle',
    'set', 'sets', 'energy', 'item', 'stadium', 'tool', 'supporter', 'rare', 'common', 'uncommon', 'mint', 'near',
    'played', 'damaged', 'new', 'old', 'vintage', 'japanese', 'english', 'thai', 'pokemon', 'pokémon', 'center',
    'การ์ด', 'ฟอยล์', 'บอล', 'ซอง', 'กล่อง', 'แพ็ค', 'แพ็ก', 'ชุด', 'โปเกมอน', 'กล่องสุ่ม',
    'カード',
]);
