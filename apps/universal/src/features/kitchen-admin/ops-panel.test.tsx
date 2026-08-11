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

function stockItem(ordinal: number, overrides: Partial<StockItem> = {}): StockItem {
    return {
        id: `stock-item-${String(ordinal)}` as StockItem['id'],
        code: `ITEM-${String(ordinal)}`,
        nameEn: `Stock item ${String(ordinal)}`,
        unitCode: 'kg',
        ingredientId: null,
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
    it('renders the stock board with live counts from the declared world', async () => {
        await renderStubScreen(<StockScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listStockItems: async () => [1, 2, 3, 4].map((n) => stockItem(n)),
                    listStockLevels: async () => [1, 2, 3].map((n) => stockLevel(n)),
                },
                kitchenAdmin: { listIngredients: async () => page([]) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-stock-panel')).toBeTruthy();
        });

        // Live counts of what the screen fetched, not fabricated KPIs: four items, three levels,
        // and no level at zero quantity.
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-stock-panel-metric-items-value')).toHaveTextContent(
                '4',
            );
        });
        expect(screen.getByTestId('kitchen-stock-panel-metric-levels-value')).toHaveTextContent(
            '3',
        );
        expect(screen.getByTestId('kitchen-stock-panel-metric-outOfStock-value')).toHaveTextContent(
            '0',
        );

        expect(screen.getByTestId('kitchen-stock-items-table')).toBeTruthy();
        expect(screen.getByTestId('kitchen-stock-levels-table')).toBeTruthy();
    });

    it('shows an honest empty state when the world has no stock items', async () => {
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
            expect(screen.getByTestId('kitchen-stock-items-empty')).toBeTruthy();
        });
    });
});
