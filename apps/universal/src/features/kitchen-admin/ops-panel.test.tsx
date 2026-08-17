import type { ItemLatestPurchase, StockItem, StockLevel } from '@healthy360/api-client/contracts';
import { GoodsReceiptId, SupplierId } from '@healthy360/domain-types';
import { screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession, testActiveContext } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { TEST_BRANCH_ID } from '../../testing/session-fixtures.ts';
import { stockItemRowTestId } from './ops-format.ts';
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

/** One shelf's newest purchase across every supplier (SUP2), as the Procurement read answers it. */
function itemLatestPurchase(
    ordinal: number,
    overrides: Partial<ItemLatestPurchase> = {},
): ItemLatestPurchase {
    return {
        stockItemId: `stock-item-${String(ordinal)}` as StockItem['id'],
        goodsReceiptId: GoodsReceiptId.unsafe(`goods-receipt-${String(ordinal)}`),
        documentRef: 'DN-2001',
        receivedAt: '2026-08-10T09:00:00.000Z',
        quantity: '10.0000',
        unitId: null,
        unitCode: 'kg',
        unitPriceAmount: '3.200000',
        costCurrencyCode: 'USD',
        supplier: {
            id: SupplierId.unsafe('supplier-1'),
            code: 'GULF-01',
            nameEn: 'Gulf Fresh',
        },
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
                    listItemLatestPurchases: async () => [],
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
                    listItemLatestPurchases: async () => [],
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

    /*
     * SUP2 — the last-purchase column. The price is a *separate* Procurement read joined to the
     * Inventory rows on `stockItemId`, because Inventory may not import Procurement, so the three
     * things worth pinning are the join, the three-state cell, and that the join is one request.
     */

    it('joins the last purchase onto both books and keeps its three states apart', async () => {
        const { repositories } = await renderStubScreen(<StockScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listStockItems: async () => [stockItem(1), stockItem(2), stockItem(3)],
                    listStockLevels: async () => [],
                    listItemLatestPurchases: async () => [
                        itemLatestPurchase(1),
                        // Bought, but the money was redacted for this reader.
                        itemLatestPurchase(3, {
                            unitPriceAmount: null,
                            costCurrencyCode: null,
                        }),
                    ],
                },
                kitchenAdmin: { listIngredients: async () => page([]) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-stock-ingredients-table')).toBeTruthy();
        });

        // One request for the whole page, carrying every visible shelf — never one per row.
        expect(repositories.kitchenOps.listItemLatestPurchases).toHaveBeenCalledTimes(1);
        expect(repositories.kitchenOps.listItemLatestPurchases).toHaveBeenCalledWith([
            stockItem(1).id,
            stockItem(2).id,
            stockItem(3).id,
        ]);

        // 1. A price, with the currency and unit that make it mean something.
        const priced = stockItemRowTestId(String(stockItem(1).id));
        expect(screen.getByTestId(`${priced}-price`)).toHaveTextContent('3.20');
        expect(screen.getByTestId(`${priced}-price`)).toHaveTextContent('USD');
        expect(screen.getByTestId(`${priced}-price-source`)).toHaveTextContent('Gulf Fresh');

        // 2. Absent from the answer means never bought at a price at all.
        expect(
            screen.getByTestId(`${stockItemRowTestId(String(stockItem(2).id))}-never-bought`),
        ).toBeTruthy();

        // 3. Present but redacted — a different cell from either of the other two.
        const hidden = stockItemRowTestId(String(stockItem(3).id));
        expect(screen.getByTestId(`${hidden}-price-hidden`)).toBeTruthy();
        expect(screen.queryByTestId(`${hidden}-price`)).toBeNull();
        expect(screen.queryByTestId(`${hidden}-never-bought`)).toBeNull();

        // The History deep link is offered to a reader who may open the ledger.
        expect(screen.getByTestId(`${priced}-history`)).toBeTruthy();
    });

    it('hides the price and the History link from a reader without the cost permission', async () => {
        await renderStubScreen(<StockScreen />, {
            session: kitchenManagerSession({
                activeContext: testActiveContext({
                    permissions: ['organisation.view_current', 'inventory.view_organisation'],
                }),
            }),
            repositories: {
                kitchenOps: {
                    listStockItems: async () => [stockItem(1)],
                    listStockLevels: async () => [],
                    // The server would redact these; the screen must not show them either way.
                    listItemLatestPurchases: async () => [itemLatestPurchase(1)],
                },
                kitchenAdmin: { listIngredients: async () => page([]) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-stock-ingredients-table')).toBeTruthy();
        });

        const testID = stockItemRowTestId(String(stockItem(1).id));
        expect(screen.getByTestId(`${testID}-price-hidden`)).toBeTruthy();
        expect(screen.queryByTestId(`${testID}-price`)).toBeNull();
        // A link into a ledger this reader may not open would be a promise it refuses.
        expect(screen.queryByTestId(`${testID}-history`)).toBeNull();
    });
});
