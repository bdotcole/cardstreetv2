// GET /ck/<ig|fb|yt|tt> — Chopper & Kuma's tracked short links (lib/socialLinks.ts).
import { NextRequest } from 'next/server';
import { shortLinkResponse } from '@/lib/socialLinks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    return shortLinkResponse(slug, 'chopper_kuma', request);
}
