import type { Metadata } from 'next';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
import TermsContent from './TermsContent';

// Server wrapper so the shared /terms route emits canonical + hreflang in <head>.
// The bilingual body is rendered by the client component (mirrors app/faq).
export async function generateMetadata(): Promise<Metadata> {
  const pathLocale = await requestPathLocale();
  const isThai = pathLocale === 'th';
  return {
    metadataBase: new URL(BASE_URL),
    title: isThai
      ? 'ข้อกำหนดการใช้บริการ | CardStreet'
      : 'Terms of Service — CardStreet TCG Marketplace',
    description: isThai
      ? 'ข้อกำหนดการใช้บริการ CardStreet: กฎของมาร์เก็ตเพลส สินค้าต้องห้ามและการ์ดปลอม ค่าธรรมเนียมผู้ขาย การชำระเงิน การจัดส่ง และการระงับข้อพิพาทสำหรับการ์ดสะสมในประเทศไทย'
      : 'CardStreet Terms of Service: marketplace rules, prohibited and counterfeit items, seller fees, payments, shipping, and dispute resolution for trading cards in Thailand.',
    alternates: buildAlternates('/terms', pathLocale),
    openGraph: {
      title: isThai ? 'ข้อกำหนดการใช้บริการ CardStreet' : 'CardStreet Terms of Service',
      description: isThai
        ? 'กฎของมาร์เก็ตเพลส ค่าธรรมเนียมผู้ขาย การชำระเงิน การจัดส่ง และการระงับข้อพิพาทบน CardStreet'
        : 'Marketplace rules, seller fees, payments, shipping, and dispute resolution on CardStreet.',
      type: 'website',
      siteName: 'CardStreet',
      url: localizedUrl('/terms', pathLocale),
    },
  };
}

export default async function TermsPage() {
  // Links follow the URL prefix (never the cs_lang cookie) so the /en variant
  // keeps crawlers inside the /en tree; the body language is still resolved
  // client-side from the visitor's UI setting.
  const pathLocale = await requestPathLocale();
  return <TermsContent prefix={localePrefix(pathLocale)} />;
}
