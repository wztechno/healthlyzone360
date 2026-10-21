import { clashingAllergens } from './my-allergens.tsx';
import {
    ALLERGEN_CONFLICT_WARNING,
    SUBSCRIPTION_ALLERGEN_CONFLICT,
    isCriticalWarning,
} from './warnings.ts';

describe('clashingAllergens', () => {
    it('keeps the meal’s allergens the person declared, in the meal’s order', () => {
        expect(clashingAllergens(['mustard', 'eggs', 'milk'], ['milk', 'eggs', 'fish'])).toEqual([
            'eggs',
            'milk',
        ]);
    });

    it('is empty when nothing is declared, nothing crosses, or the meal’s allergens are unknown', () => {
        expect(clashingAllergens(['eggs'], [])).toEqual([]);
        expect(clashingAllergens(['mustard'], ['eggs'])).toEqual([]);
        expect(clashingAllergens(undefined, ['eggs'])).toEqual([]);
    });
});

describe('allergen warnings', () => {
    it('match the codes the repositories produce, and read as alerts', () => {
        expect(ALLERGEN_CONFLICT_WARNING).toBe('checkout.allergen_conflict');
        expect(SUBSCRIPTION_ALLERGEN_CONFLICT).toBe('subscription.allergen_conflict');
        expect(isCriticalWarning(ALLERGEN_CONFLICT_WARNING)).toBe(true);
        expect(isCriticalWarning(SUBSCRIPTION_ALLERGEN_CONFLICT)).toBe(true);
    });
});
