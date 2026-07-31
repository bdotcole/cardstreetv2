import type { Metadata } from 'next';
import FaqPageContent from '@/components/FaqPageContent';
import { buildFaqJsonLd } from '@/lib/faqData';
import { buildAlternates, localizedUrl, requestPathLocale } from '@/lib/i18nRouting';

// Dedicated, crawlable FAQ landing page. This is a top-level shared route (like
// /help, /terms, /privacy) so both the mobile SPA and the desktop site link to
// the same canonical URL. The visible body is bilingual (FaqPageContent reads
// the user's language client-side); the metadata and FAQPage JSON-LD below are
// English and server-rendered so search engines and AI answer engines index a
// stable, structured copy of every question and answer.
export async function generateMetadata(): Promise<Metadata> {
  const pathLocale = await requestPathLocale();
  return {
    metadataBase: new URL('https://cardstreet.app'),
    title: 'Frequently Asked Questions — CardStreet TCG Marketplace',
    description:
      'Answers about buying, selling, scanning, and shipping Pokémon, Magic, Yu-Gi-Oh, and One Piece trading cards on CardStreet in Thailand. Buyer protection, fees, payouts, PromptPay, and graded cards explained.',
    alternates: buildAlternates('/faq', pathLocale),
    openGraph: {
      title: 'CardStreet FAQ — Buying, Selling & Scanning Trading Cards in Thailand',
      description:
        'How CardStreet works: buyer protection, seller fees and payouts, AI card scanning, PromptPay checkout, and nationwide Flash Express shipping.',
      type: 'website',
      siteName: 'CardStreet',
      // og:url must agree with the canonical — a bare-path og:url on an /en
      // render is a stray canonical hint pointing back at the Thai URL.
      url: localizedUrl('/faq', pathLocale),
    },
  };
}

export default function FaqPage() {
  const jsonLd = buildFaqJsonLd();

  return (
    <>
      {/* schema.org FAQPage — eligible for FAQ rich results and quotable by AI
          answer engines. Built from the English catalog for a stable index. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <FaqPageContent />
    </>
  );
}
