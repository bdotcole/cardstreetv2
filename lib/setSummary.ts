// Data-generated prose for set pages.
//
// WHY THIS EXISTS
// ~1,018 of the 1,045 sets in the sitemap render an h1, one meta line and a
// card grid and nothing else. Measured 2026-09-01: a set page with no
// hand-written intro carries 269-360 Thai characters TOTAL, essentially all of
// it nav, header and footer. AS1a, which has an intro, carries 1,544. That gap
// is the class Bing Webmaster Tools flags as "too many pages with insufficient
// content", and it is the largest thin-page surface on the domain.
//
// lib/setLanding.ts covers this by hand for 25 high-interest sets and should
// keep doing so - a human intro naming the chase card beats anything generated.
// This file is the floor UNDER that, not a replacement: the set page renders it
// after the hand-written intro where one exists.
//
// EVERY CLAIM IS DERIVED AT RENDER TIME from data the page has already fetched,
// so none of it can rot the way a hardcoded count or price would - which is
// exactly why lib/setLanding.ts deliberately carries neither. No extra queries.
//
// The price claim is scoped to OUR data ("ตามราคาตลาดล่าสุดบน CardStreet" /
// "per the latest market data on CardStreet") rather than asserted as a fact
// about the market. On ~1,000 pages that nobody proofreads before publish, the
// only safe superlative is one about our own dataset, which stays true when a
// row goes stale.

import { getGameLabel } from '@/lib/games';
import type { SetRow } from '@/lib/setPageData';
import type { Card } from '@/types';

// Below this the price sentence is dropped entirely rather than generalising
// from two or three rows. Sampled 2026-09-01: 31 of 40 sets clear it.
const MIN_PRICED_FOR_CLAIM = 5;

const TH_LANGUAGE: Record<string, string> = {
    th: 'ภาษาไทย',
    ja: 'ภาษาญี่ปุ่น',
    jp: 'ภาษาญี่ปุ่น',
    en: 'ภาษาอังกฤษ',
};

const EN_LANGUAGE: Record<string, string> = {
    th: 'Thai-language',
    ja: 'Japanese-language',
    jp: 'Japanese-language',
    en: 'English-language',
};

// Thai puts no space between a noun and its modifier, so "การ์ดโปเกมอนภาษาไทย"
// is correct - but lorcana and riftbound carry a Latin localizedName.th, so a
// blind concat gives "การ์ดDisney Lorcana" and then "...Lorcanaภาษาอังกฤษ".
//
// The rule is about the BOUNDARY, not about either side alone: join only when
// Thai script meets Thai script, otherwise space. Testing one side only - as
// the set page's own thaiCardLabel does, correctly, for its single case - gets
// one of the two joins here backwards.
function joinThai(left: string, right: string): string {
    const leftEndsThai = /[฀-๿]$/.test(left);
    const rightStartsThai = /^[฀-๿]/.test(right);
    return leftEndsThai && rightStartsThai ? `${left}${right}` : `${left} ${right}`;
}

const baht = (n: number) => `฿${Math.round(n).toLocaleString('en-US')}`;

// marketPrice is already THB off lib/cardMapper.ts - the DISPLAY price. Ranking
// on the raw market_values column instead is what produced a wrong ordering on
// 2026-08-29, which is why that rule exists.
function topByDisplayPrice(cards: Card[]): { top: Card | null; pricedCount: number } {
    const priced = cards.filter((c) => (c.marketPrice ?? 0) > 0);
    let top: Card | null = null;
    for (const c of priced) if (!top || c.marketPrice > top.marketPrice) top = c;
    return { top, pricedCount: priced.length };
}

export function buildSetSummary(set: SetRow, cards: Card[], lang: 'EN' | 'TH'): string | null {
    if (!cards.length) return null;

    const { top, pricedCount } = topByDisplayPrice(cards);
    // Collectors and the sealed products both use CE years for TCG releases; the
    // Buddhist-era form reads as a mismatch against the printed set.
    const year = set.release_date ? new Date(set.release_date).getFullYear() : null;
    const canPrice = pricedCount >= MIN_PRICED_FOR_CLAIM && top !== null;
    const cardLabel = (c: Card) => `${c.name} #${c.number}${c.rarity ? ` (${c.rarity})` : ''}`;

    if (lang === 'TH') {
        const game = joinThai('การ์ด', getGameLabel(set.game, 'th'));
        const langLabel = TH_LANGUAGE[set.language] ?? '';
        const parts: string[] = [];
        parts.push(
            `${set.name} เป็นชุด${langLabel ? joinThai(game, langLabel) : game} ทั้งหมด ${cards.length} ใบ` +
                (year ? ` วางจำหน่ายปี ${year}` : '')
        );
        if (canPrice) {
            parts.push(
                `ตอนนี้มีราคาตลาดในระบบแล้ว ${pricedCount} ใบ ` +
                    `ใบที่ราคาสูงที่สุดในชุดตอนนี้คือ ${cardLabel(top!)} ที่ ${baht(top!.marketPrice)} ` +
                    `ตามราคาตลาดล่าสุดบน CardStreet`
            );
        }
        parts.push('เช็คราคาการ์ดรายใบ เทียบกับรายการขายจริงจากผู้ขายในไทย แล้วซื้อ-ขายการ์ดของแท้ได้ในหน้านี้');
        return parts.join(' ');
    }

    const game = getGameLabel(set.game, 'en');
    const langLabel = EN_LANGUAGE[set.language] ?? '';
    const lead = langLabel ? `${langLabel} ${game}` : game;
    const article = /^[aeiou]/i.test(lead) ? 'an' : 'a';
    const parts: string[] = [];
    parts.push(`${set.name} is ${article} ${lead} set of ${cards.length} cards${year ? `, released in ${year}` : ''}.`);
    if (canPrice) {
        parts.push(
            `${pricedCount} of them have a market price on file. The highest right now is ` +
                `${cardLabel(top!)} at ${baht(top!.marketPrice)}, per the latest market data on CardStreet.`
        );
    }
    parts.push(
        "Check any card's price one by one, compare it against real listings from sellers in Thailand, " +
            'and buy or sell authentic copies on this page.'
    );
    return parts.join(' ');
}
