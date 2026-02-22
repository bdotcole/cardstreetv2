import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/lib/supabase/client';
import { collectionService, CollectionItem } from '@/services/collectionService';
import { LinearGradient } from 'expo-linear-gradient';

export default function VaultScreen() {
    const navigation = useNavigation<any>();
    const [user, setUser] = useState<any>(null);
    const [collection, setCollection] = useState<CollectionItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [totalValue, setTotalValue] = useState(0);

    // Check Auth and Fetch Data
    const loadData = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            setUser(user);

            if (user) {
                const items = await collectionService.getUserCollection(user.id);
                setCollection(items);

                // Calculate total value
                const total = items.reduce((sum, item) => {
                    return sum + (item.card?.marketPrice || 0) * item.quantity;
                }, 0);
                setTotalValue(total);
            } else {
                setCollection([]);
                setTotalValue(0);
            }
        } catch (error) {
            console.error('Vault load error:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            loadData();
        }, [])
    );

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        loadData();
    }, []);

    const renderItem = ({ item }: { item: CollectionItem }) => {
        const card = item.card;
        if (!card) return null;

        return (
            <TouchableOpacity
                className="flex-1 m-1 bg-white/5 rounded-xl overflow-hidden border border-white/5 active:opacity-70"
                onPress={() => navigation.navigate('CardDetails', { card })}
            >
                <View className="aspect-[2/3] relative">
                    <Image
                        source={{ uri: card.imageUrl }}
                        className="w-full h-full"
                        contentFit="cover"
                    />
                    {/* Quantity Badge */}
                    {item.quantity > 1 && (
                        <View className="absolute top-1 right-1 bg-brand-cyan px-1.5 py-0.5 rounded shadow-sm">
                            <Text className="text-brand-darker text-[10px] font-black">x{item.quantity}</Text>
                        </View>
                    )}
                </View>
                <View className="p-2">
                    <Text className="text-white text-[10px] font-bold truncate" numberOfLines={1}>{card.name}</Text>
                    <Text className="text-brand-cyan text-[10px] font-black mt-0.5">฿{(card.marketPrice ?? 0).toLocaleString()}</Text>
                </View>
            </TouchableOpacity>
        );
    };

    if (loading && !refreshing) {
        return (
            <View className="flex-1 bg-brand-darker items-center justify-center">
                <ActivityIndicator size="large" color="#06b6d4" />
            </View>
        );
    }

    if (!user) {
        return (
            <SafeAreaView className="flex-1 bg-brand-darker items-center justify-center p-6">
                <View className="w-20 h-20 bg-white/5 rounded-full items-center justify-center mb-6 border border-white/10">
                    <Ionicons name="lock-closed" size={40} color="#64748b" />
                </View>
                <Text className="text-white text-2xl font-black mb-2 text-center">Your Vault is Locked</Text>
                <Text className="text-slate-400 text-center mb-8 leading-6">
                    Log in to view your collection, track portfolio value, and manage your assets.
                </Text>

                <TouchableOpacity
                    className="w-full h-14 bg-brand-cyan rounded-xl items-center justify-center shadow-lg shadow-brand-cyan/20"
                    onPress={() => navigation.navigate('Profile')}
                >
                    <Text className="text-brand-darker font-black text-sm tracking-widest uppercase">Login / Sign Up</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView className="flex-1 bg-brand-darker" edges={['top']}>
            <View className="flex-1">
                {/* Header */}
                <View className="px-6 py-6">
                    <Text className="text-brand-cyan text-xs font-black uppercase tracking-[0.2em] mb-1">My Portfolio</Text>
                    <Text className="text-5xl font-black text-white tracking-tighter italic">
                        ฿{totalValue.toLocaleString()}
                    </Text>
                    <View className="flex-row items-center mt-2">
                        <View className="bg-emerald-500/20 px-2 py-1 rounded border border-emerald-500/30 flex-row items-center">
                            <Ionicons name="trending-up" size={12} color="#10b981" />
                            <Text className="text-emerald-500 text-[10px] font-bold ml-1">+12.5% (This Week)</Text>
                        </View>
                        <Text className="text-slate-500 text-[10px] font-bold ml-3 uppercase tracking-wider">{collection.length} ITEMS</Text>
                    </View>
                </View>

                {/* Collection Grid */}
                <View className="flex-1 bg-brand-darker px-4">
                    <View className="flex-row items-center justify-between mb-4">
                        <Text className="text-white text-lg font-bold">Collection</Text>
                        <TouchableOpacity className="bg-white/5 p-2 rounded-lg">
                            <Ionicons name="filter" size={16} color="#94a3b8" />
                        </TouchableOpacity>
                    </View>

                    <FlatList
                        data={collection}
                        renderItem={renderItem}
                        keyExtractor={item => item.id}
                        numColumns={3}
                        contentContainerStyle={{ paddingBottom: 100 }}
                        refreshControl={
                            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#06b6d4" />
                        }
                        ListEmptyComponent={
                            <View className="items-center justify-center py-20 border-2 border-dashed border-white/5 rounded-2xl mt-4">
                                <Ionicons name="albums-outline" size={40} color="#334155" />
                                <Text className="text-slate-500 font-bold mt-4">No cards in vault</Text>
                                <TouchableOpacity
                                    className="mt-4 bg-white/5 px-4 py-2 rounded-lg"
                                    onPress={() => navigation.navigate('Explore')}
                                >
                                    <Text className="text-brand-cyan font-bold text-xs">Browse Cards</Text>
                                </TouchableOpacity>
                            </View>
                        }
                    />
                </View>
            </View>
        </SafeAreaView>
    );
}
