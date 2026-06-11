'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';

interface FaqItem {
  q: string;
  a: React.ReactNode;
}

interface FaqSection {
  title: string;
  icon: string;
  items: FaqItem[];
}

interface HelpContent {
  pageTitle: string;
  introBefore: string;
  introLink: string;
  introAfter: string;
  stillStuck: string;
  emailSupport: string;
  sections: FaqSection[];
}

const EN: HelpContent = {
  pageTitle: 'Help Center',
  introBefore: "Answers to the questions we hear most. Can't find what you need? ",
  introLink: 'Contact us',
  introAfter: " and we'll help.",
  stillStuck: 'Still stuck?',
  emailSupport: 'Email Support',
  sections: [
    {
      title: 'Buying',
      icon: 'fa-solid fa-cart-shopping',
      items: [
        {
          q: 'How do I buy a card?',
          a: 'Browse or search the marketplace, open a listing, and add it to your cart. When you check out you pay securely by card. Your payment is held in escrow and only released to the seller after your order is marked delivered.',
        },
        {
          q: 'Is my payment protected?',
          a: 'Yes. Funds are held until the order is delivered. If an item arrives damaged, counterfeit, or not as described, email support@cardstreet.app with your order number and photos before the funds release window closes and we will help mediate.',
        },
        {
          q: 'Why can I only buy from one seller per order?',
          a: 'In Thailand each checkout is settled directly to a single seller, so a cart can only contain items from one seller at a time. Check out separately for cards from different sellers.',
        },
      ],
    },
    {
      title: 'Selling',
      icon: 'fa-solid fa-tag',
      items: [
        {
          q: 'How do I sell a card?',
          a: 'List a card from your collection, set your price and condition, and publish. Once a buyer pays, ship the card using the prepaid label and mark it sent.',
        },
        {
          q: 'When do I get paid?',
          a: 'Payouts are released after the order is delivered and the protection window passes. Funds accumulate in your connected Stripe balance and are paid out to your bank automatically once released.',
        },
        {
          q: 'What do I need to start selling?',
          a: 'You complete a short Stripe onboarding (identity + bank details) the first time you list. This is required so we can pay you and comply with Thai payment regulations.',
        },
      ],
    },
    {
      title: 'Scanning',
      icon: 'fa-solid fa-camera',
      items: [
        {
          q: 'How does card scanning work?',
          a: 'Tap the camera button and point it at a card. Hold steady — the app auto-captures when the image is sharp and stable, then identifies the card by its set code, number, and artwork. It works across English, Thai, and Japanese printings.',
        },
        {
          q: 'It identified the wrong card. What can I do?',
          a: 'Make sure the full card and its bottom info strip (set code and number) are in frame and well lit. If it still misreads, you can search for the card by name and add it manually.',
        },
      ],
    },
    {
      title: 'Shipping & Orders',
      icon: 'fa-solid fa-truck-fast',
      items: [
        {
          q: 'How is shipping handled?',
          a: 'Orders ship within Thailand via Flash Express. Sellers receive a prepaid label, and you can track your order from the order details screen.',
        },
        {
          q: 'How do I track my order?',
          a: 'Open the order from your profile to see its current status and tracking. You will be notified as it moves from shipped to delivered.',
        },
      ],
    },
    {
      title: 'Account',
      icon: 'fa-solid fa-user',
      items: [
        {
          q: 'How do I change my personal details?',
          a: 'Go to Profile, then Personal Details, to update your name, address, and contact information.',
        },
        {
          q: 'How do I delete my account?',
          a: (
            <>
              You can request account deletion from the{' '}
              <Link href="/delete" className="text-brand-cyan hover:underline">
                account deletion page
              </Link>
              . This permanently removes your data.
            </>
          ),
        },
      ],
    },
  ],
};

const TH: HelpContent = {
  pageTitle: 'ศูนย์ช่วยเหลือ',
  introBefore: 'รวมคำตอบสำหรับคำถามที่พบบ่อยที่สุด หากหาคำตอบที่ต้องการไม่เจอ ',
  introLink: 'ติดต่อเรา',
  introAfter: ' ได้เลย เรายินดีช่วยเหลือ',
  stillStuck: 'ยังแก้ปัญหาไม่ได้?',
  emailSupport: 'อีเมลหาฝ่ายซัพพอร์ต',
  sections: [
    {
      title: 'การซื้อ',
      icon: 'fa-solid fa-cart-shopping',
      items: [
        {
          q: 'ซื้อการ์ดอย่างไร?',
          a: 'เลือกดูหรือค้นหาการ์ดในมาร์เก็ตเพลส เปิดรายการขายแล้วเพิ่มลงตะกร้า เมื่อชำระเงินคุณจะจ่ายอย่างปลอดภัยด้วยบัตร เงินของคุณจะถูกพักไว้และโอนให้ผู้ขายหลังจากคำสั่งซื้อถูกยืนยันว่าจัดส่งถึงแล้วเท่านั้น',
        },
        {
          q: 'การชำระเงินของฉันได้รับการคุ้มครองหรือไม่?',
          a: 'ได้รับการคุ้มครอง เงินจะถูกพักไว้จนกว่าคำสั่งซื้อจะถึงมือคุณ หากสินค้าที่ได้รับเสียหาย เป็นของปลอม หรือไม่ตรงตามคำอธิบาย ให้อีเมลมาที่ support@cardstreet.app พร้อมหมายเลขคำสั่งซื้อและรูปถ่ายก่อนหมดระยะเวลาคุ้มครอง แล้วเราจะช่วยไกล่เกลี่ยให้',
        },
        {
          q: 'ทำไมจึงซื้อจากผู้ขายได้เพียงรายเดียวต่อหนึ่งคำสั่งซื้อ?',
          a: 'ในประเทศไทย การชำระเงินแต่ละครั้งจะโอนตรงไปยังผู้ขายรายเดียว ตะกร้าจึงใส่สินค้าจากผู้ขายได้ครั้งละหนึ่งรายเท่านั้น หากต้องการซื้อการ์ดจากผู้ขายหลายราย ให้แยกชำระเงินเป็นคนละคำสั่งซื้อ',
        },
      ],
    },
    {
      title: 'การขาย',
      icon: 'fa-solid fa-tag',
      items: [
        {
          q: 'ขายการ์ดอย่างไร?',
          a: 'ลงขายการ์ดจากคอลเลกชันของคุณ กำหนดราคาและสภาพการ์ด แล้วเผยแพร่รายการ เมื่อมีผู้ซื้อชำระเงิน ให้จัดส่งการ์ดด้วยใบจัดส่งที่ชำระเงินล่วงหน้าแล้วกดยืนยันว่าจัดส่งแล้ว',
        },
        {
          q: 'จะได้รับเงินเมื่อไหร่?',
          a: 'เงินจะถูกโอนหลังจากคำสั่งซื้อจัดส่งถึงผู้ซื้อและพ้นระยะเวลาคุ้มครองแล้ว ยอดเงินจะสะสมในบัญชี Stripe ที่เชื่อมต่อไว้ และโอนเข้าบัญชีธนาคารของคุณโดยอัตโนมัติเมื่อถึงรอบจ่าย',
        },
        {
          q: 'ต้องเตรียมอะไรบ้างก่อนเริ่มขาย?',
          a: 'ครั้งแรกที่ลงขาย คุณต้องผ่านขั้นตอนสั้น ๆ ของ Stripe (ยืนยันตัวตน + ข้อมูลบัญชีธนาคาร) ขั้นตอนนี้จำเป็นเพื่อให้เราจ่ายเงินให้คุณได้และเป็นไปตามกฎระเบียบด้านการชำระเงินของไทย',
        },
      ],
    },
    {
      title: 'การสแกนการ์ด',
      icon: 'fa-solid fa-camera',
      items: [
        {
          q: 'การสแกนการ์ดทำงานอย่างไร?',
          a: 'แตะปุ่มกล้องแล้วเล็งไปที่การ์ด ถือกล้องให้นิ่ง — แอปจะถ่ายภาพอัตโนมัติเมื่อภาพคมชัดและนิ่ง จากนั้นจะระบุการ์ดจากรหัสชุด หมายเลขการ์ด และลายภาพ รองรับการ์ดทั้งภาษาอังกฤษ ไทย และญี่ปุ่น',
        },
        {
          q: 'ระบบระบุการ์ดผิด ต้องทำอย่างไร?',
          a: 'ตรวจสอบว่าการ์ดทั้งใบและแถบข้อมูลด้านล่างของการ์ด (รหัสชุดและหมายเลข) อยู่ในกรอบและมีแสงเพียงพอ หากยังอ่านผิดอยู่ คุณสามารถค้นหาการ์ดด้วยชื่อแล้วเพิ่มด้วยตนเองได้',
        },
      ],
    },
    {
      title: 'การจัดส่งและคำสั่งซื้อ',
      icon: 'fa-solid fa-truck-fast',
      items: [
        {
          q: 'การจัดส่งทำอย่างไร?',
          a: 'คำสั่งซื้อจัดส่งภายในประเทศไทยผ่าน Flash Express ผู้ขายจะได้รับใบจัดส่งที่ชำระเงินล่วงหน้า และคุณสามารถติดตามพัสดุได้จากหน้ารายละเอียดคำสั่งซื้อ',
        },
        {
          q: 'ติดตามคำสั่งซื้ออย่างไร?',
          a: 'เปิดคำสั่งซื้อจากหน้าโปรไฟล์เพื่อดูสถานะปัจจุบันและเลขติดตามพัสดุ ระบบจะแจ้งเตือนคุณเมื่อสถานะเปลี่ยนจากจัดส่งแล้วเป็นถึงปลายทาง',
        },
      ],
    },
    {
      title: 'บัญชี',
      icon: 'fa-solid fa-user',
      items: [
        {
          q: 'เปลี่ยนข้อมูลส่วนตัวอย่างไร?',
          a: 'ไปที่โปรไฟล์ แล้วเลือกข้อมูลส่วนตัว เพื่อแก้ไขชื่อ ที่อยู่ และข้อมูลติดต่อของคุณ',
        },
        {
          q: 'ลบบัญชีอย่างไร?',
          a: (
            <>
              คุณสามารถส่งคำขอลบบัญชีได้ที่{' '}
              <Link href="/delete" className="text-brand-cyan hover:underline">
                หน้าลบบัญชี
              </Link>{' '}
              การลบนี้จะลบข้อมูลของคุณอย่างถาวร
            </>
          ),
        },
      ],
    },
  ],
};

export default function HelpPage() {
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

        <p className="text-sm text-slate-300 leading-relaxed mb-10">
          {content.introBefore}
          <Link href="/contact" className="text-brand-cyan font-bold hover:underline">
            {content.introLink}
          </Link>
          {content.introAfter}
        </p>

        <div className="space-y-10">
          {content.sections.map((section) => (
            <section key={section.title} className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-cyan/10 flex items-center justify-center text-brand-cyan">
                  <i className={`${section.icon} text-sm`}></i>
                </div>
                <h2 className="text-lg font-black uppercase tracking-wider text-brand-cyan">{section.title}</h2>
              </div>

              <div className="glass rounded-2xl border border-white/10 divide-y divide-white/5 overflow-hidden">
                {section.items.map((item) => (
                  <details key={item.q} className="group p-5 [&_summary]:list-none">
                    <summary className="flex items-center justify-between cursor-pointer">
                      <span className="text-white font-bold text-sm pr-4">{item.q}</span>
                      <i className="fa-solid fa-chevron-down text-slate-500 text-xs transition-transform group-open:rotate-180"></i>
                    </summary>
                    <p className="text-slate-400 text-sm leading-relaxed mt-3">{item.a}</p>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 glass rounded-2xl border border-white/10 p-6 text-center space-y-3">
          <p className="text-sm text-slate-300">{content.stillStuck}</p>
          <a
            href="mailto:support@cardstreet.app"
            className="inline-block bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider px-6 py-3 rounded-xl active:scale-[0.98] transition-all"
          >
            {content.emailSupport}
          </a>
        </div>
      </div>
    </div>
  );
}
