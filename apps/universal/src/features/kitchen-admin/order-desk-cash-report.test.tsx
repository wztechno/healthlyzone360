import { ApiError, apiFailure } from '@healthy360/api-client';
import type {
    OrderDeskCashReport,
    OrderDeskCashReportFilters,
    OrderDeskCashReportRow,
} from '@healthy360/api-client/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { addDays, isoWeekday, todayIso } from '../commerce/dates.ts';
import { OrderDeskCashReportScreen } from './screens/order-desk-cash-report-screen.tsx';
import { Dimensions } from 'react-native';

/**
 * These screens draw their tables through `CatalogueList`, which only lays out columns at `md` and
 * above; React Native's Jest window is 750px. Desk width for the whole file, restored afterwards.
 */
const narrowWindow = Dimensions.get('window');
const narrowScreen = Dimensions.get('screen');
beforeAll(() => {
    Dimensions.set({
        window: { ...narrowWindow, width: 1440, height: 900 },
        screen: { ...narrowScreen, width: 1440, height: 900 },
    });
});
afterAll(() => {
    Dimensions.set({ window: narrowWindow, screen: narrowScreen });
});
jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/order-desk/cash-report',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The cash report: one day's takings, and the four things it must never do.
 *
 * 1. **It must not add two currencies together.** One agent taking dollars and dirhams is two rows
 *    and two totals, and the fixture below authors exactly that — because a screen that folded them
 *    would render a single, perfectly formatted number belonging to no currency at all.
 * 2. **It must not lose a nameless agent.** A member whose profile was never completed still took
 *    the money, so the row is present with an em dash and a spoken label. Dropping it would be
 *    losing cash from a reconciliation to protect a null.
 * 3. **It must say which midnight it cut on.** The day boundary is UTC and the reader's is not, so
 *    `meta.timezone` is rendered rather than assumed.
 * 4. **It must not read as a drawer reconciliation.** This platform has no shift table; the scope
 *    callout is what stops a manager trusting the table further than it goes, so it is asserted
 *    like any other content.
 */

const SARA = 'user-0000-0000-0001';
const OMAR = 'user-0000-0000-0002';
const NAMELESS = 'user-0000-0000-0003';

function row(overrides: Partial<OrderDeskCashReportRow> = {}): OrderDeskCashReportRow {
    return {
        day: '2026-05-10',
        confirmedBy: SARA,
        displayName: 'Sara Nasr',
        method: 'cash_on_delivery',
        currencyCode: 'USD',
        receiptCount: 2,
        amountMinorSum: 4_000,
        ...overrides,
    };
}

/** One agent across two currencies, one across one, and one with no name at all. */
function seedRows(): readonly OrderDeskCashReportRow[] {
    return [
        row(),
        // The same person, the same method, a different currency — a *different row*, because the
        // currency is part of the group's identity rather than a label on it.
        row({ currencyCode: 'AED', receiptCount: 1, amountMinorSum: 9_000 }),
        row({
            confirmedBy: OMAR,
            displayName: 'Omar Nasr',
            method: 'cash_at_counter',
            receiptCount: 1,
            amountMinorSum: 400,
        }),
        row({
            confirmedBy: NAMELESS,
            displayName: null,
            method: 'wish',
            receiptCount: 1,
            amountMinorSum: 250,
        }),
    ];
}

function report(rows: readonly OrderDeskCashReportRow[]): OrderDeskCashReport {
    return {
        rows,
        adjustments: [],
        // Derived by the server, never by the screen — two totals for one method, because two
        // currencies.
        totals: [
            {
                method: 'cash_on_delivery',
                currencyCode: 'USD',
                receiptCount: 2,
                amountMinorSum: 4_000,
            },
            {
                method: 'cash_on_delivery',
                currencyCode: 'AED',
                receiptCount: 1,
                amountMinorSum: 9_000,
            },
            {
                method: 'cash_at_counter',
                currencyCode: 'USD',
                receiptCount: 1,
                amountMinorSum: 400,
            },
            { method: 'wish', currencyCode: 'USD', receiptCount: 1, amountMinorSum: 250 },
        ],
        meta: {
            from: '2026-05-10',
            to: '2026-05-10',
            branchId: null,
            timezone: 'UTC',
            branches: [],
            count: rows.length,
        },
    };
}

async function renderReport(
    getCashReport: (filters: OrderDeskCashReportFilters) => Promise<OrderDeskCashReport>,
) {
    return renderStubScreen(<OrderDeskCashReportScreen />, {
        session: kitchenManagerSession(),
        repositories: { orderDesk: { getCashReport } },
    });
}

async function settled() {
    await waitFor(
        () => {
            expect(screen.getByTestId('kitchen-order-desk-cash-report-table')).toBeTruthy();
        },
        { timeout: 5000 },
    );
}

function rowTestId(entry: OrderDeskCashReportRow, suffix: string): string {
    return `kitchen-order-desk-cash-${entry.day}-${entry.confirmedBy}-${entry.method}-${entry.currencyCode}-${suffix}`;
}

describe('order desk cash report — the ladder', () => {
    it('shows skeletons before the day answers', async () => {
        // Held open deliberately: the gate resolves the session first, so the frame between the
        // gate opening and the report landing is only observable if this test decides when it does.
        let release: (value: OrderDeskCashReport) => void = () => undefined;
        const held = new Promise<OrderDeskCashReport>((resolve) => {
            release = resolve;
        });

        await renderReport(async () => held);

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-cash-report-loading')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        release(report(seedRows()));
        await settled();
    });

    it('offers a retry when the day could not be read', async () => {
        await renderReport(async () => {
            throw new ApiError(apiFailure('server'));
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-cash-report-error')).toBeTruthy();
            },
            { timeout: 5000 },
        );
    });

    it('renders an empty day as an answer rather than a hole', async () => {
        await renderReport(async () => ({
            rows: [],
            totals: [],
            adjustments: [],
            meta: {
                from: '2026-05-10',
                to: '2026-05-10',
                branchId: null,
                timezone: 'UTC',
                branches: [],
                count: 0,
            },
        }));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-cash-report-empty')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        // No table and no totals block: there is nothing to total.
        expect(screen.queryByTestId('kitchen-order-desk-cash-report-table')).toBeNull();
        expect(screen.queryByTestId('kitchen-order-desk-cash-report-totals')).toBeNull();
    });

    it('opens on today, and asks for the window chosen from the From picker', async () => {
        const { repositories } = await renderReport(async () => report(seedRows()));
        const today = todayIso();

        await settled();
        expect(repositories.orderDesk.getCashReport).toHaveBeenCalledWith({
            from: today,
            to: today,
        });
        expect(
            screen.getByTestId('kitchen-order-desk-cash-report-period-trigger'),
        ).toHaveTextContent(/Today/);

        const firstOfMonth = `${today.slice(0, 8)}01`;
        fireEvent.press(screen.getByTestId('kitchen-order-desk-cash-report-from-trigger'));
        fireEvent.press(
            await screen.findByTestId(`kitchen-order-desk-cash-report-from-day-${firstOfMonth}`),
        );

        await waitFor(() => {
            expect(repositories.orderDesk.getCashReport).toHaveBeenCalledWith({
                from: firstOfMonth,
                to: today,
            });
        });
        expect(screen.queryByTestId('kitchen-order-desk-cash-report-from-panel')).toBeNull();
    });

    it('writes both days when a period shortcut is picked', async () => {
        const { repositories } = await renderReport(async () => report(seedRows()));
        const today = todayIso();
        await settled();

        fireEvent.press(screen.getByTestId('kitchen-order-desk-cash-report-period-trigger'));
        fireEvent.press(
            await screen.findByTestId('kitchen-order-desk-cash-report-period-yesterday'),
        );
        const yesterday = addDays(today, -1);
        await waitFor(() => {
            expect(repositories.orderDesk.getCashReport).toHaveBeenCalledWith({
                from: yesterday,
                to: yesterday,
            });
        });

        // A scope menu stays open after a pick (its items are checkable), so the next pick is
        // made from the same open menu.
        fireEvent.press(await screen.findByTestId('kitchen-order-desk-cash-report-period-week'));
        // Monday of this week through today.
        const monday = addDays(today, 1 - (isoWeekday(today) ?? 1));
        await waitFor(() => {
            expect(repositories.orderDesk.getCashReport).toHaveBeenCalledWith({
                from: monday,
                to: today,
            });
        });
    });

    it('narrows to a till picked from the daily close picker', async () => {
        const base = report(seedRows());
        const { repositories } = await renderReport(async () => ({
            ...base,
            meta: {
                ...base.meta,
                branches: [
                    { id: 'branch-main', name: 'Main kitchen' },
                    { id: 'branch-two', name: 'Second kitchen' },
                ],
            },
        }));
        const today = todayIso();
        await settled();

        fireEvent.press(screen.getByTestId('kitchen-order-desk-cash-report-branch-trigger'));
        fireEvent.press(
            await screen.findByTestId('kitchen-order-desk-cash-report-branch-option-branch-two'),
        );

        await waitFor(() => {
            expect(repositories.orderDesk.getCashReport).toHaveBeenCalledWith({
                from: today,
                to: today,
                branchId: 'branch-two',
            });
        });
    });

    it('offers no till picker to a kitchen with one till', async () => {
        await renderReport(async () => report(seedRows()));
        await settled();

        expect(screen.queryByTestId('kitchen-order-desk-cash-report-branch')).toBeNull();
    });
});

describe('order desk cash report — rows, totals and the em dash', () => {
    it("keeps one agent's two currencies as two rows and never sums across them", async () => {
        const rows = seedRows();
        await renderReport(async () => report(rows));
        await settled();

        const usd = rows[0] as OrderDeskCashReportRow;
        const aed = rows[1] as OrderDeskCashReportRow;

        // Two cells, two figures, same person and same method. A screen that folded the currency
        // out of the key would render one.
        expect(screen.getByTestId(rowTestId(usd, 'amount'))).toBeTruthy();
        expect(screen.getByTestId(rowTestId(aed, 'amount'))).toBeTruthy();
        expect(screen.getByTestId(rowTestId(usd, 'count'))).toHaveTextContent('2');
        expect(screen.getByTestId(rowTestId(aed, 'count'))).toHaveTextContent('1');
    });

    it('renders one total per method and currency, and no grand total', async () => {
        await renderReport(async () => report(seedRows()));
        await settled();

        expect(screen.getByTestId('kitchen-order-desk-cash-report-totals')).toBeTruthy();
        // Four (method, currency) pairs, including the two that share a method.
        expect(
            screen.getByTestId('kitchen-order-desk-cash-report-total-cash_on_delivery-USD'),
        ).toBeTruthy();
        expect(
            screen.getByTestId('kitchen-order-desk-cash-report-total-cash_on_delivery-AED'),
        ).toBeTruthy();
        expect(
            screen.getByTestId('kitchen-order-desk-cash-report-total-cash_at_counter-USD'),
        ).toBeTruthy();
        expect(screen.getByTestId('kitchen-order-desk-cash-report-total-wish-USD')).toBeTruthy();
    });

    it('keeps each day of a window on its own row, with its day printed', async () => {
        const monday = row();
        const tuesday = row({ day: '2026-05-11', receiptCount: 1, amountMinorSum: 700 });
        await renderReport(async () => report([monday, tuesday]));
        await settled();

        expect(screen.getByTestId(rowTestId(monday, 'day'))).toHaveTextContent(/10/);
        expect(screen.getByTestId(rowTestId(tuesday, 'day'))).toHaveTextContent(/11/);
        expect(screen.getByTestId(rowTestId(tuesday, 'count'))).toHaveTextContent('1');
    });

    it('renders a nameless agent as an em dash that says in words what it stands for', async () => {
        const rows = seedRows();
        await renderReport(async () => report(rows));
        await settled();

        const nameless = rows[3] as OrderDeskCashReportRow;
        const cell = screen.getByTestId(rowTestId(nameless, 'agent'));

        expect(cell).toHaveTextContent(/—/);
        // The dash is silent to a screen reader, so the cell carries its own sentence — and the
        // money beside it is still there, which is the point of listing the row at all.
        expect(cell.props.accessibilityLabel).toBeTruthy();
        expect(screen.getByTestId(rowTestId(nameless, 'amount'))).toBeTruthy();
    });

    it('prints no day-of line under the picker, and no drawer reconciliation', async () => {
        await renderReport(async () => report(seedRows()));
        await settled();

        expect(screen.queryByTestId('kitchen-order-desk-cash-report-measured-on')).toBeNull();
        expect(screen.queryByTestId('kitchen-order-desk-cash-report-scope')).toBeNull();
        expect(
            screen.getByTestId('kitchen-order-desk-cash-report-toolbar-figure-receipts-value'),
        ).toHaveTextContent('5');
    });
});
