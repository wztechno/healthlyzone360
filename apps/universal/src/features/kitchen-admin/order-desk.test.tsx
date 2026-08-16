import { ApiError, apiFailure, conflictFailure } from '@healthy360/api-client';
import type {
    KitchenOrder,
    OrderDeskDeliveryJob,
    OrderDeskQueue,
    OrderDeskQueueFilters,
    OrderDeskQueueMeta,
    OrderDeskQueueRow,
} from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { queryKeys } from '../../data/query-keys.ts';
import { TEST_BRANCH_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { KDS_LATE_MINUTES, KDS_WARNING_MINUTES } from '../kds/kds-board.ts';
import { minutesPastDue, orderDeskDeliveryState, orderDeskDueTone } from './ops-format.ts';
import { OrderDeskScreen } from './screens/order-desk-screen.tsx';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/order-desk',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The Order Desk queue, against a queue this file writes.
 *
 * Two things the authored data has to get right, because the screen's whole argument rests on them.
 *
 * 1. **Time is relative to the run.** The due badge grades minutes *past* `dueAt` on the kitchen
 *    display's own scale, so a fixture pinned to a written-down instant would silently stop testing
 *    the boundary the day after it was written. Every `dueAt` below is an offset from `Date.now()`.
 * 2. **The customer block is authored in all three of its states** — absent (the caller does not
 *    hold `order.view_customer_contact_organisation`), present with a null name (an anonymised
 *    account somebody *may* read), and present in full. Those are three different facts that render
 *    as two different cells, and only authoring all three makes the em-dash rule an assertion rather
 *    than a coincidence.
 */

const MINUTE_MS = 60_000;

function minutesFromNow(minutes: number): string {
    return new Date(Date.now() + minutes * MINUTE_MS).toISOString();
}

function orderIdAt(ordinal: number): OrderId {
    return `test-0000-order-000${String(ordinal)}` as OrderId;
}

const DELIVERY: OrderDeskQueueRow['delivery'] = {
    label: 'Home',
    lineOne: 'Villa 12, Street 8b',
    lineTwo: null,
    city: null,
    areaNameEn: 'Al Quoz 1',
    areaNameAr: 'القوز ١',
    areaId: null,
    windowCode: 'morning',
    requestedDate: '2026-08-16',
    zoneId: null,
};

/**
 * One row, with **no `customer` key at all** unless a test adds one. Absence is the wire's signal
 * that the reader may not see contact details, and a fixture that always carried the key would test
 * a shape the server never sends to an unpermitted caller.
 */
function deskRow(overrides: Partial<OrderDeskQueueRow> = {}): OrderDeskQueueRow {
    return {
        id: orderIdAt(1),
        orderNumber: 'H360-2026-0148',
        branchId: TEST_BRANCH_ID,
        status: 'placed',
        currencyCode: 'AED',
        subtotalMinor: 14_500,
        deliveryFeeMinor: 1_500,
        totalMinor: 16_000,
        paymentMethod: 'cash_on_delivery',
        fulfilmentType: 'delivery',
        delivery: DELIVERY,
        placedAt: minutesFromNow(-120),
        confirmedAt: null,
        fulfilledAt: null,
        cancelledAt: null,
        cancellationReason: null,
        lockVersion: 1,
        lineCount: 0,
        lines: [],
        dueAt: minutesFromNow(90),
        // Never null on the wire: an order with no receipt has received zero, which is a payment
        // position rather than an absent one.
        payment: { method: 'cash_on_delivery', receivedMinor: 0, receipted: false },
        deliveryJob: null,
        ...overrides,
    };
}

const JOB_ID = 'test-0000-delivery-job-0001';

/** A run, unassigned by default — the state a confirmed delivery lands in. */
function deliveryJob(overrides: Partial<OrderDeskDeliveryJob> = {}): OrderDeskDeliveryJob {
    return {
        id: JOB_ID,
        status: 'pending',
        trackingStatus: 'awaiting_assignment',
        driverUserId: null,
        assignedAt: null,
        // Its own validator, deliberately unequal to the order's so a test that crossed the two
        // would fail rather than coincide.
        lockVersion: 7,
        ...overrides,
    };
}

/** The detail read behind the drawer. The same order, without the desk's two extra blocks. */
function detailOrder(row: OrderDeskQueueRow, overrides: Partial<KitchenOrder> = {}): KitchenOrder {
    const {
        dueAt: _dueAt,
        payment: _payment,
        deliveryJob: _deliveryJob,
        customer: _customer,
        ...order
    } = row;
    return { ...order, ...overrides };
}

function meta(overrides: Partial<OrderDeskQueueMeta> = {}): OrderDeskQueueMeta {
    return {
        count: 1,
        limit: 200,
        truncated: false,
        window: 'today',
        today: '2026-08-15',
        timezone: 'UTC',
        ...overrides,
    };
}

function queue(
    rows: readonly OrderDeskQueueRow[],
    metaOverrides: Partial<OrderDeskQueueMeta> = {},
): OrderDeskQueue {
    return { rows, meta: meta({ count: rows.length, ...metaOverrides }) };
}

async function renderDesk(listQueue: (filters?: OrderDeskQueueFilters) => Promise<OrderDeskQueue>) {
    return renderStubScreen(<OrderDeskScreen />, {
        session: kitchenManagerSession(),
        repositories: { orderDesk: { listQueue } },
    });
}

/**
 * The desk with its drawer wired: the queue, the detail read behind it, and the two transitions.
 *
 * The detail read is a *separate* stub from the queue on purpose — that separation is the screen's
 * whole argument about lock versions, and a harness that answered both from one object could not
 * tell a test that the transition sent the wrong one.
 */
async function renderDeskWithDetail(overrides: {
    readonly listQueue: (filters?: OrderDeskQueueFilters) => Promise<OrderDeskQueue>;
    readonly getOrder: (orderId: OrderId) => Promise<KitchenOrder>;
    readonly confirmOrder?: (request: {
        readonly id: OrderId;
        readonly lockVersion: number;
    }) => Promise<KitchenOrder>;
    readonly fulfilOrder?: (request: {
        readonly id: OrderId;
        readonly lockVersion: number;
    }) => Promise<KitchenOrder>;
}) {
    return renderStubScreen(<OrderDeskScreen />, {
        session: kitchenManagerSession(),
        repositories: {
            orderDesk: { listQueue: overrides.listQueue },
            kitchenOrders: {
                getOrder: overrides.getOrder,
                ...(overrides.confirmOrder === undefined
                    ? {}
                    : { confirmOrder: overrides.confirmOrder }),
                ...(overrides.fulfilOrder === undefined
                    ? {}
                    : { fulfilOrder: overrides.fulfilOrder }),
            },
        },
    });
}

/** The queue as it lands: three rows across the three ageing bands and the three customer states. */
function seedQueue(): readonly OrderDeskQueueRow[] {
    return [
        deskRow({
            id: orderIdAt(1),
            orderNumber: 'H360-2026-0146',
            status: 'confirmed',
            // Well past due: the loudest band.
            dueAt: minutesFromNow(-(KDS_LATE_MINUTES + 15)),
            customer: { displayName: 'Layla Haddad', phone: '+971500000001' },
        }),
        deskRow({
            id: orderIdAt(2),
            orderNumber: 'H360-2026-0147',
            // Between the two thresholds.
            dueAt: minutesFromNow(-(KDS_WARNING_MINUTES + 5)),
            totalMinor: 7_200,
            deliveryFeeMinor: null,
            // Anonymised: the reader may see contact details, and there is no name to see.
            customer: { displayName: null, phone: '+971500000002' },
        }),
        deskRow({
            id: orderIdAt(3),
            orderNumber: 'H360-2026-0148',
            // Not due for another hour and a half — early is simply neutral.
            dueAt: minutesFromNow(90),
            delivery: { ...DELIVERY, windowCode: null },
            // No `customer` key: this caller holds no contact permission.
        }),
    ];
}

function rowTestId(ordinal: number, suffix: string): string {
    return `kitchen-order-desk-row-${String(orderIdAt(ordinal))}-${suffix}`;
}

describe('order desk queue — the four-state ladder', () => {
    it('shows skeletons before the queue answers', async () => {
        // Held open deliberately rather than raced against the stub's own latency: the gate resolves
        // the session first, so "the frame after the gate opens and before the queue lands" is only
        // observable if this test decides when the queue lands.
        let release: (value: OrderDeskQueue) => void = () => undefined;
        const held = new Promise<OrderDeskQueue>((resolve) => {
            release = resolve;
        });

        await renderDesk(async () => held);

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-loading')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        // A skeleton is decorative and hides itself from the accessibility tree, so reaching it
        // takes `includeHiddenElements` — which is the behaviour being asserted as much as the
        // presence: a loading placeholder announced to a screen reader would be noise.
        expect(
            screen.getByTestId('kitchen-order-desk-skeleton-1', { includeHiddenElements: true }),
        ).toBeTruthy();
        expect(screen.queryByTestId('kitchen-order-desk-table')).toBeNull();
        expect(screen.queryByTestId('kitchen-order-desk-empty')).toBeNull();

        await act(async () => {
            release(queue(seedQueue()));
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kitchen-order-desk-loading')).toBeNull();
    });

    it('shows the failure with a retry rather than an empty table', async () => {
        await renderDesk(async () => {
            throw new ApiError(apiFailure('server'));
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-error')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kitchen-order-desk-table')).toBeNull();
        expect(screen.queryByTestId('kitchen-order-desk-empty')).toBeNull();
    });

    it('says nothing is due, with no clear-filters escape, when nothing is filtered', async () => {
        await renderDesk(async () => queue([]));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-empty')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        // Nothing was narrowed, so there is nothing to clear — offering the button would send
        // somebody looking for a filter they never set.
        expect(screen.queryByTestId('kitchen-order-desk-clear')).toBeNull();
    });

    it('offers a way back when a filter is what emptied the queue', async () => {
        await renderDesk(async (filters) =>
            queue(filters?.statuses === undefined ? seedQueue() : []),
        );

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        fireEvent(screen.getByTestId('kitchen-order-desk-status-placed'), 'change', true);

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-order-desk-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-order-desk-clear')).toBeTruthy();
    });

    it('renders the queue in the order the server answered, with no pagination under it', async () => {
        await renderDesk(async () => queue(seedQueue()));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        expect(screen.getByTestId(rowTestId(1, 'number'))).toHaveTextContent('H360-2026-0146');
        expect(screen.getByTestId(rowTestId(3, 'number'))).toHaveTextContent('H360-2026-0148');
        // 16 000 minor units through the currency's own exponent, exactly once.
        expect(screen.getByTestId(rowTestId(1, 'total'))).toHaveTextContent('AED 160.00');
        // The queue is bounded, not paged: there is no page control to offer.
        expect(screen.queryByTestId('kitchen-order-desk-pagination')).toBeNull();
    });
});

describe('order desk queue — the truncation callout', () => {
    it('stays away while the whole queue fits', async () => {
        await renderDesk(async () => queue(seedQueue()));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kitchen-order-desk-truncated')).toBeNull();
    });

    it('says the view is capped, and names the cap, when the server truncated', async () => {
        await renderDesk(async () => queue(seedQueue(), { truncated: true, limit: 200 }));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-truncated')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        // The number comes from `meta.limit`, not from a constant this screen keeps: the cap is the
        // server's, and a hard-coded 200 here would go on saying 200 the day it moves.
        expect(screen.getByTestId('kitchen-order-desk-truncated')).toHaveTextContent(/\b200\b/);
        // The table is still there — a truncated queue is a partial answer, not a failure.
        expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
    });
});

describe('order desk queue — ageing against the due instant', () => {
    it('grades minutes past due on the kitchen display scale, clamped before the deadline', () => {
        const now = new Date('2026-08-15T12:00:00.000Z');
        const at = (minutesPast: number) =>
            new Date(now.getTime() - minutesPast * MINUTE_MS).toISOString();

        // Early is not "very early": the two sides of a deadline are different questions.
        expect(minutesPastDue(at(-45), now)).toBe(0);
        expect(orderDeskDueTone(at(-45), now)).toBe('neutral');
        expect(orderDeskDueTone(at(0), now)).toBe('neutral');
        expect(orderDeskDueTone(at(KDS_WARNING_MINUTES - 1), now)).toBe('neutral');

        // The two thresholds are inclusive, exactly as `ticketAgeTone` reads them.
        expect(orderDeskDueTone(at(KDS_WARNING_MINUTES), now)).toBe('warning');
        expect(orderDeskDueTone(at(KDS_LATE_MINUTES - 1), now)).toBe('warning');
        expect(orderDeskDueTone(at(KDS_LATE_MINUTES), now)).toBe('danger');
        expect(orderDeskDueTone(at(KDS_LATE_MINUTES * 4), now)).toBe('danger');

        // An unreadable instant is not an emergency somebody has to dismiss.
        expect(minutesPastDue('not an instant', now)).toBe(0);
    });

    it('carries each band onto the row, and never by colour alone', async () => {
        await renderDesk(async () => queue(seedQueue()));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        // `Badge` pairs every non-neutral tone with its own glyph, so the band survives greyscale
        // and colour blindness — which is what these assertions are actually checking. The glyph is
        // `aria-hidden` on purpose (the badge's own label is the interval, spelled out), so it is
        // only reachable with `includeHiddenElements` — and that must be passed on the *negative*
        // assertion too, or it would pass whatever the tone was.
        const hidden = { includeHiddenElements: true } as const;
        expect(screen.getByTestId(rowTestId(1, 'due-age'))).toHaveTextContent(/ago$/);
        expect(screen.getByTestId(`${rowTestId(1, 'due-age')}-icon`, hidden)).toBeTruthy();
        expect(screen.getByTestId(`${rowTestId(2, 'due-age')}-icon`, hidden)).toBeTruthy();
        // Neutral carries no glyph, because there is nothing yet to warn about.
        expect(screen.getByTestId(rowTestId(3, 'due-age'))).toHaveTextContent(/^in /);
        expect(screen.queryByTestId(`${rowTestId(3, 'due-age')}-icon`, hidden)).toBeNull();
    });
});

describe('order desk queue — the customer column', () => {
    it('renders an em dash when the field is absent and when the name is null', async () => {
        await renderDesk(async () => queue(seedQueue()));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        // A name the reader may see.
        expect(screen.getByTestId(rowTestId(1, 'customer'))).toHaveTextContent('Layla Haddad');
        expect(screen.getByTestId(rowTestId(1, 'customer-phone'))).toHaveTextContent(
            '+971500000001',
        );

        // Anonymised account: the block is present, the name is not.
        expect(screen.getByTestId(rowTestId(2, 'customer'))).toHaveTextContent('—');
        expect(screen.getByTestId(rowTestId(2, 'customer-phone'))).toHaveTextContent(
            '+971500000002',
        );

        // No contact permission: the block never arrived, and the column still reads as a column
        // rather than as something broken.
        expect(screen.getByTestId(rowTestId(3, 'customer'))).toHaveTextContent('—');
        expect(screen.queryByTestId(rowTestId(3, 'customer-phone'))).toBeNull();
    });
});

describe('order desk queue — filters and the query key', () => {
    it('keys equal filters to one entry and different windows to different ones', () => {
        // Value equality, not reference equality: the screen memoises the object so the *hash* is
        // stable, and two screens asking the same question must share one cache entry.
        expect(queryKeys.orderDesk.queue({ window: 'today' })).toEqual(
            queryKeys.orderDesk.queue({ window: 'today' }),
        );
        expect(queryKeys.orderDesk.queue({ window: 'today' })).not.toEqual(
            queryKeys.orderDesk.queue({ window: 'overdue' }),
        );
        // The root is a prefix of every view below it, so one invalidation covers them all.
        expect(queryKeys.orderDesk.queue().slice(0, 1)).toEqual(queryKeys.orderDesk.all());
    });

    it('sends the window and the statuses to the endpoint rather than sieving rows here', async () => {
        const { repositories } = await renderDesk(async () => queue(seedQueue()));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(repositories.orderDesk.listQueue).toHaveBeenCalledWith({ window: 'today' });

        fireEvent.press(screen.getByTestId('kitchen-order-desk-window-overdue'));
        await waitFor(() => {
            expect(repositories.orderDesk.listQueue).toHaveBeenCalledWith({ window: 'overdue' });
        });

        fireEvent(screen.getByTestId('kitchen-order-desk-status-confirmed'), 'change', true);
        await waitFor(() => {
            expect(repositories.orderDesk.listQueue).toHaveBeenCalledWith({
                window: 'overdue',
                statuses: ['confirmed'],
            });
        });
    });

    it('does not re-ask the endpoint for a search that trims to the same question', async () => {
        const { repositories } = await renderDesk(async () => queue(seedQueue()));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(repositories.orderDesk.listQueue).toHaveBeenCalledTimes(1);

        // Whitespace is not a search. The filter object is memoised on the *trimmed* value, so
        // these keystrokes re-render the screen and change nothing the endpoint would answer
        // differently.
        const search = screen.getByTestId('kitchen-order-desk-search-input');
        await act(async () => {
            fireEvent.changeText(search, ' ');
            fireEvent.changeText(search, '  ');
        });
        expect(repositories.orderDesk.listQueue).toHaveBeenCalledTimes(1);

        // A real search is a different question, and it goes to the server trimmed.
        await act(async () => {
            fireEvent.changeText(search, '  0148  ');
        });
        await waitFor(() => {
            expect(repositories.orderDesk.listQueue).toHaveBeenCalledWith({
                window: 'today',
                query: '0148',
            });
        });
    });
});

/**
 * The five states {@link orderDeskDeliveryState} can be in, and why none of them collapses.
 *
 * A `deliveryJob` of `null` is true of three different orders and the wire says so explicitly, so
 * every one of them is authored below: a pickup (never driven anywhere), a placed delivery (the run
 * is created on confirm), and a confirmed delivery from before the delivery chain shipped (no run
 * is ever coming). The two job-bearing states — nobody has it, somebody has it — are the fourth and
 * fifth.
 */
describe('order desk queue — the delivery column', () => {
    /** One row per state, in the order the state machine reads them. */
    function deliveryStateQueue(): readonly OrderDeskQueueRow[] {
        return [
            // Pickup: nothing is driven anywhere, ever.
            deskRow({ id: orderIdAt(1), fulfilmentType: 'pickup', status: 'confirmed' }),
            // A delivery still placed: confirming it is what makes a run.
            deskRow({ id: orderIdAt(2), fulfilmentType: 'delivery', status: 'placed' }),
            // Confirmed with no job at all — an order from before the chain existed.
            deskRow({ id: orderIdAt(3), fulfilmentType: 'delivery', status: 'confirmed' }),
            // A run nobody has taken. The only state that is somebody's job right now.
            deskRow({
                id: orderIdAt(4),
                fulfilmentType: 'delivery',
                status: 'confirmed',
                deliveryJob: deliveryJob(),
            }),
            // A run with a driver on it.
            deskRow({
                id: orderIdAt(5),
                fulfilmentType: 'delivery',
                status: 'confirmed',
                deliveryJob: deliveryJob({
                    status: 'in_transit',
                    trackingStatus: 'en_route',
                    driverUserId: 'test-0000-user-0001',
                    assignedAt: minutesFromNow(-30),
                }),
            }),
        ];
    }

    it('reads each state from the row alone, never from the job in isolation', () => {
        const rows = deliveryStateQueue();
        const at = (index: number): OrderDeskQueueRow => {
            const row = rows[index];
            if (row === undefined) throw new Error('the fixture is short');
            return row;
        };

        expect(orderDeskDeliveryState(at(0))).toBe('not_delivered');
        // A counter sale reads the same way as a pickup — neither is driven anywhere.
        expect(orderDeskDeliveryState(deskRow({ fulfilmentType: 'counter' }))).toBe(
            'not_delivered',
        );
        expect(orderDeskDeliveryState(at(1))).toBe('awaiting_confirmation');
        // Confirmed and job-less is *not* "unassigned": no run is ever coming for this one, and a
        // cell promising a driver would promise one forever.
        expect(orderDeskDeliveryState(at(2))).toBe('no_run');
        expect(orderDeskDeliveryState(at(3))).toBe('unassigned');
        expect(orderDeskDeliveryState(at(4))).toBe('assigned');
    });

    it('renders an em dash for an order nothing is driven for, and no tracking line', async () => {
        await renderDesk(async () => queue(deliveryStateQueue()));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        expect(screen.getByTestId(rowTestId(1, 'delivery'))).toHaveTextContent('—');
        // No badge and no tracking line: there is no run to have either.
        expect(screen.queryByTestId(rowTestId(1, 'delivery-state'))).toBeNull();
        expect(screen.queryByTestId(rowTestId(1, 'delivery-tracking'))).toBeNull();
    });

    it('names the two job-less states apart, and neither one carries a tracking line', async () => {
        await renderDesk(async () => queue(deliveryStateQueue()));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        const awaiting = screen.getByTestId(rowTestId(2, 'delivery-state'));
        const noRun = screen.getByTestId(rowTestId(3, 'delivery-state'));
        // Different words for different facts — the assertion is that they are not one cell.
        expect(awaiting).toHaveTextContent('On confirmation');
        expect(noRun).toHaveTextContent('No run recorded');

        expect(screen.queryByTestId(rowTestId(2, 'delivery-tracking'))).toBeNull();
        expect(screen.queryByTestId(rowTestId(3, 'delivery-tracking'))).toBeNull();
    });

    it('shows a run nobody has taken loudly, and one with a driver quietly, both with tracking', async () => {
        await renderDesk(async () => queue(deliveryStateQueue()));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        // `Badge` pairs every non-neutral tone with its own glyph, so "needs a driver" survives
        // greyscale. The glyph is `aria-hidden`, hence `includeHiddenElements` on the assertion.
        const hidden = { includeHiddenElements: true } as const;
        // Matched loosely: a warning `Badge` renders its glyph inside the same node as its label.
        expect(screen.getByTestId(rowTestId(4, 'delivery-state'))).toHaveTextContent(
            /Needs a driver/,
        );
        expect(screen.getByTestId(`${rowTestId(4, 'delivery-state')}-icon`, hidden)).toBeTruthy();

        expect(screen.getByTestId(rowTestId(5, 'delivery-state'))).toHaveTextContent(
            /With a driver/,
        );

        // The tracking axis is what the *customer* has been told, and it is shown on both — an
        // unassigned run has already told somebody it is waiting for a driver.
        expect(screen.getByTestId(rowTestId(4, 'delivery-tracking'))).toHaveTextContent(
            'Waiting for a driver',
        );
        expect(screen.getByTestId(rowTestId(5, 'delivery-tracking'))).toHaveTextContent(
            'On the way',
        );
    });

    /**
     * There is no Assign control anywhere on this screen, and its absence is asserted rather than
     * merely true: no endpoint on this platform lists an organisation's members, so a picker could
     * only offer a free-text box for a UUID. The day a directory lands, this test is the one that
     * says the control is expected to appear.
     */
    it('offers no assign control, because nothing can name the people it would take', async () => {
        await renderDesk(async () => queue(deliveryStateQueue()));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        expect(screen.queryByTestId(rowTestId(4, 'assign'))).toBeNull();
        expect(screen.queryByTestId('kitchen-order-desk-assign-dialog')).toBeNull();
    });
});

describe('order desk queue — the payment cell', () => {
    it('names the intended method and the shortfall, never calling an unsettled order paid', async () => {
        await renderDesk(async () =>
            queue([
                deskRow({
                    id: orderIdAt(1),
                    totalMinor: 16_000,
                    payment: { method: 'cash_on_delivery', receivedMinor: 0, receipted: false },
                }),
                // A part payment: still not settled, and the outstanding figure is what the agent
                // has to collect.
                deskRow({
                    id: orderIdAt(2),
                    totalMinor: 16_000,
                    payment: { method: 'wish', receivedMinor: 10_000, receipted: false },
                }),
                deskRow({
                    id: orderIdAt(3),
                    totalMinor: 16_000,
                    payment: { method: 'cash_at_counter', receivedMinor: 16_000, receipted: true },
                }),
            ]),
        );

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        // The order's *intended* method — read before the money arrives, because it is how somebody
        // knows what to ask the customer for. The wizard's own words, not a second translation.
        expect(screen.getByTestId(rowTestId(1, 'payment-method'))).toHaveTextContent(
            'Cash on delivery',
        );
        expect(screen.getByTestId(rowTestId(2, 'payment-method'))).toHaveTextContent(
            'WISH transfer',
        );

        // Nothing received: the whole total is outstanding.
        expect(screen.getByTestId(rowTestId(1, 'payment-outstanding'))).toHaveTextContent(
            'AED 160.00 outstanding',
        );
        // Part paid: the balance, not the total and not the receipt.
        expect(screen.getByTestId(rowTestId(2, 'payment-outstanding'))).toHaveTextContent(
            'AED 60.00 outstanding',
        );
        expect(screen.queryByTestId(rowTestId(2, 'payment-state'))).toBeNull();

        // Settled says so as a badge, and carries no outstanding line beside it.
        expect(screen.getByTestId(rowTestId(3, 'payment-state'))).toHaveTextContent(/Settled/);
        expect(screen.queryByTestId(rowTestId(3, 'payment-outstanding'))).toBeNull();
    });
});

describe('order desk queue — the detail drawer', () => {
    it('stays shut until a row is opened, then re-reads the order rather than trusting the row', async () => {
        const row = deskRow({ id: orderIdAt(1), status: 'placed', lockVersion: 1 });
        // The queue row is a poll or two old; the detail read is the current truth.
        const fresh = detailOrder(row, { lockVersion: 9 });

        const { repositories } = await renderDeskWithDetail({
            listQueue: async () => queue([row]),
            getOrder: async () => fresh,
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kitchen-order-desk-detail-body')).toBeNull();
        expect(repositories.kitchenOrders.getOrder).not.toHaveBeenCalled();

        fireEvent.press(screen.getByTestId(rowTestId(1, 'open')));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-detail-body')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(repositories.kitchenOrders.getOrder).toHaveBeenCalledWith(row.id);
    });

    it('confirms with the version the detail answered, not the one the row carried', async () => {
        const row = deskRow({ id: orderIdAt(1), status: 'placed', lockVersion: 1 });
        const fresh = detailOrder(row, { lockVersion: 9 });

        const { repositories } = await renderDeskWithDetail({
            listQueue: async () => queue([row]),
            getOrder: async () => fresh,
            confirmOrder: async () => ({ ...fresh, status: 'confirmed', lockVersion: 10 }),
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        fireEvent.press(screen.getByTestId(rowTestId(1, 'open')));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-order-desk-detail-confirm')).toBeTruthy();
        });
        // `placed` offers Confirm and nothing else — a Fulfil button here would manufacture a
        // conflict on somebody's behalf.
        expect(screen.queryByTestId('kitchen-order-desk-detail-fulfil')).toBeNull();

        fireEvent.press(screen.getByTestId('kitchen-order-desk-detail-confirm'));

        await waitFor(() => {
            expect(repositories.kitchenOrders.confirmOrder).toHaveBeenCalledWith({
                id: row.id,
                // 9, never 1: the queue row's version can be fifteen seconds old and sending it
                // would earn a conflict the person did nothing to deserve.
                lockVersion: 9,
            });
        });
    });

    /**
     * Closing a delivery is offered on evidence, not gated on it.
     *
     * The desk is deliberately not blocked on `tracking_status === 'delivered'` — an agent on the
     * telephone to a customer holding the food knows something the board does not, and a driver's
     * phone in a pocket in a lift knows nothing at all. What the drawer owes instead is the tracking
     * status *beside* the button, which is what makes the close informed rather than blind.
     */
    it('offers Fulfil on a confirmed delivery whose driver is still on the way, and says so', async () => {
        const row = deskRow({
            id: orderIdAt(1),
            status: 'confirmed',
            lockVersion: 2,
            deliveryJob: deliveryJob({
                status: 'in_transit',
                trackingStatus: 'en_route',
                driverUserId: 'test-0000-user-0001',
                assignedAt: minutesFromNow(-30),
            }),
        });
        const fresh = detailOrder(row, { lockVersion: 2 });

        const { repositories } = await renderDeskWithDetail({
            listQueue: async () => queue([row]),
            getOrder: async () => fresh,
            fulfilOrder: async () => ({ ...fresh, status: 'fulfilled', lockVersion: 3 }),
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        fireEvent.press(screen.getByTestId(rowTestId(1, 'open')));

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-order-desk-detail-fulfil')).toBeTruthy();
        });

        // The tracking axis is beside the button, unblocked: the customer has been told the driver
        // is on the way, and the desk may still close the order.
        expect(screen.getByTestId('kitchen-order-desk-detail-fulfil-tracking')).toHaveTextContent(
            'On the way',
        );
        // The run's own facts are in the drawer's delivery block, from the queue row — the detail
        // endpoint serves none of them.
        expect(screen.getByTestId('kitchen-order-desk-detail-delivery-status')).toHaveTextContent(
            'On the road',
        );
        expect(screen.getByTestId('kitchen-order-desk-detail-delivery-assigned-at')).toBeTruthy();

        fireEvent.press(screen.getByTestId('kitchen-order-desk-detail-fulfil'));
        await waitFor(() => {
            expect(repositories.kitchenOrders.fulfilOrder).toHaveBeenCalledWith({
                id: row.id,
                lockVersion: 2,
            });
        });
    });

    it('keeps the payment position and the run in the drawer, from the row the detail cannot serve', async () => {
        const row = deskRow({
            id: orderIdAt(1),
            status: 'confirmed',
            totalMinor: 16_000,
            payment: { method: 'wish', receivedMinor: 10_000, receipted: false },
            deliveryJob: deliveryJob(),
        });

        await renderDeskWithDetail({
            listQueue: async () => queue([row]),
            getOrder: async () => detailOrder(row),
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        fireEvent.press(screen.getByTestId(rowTestId(1, 'open')));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-order-desk-detail-body')).toBeTruthy();
        });

        expect(screen.getByTestId('kitchen-order-desk-detail-payment-method')).toHaveTextContent(
            'WISH transfer',
        );
        expect(screen.getByTestId('kitchen-order-desk-detail-payment-received')).toHaveTextContent(
            'AED 100.00',
        );
        expect(screen.getByTestId('kitchen-order-desk-detail-payment-state')).toHaveTextContent(
            'Not settled',
        );

        // A run nobody has taken says so once, in the one place somebody would go looking for the
        // control that is not there.
        expect(screen.getByTestId('kitchen-order-desk-detail-delivery-state')).toHaveTextContent(
            'Needs a driver',
        );
        expect(screen.getByTestId('kitchen-order-desk-detail-assign-unavailable')).toBeTruthy();
    });

    it('draws no delivery section at all for an order nothing is driven for', async () => {
        const row = deskRow({ id: orderIdAt(1), fulfilmentType: 'pickup', status: 'confirmed' });

        await renderDeskWithDetail({
            listQueue: async () => queue([row]),
            getOrder: async () => detailOrder(row),
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        fireEvent.press(screen.getByTestId(rowTestId(1, 'open')));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-order-desk-detail-body')).toBeTruthy();
        });

        // A heading about nothing is worse than no heading.
        expect(screen.queryByTestId('kitchen-order-desk-detail-delivery')).toBeNull();
        // The payment block is still there: a collection is paid for.
        expect(screen.getByTestId('kitchen-order-desk-detail-payment')).toBeTruthy();
        // And the fulfil button carries no tracking caption, because there is no run to report.
        expect(screen.queryByTestId('kitchen-order-desk-detail-fulfil-tracking')).toBeNull();
    });

    it('shows the conflict callout with a refresh, and never retries the transition itself', async () => {
        const row = deskRow({ id: orderIdAt(1), status: 'placed', lockVersion: 1 });
        let reads = 0;

        const { repositories } = await renderDeskWithDetail({
            listQueue: async () => queue([row]),
            getOrder: async () => {
                reads += 1;
                // The second read is what the Refresh button is for: somebody else moved this
                // order, and the remedy is to show what actually happened.
                return reads === 1
                    ? detailOrder(row, { lockVersion: 1 })
                    : detailOrder(row, { lockVersion: 4, status: 'confirmed' });
            },
            confirmOrder: async () => {
                // A lost race, carrying the version the server actually holds.
                throw new ApiError(conflictFailure({ currentLockVersion: 4 }));
            },
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        fireEvent.press(screen.getByTestId(rowTestId(1, 'open')));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-order-desk-detail-confirm')).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('kitchen-order-desk-detail-confirm'));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-detail-conflict')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        // A conflict is not a generic failure message — it has its own remedy, and it is offered.
        expect(screen.queryByTestId('kitchen-order-desk-detail-action-error')).toBeNull();
        // Exactly one attempt: a silent retry with a refreshed version is the lost update the
        // `If-Match` guard exists to prevent.
        expect(repositories.kitchenOrders.confirmOrder).toHaveBeenCalledTimes(1);

        fireEvent.press(screen.getByTestId('kitchen-order-desk-detail-conflict-refresh'));

        await waitFor(
            () => {
                expect(screen.queryByTestId('kitchen-order-desk-detail-conflict')).toBeNull();
            },
            { timeout: 5000 },
        );
        // Re-read, and the drawer now shows what the other tablet did rather than a stale offer:
        // a confirmed order has no Confirm button.
        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-order-desk-detail-confirm')).toBeNull();
        });
    });

    it('reports a failure that is not a conflict as a plain message, with no refresh to offer', async () => {
        const row = deskRow({ id: orderIdAt(1), status: 'placed', lockVersion: 1 });

        await renderDeskWithDetail({
            listQueue: async () => queue([row]),
            getOrder: async () => detailOrder(row),
            confirmOrder: async () => {
                throw new ApiError(apiFailure('server'));
            },
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-table')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        fireEvent.press(screen.getByTestId(rowTestId(1, 'open')));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-order-desk-detail-confirm')).toBeTruthy();
        });
        fireEvent.press(screen.getByTestId('kitchen-order-desk-detail-confirm'));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-detail-action-error')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kitchen-order-desk-detail-conflict')).toBeNull();
    });
});
