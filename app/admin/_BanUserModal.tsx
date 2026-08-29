'use client'

import { useEffect, useState } from 'react'

export interface BanTarget {
    id: string
    display_name: string | null
    username: string | null
    email: string | null
}

interface BanOutcome {
    ok: boolean
    error?: string
    authBanned?: boolean
    profileFlagged?: boolean
    listingsRemoved?: number
    stripeRejected?: boolean | string | null
}

/**
 * Confirmation dialog for permanently banning an account. Shows exactly what
 * the ban does, takes a reason, and gates the irreversible Stripe rejection
 * behind its own checkbox (off by default).
 */
export default function BanUserModal({
    target,
    defaultReason,
    onClose,
    onBanned,
}: {
    target: BanTarget | null
    defaultReason?: string
    onClose: () => void
    onBanned: () => void
}) {
    const [reason, setReason] = useState('')
    const [rejectStripe, setRejectStripe] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [outcome, setOutcome] = useState<BanOutcome | null>(null)

    useEffect(() => {
        if (target) {
            setReason(defaultReason ?? '')
            setRejectStripe(false)
            setOutcome(null)
        }
    }, [target, defaultReason])

    if (!target) return null

    const name = target.display_name || target.username || target.email || target.id.slice(0, 8)

    const submit = async () => {
        setSubmitting(true)
        try {
            const res = await fetch(`/api/admin/users/${target.id}/ban`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason, rejectStripe }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setOutcome({ ok: false, error: data?.error ?? `Request failed (${res.status})` })
            } else {
                setOutcome({ ok: true, ...data })
                onBanned()
            }
        } catch (err) {
            setOutcome({ ok: false, error: err instanceof Error ? err.message : 'Network error' })
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={submitting ? undefined : onClose} />
            <div className="relative w-full max-w-md bg-brand-darker border border-brand-red/30 rounded-2xl shadow-2xl overflow-hidden">
                <div className="p-5 border-b border-white/5">
                    <h3 className="text-lg font-black text-white">Ban account</h3>
                    <p className="text-sm text-slate-400 mt-1">
                        {name}{target.email ? ` · ${target.email}` : ''}
                    </p>
                </div>

                {outcome ? (
                    <div className="p-5 space-y-3">
                        {outcome.ok ? (
                            <>
                                <p className="text-sm font-bold text-brand-green">Account banned.</p>
                                <ul className="text-xs text-slate-400 space-y-1.5">
                                    <li>• Sign-in and session refresh are blocked (existing sessions die within 1 hour).</li>
                                    <li>• {outcome.listingsRemoved ?? 0} active/draft listing{(outcome.listingsRemoved ?? 0) === 1 ? '' : 's'} taken off the marketplace.</li>
                                    {outcome.profileFlagged === false && (
                                        <li className="text-yellow-400">• Profile ban flag not stored — run the 20260829_account_bans_listing_removal migration. The auth-level ban still holds.</li>
                                    )}
                                    {outcome.stripeRejected === true && <li>• Stripe account rejected — charges and payouts permanently disabled.</li>}
                                    {typeof outcome.stripeRejected === 'string' && (
                                        <li className="text-yellow-400">• Stripe rejection: {outcome.stripeRejected}</li>
                                    )}
                                </ul>
                            </>
                        ) : (
                            <p className="text-sm font-bold text-brand-red">{outcome.error}</p>
                        )}
                        <button
                            onClick={onClose}
                            className="w-full h-11 bg-white/10 hover:bg-white/15 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-colors"
                        >
                            Close
                        </button>
                    </div>
                ) : (
                    <div className="p-5 space-y-4">
                        <ul className="text-xs text-slate-400 space-y-1.5 bg-black/30 border border-white/5 rounded-xl p-3">
                            <li>• Blocks sign-in and session refresh permanently (reversible via Unban).</li>
                            <li>• Takes all their active and draft listings off the marketplace.</li>
                            <li>• Does not touch past orders or Stripe unless ticked below.</li>
                        </ul>

                        <div>
                            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Reason (kept on record)</label>
                            <textarea
                                value={reason}
                                onChange={e => setReason(e.target.value)}
                                className="w-full h-20 bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white placeholder-slate-600 outline-none focus:border-brand-red/50 resize-none"
                                placeholder="e.g. Selling counterfeit cards (report #…)"
                            />
                        </div>

                        <label className="flex items-start gap-3 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={rejectStripe}
                                onChange={e => setRejectStripe(e.target.checked)}
                                className="mt-0.5 h-4 w-4 accent-red-500"
                            />
                            <span className="text-xs text-slate-300">
                                Also reject their Stripe account (marks it fraudulent — kills charges and payouts).
                                <span className="text-brand-red font-bold"> Irreversible</span>: Stripe does not allow un-rejecting an account.
                            </span>
                        </label>

                        <div className="flex gap-3 pt-1">
                            <button
                                onClick={onClose}
                                disabled={submitting}
                                className="flex-1 h-11 bg-white/5 hover:bg-white/10 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={submit}
                                disabled={submitting}
                                className="flex-1 h-11 bg-brand-red hover:bg-red-500 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {submitting ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-ban" />}
                                Ban account
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
