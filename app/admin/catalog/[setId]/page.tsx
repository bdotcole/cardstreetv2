'use client'

import { createClient } from '@/lib/supabase/client'
import { getThumbnailUrl, getSetLogoUrl } from '@/lib/imageUtils'
import { pickDisplayMarketValue } from '@/lib/cardMapper'
import { EXCHANGE_RATES } from '@/constants'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Display-price row from the market_values join. One row per condition; the graded
// tiers are filtered out by pickDisplayMarketValue (shared with the storefront mapper).
interface MarketRow {
    condition: string | null
    language: string | null
    market_avg: number | null
    currency: string | null
    source: string | null
    last_updated: string | null
}

interface CardRow {
    id: string
    set_id: string
    number: string | null
    name: string | null
    english_name: string | null
    rarity: string | null
    supertype: string | null
    hp: number | null
    types: string[] | null
    subtypes: string[] | null
    image_small: string | null
    image_large: string | null
    market_values: MarketRow[] | null
}

// THB<->USD uses the same constant the storefront mapper does, so an admin edit
// round-trips through the USD-storing pin RPC back to the exact THB shown here.
const THB_PER_USD = 1 / (EXCHANGE_RATES['USD'] || 0.028)

function rowToThb(row: MarketRow | null): number | null {
    if (!row || !(Number(row.market_avg) > 0)) return null
    const avg = Number(row.market_avg)
    return row.currency === 'USD' ? avg * THB_PER_USD : avg
}

// The single price the card page shows: pickDisplayMarketValue's chosen ungraded row.
function displayThb(card: CardRow): number | null {
    return rowToThb(pickDisplayMarketValue(card.market_values) as MarketRow | null)
}

function fmtThb(n: number | null): string {
    return n == null ? '—' : '฿' + Math.round(n).toLocaleString('en-US')
}

interface SetRow {
    id: string
    name: string
    series: string | null
    language: string | null
    game: string | null
    total: number | null
    printed_total: number | null
    logo_url: string | null
}

const inputClass =
    'w-full bg-brand-darker border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-brand-cyan text-sm'
const labelClass = 'block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1'

export default function SetCardManagerPage() {
    const params = useParams()
    const router = useRouter()
    const setId = typeof params?.setId === 'string' ? decodeURIComponent(params.setId) : ''
    const supabase = useMemo(() => createClient(), [])

    const [set, setSet] = useState<SetRow | null>(null)
    const [cards, setCards] = useState<CardRow[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [editing, setEditing] = useState<CardRow | null>(null)
    const [showForm, setShowForm] = useState(false)
    const [pricing, setPricing] = useState<CardRow | null>(null)

    const loadAll = useCallback(async () => {
        setLoading(true)
        const [{ data: setData }, { data: cardData }] = await Promise.all([
            supabase
                .from('pokemon_sets')
                .select('id, name, series, language, game, total, printed_total, logo_url')
                .eq('id', setId)
                .maybeSingle(),
            supabase
                .from('pokemon_cards')
                .select('id, set_id, number, name, english_name, rarity, supertype, hp, types, subtypes, image_small, image_large, market_values(condition, language, market_avg, currency, source, last_updated)')
                .eq('set_id', setId)
                .order('number', { ascending: true }),
        ])
        setSet(setData as SetRow | null)
        setCards((cardData as CardRow[]) || [])
        setLoading(false)
    }, [supabase, setId])

    useEffect(() => {
        if (setId) loadAll()
    }, [setId, loadAll])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return cards
        return cards.filter(
            (c) =>
                (c.name ?? '').toLowerCase().includes(q) ||
                (c.number ?? '').toLowerCase().includes(q) ||
                (c.english_name ?? '').toLowerCase().includes(q),
        )
    }, [cards, search])

    async function deleteCard(card: CardRow) {
        if (!confirm(`Delete card ${card.number} — ${card.name}? This also removes its images.`)) return
        const res = await fetch(`/api/admin/catalog/cards/${encodeURIComponent(card.id)}`, { method: 'DELETE' })
        if (res.ok) {
            setCards((prev) => prev.filter((c) => c.id !== card.id))
        } else {
            const data = await res.json().catch(() => ({}))
            alert('Failed to delete: ' + (data.error || res.statusText))
        }
    }

    function openCreate() {
        setEditing(null)
        setShowForm(true)
    }
    function openEdit(card: CardRow) {
        setEditing(card)
        setShowForm(true)
    }

    // Reflect a pin/release back into the grid immediately (the pinned row stores USD;
    // rowToThb converts it back for the badge). Merged by (condition, language) so we
    // replace the display row rather than stacking a duplicate.
    function onPriceSaved(cardId: string, rows: MarketRow[]) {
        setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, market_values: rows } : c)))
        setPricing((p) => (p && p.id === cardId ? { ...p, market_values: rows } : p))
    }

    return (
        <div className="space-y-6 animate-fadeIn pb-24">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                    <button
                        onClick={() => router.push('/admin/catalog')}
                        className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors text-slate-400 hover:text-white shrink-0"
                    >
                        <i className="fa-solid fa-arrow-left" />
                    </button>
                    {set?.logo_url && (
                        <div className="w-12 h-12 rounded-xl bg-black/40 flex items-center justify-center overflow-hidden shrink-0">
                            <img src={getSetLogoUrl(set.logo_url)} alt="" className="w-full h-full object-contain" />
                        </div>
                    )}
                    <div className="min-w-0">
                        <h1 className="text-2xl font-black text-white italic skew-x-[-3deg] truncate">
                            {set?.name ?? setId}
                        </h1>
                        <p className="text-slate-500 text-xs mt-1 font-mono truncate">
                            {setId}
                            {set?.game ? ` · ${set.game}` : ''}
                            {set?.language ? ` · ${set.language}` : ''} · {cards.length} card{cards.length === 1 ? '' : 's'}
                        </p>
                    </div>
                </div>
                <button
                    onClick={openCreate}
                    className="bg-brand-cyan text-black px-5 py-2.5 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-white transition-colors flex items-center justify-center shrink-0"
                >
                    <i className="fa-solid fa-plus mr-2" /> Add Card
                </button>
            </div>

            {/* pHash hint */}
            <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-400 flex items-start gap-2">
                <i className="fa-solid fa-circle-info text-brand-cyan mt-0.5" />
                <span>
                    New cards appear in the catalog immediately. To make them scannable, run{' '}
                    <code className="text-slate-300">scripts/backfill-phashes.mjs</code> after adding images.
                </span>
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
                <input
                    type="text"
                    placeholder="Filter cards by number or name..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-brand-darker border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-brand-cyan text-sm"
                />
            </div>

            {/* Grid */}
            {loading ? (
                <div className="glass rounded-2xl p-12 text-center text-slate-500 animate-pulse">Loading cards...</div>
            ) : filtered.length === 0 ? (
                <div className="glass rounded-2xl p-12 text-center flex flex-col items-center">
                    <div className="w-16 h-16 rounded-full bg-brand-cyan/10 text-brand-cyan flex items-center justify-center mb-4">
                        <i className="fa-solid fa-clone text-2xl" />
                    </div>
                    <h3 className="text-white font-black text-lg">{search ? 'No matches' : 'No cards yet'}</h3>
                    <p className="text-slate-400 mt-1 text-sm">
                        {search ? 'No cards match your filter.' : 'Add the first card to this set.'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {filtered.map((card) => (
                        <div
                            key={card.id}
                            className="glass rounded-xl border border-white/10 overflow-hidden group relative hover:border-brand-cyan/40 transition-colors"
                        >
                            <div className="aspect-[5/7] bg-black/40 flex items-center justify-center overflow-hidden">
                                {card.image_small || card.image_large ? (
                                    <img
                                        src={getThumbnailUrl(card.image_small || card.image_large)}
                                        alt={card.name ?? ''}
                                        className="w-full h-full object-contain"
                                        onError={(e) => {
                                            e.currentTarget.style.visibility = 'hidden'
                                        }}
                                    />
                                ) : (
                                    <i className="fa-solid fa-image text-3xl text-slate-700" />
                                )}
                            </div>
                            <div className="p-2.5">
                                <p className="text-[11px] font-mono text-slate-500">#{card.number}</p>
                                <p className="text-sm font-bold text-white truncate">{card.name}</p>
                                <p className="text-[10px] text-slate-500 truncate">{card.rarity || '—'}</p>
                                {/* Market price — click to edit. A pin icon marks an admin override. */}
                                <button
                                    onClick={() => setPricing(card)}
                                    title="Edit market price"
                                    className="mt-1.5 w-full flex items-center gap-1.5 text-left group/price"
                                >
                                    <span className={`text-sm font-black tabular-nums ${displayThb(card) == null ? 'text-slate-600' : 'text-brand-green'}`}>
                                        {fmtThb(displayThb(card))}
                                    </span>
                                    {pickDisplayMarketValue(card.market_values)?.source === 'admin' && (
                                        <i className="fa-solid fa-thumbtack text-[9px] text-brand-cyan" title="Admin-set price" />
                                    )}
                                    <i className="fa-solid fa-pen text-[9px] text-slate-600 group-hover/price:text-brand-cyan transition-colors ml-auto" />
                                </button>
                            </div>

                            {/* Hover actions */}
                            <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => setPricing(card)}
                                    className="w-8 h-8 rounded-lg bg-black/70 hover:bg-brand-green hover:text-black text-white flex items-center justify-center transition-colors"
                                    title="Edit price"
                                >
                                    <i className="fa-solid fa-baht-sign text-xs" />
                                </button>
                                <button
                                    onClick={() => openEdit(card)}
                                    className="w-8 h-8 rounded-lg bg-black/70 hover:bg-brand-cyan hover:text-black text-white flex items-center justify-center transition-colors"
                                    title="Edit"
                                >
                                    <i className="fa-solid fa-pen text-xs" />
                                </button>
                                <button
                                    onClick={() => deleteCard(card)}
                                    className="w-8 h-8 rounded-lg bg-black/70 hover:bg-brand-red hover:text-white text-white flex items-center justify-center transition-colors"
                                    title="Delete"
                                >
                                    <i className="fa-solid fa-trash text-xs" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showForm && (
                <CardFormModal
                    setId={setId}
                    editing={editing}
                    onClose={() => setShowForm(false)}
                    onCreated={(card) => setCards((prev) => [...prev, { ...card, market_values: card.market_values ?? [] }].sort(sortByNumber))}
                    // Merge, don't replace: the card-edit API doesn't return market_values,
                    // so a spread-replace would wipe the price out of the grid until reload.
                    onUpdated={(card) => setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...card } : c)))}
                />
            )}

            {pricing && (
                <PriceEditorModal
                    card={pricing}
                    setLanguage={set?.language ?? 'en'}
                    onClose={() => setPricing(null)}
                    onSaved={onPriceSaved}
                />
            )}
        </div>
    )
}

function sortByNumber(a: CardRow, b: CardRow) {
    return (a.number ?? '').localeCompare(b.number ?? '', undefined, { numeric: true })
}

// Map the set's UI language to the market_values language code. Japanese cards
// (pokemon_cards.language='ja') store prices under 'jp' (see the pricing-job notes),
// everything else is 1:1.
function marketLanguage(setLanguage: string): string {
    return setLanguage === 'ja' || setLanguage === 'jp' ? 'jp' : setLanguage || 'en'
}

// Focused editor for a single card's displayed market price. Writes through the
// existing /api/admin/internal-prices route, which pins a guard-protected
// source='admin' row so the daily pricing crons can never clobber the manual value.
function PriceEditorModal({
    card,
    setLanguage,
    onClose,
    onSaved,
}: {
    card: CardRow
    setLanguage: string
    onClose: () => void
    onSaved: (cardId: string, rows: MarketRow[]) => void
}) {
    const displayRow = useMemo(
        () => pickDisplayMarketValue(card.market_values) as MarketRow | null,
        [card.market_values],
    )
    // Pin the exact key the card page renders: the display row's condition/language
    // when one exists, else a sensible default so a priceless card can be given one.
    const condition = displayRow?.condition ?? 'Raw_NM'
    const language = displayRow?.language ?? marketLanguage(setLanguage)
    const currentThb = rowToThb(displayRow)
    const isPinned = displayRow?.source === 'admin'

    const [value, setValue] = useState(currentThb != null ? String(Math.round(currentThb)) : '')
    const [saving, setSaving] = useState<null | 'save' | 'release'>(null)
    const [error, setError] = useState<string | null>(null)

    const preview = card.image_small || card.image_large
    const sourceLabel =
        displayRow?.source === 'admin' ? 'Admin-set (pinned)'
            : displayRow?.source === 'cardstreet' ? 'Learned from CardStreet sales'
                : displayRow ? 'Automatic (price feed)'
                    : 'No price on record'

    // Merge the written row back into the card by (condition, language) so the grid
    // badge updates without a refetch. The pin RPC stores USD; keep that shape.
    function mergedRows(usd: number | null, source: string): MarketRow[] {
        const kept = (card.market_values ?? []).filter(
            (r) => !(r.condition === condition && (r.language ?? language) === language),
        )
        return [
            ...kept,
            { condition, language, market_avg: usd, currency: 'USD', source, last_updated: new Date().toISOString() },
        ]
    }

    async function post(body: Record<string, unknown>) {
        const res = await fetch('/api/admin/internal-prices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card_id: card.id, language, condition, ...body }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Request failed')
        return data.row as { market_avg?: number } | null
    }

    async function save() {
        const thb = Number(value)
        if (!(thb > 0)) { setError('Enter a price greater than 0'); return }
        setSaving('save'); setError(null)
        try {
            const row = await post({ action: 'pin', thb })
            onSaved(card.id, mergedRows(row?.market_avg ?? thb * (EXCHANGE_RATES['USD'] || 0.028), 'admin'))
            onClose()
        } catch (e: any) { setError(e.message) } finally { setSaving(null) }
    }

    async function release() {
        setSaving('release'); setError(null)
        try {
            const row = await post({ action: 'release', to: 'api' })
            onSaved(card.id, mergedRows(row?.market_avg ?? null, 'api'))
            onClose()
        } catch (e: any) { setError(e.message) } finally { setSaving(null) }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md" onClick={onClose}>
            <div
                className="glass border border-white/10 rounded-2xl w-full max-w-md shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b border-white/10 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-black text-white italic">Market Price</h2>
                        <p className="text-xs text-slate-500 mt-1 font-mono">{card.id}</p>
                    </div>
                    <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
                        <i className="fa-solid fa-xmark text-xl" />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    <div className="flex gap-4 items-center">
                        <div className="w-16 h-[89px] rounded-lg bg-black/40 overflow-hidden shrink-0 flex items-center justify-center">
                            {preview ? (
                                <img src={getThumbnailUrl(preview)} alt="" className="w-full h-full object-contain" />
                            ) : (
                                <i className="fa-solid fa-image text-slate-700" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-white truncate">{card.name || card.id}</p>
                            <p className="text-[11px] text-slate-500">#{card.number} · {card.rarity || '—'}</p>
                            <p className="text-2xl font-black text-brand-green tabular-nums mt-1">{fmtThb(currentThb)}</p>
                            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mt-0.5">
                                {sourceLabel} · {condition}
                            </p>
                        </div>
                    </div>

                    <div>
                        <label className={labelClass}>New market price (THB)</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">฿</span>
                            <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="any"
                                autoFocus
                                value={value}
                                onChange={(e) => { setValue(e.target.value); setError(null) }}
                                onKeyDown={(e) => { if (e.key === 'Enter') save() }}
                                placeholder="e.g. 350"
                                className={`${inputClass} pl-8 text-lg font-bold tabular-nums`}
                            />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                            Sets a fixed price the automatic pricing feed will not overwrite.
                            {isPinned && ' This card is currently pinned.'}
                        </p>
                    </div>

                    {error && (
                        <div className="bg-brand-red/10 border border-brand-red/30 text-brand-red text-sm rounded-lg px-4 py-2.5">{error}</div>
                    )}

                    <div className="flex gap-3">
                        {isPinned && (
                            <button
                                type="button"
                                onClick={release}
                                disabled={!!saving}
                                className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-3 rounded-lg transition-colors disabled:opacity-50"
                                title="Un-pin so automatic pricing can update this card again"
                            >
                                {saving === 'release' ? <i className="fa-solid fa-spinner fa-spin" /> : 'Reset to automatic'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={save}
                            disabled={!!saving}
                            className="flex-1 bg-brand-green text-black font-black uppercase tracking-widest py-3 rounded-lg hover:bg-white transition-colors disabled:opacity-50"
                        >
                            {saving === 'save' ? <i className="fa-solid fa-spinner fa-spin" /> : 'Set price'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

function CardFormModal({
    setId,
    editing,
    onClose,
    onCreated,
    onUpdated,
}: {
    setId: string
    editing: CardRow | null
    onClose: () => void
    onCreated: (card: CardRow) => void
    onUpdated: (card: CardRow) => void
}) {
    const isEdit = !!editing
    const fileRef = useRef<HTMLInputElement>(null)

    const [form, setForm] = useState({
        number: editing?.number ?? '',
        name: editing?.name ?? '',
        english_name: editing?.english_name ?? '',
        rarity: editing?.rarity ?? '',
        supertype: editing?.supertype ?? '',
        hp: editing?.hp != null ? String(editing.hp) : '',
        types: (editing?.types ?? []).join(', '),
        subtypes: (editing?.subtypes ?? []).join(', '),
    })
    const [file, setFile] = useState<File | null>(null)
    const [imageUrl, setImageUrl] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [justAdded, setJustAdded] = useState<string | null>(null)

    const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

    // Preview: a freshly chosen file wins, then a typed URL, then (edit) the
    // card's existing art.
    const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
    useEffect(() => () => { if (filePreview) URL.revokeObjectURL(filePreview) }, [filePreview])
    const preview = filePreview || imageUrl.trim() || editing?.image_large || editing?.image_small || null

    const computedId = isEdit ? editing!.id : `${setId}-${form.number || '?'}`

    function resetForRapidAdd() {
        setForm((f) => ({ ...f, number: '', name: '', english_name: '', hp: '' }))
        setFile(null)
        setImageUrl('')
        if (fileRef.current) fileRef.current.value = ''
    }

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setSaving(true)
        try {
            const fd = new FormData()
            if (!isEdit) fd.append('set_id', setId)
            fd.append('number', form.number)
            fd.append('name', form.name)
            fd.append('english_name', form.english_name)
            fd.append('rarity', form.rarity)
            fd.append('supertype', form.supertype)
            fd.append('hp', form.hp)
            fd.append('types', form.types)
            fd.append('subtypes', form.subtypes)
            if (file) fd.append('image', file)
            else if (imageUrl.trim()) fd.append('imageUrl', imageUrl.trim())

            const url = isEdit
                ? `/api/admin/catalog/cards/${encodeURIComponent(editing!.id)}`
                : '/api/admin/catalog/cards'
            const res = await fetch(url, { method: isEdit ? 'PATCH' : 'POST', body: fd })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to save card')

            if (isEdit) {
                onUpdated(data.card)
                onClose()
            } else {
                onCreated(data.card)
                setJustAdded(`${data.card.number} — ${data.card.name}`)
                resetForRapidAdd()
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <form onSubmit={submit} className="glass border border-white/10 rounded-2xl w-full max-w-3xl shadow-2xl max-h-[92vh] overflow-y-auto">
                <div className="p-6 border-b border-white/10 flex items-center justify-between sticky top-0 bg-brand-darker/80 backdrop-blur z-10">
                    <div>
                        <h2 className="text-xl font-black text-white italic">{isEdit ? 'Edit Card' : 'Add Card'}</h2>
                        <p className="text-xs text-slate-500 mt-1 font-mono">{computedId}</p>
                    </div>
                    <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
                        <i className="fa-solid fa-xmark text-xl" />
                    </button>
                </div>

                <div className="p-6 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
                    {/* Image column */}
                    <div className="space-y-3">
                        <label className={labelClass}>Card image</label>
                        <div
                            onClick={() => fileRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault()
                                const f = e.dataTransfer.files?.[0]
                                if (f) { setFile(f); setImageUrl('') }
                            }}
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
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f) { setFile(f); setImageUrl('') }
                            }}
                        />
                        <div>
                            <label className={labelClass}>…or paste an image URL</label>
                            <input
                                value={imageUrl}
                                onChange={(e) => { setImageUrl(e.target.value); setFile(null) }}
                                placeholder="https://..."
                                className={`${inputClass} font-mono text-xs`}
                            />
                        </div>
                        {file && (
                            <p className="text-[11px] text-slate-500 truncate">
                                <i className="fa-solid fa-paperclip mr-1" />{file.name}
                            </p>
                        )}
                    </div>

                    {/* Fields column */}
                    <div className="grid grid-cols-2 gap-4 content-start">
                        <div>
                            <label className={labelClass}>Number *</label>
                            <input required value={form.number} onChange={(e) => set('number', e.target.value)} placeholder="e.g. 25" className={`${inputClass} font-mono`} />
                        </div>
                        <div>
                            <label className={labelClass}>Rarity</label>
                            <input value={form.rarity} onChange={(e) => set('rarity', e.target.value)} placeholder="e.g. Rare" className={inputClass} />
                        </div>
                        <div className="col-span-2">
                            <label className={labelClass}>Name *</label>
                            <input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Pikachu" className={inputClass} />
                        </div>
                        <div className="col-span-2">
                            <label className={labelClass}>English name (for non-English cards)</label>
                            <input value={form.english_name} onChange={(e) => set('english_name', e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label className={labelClass}>Supertype</label>
                            <input value={form.supertype} onChange={(e) => set('supertype', e.target.value)} placeholder="Pokémon / Trainer / Energy" className={inputClass} />
                        </div>
                        <div>
                            <label className={labelClass}>HP</label>
                            <input type="number" value={form.hp} onChange={(e) => set('hp', e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label className={labelClass}>Types (comma-separated)</label>
                            <input value={form.types} onChange={(e) => set('types', e.target.value)} placeholder="Lightning" className={inputClass} />
                        </div>
                        <div>
                            <label className={labelClass}>Subtypes (comma-separated)</label>
                            <input value={form.subtypes} onChange={(e) => set('subtypes', e.target.value)} placeholder="Basic" className={inputClass} />
                        </div>
                    </div>
                </div>

                <div className="px-6 pb-6 space-y-3">
                    {error && (
                        <div className="bg-brand-red/10 border border-brand-red/30 text-brand-red text-sm rounded-lg px-4 py-2.5">{error}</div>
                    )}
                    {justAdded && !error && (
                        <div className="bg-brand-green/10 border border-brand-green/30 text-brand-green text-sm rounded-lg px-4 py-2.5">
                            <i className="fa-solid fa-check mr-2" />Added {justAdded}. Form cleared — add another.
                        </div>
                    )}
                    <div className="flex gap-3">
                        <button type="button" onClick={onClose} className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-3 rounded-lg transition-colors">
                            {isEdit ? 'Cancel' : 'Done'}
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 bg-brand-cyan text-black font-black uppercase tracking-widest py-3 rounded-lg hover:bg-white transition-colors disabled:opacity-50"
                        >
                            {saving ? <i className="fa-solid fa-spinner fa-spin" /> : isEdit ? 'Save Changes' : 'Add Card'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    )
}
