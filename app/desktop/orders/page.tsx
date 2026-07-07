import { Suspense } from 'react';
import DesktopOrders from '@/components/desktop/DesktopOrders';

// Suspense boundary required: DesktopOrders reads useSearchParams() (to land on
// the Offers tab from the offer-email CTA's /orders?tab=offers deep link).
export default function DesktopOrdersPage() {
    return (
        <Suspense>
            <DesktopOrders />
        </Suspense>
    );
}
