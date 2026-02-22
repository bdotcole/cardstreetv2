import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, RefreshControl, ImageBackground } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { pokemonService, ApiSet } from '@/services/pokemonService';
import { collectionService } from '@/services/collectionService';
import { supabase } from '@/lib/supabase/client';

export default function HomeScreen() {
    const navigation = useNavigation<any>();
    const [sets, setSets] = useState<ApiSet[]>([]);
    const [user, setUser] = useState<any>(null);
    const [vaultValue, setVaultValue] = useState(0);
    const [refreshing, setRefreshing] = useState(false);

    const loadData = async () => {
        try {
            // Fetch User & Vault
            const { data: { user } } = await supabase.auth.getUser();
            setUser(user);

            if (user) {
                const items = await collectionService.getUserCollection(user.id);
                const total = items.reduce((sum, item) => sum + (item.card?.marketPrice || 0) * item.quantity, 0);
                setVaultValue(total);
            }

            // Fetch Latest Sets
            const setsData = await pokemonService.fetchSets('en', 1, 5);
            setSets(setsData.data);

        } catch (error) {
            console.error('Home load error:', error);
        } finally {
            setRefreshing(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            loadData();
        }, [])
    );

    const onRefresh = () => {
        setRefreshing(true);
        loadData();
    };

    return (
        <View className="flex-1 bg-brand-darker">
            <ScrollView
                className="flex-1"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#06b6d4" />}
            >
                {/* Hero Section */}
                <View className="relative h-[280px]">
                    <Image
                        source={{ uri: 'https://images.pokemontcg.io/sv3pt5/logo.png' }} // 151 Logo or similar wallpaper
                        className="absolute inset-0 w-full h-full opacity-30"
                        contentFit="cover"
                    />
                    <LinearGradient
                        colors={['transparent', '#0f172a']}
                        className="absolute inset-0"
                    />

                    <SafeAreaView className="flex-1 px-6 justify-center">
                        <Text className="text-brand-cyan text-xs font-black uppercase tracking-[0.2em] mb-2">Welcome to CardStreet</Text>
                        <Text className="text-4xl font-black text-white leading-tight mb-6">
                            {'Find, verify &\n'}
                            <Text className="text-brand-cyan">Collect Them All</Text>
                        </Text>

                        {/* Search Bar Trigger */}
                        <TouchableOpacity
                            className="bg-white/10 border border-white/20 h-14 rounded-2xl flex-row items-center px-4"
                            onPress={() => navigation.navigate('Explore')}
                        >
                            <Ionicons name="search" size={20} color="#94a3b8" />
                            <Text className="text-slate-400 font-medium ml-3 text-sm">Search cards, sets, or artists...</Text>
                        </TouchableOpacity>
                    </SafeAreaView>
                </View>

                {/* Vault Summary (If Logged In) */}
                {user && (
                    <View className="px-6 -mt-8 mb-8">
                        <LinearGradient
                            colors={['#1e293b', '#0f172a']}
                            className="rounded-3xl p-1 border border-white/10 shadow-xl"
                        >
                            <View className="bg-brand-darker/50 rounded-[22px] p-5">
                                <View className="flex-row justify-between items-start mb-2">
                                    <View>
                                        <Text className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Total Vault Value</Text>
                                        <Text className="text-3xl font-black text-white mt-1">฿{vaultValue.toLocaleString()}</Text>
                                    </View>
                                    <View className="bg-brand-cyan/20 p-2 rounded-xl">
                                        <Ionicons name="wallet-outline" size={20} color="#06b6d4" />
                                    </View>
                                </View>
                                <TouchableOpacity
                                    className="flex-row items-center"
                                    onPress={() => navigation.navigate('Vault')}
                                >
                                    <Text className="text-brand-cyan text-xs font-bold mr-1">View Collection</Text>
                                    <Ionicons name="arrow-forward" size={12} color="#06b6d4" />
                                </TouchableOpacity>
                            </View>
                        </LinearGradient>
                    </View>
                )}

                {/* Marketplace Highlights */}
                <View className="px-6 mb-8">
                    <View className="flex-row justify-between items-center mb-4">
                        <Text className="text-white text-lg font-bold">Trending on Market</Text>
                        <TouchableOpacity onPress={() => navigation.navigate('Shop')}>
                            <Text className="text-brand-cyan text-xs font-bold">See All</Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-6 px-6">
                        {[1, 2, 3].map((item) => (
                            <TouchableOpacity
                                key={item}
                                className="w-40 mr-4 bg-white/5 rounded-2xl p-3 border border-white/5"
                                onPress={() => navigation.navigate('Shop')}
                            >
                                <Image
                                    source={{ uri: `https://images.pokemontcg.io/sv3pt5/${160 + item}_hires.png` }}
                                    className="w-full h-48 rounded-xl mb-3 bg-slate-800"
                                    contentFit="contain"
                                />
                                <Text className="text-white font-bold text-sm truncate" numberOfLines={1}>Charizard ex</Text>
                                <Text className="text-slate-500 text-[10px] font-bold uppercase mb-2">151 • SIR</Text>
                                <Text className="text-brand-cyan font-black">฿3,500</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>

                {/* Latest Sets */}
                <View className="px-6 mb-12">
                    <Text className="text-white text-lg font-bold mb-4">New Arrivals</Text>
                    {sets.map((set) => (
                        <TouchableOpacity
                            key={set.id}
                            className="bg-white/5 rounded-2xl p-4 mb-3 border border-white/5 flex-row items-center active:bg-white/10"
                            onPress={() => navigation.navigate('Explore', { screen: 'Explore', params: { setId: set.id } })}
                        >
                            <Image
                                source={{ uri: set.images.logo }}
                                className="w-20 h-10 mr-4"
                                contentFit="contain"
                            />
                            <View className="flex-1">
                                <Text className="text-white font-bold text-base">{set.name}</Text>
                                <Text className="text-slate-500 text-xs font-medium">Released {new Date(set.releaseDate).toLocaleDateString()}</Text>
                            </View>
                            <View className="bg-white/10 px-2.5 py-1 rounded text-xs">
                                <Text className="text-white font-bold text-xs">{set.total} Cards</Text>
                            </View>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Footer */}
                <View className="px-6 pb-12 items-center">
                    <Ionicons name="logo-snapchat" size={24} color="#334155" />
                    <Text className="text-slate-600 text-[10px] font-black uppercase tracking-[0.3em] mt-2">CardStreet Mobile v1.0</Text>
                </View>
            </ScrollView>
        </View>
    );
}
