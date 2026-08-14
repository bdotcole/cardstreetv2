import type { Metadata } from 'next';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
import GradedContent from './GradedContent';
import { GRADED_HOWTO } from './howToSteps';

// Graded-cards landing page.
//
// Graded pricing is one of the deepest datasets on the site — roughly 228k of
// the 434k market_values rows carry a graded condition — and nothing targeted
// การ์ดเกรด / ราคาการ์ดเกรด / PSA 10 ราคา until now. The AI grader at /grade is
// the other draw and is invisible to search, being premium-gated with no
// crawlable copy.
//
// Scope discipline, verified against the live data on 2026-08-04. See the header
// of GradedContent.tsx for the full list; the short version is that this page
// sells pricing data and tools, NOT graded inventory (there are zero active
// graded listings), does not price TAG (no data exists), and does not offer or
// imply a grading submission service (CardStreet has none — ส่งเกรด is answered
// informationally).
export async function generateMetadata(): Promise<Metadata> {
    const pathLocale = await requestPathLocale();
    const isThai = pathLocale === 'th';
    return {
        metadataBase: new URL(BASE_URL),
        title: isThai
            ? 'ราคาการ์ดเกรด PSA BGS CGC — เช็คราคาการ์ดโปเกม่อนเกรด | CardStreet'
            : 'Graded Card Prices — PSA, BGS, CGC & SGC in Thailand | CardStreet',
        description: isThai
            ? 'เช็คราคาการ์ดเกรด PSA, BGS, CGC และ SGC กว่า 230,000 รายการ อัปเดตทุกวัน แสดงเป็นเงินบาท พร้อมเครื่องมือประเมินเกรดด้วย AI จากรูปถ่าย สำหรับนักสะสมการ์ดโปเกม่อนและการ์ดสะสมอื่นในไทย'
            : 'Check graded card prices for PSA, BGS, CGC and SGC — over 230,000 graded prices, updated daily and shown in Thai baht, plus an AI tool that estimates a card’s grade from a photo.',
        alternates: buildAlternates('/graded', pathLocale),
        openGraph: {
            title: isThai
                ? 'ราคาการ์ดเกรด PSA, BGS, CGC และ SGC | CardStreet'
                : 'Graded Card Prices — PSA, BGS, CGC and SGC | CardStreet',
            description: isThai
                ? 'ราคาการ์ดเกรดกว่า 230,000 รายการ อัปเดตทุกวัน แสดงเป็นเงินบาท พร้อมเครื่องมือประเมินเกรดด้วย AI'
                : 'Over 230,000 graded card prices, updated daily and shown in Thai baht, plus an AI grade estimator.',
            type: 'website',
            siteName: 'CardStreet',
            url: localizedUrl('/graded', pathLocale),
        },
    };
}

/**
 * FAQPage structured data, locale-matched.
 *
 * Locale-matching is not optional here: English-only structured data on a Thai
 * canonical URL has been found and fixed three times on this codebase (/faq in
 * cbb14f1, the six game landings in 721f8da). Answer engines quote this verbatim.
 *
 * Every answer below is a claim about how the product actually behaves — the
 * grade tiers, the 60% Thai derivation, the absence of a submission service.
 * Kept in sync with the visible copy in GradedContent by hand.
 */
function buildFaqJsonLd(isThai: boolean): Record<string, unknown> {
    const faqs = isThai
        ? [
              [
                  'ราคาการ์ดเกรดบน CardStreet มาจากไหน',
                  'มาจากสามแหล่งเรียงตามลำดับ: การซื้อขายจริงบน CardStreet มาก่อนเสมอ ถัดมาคือราคาตลาดสากลของการ์ดเกรดที่แปลงเป็นเงินบาท และสำหรับการ์ดโปเกมอนภาษาไทยที่ยังไม่มีข้อมูลสากล จะแสดงค่าประมาณที่ 60% ของราคาการ์ดภาษาอังกฤษใบเทียบเท่า ระดับเกรดที่ไม่มีข้อมูลจากทั้งสามแหล่งจะถูกเว้นว่างไว้ ไม่เดาราคา',
              ],
              [
                  'CardStreet มีราคาการ์ดเกรดระดับไหนบ้าง',
                  'ปัจจุบันครอบคลุม PSA 10, PSA 9, BGS 10, BGS 9.5, CGC 10 และ SGC 10 ซึ่งเป็นระดับที่มีการซื้อขายมากที่สุด ระดับอื่นยังไม่มีข้อมูลราคาที่เชื่อถือได้ ส่วนการ์ด TAG นั้นแสดงผลบน CardStreet ได้ แต่ยังไม่มีข้อมูลราคาตลาด',
              ],
              [
                  'CardStreet รับส่งเกรดการ์ดให้ไหม',
                  'ไม่ CardStreet เป็นตลาดซื้อขายและแหล่งข้อมูลราคา ไม่ได้ให้บริการส่งเกรด การส่งเกรดต้องติดต่อ PSA, BGS, CGC หรือ TAG หรือตัวแทนรับส่งเกรดในไทยโดยตรง',
              ],
              [
                  'เครื่องมือประเมินเกรดด้วย AI ของ CardStreet แม่นแค่ไหน',
                  'เป็นการประเมินเบื้องต้นจากรูปถ่ายเท่านั้น ดูจากมุม ขอบ ผิวการ์ด และการเข้าศูนย์ของภาพพิมพ์ ไม่ใช่เกรดอย่างเป็นทางการ และไม่มีผลผูกพันกับผลการตัดสินของบริษัทเกรด ใช้เพื่อช่วยคัดว่าการ์ดใบไหนน่าส่งเกรดก่อน เป็นฟีเจอร์สำหรับสมาชิก CardStreet Pro',
              ],
              [
                  'การ์ดเกรดราคาต่างจากการ์ดดิบมากไหม',
                  'ต่างกันมาก บางใบต่างกันหลายเท่า CardStreet จึงเก็บราคาการ์ดเกรดแยกจากราคาการ์ดดิบ และแสดงราคาของแต่ละระดับเกรดแยกกันบนหน้าการ์ดทุกใบ',
              ],
          ]
        : [
              [
                  'Where do CardStreet graded card prices come from?',
                  'Three sources in order of authority: a real sale of that card in that grade on CardStreet always wins; next is international graded market data converted to Thai baht; and for Thai-language Pokémon cards, which have no international graded pricing, we show an estimate at 60% of the English-equivalent graded price. A grade tier with none of the three is left blank rather than guessed.',
              ],
              [
                  'Which grades does CardStreet have prices for?',
                  'Coverage is currently PSA 10, PSA 9, BGS 10, BGS 9.5, CGC 10 and SGC 10 — the tiers that actually trade. Lower tiers have no reliable pricing yet. TAG slabs display correctly on CardStreet, but there is no market price data for TAG grades.',
              ],
              [
                  'Does CardStreet submit cards for grading?',
                  'No. CardStreet is a marketplace and a pricing source, not a grading submission service. Submitting is done directly with PSA, BGS, CGC or TAG, or through a Thai submission agent.',
              ],
              [
                  'How accurate is CardStreet’s AI grade estimate?',
                  'It is an estimate from a photo — corners, edges, surface and centering — not an official grade, and it carries no weight with the grading companies. Use it to decide which cards are worth submitting first. It is a CardStreet Pro feature.',
              ],
              [
                  'How much more is a graded card worth than a raw one?',
                  'Often several times more, which is why CardStreet tracks graded prices separately from raw ones and shows each grade tier its own price on every card page.',
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
 * HowTo structured data for the ส่งเกรด / graded-price intent.
 *
 * Scoped to CHECKING a graded price, never to submitting one — CardStreet has
 * no grading submission service, and a HowTo named "how to submit" would imply
 * one to an answer engine quoting it.
 *
 * Steps are imported from GradedContent, not retyped, so the structured data
 * cannot drift from the visible copy.
 */
function buildHowToJsonLd(isThai: boolean): Record<string, unknown> {
    const { title, steps } = isThai ? GRADED_HOWTO.th : GRADED_HOWTO.en;
    return {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        inLanguage: isThai ? 'th-TH' : 'en-TH',
        name: title,
        url: localizedUrl('/graded', isThai ? 'th' : 'en'),
        step: steps.map((s, i) => ({
            '@type': 'HowToStep',
            position: i + 1,
            name: s.t,
            text: s.d,
        })),
    };
}

export default async function GradedPage() {
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
            <GradedContent prefix={localePrefix(pathLocale)} />
        </>
    );
}
