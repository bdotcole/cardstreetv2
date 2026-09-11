import type { GameId } from '@/lib/games';

// Long-form guides — the site's first article surface.
//
// WHY THIS EXISTS: inkable.shop runs eighteen Thai-language Lorcana articles against our single
// landing page, and outranks us on "ราคาการ์ด lorcana" (2026-08-30). /lorcana is the #1 page on
// this domain, so that is a direct contest for our best surface.
//
// WHAT THESE ARE NOT: a clone of their eighteen. Six of theirs are pure gameplay (how to play,
// ink colours, keywords, deck building, meta, starter decks) where we have nothing to add. These
// six were chosen only where CardStreet holds something a Lorcana-only shop structurally cannot:
// live prices across the catalog, a real marketplace with verified sellers, grading, and every
// game's catalog rather than one.
//
// THE HOUSE RULE, and it is the competitive argument: **name cards, never hardcode prices.**
// A static "most valuable cards" list is wrong within a month. Ours names the cards — which do not
// change — and sends the reader to a page carrying today's price. Same rule as lib/setLanding.ts,
// for the same reason, but here it is also the thing that beats them.
//
// Plain strings only: bodies serialize into schema.org Article markup.

export interface Guide {
    slug: string;
    /** Drives the breadcrumb back-link and the related-guides block. */
    game: GameId;
    title: { th: string; en: string };
    description: { th: string; en: string };
    h1: { th: string; en: string };
    /** ISO date. Feeds Article.dateModified and the sitemap's lastmod. */
    updated: string;
    /** One string per paragraph. A short paragraph acts as a sub-heading. */
    body: { th: string[]; en: string[] };
    /**
     * Optional Q&A distilled from the body — never new claims. Rendered as a
     * visible FAQ section AND emitted as FAQPage JSON-LD, so the schema always
     * mirrors on-page content (same rule as the game landings).
     */
    faqs?: { q: { th: string; en: string }; a: { th: string; en: string } }[];
    /**
     * Optional links to the EXACT printings the guide names. The guides tell
     * readers to match the specific version — this block applies that advice to
     * ourselves, and turns every named card into a crawlable path.
     */
    cards?: { label: string; id: string }[];
}

export const GUIDES: Guide[] = [
    {
        slug: 'lorcana-most-valuable-cards',
        game: 'lorcana',
        updated: '2026-08-30',
        cards: [
            { label: "Buzz Lightyear - Jungle Ranger (Iconic)", id: 'lorcana-2956' },
            { label: "Mickey Mouse - Brave Little Prince (Iconic)", id: 'lorcana-2178' },
            { label: "Minnie Mouse - Sweetheart Princess (Iconic)", id: 'lorcana-2177' },
            { label: "Belle & Beast - Certain as the Sun (Iconic)", id: 'lorcana-3216' },
            { label: "Merida - Formidable Archer (Iconic)", id: 'lorcana-2957' },
            { label: "Lilo & Stitch - Fun-Loving Friends (Iconic)", id: 'lorcana-3215' },
            { label: "Ariel - Ethereal Voice (Iconic)", id: 'lorcana-2430' },
            { label: "Winnie the Pooh - Hunny Wizard (Enchanted)", id: 'lorcana-2145' },
        ],
        title: {
            th: 'การ์ด Lorcana แพงที่สุด มีใบไหนบ้าง และเช็คราคายังไงให้ทันตลาด | CardStreet',
            en: 'The Most Valuable Disney Lorcana Cards, and How to Check Prices That Stay Current | CardStreet',
        },
        description: {
            th: 'รวมการ์ด Disney Lorcana ที่ราคาสูงที่สุด ทั้งระดับ Iconic และ Enchanted พร้อมวิธีเช็คราคาตลาดล่าสุดเป็นเงินบาทแบบไม่ต้องเชื่อตัวเลขในบทความเก่า',
            en: 'The Disney Lorcana cards that sit at the top of the market, across the Iconic and Enchanted tiers, plus how to check a live market price in Thai baht instead of trusting a figure typed into an old article.',
        },
        h1: {
            th: 'การ์ด Lorcana แพงที่สุด และวิธีเช็คราคาให้ทันตลาด',
            en: 'The Most Valuable Disney Lorcana Cards',
        },
        body: {
            th: [
                'ถ้าถามว่าการ์ด Lorcana ใบไหนแพงที่สุด คำตอบเปลี่ยนได้ทุกเดือน และนี่คือเหตุผลที่บทความรวมราคาส่วนใหญ่ใช้ไม่ได้จริง เพราะตัวเลขที่เขียนไว้วันนี้ อีกสองเดือนก็ไม่ตรงแล้ว',
                'สิ่งที่ไม่เปลี่ยนคือใบไหนอยู่ระดับบนของตลาด การ์ดที่ราคาสูงสุดของ Lorcana เกือบทั้งหมดอยู่ในระดับ Iconic ซึ่งเป็นระดับที่หายากที่สุดของเกม ทั้งแคตตาล็อกมีเพียงสิบใบเท่านั้น',
                'ใบที่นักสะสมไทยตามหามากที่สุดได้แก่ Buzz Lightyear - Jungle Ranger, Mickey Mouse - Brave Little Prince, Minnie Mouse - Sweetheart Princess, Belle & Beast - Certain as the Sun, Merida - Formidable Archer, Lilo & Stitch - Fun-Loving Friends และ Ariel - Ethereal Voice',
                'ถัดลงมาคือระดับ Enchanted ที่มีอยู่ราวสองร้อยกว่าใบทั้งเกม ใบเด่นอย่าง Winnie the Pooh - Hunny Wizard ก็ยืนราคาสูงมาตลอด',
                'แล้วราคาจริงวันนี้เท่าไหร่ เปิดหน้าการ์ดใบนั้นบน CardStreet ได้เลย ทุกใบมีราคาตลาดเป็นเงินบาท พร้อมวันที่อัปเดตล่าสุดและกราฟราคาย้อนหลัง ไม่ต้องเชื่อตัวเลขในบทความที่เขียนไว้เมื่อไหร่ก็ไม่รู้ แคตตาล็อก Lorcana ของเรามีกว่าสามพันใบ และมีราคาให้เช็คได้ถึง 99% ของทั้งหมด',
                'เคล็ดลับสำหรับคนที่เพิ่งเปิดกล่อง ให้ดูที่ระดับความหายากมุมล่างของการ์ดก่อน ถ้าไม่ใช่ Iconic, Enchanted, Legendary หรือ Epic โอกาสที่จะเป็นใบราคาหลักพันขึ้นไปมีน้อย แต่ก็ควรเช็คทีละใบอยู่ดี เพราะการ์ดที่ใช้ในเด็คยอดนิยมบางใบก็มีราคาเกินระดับความหายากของมัน',
            ],
            en: [
                'Ask which Lorcana card is worth the most and the answer changes month to month, which is exactly why most "most valuable cards" articles are unreliable. The number written today is wrong by the time you read it.',
                'What does not change is which cards sit at the top of the market. Almost all of Lorcana’s highest-value cards are Iconic, the game’s scarcest tier, and there are only ten in the entire catalog.',
                'The ones Thai collectors chase hardest: Buzz Lightyear - Jungle Ranger, Mickey Mouse - Brave Little Prince, Minnie Mouse - Sweetheart Princess, Belle & Beast - Certain as the Sun, Merida - Formidable Archer, Lilo & Stitch - Fun-Loving Friends, and Ariel - Ethereal Voice.',
                'Below them sit the Enchanted cards, a couple of hundred across the game, where standouts like Winnie the Pooh - Hunny Wizard have held strong prices throughout.',
                'So what is it worth today? Open that card’s page on CardStreet. Every card carries a market price in Thai baht, the date it was last updated, and a price history chart, so there is no need to trust a figure typed into an article at some unknown point in the past. Our Lorcana catalog runs to over three thousand cards with prices on 99% of them.',
                'If you have just opened a box, check the rarity mark first. If it is not Iconic, Enchanted, Legendary or Epic, the odds of a high-value card are slim, though it is still worth checking each one, because cards that see heavy competitive play sometimes outrun their rarity.',
            ],
        },
    },
    {
        slug: 'buy-lorcana-thailand',
        game: 'lorcana',
        updated: '2026-08-30',
        faqs: [
            { q: { th: "ซื้อการ์ด Lorcana ในไทยที่ไหนถูกที่สุด", en: "Where are Lorcana cards cheapest in Thailand?" },
              a: { th: "กลุ่มซื้อขายบนโซเชียลมักได้ราคาดีที่สุดเพราะซื้อตรงจากนักสะสม แต่ไม่มีตัวกลางคุ้มครอง ถ้าต้องการราคาที่เทียบกับราคากลางได้และมีระบบคุ้มครองผู้ซื้อ ให้ใช้มาร์เก็ตเพลสเฉพาะการ์ดอย่าง CardStreet ซึ่งแสดงราคาตลาดควบคู่กับราคาที่ผู้ขายตั้งไว้", en: "Social buy-sell groups are usually cheapest, since you buy straight from collectors, but there is no intermediary protecting you. For a price you can compare against the market rate with buyer protection, use a card-specific marketplace like CardStreet, which shows the market price next to each asking price." } },
            { q: { th: "การ์ด Lorcana มีฉบับภาษาไทยไหม", en: "Is there a Thai-language Lorcana release?" },
              a: { th: "ยังไม่มี ของที่หาซื้อได้ในไทยทั้งหมดเป็นฉบับภาษาอังกฤษที่นำเข้ามา ร้านที่สต็อกครบจึงมีไม่มาก และราคาขยับตามค่าเงินกับรอบการนำเข้า", en: "No. Everything sold in Thailand is the imported English edition, so few shops carry a full range and prices move with exchange rates and import cycles." } },
        ],
        title: {
            th: 'ซื้อการ์ด Disney Lorcana ที่ไหนดีในไทย เทียบทุกช่องทาง | CardStreet',
            en: 'Where to Buy Disney Lorcana Cards in Thailand, Every Option Compared | CardStreet',
        },
        description: {
            th: 'เทียบช่องทางซื้อการ์ด Disney Lorcana ในไทย ทั้งร้านหน้าร้าน กลุ่มโซเชียล มาร์เก็ตเพลสทั่วไป และมาร์เก็ตเพลสเฉพาะการ์ด ข้อดีข้อเสียและความเสี่ยงของแต่ละทาง',
            en: 'Card shops, social buy-sell groups, general marketplaces and card-specific marketplaces compared for buying Disney Lorcana in Thailand, with the trade-offs and risks of each.',
        },
        h1: {
            th: 'ซื้อการ์ด Disney Lorcana ที่ไหนดีในไทย',
            en: 'Where to Buy Disney Lorcana Cards in Thailand',
        },
        body: {
            th: [
                'Lorcana ยังไม่มีฉบับภาษาไทย ของที่หาซื้อได้ในประเทศจึงเป็นฉบับภาษาอังกฤษที่นำเข้ามา ทำให้ช่องทางซื้อมีไม่เยอะและราคาต่างกันพอสมควร แต่ละทางมีข้อดีข้อเสียชัดเจน',
                'ร้านการ์ดหน้าร้าน ได้เห็นของจริงก่อนจ่าย เหมาะกับคนที่อยากได้ทันทีและไม่อยากเสี่ยง แต่ร้านที่สต็อก Lorcana ครบมีไม่มาก และมักไม่มีใบเดี่ยวหายากให้เลือก',
                'กลุ่มซื้อขายบนโซเชียล ราคามักดีที่สุดเพราะซื้อตรงจากนักสะสม แต่ไม่มีตัวกลาง ถ้าโอนแล้วไม่ได้ของหรือได้ของไม่ตรงสภาพที่ตกลง ก็ต้องตามเอง และหลายครั้งไม่มีราคากลางให้อ้างอิงว่าที่เสนอมาถูกหรือแพง',
                'มาร์เก็ตเพลสทั่วไป มีของเยอะ แต่คนขายส่วนใหญ่ไม่ได้เชี่ยวชาญการ์ด รายละเอียดสภาพการ์ดมักไม่ครบ และแทบไม่มีราคาตลาดให้เทียบ',
                'CardStreet ออกแบบมาสำหรับกรณีนี้โดยเฉพาะ ทุกหน้าการ์ดแสดงราคาตลาดควบคู่กับราคาที่ผู้ขายตั้งไว้ จึงรู้ทันทีว่าที่เห็นอยู่คุ้มหรือไม่ ผู้ขายทุกคนยืนยันตัวตนแล้ว มีระบบคุ้มครองผู้ซื้อทุกออเดอร์ จ่ายผ่านบัตรหรือพร้อมเพย์ และจัดส่งทั่วประเทศ ถ้ายังไม่มีใบที่ต้องการวางขาย กดติดตามไว้ได้ ระบบจะแจ้งเตือนทันทีที่มีคนลงขาย',
                'สรุปสั้น ๆ อยากได้เร็วที่สุดไปหน้าร้าน อยากได้ถูกที่สุดและรับความเสี่ยงได้ไปกลุ่มโซเชียล อยากได้ราคาที่เทียบได้จริงพร้อมความคุ้มครอง ใช้มาร์เก็ตเพลสที่ทำเรื่องการ์ดโดยเฉพาะ',
            ],
            en: [
                'Lorcana has no Thai-language release, so everything circulating here is the imported English edition. That keeps the number of buying channels small and the price spread wide. Each route has a clear trade-off.',
                'Physical card shops let you see the card before paying, which is good if you want it today and want no risk. But few shops carry deep Lorcana stock, and rare singles are usually not on the shelf.',
                'Social buy-sell groups often have the best prices, because you are buying straight from collectors. There is no intermediary though: if the money goes and the card does not arrive, or arrives in worse condition than agreed, that is yours to chase. There is also rarely a reference price to tell you whether the asking price is fair.',
                'General marketplaces have volume, but most sellers are not card specialists, condition detail is thin, and there is almost never a market price to compare against.',
                'CardStreet is built for exactly this gap. Every card page shows the market price next to the seller’s asking price, so you know immediately whether a deal is good. Sellers are identity-verified, every order carries buyer protection, payment works by card or PromptPay, and shipping is nationwide. If nobody has listed the card you want, add it to your wishlist and you will be alerted the moment someone does.',
                'Short version: fastest is a shop, cheapest is a social group if you accept the risk, and best price-with-protection is a marketplace built for cards.',
            ],
        },
    },
    {
        slug: 'lorcana-rarity-guide',
        game: 'lorcana',
        updated: '2026-08-30',
        title: {
            th: 'ระดับความหายากการ์ด Lorcana ทั้ง 9 ระดับ ใบไหนมีค่าจริง | CardStreet',
            en: 'All 9 Disney Lorcana Rarity Tiers, and Which Ones Hold Value | CardStreet',
        },
        description: {
            th: 'อธิบายระดับความหายากของการ์ด Disney Lorcana ครบทั้งเก้าระดับ ตั้งแต่ Common ถึง Iconic พร้อมกับดักที่นักสะสมมือใหม่มักพลาด เพราะการ์ดชื่อเดียวกันมีได้หลายระดับ',
            en: 'Every Disney Lorcana rarity tier explained from Common to Iconic, plus the trap new collectors fall into: the same card name exists at several tiers and the gap between them is enormous.',
        },
        h1: {
            th: 'ระดับความหายากของการ์ด Lorcana ทั้ง 9 ระดับ',
            en: 'Disney Lorcana Rarity Tiers Explained',
        },
        body: {
            th: [
                'Lorcana มีระดับความหายากทั้งหมดเก้าระดับ และนี่คือสิ่งแรกที่ควรดูเวลาเปิดซองว่าได้ของดีหรือเปล่า เรียงจากพบบ่อยที่สุดไปหายากที่สุด ได้แก่ Common, Uncommon, Rare, Super Rare, Special, Enchanted, Legendary, Epic และ Iconic',
                'สามระดับแรกคือส่วนใหญ่ของทุกซอง Common, Uncommon และ Rare รวมกันเป็นเกือบสามในสี่ของแคตตาล็อกทั้งหมด ใบเหล่านี้มักมีมูลค่าไม่มาก ยกเว้นใบที่ถูกใช้ในเด็คยอดนิยมจนความต้องการดันราคาขึ้น',
                'Enchanted คือระดับที่คนส่วนใหญ่รู้จักในฐานะการ์ดหายาก เป็นเวอร์ชันภาพเต็มใบของการ์ดที่มีอยู่แล้ว ทั้งเกมมีอยู่สองร้อยกว่าใบ ส่วน Legendary และ Epic เป็นระดับบนที่พบน้อยกว่านั้นมาก',
                'Iconic คือระดับที่หายากที่สุด ทั้งแคตตาล็อกมีเพียงสิบใบ และเกือบทุกใบในกลุ่มการ์ด Lorcana ที่แพงที่สุดก็มาจากระดับนี้',
                'จุดที่นักสะสมมือใหม่มักพลาดคือ การ์ดชื่อเดียวกันมีได้หลายระดับ และราคาต่างกันมหาศาล ตัวอย่างจริงจากแคตตาล็อกของเรา Winnie the Pooh - Hunny Wizard มีทั้งเวอร์ชัน Enchanted และเวอร์ชัน Common เป็นการ์ดตัวละครเดียวกัน แต่คนละใบในสายตาตลาดโดยสิ้นเชิง Buzz Lightyear - Jungle Ranger ก็มีทั้งเวอร์ชัน Iconic และ Legendary เช่นกัน',
                'เพราะฉะนั้นก่อนจะดีใจหรือเสียใจ ให้ดูเลขการ์ดที่มุมล่างควบคู่กับระดับความหายากเสมอ แล้วเปิดหน้าการ์ดให้ตรงเวอร์ชัน ราคาที่เห็นถึงจะเป็นราคาของใบที่ถืออยู่จริง',
            ],
            en: [
                'Lorcana has nine rarity tiers, and it is the first thing to check when you open a pack. From most common to scarcest: Common, Uncommon, Rare, Super Rare, Special, Enchanted, Legendary, Epic and Iconic.',
                'The first three make up the bulk of any pack. Common, Uncommon and Rare together account for close to three quarters of the whole catalog. These are usually modest in value, with the exception of cards that see heavy competitive play and get pushed up by demand.',
                'Enchanted is the tier most people know as the rare one, being full-art versions of existing cards, a couple of hundred across the game. Legendary and Epic sit above that and are considerably scarcer.',
                'Iconic is the scarcest tier of all: ten cards in the entire catalog, and almost every card in Lorcana’s top price bracket comes from it.',
                'The mistake new collectors make is assuming a name means a card. The same card name exists at several tiers, and the gap between them is enormous. A real example from our catalog: Winnie the Pooh - Hunny Wizard exists as both an Enchanted card and a Common one. Same character, same name, completely different cards as far as the market is concerned. Buzz Lightyear - Jungle Ranger likewise exists as both Iconic and Legendary.',
                'So before celebrating or despairing, read the collector number in the bottom corner alongside the rarity mark, then open the card page for that exact version. Only then is the price you are looking at the price of the card in your hand.',
            ],
        },
    },
    {
        slug: 'spot-fake-lorcana-cards',
        game: 'lorcana',
        updated: '2026-08-30',
        title: {
            th: 'การ์ด Lorcana ปลอม ดูยังไง วิธีเช็คก่อนโอนเงิน | CardStreet',
            en: 'How to Spot Fake Disney Lorcana Cards Before You Pay | CardStreet',
        },
        description: {
            th: 'วิธีตรวจการ์ด Disney Lorcana ปลอมด้วยตัวเอง ทั้งเนื้อการ์ด งานพิมพ์ สี ขอบ และสัญญาณเตือนที่จับได้บ่อยที่สุดคือราคาที่ดีเกินจริง',
            en: 'Check a Disney Lorcana card yourself: stock and reflectivity, print sharpness, colour, edges, and the tell that catches most counterfeits, a price that is too good.',
        },
        h1: {
            th: 'การ์ด Lorcana ปลอม ดูยังไง',
            en: 'How to Spot Fake Disney Lorcana Cards',
        },
        body: {
            th: [
                'ยิ่งการ์ดราคาสูงขึ้น ของปลอมก็ยิ่งตามมา และ Lorcana ที่เข้าไทยเป็นของนำเข้าทั้งหมด ทำให้ผู้ซื้อเสียเปรียบเรื่องข้อมูลตั้งแต่ต้น สิ่งที่ตรวจได้ด้วยตัวเองมีดังนี้',
                'เนื้อการ์ดและการสะท้อนแสง การ์ดแท้มีชั้นเคลือบที่สะท้อนแสงสม่ำเสมอทั้งใบ ของปลอมมักจะเงาเกินไปหรือด้านเป็นหย่อม เอียงการ์ดดูใต้แสงจะเห็นชัดที่สุด',
                'ความคมของงานพิมพ์ ซูมดูตัวหนังสือเล็ก ๆ ตรงขอบล่าง ของแท้คมกริบ ของปลอมมักเบลอหรือขอบตัวอักษรฟุ้ง',
                'สีและโทน เทียบกับภาพการ์ดใบเดียวกันจากแคตตาล็อกที่เชื่อถือได้ ของปลอมมักเพี้ยนไปทางเข้มหรือซีดกว่า',
                'ขอบและความหนา การ์ดแท้ตัดขอบเรียบ ความหนาเท่ากันทั้งใบ ถ้ามองด้านข้างแล้วเห็นชั้นไม่เท่ากันให้ระวัง',
                'ราคาที่ดีเกินจริง ข้อนี้จับได้บ่อยที่สุด ถ้าใบที่ราคาตลาดอยู่หลักหมื่นถูกเสนอมาในราคาหลักพัน นั่นคือสัญญาณเตือน ไม่ใช่โชคดี',
                'ข้อสุดท้ายคือเหตุผลที่การรู้ราคากลางสำคัญกว่าที่คิด บน CardStreet ทุกหน้าการ์ดแสดงราคาตลาดล่าสุด จึงเทียบได้ทันทีว่าข้อเสนอที่เห็นสมเหตุสมผลไหม และถ้าซื้อผ่านระบบ ผู้ขายทุกคนยืนยันตัวตนแล้ว มีระบบคุ้มครองผู้ซื้อ ถ้าของไม่ตรงตามที่ระบุไว้ก็มีขั้นตอนรองรับ ไม่ต้องไปตามเอง',
            ],
            en: [
                'As prices rise, counterfeits follow, and since every Lorcana card in Thailand is imported, buyers start at an information disadvantage. Here is what you can check yourself.',
                'Card stock and reflectivity. A genuine card has an even coating that catches light uniformly across the whole face. Fakes are often too glossy, or dull in patches. Tilting the card under a light makes this easiest to see.',
                'Print sharpness. Zoom in on the small text along the bottom edge. Genuine printing is crisp; counterfeits usually show blur or fuzzy letter edges.',
                'Colour and tone. Compare against the same card’s image in a catalog you trust. Fakes commonly run darker or washed out.',
                'Edges and thickness. Real cards are cut cleanly and are uniformly thick. If the layers look uneven from the side, be careful.',
                'A price that is too good. This is the one that catches most fakes. If a card with a market price in the tens of thousands is offered for a few thousand, that is a warning, not luck.',
                'That last point is why knowing the going rate matters more than people expect. Every card page on CardStreet shows the current market price, so you can sanity-check an offer immediately. And buying through the platform means the seller is identity-verified and the order carries buyer protection, so if the card is not as described there is a process, rather than you chasing it alone.',
            ],
        },
    },
    {
        slug: 'lorcana-enchanted-vs-regular',
        game: 'lorcana',
        updated: '2026-08-30',
        cards: [
            { label: "Winnie the Pooh - Hunny Wizard (Enchanted #227)", id: 'lorcana-2145' },
            { label: "Winnie the Pooh - Hunny Wizard (Common #41)", id: 'lorcana-1977' },
            { label: "Buzz Lightyear - Jungle Ranger (Iconic #241)", id: 'lorcana-2956' },
            { label: "Buzz Lightyear - Jungle Ranger (Legendary #91)", id: 'lorcana-2806' },
            { label: "Belle & Beast - Certain as the Sun (Iconic #245)", id: 'lorcana-3216' },
            { label: "Belle & Beast - Certain as the Sun (Super Rare #132)", id: 'lorcana-3103' },
        ],
        title: {
            th: 'การ์ด Lorcana Enchanted กับใบธรรมดา ราคาต่างกันกี่เท่า | CardStreet',
            en: 'Enchanted vs Regular Lorcana Cards, How Big Is the Price Gap | CardStreet',
        },
        description: {
            th: 'การ์ด Lorcana ชื่อเดียวกันถูกพิมพ์หลายเวอร์ชัน และราคาต่างกันเป็นหลักพันเท่า ดูตัวอย่างจริงจากแคตตาล็อก และวิธีเลือกเวอร์ชันให้ตรงกับใบที่ถืออยู่',
            en: 'The same Lorcana card name is printed in several versions and the prices differ by a factor in the thousands. Real examples from the catalog, and how to match the version you actually hold.',
        },
        h1: {
            th: 'Enchanted กับใบธรรมดา ราคาต่างกันแค่ไหน',
            en: 'Enchanted vs Regular Lorcana Cards',
        },
        body: {
            th: [
                'คำถามที่เจอบ่อยที่สุดจากคนที่เพิ่งเริ่มสะสม Lorcana คือ ถ้าได้ใบเดียวกันแบบ Enchanted มันต่างจากใบธรรมดาแค่ไหน คำตอบสั้น ๆ คือ ต่างกันมากจนเทียบกันแทบไม่ได้ และนี่คือตัวอย่างจากแคตตาล็อกจริง ไม่ใช่ความรู้สึก',
                'การ์ดตัวละครเดียวกันใน Lorcana ถูกพิมพ์ออกมาหลายเวอร์ชัน แต่ละเวอร์ชันมีเลขการ์ดของตัวเองและตลาดมองว่าเป็นคนละใบ',
                'Winnie the Pooh - Hunny Wizard มีทั้งเวอร์ชัน Enchanted และเวอร์ชัน Common ช่องว่างราคาระหว่างสองใบนี้กว้างที่สุดเท่าที่มีในเกม',
                'Buzz Lightyear - Jungle Ranger มีทั้งเวอร์ชัน Iconic และเวอร์ชัน Legendary ส่วน Belle & Beast - Certain as the Sun มีทั้งเวอร์ชัน Iconic และเวอร์ชัน Super Rare',
                'ทั้งสามคู่นี้คือการ์ดชื่อเดียวกันทั้งหมด แต่ราคาต่างกันเป็นหลักพันเท่า',
                'สิ่งที่ต้องระวังคือเวลาเห็นคนโพสต์ขายการ์ดชื่อหนึ่งในกลุ่ม แล้วราคาดูสูงหรือต่ำผิดปกติ ให้ถามเลขการ์ดก่อนเสมอ เพราะราคาที่คุยกันอยู่อาจเป็นคนละใบกันโดยสิ้นเชิง',
                'วิธีเช็คให้ชัวร์คือเปิดหน้าการ์ดบน CardStreet แล้วเลือกเวอร์ชันให้ตรงกับเลขการ์ดที่อยู่มุมล่าง ราคาตลาดที่เห็นจะเป็นของเวอร์ชันนั้นโดยเฉพาะ ไม่ใช่ราคาเฉลี่ยรวมของทุกเวอร์ชัน',
            ],
            en: [
                'The most common question from people starting a Lorcana collection: if I pull the Enchanted version of a card, how different is it from the regular one? The short answer is that they are barely comparable, and here are examples from a real catalog rather than a general impression.',
                'The same character card in Lorcana is printed in several versions. Each has its own collector number, and the market treats them as different cards entirely.',
                'Winnie the Pooh - Hunny Wizard exists as both an Enchanted card and a Common one. The gap between those two is the widest in the game.',
                'Buzz Lightyear - Jungle Ranger exists as both Iconic and Legendary, and Belle & Beast - Certain as the Sun exists as both Iconic and Super Rare.',
                'In all three cases the card name is identical and the prices differ by a factor in the thousands.',
                'The practical risk: when someone posts a card for sale in a group and the price looks unusually high or low, ask for the collector number first. You may be discussing two entirely different cards.',
                'To be certain, open the card page on CardStreet and pick the version matching the number in the bottom corner. The market price shown is for that specific version, not a blended average across all of them.',
            ],
        },
    },
    {
        slug: 'lorcana-vs-pokemon-magic',
        game: 'lorcana',
        updated: '2026-08-30',
        faqs: [
            { q: { th: "มือใหม่ควรเริ่มเกมการ์ดไหนดี", en: "Which card game should a beginner start with?" },
              a: { th: "เลือกจากตัวละครที่ชอบก่อน Lorcana ได้เปรียบเรื่องตัวละครดิสนีย์ที่คนไทยรู้จักอยู่แล้ว การ์ดโปเกม่อนได้เปรียบเรื่องสภาพคล่องและมีฉบับภาษาไทย ส่วนเมจิกได้เปรียบเรื่องความลึกของเกมสำหรับคนที่อยากเล่นจริงจัง", en: "Pick by the characters you already like. Lorcana wins on familiar Disney characters, Pokemon wins on liquidity and a Thai-language edition, and Magic wins on game depth for people who want to play seriously." } },
            { q: { th: "เกมการ์ดไหนขายต่อง่ายที่สุดในไทย", en: "Which card game is easiest to resell in Thailand?" },
              a: { th: "การ์ดโปเกม่อน มีทั้งฉบับภาษาไทย อังกฤษ และญี่ปุ่น คนซื้อคนขายเยอะที่สุด และมีชุดภาษาไทยที่หาซื้อได้ในประเทศโดยตรง", en: "Pokemon, by a wide margin. It exists in Thai, English and Japanese, has the most buyers and sellers, and has Thai-language sets sold domestically." } },
        ],
        title: {
            th: 'Disney Lorcana เทียบกับการ์ดโปเกม่อนและ Magic เริ่มเกมไหนดี | CardStreet',
            en: 'Disney Lorcana vs Pokemon and Magic, Which Should You Start Collecting | CardStreet',
        },
        description: {
            th: 'เทียบ Disney Lorcana กับการ์ดโปเกม่อนและ Magic: The Gathering ทั้งเรื่องตัวละคร สภาพคล่องในตลาดไทย ความลึกของเกม และข้อควรรู้เฉพาะของ Lorcana ที่ยังไม่มีฉบับภาษาไทย',
            en: 'Disney Lorcana compared with Pokemon and Magic: The Gathering on characters, resale liquidity in Thailand, game depth, and the one thing specific to Lorcana here, that there is no Thai-language release.',
        },
        h1: {
            th: 'Lorcana เทียบกับการ์ดโปเกม่อนและ Magic',
            en: 'Disney Lorcana vs Pokemon and Magic',
        },
        body: {
            th: [
                'คำถามนี้ตอบยากเวลาไปถามร้านที่ขายเกมเดียว เพราะคำตอบมักจะเป็นเกมนั้นเสมอ CardStreet มีแคตตาล็อกครบทั้ง Lorcana, การ์ดโปเกม่อน, วันพีช, ยูกิโอ, เมจิก และ Riftbound เราจึงไม่มีเหตุผลต้องเชียร์เกมใดเป็นพิเศษ',
                'ถ้าสนใจตัวละครที่รู้จักอยู่แล้ว Lorcana ได้เปรียบชัดเจน ตัวละครดิสนีย์เป็นสิ่งที่คนไทยโตมาด้วย ทำให้เริ่มสะสมได้โดยไม่ต้องเรียนรู้จักรวาลใหม่ทั้งหมด และงานอาร์ตระดับ Enchanted กับ Iconic ก็สวยพอที่จะเก็บโดยไม่ต้องเล่นเกมเลย',
                'ถ้าสนใจสภาพคล่อง การ์ดโปเกม่อนยังนำอยู่มากในไทย มีทั้งฉบับภาษาไทย อังกฤษ และญี่ปุ่น คนซื้อคนขายเยอะที่สุด ขายต่อง่ายที่สุด และมีชุดภาษาไทยที่หาซื้อได้ในประเทศโดยตรง',
                'ถ้าสนใจความลึกของเกม Magic: The Gathering มีอายุยาวนานที่สุดและระบบซับซ้อนที่สุด เหมาะกับคนที่อยากเล่นจริงจังมากกว่าสะสมอย่างเดียว',
                'ข้อควรรู้เฉพาะของ Lorcana ในไทยคือยังไม่มีฉบับภาษาไทย ของทั้งหมดเป็นของนำเข้า ทำให้ราคาผันผวนตามค่าเงินและรอบการนำเข้ามากกว่าการ์ดโปเกม่อนภาษาไทย ซึ่งเป็นข้อที่ควรรู้ก่อนลงเงินก้อนใหญ่',
                'ทางที่ปลอดภัยที่สุดสำหรับคนเพิ่งเริ่มคือเลือกจากตัวละครที่ชอบก่อน แล้วค่อยดูราคาตลาดของใบที่อยากได้จริง ๆ ก่อนตัดสินใจ ทั้งสามเกมเช็คราคาได้ในที่เดียวกัน',
            ],
            en: [
                'This is a hard question to ask a shop that sells one game, because the answer is always that game. CardStreet carries Lorcana, Pokemon, One Piece, Yu-Gi-Oh, Magic and Riftbound, so we have no reason to push any of them.',
                'If you care about characters you already know, Lorcana has the clear edge. Disney characters are something most people in Thailand grew up with, so you can start collecting without learning an entire new universe first, and the Enchanted and Iconic artwork is good enough to collect without ever playing the game.',
                'If you care about liquidity, Pokemon still leads in Thailand by a wide margin. It exists in Thai, English and Japanese, has the most buyers and sellers, is the easiest to resell, and has Thai sets you can buy domestically.',
                'If you care about game depth, Magic: The Gathering is the oldest and most mechanically complex, and suits people who want to play seriously rather than only collect.',
                'One thing specific to Lorcana in Thailand: there is no Thai-language release, so everything is imported. Prices move with exchange rates and import cycles more than Thai-language Pokemon cards do. Worth knowing before committing serious money.',
                'The safest path for a beginner is to pick based on the characters you actually like, then check the market price of the specific cards you want before deciding. All three games are priceable in the same place.',
            ],
        },
    },
    {
        slug: 'thai-vs-japanese-vs-english-pokemon-cards',
        game: 'pokemon',
        updated: '2026-08-30',
        title: {
            th: 'การ์ดโปเกม่อนไทย ญี่ปุ่น อังกฤษ ต่างกันยังไง และราคาต่างกันแค่ไหน | CardStreet',
            en: 'Thai vs Japanese vs English Pokemon Cards, and Why the Prices Differ | CardStreet',
        },
        description: {
            th: 'การ์ดโปเกม่อนใบเดียวกันในภาษาไทย ญี่ปุ่น และอังกฤษ คือคนละใบในสายตาตลาด และราคาก็ต่างกันจริง อธิบายว่าต่างกันตรงไหน และควรเทียบราคาแบบไหนถึงจะไม่พลาด',
            en: 'The same Pokemon card in Thai, Japanese and English is three different cards to the market, and the prices genuinely differ. What separates them, and how to compare the right one.',
        },
        h1: {
            th: 'การ์ดโปเกม่อนไทย ญี่ปุ่น อังกฤษ ต่างกันยังไง',
            en: 'Thai vs Japanese vs English Pokemon Cards',
        },
        body: {
            th: [
                'คำถามที่นักสะสมไทยเจอตั้งแต่ใบแรกคือ การ์ดใบเดียวกันแต่คนละภาษา ราคาเท่ากันไหม คำตอบคือไม่เท่า และไม่ได้ต่างกันนิดเดียวด้วย',
                'สาเหตุคือทั้งสามภาษาเป็นคนละตลาดกันจริง ๆ การ์ดภาษาไทยพิมพ์ตามชุดญี่ปุ่นแบบหนึ่งต่อหนึ่ง เลขการ์ดตรงกัน ภาพเหมือนกัน แต่คนซื้อคนขายคนละกลุ่ม ปริมาณที่พิมพ์ออกมาต่างกัน และความต้องการในแต่ละประเทศก็ไม่เหมือนกัน ส่วนชุดภาษาอังกฤษมักเรียงเลขใหม่ทั้งชุด ทำให้เลขการ์ดไม่ตรงกับฉบับญี่ปุ่นเลย',
                'ในทางปฏิบัติ การ์ดฉบับภาษาไทยมักซื้อขายกันต่ำกว่าใบแฝดภาษาญี่ปุ่นที่เลขเดียวกันอย่างเห็นได้ชัด นี่คือสิ่งที่เห็นได้จากข้อมูลราคาจริง ไม่ใช่ความรู้สึก และเป็นข้อมูลที่หาจากเว็บทั่วไปไม่ค่อยได้ เพราะเว็บส่วนใหญ่ไม่ได้เก็บราคาการ์ดไทยแยกไว้ต่างหาก',
                'ข้อผิดพลาดที่ทำให้เสียเงินบ่อยที่สุดคือ เห็นราคาการ์ดใบหนึ่งจากเว็บต่างประเทศแล้วเอามาอ้างอิงกับการ์ดไทยที่ถืออยู่ ราคาที่เห็นนั้นเป็นของฉบับภาษาอังกฤษหรือญี่ปุ่น ซึ่งคนละใบกับที่มีอยู่จริง',
                'วิธีที่ถูกต้องคือดูสามอย่างบนการ์ดก่อนเสมอ หนึ่ง ภาษาที่พิมพ์บนตัวการ์ด สอง รหัสชุดที่มุมล่าง เช่น MA5 หรือ SV8a ซึ่งบอกได้ทันทีว่าเป็นชุดไทยหรือชุดญี่ปุ่น และสาม เลขการ์ดในชุด แล้วค่อยเปิดหน้าการ์ดที่ตรงทั้งสามอย่าง',
                'CardStreet เก็บราคาของทั้งสามภาษาแยกกัน มีชุดภาษาไทยเก้าสิบกว่าชุด ชุดญี่ปุ่นเก้าสิบชุด และชุดภาษาอังกฤษอีกร้อยสี่สิบกว่าชุด ราคาที่แสดงจึงเป็นของใบที่ถืออยู่จริง ไม่ใช่ราคาเฉลี่ยข้ามภาษา',
            ],
            en: [
                'The first question most collectors in Thailand hit: is the same card worth the same in Thai, Japanese and English? It is not, and the gap is not small.',
                'The reason is that all three are genuinely separate markets. Thai cards are printed from the Japanese sets one-to-one, so the collector numbers match and the artwork is identical, but the buyers, the print runs and the demand are all different. English sets usually renumber entirely, so their collector numbers do not line up with the Japanese release at all.',
                'In practice, Thai prints trade noticeably below their Japanese twins at the same collector number. That comes out of real price data rather than impression, and it is hard to find elsewhere, because most sites do not track Thai cards as their own market at all.',
                'The most expensive mistake is taking a price from an overseas site and applying it to the Thai card in your hand. That figure belongs to the English or Japanese print, which is a different card.',
                'The right method is to check three things on the card first: the language it is printed in, the set code in the bottom corner (MA5 or SV8a tells you immediately whether it is a Thai or Japanese set), and the collector number. Then open the card page that matches all three.',
                'CardStreet prices all three separately, with over ninety Thai sets, ninety Japanese sets and more than a hundred and forty English ones. The price you see belongs to the card you actually hold, not a blended average across languages.',
            ],
        },
    },
    {
        slug: 'pokemon-rarity-codes-thai',
        game: 'pokemon',
        updated: '2026-08-30',
        title: {
            th: 'รหัสความหายากการ์ดโปเกม่อน SR SAR AR UR HR อ่านยังไง | CardStreet',
            en: 'Pokemon Card Rarity Codes Explained: SR, SAR, AR, UR, HR | CardStreet',
        },
        description: {
            th: 'อธิบายรหัสความหายากบนการ์ดโปเกม่อนไทยและญี่ปุ่น ทั้ง C U R RR AR SR SAR UR HR และ ACE ว่าแต่ละตัวหมายถึงอะไร และตัวไหนคือกลุ่มที่ราคาสูงจริง',
            en: 'What C, U, R, RR, AR, SR, SAR, UR, HR and ACE actually mean on Thai and Japanese Pokemon cards, and which of them are the ones that carry real value.',
        },
        h1: {
            th: 'รหัสความหายากการ์ดโปเกม่อน อ่านยังไง',
            en: 'Pokemon Card Rarity Codes Explained',
        },
        body: {
            th: [
                'การ์ดโปเกม่อนฉบับภาษาไทยและญี่ปุ่นพิมพ์รหัสความหายากไว้ข้างเลขการ์ดที่มุมล่าง เป็นตัวย่อสั้น ๆ ที่อ่านออกแล้วจะรู้ทันทีว่าใบที่ถืออยู่อยู่ชั้นไหนของชุด',
                'กลุ่มพื้นฐานคือ C คือ Common ใบธรรมดาที่เจอมากที่สุด U คือ Uncommon R คือ Rare และ RR คือ Double Rare ซึ่งเป็นระดับของการ์ด ex ทั่วไป สี่กลุ่มนี้คือส่วนใหญ่ของทุกซองและมักมีมูลค่าไม่สูง',
                'กลุ่มที่ราคาเริ่มขยับคือ AR ย่อมาจาก Art Rare เป็นการ์ดภาพเต็มใบที่ยังใช้เลขในชุดปกติ SR คือ Super Rare ตัวหนังสือและขอบเป็นแบบสะท้อนแสง และ UR คือ Ultra Rare ซึ่งเป็นการ์ดทองในหลายชุด',
                'กลุ่มบนสุดที่นักสะสมไล่ล่ากันจริงคือ SAR ย่อมาจาก Special Art Rare เป็นภาพพิเศษเต็มใบและมักเป็นใบที่แพงที่สุดของชุด HR คือ Hyper Rare และในชุดยุคเมก้ายังมี MUR เพิ่มเข้ามาอีกระดับ',
                'นอกจากนี้ยังมี ACE ซึ่งเป็นการ์ด ACE SPEC ที่ใส่ในเด็คได้ใบเดียว และ TR สำหรับการ์ดเทรนเนอร์บางกลุ่ม',
                'ข้อควรจำคือรหัสความหายากบอกแค่ชั้นของการ์ด ไม่ได้บอกราคาโดยตรง การ์ด SAR ของตัวละครดังราคาสูงกว่าการ์ด SAR ของตัวละครที่ไม่มีคนตามเก็บหลายเท่า และการ์ด R ธรรมดาที่ถูกใช้ในเด็คยอดนิยมก็แพงกว่าที่ระดับความหายากบอกไว้ได้เหมือนกัน',
                'วิธีที่แม่นที่สุดคือดูรหัสเพื่อจัดกลุ่มคร่าว ๆ แล้วเปิดหน้าการ์ดใบนั้นดูราคาตลาดจริง เพราะสองใบที่รหัสเดียวกันในชุดเดียวกันก็ราคาต่างกันได้มาก',
            ],
            en: [
                'Thai and Japanese Pokemon cards print a rarity code next to the collector number in the bottom corner. Learning to read it tells you immediately which tier of the set a card belongs to.',
                'The base group: C is Common, the everyday pull. U is Uncommon, R is Rare, and RR is Double Rare, which is where most ordinary ex cards sit. These four make up the bulk of any pack and are usually modest in value.',
                'Where prices start to move: AR stands for Art Rare, a full-art card that still uses a normal set number. SR is Super Rare, with reflective text and borders. UR is Ultra Rare, the gold cards in many sets.',
                'The top group collectors actually hunt: SAR, or Special Art Rare, a special full-art treatment that is usually the most valuable card in its set. HR is Hyper Rare, and Mega-era sets add MUR above that again.',
                'You will also see ACE for ACE SPEC cards, which are limited to one per deck, and TR on some trainer cards.',
                'The thing to remember is that a rarity code tells you the tier, not the price. An SAR of a popular character is worth many times an SAR of one nobody collects, and an ordinary R that sees heavy competitive play can beat what its rarity suggests.',
                'The reliable method is to use the code to place a card roughly, then open its page for the actual market price, because two cards with the same code in the same set can still be far apart.',
            ],
        },
    },
    {
        slug: 'most-valuable-thai-pokemon-cards',
        game: 'pokemon',
        updated: '2026-08-30',
        cards: [
            { label: "เมก้าลิซาร์ดอน X ex (SAR)", id: 'MA2-137' },
            { label: "เมก้าเก็งกาex (SAR)", id: 'MA3-240' },
            { label: "เมก้าดาร์กไรex (MUR)", id: 'MA5-238-th' },
            { label: "เมก้าเก็คโคกะex (MUR)", id: 'MA5-237-th' },
            { label: "มิว ex (SAR)", id: 'th-SV4a-347' },
            { label: "ลิซาร์ดอน ex (SAR)", id: 'th-SV2a-201' },
            { label: "แบล็กกี ex (SAR)", id: 'fa04c249-4e5f-49fc-8524-834b166dd55d' },
            { label: "พิคาชูex (SAR)", id: 'MA4-173-th' },
        ],
        title: {
            th: 'การ์ดโปเกม่อนภาษาไทยใบไหนแพงที่สุด และเช็คราคายังไง | CardStreet',
            en: 'The Most Valuable Thai-Language Pokemon Cards | CardStreet',
        },
        description: {
            th: 'รวมการ์ดโปเกม่อนภาษาไทยที่ราคาสูงที่สุด จากชุด MA, SV และยุค AS พร้อมวิธีเช็คราคาตลาดล่าสุดของใบที่ถืออยู่จริง',
            en: 'The highest-value Thai-language Pokemon cards across the MA, SV and AS-era sets, and how to check a live market price for the exact card you hold.',
        },
        h1: {
            th: 'การ์ดโปเกม่อนภาษาไทยใบไหนแพงที่สุด',
            en: 'The Most Valuable Thai-Language Pokemon Cards',
        },
        body: {
            th: [
                'การ์ดโปเกม่อนภาษาไทยเพิ่งมีมาไม่กี่ปี แต่บางใบขึ้นไปถึงหลักหมื่นบาทแล้ว และเกือบทั้งหมดมาจากระดับ SAR กับ MUR ซึ่งเป็นชั้นบนสุดของชุด',
                'ใบที่นักสะสมไทยตามหามากที่สุดกลุ่มหนึ่งอยู่ในชุดยุคเมก้า ได้แก่ เมก้าลิซาร์ดอน X ex จากชุดอัคคีสีคราม เมก้าเก็งกาex จากชุดวิวัฒนาการเมก้า ดรีมex และ เมก้าดาร์กไรex กับ เมก้าเก็คโคกะex จากชุดเงามืดคุกคาม',
                'ฝั่งชุด SV ก็มีใบใหญ่อยู่หลายใบ ทั้ง มิว ex จากไชนีเทรเชอร์ex ลิซาร์ดอน ex จากโปเกมอนการ์ด 151 แบล็กกี ex จากเทศกาลเทรัสตัลex และ พิคาชูex จากวอยด์บลาสต์',
                'ส่วนใครที่เก็บการ์ดไทยยุคเก่ากว่านั้น ชุดยุค AS ก็ยังมีใบราคาดีอยู่ เช่น ลิซาร์ดอนGX, เรชิรัม & เซครอมGX, มิวทู & มิวGX และ เก็งกา & มิมิคคิวGX',
                'ราคาของการ์ดกลุ่มนี้ขยับตลอด บทความที่ใส่ตัวเลขไว้จึงล้าสมัยเร็วมาก วิธีที่ใช้ได้จริงคือเปิดหน้าการ์ดใบนั้นแล้วดูราคาตลาดล่าสุดเป็นเงินบาท พร้อมวันที่อัปเดตและกราฟย้อนหลัง',
                'สิ่งที่ต้องระวังเป็นพิเศษกับการ์ดไทยคือ ต้องเทียบให้ตรงชุดและตรงเลขการ์ด เพราะการ์ดตัวละครเดียวกันมีทั้งเวอร์ชัน RR ธรรมดาและเวอร์ชัน SAR ในชุดเดียวกัน และราคาต่างกันหลายสิบเท่า',
            ],
            en: [
                'Thai-language Pokemon cards have only existed for a few years, but some already trade in the tens of thousands of baht, and nearly all of them come from the SAR and MUR tiers at the top of each set.',
                'One cluster of the most-hunted cards sits in the Mega-era sets: Mega Charizard X ex from อัคคีสีคราม, Mega Gengar ex from วิวัฒนาการเมก้า ดรีมex, and Mega Darkrai ex and Mega Greninja ex from เงามืดคุกคาม.',
                'The SV sets carry several more: Mew ex from ไชนีเทรเชอร์ex, Charizard ex from Pokemon Card 151, Umbreon ex from เทศกาลเทรัสตัลex, and Pikachu ex from วอยด์บลาสต์.',
                'If you collect older Thai cards, the AS-era sets still hold value too, with cards like Charizard-GX, Reshiram & Zekrom-GX, Mewtwo & Mew-GX and Gengar & Mimikyu-GX.',
                'Prices in this group move constantly, so any article with numbers in it goes stale quickly. The method that works is to open the card page and read the current market price in baht, with its update date and history chart.',
                'One thing to watch with Thai cards especially: match both the set and the collector number. The same character exists as an ordinary RR and as an SAR within a single set, and the gap between them is many times over.',
            ],
        },
    },
    {
        slug: 'spot-fake-pokemon-cards-thai',
        game: 'pokemon',
        updated: '2026-08-30',
        title: {
            th: 'การ์ดโปเกม่อนปลอม ดูยังไง วิธีเช็คก่อนโอนเงิน | CardStreet',
            en: 'How to Spot Fake Pokemon Cards Before You Pay | CardStreet',
        },
        description: {
            th: 'วิธีตรวจการ์ดโปเกม่อนปลอมด้วยตัวเอง ทั้งเนื้อการ์ด งานพิมพ์ ตัวหนังสือ ขอบ และสัญญาณเตือนที่จับได้บ่อยที่สุด พร้อมข้อควรระวังเฉพาะการ์ดภาษาไทย',
            en: 'Check a Pokemon card yourself: stock, print quality, text, edges and the tell that catches most counterfeits, plus what is specific to Thai-language cards.',
        },
        h1: {
            th: 'การ์ดโปเกม่อนปลอม ดูยังไง',
            en: 'How to Spot Fake Pokemon Cards',
        },
        body: {
            th: [
                'การ์ดโปเกม่อนเป็นการ์ดที่มีของปลอมเยอะที่สุดในตลาด เพราะเป็นเกมที่คนเล่นมากที่สุดและราคาสูงที่สุด สิ่งที่ตรวจได้เองมีดังนี้',
                'แสงส่องผ่าน การ์ดแท้มีชั้นฟอยล์สีดำอยู่ตรงกลางระหว่างกระดาษสองชั้น ส่องไฟจากด้านหลังแล้วแสงจะไม่ทะลุ ถ้าส่องแล้วเห็นแสงผ่านชัดเจน มีโอกาสสูงมากว่าเป็นของปลอม',
                'ความคมของงานพิมพ์ ซูมดูตัวหนังสือเล็กที่สุดบนการ์ด เช่น ข้อความลิขสิทธิ์ที่ขอบล่าง ของแท้คมและอ่านออกทุกตัว ของปลอมมักฟุ้งหรือขอบตัวอักษรเบลอ',
                'สีและความอิ่มตัว ของปลอมมักสีจัดเกินไปหรือซีดกว่าปกติ เทียบกับภาพการ์ดใบเดียวกันจากแคตตาล็อกที่เชื่อถือได้จะเห็นชัด',
                'ผิวสัมผัสและขอบ การ์ดแท้ตัดขอบเรียบสม่ำเสมอ ผิวมีลายพื้นผิวละเอียด ถ้าลูบแล้วลื่นเกินไปหรือขอบหยาบให้ระวัง',
                'สำหรับการ์ดภาษาไทยโดยเฉพาะ ให้ดูรหัสชุดที่มุมล่างว่าตรงกับชุดที่มีอยู่จริงหรือไม่ เช่น MA1 ถึง MA5 หรือ SV ชุดต่าง ๆ ของปลอมหลายใบใช้รหัสที่ไม่มีอยู่จริง หรือเอาภาพจากชุดญี่ปุ่นมาใส่รหัสไทย',
                'ข้อสุดท้ายที่จับได้บ่อยที่สุดคือราคา ถ้าใบที่ราคาตลาดหลักหมื่นถูกเสนอมาหลักพัน นั่นคือสัญญาณเตือน ไม่ใช่โชคดี เพราะแบบนี้การรู้ราคากลางจึงเป็นเครื่องมือกันของปลอมที่ดีที่สุด บน CardStreet ทุกหน้าการ์ดแสดงราคาตลาดล่าสุด และถ้าซื้อผ่านระบบ ผู้ขายทุกคนยืนยันตัวตนแล้ว มีระบบคุ้มครองผู้ซื้อ ถ้าของไม่ตรงตามที่ระบุก็มีขั้นตอนรองรับ',
            ],
            en: [
                'Pokemon is the most counterfeited trading card game there is, because it has the most players and the highest prices. Here is what you can check yourself.',
                'Light test. A genuine card has a black foil layer sandwiched between two paper layers, so shining a light behind it does not pass through. If light comes through clearly, it is very likely fake.',
                'Print sharpness. Zoom in on the smallest text on the card, such as the copyright line along the bottom edge. On a real card every character is crisp and legible; fakes blur or bleed.',
                'Colour and saturation. Counterfeits usually run either oversaturated or washed out. Comparing against the same card in a catalog you trust makes it obvious.',
                'Texture and edges. Genuine cards are cut cleanly and evenly and have a fine surface texture. Too slick to the touch, or rough edges, is a warning.',
                'Specific to Thai cards: check that the set code in the bottom corner is a set that actually exists, such as MA1 through MA5 or the SV sets. Many fakes carry codes that were never printed, or use Japanese set artwork under a Thai code.',
                'The tell that catches the most fakes is still the price. If a card with a market price in the tens of thousands is offered for a few thousand, that is a warning rather than luck. That is why knowing the going rate is the best counterfeit defence there is. Every card page on CardStreet shows the current market price, and buying through the platform means the seller is identity-verified with buyer protection on the order.',
            ],
        },
    },
    {
        slug: 'thai-pokemon-set-codes',
        game: 'pokemon',
        updated: '2026-08-30',
        title: {
            th: 'ชุดการ์ดโปเกม่อนไทยมีอะไรบ้าง รหัส MA SV AS อ่านยังไง | CardStreet',
            en: 'Thai Pokemon Sets Explained: What MA, SV and AS Set Codes Mean | CardStreet',
        },
        description: {
            th: 'อธิบายรหัสชุดการ์ดโปเกม่อนภาษาไทย ทั้งยุค AS ยุค SV และยุคเมก้า MA ว่าแต่ละรหัสคือชุดไหน และใช้ดูอะไรได้บ้างเวลาเช็คราคา',
            en: 'What the AS, SV and MA set codes on Thai Pokemon cards mean, which era each belongs to, and how to use them when checking a price.',
        },
        h1: {
            th: 'ชุดการ์ดโปเกม่อนไทย และรหัสชุดที่ควรรู้',
            en: 'Thai Pokemon Sets and Their Set Codes',
        },
        body: {
            th: [
                'รหัสชุดที่พิมพ์อยู่มุมล่างของการ์ดคือข้อมูลที่มีประโยชน์ที่สุดบนตัวการ์ด เพราะบอกได้ทั้งว่าเป็นการ์ดภาษาอะไร มาจากยุคไหน และใช้หาหน้าการ์ดที่ถูกต้องได้เร็วที่สุด',
                'การ์ดโปเกม่อนภาษาไทยแบ่งได้เป็นสามยุคใหญ่ ยุคแรกคือรหัสขึ้นต้นด้วย AS ซึ่งเป็นการ์ดยุค Sun และ Moon ชุดกลุ่มนี้เก่าที่สุดในบรรดาการ์ดไทย และหลายใบยังมีราคาดีอยู่',
                'ยุคถัดมาคือรหัสขึ้นต้นด้วย SV ซึ่งมาจากยุค Scarlet และ Violet เช่น ไชนีเทรเชอร์ex โปเกมอนการ์ด 151 เทศกาลเทรัสตัลex และการผงาดของผู้ไร้พ่าย เป็นกลุ่มที่มีจำนวนชุดมากที่สุด',
                'ยุคล่าสุดคือรหัสขึ้นต้นด้วย MA ซึ่งเป็นยุคเมก้า ไล่ตั้งแต่วิวัฒนาการเมก้า อัคคีสีคราม วิวัฒนาการเมก้า ดรีมex วอยด์บลาสต์ ไปจนถึงเงามืดคุกคาม นอกจากนี้ยังมีรหัสขึ้นต้นด้วย MAT ซึ่งเป็นแท็กติกเด็คของยุคเดียวกัน',
                'จุดที่ต้องระวังคือรหัสชุดของไทยกับญี่ปุ่นบางชุดใช้ตัวเดียวกัน เพราะการ์ดไทยพิมพ์ตามชุดญี่ปุ่นแบบหนึ่งต่อหนึ่ง เวลาเช็คราคาจึงต้องดูภาษาบนการ์ดควบคู่ไปด้วยเสมอ ไม่งั้นจะได้ราคาของฉบับญี่ปุ่นมาแทน',
                'CardStreet มีชุดการ์ดโปเกม่อนภาษาไทยเก้าสิบกว่าชุดในแคตตาล็อก เปิดหน้าชุดแล้วไล่ดูราคาทีละใบได้ หรือพิมพ์รหัสชุดกับเลขการ์ดในช่องค้นหาเพื่อไปที่ใบนั้นโดยตรง',
            ],
            en: [
                'The set code printed in the bottom corner is the single most useful piece of information on a card. It tells you the language, the era, and it is the fastest way to reach the right card page.',
                'Thai Pokemon cards fall into three broad eras. The first uses codes beginning with AS, from the Sun and Moon era. These are the oldest Thai-language cards and a number of them still hold strong prices.',
                'Next come the SV codes, from the Scarlet and Violet era, covering sets like ไชนีเทรเชอร์ex, Pokemon Card 151, เทศกาลเทรัสตัลex and การผงาดของผู้ไร้พ่าย. This is the largest group by number of sets.',
                'The current era uses MA codes, the Mega era, running from วิวัฒนาการเมก้า through อัคคีสีคราม, วิวัฒนาการเมก้า ดรีมex and วอยด์บลาสต์ to เงามืดคุกคาม. You will also see MAT codes, which are the tactics decks from the same era.',
                'The catch is that some Thai and Japanese sets share a code, because Thai cards are printed from the Japanese sets one-to-one. When checking a price you must read the language on the card as well, or you will end up looking at the Japanese print instead.',
                'CardStreet carries over ninety Thai-language Pokemon sets. Open a set page to browse it card by card, or type the set code and collector number into search to go straight to one.',
            ],
        },
    },
    {
        slug: 'one-piece-english-vs-japanese',
        game: 'onepiece',
        updated: '2026-08-30',
        faqs: [
            { q: { th: "การ์ดวันพีชมีฉบับภาษาไทยไหม", en: "Is there a Thai-language One Piece Card Game release?" },
              a: { th: "ไม่มี คนไทยต้องเลือกระหว่างฉบับภาษาอังกฤษกับภาษาญี่ปุ่นตั้งแต่ใบแรก ฉบับอังกฤษหาซื้อในไทยง่ายกว่าและขายต่อกว้างกว่า ส่วนฉบับญี่ปุ่นออกก่อนหลายเดือนและกล่องมักถูกกว่า", en: "No. Collectors here choose between English and Japanese from the first card. English is easier to buy and resell locally; Japanese arrives months earlier and boxes are often cheaper per card." } },
            { q: { th: "การ์ดวันพีชภาษาอังกฤษกับญี่ปุ่นราคาเท่ากันไหม", en: "Do English and Japanese One Piece cards cost the same?" },
              a: { th: "ไม่เท่า ทั้งที่ใช้รหัสการ์ดเดียวกัน เช่น OP05-006 สองฉบับเป็นคนละตลาดและบางใบราคาต่างกันมาก เช็คราคาให้ตรงกับฉบับภาษาที่ถืออยู่เสมอ", en: "No — even though they share codes like OP05-006, the two editions are separate markets and some cards differ widely. Always check the price of the language edition you actually hold." } },
        ],
        title: {
            th: 'การ์ดวันพีชภาษาอังกฤษกับภาษาญี่ปุ่น เลือกเก็บแบบไหนดี | CardStreet',
            en: 'One Piece Card Game: English or Japanese, Which Should You Collect | CardStreet',
        },
        description: {
            th: 'การ์ดวันพีชไม่มีฉบับภาษาไทย คนไทยจึงต้องเลือกระหว่างฉบับภาษาอังกฤษกับภาษาญี่ปุ่น เทียบให้ครบทั้งราคา ความหาง่าย เลขการ์ด และการขายต่อ',
            en: 'The One Piece Card Game has no Thai-language release, so collectors here choose between the English and Japanese editions. Price, availability, numbering and resale compared.',
        },
        h1: {
            th: 'การ์ดวันพีช ภาษาอังกฤษหรือญี่ปุ่นดี',
            en: 'One Piece Cards: English or Japanese?',
        },
        body: {
            th: [
                'ต่างจากการ์ดโปเกม่อนที่มีฉบับภาษาไทยขายในประเทศ การ์ดวันพีชไม่มีฉบับภาษาไทยเลย คนไทยที่เริ่มเก็บจึงต้องตัดสินใจตั้งแต่ใบแรกว่าจะเดินสายภาษาอังกฤษหรือภาษาญี่ปุ่น และสองสายนี้เป็นคนละตลาดกันจริง ๆ',
                'ฉบับภาษาญี่ปุ่นออกก่อนเสมอ ชุดใหม่จะมาถึงมือคนเก็บสายญี่ปุ่นก่อนสายอังกฤษหลายเดือน ใครอยากได้การ์ดใหม่ก่อนใครมักเลือกทางนี้ ราคากล่องมักถูกกว่าเมื่อเทียบใบต่อใบ แต่ต้องสั่งนำเข้าและรอ',
                'ฉบับภาษาอังกฤษหาซื้อในไทยง่ายกว่า ร้านการ์ดในประเทศสต็อกไว้มากกว่า และถ้าจะขายต่อในกลุ่มคนไทยก็มักมีคนซื้อกว้างกว่า เพราะอ่านข้อความบนการ์ดได้โดยตรง',
                'เรื่องเลขการ์ดเป็นจุดที่หลายคนเข้าใจผิด ทั้งสองฉบับใช้รหัสเดียวกัน เช่น OP05-006 หรือ ST18-002 ทำให้ดูเหมือนเป็นใบเดียวกัน แต่ราคาตลาดของสองฉบับไม่เท่ากัน และบางใบต่างกันมาก การเอาราคาฝั่งหนึ่งมาอ้างกับอีกฝั่งจึงพลาดได้ง่าย',
                'สิ่งที่ควรทำก่อนซื้อหรือขายทุกครั้งคือ ดูภาษาบนตัวการ์ดก่อน แล้วเปิดหน้าการ์ดของฉบับนั้นโดยเฉพาะ CardStreet เก็บราคาของทั้งสองฉบับแยกกัน มีชุดภาษาอังกฤษห้าสิบแปดชุดและชุดภาษาญี่ปุ่นห้าสิบห้าชุดในแคตตาล็อก',
                'สรุปสำหรับคนเพิ่งเริ่ม ถ้าอยากเล่นกับคนไทยและขายต่อง่าย เลือกภาษาอังกฤษ ถ้าเน้นสะสมงานอาร์ตและอยากได้ชุดใหม่ก่อน เลือกภาษาญี่ปุ่น และไม่ว่าจะสายไหน ให้เทียบราคาของฉบับที่ถืออยู่จริงเสมอ',
            ],
            en: [
                'Unlike Pokemon, which has a Thai-language edition sold locally, the One Piece Card Game has no Thai release at all. Collectors here have to choose between English and Japanese from the first card, and the two are genuinely separate markets.',
                'Japanese releases come first. New sets reach Japanese-track collectors months ahead of English, so anyone who wants cards early tends to go that way. Boxes are often cheaper per card, but they have to be imported and waited for.',
                'English is easier to buy in Thailand. Local card shops stock more of it, and reselling within Thai groups usually reaches a wider audience, because buyers can read the card text directly.',
                'Card numbering is where people get caught out. Both editions use the same codes — OP05-006, ST18-002 — which makes them look like the same card. Their market prices are not the same, and for some cards the gap is wide. Quoting a price from one edition against the other is an easy way to lose money.',
                'So before buying or selling, read the language on the card first, then open the page for that specific edition. CardStreet prices both separately, with fifty-eight English sets and fifty-five Japanese sets in the catalog.',
                'For beginners: if you want to play with people in Thailand and resell easily, take English. If you are collecting for the art and want new sets first, take Japanese. Either way, always compare against the edition you actually hold.',
            ],
        },
    },
    {
        slug: 'one-piece-set-codes',
        game: 'onepiece',
        updated: '2026-08-30',
        title: {
            th: 'รหัสชุดการ์ดวันพีช OP ST EB PRB อ่านยังไง | CardStreet',
            en: 'One Piece Set Codes Explained: OP, ST, EB and PRB | CardStreet',
        },
        description: {
            th: 'อธิบายรหัสชุดการ์ดวันพีชที่พิมพ์อยู่บนการ์ด ทั้ง OP, ST, EB และ PRB ว่าแต่ละแบบคือชุดประเภทไหน และใช้หาราคาการ์ดใบที่ถืออยู่ยังไง',
            en: 'What the OP, ST, EB and PRB codes printed on One Piece cards mean, what kind of product each one is, and how to use them to find the right price.',
        },
        h1: {
            th: 'รหัสชุดการ์ดวันพีช OP ST EB PRB',
            en: 'One Piece Set Codes Explained',
        },
        body: {
            th: [
                'ทุกใบของการ์ดวันพีชมีรหัสพิมพ์อยู่ เช่น OP05-006 หรือ ST18-002 อ่านรหัสนี้เป็นแล้วจะรู้ทันทีว่าการ์ดมาจากสินค้าประเภทไหน และหาหน้าการ์ดที่ถูกต้องได้เร็วขึ้นมาก',
                'ตัวอักษรข้างหน้าบอกประเภทของชุด OP คือบูสเตอร์หลัก เป็นชุดใหญ่ประจำซีซัน มีการ์ดเยอะที่สุดและมีใบระดับ SEC อยู่ในนี้ ST คือสตาร์ทเตอร์เด็ค เป็นเด็คสำเร็จรูปที่ซื้อแล้วเล่นได้เลย การ์ดส่วนใหญ่ราคาไม่สูงแต่บางใบเป็นใบที่ต้องมีในเด็คแข่ง',
                'EB คือเอ็กซ์ตร้าบูสเตอร์ เป็นชุดเสริมขนาดเล็กกว่าชุดหลัก ส่วน PRB คือพรีเมียมบูสเตอร์ ซึ่งเป็นชุดที่รวมการ์ดอาร์ตพิเศษไว้เยอะเป็นพิเศษ',
                'นอกจากนี้ยังมีการ์ดโปรโมชันที่แจกตามงานแข่งหรือแถมกับสินค้า กลุ่มนี้บางใบเป็นการ์ดที่ราคาสูงที่สุดในเกม โดยเฉพาะใบที่มีเลขซีเรียลกำกับ',
                'ตัวเลขสองหลักหลังตัวอักษรคือลำดับของชุด และตัวเลขสามหลักหลังขีดคือเลขการ์ดในชุดนั้น ดังนั้น OP05-006 หมายถึงการ์ดใบที่ 6 ของบูสเตอร์หลักชุดที่ 5',
                'ข้อควรระวังคือรหัสเดียวกันใช้ทั้งฉบับภาษาอังกฤษและภาษาญี่ปุ่น การ์ดคนละภาษาที่รหัสตรงกันคือคนละใบในตลาดและราคาไม่เท่ากัน เวลาเช็คราคาจึงต้องดูภาษาบนการ์ดควบคู่กับรหัสเสมอ',
                'CardStreet มีชุดการ์ดวันพีชรวมกันร้อยกว่าชุดทั้งสองภาษา พิมพ์รหัสชุดกับเลขการ์ดในช่องค้นหาก็ไปที่ใบนั้นได้โดยตรง',
            ],
            en: [
                'Every One Piece card carries a printed code such as OP05-006 or ST18-002. Learning to read it tells you what kind of product the card came from and gets you to the right card page much faster.',
                'The letters identify the set type. OP is a main booster, the large seasonal release with the most cards and the SEC-tier chase cards in it. ST is a starter deck, a ready-to-play product; most of its cards are inexpensive, though some are competitive staples.',
                'EB is an extra booster, a smaller supplementary set. PRB is a premium booster, which packs in a much higher share of special-art cards.',
                'Separately there are promotional cards handed out at events or bundled with products. Some of these are the most valuable cards in the game, particularly the serial-numbered ones.',
                'The two digits after the letters are the set number, and the three digits after the dash are the card number within it. So OP05-006 is card 6 of the fifth main booster.',
                'The catch: the same code is used for both the English and Japanese editions. Cards sharing a code across languages are different cards to the market and are not worth the same, so always read the language alongside the code when checking a price.',
                'CardStreet carries over a hundred One Piece sets across both languages. Type the set code and card number into search to go straight to a card.',
            ],
        },
    },
    {
        slug: 'one-piece-rarity-guide',
        game: 'onepiece',
        updated: '2026-08-30',
        title: {
            th: 'ระดับความหายากการ์ดวันพีช C UC R SR SEC L คืออะไร | CardStreet',
            en: 'One Piece Card Rarities Explained: C, UC, R, SR, SEC and L | CardStreet',
        },
        description: {
            th: 'อธิบายระดับความหายากของการ์ดวันพีช ทั้ง C UC R SR SEC และการ์ด Leader ว่าแต่ละระดับคืออะไร ระดับไหนคือกลุ่มที่ราคาสูง และทำไมการ์ดโปรโมบางใบถึงแพงกว่าทุกระดับ',
            en: 'What C, UC, R, SR, SEC and Leader mean on One Piece cards, which tiers carry real value, and why some promos outrank every rarity in the set.',
        },
        h1: {
            th: 'ระดับความหายากการ์ดวันพีช',
            en: 'One Piece Card Rarities Explained',
        },
        body: {
            th: [
                'การ์ดวันพีชพิมพ์ระดับความหายากไว้ที่มุมล่างของการ์ด ใกล้กับรหัสชุด เป็นตัวย่อสั้น ๆ ที่บอกได้ทันทีว่าใบนั้นอยู่ชั้นไหน',
                'C คือ Common และ UC คือ Uncommon สองระดับนี้คือส่วนใหญ่ของทุกซองและมักมีมูลค่าไม่สูง R คือ Rare ซึ่งเป็นชั้นกลาง และในกลุ่มนี้มีการ์ดที่ใช้ในเด็คแข่งอยู่หลายใบ ทำให้บางใบราคาสูงกว่าที่ระดับความหายากบอกไว้',
                'SR คือ Super Rare เป็นชั้นที่ราคาเริ่มขยับจริงจัง และเป็นระดับของการ์ดอาร์ตพิเศษหลายใบ',
                'SEC คือ Secret Rare ซึ่งเป็นระดับที่หายากที่สุดในบูสเตอร์ปกติ ใบที่แพงที่สุดของแต่ละชุดหลักมักอยู่ระดับนี้',
                'L คือการ์ด Leader ซึ่งเป็นการ์ดหัวหน้าเด็ค ใบละหนึ่งต่อเด็ค การ์ด Leader ไม่ได้แพงเพราะหายาก แต่แพงเพราะจำเป็นสำหรับเด็คที่แข็งในสนาม ราคาจึงขึ้นลงตามเมตาการแข่งมากกว่าตามความหายาก',
                'สิ่งที่ทำให้การ์ดวันพีชต่างจากเกมอื่นคือ การ์ดโปรโมชันที่แจกตามงานแข่ง โดยเฉพาะใบที่มีเลขซีเรียลกำกับ สามารถมีราคาสูงกว่าการ์ด SEC ในบูสเตอร์ปกติหลายเท่า เพราะจำนวนที่มีอยู่จริงน้อยกว่ามาก',
                'เพราะแบบนี้ระดับความหายากจึงใช้จัดกลุ่มคร่าว ๆ ได้ แต่ไม่ใช่ตัวบอกราคา วิธีที่แม่นคือเปิดหน้าการ์ดใบนั้นแล้วดูราคาตลาดจริงของฉบับภาษาที่ถืออยู่',
            ],
            en: [
                'One Piece cards print their rarity in the bottom corner next to the set code, as a short abbreviation that places the card immediately.',
                'C is Common and UC is Uncommon. These two make up the bulk of any pack and are usually modest. R is Rare, the middle tier, and this group contains a number of competitive staples, so some Rares are worth more than their tier suggests.',
                'SR is Super Rare, where prices start to move seriously, and it covers many of the special-art cards.',
                'SEC is Secret Rare, the scarcest tier in a normal booster. The most valuable card in a main set usually sits here.',
                "L marks a Leader card, the deck's captain, one per deck. Leaders are not expensive because they are scarce; they are expensive when they anchor a strong deck, so their prices track the competitive meta rather than rarity.",
                'What sets One Piece apart from other games is that promotional cards from events — especially serial-numbered ones — can be worth many times an SEC from a normal booster, simply because far fewer exist.',
                'So rarity is useful for placing a card roughly, but it is not a price. The reliable method is to open the card page and read the actual market price for the language edition you hold.',
            ],
        },
    },
    {
        slug: 'spot-fake-one-piece-cards',
        game: 'onepiece',
        updated: '2026-08-30',
        title: {
            th: 'การ์ดวันพีชปลอม ดูยังไง วิธีเช็คก่อนโอนเงิน | CardStreet',
            en: 'How to Spot Fake One Piece Cards Before You Pay | CardStreet',
        },
        description: {
            th: 'วิธีตรวจการ์ดวันพีชปลอมด้วยตัวเอง ทั้งเนื้อการ์ด งานพิมพ์ สี ขอบ และข้อควรระวังเฉพาะการ์ดนำเข้า เพราะการ์ดวันพีชในไทยเป็นของนำเข้าทั้งหมด',
            en: 'Check a One Piece card yourself — stock, print, colour, edges — plus what to watch for with imports, since every One Piece card in Thailand is imported.',
        },
        h1: {
            th: 'การ์ดวันพีชปลอม ดูยังไง',
            en: 'How to Spot Fake One Piece Cards',
        },
        body: {
            th: [
                'การ์ดวันพีชในไทยเป็นของนำเข้าทั้งหมด ไม่มีฉบับภาษาไทย ผู้ซื้อจึงเสียเปรียบเรื่องข้อมูลตั้งแต่ต้น และของปลอมก็ตามราคาที่สูงขึ้นมาเสมอ สิ่งที่ตรวจได้เองมีดังนี้',
                'เนื้อการ์ดและน้ำหนัก การ์ดแท้มีความหนาและน้ำหนักสม่ำเสมอ ของปลอมมักบางกว่าหรือแข็งกระด้างผิดปกติ ถ้ามีใบแท้ใบอื่นอยู่ในมือ ให้เทียบความหนาด้านข้างดู',
                'งานพิมพ์และตัวหนังสือ ซูมดูข้อความเล็กที่ขอบล่างและข้อความบรรยายเอฟเฟกต์ ของแท้คมทุกตัวอักษร ของปลอมมักเบลอ ขอบตัวอักษรฟุ้ง หรือเว้นระยะไม่เท่ากัน',
                'สีและฟอยล์ การ์ดอาร์ตพิเศษของวันพีชมีลวดลายฟอยล์ที่สะท้อนแสงเป็นแบบเฉพาะ ของปลอมมักสะท้อนแบบแบน ๆ ทั้งใบ หรือสีจัดเกินจริง เอียงดูใต้แสงจะเห็นต่างชัด',
                'ขอบและมุม การ์ดแท้ตัดขอบเรียบ มุมโค้งเท่ากันทั้งสี่มุม ถ้าขอบหยาบหรือมุมไม่เท่ากันให้ระวัง',
                'รหัสชุดกับภาษา ตรวจว่ารหัสบนการ์ดเป็นชุดที่มีอยู่จริง และตรงกับภาษาที่พิมพ์บนการ์ด ของปลอมหลายใบเอาอาร์ตของฉบับหนึ่งไปใส่รหัสของอีกฉบับ',
                'สุดท้ายคือราคา ถ้าใบที่ราคาตลาดหลักหมื่นถูกเสนอมาหลักพัน นั่นคือสัญญาณเตือน ไม่ใช่โชคดี การรู้ราคากลางจึงเป็นเครื่องมือกันของปลอมที่ดีที่สุด บน CardStreet ทุกหน้าการ์ดแสดงราคาตลาดล่าสุดแยกตามภาษา และถ้าซื้อผ่านระบบ ผู้ขายทุกคนยืนยันตัวตนแล้ว มีระบบคุ้มครองผู้ซื้อ',
            ],
            en: [
                'Every One Piece card in Thailand is imported — there is no Thai edition — so buyers start at an information disadvantage, and counterfeits follow the prices up. Here is what you can check yourself.',
                'Stock and weight. Genuine cards are consistent in thickness and weight. Fakes are often thinner, or oddly stiff. If you have a known-genuine card to hand, compare the edges side by side.',
                'Print and text. Zoom in on the small text along the bottom edge and the effect text. On a real card every character is crisp; fakes blur, bleed at the edges, or space text unevenly.',
                'Colour and foil. One Piece special-art cards use a distinctive foil pattern that catches light in a particular way. Counterfeits often reflect flatly across the whole card, or run oversaturated. Tilting under a light shows it up.',
                'Edges and corners. Real cards are cut cleanly with all four corners rounded identically. Rough edges or uneven corners are a warning.',
                "Set code against language. Check that the code is a set that exists and matches the language printed on the card. Many fakes put one edition's artwork under the other edition's code.",
                'And finally the price. If a card with a market price in the tens of thousands is offered for a few thousand, that is a warning rather than luck. Knowing the going rate is the best counterfeit defence there is. Every card page on CardStreet shows the current market price per language edition, and buying through the platform means an identity-verified seller and buyer protection on the order.',
            ],
        },
    },
    {
        slug: 'mtg-same-card-many-printings',
        game: 'mtg',
        updated: '2026-08-30',
        title: {
            th: "การ์ดเมจิกใบเดียวกันมีหลายเวอร์ชัน ราคาต่างกันยังไง | CardStreet",
            en: "One Magic Card, Many Printings: Why the Prices Differ | CardStreet",
        },
        description: {
            th: "การ์ด Magic: The Gathering ใบเดียวกันถูกพิมพ์ซ้ำข้ามหลายชุดหลายปี แต่ละเวอร์ชันราคาไม่เท่ากัน อธิบายวิธีดูว่าใบที่ถืออยู่คือเวอร์ชันไหน และเทียบราคาให้ตรง",
            en: "The same Magic: The Gathering card is reprinted across many sets and years, and the versions are not worth the same. How to tell which printing you hold, and compare the right price.",
        },
        h1: {
            th: "การ์ดเมจิกใบเดียวกัน ทำไมราคาต่างกัน",
            en: "One Magic Card, Many Printings",
        },
        body: {
            th: [
                "เรื่องที่ทำให้คนเพิ่งเริ่มเล่นเมจิกงงมากที่สุดคือ การ์ดชื่อเดียวกันที่หาเจอในเน็ตมีราคาตั้งแต่หลักสิบไปจนถึงหลักพัน ทั้งที่ดูเป็นการ์ดใบเดียวกัน คำตอบคือมันไม่ใช่ใบเดียวกัน",
                "Magic: The Gathering พิมพ์การ์ดใบเดิมซ้ำข้ามชุดมาตลอดหลายสิบปี การ์ดยอดนิยมอย่าง Sol Ring มีอยู่ในแคตตาล็อกของเราเกือบสี่สิบเวอร์ชัน กระจายอยู่ในชุดกว่ายี่สิบชุด และ Swords to Plowshares ก็มีเกือบยี่สิบเวอร์ชันเช่นกัน แต่ละเวอร์ชันคือคนละสินค้าในตลาด",
                "สิ่งที่ทำให้ราคาต่างกันมีสามอย่างหลัก อย่างแรกคือชุดที่มา ชุดเก่าหรือชุดที่พิมพ์น้อยย่อมแพงกว่าชุดที่เพิ่งออก อย่างที่สองคือแบบฟอยล์หรือไม่ฟอยล์ ซึ่งเป็นคนละราคากันเสมอ และอย่างที่สามคือกรอบและอาร์ตพิเศษ เช่น เวอร์ชันอาร์ตขยายเต็มขอบหรือเวอร์ชันภาพพิเศษ ซึ่งมักแพงกว่าเวอร์ชันปกติของชุดเดียวกัน",
                "วิธีดูว่าถือเวอร์ชันไหนอยู่ ให้ดูสัญลักษณ์ชุดที่กลางการ์ดด้านขวา ซึ่งบอกว่ามาจากชุดไหน และดูเลขการ์ดกับรหัสชุดที่แถบล่างสุดของการ์ด การ์ดสมัยใหม่พิมพ์ข้อมูลนี้ไว้ครบ",
                "ข้อผิดพลาดที่แพงที่สุดคือเอาราคาของเวอร์ชันหนึ่งไปตั้งขายหรือไปต่อรองซื้ออีกเวอร์ชันหนึ่ง ทั้งที่ราคาห่างกันหลายเท่า",
                "บน CardStreet การ์ดแต่ละเวอร์ชันมีหน้าของตัวเอง พร้อมราคาตลาดเป็นเงินบาท เลือกให้ตรงชุดและตรงแบบฟอยล์ แล้วราคาที่เห็นจะเป็นราคาของใบที่ถืออยู่จริง ไม่ใช่ค่าเฉลี่ยของทุกเวอร์ชันรวมกัน",
            ],
            en: [
                "The thing that confuses new Magic players most is finding the same card name priced anywhere from pocket change to serious money. The answer is that they are not the same card.",
                "Magic: The Gathering has reprinted its cards across sets for decades. A staple like Sol Ring exists in our catalog in nearly forty versions spread across more than twenty sets, and Swords to Plowshares in nearly twenty. Each printing is a separate product to the market.",
                "Three things drive the difference. First, the set it came from — older or smaller print runs cost more than a recent release. Second, foil versus non-foil, which are always priced separately. Third, frame and special art treatments such as extended-art or showcase versions, which usually sell above the normal version from the same set.",
                "To identify which printing you hold, look at the set symbol on the right-hand side of the card, which tells you the set, and read the collector number and set code in the bottom strip. Modern cards print all of it.",
                "The expensive mistake is quoting one printing's price while buying or selling another, when they can be many times apart.",
                "On CardStreet each printing has its own page with a market price in Thai baht. Match the set and the foil treatment, and the price you see belongs to the card you actually hold, not a blended average across every version.",
            ],
        },
    },
    {
        slug: 'mtg-rarity-guide',
        game: 'mtg',
        updated: '2026-08-30',
        title: {
            th: "ระดับความหายากการ์ดเมจิก Common Uncommon Rare Mythic | CardStreet",
            en: "Magic: The Gathering Rarities Explained: Common to Mythic | CardStreet",
        },
        description: {
            th: "อธิบายระดับความหายากของการ์ด Magic: The Gathering ทั้งสี่ระดับ พร้อมเรื่องฟอยล์และอาร์ตพิเศษ ที่มีผลกับราคามากกว่าระดับความหายากในหลายกรณี",
            en: "The four Magic: The Gathering rarity tiers explained, plus foil and special art treatments, which often matter more to price than rarity does.",
        },
        h1: {
            th: "ระดับความหายากการ์ดเมจิก",
            en: "Magic: The Gathering Rarities Explained",
        },
        body: {
            th: [
                "Magic: The Gathering ใช้ระดับความหายากเพียงสี่ระดับ ซึ่งน้อยกว่าเกมการ์ดอื่นมาก ดูได้จากสีของสัญลักษณ์ชุดที่กลางการ์ดด้านขวา",
                "Common คือระดับพื้นฐาน สัญลักษณ์สีดำ Uncommon สัญลักษณ์สีเงิน Rare สัญลักษณ์สีทอง และ Mythic ซึ่งเป็นระดับสูงสุด สัญลักษณ์สีส้มแดง",
                "แต่จุดสำคัญของเมจิกคือ ระดับความหายากบอกราคาได้น้อยกว่าที่คนคิด การ์ด Common บางใบที่จำเป็นในรูปแบบการเล่นยอดนิยมมีราคาสูงกว่าการ์ด Mythic ที่ไม่มีใครใช้หลายเท่า ราคาของเมจิกขับเคลื่อนด้วยความต้องการในการเล่นและจำนวนที่พิมพ์ออกมา มากกว่าตัวสัญลักษณ์บนการ์ด",
                "สิ่งที่มีผลกับราคาไม่แพ้กันคือแบบพิมพ์ การ์ดใบเดียวกันมักมีทั้งแบบธรรมดาและแบบฟอยล์ และในชุดสมัยใหม่ยังมีเวอร์ชันอาร์ตขยายหรืออาร์ตพิเศษเพิ่มเข้ามาอีก แต่ละแบบมีราคาของตัวเอง",
                "เพราะแบบนี้ วิธีที่ใช้ได้จริงคือดูระดับความหายากเพื่อจัดกลุ่มคร่าว ๆ แล้วเปิดหน้าการ์ดของเวอร์ชันที่ถืออยู่เพื่อดูราคาจริง เพราะสองใบที่ระดับเดียวกันในชุดเดียวกันก็ราคาต่างกันได้มาก",
                "CardStreet มีชุดการ์ดเมจิกเจ็ดสิบกว่าชุดในแคตตาล็อก เปิดหน้าชุดแล้วไล่ดูทีละใบ หรือค้นหาชื่อการ์ดเป็นภาษาอังกฤษเพื่อไปที่ใบนั้นโดยตรง",
            ],
            en: [
                "Magic: The Gathering uses only four rarity tiers, far fewer than most card games. You read it from the colour of the set symbol on the right-hand side of the card.",
                "Common is the base tier, with a black symbol. Uncommon is silver, Rare is gold, and Mythic — the top tier — is orange-red.",
                "The important part is that rarity predicts price less well in Magic than people expect. A Common that is essential to a popular format can be worth many times a Mythic nobody plays. Magic prices are driven by play demand and print run rather than the symbol on the card.",
                "Treatment matters just as much. The same card usually exists in normal and foil, and modern sets add extended-art and showcase versions on top. Each has its own price.",
                "So use rarity to place a card roughly, then open the page for the exact version you hold. Two cards at the same rarity in the same set can still be far apart.",
                "CardStreet carries over seventy Magic sets. Browse a set page card by card, or search the card name in English to go straight to it.",
            ],
        },
    },
    {
        slug: 'buy-mtg-cards-thailand',
        game: 'mtg',
        updated: '2026-08-30',
        faqs: [
            { q: { th: "ซื้อการ์ดเมจิกในไทยหรือสั่งจากต่างประเทศดีกว่า", en: "Should I buy Magic cards locally or order from overseas?" },
              a: { th: "ถ้าต้องใช้การ์ดเร็วให้ซื้อในประเทศ ได้ของทันทีและเห็นสภาพก่อนจ่าย การสั่งจากต่างประเทศตัวเลือกเยอะกว่าแต่ต้องรอหลายสัปดาห์ และสำหรับการ์ดราคาไม่กี่ร้อยบาท ค่าส่งมักกินส่วนต่างจนไม่คุ้ม", en: "If you need the card soon, buy locally — you get it today and see its condition first. Overseas ordering has more selection but takes weeks, and for cards worth a few hundred baht the postage usually eats the saving." } },
            { q: { th: "การ์ดเมจิกมีฉบับภาษาไทยไหม", en: "Is there a Thai-language Magic: The Gathering edition?" },
              a: { th: "ไม่มี การ์ดเมจิกที่หมุนเวียนในไทยเป็นฉบับภาษาอังกฤษที่นำเข้ามาทั้งหมด เวลาเช็คราคาให้เทียบกับเวอร์ชันและชุดที่ตรงกับใบที่ถืออยู่เสมอ", en: "No. Magic cards circulating in Thailand are all the imported English printing. When checking a price, always compare against the exact set and treatment of the card you hold." } },
        ],
        title: {
            th: "ซื้อการ์ดเมจิก Magic: The Gathering ในไทยที่ไหนดี | CardStreet",
            en: "Where to Buy Magic: The Gathering Cards in Thailand | CardStreet",
        },
        description: {
            th: "เทียบช่องทางซื้อการ์ดเมจิกในไทย ทั้งร้านหน้าร้าน กลุ่มซื้อขาย และการสั่งจากต่างประเทศ พร้อมข้อดีข้อเสียเรื่องราคา เวลารอ และความเสี่ยง",
            en: "Card shops, buy-sell groups and overseas ordering compared for buying Magic: The Gathering in Thailand, on price, waiting time and risk.",
        },
        h1: {
            th: "ซื้อการ์ดเมจิกในไทยที่ไหนดี",
            en: "Where to Buy Magic Cards in Thailand",
        },
        body: {
            th: [
                "การ์ดเมจิกไม่มีฉบับภาษาไทย ของที่หมุนเวียนในประเทศเป็นฉบับภาษาอังกฤษที่นำเข้ามา คนเล่นในไทยจึงมีสามทางเลือกหลัก และแต่ละทางเหมาะกับสถานการณ์ต่างกัน",
                "ร้านการ์ดในประเทศ ได้ของทันทีและได้เห็นสภาพก่อนจ่าย เหมาะกับคนที่ต้องการการ์ดไปลงเด็คให้ทันสุดสัปดาห์นี้ ข้อจำกัดคือใบเดี่ยวที่หายากหรือเวอร์ชันเฉพาะมักไม่มีในสต็อก",
                "สั่งจากเว็บต่างประเทศ ตัวเลือกเยอะที่สุดและบางใบราคาถูกกว่า แต่ต้องบวกค่าส่งระหว่างประเทศ รอหลายสัปดาห์ และมีความเสี่ยงเรื่องภาษีนำเข้ากับการ์ดเสียหายระหว่างทาง สำหรับการ์ดใบละไม่กี่ร้อยบาท ค่าส่งมักกินส่วนต่างจนไม่คุ้ม",
                "ซื้อจากผู้เล่นในไทยด้วยกัน ได้ของเร็ว ไม่มีค่าส่งข้ามประเทศ และมักต่อรองได้ ข้อควรระวังคือต้องรู้ราคากลางก่อน ไม่งั้นไม่มีทางรู้ว่าที่เสนอมาถูกหรือแพง และถ้าไม่มีตัวกลางก็ต้องรับความเสี่ยงเอง",
                "CardStreet อยู่ในกลุ่มสุดท้ายแต่แก้สองข้อเสียนั้น ทุกหน้าการ์ดแสดงราคาตลาดควบคู่กับราคาที่ผู้ขายตั้ง จึงเทียบได้ทันที ผู้ขายทุกคนยืนยันตัวตนแล้ว มีระบบคุ้มครองผู้ซื้อทุกออเดอร์ จ่ายผ่านบัตรหรือพร้อมเพย์ และส่งภายในประเทศ ไม่ต้องรอของข้ามทวีป",
                "คำแนะนำสั้น ๆ ถ้าต้องใช้การ์ดสัปดาห์นี้ให้หาในประเทศ ถ้าเก็บของแพงหรือเวอร์ชันเฉพาะ ให้เทียบราคากลางก่อนเสมอไม่ว่าจะซื้อจากทางไหน",
            ],
            en: [
                "Magic has no Thai-language edition, so what circulates here is the imported English printing. Players in Thailand have three main routes, each suited to a different situation.",
                "Local card shops give you the card today and let you see its condition before paying. Good when you need something for a deck this weekend. The limit is that scarce singles and specific printings are usually not in stock.",
                "Ordering from overseas sites offers the widest selection and sometimes lower prices, but adds international shipping, weeks of waiting, and the risk of import duty or damage in transit. For cards worth a few hundred baht, postage usually eats the saving.",
                "Buying from other players in Thailand is fast, has no international shipping, and often leaves room to negotiate. The catch is that you need a reference price, or there is no way to judge an offer — and without an intermediary the risk is yours.",
                "CardStreet sits in that last group but fixes both drawbacks. Every card page shows the market price next to the seller's asking price, so you can judge a deal immediately. Sellers are identity-verified, every order carries buyer protection, payment is by card or PromptPay, and shipping is domestic — no waiting on a parcel from another continent.",
                "Short version: if you need the card this week, buy locally. If you are buying something expensive or a specific printing, check the reference price first, whichever route you use.",
            ],
        },
    },
    {
        slug: 'yugioh-same-card-many-printings',
        game: 'yugioh',
        updated: '2026-08-30',
        title: {
            th: "การ์ดยูกิโอใบเดียวกันมีหลายเวอร์ชัน ราคาต่างกันยังไง | CardStreet",
            en: "One Yu-Gi-Oh Card, Many Printings: Why the Prices Differ | CardStreet",
        },
        description: {
            th: "การ์ดยูกิโอใบเดียวกันถูกพิมพ์ซ้ำข้ามหลายชุดในระดับความหายากที่ต่างกัน ราคาจึงห่างกันมาก อธิบายวิธีดูรหัสการ์ดเพื่อรู้ว่าถือเวอร์ชันไหนอยู่",
            en: "The same Yu-Gi-Oh card is reprinted across many sets at different rarities, so prices vary enormously. How to read the card code to know which version you hold.",
        },
        h1: {
            th: "การ์ดยูกิโอใบเดียวกัน ทำไมราคาต่างกัน",
            en: "One Yu-Gi-Oh Card, Many Printings",
        },
        body: {
            th: [
                "ยูกิโอเป็นเกมที่พิมพ์การ์ดใบเดิมซ้ำมากที่สุดเกมหนึ่ง และนี่คือสาเหตุที่ราคาการ์ดชื่อเดียวกันในเน็ตต่างกันได้เป็นร้อยเท่า",
                "ตัวอย่างจากแคตตาล็อกของเรา บลูอายส์ไวท์ดราก้อน มีอยู่เกือบหกสิบเวอร์ชัน กระจายอยู่ในชุดกว่าห้าสิบชุด ส่วนแบล็คเมจิเชียนมีราวห้าสิบเวอร์ชันในชุดกว่าสี่สิบชุด ทุกเวอร์ชันคือคนละใบในสายตาตลาด",
                "สิ่งที่ทำให้ยูกิโอต่างจากเกมอื่นคือ การ์ดใบเดิมมักถูกพิมพ์ซ้ำในระดับความหายากที่ไม่เท่ากัน ใบเดียวกันอาจออกเป็น Common ในชุดหนึ่ง และเป็น Secret Rare ในอีกชุดหนึ่ง ราคาจึงห่างกันมหาศาลทั้งที่ข้อความบนการ์ดเหมือนกันทุกตัวอักษร",
                "วิธีรู้ว่าถือเวอร์ชันไหน ให้ดูรหัสที่มุมล่างของการ์ด เป็นรูปแบบตัวอักษรของชุดตามด้วยเลขการ์ด รหัสนี้ระบุชุดที่การ์ดมาจากอย่างเจาะจง และเป็นข้อมูลที่ต้องใช้เวลาเทียบราคา",
                "อีกจุดที่ต้องดูคือระดับความหายากที่พิมพ์ไว้และลักษณะของตัวหนังสือชื่อการ์ด เพราะระดับที่ต่างกันใช้สีและการสะท้อนแสงของชื่อการ์ดต่างกัน",
                "บน CardStreet แต่ละเวอร์ชันมีหน้าของตัวเองพร้อมราคาตลาดเป็นเงินบาท แคตตาล็อกมีชุดยูกิโอรวมกันแปดร้อยกว่าชุด ทั้งฉบับภาษาอังกฤษและภาษาญี่ปุ่น เลือกให้ตรงรหัสชุดแล้วราคาที่เห็นจะเป็นของใบที่ถืออยู่จริง",
            ],
            en: [
                "Yu-Gi-Oh reprints its cards more heavily than almost any other game, which is why the same card name can appear online at prices a hundred times apart.",
                "From our own catalog: Blue-Eyes White Dragon exists in nearly sixty versions across more than fifty sets, and Dark Magician in around fifty versions across more than forty. Every printing is a different card to the market.",
                "What makes Yu-Gi-Oh unusual is that the same card is reprinted at different rarities. One card can be a Common in one set and a Secret Rare in another, so the prices diverge enormously even though the text on the card is identical.",
                "To identify your version, read the code in the bottom corner: the set's letter code followed by the card number. That code pins down exactly which set the card came from, and it is what you need in order to compare a price.",
                "Also check the printed rarity and the treatment of the card name, since different rarities use different colouring and reflectivity on the name text.",
                "On CardStreet each printing has its own page with a market price in Thai baht. The catalog carries over eight hundred Yu-Gi-Oh sets across the English and Japanese releases. Match the set code and the price you see belongs to the card in your hand.",
            ],
        },
    },
    {
        slug: 'yugioh-rarity-guide',
        game: 'yugioh',
        updated: '2026-08-30',
        title: {
            th: "ระดับความหายากการ์ดยูกิโอ Super Ultra Secret ต่างกันยังไง | CardStreet",
            en: "Yu-Gi-Oh Rarities Explained: Super, Ultra, Secret and Beyond | CardStreet",
        },
        description: {
            th: "อธิบายระดับความหายากของการ์ดยูกิโอ ตั้งแต่ Common ไปจนถึง Secret Rare, Prismatic Secret Rare และ Starlight Rare พร้อมวิธีดูจากตัวหนังสือชื่อการ์ด",
            en: "Yu-Gi-Oh rarity tiers from Common up to Secret Rare, Prismatic Secret Rare and Starlight Rare, and how to tell them apart from the card name treatment.",
        },
        h1: {
            th: "ระดับความหายากการ์ดยูกิโอ",
            en: "Yu-Gi-Oh Card Rarities Explained",
        },
        body: {
            th: [
                "ยูกิโอมีระดับความหายากมากกว่าเกมการ์ดอื่นอย่างชัดเจน และวิธีแยกที่ง่ายที่สุดคือดูที่ตัวหนังสือชื่อการ์ดด้านบน ว่าเป็นสีอะไรและสะท้อนแสงแบบไหน",
                "Common คือระดับพื้นฐาน ชื่อการ์ดเป็นตัวหนังสือสีดำธรรมดา Rare ชื่อการ์ดเป็นสีเงินสะท้อนแสง",
                "Super Rare ตัวการ์ดมีฟอยล์ที่ภาพ ส่วน Ultra Rare ชื่อการ์ดเป็นสีทองสะท้อนแสง ซึ่งเป็นสองระดับที่พบบ่อยในกลุ่มการ์ดที่มีราคา",
                "Secret Rare ชื่อการ์ดมีลายสะท้อนแสงแบบรุ้ง เป็นระดับที่ราคาสูงในเกือบทุกชุด และยังมี Prismatic Secret Rare ซึ่งเป็นรุ่นพิเศษกว่านั้นอีก",
                "Starlight Rare คือระดับที่หายากที่สุดในชุดสมัยใหม่ พบได้ในอัตราที่ต่ำมาก และมักเป็นใบที่แพงที่สุดของชุด",
                "นอกจากระดับปกติแล้วยังมีคำว่า Short Print ซึ่งไม่ใช่ระดับความหายากโดยตรง แต่หมายถึงการ์ดที่พิมพ์ออกมาน้อยกว่าใบอื่นในระดับเดียวกัน ทำให้ราคาสูงกว่าที่ระดับความหายากบอกไว้",
                "ข้อควรจำเดียวกับทุกเกมคือ ระดับความหายากไม่ใช่ราคา การ์ดที่จำเป็นในเด็คแข่งราคาสูงได้แม้เป็น Common และการ์ดระดับสูงที่ไม่มีใครใช้ก็ราคาไม่ขยับ วิธีที่แม่นคือเปิดหน้าการ์ดของเวอร์ชันที่ถืออยู่แล้วดูราคาตลาดจริง",
            ],
            en: [
                "Yu-Gi-Oh has noticeably more rarity tiers than other card games, and the easiest way to tell them apart is the card name text at the top: its colour and how it catches light.",
                "Common is the base tier, with plain black name text. Rare has silver reflective name text.",
                "Super Rare adds foil to the artwork, while Ultra Rare uses gold reflective name text. These two cover most of the cards that carry real value.",
                "Secret Rare uses a rainbow-reflective treatment on the name and sits high in almost every set, and Prismatic Secret Rare is a further step above that.",
                "Starlight Rare is the scarcest tier in modern sets, pulled at very low rates, and is usually the most valuable card in its set.",
                "You will also see Short Print, which is not a rarity as such but means a card was printed in smaller numbers than others at the same tier, pushing its price above what the rarity suggests.",
                "The same caveat applies as in every game: rarity is not price. A Common that a competitive deck needs can be expensive, and a high-rarity card nobody plays goes nowhere. Open the page for the exact version you hold and read the market price.",
            ],
        },
    },
    {
        slug: 'yugioh-tcg-vs-ocg',
        game: 'yugioh',
        updated: '2026-08-30',
        faqs: [
            { q: { th: "การ์ดยูกิ TCG กับ OCG ใช้แข่งด้วยกันได้ไหม", en: "Can Yu-Gi-Oh TCG and OCG cards be played together?" },
              a: { th: "ในการแข่งอย่างเป็นทางการไม่ได้ การ์ดสองฝั่งขนาดต่างกันเล็กน้อย ใช้ซองคนละขนาด และรายการการ์ดต้องห้ามก็คนละชุดกัน", en: "Not in sanctioned play. The two sides use slightly different card sizes, need different sleeves, and run separate banlists." } },
            { q: { th: "คนไทยควรเก็บการ์ดยูกิฝั่งไหน", en: "Which side should collectors in Thailand pick?" },
              a: { th: "ถ้าตั้งใจลงแข่งในไทยหรือขายต่อในกลุ่มคนไทย ฝั่ง TCG ภาษาอังกฤษตรงกว่า ถ้าสะสมงานอาร์ตหรืออยากได้การ์ดใหม่ก่อน ฝั่ง OCG ภาษาญี่ปุ่นก็มีเสน่ห์ของมัน ราคาสองฝั่งไม่เท่ากัน เทียบให้ตรงฉบับเสมอ", en: "For local events and resale, the English TCG is the more direct route; for artwork and earlier releases, the Japanese OCG has its appeal. The two are priced separately, so always compare the right edition." } },
        ],
        title: {
            th: "การ์ดยูกิโอ TCG กับ OCG ต่างกันยังไง เลือกเก็บแบบไหนดี | CardStreet",
            en: "Yu-Gi-Oh TCG vs OCG: What Is the Difference, and Which to Collect | CardStreet",
        },
        description: {
            th: "การ์ดยูกิโอแบ่งเป็น TCG ฉบับภาษาอังกฤษ และ OCG ฉบับภาษาญี่ปุ่น สองฝั่งมีชุด กติกา และราคาต่างกัน อธิบายให้ครบก่อนตัดสินใจเก็บสายไหน",
            en: "Yu-Gi-Oh splits into the English-language TCG and the Japanese OCG, with different sets, different banlists and different prices. What to know before choosing a side.",
        },
        h1: {
            th: "ยูกิโอ TCG กับ OCG ต่างกันยังไง",
            en: "Yu-Gi-Oh TCG vs OCG",
        },
        body: {
            th: [
                "การ์ดยูกิโอแบ่งเป็นสองโลกที่แยกจากกันชัดเจน ฝั่ง TCG คือฉบับภาษาอังกฤษที่ขายในไทยและทั่วโลกนอกเอเชียตะวันออก ส่วนฝั่ง OCG คือฉบับภาษาญี่ปุ่นที่ขายในญี่ปุ่นและบางประเทศในเอเชีย และไม่มีฉบับภาษาไทย",
                "สองฝั่งนี้ไม่ได้แค่ต่างกันที่ภาษา ชุดการ์ดออกไม่พร้อมกันและไม่เหมือนกัน การ์ดบางใบออกในฝั่งหนึ่งก่อนอีกฝั่งเป็นปี และรายการการ์ดต้องห้ามในการแข่งก็คนละรายการ ทำให้การ์ดที่แข็งในสนามของแต่ละฝั่งไม่เหมือนกัน",
                "ขนาดของการ์ดก็ต่างกันเล็กน้อย การ์ด OCG เล็กกว่าการ์ด TCG จึงใช้ปะปนกันในเด็คเดียวไม่ได้ถ้าจะลงแข่งอย่างเป็นทางการ และต้องใช้ซองใส่คนละขนาด",
                "ในแง่ราคา สองฝั่งเป็นคนละตลาดกันโดยสิ้นเชิง การ์ดใบเดียวกันในฝั่ง TCG กับ OCG ราคาไม่เท่ากันและบางใบต่างกันมาก การเอาราคาฝั่งหนึ่งไปอ้างกับอีกฝั่งจึงพลาดได้ง่าย",
                "สำหรับคนไทยที่จะเริ่มเก็บ ถ้าตั้งใจจะลงแข่งในไทยหรือขายต่อในกลุ่มคนไทย ฝั่ง TCG ภาษาอังกฤษเป็นทางที่ตรงกว่า ถ้าเก็บเพื่อสะสมงานอาร์ตหรืออยากได้การ์ดใหม่ก่อน ฝั่ง OCG ก็มีเสน่ห์ของมัน",
                "CardStreet มีทั้งสองฝั่งในแคตตาล็อกเดียวกัน ชุดภาษาอังกฤษหกร้อยกว่าชุดและชุดภาษาญี่ปุ่นอีกร้อยแปดสิบชุด ราคาแยกกันตามฉบับ จึงเทียบได้ตรงกับใบที่ถืออยู่จริง",
            ],
            en: [
                "Yu-Gi-Oh splits into two clearly separate worlds. The TCG is the English-language release sold in Thailand and across most of the world; the OCG is the Japanese release sold in Japan and parts of Asia. There is no Thai-language edition of either.",
                "The difference is more than language. The two sides get different sets on different schedules, some cards arrive on one side years before the other, and each has its own banlist — so the decks that dominate competitively are not the same.",
                "The cards are even physically different sizes. OCG cards are slightly smaller than TCG cards, so they cannot be mixed in one deck for sanctioned play and need different sleeves.",
                "On price they are completely separate markets. The same card in TCG and OCG is not worth the same, and for some cards the gap is wide, so quoting one side's price against the other is an easy mistake.",
                "For collectors in Thailand: if you intend to play in local events or resell within Thai groups, the English TCG is the more direct route. If you are collecting for the artwork or want cards earlier, the OCG has its own appeal.",
                "CardStreet carries both in one catalog — over six hundred English sets and a further one hundred and eighty Japanese ones — priced separately, so you can compare against the exact card you hold.",
            ],
        },
    },
    {
        slug: 'riftbound-beginner-guide-thai',
        game: 'riftbound',
        updated: '2026-08-30',
        faqs: [
            { q: { th: "Riftbound มีการ์ดกี่ชุดแล้ว", en: "How many Riftbound sets are there?" },
              a: { th: "ห้าชุด ได้แก่ Origins, Origins: Proving Grounds, Spiritforged, Unleashed และล่าสุดคือ Vendetta รวมการ์ดพันกว่าใบ ซึ่งยังเล็กพอที่นักสะสมคนเดียวจะไล่เก็บครบชุดได้จริง", en: "Five: Origins, Origins: Proving Grounds, Spiritforged, Unleashed and most recently Vendetta — a little over a thousand cards in total, still small enough for one collector to realistically complete a set." } },
            { q: { th: "การ์ด Riftbound ใบไหนแพงที่สุด", en: "Which Riftbound cards are the most valuable?" },
              a: { th: "เกือบทั้งหมดอยู่ในกลุ่ม Showcase โดยเฉพาะเวอร์ชัน Signature ราคายังขยับเร็วเพราะเกมยังใหม่ เช็คราคาตลาดล่าสุดได้ทุกใบบน CardStreet", en: "Almost all sit in the Showcase group, particularly the Signature versions. Prices still move quickly because the game is young — every card has a live market price on CardStreet." } },
        ],
        title: {
            th: "Riftbound คือการ์ดเกมอะไร คนเล่น LoL เริ่มยังไง | CardStreet",
            en: "What Is Riftbound? A Starting Guide for League of Legends Players | CardStreet",
        },
        description: {
            th: "Riftbound คือการ์ดเกม LoL จาก Riot Games ที่เพิ่งเปิดตัว อธิบายว่ามีชุดอะไรบ้าง เริ่มเก็บยังไง และทำไมเกมที่ยังใหม่ถึงเป็นจังหวะที่ดีสำหรับนักสะสม",
            en: "Riftbound is Riot's League of Legends card game, still new. What sets exist, how to start collecting, and why a young game is an unusual opportunity.",
        },
        h1: {
            th: "Riftbound คืออะไร และเริ่มเก็บยังไง",
            en: "What Is Riftbound, and How to Start",
        },
        body: {
            th: [
                "Riftbound คือเกมการ์ดสะสมอย่างเป็นทางการจากจักรวาล League of Legends พัฒนาโดย Riot Games คนไทยหลายคนเรียกกันสั้น ๆ ว่าการ์ดเกม LoL และถ้าคุณเล่น LoL อยู่แล้ว คุณรู้จักตัวละครเกือบทั้งหมดในเกมนี้อยู่แล้ว ทั้งจิงซ์ ยาสึโอะ อาลี ลักซ์ ดาริอัส วิคเตอร์ ทีโม และอีกมาก",
                "สิ่งที่ทำให้ Riftbound ต่างจากการ์ดเกมอื่นที่คนไทยเก็บกันคือ มันยังใหม่มาก ชุดแรกคือ Origins เพิ่งออกปลายปี 2025 ตามด้วย Origins: Proving Grounds, Spiritforged, Unleashed และล่าสุดคือ Vendetta รวมทั้งหมดห้าชุดเท่านั้น",
                "ตัวเลขนี้สำคัญกว่าที่คิด เพราะการ์ดโปเกม่อนมีนับหมื่นใบ ยูกิโอมีมากกว่านั้นอีก แต่ Riftbound ทั้งเกมมีการ์ดพันกว่าใบ ซึ่งหมายความว่านักสะสมคนหนึ่งยังไล่เก็บให้ครบทั้งชุดได้จริง เป็นโอกาสที่หายไปแล้วในเกมที่มีอายุยาวกว่านี้",
                "อีกข้อที่ต่างคือราคายังขยับเร็ว เกมที่เพิ่งเริ่มยังไม่มีราคานิ่ง การ์ดใบเดียวกันอาจขึ้นหรือลงหลายสิบเปอร์เซ็นต์ในไม่กี่เดือน ตามผลการแข่งและกระแสของตัวละคร ก่อนซื้อหรือขายจึงควรดูกราฟราคาย้อนหลังเสมอ ไม่ใช่แค่ราคาวันนี้",
                "Riftbound ยังไม่มีฉบับภาษาไทย ของที่หมุนเวียนในประเทศเป็นฉบับภาษาอังกฤษที่นำเข้ามา ร้านที่สต็อกครบจึงยังมีไม่มาก",
                "สำหรับคนเริ่มต้น แนะนำให้เริ่มจากแชมเปียนที่ตัวเองเล่นใน LoL อยู่แล้ว เพราะจะสนุกกว่าและตัดสินใจง่ายกว่า แล้วค่อยขยับไปดูการ์ดระดับ Showcase ที่เป็นงานอาร์ตพิเศษ",
                "CardStreet มีการ์ด Riftbound ครบทั้งห้าชุดในแคตตาล็อก และมีราคาตลาดครบทุกใบ เช็คราคาได้ทุกใบเป็นเงินบาท แล้วซื้อ-ขายกับผู้ขายในไทยได้โดยไม่ต้องสั่งข้ามประเทศ",
            ],
            en: [
                "Riftbound is the official collectible card game of the League of Legends universe, made by Riot Games. If you already play LoL you already know almost every character in it — Jinx, Yasuo, Ahri, Lux, Darius, Viktor, Teemo and many more.",
                "What makes Riftbound different from the other games collectors here follow is how new it is. The first set, Origins, arrived in late 2025, followed by Origins: Proving Grounds, Spiritforged, Unleashed and most recently Vendetta. Five sets in total.",
                "That number matters more than it looks. Pokemon runs to tens of thousands of cards and Yu-Gi-Oh to more than that, but the whole of Riftbound is a little over a thousand. A single collector can still realistically complete a set — an opportunity that has long since closed in older games.",
                "Prices also still move quickly. A young game has not settled, and a card can swing tens of percent in a few months on competitive results and champion popularity. Check the price history chart before buying or selling, not just today's number.",
                "There is no Thai-language Riftbound release, so what circulates here is the imported English printing, and few shops carry a full range.",
                "For beginners, start with the champions you already play in LoL. It is more enjoyable and the decisions are easier. From there, move on to the Showcase cards, which carry the special artwork.",
                "CardStreet carries all five Riftbound sets, with a market price on every single card. Check any of them in Thai baht, then buy or sell with sellers inside Thailand rather than ordering from overseas.",
            ],
        },
    },
    {
        slug: 'riftbound-rarity-guide',
        game: 'riftbound',
        updated: '2026-08-30',
        title: {
            th: "ระดับความหายากการ์ด Riftbound และคำว่า Showcase Signature คืออะไร | CardStreet",
            en: "Riftbound Rarities Explained: Epic, Showcase, Signature and Overnumbered | CardStreet",
        },
        description: {
            th: "อธิบายระดับความหายากของการ์ด Riftbound ตั้งแต่ Common ถึง Epic และคำเฉพาะอย่าง Showcase, Signature, Alternate Art และ Overnumbered ที่ไม่มีในการ์ดเกมอื่น",
            en: "Riftbound rarity tiers from Common to Epic, plus the terms unique to this game — Showcase, Signature, Alternate Art and Overnumbered — and which ones carry the value.",
        },
        h1: {
            th: "ระดับความหายากการ์ด Riftbound",
            en: "Riftbound Rarities Explained",
        },
        body: {
            th: [
                "Riftbound ใช้คำเรียกความหายากที่ไม่เหมือนการ์ดเกมอื่น คนที่ย้ายมาจากโปเกม่อนหรือยูกิโอจะเจอคำใหม่หลายคำ และบางคำไม่ใช่ระดับความหายากด้วยซ้ำ แต่เป็นแบบพิมพ์",
                "ระดับพื้นฐานเรียงจากพบบ่อยไปหายากคือ Common, Uncommon, Rare และ Epic สี่ระดับนี้คือโครงหลักของทุกชุด และการ์ดส่วนใหญ่ที่เปิดได้จะอยู่ในสามระดับแรก",
                "Showcase คือกลุ่มที่ราคาสูงที่สุดของเกม เป็นการ์ดงานอาร์ตพิเศษที่พิมพ์ในสัดส่วนน้อยกว่าการ์ดปกติมาก การ์ดที่แพงที่สุดของ Riftbound แทบทั้งหมดมาจากกลุ่มนี้",
                "ในกลุ่ม Showcase ยังมีคำกำกับย่อยที่ต้องรู้ Signature คือเวอร์ชันที่มีลายเซ็นของศิลปินหรือของตัวละครกำกับ เป็นกลุ่มที่ราคาสูงที่สุดในบรรดา Showcase ส่วน Ultimate เป็นอีกแบบพิเศษที่พบในการ์ดบางใบ",
                "Alternate Art คือการ์ดใบเดิมที่ใช้ภาพต่างจากเวอร์ชันปกติ และ Overnumbered หมายถึงการ์ดที่เลขการ์ดเกินจำนวนของชุด เช่น การ์ดใบที่ 227 ในชุดที่มี 221 ใบ ซึ่งเป็นวิธีที่เกมนี้ใช้บอกว่าเป็นการ์ดพิเศษนอกชุดปกติ",
                "จุดที่ต้องระวังคือ การ์ดตัวละครเดียวกันมีได้หลายเวอร์ชันในชุดเดียว ทั้งแบบปกติ แบบ Alternate Art และแบบ Showcase Signature ราคาต่างกันหลายสิบเท่า ดูเลขการ์ดที่มุมล่างเสมอ เพราะเลขคือสิ่งเดียวที่แยกเวอร์ชันได้แน่นอน",
                "บน CardStreet การ์ด Riftbound ทุกใบมีราคาตลาด เลือกเวอร์ชันให้ตรงเลขการ์ด แล้วราคาที่เห็นจะเป็นของใบที่ถืออยู่จริง",
            ],
            en: [
                "Riftbound uses rarity language that does not match other card games. Anyone arriving from Pokemon or Yu-Gi-Oh will meet several new terms, and some of them are not rarities at all but print treatments.",
                "The base tiers, from most common to scarcest, are Common, Uncommon, Rare and Epic. These four form the backbone of every set, and most cards you open sit in the first three.",
                "Showcase is where the value is. These are special-artwork cards printed at far lower rates than normal ones, and almost every expensive Riftbound card comes from this group.",
                "Within Showcase there are sub-labels worth knowing. Signature marks a version carrying a signature treatment and is the highest-priced group among Showcase cards. Ultimate is another special treatment found on certain cards.",
                "Alternate Art is the same card with different artwork from the standard version. Overnumbered means a card whose collector number runs past the set's stated size — card 227 in a 221-card set, for instance — which is how this game marks a card as sitting outside the normal run.",
                "The thing to watch: the same character can exist in several versions within one set — standard, Alternate Art, and Showcase Signature — with prices tens of times apart. Always read the collector number in the bottom corner, because the number is the only thing that reliably separates them.",
                "Every Riftbound card on CardStreet carries a market price. Match the version by collector number and the price you see belongs to the card in your hand.",
            ],
        },
    },
    {
        slug: 'most-valuable-riftbound-cards',
        game: 'riftbound',
        updated: '2026-08-30',
        cards: [
            { label: "Akali - Rogue Assassin (Signature)", id: 'rb-vendetta-189-166-709668' },
            { label: "Baron Nashor (Ultimate)", id: 'rb-unleashed-238-219' },
            { label: "Diana - Scorn of the Moon (Signature)", id: 'rb-unleashed-234-219-684506' },
            { label: "Zed - Master of Shadows (Signature)", id: 'rb-vendetta-191-166-709666' },
            { label: "Jayce - Defender of Tomorrow (Signature)", id: 'rb-vendetta-194-166-709103' },
            { label: "Kennen - Heart of the Tempest (Signature)", id: 'rb-vendetta-197-166-709667' },
            { label: "LeBlanc - Deceiver (Signature)", id: 'rb-unleashed-235-219-685609' },
            { label: "Soraka - Wanderer (Signature)", id: 'rb-spiritforged-239-221' },
            { label: "Ahri - Inquisitive (Overnumbered)", id: 'rb-spiritforged-227-221' },
        ],
        title: {
            th: "การ์ด Riftbound ใบไหนแพงที่สุด และเช็คราคายังไง | CardStreet",
            en: "The Most Valuable Riftbound Cards, and How to Check Prices | CardStreet",
        },
        description: {
            th: "รวมการ์ด Riftbound ที่ราคาสูงที่สุด ทั้งกลุ่ม Showcase Signature และการ์ดพิเศษอย่าง Baron Nashor พร้อมวิธีเช็คราคาตลาดล่าสุดของใบที่ถืออยู่",
            en: "The Riftbound cards sitting at the top of the market — the Showcase Signature group and specials like Baron Nashor — and how to check a live price for the card you hold.",
        },
        h1: {
            th: "การ์ด Riftbound ใบไหนแพงที่สุด",
            en: "The Most Valuable Riftbound Cards",
        },
        body: {
            th: [
                "Riftbound เพิ่งเปิดตัวได้ไม่ถึงปี แต่การ์ดใบท็อปของเกมขึ้นไปถึงหลักหมื่นบาทแล้ว และเกือบทั้งหมดมาจากกลุ่ม Showcase โดยเฉพาะเวอร์ชัน Signature",
                "ใบที่อยู่บนสุดของตลาดตอนนี้คือ Akali - Rogue Assassin เวอร์ชัน Signature จากชุด Vendetta ตามด้วย Baron Nashor เวอร์ชัน Ultimate จากชุด Unleashed ซึ่งเป็นการ์ดที่นักสะสมพูดถึงมากที่สุดใบหนึ่งตั้งแต่ชุดออก",
                "กลุ่ม Signature ของแชมเปียนดังก็ยืนราคาสูงทั้งแถบ ทั้ง Diana - Scorn of the Moon, Zed - Master of Shadows, Jayce - Defender of Tomorrow, Kennen - Heart of the Tempest และ LeBlanc - Deceiver",
                "ในชุด Spiritforged ก็มี Soraka - Wanderer เวอร์ชัน Signature และ Ahri - Inquisitive แบบ Overnumbered ที่เป็นเป้าหมายของคนไล่เก็บ",
                "สิ่งที่ต้องเข้าใจกับเกมที่ยังใหม่คือ ราคายังไม่นิ่ง การ์ดที่แพงที่สุดวันนี้อาจไม่ใช่ใบเดิมในอีกหกเดือน เพราะชุดใหม่ออกถี่และผลการแข่งเปลี่ยนความต้องการได้เร็ว บทความที่ใส่ตัวเลขไว้จึงล้าสมัยเร็วเป็นพิเศษในเกมนี้",
                "วิธีที่ใช้ได้จริงคือเปิดหน้าการ์ดใบนั้นแล้วดูราคาตลาดล่าสุดพร้อมกราฟย้อนหลัง เพื่อดูว่ากำลังขึ้นหรือลง ไม่ใช่ดูแค่ตัวเลขวันนี้",
                "ข้อได้เปรียบของ Riftbound คือแคตตาล็อกยังเล็กพอที่จะมีราคาครบทุกใบ การ์ด Riftbound ทุกใบใน CardStreet มีราคาตลาดให้เช็ค ไม่มีใบไหนที่ต้องเดา",
            ],
            en: [
                "Riftbound is less than a year old, yet its top cards already reach the tens of thousands of baht, and almost all of them come from the Showcase group — particularly the Signature versions.",
                "At the top of the market right now is Akali - Rogue Assassin in its Signature version from Vendetta, followed by Baron Nashor in the Ultimate treatment from Unleashed, one of the most talked-about cards since the set landed.",
                "The Signature versions of popular champions hold strong prices across the board: Diana - Scorn of the Moon, Zed - Master of Shadows, Jayce - Defender of Tomorrow, Kennen - Heart of the Tempest and LeBlanc - Deceiver.",
                "Spiritforged contributes Soraka - Wanderer in Signature and the Overnumbered Ahri - Inquisitive, both of which collectors chase.",
                "The thing to understand about a young game is that prices have not settled. The most expensive card today may not be the same one in six months, because sets arrive frequently and competitive results move demand quickly. Articles with numbers in them go stale unusually fast here.",
                "The method that works is to open the card page and read the current market price alongside the history chart, so you can see whether it is climbing or falling rather than just what it costs today.",
                "Riftbound's advantage is that the catalog is still small enough to be priced completely. Every Riftbound card on CardStreet has a market price to check — none of them require guesswork.",
            ],
        },
    },
    {
        slug: 'old-pokemon-cards-worth-money-thai',
        game: 'pokemon',
        updated: '2026-09-01',
        title: {
            th: 'การ์ดโปเกมอนเก่าที่บ้าน มีค่าไหม — เช็คยังไงให้รู้จริง | CardStreet',
            en: 'Are Old Pokémon Cards Worth Money? How to Actually Check | CardStreet',
        },
        description: {
            th: 'เจอกล่องการ์ดโปเกมอนเก่าที่บ้าน แล้วมีค่าไหม ดูตัวเลขจริงจากแคตตาล็อกกว่า 7,700 ใบของชุดก่อนปี 2012 ว่าราคาอยู่ตรงไหน และวิธีเช็คทีละใบด้วยตัวเอง',
            en: 'Found a box of old Pokémon cards? Here are the real numbers from 7,700+ priced cards in pre-2012 sets, what they actually sell for, and how to check yours one by one.',
        },
        h1: {
            th: 'การ์ดโปเกมอนเก่าที่บ้าน มีค่าไหม',
            en: 'Are your old Pokémon cards worth anything?',
        },
        body: {
            th: [
                'คำถามนี้มักเจอคำตอบสองแบบบนอินเทอร์เน็ตไทย แบบแรกคือพาดหัวว่าการ์ดใบหนึ่งขายได้ห้าร้อยกว่าล้านบาท แบบที่สองคือคนบอกว่าการ์ดเก่าไม่มีราคาหรอก ทั้งสองแบบไม่ช่วยคนที่กำลังถือกล่องการ์ดอยู่จริง ๆ',
                'ตัวเลขจริงเป็นแบบนี้ จากการ์ดโปเกมอนในชุดที่ออกก่อนปี 2012 ที่มีราคาตลาดบน CardStreet ทั้งหมด 7,744 ใบ ราคากลางอยู่ที่ประมาณ 185 บาทต่อใบ ประมาณ 27 เปอร์เซ็นต์อยู่ต่ำกว่า 50 บาท อีกราว 24 เปอร์เซ็นต์อยู่ระหว่าง 50 ถึง 200 บาท ราว 25 เปอร์เซ็นต์อยู่ระหว่าง 200 ถึง 1,000 บาท และอีกประมาณ 23 เปอร์เซ็นต์อยู่เหนือ 1,000 บาทขึ้นไป',
                'พูดง่าย ๆ คือ ประมาณหนึ่งในสี่ของการ์ดยุคเก่ามีราคาเกินพันบาท นั่นแปลว่าการ์ดเก่าคุ้มที่จะเช็คจริง ๆ ไม่ใช่ของไร้ค่าอย่างที่หลายคนคิด แต่ก็ไม่ได้แปลว่าคุณถือใบที่เป็นข่าวอยู่ ใบที่แพงระดับพาดหัวข่าวคือหนึ่งในหลายล้านใบทั่วโลก',
                'เทียบให้เห็นภาพชัดขึ้น ถ้าดูทั้งแคตตาล็อกรวมการ์ดยุคใหม่ด้วย จะมีถึง 59 เปอร์เซ็นต์ที่ราคาต่ำกว่า 50 บาท ความต่างระหว่างสองตัวเลขนี้คืออายุของการ์ด ของเก่าที่รอดมาถึงวันนี้เหลือน้อยกว่า ราคาจึงสูงกว่าโดยเฉลี่ย',
                'เช็คยังไง',
                'อย่าเริ่มจากการค้นชื่อโปเกมอนอย่างเดียว เพราะโปเกมอนตัวเดียวกันถูกพิมพ์ซ้ำมาแล้วหลายสิบครั้งข้ามหลายชุด ราคาห่างกันได้เป็นร้อยเท่า สิ่งที่ต้องดูคือมุมล่างของการ์ด ตรงนั้นมีเลขการ์ดกับรหัสชุดอยู่ เช่น 4/102 คือใบที่สี่จากชุดที่มี 102 ใบ ใช้สองอย่างนี้ค้นหาจึงจะเจอใบที่ถูกต้อง',
                'ถ้าไม่อยากพิมพ์ทีละใบ เปิดกล้องในแอป CardStreet แล้วส่องการ์ดได้เลย ระบบจะอ่านรหัสชุดกับเลขการ์ดให้เอง แล้วบอกราคาตลาดเป็นเงินบาททันที ใช้ได้กับการ์ดภาษาไทย ญี่ปุ่น และอังกฤษ',
                'สภาพสำคัญกว่าที่คิด',
                'ราคาที่เห็นบนหน้าการ์ดคือราคาของใบที่สภาพดี การ์ดที่มุมขาว ขอบมีรอย หรือผิวเป็นรอยขีด จะขายได้ต่ำกว่านั้นพอสมควร ก่อนตั้งราคาให้ส่องขอบและมุมทั้งสี่ในแสงธรรมชาติ แล้วประเมินตามจริง คนซื้อการ์ดเก่าดูจุดพวกนี้เป็นอย่างแรก',
                'การ์ดที่เก็บไว้ในกล่องปิดและไม่โดนแดดมักอยู่ในสภาพดีกว่าที่เจ้าของคิด ส่วนการ์ดที่เคยเก็บในแฟ้มพลาสติกเก่าหรือโดนความชื้นมักแย่กว่าที่คิด',
                'ถ้าเช็คแล้วอยากขายต่อ ลงขายบน CardStreet ได้เลย ราคาตลาดที่แสดงอยู่ใช้เป็นตัวตั้งได้ทันที และคนซื้อก็เห็นตัวเลขเดียวกัน จึงคุยกันบนพื้นฐานเดียวกันตั้งแต่ต้น',
            ],
            en: [
                'Search this in Thai and you get two kinds of answer. One is a headline about a single card selling for hundreds of millions of baht. The other is someone insisting old cards are worthless. Neither helps the person actually holding a box.',
                'Here are the real numbers. Across every pre-2012 Pokémon set in the CardStreet catalog — 7,744 cards with a market price — the median card is about THB 185. Roughly 27% sit under THB 50, about 24% fall between THB 50 and 200, about 25% between THB 200 and 1,000, and roughly 23% are above THB 1,000.',
                'Put plainly: about one in four older cards is worth more than a thousand baht. Old cards are genuinely worth checking rather than throwing out — but that does not mean you are holding the card from the news. Those are one in many millions worldwide.',
                'For contrast, across the whole catalog including modern sets, 59% of cards sit under THB 50. The difference between those two figures is age: fewer old cards survived, so what remains is worth more on average.',
                'How to check',
                'Do not search by the Pokémon name alone. The same Pokémon has been printed dozens of times across different sets, and prices between those printings can differ a hundredfold. Look at the bottom of the card for the collector number and set code — something like 4/102, meaning card four of a 102-card set. Those two things find the right card.',
                'If you would rather not type each one, open the camera in the CardStreet app and point it at the card. It reads the set code and number itself and shows the market price in Thai baht. It works on Thai, Japanese and English cards.',
                'Condition matters more than people expect',
                'The price shown on a card page is for a card in good condition. Whitened corners, edge wear or surface scratches sell for meaningfully less. Before pricing anything, check the edges and all four corners in natural light and be honest about what you see — it is the first thing a buyer of old cards looks at.',
                'Cards kept in a closed box away from sunlight are usually in better shape than their owner expects. Cards that lived in an old plastic folder or somewhere humid are usually worse.',
                'If you decide to sell after checking, you can list on CardStreet directly. The displayed market price gives you a starting figure, and buyers see the same number, so both sides start from the same place.',
            ],
        },
        faqs: [
            {
                q: { th: 'การ์ดโปเกมอนปี 2000 กว่า ๆ ขายได้ราคาไหม?', en: 'Are Pokémon cards from the 2000s worth selling?' },
                a: {
                    th: 'ส่วนใหญ่ได้ราคามากกว่าที่เจ้าของคาด จากข้อมูลบน CardStreet การ์ดในชุดก่อนปี 2012 มีราคากลางราว 185 บาทต่อใบ และประมาณหนึ่งในสี่มีราคาเกิน 1,000 บาท แต่ต้องเช็คทีละใบ เพราะในกองเดียวกันมีทั้งใบที่ราคาไม่ถึงห้าสิบบาทและใบที่เกินหลักพัน',
                    en: 'Usually more than their owner expects. In the CardStreet catalog, pre-2012 sets have a median of about THB 185 per card and roughly a quarter are above THB 1,000. But you have to check card by card — the same box will hold cards worth under fifty baht and cards worth thousands.',
                },
            },
            {
                q: { th: 'ต้องส่งเกรดก่อนขายไหม?', en: 'Should I get cards graded before selling?' },
                a: {
                    th: 'ไม่จำเป็นสำหรับการ์ดส่วนใหญ่ ค่าส่งเกรดต่อใบมักสูงกว่ามูลค่าของการ์ดทั่วไป การส่งเกรดคุ้มเมื่อการ์ดมีราคาสูงอยู่แล้วและสภาพดีมากจริง ๆ ดูรายละเอียดได้ในหน้าราคาการ์ดเกรด',
                    en: 'Not for most cards. Grading costs per card usually exceed what an ordinary card is worth. It pays off when a card is already valuable and genuinely in excellent condition — the graded prices page covers the details.',
                },
            },
            {
                q: { th: 'การ์ดที่มุมขาวนิดหน่อย ยังขายได้ไหม?', en: 'Can I still sell cards with slightly white corners?' },
                a: {
                    th: 'ขายได้ แต่ควรระบุสภาพให้ตรงและถ่ายรูปมุมทั้งสี่ให้เห็นชัด ผู้ซื้อการ์ดเก่าส่วนใหญ่รับสภาพที่ไม่สมบูรณ์ได้ถ้ารู้ล่วงหน้า สิ่งที่ทำให้ขายไม่ได้คือการบอกสภาพเกินจริงแล้วผู้ซื้อเจอของไม่ตรงปก',
                    en: 'Yes, but state the condition accurately and photograph all four corners clearly. Most buyers of older cards accept imperfect condition when they know in advance. What kills a sale is overstating condition and the buyer receiving something that does not match.',
                },
            },
        ],
    },
    {
        slug: 'where-to-sell-pokemon-cards-thailand',
        game: 'pokemon',
        updated: '2026-09-01',
        title: {
            th: 'ขายการ์ดโปเกมอนที่ไหนดี — เทียบทุกช่องทางในไทย | CardStreet',
            en: 'Where to Sell Pokémon Cards in Thailand — Every Option Compared | CardStreet',
        },
        description: {
            th: 'เทียบช่องทางขายการ์ดโปเกมอนในไทยแบบตรงไปตรงมา ทั้งกลุ่ม Facebook ร้านรับซื้อ มาร์เก็ตเพลส และ CardStreet ว่าแต่ละทางได้ราคาเท่าไหร่ เร็วแค่ไหน และเสี่ยงตรงไหน',
            en: 'An honest comparison of every way to sell Pokémon cards in Thailand — Facebook groups, shops that buy, general marketplaces and CardStreet — what each pays, how fast, and where the risk sits.',
        },
        h1: {
            th: 'ขายการ์ดโปเกมอนที่ไหนดีในไทย',
            en: 'Where to sell Pokémon cards in Thailand',
        },
        body: {
            th: [
                'คนขายการ์ดในไทยมีอยู่สี่ทางหลัก แต่ละทางแลกกันคนละอย่างระหว่างราคาที่ได้ ความเร็ว และความยุ่งยาก ไม่มีทางไหนดีที่สุดสำหรับทุกคน ขึ้นอยู่กับว่ากำลังขายอะไรและรีบแค่ไหน',
                'ร้านรับซื้อ ได้เงินเร็วที่สุดแต่ราคาต่ำที่สุด',
                'ร้านที่รับซื้อการ์ดต้องเอาไปขายต่อ จึงรับซื้อในราคาต่ำกว่าราคาตลาดพอสมควร ข้อดีคือจบในวันเดียว ได้เงินสด ไม่ต้องแพ็คของ ไม่ต้องคุยกับใครหลายคน เหมาะกับคนที่อยากปล่อยทั้งกองแล้วจบ ๆ ไป หรือการ์ดที่มูลค่าไม่สูงพอจะคุ้มกับการนั่งลงขายทีละใบ',
                'กลุ่มซื้อขายใน Facebook ราคาดีแต่ต้องทำเองทุกอย่าง',
                'ไม่มีค่าธรรมเนียม จึงได้ราคาเต็มที่สุด แลกมาด้วยการต้องโพสต์เอง ตอบแชทเอง ต่อราคาเอง แพ็คเอง และรับความเสี่ยงเรื่องการโอนเงินเอง คนที่ขายประจำและมีชื่อเสียงในกลุ่มอยู่แล้วมักได้ผลดี ส่วนคนใหม่ที่ยังไม่มีใครรู้จักมักขายยากกว่าที่คิด เพราะผู้ซื้อระวังตัว',
                'มาร์เก็ตเพลสทั่วไป คนเห็นเยอะแต่ไม่ได้ทำมาเพื่อการ์ด',
                'ข้อดีคือมีคนเข้าเยอะและมีระบบคืนเงิน ข้อเสียคือระบบไม่เข้าใจการ์ด ไม่มีการแยกสภาพ ไม่มีราคาตลาดอ้างอิง และการ์ดของคุณไปอยู่ปนกับสินค้าอีกล้านอย่าง คนที่ตั้งใจหาการ์ดใบนั้นจริง ๆ อาจไม่เจอ',
                'CardStreet ตรงกลางระหว่างราคากับความปลอดภัย',
                'ลงขายฟรี ตั้งราคาเองโดยดูราคาตลาดที่แสดงอยู่เป็นตัวตั้ง คนซื้อเห็นตัวเลขเดียวกันจึงไม่ต้องเถียงกันว่าราคาควรเป็นเท่าไหร่ ผู้ขายยืนยันตัวตน ชำระเงินผ่านระบบที่ปลอดภัย และจัดส่งผ่าน Flash Express พร้อมเลขติดตาม รายละเอียดค่าธรรมเนียมและรอบโอนเงินอยู่ในหน้าขายการ์ด',
                'เลือกยังไง',
                'ถ้าการ์ดทั้งกองรวมกันไม่ถึงหลักพัน ขายเหมาให้ร้านมักคุ้มเวลาที่สุด ถ้ามีใบที่ราคาหลักร้อยขึ้นไปหลายใบ การลงขายทีละใบมักได้เงินรวมมากกว่าอย่างชัดเจน และถ้ามีใบที่ราคาหลักพันขึ้นไป ควรขายผ่านช่องทางที่มีระบบคุ้มครองทั้งสองฝ่าย เพราะความเสี่ยงต่อครั้งสูงพอที่จะคุ้มกับค่าธรรมเนียม',
                'ไม่ว่าจะเลือกทางไหน เช็คราคาตลาดก่อนเสมอ คนที่รู้ราคากลางของการ์ดตัวเองต่อรองได้ดีกว่าคนที่ไม่รู้เสมอ และการรู้ราคาก็ฟรี',
            ],
            en: [
                'There are four main ways to sell cards in Thailand, and each trades something different between price, speed and effort. None is best for everyone — it depends on what you are selling and how quickly you want it gone.',
                'Shops that buy: fastest money, lowest price',
                'A shop buying your cards has to resell them, so it buys well below market. In exchange you are done the same day, in cash, with no packing and no negotiating with strangers. It suits someone who wants a whole box gone, or cards not valuable enough to justify listing individually.',
                'Facebook groups: best price, all the work',
                'No fees, so you keep the most — in exchange for posting, answering messages, haggling, packing and carrying the transfer risk yourself. Regular sellers with a reputation in the group do well. Newcomers often find it harder than expected, because buyers are cautious about people they do not know.',
                'General marketplaces: lots of traffic, not built for cards',
                'Plenty of eyeballs and a refund system. But the platform does not understand cards — no condition grading, no reference price, and your card sits among a million unrelated products, so the person actually hunting that card may never find it.',
                'CardStreet: between price and safety',
                'Listing is free, and you set your own price with the displayed market price as a starting point. Buyers see the same number, so nobody argues about what it should cost. Sellers are identity-verified, payment goes through secure checkout, and orders ship via Flash Express with tracking. Fees and payout timing are on the selling page.',
                'How to choose',
                'If the whole pile is worth under a few thousand baht, selling it to a shop in one go is usually the best use of your time. If you have several cards in the hundreds, listing individually usually nets clearly more. And if you have anything in the thousands, sell it somewhere both sides are protected — the per-transaction risk is high enough to justify a fee.',
                'Whichever you choose, check the market price first. Someone who knows what their card is worth negotiates better than someone who does not, every time — and checking costs nothing.',
            ],
        },
        faqs: [
            {
                q: { th: 'ขายให้ร้านกับลงขายเอง ต่างกันเท่าไหร่?', en: 'How much less does a shop pay than selling it yourself?' },
                a: {
                    th: 'ต่างกันตามร้านและตามการ์ด ร้านต้องเหลือกำไรตอนขายต่อ จึงรับซื้อต่ำกว่าราคาตลาดเสมอ วิธีที่ตรงที่สุดคือเช็คราคาตลาดของใบที่จะขายก่อน แล้วเอาตัวเลขที่ร้านเสนอมาเทียบ จะเห็นส่วนต่างชัดเจนและตัดสินใจได้ว่าคุ้มกับเวลาที่ประหยัดไปไหม',
                    en: 'It varies by shop and by card — a shop has to leave room for its own margin, so it always buys under market. The clearest approach is to check the market price of what you are selling first, then compare the offer against it. That makes the gap visible and lets you judge whether it is worth the time it saves.',
                },
            },
            {
                q: { th: 'ลงขายบน CardStreet เสียค่าอะไรบ้าง?', en: 'What does it cost to list on CardStreet?' },
                a: {
                    th: 'ลงขายฟรี ไม่มีค่าลงประกาศ ค่าธรรมเนียมจะคิดเมื่อขายได้แล้วเท่านั้น รายละเอียดอัตราและรอบการโอนเงินอยู่ในหน้าขายการ์ด',
                    en: 'Listing is free — there is no fee to post. A fee applies only when a card actually sells. The rates and payout timing are set out on the selling page.',
                },
            },
            {
                q: { th: 'ขายการ์ดต้องเป็นร้านหรือจดทะเบียนไหม?', en: 'Do I need to be a registered shop to sell?' },
                a: {
                    th: 'ไม่ต้อง คนทั่วไปที่มีการ์ดอยู่ที่บ้านก็ลงขายได้ ขั้นตอนคือสมัครเป็นผู้ขายและยืนยันตัวตนก่อน จากนั้นจึงลงการ์ดขายได้',
                    en: 'No. Anyone with cards at home can list them. You register as a seller and verify your identity first, then you can list.',
                },
            },
        ],
    },
    {
        slug: 'sell-bulk-pokemon-cards-thailand',
        game: 'pokemon',
        updated: '2026-09-01',
        title: {
            th: 'ขายการ์ดโปเกมอนยกกอง เหมาทั้งกล่อง คุ้มไหม | CardStreet',
            en: 'Selling Pokémon Cards in Bulk in Thailand — Is It Worth It? | CardStreet',
        },
        description: {
            th: 'มีการ์ดโปเกมอนเป็นกองใหญ่แต่ไม่รู้จะเริ่มตรงไหน วิธีคัดว่าใบไหนควรลงขายแยกและใบไหนควรขายเหมา พร้อมตัวเลขจริงว่าการ์ดส่วนใหญ่ในตลาดราคาเท่าไหร่',
            en: 'A big pile of Pokémon cards and no idea where to start? How to split what is worth listing individually from what should go as a lot, with real numbers on what most cards are actually worth.',
        },
        h1: {
            th: 'ขายการ์ดโปเกมอนยกกอง คุ้มไหม',
            en: 'Selling Pokémon cards in bulk',
        },
        body: {
            th: [
                'คนที่เพิ่งรื้อกล่องการ์ดเจอปัญหาเดียวกันเกือบทุกคน คือมีการ์ดหลายร้อยใบ ไม่รู้ว่าใบไหนมีค่า และไม่อยากนั่งเช็คทีละใบเป็นวัน ๆ ทางออกไม่ใช่เลือกอย่างใดอย่างหนึ่ง แต่คือแบ่งกองให้ถูก',
                'ทำไมต้องแบ่ง',
                'จากข้อมูลราคาบน CardStreet ทั้งแคตตาล็อกโปเกมอน ประมาณ 59 เปอร์เซ็นต์ของการ์ดมีราคาต่ำกว่า 50 บาท แปลว่าเกินครึ่งของกองที่คุณถืออยู่แทบไม่คุ้มค่าเวลาที่ใช้ถ่ายรูปและลงขายทีละใบ แต่ในกองเดียวกันนั้นก็มักมีอยู่ไม่กี่ใบที่ราคาสูงพอจะเปลี่ยนยอดรวมทั้งหมด',
                'เป้าหมายจึงเป็นการหาไม่กี่ใบนั้นให้เจอ แล้วปล่อยที่เหลือแบบเหมา',
                'คัดยังไงให้เร็ว',
                'ไล่ดูสามอย่างก่อน หนึ่งคือการ์ดที่มีพื้นผิวมันวาวหรือลายฟอยล์ สองคือการ์ดที่มีข้อความพิเศษต่อท้ายชื่อ เช่น ex GX V หรือ VMAX สามคือการ์ดที่ภาพกินเต็มใบไม่มีกรอบ สามกลุ่มนี้คือที่ที่มูลค่ากระจุกอยู่เกือบทั้งหมด การ์ดธรรมดาที่ไม่เข้าสามข้อนี้ส่วนใหญ่อยู่ในกลุ่มต่ำกว่า 50 บาท',
                'พอคัดออกมาได้แล้ว ค่อยเช็คราคาเฉพาะกองที่คัดไว้ จะใช้เวลาน้อยลงมาก ใช้กล้องในแอปสแกนทีละใบก็ได้ หรือค้นจากเลขการ์ดที่มุมล่างก็ได้',
                'ที่เหลือทำยังไง',
                'การ์ดกลุ่มที่ราคาต่ำมีสองทางหลัก ทางแรกคือขายเหมาให้ร้านหรือให้คนที่รับซื้อยกกอง ได้เงินไม่มากแต่จบเร็ว ทางที่สองคือรวมเป็นชุดที่มีธีมแล้วขายเป็นล็อต เช่น รวมเฉพาะโปเกมอนสายไฟ หรือรวมเฉพาะชุดเดียวกัน วิธีหลังมักได้ราคาดีกว่าการเทรวมมั่ว ๆ เพราะคนซื้อรู้ว่ากำลังซื้ออะไร',
                'สิ่งที่ไม่ควรทำคือทิ้ง การ์ดที่ราคาต่ำต่อใบยังมีคนรับซื้อเป็นกองอยู่เสมอ โดยเฉพาะคนที่เพิ่งเริ่มเล่นและอยากได้การ์ดจำนวนมากในราคาถูก',
                'ถ้าคัดแล้วเจอใบที่ราคาหลักร้อยขึ้นไป ใบพวกนั้นควรลงขายแยกเสมอ ส่วนต่างระหว่างการขายแยกกับการเทรวมไปในกองเหมามักมากกว่าค่าเวลาที่ใช้ไปหลายเท่า',
            ],
            en: [
                'Everyone who digs out an old box hits the same problem: hundreds of cards, no idea which matter, and no appetite for checking each one for a day. The answer is not to pick one approach — it is to split the pile correctly.',
                'Why split at all',
                'Across the whole Pokémon catalog on CardStreet, about 59% of cards are priced under THB 50. So more than half of what you are holding is not worth the time it takes to photograph and list individually. But that same pile usually contains a handful of cards valuable enough to change the total on their own.',
                'The job is to find those few, and move the rest as a lot.',
                'How to sort quickly',
                'Look for three things first. Cards with a shiny or foil surface. Cards with something appended to the name — ex, GX, V or VMAX. And cards where the artwork fills the whole card with no border. Almost all of the value sits in those three groups. Ordinary cards matching none of them mostly land in the under-THB-50 band.',
                'Once you have pulled those out, only check prices on that smaller pile. Scan them with the camera in the app, or search the collector number from the bottom of the card.',
                'What to do with the rest',
                'Low-value cards have two sensible routes. Sell the lot to a shop or a bulk buyer — less money, but done quickly. Or group them into themed lots, all one type or all one set, and sell those. The second usually pays better than an unsorted heap, because the buyer can see what they are getting.',
                'What you should not do is throw them away. There is always demand for cheap cards in quantity, especially from people just starting who want a lot of cards for very little.',
                'And anything you pull out worth a few hundred baht or more should be listed on its own. The gap between listing it individually and burying it in a bulk lot is usually many times the time it costs you.',
            ],
        },
        faqs: [
            {
                q: { th: 'การ์ดธรรมดาเป็นร้อยใบ ขายได้เท่าไหร่?', en: 'What is a few hundred ordinary cards worth?' },
                a: {
                    th: 'ขายเป็นกองมักได้ราคาต่อใบต่ำมาก เพราะการ์ดกลุ่มนี้มีอยู่ทั่วไป จากข้อมูลบน CardStreet ประมาณ 59 เปอร์เซ็นต์ของการ์ดโปเกมอนทั้งแคตตาล็อกราคาต่ำกว่า 50 บาทต่อใบอยู่แล้ว มูลค่ารวมจริง ๆ ของกองมักมาจากไม่กี่ใบที่คัดออกมาได้ ไม่ใช่จากจำนวนใบ',
                    en: 'Sold as a heap, very little per card — these are common by definition. About 59% of Pokémon cards in the CardStreet catalog are already under THB 50 each. The real value of a pile almost always comes from the few cards you pull out of it, not from the count.',
                },
            },
            {
                q: { th: 'ต้องแยกการ์ดตามชุดก่อนขายไหม?', en: 'Should I sort by set before selling?' },
                a: {
                    th: 'ช่วยได้ถ้าจะขายเป็นล็อต เพราะล็อตที่มาจากชุดเดียวกันหรือธีมเดียวกันขายง่ายกว่าและได้ราคาดีกว่ากองที่คละมั่ว แต่ถ้าจะขายเหมาให้ร้านไปเลย ไม่ต้องเสียเวลาแยก ร้านคัดเองอยู่แล้ว',
                    en: 'It helps if you are selling in lots — a lot from one set or with one theme sells faster and for more than an unsorted mix. If you are selling the whole thing to a shop, do not bother; they will sort it themselves.',
                },
            },
        ],
    },
    {
        slug: 'pokemon-cards-that-dont-sell',
        game: 'pokemon',
        updated: '2026-09-01',
        title: {
            th: 'การ์ดโปเกมอนแบบไหนขายยาก — รู้ก่อนจะได้ไม่เสียเวลา | CardStreet',
            en: 'Which Pokémon Cards Are Hard to Sell — Know Before You List | CardStreet',
        },
        description: {
            th: 'ไม่ใช่การ์ดทุกใบจะขายออก รู้ว่าการ์ดแบบไหนขายยากและเพราะอะไร จะได้ตั้งราคาให้ถูกและไม่เสียเวลาลงขายใบที่ไม่มีคนหา',
            en: 'Not every card sells. Which Pokémon cards are hard to move and why — so you price realistically and do not waste time listing cards nobody is looking for.',
        },
        h1: {
            th: 'การ์ดโปเกมอนแบบไหนที่ขายยาก',
            en: 'Which Pokémon cards are hard to sell',
        },
        body: {
            th: [
                'บทความเรื่องขายการ์ดส่วนใหญ่บอกแต่ว่าใบไหนแพง น้อยคนที่บอกว่าใบไหนขายไม่ออก ซึ่งเป็นข้อมูลที่มีประโยชน์พอกัน เพราะช่วยให้ไม่เสียเวลาถ่ายรูปและลงขายใบที่ไม่มีใครตามหา',
                'การ์ดพลังงานและการ์ดไอเทมทั่วไป',
                'การ์ดกลุ่มนี้ถูกพิมพ์ซ้ำแทบทุกชุดและมีอยู่ในกล่องของทุกคน ราคาต่อใบจึงต่ำมากและแทบไม่มีใครค้นหาเป็นรายใบ ถ้าจะขายควรรวมเป็นชุดไปเลย ไม่ใช่ลงทีละใบ',
                'การ์ดธรรมดาจากชุดใหม่ที่เพิ่งออก',
                'ชุดที่เพิ่งวางขายมีของอยู่ในตลาดเยอะที่สุด การ์ดธรรมดาจากชุดนั้นจึงหาได้ง่ายมากและราคาต่ำ คนที่อยากได้มักได้จากการเปิดซองเองอยู่แล้ว รอสักระยะจนของในตลาดน้อยลงมักขายง่ายกว่า',
                'การ์ดสภาพไม่ดีที่ตั้งราคาเท่าของสภาพดี',
                'นี่คือสาเหตุที่พบบ่อยที่สุดของการ์ดที่ลงขายแล้วไม่มีคนซื้อ ราคาที่แสดงบนหน้าการ์ดคือราคาของใบสภาพดี ถ้าการ์ดมุมขาวหรือมีรอยแล้วตั้งราคาเท่ากัน ผู้ซื้อที่เทียบราคาเป็นจะข้ามไปหาใบอื่น ทางแก้ไม่ใช่ซ่อนสภาพ แต่คือลดราคาลงให้สมเหตุสมผลและถ่ายรูปให้ตรงจริง',
                'การ์ดที่ตั้งราคาสูงกว่าราคาตลาดมาก',
                'ผู้ซื้อบน CardStreet เห็นราคาตลาดของการ์ดใบนั้นอยู่ข้าง ๆ รายการขายเสมอ การตั้งราคาสูงกว่ามากจึงเห็นได้ทันทีและมักถูกข้ามไป ถ้าเชื่อว่าการ์ดใบนั้นควรได้มากกว่าราคากลาง เช่น เพราะสภาพดีเป็นพิเศษ ควรอธิบายไว้ในรายละเอียดให้ผู้ซื้อเข้าใจ',
                'การ์ดปลอมและการ์ดที่ไม่ใช่ของลิขสิทธิ์',
                'การ์ดแปลไทยที่ไม่ใช่ของทางการ การ์ดที่พิมพ์เอง และของปลอม ขายบนแพลตฟอร์มที่ตรวจสอบผู้ขายไม่ได้ และถึงขายได้ก็มักจบด้วยการถูกคืนของ ถ้าไม่แน่ใจว่าการ์ดในมือแท้หรือไม่ ให้เทียบกับใบแท้ที่มีอยู่ก่อน',
                'แล้วอะไรที่ขายง่าย',
                'ตรงข้ามกับทั้งหมดข้างบน คือการ์ดที่คนตามหาเป็นรายใบ สภาพตรงกับที่ระบุ รูปถ่ายจริงชัดทุกมุม และราคาอยู่ใกล้ราคาตลาด สามอย่างหลังคุณควบคุมได้ทั้งหมด ซึ่งเป็นเหตุผลว่าทำไมผู้ขายสองคนที่มีการ์ดใบเดียวกันจึงขายได้ไม่เท่ากัน',
            ],
            en: [
                'Most articles about selling cards tell you which ones are expensive. Few tell you which ones will not move, which is just as useful — it saves you photographing and listing cards nobody is searching for.',
                'Energy cards and ordinary trainer items',
                'These are reprinted in nearly every set and sit in everyone\'s box. Per-card value is very low and almost nobody searches for them individually. If you sell them, sell them as a group rather than one at a time.',
                'Common cards from a brand-new set',
                'A set that just launched has the most product in circulation, so its commons are easy to find and cheap. Anyone who wants one probably pulled it themselves. Waiting until supply thins usually makes them easier to sell.',
                'Damaged cards priced like clean ones',
                'This is the single most common reason a listing sits unsold. The price on a card page is for a card in good condition. Price a card with whitened corners or scratches the same and any buyer who compares will move on. The fix is not to hide the condition — it is to price it honestly and photograph it accurately.',
                'Cards priced well above market',
                'Buyers on CardStreet see the market price next to every listing. A price far above it is immediately visible and usually skipped. If you believe a card deserves more — exceptional condition, say — explain why in the description so the buyer understands what they are paying for.',
                'Counterfeits and unlicensed printings',
                'Unofficial Thai-translated cards, home-printed cards and outright fakes cannot be sold on a platform that verifies its sellers, and where they do sell elsewhere they tend to come back as returns. If you are unsure whether something is genuine, compare it against a card you know is real first.',
                'So what does sell easily',
                'The opposite of all of the above: a card people search for by name, in the condition you said it was, with clear real photographs from every angle, priced near market. You control the last three completely — which is why two sellers holding the same card do not get the same result.',
            ],
        },
        faqs: [
            {
                q: { th: 'ลงขายไปนานแล้วไม่มีคนซื้อ ควรทำยังไง?', en: 'My listing has sat for weeks — what should I do?' },
                a: {
                    th: 'ไล่ดูสามอย่างตามลำดับ หนึ่งคือราคาเทียบกับราคาตลาดที่แสดงอยู่ ห่างกันมากไปไหม สองคือรูปถ่าย เป็นรูปจริงครบทุกมุมหรือยัง สามคือสภาพที่ระบุตรงกับรูปไหม ส่วนใหญ่ปัญหาอยู่ที่ข้อแรก',
                    en: 'Check three things in order. Is the price far from the market price shown beside it? Are the photos real and complete from every angle? Does the stated condition match what the photos show? Most of the time it is the first one.',
                },
            },
            {
                q: { th: 'การ์ดแปลไทยที่ซื้อจากตลาดนัด ขายต่อได้ไหม?', en: 'Can I resell unofficial Thai-translated cards?' },
                a: {
                    th: 'ไม่ได้ การ์ดแปลที่ไม่ใช่ของทางการไม่ใช่สินค้าลิขสิทธิ์และใช้แข่งขันไม่ได้ จึงไม่อยู่ในแคตตาล็อกและลงขายไม่ได้ การ์ดโปเกมอนภาษาไทยที่เป็นของทางการมีจริงและขายได้ปกติ สังเกตได้จากรหัสชุดที่มุมล่างของการ์ด',
                    en: 'No. Unofficial translated cards are not licensed products and are not tournament legal, so they are not in the catalog and cannot be listed. Official Thai-language Pokémon cards do exist and sell normally — you can tell them apart by the set code at the bottom of the card.',
                },
            },
        ],
    },
    {
        slug: 'one-piece-card-prices-thai',
        game: 'onepiece',
        updated: '2026-09-11',
        title: {
            th: 'เช็คราคาการ์ดวันพีชยังไงให้ถูกใบ — คู่มือดูราคาฉบับคนไทย | CardStreet',
            en: 'How to Check One Piece Card Prices in Thailand — The Full Guide | CardStreet',
        },
        h1: {
            th: 'เช็คราคาการ์ดวันพีช ให้ตรงใบที่ถืออยู่',
            en: 'How to check One Piece card prices — and get the right printing',
        },
        description: {
            th: 'วิธีเช็คราคาการ์ดวันพีชให้ตรงใบ ทั้งฉบับอังกฤษและญี่ปุ่น พร้อมข้อมูลจริงจากการ์ด 6,377 ใบในระบบ ว่าการ์ดส่วนใหญ่ราคาเท่าไหร่ และใบแบบไหนที่ราคาขึ้นจริง',
            en: 'How to check One Piece Card Game prices from Thailand, across the English and Japanese printings, with real figures from 6,377 cards — what most cards are actually worth and which ones carry the value.',
        },
        cards: [
            { label: 'Monkey.D.Luffy (OP11-119, SEC alternate art)', id: 'op-op-11-op05-119' },
            { label: 'Roronoa Zoro (PRB-01, manga art)', id: 'op-prb-01-op06-118' },
            { label: 'Marshall.D.Teach (OP12-093, SP Gold)', id: 'op-op-12-op09-093' },
            { label: 'Monkey.D.Dragon (EB-02, SPR)', id: 'op-eb-02-op07-001' },
            { label: 'Nami (PRB-01, manga art)', id: 'op-prb-01-op01-016' },
            { label: 'Portgas.D.Ace (PRB-01, manga art)', id: 'op-prb-01-op02-013' },
        ],
        body: {
            th: [
                'คำถามที่คนถือการ์ดวันพีชถามบ่อยที่สุดคือ "ใบนี้ราคาเท่าไหร่" แต่คำถามที่ต้องตอบให้ได้ก่อนคือ "ใบนี้คือใบไหน" การ์ดวันพีชใบเดียวกันมีได้หลายเวอร์ชัน ทั้งฉบับอังกฤษ ฉบับญี่ปุ่น ใบอาร์ตธรรมดา ใบอาร์ตพิเศษ และใบโปรโม ราคาต่างกันได้หลายสิบเท่า ถ้าเช็คผิดเวอร์ชัน ตัวเลขที่ได้ก็ไม่มีความหมาย',
                'วิธีดูว่าถือใบไหนอยู่ใช้เวลาไม่ถึงนาที ที่มุมล่างของการ์ดจะมีรหัสแบบ OP05-119 หรือ ST01-006 ตัวอักษรข้างหน้าคือชุด ตัวเลขข้างหลังคือเลขใบในชุดนั้น ถ้าอยากรู้ว่ารหัส OP ST EB PRB ต่างกันยังไง เรามีบทความแยกเรื่องรหัสชุดไว้แล้ว ส่วนภาษาให้ดูจากตัวหนังสือบนการ์ดเอง ไม่ต้องเดาจากกล่องที่ซื้อมา',
                'ในระบบของเรามีการ์ดวันพีชอยู่ 6,377 ใบ แบ่งเป็นฉบับภาษาอังกฤษ 3,225 ใบ และฉบับภาษาญี่ปุ่น 3,152 ใบ ทั้งสองฉบับเก็บราคาแยกกันคนละใบ ไม่ได้ใช้ราคาเดียวกันแล้วแปลงค่าเงิน เพราะตลาดของสองฉบับนี้เคลื่อนไหวไม่เหมือนกันจริง ๆ',
                'เรื่องที่หลายคนไม่อยากได้ยินแต่ควรรู้ก่อน คือการ์ดวันพีชส่วนใหญ่ไม่ได้แพง จากการ์ด 6,052 ใบที่มีราคาตลาดในระบบ ค่ากลางอยู่ที่ 42 บาท และ 53.8% ของทั้งหมดอยู่ต่ำกว่า 50 บาท พูดง่าย ๆ คือถ้าเทกองการ์ดออกมาบนโต๊ะ ครึ่งหนึ่งของกองนั้นมูลค่าน้อยกว่าค่ากาแฟหนึ่งแก้ว',
                'แต่อีกด้านหนึ่งก็จริงเหมือนกัน 5.6% ของการ์ดในระบบมีราคาเกิน 1,000 บาท และใบที่อยู่ในกลุ่ม 10% บนสุดเริ่มต้นราว ๆ 269 บาท ประเด็นจึงไม่ใช่ว่ากองการ์ดของคุณมีค่าหรือไม่มีค่า แต่คือคุณหาใบที่เป็น 5.6% นั้นเจอหรือเปล่า',
                'ใบที่ราคาสูงในวันพีชมีรูปแบบชัดเจนกว่าเกมอื่น ถ้าไล่ดูการ์ดที่ราคาสูงที่สุดในระบบ เกือบทั้งหมดอยู่ในสองกลุ่ม กลุ่มแรกคือการ์ดโปรโมฉบับญี่ปุ่นที่แจกในงานแข่งหรือแถมมากับสินค้า กลุ่มที่สองคือใบอาร์ตพิเศษ ทั้ง SEC อาร์ตเต็มใบ ใบ SP ขอบทอง และใบลายมังงะจากชุด PRB ส่วนใบ SR หรือใบผู้นำที่เป็นอาร์ตปกติจากบูสเตอร์ทั่วไป ราคามักไม่ได้ต่างจากใบธรรมดามากอย่างที่หลายคนคิด',
                'ตัวอย่างที่เห็นภาพชัดคือ Monkey.D.Luffy ใบ SEC จากชุด OP-11 กับ Roronoa Zoro ลายมังงะจากชุด PRB-01 สองใบนี้เป็นตัวละครที่ใครก็รู้จัก แต่สิ่งที่ทำให้ราคาต่างจากใบ Luffy หรือ Zoro ใบอื่นในชุดเดียวกันคืออาร์ตและเลขใบ ไม่ใช่ตัวละคร ก่อนจะดีใจว่าได้ Luffy ให้ดูเลขใบก่อนเสมอ',
                'ราคาที่เห็นในแต่ละที่ไม่เท่ากันเป็นเรื่องปกติ และไม่ได้แปลว่าที่ไหนโกง ราคาที่ร้านตั้งขายคือราคาที่ผู้ขายอยากได้ ราคาที่ประกาศในกลุ่มเฟซบุ๊กคือราคาของคนที่อยากขายเร็ว ส่วนราคาตลาดที่เราแสดงคือค่าเฉลี่ยของการซื้อขายที่เกิดขึ้นจริง สามตัวเลขนี้มีประโยชน์คนละแบบ ถ้าจะขาย ให้ใช้ราคาตลาดเป็นฐานแล้วบวกลบตามสภาพการ์ดและความรีบ',
                'สภาพการ์ดเปลี่ยนราคาได้มากกว่าที่คิด ราคาที่เราแสดงเป็นราคาของการ์ดสภาพดีที่ยังไม่ได้ส่งเกรด ถ้าการ์ดมีขอบขาว มุมงอ หรือรอยขีดกลางใบ ราคาจริงจะต่ำกว่านั้น ในทางกลับกัน การ์ดที่ส่งเกรดแล้วได้คะแนนสูงจะมีราคาคนละชุดกันไปเลย ซึ่งเราเก็บแยกไว้ต่างหากและไม่เอามาปนกับราคาปกติ',
                'ราคาการ์ดวันพีชขยับเร็วกว่าเกมอื่นที่เราเก็บข้อมูล เพราะชุดใหม่ออกถี่และมีการ์ดที่ถูกปรับสถานะในสนามแข่งอยู่เรื่อย ๆ ราคาในระบบของเราอัปเดตทุกวัน และมากกว่า 99% ของข้อมูลราคาการ์ดวันพีชถูกรีเฟรชภายใน 30 วันที่ผ่านมา ถ้าเห็นราคาจากบทความที่เขียนไว้เมื่อปีก่อน ให้ถือเป็นแค่ตัวเลขอ้างอิงคร่าว ๆ เท่านั้น',
                'วิธีเช็คที่เร็วที่สุดคือพิมพ์ชื่อการ์ดตามด้วยเลขใบในช่องค้นหา เช่น Luffy OP05-119 ระบบจะค้นทั้งฉบับอังกฤษและญี่ปุ่นพร้อมกัน แล้วเลือกใบที่รหัสตรงกับที่ถืออยู่ ถ้าอ่านชื่อการ์ดไม่ออกเพราะเป็นฉบับญี่ปุ่น เปิดกล้องสแกนได้เลย ระบบจะระบุใบให้เอง',
                'ถ้ามีการ์ดหลายสิบใบและไม่อยากเช็คทีละใบ ให้เริ่มจากคัดเฉพาะใบที่มีโอกาสมีราคา คือใบอาร์ตเต็มใบ ใบขอบทอง ใบลายมังงะ ใบโปรโม และใบผู้นำจากชุดเก่า ที่เหลือค่อยเช็คทีหลังหรือขายรวมเป็นกอง วิธีคัดกองแบบละเอียดเราเขียนไว้ในบทความเรื่องการขายการ์ดยกกอง',
                'สุดท้าย ถ้าเช็คราคาแล้วอยากขายจริง ราคาตลาดคือจุดเริ่มต้นของการตั้งราคา ไม่ใช่ราคาที่จะได้แน่นอน การ์ดที่มีคนตามหาจะขายได้ใกล้ราคาตลาด ส่วนการ์ดที่มีคนขายพร้อมกันเยอะจะต้องตั้งต่ำกว่านั้นถึงจะขายออก เรื่องนี้มีผลกับการ์ดวันพีชเป็นพิเศษ เพราะชุดใหม่ออกเร็วและของใหม่เข้าตลาดตลอดเวลา',
            ],
            en: [
                'The question everyone with a One Piece binder asks is "what is this worth". The question that has to be answered first is "which card is this". The same character exists as an English printing, a Japanese printing, a base art, an alternate art and a promo, and the gap between them runs to dozens of times. Look up the wrong version and the number means nothing.',
                'Identifying the printing takes under a minute. The code in the lower corner — OP05-119, ST01-006 — gives you the set and the number within it. Our separate guide covers what OP, ST, EB and PRB mean. For the language, read the card itself rather than assuming from the box it came in.',
                'We hold 6,377 One Piece cards: 3,225 English and 3,152 Japanese. The two are priced as separate cards, not one price with a currency conversion, because the two markets genuinely move differently.',
                'The part nobody wants to hear first: most One Piece cards are not expensive. Across the 6,052 cards carrying a market price, the median is THB 42 and 53.8% sit under THB 50. Tip a binder onto a table and half of it is worth less than a coffee.',
                'The other half of that is equally true. 5.6% of the catalog is worth over THB 1,000, and the top tenth starts around THB 269. The question is not whether your pile has value — it is whether you can find the 5.6%.',
                'Where the value sits is more predictable in One Piece than in most games. Sort the catalog by price and almost everything at the top falls into two groups: Japanese promos handed out at events or bundled with merchandise, and alternate arts — full-art SECs, gold-bordered SPs, and the manga-art cards from the PRB sets. Standard-art SRs and Leaders pulled from ordinary boosters usually sit far closer to bulk than people expect.',
                "Monkey.D.Luffy's SEC from OP-11 and the manga-art Roronoa Zoro from PRB-01 make the point. Both are characters everyone knows, but what separates them from the other Luffy and Zoro cards in the same set is the art and the number, not the character. Check the card number before celebrating.",
                'Prices differing between places is normal, not evidence that someone is cheating. A shop price is what a seller wants. A Facebook group price is what someone wants for a fast sale. The market price we show is an average of transactions that actually happened. All three are useful for different things; if you are selling, start from the market price and adjust for condition and how quickly you need the money.',
                'Condition moves the number more than people expect. What we display is the price of a good, ungraded copy. Whitened edges, a bent corner or a scratch across the art all sit below it. Graded copies run on an entirely separate scale, which we store separately and never mix into the raw price.',
                'One Piece prices move faster than the other games we track — sets arrive frequently and the competitive list keeps changing. Our figures update daily, and over 99% of One Piece price rows were refreshed within the last 30 days. Treat a price quoted in an article written last year as a rough landmark, nothing more.',
                'The fastest lookup is the card name plus its number — "Luffy OP05-119" — which searches the English and Japanese printings at once. Pick the one whose code matches your card. If you cannot read the name because it is a Japanese printing, use the camera scanner instead.',
                'With dozens of cards, do not check them one at a time. Pull out the ones that could carry value — full arts, gold borders, manga arts, promos and older Leader cards — and check those first; the rest can be sold as a lot. Our bulk-selling guide covers how to split a pile properly.',
                'Finally, if you check a price intending to sell, the market price is where pricing starts, not what you are guaranteed. Cards people are hunting sell near it; cards with many sellers need to sit under it. That matters more in One Piece than elsewhere, because new supply arrives constantly.',
            ],
        },
        faqs: [
            {
                q: { th: 'เช็คราคาการ์ดวันพีชฟรีได้ที่ไหน?', en: 'Where can I check One Piece card prices for free?' },
                a: {
                    th: 'เช็คได้ฟรีบน CardStreet ทั้งฉบับอังกฤษและญี่ปุ่น ครอบคลุมการ์ด 6,377 ใบ ดูราคาได้โดยไม่ต้องสมัครสมาชิก ค้นด้วยชื่อการ์ดพร้อมเลขใบ หรือใช้กล้องสแกน',
                    en: 'Free on CardStreet, covering 6,377 cards across the English and Japanese printings, with no account needed to see a price. Search by name plus card number, or scan the card with your camera.',
                },
            },
            {
                q: { th: 'การ์ดวันพีชส่วนใหญ่ราคาเท่าไหร่?', en: 'What is a typical One Piece card worth?' },
                a: {
                    th: 'ค่ากลางอยู่ที่ประมาณ 42 บาท และ 53.8% ของการ์ดในระบบต่ำกว่า 50 บาท มีเพียง 5.6% ที่เกิน 1,000 บาท (ข้อมูลวันที่ 11 กันยายน 2026)',
                    en: 'The median is around THB 42 and 53.8% of the catalog sits under THB 50. Only 5.6% clears THB 1,000 (measured 2026-09-11).',
                },
            },
            {
                q: { th: 'การ์ดวันพีชใบไหนที่ราคาสูง?', en: 'Which One Piece cards actually carry value?' },
                a: {
                    th: 'การ์ดโปรโมฉบับญี่ปุ่น และใบอาร์ตพิเศษ ทั้ง SEC อาร์ตเต็มใบ ใบ SP ขอบทอง และใบลายมังงะจากชุด PRB ส่วนใบ SR อาร์ตปกติมักไม่ต่างจากใบทั่วไปมากนัก',
                    en: 'Japanese promos and alternate arts — full-art SECs, gold-bordered SPs and PRB manga arts. Standard-art SRs are usually much closer to bulk.',
                },
            },
            {
                q: { th: 'ทำไมราคาการ์ดใบเดียวกันในแต่ละที่ไม่เท่ากัน?', en: 'Why do prices differ between sites?' },
                a: {
                    th: 'ราคาร้านคือราคาที่ผู้ขายตั้ง ราคาในกลุ่มเฟซบุ๊กคือราคาขายเร็ว ส่วนราคาตลาดคือค่าเฉลี่ยจากการซื้อขายที่เกิดขึ้นจริง เป็นคนละตัวเลขที่ใช้คนละแบบ',
                    en: 'A shop price is an asking price, a Facebook price is a quick-sale price, and a market price is an average of completed sales. Three different numbers with three different uses.',
                },
            },
            {
                q: { th: 'ราคาที่แสดงเป็นราคาการ์ดสภาพไหน?', en: 'What condition does the displayed price assume?' },
                a: {
                    th: 'เป็นราคาการ์ดสภาพดีที่ยังไม่ได้ส่งเกรด การ์ดที่มีตำหนิจะต่ำกว่านั้น ส่วนการ์ดที่ส่งเกรดแล้วเราเก็บราคาแยกไว้ต่างหาก',
                    en: 'A good ungraded copy. Damaged cards sit below it; graded copies are stored and shown separately.',
                },
            },
            {
                q: { th: 'ราคาการ์ดวันพีชอัปเดตบ่อยแค่ไหน?', en: 'How often do the prices update?' },
                a: {
                    th: 'อัปเดตทุกวัน ปัจจุบันมากกว่า 99% ของข้อมูลราคาการ์ดวันพีชถูกรีเฟรชภายใน 30 วันล่าสุด',
                    en: 'Daily. As of now, over 99% of One Piece price rows were refreshed within the last 30 days.',
                },
            },
            {
                q: { th: 'มีการ์ดวันพีชฉบับภาษาไทยไหม?', en: 'Is there a Thai-language One Piece printing?' },
                a: {
                    th: 'ไม่มี ต้องเลือกระหว่างฉบับอังกฤษกับญี่ปุ่น รายละเอียดว่าควรเลือกฉบับไหนอยู่ในบทความเปรียบเทียบสองฉบับ',
                    en: 'No — the choice is between English and Japanese. Our English-vs-Japanese guide covers which suits you.',
                },
            },
            {
                q: { th: 'มีการ์ดเยอะมาก ควรเริ่มเช็คใบไหนก่อน?', en: 'I have hundreds of cards — where do I start?' },
                a: {
                    th: 'เริ่มจากใบอาร์ตเต็มใบ ใบขอบทอง ใบลายมังงะ ใบโปรโม และใบผู้นำจากชุดเก่า ที่เหลือขายรวมเป็นกองได้',
                    en: 'Start with full arts, gold borders, manga arts, promos and older Leader cards. The rest can go as a lot.',
                },
            },
        ],
    },
];

/** A guide by slug, or null. */
export function getGuide(slug: string): Guide | null {
    return GUIDES.find((g) => g.slug === slug) ?? null;
}

/** Guides for a game, for the related block and the game landing's link list. */
export function getGuidesForGame(game: GameId): Guide[] {
    return GUIDES.filter((g) => g.game === game);
}
