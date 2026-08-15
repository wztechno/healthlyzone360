import { ApiError, apiFailure } from '@healthy360/api-client';
import type {
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
import { minutesPastDue, orderDeskDueTone } from './ops-format.ts';
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
        payment: null,
        deliveryJob: null,
        ...overrides,
    };
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
