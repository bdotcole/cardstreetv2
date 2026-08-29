import type { GameId } from '@/lib/games';

// Content for the per-game landing pages (/pokemon, /one-piece, ...). These
// pages target the Thai head terms for each game (การ์ดโปเกมอน, การ์ดวันพีช,
// การ์ดยูกิ, ...) — the searches CardStreet needs to rank for — so the Thai
// copy is written first and English mirrors it. Plain strings only: the FAQ
// answers serialize into schema.org FAQPage JSON-LD.

export interface GameLandingFaq {
    q: { th: string; en: string };
    a: { th: string; en: string };
}

export interface GameLandingContent {
    /** URL slug — the clean public path is /<slug> (see middleware GAME_LANDING_PATHS). */
    slug: string;
    gameId: GameId;
    /** <title> per locale. */
    title: { th: string; en: string };
    /** meta description per locale. */
    description: { th: string; en: string };
    h1: { th: string; en: string };
    intro: { th: string[]; en: string[] };
    faqs: GameLandingFaq[];
}

export const GAME_LANDINGS: GameLandingContent[] = [
    {
        slug: 'pokemon',
        gameId: 'pokemon',
        // Thai writes Pokémon two ways: โปเกมอน and the colloquial โปเกม่อน (with
        // ไม้เอก). โปเกม่อน is the spelling in this site's best-ranking query
        // ("เช็คราคาการ์ดโปเกม่อน"), yet the page that should own that term used
        // only โปเกมอน. Both now appear here — in the title, the description, the
        // intro and one FAQ answer — so a single URL serves both variants without
        // reading as keyword stuffing. The h1 keeps the formal spelling.
        title: {
            th: 'การ์ดโปเกมอน — ซื้อ ขาย เช็คราคาการ์ดโปเกม่อนในไทย | CardStreet',
            en: 'Pokémon Cards Thailand — Buy, Sell & Check Prices | CardStreet',
        },
        description: {
            th: 'ตลาดซื้อขายการ์ดโปเกมอนออนไลน์ในไทย ครบทั้งการ์ดภาษาไทย อังกฤษ และญี่ปุ่นกว่า 40,000 ใบ เช็คราคาการ์ดโปเกม่อนแบบเรียลไทม์ สแกนการ์ดด้วย AI ผู้ขายยืนยันตัวตน ส่งทั่วไทย',
            en: 'Buy and sell Pokémon TCG cards in Thailand — Thai, English, and Japanese sets with live market prices, AI card scanning, verified sellers, and nationwide delivery.',
        },
        h1: {
            th: 'การ์ดโปเกมอน (Pokémon TCG)',
            en: 'Pokémon TCG Cards in Thailand',
        },
        intro: {
            th: [
                'CardStreet คือตลาดซื้อขายการ์ดโปเกมอนออนไลน์สำหรับนักสะสมชาวไทย รวมการ์ดโปเกมอนภาษาไทย ภาษาอังกฤษ และภาษาญี่ปุ่นไว้ในที่เดียว พร้อมราคาตลาดที่อัปเดตทุกวัน ไม่ว่าจะเป็นชุดล่าสุดหรือการ์ดหายากระดับ Secret Rare ก็เช็คราคาและหาซื้อได้ที่นี่',
                'ทุกการซื้อได้รับความคุ้มครองผ่านระบบชำระเงินที่ปลอดภัย ผู้ขายทุกคนผ่านการยืนยันตัวตน และจัดส่งทั่วประเทศด้วย Flash Express นักสะสมยังสแกนการ์ดโปเกม่อนด้วย AI เพื่อเช็คราคาและเก็บเข้าคอลเลกชันได้ฟรีผ่านแอป CardStreet',
                'วิธีเช็คราคาการ์ดโปเกม่อนบน CardStreet ทำได้สามทาง เริ่มจากพิมพ์ชื่อการ์ดหรือเลขการ์ดในช่องค้นหาแล้วเปิดหน้าการ์ดใบนั้น จะเห็นราคาตลาดเป็นเงินบาทพร้อมกราฟย้อนหลัง 7 30 และ 90 วัน ถ้าไม่รู้ว่าการ์ดใบไหนให้เปิดกล้องสแกนการ์ดในแอป ระบบจะจับคู่กับใบที่ถูกต้องให้เอง หรือถ้าอยากดูทั้งชุดให้เข้าไปที่หน้าชุดการ์ดแล้วไล่ดูราคาทีละใบ ทั้งหมดนี้ใช้ได้ฟรีและไม่ต้องสมัครสมาชิก',
            ],
            en: [
                'CardStreet is Thailand’s online marketplace for Pokémon TCG collectors, bringing Thai, English, and Japanese Pokémon cards together in one catalog with market prices updated daily — from the newest sets to chase Secret Rares.',
                'Every purchase is protected by secure checkout, sellers are identity-verified, and orders ship nationwide via Flash Express. You can also scan any card with AI to check its price and track your collection for free in the CardStreet app.',
                'There are three ways to check a Pokémon card price on CardStreet. Search the card name or its collector number and open the card page, where you will see the market price in Thai baht with 7, 30, and 90-day history. If you do not know which card you are holding, scan it with the camera in the app and it will match the right print for you. Or open a set page and browse every card in that set with its price. All of it is free and needs no account.',
            ],
        },
        faqs: [
            {
                q: { th: 'ซื้อการ์ดโปเกมอนแท้ได้ที่ไหนในไทย?', en: 'Where can I buy authentic Pokémon cards in Thailand?' },
                a: {
                    th: 'ซื้อได้ที่ CardStreet ตลาดออนไลน์ที่รวมผู้ขายการ์ดโปเกมอนทั่วไทยที่ผ่านการยืนยันตัวตน ทุกออเดอร์มีระบบคุ้มครองผู้ซื้อ ชำระผ่านบัตรเครดิตหรือพร้อมเพย์ และจัดส่งด้วย Flash Express',
                    en: 'On CardStreet — an online marketplace of identity-verified Pokémon card sellers across Thailand. Every order has buyer protection, card and PromptPay payment, and Flash Express delivery.',
                },
            },
            {
                q: { th: 'เช็คราคาการ์ดโปเกมอนยังไง?', en: 'How do I check Pokémon card prices?' },
                a: {
                    th: 'ดูราคาตลาดล่าสุดได้ฟรีบนหน้าการ์ดทุกใบใน CardStreet หรือสแกนการ์ดจริงด้วยแอป CardStreet เพื่อเช็คราคาการ์ดโปเกม่อนได้ทันที รองรับทั้งการ์ดภาษาไทย อังกฤษ และญี่ปุ่น',
                    en: 'Every card page on CardStreet shows a live market price for free, or scan a physical card with the CardStreet app for an instant price — Thai, English, and Japanese cards are all supported.',
                },
            },
            {
                q: { th: 'ขายการ์ดโปเกมอนบน CardStreet ได้ไหม?', en: 'Can I sell my Pokémon cards on CardStreet?' },
                a: {
                    th: 'ได้ สมัครฟรีและลงขายได้ทันที ระบบแนะนำราคาให้ตามราคาตลาด รับเงินอย่างปลอดภัยผ่าน Stripe และมีระบบจัดส่ง Flash Express ในตัว',
                    en: 'Yes — signing up is free and you can list immediately. CardStreet suggests prices from live market data, pays out securely via Stripe, and has Flash Express shipping built in.',
                },
            },
            {
                q: { th: 'การ์ดโปเกมอนภาษาไทยกับภาษาอังกฤษ ราคาต่างกันไหม?', en: 'Do Thai and English Pokémon cards have different prices?' },
                a: {
                    th: 'ต่างกัน การ์ดใบเดียวกันคนละภาษาถือเป็นคนละใบในตลาด และซื้อขายกันคนละกลุ่มผู้เล่น CardStreet จึงแยกราคาตามภาษาให้ชัดเจน การ์ดภาษาไทยอ้างอิงราคาจากตลาดในประเทศ ส่วนภาษาอังกฤษและภาษาญี่ปุ่นอ้างอิงตลาดต่างประเทศแล้วแปลงเป็นเงินบาท เวลาเทียบราคาจึงควรดูให้ตรงภาษาและตรงเลขการ์ด',
                    en: 'Yes. The same card in a different language is a different card to the market, traded by different collectors, so CardStreet prices each language separately. Thai-language cards are priced from the domestic Thai market; English and Japanese cards reference global markets converted to Thai baht. When comparing, match both the language and the collector number.',
                },
            },
            {
                q: { th: 'การ์ดโปเกม่อนแบบไหนที่มีมูลค่าสูง?', en: 'Which Pokémon cards are worth the most?' },
                a: {
                    th: 'โดยทั่วไปคือการ์ดที่ออกมาน้อยและสภาพดี ระดับความหายากอย่าง Secret Rare, Special Art หรือการ์ดโปรโมทที่แจกในงานมักมีราคาสูงกว่าการ์ดธรรมดาในชุดเดียวกันหลายเท่า สภาพการ์ดก็มีผลมาก การ์ดที่มุมคมและผิวไม่มีรอยจะขายได้ราคาดีกว่าใบที่ผ่านการเล่นมา ดูราคาจริงของแต่ละระดับความหายากได้จากหน้าชุดการ์ดบน CardStreet',
                    en: 'Generally the ones printed in small numbers and kept in good condition. Rarities such as Secret Rare, Special Art, and event promo cards usually sell for several times a common card from the same set, and condition matters just as much — sharp corners and a clean surface fetch noticeably more than a played copy. Set pages on CardStreet show the real prices for each rarity side by side.',
                },
            },
            {
                q: { th: 'ซื้อกล่องการ์ดโปเกมอนแบบยังไม่แกะได้ไหม?', en: 'Can I buy sealed Pokémon boxes and packs?' },
                a: {
                    th: 'ได้ CardStreet มีสินค้าซีลทั้งบูสเตอร์บ็อกซ์ บูสเตอร์แพ็ค และกล่องชุดพิเศษ ทั้งฉบับภาษาไทย อังกฤษ และญี่ปุ่น พร้อมราคาตลาดเช่นเดียวกับการ์ดใบเดี่ยว สินค้าซีลเป็นที่นิยมทั้งกับคนที่อยากเปิดเองและคนที่เก็บไว้เพราะราคาของกล่องที่เลิกผลิตแล้วมักขยับขึ้นตามเวลา',
                    en: 'Yes. CardStreet carries sealed booster boxes, booster packs, and special set boxes in Thai, English, and Japanese, with market prices alongside singles. Sealed product appeals both to people who want to open it and to collectors holding it, since boxes from sets that have gone out of print tend to move up over time.',
                },
            },
        ],
    },
    {
        slug: 'one-piece',
        gameId: 'onepiece',
        title: {
            th: 'การ์ดวันพีช (One Piece Card Game) — ซื้อ ขาย เช็คราคา | CardStreet',
            en: 'One Piece Card Game Thailand — Buy, Sell & Prices | CardStreet',
        },
        description: {
            th: 'ซื้อขายการ์ดวันพีช One Piece Card Game ในไทย ทั้งเวอร์ชันภาษาอังกฤษและญี่ปุ่น เช็คราคาตลาดเรียลไทม์ ผู้ขายยืนยันตัวตน ส่งทั่วไทย',
            en: 'Buy and sell One Piece Card Game singles and sealed in Thailand — English and Japanese versions with live market prices, verified sellers, and nationwide delivery.',
        },
        h1: {
            th: 'การ์ดวันพีช (One Piece Card Game)',
            en: 'One Piece Card Game in Thailand',
        },
        intro: {
            th: [
                'ตลาดซื้อขายการ์ดวันพีชสำหรับนักสะสมชาวไทย รวมการ์ด One Piece Card Game ทั้งเวอร์ชันภาษาอังกฤษและภาษาญี่ปุ่น ตั้งแต่การ์ด Leader และ Secret Rare ยอดนิยมอย่าง Luffy, Shanks และ Nami ไปจนถึงกล่องบูสเตอร์ซีล พร้อมราคาตลาดอัปเดตทุกวัน',
                'ซื้อจากผู้ขายที่ยืนยันตัวตนแล้วทั่วไทย มีระบบคุ้มครองผู้ซื้อทุกออเดอร์ และจัดส่งด้วย Flash Express หรือจะลงขายการ์ดของคุณเองก็สมัครฟรี',
                'วิธีเช็คราคาการ์ดวันพีชบน CardStreet ให้พิมพ์ชื่อตัวละครหรือรหัสการ์ด เช่น รหัสที่ขึ้นต้นด้วย OP แล้วเปิดหน้าการ์ดเพื่อดูราคาตลาดเป็นเงินบาทและกราฟราคาย้อนหลัง แคตตาล็อกมีทั้งฉบับภาษาอังกฤษและภาษาญี่ปุ่นกว่า 5,500 ใบ ถ้ามีการ์ดอยู่ในมือแต่ไม่แน่ใจว่าเป็นเวอร์ชันไหน สแกนด้วยกล้องในแอปแล้วระบบจะบอกให้เองว่าเป็นใบไหน',
            ],
            en: [
                'A marketplace for One Piece Card Game collectors in Thailand, covering English and Japanese versions — from popular Leaders and Secret Rares like Luffy, Shanks, and Nami to sealed booster boxes, all with daily-updated market prices.',
                'Buy from identity-verified sellers across Thailand with buyer protection on every order and Flash Express delivery — or sign up free and list your own cards.',
                'To check a One Piece card price on CardStreet, search the character name or the card code (the ones beginning with OP) and open the card page for its market price in Thai baht and price history. The catalog holds more than 5,500 cards across the English and Japanese editions. If you have a card in hand but are not sure which version it is, scan it with the camera in the app and it will identify the print for you.',
            ],
        },
        faqs: [
            {
                q: { th: 'ซื้อการ์ดวันพีชได้ที่ไหนในไทย?', en: 'Where can I buy One Piece cards in Thailand?' },
                a: {
                    th: 'CardStreet รวมการ์ดวันพีชจากผู้ขายทั่วไทยที่ยืนยันตัวตนแล้ว ทั้งการ์ดเดี่ยวและกล่องซีล ชำระผ่านบัตรหรือพร้อมเพย์ พร้อมระบบคุ้มครองผู้ซื้อ',
                    en: 'CardStreet lists One Piece singles and sealed product from identity-verified sellers across Thailand, with card or PromptPay payment and buyer protection.',
                },
            },
            {
                q: { th: 'การ์ดวันพีชภาษาญี่ปุ่นกับภาษาอังกฤษต่างกันยังไง?', en: 'What is the difference between Japanese and English One Piece cards?' },
                a: {
                    th: 'เนื้อหาเกมเหมือนกัน แต่ออกวางจำหน่ายคนละช่วงเวลาและราคาตลาดต่างกัน CardStreet มีทั้งสองเวอร์ชันพร้อมราคาแยกของแต่ละภาษา ให้เลือกสะสมได้ตามที่ต้องการ',
                    en: 'Gameplay is identical, but releases and market prices differ. CardStreet catalogs both versions with separate prices per language so you can collect either.',
                },
            },
            {
                q: { th: 'เช็คราคาการ์ดวันพีชยังไง?', en: 'How do I check One Piece card prices?' },
                a: {
                    th: 'เปิดหน้าการ์ดใน CardStreet เพื่อดูราคาตลาดล่าสุดได้ฟรี หรือสแกนการ์ดด้วยแอปเพื่อเช็คราคาทันที',
                    en: 'Open any card page on CardStreet for a free live market price, or scan the card with the app for an instant price check.',
                },
            },
            {
                q: { th: 'การ์ดวันพีชแบบ Parallel หรือ Alternate Art ราคาต่างจากแบบธรรมดาไหม?', en: 'Are parallel and alternate art One Piece cards worth more?' },
                a: {
                    th: 'ต่างกันมาก การ์ดใบเดียวกันที่เป็นเวอร์ชันภาพพิเศษหรือ Parallel มักมีราคาสูงกว่าเวอร์ชันธรรมดาหลายเท่า เพราะออกมาในอัตราที่น้อยกว่ามาก เวลาเช็คราคาจึงต้องดูให้ตรงเวอร์ชัน ไม่ใช่ดูแค่ชื่อการ์ด CardStreet แยกราคาของแต่ละเวอร์ชันไว้คนละรายการเพื่อไม่ให้สับสน',
                    en: 'Substantially. An alternate art or parallel version of the same card usually sells for several times the regular version, because it is printed at a much lower rate. That means matching the exact version when you check a price, not just the card name — CardStreet lists each version separately so the two do not get mixed up.',
                },
            },
            {
                q: { th: 'ซื้อกล่องการ์ดวันพีชแบบยังไม่แกะได้ไหม?', en: 'Can I buy sealed One Piece boxes?' },
                a: {
                    th: 'ได้ CardStreet มีทั้งบูสเตอร์บ็อกซ์ บูสเตอร์แพ็ค และสตาร์ทเตอร์เด็ค ทั้งฉบับภาษาอังกฤษและภาษาญี่ปุ่น พร้อมราคาตลาด สินค้าซีลของวันพีชมักหมดเร็วในรอบวางขายแรก ราคาของชุดที่เลิกผลิตแล้วจึงมักสูงกว่าราคาป้ายเดิม',
                    en: 'Yes — booster boxes, booster packs, and starter decks in both the English and Japanese editions, with market prices. One Piece sealed product often sells out on its first print run, so boxes from sets that are no longer being made typically trade above their original retail price.',
                },
            },
            {
                q: { th: 'ขายการ์ดวันพีชบน CardStreet ได้ไหม?', en: 'Can I sell One Piece cards on CardStreet?' },
                a: {
                    th: 'ได้ สมัครฟรีและลงขายได้ทันที ไม่มีค่าลงประกาศ เสียค่าธรรมเนียมเฉพาะตอนขายได้จริง ระบบจะแนะนำราคาให้จากราคาตลาดล่าสุด รับเงินผ่านระบบที่ปลอดภัย และพิมพ์ใบจัดส่ง Flash Express ได้ในแอปเลย',
                    en: 'Yes. Signing up is free, listing is free, and you pay a fee only when a card actually sells. CardStreet suggests a price from current market data, handles payment securely, and lets you print a Flash Express shipping label straight from the app.',
                },
            },
        ],
    },
    {
        slug: 'yugioh',
        gameId: 'yugioh',
        // Thai writes the franchise both ways: ยูกิ (clipped, conversational) and
        // ยูกิโอ (the full name, and the label lib/games.ts uses on set pages).
        // The page said only ยูกิ. Leading with ยูกิโอ costs nothing and covers
        // both, because ยูกิโอ contains ยูกิ as a substring — a search for the
        // short form still matches every occurrence of the long one.
        title: {
            th: 'การ์ดยูกิโอ (Yu-Gi-Oh!) — ซื้อ ขาย เช็คราคาการ์ดยูกิในไทย | CardStreet',
            en: 'Yu-Gi-Oh! Cards Thailand — Buy, Sell & Prices | CardStreet',
        },
        description: {
            th: 'ซื้อขายการ์ดยูกิโอ Yu-Gi-Oh! ในไทย เช็คราคาตลาดเรียลไทม์ทุกใบ ผู้ขายยืนยันตัวตน ระบบคุ้มครองผู้ซื้อ ส่งทั่วไทย',
            en: 'Buy and sell Yu-Gi-Oh! cards in Thailand with live market prices, verified sellers, buyer protection, and nationwide delivery.',
        },
        h1: {
            th: 'การ์ดยูกิโอ (Yu-Gi-Oh!)',
            en: 'Yu-Gi-Oh! Cards in Thailand',
        },
        intro: {
            th: [
                'ตลาดซื้อขายการ์ดยูกิโอสำหรับนักเล่นและนักสะสมชาวไทย ครอบคลุมการ์ด Yu-Gi-Oh! ตั้งแต่ชุดคลาสสิกจนถึงชุดล่าสุด พร้อมราคาตลาดที่อัปเดตทุกวันให้เทียบก่อนซื้อหรือตั้งขาย',
                'ทุกออเดอร์ได้รับความคุ้มครอง ผู้ขายผ่านการยืนยันตัวตน ชำระผ่านบัตรหรือพร้อมเพย์ และจัดส่งทั่วประเทศด้วย Flash Express',
                'วิธีเช็คราคาการ์ดยูกิบน CardStreet เริ่มจากพิมพ์ชื่อการ์ดหรือรหัสการ์ดที่พิมพ์อยู่บนตัวการ์ด แล้วเปิดหน้าการ์ดใบนั้นเพื่อดูราคาตลาดเป็นเงินบาทพร้อมกราฟราคาย้อนหลัง แคตตาล็อกของเรารวมทั้งการ์ดภาษาอังกฤษ (TCG) และการ์ดภาษาญี่ปุ่น (OCG) กว่า 45,000 ใบ จาก 800 กว่าชุด จึงหาการ์ดเก่าที่หายากหรือการ์ดที่วางขายเฉพาะในญี่ปุ่นได้ในที่เดียวกัน',
            ],
            en: [
                'A Yu-Gi-Oh! marketplace for Thai players and collectors, covering sets from classic to current with market prices updated daily — compare before you buy or list.',
                'Every order is protected, sellers are identity-verified, payment works by card or PromptPay, and delivery is nationwide via Flash Express.',
                'To check a Yu-Gi-Oh card price on CardStreet, search the card name or the set code printed on the card, then open the card page for its market price in Thai baht with price history. The catalog covers both the English TCG and the Japanese OCG — more than 45,000 cards across 800-plus sets — so older hard-to-find cards and Japan-only prints are searchable in the same place.',
            ],
        },
        faqs: [
            {
                q: { th: 'ซื้อการ์ดยูกิแท้ได้ที่ไหนในไทย?', en: 'Where can I buy authentic Yu-Gi-Oh! cards in Thailand?' },
                a: {
                    th: 'CardStreet รวมการ์ดยูกิจากผู้ขายที่ยืนยันตัวตนทั่วไทย พร้อมระบบคุ้มครองผู้ซื้อทุกออเดอร์และการจัดส่งด้วย Flash Express',
                    en: 'CardStreet lists Yu-Gi-Oh! cards from identity-verified sellers across Thailand, with buyer protection on every order and Flash Express delivery.',
                },
            },
            {
                q: { th: 'เช็คราคาการ์ดยูกิยังไง?', en: 'How do I check Yu-Gi-Oh! card prices?' },
                a: {
                    th: 'หน้าการ์ดทุกใบใน CardStreet แสดงราคาตลาดล่าสุดฟรี หรือใช้แอปสแกนการ์ดจริงเพื่อเช็คราคาทันที',
                    en: 'Every card page on CardStreet shows a free live market price, or scan a physical card with the app for an instant check.',
                },
            },
            {
                q: { th: 'ขายการ์ดยูกิบน CardStreet ได้ไหม?', en: 'Can I sell Yu-Gi-Oh! cards on CardStreet?' },
                a: {
                    th: 'ได้ สมัครฟรี ลงขายได้ทันที พร้อมราคาแนะนำจากตลาดจริงและระบบจัดส่งในตัว',
                    en: 'Yes — sign up free and list immediately, with suggested prices from real market data and built-in shipping.',
                },
            },
            {
                q: { th: 'การ์ดยูกิ OCG กับ TCG ต่างกันยังไง?', en: 'What is the difference between Yu-Gi-Oh OCG and TCG?' },
                a: {
                    th: 'OCG คือฉบับภาษาญี่ปุ่นที่วางขายในเอเชีย ส่วน TCG คือฉบับภาษาอังกฤษที่วางขายในฝั่งตะวันตก ทั้งสองฝั่งมีรายชื่อการ์ดที่ใช้แข่งขันได้ไม่เหมือนกัน ออกชุดคนละเวลา และบางใบมีเฉพาะฝั่งเดียว ราคาจึงต่างกันได้มากแม้เป็นการ์ดใบเดียวกัน CardStreet แยกราคาของทั้งสองฝั่งให้ดูเทียบกันได้',
                    en: 'OCG is the Japanese edition sold across Asia; TCG is the English edition sold in Western markets. They maintain different competitive card pools, release sets on different schedules, and some cards exist on only one side — so the same card can be worth very different amounts in each. CardStreet prices both separately so you can compare them.',
                },
            },
            {
                q: { th: 'ขายการ์ดยูกิเก่าที่เก็บไว้นานได้ราคาไหม?', en: 'Are old Yu-Gi-Oh cards from years ago worth anything?' },
                a: {
                    th: 'บางใบได้ราคาดีมาก โดยเฉพาะการ์ดจากชุดยุคแรกที่พิมพ์ออกมาน้อย การ์ดระดับ Secret Rare หรือ Ultimate Rare และการ์ดโปรโมทจากงานแข่ง แต่การ์ดธรรมดาจากชุดที่พิมพ์ซ้ำหลายรอบมักมีมูลค่าไม่มาก วิธีที่เร็วที่สุดคือค้นหาการ์ดแต่ละใบใน CardStreet แล้วดูราคาตลาดล่าสุด หรือสแกนด้วยแอปทีละใบเพื่อประเมินทั้งกอง',
                    en: 'Some are worth a great deal — particularly early-era cards with small print runs, Secret and Ultimate Rares, and tournament promos — while commons from heavily reprinted sets usually are not. The fastest way to find out is to search each card on CardStreet for its current market price, or scan them one by one in the app to value a whole stack.',
                },
            },
            {
                q: { th: 'เช็คราคาการ์ดยูกิที่ผ่านการเกรดยังไง?', en: 'How do I check prices for graded Yu-Gi-Oh cards?' },
                a: {
                    th: 'หน้าการ์ดบน CardStreet แสดงราคาการ์ดที่ผ่านการเกรดแยกตามบริษัทและระดับเกรด ทั้ง PSA, BGS, CGC และ TAG วางไว้ข้างราคาการ์ดแบบไม่เกรด ทำให้เห็นได้ทันทีว่าการ์ดใบนั้นเมื่อเกรดแล้วมูลค่าต่างจากเดิมเท่าไหร่ ซึ่งเป็นตัวเลขที่ควรดูก่อนตัดสินใจส่งการ์ดไปเกรด',
                    en: 'CardStreet card pages show graded prices broken out by grading company and grade — PSA, BGS, CGC, and TAG — next to the raw price, so you can see immediately how much grading changes what a card is worth. That is the number worth looking at before you decide to send anything in.',
                },
            },
        ],
    },
    {
        slug: 'mtg',
        gameId: 'mtg',
        // เมจิก is this site's own Thai label for the game (lib/games.ts) and every
        // MTG set page renders it as การ์ดเมจิก — but the landing page, which is
        // what ranks, never said the word. Added to the title, description and
        // first intro line alongside the Latin name.
        title: {
            th: 'การ์ดเมจิก Magic: The Gathering (MTG) — ซื้อ ขาย เช็คราคาในไทย | CardStreet',
            en: 'Magic: The Gathering Cards Thailand — Buy, Sell & Prices | CardStreet',
        },
        description: {
            th: 'ซื้อขายการ์ดเมจิก MTG (Magic: The Gathering) ในไทย เช็คราคาตลาดเรียลไทม์ ผู้ขายยืนยันตัวตน ระบบคุ้มครองผู้ซื้อ ส่งทั่วไทย',
            en: 'Buy and sell Magic: The Gathering singles in Thailand with live market prices, verified sellers, buyer protection, and nationwide delivery.',
        },
        h1: {
            th: 'การ์ดเมจิก Magic: The Gathering (MTG)',
            en: 'Magic: The Gathering Cards in Thailand',
        },
        intro: {
            th: [
                'ตลาดซื้อขายการ์ดเมจิก Magic: The Gathering สำหรับผู้เล่นชาวไทย ครอบคลุมการ์ดเดี่ยวจากหลายยุคหลายชุด พร้อมราคาตลาดที่อัปเดตทุกวัน จะหาการ์ดลง Commander, Modern หรือสะสม ก็เทียบราคาได้ก่อนตัดสินใจ',
                'ซื้อจากผู้ขายในไทยที่ยืนยันตัวตนแล้ว ไม่ต้องรอของจากต่างประเทศ ทุกออเดอร์มีระบบคุ้มครองผู้ซื้อและจัดส่งด้วย Flash Express',
                'วิธีเช็คราคาการ์ด MTG บน CardStreet ให้พิมพ์ชื่อการ์ดเป็นภาษาอังกฤษแล้วเปิดหน้าการ์ดใบนั้น จะเห็นราคาตลาดเป็นเงินบาทพร้อมกราฟราคาย้อนหลัง 7 30 และ 90 วัน ซึ่งช่วยให้เห็นว่าการ์ดกำลังขึ้นหรือลงก่อนตัดสินใจซื้อหรือขาย การ์ดใบเดียวกันที่มาจากคนละชุดหรือคนละเวอร์ชันจะมีราคาไม่เท่ากัน จึงควรเลือกให้ตรงชุดที่ถืออยู่',
            ],
            en: [
                'A Magic: The Gathering marketplace for players in Thailand, covering singles across eras and sets with daily-updated market prices — whether you’re building Commander, Modern, or a collection.',
                'Buy from identity-verified sellers inside Thailand — no overseas shipping wait — with buyer protection on every order and Flash Express delivery.',
                'To check an MTG card price on CardStreet, search the card name in English and open its card page for the market price in Thai baht with 7, 30, and 90-day history — useful for seeing whether a card is climbing or falling before you buy or sell. The same card from a different set or a different treatment is priced differently, so pick the printing that matches the one you hold.',
            ],
        },
        faqs: [
            {
                q: { th: 'ซื้อการ์ด MTG ในไทยได้ที่ไหน?', en: 'Where can I buy MTG cards in Thailand?' },
                a: {
                    th: 'CardStreet รวมการ์ด Magic: The Gathering จากผู้ขายในไทยที่ยืนยันตัวตนแล้ว ส่งไวในประเทศ ไม่ต้องรอพัสดุจากต่างประเทศ',
                    en: 'CardStreet lists Magic: The Gathering singles from identity-verified sellers inside Thailand — fast domestic delivery, no overseas wait.',
                },
            },
            {
                q: { th: 'เช็คราคาการ์ด MTG ยังไง?', en: 'How do I check MTG card prices?' },
                a: {
                    th: 'หน้าการ์ดทุกใบแสดงราคาตลาดล่าสุดฟรี อ้างอิงข้อมูลตลาดสากลและแปลงเป็นบาทให้อัตโนมัติ',
                    en: 'Every card page shows a free live market price, referenced from international market data and converted to Thai baht automatically.',
                },
            },
            {
                q: { th: 'ขายการ์ด MTG บน CardStreet ได้ไหม?', en: 'Can I sell MTG cards on CardStreet?' },
                a: {
                    th: 'ได้ สมัครฟรีและลงขายได้ทันที พร้อมราคาแนะนำและระบบจัดส่งในตัว',
                    en: 'Yes — sign up free and list immediately, with suggested pricing and built-in shipping.',
                },
            },
            {
                q: { th: 'การ์ด MTG ใบเดียวกันแต่คนละชุด ราคาต่างกันไหม?', en: 'Does the same MTG card cost different amounts across sets?' },
                a: {
                    th: 'ต่างกัน การ์ดชื่อเดียวกันที่พิมพ์ในคนละชุดถือเป็นคนละรายการในตลาด เวอร์ชันแรกหรือเวอร์ชันที่พิมพ์น้อยมักมีราคาสูงกว่าเวอร์ชันที่พิมพ์ซ้ำ และแบบ Foil ก็มักสูงกว่าแบบธรรมดา เวลาเช็คราคาจึงควรเลือกชุดและเวอร์ชันให้ตรงกับใบที่มีอยู่จริง',
                    en: 'Yes. The same card name printed in different sets is a different item to the market: original or low-print-run printings usually sell above reprints, and foils usually sell above non-foils. When checking a price, select the set and treatment that matches the copy you actually have.',
                },
            },
            {
                q: { th: 'ขายการ์ด MTG ทั้งกองได้ไหม?', en: 'Can I sell a whole MTG collection?' },
                a: {
                    th: 'ได้ ลงขายได้ทีละใบตามที่ต้องการ ไม่มีค่าลงประกาศและเสียค่าธรรมเนียมเฉพาะตอนขายได้ ถ้ามีการ์ดจำนวนมากแนะนำให้เริ่มจากใบที่มีมูลค่าสูงก่อน เพราะเป็นกลุ่มที่ผู้ซื้อค้นหามากที่สุด ระบบจะแนะนำราคาให้จากราคาตลาดล่าสุดของแต่ละใบ',
                    en: 'Yes — list as many individual cards as you like, with no listing fee and a fee only when something sells. If you have a large collection, start with the higher-value cards: those are what buyers search for most. CardStreet suggests a price for each card from current market data.',
                },
            },
            {
                q: { th: 'เช็คราคาการ์ด MTG ที่ผ่านการเกรดได้ไหม?', en: 'Can I check prices for graded MTG cards?' },
                a: {
                    th: 'ได้ หน้าการ์ดจะแสดงราคาของการ์ดที่ผ่านการเกรดแยกตามบริษัทและระดับเกรด ทั้ง PSA, BGS, CGC และ TAG ควบคู่กับราคาการ์ดแบบไม่เกรด ทำให้เทียบได้ในหน้าเดียวว่าการ์ดใบนั้นเมื่อเกรดแล้วมูลค่าเปลี่ยนไปแค่ไหน',
                    en: 'Yes. Card pages show graded prices broken out by grading company and grade — PSA, BGS, CGC, and TAG — next to the raw price, so you can compare on one screen how much grading changes what a card is worth.',
                },
            },
        ],
    },
    {
        slug: 'lorcana',
        gameId: 'lorcana',
        // Thai collectors search for this game by the Disney brand, not the
        // Lorcana one: "การ์ดดิสนีย์" and "เช็คราคาการ์ดดิสนีย์" both rank for this
        // page in Search Console while the phrase appeared nowhere on it. The
        // Thai copy now leads with การ์ดดิสนีย์ and keeps the Latin name beside
        // it, so one URL serves both vocabularies.
        title: {
            th: 'การ์ดดิสนีย์ Disney Lorcana — ซื้อ ขาย เช็คราคาในไทย | CardStreet',
            en: 'Disney Lorcana Cards Thailand — Buy, Sell & Prices | CardStreet',
        },
        description: {
            th: 'ซื้อขายการ์ดดิสนีย์ Disney Lorcana ในไทย เช็คราคาการ์ดดิสนีย์แบบเรียลไทม์ ผู้ขายยืนยันตัวตน ระบบคุ้มครองผู้ซื้อ ส่งทั่วไทย',
            en: 'Buy and sell Disney Lorcana cards in Thailand with live market prices, verified sellers, buyer protection, and nationwide delivery.',
        },
        h1: {
            th: 'การ์ด Disney Lorcana',
            en: 'Disney Lorcana Cards in Thailand',
        },
        intro: {
            th: [
                'การ์ดดิสนีย์ Disney Lorcana หรือที่หลายคนเขียนว่าการ์ดลอคาน่า คือเกมการ์ดสะสมที่คนไทยเล่นและเก็บกันมากขึ้นทุกปี CardStreet คือตลาดซื้อขายสำหรับนักสะสมชาวไทยโดยเฉพาะ รวมการ์ดตัวละครดิสนีย์ตั้งแต่ชุดแรก The First Chapter จนถึงชุดล่าสุด พร้อมราคาตลาดอัปเดตทุกวัน',
                'ซื้อจากผู้ขายที่ยืนยันตัวตนในไทย มีระบบคุ้มครองผู้ซื้อทุกออเดอร์ และจัดส่งทั่วประเทศ หรือลงขายการ์ดของคุณเองได้ฟรี',
                'วิธีเช็คราคาการ์ดดิสนีย์ให้แม่น ราคาการ์ด Lorcana ในไทยขยับตามราคาตลาดโลกและตามของที่มีขายจริงในประเทศ ให้พิมพ์ชื่อตัวละครหรือชื่อการ์ดเป็นภาษาอังกฤษ แล้วเปิดหน้าการ์ดเพื่อดูราคาตลาดเป็นเงินบาท วันที่อัปเดตล่าสุด และรายการที่มีคนลงขายอยู่ตอนนี้ จะได้เทียบทันทีว่าราคาที่เห็นในกลุ่มซื้อขายถูกหรือแพงกว่าราคากลาง การ์ด Lorcana ใบเดียวกันมีหลายระดับความหายากและมีทั้งแบบธรรมดาและแบบ Foil ซึ่งราคาไม่เท่ากัน จึงควรเลือกให้ตรงกับใบที่ถืออยู่ ดูราคาทั้งชุดพร้อมกันได้จากหน้าชุดการ์ด',
            ],
            en: [
                'Disney Lorcana is a collectible card game with a fast-growing following in Thailand. CardStreet is a marketplace built for collectors here, covering Disney character cards from The First Chapter to the latest set with daily-updated market prices.',
                'Buy from identity-verified sellers in Thailand with buyer protection on every order and nationwide delivery — or list your own cards free.',
                'How to check a Disney Lorcana price accurately: prices here track both the global market and what is actually available locally. Search the character or card name in English and open the card page for its market price in Thai baht, when it was last updated, and any live listings — so you can tell at a glance whether a price quoted in a buy-sell group is above or below the going rate. The same Lorcana card exists at several rarities and in foil and non-foil, which are not worth the same, so match the version you hold. Set pages show every card in a set with its price together.',
            ],
        },
        faqs: [
            {
                q: { th: 'การ์ดดิสนีย์ (Disney Lorcana) ซื้อที่ไหนในไทยดี?', en: 'Where can I buy Disney Lorcana cards in Thailand?' },
                a: {
                    th: 'ซื้อได้ทั้งจากร้านการ์ดหน้าร้าน กลุ่มซื้อขายบนโซเชียล และมาร์เก็ตเพลสออนไลน์ ข้อดีของการซื้อผ่าน CardStreet คือเห็นราคาตลาดของการ์ดใบนั้นควบคู่ไปกับราคาที่ผู้ขายตั้ง จึงรู้ทันทีว่าคุ้มไหม ผู้ขายทุกคนยืนยันตัวตนแล้ว มีระบบคุ้มครองผู้ซื้อ และจัดส่งทั่วไทย',
                    en: 'Through local card shops, social buy-sell groups, or online marketplaces. Buying on CardStreet shows you the card’s market price next to the seller’s asking price, so you know immediately whether it is a fair deal. Every seller is identity-verified, purchases are covered by buyer protection, and shipping is nationwide.',
                },
            },
            {
                q: { th: 'Disney Lorcana คือการ์ดเกมอะไร?', en: 'What is Disney Lorcana?' },
                a: {
                    th: 'Disney Lorcana คือการ์ดเกมสะสมจาก Ravensburger ที่รวมตัวละครดิสนีย์ในภาพวาดสไตล์ใหม่ เป็นหนึ่งในการ์ดเกมที่เติบโตเร็วที่สุดในโลกและเริ่มได้รับความนิยมในไทย',
                    en: 'Disney Lorcana is Ravensburger’s collectible card game featuring Disney characters in new art styles — one of the fastest-growing TCGs worldwide and gaining popularity in Thailand.',
                },
            },
            {
                q: { th: 'เช็คราคาการ์ด Lorcana ยังไง?', en: 'How do I check Lorcana card prices?' },
                a: {
                    th: 'หน้าการ์ดทุกใบใน CardStreet แสดงราคาตลาดล่าสุดฟรี แปลงเป็นบาทให้อัตโนมัติ',
                    en: 'Every card page on CardStreet shows a free live market price, converted to Thai baht automatically.',
                },
            },
            {
                q: { th: 'การ์ด Lorcana ระดับไหนที่หายากและมีราคาสูง?', en: 'Which Lorcana rarities are the valuable ones?' },
                a: {
                    th: 'ระดับที่หายากที่สุดในแต่ละชุดคือ Legendary และการ์ดภาพพิเศษอย่าง Enchanted ซึ่งออกมาในอัตราที่น้อยมากและมักมีราคาสูงกว่าการ์ดทั่วไปในชุดเดียวกันหลายเท่า รองลงมาคือ Super Rare และ Rare ส่วนการ์ด Common และ Uncommon มักมีมูลค่าไม่มากนอกจากจะเป็นใบที่ใช้ในเด็คยอดนิยม',
                    en: 'The scarcest in each set are Legendary cards and special-art Enchanted versions, which are pulled at very low rates and typically sell for several times a regular card from the same set. Super Rare and Rare come next, while Commons and Uncommons are usually modest unless they see heavy play in a popular deck.',
                },
            },
            {
                q: { th: 'ซื้อการ์ด Lorcana ในไทยยากไหม?', en: 'Is Disney Lorcana hard to find in Thailand?' },
                a: {
                    th: 'Lorcana ยังไม่มีการวางจำหน่ายเป็นภาษาไทย ของที่หาซื้อได้ในไทยจึงเป็นฉบับภาษาอังกฤษที่นำเข้ามา ทำให้ร้านที่มีของครบไม่ได้มีเยอะ CardStreet รวมผู้ขายที่มีการ์ด Lorcana ทั่วไทยไว้ในที่เดียว พร้อมราคาตลาดอ้างอิงให้เทียบก่อนซื้อ และมีระบบแจ้งเตือนเมื่อมีคนลงขายการ์ดใบที่ต้องการ',
                    en: 'Lorcana has no Thai-language release, so what circulates here is the imported English edition and few shops carry a full range. CardStreet brings Lorcana sellers from across Thailand into one place with reference market prices to compare before buying, and will alert you when someone lists a card you are watching.',
                },
            },
            {
                q: { th: 'ขายการ์ด Lorcana บน CardStreet ได้ไหม?', en: 'Can I sell Lorcana cards on CardStreet?' },
                a: {
                    th: 'ได้ และตอนนี้เป็นจังหวะที่ดีเพราะมีคนค้นหาการ์ด Lorcana ในไทยมากกว่าจำนวนรายการที่มีคนลงขายอยู่ สมัครฟรี ลงขายฟรี เสียค่าธรรมเนียมเฉพาะตอนขายได้จริง ระบบแนะนำราคาให้จากราคาตลาดล่าสุดและมีระบบจัดส่งในตัว',
                    en: 'Yes, and right now there is more demand than supply — more people search for Lorcana cards in Thailand than there are listings for them. Signing up and listing are free, you pay only when a card sells, CardStreet suggests a price from current market data, and shipping is built in.',
                },
            },
        ],
    },
    {
        slug: 'riftbound',
        gameId: 'riftbound',
        title: {
            th: 'การ์ด Riftbound (การ์ดเกม LoL - League of Legends) — ซื้อ ขาย เช็คราคา | CardStreet',
            en: 'Riftbound (League of Legends TCG) Thailand — Buy, Sell & Prices | CardStreet',
        },
        description: {
            th: 'ซื้อขายการ์ด Riftbound การ์ดเกม LoL (League of Legends) จาก Riot Games ในไทย เช็คราคาตลาดเรียลไทม์ ผู้ขายยืนยันตัวตน ส่งทั่วไทย',
            en: 'Buy and sell Riftbound — the League of Legends trading card game by Riot Games — in Thailand with live market prices, verified sellers, and nationwide delivery.',
        },
        h1: {
            th: 'การ์ด Riftbound (League of Legends TCG)',
            en: 'Riftbound — League of Legends TCG in Thailand',
        },
        intro: {
            th: [
                'Riftbound คือการ์ดเกมสะสมจากจักรวาล League of Legends (LoL) โดย Riot Games หรือที่คนไทยเรียกกันสั้น ๆ ว่าการ์ดเกม LoL นั่นเอง CardStreet รวมการ์ด Riftbound พร้อมราคาตลาดอัปเดตทุกวัน ให้นักสะสมชาวไทยตามเก็บแชมเปียนอย่าง Jinx, Yasuo และ Ahri ได้ตั้งแต่วันแรก',
                'ซื้อจากผู้ขายที่ยืนยันตัวตนในไทย มีระบบคุ้มครองผู้ซื้อทุกออเดอร์ และจัดส่งทั่วประเทศ หรือลงขายการ์ดของคุณเองได้ฟรี',
                'วิธีเช็คราคาการ์ด Riftbound บน CardStreet ให้พิมพ์ชื่อการ์ดหรือชื่อแชมเปี้ยนจาก League of Legends ที่อยู่บนการ์ด แล้วเปิดหน้าการ์ดเพื่อดูราคาตลาดเป็นเงินบาทพร้อมกราฟราคาย้อนหลัง เนื่องจาก Riftbound เพิ่งเริ่มวางจำหน่าย ราคาจึงยังขยับได้เร็วในช่วงนี้ การดูกราฟย้อนหลังก่อนตัดสินใจซื้อหรือขายจึงช่วยได้มาก',
            ],
            en: [
                'Riftbound is the collectible card game set in the League of Legends universe by Riot Games. CardStreet catalogs Riftbound cards with daily-updated market prices so Thai collectors can chase champions like Jinx, Yasuo, and Ahri from day one.',
                'Buy from identity-verified sellers in Thailand with buyer protection on every order and nationwide delivery — or list your own cards free.',
                'To check a Riftbound card price on CardStreet, search the card name or the League of Legends champion on it, then open the card page for its market price in Thai baht with price history. Riftbound is a new release, so prices can still move quickly — checking the history chart before you buy or sell is worth the extra few seconds.',
            ],
        },
        faqs: [
            {
                q: { th: 'Riftbound คืออะไร?', en: 'What is Riftbound?' },
                a: {
                    th: 'Riftbound คือการ์ดเกมสะสม (TCG) อย่างเป็นทางการจากจักรวาล League of Legends พัฒนาโดย Riot Games มีการ์ดแชมเปียนและสกินจากเกมให้สะสมและเล่นแข่งกัน',
                    en: 'Riftbound is the official trading card game of the League of Legends universe, developed by Riot Games, featuring collectible champion cards for play and collection.',
                },
            },
            {
                q: { th: 'ซื้อการ์ด Riftbound ในไทยได้ที่ไหน?', en: 'Where can I buy Riftbound cards in Thailand?' },
                a: {
                    th: 'CardStreet รวมการ์ด Riftbound จากผู้ขายในไทยที่ยืนยันตัวตนแล้ว พร้อมราคาตลาดล่าสุด ระบบคุ้มครองผู้ซื้อ และจัดส่งทั่วประเทศ',
                    en: 'CardStreet lists Riftbound cards from identity-verified sellers in Thailand, with live market prices, buyer protection, and nationwide delivery.',
                },
            },
            {
                q: { th: 'เช็คราคาการ์ด Riftbound ยังไง?', en: 'How do I check Riftbound card prices?' },
                a: {
                    th: 'หน้าการ์ดทุกใบใน CardStreet แสดงราคาตลาดล่าสุดฟรี แปลงเป็นบาทให้อัตโนมัติ',
                    en: 'Every card page on CardStreet shows a free live market price, converted to Thai baht automatically.',
                },
            },
            {
                q: { th: 'การ์ด Riftbound ใบไหนที่มีราคาสูง?', en: 'Which Riftbound cards are the expensive ones?' },
                a: {
                    th: 'ส่วนใหญ่เป็นการ์ดแชมเปี้ยนระดับหายากและการ์ดที่มีภาพพิเศษ ซึ่งออกมาในอัตราที่น้อยกว่าการ์ดทั่วไปมาก เนื่องจากเกมยังใหม่ ราคาของการ์ดกลุ่มนี้จึงยังเปลี่ยนแปลงได้ตามความนิยมของแต่ละแชมเปี้ยน ดูราคาล่าสุดของทุกใบในชุดได้จากหน้าชุดการ์ดบน CardStreet',
                    en: 'Mostly the higher-rarity champion cards and special-art versions, which are pulled at much lower rates than regular cards. Because the game is still new, prices in this group can shift with how popular each champion is. Set pages on CardStreet show the current price for every card in a set.',
                },
            },
            {
                q: { th: 'Riftbound มีขายเป็นภาษาไทยไหม?', en: 'Is Riftbound available in Thai?' },
                a: {
                    th: 'ยังไม่มีฉบับภาษาไทย การ์ด Riftbound ที่ซื้อขายกันในไทยตอนนี้เป็นฉบับภาษาอังกฤษ CardStreet จึงรวบรวมผู้ขายที่มีการ์ด Riftbound ทั่วประเทศไว้ในที่เดียว พร้อมราคาตลาดอ้างอิงและระบบแจ้งเตือนเมื่อมีคนลงขายใบที่คุณตามหา',
                    en: 'Not yet — the Riftbound cards trading in Thailand are the English edition. CardStreet gathers Riftbound sellers from across the country in one place, with reference market prices and alerts when someone lists a card you are watching.',
                },
            },
            {
                q: { th: 'เพิ่งเริ่มเล่น Riftbound ควรซื้ออะไรก่อน?', en: 'I am new to Riftbound — what should I buy first?' },
                a: {
                    th: 'คนที่เพิ่งเริ่มมักเริ่มจากชุดเริ่มต้นที่พร้อมเล่นได้ทันที แล้วค่อยหาซื้อการ์ดใบเดี่ยวเพิ่มเฉพาะใบที่ต้องใช้จริง วิธีนี้ประหยัดกว่าการไล่ซื้อแพ็คสุ่ม เพราะเลือกได้ว่าจะจ่ายเงินให้ใบไหน เช็คราคาการ์ดแต่ละใบบน CardStreet ก่อนตัดสินใจได้ฟรี',
                    en: 'Most new players start with a ready-to-play starter set and then buy only the individual cards they actually need. That works out cheaper than chasing random packs, because you choose exactly what you pay for. You can check the price of any single card on CardStreet for free before deciding.',
                },
            },
        ],
    },
];

export function getGameLanding(slug: string): GameLandingContent | null {
    return GAME_LANDINGS.find((g) => g.slug === slug) ?? null;
}
