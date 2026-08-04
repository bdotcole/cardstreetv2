'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';

// Bilingual copy lives in this module rather than lib/locales/*.json because it
// is page-prose, not reusable UI strings, and it has to stay readable as a whole
// — it is the argument the page makes, and reviewing it split across a hundred
// dotted keys would be worse. Client component, but the strings are static, so
// React renders every word into the initial HTML: crawlers and answer engines
// see the full page without running JS. (Contrast the homepage listing grid,
// which client-FETCHES its data and therefore contributes nothing crawlable.)

interface Strings {
  h1: string;
  intro1: string;
  intro2: string;
  howTitle: string;
  how: { t: string; d: string }[];
  sourceTitle: string;
  source: string;
  sellTitle: string;
  sell: string;
  ctaSearch: string;
  ctaSets: string;
  browseTitle: string;
  games: { href: string; label: string }[];
  gradedLink: string;
  faqLink: string;
}

const EN: Strings = {
  h1: 'Check Trading Card Prices — Free, Updated Daily',
  intro1:
    'Wondering what your cards are worth? CardStreet tracks market prices for over 100,000 cards across more than 1,200 sets — Pokémon, Yu-Gi-Oh!, One Piece, Magic: The Gathering, Disney Lorcana and Riftbound. Search a card by name or number and see its current price straight away. Free, no account needed.',
  intro2:
    'Prices update daily from real sale data and are always shown in Thai baht, so there is no currency maths to do. Thai-language Pokémon cards are priced separately from their English and Japanese counterparts, because they trade in different markets — Thailand’s MA, SV and AS sets carry their own prices rather than inheriting English ones.',
  howTitle: 'How to check a card’s price',
  how: [
    {
      t: 'Search by name',
      d: 'Type the card name in Thai, English or Japanese. Search covers every game and every language at once.',
    },
    {
      t: 'Search by number',
      d: 'If you know the collector number, e.g. 087/198, type the card name followed by the number to jump straight to it.',
    },
    {
      t: 'Scan with your camera',
      d: 'Point your camera at the card and CardStreet identifies it automatically and shows the price. Works on Thai, English and Japanese printings.',
    },
    {
      t: 'See price history',
      d: 'Every card page has a price chart covering the last 7, 30 and 90 days.',
    },
  ],
  sourceTitle: 'Where the prices come from',
  source:
    'The figure shown is the market price — a midpoint drawn from recent real sales, not an inflated asking price. English and Japanese cards reference international market data converted to baht; Thai cards use pricing that reflects the domestic market. Graded cards (PSA, BGS, CGC, TAG) are priced separately from raw copies, since a high-grade slab is often worth several times the raw card.',
  sellTitle: 'Check a price, then sell it',
  sell:
    'If you check a price and decide to sell, you can list the card from the same page. Sellers pay a fee only when a card actually sells — there are no listing fees. Buyers pay by card or PromptPay, orders ship nationwide with Flash Express, and the seller is paid once the buyer has received the card.',
  ctaSearch: 'Search or scan a card',
  ctaSets: 'Browse all sets',
  browseTitle: 'Browse prices by game',
  games: [
    { href: '/en/pokemon', label: 'Pokémon' },
    { href: '/en/one-piece', label: 'One Piece' },
    { href: '/en/yugioh', label: 'Yu-Gi-Oh!' },
    { href: '/en/mtg', label: 'Magic: The Gathering' },
    { href: '/en/lorcana', label: 'Disney Lorcana' },
    { href: '/en/riftbound', label: 'Riftbound' },
  ],
  gradedLink: 'Graded card prices',
  faqLink: 'Frequently asked questions',
};

const TH: Strings = {
  h1: 'เช็คราคาการ์ด — ราคาตลาดล่าสุด ฟรี',
  intro1:
    'อยากรู้ว่าการ์ดในมือมีมูลค่าเท่าไหร่? CardStreet รวบรวมราคาตลาดของการ์ดสะสมกว่า 100,000 ใบ จาก 1,200 กว่าชุด ทั้งโปเกม่อน ยูกิโอ วันพีช Magic: The Gathering, Disney Lorcana และ Riftbound ค้นหาชื่อการ์ดหรือเลขในชุด แล้วดูราคาล่าสุดได้ทันที ไม่มีค่าใช้จ่าย ไม่ต้องสมัครสมาชิก',
  intro2:
    'ราคาบน CardStreet อัปเดตทุกวันจากข้อมูลการซื้อขายจริง และแสดงเป็นเงินบาทเสมอ ไม่ต้องแปลงค่าเงินเอง การ์ดโปเกมอนภาษาไทยมีราคาแยกจากฉบับภาษาอังกฤษและญี่ปุ่น เพราะเป็นคนละตลาดกัน — ชุด MA, SV และ AS ของไทยจึงมีราคาของตัวเอง ไม่ได้ใช้ราคาการ์ดอังกฤษมาทับ',
  howTitle: 'วิธีเช็คราคาการ์ด',
  how: [
    {
      t: 'ค้นหาด้วยชื่อการ์ด',
      d: 'พิมพ์ชื่อการ์ดเป็นภาษาไทย อังกฤษ หรือญี่ปุ่นก็ได้ ระบบค้นหาครอบคลุมทุกเกมและทุกภาษาพร้อมกัน',
    },
    {
      t: 'ค้นหาด้วยเลขการ์ด',
      d: 'ถ้ารู้เลขในชุด เช่น 087/198 พิมพ์ชื่อการ์ดตามด้วยเลขได้เลย จะเจอใบที่ต้องการเร็วกว่า',
    },
    {
      t: 'สแกนด้วยกล้อง',
      d: 'เปิดกล้องแล้วส่องที่การ์ด ระบบจะระบุใบนั้นให้อัตโนมัติพร้อมแสดงราคา ใช้ได้กับการ์ดไทย อังกฤษ และญี่ปุ่น',
    },
    {
      t: 'ดูราคาย้อนหลัง',
      d: 'หน้าการ์ดแต่ละใบมีกราฟราคา ดูได้ว่าราคาขึ้นหรือลงในช่วง 7, 30 และ 90 วันที่ผ่านมา',
    },
  ],
  sourceTitle: 'ราคาการ์ดมาจากไหน',
  source:
    'ราคาที่แสดงคือราคาตลาด — ค่ากลางจากการซื้อขายจริงในช่วงล่าสุด ไม่ใช่ราคาตั้งขายที่สูงเกินจริง สำหรับการ์ดภาษาอังกฤษและญี่ปุ่น ราคาอ้างอิงจากตลาดสากลแล้วแปลงเป็นเงินบาท ส่วนการ์ดไทยใช้ราคาที่สะท้อนตลาดในประเทศ การ์ดที่มีสภาพต่างกันหรือผ่านการเกรด (PSA, BGS, CGC, TAG) จะมีราคาแยกต่างหาก เพราะการ์ดเกรดสูงมักมีมูลค่าสูงกว่าการ์ดดิบหลายเท่า',
  sellTitle: 'เช็คราคาแล้วขายต่อได้เลย',
  sell:
    'ถ้าเช็คราคาแล้วอยากขาย ลงประกาศขายบน CardStreet ได้จากหน้าการ์ดเดียวกัน ผู้ขายเสียค่าธรรมเนียมเฉพาะตอนขายได้จริง ไม่มีค่าลงประกาศ ผู้ซื้อชำระผ่านบัตรหรือพร้อมเพย์ และจัดส่งทั่วประเทศผ่าน Flash Express โดยเงินจะโอนเข้าบัญชีผู้ขายหลังผู้ซื้อได้รับการ์ดแล้ว',
  ctaSearch: 'ค้นหาหรือสแกนการ์ด',
  ctaSets: 'ดูชุดการ์ดทั้งหมด',
  browseTitle: 'ดูราคาแยกตามเกม',
  games: [
    { href: '/pokemon', label: 'การ์ดโปเกมอน' },
    { href: '/one-piece', label: 'การ์ดวันพีช' },
    { href: '/yugioh', label: 'การ์ดยูกิโอ' },
    { href: '/mtg', label: 'การ์ด Magic: The Gathering' },
    { href: '/lorcana', label: 'การ์ด Disney Lorcana' },
    { href: '/riftbound', label: 'การ์ด Riftbound' },
  ],
  gradedLink: 'ราคาการ์ดเกรด',
  faqLink: 'คำถามที่พบบ่อย',
};

export default function PricesContent() {
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

        <p className="text-sm text-slate-300 leading-relaxed mb-4">{t.intro1}</p>
        <p className="text-sm text-slate-300 leading-relaxed mb-8">{t.intro2}</p>

        {/* Both CTAs point at routes that exist. There is no deep link into the
            SPA's search or scanner today (app/page.tsx reads no search params),
            so the primary CTA lands on the app shell where both live. */}
        <div className="flex flex-col sm:flex-row gap-3 mb-12">
          <Link
            href={prefix || '/'}
            className="flex-1 text-center bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider px-6 py-3 rounded-xl active:scale-[0.98] transition-all"
          >
            {t.ctaSearch}
          </Link>
          <Link
            href={`${prefix}/sets`}
            className="flex-1 text-center glass border border-white/10 font-black uppercase tracking-wider px-6 py-3 rounded-xl active:scale-[0.98] transition-all"
          >
            {t.ctaSets}
          </Link>
        </div>

        <h2 className="text-lg font-black uppercase tracking-tight mb-4">{t.howTitle}</h2>
        <ol className="space-y-4 mb-12">
          {t.how.map((step, i) => (
            <li key={step.t} className="glass rounded-2xl border border-white/10 p-5">
              <p className="text-sm font-bold text-brand-cyan mb-1">
                {i + 1}. {step.t}
              </p>
              <p className="text-sm text-slate-300 leading-relaxed">{step.d}</p>
            </li>
          ))}
        </ol>

        <h2 className="text-lg font-black uppercase tracking-tight mb-4">{t.sourceTitle}</h2>
        <p className="text-sm text-slate-300 leading-relaxed mb-12">{t.source}</p>

        <h2 className="text-lg font-black uppercase tracking-tight mb-4">{t.sellTitle}</h2>
        <p className="text-sm text-slate-300 leading-relaxed mb-12">{t.sell}</p>

        {/* Real anchors, server-rendered: card and set pages currently average
            about one crawlable inlink each, and this page is a cheap hub. */}
        <h2 className="text-lg font-black uppercase tracking-tight mb-4">{t.browseTitle}</h2>
        <div className="flex flex-wrap gap-2 mb-6">
          {t.games.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              className="glass border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 hover:text-brand-cyan transition-colors"
            >
              {g.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-4">
          <Link href={`${prefix}/graded`} className="text-sm text-brand-cyan font-bold hover:underline">
            {t.gradedLink}
          </Link>
          <Link href={`${prefix}/faq`} className="text-sm text-brand-cyan font-bold hover:underline">
            {t.faqLink}
          </Link>
        </div>
      </div>
    </div>
  );
}
