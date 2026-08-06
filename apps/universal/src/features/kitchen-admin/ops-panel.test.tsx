import { createMemoryTokenStore } from '@healthy360/api-client';
import { createMockRepositories } from '@healthy360/api-client/mock';
import { MOCK_SCENARIOS } from '@healthy360/api-client/mock';
import { render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import { StockScreen } from './screens/stock-screen.tsx';

const KITCHEN_MANAGER = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/stock',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

describe('ops panels', () => {
    it('renders the stock board with live counts from the fixture world', async () => {
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
                <StockScreen />
            </AppProviders>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-stock-panel')).toBeTruthy();
        });

        // The fixture world (`KitchenOpsMockStore`) seeds four stock items, three levels and no
        // out-of-stock rows — these are live counts of what the screen fetched, not fabricated KPIs.
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-stock-panel-metric-items-value')).toHaveTextContent('4');
        });
        expect(screen.getByTestId('kitchen-stock-panel-metric-levels-value')).toHaveTextContent('3');
        expect(screen.getByTestId('kitchen-stock-panel-metric-outOfStock-value')).toHaveTextContent(
            '0',
        );

        expect(screen.getByTestId('kitchen-stock-items-table')).toBeTruthy();
        expect(screen.getByTestId('kitchen-stock-levels-table')).toBeTruthy();
    });

    it('shows an honest empty state when a filter or fixture leaves no stock items', async () => {
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

        // Empties the fixture world's stock items without going through the repository, exactly as
        // `prototypeStore` is used elsewhere: a test may reach into the mutable store to assert a
        // screen's *empty* rendering, which no repository call can otherwise produce on demand.
        repositories.kitchenOpsStore.stockItems = () => [];

        await render(
            <AppProviders
                initialMetrics={TEST_METRICS}
                repositories={repositories}
                tokenStore={tokenStore}
                queryClient={createTestQueryClient()}
                initialOnline
            >
                <StockScreen />
            </AppProviders>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-stock-items-empty')).toBeTruthy();
        });
    });
});
