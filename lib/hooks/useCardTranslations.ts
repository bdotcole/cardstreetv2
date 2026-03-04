import { Rarity, CardCondition } from '@/types';
import { useTranslation } from './useTranslation';

// Helper function to translate rarity enum values
export function useRarityTranslation() {
    const { t } = useTranslation();

    return (rarity: string): string => {
        const rarityMap: Record<string, string> = {
            'C': 'Common',
            'U': 'Uncommon',
            'R': 'Rare',
            'RR': 'Double Rare',
            'RRR': 'Triple Rare',
            'SR': 'Super Rare',
            'AR': 'Art Rare',
            'SAR': 'Special Art Rare',
            'UR': 'Ultra Rare',
            'PB': 'Pokeball Holo',
            'EH': 'Energy Holo',
            'MA': 'MA',
            'MUR': 'MUR',
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
