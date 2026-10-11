// GET /ig — Cardstreet's tracked short link for the social bios (lib/socialLinks.ts).
import { NextRequest } from 'next/server';
import { shortLinkResponse } from '@/lib/socialLinks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
    return shortLinkResponse('ig', request);
}
