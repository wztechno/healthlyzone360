import type { IngredientAdmin } from '@healthy360/api-client/contracts';
import { AllergenCode, IngredientId } from '@healthy360/domain-types';
import type { IsoDateTime, OrganisationId } from '@healthy360/domain-types';
import type { NutritionFacts } from '@healthy360/nutrition';

/** Two ingredients the record showcases draw: an empty one and a full one. Literal copy. */

const NOW = '2026-11-01T09:00:00.000Z' as IsoDateTime;
const ORGANISATION = 'showcase-org' as OrganisationId;

function per100g(
    amounts: readonly (readonly [string, 'kcal' | 'g' | 'mg', number])[],
): NutritionFacts {
    return {
        basis: 'per_100g',
        kind: 'planned',
        serving: null,
        totalGrams: 100,
        amounts: amounts.map(([nutrientId, unit, value]) => ({
            nutrientId,
            unit,
            value,
            kind: 'planned',
            tolerance: null,
        })),
        source: {
            kind: 'synthetic_prototype',
            label: 'Showcase',
            version: '1',
            calculatedAt: NOW,
        },
        calculation: {
            method: 'showcase',
            basis: 'per_100g',
            calculatedAt: NOW,
            prototype: true,
            rounding: 'none',
            notes: [],
        },
    } as unknown as NutritionFacts;
}

export const BLANK: IngredientAdmin = {
    id: IngredientId.unsafe('01935f6d-0000-7000-8000-0000000a0101'),
    meta: { lockVersion: 1, status: 'draft', updatedAt: NOW, updatedByName: 'Omar H.' },
    name: { en: 'Date syrup', ar: '' },
    slug: 'ingredient-date-syrup',
    reference: 'IG-231',
    categoryCode: '',
    subcategoryCode: null,
    measurementUnit: 'l',
    purchaseUnit: null,
    composition: null,
    itemsPerUnit: null,
    gramsPerUnit: null,
    purchasePrice: null,
    wastePercent: null,
    capacity: null,
    costPer100g: null,
    b2bPrice: null,
    b2cPrice: null,
    unitPrice: null,
    isSellable: false,
    per100g: null,
    nutritionDerivedFromVersionId: null,
    nutritionEstimated: null,
    nutritionNote: null,
    allergens: [],
    dietClassifications: [],
    aliases: [],
    organisationId: ORGANISATION,
    isEditable: true,
    forkedFromId: null,
    notes: null,
} as unknown as IngredientAdmin;

export const TAHINI: IngredientAdmin = {
    ...BLANK,
    id: IngredientId.unsafe('01935f6d-0000-7000-8000-0000000a0102'),
    meta: { lockVersion: 7, status: 'published', updatedAt: NOW, updatedByName: 'Sara K.' },
    name: { en: 'Tahini paste', ar: 'طحينة' },
    slug: 'ingredient-tahini',
    reference: 'IG-014',
    categoryCode: 'pantry',
    subcategoryCode: 'spreads',
    measurementUnit: 'kg',
    composition: 'Ground roasted sesame seeds',
    costPer100g: { amount: 1.8, currency: 'AED' },
    unitPrice: { amount: 18.4, currency: 'AED' },
    b2bPrice: { amount: 24, currency: 'AED' },
    b2cPrice: { amount: 29.5, currency: 'AED' },
    per100g: per100g([
        ['energy', 'kcal', 595],
        ['protein', 'g', 17],
        ['fat', 'g', 53.8],
        ['saturated_fat', 'g', 7.5],
        ['carbohydrate', 'g', 21.2],
        ['sugars', 'g', 0.5],
        ['sodium', 'mg', 115],
    ]),
    nutritionEstimated: true,
    nutritionNote: 'Supplier label, March 2026 batch',
    allergens: [
        { allergenCode: AllergenCode.unsafe('sesame'), containment: 'contains' },
        { allergenCode: AllergenCode.unsafe('peanut'), containment: 'may_contain' },
    ],
    dietClassifications: ['vegan', 'gluten_free', 'halal_friendly'],
    aliases: ['Tahina', 'Sesame paste'],
    notes: 'Stir before weighing — the oil separates.',
} as unknown as IngredientAdmin;

const CATEGORY_NAMES: Readonly<Record<string, string>> = {
    pantry: 'Pantry',
    spreads: 'Spreads & pastes',
};

export function categoryName(code: string): string {
    return CATEGORY_NAMES[code] ?? code;
}
