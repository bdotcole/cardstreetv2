'use client'

import { useEffect, useState } from 'react'

interface MissingSet {
    console_name: string
    card_products: number
    mapped_products: number
    release_date: string | null
    first_seen_at: string
}

/**
 * PriceCharting sets we carry poorly or not at all, for the selected game and
 * language (/api/admin/catalog/coverage). "Matched" counts the set's singles that
 * we have linked to PriceCharting, so a low number means the set is missing from
 * the catalog or present but unpriced. Refreshed daily by the pricecharting cron.
 */
export default function MissingSetsPanel({ game, language }: { game: string; language: string }) {
    const [sets, setSets] = useState<MissingSet[] | null>(null)
    const [available, setAvailable] = useState(true)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        let cancelled = false
        setSets(null)
        fetch(`/api/admin/catalog/coverage?game=${encodeURIComponent(game)}&language=${encodeURIComponent(language)}`)
            .then((r) => (r.ok ? r.json() : { available: false, sets: [] }))
            .then((j) => {
                if (cancelled) return
                setAvailable(j.available !== false)
                setSets(Array.isArray(j.sets) ? j.sets : [])
            })
            .catch(() => { if (!cancelled) { setAvailable(false); setSets([]) } })
        return () => { cancelled = true }
    }, [game, language])

    if (language === 'th') return null
    if (sets === null) return null
    if (!available) {
        return (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-400">
                Missing-set report not available yet: run the 20261006 PriceCharting migration, then it fills after the next daily PriceCharting run.
            </div>
        )
    }
    if (sets.length === 0) return null

    const recent = sets.filter((s) => s.release_date && Date.now() - Date.parse(s.release_date) < 120 * 86_400_000).length

    return (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
            >
                <span className="text-sm text-amber-200 font-bold">
                    <i className="fa-solid fa-triangle-exclamation mr-2" />
                    {sets.length} PriceCharting {sets.length === 1 ? 'set' : 'sets'} we barely carry
                    {recent > 0 && <span className="text-amber-400"> ({recent} released in the last 4 months)</span>}
                </span>
                <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-amber-300 text-xs`} />
            </button>
            {open && (
                <div className="px-4 pb-4">
                    <p className="text-[11px] text-slate-400 mb-3">
                        Matched = singles in that set we have linked to PriceCharting. A low number means the set is
                        missing from our catalog, or present but unpriced.
                    </p>
                    <div className="max-h-96 overflow-y-auto rounded-lg border border-white/10">
                        <table className="w-full text-xs">
                            <thead className="bg-white/5 text-slate-400 uppercase tracking-widest text-[10px]">
                                <tr>
                                    <th className="text-left px-3 py-2">PriceCharting set</th>
                                    <th className="text-left px-3 py-2">Released</th>
                                    <th className="text-right px-3 py-2">Matched</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sets.map((s) => (
                                    <tr key={s.console_name} className="border-t border-white/5 text-slate-200">
                                        <td className="px-3 py-2">{s.console_name}</td>
                                        <td className="px-3 py-2 text-slate-400">{s.release_date ?? '-'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            {s.mapped_products} / {s.card_products}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}
