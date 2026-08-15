import type { StockItem, StockLevel } from '@healthy360/api-client/contracts';
import { screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { TEST_BRANCH_ID } from '../../testing/session-fixtures.ts';
import { StockScreen } from './screens/stock-screen.tsx';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/stock',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/** An ingredient-backed shelf by default; pass `backing: 'product'` for the resale book. */
function stockItem(ordinal: number, overrides: Partial<StockItem> = {}): StockItem {
    return {
        id: `stock-item-${String(ordinal)}` as StockItem['id'],
        code: `ITEM-${String(ordinal)}`,
        nameEn: `Stock item ${String(ordinal)}`,
        unitCode: 'kg',
        ingredientId: null,
        catalogueItemId: null,
        backing: 'ingredient',
        isStocked: false,
        hasHistory: false,
        ...overrides,
    };
}

function stockLevel(ordinal: number, overrides: Partial<StockLevel> = {}): StockLevel {
    return {
        id: `stock-level-${String(ordinal)}`,
        branchId: TEST_BRANCH_ID,
        stockItemId: `stock-item-${String(ordinal)}` as StockLevel['stockItemId'],
        quantity: '12.000',
        reorderThreshold: null,
        parLevel: null,
        isLow: false,
        itemCode: `ITEM-${String(ordinal)}`,
        itemNameEn: `Stock item ${String(ordinal)}`,
        ingredientId: null,
        ...overrides,
    };
}

describe('ops panels', () => {
    it('splits the stock board into the two books and counts each from the declared world', async () => {
        await renderStubScreen(<StockScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    // Three ingredients the kitchen cooks with, one product it buys in to resell.
                    listStockItems: async () => [
                        ...[1, 2, 3].map((n) => stockItem(n)),
                        stockItem(4, { backing: 'product', catalogueItemId: 'catalogue-item-4' }),
                    ],
                    listStockLevels: async () => [1, 2, 3].map((n) => stockLevel(n)),
                },
                kitchenAdmin: { listIngredients: async () => page([]) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-stock-panel')).toBeTruthy();
        });

        // Live counts of what the screen fetched, not fabricated KPIs: the two books are counted
        // separately, three levels, and no level at zero quantity.
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-stock-panel-metric-ingredients-value'),
            ).toHaveTextContent('3');
        });
        expect(screen.getByTestId('kitchen-stock-panel-metric-products-value')).toHaveTextContent(
            '1',
        );
        expect(screen.getByTestId('kitchen-stock-panel-metric-levels-value')).toHaveTextContent(
            '3',
        );
        expect(screen.getByTestId('kitchen-stock-panel-metric-outOfStock-value')).toHaveTextContent(
            '0',
        );

        expect(screen.getByTestId('kitchen-stock-ingredients-table')).toBeTruthy();
        expect(screen.getByTestId('kitchen-stock-products-table')).toBeTruthy();
        expect(screen.getByTestId('kitchen-stock-levels-table')).toBeTruthy();
    });

    it('offers no way to declare a stock item — a shelf follows an ingredient or a product', async () => {
        await renderStubScreen(<StockScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listStockItems: async () => [stockItem(1)],
                    listStockLevels: async () => [],
                },
                kitchenAdmin: { listIngredients: async () => page([]) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-stock-ingredients-table')).toBeTruthy();
        });

        // A kitchen manager holds the manage permission and still gets no create affordance.
        expect(screen.queryByTestId('kitchen-stock-add-item')).toBeNull();
        expect(screen.queryByTestId('kitchen-stock-create-dialog')).toBeNull();
    });

    it('shows an honest empty state for each book when the world has neither', async () => {
        await renderStubScreen(<StockScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listStockItems: async () => [],
                    listStockLevels: async () => [],
                },
                kitchenAdmin: { listIngredients: async () => page([]) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-stock-ingredients-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-stock-products-empty')).toBeTruthy();
    });
});
