import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

interface PortfolioHistoryPoint {
    date: string;
    value: number;
}

interface TimeConfig {
    startTime: Date;
    endTime: Date;
    interval: 'hour' | 'day' | 'month';
    pointCount: number;
}

function getTimeConfig(timeRange: string): TimeConfig {
    const now = new Date();

    switch (timeRange) {
        case '1D': {
            const start = new Date(now);
            start.setHours(now.getHours() - 24);
            return { startTime: start, endTime: now, interval: 'hour', pointCount: 24 };
        }
        case '1W': {
            const start = new Date(now);
            start.setDate(now.getDate() - 7);
            return { startTime: start, endTime: now, interval: 'day', pointCount: 7 };
        }
        case '1M': {
            const start = new Date(now);
            start.setDate(now.getDate() - 30);
            return { startTime: start, endTime: now, interval: 'day', pointCount: 30 };
        }
        case '1Y': {
            const start = new Date(now);
            start.setMonth(now.getMonth() - 12);
            return { startTime: start, endTime: now, interval: 'month', pointCount: 12 };
        }
        default: {
            const start = new Date(now);
            start.setDate(now.getDate() - 30);
            return { startTime: start, endTime: now, interval: 'day', pointCount: 30 };
        }
    }
}

function generateTimeSlots(startTime: Date, endTime: Date, pointCount: number): Date[] {
    const slots: Date[] = [];
    const step = (endTime.getTime() - startTime.getTime()) / (pointCount - 1);
    for (let i = 0; i < pointCount; i++) {
        slots.push(new Date(startTime.getTime() + step * i));
    }
    return slots;
}

function zeroFillData(
    slots: Date[],
    snapshots: { timestamp: string; total_market_value: number }[]
): { timestamp: Date; total_market_value: number }[] {
    let lastKnownValue = snapshots.length > 0 ? snapshots[0].total_market_value : 0;
    let snapshotIndex = 0;
    const snapshotDates = snapshots.map(s => ({
        timestamp: new Date(s.timestamp),
        total_market_value: s.total_market_value
    }));

    return slots.map(slot => {
        while (snapshotIndex < snapshotDates.length && snapshotDates[snapshotIndex].timestamp <= slot) {
            lastKnownValue = snapshotDates[snapshotIndex].total_market_value;
            snapshotIndex++;
        }
        return { timestamp: slot, total_market_value: lastKnownValue };
    });
}

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const timeRange = (request.nextUrl.searchParams.get('range') as '1D' | '1W' | '1M' | '1Y') || '1M';
        const { startTime, endTime, interval, pointCount } = getTimeConfig(timeRange);

        // ─── Collapsed: 3 sequential queries → 2 parallel queries ────────────
        const [snapshotResult, itemsResult] = await Promise.all([
            // Query 1: recent snapshots for chart history
            supabase
                .from('portfolio_snapshots')
                .select('timestamp, total_market_value')
                .eq('user_id', user.id)
                .gte('timestamp', startTime.toISOString())
                .lte('timestamp', endTime.toISOString())
                .order('timestamp', { ascending: true }),

            // Query 2: current value via joined select (was 2 sequential queries before).
            // Only the price is needed for the sum — pulling the whole card_data
            // JSONB blob per row was a large, pointless payload on big collections.
            supabase
                .from('collection_items')
                .select('quantity, card_data->marketPrice, collections!inner(user_id, include_in_portfolio)')
                .eq('collections.user_id', user.id)
                .eq('collections.include_in_portfolio', true),
        ]);

        if (snapshotResult.error) throw snapshotResult.error;

        // Calculate current portfolio value from joined items
        const currentPortfolioValue = (itemsResult.data || []).reduce((total: number, item: any) => {
            const marketPrice = Number(item?.marketPrice) || 0;
            return total + marketPrice * (item?.quantity || 1);
        }, 0);

        console.log(`[Portfolio API] User: ${user.id}, Range: ${timeRange}, Current: ฿${currentPortfolioValue}`);

        const slots = generateTimeSlots(startTime, endTime, pointCount);
        const filled = zeroFillData(slots, snapshotResult.data || []);

        const data: PortfolioHistoryPoint[] = filled.map((p, i) => ({
            date: p.timestamp.toISOString(),
            // Last point always reflects current real value
            value: i === filled.length - 1 ? currentPortfolioValue : p.total_market_value,
        }));

        return NextResponse.json({ success: true, data, range: timeRange }, {
            headers: {
                // Portfolio data is personal — private cache only. 60s is fine for a chart.
                'Cache-Control': 'private, max-age=60, stale-while-revalidate=30',
            }
        });

    } catch (error: any) {
        console.error('Portfolio history error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch portfolio history' },
            { status: 500 }
        );
    }
}
