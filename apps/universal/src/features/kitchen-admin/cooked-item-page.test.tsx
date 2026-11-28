import type {
    AdminEntityMeta,
    IngredientAdmin,
    ItemPacks,
    MealAdmin,
    ProductAdmin,
    RecipeAdmin,
    RecipeRollupPreview,
    RecipeSoldAs,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import {
    IngredientId,
    KitchenId,
    MealId,
    PriceListId,
    ProductId,
    RecipeId,
} from '@healthy360/domain-types';
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
import { withDeskWidth } from '../../testing/desk-width.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { CookedItemEditScreen, RecipeBookEditScreen } from './screens/cooked-item-edit-screen.tsx';

/**
 * Everything a kitchen cooks — a meal, a sauce, a dressing, a preparation — is one page in the recipe
 * book: the recipe, with no Selling tab — what sells it reads its name and description off the
 * Description tab, its diets are drawn there, and where it sells is Packs & prices.
 *
 * Two records, two lock versions, two saves, and the page has to keep them apart without making the
 * reader care. What this file pins:
 *
 * 1. **The page is the recipe.** A sauce opens on its formulation, with a Packs & prices tab — its
 *    bottles are packs — and its shop description and diet classifications on Description. A recipe
 *    sold twice switches sellers above Packs & prices.
 * 2. **Save writes the item's name and description**, against the item's own lock version — and
 *    Packs & prices after it, on the lock that write left. Publishing puts draft items on sale.
 * 3. **Nothing typed is lost.** A half-typed description survives a tab switch and marks the page
 *    unsaved.
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
    // Opened directly — a deep link, a refresh — so there is no page behind it to step back to.
    const canGoBack = () => false;
    return {
        __esModule: true,
        useSegments: () => [],
        useGlobalSearchParams: () => ({}),
        useNavigation: () => ({}),
        useRouter: () => ({
            push,
            replace,
            back: jest.fn(),
            canGoBack,
            dismissTo: jest.fn(),
            setParams: jest.fn(),
        }),
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
    reviewReason: null,
    previousLabel: null,
    lockVersion: 1,
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
    shelfLifeDays: null,
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

/** The item's English description, on the recipe's Description tab. */
const DESCRIPTION = 'kitchen-recipe-description-en-input';

const SAUCE_PACK = '01935f6d-0000-7000-8000-0000000c0001';
const PACK_HOME_PRICE = `kitchen-packs-${SAUCE_PACK}-price-home-input`;

/** The sauce's packs: its one bottle at $3.00 on the Home shop, sold there, at `lockVersion`. */
function saucePacks(lockVersion: number): ItemPacks {
    return {
        lockVersion,
        places: {
            home: {
                salesChannelId: 'web-shop',
                priceListId: PriceListId.unsafe('retail-usd'),
                currency: 'USD',
                offered: true,
            },
            business: {
                salesChannelId: 'wholesale',
                priceListId: PriceListId.unsafe('trade-usd'),
                currency: 'USD',
                offered: false,
            },
            counter: null,
        },
        packs: [
            {
                id: SAUCE_PACK,
                code: 'BTL300',
                name: { en: 'Bottle 300 g', ar: 'عبوة 300 غ' },
                isDefault: true,
                fill: { quantity: 0.3, unit: 'kg' },
                components: [{ ingredientId: GARLIC_ID, quantity: 1, isContainer: true }],
                prices: { home: { amountMinor: 300, inherited: false }, business: null },
            },
        ],
    };
}

/* ------------------------------------------------------------------------------------------------
 * The page
 * ---------------------------------------------------------------------------------------------- */

describe('a cooked item’s page', () => {
    it('opens a sauce on its recipe, its shop description and diets on Description, and no Selling tab', async () => {
        await renderSauceRecipe(sauce({ dietClassifications: ['vegan', 'vegetarian'] }));

        await untilVisible('kitchen-recipe-editor-screen-header');
        // A sauce's bottles are its packs, priced where they sell — the tab keeps its old key.
        expect(screen.getByTestId('kitchen-recipe-tab-packaging')).toHaveTextContent(
            /Packs & prices/,
        );
        expect(screen.queryByTestId('kitchen-recipe-tab-selling')).toBeNull();

        // The item's description is the one the Description tab edits; its diets are read-only.
        await waitFor(() => {
            expect(screen.getByTestId(DESCRIPTION).props.value).toBe('Toum.');
        });
        await untilVisible('kitchen-recipe-diets');
        expect(screen.getByTestId('kitchen-recipe-diet-vegan')).toBeTruthy();
        expect(screen.getByTestId('kitchen-recipe-diet-vegetarian')).toBeTruthy();
        // No listing of its own: no second status, Publish or Archive.
        expect(screen.queryByTestId('kitchen-product-publish')).toBeNull();
        expect(screen.queryByTestId('kitchen-product-archive')).toBeNull();
        // One seller, so nothing to choose between.
        expect(screen.queryByTestId('kitchen-recipe-packs-seller')).toBeNull();
    });

    it('saves the item’s name and description from the recipe’s one Save, against the item’s own lock version', async () => {
        const stored = sauce();
        const { repositories } = await renderSauceRecipe(stored, {
            updateProduct: async () => stored,
            setRecipeLines: async () => RECIPE,
        });

        await untilVisible('kitchen-recipe-editor-screen-header');
        await waitFor(() => {
            expect(screen.getByTestId(DESCRIPTION).props.value).toBe('Toum.');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(DESCRIPTION), 'Toum, whipped.');
        });
        await press('kitchen-recipe-editor-screen-save');

        await waitFor(() => {
            expect(repositories.kitchenAdmin.updateProduct).toHaveBeenCalledWith(SAUCE_ID, {
                lockVersion: 7,
                name: RECIPE.name,
                description: { en: 'Toum, whipped.', ar: 'ثومية.' },
            });
        });
        expect(repositories.kitchenAdmin.setProductChannelAvailability).not.toHaveBeenCalled();
        expect(repositories.kitchenAdmin.setRecipeLines).not.toHaveBeenCalled();
        await untilVisible('kitchen-recipe-editor-screen-saved');
    });

    it('saves Packs & prices after the item’s text, on the lock that write left', async () => {
        // The text's write moves the item from 7 to 8; the packs write must send 8, read from
        // the cache when it is sent — not the 7 it opened on.
        let current = sauce();
        const { repositories } = await renderSauceRecipe(current, {
            getProduct: async () => current,
            updateProduct: async () => {
                current = sauce({ meta: meta({ lockVersion: 8 }) });
                return current;
            },
            getItemPacks: async () => saucePacks(current.meta.lockVersion),
            setItemPacks: async () => saucePacks(9),
        });

        await untilVisible('kitchen-recipe-editor-screen-header');
        await press('kitchen-recipe-tab-packaging');
        await untilVisible(PACK_HOME_PRICE);
        expect(screen.getByTestId(PACK_HOME_PRICE).props.value).toBe('3.00');
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(PACK_HOME_PRICE), '3.50');
        });

        await press('kitchen-recipe-tab-description');
        await untilVisible(DESCRIPTION);
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(DESCRIPTION), 'Toum, whipped.');
        });
        await press('kitchen-recipe-editor-screen-save');

        await waitFor(() => {
            expect(repositories.kitchenAdmin.setItemPacks).toHaveBeenCalledTimes(1);
        });
        const updateOrder = (repositories.kitchenAdmin.updateProduct as jest.Mock).mock
            .invocationCallOrder[0];
        const packsOrder = (repositories.kitchenAdmin.setItemPacks as jest.Mock).mock
            .invocationCallOrder[0];
        expect(updateOrder).toBeLessThan(packsOrder ?? 0);
        expect(repositories.kitchenAdmin.setItemPacks).toHaveBeenCalledWith(
            SAUCE_ID,
            expect.objectContaining({
                lockVersion: 8,
                places: { home: true, business: false, counter: false },
                packs: [
                    expect.objectContaining({
                        id: SAUCE_PACK,
                        prices: { home: 350, business: null },
                    }),
                ],
            }),
        );
        await untilVisible('kitchen-recipe-editor-screen-saved');
    });

    it('keeps a half-typed description through a tab switch, and marks the page unsaved', async () => {
        await renderSauceRecipe(sauce());

        await untilVisible('kitchen-recipe-editor-screen-header');
        await waitFor(() => {
            expect(screen.getByTestId(DESCRIPTION).props.value).toBe('Toum.');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(DESCRIPTION), 'Toum, whi');
        });

        await press('kitchen-recipe-tab-production');
        await press('kitchen-recipe-tab-description');
        await untilVisible(DESCRIPTION);
        expect(screen.getByTestId(DESCRIPTION).props.value).toBe('Toum, whi');

        expect(screen.getByTestId('kitchen-recipe-editor-screen-dirty')).toBeTruthy();
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
        // Nothing sells it, so there is no shop description and no diets to show.
        expect(screen.queryByTestId(DESCRIPTION)).toBeNull();
        expect(screen.queryByTestId('kitchen-recipe-diets')).toBeNull();
    });

    it('asks for no pieces produced, even on a meal’s recipe — the field is optional', async () => {
        await withDeskWidth(async () => {
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
            await press('kitchen-recipe-tab-production');
            await untilVisible('kitchen-recipe-yield-pieces-input');
            expect(screen.queryByTestId('kitchen-recipe-issues-publish-pieces')).toBeNull();
            expect(screen.queryByTestId('kitchen-recipe-check-pieces')).toBeNull();
        });
    });

    it('owes no piece count on a recipe only a sauce sells', async () => {
        await renderSauceRecipe(sauce());

        await untilVisible('kitchen-recipe-editor-screen-header');
        expect(screen.queryByTestId('kitchen-recipe-issues-publish-pieces')).toBeNull();
    });

    it('switches sellers above Packs & prices on a recipe sold twice', async () => {
        const { repositories } = await renderStubScreen(
            <RecipeBookEditScreen recipe={String(RECIPE_ID)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...pageReads(sauce(), soldAs(seller(), MEAL_SELLER)),
                        getMeal: async () => mealItem(),
                        getItemPacks: async () => saucePacks(7),
                    },
                },
            },
        );

        await untilVisible('kitchen-recipe-editor-screen-header');
        await press('kitchen-recipe-tab-packaging');

        // The first seller opens, with a switch naming each by its handle, or its slug without one.
        await untilVisible('kitchen-recipe-packs-seller');
        expect(
            screen.getByTestId(`kitchen-recipe-packs-seller-${String(SAUCE_ID)}`),
        ).toHaveTextContent(/SAC-044/);
        expect(
            screen.getByTestId(`kitchen-recipe-packs-seller-${String(MEAL_ID)}`),
        ).toHaveTextContent(/toum-bowl/);

        await press(`kitchen-recipe-packs-seller-${String(MEAL_ID)}`);

        await waitFor(() => {
            expect(repositories.kitchenAdmin.getItemPacks).toHaveBeenCalledWith(MEAL_ID);
        });
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

    it('opens a sauce with no recipe yet as the full recipe page, its description on Description', async () => {
        await renderSauceItem(sauce({ recipeId: null }));

        // Every tab, as the recipe it is about to become, named after the item.
        await untilVisible('kitchen-recipe-editor-screen-header');
        for (const tab of ['description', 'production', 'packaging', 'costing', 'sheet']) {
            expect(screen.getByTestId(`kitchen-recipe-tab-${tab}`)).toBeTruthy();
        }
        expect(screen.queryByTestId('kitchen-recipe-tab-selling')).toBeNull();
        expect(screen.getByTestId('kitchen-recipe-editor-screen-title')).toHaveTextContent(
            /Garlic sauce/,
        );
        await waitFor(() => {
            expect(screen.getByTestId(DESCRIPTION).props.value).toBe('Toum.');
        });
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

        // The recipe page's own Save writes the recipe, then links it to this item.
        await untilVisible('kitchen-recipe-editor-screen-save');
        await press('kitchen-recipe-editor-screen-save');

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
        // Opened directly, so there is no page behind it: the book, in place of this address.
        expect(routerMock.__replace).toHaveBeenCalledWith('/kitchen/recipes');
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('carries a stock gap’s fix and its way back through the hand-over to the recipe', async () => {
        const returnTo = '/kitchen/consumption-exceptions?reason=unquantified_recipe_line';
        await renderStubScreen(
            <CookedItemEditScreen
                item={String(SAUCE_ID)}
                kind="sauce"
                returnTo={returnTo}
                fix="unquantified_recipe_line"
                ingredient={String(GARLIC_ID)}
            />,
            {
                session: kitchenManagerSession(),
                repositories: { kitchenAdmin: pageReads(sauce()) },
            },
        );

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledTimes(1);
        });
        const href = String(routerMock.__replace.mock.calls[0]?.[0]);
        const [path, query = ''] = href.split('?');
        expect(path).toBe(`/kitchen/recipes/${String(RECIPE_ID)}`);
        const search = new URLSearchParams(query);
        expect(search.get('fix')).toBe('unquantified_recipe_line');
        expect(search.get('ingredient')).toBe(String(GARLIC_ID));
        // Encoded twice, as every `returnTo` is, so the route's own decode gives it back whole.
        expect(decodeURIComponent(search.get('returnTo') ?? '')).toBe(returnTo);
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
    it('opens a meal on its recipe, with the meal’s description on Description', async () => {
        await renderStubScreen(<RecipeBookEditScreen recipe={String(RECIPE_ID)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: mealReads(mealItem()) },
        });

        await untilVisible('kitchen-recipe-editor-screen-header');
        await waitFor(() => {
            expect(screen.getByTestId(DESCRIPTION).props.value).toBe('Garlic sauce and chicken.');
        });
        expect(screen.queryByTestId('kitchen-recipe-tab-selling')).toBeNull();
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

    it('opens a meal with no recipe yet as the full recipe page, its description on Description', async () => {
        await renderStubScreen(<CookedItemEditScreen item={String(MEAL_ID)} kind="meal" />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: mealReads(mealItem({ recipeId: null, recipeVersionId: null })),
            },
        });

        await untilVisible('kitchen-recipe-tab-production');
        expect(screen.queryByTestId('kitchen-recipe-tab-selling')).toBeNull();
        await waitFor(() => {
            expect(screen.getByTestId(DESCRIPTION).props.value).toBe('Garlic sauce and chicken.');
        });
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
