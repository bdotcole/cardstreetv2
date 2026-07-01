import type { Metadata } from 'next';
import { buildAlternates, BASE_URL } from '@/lib/i18nRouting';
import TermsContent from './TermsContent';

// Server wrapper so the shared /terms route emits canonical + hreflang in <head>.
// The bilingual body is rendered by the client component (mirrors app/faq).
export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: 'Terms of Service — CardStreet TCG Marketplace',
  description:
    'CardStreet Terms of Service: marketplace rules, prohibited and counterfeit items, seller fees, payments, shipping, and dispute resolution for trading cards in Thailand.',
  alternates: buildAlternates('/terms'),
  openGraph: {
    title: 'CardStreet Terms of Service',
    description: 'Marketplace rules, seller fees, payments, shipping, and dispute resolution on CardStreet.',
    type: 'website',
    siteName: 'CardStreet',
    url: '/terms',
  },
};

export default function TermsPage() {
  return <TermsContent />;
}
