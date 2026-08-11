import { ApiError, conflictFailure } from '@healthy360/api-client';
import type {
    KitchenOrder,
    KitchenOrderLine,
    KitchenOrderPage,
    KitchenOrderTransitionRequest,
} from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
    KITCHEN_MANAGER_PERMISSIONS,
    TEST_BRANCH_ID,
    kitchenManagerSession,
    testActiveContext,
} from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { KdsTicketsScreen } from './kds-tickets-screen.tsx';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kds',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The wall board, against a book this file writes.
 *
 * Two things the authored data has to get right, because the board's whole argument rests on them
 * (`./kds-board.ts`):
 *
 * 1. **Branch attribution spans all three cases** — one ticket with no branch at all (an order
 *    delivered through an organisation-wide zone), one on this kitchen's branch, one on another
 *    kitchen's. That is what makes "shows this branch and unattributed work, and nothing else" an
 *    assertion rather than a coincidence.
 * 2. **Time is relative to the run**, not a frozen instant. The Ready column is bounded by
 *    `fulfilledAt` falling on *today*'s local calendar day, so a fixture pinned to a written-down
 *    date would silently stop testing the boundary the day after it was written.
 *
 * `renderStubScreen` primes `activeContext.branchId` from the session fixture, which is where the
 * board reads its branch — the `kds` area requires one (`permissions/requirements.ts`).
 */

const OTHER_BRANCH_ID = 'test-0000-branch-0002' as KitchenOrder['branchId'];

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function minutesAgo(minutes: number): string {
    return new Date(Date.now() - minutes * MINUTE_MS).toISOString();
}

function daysAgo(days: number): string {
    return new Date(Date.now() - days * DAY_MS).toISOString();
}

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
        delivery: {
            label: 'Home',
            lineOne: 'Villa 12, Street 8b',
            lineTwo: null,
            city: null,
            areaNameEn: 'Al Quoz 1',
            areaNameAr: 'القوز ١',
            areaId: null,
            windowCode: 'morning',
            requestedDate: null,
            zoneId: null,
        },
        placedAt: minutesAgo(20),
        confirmedAt: null,
        fulfilledAt: null,
        cancelledAt: null,
        cancellationReason: null,
        lockVersion: 1,
        lineCount: lines.length,
        lines,
        ...overrides,
        ...(overrides.lines === undefined ? {} : { lineCount: overrides.lines.length }),
    };
}

/**
 * Five orders spanning every attribution and every status the board has an opinion about.
 *
 * The fulfilled one was bumped on a *previous* day, so the Ready column starts empty — that is the
 * board's "today's own work" rule, and it is the reason a ticket bumped during the test lands there
 * rather than the seed doing it for free.
 */
function seedOrders(): KitchenOrder[] {
    return [
        kitchenOrder({
            id: orderIdAt(1),
            orderNumber: 'VK-2026-0148',
            // Another kitchen's ticket: it belongs on that kitchen's wall, not this one.
            branchId: OTHER_BRANCH_ID,
            status: 'placed',
            placedAt: minutesAgo(12),
        }),
        kitchenOrder({
            id: orderIdAt(2),
            orderNumber: 'VK-2026-0147',
            // Delivered through an organisation-wide zone, so no kitchen was ever named — and it is
            // still food somebody has to cook.
            branchId: null,
            status: 'placed',
            placedAt: minutesAgo(20),
            lines: [line(2, { nameEn: 'Lentil soup, 1 litre', nameAr: 'شوربة العدس، لتر' })],
        }),
        kitchenOrder({
            id: orderIdAt(3),
            orderNumber: 'VK-2026-0146',
            status: 'confirmed',
            placedAt: minutesAgo(45),
            confirmedAt: minutesAgo(40),
            lockVersion: 2,
            lines: [line(3, { nameEn: 'Family mezze platter', nameAr: 'طبق المزة العائلي' })],
        }),
        kitchenOrder({
            id: orderIdAt(4),
            orderNumber: 'VK-2026-0145',
            status: 'fulfilled',
            placedAt: daysAgo(2),
            confirmedAt: daysAgo(2),
            // Bumped on a previous day: finished work that is off today's board.
            fulfilledAt: daysAgo(2),
            lockVersion: 3,
        }),
        kitchenOrder({
            id: orderIdAt(5),
            orderNumber: 'VK-2026-0144',
            status: 'cancelled',
            placedAt: daysAgo(3),
            cancelledAt: daysAgo(3),
            cancellationReason: 'address_unreachable',
            lockVersion: 2,
        }),
    ];
}

interface OrderBook {
    readonly orders: () => readonly KitchenOrder[];
    readonly find: (id: OrderId) => KitchenOrder | undefined;
    readonly listOrders: () => KitchenOrderPage;
    readonly confirmOrder: (request: KitchenOrderTransitionRequest) => KitchenOrder;
    readonly fulfilOrder: (request: KitchenOrderTransitionRequest) => KitchenOrder;
}

/**
 * A mutable book the overrides read and write, enforcing the contract's machine and the `If-Match`
 * validator — so a bump on this board is the transition itself, and the ticket that moves does so
 * because the record moved rather than because a stub said the word.
 */
function createOrderBook(seed: KitchenOrder[] = seedOrders()): OrderBook {
    let records = seed;

    function find(id: OrderId): KitchenOrder | undefined {
        return records.find((order) => order.id === id);
    }

    function transition(
        from: KitchenOrder['status'],
        request: KitchenOrderTransitionRequest,
        patch: Partial<KitchenOrder>,
    ): KitchenOrder {
        const current = find(request.id);
        if (current === undefined) throw new Error(`no order ${String(request.id)} in this book`);
        if (current.status !== from || current.lockVersion !== request.lockVersion) {
            throw new ApiError(conflictFailure({ currentLockVersion: current.lockVersion }));
        }
        const next = { ...current, ...patch, lockVersion: current.lockVersion + 1 };
        records = records.map((order) => (order.id === next.id ? next : order));
        return next;
    }

    return {
        orders: () => records,
        find,
        listOrders: () => ({ items: records, nextCursor: null, hasMore: false }),
        confirmOrder: (request) =>
            transition('placed', request, {
                status: 'confirmed',
                confirmedAt: new Date().toISOString(),
            }),
        fulfilOrder: (request) =>
            transition('confirmed', request, {
                status: 'fulfilled',
                // Stamped now, which is what puts the ticket in today's Ready column.
                fulfilledAt: new Date().toISOString(),
            }),
    };
}

/** The kitchen manager's grant minus the one code every bump button is gated on. */
const VIEW_ONLY_PERMISSIONS = KITCHEN_MANAGER_PERMISSIONS.filter(
    (permission) => permission !== 'order.manage_organisation',
);

async function renderBoard(book: OrderBook, options: { readonly canManage?: boolean } = {}) {
    const session =
        options.canManage === false
            ? kitchenManagerSession({
                  activeContext: testActiveContext({ permissions: VIEW_ONLY_PERMISSIONS }),
              })
            : kitchenManagerSession();

    return renderStubScreen(<KdsTicketsScreen />, {
        session,
        repositories: {
            kitchenOrders: {
                listOrders: async () => book.listOrders(),
                confirmOrder: async (request) => book.confirmOrder(request),
                fulfilOrder: async (request) => book.fulfilOrder(request),
            },
        },
    });
}

function ticketId(orderId: OrderId): string {
    return `kds-ticket-${String(orderId)}`;
}

describe('kds ticket board', () => {
    it('shows this branch and unattributed work, and nothing else', async () => {
        const book = createOrderBook();
        const { repositories } = await renderBoard(book);

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-column-incoming')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        // The board asks for the book, not for a branch-narrowed slice of it: the server filter
        // would delete every unattributed order from a wall that has to show them.
        expect(repositories.kitchenOrders.listOrders).toHaveBeenCalledWith(undefined);

        // The whole point of the client-side rule: an order delivered through an organisation-wide
        // zone names no kitchen, and it is still food somebody has to cook.
        expect(screen.getByTestId(ticketId(orderIdAt(2)))).toBeTruthy();
        // This branch's own confirmed work is on the board too.
        expect(screen.getByTestId(ticketId(orderIdAt(3)))).toBeTruthy();
        // A ticket another kitchen has been given belongs on that kitchen's wall, not this one.
        expect(screen.queryByTestId(ticketId(orderIdAt(1)))).toBeNull();
        // A cancelled order is work nobody is doing — it belongs in the order book, not on a wall.
        expect(screen.queryByTestId(ticketId(orderIdAt(5)))).toBeNull();

        expect(screen.getByTestId('kds-column-incoming-count')).toHaveTextContent('1');
        expect(screen.getByTestId('kds-column-preparing-count')).toHaveTextContent('1');

        // The Ready column is today's own work, by `fulfilledAt`: the authored fulfilled order was
        // bumped on a previous day, so it is off the board rather than lingering forever.
        expect(screen.getByTestId('kds-column-done-count')).toHaveTextContent('0');
        expect(screen.getByTestId('kds-column-done-empty')).toBeTruthy();
    });

    it('starts an unattributed ticket, which moves it into preparation', async () => {
        const book = createOrderBook();
        const { repositories } = await renderBoard(book);

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-column-incoming')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        // The one placed ticket on this board is the branchless one — so this also proves that
        // unattributed work is not merely visible but actionable.
        const placed = book
            .orders()
            .find((order) => order.status === 'placed' && order.branchId === null);
        if (placed === undefined)
            throw new Error('this test authored no unattributed placed order');

        fireEvent.press(screen.getByTestId(`${ticketId(placed.id)}-start`));

        // The ticket sends the version it is displaying, and the book enforces the real machine —
        // so this is the transition itself, not a stub agreeing with the button.
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

        await waitFor(() => {
            expect(screen.getByTestId('kds-column-preparing-count')).toHaveTextContent('2');
        });
        expect(screen.getByTestId('kds-column-incoming-count')).toHaveTextContent('0');
        // Start is gone and Ready has taken its place on the same ticket.
        expect(screen.getByTestId(`${ticketId(placed.id)}-ready`)).toBeTruthy();
        expect(screen.queryByTestId(`${ticketId(placed.id)}-start`)).toBeNull();
    });

    it('marks a confirmed ticket ready, which lands it in the done column for today', async () => {
        const book = createOrderBook();
        const { repositories } = await renderBoard(book);

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-column-preparing')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        const confirmed = book.orders().find((order) => order.status === 'confirmed');
        if (confirmed === undefined) throw new Error('this test authored no confirmed order');

        fireEvent.press(screen.getByTestId(`${ticketId(confirmed.id)}-ready`));

        await waitFor(() => {
            expect(repositories.kitchenOrders.fulfilOrder).toHaveBeenCalledWith({
                id: confirmed.id,
                lockVersion: confirmed.lockVersion,
            });
        });
        await waitFor(() => {
            expect(book.find(confirmed.id)?.status).toBe('fulfilled');
        });

        // `fulfilledAt` is stamped now, so the ticket crosses into Ready rather than disappearing —
        // which is the whole reason the done column is bounded by the bump and not by the requested
        // delivery day (the order authored above carries no requested date at all).
        await waitFor(() => {
            expect(screen.getByTestId('kds-column-done-count')).toHaveTextContent('1');
        });
        expect(screen.getByTestId(ticketId(confirmed.id))).toBeTruthy();
        expect(screen.getByTestId('kds-column-preparing-count')).toHaveTextContent('0');
        expect(screen.queryByTestId(`${ticketId(confirmed.id)}-ready`)).toBeNull();
    });

    it('shows the tickets but no bump buttons to somebody who may not manage orders', async () => {
        const book = createOrderBook();
        // The view-only case is built by declaring the context payload a reader would be sent: the
        // same `activeContext`, one permission short, delivered through the same session the app
        // reads. Nothing about the board's *read* gate changes — `order.view_organisation` stays.
        await renderBoard(book, { canManage: false });

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-column-incoming')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        const placed = book
            .orders()
            .find((order) => order.status === 'placed' && order.branchId === null);
        const confirmed = book.orders().find((order) => order.status === 'confirmed');
        if (placed === undefined || confirmed === undefined) {
            throw new Error('this test authored no open orders');
        }

        // The board still reads — `order.view_organisation` is what the gate asks for — but nothing
        // on it offers a write the server would refuse.
        expect(screen.getByTestId(ticketId(placed.id))).toBeTruthy();
        expect(screen.getByTestId(ticketId(confirmed.id))).toBeTruthy();
        expect(screen.queryByTestId(`${ticketId(placed.id)}-start`)).toBeNull();
        expect(screen.queryByTestId(`${ticketId(confirmed.id)}-ready`)).toBeNull();
    });
});
