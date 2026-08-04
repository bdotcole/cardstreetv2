import type { Metadata } from 'next';
import FaqPageContent from '@/components/FaqPageContent';
import { buildFaqJsonLd } from '@/lib/faqData';
import { buildAlternates, localizedUrl, requestPathLocale } from '@/lib/i18nRouting';

// Dedicated, crawlable FAQ landing page. This is a top-level shared route (like
// /help, /terms, /privacy) so both the mobile SPA and the desktop site link to
// the same canonical URL. The visible body is bilingual (FaqPageContent reads
// the user's language client-side); the metadata and FAQPage JSON-LD below are
// server-rendered in the locale of the URL variant, so the Thai canonical page
// gets a Thai snippet and Thai machine-readable answers.
//
// Locale comes from requestPathLocale() (the URL prefix), never from the
// cs_lang cookie — a returning English-cookie visitor on the bare path still
// sees the Thai canonical, so title, description, og:url and canonical must all
// stay Thai for them.
export async function generateMetadata(): Promise<Metadata> {
  const pathLocale = await requestPathLocale();
  const isThai = pathLocale === 'th';
  return {
    metadataBase: new URL('https://cardstreet.app'),
    title: isThai
      ? 'คำถามที่พบบ่อย — ซื้อขายการ์ดโปเกม่อน ยูกิ วันพีช | CardStreet'
      : 'Frequently Asked Questions — CardStreet TCG Marketplace',
    description: isThai
      ? 'คำตอบเรื่องการซื้อ ขาย สแกน และจัดส่งการ์ดโปเกม่อน Magic ยูกิโอ และวันพีช บน CardStreet ในประเทศไทย ทั้งการคุ้มครองผู้ซื้อ ค่าธรรมเนียม การรับเงิน พร้อมเพย์ และการ์ดเกรด'
      : 'Answers about buying, selling, scanning, and shipping Pokémon, Magic, Yu-Gi-Oh, and One Piece trading cards on CardStreet in Thailand. Buyer protection, fees, payouts, PromptPay, and graded cards explained.',
    alternates: buildAlternates('/faq', pathLocale),
    openGraph: {
      title: isThai
        ? 'คำถามที่พบบ่อย CardStreet — ซื้อ ขาย และสแกนการ์ดสะสมในไทย'
        : 'CardStreet FAQ — Buying, Selling & Scanning Trading Cards in Thailand',
      description: isThai
        ? 'CardStreet ทำงานอย่างไร: การคุ้มครองผู้ซื้อ ค่าธรรมเนียมและการรับเงินของผู้ขาย การสแกนการ์ดด้วย AI ชำระผ่านพร้อมเพย์ และจัดส่งทั่วประเทศด้วย Flash Express'
        : 'How CardStreet works: buyer protection, seller fees and payouts, AI card scanning, PromptPay checkout, and nationwide Flash Express shipping.',
      type: 'website',
      siteName: 'CardStreet',
      // og:url must agree with the canonical — a bare-path og:url on an /en
      // render is a stray canonical hint pointing back at the Thai URL.
      url: localizedUrl('/faq', pathLocale),
    },
  };
}

export default async function FaqPage() {
  const jsonLd = buildFaqJsonLd((await requestPathLocale()) === 'th');

  return (
    <>
      {/* schema.org FAQPage — eligible for FAQ rich results and quotable by AI
          answer engines, in the language of the URL variant being served. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <FaqPageContent />
    </>
  );
}
