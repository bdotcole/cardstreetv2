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
}

export const GUIDES: Guide[] = [
    {
        slug: 'lorcana-most-valuable-cards',
        game: 'lorcana',
        updated: '2026-08-30',
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
];

/** A guide by slug, or null. */
export function getGuide(slug: string): Guide | null {
    return GUIDES.find((g) => g.slug === slug) ?? null;
}

/** Guides for a game, for the related block and the game landing's link list. */
export function getGuidesForGame(game: GameId): Guide[] {
    return GUIDES.filter((g) => g.game === game);
}
