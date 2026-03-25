'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function GlobalSetInboxPage() {
    const supabase = createClient()
    const router = useRouter()
    
    // Core Data
    const [configs, setConfigs] = useState<any[]>([])
    const [activeSetId, setActiveSetId] = useState<string | null>(null)
    
    // Card State
    const [cards, setCards] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [runningMatcher, setRunningMatcher] = useState(false)
    const [showVerified, setShowVerified] = useState(false)

    // Remap State
    const [remapTarget, setRemapTarget] = useState<any>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<any[]>([])
    const [searching, setSearching] = useState(false)

    // Modal State
    const [showAddSetMode, setShowAddSetMode] = useState(false)
    const [newThaiSet, setNewThaiSet] = useState('')
    const [newEngSet, setNewEngSet] = useState('')
    const [newSlug, setNewSlug] = useState('')

    useEffect(() => {
        loadConfigs()
    }, [])

    useEffect(() => {
        if (activeSetId) loadCards(activeSetId)
    }, [activeSetId, showVerified])

    async function loadConfigs() {
        const { data: bridges } = await supabase.from('set_bridge').select('*')
        const { data: mkts } = await supabase.from('marketplace_configs').select('*')
        
        const merged = bridges?.map(b => {
            const mConfig = mkts?.find(m => m.set_id === b.english_set_id)
            return {
                ...b,
                justtcg_slug: mConfig?.justtcg_slug || 'Unknown'
            }
        }) || []

        setConfigs(merged.sort((a,b) => a.thai_set_id.localeCompare(b.thai_set_id)))
        
        if (merged.length > 0 && !activeSetId) {
            setActiveSetId(merged[0].thai_set_id)
        } else if (merged.length === 0) {
            setLoading(false)
        }
    }

    async function saveNewSet(e: React.FormEvent) {
        e.preventDefault()
        if (!newThaiSet || !newEngSet || !newSlug) return

        // Insert / Update market config first
        await supabase.from('marketplace_configs').upsert({
            set_id: newEngSet,
            justtcg_slug: newSlug
        })

        // Insert bridge
        await supabase.from('set_bridge').upsert({
            thai_set_id: newThaiSet,
            english_set_id: newEngSet
        }, { onConflict: 'thai_set_id' })

        setShowAddSetMode(false)
        setNewThaiSet(''); setNewEngSet(''); setNewSlug('')
        loadConfigs()
    }

    async function loadCards(setId: string) {
        setLoading(true)
        
        const { data: thCards } = await supabase
            .from('pokemon_cards')
            .select('*')
            .eq('language', 'th')
            .ilike('set_id', setId)
            .order('number_int', { ascending: true })

        if (!thCards || thCards.length === 0) {
            setCards([])
            setLoading(false)
            return
        }

        const ids = thCards.map(c => c.id)
        const { data: mappings } = await supabase
            .from('card_mappings')
            .select('*')
            .in('card_id_th', ids)

        const mapDict = new Map((mappings || []).map(m => [m.card_id_th, m]))
        const enIds = [...new Set((mappings || []).map(m => m.card_id_en).filter(Boolean))]
        
        const { data: enCards } = await supabase
            .from('pokemon_cards')
            .select('*')
            .in('id', enIds)

        const enDict = new Map((enCards || []).map(c => [c.id, c]))

        let merged = thCards.map(th => {
            const mapping = mapDict.get(th.id)
            const en = mapping ? enDict.get(mapping.card_id_en) : null
            return { th, mapping, en }
        })

        if (!showVerified) {
            merged = merged.filter(row => !row.mapping?.verified)
        }

        setCards(merged)
        setLoading(false)
    }

    async function toggleVerify(row: any) {
        if (!row.mapping?.card_id_en) {
            alert('Cannot verify an unmapped card. Please remap it first.')
            return
        }

        const newVerifiedStatus = !row.mapping?.verified
        
        const { error } = await supabase.from('card_mappings').update({
            verified: newVerifiedStatus
        }).eq('card_id_th', row.th.id)

        if (!error) {
            if (activeSetId) loadCards(activeSetId)
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
        
        const { error } = await supabase.from('card_mappings').upsert({
            card_id_th: remapTarget.th.id,
            card_id_en: enCardId,
            match_method: 'manual_qc',
            confidence_score: 1.0,
            verified: true
        }, { onConflict: 'card_id_th' })

        if (!error) {
            setRemapTarget(null)
            if (activeSetId) loadCards(activeSetId)
        }
    }

    async function triggerAutoMatcher() {
        if (!activeSetId) return
        if (!confirm(`Run Auto-Matcher for set ${activeSetId}? This maps unmapped Thai cards.`)) return
        
        setRunningMatcher(true)
        const { data, error } = await supabase.functions.invoke('match-thai-cards', {
            body: { thaiSetId: activeSetId }
        })

        setRunningMatcher(false)
        if (error) {
            alert('Failed: ' + error.message)
        } else {
            alert(`Auto-matcher complete! Processed cards.`)
            loadCards(activeSetId)
        }
    }

    return (
        <div className="space-y-6 animate-fadeIn pb-24">
            {/* Header & Set Selector */}
            <div className="glass p-6 rounded-2xl border border-white/10 flex flex-col md:flex-row items-center justify-between gap-4 sticky top-0 z-40 shadow-2xl backdrop-blur-xl">
                <div>
                    <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">
                        Card QC Workspace
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">Review matches, select an English card to swap, and check the box to verify.</p>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 w-full md:w-auto">
                    <select 
                        value={activeSetId || ''}
                        onChange={(e) => setActiveSetId(e.target.value)}
                        className="bg-[#0f1419] border border-white/10 text-white px-4 py-2.5 rounded-xl font-bold focus:outline-none focus:border-brand-cyan md:w-64 w-full"
                    >
                        {configs.length === 0 && <option value="">No Sets Configured</option>}
                        {configs.map(c => (
                            <option key={c.thai_set_id} value={c.thai_set_id}>
                                Set: {c.thai_set_id.toUpperCase()} ({c.english_set_id})
                            </option>
                        ))}
                    </select>
                    
                    <button 
                        onClick={() => setShowAddSetMode(true)}
                        className="border border-white/10 hover:bg-white/5 text-white p-2.5 rounded-xl transition-colors shrink-0"
                        title="Add New Set Configuration"
                    >
                        <i className="fa-solid fa-folder-plus" />
                    </button>
                    
                    {activeSetId && (
                        <>
                            <button 
                                onClick={triggerAutoMatcher}
                                disabled={runningMatcher}
                                className="bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 px-4 py-2.5 rounded-xl font-bold transition-colors disabled:opacity-50 text-sm shrink-0 shadow-lg shadow-purple-500/10"
                            >
                                {runningMatcher ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-wand-magic-sparkles" />} 
                            </button>
                            
                            <button 
                                onClick={() => setShowVerified(!showVerified)}
                                className={`px-4 py-2.5 rounded-xl font-bold transition-colors text-sm shrink-0 border ${
                                    showVerified ? 'bg-brand-cyan/20 text-brand-cyan border-brand-cyan/30' : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
                                }`}
                            >
                                {showVerified ? 'Showing All' : 'Unverified Only'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* List View */}
            <div className="space-y-3">
                {loading ? (
                    <div className="glass rounded-2xl p-12 text-center text-slate-500 animate-pulse">Loading cards...</div>
                ) : cards.length === 0 ? (
                    <div className="glass rounded-2xl p-16 text-center flex flex-col items-center">
                        <div className="w-20 h-20 rounded-full bg-brand-cyan/10 text-brand-cyan flex items-center justify-center mb-4">
                            <i className="fa-solid fa-check-double text-3xl" />
                        </div>
                        <h3 className="text-xl font-black text-white">Queue Empty</h3>
                        <p className="text-slate-400 mt-2">All loaded cards for {activeSetId} have been verified or no cards exist yet.</p>
                        <p className="text-xs text-slate-500 mt-4">(Make sure to run the upload scripts first to insert Thai cards into the DB)</p>
                    </div>
                ) : cards.map((row) => (
                    <div key={row.th.id} className="glass rounded-xl border border-white/10 overflow-hidden flex flex-col md:flex-row items-stretch hover:border-brand-cyan/30 transition-colors group relative">
                        
                        {/* Thai Card Data */}
                        <div className="flex-1 p-4 bg-white/5 flex flex-col md:flex-row items-center md:items-start gap-4 text-center md:text-left">
                            <img src={`https://jyrfplsuwgcivwvwbvhw.supabase.co/storage/v1/object/public/images/thai/${row.th.set_id}/${encodeURIComponent(row.th.number)}.webp`} 
                                className="w-16 h-[88px] object-contain rounded drop-shadow bg-[#0a0d12] shrink-0" 
                                onError={(e) => { e.currentTarget.src = 'https://cardstreet.com/placeholder.png' }}
                            />
                            <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">Thai Source</div>
                                <h3 className="font-bold text-white leading-tight truncate px-2 md:px-0 text-lg">{row.th.name}</h3>
                                {row.th.name_en && row.th.name_en !== row.th.name && (
                                    <p className="text-xs text-slate-400 truncate opacity-80">{row.th.name_en}</p>
                                )}
                                <div className="flex items-center justify-center md:justify-start gap-2 mt-2">
                                    <span className="bg-[#0f1419] px-2 py-0.5 rounded border border-white/10 text-xs font-mono text-brand-cyan font-bold">{row.th.set_id} #{row.th.number}</span>
                                    <span className="text-xs text-slate-400 font-bold px-1">{row.th.rarity || 'NA'}</span>
                                </div>
                            </div>
                        </div>

                        {/* English Card Match OR Search Button */}
                        <div className="flex-[1.2] p-4 flex items-center justify-between gap-4 bg-[#0a0d12]/50 border-t md:border-t-0 md:border-l border-white/5 pr-20">
                            {row.en ? (
                                <>
                                    <div className="flex-1 min-w-0 pr-4">
                                        <div className="text-[10px] font-black uppercase tracking-wider mb-1 flex items-center gap-2">
                                            <span className="text-brand-cyan">English Match</span>
                                            <span className="text-slate-600">·</span>
                                            <span className="text-slate-500 text-[9px]">{row.mapping?.match_method}</span>
                                        </div>
                                        <h3 className="font-bold text-white leading-tight truncate text-lg cursor-pointer hover:text-brand-cyan underline-offset-4 decoration-white/20 hover:underline transition-all" onClick={() => setRemapTarget(row)}>
                                            {row.en.name}
                                        </h3>
                                        <div className="flex items-center gap-2 mt-2">
                                            <span className="bg-[#0f1419] px-2 py-0.5 rounded border border-white/10 text-xs font-mono text-slate-300 font-bold">{row.en.set_id} #{row.en.number}</span>
                                            <span className="text-xs text-slate-400 font-bold px-1">{row.en.rarity || 'NA'}</span>
                                        </div>
                                    </div>
                                    
                                    {row.en.images?.small && (
                                        <div className="shrink-0 relative cursor-pointer group/img" onClick={() => setRemapTarget(row)}>
                                            <img src={row.en.images.small} className="w-16 h-[88px] object-contain rounded drop-shadow bg-black/20 transition-all group-hover/img:brightness-50" />
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">
                                                <i className="fa-solid fa-magnifying-glass text-white text-xl drop-shadow-md" />
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div 
                                    className="flex-1 h-full min-h-[88px] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-white/10 rounded-xl hover:border-brand-cyan/50 hover:bg-brand-cyan/5 transition-all cursor-pointer group/empty"
                                    onClick={() => setRemapTarget(row)}
                                >
                                    <i className="fa-solid fa-link-slash text-brand-red group-hover/empty:text-brand-cyan transition-colors" />
                                    <span className="text-xs font-bold text-slate-500 group-hover/empty:text-white uppercase tracking-widest">Click to map card</span>
                                </div>
                            )}
                        </div>

                        {/* Verification Checkbox Absolute Right */}
                        {row.en && (
                            <div className="absolute right-0 top-0 bottom-0 w-16 bg-[#0a0d12] border-l border-white/10 flex items-center justify-center group-hover:bg-black/40 transition-colors z-10 shadow-[-8px_0_16px_rgba(0,0,0,0.3)]">
                                <label className="relative flex items-center justify-center cursor-pointer w-full h-full">
                                    <input 
                                        type="checkbox" 
                                        checked={!!row.mapping?.verified}
                                        onChange={() => toggleVerify(row)}
                                        className="peer sr-only"
                                    />
                                    <div className="w-8 h-8 rounded-lg border-2 border-white/20 peer-checked:bg-green-500 peer-checked:border-green-500 flex items-center justify-center text-transparent peer-checked:text-black transition-all hover:scale-110 peer-checked:shadow-[0_0_15px_rgba(34,197,94,0.4)]">
                                        <i className="fa-solid fa-check text-sm font-black" />
                                    </div>
                                </label>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Config Addition Modal */}
            {showAddSetMode && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
                    <form onSubmit={saveNewSet} className="glass border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-black text-white italic">Add Set Config</h2>
                            <button type="button" onClick={() => setShowAddSetMode(false)} className="text-slate-500 hover:text-white">
                                <i className="fa-solid fa-xmark text-xl" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Thai Set ID (e.g. sv8a)</label>
                                <input required value={newThaiSet} onChange={e=>setNewThaiSet(e.target.value)} className="w-full bg-[#0a0d12] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-cyan font-mono" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">English Mapping ID (e.g. sv8.5)</label>
                                <input required value={newEngSet} onChange={e=>setNewEngSet(e.target.value)} className="w-full bg-[#0a0d12] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-cyan font-mono" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">JustTCG English Slug</label>
                                <input required value={newSlug} onChange={e=>setNewSlug(e.target.value)} className="w-full bg-[#0a0d12] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-brand-cyan font-mono" />
                            </div>
                        </div>
                        <button type="submit" className="w-full bg-brand-cyan text-black font-black uppercase tracking-widest py-4 rounded-xl mt-8 hover:bg-white hover:shadow-[0_0_20px_rgba(255,255,255,0.3)] transition-all">
                            Save Config
                        </button>
                    </form>
                </div>
            )}

            {/* Remap Modal */}
            {remapTarget && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
                    <div className="glass border border-white/10 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-white/10 flex items-start justify-between bg-[#0a0d12]/50">
                            <div>
                                <h2 className="text-xl font-black text-white italic">Search English Card</h2>
                                <div className="flex items-center gap-3 mt-3">
                                    <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Remapping:</span>
                                    <span className="bg-brand-cyan/20 text-brand-cyan px-2 py-0.5 rounded text-xs font-mono border border-brand-cyan/30">
                                        {remapTarget.th.set_id} #{remapTarget.th.number}
                                    </span>
                                    <span className="text-white font-bold text-sm tracking-wide">{remapTarget.th.name}</span>
                                </div>
                            </div>
                            <button onClick={() => setRemapTarget(null)} className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors shrink-0">
                                <i className="fa-solid fa-xmark text-lg" />
                            </button>
                        </div>
                        
                        <div className="p-6 shrink-0 border-b border-white/5 bg-[#0f1419]">
                            <form onSubmit={searchEnglishCards} className="flex gap-4">
                                <div className="relative flex-1">
                                    <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input 
                                        type="text"
                                        placeholder="Type name (e.g. Charizard ex) and press Enter..."
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        className="w-full bg-[#0a0d12] border-2 border-white/10 rounded-xl pl-12 pr-4 py-4 text-white focus:outline-none focus:border-brand-cyan text-base font-bold shadow-inset transition-colors"
                                        autoFocus
                                    />
                                </div>
                                <button type="submit" className="bg-white text-black px-8 rounded-xl font-black uppercase tracking-widest hover:bg-brand-cyan transition-colors shrink-0">
                                    {searching ? <i className="fa-solid fa-spinner fa-spin" /> : 'Search'}
                                </button>
                            </form>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 bg-[#0a0d12]">
                            {searchResults.length === 0 && !searching && (
                                <div className="h-40 flex flex-col items-center justify-center text-slate-500">
                                    <i className="fa-solid fa-keyboard text-4xl mb-4 opacity-20" />
                                    <p>Search results will appear here</p>
                                </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {searchResults.map(c => (
                                    <div key={c.id} className="bg-[#0f1419] rounded-xl p-3 border border-white/5 flex items-center justify-between hover:border-brand-cyan hover:bg-brand-cyan/5 cursor-pointer transition-all group/item" onClick={() => saveRemap(c.id)}>
                                        <div className="flex items-center gap-4 min-w-0 pr-4">
                                            {c.images?.small ? (
                                                <img src={c.images.small} className="w-12 h-16 object-contain rounded drop-shadow bg-black/50" />
                                            ) : (
                                                <div className="w-12 h-16 bg-white/5 rounded flex items-center justify-center">?</div>
                                            )}
                                            <div className="min-w-0">
                                                <p className="font-bold text-white text-sm truncate">{c.name}</p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-xs font-mono text-slate-400">{c.set_id} #{c.number}</span>
                                                    <span className="text-[10px] bg-white/10 px-1.5 rounded text-slate-300">{c.rarity}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="w-8 h-8 rounded-full border border-white/20 group-hover/item:bg-brand-cyan group-hover/item:border-brand-cyan flex items-center justify-center text-transparent group-hover/item:text-black transition-all shrink-0">
                                            <i className="fa-solid fa-check text-xs" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
