import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import LiveViewerClient from './LiveViewerClient';

/**
 * Server wrapper for the viewer: its ONLY job is unfurl metadata. Shared
 * /live/[id] links must preview properly on Facebook / X / LINE (crawlers
 * never authenticate), so title / seller / cover are read via the service
 * role and served to everyone — that much is public by design, because
 * sharing requires it. The page CONTENT stays beta-gated: LiveViewerClient's
 * API fetches 404 without the grant exactly as before. Robots stays noindex
 * via app/live/layout.tsx (page metadata doesn't override it).
 */

export async function generateMetadata({
    params,
}: {
    params: Promise<{ id: string }>;
}): Promise<Metadata> {
    const fallback: Metadata = { title: 'ไลฟ์เปิดการ์ด | CardStreet' };
    try {
        const { id } = await params;
        const admin = createAdminClient();
        const { data } = await admin
            .from('streams')
            .select('title, cover_image_url, seller:profiles!streams_seller_id_fkey(display_name)')
            .eq('id', id)
            .maybeSingle<{
                title: string;
                cover_image_url: string | null;
                seller: { display_name: string | null } | null;
            }>();
        if (!data?.title) return fallback;

        const sellerName = data.seller?.display_name || null;
        const title = `${data.title} | CardStreet Live`;
        // Thai copy on purpose: /live is outside middleware's locale matcher
        // (see app/live/layout.tsx), and the share audience is LINE/FB Thailand.
        const description = sellerName
            ? `ไลฟ์เปิดการ์ดสดโดย ${sellerName} บน CardStreet`
            : 'ไลฟ์เปิดการ์ดสดบน CardStreet';
        return {
            title,
            description,
            openGraph: {
                type: 'website',
                siteName: 'CardStreet',
                url: `https://cardstreet.app/live/${id}`,
                title,
                description,
                // No cover set falls through to app/opengraph-image.tsx (the
                // sitewide card) via metadataBase in the root layout.
                ...(data.cover_image_url ? { images: [{ url: data.cover_image_url }] } : {}),
            },
            twitter: { card: 'summary_large_image', title, description },
        };
    } catch {
        return fallback;
    }
}

export default function LiveViewerRoute() {
    return <LiveViewerClient />;
}
