'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';

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
  steps: { t: string; d: string }[];
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
  startTitle: 'How to start',
  steps: [
    {
      t: 'Create an account and verify your identity',
      d: 'CardStreet pays out through Stripe, so Stripe needs to verify you — a Thai ID and bank account. It is a one-time step that takes a few minutes, and it has to be finished before you can be paid.',
    },
    {
      t: 'List a card',
      d: 'Search for the card or scan it with your camera, pick its condition, add your own photos, and set a price using the market price shown as a reference.',
    },
    {
      t: 'Pack and ship',
      d: 'When it sells you get a Flash Express label. Pack the card in a small padded mailer and pay Flash when they collect it — covered by the shipping the buyer already paid you. Oversized boxes cost more, and the extra is on you.',
    },
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
  startTitle: 'เริ่มขายยังไง',
  steps: [
    {
      t: 'สมัครบัญชีและยืนยันตัวตน',
      d: 'CardStreet จ่ายเงินผ่าน Stripe จึงต้องยืนยันตัวตนกับ Stripe ก่อน ใช้บัตรประชาชนและบัญชีธนาคารไทย ขั้นตอนนี้ทำครั้งเดียว ใช้เวลาไม่กี่นาที และต้องทำให้เสร็จก่อนจึงจะรับเงินได้',
    },
    {
      t: 'ลงขายการ์ด',
      d: 'ค้นหาการ์ดที่จะขายหรือสแกนด้วยกล้อง เลือกสภาพการ์ด ใส่รูปถ่ายจริง แล้วตั้งราคาโดยดูราคาตลาดที่ระบบแสดงไว้เป็นตัวอ้างอิง',
    },
    {
      t: 'แพ็คและส่ง',
      d: 'เมื่อขายได้ ระบบออกใบปะหน้า Flash Express ให้ แพ็คการ์ดใส่ซองกันกระแทก แล้วจ่ายค่าส่งให้ Flash ตอนเข้ารับพัสดุ ซึ่งเป็นเงินค่าจัดส่งที่ผู้ซื้อจ่ายมาแล้ว หากใช้กล่องขนาดใหญ่เกิน ค่าส่งส่วนต่างเป็นของผู้ขาย',
    },
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

export default function SellCardsContent() {
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
