import type {
    AdminEntityMeta,
    CursorPage,
    IngredientAdmin,
    IngredientAdminFilter,
    RecipeAdminFilter,
    RecipeAdminSummary,
} from '@healthy360/api-client/contracts';
import { IngredientId, KitchenId, RecipeId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { TEST_ORGANISATION_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { forgetColumnChoice } from './catalogue/column-picker.tsx';
import { IngredientsScreen } from './screens/ingredients-screen.tsx';
import { RecipesScreen } from './screens/recipes-screen.tsx';

/**
 * Coming back to a list finds it as it was left.
 *
 * The kitchen layout is a `<Slot/>`, so opening a record unmounts the list, and Back, a Back button
 * or the sidebar mounts a new one. These tests do exactly that — the list is taken off the tree and
 * put back, under the same data cache, the way the router does it — and assert that the search, the
 * page and the row that was opened are all still there.
 *
 * The renderer's window is 750px, so the rows are the narrow two-line shape, whose highlight is
 * `ListItem`'s selected state.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({
            push,
            replace: jest.fn(),
            setParams: jest.fn(),
            back: jest.fn(),
            canGoBack: jest.fn(() => true),
            dismissTo: jest.fn(),
            prefetch: jest.fn(),
        }),
        usePathname: () => '/kitchen',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    forgetColumnChoice('kitchen-ingredients');
});

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

/* ------------------------------------------------------------------------------------------------
 * Leaving and coming back
 * ---------------------------------------------------------------------------------------------- */

let toggleMounted: () => void = () => undefined;

/** Holds the list on the tree, or not — what the `<Slot/>` does on the way to a record and back. */
function Remountable({ children }: { readonly children: ReactNode }) {
    const [mounted, setMounted] = useState(true);
    useEffect(() => {
        toggleMounted = () => {
            setMounted((current) => !current);
        };
    }, []);
    return mounted ? children : null;
}

async function leaveAndComeBack() {
    await act(async () => {
        toggleMounted();
    });
    await act(async () => {
        toggleMounted();
    });
}

function selectedOf(testID: string): boolean {
    const state = screen.getByTestId(testID).props.accessibilityState as
        { readonly selected?: boolean } | undefined;
    return state?.selected === true;
}

/* ------------------------------------------------------------------------------------------------
 * The world
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

function ingredientId(ordinal: number): IngredientId {
    return IngredientId.unsafe(
        `01935f6d-0000-7000-8000-00000000${String(ordinal).padStart(4, '0')}`,
    );
}

function ingredient(ordinal: number): IngredientAdmin {
    return {
        id: ingredientId(ordinal),
        meta: meta(),
        name: { en: `Ingredient ${String(ordinal)}`, ar: `مكوّن ${String(ordinal)}` },
        slug: `ingredient-${String(ordinal)}`,
        reference: `ING-${String(ordinal).padStart(4, '0')}`,
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
    };
}

/** Paged the way the server pages: `page` of `perPage`, with the filtered set's count. */
function pagedIngredients(
    rows: readonly IngredientAdmin[],
): (filter?: IngredientAdminFilter) => Promise<CursorPage<IngredientAdmin>> {
    return async (filter) => {
        const needle = filter?.query?.trim().toLocaleLowerCase() ?? '';
        const matched = rows.filter(
            (row) => needle === '' || row.name.en.toLocaleLowerCase().includes(needle),
        );
        const perPage = filter?.perPage;
        const from = ((filter?.page ?? 1) - 1) * (perPage ?? 0);
        return page(perPage === undefined ? matched : matched.slice(from, from + perPage), {
            totalCount: matched.length,
        });
    };
}

function recipeSummary(ordinal: number, name: string): RecipeAdminSummary {
    return {
        id: RecipeId.unsafe(`01935f6d-0000-7000-8000-0000000b000${String(ordinal)}`),
        meta: meta(),
        name: { en: name, ar: `${name} بالعربية` },
        slug: name.toLocaleLowerCase(),
        reference: `RC-000${String(ordinal)}`,
        kitchenId: KitchenId.unsafe('01935f6d-0000-7000-8000-00000000c001'),
        sourceKind: null,
        recipeCategory: null,
        currentVersionNumber: 1,
        versionCount: 1,
        currentVersionStatus: 'draft',
        allergenCodes: [],
        lineCount: 2,
        kinds: ['preparation'],
        soldAs: [],
    };
}

function recipeListing(
    rows: readonly RecipeAdminSummary[],
): (filter?: RecipeAdminFilter) => Promise<CursorPage<RecipeAdminSummary>> {
    return async (filter) => {
        const needle = filter?.query?.trim().toLocaleLowerCase() ?? '';
        return page(
            rows.filter((row) => needle === '' || row.name.en.toLocaleLowerCase().includes(needle)),
        );
    };
}

/* ------------------------------------------------------------------------------------------------
 * The lists
 * ---------------------------------------------------------------------------------------------- */

describe('coming back to the ingredient list', () => {
    it('restores the search and the page, and marks the row that was opened', async () => {
        // Twenty rows: two pages of eighteen, so the page is something the list could lose.
        const library = Array.from({ length: 20 }, (_, index) => ingredient(index + 1));
        const opened = library[18];
        if (opened === undefined) throw new Error('fixture');
        const openedRow = `kitchen-ingredients-table-row-${String(opened.id)}`;
        const firstRow = `kitchen-ingredients-table-row-${String(ingredientId(1))}`;

        const { repositories } = await renderStubScreen(
            <Remountable>
                <IngredientsScreen />
            </Remountable>,
            {
                session: kitchenManagerSession(),
                repositories: { kitchenAdmin: { listIngredients: pagedIngredients(library) } },
            },
        );
        await untilVisible('kitchen-ingredients-table');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredients-toolbar-search-input'),
                'ingredient',
            );
        });
        await untilVisible('kitchen-ingredients-pagination-pages-page-2');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredients-pagination-pages-page-2'));
        });
        await untilVisible(openedRow);

        await act(async () => {
            fireEvent.press(screen.getByTestId(openedRow));
        });
        expect(routerMock.__push).toHaveBeenCalledWith(`/kitchen/ingredients/${String(opened.id)}`);

        await leaveAndComeBack();
        await untilVisible(openedRow);

        // The same search, asked of the server for the same page.
        expect(screen.getByTestId('kitchen-ingredients-toolbar-search-input').props.value).toBe(
            'ingredient',
        );
        expect(repositories.kitchenAdmin.listIngredients).toHaveBeenLastCalledWith(
            expect.objectContaining({ query: 'ingredient' }),
        );
        expect(repositories.kitchenAdmin.listIngredients).toHaveBeenCalledWith(
            expect.objectContaining({ query: 'ingredient', page: 2, perPage: 18 }),
        );
        expect(screen.queryByTestId(firstRow)).toBeNull();
        // The row that was opened is the one marked; its neighbour is not.
        expect(selectedOf(openedRow)).toBe(true);
        expect(selectedOf(`kitchen-ingredients-table-row-${String(ingredientId(20))}`)).toBe(false);
    });

    it('still starts again on page one when the search changes after coming back', async () => {
        const library = Array.from({ length: 20 }, (_, index) => ingredient(index + 1));

        await renderStubScreen(
            <Remountable>
                <IngredientsScreen />
            </Remountable>,
            {
                session: kitchenManagerSession(),
                repositories: { kitchenAdmin: { listIngredients: pagedIngredients(library) } },
            },
        );
        await untilVisible('kitchen-ingredients-pagination-pages-page-2');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredients-pagination-pages-page-2'));
        });
        await untilVisible(`kitchen-ingredients-table-row-${String(ingredientId(19))}`);

        await leaveAndComeBack();
        await untilVisible(`kitchen-ingredients-table-row-${String(ingredientId(19))}`);

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredients-toolbar-search-input'),
                'ingredient 1',
            );
        });
        await untilVisible(`kitchen-ingredients-table-row-${String(ingredientId(1))}`);
    });
});

describe('coming back to the recipe book', () => {
    it('restores the search and marks the recipe that was opened', async () => {
        const tabbouleh = recipeSummary(1, 'Tabbouleh');
        const fattoush = recipeSummary(2, 'Fattoush');
        const tahini = recipeSummary(3, 'Tahini sauce');
        const openedRow = `kitchen-recipes-table-row-${String(tabbouleh.id)}`;

        await renderStubScreen(
            <Remountable>
                <RecipesScreen />
            </Remountable>,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: { listRecipes: recipeListing([tabbouleh, fattoush, tahini]) },
                },
            },
        );
        await untilVisible('kitchen-recipes-table');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-recipes-toolbar-search-input'), 'ta');
        });
        await untilVisible(openedRow);
        expect(screen.queryByTestId(`kitchen-recipes-table-row-${String(fattoush.id)}`)).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId(openedRow));
        });
        expect(routerMock.__push).toHaveBeenCalledWith(`/kitchen/recipes/${String(tabbouleh.id)}`);

        await leaveAndComeBack();
        await untilVisible(openedRow);

        expect(screen.getByTestId('kitchen-recipes-toolbar-search-input').props.value).toBe('ta');
        expect(screen.queryByTestId(`kitchen-recipes-table-row-${String(fattoush.id)}`)).toBeNull();
        expect(selectedOf(openedRow)).toBe(true);
        expect(selectedOf(`kitchen-recipes-table-row-${String(tahini.id)}`)).toBe(false);
    });
});
