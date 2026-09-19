import type { ItemLatestPurchase, StockItem, StockLevel } from '@healthy360/api-client/contracts';
import { GoodsReceiptId, SupplierId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession, testActiveContext } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { TEST_BRANCH_ID } from '../../testing/session-fixtures.ts';
import { stockItemRowTestId } from './ops-format.ts';
import { StockScreen } from './screens/stock-screen.tsx';

/** The desk width the kitchen list is built for; narrower, `CatalogueList` draws its phone rows. */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1280, height: 900, scale: 1, fontScale: 1 }),
}));

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
    it('splits the stock list into the two books and counts the page in hand', async () => {
        await renderStubScreen(<StockScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    // Three ingredients the kitchen cooks with, one product it buys in to resell.
                    listStockItems: async () => [
                        ...[1, 2, 3].map((n) => stockItem(n)),
                        stockItem(4, { backing: 'product', catalogueItemId: 'catalogue-item-4' }),
                    ],
                    // Two shelves stocked, one low; the third ingredient has no level at all.
                    listStockLevels: async () => [
                        stockLevel(1),
                        stockLevel(2, { quantity: '1.000', reorderThreshold: '5', isLow: true }),
                    ],
                    listItemLatestPurchases: async () => [],
                },
                kitchenAdmin: { listIngredients: async () => page([]) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-stock-table')).toBeTruthy();
        });

        // Live counts over the rows in hand, not fabricated KPIs.
        expect(screen.getByTestId('kitchen-stock-stats')).toHaveTextContent(/Shown/);
        const rowFor = (ordinal: number) => stockItemRowTestId(String(stockItem(ordinal).id));
        expect(screen.getByTestId(`${rowFor(1)}-status`)).toHaveTextContent(/In stock/);
        expect(screen.getByTestId(`${rowFor(2)}-status`)).toHaveTextContent(/Low/);
        // No level row at this branch is an empty shelf, not a missing row.
        expect(screen.getByTestId(`${rowFor(3)}-status`)).toHaveTextContent(/Empty/);
        // The resale book is a kind switch away, not on the ingredients page.
        expect(screen.queryByTestId(`${rowFor(4)}-name`)).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-stock-kind-products'));
        });
        expect(screen.getByTestId(`${rowFor(4)}-name`)).toBeTruthy();
        expect(screen.queryByTestId(`${rowFor(1)}-name`)).toBeNull();

        // The level segments narrow within the book.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-stock-kind-ingredients'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-stock-toolbar-status-low'));
        });
        expect(screen.getByTestId(`${rowFor(2)}-name`)).toBeTruthy();
        expect(screen.queryByTestId(`${rowFor(1)}-name`)).toBeNull();
        expect(screen.queryByTestId(`${rowFor(3)}-name`)).toBeNull();
    });

    it('shows twenty-five shelves a page, and asks only about the prices on that page', async () => {
        const { repositories } = await renderStubScreen(<StockScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listStockItems: async () =>
                        Array.from({ length: 27 }, (_, index) => stockItem(index + 1)),
                    listStockLevels: async () => [],
                    listItemLatestPurchases: async () => [],
                },
                kitchenAdmin: { listIngredients: async () => page([]) },
            },
        });

        const rowFor = (ordinal: number) =>
            `${stockItemRowTestId(String(stockItem(ordinal).id))}-name`;

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-stock-table')).toBeTruthy();
        });

        expect(screen.getByTestId(rowFor(1))).toBeTruthy();
        expect(screen.getByTestId(rowFor(25))).toBeTruthy();
        expect(screen.queryByTestId(rowFor(26))).toBeNull();

        // The point of the page: the price read asks about what is on screen. Asking about the
        // whole library is what made this request a `414` at the edge.
        expect(repositories.kitchenOps.listItemLatestPurchases).toHaveBeenCalledWith(
            Array.from({ length: 25 }, (_, index) => stockItem(index + 1).id),
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-stock-pagination-pages-page-2'));
        });

        expect(screen.getByTestId(rowFor(26))).toBeTruthy();
        expect(screen.queryByTestId(rowFor(1))).toBeNull();
        await waitFor(() => {
            expect(repositories.kitchenOps.listItemLatestPurchases).toHaveBeenCalledWith([
                stockItem(26).id,
                stockItem(27).id,
            ]);
        });
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
            expect(screen.getByTestId('kitchen-stock-table')).toBeTruthy();
        });

        // A kitchen manager holds the manage permission and still gets no create affordance.
        expect(screen.queryByTestId('kitchen-stock-add-item')).toBeNull();
        expect(screen.queryByTestId('kitchen-stock-create-dialog')).toBeNull();
    });

    it('posts a movement as a ledger entry — the editor never writes a level', async () => {
        const { repositories } = await renderStubScreen(<StockScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listStockItems: async () => [stockItem(1)],
                    listStockLevels: async () => [stockLevel(1)],
                    listItemLatestPurchases: async () => [],
                    recordStockAdjustment: async () => ({
                        id: 'movement-1',
                        quantityDelta: '2.5000',
                        reason: 'adjust' as const,
                    }),
                },
                kitchenAdmin: { listIngredients: async () => page([]) },
            },
        });

        const row = stockItemRowTestId(String(stockItem(1).id));
        await waitFor(() => {
            expect(screen.getByTestId(`${row}-adjust`)).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-adjust`));
        });

        expect(screen.getByTestId('kitchen-stock-editor')).toBeTruthy();
        // Nothing changed yet, so there is nothing to post.
        expect(screen.getByTestId('kitchen-stock-editor-save')).toBeDisabled();

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-stock-movement-quantity-input'),
                '2.5',
            );
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-stock-movement-notes-input'),
                'Recount after delivery',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-stock-editor-save'));
        });

        await waitFor(() => {
            expect(repositories.kitchenOps.recordStockAdjustment).toHaveBeenCalledWith(
                expect.objectContaining({
                    stockItemId: stockItem(1).id,
                    quantityDelta: 2.5,
                    notes: 'Recount after delivery',
                }),
            );
        });
        // The threshold was untouched, so it was not rewritten.
        expect(repositories.kitchenOps.setStockThreshold).not.toHaveBeenCalled();
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
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-stock-kind-products'));
        });
        expect(screen.getByTestId('kitchen-stock-products-empty')).toBeTruthy();
    });

    /*
     * SUP2 — the last-purchase column. The price is a *separate* Procurement read joined to the
     * Inventory rows on `stockItemId`, because Inventory may not import Procurement, so the three
     * things worth pinning are the join, the three-state cell, and that the join is one request.
     */

    it('joins the last purchase onto the book and keeps its three states apart', async () => {
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
            expect(screen.getByTestId('kitchen-stock-table')).toBeTruthy();
        });

        // One request for the whole page, carrying every visible shelf — never one per row.
        expect(repositories.kitchenOps.listItemLatestPurchases).toHaveBeenCalledTimes(1);
        expect(repositories.kitchenOps.listItemLatestPurchases).toHaveBeenCalledWith([
            stockItem(1).id,
            stockItem(2).id,
            stockItem(3).id,
        ]);

        // 1. A price, with the currency and unit that make it mean something.
        //
        // The join is its own request, one behind the table: until it lands every row honestly says
        // so, so the wait is for the cell this test is about rather than for the table that arrived
        // a request earlier. The assertions are regexes because all three facts share one cell —
        // `toHaveTextContent` matches a bare string exactly, so each would fail on the other two.
        const priced = stockItemRowTestId(String(stockItem(1).id));
        await waitFor(() => {
            expect(screen.getByTestId(`${priced}-price`)).toBeTruthy();
        });
        expect(screen.getByTestId(`${priced}-price`)).toHaveTextContent(/3\.20/);
        expect(screen.getByTestId(`${priced}-price`)).toHaveTextContent(/USD/);
        expect(screen.getByTestId(`${priced}-price-source`)).toHaveTextContent(/Gulf Fresh/);

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
            expect(screen.getByTestId('kitchen-stock-table')).toBeTruthy();
        });

        const testID = stockItemRowTestId(String(stockItem(1).id));
        // Same one-request lag as above: the row reports "loading" until the join lands.
        await waitFor(() => {
            expect(screen.getByTestId(`${testID}-price-hidden`)).toBeTruthy();
        });
        expect(screen.queryByTestId(`${testID}-price`)).toBeNull();
        // A link into a ledger this reader may not open would be a promise it refuses.
        expect(screen.queryByTestId(`${testID}-history`)).toBeNull();
    });
});
