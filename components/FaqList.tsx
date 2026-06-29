'use client';

import React from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getFaqCategories } from '@/lib/faqData';

/**
 * Bilingual FAQ accordion shared by the public /faq page and the in-app Help
 * Center. Uses native <details>/<summary> so the questions and answers are in
 * the rendered HTML and remain expandable without JavaScript — important for
 * search-engine and AI-answer-engine crawling.
 */
export default function FaqList() {
  const { isThai } = useTranslation();
  const sections = getFaqCategories(isThai);

  return (
    <div className="space-y-10">
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="space-y-4 scroll-mt-24">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-cyan/10 flex items-center justify-center text-brand-cyan">
              <i className={`${section.icon} text-sm`}></i>
            </div>
            <h2 className="text-lg font-black uppercase tracking-wider text-brand-cyan">{section.title}</h2>
          </div>

          <div className="glass rounded-2xl border border-white/10 divide-y divide-white/5 overflow-hidden">
            {section.items.map((item) => (
              <details key={item.q} className="group p-5 [&_summary]:list-none">
                <summary className="flex items-center justify-between cursor-pointer">
                  <span className="text-white font-bold text-sm pr-4">{item.q}</span>
                  <i className="fa-solid fa-chevron-down text-slate-500 text-xs transition-transform group-open:rotate-180"></i>
                </summary>
                <p className="text-slate-400 text-sm leading-relaxed mt-3">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
