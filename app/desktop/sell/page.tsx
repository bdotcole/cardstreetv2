import { Suspense } from 'react';
import DesktopSell from '@/components/desktop/DesktopSell';

// Suspense boundary required: DesktopSell reads useSearchParams().
export default function DesktopSellPage() {
    return (
        <Suspense>
            <DesktopSell />
        </Suspense>
    );
}
