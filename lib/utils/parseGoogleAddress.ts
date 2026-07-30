/**
 * Thai Address Parser for Google Places Autocomplete
 *
 * Parses a Google Maps `address_components` array into a structured
 * Thai address object suitable for Flash Express shipping integration.
 *
 * Mapping (upcountry):
 *   administrative_area_level_1 -> province (จังหวัด)
 *   administrative_area_level_2 | locality -> district (อำเภอ)
 *   sublocality_level_1 | sublocality -> sub_district (ตำบล)
 *   postal_code -> postal_code (รหัสไปรษณีย์)
 *   street_number + route -> detail_address (ที่อยู่)
 *
 * Mapping (Bangkok): Google gives Bangkok NO administrative_area_level_2 —
 * the เขต (khet) rides sublocality_level_1 and the แขวง (khwaeng)
 * sublocality_level_2. The upcountry mapping therefore used to drop the khet
 * into sub_district and leave district empty; users hand-patched the empty
 * box with their khwaeng, saving a swapped address that Flash Express
 * rejected at waybill time ("Consignee region does not match" — order
 * d307f84c, 2026-07-30). Bangkok now maps:
 *   sublocality_level_1 -> district (เขต)
 *   sublocality_level_2 -> sub_district (แขวง)
 *
 * NOTE: Google's address_components order is NOT guaranteed.
 *       We use .find() to match by `types` array membership.
 */

export interface GoogleAddressComponent {
    long_name: string;
    short_name: string;
    types: string[];
}

export interface ParsedThaiAddress {
    province: string;       // จังหวัด
    district: string;       // อำเภอ/เขต
    sub_district: string;   // ตำบล/แขวง
    postal_code: string;    // รหัสไปรษณีย์
    detail_address: string; // บ้านเลขที่ + ถนน
}

/**
 * Finds the first component whose `types` array includes any of the given type keys.
 * Returns `long_name` (Thai text) when available, which is more useful for shipping labels.
 */
function findComponent(
    components: GoogleAddressComponent[],
    ...typeKeys: string[]
): string {
    for (const typeKey of typeKeys) {
        const match = components.find((c) => c.types.includes(typeKey));
        if (match) return match.long_name;
    }
    return '';
}

/**
 * Parses Google Places `address_components` into a structured Thai address.
 *
 * @param components - The `address_components` array from a Google Place Details response.
 * @returns A ParsedThaiAddress with all fields populated (empty string if not found).
 *
 * @example
 * ```ts
 * const place = autocomplete.getPlace();
 * const parsed = parseGoogleAddressToThai(place.address_components || []);
 * // => { province: 'กรุงเทพมหานคร', district: 'เขตบางรัก', sub_district: 'บางรัก', ... }
 * ```
 */
export function parseGoogleAddressToThai(
    components: GoogleAddressComponent[]
): ParsedThaiAddress {
    if (!components || components.length === 0) {
        return {
            province: '',
            district: '',
            sub_district: '',
            postal_code: '',
            detail_address: '',
        };
    }

    // Province: administrative_area_level_1
    const province = findComponent(components, 'administrative_area_level_1');
    const isBangkok = /กรุงเทพ|กทม|bangkok/i.test(province);

    let district: string;
    let sub_district: string;
    if (isBangkok) {
        // Bangkok has no administrative_area_level_2: the khet is
        // sublocality_level_1 and the khwaeng sublocality_level_2 (see the
        // header comment — the generic branch below misfiles the khet as
        // sub_district here).
        district = findComponent(
            components,
            'administrative_area_level_2',
            'sublocality_level_1',
            'locality'
        );
        sub_district = findComponent(components, 'sublocality_level_2');
    } else {
        // District (Amphoe): administrative_area_level_2 IS the อำเภอ in
        // Google's Thai data. `locality` is only a fallback — upcountry it is
        // often the ตำบล/town, and saving that as the district made Flash
        // Express reject the address ("Consignee region does not match"),
        // silently degrading every shipping quote for the profile to the flat
        // fallback.
        district = findComponent(
            components,
            'administrative_area_level_2',
            'locality'
        );

        // Sub-district (Tambon): try sublocality_level_1, then sublocality,
        // then sublocality_level_2 — never reusing the component already taken
        // as the district (locality can match both lists).
        sub_district = findComponent(
            components,
            'sublocality_level_1',
            'sublocality',
            'sublocality_level_2'
        );
        if (sub_district && sub_district === district) {
            sub_district = findComponent(components, 'sublocality_level_2');
        }
    }

    // Postal code
    const postal_code = findComponent(components, 'postal_code');

    // Detail address: street_number + route
    const streetNumber = findComponent(components, 'street_number');
    const route = findComponent(components, 'route');
    const detail_address = [streetNumber, route].filter(Boolean).join(' ').trim();

    return {
        province,
        district,
        sub_district,
        postal_code,
        detail_address,
    };
}

/**
 * Validates that all required Thai address fields are present.
 * Useful for gating the "save" button until the address is complete.
 */
export function isThaiAddressComplete(address: ParsedThaiAddress): boolean {
    return !!(
        address.province &&
        address.district &&
        address.sub_district &&
        address.postal_code &&
        address.detail_address
    );
}

/**
 * Formats a parsed Thai address into a single display string.
 */
export function formatParsedThaiAddress(address: ParsedThaiAddress): string {
    return [
        address.detail_address,
        address.sub_district ? `ตำบล/แขวง ${address.sub_district}` : '',
        address.district ? `อำเภอ/เขต ${address.district}` : '',
        address.province ? `จังหวัด ${address.province}` : '',
        address.postal_code,
    ]
        .filter(Boolean)
        .join(' ');
}
