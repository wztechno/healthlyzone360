import type {
    AdminEntityMeta,
    IngredientAdmin,
    MealAdmin,
    ProductAdmin,
    RecipeAdmin,
    RecipeRollupPreview,
    RecipeSoldAs,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import { IngredientId, KitchenId, MealId, ProductId, RecipeId } from '@healthy360/domain-types';
import type { RecipeVersionId } from '@healthy360/domain-types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ComponentType, ReactNode } from 'react';

import KitchenDressingRoute from '../../../app/kitchen/dressings/[product].tsx';
import KitchenDressingsRoute from '../../../app/kitchen/dressings/index.tsx';
import KitchenFrozenMealRoute from '../../../app/kitchen/frozen-meals/[product].tsx';
import KitchenFrozenMealsRoute from '../../../app/kitchen/frozen-meals/index.tsx';
import KitchenMealRoute from '../../../app/kitchen/meals/[meal].tsx';
import KitchenMealsRoute from '../../../app/kitchen/meals/index.tsx';
import KitchenSauceRoute from '../../../app/kitchen/sauces/[product].tsx';
import KitchenSaucesRoute from '../../../app/kitchen/sauces/index.tsx';
import { TEST_ORGANISATION_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { CookedItemEditScreen, RecipeBookEditScreen } from './screens/cooked-item-edit-screen.tsx';

/**
 * Everything a kitchen cooks — a meal, a sauce, a dressing, a preparation — is one page in the recipe
 * book: the recipe, and on a tab of its own the listing of whatever sells it.
 *
 * Two records, two lock versions, two saves, and the page has to keep them apart without making the
 * reader care. What this file pins:
 *
 * 1. **The page is the recipe, and the listing is a tab on it.** A sauce opens on its formulation,
 *    with the Packaging tab every recipe has — its bottles are packaging lines — and a Selling tab
 *    whose listing draws no recipe picker and no category, because the page already answers both.
 *    A recipe nothing sells has no Selling tab, and one sold twice switches between its sellers.
 * 2. **The listing saves as the listing.** Against the item's own lock version, and without writing
 *    the recipe.
 * 3. **Nothing typed is lost.** A half-typed pack survives a tab switch, and leaving the page with
 *    one asks first.
 * 4. **An item is reached through its recipe.** The item address hands over to the recipe; an item
 *    with no recipe yet can still be listed, under the notice that offers to start one, and starting
 *    it lands on the recipe it wrote.
 * 5. **A new meal is written recipe first** — then the listing that sells it, then the page lands on
 *    the recipe's address. A new preparation writes no item at all.
 * 6. **Every old address still arrives.** The eight route files the book replaced are redirects.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    // The redirect the old route files render, captured rather than followed.
    const redirect = jest.fn(() => null);
    let params: Readonly<Record<string, string>> = {};
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, back: jest.fn(), setParams: jest.fn() }),
        usePathname: () => '/kitchen/recipes',
        useLocalSearchParams: () => params,
        Redirect: redirect,
        Link: ({ children }: { children: ReactNode }) => children,
        __push: push,
        __replace: replace,
        __redirect: redirect,
        __setParams: (next: Readonly<Record<string, string>>) => {
            params = next;
        },
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as {
    __push: jest.Mock;
    __replace: jest.Mock;
    __redirect: jest.Mock;
    __setParams: (next: Readonly<Record<string, string>>) => void;
};

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
    routerMock.__redirect.mockClear();
    routerMock.__setParams({});
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
    slug: 'garlic',
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
    lineCount: 1,
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

/** One item that sells the recipe, as the book lists it — the sauce, at its own lock version 7. */
function seller(overrides: Partial<RecipeSoldAs> = {}): RecipeSoldAs {
    return {
        id: String(SAUCE_ID),
        itemType: 'sauce',
        status: 'draft',
        lockVersion: 7,
        reference: 'SAC-044',
        slug: 'garlic-sauce',
        name: { en: 'Garlic sauce', ar: 'صلصة الثوم' },
        imagePlaceholderId: 'sauce-garlic-sauce',
        kitchenCategory: null,
        kitchenSubcategory: null,
        isMarketPriced: false,
        isAssorted: false,
        dataQualityFlags: [],
        portionFactor: 1,
        composition: null,
        channels: ['b2c'],
        packCount: 1,
        defaultPack: {
            label: { en: 'Bottle 300 g', ar: 'عبوة 300 غ' },
            netQuantity: 300,
            netUnit: 'g',
        },
        ...overrides,
    };
}

/** The meal that sells the same recipe, at lock version 5 — neither the recipe's nor the sauce's. */
const MEAL_SELLER = seller({
    id: String(MEAL_ID),
    itemType: 'meal',
    lockVersion: 5,
    reference: null,
    slug: 'toum-bowl',
    name: { en: 'Toum bowl', ar: 'وعاء الثومية' },
    imagePlaceholderId: 'meal-bowl',
    packCount: 0,
    defaultPack: null,
});

/** The recipe as the book reads it: what sells it, and the kinds those sellers make it. */
function soldAs(...sellers: readonly RecipeSoldAs[]): RecipeAdmin {
    return {
        ...RECIPE,
        soldAs: sellers,
        kinds:
            sellers.length === 0
                ? ['preparation']
                : [...new Set(sellers.map((entry) => entry.itemType))],
    };
}

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
        imagePlaceholderId: 'sauce-garlic-sauce',
        netContentQuantity: null,
        netContentUnitId: null,
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

/** What the page reads for a recipe sold as the sauce — the recipe, the item, the library. */
function pageReads(item: ProductAdmin, recipe: RecipeAdmin = soldAs(seller())) {
    return {
        getProduct: async () => item,
        listProducts: async () => page([item]),
        listRecipes: async () => page([]),
        getRecipe: async () => recipe,
        listIngredients: async () => page([GARLIC]),
        getIngredient: async () => GARLIC,
        previewRecipeRollup: async () => NO_PREVIEW,
    };
}

/** The sauce's recipe, opened in the book. */
function renderSauceRecipe(item: ProductAdmin, writes: Record<string, unknown> = {}) {
    return renderStubScreen(<RecipeBookEditScreen recipe={String(RECIPE_ID)} />, {
        session: kitchenManagerSession(),
        repositories: { kitchenAdmin: { ...pageReads(item), ...writes } },
    });
}

/** The sauce, opened by its item address — where the old `/kitchen/sauces/{id}` lands. */
function renderSauceItem(item: ProductAdmin, writes: Record<string, unknown> = {}) {
    return renderStubScreen(<CookedItemEditScreen item={String(item.id)} kind="sauce" />, {
        session: kitchenManagerSession(),
        repositories: { kitchenAdmin: { ...pageReads(item), ...writes } },
    });
}

const PACK_LABEL = 'kitchen-product-pack-editor-row-seed-0-BTL300-label-input';

/* ------------------------------------------------------------------------------------------------
 * The page
 * ---------------------------------------------------------------------------------------------- */

describe('a cooked item’s page', () => {
    it('opens a sauce on its recipe, with packaging and a Selling tab that holds its listing', async () => {
        await renderSauceRecipe(sauce());

        await untilVisible('kitchen-recipe-editor-screen-header');
        // A sauce's bottles are packaging lines, as a meal's box is.
        expect(screen.getByTestId('kitchen-recipe-tab-packaging')).toBeTruthy();

        await press('kitchen-recipe-tab-selling');
        await untilVisible('kitchen-product-packs');

        // The page is the recipe and its kind is the category: neither is asked again here.
        expect(screen.queryByTestId('kitchen-product-recipe-select')).toBeNull();
        expect(screen.queryByTestId('kitchen-product-category')).toBeNull();
        expect(screen.getByTestId('kitchen-product-publish')).toBeTruthy();
        expect(screen.getByTestId('kitchen-product-editor-screen-status')).toBeTruthy();
        // One seller, so nothing to choose between.
        expect(screen.queryByTestId('kitchen-recipe-selling-seller')).toBeNull();
    });

    it('saves the listing against the item’s own lock version, and writes no recipe', async () => {
        const stored = sauce();
        const { repositories } = await renderSauceRecipe(stored, {
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
        await renderSauceRecipe(sauce());

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

    it('draws no Selling tab for a recipe nothing sells', async () => {
        await renderStubScreen(<RecipeBookEditScreen recipe={String(RECIPE_ID)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: pageReads(sauce(), soldAs()) },
        });

        await untilVisible('kitchen-recipe-editor-screen-header');
        expect(screen.getByTestId('kitchen-recipe-tab-sheet')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-recipe-tab-selling')).toBeNull();
    });

    it('switches between the listings of a recipe sold twice', async () => {
        await renderStubScreen(<RecipeBookEditScreen recipe={String(RECIPE_ID)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...pageReads(sauce(), soldAs(seller(), MEAL_SELLER)),
                    getMeal: async () => mealItem(),
                },
            },
        });

        await untilVisible('kitchen-recipe-editor-screen-header');
        await press('kitchen-recipe-tab-selling');

        // The first seller opens, with a switch naming each by its handle, or its slug without one.
        await untilVisible('kitchen-product-packs');
        expect(screen.getByTestId('kitchen-recipe-selling-seller')).toBeTruthy();
        expect(
            screen.getByTestId(`kitchen-recipe-selling-seller-${String(SAUCE_ID)}`),
        ).toHaveTextContent(/SAC-044/);
        expect(
            screen.getByTestId(`kitchen-recipe-selling-seller-${String(MEAL_ID)}`),
        ).toHaveTextContent(/toum-bowl/);

        await press(`kitchen-recipe-selling-seller-${String(MEAL_ID)}`);

        await untilVisible('kitchen-meal-portion-input');
        expect(screen.queryByTestId('kitchen-product-packs')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * An item's own address
 * ---------------------------------------------------------------------------------------------- */

describe('an item’s address', () => {
    it('hands an item with a recipe over to the recipe’s page', async () => {
        await renderSauceItem(sauce());

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith(
                `/kitchen/recipes/${String(RECIPE_ID)}`,
            );
        });
        // Behind the skeleton, not the notice: this item has nothing to start.
        expect(screen.getByTestId('kitchen-cooked-item-loading')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-cooked-item-recipe-missing')).toBeNull();
        expect(routerMock.__replace).toHaveBeenCalledTimes(1);
    });

    it('lists a sauce that has no recipe yet, under the notice that offers to start one', async () => {
        await renderSauceItem(sauce({ recipeId: null }));

        await untilVisible('kitchen-cooked-item-recipe-missing');
        await untilVisible('kitchen-product-packs');
        expect(screen.getByTestId('kitchen-product-publish')).toBeTruthy();
        expect(routerMock.__replace).not.toHaveBeenCalled();
    });

    it('lands on the recipe a started formulation wrote, linked to this item', async () => {
        // The item as the server holds it: unlinked until the link is written, linked after.
        let stored = sauce({ recipeId: null });
        const { repositories } = await renderSauceItem(stored, {
            getProduct: async () => stored,
            createRecipe: async () => RECIPE,
            updateProduct: async () => {
                stored = sauce();
                return stored;
            },
        });

        await untilVisible('kitchen-cooked-item-formulation-start');
        await press('kitchen-cooked-item-formulation-start');

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith(
                `/kitchen/recipes/${String(RECIPE_ID)}`,
            );
        });
        // The link is to *this* item, at its own lock version, and carries nothing else.
        expect(repositories.kitchenAdmin.updateProduct).toHaveBeenCalledWith(SAUCE_ID, {
            lockVersion: 7,
            recipeId: RECIPE_ID,
        });
        expect(repositories.kitchenAdmin.createRecipe).toHaveBeenCalledTimes(1);
    });

    it('answers an address with no kind as not found, and leads back to the book', async () => {
        await renderStubScreen(<CookedItemEditScreen item={String(SAUCE_ID)} />, {
            session: kitchenManagerSession(),
        });

        await untilVisible('kitchen-cooked-item-not-found');
        await press('kitchen-cooked-item-not-found-back');
        expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/recipes');
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
        productionMode: null,
        ingredientId: null,
        sellsFromFinishedStock: false,
        netContentQuantity: null,
        netContentUnitId: null,
        ...overrides,
    };
}

function mealReads(item: MealAdmin, recipe: RecipeAdmin = soldAs(MEAL_SELLER)) {
    return {
        getMeal: async () => item,
        getRecipe: async () => recipe,
        listIngredients: async () => page([GARLIC]),
        getIngredient: async () => GARLIC,
        previewRecipeRollup: async () => NO_PREVIEW,
    };
}

describe('a meal page', () => {
    it('opens a meal on its recipe, with the portion and service days on its Selling tab', async () => {
        await renderStubScreen(<RecipeBookEditScreen recipe={String(RECIPE_ID)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: mealReads(mealItem()) },
        });

        await untilVisible('kitchen-recipe-editor-screen-header');
        await press('kitchen-recipe-tab-selling');
        await untilVisible('kitchen-meal-portion-input');

        // The page is the recipe, so the listing no longer asks which one.
        expect(screen.queryByTestId('kitchen-meal-recipe-select')).toBeNull();
        expect(screen.getByTestId('kitchen-meal-availability-add')).toBeTruthy();
    });

    it('writes a new meal recipe first, then the listing that sells it, and lands on the recipe', async () => {
        const { repositories } = await renderStubScreen(
            <RecipeBookEditScreen recipe="new" kind="meal" />,
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
            expect(routerMock.__replace).toHaveBeenCalledWith(
                `/kitchen/recipes/${String(RECIPE_ID)}`,
            );
        });
    });

    it('keeps the recipe, and says so, when the listing cannot be written', async () => {
        await renderStubScreen(<RecipeBookEditScreen recipe="new" kind="meal" />, {
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
        });

        await untilVisible('kitchen-recipe-name-en-input');
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-recipe-name-en-input'), 'Toum bowl');
        });
        await press('kitchen-recipe-editor-screen-save');

        // Not a silent redirect: the recipe exists, the listing does not, and the reader is told.
        await untilVisible('kitchen-cooked-item-listing-failed-toast');
        expect(routerMock.__replace).toHaveBeenCalledWith(`/kitchen/recipes/${String(RECIPE_ID)}`);
    });

    it('creates a preparation as a recipe alone, with no item to sell it', async () => {
        const { repositories } = await renderStubScreen(
            <RecipeBookEditScreen recipe="new" kind="preparation" />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...mealReads(mealItem(), soldAs()),
                        nextReference: async () => 'RC-0002',
                        createRecipe: async () => RECIPE,
                    },
                },
            },
        );

        await untilVisible('kitchen-recipe-name-en-input');
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-recipe-name-en-input'),
                'Cordon bleu marination',
            );
        });
        await press('kitchen-recipe-editor-screen-save');

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith(
                `/kitchen/recipes/${String(RECIPE_ID)}`,
            );
        });
        expect(repositories.kitchenAdmin.createRecipe).toHaveBeenCalledTimes(1);
        expect(repositories.kitchenAdmin.createMeal).not.toHaveBeenCalled();
        expect(repositories.kitchenAdmin.createProduct).not.toHaveBeenCalled();
    });

    it('lists a meal that has no recipe yet, under the notice that offers to start one', async () => {
        await renderStubScreen(<CookedItemEditScreen item={String(MEAL_ID)} kind="meal" />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: mealReads(mealItem({ recipeId: null, recipeVersionId: null })),
            },
        });

        await untilVisible('kitchen-cooked-item-recipe-missing');
        await untilVisible('kitchen-meal-portion-input');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The old addresses
 * ---------------------------------------------------------------------------------------------- */

const ITEM = '01935f6d-0000-7000-8000-0000000d00ff';

/**
 * Every route file the book replaced, and where it sends a reader. The editor addresses carry an
 * item id, so they go to the item address rather than to a recipe id they do not know; `new` goes to
 * the create form of the same kind, spelt as the server spells it.
 */
const REDIRECTS: readonly {
    readonly from: string;
    readonly route: ComponentType;
    readonly params: Readonly<Record<string, string>>;
    readonly to: string;
}[] = [
    {
        from: '/kitchen/meals',
        route: KitchenMealsRoute,
        params: {},
        to: '/kitchen/recipes?kind=meal',
    },
    {
        from: '/kitchen/meals/{meal}',
        route: KitchenMealRoute,
        params: { meal: ITEM },
        to: `/kitchen/recipes/item/${ITEM}?kind=meal`,
    },
    {
        from: '/kitchen/meals/new',
        route: KitchenMealRoute,
        params: { meal: 'new' },
        to: '/kitchen/recipes/new?kind=meal',
    },
    {
        from: '/kitchen/sauces',
        route: KitchenSaucesRoute,
        params: {},
        to: '/kitchen/recipes?kind=sauce',
    },
    {
        from: '/kitchen/sauces/{product}',
        route: KitchenSauceRoute,
        params: { product: ITEM },
        to: `/kitchen/recipes/item/${ITEM}?kind=sauce`,
    },
    {
        from: '/kitchen/sauces/new',
        route: KitchenSauceRoute,
        params: { product: 'new' },
        to: '/kitchen/recipes/new?kind=sauce',
    },
    {
        from: '/kitchen/dressings',
        route: KitchenDressingsRoute,
        params: {},
        to: '/kitchen/recipes?kind=dressing',
    },
    {
        from: '/kitchen/dressings/{product}',
        route: KitchenDressingRoute,
        params: { product: ITEM },
        to: `/kitchen/recipes/item/${ITEM}?kind=dressing`,
    },
    {
        from: '/kitchen/frozen-meals',
        route: KitchenFrozenMealsRoute,
        params: {},
        to: '/kitchen/recipes?kind=frozen_meal',
    },
    {
        from: '/kitchen/frozen-meals/{product}',
        route: KitchenFrozenMealRoute,
        params: { product: ITEM },
        to: `/kitchen/recipes/item/${ITEM}?kind=frozen_meal`,
    },
    {
        from: '/kitchen/frozen-meals/new',
        route: KitchenFrozenMealRoute,
        params: { product: 'new' },
        to: '/kitchen/recipes/new?kind=frozen_meal',
    },
];

describe('the addresses the recipe book replaced', () => {
    it.each(REDIRECTS)('sends $from to $to', async ({ route: Route, params, to }) => {
        routerMock.__setParams(params);

        // `render` resolves once the tree has committed; the redirect is drawn on that commit.
        await render(<Route />);

        expect(routerMock.__redirect.mock.calls.at(-1)?.[0]).toEqual({ href: to });
    });
});
