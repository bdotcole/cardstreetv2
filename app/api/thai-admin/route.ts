/**
 * GET /api/thai-admin — progressive slices of the canonical Thai
 * administrative-area dataset for the cascading address selects
 * (components/ThaiAddressFields.tsx).
 *
 *   /api/thai-admin                          -> { provinces: [{t,e}] }
 *   /api/thai-admin?province=X               -> { districts: [{t,e}] }        (อำเภอ/เขต)
 *   /api/thai-admin?province=X&district=Y    -> { subdistricts: [{t,e,z}] }   (ตำบล/แขวง + zip)
 *
 * The 485 KB dataset stays server-side (see lib/thaiAdminAreas.ts); the
 * browser only ever pulls the ≤ a-few-KB slice it needs. Unknown parents
 * return empty lists, not 404s — the selects just render empty.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listProvinces, listDistricts, listSubdistricts } from '@/lib/thaiAdminAreas';

export const runtime = 'nodejs';

// Static reference data — cache hard at the CDN and in the browser.
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

export async function GET(req: NextRequest) {
    const province = req.nextUrl.searchParams.get('province');
    const district = req.nextUrl.searchParams.get('district');

    let body: Record<string, unknown>;
    if (province && district) {
        body = { subdistricts: listSubdistricts(province, district) || [] };
    } else if (province) {
        body = { districts: listDistricts(province) || [] };
    } else {
        body = { provinces: listProvinces() };
    }

    return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_CONTROL } });
}
