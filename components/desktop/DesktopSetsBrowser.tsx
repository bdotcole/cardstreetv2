'use client'

import React, { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getGame, getGameLabel } from '@/lib/games';
import { useTranslation } from '@/lib/hooks/useTranslation';
import {
    groupSets,
    normalizeSetLanguage,
    setGroupFor,
    SET_LANGUAGE_LABELS,
    SET_LANGUAGE_ORDER,
    type BrowserSet,
} from '@/lib/setGroups';
import SetTileArt from '@/components/desktop/SetTileArt';

// Tab order. A game missing from this list still shows, after the known ones.
const GAME_ORDER = ['pokemon', 'yugioh', 'mtg', 'onepiece', 'riftbound', 'lorcana'];

// A game this small in one language (Lorcana, Riftbound) is a single grid:
// sections and a jump list would be more chrome than content.
const FLAT_BELOW = 25;

// Typing one letter matches most of the catalog; the first screenful is enough
// to tell the visitor to keep typing.
const MAX_RESULTS = 120;

/** One game's sets in one language: what the page shows at a time. */
interface Shelf {
    key: string;
    game: string;
    language: string;
    sets: BrowserSet[];
}

function buildShelves(sets: BrowserSet[]): Shelf[] {
    const byKey = new Map<string, Shelf>();
    for (const s of sets) {
        const key = `${s.game}:${s.language}`;
        const shelf = byKey.get(key);
        if (shelf) shelf.sets.push(s);
        else byKey.set(key, { key, game: s.game, language: s.language, sets: [s] });
    }
    const rank = (list: string[], v: string) => (list.indexOf(v) === -1 ? list.length : list.indexOf(v));
    return [...byKey.values()].sort(
        (a, b) =>
            rank(GAME_ORDER, a.game) - rank(GAME_ORDER, b.game) ||
            a.game.localeCompare(b.game) ||
            rank(SET_LANGUAGE_ORDER, a.language) - rank(SET_LANGUAGE_ORDER, b.language),
    );
}

const sectionId = (key: string) => `sets-${key}`;

// Counts are formatted with a fixed locale ('en-US') throughout this file: the
// page is server-rendered, and a browser that groups thousands differently
// (1.082 in German) would hydrate to text the server did not send.

// getGame() answers an unknown id with the first game, so check it matched.
const gameTabLabel = (id: string) => (getGame(id).id === id ? getGame(id).shortName : id);

/**
 * The set database: pick a game, pick a language, browse that game's sets by
 * era (or product line, or year: lib/setGroups.ts). The same three steps as the
 * app's Game / Language / Set pickers, laid out for a wide screen.
 *
 * The choice lives in the URL (/sets?game=onepiece&lang=ja) so it survives a
 * trip into a set and back, and so a set page can link to "all Japanese One
 * Piece sets". It is written with replaceState: switching tabs is not a
 * navigation, and Back should leave the page, not replay the tabs.
 *
 * pathPrefix is '' on the Thai canonical and '/en' under the English prefix. It
 * arrives as a plain string from the server page: lib/i18nRouting imports
 * next/headers, so a client component cannot call localePrefix() itself.
 */
export default function DesktopSetsBrowser({
    sets,
    pathPrefix = '',
    today,
    newSince,
}: {
    sets: BrowserSet[];
    pathPrefix?: string;
    /** YYYY-MM-DD, from the server so the first client render agrees with it. */
    today: string;
    /** Sets released on or after this day carry the "New" badge. */
    newSince: string;
}) {
    const { t, isThai } = useTranslation();
    const params = useSearchParams();
    const [query, setQuery] = useState('');
    const deferredQuery = useDeferredValue(query);
    const topRef = useRef<HTMLDivElement>(null);

    const shelves = useMemo(() => buildShelves(sets), [sets]);
    const games = useMemo(() => [...new Set(shelves.map((s) => s.game))], [shelves]);
    const languagesOf = (g: string) => shelves.filter((s) => s.game === g).map((s) => s.language);

    // A Thai-language visitor opens on the Thai prints where a game has them,
    // the same default the app's database picker applies.
    const defaultLanguage = (g: string, keep?: string) => {
        const langs = languagesOf(g);
        if (keep && langs.includes(keep)) return keep;
        if (isThai && langs.includes('th')) return 'th';
        return langs[0] ?? 'en';
    };

    const requestedGame = params?.get('game') || '';
    const game = games.includes(requestedGame) ? requestedGame : games[0] ?? 'pokemon';
    const language = defaultLanguage(game, normalizeSetLanguage(params?.get('lang')));
    const active = shelves.find((s) => s.game === game && s.language === language) ?? null;

    const select = (g: string, l: string) => {
        const next = new URLSearchParams({ game: g });
        if (languagesOf(g).length > 1) next.set('lang', l);
        window.history.replaceState(null, '', `${window.location.pathname}?${next}`);
        // The tabs are sticky, so a switch can happen far down a long list;
        // the new list starts from its top rather than wherever the old one was.
        const top = topRef.current;
        if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' });
    };

    const searching = deferredQuery.trim().length > 0;

    return (
        <div className="mt-6">
            <div className="relative max-w-xl">
                <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm" aria-hidden="true"></i>
                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('desktop.browse.searchAllSets')}
                    aria-label={t('desktop.browse.searchAllSets')}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-11 pr-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-brand-cyan/50 transition-colors"
                />
            </div>

            <div ref={topRef} className="scroll-mt-[calc(4rem+var(--sat))]"></div>

            {searching ? (
                <SearchResults
                    sets={sets}
                    query={deferredQuery}
                    games={games}
                    pathPrefix={pathPrefix}
                    today={today}
                    newSince={newSince}
                />
            ) : (
                <>
                    {/* Game and language are navigation, not filters: they decide
                        which catalog the page is showing. Same tab + segmented
                        control vocabulary as the marketplace toolbar. Sticky from
                        the desktop breakpoint up, where the header leaves room. */}
                    <div className="mt-4 flex flex-wrap items-center gap-x-5 border-b border-white/10 bg-brand-darker lg:sticky lg:top-[calc(4rem+var(--sat))] lg:z-30">
                        <nav className="-mb-px flex overflow-x-auto scrollbar-hide" aria-label={t('marketplace.game')}>
                            {games.map((g) => (
                                <button
                                    key={g}
                                    type="button"
                                    aria-pressed={g === game}
                                    onClick={() => select(g, defaultLanguage(g, language))}
                                    className={`relative shrink-0 whitespace-nowrap px-3 py-3 text-sm font-bold transition-colors ${
                                        g === game ? 'text-white' : 'text-slate-400 hover:text-white'
                                    }`}
                                >
                                    {gameTabLabel(g)}
                                    {g === game && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand-cyan" aria-hidden="true"></span>}
                                </button>
                            ))}
                        </nav>

                        {languagesOf(game).length > 1 && (
                            <div
                                className="my-1.5 ml-auto flex gap-1 rounded-full border border-white/10 bg-white/5 p-1"
                                role="group"
                                aria-label={t('desktop.browse.language')}
                            >
                                {languagesOf(game).map((l) => {
                                    const label = SET_LANGUAGE_LABELS[l];
                                    return (
                                        <button
                                            key={l}
                                            type="button"
                                            aria-pressed={l === language}
                                            onClick={() => select(game, l)}
                                            className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition-colors ${
                                                l === language ? 'bg-brand-cyan text-brand-darker' : 'text-slate-300 hover:text-white'
                                            }`}
                                        >
                                            {label && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={label.flag} alt="" className="h-3 w-[18px] rounded-[2px] object-cover" />
                                            )}
                                            {label ? (isThai ? label.th : label.en) : l.toUpperCase()}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {active && (
                        <ShelfView
                            // Remount per shelf: the jump list's scroll-spy
                            // starts over with the new sections.
                            key={active.key}
                            shelf={active}
                            pathPrefix={pathPrefix}
                            today={today}
                            newSince={newSince}
                        />
                    )}
                </>
            )}

            <SetDirectory shelves={shelves} skipKey={searching ? null : active?.key ?? null} pathPrefix={pathPrefix} isThai={isThai} />
        </div>
    );
}

/** One game in one language: the jump list and its sections of tiles. */
function ShelfView({ shelf, pathPrefix, today, newSince }: { shelf: Shelf; pathPrefix: string; today: string; newSince: string }) {
    const { t, isThai } = useTranslation();
    const groups = useMemo(() => groupSets(shelf.sets), [shelf.sets]);
    const flat = shelf.sets.length < FLAT_BELOW || groups.length < 2;
    const keys = useMemo(() => groups.map((g) => g.group.key), [groups]);
    const current = useCurrentSection(flat ? [] : keys);

    const heading = `${getGameLabel(shelf.game, isThai ? 'th' : 'en')} · ${shelf.sets.length.toLocaleString('en-US')} ${t('desktop.browse.sets')}`;

    if (flat) {
        return (
            <section className="mt-6" aria-label={heading}>
                <p className="mb-4 text-xs font-bold text-slate-500">{heading}</p>
                <TileGrid sets={shelf.sets} pathPrefix={pathPrefix} today={today} newSince={newSince} wide />
            </section>
        );
    }

    const jumpTo = (key: string) => {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        document.getElementById(sectionId(key))?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    };

    return (
        <div className="mt-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
            {/* Jump list. A sticky column on desktop; a row of chips that scrolls
                sideways on a phone, where a second column has no room. */}
            <nav aria-label={t('desktop.browse.jumpTo')} className="mb-5 lg:mb-0">
                <div className="lg:sticky lg:top-[calc(8rem+var(--sat))] lg:max-h-[calc(100vh-9.5rem)] lg:overflow-y-auto lg:pr-1">
                    <p className="hidden lg:block mb-2 px-3 text-[10px] font-black uppercase tracking-widest text-slate-500">{heading}</p>
                    <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-hide lg:mx-0 lg:block lg:space-y-0.5 lg:px-0">
                        {groups.map(({ group, sets }) => {
                            const on = group.key === current;
                            return (
                                <li key={group.key} className="shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => jumpTo(group.key)}
                                        aria-current={on ? 'true' : undefined}
                                        className={`flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-left text-xs font-bold transition-colors lg:rounded-lg lg:border-0 lg:px-3 lg:py-2 lg:text-[13px] ${
                                            on
                                                ? 'border-brand-cyan/50 bg-brand-cyan/15 text-white lg:bg-white/10'
                                                : 'border-white/10 bg-white/5 text-slate-300 hover:text-white lg:bg-transparent lg:text-slate-400 lg:hover:bg-white/5'
                                        }`}
                                    >
                                        <span className="lg:truncate">{isThai ? group.label.th : group.label.en}</span>
                                        <span className={`text-[11px] font-bold tabular-nums ${on ? 'text-brand-cyan' : 'text-slate-500'}`}>{sets.length}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </nav>

            <div className="min-w-0 space-y-10">
                {groups.map(({ group, sets }) => (
                    <section
                        key={group.key}
                        id={sectionId(group.key)}
                        data-group={group.key}
                        className="scroll-mt-[calc(5rem+var(--sat))] lg:scroll-mt-[calc(8rem+var(--sat))]"
                    >
                        <SectionHeading label={isThai ? group.label.th : group.label.en} count={sets.length} />
                        <TileGrid sets={sets} pathPrefix={pathPrefix} today={today} newSince={newSince} />
                    </section>
                ))}
            </div>
        </div>
    );
}

/**
 * Which section the reader is in, for the jump list's highlight: the first one
 * crossing a band below the sticky chrome.
 */
function useCurrentSection(keys: string[]): string {
    const [current, setCurrent] = useState(keys[0] ?? '');
    const signature = keys.join('|');

    useEffect(() => {
        const order = signature ? signature.split('|') : [];
        const sections = order.map((k) => document.getElementById(sectionId(k))).filter((el): el is HTMLElement => Boolean(el));
        if (sections.length === 0 || typeof IntersectionObserver === 'undefined') return;

        const inBand = new Set<string>();
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const key = (entry.target as HTMLElement).dataset.group || '';
                    if (entry.isIntersecting) inBand.add(key);
                    else inBand.delete(key);
                }
                const first = order.find((k) => inBand.has(k));
                if (first) setCurrent(first);
            },
            { rootMargin: '-136px 0px -55% 0px' },
        );
        sections.forEach((el) => observer.observe(el));
        return () => observer.disconnect();
    }, [signature]);

    return current;
}

function SectionHeading({ label, count }: { label: string; count: number }) {
    const { t } = useTranslation();
    return (
        <div className="mb-4 flex items-baseline gap-3">
            <h2 className="text-lg font-black text-white">{label}</h2>
            <span className="text-xs font-bold text-slate-500">
                {count.toLocaleString('en-US')} {t('desktop.browse.sets')}
            </span>
            <span className="h-px flex-1 self-center bg-white/10" aria-hidden="true"></span>
        </div>
    );
}

/** Every game and language at once, for a typed query. */
function SearchResults({
    sets,
    query,
    games,
    pathPrefix,
    today,
    newSince,
}: {
    sets: BrowserSet[];
    query: string;
    games: string[];
    pathPrefix: string;
    today: string;
    newSince: string;
}) {
    const { t, isThai } = useTranslation();

    // What a set can be found by: its name, the code printed on its cards, its
    // catalog id, and the section it sits in ("sword & shield", "starter decks").
    const haystacks = useMemo(
        () =>
            sets.map((s) => {
                const group = setGroupFor(s).label;
                return `${s.name} ${s.code ?? ''} ${s.id} ${group.en} ${group.th}`.toLowerCase();
            }),
        [sets],
    );

    const matches = useMemo(() => {
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
        return sets.filter((_, i) => tokens.every((token) => haystacks[i].includes(token)));
    }, [sets, haystacks, query]);

    if (matches.length === 0) {
        return (
            <div className="py-24 text-center">
                <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
                    <i className="fa-solid fa-layer-group text-2xl text-slate-600" aria-hidden="true"></i>
                </div>
                <p className="text-sm text-slate-500">{t('desktop.browse.noSets')}</p>
            </div>
        );
    }

    const shown = matches.slice(0, MAX_RESULTS);
    return (
        <div className="mt-6 space-y-10">
            <p className="text-xs font-bold text-slate-500" role="status">
                {matches.length.toLocaleString('en-US')} {t('desktop.browse.setsFound')}
                {matches.length > shown.length && ` · ${t('desktop.browse.keepTyping')}`}
            </p>
            {games.map((g) => {
                const list = shown.filter((s) => s.game === g);
                if (list.length === 0) return null;
                return (
                    <section key={g}>
                        <SectionHeading label={getGameLabel(g, isThai ? 'th' : 'en')} count={matches.filter((s) => s.game === g).length} />
                        <TileGrid sets={list} pathPrefix={pathPrefix} today={today} newSince={newSince} showLanguage wide />
                    </section>
                );
            })}
        </div>
    );
}

function TileGrid({
    sets,
    pathPrefix,
    today,
    newSince,
    showLanguage,
    wide,
}: {
    sets: BrowserSet[];
    pathPrefix: string;
    today: string;
    newSince: string;
    /** Search results mix languages, so each tile says which it is. */
    showLanguage?: boolean;
    /** No jump list beside the grid, so it can take one more column. */
    wide?: boolean;
}) {
    // Thai sets are drawn as their booster pack, not a wordmark: upright art
    // that a wordmark-height box shrinks to a thumbnail. A Thai shelf gets a
    // taller picture; mixed search results keep one height so rows line up.
    const tall = !showLanguage && sets.length > 0 && sets.every((s) => s.language === 'th');
    return (
        <div
            className={`grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 ${
                wide ? 'lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7' : 'xl:grid-cols-5 2xl:grid-cols-6'
            }`}
        >
            {sets.map((s) => (
                <SetTile key={s.id} set={s} pathPrefix={pathPrefix} today={today} newSince={newSince} showLanguage={showLanguage} tall={tall} />
            ))}
        </div>
    );
}

const SetTile = memo(function SetTile({
    set,
    pathPrefix,
    today,
    newSince,
    showLanguage,
    tall,
}: {
    set: BrowserSet;
    pathPrefix: string;
    today: string;
    newSince: string;
    showLanguage?: boolean;
    tall?: boolean;
}) {
    const { t, isThai } = useTranslation();
    const date = set.release_date || '';
    const upcoming = date > today;
    const fresh = !upcoming && date >= newSince;
    const language = showLanguage ? SET_LANGUAGE_LABELS[set.language] : undefined;

    return (
        <Link
            href={`${pathPrefix}/sets/${set.id}`}
            className="group flex flex-col overflow-hidden rounded-2xl border border-white/5 bg-slate-800/40 transition-all hover:-translate-y-0.5 hover:border-brand-cyan/40 hover:shadow-xl hover:shadow-black/30"
        >
            <span className={`relative block bg-white/[0.03] ${tall ? 'h-40' : 'h-28'}`}>
                <span className={`absolute transition-transform duration-300 group-hover:scale-105 ${tall ? 'inset-2' : 'inset-3'}`}>
                    <SetTileArt id={set.id} game={set.game} series={set.series} code={set.code} art={set.art} />
                </span>
                {(upcoming || fresh) && (
                    <span
                        className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                            upcoming ? 'bg-white/10 text-slate-200' : 'bg-brand-cyan text-brand-darker'
                        }`}
                    >
                        {upcoming ? t('desktop.browse.upcoming') : t('desktop.browse.new')}
                    </span>
                )}
            </span>
            <span className="flex flex-1 flex-col px-3 pb-3 pt-2.5">
                <span className="line-clamp-2 text-[13px] font-bold leading-snug text-white">{set.name}</span>
                <span className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-2 text-[11px] font-bold text-slate-500">
                    {set.code && <span className="rounded bg-white/5 px-1.5 py-px text-[10px] text-slate-300">{set.code}</span>}
                    {language && (
                        <span className="inline-flex items-center gap-1 text-slate-400">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={language.flag} alt="" className="h-2.5 w-[15px] rounded-[2px] object-cover" />
                            {isThai ? language.th : language.en}
                        </span>
                    )}
                    {set.total > 0 && (
                        <span>
                            {set.total.toLocaleString('en-US')} {t('desktop.browse.cards')}
                        </span>
                    )}
                    {date && <span>· {date.slice(0, 4)}</span>}
                </span>
            </span>
        </Link>
    );
});

/**
 * Plain links to every set the page is not currently showing.
 *
 * /sets is the hub the whole catalog is linked from, and it is served to
 * crawlers that never click a tab. Showing one game at a time must not cost
 * the other 1,300 set pages their link, so the tabs that are not open are in
 * the document as link lists (the same sets the visitor gets by opening that
 * tab) and only the open one carries tiles and artwork. Plain <a>, not <Link>:
 * nothing here can be clicked, and 1,300 <Link>s each register a viewport
 * observer for prefetching.
 */
const SetDirectory = memo(function SetDirectory({
    shelves,
    skipKey,
    pathPrefix,
    isThai,
}: {
    shelves: Shelf[];
    skipKey: string | null;
    pathPrefix: string;
    isThai: boolean;
}) {
    return (
        <>
            {shelves
                .filter((shelf) => shelf.key !== skipKey)
                .map((shelf) => {
                    const language = SET_LANGUAGE_LABELS[shelf.language];
                    const languageName = language ? (isThai ? language.th : language.en) : shelf.language;
                    return (
                        <nav key={shelf.key} hidden>
                            <h2>
                                {getGameLabel(shelf.game, isThai ? 'th' : 'en')} ({languageName})
                            </h2>
                            <ul>
                                {shelf.sets.map((s) => (
                                    <li key={s.id}>
                                        <a href={`${pathPrefix}/sets/${s.id}`}>{s.name}</a>
                                    </li>
                                ))}
                            </ul>
                        </nav>
                    );
                })}
        </>
    );
});

