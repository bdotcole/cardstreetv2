import type { Metadata } from 'next';
import { buildAlternates, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
import PricesContent from './PricesContent';

// Price-check landing page.
//
// "เช็คราคาการ์ดโปเกม่อน" is the site's best-ranking tracked query, and until
// now nothing on the domain answered it — the query landed on the marketplace
// homepage. The SERP for it is held by a Japanese proxy-shopping blog's Thai
// how-to article, i.e. by content rather than by a tool, which is what makes it
// winnable with a real page.
//
// The slug stays ASCII on purpose. A Thai-script path percent-encodes into
// unreadable sitemap entries and backlinks; the Thai keywords are carried by the
// title, h1 and body instead, which is where they count.
//
// Note the colloquial spelling โปเกม่อน (with ไม้เอก) alongside โปเกมอน: the
// ranking query uses the former and the rest of the site uses the latter, so
// this page deliberately carries both and serves the two variants at once.
export async function generateMetadata(): Promise<Metadata> {
    const pathLocale = await requestPathLocale();
    const isThai = pathLocale === 'th';
    return {
        metadataBase: new URL(BASE_URL),
        title: isThai
            ? 'เช็คราคาการ์ดโปเกม่อน ยูกิ วันพีช — ราคาตลาดล่าสุด | CardStreet'
            : 'Check Trading Card Prices in Thailand — Pokémon, Yu-Gi-Oh, One Piece | CardStreet',
        description: isThai
            ? 'เช็คราคาการ์ดโปเกม่อน ยูกิ วันพีช MTG และ Lorcana ฟรี ราคาตลาดกว่า 100,000 ใบ อัปเดตทุกวัน สแกนการ์ดด้วยกล้องเพื่อดูราคาได้ทันที ทั้งการ์ดภาษาไทย อังกฤษ และญี่ปุ่น'
            : 'Free market prices for over 100,000 trading cards — Pokémon, Yu-Gi-Oh!, One Piece, Magic, Lorcana and Riftbound. Updated daily, priced in Thai baht, with English, Thai and Japanese printings priced separately.',
        alternates: buildAlternates('/prices', pathLocale),
        openGraph: {
            title: isThai
                ? 'เช็คราคาการ์ดสะสม — ราคาตลาดล่าสุด ฟรี | CardStreet'
                : 'Check Trading Card Prices — Free, Updated Daily | CardStreet',
            description: isThai
                ? 'ราคาตลาดของการ์ดสะสมกว่า 100,000 ใบ จาก 1,200 กว่าชุด อัปเดตทุกวัน แสดงเป็นเงินบาท'
                : 'Market prices for over 100,000 cards across more than 1,200 sets, updated daily and shown in Thai baht.',
            type: 'website',
            siteName: 'CardStreet',
            url: localizedUrl('/prices', pathLocale),
        },
    };
}

/**
 * HowTo + FAQPage structured data for the page's two explainer halves.
 *
 * Both are answer-engine-quotable, which is the point: the domain currently has
 * zero AI-search visibility, and Thai "how do I check a card price" questions
 * are exactly the shape an assistant answers by quoting a HowTo.
 *
 * Kept in sync with the visible copy in PricesContent by hand — if the steps
 * change there, change them here, or the structured data misrepresents the page.
 */
function buildJsonLd(isThai: boolean): Record<string, unknown>[] {
    const url = localizedUrl('/prices', isThai ? 'th' : 'en');

    const steps = isThai
        ? [
              ['ค้นหาด้วยชื่อการ์ด', 'พิมพ์ชื่อการ์ดเป็นภาษาไทย อังกฤษ หรือญี่ปุ่นก็ได้ ระบบค้นหาครอบคลุมทุกเกมและทุกภาษาพร้อมกัน'],
              ['ค้นหาด้วยเลขการ์ด', 'ถ้ารู้เลขในชุด เช่น 087/198 พิมพ์ชื่อการ์ดตามด้วยเลขได้เลย จะเจอใบที่ต้องการเร็วกว่า'],
              ['สแกนด้วยกล้อง', 'เปิดกล้องแล้วส่องที่การ์ด ระบบจะระบุใบนั้นให้อัตโนมัติพร้อมแสดงราคา ใช้ได้กับการ์ดไทย อังกฤษ และญี่ปุ่น'],
              ['ดูราคาย้อนหลัง', 'หน้าการ์ดแต่ละใบมีกราฟราคา ดูได้ว่าราคาขึ้นหรือลงในช่วง 7, 30 และ 90 วันที่ผ่านมา'],
          ]
        : [
              ['Search by name', 'Type the card name in Thai, English or Japanese. Search covers every game and every language at once.'],
              ['Search by number', 'If you know the collector number, e.g. 087/198, type the card name followed by the number to jump straight to it.'],
              ['Scan with your camera', 'Point your camera at the card and CardStreet identifies it automatically and shows the price. Works on Thai, English and Japanese printings.'],
              ['See price history', 'Every card page has a price chart covering the last 7, 30 and 90 days.'],
          ];

    const faqs = isThai
        ? [
              [
                  'ราคาการ์ดบน CardStreet มาจากไหน',
                  'ราคาที่แสดงคือราคาตลาด — ค่ากลางจากการซื้อขายจริงในช่วงล่าสุด ไม่ใช่ราคาตั้งขายที่สูงเกินจริง สำหรับการ์ดภาษาอังกฤษและญี่ปุ่น ราคาอ้างอิงจากตลาดสากลแล้วแปลงเป็นเงินบาท ส่วนการ์ดไทยใช้ราคาที่สะท้อนตลาดในประเทศ',
              ],
              [
                  'เช็คราคาการ์ดโปเกม่อนภาษาไทยได้ไหม',
                  'ได้ การ์ดโปเกมอนภาษาไทยมีราคาแยกจากฉบับภาษาอังกฤษและญี่ปุ่น เพราะเป็นคนละตลาดกัน ชุด MA, SV และ AS ของไทยจึงมีราคาของตัวเองบน CardStreet ไม่ได้ใช้ราคาการ์ดอังกฤษมาทับ',
              ],
              [
                  'การ์ดที่ผ่านการเกรดมีราคาต่างจากการ์ดดิบหรือไม่',
                  'ต่างกัน การ์ดที่ผ่านการเกรด (PSA, BGS, CGC, TAG) มีราคาแยกต่างหากจากการ์ดดิบบน CardStreet เพราะการ์ดเกรดสูงมักมีมูลค่าสูงกว่าการ์ดดิบหลายเท่า',
              ],
              [
                  'เช็คราคาการ์ดบน CardStreet เสียเงินไหม',
                  'ไม่เสีย การค้นหา การสแกน และการดูราคาตลาดใช้งานได้ฟรี ไม่ต้องสมัครสมาชิก ผู้ขายจะเสียค่าธรรมเนียมเฉพาะตอนที่ขายการ์ดได้จริงเท่านั้น',
              ],
          ]
        : [
              [
                  'Where do CardStreet card prices come from?',
                  'The figure shown is the market price — a midpoint drawn from recent real sales, not an inflated asking price. English and Japanese cards reference international market data converted to baht; Thai cards use pricing that reflects the domestic market.',
              ],
              [
                  'Can I check prices for Thai-language Pokémon cards?',
                  'Yes. Thai-language Pokémon cards are priced separately from their English and Japanese counterparts on CardStreet, because they trade in different markets. Thailand’s MA, SV and AS sets carry their own prices rather than inheriting English ones.',
              ],
              [
                  'Are graded cards priced differently from raw cards?',
                  'Yes. Graded cards (PSA, BGS, CGC, TAG) are priced separately from raw copies on CardStreet, since a high-grade slab is often worth several times the raw card.',
              ],
              [
                  'Does it cost anything to check card prices on CardStreet?',
                  'No. Searching, scanning, and viewing market prices are free and need no account. Sellers pay a fee only when a card actually sells.',
              ],
          ];

    return [
        {
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            inLanguage: isThai ? 'th-TH' : 'en-TH',
            name: isThai ? 'วิธีเช็คราคาการ์ดสะสม' : 'How to check a trading card’s price',
            url,
            step: steps.map(([name, text], i) => ({
                '@type': 'HowToStep',
                position: i + 1,
                name,
                text,
            })),
        },
        {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            inLanguage: isThai ? 'th-TH' : 'en-TH',
            mainEntity: faqs.map(([q, a]) => ({
                '@type': 'Question',
                name: q,
                acceptedAnswer: { '@type': 'Answer', text: a },
            })),
        },
    ];
}

export default async function PricesPage() {
    const isThai = (await requestPathLocale()) === 'th';

    return (
        <>
            {buildJsonLd(isThai).map((block) => (
                <script
                    key={block['@type'] as string}
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
                />
            ))}
            <PricesContent />
        </>
    );
}
