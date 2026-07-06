import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/adminAuth';
import { EXCHANGE_RATES } from '@/constants';

// Feature B admin surface (server/SQL parts; the panel UI is a documented follow-up).
//
// GET  /api/admin/internal-prices
//   Read-only visibility: learned/pinned market_values rows with their API shadow,
//   sale count, last sale, and a recent sale trail. Service-role read.
//
// POST /api/admin/internal-prices
//   Pin or release a price for a (card_id, language, condition) key.
//   Body: { card_id, language, condition, action, usd?, thb? }
//     action:'pin'     -> source='admin', market_avg = usd (or thb*0.028). Immutable
//                         until released; recompute + the clobber guard skip it.
//     action:'release' -> source='cardstreet' (fall back to sale-learning) or
//                         'api' (fall back to API + shadow), controlled by `to`.
//   The service-role client bypasses RLS; requireAdmin() gates the caller.

const THB_TO_USD = EXCHANGE_RATES['USD'] || 0.028;

export async function GET() {
    const gate = await requireAdmin();
    if (gate) return gate;

    const supabase = createAdminClient();
    // Learned/pinned rows + their sale trail. Bounded; freshest sale first.
    const { data, error } = await supabase
        .from('market_values')
        .select('card_id, language, condition, source, market_avg, api_reference_avg, internal_sale_count, internal_last_sale_at')
        .in('source', ['cardstreet', 'admin'])
        .order('internal_last_sale_at', { ascending: false, nullsFirst: false })
        .limit(200);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [] });
}

export async function POST(request: Request) {
    const gate = await requireAdmin();
    if (gate) return gate;

    const body = await request.json().catch(() => ({}));
    const cardId = typeof body.card_id === 'string' ? body.card_id : null;
    const language = typeof body.language === 'string' ? body.language : null;
    const condition = typeof body.condition === 'string' ? body.condition : null;
    const action = body.action;

    if (!cardId || !language || !condition) {
        return NextResponse.json(
            { error: 'card_id, language, condition are required' },
            { status: 400 },
        );
    }

    const supabase = createAdminClient();

    // Re-read the key after a write to return the resulting row.
    const readRow = async () =>
        (await supabase
            .from('market_values')
            .select('card_id, language, condition, source, market_avg, api_reference_avg')
            .eq('card_id', cardId)
            .eq('language', language)
            .eq('condition', condition)
            .maybeSingle()).data;

    if (action === 'release') {
        // Release a pin: 'cardstreet' resumes sale-learning, 'api' reverts to API.
        // Goes through the guard-aware RPC so the guard treats it as a trusted write
        // (a plain UPDATE would be protected-against and could not revert to 'api').
        const to = body.to === 'api' ? 'api' : 'cardstreet';
        const { error } = await supabase.rpc('admin_release_internal_price', {
            p_card_id: cardId,
            p_language: language,
            p_condition: condition,
            p_to: to,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ row: await readRow() });
    }

    if (action === 'pin') {
        // Store USD. Accept usd directly, or thb (converted at the mapper's rate).
        let usd: number | null = null;
        if (Number.isFinite(body.usd)) usd = Number(body.usd);
        else if (Number.isFinite(body.thb)) usd = Number(body.thb) * THB_TO_USD;
        if (usd === null || !(usd > 0)) {
            return NextResponse.json(
                { error: 'pin requires a positive usd or thb value' },
                { status: 400 },
            );
        }

        // Guard-aware RPC: sets source='admin' with the explicit price in a single
        // transaction that signals the clobber guard to pass it through.
        const { error } = await supabase.rpc('admin_pin_internal_price', {
            p_card_id: cardId,
            p_language: language,
            p_condition: condition,
            p_usd: usd,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ row: await readRow() });
    }

    return NextResponse.json({ error: "action must be 'pin' or 'release'" }, { status: 400 });
}
