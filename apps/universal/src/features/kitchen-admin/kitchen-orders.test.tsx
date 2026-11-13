import type {
    KitchenOrderFilters,
    KitchenOrderPage,
    KitchenOrderTransitionRequest,
    OrderDeskDeliveryWindow,
    OrderDeskQueue,
    OrderDeskQueueFilters,
    OrderDeskQueueRow,
} from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { withDeskWidth } from '../../testing/desk-width.ts';
import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import type { ExpoRouterMock } from '../../testing/expo-router-mock.ts';
import { addDays } from '../planner/format.ts';
import { localToday } from './orders/order-book.ts';
import type { BookRow } from './orders/order-book.ts';
import { OrdersScreen } from './screens/orders-screen.tsx';

jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../testing/expo-router-mock.ts').createExpoRouterMock({
        pathname: '/kitchen/orders',
    }),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as ExpoRouterMock;

/**
 * The Orders page (Option A): one page, three tabs, one pop-up — against an order book this file
 * writes. Today reads the day from the book (every status, with the customer and the money) and the
 * late ones from earlier days from the desk queue; All orders reads numbered pages; every row ends
 * in its next step; and the old addresses still arrive.
 */

const TODAY = localToday();
const YESTERDAY = addDays(TODAY, -1);

function row(ordinal: number, overrides: Partial<OrderDeskQueueRow> = {}): OrderDeskQueueRow {
    return {
        id: `order-${String(ordinal)}` as OrderId,
        orderNumber: `ORD-TEST00000${String(ordinal)}`,
        branchId: null,
        status: 'placed',
        currencyCode: 'USD',
        subtotalMinor: 1400,
        deliveryFeeMinor: 200,
        totalMinor: 1600,
        paymentMethod: 'cash_on_delivery',
        fulfilmentType: 'delivery',
        delivery: {
            label: null,
            lineOne: 'Sursock St, Bldg 14',
            lineTwo: null,
            city: null,
            areaNameEn: 'Achrafieh',
            areaNameAr: null,
            areaId: null,
            windowCode: 'lunch',
            requestedDate: TODAY,
            zoneId: null,
        },
        placedAt: `${YESTERDAY}T10:00:00Z`,
        confirmedAt: null,
        fulfilledAt: null,
        cancelledAt: null,
        cancellationReason: null,
        lockVersion: 4,
        customerAccountId: null,
        amendable: true,
        allergy: null,
        lineCount: 1,
        lines: [
            {
                id: `line-${String(ordinal)}`,
                catalogueItemId: 'item-1',
                catalogueItemVariantId: null,
                nameEn: 'Grilled Salmon Bowl',
                nameAr: 'وعاء السلمون',
                variantLabel: null,
                quantity: '1.000',
                unitPriceMinor: 1400,
                lineTotalMinor: 1400,
                currencyCode: 'USD',
                allergens: [],
                packSummary: null,
                priceListId: null,
                priceListItemId: null,
            },
        ],
        dueAt: `${TODAY}T23:00:00Z`,
        payment: { method: 'cash_on_delivery', receivedMinor: 0, receipted: false },
        deliveryJob: null,
        customer: { displayName: 'Rania Haddad', phone: '+96170214380' },
        ...overrides,
    };
}

const BREAKFAST = row(1, {
    status: 'fulfilled',
    delivery: { ...row(1).delivery, windowCode: 'breakfast' },
    payment: { method: 'cash_on_delivery', receivedMinor: 1600, receipted: true },
});
const LUNCH = row(2);
const LATE = row(3, {
    status: 'confirmed',
    delivery: { ...row(3).delivery, requestedDate: YESTERDAY },
    dueAt: `${YESTERDAY}T10:00:00Z`,
    customer: { displayName: 'Karim Saleh', phone: '+96171552019' },
});

const WINDOWS: readonly OrderDeskDeliveryWindow[] = [
    {
        code: 'breakfast',
        nameEn: 'Breakfast',
        nameAr: '',
        startsAt: '08:00:00',
        endsAt: '10:00:00',
    },
    { code: 'lunch', nameEn: 'Lunch', nameAr: '', startsAt: '12:00:00', endsAt: '14:00:00' },
];

function page(items: readonly BookRow[], extra: Partial<KitchenOrderPage> = {}): KitchenOrderPage {
    return { items, nextCursor: null, hasMore: false, ...extra };
}

function queue(rows: readonly OrderDeskQueueRow[]): OrderDeskQueue {
    return {
        rows,
        meta: {
            count: rows.length,
            limit: 200,
            truncated: false,
            window: 'today',
            from: null,
            to: null,
            today: TODAY,
            timezone: 'UTC',
            pastDueCount: rows.length,
            overdueCount: rows.length,
            overdueGraceMinutes: 15,
        },
    };
}

/** The book answers by filter, the way the endpoint does. */
async function listOrders(filters?: KitchenOrderFilters): Promise<KitchenOrderPage> {
    if (filters?.page !== undefined) {
        const book = [LUNCH, BREAKFAST, LATE].filter(
            (candidate) => filters.status === undefined || candidate.status === filters.status,
        );
        return { ...page(book), totalCount: book.length, totalPages: 1 };
    }
    if (filters?.status === 'placed') return page([LUNCH]);
    if (filters?.status === 'fulfilled') return page([]);
    if (filters?.from === TODAY) return page([LUNCH, BREAKFAST]);
    if (filters?.from === YESTERDAY) return page([LATE]);
    return page([]);
}

async function listQueue(filters?: OrderDeskQueueFilters): Promise<OrderDeskQueue> {
    if (filters?.lens === 'past_due') return queue([LATE]);
    return queue([]);
}

const confirmOrder = jest.fn(async (request: KitchenOrderTransitionRequest) => ({
    ...LUNCH,
    status: 'confirmed' as const,
    lockVersion: request.lockVersion + 1,
}));

async function renderOrders(params: Record<string, string> = {}) {
    routerMock.__set({ params });
    return renderStubScreen(<OrdersScreen />, {
        session: kitchenManagerSession(),
        repositories: {
            kitchenOrders: {
                listOrders,
                getOrder: async (id: OrderId) =>
                    [LUNCH, BREAKFAST, LATE].find((candidate) => candidate.id === id) ?? LUNCH,
                confirmOrder,
            },
            orderDesk: {
                listQueue,
                listDeliveryWindows: async () => WINDOWS,
                listDrivers: async () => ({ rows: [], limit: 100 }),
                listCalendar: async (filters) => ({
                    days: [],
                    meta: { from: filters.from, to: filters.to, dayCount: 0, maxWindowDays: 60 },
                }),
            },
        },
    });
}

beforeEach(() => {
    routerMock.__reset();
    confirmOrder.mockClear();
});

/** Found within the time a signed-in screen takes to read its answers. */
function find(testID: string) {
    return screen.findByTestId(testID, {}, { timeout: 8000 });
}

/** A press, with whatever it starts settled before the case goes on — or ends. */
async function press(element: Parameters<typeof fireEvent.press>[0]) {
    await act(async () => {
        fireEvent.press(element);
    });
}

/** Every case reads the table, which draws its columns from a desk's width up. */
function atDesk(run: () => Promise<void>): () => Promise<void> {
    return () => withDeskWidth(run);
}

describe('orders — Today', () => {
    it(
        'lists the day by slot, with the late ones from earlier days first',
        atDesk(async () => {
            await renderOrders();

            await find('kitchen-orders-group-late');
            expect(screen.getByTestId('kitchen-orders-group-breakfast')).toBeTruthy();
            expect(screen.getByTestId('kitchen-orders-group-lunch')).toBeTruthy();

            // The row says the customer, the day and slot, and the money — no second page to open.
            expect(screen.getByTestId('kitchen-order-order-2-customer')).toHaveTextContent(
                /Rania Haddad/,
            );
            expect(screen.getByTestId('kitchen-order-order-2-when')).toHaveTextContent(
                'Today · Lunch',
            );
            expect(screen.getByTestId('kitchen-order-order-1-payment')).toHaveTextContent(/Paid/);
            expect(screen.getByTestId('kitchen-order-order-2-payment')).toHaveTextContent(
                /To collect/,
            );
            expect(screen.getByTestId('kitchen-order-order-3-late')).toBeTruthy();

            // The tab says how many orders the day holds.
            expect(screen.getByTestId('kitchen-orders-tab-today')).toHaveTextContent(/Today\s*2/);
        }),
    );

    it(
        'confirms from the row with the version the row was read at',
        atDesk(async () => {
            await renderOrders();

            await press(await find('kitchen-order-order-2-next'));

            await waitFor(() => {
                expect(confirmOrder).toHaveBeenCalledWith({ id: 'order-2', lockVersion: 4 });
            });
        }),
    );

    it(
        'opens All orders on a figure, with the figure as a removable chip',
        atDesk(async () => {
            await renderOrders();

            await press(await find('kitchen-orders-today-toolbar-figure-confirm'));

            expect(routerMock.__router.setParams).toHaveBeenCalledWith(
                expect.objectContaining({ tab: 'all', quick: 'confirm' }),
            );
        }),
    );
});

describe('orders — All orders', () => {
    it(
        'reads the book a numbered page at a time, newest first',
        atDesk(async () => {
            const { repositories } = await renderOrders({ tab: 'all', status: 'confirmed' });

            await find('kitchen-order-order-3-number');
            expect(screen.queryByTestId('kitchen-order-order-2-number')).toBeNull();
            expect(repositories.kitchenOrders.listOrders).toHaveBeenCalledWith(
                expect.objectContaining({ page: 1, limit: 18, status: 'confirmed' }),
            );
        }),
    );

    it(
        'shows a figure’s own list with its chip',
        atDesk(async () => {
            await renderOrders({ tab: 'all', quick: 'confirm' });

            expect(await find('kitchen-orders-all-toolbar-token-quick')).toHaveTextContent(
                /Showing: To confirm/,
            );
            expect(await find('kitchen-order-order-2-number')).toBeTruthy();
            expect(screen.queryByTestId('kitchen-order-order-1-number')).toBeNull();
        }),
    );
});

describe('orders — the pop-up', () => {
    it(
        'opens from the old book’s ?view= link on All orders',
        atDesk(async () => {
            await renderOrders({ view: 'order-2' });

            expect(await find('kitchen-orders-record')).toBeTruthy();
            expect(screen.getByTestId('kitchen-orders-tab-all')).toBeTruthy();
            await waitFor(() => {
                expect(screen.getByTestId('kitchen-orders-record-title')).toHaveTextContent(
                    /ORD-TEST000002/,
                );
            });
        }),
    );

    it(
        'says Back on its dialogs, and Cancel only for cancelling the order',
        atDesk(async () => {
            await renderOrders({ tab: 'today', view: 'order-2' });

            await press(await find('kitchen-orders-record-payment-open'));
            const payment = await find('kitchen-orders-payment');
            expect(within(payment).getByTestId('kitchen-orders-payment-back')).toHaveTextContent(
                /Back/,
            );
            await press(within(payment).getByTestId('kitchen-orders-payment-back'));

            await press(await find('kitchen-orders-record-cancel'));
            const cancel = await find('kitchen-orders-cancel-dialog');
            expect(within(cancel).getByTestId('kitchen-orders-cancel-dismiss')).toHaveTextContent(
                /Keep the order/,
            );
        }),
    );
});

describe('orders — the day stepper', () => {
    it(
        'steps the day in the address, so a detour comes back to it',
        atDesk(async () => {
            await renderOrders();

            await press(await find('kitchen-orders-day-next'));

            expect(routerMock.__router.setParams).toHaveBeenCalledWith(
                expect.objectContaining({ tab: 'today', day: addDays(TODAY, 1) }),
            );
        }),
    );
});
