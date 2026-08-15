'use client'

import { useCallback, useEffect, useState } from 'react'
import {
    ADMIN_LABELS,
    APPLICATION_STATUSES,
    OPEN_APPLICATION_STATUSES,
    type ApplicationStatus,
} from '@/lib/breakerApplication'

/**
 * Breaker application review queue (/admin/breakers).
 *
 * Master/detail like /admin/tickets: the list narrows when a detail opens.
 * The detail pane shows every answer the applicant gave, grouped in the same
 * six sections as the public form, so a reviewer reads them in the order they
 * were written.
 *
 * The Access block is the part that does something no other admin screen can:
 * it grants or revokes `live_broadcast` (lib/betaFeatures.ts), the invite-only
 * flag that lets a seller host. Approving and granting are separate buttons —
 * an approval records a decision, a grant changes what an account can do.
 */

interface ApplicationRow {
    id: string
    status: ApplicationStatus
    full_name: string
    email: string
    phone: string
    city: string
    province: string
    business_name: string | null
    applicant_types: string[]
    games: string[]
    breaking_experience: string
    // Removed from the application form 2026-08-15 — null on newer rows, kept
    // for the applications that answered it.
    setup_status: string | null
    user_id: string | null
    locale: string
    submitted_at: string
    reviewed_at: string | null
}

interface ApplicationDetail extends ApplicationRow {
    line_id: string | null
    preferred_language: string
    is_adult: boolean
    applicant_type_other: string | null
    social_links: string[]
    cardstreet_username: string | null
    games_other: string | null
    experience_summary: string
    sample_video_url: string | null
    equipment: string[]
    equipment_other: string | null
    availability: string
    break_types: string
    inventory_notes: string | null
    // Like setup_status/equipment, these questions were dropped 2026-08-15;
    // null on newer rows.
    why_apply: string | null
    trust_and_entertainment: string | null
    anything_else: string | null
    consent_accurate_at: string
    consent_no_guarantee_at: string
    consent_terms_at: string
    utm: Record<string, string> | null
    referrer: string | null
    review_notes: string | null
}

interface LinkedAccount {
    userId: string | null
    email: string | null
    displayName: string | null
    username: string | null
    hasBroadcast: boolean
    isAdmin: boolean
    stripeDetailsSubmitted: boolean
    stripeChargesEnabled: boolean
    matchedBy: 'user_id' | 'email' | null
    lookupTruncated: boolean
}

const STATUS_COLORS: Record<ApplicationStatus, string> = {
    new: 'bg-brand-cyan/20 text-brand-cyan border-brand-cyan/30',
    reviewing: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    test_stream: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    approved: 'bg-brand-green/20 text-brand-green border-brand-green/30',
    rejected: 'bg-brand-red/20 text-brand-red border-brand-red/30',
    withdrawn: 'bg-white/10 text-slate-400 border-white/15',
}

const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'

const label = <T extends string>(map: Record<T, string>, key: string) =>
    (map as Record<string, string>)[key] ?? key

function Chips({ values, map }: { values: string[] | null; map: Record<string, string> }) {
    if (!values?.length) return <span className="text-slate-500">—</span>
    return (
        <span className="flex flex-wrap gap-1">
            {values.map((v) => (
                <span key={v} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] font-bold text-slate-300">
                    {label(map, v)}
                </span>
            ))}
        </span>
    )
}

function Field({ label: name, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="py-2 border-b border-white/5 last:border-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{name}</p>
            <div className="text-sm text-slate-200 whitespace-pre-wrap break-words">{children}</div>
        </div>
    )
}

function Text({ value }: { value: string | null | undefined }) {
    return value ? <>{value}</> : <span className="text-slate-500">—</span>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mb-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-brand-cyan mb-1">{title}</h3>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">{children}</div>
        </section>
    )
}

export default function BreakerApplicationsPage() {
    const [rows, setRows] = useState<ApplicationRow[]>([])
    const [counts, setCounts] = useState<Record<string, number>>({})
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState<'all' | ApplicationStatus>('all')
    const [search, setSearch] = useState('')
    const [searchInput, setSearchInput] = useState('')

    const [selected, setSelected] = useState<ApplicationDetail | null>(null)
    const [account, setAccount] = useState<LinkedAccount | null>(null)
    const [detailLoading, setDetailLoading] = useState(false)
    const [notes, setNotes] = useState('')
    const [saving, setSaving] = useState(false)
    const [actionError, setActionError] = useState<string | null>(null)
    const [actionOk, setActionOk] = useState<string | null>(null)

    const fetchList = useCallback(async () => {
        setLoading(true)
        setLoadError(null)
        try {
            const params = new URLSearchParams()
            if (statusFilter !== 'all') params.set('status', statusFilter)
            if (search) params.set('search', search)
            const res = await fetch(`/api/admin/breaker-applications?${params}`)
            const data = await res.json()
            if (!res.ok) {
                setLoadError(data?.error ?? 'Could not load applications')
                setRows([])
                return
            }
            setRows(data.applications ?? [])
            setCounts(data.counts ?? {})
            setTotal(data.total ?? 0)
        } catch {
            setLoadError('Could not reach the server')
        } finally {
            setLoading(false)
        }
    }, [statusFilter, search])

    useEffect(() => { void fetchList() }, [fetchList])

    const openDetail = useCallback(async (row: ApplicationRow) => {
        setDetailLoading(true)
        setActionError(null)
        setActionOk(null)
        setSelected(null)
        setAccount(null)
        try {
            const res = await fetch(`/api/admin/breaker-applications/${row.id}`)
            const data = await res.json()
            if (!res.ok) {
                setActionError(data?.error ?? 'Could not load this application')
                return
            }
            setSelected(data.application)
            setAccount(data.account)
            setNotes(data.application?.review_notes ?? '')
        } finally {
            setDetailLoading(false)
        }
    }, [])

    const patch = useCallback(
        async (payload: Record<string, unknown>, okMessage: string) => {
            if (!selected) return
            setSaving(true)
            setActionError(null)
            setActionOk(null)
            try {
                const res = await fetch(`/api/admin/breaker-applications/${selected.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                })
                const data = await res.json()
                if (!res.ok) {
                    setActionError(data?.error ?? 'Update failed')
                    return
                }
                if (data.application) {
                    setSelected(data.application)
                    setNotes(data.application.review_notes ?? '')
                    setRows((prev) => prev.map((r) => (r.id === data.application.id ? { ...r, ...data.application } : r)))
                }
                if (data.account) setAccount(data.account)
                setActionOk(
                    data.grant?.reason === 'already_in_that_state'
                        ? 'No change — the account was already in that state.'
                        : okMessage,
                )
                void fetchList()
            } catch {
                setActionError('Could not reach the server')
            } finally {
                setSaving(false)
            }
        },
        [selected, fetchList],
    )

    const filterButtons: { key: 'all' | ApplicationStatus; text: string; count: number }[] = [
        { key: 'all', text: 'All', count: Object.values(counts).reduce((a, b) => a + b, 0) },
        ...APPLICATION_STATUSES.map((s) => ({
            key: s as ApplicationStatus,
            text: ADMIN_LABELS.status[s],
            count: counts[s] ?? 0,
        })),
    ]

    const openCount = OPEN_APPLICATION_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0)

    return (
        <div className="flex gap-6 h-full animate-fadeIn">
            {/* ── List ── */}
            <div className={`flex flex-col space-y-4 min-w-0 transition-all duration-300 ${selected || detailLoading ? 'w-1/2' : 'w-full'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-black text-white italic">Breaker Applications</h1>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {openCount} awaiting a decision · {total} shown
                        </p>
                    </div>
                    <form
                        onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()) }}
                        className="flex items-center gap-2"
                    >
                        <input
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Name, email, shop…"
                            aria-label="Search applications"
                            className="h-9 w-48 rounded-xl bg-white/5 border border-white/10 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-cyan/70"
                        />
                        <button
                            type="submit"
                            className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-slate-300 hover:text-white transition"
                        >
                            Search
                        </button>
                        {search && (
                            <button
                                type="button"
                                onClick={() => { setSearch(''); setSearchInput('') }}
                                className="h-9 px-3 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-300 transition"
                            >
                                Clear
                            </button>
                        )}
                    </form>
                </div>

                <div className="flex flex-wrap gap-2">
                    {filterButtons.map((f) => (
                        <button
                            key={f.key}
                            onClick={() => setStatusFilter(f.key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                                statusFilter === f.key
                                    ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30'
                                    : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200'
                            }`}
                        >
                            {f.text} <span className="opacity-60">{f.count}</span>
                        </button>
                    ))}
                </div>

                {loadError && (
                    <div className="rounded-xl border border-brand-red/40 bg-brand-red/10 px-4 py-3 text-sm text-white">
                        <p className="font-bold">{loadError}</p>
                        <p className="text-xs text-slate-300 mt-1">
                            If this says the table is missing, apply
                            <code className="mx-1 px-1 rounded bg-black/30">20260809_breaker_applications.sql</code>
                            in the Supabase SQL editor.
                        </p>
                    </div>
                )}

                {loading ? (
                    <div className="py-16 text-center text-slate-500 text-sm">
                        <i className="fa-solid fa-circle-notch animate-spin mr-2" />Loading…
                    </div>
                ) : rows.length === 0 && !loadError ? (
                    <div className="py-16 text-center">
                        <i className="fa-solid fa-tower-broadcast text-slate-700 text-3xl mb-3" />
                        <p className="text-sm text-slate-500">No applications match this view.</p>
                    </div>
                ) : (
                    <div className="space-y-2 overflow-y-auto">
                        {rows.map((row) => (
                            <button
                                key={row.id}
                                onClick={() => void openDetail(row)}
                                className={`w-full text-left rounded-xl border px-4 py-3 transition ${
                                    selected?.id === row.id
                                        ? 'border-brand-cyan/40 bg-brand-cyan/5'
                                        : 'border-white/10 bg-white/[0.02] hover:border-white/25'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-white truncate">
                                            {row.full_name}
                                            {row.business_name && (
                                                <span className="text-slate-400 font-medium"> · {row.business_name}</span>
                                            )}
                                        </p>
                                        <p className="text-xs text-slate-500 truncate">
                                            {row.email} · {row.city}, {row.province}
                                        </p>
                                    </div>
                                    <span className={`shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-black uppercase tracking-wider ${STATUS_COLORS[row.status]}`}>
                                        {ADMIN_LABELS.status[row.status]}
                                    </span>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                                    <Chips values={row.applicant_types} map={ADMIN_LABELS.applicantType} />
                                    <span className="text-slate-600">|</span>
                                    <Chips values={row.games} map={ADMIN_LABELS.game} />
                                </div>
                                <p className="mt-2 text-[11px] text-slate-500">
                                    {label(ADMIN_LABELS.experience, row.breaking_experience)} ·{' '}
                                    {row.setup_status && <>{label(ADMIN_LABELS.setupStatus, row.setup_status)} · </>}
                                    {fmtDate(row.submitted_at)}
                                </p>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Detail ── */}
            {(selected || detailLoading) && (
                <div className="w-1/2 min-w-0 flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
                    {detailLoading || !selected ? (
                        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                            <i className="fa-solid fa-circle-notch animate-spin mr-2" />Loading…
                        </div>
                    ) : (
                        <>
                            <div className="px-5 py-4 border-b border-white/5 flex items-start justify-between gap-3 shrink-0">
                                <div className="min-w-0">
                                    <h2 className="text-base font-black text-white truncate">{selected.full_name}</h2>
                                    <p className="text-xs text-slate-500">
                                        Submitted {fmtDate(selected.submitted_at)}
                                        {selected.reviewed_at && ` · reviewed ${fmtDate(selected.reviewed_at)}`}
                                    </p>
                                </div>
                                <button
                                    onClick={() => { setSelected(null); setAccount(null) }}
                                    aria-label="Close"
                                    className="w-8 h-8 shrink-0 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 transition"
                                >
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto px-5 py-4">
                                {(actionError || actionOk) && (
                                    <div
                                        role="status"
                                        className={`mb-4 rounded-xl border px-3 py-2.5 text-sm ${
                                            actionError
                                                ? 'border-brand-red/40 bg-brand-red/10 text-white'
                                                : 'border-brand-green/40 bg-brand-green/10 text-white'
                                        }`}
                                    >
                                        {actionError ?? actionOk}
                                    </div>
                                )}

                                {/* Decision */}
                                <Section title="Decision">
                                    <Field label="Status">
                                        <div className="flex flex-wrap gap-2 pt-1">
                                            {APPLICATION_STATUSES.map((s) => (
                                                <button
                                                    key={s}
                                                    disabled={saving || selected.status === s}
                                                    onClick={() => void patch({ status: s }, `Status set to ${ADMIN_LABELS.status[s]}.`)}
                                                    // The current status is disabled but must NOT look dimmed —
                                                    // it reads as the active state, not a dead control. Keep the
                                                    // disabled: opacity in the branches; two of them on one
                                                    // element resolve by stylesheet order, not class order.
                                                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-black uppercase tracking-wider transition ${
                                                        selected.status === s
                                                            ? `${STATUS_COLORS[s]} disabled:opacity-100`
                                                            : 'bg-white/5 text-slate-400 border-white/10 hover:text-white disabled:opacity-50'
                                                    }`}
                                                >
                                                    {ADMIN_LABELS.status[s]}
                                                </button>
                                            ))}
                                        </div>
                                    </Field>
                                    <Field label="Review notes (internal)">
                                        <textarea
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            rows={3}
                                            maxLength={5000}
                                            placeholder="Why this decision…"
                                            className="w-full mt-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-cyan/70"
                                        />
                                        <button
                                            disabled={saving || notes === (selected.review_notes ?? '')}
                                            onClick={() => void patch({ review_notes: notes }, 'Notes saved.')}
                                            className="mt-2 px-3 h-9 rounded-xl bg-white/10 text-xs font-black uppercase tracking-wider text-white hover:bg-white/15 transition disabled:opacity-40"
                                        >
                                            Save notes
                                        </button>
                                    </Field>
                                </Section>

                                {/* Access */}
                                <Section title="Broadcast access">
                                    {account?.userId ? (
                                        <>
                                            <Field label="Linked account">
                                                <span className="text-white">
                                                    {account.displayName ?? '(no display name)'}
                                                    {account.username && <span className="text-slate-400"> @{account.username}</span>}
                                                </span>
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    {account.email}
                                                    {account.matchedBy === 'email' && ' · matched by email, not linked at submission'}
                                                </p>
                                            </Field>
                                            <Field label="Payout readiness">
                                                <span className={account.stripeChargesEnabled ? 'text-brand-green' : 'text-yellow-400'}>
                                                    {account.stripeChargesEnabled
                                                        ? 'Stripe active — can receive payments'
                                                        : account.stripeDetailsSubmitted
                                                          ? 'Stripe submitted, awaiting verification'
                                                          : 'Stripe onboarding not completed'}
                                                </span>
                                            </Field>
                                            <Field label="live_broadcast flag">
                                                <div className="flex items-center gap-3 flex-wrap">
                                                    <span className={account.hasBroadcast ? 'text-brand-green font-bold' : 'text-slate-400'}>
                                                        {account.hasBroadcast ? 'Granted' : 'Not granted'}
                                                        {account.isAdmin && !account.hasBroadcast && (
                                                            <span className="text-slate-500 font-normal"> (admin — passes every beta gate anyway)</span>
                                                        )}
                                                    </span>
                                                    <button
                                                        disabled={saving}
                                                        onClick={() =>
                                                            void patch(
                                                                { grant_broadcast: !account.hasBroadcast },
                                                                account.hasBroadcast ? 'Broadcast access revoked.' : 'Broadcast access granted.',
                                                            )
                                                        }
                                                        className={`px-3 h-9 rounded-xl text-xs font-black uppercase tracking-wider transition disabled:opacity-40 ${
                                                            account.hasBroadcast
                                                                ? 'bg-brand-red/15 text-brand-red border border-brand-red/30 hover:bg-brand-red/25'
                                                                : 'bg-brand-green/15 text-brand-green border border-brand-green/30 hover:bg-brand-green/25'
                                                        }`}
                                                    >
                                                        {account.hasBroadcast ? 'Revoke access' : 'Grant access'}
                                                    </button>
                                                </div>
                                            </Field>
                                        </>
                                    ) : (
                                        <Field label="Linked account">
                                            <span className="text-yellow-400">
                                                {account?.lookupTruncated
                                                    ? 'Account lookup did not complete — reopen this application to retry.'
                                                    : 'No CardStreet account found for this email.'}
                                            </span>
                                            <p className="text-xs text-slate-500 mt-1">
                                                Broadcast access is a flag on an account, so the applicant has to sign up
                                                with <span className="text-slate-300">{selected.email}</span> before it can be granted.
                                            </p>
                                        </Field>
                                    )}
                                </Section>

                                {/* Contact */}
                                <Section title="Contact">
                                    <Field label="Email"><a className="text-brand-cyan hover:underline" href={`mailto:${selected.email}`}>{selected.email}</a></Field>
                                    <Field label="Phone"><a className="text-brand-cyan hover:underline" href={`tel:${selected.phone}`}>{selected.phone}</a></Field>
                                    <Field label="LINE ID"><Text value={selected.line_id} /></Field>
                                    <Field label="Location">{selected.city}, {selected.province}</Field>
                                    <Field label="Preferred language">{label(ADMIN_LABELS.preferredLanguage, selected.preferred_language)}</Field>
                                    <Field label="Confirmed 18+">{selected.is_adult ? 'Yes' : 'No'}</Field>
                                </Section>

                                {/* Profile */}
                                <Section title="Applicant profile">
                                    <Field label="Type"><Chips values={selected.applicant_types} map={ADMIN_LABELS.applicantType} /></Field>
                                    {selected.applicant_type_other && <Field label="Type — other"><Text value={selected.applicant_type_other} /></Field>}
                                    <Field label="Shop / channel"><Text value={selected.business_name} /></Field>
                                    <Field label="Links">
                                        {selected.social_links?.length ? (
                                            <ul className="space-y-1">
                                                {selected.social_links.map((l) => (
                                                    <li key={l}>
                                                        <a href={l} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-cyan hover:underline break-all">{l}</a>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : <span className="text-slate-500">—</span>}
                                    </Field>
                                    <Field label="CardStreet username"><Text value={selected.cardstreet_username} /></Field>
                                </Section>

                                {/* Experience */}
                                <Section title="TCG experience">
                                    <Field label="Games"><Chips values={selected.games} map={ADMIN_LABELS.game} /></Field>
                                    {selected.games_other && <Field label="Games — other"><Text value={selected.games_other} /></Field>}
                                    <Field label="Breaking experience">{label(ADMIN_LABELS.experience, selected.breaking_experience)}</Field>
                                    <Field label="Their description"><Text value={selected.experience_summary} /></Field>
                                    <Field label="Sample video">
                                        {selected.sample_video_url
                                            ? <a href={selected.sample_video_url} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-cyan hover:underline break-all">{selected.sample_video_url}</a>
                                            : <span className="text-slate-500">—</span>}
                                    </Field>
                                </Section>

                                {/* Streaming. Equipment and setup status were dropped from the
                                    form 2026-08-15 — shown only on the applications that answered
                                    them. */}
                                <Section title="Streaming readiness">
                                    {selected.equipment?.length > 0 && <Field label="Equipment"><Chips values={selected.equipment} map={ADMIN_LABELS.equipment} /></Field>}
                                    {selected.equipment_other && <Field label="Equipment — other"><Text value={selected.equipment_other} /></Field>}
                                    {selected.setup_status && <Field label="Setup status">{label(ADMIN_LABELS.setupStatus, selected.setup_status)}</Field>}
                                    <Field label="Availability"><Text value={selected.availability} /></Field>
                                    <Field label="Breaks they want to host"><Text value={selected.break_types} /></Field>
                                    <Field label="Inventory on hand"><Text value={selected.inventory_notes} /></Field>
                                </Section>

                                {/* Written answers — questions dropped 2026-08-15, section kept
                                    for the applications that have them. */}
                                {(selected.why_apply || selected.trust_and_entertainment || selected.anything_else) && (
                                    <Section title="Written answers">
                                        {selected.why_apply && <Field label="Why become a Cardstreet Breaker?"><Text value={selected.why_apply} /></Field>}
                                        {selected.trust_and_entertainment && <Field label="Entertaining and trustworthy streams"><Text value={selected.trust_and_entertainment} /></Field>}
                                        {selected.anything_else && <Field label="Anything else"><Text value={selected.anything_else} /></Field>}
                                    </Section>
                                )}

                                {/* Provenance */}
                                <Section title="Consent & source">
                                    <Field label="Consent recorded">
                                        Accurate info, no-guarantee, and terms all accepted {fmtDate(selected.consent_accurate_at)}
                                    </Field>
                                    <Field label="Applied in">{selected.locale === 'th' ? 'Thai' : 'English'}</Field>
                                    <Field label="Campaign">
                                        {selected.utm && Object.keys(selected.utm).length > 0 ? (
                                            <span className="flex flex-wrap gap-1">
                                                {Object.entries(selected.utm).map(([k, v]) => (
                                                    <span key={k} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] font-mono text-slate-300">
                                                        {k}={v}
                                                    </span>
                                                ))}
                                            </span>
                                        ) : <span className="text-slate-500">Direct / none</span>}
                                    </Field>
                                    <Field label="Referrer"><Text value={selected.referrer} /></Field>
                                </Section>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
