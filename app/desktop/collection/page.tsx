import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { buildAlternates, BASE_URL } from '@/lib/i18nRouting';
import DesktopCollection from '@/components/desktop/DesktopCollection';

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

export async function generateMetadata(): Promise<Metadata> {
    const lang = await resolveLang();
    const title = lang === 'EN' ? 'My Collection | CardStreet' : 'คอลเลกชันของฉัน | CardStreet';
    const description =
        lang === 'EN'
            ? 'Track your card collection value, complete master sets, and manage your wishlist on CardStreet.'
            : 'ติดตามมูลค่าคอลเลกชันการ์ด สะสมชุดการ์ดให้ครบ และจัดการรายการที่อยากได้บน CardStreet';
    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates('/collection'),
        // Personal, auth-gated page — keep it out of the index.
        robots: { index: false, follow: false },
    };
}

export default function DesktopCollectionPage() {
    return <DesktopCollection />;
}
