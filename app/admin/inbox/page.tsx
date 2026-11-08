'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
    inboxKey, parseInboxKey, personName, type InboxItem, type InboxKind, type InboxPerson,
} from '@/lib/supportInbox'
import { AUTO_TRANSLATE_AVAILABLE, TranslationStatusNotice, useAutoTranslate, useTranslator } from '../_translation'
import { AccountDrawer } from '../_AccountDrawer'
import { KindChip, Spinner, StatusChip, initials, when } from './_parts'
import { DmPane } from './_DmPane'
import { TicketPane } from './_TicketPane'
import { ReportPane } from './_ReportPane'

// The Support inbox: DMs to the support shop, tickets (incl. buyer problem
// reports) and listing/seller reports in one list, answered from one place.
// Old links (/admin/tickets?ticket=, /admin/messages?thread=) redirect here.

const POLL_MS = 15_000

type Filter = 'all' | 'needs' | InboxKind
const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'needs', label: 'Needs reply' },
    { id: 'dm', label: 'Messages' },
    { id: 'ticket', label: 'Tickets' },
    { id: 'report', label: 'Reports' },
]

/** What the right-hand pane shows. A DM with no id is a conversation not started yet. */
interface OpenPane {
    key: string
    kind: InboxKind
    id: string | null
    person: InboxPerson | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The support shop's conversation with a person, or a pane for a new one if none exists yet. */
async function lookupConversation(person: InboxPerson): Promise<{ pane: OpenPane } | { error: string }> {
    try {
        const res = await fetch(`/api/admin/messages?with=${encodeURIComponent(person.id)}`, { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return { error: data.error || `Could not open a conversation (${res.status}).` }
        if (data.thread) return { pane: { key: inboxKey('dm', data.thread.id), kind: 'dm', id: data.thread.id, person: data.user ?? person } }
        return { pane: { key: `new:${person.id}`, kind: 'dm', id: null, person: data.user ?? person } }
    } catch {
        return { error: 'Could not open a conversation. Check the connection and try again.' }
    }
}

export default function SupportInboxPage() {
    const [auto, setAuto] = useAutoTranslate()
    const [items, setItems] = useState<InboxItem[]>([])
    const [needsReply, setNeedsReply] = useState(0)
    const [loading, setLoading] = useState(true)
    const [listError, setListError] = useState<string | null>(null)
    const [filter, setFilter] = useState<Filter>('all')
    const [open, setOpen] = useState<OpenPane | null>(null)
    const [paneNotice, setPaneNotice] = useState<string | null>(null)
    // The account drawer: who this person is, their listings, sales and purchases.
    const [account, setAccount] = useState<string | null>(null)
    const listTr = useTranslator()
    const { translate } = listTr
    const deepLinkRef = useRef<string | null>(null)
    const dmRef = useRef<string | null>(null)

    const fetchList = useCallback(async (): Promise<InboxItem[] | null> => {
        try {
            const res = await fetch('/api/admin/inbox', { cache: 'no-store' })
            if (!res.ok) {
                setListError(`Could not load the inbox (${res.status})`)
                return null
            }
            const data = await res.json()
            const list: InboxItem[] = data.items ?? []
            setItems(list)
            setNeedsReply(data.counts?.needsReply ?? 0)
            setListError(null)
            return list
        } catch {
            setListError('Could not load the inbox')
            return null
        } finally {
            setLoading(false)
        }
    }, [])

    const openItem = useCallback((item: InboxItem) => {
        setPaneNotice(null)
        setOpen({ key: item.key, kind: item.kind, id: item.id, person: item.person })
    }, [])

    // ?open=<kind>:<id> from an alert email or an old admin link; ?kind= preselects
    // a filter; ?dm=<user id> (from the order lookup) opens the support shop's
    // conversation with that person, started or not.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const wanted = params.get('open')
        if (parseInboxKey(wanted)) deepLinkRef.current = wanted!.toLowerCase()
        const dmWith = params.get('dm')
        if (dmWith && UUID_RE.test(dmWith)) dmRef.current = dmWith.toLowerCase()
        const kind = params.get('kind')
        if (kind === 'dm' || kind === 'ticket' || kind === 'report') setFilter(kind)
        const transient = (k: string) => k === 'open' || k === 'kind' || k === 'dm' || k.startsWith('utm_')
        if ([...params.keys()].some(transient)) {
            for (const k of [...params.keys()]) if (transient(k)) params.delete(k)
            const rest = params.toString()
            window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`)
        }
        fetchList().then(list => {
            const dm = dmRef.current
            dmRef.current = null
            if (dm) {
                lookupConversation({ id: dm, username: null, display_name: null, avatar_url: null })
                    .then(result => { if ('error' in result) setPaneNotice(result.error); else setOpen(result.pane) })
                return
            }
            const key = deepLinkRef.current
            deepLinkRef.current = null
            const parsed = parseInboxKey(key)
            if (!key || !parsed) return
            const found = list?.find(i => i.key === key)
            if (found) openItem(found)
            // Tickets and DMs load themselves; a report needs its list row.
            else if (parsed.kind !== 'report') setOpen({ key, kind: parsed.kind, id: parsed.id, person: null })
            else setPaneNotice('That report is not in the inbox.')
        })
    }, [fetchList, openItem])

    useEffect(() => {
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') fetchList()
        }, POLL_MS)
        return () => window.clearInterval(timer)
    }, [fetchList])

    // English list previews, keyed by the activity time so a new message is translated afresh.
    useEffect(() => {
        if (!auto) return
        const batch: { id: string; text: string }[] = []
        for (const item of items.slice(0, 60)) {
            if (item.title && item.kind === 'ticket') batch.push({ id: `t:${item.key}`, text: item.title })
            if (item.preview && !item.previewFromTeam) batch.push({ id: `p:${item.key}:${item.lastAt}`, text: item.preview })
        }
        translate(batch)
    }, [auto, items, translate])

    const english = (id: string, text: string | null) => (auto ? listTr.map[id]?.text : undefined) ?? text

    const messagePerson = async (person: InboxPerson) => {
        setPaneNotice(null)
        const result = await lookupConversation(person)
        if ('error' in result) setPaneNotice(result.error)
        else setOpen(result.pane)
    }

    const refresh = useCallback(() => { fetchList() }, [fetchList])

    const visible = items.filter(i =>
        filter === 'all' ? true : filter === 'needs' ? i.needsReply : i.kind === filter)
    const countFor = (f: Filter) =>
        f === 'all' ? items.length : f === 'needs' ? needsReply : items.filter(i => i.kind === f).length
    const openListItem = open ? items.find(i => i.key === open.key) : undefined

    return (
        <div className="flex flex-col lg:flex-row gap-6 animate-fadeIn lg:h-[calc(100vh-10.5rem)]">
            {/* List */}
            <div className={`flex-col space-y-3 lg:w-[25rem] lg:shrink-0 lg:flex min-h-0 ${open ? 'hidden' : 'flex'}`}>
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-black text-white italic">Inbox</h1>
                        <p className="text-slate-500 text-sm">
                            {loading ? 'Loading…' : `${needsReply} need${needsReply === 1 ? 's' : ''} a reply`}
                        </p>
                    </div>
                    {AUTO_TRANSLATE_AVAILABLE && (
                        <button
                            role="switch"
                            aria-checked={auto === true}
                            disabled={auto === null}
                            onClick={() => setAuto(!auto)}
                            title="Show customer messages in English, and send replies in their language with your English underneath"
                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition disabled:opacity-50"
                        >
                            <i className="fa-solid fa-language text-slate-400" />
                            <span className="text-xs font-bold text-slate-300">Auto-translate</span>
                            <span className={`relative w-8 h-[18px] rounded-full transition-colors ${auto ? 'bg-brand-cyan' : 'bg-white/15'}`}>
                                <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${auto ? 'left-[16px]' : 'left-[2px]'}`} />
                            </span>
                        </button>
                    )}
                </div>

                <TranslationStatusNotice auto={auto === true} />

                <div className="flex flex-wrap gap-1.5">
                    {FILTERS.map(f => (
                        <button
                            key={f.id}
                            onClick={() => setFilter(f.id)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${filter === f.id
                                ? 'bg-brand-cyan/15 border-brand-cyan/40 text-brand-cyan'
                                : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'}`}
                        >
                            {f.label}
                            {!loading && <span className="ml-1 opacity-70">{countFor(f.id)}</span>}
                        </button>
                    ))}
                </div>

                <div className="glass rounded-2xl border border-white/10 overflow-hidden flex-1 min-h-0 overflow-y-auto">
                    {loading ? <Spinner size="h-8 w-8" /> : listError ? (
                        <p className="px-6 py-16 text-center text-rose-300 text-sm">{listError}</p>
                    ) : visible.length === 0 ? (
                        <p className="px-6 py-16 text-center text-slate-500 text-sm">{filter === 'needs' ? 'Nothing waiting on a reply' : 'Nothing here yet'}</p>
                    ) : (
                        <div className="divide-y divide-white/5">
                            {visible.map(item => {
                                const name = personName(item.person)
                                const active = open?.key === item.key
                                const strong = item.unread || item.needsReply
                                const title = item.kind === 'ticket' ? english(`t:${item.key}`, item.title) : item.title
                                const preview = item.previewFromTeam ? item.preview : english(`p:${item.key}:${item.lastAt}`, item.preview)
                                return (
                                    <button
                                        key={item.key}
                                        onClick={() => openItem(item)}
                                        className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-white/5 transition-all ${active ? 'bg-brand-cyan/5 border-l-2 border-brand-cyan' : ''}`}
                                    >
                                        <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-[11px] font-black text-slate-300 shrink-0">
                                            {initials(name)}
                                        </div>
                                        <div className="min-w-0 flex-1 space-y-0.5">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className={`text-sm truncate ${strong ? 'font-black text-white' : 'font-semibold text-slate-300'}`}>{name}</p>
                                                <span className="text-[10px] text-slate-500 shrink-0">{when(item.lastAt)}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <KindChip kind={item.kind} />
                                                {title && <p className="text-[11px] font-semibold text-slate-300 truncate flex-1">{title}</p>}
                                                {!title && <span className="flex-1" />}
                                                <StatusChip status={item.status} />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <p className={`text-[11px] truncate flex-1 ${strong ? 'text-slate-300' : 'text-slate-500'}`}>
                                                    {item.previewFromTeam ? 'You: ' : ''}{preview ?? ''}
                                                </p>
                                                {strong && <span className="w-2 h-2 rounded-full bg-brand-cyan shrink-0" aria-label={item.unread ? 'Unread' : 'Needs a reply'} />}
                                            </div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Conversation */}
            {open ? (
                <div className="flex-1 flex flex-col min-h-0 min-w-0 space-y-3 animate-fadeIn">
                    <button
                        onClick={() => { setOpen(null); setPaneNotice(null) }}
                        className="self-start text-slate-500 hover:text-slate-300 transition text-xs font-bold"
                    >
                        <i className="fa-solid fa-arrow-left mr-1" />
                        <span className="lg:hidden">Back</span>
                        <span className="hidden lg:inline">Close</span>
                    </button>
                    {paneNotice && <p className="text-[11px] text-amber-300">{paneNotice}</p>}
                    {open.kind === 'dm' && (
                        <DmPane
                            key={open.key}
                            threadId={open.id}
                            person={open.person}
                            auto={auto === true}
                            onChanged={refresh}
                            onStarted={threadId => {
                                setOpen({ key: inboxKey('dm', threadId), kind: 'dm', id: threadId, person: open.person })
                                fetchList()
                            }}
                            onShowAccount={setAccount}
                        />
                    )}
                    {open.kind === 'ticket' && open.id && (
                        <TicketPane key={open.key} ticketId={open.id} auto={auto === true} onChanged={refresh} onShowAccount={setAccount} />
                    )}
                    {open.kind === 'report' && (openListItem?.report ? (
                        <ReportPane key={open.key} item={openListItem} auto={auto === true} onChanged={refresh} onMessage={messagePerson} onShowAccount={setAccount} />
                    ) : (
                        <p className="text-center text-slate-500 text-sm py-10">That report is not in the inbox.</p>
                    ))}
                </div>
            ) : (
                <div className="hidden lg:flex flex-1 flex-col items-center justify-center gap-2 glass rounded-2xl border border-white/10">
                    {paneNotice && <p className="text-[11px] text-amber-300">{paneNotice}</p>}
                    <p className="text-slate-500 text-sm">Pick a conversation</p>
                </div>
            )}
            {account && <AccountDrawer userId={account} onClose={() => setAccount(null)} />}
        </div>
    )
}
