import type { Metadata } from 'next';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
import ContactContent from './ContactContent';

// Server wrapper so the shared /contact route emits canonical + hreflang in
// <head>. The bilingual body is rendered by the client component.
export async function generateMetadata(): Promise<Metadata> {
  const pathLocale = await requestPathLocale();
  const isThai = pathLocale === 'th';
  return {
    metadataBase: new URL(BASE_URL),
    title: isThai
      ? 'ติดต่อเรา — ฝ่ายซัพพอร์ต CardStreet'
      : 'Contact Us — CardStreet TCG Marketplace',
    description: isThai
      ? 'ติดต่อทีมซัพพอร์ต CardStreet เรื่องคำสั่งซื้อ บัญชี รายการขาย และข้อพิพาท ตอบกลับทางอีเมลภายใน 1–2 วันทำการ รองรับทั้งภาษาไทยและอังกฤษ'
      : 'Contact the CardStreet support team for help with orders, accounts, listings, and disputes. Email support in English and Thai, with replies within 1–2 business days.',
    alternates: buildAlternates('/contact', pathLocale),
    openGraph: {
      title: isThai ? 'ติดต่อ CardStreet' : 'Contact CardStreet',
      description: isThai
        ? 'ติดต่อทีมซัพพอร์ต CardStreet เรื่องคำสั่งซื้อ บัญชี รายการขาย และข้อพิพาทในประเทศไทย'
        : 'Reach the CardStreet support team for help with orders, accounts, listings, and disputes in Thailand.',
      type: 'website',
      siteName: 'CardStreet',
      url: localizedUrl('/contact', pathLocale),
    },
  };
}

export default async function ContactPage() {
  // Links follow the URL prefix (never the cs_lang cookie) so the /en variant
  // keeps crawlers inside the /en tree; the body language is still resolved
  // client-side from the visitor's UI setting.
  const pathLocale = await requestPathLocale();
  return <ContactContent prefix={localePrefix(pathLocale)} />;
}
