import type { Metadata } from 'next';
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { BASE_URL } from '@/lib/i18nRouting';
import DesktopSell from '@/components/desktop/DesktopSell';

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata(): Promise<Metadata> {
    const lang = await resolveLang();
    const title = lang === 'EN' ? 'Sell Trading Cards | CardStreet' : 'ลงขายการ์ด | CardStreet';
    return {
        metadataBase: new URL(BASE_URL),
        title,
        // Auth-gated seller workflow — keep it out of the index. Without its own
        // metadata this page cloned the homepage title/description sitewide.
        robots: { index: false, follow: false },
    };
}

// Suspense boundary required: DesktopSell reads useSearchParams().
export default function DesktopSellPage() {
    return (
        <Suspense>
            <DesktopSell />
        </Suspense>
    );
}
