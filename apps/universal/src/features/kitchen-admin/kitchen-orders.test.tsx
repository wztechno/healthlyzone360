import { createMemoryTokenStore } from '@healthy360/api-client';
import { createMockRepositories } from '@healthy360/api-client/mock';
import { MOCK_SCENARIOS } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import { OrdersScreen } from './screens/orders-screen.tsx';

const KITCHEN_MANAGER = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/orders',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * Signs the kitchen manager into Verdant Kitchen — the organisation the order fixture world seeds
 * its five orders against. Identical boilerplate to `ops-panel.test.tsx`, deliberately: the screen
 * under test is gated on an organisation-scoped permission, so a test that skipped the context
 * would be asserting against the forbidden page.
 */
async function signIn(): Promise<{
    readonly repositories: MockRepositories;
    readonly tokenStore: ReturnType<typeof createMemoryTokenStore>;
}> {
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
    return { repositories, tokenStore };
}

function renderOrders(
    repositories: MockRepositories,
    tokenStore: ReturnType<typeof createMemoryTokenStore>,
) {
    return render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={tokenStore}
            queryClient={createTestQueryClient()}
            initialOnline
        >
            <OrdersScreen />
        </AppProviders>,
    );
}

describe('kitchen orders', () => {
    it('renders the seeded order book with a status for every row', async () => {
        const { repositories, tokenStore } = await signIn();
        await renderOrders(repositories, tokenStore);

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-table')).toBeTruthy();
        });

        // The fixture world seeds five Verdant orders across all four statuses.
        expect(screen.getByTestId('kitchen-orders-panel-metric-loaded-value')).toHaveTextContent(
            '5',
        );
        expect(screen.getByTestId('kitchen-orders-panel-metric-awaiting-value')).toHaveTextContent(
            '2',
        );
        expect(screen.getByTestId('kitchen-orders-panel-metric-confirmed-value')).toHaveTextContent(
            '1',
        );

        const orders = repositories.kitchenOrdersStore.orders();
        const newest = orders[0];
        if (newest === undefined) throw new Error('the fixture world seeded no orders');
        expect(screen.getByTestId(`kitchen-order-${String(newest.id)}-number`)).toHaveTextContent(
            'VK-2026-0148',
        );
        expect(screen.getByTestId(`kitchen-order-${String(newest.id)}-status`)).toBeTruthy();
    });

    it('narrows the list to one status when the filter is used', async () => {
        const { repositories, tokenStore } = await signIn();
        await renderOrders(repositories, tokenStore);

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-table')).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('kitchen-orders-status-fulfilled'));

        // One fulfilled order in the seed, so the loaded count is the filter's own answer.
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-orders-panel-metric-loaded-value'),
            ).toHaveTextContent('1');
        });
        const fulfilled = repositories.kitchenOrdersStore
            .orders()
            .filter((order) => order.status === 'fulfilled');
        expect(fulfilled).toHaveLength(1);
        const only = fulfilled[0];
        if (only === undefined) throw new Error('no fulfilled order in the fixture world');
        expect(screen.getByTestId(`kitchen-order-${String(only.id)}-number`)).toBeTruthy();
        expect(screen.getByTestId('kitchen-orders-panel-metric-awaiting-value')).toHaveTextContent(
            '0',
        );
    });

    it('opens the slide-in with the order lines and its totals breakdown', async () => {
        const { repositories, tokenStore } = await signIn();
        await renderOrders(repositories, tokenStore);

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-table')).toBeTruthy();
        });

        const placed = repositories.kitchenOrdersStore
            .orders()
            .find((order) => order.status === 'placed');
        if (placed === undefined) throw new Error('no placed order in the fixture world');

        fireEvent.press(screen.getByTestId(`kitchen-order-${String(placed.id)}-open`));

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-detail-body')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-orders-detail-lines')).toBeTruthy();
        // 16 000 and 14 500 minor units, turned into major units exactly once by the currency's
        // own exponent — the reason the screen reuses `formatMoney` rather than dividing by 100.
        expect(screen.getByTestId('kitchen-orders-detail-total')).toHaveTextContent('AED 160.00');
        expect(screen.getByTestId('kitchen-orders-detail-subtotal')).toHaveTextContent(
            'AED 145.00',
        );
    });

    it('confirms a placed order and leaves the panel on the fresh record', async () => {
        const { repositories, tokenStore } = await signIn();
        await renderOrders(repositories, tokenStore);

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-table')).toBeTruthy();
        });

        const placed = repositories.kitchenOrdersStore
            .orders()
            .find((order) => order.status === 'placed');
        if (placed === undefined) throw new Error('no placed order in the fixture world');

        fireEvent.press(screen.getByTestId(`kitchen-order-${String(placed.id)}-open`));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-confirm')).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('kitchen-orders-confirm'));

        // The mock store enforces the real machine, so this is the transition itself, not a stub:
        // `placed → confirmed`, with the lock version incremented.
        await waitFor(() => {
            const after = repositories.kitchenOrdersStore
                .orders()
                .find((order) => order.id === placed.id);
            expect(after?.status).toBe('confirmed');
            expect(after?.lockVersion).toBe(placed.lockVersion + 1);
        });

        // Confirm is gone and Fulfil has taken its place — the panel is reading the fresh record
        // the mutation seeded, which is the version the next action has to send.
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-fulfil')).toBeTruthy();
        });
        expect(screen.queryByTestId('kitchen-orders-confirm')).toBeNull();
    });

    it('requires a reason before the cancel dialog will submit', async () => {
        const { repositories, tokenStore } = await signIn();
        await renderOrders(repositories, tokenStore);

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-table')).toBeTruthy();
        });

        const placed = repositories.kitchenOrdersStore
            .orders()
            .find((order) => order.status === 'placed');
        if (placed === undefined) throw new Error('no placed order in the fixture world');

        fireEvent.press(screen.getByTestId(`kitchen-order-${String(placed.id)}-open`));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-cancel')).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('kitchen-orders-cancel'));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-cancel-reasons')).toBeTruthy();
        });

        const submit = screen.getByTestId('kitchen-orders-cancel-confirm');
        expect(submit).toBeDisabled();

        fireEvent.press(screen.getByTestId('kitchen-orders-cancel-reason-delivery_unavailable'));
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-orders-cancel-confirm')).not.toBeDisabled();
        });
        fireEvent.press(screen.getByTestId('kitchen-orders-cancel-confirm'));

        await waitFor(() => {
            const after = repositories.kitchenOrdersStore
                .orders()
                .find((order) => order.id === placed.id);
            expect(after?.status).toBe('cancelled');
            expect(after?.cancellationReason).toBe('delivery_unavailable');
        });
    });
});
