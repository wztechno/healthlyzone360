import type {
    KitchenQuotation,
    KitchenQuotationLine,
    OrderProposalItem,
    PurchaseOrder,
    StockItem,
    StockLevel,
    Supplier,
    UnpricedReceipt,
} from '@healthy360/api-client/contracts';
import type { QuotationId } from '@healthy360/domain-types';
import {
    BranchId,
    GoodsReceiptId,
    PurchaseOrderId,
    StockItemId,
    SupplierId,
} from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { TEST_BRANCH_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import {
    kitchenQuotationRowTestId,
    purchaseOrderRowTestId,
    stockItemRowTestId,
    supplierRowTestId,
    supplyOrderRowTestId,
} from './ops-format.ts';
import { QuotationsScreen } from './screens/quotations-screen.tsx';
import { StockScreen } from './screens/stock-screen.tsx';
import { SuppliersScreen } from './screens/suppliers-screen.tsx';
import { SupplyOrdersScreen } from './screens/supply-orders-screen.tsx';
import { UnpricedReceiptsScreen } from './screens/unpriced-receipts-screen.tsx';

/**
 * The column headers of the stock, supplier, supply-order, unpriced-receipt and quotation tables.
 *
 * Two claims, and the file keeps them apart:
 *
 * 1. **Where the rows are the whole answer, every header acts in memory** — the stock book, the
 *    supplier book, the quotation queue and its lines, the order proposal.
 * 2. **Where the rows are a keyset page, a header acts only through the request.** The supply-order
 *    book's Supplier and Status, and the unpriced queue's Supplier, reach the repository; the
 *    unpriced queue's References, To price and State stay plain labels, because the filter carries
 *    no parameter for them.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1280, height: 900, scale: 1, fontScale: 1 }),
}));

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        setParams: jest.fn(),
        back: jest.fn(),
        prefetch: jest.fn(),
    }),
    usePathname: () => '/kitchen/stock',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
}));

/** Waits for an element, with the contention headroom the other kitchen suites document. */
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

/** The rendered order of every element whose testID matches — the rows, top to bottom. */
function orderOf(pattern: RegExp): readonly string[] {
    return screen.getAllByTestId(pattern).map((node) => String(node.props.testID));
}

/* ------------------------------------------------------------------------------------------------
 * Stock
 * ---------------------------------------------------------------------------------------------- */

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

const STOCK_NAMES = /^kitchen-stock-item-stock-item-\d+-name$/;
const stockName = (ordinal: number) =>
    `${stockItemRowTestId(`stock-item-${String(ordinal)}`)}-name`;

describe('stock headers', () => {
    it('filters by unit and by status, and sorts by the reorder threshold with blanks last', async () => {
        await renderStubScreen(<StockScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    // Server order 2, 3, 1 — so neither sort direction is the order it arrived in.
                    listStockItems: async () => [
                        stockItem(2, { unitCode: 'l' }),
                        stockItem(3),
                        stockItem(1),
                    ],
                    listStockLevels: async () => [
                        stockLevel(1, { reorderThreshold: '2' }),
                        stockLevel(2, { quantity: '1.000', reorderThreshold: '5', isLow: true }),
                    ],
                    listItemLatestPurchases: async () => [],
                },
                kitchenAdmin: { listIngredients: async () => page([]) },
            },
        });

        await untilVisible('kitchen-stock-table');

        for (const column of ['item', 'quantity', 'unit', 'reorder', 'status']) {
            expect(screen.getByTestId(`kitchen-stock-column-${column}-trigger`)).toBeTruthy();
        }
        // Read for the visible page only, so it cannot order or narrow the book.
        expect(screen.queryByTestId('kitchen-stock-column-lastPurchase-trigger')).toBeNull();

        await press('kitchen-stock-column-reorder-trigger');
        await waitFor(() => {
            expect(orderOf(STOCK_NAMES)).toEqual([stockName(1), stockName(2), stockName(3)]);
        });
        await press('kitchen-stock-column-reorder-trigger');
        await waitFor(() => {
            // Descending, and the shelf with no threshold is still last.
            expect(orderOf(STOCK_NAMES)).toEqual([stockName(2), stockName(1), stockName(3)]);
        });

        await press('kitchen-stock-column-unit-trigger');
        await untilVisible('kitchen-stock-column-unit-l');
        await press('kitchen-stock-column-unit-l');
        await waitFor(() => {
            expect(orderOf(STOCK_NAMES)).toEqual([stockName(2)]);
        });

        // A filter value leaves its menu open, so Clear is already there to press.
        await untilVisible('kitchen-stock-column-unit-clear');
        await press('kitchen-stock-column-unit-clear');

        await press('kitchen-stock-column-status-trigger');
        await untilVisible('kitchen-stock-column-status-out');
        await press('kitchen-stock-column-status-out');
        await waitFor(() => {
            // No level row at this branch is an empty shelf.
            expect(orderOf(STOCK_NAMES)).toEqual([stockName(3)]);
        });
    });

    it('lands on page one when a header filter changes', async () => {
        await renderStubScreen(<StockScreen />, {
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

        await untilVisible('kitchen-stock-table');
        await press('kitchen-stock-pagination-pages-page-2');
        await untilVisible(stockName(26));

        await press('kitchen-stock-column-unit-trigger');
        await untilVisible('kitchen-stock-column-unit-kg');
        await press('kitchen-stock-column-unit-kg');

        await untilVisible(stockName(1));
        expect(screen.queryByTestId(stockName(26))).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Suppliers
 * ---------------------------------------------------------------------------------------------- */

function supplier(ordinal: number, overrides: Partial<Supplier> = {}): Supplier {
    return {
        id: SupplierId.unsafe(`01935f6d-0000-7000-8000-00000000a00${String(ordinal)}`),
        code: `SUP-0${String(ordinal)}`,
        name: { en: `Supplier ${String(ordinal)}`, ar: '' },
        currencyCode: null,
        contactEmail: null,
        contactPhone: null,
        address: null,
        paymentTerms: null,
        leadTimeDays: null,
        notes: null,
        archivedAt: null,
        contactCount: 0,
        suppliedItemCount: 0,
        primaryContact: null,
        ...overrides,
    };
}

const ZAID = supplier(1, {
    primaryContact: { name: 'Zaid', phone: null },
    paymentTerms: 'Net 30',
    leadTimeDays: 2,
});
const ADEL = supplier(2, {
    primaryContact: { name: 'Adel', phone: null },
    paymentTerms: 'Net 30',
    leadTimeDays: 1,
});
const NOBODY = supplier(3);

const supplierName = (row: Supplier) => `${supplierRowTestId(String(row.id))}-name`;
const SUPPLIER_NAMES = /^kitchen-supplier-[0-9a-f-]+-name$/;

describe('supplier headers', () => {
    it('sorts by contact and by terms, with the supplier that has neither last', async () => {
        await renderStubScreen(<SuppliersScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { listSuppliers: async () => [NOBODY, ZAID, ADEL] } },
        });

        await untilVisible('kitchen-suppliers-table');

        for (const column of ['name', 'contact', 'terms', 'suppliedItems', 'currency']) {
            expect(screen.getByTestId(`kitchen-suppliers-column-${column}-trigger`)).toBeTruthy();
        }

        await press('kitchen-suppliers-column-contact-trigger');
        await waitFor(() => {
            expect(orderOf(SUPPLIER_NAMES)).toEqual([
                supplierName(ADEL),
                supplierName(ZAID),
                supplierName(NOBODY),
            ]);
        });
        await press('kitchen-suppliers-column-contact-trigger');
        await waitFor(() => {
            expect(orderOf(SUPPLIER_NAMES)).toEqual([
                supplierName(ZAID),
                supplierName(ADEL),
                supplierName(NOBODY),
            ]);
        });

        // Same terms, so the lead time decides.
        await press('kitchen-suppliers-column-terms-trigger');
        await waitFor(() => {
            expect(orderOf(SUPPLIER_NAMES)).toEqual([
                supplierName(ADEL),
                supplierName(ZAID),
                supplierName(NOBODY),
            ]);
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * Supply orders
 * ---------------------------------------------------------------------------------------------- */

const BRANCH = BranchId.unsafe(String(TEST_BRANCH_ID));

function proposalRow(
    ordinal: number,
    overrides: Partial<OrderProposalItem> = {},
): OrderProposalItem {
    return {
        stockItemId: StockItemId.unsafe(`01935f6d-0000-7000-8000-00000000e00${String(ordinal)}`),
        itemCode: `ITM-0${String(ordinal)}`,
        itemNameEn: `Item ${String(ordinal)}`,
        unitId: null,
        unitCode: 'kg',
        branchId: BRANCH,
        quantityOnHand: '0.0000',
        reorderThreshold: null,
        parLevel: null,
        isOutOfStock: true,
        isLow: false,
        origin: 'outOfStock',
        suggestedQuantity: null,
        suggestedQuantityBasis: 'none',
        supplierOptions: [],
        suggestedSupplierId: null,
        unassignedReason: null,
        ...overrides,
    };
}

const EMPTY_SHELF = proposalRow(1, { itemNameEn: 'Almonds' });
const LOW_SHELF = proposalRow(2, {
    itemNameEn: 'Butter',
    quantityOnHand: '5.0000',
    reorderThreshold: '5.0000',
    isOutOfStock: false,
    isLow: true,
    origin: 'lowStock',
});

function purchaseOrder(ordinal: number): PurchaseOrder {
    return {
        id: PurchaseOrderId.unsafe(`01935f6d-0000-7000-8000-00000000d00${String(ordinal)}`),
        number: `PO-0${String(ordinal)}`,
        status: 'draft',
        branch: { id: BRANCH, name: 'Main kitchen' },
        supplier: {
            id: ZAID.id,
            code: ZAID.code,
            nameEn: ZAID.name.en,
            nameAr: null,
            archivedAt: null,
        },
        recipientSnapshot: null,
        notes: null,
        lineCount: 1,
        issuedAt: null,
        receivedAt: null,
        closedAt: null,
        closeShortReason: null,
        cancelledAt: null,
        createdAt: '2026-08-17T09:00:00+00:00',
        lines: [],
        receipts: [],
    };
}

describe('supply order headers', () => {
    it('sends the Supplier and Status headers with the request rather than narrowing the page', async () => {
        const { repositories } = await renderStubScreen(<SupplyOrdersScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    countSupplyNeeds: async () => ({
                        count: 2,
                        outOfStockCount: 1,
                        lowStockCount: 1,
                    }),
                    getOrderProposal: async () => ({
                        items: [EMPTY_SHELF, LOW_SHELF],
                        branchId: BRANCH,
                        outOfStockCount: 1,
                        lowStockCount: 1,
                        unassignedCount: 0,
                        requestedItemCount: 0,
                    }),
                    listPurchaseOrders: async () => page([purchaseOrder(1)]),
                    listSuppliers: async () => [ZAID, ADEL],
                },
            },
        });

        await untilVisible(`${purchaseOrderRowTestId(String(purchaseOrder(1).id))}-number`);

        // A supplier with no order on this page is still offered: the values are the book.
        await press('kitchen-supply-orders-column-supplier-trigger');
        await untilVisible(`kitchen-supply-orders-column-supplier-${String(ADEL.id)}`);
        await press(`kitchen-supply-orders-column-supplier-${String(ADEL.id)}`);

        await waitFor(() => {
            expect(repositories.kitchenOps.listPurchaseOrders).toHaveBeenCalledWith({
                supplierId: ADEL.id,
            });
        });

        await untilVisible('kitchen-supply-orders-column-status-trigger');
        await press('kitchen-supply-orders-column-status-trigger');
        await untilVisible('kitchen-supply-orders-column-status-issued');
        await press('kitchen-supply-orders-column-status-issued');

        await waitFor(() => {
            expect(repositories.kitchenOps.listPurchaseOrders).toHaveBeenCalledWith({
                status: 'issued',
                supplierId: ADEL.id,
            });
        });
    });

    it('filters the whole proposal by its badge before cutting it to the preview', async () => {
        await renderStubScreen(<SupplyOrdersScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    countSupplyNeeds: async () => ({
                        count: 2,
                        outOfStockCount: 1,
                        lowStockCount: 1,
                    }),
                    getOrderProposal: async () => ({
                        items: [EMPTY_SHELF, LOW_SHELF],
                        branchId: BRANCH,
                        outOfStockCount: 1,
                        lowStockCount: 1,
                        unassignedCount: 0,
                        requestedItemCount: 0,
                    }),
                    listPurchaseOrders: async () => page([]),
                    listSuppliers: async () => [],
                },
            },
        });

        await untilVisible('kitchen-supply-orders-preview');

        for (const column of ['item', 'onHand', 'reorderAt']) {
            expect(
                screen.getByTestId(`kitchen-supply-orders-preview-column-${column}-trigger`),
            ).toBeTruthy();
        }

        const empty = `${supplyOrderRowTestId(String(EMPTY_SHELF.stockItemId))}-name`;
        const low = `${supplyOrderRowTestId(String(LOW_SHELF.stockItemId))}-name`;

        await press('kitchen-supply-orders-preview-column-onHand-trigger');
        await untilVisible('kitchen-supply-orders-preview-column-onHand-low');
        await press('kitchen-supply-orders-preview-column-onHand-low');

        await waitFor(() => {
            expect(screen.queryByTestId(empty)).toBeNull();
        });
        expect(screen.getByTestId(low)).toBeTruthy();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Unpriced receipts
 * ---------------------------------------------------------------------------------------------- */

function unpricedReceipt(ordinal: number): UnpricedReceipt {
    return {
        id: GoodsReceiptId.unsafe(`01935f6d-0000-7000-8000-00000000b00${String(ordinal)}`),
        receivedOn: '2026-08-01',
        supplier: { id: ZAID.id, code: ZAID.code, nameEn: ZAID.name.en },
        documentRef: `DN-${String(ordinal)}`,
        supplierInvoiceRef: null,
        purchaseOrderId: null,
        costStatus: 'unpriced',
        lineCount: 2,
        unpricedLineCount: 2,
        valuationPendingCount: 0,
    };
}

describe('unpriced receipt headers', () => {
    it('filters by supplier through the request and leaves the unsendable columns as labels', async () => {
        const { repositories } = await renderStubScreen(<UnpricedReceiptsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listUnpricedReceipts: async () => page([unpricedReceipt(1)]),
                    listSuppliers: async () => [ZAID, ADEL],
                },
            },
        });

        await untilVisible('kitchen-unpriced-table');

        expect(
            screen.getByTestId('kitchen-unpriced-receipts-column-receivedOn-trigger'),
        ).toBeTruthy();
        // The queue is a keyset page and its filter carries no sort and no cost status.
        for (const column of ['refs', 'toPrice', 'state']) {
            expect(
                screen.queryByTestId(`kitchen-unpriced-receipts-column-${column}-trigger`),
            ).toBeNull();
        }

        await press('kitchen-unpriced-receipts-column-supplier-trigger');
        await untilVisible(`kitchen-unpriced-receipts-column-supplier-${String(ADEL.id)}`);
        await press(`kitchen-unpriced-receipts-column-supplier-${String(ADEL.id)}`);

        await waitFor(() => {
            expect(repositories.kitchenOps.listUnpricedReceipts).toHaveBeenCalledWith({
                supplierId: ADEL.id,
            });
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * Quotations
 * ---------------------------------------------------------------------------------------------- */

function quotationIdAt(ordinal: number): QuotationId {
    return `test-0000-quotation-000${String(ordinal)}` as QuotationId;
}

function quotationLine(
    ordinal: number,
    overrides: Partial<KitchenQuotationLine> = {},
): KitchenQuotationLine {
    return {
        id: `test-quotation-line-${String(ordinal)}`,
        lineNumber: ordinal,
        catalogueItemId: `test-catalogue-item-${String(ordinal)}`,
        catalogueItemVariantId: null,
        quantity: '12.0000',
        unitAmountMinor: null,
        lineTotalMinor: null,
        note: `Line ${String(ordinal)} note`,
        ...overrides,
    };
}

function quotation(overrides: Partial<KitchenQuotation> = {}): KitchenQuotation {
    return {
        id: quotationIdAt(1),
        buyerOrganisationId: 'test-0000-buyer-0001' as KitchenQuotation['buyerOrganisationId'],
        programmeId: 'test-0000-programme-0001' as KitchenQuotation['programmeId'],
        reference: 'QT-2026-0007',
        status: 'submitted',
        currencyCode: 'USD',
        notes: null,
        declineReason: null,
        submittedAt: '2026-08-10T09:00:00Z',
        quotedAt: null,
        expiresAt: null,
        decidedAt: null,
        lockVersion: 2,
        lines: [],
        ...overrides,
    };
}

const SUBMITTED = quotation();
const ACCEPTED = quotation({
    id: quotationIdAt(2),
    reference: 'QT-2026-0004',
    status: 'accepted',
    currencyCode: 'SAR',
});

const quotationReference = (row: KitchenQuotation) =>
    `${kitchenQuotationRowTestId(String(row.id))}-reference`;

describe('quotation headers', () => {
    it('filters the queue by status and by currency, in memory', async () => {
        const { repositories } = await renderStubScreen(<QuotationsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenQuotations: { listQuotations: async () => [SUBMITTED, ACCEPTED] },
            },
        });

        await untilVisible('kitchen-quotations-table');

        for (const column of ['reference', 'currency', 'submitted', 'status']) {
            expect(screen.getByTestId(`kitchen-quotations-column-${column}-trigger`)).toBeTruthy();
        }

        await press('kitchen-quotations-column-status-trigger');
        await untilVisible('kitchen-quotations-column-status-accepted');
        await press('kitchen-quotations-column-status-accepted');
        await waitFor(() => {
            expect(screen.queryByTestId(quotationReference(SUBMITTED))).toBeNull();
        });
        expect(screen.getByTestId(quotationReference(ACCEPTED))).toBeTruthy();

        // A filter value leaves its menu open, so Clear is already there to press.
        await untilVisible('kitchen-quotations-column-status-clear');
        await press('kitchen-quotations-column-status-clear');

        await press('kitchen-quotations-column-currency-trigger');
        await untilVisible('kitchen-quotations-column-currency-USD');
        await press('kitchen-quotations-column-currency-USD');
        await waitFor(() => {
            expect(screen.queryByTestId(quotationReference(ACCEPTED))).toBeNull();
        });
        expect(screen.getByTestId(quotationReference(SUBMITTED))).toBeTruthy();

        // The endpoint takes no filters: nothing here was a second read.
        expect(repositories.kitchenQuotations.listQuotations).toHaveBeenCalledTimes(1);
    });

    it('sorts the lines of the quotation being priced', async () => {
        const detail = quotation({
            lines: [quotationLine(1), quotationLine(2, { quantity: '4.0000' })],
        });

        await renderStubScreen(<QuotationsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenQuotations: {
                    listQuotations: async () => [SUBMITTED],
                    getQuotation: async () => detail,
                },
            },
        });

        await untilVisible(`${kitchenQuotationRowTestId(String(SUBMITTED.id))}-open`);
        await press(`${kitchenQuotationRowTestId(String(SUBMITTED.id))}-open`);
        await untilVisible('kitchen-quotations-detail-lines');

        const QUANTITIES = /^kitchen-quotation-line-test-quotation-line-\d+-quantity$/;
        for (const column of ['line', 'quantity', 'unitPrice', 'lineTotal']) {
            expect(
                screen.getByTestId(`kitchen-quotations-detail-lines-column-${column}-trigger`),
            ).toBeTruthy();
        }

        await press('kitchen-quotations-detail-lines-column-quantity-trigger');
        await waitFor(() => {
            expect(orderOf(QUANTITIES)).toEqual([
                'kitchen-quotation-line-test-quotation-line-2-quantity',
                'kitchen-quotation-line-test-quotation-line-1-quantity',
            ]);
        });
    });
});
