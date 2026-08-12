'use client';

import Link from 'next/link';
import { getFeaturedFaqs } from '@/lib/faqData';
import { useTranslation } from '@/lib/hooks/useTranslation';

// Homepage FAQ teaser for the desktop site. Shows the most common questions as
// expandable answers and links through to the full /faq page (which carries the
// FAQPage JSON-LD). Bilingual: it follows the visitor's UI language.
export default function DesktopFaqTeaser({ pathPrefix = '' }: {
  // '' on the Thai canonical, '/en' under the English prefix. Threaded from the
  // server page through DesktopMarketplace, because lib/i18nRouting imports
  // next/headers and so cannot be imported by a client component.
  pathPrefix?: string;
}) {
  const { t, isThai } = useTranslation();
  const faqs = getFeaturedFaqs(isThai);

  return (
    <section aria-labelledby="faq-heading" className="mt-20 border-t border-white/5 pt-14">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h2 id="faq-heading" className="text-2xl font-black text-white">
            {t('desktop.faqHeading')}
          </h2>
          <p className="text-sm text-slate-400 mt-1">{t('desktop.faqSubtext')}</p>
        </div>
        <Link
          href={`${pathPrefix}/faq`}
          className="shrink-0 inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors"
        >
          {t('desktop.faqViewAll')}
          <i className="fa-solid fa-arrow-right text-xs"></i>
        </Link>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {faqs.map((item) => (
          <details
            key={item.q}
            className="group bg-slate-800/40 border border-white/5 rounded-2xl p-5 [&_summary]:list-none"
          >
            <summary className="flex items-center justify-between cursor-pointer gap-4">
              <span className="text-white font-bold text-sm">{item.q}</span>
              <i className="fa-solid fa-chevron-down text-slate-500 text-xs transition-transform group-open:rotate-180"></i>
            </summary>
            <p className="text-slate-400 text-sm leading-relaxed mt-3">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
