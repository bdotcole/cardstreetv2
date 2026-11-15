'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { pokemonService, type ApiSet } from '@/services/pokemonService';
import { getGame } from '@/lib/games';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { setArtUrl } from '@/lib/setArt';
import { printedSetCode } from '@/lib/setCodes';
import { groupSets, type GroupableSet } from '@/lib/setGroups';
import SetTileArt from '@/components/desktop/SetTileArt';

interface SetLink {
    id: string;
    name: string;
}

interface SwitcherProps {
    set: { id: string; name: string; game: string; language: string };
    /** The sets on either side of this one, by release date, in its own game and language. */
    newer: SetLink | null;
    older: SetLink | null;
    /** '' on the Thai canonical, '/en' under the English prefix. */
    pathPrefix?: string;
}

/** A picker row: an /api/sets row plus what the grouping reads. */
interface PickerSet extends GroupableSet {
    name: string;
    code: string | null;
    total: number;
    art: string[];
}

function toPickerSet(s: ApiSet, game: string, language: string): PickerSet {
    return {
        id: s.id,
        name: s.name,
        game,
        language,
        series: s.series,
        release_date: s.releaseDate || null,
        code: printedSetCode({ id: s.id, game, language }),
        total: s.total || s.printedTotal || 0,
        // Row thumbnails: the logo and symbol at thumbnail size, not the originals.
        art: [...new Set([setArtUrl(s.images.logo, 160), s.images.product || '', setArtUrl(s.images.symbol, 160)].filter(Boolean))],
    };
}

/**
 * Moving between sets from a set page: step to the older or newer set, or open
 * the picker and jump to any set of the same game and language.
 *
 * Before this the only way from one set to the next was back to /sets and
 * down the list again. The app has always had a Set dropdown above its card
 * list; this is that dropdown, with the list grouped the way the browser groups
 * it (lib/setGroups.ts).
 *
 * The two arrows are server-rendered links, so crawlers can walk a game set by
 * set. The picker's list is fetched from /api/sets the first time the button
 * is reached for: up to 646 rows that most visits never need, kept out of
 * every set page's HTML and cached at the edge for the visits that do.
 */
export default function DesktopSetSwitcher({ set, newer, older, pathPrefix = '' }: SwitcherProps) {
    const { t, isThai } = useTranslation();
    const [open, setOpen] = useState(false);
    const [sets, setSets] = useState<PickerSet[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [filter, setFilter] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const currentRowRef = useRef<HTMLAnchorElement>(null);
    const requested = useRef(false);

    const load = () => {
        if (requested.current) return;
        requested.current = true;
        // /api/sets takes the app's language codes ('jp'), the catalog 'ja'.
        const apiLanguage = set.language === 'ja' ? 'jp' : (set.language as 'en' | 'th');
        pokemonService
            .fetchSets(apiLanguage, 1, 1000, set.game)
            .then(({ data }) => {
                if (data.length === 0) throw new Error('no sets');
                setSets(data.map((s) => toPickerSet(s, set.game, set.language)));
            })
            .catch(() => {
                // Let the next open try again rather than showing an empty list forever.
                requested.current = false;
                setFailed(true);
            });
    };

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    // Opening lands the keyboard in the filter and the list on the current
    // set. The list is scrolled by hand: scrollIntoView would also scroll the
    // page under the panel.
    useEffect(() => {
        if (!open) return;
        inputRef.current?.focus({ preventScroll: true });
        const list = listRef.current;
        const row = currentRowRef.current;
        if (list && row) {
            const offset = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
            list.scrollTop = offset - (list.clientHeight - row.offsetHeight) / 2;
        }
    }, [open, sets]);

    const groups = useMemo(() => {
        if (!sets) return [];
        const tokens = filter.toLowerCase().split(/\s+/).filter(Boolean);
        const visible = tokens.length
            ? sets.filter((s) => {
                  const haystack = `${s.name} ${s.code ?? ''} ${s.id}`.toLowerCase();
                  return tokens.every((token) => haystack.includes(token));
              })
            : sets;
        return groupSets(visible);
    }, [sets, filter]);

    const toggle = () => {
        load();
        setFailed(false);
        setFilter('');
        setOpen((o) => !o);
    };

    const stepClass =
        'flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white';
    const stepOffClass = 'flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 text-slate-700';

    return (
        <div ref={rootRef} className="relative flex items-center gap-2">
            {older ? (
                <Link href={`${pathPrefix}/sets/${older.id}`} className={stepClass} title={`${t('desktop.browse.olderSet')}: ${older.name}`} aria-label={`${t('desktop.browse.olderSet')}: ${older.name}`}>
                    <i className="fa-solid fa-chevron-left text-xs" aria-hidden="true"></i>
                </Link>
            ) : (
                <span className={stepOffClass} aria-hidden="true">
                    <i className="fa-solid fa-chevron-left text-xs"></i>
                </span>
            )}

            <button
                type="button"
                aria-haspopup="true"
                aria-expanded={open}
                onPointerEnter={load}
                onFocus={load}
                onClick={toggle}
                className={`flex h-10 items-center gap-2.5 rounded-xl border px-4 text-sm font-bold transition-colors ${
                    open ? 'border-brand-cyan/50 bg-brand-cyan/15 text-white' : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10'
                }`}
            >
                <i className="fa-solid fa-layer-group text-xs text-brand-cyan" aria-hidden="true"></i>
                {t('desktop.browse.changeSet')}
                <i className={`fa-solid fa-chevron-down text-[9px] text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true"></i>
            </button>

            {newer ? (
                <Link href={`${pathPrefix}/sets/${newer.id}`} className={stepClass} title={`${t('desktop.browse.newerSet')}: ${newer.name}`} aria-label={`${t('desktop.browse.newerSet')}: ${newer.name}`}>
                    <i className="fa-solid fa-chevron-right text-xs" aria-hidden="true"></i>
                </Link>
            ) : (
                <span className={stepOffClass} aria-hidden="true">
                    <i className="fa-solid fa-chevron-right text-xs"></i>
                </span>
            )}

            {open && (
                <div
                    role="dialog"
                    aria-label={t('desktop.browse.changeSet')}
                    className="absolute left-0 top-full z-40 mt-2 flex max-h-[min(70vh,34rem)] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-brand-darker shadow-2xl md:left-auto md:right-0"
                >
                    <div className="border-b border-white/10 p-3">
                        <div className="relative">
                            <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-500" aria-hidden="true"></i>
                            <input
                                ref={inputRef}
                                type="search"
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                placeholder={t('desktop.browse.searchSets')}
                                aria-label={t('desktop.browse.searchSets')}
                                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-brand-cyan/50"
                            />
                        </div>
                    </div>

                    <div ref={listRef} className="flex-1 overflow-y-auto p-2">
                        {!sets ? (
                            <p className="px-3 py-8 text-center text-sm text-slate-500">
                                {failed ? t('desktop.browse.noSets') : t('desktop.browse.loadingSets')}
                            </p>
                        ) : groups.length === 0 ? (
                            <p className="px-3 py-8 text-center text-sm text-slate-500">{t('desktop.browse.noSets')}</p>
                        ) : (
                            groups.map(({ group, sets: list }) => (
                                <div key={group.key} className="mb-2 last:mb-0">
                                    {groups.length > 1 && (
                                        <p className="px-3 pb-1 pt-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                            {isThai ? group.label.th : group.label.en}
                                        </p>
                                    )}
                                    {list.map((s) => {
                                        const current = s.id === set.id;
                                        return (
                                            <Link
                                                key={s.id}
                                                ref={current ? currentRowRef : undefined}
                                                href={`${pathPrefix}/sets/${s.id}`}
                                                onClick={() => setOpen(false)}
                                                aria-current={current ? 'page' : undefined}
                                                className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${current ? 'bg-brand-cyan/15' : 'hover:bg-white/5'}`}
                                            >
                                                <span className="relative h-9 w-14 shrink-0">
                                                    <SetTileArt id={s.id} game={s.game} series={s.series} code={s.code} art={s.art} compact />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className={`block truncate text-[13px] font-bold ${current ? 'text-white' : 'text-slate-200'}`}>{s.name}</span>
                                                    <span className="block truncate text-[11px] font-bold text-slate-500">
                                                        {[s.code, s.total > 0 ? `${s.total.toLocaleString('en-US')} ${t('desktop.browse.cards')}` : '', (s.release_date || '').slice(0, 4)]
                                                            .filter(Boolean)
                                                            .join(' · ')}
                                                    </span>
                                                </span>
                                                {current && <i className="fa-solid fa-check shrink-0 text-xs text-brand-cyan" aria-hidden="true"></i>}
                                            </Link>
                                        );
                                    })}
                                </div>
                            ))
                        )}
                    </div>

                    <Link
                        href={`${pathPrefix}/sets?game=${set.game}${getGame(set.game).languages.length > 1 ? `&lang=${set.language}` : ''}`}
                        className="flex items-center justify-between border-t border-white/10 px-5 py-3 text-xs font-bold text-brand-cyan transition-colors hover:bg-white/5"
                    >
                        {t('desktop.browse.allSets')}
                        <i className="fa-solid fa-arrow-right text-[10px]" aria-hidden="true"></i>
                    </Link>
                </div>
            )}
        </div>
    );
}
