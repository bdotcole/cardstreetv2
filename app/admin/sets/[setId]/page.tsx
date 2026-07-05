'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function SetInboxPage() {
    const params = useParams()
    const router = useRouter()
    const setId = typeof params?.setId === 'string' ? params.setId : ''
    
    const supabase = createClient()
    
    const [cards, setCards] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [runningMatcher, setRunningMatcher] = useState(false)
    const [showVerified, setShowVerified] = useState(false)

    // Remap Modal State
    const [remapTarget, setRemapTarget] = useState<any>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<any[]>([])
    const [searching, setSearching] = useState(false)

    useEffect(() => {
        if (setId) loadCards()
    }, [setId, showVerified])

    async function loadCards() {
        setLoading(true)
        
        // 1. Get all Thai cards for this set
        const { data: thCards } = await supabase
            .from('pokemon_cards')
            .select('*')
            .eq('language', 'th')
            .eq('set_id', setId)
            .order('number_int', { ascending: true })

        if (!thCards || thCards.length === 0) {
            setCards([])
            setLoading(false)
            return
        }

        // 2. Get their mappings
        const ids = thCards.map(c => c.id)
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

        let merged = thCards.map(th => {
            const mapping = mapDict.get(th.id)
            const en = mapping ? enDict.get(mapping.card_id_en) : null
            return {
                th,
                mapping,
                en
            }
        })

        // 4. Filter out verified cards unless "showVerified" is true
        if (!showVerified) {
            merged = merged.filter(row => !row.mapping?.verified)
        }

        setCards(merged)
        setLoading(false)
    }

    async function verifyMatch(row: any) {
        if (!row.mapping?.card_id_en) {
            alert('Cannot verify an unmapped card. Please remap it first.')
            return
        }

        const res = await fetch('/api/admin/mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'verify', card_id_th: row.th.id })
        })

        if (res.ok) {
            loadCards()
        } else {
            const data = await res.json()
            alert('Failed to verify card: ' + data.error)
        }
    }

    async function triggerAutoMatcher() {
        if (!confirm(`Run Auto-Matcher for set ${setId}? This will attempt to find matching English cards for all unmapped Thai cards.`)) return
        
        setRunningMatcher(true)
        const { data, error } = await supabase.functions.invoke('match-thai-cards', {
            body: { thaiSetId: setId }
        })

        setRunningMatcher(false)
        if (error) {
            alert('Failed to run auto-matcher: ' + error.message)
        } else {
            alert(`Auto-matcher complete! Processed ${data?.processedCards || '0'} cards.`)
            loadCards()
        }
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
        
        const res = await fetch('/api/admin/mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'remap', 
                card_id_th: remapTarget.th.id,
                card_id_en: enCardId 
            })
        })

        if (res.ok) {
            setRemapTarget(null)
            loadCards()
        } else {
            const data = await res.json()
            alert('Error updating mapping: ' + data.error)
        }
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={() => router.push('/admin/sets')}
                        className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors text-slate-400 hover:text-white"
                    >
                        <i className="fa-solid fa-arrow-left" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">
                            Set Inbox: <span className="text-brand-cyan">{setId.toUpperCase()}</span>
                        </h1>
                        <p className="text-slate-500 text-sm mt-1">Verify matches or fix incorrect mappings to clear the queue.</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-3">
                    <button 
                        onClick={triggerAutoMatcher}
                        disabled={runningMatcher}
                        className="text-xs px-4 py-2 rounded-xl font-bold transition-colors bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 disabled:opacity-50"
                    >
                        {runningMatcher ? (
                            <><i className="fa-solid fa-spinner fa-spin mr-2" /> Matching...</>
                        ) : (
                            <><i className="fa-solid fa-wand-magic-sparkles mr-2" /> Run Auto-Matcher</>
                        )}
                    </button>
                    <button 
                        onClick={() => setShowVerified(!showVerified)}
                        className={`text-xs px-4 py-2 rounded-xl font-bold transition-colors ${
                            showVerified ? 'bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/30' : 'bg-brand-darker text-slate-400 border border-white/10 hover:text-white'
                        }`}
                    >
                        {showVerified ? 'Viewing All Cards' : 'Viewing Unverified Only'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {loading ? (
                    <div className="glass rounded-2xl p-12 text-center text-slate-500">Loading inbox...</div>
                ) : cards.length === 0 ? (
                    <div className="glass rounded-2xl p-12 text-center flex flex-col items-center justify-center">
                        <div className="w-16 h-16 rounded-full bg-brand-cyan/10 flex items-center justify-center text-brand-cyan mb-4">
                            <i className="fa-solid fa-check-double text-2xl" />
                        </div>
                        <h3 className="text-white font-black text-lg">Inbox Zero</h3>
                        <p className="text-slate-500 mt-1">All matches for this set have been verified.</p>
                    </div>
                ) : cards.map((row) => (
                    <div key={row.th.id} className="glass rounded-2xl border border-white/10 overflow-hidden flex flex-col md:flex-row items-stretch">
                        
                        {/* Thai Card */}
                        <div className="flex-1 p-4 bg-white/5 flex items-center gap-4">
                            <img src={`https://jyrfplsuwgcivwvwbvhw.supabase.co/storage/v1/object/public/images/thai/${row.th.set_id}/${encodeURIComponent(row.th.number)}.webp`} 
                                className="w-16 h-24 object-contain rounded drop-shadow-md bg-black/20" 
                                onError={(e) => { e.currentTarget.src = 'https://cardstreet.com/placeholder.png' }}
                            />
                            <div>
                                <div className="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Thai Source</div>
                                <h3 className="font-bold text-white leading-tight">{row.th.name}</h3>
                                <p className="text-xs text-slate-400 mt-1">{row.th.set_id} #{row.th.number} · {row.th.rarity}</p>
                            </div>
                        </div>

                        {/* Match Status Pivot */}
                        <div className="w-full md:w-32 bg-brand-darker border-y md:border-y-0 md:border-x border-white/5 flex flex-col items-center justify-center py-4 gap-2 shrink-0 relative group">
                            {row.en ? (
                                <>
                                    {row.mapping?.verified ? (
                                        <div className="w-8 h-8 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center text-green-500">
                                            <i className="fa-solid fa-check text-xs" />
                                        </div>
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-brand-cyan/20 border border-brand-cyan/30 flex items-center justify-center text-brand-cyan">
                                            <i className="fa-solid fa-link text-xs" />
                                        </div>
                                    )}
                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 text-center px-2">
                                        {row.mapping?.verified ? 'Verified' : row.mapping?.match_method}
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
                            
                            <div className="absolute inset-0 bg-brand-darker flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity p-2">
                                {row.en && !row.mapping?.verified && (
                                    <button 
                                        onClick={() => verifyMatch(row)}
                                        className="w-full bg-brand-cyan text-black px-3 py-1.5 rounded-lg text-[10px] font-black hover:scale-105 transition-transform"
                                    >
                                        VERIFY
                                    </button>
                                )}
                                <button 
                                    onClick={() => setRemapTarget(row)}
                                    className="w-full bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg text-[10px] font-black transition-colors"
                                >
                                    REMAP
                                </button>
                            </div>
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
                                        <img src={row.en.images.small} className="w-16 h-24 object-contain rounded drop-shadow-md bg-black/20" />
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
                    <div className="bg-brand-darker border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
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
                                        className="w-full bg-brand-darker border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-brand-cyan text-sm"
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
