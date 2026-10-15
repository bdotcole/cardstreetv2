// Chat may not be used to take a deal off Cardstreet (Terms section 3,
// "Off-Platform Transactions"). /api/chat/messages refuses a message this
// flags, and the read routes mask contact details in messages sent before
// the rule existed. Two days after chat launched, a seller asked a buyer
// for their LINE and posted their own LINE ID (a phone number); this is the
// filter for that. Server-side only (the patterns use lookbehind).
//
// It errs towards blocking: a refused message comes back to the sender's
// composer with the reason, so a false positive costs a rewrite, while a
// miss can cost a buyer an unprotected payment. Matching runs on a
// normalized copy (full-width forms folded, Thai digits made ASCII,
// invisible characters dropped) so the usual disguises do not slip past.

export type OffPlatformKind = 'contact' | 'link' | 'offplatform';

export const CHAT_MASK = '•••';

const INVISIBLE = /[​-‍⁠﻿­️⃣]/;

/**
 * The normalized text plus, for each of its UTF-16 units, the index in the
 * original it came from, so a match found in the normalized copy can be
 * masked in the original without changing anything else in it.
 */
function normalizeWithMap(text: string): { n: string; map: number[] } {
    let n = '';
    const map: number[] = [];
    let i = 0;
    for (const ch of text) {
        let out = '';
        if (!INVISIBLE.test(ch)) {
            out = ch.normalize('NFKC').toLowerCase();
            out = out.replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50));
            out = out.replace(new RegExp(INVISIBLE.source, 'g'), '');
        }
        for (let k = 0; k < out.length; k++) map.push(i);
        n += out;
        i += ch.length;
    }
    map.push(text.length);
    return { n, map };
}

// Phone, bank account, PromptPay and national ID numbers: any run of nine or
// more digits, spaced or dashed or not. Card numbers (087/198), prices and
// dates stay under nine; a run glued to letters (a waybill such as
// EF123456789TH) is a code, not a contact.
const DIGIT_RUN = /(?<![a-z0-9/#])\+?\d(?:[\s.\-]{0,2}\d){8,}(?![a-z0-9/])/g;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g;
const URL = /(?:https?:\/\/|www\.)[^\s]+/g;
const BARE_DOMAIN = /\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|me|ee|ly|gl|io|co|th|shop|store|link|page|site|xyz)\b(?:\/[^\s]*)?/g;
// A handle has a letter in it: "@150" is a price per card, not an account.
const AT_HANDLE = /(?<=^|[\s(:：])@(?=[a-z0-9._-]*[a-z])[a-z0-9._-]{3,}/g;
// "ไอดี" is Thai for "ID" and in a chat almost always a LINE ID. English
// "id" only with a colon, so a card id mentioned in passing is not caught.
const ID_HANDLE = /(?<=(?:ไอดี|\bid\s*[:：=])\s*[:：=]?\s*)@?[a-z0-9._-]{4,}/g;

// Where our own links point; a link to a card or shop here keeps the deal here.
const OWN_HOST = /^(?:https?:\/\/)?(?:www\.)?cardstreet\.app(?:[/?#]|$)/;

const MAIL_WORDS = /\b(?:gmail|hotmail|yahoo|outlook|icloud|protonmail)\b/;

// Contact channels named outright. Thai "ไลน์" is the LINE app (but not
// inside ออนไลน์, "online"); English "line" only when it is clearly the app.
const CONTACT_WORDS = new RegExp(
    [
        String.raw`\b(?:facebook|fb|messenger|instagram|insta|ig|whatsapp|telegram|wechat|discord|tiktok|kakao|shopee|lazada)\b`,
        String.raw`\bline\s*(?:id|@|:)`,
        String.raw`\b(?:add|dm|msg|message|text|chat)\s+(?:me\s+)?(?:on\s+|via\s+)?line\b`,
        String.raw`\b(?:my|your|ur)\s+line\b`,
        String.raw`\bline\s+me\b`,
        '(?<!ออน)ไลน',
        'เฟซบุ๊ก', 'เฟสบุ๊ค', 'เฟสบุค', 'เฟซบุ้ค', 'เฟซ', 'เฟส',
        'อินบ็อกซ์', 'อินบอกซ์', 'อินบอก',
        'ไอจี', 'อินสตาแกรม', 'อินสตา',
        'วอทส์แอป', 'วอทแอพ', 'วอทส์แอพ',
        'เทเลแกรม', 'เมสเซนเจอร์', 'ติ๊กต็อก', 'ติ๊กต๊อก',
        'ช้อปปี้', 'ลาซาด้า',
        'ขอเบอร์', 'แลกเบอร์',
    ].join('|'),
);

// Arranging the payment or the hand-over outside the app. Plain shipping
// talk ("delivered to the customer", Flash collecting the parcel) must pass.
const OFFPLATFORM_WORDS = new RegExp(
    [
        String.raw`\b(?:bank\s*transfer|bank\s*account|account\s*number|prompt\s*pay|paypal|venmo|true\s*money|cash\s+on\s+delivery|cod)\b`,
        String.raw`\b(?:outside|off|without)\s+(?:of\s+)?(?:the\s+|this\s+)?(?:app|site|website|platform|cardstreet)\b`,
        String.raw`\bpay\s+(?:you|me)\s+direct(?:ly)?\b`,
        String.raw`\bdirect\s+(?:transfer|payment|deal)\b`,
        String.raw`\bmeet\s*up\b`,
        String.raw`\bmeet\s+in\s+person\b`,
        'โอนตรง', 'โอนเข้าบัญชี', 'เลขบัญชี', 'เลขที่บัญชี', 'พร้อมเพย์',
        'นอกแอพ', 'นอกแอป', 'นอกระบบ', 'ไม่ผ่านแอพ', 'ไม่ผ่านแอป', 'ไม่ผ่านระบบ',
        'ซื้อขายกันเอง', 'ดีลกันเอง', 'ตกลงกันเอง',
        'เก็บเงินปลายทาง', 'นัดเจอ', 'นัดรับของ', 'นัดรับการ์ด',
        'ทรูมันนี่', 'ทรูวอลเล็ท',
    ].join('|'),
);

/** "045 078 102": three-digit groups are card numbers listed together, not a phone. */
function isCardNumberList(run: string): boolean {
    const groups = run.split(/[\s.\-]+/);
    return groups.length >= 3 && groups.every((g) => g.length === 3);
}

type Span = [start: number, end: number];

/** Spans (in the normalized text) of the parts the masker hides. */
function contactSpans(n: string): Span[] {
    const spans: Span[] = [];
    const add = (re: RegExp, keep?: (m: string) => boolean) => {
        for (const m of n.matchAll(re)) {
            if (keep && !keep(m[0])) continue;
            spans.push([m.index!, m.index! + m[0].length]);
        }
    };
    add(DIGIT_RUN, (m) => !isCardNumberList(m));
    add(EMAIL);
    add(URL, (m) => !OWN_HOST.test(m));
    add(BARE_DOMAIN, (m) => !OWN_HOST.test(m));
    add(AT_HANDLE);
    add(ID_HANDLE);
    return spans;
}

/** Why `text` may not be sent in chat, or null when it may. */
export function findOffPlatform(text: string): OffPlatformKind | null {
    if (!text) return null;
    const { n } = normalizeWithMap(text);
    const spans = contactSpans(n);
    if (spans.length > 0) {
        // A link is a link; anything else the masker hides is a contact.
        const onlyLinks = spans.every(([s, e]) => {
            const part = n.slice(s, e);
            return /^(?:https?:\/\/|www\.)/.test(part) || /^[a-z0-9][a-z0-9-]*\.[a-z]/.test(part) && !part.includes('@');
        });
        return onlyLinks ? 'link' : 'contact';
    }
    if (MAIL_WORDS.test(n) || CONTACT_WORDS.test(n)) return 'contact';
    if (OFFPLATFORM_WORDS.test(n)) return 'offplatform';
    return null;
}

/**
 * `text` with phone numbers, emails, outside links and handles replaced by
 * CHAT_MASK, for messages stored before sending them was refused. Everything
 * else in the message is left exactly as written.
 */
export function maskOffPlatform(text: string): string {
    if (!text) return text;
    const { n, map } = normalizeWithMap(text);
    const spans = contactSpans(n)
        .map(([s, e]): Span => [map[s], map[e]])
        .sort((a, b) => a[0] - b[0]);
    if (spans.length === 0) return text;
    let out = '';
    let at = 0;
    for (const [s, e] of spans) {
        if (e <= at) continue;
        out += text.slice(at, Math.max(at, s)) + CHAT_MASK;
        at = Math.max(at, e);
    }
    return out + text.slice(at);
}
