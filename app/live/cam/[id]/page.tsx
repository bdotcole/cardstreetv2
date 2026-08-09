'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useLiveKitRoom } from '@/lib/hooks/useLiveKitRoom';
import { TrackVideo } from '@/components/live/TrackVideo';
import { isNativeShell, openInSystemBrowser } from '@/components/live/shared';

/**
 * The TABLE CAM: the broadcaster's second phone, launched by scanning the
 * console's QR code. Publishes the rear camera into the stream's room as the
 * 'table' slot. Video only — the face-cam device carries the mic; a second
 * open mic on the same table would just feed back.
 *
 * No login: the LiveKit token in the URL FRAGMENT is the auth. Fragments never
 * leave the browser (not sent in requests, absent from server logs), the token
 * is short-lived, publisher-scoped to this one room, and dies when the room
 * closes. The page deliberately fetches nothing.
 *
 * Sequencing: the camera is opened FIRST (the permission gate), and only a
 * granted camera proceeds to connect + publish. On a first visit getUserMedia
 * blocks on the browser's permission prompt — running it mid-connection used
 * to strand the page on "Connecting..." forever (a room that died while the
 * prompt was up made publishTrack never settle, and there was no timeout or
 * retry). Each phase now has its own state, the connect phase is bounded, and
 * every failure lands on a Retry that restarts the sequence from scratch.
 *
 * The Capacitor shell runs the SAME sequence: the binary carries
 * android.permission.CAMERA and the WebView grants getUserMedia (the in-app
 * scanner proves it), so an upfront native block would strand a device that
 * works. The browser handoff is a recovery FALLBACK — reached only after a
 * real capture failure — which also means no code change when a future binary
 * widens permissions.
 */

type CamState = 'permission' | 'connecting' | 'live' | 'invalid' | 'error' | 'stopped' | 'inapp';
type CamErrorKey = 'connectError' | 'cameraError' | 'cameraDenied';

const CONNECT_TIMEOUT_MS = 12000;

export default function TableCamPage() {
    const { t } = useTranslation();
    const [state, setState] = useState<CamState>('permission');
    const [errorKey, setErrorKey] = useState<CamErrorKey>('connectError');
    const [copyResult, setCopyResult] = useState<'copied' | 'failed' | null>(null);
    const { connect, disconnect, publishCamera, startPreview, stopPreview, localVideo } =
        useLiveKitRoom();
    const startedRef = useRef(false);
    // Monotonic attempt counter: a retry (or the connect timeout) bumps it so
    // an in-flight prior attempt can no longer touch state when its awaits
    // finally settle.
    const attemptRef = useRef(0);
    const timeoutRef = useRef<number | null>(null);

    // A capture failure inside the native shell is recoverable rather than
    // fatal: the same URL opened in Chrome always can grant the camera, and
    // the #fragment (the LiveKit token) survives the handoff without ever
    // leaving the device. Outside the shell there is nowhere to escape to, so
    // the normal error + Retry stands.
    const failCamera = useCallback((err: unknown) => {
        if (isNativeShell()) {
            setState('inapp');
            return;
        }
        const name = err instanceof Error ? err.name : '';
        setErrorKey(name === 'NotAllowedError' ? 'cameraDenied' : 'cameraError');
        setState('error');
    }, []);

    const runSequence = useCallback(async () => {
        const attempt = ++attemptRef.current;

        const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
        const params = new URLSearchParams(hash);
        const token = params.get('t');
        const url = params.get('u');
        if (!token || !url || !/^wss?:\/\//i.test(url)) {
            setState('invalid');
            return;
        }

        // Phase 1 — the permission gate. Open the camera BEFORE touching the
        // room so a blocked/slow permission prompt can't strand a half-built
        // connection; there is deliberately no timeout here (the user may sit
        // on the prompt as long as they like).
        setState('permission');
        try {
            await startPreview({ facingMode: 'environment', audio: false });
        } catch (err) {
            if (attemptRef.current !== attempt) return;
            failCamera(err);
            return;
        }
        if (attemptRef.current !== attempt) return;

        // Phase 2 — connect + publish (adopts the preview tracks, so no
        // re-prompt). Bounded: a hang surfaces Retry, not an eternal spinner.
        setState('connecting');
        const timer = window.setTimeout(() => {
            if (attemptRef.current !== attempt) return;
            attemptRef.current += 1; // orphan the hung attempt
            void disconnect();
            stopPreview();
            setErrorKey('connectError');
            setState('error');
        }, CONNECT_TIMEOUT_MS);
        timeoutRef.current = timer;
        try {
            await connect(url, token);
            if (attemptRef.current !== attempt) return;
            await publishCamera({ facingMode: 'environment', audio: false });
            if (attemptRef.current !== attempt) return;
            setState('live');
        } catch (err) {
            if (attemptRef.current !== attempt) return;
            void disconnect();
            stopPreview();
            const name = err instanceof Error ? err.name : '';
            if (name === 'NotAllowedError') {
                failCamera(err);
                return;
            }
            setErrorKey('connectError');
            setState('error');
        } finally {
            window.clearTimeout(timer);
        }
    }, [connect, disconnect, publishCamera, startPreview, stopPreview, failCamera]);

    // Full clean-slate restart: tear down any stale room/preview first so
    // connect() builds a fresh Room instead of early-returning the dead one.
    const retry = useCallback(async () => {
        attemptRef.current += 1;
        await disconnect();
        stopPreview();
        void runSequence();
    }, [disconnect, stopPreview, runSequence]);

    useEffect(() => {
        if (startedRef.current) return; // StrictMode double-invoke guard
        startedRef.current = true;
        void runSequence();
    }, [runSequence]);

    useEffect(
        () => () => {
            if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
        },
        [],
    );

    const stop = async () => {
        await disconnect();
        setState('stopped');
    };

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setCopyResult('copied');
        } catch {
            setCopyResult('failed');
        }
    };

    return (
        <main className="h-[100dvh] bg-black text-white relative overflow-hidden">
            {state === 'live' && localVideo && (
                <TrackVideo track={localVideo} className="absolute inset-0 w-full h-full object-cover" />
            )}

            {state === 'live' && (
                <>
                    <div className="absolute top-0 inset-x-0 pt-[calc(var(--sat)+0.75rem)] px-4 flex justify-center pointer-events-none">
                        <span className="px-3 py-1.5 rounded-full bg-brand-red text-white text-[11px] font-black uppercase tracking-widest flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                            {t('live.cam.live') || 'LIVE — table cam'}
                        </span>
                    </div>
                    <div className="absolute bottom-0 inset-x-0 pb-[calc(var(--sab)+1.25rem)] flex justify-center">
                        <button
                            onClick={() => void stop()}
                            className="px-8 h-12 rounded-full bg-white/15 border border-white/30 backdrop-blur-sm text-white text-xs font-black uppercase tracking-[0.2em] active:scale-95 transition-all"
                        >
                            {t('live.cam.stop') || 'Stop'}
                        </button>
                    </div>
                </>
            )}

            {state !== 'live' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
                    {state === 'permission' && (
                        <>
                            <i className="fa-solid fa-camera text-brand-cyan text-3xl mb-4"></i>
                            <p className="text-sm text-slate-300 leading-relaxed">
                                {t('live.cam.allowCamera') || 'Allow camera access to continue'}
                            </p>
                        </>
                    )}
                    {state === 'connecting' && (
                        <>
                            <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-2xl mb-4"></i>
                            <p className="text-sm text-slate-300">{t('live.cam.connecting') || 'Connecting...'}</p>
                        </>
                    )}
                    {state === 'invalid' && (
                        <>
                            <i className="fa-solid fa-qrcode text-slate-600 text-3xl mb-4"></i>
                            <p className="text-sm text-slate-300 leading-relaxed">
                                {t('live.cam.invalidLink') ||
                                    'This camera link is invalid or expired — rescan the QR code from the console'}
                            </p>
                        </>
                    )}
                    {state === 'error' && (
                        <>
                            <i className="fa-solid fa-triangle-exclamation text-brand-red text-3xl mb-4"></i>
                            <p className="text-sm text-slate-300 leading-relaxed">
                                {errorKey === 'cameraDenied'
                                    ? t('live.cam.cameraDenied') ||
                                      'Camera access was blocked — allow the camera for this site in your browser settings, then retry'
                                    : errorKey === 'cameraError'
                                      ? t('live.cam.cameraError') || 'Could not access the rear camera'
                                      : t('live.cam.connectError') || 'Could not connect to the stream'}
                            </p>
                            <button
                                onClick={() => void retry()}
                                className="mt-6 px-8 h-12 rounded-full bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-[0.2em] active:scale-95 transition-all"
                            >
                                {t('live.cam.retry') || 'Retry'}
                            </button>
                        </>
                    )}
                    {state === 'stopped' && (
                        <>
                            <i className="fa-solid fa-video-slash text-slate-600 text-3xl mb-4"></i>
                            <p className="text-sm text-slate-300">{t('live.cam.stopped') || 'Camera stopped'}</p>
                        </>
                    )}
                    {state === 'inapp' && (
                        <>
                            <i className="fa-solid fa-arrow-up-right-from-square text-brand-cyan text-3xl mb-4"></i>
                            <p className="text-sm font-bold text-white leading-relaxed">
                                {t('live.cam.inAppTitle') ||
                                    'Open this link in Chrome to use your phone as a camera'}
                            </p>
                            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                                {t('live.cam.inAppDesc') ||
                                    "The app couldn't start the camera on this device — the browser can."}
                            </p>
                            <div className="mt-5 w-full max-w-[280px] space-y-2">
                                <button
                                    onClick={() => void openInSystemBrowser(window.location.href)}
                                    className="w-full h-12 rounded-xl bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                                >
                                    <i className="fa-solid fa-arrow-up-right-from-square mr-2"></i>
                                    {t('live.cam.openInBrowser') || 'Open in browser'}
                                </button>
                                <button
                                    onClick={() => void copyLink()}
                                    className="w-full h-12 rounded-xl bg-white/10 text-slate-200 text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                                >
                                    <i className="fa-solid fa-copy mr-2"></i>
                                    {t('live.cam.copyLink') || 'Copy link'}
                                </button>
                            </div>
                            {copyResult === 'copied' && (
                                <p className="text-[11px] text-brand-green mt-3">
                                    {t('live.console.linkCopied') || 'Link copied'}
                                </p>
                            )}
                            {copyResult === 'failed' && (
                                <p className="text-[11px] text-brand-red mt-3">
                                    {t('live.console.copyError') || 'Could not copy the link'}
                                </p>
                            )}
                        </>
                    )}
                </div>
            )}
        </main>
    );
}
