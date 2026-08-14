'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';
// Single-sourced with the HowTo JSON-LD in page.tsx. See howToSteps.ts for why
// it is a separate module and not an export from this one.
import { SELL_HOWTO } from './howToSteps';

// Public "sell your cards" landing. /sell is the auth-gated, noindex listing
// form and stays that way — this is the crawlable page that makes the case.
//
// EVERY commercial number below is sourced, not written fresh. Keep it that way:
//   - 9% / 5% / 2% ladder ....... lib/partnerTiers.ts (NON_PARTNER_FEE_PERCENT,
//     PRO_SELLER_FEE_PERCENT, PARTNER_TIERS). If that ladder changes, this copy
//     is wrong until it is updated.
//   - Stripe 1.6% + tax ......... sellerInfo.stripeBody in lib/locales/*.json
//   - Flash label paid at pickup, oversized boxes on the seller ... sellerInfo.shippingBody
//
// Two claims this page must never make:
//   1. That the seller is paid after the buyer receives the card. On the live TH
//      path (direct charges) funds hit the seller's Stripe balance at charge
//      time and pay out on Stripe's automatic schedule — nothing is
//      delivery-gated. See supabase/functions/release-funds/index.ts.
//   2. That 9% is the only deduction. Stripe's processing fee comes out of the
//      seller's payout too, because the seller is merchant of record on TH. The
//      in-app sellerInfo modal discloses both; a public page must not disclose less.

interface Strings {
  h1: string;
  intro: string[];
  costTitle: string;
  costLead: string;
  costs: { t: string; d: string }[];
  costAfter: string;
  paidTitle: string;
  paid: string[];
  startTitle: string;
  /** Mirrored verbatim into HowTo JSON-LD by app/sell-cards/page.tsx. */
  steps: { t: string; d: string }[];
  priceTitle: string;
  price: string[];
  condTitle: string;
  condLead: string;
  conds: { t: string; d: string }[];
  condAfter: string;
  mistakesTitle: string;
  mistakes: { t: string; d: string }[];
  whatTitle: string;
  what: string;
  regionTitle: string;
  region: string;
  ctaStart: string;
  ctaPrices: string;
  gradedLink: string;
  faqLink: string;
}

const EN: Strings = {
  h1: 'Sell Your Cards on CardStreet',
  intro: [
    'If you have cards you no longer play, or duplicates from opening boxes, CardStreet lets you list them for free — no listing fees, no monthly charges. You pay a fee only when a card actually sells.',
    'You can sell Pokémon, Yu-Gi-Oh!, One Piece, Magic: The Gathering, Disney Lorcana and Riftbound, as singles or sealed product. The current market price for each card sits next to the price field while you list, so you are not guessing what to charge.',
  ],
  costTitle: 'What it costs',
  costLead: 'Two things come out of a sale, and both are stated here:',
  costs: [
    {
      t: 'The CardStreet fee — 9% of the item price',
      d: 'Nothing is charged on shipping. CardStreet Pro subscribers and Partner sellers pay 5%, dropping as low as 2% at the top partner tiers.',
    },
    {
      t: 'Stripe’s payment processing fee — 1.6% plus tax',
      d: 'Deducted from your payout. That one goes to Stripe, not to CardStreet.',
    },
  ],
  costAfter: 'No listing fees, no monthly charges, and if a card doesn’t sell it costs you nothing.',
  paidTitle: 'When you get paid',
  paid: [
    'When someone buys your card, the full amount — item price plus shipping — lands in your connected Stripe account, less the fees above. Stripe then pays it out to your bank on that account’s normal payout schedule.',
    'You can see every sale in your own Stripe dashboard.',
  ],
  startTitle: SELL_HOWTO.en.title,
  steps: SELL_HOWTO.en.steps,
  priceTitle: 'How to price a card so it actually sells',
  price: [
    'The market price on CardStreet is a reference, not a rule. You can list above or below it — just know why you are. A card in better-than-usual condition, with clear photos of the actual card, or one that is genuinely hard to find in Thailand, will support a higher price. Listing high simply to make more usually ends with the card sitting there.',
    'The thing new sellers miss most often: the market price you see is for a Near Mint copy. A card with whitened edges, soft corners or surface marks should be priced below it and described honestly. Overstating condition leads to disputes after the sale, and those cost both sides far more time than the extra baht was worth.',
    'Before you set a price, open that card’s page and see how many copies are already listed and at what price. When several are listed, buyers sort by price almost every time. When none are, you have more freedom — but the market price is still the number to anchor to.',
  ],
  condTitle: 'Picking the right condition',
  condLead: 'CardStreet uses the same condition scale as the international card market. Getting it right up front beats being challenged later:',
  conds: [
    { t: 'Mint (M)', d: 'As it came out of the pack — no flaw even under a light. Very few cards genuinely qualify.' },
    { t: 'Near Mint (NM)', d: 'Looks new at a glance; maybe a tiny edge or corner flaw up close. This is the most traded condition, and the one the market price refers to.' },
    { t: 'Lightly Played (LP)', d: 'Light wear is visible — slight edge whitening or a faint surface mark — but it still presents well.' },
    { t: 'Moderately Played (MP)', d: 'Flaws are obvious without looking closely: whitened edges, soft corners, scratches.' },
    { t: 'Heavily Played (HP)', d: 'Heavy wear — creases, bends, or damage across a large part of the surface.' },
    { t: 'Damaged (D)', d: 'Tears, water damage, or damage severe enough that the card is not playable.' },
  ],
  condAfter:
    'When you are torn between two grades, pick the lower one and post clear photos of the actual card. No buyer has ever complained about receiving a card in better condition than described.',
  mistakesTitle: 'Common mistakes when selling',
  mistakes: [
    { t: 'Using a stock image instead of the actual card', d: 'Collectors look at photos to judge condition, not to find out what the card looks like. Real photos of the front and back answer more questions than a paragraph of description.' },
    { t: 'Not finishing Stripe verification', d: 'You can list before it is done, but until it is finished the money cannot reach you. Getting it out of the way before anything sells is far less stressful.' },
    { t: 'Packing in a plain envelope', d: 'A card should always go in a sleeve plus a rigid backer or a padded mailer. A few baht of packaging is cheaper than a card that arrives bent — every time.' },
    { t: 'Forgetting there are two fees', d: 'What reaches your account is the item price less the CardStreet fee and less Stripe’s processing fee. Both are stated at the top of this page. Factor them in when you set the price.' },
    { t: 'Setting a price once and leaving it', d: 'Market prices move daily. A card priced two months ago may now be well above or below the market. Come back and review your own listings periodically.' },
  ],
  whatTitle: 'What you can sell',
  what:
    'Anything in the CardStreet catalog — Pokémon (Thai, English and Japanese printings), Yu-Gi-Oh!, One Piece, Magic: The Gathering, Disney Lorcana and Riftbound — as singles, sealed product, or graded cards from PSA, BGS, CGC or TAG, which render with the slab frame and the grading company’s logo so buyers can see exactly what they’re getting.',
  regionTitle: 'Selling is Thailand-only for now',
  region:
    'CardStreet currently supports sellers based in Thailand, because payouts and shipping are tied to Thai bank accounts and Flash Express. Browsing, scanning and collection tracking work from anywhere.',
  ctaStart: 'Start listing',
  ctaPrices: 'Check card prices first',
  gradedLink: 'Graded card prices',
  faqLink: 'Frequently asked questions',
};

const TH: Strings = {
  h1: 'ขายการ์ดสะสมบน CardStreet',
  intro: [
    'ถ้าคุณมีการ์ดที่ไม่ได้เล่นแล้ว หรือได้การ์ดซ้ำจากการเปิดกล่อง CardStreet ให้คุณลงขายได้ฟรี ไม่มีค่าลงประกาศ และไม่มีค่าบริการรายเดือน คุณจะเสียค่าธรรมเนียมก็ต่อเมื่อการ์ดขายได้จริงเท่านั้น',
    'ลงขายได้ทั้งการ์ดโปเกม่อน ยูกิโอ วันพีช Magic: The Gathering, Disney Lorcana และ Riftbound ทั้งการ์ดเดี่ยวและสินค้าซีล ระบบมีราคาตลาดล่าสุดของการ์ดใบนั้นให้ดูระหว่างตั้งราคา คุณจึงไม่ต้องเดาว่าควรตั้งเท่าไหร่',
  ],
  costTitle: 'ค่าธรรมเนียมเท่าไหร่',
  costLead: 'มีสองส่วนที่หักจากยอดขาย และเราบอกทั้งสองส่วนตรงนี้เลย:',
  costs: [
    {
      t: 'ค่าธรรมเนียม CardStreet — 9% ของราคาการ์ด',
      d: 'ไม่คิดค่าธรรมเนียมจากค่าจัดส่ง สมาชิก CardStreet Pro และผู้ขายระดับพาร์ทเนอร์เสีย 5% และลดลงได้ถึง 2% ตามระดับพาร์ทเนอร์',
    },
    {
      t: 'ค่าธรรมเนียมการชำระเงินของ Stripe — 1.6% บวกภาษี',
      d: 'หักจากยอดที่โอนเข้าบัญชีคุณ ส่วนนี้เป็นของ Stripe ไม่ใช่ของ CardStreet',
    },
  ],
  costAfter: 'ไม่มีค่าลงประกาศ ไม่มีค่าบริการรายเดือน และถ้าการ์ดไม่ขาย คุณไม่เสียอะไรเลย',
  paidTitle: 'ได้เงินเมื่อไหร่',
  paid: [
    'เมื่อมีคนซื้อการ์ดของคุณ ยอดเต็ม (ค่าการ์ดบวกค่าจัดส่ง) จะเข้าบัญชี Stripe ที่คุณเชื่อมไว้ทันที หักค่าธรรมเนียมข้างต้น จากนั้น Stripe จะโอนเข้าบัญชีธนาคารของคุณตามรอบการจ่ายเงินปกติของบัญชีนั้น',
    'คุณจะเห็นยอดขายทั้งหมดได้ในแดชบอร์ด Stripe ของคุณเอง',
  ],
  startTitle: SELL_HOWTO.th.title,
  steps: SELL_HOWTO.th.steps,
  priceTitle: 'ตั้งราคายังไงให้ขายได้',
  price: [
    'ราคาตลาดบน CardStreet เป็นตัวอ้างอิง ไม่ใช่ราคาบังคับ คุณตั้งสูงกว่าหรือต่ำกว่าก็ได้ แต่ควรรู้ว่ากำลังตั้งต่างจากตลาดเพราะอะไร การ์ดสภาพดีกว่าปกติ มีรูปถ่ายจริงชัดเจน หรือเป็นใบที่หายากในไทย เป็นเหตุผลที่ตั้งสูงกว่าได้จริง ส่วนการตั้งสูงกว่าเพราะอยากได้กำไรมากขึ้นเฉย ๆ มักจบลงที่การ์ดค้างอยู่นาน',
    'สิ่งที่คนขายมือใหม่มองข้ามบ่อยที่สุดคือ ราคาตลาดที่เห็นเป็นราคาของการ์ดสภาพ Near Mint การ์ดที่มีขอบขาว มุมทู่ หรือรอยบนผิว ควรตั้งต่ำกว่านั้นและระบุสภาพตามจริง การระบุสภาพเกินจริงทำให้เกิดข้อโต้แย้งหลังขาย ซึ่งเสียเวลาทั้งสองฝ่ายมากกว่าส่วนต่างราคาที่ได้เพิ่ม',
    'ก่อนตั้งราคา ลองเปิดหน้าการ์ดใบนั้นดูว่ามีคนลงขายอยู่กี่ใบและราคาเท่าไหร่ ถ้ามีหลายใบ ผู้ซื้อจะเรียงตามราคาเกือบทุกครั้ง ถ้ายังไม่มีใครลงขายเลย คุณมีอิสระในการตั้งราคามากกว่า แต่ก็ควรอิงราคาตลาดไว้เป็นหลักอยู่ดี',
  ],
  condTitle: 'เลือกสภาพการ์ดให้ตรง',
  condLead: 'CardStreet ใช้มาตรฐานสภาพเดียวกับตลาดการ์ดสากล เลือกให้ตรงตั้งแต่แรกดีกว่าถูกทักทีหลัง:',
  conds: [
    { t: 'Mint (M)', d: 'สภาพเหมือนเพิ่งแกะจากซอง ไม่มีตำหนิใด ๆ แม้ส่องไฟ ใบที่เข้าข่ายจริงมีน้อยมาก' },
    { t: 'Near Mint (NM)', d: 'ดูเผิน ๆ เหมือนใหม่ อาจมีตำหนิเล็กน้อยมากที่ขอบหรือมุมเมื่อส่องดูใกล้ ๆ เป็นสภาพที่ซื้อขายกันมากที่สุด และเป็นสภาพที่ราคาตลาดอ้างอิง' },
    { t: 'Lightly Played (LP)', d: 'เห็นร่องรอยการใช้งานเบา ๆ ขอบเริ่มขาวเล็กน้อยหรือมีรอยบนผิวบาง ๆ แต่ยังดูดีอยู่' },
    { t: 'Moderately Played (MP)', d: 'เห็นตำหนิชัดเจนโดยไม่ต้องส่อง ขอบขาว มุมทู่ หรือมีรอยขีดข่วน' },
    { t: 'Heavily Played (HP)', d: 'ตำหนิหนัก มีรอยพับ รอยงอ หรือผิวเสียหายเป็นบริเวณกว้าง' },
    { t: 'Damaged (D)', d: 'ฉีก ขาด มีน้ำเข้า หรือเสียหายจนไม่อยู่ในสภาพเล่นได้' },
  ],
  condAfter:
    'ถ้าลังเลระหว่างสองระดับ ให้เลือกระดับที่ต่ำกว่าและใส่รูปถ่ายจริงให้ชัด ผู้ซื้อที่ได้การ์ดสภาพดีกว่าที่ระบุไว้ไม่เคยร้องเรียน',
  mistakesTitle: 'ข้อผิดพลาดที่พบบ่อยตอนขายการ์ด',
  mistakes: [
    { t: 'ใช้รูปจากอินเทอร์เน็ตแทนรูปการ์ดจริง', d: 'ผู้ซื้อการ์ดสะสมดูรูปเพื่อตรวจสภาพ ไม่ใช่เพื่อดูว่าการ์ดหน้าตาเป็นยังไง ประกาศที่ใช้รูปจริงทั้งด้านหน้าและด้านหลังตอบคำถามได้มากกว่าคำบรรยายทั้งย่อหน้า' },
    { t: 'ยังไม่ยืนยันตัวตนกับ Stripe ให้เสร็จ', d: 'ลงขายได้ก่อนก็จริง แต่ถ้ายังยืนยันไม่เสร็จ เงินจะยังไม่เข้าบัญชีคุณ ทำให้จบตั้งแต่ตอนที่ยังไม่มีคนซื้อจะสบายใจกว่ามาก' },
    { t: 'แพ็คด้วยซองธรรมดา', d: 'การ์ดควรอยู่ในซองใสและกระดาษแข็งหรือซองกันกระแทกเสมอ ค่าซองไม่กี่บาทถูกกว่าการ์ดที่งอระหว่างทางเสมอ' },
    { t: 'ลืมว่ามีค่าธรรมเนียมสองส่วน', d: 'ยอดที่เข้าบัญชีคือราคาการ์ดหักค่าธรรมเนียม CardStreet และหักค่าธรรมเนียมการชำระเงินของ Stripe ทั้งสองส่วนระบุไว้ด้านบนของหน้านี้แล้ว คิดเผื่อไว้ตั้งแต่ตอนตั้งราคา' },
    { t: 'ตั้งราคาครั้งเดียวแล้วปล่อยทิ้งไว้', d: 'ราคาตลาดเปลี่ยนทุกวัน การ์ดที่ตั้งไว้เมื่อสองเดือนก่อนอาจแพงหรือถูกกว่าตลาดไปมากแล้ว กลับมาดูประกาศของตัวเองเป็นระยะ' },
  ],
  whatTitle: 'ขายอะไรได้บ้าง',
  what:
    'ลงขายได้ทุกเกมในแคตตาล็อกของ CardStreet — โปเกม่อน (ทั้งภาษาไทย อังกฤษ และญี่ปุ่น) ยูกิโอ วันพีช Magic: The Gathering, Disney Lorcana และ Riftbound ทั้งการ์ดเดี่ยว สินค้าซีล และการ์ดที่ผ่านการเกรดจาก PSA, BGS, CGC หรือ TAG ซึ่งระบบจะแสดงกรอบตลับและโลโก้บริษัทเกรดให้ผู้ซื้อเห็นชัด',
  regionTitle: 'ขายได้เฉพาะในประเทศไทย',
  region:
    'ตอนนี้ CardStreet รองรับผู้ขายที่อยู่ในประเทศไทยเท่านั้น เพราะระบบรับเงินและระบบจัดส่งผูกกับบัญชีธนาคารไทยและ Flash Express ส่วนการเลือกดูการ์ด สแกนการ์ด และเก็บคอลเลกชัน ใช้งานได้จากทุกประเทศ',
  ctaStart: 'เริ่มลงขาย',
  ctaPrices: 'เช็คราคาการ์ดก่อนตั้งราคา',
  gradedLink: 'ราคาการ์ดเกรด',
  faqLink: 'คำถามที่พบบ่อย',
};

// `prefix` comes from the URL — the server page passes localePrefix(pathLocale)
// — never from the cs_lang cookie. isThai still selects the copy, but a visitor
// on the bare Thai URL with an English UI must not be handed /en links on a
// Thai-canonical page. Links follow the URL; that rule was set in 8f6a342.
export default function SellCardsContent({ prefix }: { prefix: string }) {
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

        {/* Unlike /prices and /graded, this page SHOULD link to /sell — it is the
            real conversion target. /sell stays noindex; one indexable page
            pointing at the app's gated entry point is normal. */}
        <div className="flex flex-col sm:flex-row gap-3 mt-8 mb-12">
          <Link
            href={`${prefix}/sell`}
            className="flex-1 text-center bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider px-6 py-3 rounded-xl active:scale-[0.98] transition-all"
          >
            {t.ctaStart}
          </Link>
          <Link
            href={`${prefix}/prices`}
            className="flex-1 text-center glass border border-white/10 font-black uppercase tracking-wider px-6 py-3 rounded-xl active:scale-[0.98] transition-all"
          >
            {t.ctaPrices}
          </Link>
        </div>

        <h2 className="text-lg font-black uppercase tracking-tight mb-3">{t.costTitle}</h2>
        <p className="text-sm text-slate-300 leading-relaxed mb-4">{t.costLead}</p>
        <ol className="space-y-4 mb-4">
          {t.costs.map((c, i) => (
            <li key={c.t} className="glass rounded-2xl border border-white/10 p-5">
              <p className="text-sm font-bold text-brand-cyan mb-1">
                {i + 1}. {c.t}
              </p>
              <p className="text-sm text-slate-300 leading-relaxed">{c.d}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm text-slate-300 leading-relaxed mb-12">{t.costAfter}</p>

        <h2 className="text-lg font-black uppercase tracking-tight mb-3">{t.paidTitle}</h2>
        {t.paid.map((p) => (
          <p key={p.slice(0, 24)} className="text-sm text-slate-300 leading-relaxed mb-3">
            {p}
          </p>
        ))}

        {/* These steps are mirrored verbatim into HowTo JSON-LD via SELL_HOWTO
            in app/sell-cards/page.tsx — they were already written as a how-to
            and simply were not marked up. */}
        <h2 className="text-lg font-black uppercase tracking-tight mb-3 mt-12">{t.startTitle}</h2>
        <ol className="space-y-4 mb-12">
          {t.steps.map((s, i) => (
            <li key={s.t} className="glass rounded-2xl border border-white/10 p-5">
              <p className="text-sm font-bold text-brand-cyan mb-1">
                {i + 1}. {s.t}
              </p>
              <p className="text-sm text-slate-300 leading-relaxed">{s.d}</p>
            </li>
          ))}
        </ol>

        <h2 className="text-lg font-black uppercase tracking-tight mb-3">{t.priceTitle}</h2>
        {t.price.map((p) => (
          <p key={p.slice(0, 24)} className="text-sm text-slate-300 leading-relaxed mb-3">
            {p}
          </p>
        ))}

        <h2 className="text-lg font-black uppercase tracking-tight mb-3 mt-12">{t.condTitle}</h2>
        <p className="text-sm text-slate-300 leading-relaxed mb-4">{t.condLead}</p>
        <ul className="space-y-4 mb-4">
          {t.conds.map((c) => (
            <li key={c.t} className="glass rounded-2xl border border-white/10 p-5">
              <p className="text-sm font-bold text-brand-cyan mb-1">{c.t}</p>
              <p className="text-sm text-slate-300 leading-relaxed">{c.d}</p>
            </li>
          ))}
        </ul>
        <p className="text-sm text-slate-300 leading-relaxed mb-12">{t.condAfter}</p>

        <h2 className="text-lg font-black uppercase tracking-tight mb-3">{t.mistakesTitle}</h2>
        <ul className="space-y-4 mb-12">
          {t.mistakes.map((m) => (
            <li key={m.t} className="glass rounded-2xl border border-white/10 p-5">
              <p className="text-sm font-bold text-brand-cyan mb-1">{m.t}</p>
              <p className="text-sm text-slate-300 leading-relaxed">{m.d}</p>
            </li>
          ))}
        </ul>

        <h2 className="text-lg font-black uppercase tracking-tight mb-3">{t.whatTitle}</h2>
        <p className="text-sm text-slate-300 leading-relaxed mb-12">{t.what}</p>

        <h2 className="text-lg font-black uppercase tracking-tight mb-3">{t.regionTitle}</h2>
        <p className="text-sm text-slate-300 leading-relaxed mb-12">{t.region}</p>

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
