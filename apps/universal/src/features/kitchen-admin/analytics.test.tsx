import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { buildKitchenAnalytics } from './analytics-sample-data.ts';
import { AnalyticsScreen } from './screens/analytics-screen.tsx';
import { forgetColumnChoice, rememberColumnChoice } from './catalogue/column-picker.tsx';

afterEach(() => {
    forgetColumnChoice('kitchen-analytics-table');
});

// A fixed today, so the window the screen opens on — This month — is the same on every run.
jest.mock('../commerce/dates.ts', () => ({
    ...jest.requireActual<object>('../commerce/dates.ts'),
    todayIso: () => '2026-08-29',
}));

/** The days the screen opens on: This month, 1 to 29 August. */
const OPENING_DAYS = 29;

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/analytics',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The analytics dashboard reads no repository at all — every number on it comes from
 * `buildKitchenAnalytics`, which is a pure function of the two filters. So the only thing the
 * session has to supply is the gate's answer: `kitchen` demands an organisation, a branch and
 * `catalogue.view_organisation`, all of which the kitchen-manager fixture carries.
 */
describe('kitchen analytics', () => {
    it('builds deterministic sample bundles per filter pair', () => {
        const a = buildKitchenAnalytics(30, 'meals');
        const b = buildKitchenAnalytics(30, 'meals');
        const c = buildKitchenAnalytics(7, 'meals');

        expect(a.kpis).toEqual(b.kpis);
        expect(a.productionTrend).toEqual(b.productionTrend);
        expect(a.kpis[0]?.value).not.toEqual(c.kpis[0]?.value);
        expect(a.rows.length).toBeGreaterThan(0);
        expect(a.statusMix.reduce((sum, slice) => sum + slice.value, 0)).toBe(100);
    });

    it('renders KPIs, charts, and updates when the date range changes', async () => {
        await renderStubScreen(<AnalyticsScreen />, { session: kitchenManagerSession() });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-analytics-panel')).toBeTruthy();
        });

        // No cards: the KPIs are the Lens bar's figures, with the labelled Columns at its end.
        expect(screen.queryByTestId('kitchen-analytics-kpis')).toBeNull();
        expect(screen.getByTestId('kitchen-analytics-toolbar-figure-produced')).toBeTruthy();
        expect(screen.getByTestId('kitchen-analytics-table-columns-trigger')).toHaveTextContent(
            /6 of 6/,
        );
        expect(screen.getByTestId('kitchen-analytics-trend')).toBeTruthy();
        expect(screen.getByTestId('kitchen-analytics-channels')).toBeTruthy();
        expect(screen.getByTestId('kitchen-analytics-mix')).toBeTruthy();
        expect(screen.getByTestId('kitchen-analytics-table')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-analytics-theme-toggle')).toBeNull();

        const producedBefore = JSON.stringify(
            screen.getByTestId('kitchen-analytics-toolbar-figure-produced'),
        );

        // A window of a different length draws a different sample.
        fireEvent.press(screen.getByTestId('kitchen-analytics-period-trigger'));
        fireEvent.press(await screen.findByTestId('kitchen-analytics-period-today'));

        await waitFor(() => {
            expect(
                JSON.stringify(screen.getByTestId('kitchen-analytics-toolbar-figure-produced')),
            ).not.toEqual(producedBefore);
        });
    });
});

describe('kitchen analytics line items at desk width', () => {
    // The column headers are only drawn above `md`; below it the list is a stack of cards.
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

    const rowOrder = () =>
        screen
            .getAllByTestId(/^kitchen-analytics-table-row-row-all-\d+$/)
            .map((row) => String(row.props.testID));

    it('sorts by Updated on a press, oldest first, and flips on the next', async () => {
        // Updated ranks lowest of the seven, so it is one pick away; the reader has picked it.
        rememberColumnChoice('kitchen-analytics-table', [
            'name',
            'segment',
            'status',
            'volume',
            'done',
            'updated',
        ]);
        await renderStubScreen(<AnalyticsScreen />, { session: kitchenManagerSession() });
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-analytics-table-column-updated-trigger'),
            ).toBeTruthy();
        });

        const rows = buildKitchenAnalytics(OPENING_DAYS, 'all').rows;
        const idsOf = (sorted: typeof rows) =>
            sorted.map((row) => `kitchen-analytics-table-row-${row.id}`);
        // Two stable sorts rather than one reversed: rows updated the same hour keep their order.
        const oldestFirst = idsOf(
            [...rows].sort((left, right) => right.updatedHoursAgo - left.updatedHoursAgo),
        );
        const newestFirst = idsOf(
            [...rows].sort((left, right) => left.updatedHoursAgo - right.updatedHoursAgo),
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-analytics-table-column-updated-trigger'));
        });
        await waitFor(() => {
            expect(rowOrder()).toEqual(oldestFirst);
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-analytics-table-column-updated-trigger'));
        });
        await waitFor(() => {
            expect(rowOrder()).toEqual(newestFirst);
        });
    });
});
