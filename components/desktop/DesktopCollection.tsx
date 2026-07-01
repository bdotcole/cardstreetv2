'use client'

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { useUserCollections } from '@/lib/hooks/useUserCollections';
import { useWishlist } from '@/lib/hooks/useWishlist';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import { getThumbnailUrl, shouldSkipNextOptimization, CARD_BLUR_DATA_URL } from '@/lib/imageUtils';
import { formatTHB } from '@/components/desktop/DesktopMarketplace';
import AuthModal from '@/components/AuthModal';
import { pokemonService, type ApiSet } from '@/services/pokemonService';
import { GAMES, getGame, getGameLanguages, gameHasMultipleLanguages, defaultLanguageForGame, type GameLanguageCode } from '@/lib/games';
import type { Card, UserCollectionItem } from '@/types';

// recharts is ~100KB — defer until the Overview chart actually renders.
const PriceChart = dynamic(() => import('@/components/PriceChart'), {
    ssr: false,
    loading: () => <div className="w-full h-full rounded-lg bg-brand-darker/40 animate-pulse" />,
});

type Tab = 'overview' | 'collection' | 'wishlist' | 'master';
type SortKey = 'date_desc' | 'name_asc' | 'price_desc' | 'price_asc';

interface FlatItem {
    colId: string;
    item: UserCollectionItem;
    card: Card;
}

export default function DesktopCollection() {
    const { t, isThai } = useTranslation();
    const [user, setUser] = useState<User | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);
    const [tab, setTab] = useState<Tab>('overview');

    const { collections, isLoading: colLoading, removeCardFromCollection } = useUserCollections();
    const { wishlist, isLoading: wlLoading, removeFromWishlist } = useWishlist();

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => {
            setUser(data.user ?? null);
            setAuthChecked(true);
        });
        const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
        return () => sub.subscription.unsubscribe();
    }, []);

    // Flat list of every owned card across collections.
    const allItems = useMemo<FlatItem[]>(() => {
        const list: FlatItem[] = [];
        for (const col of collections) {
            for (const item of col.items) {
                if (item.card) list.push({ colId: col.id, item, card: item.card });
            }
        }
        return list;
    }, [collections]);

    const ownedCardIds = useMemo(() => {
        const s = new Set<string>();
        allItems.forEach(({ item }) => { if (item.quantity > 0) s.add(item.cardId); });
        return s;
    }, [allItems]);

    // Owned count per set, keyed by the set-id prefix of the card id
    // (e.g. "sv4pt5-234" -> "sv4pt5"). Gives the Master Set grid instant
    // completion counts without fetching every set's card list.
    const ownedCountBySet = useMemo(() => {
        const m = new Map<string, number>();
        ownedCardIds.forEach((id) => {
            const idx = id.lastIndexOf('-');
            if (idx <= 0) return;
            const prefix = id.slice(0, idx);
            m.set(prefix, (m.get(prefix) ?? 0) + 1);
        });
        return m;
    }, [ownedCardIds]);

    // Portfolio totals — only collections flagged for the portfolio count.
    const { totalValue, profitLoss, plPct } = useMemo(() => {
        let value = 0;
        let invested = 0;
        for (const col of collections) {
            if (col.includeInPortfolio === false) continue;
            for (const item of col.items) {
                const mp = item.card?.marketPrice ?? 0;
                value += mp * item.quantity;
                invested += (item.purchasePrice || 0) * item.quantity;
            }
        }
        const pl = value - invested;
        return { totalValue: value, profitLoss: pl, plPct: invested > 0 ? (pl / invested) * 100 : 0 };
    }, [collections]);

    if (!authChecked) {
        return <div className="h-64 rounded-2xl bg-white/5 animate-pulse"></div>;
    }

    if (!user) {
        return (
            <div className="text-center py-24">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                    <i className="fa-solid fa-vault text-2xl text-slate-600"></i>
                </div>
                <h1 className="text-white font-bold uppercase tracking-widest text-sm mb-1">{t('desktop.collection.signedOutTitle')}</h1>
                <p className="text-slate-500 text-sm mb-6">{t('desktop.collection.signedOutDesc')}</p>
                <button
                    onClick={() => setAuthOpen(true)}
                    className="bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black px-6 py-2.5 rounded-xl transition-colors"
                >
                    {t('desktop.signIn')}
                </button>
                <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
            </div>
        );
    }

    const TABS: [Tab, string][] = [
        ['overview', t('desktop.collection.tabOverview')],
        ['collection', t('desktop.collection.tabCollection')],
        ['wishlist', t('desktop.collection.tabWishlist')],
        ['master', t('desktop.collection.tabMaster')],
    ];

    return (
        <div>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-white">{t('desktop.collection.title')}</h1>
                    <p className="text-sm text-slate-400 mt-1">{t('desktop.collection.subtitle')}</p>
                </div>
            </div>

            {/* Sub-nav */}
            <div className="flex flex-wrap gap-2 mt-6 border-b border-white/5 pb-3">
                {TABS.map(([id, label]) => (
                    <button
                        key={id}
                        onClick={() => setTab(id)}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                            tab === id ? 'bg-brand-cyan text-brand-darker' : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="mt-8">
                {tab === 'overview' && (
                    <OverviewPanel
                        totalValue={totalValue}
                        profitLoss={profitLoss}
                        plPct={plPct}
                        assetCount={allItems.length}
                        setsCount={ownedCountBySet.size}
                        wishlistCount={wishlist.length}
                        onNavigate={setTab}
                    />
                )}
                {tab === 'collection' && (
                    <CollectionPanel
                        items={allItems}
                        loading={colLoading}
                        onRemove={removeCardFromCollection}
                    />
                )}
                {tab === 'wishlist' && (
                    <WishlistPanel wishlist={wishlist} loading={wlLoading} onRemove={removeFromWishlist} />
                )}
                {tab === 'master' && (
                    <MasterSetsPanel ownedCardIds={ownedCardIds} ownedCountBySet={ownedCountBySet} />
                )}
            </div>

            <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
        </div>
    );
}

// ── Overview / valuation tracker ─────────────────────────────────────────────

const TIMEFRAMES = ['1D', '1W', '1M', '1Y'] as const;

function OverviewPanel({
    totalValue,
    profitLoss,
    plPct,
    assetCount,
    setsCount,
    wishlistCount,
    onNavigate,
}: {
    totalValue: number;
    profitLoss: number;
    plPct: number;
    assetCount: number;
    setsCount: number;
    wishlistCount: number;
    onNavigate: (tab: Tab) => void;
}) {
    const { t } = useTranslation();
    const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>('1M');
    const [chartData, setChartData] = useState<{ date: string; price: number }[]>([]);
    const [loadingChart, setLoadingChart] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoadingChart(true);
        fetch(`/api/portfolio/history?range=${timeframe}&t=${Date.now()}`, { cache: 'no-store' })
            .then((r) => r.json())
            .then((result) => {
                if (cancelled) return;
                if (result?.success && Array.isArray(result.data)) {
                    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                    setChartData(
                        result.data.map((p: { date: string; value: number }, i: number) => {
                            const d = new Date(p.date);
                            let label = '';
                            if (timeframe === '1D') label = i % 6 === 0 ? `${d.getHours()}h` : '';
                            else if (timeframe === '1W') label = dayNames[d.getDay()];
                            else if (timeframe === '1M') label = i % 5 === 0 ? `${d.getDate()}` : '';
                            else label = monthNames[d.getMonth()];
                            return { date: label, price: p.value };
                        }),
                    );
                } else {
                    setChartData([]);
                }
            })
            .catch(() => { if (!cancelled) setChartData([]); })
            .finally(() => { if (!cancelled) setLoadingChart(false); });
        return () => { cancelled = true; };
    }, [timeframe]);

    const up = profitLoss >= 0;

    return (
        <div className="space-y-6">
            {/* Value + chart */}
            <div className="bg-[#1e293b]/40 border border-white/5 rounded-2xl p-6">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{t('desktop.collection.totalValue')}</p>
                        <div className="flex items-baseline gap-3">
                            <h2 className="text-4xl font-black text-white">{formatTHB(totalValue)}</h2>
                            <span className={`flex items-center gap-1 text-sm font-bold ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
                                <i className={`fa-solid ${up ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'} text-xs`}></i>
                                {up ? '+' : ''}{plPct.toFixed(1)}%
                            </span>
                        </div>
                        <p className={`text-sm font-bold mt-1 ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {up ? '+' : ''}{formatTHB(profitLoss)} <span className="text-slate-500 font-medium">{t('desktop.collection.unrealizedPl')}</span>
                        </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                        {TIMEFRAMES.map((tf) => (
                            <button
                                key={tf}
                                onClick={() => setTimeframe(tf)}
                                className={`px-3 py-1 rounded-md text-[10px] font-black tracking-widest transition-colors ${
                                    timeframe === tf ? 'bg-brand-cyan text-brand-darker' : 'bg-white/5 text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                {tf}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="h-56 mt-6">
                    {loadingChart ? (
                        <div className="w-full h-full rounded-lg bg-brand-darker/40 animate-pulse" />
                    ) : chartData.length === 0 ? (
                        <div className="w-full h-full flex items-center justify-center text-slate-600 text-sm">
                            {t('desktop.collection.noHistory')}
                        </div>
                    ) : (
                        <PriceChart data={chartData} />
                    )}
                </div>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard icon="fa-layer-group" label={t('desktop.collection.statAssets')} value={assetCount} onClick={() => onNavigate('collection')} />
                <StatCard icon="fa-boxes-stacked" label={t('desktop.collection.statSets')} value={setsCount} onClick={() => onNavigate('master')} />
                <StatCard icon="fa-heart" label={t('desktop.collection.statWishlist')} value={wishlistCount} onClick={() => onNavigate('wishlist')} />
            </div>
        </div>
    );
}

function StatCard({ icon, label, value, onClick }: { icon: string; label: string; value: number; onClick?: () => void }) {
    return (
        <button
            onClick={onClick}
            className="group text-left w-full bg-[#1e293b]/40 border border-white/5 rounded-2xl p-5 flex items-center gap-4 hover:border-brand-cyan/40 hover:bg-[#1e293b]/60 transition-colors"
        >
            <span className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-brand-cyan/10 transition-colors">
                <i className={`fa-solid ${icon} text-slate-400 group-hover:text-brand-cyan transition-colors`}></i>
            </span>
            <div className="min-w-0">
                <p className="text-2xl font-black text-white leading-none">{value}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-1">{label}</p>
            </div>
            <i className="fa-solid fa-chevron-right text-[10px] text-slate-600 ml-auto group-hover:text-brand-cyan group-hover:translate-x-0.5 transition-all"></i>
        </button>
    );
}

// ── Collection grid ──────────────────────────────────────────────────────────

function CollectionPanel({
    items,
    loading,
    onRemove,
}: {
    items: FlatItem[];
    loading: boolean;
    onRemove: (colId: string, itemId: string) => Promise<void>;
}) {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<SortKey>('date_desc');

    const processed = useMemo(() => {
        const q = search.trim().toLowerCase();
        const filtered = items.filter(({ card }) =>
            !q || card.name.toLowerCase().includes(q) || (card.set || '').toLowerCase().includes(q) || (card.number || '').includes(q),
        );
        return filtered.sort((a, b) => {
            switch (sort) {
                case 'name_asc': return a.card.name.localeCompare(b.card.name);
                case 'price_desc': return (b.card.marketPrice || 0) - (a.card.marketPrice || 0);
                case 'price_asc': return (a.card.marketPrice || 0) - (b.card.marketPrice || 0);
                default: return new Date(b.item.addedAt).getTime() - new Date(a.item.addedAt).getTime();
            }
        });
    }, [items, search, sort]);

    const remove = async (colId: string, itemId: string) => {
        if (!confirm(t('desktop.collection.removeConfirm'))) return;
        try {
            await onRemove(colId, itemId);
            showToast(t('desktop.collection.removed'), 'success');
        } catch {
            showToast(t('desktop.collection.removeFailed'), 'error');
        }
    };

    if (loading) return <GridSkeleton />;

    return (
        <div>
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[220px] max-w-md">
                    <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('desktop.collection.searchCards')}
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-11 pr-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-brand-cyan/50 transition-colors"
                    />
                </div>
                <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-brand-cyan/50 [&>option]:bg-brand-dark"
                >
                    <option value="date_desc">{t('desktop.collection.sortRecent')}</option>
                    <option value="name_asc">{t('desktop.collection.sortName')}</option>
                    <option value="price_desc">{t('desktop.sortPriceDesc')}</option>
                    <option value="price_asc">{t('desktop.sortPriceAsc')}</option>
                </select>
                <span className="text-xs text-slate-500 font-bold ml-auto">{processed.length} {t('desktop.browse.cards')}</span>
            </div>

            {processed.length === 0 ? (
                <EmptyState icon="fa-layer-group" text={search ? t('desktop.collection.noMatches') : t('desktop.collection.empty')} />
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 mt-6">
                    {processed.map(({ colId, item, card }) => (
                        <div
                            key={item.id}
                            className="group bg-[#1e293b]/40 border border-white/5 rounded-2xl overflow-hidden hover:border-brand-cyan/40 transition-all relative"
                        >
                            <Link href={`/card/${card.id}`} className="block">
                                <div className="relative aspect-[3/4] bg-brand-darker overflow-hidden">
                                    <Image
                                        src={getThumbnailUrl(card.images?.small || card.imageUrl)}
                                        alt={card.name}
                                        fill
                                        sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 20vw, 40vw"
                                        loading="lazy"
                                        placeholder="blur"
                                        blurDataURL={CARD_BLUR_DATA_URL}
                                        unoptimized={shouldSkipNextOptimization(getThumbnailUrl(card.images?.small || card.imageUrl))}
                                        className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
                                    />
                                    {item.isListing && (
                                        <span className="absolute top-2 left-2 text-[8px] font-black uppercase tracking-widest bg-brand-cyan/90 text-brand-darker px-1.5 py-0.5 rounded">
                                            {t('desktop.collection.listed')}
                                        </span>
                                    )}
                                </div>
                                <div className="p-3">
                                    <h3 className="text-sm font-bold text-white truncate">{card.name}</h3>
                                    <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">
                                        {card.set}{card.number ? ` · #${card.number}` : ''}
                                    </p>
                                    <div className="flex items-center justify-between mt-1.5">
                                        <p className="text-sm font-black text-brand-cyan">{formatTHB(card.marketPrice || 0)}</p>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{item.condition}</span>
                                    </div>
                                </div>
                            </Link>
                            <button
                                onClick={() => remove(colId, item.id)}
                                className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-black/50 backdrop-blur text-slate-400 hover:text-brand-red hover:bg-black/70 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                                aria-label={t('desktop.collection.remove')}
                            >
                                <i className="fa-solid fa-trash-can text-[11px]"></i>
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Wishlist grid ────────────────────────────────────────────────────────────

function WishlistPanel({
    wishlist,
    loading,
    onRemove,
}: {
    wishlist: Card[];
    loading: boolean;
    onRemove: (cardId: string) => Promise<void>;
}) {
    const { t } = useTranslation();
    const { showToast } = useToast();

    const remove = async (cardId: string) => {
        try {
            await onRemove(cardId);
            showToast(t('desktop.collection.wishlistRemoved'), 'success');
        } catch {
            showToast(t('desktop.collection.removeFailed'), 'error');
        }
    };

    if (loading) return <GridSkeleton />;
    if (wishlist.length === 0) return <EmptyState icon="fa-heart" text={t('desktop.collection.wishlistEmpty')} />;

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
            {wishlist.map((card) => (
                <div key={card.id} className="group bg-[#1e293b]/40 border border-white/5 rounded-2xl overflow-hidden hover:border-brand-cyan/40 transition-all relative">
                    <Link href={`/card/${card.id}`} className="block">
                        <div className="relative aspect-[3/4] bg-brand-darker overflow-hidden">
                            <Image
                                src={getThumbnailUrl(card.images?.small || card.imageUrl)}
                                alt={card.name}
                                fill
                                sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 20vw, 40vw"
                                loading="lazy"
                                placeholder="blur"
                                blurDataURL={CARD_BLUR_DATA_URL}
                                unoptimized={shouldSkipNextOptimization(getThumbnailUrl(card.images?.small || card.imageUrl))}
                                className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
                            />
                        </div>
                        <div className="p-3">
                            <h3 className="text-sm font-bold text-white truncate">{card.name}</h3>
                            <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">
                                {card.set}{card.rarity ? ` · ${card.rarity}` : ''}
                            </p>
                            {card.marketPrice > 0 && <p className="text-sm font-black text-brand-cyan mt-1.5">{formatTHB(card.marketPrice)}</p>}
                        </div>
                    </Link>
                    <button
                        onClick={() => remove(card.id)}
                        className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-black/50 backdrop-blur text-brand-red hover:bg-black/70 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                        aria-label={t('desktop.collection.remove')}
                    >
                        <i className="fa-solid fa-heart-circle-minus text-[11px]"></i>
                    </button>
                </div>
            ))}
        </div>
    );
}

// ── Master Sets completion tracker ───────────────────────────────────────────

function MasterSetsPanel({
    ownedCardIds,
    ownedCountBySet,
}: {
    ownedCardIds: Set<string>;
    ownedCountBySet: Map<string, number>;
}) {
    const { t } = useTranslation();
    const [game, setGame] = useState<string>('pokemon');
    const [language, setLanguage] = useState<GameLanguageCode>('en');
    const [sets, setSets] = useState<ApiSet[]>([]);
    const [loadingSets, setLoadingSets] = useState(true);
    const [selectedSet, setSelectedSet] = useState<ApiSet | null>(null);
    const showLang = gameHasMultipleLanguages(game);

    useEffect(() => {
        let cancelled = false;
        setLoadingSets(true);
        setSelectedSet(null);
        pokemonService.fetchSets(language, 1, 300, game).then((res) => {
            if (cancelled) return;
            setSets(res.data);
            setLoadingSets(false);
        });
        return () => { cancelled = true; };
    }, [game, language]);

    if (selectedSet) {
        return (
            <MasterSetDetailView
                set={selectedSet}
                game={game}
                language={language}
                ownedCardIds={ownedCardIds}
                onBack={() => setSelectedSet(null)}
            />
        );
    }

    return (
        <div>
            {/* Game filter */}
            <div className="flex flex-wrap gap-2">
                {GAMES.filter((g) => g.enabled).map((g) => (
                    <button
                        key={g.id}
                        onClick={() => { setGame(g.id); setLanguage(defaultLanguageForGame(g.id)); }}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                            game === g.id ? 'bg-brand-cyan text-brand-darker' : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                        }`}
                    >
                        {g.shortName}
                    </button>
                ))}
            </div>

            {/* Language sub-filter */}
            {showLang && (
                <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 mr-1">{t('desktop.browse.language')}</span>
                    {getGameLanguages(game).map((l) => (
                        <button
                            key={l.code}
                            onClick={() => setLanguage(l.code)}
                            className={`px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${
                                language === l.code ? 'bg-brand-cyan text-brand-darker' : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                            }`}
                        >
                            {l.label}
                        </button>
                    ))}
                </div>
            )}

            {loadingSets ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
                    {Array.from({ length: 9 }).map((_, i) => (
                        <div key={i} className="h-20 rounded-xl bg-white/5 animate-pulse"></div>
                    ))}
                </div>
            ) : sets.length === 0 ? (
                <EmptyState icon="fa-box-open" text={t('desktop.collection.noSets')} />
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
                    {sets.map((s) => {
                        const total = s.total || s.printedTotal || 0;
                        const owned = ownedCountBySet.get(s.id) ?? 0;
                        const pct = total > 0 ? Math.min(100, Math.round((owned / total) * 100)) : 0;
                        return (
                            <button
                                key={s.id}
                                onClick={() => setSelectedSet(s)}
                                className="text-left bg-[#1e293b]/40 border border-white/5 rounded-xl p-3 hover:border-brand-cyan/40 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="w-16 h-10 shrink-0 flex items-center justify-center">
                                        {s.images?.logo ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={s.images.logo} alt="" loading="lazy" className="max-w-full max-h-full object-contain" />
                                        ) : (
                                            <span className="text-[10px] font-black text-slate-600 uppercase">{s.id}</span>
                                        )}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-white truncate">{s.name}</p>
                                        <p className="text-[11px] text-slate-500 font-bold">{owned}/{total} {t('desktop.collection.collected')}</p>
                                    </div>
                                    <span className="text-xs font-black text-brand-cyan shrink-0">{pct}%</span>
                                </div>
                                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden mt-2.5">
                                    <div className="h-full bg-gradient-to-r from-brand-cyan to-brand-green" style={{ width: `${pct}%` }}></div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function MasterSetDetailView({
    set,
    game,
    language,
    ownedCardIds,
    onBack,
}: {
    set: ApiSet;
    game: string;
    language: GameLanguageCode;
    ownedCardIds: Set<string>;
    onBack: () => void;
}) {
    const { t } = useTranslation();
    const [cards, setCards] = useState<Card[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        pokemonService.fetchCardsBySet(set.id, language, game).then((data: Card[]) => {
            if (cancelled) return;
            const sorted = [...data].sort((a, b) => {
                const na = parseInt(a.number.split('/')[0].replace(/[^0-9]/g, ''), 10) || 999999;
                const nb = parseInt(b.number.split('/')[0].replace(/[^0-9]/g, ''), 10) || 999999;
                return na - nb;
            });
            setCards(sorted);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [set.id, language, game]);

    const ownedCount = useMemo(() => cards.filter((c) => ownedCardIds.has(c.id)).length, [cards, ownedCardIds]);
    const pct = cards.length > 0 ? Math.round((ownedCount / cards.length) * 100) : 0;

    return (
        <div>
            <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
                <i className="fa-solid fa-chevron-left text-xs"></i>
                {t('desktop.collection.backToSets')}
            </button>

            <header className="flex items-center gap-4 mt-4">
                {set.images?.logo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={set.images.logo} alt={set.name} className="h-12 w-24 object-contain object-left" />
                )}
                <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-black text-white truncate">{set.name}</h2>
                    <p className="text-sm text-slate-400 mt-0.5">
                        {ownedCount}/{cards.length} {t('desktop.collection.collected')} · <span className="text-brand-cyan font-bold">{pct}%</span>
                    </p>
                </div>
            </header>

            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden mt-4">
                <div className="h-full bg-gradient-to-r from-brand-cyan to-brand-green transition-all duration-700" style={{ width: `${pct}%` }}></div>
            </div>

            {loading ? (
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 mt-8">
                    {Array.from({ length: 16 }).map((_, i) => (
                        <div key={i} className="rounded-xl bg-white/5 animate-pulse aspect-[3/4]"></div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 mt-8">
                    {cards.map((card) => {
                        const owned = ownedCardIds.has(card.id);
                        return (
                            <Link
                                key={card.id}
                                href={`/card/${card.id}`}
                                className={`group relative rounded-xl overflow-hidden border transition-all ${
                                    owned ? 'border-brand-cyan/40' : 'border-white/5'
                                }`}
                                title={card.name}
                            >
                                <div className="relative aspect-[3/4] bg-brand-darker overflow-hidden">
                                    <Image
                                        src={getThumbnailUrl(card.images?.small || card.imageUrl)}
                                        alt={card.name}
                                        fill
                                        sizes="12vw"
                                        loading="lazy"
                                        placeholder="blur"
                                        blurDataURL={CARD_BLUR_DATA_URL}
                                        unoptimized={shouldSkipNextOptimization(getThumbnailUrl(card.images?.small || card.imageUrl))}
                                        className={`object-cover transition-all ${owned ? '' : 'grayscale opacity-30 group-hover:opacity-60'}`}
                                    />
                                    {owned && (
                                        <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-brand-cyan text-brand-darker flex items-center justify-center">
                                            <i className="fa-solid fa-check text-[9px]"></i>
                                        </span>
                                    )}
                                    <span className="absolute bottom-1 left-1 text-[9px] font-black text-white/80 bg-black/50 px-1 rounded">#{card.number}</span>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function GridSkeleton() {
    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="rounded-2xl bg-white/5 animate-pulse aspect-[3/4.7]"></div>
            ))}
        </div>
    );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
    return (
        <div className="text-center py-24">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                <i className={`fa-solid ${icon} text-2xl text-slate-600`}></i>
            </div>
            <p className="text-slate-500 text-sm">{text}</p>
        </div>
    );
}
