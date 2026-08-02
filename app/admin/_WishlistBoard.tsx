'use client'

import { useMemo, useState } from 'react'

export interface WishlistBoardRow {
    cardId: string
    name: string
    setName: string
    number: string
    image: string | null
    rarity: string | null
    types: string[]
    game: string
    language: string
    priceThb: number
    wishers: number
    lastAdded: string
    activeListings: number
}

interface Props {
    rows: WishlistBoardRow[]
    totalWants: number
    uniqueCards: number
    truncated: boolean
}

// Rarity arrives in two conventions for the same tier — Japanese-style codes on
// Thai rows ("SR") and English longhand on English rows ("Ultra rare") — so an
// un-canonicalized dropdown splits one tier across two entries and a theme pick
// silently misses half its cards. Equivalences mirror THAI_RARITY_DISPLAY in
// lib/cardMapper.ts. Values outside this map (One Piece L/SEC, Lorcana
// Legendary) pass through untouched rather than being forced into a shared
// cross-game taxonomy they don't belong to.
const RARITY_CANON: Record<string, string> = {
    'common': 'C',
    'uncommon': 'U',
    'uc': 'U',
    'rare': 'R',
    'double rare': 'RR',
    'ultra rare': 'SR',
    'illustration rare': 'AR',
    'special illustration rare': 'SAR',
    'hyper rare': 'UR',
}

const RARITY_LABEL: Record<string, string> = {
    C: 'Common (C)',
    U: 'Uncommon (U)',
    R: 'Rare (R)',
    RR: 'Double Rare (RR)',
    SR: 'Ultra Rare (SR)',
    AR: 'Illustration Rare (AR)',
    SAR: 'Special Illustration (SAR)',
    UR: 'Hyper Rare (UR)',
    SEC: 'Secret (SEC)',
    L: 'Leader (L)',
}

function canonRarity(raw: string | null | undefined): string | null {
    if (!raw) return null
    const key = raw.toLowerCase().trim()
    return RARITY_CANON[key] ?? raw.trim()
}

const GAME_LABEL: Record<string, string> = {
    pokemon: 'Pokémon',
    onepiece: 'One Piece',
    lorcana: 'Lorcana',
    mtg: 'Magic',
    yugioh: 'Yu-Gi-Oh!',
    riftbound: 'Riftbound',
}

const LANG_LABEL: Record<string, string> = { en: 'English', th: 'Thai', ja: 'Japanese', jp: 'Japanese' }

// Energy-type accents so a themed week ("all Water") reads at a glance.
const TYPE_COLOR: Record<string, string> = {
    Fire: 'bg-orange-500/20 text-orange-300',
    Water: 'bg-blue-500/20 text-blue-300',
    Grass: 'bg-green-500/20 text-green-300',
    Lightning: 'bg-yellow-500/20 text-yellow-300',
    Psychic: 'bg-purple-500/20 text-purple-300',
    Fighting: 'bg-amber-700/30 text-amber-300',
    Darkness: 'bg-slate-600/40 text-slate-300',
    Metal: 'bg-slate-400/20 text-slate-300',
    Dragon: 'bg-indigo-500/20 text-indigo-300',
    Fairy: 'bg-pink-500/20 text-pink-300',
    Colorless: 'bg-white/10 text-slate-300',
}

type SortKey = 'wishers' | 'price' | 'added'

const SELECT_CLASS =
    'bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-brand-cyan/40 [&>option]:bg-brand-darker'

const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export default function WishlistBoard({ rows, totalWants, uniqueCards, truncated }: Props) {
    const [search, setSearch] = useState('')
    const [game, setGame] = useState('all')
    const [language, setLanguage] = useState('all')
    const [set, setSet] = useState('all')
    const [rarity, setRarity] = useState('all')
    const [type, setType] = useState('all')
    const [unlistedOnly, setUnlistedOnly] = useState(false)
    const [sortKey, setSortKey] = useState<SortKey>('wishers')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

    // Canonicalize once here rather than server-side: a 'use client' module's
    // exports become client references when imported by a server component, so
    // the mapping has to live on this side of the boundary.
    const normalized = useMemo(
        () => rows.map((r) => ({ ...r, rarity: canonRarity(r.rarity) })),
        [rows],
    )

    // Option lists come from the full row set, not the filtered view, so the
    // dropdowns don't reshuffle underneath the admin mid-selection.
    const facets = useMemo(() => {
        const uniq = (vals: (string | null | undefined)[]) =>
            [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b))
        return {
            games: uniq(normalized.map((r) => r.game)),
            languages: uniq(normalized.map((r) => r.language)),
            sets: uniq(normalized.map((r) => r.setName)),
            rarities: uniq(normalized.map((r) => r.rarity)),
            types: uniq(normalized.flatMap((r) => r.types)),
        }
    }, [normalized])

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase()
        const filtered = normalized.filter((r) => {
            if (q && !r.name.toLowerCase().includes(q) && !r.cardId.toLowerCase().includes(q)) return false
            if (game !== 'all' && r.game !== game) return false
            if (language !== 'all' && r.language !== language) return false
            if (set !== 'all' && r.setName !== set) return false
            if (rarity !== 'all' && r.rarity !== rarity) return false
            if (type !== 'all' && !r.types.includes(type)) return false
            if (unlistedOnly && r.activeListings > 0) return false
            return true
        })
        const mul = sortDir === 'desc' ? -1 : 1
        return filtered.sort((a, b) => {
            const primary =
                sortKey === 'price'
                    ? a.priceThb - b.priceThb
                    : sortKey === 'added'
                        ? (Date.parse(a.lastAdded) || 0) - (Date.parse(b.lastAdded) || 0)
                        : a.wishers - b.wishers
            // Wishers breaks price/date ties so the buy-list intent still ranks.
            return primary * mul || (a.wishers - b.wishers) * -1 || a.name.localeCompare(b.name)
        })
    }, [normalized, search, game, language, set, rarity, type, unlistedOnly, sortKey, sortDir])

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
        else {
            setSortKey(key)
            setSortDir('desc')
        }
    }

    const filtersActive =
        !!search || game !== 'all' || language !== 'all' || set !== 'all' || rarity !== 'all' || type !== 'all' || unlistedOnly

    const clearAll = () => {
        setSearch(''); setGame('all'); setLanguage('all'); setSet('all')
        setRarity('all'); setType('all'); setUnlistedOnly(false)
    }

    const unlistedCount = visible.filter((r) => r.activeListings === 0).length

    const SortHeader = ({ label, k, className = '' }: { label: string; k: SortKey; className?: string }) => (
        <th className={`px-4 py-3 ${className}`}>
            <button
                type="button"
                onClick={() => toggleSort(k)}
                className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest transition-colors ${sortKey === k ? 'text-brand-cyan' : 'text-slate-500 hover:text-slate-300'}`}
            >
                {label}
                <span className={sortKey === k ? 'opacity-100' : 'opacity-0'}>{sortDir === 'desc' ? '↓' : '↑'}</span>
            </button>
        </th>
    )

    return (
        <div className="glass rounded-2xl border border-white/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="font-black text-white text-sm uppercase tracking-wide italic">Most Wishlisted</h2>
                    <p className="text-[10px] text-slate-500 font-semibold mt-0.5">
                        Source list for the weekly Buy List post · {uniqueCards.toLocaleString()} cards · {totalWants.toLocaleString()} wants
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                        {visible.length.toLocaleString()} shown · {unlistedCount.toLocaleString()} unlisted
                    </span>
                    {filtersActive && (
                        <button
                            type="button"
                            onClick={clearAll}
                            className="px-3 py-1.5 bg-white/5 text-slate-400 font-bold text-[10px] uppercase tracking-widest rounded-lg hover:bg-white/10 transition"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            <div className="px-6 py-3 border-b border-white/5 flex flex-wrap gap-2">
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search card name…"
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan/50 w-48"
                />
                <select value={game} onChange={(e) => setGame(e.target.value)} className={SELECT_CLASS}>
                    <option value="all">All games</option>
                    {facets.games.map((g) => <option key={g} value={g}>{GAME_LABEL[g] ?? g}</option>)}
                </select>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className={SELECT_CLASS}>
                    <option value="all">All languages</option>
                    {facets.languages.map((l) => <option key={l} value={l}>{LANG_LABEL[l] ?? l}</option>)}
                </select>
                <select value={set} onChange={(e) => setSet(e.target.value)} className={`${SELECT_CLASS} max-w-[220px]`}>
                    <option value="all">All sets</option>
                    {facets.sets.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={rarity} onChange={(e) => setRarity(e.target.value)} className={SELECT_CLASS}>
                    <option value="all">All rarities</option>
                    {facets.rarities.map((r) => <option key={r} value={r}>{RARITY_LABEL[r] ?? r}</option>)}
                </select>
                <select value={type} onChange={(e) => setType(e.target.value)} className={SELECT_CLASS}>
                    <option value="all">All types</option>
                    {facets.types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button
                    type="button"
                    onClick={() => setUnlistedOnly((v) => !v)}
                    className={`px-3 py-2 rounded-xl text-sm font-bold transition ${unlistedOnly ? 'bg-brand-red/20 text-brand-red border border-brand-red/40' : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'}`}
                >
                    Unlisted only
                </button>
            </div>

            {truncated && (
                <p className="px-6 py-2 text-[10px] text-yellow-400/80 font-semibold border-b border-white/5">
                    Showing the top {rows.length.toLocaleString()} cards by wisher count; the long tail is not loaded.
                </p>
            )}

            {visible.length === 0 ? (
                <p className="px-6 py-10 text-center text-slate-500 text-sm">
                    {rows.length === 0 ? 'No wishlist cards yet' : 'No cards match these filters'}
                </p>
            ) : (
                <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                    <table className="w-full text-left">
                        <thead className="sticky top-0 bg-brand-darker/95 backdrop-blur z-10">
                            <tr className="border-b border-white/5">
                                <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">#</th>
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Card</th>
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Rarity</th>
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Type</th>
                                <SortHeader label="Price" k="price" className="text-right" />
                                <SortHeader label="Wishers" k="wishers" className="text-right" />
                                <SortHeader label="Added" k="added" className="text-right" />
                                <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Listings</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {visible.map((r, i) => (
                                <tr key={r.cardId} className="hover:bg-white/5 transition-colors">
                                    <td className="px-6 py-3 text-sm font-black text-slate-600">{i + 1}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            {r.image && <img src={r.image} alt="" className="w-8 h-11 object-contain rounded shrink-0" />}
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-slate-200 truncate max-w-[260px]">{r.name}</p>
                                                <p className="text-[10px] text-slate-500 truncate max-w-[260px]">
                                                    {[r.setName, r.number ? `#${r.number}` : null].filter(Boolean).join(' · ')}
                                                </p>
                                                <p className="text-[9px] text-slate-600 uppercase tracking-wide font-bold">
                                                    {GAME_LABEL[r.game] ?? r.game} · {LANG_LABEL[r.language] ?? r.language}
                                                </p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        {r.rarity && (
                                            <span className="inline-block text-[9px] font-black uppercase px-2 py-1 rounded-full bg-white/10 text-slate-300 whitespace-nowrap">
                                                {r.rarity}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            {r.types.map((t) => (
                                                <span key={t} className={`inline-block text-[9px] font-black uppercase px-2 py-1 rounded-full whitespace-nowrap ${TYPE_COLOR[t] ?? 'bg-white/10 text-slate-300'}`}>
                                                    {t}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm font-black text-slate-200 text-right whitespace-nowrap">
                                        {r.priceThb > 0 ? `฿${r.priceThb.toLocaleString()}` : <span className="text-slate-600">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-sm font-black text-brand-cyan text-right">{r.wishers}</td>
                                    <td className="px-4 py-3 text-[11px] text-slate-500 text-right whitespace-nowrap">{shortDate(r.lastAdded)}</td>
                                    <td className="px-6 py-3 text-right">
                                        <span className={`inline-block text-[9px] font-black uppercase px-2 py-1 rounded-full whitespace-nowrap ${r.activeListings > 0 ? 'bg-brand-green/20 text-brand-green' : 'bg-brand-red/20 text-brand-red'}`}>
                                            {r.activeListings > 0 ? `${r.activeListings} listed` : 'none'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
