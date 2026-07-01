import type { Metadata } from 'next';
import { buildAlternates, BASE_URL } from '@/lib/i18nRouting';
import ContactContent from './ContactContent';

// Server wrapper so the shared /contact route emits canonical + hreflang in
// <head>. The bilingual body is rendered by the client component.
export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: 'Contact Us — CardStreet TCG Marketplace',
  description:
    'Contact the CardStreet support team for help with orders, accounts, listings, and disputes. Email support in English and Thai, with replies within 1–2 business days.',
  alternates: buildAlternates('/contact'),
  openGraph: {
    title: 'Contact CardStreet',
    description: 'Reach the CardStreet support team for help with orders, accounts, listings, and disputes in Thailand.',
    type: 'website',
    siteName: 'CardStreet',
    url: '/contact',
  },
};

export default function ContactPage() {
  return <ContactContent />;
}
