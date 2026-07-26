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
    // User's app locale. Sent as a soft preference: server uses it only as a tiebreaker
    // when two prints of the same card have identical pHash distance. The card's actual
    // language is detected server-side from OCR or an image classifier — so a Thai user
    // scanning a Japanese card still gets Japanese candidates back.
    languageHint?: 'en' | 'th' | 'jp';
}

// Hard ceiling for a single /api/scan request. The route's maxDuration is 60s,
// but in practice the pHash + Flash pipeline returns in <3s. If we're still waiting
// at 25s something is wrong — bail out to manual search.
const SCAN_REQUEST_TIMEOUT_MS = 25_000;

// --- Detection / auto-capture tuning. Picked empirically; tune live on device. ---
// Capture only fires when the card is (a) fully inside the frame, (b) large enough to read,
// (c) genuinely in focus, and (d) held still for a beat. Each is a separate gate, so a
// failing condition produces a corrective hint ("move closer", "hold still to focus")
// instead of a blurry / half / too-far grab — the exact failure modes we're killing.
const ANALYSIS_FPS = 12;               // Detection cadence. Cheap on the tiny buffer, so run it live for a responsive snap.
const DETECT_MAX = 160;                // Longest side of the detection buffer. Other side derives from the visible aspect.
const MIN_DETECT_STREAK = 4;           // Consecutive frames with a valid, fully-in-frame card before a lock can begin (~0.33s). Stops instant grabs.
const STABLE_FRAMES_REQUIRED = 3;      // Sharp + settled frames on top of the streak before firing (~0.25s).

// Card-edge detection. A TCG card is a high-contrast rectangle; we find its outer
// borders from directional-gradient projections, then validate shape + size.
const CARD_ASPECT = 2.5 / 3.5;         // Portrait card width/height (~0.714).
const ASPECT_TOLERANCE = 0.16;         // Accept detected boxes whose aspect is within this of CARD_ASPECT (tolerates slight tilt).
const MIN_CARD_AREA_FRAC = 0.20;       // Card must fill at least this fraction of the frame, else "move closer" (reject too-far / tiny grabs).
const MAX_CARD_AREA_FRAC = 0.94;       // ...and not basically the whole frame (card overflowing the edges -> "fit the whole card").
const EDGE_MARGIN_FRAC = 0.02;         // A detected border within this fraction of the buffer edge means the card is cut off -> "fit the whole card".
const EDGE_GRADIENT_THRESHOLD = 36;    // Per-pixel Sobel magnitude floor before it counts toward a projection (noise gate).
const EDGE_PEAK_FRAC = 0.4;            // A projection bin counts as a card border when it exceeds this fraction of the projection max.
const BOX_STABILITY_PX = 5;            // Max corner movement (buffer px) between frames to count the box as "settled".

// Focus gate. Measured as the variance of the Laplacian on the *actual* card region drawn
// from the full-res video at SHARPNESS_SAMPLE_MAX px — NOT on the 160px detection buffer,
// whose own downscale is a low-pass filter that washes blur out (that was why soft frames
// still got captured). This is the primary blur knob: raise it if blurry frames slip
// through, lower it if a sharp card never fires.
const SHARPNESS_SAMPLE_MAX = 340;      // Normalize the focus crop to this long side before measuring (resolution-independent threshold).
const SHARPNESS_MIN = 140;             // Laplacian-variance floor on that crop = "in focus".
const FOCUS_GRACE_MS = 4_000;          // If a card stays framed + still but soft this long (fixed-focus / macro-limited cameras), relax the floor so we don't strand the user.
const FOCUS_GRACE_FACTOR = 0.6;

// Fallback: if edge detection never locks (cluttered / low-contrast background), fire on a
// sharp + stable centered region so a detection miss never strands the user. Still gated on
// the same hi-res sharpness check so the fallback can't grab a blur either.
const DETECT_TIMEOUT_MS = 2_500;
const FALLBACK_FRAMES_REQUIRED = 3;
const STABILITY_DIFF_THRESHOLD = 6;    // Mean absolute per-pixel diff below this = scene is still (fallback path only).

// Manual shutter: reuse the detector's card crop if it was seen within this window. A fresh
// box is exactly the card the user is aiming at; anything older risks capturing a moved camera.
const SHUTTER_BOX_FRESH_MS = 1_000;

interface Box { x: number; y: number; w: number; h: number; score?: number; }

// A detected rectangle plus why it is / isn't a usable lock target:
//  'card'   — card-shaped, fully in frame, well sized: a lock candidate.
//  'far'    — card-shaped but too small in the frame: prompt "move closer".
//  'cutoff' — card-shaped but touching a frame edge / overflowing: prompt "fit the whole card".
interface DetectResult { box: Box; status: 'card' | 'far' | 'cutoff'; }

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
    const focusCanvasRef = useRef<HTMLCanvasElement>(null);         // hi-res focus sampling (sharpness gate)

    const prevFrameRef = useRef<Uint8ClampedArray | null>(null);   // previous detection buffer (fallback stability)
    const prevBoxRef = useRef<Box | null>(null);                   // last raw detected box (for settle check)
    const lockCountRef = useRef(0);                                // consecutive sharp+settled frames (detection path)
    const detectStreakRef = useRef(0);                             // consecutive frames with a valid, fully-in-frame card
    const firstDetectAtRef = useRef(0);                            // timestamp the current detection streak began (focus grace)
    const centerCountRef = useRef(0);                              // consecutive sharp+stable frames (fallback path)
    const lastDetectAtRef = useRef(0);                             // timestamp of last successful detection
    const captureCropRef = useRef<Box | null>(null);              // crop (video px) to grab on the next trigger; null = use center crop
    const lastCardCropRef = useRef<{ crop: Box; at: number } | null>(null); // most recent card-shaped detection (video px), for the manual shutter
    const isProcessingRef = useRef(false);
    const streamRef = useRef<MediaStream | null>(null);

    const { t } = useTranslation();
    const { showToast } = useToast();

    const [isVideoLoaded, setIsVideoLoaded] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const [statusHint, setStatusHint] = useState<'searching' | 'closer' | 'fit' | 'aligning' | 'sharpen' | 'scanning'>('searching');
    // True while the detector is tracking a lock candidate. Lights up the stationary guide
    // frame — the overlay itself never moves; detection coords are used only for capture.
    const [cardDetected, setCardDetected] = useState(false);
    // Frozen still + white flash so the grab reads as instant while the network match runs.
    const [frozenFrame, setFrozenFrame] = useState<string | null>(null);
    const [flash, setFlash] = useState(false);

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

    // Continuous detection loop. Each tick: downscale the visible video region, detect the
    // card's bounding box from edge projections, light the stationary guide frame while a
    // card is tracked, and fire when the box is sharp + settled. Falls back to a center
    // sharp+stable heuristic if nothing locks.
    useEffect(() => {
        if (!isVideoLoaded || isLocked) return;
        const intervalMs = Math.round(1000 / ANALYSIS_FPS);
        lastDetectAtRef.current = Date.now();

        const tick = () => {
            if (isProcessingRef.current) return;
            const video = videoRef.current;
            const acanvas = analysisCanvasRef.current;
            const fcanvas = focusCanvasRef.current;
            if (!video || !acanvas || !fcanvas || video.readyState < 2 || !video.videoWidth) return;

            const screenW = window.innerWidth;
            const screenH = window.innerHeight;
            const vis = visibleVideoRect(video, screenW, screenH);
            const { w: dw, h: dh } = detectBufferDims(vis);
            if (dw < 8 || dh < 8) return;

            acanvas.width = dw;
            acanvas.height = dh;
            const actx = acanvas.getContext('2d', { willReadFrequently: true });
            if (!actx) return;

            // Draw only the on-screen-visible region of the video so detection coords map
            // cleanly to screen (overlay) and back to video pixels (capture).
            actx.drawImage(video, vis.x, vis.y, vis.w, vis.h, 0, 0, dw, dh);
            const gray = toGrayscale(actx.getImageData(0, 0, dw, dh).data, dw, dh);

            const now = Date.now();
            const det = detectCardBox(gray, dw, dh);

            // Only a card-shaped, fully-in-frame, well-sized detection is a lock candidate.
            // A cut-off or too-small rectangle still drives a corrective hint but never fires.
            if (det && det.status === 'card') {
                const box = det.box;
                lastDetectAtRef.current = now;
                centerCountRef.current = 0;
                if (detectStreakRef.current === 0) firstDetectAtRef.current = now;
                detectStreakRef.current += 1;
                setCardDetected(true);

                const settled = prevBoxRef.current != null && maxCornerDelta(box, prevBoxRef.current) < BOX_STABILITY_PX;
                prevBoxRef.current = box;

                // Judge focus on the real card pixels, not the tiny detection buffer (whose
                // downscale hides blur). Relax the floor once a card has been held a while so
                // fixed-focus cameras that never hit the sharp threshold aren't stranded.
                const videoBox = bufferBoxToVideo(box, dw, dh, vis);
                lastCardCropRef.current = { crop: padCrop(videoBox, 0.04, vis.Vw, vis.Vh), at: now };
                const sharpness = regionSharpness(video, videoBox, fcanvas);
                const graced = now - firstDetectAtRef.current > FOCUS_GRACE_MS;
                const focusFloor = graced ? SHARPNESS_MIN * FOCUS_GRACE_FACTOR : SHARPNESS_MIN;

                if (detectStreakRef.current < MIN_DETECT_STREAK) {
                    lockCountRef.current = 0;
                    setStatusHint('aligning');
                } else if (sharpness < focusFloor) {
                    lockCountRef.current = 0;
                    setStatusHint('sharpen');
                } else if (!settled) {
                    lockCountRef.current = 0;
                    setStatusHint('aligning');
                } else {
                    lockCountRef.current += 1;
                    setStatusHint('aligning');
                    if (lockCountRef.current >= STABLE_FRAMES_REQUIRED) {
                        lockCountRef.current = 0;
                        // Grab the detected card (lightly padded) rather than the fixed center box.
                        captureCropRef.current = padCrop(videoBox, 0.04, vis.Vw, vis.Vh);
                        triggerScan();
                    }
                }
            } else {
                prevBoxRef.current = null;
                lockCountRef.current = 0;
                detectStreakRef.current = 0;
                setCardDetected(false);
                // Tell the user how to fix the framing instead of silently grabbing a bad shot.
                setStatusHint(det ? (det.status === 'far' ? 'closer' : 'fit') : 'searching');

                // Degrade to a centered sharp+stable heuristic only after we've failed to lock
                // for a while — so cluttered backgrounds / low contrast still scan, just less
                // precisely. Still gated on the same hi-res sharpness so it can't grab a blur.
                if (now - lastDetectAtRef.current > DETECT_TIMEOUT_MS) {
                    const centerBox = computeCardCrop(video, screenW, screenH);
                    const sharpness = regionSharpness(video, centerBox, fcanvas);
                    const stable = prevFrameRef.current != null
                        && prevFrameRef.current.length === gray.length
                        && meanAbsDiff(gray, prevFrameRef.current) < STABILITY_DIFF_THRESHOLD;
                    if (sharpness >= SHARPNESS_MIN && stable) {
                        centerCountRef.current += 1;
                        if (centerCountRef.current >= FALLBACK_FRAMES_REQUIRED) {
                            centerCountRef.current = 0;
                            captureCropRef.current = null; // null -> triggerScan uses the center crop
                            triggerScan();
                        }
                    } else {
                        centerCountRef.current = 0;
                    }
                }
            }

            prevFrameRef.current = gray;
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

            // Prefer the detected-card crop; fall back to the centered guide box (manual
            // shutter / degraded path) when detection didn't supply one.
            const raw = captureCropRef.current
                ?? computeCardCrop(video, window.innerWidth, window.innerHeight);
            const crop = {
                x: Math.round(raw.x),
                y: Math.round(raw.y),
                w: Math.round(raw.w),
                h: Math.round(raw.h),
            };

            canvas.width = crop.w;
            canvas.height = crop.h;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resetScan();
                return;
            }
            ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

            // Higher quality than a typical thumbnail: the server reads the tiny printed set
            // code / number off this frame and hashes it against the catalog, so chroma/edge
            // fidelity directly affects identification accuracy.
            const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
            const base64Image = dataUrl.split(',')[1];
            if (!base64Image) {
                resetScan();
                return;
            }

            // Instant feedback: freeze the captured still and flash the shutter so the grab
            // feels immediate even though the catalog match takes a few seconds behind it.
            setFrozenFrame(dataUrl);
            setFlash(true);
            window.setTimeout(() => setFlash(false), 180);

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

            // The server detects the card's actual language from OCR text (preferred) or
            // an image classifier. We just pass the user's app locale as a tiebreaker.
            // mode 'single': this is one deliberate capture (the auto-fire gates ensure a
            // sharp, settled frame), so the server may run its full pipeline on a miss.
            const body: any = { image: base64Image, mode: 'single' };
            if (ocrText) body.text = ocrText;
            if (languageHint) body.languageHint = languageHint;

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
        lockCountRef.current = 0;
        detectStreakRef.current = 0;
        firstDetectAtRef.current = 0;
        centerCountRef.current = 0;
        prevFrameRef.current = null;
        prevBoxRef.current = null;
        captureCropRef.current = null;
        lastCardCropRef.current = null;
        lastDetectAtRef.current = Date.now();
        setIsLocked(false);
        setStatusHint('searching');
        setCardDetected(false);
        setFrozenFrame(null);
        setFlash(false);
    };

    const onShutter = () => {
        // Manual override: the user is confirming what they see. If the detector has a
        // fresh card-shaped box, capture that card — not the fixed center guide, which on
        // a cluttered table pulls in neighboring cards and can even clip the target. Only
        // fall back to the center crop when nothing card-shaped has been seen recently.
        const last = lastCardCropRef.current;
        captureCropRef.current = last && Date.now() - last.at <= SHUTTER_BOX_FRESH_MS ? last.crop : null;
        triggerScan();
    };

    // theme-dark-locked: camera chrome renders dark in both themes
    return (
        <div className="theme-dark-locked fixed inset-0 z-[100] bg-black overflow-hidden">
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
            <canvas ref={focusCanvasRef} className="hidden" />

            {/* Frozen still over the live feed while matching, so the captured frame stays put. */}
            {frozenFrame && (
                <img src={frozenFrame} alt="" className="absolute inset-0 w-full h-[100dvh] object-contain bg-black z-[5]" />
            )}

            {/* Shutter flash. */}
            {flash && <div className="absolute inset-0 bg-white z-[60] animate-[ping_0.18s_ease-out] opacity-80" />}

            {!isVideoLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-brand-darker">
                    <div className="w-8 h-8 rounded-full border-4 border-brand-cyan border-t-transparent animate-spin"></div>
                </div>
            )}

            {/* Stationary guide frame. It never moves — it lights up cyan while the detector
                is tracking a card ("Locking in"), and stays a dashed hint frame otherwise.
                Detection coords still drive the capture crop; they just don't drive the UI,
                because a per-frame re-snapped box read as jarring jitter. */}
            {isVideoLoaded && !frozenFrame && (
                <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
                    <div
                        className={`relative w-[70vw] max-w-[280px] aspect-[2.5/3.5] rounded-xl transition-colors duration-200 ${
                            cardDetected || isLocked
                                ? 'border-[3px] border-brand-cyan'
                                : 'border-2 border-dashed border-white/30'
                        }`}
                        style={{
                            boxShadow: cardDetected || isLocked
                                ? '0 0 0 9999px rgba(0,0,0,0.6), 0 0 22px rgba(0,229,255,0.55)'
                                : '0 0 0 9999px rgba(0,0,0,0.45)',
                        }}
                    >
                        {(cardDetected || isLocked) && <CornerBrackets />}
                        {cardDetected && !isLocked && (
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
                <div className={`bg-black/60 backdrop-blur-md px-4 py-2 rounded-full transition-colors ${isLocked || cardDetected ? 'border border-brand-cyan/50' : ''}`}>
                    <span className={`text-sm font-bold tracking-widest uppercase ${isLocked || cardDetected ? 'text-brand-cyan' : 'text-white'}`}>
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
                        onClick={onShutter}
                        className="w-20 h-20 rounded-full border-4 border-white/80 p-1 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg pointer-events-auto"
                        aria-label="Capture now"
                    >
                        <div className="w-full h-full bg-white rounded-full shadow-[0_0_20px_rgba(255,255,255,0.5)]"></div>
                    </button>
                )}
            </div>
        </div>
    );
}

function CornerBrackets() {
    return (
        <>
            <div className="absolute -top-[3px] -left-[3px] w-7 h-7 border-t-[5px] border-l-[5px] border-brand-cyan rounded-tl-xl" />
            <div className="absolute -top-[3px] -right-[3px] w-7 h-7 border-t-[5px] border-r-[5px] border-brand-cyan rounded-tr-xl" />
            <div className="absolute -bottom-[3px] -left-[3px] w-7 h-7 border-b-[5px] border-l-[5px] border-brand-cyan rounded-bl-xl" />
            <div className="absolute -bottom-[3px] -right-[3px] w-7 h-7 border-b-[5px] border-r-[5px] border-brand-cyan rounded-br-xl" />
        </>
    );
}

function statusHintLabel(hint: 'searching' | 'closer' | 'fit' | 'aligning' | 'sharpen' | 'scanning') {
    switch (hint) {
        case 'searching': return 'Point at a card';
        case 'closer':    return 'Move closer';
        case 'fit':       return 'Fit the whole card';
        case 'sharpen':   return 'Hold still to focus';
        case 'aligning':  return 'Locking in';
        case 'scanning':  return 'Scanning AI…';
    }
}

// --- Geometry -------------------------------------------------------------

// The video is rendered object-cover, so only a sub-rect of it is on screen. This returns
// that visible region in video pixel coords (plus the native video dims for clamping).
function visibleVideoRect(video: HTMLVideoElement, screenW: number, screenH: number) {
    const Vw = video.videoWidth;
    const Vh = video.videoHeight;
    const S = Math.max(screenW / Vw, screenH / Vh); // cover scale
    const visW = screenW / S;
    const visH = screenH / S;
    const visX = (Vw - visW) / 2;
    const visY = (Vh - visH) / 2;
    return { x: visX, y: visY, w: visW, h: visH, Vw, Vh };
}

// Detection buffer matching the visible aspect, so a detected box's aspect equals the real
// card's aspect (no distortion to fool the aspect-ratio check). Longest side = DETECT_MAX.
function detectBufferDims(vis: { w: number; h: number }) {
    const a = vis.w / vis.h;
    return a >= 1
        ? { w: DETECT_MAX, h: Math.round(DETECT_MAX / a) }
        : { w: Math.round(DETECT_MAX * a), h: DETECT_MAX };
}

function bufferBoxToVideo(box: Box, dw: number, dh: number, vis: { x: number; y: number; w: number; h: number }): Box {
    const sx = vis.w / dw, sy = vis.h / dh;
    return { x: vis.x + box.x * sx, y: vis.y + box.y * sy, w: box.w * sx, h: box.h * sy };
}

function padCrop(c: Box, frac: number, Vw: number, Vh: number): Box {
    const px = c.w * frac, py = c.h * frac;
    const x = Math.max(0, c.x - px);
    const y = Math.max(0, c.y - py);
    return { x, y, w: Math.min(Vw - x, c.w + 2 * px), h: Math.min(Vh - y, c.h + 2 * py) };
}

function maxCornerDelta(a: Box, b: Box): number {
    return Math.max(
        Math.abs(a.x - b.x),
        Math.abs(a.y - b.y),
        Math.abs((a.x + a.w) - (b.x + b.w)),
        Math.abs((a.y + a.h) - (b.y + b.h)),
    );
}

// Centered guide-box crop in video pixels. Used by the manual shutter and the degraded
// fallback path when edge detection didn't produce a card crop.
function computeCardCrop(video: HTMLVideoElement, screenW: number, screenH: number): Box {
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

// --- Image analysis -------------------------------------------------------

function toGrayscale(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; j < gray.length; i += 4, j += 1) {
        gray[j] = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) | 0;
    }
    return gray;
}

// Sharpness of a card region, sampled from the full-resolution video — NOT the 160px
// detection buffer. The detection buffer's downscale is a low-pass filter that erases the
// high-frequency detail blur detection relies on, so a soft card and a sharp one look the
// same there. We redraw the region at SHARPNESS_SAMPLE_MAX px (a fixed scale, so the
// threshold is resolution-independent) and take the Laplacian variance of that.
function regionSharpness(video: HTMLVideoElement, box: Box, canvas: HTMLCanvasElement): number {
    const long = Math.max(box.w, box.h);
    if (long < 8) return 0;
    const scale = Math.min(1, SHARPNESS_SAMPLE_MAX / long);
    const w = Math.max(8, Math.round(box.w * scale));
    const h = Math.max(8, Math.round(box.h * scale));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;
    ctx.drawImage(video, box.x, box.y, box.w, box.h, 0, 0, w, h);
    const gray = toGrayscale(ctx.getImageData(0, 0, w, h).data, w, h);
    return laplacianVariance(gray, w, h);
}

// Variance of Laplacian — classic blur detector. Sharp edges produce high variance.
function laplacianVariance(gray: Uint8ClampedArray, w: number, h: number): number {
    if (w < 3 || h < 3) return 0;
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

// Sobel gradients. gx responds to vertical edges (the card's left/right borders); gy to
// horizontal edges (top/bottom). Returned as signed float arrays.
function sobel(gray: Uint8ClampedArray, w: number, h: number): { gx: Float32Array; gy: Float32Array } {
    const gx = new Float32Array(w * h);
    const gy = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const tl = gray[i - w - 1], t = gray[i - w], tr = gray[i - w + 1];
            const l = gray[i - 1], r = gray[i + 1];
            const bl = gray[i + w - 1], b = gray[i + w], br = gray[i + w + 1];
            gx[i] = (tr + 2 * r + br) - (tl + 2 * l + bl);
            gy[i] = (bl + 2 * b + br) - (tl + 2 * t + tr);
        }
    }
    return { gx, gy };
}

// Box blur (radius 1) over a 1D projection — merges anti-aliased multi-pixel edges into one peak.
function smooth1d(arr: Float32Array): void {
    const n = arr.length;
    if (n < 3) return;
    const out = new Float32Array(n);
    out[0] = (arr[0] + arr[1]) / 2;
    out[n - 1] = (arr[n - 2] + arr[n - 1]) / 2;
    for (let i = 1; i < n - 1; i++) out[i] = (arr[i - 1] + arr[i] + arr[i + 1]) / 3;
    arr.set(out);
}

function arrMax(arr: Float32Array): number {
    let m = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    return m;
}

// Outermost bin (scanning inward from one end) whose value clears the threshold.
function firstAbove(arr: Float32Array, thresh: number, fromStart: boolean): number {
    if (fromStart) {
        for (let i = 0; i < arr.length; i++) if (arr[i] >= thresh) return i;
    } else {
        for (let i = arr.length - 1; i >= 0; i--) if (arr[i] >= thresh) return i;
    }
    return -1;
}

// Detect the card's bounding box from directional-gradient projections, then classify the
// framing. Returns null only when nothing card-shaped is present; otherwise the status tells
// the caller whether it's a lock candidate ('card') or how the user should reframe ('far' /
// 'cutoff'). Surfacing the reason is what lets the UI coach instead of grabbing a bad shot.
function detectCardBox(gray: Uint8ClampedArray, w: number, h: number): DetectResult | null {
    const { gx, gy } = sobel(gray, w, h);

    // Project edge energy: |gx| onto columns (left/right borders), |gy| onto rows (top/bottom).
    const colE = new Float32Array(w);
    const rowE = new Float32Array(h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const ax = Math.abs(gx[i]);
            if (ax > EDGE_GRADIENT_THRESHOLD) colE[x] += ax;
            const ay = Math.abs(gy[i]);
            if (ay > EDGE_GRADIENT_THRESHOLD) rowE[y] += ay;
        }
    }
    smooth1d(colE);
    smooth1d(rowE);

    const colMax = arrMax(colE);
    const rowMax = arrMax(rowE);
    if (colMax <= 0 || rowMax <= 0) return null;

    const left = firstAbove(colE, colMax * EDGE_PEAK_FRAC, true);
    const right = firstAbove(colE, colMax * EDGE_PEAK_FRAC, false);
    const top = firstAbove(rowE, rowMax * EDGE_PEAK_FRAC, true);
    const bottom = firstAbove(rowE, rowMax * EDGE_PEAK_FRAC, false);
    if (left < 0 || right < 0 || top < 0 || bottom < 0) return null;

    const bw = right - left;
    const bh = bottom - top;
    if (bw < 6 || bh < 6) return null;

    // Must look like a portrait card — otherwise it isn't our target at all.
    const aspect = bw / bh;
    if (Math.abs(aspect - CARD_ASPECT) > ASPECT_TOLERANCE) return null;

    const score = (colE[left] + colE[right]) / colMax + (rowE[top] + rowE[bottom]) / rowMax;
    const box: Box = { x: left, y: top, w: bw, h: bh, score };

    // A border sitting on the buffer edge means the card runs past the frame — capturing now
    // would clip the card (and often the printed set code), so ask the user to fit it in.
    const mx = Math.max(1, Math.round(w * EDGE_MARGIN_FRAC));
    const my = Math.max(1, Math.round(h * EDGE_MARGIN_FRAC));
    const areaFrac = (bw * bh) / (w * h);
    if (left <= mx || top <= my || right >= w - 1 - mx || bottom >= h - 1 - my || areaFrac > MAX_CARD_AREA_FRAC) {
        return { box, status: 'cutoff' };
    }
    // Too small in the frame: a distant grab is low-resolution and matches poorly.
    if (areaFrac < MIN_CARD_AREA_FRAC) {
        return { box, status: 'far' };
    }
    return { box, status: 'card' };
}
