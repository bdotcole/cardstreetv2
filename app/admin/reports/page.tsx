'use client'

import { useCallback, useEffect, useState } from 'react'
import BanUserModal, { type BanTarget } from '../_BanUserModal'

interface PersonInfo {
    id: string
    display_name: string | null
    username: string | null
    email: string | null
    created_at: string | null
    banned_at: string | null
    banned_reason: string | null
    active_listings: number
    stripe_account_id: string | null
    stripe_account_status: string | null
    stripe_region: string | null
}

interface ReportListing {
    id: string
    card_id: string | null
    status: string
    price: number
    condition: string | null
    is_graded: boolean | null
    grading_company: string | null
    grade: string | null
    created_at: string
    card_name: string | null
    catalog_image: string | null
    photo_front: string | null
    photo_back: string | null
    seller: PersonInfo | null
}

interface ReportRow {
    id: string
    created_at: string
    status: string
    reason: string
    description: string | null
    entity_type: 'listing' | 'seller' | 'other'
    entity_id: string
    entity_name: string | null
    reporter: PersonInfo | null
    listing: ReportListing | null
    target_seller: PersonInfo | null
}

const REPORT_STATUS_COLORS: Record<string, string> = {
    Open: 'bg-brand-purple/20 text-brand-purple border-brand-purple/30',
    Reviewed: 'bg-brand-cyan/20 text-brand-cyan border-brand-cyan/30',
    Resolved: 'bg-brand-green/20 text-brand-green border-brand-green/30',
    Dismissed: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
}

const LISTING_STATUS_COLORS: Record<string, string> = {
    active: 'bg-brand-green/20 text-brand-green border-brand-green/30',
    draft: 'bg-brand-cyan/20 text-brand-cyan border-brand-cyan/30',
    sold: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    cancelled: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    removed: 'bg-brand-red/20 text-brand-red border-brand-red/30',
}

function SellerBox({ seller, onBan, onUnban, onRejectStripe, banBusy }: {
    seller: PersonInfo
    onBan: () => void
    onUnban: () => void
    onRejectStripe: () => void
    banBusy: boolean
}) {
    const stripeRejected = seller.stripe_account_status === 'rejected'
    // Stripe only permits accounts.reject where the platform is liable for
    // negative balances. TH uses direct charges with the seller as merchant of
    // record, so rejection can never succeed there — don't offer it as live.
    const rejectUnavailable = (seller.stripe_region ?? 'th') === 'th'
    return (
        <div className="bg-black/30 border border-white/5 rounded-xl p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Seller</p>
                {seller.banned_at ? (
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-brand-red/20 text-brand-red border border-brand-red/30">Banned</span>
                ) : null}
            </div>
            <p className="text-sm font-bold text-white">
                {seller.display_name ?? 'Unnamed'}
                {seller.username && <span className="text-slate-500 font-normal"> @{seller.username}</span>}
            </p>
            {seller.email && <p className="text-xs text-slate-400">{seller.email}</p>}
            <p className="text-[10px] text-slate-500">
                Joined {seller.created_at ? new Date(seller.created_at).toLocaleDateString() : '—'} · {seller.active_listings} live listing{seller.active_listings === 1 ? '' : 's'}
            </p>
            {seller.banned_reason && <p className="text-[10px] text-brand-red/80">Ban reason: {seller.banned_reason}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
                <a
                    href={`/admin/listings?seller=${seller.id}&status=all`}
                    className="px-2.5 py-1 text-[10px] font-bold text-brand-cyan bg-brand-cyan/10 border border-brand-cyan/20 rounded-lg hover:bg-brand-cyan/20 transition"
                >
                    All their listings
                </a>
                {seller.banned_at ? (
                    <>
                        <button
                            onClick={onUnban}
                            disabled={banBusy}
                            className="px-2.5 py-1 text-[10px] font-bold text-slate-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition disabled:opacity-40"
                        >
                            Unban
                        </button>
                        {seller.stripe_account_id && (
                            <button
                                onClick={onRejectStripe}
                                disabled={banBusy || stripeRejected || rejectUnavailable}
                                title={
                                    stripeRejected ? 'Stripe account already rejected'
                                        : rejectUnavailable ? 'Stripe does not allow rejecting accounts on the TH platform — rejection requires the platform to be liable for negative balances, but the seller is merchant of record under direct charges. The account ban is the effective control.'
                                            : 'Permanently disable charges and payouts on their Stripe account'
                                }
                                className="px-2.5 py-1 text-[10px] font-black uppercase text-brand-red bg-brand-red/10 border border-brand-red/20 rounded-lg hover:bg-brand-red/20 transition disabled:opacity-40"
                            >
                                <i className="fa-brands fa-stripe-s mr-1" />
                                {stripeRejected ? 'Stripe rejected' : rejectUnavailable ? 'Stripe reject N/A' : 'Reject Stripe'}
                            </button>
                        )}
                    </>
                ) : (
                    <button
                        onClick={onBan}
                        disabled={banBusy}
                        className="px-2.5 py-1 text-[10px] font-black uppercase text-brand-red bg-brand-red/10 border border-brand-red/20 rounded-lg hover:bg-brand-red/20 transition disabled:opacity-40"
                    >
                        <i className="fa-solid fa-ban mr-1" />Ban account
                    </button>
                )}
            </div>
        </div>
    )
}

export default function AdminReportsPage() {
    const [reports, setReports] = useState<ReportRow[]>([])
    const [banColumnsPresent, setBanColumnsPresent] = useState(true)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState('')
    const [filter, setFilter] = useState<'Open' | 'all'>('Open')
    const [busyId, setBusyId] = useState<string | null>(null)
    const [banTarget, setBanTarget] = useState<BanTarget | null>(null)
    const [banDefaultReason, setBanDefaultReason] = useState('')
    const [banSourceReportId, setBanSourceReportId] = useState<string | null>(null)

    const fetchReports = useCallback(async () => {
        setLoadError('')
        try {
            const res = await fetch('/api/admin/reports')
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setLoadError(data?.error ?? `Failed to load reports (${res.status})`)
                return
            }
            setReports(data.reports ?? [])
            setBanColumnsPresent(data.banColumnsPresent !== false)
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Network error')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchReports() }, [fetchReports])

    const patchReport = async (id: string, status: string) => {
        setBusyId(id)
        try {
            await fetch(`/api/admin/reports/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            })
            await fetchReports()
        } finally {
            setBusyId(null)
        }
    }

    const removeListing = async (report: ReportRow) => {
        if (!report.listing) return
        const label = report.listing.card_name ?? report.entity_name ?? report.listing.id
        if (!window.confirm(`Take "${label}" off the marketplace and mark this report resolved?`)) return
        setBusyId(report.id)
        try {
            const res = await fetch(`/api/admin/listings/${report.listing.id}`, { method: 'DELETE' })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                window.alert(data?.error ?? 'Failed to remove listing')
                return
            }
            await fetch(`/api/admin/reports/${report.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'Resolved' }),
            })
            await fetchReports()
        } finally {
            setBusyId(null)
        }
    }

    const unbanSeller = async (report: ReportRow, seller: PersonInfo) => {
        if (!window.confirm(`Lift the ban on ${seller.display_name ?? seller.email ?? seller.id}? Removed listings stay removed.`)) return
        setBusyId(report.id)
        try {
            const res = await fetch(`/api/admin/users/${seller.id}/ban`, { method: 'DELETE' })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                window.alert(data?.error ?? 'Failed to unban')
            }
            await fetchReports()
        } finally {
            setBusyId(null)
        }
    }

    const rejectStripe = async (report: ReportRow, seller: PersonInfo) => {
        const name = seller.display_name ?? seller.email ?? seller.id
        const confirmed = window.confirm(
            `Permanently reject ${name}'s Stripe account (${seller.stripe_account_id})?\n\n` +
            `This disables charges and payouts on it for good. Stripe does NOT allow un-rejecting an account — ` +
            `there is no way to undo this, including via Stripe support.`
        )
        if (!confirmed) return
        setBusyId(report.id)
        try {
            const res = await fetch(`/api/admin/users/${seller.id}/stripe-reject`, { method: 'POST' })
            const data = await res.json().catch(() => ({}))
            window.alert(res.ok
                ? `Stripe account ${data.accountId ?? ''} rejected — charges and payouts are permanently disabled.`
                : `Could not reject: ${data?.error ?? res.status}`)
            await fetchReports()
        } finally {
            setBusyId(null)
        }
    }

    const openBanModal = (report: ReportRow, seller: PersonInfo) => {
        setBanTarget({ id: seller.id, display_name: seller.display_name, username: seller.username, email: seller.email })
        setBanDefaultReason(`Report: ${report.reason}${report.description ? ` — ${report.description}` : ''}`.slice(0, 300))
        setBanSourceReportId(report.id)
    }

    const onBanned = async () => {
        if (banSourceReportId) {
            await fetch(`/api/admin/reports/${banSourceReportId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'Resolved' }),
            }).catch(() => { })
        }
        await fetchReports()
    }

    const visible = filter === 'all' ? reports : reports.filter(r => r.status === 'Open')
    const openCount = reports.filter(r => r.status === 'Open').length

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">User Reports</h1>
                    <p className="text-slate-500 text-sm mt-1">{openCount} open · {reports.length} total</p>
                </div>
                <div className="flex gap-2">
                    {(['Open', 'all'] as const).map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl border transition ${filter === f
                                ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30'
                                : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
                                }`}
                        >
                            {f === 'all' ? 'All' : 'Open'}
                        </button>
                    ))}
                </div>
            </div>

            {!banColumnsPresent && (
                <div className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 font-semibold">
                    Ban-tracking columns are missing — run supabase/migrations/20260829_account_bans_listing_removal.sql in the SQL Editor.
                    Bans still lock accounts out (auth-level), but banned status won&apos;t display here until the migration runs.
                </div>
            )}

            {loadError && (
                <div className="text-xs text-brand-red bg-brand-red/10 border border-brand-red/20 rounded-xl p-3 font-semibold">
                    Failed to load reports: {loadError}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="animate-spin h-8 w-8 border-2 border-white/10 border-t-brand-cyan rounded-full" />
                </div>
            ) : visible.length === 0 ? (
                <div className="glass rounded-2xl border border-white/10 p-10 text-center text-slate-500 font-semibold">
                    {filter === 'Open' ? 'No open reports.' : 'No reports found.'}
                </div>
            ) : (
                <div className="space-y-4">
                    {visible.map(report => {
                        const seller = report.listing?.seller ?? report.target_seller
                        const busy = busyId === report.id
                        const listingLive = report.listing != null && ['active', 'draft'].includes(report.listing.status)
                        return (
                            <div key={report.id} className="glass rounded-2xl border border-white/10 p-5 space-y-4">
                                {/* Header */}
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${REPORT_STATUS_COLORS[report.status] ?? REPORT_STATUS_COLORS.Open}`}>
                                                {report.status}
                                            </span>
                                            <span className="text-[10px] uppercase tracking-widest font-black text-brand-cyan bg-brand-cyan/10 px-2 py-0.5 rounded">
                                                {report.entity_type}
                                            </span>
                                            <span className="text-[10px] text-slate-500 font-mono">
                                                {new Date(report.created_at).toLocaleString()}
                                            </span>
                                        </div>
                                        <p className="text-base font-black text-brand-red mt-2">{report.reason}</p>
                                        <p className="text-sm text-slate-300 mt-1">{report.description || 'No additional details provided.'}</p>
                                        <p className="text-[10px] text-slate-500 mt-2">
                                            Reported by <span className="text-slate-300 font-bold">{report.reporter?.display_name ?? 'Unknown'}</span>
                                            {report.reporter?.email ? ` (${report.reporter.email})` : ''}
                                        </p>
                                    </div>
                                </div>

                                {/* Target */}
                                <div className="grid gap-4 md:grid-cols-2">
                                    {report.listing ? (
                                        <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex gap-3">
                                            {(report.listing.photo_front || report.listing.catalog_image) && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={report.listing.photo_front ?? report.listing.catalog_image ?? ''}
                                                    alt=""
                                                    className="w-16 h-22 min-h-[5.5rem] object-cover rounded-lg bg-white/5 shrink-0"
                                                />
                                            )}
                                            <div className="min-w-0 space-y-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Listing</p>
                                                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${LISTING_STATUS_COLORS[report.listing.status] ?? LISTING_STATUS_COLORS.cancelled}`}>
                                                        {report.listing.status}
                                                    </span>
                                                </div>
                                                <p className="text-sm font-bold text-white truncate">{report.listing.card_name ?? report.entity_name ?? 'Unknown card'}</p>
                                                <p className="text-xs text-slate-400">
                                                    ฿{Number(report.listing.price).toLocaleString()} · {report.listing.condition ?? '—'}
                                                    {report.listing.is_graded ? ` · ${report.listing.grading_company ?? 'Graded'} ${report.listing.grade ?? ''}` : ''}
                                                </p>
                                                <p className="text-[10px] text-slate-500">Listed {new Date(report.listing.created_at).toLocaleDateString()}</p>
                                                <div className="flex flex-wrap gap-2 pt-1">
                                                    {report.listing.card_id && (
                                                        <a
                                                            href={`/card/${report.listing.card_id}`}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="px-2.5 py-1 text-[10px] font-bold text-slate-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition"
                                                        >
                                                            Card page <i className="fa-solid fa-arrow-up-right-from-square ml-1 text-[8px]" />
                                                        </a>
                                                    )}
                                                    {report.listing.photo_back && (
                                                        <a
                                                            href={report.listing.photo_back}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="px-2.5 py-1 text-[10px] font-bold text-slate-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition"
                                                        >
                                                            Back photo <i className="fa-solid fa-arrow-up-right-from-square ml-1 text-[8px]" />
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : report.entity_type === 'listing' ? (
                                        <div className="bg-black/30 border border-white/5 rounded-xl p-3">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Listing</p>
                                            <p className="text-xs text-slate-400 mt-1">Listing no longer exists ({report.entity_id}).</p>
                                            {report.entity_name && <p className="text-xs text-slate-300 mt-0.5">{report.entity_name}</p>}
                                        </div>
                                    ) : (report.entity_type === 'other' || !seller) ? (
                                        <div className="bg-black/30 border border-white/5 rounded-xl p-3">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Target</p>
                                            <p className="text-xs text-slate-300 mt-1 break-all">{report.entity_name ?? report.entity_id}</p>
                                            {report.entity_type === 'seller' && (
                                                <p className="text-[10px] text-slate-500 mt-1">Seller profile not found — account may have been deleted.</p>
                                            )}
                                        </div>
                                    ) : null}

                                    {seller && (
                                        <SellerBox
                                            seller={seller}
                                            banBusy={busy}
                                            onBan={() => openBanModal(report, seller)}
                                            onUnban={() => unbanSeller(report, seller)}
                                            onRejectStripe={() => rejectStripe(report, seller)}
                                        />
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex flex-wrap gap-2 pt-1 border-t border-white/5">
                                    {report.listing && (
                                        <button
                                            onClick={() => removeListing(report)}
                                            disabled={busy || !listingLive}
                                            className="mt-3 px-3 py-1.5 text-xs font-black uppercase text-brand-red bg-brand-red/10 border border-brand-red/20 rounded-lg hover:bg-brand-red/20 transition disabled:opacity-40"
                                        >
                                            {busy ? <i className="fa-solid fa-spinner fa-spin mr-1" /> : <i className="fa-solid fa-trash mr-1" />}
                                            {listingLive ? 'Remove listing' : `Listing ${report.listing.status}`}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => patchReport(report.id, 'Resolved')}
                                        disabled={busy || report.status === 'Resolved'}
                                        className="mt-3 px-3 py-1.5 text-xs font-bold text-brand-green bg-brand-green/10 border border-brand-green/20 rounded-lg hover:bg-brand-green/20 transition disabled:opacity-40"
                                    >
                                        Mark Resolved
                                    </button>
                                    <button
                                        onClick={() => patchReport(report.id, 'Dismissed')}
                                        disabled={busy || report.status === 'Dismissed'}
                                        className="mt-3 px-3 py-1.5 text-xs font-bold text-slate-400 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:text-white transition disabled:opacity-40"
                                    >
                                        Dismiss
                                    </button>
                                    {report.status !== 'Open' && (
                                        <button
                                            onClick={() => patchReport(report.id, 'Open')}
                                            disabled={busy}
                                            className="mt-3 px-3 py-1.5 text-xs font-bold text-slate-400 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:text-white transition disabled:opacity-40"
                                        >
                                            Reopen
                                        </button>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            <BanUserModal
                target={banTarget}
                defaultReason={banDefaultReason}
                onClose={() => { setBanTarget(null); setBanSourceReportId(null) }}
                onBanned={onBanned}
            />
        </div>
    )
}
