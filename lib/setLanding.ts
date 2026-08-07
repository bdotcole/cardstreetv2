// Bilingual intro copy for high-interest set pages.
//
// Set pages used to render an h1 and a card grid with no prose at all, which
// left them with nothing to rank for beyond the set name. These blurbs give
// the page real Thai text around the commercial intents collectors search
// (ราคา / เช็คราคา / ของแท้ / ซื้อ-ขาย) plus the chase card people look for.
//
// Deliberately no card counts or prices: the page header already renders the
// live count, and hardcoded numbers rot as the catalog is backfilled (MA5's
// secret rares and SV4a's numbering both moved after ingest). Every claim here
// is verifiable from the catalog — chase-card names match the rows in
// pokemon_cards exactly, so a collector reading the copy finds that card.
//
// Only a handful of sets need this; unlisted sets simply render no intro.

export interface SetIntro {
  th: string;
  en: string;
}

const SET_INTROS: Record<string, SetIntro> = {
  ma5: {
    th: 'เงามืดคุกคาม (MA5) คือชุดการ์ดโปเกมอนภาษาไทยยุคเมก้าที่นักสะสมจับตามองมากที่สุดชุดหนึ่ง โดยมีเมก้าดาร์กไรex เป็นการ์ดตัวท็อปของชุดที่ใคร ๆ ก็ตามหา ทั้งเวอร์ชัน SR, SAR และ MUR เช็คราคาล่าสุดได้ครบทุกใบ แล้วซื้อ-ขายการ์ดของแท้กับผู้ขายในไทยได้เลยบน CardStreet',
    en: 'เงามืดคุกคาม (MA5) is one of the most closely watched Thai-language sets of the Mega era, headlined by Mega Darkrai ex across its SR, SAR, and MUR treatments. Check live prices for every card in the set and buy or sell authentic copies with sellers across Thailand on CardStreet.',
  },
  ma3: {
    th: 'วิวัฒนาการเมก้า ดรีมex (MA3) เป็นชุดใหญ่ของการ์ดโปเกมอนภาษาไทย ที่รวมการ์ดหายากระดับ AR, SAR และซีเคร็ตแรร์เอาไว้ครบ ใบชูโรงอย่างเมก้าลิซาร์ดอน Xex คือเป้าหมายอันดับต้น ๆ ของนักล่าการ์ดสายเมก้า อยากรู้ว่าใบไหนราคาเท่าไหร่ เช็คราคาตลาดแล้วเลือกซื้อ-ขายการ์ดของแท้จากผู้ขายทั่วไทยได้ในหน้านี้เลย',
    en: 'Mega Evolution Dream ex (MA3) is one of the biggest Thai-language sets, packed with AR, SAR, and secret rare cards. Mega Charizard X ex sits at the top of most want lists. Browse live market prices for the full set and buy or sell authentic copies from sellers all over Thailand on this page.',
  },
  'sv8a-th': {
    th: 'เทศกาลเทรัสตัลex (SV8a) คือชุดพิเศษที่ขึ้นชื่อเรื่องการ์ดอาร์ตพิเศษ (SAR) ของตระกูลอีวุย โดยเฉพาะนิมเฟีย ex ที่กลายเป็นการ์ดที่นักสะสมทั่วไทยตามล่ามากที่สุดใบหนึ่ง ใครกำลังไล่เก็บการ์ดสายเทรัสตัลห้ามพลาด เช็คราคาปัจจุบันได้ทุกใบ พร้อมซื้อ-ขายของแท้กับผู้ขายในไทยได้ที่นี่',
    en: 'Terastal Festival ex (SV8a) is a special set best known for its special-art (SAR) Eeveelution cards, with Sylveon ex among the most hunted cards in Thailand. If you are collecting the Terastal era this is the page: check current prices for every card and buy or sell authentic copies with Thai sellers.',
  },
  me05: {
    th: 'Mega Evolution: Pitch Black (me05) คือชุดการ์ดภาษาอังกฤษชุดใหม่แห่งยุคเมก้า โดยมี Mega Darkrai ex แบบ Special Illustration Rare เป็นใบที่นักสะสมตามหามากที่สุดของชุด สายสะสมการ์ดภาษาอังกฤษเช็คราคาแบบเรียลไทม์ แล้วซื้อ-ขายการ์ดของแท้จากผู้ขายในไทยได้โดยตรง',
    en: 'Mega Evolution: Pitch Black (me05) is the newest English-language entry in the Mega era, led by the Special Illustration Rare Mega Darkrai ex. Check prices in real time across the set and buy or sell authentic copies directly from sellers in Thailand.',
  },
  me01: {
    th: 'Mega Evolution (me01) คือชุดแรกที่เปิดศักราชยุคเมก้าของการ์ดโปเกมอนภาษาอังกฤษ การ์ดเมก้าอย่าง Mega Gardevoir ex และ Mega Lucario ex ทั้งเวอร์ชัน SAR และ UR คือใบที่นักสะสมจับตามากที่สุด เช็คราคาตลาดวันนี้ แล้วซื้อ-ขายการ์ดของแท้กับผู้ขายทั่วไทยได้ในหน้าเดียว',
    en: 'Mega Evolution (me01) is the set that opened the Mega era for English-language Pokemon cards. Mega ex cards like Mega Gardevoir ex and Mega Lucario ex, in both their SAR and UR treatments, draw the most collector attention. Check today’s market prices and buy or sell authentic copies with sellers across Thailand, all on one page.',
  },
  'sv2a-th': {
    th: 'โปเกมอนการ์ด 151 (SV2a) คือชุดสุดคลาสสิกที่พาโปเกม่อนรุ่นแรกทั้ง 151 ตัวจากภูมิภาคคันโตกลับมาครบในชุดเดียว นำทีมโดยลิซาร์ดอน ex ใบยอดนิยมประจำชุด ไม่ว่าจะเพิ่งเริ่มสะสมหรือกลับมาตามหาความทรงจำวัยเด็ก เช็คราคาการ์ดโปเกมอนแต่ละใบ และซื้อ-ขายการ์ดของแท้จากผู้ขายในไทยได้เลยที่นี่',
    en: 'Pokemon Card 151 (SV2a) is the evergreen classic that brings all 151 original Kanto Pokemon back in a single Thai-language set, headlined by the ever-popular Charizard ex. Whether you are starting a collection or chasing childhood nostalgia, see the latest prices and buy or sell authentic cards with Thai sellers right here.',
  },

  // Batch 2. Sets picked from two live signals: the active-listing table
  // (SV4a-th and rb-unleashed are the biggest sets with real inventory that had
  // no intro) and Search Console, where /lorcana and /riftbound are the #1 and
  // #3 pages on the whole domain despite tiny inventory — Thai-language content
  // for those two games barely exists on the web.
  //
  // English set names appear only where the CATALOG carries one: SV4a has a
  // Japanese twin row named "Shiny Treasure ex". SV7s, SV8s, MA1, MA2 and MA4
  // have no twin and no official English name, so their English copy keeps the
  // Thai name. Inventing one risks naming a different set outright — "Stellar
  // Crown" is sv07 and "Stellar Miracle" is SV7, neither of which is SV7s.
  'sv4a-th': {
    th: 'ไชนีเทรเชอร์ex (SV4a) คือชุดการ์ดโปเกมอนภาษาไทยที่นักสะสมพูดถึงมากที่สุดชุดหนึ่ง เพราะรวมการ์ดชายนี่และการ์ดอาร์ตพิเศษไว้แน่นทั้งชุด ใบชูโรงอย่างมิว ex และลิซาร์ดอน ex แบบ SAR คือเป้าหมายอันดับต้น ๆ ของคนไล่เก็บ ส่วนพิคาชูแบบ AR ก็เป็นใบที่หาซื้อกันไม่หยุด เช็คราคาการ์ดโปเกม่อนล่าสุดได้ทุกใบในชุด แล้วซื้อ-ขายของแท้กับผู้ขายทั่วไทยได้ในหน้านี้',
    en: 'Shiny Treasure ex (SV4a) is one of the most talked-about Thai-language Pokemon sets, packed end to end with shiny and special-art cards. Mew ex and Charizard ex in their SAR treatments lead most want lists, with the AR Pikachu close behind. Check the latest market price for every card in the set and buy or sell authentic copies with sellers across Thailand.',
  },
  ma4: {
    th: 'วอยด์บลาสต์ (MA4) คือชุดการ์ดโปเกมอนภาษาไทยยุคเมก้าที่ขนการ์ด SAR มาเต็มชุด นำโดยพิคาชูex ที่กลายเป็นใบแพงที่สุดของชุด ตามด้วยปิปปีex <ของลิเลีย> และเมก้าออไดล์ex ที่นักสะสมตามหากันหนัก อยากรู้ว่าใบไหนราคาขยับไปถึงไหนแล้ว เช็คราคาตลาดล่าสุดแล้วซื้อ-ขายการ์ดของแท้จากผู้ขายในไทยได้เลย',
    en: 'วอยด์บลาสต์ (MA4) is a Thai-language Mega-era set loaded with special-art rares. Pikachu ex is the standout card of the set, followed by Lillie’s Clefairy ex and Mega Feraligatr ex. See where each card sits in the market today, then buy or sell authentic copies with sellers in Thailand.',
  },
  ma2: {
    th: 'อัคคีสีคราม (MA2) เป็นชุดการ์ดโปเกมอนภาษาไทยที่มีเมก้าลิซาร์ดอน X ex เป็นพระเอกเต็มตัว ทั้งเวอร์ชัน SAR และ UR คือสองใบที่ดันราคาทั้งชุดและเป็นเป้าหมายหลักของสายเมก้า ใครกำลังเล็งลิซาร์ดอนอยู่ เช็คราคาล่าสุดของทุกเวอร์ชันเทียบกันได้ในหน้าเดียว แล้วซื้อ-ขายการ์ดของแท้กับผู้ขายทั่วไทย',
    en: 'อัคคีสีคราม (MA2) is a Thai-language set built around Mega Charizard X ex — its SAR and UR versions carry the whole set and top most Mega-era want lists. Compare current prices for every treatment side by side, then buy or sell authentic copies with sellers across Thailand.',
  },
  ma1: {
    th: 'วิวัฒนาการเมก้า (MA1) คือชุดที่เปิดยุคเมก้าของการ์ดโปเกมอนภาษาไทย การ์ด UR อย่างเมก้าลูคาริโอ ex และเมก้าเซอไนท์ ex คือสองใบที่ราคาแรงที่สุดของชุด ตามด้วยเมก้าฟุชิกิบานะ ex แบบ SAR สายสะสมเมก้าเช็คราคาการ์ดโปเกม่อนแต่ละใบได้แบบอัปเดตรายวัน แล้วซื้อ-ขายของแท้กับผู้ขายในไทยได้ที่นี่',
    en: 'วิวัฒนาการเมก้า (MA1) is the set that opened the Mega era for Thai-language Pokemon cards. The UR Mega Lucario ex and Mega Gardevoir ex are the strongest cards in the set, with the SAR Mega Venusaur ex behind them. Prices update daily across the whole set — check any card, then buy or sell authentic copies with Thai sellers.',
  },
  sv8s: {
    th: 'สเตลลาร์สายฟ้าฟาด (SV8s) คือชุดการ์ดโปเกมอนภาษาไทยที่มีพิคาชู ex แบบ SAR เป็นใบที่นักสะสมตามล่ามากที่สุด ตามด้วยลาทิอาส ex และมิโลคารอส ex ที่อาร์ตสวยจนราคาไม่เคยนิ่ง เช็คราคาปัจจุบันของทุกใบในชุด แล้วเลือกซื้อ-ขายการ์ดของแท้จากผู้ขายทั่วประเทศได้เลย',
    en: 'สเตลลาร์สายฟ้าฟาด (SV8s) is a Thai-language set led by the SAR Pikachu ex, the single most hunted card in it, with Latias ex and Milotic ex right behind on artwork alone. Check the current price of every card in the set, then buy or sell authentic copies from sellers all over Thailand.',
  },
  sv7s: {
    th: 'แสงนำทางแห่งสเตลลาร์ (SV7s) คือชุดการ์ดโปเกมอนภาษาไทยที่ขึ้นชื่อเรื่องการ์ด AR อาร์ตสวย โดยมีคิจิคิกิสึ ex แบบ SAR เป็นใบราคาสูงสุดของชุด ส่วนโยมาวารุและเปอร์เซียนแบบ AR ก็เป็นใบที่คนไล่เก็บกันเยอะ เช็คราคาการ์ดทีละใบแบบเรียลไทม์ แล้วซื้อ-ขายของแท้กับผู้ขายในไทยได้ในหน้านี้',
    en: 'แสงนำทางแห่งสเตลลาร์ (SV7s) is a Thai-language set known for its illustration rares. The SAR Fezandipiti ex is the most valuable card in it, while the AR Duskull and Persian are collector favourites. Check live prices card by card, then buy or sell authentic copies with sellers in Thailand.',
  },
  me02: {
    th: 'Phantasmal Flames (me02) คือชุดการ์ดโปเกมอนภาษาอังกฤษยุคเมก้า ที่มี Mega Charizard X ex เป็นใบชูโรง ทั้งแบบ Ultra Rare และ Special Illustration Rare สายสะสมการ์ดภาษาอังกฤษเช็คราคาการ์ดโปเกม่อนล่าสุดได้ทุกใบ แล้วซื้อ-ขายการ์ดของแท้จากผู้ขายในไทยได้โดยตรง ไม่ต้องสั่งข้ามประเทศ',
    en: 'Phantasmal Flames (me02) is an English-language Mega-era set headlined by Mega Charizard X ex in both its Ultra Rare and Special Illustration Rare treatments. Check the latest price for every card in the set and buy or sell authentic copies directly from sellers inside Thailand — no international ordering.',
  },
  me03: {
    th: 'Perfect Order (me03) คือชุดการ์ดโปเกมอนภาษาอังกฤษแห่งยุคเมก้าที่มี Meowth ex แบบ Special Illustration Rare เป็นใบที่ราคาสูงสุดของชุด ส่วน Mega Zygarde ex แบบ Mega Hyper Rare คือใบที่สายเมก้าตามหา เช็คราคาตลาดของทุกใบในชุด แล้วซื้อ-ขายการ์ดของแท้กับผู้ขายทั่วไทยได้ที่นี่',
    en: 'Perfect Order (me03) is an English-language Mega-era set where the Special Illustration Rare Meowth ex is the most valuable card, with the Mega Hyper Rare Mega Zygarde ex the one Mega collectors chase. Check market prices across the full set, then buy or sell authentic copies with sellers across Thailand.',
  },
  'rb-unleashed': {
    th: 'Unleashed คือชุดการ์ด Riftbound เกมการ์ดจากจักรวาล League of Legends ที่เพิ่งเข้าไทยได้ไม่นาน ใบที่ราคาแรงที่สุดของชุดคือ Baron Nashor แบบ Ultimate Showcase ตามด้วยการ์ด Signature ของ Diana และ LeBlanc เช็คราคาการ์ด Riftbound ล่าสุดได้ทุกใบ แล้วซื้อ-ขายของแท้กับผู้ขายในไทยได้ในหน้าเดียว',
    en: 'Unleashed is a Riftbound set — the League of Legends trading card game, still new to Thailand. The Ultimate Showcase Baron Nashor is the most valuable card in the set, followed by the Signature Showcase Diana and LeBlanc. Check current Riftbound prices card by card, then buy or sell authentic copies with sellers in Thailand.',
  },
  'lorcana-13': {
    th: 'Attack of the Vine! คือชุดการ์ด Disney Lorcana ที่นักสะสมในไทยจับตามากที่สุดชุดหนึ่ง โดยมีการ์ดระดับ Iconic อย่าง Belle & Beast - Certain as the Sun และ Lilo & Stitch - Fun-Loving Friends เป็นใบราคาสูงสุด ส่วนการ์ด Enchanted ทั้งชุดก็เป็นของหายากที่คนตามเก็บ เช็คราคาการ์ด Lorcana ล่าสุด แล้วซื้อ-ขายของแท้กับผู้ขายทั่วไทยได้เลย',
    en: 'Attack of the Vine! is one of the most closely watched Disney Lorcana sets among collectors in Thailand. The Iconic Belle & Beast - Certain as the Sun and Lilo & Stitch - Fun-Loving Friends are the top cards, with the set’s Enchanted cards close behind. Check the latest Lorcana prices and buy or sell authentic copies with sellers across Thailand.',
  },
};

/** Intro copy for a set page, or null when the set has none. */
export function getSetIntro(setId: string): SetIntro | null {
  return SET_INTROS[setId.toLowerCase()] ?? null;
}
