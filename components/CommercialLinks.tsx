'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';

// The commercial link row for the seven content pages that render their own
// minimal chrome instead of DesktopFooter (/prices, /graded, /sell-cards, /faq,
// /contact, /terms, /privacy).
//
// WHY THIS EXISTS: the sitewide row shipped in 925ef57 lives in DesktopFooter,
// which only renders inside the /desktop tree. Measured 2026-09-11, that left
// /sell-cards — the destination of all four seller guides — with five outbound
// internal links and no path to /shops or /guides, and left /faq /contact
// /terms /privacy with no commercial links at all. Supply is the binding
// constraint (222 active listings, 1 created in the preceding week), so the
// pages that recruit sellers are the ones that must not be dead ends.
//
// Copy matches DesktopFooter's strings exactly so the anchor text a crawler
// sees for each destination is the same sitewide.
const LINKS: { href: string; th: string; en: string }[] = [
    { href: '/prices', th: 'เช็คราคาการ์ด', en: 'Check card prices' },
    { href: '/graded', th: 'ราคาการ์ดเกรด', en: 'Graded card prices' },
    { href: '/shops', th: 'ร้านขายการ์ด', en: 'Card shops' },
    { href: '/sell-cards', th: 'ขายการ์ดของคุณ', en: 'Sell your cards' },
    { href: '/guides', th: 'คู่มือและบทความ', en: 'Guides' },
    { href: '/faq', th: 'คำถามที่พบบ่อย', en: 'Frequently asked questions' },
];

/**
 * `prefix` comes from the URL (the server page passes localePrefix(pathLocale)),
 * never from the cs_lang cookie — same rule as every other link on these pages,
 * set in 8f6a342. `current` drops the page's own entry so nothing self-links.
 */
export default function CommercialLinks({ prefix, current }: { prefix: string; current?: string }) {
    const { isThai } = useTranslation();

    return (
        <div className="flex flex-wrap gap-4">
            {LINKS.filter((l) => l.href !== current).map((l) => (
                <Link
                    key={l.href}
                    href={`${prefix}${l.href}`}
                    className="text-sm text-brand-cyan font-bold hover:underline"
                >
                    {isThai ? l.th : l.en}
                </Link>
            ))}
        </div>
    );
}
