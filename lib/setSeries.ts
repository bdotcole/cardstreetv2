// The series badge a set tile falls back to when the catalog has no artwork
// for it (no logo, no pack photo, no symbol). A single letter of the set name
// told a Thai collector nothing: four "แท็กติกเด็ค" decks all drew "แ". The
// era wordmark plus the set code at least says which generation the set is
// from and which product it is.

export interface SeriesBadge {
    /** The wordmark drawn large: "SV", "MEGA", "S&S". */
    short: string;
    /** Tailwind gradient stops for the wordmark. */
    gradient: string;
}

const MEGA: SeriesBadge = { short: 'MEGA', gradient: 'from-amber-300 via-orange-400 to-rose-500' };
const SV: SeriesBadge = { short: 'SV', gradient: 'from-red-500 via-fuchsia-500 to-violet-500' };
const SWSH: SeriesBadge = { short: 'S&S', gradient: 'from-sky-400 via-indigo-400 to-rose-400' };
const SM: SeriesBadge = { short: 'SM', gradient: 'from-orange-400 via-amber-300 to-indigo-400' };
const XY: SeriesBadge = { short: 'XY', gradient: 'from-blue-500 via-sky-400 to-red-500' };
const BW: SeriesBadge = { short: 'BW', gradient: 'from-slate-100 via-slate-400 to-slate-600' };
const DP: SeriesBadge = { short: 'DP', gradient: 'from-cyan-300 via-sky-400 to-pink-300' };
const EX: SeriesBadge = { short: 'EX', gradient: 'from-yellow-300 via-amber-400 to-orange-500' };
const CLASSIC: SeriesBadge = { short: 'WotC', gradient: 'from-yellow-200 via-yellow-400 to-amber-600' };

/** The set code as printed on the cards: the catalog id without its language suffix. */
export function setCode(id: string): string {
    return id.replace(/-(?:th|jp|ja|en)$/i, '').toUpperCase();
}

export function seriesBadge(set: { id: string; series?: string | null }): SeriesBadge {
    const series = (set.series || '').toLowerCase();
    const id = set.id.toLowerCase();

    // The catalog's series names, English and Japanese.
    if (/mega|メガ/.test(series)) return MEGA;
    if (/scarlet|スカーレット/.test(series)) return SV;
    if (/sword|ソード/.test(series)) return SWSH;
    if (/sun ?& ?moon|サン/.test(series)) return SM;
    if (/^xy/.test(series)) return XY;
    if (/black ?& ?white/.test(series)) return BW;
    if (/diamond|platinum|heartgold/.test(series)) return DP;
    if (/^ex$/.test(series)) return EX;
    if (/base|neo|gym|e-card|legendary/.test(series)) return CLASSIC;

    // Series-less rows (Thai decks, promo sets): the set code carries the era.
    // "mcd" is the McDonald's promos, not the Mega era.
    if (/^m(?!cd)/.test(id)) return MEGA;
    if (/^sv/.test(id)) return SV;
    if (/^sm/.test(id)) return SM;
    if (/^s(?!v|m)/.test(id)) return SWSH;
    if (/^xy/.test(id)) return XY;
    if (/^bw/.test(id)) return BW;
    if (/^(dp|pl|hgss)/.test(id)) return DP;
    if (/^ex/.test(id)) return EX;
    if (/^(base|neo|gym|ecard)/.test(id)) return CLASSIC;

    // Unknown era: the set code itself is the wordmark.
    return { short: setCode(set.id).slice(0, 6), gradient: 'from-cyan-300 via-sky-300 to-violet-400' };
}
