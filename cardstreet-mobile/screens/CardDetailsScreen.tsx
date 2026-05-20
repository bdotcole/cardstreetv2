import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

export default function CardDetailsScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const { card } = route.params as { card: any };

    if (!card) return null;

    return (
        <View className="flex-1 bg-brand-darker">
            <ScrollView className="flex-1">
                {/* Header - Image Section */}
                <View className="relative h-[500px] items-center justify-center">
                    <LinearGradient
                        colors={['rgba(6,182,212,0.1)', 'transparent']}
                        className="absolute inset-0"
                    />

                    {/* Back Button */}
                    <TouchableOpacity
                        onPress={() => navigation.goBack()}
                        className="absolute top-12 left-6 z-50 w-10 h-10 items-center justify-center rounded-xl bg-white/10"
                    >
                        <Ionicons name="chevron-back" size={24} color="white" />
                    </TouchableOpacity>

                    <Image
                        source={{ uri: card.imageUrl }}
                        placeholder={card.images?.small ? { uri: card.images.small } : undefined}
                        className="w-full h-full"
                        contentFit="contain"
                        cachePolicy="memory-disk"
                        transition={150}
                    />
                </View>

                {/* Content Section */}
                <View className="-mt-10 bg-brand-darker/90 rounded-t-3xl p-6 min-h-[500px]">
                    {/* Title & Set */}
                    <View className="mb-6">
                        <View className="flex-row items-center gap-2 mb-1">
                            <View className="bg-brand-cyan px-2 py-0.5 rounded skew-x-[-10deg]">
                                <Text className="text-brand-darker text-[10px] font-black uppercase italic">{card.rarity}</Text>
                            </View>
                            <Text className="text-slate-400 text-xs font-bold uppercase tracking-widest">{card.set}</Text>
                        </View>
                        <Text className="text-3xl font-black text-white leading-tight">{card.name}</Text>
                        {card.thaiName && <Text className="text-lg font-bold text-slate-500">{card.thaiName}</Text>}
                    </View>

                    {/* Prices */}
                    <View className="flex-row gap-4 mb-6">
                        <View className="flex-1 bg-slate-800/50 p-4 rounded-2xl border border-white/5">
                            <Text className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Market Price</Text>
                            <Text className="text-2xl font-black text-white">฿{card.marketPrice?.toLocaleString() || 'N/A'}</Text>
                        </View>
                        <View className="flex-1 bg-slate-800/50 p-4 rounded-2xl border border-white/5">
                            <Text className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">High</Text>
                            <Text className="text-2xl font-black text-brand-red">฿{card.prices?.high?.toLocaleString() || 'N/A'}</Text>
                        </View>
                    </View>

                    {/* Description / Text */}
                    {card.text && (
                        <View className="bg-white/5 p-4 rounded-xl border border-white/5 mb-6">
                            <Text className="text-slate-300 text-sm leading-6">{card.text}</Text>
                        </View>
                    )}

                </View>
            </ScrollView>

            {/* Footer Actions */}
            <View className="absolute bottom-0 left-0 right-0 p-6 bg-brand-darker/90 border-t border-white/5 flex-row gap-4 pb-10">
                <TouchableOpacity className="flex-1 h-14 bg-white/5 border border-white/10 items-center justify-center rounded-xl flex-row gap-2">
                    <Ionicons name="folder-open-outline" size={20} color="white" />
                    <Text className="text-white font-black text-[10px] tracking-[0.2em]">ADD TO VAULT</Text>
                </TouchableOpacity>
                <TouchableOpacity className="flex-1 h-14 bg-brand-green items-center justify-center rounded-xl flex-row gap-2 shadow-lg shadow-brand-green/20">
                    <Ionicons name="cart-outline" size={20} color="#0f172a" />
                    <Text className="text-brand-darker font-black text-[10px] tracking-[0.2em]">SHOP NOW</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}
