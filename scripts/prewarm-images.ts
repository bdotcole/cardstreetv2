/**
 * Pre-warm the Vercel image-optimizer edge cache for the catalog thumbnails a
 * new user is most likely to see first.
 *
 * Why: the grid thumbnails go through Next/Vercel's on-demand image optimizer.
 * The first time any given (image, width) pair is requested it's a cache MISS —
 * Vercel fetches the source and transcodes it (~0.9-1s). After the multi-game
 * expansion the catalog is ~6x larger, so a brand-new user browsing fresh sets
 * hits a wall of cold transforms. This script requests those same optimizer
 * URLs ahead of time so the user gets warm HITs (~0.2-0.45s) instead.
 *
 * It reuses the exact transform logic the UI uses (getThumbnailUrl +
 * shouldSkipNextOptimization) so the warmed URLs match what the browser asks
 * for byte-for-byte. URLs that bypass the optimizer (tcgdex /low.webp, Supabase
 * render endpoint) are fetched directly instead, to prime their own CDN.
 *
 * Usage (tsx):
 *   npx tsx scripts/prewarm-images.ts
 *   npx tsx scripts/prewarm-images.ts --games=pokemon,yugioh --setsPerGame=15
 *   npx tsx scripts/prewarm-images.ts --base=https://cardstreet.app --concurrency=16
 *
 * Safe to re-run; warming is idempotent (it only populates a cache).
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { getThumbnailUrl, shouldSkipNextOptimization } from '../lib/imageUtils';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function arg(name: string, fallback: string): string {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=')[1] : fallback;
}

const BASE = arg('base', process.env.PREWARM_BASE_URL || 'https://cardstreet.app').replace(/\/$/, '');
const GAMES = arg('games', 'pokemon,yugioh,mtg,onepiece,lorcana,riftbound').split(',').map((g) => g.trim()).filter(Boolean);
const LANGS = arg('langs', 'en').split(',').map((l) => l.trim()).filter(Boolean);
const SETS_PER_GAME = parseInt(arg('setsPerGame', '12'), 10);
const CONCURRENCY = parseInt(arg('concurrency', '12'), 10);
// Widths the grids actually request: fixed-px thumbs (sizes="56px"/"80px") land
// on imageSize 256 at 2-3x DPR; the 33vw set-detail grid lands on deviceSize 640.
// 128 covers 1-2x DPR. q=75 is the next/image default.
const WIDTHS = arg('widths', '128,256,640').split(',').map((w) => parseInt(w.trim(), 10));

function optimizerUrl(src: string, w: number): string {
    return `${BASE}/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=75`;
}

let warmed = 0;
let direct = 0;
let errors = 0;

async function fetchOne(url: string, optimizer: boolean): Promise<void> {
    try {
        const res = await fetch(url, {
            // Match what a real browser sends so we warm the webp cache entry
            // (Vercel keys the optimizer cache on Accept).
            headers: optimizer ? { Accept: 'image/webp,*/*' } : {},
        });
        // Drain the body so the connection is reused and the transform completes.
        await res.arrayBuffer();
        if (!res.ok) {
            errors++;
            return;
        }
        if (optimizer) warmed++;
        else direct++;
    } catch {
        errors++;
    }
}

async function runPool(tasks: Array<() => Promise<void>>): Promise<void> {
    let i = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (i < tasks.length) {
            const idx = i++;
            await tasks[idx]();
            if ((warmed + direct + errors) % 200 === 0) {
                process.stdout.write(`  warmed=${warmed} direct=${direct} errors=${errors}\r`);
            }
        }
    });
    await Promise.all(workers);
}

async function main(): Promise<void> {
    console.log(`Pre-warming image cache via ${BASE}`);
    console.log(`Games: ${GAMES.join(', ')} | Langs: ${LANGS.join(', ')} | Top ${SETS_PER_GAME} sets/game | Widths: ${WIDTHS.join(', ')}\n`);

    const tasks: Array<() => Promise<void>> = [];

    for (const game of GAMES) {
        for (const lang of LANGS) {
            // Newest sets first — the default sort the sets API uses, i.e. what a
            // new user sees at the top of the browse list.
            const { data: sets, error: setsErr } = await supabase
                .from('pokemon_sets')
                .select('id, name')
                .eq('game', game)
                .eq('language', lang)
                .order('release_date', { ascending: false, nullsFirst: false })
                .limit(SETS_PER_GAME);

            if (setsErr) {
                console.warn(`  [${game}/${lang}] sets query failed: ${setsErr.message}`);
                continue;
            }
            if (!sets?.length) continue;

            for (const set of sets) {
                const { data: cards, error: cardsErr } = await supabase
                    .from('pokemon_cards')
                    .select('image_small, image_large')
                    .eq('set_id', set.id);

                if (cardsErr || !cards?.length) continue;

                for (const card of cards) {
                    const raw = card.image_small || card.image_large;
                    if (!raw) continue;
                    const thumb = getThumbnailUrl(raw);
                    if (!thumb || thumb.includes('placeholder')) continue;

                    if (shouldSkipNextOptimization(thumb)) {
                        // Loaded directly by the browser — prime its origin CDN once.
                        tasks.push(() => fetchOne(thumb, false));
                    } else {
                        for (const w of WIDTHS) {
                            tasks.push(() => fetchOne(optimizerUrl(thumb, w), true));
                        }
                    }
                }
                console.log(`  queued ${game}/${lang} ${set.id} (${set.name}) — ${tasks.length} total requests so far`);
            }
        }
    }

    console.log(`\nWarming ${tasks.length} requests at concurrency ${CONCURRENCY}...\n`);
    const t0 = Date.now();
    await runPool(tasks);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`\n\nDone in ${secs}s — optimizer warmed: ${warmed}, direct/CDN: ${direct}, errors: ${errors}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
