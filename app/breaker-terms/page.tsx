import type { Metadata } from 'next';
import {
    BASE_URL,
    buildAlternates,
    localePrefix,
    localizedUrl,
    requestPathLocale,
} from '@/lib/i18nRouting';
import BreakerTermsContent from './BreakerTermsContent';

// Breaker Program Terms — the supplement the /become-a-breaker consent
// checkbox links to. Server wrapper owns canonical + hreflang; the bilingual
// body is the client component (same split as /terms and /privacy).
//
// Indexable, unlike the account surfaces: an applicant should be able to read
// what they are agreeing to before they apply, and find it from search.
export async function generateMetadata(): Promise<Metadata> {
    const pathLocale = await requestPathLocale();
    const isThai = pathLocale === 'th';

    const title = isThai
        ? 'ข้อกำหนดโปรแกรม Breaker | CardStreet Live'
        : 'Breaker Program Terms | Cardstreet Live';
    const description = isThai
        ? 'ข้อกำหนดสำหรับ Cardstreet Breaker: คุณสมบัติผู้สมัคร การสุ่มที่ตรวจสอบได้ ค่าธรรมเนียมและการชำระเงิน การจัดส่งหลังจบไลฟ์ และการประพฤติตนระหว่างไลฟ์'
        : 'Terms for Cardstreet Breakers: who can apply, verifiable randomization, fees and payment, shipping after a stream, and conduct on stream.';

    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates('/breaker-terms', pathLocale),
        openGraph: {
            title,
            description,
            type: 'website',
            siteName: 'CardStreet',
            url: localizedUrl('/breaker-terms', pathLocale),
            locale: isThai ? 'th_TH' : 'en_US',
        },
    };
}

export default async function BreakerTermsPage() {
    const pathLocale = await requestPathLocale();
    return <BreakerTermsContent prefix={localePrefix(pathLocale)} />;
}
