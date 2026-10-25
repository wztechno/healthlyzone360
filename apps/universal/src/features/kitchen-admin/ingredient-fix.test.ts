import type { IngredientAdmin, RecipeCostHalf } from '@healthy360/api-client/contracts';
import { PACKAGING_CATEGORY_CODE } from '@healthy360/api-client/contracts';
import type { IngredientId } from '@healthy360/domain-types';

import { ingredientFixHref, ingredientNeedsById, parseIngredientNeeds } from './ingredient-fix.ts';

const id = (value: string) => value as IngredientId;

function ingredient(
    overrides: Partial<IngredientAdmin> & { readonly id: IngredientId },
): IngredientAdmin {
    return {
        categoryCode: 'dairy',
        allergens: [{ allergenCode: 'milk', containment: 'contains' }],
        allergensAssessedClear: false,
        pendingNutrition: null,
        meta: { status: 'published' },
        ...overrides,
    } as unknown as IngredientAdmin;
}

describe('parseIngredientNeeds', () => {
    it('keeps known needs in the form’s order and drops the rest', () => {
        expect(parseIngredientNeeds('price,bogus,allergens,price')).toEqual(['allergens', 'price']);
        expect(parseIngredientNeeds(['unit'])).toEqual(['unit']);
        expect(parseIngredientNeeds(undefined)).toEqual([]);
    });
});

describe('ingredientFixHref', () => {
    it('opens the family’s editor with what to fix and the way back', () => {
        const href = ingredientFixHref(
            'i-1',
            ['allergens', 'price'],
            '/kitchen/recipes/r-1?tab=production',
            'ingredients',
        );
        const url = new URL(href, 'https://example.test');
        expect(url.pathname).toBe('/kitchen/ingredients/i-1');
        expect(url.searchParams.get('needs')).toBe('allergens,price');
        // Carried encoded, as every `returnTo` is; `useReturnTo` reads it back.
        expect(decodeURIComponent(url.searchParams.get('returnTo') ?? '')).toBe(
            '/kitchen/recipes/r-1?tab=production',
        );
    });
});

describe('ingredientNeedsById', () => {
    it('reads warnings, uncosted lines and the rows themselves, for named ingredients only', () => {
        const costs = {
            uncostedLineNumbers: [2],
            lines: [
                { lineNumber: 1, ingredientId: id('i-1') },
                { lineNumber: 2, ingredientId: id('i-2') },
            ],
        } as unknown as RecipeCostHalf;

        const needs = ingredientNeedsById({
            warnings: [
                { code: 'rollup.unconvertible_unit', message: '', ingredientIds: [id('i-1')] },
                { code: 'rollup.missing_nutrition', message: '', ingredientIds: [id('i-9')] },
            ],
            costs: [costs, null],
            ingredients: [
                ingredient({ id: id('i-1'), allergens: [], pendingNutrition: {} as never }),
                ingredient({ id: id('i-2') }),
                // A box owes no allergens, whatever its mapping says.
                ingredient({ id: id('p-1'), allergens: [], categoryCode: PACKAGING_CATEGORY_CODE }),
            ],
            named: new Set(['i-1', 'i-2', 'p-1']),
        });

        expect(needs.get('i-1')).toEqual(['allergens', 'nutrition', 'unit']);
        expect(needs.get('i-2')).toEqual(['price']);
        expect(needs.has('p-1')).toBe(false);
        // Not on the recipe, so not asked about.
        expect(needs.has('i-9')).toBe(false);
    });

    it('counts an ingredient assessed clear as checked', () => {
        const needs = ingredientNeedsById({
            warnings: [],
            costs: [],
            ingredients: [
                ingredient({ id: id('i-1'), allergens: [], allergensAssessedClear: true }),
            ],
            named: new Set(['i-1']),
        });
        expect(needs.has('i-1')).toBe(false);
    });
});
