/**
 * cardstreet.app/pay/<offerId> — the shareable pay link for an accepted offer.
 *
 * WHY A ROUTE AND NOT JUST A QUERY PARAM: this link's job is to survive being
 * pasted into LINE, which is where Thai buyers and sellers actually talk. A
 * bare `/?payOffer=<uuid>` is a link people do not press — it reads as a
 * tracking URL, and LINE renders it as one. `/pay/<id>` reads as what it is.
 *
 * It only redirects. The offer is validated by /api/orders/checkout at pay
 * time, which reads the price from the offers row server-side and refuses
 * anything not accepted, not the caller's, or already paid. Nothing here is
 * trusted, so the link is safe to forward: a stranger who opens it lands on
 * the marketplace with nothing pre-filled.
 *
 * 307, not 308: the destination is a UI state, not a permanent location, and a
 * cached permanent redirect would outlive the offer itself.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
    const { offerId } = await params;
    const url = request.nextUrl.clone();
    url.pathname = '/';
    // A malformed id drops the param rather than forwarding junk into the
    // shell's landing handler — the visitor still lands somewhere useful.
    url.search = UUID.test(offerId) ? `?payOffer=${offerId}` : '';
    return NextResponse.redirect(url, 307);
}
