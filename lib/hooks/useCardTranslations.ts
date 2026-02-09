import { Rarity, CardCondition } from '@/types';
import { useTranslation } from './useTranslation';

// Helper function to translate rarity enum values
export function useRarityTranslation() {
    const { t } = useTranslation();

    return (rarity: Rarity): string => {
        const rarityMap: Record<Rarity, string> = {
            [Rarity.C]: t('card.common'),
            [Rarity.U]: t('card.uncommon'),
            [Rarity.R]: t('card.rare'),
            [Rarity.RR]: t('card.doubleRare'),
            [Rarity.RRR]: 'Triple Rare', // Not in translations yet, keeping English
            [Rarity.SR]: 'Super Rare', // Not in translations yet, keeping English
            [Rarity.SAR]: 'Special Art Rare', // Not in translations yet, keeping English
            [Rarity.UR]: t('card.ultraRare'),
        };

        return rarityMap[rarity] || rarity;
    };
}

// Helper function to translate condition enum values
export function useConditionTranslation() {
    const { t } = useTranslation();

    return (condition: CardCondition | string): string => {
        // Handle both enum values and string abbreviations
        const conditionKey = typeof condition === 'string'
            ? condition.toUpperCase()
            : condition;

        const conditionMap: Record<string, string> = {
            'NM': t('card.nm'),
            'NEAR MINT': t('card.nm'),
            'LP': t('card.lp'),
            'LIGHTLY PLAYED': t('card.lp'),
            'MP': t('card.mp'),
            'MODERATELY PLAYED': t('card.mp'),
            'HP': t('card.hp'),
            'HEAVILY PLAYED': t('card.hp'),
            'DMG': t('card.dmg'),
            'DAMAGED': t('card.dmg'),
        };

        return conditionMap[conditionKey] || condition;
    };
}
