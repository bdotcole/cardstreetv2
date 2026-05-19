'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Ocr } from '@jcesarmobile/capacitor-ocr';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';

interface WebLiveScannerProps {
    onClose: () => void;
    onMatch: (scanData: any) => void;
    // Called when the scan can't identify the card (timeout, network error, no match).
    // The host should close the scanner and route the user to manual search.
    onScanFailed?: (reason: 'timeout' | 'network' | 'no_match') => void;
    // Used as the language filter for pHash search, with fallback to all-languages
    // if zero matches. The component overrides this with a value derived from the OCR
    // text whenever native OCR runs and detects Thai/Japanese script.
    languageHint?: 'en' | 'th' | 'jp';
}

// Quick script-based language detection. Cheap, reliable on OCR output, no model needed.
const RE_THAI = /[฀-๿]/;
const RE_JP_KANA = /[぀-ヿ]/;          // Hiragana + Katakana — uniquely Japanese
const RE_CJK = /[一-鿿]/;              // Han chars: Japanese kanji OR Chinese.
function detectLanguageFromText(text: string): 'en' | 'th' | 'jp' | undefined {
    if (!text) return undefined;
    if (RE_THAI.test(text)) return 'th';
    if (RE_JP_KANA.test(text)) return 'jp';
    // Han alone (no kana) is unusual on Pokémon cards — treat as JP since Chinese cards
    // aren't in the catalog.
    if (RE_CJK.test(text)) return 'jp';
    return 'en';
}

// Hard ceiling for a single /api/scan request. The route's maxDuration is 60s,
// but in practice the pHash + Flash pipeline returns in <3s. If we're still waiting
// at 25s something is wrong — bail out to manual search.
const SCAN_REQUEST_TIMEOUT_MS = 25_000;

// Tuning for the auto-capture loop. Picked empirically.
const ANALYSIS_FPS = 3;                // Frame-analysis cadence. Stability > motion, so 3fps is plenty.
const ANALYSIS_W = 80;                 // Tiny grayscale buffer (80x112, 2.5:3.5). All checks run on this.
const ANALYSIS_H = 112;
const FOCUS_VARIANCE_THRESHOLD = 120;  // Laplacian variance above this = sharp enough to OCR.
const STABILITY_DIFF_THRESHOLD = 6;    // Mean absolute per-pixel diff below this = scene is still.
const STABLE_FRAMES_REQUIRED = 2;      // Need this many consecutive stable+focused frames before firing.

async function fetchScan(body: any, signal: AbortSignal): Promise<Response> {
    return fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
}

export default function WebLiveScanner({ onClose, onMatch, onScanFailed, languageHint }: WebLiveScannerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const analysisCanvasRef = useRef<HTMLCanvasElement>(null);
    const prevFrameRef = useRef<Uint8ClampedArray | null>(null);
    const stableCountRef = useRef(0);
    const isProcessingRef = useRef(false);
    const streamRef = useRef<MediaStream | null>(null);

    const { t } = useTranslation();
    const { showToast } = useToast();

    const [isVideoLoaded, setIsVideoLoaded] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const [statusHint, setStatusHint] = useState<'searching' | 'aligning' | 'sharpen' | 'scanning'>('searching');

    useEffect(() => {
        let activeStream: MediaStream | null = null;
        const startCamera = async () => {
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'environment',
                        width: { ideal: 1920 },
                        height: { ideal: 1080 }
                    }
                });
                activeStream = mediaStream;
                streamRef.current = mediaStream;
                if (videoRef.current) videoRef.current.srcObject = mediaStream;
            } catch (err) {
                console.error('Camera access denied:', err);
                showToast(
                    t('paymentFlow.cameraPermission')
                        || 'Please allow camera access in your browser settings to use the scanner.',
                    'error',
                );
                onClose();
            }
        };
        startCamera();
        return () => {
            if (activeStream) activeStream.getTracks().forEach(t => t.stop());
        };
    }, [onClose]);

    // Continuous analysis loop: focus + stability checks on a small grayscale buffer.
    useEffect(() => {
        if (!isVideoLoaded || isLocked) return;
        const intervalMs = Math.round(1000 / ANALYSIS_FPS);

        const tick = () => {
            if (isProcessingRef.current) return;
            const video = videoRef.current;
            const acanvas = analysisCanvasRef.current;
            if (!video || !acanvas || video.readyState < 2) return;

            acanvas.width = ANALYSIS_W;
            acanvas.height = ANALYSIS_H;
            const actx = acanvas.getContext('2d', { willReadFrequently: true });
            if (!actx) return;

            const crop = computeCardCrop(video, window.innerWidth, window.innerHeight);
            actx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, ANALYSIS_W, ANALYSIS_H);
            const rgba = actx.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H).data;

            const gray = toGrayscale(rgba, ANALYSIS_W, ANALYSIS_H);
            const focus = laplacianVariance(gray, ANALYSIS_W, ANALYSIS_H);
            const isSharp = focus >= FOCUS_VARIANCE_THRESHOLD;

            let isStable = false;
            if (prevFrameRef.current && prevFrameRef.current.length === gray.length) {
                isStable = meanAbsDiff(gray, prevFrameRef.current) < STABILITY_DIFF_THRESHOLD;
            }
            prevFrameRef.current = gray;

            if (isSharp && isStable) {
                stableCountRef.current += 1;
                setStatusHint('aligning');
                if (stableCountRef.current >= STABLE_FRAMES_REQUIRED) {
                    stableCountRef.current = 0;
                    triggerScan();
                }
            } else {
                stableCountRef.current = 0;
                setStatusHint(isSharp ? 'aligning' : 'sharpen');
            }
        };

        const id = window.setInterval(tick, intervalMs);
        return () => window.clearInterval(id);
    }, [isVideoLoaded, isLocked]);

    const triggerScan = async () => {
        if (isProcessingRef.current || isLocked) return;
        isProcessingRef.current = true;
        setIsLocked(true);
        setStatusHint('scanning');

        try {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            if (!video || !canvas) {
                resetScan();
                return;
            }

            const crop = computeCardCrop(video, window.innerWidth, window.innerHeight);
            canvas.width = crop.w;
            canvas.height = crop.h;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resetScan();
                return;
            }
            ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            const base64Image = dataUrl.split(',')[1];
            if (!base64Image) {
                resetScan();
                return;
            }

            // On native we additionally run on-device OCR. The server uses pHash first; OCR text
            // only matters when pHash misses, so we send both and let the server pick the best path.
            let ocrText: string | undefined;
            if (Capacitor.isNativePlatform()) {
                try {
                    const ocrRes = await Ocr.process({ image: dataUrl });
                    ocrText = ocrRes.results.map((r) => r.text).join(' | ').trim() || undefined;
                } catch (e) {
                    console.warn('Native OCR failed (non-fatal):', e);
                }
            }

            // Prefer language detected from OCR (reflects the actual card) over the
            // user's app-locale preference (reflects what they usually scan).
            const detectedLang = ocrText ? detectLanguageFromText(ocrText) : undefined;
            const resolvedLang = detectedLang ?? languageHint;

            const body: any = { image: base64Image };
            if (ocrText) body.text = ocrText;
            if (resolvedLang) body.languageHint = resolvedLang;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), SCAN_REQUEST_TIMEOUT_MS);

            let res: Response;
            try {
                res = await fetchScan(body, controller.signal);
            } finally {
                clearTimeout(timeoutId);
            }

            const scanData = await res.json();

            if (res.ok && (scanData?.matches?.length || scanData?.primary?.name)) {
                streamRef.current?.getTracks().forEach((t) => t.stop());
                onMatch(scanData);
            } else {
                console.error('Scan failed:', scanData);
                handleScanFailure('no_match');
            }
        } catch (error: any) {
            const isAbort = error?.name === 'AbortError';
            console.error('[Scanner] Scan request failed:', error);
            handleScanFailure(isAbort ? 'timeout' : 'network');
        }
    };

    const handleScanFailure = (reason: 'timeout' | 'network' | 'no_match') => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        if (onScanFailed) {
            onScanFailed(reason);
        } else {
            resetScan();
        }
    };

    const resetScan = () => {
        isProcessingRef.current = false;
        stableCountRef.current = 0;
        prevFrameRef.current = null;
        setIsLocked(false);
        setStatusHint('searching');
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black overflow-hidden">
            <style dangerouslySetInnerHTML={{ __html: `
                video::-webkit-media-controls { display: none !important; }
                video::-webkit-media-controls-start-playback-button { display: none !important; opacity: 0; }
            ` }} />

            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                disablePictureInPicture
                disableRemotePlayback
                onPlaying={() => setIsVideoLoaded(true)}
                className={`absolute inset-0 w-full h-[100dvh] object-cover transition-opacity duration-300 ${isVideoLoaded ? 'opacity-100' : 'opacity-0'}`}
            />

            <canvas ref={canvasRef} className="hidden" />
            <canvas ref={analysisCanvasRef} className="hidden" />

            {!isVideoLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-brand-darker">
                    <div className="w-8 h-8 rounded-full border-4 border-brand-cyan border-t-transparent animate-spin"></div>
                </div>
            )}

            {isVideoLoaded && (
                <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
                    <div
                        className={`relative w-[70vw] max-w-[280px] aspect-[2.5/3.5] rounded-xl overflow-hidden transition-all duration-300 ${isLocked ? 'scale-[1.02] border-brand-cyan/30' : 'scale-100'}`}
                        style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)' }}
                    >
                        {isLocked && <div className="absolute inset-0 bg-white/20 animate-pulse z-0" />}
                        <div className={`absolute transition-all duration-300 ${isLocked ? 'top-2 left-2 w-6 h-6 border-white/80' : 'top-0 left-0 w-8 h-8 border-brand-cyan'} border-t-[5px] border-l-[5px] rounded-tl-xl z-10`} />
                        <div className={`absolute transition-all duration-300 ${isLocked ? 'top-2 right-2 w-6 h-6 border-white/80' : 'top-0 right-0 w-8 h-8 border-brand-cyan'} border-t-[5px] border-r-[5px] rounded-tr-xl z-10`} />
                        <div className={`absolute transition-all duration-300 ${isLocked ? 'bottom-2 left-2 w-6 h-6 border-white/80' : 'bottom-0 left-0 w-8 h-8 border-brand-cyan'} border-b-[5px] border-l-[5px] rounded-bl-xl z-10`} />
                        <div className={`absolute transition-all duration-300 ${isLocked ? 'bottom-2 right-2 w-6 h-6 border-white/80' : 'bottom-0 right-0 w-8 h-8 border-brand-cyan'} border-b-[5px] border-r-[5px] rounded-br-xl z-10`} />
                        {!isLocked && (
                            <div className="absolute inset-x-0 h-[2px] bg-brand-cyan/80 blur-[1px] rounded-full top-1/2 -mt-[1px] animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] shadow-[0_0_15px_#00e5ff]" />
                        )}
                    </div>
                </div>
            )}

            <div className={`absolute top-12 w-full px-6 flex justify-between items-center z-20 transition-opacity duration-300 ${isVideoLoaded ? 'opacity-100' : 'opacity-0'}`}>
                <button
                    onClick={onClose}
                    className="w-12 h-12 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center text-white pointer-events-auto shadow-lg"
                >
                    <i className="fa-solid fa-xmark text-xl"></i>
                </button>
                <div className={`bg-black/60 backdrop-blur-md px-4 py-2 rounded-full transition-colors ${isLocked ? 'border border-brand-cyan/50' : ''}`}>
                    <span className={`text-sm font-bold tracking-widest uppercase ${isLocked ? 'text-brand-cyan' : 'text-white'}`}>
                        {statusHintLabel(statusHint)}
                    </span>
                </div>
                <div className="w-12" />
            </div>

            <div className={`absolute bottom-12 w-full flex flex-col items-center justify-center z-20 transition-opacity duration-300 ${isVideoLoaded ? 'opacity-100' : 'opacity-0'}`}>
                {isLocked ? (
                    <div className="px-6 py-3 rounded-full bg-brand-cyan/20 text-brand-cyan font-semibold inline-flex items-center gap-2 backdrop-blur-md">
                        <i className="fa-solid fa-spinner animate-spin"></i>
                        Matching against catalog...
                    </div>
                ) : (
                    <button
                        onClick={triggerScan}
                        className="w-20 h-20 rounded-full border-4 border-white/80 p-1 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg"
                        aria-label="Capture now"
                    >
                        <div className="w-full h-full bg-white rounded-full shadow-[0_0_20px_rgba(255,255,255,0.5)]"></div>
                    </button>
                )}
            </div>
        </div>
    );
}

function statusHintLabel(hint: 'searching' | 'aligning' | 'sharpen' | 'scanning') {
    switch (hint) {
        case 'searching': return 'Frame Card';
        case 'sharpen':   return 'Hold Steady';
        case 'aligning':  return 'Locking In';
        case 'scanning':  return 'Scanning AI…';
    }
}

function computeCardCrop(video: HTMLVideoElement, screenW: number, screenH: number) {
    const Vw = video.videoWidth;
    const Vh = video.videoHeight;
    const S = Math.max(screenW / Vw, screenH / Vh);
    const Rw = Vw * S;
    const Rh = Vh * S;
    const OffsetX = (screenW - Rw) / 2;
    const OffsetY = (screenH - Rh) / 2;
    const Cw = Math.min(0.7 * screenW, 280);
    const Ch = Cw * (3.5 / 2.5);
    const BoxX = (screenW - Cw) / 2;
    const BoxY = (screenH - Ch) / 2;
    const x = Math.max(0, (BoxX - OffsetX) / S);
    const y = Math.max(0, (BoxY - OffsetY) / S);
    const w = Math.min(Vw - x, Cw / S);
    const h = Math.min(Vh - y, Ch / S);
    return { x, y, w, h };
}

function toGrayscale(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; j < gray.length; i += 4, j += 1) {
        gray[j] = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) | 0;
    }
    return gray;
}

// Variance of Laplacian — classic blur detector. Sharp edges produce high variance.
function laplacianVariance(gray: Uint8ClampedArray, w: number, h: number): number {
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
            sum += lap;
            sumSq += lap * lap;
            n += 1;
        }
    }
    const mean = sum / n;
    return sumSq / n - mean * mean;
}

function meanAbsDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
    let total = 0;
    for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
    return total / a.length;
}
