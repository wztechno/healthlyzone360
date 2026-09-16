import type {
    AdminEntityMeta,
    IngredientAdmin,
    MealAdmin,
    ProductAdmin,
    RecipeAdmin,
    RecipeRollupPreview,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import { IngredientId, KitchenId, MealId, ProductId, RecipeId } from '@healthy360/domain-types';
import type { RecipeVersionId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { TEST_ORGANISATION_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { CookedItemEditScreen } from './screens/cooked-item-edit-screen.tsx';

/**
 * A cooked item — a meal, a sauce, a dressing — is one page: the recipe it is made from, and — on a
 * tab of its own — the listing it is sold as.
 *
 * Two records, two lock versions, two saves, and the page has to keep them apart without making the
 * reader care. What this file pins:
 *
 * 1. **The page is the recipe, and the listing is a tab on it.** A sauce opens on its formulation,
 *    with the Packaging tab every recipe has — its bottles are packaging lines — and a Selling tab
 *    whose listing draws no recipe picker and no category, because the page already answers both.
 * 2. **The listing saves as the listing.** Against the item's own lock version, and without writing
 *    the recipe.
 * 3. **Nothing typed is lost.** A half-typed pack survives a tab switch, and leaving the page with
 *    one asks first.
 * 4. **A sauce with no recipe yet can still be listed**, under the notice that offers to start one.
 * 5. **A meal is the same page.** Its listing holds the portion and the service days, and a new meal
 *    is written recipe first — then the listing that sells it, then the page lands on its address.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, back: jest.fn(), setParams: jest.fn() }),
        usePathname: () => '/kitchen/sauces',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        __push: push,
        __replace: replace,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __replace: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
});

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

async function press(testID: string) {
    await act(async () => {
        fireEvent.press(screen.getByTestId(testID));
    });
}

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 * ---------------------------------------------------------------------------------------------- */

const KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000c001');
const RECIPE_ID = RecipeId.unsafe('01935f6d-0000-7000-8000-0000000b0001');
const VERSION_ID = '01935f6d-0000-7000-8000-0000000e0001' as RecipeVersionId;
const SAUCE_ID = ProductId.unsafe('01935f6d-0000-7000-8000-0000000d0001');
const MEAL_ID = MealId.unsafe('01935f6d-0000-7000-8000-0000000f0001');
const GARLIC_ID = IngredientId.unsafe('01935f6d-0000-7000-8000-0000000a0001');

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'draft',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

const GARLIC: IngredientAdmin = {
    id: GARLIC_ID,
    meta: meta({ status: 'published' }),
    name: { en: 'Garlic', ar: 'ثوم' },
    reference: 'ING-001',
    subcategoryCode: null,
    categoryCode: 'vegetables',
    measurementUnit: 'kg',
    purchaseUnit: null,
    composition: null,
    itemsPerUnit: null,
    gramsPerUnit: null,
    purchasePrice: null,
    wastePercent: null,
    capacity: null,
    b2bPrice: null,
    b2cPrice: null,
    unitPrice: null,
    isSellable: false,
    costPer100g: null,
    per100g: null,
    nutritionDerivedFromVersionId: null,
    nutritionEstimated: null,
    nutritionNote: null,
    allergens: [],
    dietClassifications: [],
    aliases: [],
    organisationId: TEST_ORGANISATION_ID,
    forkedFromId: null,
    isEditable: true,
    notes: null,
};

const VERSION: RecipeVersionAdmin = {
    id: VERSION_ID,
    recipeId: RECIPE_ID,
    versionNumber: 1,
    status: 'draft',
    yieldQuantity: 2,
    yieldUnit: 'kg',
    yieldPieces: null,
    wastePercent: 3,
    packagingWastePercent: 0,
    b2bPrice: null,
    b2cPrice: null,
    lines: [
        {
            ingredientId: GARLIC_ID,
            ingredientName: { en: '', ar: '' },
            quantity: 0.4,
            unit: 'kg',
            sourceDesignation: null,
            isOptional: false,
            lineCost: null,
        },
    ],
    packaging: [],
    outputs: [],
    steps: [],
    allergens: [],
    estimatedCost: null,
    derivationStale: false,
    publishedAt: null,
};

/** The recipe at lock version 3, so a write that used it for the listing would be caught. */
const RECIPE: RecipeAdmin = {
    id: RECIPE_ID,
    meta: meta({ lockVersion: 3 }),
    name: { en: 'Garlic sauce', ar: 'صلصة الثوم' },
    slug: 'garlic-sauce',
    reference: 'RC-0001',
    kitchenId: KITCHEN_ID,
    sourceKind: null,
    recipeCategory: 'cold_sauce_dip',
    currentVersionNumber: 1,
    versionCount: 1,
    currentVersionStatus: 'draft',
    allergenCodes: [],
    description: { en: 'Toum.', ar: 'ثومية.' },
    currentVersion: VERSION,
    versions: [
        {
            id: VERSION_ID,
            versionNumber: 1,
            status: 'draft',
            publishedAt: null,
            updatedAt: '2026-08-01T09:00:00.000Z',
            isCurrent: true,
        },
    ],
};

/** The listing at lock version 7 — not the recipe's 3. */
function sauce(overrides: Partial<ProductAdmin> = {}): ProductAdmin {
    return {
        id: SAUCE_ID,
        meta: meta({ lockVersion: 7 }),
        itemType: 'sauce',
        reference: 'SAC-044',
        name: { en: 'Garlic sauce', ar: 'صلصة الثوم' },
        description: { en: 'Toum.', ar: 'ثومية.' },
        categoryId: null,
        categoryCode: 'sauce',
        kitchenCategory: null,
        kitchenSubcategory: null,
        composition: null,
        kitchenId: KITCHEN_ID,
        isMarketPriced: false,
        isAssorted: false,
        packVariants: [
            {
                code: 'BTL300',
                label: { en: 'Bottle 300 g', ar: 'عبوة 300 غ' },
                netQuantity: 300,
                netUnit: 'g',
                unitsPerPack: 1,
            },
        ],
        channelAvailability: [
            { channel: 'b2c', isAvailable: true, availableFrom: null, availableUntil: null },
        ],
        recipeId: RECIPE_ID,
        dietClassifications: [],
        dataQualityFlags: [],
        ...overrides,
    };
}

const NO_PREVIEW: RecipeRollupPreview = {
    perRecipe: null,
    perServing: null,
    per100g: null,
    allergenSources: [],
    estimatedCost: null,
    computedCost: null,
    warnings: [],
};

function pageReads(item: ProductAdmin) {
    return {
        getProduct: async () => item,
        listProducts: async () => page([item]),
        listRecipes: async () => page([]),
        getRecipe: async () => RECIPE,
        listIngredients: async () => page([GARLIC]),
        getIngredient: async () => GARLIC,
        previewRecipeRollup: async () => NO_PREVIEW,
    };
}

function renderSauce(item: ProductAdmin, writes: Record<string, unknown> = {}) {
    return renderStubScreen(
        <CookedItemEditScreen
            item={String(item.id)}
            itemType="sauce"
            routeBase="/kitchen/sauces"
        />,
        {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: { ...pageReads(item), ...writes } },
        },
    );
}

const PACK_LABEL = 'kitchen-product-pack-editor-row-seed-0-BTL300-label-en-input';

/* ------------------------------------------------------------------------------------------------
 * The page
 * ---------------------------------------------------------------------------------------------- */

describe('a cooked item’s page', () => {
    it('opens a sauce on its recipe, with packaging and a Selling tab that holds its listing', async () => {
        await renderSauce(sauce());

        await untilVisible('kitchen-recipe-editor-screen-header');
        // A sauce's bottles are packaging lines, as a meal's box is.
        expect(screen.getByTestId('kitchen-recipe-tab-packaging')).toBeTruthy();

        await press('kitchen-recipe-tab-selling');
        await untilVisible('kitchen-product-packs');

        // The page is the recipe and the route is the category: neither is asked again here.
        expect(screen.queryByTestId('kitchen-product-recipe-select')).toBeNull();
        expect(screen.queryByTestId('kitchen-product-category')).toBeNull();
        expect(screen.getByTestId('kitchen-product-publish')).toBeTruthy();
        expect(screen.getByTestId('kitchen-product-editor-screen-status')).toBeTruthy();
    });

    it('saves the listing against the item’s own lock version, and writes no recipe', async () => {
        const stored = sauce();
        const { repositories } = await renderSauce(stored, {
            updateProduct: async () => stored,
            setRecipeLines: async () => RECIPE,
        });

        await untilVisible('kitchen-recipe-editor-screen-header');
        await press('kitchen-recipe-tab-selling');
        await untilVisible(PACK_LABEL);

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(PACK_LABEL), 'Squeeze bottle 300 g');
        });
        await press('kitchen-product-editor-screen-save');

        await waitFor(() => {
            expect(repositories.kitchenAdmin.updateProduct).toHaveBeenCalledWith(
                SAUCE_ID,
                expect.objectContaining({
                    lockVersion: 7,
                    // Echoed, not cleared: the page decides the recipe and the category.
                    recipeId: RECIPE_ID,
                    categoryCode: 'sauce',
                    packVariants: [
                        expect.objectContaining({
                            code: 'BTL300',
                            label: { en: 'Squeeze bottle 300 g', ar: 'عبوة 300 غ' },
                        }),
                    ],
                }),
            );
        });
        expect(repositories.kitchenAdmin.setRecipeLines).not.toHaveBeenCalled();
    });

    it('keeps a half-typed pack through a tab switch, and asks before leaving with it', async () => {
        await renderSauce(sauce());

        await untilVisible('kitchen-recipe-editor-screen-header');
        await press('kitchen-recipe-tab-selling');
        await untilVisible(PACK_LABEL);
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(PACK_LABEL), 'Squeeze bot');
        });

        await press('kitchen-recipe-tab-production');
        await press('kitchen-recipe-tab-selling');
        expect(screen.getByTestId(PACK_LABEL).props.value).toBe('Squeeze bot');

        // The recipe is untouched; the listing is not, and that is enough to ask.
        await press('kitchen-recipe-editor-screen-discard');
        await untilVisible('kitchen-recipe-editor-screen-unsaved-dialog');
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('lists a sauce that has no recipe yet, under the notice that offers to start one', async () => {
        await renderSauce(sauce({ recipeId: null }));

        await untilVisible('kitchen-cooked-item-recipe-missing');
        await untilVisible('kitchen-product-packs');
        expect(screen.getByTestId('kitchen-product-publish')).toBeTruthy();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Meals
 * ---------------------------------------------------------------------------------------------- */

/** A saved meal made from the recipe, at lock version 5 — neither the recipe's nor the sauce's. */
function mealItem(overrides: Partial<MealAdmin> = {}): MealAdmin {
    return {
        id: MEAL_ID,
        meta: meta({ lockVersion: 5 }),
        name: { en: 'Toum bowl', ar: 'وعاء الثومية' },
        description: { en: 'Garlic sauce and chicken.', ar: 'ثومية ودجاج.' },
        kitchenCategory: null,
        kitchenSubcategory: null,
        composition: null,
        kitchenId: KITCHEN_ID,
        recipeId: RECIPE_ID,
        recipeVersionId: VERSION_ID,
        portionFactor: 1,
        mealTypes: [],
        dietClassifications: [],
        allergens: [],
        channelAvailability: [],
        availability: [],
        imagePlaceholderId: 'meal-bowl',
        marginPercent: null,
        ...overrides,
    };
}

function mealReads(item: MealAdmin) {
    return {
        getMeal: async () => item,
        getRecipe: async () => RECIPE,
        listIngredients: async () => page([GARLIC]),
        getIngredient: async () => GARLIC,
        previewRecipeRollup: async () => NO_PREVIEW,
    };
}

describe('a meal page', () => {
    it('opens a meal on its recipe, with the portion and service days on its Selling tab', async () => {
        await renderStubScreen(
            <CookedItemEditScreen
                item={String(MEAL_ID)}
                itemType="meal"
                routeBase="/kitchen/meals"
            />,
            {
                session: kitchenManagerSession(),
                repositories: { kitchenAdmin: mealReads(mealItem()) },
            },
        );

        await untilVisible('kitchen-recipe-editor-screen-header');
        await press('kitchen-recipe-tab-selling');
        await untilVisible('kitchen-meal-portion-input');

        // The page is the recipe, so the listing no longer asks which one.
        expect(screen.queryByTestId('kitchen-meal-recipe-select')).toBeNull();
        expect(screen.getByTestId('kitchen-meal-availability-add')).toBeTruthy();
    });

    it('writes a new meal recipe first, then the listing that sells it, and lands on the listing', async () => {
        const { repositories } = await renderStubScreen(
            <CookedItemEditScreen item="new" itemType="meal" routeBase="/kitchen/meals" />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...mealReads(mealItem()),
                        nextReference: async () => 'RC-0002',
                        createRecipe: async () => RECIPE,
                        createMeal: async () => mealItem(),
                    },
                },
            },
        );

        await untilVisible('kitchen-recipe-name-en-input');
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-recipe-name-en-input'), 'Toum bowl');
        });
        await press('kitchen-recipe-editor-screen-save');

        await waitFor(() => {
            expect(repositories.kitchenAdmin.createMeal).toHaveBeenCalledWith(
                expect.objectContaining({ recipeId: RECIPE_ID, name: RECIPE.name }),
            );
        });
        expect(repositories.kitchenAdmin.createRecipe).toHaveBeenCalledTimes(1);
        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith(`/kitchen/meals/${String(MEAL_ID)}`);
        });
    });

    it('keeps the recipe, and says so, when the listing cannot be written', async () => {
        await renderStubScreen(
            <CookedItemEditScreen item="new" itemType="meal" routeBase="/kitchen/meals" />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...mealReads(mealItem()),
                        nextReference: async () => 'RC-0002',
                        createRecipe: async () => RECIPE,
                        createMeal: () => {
                            throw new TypeError('allergens.map is not a function');
                        },
                    },
                },
            },
        );

        await untilVisible('kitchen-recipe-name-en-input');
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-recipe-name-en-input'), 'Toum bowl');
        });
        await press('kitchen-recipe-editor-screen-save');

        // Not a silent redirect: the recipe exists, the listing does not, and the reader is told.
        await untilVisible('kitchen-cooked-item-listing-failed-toast');
        expect(routerMock.__replace).toHaveBeenCalledWith(`/kitchen/recipes/${String(RECIPE_ID)}`);
    });

    it('lists a meal that has no recipe yet, under the notice that offers to start one', async () => {
        await renderStubScreen(
            <CookedItemEditScreen
                item={String(MEAL_ID)}
                itemType="meal"
                routeBase="/kitchen/meals"
            />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: mealReads(mealItem({ recipeId: null, recipeVersionId: null })),
                },
            },
        );

        await untilVisible('kitchen-cooked-item-recipe-missing');
        await untilVisible('kitchen-meal-portion-input');
    });
});
