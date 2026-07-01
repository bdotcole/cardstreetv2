import type { Metadata } from 'next';
import { buildAlternates, BASE_URL } from '@/lib/i18nRouting';
import PrivacyContent from './PrivacyContent';

// Server wrapper so the shared /privacy route emits canonical + hreflang in
// <head>. The bilingual body is rendered by the client component.
export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: 'Privacy Policy — CardStreet TCG Marketplace',
  description:
    'How CardStreet collects, uses, and protects your personal data — accounts, payments via Stripe, seller verification, third-party sharing, and your privacy rights.',
  alternates: buildAlternates('/privacy'),
  openGraph: {
    title: 'CardStreet Privacy Policy',
    description: 'How CardStreet collects, uses, and protects your personal data.',
    type: 'website',
    siteName: 'CardStreet',
    url: '/privacy',
  },
};

export default function PrivacyPage() {
  return <PrivacyContent />;
}
