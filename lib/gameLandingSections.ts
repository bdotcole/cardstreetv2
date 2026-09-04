import type { GameId } from '@/lib/games';

// Prose sections for the per-game landing pages, rendered between the intro and
// the Latest-sets grid.
//
// WHY THIS EXISTS
// Measured 2026-09-01: all six landings shared one shape — 3 intro paragraphs
// and 6 FAQs, nothing else — and carried 2,138-3,228 Thai characters across 4
// h2s. Our own /graded page carries 5,074 across 9. So the pages targeting the
// head terms (การ์ดโปเกมอน, การ์ดวันพีช, การ์ดยูกิ, ...) were the SHALLOWEST
// commercial pages on the site, aimed at a bigger prize than the pages built
// out properly. Landing pages carry 82% of organic clicks; this is where depth
// pays.
//
// TWO RULES THAT SHAPED THE COPY
//
// 1. NEVER REPEAT A GUIDE. Each game already has 3-6 long-form guides and the
//    landing already renders a block linking them. A section restating a guide
//    puts our own two pages in competition for one query. So every section
//    below was chosen against THAT GAME'S existing guide coverage, which is why
//    the six games do not get the same three sections:
//      - pokemon has no buy/beginner/scanner guide  -> it gets all three
//      - mtg already has buy-mtg-cards-thailand     -> no "where to buy" here
//      - riftbound already has beginner-guide-thai  -> no "how to start" here
//      - lorcana has six guides incl. buy AND fakes -> only two sections fit
//    Writing the same three sections six times with the nouns swapped would
//    have been faster and worse.
//
// 2. NO HARDCODED SETS, COUNTS OR PRICES. The page already renders a live
//    catalog count and a live Latest-sets grid. lib/setLanding.ts carries the
//    same rule for the same reason: hardcoded numbers rot.
//
// LANGUAGE COVERAGE IS NOT UNIFORM, and the copy respects it (verified against
// the live catalog 2026-09-01): only Pokemon has Thai-language cards. One Piece
// and Yu-Gi-Oh are Japanese + English; MTG, Lorcana and Riftbound are English
// only. No section implies we carry a printing we do not.

export interface LandingSection {
    h2: { th: string; en: string };
    body: { th: string[]; en: string[] };
}

export const LANDING_SECTIONS: Partial<Record<GameId, LandingSection[]>> = {
    pokemon: [
        {
            h2: { th: 'ซื้อการ์ดโปเกมอนที่ไหนดีในไทย', en: 'Where to buy Pokémon cards in Thailand' },
            body: {
                th: [
                    'คนไทยซื้อการ์ดโปเกมอนกันอยู่ไม่กี่ทาง แต่ละทางเหมาะกับคนละแบบ กลุ่มซื้อขายใน Facebook ราคาถูกที่สุดเพราะไม่มีค่าธรรมเนียม แลกมาด้วยการต้องคุยเอง โอนเอง และเชื่อใจคนแปลกหน้าเอง ร้านการ์ดหน้าร้านดีตรงได้เห็นของจริงก่อนจ่าย แต่สต็อกจำกัดอยู่ที่ว่าร้านนั้นรับอะไรมา ส่วนมาร์เก็ตเพลสทั่วไปมีระบบคืนเงิน แต่คนขายไม่ได้ถูกคัดว่าเข้าใจการ์ดจริงไหม เจอการ์ดสภาพไม่ตรงปกได้บ่อย',
                    'CardStreet อยู่ตรงกลางระหว่างสองแบบนั้น ผู้ขายทุกคนยืนยันตัวตนก่อนลงขาย ทุกออเดอร์จ่ายผ่านระบบที่ปลอดภัยและมีการคุ้มครองผู้ซื้อ ส่งทั่วไทยผ่าน Flash Express พร้อมเลขติดตามพัสดุ และที่ต่างจากทุกช่องทางข้างบนคือทุกใบมีราคาตลาดกำกับอยู่ จะได้รู้ว่าที่กำลังจะจ่ายนั้นถูกหรือแพงกว่าราคากลางเท่าไหร่ ไม่ต้องเดาเอง',
                    'ถ้ายังไม่แน่ใจว่าการ์ดที่อยากได้ราคาเท่าไหร่ เช็คราคาก่อนได้ฟรี แล้วค่อยตัดสินใจว่าจะซื้อจากช่องทางไหน',
                ],
                en: [
                    'There are only a few ways to buy Pokémon cards in Thailand and they suit different people. Facebook buy-and-sell groups are the cheapest because there are no fees, and the trade-off is that you negotiate, transfer and trust a stranger entirely on your own. Physical card shops let you inspect a card before paying, but stock is limited to whatever that shop happened to buy. General marketplaces have refund systems, but sellers are not screened for card knowledge, so cards that do not match their photos are common.',
                    'CardStreet sits between those. Every seller is identity-verified before listing, orders are paid through secure checkout with buyer protection, and everything ships nationwide via Flash Express with tracking. The difference from all of the above is that every card carries a market price, so you can see how far above or below the going rate you are about to pay instead of guessing.',
                    'If you are not sure what a card should cost, check its price for free first, then decide where to buy it.',
                ],
            },
        },
        {
            h2: { th: 'เริ่มสะสมการ์ดโปเกมอนยังไงไม่ให้เสียเงินเปล่า', en: 'How to start collecting without wasting money' },
            body: {
                th: [
                    'เรื่องแรกที่ต้องตัดสินใจคือจะเก็บภาษาไหน การ์ดภาษาไทยเริ่มต้นถูกที่สุดและหาซื้อในประเทศง่ายที่สุด การ์ดภาษาญี่ปุ่นมักได้งานอาร์ตที่นักสะสมตามเก็บ ส่วนภาษาอังกฤษเป็นภาษาที่ใช้แข่งขันในสนามสากล เลือกสักภาษาแล้วเก็บให้จบชุดจะคุ้มกว่าไล่ซื้อกระจายทุกภาษา รายละเอียดว่าสามภาษาต่างกันตรงไหนอ่านได้ในคู่มือด้านล่าง',
                    'เรื่องที่สองคือสภาพการ์ด การ์ดใบเดียวกันสภาพต่างกันราคาต่างกันได้หลายเท่า ตอนซื้อให้ดูรูปจริงทุกใบ โดยเฉพาะขอบการ์ดกับมุมทั้งสี่ ถ้าผู้ขายลงแต่รูปสต็อกให้ถามรูปจริงก่อนโอน',
                    'เรื่องที่สามคืออย่าเพิ่งรีบซื้อใบแพงในเดือนแรก ราคาการ์ดที่เพิ่งออกมักสูงกว่าปกติแล้วค่อยนิ่งลงหลังของเข้าตลาดมากขึ้น เช็คราคาย้อนหลังก่อนตัดสินใจจะเห็นภาพว่าใบนั้นกำลังขึ้นหรือกำลังลง',
                ],
                en: [
                    'The first decision is which language to collect. Thai cards are the cheapest entry and the easiest to find domestically, Japanese cards often carry the artwork collectors chase, and English is the language played at international events. Picking one lane and completing sets in it goes further than buying scattered cards across all three. The guides below cover exactly how the three differ.',
                    'The second is condition. The same card in different condition can differ in price several times over. Look at real photos of every card before buying, edges and all four corners especially, and if a seller only posts stock images, ask for real ones before you transfer anything.',
                    'The third is not to rush an expensive card in your first month. Newly released cards usually price high and settle once more product reaches the market. Checking a card’s price history first shows you whether it is climbing or cooling.',
                ],
            },
        },
        {
            h2: { th: 'สแกนการ์ดโปเกมอนเช็คราคาด้วย AI', en: 'Scan a Pokémon card to check its price' },
            body: {
                th: [
                    'ถ้ามีการ์ดกองอยู่ตรงหน้าแต่ไม่รู้ว่าใบไหนมีราคา เปิดกล้องในแอป CardStreet แล้วส่องการ์ดได้เลย ระบบจะอ่านรหัสชุดกับเลขการ์ดแล้วจับคู่กับใบที่ถูกต้องในแคตตาล็อกให้ พร้อมบอกราคาตลาดเป็นเงินบาททันที',
                    'ตัวสแกนรองรับการ์ดภาษาไทย ญี่ปุ่น และอังกฤษ และแยกได้ถึงระดับว่าเป็นการ์ดใบไหนของชุดไหน ไม่ใช่แค่บอกว่าเป็นโปเกมอนตัวอะไร เพราะโปเกมอนตัวเดียวกันคนละชุดคนละความหายากราคาห่างกันได้มาก สแกนเสร็จกดเก็บเข้าคอลเลกชันเพื่อดูมูลค่ารวมของกองการ์ดที่มีอยู่ได้เลย ใช้ได้ฟรี',
                ],
                en: [
                    'If you have a stack of cards in front of you and no idea which ones are worth anything, open the camera in the CardStreet app and point it at them. It reads the set code and collector number, matches the exact card in the catalog, and shows the market price in Thai baht straight away.',
                    'The scanner handles Thai, Japanese and English cards, and it identifies which card of which set you are holding rather than just naming the Pokémon — the same Pokémon in a different set or rarity can be worth many times more or less. Once scanned, save it to your collection to track what the whole stack is worth. It is free to use.',
                ],
            },
        },
    ],

    onepiece: [
        {
            h2: { th: 'ซื้อการ์ดวันพีชที่ไหนดีในไทย', en: 'Where to buy One Piece cards in Thailand' },
            body: {
                th: [
                    'การ์ดวันพีชในไทยขายกันอยู่สามทางหลัก ร้านการ์ดที่สั่งของเข้ามาเอง กลุ่มซื้อขายในโซเชียล และมาร์เก็ตเพลสออนไลน์ ปัญหาที่เจอบ่อยที่สุดไม่ใช่ของปลอม แต่เป็นการจ่ายแพงเกินราคากลางเพราะไม่มีที่อ้างอิง โดยเฉพาะช่วงชุดใหม่ออกที่ราคาผันผวนแรงในสองสามสัปดาห์แรก',
                    'บน CardStreet ทุกใบมีราคาตลาดกำกับอยู่ข้างรายการขาย เทียบได้ทันทีว่าใบที่กำลังจะกดซื้อสูงหรือต่ำกว่าราคากลางเท่าไหร่ ผู้ขายยืนยันตัวตนทุกคน จ่ายผ่านระบบที่ปลอดภัยมีการคุ้มครองผู้ซื้อ และส่งทั่วไทยผ่าน Flash Express พร้อมเลขติดตามพัสดุ',
                ],
                en: [
                    'One Piece cards in Thailand move through three main channels: shops that import their own stock, social buy-and-sell groups, and online marketplaces. The most common problem is not counterfeits — it is overpaying because there is no reference price to check against, especially in the first few weeks of a new set when prices swing hard.',
                    'On CardStreet every card carries a market price next to the listing, so you can see immediately whether the one you are about to buy sits above or below the going rate. Sellers are identity-verified, payment goes through secure checkout with buyer protection, and orders ship nationwide via Flash Express with tracking.',
                ],
            },
        },
        {
            h2: { th: 'เก็บการ์ดวันพีชภาษาอังกฤษหรือญี่ปุ่นดี', en: 'English or Japanese One Piece cards?' },
            body: {
                th: [
                    'การ์ดวันพีชมีทั้งฉบับภาษาญี่ปุ่นที่ออกก่อน และฉบับภาษาอังกฤษที่ออกตามมาทีหลัง ทั้งสองฉบับใช้รหัสการ์ดชุดเดียวกันอย่าง OP หรือ ST ทำให้หลายคนเข้าใจผิดว่าเป็นการ์ดใบเดียวกันและควรราคาเท่ากัน จริง ๆ แล้วสองฉบับนี้เป็นคนละตลาดกัน มีรอบพิมพ์ ปริมาณ และความต้องการต่างกัน ราคาจึงห่างกันได้มากแม้จะเป็นการ์ดตัวเดียวกัน',
                    'สิ่งที่ควรทำก่อนซื้อคือดูให้แน่ว่ากำลังเทียบราคาฉบับเดียวกันอยู่ ไม่ใช่เอาราคาญี่ปุ่นไปเทียบกับของอังกฤษ ในหน้าการ์ดของ CardStreet แต่ละฉบับแยกกันคนละหน้าและมีราคาของตัวเอง คู่มือเปรียบเทียบสองฉบับแบบละเอียดอยู่ด้านล่าง',
                ],
                en: [
                    'One Piece cards come in a Japanese edition that releases first and an English edition that follows. Both use the same set codes such as OP and ST, which leads people to assume they are the same card and should cost the same. They are separate markets with different print runs, volumes and demand, so the same character card can be priced very differently between them.',
                    'The thing to get right before buying is that you are comparing like with like, rather than checking a Japanese price and paying it for an English card. On CardStreet each edition is its own page with its own price. The guide below compares the two in detail.',
                ],
            },
        },
        {
            h2: { th: 'ราคาการ์ดวันพีชขึ้นลงตามอะไร', en: 'What moves One Piece card prices' },
            body: {
                th: [
                    'ตัวแปรที่ชัดที่สุดคือการแข่งขัน การ์ดที่ถูกใช้ในเด็คที่ชนะบ่อยจะถูกไล่เก็บจนราคาขึ้นเร็ว และลงเร็วพอกันเมื่อมีการ์ดใหม่มาแทน อีกตัวแปรคือความนิยมของตัวละคร การ์ดตัวละครหลักมักมีคนเก็บเพราะชอบ ไม่ได้เก็บเพื่อเล่น ราคาจึงนิ่งกว่าและไม่ผูกกับเมตาเท่าไหร่',
                    'ตัวแปรที่คนมองข้ามคือรอบพิมพ์ซ้ำ เมื่อการ์ดใบหนึ่งถูกพิมพ์ใหม่ในชุดรวมหรือชุดเสริม ของในตลาดเพิ่มขึ้นทันทีและราคาใบเดิมมักปรับลง ก่อนจะทุ่มซื้อใบแพงจึงควรดูราคาย้อนหลังประกอบ ไม่ใช่ดูแค่ราคาวันนี้',
                ],
                en: [
                    'The clearest driver is competitive play. Cards that appear in consistently winning decks get bought up and rise fast, then fall just as fast when something replaces them. The other driver is character popularity: cards of major characters are bought by people who simply like them rather than to play with, so they tend to hold steadier and track the metagame less.',
                    'The factor people overlook is reprints. When a card is reprinted in a collection or supplementary set, supply increases immediately and the earlier printing usually softens. Before committing to an expensive card it is worth reading its price history rather than only today’s number.',
                ],
            },
        },
    ],

    yugioh: [
        {
            h2: { th: 'ซื้อการ์ดยูกิที่ไหนดีในไทย', en: 'Where to buy Yu-Gi-Oh! cards in Thailand' },
            body: {
                th: [
                    'ตลาดการ์ดยูกิในไทยกระจายอยู่ตามร้านการ์ด กลุ่มซื้อขาย และมาร์เก็ตเพลสทั่วไป สิ่งที่ทำให้ยูกิซื้อยากกว่าเกมอื่นคือการ์ดชื่อเดียวกันถูกพิมพ์ซ้ำหลายรอบข้ามหลายชุด แต่ละรอบคนละความหายากและคนละราคา คนซื้อที่ค้นแค่ชื่อการ์ดจึงมีโอกาสจ่ายราคาของอีกเวอร์ชันโดยไม่รู้ตัว',
                    'บน CardStreet การ์ดแต่ละเวอร์ชันแยกกันคนละหน้า มีรหัสชุด เลขการ์ด และความหายากกำกับชัดเจน พร้อมราคาตลาดของเวอร์ชันนั้นโดยเฉพาะ เวลาซื้อจึงเทียบได้ตรงว่ากำลังจ่ายให้เวอร์ชันไหน ผู้ขายยืนยันตัวตนทุกคน และส่งทั่วไทยผ่าน Flash Express',
                ],
                en: [
                    'The Yu-Gi-Oh! market in Thailand is spread across card shops, buy-and-sell groups and general marketplaces. What makes it harder to buy than other games is that the same card name is reprinted many times across many sets, each printing at a different rarity and a different price. Someone searching by card name alone can easily pay one version’s price for another.',
                    'On CardStreet every printing is its own page, labelled with its set code, collector number and rarity, and priced for that printing specifically. That way you can see exactly which version you are paying for. Sellers are identity-verified and orders ship nationwide via Flash Express.',
                ],
            },
        },
        {
            h2: { th: 'การ์ดยูกิของปลอมดูยังไง', en: 'How to spot a fake Yu-Gi-Oh! card' },
            body: {
                th: [
                    'ยูกิเป็นเกมที่มีของปลอมหมุนเวียนมากที่สุดเกมหนึ่ง เพราะพิมพ์มานานและมีการ์ดราคาสูงจำนวนมาก จุดที่ดูง่ายที่สุดคือด้านหลังการ์ด ของแท้จะมีเฉดสีน้ำตาลอมม่วงที่สม่ำเสมอและวงกลมตรงกลางคมชัด ของปลอมมักสีเพี้ยนไปทางแดงหรือเทา และเส้นขอบเบลอ',
                    'จุดที่สองคือความคมของตัวอักษร ลองส่องข้อความบรรยายเอฟเฟกต์ด้วยแว่นขยายหรือซูมกล้องมือถือ ของแท้ตัวอักษรคมเป็นเส้นเดียว ของปลอมมักเห็นเป็นจุดพิมพ์กระจาย จุดที่สามคือความหนาและน้ำหนัก เทียบกับใบแท้ที่มีอยู่ในมือจะรู้สึกได้ทันทีถ้าบางหรือลื่นผิดปกติ',
                    'ถ้าซื้อจากคนที่ไม่รู้จัก ให้ขอรูปด้านหลังและรูปขอบการ์ดในแสงธรรมชาติเสมอ ไม่ใช่รูปสต็อกจากอินเทอร์เน็ต',
                ],
                en: [
                    'Yu-Gi-Oh! has one of the largest counterfeit circulations of any card game, because it has been printed for decades and has many high-value cards. The easiest tell is the back of the card: a genuine one has an even brown-purple tone with a crisp central circle, while fakes usually shift red or grey and have blurred edges.',
                    'The second is text sharpness. Look at the effect text under a magnifier or a phone camera zoom — genuine printing gives clean single-stroke letters, while fakes show scattered print dots. The third is thickness and weight: held against a genuine card you already own, a fake usually feels thin or unusually slick.',
                    'Buying from someone you do not know, always ask for photos of the back and the edges in natural light rather than stock images from the internet.',
                ],
            },
        },
        {
            h2: { th: 'การ์ดยูกิในแคตตาล็อกมีภาษาอะไรบ้าง', en: 'Which Yu-Gi-Oh! editions are in the catalog' },
            body: {
                th: [
                    'แคตตาล็อกยูกิบน CardStreet มีสองฉบับคือภาษาอังกฤษซึ่งเป็นฝั่ง TCG ที่ใช้แข่งในไทยและสากล กับภาษาญี่ปุ่นซึ่งเป็นฝั่ง OCG ยังไม่มีฉบับภาษาไทยอย่างเป็นทางการ การ์ดแปลไทยที่เห็นขายกันทั่วไปไม่ใช่การ์ดลิขสิทธิ์และใช้แข่งขันไม่ได้ จึงไม่ได้อยู่ในแคตตาล็อกนี้',
                    'สองฉบับนี้ไม่ได้ใช้กติกาชุดเดียวกันทั้งหมด รายชื่อการ์ดต้องห้ามและการ์ดที่จำกัดจำนวนของ TCG กับ OCG ต่างกัน การ์ดใบเดียวกันจึงมีค่าไม่เท่ากันในสองฝั่ง คู่มือเปรียบเทียบ TCG กับ OCG อยู่ด้านล่าง',
                ],
                en: [
                    'The Yu-Gi-Oh! catalog on CardStreet covers two editions: English, which is the TCG side played competitively in Thailand and internationally, and Japanese, which is the OCG. There is no official Thai edition. The Thai-translated cards commonly sold around are unlicensed and not tournament legal, so they are not in this catalog.',
                    'The two editions do not share a single rulebook. Their forbidden and limited lists differ, so the same card can be worth very different amounts on each side. The guide comparing TCG and OCG is below.',
                ],
            },
        },
    ],

    mtg: [
        {
            h2: { th: 'เริ่มเล่น Magic: The Gathering ในไทยยังไง', en: 'Getting started with Magic in Thailand' },
            body: {
                th: [
                    'สิ่งที่ต้องเลือกก่อนซื้อการ์ดใบแรกคือจะเล่นรูปแบบไหน เพราะแต่ละรูปแบบใช้การ์ดคนละชุดกัน Commander เป็นรูปแบบที่คนไทยเล่นกันมากที่สุด เล่นกันหลายคนต่อโต๊ะ ใช้การ์ดได้เกือบทุกชุดตั้งแต่อดีตถึงปัจจุบัน และไม่มีการหมุนเวียนออก ทำให้การ์ดที่ซื้อวันนี้ยังใช้ได้อีกนาน ส่วน Standard ใช้เฉพาะชุดใหม่ในช่วงไม่กี่ปีล่าสุด เข้าเล่นถูกกว่าแต่การ์ดจะหมดอายุการใช้งานตามรอบ',
                    'ถ้ายังไม่แน่ใจ เริ่มจากเด็คสำเร็จรูปของรูปแบบที่สนใจก่อนแล้วค่อยซื้อการ์ดใบเดี่ยวมาปรับ วิธีนี้ถูกกว่าการเปิดกล่องสุ่มมาก เพราะเลือกจ่ายเฉพาะใบที่จะได้ใช้จริง',
                    'ก่อนกดซื้อใบเดี่ยวควรเช็คราคาตลาดก่อนทุกครั้ง การ์ดเมจิกใบเดียวกันมีหลายเวอร์ชันและราคาห่างกันมาก คู่มือเรื่องเวอร์ชันการพิมพ์อยู่ด้านล่าง',
                ],
                en: [
                    'The thing to decide before buying your first card is which format you want to play, because each one uses a different pool of cards. Commander is the most widely played format in Thailand: multiplayer, drawing on nearly every set ever printed, and with no rotation, so cards bought today stay usable for years. Standard uses only the last few years of sets, which is cheaper to enter but means cards age out on a schedule.',
                    'If you are unsure, start with a preconstructed deck for the format you like and buy singles to adjust it. That is far cheaper than opening sealed product, because you only pay for cards you will actually use.',
                    'Always check the market price before buying a single. The same Magic card exists in many versions at very different prices — the guide on printings is below.',
                ],
            },
        },
        {
            h2: { th: 'ราคาการ์ด Magic ขึ้นลงเพราะอะไร', en: 'What moves Magic card prices' },
            body: {
                th: [
                    'เมจิกต่างจากการ์ดเกมอื่นตรงที่ราคาผูกกับกติกาโดยตรง เมื่อการ์ดใบหนึ่งถูกแบนออกจากรูปแบบใดรูปแบบหนึ่ง ความต้องการหายไปทันทีและราคาร่วงในไม่กี่วัน ในทางกลับกัน การ์ดเก่าที่จู่ ๆ มีคนค้นพบว่าใช้ในเด็คใหม่ได้ดี ราคาขึ้นได้เป็นเท่าตัวภายในสัปดาห์เดียว',
                    'ตัวแปรที่สองคือการพิมพ์ซ้ำ เมจิกพิมพ์การ์ดเก่ากลับมาบ่อยมาก ทั้งในชุดรวมและชุดพิเศษ ทุกครั้งที่พิมพ์ซ้ำของในตลาดเพิ่มและราคาเวอร์ชันเดิมมักปรับลง ยกเว้นเวอร์ชันที่หายากเป็นพิเศษซึ่งมักไม่กระทบ',
                    'ตัวแปรที่สามคือ Commander การ์ดที่ใช้ได้ดีในรูปแบบนี้มีคนซื้อสม่ำเสมอตลอดปีเพราะไม่มีการหมุนเวียนออก ราคาจึงค่อย ๆ ไต่ขึ้นแบบไม่หวือหวาแทนที่จะพุ่งแล้วร่วง',
                ],
                en: [
                    'Magic differs from other card games in that prices are tied directly to the rules. When a card is banned from a format, demand disappears overnight and the price falls within days. Conversely, an old card that someone discovers works in a new deck can multiply in price inside a week.',
                    'The second factor is reprints. Magic reprints older cards constantly, in both collected and special sets. Every reprint adds supply and usually softens the earlier version, except for unusually scarce treatments, which tend to be unaffected.',
                    'The third is Commander. Cards that are strong in that format sell steadily all year because nothing rotates out, so they tend to climb gradually rather than spike and crash.',
                ],
            },
        },
        {
            h2: { th: 'การ์ด Magic ของปลอมดูยังไง', en: 'How to spot a fake Magic card' },
            body: {
                th: [
                    'วิธีที่เร็วที่สุดคือทดสอบแสง ยกการ์ดส่องไฟจากด้านหลัง การ์ดแท้จะมีชั้นฟิล์มสีฟ้าตรงกลางที่กันแสงไว้ ทำให้ทึบกว่าที่คิด ของปลอมส่วนใหญ่แสงทะลุผ่านชัดเจน วิธีนี้ใช้ได้กับการ์ดเมจิกแทบทุกยุค',
                    'จุดที่สองคือลายจุดพิมพ์ ส่องขอบวงกลมสีเขียวบนด้านหลังด้วยกล้องมือถือซูมสุด ของแท้จะเห็นเป็นลายจุดสีเหลืองแดงน้ำเงินเรียงตัวเป็นระเบียบ ของปลอมมักเป็นสีทึบหรือจุดกระจายไม่เป็นแบบแผน',
                    'ถ้ากำลังจะซื้อใบราคาสูงจากคนที่ไม่รู้จัก ขอรูปทดสอบแสงกับรูปขอบการ์ดก่อนโอนเสมอ',
                ],
                en: [
                    'The fastest check is the light test: hold the card up to a light source from behind. A genuine Magic card has a blue core layer that blocks light, making it more opaque than you expect, while most fakes let light through clearly. This works on Magic cards from nearly every era.',
                    'The second is the print rosette. Zoom a phone camera onto the green circle border on the back — genuine printing shows an orderly pattern of yellow, magenta and cyan dots, while fakes tend to look solid or scattered.',
                    'If you are buying an expensive card from someone you do not know, ask for a light-test photo and edge shots before transferring anything.',
                ],
            },
        },
    ],

    lorcana: [
        {
            h2: { th: 'เริ่มสะสม Disney Lorcana ยังไง', en: 'How to start collecting Disney Lorcana' },
            body: {
                th: [
                    'Lorcana เป็นการ์ดเกมที่เข้าง่ายกว่าเกมอื่นตรงที่ตัวละครคุ้นเคยอยู่แล้ว คนส่วนใหญ่จึงเริ่มจากเก็บตัวละครที่ชอบก่อน ไม่ได้เริ่มจากการเล่น ถ้าเป็นแบบนั้นให้ไล่เก็บตามชุดจะเห็นภาพรวมง่ายกว่า เพราะแต่ละชุดมีธีมและงานอาร์ตของตัวเอง',
                    'ถ้าตั้งใจจะเล่นด้วย ให้เริ่มจากเด็คสำเร็จรูปแล้วค่อยซื้อใบเดี่ยวเสริม การ์ดที่แพงที่สุดในเกมนี้มักเป็นการ์ดหายากพิเศษที่สวยแต่ไม่จำเป็นต่อการเล่น จึงไม่ต้องรีบไล่ล่าตั้งแต่แรก',
                    'ก่อนซื้อใบไหนควรเช็คราคาตลาดก่อน เพราะ Lorcana ในไทยยังนำเข้าเป็นหลัก ราคาที่ตั้งขายจึงต่างกันได้มากระหว่างผู้ขายแต่ละคน',
                ],
                en: [
                    'Lorcana is easier to walk into than most card games because the characters are already familiar, so most people start by collecting favourites rather than by playing. If that is you, collecting set by set gives a clearer picture, since each set has its own theme and artwork.',
                    'If you intend to play as well, start from a preconstructed deck and add singles. The most expensive cards in the game are usually the special rarities, which are beautiful but not necessary to play, so there is no need to chase them early.',
                    'Check the market price before buying anything. Lorcana in Thailand is still largely imported, so asking prices vary widely between sellers.',
                ],
            },
        },
        {
            h2: { th: 'ราคาการ์ด Lorcana ขึ้นลงเพราะอะไร', en: 'What moves Lorcana card prices' },
            body: {
                th: [
                    'ตัวแปรหลักของ Lorcana คือปริมาณการพิมพ์ ชุดแรก ๆ ของเกมพิมพ์น้อยกว่าความต้องการจริงมาก ทำให้การ์ดจากชุดยุคแรกยังราคาสูงต่อเนื่องแม้เวลาผ่านไป ส่วนชุดหลัง ๆ ที่พิมพ์เพียงพอกับตลาด ราคาจะนิ่งกว่าและไม่ค่อยขยับแรง',
                    'ตัวแปรที่สองคือความหายากระดับพิเศษ การ์ดที่ออกในอัตราต่ำมากต่อกล่องเป็นตัวกำหนดราคาสูงสุดของแต่ละชุด และเป็นกลุ่มที่ราคาเหวี่ยงมากที่สุดเวลามีคนปล่อยของพร้อมกัน',
                    'ตัวแปรที่สามสำหรับตลาดไทยโดยเฉพาะคือรอบการนำเข้า ช่วงที่ของเข้ามาพร้อมกันหลายร้าน ราคาจะย่อลงชั่วคราวก่อนกลับขึ้นเมื่อของหมด ดูราคาย้อนหลังประกอบจะช่วยให้จับจังหวะได้',
                ],
                en: [
                    'The main driver in Lorcana is print quantity. The game’s earliest sets were printed well below actual demand, which is why cards from that era have stayed expensive, while later sets printed to meet the market hold steadier and move less.',
                    'The second is the special rarities. Cards that appear at very low rates per box set the ceiling for each set, and they are also the group that swings most when several sellers list at once.',
                    'The third is specific to Thailand: import timing. When stock lands at several shops at once, prices dip temporarily and recover as it sells through. Reading the price history alongside the current number helps you see where in that cycle you are.',
                ],
            },
        },
    ],

    riftbound: [
        {
            h2: { th: 'ซื้อการ์ด Riftbound ที่ไหนดีในไทย', en: 'Where to buy Riftbound cards in Thailand' },
            body: {
                th: [
                    'Riftbound เพิ่งเข้าไทยได้ไม่นาน ของจึงยังกระจายอยู่ตามร้านการ์ดที่สั่งเข้ามาเองและกลุ่มซื้อขายเป็นหลัก ผลคือราคาตั้งขายต่างกันมากระหว่างร้าน เพราะยังไม่มีราคากลางที่คนอ้างอิงร่วมกันเหมือนเกมที่อยู่มานาน',
                    'ข้อได้เปรียบของการซื้อผ่าน CardStreet ในช่วงนี้คือมีราคาตลาดกำกับทุกใบให้เทียบก่อนตัดสินใจ ผู้ขายยืนยันตัวตน จ่ายผ่านระบบที่ปลอดภัยมีการคุ้มครองผู้ซื้อ และส่งทั่วไทยผ่าน Flash Express พร้อมเลขติดตามพัสดุ',
                ],
                en: [
                    'Riftbound arrived in Thailand recently, so stock still sits mainly with card shops importing their own and with buy-and-sell groups. The result is that asking prices vary a lot between sellers, because there is no shared reference price yet the way there is for older games.',
                    'The advantage of buying through CardStreet right now is that every card carries a market price to compare against before you commit. Sellers are identity-verified, payment goes through secure checkout with buyer protection, and orders ship nationwide via Flash Express with tracking.',
                ],
            },
        },
        {
            h2: { th: 'Riftbound ต่างจากการ์ดเกมอื่นยังไง', en: 'How Riftbound differs from other card games' },
            body: {
                th: [
                    'Riftbound สร้างจากจักรวาล League of Legends ตัวละครและสกิลที่เห็นบนการ์ดจึงมาจากเกมที่คนเล่นคุ้นเคยอยู่แล้ว นั่นทำให้คนกลุ่มแรกที่เข้ามาเก็บส่วนใหญ่มาจากฝั่งผู้เล่นเกม ไม่ใช่นักสะสมการ์ดเดิม ความต้องการจึงเกาะไปกับความนิยมของตัวละครมากกว่าความแข็งแกร่งในการแข่งขัน',
                    'อีกข้อที่ต่างคือเกมนี้ยังใหม่มาก จำนวนชุดที่ออกมายังนับได้ไม่กี่ชุด แปลว่าคนที่เริ่มเก็บตอนนี้ยังไล่เก็บให้ครบได้จริง ต่างจากเกมที่พิมพ์มาหลายสิบปีจนไล่ตามไม่ทัน',
                ],
                en: [
                    'Riftbound is built on the League of Legends universe, so the characters and abilities on the cards come from a game its audience already knows. That means the first wave of collectors came from the video game rather than from existing card collecting, and demand tracks character popularity more than competitive strength.',
                    'The other difference is how new it is. Only a handful of sets exist, which means someone starting now can realistically complete them — unlike games that have been printing for decades.',
                ],
            },
        },
        {
            h2: { th: 'เช็คราคาการ์ด Riftbound ได้ครบทุกใบ', en: 'Every Riftbound card has a price' },
            body: {
                th: [
                    'เพราะ Riftbound ยังมีชุดไม่มาก แคตตาล็อกของเกมนี้บน CardStreet จึงมีราคาตลาดครบทุกใบ ไม่ใช่เฉพาะใบดัง ค้นชื่อการ์ดหรือเปิดดูทั้งชุดก็เห็นราคาเป็นเงินบาทได้ทันที ใช้ได้ฟรีและไม่ต้องสมัครสมาชิก',
                    'ประโยชน์จริงของเรื่องนี้คือเวลาจะซื้อหรือขาย มีตัวเลขอ้างอิงให้ทั้งสองฝั่งคุยกันบนพื้นฐานเดียวกัน แทนที่จะตั้งราคาตามความรู้สึกในตลาดที่ยังไม่มีใครรู้ราคากลาง',
                ],
                en: [
                    'Because Riftbound has only a handful of sets, its catalog on CardStreet carries a market price for every card, not just the well-known ones. Search a card name or open a whole set and you see prices in Thai baht straight away, free and without an account.',
                    'The practical value is that when you buy or sell, both sides have the same reference number to talk about, instead of pricing on instinct in a market where nobody yet knows the going rate.',
                ],
            },
        },
    ],
};

export function getLandingSections(gameId: GameId): LandingSection[] {
    return LANDING_SECTIONS[gameId] ?? [];
}
