'use client'

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { getOptimizedImageUrl } from '@/lib/imageUtils';
import { getGame } from '@/lib/games';
import { useTranslation } from '@/lib/hooks/useTranslation';
import type { SetRow } from '@/lib/setPageData';

// Full, localized game names for the "All games" section headings. Chips use
// the compact shortName from lib/games. Riftbound/Lorcana are brand names left
// in English in both locales.
const GAME_LABELS: Record<string, { en: string; th: string }> = {
    pokemon: { en: 'Pokémon', th: 'โปเกมอน' },
    yugioh: { en: 'Yu-Gi-Oh!', th: 'ยูกิโอ' },
    mtg: { en: 'Magic: The Gathering', th: 'เมจิก' },
    onepiece: { en: 'One Piece', th: 'วันพีซ' },
    riftbound: { en: 'Riftbound', th: 'Riftbound' },
    lorcana: { en: 'Disney Lorcana', th: 'Disney Lorcana' },
};

// Display order for game chips + "All games" sections.
const GAME_ORDER = ['pokemon', 'yugioh', 'mtg', 'onepiece', 'riftbound', 'lorcana'];

// DB set.language values ('ja', not the UI 'jp'). Only languages actually
// present in the data get a sub-filter chip, so this stays data-driven.
const LANG_LABELS: Record<string, { en: string; th: string }> = {
    en: { en: 'English', th: 'อังกฤษ' },
    ja: { en: 'Japanese', th: 'ญี่ปุ่น' },
    th: { en: 'Thai', th: 'ไทย' },
};

function gameLabel(game: string, isThai: boolean): string {
    const l = GAME_LABELS[game];
    if (!l) return game;
    return isThai ? l.th : l.en;
}

function orderedGames(present: Set<string>): string[] {
    const known = GAME_ORDER.filter((g) => present.has(g));
    const extra = [...present].filter((g) => !GAME_ORDER.includes(g)).sort();
    return [...known, ...extra];
}

export default function DesktopSetsBrowser({ sets }: { sets: SetRow[] }) {
    const { t, isThai } = useTranslation();
    const [game, setGame] = useState<string>('all');
    const [language, setLanguage] = useState<string>('all');
    const [search, setSearch] = useState('');

    const gamesPresent = useMemo(() => orderedGames(new Set(sets.map((s) => s.game))), [sets]);

    // Languages available for the currently-selected game (only meaningful once
    // a specific game is chosen). Ordered en -> ja -> th.
    const languagesPresent = useMemo(() => {
        if (game === 'all') return [] as string[];
        const langs = new Set(sets.filter((s) => s.game === game).map((s) => s.language));
        return ['en', 'ja', 'th'].filter((l) => langs.has(l));
    }, [sets, game]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return sets.filter((s) => {
            if (game !== 'all' && s.game !== game) return false;
            if (game !== 'all' && language !== 'all' && s.language !== language) return false;
            if (q && !s.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [sets, game, language, search]);

    const grouped = useMemo(() => {
        const byGame = new Map<string, SetRow[]>();
        for (const s of filtered) {
            if (!byGame.has(s.game)) byGame.set(s.game, []);
            byGame.get(s.game)!.push(s);
        }
        return byGame;
    }, [filtered]);

    const selectGame = (g: string) => {
        setGame(g);
        setLanguage('all');
    };

    return (
        <div className="mt-8">
            {/* Game filter */}
            <div className="flex flex-wrap gap-2">
                <FilterChip label={t('desktop.browse.allGames')} active={game === 'all'} onClick={() => selectGame('all')} />
                {gamesPresent.map((g) => (
                    <FilterChip key={g} label={getGame(g).shortName} active={game === g} onClick={() => selectGame(g)} />
                ))}
            </div>

            {/* Language sub-filter — only when the selected game has more than one catalog language */}
            {languagesPresent.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 mr-1">
                        {t('desktop.browse.language')}
                    </span>
                    <FilterChip label={t('desktop.browse.allLanguages')} active={language === 'all'} onClick={() => setLanguage('all')} small />
                    {languagesPresent.map((l) => (
                        <FilterChip
                            key={l}
                            label={isThai ? LANG_LABELS[l]?.th ?? l : LANG_LABELS[l]?.en ?? l}
                            active={language === l}
                            onClick={() => setLanguage(l)}
                            small
                        />
                    ))}
                </div>
            )}

            {/* Set search */}
            <div className="relative max-w-md mt-5">
                <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
                <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('desktop.browse.searchSets')}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-11 pr-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-brand-cyan/50 transition-colors"
                />
            </div>

            {filtered.length === 0 ? (
                <div className="text-center py-24">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                        <i className="fa-solid fa-layer-group text-2xl text-slate-600"></i>
                    </div>
                    <p className="text-slate-500 text-sm">{t('desktop.browse.noSets')}</p>
                </div>
            ) : game === 'all' ? (
                // Grouped by game
                orderedGames(new Set(grouped.keys())).map((g) => {
                    const list = grouped.get(g)!;
                    return (
                        <section key={g} className="mt-10">
                            <h2 className="text-sm font-black text-white uppercase tracking-widest mb-4">
                                {gameLabel(g, isThai)} <span className="text-slate-500">({list.length})</span>
                            </h2>
                            <SetGrid sets={list} isThai={isThai} />
                        </section>
                    );
                })
            ) : (
                <div className="mt-8">
                    <SetGrid sets={filtered} isThai={isThai} />
                </div>
            )}
        </div>
    );
}

function FilterChip({
    label,
    active,
    onClick,
    small,
}: {
    label: string;
    active: boolean;
    onClick: () => void;
    small?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            className={`rounded-full font-bold transition-colors ${small ? 'px-3 py-1 text-[11px]' : 'px-4 py-1.5 text-xs'} ${
                active
                    ? 'bg-brand-cyan text-brand-darker'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
            }`}
        >
            {label}
        </button>
    );
}

function SetGrid({ sets, isThai }: { sets: SetRow[]; isThai: boolean }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {sets.map((s) => {
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
                                {(s.total || s.printed_total || 0)} {isThai ? 'ใบ' : 'cards'}
                                {s.language !== 'en' ? ` · ${s.language.toUpperCase()}` : ''}
                            </span>
                        </span>
                    </Link>
                );
            })}
        </div>
    );
}
