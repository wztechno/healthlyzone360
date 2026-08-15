import { ApiError, conflictFailure } from '@healthy360/api-client';
import type {
    CancelKitchenOrderRequest,
    KitchenOrder,
    KitchenOrderFilters,
    KitchenOrderLine,
    KitchenOrderPage,
    KitchenOrderStatus,
    KitchenOrderTransitionRequest,
} from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { TEST_BRANCH_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { OrdersScreen } from './screens/orders-screen.tsx';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/orders',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The order book, against an order book this file writes.
 *
 * Everything the screen reads is authored below, and the three lifecycle writes go through
 * {@link createOrderBook} — a closure that enforces the contract's own machine
 * (`contracts/kitchen-orders.ts`: `placed → confirmed → fulfilled`, cancel from the two open
 * statuses, `If-Match` on the lock version) and hands back the fresh record. That is deliberate
 * rather than a stub returning a canned answer: the panel's "Confirm then Fulfil without a refetch"
 * behaviour only means anything if the version it sends the second time came from the first write.
 */

const OTHER_BRANCH_ID = 'test-0000-branch-0002' as KitchenOrder['branchId'];

function orderIdAt(ordinal: number): OrderId {
    return `test-0000-order-000${String(ordinal)}` as OrderId;
}

function line(ordinal: number, overrides: Partial<KitchenOrderLine> = {}): KitchenOrderLine {
    return {
        id: `test-order-line-${String(ordinal)}`,
        catalogueItemId: `test-catalogue-item-${String(ordinal)}`,
        catalogueItemVariantId: null,
        nameEn: `Dish ${String(ordinal)}`,
        nameAr: `طبق ${String(ordinal)}`,
        variantLabel: null,
        quantity: '1.000',
        unitPriceMinor: 5_000,
        lineTotalMinor: 5_000,
        currencyCode: 'AED',
        allergens: [],
        packSummary: null,
        priceListId: null,
        priceListItemId: null,
        ...overrides,
    };
}

const DELIVERY: KitchenOrder['delivery'] = {
    label: 'Home',
    lineOne: 'Villa 12, Street 8b',
    lineTwo: null,
    city: null,
    areaNameEn: 'Al Quoz 1',
    areaNameAr: 'القوز ١',
    areaId: null,
    windowCode: 'morning',
    requestedDate: '2026-08-08',
    zoneId: null,
};

function kitchenOrder(overrides: Partial<KitchenOrder> = {}): KitchenOrder {
    const lines = overrides.lines ?? [line(1)];
    return {
        id: orderIdAt(1),
        orderNumber: 'VK-2026-0100',
        branchId: TEST_BRANCH_ID,
        status: 'placed',
        currencyCode: 'AED',
        subtotalMinor: 5_000,
        deliveryFeeMinor: null,
        totalMinor: 5_000,
        paymentMethod: 'cash_on_delivery',
        delivery: DELIVERY,
        placedAt: '2026-08-06T07:12:00Z',
        confirmedAt: null,
        fulfilledAt: null,
        cancelledAt: null,
        cancellationReason: null,
        lockVersion: 1,
        lineCount: lines.length,
        lines,
        ...overrides,
        // Derived after the spread so an override cannot claim a count its own lines contradict.
        ...(overrides.lines === undefined ? {} : { lineCount: overrides.lines.length }),
    };
}

/**
 * Five orders, newest first — the order the endpoint answers in. Two `placed`, one `confirmed`, one
 * `fulfilled`, one `cancelled`, which is what makes every metric and every filter assertion below a
 * count of something this file authored rather than of something it hopes exists.
 *
 * The newest carries the money the detail assertions read: 14 500 + 1 500 delivery = 16 000 minor
 * units, which the currency's own exponent turns into AED 145.00 and AED 160.00 exactly once.
 */
function seedOrders(): KitchenOrder[] {
    return [
        kitchenOrder({
            id: orderIdAt(1),
            orderNumber: 'VK-2026-0148',
            // Verdant's *other* kitchen: in this manager's book, and never on Al Quoz's wall.
            branchId: OTHER_BRANCH_ID,
            status: 'placed',
            subtotalMinor: 14_500,
            deliveryFeeMinor: 1_500,
            totalMinor: 16_000,
            placedAt: '2026-08-06T07:12:00Z',
            lines: [
                line(1, {
                    nameEn: 'Grilled chicken bowl',
                    nameAr: 'وعاء الدجاج المشوي',
                    quantity: '2.000',
                    unitPriceMinor: 4_500,
                    lineTotalMinor: 9_000,
                }),
                line(2, {
                    nameEn: 'Green harvest salad',
                    nameAr: 'سلطة الحصاد الأخضر',
                    unitPriceMinor: 5_500,
                    lineTotalMinor: 5_500,
                }),
            ],
        }),
        kitchenOrder({
            id: orderIdAt(2),
            orderNumber: 'VK-2026-0147',
            // Delivered through an organisation-wide zone, so no kitchen was ever named.
            branchId: null,
            status: 'placed',
            subtotalMinor: 7_200,
            deliveryFeeMinor: null,
            totalMinor: 7_200,
            placedAt: '2026-08-06T06:40:00Z',
            lines: [
                line(3, {
                    nameEn: 'Lentil soup, 1 litre',
                    nameAr: 'شوربة العدس، لتر',
                    quantity: '1.500',
                    unitPriceMinor: 4_800,
                    lineTotalMinor: 7_200,
                }),
            ],
        }),
        kitchenOrder({
            id: orderIdAt(3),
            orderNumber: 'VK-2026-0146',
            status: 'confirmed',
            subtotalMinor: 23_400,
            deliveryFeeMinor: 1_500,
            totalMinor: 24_900,
            placedAt: '2026-08-05T15:02:00Z',
            confirmedAt: '2026-08-05T15:48:00Z',
            lockVersion: 2,
            lines: [
                line(4, {
                    nameEn: 'Family mezze platter',
                    nameAr: 'طبق المزة العائلي',
                    unitPriceMinor: 15_000,
                    lineTotalMinor: 15_000,
                }),
                line(5, {
                    nameEn: 'Herb flatbread, 6 pieces',
                    nameAr: 'خبز الأعشاب، ٦ قطع',
                    quantity: '3.000',
                    unitPriceMinor: 2_800,
                    lineTotalMinor: 8_400,
                }),
            ],
        }),
        kitchenOrder({
            id: orderIdAt(4),
            orderNumber: 'VK-2026-0145',
            status: 'fulfilled',
            subtotalMinor: 9_000,
            deliveryFeeMinor: 1_500,
            totalMinor: 10_500,
            placedAt: '2026-08-04T09:20:00Z',
            confirmedAt: '2026-08-04T09:55:00Z',
            fulfilledAt: '2026-08-05T17:31:00Z',
            lockVersion: 3,
            lines: [
                line(6, {
                    nameEn: 'Grilled chicken bowl',
                    nameAr: 'وعاء الدجاج المشوي',
                    quantity: '2.000',
                    unitPriceMinor: 4_500,
                    lineTotalMinor: 9_000,
                }),
            ],
        }),
        kitchenOrder({
            id: orderIdAt(5),
            orderNumber: 'VK-2026-0144',
            status: 'cancelled',
            subtotalMinor: 5_500,
            deliveryFeeMinor: 1_500,
            totalMinor: 7_000,
            placedAt: '2026-08-03T11:05:00Z',
            cancelledAt: '2026-08-03T12:10:00Z',
            cancellationReason: 'address_unreachable',
            lockVersion: 2,
            lines: [
                line(7, {
                    nameEn: 'Green harvest salad',
                    nameAr: 'سلطة الحصاد الأخضر',
                    unitPriceMinor: 5_500,
                    lineTotalMinor: 5_500,
                }),
            ],
        }),
    ];
}

/** Which statuses each action may be taken from — the contract's machine, in one table. */
const ALLOWED_FROM: Readonly<
    Record<'confirm' | 'fulfil' | 'cancel', readonly KitchenOrderStatus[]>
> = {
    confirm: ['placed'],
    fulfil: ['confirmed'],
    cancel: ['placed', 'confirmed'],
};

interface OrderBook {
    /** The live records, so a test can assert the transition itself and not merely the call. */
    readonly orders: () => readonly KitchenOrder[];
    readonly find: (id: OrderId) => KitchenOrder | undefined;
    readonly listOrders: (filters?: KitchenOrderFilters) => KitchenOrderPage;
    readonly getOrder: (id: OrderId) => KitchenOrder;
    readonly confirmOrder: (request: KitchenOrderTransitionRequest) => KitchenOrder;
    readonly fulfilOrder: (request: KitchenOrderTransitionRequest) => KitchenOrder;
    readonly cancelOrder: (request: CancelKitchenOrderRequest) => KitchenOrder;
}

/**
 * A mutable order book the repository overrides read and write.
 *
 * The mutation is the point: `confirmOrder` moves the record and bumps its `lockVersion`, and the
 * screen's own invalidation is what brings the change back — which is the same round trip the
 * deleted fixture world exercised, now written where the assertions can see it.
 */
function createOrderBook(seed: KitchenOrder[] = seedOrders()): OrderBook {
    let records = seed;

    function find(id: OrderId): KitchenOrder | undefined {
        return records.find((order) => order.id === id);
    }

    function requireOrder(id: OrderId): KitchenOrder {
        const found = find(id);
        if (found === undefined) throw new Error(`no order ${String(id)} in this test's book`);
        return found;
    }

    function write(next: KitchenOrder): KitchenOrder {
        records = records.map((order) => (order.id === next.id ? next : order));
        return next;
    }

    function transition(
        action: 'confirm' | 'fulfil' | 'cancel',
        request: KitchenOrderTransitionRequest,
        patch: Partial<KitchenOrder>,
    ): KitchenOrder {
        const current = requireOrder(request.id);
        if (
            !ALLOWED_FROM[action].includes(current.status) ||
            current.lockVersion !== request.lockVersion
        ) {
            throw new ApiError(conflictFailure({ currentLockVersion: current.lockVersion }));
        }
        return write({ ...current, ...patch, lockVersion: current.lockVersion + 1 });
    }

    return {
        orders: () => records,
        find,
        listOrders: (filters) => {
            const items = records.filter((order) =>
                filters?.status === undefined ? true : order.status === filters.status,
            );
            return { items, nextCursor: null, hasMore: false };
        },
        getOrder: requireOrder,
        confirmOrder: (request) =>
            transition('confirm', request, {
                status: 'confirmed',
                confirmedAt: '2026-08-06T08:00:00Z',
            }),
        fulfilOrder: (request) =>
            transition('fulfil', request, {
                status: 'fulfilled',
                fulfilledAt: '2026-08-06T09:00:00Z',
            }),
        cancelOrder: (request) =>
            transition('cancel', request, {
                status: 'cancelled',
                cancelledAt: '2026-08-06T08:30:00Z',
                cancellationReason: request.reason,
            }),
    };
}

async function renderOrders(book: OrderBook) {
    return renderStubScreen(<OrdersScreen />, {
        session: kitchenManagerSession(),
        repositories: {
            kitchenOrders: {
                listOrders: async (filters) => book.listOrders(filters),
                getOrder: async (id) => book.getOrder(id),
                confirmOrder: async (request) => book.confirmOrder(request),
                fulfilOrder: async (request) => book.fulfilOrder(request),
                cancelOrder: async (request) => book.cancelOrder(request),
            },
        },
    });
}

describe('kitchen orders', () => {
    it('renders the authored order book with a status for every row', async () => {
        const book = createOrderBook();
        await renderOrders(book);

        // Cold module load under parallel jest workers can exceed the 1 s waitFor default; the
        // wait covers the suite's first render, not anything slow in the screen itself.
        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-orders-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        // Five orders authored above, across all four statuses: two placed, one confirmed.
        expect(screen.getByTestId('kitchen-orders-panel-metric-loaded-value')).toHaveTextContent(
            '5',
        );
        expect(screen.getByTestId('kitchen-orders-panel-metric-awaiting-value')).toHaveTextContent(
            '2',
        );
        expect(screen.getByTestId('kitchen-orders-panel-metric-confirmed-value')).toHaveTextContent(
            '1',
        );

        const newest = book.orders()[0];
        if (newest === undefined) throw new Error('this test authored no orders');
        expect(screen.getByTestId(`kitchen-order-${String(newest.id)}-number`)).toHaveTextContent(
            'VK-2026-0148',
        );
        expect(screen.getByTestId(`kitchen-order-${String(newest.id)}-status`)).toBeTruthy();
    });

    it('narrows the list to one status when the filter is used', async () => {
        const book = createOrderBook();
        const { repositories } = await renderOrders(book);

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-table')).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('kitchen-orders-status-fulfilled'));

        // One fulfilled order in the authored book, so the loaded count is the filter's own answer.
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-orders-panel-metric-loaded-value'),
            ).toHaveTextContent('1');
        });
        // The narrowing is the endpoint's, not a client-side sieve over the whole page.
        expect(repositories.kitchenOrders.listOrders).toHaveBeenCalledWith({
            status: 'fulfilled',
        });

        const fulfilled = book.orders().filter((order) => order.status === 'fulfilled');
        expect(fulfilled).toHaveLength(1);
        const only = fulfilled[0];
        if (only === undefined) throw new Error('this test authored no fulfilled order');
        expect(screen.getByTestId(`kitchen-order-${String(only.id)}-number`)).toBeTruthy();
        expect(screen.getByTestId('kitchen-orders-panel-metric-awaiting-value')).toHaveTextContent(
            '0',
        );
    });

    it('opens the slide-in with the order lines and its totals breakdown', async () => {
        const book = createOrderBook();
        await renderOrders(book);

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-table')).toBeTruthy();
        });

        const placed = book.orders().find((order) => order.status === 'placed');
        if (placed === undefined) throw new Error('this test authored no placed order');

        fireEvent.press(screen.getByTestId(`kitchen-order-${String(placed.id)}-open`));

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-detail-body')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-orders-detail-lines')).toBeTruthy();
        // 16 000 and 14 500 minor units, turned into major units exactly once by the currency's
        // own exponent — the reason the screen reuses `formatMoney` rather than dividing by 100.
        expect(screen.getByTestId('kitchen-orders-detail-total')).toHaveTextContent('AED 160.00');
        expect(screen.getByTestId('kitchen-orders-detail-subtotal')).toHaveTextContent(
            'AED 145.00',
        );
    });

    it('confirms a placed order and leaves the panel on the fresh record', async () => {
        const book = createOrderBook();
        const { repositories } = await renderOrders(book);

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-table')).toBeTruthy();
        });

        const placed = book.orders().find((order) => order.status === 'placed');
        if (placed === undefined) throw new Error('this test authored no placed order');

        fireEvent.press(screen.getByTestId(`kitchen-order-${String(placed.id)}-open`));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-confirm')).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('kitchen-orders-confirm'));

        // The version the panel sends is the one it read, and the book enforces the real machine —
        // so this is the transition itself, `placed → confirmed` with the lock version incremented.
        await waitFor(() => {
            expect(repositories.kitchenOrders.confirmOrder).toHaveBeenCalledWith({
                id: placed.id,
                lockVersion: placed.lockVersion,
            });
        });
        await waitFor(() => {
            const after = book.find(placed.id);
            expect(after?.status).toBe('confirmed');
            expect(after?.lockVersion).toBe(placed.lockVersion + 1);
        });

        // Confirm is gone and Fulfil has taken its place — the panel is reading the fresh record
        // the mutation seeded, which is the version the next action has to send.
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-fulfil')).toBeTruthy();
        });
        expect(screen.queryByTestId('kitchen-orders-confirm')).toBeNull();
    });

    it('requires a reason before the cancel dialog will submit', async () => {
        const book = createOrderBook();
        const { repositories } = await renderOrders(book);

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-table')).toBeTruthy();
        });

        const placed = book.orders().find((order) => order.status === 'placed');
        if (placed === undefined) throw new Error('this test authored no placed order');

        fireEvent.press(screen.getByTestId(`kitchen-order-${String(placed.id)}-open`));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-cancel')).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('kitchen-orders-cancel'));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-cancel-reasons')).toBeTruthy();
        });

        const submit = screen.getByTestId('kitchen-orders-cancel-confirm');
        expect(submit).toBeDisabled();
        expect(repositories.kitchenOrders.cancelOrder).not.toHaveBeenCalled();

        fireEvent.press(screen.getByTestId('kitchen-orders-cancel-reason-delivery_unavailable'));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-cancel-confirm')).not.toBeDisabled();
        });
        fireEvent.press(screen.getByTestId('kitchen-orders-cancel-confirm'));

        await waitFor(() => {
            expect(repositories.kitchenOrders.cancelOrder).toHaveBeenCalledWith({
                id: placed.id,
                lockVersion: placed.lockVersion,
                reason: 'delivery_unavailable',
            });
        });
        await waitFor(() => {
            const after = book.find(placed.id);
            expect(after?.status).toBe('cancelled');
            expect(after?.cancellationReason).toBe('delivery_unavailable');
        });
    });
});
