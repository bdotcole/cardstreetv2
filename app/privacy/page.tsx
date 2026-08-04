import type { Metadata } from 'next';
import { buildAlternates, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
import PrivacyContent from './PrivacyContent';

// Server wrapper so the shared /privacy route emits canonical + hreflang in
// <head>. The bilingual body is rendered by the client component.
export async function generateMetadata(): Promise<Metadata> {
  const pathLocale = await requestPathLocale();
  const isThai = pathLocale === 'th';
  return {
    metadataBase: new URL(BASE_URL),
    title: isThai
      ? 'นโยบายความเป็นส่วนตัว | CardStreet'
      : 'Privacy Policy — CardStreet TCG Marketplace',
    description: isThai
      ? 'CardStreet เก็บ ใช้ และปกป้องข้อมูลส่วนบุคคลของคุณอย่างไร — บัญชีผู้ใช้ การชำระเงินผ่าน Stripe การยืนยันตัวตนผู้ขาย การแบ่งปันข้อมูลกับบุคคลที่สาม และสิทธิของคุณ'
      : 'How CardStreet collects, uses, and protects your personal data — accounts, payments via Stripe, seller verification, third-party sharing, and your privacy rights.',
    alternates: buildAlternates('/privacy', pathLocale),
    openGraph: {
      title: isThai ? 'นโยบายความเป็นส่วนตัวของ CardStreet' : 'CardStreet Privacy Policy',
      description: isThai
        ? 'CardStreet เก็บ ใช้ และปกป้องข้อมูลส่วนบุคคลของคุณอย่างไร'
        : 'How CardStreet collects, uses, and protects your personal data.',
      type: 'website',
      siteName: 'CardStreet',
      url: localizedUrl('/privacy', pathLocale),
    },
  };
}

export default function PrivacyPage() {
  return <PrivacyContent />;
}
