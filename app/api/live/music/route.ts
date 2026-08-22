/**
 * GET /api/live/music — the broadcaster's background-music library.
 *
 * Tracks are whatever audio files sit in the public `live-music` storage
 * bucket. A bucket rather than bundled assets on purpose: music licensing is
 * a business decision, so the founder curates royalty-free tracks by dropping
 * files into the bucket — no deploy, and nothing in the repo asserts rights
 * over any recording. Empty/missing bucket = empty library, never an error.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';

const BUCKET = 'live-music';
const AUDIO_RE = /\.(mp3|m4a|aac|ogg|wav)$/i;

export async function GET() {
    try {
        const gate = await requireBeta('live_broadcast');
        if (gate instanceof NextResponse) return gate;

        const admin = createAdminClient();
        const { data, error } = await admin.storage.from(BUCKET).list('', {
            limit: 200,
            sortBy: { column: 'name', order: 'asc' },
        });
        if (error) {
            // Bucket not created yet — an empty library, not a fault.
            return NextResponse.json({ tracks: [] });
        }
        const tracks = (data ?? [])
            .filter((f) => AUDIO_RE.test(f.name))
            .map((f) => ({
                name: f.name.replace(/\.[a-z0-9]+$/i, ''),
                url: admin.storage.from(BUCKET).getPublicUrl(f.name).data.publicUrl,
            }));
        return NextResponse.json({ tracks });
    } catch (err) {
        console.error('[Live/Music] list error:', err);
        return NextResponse.json({ tracks: [] });
    }
}
