'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Admin rewards console: economy health tiles, the monthly real-cost budget
 * (the voucher circuit breaker), top earners, manual adjust, and per-order
 * clawback (the compensating rail for manual Stripe refunds).
 * Admin surfaces are EN-only by convention.
 */

interface TopEarner {
    user_id: string
    display_name: string | null
    username: string | null
    coin_balance: number
    xp_total: number
    level: number
}

interface Metrics {
    total_coin_balance?: number
    unexpired_lot_coins?: number
    minted_30d?: number
    spent_30d?: number
    earners?: number
    budget?: { month: string; budget_satang: number; spent_satang: number } | null
    top_earners?: TopEarner[]
}

const satangToBaht = (s: number | undefined | null) => `฿${(((s ?? 0) as number) / 100).toLocaleString()}`
const coins = (c: number | undefined | null) => ((c ?? 0) as number).toLocaleString()

export default function AdminRewardsPage() {
    const [metrics, setMetrics] = useState<Metrics | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)

    const [budgetBaht, setBudgetBaht] = useState('')
    const [adjUser, setAdjUser] = useState('')
    const [adjXp, setAdjXp] = useState('0')
    const [adjCoins, setAdjCoins] = useState('0')
    const [adjNote, setAdjNote] = useState('')
    const [clawOrder, setClawOrder] = useState('')
    const [clawNote, setClawNote] = useState('')

    const load = useCallback(async () => {
        setError(null)
        try {
            const res = await fetch('/api/admin/rewards')
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to load')
            setMetrics(data.metrics ?? {})
        } catch (e) {
            setError((e as Error).message)
        }
    }, [])

    useEffect(() => { void load() }, [load])

    const post = useCallback(async (payload: Record<string, unknown>, doneMsg: string) => {
        setBusy(true)
        setNotice(null)
        setError(null)
        try {
            const res = await fetch('/api/admin/rewards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            const data = await res.json()
            if (!res.ok || data.error) throw new Error(data.error || 'Action failed')
            setNotice(doneMsg)
            await load()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }, [load])

    const budget = metrics?.budget ?? null
    const inputCls = 'h-9 rounded-lg bg-white/5 border border-white/10 px-3 text-sm text-white outline-none focus:border-brand-cyan/60 placeholder:text-slate-600'
    const btnCls = 'h-9 px-4 rounded-lg bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-wider disabled:opacity-40'

    return (
        <div className="p-6 max-w-5xl space-y-6">
            <div>
                <h1 className="text-xl font-black text-white uppercase tracking-wide">Collector Pass</h1>
                <p className="text-xs text-slate-500 mt-1">Economy health, budget breaker, adjustments, clawback.</p>
            </div>

            {error && <div className="rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs p-3">{error}</div>}
            {notice && <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs p-3">{notice}</div>}

            {/* Tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                    { label: 'Outstanding coins', value: coins(metrics?.total_coin_balance), sub: `face ${satangToBaht(metrics?.total_coin_balance)}` },
                    { label: 'Unexpired lots', value: coins(metrics?.unexpired_lot_coins), sub: 'FIFO liability' },
                    { label: 'Minted 30d', value: coins(metrics?.minted_30d), sub: `spent 30d: ${coins(metrics?.spent_30d)}` },
                    { label: 'Users with XP', value: coins(metrics?.earners), sub: 'ever earned' },
                ].map((tile) => (
                    <div key={tile.label} className="rounded-2xl bg-white/5 border border-white/10 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{tile.label}</p>
                        <p className="text-2xl font-black text-white tabular-nums mt-1">{tile.value}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{tile.sub}</p>
                    </div>
                ))}
            </div>

            {/* Budget */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Voucher budget {budget ? `— ${budget.month}` : '(no row for this month yet)'}
                </p>
                {budget && (
                    <div>
                        <div className="flex justify-between text-xs font-bold text-slate-300 mb-1 tabular-nums">
                            <span>spent {satangToBaht(budget.spent_satang)}</span>
                            <span>budget {satangToBaht(budget.budget_satang)}</span>
                        </div>
                        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                            <div
                                className={`h-full ${budget.spent_satang >= budget.budget_satang ? 'bg-red-400' : 'bg-brand-cyan'}`}
                                style={{ width: `${Math.min(100, Math.round((budget.spent_satang / Math.max(1, budget.budget_satang)) * 100))}%` }}
                            />
                        </div>
                    </div>
                )}
                <div className="flex gap-2 items-center">
                    <input value={budgetBaht} onChange={(e) => setBudgetBaht(e.target.value)} placeholder="New budget (baht)" className={inputCls} />
                    <button
                        disabled={busy || !Number.isFinite(Number(budgetBaht)) || Number(budgetBaht) < 0}
                        onClick={() => void post({ action: 'set_budget', budgetSatang: Math.round(Number(budgetBaht) * 100) }, 'Budget updated')}
                        className={btnCls}
                    >
                        Set budget
                    </button>
                </div>
            </div>

            {/* Top earners */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Top earners (lifetime XP)</p>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-slate-500 uppercase text-[10px]">
                                <th className="py-1 pr-4">User</th>
                                <th className="py-1 pr-4">Level</th>
                                <th className="py-1 pr-4">XP</th>
                                <th className="py-1 pr-4">Coins</th>
                                <th className="py-1">Id</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(metrics?.top_earners ?? []).map((u) => (
                                <tr key={u.user_id} className="border-t border-white/5 text-slate-300">
                                    <td className="py-1.5 pr-4 font-bold text-white">{u.display_name || u.username || '—'}</td>
                                    <td className="py-1.5 pr-4 tabular-nums">{u.level}</td>
                                    <td className="py-1.5 pr-4 tabular-nums">{u.xp_total.toLocaleString()}</td>
                                    <td className="py-1.5 pr-4 tabular-nums">{u.coin_balance.toLocaleString()}</td>
                                    <td className="py-1.5 font-mono text-[10px] text-slate-500">{u.user_id}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Manual adjust */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Manual adjust (audited; negatives allowed)</p>
                <div className="flex flex-wrap gap-2 items-center">
                    <input value={adjUser} onChange={(e) => setAdjUser(e.target.value)} placeholder="User id" className={`${inputCls} w-72 font-mono`} />
                    <input value={adjXp} onChange={(e) => setAdjXp(e.target.value)} placeholder="XP" className={`${inputCls} w-24`} />
                    <input value={adjCoins} onChange={(e) => setAdjCoins(e.target.value)} placeholder="Coins" className={`${inputCls} w-24`} />
                    <input value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="Note (why)" className={`${inputCls} flex-1 min-w-40`} />
                    <button
                        disabled={busy || !adjUser || !adjNote || (Number(adjXp) === 0 && Number(adjCoins) === 0)}
                        onClick={() => void post({ action: 'adjust', userId: adjUser.trim(), xp: Number(adjXp) || 0, coins: Number(adjCoins) || 0, note: adjNote }, 'Adjustment applied')}
                        className={btnCls}
                    >
                        Apply
                    </button>
                </div>
            </div>

            {/* Clawback */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Refund clawback — reverses every XP/coin earned from one order and records the refund
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                    <input value={clawOrder} onChange={(e) => setClawOrder(e.target.value)} placeholder="Order id" className={`${inputCls} w-72 font-mono`} />
                    <input value={clawNote} onChange={(e) => setClawNote(e.target.value)} placeholder="Note" className={`${inputCls} flex-1 min-w-40`} />
                    <button
                        disabled={busy || !clawOrder}
                        onClick={() => void post({ action: 'clawback_order', orderId: clawOrder.trim(), note: clawNote }, 'Clawback applied')}
                        className={btnCls}
                    >
                        Claw back
                    </button>
                </div>
            </div>
        </div>
    )
}
