import { Suspense } from 'react';
import DesktopMarketplace from '@/components/desktop/DesktopMarketplace';

// Suspense boundary required: DesktopMarketplace reads useSearchParams().
export default function DesktopHomePage() {
    return (
        <Suspense>
            <DesktopMarketplace />
        </Suspense>
    );
}
