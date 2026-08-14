// The "how to check a graded price" steps, shared by the rendered page
// (GradedContent) and the HowTo JSON-LD (page.tsx) so the two cannot drift.
//
// This lives in its own module rather than being exported from GradedContent
// because that file is 'use client': Next replaces a client module's exports
// with client references when a server component imports them, so the value
// arrives `undefined` on the server. A plain module crosses the boundary fine.
//
// SCOPE: these steps describe CHECKING a graded price. CardStreet has no
// grading submission service, and a HowTo that reads as "how to submit" would
// imply one to any answer engine quoting it. Keep the framing.

export interface HowToStep {
    t: string;
    d: string;
}

export const GRADED_HOWTO: Record<'th' | 'en', { title: string; steps: HowToStep[] }> = {
    th: {
        title: 'วิธีเช็คราคาการ์ดเกรด',
        steps: [
            {
                t: 'หาการ์ดใบที่ต้องการ',
                d: 'ค้นหาด้วยชื่อการ์ดหรือเลขการ์ด หรือสแกนด้วยกล้องก็ได้ ใช้ได้ทั้งการ์ดไทย อังกฤษ และญี่ปุ่น',
            },
            {
                t: 'เปิดหน้าการ์ดแล้วเลื่อนไปที่ส่วนราคาการ์ดเกรด',
                d: 'ราคาการ์ดเกรดอยู่แยกเป็นส่วนของตัวเอง ไม่ปนกับราคาการ์ดดิบที่อยู่ด้านบนของหน้า',
            },
            {
                t: 'เทียบราคาเกรดที่สนใจกับราคาการ์ดดิบ',
                d: 'ส่วนต่างระหว่างสองราคานี้คือเหตุผลทั้งหมดของการส่งเกรด และเป็นตัวเลขที่ควรใช้ตัดสินใจ',
            },
            {
                t: 'ระดับที่เว้นว่างคือยังไม่มีข้อมูล ไม่ใช่ราคาศูนย์',
                d: 'ระดับเกรดที่เราไม่มีราคาจริงจะถูกเว้นว่างไว้ตั้งใจ เพราะเราเลือกที่จะไม่แสดงอะไรเลยดีกว่าแสดงตัวเลขที่เดาเอา',
            },
        ],
    },
    en: {
        title: 'How to check a graded card price',
        steps: [
            {
                t: 'Find the card',
                d: 'Search by name or collector number, or scan the card with your camera. Thai, English and Japanese printings all work.',
            },
            {
                t: 'Open the card page and scroll to graded prices',
                d: 'Graded prices sit in their own section, separate from the raw price at the top of the page.',
            },
            {
                t: 'Compare the grade you care about against the raw price',
                d: 'The gap between the two is the whole reason to grade a card, and it is the number to base any decision on.',
            },
            {
                t: 'Read a blank tier as "no data", not as zero',
                d: 'A tier we hold no real price for is left empty on purpose. We would rather show nothing than a guessed number.',
            },
        ],
    },
};
