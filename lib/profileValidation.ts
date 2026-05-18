/**
 * Single source of truth for the profile fields a seller must fill in
 * before they can list a card.
 *
 * Why this exists: lib/fulfillOrder.ts hands seller address fields to
 * Flash Express verbatim (provinceName / cityName / districtName /
 * postalCode / detailAddress / phone). When any of these is missing,
 * fulfillment substitutes Bangkok placeholders — which Flash's region
 * validation rejects, leaving the order stuck in 'paid' with a manual-
 * handling fallback. Blocking listing creation up front is the simplest
 * way to keep sellers in a fulfillable state.
 *
 * `sub_district` is intentionally not required — Flash accepts the
 * `district` value in its place (see fulfillOrder.ts:135).
 */

// ── Shipping fields that both sellers and buyers need ──
const SHIPPING_REQUIRED_FIELDS = [
    'address',
    'district',
    'state',
    'province',
    'postcode',
    'phone_number',
] as const;

// ── Stripe Connect fields a seller needs, on top of shipping. ──
// charges_enabled is the canonical "can receive money?" boolean from Stripe.
const SELLER_CONNECT_REQUIRED_FIELDS = [
    'stripe_account_id',
    'stripe_charges_enabled',
] as const;

export const SELLER_REQUIRED_PROFILE_FIELDS = [
    ...SHIPPING_REQUIRED_FIELDS,
    ...SELLER_CONNECT_REQUIRED_FIELDS,
] as const;

export type SellerRequiredField = (typeof SELLER_REQUIRED_PROFILE_FIELDS)[number];

export const SELLER_PROFILE_FIELD_LABELS: Record<SellerRequiredField, string> = {
    address: 'Street address',
    district: 'District',
    state: 'City',
    province: 'Province',
    postcode: 'Postcode',
    phone_number: 'Phone number',
    stripe_account_id: 'Stripe payout account',
    stripe_charges_enabled: 'Stripe payout activation',
};

export type SellerProfileSubset = Partial<
    Record<SellerRequiredField, string | boolean | null | undefined>
>;

export interface ProfileCompletenessResult {
    complete: boolean;
    missing: SellerRequiredField[];
    /** Human-readable, comma-separated list of the missing field labels. */
    missingLabel: string;
}

function isFieldPresent(field: SellerRequiredField, value: unknown): boolean {
    // Booleans must be explicitly true; nullable booleans (Supabase often
    // returns null for unset bools) count as missing.
    if (field === 'stripe_charges_enabled') return value === true;
    // The account id is a non-empty string when set.
    if (field === 'stripe_account_id') {
        return typeof value === 'string' && value.trim().length > 0;
    }
    // Address / phone fields are strings.
    return typeof value === 'string' && value.trim().length > 0;
}

export function checkSellerProfileComplete(
    profile: SellerProfileSubset | null | undefined,
): ProfileCompletenessResult {
    const missing: SellerRequiredField[] = [];
    for (const field of SELLER_REQUIRED_PROFILE_FIELDS) {
        if (!isFieldPresent(field, profile?.[field])) {
            missing.push(field);
        }
    }
    return {
        complete: missing.length === 0,
        missing,
        missingLabel: missing.map((f) => SELLER_PROFILE_FIELD_LABELS[f]).join(', '),
    };
}

// ── Buyer side — shipping fields only (no Stripe Connect required). ──
export const BUYER_REQUIRED_PROFILE_FIELDS = SHIPPING_REQUIRED_FIELDS;
export type BuyerRequiredField = (typeof BUYER_REQUIRED_PROFILE_FIELDS)[number];

export const BUYER_PROFILE_FIELD_LABELS: Record<BuyerRequiredField, string> = {
    address: 'Street address',
    district: 'District',
    state: 'City',
    province: 'Province',
    postcode: 'Postcode',
    phone_number: 'Phone number',
};

export type BuyerProfileSubset = Partial<
    Record<BuyerRequiredField, string | null | undefined>
>;

export interface BuyerCompletenessResult {
    complete: boolean;
    missing: BuyerRequiredField[];
    missingLabel: string;
}

export function checkBuyerProfileComplete(
    profile: BuyerProfileSubset | null | undefined,
): BuyerCompletenessResult {
    const missing: BuyerRequiredField[] = [];
    for (const field of BUYER_REQUIRED_PROFILE_FIELDS) {
        const v = profile?.[field];
        if (typeof v !== 'string' || !v.trim()) {
            missing.push(field);
        }
    }
    return {
        complete: missing.length === 0,
        missing,
        missingLabel: missing.map((f) => BUYER_PROFILE_FIELD_LABELS[f]).join(', '),
    };
}

// ── Error codes the client routes on ──
export const PROFILE_INCOMPLETE_TOAST =
    'Add your shipping address and phone number in Profile, then connect Stripe payouts before listing a card.';
export const PROFILE_INCOMPLETE_ERROR_CODE = 'PROFILE_INCOMPLETE';

export const BUYER_PROFILE_INCOMPLETE_TOAST =
    'Add your shipping address and phone number in Profile before checking out.';
export const BUYER_PROFILE_INCOMPLETE_ERROR_CODE = 'BUYER_PROFILE_INCOMPLETE';
