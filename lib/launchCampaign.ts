/**
 * The Oct 9 2026 "shipping inside the listing price" announcement campaign:
 * four emails to every user and two pushes to sellers with listings.
 *
 * The schedule lives in the database (campaign_messages, migration
 * 20260930_campaign_messages.sql) so a send can be moved or held with one
 * UPDATE. This file holds the copy, the audiences, and the runner that
 * /api/cron/launch-campaign calls every ten minutes.
 *
 * The copy is the founder's QC'd wording of 2026-09-30, Thai and English.
 * Nothing server-side records a user's language (it lives in a cookie and
 * localStorage), so every email carries the Thai message with the English
 * one beneath it, and every push carries both lines.
 *
 * Delete this file, the cron route and its vercel.json entry once the
 * campaign has finished (after 2026-10-09).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendCampaignEmail, sendCampaignPush } from './courier';

// ─── Copy ────────────────────────────────────────────────────────────────────

type Inline = string | { b: string };
type Line = Inline[];
type Block = { p: Line } | { h: string } | { ul: Line[] } | { ol: Line[] };

const b = (text: string): Inline => ({ b: text });

interface EmailCopy {
    subject: string;
    preview: string;
    body: Block[];
}

interface EmailMessage {
    channel: 'email';
    th: EmailCopy;
    en: EmailCopy;
}

interface PushCopy {
    title: string;
    body: string;
}

interface PushMessage {
    channel: 'push';
    th: PushCopy;
    en: PushCopy;
}

export const CAMPAIGN_MESSAGES: Record<string, EmailMessage | PushMessage> = {
    'shipping-email-1': {
        channel: 'email',
        th: {
            subject: 'Cardstreet: ราคาเดียวรวมค่าส่ง เริ่ม 9 ต.ค.',
            preview: 'ราคาที่เห็นคือราคาที่จ่ายจริง และร้านค้าตั้งยอดสั่งซื้อขั้นต่ำได้',
            body: [
                { p: ['สวัสดีนักสะสมทุกท่าน'] },
                {
                    p: [
                        'เรากำลังปรับปรุงระบบซื้อขายบน Cardstreet ให้ง่ายขึ้นอีกขั้น ตั้งแต่ ',
                        b('วันศุกร์ที่ 9 ตุลาคม 2569 เวลา 00:00 น.'),
                        ' ราคาที่แสดงบนรายการสินค้าคือราคาที่ผู้ซื้อจ่ายจริง (รวมค่าจัดส่งแล้ว) โดยจะไม่มีการบวกค่าบริการหรือค่าส่งเพิ่มในหน้าชำระเงินอีก',
                    ],
                },
                { h: 'สำหรับผู้ซื้อ' },
                {
                    ul: [
                        [b('ราคาที่เห็นคือราคาที่จ่ายจริง'), ' ไม่มีค่าส่งบวกเพิ่มในหน้าชำระเงิน'],
                        [
                            b('บางร้านอาจมีการตั้งยอดสั่งซื้อขั้นต่ำ'),
                            ' โดยระบบจะแจ้งในตะกร้าสินค้าว่าต้องเลือกซื้อเพิ่มอีกเท่าไรจึงจะชำระเงินได้ เหมาะกับการเก็บการ์ดราคาถูกหลายใบเพื่อจัดเด็คหรือเก็บให้ครบชุดในพัสดุเดียว',
                        ],
                    ],
                },
                { h: 'สำหรับผู้ขาย' },
                {
                    ul: [
                        [
                            b('ระบบจะบวกเพิ่ม ฿40 เข้ากับทุกรายการสินค้าที่ลงขายอยู่ในปัจจุบันให้อัตโนมัติ ในเวลา 00:00 น. ของวันที่ 9 ตุลาคม'),
                            ' เพื่อให้มั่นใจว่าผู้ขายไม่ต้องแบกรับค่าจัดส่งเอง',
                        ],
                        [
                            b('โปรดอย่าเพิ่งปรับขึ้นราคาเองก่อนวันดังกล่าว'),
                            ' เพราะหากคุณปรับขึ้นราคาไว้ก่อน ระบบจะบวกเพิ่มอีก ฿40 ทับซ้อนเข้าไปอีก (หลังวันที่ 9 ตุลาคม คุณสามารถปรับราคาสินค้าขึ้นหรือลงได้ตามปกติทุกเมื่อ)',
                        ],
                        [
                            b('สินค้าที่ลงขายหลังวันที่ 9 ตุลาคม เป็นต้นไป'),
                            ' ขอให้ตั้งราคารวมค่าจัดส่งและค่าแพ็กให้เรียบร้อย (โดยปกติค่าบริการ Flash Express จะอยู่ที่ประมาณ ฿30–40 ต่อพัสดุ)',
                        ],
                        [
                            b('ใหม่! ตั้งยอดสั่งซื้อขั้นต่ำของร้านค้าได้'),
                            ' เช่น ลงการ์ด Common ใบละ ฿10 แล้วตั้งยอดขั้นต่ำไว้ที่ ฿100 เมื่อมีออเดอร์ 10 ใบขึ้นไป การจัดส่งใน 1 พัสดุก็จะคุ้มค่าทันที ตั้งค่าได้ที่ โปรไฟล์ > บัญชีผู้ขาย (บน Desktop: ขาย) หมายเหตุ: ข้อเสนอราคา (Offers) ที่คุณกดรับ จะไม่อยู่ในเงื่อนไขยอดขั้นต่ำนี้',
                        ],
                        [
                            b('การจัดส่งยังคงเหมือนเดิม'),
                            ' ระบบใบจัดส่ง การเข้ารับพัสดุ และการติดตามสถานะผ่าน Flash Express สามารถใช้งานได้ตามปกติไม่มีเปลี่ยนแปลง',
                        ],
                    ],
                },
                { h: 'อัปเดตอื่น ๆ บน Cardstreet' },
                {
                    ul: [
                        [b('หยุดร้านชั่วคราว'), ' กดเพียงครั้งเดียวเพื่อซ่อนรายการสินค้าทั้งหมด และกดอีกครั้งเพื่อเปิดร้านกลับมาขายตามปกติ'],
                        [b('เลือกจำนวนสินค้า'), ' การ์ดใบเดียวกันที่มีหลายใบ จะแสดงเป็นรายการเดียวพร้อมเมนูให้เลือกจำนวน'],
                    ],
                },
                { p: ['หากมีข้อสงสัยเพิ่มเติม สามารถตอบกลับอีเมลนี้ หรือติดต่อเราได้ที่ support@thailandtcg.com'] },
                { p: ['ขอบคุณที่ร่วมสะสมไปกับเรา'] },
                { p: ['ทีม Cardstreet'] },
            ],
        },
        en: {
            subject: 'Cardstreet: one price, shipping included, from October 9',
            preview: 'The price you see is the price you pay, and shops can set a minimum order.',
            body: [
                { p: ['Hi collectors,'] },
                {
                    p: [
                        "We're making buying and selling on Cardstreet simpler. From ",
                        b('Friday, October 9, 2026 at 12:00 am Bangkok time'),
                        ', the price on a listing is the price the buyer pays. Shipping is included. Nothing is added at checkout.',
                    ],
                },
                { h: 'If you buy' },
                {
                    ul: [
                        [b('The price you see is the price you pay.'), ' No shipping line at checkout.'],
                        [
                            b('Some shops have a minimum order.'),
                            ' Your cart tells you how much more to add from that shop before you can check out. It is the easy way to pick up a stack of cheap singles for a deck or a set in one parcel.',
                        ],
                    ],
                },
                { h: 'If you sell' },
                {
                    ul: [
                        [
                            b('We will add ฿40 to every existing listing automatically at 12:00 am on October 9,'),
                            ' so no seller is left paying postage out of pocket.',
                        ],
                        [
                            b("Please don't raise your prices before then."),
                            ' If you do, the ฿40 lands on top. After October 9 you can lower or raise any price whenever you like.',
                        ],
                        [
                            b('New listings after October 9'),
                            ' should be priced with shipping and handling included. Flash Express runs about ฿30-40 a parcel.',
                        ],
                        [
                            b('New: set a minimum order for your shop.'),
                            ' List commons at ฿10 each, set a ฿100 minimum, and a ten-card order still earns you money on one parcel. Find it in Profile > Seller Account (on desktop: Sell). Offers you accept are exempt.',
                        ],
                        [
                            b('Shipping itself is unchanged.'),
                            ' Labels, pickup and tracking through Flash Express work exactly as before.',
                        ],
                    ],
                },
                { h: 'Also new on Cardstreet' },
                {
                    ul: [
                        [b('Pause your shop.'), ' One tap hides every listing, and one tap brings them back.'],
                        [b('Quantity picker.'), ' Identical copies of a card show as one listing with a quantity.'],
                    ],
                },
                { p: ['Questions? Reply to this email or write to support@thailandtcg.com.'] },
                { p: ['Thank you for collecting with us.'] },
                { p: ['The Cardstreet team'] },
            ],
        },
    },

    'shipping-email-2': {
        channel: 'email',
        th: {
            subject: 'อีก 4 วันเท่านั้น: ราคาเดียวรวมค่าส่งบน Cardstreet',
            preview: 'เริ่มวันศุกร์ที่ 9 ต.ค. นี้ เวลา 00:00 น.',
            body: [
                { p: ['สวัสดีครับ'] },
                {
                    p: [
                        'ขอแจ้งเตือนอีกครั้ง ตั้งแต่',
                        b('วันศุกร์ที่ 9 ตุลาคม เวลา 00:00 น.'),
                        ' เป็นต้นไป ทุกราคาบน Cardstreet จะรวมค่าจัดส่งเรียบร้อยแล้ว ผู้ซื้อจ่ายตรงตามราคาที่เห็นทันที',
                    ],
                },
                { h: '3 ข้อที่ผู้ขายควรรู้' },
                {
                    ol: [
                        [
                            b('ระบบจะบวกเพิ่ม ฿40 ให้ทุกรายการสินค้าโดยอัตโนมัติ'),
                            'เมื่อถึงเวลาเปลี่ยนผ่าน โปรดอย่าเพิ่งปรับขึ้นราคาเองก่อนวันดังกล่าว',
                        ],
                        [b('หลังวันที่ 9 ตุลาคม ตรวจสอบราคาของคุณ'), ' แล้วปรับขึ้นหรือลงได้ตามต้องการทุกเมื่อ'],
                        [
                            b('ตั้งยอดสั่งซื้อขั้นต่ำของร้าน'),
                            ' สามารถตั้งค่าได้ที่ โปรไฟล์ > บัญชีผู้ขาย ช่วยให้ลงขายการ์ดราคาย่อมเยาได้โดยไม่ขาดทุนค่าส่ง',
                        ],
                    ],
                },
                { p: [b('สำหรับผู้ซื้อไม่ต้องดำเนินการใดๆ เพิ่มเติม'), ' ราคาที่เห็นคือราคาที่จ่ายจริง'] },
                { p: ['หากมีข้อสงสัย สามารถตอบกลับอีเมลนี้ หรือติดต่อเราได้ที่ support@thailandtcg.com'] },
                { p: ['ทีม Cardstreet'] },
            ],
        },
        en: {
            subject: '4 days to go: one price, shipping included',
            preview: 'Starts Friday, October 9 at 12:00 am Bangkok time.',
            body: [
                { p: ['Hi,'] },
                {
                    p: [
                        'A reminder: from ',
                        b('Friday, October 9 at 12:00 am Bangkok time'),
                        ', every price on Cardstreet includes shipping. Buyers pay what they see.',
                    ],
                },
                { h: 'Three things for sellers' },
                {
                    ol: [
                        [
                            b('We add ฿40 to every listing automatically'),
                            " at the moment of the change. Please don't raise prices yourself before then.",
                        ],
                        [b('After October 9, review your prices'), ' and lower or raise them as you like.'],
                        [
                            b('Set a minimum order for your shop'),
                            ' in Profile > Seller Account, so cheap singles are worth listing.',
                        ],
                    ],
                },
                { p: [b('Buyers have nothing to do.'), ' The price you see is the price you pay.'] },
                { p: ['Questions? Reply to this email or write to support@thailandtcg.com.'] },
                { p: ['The Cardstreet team'] },
            ],
        },
    },

    'shipping-push-1': {
        channel: 'push',
        th: {
            title: 'อีก 48 ชม. ราคารวมค่าส่งบน Cardstreet',
            body: '9 ต.ค. เวลา 00:00 น. ระบบจะบวก ฿40 ให้ทุกรายการอัตโนมัติ ยังไม่ต้องปรับราคาเอง และตั้งยอดขั้นต่ำได้ที่โปรไฟล์',
        },
        en: {
            title: '48 hours: prices will include shipping',
            body: 'At 12:00 am Oct 9 we add ฿40 to each of your listings. No need to raise prices yourself. Set your shop minimum in Profile.',
        },
    },

    'shipping-email-3': {
        channel: 'email',
        th: {
            subject: 'พรุ่งนี้: ทุกราคาบน Cardstreet รวมค่าส่งแล้ว',
            preview: 'เริ่มเปลี่ยนคืนนี้ เวลา 00:00 น. (เข้าสู่วันศุกร์ที่ 9 ต.ค.)',
            body: [
                { p: ['สวัสดีครับ'] },
                {
                    p: [
                        'อีก 24 ชั่วโมงเท่านั้น! ในเวลา ',
                        b('00:00 น. ของวันศุกร์ที่ 9 ตุลาคม'),
                        ' ทุกราคาบน Cardstreet จะรวมค่าจัดส่งเรียบร้อยแล้ว',
                    ],
                },
                {
                    ul: [
                        [
                            b('ผู้ขาย:'),
                            ' ทุกรายการของคุณจะถูกบวกเพิ่ม ฿40 โดยอัตโนมัติ เมื่อระบบเริ่มใช้งานแล้ว สามารถเข้าไปตรวจราคาและตั้งยอดสั่งซื้อขั้นต่ำของร้านได้ที่ โปรไฟล์ > บัญชีผู้ขาย',
                        ],
                        [b('ผู้ซื้อ:'), ' ไม่มีค่าส่งบวกเพิ่มในหน้าชำระเงินอีกต่อไป'],
                    ],
                },
                { p: ['หากมีข้อสงสัย สามารถตอบกลับอีเมลนี้ได้เลยครับ'] },
                { p: ['ทีม Cardstreet'] },
            ],
        },
        en: {
            subject: 'Tomorrow: every Cardstreet price includes shipping',
            preview: 'The change happens at 12:00 am on October 9, Bangkok time.',
            body: [
                { p: ['Hi,'] },
                {
                    p: [
                        'In 24 hours, at ',
                        b('12:00 am on Friday, October 9 (Bangkok time)'),
                        ', every price on Cardstreet will include shipping.',
                    ],
                },
                {
                    ul: [
                        [
                            b('Sellers:'),
                            " ฿40 is added to each of your listings automatically. Once it's live, review your prices and set your shop's minimum order in Profile > Seller Account.",
                        ],
                        [b('Buyers:'), ' no more shipping charge at checkout.'],
                    ],
                },
                { p: ['Questions? Just reply to this email.'] },
                { p: ['The Cardstreet team'] },
            ],
        },
    },

    'shipping-push-2': {
        channel: 'push',
        th: {
            title: 'พรุ่งนี้: ทุกราคาบน Cardstreet รวมค่าส่ง',
            body: 'เที่ยงคืนนี้ 00:00 น. ทุกรายการของคุณ +฿40 อัตโนมัติ หลังระบบเปลี่ยนแล้วเข้ามาตรวจราคาและตั้งยอดขั้นต่ำของร้าน',
        },
        en: {
            title: 'Tomorrow: prices include shipping',
            body: 'At 12:00 am tonight ฿40 is added to each of your listings. After the change, review your prices and set your shop minimum.',
        },
    },

    'shipping-email-4': {
        channel: 'email',
        th: {
            subject: 'เริ่มแล้ววันนี้: ราคาเดียวรวมค่าส่งบน Cardstreet',
            preview: 'ราคาที่เห็นคือราคาที่จ่ายจริง เริ่มแล้วตอนนี้',
            body: [
                { p: ['สวัสดีครับ'] },
                {
                    p: [
                        'ระบบใหม่เริ่มใช้งานแล้ว ตั้งแต่ตอนนี้เป็นต้นไป ทุกราคาบน Cardstreet ได้รวมค่าจัดส่งเรียบร้อยแล้ว ผู้ซื้อจ่ายตรงตามราคาที่เห็นทันที',
                    ],
                },
                { h: 'ผู้ขายมี 2 สิ่งที่ต้องทำในวันนี้' },
                {
                    ol: [
                        [
                            b('ตรวจสอบราคาของคุณ'),
                            ' ระบบบวกเพิ่ม ฿40 ให้ทุกรายการแล้ว ปรับราคาขึ้นหรือลงตามต้องการได้ที่หน้าคลังการ์ด',
                        ],
                        [b('ตั้งยอดสั่งซื้อขั้นต่ำของร้าน'), ' ที่ โปรไฟล์ > บัญชีผู้ขาย (บน Desktop: ขาย)'],
                    ],
                },
                {
                    p: [
                        b('ผู้ซื้อ'),
                        ' เลือกการ์ด ใส่ตะกร้า แล้วชำระเงินตามราคาที่เห็นได้เลย (หากร้านมียอดขั้นต่ำ ระบบในตะกร้าจะคำนวณและแจ้งเตือนว่าต้องเลือกซื้อเพิ่มอีกเท่าไร)',
                    ],
                },
                { p: ['ขอบคุณที่ร่วมสะสมไปกับเรา'] },
                { p: ['ทีม Cardstreet'] },
            ],
        },
        en: {
            subject: "It's live: one price, shipping included",
            preview: 'The price you see is the price you pay, starting now.',
            body: [
                { p: ['Hi,'] },
                { p: ["It's live. Every price on Cardstreet now includes shipping, and buyers pay what they see."] },
                { h: 'Sellers, two things to do today' },
                {
                    ol: [
                        [b('Review your prices.'), ' We added ฿40 to every listing. Lower or raise any of them from your vault.'],
                        [b("Set your shop's minimum order"), ' in Profile > Seller Account (on desktop: Sell).'],
                    ],
                },
                {
                    p: [
                        b('Buyers:'),
                        ' pick your cards, add them to your cart, and pay the price you see. If a shop has a minimum, your cart tells you how much more to add.',
                    ],
                },
                { p: ['Thank you for collecting with us.'] },
                { p: ['The Cardstreet team'] },
            ],
        },
    },
};

// ─── Rendering ───────────────────────────────────────────────────────────────

const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const renderLine = (line: Line) =>
    line.map((part) => (typeof part === 'string' ? esc(part) : `<strong>${esc(part.b)}</strong>`)).join('');

function renderBlocks(blocks: Block[]): string {
    return blocks
        .map((block) => {
            if ('p' in block) return `<p style="margin:0 0 14px">${renderLine(block.p)}</p>`;
            if ('h' in block) return `<p style="margin:22px 0 8px;font-weight:bold">${esc(block.h)}</p>`;
            const tag = 'ul' in block ? 'ul' : 'ol';
            const items = 'ul' in block ? block.ul : block.ol;
            return (
                `<${tag} style="margin:0 0 14px;padding-left:22px">` +
                items.map((item) => `<li style="margin:0 0 8px">${renderLine(item)}</li>`).join('') +
                `</${tag}>`
            );
        })
        .join('');
}

/**
 * The email body: a hidden inbox-preview line, the Thai message, a rule, then
 * the English message. `notice` is the grey line a preview copy carries on
 * top; real sends pass none.
 */
export function renderCampaignEmailHtml(message: EmailMessage, notice?: string): string {
    const font = "font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans Thai',Arial,sans-serif;font-size:15px;color:#1f2937";
    return (
        `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">` +
        `${esc(message.th.preview)} · ${esc(message.en.preview)}</div>` +
        (notice ? `<p style="${font};color:#6b7280;margin:0 0 18px">${esc(notice)}</p>` : '') +
        `<div lang="th" style="${font};line-height:1.75">${renderBlocks(message.th.body)}</div>` +
        `<hr style="border:none;border-top:1px solid #e5e7eb;margin:26px 0">` +
        `<div lang="en" style="${font};line-height:1.6">${renderBlocks(message.en.body)}</div>`
    );
}

// ─── Audiences ───────────────────────────────────────────────────────────────

const PAGE = 1000; // PostgREST caps a response at 1000 rows whatever .limit() says.

async function fetchBannedIds(admin: SupabaseClient): Promise<Set<string>> {
    const banned = new Set<string>();
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from('profiles')
            .select('id')
            .not('banned_at', 'is', null)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw new Error(`banned lookup failed: ${error.message}`);
        for (const row of data ?? []) banned.add(row.id);
        if (!data || data.length < PAGE) break;
    }
    return banned;
}

/**
 * Every account with an address mail can reach. Left out: banned accounts,
 * the partner placeholder addresses, and Apple private-relay addresses, which
 * bounce until the sending domain is registered with Apple
 * (docs/runbooks/apple-private-relay-email.md).
 */
async function fetchEmailAudience(admin: SupabaseClient): Promise<{ userId: string; email: string }[]> {
    const banned = await fetchBannedIds(admin);
    const recipients: { userId: string; email: string }[] = [];
    for (let page = 1; page <= 30; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE });
        if (error) throw new Error(`user listing failed: ${error.message}`);
        for (const u of data?.users ?? []) {
            const email = u.email?.trim();
            if (!email || banned.has(u.id)) continue;
            const lower = email.toLowerCase();
            if (lower.endsWith('@partner.cardstreet.app') || lower.endsWith('@privaterelay.appleid.com')) continue;
            recipients.push({ userId: u.id, email });
        }
        if (!data || data.users.length < PAGE) break;
    }
    return recipients;
}

/** Sellers with a listing the +฿40 will touch, who have the app's push enabled. */
async function fetchSellerPushAudience(admin: SupabaseClient): Promise<{ userId: string; fcmToken: string }[]> {
    const banned = await fetchBannedIds(admin);
    const sellers = new Set<string>();
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from('listings')
            .select('seller_id')
            .in('status', ['active', 'draft', 'paused'])
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw new Error(`listing lookup failed: ${error.message}`);
        for (const row of data ?? []) if (row.seller_id) sellers.add(row.seller_id);
        if (!data || data.length < PAGE) break;
    }

    const recipients: { userId: string; fcmToken: string }[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from('notification_preferences')
            .select('user_id, fcm_token')
            .not('fcm_token', 'is', null)
            .order('user_id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw new Error(`push token lookup failed: ${error.message}`);
        for (const row of data ?? []) {
            if (!row.fcm_token || !sellers.has(row.user_id) || banned.has(row.user_id)) continue;
            recipients.push({ userId: row.user_id, fcmToken: row.fcm_token });
        }
        if (!data || data.length < PAGE) break;
    }
    return recipients;
}

// ─── Sending ─────────────────────────────────────────────────────────────────

const PUSH_TYPE = 'shipping_launch'; // routed to the Vault by hooks/usePushNotifications.ts

/** The two Courier calls, injectable so the run loop can be tested without sending. */
export interface CampaignSenders {
    email: typeof sendCampaignEmail;
    push: typeof sendCampaignPush;
}

function sendEmailTo(senders: CampaignSenders, key: string, message: EmailMessage, to: { userId: string; email: string }, notice?: string) {
    return senders.email(to, {
        type: key,
        subject: notice ? `[Preview] ${message.th.subject}` : message.th.subject,
        html: renderCampaignEmailHtml(message, notice),
    });
}

function sendPushTo(senders: CampaignSenders, message: PushMessage, to: { userId: string; fcmToken: string }, preview = false) {
    return senders.push(to, {
        type: PUSH_TYPE,
        title: preview ? `[Preview] ${message.th.title}` : message.th.title,
        body: `${message.th.body}\n${message.en.body}`,
    });
}

/**
 * Claim-then-send. The insert is the lock: a row that already exists is
 * skipped by ON CONFLICT DO NOTHING and never comes back in the result, so two
 * overlapping cron runs cannot both send to the same person. A failed send
 * gives its claim back so the next run retries it.
 */
async function claimAndSend<T extends { userId: string }>(
    admin: SupabaseClient,
    key: string,
    kind: 'send' | 'preview',
    recipients: T[],
    send: (recipient: T) => Promise<boolean>,
): Promise<{ sent: number; failed: number }> {
    const { data: claimed, error } = await admin
        .from('campaign_sends')
        .upsert(
            recipients.map((r) => ({ message_key: key, user_id: r.userId, kind })),
            { onConflict: 'message_key,user_id,kind', ignoreDuplicates: true },
        )
        .select('user_id');
    if (error) throw new Error(`claim failed for ${key}: ${error.message}`);

    const claimedIds = new Set((claimed ?? []).map((row) => row.user_id));
    const results = await Promise.all(
        recipients
            .filter((r) => claimedIds.has(r.userId))
            .map(async (r) => {
                const ok = await send(r).catch(() => false);
                if (!ok) {
                    await admin
                        .from('campaign_sends')
                        .delete()
                        .match({ message_key: key, user_id: r.userId, kind });
                }
                return ok;
            }),
    );
    const sent = results.filter(Boolean).length;
    return { sent, failed: results.length - sent };
}

async function fetchSentIds(admin: SupabaseClient, key: string): Promise<Set<string>> {
    const sent = new Set<string>();
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from('campaign_sends')
            .select('user_id')
            .eq('message_key', key)
            .eq('kind', 'send')
            .order('user_id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw new Error(`send log lookup failed for ${key}: ${error.message}`);
        for (const row of data ?? []) sent.add(row.user_id);
        if (!data || data.length < PAGE) break;
    }
    return sent;
}

const bangkokTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
});

interface ScheduleRow {
    key: string;
    send_at: string;
    held: boolean;
}

/**
 * Each admin gets one copy of every message as soon as the campaign is
 * deployed, so the real thing is seen in a real inbox and on a real phone
 * before it goes to everyone. To re-send the previews after a copy change:
 * DELETE FROM campaign_sends WHERE kind = 'preview'.
 */
async function sendPreviews(admin: SupabaseClient, schedule: ScheduleRow[], senders: CampaignSenders): Promise<number> {
    const { data: admins, error } = await admin.from('profiles').select('id').eq('role', 'admin');
    if (error) throw new Error(`admin lookup failed: ${error.message}`);
    const adminIds = (admins ?? []).map((row) => row.id as string);
    if (adminIds.length === 0) return 0;

    const { data: done, error: doneErr } = await admin
        .from('campaign_sends')
        .select('message_key, user_id')
        .eq('kind', 'preview');
    if (doneErr) throw new Error(`preview log lookup failed: ${doneErr.message}`);
    const previewed = new Set((done ?? []).map((row) => `${row.message_key}:${row.user_id}`));

    let sent = 0;
    for (const row of schedule) {
        const message = CAMPAIGN_MESSAGES[row.key];
        const pending = adminIds.filter((id) => !previewed.has(`${row.key}:${id}`));
        if (pending.length === 0) continue;

        const when = `${bangkokTime.format(new Date(row.send_at))} Bangkok time`;
        if (message.channel === 'email') {
            const notice = row.held
                ? `Preview. Held: goes to all users once released at go-live (${when}).`
                : `Preview. Goes to all users on ${when}.`;
            const recipients: { userId: string; email: string }[] = [];
            for (const id of pending) {
                const { data } = await admin.auth.admin.getUserById(id);
                const email = data?.user?.email?.trim();
                if (email) recipients.push({ userId: id, email });
            }
            if (recipients.length === 0) continue;
            sent += (await claimAndSend(admin, row.key, 'preview', recipients, (to) => sendEmailTo(senders, row.key, message, to, notice))).sent;
        } else {
            const { data: tokens } = await admin
                .from('notification_preferences')
                .select('user_id, fcm_token')
                .in('user_id', pending)
                .not('fcm_token', 'is', null);
            const recipients = (tokens ?? []).map((t) => ({ userId: t.user_id as string, fcmToken: t.fcm_token as string }));
            if (recipients.length === 0) continue;
            sent += (await claimAndSend(admin, row.key, 'preview', recipients, (to) => sendPushTo(senders, message, to, true))).sent;
        }
    }
    return sent;
}

// A message this far past its time is not sent: "48 hours to go" arriving a
// day late is worse than not arriving.
const OVERDUE_MS = 24 * 3600_000;
const CHUNK = 10;

export interface CampaignRunResult {
    skipped?: string;
    previews: number;
    sent: Record<string, number>;
    failed: Record<string, number>;
    completed: string[];
    overdue: string[];
}

/**
 * One pass: send any outstanding admin previews, then every message that is
 * due. Stops starting new chunks at `deadline`; whatever is left is picked up
 * by the next run, which skips everyone already in the send log.
 */
export async function runLaunchCampaign(
    admin: SupabaseClient,
    deadline: number,
    senders: CampaignSenders = { email: sendCampaignEmail, push: sendCampaignPush },
): Promise<CampaignRunResult> {
    const result: CampaignRunResult = { previews: 0, sent: {}, failed: {}, completed: [], overdue: [] };

    const { data, error } = await admin
        .from('campaign_messages')
        .select('key, send_at, held')
        .is('completed_at', null)
        .order('send_at', { ascending: true });
    if (error) {
        // Deployed ahead of migration 20260930_campaign_messages: nothing to do yet.
        if (/does not exist|schema cache|PGRST205|42P01/i.test(`${error.code ?? ''} ${error.message ?? ''}`)) {
            return { ...result, skipped: 'awaiting migration' };
        }
        throw new Error(`schedule lookup failed: ${error.message}`);
    }
    const schedule = ((data ?? []) as ScheduleRow[]).filter((row) => row.key in CAMPAIGN_MESSAGES);

    result.previews = await sendPreviews(admin, schedule, senders);

    const now = Date.now();
    for (const row of schedule) {
        const dueAt = new Date(row.send_at).getTime();
        if (row.held || dueAt > now) continue;
        if (now - dueAt > OVERDUE_MS) {
            // Parked rather than skipped, so this is reported once and not on
            // every run. It also ends the retries of a send that kept failing.
            await admin.from('campaign_messages').update({ held: true }).eq('key', row.key);
            console.error(`[Campaign] ${row.key} is more than 24h past its send time — held. Set a new send_at and held = false to send it.`);
            result.overdue.push(row.key);
            continue;
        }

        const message = CAMPAIGN_MESSAGES[row.key];
        const already = await fetchSentIds(admin, row.key);
        let sent = 0;
        let failed = 0;
        let finished = true;

        const deliver = async <T extends { userId: string }>(audience: T[], send: (to: T) => Promise<boolean>) => {
            const remaining = audience.filter((r) => !already.has(r.userId));
            for (let i = 0; i < remaining.length; i += CHUNK) {
                if (Date.now() > deadline) {
                    finished = false;
                    break;
                }
                const outcome = await claimAndSend(admin, row.key, 'send', remaining.slice(i, i + CHUNK), send);
                sent += outcome.sent;
                failed += outcome.failed;
            }
        };

        if (message.channel === 'email') {
            await deliver(await fetchEmailAudience(admin), (to) => sendEmailTo(senders, row.key, message, to));
        } else {
            await deliver(await fetchSellerPushAudience(admin), (to) => sendPushTo(senders, message, to));
        }

        result.sent[row.key] = sent;
        result.failed[row.key] = failed;
        if (finished && failed === 0) {
            await admin.from('campaign_messages').update({ completed_at: new Date().toISOString() }).eq('key', row.key);
            result.completed.push(row.key);
        }
        console.log(`[Campaign] ${row.key}: ${sent} sent, ${failed} failed${finished ? '' : ', out of time — continuing next run'}`);
    }

    return result;
}
