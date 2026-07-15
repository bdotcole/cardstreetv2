import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Vercel cron (daily — see vercel.json) records one portfolio_snapshots row per user
// who has a portfolio collection. The work runs here in the Next route rather than
// proxying to a Deno edge function, so it ships with the app (no separate function
// deploy) and can't silently rot. The previous edge function upserted with
// onConflict:'user_id,date_trunc' — a column/constraint that does not exist — so every
// insert failed and the table never grew past its Feb test seed. A plain append is
// correct here: /api/portfolio/history downsamples to one value per day bucket, so
// duplicate same-day rows are harmless.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SnapshotRow {
    user_id: string;
    total_market_value: number;
    item_count: number;
    timestamp: string;
}

export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const admin = createAdminClient();

        // Portfolio collections, grouped by owner.
        const { data: collections, error: colErr } = await admin
            .from('collections')
            .select('id, user_id')
            .eq('include_in_portfolio', true);
        if (colErr) throw colErr;

        const collectionsByUser = new Map<string, string[]>();
        for (const c of collections || []) {
            const list = collectionsByUser.get(c.user_id) ?? [];
            list.push(c.id);
            collectionsByUser.set(c.user_id, list);
        }

        const timestamp = new Date().toISOString();
        const rows: SnapshotRow[] = [];
        let errors = 0;

        // Aggregate per user so each item query stays well under the 1k-row default cap
        // (a single global select would silently truncate on large collections).
        for (const [userId, collectionIds] of collectionsByUser) {
            const { data: items, error: itemsErr } = await admin
                .from('collection_items')
                .select('quantity, card_data->marketPrice')
                .in('collection_id', collectionIds);
            if (itemsErr) {
                errors++;
                continue;
            }

            let totalValue = 0;
            let itemCount = 0;
            for (const it of items ?? []) {
                const price = Number((it as { marketPrice?: unknown }).marketPrice) || 0;
                const qty = (it as { quantity?: number }).quantity || 1;
                totalValue += price * qty;
                itemCount += qty;
            }

            // Only record users who actually hold something — an empty portfolio
            // collection has no honest value to plot.
            if (itemCount > 0) {
                rows.push({
                    user_id: userId,
                    total_market_value: Math.round(totalValue * 100) / 100,
                    item_count: itemCount,
                    timestamp,
                });
            }
        }

        if (rows.length > 0) {
            const { error: insertErr } = await admin.from('portfolio_snapshots').insert(rows);
            if (insertErr) throw insertErr;
        }

        return NextResponse.json({
            success: true,
            snapshotsCreated: rows.length,
            errors,
            timestamp,
        });
    } catch (error: any) {
        console.error('Portfolio snapshot cron error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create snapshots' },
            { status: 500 }
        );
    }
}
