import type { Metadata } from 'next';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL, DEFAULT_OG_IMAGE } from '@/lib/i18nRouting';
import SellCardsContent from './SellCardsContent';
import { SELL_HOWTO } from './howToSteps';

// Public "sell your cards" landing, targeting ขายการ์ดโปเกมอน / รับซื้อการ์ด /
// ขายการ์ดที่ไหนดี. Nothing crawlable made the case for selling before this:
// /sell is the auth-gated listing form and is noindex,nofollow, so the seller
// funnel — the business's known bottleneck — had no front door in search.
//
// The route is /sell-cards, NOT /sell. Do not merge them and do not un-noindex
// /sell; this page links to it as its conversion target.
//
// Commercial claims are sourced from lib/partnerTiers.ts and the in-app
// sellerInfo.* strings rather than written fresh — see the header of
// SellCardsContent.tsx for the full list and the two claims this page must
// never make.
export async function generateMetadata(): Promise<Metadata> {
    const pathLocale = await requestPathLocale();
    const isThai = pathLocale === 'th';
    return {
        metadataBase: new URL(BASE_URL),
        title: isThai
            ? 'ขายการ์ดโปเกม่อน ยูกิ วันพีช — ลงขายฟรี รับเงินผ่านพร้อมเพย์ | CardStreet'
            : 'Sell Pokémon, Yu-Gi-Oh & One Piece Cards in Thailand | CardStreet',
        description: isThai
            ? 'ขายการ์ดโปเกม่อน ยูกิโอ วันพีช MTG และ Lorcana บน CardStreet ลงประกาศฟรี ไม่มีค่าลงขาย เสียค่าธรรมเนียมเฉพาะตอนขายได้ พร้อมระบบจัดส่ง Flash Express และรับเงินเข้าบัญชีอัตโนมัติ'
            : 'Sell your trading cards on CardStreet — free to list, no monthly fees, and you only pay a fee when a card sells. Flash Express shipping labels and automatic payouts to your Thai bank account.',
        alternates: buildAlternates('/sell-cards', pathLocale),
        openGraph: {
            images: DEFAULT_OG_IMAGE,
            title: isThai
                ? 'ขายการ์ดสะสมบน CardStreet — ลงขายฟรี'
                : 'Sell Your Cards on CardStreet — Free to List',
            description: isThai
                ? 'ลงขายการ์ดฟรี ไม่มีค่าลงประกาศ เสียค่าธรรมเนียมเฉพาะตอนขายได้จริง จัดส่งทั่วไทยผ่าน Flash Express'
                : 'List for free, pay a fee only when a card sells, and ship nationwide with Flash Express.',
            type: 'website',
            siteName: 'CardStreet',
            url: localizedUrl('/sell-cards', pathLocale),
        },
    };
}

/**
 * FAQPage structured data, locale-matched.
 *
 * These answers are commercial claims, so each one mirrors a source of truth:
 * the fee ladder in lib/partnerTiers.ts, the Stripe processing fee and shipping
 * flow in the sellerInfo.* strings, and the TH payout behaviour in
 * supabase/functions/release-funds/index.ts. Keep them in sync with the visible
 * copy — an answer engine may quote either.
 */
function buildFaqJsonLd(isThai: boolean): Record<string, unknown> {
    const faqs = isThai
        ? [
              [
                  'ขายการ์ดบน CardStreet เสียค่าธรรมเนียมเท่าไหร่',
                  'มีสองส่วน: ค่าธรรมเนียม CardStreet 9% ของราคาการ์ด (ไม่คิดจากค่าจัดส่ง) ซึ่งสมาชิก CardStreet Pro และผู้ขายระดับพาร์ทเนอร์เสีย 5% และลดได้ถึง 2% ตามระดับ และค่าธรรมเนียมการชำระเงินของ Stripe อีก 1.6% บวกภาษี ที่หักจากยอดโอนเข้าบัญชี ไม่มีค่าลงประกาศและไม่มีค่าบริการรายเดือน',
              ],
              [
                  'ขายการ์ดแล้วได้เงินเมื่อไหร่',
                  'เมื่อมีคนซื้อ ยอดเต็มคือค่าการ์ดบวกค่าจัดส่งจะเข้าบัญชี Stripe ที่ผู้ขายเชื่อมไว้ทันที หลังหักค่าธรรมเนียม จากนั้น Stripe จะโอนเข้าบัญชีธนาคารตามรอบการจ่ายเงินปกติของบัญชีนั้น ผู้ขายดูยอดขายทั้งหมดได้ในแดชบอร์ด Stripe ของตัวเอง',
              ],
              [
                  'เริ่มขายการ์ดบน CardStreet ต้องทำอะไรบ้าง',
                  'สมัครบัญชีและยืนยันตัวตนกับ Stripe ด้วยบัตรประชาชนและบัญชีธนาคารไทยก่อนหนึ่งครั้ง จากนั้นค้นหาหรือสแกนการ์ดที่จะขาย เลือกสภาพ ใส่รูปถ่ายจริง แล้วตั้งราคาโดยดูราคาตลาดเป็นตัวอ้างอิง เมื่อขายได้ระบบจะออกใบปะหน้า Flash Express ให้',
              ],
              [
                  'ค่าจัดส่งใครเป็นคนจ่าย',
                  'ผู้ซื้อจ่ายค่าจัดส่งมาพร้อมค่าการ์ดตอนสั่งซื้อ ผู้ขายเป็นคนจ่ายให้ Flash Express ตอนเข้ารับพัสดุ โดยใช้เงินค่าจัดส่งที่ผู้ซื้อจ่ายมาแล้ว หากใช้กล่องขนาดใหญ่เกิน ค่าส่งส่วนต่างเป็นความรับผิดชอบของผู้ขาย',
              ],
              [
                  'อยู่ต่างประเทศขายการ์ดบน CardStreet ได้ไหม',
                  'ยังไม่ได้ ตอนนี้ CardStreet รองรับผู้ขายที่อยู่ในประเทศไทยเท่านั้น เพราะระบบรับเงินและระบบจัดส่งผูกกับบัญชีธนาคารไทยและ Flash Express ส่วนการเลือกดูการ์ด สแกนการ์ด และเก็บคอลเลกชัน ใช้งานได้จากทุกประเทศ',
              ],
          ]
        : [
              [
                  'What does it cost to sell on CardStreet?',
                  'Two things: the CardStreet fee of 9% of the item price, with nothing charged on shipping — CardStreet Pro subscribers and Partner sellers pay 5%, dropping as low as 2% at the top tiers — and Stripe’s payment processing fee of 1.6% plus tax, deducted from your payout. There are no listing fees and no monthly charges.',
              ],
              [
                  'When do I get paid after selling a card?',
                  'When someone buys, the full amount — item price plus shipping — lands in your connected Stripe account, less the fees. Stripe then pays it out to your bank on that account’s normal payout schedule. You can see every sale in your own Stripe dashboard.',
              ],
              [
                  'How do I start selling on CardStreet?',
                  'Create an account and complete a one-time Stripe identity verification with a Thai ID and bank account. Then search for or scan the card you want to sell, pick its condition, add your own photos, and set a price using the market price as a reference. When it sells you get a Flash Express label.',
              ],
              [
                  'Who pays for shipping?',
                  'The buyer pays shipping alongside the item price at checkout. The seller pays Flash Express when they collect the parcel, covered by the shipping the buyer already paid. Oversized boxes cost more, and the extra is on the seller.',
              ],
              [
                  'Can I sell on CardStreet from outside Thailand?',
                  'Not yet. CardStreet currently supports sellers based in Thailand, because payouts and shipping are tied to Thai bank accounts and Flash Express. Browsing, scanning and collection tracking work from anywhere.',
              ],
          ];

    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        inLanguage: isThai ? 'th-TH' : 'en-TH',
        mainEntity: faqs.map(([q, a]) => ({
            '@type': 'Question',
            name: q,
            acceptedAnswer: { '@type': 'Answer', text: a },
        })),
    };
}

/**
 * HowTo structured data for the ขายการ์ด intent.
 *
 * The visible "how to start" steps were already written as a how-to and simply
 * were not marked up. Steps are imported from SellCardsContent rather than
 * retyped, so the structured data cannot drift from the rendered copy.
 */
function buildHowToJsonLd(isThai: boolean): Record<string, unknown> {
    const { title, steps } = isThai ? SELL_HOWTO.th : SELL_HOWTO.en;
    return {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        inLanguage: isThai ? 'th-TH' : 'en-TH',
        name: isThai ? 'วิธีขายการ์ดสะสมบน CardStreet' : 'How to sell trading cards on CardStreet',
        description: title,
        url: localizedUrl('/sell-cards', isThai ? 'th' : 'en'),
        step: steps.map((s, i) => ({
            '@type': 'HowToStep',
            position: i + 1,
            name: s.t,
            text: s.d,
        })),
    };
}

export default async function SellCardsPage() {
    const pathLocale = await requestPathLocale();
    const isThai = pathLocale === 'th';

    return (
        <>
            {[buildHowToJsonLd(isThai), buildFaqJsonLd(isThai)].map((block) => (
                <script
                    key={block['@type'] as string}
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
                />
            ))}
            {/* Links follow the URL prefix, never the cs_lang cookie. */}
            <SellCardsContent prefix={localePrefix(pathLocale)} />
        </>
    );
}
