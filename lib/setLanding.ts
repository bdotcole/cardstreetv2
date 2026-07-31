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
};

/** Intro copy for a set page, or null when the set has none. */
export function getSetIntro(setId: string): SetIntro | null {
  return SET_INTROS[setId.toLowerCase()] ?? null;
}
