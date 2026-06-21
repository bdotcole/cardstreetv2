'use client'

import { createClient } from '@/lib/supabase/client'
import { GAMES, getGameLanguages, defaultLanguageForGame, type GameId, type GameLanguageCode } from '@/lib/games'
import { dbLanguage } from '@/lib/catalogFields'
import { getThumbnailUrl } from '@/lib/imageUtils'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

interface SetRow {
    id: string
    name: string
    series: string | null
    release_date: string | null
    printed_total: number | null
    total: number | null
    logo_url: string | null
    symbol_url: string | null
    language: string | null
    game: string | null
}

const inputClass =
    'w-full bg-[#0a0d12] border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-brand-cyan text-sm'
const labelClass = 'block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1'

export default function CatalogHomePage() {
    const supabase = useMemo(() => createClient(), [])

    const enabledGames = useMemo(() => GAMES.filter((g) => g.enabled), [])
    const [game, setGame] = useState<GameId>('pokemon')
    const [language, setLanguage] = useState<GameLanguageCode>('en')

    const [sets, setSets] = useState<SetRow[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [showCreate, setShowCreate] = useState(false)

    const languages = getGameLanguages(game)

    // Reset the language to the game's default whenever the game changes.
    useEffect(() => {
        setLanguage(defaultLanguageForGame(game))
    }, [game])

    const loadSets = useCallback(async () => {
        setLoading(true)
        const { data } = await supabase
            .from('pokemon_sets')
            .select('id, name, series, release_date, printed_total, total, logo_url, symbol_url, language, game')
            .eq('game', game)
            .eq('language', dbLanguage(language))
            .order('release_date', { ascending: false, nullsFirst: false })
            .order('id', { ascending: false })
        setSets((data as SetRow[]) || [])
        setLoading(false)
    }, [supabase, game, language])

    useEffect(() => {
        loadSets()
    }, [loadSets])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return sets
        return sets.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.id.toLowerCase().includes(q) ||
                (s.series ?? '').toLowerCase().includes(q),
        )
    }, [sets, search])

    return (
        <div className="space-y-6 animate-fadeIn pb-24">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">Catalog</h1>
                    <p className="text-slate-400 text-sm mt-1">Create sets and add cards with images, no scripts required.</p>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="bg-brand-cyan text-black px-5 py-2.5 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-white transition-colors flex items-center justify-center"
                >
                    <i className="fa-solid fa-folder-plus mr-2" /> Create Set
                </button>
            </div>

            {/* Game + language pickers */}
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                    {enabledGames.map((g) => (
                        <button
                            key={g.id}
                            onClick={() => setGame(g.id)}
                            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors border ${
                                game === g.id
                                    ? 'bg-brand-cyan/20 text-brand-cyan border-brand-cyan/30'
                                    : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
                            }`}
                        >
                            {g.shortName}
                        </button>
                    ))}
                </div>
                {languages.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                        {languages.map((l) => (
                            <button
                                key={l.code}
                                onClick={() => setLanguage(l.code)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border flex items-center gap-2 ${
                                    language === l.code
                                        ? 'bg-white/10 text-white border-white/20'
                                        : 'bg-white/5 text-slate-500 border-white/10 hover:text-white'
                                }`}
                            >
                                <img src={l.flagUrl} alt="" className="w-4 h-3 object-cover rounded-sm" />
                                {l.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
                <input
                    type="text"
                    placeholder="Filter sets by name or ID..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-[#0a0d12] border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-brand-cyan text-sm"
                />
            </div>

            {/* Set list */}
            {loading ? (
                <div className="glass rounded-2xl p-12 text-center text-slate-500 animate-pulse">Loading sets...</div>
            ) : filtered.length === 0 ? (
                <div className="glass rounded-2xl p-12 text-center flex flex-col items-center">
                    <div className="w-16 h-16 rounded-full bg-brand-cyan/10 text-brand-cyan flex items-center justify-center mb-4">
                        <i className="fa-solid fa-layer-group text-2xl" />
                    </div>
                    <h3 className="text-white font-black text-lg">No sets yet</h3>
                    <p className="text-slate-400 mt-1 text-sm">
                        {search ? 'No sets match your filter.' : 'Create the first set for this game and language.'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map((s) => (
                        <Link
                            key={s.id}
                            href={`/admin/catalog/${encodeURIComponent(s.id)}`}
                            className="glass rounded-2xl border border-white/10 p-5 hover:border-brand-cyan/40 transition-colors group flex items-center gap-4"
                        >
                            <div className="w-14 h-14 rounded-xl bg-black/40 flex items-center justify-center shrink-0 overflow-hidden">
                                {s.logo_url ? (
                                    <img src={s.logo_url} alt="" className="w-full h-full object-contain" />
                                ) : (
                                    <i className="fa-solid fa-layer-group text-slate-600" />
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 className="font-bold text-white truncate group-hover:text-brand-cyan transition-colors">{s.name}</h3>
                                <p className="text-[11px] font-mono text-slate-500 truncate">{s.id}</p>
                                <p className="text-[11px] text-slate-500 mt-1 truncate">
                                    {s.series ? `${s.series} · ` : ''}
                                    {(s.total ?? s.printed_total) ? `${s.total ?? s.printed_total} cards` : 'card count unknown'}
                                </p>
                            </div>
                            <i className="fa-solid fa-chevron-right text-slate-600 group-hover:text-brand-cyan transition-colors" />
                        </Link>
                    ))}
                </div>
            )}

            {showCreate && (
                <CreateSetModal
                    defaultGame={game}
                    defaultLanguage={language}
                    onClose={() => setShowCreate(false)}
                    onCreated={() => {
                        setShowCreate(false)
                        loadSets()
                    }}
                />
            )}
        </div>
    )
}

function CreateSetModal({
    defaultGame,
    defaultLanguage,
    onClose,
    onCreated,
}: {
    defaultGame: GameId
    defaultLanguage: GameLanguageCode
    onClose: () => void
    onCreated: () => void
}) {
    const [form, setForm] = useState({
        game: defaultGame as string,
        language: defaultLanguage as string,
        id: '',
        name: '',
        series: '',
        printed_total: '',
        total: '',
        release_date: '',
        logo_url: '',
        symbol_url: '',
    })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
    const gameLanguages = getGameLanguages(form.game)

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setSaving(true)
        try {
            const res = await fetch('/api/admin/catalog/sets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to create set')
            onCreated()
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <form onSubmit={submit} className="glass border border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-black text-white italic">Create Set</h2>
                    <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
                        <i className="fa-solid fa-xmark text-xl" />
                    </button>
                </div>

                {error && (
                    <div className="mb-4 bg-brand-red/10 border border-brand-red/30 text-brand-red text-sm rounded-lg px-4 py-2.5">{error}</div>
                )}

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelClass}>Game</label>
                        <select value={form.game} onChange={(e) => set('game', e.target.value)} className={inputClass}>
                            {GAMES.map((g) => (
                                <option key={g.id} value={g.id}>{g.shortName}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={labelClass}>Language</label>
                        <select value={form.language} onChange={(e) => set('language', e.target.value)} className={inputClass}>
                            {gameLanguages.map((l) => (
                                <option key={l.code} value={l.code}>{l.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={labelClass}>Set ID *</label>
                        <input required value={form.id} onChange={(e) => set('id', e.target.value)} placeholder="e.g. sv9" className={`${inputClass} font-mono`} />
                    </div>
                    <div>
                        <label className={labelClass}>Name *</label>
                        <input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Surging Sparks" className={inputClass} />
                    </div>
                    <div>
                        <label className={labelClass}>Series</label>
                        <input value={form.series} onChange={(e) => set('series', e.target.value)} placeholder="e.g. Scarlet & Violet" className={inputClass} />
                    </div>
                    <div>
                        <label className={labelClass}>Release date</label>
                        <input type="date" value={form.release_date} onChange={(e) => set('release_date', e.target.value)} className={inputClass} />
                    </div>
                    <div>
                        <label className={labelClass}>Printed total</label>
                        <input type="number" value={form.printed_total} onChange={(e) => set('printed_total', e.target.value)} className={inputClass} />
                    </div>
                    <div>
                        <label className={labelClass}>Total</label>
                        <input type="number" value={form.total} onChange={(e) => set('total', e.target.value)} className={inputClass} />
                    </div>
                    <div className="col-span-2">
                        <label className={labelClass}>Logo URL</label>
                        <input value={form.logo_url} onChange={(e) => set('logo_url', e.target.value)} placeholder="https://..." className={`${inputClass} font-mono text-xs`} />
                    </div>
                    <div className="col-span-2">
                        <label className={labelClass}>Symbol URL</label>
                        <input value={form.symbol_url} onChange={(e) => set('symbol_url', e.target.value)} placeholder="https://..." className={`${inputClass} font-mono text-xs`} />
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={saving}
                    className="w-full bg-brand-cyan text-black font-black uppercase tracking-widest py-3 rounded-lg mt-6 hover:bg-white transition-colors disabled:opacity-50"
                >
                    {saving ? <i className="fa-solid fa-spinner fa-spin" /> : 'Create Set'}
                </button>
            </form>
        </div>
    )
}
