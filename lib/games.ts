// Single source of truth for the trading-card games CardStreet supports.
//
// Every game-aware surface (Marketplace filter, Explore dropdowns, Master Set
// picker) reads from GAMES so adding/enabling a game is a one-line change here
// rather than edits scattered across components.
//
// Language codes use the UI convention ('en' | 'jp' | 'th') that existing
// components already pass around; the API layer maps 'jp' -> 'ja' for the DB
// (see app/api/sets/route.ts). Only games with more than one language render a
// language selector — this drives the "pick game, then language if needed" flow.

export type GameId = 'pokemon' | 'mtg' | 'yugioh' | 'onepiece' | 'riftbound' | 'lorcana';

export type GameLanguageCode = 'en' | 'jp' | 'th';

export interface GameLanguage {
  code: GameLanguageCode;
  label: string;
  flagUrl: string;
}

export interface GameConfig {
  id: GameId;
  /** Full display name, e.g. "Magic: The Gathering". */
  name: string;
  /** Compact label for filter chips / dropdowns, e.g. "Magic". */
  shortName: string;
  /**
   * Localized name for prose and page titles, e.g. the Thai set title reads
   * "การ์ด<th>". Distinct from `name` and `shortName` because it is neither
   * consistently: Magic wants the full "Magic: The Gathering" here but the
   * short "Magic" on a chip, while Pokémon wants the short "Pokémon" here and
   * the full "Pokémon TCG" as its name.
   *
   * Riftbound and Disney Lorcana keep Latin script in Thai — Thai players use
   * those brand names as-is, so transliterating them would look wrong and match
   * nothing anyone searches.
   */
  localizedName: { en: string; th: string };
  languages: GameLanguage[];
  /** Game wordmark. Surfaces fall back to the name if this fails to load. */
  logoUrl: string;
  /** Tailwind gradient classes for the Master Set picker card background. */
  gradient: string;
  textColor: string;
  accent: string;
  /** When false the game shows in pickers but is not yet selectable (no data). */
  enabled: boolean;
}

const FLAG_EN = 'https://flagcdn.com/w80/us.png';
const FLAG_JP = 'https://flagcdn.com/w80/jp.png';
const FLAG_TH = 'https://flagcdn.com/w80/th.png';

const LANG_EN: GameLanguage = { code: 'en', label: 'English', flagUrl: FLAG_EN };
const LANG_JP: GameLanguage = { code: 'jp', label: 'Japanese', flagUrl: FLAG_JP };
const LANG_TH: GameLanguage = { code: 'th', label: 'Thai', flagUrl: FLAG_TH };

export const GAMES: GameConfig[] = [
  {
    id: 'pokemon',
    name: 'Pokémon TCG',
    shortName: 'Pokémon',
    localizedName: { en: 'Pokémon', th: 'โปเกมอน' },
    languages: [LANG_EN, LANG_JP, LANG_TH],
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/98/International_Pok%C3%A9mon_logo.svg',
    gradient: 'from-[#FFCB05] to-[#c79d00]',
    textColor: 'text-[#3c5aa6]',
    accent: 'bg-[#3c5aa6]',
    enabled: true,
  },
  {
    id: 'mtg',
    name: 'Magic: The Gathering',
    shortName: 'Magic',
    localizedName: { en: 'Magic: The Gathering', th: 'เมจิก' },
    languages: [LANG_EN],
    logoUrl: '/games/mtg.svg',
    gradient: 'from-[#1a1410] to-[#3b2f2a]',
    textColor: 'text-white',
    accent: 'bg-[#d9a441]',
    enabled: true,
  },
  {
    id: 'yugioh',
    name: 'Yu-Gi-Oh!',
    shortName: 'Yu-Gi-Oh!',
    localizedName: { en: 'Yu-Gi-Oh!', th: 'ยูกิโอ' },
    languages: [LANG_EN],
    logoUrl: '/games/yugioh.png',
    gradient: 'from-[#3a1c71] to-[#1b1035]',
    textColor: 'text-white',
    accent: 'bg-[#b066ff]',
    enabled: true,
  },
  {
    id: 'onepiece',
    name: 'One Piece Card Game',
    shortName: 'One Piece',
    // วันพีช, not วันพีซ. Both transliterations circulate, but วันพีช is what the
    // rest of the site uses and what the tracked query "การ์ดวันพีช" uses; two
    // spellings split the signal for one head term (fixed in fe76f86).
    localizedName: { en: 'One Piece', th: 'วันพีช' },
    languages: [LANG_EN, LANG_JP],
    logoUrl: '/games/onepiece.png',
    gradient: 'from-[#b21f24] to-[#5e0d10]',
    textColor: 'text-white',
    accent: 'bg-[#ef4444]',
    enabled: true,
  },
  {
    id: 'riftbound',
    name: 'Riftbound',
    shortName: 'Riftbound',
    localizedName: { en: 'Riftbound', th: 'Riftbound' },
    languages: [LANG_EN],
    logoUrl: '/games/riftbound.png',
    gradient: 'from-[#1c2742] to-[#0a0f1c]',
    textColor: 'text-white',
    accent: 'bg-[#e8a33d]',
    enabled: true,
  },
  {
    id: 'lorcana',
    name: 'Disney Lorcana',
    shortName: 'Lorcana',
    localizedName: { en: 'Disney Lorcana', th: 'Disney Lorcana' },
    languages: [LANG_EN],
    logoUrl: '/games/lorcana.png',
    gradient: 'from-[#3b1d6e] to-[#140a2e]',
    textColor: 'text-white',
    accent: 'bg-[#d4af37]',
    enabled: true,
  },
];

/**
 * Every catalog language with its flag, for filters that aren't scoped to a
 * single game (e.g. the Marketplace filter sheet's language pills).
 */
export const CATALOG_LANGUAGES: GameLanguage[] = [LANG_EN, LANG_JP, LANG_TH];

export const DEFAULT_GAME: GameId = 'pokemon';

export function getGame(id: string | null | undefined): GameConfig {
  return GAMES.find((g) => g.id === id) ?? GAMES[0];
}

/**
 * Localized game name for titles and headings. Unknown ids fall back to the id
 * itself, which is what the per-surface maps this replaced used to do — a set
 * row for a game not yet in GAMES still renders something rather than blank.
 *
 * This exists so Thai game names live in exactly one place. They previously sat
 * in duplicate maps in app/desktop/sets/[setId]/page.tsx and
 * components/desktop/DesktopSetsBrowser.tsx, which is how One Piece ended up
 * spelled two different ways across the site.
 */
export function getGameLabel(id: string | null | undefined, locale: 'en' | 'th'): string {
  const game = GAMES.find((g) => g.id === id);
  return game ? game.localizedName[locale] : (id ?? '');
}

export function getGameLanguages(id: string | null | undefined): GameLanguage[] {
  return getGame(id).languages;
}

export function gameHasMultipleLanguages(id: string | null | undefined): boolean {
  return getGame(id).languages.length > 1;
}

/** Default language for a game (first declared). */
export function defaultLanguageForGame(id: string | null | undefined): GameLanguageCode {
  return getGame(id).languages[0]?.code ?? 'en';
}

/**
 * Games whose catalog exists in the given language, for language-dependent
 * game filters (e.g. Marketplace: pick Thai -> only Pokémon remains).
 * Accepts both Japanese conventions — 'jp' (this config / mobile UI) and
 * 'ja' (DB + listing snapshots, used by the desktop marketplace filter).
 * 'all' / empty means no language constraint.
 */
export function gamesAvailableInLanguage(code: string | null | undefined): GameConfig[] {
  if (!code || code === 'all') return GAMES;
  const normalized = code === 'ja' ? 'jp' : code;
  return GAMES.filter((g) => g.languages.some((l) => l.code === normalized));
}
