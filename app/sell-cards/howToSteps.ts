// The "how to start selling" steps, shared by the rendered page
// (SellCardsContent) and the HowTo JSON-LD (page.tsx) so the two cannot drift.
//
// This lives in its own module rather than being exported from
// SellCardsContent because that file is 'use client': Next replaces a client
// module's exports with client references when a server component imports
// them, so the value arrives `undefined` on the server. A plain module crosses
// the boundary fine.
//
// CLAIMS: step 3's "Near Mint" reference is sourced — pickDisplayMarketValue in
// lib/cardMapper.ts ranks Raw_NM then Near Mint and excludes graded rows, so the
// displayed market price IS a Near-Mint raw reference. Step 4 must never imply
// the seller is paid after delivery; on the live TH direct-charge path funds
// reach the seller at charge time. See SellCardsContent's header.

export interface HowToStep {
    t: string;
    d: string;
}

export const SELL_HOWTO: Record<'th' | 'en', { title: string; steps: HowToStep[] }> = {
    th: {
        title: 'เริ่มขายยังไง',
        steps: [
            {
                t: 'สมัครบัญชีและยืนยันตัวตน',
                d: 'CardStreet จ่ายเงินผ่าน Stripe จึงต้องยืนยันตัวตนกับ Stripe ก่อน ใช้บัตรประชาชนและบัญชีธนาคารไทย ขั้นตอนนี้ทำครั้งเดียว ใช้เวลาไม่กี่นาที และต้องทำให้เสร็จก่อนจึงจะรับเงินได้',
            },
            {
                t: 'ลงขายการ์ด',
                d: 'ค้นหาการ์ดที่จะขายหรือสแกนด้วยกล้อง เลือกสภาพการ์ด ใส่รูปถ่ายจริง แล้วตั้งราคาโดยดูราคาตลาดที่ระบบแสดงไว้เป็นตัวอ้างอิง',
            },
            {
                t: 'ตั้งราคาโดยดูราคาตลาดเป็นหลัก',
                d: 'ราคาตลาดที่ระบบแสดงข้างช่องราคาคือราคาอ้างอิงของการ์ดใบนั้นในสภาพ Near Mint ถ้าการ์ดของคุณสภาพรองลงมา ราคาที่ขายได้จริงมักต่ำกว่านั้น และถ้าการ์ดใบเดียวกันมีคนลงขายอยู่หลายใบ ราคาของคุณคือสิ่งแรกที่ผู้ซื้อเปรียบเทียบ',
            },
            {
                t: 'แพ็คและส่ง',
                d: 'เมื่อขายได้ ระบบออกใบปะหน้า Flash Express ให้ แพ็คการ์ดใส่ซองกันกระแทก แล้วจ่ายค่าส่งให้ Flash ตอนเข้ารับพัสดุ ซึ่งเป็นเงินค่าจัดส่งที่ผู้ซื้อจ่ายมาแล้ว หากใช้กล่องขนาดใหญ่เกิน ค่าส่งส่วนต่างเป็นของผู้ขาย',
            },
            {
                t: 'ตอบผู้ซื้อและติดตามพัสดุ',
                d: 'หลังกดส่ง ระบบจะติดตามสถานะพัสดุจาก Flash Express ให้อัตโนมัติ ทั้งคุณและผู้ซื้อเห็นสถานะเดียวกัน ตอบคำถามก่อนขายให้ไว เพราะผู้ซื้อส่วนใหญ่ถามเรื่องสภาพการ์ดและรูปถ่ายจริงก่อนตัดสินใจ',
            },
        ],
    },
    en: {
        title: 'How to start',
        steps: [
            {
                t: 'Create an account and verify your identity',
                d: 'CardStreet pays out through Stripe, so Stripe needs to verify you — a Thai ID and bank account. It is a one-time step that takes a few minutes, and it has to be finished before you can be paid.',
            },
            {
                t: 'List a card',
                d: 'Search for the card or scan it with your camera, pick its condition, add your own photos, and set a price using the market price shown as a reference.',
            },
            {
                t: 'Price it against the market price',
                d: 'The market price shown next to the price field is the reference for that card in Near Mint condition. If yours is in a lower grade, it will usually sell for less than that. And if several copies of the same card are listed, your price is the first thing a buyer compares.',
            },
            {
                t: 'Pack and ship',
                d: 'When it sells you get a Flash Express label. Pack the card in a small padded mailer and pay Flash when they collect it — covered by the shipping the buyer already paid you. Oversized boxes cost more, and the extra is on you.',
            },
            {
                t: 'Answer buyers and track the parcel',
                d: 'Once you ship, the Flash Express tracking updates automatically and you and the buyer see the same status. Reply quickly to pre-sale questions — most buyers ask about condition and want to see your own photos before they commit.',
            },
        ],
    },
};
