
import { CardCondition } from '@/types';

interface PriceParams {
    basePrice: number;
    condition: CardCondition;
    isGraded: boolean;
    gradingCompany?: string;
    grade?: number | string;
}

export const calculateRecommendedPrice = ({
    basePrice,
    condition,
    isGraded,
    gradingCompany = 'PSA',
    grade = '10'
}: PriceParams): number => {
    if (!basePrice || basePrice <= 0) return 0;

    let multiplier = 1.0;

    // Raw Condition Logic
    if (!isGraded) {
        switch (condition) {
            case CardCondition.NM: multiplier = 1.0; break;
            case CardCondition.LP: multiplier = 0.85; break;
            case CardCondition.MP: multiplier = 0.70; break;
            case CardCondition.HP: multiplier = 0.50; break;
            case CardCondition.DMG: multiplier = 0.30; break;
            default: multiplier = 1.0;
        }
        return Math.round(basePrice * multiplier);
    }

    // Graded Logic
    // Convert grade to number safely
    const numericGrade = parseFloat(grade.toString());

    if (isNaN(numericGrade)) return basePrice;

    // Base Grade Multipliers (General Market Trends)
    // PSA 10 is usually a significant premium. 9 is often close to raw NM.
    if (numericGrade === 10) multiplier = 3.0; // "Gem Mint" premium
    else if (numericGrade >= 9.5) multiplier = 2.0;
    else if (numericGrade === 9) multiplier = 1.1; // "Mint"
    else if (numericGrade === 8) multiplier = 0.85; // "NM-MT" - often raw is preferred
    else if (numericGrade === 7) multiplier = 0.70;
    else if (numericGrade <= 6) multiplier = 0.50;

    // Company Adjustments
    if (gradingCompany === 'BGS') {
        // Beckett 10 (Black/Gold label) is harder than PSA 10
        if (numericGrade === 10) multiplier *= 1.5; // BGS 10 > PSA 10
        if (numericGrade === 9.5) multiplier = 1.3; // BGS 9.5 > PSA 9
    } else if (gradingCompany === 'CGC') {
        // CGC Pristine 10 is valuable, usually similar to PSA.
        // Old CGC 9.5 was ~= PSA 10, new scale matches PSA more.
        // Treating similar to PSA for MVP safety.
    }

    return Math.round(basePrice * multiplier);
};
