import type { ConsumptionException } from '@healthy360/api-client/contracts';

import {
    canFixInRecipe,
    readStockGapsView,
    recipeFixHref,
    stockGapFixAction,
    stockGapsHref,
    stockGapsParams,
} from './stock-gap-fix.ts';

const LENTILS = '0f9a6c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b';

type Gap = Pick<
    ConsumptionException,
    | 'reasonCode'
    | 'itemType'
    | 'catalogueItemId'
    | 'recipeId'
    | 'ingredientId'
    | 'ingredientNameEn'
    | 'itemNameEn'
>;

function gap(overrides: Partial<Gap> = {}): Gap {
    return {
        reasonCode: 'unquantified_recipe_line',
        itemType: 'meal',
        catalogueItemId: 'item-1',
        recipeId: 'recipe-1',
        ingredientId: LENTILS,
        ingredientNameEn: 'Red lentils',
        itemNameEn: 'Lentil Soup',
        ...overrides,
    };
}

/** A sauce sold as its own ingredient: the gap names the row the import wrote beside it. */
function sauceGap(overrides: Partial<Gap> = {}): Gap {
    return gap({
        itemType: 'sauce',
        recipeId: 'recipe-bbq',
        ingredientNameEn: 'Barbecue Dip',
        itemNameEn: 'Barbecue Dip',
        ...overrides,
    });
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
            stockGapsHref({
                status: 'unresolved',
                from: '',
                to: '',
                page: 1,
                gap: null,
                fixed: false,
            }),
        ).toBe('/kitchen/consumption-exceptions');
    });

    it('carries the status, both dates, page, open gap and fixed flag', () => {
        expect(
            stockGapsHref({
                status: 'all',
                from: '2026-08-01',
                to: '2026-08-31',
                page: 3,
                gap: 'exception-1',
                fixed: true,
            }),
        ).toBe(
            '/kitchen/consumption-exceptions?status=all&from=2026-08-01&to=2026-08-31&page=3&gap=exception-1&fixed=1',
        );
    });

    it('clears the same defaults when written as params', () => {
        expect(
            stockGapsParams({
                status: 'unresolved',
                from: '',
                to: '',
                page: 1,
                gap: null,
                fixed: false,
            }),
        ).toEqual({
            status: undefined,
            from: undefined,
            to: undefined,
            page: undefined,
            gap: undefined,
            fixed: undefined,
        });
        expect(
            stockGapsParams({
                status: 'resolved',
                from: '',
                to: '2026-08-31',
                page: 2,
                gap: 'g',
                fixed: true,
            }),
        ).toEqual({
            status: 'resolved',
            from: undefined,
            to: '2026-08-31',
            page: '2',
            gap: 'g',
            fixed: '1',
        });
    });
});

describe('readStockGapsView', () => {
    it('reads what the URL holds', () => {
        expect(
            readStockGapsView({
                status: 'resolved',
                from: '2026-08-01',
                to: '2026-08-31',
                page: '4',
                gap: 'exception-1',
                fixed: '1',
            }),
        ).toEqual({
            status: 'resolved',
            from: '2026-08-01',
            to: '2026-08-31',
            page: 4,
            gap: 'exception-1',
            fixed: true,
        });
    });

    it('falls back to the defaults for anything it cannot read', () => {
        expect(
            readStockGapsView({
                status: 'banana',
                from: 'yesterday',
                to: 'tomorrow',
                page: '-2',
                fixed: 'yes',
            }),
        ).toEqual({ status: 'unresolved', from: '', to: '', page: 1, gap: null, fixed: false });
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

describe('stockGapFixAction', () => {
    const back = '/kitchen/consumption-exceptions?gap=g1';
    const anyone = () => true;
    const fixOf = (overrides: Partial<Gap>) => stockGapFixAction(gap(overrides), back, anyone);

    it('sends each reason to the page that fixes it', () => {
        expect(fixOf({})?.kind).toBe('recipe');
        expect(fixOf({ reasonCode: 'insufficient_stock' })?.kind).toBe('stock');
        expect(fixOf({ reasonCode: 'no_stock_item' })?.kind).toBe('stock');
        expect(fixOf({ reasonCode: 'no_ingredient_cost' })?.href).toMatch(
            new RegExp(`^/kitchen/ingredients/${LENTILS}\\?needs=price&returnTo=`),
        );
        expect(fixOf({ reasonCode: 'no_stock_unit' })?.href).toMatch(/needs=unit/);
        expect(fixOf({ reasonCode: 'no_net_content', itemType: 'product' })?.href).toMatch(
            /^\/kitchen\/products\/item-1\?returnTo=/,
        );
        expect(fixOf({ reasonCode: 'reserved_for_production' })?.href).toBe('/kitchen/production');
    });

    it('offers nothing where nothing fixes the gap', () => {
        expect(fixOf({ reasonCode: 'no_branch' })).toBeNull();
        expect(fixOf({ reasonCode: 'no_catalogue_item' })).toBeNull();
        expect(
            fixOf({ reasonCode: 'no_ingredient_cost', itemType: 'product', ingredientId: null }),
        ).toBeNull();
    });

    it('fixes a sauce’s own cost, size and unit in its recipe, never on the row beside it', () => {
        const sauceFix = (overrides: Partial<Gap>) =>
            stockGapFixAction(sauceGap(overrides), back, anyone);

        const cost = sauceFix({ reasonCode: 'no_ingredient_cost' });
        expect(cost?.kind).toBe('recipe');
        expect(cost?.labelKey).toBe('kitchen:ops.exceptions.fixInRecipe');
        expect(cost?.href).toMatch(/^\/kitchen\/recipes\/recipe-bbq\?tab=costing&returnTo=/);
        expect(sauceFix({ reasonCode: 'no_net_content' })?.href).toMatch(
            /^\/kitchen\/recipes\/recipe-bbq\?tab=selling&returnTo=/,
        );
        expect(sauceFix({ reasonCode: 'no_stock_unit' })?.href).toMatch(/tab=selling/);
        // Its shelf is still a shelf: stock is added by posting a receipt to it.
        expect(sauceFix({ reasonCode: 'insufficient_stock' })?.kind).toBe('stock');
    });

    it('still opens a real raw material’s own form', () => {
        // The vinegar in a marinade is an ingredient of the library, priced on its own form.
        expect(
            fixOf({
                reasonCode: 'no_ingredient_cost',
                itemNameEn: 'Chicken Red Tawouk',
                ingredientNameEn: 'Vinegar',
            })?.kind,
        ).toBe('ingredient');
    });

    it('sends a frozen meal to its recipe, started from the item when it has none', () => {
        expect(
            fixOf({
                reasonCode: 'no_recipe_version',
                itemType: 'frozen_meal',
                recipeId: null,
                ingredientId: null,
            })?.href,
        ).toMatch(/^\/kitchen\/recipes\/item\/item-1\?kind=frozen_meal&fix=no_recipe_version&/);
        expect(
            fixOf({ reasonCode: 'no_net_content', itemType: 'frozen_meal', recipeId: null })?.href,
        ).toMatch(/^\/kitchen\/recipes\/item\/item-1\?kind=frozen_meal&tab=selling&/);
    });

    it('adds stock by posting a receipt, on the short shelf, and comes back', () => {
        expect(fixOf({ reasonCode: 'insufficient_stock' })?.href).toMatch(
            new RegExp(`^/kitchen/procurement/new\\?ingredient=${LENTILS}&returnTo=`),
        );
        expect(fixOf({ reasonCode: 'insufficient_stock', ingredientId: null })?.href).toMatch(
            /^\/kitchen\/procurement\/new\?item=item-1&returnTo=/,
        );
    });

    it('offers a fix only to a reader who may open its page', () => {
        expect(
            stockGapFixAction(
                gap({ reasonCode: 'insufficient_stock' }),
                back,
                (kind) => kind !== 'stock',
            ),
        ).toBeNull();
    });
});
