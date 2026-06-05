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

export type GameId = 'pokemon' | 'mtg' | 'yugioh' | 'onepiece' | 'riftbound';

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
    languages: [LANG_EN],
    // No reliable hotlinkable wordmark; pickers fall back to the styled name.
    // Replace with a local /public/games/*.svg asset for a true logo.
    logoUrl: '',
    gradient: 'from-[#1a1410] to-[#3b2f2a]',
    textColor: 'text-white',
    accent: 'bg-[#d9a441]',
    enabled: true,
  },
  {
    id: 'yugioh',
    name: 'Yu-Gi-Oh!',
    shortName: 'Yu-Gi-Oh!',
    languages: [LANG_EN],
    logoUrl: '',
    gradient: 'from-[#3a1c71] to-[#1b1035]',
    textColor: 'text-white',
    accent: 'bg-[#b066ff]',
    enabled: true,
  },
  {
    id: 'onepiece',
    name: 'One Piece Card Game',
    shortName: 'One Piece',
    languages: [LANG_EN],
    logoUrl: '',
    gradient: 'from-[#b21f24] to-[#5e0d10]',
    textColor: 'text-white',
    accent: 'bg-[#ef4444]',
    enabled: true,
  },
  {
    id: 'riftbound',
    name: 'Riftbound',
    shortName: 'Riftbound',
    languages: [LANG_EN],
    logoUrl: '',
    gradient: 'from-[#0e7490] to-[#083344]',
    textColor: 'text-white',
    accent: 'bg-[#06b6d4]',
    enabled: false,
  },
];

export const DEFAULT_GAME: GameId = 'pokemon';

export function getGame(id: string | null | undefined): GameConfig {
  return GAMES.find((g) => g.id === id) ?? GAMES[0];
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
