import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Button, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://cardstreet-tcg.vercel.app';

export default function ScannerScreen() {
    const [facing, setFacing] = useState<CameraType>('back');
    const [permission, requestPermission] = useCameraPermissions();
    const [isActive, setIsActive] = useState(false);
    
    // Live stream state
    const cameraRef = useRef<CameraView>(null);
    const [isAutoScanning, setIsAutoScanning] = useState(false);
    const [scanResult, setScanResult] = useState<any>(null);

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

    // Edge-Cloud Hybrid Loop: Take a highly compressed frame every 1.5s
    React.useEffect(() => {
        let interval: NodeJS.Timeout;
        
        const captureFrame = async () => {
             if (!cameraRef.current) return;
             try {
                 // Fast capture with extremely low quality to reduce latency to ~50ms
                 const photo = await cameraRef.current.takePictureAsync({
                     base64: true,
                     quality: 0.1,
                     skipProcessing: true
                 });
                 
                 if (!photo?.base64) return;
                 
                 // Fire frame to the secure Gemini Flash edge route
                 const response = await fetch(`${API_URL}/api/scan`, {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ image: photo.base64 })
                 });
                 
                 const data = await response.json();
                 
                 if (data?.primary && data.primary.confidence > 0.6) {
                     // High confidence match! Pause the loop.
                     setIsAutoScanning(false);
                     setScanResult(data.primary);
                 }
             } catch (e) {
                 // Ignore frame drop gracefully so UI doesn't hitch
             }
        };

        if (isActive && isAutoScanning) {
            // Instantly grab first frame, then initiate interval
            captureFrame();
            interval = setInterval(captureFrame, 1500);
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
                                {isAutoScanning ? 'Scanning for cards...' : 'Align card within frame'}
                            </Text>
                        </View>

                        {/* Controls */}
                        <View className="flex-row justify-around items-center mb-8">
                            <TouchableOpacity className="w-12 h-12 bg-black/40 rounded-full items-center justify-center">
                                <Ionicons name="images" size={24} color="white" />
                            </TouchableOpacity>

                            <TouchableOpacity 
                                onPress={() => setIsAutoScanning(!isAutoScanning)}
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
                                onPress={() => setScanResult(null)}
                                className="flex-1 py-4 bg-slate-800 rounded-xl items-center"
                            >
                                <Text className="text-white font-bold">Try Again</Text>
                            </TouchableOpacity>
                            <TouchableOpacity className="flex-1 py-4 bg-brand-cyan rounded-xl items-center">
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
