import type { Metadata } from 'next';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL, DEFAULT_OG_IMAGE } from '@/lib/i18nRouting';
import PrivacyContent from './PrivacyContent';

// Server wrapper so the shared /privacy route emits canonical + hreflang in
// <head>. The bilingual body is rendered by the client component.
export async function generateMetadata(): Promise<Metadata> {
  const pathLocale = await requestPathLocale();
  const isThai = pathLocale === 'th';
  return {
    metadataBase: new URL(BASE_URL),
    title: isThai
      ? 'นโยบายความเป็นส่วนตัว | Cardstreet'
      : 'Privacy Policy — Cardstreet TCG Marketplace',
    description: isThai
      ? 'Cardstreet เก็บ ใช้ และปกป้องข้อมูลส่วนบุคคลของคุณอย่างไร — บัญชีผู้ใช้ การชำระเงินผ่าน Stripe การยืนยันตัวตนผู้ขาย การแบ่งปันข้อมูลกับบุคคลที่สาม และสิทธิของคุณ'
      : 'How Cardstreet collects, uses, and protects your personal data — accounts, payments via Stripe, seller verification, third-party sharing, and your privacy rights.',
    alternates: buildAlternates('/privacy', pathLocale),
    openGraph: {
        images: DEFAULT_OG_IMAGE,
      title: isThai ? 'นโยบายความเป็นส่วนตัวของ Cardstreet' : 'Cardstreet Privacy Policy',
      description: isThai
        ? 'Cardstreet เก็บ ใช้ และปกป้องข้อมูลส่วนบุคคลของคุณอย่างไร'
        : 'How Cardstreet collects, uses, and protects your personal data.',
      type: 'website',
      siteName: 'Cardstreet',
      url: localizedUrl('/privacy', pathLocale),
    },
  };
}

export default async function PrivacyPage() {
  // Links follow the URL prefix (never the cs_lang cookie) so the /en variant
  // keeps crawlers inside the /en tree; the body language is still resolved
  // client-side from the visitor's UI setting.
  const pathLocale = await requestPathLocale();
  return <PrivacyContent prefix={localePrefix(pathLocale)} />;
}
