import type {
    KitchenAnalyticsFilter,
    KitchenAnalyticsReport,
    KitchenAnalyticsTotals,
} from '@healthy360/api-client/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { AnalyticsScreen, trendBuckets } from './screens/analytics-screen.tsx';
import { forgetColumnChoice } from './catalogue/column-picker.tsx';

afterEach(() => {
    forgetColumnChoice('kitchen-analytics-table');
});

// A fixed today, so the window the screen opens on — This month — is the same on every run.
jest.mock('../commerce/dates.ts', () => ({
    ...jest.requireActual<object>('../commerce/dates.ts'),
    todayIso: () => '2026-08-29',
}));

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/analytics',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The analytics dashboard reads one report, `getKitchenAnalytics`, for the chosen window against
 * the window before it. These tests stub that read and assert what the screen makes of it.
 */

const EMPTY: KitchenAnalyticsTotals = {
    orders: 0,
    units: 0,
    cancelled: 0,
    fulfilled: 0,
    open: 0,
    fulfilledWithDue: 0,
    onTime: 0,
    avgLeadMinutes: null,
};

function report(
    filter: KitchenAnalyticsFilter,
    overrides: Partial<KitchenAnalyticsReport> = {},
): KitchenAnalyticsReport {
    return {
        from: filter.from,
        to: filter.to,
        current: {
            orders: 4,
            units: 7,
            cancelled: 1,
            fulfilled: 3,
            open: 1,
            fulfilledWithDue: 2,
            onTime: 1,
            avgLeadMinutes: 190,
        },
        previous: { ...EMPTY, orders: 2, units: 14, open: 2 },
        days: [{ date: filter.to, orders: 4, units: 7 }],
        channels: [
            { key: 'subscription', orders: 1, units: 1 },
            { key: 'b2b', orders: 1, units: 1 },
            { key: 'pos', orders: 1, units: 3 },
            { key: 'a_la_carte', orders: 1, units: 2 },
        ],
        items: [
            {
                catalogueItemId: 'item-1',
                nameEn: 'Freekeh bowl',
                nameAr: null,
                itemType: 'meal',
                orders: 3,
                units: 4,
                lastOrderedAt: '2026-05-11T20:30:00Z',
            },
        ],
        ...overrides,
    };
}

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

const figureValue = (key: string) =>
    screen.getByTestId(`kitchen-analytics-toolbar-figure-${key}-value`);

describe('kitchen analytics', () => {
    it('shows the report for This month and asks again when the window changes', async () => {
        const asked: KitchenAnalyticsFilter[] = [];
        await renderStubScreen(<AnalyticsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    getKitchenAnalytics: async (filter) => {
                        asked.push(filter);
                        return report(filter);
                    },
                },
            },
        });

        await untilVisible('kitchen-analytics-toolbar-figure-orders-value');
        expect(asked[0]).toEqual({ from: '2026-08-01', to: '2026-08-29' });

        // No cards: the KPIs are the Lens bar's figures, with the labelled Columns at its end.
        expect(screen.queryByTestId('kitchen-analytics-kpis')).toBeNull();
        expect(screen.getByTestId('kitchen-analytics-table-columns-trigger')).toHaveTextContent(
            /6 of 6/,
        );
        expect(figureValue('orders')).toHaveTextContent('4');
        // One of two orders with a due date made it: 50 %.
        expect(figureValue('onTime')).toHaveTextContent(/50/);
        // 190 minutes is 3.2 hours.
        expect(figureValue('leadTime')).toHaveTextContent('3.2 h');
        // Units halved (14 → 7): the change against last period is behind the figure's (i).
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-analytics-toolbar-figure-units-info'));
        });
        expect(await screen.findByText('↓ 50%')).toBeTruthy();

        expect(screen.getByTestId('kitchen-analytics-trend')).toBeTruthy();
        expect(screen.getByTestId('kitchen-analytics-channels')).toBeTruthy();
        expect(screen.getByTestId('kitchen-analytics-mix')).toBeTruthy();
        expect(screen.getByTestId('kitchen-analytics-table')).toBeTruthy();
        expect(screen.getByText('Freekeh bowl')).toBeTruthy();

        fireEvent.press(screen.getByTestId('kitchen-analytics-period-trigger'));
        fireEvent.press(await screen.findByTestId('kitchen-analytics-period-today'));
        await waitFor(() => {
            expect(asked).toContainEqual({ from: '2026-08-29', to: '2026-08-29' });
        });
    });

    it('shows the dash when nothing fulfilled had a due date, and an empty state with no orders', async () => {
        await renderStubScreen(<AnalyticsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    getKitchenAnalytics: async (filter) =>
                        report(filter, { current: EMPTY, previous: EMPTY, items: [] }),
                },
            },
        });

        await untilVisible('kitchen-analytics-empty');
        expect(figureValue('onTime')).toHaveTextContent('—');
        expect(screen.queryByTestId('kitchen-analytics-mix')).toBeNull();
        expect(screen.queryByTestId('kitchen-analytics-table')).toBeNull();
    });

    it('offers a retry when the report fails, and keeps the window in reach', async () => {
        let calls = 0;
        await renderStubScreen(<AnalyticsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    getKitchenAnalytics: async (filter) => {
                        calls += 1;
                        if (calls === 1) throw new Error('offline');
                        return report(filter);
                    },
                },
            },
        });

        await untilVisible('kitchen-analytics-error');
        expect(screen.getByTestId('kitchen-analytics-period-trigger')).toBeTruthy();
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-analytics-error-retry'));
        });
        await untilVisible('kitchen-analytics-toolbar-figure-orders-value');
    });
});

describe('kitchen analytics trend', () => {
    it('sums days into weeks ending on the last day, the oldest run taking the remainder', () => {
        const days = Array.from({ length: 9 }, (_, index) => ({
            date: `2026-10-${String(index + 4).padStart(2, '0')}`,
            orders: 1,
            units: index + 1,
        }));

        expect(trendBuckets(days, 7)).toEqual([
            { from: '2026-10-04', to: '2026-10-05', units: 3 },
            { from: '2026-10-06', to: '2026-10-12', units: 42 },
        ]);
        expect(trendBuckets(days, 1)).toHaveLength(9);
    });
});
