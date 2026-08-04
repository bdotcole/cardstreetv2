'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useLiveKitRoom } from '@/lib/hooks/useLiveKitRoom';
import { TrackVideo } from '@/components/live/TrackVideo';

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

type CamState = 'connecting' | 'live' | 'invalid' | 'error' | 'stopped';

export default function TableCamPage() {
    const { t } = useTranslation();
    const [state, setState] = useState<CamState>('connecting');
    const [errorKey, setErrorKey] = useState<'connectError' | 'cameraError'>('connectError');
    const { connect, disconnect, publishCamera, localVideo } = useLiveKitRoom();
    const startedRef = useRef(false);

    useEffect(() => {
        if (startedRef.current) return; // StrictMode double-invoke guard
        startedRef.current = true;

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
                </div>
            )}
        </main>
    );
}
