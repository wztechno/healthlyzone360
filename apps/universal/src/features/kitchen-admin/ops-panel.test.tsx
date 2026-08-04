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
    it('renders an honest empty stock board without inventing counts', async () => {
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
        expect(screen.getByTestId('kitchen-stock-panel-status')).toBeTruthy();
        expect(screen.getByTestId('kitchen-stock-panel-metric-onHand-value')).toHaveTextContent('—');
        expect(screen.getByTestId('kitchen-stock-panel-empty')).toBeTruthy();
    });
});
