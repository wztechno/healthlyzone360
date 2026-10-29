import { throwFailure, validationFailure } from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    IngredientAdmin,
    RecipeAdmin,
    RecipeLine,
    RecipeRollupPreview,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import { IngredientId, KitchenId, RecipeId } from '@healthy360/domain-types';
import type { RecipeVersionId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Dimensions } from 'react-native';

import { readActiveProcess, startProcess } from '../../navigation/active-process.ts';
import { TEST_ORGANISATION_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { focusField } from './field-focus.ts';
import {
    parseStockGapFix,
    stockGapFieldId,
    stockGapFieldMessageKey,
} from './recipe-stock-gap-fix.ts';
import { RecipeEditScreen } from './screens/recipe-edit-screen.tsx';
import type { RecipeEditScreenProps } from './screens/recipe-edit-screen.tsx';

/**
 * The recipe editor leading its reader — kitchen staff who should never have to hunt for what is
 * wrong or for the way back.
 *
 * 1. **Every problem is at its field.** No step bar and no list under the header: Save draft is in
 *    the header on every tab, a press that cannot be sent opens the tab of the first problem and
 *    puts the cursor in it, and a server refusal does the same with the first field it named.
 * 2. **Stock gaps → fix in recipe → back.** The page opens on the field at fault, marks the line,
 *    names the gap in one strip, and returns to the exact Stock gaps view — saying, once published,
 *    that the gap was fixed.
 *
 * `focusField` is mocked: on the test platform it is a no-op (there is no document to search), and
 * which element the editor asked for is the thing worth asserting.
 */

jest.mock('./field-focus.ts', () => ({ focusField: jest.fn(), focusSection: jest.fn() }));

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    const back = jest.fn();
    const dismissTo = jest.fn();
    const canGoBack = jest.fn(() => true);
    return {
        __esModule: true,
        useRouter: () => ({
            push,
            replace,
            back,
            canGoBack,
            dismissTo,
            setParams: jest.fn(),
            prefetch: jest.fn(),
        }),
        usePathname: () => '/kitchen/recipes',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __back: back,
        __dismissTo: dismissTo,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as {
    __push: jest.Mock;
    __back: jest.Mock;
    __dismissTo: jest.Mock;
};

const focusMock = focusField as jest.Mock;

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__back.mockClear();
    routerMock.__dismissTo.mockClear();
    focusMock.mockClear();
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

async function type(testID: string, text: string) {
    await act(async () => {
        fireEvent.changeText(screen.getByTestId(testID), text);
    });
}

function tabLabel(tab: string): unknown {
    return screen.getByTestId(`kitchen-recipe-tab-${tab}`).props.accessibilityLabel;
}

function isSelected(tab: string): boolean {
    return screen.getByTestId(`kitchen-recipe-tab-${tab}`).props.accessibilityState.selected;
}

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 * ---------------------------------------------------------------------------------------------- */

const KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000c001');
const RECIPE_ID = RecipeId.unsafe('01935f6d-0000-7000-8000-0000000b0007');
const VERSION_ID = '01935f6d-0000-7000-8000-0000000e0007' as RecipeVersionId;

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'draft',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

function ingredient(ordinal: number, name: string): IngredientAdmin {
    return {
        id: IngredientId.unsafe(`01935f6d-0000-7000-8000-0000000a000${String(ordinal)}`),
        meta: meta({ status: 'published' }),
        name: { en: name, ar: `${name} بالعربية` },
        slug: name.toLocaleLowerCase(),
        reference: `IG-00${String(ordinal)}`,
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
        // Assessed, so the publish dialog has nothing to say about it.
        allergensAssessedClear: true,
        dietClassifications: [],
        aliases: [],
        organisationId: TEST_ORGANISATION_ID,
        forkedFromId: null,
        isEditable: true,
        notes: null,
    };
}

const BURGHUL = ingredient(1, 'Burghul');
const OLIVE_OIL = ingredient(2, 'Olive oil');
const LIBRARY: readonly IngredientAdmin[] = [BURGHUL, OLIVE_OIL];

function line(source: IngredientAdmin, quantity: number): RecipeLine {
    return {
        ingredientId: source.id,
        ingredientName: source.name,
        quantity,
        unit: 'g',
        sourceDesignation: null,
        isOptional: false,
        lineCost: null,
    };
}

function version(overrides: Partial<RecipeVersionAdmin> = {}): RecipeVersionAdmin {
    return {
        id: VERSION_ID,
        recipeId: RECIPE_ID,
        versionNumber: 1,
        status: 'draft',
        yieldQuantity: 4,
        yieldUnit: 'kg',
        yieldPieces: null,
        wastePercent: 0,
        packagingWastePercent: 0,
        b2bPrice: null,
        b2cPrice: null,
        packaging: [],
        lines: [line(BURGHUL, 200), line(OLIVE_OIL, 30)],
        outputs: [],
        steps: [],
        allergens: [],
        estimatedCost: null,
        derivationStale: false,
        publishedAt: null,
        ...overrides,
    };
}

function recipe(current: RecipeVersionAdmin = version(), status = current.status): RecipeAdmin {
    return {
        id: RECIPE_ID,
        meta: meta({ status, lockVersion: 2 }),
        name: { en: 'Mujaddara', ar: 'مجدرة' },
        slug: 'mujaddara',
        reference: 'RC-0007',
        kitchenId: KITCHEN_ID,
        sourceKind: null,
        recipeCategory: null,
        currentVersionNumber: current.versionNumber,
        versionCount: current.versionNumber,
        currentVersionStatus: current.status,
        allergenCodes: [],
        lineCount: current.lines.length,
        kinds: ['preparation'],
        soldAs: [],
        description: { en: '', ar: '' },
        shelfLifeDays: null,
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

function reads(record: () => RecipeAdmin) {
    return {
        getRecipe: async () => record(),
        listIngredients: async () => page(LIBRARY),
        getIngredient: async (id: IngredientId) => {
            const found = LIBRARY.find((entry) => entry.id === id);
            if (found === undefined) throw new Error('No such ingredient.');
            return found;
        },
        previewRecipeRollup: async () => NO_PREVIEW,
    };
}

function renderEditor(
    props: Partial<RecipeEditScreenProps>,
    record: () => RecipeAdmin,
    writes: Record<string, unknown> = {},
) {
    return renderStubScreen(<RecipeEditScreen recipe={String(RECIPE_ID)} {...props} />, {
        session: kitchenManagerSession(),
        repositories: { kitchenAdmin: { ...reads(record), ...writes } },
    });
}

const RETURN_TO = '/kitchen/consumption-exceptions?reason=unquantified_recipe_line&page=2';

/* ------------------------------------------------------------------------------------------------
 * The stock-gap contract, as data
 * ---------------------------------------------------------------------------------------------- */

describe('reading a stock gap’s fix', () => {
    it('takes the four reasons a recipe fixes, and nothing else', () => {
        expect(parseStockGapFix('no_yield_piece_count', undefined)).toEqual({
            reason: 'no_yield_piece_count',
            ingredientId: null,
        });
        expect(parseStockGapFix(['unquantified_recipe_line'], String(OLIVE_OIL.id))).toEqual({
            reason: 'unquantified_recipe_line',
            ingredientId: String(OLIVE_OIL.id),
        });
        // An ingredient that is not an id is dropped rather than trusted.
        expect(parseStockGapFix('unit_conversion_unsupported', 'olive-oil')).toEqual({
            reason: 'unit_conversion_unsupported',
            ingredientId: null,
        });
        expect(parseStockGapFix('insufficient_stock', undefined)).toBeNull();
        expect(parseStockGapFix(undefined, String(OLIVE_OIL.id))).toBeNull();
    });

    it('names the field each reason is fixed in', () => {
        const cell = (id: string) => `cell-${id}`;
        expect(stockGapFieldId({ reason: 'no_yield_piece_count', ingredientId: null }, cell)).toBe(
            'kitchen-recipe-yield-pieces',
        );
        expect(stockGapFieldId({ reason: 'no_recipe_version', ingredientId: null }, cell)).toBe(
            'kitchen-recipe-publish',
        );
        expect(
            stockGapFieldId({ reason: 'unquantified_recipe_line', ingredientId: 'x' }, cell),
        ).toBe('cell-x');
        expect(
            stockGapFieldId({ reason: 'unit_conversion_unsupported', ingredientId: null }, cell),
        ).toBeNull();
        expect(stockGapFieldMessageKey('no_recipe_version')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Errors at the field
 * ---------------------------------------------------------------------------------------------- */

describe('errors at the field', () => {
    it('has no step bar, and Save draft is on the first tab', async () => {
        await renderEditor({}, () => recipe());

        await untilVisible('kitchen-recipe-name-en-input');
        expect(isSelected('description')).toBe(true);
        expect(screen.queryByTestId('kitchen-recipe-steps-nav')).toBeNull();
        expect(screen.getByTestId('kitchen-recipe-editor-screen-save')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-recipe-issues')).toBeNull();
    });

    it('takes a refused save to the first field the server named, and says it there', async () => {
        const stored = recipe();
        const { repositories } = await renderEditor({}, () => stored, {
            updateRecipe: async () =>
                throwFailure(
                    validationFailure({
                        yield_piece_count: ['The pieces produced must be at least 1.'],
                    }),
                ),
        });

        await untilVisible('kitchen-recipe-name-en-input');
        await type('kitchen-recipe-name-en-input', 'Mujadara');
        await press('kitchen-recipe-editor-screen-save');

        await waitFor(() => {
            expect(repositories.kitchenAdmin.updateRecipe).toHaveBeenCalledTimes(1);
        });
        await untilVisible('kitchen-recipe-yield-pieces-error');
        expect(isSelected('production')).toBe(true);
        expect(screen.getByTestId('kitchen-recipe-yield-pieces-error')).toHaveTextContent(
            'The pieces produced must be at least 1.',
        );
        expect(tabLabel('production')).toBe('Production, 1 to fix');
        expect(focusMock).toHaveBeenLastCalledWith('kitchen-recipe-yield-pieces');
        // Placed on its field, so nothing else repeats it.
        expect(screen.queryByTestId('kitchen-recipe-save-error')).toBeNull();
    });

    it('takes a refused line to its own cell, by the position it was sent at', async () => {
        const stored = recipe();
        await renderEditor({}, () => stored, {
            setRecipeLines: async () =>
                throwFailure(
                    validationFailure({ 'lines.1.quantity': ['The quantity is too large.'] }),
                ),
        });

        await untilVisible('kitchen-recipe-name-en-input');
        await press('kitchen-recipe-tab-production');
        await untilVisible('kitchen-recipe-lines-table-row-line-1-qty');
        await type('kitchen-recipe-lines-table-row-line-1-qty', '99999');
        await press('kitchen-recipe-tab-sheet');
        await press('kitchen-recipe-editor-screen-save');

        await untilVisible('kitchen-recipe-lines-table-row-line-1-error');
        expect(isSelected('production')).toBe(true);
        expect(screen.getByTestId('kitchen-recipe-lines-table-row-line-1-error')).toHaveTextContent(
            /The quantity is too large\./,
        );
        expect(focusMock).toHaveBeenLastCalledWith('kitchen-recipe-lines-table-row-line-1-qty');
        expect(tabLabel('production')).toBe('Production, 1 to fix');
    });

    it('stops on a raw material with no quantity, and says so under its cell', async () => {
        const stored = recipe();
        const { repositories } = await renderEditor({}, () => stored, {
            setRecipeLines: async () => stored,
        });

        await untilVisible('kitchen-recipe-name-en-input');
        await press('kitchen-recipe-tab-production');
        await untilVisible('kitchen-recipe-lines-table-row-line-1-qty');

        // A blank is only called out once Save is pressed.
        await type('kitchen-recipe-lines-table-row-line-1-qty', '');
        expect(screen.queryByTestId('kitchen-recipe-lines-table-row-line-1-qty-error')).toBeNull();

        await press('kitchen-recipe-tab-description');
        await press('kitchen-recipe-editor-screen-save');

        // The notice names it; Show me switches to its tab and into the cell.
        await untilVisible('kitchen-recipe-tray-blocked');
        expect(screen.getByTestId('kitchen-recipe-tray-blocked-list')).toHaveTextContent(
            /Raw materials/,
        );
        await press('kitchen-recipe-tray-blocked-show-me');

        await untilVisible('kitchen-recipe-lines-table-row-line-1-qty-error');
        await waitFor(() => {
            expect(isSelected('production')).toBe(true);
        });
        expect(
            screen.getByTestId('kitchen-recipe-lines-table-row-line-1-qty-error'),
        ).toHaveTextContent('Enter a quantity');
        expect(tabLabel('production')).toBe('Production, 1 to fix');
        expect(focusMock).toHaveBeenLastCalledWith('kitchen-recipe-lines-table-row-line-1-qty');
        expect(repositories.kitchenAdmin.setRecipeLines).not.toHaveBeenCalled();
    });

    it('flags a quantity that is not a number as it is typed', async () => {
        await renderEditor({}, () => recipe());

        await untilVisible('kitchen-recipe-name-en-input');
        await press('kitchen-recipe-tab-production');
        await untilVisible('kitchen-recipe-lines-table-row-line-0-qty');
        await type('kitchen-recipe-lines-table-row-line-0-qty', 'abc');

        await untilVisible('kitchen-recipe-lines-table-row-line-0-qty-error');
        expect(tabLabel('production')).toBe('Production, 1 to fix');
    });

    it('answers Publish over a blocked draft with a notice whose Show me leads to the field', async () => {
        await renderEditor({}, () => recipe());

        await untilVisible('kitchen-recipe-name-en-input');
        await type('kitchen-recipe-name-en-input', '');
        await press('kitchen-recipe-tab-production');
        await press('kitchen-recipe-publish');

        // Not the publish dialog: a notice naming what stops the save the publish needs first.
        await untilVisible('kitchen-recipe-tray-blocked');
        expect(screen.getByTestId('kitchen-recipe-tray-blocked-title')).toHaveTextContent(
            '1 thing before saving',
        );
        expect(screen.queryByTestId('kitchen-recipe-publish-consequence')).toBeNull();

        await press('kitchen-recipe-tray-blocked-show-me');
        await waitFor(() => {
            expect(focusMock).toHaveBeenLastCalledWith('kitchen-recipe-name-en');
        });
        expect(isSelected('description')).toBe(true);
        expect(screen.queryByTestId('kitchen-recipe-tray-blocked')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Stock gaps → fix in recipe → back
 * ---------------------------------------------------------------------------------------------- */

describe('a recipe opened from a stock gap', () => {
    /*
     * At a desk's width, where the issue tray is docked beside the page and open: the stock gap is
     * a card in it now, not a strip above the tabs. Below `lg` the tray is a closed bottom sheet.
     */
    const narrowWindow = Dimensions.get('window');
    const narrowScreen = Dimensions.get('screen');
    beforeAll(() => {
        Dimensions.set({
            window: { ...narrowWindow, width: 1440, height: 900 },
            screen: { ...narrowScreen, width: 1440, height: 900 },
        });
    });
    afterAll(() => {
        Dimensions.set({ window: narrowWindow, screen: narrowScreen });
    });

    it('opens on the line at fault, marks it, names the gap, and goes back to the same view', async () => {
        const stored = recipe(version({ lines: [line(BURGHUL, 200), line(OLIVE_OIL, 0)] }));
        await renderEditor(
            {
                returnTo: RETURN_TO,
                stockGapFix: {
                    reason: 'unquantified_recipe_line',
                    ingredientId: String(OLIVE_OIL.id),
                },
            },
            () => stored,
        );

        await untilVisible('kitchen-recipe-lines-table-row-line-1-qty');
        expect(isSelected('production')).toBe(true);
        await waitFor(() => {
            expect(focusMock).toHaveBeenCalledWith('kitchen-recipe-lines-table-row-line-1-qty');
        });

        // The tray's card names the gap and the line; the line says what to do and carries the mark.
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-recipe-stock-gap')).toHaveTextContent(
                /Stock gap to fix: Recipe line has no quantity — Olive oil/,
            );
        });
        expect(
            screen.getByTestId('kitchen-recipe-lines-table-row-line-1-qty-error'),
        ).toHaveTextContent('Enter a quantity');
        expect(
            screen.getByTestId('kitchen-recipe-lines-table-row-line-1-flag', {
                includeHiddenElements: true,
            }),
        ).toBeTruthy();
        expect(tabLabel('production')).toBe('Production, 1 to fix');

        // Typing the quantity clears the field's message and the count.
        await type('kitchen-recipe-lines-table-row-line-1-qty', '25');
        await waitFor(() => {
            expect(
                screen.queryByTestId('kitchen-recipe-lines-table-row-line-1-qty-error'),
            ).toBeNull();
        });
        expect(tabLabel('production')).toBe('Production');

        // Back is the exact Stock gaps view it came from — through the unsaved guard.
        await press('kitchen-recipe-stock-gap-back');
        await untilVisible('kitchen-recipe-editor-screen-unsaved-dialog');
        await press('kitchen-recipe-editor-screen-unsaved-discard');
        await waitFor(() => {
            expect(routerMock.__dismissTo).toHaveBeenCalledWith(RETURN_TO);
        });
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('offers the way back once published, telling Stock gaps the gap was fixed', async () => {
        // Sent here by Stock gaps: the fix is the process the top bar's Continue keeps.
        startProcess({
            kind: 'stockGapFix',
            subject: 'Lentil Soup',
            resumeHref: `/kitchen/recipes/${String(RECIPE_ID)}`,
            originPath: '/kitchen/consumption-exceptions',
            stepPaths: [`/kitchen/recipes/${String(RECIPE_ID)}`],
        });
        let stored = recipe();
        const { repositories } = await renderEditor(
            {
                returnTo: RETURN_TO,
                stockGapFix: { reason: 'no_yield_piece_count', ingredientId: null },
            },
            () => stored,
            {
                updateRecipe: async () => {
                    stored = recipe(version({ yieldPieces: 12 }));
                    return stored;
                },
                publishRecipe: async () => {
                    const published = version({
                        status: 'published',
                        publishedAt: '2026-08-03T09:00:00.000Z',
                    });
                    stored = {
                        ...recipe(published),
                        meta: meta({ status: 'published', lockVersion: 3 }),
                    };
                    return stored;
                },
            },
        );

        // On the piece count, saying what it needs.
        await untilVisible('kitchen-recipe-yield-pieces-error');
        expect(isSelected('production')).toBe(true);
        expect(screen.getByTestId('kitchen-recipe-yield-pieces-error')).toHaveTextContent(
            'Enter the pieces produced',
        );
        await waitFor(() => {
            expect(focusMock).toHaveBeenCalledWith('kitchen-recipe-yield-pieces');
        });
        expect(screen.getByTestId('kitchen-recipe-stock-gap')).toHaveTextContent(
            /Stock gap to fix: Recipe has no pieces produced/,
        );

        // Until there is a count, the card points at Pieces produced — from any tab.
        expect(screen.queryByTestId('kitchen-recipe-stock-gap-publish')).toBeNull();
        await press('kitchen-recipe-tab-description');
        expect(isSelected('description')).toBe(true);
        focusMock.mockClear();
        await press('kitchen-recipe-stock-gap-field');
        expect(isSelected('production')).toBe(true);
        await waitFor(() => {
            expect(focusMock).toHaveBeenCalledWith('kitchen-recipe-yield-pieces');
        });

        // Counted: the card's action becomes its own Publish, through the usual dialog.
        await type('kitchen-recipe-yield-pieces-input', '12');
        await untilVisible('kitchen-recipe-stock-gap-publish');
        expect(screen.queryByTestId('kitchen-recipe-stock-gap-field')).toBeNull();
        await press('kitchen-recipe-stock-gap-publish');
        await untilVisible('kitchen-recipe-publish-confirm');
        await press('kitchen-recipe-publish-confirm');
        await waitFor(() => {
            expect(repositories.kitchenAdmin.publishRecipe).toHaveBeenCalledTimes(1);
        });

        // The card ticks and goes; the tray says it is done and offers the way back.
        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-recipe-tray-clear')).toHaveTextContent(
                    /Fixed and published\. Retry the stock gap next\./,
                );
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kitchen-recipe-stock-gap')).toBeNull();
        // Published: nothing is left to lose, so Continue has nothing to keep.
        expect(readActiveProcess()).toBeNull();
        // The toast offers the same way back.
        await untilVisible('kitchen-recipe-published-back');
        expect(screen.queryByTestId('kitchen-recipe-yield-pieces-error')).toBeNull();

        await press('kitchen-recipe-stock-gap-back');
        expect(routerMock.__dismissTo).toHaveBeenCalledWith(
            '/kitchen/consumption-exceptions?reason=unquantified_recipe_line&page=2&fixed=1',
        );
    });

    it('opens a draft from a published version, from the card', async () => {
        const published = version({
            status: 'published',
            publishedAt: '2026-08-03T09:00:00.000Z',
        });
        const stored = recipe(published);
        const { repositories } = await renderEditor(
            {
                returnTo: RETURN_TO,
                stockGapFix: { reason: 'no_yield_piece_count', ingredientId: null },
            },
            () => stored,
            { createRecipeVersion: async () => stored },
        );

        await untilVisible('kitchen-recipe-stock-gap-new-draft');
        expect(screen.queryByTestId('kitchen-recipe-stock-gap-publish')).toBeNull();
        await press('kitchen-recipe-stock-gap-new-draft');
        await waitFor(() => {
            expect(repositories.kitchenAdmin.createRecipeVersion).toHaveBeenCalledWith(
                RECIPE_ID,
                published.versionNumber,
            );
        });
    });

    it('opens as it always does without a fix', async () => {
        await renderEditor({ returnTo: RETURN_TO }, () => recipe());

        await untilVisible('kitchen-recipe-name-en-input');
        expect(isSelected('description')).toBe(true);
        expect(screen.queryByTestId('kitchen-recipe-stock-gap')).toBeNull();

        // Cancel still goes back to where it came from.
        await press('kitchen-recipe-editor-screen-discard');
        expect(routerMock.__dismissTo).toHaveBeenCalledWith(RETURN_TO);
    });

    it('takes a refused optional field’s card to its tab, from any other', async () => {
        const stored = recipe();
        await renderEditor({}, () => stored, {
            updateRecipe: async () =>
                throwFailure(
                    validationFailure({
                        yield_piece_count: ['The pieces produced must be at least 1.'],
                    }),
                ),
        });

        await untilVisible('kitchen-recipe-name-en-input');
        await type('kitchen-recipe-name-en-input', 'Mujadara');
        await press('kitchen-recipe-editor-screen-save');
        await untilVisible('kitchen-recipe-yield-pieces-error');

        await press('kitchen-recipe-tab-description');
        expect(isSelected('description')).toBe(true);
        focusMock.mockClear();
        await press('kitchen-recipe-issues-errors-server-yield_piece_count-fix');
        expect(isSelected('production')).toBe(true);
        await waitFor(() => {
            expect(focusMock).toHaveBeenCalledWith('kitchen-recipe-yield-pieces');
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * Leaving with unsaved work
 * ---------------------------------------------------------------------------------------------- */

describe('leaving the recipe with unsaved work', () => {
    it('keeps it when the reader leaves another way than Cancel, and puts it back on return', async () => {
        const stored = recipe();
        const first = await renderEditor({}, () => stored);

        await untilVisible('kitchen-recipe-name-en-input');
        await type('kitchen-recipe-name-en-input', 'Burghul salad, extra lemon');
        // Gone by the sidebar, say: the page is simply replaced.
        await act(async () => {
            first.view.unmount();
        });

        await renderEditor({}, () => stored);
        await untilVisible('kitchen-recipe-detour-restored-toast');
        expect(screen.getByTestId('kitchen-recipe-name-en-input').props.value).toBe(
            'Burghul salad, extra lemon',
        );
    });

    it('keeps nothing once the reader discards it with Cancel', async () => {
        const stored = recipe();
        const first = await renderEditor({ returnTo: RETURN_TO }, () => stored);

        await untilVisible('kitchen-recipe-name-en-input');
        await type('kitchen-recipe-name-en-input', 'Burghul salad, extra lemon');
        await press('kitchen-recipe-editor-screen-discard');
        await untilVisible('kitchen-recipe-editor-screen-unsaved-dialog');
        await press('kitchen-recipe-editor-screen-unsaved-discard');
        await act(async () => {
            first.view.unmount();
        });

        await renderEditor({}, () => stored);
        await untilVisible('kitchen-recipe-name-en-input');
        expect(screen.queryByTestId('kitchen-recipe-detour-restored-toast')).toBeNull();
        expect(screen.getByTestId('kitchen-recipe-name-en-input').props.value).not.toBe(
            'Burghul salad, extra lemon',
        );
    });
});
