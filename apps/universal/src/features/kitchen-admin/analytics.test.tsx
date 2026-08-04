import { createMemoryTokenStore } from '@healthy360/api-client';
import { createMockRepositories } from '@healthy360/api-client/mock';
import { MOCK_SCENARIOS } from '@healthy360/api-client/mock';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import { buildKitchenAnalytics } from './analytics-sample-data.ts';
import { AnalyticsScreen } from './screens/analytics-screen.tsx';

const KITCHEN_MANAGER = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/analytics',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

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
        const tokenStore = createMemoryTokenStore();
        const repositories = createMockRepositories({
            scenario: 'multi-org-dietitian',
            latencyMs: 1,
            tokenStore,
        });
        await repositories.auth.login({ email: KITCHEN_MANAGER, password: 'password' });
        const me = await repositories.session.me();
        const membership = me.memberships.find(
            (candidate) =>
                candidate.organisation.slug === 'verdant-kitchen' && candidate.status === 'active',
        );
        if (membership === undefined) throw new Error('missing membership');
        await repositories.context.setContext({ organisationId: membership.organisation.id });

        await render(
            <AppProviders
                initialMetrics={TEST_METRICS}
                repositories={repositories}
                tokenStore={tokenStore}
                queryClient={createTestQueryClient()}
                initialOnline
            >
                <AnalyticsScreen />
            </AppProviders>,
        );

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
            expect(screen.getByTestId('kitchen-analytics-kpi-produced-value').props.children).not.toEqual(
                producedBefore,
            );
        });
    });
});
