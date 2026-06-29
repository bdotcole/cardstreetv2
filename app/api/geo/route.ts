/**
 * GET /api/geo
 *
 * Client-readable view of the request's country and whether purchasing is
 * allowed from it. The mobile shell and desktop cart call this once to decide
 * whether to show the "Thailand only" popup at checkout. The authoritative
 * block lives server-side in /api/orders/checkout (and /api/checkout) — this
 * endpoint only drives UX, so it fails open.
 */

import { NextResponse } from 'next/server';
import {
    getRequestCountry,
    isPurchaseAllowedFromCountry,
    PURCHASE_ALLOWED_COUNTRY,
} from '@/lib/geo';

// Per-IP response — must run per request and never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const country = getRequestCountry(req);
    return NextResponse.json(
        {
            country,
            purchaseAllowed: isPurchaseAllowedFromCountry(country),
            purchaseCountry: PURCHASE_ALLOWED_COUNTRY,
        },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
