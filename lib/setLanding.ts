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

  // Batch 3 (drafted 2026-08-18, re-verified against the live catalog before
  // shipping 2026-08-28). Picked from active listings and from Search Console,
  // where /lorcana is the #1 page on the domain on a handful of listings and
  // /sets/S7D is the only set page in the top-pages report.
  //
  // RANKING CLAIMS MUST BE CHECKED AGAINST THE **DISPLAY** PRICE, i.e. the one
  // lib/cardMapper.ts picks: ungraded only (GRADED_CONDITION_RE), Raw_NM then
  // Near Mint. market_values also holds PSA/BGS/CGC/SGC slab rows whose prices
  // run orders of magnitude above raw — a 4-cent Common can carry a $12,000
  // BGS 10 row. Taking max() across all conditions therefore ranks graded slabs,
  // not cards, and it briefly produced three wrong "corrections" here (shipped
  // f3cba7f, reverted in this commit). The original 2026-08-18 claims were right.
  //
  // Apostrophes are straight ('), matching the catalog exactly — the copy
  // promises a collector can find the named card, and a curly quote breaks a
  // copy-paste search.
  //
  // sv10s keeps its Thai name in English copy on purpose: the bare code SV10 is
  // a Japanese row ("The Glory of Team Rocket") but at printed_total 98 against
  // SV10s's 138 it is a different product, so it is NOT this set's English name.
  // sv6-th does get "Transformation Mask" — SV6 is Japanese, same name, and both
  // are printed_total 101, which is what confirms the 1:1 Thai reprint. Both
  // re-checked 2026-08-28.
  //
  // S7D-th was considered and rejected: all 67 of its rows are still unpriced,
  // so the standard "เช็คราคาได้ทุกใบ" promise would be false on that page.
  'lorcana-11': {
    th: 'Winterspell คือชุดการ์ดดิสนีย์ Disney Lorcana ที่สายสะสมในไทยตามหากันหนักที่สุดชุดหนึ่ง การ์ดระดับ Iconic อย่าง Moana - Curious Explorer และ Pocahontas - Peacekeeper คือสองใบที่ราคาสูงสุดของชุด ส่วนสาย Enchanted ก็มี Elsa - Ice Artisan เป็นเป้าหมายหลัก เช็คราคาการ์ดดิสนีย์ล่าสุดได้ทุกใบ แล้วซื้อ-ขายของแท้กับผู้ขายในไทยได้เลย ไม่ต้องรอสั่งข้ามประเทศ',
    en: 'Winterspell is one of the most hunted Disney Lorcana sets among collectors in Thailand. The Iconic Moana - Curious Explorer and Pocahontas - Peacekeeper are the two most valuable cards in it, with the Enchanted Elsa - Ice Artisan leading the rest. Check the latest Lorcana prices card by card, then buy or sell authentic copies with sellers inside Thailand — no international ordering.',
  },
  'lorcana-12': {
    th: "Wilds Unknown คือชุดการ์ดดิสนีย์ Disney Lorcana ที่มี Buzz Lightyear - Jungle Ranger ระดับ Iconic เป็นใบราคาแรงที่สุดของชุดแบบทิ้งห่าง ตามด้วย Merida - Formidable Archer และการ์ด Enchanted อย่าง You've Got a Friend in Me ที่นักสะสมไล่เก็บกันไม่หยุด อยากรู้ว่าราคาขยับไปถึงไหนแล้ว เช็คราคาการ์ดดิสนีย์แบบอัปเดต แล้วซื้อ-ขายการ์ดของแท้จากผู้ขายทั่วไทยได้ในหน้านี้",
    en: "Wilds Unknown is a Disney Lorcana set headlined by the Iconic Buzz Lightyear - Jungle Ranger, comfortably the most valuable card in it, followed by Merida - Formidable Archer and the Enchanted You've Got a Friend in Me. See where prices have moved across the whole set, then buy or sell authentic copies from sellers all over Thailand.",
  },
  'lorcana-10': {
    th: 'Whispers in the Well คือชุดการ์ดดิสนีย์ Disney Lorcana ที่ขึ้นชื่อเรื่องการ์ดหายากระดับ Iconic โดยมี Ariel - Ethereal Voice และ Hades - Looking for a Deal เป็นสองใบที่ราคาสูงสุด ส่วนการ์ด Enchanted อย่าง Spooky Sight ก็เป็นใบที่คนตามเก็บกันเยอะ เช็คราคาการ์ดดิสนีย์ทีละใบแบบเรียลไทม์ แล้วซื้อ-ขายของแท้กับผู้ขายในไทยได้ที่นี่',
    en: 'Whispers in the Well is a Disney Lorcana set known for its Iconic rares, with Ariel - Ethereal Voice and Hades - Looking for a Deal the two most valuable cards in it and the Enchanted Spooky Sight close behind. Check live Lorcana prices card by card, then buy or sell authentic copies with sellers in Thailand.',
  },
  'sv6-th': {
    th: 'หน้ากากจอมลวงตา (SV6) คือชุดการ์ดโปเกมอนภาษาไทยที่มีการ์ดเทรนเนอร์อาร์ตพิเศษเป็นจุดขาย โดยเซย์ยุแบบ SAR คือใบราคาสูงสุดของชุด ตามด้วยซุกุริแบบ SAR และลัคกีแบบ AR ที่หาซื้อกันไม่หยุด ใครกำลังไล่เก็บชุดนี้ เช็คราคาการ์ดโปเกม่อนล่าสุดได้ทุกใบ แล้วซื้อ-ขายการ์ดของแท้กับผู้ขายทั่วไทยได้ในหน้าเดียว',
    en: 'Transformation Mask (SV6) is a Thai-language Pokemon set built around its special-art trainer cards. The SAR Carmine is the most valuable card in the set, followed by the SAR Kieran and the AR Chansey. Check the latest price for every card in the set, then buy or sell authentic copies with sellers across Thailand.',
  },
  sv10s: {
    th: 'การผงาดของผู้ไร้พ่าย (SV10s) คือชุดการ์ดโปเกมอนภาษาไทยที่รวมการ์ด SAR ของตัวละครดังไว้แน่นทั้งชุด นำโดยมิวทู ex ของแก๊งร็อกเกต ที่เป็นใบแพงที่สุด ตามด้วยกาเบรียส ex ของชิโรนะ และโฮโอ ex ของฮิบิกิ สายสะสมการ์ดตัวละครห้ามพลาดชุดนี้ เช็คราคาตลาดล่าสุดของทุกใบ แล้วซื้อ-ขายของแท้กับผู้ขายในไทยได้เลย',
    en: "การผงาดของผู้ไร้พ่าย (SV10s) is a Thai-language Pokemon set packed with special-art rares of the series best-known characters. Team Rocket's Mewtwo ex is the most valuable card in it, followed by Cynthia's Garchomp ex and Ethan's Ho-Oh ex. Check current market prices across the full set, then buy or sell authentic copies with sellers in Thailand.",
  },
  'me02.5': {
    th: 'Ascended Heroes (me02.5) คือชุดการ์ดโปเกมอนภาษาอังกฤษยุคเมก้าที่ขนการ์ดหายากมาเต็ม โดยมี Mega Gengar ex และ Pikachu ex แบบ Special Illustration Rare เป็นสองใบที่ราคาสูงสุด ตามด้วย Mega Dragonite ex แบบเดียวกัน ส่วน Mega Charizard Y ex แบบ Mega Hyper Rare คือใบที่สายเมก้าตามล่า สายสะสมการ์ดภาษาอังกฤษเช็คราคาได้ทุกใบ แล้วซื้อ-ขายของแท้จากผู้ขายในไทยได้โดยตรง',
    en: 'Ascended Heroes (me02.5) is an English-language Mega-era set loaded with chase cards. The Special Illustration Rare Mega Gengar ex and Pikachu ex are the two most valuable cards in it, with the Special Illustration Rare Mega Dragonite ex behind them, while the Mega Hyper Rare Mega Charizard Y ex is the one Mega collectors hunt. Check the price of every card in the set and buy or sell authentic copies directly from sellers inside Thailand.',
  },
  'sv04.5': {
    th: 'Paldean Fates (sv04.5) คือชุดการ์ดโปเกมอนภาษาอังกฤษสายชายนี่ที่นักสะสมทั่วโลกตามเก็บ ใบชูโรงคือ Mew ex แบบ SAR ที่เป็นการ์ดราคาสูงสุดของชุดแบบทิ้งห่าง ตามด้วย Charizard ex และ Gardevoir ex แบบ SAR เช็คราคาการ์ดโปเกม่อนล่าสุดได้ทีละใบ แล้วซื้อ-ขายการ์ดของแท้กับผู้ขายทั่วไทย',
    en: 'Paldean Fates (sv04.5) is the English-language shiny set collectors worldwide keep coming back to. The SAR Mew ex is comfortably the most valuable card in it, followed by the SAR Charizard ex and Gardevoir ex. Check the latest price card by card, then buy or sell authentic copies with sellers across Thailand.',
  },
  sv09: {
    th: "Journey Together (sv09) คือชุดการ์ดโปเกมอนภาษาอังกฤษที่เน้นการ์ด ex ของตัวละคร โดยมี Lillie's Clefairy ex แบบ SAR เป็นใบราคาสูงสุดของชุด ตามด้วย Salamence ex และ N's Zoroark ex แบบ SAR เช็คราคาตลาดของทุกใบในชุด แล้วซื้อ-ขายการ์ดของแท้จากผู้ขายในไทยได้ในหน้านี้",
    en: "Journey Together (sv09) is an English-language set centred on character ex cards. The SAR Lillie's Clefairy ex is the most valuable card in it, with the SAR Salamence ex and N's Zoroark ex behind it. Check market prices across the full set, then buy or sell authentic copies from sellers in Thailand.",
  },
  swsh9: {
    th: 'Brilliant Stars (swsh9) คือชุดการ์ดโปเกมอนภาษาอังกฤษยุค Sword & Shield ที่นักสะสมยังตามเก็บถึงวันนี้ ใบที่ราคาแรงที่สุดคือ Charizard V แบบ SR ตามด้วย Umbreon VMAX จากหมวด Trainer Gallery และ Charizard VSTAR แบบ SAR เช็คราคาการ์ดโปเกม่อนย้อนยุคได้ทุกใบ แล้วซื้อ-ขายของแท้กับผู้ขายทั่วไทยได้เลย',
    en: 'Brilliant Stars (swsh9) is a Sword & Shield-era English set collectors still chase today. The SR Charizard V is the most valuable card in it, followed by the Trainer Gallery Umbreon VMAX and the SAR Charizard VSTAR. Check prices across the whole set, then buy or sell authentic copies with sellers all over Thailand.',
  },
  s7d: {
    th: 'Skyscraping Perfection (S7D) คือชุดการ์ดโปเกมอนภาษาญี่ปุ่นยุค Sword & Shield ที่สายสะสมการ์ดญี่ปุ่นในไทยยังตามหา ใบราคาสูงสุดของชุดคือ Noivern V (オンバーンV) แบบ Super Rare ตามด้วย Duraludon V และการ์ดเทรนเนอร์ Raihan เช็คราคาการ์ดโปเกม่อนภาษาญี่ปุ่นได้ทีละใบ แล้วซื้อ-ขายของแท้กับผู้ขายในไทยได้ที่นี่',
    en: 'Skyscraping Perfection (S7D) is a Japanese-language Sword & Shield-era set that Japanese-card collectors in Thailand still hunt. The Super Rare Noivern V (オンバーンV) is the most valuable card in it, followed by Duraludon V and the trainer card Raihan. Check Japanese Pokemon card prices one by one, then buy or sell authentic copies with sellers in Thailand.',
  },

  // Marvel's Spider-Man. Added for a MEASURED query rather than a hunch:
  // "thwip app" carries 86 impressions and 0 clicks — the biggest zero-click
  // query on the domain — and Thwip! is a card in THIS set (#20). 283 of the
  // 286 rows are priced, so the standard "check every price" promise holds;
  // that is the same test that disqualified S7D-th from batch 3.
  //
  // The Soul Stone's seven-figure baht price is CORRECT, not a bad row: the
  // cosmic foil textless printing traded at USD 32,999 on TCGplayer, confirmed
  // externally before the copy was written to lean on it.
  'mtg-spm': {
    th: 'Marvel’s Spider-Man คือชุดการ์ดเมจิก (Magic: The Gathering) ที่จับมือกับมาร์เวล และกลายเป็นชุดที่คนพูดถึงมากที่สุดชุดหนึ่ง ใบชูโรงคือ The Soul Stone ซึ่งเวอร์ชันหายากที่สุดซื้อขายกันในหลักล้านบาท ถัดมาคือ Spectacular Spider-Man และการ์ด Mythic สองหน้าอย่าง Eddie Brock // Venom, Lethal Protector กับ Peter Parker // Amazing Spider-Man ส่วนสายเล่นก็ตามเก็บการ์ดอย่าง Thwip! กันด้วย เช็คราคาการ์ดในชุดนี้ได้ทุกใบ แล้วซื้อ-ขายของแท้กับผู้ขายในไทยได้เลย',
    en: 'Marvel’s Spider-Man is Magic: The Gathering’s Marvel crossover set and one of the most talked-about releases in years. The Soul Stone leads it — its rarest treatment trades in the millions of baht — followed by Spectacular Spider-Man and the double-faced Mythics Eddie Brock // Venom, Lethal Protector and Peter Parker // Amazing Spider-Man. Players also chase commons like Thwip!. Check the price of every card in the set, then buy or sell authentic copies with sellers in Thailand.',
  },

};

/** Intro copy for a set page, or null when the set has none. */
export function getSetIntro(setId: string): SetIntro | null {
  return SET_INTROS[setId.toLowerCase()] ?? null;
}
