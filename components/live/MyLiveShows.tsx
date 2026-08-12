'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
    Calendar,
    ChevronLeft,
    Loader2,
    Plus,
    Radio,
    Trash2,
    XCircle,
} from 'lucide-react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import { useBetaFeatures } from '@/lib/hooks/useBetaFeatures';
import { GAMES, getGameLabel } from '@/lib/games';
import CustomSelect from '@/components/CustomSelect';
import { ShareShowButton } from '@/components/live/ShareShowButton';
import type { LiveStreamRow } from '@/components/live/shared';

/**
 * "Live shows" panel body — rendered inside Profile's slide-in panel shell.
 *
 * Beta discipline: this component returns null without the 'live_broadcast'
 * grant (the menu item that opens the panel is gated the same way, so this is
 * belt-and-suspenders), and the server 404s the ?mine=1 fetch regardless —
 * zero render, zero hint for everyone else.
 */

type FeedState =
    | { name: 'loading' }
    | { name: 'error' }
    | { name: 'ready'; streams: LiveStreamRow[] };

const STATUS_RANK: Record<string, number> = { live: 0, scheduled: 1 };

function sortShows(streams: LiveStreamRow[]): LiveStreamRow[] {
    return [...streams].sort((a, b) => {
        const ra = STATUS_RANK[a.status] ?? 2;
        const rb = STATUS_RANK[b.status] ?? 2;
        if (ra !== rb) return ra - rb;
        // Scheduled: soonest first. Live/finished: newest first.
        if (ra === 1) return (a.scheduled_at ?? '9999').localeCompare(b.scheduled_at ?? '9999');
        return b.created_at.localeCompare(a.created_at);
    });
}

const inputCls =
    'w-full h-11 rounded-xl bg-black/30 border border-white/10 px-3 text-sm text-white outline-none focus:border-brand-cyan/50';
const labelCls = 'block text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1.5';

export default function MyLiveShows({ onBack }: { onBack: () => void }) {
    const { t, isThai } = useTranslation();
    const { showToast } = useToast();
    const { hasBeta } = useBetaFeatures();

    const [feed, setFeed] = useState<FeedState>({ name: 'loading' });

    // Create/schedule form.
    const [showForm, setShowForm] = useState(false);
    const [title, setTitle] = useState('');
    const [gameId, setGameId] = useState('pokemon');
    const [scheduledAt, setScheduledAt] = useState('');
    const [visibility, setVisibility] = useState<'public' | 'unlisted'>('public');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    // Two-tap cancel: first tap arms the row, second tap fires.
    const [armedCancelId, setArmedCancelId] = useState<string | null>(null);
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    // Two-tap delete for finished shows, same arming pattern.
    const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const canBroadcast = hasBeta('live_broadcast');

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/live/streams?mine=1');
            if (!res.ok) {
                setFeed({ name: 'error' });
                return;
            }
            const data = await res.json();
            setFeed({ name: 'ready', streams: Array.isArray(data.streams) ? data.streams : [] });
        } catch {
            setFeed({ name: 'error' });
        }
    }, []);

    useEffect(() => {
        if (canBroadcast) void load();
    }, [canBroadcast, load]);

    const createShow = useCallback(async () => {
        if (creating || title.trim().length < 3) return;
        setCreating(true);
        setCreateError(null);
        try {
            const body: Record<string, unknown> = { title: title.trim(), visibility };
            if (gameId) body.gameId = gameId;
            if (scheduledAt) {
                const ts = Date.parse(scheduledAt);
                if (Number.isFinite(ts)) body.scheduledAt = new Date(ts).toISOString();
            }
            const res = await fetch('/api/live/streams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                setCreateError(data.error || t('live.hub.createError') || 'Could not create the show');
                return;
            }
            setTitle('');
            setScheduledAt('');
            setShowForm(false);
            await load();
        } catch {
            setCreateError(t('live.hub.createError') || 'Could not create the show');
        } finally {
            setCreating(false);
        }
    }, [creating, title, visibility, gameId, scheduledAt, load, t]);

    const cancelShow = useCallback(
        async (id: string) => {
            if (armedCancelId !== id) {
                setArmedCancelId(id);
                return;
            }
            setArmedCancelId(null);
            setCancellingId(id);
            try {
                const res = await fetch(`/api/live/streams/${id}/cancel`, { method: 'POST' });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    showToast(
                        data.error || t('live.myShows.cancelError') || 'Could not cancel the show',
                        'error',
                    );
                    return;
                }
                setFeed((prev) =>
                    prev.name === 'ready'
                        ? {
                              name: 'ready',
                              streams: prev.streams.map((s) =>
                                  s.id === id ? { ...s, status: 'cancelled' as const } : s,
                              ),
                          }
                        : prev,
                );
            } catch {
                showToast(t('live.myShows.cancelError') || 'Could not cancel the show', 'error');
            } finally {
                setCancellingId(null);
            }
        },
        [armedCancelId, showToast, t],
    );

    // Hard-delete a finished, money-free show. The server is the authority on
    // "money-free" (sold spots / orders) — a refusal surfaces as a t()'d toast.
    const deleteShow = useCallback(
        async (id: string) => {
            if (armedDeleteId !== id) {
                setArmedDeleteId(id);
                return;
            }
            setArmedDeleteId(null);
            setDeletingId(id);
            try {
                const res = await fetch(`/api/live/streams/${id}`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    showToast(
                        data.code === 'HAS_SALES'
                            ? t('live.myShows.deleteBlocked') ||
                                  'This show has sold spots or orders and cannot be deleted'
                            : data.error ||
                                  t('live.myShows.deleteError') ||
                                  'Could not delete the show',
                        'error',
                    );
                    return;
                }
                setFeed((prev) =>
                    prev.name === 'ready'
                        ? { name: 'ready', streams: prev.streams.filter((s) => s.id !== id) }
                        : prev,
                );
            } catch {
                showToast(t('live.myShows.deleteError') || 'Could not delete the show', 'error');
            } finally {
                setDeletingId(null);
            }
        },
        [armedDeleteId, showToast, t],
    );

    // Fails closed: no grant (or grant still resolving) renders nothing.
    if (!canBroadcast) return null;

    const statusChip = (status: LiveStreamRow['status']) => {
        const label =
            t(`live.myShows.status.${status}`) ||
            { scheduled: 'Scheduled', live: 'LIVE', ended: 'Ended', cancelled: 'Cancelled' }[status];
        const cls =
            status === 'live'
                ? 'bg-brand-red text-white'
                : status === 'scheduled'
                    ? 'bg-brand-cyan/15 text-brand-cyan'
                    : 'bg-white/10 text-slate-400';
        return (
            <span
                className={`shrink-0 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest ${cls}`}
            >
                {status === 'live' && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse mr-1 align-middle"></span>
                )}
                {label}
            </span>
        );
    };

    const shows = feed.name === 'ready' ? sortShows(feed.streams) : [];

    return (
        <div
            className="p-4 pt-16 space-y-6"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)' }}
        >
            <div className="flex items-center gap-4 mb-6">
                {/* With the schedule form open, back returns to the show list (the portal) —
                    not the host surface's exit — so setup never dumps broadcasters to the feed. */}
                <button
                    onClick={() => (showForm ? setShowForm(false) : onBack())}
                    className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors"
                >
                    <ChevronLeft className="w-5 h-5 text-slate-400" />
                </button>
                <h2 className="text-lg font-black text-white uppercase tracking-wide">
                    {t('live.myShows.title') || 'My live shows'}
                </h2>
                <button
                    onClick={() => setShowForm((v) => !v)}
                    className="ml-auto px-3 h-10 rounded-xl bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-widest flex items-center gap-1.5 active:scale-95 transition-all"
                >
                    <Plus className="w-4 h-4" />
                    {t('live.myShows.schedule') || 'Schedule'}
                </button>
            </div>

            {showForm && (
                <div className="glass rounded-2xl border-white/10 p-4 space-y-3">
                    <div>
                        <label className={labelCls}>{t('live.hub.showTitle') || 'Show title'}</label>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            maxLength={120}
                            className={inputCls}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelCls}>{t('live.myShows.game') || 'Game'}</label>
                            <CustomSelect
                                value={gameId}
                                onChange={setGameId}
                                ariaLabel={t('live.myShows.game') || 'Game'}
                                triggerClassName={inputCls}
                                options={GAMES.map((g) => ({
                                    value: g.id,
                                    label: g.localizedName[isThai ? 'th' : 'en'],
                                }))}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>{t('live.myShows.when') || 'Start time'}</label>
                            <input
                                type="datetime-local"
                                value={scheduledAt}
                                onChange={(e) => setScheduledAt(e.target.value)}
                                className={inputCls}
                            />
                        </div>
                    </div>
                    <div>
                        <label className={labelCls}>{t('live.myShows.visibility') || 'Visibility'}</label>
                        <CustomSelect
                            value={visibility}
                            onChange={(v) => setVisibility(v === 'unlisted' ? 'unlisted' : 'public')}
                            ariaLabel={t('live.myShows.visibility') || 'Visibility'}
                            triggerClassName={inputCls}
                            options={[
                                { value: 'public', label: t('live.myShows.public') || 'Public' },
                                {
                                    value: 'unlisted',
                                    label: t('live.myShows.unlisted') || 'Unlisted (link only)',
                                },
                            ]}
                        />
                    </div>
                    <button
                        onClick={() => void createShow()}
                        disabled={creating || title.trim().length < 3}
                        className="w-full h-11 rounded-xl bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-widest disabled:opacity-40 active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                        {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                        {creating
                            ? t('live.hub.creating') || 'Scheduling...'
                            : t('live.hub.create') || 'Schedule'}
                    </button>
                    {createError && <p className="text-xs text-brand-red">{createError}</p>}
                </div>
            )}

            {feed.name === 'loading' && (
                <div className="min-h-[30vh] flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-brand-cyan" />
                </div>
            )}

            {feed.name === 'error' && (
                <div className="min-h-[30vh] flex flex-col items-center justify-center text-center">
                    <p className="text-sm text-slate-400">
                        {t('live.myShows.loadError') || 'Could not load your shows'}
                    </p>
                    <button
                        onClick={() => {
                            setFeed({ name: 'loading' });
                            void load();
                        }}
                        className="mt-4 px-5 h-10 rounded-xl bg-white/10 text-white text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                    >
                        {t('live.hub.retry') || 'Retry'}
                    </button>
                </div>
            )}

            {feed.name === 'ready' && shows.length === 0 && (
                <div className="min-h-[30vh] flex flex-col items-center justify-center text-center px-6">
                    <Radio className="w-10 h-10 text-slate-700 mb-4" />
                    <p className="text-sm text-slate-400 leading-relaxed">
                        {t('live.myShows.empty') || 'No shows yet — schedule your first one'}
                    </p>
                </div>
            )}

            {feed.name === 'ready' && shows.length > 0 && (
                <div className="space-y-3">
                    {shows.map((s) => {
                        const finished = s.status === 'ended' || s.status === 'cancelled';
                        return (
                            <div
                                key={s.id}
                                className={`glass rounded-2xl border-white/10 p-4 ${finished ? 'opacity-60' : ''}`}
                            >
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-bold text-white leading-snug truncate">{s.title}</p>
                                    <span className="ml-auto"></span>
                                    {statusChip(s.status)}
                                </div>
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                                    <span>{getGameLabel(s.game_id ?? 'pokemon', isThai ? 'th' : 'en')}</span>
                                    {s.scheduled_at && (
                                        <span className="flex items-center gap-1">
                                            <Calendar className="w-3 h-3" />
                                            {new Date(s.scheduled_at).toLocaleString(isThai ? 'th-TH' : undefined, {
                                                day: 'numeric',
                                                month: 'short',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </span>
                                    )}
                                    {s.visibility === 'unlisted' && (
                                        <span className="uppercase tracking-widest text-[9px] font-black text-amber-300">
                                            {t('live.myShows.unlistedChip') || 'Unlisted'}
                                        </span>
                                    )}
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    {!finished && (
                                        <Link
                                            href={`/live/broadcast/${s.id}`}
                                            className="px-3 h-9 rounded-lg bg-brand-cyan/15 text-brand-cyan text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 active:scale-95 transition-all"
                                        >
                                            <Radio className="w-3.5 h-3.5" />
                                            {t('live.myShows.openConsole') || 'Open console'}
                                        </Link>
                                    )}
                                    {s.status === 'scheduled' && (
                                        <button
                                            onClick={() => void cancelShow(s.id)}
                                            disabled={cancellingId === s.id}
                                            className={`px-3 h-9 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 ${
                                                armedCancelId === s.id
                                                    ? 'bg-brand-red text-white'
                                                    : 'bg-white/10 text-slate-300'
                                            }`}
                                        >
                                            {cancellingId === s.id ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <XCircle className="w-3.5 h-3.5" />
                                            )}
                                            {armedCancelId === s.id
                                                ? t('live.myShows.confirmCancel') || 'Tap again to confirm'
                                                : t('live.myShows.cancelShow') || 'Cancel'}
                                        </button>
                                    )}
                                    {/* No presaleOpen here: ?mine=1 carries no presale
                                        annotation and rows have no lot data — the plain
                                        scheduled message is still correct. */}
                                    <ShareShowButton
                                        title={s.title}
                                        sellerName={s.seller?.display_name}
                                        path={`/live/${s.id}`}
                                        status={s.status}
                                        scheduledAt={s.scheduled_at}
                                        label={t('live.share.button') || 'Share'}
                                        className="px-3 h-9 rounded-lg bg-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 active:scale-95 transition-all"
                                    />
                                    {finished && (
                                        <button
                                            onClick={() => void deleteShow(s.id)}
                                            disabled={deletingId === s.id}
                                            className={`px-3 h-9 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 ${
                                                armedDeleteId === s.id
                                                    ? 'bg-brand-red text-white'
                                                    : 'bg-white/10 text-slate-300'
                                            }`}
                                        >
                                            {deletingId === s.id ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <Trash2 className="w-3.5 h-3.5" />
                                            )}
                                            {armedDeleteId === s.id
                                                ? t('live.myShows.confirmDelete') || 'Tap again to delete'
                                                : t('live.myShows.deleteShow') || 'Delete'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
