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
 *
 * The unfurl is STATUS-AWARE, mirroring ShareShowButton's message variants:
 * live gets a "LIVE •" title prefix, scheduled gets "Upcoming • {date}" plus
 * the start time (and the presale pitch when spots are reservable) in the
 * description, ended/cancelled degrade to a plain "catch the next show" card
 * — a stale unfurl must not promise a live stream.
 */

// Bangkok wall clock — the share audience is Thailand; the crawler's tz is
// meaningless.
function bangkokTime(iso: string | null, locale: string, opts: Intl.DateTimeFormatOptions) {
    const ts = iso ? Date.parse(iso) : NaN;
    if (Number.isNaN(ts)) return null;
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'Asia/Bangkok' }).format(ts);
}

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
            .select(
                'title, cover_image_url, status, scheduled_at, seller:profiles!streams_seller_id_fkey(display_name)',
            )
            .eq('id', id)
            .maybeSingle<{
                title: string;
                cover_image_url: string | null;
                status: string;
                scheduled_at: string | null;
                seller: { display_name: string | null } | null;
            }>();
        if (!data?.title) return fallback;

        const sellerName = data.seller?.display_name || null;
        const phase =
            data.status === 'live' || data.status === 'scheduled' ? data.status : 'ended';

        // The scheduled description pitches the presale when spots are
        // reservable. Fails soft pre-20260810_presales.sql (missing column
        // errors → null data → false), like the streams-feed annotation.
        let presaleOpen = false;
        if (phase === 'scheduled') {
            const { data: presaleLots } = await admin
                .from('stream_items')
                .select('id')
                .eq('stream_id', id)
                .eq('presale_enabled', true)
                .limit(1);
            presaleOpen = (presaleLots?.length ?? 0) > 0;
        }

        // og:title, e.g. "LIVE • {title} | ..." / "Upcoming • 15 Aug • {title} | ...".
        const shortDate = bangkokTime(data.scheduled_at, 'en-GB', {
            day: 'numeric',
            month: 'short',
        });
        const title =
            phase === 'live'
                ? `LIVE • ${data.title} | CardStreet Live`
                : phase === 'scheduled'
                  ? `Upcoming${shortDate ? ` • ${shortDate}` : ''} • ${data.title} | CardStreet Live`
                  : `${data.title} | CardStreet Live`;

        // Thai copy on purpose: /live is outside middleware's locale matcher
        // (see app/live/layout.tsx), and the share audience is LINE/FB Thailand.
        const when =
            bangkokTime(data.scheduled_at, 'th-TH', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            }) ?? 'เร็วๆ นี้';
        const description =
            phase === 'live'
                ? sellerName
                    ? `ไลฟ์เปิดการ์ดสดโดย ${sellerName} บน CardStreet`
                    : 'ไลฟ์เปิดการ์ดสดบน CardStreet'
                : phase === 'scheduled'
                  ? presaleOpen
                      ? sellerName
                          ? `ไลฟ์เริ่ม ${when} — พรีเซลเปิดแล้ว จองช่องกับ ${sellerName} ได้เลยบน CardStreet`
                          : `ไลฟ์เริ่ม ${when} — พรีเซลเปิดแล้ว จองช่องได้เลยบน CardStreet`
                      : sellerName
                        ? `ไลฟ์เริ่ม ${when} — พบกับ ${sellerName} ได้บน CardStreet`
                        : `ไลฟ์เริ่ม ${when} บน CardStreet`
                  : sellerName
                    ? `${sellerName} ไลฟ์เปิดการ์ดบน CardStreet — ติดตามไลฟ์รอบหน้าได้เลย`
                    : 'ไลฟ์เปิดการ์ดบน CardStreet — ติดตามไลฟ์รอบหน้าได้เลย';
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
