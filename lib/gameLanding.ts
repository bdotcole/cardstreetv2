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
        title: {
            th: 'การ์ดโปเกมอน — ซื้อ ขาย เช็คราคาการ์ดโปเกมอนในไทย | CardStreet',
            en: 'Pokémon Cards Thailand — Buy, Sell & Check Prices | CardStreet',
        },
        description: {
            th: 'ตลาดซื้อขายการ์ดโปเกมอนออนไลน์ในไทย ครบทั้งการ์ดภาษาไทย อังกฤษ และญี่ปุ่นกว่า 30,000 ใบ เช็คราคาตลาดเรียลไทม์ สแกนการ์ดด้วย AI ผู้ขายยืนยันตัวตน ส่งทั่วไทย',
            en: 'Buy and sell Pokémon TCG cards in Thailand — Thai, English, and Japanese sets with live market prices, AI card scanning, verified sellers, and nationwide delivery.',
        },
        h1: {
            th: 'การ์ดโปเกมอน (Pokémon TCG)',
            en: 'Pokémon TCG Cards in Thailand',
        },
        intro: {
            th: [
                'CardStreet คือตลาดซื้อขายการ์ดโปเกมอนออนไลน์สำหรับนักสะสมชาวไทย รวมการ์ดโปเกมอนภาษาไทย ภาษาอังกฤษ และภาษาญี่ปุ่นไว้ในที่เดียว พร้อมราคาตลาดที่อัปเดตทุกวัน ไม่ว่าจะเป็นชุดล่าสุดหรือการ์ดหายากระดับ Secret Rare ก็เช็คราคาและหาซื้อได้ที่นี่',
                'ทุกการซื้อได้รับความคุ้มครองผ่านระบบชำระเงินที่ปลอดภัย ผู้ขายทุกคนผ่านการยืนยันตัวตน และจัดส่งทั่วประเทศด้วย Flash Express นักสะสมยังสแกนการ์ดด้วย AI เพื่อเช็คราคาและเก็บเข้าคอลเลกชันได้ฟรีผ่านแอป CardStreet',
            ],
            en: [
                'CardStreet is Thailand’s online marketplace for Pokémon TCG collectors, bringing Thai, English, and Japanese Pokémon cards together in one catalog with market prices updated daily — from the newest sets to chase Secret Rares.',
                'Every purchase is protected by secure checkout, sellers are identity-verified, and orders ship nationwide via Flash Express. You can also scan any card with AI to check its price and track your collection for free in the CardStreet app.',
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
                    th: 'ดูราคาตลาดล่าสุดได้ฟรีบนหน้าการ์ดทุกใบใน CardStreet หรือสแกนการ์ดจริงด้วยแอป CardStreet เพื่อเช็คราคาทันที รองรับทั้งการ์ดภาษาไทย อังกฤษ และญี่ปุ่น',
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
            ],
            en: [
                'A marketplace for One Piece Card Game collectors in Thailand, covering English and Japanese versions — from popular Leaders and Secret Rares like Luffy, Shanks, and Nami to sealed booster boxes, all with daily-updated market prices.',
                'Buy from identity-verified sellers across Thailand with buyer protection on every order and Flash Express delivery — or sign up free and list your own cards.',
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
        ],
    },
    {
        slug: 'yugioh',
        gameId: 'yugioh',
        title: {
            th: 'การ์ดยูกิ (Yu-Gi-Oh!) — ซื้อ ขาย เช็คราคาในไทย | CardStreet',
            en: 'Yu-Gi-Oh! Cards Thailand — Buy, Sell & Prices | CardStreet',
        },
        description: {
            th: 'ซื้อขายการ์ดยูกิ Yu-Gi-Oh! ในไทย เช็คราคาตลาดเรียลไทม์ทุกใบ ผู้ขายยืนยันตัวตน ระบบคุ้มครองผู้ซื้อ ส่งทั่วไทย',
            en: 'Buy and sell Yu-Gi-Oh! cards in Thailand with live market prices, verified sellers, buyer protection, and nationwide delivery.',
        },
        h1: {
            th: 'การ์ดยูกิ (Yu-Gi-Oh!)',
            en: 'Yu-Gi-Oh! Cards in Thailand',
        },
        intro: {
            th: [
                'ตลาดซื้อขายการ์ดยูกิสำหรับนักเล่นและนักสะสมชาวไทย ครอบคลุมการ์ด Yu-Gi-Oh! ตั้งแต่ชุดคลาสสิกจนถึงชุดล่าสุด พร้อมราคาตลาดที่อัปเดตทุกวันให้เทียบก่อนซื้อหรือตั้งขาย',
                'ทุกออเดอร์ได้รับความคุ้มครอง ผู้ขายผ่านการยืนยันตัวตน ชำระผ่านบัตรหรือพร้อมเพย์ และจัดส่งทั่วประเทศด้วย Flash Express',
            ],
            en: [
                'A Yu-Gi-Oh! marketplace for Thai players and collectors, covering sets from classic to current with market prices updated daily — compare before you buy or list.',
                'Every order is protected, sellers are identity-verified, payment works by card or PromptPay, and delivery is nationwide via Flash Express.',
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
        ],
    },
    {
        slug: 'mtg',
        gameId: 'mtg',
        title: {
            th: 'การ์ด Magic: The Gathering (MTG) — ซื้อ ขาย เช็คราคาในไทย | CardStreet',
            en: 'Magic: The Gathering Cards Thailand — Buy, Sell & Prices | CardStreet',
        },
        description: {
            th: 'ซื้อขายการ์ด MTG (Magic: The Gathering) ในไทย เช็คราคาตลาดเรียลไทม์ ผู้ขายยืนยันตัวตน ระบบคุ้มครองผู้ซื้อ ส่งทั่วไทย',
            en: 'Buy and sell Magic: The Gathering singles in Thailand with live market prices, verified sellers, buyer protection, and nationwide delivery.',
        },
        h1: {
            th: 'การ์ด Magic: The Gathering (MTG)',
            en: 'Magic: The Gathering Cards in Thailand',
        },
        intro: {
            th: [
                'ตลาดซื้อขายการ์ด Magic: The Gathering สำหรับผู้เล่นชาวไทย ครอบคลุมการ์ดเดี่ยวจากหลายยุคหลายชุด พร้อมราคาตลาดที่อัปเดตทุกวัน จะหาการ์ดลง Commander, Modern หรือสะสม ก็เทียบราคาได้ก่อนตัดสินใจ',
                'ซื้อจากผู้ขายในไทยที่ยืนยันตัวตนแล้ว ไม่ต้องรอของจากต่างประเทศ ทุกออเดอร์มีระบบคุ้มครองผู้ซื้อและจัดส่งด้วย Flash Express',
            ],
            en: [
                'A Magic: The Gathering marketplace for players in Thailand, covering singles across eras and sets with daily-updated market prices — whether you’re building Commander, Modern, or a collection.',
                'Buy from identity-verified sellers inside Thailand — no overseas shipping wait — with buyer protection on every order and Flash Express delivery.',
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
        ],
    },
    {
        slug: 'lorcana',
        gameId: 'lorcana',
        title: {
            th: 'การ์ด Disney Lorcana — ซื้อ ขาย เช็คราคาในไทย | CardStreet',
            en: 'Disney Lorcana Cards Thailand — Buy, Sell & Prices | CardStreet',
        },
        description: {
            th: 'ซื้อขายการ์ด Disney Lorcana ในไทย เช็คราคาตลาดเรียลไทม์ ผู้ขายยืนยันตัวตน ระบบคุ้มครองผู้ซื้อ ส่งทั่วไทย',
            en: 'Buy and sell Disney Lorcana cards in Thailand with live market prices, verified sellers, buyer protection, and nationwide delivery.',
        },
        h1: {
            th: 'การ์ด Disney Lorcana',
            en: 'Disney Lorcana Cards in Thailand',
        },
        intro: {
            th: [
                'ตลาดซื้อขายการ์ด Disney Lorcana สำหรับนักสะสมชาวไทย รวมการ์ดตัวละครดิสนีย์ตั้งแต่ชุดแรก The First Chapter จนถึงชุดล่าสุด พร้อมราคาตลาดอัปเดตทุกวัน',
                'ซื้อจากผู้ขายที่ยืนยันตัวตนในไทย มีระบบคุ้มครองผู้ซื้อทุกออเดอร์ และจัดส่งทั่วประเทศ หรือลงขายการ์ดของคุณเองได้ฟรี',
            ],
            en: [
                'A Disney Lorcana marketplace for collectors in Thailand, covering Disney character cards from The First Chapter to the latest set with daily-updated market prices.',
                'Buy from identity-verified sellers in Thailand with buyer protection on every order and nationwide delivery — or list your own cards free.',
            ],
        },
        faqs: [
            {
                q: { th: 'ซื้อการ์ด Lorcana ในไทยได้ที่ไหน?', en: 'Where can I buy Lorcana cards in Thailand?' },
                a: {
                    th: 'CardStreet รวมการ์ด Disney Lorcana จากผู้ขายในไทยที่ยืนยันตัวตนแล้ว พร้อมระบบคุ้มครองผู้ซื้อและจัดส่งทั่วประเทศ',
                    en: 'CardStreet lists Disney Lorcana cards from identity-verified sellers in Thailand, with buyer protection and nationwide delivery.',
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
        ],
    },
    {
        slug: 'riftbound',
        gameId: 'riftbound',
        title: {
            th: 'การ์ด Riftbound (League of Legends TCG) — ซื้อ ขาย เช็คราคา | CardStreet',
            en: 'Riftbound (League of Legends TCG) Thailand — Buy, Sell & Prices | CardStreet',
        },
        description: {
            th: 'ซื้อขายการ์ด Riftbound การ์ดเกม League of Legends จาก Riot Games ในไทย เช็คราคาตลาดเรียลไทม์ ผู้ขายยืนยันตัวตน ส่งทั่วไทย',
            en: 'Buy and sell Riftbound — the League of Legends trading card game by Riot Games — in Thailand with live market prices, verified sellers, and nationwide delivery.',
        },
        h1: {
            th: 'การ์ด Riftbound (League of Legends TCG)',
            en: 'Riftbound — League of Legends TCG in Thailand',
        },
        intro: {
            th: [
                'Riftbound คือการ์ดเกมสะสมจากจักรวาล League of Legends โดย Riot Games CardStreet รวมการ์ด Riftbound พร้อมราคาตลาดอัปเดตทุกวัน ให้นักสะสมชาวไทยตามเก็บแชมเปียนอย่าง Jinx, Yasuo และ Ahri ได้ตั้งแต่วันแรก',
                'ซื้อจากผู้ขายที่ยืนยันตัวตนในไทย มีระบบคุ้มครองผู้ซื้อทุกออเดอร์ และจัดส่งทั่วประเทศ หรือลงขายการ์ดของคุณเองได้ฟรี',
            ],
            en: [
                'Riftbound is the collectible card game set in the League of Legends universe by Riot Games. CardStreet catalogs Riftbound cards with daily-updated market prices so Thai collectors can chase champions like Jinx, Yasuo, and Ahri from day one.',
                'Buy from identity-verified sellers in Thailand with buyer protection on every order and nationwide delivery — or list your own cards free.',
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
        ],
    },
];

export function getGameLanding(slug: string): GameLandingContent | null {
    return GAME_LANDINGS.find((g) => g.slug === slug) ?? null;
}
