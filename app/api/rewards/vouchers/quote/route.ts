/**
 * POST /api/rewards/vouchers/quote { items: [{id}] } — the buyer's active
 * vouchers with the EXACT discount each would take on this cart.
 *
 * The discount is funded from the platform fee, so its ceiling is the cart's
 * total fee — which depends on each seller's partner tier / Pro status. The
 * client can't know that, and showing a face value the fee can't cover would
 * either break the no-overcharge guard or silently shrink at payment. This
 * quote runs the SAME fee rules as /api/orders/checkout (partnerTiers ladder,
 * Pro floor, admin = 0) against the same rows, so the number the buyer picks
 * is the number the checkout applies.
 */

import { NextResponse } from 'next/server';
import { requireBeta, isFeatureEnabled } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { listActiveVouchers } from '@/lib/rewards';
import { voucherDiscountSatang } from '@/lib/rewardTiers';
import { applyProSellerRate, effectivePartnerLevel, feeFractionForLevel, NON_PARTNER_FEE_FRACTION } from '@/lib/partnerTiers';
import { isPremium } from '@/lib/entitlements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const gate = await requireBeta('rewards');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    try {
        if (!(await isFeatureEnabled('rewards_vouchers'))) {
            return NextResponse.json({ enabled: false, vouchers: [] });
        }

        const body = await req.json().catch(() => ({}));
        const ids = (Array.isArray(body?.items) ? body.items : [])
            .map((i: { id?: unknown }) => i?.id)
            .filter((x: unknown): x is string => typeof x === 'string')
            .slice(0, 50);
        if (ids.length === 0) {
            return NextResponse.json({ enabled: true, vouchers: [] });
        }

        const admin = createAdminClient();
        const { data: listings } = await admin
            .from('listings')
            .select('id, price, seller_id')
            .in('id', ids);
        const rows = (listings ?? []) as { id: string; price: number; seller_id: string }[];
        if (rows.length === 0) {
            return NextResponse.json({ enabled: true, vouchers: [] });
        }

        const sellerIds = [...new Set(rows.map((r) => r.seller_id))];
        const { data: sellers } = await admin
            .from('profiles')
            .select('id, role, partner_joined_at, partner_level, total_downloads, premium_until')
            .in('id', sellerIds);

        const feeMap = new Map<string, number>();
        for (const p of (sellers ?? []) as {
            id: string; role: string | null; partner_joined_at: string | null;
            partner_level: unknown; total_downloads: number | null; premium_until: string | null;
        }[]) {
            let fee = NON_PARTNER_FEE_FRACTION;
            if (p.partner_joined_at) {
                fee = feeFractionForLevel(effectivePartnerLevel(p.partner_level, p.total_downloads ?? 0));
            }
            feeMap.set(p.id, p.role === 'admin' ? 0 : applyProSellerRate(fee, isPremium(p.premium_until)));
        }

        let subtotalSatang = 0;
        let totalFeeSatang = 0;
        for (const r of rows) {
            const priceSatang = Math.round(Number(r.price) * 100);
            subtotalSatang += priceSatang;
            totalFeeSatang += Math.round(priceSatang * (feeMap.get(r.seller_id) ?? NON_PARTNER_FEE_FRACTION));
        }

        // A pending SELLER fee voucher auto-applies at checkout before the
        // buyer voucher clamps — mirror that here so the quoted buyer discount
        // is exactly what checkout computes (otherwise the no-overcharge guard
        // would 409 on partner-ish fee headroom).
        if (sellerIds.length === 1) {
            try {
                const { data: sfRows } = await admin
                    .from('reward_items')
                    .select('meta, expires_at')
                    .eq('user_id', sellerIds[0])
                    .like('item_key', 'seller_fee_%')
                    .eq('status', 'active')
                    .order('created_at', { ascending: true })
                    .limit(1);
                const sf = (sfRows ?? [])[0] as { meta: { amountSatang?: number } | null; expires_at: string | null } | undefined;
                if (sf && (!sf.expires_at || Date.parse(sf.expires_at) > Date.now())) {
                    totalFeeSatang = Math.max(
                        0,
                        totalFeeSatang - voucherDiscountSatang(Number(sf.meta?.amountSatang ?? 0), totalFeeSatang),
                    );
                }
            } catch { /* quote against the full fee — worst case a rare 409 retry */ }
        }

        const vouchers = (await listActiveVouchers(admin, user.id)).map((v) => {
            const face = Number(v.meta?.amountSatang ?? 0);
            const minOrder = Number(v.meta?.minOrderSatang ?? 0);
            const eligible = subtotalSatang >= minOrder;
            return {
                id: v.id,
                key: v.item_key,
                type: v.meta?.type ?? 'order',
                amountSatang: face,
                minOrderSatang: minOrder,
                expiresAt: v.expires_at,
                eligible,
                discountSatang: eligible ? voucherDiscountSatang(face, totalFeeSatang) : 0,
            };
        });

        return NextResponse.json({ enabled: true, subtotalSatang, totalFeeSatang, vouchers });
    } catch (err) {
        console.error('[Rewards/VoucherQuote] error:', err);
        return NextResponse.json({ enabled: false, vouchers: [] });
    }
}
