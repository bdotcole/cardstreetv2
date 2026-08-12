'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';

interface TermsBlock {
  label?: string;
  body: string;
}

interface TermsSection {
  heading: string;
  blocks: TermsBlock[];
}

interface TermsContentData {
  pageTitle: string;
  lastUpdated: string;
  sections: TermsSection[];
}

const EN: TermsContentData = {
  pageTitle: 'Terms of Service',
  lastUpdated: 'Last Updated: March 21, 2026',
  sections: [
    {
      heading: '1. Acceptance of Terms',
      blocks: [
        {
          body: 'By accessing or using the Cardstreet mobile application and website (the "Service"), operated by Cardstreet (Commercial Registration No. 1329900962791) ("Company," "we," "us," or "our"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.',
        },
      ],
    },
    {
      heading: '2. Eligibility and Registration',
      blocks: [
        {
          label: 'Age:',
          body: 'You must be at least 18 years old to sell or purchase items on the marketplace. Users under 18 may only use the Service under the supervision of a parent or legal guardian.',
        },
        {
          label: 'Accounts:',
          body: 'You are responsible for maintaining the confidentiality of your account credentials. You agree to provide accurate and complete information during registration.',
        },
      ],
    },
    {
      heading: '3. Marketplace Rules & Prohibited Items',
      blocks: [
        {
          label: 'Scope:',
          body: 'Cardstreet is a marketplace for Trading Card Games (TCG), including but not limited to Pokémon, Magic: The Gathering, and Yu-Gi-Oh!.',
        },
        {
          label: 'Counterfeit Policy:',
          body: 'The sale of "proxy," "reproduction," "fake," or "counterfeit" cards is strictly prohibited. Any user found listing such items will face immediate account suspension and potential forfeiture of pending funds.',
        },
        {
          label: 'Condition Accuracy:',
          body: 'Sellers must accurately describe the condition of cards (e.g., Near Mint, Lightly Played).',
        },
      ],
    },
    {
      heading: '4. Fees and Payments',
      blocks: [
        {
          label: 'Transaction Fees:',
          body: 'Cardstreet charges a 9.0% transaction fee on all successful sales (reduced for Partner tier sellers starting at 5%). This fee is deducted automatically from the sale price before payout.',
        },
        {
          label: 'Payment Processing:',
          body: 'We use Stripe to process payments. By using the Service, you also agree to the terms and conditions of this third-party processor.',
        },
        {
          label: 'Taxes:',
          body: 'Users are responsible for any applicable taxes (including sales tax or import duties) arising from their transactions.',
        },
      ],
    },
    {
      heading: '5. Shipping and Disputes',
      blocks: [
        {
          label: 'Shipping:',
          body: 'Sellers are responsible for safely packaging and shipping items within the timeframe specified in the listing.',
        },
        {
          label: 'Disputes:',
          body: 'If a buyer receives a card that is damaged, counterfeit, or not as described, they must submit a ticket via our internal Reporting System. Cardstreet reserves the right to mediate disputes and issue refunds at its sole discretion based on evidence provided by both parties.',
        },
      ],
    },
    {
      heading: '6. Limitation of Liability',
      blocks: [
        {
          body: 'Cardstreet provides the platform "as-is." We are not responsible for the quality, safety, or legality of the items advertised, nor the truth or accuracy of the listings. Our total liability is limited to the amount of fees paid to us by the user in the 12 months prior to the claim.',
        },
      ],
    },
  ],
};

const TH: TermsContentData = {
  pageTitle: 'ข้อกำหนดการให้บริการ',
  lastUpdated: 'อัปเดตล่าสุด: 21 มีนาคม 2026',
  sections: [
    {
      heading: '1. การยอมรับข้อกำหนด',
      blocks: [
        {
          body: 'การเข้าถึงหรือใช้งานแอปพลิเคชันมือถือและเว็บไซต์ Cardstreet ("บริการ") ซึ่งดำเนินการโดย Cardstreet (ทะเบียนพาณิชย์เลขที่ 1329900962791) ("บริษัท" "เรา" หรือ "ของเรา") ถือว่าคุณตกลงผูกพันตามข้อกำหนดการให้บริการนี้ หากคุณไม่ตกลง กรุณาอย่าใช้บริการ',
        },
      ],
    },
    {
      heading: '2. คุณสมบัติและการลงทะเบียน',
      blocks: [
        {
          label: 'อายุ:',
          body: 'คุณต้องมีอายุอย่างน้อย 18 ปีจึงจะขายหรือซื้อสินค้าในมาร์เก็ตเพลสได้ ผู้ใช้ที่อายุต่ำกว่า 18 ปีใช้บริการได้เฉพาะภายใต้การดูแลของบิดามารดาหรือผู้ปกครองตามกฎหมายเท่านั้น',
        },
        {
          label: 'บัญชี:',
          body: 'คุณมีหน้าที่รักษาความลับของข้อมูลเข้าสู่ระบบของคุณ และตกลงให้ข้อมูลที่ถูกต้องครบถ้วนในการลงทะเบียน',
        },
      ],
    },
    {
      heading: '3. กฎมาร์เก็ตเพลสและสินค้าต้องห้าม',
      blocks: [
        {
          label: 'ขอบเขต:',
          body: 'Cardstreet เป็นมาร์เก็ตเพลสสำหรับเกมการ์ดสะสม (TCG) รวมถึงแต่ไม่จำกัดเพียง Pokémon, Magic: The Gathering และ Yu-Gi-Oh!',
        },
        {
          label: 'นโยบายของปลอม:',
          body: 'ห้ามขายการ์ด "พร็อกซี" "ของทำซ้ำ" "ของเลียนแบบ" หรือ "ของปลอม" โดยเด็ดขาด ผู้ใช้ที่ลงขายสินค้าดังกล่าวจะถูกระงับบัญชีทันทีและอาจถูกริบเงินที่รอการจ่าย',
        },
        {
          label: 'ความถูกต้องของสภาพการ์ด:',
          body: 'ผู้ขายต้องระบุสภาพการ์ดตามความเป็นจริง (เช่น Near Mint, Lightly Played)',
        },
      ],
    },
    {
      heading: '4. ค่าธรรมเนียมและการชำระเงิน',
      blocks: [
        {
          label: 'ค่าธรรมเนียมธุรกรรม:',
          body: 'Cardstreet เก็บค่าธรรมเนียม 9.0% จากการขายที่สำเร็จทุกรายการ (ลดลงสำหรับผู้ขายระดับพาร์ทเนอร์ เริ่มต้นที่ 5%) โดยค่าธรรมเนียมนี้จะถูกหักจากราคาขายโดยอัตโนมัติก่อนการจ่ายเงิน',
        },
        {
          label: 'การประมวลผลการชำระเงิน:',
          body: 'เราใช้ Stripe ในการประมวลผลการชำระเงิน การใช้บริการถือว่าคุณตกลงตามข้อกำหนดและเงื่อนไขของผู้ให้บริการภายนอกรายนี้ด้วย',
        },
        {
          label: 'ภาษี:',
          body: 'ผู้ใช้มีหน้าที่รับผิดชอบภาษีที่เกี่ยวข้อง (รวมถึงภาษีขายหรืออากรนำเข้า) ที่เกิดจากธุรกรรมของตน',
        },
      ],
    },
    {
      heading: '5. การจัดส่งและข้อพิพาท',
      blocks: [
        {
          label: 'การจัดส่ง:',
          body: 'ผู้ขายมีหน้าที่บรรจุหีบห่อและจัดส่งสินค้าอย่างปลอดภัยภายในระยะเวลาที่ระบุไว้ในรายการขาย',
        },
        {
          label: 'ข้อพิพาท:',
          body: 'หากผู้ซื้อได้รับการ์ดที่เสียหาย เป็นของปลอม หรือไม่ตรงตามคำอธิบาย ต้องแจ้งเรื่องผ่านระบบรายงานภายในของเรา Cardstreet ขอสงวนสิทธิ์ในการไกล่เกลี่ยข้อพิพาทและคืนเงินตามดุลยพินิจของบริษัทแต่เพียงผู้เดียว โดยพิจารณาจากหลักฐานที่ทั้งสองฝ่ายยื่นมา',
        },
      ],
    },
    {
      heading: '6. ข้อจำกัดความรับผิด',
      blocks: [
        {
          body: 'Cardstreet ให้บริการแพลตฟอร์ม "ตามสภาพ" เราไม่รับผิดชอบต่อคุณภาพ ความปลอดภัย หรือความถูกต้องตามกฎหมายของสินค้าที่ลงขาย รวมถึงความจริงหรือความถูกต้องของรายการขาย ความรับผิดรวมของเราจำกัดอยู่ที่จำนวนค่าธรรมเนียมที่ผู้ใช้ชำระให้เราในช่วง 12 เดือนก่อนการเรียกร้อง',
        },
      ],
    },
  ],
};

export default function TermsContent({ prefix }: { prefix: '' | '/en' }) {
  const { isThai } = useTranslation();
  const content = isThai ? TH : EN;

  return (
    <div className="min-h-screen bg-brand-darker text-white p-6 pb-24 overflow-y-auto">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="flex items-center gap-4 mb-10">
          <Link href={prefix || '/'} className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </Link>
          <h1 className="text-2xl font-black uppercase tracking-tight italic skew-x-[-10deg]">{content.pageTitle}</h1>
        </div>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          <p className="font-bold text-slate-500 uppercase tracking-widest text-[10px]">{content.lastUpdated}</p>

          {content.sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">{section.heading}</h2>
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
        </div>
      </div>
    </div>
  );
}
