import type {
    BarcodeScan,
    IngredientBarcodeScan,
    PostGoodsReceiptRequest,
    ReceivableOrder,
    StockItem,
} from '@healthy360/api-client/contracts';
import {
    GoodsReceiptId,
    IngredientId,
    PurchaseOrderId,
    StockItemId,
    SupplierId,
} from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { TEST_BRANCH_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { focusField } from './field-focus.ts';
import { ReceiveDeliveryScreen } from './screens/receive-delivery-screen.tsx';

/**
 * Scanning a delivery on the receive-against-order page (`/kitchen/procurement/receive`).
 *
 * The rules themselves are pinned in `receive-delivery-model.test.ts`; this pins that the page uses
 * them: the first scan replaces the prefilled outstanding quantity, a second lot becomes its own
 * line on the same order line, an unverified lot holds Post back until it is ticked — Post takes the
 * reader to the tick rather than doing nothing — and what was scanned reaches the request.
 */

// Where Post takes the reader is the assertion; the focus itself is the browser's to do.
jest.mock('./field-focus.ts', () => ({ focusField: jest.fn(), focusSection: jest.fn() }));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }),
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
    usePathname: () => '/kitchen/procurement/receive',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
}));

const FLOUR = StockItemId.unsafe('01935f6d-0000-7000-8000-0000000000b1');
const FLOUR_INGREDIENT = IngredientId.unsafe('01935f6d-0000-7000-8000-0000000000f1');
const ORDER = PurchaseOrderId.unsafe('01935f6d-0000-7000-8000-0000000000c1');
const SUPPLIER = SupplierId.unsafe('01935f6d-0000-7000-8000-0000000000a1');

const SHELVES: readonly StockItem[] = [
    {
        id: FLOUR,
        code: 'ING-0001',
        nameEn: 'Flour',
        unitCode: 'kg',
        ingredientId: FLOUR_INGREDIENT,
        catalogueItemId: null,
        backing: 'ingredient',
        isStocked: true,
        hasHistory: true,
    },
];

const ORDER_ROW: ReceivableOrder = {
    id: ORDER,
    number: 'SO-2026-0040',
    status: 'issued',
    branchId: TEST_BRANCH_ID,
    supplier: { id: SUPPLIER, code: 'MILL', nameEn: 'The Mill' },
    issuedAt: '2026-10-20T08:00:00Z',
    lineCount: 1,
    outstandingLineCount: 1,
    lines: [
        {
            purchaseOrderLineId: 'po-line-flour',
            stockItemId: FLOUR,
            itemCode: 'ING-0001',
            itemNameEn: 'Flour',
            itemNameAr: null,
            unitCode: 'kg',
            unitId: 'unit-kg',
            orderedQuantity: '50',
            receivedQuantity: '0',
            outstandingQuantity: '50',
        },
    ],
};

function scanned(lot: string, boundaryVerified = true): IngredientBarcodeScan {
    return {
        gtin: '04006381333931',
        supplierLot: lot,
        expiresOn: '2026-12-31',
        bestBeforeOn: null,
        boundaryVerified,
        originHint: 'supplier',
        link: {
            id: 'barcode-1',
            ingredientId: FLOUR_INGREDIENT,
            nameEn: 'Flour',
            nameAr: null,
            origin: 'supplier',
            packQuantity: '25.0000',
            packUnitCode: 'kg',
        },
    };
}

async function scan(code: string) {
    await act(async () => {
        fireEvent.changeText(screen.getByTestId('kitchen-receive-scan-code-input'), code);
    });
    await act(async () => {
        fireEvent(screen.getByTestId('kitchen-receive-scan-code-input'), 'submitEditing');
    });
}

it('replaces the prefill, splits a second lot, and holds an unverified lot until it is ticked', async () => {
    const posted: PostGoodsReceiptRequest[] = [];
    await renderStubScreen(<ReceiveDeliveryScreen order={String(ORDER)} />, {
        session: kitchenManagerSession(),
        repositories: {
            kitchenOps: {
                listReceivableOrders: async () => [ORDER_ROW],
                listStockItems: async () => SHELVES,
                scanIngredientBarcode: async (request: BarcodeScan) =>
                    request.data === 'LOOSE' ? scanned('B2', false) : scanned('A1'),
                postGoodsReceipt: async (request: PostGoodsReceiptRequest) => {
                    posted.push(request);
                    return {
                        id: GoodsReceiptId.unsafe('01935f6d-0000-7000-8000-0000000000e1'),
                        receivedOn: null,
                        costStatus: 'unpriced' as const,
                    };
                },
            },
        },
    });

    await waitFor(
        () => {
            expect(screen.getByTestId('kitchen-receive-line-0-quantity-input').props.value).toBe(
                '50',
            );
        },
        { timeout: 10_000 },
    );

    await scan('4006381333931');
    await waitFor(() => {
        expect(screen.getByTestId('kitchen-receive-line-0-quantity-input').props.value).toBe('25');
    });
    expect(screen.getByTestId('kitchen-receive-line-0-trace-lot-input').props.value).toBe('A1');

    // A second lot, read without a separator: its own line, and a lot to check.
    await scan('LOOSE');
    await waitFor(() => {
        expect(screen.getByTestId('kitchen-receive-line-1-quantity-input').props.value).toBe('25');
    });
    expect(screen.getByTestId('kitchen-receive-lot-check')).toBeTruthy();
    // 25 + 25 of 50: neither short nor over, so nothing asks to close the order short.
    expect(screen.queryByTestId('kitchen-receive-close-short')).toBeNull();
    expect(screen.queryByTestId('kitchen-receive-over-receipt')).toBeNull();
    // Post is held, never dead: pressed now, it opens no confirmation and goes to the lot to tick.
    jest.mocked(focusField).mockClear();
    await act(async () => {
        fireEvent.press(screen.getByTestId('kitchen-receive-screen-save'));
    });
    expect(screen.queryByTestId('kitchen-receive-confirm-post')).toBeNull();
    expect(focusField).toHaveBeenCalledWith('kitchen-receive-line-1-trace-lot-checked');

    await act(async () => {
        fireEvent.press(screen.getByTestId('kitchen-receive-line-1-trace-lot-checked-control'));
    });
    await waitFor(() => {
        expect(screen.queryByTestId('kitchen-receive-lot-check')).toBeNull();
    });

    await act(async () => {
        fireEvent.press(screen.getByTestId('kitchen-receive-screen-save'));
    });
    await act(async () => {
        fireEvent.press(await screen.findByTestId('kitchen-receive-confirm-post'));
    });
    await waitFor(() => {
        expect(posted).toHaveLength(1);
    });
    expect(posted[0]?.lines).toEqual([
        expect.objectContaining({
            purchaseOrderLineId: 'po-line-flour',
            quantity: 25,
            gtin: '04006381333931',
            supplierLot: 'A1',
            expiresOn: '2026-12-31',
        }),
        expect.objectContaining({
            purchaseOrderLineId: 'po-line-flour',
            quantity: 25,
            supplierLot: 'B2',
        }),
    ]);
});

it('counts two scans that answer in the same moment as two packs', async () => {
    // Both lookups are held until both scans are in, then answer together — the moment a wedge
    // scanner's second read arrives while the first is still on the network.
    let release: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
        release = resolve;
    });

    await renderStubScreen(<ReceiveDeliveryScreen order={String(ORDER)} />, {
        session: kitchenManagerSession(),
        repositories: {
            kitchenOps: {
                listReceivableOrders: async () => [ORDER_ROW],
                listStockItems: async () => SHELVES,
                scanIngredientBarcode: async () => {
                    await answered;
                    const scan = scanned('A1');
                    return scan.link === null
                        ? scan
                        : { ...scan, link: { ...scan.link, packQuantity: '10.0000' } };
                },
            },
        },
    });

    await waitFor(
        () => {
            expect(screen.getByTestId('kitchen-receive-line-0-quantity-input').props.value).toBe(
                '50',
            );
        },
        { timeout: 10_000 },
    );

    for (const code of ['4006381333931', ']E04006381333931']) {
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-receive-scan-code-input'), code);
        });
        await act(async () => {
            fireEvent(screen.getByTestId('kitchen-receive-scan-code-input'), 'submitEditing');
        });
        // Cleared on submit, not on the answer: the next read never lands on this one's tail.
        expect(screen.getByTestId('kitchen-receive-scan-code-input').props.value).toBe('');
    }

    await act(async () => {
        release();
    });

    // Both packs on one row: 10 + 10, not the second written over the first.
    await waitFor(() => {
        expect(screen.getByTestId('kitchen-receive-line-0-quantity-input').props.value).toBe('20');
    });
    expect(screen.getByTestId('kitchen-receive-line-0-trace-lot-input').props.value).toBe('A1');
    expect(screen.queryByTestId('kitchen-receive-line-1-quantity-input')).toBeNull();
});
