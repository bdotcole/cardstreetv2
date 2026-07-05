/**
 * Sync sealed-product snapshots stored in listings.card_data and
 * collection_items.card_data with the sealed catalog.
 *
 * Fixes two things for every snapshot with isSealed=true:
 *   - `set`: was the product-type label ("Booster Box"), so tiles showed
 *     "Booster Box / BOOSTER BOX". Becomes the real set display name (same
 *     conventions the live mapper uses via displaySetName), falling back to
 *     the product-type label when the product has no resolvable set.
 *   - `imageUrl` / `images`: repointed to the product's current image_url,
 *     which picks up the background-stripped mirror once
 *     scripts/ingest/mirror-sealed-images.mjs has run. Only updated when the
 *     catalog image lives on our storage, so a run before the mirror job
 *     still fixes names without re-hotlinking anything.
 *
 * Dry-run by default; pass --commit to write. Idempotent.
 *
 * Usage: npx tsx scripts/backfill-sealed-snapshots.ts [--commit]
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { displaySetName } from '../lib/cardMapper';
import { productTypeLabel } from '../lib/sealedProduct';

// Worktree-friendly: fall back to the main tree's .env.local.
dotenv.config({ path: '.env.local' });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const mainEnv = 'C:/Users/brand/Downloads/cardstreet-tcg/.env.local';
    if (fs.existsSync(mainEnv)) dotenv.config({ path: mainEnv });
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const COMMIT = process.argv.includes('--commit');

async function main() {
    // Sealed catalog + set names (set_id is not a FK — resolve manually).
    const products = new Map<string, any>();
    let cursor: string | null = null;
    for (;;) {
        let q = supabase
            .from('sealed_products')
            .select('id, game, language, set_id, product_type, image_url')
            .order('id')
            .limit(1000);
        if (cursor) q = q.gt('id', cursor);
        const { data, error } = await q;
        if (error) throw error;
        for (const r of data!) products.set(r.id, r);
        if (!data || data.length < 1000) break;
        cursor = data[data.length - 1].id;
    }

    const setIds = [...new Set([...products.values()].map((p) => p.set_id).filter(Boolean))];
    const setNames = new Map<string, string>();
    for (let i = 0; i < setIds.length; i += 200) {
        const { data, error } = await supabase
            .from('pokemon_sets')
            .select('id, name')
            .in('id', setIds.slice(i, i + 200));
        if (error) throw error;
        for (const s of data!) setNames.set(s.id, s.name);
    }

    const displaySetFor = (p: any): string => {
        const raw = p.set_id ? setNames.get(p.set_id) : undefined;
        if (raw) return displaySetName(p.game || 'pokemon', p.language, p.set_id, raw);
        return productTypeLabel(p.product_type, false);
    };

    for (const table of ['listings', 'collection_items'] as const) {
        const { data: rows, error } = await supabase
            .from(table)
            .select('id, card_data')
            .filter('card_data->>isSealed', 'eq', 'true')
            .limit(5000);
        if (error) throw error;

        let updated = 0, unmatched = 0, unchanged = 0;
        for (const row of rows || []) {
            const cd = row.card_data || {};
            const product = products.get(cd.id);
            if (!product) {
                unmatched++;
                console.log(`  ${table} ${row.id}: no sealed product for card_data.id=${cd.id}`);
                continue;
            }

            const next = { ...cd, set: displaySetFor(product) };
            // Snapshots only follow the catalog image once it's on our storage
            // (post-mirror, background-stripped) — never repoint to a hotlink.
            if (product.image_url && product.image_url.includes('/card-images/sealed/')) {
                next.imageUrl = product.image_url;
                next.images = { small: product.image_url, large: product.image_url };
            }

            if (JSON.stringify(next) === JSON.stringify(cd)) {
                unchanged++;
                continue;
            }

            console.log(`  ${table} ${row.id}: set "${cd.set}" -> "${next.set}"${next.imageUrl !== cd.imageUrl ? ', image repointed' : ''}`);
            if (COMMIT) {
                const { error: upErr } = await supabase.from(table).update({ card_data: next }).eq('id', row.id);
                if (upErr) {
                    console.log(`  FAIL ${table} ${row.id}: ${upErr.message}`);
                    continue;
                }
            }
            updated++;
        }
        console.log(`${table}: ${updated} ${COMMIT ? 'updated' : 'would update'}, ${unchanged} already correct, ${unmatched} unmatched`);
    }

    if (!COMMIT) console.log('\nDry run — re-run with --commit to write.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
