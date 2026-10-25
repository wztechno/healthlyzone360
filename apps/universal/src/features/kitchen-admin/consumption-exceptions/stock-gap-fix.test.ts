import type { ConsumptionException } from '@healthy360/api-client/contracts';

import {
    canFixInRecipe,
    readStockGapsView,
    recipeFixHref,
    stockGapsHref,
    stockGapsParams,
} from './stock-gap-fix.ts';

const LENTILS = '0f9a6c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b';

type Gap = Pick<
    ConsumptionException,
    'reasonCode' | 'itemType' | 'catalogueItemId' | 'recipeId' | 'ingredientId'
>;

function gap(overrides: Partial<Gap> = {}): Gap {
    return {
        reasonCode: 'unquantified_recipe_line',
        itemType: 'meal',
        catalogueItemId: 'item-1',
        recipeId: 'recipe-1',
        ingredientId: LENTILS,
        ...overrides,
    };
}

describe('canFixInRecipe', () => {
    it('fixes the four recipe-shaped reasons on a meal', () => {
        for (const reasonCode of [
            'no_recipe_version',
            'no_yield_piece_count',
            'unquantified_recipe_line',
            'unit_conversion_unsupported',
        ] as const) {
            expect(canFixInRecipe(gap({ reasonCode }))).toBe(true);
        }
    });

    it('sends nothing else to a recipe', () => {
        expect(canFixInRecipe(gap({ reasonCode: 'insufficient_stock' }))).toBe(false);
        expect(canFixInRecipe(gap({ reasonCode: 'no_branch' }))).toBe(false);
    });

    it('needs a meal, or an item only known by its id', () => {
        expect(canFixInRecipe(gap({ itemType: 'product' }))).toBe(false);
        expect(canFixInRecipe(gap({ itemType: null }))).toBe(true);
        expect(canFixInRecipe(gap({ catalogueItemId: null }))).toBe(false);
    });

    it('needs the ingredient for a unit mismatch, which the cost stage raises without one', () => {
        expect(
            canFixInRecipe(gap({ reasonCode: 'unit_conversion_unsupported', ingredientId: null })),
        ).toBe(false);
        expect(
            canFixInRecipe(gap({ reasonCode: 'unquantified_recipe_line', ingredientId: null })),
        ).toBe(true);
    });
});

describe('stockGapsHref', () => {
    it('leaves every default out, so the plain list is the plain path', () => {
        expect(stockGapsHref({})).toBe('/kitchen/consumption-exceptions');
        expect(
            stockGapsHref({ status: 'unresolved', from: '', page: 1, gap: null, fixed: false }),
        ).toBe('/kitchen/consumption-exceptions');
    });

    it('carries the status, date, page, open gap and fixed flag', () => {
        expect(
            stockGapsHref({
                status: 'all',
                from: '2026-08-01',
                page: 3,
                gap: 'exception-1',
                fixed: true,
            }),
        ).toBe(
            '/kitchen/consumption-exceptions?status=all&from=2026-08-01&page=3&gap=exception-1&fixed=1',
        );
    });

    it('clears the same defaults when written as params', () => {
        expect(
            stockGapsParams({ status: 'unresolved', from: '', page: 1, gap: null, fixed: false }),
        ).toEqual({
            status: undefined,
            from: undefined,
            page: undefined,
            gap: undefined,
            fixed: undefined,
        });
        expect(
            stockGapsParams({ status: 'resolved', from: '', page: 2, gap: 'g', fixed: true }),
        ).toEqual({ status: 'resolved', from: undefined, page: '2', gap: 'g', fixed: '1' });
    });
});

describe('readStockGapsView', () => {
    it('reads what the URL holds', () => {
        expect(
            readStockGapsView({
                status: 'resolved',
                from: '2026-08-01',
                page: '4',
                gap: 'exception-1',
                fixed: '1',
            }),
        ).toEqual({
            status: 'resolved',
            from: '2026-08-01',
            page: 4,
            gap: 'exception-1',
            fixed: true,
        });
    });

    it('falls back to the defaults for anything it cannot read', () => {
        expect(
            readStockGapsView({ status: 'banana', from: 'yesterday', page: '-2', fixed: 'yes' }),
        ).toEqual({ status: 'unresolved', from: '', page: 1, gap: null, fixed: false });
    });
});

describe('recipeFixHref', () => {
    const back = '/kitchen/consumption-exceptions?page=2&gap=exception-1';
    // Encoded twice, which expo-router's two decodes undo (`return-to.ts`).
    const encodedBack = encodeURIComponent(encodeURIComponent(back));

    it('opens the recipe itself with the fix, the ingredient and the way back', () => {
        expect(recipeFixHref(gap(), back)).toBe(
            `/kitchen/recipes/recipe-1?fix=unquantified_recipe_line&ingredient=${LENTILS}&returnTo=${encodedBack}`,
        );
    });

    it('opens the meal in the recipe book when it has no recipe yet, and names no ingredient it lacks', () => {
        expect(
            recipeFixHref(
                gap({ recipeId: null, reasonCode: 'no_recipe_version', ingredientId: null }),
                back,
            ),
        ).toBe(
            `/kitchen/recipes/item/item-1?kind=meal&fix=no_recipe_version&returnTo=${encodedBack}`,
        );
    });
});
