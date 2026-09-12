import type {
    AdminEntityMeta,
    IngredientAdmin,
    RecipeAdmin,
    RecipeAdminSummary,
    RecipeLine,
    RecipePackagingLine,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import { IngredientId, KitchenId, RecipeId } from '@healthy360/domain-types';
import type { RecipeVersionId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
    TEST_ORGANISATION_ID,
    kitchenManagerSession,
    testActiveContext,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { batchFactor, displayQuantity, scaleLine, scalePackaging } from './batch-scaling.ts';
import { RECIPE_VIEW_PERMISSION } from './entity-registry.ts';
import { BatchPlannerScreen } from './screens/batch-planner-screen.tsx';

/**
 * The batch planner: one recipe, one target, and the two things the page must not get wrong.
 *
 * 1. **A name comes from the catalogue.** `RecipeLine.ingredientName` is the sheet's own
 *    designation and is usually empty, so a page that trusted it would draw a blank first column.
 *    The fixture below sets it to `''` deliberately — the assertion is that the row still names the
 *    ingredient, which can only have come from the ingredient record.
 * 2. **Packaging rounds up and ingredients do not.** 0.4 of an egg is an instruction; 0.4 of a box
 *    is not something anybody can take off a shelf. Both appear in one run below, because the
 *    difference is invisible in either case alone.
 */

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/batch',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: ReactNode }) => children,
}));

/* ------------------------------------------------------------------------------------------------
 * The arithmetic
 * ---------------------------------------------------------------------------------------------- */

describe('batch scaling', () => {
    it('divides the target by what the version makes', () => {
        expect(batchFactor({ yieldQuantity: 4, yieldPieces: null }, 'yield', 10)).toBe(2.5);
    });

    it('divides by the piece count in pieces mode', () => {
        expect(batchFactor({ yieldQuantity: 4, yieldPieces: 16 }, 'pieces', 40)).toBe(2.5);
    });

    it('has no answer in pieces mode for a recipe that does not count in pieces', () => {
        expect(batchFactor({ yieldQuantity: 4, yieldPieces: null }, 'pieces', 40)).toBeNull();
    });

    it('has no answer without a usable target or a usable yield', () => {
        expect(batchFactor({ yieldQuantity: 4, yieldPieces: null }, 'yield', 0)).toBeNull();
        expect(batchFactor({ yieldQuantity: 4, yieldPieces: null }, 'yield', null)).toBeNull();
        expect(
            batchFactor({ yieldQuantity: 4, yieldPieces: null }, 'yield', Number.NaN),
        ).toBeNull();
        expect(batchFactor({ yieldQuantity: 0, yieldPieces: null }, 'yield', 10)).toBeNull();
    });

    it('scales an ingredient line exactly, fraction and all', () => {
        expect(scaleLine(0.2, 2.5)).toBe(0.5);
        // Countable and still fractional: the recipe's proportions are the point.
        expect(scaleLine(1, 0.4)).toBe(0.4);
    });

    it('rounds packaging up on anything counted, and leaves the divisible alone', () => {
        expect(scalePackaging(6, 2.5, 'piece')).toBe(15);
        expect(scalePackaging(1, 0.4, 'pack')).toBe(1);
        expect(scalePackaging(1.7, 1.5, 'l')).toBe(2.55);
        // 3 × (2.1 ÷ 0.7) is 9.000000000000002 in floating point; that is nine boxes, not ten.
        expect(scalePackaging(3, 2.1 / 0.7, 'piece')).toBe(9);
    });

    it('reads a fraction of a kilogram in grams, and leaves everything else in its own unit', () => {
        expect(displayQuantity(0.526, 'kg')).toEqual({ quantity: 526, unit: 'g' });
        expect(displayQuantity(0.25, 'l')).toEqual({ quantity: 250, unit: 'ml' });
        // At a kilogram and above the figure is already the one a scale shows.
        expect(displayQuantity(3.505, 'kg')).toEqual({ quantity: 3.505, unit: 'kg' });
        expect(displayQuantity(1, 'kg')).toEqual({ quantity: 1, unit: 'kg' });
        // Counts and empty lines have nothing smaller to be read in.
        expect(displayQuantity(0.5, 'piece')).toEqual({ quantity: 0.5, unit: 'piece' });
        expect(displayQuantity(0, 'kg')).toEqual({ quantity: 0, unit: 'kg' });
    });
});

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 * ---------------------------------------------------------------------------------------------- */

const RECIPE_ID = RecipeId.unsafe('01935f6d-0000-7000-8000-0000000b0001');
const VERSION_ID = '01935f6d-0000-7000-8000-0000000e0001' as RecipeVersionId;
const KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000c001');
const BURGHUL_ID = IngredientId.unsafe('01935f6d-0000-7000-8000-0000000a0001');
const TRAY_ID = IngredientId.unsafe('01935f6d-0000-7000-8000-0000000a0002');

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'published',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

function ingredient(id: IngredientId, name: string): IngredientAdmin {
    return {
        id,
        meta: meta(),
        name: { en: name, ar: `${name} بالعربية` },
        reference: null,
        subcategoryCode: null,
        categoryCode: 'store-cupboard',
        measurementUnit: 'g',
        purchaseUnit: null,
        composition: null,
        itemsPerUnit: null,
        purchasePrice: null,
        wastePercent: null,
        capacity: null,
        b2bPrice: null,
        b2cPrice: null,
        unitPrice: null,
        isSellable: false,
        costPer100g: null,
        per100g: null,
        allergens: [],
        dietClassifications: [],
        aliases: [],
        organisationId: TEST_ORGANISATION_ID,
        forkedFromId: null,
        isEditable: true,
        notes: null,
    };
}

const BURGHUL = ingredient(BURGHUL_ID, 'Burghul');
const TRAY = ingredient(TRAY_ID, 'Gastronorm tray');
const LIBRARY: Readonly<Record<string, IngredientAdmin>> = {
    [String(BURGHUL_ID)]: BURGHUL,
    [String(TRAY_ID)]: TRAY,
};

/** The line as the mapper really delivers it: a blank name, because the sheet named nothing. */
const LINE: RecipeLine = {
    ingredientId: BURGHUL_ID,
    ingredientName: { en: '', ar: '' },
    quantity: 0.2,
    unit: 'kg',
    sourceDesignation: null,
    isOptional: false,
    lineCost: null,
};

const PACKAGING: RecipePackagingLine = {
    ingredientId: TRAY_ID,
    basis: 'fills_yield',
    quantity: 3,
    unit: 'piece',
    comment: null,
};

function version(overrides: Partial<RecipeVersionAdmin> = {}): RecipeVersionAdmin {
    return {
        id: VERSION_ID,
        recipeId: RECIPE_ID,
        versionNumber: 1,
        status: 'published',
        yieldQuantity: 4,
        yieldUnit: 'kg',
        yieldPieces: null,
        wastePercent: 3,
        b2bPrice: null,
        b2cPrice: null,
        lines: [LINE],
        packaging: [PACKAGING],
        outputs: [],
        steps: [],
        allergens: [],
        estimatedCost: null,
        derivationStale: false,
        publishedAt: '2026-08-01T09:00:00.000Z',
        ...overrides,
    };
}

function recipe(overrides: Partial<RecipeAdmin> = {}): RecipeAdmin {
    const current = overrides.currentVersion ?? version();
    return {
        id: RECIPE_ID,
        meta: meta(),
        name: { en: 'Tabbouleh base', ar: 'أساس التبولة' },
        slug: 'tabbouleh-base',
        reference: 'RC-0001',
        kitchenId: KITCHEN_ID,
        sourceKind: null,
        recipeCategory: null,
        currentVersionNumber: current.versionNumber,
        versionCount: 1,
        description: { en: 'A base.', ar: 'أساس.' },
        currentVersion: current,
        versions: [
            {
                id: current.id,
                versionNumber: current.versionNumber,
                status: current.status,
                publishedAt: current.publishedAt,
                updatedAt: '2026-08-01T09:00:00.000Z',
                isCurrent: true,
            },
        ],
        ...overrides,
    };
}

function summaryOf(record: RecipeAdmin): RecipeAdminSummary {
    const {
        description: _description,
        currentVersion: _currentVersion,
        versions: _versions,
        ...summary
    } = record;
    return summary;
}

function batchRepositories() {
    const record = recipe();
    return {
        kitchenAdmin: {
            listRecipes: async () => page([summaryOf(record)]),
            getRecipe: async () => record,
            getIngredient: async (ingredientId: IngredientId) => {
                const found = LIBRARY[String(ingredientId)];
                if (found === undefined) throw new Error(`No ingredient ${String(ingredientId)}.`);
                return found;
            },
        },
    };
}

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

/* ------------------------------------------------------------------------------------------------
 * The screen
 * ---------------------------------------------------------------------------------------------- */

describe('the batch planner', () => {
    it('scales the chosen recipe, names its ingredients from the catalogue and ceils its packaging', async () => {
        await renderStubScreen(<BatchPlannerScreen />, {
            session: kitchenManagerSession(),
            repositories: batchRepositories(),
        });

        await untilVisible('kitchen-batch-planner-screen');
        // Nothing is scaled before a recipe is picked.
        await untilVisible('kitchen-batch-planner-pick-recipe');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-batch-recipe-trigger'));
        });
        await untilVisible(`kitchen-batch-recipe-option-${String(RECIPE_ID)}`);
        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-batch-recipe-option-${String(RECIPE_ID)}`));
        });

        // A recipe with no target is still not a batch.
        await untilVisible('kitchen-batch-planner-target-needed');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-batch-target-input'), '10');
        });

        await untilVisible('kitchen-batch-ingredients');

        // 10 kg of a 4 kg recipe is two and a half batches.
        expect(screen.getByTestId('kitchen-batch-metric-batches-value')).toHaveTextContent('2.5');

        // The name can only have come from the ingredient record: the line carries none.
        await waitFor(
            () => {
                expect(
                    screen.getByTestId(`kitchen-batch-row-${String(BURGHUL_ID)}-name`),
                ).toHaveTextContent('Burghul');
            },
            { timeout: 10_000 },
        );
        // 0.2 kg × 2.5 is half a kilogram, which the sheet reads as 500 g.
        expect(
            screen.getByTestId(`kitchen-batch-row-${String(BURGHUL_ID)}-quantity`),
        ).toHaveTextContent('500');

        // 3 trays × 2.5 is 7.5, and half a tray is not a thing anybody can take off a shelf.
        expect(
            screen.getByTestId(`kitchen-batch-row-${String(TRAY_ID)}-quantity`),
        ).toHaveTextContent('8');
        expect(screen.getByTestId(`kitchen-batch-row-${String(TRAY_ID)}-name`)).toHaveTextContent(
            'Gastronorm tray',
        );
    });

    it('refuses a reader who may see recipes but not the catalogue behind their names', async () => {
        const harness = await renderStubScreen(<BatchPlannerScreen />, {
            session: kitchenManagerSession({
                activeContext: testActiveContext({ permissions: [RECIPE_VIEW_PERMISSION] }),
            }),
            repositories: batchRepositories(),
        });

        await untilVisible('kitchen-batch-planner-forbidden');

        expect(screen.queryByTestId('kitchen-batch-planner-screen')).toBeNull();
        // The gate refuses before anything is asked — a page of em dashes where the names go would
        // be the alternative, and `catalogue.view_organisation` is exactly the code that prevents it.
        expect(harness.repositories.kitchenAdmin.getIngredient).not.toHaveBeenCalled();
    });
});
