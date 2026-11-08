import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadOrderDetail } from '@/lib/orderDetailData';
import OrderDetail from '@/components/orders/OrderDetail';

// Addressable, auth-gated order page — the deep-link target for every order
// email and push (first-sale, label-generated, shipped, confirmation). It sits
// at /orders/<id>. Phones (and the cs_view=mobile override) render this
// standalone page; desktop browsers are rewritten by the middleware to
// app/desktop/orders/[id], which renders the same component inside the desktop
// shell (nav, cart, messages). The native app never reaches either: Android
// App Links hand the id to the SPA's Profile (components/MobileHome.tsx).
export const metadata: Metadata = {
    title: 'Order — Cardstreet',
    // Private, per-user content — never index.
    robots: { index: false, follow: false },
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const result = await loadOrderDetail(id);
    if (result.kind === 'not_found') notFound();
    if (result.kind === 'signed_out') {
        return <OrderDetail signedOut orderId={id} />;
    }
    return <OrderDetail order={result.order} role={result.role} orderId={id} />;
}
