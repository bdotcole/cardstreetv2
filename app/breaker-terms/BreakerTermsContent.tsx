'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';

/**
 * Breaker Program Terms — the supplement the /become-a-breaker consent
 * checkbox links to. Mirrors app/terms/TermsContent.tsx in shape and tone:
 * co-located EN/TH blocks, labelled paragraphs, one render pass.
 *
 * EVERY operational claim here is sourced from the code that implements it,
 * not written fresh. If one of these changes, this page is wrong until updated:
 *   - fee ladder (9% / 5% -> 2%) ......... lib/partnerTiers.ts
 *   - direct charge, seller is MOR,
 *     seller bears the Stripe fee ....... app/api/live/spots/checkout/route.ts,
 *                                         lib/liveStreamPayments.ts
 *   - spot price carries NO shipping;
 *     one consolidated Flash parcel per
 *     buyer per stream, billed after .... app/api/live/streams/[id]/settle/route.ts,
 *                                         lib/liveSpotFulfillment.ts
 *   - seeded server-side randomizer,
 *     immutable break_randomizations
 *     audit, verifiable from the seed ... app/api/live/lots/[id]/randomize/route.ts
 *   - break formats offered ............. BREAK_ITEM_TYPES in lib/liveBreaks.ts
 *   - invite-only access grant .......... 'live_broadcast' in lib/betaFeatures.ts
 *
 * Deliberately absent: any promise of earnings, viewers, sales, stream volume,
 * or a review deadline. The program is early access to a marketplace feature,
 * not employment — section 3 says so explicitly.
 */

interface TermsBlock {
  label?: string;
  body: string;
}

interface TermsSection {
  heading: string;
  blocks: TermsBlock[];
}

interface BreakerTermsData {
  pageTitle: string;
  lastUpdated: string;
  intro: string;
  sections: TermsSection[];
  questionsLabel: string;
  questionsBody: string;
  backToApply: string;
}

const EN: BreakerTermsData = {
  pageTitle: 'Breaker Program Terms',
  lastUpdated: 'Last Updated: August 10, 2026',
  intro:
    'These terms apply to the Cardstreet Breaker Program and to hosting live breaks on Cardstreet Live. They are in addition to the Cardstreet Terms of Service and Privacy Policy, which continue to apply in full. Where these terms conflict with the general Terms of Service, these terms control for the Breaker Program only.',
  sections: [
    {
      heading: '1. Who Can Apply',
      blocks: [
        {
          label: 'Age and location:',
          body: 'You must be at least 18 years old and based in Thailand. Payouts and shipping are tied to Thai bank accounts and Flash Express, so we cannot onboard breakers outside Thailand at this time.',
        },
        {
          label: 'Account and payout setup:',
          body: 'Approved breakers need a Cardstreet account and must complete Stripe identity verification (Thai ID and bank account) before hosting. You sell as the merchant of record, so Stripe must verify you before money can move.',
        },
        {
          label: 'Accurate information:',
          body: 'You confirm that the information in your application is accurate. Misrepresenting your experience, identity, inventory, or business is grounds for rejection or removal from the program.',
        },
      ],
    },
    {
      heading: '2. Applying Is Not Approval',
      blocks: [
        {
          label: 'No guarantee:',
          body: 'Submitting an application does not create any agreement to onboard you, and does not guarantee approval. We may decline any application, for any lawful reason, without explanation.',
        },
        {
          label: 'Review and test stream:',
          body: 'We may review your application, your public content, and your Cardstreet account history. Selected applicants complete a test stream before hosting publicly. We do not commit to a review timeline.',
        },
        {
          label: 'No compensation for applying:',
          body: 'Applying, being reviewed, and completing a test stream are unpaid. You are not owed any fee, reimbursement, or compensation for time spent on the application process.',
        },
      ],
    },
    {
      heading: '3. Independent Seller, Not an Employee',
      blocks: [
        {
          label: 'Your status:',
          body: 'Breakers are independent sellers using the Cardstreet platform. Nothing in these terms creates an employment, agency, partnership, franchise, or joint venture relationship. You control your own schedule, pricing, inventory, and presentation.',
        },
        {
          label: 'No guaranteed earnings:',
          body: 'Cardstreet does not promise any level of sales, viewers, audience growth, or income. What you earn depends on your own pricing, inventory, and audience.',
        },
        {
          label: 'Your own costs and taxes:',
          body: 'You are responsible for your own equipment, internet, inventory, and for any taxes arising from your sales.',
        },
      ],
    },
    {
      heading: '4. Early Access and Changes',
      blocks: [
        {
          label: 'Cardstreet Live is in active development:',
          body: 'Broadcasting access is granted per account and may be limited, paused, or withdrawn. Features, break formats, and fees may change as the product develops.',
        },
        {
          label: 'No uptime guarantee:',
          body: 'We do not guarantee that streaming, chat, checkout, or any other part of the platform will be available or uninterrupted. We are not liable for sales lost to an outage, a failed stream, or a scheduling change.',
        },
      ],
    },
    {
      heading: '5. Running a Break',
      blocks: [
        {
          label: 'Authentic, accurately described product:',
          body: 'Only genuine product may be broken or sold. Counterfeit, proxy, reproduction, resealed, or tampered product is strictly prohibited, as it is everywhere on Cardstreet. Describe what you are breaking accurately, including the set, the product type, and the number of packs per spot.',
        },
        {
          label: 'Honor the advertised format:',
          body: 'Cardstreet Live supports specific break formats (for example personal breaks, pick your pack, random pack, chase breaks, and pack wars). Run the format you advertised, on the product you advertised, at the spot count and price you advertised. Do not change the terms of a break after spots have sold.',
        },
        {
          label: 'Show the break on camera:',
          body: 'Opening, sorting, and assigning cards must happen on stream, on camera, so buyers can see what they received. Do not open advertised product off stream.',
        },
        {
          label: 'Handle cards and orders carefully:',
          body: 'Sleeve and protect hits promptly, keep each buyer’s cards separated, and keep accurate records of what belongs to whom.',
        },
      ],
    },
    {
      heading: '6. Randomization and Fairness',
      blocks: [
        {
          label: 'Use the platform randomizer:',
          body: 'Where a format assigns packs or hits at random, you must use Cardstreet’s built-in randomizer. It draws entropy server-side and derives the assignment from a recorded seed, so the result is fixed before the reveal and cannot be re-rolled by a later purchase.',
        },
        {
          label: 'The result is on the record:',
          body: 'Each randomization is written to an immutable audit log with its seed and full assignment map. Anyone can reproduce the shuffle from the published seed and confirm the outcome.',
        },
        {
          label: 'Do not work around it:',
          body: 'Manipulating, re-running, substituting, or circumventing the randomizer, or presenting a different result on stream from the one recorded, is a serious breach. It is grounds for immediate removal from the program and may result in withheld funds pending investigation.',
        },
      ],
    },
    {
      heading: '7. Spots, Fees, and Payment',
      blocks: [
        {
          label: 'Buyers pay per spot:',
          body: 'Spots are sold through Cardstreet checkout during the stream. Payment is taken on the platform. Do not solicit or accept payment for a break outside Cardstreet.',
        },
        {
          label: 'Cardstreet fee:',
          body: 'The same fee ladder as the rest of the marketplace applies: 9% of the item price for standard sellers, 5% for Cardstreet Pro subscribers and Partner sellers, descending to 2% at the top partner tiers.',
        },
        {
          label: 'Payment processing:',
          body: 'You sell as the merchant of record, so funds settle into your connected Stripe account and Stripe’s processing fee is deducted from your balance. That fee goes to Stripe, not to Cardstreet.',
        },
        {
          label: 'Spot prices exclude shipping:',
          body: 'Spot prices carry no shipping charge. Shipping is billed to the buyer separately after the stream (see section 8), so do not advertise a spot as including shipping.',
        },
        {
          label: 'Cancelled or unsold spots:',
          body: 'Unsold spots remain yours, and any packs assigned to them stay on the record. If a break cannot run as advertised, spots must be refunded.',
        },
      ],
    },
    {
      heading: '8. Shipping After the Stream',
      blocks: [
        {
          label: 'One parcel per buyer:',
          body: 'When a stream is settled, each buyer’s cards from that stream are grouped into a single Flash Express parcel and a single shipping fee, quoted on the combined weight and paid by the buyer afterward. Do not ship spot orders individually as they sell.',
        },
        {
          label: 'Ship promptly and safely:',
          body: 'Pack cards so they survive transit, and ship once the buyer has paid the shipping fee for that stream. Repeated late or unshipped parcels are grounds for removal from the program.',
        },
      ],
    },
    {
      heading: '9. Conduct on Stream',
      blocks: [
        {
          label: 'Treat viewers well:',
          body: 'No harassment, hate speech, threats, sexual content, or illegal activity on stream or in chat. You are responsible for moderating your own chat.',
        },
        {
          label: 'Represent Cardstreet honestly:',
          body: 'Do not claim to speak for Cardstreet, promise outcomes on our behalf, or present yourself as our employee or agent.',
        },
        {
          label: 'Comply with the law:',
          body: 'You are responsible for ensuring your streams and the formats you run comply with all laws that apply to you. Cardstreet may restrict or withdraw any break format at any time.',
        },
      ],
    },
    {
      heading: '10. Recordings and Content',
      blocks: [
        {
          label: 'Streams may be recorded:',
          body: 'Cardstreet may record, store, and replay your streams, including for dispute resolution and platform safety.',
        },
        {
          label: 'License to Cardstreet:',
          body: 'You grant Cardstreet a non-exclusive, royalty-free licence to host, reproduce, and display your stream content and your shop name, avatar, and stream titles for the purpose of operating and promoting Cardstreet Live. You keep ownership of your content.',
        },
        {
          label: 'Rights in what you show:',
          body: 'You confirm you have the rights to everything you broadcast, including any music you play. Do not stream content you are not permitted to use.',
        },
      ],
    },
    {
      heading: '11. Suspension and Removal',
      blocks: [
        {
          label: 'We may suspend access:',
          body: 'Cardstreet may suspend or withdraw broadcasting access at any time, including immediately and without notice where we believe buyer funds, break integrity, or user safety are at risk.',
        },
        {
          label: 'You may stop at any time:',
          body: 'You can leave the program at any time. Obligations you already owe buyers survive: any break you have already sold spots in must be completed, settled, and shipped, or refunded.',
        },
      ],
    },
    {
      heading: '12. Changes to These Terms',
      blocks: [
        {
          body: 'We may update these terms as Cardstreet Live develops. The date at the top of this page shows the current version. Continuing to host after an update means you accept the revised terms.',
        },
      ],
    },
  ],
  questionsLabel: 'Questions',
  questionsBody:
    'For questions about the Breaker Program or these terms, email support@thailandtcg.com.',
  backToApply: 'Back to the breaker application',
};

const TH: BreakerTermsData = {
  pageTitle: 'ข้อกำหนดโปรแกรม Breaker',
  lastUpdated: 'อัปเดตล่าสุด: 10 สิงหาคม 2026',
  intro:
    'ข้อกำหนดนี้ใช้กับโปรแกรม Cardstreet Breaker และการจัดไลฟ์ break บน Cardstreet Live โดยเป็นส่วนเพิ่มเติมจากข้อกำหนดการให้บริการและนโยบายความเป็นส่วนตัวของ Cardstreet ซึ่งยังคงมีผลบังคับใช้เต็มรูปแบบ หากข้อกำหนดนี้ขัดกับข้อกำหนดการให้บริการทั่วไป ให้ยึดข้อกำหนดนี้เฉพาะในส่วนของโปรแกรม Breaker',
  sections: [
    {
      heading: '1. ใครสมัครได้',
      blocks: [
        {
          label: 'อายุและถิ่นที่อยู่:',
          body: 'คุณต้องมีอายุอย่างน้อย 18 ปีและอยู่ในประเทศไทย เนื่องจากระบบรับเงินและการจัดส่งผูกกับบัญชีธนาคารไทยและ Flash Express เราจึงยังรับ breaker นอกประเทศไทยไม่ได้ในขณะนี้',
        },
        {
          label: 'บัญชีและการตั้งค่ารับเงิน:',
          body: 'breaker ที่ผ่านการอนุมัติต้องมีบัญชี Cardstreet และต้องยืนยันตัวตนกับ Stripe (บัตรประชาชนไทยและบัญชีธนาคาร) ให้เสร็จก่อนจัดไลฟ์ เนื่องจากคุณขายในฐานะผู้ขายโดยตรง Stripe จึงต้องยืนยันตัวตนคุณก่อนจึงจะโอนเงินได้',
        },
        {
          label: 'ข้อมูลที่ถูกต้อง:',
          body: 'คุณยืนยันว่าข้อมูลในใบสมัครเป็นความจริง การให้ข้อมูลเท็จเกี่ยวกับประสบการณ์ ตัวตน สินค้าในมือ หรือธุรกิจของคุณ เป็นเหตุให้ถูกปฏิเสธหรือถูกถอดออกจากโปรแกรมได้',
        },
      ],
    },
    {
      heading: '2. การสมัครไม่ใช่การอนุมัติ',
      blocks: [
        {
          label: 'ไม่มีการรับประกัน:',
          body: 'การส่งใบสมัครไม่ก่อให้เกิดข้อตกลงใด ๆ ว่าเราจะรับคุณเข้าโปรแกรม และไม่ได้รับประกันว่าจะได้รับการอนุมัติ เราอาจปฏิเสธใบสมัครใดก็ได้ด้วยเหตุผลอันชอบด้วยกฎหมาย โดยไม่ต้องชี้แจง',
        },
        {
          label: 'การพิจารณาและการทดลองไลฟ์:',
          body: 'เราอาจตรวจสอบใบสมัคร ผลงานสาธารณะ และประวัติบัญชี Cardstreet ของคุณ ผู้สมัครที่ผ่านการคัดเลือกจะต้องทดลองไลฟ์ก่อนจัดไลฟ์สาธารณะ ทั้งนี้เราไม่ได้กำหนดระยะเวลาพิจารณาที่แน่นอน',
        },
        {
          label: 'ไม่มีค่าตอบแทนสำหรับการสมัคร:',
          body: 'การสมัคร การเข้ารับการพิจารณา และการทดลองไลฟ์ ไม่มีค่าตอบแทน คุณไม่มีสิทธิ์เรียกค่าธรรมเนียม ค่าชดเชย หรือค่าเสียเวลาใด ๆ จากขั้นตอนการสมัคร',
        },
      ],
    },
    {
      heading: '3. เป็นผู้ขายอิสระ ไม่ใช่พนักงาน',
      blocks: [
        {
          label: 'สถานะของคุณ:',
          body: 'breaker คือผู้ขายอิสระที่ใช้แพลตฟอร์ม Cardstreet ข้อกำหนดนี้ไม่ก่อให้เกิดความสัมพันธ์ในฐานะการจ้างงาน ตัวแทน หุ้นส่วน แฟรนไชส์ หรือกิจการร่วมค้า คุณเป็นผู้กำหนดตารางเวลา ราคา สินค้า และรูปแบบการนำเสนอของคุณเอง',
        },
        {
          label: 'ไม่รับประกันรายได้:',
          body: 'Cardstreet ไม่ได้รับประกันยอดขาย จำนวนผู้ชม การเติบโตของผู้ติดตาม หรือรายได้ใด ๆ รายได้ของคุณขึ้นอยู่กับราคา สินค้า และผู้ชมของคุณเอง',
        },
        {
          label: 'ค่าใช้จ่ายและภาษีของคุณเอง:',
          body: 'คุณรับผิดชอบอุปกรณ์ อินเทอร์เน็ต สินค้าของคุณเอง และภาษีที่เกิดจากการขายของคุณ',
        },
      ],
    },
    {
      heading: '4. การเข้าใช้ช่วงแรกและการเปลี่ยนแปลง',
      blocks: [
        {
          label: 'Cardstreet Live ยังอยู่ระหว่างการพัฒนา:',
          body: 'สิทธิ์การจัดไลฟ์ให้เป็นรายบัญชี และอาจถูกจำกัด ระงับ หรือยกเลิกได้ ฟีเจอร์ รูปแบบ break และค่าธรรมเนียม อาจเปลี่ยนแปลงไปตามการพัฒนาของระบบ',
        },
        {
          label: 'ไม่รับประกันความพร้อมใช้งาน:',
          body: 'เราไม่รับประกันว่าระบบไลฟ์ แชท การชำระเงิน หรือส่วนอื่นของแพลตฟอร์มจะพร้อมใช้งานหรือไม่ขัดข้อง เราไม่รับผิดต่อยอดขายที่เสียไปจากระบบขัดข้อง ไลฟ์ล้มเหลว หรือการเปลี่ยนตารางเวลา',
        },
      ],
    },
    {
      heading: '5. การจัด break',
      blocks: [
        {
          label: 'สินค้าของแท้และอธิบายตรงตามจริง:',
          body: 'ต้องใช้สินค้าของแท้เท่านั้นในการเปิดหรือขาย ห้ามสินค้าปลอม พร็อกซี ของทำซ้ำ ของที่ถูกซีลใหม่ หรือถูกดัดแปลงโดยเด็ดขาด เช่นเดียวกับทุกส่วนของ Cardstreet และต้องอธิบายสิ่งที่คุณกำลังเปิดตามจริง ทั้งชุดการ์ด ประเภทสินค้า และจำนวนซองต่อช่อง',
        },
        {
          label: 'ทำตามรูปแบบที่ประกาศไว้:',
          body: 'Cardstreet Live รองรับรูปแบบ break เฉพาะบางรูปแบบ (เช่น personal break, pick your pack, random pack, chase break และ pack wars) คุณต้องจัดตามรูปแบบ สินค้า จำนวนช่อง และราคาที่ประกาศไว้ ห้ามเปลี่ยนเงื่อนไขของ break หลังจากมีการขายช่องไปแล้ว',
        },
        {
          label: 'เปิดให้เห็นหน้ากล้อง:',
          body: 'การเปิดซอง การคัดแยก และการจ่ายการ์ด ต้องทำระหว่างไลฟ์และให้เห็นหน้ากล้อง เพื่อให้ผู้ซื้อเห็นว่าตนได้รับอะไร ห้ามเปิดสินค้าที่ประกาศไว้นอกไลฟ์',
        },
        {
          label: 'ดูแลการ์ดและคำสั่งซื้ออย่างระมัดระวัง:',
          body: 'ใส่ซองป้องกันการ์ดใบสำคัญทันที แยกการ์ดของผู้ซื้อแต่ละรายให้ชัดเจน และบันทึกให้ถูกต้องว่าการ์ดใบใดเป็นของใคร',
        },
      ],
    },
    {
      heading: '6. การสุ่มและความเป็นธรรม',
      blocks: [
        {
          label: 'ต้องใช้ระบบสุ่มของแพลตฟอร์ม:',
          body: 'ในรูปแบบที่ต้องสุ่มจ่ายซองหรือการ์ดใบสำคัญ คุณต้องใช้ระบบสุ่มในตัวของ Cardstreet ระบบจะสุ่มค่าจากฝั่งเซิร์ฟเวอร์และคำนวณผลจาก seed ที่บันทึกไว้ ผลจึงถูกกำหนดไว้ก่อนการเปิดเผย และไม่สามารถสุ่มใหม่ได้จากการซื้อที่เกิดขึ้นภายหลัง',
        },
        {
          label: 'ผลการสุ่มถูกบันทึกไว้:',
          body: 'การสุ่มแต่ละครั้งถูกบันทึกลงในระบบตรวจสอบที่แก้ไขไม่ได้ พร้อม seed และตารางการจ่ายทั้งหมด ใครก็สามารถนำ seed ที่เผยแพร่ไปคำนวณซ้ำเพื่อยืนยันผลได้',
        },
        {
          label: 'ห้ามหลีกเลี่ยงระบบ:',
          body: 'การแทรกแซง สุ่มใหม่ สลับผล หรือหลบเลี่ยงระบบสุ่ม รวมถึงการแสดงผลบนไลฟ์ที่ต่างจากผลที่ถูกบันทึกไว้ ถือเป็นการละเมิดร้ายแรง เป็นเหตุให้ถูกถอดออกจากโปรแกรมทันที และอาจถูกระงับการจ่ายเงินระหว่างการตรวจสอบ',
        },
      ],
    },
    {
      heading: '7. ช่อง ค่าธรรมเนียม และการชำระเงิน',
      blocks: [
        {
          label: 'ผู้ซื้อจ่ายเป็นรายช่อง:',
          body: 'ช่องจะถูกขายผ่านระบบชำระเงินของ Cardstreet ระหว่างไลฟ์ และรับชำระผ่านแพลตฟอร์มเท่านั้น ห้ามชักชวนหรือรับชำระเงินค่า break นอกระบบ Cardstreet',
        },
        {
          label: 'ค่าธรรมเนียม Cardstreet:',
          body: 'ใช้อัตราเดียวกับส่วนอื่นของมาร์เก็ตเพลส คือ 9% ของราคาสินค้าสำหรับผู้ขายทั่วไป 5% สำหรับสมาชิก Cardstreet Pro และผู้ขายระดับพาร์ทเนอร์ และลดลงถึง 2% ในระดับพาร์ทเนอร์สูงสุด',
        },
        {
          label: 'ค่าธรรมเนียมการชำระเงิน:',
          body: 'คุณขายในฐานะผู้ขายโดยตรง เงินจึงเข้าบัญชี Stripe ที่คุณเชื่อมไว้ และค่าธรรมเนียมการชำระเงินของ Stripe จะถูกหักจากยอดของคุณ ค่าธรรมเนียมส่วนนี้เป็นของ Stripe ไม่ใช่ของ Cardstreet',
        },
        {
          label: 'ราคาช่องไม่รวมค่าจัดส่ง:',
          body: 'ราคาช่องไม่มีค่าจัดส่งรวมอยู่ ค่าจัดส่งจะเรียกเก็บจากผู้ซื้อแยกต่างหากหลังจบไลฟ์ (ดูข้อ 8) จึงห้ามโฆษณาว่าราคาช่องรวมค่าส่งแล้ว',
        },
        {
          label: 'ช่องที่ยกเลิกหรือขายไม่หมด:',
          body: 'ช่องที่ขายไม่ออกยังเป็นของคุณ และซองที่ถูกจ่ายให้ช่องนั้นจะยังคงอยู่ในบันทึก หาก break ไม่สามารถจัดได้ตามที่ประกาศไว้ ต้องคืนเงินค่าช่องทั้งหมด',
        },
      ],
    },
    {
      heading: '8. การจัดส่งหลังจบไลฟ์',
      blocks: [
        {
          label: 'หนึ่งพัสดุต่อผู้ซื้อหนึ่งราย:',
          body: 'เมื่อปิดยอดไลฟ์แล้ว การ์ดของผู้ซื้อแต่ละรายจากไลฟ์นั้นจะถูกรวมเป็นพัสดุ Flash Express ชิ้นเดียวและค่าจัดส่งครั้งเดียว โดยคำนวณจากน้ำหนักรวมและให้ผู้ซื้อชำระภายหลัง ห้ามแยกส่งทีละคำสั่งซื้อระหว่างไลฟ์',
        },
        {
          label: 'ส่งให้ไวและปลอดภัย:',
          body: 'แพ็กการ์ดให้ปลอดภัยระหว่างขนส่ง และจัดส่งเมื่อผู้ซื้อชำระค่าจัดส่งของไลฟ์นั้นแล้ว การส่งล่าช้าหรือไม่ส่งซ้ำ ๆ เป็นเหตุให้ถูกถอดออกจากโปรแกรม',
        },
      ],
    },
    {
      heading: '9. การประพฤติตนระหว่างไลฟ์',
      blocks: [
        {
          label: 'ปฏิบัติต่อผู้ชมอย่างเหมาะสม:',
          body: 'ห้ามคุกคาม ใช้ถ้อยคำสร้างความเกลียดชัง ข่มขู่ เนื้อหาทางเพศ หรือกิจกรรมที่ผิดกฎหมาย ทั้งบนไลฟ์และในแชท คุณมีหน้าที่ดูแลแชทของคุณเอง',
        },
        {
          label: 'นำเสนอ Cardstreet ตามความจริง:',
          body: 'ห้ามอ้างว่าพูดในนาม Cardstreet ให้คำมั่นแทนเรา หรือแสดงตนว่าเป็นพนักงานหรือตัวแทนของเรา',
        },
        {
          label: 'ปฏิบัติตามกฎหมาย:',
          body: 'คุณมีหน้าที่ตรวจสอบให้แน่ใจว่าไลฟ์และรูปแบบ break ที่คุณจัด เป็นไปตามกฎหมายที่ใช้บังคับกับคุณ ทั้งนี้ Cardstreet อาจจำกัดหรือยกเลิกรูปแบบ break ใดก็ได้ทุกเมื่อ',
        },
      ],
    },
    {
      heading: '10. การบันทึกและเนื้อหา',
      blocks: [
        {
          label: 'ไลฟ์อาจถูกบันทึก:',
          body: 'Cardstreet อาจบันทึก จัดเก็บ และเปิดซ้ำไลฟ์ของคุณ รวมถึงเพื่อใช้ระงับข้อพิพาทและดูแลความปลอดภัยของแพลตฟอร์ม',
        },
        {
          label: 'สิทธิ์ที่ให้แก่ Cardstreet:',
          body: 'คุณให้สิทธิ์แก่ Cardstreet แบบไม่ผูกขาดและไม่มีค่าตอบแทน ในการจัดเก็บ ทำซ้ำ และแสดงเนื้อหาไลฟ์ ชื่อร้าน รูปโปรไฟล์ และชื่อไลฟ์ของคุณ เพื่อการดำเนินงานและประชาสัมพันธ์ Cardstreet Live โดยคุณยังคงเป็นเจ้าของเนื้อหาของคุณ',
        },
        {
          label: 'สิทธิ์ในสิ่งที่คุณนำเสนอ:',
          body: 'คุณยืนยันว่าคุณมีสิทธิ์ในทุกสิ่งที่คุณถ่ายทอด รวมถึงเพลงที่คุณเปิด ห้ามถ่ายทอดเนื้อหาที่คุณไม่มีสิทธิ์ใช้',
        },
      ],
    },
    {
      heading: '11. การระงับสิทธิ์และการถอดออกจากโปรแกรม',
      blocks: [
        {
          label: 'เราอาจระงับสิทธิ์:',
          body: 'Cardstreet อาจระงับหรือยกเลิกสิทธิ์การจัดไลฟ์เมื่อใดก็ได้ รวมถึงโดยทันทีและไม่ต้องแจ้งล่วงหน้า หากเราเห็นว่าเงินของผู้ซื้อ ความน่าเชื่อถือของ break หรือความปลอดภัยของผู้ใช้กำลังมีความเสี่ยง',
        },
        {
          label: 'คุณออกจากโปรแกรมได้ทุกเมื่อ:',
          body: 'คุณออกจากโปรแกรมเมื่อใดก็ได้ แต่ภาระที่คุณมีต่อผู้ซื้ออยู่แล้วยังคงอยู่ break ที่ขายช่องไปแล้วต้องจัดให้เสร็จ ปิดยอด และจัดส่ง หรือคืนเงิน',
        },
      ],
    },
    {
      heading: '12. การเปลี่ยนแปลงข้อกำหนด',
      blocks: [
        {
          body: 'เราอาจปรับปรุงข้อกำหนดนี้ตามการพัฒนาของ Cardstreet Live โดยวันที่ด้านบนของหน้านี้แสดงเวอร์ชันปัจจุบัน การจัดไลฟ์ต่อหลังจากมีการปรับปรุง ถือว่าคุณยอมรับข้อกำหนดฉบับแก้ไข',
        },
      ],
    },
  ],
  questionsLabel: 'คำถาม',
  questionsBody:
    'หากมีคำถามเกี่ยวกับโปรแกรม Breaker หรือข้อกำหนดนี้ กรุณาอีเมลถึง support@thailandtcg.com',
  backToApply: 'กลับไปที่ใบสมัคร Breaker',
};

export default function BreakerTermsContent({ prefix }: { prefix: '' | '/en' }) {
  const { isThai } = useTranslation();
  const content = isThai ? TH : EN;

  return (
    <div className="min-h-screen bg-brand-darker text-white p-6 pb-24 overflow-y-auto">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="flex items-center gap-4 mb-10">
          <Link
            href={`${prefix}/become-a-breaker`}
            aria-label={content.backToApply}
            className="w-10 h-10 shrink-0 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
          >
            <i className="fa-solid fa-chevron-left text-slate-400 text-xs" aria-hidden="true"></i>
          </Link>
          <h1 className="text-2xl font-black uppercase tracking-tight italic skew-x-[-10deg]">
            {content.pageTitle}
          </h1>
        </div>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          <p className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">
            {content.lastUpdated}
          </p>

          <p>{content.intro}</p>

          <p className="text-slate-400">
            <Link
              href={`${prefix}/terms`}
              className="text-brand-cyan [.theme-light_&]:text-cyan-800 underline underline-offset-2 hover:text-cyan-300"
            >
              {isThai ? 'ข้อกำหนดการให้บริการ' : 'Terms of Service'}
            </Link>
            {isThai ? ' · ' : ' · '}
            <Link
              href={`${prefix}/privacy`}
              className="text-brand-cyan [.theme-light_&]:text-cyan-800 underline underline-offset-2 hover:text-cyan-300"
            >
              {isThai ? 'นโยบายความเป็นส่วนตัว' : 'Privacy Policy'}
            </Link>
          </p>

          {content.sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-lg font-black uppercase tracking-wider text-brand-cyan [.theme-light_&]:text-cyan-800">
                {section.heading}
              </h2>
              {section.blocks.length === 1 && !section.blocks[0].label ? (
                <p>{section.blocks[0].body}</p>
              ) : (
                <div className="space-y-4">
                  {section.blocks.map((block) => (
                    <div key={block.label ?? block.body}>
                      {block.label && <strong className="text-white block mb-1">{block.label}</strong>}
                      <p>{block.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}

          <section className="space-y-3 pt-2 border-t border-white/5">
            <h2 className="text-lg font-black uppercase tracking-wider text-brand-cyan [.theme-light_&]:text-cyan-800">
              {content.questionsLabel}
            </h2>
            <p>{content.questionsBody}</p>
            <p>
              <Link
                href={`${prefix}/become-a-breaker`}
                className="text-brand-cyan [.theme-light_&]:text-cyan-800 underline underline-offset-2 hover:text-cyan-300"
              >
                {content.backToApply}
              </Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
