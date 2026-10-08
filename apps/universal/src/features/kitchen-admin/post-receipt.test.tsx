import type {
    ItemLatestPurchase,
    PostGoodsReceiptRequest,
    ProcurementReference,
    ReceivableOrder,
    StockItem,
} from '@healthy360/api-client/contracts';
import { GoodsReceiptId, PurchaseOrderId, StockItemId, SupplierId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { TEST_BRANCH_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { PostReceiptScreen } from './screens/post-receipt-screen.tsx';

/**
 * The Post Receipt page (`/kitchen/procurement/new`), against a world this file authors.
 *
 * 1. **A market purchase refuses on press, and says why.** Post is never greyed out: pressing it
 *    with an incomplete line names each missing field in the banner and posts nothing; completing
 *    it posts exactly the rows on screen, with no supplier and no order.
 * 2. **A price far from the last one is flagged** — the size of a slipped decimal.
 * 3. **A delivery is filled from its order.** Choosing the order prefills what is still to come —
 *    and only that — ties each row to its order line, and brings the supplier with it.
 * 4. **An over-receipt has to be said out loud.** More than was outstanding opens the confirmation
 *    and the note, both named as blockers until given, and both sent once they are.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }),
}));

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({
            push,
            replace,
            setParams: jest.fn(),
            back: jest.fn(),
            prefetch: jest.fn(),
        }),
        usePathname: () => '/kitchen/procurement/new',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
    };
});

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

async function choose(selectTestID: string, value: string) {
    await press(`${selectTestID}-trigger`);
    await act(async () => {
        fireEvent.press(await screen.findByTestId(`${selectTestID}-option-${value}`));
    });
}

async function type(testID: string, text: string) {
    await act(async () => {
        fireEvent.changeText(screen.getByTestId(testID), text);
    });
}

/* ------------------------------------------------------------------------------------------------
 * The world
 * ---------------------------------------------------------------------------------------------- */

const CHICKEN = StockItemId.unsafe('01935f6d-0000-7000-8000-0000000000b1');
const OIL = StockItemId.unsafe('01935f6d-0000-7000-8000-0000000000b2');
const QUINOA = StockItemId.unsafe('01935f6d-0000-7000-8000-0000000000b3');
const SUPPLIER = SupplierId.unsafe('01935f6d-0000-7000-8000-0000000000a1');
const ORDER = PurchaseOrderId.unsafe('01935f6d-0000-7000-8000-0000000000c1');
const KG = 'unit-kg';
const LITRE = 'unit-l';

function shelf(id: StockItemId, code: string, nameEn: string, unitCode: string): StockItem {
    return {
        id,
        code,
        nameEn,
        unitCode,
        ingredientId: null,
        catalogueItemId: null,
        backing: 'ingredient',
        isStocked: true,
        hasHistory: true,
    };
}

const STOCK_ITEMS: readonly StockItem[] = [
    shelf(CHICKEN, 'ING-0031', 'Chicken breast, fresh', 'kg'),
    shelf(OIL, 'ING-0009', 'Olive oil, extra virgin', 'l'),
    shelf(QUINOA, 'ING-0104', 'Quinoa, white', 'kg'),
];

const REFERENCE: ProcurementReference = {
    currencies: [],
    defaultCurrencyCode: 'USD',
    measurementUnits: [
        { id: KG, code: 'kg', dimension: 'mass', nameEn: 'Kilogram' },
        { id: 'unit-g', code: 'g', dimension: 'mass', nameEn: 'Gram' },
        { id: LITRE, code: 'l', dimension: 'volume', nameEn: 'Litre' },
    ],
};

const OPEN_ORDER: ReceivableOrder = {
    id: ORDER,
    number: 'SO-2026-0035',
    status: 'partially_received',
    branchId: TEST_BRANCH_ID,
    supplier: { id: SUPPLIER, code: 'BEQAA-FRESH', nameEn: 'Beqaa Fresh Produce' },
    issuedAt: '2026-09-20T08:00:00Z',
    lineCount: 3,
    outstandingLineCount: 2,
    lines: [
        {
            purchaseOrderLineId: 'po-line-chicken',
            stockItemId: CHICKEN,
            itemCode: 'ING-0031',
            itemNameEn: 'Chicken breast, fresh',
            itemNameAr: null,
            unitCode: 'kg',
            unitId: KG,
            orderedQuantity: '40',
            receivedQuantity: '16',
            outstandingQuantity: '24',
        },
        {
            purchaseOrderLineId: 'po-line-oil',
            stockItemId: OIL,
            itemCode: 'ING-0009',
            itemNameEn: 'Olive oil, extra virgin',
            itemNameAr: null,
            unitCode: 'l',
            unitId: LITRE,
            orderedQuantity: '30',
            receivedQuantity: '30',
            outstandingQuantity: '0',
        },
        {
            purchaseOrderLineId: 'po-line-quinoa',
            stockItemId: QUINOA,
            itemCode: 'ING-0104',
            itemNameEn: 'Quinoa, white',
            itemNameAr: null,
            unitCode: 'kg',
            unitId: KG,
            orderedQuantity: '20',
            receivedQuantity: '0',
            outstandingQuantity: '20',
        },
    ],
};

const CHICKEN_LAST: ItemLatestPurchase = {
    stockItemId: CHICKEN,
    supplier: null,
    goodsReceiptId: GoodsReceiptId.unsafe('01935f6d-0000-7000-8000-0000000000d1'),
    documentRef: 'DN-4400',
    receivedAt: '2026-09-01T08:00:00Z',
    quantity: '20',
    unitId: KG,
    unitCode: 'kg',
    unitPriceAmount: '2.000000',
    costCurrencyCode: 'USD',
};

function world(posted: PostGoodsReceiptRequest[]) {
    return {
        kitchenOps: {
            listSuppliers: async () => [],
            listStockItems: async () => STOCK_ITEMS,
            getProcurementReference: async () => REFERENCE,
            listReceivableOrders: async () => [OPEN_ORDER],
            listItemLatestPurchases: async () => [CHICKEN_LAST],
            postGoodsReceipt: async (request: PostGoodsReceiptRequest) => {
                posted.push(request);
                return {
                    id: GoodsReceiptId.unsafe('01935f6d-0000-7000-8000-0000000000e1'),
                    receivedOn: request.receivedOn ?? null,
                    costStatus: 'complete' as const,
                };
            },
        },
    };
}

const LINES = 'kitchen-procurement-post-lines';

/* ------------------------------------------------------------------------------------------------
 * The market purchase
 * ---------------------------------------------------------------------------------------------- */

describe('post a goods receipt — a market purchase', () => {
    it('names what stops the post on press, then posts exactly the rows on screen', async () => {
        const posted: PostGoodsReceiptRequest[] = [];
        await renderStubScreen(<PostReceiptScreen />, {
            session: kitchenManagerSession(),
            repositories: world(posted),
        });

        await untilVisible(`${LINES}-row-line-first-item`);
        expect(screen.getByTestId('kitchen-post-receipt-rises-empty')).toBeTruthy();

        // Pressed with an empty line: the banner names it, and nothing is sent.
        await press('kitchen-procurement-post-confirm');
        await untilVisible('kitchen-post-receipt-screen-issues-errors');
        expect(screen.getByText('2 things to fix before this can post')).toBeTruthy();
        expect(screen.getByText('Line 1 — stock item')).toBeTruthy();
        expect(screen.getByText('Line 1 — quantity')).toBeTruthy();
        expect(posted).toHaveLength(0);

        await choose(`${LINES}-row-line-first-item`, String(CHICKEN));
        await type(`${LINES}-row-line-first-quantity-input`, '24');
        await type(`${LINES}-row-line-first-unit-price-input`, '2.10');

        // The aside says what the shelves will read after.
        await untilVisible('kitchen-post-receipt-rises');
        expect(screen.getByText('+24 kg')).toBeTruthy();
        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-post-receipt-screen-issues-errors')).toBeNull();
        });

        await press('kitchen-procurement-post-confirm');
        await waitFor(() => {
            expect(posted).toHaveLength(1);
        });
        expect(posted[0]).toMatchObject({
            branchId: TEST_BRANCH_ID,
            supplierId: null,
            purchaseOrderId: null,
            lines: [
                {
                    stockItemId: CHICKEN,
                    quantity: 24,
                    unitId: KG,
                    unitPriceAmount: 2.1,
                    costCurrencyCode: 'USD',
                },
            ],
        });
        expect(posted[0]?.lines[0]).not.toHaveProperty('purchaseOrderLineId');
    });

    it('flags a price ten per cent or more from the last one paid', async () => {
        await renderStubScreen(<PostReceiptScreen />, {
            session: kitchenManagerSession(),
            repositories: world([]),
        });

        await untilVisible(`${LINES}-row-line-first-item`);
        await choose(`${LINES}-row-line-first-item`, String(CHICKEN));
        await waitFor(() => {
            expect(screen.getByText('Last paid 2.00 / kg')).toBeTruthy();
        });

        await type(`${LINES}-row-line-first-unit-price-input`, '2.50');
        await waitFor(() => {
            expect(screen.getByText('+25% on last 2.00')).toBeTruthy();
        });
    });

    it('labels a stock item by its name once, and by its code only where two share a name', async () => {
        const twin = StockItemId.unsafe('01935f6d-0000-7000-8000-0000000000b4');
        const base = world([]);
        await renderStubScreen(<PostReceiptScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    ...base.kitchenOps,
                    listStockItems: async () => [
                        ...STOCK_ITEMS,
                        shelf(twin, 'quinoa-white-2', 'Quinoa, white', 'kg'),
                    ],
                },
            },
        });

        await untilVisible(`${LINES}-row-line-first-item`);
        await press(`${LINES}-row-line-first-item-trigger`);
        const chicken = await screen.findByTestId(`${LINES}-row-line-first-item-option-${CHICKEN}`);
        expect(chicken.props.accessibilityLabel).toBe('Chicken breast, fresh');
        expect(screen.queryByText('ING-0031')).toBeNull();
        // The two quinoa shelves carry their codes on the second line, and only they do.
        expect(screen.getByText('ING-0104')).toBeTruthy();
        expect(screen.getByText('quinoa-white-2')).toBeTruthy();
    });

    it('marks a negative quantity as it is typed, and refuses to post it', async () => {
        const posted: PostGoodsReceiptRequest[] = [];
        await renderStubScreen(<PostReceiptScreen />, {
            session: kitchenManagerSession(),
            repositories: world(posted),
        });

        await untilVisible(`${LINES}-row-line-first-item`);
        await choose(`${LINES}-row-line-first-item`, String(CHICKEN));
        await type(`${LINES}-row-line-first-quantity-input`, '-5');

        // Before any press: the field says so, and the banner is not involved yet.
        await waitFor(() => {
            expect(screen.getAllByText('Must be above 0').length).toBeGreaterThan(0);
        });
        expect(screen.getByTestId(`${LINES}-row-line-first-quantity-input`).props).toMatchObject({
            'aria-invalid': true,
        });
        expect(screen.queryByTestId('kitchen-post-receipt-screen-issues-errors')).toBeNull();

        await press('kitchen-procurement-post-confirm');
        await untilVisible('kitchen-post-receipt-screen-issues-errors');
        expect(screen.getByText('Line 1 — quantity')).toBeTruthy();
        expect(posted).toHaveLength(0);

        await type(`${LINES}-row-line-first-quantity-input`, '5');
        await waitFor(() => {
            expect(screen.queryByText('Must be above 0')).toBeNull();
        });
    });

    it('marks a price that does not read as it is typed, and refuses to post it', async () => {
        const posted: PostGoodsReceiptRequest[] = [];
        await renderStubScreen(<PostReceiptScreen />, {
            session: kitchenManagerSession(),
            repositories: world(posted),
        });

        await untilVisible(`${LINES}-row-line-first-item`);
        await choose(`${LINES}-row-line-first-item`, String(CHICKEN));
        await type(`${LINES}-row-line-first-quantity-input`, '24');
        await type(`${LINES}-row-line-first-unit-price-input`, '-2');

        await waitFor(() => {
            expect(screen.getAllByText('Not a valid price').length).toBeGreaterThan(0);
        });
        // The problem takes the slot the "Last paid" note would have had.
        expect(screen.queryByText('Last paid 2.00 / kg')).toBeNull();

        await press('kitchen-procurement-post-confirm');
        await untilVisible('kitchen-post-receipt-screen-issues-errors');
        expect(screen.getByText('Line 1 — unit price')).toBeTruthy();
        expect(posted).toHaveLength(0);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The delivery against an order
 * ---------------------------------------------------------------------------------------------- */

describe('post a goods receipt — a delivery against an order', () => {
    it('fills what is still to come, and makes an over-receipt say so and say why', async () => {
        const posted: PostGoodsReceiptRequest[] = [];
        await renderStubScreen(<PostReceiptScreen />, {
            session: kitchenManagerSession(),
            repositories: world(posted),
        });

        await untilVisible('kitchen-post-receipt-arrival-order');
        await press('kitchen-post-receipt-arrival-order');
        await untilVisible('kitchen-procurement-post-order');
        await choose('kitchen-procurement-post-order', String(ORDER));

        // Two rows: the oil has all arrived already, so it is not asked for again.
        const chickenRow = `${LINES}-row-order-line-po-line-chicken`;
        await untilVisible(`${chickenRow}-quantity`);
        expect(screen.getByTestId(`${LINES}-row-order-line-po-line-quinoa-quantity`)).toBeTruthy();
        expect(screen.queryByTestId(`${LINES}-row-order-line-po-line-oil-quantity`)).toBeNull();
        expect(screen.getByTestId(`${chickenRow}-quantity-input`).props.value).toBe('24');
        expect(screen.getByText('Delivery on SO-2026-0035')).toBeTruthy();

        // More chicken than was still on order.
        await type(`${chickenRow}-quantity-input`, '30');
        await untilVisible('kitchen-procurement-post-variance');

        await press('kitchen-procurement-post-confirm');
        await untilVisible('kitchen-post-receipt-screen-issues-errors');
        expect(screen.getByText('Over-receipt — confirm it')).toBeTruthy();
        expect(screen.getByText('Why this delivery differs — say why')).toBeTruthy();
        expect(posted).toHaveLength(0);

        await press('kitchen-procurement-post-over-confirm-control');
        await type('kitchen-procurement-post-variance-note-input', 'Supplier sent a full case.');

        await press('kitchen-procurement-post-confirm');
        await waitFor(() => {
            expect(posted).toHaveLength(1);
        });
        expect(posted[0]).toMatchObject({
            supplierId: SUPPLIER,
            purchaseOrderId: ORDER,
            overReceiptConfirmed: true,
            varianceNote: 'Supplier sent a full case.',
            lines: [
                { stockItemId: CHICKEN, quantity: 30, purchaseOrderLineId: 'po-line-chicken' },
                { stockItemId: QUINOA, quantity: 20, purchaseOrderLineId: 'po-line-quinoa' },
            ],
        });
    });
});
