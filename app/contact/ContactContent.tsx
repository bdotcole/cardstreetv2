'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';

interface ContactContentData {
  pageTitle: string;
  intro: string;
  emailSupportLabel: string;
  sendEmailButton: string;
  responseTimeTitle: string;
  responseTimeBody: string;
  disputeTitle: string;
  disputeBeforeStrong: string;
  disputeStrong: string;
  disputeAfterStrong: string;
  writeInTitle: string;
  writeInIntro: string;
  writeInItems: string[];
  operatedByLabel: string;
  madeWithCare: string;
}

const EN: ContactContentData = {
  pageTitle: 'Contact Us',
  intro: "Need help with an order, your account, or a listing? We're here for you. The fastest way to reach the CardStreet team is by email — we read every message.",
  emailSupportLabel: 'Email Support',
  sendEmailButton: 'Send us an email',
  responseTimeTitle: 'Response Time',
  responseTimeBody: 'We typically reply within 1–2 business days. Support is provided in English and Thai (ภาษาไทย).',
  disputeTitle: 'Order & Dispute Help',
  disputeBeforeStrong: 'For a problem with a specific order — an item that arrived damaged, counterfeit, or not as described — please email us with your ',
  disputeStrong: 'order number',
  disputeAfterStrong: ' and clear photos. This helps us mediate and resolve disputes as quickly as possible.',
  writeInTitle: 'When You Write In',
  writeInIntro: 'Including these details helps us help you faster:',
  writeInItems: [
    'The email address on your CardStreet account',
    'The order or listing number, if relevant',
    'A short description of the issue and any screenshots',
  ],
  operatedByLabel: 'Operated By',
  madeWithCare: 'Made with care in Thailand.',
};

const TH: ContactContentData = {
  pageTitle: 'ติดต่อเรา',
  intro: 'ต้องการความช่วยเหลือเกี่ยวกับคำสั่งซื้อ บัญชี หรือรายการขายของคุณ? เราพร้อมช่วยเสมอ ช่องทางที่เร็วที่สุดในการติดต่อทีม CardStreet คืออีเมล — เราอ่านทุกข้อความ',
  emailSupportLabel: 'อีเมลซัพพอร์ต',
  sendEmailButton: 'ส่งอีเมลถึงเรา',
  responseTimeTitle: 'ระยะเวลาตอบกลับ',
  responseTimeBody: 'โดยปกติเราตอบกลับภายใน 1–2 วันทำการ ให้บริการช่วยเหลือทั้งภาษาไทยและภาษาอังกฤษ',
  disputeTitle: 'ปัญหาคำสั่งซื้อและข้อพิพาท',
  disputeBeforeStrong: 'หากพบปัญหากับคำสั่งซื้อ — สินค้าที่ได้รับเสียหาย เป็นของปลอม หรือไม่ตรงตามคำอธิบาย — กรุณาอีเมลถึงเราพร้อม',
  disputeStrong: 'หมายเลขคำสั่งซื้อ',
  disputeAfterStrong: 'และรูปถ่ายที่ชัดเจน ข้อมูลเหล่านี้ช่วยให้เราไกล่เกลี่ยและแก้ไขข้อพิพาทได้รวดเร็วที่สุด',
  writeInTitle: 'สิ่งที่ควรแจ้งเมื่อติดต่อ',
  writeInIntro: 'การแจ้งรายละเอียดเหล่านี้ช่วยให้เราช่วยคุณได้เร็วขึ้น:',
  writeInItems: [
    'อีเมลที่ใช้กับบัญชี CardStreet ของคุณ',
    'หมายเลขคำสั่งซื้อหรือรายการขาย (ถ้ามี)',
    'คำอธิบายปัญหาสั้น ๆ พร้อมภาพหน้าจอ (ถ้ามี)',
  ],
  operatedByLabel: 'ดำเนินการโดย',
  madeWithCare: 'สร้างด้วยความใส่ใจในประเทศไทย',
};

export default function ContactContent() {
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

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          <p>{content.intro}</p>

          {/* Primary support email */}
          <section className="glass rounded-2xl border border-white/10 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-brand-cyan/10 flex items-center justify-center text-brand-cyan">
                <i className="fa-solid fa-envelope text-lg"></i>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{content.emailSupportLabel}</p>
                <a href="mailto:support@thailandtcg.com" className="text-white font-bold hover:text-brand-cyan transition-colors">
                  support@thailandtcg.com
                </a>
              </div>
            </div>
            <a
              href="mailto:support@thailandtcg.com"
              className="block w-full text-center bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider py-3.5 rounded-xl active:scale-[0.98] transition-all"
            >
              {content.sendEmailButton}
            </a>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black uppercase tracking-wider text-brand-cyan">{content.responseTimeTitle}</h2>
            <p>{content.responseTimeBody}</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black uppercase tracking-wider text-brand-cyan">{content.disputeTitle}</h2>
            <p>
              {content.disputeBeforeStrong}
              <strong className="text-white">{content.disputeStrong}</strong>
              {content.disputeAfterStrong}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-black uppercase tracking-wider text-brand-cyan">{content.writeInTitle}</h2>
            <p>{content.writeInIntro}</p>
            <ul className="list-disc list-inside space-y-1.5 text-slate-400">
              {content.writeInItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="space-y-2 pt-2 border-t border-white/5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{content.operatedByLabel}</p>
            <p className="text-slate-400">
              Cardstreet
              <br />
              (Commercial Registration No. 1329900962791)
            </p>
            <p className="text-slate-600 text-xs">{content.madeWithCare}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
