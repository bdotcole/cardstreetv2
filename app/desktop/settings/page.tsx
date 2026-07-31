import type { Metadata } from 'next';
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { BASE_URL } from '@/lib/i18nRouting';
import DesktopSettings from '@/components/desktop/DesktopSettings';

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata(): Promise<Metadata> {
    const lang = await resolveLang();
    const title = lang === 'EN' ? 'Account Settings | CardStreet' : 'ตั้งค่าบัญชี | CardStreet';
    return {
        metadataBase: new URL(BASE_URL),
        title,
        // Personal, auth-gated page — keep it out of the index. No hreflang
        // alternates either: annotating a noindexed page is a conflicting signal.
        robots: { index: false, follow: false },
    };
}

// DesktopSettings reads useSearchParams() for the active tab, so it needs a
// Suspense boundary.
export default function DesktopSettingsPage() {
    return (
        <Suspense>
            <DesktopSettings />
        </Suspense>
    );
}
