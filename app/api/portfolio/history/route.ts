import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

interface PortfolioHistoryPoint {
    date: string;
    value: number;
}

type Interval = 'hour' | 'day' | 'month';

// Window start + the granularity we bucket real snapshots into for each range.
// Snapshots are captured hourly, so a day/month bucket collapses many rows into the
// last real value we saw in that period — never a fabricated one.
function getRangeConfig(timeRange: string): { startTime: Date; interval: Interval } {
    const now = new Date();
    const start = new Date(now);
    switch (timeRange) {
        case '1D':
            start.setHours(now.getHours() - 24);
            return { startTime: start, interval: 'hour' };
        case '1W':
            start.setDate(now.getDate() - 7);
            return { startTime: start, interval: 'day' };
        case '1Y':
            start.setMonth(now.getMonth() - 12);
            return { startTime: start, interval: 'month' };
        case '1M':
        default:
            start.setDate(now.getDate() - 30);
            return { startTime: start, interval: 'day' };
    }
}

// Truncate an ISO timestamp to the bucket granularity so one real value survives per
// hour / day / month (the last snapshot in the bucket wins).
function bucketKey(iso: string, interval: Interval): string {
    if (interval === 'hour') return iso.slice(0, 13); // YYYY-MM-DDTHH
    if (interval === 'day') return iso.slice(0, 10); // YYYY-MM-DD
    return iso.slice(0, 7); // YYYY-MM
}

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const timeRange = (request.nextUrl.searchParams.get('range') as '1D' | '1W' | '1M' | '1Y') || '1M';
        const { startTime, interval } = getRangeConfig(timeRange);
        const now = new Date();

        const [snapshotResult, itemsResult] = await Promise.all([
            // Real snapshots inside the window, oldest first.
            supabase
                .from('portfolio_snapshots')
                .select('timestamp, total_market_value')
                .eq('user_id', user.id)
                .gte('timestamp', startTime.toISOString())
                .lte('timestamp', now.toISOString())
                .order('timestamp', { ascending: true }),

            // Current live value. Only the price is needed for the sum — pulling the
            // whole card_data JSONB blob per row was a large, pointless payload.
            supabase
                .from('collection_items')
                .select('quantity, card_data->marketPrice, collections!inner(user_id, include_in_portfolio)')
                .eq('collections.user_id', user.id)
                .eq('collections.include_in_portfolio', true),
        ]);

        if (snapshotResult.error) throw snapshotResult.error;

        const currentPortfolioValue = (itemsResult.data || []).reduce((total: number, item: any) => {
            const marketPrice = Number(item?.marketPrice) || 0;
            return total + marketPrice * (item?.quantity || 1);
        }, 0);

        // Downsample the real snapshots to one point per bucket. No zero-fill and no
        // carry-forward before the first tracked snapshot: the line reflects only
        // value we actually recorded, so the fitted Y-axis shows real movement rather
        // than a flat run of invented points. (Mirrors the card price-history chart,
        // which plots stored snapshots and folds in the live price as "now".)
        const byBucket = new Map<string, PortfolioHistoryPoint>();
        for (const s of snapshotResult.data || []) {
            byBucket.set(bucketKey(s.timestamp, interval), {
                date: s.timestamp,
                value: Number(s.total_market_value) || 0,
            });
        }
        const data: PortfolioHistoryPoint[] = Array.from(byBucket.values());

        // Fold the live value in as the final "now" point — it's the real valuation
        // this instant. Replace the last point if it lands in the current bucket so we
        // don't double-plot today; otherwise append it. Skip only when there is neither
        // history nor a current value (nothing honest to draw).
        if (currentPortfolioValue > 0 || data.length > 0) {
            const nowIso = now.toISOString();
            const nowKey = bucketKey(nowIso, interval);
            const last = data[data.length - 1];
            if (last && bucketKey(last.date, interval) === nowKey) {
                data[data.length - 1] = { date: nowIso, value: currentPortfolioValue };
            } else {
                data.push({ date: nowIso, value: currentPortfolioValue });
            }
        }

        return NextResponse.json({ success: true, data, range: timeRange }, {
            headers: {
                // Portfolio data is personal — private cache only. 60s is fine for a chart.
                'Cache-Control': 'private, max-age=60, stale-while-revalidate=30',
            },
        });

    } catch (error: any) {
        console.error('Portfolio history error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch portfolio history' },
            { status: 500 }
        );
    }
}
