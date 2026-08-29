import type { Metadata } from 'next';
import { buildAlternates, localePrefix, localizedUrl, requestPathLocale, BASE_URL } from '@/lib/i18nRouting';
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
//
// แอป and ดิสนีย์ are here for the same reason. "แอปเช็คราคาการ์ดโปเกม่อน" ranks
// at position 8 with zero clicks while the word แอป appeared nowhere on the page,
// and Thai searchers say การ์ดดิสนีย์ rather than Lorcana — the Latin name was
// present, the Thai one was not.
export async function generateMetadata(): Promise<Metadata> {
    const pathLocale = await requestPathLocale();
    const isThai = pathLocale === 'th';
    return {
        metadataBase: new URL(BASE_URL),
        title: isThai
            ? 'แอปเช็คราคาการ์ดโปเกม่อน ดิสนีย์ ยูกิ วันพีช — ราคาตลาดล่าสุด | CardStreet'
            : 'Check Trading Card Prices in Thailand — Pokémon, Yu-Gi-Oh, One Piece | CardStreet',
        description: isThai
            ? 'เช็คราคาการ์ดโปเกม่อน การ์ดดิสนีย์ ยูกิ วันพีช MTG และ Lorcana ฟรี ราคาตลาดกว่า 100,000 ใบ อัปเดตทุกวัน สแกนการ์ดด้วยกล้องเพื่อดูราคาได้ทันที ทั้งการ์ดภาษาไทย อังกฤษ และญี่ปุ่น'
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
              ['ดูให้แน่ว่าเป็นการ์ดใบไหน', 'ดูเลขการ์ดที่มุมล่างและภาษาบนการ์ดก่อน เพราะการ์ดชื่อเดียวกันมีได้หลายใบหลายชุดหลายภาษา'],
              ['ค้นหาด้วยชื่อการ์ด', 'พิมพ์ชื่อการ์ดเป็นภาษาไทย อังกฤษ หรือญี่ปุ่นก็ได้ ระบบค้นหาครอบคลุมทุกเกมและทุกภาษาพร้อมกัน'],
              ['ค้นหาด้วยเลขการ์ด', 'ถ้ารู้เลขในชุด เช่น 087/198 พิมพ์ชื่อการ์ดตามด้วยเลขได้เลย จะเจอใบที่ต้องการเร็วกว่า'],
              ['สแกนด้วยกล้อง', 'เปิดกล้องแล้วส่องที่การ์ด ระบบจะระบุใบนั้นให้อัตโนมัติพร้อมแสดงราคา ใช้ได้กับการ์ดไทย อังกฤษ และญี่ปุ่น'],
              ['เทียบให้ตรงเวอร์ชัน', 'ก่อนเชื่อราคาที่เห็น ให้เช็คว่าตรงทั้งภาษา ชุด และเวอร์ชันของการ์ดที่ถืออยู่จริง'],
              ['ดูราคาย้อนหลัง', 'หน้าการ์ดแต่ละใบมีกราฟราคา ดูได้ว่าราคาขึ้นหรือลงในช่วง 7, 30 และ 90 วันที่ผ่านมา'],
          ]
        : [
              ['Identify the exact card', 'Start with the collector number in the bottom corner and the language on the card — the same card name can exist in several sets and several languages.'],
              ['Search by name', 'Type the card name in Thai, English or Japanese. Search covers every game and every language at once.'],
              ['Search by number', 'If you know the collector number, e.g. 087/198, type the card name followed by the number to jump straight to it.'],
              ['Scan with your camera', 'Point your camera at the card and CardStreet identifies it automatically and shows the price. Works on Thai, English and Japanese printings.'],
              ['Match the version before you trust the price', 'Check that the language, set, and version all match the copy you are actually holding.'],
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
              [
                  'รู้ได้ยังไงว่าการ์ดที่ถืออยู่คือใบไหน',
                  'ดูเลขการ์ดที่มุมล่าง เช่น 087/198 พร้อมรหัสชุดที่อยู่ข้าง ๆ และภาษาบนตัวการ์ด สามอย่างนี้ระบุการ์ดได้แม่นยำที่สุด ถ้ายังไม่แน่ใจ ให้สแกนการ์ดด้วยกล้องในแอปแล้วระบบจะระบุใบและเวอร์ชันให้เอง',
              ],
              [
                  'ราคาที่เห็นคือราคาการ์ดสภาพไหน',
                  'ราคาตลาดอ้างอิงการ์ดสภาพดีเป็นหลัก ถ้าการ์ดของคุณมีขอบขาว มุมงอ หรือรอยบนผิว ราคาที่ขายได้จริงจะต่ำกว่าราคาตลาดตามสภาพ',
              ],
              [
                  'ทำไมราคาการ์ดใบเดียวกันในเว็บอื่นไม่เท่ากัน',
                  'ส่วนใหญ่เกิดจากการดูคนละภาษา คนละชุด หรือคนละเวอร์ชันของการ์ด และบางเว็บแสดงราคาที่ผู้ขายตั้งไว้ ไม่ใช่ราคาที่ซื้อขายกันจริง ก่อนเทียบราคาจึงควรเช็คให้ตรงทั้งสามอย่าง',
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
              [
                  'How do I tell exactly which card I have?',
                  'Use the collector number in the bottom corner (for example 087/198), the set code next to it, and the language printed on the card — those three identify it precisely. If you are still unsure, scan the card with the camera in the app and it will identify the card and its version for you.',
              ],
              [
                  'What condition do the prices assume?',
                  'Market prices reference cards in good condition. If yours has whitened edges, a bent corner, or surface marks, expect it to sell below the market price in proportion to the wear.',
              ],
              [
                  'Why does another site show a different price for the same card?',
                  'Usually because it is a different language, set, or version of the card — and some sites display seller asking prices rather than completed transactions. Check all three before comparing.',
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
    const pathLocale = await requestPathLocale();
    const isThai = pathLocale === 'th';

    return (
        <>
            {buildJsonLd(isThai).map((block) => (
                <script
                    key={block['@type'] as string}
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
                />
            ))}
            {/* Links follow the URL prefix, never the cs_lang cookie. */}
            <PricesContent prefix={localePrefix(pathLocale)} />
        </>
    );
}
