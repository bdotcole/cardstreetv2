/**
 * Carriers a Thai seller hands a parcel to when they ship it themselves.
 *
 * One list feeds the chips in the ship-it-myself / shipped-another-way sheets
 * (components/ParcelHandoff) and the 17TRACK carrier codes used to follow a
 * number we did not mint (lib/track17, lib/externalTracking). Sellers also
 * type free text, so every carrier carries lower-case fragments that identify
 * it in whatever the seller wrote ("เคอรี่", "KEX", "ไปรษณีย์").
 *
 * Client-safe: no secrets, no server imports.
 */
export interface CarrierOption {
    id: string;
    /** English label on the chip and in notifications. */
    name: string;
    /** Thai label on the chip. */
    nameTh: string;
    /**
     * 17TRACK carrier key (res.17track.net/asset/carrier/info/apicarrier.all.json,
     * read 2026-11-08). Null when nothing can follow the parcel.
     */
    track17: number | null;
    /** Lower-case fragments that identify this carrier in free text. */
    aliases: string[];
    /** Public tracking page with `{n}` for the number; 17TRACK's page otherwise. */
    trackingUrl?: string;
}

/** "Delivered by hand": no carrier, no number, the buyer confirms receipt. */
export const BY_HAND_CARRIER_ID = 'hand';

export const CARRIERS: CarrierOption[] = [
    {
        id: 'flash', name: 'Flash Express', nameTh: 'Flash Express', track17: 100235,
        aliases: ['flash', 'แฟลช'],
        trackingUrl: 'https://www.flashexpress.com/fle/tracking?se={n}',
    },
    {
        // Kerry Express Thailand trades as KEX Express since 2025; 17TRACK
        // lists both (100236 Kerry, 101405 KEX) and the older key still
        // resolves. Auto-detect is the fallback if it ever stops.
        id: 'kerry', name: 'Kerry / KEX Express', nameTh: 'Kerry / KEX Express', track17: 100236,
        aliases: ['kerry', 'kex', 'เคอรี่', 'เคอร์รี่', 'เคอรี'],
    },
    {
        id: 'jt', name: 'J&T Express', nameTh: 'J&T Express', track17: 100271,
        aliases: ['j&t', 'j and t', 'jnt', 'jt express', 'เจแอนด์ที', 'เจทีเอ็กซ์เพรส'],
    },
    {
        id: 'thaipost', name: 'Thailand Post', nameTh: 'ไปรษณีย์ไทย', track17: 20041,
        aliases: ['thailand post', 'thai post', 'thailandpost', 'ไปรษณีย์', 'ปณ', 'ems', 'ลงทะเบียน'],
        trackingUrl: 'https://track.thailandpost.co.th/?trackNumber={n}',
    },
    {
        id: 'spx', name: 'SPX Express', nameTh: 'SPX Express', track17: 100410,
        aliases: ['spx', 'shopee'],
    },
    {
        id: 'ninjavan', name: 'Ninja Van', nameTh: 'Ninja Van', track17: 100128,
        aliases: ['ninja', 'นินจา'],
    },
    {
        id: 'best', name: 'Best Express', nameTh: 'Best Express', track17: 100391,
        aliases: ['best express', 'best inc', 'เบสท์'],
    },
    {
        id: BY_HAND_CARRIER_ID, name: 'Delivered by hand', nameTh: 'ส่งถึงมือเอง', track17: null,
        aliases: ['by hand', 'in person', 'hand', 'meet', 'ถึงมือ', 'ส่งเอง', 'นัดรับ', 'เจอกัน'],
    },
];

const byId = new Map(CARRIERS.map((c) => [c.id, c]));

export function carrierById(id: string | null | undefined): CarrierOption | null {
    return (id && byId.get(id)) || null;
}

/** The catalogue entry a free-text carrier name refers to, or null. */
export function matchCarrier(text: string | null | undefined): CarrierOption | null {
    const needle = (text || '').toLowerCase().trim();
    if (!needle) return null;
    for (const c of CARRIERS) {
        if (c.name.toLowerCase() === needle || c.nameTh === needle) return c;
    }
    for (const c of CARRIERS) {
        if (c.aliases.some((a) => needle.includes(a))) return c;
    }
    return null;
}

/** True when the seller said they handed the cards over in person. */
export function isByHand(text: string | null | undefined): boolean {
    return matchCarrier(text)?.id === BY_HAND_CARRIER_ID;
}

/** 17TRACK carrier key for a free-text carrier name; null = let 17TRACK detect it. */
export function track17CodeFor(text: string | null | undefined): number | null {
    return matchCarrier(text)?.track17 ?? null;
}

/**
 * Where a buyer can follow a number. The carrier's own page when we know it,
 * otherwise 17TRACK's public page, which covers every carrier above.
 */
export function publicTrackingUrl(carrier: string | null | undefined, trackingNumber: string | null | undefined): string | null {
    const n = (trackingNumber || '').trim();
    if (!n) return null;
    const match = matchCarrier(carrier);
    if (match?.id === BY_HAND_CARRIER_ID) return null;
    if (match?.trackingUrl) return match.trackingUrl.replace('{n}', encodeURIComponent(n));
    return `https://t.17track.net/en#nums=${encodeURIComponent(n)}`;
}
