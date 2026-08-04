// Single source of truth for CardStreet's FAQ content.
//
// Consumed by:
//   - app/faq/page.tsx                       public, SEO/GEO-optimized page + FAQPage JSON-LD
//   - app/help/page.tsx                      in-app Help Center
//   - components/desktop/DesktopMarketplace  homepage FAQ teaser (featured items only)
//
// Answers are plain strings (no JSX) on purpose: the same content has to
// serialize cleanly into schema.org FAQPage JSON-LD for search engines and AI
// answer engines (GEO). Keep answers self-contained and factual — an answer is
// often quoted by an LLM without the surrounding question, so each one should
// read as a standalone, citable statement and name the relevant entities
// (CardStreet, the game, Thailand, Flash Express, PromptPay, PSA/BGS/CGC).

export interface FaqItem {
  q: string;
  a: string;
  /** Surfaced in the desktop homepage teaser. The full list always shows everything. */
  featured?: boolean;
}

export interface FaqCategory {
  /** Stable slug, also used as the anchor id on the public /faq page. */
  id: string;
  title: string;
  /** Font Awesome class. */
  icon: string;
  items: FaqItem[];
}

const FAQ_EN: FaqCategory[] = [
  {
    id: 'about',
    title: 'About CardStreet',
    icon: 'fa-solid fa-circle-info',
    items: [
      {
        q: 'What is CardStreet?',
        a: 'CardStreet is an online marketplace for trading card games, built for collectors and players in Thailand. You can buy and sell Pokémon, Magic: The Gathering, Yu-Gi-Oh!, One Piece, Disney Lorcana, and Riftbound cards, scan a card to identify it instantly, and track live market values — all in one app. Every purchase is protected, and payment and shipping are handled end to end.',
        featured: true,
      },
      {
        q: 'Which trading card games can I buy and sell on CardStreet?',
        a: 'CardStreet supports Pokémon TCG, Magic: The Gathering, Yu-Gi-Oh!, the One Piece Card Game, Disney Lorcana, and Riftbound (the League of Legends TCG), with more games being added. The Pokémon catalog covers English, Thai, and Japanese printings, so you can collect across regions in one place.',
        featured: true,
      },
      {
        q: 'Is CardStreet available in Thailand?',
        a: 'Yes. CardStreet is built specifically for the Thai market. Listings are priced in Thai baht (฿), checkout supports Thai payment methods including credit and debit cards and PromptPay, and orders ship nationwide within Thailand via Flash Express.',
      },
      {
        q: 'Is CardStreet free to use?',
        a: 'Browsing, searching, scanning cards, and buying are free — buyers pay only the item price plus shipping. Sellers pay a transaction fee only when a card actually sells (9%, or as low as 5% for Partner sellers). There are no listing fees and no monthly charges.',
      },
      {
        q: 'Is there a CardStreet mobile app?',
        a: 'Yes. CardStreet works in any web browser and is available as a native app for iPhone (on the App Store) and Android, so you can scan, buy, and sell from your phone. Your account and collection stay in sync across web and mobile.',
      },
    ],
  },
  {
    id: 'buying',
    title: 'Buying',
    icon: 'fa-solid fa-cart-shopping',
    items: [
      {
        q: 'How do I buy a card on CardStreet?',
        a: 'Search or browse the marketplace, open a listing, and add it to your cart. At checkout you pay securely by card or PromptPay. Your payment is protected and only released to the seller after your order is delivered.',
        featured: true,
      },
      {
        q: 'Is it safe to buy cards on CardStreet?',
        a: 'Yes. Every order is covered by buyer protection: your payment is held and only released to the seller after the card is delivered. If an item arrives damaged, counterfeit, or not as described, contact support@thailandtcg.com with your order number and photos before the protection window closes and we will help mediate.',
        featured: true,
      },
      {
        q: 'What payment methods can I use?',
        a: 'At checkout you can pay with major credit and debit cards or with PromptPay. All payments are processed securely through Stripe, and CardStreet never stores your card details.',
      },
      {
        q: 'Why can I only buy from one seller per order?',
        a: 'In Thailand each checkout settles directly to a single seller, so a cart can hold items from one seller at a time. To buy cards from different sellers, simply check out separately for each.',
      },
      {
        q: 'Can I buy graded cards?',
        a: 'Yes. CardStreet lists raw (ungraded) cards as well as professionally graded cards from PSA, BGS, CGC, and TAG. Graded listings show the grading company and grade so you know exactly what you are buying.',
      },
    ],
  },
  {
    id: 'selling',
    title: 'Selling',
    icon: 'fa-solid fa-tag',
    items: [
      {
        q: 'How do I sell trading cards on CardStreet?',
        a: 'List a card from your collection, set its condition and price, and publish. When a buyer pays, ship the card with the prepaid Flash Express label and mark it sent. Once the order is delivered, your payout is released.',
        featured: true,
      },
      {
        q: 'How much does it cost to sell?',
        a: 'There are no listing or subscription fees — you only pay when a card sells. The standard transaction fee is 9% of the sale price, reduced for Partner-tier sellers to as low as 5%. The fee is deducted automatically before payout.',
      },
      {
        q: 'When and how do I get paid?',
        a: 'Payouts are released after the order is delivered and the buyer-protection window passes. Funds settle into your connected Stripe account and pay out to your Thai bank account automatically.',
      },
      {
        q: 'What do I need to start selling?',
        a: 'The first time you list, you complete a short Stripe onboarding with your identity and bank details. This is required so we can pay you and comply with Thai payment regulations. After that, listing a card takes seconds.',
      },
    ],
  },
  {
    id: 'scanning',
    title: 'Scanning & Pricing',
    icon: 'fa-solid fa-camera',
    items: [
      {
        q: 'How does the card scanner work?',
        a: 'Tap the camera button and point it at a card. The app auto-captures when the image is sharp and steady, then identifies the card by its set code, number, and artwork using AI. It recognizes English, Thai, and Japanese Pokémon printings.',
        featured: true,
      },
      {
        q: 'Can I scan a card to check its value?',
        a: 'Yes. After the scanner identifies a card, you see its details and current market value alongside active listings on the marketplace. It is a fast way to price a card before you buy, sell, or trade.',
      },
      {
        q: 'Does CardStreet support Thai and Japanese cards?',
        a: 'Yes. CardStreet has a dedicated Thai-language Pokémon catalog alongside English and Japanese printings, with localized set names and pricing — something most international card apps do not offer.',
      },
      {
        q: 'The scanner identified the wrong card. What can I do?',
        a: 'Make sure the whole card and its bottom info strip (set code and number) are in frame and well lit, then scan again. If it still misreads, search for the card by name and add it manually.',
      },
    ],
  },
  {
    id: 'shipping',
    title: 'Shipping & Orders',
    icon: 'fa-solid fa-truck-fast',
    items: [
      {
        q: 'How is shipping handled?',
        a: 'Orders ship within Thailand through Flash Express. Sellers receive a prepaid label, and you can track every order from the order details screen.',
      },
      {
        q: 'How do I track my order?',
        a: 'Open the order from your profile to see its live status and tracking number. You are notified as it moves from shipped to delivered.',
      },
      {
        q: 'What if my card arrives damaged or not as described?',
        a: 'Contact support@thailandtcg.com with your order number and photos before the protection window closes. Because your payment is held until the issue is resolved, we can mediate and issue a refund where warranted.',
      },
    ],
  },
  {
    id: 'account',
    title: 'Account & Trust',
    icon: 'fa-solid fa-shield-halved',
    items: [
      {
        q: 'How do I create a CardStreet account?',
        a: 'Tap sign up and register with your email. A verified account lets you buy, track orders, build a collection, and start selling once you complete seller onboarding.',
      },
      {
        q: 'Are the cards on CardStreet authentic?',
        a: 'CardStreet strictly prohibits proxy, reproduction, fake, and counterfeit cards, and sellers who list them face immediate suspension. Combined with buyer protection on every order, this keeps the marketplace trustworthy.',
      },
      {
        q: 'How do I change my details or delete my account?',
        a: 'Update your name, address, and contact information under Profile, then Personal Details. To remove your data permanently, use the account deletion page from your Profile.',
      },
    ],
  },
];

const FAQ_TH: FaqCategory[] = [
  {
    id: 'about',
    title: 'เกี่ยวกับ CardStreet',
    icon: 'fa-solid fa-circle-info',
    items: [
      {
        q: 'CardStreet คืออะไร?',
        a: 'CardStreet คือมาร์เก็ตเพลสออนไลน์สำหรับเกมการ์ดสะสม ออกแบบมาเพื่อนักสะสมและผู้เล่นในประเทศไทย คุณสามารถซื้อขายการ์ด Pokémon, Magic: The Gathering, Yu-Gi-Oh!, One Piece, Disney Lorcana และ Riftbound สแกนการ์ดเพื่อระบุชนิดได้ทันที และดูมูลค่าตลาดแบบเรียลไทม์ ครบในแอปเดียว ทุกการสั่งซื้อได้รับการคุ้มครอง พร้อมระบบชำระเงินและจัดส่งครบวงจร',
        featured: true,
      },
      {
        q: 'ซื้อขายเกมการ์ดอะไรได้บ้างบน CardStreet?',
        a: 'CardStreet รองรับ Pokémon TCG, Magic: The Gathering, Yu-Gi-Oh!, One Piece Card Game, Disney Lorcana และ Riftbound (การ์ดเกม League of Legends) และกำลังเพิ่มเกมอื่น ๆ อย่างต่อเนื่อง แคตตาล็อก Pokémon มีทั้งฉบับภาษาอังกฤษ ไทย และญี่ปุ่น คุณจึงสะสมข้ามภูมิภาคได้ในที่เดียว',
        featured: true,
      },
      {
        q: 'CardStreet ให้บริการในประเทศไทยหรือไม่?',
        a: 'ใช่ CardStreet สร้างขึ้นสำหรับตลาดไทยโดยเฉพาะ ราคาบนรายการขายเป็นเงินบาท (฿) การชำระเงินรองรับวิธีการของไทยทั้งบัตรเครดิตและเดบิตและพร้อมเพย์ (PromptPay) และจัดส่งทั่วประเทศผ่าน Flash Express',
      },
      {
        q: 'ใช้งาน CardStreet ฟรีหรือไม่?',
        a: 'การเลือกดู ค้นหา สแกนการ์ด และการซื้อ ใช้งานได้ฟรี ผู้ซื้อจ่ายเพียงค่าสินค้าบวกค่าจัดส่ง ส่วนผู้ขายจะเสียค่าธรรมเนียมเฉพาะเมื่อขายได้จริง (9% หรือต่ำสุด 5% สำหรับผู้ขายระดับพาร์ทเนอร์) ไม่มีค่าลงประกาศและไม่มีค่าบริการรายเดือน',
      },
      {
        q: 'CardStreet มีแอปบนมือถือไหม?',
        a: 'มี CardStreet ใช้งานได้ผ่านเว็บเบราว์เซอร์ และมีแอปสำหรับ iPhone (บน App Store) และ Android ให้คุณสแกน ซื้อ และขายได้จากมือถือ ข้อมูลบัญชีและคอลเลกชันของคุณซิงค์กันทั้งบนเว็บและมือถือ',
      },
    ],
  },
  {
    id: 'buying',
    title: 'การซื้อ',
    icon: 'fa-solid fa-cart-shopping',
    items: [
      {
        q: 'ซื้อการ์ดบน CardStreet อย่างไร?',
        a: 'ค้นหาหรือเลือกดูในมาร์เก็ตเพลส เปิดรายการขายแล้วเพิ่มลงตะกร้า เมื่อชำระเงินคุณจ่ายอย่างปลอดภัยด้วยบัตรหรือพร้อมเพย์ เงินของคุณจะได้รับการคุ้มครองและโอนให้ผู้ขายหลังจากคำสั่งซื้อถูกจัดส่งถึงแล้วเท่านั้น',
        featured: true,
      },
      {
        q: 'ซื้อการ์ดบน CardStreet ปลอดภัยไหม?',
        a: 'ปลอดภัย ทุกคำสั่งซื้อมีการคุ้มครองผู้ซื้อ เงินของคุณจะถูกพักไว้และโอนให้ผู้ขายหลังการ์ดถึงมือคุณแล้วเท่านั้น หากสินค้าที่ได้รับเสียหาย เป็นของปลอม หรือไม่ตรงตามคำอธิบาย ให้ติดต่อ support@thailandtcg.com พร้อมหมายเลขคำสั่งซื้อและรูปถ่ายก่อนหมดระยะเวลาคุ้มครอง แล้วเราจะช่วยไกล่เกลี่ยให้',
        featured: true,
      },
      {
        q: 'ชำระเงินด้วยวิธีใดได้บ้าง?',
        a: 'ที่หน้าชำระเงินคุณจ่ายได้ด้วยบัตรเครดิตและเดบิตหลัก ๆ หรือพร้อมเพย์ การชำระเงินทั้งหมดประมวลผลอย่างปลอดภัยผ่าน Stripe และ CardStreet ไม่เก็บข้อมูลบัตรของคุณ',
      },
      {
        q: 'ทำไมจึงซื้อจากผู้ขายได้เพียงรายเดียวต่อหนึ่งคำสั่งซื้อ?',
        a: 'ในประเทศไทย การชำระเงินแต่ละครั้งจะโอนตรงไปยังผู้ขายรายเดียว ตะกร้าจึงใส่สินค้าจากผู้ขายได้ครั้งละหนึ่งรายเท่านั้น หากต้องการซื้อจากผู้ขายหลายราย ให้แยกชำระเงินเป็นคนละคำสั่งซื้อ',
      },
      {
        q: 'ซื้อการ์ดเกรดได้ไหม?',
        a: 'ได้ CardStreet มีทั้งการ์ดแบบ raw (ไม่เกรด) และการ์ดที่ผ่านการประเมินจาก PSA, BGS, CGC และ TAG รายการการ์ดเกรดจะแสดงบริษัทผู้ประเมินและเกรด คุณจึงรู้แน่ชัดว่ากำลังซื้ออะไร',
      },
    ],
  },
  {
    id: 'selling',
    title: 'การขาย',
    icon: 'fa-solid fa-tag',
    items: [
      {
        q: 'ขายการ์ดบน CardStreet อย่างไร?',
        a: 'ลงขายการ์ดจากคอลเลกชันของคุณ กำหนดสภาพและราคา แล้วเผยแพร่ เมื่อผู้ซื้อชำระเงิน ให้จัดส่งการ์ดด้วยใบจัดส่ง Flash Express ที่ชำระล่วงหน้าแล้วกดยืนยันการจัดส่ง เมื่อคำสั่งซื้อถึงปลายทาง เงินของคุณจะถูกปล่อยให้',
        featured: true,
      },
      {
        q: 'ค่าธรรมเนียมการขายเท่าไหร่?',
        a: 'ไม่มีค่าลงประกาศหรือค่าบริการรายเดือน คุณจ่ายเฉพาะเมื่อขายได้ ค่าธรรมเนียมมาตรฐานคือ 9% ของราคาขาย และลดลงเหลือต่ำสุด 5% สำหรับผู้ขายระดับพาร์ทเนอร์ โดยจะหักอัตโนมัติก่อนการจ่ายเงิน',
      },
      {
        q: 'จะได้รับเงินเมื่อไหร่และอย่างไร?',
        a: 'เงินจะถูกปล่อยหลังจากคำสั่งซื้อจัดส่งถึงและพ้นระยะเวลาคุ้มครองผู้ซื้อ ยอดเงินจะเข้าบัญชี Stripe ที่เชื่อมต่อไว้และโอนเข้าบัญชีธนาคารไทยของคุณโดยอัตโนมัติ',
      },
      {
        q: 'ต้องเตรียมอะไรก่อนเริ่มขาย?',
        a: 'ครั้งแรกที่ลงขาย คุณต้องผ่านขั้นตอนสั้น ๆ ของ Stripe โดยกรอกข้อมูลยืนยันตัวตนและบัญชีธนาคาร ขั้นตอนนี้จำเป็นเพื่อให้เราจ่ายเงินให้คุณได้และเป็นไปตามกฎระเบียบด้านการชำระเงินของไทย หลังจากนั้นการลงขายจะใช้เวลาเพียงไม่กี่วินาที',
      },
    ],
  },
  {
    id: 'scanning',
    title: 'การสแกนและราคา',
    icon: 'fa-solid fa-camera',
    items: [
      {
        q: 'การสแกนการ์ดทำงานอย่างไร?',
        a: 'แตะปุ่มกล้องแล้วเล็งไปที่การ์ด แอปจะถ่ายภาพอัตโนมัติเมื่อภาพคมชัดและนิ่ง จากนั้นระบุการ์ดจากรหัสชุด หมายเลข และลายภาพด้วย AI รองรับการ์ด Pokémon ทั้งภาษาอังกฤษ ไทย และญี่ปุ่น',
        featured: true,
      },
      {
        q: 'สแกนการ์ดเพื่อดูมูลค่าได้ไหม?',
        a: 'ได้ หลังจากสแกนระบุการ์ดแล้ว คุณจะเห็นรายละเอียดและมูลค่าตลาดปัจจุบัน พร้อมรายการขายที่กำลังเปิดอยู่ในมาร์เก็ตเพลส เป็นวิธีที่รวดเร็วในการเช็คราคาก่อนซื้อ ขาย หรือแลกเปลี่ยน',
      },
      {
        q: 'CardStreet รองรับการ์ดภาษาไทยและญี่ปุ่นไหม?',
        a: 'รองรับ CardStreet มีแคตตาล็อก Pokémon ภาษาไทยโดยเฉพาะ ควบคู่กับฉบับภาษาอังกฤษและญี่ปุ่น พร้อมชื่อชุดและราคาในแบบท้องถิ่น ซึ่งเป็นสิ่งที่แอปการ์ดต่างประเทศส่วนใหญ่ไม่มี',
      },
      {
        q: 'ระบบสแกนระบุการ์ดผิด ต้องทำอย่างไร?',
        a: 'ตรวจสอบว่าการ์ดทั้งใบและแถบข้อมูลด้านล่าง (รหัสชุดและหมายเลข) อยู่ในกรอบและมีแสงเพียงพอ แล้วสแกนอีกครั้ง หากยังอ่านผิด ให้ค้นหาการ์ดด้วยชื่อแล้วเพิ่มด้วยตนเอง',
      },
    ],
  },
  {
    id: 'shipping',
    title: 'การจัดส่งและคำสั่งซื้อ',
    icon: 'fa-solid fa-truck-fast',
    items: [
      {
        q: 'การจัดส่งทำอย่างไร?',
        a: 'คำสั่งซื้อจัดส่งภายในประเทศไทยผ่าน Flash Express ผู้ขายจะได้รับใบจัดส่งที่ชำระล่วงหน้า และคุณติดตามทุกคำสั่งซื้อได้จากหน้ารายละเอียดคำสั่งซื้อ',
      },
      {
        q: 'ติดตามคำสั่งซื้ออย่างไร?',
        a: 'เปิดคำสั่งซื้อจากหน้าโปรไฟล์เพื่อดูสถานะปัจจุบันและเลขติดตามพัสดุ ระบบจะแจ้งเตือนคุณเมื่อสถานะเปลี่ยนจากจัดส่งแล้วเป็นถึงปลายทาง',
      },
      {
        q: 'หากการ์ดที่ได้รับเสียหายหรือไม่ตรงตามคำอธิบาย ต้องทำอย่างไร?',
        a: 'ติดต่อ support@thailandtcg.com พร้อมหมายเลขคำสั่งซื้อและรูปถ่ายก่อนหมดระยะเวลาคุ้มครอง เนื่องจากเงินของคุณถูกพักไว้จนกว่าจะแก้ไขปัญหาเสร็จ เราจึงสามารถไกล่เกลี่ยและคืนเงินให้ได้ตามความเหมาะสม',
      },
    ],
  },
  {
    id: 'account',
    title: 'บัญชีและความน่าเชื่อถือ',
    icon: 'fa-solid fa-shield-halved',
    items: [
      {
        q: 'สมัครบัญชี CardStreet อย่างไร?',
        a: 'แตะสมัครสมาชิกแล้วลงทะเบียนด้วยอีเมล บัญชีที่ยืนยันแล้วช่วยให้คุณซื้อ ติดตามคำสั่งซื้อ สร้างคอลเลกชัน และเริ่มขายได้เมื่อทำขั้นตอนผู้ขายเสร็จ',
      },
      {
        q: 'การ์ดบน CardStreet เป็นของแท้ไหม?',
        a: 'CardStreet ห้ามการ์ดพร็อกซี ของทำซ้ำ ของเลียนแบบ และของปลอมโดยเด็ดขาด ผู้ขายที่ลงขายสินค้าเหล่านี้จะถูกระงับบัญชีทันที เมื่อรวมกับการคุ้มครองผู้ซื้อในทุกคำสั่งซื้อ จึงทำให้มาร์เก็ตเพลสน่าเชื่อถือ',
      },
      {
        q: 'เปลี่ยนข้อมูลหรือลบบัญชีอย่างไร?',
        a: 'แก้ไขชื่อ ที่อยู่ และข้อมูลติดต่อได้ที่ โปรไฟล์ แล้วเลือกข้อมูลส่วนตัว หากต้องการลบข้อมูลอย่างถาวร ให้ใช้หน้าลบบัญชีจากโปรไฟล์ของคุณ',
      },
    ],
  },
];

export function getFaqCategories(isThai: boolean): FaqCategory[] {
  return isThai ? FAQ_TH : FAQ_EN;
}

/** Flattened, featured-only Q&A for the desktop homepage teaser. */
export function getFeaturedFaqs(isThai: boolean): FaqItem[] {
  return getFaqCategories(isThai)
    .flatMap((category) => category.items)
    .filter((item) => item.featured);
}

/**
 * schema.org FAQPage structured data for one locale.
 *
 * The catalog must match the URL variant being served, not the visitor's UI
 * language: answer engines quote structured data verbatim, so the Thai
 * canonical page has to expose the Thai answers or every citable sentence
 * about CardStreet ends up in English on a Thai-targeted URL.
 */
export function buildFaqJsonLd(isThai = false): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: isThai ? 'th-TH' : 'en-TH',
    mainEntity: (isThai ? FAQ_TH : FAQ_EN).flatMap((category) =>
      category.items.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.a,
        },
      })),
    ),
  };
}
