import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Button, StyleSheet } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://cardstreet-tcg.vercel.app';

// After this many live-frame misses, escalate ONE frame to mode 'single' (the
// server's full pipeline incl. the Gemini image fallback). If that also misses,
// stop the loop instead of burning battery/data — the user repositions and taps
// to scan again.
const LIVE_MISSES_BEFORE_ESCALATION = 5;
// Hard ceiling per request. Live frames return in ~1s; a hung request must not
// wedge the loop (the in-flight guard would keep every later frame waiting).
const SCAN_TIMEOUT_MS = 20_000;

// Fire-and-forget scan feedback. Confirmed picks feed the server's learned
// photo-hash index; rejections mark failures for diagnostics. Never throws.
function sendScanFeedback(scanId: string | undefined, outcome: 'confirmed' | 'rejected', cardId?: string) {
    if (!scanId) return;
    fetch(`${API_URL}/api/scan/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, outcome, cardId }),
    }).catch(() => {});
}

export default function ScannerScreen() {
    const [facing, setFacing] = useState<CameraType>('back');
    const [permission, requestPermission] = useCameraPermissions();
    const [isActive, setIsActive] = useState(false);

    // Live stream state
    const cameraRef = useRef<CameraView>(null);
    const [isAutoScanning, setIsAutoScanning] = useState(false);
    const [scanResult, setScanResult] = useState<any>(null);
    const [scanHint, setScanHint] = useState<string | null>(null);

    // One request in flight at a time. Without this, a slow response stacked a
    // new full scan every interval tick — the failure mode that hammered Gemini
    // into rate limits and (via the old Lens fallback) exhausted SerpApi.
    const inFlightRef = useRef(false);
    const missCountRef = useRef(0);

    // Only activate camera when screen is focused
    useFocusEffect(
        React.useCallback(() => {
            setIsActive(true);
            return () => {
                setIsActive(false);
                setIsAutoScanning(false);
            };
        }, [])
    );

    const startAutoScan = () => {
        missCountRef.current = 0;
        setScanHint(null);
        setIsAutoScanning(true);
    };

    // Auto-capture loop. Frames go up as mode 'live': the server runs only its
    // cheap tiers (pHash + deterministic set-code lookups, ~1s) and returns an
    // empty result on a miss — the next frame simply retries. One frame per
    // LIVE_MISSES_BEFORE_ESCALATION escalates to the full pipeline.
    React.useEffect(() => {
        let interval: ReturnType<typeof setInterval>;

        const captureFrame = async () => {
            if (!cameraRef.current || inFlightRef.current) return;
            inFlightRef.current = true;
            try {
                // Mid-quality JPEG gives sharp the detail it needs for a reliable pHash.
                // The previous 0.1 quality lost so much edge information that pHash distances
                // were unstable across consecutive frames.
                const photo = await cameraRef.current.takePictureAsync({
                    base64: true,
                    quality: 0.6,
                    skipProcessing: true
                });

                if (!photo?.base64) return;

                const escalate = missCountRef.current >= LIVE_MISSES_BEFORE_ESCALATION;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
                let data: any;
                try {
                    const response = await fetch(`${API_URL}/api/scan`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ image: photo.base64, mode: escalate ? 'single' : 'live' }),
                        signal: controller.signal,
                    });
                    data = await response.json();
                } finally {
                    clearTimeout(timer);
                }

                // Prefer the pHash path: matches[] is pre-resolved Card data, no client-side reconcile needed.
                if (Array.isArray(data?.matches) && data.matches.length > 0 && (data.matchDistance ?? 99) <= 14) {
                    setIsAutoScanning(false);
                    setScanResult({
                        ...data.matches[0],
                        _matches: data.matches,
                        _matchDistance: data.matchDistance,
                        _scanId: data.scanId,
                        _cardId: data.matches[0]?.id,
                    });
                    return;
                }

                if (data?.primary && data.primary.confidence > 0.6) {
                    setIsAutoScanning(false);
                    setScanResult({ ...data.primary, _scanId: data.scanId });
                    return;
                }

                missCountRef.current += 1;
                if (escalate) {
                    // Even the full pipeline came up empty — stop looping.
                    setIsAutoScanning(false);
                    setScanHint("Couldn't identify this card. Adjust lighting or angle, then tap to scan again.");
                }
            } catch (e) {
                // Frame drop / timeout is fine — next interval tries again.
            } finally {
                inFlightRef.current = false;
            }
        };

        if (isActive && isAutoScanning) {
            captureFrame();
            interval = setInterval(captureFrame, 2500);
        }

        return () => clearInterval(interval);
    }, [isActive, isAutoScanning]);

    if (!permission) {
        return <View />;
    }

    if (!permission.granted) {
        return (
            <SafeAreaView className="flex-1 bg-brand-darker items-center justify-center p-6">
                <Text className="text-white text-center mb-4">We need your permission to show the camera</Text>
                <Button onPress={requestPermission} title="grant permission" />
            </SafeAreaView>
        );
    }

    return (
        <View className="flex-1 bg-black">
            {isActive && !scanResult && (
                <CameraView ref={cameraRef} style={styles.camera} facing={facing}>
                    <SafeAreaView className="flex-1 justify-between p-6">
                        {/* Header */}
                        <View className="flex-row justify-between items-center">
                            <TouchableOpacity className="w-10 h-10 bg-black/40 rounded-full items-center justify-center">
                                <Ionicons name="close" size={24} color="white" />
                            </TouchableOpacity>
                            <View className="bg-black/40 px-4 py-2 rounded-full">
                                <Text className="text-white font-bold text-xs">SCAN CARD</Text>
                            </View>
                            <TouchableOpacity className="w-10 h-10 bg-black/40 rounded-full items-center justify-center">
                                <Ionicons name="flash-off" size={24} color="white" />
                            </TouchableOpacity>
                        </View>

                        {/* Scanner Frame */}
                        <View className="flex-1 items-center justify-center">
                            <View className={`w-64 h-96 border-2 rounded-2xl relative transition-all duration-300 ${isAutoScanning ? 'border-brand-cyan shadow-[0_0_15px_rgba(0,255,255,0.5)]' : 'border-white/30'}`}>
                                <View className={`absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 rounded-tl-xl ${isAutoScanning ? 'border-brand-cyan' : 'border-white'}`} />
                                <View className={`absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 rounded-tr-xl ${isAutoScanning ? 'border-brand-cyan' : 'border-white'}`} />
                                <View className={`absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 rounded-bl-xl ${isAutoScanning ? 'border-brand-cyan' : 'border-white'}`} />
                                <View className={`absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 rounded-br-xl ${isAutoScanning ? 'border-brand-cyan' : 'border-white'}`} />
                                {isAutoScanning && (
                                    <View className="absolute inset-x-0 h-1 bg-brand-cyan/50 blur-sm rounded-full top-1/2 -mt-0.5 animate-pulse" />
                                )}
                            </View>
                            <Text className={`mt-4 text-sm font-medium px-3 py-1 rounded-lg ${isAutoScanning ? 'text-brand-cyan bg-brand-cyan/10' : 'text-white/80 bg-black/40'}`}>
                                {isAutoScanning ? 'Scanning for cards...' : (scanHint ?? 'Align card within frame')}
                            </Text>
                        </View>

                        {/* Controls */}
                        <View className="flex-row justify-around items-center mb-8">
                            <TouchableOpacity className="w-12 h-12 bg-black/40 rounded-full items-center justify-center">
                                <Ionicons name="images" size={24} color="white" />
                            </TouchableOpacity>

                            <TouchableOpacity
                                onPress={() => (isAutoScanning ? setIsAutoScanning(false) : startAutoScan())}
                                className={`w-20 h-20 rounded-full items-center justify-center border-4 ${isAutoScanning ? 'bg-black/40 border-brand-cyan/80' : 'bg-white border-brand-cyan/50'}`}
                            >
                                {isAutoScanning ? (
                                    <View className="w-8 h-8 rounded-sm bg-brand-cyan" />
                                ) : (
                                    <View className="w-16 h-16 bg-white rounded-full border-2 border-black/10" />
                                )}
                            </TouchableOpacity>

                            <TouchableOpacity
                                className="w-12 h-12 bg-black/40 rounded-full items-center justify-center"
                                onPress={() => setFacing(current => (current === 'back' ? 'front' : 'back'))}
                            >
                                <Ionicons name="camera-reverse" size={24} color="white" />
                            </TouchableOpacity>
                        </View>
                    </SafeAreaView>
                </CameraView>
            )}

            {/* Found Result Preview */}
            {scanResult && (
                <SafeAreaView className="flex-1 justify-center items-center bg-black/95 px-6">
                    <View className="w-full bg-slate-900 border border-brand-cyan/30 rounded-3xl p-6 items-center">
                        <Ionicons name="checkmark-circle" size={64} color="#00e5ff" className="mb-4" />
                        <Text className="text-white font-bold text-xl text-center">{scanResult.name}</Text>
                        <Text className="text-slate-400 font-medium text-sm mt-1">{scanResult.set} • #{scanResult.number}</Text>
                        <Text className="text-brand-cyan font-bold mt-2">{scanResult.rarity}</Text>

                        <View className="w-full flex-row gap-4 mt-8">
                            <TouchableOpacity
                                onPress={() => {
                                    sendScanFeedback(scanResult._scanId, 'rejected');
                                    setScanResult(null);
                                }}
                                className="flex-1 py-4 bg-slate-800 rounded-xl items-center"
                            >
                                <Text className="text-white font-bold">Try Again</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={() => sendScanFeedback(scanResult._scanId, 'confirmed', scanResult._cardId)}
                                className="flex-1 py-4 bg-brand-cyan rounded-xl items-center"
                            >
                                <Text className="text-slate-900 font-bold">View Card</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </SafeAreaView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    camera: {
        flex: 1,
    },
});
