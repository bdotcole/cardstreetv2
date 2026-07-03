'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';
import FaqList from '@/components/FaqList';

interface HelpStrings {
  pageTitle: string;
  introBefore: string;
  introLink: string;
  introAfter: string;
  stillStuck: string;
  emailSupport: string;
}

const EN: HelpStrings = {
  pageTitle: 'Help Center',
  introBefore: "Answers to the questions we hear most. Can't find what you need? ",
  introLink: 'Contact us',
  introAfter: " and we'll help.",
  stillStuck: 'Still stuck?',
  emailSupport: 'Email Support',
};

const TH: HelpStrings = {
  pageTitle: 'ศูนย์ช่วยเหลือ',
  introBefore: 'รวมคำตอบสำหรับคำถามที่พบบ่อยที่สุด หากหาคำตอบที่ต้องการไม่เจอ ',
  introLink: 'ติดต่อเรา',
  introAfter: ' ได้เลย เรายินดีช่วยเหลือ',
  stillStuck: 'ยังแก้ปัญหาไม่ได้?',
  emailSupport: 'อีเมลหาฝ่ายซัพพอร์ต',
};

export default function HelpContent() {
  const { isThai } = useTranslation();
  const content = isThai ? TH : EN;

  return (
    <div className="min-h-screen bg-brand-darker text-white p-6 pb-24 overflow-y-auto">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="flex items-center gap-4 mb-10">
          <Link href="/" className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </Link>
          <h1 className="text-2xl font-black uppercase tracking-tight italic skew-x-[-10deg]">{content.pageTitle}</h1>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed mb-10">
          {content.introBefore}
          <Link href="/contact" className="text-brand-cyan font-bold hover:underline">
            {content.introLink}
          </Link>
          {content.introAfter}
        </p>

        <FaqList />

        <div className="mt-12 glass rounded-2xl border border-white/10 p-6 text-center space-y-3">
          <p className="text-sm text-slate-300">{content.stillStuck}</p>
          <a
            href="mailto:support@thailandtcg.com"
            className="inline-block bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider px-6 py-3 rounded-xl active:scale-[0.98] transition-all"
          >
            {content.emailSupport}
          </a>
        </div>
      </div>
    </div>
  );
}
