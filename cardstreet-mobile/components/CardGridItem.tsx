import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Card } from '@/services/pokemonService';

interface CardGridItemProps {
    card: Card;
    onPress: (card: Card) => void;
    currencySymbol?: string;
    exchangeRate?: number;
}

export const CardGridItem: React.FC<CardGridItemProps> = ({
    card,
    onPress,
    currencySymbol = '฿',
    exchangeRate = 1
}) => {
    const price = card.marketPrice ? Math.round(card.marketPrice * exchangeRate) : 0;

    return (
        <Pressable
            onPress={() => onPress(card)}
            className="flex-1 m-1 bg-white/5 rounded-xl overflow-hidden border border-white/10 active:opacity-70"
        >
            <View className="aspect-[2.5/3.5] bg-brand-darker relative">
                <Image
                    source={{ uri: card.images?.small || card.imageUrl }}
                    className="w-full h-full"
                    contentFit="contain"
                    transition={200}
                    cachePolicy="memory-disk"
                    recyclingKey={card.id}
                />
                {/* Price Tag Overlay */}
                <View className="absolute bottom-0 right-0 bg-brand-darker/90 px-2 py-1 rounded-tl-lg border-t border-l border-white/10">
                    <Text className="text-white font-bold text-xs">
                        {price > 0 ? `${currencySymbol}${price}` : 'N/A'}
                    </Text>
                </View>
            </View>

            <View className="p-2 space-y-1">
                <Text className="text-white text-xs font-bold truncate" numberOfLines={1}>
                    {card.name}
                </Text>
                <View className="flex-row items-center gap-1">
                    <View className="bg-white/10 px-1.5 py-0.5 rounded">
                        <Text className="text-[8px] text-slate-400 font-bold uppercase">
                            {card.rarity || 'Common'}
                        </Text>
                    </View>
                    <Text className="text-[8px] text-slate-600 font-bold">
                        #{card.number}
                    </Text>
                </View>
            </View>
        </Pressable>
    );
};
