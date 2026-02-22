import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

// Mock Data for Marketplace
const MOCK_LISTINGS = [
    {
        id: '1',
        cardName: 'Charizard ex',
        set: '151',
        rarity: 'SIR',
        price: 3500,
        currency: 'THB',
        image: 'https://images.pokemontcg.io/sv3pt5/199_hires.png',
        seller: {
            name: 'PokeMaster99',
            rating: 4.8,
            avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=PokeMaster'
        },
        condition: 'NM'
    },
    {
        id: '2',
        cardName: 'Iono',
        set: 'Paldea Evolved',
        rarity: 'SIR',
        price: 2800,
        currency: 'THB',
        image: 'https://images.pokemontcg.io/sv2/269_hires.png',
        seller: {
            name: 'CardCollectorTH',
            rating: 5.0,
            avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=CardCollector'
        },
        condition: 'Mint'
    },
    {
        id: '3',
        cardName: 'Giratina V',
        set: 'Lost Origin',
        rarity: 'Alt Art',
        price: 12500,
        currency: 'THB',
        image: 'https://images.pokemontcg.io/swsh11/186_hires.png',
        seller: {
            name: 'RareFinds',
            rating: 4.9,
            avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=RareFinds'
        },
        condition: 'NM'
    },
    {
        id: '4',
        cardName: 'Moonbreon (Umbreon VMAX)',
        set: 'Evolving Skies',
        rarity: 'Alt Art',
        price: 28000,
        currency: 'THB',
        image: 'https://images.pokemontcg.io/swsh7/215_hires.png',
        seller: {
            name: 'EliteCards',
            rating: 5.0,
            avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Elite'
        },
        condition: 'Gem Mint'
    }
];

export default function MarketplaceScreen() {
    const navigation = useNavigation<any>();
    const [searchTerm, setSearchTerm] = useState('');

    const renderListing = ({ item }: { item: any }) => (
        <TouchableOpacity
            className="flex-row bg-white/5 mb-3 rounded-2xl p-3 border border-white/5 active:bg-white/10"
            onPress={() => console.log('Open Listing', item.id)}
        >
            {/* Card Image */}
            <Image
                source={{ uri: item.image }}
                className="w-24 h-32 rounded-lg"
                contentFit="contain"
            />

            {/* Details */}
            <View className="flex-1 ml-4 justify-between py-1">
                <View>
                    <View className="flex-row justify-between items-start">
                        <View className="flex-1 mr-2">
                            <Text className="text-white font-bold text-lg leading-tight" numberOfLines={1}>{item.cardName}</Text>
                            <Text className="text-slate-400 text-xs font-medium mt-0.5">{item.set} • {item.rarity}</Text>
                        </View>
                        {/* Condition Badge */}
                        <View className="bg-brand-cyan/20 px-2 py-1 rounded-md border border-brand-cyan/30">
                            <Text className="text-brand-cyan text-[10px] font-bold">{item.condition}</Text>
                        </View>
                    </View>
                </View>

                <View>
                    {/* Seller Info */}
                    <View className="flex-row items-center mb-2">
                        <Image source={{ uri: item.seller.avatar }} className="w-5 h-5 rounded-full bg-slate-700" />
                        <Text className="text-slate-400 text-xs ml-1.5 font-medium">{item.seller.name}</Text>
                        <View className="flex-row items-center ml-2 bg-yellow-500/10 px-1 rounded border border-yellow-500/20">
                            <Ionicons name="star" size={10} color="#eab308" />
                            <Text className="text-yellow-500 text-[10px] font-bold ml-0.5">{item.seller.rating}</Text>
                        </View>
                    </View>

                    {/* Price & Buy */}
                    <View className="flex-row items-center justify-between">
                        <Text className="text-emerald-400 text-xl font-black">฿{item.price.toLocaleString()}</Text>
                        <TouchableOpacity className="bg-brand-cyan px-4 py-2 rounded-lg items-center justify-center">
                            <Text className="text-brand-darker font-black text-xs">BUY</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </TouchableOpacity>
    );

    return (
        <SafeAreaView className="flex-1 bg-brand-darker" edges={['top']}>
            {/* Header */}
            <View className="px-4 py-4">
                <Text className="text-3xl font-black text-white mb-4 tracking-tight">Marketplace</Text>

                {/* Search Bar */}
                <View className="flex-row items-center bg-[#1e293b] rounded-xl border border-white/10 px-3 h-12 mb-2">
                    <Ionicons name="search" size={20} color="#94a3b8" />
                    <TextInput
                        className="flex-1 text-white text-base font-medium ml-2 h-full"
                        placeholder="Search for cards, sets..."
                        placeholderTextColor="#64748b"
                        value={searchTerm}
                        onChangeText={setSearchTerm}
                    />
                </View>

                {/* Filter Tags */}
                <View className="flex-row gap-2 mt-2">
                    <TouchableOpacity className="bg-brand-cyan px-3 py-1.5 rounded-full">
                        <Text className="text-brand-darker font-bold text-xs">All</Text>
                    </TouchableOpacity>
                    <TouchableOpacity className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
                        <Text className="text-slate-400 font-bold text-xs">Newest</Text>
                    </TouchableOpacity>
                    <TouchableOpacity className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
                        <Text className="text-slate-400 font-bold text-xs">Deals</Text>
                    </TouchableOpacity>
                    <TouchableOpacity className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
                        <Text className="text-slate-400 font-bold text-xs">Auctions</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Listings Feed */}
            <FlatList
                data={MOCK_LISTINGS}
                renderItem={renderListing}
                keyExtractor={item => item.id}
                contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
                showsVerticalScrollIndicator={false}
            />
        </SafeAreaView>
    );
}
