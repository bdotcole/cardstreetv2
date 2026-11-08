'use client'

import { useEffect, useState } from 'react'
import { personName, type InboxItem, type InboxPerson } from '@/lib/supportInbox'
import { TranslationBlock, useTranslator } from '../_translation'
import { StatusChip } from './_parts'

const REPORT_ACTIONS: { status: string; label: string }[] = [
    { status: 'Reviewed', label: 'Mark reviewed' },
    { status: 'Resolved', label: 'Resolved' },
    { status: 'Dismissed', label: 'Dismiss' },
]

/**
 * A listing or seller reported from the app. Removing the listing or banning
 * the seller stays on the User Reports page, which has those tools; answering
 * the reporter (or the seller) is a DM from the support shop, here.
 */
export function ReportPane({ item, auto, onChanged, onMessage, onShowAccount }: {
    item: InboxItem
    auto: boolean
    onChanged: () => void
    onMessage: (person: InboxPerson) => void
    /** Opens the account drawer (listings, sales, purchases) for the reporter or the seller. */
    onShowAccount?: (userId: string) => void
}) {
    const report = item.report!
    const [status, setStatus] = useState(item.status)
    const [busy, setBusy] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const translator = useTranslator()
    const { translate } = translator

    useEffect(() => {
        if (auto && report.description) translate([{ id: 'description', text: report.description }])
    }, [auto, report.description, translate])

    const setReportStatus = async (next: string) => {
        setBusy(next)
        setNotice(null)
        try {
            const res = await fetch(`/api/admin/reports/${item.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: next }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setNotice(data.error || `Could not update (${res.status}).`)
                return
            }
            setStatus(next)
            onChanged()
        } catch {
            setNotice('Could not update. Check the connection and try again.')
        } finally {
            setBusy(null)
        }
    }

    const listing = report.listing
    const reporter = item.person
    const target = report.target

    return (
        <div className="flex-1 flex flex-col min-h-0 min-w-0 space-y-3">
            <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <StatusChip status={status} />
                    <span className="text-[9px] font-bold text-slate-500 uppercase bg-white/5 px-2 py-0.5 rounded-full">Reported {report.entityType}</span>
                </div>
                <h2 className="text-base font-black text-rose-300 break-words">{report.reason}</h2>
                <p className="text-[11px] text-slate-500">
                    From <span className="text-slate-400 font-semibold">{reporter ? personName(reporter) : 'Unknown user'}</span> · {new Date(item.lastAt).toLocaleString()}
                </p>
            </div>

            <div className="glass rounded-2xl border border-white/10 p-4 space-y-4 flex-1 min-h-[16rem] overflow-y-auto">
                <div className="bg-white/5 rounded-xl p-3">
                    <p className="text-[10px] font-bold uppercase text-slate-500 mb-1">What they wrote</p>
                    {report.description ? (
                        <>
                            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{report.description}</p>
                            <TranslationBlock id="description" text={report.description} translator={translator} auto={auto} />
                        </>
                    ) : (
                        <p className="text-sm text-slate-500 italic">No details, only the reason.</p>
                    )}
                </div>

                <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Reported</p>
                    {listing ? (
                        <div className="flex gap-3 bg-white/5 rounded-xl p-3">
                            {listing.photo && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={listing.photo} alt="" className="w-16 h-22 object-cover rounded-md shrink-0 bg-black/30" />
                            )}
                            <div className="min-w-0 space-y-1">
                                <p className="text-sm font-bold text-slate-200 break-words">{listing.cardName ?? report.entityName ?? 'Listing'}</p>
                                <p className="text-[11px] text-slate-500">
                                    {listing.price != null ? `฿${Math.round(Number(listing.price)).toLocaleString()} · ` : ''}listing {listing.status ?? 'unknown'}
                                </p>
                                {listing.cardId && (
                                    <a href={`/card/${listing.cardId}`} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-brand-cyan hover:underline">
                                        Card page ↗
                                    </a>
                                )}
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-300">{report.entityName ?? `${report.entityType} ${report.entityId}`}</p>
                    )}
                    {target && (
                        <p className="text-[11px] text-slate-500">
                            Seller: <span className="text-slate-300 font-semibold">{personName(target)}</span>
                            {target.username ? ` · @${target.username}` : ''}
                        </p>
                    )}
                </div>

                <div className="flex flex-wrap gap-2">
                    {reporter && (
                        <button onClick={() => onMessage(reporter)} className="px-3 py-2 rounded-lg bg-brand-cyan/10 border border-brand-cyan/30 text-brand-cyan text-xs font-bold hover:bg-brand-cyan/20">
                            <i className="fa-regular fa-comment mr-1.5" />Message reporter
                        </button>
                    )}
                    {target && (
                        <button onClick={() => onMessage(target)} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs font-bold hover:bg-white/10">
                            <i className="fa-regular fa-comment mr-1.5" />Message seller
                        </button>
                    )}
                    {reporter && onShowAccount && (
                        <button onClick={() => onShowAccount(reporter.id)} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs font-bold hover:bg-white/10">
                            <i className="fa-regular fa-id-card mr-1.5" />Reporter&apos;s account
                        </button>
                    )}
                    {target && onShowAccount && (
                        <button onClick={() => onShowAccount(target.id)} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs font-bold hover:bg-white/10">
                            <i className="fa-regular fa-id-card mr-1.5" />Seller&apos;s account
                        </button>
                    )}
                    <a href="/admin/reports" className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-xs font-bold hover:bg-white/10">
                        Remove listing or ban: User Reports →
                    </a>
                </div>
            </div>

            <div className="space-y-2">
                {notice && <p className="text-[11px] text-amber-300">{notice}</p>}
                <div className="flex flex-wrap items-center justify-end gap-2">
                    {status !== 'Open' && (
                        <button
                            onClick={() => setReportStatus('Open')}
                            disabled={!!busy}
                            className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-sm font-bold hover:bg-white/10 disabled:opacity-50"
                        >
                            {busy === 'Open' ? 'Saving…' : 'Reopen'}
                        </button>
                    )}
                    {REPORT_ACTIONS.filter(a => a.status !== status).map(a => (
                        <button
                            key={a.status}
                            onClick={() => setReportStatus(a.status)}
                            disabled={!!busy}
                            className={`px-4 py-2.5 rounded-xl text-sm font-black disabled:opacity-50 ${a.status === 'Resolved'
                                ? 'bg-brand-cyan text-brand-darker hover:brightness-110'
                                : 'bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10'}`}
                        >
                            {busy === a.status ? 'Saving…' : a.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
