import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TextInput, FlatList, ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { pokemonService, ApiSet, Card } from '@/services/pokemonService';
import { CardGridItem } from '@/components/CardGridItem';
import { useNavigation } from '@react-navigation/native';

export default function ExploreScreen() {
    const navigation = useNavigation<any>();
    const [sets, setSets] = useState<ApiSet[]>([]);
    const [selectedSetId, setSelectedSetId] = useState<string>('');
    const [cards, setCards] = useState<Card[]>([]);
    const [isLoadingSets, setIsLoadingSets] = useState(true);
    const [isLoadingCards, setIsLoadingCards] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedTerm, setDebouncedTerm] = useState('');
    const [sortOption, setSortOption] = useState<'number' | 'priceHigh' | 'priceLow'>('number');

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedTerm(searchTerm), 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Fetch Sets
    useEffect(() => {
        loadSets();
    }, []);

    const loadSets = async () => {
        setIsLoadingSets(true);
        const result = await pokemonService.fetchSets('en');
        setSets(result.data);
        if (result.data.length > 0) {
            setSelectedSetId(result.data[0].id);
        }
        setIsLoadingSets(false);
        // Set logos are tiny — prefetch them all so the horizontal picker is instant
        const logoUrls = result.data.map(s => s.images?.logo).filter(Boolean) as string[];
        if (logoUrls.length > 0) Image.prefetch(logoUrls);
    };

    // Fetch Cards
    useEffect(() => {
        if (!selectedSetId && debouncedTerm.length < 3) return;

        if (debouncedTerm.length >= 3) {
            performSearch();
        } else if (selectedSetId) {
            loadCards();
        }
    }, [selectedSetId, debouncedTerm]);

    const loadCards = async () => {
        setIsLoadingCards(true);
        const results = await pokemonService.fetchCardsBySet(selectedSetId);
        setCards(results);
        setIsLoadingCards(false);
        // Warm the disk cache for the first screen of cards so scrolling feels instant
        const urls = results.slice(0, 30).map(c => c.images?.small || c.imageUrl).filter(Boolean);
        if (urls.length > 0) Image.prefetch(urls);
    };

    const performSearch = async () => {
        setIsLoadingCards(true);
        const results = await pokemonService.searchCards(debouncedTerm);
        setCards(results);
        setIsLoadingCards(false);
    };

    // Sort Logic
    const sortedCards = useMemo(() => {
        const sorted = [...cards];
        const getCardNum = (c: Card) => {
            const numPart = c.number.split('/')[0];
            return parseInt(numPart.replace(/[^0-9]/g, '')) || 999999;
        };

        switch (sortOption) {
            case 'priceHigh':
                return sorted.sort((a, b) => (b.marketPrice || 0) - (a.marketPrice || 0));
            case 'priceLow':
                return sorted.sort((a, b) => {
                    const priceA = a.marketPrice || Infinity;
                    const priceB = b.marketPrice || Infinity;
                    if (priceA === Infinity && priceB === Infinity) return 0;
                    if (priceA === Infinity) return 1;
                    if (priceB === Infinity) return -1;
                    return priceA - priceB;
                });
            case 'number':
            default:
                return sorted.sort((a, b) => getCardNum(a) - getCardNum(b));
        }
    }, [cards, sortOption]);

    const toggleSort = () => {
        setSortOption(prev => {
            if (prev === 'number') return 'priceHigh';
            if (prev === 'priceHigh') return 'priceLow';
            return 'number';
        });
    };

    const renderSetItem = ({ item }: { item: ApiSet }) => (
        <Pressable
            onPress={() => {
                setSearchTerm(''); // Clear search when selecting set
                setSelectedSetId(item.id);
            }}
            className={`mr-3 items-center justify-center p-1 rounded-xl border ${selectedSetId === item.id ? 'bg-white/10 border-brand-cyan' : 'border-transparent opacity-50'}`}
        >
            <View className="w-10 h-10">
                {item.images.logo ? (
                    <Image source={{ uri: item.images.logo }} className="w-full h-full" contentFit="contain" cachePolicy="memory-disk" />
                ) : (
                    <View className="w-full h-full bg-slate-700 rounded-full" />
                )}
            </View>
            <Text className={`text-[8px] font-bold mt-1 ${selectedSetId === item.id ? 'text-brand-cyan' : 'text-slate-500'}`}>
                {item.id}
            </Text>
        </Pressable>
    );

    return (
        <SafeAreaView className="flex-1 bg-brand-darker" edges={['top']}>
            <View className="flex-1">
                {/* Header Section */}
                <View className="px-4 pt-2 pb-4 space-y-4 bg-brand-darker z-10">
                    {/* Search Bar */}
                    <View className="flex-row items-center bg-[#1e293b] rounded-xl border border-white/10 px-3 h-12">
                        {/* Icon placeholder (using text for now if icons missing) */}
                        <Text className="text-slate-400 mr-2">🔍</Text>
                        <TextInput
                            className="flex-1 text-white text-base font-medium h-full"
                            placeholder="Search cards..."
                            placeholderTextColor="#64748b"
                            value={searchTerm}
                            onChangeText={setSearchTerm}
                        />
                        {searchTerm.length > 0 && (
                            <Pressable onPress={() => setSearchTerm('')}>
                                <Text className="text-slate-400 font-bold">✕</Text>
                            </Pressable>
                        )}
                    </View>

                    {/* Set Selector (Hide if searching) */}
                    {debouncedTerm.length < 3 && (
                        <View>
                            <FlatList
                                data={sets}
                                renderItem={renderSetItem}
                                keyExtractor={item => item.id}
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                className="max-h-16"
                            />
                        </View>
                    )}

                    {/* Sort & Stats Bar */}
                    <View className="flex-row justify-between items-center bg-white/5 p-2 rounded-lg border border-white/5">
                        <Text className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                            {debouncedTerm.length > 2 ? 'Search Results' : selectedSetId.toUpperCase()}
                        </Text>

                        <Pressable onPress={toggleSort} className="flex-row items-center gap-1 active:opacity-50">
                            <Text className={`text-xs font-bold uppercase tracking-wider ${sortOption !== 'number' ? 'text-brand-cyan' : 'text-slate-500'}`}>
                                Price {sortOption === 'priceHigh' ? '↓' : sortOption === 'priceLow' ? '↑' : '-'}
                            </Text>
                        </Pressable>
                    </View>
                </View>

                {/* Content Area */}
                {isLoadingCards ? (
                    <View className="flex-1 items-center justify-center">
                        <ActivityIndicator size="large" color="#00f3ff" />
                    </View>
                ) : (
                    <FlatList
                        data={sortedCards}
                        renderItem={({ item }) => (
                            <CardGridItem
                                card={item}
                                onPress={(card) => navigation.navigate('CardDetails', { card })}
                            />
                        )}
                        keyExtractor={item => item.id}
                        numColumns={2}
                        contentContainerStyle={{ padding: 8, paddingBottom: 100 }}
                        columnWrapperStyle={{ justifyContent: 'space-between' }}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={
                            <View className="items-center justify-center py-20">
                                <Text className="text-slate-500 font-bold">No cards found</Text>
                            </View>
                        }
                    />
                )}
            </View>
        </SafeAreaView>
    );
}
