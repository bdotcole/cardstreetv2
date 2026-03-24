'use client'

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useEffect, useState } from 'react'

export default function AdminMappingsPage() {
    const supabase = createClientComponentClient()
    
    const [thaiSets, setThaiSets] = useState<string[]>([])
    const [selectedSet, setSelectedSet] = useState<string>('')
    const [cards, setCards] = useState<any[]>([])
    const [loading, setLoading] = useState(false)

    // Remap Modal State
    const [remapTarget, setRemapTarget] = useState<any>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<any[]>([])
    const [searching, setSearching] = useState(false)

    useEffect(() => {
        loadSets()
    }, [])

    useEffect(() => {
        if (selectedSet) loadCards(selectedSet)
    }, [selectedSet])

    async function loadSets() {
        // Just get all distinct thai set ids from set_bridge
        const { data } = await supabase.from('set_bridge').select('thai_set_id')
        const unique = [...new Set((data || []).map(r => r.thai_set_id))]
        setThaiSets(unique.sort())
        if (unique.length > 0) setSelectedSet(unique[0])
    }

    async function loadCards(setId: string) {
        setLoading(true)
        
        // 1. Get all Thai cards for this set
        const { data: thCards } = await supabase
            .from('pokemon_cards')
            .select('*')
            .eq('language', 'th')
            .eq('set_id', setId)
            .order('number_int', { ascending: true })

        // 2. Get their mappings
        const ids = (thCards || []).map(c => c.id)
        const { data: mappings } = await supabase
            .from('card_mappings')
            .select('*')
            .in('card_id_th', ids)

        const mapDict = new Map(mappings?.map(m => [m.card_id_th, m]))

        // 3. Get the EN cards they map to
        const enIds = [...new Set(mappings?.map(m => m.card_id_en).filter(Boolean))]
        const { data: enCards } = await supabase
            .from('pokemon_cards')
            .select('*')
            .in('id', enIds)

        const enDict = new Map(enCards?.map(c => [c.id, c]))

        const merged = (thCards || []).map(th => {
            const mapping = mapDict.get(th.id)
            const en = mapping ? enDict.get(mapping.card_id_en) : null
            return {
                th,
                mapping,
                en
            }
        })

        setCards(merged)
        setLoading(false)
    }

    async function searchEnglishCards(e: React.FormEvent) {
        e.preventDefault()
        if (!searchQuery) return
        setSearching(true)
        
        const { data } = await supabase
            .from('pokemon_cards')
            .select('*')
            .eq('language', 'en')
            .ilike('name', `%${searchQuery}%`)
            .limit(20)

        setSearchResults(data || [])
        setSearching(false)
    }

    async function saveRemap(enCardId: string) {
        if (!remapTarget) return
        
        const { error } = await supabase.from('card_mappings').upsert({
            card_id_th: remapTarget.th.id,
            card_id_en: enCardId,
            match_method: 'manual_qc',
            confidence_score: 1.0,
            verified: true
        }, { onConflict: 'card_id_th' })

        if (!error) {
            setRemapTarget(null)
            loadCards(selectedSet)
            // Note: In an ideal world we'd trigger daily-market-update here
            alert('Mapping updated! The market price will recalculate automatically on the next pricing cycle.')
        } else {
            alert('Error updating mapping')
        }
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">Card Mappings QC</h1>
                    <p className="text-slate-500 text-sm mt-1">Verify and override automatic card translations</p>
                </div>
                
                <select 
                    value={selectedSet}
                    onChange={e => setSelectedSet(e.target.value)}
                    className="bg-[#0f1419] border border-white/10 rounded-xl px-4 py-2 text-white font-bold text-sm focus:outline-none focus:border-brand-cyan"
                >
                    {thaiSets.map(s => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {loading ? (
                    <div className="glass rounded-2xl p-12 text-center text-slate-500">Loading cards...</div>
                ) : cards.map((row) => (
                    <div key={row.th.id} className="glass rounded-2xl border border-white/10 overflow-hidden flex flex-col md:flex-row items-stretch">
                        
                        {/* Thai Card */}
                        <div className="flex-1 p-4 bg-white/5 flex items-center gap-4">
                            <img src={`https://jyrfplsuwgcivwvwbvhw.supabase.co/storage/v1/object/public/images/thai/${row.th.set_id}/${encodeURIComponent(row.th.number)}.webp`} 
                                className="w-16 h-24 object-contain rounded drop-shadow-md" 
                                onError={(e) => { e.currentTarget.src = 'https://cardstreet.com/placeholder.png' }}
                            />
                            <div>
                                <div className="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Thai Source</div>
                                <h3 className="font-bold text-white leading-tight">{row.th.name}</h3>
                                <p className="text-xs text-slate-400 mt-1">{row.th.set_id} #{row.th.number} · {row.th.rarity}</p>
                            </div>
                        </div>

                        {/* Match Status Pivot */}
                        <div className="w-full md:w-32 bg-[#0a0d12] border-y md:border-y-0 md:border-x border-white/5 flex flex-col items-center justify-center py-4 gap-2 shrink-0 relative">
                            {row.en ? (
                                <>
                                    <div className="w-8 h-8 rounded-full bg-brand-cyan/20 border border-brand-cyan/30 flex items-center justify-center text-brand-cyan">
                                        <i className="fa-solid fa-link text-xs" />
                                    </div>
                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                                        {row.mapping.match_method}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <div className="w-8 h-8 rounded-full bg-brand-red/20 border border-brand-red/30 flex items-center justify-center text-brand-red">
                                        <i className="fa-solid fa-link-slash text-xs" />
                                    </div>
                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                                        Unmapped
                                    </span>
                                </>
                            )}
                            <button 
                                onClick={() => setRemapTarget(row)}
                                className="absolute bottom-2 right-2 md:relative md:bottom-0 md:right-0 mt-2 text-[10px] bg-white/10 hover:bg-white/20 text-white px-3 py-1 rounded-full font-bold transition-colors"
                            >
                                Remap
                            </button>
                        </div>

                        {/* English Card */}
                        <div className="flex-1 p-4 flex items-center justify-between gap-4 relative">
                            {row.en ? (
                                <>
                                    <div>
                                        <div className="text-[10px] font-black uppercase text-brand-cyan tracking-wider mb-1">Target Match</div>
                                        <h3 className="font-bold text-white leading-tight">{row.en.name}</h3>
                                        <p className="text-xs text-slate-400 mt-1">{row.en.set_id} #{row.en.number} · {row.en.rarity}</p>
                                    </div>
                                    {row.en.images?.small && (
                                        <img src={row.en.images.small} className="w-16 h-24 object-contain rounded drop-shadow-md" />
                                    )}
                                </>
                            ) : (
                                <div className="text-slate-500 text-sm italic">No English card mapped</div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Remap Modal */}
            {remapTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="bg-[#0f1419] border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
                            <div>
                                <h2 className="text-lg font-black text-white italic">Remap Card</h2>
                                <p className="text-xs text-slate-400 mt-1">
                                    Currently modifying: <span className="text-white font-bold">{remapTarget.th.name} ({remapTarget.th.set_id} #{remapTarget.th.number})</span>
                                </p>
                            </div>
                            <button onClick={() => setRemapTarget(null)} className="text-slate-500 hover:text-white">
                                <i className="fa-solid fa-xmark" />
                            </button>
                        </div>
                        
                        <div className="p-6 shrink-0 border-b border-white/5">
                            <form onSubmit={searchEnglishCards} className="flex gap-3">
                                <div className="relative flex-1">
                                    <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
                                    <input 
                                        type="text"
                                        placeholder="Search English cards by name (e.g. Charizard ex)"
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        className="w-full bg-[#0a0d12] border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-brand-cyan text-sm"
                                    />
                                </div>
                                <button type="submit" className="bg-white/10 hover:bg-white/20 text-white px-6 rounded-xl font-bold transition-colors">
                                    {searching ? '...' : 'Search'}
                                </button>
                            </form>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
                            {searchResults.length === 0 && !searching && (
                                <div className="text-center text-slate-500 py-8">Search to find a replacement mapping</div>
                            )}
                            {searchResults.map(c => (
                                <div key={c.id} className="glass rounded-xl p-3 border border-white/5 flex items-center justify-between hover:border-brand-cyan/50 transition-colors">
                                    <div className="flex items-center gap-4">
                                        {c.images?.small && (
                                            <img src={c.images.small} className="w-10 h-14 object-contain rounded" />
                                        )}
                                        <div>
                                            <p className="font-bold text-white text-sm">{c.name}</p>
                                            <p className="text-xs text-slate-400">{c.set_id} #{c.number} · {c.rarity}</p>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => saveRemap(c.id)}
                                        className="text-xs bg-brand-cyan text-black font-black uppercase px-4 py-2 rounded-lg hover:scale-105 transition-transform"
                                    >
                                        Select
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
