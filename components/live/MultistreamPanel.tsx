'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import CustomSelect from '@/components/CustomSelect';
import {
    DESTINATION_PLATFORMS,
    PLATFORM_PRESETS,
    type DestinationPlatform,
} from '@/lib/streamDestinationPresets';

/**
 * Multistream panel for the broadcast console: the seller's saved social
 * destinations (Facebook Live, YouTube, Instagram Live Producer, TikTok LIVE,
 * Twitch, custom RTMP), what to push where, and how each output is doing
 * once the show is live.
 *
 * Mechanism (server side, lib/streamDestinations.ts): every ENABLED
 * destination is added as an RTMP output of the room-composite egress at
 * go-live, so the social feeds carry the branded overlay (app/live/overlay)
 * that points viewers at cardstreet.app/watch. Mid-show, a destination can
 * be started or stopped without touching the show — the egress is updated in
 * place.
 *
 * Keys never come back from the server (hint only), and the panel never
 * holds a key longer than the form that submits it.
 *
 * The two egress preferences (canvas orientation, branded overlay on/off)
 * are per-device conveniences kept in localStorage and sent with go-live;
 * they are not stream state.
 */

export interface EgressPrefs {
    orientation: 'portrait' | 'landscape';
    overlay: boolean;
}

export const DEFAULT_EGRESS_PREFS: EgressPrefs = { orientation: 'portrait', overlay: true };

const PREFS_KEY = 'cs_live_egress_prefs';

export function loadEgressPrefs(): EgressPrefs {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (!raw) return DEFAULT_EGRESS_PREFS;
        const parsed = JSON.parse(raw) as Partial<EgressPrefs>;
        return {
            orientation: parsed.orientation === 'landscape' ? 'landscape' : 'portrait',
            overlay: parsed.overlay !== false,
        };
    } catch {
        return DEFAULT_EGRESS_PREFS;
    }
}

export function saveEgressPrefs(prefs: EgressPrefs): void {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
        // Persistence is a convenience — the choice still applies now.
    }
}

interface Destination {
    id: string;
    platform: DestinationPlatform;
    label: string;
    rtmp_url: string;
    key_hint: string;
    enabled: boolean;
    key_unreadable: boolean;
}

type TargetStatus = 'starting' | 'live' | 'ended' | 'failed' | 'removed';

interface Target {
    id: string;
    destinationId: string | null;
    platform: string;
    label: string;
    status: TargetStatus;
    error: string | null;
}

const STATUS_POLL_MS = 15_000;

export default function MultistreamPanel({
    streamId,
    isLive,
    visibility,
    prefs,
    onPrefsChange,
}: {
    streamId: string;
    isLive: boolean;
    visibility: 'public' | 'unlisted';
    prefs: EgressPrefs;
    onPrefsChange: (next: EgressPrefs) => void;
}) {
    const { t, isThai } = useTranslation();
    const { showToast } = useToast();

    const [open, setOpen] = useState(false);
    const [destinations, setDestinations] = useState<Destination[]>([]);
    const [unavailable, setUnavailable] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [targets, setTargets] = useState<Target[]>([]);
    const [egressActive, setEgressActive] = useState<boolean | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    // Add / edit form
    const [formOpen, setFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [platform, setPlatform] = useState<DestinationPlatform>('facebook');
    const [label, setLabel] = useState('');
    const [rtmpUrl, setRtmpUrl] = useState('');
    const [streamKey, setStreamKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);

    const loadDestinations = useCallback(async () => {
        try {
            const res = await fetch('/api/live/destinations');
            const data = await res.json().catch(() => ({}));
            if (!res.ok) return;
            setDestinations(Array.isArray(data.destinations) ? data.destinations : []);
            setUnavailable(data.unavailable === true);
        } catch {
            // Leave whatever we had.
        } finally {
            setLoaded(true);
        }
    }, []);

    const loadStatus = useCallback(async () => {
        try {
            const res = await fetch(`/api/live/streams/${streamId}/simulcast`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) return;
            setTargets(Array.isArray(data.targets) ? data.targets : []);
            setEgressActive(data.egress ? data.egress.active === true : null);
        } catch {
            // Next poll.
        }
    }, [streamId]);

    useEffect(() => {
        void loadDestinations();
    }, [loadDestinations]);

    // While live, LiveKit is the status truth — poll it (the route refreshes
    // from the egress on every call, so a dropped webhook can't strand us).
    useEffect(() => {
        if (!isLive) return;
        void loadStatus();
        const timer = setInterval(() => void loadStatus(), STATUS_POLL_MS);
        return () => clearInterval(timer);
    }, [isLive, loadStatus]);

    const targetFor = useCallback(
        (destinationId: string) => targets.find((tg) => tg.destinationId === destinationId) ?? null,
        [targets],
    );

    const enabledCount = useMemo(() => destinations.filter((d) => d.enabled).length, [destinations]);
    const liveCount = useMemo(() => targets.filter((tg) => tg.status === 'live').length, [targets]);

    const openAddForm = useCallback(() => {
        setEditingId(null);
        setPlatform('facebook');
        setLabel('');
        setRtmpUrl(PLATFORM_PRESETS.facebook.serverUrl ?? '');
        setStreamKey('');
        setShowKey(false);
        setFormOpen(true);
    }, []);

    const openEditForm = useCallback((d: Destination) => {
        setEditingId(d.id);
        setPlatform(d.platform);
        setLabel(d.label);
        setRtmpUrl(d.rtmp_url);
        setStreamKey('');
        setShowKey(false);
        setFormOpen(true);
    }, []);

    const onPlatformChange = useCallback((value: string) => {
        const next = (DESTINATION_PLATFORMS as readonly string[]).includes(value)
            ? (value as DestinationPlatform)
            : 'custom';
        setPlatform(next);
        setRtmpUrl(PLATFORM_PRESETS[next].serverUrl ?? '');
    }, []);

    const submitForm = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        try {
            const isEdit = !!editingId;
            const body: Record<string, unknown> = {
                platform,
                label: label.trim() || PLATFORM_PRESETS[platform].label,
                rtmpUrl: rtmpUrl.trim(),
            };
            if (streamKey.trim()) body.streamKey = streamKey.trim();
            if (!isEdit && !streamKey.trim()) {
                showToast(t('live.console.multistream.keyRequired') || 'Paste the stream key', 'error');
                return;
            }
            const res = await fetch(
                isEdit ? `/api/live/destinations/${editingId}` : '/api/live/destinations',
                {
                    method: isEdit ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                },
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(
                    data.error || t('live.console.multistream.saveError') || 'Could not save the destination',
                    'error',
                );
                return;
            }
            setFormOpen(false);
            setStreamKey('');
            await loadDestinations();
            showToast(t('live.console.multistream.saved') || 'Destination saved', 'success');
        } catch {
            showToast(t('live.console.multistream.saveError') || 'Could not save the destination', 'error');
        } finally {
            setSaving(false);
        }
    }, [saving, editingId, platform, label, rtmpUrl, streamKey, loadDestinations, showToast, t]);

    const toggleEnabled = useCallback(
        async (d: Destination) => {
            if (busyId) return;
            setBusyId(d.id);
            try {
                const res = await fetch(`/api/live/destinations/${d.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: !d.enabled }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    showToast(data.error || t('live.console.multistream.saveError') || 'Could not save', 'error');
                    return;
                }
                setDestinations((prev) =>
                    prev.map((x) => (x.id === d.id ? { ...x, enabled: !d.enabled } : x)),
                );
            } catch {
                showToast(t('live.console.multistream.saveError') || 'Could not save', 'error');
            } finally {
                setBusyId(null);
            }
        },
        [busyId, showToast, t],
    );

    const deleteDestination = useCallback(
        async (d: Destination) => {
            if (busyId) return;
            setBusyId(d.id);
            try {
                const res = await fetch(`/api/live/destinations/${d.id}`, { method: 'DELETE' });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    showToast(data.error || t('live.console.multistream.saveError') || 'Could not delete', 'error');
                    return;
                }
                setDestinations((prev) => prev.filter((x) => x.id !== d.id));
            } catch {
                showToast(t('live.console.multistream.saveError') || 'Could not delete', 'error');
            } finally {
                setBusyId(null);
                setConfirmDeleteId(null);
            }
        },
        [busyId, showToast, t],
    );

    // Mid-show start / stop of one destination.
    const pushAction = useCallback(
        async (d: Destination, action: 'add' | 'remove') => {
            if (busyId) return;
            setBusyId(d.id);
            try {
                const res = await fetch(`/api/live/streams/${streamId}/simulcast`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action,
                        destinationId: d.id,
                        orientation: prefs.orientation,
                        overlay: prefs.overlay,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    showToast(
                        data.error ||
                            t('live.console.multistream.pushError') ||
                            'Could not update the multistream',
                        'error',
                    );
                    return;
                }
                if (Array.isArray(data.targets)) setTargets(data.targets);
                showToast(
                    action === 'add'
                        ? t('live.console.multistream.pushStarted') || 'Starting the push — status updates in a few seconds'
                        : t('live.console.multistream.pushStopped') || 'Push stopped',
                    'success',
                );
                // The egress reports ACTIVE a few seconds after the add.
                setTimeout(() => void loadStatus(), 4000);
            } catch {
                showToast(t('live.console.multistream.pushError') || 'Could not update the multistream', 'error');
            } finally {
                setBusyId(null);
            }
        },
        [busyId, streamId, prefs, showToast, t, loadStatus],
    );

    const statusChip = (status: TargetStatus | null, enabled: boolean, keyUnreadable: boolean) => {
        if (keyUnreadable) {
            return (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[9px] font-black uppercase tracking-widest">
                    {t('live.console.multistream.statusKeyNeeded') || 'Key needed'}
                </span>
            );
        }
        if (!isLive) {
            return (
                <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${
                        enabled ? 'bg-brand-cyan/15 text-brand-cyan' : 'bg-white/5 text-slate-500'
                    }`}
                >
                    {enabled
                        ? t('live.console.multistream.statusArmed') || 'On at go-live'
                        : t('live.console.multistream.statusOff') || 'Off'}
                </span>
            );
        }
        const map: Record<TargetStatus, { cls: string; text: string }> = {
            starting: {
                cls: 'bg-amber-500/15 text-amber-300',
                text: t('live.console.multistream.statusStarting') || 'Connecting',
            },
            live: {
                cls: 'bg-brand-green/15 text-brand-green',
                text: t('live.console.multistream.statusLive') || 'Live',
            },
            ended: {
                cls: 'bg-white/5 text-slate-400',
                text: t('live.console.multistream.statusEnded') || 'Ended',
            },
            failed: {
                cls: 'bg-brand-red/15 text-red-300',
                text: t('live.console.multistream.statusFailed') || 'Failed',
            },
            removed: {
                cls: 'bg-white/5 text-slate-400',
                text: t('live.console.multistream.statusStopped') || 'Stopped',
            },
        };
        const entry = status ? map[status] : null;
        return (
            <span
                className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${
                    entry ? entry.cls : 'bg-white/5 text-slate-500'
                }`}
            >
                {entry ? entry.text : t('live.console.multistream.statusNotPushing') || 'Not pushing'}
            </span>
        );
    };

    const inputCls =
        'w-full h-10 rounded-xl bg-black/30 border border-white/10 px-3 text-sm text-white outline-none focus:border-brand-cyan/50';
    const labelCls = `block text-[10px] font-black uppercase text-slate-400 mb-1 ${
        isThai ? 'tracking-normal' : 'tracking-widest'
    }`;
    const preset = PLATFORM_PRESETS[platform];

    return (
        <div className="rounded-xl bg-white/5 border border-white/10">
            <button
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 h-10 text-left"
            >
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-300 flex items-center gap-2 min-w-0">
                    <i className="fa-solid fa-satellite-dish text-brand-cyan"></i>
                    <span className="truncate">{t('live.console.multistream.title') || 'Multistream'}</span>
                    {loaded && !unavailable && (
                        <span className="normal-case tracking-normal font-bold text-slate-400 truncate">
                            {isLive
                                ? `${liveCount}/${enabledCount} ${t('live.console.multistream.liveSummary') || 'live'}`
                                : `${enabledCount} ${t('live.console.multistream.armedSummary') || 'on at go-live'}`}
                        </span>
                    )}
                </span>
                <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-slate-500 text-xs`}></i>
            </button>

            {open && (
                <div className="px-3 pb-3 space-y-3">
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                        {t('live.console.multistream.intro') ||
                            'The show is pushed to every destination switched on below, with cardstreet.app/watch and a QR code on screen so social viewers can buy here.'}
                    </p>

                    {unavailable && (
                        <p className="text-[11px] text-amber-300 font-bold">
                            {t('live.console.multistream.unavailable') ||
                                'Multistream is not set up on the server yet (migration pending).'}
                        </p>
                    )}

                    {/* Egress preferences — set before go-live. */}
                    {!isLive && !unavailable && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="rounded-lg bg-black/20 border border-white/10 p-2.5">
                                <p className={labelCls}>
                                    {t('live.console.multistream.orientation') || 'Social video shape'}
                                </p>
                                <div className="flex gap-1.5">
                                    {(['portrait', 'landscape'] as const).map((o) => (
                                        <button
                                            key={o}
                                            onClick={() => onPrefsChange({ ...prefs, orientation: o })}
                                            className={`flex-1 h-9 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                                                prefs.orientation === o
                                                    ? 'bg-brand-cyan text-brand-darker'
                                                    : 'bg-white/5 text-slate-300 border border-white/10'
                                            }`}
                                        >
                                            <i
                                                className={`fa-solid ${
                                                    o === 'portrait' ? 'fa-mobile-screen' : 'fa-display'
                                                } mr-1.5`}
                                            ></i>
                                            {o === 'portrait'
                                                ? t('live.console.multistream.portrait') || 'Portrait 9:16'
                                                : t('live.console.multistream.landscape') || 'Landscape 16:9'}
                                        </button>
                                    ))}
                                </div>
                                <p className="mt-1.5 text-[10px] text-slate-500 leading-snug">
                                    {t('live.console.multistream.orientationHint') ||
                                        'Portrait for TikTok / Instagram / Facebook on phones; landscape for YouTube on a TV.'}
                                </p>
                            </div>
                            <label className="rounded-lg bg-black/20 border border-white/10 p-2.5 flex items-start gap-2.5 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={prefs.overlay}
                                    onChange={(e) => onPrefsChange({ ...prefs, overlay: e.target.checked })}
                                    className="mt-0.5 accent-cyan-400"
                                />
                                <span>
                                    <span className="block text-xs font-bold text-white">
                                        {t('live.console.multistream.overlay') || 'Branded overlay'}
                                    </span>
                                    <span className="block text-[10px] text-slate-500 leading-snug mt-0.5">
                                        {t('live.console.multistream.overlayHint') ||
                                            'Shows cardstreet.app/watch, a QR code and the lot on the block over the video (also in the recording). Turn off for a bare feed.'}
                                    </span>
                                </span>
                            </label>
                        </div>
                    )}

                    {/* Destinations */}
                    {!unavailable && (
                        <div className="space-y-1.5">
                            {loaded && destinations.length === 0 && !formOpen && (
                                <p className="text-[11px] text-slate-500">
                                    {t('live.console.multistream.empty') ||
                                        'No destinations yet — add your Facebook Page or YouTube channel below.'}
                                </p>
                            )}
                            {destinations.map((d) => {
                                const target = targetFor(d.id);
                                const busy = busyId === d.id;
                                const pushing = target?.status === 'live' || target?.status === 'starting';
                                return (
                                    <div
                                        key={d.id}
                                        className="rounded-lg bg-black/20 border border-white/10 px-2.5 py-2"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <i
                                                className={`${PLATFORM_PRESETS[d.platform]?.icon ?? 'fa-solid fa-tower-broadcast'} w-5 text-center text-slate-300`}
                                            ></i>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-bold text-white truncate">{d.label}</p>
                                                <p className="text-[10px] text-slate-500 truncate">
                                                    {t('live.console.multistream.keyLabel') || 'Key'} {d.key_hint || '—'}
                                                </p>
                                            </div>
                                            {statusChip(target?.status ?? null, d.enabled, d.key_unreadable)}
                                            {!isLive ? (
                                                <button
                                                    onClick={() => void toggleEnabled(d)}
                                                    disabled={busy || d.key_unreadable}
                                                    aria-pressed={d.enabled}
                                                    aria-label={t('live.console.multistream.toggle') || 'Push to this destination'}
                                                    className={`relative w-10 h-6 rounded-full transition-colors disabled:opacity-40 ${
                                                        d.enabled ? 'bg-brand-cyan' : 'bg-white/15'
                                                    }`}
                                                >
                                                    <span
                                                        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                                                            d.enabled ? 'left-[18px]' : 'left-0.5'
                                                        }`}
                                                    ></span>
                                                </button>
                                            ) : pushing ? (
                                                <button
                                                    onClick={() => void pushAction(d, 'remove')}
                                                    disabled={busy}
                                                    className="px-2.5 h-8 rounded-lg bg-white/10 text-slate-200 text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                                                >
                                                    {busy ? (
                                                        <i className="fa-solid fa-circle-notch animate-spin"></i>
                                                    ) : (
                                                        t('live.console.multistream.stop') || 'Stop'
                                                    )}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => void pushAction(d, 'add')}
                                                    disabled={busy || d.key_unreadable}
                                                    className="px-2.5 h-8 rounded-lg bg-brand-cyan text-brand-darker text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                                                >
                                                    {busy ? (
                                                        <i className="fa-solid fa-circle-notch animate-spin"></i>
                                                    ) : (
                                                        t('live.console.multistream.start') || 'Start'
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                        {target?.status === 'failed' && target.error && (
                                            <p className="mt-1.5 text-[10px] text-red-300 leading-snug break-words">
                                                {target.error}
                                            </p>
                                        )}
                                        {d.key_unreadable && (
                                            <p className="mt-1.5 text-[10px] text-amber-300 leading-snug">
                                                {t('live.console.multistream.keyUnreadable') ||
                                                    'The saved key can no longer be read — enter it again.'}
                                            </p>
                                        )}
                                        <div className="mt-1.5 flex items-center gap-3">
                                            <button
                                                onClick={() => openEditForm(d)}
                                                className="text-[10px] font-bold text-slate-400 hover:text-white"
                                            >
                                                <i className="fa-solid fa-pen mr-1"></i>
                                                {t('live.console.multistream.edit') || 'Edit key'}
                                            </button>
                                            {confirmDeleteId === d.id ? (
                                                <>
                                                    <button
                                                        onClick={() => void deleteDestination(d)}
                                                        disabled={busy}
                                                        className="text-[10px] font-black text-red-300"
                                                    >
                                                        {t('live.console.multistream.deleteConfirm') || 'Delete for real'}
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmDeleteId(null)}
                                                        className="text-[10px] font-bold text-slate-400"
                                                    >
                                                        {t('live.console.cancel') || 'Cancel'}
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    onClick={() => setConfirmDeleteId(d.id)}
                                                    disabled={pushing}
                                                    className="text-[10px] font-bold text-slate-500 hover:text-red-300 disabled:opacity-40"
                                                >
                                                    <i className="fa-solid fa-trash mr-1"></i>
                                                    {t('live.console.multistream.delete') || 'Delete'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Add / edit form */}
                    {!unavailable && (formOpen ? (
                        <div className="rounded-lg bg-black/20 border border-brand-cyan/30 p-3 space-y-2.5">
                            <div>
                                <label className={labelCls}>
                                    {t('live.console.multistream.platform') || 'Platform'}
                                </label>
                                <CustomSelect
                                    value={platform}
                                    onChange={onPlatformChange}
                                    disabled={!!editingId}
                                    ariaLabel={t('live.console.multistream.platform') || 'Platform'}
                                    triggerClassName="w-full h-10 bg-black/30 border border-white/10 rounded-xl px-3 text-sm font-semibold text-white outline-none focus:border-brand-cyan"
                                    options={DESTINATION_PLATFORMS.map((p) => ({
                                        value: p,
                                        label: PLATFORM_PRESETS[p].label,
                                    }))}
                                />
                            </div>
                            <div>
                                <label className={labelCls}>
                                    {t('live.console.multistream.labelField') || 'Name'}
                                </label>
                                <input
                                    value={label}
                                    onChange={(e) => setLabel(e.target.value)}
                                    placeholder={preset.label}
                                    maxLength={60}
                                    className={inputCls}
                                />
                            </div>
                            <div>
                                <label className={labelCls}>
                                    {t('live.console.multistream.serverUrl') || 'Server URL'}
                                </label>
                                <input
                                    value={rtmpUrl}
                                    onChange={(e) => setRtmpUrl(e.target.value)}
                                    placeholder="rtmps://..."
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    className={`${inputCls} font-mono text-xs`}
                                />
                            </div>
                            <div>
                                <label className={labelCls}>
                                    {t('live.console.multistream.streamKey') || 'Stream key'}
                                    {editingId && (
                                        <span className="ml-1 normal-case tracking-normal text-slate-500">
                                            ({t('live.console.multistream.keyKeep') || 'leave blank to keep the saved key'})
                                        </span>
                                    )}
                                </label>
                                <div className="flex gap-1.5">
                                    <input
                                        value={streamKey}
                                        onChange={(e) => setStreamKey(e.target.value)}
                                        type={showKey ? 'text' : 'password'}
                                        autoComplete="off"
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        placeholder={editingId ? '••••••••' : ''}
                                        className={`${inputCls} font-mono text-xs`}
                                    />
                                    <button
                                        onClick={() => setShowKey((s) => !s)}
                                        aria-label={showKey ? 'Hide key' : 'Show key'}
                                        className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-slate-400 shrink-0"
                                    >
                                        <i className={`fa-solid ${showKey ? 'fa-eye-slash' : 'fa-eye'} text-xs`}></i>
                                    </button>
                                </div>
                                <p className="mt-1.5 text-[10px] text-slate-500 leading-snug">
                                    {isThai ? preset.keyHelpTh : preset.keyHelp}
                                </p>
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                                <button
                                    onClick={() => void submitForm()}
                                    disabled={saving}
                                    className="px-4 h-9 rounded-lg bg-brand-cyan text-brand-darker text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                                >
                                    {saving ? (
                                        <i className="fa-solid fa-circle-notch animate-spin"></i>
                                    ) : (
                                        t('live.console.multistream.save') || 'Save destination'
                                    )}
                                </button>
                                <button
                                    onClick={() => setFormOpen(false)}
                                    className="px-3 h-9 rounded-lg bg-white/5 text-slate-300 text-[10px] font-black uppercase tracking-widest"
                                >
                                    {t('live.console.cancel') || 'Cancel'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={openAddForm}
                            className="w-full h-9 rounded-lg bg-white/5 border border-dashed border-white/15 text-slate-300 text-[10px] font-black uppercase tracking-widest"
                        >
                            <i className="fa-solid fa-plus mr-1.5"></i>
                            {t('live.console.multistream.add') || 'Add destination'}
                        </button>
                    ))}

                    {/* Go-live checklist line: the one mistake that costs the most
                        (a rehearsal on a public show emails the whole base). */}
                    {!isLive && (
                        <p className="text-[10px] text-slate-500 leading-snug">
                            <i className="fa-solid fa-circle-info mr-1"></i>
                            {visibility === 'public'
                                ? t('live.console.multistream.publicNote') ||
                                  'Public show: going live notifies every Cardstreet user by push and email.'
                                : t('live.console.multistream.unlistedNote') ||
                                  'Unlisted show: no notifications — good for a rehearsal.'}
                            {' '}
                            {t('live.console.multistream.watchNote') ||
                                'Social viewers are sent to cardstreet.app/watch, which always opens the live show.'}
                        </p>
                    )}

                    {/* Live with no egress running (it never started, or it died):
                        Start on any destination brings a fresh one up. */}
                    {isLive && egressActive === false && enabledCount > 0 && (
                        <p className="text-[10px] text-amber-300 font-bold leading-snug">
                            <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                            {t('live.console.multistream.egressDown') ||
                                'Nothing is being pushed or recorded right now — tap Start on a destination to bring it back.'}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
