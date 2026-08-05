'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';

// Bilingual page prose, same pattern as app/prices/PricesContent.tsx: a client
// component whose strings are static, so React renders every word into the
// initial HTML and crawlers see the full page without running JS.
//
// What this page deliberately does NOT claim, all verified against the live data
// on 2026-08-04 — do not "improve" the copy past these:
//   - It is not a buy-graded-cards page. There are zero active graded listings,
//     so it sells the pricing data and the tools and invites sellers instead.
//   - No TAG prices. TAG renders in the slab frame and is in the graded-prices
//     regex, but PriceCharting carries no TAG data, so no TAG price exists.
//   - No grading submission service. CardStreet does not submit cards to PSA and
//     never has; the ส่งเกรด intent is answered informationally, not sold.
//   - Not every grade 1-10. Only the tiers listed below have real data.

interface Section {
  title: string;
  body: string[];
}

interface Strings {
  h1: string;
  intro: string[];
  tiersTitle: string;
  tiersLead: string;
  tiers: string[];
  tiersAfter: string;
  sourcesTitle: string;
  sourcesLead: string;
  sources: { t: string; d: string }[];
  sourcesAfter: string;
  more: Section[];
  ctaPrices: string;
  ctaSell: string;
  faqLink: string;
}

const EN: Strings = {
  h1: 'Graded Card Prices — PSA, BGS, CGC and SGC',
  intro: [
    'A graded copy of a card and a raw one are worth very different amounts — often several times apart. CardStreet tracks graded prices separately from raw ones: over 200,000 graded prices across PSA, BGS, CGC and SGC, updated daily and always shown in Thai baht.',
    'Open any card page on CardStreet and scroll to the graded prices section to see every tier we hold real data for. Tiers we have no data for are left blank rather than guessed.',
  ],
  tiersTitle: 'Which grades have prices',
  tiersLead: 'Coverage is currently the top tiers of each company — the ones that actually trade:',
  tiers: ['PSA 10 and PSA 9', 'BGS 10 and BGS 9.5', 'CGC 10', 'SGC 10'],
  tiersAfter:
    'Lower tiers have no reliable pricing yet, so we show nothing rather than a made-up number. TAG slabs display correctly on CardStreet, but there is no market price data for TAG grades.',
  sourcesTitle: 'Where graded prices come from',
  sourcesLead: 'Three sources, in order of authority:',
  sources: [
    {
      t: 'Real sales on CardStreet',
      d: 'If that card in that grade has actually sold on the platform, that price wins.',
    },
    {
      t: 'International market data',
      d: 'Graded sales from the global market, converted to baht.',
    },
    {
      t: 'An estimate for Thai cards',
      d: 'Thai-language Pokémon cards have no international graded pricing, so we show 60% of the English-equivalent graded price, and switch to the real figure the moment that Thai card sells in that grade on CardStreet.',
    },
  ],
  sourcesAfter: 'A tier with none of the three is left blank.',
  more: [
    {
      title: 'Estimate a grade with AI before you pay to submit',
      body: [
        'Before paying submission fees, most people want to know whether a card has a shot at a high grade. CardStreet’s AI grading tool estimates one from a photo, looking at corners, edges, surface and centering.',
        'The result is an estimate, not an official grade, and carries no weight with PSA, BGS, CGC or TAG. Use it to decide which cards are worth submitting first. It is a CardStreet Pro feature.',
      ],
    },
    {
      title: 'What card grading is',
      body: [
        'Grading means sending a card to a third-party company that checks its condition and authenticity, then seals it in a plastic slab with a score from 1 to 10. The companies Thai collectors deal with most are PSA, BGS, CGC and TAG.',
        'It is worth doing when the card is valuable enough that the price difference covers submission and shipping. Cards in excellent condition with a shot at a 9 or better are usually the ones that pay off; low-value cards usually are not.',
        'CardStreet does not offer a grading submission service. We are a marketplace and a pricing source — submitting is done directly with those companies or with a Thai submission agent.',
      ],
    },
    {
      title: 'Selling graded cards on CardStreet',
      body: [
        'If you already own graded cards and want to sell, you can list them. CardStreet renders the slab frame and the grading company’s logo so buyers can see exactly what they are getting, and the market price for that grade sits alongside as a reference while you price it. Sellers pay a fee only when a card sells, buyers pay by card or PromptPay, and orders ship nationwide with Flash Express.',
      ],
    },
  ],
  ctaPrices: 'Check card prices',
  ctaSell: 'List a graded card',
  faqLink: 'Frequently asked questions',
};

const TH: Strings = {
  h1: 'ราคาการ์ดเกรด — PSA, BGS, CGC และ SGC',
  intro: [
    'การ์ดใบเดียวกันที่ผ่านการเกรดแล้วกับการ์ดดิบมีมูลค่าต่างกันมาก บางใบต่างกันหลายเท่า CardStreet จึงเก็บราคาการ์ดเกรดแยกจากราคาการ์ดดิบ รวมกว่า 200,000 รายการจากบริษัทเกรดหลัก ทั้ง PSA, BGS, CGC และ SGC อัปเดตทุกวันและแสดงเป็นเงินบาทเสมอ',
    'เปิดหน้าการ์ดใบไหนก็ได้บน CardStreet แล้วเลื่อนดูส่วนราคาการ์ดเกรด จะเห็นราคาของแต่ละระดับที่มีข้อมูลจริง ระดับไหนที่ยังไม่มีข้อมูล เราจะเว้นว่างไว้ ไม่เดาราคาให้',
  ],
  tiersTitle: 'ระดับเกรดที่มีราคาบน CardStreet',
  tiersLead: 'ตอนนี้ข้อมูลราคาครอบคลุมระดับบนของแต่ละบริษัท ซึ่งเป็นระดับที่ซื้อขายกันมากที่สุด:',
  tiers: ['PSA 10 และ PSA 9', 'BGS 10 และ BGS 9.5', 'CGC 10', 'SGC 10'],
  tiersAfter:
    'ระดับอื่นยังไม่มีข้อมูลราคาที่เชื่อถือได้ เราจึงไม่แสดง แทนที่จะใส่ตัวเลขที่เดาเอา ส่วน TAG นั้น CardStreet รองรับการแสดงผลการ์ด TAG แล้ว แต่ยังไม่มีข้อมูลราคาตลาดสำหรับเกรดนี้',
  sourcesTitle: 'ราคาการ์ดเกรดมาจากไหน',
  sourcesLead: 'ราคามาจากสามแหล่ง เรียงตามลำดับความน่าเชื่อถือ:',
  sources: [
    {
      t: 'การซื้อขายจริงบน CardStreet',
      d: 'ถ้าการ์ดใบนั้นในเกรดนั้นเคยขายจริงบนแพลตฟอร์ม ราคานั้นมาก่อนเสมอ',
    },
    {
      t: 'ราคาตลาดสากล',
      d: 'อ้างอิงจากข้อมูลการซื้อขายการ์ดเกรดในตลาดต่างประเทศ แปลงเป็นเงินบาท',
    },
    {
      t: 'ราคาประเมินสำหรับการ์ดไทย',
      d: 'การ์ดโปเกมอนภาษาไทยยังไม่มีข้อมูลราคาเกรดในตลาดสากล เราจึงแสดงเป็นค่าประมาณที่ 60% ของราคาการ์ดภาษาอังกฤษใบเทียบเท่า และจะเปลี่ยนเป็นราคาจริงทันทีที่มีการซื้อขายการ์ดไทยใบนั้นในเกรดนั้นบน CardStreet',
    },
  ],
  sourcesAfter: 'ระดับเกรดที่ไม่มีข้อมูลจากทั้งสามแหล่งจะถูกเว้นว่าง',
  more: [
    {
      title: 'ประเมินเกรดการ์ดด้วย AI ก่อนตัดสินใจส่งเกรด',
      body: [
        'ก่อนจ่ายค่าส่งเกรด หลายคนอยากรู้ก่อนว่าการ์ดใบนี้มีโอกาสได้เกรดสูงแค่ไหน CardStreet มีเครื่องมือประเมินเกรดด้วย AI ให้ถ่ายรูปการ์ดแล้วดูค่าประเมินจากสภาพที่เห็นในภาพ ทั้งมุม ขอบ ผิวการ์ด และการเข้าศูนย์ของภาพพิมพ์',
        'ค่าที่ได้เป็นการประเมินเบื้องต้นเท่านั้น ไม่ใช่เกรดอย่างเป็นทางการ และไม่มีผลผูกพันกับผลการตัดสินของ PSA, BGS, CGC หรือ TAG ใช้เพื่อช่วยคัดว่าใบไหนน่าส่งเกรดก่อน เครื่องมือนี้เป็นฟีเจอร์สำหรับสมาชิก CardStreet Pro',
      ],
    },
    {
      title: 'การเกรดการ์ดคืออะไร',
      body: [
        'การเกรดคือการส่งการ์ดไปให้บริษัทภายนอกตรวจสภาพและความแท้ แล้วซีลไว้ในตลับพลาสติกพร้อมคะแนนตั้งแต่ 1 ถึง 10 บริษัทที่นักสะสมไทยรู้จักมากที่สุดคือ PSA, BGS, CGC และ TAG',
        'การเกรดมีประโยชน์เมื่อการ์ดมีมูลค่าสูงพอที่ส่วนต่างราคาจะคุ้มค่าส่งและค่าบริการ การ์ดสภาพดีมากที่มีโอกาสได้ 9 ขึ้นไปมักคุ้มที่สุด ส่วนการ์ดราคาไม่สูงมักไม่คุ้ม',
        'CardStreet ไม่ได้ให้บริการส่งเกรด เราเป็นตลาดซื้อขายและแหล่งข้อมูลราคา การส่งเกรดต้องติดต่อบริษัทเหล่านั้นหรือตัวแทนรับส่งเกรดในไทยโดยตรง',
      ],
    },
    {
      title: 'ขายการ์ดเกรดบน CardStreet',
      body: [
        'ถ้าคุณมีการ์ดเกรดอยู่แล้วและอยากขาย ลงประกาศได้เลย ระบบแสดงการ์ดพร้อมกรอบตลับและโลโก้บริษัทเกรดให้ผู้ซื้อเห็นชัด และมีราคาตลาดของเกรดนั้นเป็นตัวอ้างอิงระหว่างตั้งราคา ผู้ขายเสียค่าธรรมเนียมเฉพาะตอนขายได้จริง ชำระผ่านบัตรหรือพร้อมเพย์ จัดส่งทั่วประเทศผ่าน Flash Express',
      ],
    },
  ],
  ctaPrices: 'เช็คราคาการ์ด',
  ctaSell: 'ลงขายการ์ดเกรด',
  faqLink: 'คำถามที่พบบ่อย',
};

export default function GradedContent() {
  const { isThai } = useTranslation();
  const t = isThai ? TH : EN;
  const prefix = isThai ? '' : '/en';

  return (
    <div className="min-h-screen bg-brand-darker text-white p-6 pb-24 overflow-y-auto">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="flex items-center gap-4 mb-8">
          <Link
            href={prefix || '/'}
            className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all"
            aria-label="Back"
          >
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </Link>
          <h1 className="text-2xl font-black uppercase tracking-tight italic skew-x-[-10deg]">{t.h1}</h1>
        </div>

        {t.intro.map((p) => (
          <p key={p.slice(0, 24)} className="text-sm text-slate-300 leading-relaxed mb-4">
            {p}
          </p>
        ))}

        {/* The sell CTA points at /sell-cards, the public seller landing — not
            at /sell, which is auth-gated and noindex. /sell-cards is where the
            link into the gated form belongs. */}
        <div className="flex flex-col sm:flex-row gap-3 mt-8 mb-12">
          <Link
            href={`${prefix}/prices`}
            className="flex-1 text-center bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider px-6 py-3 rounded-xl active:scale-[0.98] transition-all"
          >
            {t.ctaPrices}
          </Link>
          <Link
            href={`${prefix}/sell-cards`}
            className="flex-1 text-center glass border border-white/10 font-black uppercase tracking-wider px-6 py-3 rounded-xl active:scale-[0.98] transition-all"
          >
            {t.ctaSell}
          </Link>
        </div>

        <h2 className="text-lg font-black uppercase tracking-tight mb-3">{t.tiersTitle}</h2>
        <p className="text-sm text-slate-300 leading-relaxed mb-4">{t.tiersLead}</p>
        <ul className="space-y-2 mb-4">
          {t.tiers.map((tier) => (
            <li key={tier} className="glass rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-200">
              {tier}
            </li>
          ))}
        </ul>
        <p className="text-sm text-slate-300 leading-relaxed mb-12">{t.tiersAfter}</p>

        <h2 className="text-lg font-black uppercase tracking-tight mb-3">{t.sourcesTitle}</h2>
        <p className="text-sm text-slate-300 leading-relaxed mb-4">{t.sourcesLead}</p>
        <ol className="space-y-4 mb-4">
          {t.sources.map((s, i) => (
            <li key={s.t} className="glass rounded-2xl border border-white/10 p-5">
              <p className="text-sm font-bold text-brand-cyan mb-1">
                {i + 1}. {s.t}
              </p>
              <p className="text-sm text-slate-300 leading-relaxed">{s.d}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm text-slate-300 leading-relaxed mb-12">{t.sourcesAfter}</p>

        {t.more.map((section) => (
          <section key={section.title} className="mb-12">
            <h2 className="text-lg font-black uppercase tracking-tight mb-3">{section.title}</h2>
            {section.body.map((p) => (
              <p key={p.slice(0, 24)} className="text-sm text-slate-300 leading-relaxed mb-3">
                {p}
              </p>
            ))}
          </section>
        ))}

        <Link href={`${prefix}/faq`} className="text-sm text-brand-cyan font-bold hover:underline">
          {t.faqLink}
        </Link>
      </div>
    </div>
  );
}
