/**
 * Offline cases for the chat policy (lib/chatPolicy.ts): what must be
 * refused, what must pass, and what the masker hides. Change the patterns
 * with this file, not by feel; false positives on plain buyer and shipping
 * talk are the failure to avoid.
 *
 * Run: npx tsx scripts/check-chat-policy.ts
 * No network, no DB. Exit 1 on any failure.
 */
import { CHAT_MASK, findOffPlatform, maskOffPlatform, type OffPlatformKind } from '@/lib/chatPolicy';
import { chatBanForStrike } from '@/lib/chat';

const TEAM_OUTREACH = `สวัสดีครับ ทีม Cardstreet ติดต่อมาเรื่องคำสั่งซื้อ 2 รายการของร้านที่ยังแสดงสถานะ "ป้ายพร้อมแล้ว" ในระบบครับ
- เลขพัสดุ TH670398RNV70F (ドラメシヤ 100 บาท)
- เลขพัสดุ TH010798WMPQ8A (Monkey.D.Luffy OP07-109 20 บาท)
ทาง Flash ยังไม่มีการสแกนรับพัสดุทั้งสองเลขนี้ หากต้องการให้พนักงานมารับอีกครั้ง กดปุ่มจองรับพัสดุใหม่ที่การ์ดคำสั่งซื้อได้เลยครับ หรือนำพัสดุไปส่งที่สาขา Flash ก็ได้

Hello from the Cardstreet team. Two of your orders still show as "Label ready" on our side: waybill TH670398RNV70F (100 THB) and TH010798WMPQ8A (20 THB), placed on 12 October. If you want a courier to come again, tap Book again on the order card, or drop the parcel at any Flash branch. Open the label from the order card (Open / Print label) or the PDF attached to the label email.`;

const BLOCKED: Array<[string, OffPlatformKind]> = [
    // Selling outside a listing (the first week's real case, and variants)
    ['I have Pokémon cards and I want to sell them. Do you want to buy them?', 'solicit'],
    ['Do you want to buy them?', 'solicit'],
    ['Do you want to buy my collection?', 'solicit'],
    ['Are you buying cards? I have a lot', 'solicit'],
    ['wts charizard psa 10', 'solicit'],
    ['How much would you pay for a moonbreon?', 'solicit'],
    ["I'm looking to sell some slabs", 'solicit'],
    ['I’m selling my collection, interested?', 'solicit'],
    ['I have 50 cards for sale', 'solicit'],
    ['you can buy from me cheaper', 'solicit'],
    ['we are trying to sell a binder', 'solicit'],
    ['อยากขายการ์ด รับซื้อไหม', 'solicit'],
    ['มีการ์ดจะขาย สนใจไหม', 'solicit'],
    ['ร้านรับซื้อการ์ดไหมครับ', 'solicit'],
    ['ขายให้ร้านได้ไหม', 'solicit'],
    ['อยากปล่อยการ์ดชุดนี้', 'solicit'],
    // Contact details the first week showed the filter missing
    ['Yoy can send you line', 'contact'],
    ['Zero nine eight zero one three one three two three', 'contact'],
    ['0 9 8 zero one 3 1 3 2 3', 'contact'],
    ['ศูนย์ เก้า แปด ศูนย์ หนึ่ง สาม หนึ่ง สาม สอง สาม', 'contact'],
    ['ศูนย์เก้าแปดศูนย์หนึ่งสามหนึ่งสามสองสาม', 'contact'],
    ['do you have line?', 'contact'],
    ['contact me via line', 'contact'],
    ['give me your line', 'contact'],
    // The rule as it shipped
    ['ผมขอ ไลน์ ได้ไหมคสับ', 'contact'],
    ['หรือหากลูกค้าสะดวกแอดมา สามารถ แอดที่ ID 0903323805 สามารถแอดได้เลยนะครับ', 'contact'],
    ['add me on LINE', 'contact'],
    ['line id: abc123', 'contact'],
    ['my ig is @foo.bar', 'contact'],
    ['mail me test@gmail.com', 'contact'],
    ['0903323805', 'contact'],
    ['๐๙๐๓๓๒๓๘๐๕', 'contact'],
    ['see shopee.co.th/x', 'link'],
    ['https://example.com/deal', 'link'],
    ['โอนตรงได้ไหม', 'offplatform'],
    ['pay me directly and I ship today', 'offplatform'],
    ['can we buy direct, no fees', 'offplatform'],
    ['นัดเจอรับการ์ดไหม', 'offplatform'],
];

const ALLOWED: string[] = [
    // Buyer talk about a listed card
    'Is this still available?',
    'I want to buy this card',
    'Can you do 450?',
    "I'll buy these 3 if you can do 1000",
    'Do you have more cards from this set?',
    'Do you want to sell it for 400?',
    'Would you sell it for 400?',
    'Are you buying it today or tomorrow?',
    'Do you want to buy it or not?',
    'ยังมีขายไหม',
    'ขอซื้อใบนี้ครับ',
    'ลดได้ไหม',
    'ร้านมีการ์ดขายไหม',
    'สนใจใบนี้ครับ',
    'สมมุติว่าขายได้แล้วเงินจะเข้าเลยมั้ยครับ',
    'ลูกค้าได้สั่งการ์ดจากทางร้านได้ไหม',
    // Shipping talk
    'ทางพนักงานแจ้งว่าส่งเรียบร้อยแล้วครับ',
    'ชิ้นที่ 2 ทำการแพ็คแล้ว รอส่ง',
    'Flash will collect it tomorrow',
    'ส่งถึงมือลูกค้าแล้ว',
    'ได้รับของแล้วนะครับ',
    'TH670398RNV70F',
    'EF123456789TH',
    TEAM_OUTREACH,
    // Numbers that are not contacts
    '045 078 102',
    'one two three',
    'I bought one, sold two, the other three are mint',
    'card 087/198 at 150 baht',
    '@150 per card',
    // In-app selling
    "I'll list it in my shop today",
    'Check my shop, I listed the other one',
    'listed at cardstreet.app/card/sv4pt5-234',
    // Everyday
    'ผมเลิกเที่ยงคืนเลย',
    'Great wazzup',
    'it is online now',
    'ลงขายออนไลน์แล้ว',
    'Hi bro',
];

let failures = 0;
for (const [text, kind] of BLOCKED) {
    const got = findOffPlatform(text);
    if (got !== kind) {
        failures++;
        console.log(`FAIL block ${JSON.stringify(text.slice(0, 70))}: expected ${kind}, got ${got}`);
    }
}
for (const text of ALLOWED) {
    const got = findOffPlatform(text);
    if (got !== null) {
        failures++;
        console.log(`FAIL allow ${JSON.stringify(text.slice(0, 70))}: got ${got}`);
    }
}

// The masker hides the contact and nothing else.
const MASKED: Array<[string, string]> = [
    ['แอดที่ ID 0903323805 ได้เลย', `แอดที่ ID ${CHAT_MASK} ได้เลย`],
    ['Zero nine eight zero one three one three two three ok', `${CHAT_MASK} ok`],
    ['call 090-332-3805 now', `call ${CHAT_MASK} now`],
    ['045 078 102', '045 078 102'],
    ['see cardstreet.app/card/x', 'see cardstreet.app/card/x'],
];
for (const [text, want] of MASKED) {
    const got = maskOffPlatform(text);
    if (got !== want) {
        failures++;
        console.log(`FAIL mask ${JSON.stringify(text)}: got ${JSON.stringify(got)}`);
    }
}

// The ladder: warning, 48 h, 7 days, for good.
const LADDER: Array<[number, ReturnType<typeof chatBanForStrike>]> = [
    [1, null], [2, { hours: 48 }], [3, { hours: 168 }], [4, 'permanent'], [9, 'permanent'],
];
for (const [strike, want] of LADDER) {
    const got = chatBanForStrike(strike);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
        failures++;
        console.log(`FAIL ladder strike ${strike}: got ${JSON.stringify(got)}`);
    }
}

console.log(`${BLOCKED.length} blocked, ${ALLOWED.length} allowed, ${MASKED.length} masked, ${LADDER.length} ladder; ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
