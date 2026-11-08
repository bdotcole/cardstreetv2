import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadOrderDetail } from '@/lib/orderDetailData';
import OrderDetail from '@/components/orders/OrderDetail';

// The order page inside the desktop shell. Desktop browsers asking for
// /orders/<id> are rewritten here by the middleware (phones keep the
// standalone app/orders/[id] page); the same loader and component serve both,
// so the two never disagree about an order.
export const metadata: Metadata = {
    title: 'Order — Cardstreet',
    // Private, per-user content — never index.
    robots: { index: false, follow: false },
};

export default async function DesktopOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const result = await loadOrderDetail(id);
    if (result.kind === 'not_found') notFound();
    if (result.kind === 'signed_out') {
        return <OrderDetail variant="desktop" signedOut orderId={id} />;
    }
    return <OrderDetail variant="desktop" order={result.order} role={result.role} orderId={id} />;
}
