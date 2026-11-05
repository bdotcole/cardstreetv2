/**
 * What an order, sale or shipment row shows under the card name, read from
 * the listing's card_data snapshot (the mapped Card at listing time, see
 * lib/cardMapper).
 *
 * The name alone does not identify a print: the Thai and the English card of
 * one set share it, and some names are identical on both ("N" from 30th
 * Celebration). A seller who stocks both could not tell from the sold row
 * which one the buyer had ordered (2026-11-05 support ticket), so every row
 * also names the language, the set and the collector number.
 */
export type SnapshotLanguage = 'th' | 'en' | 'jp';

type Snapshot = { set?: unknown; number?: unknown; language?: unknown; isSealed?: unknown };

const asSnapshot = (cardData: unknown): Snapshot | null =>
    cardData && typeof cardData === 'object' ? (cardData as Snapshot) : null;

/** The print's language, normalised: cards store 'ja', sealed rows 'jp'. */
export function snapshotLanguage(cardData: unknown): SnapshotLanguage | null {
    const snap = asSnapshot(cardData);
    const raw = typeof snap?.language === 'string' ? snap.language.toLowerCase() : '';
    if (raw === 'th') return 'th';
    if (raw === 'en') return 'en';
    if (raw === 'ja' || raw === 'jp') return 'jp';
    return null;
}

/**
 * "30th CELEBRATION · 184/130". The set alone for sealed products and when
 * the mapper had no number ("??/..."); null when the snapshot names neither.
 */
export function snapshotSetLine(cardData: unknown): string | null {
    const snap = asSnapshot(cardData);
    const rawSet = typeof snap?.set === 'string' ? snap.set.trim() : '';
    const set = rawSet && rawSet !== 'Unknown Set' ? rawSet : '';
    const rawNumber = typeof snap?.number === 'string' ? snap.number.trim() : '';
    const number = rawNumber && !rawNumber.startsWith('??') && !snap?.isSealed ? rawNumber : '';
    if (set && number) return `${set} · ${number}`;
    return set || number || null;
}

/** Locale keys for the language chip (lib/locales, parcel.lang*). */
export const SNAPSHOT_LANGUAGE_KEY: Record<SnapshotLanguage, string> = {
    th: 'parcel.langTh',
    en: 'parcel.langEn',
    jp: 'parcel.langJp',
};
