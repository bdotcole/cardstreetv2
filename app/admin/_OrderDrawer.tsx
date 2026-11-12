'use client'

import { useEffect, useState } from 'react'
import { AccountDrawer } from './_AccountDrawer'
import { OrderPane } from './orders/_OrderPane'

// One order opened over whatever admin page you are on (the dashboard's Sold
// Listings table): the same pane the order lookup shows, so the cards, the
// parcel, both parties' contact details and the message boxes are one click
// from a sale instead of a copy-paste into the lookup.

export function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
    // Another order of the same checkout, or one picked in the account drawer.
    const [current, setCurrent] = useState(orderId)
    const [account, setAccount] = useState<string | null>(null)

    useEffect(() => { setCurrent(orderId) }, [orderId])

    useEffect(() => {
        // The account drawer sits on top and closes itself on Escape first.
        if (account) return
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [account, onClose])

    return (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Order details">
            <div className="absolute inset-0 bg-black/60" onClick={onClose} />
            <aside className="relative h-full w-full max-w-4xl bg-brand-darker border-l border-white/10 shadow-2xl flex flex-col animate-fadeIn">
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/5">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Order</p>
                    <div className="flex items-center gap-4">
                        <a href={`/admin/orders?q=${current}`} className="text-[11px] font-bold text-brand-cyan hover:underline">
                            Open in order lookup <i className="fa-solid fa-arrow-up-right-from-square text-[9px]" />
                        </a>
                        <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-white transition">
                            <i className="fa-solid fa-xmark" />
                        </button>
                    </div>
                </div>
                <div className="flex-1 min-h-0 flex flex-col p-4">
                    <OrderPane key={current} orderId={current} onOpenOrder={setCurrent} onShowAccount={setAccount} />
                </div>
            </aside>
            {account && (
                <AccountDrawer
                    userId={account}
                    onClose={() => setAccount(null)}
                    onOpenOrder={id => { setAccount(null); setCurrent(id) }}
                />
            )}
        </div>
    )
}
