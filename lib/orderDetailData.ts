import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { embedArray } from '@/lib/utils/embed';
import { handoffOf, hasShippingLabel } from '@/lib/orderGroups';
import { resolveBreakOrderContexts } from '@/lib/breakOrderContext';
import { fetchPublicSellers } from '@/lib/publicProfiles';
import type { OrderDetailData, OrderRole } from '@/components/orders/OrderDetail';

/**
 * Everything the order page needs, loaded once for both routes that render
 * it: the standalone phone page at app/orders/[id] and the desktop-shell page
 * at app/desktop/orders/[id] (the middleware rewrites desktop browsers there).
 * Server-only: it reads the session and then uses the service-role client.
 */
export type OrderDetailResult =
    | { kind: 'signed_out' }
    | { kind: 'not_found' }
    | { kind: 'ok'; order: OrderDetailData; role: OrderRole };

export async function loadOrderDetail(id: string): Promise<OrderDetailResult> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { kind: 'signed_out' };

    // Authorize via RLS: the orders SELECT policy returns the row only when the
    // viewer is its buyer or seller. No row => not theirs (or doesn't exist).
    const { data: authz } = await supabase
        .from('orders')
        .select('id, buyer_id, seller_id')
        .eq('id', id)
        .maybeSingle();
    if (!authz) return { kind: 'not_found' };

    const role: OrderRole = authz.seller_id === user.id ? 'seller' : 'buyer';

    // Full detail via the service-role client: a sold listing is hidden from the
    // session client by RLS, so the card snapshot would come back null otherwise
    // (same reason app/api/profile/orders uses the admin client).
    const admin = createAdminClient();
    // `*` rather than a column list: the dispute columns arrive with migration
    // 20260907_order_disputes.sql (and the label handoff columns with
    // 20261016_shipping_label_handoff.sql); a named select would 42703
    // before they run.
    const counterpartId = role === 'seller' ? authz.buyer_id : authz.seller_id;
    const [{ data: order }, counterparts] = await Promise.all([
        admin
            .from('orders')
            .select(`
                *,
                listing:listings(card_data, condition, is_graded, grading_company, grade, price),
                shipping_labels(*)
            `)
            .eq('id', id)
            .single(),
        // The other party, from the public_profiles view (display data only,
        // never phone or address): the shop a buyer bought from, or the buyer
        // a seller is packing for. Fails soft to null.
        fetchPublicSellers(admin, [counterpartId]),
    ]);
    if (!order) return { kind: 'not_found' };

    // The buyer's review of this order, if any (one per order).
    const { data: reviewRow } = role === 'buyer'
        ? await admin.from('reviews').select('rating, comment').eq('order_id', id).maybeSingle()
        : { data: null };

    const listing = (order.listing ?? null) as any;
    const card = (listing?.card_data ?? {}) as any;
    const label = embedArray(order.shipping_labels)[0] as any | undefined;
    const trackingNumber = label?.tracking_number && label.tracking_number !== 'MANUAL'
        ? String(label.tracking_number)
        : null;
    // A parcel the seller shipped outside our Flash waybill travels under
    // whatever carrier and number they entered (lib/parcels handOffParcel);
    // the Flash waybill and its tracking link no longer describe it.
    const handoff = handoffOf(label);
    const tracking: OrderDetailData['tracking'] = handoff
        ? { number: handoff.trackingNumber, url: null, carrier: handoff.carrier }
        : trackingNumber
            ? { number: trackingNumber, url: label?.courier_tracking_url ?? null, carrier: null }
            : null;

    // Live-break spot orders have no listing snapshot — resolve stream/lot/
    // spot context so this page (the email deep-link target) shows
    // "<stream> — <lot> · Spot #N" + the lot's art instead of "Card order".
    // A failed join leaves the name empty and the client renders its
    // localized "Live break spot" fallback.
    const isBreakOrder = !!order.break_spot_id;
    const breakContext = isBreakOrder
        ? (await resolveBreakOrderContexts(admin, [order.break_spot_id])).get(order.break_spot_id as string) ?? null
        : null;

    const counterpartRow = counterpartId ? counterparts.get(counterpartId) : undefined;
    const counterpart: OrderDetailData['counterpart'] = counterpartRow
        ? {
            id: counterpartRow.id,
            displayName: counterpartRow.display_name ?? null,
            username: counterpartRow.username ?? null,
            avatarUrl: counterpartRow.avatar_url ?? null,
        }
        : null;

    const data: OrderDetailData = {
        id: order.id,
        status: order.status,
        totalAmount: Number(order.total_amount) || 0,
        platformFee: Number(order.platform_fee) || 0,
        discountAmount: Number(order.discount_amount) || 0,
        shippingFee: Number(order.shipping_fee) || 0,
        createdAt: order.created_at,
        completedAt: order.completed_at ?? null,
        deliveredAt: (order as any).delivered_at ?? null,
        shippedAt: (order as any).shipped_at ?? null,
        review: reviewRow ? { rating: Number(reviewRow.rating), comment: reviewRow.comment ?? null } : null,
        disputeReason: (order as any).dispute_reason ?? null,
        disputeOutcome: (order as any).dispute_outcome ?? null,
        isBreakOrder,
        card: {
            name: isBreakOrder
                ? (breakContext?.title || '')
                : (card?.name || 'Card order'),
            set: card?.set || card?.setName || '',
            imageSmall: isBreakOrder
                ? (breakContext?.imageSmall ?? null)
                : (card?.images?.small || card?.imageUrl || null),
            condition: listing?.condition ?? null,
            isGraded: !!listing?.is_graded,
            gradingCompany: listing?.grading_company ?? null,
            grade: listing?.grade ?? null,
        },
        tracking,
        hasLabel: hasShippingLabel({ shipping_labels: label ? [label] : [] }),
        counterpart,
    };

    return { kind: 'ok', order: data, role };
}
