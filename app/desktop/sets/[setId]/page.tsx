import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSetPageData, type SetRow } from '@/lib/setPageData';
import { buildAlternates, BASE_URL } from '@/lib/i18nRouting';
import { getSetLogoUrl } from '@/lib/imageUtils';
import DesktopSetCards from '@/components/desktop/DesktopSetCards';
import type { Card } from '@/types';

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

const GAME_LABEL: Record<string, string> = {
    pokemon: 'Pokémon',
    yugioh: 'Yu-Gi-Oh!',
    mtg: 'Magic: The Gathering',
    onepiece: 'One Piece',
    riftbound: 'Riftbound',
    lorcana: 'Disney Lorcana',
};

export async function generateMetadata({ params }: { params: Promise<{ setId: string }> }): Promise<Metadata> {
    const { setId } = await params;
    const { set, cards } = await getSetPageData(setId);
    if (!set) return { title: 'Set not found | CardStreet', robots: { index: false, follow: false } };

    const lang = await resolveLang();
    const count = cards.length || set.printed_total || set.total || 0;
    const game = GAME_LABEL[set.game] ?? set.game;
    const title =
        lang === 'EN'
            ? `${set.name} — ${game} Cards & Prices | CardStreet`
            : `${set.name} — การ์ด${game} ราคาและรายการขาย | CardStreet`;
    const description =
        lang === 'EN'
            ? `Browse all ${count} ${set.name} ${game} cards with live market prices and listings from verified sellers. Buy and sell on CardStreet with nationwide shipping in Thailand.`
            : `เลือกชมการ์ด ${set.name} (${game}) ทั้งหมด ${count} ใบ พร้อมราคาตลาดเรียลไทม์และรายการขายจากผู้ขายที่ยืนยันแล้ว ซื้อขายบน CardStreet จัดส่งทั่วไทย`;

    const ogImage = set.logo_url ? getSetLogoUrl(set.logo_url, 600, 85) : undefined;

    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates(`/sets/${setId}`),
        openGraph: {
            title,
            description,
            type: 'website',
            siteName: 'CardStreet',
            url: `/sets/${setId}`,
            images: ogImage ? [{ url: ogImage }] : undefined,
        },
    };
}

// schema.org ItemList — declares the set's cards (and their URLs) so search and
// AI answer engines see this as a structured collection. Capped to keep the
// payload bounded; the full set is linked as crawlable HTML below regardless.
function buildItemListJsonLd(set: SetRow, cards: Card[]) {
    const items = cards.slice(0, 100).map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${BASE_URL}/card/${c.id}`,
        name: c.name,
    }));
    return {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: `${set.name} — ${GAME_LABEL[set.game] ?? set.game}`,
        numberOfItems: cards.length,
        itemListElement: items,
    };
}

export default async function DesktopSetPage({ params }: { params: Promise<{ setId: string }> }) {
    const { setId } = await params;
    const { set, cards } = await getSetPageData(setId);
    if (!set) notFound();

    const lang = await resolveLang();
    const game = GAME_LABEL[set.game] ?? set.game;
    const logo = set.logo_url ? getSetLogoUrl(set.logo_url, 300, 85) : null;

    return (
        <div>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(buildItemListJsonLd(set, cards)) }}
            />

            <nav className="text-sm text-slate-500">
                <Link href="/" className="hover:text-slate-300 transition-colors">{lang === 'EN' ? 'Marketplace' : 'มาร์เก็ตเพลส'}</Link>
                <span className="mx-2">›</span>
                <Link href="/sets" className="hover:text-slate-300 transition-colors">{lang === 'EN' ? 'Sets' : 'ชุดการ์ด'}</Link>
                <span className="mx-2">›</span>
                <span className="text-slate-300">{set.name}</span>
            </nav>

            <header className="flex items-center gap-5 mt-6">
                {logo && (
                    <div className="relative w-28 h-16 shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={logo} alt={set.name} className="w-full h-full object-contain object-left" />
                    </div>
                )}
                <div>
                    <h1 className="text-2xl font-black text-white">{set.name}</h1>
                    <p className="text-sm text-slate-400 mt-1">
                        {game}
                        {` · ${cards.length} ${lang === 'EN' ? 'cards' : 'ใบ'}`}
                        {set.release_date ? ` · ${new Date(set.release_date).getFullYear()}` : ''}
                    </p>
                </div>
            </header>

            {cards.length === 0 ? (
                <p className="text-slate-500 text-sm mt-10">{lang === 'EN' ? 'No cards found for this set.' : 'ไม่พบการ์ดในชุดนี้'}</p>
            ) : (
                <DesktopSetCards cards={cards} />
            )}
        </div>
    );
}
