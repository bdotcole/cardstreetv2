'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';

interface PrivacyListItem {
  label?: string;
  body: string;
}

interface PrivacySection {
  heading: string;
  intro?: string;
  items?: PrivacyListItem[];
  body?: React.ReactNode;
}

interface PrivacyContent {
  pageTitle: string;
  lastUpdated: string;
  sections: PrivacySection[];
}

const SUPPORT_EMAIL = (
  <a href="mailto:support@thailandtcg.com" className="text-brand-cyan hover:underline">
    support@thailandtcg.com
  </a>
);

const EN: PrivacyContent = {
  pageTitle: 'Privacy Policy',
  lastUpdated: 'Last Updated: March 21, 2026',
  sections: [
    {
      heading: '1. Information We Collect',
      intro: 'We collect information to provide a secure marketplace experience:',
      items: [
        { label: 'Personal Data:', body: 'Name, email address, physical shipping address, and phone number.' },
        { label: 'Verification Data:', body: 'We may collect government-issued ID images to verify "Verified Seller" status.' },
        { label: 'Transaction Data:', body: 'Payment details processed through Stripe (we do not store full credit card numbers on our servers).' },
        { label: 'Media:', body: 'Photos of cards uploaded for listings.' },
      ],
    },
    {
      heading: '2. How We Use Your Information',
      items: [
        { body: 'To facilitate transactions between buyers and sellers.' },
        { body: 'To prevent fraud and enforce our ban on counterfeit items.' },
        { body: 'To improve our app using analytics.' },
        { body: 'To comply with legal obligations (e.g., tax reporting).' },
      ],
    },
    {
      heading: '3. Third-Party Sharing',
      intro: 'We share your data with trusted service providers only as necessary:',
      items: [
        { label: 'Infrastructure:', body: 'Firebase (Google) for data storage and authentication.' },
        { label: 'Payments:', body: 'Stripe for secure transaction processing.' },
        { label: 'Compliance:', body: 'We may disclose information if required by US law or to protect the safety of our users.' },
      ],
    },
    {
      heading: '4. International Transfers',
      body: 'Cardstreet is a US-based entity. While we operate in Thailand, your data is primarily stored and processed on servers located in the United States. By using the Service, you consent to this transfer.',
    },
    {
      heading: '5. Your Rights',
      body: (
        <>
          You have the right to access, correct, or request the deletion of your personal data. To exercise these rights, please contact us at {SUPPORT_EMAIL}.
        </>
      ),
    },
    {
      heading: '6. Security',
      body: 'We implement industry-standard security measures via Firebase and encrypted payment gateways. However, no method of transmission over the internet is 100% secure.',
    },
  ],
};

const TH: PrivacyContent = {
  pageTitle: 'นโยบายความเป็นส่วนตัว',
  lastUpdated: 'อัปเดตล่าสุด: 21 มีนาคม 2026',
  sections: [
    {
      heading: '1. ข้อมูลที่เราเก็บรวบรวม',
      intro: 'เราเก็บรวบรวมข้อมูลเพื่อให้บริการมาร์เก็ตเพลสที่ปลอดภัย:',
      items: [
        { label: 'ข้อมูลส่วนบุคคล:', body: 'ชื่อ ที่อยู่อีเมล ที่อยู่สำหรับจัดส่ง และหมายเลขโทรศัพท์' },
        { label: 'ข้อมูลยืนยันตัวตน:', body: 'เราอาจเก็บภาพบัตรประจำตัวที่ออกโดยหน่วยงานรัฐเพื่อยืนยันสถานะ "ผู้ขายที่ยืนยันแล้ว"' },
        { label: 'ข้อมูลธุรกรรม:', body: 'รายละเอียดการชำระเงินประมวลผลผ่าน Stripe (เราไม่เก็บหมายเลขบัตรเครดิตแบบเต็มบนเซิร์ฟเวอร์ของเรา)' },
        { label: 'สื่อ:', body: 'รูปถ่ายการ์ดที่อัปโหลดสำหรับลงขาย' },
      ],
    },
    {
      heading: '2. เราใช้ข้อมูลของคุณอย่างไร',
      items: [
        { body: 'เพื่ออำนวยความสะดวกในธุรกรรมระหว่างผู้ซื้อและผู้ขาย' },
        { body: 'เพื่อป้องกันการฉ้อโกงและบังคับใช้นโยบายห้ามสินค้าปลอมของเรา' },
        { body: 'เพื่อปรับปรุงแอปของเราด้วยข้อมูลวิเคราะห์การใช้งาน' },
        { body: 'เพื่อปฏิบัติตามข้อผูกพันทางกฎหมาย (เช่น การรายงานภาษี)' },
      ],
    },
    {
      heading: '3. การแบ่งปันข้อมูลกับบุคคลที่สาม',
      intro: 'เราแบ่งปันข้อมูลของคุณกับผู้ให้บริการที่เชื่อถือได้เท่าที่จำเป็นเท่านั้น:',
      items: [
        { label: 'โครงสร้างพื้นฐาน:', body: 'Firebase (Google) สำหรับจัดเก็บข้อมูลและยืนยันตัวตน' },
        { label: 'การชำระเงิน:', body: 'Stripe สำหรับประมวลผลธุรกรรมอย่างปลอดภัย' },
        { label: 'การปฏิบัติตามกฎหมาย:', body: 'เราอาจเปิดเผยข้อมูลหากกฎหมายสหรัฐอเมริกากำหนด หรือเพื่อคุ้มครองความปลอดภัยของผู้ใช้ของเรา' },
      ],
    },
    {
      heading: '4. การโอนข้อมูลระหว่างประเทศ',
      body: 'Cardstreet เป็นนิติบุคคลที่จดทะเบียนในสหรัฐอเมริกา แม้เราจะดำเนินงานในประเทศไทย ข้อมูลของคุณจะถูกจัดเก็บและประมวลผลบนเซิร์ฟเวอร์ในสหรัฐอเมริกาเป็นหลัก การใช้บริการถือว่าคุณยินยอมให้มีการโอนข้อมูลดังกล่าว',
    },
    {
      heading: '5. สิทธิของคุณ',
      body: (
        <>
          คุณมีสิทธิเข้าถึง แก้ไข หรือขอลบข้อมูลส่วนบุคคลของคุณ หากต้องการใช้สิทธิเหล่านี้ กรุณาติดต่อเราที่ {SUPPORT_EMAIL}
        </>
      ),
    },
    {
      heading: '6. ความปลอดภัย',
      body: 'เราใช้มาตรการรักษาความปลอดภัยตามมาตรฐานอุตสาหกรรมผ่าน Firebase และช่องทางชำระเงินที่เข้ารหัส อย่างไรก็ตาม ไม่มีวิธีการส่งข้อมูลผ่านอินเทอร์เน็ตใดที่ปลอดภัย 100%',
    },
  ],
};

export default function PrivacyPage() {
  const { isThai } = useTranslation();
  const content = isThai ? TH : EN;

  return (
    <div className="min-h-screen bg-brand-darker text-white p-6 pb-24 overflow-y-auto">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="flex items-center gap-4 mb-10">
          <Link href="/" className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </Link>
          <h1 className="text-2xl font-black uppercase tracking-tight italic skew-x-[-10deg]">{content.pageTitle}</h1>
        </div>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          <p className="font-bold text-slate-500 uppercase tracking-widest text-[10px]">{content.lastUpdated}</p>

          {content.sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-lg font-black text-white uppercase tracking-wider text-brand-cyan">{section.heading}</h2>
              {section.intro && <p>{section.intro}</p>}
              {section.items && (
                <ul className={`list-disc pl-5 space-y-2${section.intro ? ' mt-2' : ''}`}>
                  {section.items.map((item, i) => (
                    <li key={i}>
                      {item.label && <strong className="text-white">{item.label}</strong>}
                      {item.label ? ' ' : ''}
                      {item.body}
                    </li>
                  ))}
                </ul>
              )}
              {section.body && <p>{section.body}</p>}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
