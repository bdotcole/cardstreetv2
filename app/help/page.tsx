import type { Metadata } from 'next';
import { localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
import HelpContent from './HelpContent';

// The in-app Help Center renders the same FaqList accordion as /faq, so the two
// pages are near-duplicates in the crawl. /help stays fully functional for
// humans but canonicalizes to /faq (locale-matched) to consolidate ranking
// signals on one URL — and it carries no hreflang cluster of its own, since a
// non-self-canonical page must not annotate alternates. /faq owns the cluster.
export async function generateMetadata(): Promise<Metadata> {
  const pathLocale = await requestPathLocale();
  return {
    metadataBase: new URL(BASE_URL),
    title: 'Help Center — CardStreet TCG Marketplace',
    description:
      'Get help with buying, selling, scanning, shipping, and payments on CardStreet, Thailand’s marketplace for Pokémon, Magic, Yu-Gi-Oh, and One Piece trading cards.',
    alternates: { canonical: localizedUrl('/faq', pathLocale) },
    openGraph: {
      title: 'CardStreet Help Center',
      description: 'Answers about buying, selling, scanning, and shipping trading cards on CardStreet in Thailand.',
      type: 'website',
      siteName: 'CardStreet',
      url: localizedUrl('/help', pathLocale),
    },
  };
}

export default function HelpPage() {
  return <HelpContent />;
}
