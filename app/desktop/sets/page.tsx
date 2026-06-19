import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { getAllSets, type SetRow } from '@/lib/setPageData';
import { buildAlternates, BASE_URL } from '@/lib/i18nRouting';
import { getOptimizedImageUrl } from '@/lib/imageUtils';

async function resolveLang(): Promise<'EN' | 'TH'> {
    return (await headers()).get('x-cs-lang') === 'EN' ? 'EN' : 'TH';
}

// Display order + labels for the game sections.
const GAME_ORDER: { id: string; en: string; th: string }[] = [
    { id: 'pokemon', en: 'Pokémon', th: 'โปเกมอน' },
    { id: 'yugioh', en: 'Yu-Gi-Oh!', th: 'ยูกิโอ' },
    { id: 'mtg', en: 'Magic: The Gathering', th: 'เมจิก' },
    { id: 'onepiece', en: 'One Piece', th: 'วันพีซ' },
];

export async function generateMetadata(): Promise<Metadata> {
    const lang = await resolveLang();
    const title = lang === 'EN' ? 'Browse Trading Card Sets | CardStreet' : 'เลือกชมชุดการ์ดทั้งหมด | CardStreet';
    const description =
        lang === 'EN'
            ? 'Browse every Pokémon, Yu-Gi-Oh!, Magic, and One Piece set on CardStreet. Live prices and listings for every card, with nationwide shipping in Thailand.'
            : 'เลือกชมชุดการ์ดโปเกมอน ยูกิโอ เมจิก และวันพีซทั้งหมดบน CardStreet ราคาและรายการขายของทุกใบ จัดส่งทั่วไทย';
    return {
        metadataBase: new URL(BASE_URL),
        title,
        description,
        alternates: buildAlternates('/sets'),
        openGraph: { title, description, type: 'website', siteName: 'CardStreet', url: '/sets' },
    };
}

export default async function DesktopSetsIndexPage() {
    const lang = await resolveLang();
    const sets = await getAllSets();

    const byGame = new Map<string, SetRow[]>();
    for (const s of sets) {
        if (!byGame.has(s.game)) byGame.set(s.game, []);
        byGame.get(s.game)!.push(s);
    }

    return (
        <div>
            <h1 className="text-2xl font-black text-white">{lang === 'EN' ? 'Trading Card Sets' : 'ชุดการ์ดทั้งหมด'}</h1>
            <p className="text-sm text-slate-400 mt-1">
                {lang === 'EN'
                    ? 'Every set across all games. Pick a set to browse its cards, prices, and listings.'
                    : 'ชุดการ์ดทั้งหมดของทุกเกม เลือกชุดเพื่อดูการ์ด ราคา และรายการขาย'}
            </p>

            {GAME_ORDER.filter((g) => byGame.has(g.id)).map((g) => {
                const list = byGame.get(g.id)!;
                return (
                    <section key={g.id} className="mt-10">
                        <h2 className="text-sm font-black text-white uppercase tracking-widest mb-4">
                            {lang === 'EN' ? g.en : g.th} <span className="text-slate-500">({list.length})</span>
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            {list.map((s) => {
                                const logo = s.logo_url ? getOptimizedImageUrl(s.logo_url, 160, 80) : null;
                                return (
                                    <Link
                                        key={`${s.id}-${s.language}`}
                                        href={`/sets/${s.id}`}
                                        className="flex items-center gap-3 bg-[#1e293b]/40 border border-white/5 rounded-xl p-3 hover:border-brand-cyan/40 transition-colors"
                                    >
                                        <span className="w-16 h-10 shrink-0 flex items-center justify-center">
                                            {logo ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={logo} alt="" loading="lazy" className="max-w-full max-h-full object-contain" />
                                            ) : (
                                                <span className="text-[10px] font-black text-slate-600 uppercase">{s.id}</span>
                                            )}
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block text-sm font-bold text-white truncate">{s.name}</span>
                                            <span className="block text-[11px] text-slate-500">
                                                {(s.total || s.printed_total || 0)} {lang === 'EN' ? 'cards' : 'ใบ'}
                                                {s.language !== 'en' ? ` · ${s.language.toUpperCase()}` : ''}
                                            </span>
                                        </span>
                                    </Link>
                                );
                            })}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
