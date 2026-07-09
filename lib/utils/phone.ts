/**
 * Phone-number normalization + validation for Thai numbers.
 *
 * Why this exists: purchases are Thailand-only (Flash Express is the only
 * configured courier), and Flash requires a reachable recipient phone on every
 * waybill. When the buyer's number is missing or malformed, lib/fulfillOrder.ts
 * substitutes a '0000000000' placeholder the courier can't call, stranding the
 * parcel. So the buyer's phone must be a real, dialable TH number before
 * checkout — not merely non-empty, which is all checkBuyerProfileComplete
 * (lib/profileValidation.ts) checks. These helpers add the format teeth at the
 * purchase gates and normalize the stored value so downstream Flash calls get
 * clean digits.
 *
 * Thai numbers are 9-10 digits starting with 0 (mobile 08x/09x/06x are 10;
 * some Bangkok landlines 02x are 9). We accept common human formatting (spaces,
 * dashes, dots, parens) and the +66 / 0066 international prefixes, folding them
 * to the national leading-0 form.
 */
export function normalizePhone(raw: string | null | undefined): string {
    if (!raw) return '';
    let s = String(raw).replace(/[\s\-().]/g, '');
    if (s.startsWith('+66')) s = '0' + s.slice(3);
    else if (s.startsWith('0066')) s = '0' + s.slice(4);
    return s;
}

export function isValidThaiPhone(raw: string | null | undefined): boolean {
    return /^0\d{8,9}$/.test(normalizePhone(raw));
}
