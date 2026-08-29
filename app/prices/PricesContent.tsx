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
  // The numbered steps. These are ALSO the HowTo JSON-LD steps in
  // app/prices/page.tsx and are kept in sync by hand — change one, change both.
  how: { t: string; d: string }[];
  identifyTitle: string;
  identify: { t: string; d: string }[];
  differTitle: string;
  differ: { t: string; d: string }[];
  sourceTitle: string;
  source: string;
  mistakesTitle: string;
  mistakes: { t: string; d: string }[];
  sellTitle: string;
  sell: string;
  ctaSearch: string;
  ctaSets: string;
  browseTitle: string;
  games: { href: string; label: string }[];
  gradedLink: string;
  sellLink: string;
  faqLink: string;
}

const EN: Strings = {
  h1: 'Check Trading Card Prices — Free, Updated Daily',
  intro1:
    'Wondering what your cards are worth? CardStreet tracks market prices for over 100,000 cards across more than 1,200 sets — Pokémon, Yu-Gi-Oh!, One Piece, Magic: The Gathering, Disney Lorcana and Riftbound. Search a card by name or number and see its current price straight away. Free, no account needed. It works as a card price-check app on your phone too: CardStreet has Android and iOS apps for checking prices while you are standing in a shop or opening a booster — scan a card with the camera to pull up its market price, no typing card names one at a time.',
  intro2:
    'Prices update daily from real sale data and are always shown in Thai baht, so there is no currency maths to do. Thai-language Pokémon cards are priced separately from their English and Japanese counterparts, because they trade in different markets — Thailand’s MA, SV and AS sets carry their own prices rather than inheriting English ones.',
  howTitle: 'How to check a card’s price',
  how: [
    {
      t: 'Identify the exact card',
      d: 'Start with the collector number in the bottom corner and the language on the card — the same card name can exist in several sets and several languages.',
    },
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
      t: 'Match the version before you trust the price',
      d: 'Check that the language, set, and version all match the copy you are actually holding.',
    },
    {
      t: 'See price history',
      d: 'Every card page has a price chart covering the last 7, 30 and 90 days.',
    },
  ],
  identifyTitle: 'Know exactly which card you are holding',
  identify: [
    {
      t: 'The collector number',
      d: 'Almost every game prints a number in a bottom corner — 087/198 means card 87 of a 198-card set. It is the most precise way to identify a card, because the same card name often appears in several sets.',
    },
    {
      t: 'The set symbol and code',
      d: 'Next to the number there is usually a short set code telling you which set the card came from. When two sets reuse a number, this is what separates them.',
    },
    {
      t: 'The language',
      d: 'Check whether the text is Thai, English, or Japanese. Cards in different languages are different cards to the market with their own prices — not one card translated.',
    },
    {
      t: 'Rarity and special versions',
      d: 'The rarity mark usually sits near the collector number, and some cards also exist as special-art or foil versions that are far scarcer than the regular one. If you are unsure, scan the card with the camera and it will identify the exact version.',
    },
  ],
  differTitle: 'Why the same card sells for different amounts',
  differ: [
    {
      t: 'Condition',
      d: 'A card with sharp corners, clean edges, and an unmarked surface sells for noticeably more than a played copy. Market prices on CardStreet reference cards in good condition, so a card with flaws will realistically sell below them.',
    },
    {
      t: 'Language',
      d: 'Thai, English, and Japanese cards trade in separate markets at different prices, which is why CardStreet prices them separately. Do not apply a price from one language to another.',
    },
    {
      t: 'Version and rarity',
      d: 'The same card name can exist as a regular print, a special-art version, and a foil, pulled at very different rates. Those can be worth several times each other within the same set.',
    },
    {
      t: 'Graded or raw',
      d: 'A graded card carries its own price by company and grade. You can see graded prices next to the raw price on the same card page.',
    },
  ],
  sourceTitle: 'Where the prices come from',
  source:
    'The figure shown is the market price — a midpoint drawn from recent real sales, not an inflated asking price. English and Japanese cards reference international market data converted to baht; Thai cards use pricing that reflects the domestic market. Graded cards (PSA, BGS, CGC, TAG) are priced separately from raw copies, since a high-grade slab is often worth several times the raw card.',
  mistakesTitle: 'Common mistakes when checking a price',
  mistakes: [
    {
      t: 'Comparing across languages',
      d: 'The most common one: pricing a Thai card from an English price for the same card. They are separate markets and the values differ substantially. Always match the language.',
    },
    {
      t: 'Comparing a regular card to a special version',
      d: 'The same name in a different version is a different price entirely. If a price looks surprisingly high, check whether you are looking at a special-art version.',
    },
    {
      t: 'Reading asking prices as market value',
      d: 'What a seller is asking is not the market price — anyone can ask anything. CardStreet market prices are built from transactions that actually happened, which makes them a firmer reference point.',
    },
    {
      t: 'Forgetting the condition of your own card',
      d: 'Market prices assume a card in good condition. If yours has edge wear or a bent corner, price it below market accordingly — it sells faster and avoids disputes when the buyer opens the package.',
    },
  ],
  sellTitle: 'Check a price, then sell it',
  // Do NOT reintroduce "paid once the buyer has received the card". On the live
  // TH path (direct charges) the sale lands in the seller's Stripe balance at
  // charge time and pays out on Stripe's automatic schedule — nothing is
  // delivery-gated. See supabase/functions/release-funds/index.ts.
  sell:
    'If you check a price and decide to sell, you can list the card from the same page. Sellers pay a fee only when a card actually sells — there are no listing fees. Buyers pay by card or PromptPay, orders ship nationwide with Flash Express, and your sale is paid into your Stripe account, which pays out on its normal schedule.',
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
  sellLink: 'Sell your cards',
  faqLink: 'Frequently asked questions',
};

const TH: Strings = {
  h1: 'เช็คราคาการ์ด — ราคาตลาดล่าสุด ฟรี',
  intro1:
    'อยากรู้ว่าการ์ดในมือมีมูลค่าเท่าไหร่? CardStreet รวบรวมราคาตลาดของการ์ดสะสมกว่า 100,000 ใบ จาก 1,200 กว่าชุด ทั้งโปเกม่อน ยูกิโอ วันพีช การ์ดดิสนีย์ (Disney Lorcana) Magic: The Gathering และ Riftbound ค้นหาชื่อการ์ดหรือเลขในชุด แล้วดูราคาล่าสุดได้ทันที ไม่มีค่าใช้จ่าย ไม่ต้องสมัครสมาชิก ใช้เป็นแอปเช็คราคาการ์ดบนมือถือก็ได้ เพราะ CardStreet มีแอปทั้ง Android และ iOS สำหรับคนที่อยากเช็คราคาตอนอยู่หน้าร้านหรือระหว่างเปิดบูสเตอร์ สแกนการ์ดด้วยกล้องแล้วดูราคาตลาดได้ทันที ไม่ต้องพิมพ์ชื่อการ์ดทีละใบ',
  intro2:
    'ราคาบน CardStreet อัปเดตทุกวันจากข้อมูลการซื้อขายจริง และแสดงเป็นเงินบาทเสมอ ไม่ต้องแปลงค่าเงินเอง การ์ดโปเกมอนภาษาไทยมีราคาแยกจากฉบับภาษาอังกฤษและญี่ปุ่น เพราะเป็นคนละตลาดกัน — ชุด MA, SV และ AS ของไทยจึงมีราคาของตัวเอง ไม่ได้ใช้ราคาการ์ดอังกฤษมาทับ',
  howTitle: 'วิธีเช็คราคาการ์ด',
  how: [
    {
      t: 'ดูให้แน่ว่าเป็นการ์ดใบไหน',
      d: 'ดูเลขการ์ดที่มุมล่างและภาษาบนการ์ดก่อน เพราะการ์ดชื่อเดียวกันมีได้หลายใบหลายชุดหลายภาษา',
    },
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
      t: 'เทียบให้ตรงเวอร์ชัน',
      d: 'ก่อนเชื่อราคาที่เห็น ให้เช็คว่าตรงทั้งภาษา ชุด และเวอร์ชันของการ์ดที่ถืออยู่จริง',
    },
    {
      t: 'ดูราคาย้อนหลัง',
      d: 'หน้าการ์ดแต่ละใบมีกราฟราคา ดูได้ว่าราคาขึ้นหรือลงในช่วง 7, 30 และ 90 วันที่ผ่านมา',
    },
  ],
  identifyTitle: 'รู้ให้แน่ว่าถือการ์ดใบไหนอยู่',
  identify: [
    {
      t: 'เลขการ์ดที่มุมล่าง',
      d: 'การ์ดเกือบทุกเกมพิมพ์เลขประจำใบไว้ที่มุมล่าง เช่น 087/198 หมายถึงใบที่ 87 จากทั้งชุด 198 ใบ เลขนี้คือวิธีที่แม่นยำที่สุดในการระบุการ์ด เพราะการ์ดชื่อเดียวกันอาจมีหลายใบในหลายชุด',
    },
    {
      t: 'สัญลักษณ์ชุดและรหัสชุด',
      d: 'ข้าง ๆ เลขการ์ดมักมีรหัสชุดสั้น ๆ กำกับอยู่ เป็นตัวบอกว่าการ์ดมาจากชุดไหน ถ้าเลขซ้ำกันระหว่างชุด รหัสนี้คือสิ่งที่แยกออกจากกัน',
    },
    {
      t: 'ภาษาของการ์ด',
      d: 'ดูจากตัวหนังสือบนการ์ดว่าเป็นภาษาไทย อังกฤษ หรือญี่ปุ่น เพราะการ์ดคนละภาษาคือคนละใบในตลาดและมีราคาคนละตัว ไม่ใช่การ์ดใบเดียวกันที่แปลภาษา',
    },
    {
      t: 'ระดับความหายากและเวอร์ชันพิเศษ',
      d: 'สัญลักษณ์ความหายากมักอยู่ใกล้เลขการ์ด และการ์ดบางใบมีเวอร์ชันภาพพิเศษหรือแบบสะท้อนแสงที่หายากกว่าเวอร์ชันธรรมดามาก ถ้าไม่แน่ใจ ให้สแกนด้วยกล้องแล้วระบบจะระบุเวอร์ชันให้เอง',
    },
  ],
  differTitle: 'ทำไมการ์ดใบเดียวกันถึงราคาไม่เท่ากัน',
  differ: [
    {
      t: 'สภาพการ์ด',
      d: 'การ์ดที่มุมคม ขอบไม่ขาว และผิวไม่มีรอย ขายได้ราคาสูงกว่าใบที่ผ่านการเล่นมาอย่างชัดเจน ราคาตลาดที่แสดงบน CardStreet อ้างอิงการ์ดสภาพดีเป็นหลัก ถ้าการ์ดของคุณมีตำหนิ ราคาที่ขายได้จริงจะต่ำกว่านั้น',
    },
    {
      t: 'ภาษา',
      d: 'การ์ดภาษาไทย อังกฤษ และญี่ปุ่น ซื้อขายกันคนละตลาดและมีราคาต่างกัน CardStreet จึงแยกราคาตามภาษาไว้ให้แล้ว อย่าเอาราคาของภาษาหนึ่งไปใช้กับอีกภาษาหนึ่ง',
    },
    {
      t: 'เวอร์ชันและความหายาก',
      d: 'การ์ดชื่อเดียวกันอาจมีทั้งเวอร์ชันธรรมดา เวอร์ชันภาพพิเศษ และแบบสะท้อนแสง ซึ่งออกมาในอัตราที่ต่างกันมาก ราคาจึงต่างกันได้หลายเท่าแม้เป็นการ์ดชื่อเดียวกันในชุดเดียวกัน',
    },
    {
      t: 'ผ่านการเกรดหรือไม่',
      d: 'การ์ดที่ส่งไปเกรดแล้วจะมีราคาแยกต่างหากตามบริษัทและระดับเกรด ดูราคาการ์ดเกรดควบคู่กับราคาการ์ดดิบได้ในหน้าการ์ดเดียวกัน',
    },
  ],
  sourceTitle: 'ราคาการ์ดมาจากไหน',
  source:
    'ราคาที่แสดงคือราคาตลาด — ค่ากลางจากการซื้อขายจริงในช่วงล่าสุด ไม่ใช่ราคาตั้งขายที่สูงเกินจริง สำหรับการ์ดภาษาอังกฤษและญี่ปุ่น ราคาอ้างอิงจากตลาดสากลแล้วแปลงเป็นเงินบาท ส่วนการ์ดไทยใช้ราคาที่สะท้อนตลาดในประเทศ การ์ดที่มีสภาพต่างกันหรือผ่านการเกรด (PSA, BGS, CGC, TAG) จะมีราคาแยกต่างหาก เพราะการ์ดเกรดสูงมักมีมูลค่าสูงกว่าการ์ดดิบหลายเท่า',
  mistakesTitle: 'ข้อผิดพลาดที่เจอบ่อยตอนเช็คราคา',
  mistakes: [
    {
      t: 'เทียบราคาข้ามภาษา',
      d: 'เจอบ่อยที่สุด คือเอาราคาการ์ดภาษาอังกฤษมาตั้งราคาการ์ดภาษาไทยใบเดียวกัน ทั้งสองเป็นคนละตลาดและมูลค่าต่างกันมาก ต้องดูให้ตรงภาษาเสมอ',
    },
    {
      t: 'เทียบเวอร์ชันธรรมดากับเวอร์ชันพิเศษ',
      d: 'การ์ดชื่อเดียวกันแต่คนละเวอร์ชันมีราคาคนละเรื่อง ถ้าเห็นราคาสูงผิดปกติ ให้เช็คก่อนว่ากำลังดูเวอร์ชันภาพพิเศษอยู่หรือเปล่า',
    },
    {
      t: 'ดูราคาที่ตั้งขาย ไม่ใช่ราคาที่ขายได้จริง',
      d: 'ราคาที่ผู้ขายตั้งไว้ไม่ใช่ราคาตลาด ใครก็ตั้งราคาเท่าไหร่ก็ได้ ราคาตลาดบน CardStreet คำนวณจากการซื้อขายที่เกิดขึ้นจริง จึงใช้เป็นจุดอ้างอิงได้ตรงกว่า',
    },
    {
      t: 'ลืมดูสภาพการ์ดของตัวเอง',
      d: 'ราคาตลาดอ้างอิงการ์ดสภาพดี ถ้าการ์ดมีรอยขาวที่ขอบหรือมุมงอ ควรตั้งราคาต่ำกว่าราคาตลาดตามสภาพจริง จะขายได้เร็วกว่าและไม่มีปัญหาตอนผู้ซื้อได้รับของ',
    },
  ],
  sellTitle: 'เช็คราคาแล้วขายต่อได้เลย',
  sell:
    'ถ้าเช็คราคาแล้วอยากขาย ลงประกาศขายบน CardStreet ได้จากหน้าการ์ดเดียวกัน ผู้ขายเสียค่าธรรมเนียมเฉพาะตอนขายได้จริง ไม่มีค่าลงประกาศ ผู้ซื้อชำระผ่านบัตรหรือพร้อมเพย์ จัดส่งทั่วประเทศผ่าน Flash Express และยอดขายจะเข้าบัญชี Stripe ของผู้ขาย แล้วโอนออกตามรอบการจ่ายเงินปกติของบัญชีนั้น',
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
  sellLink: 'ขายการ์ดของคุณ',
  faqLink: 'คำถามที่พบบ่อย',
};

// `prefix` comes from the URL — the server page passes localePrefix(pathLocale)
// — never from the cs_lang cookie. isThai still selects the copy, but a visitor
// on the bare Thai URL with an English UI must not be handed /en links on a
// Thai-canonical page. Links follow the URL; that rule was set in 8f6a342.
export default function PricesContent({ prefix }: { prefix: string }) {
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

        {/* Identify-before-source is deliberate: a reader who cannot name the
            card they are holding cannot use anything further down the page. */}
        <h2 className="text-lg font-black uppercase tracking-tight mb-4">{t.identifyTitle}</h2>
        <ul className="space-y-4 mb-12">
          {t.identify.map((item) => (
            <li key={item.t} className="glass rounded-2xl border border-white/10 p-5">
              <p className="text-sm font-bold text-brand-cyan mb-1">{item.t}</p>
              <p className="text-sm text-slate-300 leading-relaxed">{item.d}</p>
            </li>
          ))}
        </ul>

        <h2 className="text-lg font-black uppercase tracking-tight mb-4">{t.differTitle}</h2>
        <ul className="space-y-4 mb-12">
          {t.differ.map((item) => (
            <li key={item.t} className="glass rounded-2xl border border-white/10 p-5">
              <p className="text-sm font-bold text-brand-cyan mb-1">{item.t}</p>
              <p className="text-sm text-slate-300 leading-relaxed">{item.d}</p>
            </li>
          ))}
        </ul>

        <h2 className="text-lg font-black uppercase tracking-tight mb-4">{t.sourceTitle}</h2>
        <p className="text-sm text-slate-300 leading-relaxed mb-12">{t.source}</p>

        <h2 className="text-lg font-black uppercase tracking-tight mb-4">{t.mistakesTitle}</h2>
        <ul className="space-y-4 mb-12">
          {t.mistakes.map((item) => (
            <li key={item.t} className="glass rounded-2xl border border-white/10 p-5">
              <p className="text-sm font-bold text-brand-cyan mb-1">{item.t}</p>
              <p className="text-sm text-slate-300 leading-relaxed">{item.d}</p>
            </li>
          ))}
        </ul>

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
          <Link href={`${prefix}/sell-cards`} className="text-sm text-brand-cyan font-bold hover:underline">
            {t.sellLink}
          </Link>
          <Link href={`${prefix}/faq`} className="text-sm text-brand-cyan font-bold hover:underline">
            {t.faqLink}
          </Link>
        </div>
      </div>
    </div>
  );
}
