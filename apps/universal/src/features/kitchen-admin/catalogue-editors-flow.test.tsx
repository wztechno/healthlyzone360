import {
    apiFailure,
    conflictFailure,
    throwFailure,
    validationFailure,
} from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    CatalogueItemRef,
    IngredientAdmin,
    IngredientBarcode,
    IngredientCategoryAdmin,
    MealAdmin,
    MonthlyCostReportRow,
    PriceListAdmin,
    PriceListEntry,
    ProductAdmin,
    ProductPackVariant,
} from '@healthy360/api-client/contracts';
import { IngredientId, KitchenId, MealId, PriceListId, ProductId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { ExpoRouterMock } from '../../testing/expo-router-mock.ts';
import { TEST_ORGANISATION_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { priceItemKey } from './format.ts';
import { RecordFormOpening, focusFirstRefusal } from './record-form-opening.tsx';
import { CostReportScreen } from './screens/cost-report-screen.tsx';
import { IngredientBarcodeLabelScreen } from './screens/ingredient-barcode-label-screen.tsx';
import { IngredientEditScreen } from './screens/ingredient-edit-screen.tsx';
import { PackagingEditScreen } from './screens/packaging-edit-screen.tsx';
import { PriceListEditScreen } from './screens/price-list-edit-screen.tsx';
import { ProductEditScreen } from './screens/product-edit-screen.tsx';

/**
 * The single-page catalogue editors — ingredient, packaging, resale item, price list — and the two
 * pages beside them (the kitchen-code label and the cost report), as a reader who is led by the
 * page meets them:
 *
 * 1. **Save goes to the problem.** A blank the form catches and a field the server refuses both
 *    take the cursor to the first field concerned, in the order the page draws them.
 * 2. **The strips sit one above the other**, each the full width, and a notice is its title.
 * 3. **Back is a step back.** Cancel and every "Back to …" go back in history when there is
 *    somewhere to go, and open the list afresh only when there is not — never a fresh push that
 *    loses the list's filter and page.
 */

jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../testing/expo-router-mock.ts').createExpoRouterMock({ pathname: '/kitchen' }),
);

// The jump is asserted as the call: jsdom has no layout to scroll, and native no document.
jest.mock('./field-focus.ts', () => ({
    __esModule: true,
    focusField: jest.fn(),
    focusSection: jest.fn(),
}));

// Wide: the price grid and the cost report's table draw their desk layout from `md` up.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1280, height: 900, scale: 1, fontScale: 1 }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as ExpoRouterMock;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const focusMock = require('./field-focus.ts') as { focusField: jest.Mock };

beforeEach(() => {
    routerMock.__reset();
    focusMock.focusField.mockClear();
});

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
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

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'draft',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

const INGREDIENT_ID = IngredientId.unsafe('01935f6d-0000-7000-8000-000000000011');

function ingredient(overrides: Partial<IngredientAdmin> = {}): IngredientAdmin {
    return {
        id: INGREDIENT_ID,
        meta: meta(),
        name: { en: 'Burghul', ar: 'برغل' },
        slug: 'burghul',
        reference: 'ING-011',
        subcategoryCode: null,
        categoryCode: 'store-cupboard',
        measurementUnit: 'g',
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
        ...overrides,
    };
}

const CATEGORY_TREE: readonly IngredientCategoryAdmin[] = [
    {
        code: 'store-cupboard',
        name: { en: 'Store cupboard', ar: 'مؤونة' },
        parentCode: null,
        displayOrder: 1,
        isActive: true,
    },
];

function ingredientReads(record: IngredientAdmin) {
    return {
        listAllergenClasses: async () => [],
        listIngredients: async () => page([record]),
        listIngredientCategories: async () => CATEGORY_TREE,
        nextReference: async () => 'PKG-001',
        getIngredient: async () => record,
    };
}

const PRODUCT_ID = ProductId.unsafe('01935f6d-0000-7000-8000-0000000d0001');

function packVariant(
    code: string,
    overrides: Partial<ProductPackVariant> = {},
): ProductPackVariant {
    return {
        code,
        label: { en: code, ar: code },
        netQuantity: 250,
        netUnit: 'g',
        unitsPerPack: 1,
        ...overrides,
    };
}

function product(overrides: Partial<ProductAdmin> = {}): ProductAdmin {
    return {
        id: PRODUCT_ID,
        meta: meta(),
        name: { en: 'Pomegranate molasses', ar: 'دبس رمان' },
        description: { en: 'A jar of it.', ar: 'برطمان منه.' },
        categoryId: null,
        categoryCode: 'store-cupboard',
        itemType: 'product',
        reference: null,
        kitchenCategory: null,
        kitchenSubcategory: null,
        composition: null,
        kitchenId: KitchenId.unsafe('01935f6d-0000-7000-8000-00000000c001'),
        isMarketPriced: false,
        isAssorted: false,
        netContentQuantity: null,
        netContentUnitId: null,
        packVariants: [packVariant('JAR'), packVariant('TRAY', { unitsPerPack: 12 })],
        channelAvailability: [
            { channel: 'b2c', isAvailable: true, availableFrom: null, availableUntil: null },
        ],
        recipeId: null,
        dietClassifications: [],
        dataQualityFlags: [],
        imagePlaceholderId: 'product-1',
        ...overrides,
    };
}

function productReads(stored: ProductAdmin) {
    return {
        getProduct: async () => stored,
        listProducts: async () => page([stored]),
        listRecipes: async () => page([]),
    };
}

const KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000a001');

function mealRef(ordinal: number): CatalogueItemRef {
    return {
        kind: 'meal',
        mealId: MealId.unsafe(`01935f6d-0000-7000-8000-00000000c00${String(ordinal)}`),
    };
}

function meal(ordinal: number): MealAdmin {
    return {
        id: MealId.unsafe(`01935f6d-0000-7000-8000-00000000c00${String(ordinal)}`),
        meta: meta({ status: 'published' }),
        name: { en: `Meal ${String(ordinal)}`, ar: `وجبة ${String(ordinal)}` },
        description: { en: 'Served warm.', ar: 'يُقدَّم دافئًا.' },
        kitchenCategory: null,
        kitchenSubcategory: null,
        composition: null,
        kitchenId: KITCHEN_ID,
        recipeId: null,
        recipeVersionId: null,
        productionMode: null,
        ingredientId: null,
        sellsFromFinishedStock: false,
        netContentQuantity: null,
        netContentUnitId: null,
        portionFactor: 1,
        mealTypes: ['lunch'],
        dietClassifications: [],
        allergens: [],
        channelAvailability: [],
        availability: [],
        imagePlaceholderId: `meal-${String(ordinal)}`,
        marginPercent: null,
    };
}

function priceEntry(item: CatalogueItemRef, amountMinor: number): PriceListEntry {
    return {
        item,
        priceStatus: 'confirmed',
        amountMinor,
        effectiveFrom: '2026-07-27',
        effectiveUntil: null,
        note: null,
    };
}

/** Sold under an agreement, so its meal prices are edited here rather than on the meal. */
const PRICE_LIST: PriceListAdmin = {
    id: PriceListId.unsafe('01935f6d-0000-7000-8000-00000000d001'),
    meta: meta({ lockVersion: 3 }),
    name: { en: 'Verdant Kitchen tariff', ar: 'تعرفة مطبخ فيردانت' },
    currency: 'USD',
    kitchenId: KITCHEN_ID,
    channels: ['b2b'],
    entries: [priceEntry(mealRef(1), 1250), priceEntry(mealRef(2), 990)],
};

function priceListReads(list: PriceListAdmin = PRICE_LIST) {
    return {
        listProducts: async () => page([]),
        listMeals: async () => page([meal(1), meal(2)]),
        listPlans: async () => page([]),
        getPriceList: async () => list,
    };
}

/** The grid's id for a seeded row: its place in the saved list and the thing it prices. */
function priceRow(index: number): string {
    return `kitchen-price-list-entries-row-seed-${String(index)}-${priceItemKey(
        PRICE_LIST.entries[index]!.item,
    )}`;
}

function costRow(overrides: Partial<MonthlyCostReportRow> = {}): MonthlyCostReportRow {
    return {
        month: '2026-08',
        currencyCode: 'USD',
        spendAmount: '1200.00',
        cogsAmount: '800.00',
        wasteAmount: null,
        wasteQuantity: null,
        revenueAmount: '2000.00',
        grossMarginAmount: '1200.00',
        grossMarginPercent: '60.0',
        mealRevenueAmount: '1500.00',
        productRevenueAmount: '500.00',
        otherRevenueAmount: '0.00',
        mealCogsAmount: '600.00',
        productCogsAmount: '200.00',
        otherCogsAmount: '0.00',
        hasDataQualityFlag: false,
        exceptionCount: 0,
        isSpendComplete: true,
        unpricedLineCount: 0,
        valuationPendingLineCount: 0,
        productionConsumptionAmount: '0.00',
        productionWasteAmount: '0.00',
        productionYieldValueAmount: '0.00',
        estimatedCogsAmount: null,
        estimatedMarginAmount: null,
        estimatedMarginPercent: null,
        unestimatedLineCount: 0,
        isEstimateComplete: true,
        isProductionValuationComplete: true,
        unvaluedBatchCount: 0,
        ...overrides,
    };
}

/* ------------------------------------------------------------------------------------------------
 * The opening and the jump
 * ---------------------------------------------------------------------------------------------- */

describe('the record opening', () => {
    it('stacks the error and warning strips, each on a line of its own', async () => {
        await renderStubScreen(
            <RecordFormOpening
                testID="opening"
                title="Supplier"
                dirty={false}
                errors={{
                    summary: '1 required',
                    items: [{ key: 'name', label: 'Name', onPress: jest.fn() }],
                }}
                warnings={{
                    summary: '1 warning',
                    items: [{ key: 'email', label: 'Email', onPress: jest.fn() }],
                }}
            />,
            { session: kitchenManagerSession() },
        );

        await untilVisible('opening-issues');
        expect(screen.getByTestId('opening-issues').props.className).toContain('flex-col');
        expect(screen.getByTestId('opening-issues-errors')).toBeTruthy();
        expect(screen.getByTestId('opening-issues-warnings')).toBeTruthy();
    });
});

describe('focusFirstRefusal', () => {
    const targets = {
        name_en: { label: 'Name (EN)', fieldId: 'field-name-en' },
        name_ar: { label: 'Name (AR)', fieldId: 'field-name-ar' },
        'lines.*.quantity': { label: 'Quantity', fieldId: 'field-lines' },
    };

    it('goes to the first refused field in the order the form draws them', () => {
        const went = focusFirstRefusal(
            validationFailure({
                'lines.1.quantity': ['Enter a quantity.'],
                name_ar: ['The Arabic name is too long.'],
            }),
            targets,
        );

        expect(went).toBe(true);
        expect(focusMock.focusField).toHaveBeenCalledTimes(1);
        expect(focusMock.focusField).toHaveBeenCalledWith('field-name-ar');
    });

    it('reaches a row the form describes by wildcard', () => {
        focusFirstRefusal(
            validationFailure({ 'lines.3.quantity': ['Enter a quantity.'] }),
            targets,
        );
        expect(focusMock.focusField).toHaveBeenCalledWith('field-lines');
    });

    it('stays put for a refusal that names no field it knows, and for anything else', () => {
        expect(focusFirstRefusal(validationFailure({ other: ['No.'] }), targets)).toBe(false);
        expect(focusFirstRefusal(conflictFailure({ currentLockVersion: 2 }), targets)).toBe(false);
        expect(focusFirstRefusal(apiFailure('server'), targets)).toBe(false);
        expect(focusMock.focusField).not.toHaveBeenCalled();
    });
});

/* ------------------------------------------------------------------------------------------------
 * The ingredient and packaging editor
 * ---------------------------------------------------------------------------------------------- */

describe('the ingredient editor', () => {
    it('Cancel goes back a step when there is one', async () => {
        routerMock.__set({ canGoBack: true });
        const record = ingredient();
        await renderStubScreen(<IngredientEditScreen ingredient={String(record.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: ingredientReads(record) },
        });
        await untilVisible('kitchen-ingredient-name-en-input');

        await press('kitchen-ingredient-editor-screen-back');

        expect(routerMock.__router.back).toHaveBeenCalledTimes(1);
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('Cancel opens the list when nothing is behind the page', async () => {
        const record = ingredient();
        await renderStubScreen(<IngredientEditScreen ingredient={String(record.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: ingredientReads(record) },
        });
        await untilVisible('kitchen-ingredient-name-en-input');

        await press('kitchen-ingredient-editor-screen-back');

        expect(routerMock.__replace).toHaveBeenCalledWith('/kitchen/ingredients');
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('takes Save over a blank to the field, which says so itself', async () => {
        const record = ingredient();
        const { repositories } = await renderStubScreen(
            <IngredientEditScreen ingredient={String(record.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: { kitchenAdmin: ingredientReads(record) },
            },
        );
        await untilVisible('kitchen-ingredient-name-en-input');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-ingredient-name-en-input'), '');
        });
        await press('kitchen-ingredient-editor-screen-save');

        expect(focusMock.focusField).toHaveBeenCalledWith('kitchen-ingredient-name-en');
        await untilVisible('kitchen-ingredient-issues');
        expect(screen.getByTestId('kitchen-ingredient-issues').props.className).toContain(
            'flex-col',
        );
        expect(screen.getByTestId('kitchen-ingredient-name-en-error')).toBeTruthy();
        expect(repositories.kitchenAdmin.updateIngredient).not.toHaveBeenCalled();
    });

    it('takes a refused save to the first field the server named', async () => {
        const record = ingredient();
        await renderStubScreen(<IngredientEditScreen ingredient={String(record.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...ingredientReads(record),
                    updateIngredient: async () =>
                        throwFailure(
                            validationFailure({
                                ingredient_subcategory_id: ['That sub-category is retired.'],
                                name_ar: ['The Arabic name is too long.'],
                            }),
                        ),
                },
            },
        });
        await untilVisible('kitchen-ingredient-name-en-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredient-name-en-input'),
                'Burghul, coarse',
            );
        });
        await press('kitchen-ingredient-editor-screen-save');

        await waitFor(() => {
            expect(focusMock.focusField).toHaveBeenCalledWith('kitchen-ingredient-name-ar');
        });
        expect(focusMock.focusField).not.toHaveBeenCalledWith('kitchen-ingredient-subcategory');
    });

    it('says a not-found link in its title alone, and goes back from it', async () => {
        await renderStubScreen(<IngredientEditScreen ingredient="not-a-uuid" />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: ingredientReads(ingredient()) },
        });
        await untilVisible('kitchen-ingredient-not-found');
        expect(screen.getByTestId('kitchen-ingredient-not-found')).not.toHaveTextContent(
            /out of date/,
        );

        await press('kitchen-ingredient-not-found-back');
        expect(routerMock.__replace).toHaveBeenCalledWith('/kitchen/ingredients');
    });

    it('gathers the notices into the issue tray', async () => {
        const record = ingredient({ meta: meta({ status: 'review_required' }) });
        await renderStubScreen(<IngredientEditScreen ingredient={String(record.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: ingredientReads(record) },
        });
        await untilVisible('kitchen-ingredient-quarantine');

        expect(screen.getByTestId('kitchen-ingredient-tray')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-ingredient-notices')).toBeNull();
        expect(screen.getByTestId('kitchen-ingredient-quarantine')).not.toHaveTextContent(
            /contradicts a published label/,
        );
    });
});

describe('the packaging editor', () => {
    it('Cancel falls back to the packaging list, not the ingredients', async () => {
        const record = ingredient({
            categoryCode: 'packaging-disposables',
            measurementUnit: 'piece',
            name: { en: 'Kraft box', ar: 'علبة كرافت' },
        });
        await renderStubScreen(<PackagingEditScreen item={String(record.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: ingredientReads(record) },
        });
        await untilVisible('kitchen-ingredient-name-en-input');

        await press('kitchen-ingredient-editor-screen-back');

        expect(routerMock.__replace).toHaveBeenCalledWith('/kitchen/packaging');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The resale item editor
 * ---------------------------------------------------------------------------------------------- */

describe('the resale item editor', () => {
    it('Cancel goes back a step when there is one', async () => {
        routerMock.__set({ canGoBack: true });
        const stored = product();
        await renderStubScreen(<ProductEditScreen product={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: productReads(stored) },
        });
        await untilVisible('kitchen-product-name-en-input');

        await press('kitchen-product-editor-screen-back');

        expect(routerMock.__router.back).toHaveBeenCalledTimes(1);
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('takes a refused pack to its own cell rather than to the table', async () => {
        const stored = product();
        await renderStubScreen(<ProductEditScreen product={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...productReads(stored),
                    updateProduct: async () =>
                        throwFailure(
                            validationFailure({
                                'variants.1.pack.pack_quantity': [
                                    'The pack quantity must be greater than 0.',
                                ],
                            }),
                        ),
                },
            },
        });
        await untilVisible('kitchen-product-name-en-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-product-name-en-input'),
                'Pomegranate molasses, thick',
            );
        });
        await press('kitchen-product-editor-screen-save');

        await waitFor(() => {
            expect(focusMock.focusField).toHaveBeenCalledWith(
                'kitchen-product-pack-editor-row-seed-1-TRAY-quantity',
            );
        });
        await untilVisible('kitchen-product-issues');
        expect(screen.getByTestId('kitchen-product-issues').props.className).toContain('flex-col');
    });

    it('says a refused publish on the page once its dialog has closed', async () => {
        const stored = product();
        await renderStubScreen(<ProductEditScreen product={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...productReads(stored),
                    publishProduct: async () =>
                        throwFailure(
                            validationFailure({}, { message: 'This item is not ready yet.' }),
                        ),
                },
            },
        });
        await untilVisible('kitchen-product-publish');

        await press('kitchen-product-publish');
        await untilVisible('kitchen-product-publish-confirm');
        await press('kitchen-product-publish-confirm');

        await untilVisible('kitchen-product-publish-error');
        expect(screen.getByTestId('kitchen-product-publish-error')).toHaveTextContent(
            /not ready yet/,
        );
    });
});

/* ------------------------------------------------------------------------------------------------
 * The price list editor
 * ---------------------------------------------------------------------------------------------- */

describe('the price list editor', () => {
    it('Back goes back a step when there is one, and opens the list otherwise', async () => {
        routerMock.__set({ canGoBack: true });
        await renderStubScreen(<PriceListEditScreen priceList={String(PRICE_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: priceListReads() },
        });
        await untilVisible('kitchen-price-list-editor-screen-back');

        await press('kitchen-price-list-editor-screen-back');
        expect(routerMock.__router.back).toHaveBeenCalledTimes(1);

        routerMock.__set({ canGoBack: false });
        await press('kitchen-price-list-editor-screen-back');
        expect(routerMock.__replace).toHaveBeenCalledWith('/kitchen/price-lists');
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('takes Save over an emptied amount to that amount', async () => {
        const { repositories } = await renderStubScreen(
            <PriceListEditScreen priceList={String(PRICE_LIST.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: { kitchenAdmin: priceListReads() },
            },
        );
        await untilVisible(`${priceRow(1)}-amount-input`);

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${priceRow(1)}-amount-input`), '');
        });
        await press('kitchen-price-list-editor-screen-save');

        expect(focusMock.focusField).toHaveBeenCalledWith(`${priceRow(1)}-amount`);
        expect(repositories.kitchenAdmin.setPriceListEntries).not.toHaveBeenCalled();
    });

    it('takes a refused save to the row the server named', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(PRICE_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...priceListReads(),
                    setPriceListEntries: async () =>
                        throwFailure(
                            validationFailure({
                                'entries.1.unit_amount_minor': ['That amount is too large.'],
                            }),
                        ),
                },
            },
        });
        await untilVisible(`${priceRow(0)}-amount-input`);

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${priceRow(0)}-amount-input`), '13.00');
        });
        await press('kitchen-price-list-editor-screen-save');

        await waitFor(() => {
            expect(focusMock.focusField).toHaveBeenCalledWith(`${priceRow(1)}-amount`);
        });
    });

    it('opens on one band of notice titles', async () => {
        await renderStubScreen(<PriceListEditScreen priceList={String(PRICE_LIST.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: priceListReads() },
        });
        await untilVisible('kitchen-price-list-notices');

        expect(screen.getByTestId('kitchen-price-list-draft-note')).not.toHaveTextContent(
            /Nobody is charged/,
        );
        expect(screen.getByTestId('kitchen-price-list-confidential')).not.toHaveTextContent(
            /buyer relationship/,
        );
        expect(screen.queryByTestId('kitchen-price-list-offline')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * The kitchen-code label
 * ---------------------------------------------------------------------------------------------- */

describe('the kitchen-code label', () => {
    function labelReads() {
        return {
            kitchenAdmin: { getIngredient: async () => ingredient() },
            kitchenOps: {
                listIngredientBarcodes: async (): Promise<readonly IngredientBarcode[]> => [
                    {
                        id: 'barcode-1',
                        ingredientId: INGREDIENT_ID,
                        gtin: '00400000000015',
                        origin: 'system',
                        packQuantity: null,
                        packUnitCode: null,
                        createdAt: null,
                    },
                ],
            },
        };
    }

    it('goes back to the ingredient it was opened from', async () => {
        routerMock.__set({ canGoBack: true });
        await renderStubScreen(
            <IngredientBarcodeLabelScreen ingredient={String(INGREDIENT_ID)} />,
            {
                session: kitchenManagerSession(),
                repositories: labelReads(),
            },
        );
        await untilVisible('kitchen-ingredient-label-back');

        await press('kitchen-ingredient-label-back');

        expect(routerMock.__router.back).toHaveBeenCalledTimes(1);
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('opens the ingredient when nothing is behind the label', async () => {
        await renderStubScreen(
            <IngredientBarcodeLabelScreen ingredient={String(INGREDIENT_ID)} />,
            {
                session: kitchenManagerSession(),
                repositories: labelReads(),
            },
        );
        await untilVisible('kitchen-ingredient-label-back');

        await press('kitchen-ingredient-label-back');

        expect(routerMock.__replace).toHaveBeenCalledWith(
            `/kitchen/ingredients/${String(INGREDIENT_ID)}`,
        );
    });
});

/* ------------------------------------------------------------------------------------------------
 * The cost report
 * ---------------------------------------------------------------------------------------------- */

describe('the cost report', () => {
    it('reads its range from the address, so Back returns to the same months', async () => {
        routerMock.__set({ params: { from: '2026-03-01', to: '2026-08-31' } });
        const { repositories } = await renderStubScreen(<CostReportScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { listCostReport: async () => [costRow()] } },
        });
        await untilVisible('kitchen-cost-report-table');

        expect(repositories.kitchenOps.listCostReport).toHaveBeenCalledWith({
            from: '2026-03',
            to: '2026-08',
        });
    });

    it('opens a month by writing it to the address, and shows the month the address names', async () => {
        await renderStubScreen(<CostReportScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { listCostReport: async () => [costRow()] } },
        });
        await untilVisible('kitchen-cost-report-table-row-2026-08-USD');

        await press('kitchen-cost-report-table-row-2026-08-USD');
        expect(routerMock.__router.setParams).toHaveBeenCalledWith({ month: '2026-08' });

        await act(async () => {
            routerMock.__set({ params: { month: '2026-08' } });
        });
        await untilVisible('kitchen-cost-report-window');
    });

    it('states both shortfalls as titles in one band, the spend with its months', async () => {
        await renderStubScreen(<CostReportScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listCostReport: async () => [
                        costRow({
                            hasDataQualityFlag: true,
                            exceptionCount: 2,
                            isSpendComplete: false,
                            unpricedLineCount: 3,
                        }),
                    ],
                },
            },
        });
        await untilVisible('kitchen-cost-report-notices');

        expect(screen.getByTestId('kitchen-cost-report-data-quality')).not.toHaveTextContent(
            /unresolved consumption exceptions/,
        );
        expect(screen.getByTestId('kitchen-cost-report-open-exceptions')).toBeTruthy();
        expect(screen.getByTestId('kitchen-cost-report-spend-quality')).toHaveTextContent(
            /2026-08/,
        );
        expect(screen.getByTestId('kitchen-cost-report-spend-quality')).not.toHaveTextContent(
            /purchases ledger/,
        );
    });
});
