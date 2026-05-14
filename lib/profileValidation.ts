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

export const SELLER_REQUIRED_PROFILE_FIELDS = [
    'address',
    'district',
    'state',
    'province',
    'postcode',
    'phone_number',
] as const;

export type SellerRequiredField = (typeof SELLER_REQUIRED_PROFILE_FIELDS)[number];

export const SELLER_PROFILE_FIELD_LABELS: Record<SellerRequiredField, string> = {
    address: 'Street address',
    district: 'District',
    state: 'City',
    province: 'Province',
    postcode: 'Postcode',
    phone_number: 'Phone number',
};

export type SellerProfileSubset = Partial<
    Record<SellerRequiredField, string | null | undefined>
>;

export interface ProfileCompletenessResult {
    complete: boolean;
    missing: SellerRequiredField[];
    /** Human-readable, comma-separated list of the missing field labels. */
    missingLabel: string;
}

export function checkSellerProfileComplete(
    profile: SellerProfileSubset | null | undefined,
): ProfileCompletenessResult {
    const missing: SellerRequiredField[] = [];
    for (const field of SELLER_REQUIRED_PROFILE_FIELDS) {
        const v = profile?.[field];
        if (typeof v !== 'string' || !v.trim()) {
            missing.push(field);
        }
    }
    return {
        complete: missing.length === 0,
        missing,
        missingLabel: missing.map((f) => SELLER_PROFILE_FIELD_LABELS[f]).join(', '),
    };
}

export const PROFILE_INCOMPLETE_TOAST =
    'Add your shipping address and phone number in Profile before listing a card.';

export const PROFILE_INCOMPLETE_ERROR_CODE = 'PROFILE_INCOMPLETE';
