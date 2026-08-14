'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';
// Single-sourced with the HowTo JSON-LD in page.tsx. See howToSteps.ts for why
// it is a separate module and not an export from this one.
import { GRADED_HOWTO } from './howToSteps';

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
  howToTitle: string;
  /** Mirrored verbatim into HowTo JSON-LD by app/graded/page.tsx. */
  howTo: { t: string; d: string }[];
  worthTitle: string;
  worth: string[];
  companiesTitle: string;
  companiesLead: string;
  companies: { t: string; d: string }[];
  companiesAfter: string;
  mistakesTitle: string;
  mistakes: { t: string; d: string }[];
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
    'A graded copy of a card and a raw one are worth very different amounts — often several times apart. CardStreet tracks graded prices separately from raw ones: over 230,000 graded prices across PSA, BGS, CGC and SGC, updated daily and always shown in Thai baht.',
    'Open any card page on CardStreet and scroll to the graded prices section to see every tier we hold real data for. Tiers we have no data for are left blank rather than guessed.',
  ],
  howToTitle: GRADED_HOWTO.en.title,
  howTo: GRADED_HOWTO.en.steps,
  worthTitle: 'Is this card worth grading?',
  worth: [
    'Three numbers answer it. First, what the raw card is worth today. Second, what the same card is worth in the grade you think it would get. Third, what submitting actually costs you — the grading fee, shipping both ways, and an agent’s cut if you use one. If the gap between the second number and the first is not clearly larger than the third, it is not worth submitting yet.',
    'Two of those three are already on CardStreet. Open the card’s page and compare the raw price against the graded prices section. The cost of submitting has to come from the grading company or the agent you plan to use — they charge differently and the amounts change.',
    'The common mistake is running the numbers on the grade you are hoping for rather than the grade you are likely to get. On many cards the gap between the top grade and the one below it is large, and coming in a single grade under can wipe out the whole case for submitting. If you are unsure what condition a card is really in, the AI grade estimate is a way to filter before you spend anything.',
  ],
  companiesTitle: 'PSA, BGS, CGC, SGC and TAG — what is different',
  companiesLead: 'They all score from 1 to 10. What differs is how widely each is traded and how the score is broken down:',
  companies: [
    { t: 'PSA', d: 'The most recognised and most traded in the Pokémon market. One overall number, and PSA 10 is the grade the market quotes most often.' },
    { t: 'BGS', d: 'Scores four sub-grades — corners, edges, surface and centering — before an overall score, which is why 9.5 is common, and awards a Black Label when all four are a 10.' },
    { t: 'CGC', d: 'Came to trading cards later but has grown quickly. A different slab design, and sub-grades as well.' },
    { t: 'SGC', d: 'Long-established, and better known in sports cards than in trading card games.' },
    { t: 'TAG', d: 'Grades using an automated system and publishes detailed sub-scores. Increasingly of interest to Pokémon collectors.' },
  ],
  companiesAfter:
    'CardStreet renders cards from all of these with their slab frame and company logo, but our price data covers only the tiers listed above. TAG has no market price data.',
  mistakesTitle: 'Mistakes before you submit',
  mistakes: [
    { t: 'Submitting a card that is not valuable enough', d: 'If the gap between the raw price and the graded price is smaller than what submitting costs, the result is a slabbed card at a loss. Check both prices on the card page first, every time.' },
    { t: 'Trying to clean the card first', d: 'Wiping the surface usually leaves marks invisible to the eye but not to the grader’s camera, and altering a card’s condition counts as tampering. It makes the outcome worse, not better.' },
    { t: 'Ignoring centering', d: 'Centering is the one thing that cannot be fixed, and it is why plenty of beautiful cards miss the top grade. Check whether all four borders are even before you decide.' },
    { t: 'Submitting one card at a time', d: 'Shipping both ways is charged per submission, not per card. Batching several cards into one submission usually cuts the cost per card substantially.' },
    { t: 'Assuming grading always raises the price', d: 'Grading confirms condition and authenticity — it does not create demand that was not there. A common card in a high grade is still a common card.' },
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
    'การ์ดใบเดียวกันที่ผ่านการเกรดแล้วกับการ์ดดิบมีมูลค่าต่างกันมาก บางใบต่างกันหลายเท่า CardStreet จึงเก็บราคาการ์ดเกรดแยกจากราคาการ์ดดิบ รวมกว่า 230,000 รายการจากบริษัทเกรดหลัก ทั้ง PSA, BGS, CGC และ SGC อัปเดตทุกวันและแสดงเป็นเงินบาทเสมอ',
    'เปิดหน้าการ์ดใบไหนก็ได้บน CardStreet แล้วเลื่อนดูส่วนราคาการ์ดเกรด จะเห็นราคาของแต่ละระดับที่มีข้อมูลจริง ระดับไหนที่ยังไม่มีข้อมูล เราจะเว้นว่างไว้ ไม่เดาราคาให้',
  ],
  howToTitle: GRADED_HOWTO.th.title,
  howTo: GRADED_HOWTO.th.steps,
  worthTitle: 'การ์ดใบนี้คุ้มส่งเกรดไหม',
  worth: [
    'คำถามนี้ตอบได้ด้วยเลขสามตัว หนึ่งคือราคาการ์ดดิบใบนั้นตอนนี้ สองคือราคาของใบเดียวกันในเกรดที่คุณคิดว่าจะได้ และสามคือค่าใช้จ่ายรวมในการส่งเกรด ทั้งค่าบริการ ค่าส่งไปกลับ และค่าตัวแทนถ้าใช้ ถ้าส่วนต่างระหว่างเลขตัวที่สองกับตัวที่หนึ่งไม่มากกว่าเลขตัวที่สามอย่างชัดเจน การส่งเกรดก็ยังไม่คุ้ม',
    'สองในสามตัวนั้นอยู่บน CardStreet แล้ว เปิดหน้าการ์ดใบนั้นแล้วเทียบราคาดิบกับราคาในส่วนราคาการ์ดเกรดได้ทันที ส่วนค่าใช้จ่ายในการส่งเกรดต้องดูจากบริษัทเกรดหรือตัวแทนที่คุณจะใช้ เพราะแต่ละที่คิดไม่เท่ากันและเปลี่ยนเป็นระยะ',
    'จุดที่คนพลาดบ่อยคือคิดจากเกรดที่หวังไว้ ไม่ใช่เกรดที่น่าจะได้จริง ส่วนต่างราคาระหว่างเกรดสูงสุดกับเกรดรองลงมาห่างกันมากในการ์ดหลายใบ การ์ดที่ได้ต่ำกว่าที่หวังหนึ่งขั้นอาจทำให้ทั้งการส่งเกรดไม่คุ้มเลย ถ้าไม่แน่ใจว่าการ์ดอยู่ในสภาพระดับไหน เครื่องมือประเมินเกรดด้วย AI ช่วยคัดเบื้องต้นได้ก่อนจ่ายจริง',
  ],
  companiesTitle: 'PSA, BGS, CGC, SGC และ TAG ต่างกันยังไง',
  companiesLead: 'ทุกบริษัทให้คะแนน 1 ถึง 10 เหมือนกัน แต่ต่างกันที่ความนิยมในตลาดและรายละเอียดของการให้คะแนน:',
  companies: [
    { t: 'PSA', d: 'เป็นที่รู้จักและซื้อขายกันมากที่สุดในตลาดการ์ดโปเกมอน ให้คะแนนรวมเป็นตัวเลขเดียว PSA 10 คือเกรดที่ตลาดอ้างอิงบ่อยที่สุด' },
    { t: 'BGS', d: 'ให้คะแนนย่อยสี่ด้าน ทั้งมุม ขอบ ผิว และการเข้าศูนย์ ก่อนสรุปเป็นคะแนนรวม จึงมีระดับ 9.5 ที่พบบ่อย และมีระดับ Black Label สำหรับใบที่ได้ 10 ทั้งสี่ด้าน' },
    { t: 'CGC', d: 'เข้ามาในตลาดการ์ดเกมทีหลังแต่เติบโตเร็ว ใช้ตลับที่มีดีไซน์ต่างออกไปและมีคะแนนย่อยเช่นกัน' },
    { t: 'SGC', d: 'อยู่ในตลาดมานาน เป็นที่รู้จักในกลุ่มการ์ดกีฬามากกว่าการ์ดเกม' },
    { t: 'TAG', d: 'ใช้การให้คะแนนด้วยระบบอัตโนมัติและแสดงรายละเอียดคะแนนย่อยอย่างละเอียด กำลังได้รับความสนใจเพิ่มขึ้นในกลุ่มนักสะสมการ์ดโปเกมอน' },
  ],
  companiesAfter:
    'CardStreet แสดงการ์ดจากทุกบริษัทข้างต้นพร้อมกรอบตลับและโลโก้ แต่ข้อมูลราคาที่เรามีครอบคลุมเฉพาะระดับที่ระบุไว้ด้านบนของหน้านี้ ส่วน TAG ยังไม่มีข้อมูลราคาตลาด',
  mistakesTitle: 'ข้อผิดพลาดก่อนส่งเกรด',
  mistakes: [
    { t: 'ส่งเกรดการ์ดที่ราคายังไม่สูงพอ', d: 'ถ้าส่วนต่างระหว่างราคาดิบกับราคาเกรดน้อยกว่าค่าใช้จ่ายในการส่ง ผลที่ได้คือการ์ดในตลับที่ขาดทุน ตรวจสองราคานี้บนหน้าการ์ดก่อนเสมอ' },
    { t: 'พยายามทำความสะอาดการ์ดก่อนส่ง', d: 'การเช็ดผิวการ์ดมักทิ้งรอยที่มองไม่เห็นด้วยตาเปล่าแต่กล้องของบริษัทเกรดเห็น และการแก้ไขสภาพการ์ดถือเป็นการดัดแปลง ซึ่งทำให้ผลออกมาแย่กว่าเดิม' },
    { t: 'ไม่ดูการเข้าศูนย์ของภาพพิมพ์', d: 'การเข้าศูนย์เป็นสิ่งที่แก้ไม่ได้เลยและเป็นสาเหตุที่การ์ดสภาพสวยหลายใบไม่ได้เกรดสูงสุด ดูขอบทั้งสี่ด้านว่ากว้างเท่ากันไหมก่อนตัดสินใจ' },
    { t: 'ส่งทีละใบ', d: 'ค่าส่งไปกลับคิดต่อรอบ ไม่ใช่ต่อใบ การรวบหลายใบส่งครั้งเดียวมักลดต้นทุนต่อใบลงได้มาก' },
    { t: 'คิดว่าเกรดแล้วราคาจะขึ้นเสมอ', d: 'การเกรดยืนยันสภาพและความแท้ แต่ไม่ได้เพิ่มมูลค่าให้การ์ดที่ตลาดไม่ได้ต้องการอยู่แล้ว การ์ดทั่วไปที่เกรดสูงก็ยังเป็นการ์ดทั่วไป' },
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

// `prefix` comes from the URL — the server page passes localePrefix(pathLocale)
// — never from the cs_lang cookie. isThai still selects the copy, but a visitor
// on the bare Thai URL with an English UI must not be handed /en links on a
// Thai-canonical page. Links follow the URL; that rule was set in 8f6a342.
export default function GradedContent({ prefix }: { prefix: string }) {
  const { isThai } = useTranslation();
  const t = isThai ? TH : EN;

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

        {/* These four steps are mirrored verbatim into HowTo JSON-LD in
            app/graded/page.tsx. Edit both or neither — verify-graded-sell.mjs
            asserts every step's text appears here. */}
        <h2 className="text-lg font-black uppercase tracking-tight mb-3">{t.howToTitle}</h2>
        <ol className="space-y-4 mb-12">
          {t.howTo.map((s, i) => (
            <li key={s.t} className="glass rounded-2xl border border-white/10 p-5">
              <p className="text-sm font-bold text-brand-cyan mb-1">
                {i + 1}. {s.t}
              </p>
              <p className="text-sm text-slate-300 leading-relaxed">{s.d}</p>
            </li>
          ))}
        </ol>

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

        {/* Who the graders are, then whether to use one, then what goes wrong.
            Definition before decision — "what card grading is" sits in t.more
            above, so a reader reaches the cost arithmetic already knowing the
            terms. */}
        <h2 className="text-lg font-black uppercase tracking-tight mb-3">{t.companiesTitle}</h2>
        <p className="text-sm text-slate-300 leading-relaxed mb-4">{t.companiesLead}</p>
        <ul className="space-y-4 mb-4">
          {t.companies.map((c) => (
            <li key={c.t} className="glass rounded-2xl border border-white/10 p-5">
              <p className="text-sm font-bold text-brand-cyan mb-1">{c.t}</p>
              <p className="text-sm text-slate-300 leading-relaxed">{c.d}</p>
            </li>
          ))}
        </ul>
        <p className="text-sm text-slate-300 leading-relaxed mb-12">{t.companiesAfter}</p>

        <h2 className="text-lg font-black uppercase tracking-tight mb-3">{t.worthTitle}</h2>
        {t.worth.map((p) => (
          <p key={p.slice(0, 24)} className="text-sm text-slate-300 leading-relaxed mb-3">
            {p}
          </p>
        ))}

        <h2 className="text-lg font-black uppercase tracking-tight mb-3 mt-12">{t.mistakesTitle}</h2>
        <ul className="space-y-4 mb-12">
          {t.mistakes.map((m) => (
            <li key={m.t} className="glass rounded-2xl border border-white/10 p-5">
              <p className="text-sm font-bold text-brand-cyan mb-1">{m.t}</p>
              <p className="text-sm text-slate-300 leading-relaxed">{m.d}</p>
            </li>
          ))}
        </ul>

        <Link href={`${prefix}/faq`} className="text-sm text-brand-cyan font-bold hover:underline">
          {t.faqLink}
        </Link>
      </div>
    </div>
  );
}
