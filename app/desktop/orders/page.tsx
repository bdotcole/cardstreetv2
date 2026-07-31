import type { Metadata } from 'next';
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { BASE_URL } from '@/lib/i18nRouting';
import DesktopOrders from '@/components/desktop/DesktopOrders';

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata(): Promise<Metadata> {
    const lang = await resolveLang();
    const title = lang === 'EN' ? 'My Orders | CardStreet' : 'คำสั่งซื้อของฉัน | CardStreet';
    return {
        metadataBase: new URL(BASE_URL),
        title,
        // Personal, auth-gated page — keep it out of the index. Without its own
        // metadata this page cloned the homepage title/description sitewide.
        robots: { index: false, follow: false },
    };
}

// Suspense boundary required: DesktopOrders reads useSearchParams() (to land on
// the Offers tab from the offer-email CTA's /orders?tab=offers deep link).
export default function DesktopOrdersPage() {
    return (
        <Suspense>
            <DesktopOrders />
        </Suspense>
    );
}
