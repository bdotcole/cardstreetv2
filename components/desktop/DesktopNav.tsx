'use client'

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import AuthModal from '@/components/AuthModal';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useBetaFeatures } from '@/lib/hooks/useBetaFeatures';
import { useUserSettings } from '@/lib/contexts/UserSettingsContext';
import { pokemonService } from '@/services/pokemonService';
import { sealedProductToCard } from '@/lib/sealedProduct';
import { getThumbnailUrl } from '@/lib/imageUtils';
import { getGame } from '@/lib/games';
import { Card } from '@/types';

/**
 * The nav's own path, stripped back to the bare route so it can be compared
 * against the unprefixed hrefs in the link table.
 *
 * Rendered paths live under /desktop/* via middleware rewrite, but client-side
 * navigation keeps the clean URL in usePathname, and the English variant keeps
 * its /en prefix in the browser — so all three shapes have to normalize to the
 * same thing or the active-link highlight silently dies on /en.
 */
function normalizePath(pathname: string | null): string {
    return (pathname ?? '/').replace(/^\/desktop/, '').replace(/^\/en(?=\/|$)/, '') || '/';
}

export default function DesktopNav({ pathPrefix = '' }: {
    // '' on the Thai canonical, '/en' under the English prefix. Resolved by the
    // desktop layout (a server component) and passed down as a plain string,
    // because lib/i18nRouting imports next/headers.
    pathPrefix?: string;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const { t, language } = useTranslation();
    // Live Breaks beta: the nav item renders only with the 'live_streams'
    // grant, and the account menu's studio entry only with 'live_broadcast'
    // (both fail closed — invisible to everyone else, matching the /live
    // pages' no-hint posture).
    const { hasBeta } = useBetaFeatures();
    const { updateLanguage } = useUserSettings();
    // Auth state comes from the cart provider — one shared subscription for
    // the whole desktop shell instead of one per component (multiple
    // concurrent getUser() calls were contending on the gotrue auth lock).
    const { items: cartItems, openCart, user } = useDesktopCart();
    const [query, setQuery] = useState('');
    const [authOpen, setAuthOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    // Compact-viewport nav drawer. The desktop link row, language toggle and
    // account cluster collapse into this below lg (the pages under /desktop/*
    // are served to phones too — see middleware.ts).
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [results, setResults] = useState<Card[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Full-catalog search (not just marketplace listings): debounce the query
    // and hit the same client-side catalog search the sell/explore flows use,
    // across every enabled game and language — no game picker, typing a name
    // is enough. Deliberately ignores the UI language: search is universal, so
    // an English-UI user can find Thai/Japanese prints (and vice versa) via
    // cross-language name matching.
    //
    // Singles and sealed products are searched together: "booster box" or an
    // ETB name has to resolve here, not just under the catalog's sealed tab.
    // Sealed rows ride the same Card shape via sealedProductToCard, so one
    // result list renders both, and /card/[id] resolves sealed ids too (see
    // lib/desktopCardData.ts).
    useEffect(() => {
        const q = query.trim();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (q.length < 2) {
            setResults([]);
            setSearchOpen(false);
            setSearching(false);
            return;
        }
        setSearching(true);
        setSearchOpen(true);
        debounceRef.current = setTimeout(async () => {
            try {
                // Independent catalogs — one failing must not blank the other.
                const [cards, sealed] = await Promise.all([
                    pokemonService.searchCards(q, false, undefined, 'all').catch(() => [] as Card[]),
                    pokemonService.fetchSealedProducts({ game: 'all', q }).catch(() => []),
                ]);
                // Reserve room for sealed rather than letting 8 singles crowd
                // them out — a box search is often the whole intent.
                const sealedCards = sealed.slice(0, 3).map(sealedProductToCard);
                setResults([...cards.slice(0, sealedCards.length ? 6 : 8), ...sealedCards]);
            } catch {
                setResults([]);
            } finally {
                setSearching(false);
            }
        }, 250);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query]);

    const goToCard = (id: string) => {
        setSearchOpen(false);
        setQuery('');
        setResults([]);
        router.push(`${pathPrefix}/card/${id}`);
    };

    // Marketplace listings search (the /?q= mode) — dropdown rows deep-link to
    // catalog cards; Enter and the dropdown footer search live listings.
    const goToListings = () => {
        const q = query.trim();
        if (q.length < 2) return;
        setSearchOpen(false);
        setQuery('');
        setResults([]);
        router.push(`${pathPrefix}/?q=${encodeURIComponent(q)}`);
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        goToListings();
    };

    const handleSignOut = async () => {
        setMenuOpen(false);
        await createClient().auth.signOut();
    };

    const toggleLanguage = async () => {
        const next = language === 'TH' ? 'EN' : 'TH';
        await updateLanguage(next);
        // Client chrome re-renders instantly via useTranslation; refresh so the
        // server-rendered desktop pages (/sets, /card, /collection) re-read the
        // updated cs_lang cookie via the x-cs-lang header and flip locale too.
        router.refresh();
    };

    const displayName =
        (user?.user_metadata?.display_name as string) ||
        (user?.user_metadata?.name as string) ||
        user?.email ||
        '';
    const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

    return (
        <header className="sticky top-0 z-50 border-b border-white/5 bg-brand-darker/90 backdrop-blur">
            <div className="max-w-screen-2xl mx-auto px-4 md:px-8 h-16 flex items-center gap-3 md:gap-8">
                <Link href={pathPrefix || '/'} className="flex items-center gap-3 shrink-0">
                    <Image src="/logo.png" alt="CardStreet" width={40} height={40} priority className="object-contain" />
                    <span className="hidden sm:block text-lg font-black text-white tracking-tight">CardStreet</span>
                </Link>

                <div className="flex-1 max-w-xl relative">
                    {searchOpen && (
                        <div className="fixed inset-0 z-40" onClick={() => setSearchOpen(false)}></div>
                    )}
                    <form onSubmit={handleSearch} className="relative z-50">
                        <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onFocus={() => { if (results.length > 0) setSearchOpen(true); }}
                            placeholder={t('desktop.searchPlaceholder')}
                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-11 pr-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-brand-cyan/50 transition-colors"
                        />
                    </form>

                    {searchOpen && (
                        <div className="absolute z-50 left-0 right-0 top-full mt-2 bg-brand-dark border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden max-h-[70vh] overflow-y-auto">
                            {searching && results.length === 0 ? (
                                <div className="px-4 py-6 text-center text-sm text-slate-500">
                                    <i className="fa-solid fa-circle-notch fa-spin mr-2"></i>
                                    {language === 'TH' ? 'กำลังค้นหา…' : 'Searching…'}
                                </div>
                            ) : results.length === 0 ? (
                                <div className="px-4 py-6 text-center text-sm text-slate-500">
                                    {language === 'TH' ? 'ไม่พบผลลัพธ์' : 'No results found'}
                                </div>
                            ) : (
                                results.map((card) => {
                                    const thumb = getThumbnailUrl(card.images?.small || card.imageUrl);
                                    return (
                                        <button
                                            key={card.id}
                                            onClick={() => goToCard(card.id)}
                                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
                                        >
                                            <span className="w-9 h-12 rounded bg-brand-darker overflow-hidden shrink-0 border border-white/10">
                                                {thumb && (
                                                    // Sealed packshots are product renders on their own
                                                    // background — contain them instead of cropping.
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={thumb} alt="" loading="lazy" className={`w-full h-full ${card.isSealed ? 'object-contain' : 'object-cover'}`} />
                                                )}
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block text-sm font-bold text-white truncate">{card.name}</span>
                                                <span className="block text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate">
                                                    {card.game && card.game !== 'pokemon' ? `${getGame(card.game).shortName} · ` : ''}
                                                    {card.set}
                                                    {/* Sealed rows carry a placeholder number ('—') — don't print it as "#—". */}
                                                    {!card.isSealed && card.number ? ` · #${card.number}` : ''}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                            {query.trim().length >= 2 && (
                                <button
                                    onClick={goToListings}
                                    className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-bold text-brand-cyan hover:bg-white/5 border-t border-white/5 transition-colors text-left"
                                >
                                    <i className="fa-solid fa-store text-xs"></i>
                                    <span className="truncate">
                                        {t('desktop.searchListingsFor')} &ldquo;{query.trim()}&rdquo;
                                    </span>
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <nav className="hidden lg:flex items-center gap-6 text-sm font-bold ml-auto shrink-0">
                    {([
                        ['/', t('desktop.navMarketplace')],
                        ...(hasBeta('live_streams') ? [['/live', t('desktop.navLive')]] : []),
                        ['/sets', t('desktop.navSets')],
                        ['/sell', t('desktop.navSell')],
                        ['/orders', t('desktop.navOrders')],
                        ['/premium', t('desktop.navPro')],
                    ] as [string, string][]).map(([href, label]) => {
                        const current = normalizePath(pathname);
                        const active = current === href;
                        return (
                            <Link
                                key={href}
                                href={`${pathPrefix}${href}`}
                                className={`transition-colors ${active ? 'text-brand-cyan' : 'text-white hover:text-brand-cyan'}`}
                            >
                                {label}
                            </Link>
                        );
                    })}
                </nav>

                <button
                    onClick={toggleLanguage}
                    className="hidden lg:flex shrink-0 w-10 h-10 items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 transition-colors group"
                    title={language === 'TH' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
                    aria-label={language === 'TH' ? 'Switch to English' : 'Switch to Thai'}
                >
                    <span className="text-[11px] font-black text-slate-300 group-hover:text-white transition-colors">
                        {language}
                    </span>
                </button>

                <button
                    onClick={openCart}
                    className="relative shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                    aria-label={`Cart, ${cartItems.length} item${cartItems.length === 1 ? '' : 's'}`}
                >
                    <i className="fa-solid fa-cart-shopping text-slate-400"></i>
                    {cartItems.length > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-brand-red text-white text-[9px] font-black rounded-full flex items-center justify-center border border-brand-darker">
                            {cartItems.length}
                        </span>
                    )}
                </button>

                {user ? (
                    <div className="relative shrink-0 hidden lg:block">
                        <button
                            onClick={() => setMenuOpen((open) => !open)}
                            className="flex items-center gap-2.5 bg-white/5 hover:bg-white/10 rounded-xl pl-1.5 pr-3 py-1.5 transition-colors"
                        >
                            <span className="w-7 h-7 rounded-full bg-slate-700 overflow-hidden flex items-center justify-center text-[11px] font-black text-white">
                                {avatarUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    displayName.charAt(0).toUpperCase()
                                )}
                            </span>
                            <span className="text-sm font-bold text-white max-w-[140px] truncate">{displayName}</span>
                            <i className="fa-solid fa-chevron-down text-[10px] text-slate-500"></i>
                        </button>

                        {menuOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)}></div>
                                <div className="absolute right-0 top-full mt-2 w-56 bg-brand-dark border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50">
                                    <Link
                                        href={`${pathPrefix}/collection`}
                                        onClick={() => setMenuOpen(false)}
                                        className="block px-4 py-3 text-sm text-slate-300 hover:bg-white/5 transition-colors"
                                    >
                                        <i className="fa-solid fa-vault mr-2.5 text-slate-500 w-4 text-center"></i>
                                        {t('desktop.navCollection')}
                                    </Link>
                                    {/* Certified breakers only — the feed itself carries no broadcaster entry points. */}
                                    {hasBeta('live_broadcast') && (
                                        <Link
                                            href={`${pathPrefix}/live/studio`}
                                            onClick={() => setMenuOpen(false)}
                                            className="block px-4 py-3 text-sm text-slate-300 hover:bg-white/5 transition-colors"
                                        >
                                            <i className="fa-solid fa-tower-broadcast mr-2.5 text-slate-500 w-4 text-center"></i>
                                            {t('live.myShows.menuTitle')}
                                        </Link>
                                    )}
                                    <Link
                                        href={`${pathPrefix}/settings?tab=profile`}
                                        onClick={() => setMenuOpen(false)}
                                        className="block px-4 py-3 text-sm text-slate-300 hover:bg-white/5 transition-colors"
                                    >
                                        <i className="fa-solid fa-user-pen mr-2.5 text-slate-500 w-4 text-center"></i>
                                        {t('desktop.editProfile')}
                                    </Link>
                                    <Link
                                        href={`${pathPrefix}/settings?tab=preferences`}
                                        onClick={() => setMenuOpen(false)}
                                        className="block px-4 py-3 text-sm text-slate-300 hover:bg-white/5 transition-colors"
                                    >
                                        <i className="fa-solid fa-gear mr-2.5 text-slate-500 w-4 text-center"></i>
                                        {t('desktop.settings.title')}
                                    </Link>
                                    {/* Not locale-prefixed, and a plain anchor: this leaves the
                                        desktop experience entirely and needs a full request so
                                        middleware can set the cs_view cookie. Same call as the
                                        footer's copy of this link. */}
                                    <a
                                        href="/?view=mobile"
                                        className="block px-4 py-3 text-sm text-slate-300 hover:bg-white/5 transition-colors border-t border-white/5"
                                    >
                                        <i className="fa-solid fa-mobile-screen mr-2.5 text-slate-500 w-4 text-center"></i>
                                        {t('desktop.switchToMobile')}
                                    </a>
                                    <button
                                        onClick={handleSignOut}
                                        className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-white/5 transition-colors border-t border-white/5"
                                    >
                                        <i className="fa-solid fa-arrow-right-from-bracket mr-2.5 text-slate-500 w-4 text-center"></i>
                                        {t('desktop.signOut')}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    <button
                        onClick={() => setAuthOpen(true)}
                        className="hidden lg:block shrink-0 bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black px-5 py-2 rounded-xl transition-colors"
                    >
                        {t('desktop.signIn')}
                    </button>
                )}

                <button
                    onClick={() => setMobileNavOpen((open) => !open)}
                    className="lg:hidden shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                    aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
                    aria-expanded={mobileNavOpen}
                >
                    <i className={`fa-solid ${mobileNavOpen ? 'fa-xmark' : 'fa-bars'} text-slate-300`}></i>
                </button>
            </div>

            {mobileNavOpen && (
                <div className="lg:hidden border-t border-white/5 bg-brand-darker/95 backdrop-blur">
                    <nav className="max-w-screen-2xl mx-auto px-4 py-3 flex flex-col text-sm font-bold">
                        {([
                            ['/', t('desktop.navMarketplace')],
                            ...(hasBeta('live_streams') ? [['/live', t('desktop.navLive')]] : []),
                            ['/sets', t('desktop.navSets')],
                            ['/sell', t('desktop.navSell')],
                            ['/orders', t('desktop.navOrders')],
                            ['/premium', t('desktop.navPro')],
                        ] as [string, string][]).map(([href, label]) => {
                            const current = normalizePath(pathname);
                            const active = current === href;
                            return (
                                <Link
                                    key={href}
                                    href={`${pathPrefix}${href}`}
                                    onClick={() => setMobileNavOpen(false)}
                                    className={`py-2.5 transition-colors ${active ? 'text-brand-cyan' : 'text-white hover:text-brand-cyan'}`}
                                >
                                    {label}
                                </Link>
                            );
                        })}
                        {user && (
                            <Link
                                href={`${pathPrefix}/collection`}
                                onClick={() => setMobileNavOpen(false)}
                                className="py-2.5 text-white hover:text-brand-cyan transition-colors"
                            >
                                {t('desktop.navCollection')}
                            </Link>
                        )}
                        {user && hasBeta('live_broadcast') && (
                            <Link
                                href={`${pathPrefix}/live/studio`}
                                onClick={() => setMobileNavOpen(false)}
                                className="py-2.5 text-white hover:text-brand-cyan transition-colors"
                            >
                                {t('live.myShows.menuTitle')}
                            </Link>
                        )}
                        <div className="flex items-center gap-3 pt-3 mt-1 border-t border-white/5">
                            <button
                                onClick={toggleLanguage}
                                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[11px] font-black text-slate-300 transition-colors"
                            >
                                {language === 'TH' ? 'EN' : 'ไทย'}
                            </button>
                            {user ? (
                                <button
                                    onClick={() => { setMobileNavOpen(false); handleSignOut(); }}
                                    className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
                                >
                                    {t('desktop.signOut')}
                                </button>
                            ) : (
                                <button
                                    onClick={() => { setMobileNavOpen(false); setAuthOpen(true); }}
                                    className="px-4 py-2 rounded-xl bg-brand-cyan hover:bg-cyan-400 text-brand-darker font-black transition-colors"
                                >
                                    {t('desktop.signIn')}
                                </button>
                            )}
                        </div>
                    </nav>
                </div>
            )}

            <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
        </header>
    );
}
