'use client';

import React, { useEffect, useRef, useState } from 'react';
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
 */

type CamState = 'connecting' | 'live' | 'invalid' | 'error' | 'stopped' | 'inapp';

export default function TableCamPage() {
    const { t } = useTranslation();
    const [state, setState] = useState<CamState>('connecting');
    const [errorKey, setErrorKey] = useState<'connectError' | 'cameraError'>('connectError');
    const [copyResult, setCopyResult] = useState<'copied' | 'failed' | null>(null);
    const { connect, disconnect, publishCamera, localVideo } = useLiveKitRoom();
    const startedRef = useRef(false);

    useEffect(() => {
        if (startedRef.current) return; // StrictMode double-invoke guard
        startedRef.current = true;

        // The Capacitor WebView cannot grant getUserMedia (the binary carries
        // no camera permission) — don't attempt it; hand off to a real
        // browser. location.href keeps the FULL url including the #fragment,
        // so the LiveKit token survives the copy/open handoff without ever
        // leaving the device.
        if (isNativeShell()) {
            setState('inapp');
            return;
        }

        const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
        const params = new URLSearchParams(hash);
        const token = params.get('t');
        const url = params.get('u');
        if (!token || !url || !/^wss?:\/\//i.test(url)) {
            setState('invalid');
            return;
        }

        (async () => {
            try {
                await connect(url, token);
            } catch {
                setErrorKey('connectError');
                setState('error');
                return;
            }
            try {
                await publishCamera({ facingMode: 'environment', audio: false });
                setState('live');
            } catch {
                setErrorKey('cameraError');
                setState('error');
            }
        })();
    }, [connect, publishCamera]);

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
                                {errorKey === 'cameraError'
                                    ? t('live.cam.cameraError') || 'Could not access the rear camera'
                                    : t('live.cam.connectError') || 'Could not connect to the stream'}
                            </p>
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
                                    'The app cannot access the camera for broadcasting yet — the browser can.'}
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
