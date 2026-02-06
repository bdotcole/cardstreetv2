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
        case '1D':
            const oneDayAgo = new Date(now);
            oneDayAgo.setHours(now.getHours() - 24);
            return {
                startTime: oneDayAgo,
                endTime: now,
                interval: 'hour',
                pointCount: 24
            };

        case '1W':
            const oneWeekAgo = new Date(now);
            oneWeekAgo.setDate(now.getDate() - 7);
            return {
                startTime: oneWeekAgo,
                endTime: now,
                interval: 'day',
                pointCount: 7
            };

        case '1M':
            const oneMonthAgo = new Date(now);
            oneMonthAgo.setDate(now.getDate() - 30);
            return {
                startTime: oneMonthAgo,
                endTime: now,
                interval: 'day',
                pointCount: 30
            };

        case '1Y':
            const oneYearAgo = new Date(now);
            oneYearAgo.setMonth(now.getMonth() - 12);
            return {
                startTime: oneYearAgo,
                endTime: now,
                interval: 'month',
                pointCount: 12
            };

        default:
            // Default to 1M
            const defaultStart = new Date(now);
            defaultStart.setDate(now.getDate() - 30);
            return {
                startTime: defaultStart,
                endTime: now,
                interval: 'day',
                pointCount: 30
            };
    }
}

function generateTimeSlots(startTime: Date, endTime: Date, interval: string, pointCount: number): Date[] {
    const slots: Date[] = [];
    const timeSpan = endTime.getTime() - startTime.getTime();
    const step = timeSpan / (pointCount - 1);

    for (let i = 0; i < pointCount; i++) {
        const slotTime = new Date(startTime.getTime() + (step * i));
        slots.push(slotTime);
    }

    return slots;
}

function zeroFillData(
    expectedSlots: Date[],
    snapshots: { timestamp: string; total_market_value: number }[]
): { timestamp: Date; total_market_value: number }[] {
    const result: { timestamp: Date; total_market_value: number }[] = [];
    let lastKnownValue = 0;
    let snapshotIndex = 0;

    // Convert snapshot timestamps to Date objects
    const snapshotDates = snapshots.map(s => ({
        timestamp: new Date(s.timestamp),
        total_market_value: s.total_market_value
    }));

    for (const slot of expectedSlots) {
        // Find snapshots up to this time slot
        while (
            snapshotIndex < snapshotDates.length &&
            snapshotDates[snapshotIndex].timestamp <= slot
        ) {
            lastKnownValue = snapshotDates[snapshotIndex].total_market_value;
            snapshotIndex++;
        }

        // Use last known value or 0 for new accounts
        result.push({
            timestamp: slot,
            total_market_value: lastKnownValue
        });
    }

    return result;
}

async function getPortfolioHistory(
    userId: string,
    timeRange: '1D' | '1W' | '1M' | '1Y'
): Promise<PortfolioHistoryPoint[]> {
    const supabase = await createClient();

    // Get time configuration
    const { startTime, endTime, interval, pointCount } = getTimeConfig(timeRange);

    // Query snapshots from database
    const { data: snapshots, error } = await supabase
        .from('portfolio_snapshots')
        .select('timestamp, total_market_value')
        .eq('user_id', userId)
        .gte('timestamp', startTime.toISOString())
        .lte('timestamp', endTime.toISOString())
        .order('timestamp', { ascending: true });

    if (error) {
        console.error('Error fetching portfolio snapshots:', error);
        throw new Error('Failed to fetch portfolio history');
    }

    // Calculate CURRENT portfolio value (for the end point)
    const { data: collections } = await supabase
        .from('collections')
        .select('id')
        .eq('user_id', userId)
        .eq('include_in_portfolio', true);

    let currentPortfolioValue = 0;

    if (collections && collections.length > 0) {
        const collectionIds = collections.map(c => c.id);

        const { data: items } = await supabase
            .from('collection_items')
            .select('card_data, quantity')
            .in('collection_id', collectionIds);

        if (items && items.length > 0) {
            currentPortfolioValue = items.reduce((total, item) => {
                const marketPrice = item.card_data?.marketPrice || 0;
                const quantity = item.quantity || 1;
                return total + (marketPrice * quantity);
            }, 0);
        }
    }

    // Generate expected time slots
    const expectedSlots = generateTimeSlots(startTime, endTime, interval, pointCount);

    // Zero-fill missing data
    const filledData = zeroFillData(expectedSlots, snapshots || []);

    // Format response and ensure last point is current value
    const formattedData = filledData.map(point => ({
        date: point.timestamp.toISOString(),
        value: point.total_market_value
    }));

    // Override the last data point with current actual portfolio value
    if (formattedData.length > 0) {
        formattedData[formattedData.length - 1].value = currentPortfolioValue;
    }

    return formattedData;
}

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();

        // Get current user
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get timeRange from query params
        const searchParams = request.nextUrl.searchParams;
        const timeRange = searchParams.get('range') as '1D' | '1W' | '1M' | '1Y' || '1M';

        // Fetch portfolio history
        const history = await getPortfolioHistory(user.id, timeRange);

        return NextResponse.json({
            success: true,
            data: history,
            range: timeRange
        });

    } catch (error: any) {
        console.error('Portfolio history error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch portfolio history' },
            { status: 500 }
        );
    }
}
