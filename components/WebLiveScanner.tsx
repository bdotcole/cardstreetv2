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
}

// Hard ceiling for a single /api/scan request. The route's maxDuration is 60s,
// but in practice Flash returns in 1-5s. If we're still waiting at 25s
// something is wrong — bail out to manual search instead of leaving the user
// staring at "Extracting visual DNA…" indefinitely.
const SCAN_REQUEST_TIMEOUT_MS = 25_000;

async function fetchScan(body: any, signal: AbortSignal): Promise<Response> {
    return fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
}

export default function WebLiveScanner({ onClose, onMatch, onScanFailed }: WebLiveScannerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { t } = useTranslation();
    const { showToast } = useToast();

    const [isVideoLoaded, setIsVideoLoaded] = useState(false);
    const [isScanning, setIsScanning] = useState(true);
    const [isLocked, setIsLocked] = useState(false);
    const [stream, setStream] = useState<MediaStream | null>(null);

    const isProcessingRef = useRef(false);

    // Initialize Camera
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
                setStream(mediaStream);
                if (videoRef.current) {
                    videoRef.current.srcObject = mediaStream;
                }
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
            if (activeStream) {
                activeStream.getTracks().forEach(track => track.stop());
            }
        };
    }, [onClose]);

    const handleManualCapture = () => {
        if (!isLocked && !isProcessingRef.current) {
            setIsLocked(true);
            // Instantly freeze the camera feed to show a snapshot was taken
            if (videoRef.current) {
                videoRef.current.pause();
            }
            triggerHighQualityScan();
        }
    };

    const triggerHighQualityScan = async () => {
        isProcessingRef.current = true;
        try {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            if (!video || !canvas) return;

            // Give UI text a tiny fraction of a second to render flash
            await new Promise(r => setTimeout(r, 50));

            // Calculate precise mathematical layout for cropping out the background
            const Vw = video.videoWidth;
            const Vh = video.videoHeight;
            const Sw = window.innerWidth;
            const Sh = window.innerHeight;

            // object-cover scaling
            const S = Math.max(Sw / Vw, Sh / Vh);
            const Rw = Vw * S;
            const Rh = Vh * S;
            const OffsetX = (Sw - Rw) / 2;
            const OffsetY = (Sh - Rh) / 2;

            // The cutout box dimensions perfectly matched to UI styling logic
            const Cw = Math.min(0.7 * Sw, 280);
            const Ch = Cw * (3.5 / 2.5);
            const BoxX = (Sw - Cw) / 2;
            const BoxY = (Sh - Ch) / 2;

            // Mapping Screen Coordinates back directly into internal Native Video space
            const NativeX = Math.max(0, (BoxX - OffsetX) / S);
            const NativeY = Math.max(0, (BoxY - OffsetY) / S);
            const NativeW = Math.min(Vw - NativeX, Cw / S);
            const NativeH = Math.min(Vh - NativeY, Ch / S);

            // Set canvas precisely to the extracted card boundaries
            canvas.width = NativeW;
            canvas.height = NativeH;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Extrapolate the core document frame instantly WITHOUT OpenCV
            ctx.drawImage(video, NativeX, NativeY, NativeW, NativeH, 0, 0, NativeW, NativeH);
            
            // High compression JPEG is fine now because it's ONLY the card, text is massive
            const base64DataUrl = canvas.toDataURL('image/jpeg', 0.8);
            const base64Image = base64DataUrl.split(',')[1];
            
            if (!base64Image) {
                resetScan();
                return;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), SCAN_REQUEST_TIMEOUT_MS);

            let scanResponse: Response;

            try {
                if (Capacitor.isNativePlatform()) {
                    console.log('Running Fast Native ML Kit OCR...');
                    let texts = '';
                    try {
                        const ocrRes = await Ocr.process({ image: base64DataUrl });
                        texts = ocrRes.results.map(r => r.text).join(' | ');
                        console.log('Extracted Native OCR Text:', texts);
                    } catch (e) {
                        console.warn("Native OCR failed, will fall back to image scan...", e);
                    }

                    if (texts.trim().length > 0) {
                        scanResponse = await fetchScan({ text: texts }, controller.signal);
                    } else {
                        scanResponse = await fetchScan({ image: base64Image }, controller.signal);
                    }
                } else {
                    // Web fallback: send the cropped image straight to Gemini Flash.
                    scanResponse = await fetchScan({ image: base64Image }, controller.signal);
                }
            } finally {
                clearTimeout(timeoutId);
            }

            const scanData = await scanResponse.json();

            if (scanResponse.ok && scanData?.primary) {
                setIsScanning(false);
                if (stream) {
                    stream.getTracks().forEach(track => track.stop());
                }
                onMatch(scanData);
            } else {
                console.error("Scan failed or invalid JSON:", scanData);
                handleScanFailure('no_match');
            }
        } catch (error: any) {
            const isAbort = error?.name === 'AbortError';
            console.error('[Scanner] Scan request failed:', error);
            handleScanFailure(isAbort ? 'timeout' : 'network');
        }
    };

    const handleScanFailure = (reason: 'timeout' | 'network' | 'no_match') => {
        // Stop the camera and tear down the scanner UI — the host will route
        // the user to manual search where they can try again on their terms.
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        setIsScanning(false);
        if (onScanFailed) {
            onScanFailed(reason);
        } else {
            // Legacy fallback: keep the camera running and let the user retry.
            resetScan();
        }
    };

    const resetScan = () => {
        setIsLocked(false);
        isProcessingRef.current = false;
        // Unfreeze camera if scan failed
        if (videoRef.current) {
            videoRef.current.play().catch(e => console.error("Playback failed", e));
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black overflow-hidden">
            {/* CSS to ruthlessly hide Chrome/Capacitor video default play buttons */}
            <style dangerouslySetInnerHTML={{__html: `
                video::-webkit-media-controls { display: none !important; }
                video::-webkit-media-controls-start-playback-button { display: none !important; opacity: 0; }
            `}} />

            {/* Native Video Element */}
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
            
            {/* Hidden Canvases for HQ Frame Capture */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Loading Placeholder while camera boots (Prevents Play Icon flash) */}
            {!isVideoLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-brand-darker">
                    <div className="w-8 h-8 rounded-full border-4 border-brand-cyan border-t-transparent animate-spin"></div>
                </div>
            )}

            {/* Google Lens Style Overlay - True 2.5:3.5 Cutout */}
            {isVideoLoaded && (
                <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
                    <div 
                        className={`relative w-[70vw] max-w-[280px] aspect-[2.5/3.5] rounded-xl overflow-hidden transition-all duration-300 ${isLocked ? 'scale-[1.02] border-brand-cyan/30' : 'scale-100'}`}
                        style={{
                            boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
                        }}
                    >
                        {/* Flashing overlay on Lock */}
                        {isLocked && <div className="absolute inset-0 bg-white/20 animate-pulse z-0" />}

                        {/* Corner Brackets that snap tight when "Locked" */}
                        <div className={`absolute transition-all duration-300 ${isLocked ? 'top-2 left-2 w-6 h-6 border-white/80' : 'top-0 left-0 w-8 h-8 border-brand-cyan'} border-t-[5px] border-l-[5px] rounded-tl-xl z-10`} />
                        <div className={`absolute transition-all duration-300 ${isLocked ? 'top-2 right-2 w-6 h-6 border-white/80' : 'top-0 right-0 w-8 h-8 border-brand-cyan'} border-t-[5px] border-r-[5px] rounded-tr-xl z-10`} />
                        <div className={`absolute transition-all duration-300 ${isLocked ? 'bottom-2 left-2 w-6 h-6 border-white/80' : 'bottom-0 left-0 w-8 h-8 border-brand-cyan'} border-b-[5px] border-l-[5px] rounded-bl-xl z-10`} />
                        <div className={`absolute transition-all duration-300 ${isLocked ? 'bottom-2 right-2 w-6 h-6 border-white/80' : 'bottom-0 right-0 w-8 h-8 border-brand-cyan'} border-b-[5px] border-r-[5px] rounded-br-xl z-10`} />
                        
                        {/* Lasers tracking effect (dissolves when locked) */}
                        {!isLocked && isScanning && (
                            <div className="absolute inset-x-0 h-[2px] bg-brand-cyan/80 blur-[1px] rounded-full top-1/2 -mt-[1px] animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] shadow-[0_0_15px_#00e5ff]" />
                        )}
                    </div>
                </div>
            )}

            {/* UI Header / Text */}
            <div className={`absolute top-12 w-full px-6 flex justify-between items-center z-20 transition-opacity duration-300 ${isVideoLoaded ? 'opacity-100' : 'opacity-0'}`}>
                <button 
                    onClick={onClose}
                    className="w-12 h-12 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center text-white pointer-events-auto shadow-lg"
                >
                    <i className="fa-solid fa-xmark text-xl"></i>
                </button>
                <div className={`bg-black/60 backdrop-blur-md px-4 py-2 rounded-full transition-colors ${isLocked ? 'border border-brand-cyan/50' : ''}`}>
                    <span className={`text-sm font-bold tracking-widest uppercase ${isLocked ? 'text-brand-cyan' : 'text-white'}`}>
                        {isLocked ? 'Scanning AI...' : 'Frame Card'}
                    </span>
                </div>
                <div className="w-12" /> {/* Spacer */}
            </div>

            {/* Camera Controls Footer */}
            <div className={`absolute bottom-12 w-full flex flex-col items-center justify-center z-20 transition-opacity duration-300 ${isVideoLoaded ? 'opacity-100' : 'opacity-0'}`}>
                {isLocked ? (
                    <div className="px-6 py-3 rounded-full bg-brand-cyan/20 text-brand-cyan font-semibold inline-flex items-center gap-2 backdrop-blur-md">
                        <i className="fa-solid fa-spinner animate-spin"></i>
                        Extracting visual DNA...
                    </div>
                ) : (
                    <button 
                        onClick={handleManualCapture}
                        className="w-20 h-20 rounded-full border-4 border-white/80 p-1 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg"
                    >
                        <div className="w-full h-full bg-white rounded-full shadow-[0_0_20px_rgba(255,255,255,0.5)]"></div>
                    </button>
                )}
            </div>
        </div>
    );
}
