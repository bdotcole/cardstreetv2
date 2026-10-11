/**
 * Shop minimum order — Profile > Seller Account.
 *
 *   GET  → { available, minOrderThb, max }
 *   POST { minOrderThb: number } → { minOrderThb }
 *
 * The seller's own setting for the smallest order their shop accepts (see
 * lib/minOrder.ts for the rule and why it exists). The write goes through the
 * service-role client but only ever touches the caller's own row and this one
 * column, so there is no id in the body to spoof.
 *
 * Fails soft before 20260929_shop_min_order.sql runs: GET reports
 * `available: false` and the card hides itself; POST answers 503.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MIN_ORDER_MAX_THB, normalizeMinOrder } from '@/lib/minOrder';

export const dynamic = 'force-dynamic';

// PostgREST/Postgres codes for "the migration has not run yet".
const MISSING_SCHEMA_CODES = new Set(['42703', 'PGRST204']);
function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
    if (!error) return false;
    if (error.code && MISSING_SCHEMA_CODES.has(error.code)) return true;
    return /min_order_thb/i.test(error.message || '') &&
        /does not exist|could not find|schema cache/i.test(error.message || '');
}

export async function GET() {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
        .from('profiles')
        .select('min_order_thb')
        .eq('id', user.id)
        .maybeSingle<{ min_order_thb: number | null }>();

    if (error) {
        if (isMissingColumn(error)) {
            return NextResponse.json({ available: false, minOrderThb: 0, max: MIN_ORDER_MAX_THB });
        }
        console.error('[Profile/Shop/MinOrder] read failed:', error);
        return NextResponse.json({ error: 'Failed to load minimum order' }, { status: 500 });
    }

    return NextResponse.json({
        available: true,
        minOrderThb: normalizeMinOrder(data?.min_order_thb),
        max: MIN_ORDER_MAX_THB,
    });
}

export async function POST(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const raw = body?.minOrderThb;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > MIN_ORDER_MAX_THB) {
        return NextResponse.json(
            { error: `minOrderThb must be a number from 0 to ${MIN_ORDER_MAX_THB}` },
            { status: 400 },
        );
    }
    const value = Math.floor(raw);

    const { error } = await createAdminClient()
        .from('profiles')
        .update({ min_order_thb: value })
        .eq('id', user.id);

    if (error) {
        if (isMissingColumn(error)) {
            return NextResponse.json(
                { error: 'Minimum order is not available yet', code: 'NOT_AVAILABLE' },
                { status: 503 },
            );
        }
        console.error('[Profile/Shop/MinOrder] write failed:', error);
        return NextResponse.json({ error: 'Failed to save minimum order' }, { status: 500 });
    }

    return NextResponse.json({ minOrderThb: value });
}
