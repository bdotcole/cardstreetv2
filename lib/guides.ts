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
];

/** A guide by slug, or null. */
export function getGuide(slug: string): Guide | null {
    return GUIDES.find((g) => g.slug === slug) ?? null;
}

/** Guides for a game, for the related block and the game landing's link list. */
export function getGuidesForGame(game: GameId): Guide[] {
    return GUIDES.filter((g) => g.game === game);
}
