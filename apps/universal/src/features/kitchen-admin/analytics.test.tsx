import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { buildKitchenAnalytics } from './analytics-sample-data.ts';
import { AnalyticsScreen } from './screens/analytics-screen.tsx';

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
        const a = buildKitchenAnalytics('30d', 'meals');
        const b = buildKitchenAnalytics('30d', 'meals');
        const c = buildKitchenAnalytics('7d', 'meals');

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

        expect(screen.getByTestId('kitchen-analytics-kpi-produced')).toBeTruthy();
        expect(screen.getByTestId('kitchen-analytics-line')).toBeTruthy();
        expect(screen.getByTestId('kitchen-analytics-bar')).toBeTruthy();
        expect(screen.getByTestId('kitchen-analytics-donut')).toBeTruthy();
        expect(screen.getByTestId('kitchen-analytics-table')).toBeTruthy();
        expect(screen.getByTestId('kitchen-analytics-theme-toggle')).toBeTruthy();

        const producedBefore = screen.getByTestId('kitchen-analytics-kpi-produced-value').props
            .children;

        fireEvent.press(screen.getByTestId('kitchen-analytics-range-7d'));

        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-analytics-kpi-produced-value').props.children,
            ).not.toEqual(producedBefore);
        });
    });
});
