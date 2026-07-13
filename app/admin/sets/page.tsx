'use client'

import { createClient } from '@/lib/supabase/client'
import React, { useEffect, useMemo, useRef, useState } from 'react'

class ErrorBoundary extends React.Component<any, any> {
    constructor(props: any) {
      super(props);
      this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error: any) {
      return { hasError: true, error };
    }
    render() {
      if (this.state.hasError) {
        return (
          <div className="p-10 bg-red-900 text-white min-h-screen">
            <h1 className="text-2xl font-bold">Client Crash Details:</h1>
            <pre className="mt-4 p-4 bg-black rounded text-sm overflow-auto whitespace-pre-wrap">
              {this.state.error?.stack || this.state.error?.toString()}
            </pre>
            <button onClick={() => window.location.reload()} className="bg-white text-black px-4 py-2 mt-4 rounded">Reload Page</button>
          </div>
        );
      }
      return this.props.children;
    }
}

//
// Helper to fix old TCGdex image missing extensions
function resolveImageUrl(url: string | null | undefined): string {
    if (!url) return 'https://cardstreet.com/placeholder.png'
    
    // If it's already a full HTTP URL (like new modern API inserts)
    if (url.startsWith('http')) {
        if (url.includes('tcgdex.net') && !url.endsWith('.webp') && !url.endsWith('.png') && !url.endsWith('.jpg')) {
            return `${url}.webp`
        }
        return url
    }
    
    // If it's a legacy relative string fragment like "base1/40/low"
    // Route it securely to the official Pokemon TCG API CDN which does not require series taxonomies
    const parts = url.split('/')
    if (parts.length >= 2) {
        return `https://images.pokemontcg.io/${parts[0]}/${parts[1]}.png`
    }
    
    return 'https://cardstreet.com/placeholder.png'
}

//
// Individual Set Accordion Component
// Handles its own lazy-loading of cards to prevent DOM locking entirely
//
function SetAccordion({ 
    config, 
    supabase, 
    openRemapModal, 
    globalShowVerified,
    isExpanded,
    toggleExpanded
}: any) {
    const [cards, setCards] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [hasLoaded, setHasLoaded] = useState(false)
    const [runningMatcher, setRunningMatcher] = useState(false)

    useEffect(() => {
        if (isExpanded) {
            loadCards()
        }
    }, [isExpanded, globalShowVerified])

    async function loadCards() {
        setLoading(true)
        const { data: thCards } = await supabase
            .from('pokemon_cards')
            .select('*')
            .eq('language', 'th')
            .ilike('set_id', config.thai_set_id)
            .order('number', { ascending: true })

        if (!thCards || thCards.length === 0) {
            setCards([])
            setLoading(false)
            setHasLoaded(true)
            return
        }

        const ids = thCards.map((c: any) => c.id)
        const { data: mappings } = await supabase
            .from('card_mappings')
            .select('*')
            .in('card_id_th', ids)

        const mapDict = new Map<string, any>((mappings || []).map((m: any) => [m.card_id_th, m]))
        const enIds = [...new Set((mappings || []).map((m: any) => m.card_id_en).filter(Boolean))]
        
        const { data: enCards } = await supabase
            .from('pokemon_cards')
            .select('*')
            .in('id', enIds)

        const enDict = new Map<string, any>((enCards || []).map((c: any) => [c.id, c]))

        let merged = thCards.map((th: any) => {
            const mapping = mapDict.get(th.id)
            const en = mapping ? enDict.get(mapping.card_id_en) : null
            return { th, mapping, en }
        })

        if (!globalShowVerified) {
            merged = merged.filter((row: any) => !row.mapping?.verified)
        }

        setCards(merged)
        setLoading(false)
        setHasLoaded(true)
    }

    async function triggerAutoMatcher(e: React.MouseEvent) {
        e.stopPropagation()
        if (!confirm(`Run Auto-Matcher for set ${config.thai_set_id}? This maps unmapped Thai cards.`)) return
        
        setRunningMatcher(true)
        const { error } = await supabase.functions.invoke('match-thai-cards', {
            body: { thaiSetId: config.thai_set_id }
        })

        setRunningMatcher(false)
        if (error) {
            alert('Failed: ' + error.message)
        } else {
            loadCards()
        }
    }

    async function toggleVerify(row: any) {
        if (!row.mapping?.card_id_en) {
            alert('Cannot verify an unmapped card. Please remap it first.')
            return
        }

        const newVerifiedStatus = !row.mapping?.verified
        
        const res = await fetch('/api/admin/mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'verify', 
                card_id_th: row.th.id,
                verified: newVerifiedStatus
            })
        })

        if (res.ok) {
            loadCards()
        } else {
            const data = await res.json()
            alert('Error updating status: ' + data.error)
        }
    }

    return (
        <div className="glass rounded-xl border border-white/10 overflow-hidden shadow-lg mb-4 transition-all">
            {/* Accordion Header */}
            <div 
                className="p-5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                onClick={toggleExpanded}
            >
                <div className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center border border-white/20 transition-transform ${isExpanded ? 'rotate-90 bg-brand-cyan text-black border-brand-cyan' : 'bg-brand-darker text-white'}`}>
                        <i className="fa-solid fa-chevron-right text-sm" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-white italic">Thai Set: {config.thai_set_id.toUpperCase()}</h2>
                        <p className="text-slate-400 text-xs">Mapped to English: {config.english_set_id}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button 
                        onClick={triggerAutoMatcher}
                        disabled={runningMatcher}
                        className="bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 px-3 py-1.5 rounded-lg font-bold transition-colors disabled:opacity-50 text-xs z-10"
                    >
                        {runningMatcher ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-wand-magic-sparkles mr-2" />} 
                        Auto-Match
                    </button>
                    {hasLoaded && !loading && (
                        <div className="bg-white/5 text-slate-300 font-mono text-xs px-3 py-1.5 rounded-lg border border-white/10">
                            {cards.length} {globalShowVerified ? 'cards total' : 'cards remaining'}
                        </div>
                    )}
                </div>
            </div>

            {/* Accordion Body */}
            {isExpanded && (
                <div className="border-t border-white/5 bg-brand-darker/50 p-4">
                    {loading && (
                        <div className="py-12 text-center text-slate-500 animate-pulse">Loading cards for {config.thai_set_id}...</div>
                    )}
                    
                    {!loading && cards.length === 0 && (
                        <div className="py-12 text-center flex flex-col items-center">
                            <div className="w-16 h-16 rounded-full bg-brand-cyan/10 text-brand-cyan flex items-center justify-center mb-4">
                                <i className="fa-solid fa-check-double text-2xl" />
                            </div>
                            <h3 className="text-lg font-black text-white">Queue Empty</h3>
                            <p className="text-slate-400 mt-1 text-sm">All loaded cards for {config.thai_set_id} are verified or missing.</p>
                        </div>
                    )}

                    {!loading && cards.length > 0 && (
                        <div className="grid grid-cols-1 gap-3">
                            {cards.map((row) => (
                                <div key={row.th.id} className="bg-brand-darker rounded-xl border border-white/10 overflow-hidden flex flex-col md:flex-row items-stretch hover:border-brand-cyan/30 transition-colors group relative shadow-md">
                                    
                                    {/* Thai Card Data */}
                                    <div className="flex-1 p-3 flex flex-col md:flex-row items-center md:items-start gap-4">
                                        <img src={row.th.image_small || row.th.image_large || 'https://cardstreet.com/placeholder.png'} 
                                            className="w-12 h-[66px] object-contain rounded drop-shadow bg-black/50 shrink-0" 
                                            onError={(e) => { e.currentTarget.src = 'https://cardstreet.com/placeholder.png' }}
                                        />
                                        <div className="flex-1 min-w-0 pt-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="bg-brand-cyan/10 text-brand-cyan px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border border-brand-cyan/20">TH</span>
                                                <span className="text-xs font-mono text-slate-400 font-bold">{row.th.set_id} #{row.th.number}</span>
                                            </div>
                                            <h3 className="font-bold text-white text-sm leading-tight truncate px-2 md:px-0">{row.th.name || 'Unknown'}</h3>
                                            {row.th.name_en && row.th.name_en !== row.th.name && (
                                                <p className="text-[10px] text-slate-500 truncate mt-0.5">{row.th.name_en}</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* English Card Match */}
                                    <div className="flex-[1.2] p-3 flex items-center justify-between gap-4 bg-white/[0.02] border-t md:border-t-0 md:border-l border-white/5 pr-16 relative">
                                        {row.en && (
                                            <>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="bg-slate-500/20 text-slate-300 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider">EN</span>
                                                        <span className="text-xs font-mono text-slate-400 font-bold">{row.en.set_id} #{row.en.number}</span>
                                                        <span className="text-[9px] text-slate-500 uppercase tracking-widest ml-auto">{row.mapping?.match_method || 'NA'}</span>
                                                    </div>
                                                    <h3 
                                                        className="font-bold text-white text-sm leading-tight truncate cursor-pointer hover:text-brand-cyan hover:underline transition-all" 
                                                        onClick={() => openRemapModal(row, () => loadCards())}
                                                    >
                                                        {row.en.name || 'Unknown'}
                                                    </h3>
                                                </div>
                                                
                                                {row.en.image_small && (
                                                    <div className="shrink-0 relative cursor-pointer group/img" onClick={() => openRemapModal(row, () => loadCards())}>
                                                        <img src={resolveImageUrl(row.en.image_small)} className="w-12 h-[66px] object-contain rounded drop-shadow bg-black/50 transition-all group-hover/img:brightness-50" />
                                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">
                                                            <i className="fa-solid fa-magnifying-glass text-white drop-shadow-md" />
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {!row.en && (
                                            <div 
                                                className="flex-1 h-full min-h-[66px] flex flex-col items-center justify-center gap-1 border border-dashed border-white/10 rounded-lg hover:border-brand-cyan/50 hover:bg-brand-cyan/5 transition-all cursor-pointer group/empty"
                                                onClick={() => openRemapModal(row, () => loadCards())}
                                            >
                                                <span className="text-[10px] font-bold text-slate-500 group-hover/empty:text-brand-cyan uppercase tracking-widest"><i className="fa-solid fa-link-slash mr-1" /> Click to map match</span>
                                            </div>
                                        )}

                                        {/* Verification Checkbox */}
                                        {row.en && (
                                            <div className="absolute right-0 top-0 bottom-0 w-14 bg-brand-darker/50 border-l border-white/10 flex items-center justify-center group-hover:bg-black/60 transition-colors z-10">
                                                <label className="relative flex items-center justify-center cursor-pointer w-full h-full">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={!!row.mapping?.verified}
                                                        onChange={() => toggleVerify(row)}
                                                        className="peer sr-only"
                                                    />
                                                    <div className="w-6 h-6 rounded-md border-2 border-white/20 peer-checked:bg-green-500 peer-checked:border-green-500 flex items-center justify-center text-transparent peer-checked:text-black transition-all hover:scale-110 peer-checked:shadow-[0_0_10px_rgba(34,197,94,0.3)]">
                                                        <i className="fa-solid fa-check text-xs font-black" />
                                                    </div>
                                                </label>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Card Requests — user-submitted "this card is missing" reports. Surfaced at the
// top of the Mapping QC workspace so the request queue, its status/outcome, and
// the ability to add the card live in one place.
// ─────────────────────────────────────────────────────────────────────────────

interface CardRequest {
    id: string
    requester_id: string | null
    search_query: string
    language: string | null
    notes: string | null
    status: 'Open' | 'Reviewed' | 'Added' | 'Dismissed'
    created_at: string
    updated_at: string
}

const REQUEST_STATUSES: CardRequest['status'][] = ['Open', 'Reviewed', 'Added', 'Dismissed']

const statusBadgeClass: Record<CardRequest['status'], string> = {
    Open: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    Reviewed: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    Added: 'bg-green-500/15 text-green-400 border-green-500/30',
    Dismissed: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
}

function CardRequestsPanel({ supabase }: { supabase: any }) {
    const [requests, setRequests] = useState<CardRequest[]>([])
    const [loading, setLoading] = useState(true)
    const [expanded, setExpanded] = useState(true)
    const [filter, setFilter] = useState<'active' | 'all'>('active')
    const [fulfilling, setFulfilling] = useState<CardRequest | null>(null)
    const [savingId, setSavingId] = useState<string | null>(null)

    const load = async () => {
        setLoading(true)
        const res = await fetch('/api/admin/card-requests')
        const data = await res.json()
        setRequests(res.ok ? (data.requests ?? []) : [])
        setLoading(false)
    }

    useEffect(() => { load() }, [])

    async function patchRequest(id: string, body: Record<string, unknown>) {
        setSavingId(id)
        const res = await fetch('/api/admin/card-requests', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, ...body }),
        })
        setSavingId(null)
        if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            alert('Failed to update request: ' + (data.error || res.statusText))
            return null
        }
        const data = await res.json()
        setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...data.request } : r)))
        return data
    }

    const visible = requests.filter((r) => (filter === 'all' ? true : r.status === 'Open' || r.status === 'Reviewed'))
    const openCount = requests.filter((r) => r.status === 'Open').length

    return (
        <div className="glass rounded-2xl border border-white/10 overflow-hidden">
            <div
                className="p-5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                onClick={() => setExpanded((v) => !v)}
            >
                <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center border border-white/20 transition-transform ${expanded ? 'rotate-90 bg-brand-cyan text-black border-brand-cyan' : 'bg-[#0f1419] text-white'}`}>
                        <i className="fa-solid fa-chevron-right text-sm" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-white italic flex items-center gap-2">
                            Card Requests
                            {openCount > 0 && (
                                <span className="bg-amber-500 text-black text-[11px] font-black px-2 py-0.5 rounded-full not-italic">{openCount} open</span>
                            )}
                        </h2>
                        <p className="text-slate-400 text-xs">Missing-card reports from users. Add the card, then mark it added to notify the requester.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                        onClick={() => setFilter(filter === 'active' ? 'all' : 'active')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${filter === 'all' ? 'bg-brand-cyan/20 text-brand-cyan border-brand-cyan/30' : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'}`}
                    >
                        {filter === 'all' ? 'Viewing all' : 'Active only'}
                    </button>
                    <button
                        onClick={load}
                        className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center transition-colors"
                        title="Refresh"
                    >
                        <i className="fa-solid fa-rotate text-sm" />
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="border-t border-white/5 bg-[#0a0d12]/50 p-4">
                    {loading ? (
                        <div className="py-10 text-center text-slate-500 animate-pulse">Loading requests...</div>
                    ) : visible.length === 0 ? (
                        <div className="py-10 text-center flex flex-col items-center">
                            <div className="w-14 h-14 rounded-full bg-green-500/10 text-green-400 flex items-center justify-center mb-3">
                                <i className="fa-solid fa-check-double text-xl" />
                            </div>
                            <h3 className="text-white font-black">Queue clear</h3>
                            <p className="text-slate-400 mt-1 text-sm">{filter === 'active' ? 'No open or reviewed requests.' : 'No card requests yet.'}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {visible.map((r) => (
                                <div key={r.id} className="bg-[#0f1419] rounded-xl border border-white/10 p-4">
                                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${statusBadgeClass[r.status]}`}>{r.status}</span>
                                                {r.language && (
                                                    <span className="bg-white/5 text-slate-300 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border border-white/10">{r.language}</span>
                                                )}
                                                <span className="text-[11px] text-slate-500">{new Date(r.created_at).toLocaleDateString()}</span>
                                            </div>
                                            <h3 className="font-bold text-white text-base mt-1.5 break-words">&ldquo;{r.search_query}&rdquo;</h3>
                                            {r.notes && (
                                                <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap break-words border-l-2 border-white/10 pl-2">{r.notes}</p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <select
                                                value={r.status}
                                                disabled={savingId === r.id}
                                                onChange={(e) => {
                                                    const next = e.target.value
                                                    // Flipping to Added by hand (card added elsewhere) offers to
                                                    // notify; every other status change is silent.
                                                    const notify = next === 'Added' && r.status !== 'Added'
                                                        ? confirm('Mark as Added and notify the requester that the card is now available?')
                                                        : false
                                                    patchRequest(r.id, { status: next, notify })
                                                }}
                                                className="bg-[#0a0d12] border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-bold focus:outline-none focus:border-brand-cyan disabled:opacity-50"
                                                title="Change status"
                                            >
                                                {REQUEST_STATUSES.map((s) => (
                                                    <option key={s} value={s}>{s}</option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => setFulfilling(r)}
                                                className="bg-brand-cyan text-black px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wider hover:bg-white transition-colors flex items-center gap-1.5"
                                                title="Add this card to the catalog and notify the requester"
                                            >
                                                <i className="fa-solid fa-plus" /> Add card
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {fulfilling && (
                <FulfillRequestModal
                    request={fulfilling}
                    supabase={supabase}
                    onClose={() => setFulfilling(null)}
                    onDone={(updated) => {
                        setFulfilling(null)
                        setRequests((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
                    }}
                />
            )}
        </div>
    )
}

// Compact add-card form for fulfilling a request. Reuses the catalog card
// endpoint (which mirrors the image into the card-images bucket), then marks the
// request 'Added' — which fires the requester notification.
function FulfillRequestModal({
    request,
    supabase,
    onClose,
    onDone,
}: {
    request: CardRequest
    supabase: any
    onClose: () => void
    onDone: (updated: Partial<CardRequest> & { id: string }) => void
}) {
    const fileRef = useRef<HTMLInputElement>(null)
    const [sets, setSets] = useState<{ id: string; name: string; language: string | null; game: string | null }[]>([])
    const [form, setForm] = useState({
        set_id: '',
        number: '',
        name: request.search_query,
        english_name: '',
        rarity: '',
    })
    const [file, setFile] = useState<File | null>(null)
    const [imageUrl, setImageUrl] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

    // Pull the set list once for the datalist autocomplete. Prefer sets matching
    // the request's language so the admin's likely target sorts to the top.
    useEffect(() => {
        (async () => {
            const { data } = await supabase
                .from('pokemon_sets')
                .select('id, name, language, game')
                .order('release_date', { ascending: false, nullsFirst: false })
            const rows = (data ?? []) as any[]
            const lang = request.language
            rows.sort((a, b) => {
                const am = lang && a.language === lang ? 0 : 1
                const bm = lang && b.language === lang ? 0 : 1
                return am - bm
            })
            setSets(rows)
        })()
    }, [supabase, request.language])

    const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
    useEffect(() => () => { if (filePreview) URL.revokeObjectURL(filePreview) }, [filePreview])
    const preview = filePreview || imageUrl.trim() || null
    const computedId = `${form.set_id || '?'}-${form.number || '?'}`

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setSaving(true)
        try {
            const fd = new FormData()
            fd.append('set_id', form.set_id.trim())
            fd.append('number', form.number.trim())
            fd.append('name', form.name.trim())
            fd.append('english_name', form.english_name.trim())
            fd.append('rarity', form.rarity.trim())
            if (file) fd.append('image', file)
            else if (imageUrl.trim()) fd.append('imageUrl', imageUrl.trim())

            const res = await fetch('/api/admin/catalog/cards', { method: 'POST', body: fd })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to create card')

            const cardId = data.card?.id ?? computedId
            // Mark the request Added (notifies the requester) and record the outcome.
            const note = `Added as ${cardId}.`
            const patchRes = await fetch('/api/admin/card-requests', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: request.id, status: 'Added', notes: note }),
            })
            const patchData = await patchRes.json().catch(() => ({}))
            if (!patchRes.ok) {
                // Card was created; only the status update failed. Surface it but
                // don't lose the win — admin can flip status manually.
                throw new Error(`Card ${cardId} created, but marking the request Added failed: ${patchData.error || patchRes.statusText}`)
            }
            onDone({ id: request.id, status: 'Added', notes: note, ...(patchData.request ?? {}) })
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <form onSubmit={submit} className="glass border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
                <div className="p-6 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#0a0d12]/80 backdrop-blur z-10">
                    <div>
                        <h2 className="text-xl font-black text-white italic">Add Requested Card</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Request: &ldquo;{request.search_query}&rdquo;{request.language ? ` · ${request.language}` : ''} · <span className="font-mono">{computedId}</span>
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
                        <i className="fa-solid fa-xmark text-xl" />
                    </button>
                </div>

                <div className="p-6 grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6">
                    {/* Image */}
                    <div className="space-y-3">
                        <label className={labelClassLocal}>Card image</label>
                        <div
                            onClick={() => fileRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) { setFile(f); setImageUrl('') } }}
                            className="aspect-[5/7] rounded-xl border-2 border-dashed border-white/15 hover:border-brand-cyan/50 bg-black/40 flex items-center justify-center overflow-hidden cursor-pointer transition-colors"
                        >
                            {preview ? (
                                <img src={preview} alt="" className="w-full h-full object-contain" />
                            ) : (
                                <div className="text-center text-slate-500 p-4">
                                    <i className="fa-solid fa-cloud-arrow-up text-2xl mb-2" />
                                    <p className="text-xs">Click or drop an image</p>
                                </div>
                            )}
                        </div>
                        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setImageUrl('') } }} />
                        <div>
                            <label className={labelClassLocal}>…or paste an image URL</label>
                            <input value={imageUrl} onChange={(e) => { setImageUrl(e.target.value); setFile(null) }} placeholder="https://..." className={`${inputClassLocal} font-mono text-xs`} />
                        </div>
                    </div>

                    {/* Fields */}
                    <div className="grid grid-cols-2 gap-4 content-start">
                        <div className="col-span-2">
                            <label className={labelClassLocal}>Set *</label>
                            <input required list="fulfill-set-list" value={form.set_id} onChange={(e) => set('set_id', e.target.value)} placeholder="Start typing a set id or name..." className={`${inputClassLocal} font-mono`} />
                            <datalist id="fulfill-set-list">
                                {sets.map((s) => (
                                    <option key={s.id} value={s.id}>{`${s.name} · ${s.game ?? 'pokemon'}/${s.language ?? '?'}`}</option>
                                ))}
                            </datalist>
                        </div>
                        <div>
                            <label className={labelClassLocal}>Number *</label>
                            <input required value={form.number} onChange={(e) => set('number', e.target.value)} placeholder="e.g. 25" className={`${inputClassLocal} font-mono`} />
                        </div>
                        <div>
                            <label className={labelClassLocal}>Rarity</label>
                            <input value={form.rarity} onChange={(e) => set('rarity', e.target.value)} placeholder="e.g. Rare" className={inputClassLocal} />
                        </div>
                        <div className="col-span-2">
                            <label className={labelClassLocal}>Name *</label>
                            <input required value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClassLocal} />
                        </div>
                        <div className="col-span-2">
                            <label className={labelClassLocal}>English name (for non-English cards)</label>
                            <input value={form.english_name} onChange={(e) => set('english_name', e.target.value)} className={inputClassLocal} />
                        </div>
                    </div>
                </div>

                <div className="px-6 pb-6 space-y-3">
                    {error && (
                        <div className="bg-brand-red/10 border border-brand-red/30 text-brand-red text-sm rounded-lg px-4 py-2.5">{error}</div>
                    )}
                    <p className="text-[11px] text-slate-500">
                        <i className="fa-solid fa-bell mr-1.5" />Adding the card marks this request <span className="text-green-400 font-bold">Added</span> and emails/pushes the requester that it&apos;s available.
                        Prices come from the nightly pipeline — leave pricing alone here.
                    </p>
                    <div className="flex gap-3">
                        <button type="button" onClick={onClose} className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-3 rounded-lg transition-colors">Cancel</button>
                        <button type="submit" disabled={saving} className="flex-1 bg-brand-cyan text-black font-black uppercase tracking-widest py-3 rounded-lg hover:bg-white transition-colors disabled:opacity-50">
                            {saving ? <i className="fa-solid fa-spinner fa-spin" /> : 'Add card & notify'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    )
}

const inputClassLocal = 'w-full bg-[#0a0d12] border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-brand-cyan text-sm'
const labelClassLocal = 'block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1'

function GlobalSetInboxPage() {
    const supabase = createClient()
    
    const [configs, setConfigs] = useState<any[]>([])
    const [expandedSetId, setExpandedSetId] = useState<string | null>(null)
    const [globalShowVerified, setGlobalShowVerified] = useState(false)
    const [showAddSetMode, setShowAddSetMode] = useState(false)

    // Add Set form state
    const [newThaiSet, setNewThaiSet] = useState('')
    const [newEngSet, setNewEngSet] = useState('')
    const [newSlug, setNewSlug] = useState('')

    // Remap Modal State
    const [remapTarget, setRemapTarget] = useState<any>(null)
    const [remapCallback, setRemapCallback] = useState<any>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<any[]>([])
    const [searching, setSearching] = useState(false)

    useEffect(() => {
        loadConfigs()
    }, [])

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

        const sorted = merged.sort((a,b) => a.thai_set_id.localeCompare(b.thai_set_id))
        setConfigs(sorted)
        
        if (sorted.length > 0 && !expandedSetId) {
            setExpandedSetId(sorted[0].thai_set_id)
        }
    }

    async function saveNewSet(e: React.FormEvent) {
        e.preventDefault()
        if (!newThaiSet || !newEngSet || !newSlug) return
        await supabase.from('marketplace_configs').upsert({ set_id: newEngSet, justtcg_slug: newSlug })
        await supabase.from('set_bridge').upsert({ thai_set_id: newThaiSet, english_set_id: newEngSet }, { onConflict: 'thai_set_id' })
        setShowAddSetMode(false)
        setNewThaiSet(''); setNewEngSet(''); setNewSlug('')
        loadConfigs()
    }

    async function searchEnglishCards(e: React.FormEvent) {
        e.preventDefault()
        if (!searchQuery) return
        setSearching(true)
        
        let query = supabase.from('pokemon_cards').select('*').eq('language', 'en')
        const terms = searchQuery.trim().split(/\s+/)
        
        // Multi-term omni-search: Every term must match at least one column (name, set_id, or number)
        terms.forEach(term => {
            query = query.or(`name.ilike.%${term}%,set_id.ilike.%${term}%,number.ilike.%${term}%`)
        })

        const { data } = await query.limit(150).order('set_id', { ascending: false })
        
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
            if (remapCallback) remapCallback()
        } else {
            const data = await res.json()
            alert('Error updating mapping: ' + data.error)
        }
    }

    return (
        <div className="space-y-6 animate-fadeIn pb-24">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 sticky top-0 z-40 bg-brand-darker/95 backdrop-blur py-4 border-b border-white/5">
                <div>
                    <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">Card QC Workspace</h1>
                    <p className="text-slate-400 text-sm mt-1">Review Thai sets, click an English card to swap it, and verify matches seamlessly.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={() => setShowAddSetMode(true)} className="border border-white/10 hover:bg-white/5 text-white px-4 py-2 rounded-xl transition-colors text-sm font-bold flex items-center">
                        <i className="fa-solid fa-folder-plus mr-2" /> Add Set
                    </button>
                    <button onClick={() => setGlobalShowVerified(!globalShowVerified)} className={`px-4 py-2 rounded-xl font-bold transition-colors text-sm border ${globalShowVerified ? 'bg-brand-cyan/20 text-brand-cyan border-brand-cyan/30' : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'}`}>
                        {globalShowVerified ? 'Viewing All' : 'Unverified Only'}
                    </button>
                </div>
            </div>

            <div className="max-w-6xl mx-auto mb-8">
                <CardRequestsPanel supabase={supabase} />
            </div>

            <div className="max-w-6xl mx-auto" translate="no">
                {configs.length === 0 && (
                    <div className="text-center p-12 text-slate-500">Loading configurations...</div>
                )}
                {configs.length > 0 && (
                    <div className="w-full">
                        {configs.map(config => (
                            <SetAccordion 
                                key={config.thai_set_id}
                                config={config}
                                supabase={supabase}
                                openRemapModal={(row: any, callback: any) => {
                                    setRemapTarget(row)
                                    setRemapCallback(() => callback)
                                }}
                                globalShowVerified={globalShowVerified}
                                isExpanded={expandedSetId === config.thai_set_id}
                                toggleExpanded={() => setExpandedSetId(expandedSetId === config.thai_set_id ? null : config.thai_set_id)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Config Addition Modal */}
            {showAddSetMode && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
                    <form onSubmit={saveNewSet} className="glass border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-black text-white italic">Add Set Config</h2>
                            <button type="button" onClick={() => setShowAddSetMode(false)} className="text-slate-500 hover:text-white"><i className="fa-solid fa-xmark text-xl" /></button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Thai Set ID (e.g. sv8a)</label>
                                <input required value={newThaiSet} onChange={e=>setNewThaiSet(e.target.value)} className="w-full bg-brand-darker border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-brand-cyan font-mono text-sm" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">English ID (e.g. sv8.5)</label>
                                <input required value={newEngSet} onChange={e=>setNewEngSet(e.target.value)} className="w-full bg-brand-darker border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-brand-cyan font-mono text-sm" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">JustTCG Slug</label>
                                <input required value={newSlug} onChange={e=>setNewSlug(e.target.value)} className="w-full bg-brand-darker border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-brand-cyan font-mono text-sm" />
                            </div>
                        </div>
                        <button type="submit" className="w-full bg-brand-cyan text-black font-black uppercase tracking-widest py-3 rounded-lg mt-6 hover:bg-white transition-colors">Save</button>
                    </form>
                </div>
            )}

            {/* Remap Modal */}
            {remapTarget && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
                    <div className="glass border border-white/10 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-white/10 flex items-start justify-between bg-brand-darker/50">
                            <div>
                                <h2 className="text-xl font-black text-white italic">Search English Card</h2>
                                <div className="flex items-center gap-3 mt-3">
                                    <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Remapping:</span>
                                    <span className="bg-brand-cyan/20 text-brand-cyan px-2 py-0.5 rounded text-xs font-mono border border-brand-cyan/30">{remapTarget.th.set_id} #{remapTarget.th.number}</span>
                                    <span className="text-white font-bold text-sm tracking-wide">{remapTarget.th.name}</span>
                                </div>
                            </div>
                            <button onClick={() => setRemapTarget(null)} className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors shrink-0">
                                <i className="fa-solid fa-xmark text-lg" />
                            </button>
                        </div>
                        
                        <div className="p-6 shrink-0 border-b border-white/5 bg-brand-darker">
                            <form onSubmit={searchEnglishCards} className="flex gap-4">
                                <div className="relative flex-1">
                                    <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input 
                                        type="text"
                                        placeholder="Type name (e.g. Charizard ex) and press Enter..."
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        className="w-full bg-brand-darker border-2 border-white/10 rounded-xl pl-12 pr-4 py-4 text-white focus:outline-none focus:border-brand-cyan text-base font-bold shadow-inset transition-colors"
                                        autoFocus
                                    />
                                </div>
                                <button type="submit" className="bg-white text-black px-8 rounded-xl font-black uppercase tracking-widest hover:bg-brand-cyan transition-colors shrink-0">
                                    {searching ? <i className="fa-solid fa-spinner fa-spin" /> : 'Search'}
                                </button>
                            </form>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 bg-brand-darker">
                            {searchResults.length === 0 && !searching && (
                                <div className="h-40 flex flex-col items-center justify-center text-slate-500">
                                    <i className="fa-solid fa-keyboard text-4xl mb-4 opacity-20" />
                                    <p>Search results will appear here</p>
                                </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {searchResults.map(c => (
                                    <div key={c.id} className="bg-brand-darker rounded-xl p-3 border border-white/5 flex items-center justify-between hover:border-brand-cyan hover:bg-brand-cyan/5 cursor-pointer transition-all group/item" onClick={() => saveRemap(c.id)}>
                                        <div className="flex items-center gap-4 min-w-0 pr-4">
                                            {c.image_small ? (
                                        <img src={resolveImageUrl(c.image_small)} className="w-12 h-[66px] object-contain rounded drop-shadow bg-black/50 shrink-0" />
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

export default function ErrorBoundaryWrapper() {
  return (
    <ErrorBoundary>
      <GlobalSetInboxPage />
    </ErrorBoundary>
  )
}

