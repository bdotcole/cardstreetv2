import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { embedArray } from '@/lib/utils/embed';
import { resolveBreakOrderContexts } from '@/lib/breakOrderContext';
import OrderDetailContent, { type OrderDetailData } from './OrderDetailContent';

// Addressable, auth-gated order page — the deep-link target for the seller
// notification emails (first-sale, label-generated). It sits at /orders/<id>,
// which the middleware matcher deliberately does NOT cover (only the bare
// /orders list does), so this renders the same for mobile and desktop instead
// of going through the desktop/SPA split.
export const metadata: Metadata = {
    title: 'Order — CardStreet',
    // Private, per-user content — never index.
    robots: { index: false, follow: false },
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return <OrderDetailContent signedOut orderId={id} />;
    }

    // Authorize via RLS: the orders SELECT policy returns the row only when the
    // viewer is its buyer or seller. No row => not theirs (or doesn't exist).
    const { data: authz } = await supabase
        .from('orders')
        .select('id, buyer_id, seller_id')
        .eq('id', id)
        .maybeSingle();
    if (!authz) notFound();

    const role: 'seller' | 'buyer' = authz.seller_id === user.id ? 'seller' : 'buyer';

    // Full detail via the service-role client: a sold listing is hidden from the
    // session client by RLS, so the card snapshot would come back null otherwise
    // (same reason app/api/profile/orders uses the admin client).
    const admin = createAdminClient();
    const { data: order } = await admin
        .from('orders')
        .select(`
            id, status, total_amount, platform_fee, shipping_fee, created_at, completed_at, break_spot_id,
            listing:listings(card_data, condition, is_graded, grading_company, grade, price),
            shipping_labels(tracking_number, carrier_name, courier_tracking_url, status)
        `)
        .eq('id', id)
        .single();
    if (!order) notFound();

    const listing = (order.listing ?? null) as any;
    const card = (listing?.card_data ?? {}) as any;
    const label = embedArray(order.shipping_labels)[0] as any | undefined;
    const trackingNumber = label?.tracking_number && label.tracking_number !== 'MANUAL'
        ? String(label.tracking_number)
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

    const data: OrderDetailData = {
        id: order.id,
        status: order.status,
        totalAmount: Number(order.total_amount) || 0,
        platformFee: Number(order.platform_fee) || 0,
        shippingFee: Number(order.shipping_fee) || 0,
        createdAt: order.created_at,
        completedAt: order.completed_at ?? null,
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
        tracking: trackingNumber
            ? { number: trackingNumber, url: label?.courier_tracking_url ?? null }
            : null,
    };

    return <OrderDetailContent order={data} role={role} orderId={id} />;
}
