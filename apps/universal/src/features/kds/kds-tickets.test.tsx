import { ApiError, conflictFailure } from '@healthy360/api-client';
import type {
    KitchenOrder,
    KitchenDisplay,
    KitchenOrderLine,
    KitchenOrderTransitionRequest,
} from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { createInstance } from 'i18next';
import { Dimensions } from 'react-native';

import {
    KITCHEN_MANAGER_PERMISSIONS,
    TEST_BRANCH_ID,
    kitchenManagerSession,
    testActiveContext,
} from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import arKitchen from '../../../../../packages/i18n/catalogues/ar/kitchen.json';
import arMarketplace from '../../../../../packages/i18n/catalogues/ar/marketplace.json';
import { queryKeys } from '../../data/query-keys.ts';
import { addDays, todayIso } from '../commerce/dates.ts';
import { allergenLabel, allergyBanner } from '../kitchen-admin/ops-format.ts';
import { playAlertTone } from './alert-tone.ts';
import { bucketTickets, isAlarming, placedTicketIds, unseenTickets } from './kds-board.ts';
import { KDS_ALARM_TONE_MS, KDS_UNDO_MS, KdsTicketsScreen } from './kds-tickets-screen.tsx';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kds',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('./alert-tone.ts', () => ({ __esModule: true, playAlertTone: jest.fn() }));

/*
 * React Native's Jest window is 750px, just under `md`, where the board turns into lane tabs. The
 * board is a wall screen, so this file reads it at a desk's width; the tabs test narrows it itself.
 */
const JEST_WINDOW = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };

beforeAll(() => {
    Dimensions.set({
        window: { ...JEST_WINDOW.window, width: 1440, height: 900 },
        screen: { ...JEST_WINDOW.screen, width: 1440, height: 900 },
    });
});

afterAll(() => {
    Dimensions.set(JEST_WINDOW);
});

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
        fulfilmentType: 'delivery',
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
        customerAccountId: null,
        amendable: false,
        allergy: null,
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
            // Started: confirming only accepts an order, Start is what puts it in preparation.
            preparingAt: minutesAgo(38),
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

function boardOf(
    orders: readonly KitchenOrder[],
    overrides: Partial<KitchenDisplay> = {},
): KitchenDisplay {
    return {
        orders,
        truncated: false,
        alarmAfterMinutes: 5,
        unacceptedOpenMinutes: {},
        ...overrides,
    };
}

interface OrderBook {
    readonly orders: () => readonly KitchenOrder[];
    readonly find: (id: OrderId) => KitchenOrder | undefined;
    readonly getDisplay: () => KitchenDisplay;
    readonly confirmOrder: (request: KitchenOrderTransitionRequest) => KitchenOrder;
    readonly startOrder: (request: KitchenOrderTransitionRequest) => KitchenOrder;
    readonly markOrderReady: (request: KitchenOrderTransitionRequest) => KitchenOrder;
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
        getDisplay: () => boardOf(records),
        confirmOrder: (request) =>
            transition('placed', request, {
                status: 'confirmed',
                confirmedAt: new Date().toISOString(),
            }),
        // Start confirms a placed order and stamps `preparingAt`; on a confirmed one it only stamps.
        startOrder: (request) => {
            const current = find(request.id);
            const now = new Date().toISOString();
            return transition(current?.status === 'placed' ? 'placed' : 'confirmed', request, {
                status: 'confirmed',
                confirmedAt: current?.confirmedAt ?? now,
                preparingAt: now,
            });
        },
        // Ready is not a transition: the order stays confirmed and only `readyAt` is stamped.
        markOrderReady: (request) =>
            transition('confirmed', request, {
                readyAt: new Date().toISOString(),
            }),
        fulfilOrder: (request) =>
            transition('confirmed', request, {
                status: 'fulfilled',
                // Stamped now, which is what puts the ticket in today's Ready column.
                fulfilledAt: new Date().toISOString(),
            }),
    };
}

/** The kitchen manager's grant minus the two codes the bump buttons are gated on. */
const VIEW_ONLY_PERMISSIONS = KITCHEN_MANAGER_PERMISSIONS.filter(
    (permission) =>
        permission !== 'order.manage_organisation' && permission !== 'order.prepare_organisation',
);

async function renderBoard(
    book: OrderBook,
    options: { readonly canManage?: boolean; readonly permissions?: readonly string[] } = {},
) {
    const session =
        options.permissions !== undefined
            ? kitchenManagerSession({
                  activeContext: testActiveContext({ permissions: options.permissions }),
              })
            : options.canManage === false
              ? kitchenManagerSession({
                    activeContext: testActiveContext({ permissions: VIEW_ONLY_PERMISSIONS }),
                })
              : kitchenManagerSession();

    return renderStubScreen(<KdsTicketsScreen />, {
        session,
        repositories: {
            kitchenOrders: {
                getDisplay: async () => book.getDisplay(),
                confirmOrder: async (request) => book.confirmOrder(request),
                startOrder: async (request) => book.startOrder(request),
                markOrderReady: async (request) => book.markOrderReady(request),
                fulfilOrder: async (request) => book.fulfilOrder(request),
            },
        },
    });
}

describe('the allergy banner in Arabic', () => {
    /*
     * The banner is the design system's `Callout`, whose layout is logical and is tested there, and
     * the one new block around a row's badge is a column aligned to its start. Jest measures no
     * layout on React Native, so what is pinned here is the half this feature wrote: the wording.
     */
    it('reads from the Arabic catalogues, the allergen included', async () => {
        const i18n = createInstance();
        await i18n.init({
            lng: 'ar',
            resources: { ar: { kitchen: arKitchen, marketplace: arMarketplace } },
        });

        const banner = allergyBanner(
            {
                severe: true,
                items: [
                    {
                        allergenCode: 'sesame',
                        severity: 'anaphylaxis',
                        notes: null,
                        conflictsWithLine: [],
                    },
                ],
                note: null,
                acknowledgedAt: null,
            },
            [],
            'ar',
            i18n.t,
        );

        expect(banner.tone).toBe('danger');
        expect(banner.icon).toBe('warning');
        expect(banner.title).toBe(arKitchen.allergy.titleSevere);
        expect(banner.body).toContain(arMarketplace.allergens.sesame);
        expect(banner.body).toContain(arKitchen.allergy.severity.anaphylaxis);

        // The ticket's own badges read the same source, never the code.
        expect(allergenLabel('tree_nut', i18n.t)).toBe(arMarketplace.allergens.tree_nut);
    });
});

function ticketId(orderId: OrderId): string {
    return `kds-ticket-${String(orderId)}`;
}

describe('kds ticket board', () => {
    it('puts a severe allergy on the ticket in the danger tone, with wording and notes', async () => {
        const order = kitchenOrder({
            allergy: {
                severe: true,
                items: [
                    {
                        allergenCode: 'sesame',
                        severity: 'anaphylaxis',
                        notes: 'Carries an EpiPen',
                        conflictsWithLine: [],
                    },
                ],
                note: null,
                acknowledgedAt: null,
            },
        });
        await renderStubScreen(<KdsTicketsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOrders: {
                    getDisplay: async () => boardOf([order]),
                },
            },
        });

        await waitFor(
            () => {
                expect(screen.getByTestId(`${ticketId(order.id)}-allergy`)).toBeTruthy();
            },
            { timeout: 5000 },
        );

        const banner = screen.getByTestId(`${ticketId(order.id)}-allergy`);
        expect(banner).toHaveTextContent(/Severe allergy on this order/);
        expect(banner).toHaveTextContent(/Sesame \(life-threatening\)/);
        expect(banner).toHaveTextContent(/Carries an EpiPen/);
    });

    it('shows this branch and unattributed work, and nothing else', async () => {
        const book = createOrderBook();
        const { repositories } = await renderBoard(book);

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-column-incoming')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        // Not the paged order book, which lost the oldest tickets past twenty-five open orders.
        expect(repositories.kitchenOrders.getDisplay).toHaveBeenCalled();
        expect(repositories.kitchenOrders.listOrders).not.toHaveBeenCalled();

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
        // Three columns side by side at this width, so no lane tabs.
        expect(screen.queryByTestId('kds-lanes')).toBeNull();
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
            expect(repositories.kitchenOrders.startOrder).toHaveBeenCalledWith({
                id: placed.id,
                lockVersion: placed.lockVersion,
            });
        });
        await waitFor(() => {
            const after = book.find(placed.id);
            // One press accepts it and starts it (HA-24).
            expect(after?.status).toBe('confirmed');
            expect(after?.preparingAt).toEqual(expect.any(String));
        });

        await waitFor(() => {
            expect(screen.getByTestId('kds-column-preparing-count')).toHaveTextContent('2');
        });
        expect(screen.getByTestId('kds-column-incoming-count')).toHaveTextContent('0');
        // Start is gone and Ready has taken its place on the same ticket.
        expect(screen.getByTestId(`${ticketId(placed.id)}-ready`)).toBeTruthy();
        expect(screen.queryByTestId(`${ticketId(placed.id)}-start`)).toBeNull();
    });

    it("keeps a later day's order under Upcoming, where it is accepted but not started (HA-26, HA-27)", async () => {
        const tomorrow = addDays(todayIso(new Date()), 1) ?? '';
        const scheduled = kitchenOrder({
            id: orderIdAt(9),
            orderNumber: 'VK-2026-0153',
            status: 'placed',
            delivery: { ...kitchenOrder().delivery, requestedDate: tomorrow },
        });
        const today = kitchenOrder({ id: orderIdAt(10), orderNumber: 'VK-2026-0154' });
        const book = createOrderBook([scheduled, today]);
        const { repositories } = await renderBoard(book);

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-upcoming')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        // Today's board holds today's order only; tomorrow's waits under its own day.
        expect(screen.getByTestId('kds-column-incoming-count')).toHaveTextContent('1');
        expect(screen.getByTestId(`kds-upcoming-${tomorrow}-count`)).toHaveTextContent('1');

        // Not cooking tomorrow's food today: Accept, no Start.
        expect(screen.queryByTestId(`${ticketId(scheduled.id)}-start`)).toBeNull();
        // Today's new order: Start (which accepts it too), with Accept beside it.
        expect(screen.getByTestId(`${ticketId(today.id)}-start`)).toBeTruthy();
        expect(screen.getByTestId(`${ticketId(today.id)}-accept`)).toBeTruthy();

        fireEvent.press(screen.getByTestId(`${ticketId(scheduled.id)}-accept`));

        await waitFor(() => {
            expect(repositories.kitchenOrders.confirmOrder).toHaveBeenCalledWith({
                id: scheduled.id,
                lockVersion: scheduled.lockVersion,
            });
        });
        expect(repositories.kitchenOrders.startOrder).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(screen.getByTestId(`${ticketId(scheduled.id)}-accepted`)).toBeTruthy();
        });
        // Accepted, still tomorrow's: it stays under Upcoming with nothing left to press today.
        expect(screen.queryByTestId(`${ticketId(scheduled.id)}-accept`)).toBeNull();
        expect(screen.queryByTestId(`${ticketId(scheduled.id)}-start`)).toBeNull();
        expect(screen.getByTestId('kds-column-incoming-count')).toHaveTextContent('1');
    });

    it('keeps a confirmed order in Incoming until somebody presses Start (HA-24)', async () => {
        const accepted = kitchenOrder({
            id: orderIdAt(8),
            orderNumber: 'VK-2026-0152',
            status: 'confirmed',
            confirmedAt: minutesAgo(3),
            lockVersion: 2,
        });
        const book = createOrderBook([accepted]);
        const { repositories } = await renderBoard(book);

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-column-incoming-count')).toHaveTextContent('1');
            },
            { timeout: 5000 },
        );
        expect(screen.getByTestId('kds-column-preparing-count')).toHaveTextContent('0');
        // Accepted is not cooking: no Ready yet.
        expect(screen.queryByTestId(`${ticketId(accepted.id)}-ready`)).toBeNull();

        fireEvent.press(screen.getByTestId(`${ticketId(accepted.id)}-start`));

        await waitFor(() => {
            expect(repositories.kitchenOrders.startOrder).toHaveBeenCalledWith({
                id: accepted.id,
                lockVersion: accepted.lockVersion,
            });
        });
        expect(repositories.kitchenOrders.confirmOrder).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(screen.getByTestId('kds-column-preparing-count')).toHaveTextContent('1');
        });
        expect(screen.getByTestId(`${ticketId(accepted.id)}-ready`)).toBeTruthy();
    });

    it('marks a ticket ready without handing it over, then hands it over', async () => {
        // Both presses wait out the undo before they are sent.
        jest.useFakeTimers({ advanceTimers: true });
        try {
            // A collection order: the customer takes it from the counter, so the kitchen hands it
            // over.
            const book = createOrderBook(
                seedOrders().map((order) =>
                    order.id === orderIdAt(3) ? { ...order, fulfilmentType: 'pickup' } : order,
                ),
            );
            const { repositories } = await renderBoard(book);

            await waitFor(
                () => {
                    expect(screen.getByTestId('kds-column-preparing')).toBeTruthy();
                },
                { timeout: 5000 },
            );

            const confirmed = book.orders().find((order) => order.status === 'confirmed');
            if (confirmed === undefined) throw new Error('this test authored no confirmed order');

            // Ready: cooked, still confirmed — a collection order nobody has picked up is not
            // fulfilled.
            fireEvent.press(screen.getByTestId(`${ticketId(confirmed.id)}-ready`));
            await act(async () => {
                await jest.advanceTimersByTimeAsync(KDS_UNDO_MS);
            });

            await waitFor(() => {
                expect(repositories.kitchenOrders.markOrderReady).toHaveBeenCalledWith({
                    id: confirmed.id,
                    lockVersion: confirmed.lockVersion,
                });
            });
            expect(repositories.kitchenOrders.fulfilOrder).not.toHaveBeenCalled();
            await waitFor(() => {
                expect(screen.getByTestId('kds-column-done-count')).toHaveTextContent('1');
            });
            expect(book.find(confirmed.id)?.status).toBe('confirmed');
            expect(screen.getByTestId('kds-column-preparing-count')).toHaveTextContent('0');

            // Handed over is the step that fulfils it.
            fireEvent.press(screen.getByTestId(`${ticketId(confirmed.id)}-handed-over`));
            await act(async () => {
                await jest.advanceTimersByTimeAsync(KDS_UNDO_MS);
            });
            await waitFor(() => {
                expect(book.find(confirmed.id)?.status).toBe('fulfilled');
            });
            await waitFor(() => {
                expect(screen.queryByTestId(`${ticketId(confirmed.id)}-handed-over`)).toBeNull();
            });
            expect(screen.getByTestId(ticketId(confirmed.id))).toBeTruthy();
        } finally {
            jest.useRealTimers();
        }
    });

    it('leaves a ready delivery to the driver instead of offering Handed over (HA-19)', async () => {
        const run = {
            status: 'assigned' as const,
            trackingStatus: 'awaiting_assignment' as const,
            driverName: 'Sami Haddad',
            assignedAt: minutesAgo(5),
            pickedUpAt: null,
            deliveredAt: null,
        };
        const book = createOrderBook([
            kitchenOrder({
                id: orderIdAt(6),
                orderNumber: 'VK-2026-0150',
                status: 'confirmed',
                confirmedAt: minutesAgo(30),
                readyAt: minutesAgo(10),
                deliveryRun: run,
            }),
            kitchenOrder({
                id: orderIdAt(7),
                orderNumber: 'VK-2026-0151',
                status: 'confirmed',
                confirmedAt: minutesAgo(30),
                readyAt: minutesAgo(10),
                deliveryRun: { ...run, status: 'in_transit', pickedUpAt: minutesAgo(2) },
            }),
            kitchenOrder({
                id: orderIdAt(8),
                orderNumber: 'VK-2026-0152',
                status: 'confirmed',
                confirmedAt: minutesAgo(30),
                readyAt: minutesAgo(10),
                deliveryRun: {
                    ...run,
                    status: 'failed',
                    pickedUpAt: minutesAgo(5),
                    failedAt: minutesAgo(1),
                },
            }),
        ]);
        await renderBoard(book);

        await waitFor(
            () => {
                expect(screen.getByTestId(`${ticketId(orderIdAt(6))}-driver`)).toHaveTextContent(
                    'Waiting for the driver',
                );
            },
            { timeout: 5000 },
        );
        expect(screen.getByTestId(`${ticketId(orderIdAt(7))}-driver`)).toHaveTextContent(
            'Out with the driver',
        );
        expect(screen.getByTestId(`${ticketId(orderIdAt(8))}-driver`)).toHaveTextContent(
            'Delivery failed',
        );
        expect(screen.queryByTestId(`${ticketId(orderIdAt(6))}-handed-over`)).toBeNull();
        expect(screen.queryByTestId(`${ticketId(orderIdAt(7))}-handed-over`)).toBeNull();
    });

    it('lets a cook on the wall code start a ticket and nothing else', async () => {
        const book = createOrderBook();
        await renderBoard(book, { permissions: ['order.prepare_organisation'] });

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-column-incoming')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        const placed = book
            .orders()
            .find((order) => order.status === 'placed' && order.branchId === null);
        if (placed === undefined) throw new Error('this test authored no placed order');

        expect(screen.queryByTestId(`${ticketId(placed.id)}-accept`)).toBeNull();
        expect(screen.queryAllByTestId(/-handed-over$/)).toHaveLength(0);
        expect(screen.queryAllByTestId(/-start$/).length).toBeGreaterThan(0);
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

describe('due order, the undo and lane tabs', () => {
    it('runs open work soonest due first, and oldest first between two due together', () => {
        const soon = minutesAgo(-20);
        const lunch = kitchenOrder({ id: orderIdAt(1), placedAt: minutesAgo(5), dueAt: soon });
        // Arrived first, due last: it no longer queues ahead of the lunch.
        const dinner = kitchenOrder({
            id: orderIdAt(2),
            placedAt: minutesAgo(50),
            dueAt: minutesAgo(-180),
        });
        const sameSlot = kitchenOrder({ id: orderIdAt(3), placedAt: minutesAgo(30), dueAt: soon });
        // No `dueAt` on the payload: due when it was placed, as the server's fallback has it.
        const unscheduled = kitchenOrder({ id: orderIdAt(4), placedAt: minutesAgo(10) });

        const board = bucketTickets(
            [lunch, dinner, sameSlot, unscheduled],
            new Date(),
            TEST_BRANCH_ID,
        );

        expect(board.incoming.map((order) => order.id)).toEqual([
            unscheduled.id,
            sameSlot.id,
            lunch.id,
            dinner.id,
        ]);
    });

    it('holds Ready for ten seconds, then sends it', async () => {
        jest.useFakeTimers({ advanceTimers: true });
        try {
            const book = createOrderBook();
            const { repositories } = await renderBoard(book);
            const ticket = ticketId(orderIdAt(3));

            await waitFor(
                () => {
                    expect(screen.getByTestId(`${ticket}-ready`)).toBeTruthy();
                },
                { timeout: 5000 },
            );

            fireEvent.press(screen.getByTestId(`${ticket}-ready`));

            // Waiting, and saying so on the ticket and in the toast.
            expect(screen.getByTestId(`${ticket}-held`)).toBeTruthy();
            expect(screen.getByTestId(`${ticket}-undo-toast`)).toHaveTextContent(
                /VK-2026-0146 marked ready/,
            );

            await act(async () => {
                await jest.advanceTimersByTimeAsync(KDS_UNDO_MS - 1_000);
            });
            expect(repositories.kitchenOrders.markOrderReady).not.toHaveBeenCalled();

            await act(async () => {
                await jest.advanceTimersByTimeAsync(1_000);
            });
            await waitFor(() => {
                expect(repositories.kitchenOrders.markOrderReady).toHaveBeenCalledWith({
                    id: orderIdAt(3),
                    lockVersion: 2,
                });
            });
            await waitFor(() => {
                expect(screen.getByTestId('kds-column-done-count')).toHaveTextContent('1');
            });
            expect(screen.queryByTestId(`${ticket}-held`)).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });

    it('sends nothing when Undo is pressed inside the ten seconds', async () => {
        jest.useFakeTimers({ advanceTimers: true });
        try {
            const book = createOrderBook();
            const { repositories } = await renderBoard(book);
            const ticket = ticketId(orderIdAt(3));

            await waitFor(
                () => {
                    expect(screen.getByTestId(`${ticket}-ready`)).toBeTruthy();
                },
                { timeout: 5000 },
            );

            fireEvent.press(screen.getByTestId(`${ticket}-ready`));
            fireEvent.press(screen.getByTestId(`${ticket}-undo`));

            await act(async () => {
                await jest.advanceTimersByTimeAsync(KDS_UNDO_MS + 5_000);
            });

            expect(repositories.kitchenOrders.markOrderReady).not.toHaveBeenCalled();
            expect(book.find(orderIdAt(3))?.readyAt ?? null).toBeNull();
            expect(screen.queryByTestId(`${ticket}-held`)).toBeNull();
            expect(screen.queryByTestId(`${ticket}-undo-toast`)).toBeNull();
            // Back where it was, Ready on offer again.
            expect(screen.getByTestId('kds-column-preparing-count')).toHaveTextContent('1');
            expect(screen.getByTestId(`${ticket}-ready`)).toBeEnabled();
        } finally {
            jest.useRealTimers();
        }
    });

    it('sends Accept and Start at once, with no undo', async () => {
        jest.useFakeTimers({ advanceTimers: true });
        try {
            const book = createOrderBook();
            const { repositories } = await renderBoard(book);
            // The branchless placed order is the one placed ticket on this wall.
            const ticket = ticketId(orderIdAt(2));

            await waitFor(
                () => {
                    expect(screen.getByTestId(`${ticket}-accept`)).toBeTruthy();
                },
                { timeout: 5000 },
            );

            fireEvent.press(screen.getByTestId(`${ticket}-accept`));
            expect(screen.queryByTestId(`${ticket}-undo-toast`)).toBeNull();
            // `waitFor` steps the clock in small increments: well inside ten seconds.
            await waitFor(() => {
                expect(repositories.kitchenOrders.confirmOrder).toHaveBeenCalledTimes(1);
            });

            await waitFor(() => {
                expect(screen.getByTestId(`${ticket}-start`)).toBeEnabled();
            });
            fireEvent.press(screen.getByTestId(`${ticket}-start`));
            expect(screen.queryByTestId(`${ticket}-undo-toast`)).toBeNull();
            await waitFor(() => {
                expect(repositories.kitchenOrders.startOrder).toHaveBeenCalledTimes(1);
            });
        } finally {
            jest.useRealTimers();
        }
    });

    it('puts the three lanes under tabs below md, one lane on screen at a time', async () => {
        const wide = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
        await act(async () => {
            Dimensions.set(JEST_WINDOW);
        });
        try {
            const book = createOrderBook();
            // Order 2 is placed and has waited past the limit, so the board is alarming.
            await renderBoard({
                ...book,
                getDisplay: () => ({
                    ...book.getDisplay(),
                    unacceptedOpenMinutes: { [String(orderIdAt(2))]: 7 },
                }),
            });

            await waitFor(
                () => {
                    expect(screen.getByTestId('kds-lanes')).toBeTruthy();
                },
                { timeout: 5000 },
            );
            expect(screen.getByTestId('kds-column-incoming')).toBeTruthy();
            expect(screen.queryByTestId('kds-column-preparing')).toBeNull();
            // Each tab carries its lane's count, so a phone sees the whole board at a glance.
            expect(screen.getByTestId('kds-lane-preparing-count')).toHaveTextContent('1');

            fireEvent.press(screen.getByTestId('kds-lane-preparing'));

            expect(screen.getByTestId('kds-column-preparing')).toBeTruthy();
            expect(screen.queryByTestId('kds-column-incoming')).toBeNull();
            expect(screen.getByTestId(ticketId(orderIdAt(3)))).toBeTruthy();
            // The alarm is on an Incoming ticket, out of sight: the Incoming tab still says so.
            expect(screen.getByTestId('kds-lane-incoming-count').props.className).toContain(
                'text-warning-strong',
            );
            expect(screen.getByTestId('kds-lane-preparing-count').props.className).not.toContain(
                'text-warning-strong',
            );
        } finally {
            await act(async () => {
                Dimensions.set(wide);
            });
        }
    });
});

describe('the board keeps working when something goes wrong', () => {
    /** A board whose answer a test can change, and a way to make the next poll happen. */
    async function renderChanging(first: KitchenDisplay | Error) {
        let current = first;
        const harness = await renderStubScreen(<KdsTicketsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOrders: {
                    getDisplay: async () => {
                        if (current instanceof Error) throw current;
                        return current;
                    },
                },
            },
        });

        return {
            answer: (next: KitchenDisplay | Error) => {
                current = next;
            },
            poll: async () => {
                await act(async () => {
                    await harness.queryClient.refetchQueries({
                        queryKey: queryKeys.kitchenOrders.display(),
                    });
                });
            },
        };
    }

    const refused = new ApiError(conflictFailure({ currentLockVersion: 1 }));

    it('keeps the last board on screen after a failed refresh and says when it updated', async () => {
        const order = kitchenOrder({ id: orderIdAt(1) });
        const { answer, poll } = await renderChanging(boardOf([order]));

        await waitFor(
            () => {
                expect(screen.getByTestId(ticketId(order.id))).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kds-stale')).toBeNull();

        answer(refused);
        await poll();

        await waitFor(() => {
            expect(screen.getByTestId('kds-stale')).toHaveTextContent(/Last updated/);
        });
        expect(screen.getByTestId(ticketId(order.id))).toBeTruthy();
        expect(screen.queryByTestId('kds-tickets-error')).toBeNull();

        answer(boardOf([order]));
        await poll();

        await waitFor(() => {
            expect(screen.queryByTestId('kds-stale')).toBeNull();
        });
    });

    it('shows the error only with no board at all', async () => {
        await renderChanging(refused);

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-tickets-error')).toBeTruthy();
            },
            { timeout: 5000 },
        );
    });

    it('says so when the server cut the list', async () => {
        await renderChanging(boardOf([kitchenOrder()], { truncated: true }));

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-truncated')).toBeTruthy();
            },
            { timeout: 5000 },
        );
    });
});

describe('the alarm', () => {
    it('goes off at the limit, on open minutes rather than on age', () => {
        expect(isAlarming(4, 5)).toBe(false);
        expect(isAlarming(5, 5)).toBe(true);
    });

    it('turns a ticket red with words during open hours, and not when the kitchen was closed', async () => {
        const waited = kitchenOrder({ id: orderIdAt(1), placedAt: minutesAgo(7) });
        // Placed overnight: an hour old, and no open minute has passed.
        const overnight = kitchenOrder({ id: orderIdAt(2), placedAt: minutesAgo(60) });
        await renderStubScreen(<KdsTicketsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOrders: {
                    getDisplay: async () =>
                        boardOf([waited, overnight], {
                            unacceptedOpenMinutes: {
                                [String(waited.id)]: 7,
                                [String(overnight.id)]: 0,
                            },
                        }),
                },
            },
        });

        await waitFor(
            () => {
                expect(screen.getByTestId(`${ticketId(waited.id)}-alarm`)).toHaveTextContent(
                    /Not accepted yet/,
                );
            },
            { timeout: 5000 },
        );
        expect(screen.getByTestId(`${ticketId(waited.id)}-alarm`)).toHaveTextContent(/7 min/);
        expect(screen.queryByTestId(`${ticketId(overnight.id)}-alarm`)).toBeNull();
    });
});

describe('sound', () => {
    function pretendABrowser() {
        Object.defineProperty(globalThis, 'AudioContext', {
            value: jest.fn(),
            configurable: true,
        });
    }

    beforeEach(() => {
        jest.mocked(playAlertTone).mockClear();
        pretendABrowser();
    });

    afterEach(() => {
        Reflect.deleteProperty(globalThis, 'AudioContext');
    });

    async function renderSounding(first: KitchenDisplay) {
        let current = first;
        const harness = await renderStubScreen(<KdsTicketsScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOrders: { getDisplay: async () => current } },
        });
        await waitFor(
            () => {
                expect(screen.getByTestId('kds-sound-on')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        return {
            poll: async (next: KitchenDisplay) => {
                current = next;
                await act(async () => {
                    await harness.queryClient.refetchQueries({
                        queryKey: queryKeys.kitchenOrders.display(),
                    });
                });
            },
        };
    }

    it('offers Turn on sound until it is pressed, and sounds the press', async () => {
        await renderSounding(boardOf([kitchenOrder()]));
        expect(playAlertTone).not.toHaveBeenCalled();

        fireEvent.press(screen.getByTestId('kds-sound-on'));

        await waitFor(() => {
            expect(screen.queryByTestId('kds-sound-on')).toBeNull();
        });
        expect(playAlertTone).toHaveBeenCalledTimes(1);
    });

    it('offers nothing where a browser cannot sound', async () => {
        Reflect.deleteProperty(globalThis, 'AudioContext');
        await renderStubScreen(<KdsTicketsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOrders: { getDisplay: async () => boardOf([kitchenOrder()]) },
            },
        });

        await waitFor(
            () => {
                expect(screen.getByTestId(ticketId(orderIdAt(1)))).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kds-sound-on')).toBeNull();
    });

    it('sounds a new ticket once, and nothing for a ticket already on the wall', async () => {
        const present = kitchenOrder({ id: orderIdAt(1) });
        const arriving = kitchenOrder({ id: orderIdAt(2) });
        const { poll } = await renderSounding(boardOf([present]));

        fireEvent.press(screen.getByTestId('kds-sound-on'));
        await waitFor(() => {
            expect(screen.queryByTestId('kds-sound-on')).toBeNull();
        });
        jest.mocked(playAlertTone).mockClear();

        await poll(boardOf([present]));
        expect(playAlertTone).not.toHaveBeenCalled();

        await poll(boardOf([present, arriving]));
        await waitFor(() => {
            expect(playAlertTone).toHaveBeenCalledTimes(1);
        });

        await poll(boardOf([present, arriving]));
        expect(playAlertTone).toHaveBeenCalledTimes(1);
    });

    // Review Focus 4: a reload starts with `seen` empty, and that must not read as all new.
    it('replays nothing for the tickets already there on a reload', () => {
        const ids = placedTicketIds([kitchenOrder({ id: orderIdAt(1) })], TEST_BRANCH_ID);

        expect(ids).toHaveLength(1);
        expect(unseenTickets(ids, null)).toEqual([]);
        expect(unseenTickets(ids, new Set(ids))).toEqual([]);
        expect(unseenTickets(ids, new Set())).toEqual(ids);
    });

    it('leaves another kitchen, and work already accepted, out of the tone', () => {
        const orders = [
            kitchenOrder({ id: orderIdAt(1), branchId: OTHER_BRANCH_ID }),
            kitchenOrder({ id: orderIdAt(2), status: 'confirmed' }),
            kitchenOrder({ id: orderIdAt(3), branchId: null }),
        ];

        expect(placedTicketIds(orders, TEST_BRANCH_ID)).toEqual([String(orderIdAt(3))]);
    });

    it('repeats the tone while a ticket is alarming, once sound is on', async () => {
        const repeat = jest.spyOn(globalThis, 'setInterval');
        const order = kitchenOrder({ id: orderIdAt(1) });
        await renderSounding(
            boardOf([order], { unacceptedOpenMinutes: { [String(order.id)]: 9 } }),
        );
        expect(repeat).not.toHaveBeenCalledWith(playAlertTone, KDS_ALARM_TONE_MS);

        fireEvent.press(screen.getByTestId('kds-sound-on'));

        await waitFor(() => {
            expect(repeat).toHaveBeenCalledWith(playAlertTone, KDS_ALARM_TONE_MS);
        });
        repeat.mockRestore();
    });
});
