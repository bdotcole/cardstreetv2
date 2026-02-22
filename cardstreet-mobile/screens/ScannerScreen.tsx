import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Button, StyleSheet } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

export default function ScannerScreen() {
    const [facing, setFacing] = useState<CameraType>('back');
    const [permission, requestPermission] = useCameraPermissions();
    const [isActive, setIsActive] = useState(false);

    // Only activate camera when screen is focused
    useFocusEffect(
        React.useCallback(() => {
            setIsActive(true);
            return () => setIsActive(false);
        }, [])
    );

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
            {isActive && (
                <CameraView style={styles.camera} facing={facing}>
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
                            <View className="w-64 h-96 border-2 border-brand-cyan/50 rounded-2xl relative">
                                <View className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-brand-cyan rounded-tl-xl" />
                                <View className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-brand-cyan rounded-tr-xl" />
                                <View className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-brand-cyan rounded-bl-xl" />
                                <View className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-brand-cyan rounded-br-xl" />
                            </View>
                            <Text className="text-white/80 mt-4 text-sm font-medium bg-black/40 px-3 py-1 rounded-lg">
                                Align card within frame
                            </Text>
                        </View>

                        {/* Controls */}
                        <View className="flex-row justify-around items-center mb-8">
                            <TouchableOpacity className="w-12 h-12 bg-black/40 rounded-full items-center justify-center">
                                <Ionicons name="images" size={24} color="white" />
                            </TouchableOpacity>

                            <TouchableOpacity className="w-20 h-20 bg-white rounded-full items-center justify-center border-4 border-brand-cyan/50">
                                <View className="w-16 h-16 bg-white rounded-full border-2 border-black/10" />
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
        </View>
    );
}

const styles = StyleSheet.create({
    camera: {
        flex: 1,
    },
});
