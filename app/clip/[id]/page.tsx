import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { isFeatureDisabledInCode } from '@/lib/betaFeatures';
import ClipPlayer from '@/components/live/ClipPlayer';

/**
 * Public share page for one clip.
 *
 * Clips exist to be shared, so like /live/[id] this reads through the service
 * role and unfurls for crawlers that never authenticate. What it exposes is
 * deliberately minimal and already public by intent: the clip window, the
 * show's title and cover, and the seller's display name.
 *
 * A clip is a window into the show's VOD, so the page has three states:
 * playable, still-processing (the show ended but egress has not finished), and
 * expired (VODs are kept 30 days).
 */

export const dynamic = 'force-dynamic';

interface ClipRow {
    id: string;
    title: string | null;
    start_ms: number;
    end_ms: number;
    vod_url: string | null;
    created_at: string;
    stream_id: string;
    streams: {
        title: string;
        cover_image_url: string | null;
        status: string;
        vod_url: string | null;
        vod_expires_at: string | null;
        profiles: { display_name: string | null } | null;
    } | null;
}

const CLIP_COLS =
    'id, title, start_ms, end_ms, vod_url, created_at, stream_id, ' +
    'streams(title, cover_image_url, status, vod_url, vod_expires_at, ' +
    'profiles!streams_seller_id_fkey(display_name))';

async function loadClip(id: string): Promise<ClipRow | null> {
    // Clips are windows into a live show, so they go dark with the rest of the
    // Live section -- no stranded share link pointing at a 404 hub.
    if (isFeatureDisabledInCode('live_streams')) return null;
    try {
        const admin = createAdminClient();
        const { data } = await admin
            .from('stream_clips')
            .select(CLIP_COLS)
            .eq('id', id)
            .maybeSingle<ClipRow>();
        return data ?? null;
    } catch {
        // Pre-migration or a bad id — the page renders its not-found state.
        return null;
    }
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ id: string }>;
}): Promise<Metadata> {
    const { id } = await params;
    const clip = await loadClip(id);
    if (!clip) return { title: 'คลิป | CardStreet' };
    const show = clip.streams?.title ?? 'CardStreet Live';
    const seller = clip.streams?.profiles?.display_name;
    const title = clip.title ? `${clip.title} — ${show}` : `คลิปจาก ${show}`;
    return {
        title: `${title} | CardStreet`,
        description: seller
            ? `ไฮไลต์จากไลฟ์เปิดการ์ดของ ${seller} — ดูคลิปบน CardStreet`
            : 'ไฮไลต์จากไลฟ์เปิดการ์ดบน CardStreet',
        openGraph: {
            title,
            images: clip.streams?.cover_image_url ? [clip.streams.cover_image_url] : undefined,
            type: 'video.other',
        },
    };
}

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
    if (isFeatureDisabledInCode('live_streams')) notFound();
    const { id } = await params;
    const clip = await loadClip(id);

    if (!clip) {
        return (
            <main className="min-h-screen bg-brand-darker text-white flex flex-col items-center justify-center px-6 text-center">
                <i className="fa-solid fa-scissors text-slate-600 text-4xl mb-4"></i>
                <h1 className="text-lg font-black">คลิปนี้ไม่มีอยู่แล้ว</h1>
                <p className="text-sm text-slate-400 mt-1">This clip is no longer available.</p>
                <Link href="/live" className="mt-6 px-5 py-2.5 rounded-full bg-brand-cyan text-slate-950 text-xs font-black uppercase tracking-widest">
                    ดูไลฟ์อื่น / Browse live shows
                </Link>
            </main>
        );
    }

    // The clip's own copy wins; fall back to the stream's in case the clip was
    // created before egress finished and the backfill has not run yet.
    const src = clip.vod_url ?? clip.streams?.vod_url ?? null;
    const expired =
        !!clip.streams?.vod_expires_at && Date.parse(clip.streams.vod_expires_at) < Date.now();
    const show = clip.streams?.title ?? 'CardStreet Live';
    const seller = clip.streams?.profiles?.display_name;

    return (
        <main className="min-h-screen bg-brand-darker text-white">
            <div className="max-w-3xl mx-auto px-4 py-6">
                <Link href={`/live/${clip.stream_id}`} className="text-xs text-brand-cyan font-bold">
                    ← {show}
                </Link>

                <h1 className="mt-3 text-xl font-black leading-tight">
                    {clip.title || 'ไฮไลต์ / Highlight'}
                </h1>
                {seller && <p className="text-xs text-slate-400 mt-1">{seller}</p>}

                <div className="mt-4">
                    {src && !expired ? (
                        <ClipPlayer
                            src={src}
                            startMs={clip.start_ms}
                            endMs={clip.end_ms}
                            poster={clip.streams?.cover_image_url}
                        />
                    ) : (
                        <div className="w-full aspect-video rounded-2xl bg-black/60 border border-white/10 flex flex-col items-center justify-center text-center px-6">
                            <i
                                className={`fa-solid ${expired ? 'fa-hourglass-end' : 'fa-clock-rotate-left'} text-slate-500 text-3xl mb-3`}
                            ></i>
                            <p className="text-sm font-bold text-slate-200">
                                {expired ? 'คลิปนี้หมดอายุแล้ว' : 'กำลังเตรียมคลิป...'}
                            </p>
                            <p className="text-xs text-slate-500 mt-1 max-w-sm">
                                {expired
                                    ? 'Recordings are kept for 30 days.'
                                    : 'The recording is still processing — clips become watchable shortly after the show ends.'}
                            </p>
                        </div>
                    )}
                </div>

                <p className="mt-4 text-[11px] text-slate-500">
                    {Math.round((clip.end_ms - clip.start_ms) / 1000)}s ·{' '}
                    {new Date(clip.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })}
                </p>
            </div>
        </main>
    );
}
