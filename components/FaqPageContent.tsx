'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';
import FaqList from '@/components/FaqList';

interface PageStrings {
  pageTitle: string;
  introBefore: string;
  introLink: string;
  introAfter: string;
  stillStuck: string;
  emailSupport: string;
}

const EN: PageStrings = {
  pageTitle: 'Frequently Asked Questions',
  introBefore:
    "Everything you need to know about buying, selling, scanning, and shipping trading cards on CardStreet. Can't find your answer? ",
  introLink: 'Contact us',
  introAfter: '.',
  stillStuck: 'Still have a question?',
  emailSupport: 'Email Support',
};

const TH: PageStrings = {
  pageTitle: 'คำถามที่พบบ่อย',
  introBefore:
    'รวมทุกเรื่องที่ควรรู้เกี่ยวกับการซื้อ ขาย สแกน และจัดส่งการ์ดสะสมบน CardStreet หากหาคำตอบไม่เจอ ',
  introLink: 'ติดต่อเรา',
  introAfter: ' ได้เลย',
  stillStuck: 'ยังมีคำถามอยู่ใช่ไหม?',
  emailSupport: 'อีเมลหาฝ่ายซัพพอร์ต',
};

export default function FaqPageContent() {
  const { isThai } = useTranslation();
  const t = isThai ? TH : EN;

  return (
    <div className="min-h-screen bg-brand-darker text-white p-6 pb-24 overflow-y-auto">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="flex items-center gap-4 mb-10">
          <Link
            href="/"
            className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all"
            aria-label="Back"
          >
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </Link>
          <h1 className="text-2xl font-black uppercase tracking-tight italic skew-x-[-10deg]">{t.pageTitle}</h1>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed mb-10">
          {t.introBefore}
          <Link href="/contact" className="text-brand-cyan font-bold hover:underline">
            {t.introLink}
          </Link>
          {t.introAfter}
        </p>

        <FaqList />

        <div className="mt-12 glass rounded-2xl border border-white/10 p-6 text-center space-y-3">
          <p className="text-sm text-slate-300">{t.stillStuck}</p>
          <a
            href="mailto:support@cardstreet.app"
            className="inline-block bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider px-6 py-3 rounded-xl active:scale-[0.98] transition-all"
          >
            {t.emailSupport}
          </a>
        </div>
      </div>
    </div>
  );
}
